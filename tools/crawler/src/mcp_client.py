"""MCP client for fetching tool schemas from MCP servers."""

import asyncio
import logging
from dataclasses import dataclass, field
from datetime import datetime, timezone
from typing import Any

import aiohttp

logger = logging.getLogger(__name__)


@dataclass
class ToolSchema:
    """Schema for a single MCP tool."""

    name: str
    description: str | None = None
    input_schema: dict[str, Any] | None = None

    def to_dict(self) -> dict[str, Any]:
        """Convert to dictionary for YAML output."""
        result: dict[str, Any] = {"name": self.name}
        if self.description:
            result["description"] = self.description
        if self.input_schema:
            result["inputSchema"] = self.input_schema
        return result


@dataclass
class ServerResult:
    """Result of fetching tools from an MCP server."""

    id: str
    url: str
    status: str  # "online", "offline", "error"
    last_checked: str
    tools: list[ToolSchema] = field(default_factory=list)
    error_message: str | None = None

    def to_dict(self) -> dict[str, Any]:
        """Convert to dictionary for YAML output (excluding sensitive data like URLs)."""
        result: dict[str, Any] = {
            "id": self.id,
            "status": self.status,
            "last_checked": self.last_checked,
        }
        if self.tools:
            result["tools"] = [tool.to_dict() for tool in self.tools]
        if self.error_message:
            result["error_message"] = self.error_message
        return result


class MCPClient:
    """Client for fetching tool schemas from MCP servers via Streamable HTTP."""

    def __init__(self, timeout: float = 60.0, delay: float = 0.5):
        """
        Initialize MCPClient.

        Args:
            timeout: Timeout in seconds for each server connection.
            delay: Delay in seconds between requests (to reduce server load).
        """
        self.timeout = timeout
        self.delay = delay

    async def fetch_tools_schema(
        self,
        server_id: str,
        server_url: str,
        headers: dict[str, str] | None = None,
    ) -> ServerResult:
        """
        Fetch tool schemas from an MCP server.

        Args:
            server_id: Unique identifier for the server.
            server_url: URL of the MCP server.
            headers: Optional headers for authentication.

        Returns:
            ServerResult with status and tool schemas.
        """
        timestamp = datetime.now(timezone.utc).isoformat()

        try:
            tools = await asyncio.wait_for(
                self._fetch_tools(server_url, headers),
                timeout=self.timeout,
            )

            return ServerResult(
                id=server_id,
                url=server_url,
                status="online",
                last_checked=timestamp,
                tools=tools,
            )

        except asyncio.TimeoutError:
            logger.warning(f"Timeout connecting to {server_id} ({server_url})")
            return ServerResult(
                id=server_id,
                url=server_url,
                status="offline",
                last_checked=timestamp,
                error_message="Connection timeout",
            )

        except Exception as e:
            logger.error(f"Error connecting to {server_id} ({server_url}): {e}")
            return ServerResult(
                id=server_id,
                url=server_url,
                status="error",
                last_checked=timestamp,
                error_message=str(e),
            )

    async def _fetch_tools(
        self,
        server_url: str,
        headers: dict[str, str] | None = None,
    ) -> list[ToolSchema]:
        """
        Internal method to fetch tools from MCP server via Streamable HTTP.

        Uses JSON-RPC protocol:
        1. Send 'initialize' request
        2. Send 'tools/list' request
        3. Parse tool schemas from response

        Args:
            server_url: URL of the MCP server.
            headers: Optional headers for authentication.

        Returns:
            List of ToolSchema objects.
        """
        tools: list[ToolSchema] = []

        # Prepare headers
        request_headers = {"Content-Type": "application/json"}
        if headers:
            request_headers.update(headers)

        logger.debug(f"Connecting to {server_url} with headers: {list(request_headers.keys())}")

        async with aiohttp.ClientSession() as session:
            # Step 1: Initialize
            init_payload = {
                "jsonrpc": "2.0",
                "id": 1,
                "method": "initialize",
                "params": {
                    "protocolVersion": "2024-11-05",
                    "capabilities": {},
                    "clientInfo": {"name": "mcp-catalog-crawler", "version": "1.0.0"},
                },
            }

            async with session.post(
                server_url, json=init_payload, headers=request_headers
            ) as response:
                if response.status != 200:
                    error_text = await response.text()
                    raise Exception(f"Initialize failed: {response.status} - {error_text}")

                init_result = await response.json()
                if "error" in init_result:
                    raise Exception(f"Initialize error: {init_result['error']}")

                # Get session ID from response header
                session_id = response.headers.get("Mcp-Session-Id")
                if session_id:
                    request_headers["Mcp-Session-Id"] = session_id
                    logger.debug(f"Got session ID: {session_id}")

            logger.debug(f"Initialize successful for {server_url}")

            # Step 2: Get tools list
            tools_payload = {
                "jsonrpc": "2.0",
                "id": 2,
                "method": "tools/list",
                "params": {},
            }

            async with session.post(
                server_url, json=tools_payload, headers=request_headers
            ) as response:
                if response.status != 200:
                    error_text = await response.text()
                    raise Exception(f"tools/list failed: {response.status} - {error_text}")

                tools_result = await response.json()
                if "error" in tools_result:
                    raise Exception(f"tools/list error: {tools_result['error']}")

            # Parse tools from result
            result_data = tools_result.get("result", {})
            tools_data = result_data.get("tools", [])

            for tool_data in tools_data:
                tool_schema = ToolSchema(
                    name=tool_data.get("name", ""),
                    description=tool_data.get("description"),
                    input_schema=tool_data.get("inputSchema"),
                )
                tools.append(tool_schema)

            logger.debug(f"Found {len(tools)} tools at {server_url}")

        return tools

    async def fetch_multiple(
        self,
        servers: list[tuple[str, str, dict[str, str] | None]],
        max_concurrent: int = 10,
    ) -> list[ServerResult]:
        """
        Fetch tool schemas from multiple MCP servers concurrently.

        Args:
            servers: List of (server_id, server_url, headers) tuples.
            max_concurrent: Maximum concurrent connections (default: 10).

        Returns:
            List of ServerResult objects.
        """
        semaphore = asyncio.Semaphore(max_concurrent)

        async def fetch_with_limit(
            server_id: str, server_url: str, headers: dict[str, str] | None
        ) -> ServerResult:
            async with semaphore:
                result = await self.fetch_tools_schema(server_id, server_url, headers)
                # Add delay between requests to reduce server load
                if self.delay > 0:
                    await asyncio.sleep(self.delay)
                return result

        tasks = [
            fetch_with_limit(server_id, server_url, headers)
            for server_id, server_url, headers in servers
        ]

        results = await asyncio.gather(*tasks, return_exceptions=True)

        # Handle any exceptions that slipped through
        processed_results: list[ServerResult] = []
        for i, result in enumerate(results):
            if isinstance(result, Exception):
                server_id, server_url, _ = servers[i]
                processed_results.append(
                    ServerResult(
                        id=server_id,
                        url=server_url,
                        status="error",
                        last_checked=datetime.now(timezone.utc).isoformat(),
                        error_message=str(result),
                    )
                )
            else:
                processed_results.append(result)

        return processed_results
