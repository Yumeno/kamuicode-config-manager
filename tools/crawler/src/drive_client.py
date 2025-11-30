"""Google Drive client for fetching MCP configuration."""

import json
import logging
import os
from dataclasses import dataclass
from typing import Any

import aiohttp

logger = logging.getLogger(__name__)


@dataclass
class MCPServerConfig:
    """MCP server configuration from Drive JSON."""

    id: str
    url: str
    headers: dict[str, str] | None = None
    transport: str = "sse"

    @classmethod
    def from_dict(cls, data: dict[str, Any]) -> "MCPServerConfig":
        """Create MCPServerConfig from dictionary."""
        return cls(
            id=data.get("id", ""),
            url=data.get("url", ""),
            headers=data.get("headers"),
            transport=data.get("transport", "sse"),
        )


class DriveClient:
    """Client for fetching MCP configuration from Google Drive (API Key auth)."""

    DRIVE_API_URL = "https://www.googleapis.com/drive/v3/files"

    def __init__(self, api_key: str | None = None):
        """
        Initialize DriveClient.

        Args:
            api_key: Google Drive API key.
                     If None, uses GOOGLE_API_KEY env var.
        """
        self._api_key = api_key or os.environ.get("GOOGLE_API_KEY")

    async def fetch_mcp_config(self, file_id: str) -> list[MCPServerConfig]:
        """
        Fetch MCP configuration JSON from Google Drive.

        Args:
            file_id: Google Drive file ID of the MCP config JSON.

        Returns:
            List of MCPServerConfig objects.

        Raises:
            Exception: If file cannot be fetched or parsed.
        """
        if not self._api_key:
            raise ValueError(
                "API key not provided. Set GOOGLE_API_KEY environment variable "
                "or pass api_key to constructor."
            )

        logger.info(f"Fetching MCP config from Drive file: {file_id}")

        # Build URL for file download
        url = f"{self.DRIVE_API_URL}/{file_id}"
        params = {
            "alt": "media",
            "key": self._api_key,
        }

        async with aiohttp.ClientSession() as session:
            async with session.get(url, params=params) as response:
                if response.status != 200:
                    error_text = await response.text()
                    raise Exception(
                        f"Failed to fetch file from Drive: {response.status} - {error_text}"
                    )

                content = await response.text()
                data = json.loads(content)

        # Extract MCP servers from the config
        servers = self._extract_servers(data)
        logger.info(f"Found {len(servers)} MCP servers in config")

        return servers

    def _extract_servers(self, data: dict[str, Any]) -> list[MCPServerConfig]:
        """
        Extract MCP server configurations from the JSON data.

        The JSON structure is expected to be Claude Desktop MCP config format:
        {
            "mcpServers": {
                "server-id": {
                    "url": "https://...",
                    "transport": "sse",
                    "headers": {...}
                },
                ...
            }
        }
        """
        servers = []

        mcp_servers = data.get("mcpServers", {})

        for server_id, server_config in mcp_servers.items():
            if not isinstance(server_config, dict):
                logger.warning(f"Skipping invalid server config for {server_id}")
                continue

            url = server_config.get("url", "")
            if not url:
                logger.warning(f"Skipping server {server_id}: no URL provided")
                continue

            server = MCPServerConfig(
                id=server_id,
                url=url,
                headers=server_config.get("headers"),
                transport=server_config.get("transport", "sse"),
            )
            servers.append(server)

        return servers
