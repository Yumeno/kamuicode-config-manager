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
    source_name: str = ""  # Source file label for logging

    @classmethod
    def from_dict(cls, data: dict[str, Any], source_name: str = "") -> "MCPServerConfig":
        """Create MCPServerConfig from dictionary."""
        return cls(
            id=data.get("id", ""),
            url=data.get("url", ""),
            headers=data.get("headers"),
            transport=data.get("transport", "sse"),
            source_name=source_name,
        )


class DriveClient:
    """Client for fetching MCP configuration from Google Drive (public files)."""

    # Direct download URL for public files (no API key required)
    DRIVE_DOWNLOAD_URL = "https://drive.google.com/uc"

    def __init__(self):
        """Initialize DriveClient."""
        pass

    async def fetch_mcp_config(self, file_id: str) -> list[MCPServerConfig]:
        """
        Fetch MCP configuration JSON from Google Drive.

        Note: The file must be shared as "Anyone with the link can view".

        Args:
            file_id: Google Drive file ID of the MCP config JSON.

        Returns:
            List of MCPServerConfig objects.

        Raises:
            Exception: If file cannot be fetched or parsed.
        """
        logger.info(f"Fetching MCP config from Drive file: {file_id}")

        # Build URL for direct file download (public files)
        url = self.DRIVE_DOWNLOAD_URL
        params = {
            "export": "download",
            "id": file_id,
        }

        async with aiohttp.ClientSession() as session:
            async with session.get(url, params=params, allow_redirects=True) as response:
                if response.status != 200:
                    error_text = await response.text()
                    raise Exception(
                        f"Failed to fetch file from Drive: {response.status} - {error_text}"
                    )

                content = await response.text()

                # Check if we got an HTML page (usually means file is not public)
                if content.strip().startswith("<!DOCTYPE") or content.strip().startswith("<html"):
                    raise Exception(
                        "Received HTML instead of JSON. "
                        "Make sure the file is shared as 'Anyone with the link can view'."
                    )

                data = json.loads(content)

        # Extract MCP servers from the config
        servers = self._extract_servers(data)
        logger.info(f"Found {len(servers)} MCP servers in config")

        return servers

    def _extract_servers(
        self, data: dict[str, Any], source_name: str = ""
    ) -> list[MCPServerConfig]:
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
                source_name=source_name,
            )
            servers.append(server)

        return servers

    async def fetch_mcp_configs_multi(
        self, file_configs: list[dict[str, str]]
    ) -> dict[str, list[MCPServerConfig]]:
        """
        Fetch MCP configurations from multiple Drive files.

        Creates a dict mapping server_id to list of configs from different sources.
        The order of configs in the list matches the order of file_configs
        (last-one-wins priority).

        Args:
            file_configs: List of {"name": "...", "id": "..."} dicts

        Returns:
            Dict mapping server_id to list of MCPServerConfig objects
        """
        server_candidates: dict[str, list[MCPServerConfig]] = {}

        for config in file_configs:
            name = config.get("name", "Unknown")
            file_id = config.get("id", "")

            if not file_id:
                logger.warning(f"Skipping {name}: no file ID provided")
                continue

            try:
                configs = await self._fetch_mcp_config_with_source(file_id, name)
                logger.info(f"📂 Loaded {name}: {len(configs)} servers")

                for server_config in configs:
                    if server_config.id not in server_candidates:
                        server_candidates[server_config.id] = []
                    server_candidates[server_config.id].append(server_config)

            except Exception as e:
                logger.warning(f"❌ Failed to fetch {name} ({file_id}): {e}")
                continue

        total_servers = len(server_candidates)
        logger.info(f"✅ Total unique servers: {total_servers}")
        return server_candidates

    async def _fetch_mcp_config_with_source(
        self, file_id: str, source_name: str
    ) -> list[MCPServerConfig]:
        """
        Fetch MCP config from a single file with source name attached.

        Args:
            file_id: Google Drive file ID
            source_name: Label for this source

        Returns:
            List of MCPServerConfig with source_name set
        """
        logger.debug(f"Fetching MCP config from Drive file: {file_id} ({source_name})")

        url = self.DRIVE_DOWNLOAD_URL
        params = {
            "export": "download",
            "id": file_id,
        }

        async with aiohttp.ClientSession() as session:
            async with session.get(url, params=params, allow_redirects=True) as response:
                if response.status != 200:
                    error_text = await response.text()
                    raise Exception(
                        f"Failed to fetch file from Drive: {response.status} - {error_text}"
                    )

                content = await response.text()

                if content.strip().startswith("<!DOCTYPE") or content.strip().startswith("<html"):
                    raise Exception(
                        "Received HTML instead of JSON. "
                        "Make sure the file is shared as 'Anyone with the link can view'."
                    )

                data = json.loads(content)

        return self._extract_servers(data, source_name)
