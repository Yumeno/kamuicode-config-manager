"""Google Drive client for fetching MCP configuration."""

import json
import logging
import os
from dataclasses import dataclass
from typing import Any

from google.oauth2 import service_account
from googleapiclient.discovery import build
from googleapiclient.http import MediaIoBaseDownload
import io

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
    """Client for fetching MCP configuration from Google Drive."""

    SCOPES = ["https://www.googleapis.com/auth/drive.readonly"]

    def __init__(self, credentials_path: str | None = None):
        """
        Initialize DriveClient.

        Args:
            credentials_path: Path to service account JSON key file.
                            If None, uses GOOGLE_APPLICATION_CREDENTIALS env var.
        """
        self._credentials_path = credentials_path or os.environ.get(
            "GOOGLE_APPLICATION_CREDENTIALS"
        )
        self._service = None

    def _get_service(self):
        """Get or create Google Drive service."""
        if self._service is None:
            if not self._credentials_path:
                raise ValueError(
                    "Credentials path not provided. Set GOOGLE_APPLICATION_CREDENTIALS "
                    "environment variable or pass credentials_path to constructor."
                )

            credentials = service_account.Credentials.from_service_account_file(
                self._credentials_path, scopes=self.SCOPES
            )
            self._service = build("drive", "v3", credentials=credentials)

        return self._service

    def fetch_mcp_config(self, file_id: str) -> list[MCPServerConfig]:
        """
        Fetch MCP configuration JSON from Google Drive.

        Args:
            file_id: Google Drive file ID of the MCP config JSON.

        Returns:
            List of MCPServerConfig objects.

        Raises:
            Exception: If file cannot be fetched or parsed.
        """
        logger.info(f"Fetching MCP config from Drive file: {file_id}")

        service = self._get_service()

        # Download file content
        request = service.files().get_media(fileId=file_id)
        file_buffer = io.BytesIO()
        downloader = MediaIoBaseDownload(file_buffer, request)

        done = False
        while not done:
            _, done = downloader.next_chunk()

        # Parse JSON
        file_buffer.seek(0)
        content = file_buffer.read().decode("utf-8")
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
