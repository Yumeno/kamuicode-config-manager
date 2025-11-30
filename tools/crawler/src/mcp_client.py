"""MCP client for fetching tool schemas from MCP servers."""

import asyncio
import logging
from dataclasses import dataclass, field
from datetime import datetime, timezone
from typing import Any

from mcp import ClientSession
from mcp.client.sse import sse_client

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
        """Convert to dictionary for YAML output (excluding sensitive data)."""
        result: dict[str, Any] = {
            "id": self.id,
            "url": self.url,
            "status": self.status,
            "last_checked": self.last_checked,
        }
        if self.tools:
            result["tools"] = [tool.to_dict() for tool in self.tools]
        if self.error_message:
            result["error_message"] = self.error_message
        return result


class MCPClient:
    """Client for fetching tool schemas from MCP servers."""

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
            server_url: URL of the MCP server (SSE endpoint).
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
        Internal method to fetch tools from MCP server via SSE.

        Args:
            server_url: URL of the MCP server.
            headers: Optional headers for authentication.

        Returns:
            List of ToolSchema objects.
        """
        tools: list[ToolSchema] = []

        # Debug: log headers being sent
        logger.debug(f"Connecting to {server_url} with headers: {list(headers.keys()) if headers else 'None'}")

        # Create SSE client connection
        async with sse_client(server_url, headers=headers) as (read_stream, write_stream):
            async with ClientSession(read_stream, write_stream) as session:
                # Initialize the session
                await session.initialize()

                # Request tools list
                result = await session.list_tools()

                # Convert to ToolSchema objects
                for tool in result.tools:
                    tool_schema = ToolSchema(
                        name=tool.name,
                        description=tool.description,
                        input_schema=tool.inputSchema if hasattr(tool, "inputSchema") else None,
                    )
                    tools.append(tool_schema)

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
        results: list[ServerResult] = []

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
