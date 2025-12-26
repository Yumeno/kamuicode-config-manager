"""Google Drive client for fetching MCP configuration."""

import json
import logging
import os
import re
from dataclasses import dataclass, field
from datetime import datetime
from typing import Any

import aiohttp

logger = logging.getLogger(__name__)


def expand_env_placeholders(value: str) -> str:
    """
    Expand environment variable placeholders in a string.

    Supports ${VAR_NAME} syntax.
    If the environment variable is not set, the placeholder is left unchanged.

    Args:
        value: String potentially containing ${VAR_NAME} placeholders

    Returns:
        String with placeholders replaced by environment variable values
    """
    if not value or not isinstance(value, str):
        return value

    def replace_match(match: re.Match) -> str:
        var_name = match.group(1)
        env_value = os.environ.get(var_name)
        if env_value is not None:
            return env_value
        # If not set, return original placeholder
        return match.group(0)

    # Match ${VAR_NAME} pattern
    pattern = r'\$\{([A-Za-z_][A-Za-z0-9_]*)\}'
    return re.sub(pattern, replace_match, value)


def expand_headers(headers: dict[str, str] | None) -> dict[str, str] | None:
    """
    Expand environment variable placeholders in header values.

    Processing:
    1. Expand ${VAR} placeholders with environment variable values
    2. Override KAMUI-CODE-PASS header with KAMUI_CODE_PASS_KEY env var
       (even if the value is not a placeholder)

    Args:
        headers: Dictionary of header key-value pairs

    Returns:
        Dictionary with expanded values, or None if input is None
    """
    if headers is None:
        return None

    expanded = {}
    for key, value in headers.items():
        # First expand placeholders
        expanded_value = expand_env_placeholders(value)

        # Override KAMUI-CODE-PASS with env var value
        if key.upper() == "KAMUI-CODE-PASS":
            env_passkey = os.environ.get("KAMUI_CODE_PASS_KEY")
            if env_passkey:
                expanded_value = env_passkey

        expanded[key] = expanded_value
    return expanded


def ensure_kamui_pass_header(headers: dict[str, str] | None) -> dict[str, str]:
    """
    Ensure KAMUI-CODE-PASS header exists if KAMUI_CODE_PASS_KEY env var is set.

    Processing:
    1. Create headers dict if None
    2. Add KAMUI-CODE-PASS header if not present and env var is set

    Args:
        headers: Dictionary of header key-value pairs (may be None)

    Returns:
        Dictionary with KAMUI-CODE-PASS header ensured
    """
    if headers is None:
        headers = {}

    env_passkey = os.environ.get("KAMUI_CODE_PASS_KEY")
    if env_passkey:
        # Check if KAMUI-CODE-PASS already exists (case-insensitive)
        has_kamui_pass = any(k.upper() == "KAMUI-CODE-PASS" for k in headers.keys())
        if not has_kamui_pass:
            headers["KAMUI-CODE-PASS"] = env_passkey

    return headers

# Default minimum modified time for folder scan filtering (2025-11-20)
DEFAULT_MIN_MODIFIED_TIME = "2025-11-20T00:00:00"


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
        # Expand environment variable placeholders in headers
        raw_headers = data.get("headers")
        expanded_headers = expand_headers(raw_headers)
        # Ensure KAMUI-CODE-PASS header exists if env var is set
        final_headers = ensure_kamui_pass_header(expanded_headers)
        return cls(
            id=data.get("id", ""),
            url=data.get("url", ""),
            headers=final_headers if final_headers else None,
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

            # Expand environment variable placeholders in headers
            raw_headers = server_config.get("headers")
            expanded_headers = expand_headers(raw_headers)
            # Ensure KAMUI-CODE-PASS header exists if env var is set
            final_headers = ensure_kamui_pass_header(expanded_headers)

            # Debug: Log header expansion for troubleshooting
            if final_headers:
                for k, v in final_headers.items():
                    if k.upper() == "KAMUI-CODE-PASS":
                        if v and len(v) > 8:
                            masked = f"{v[:4]}...{v[-4:]} (len={len(v)})"
                        else:
                            masked = f"*** (len={len(v) if v else 0})"
                        logger.info(f"[{server_id}] Header {k}: {masked}")

            server = MCPServerConfig(
                id=server_id,
                url=url,
                headers=final_headers if final_headers else None,
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

    async def fetch_mcp_configs_from_folder(
        self,
        root_folder_id: str,
        api_key: str,
        min_modified_time: str | None = None,
    ) -> dict[str, list[MCPServerConfig]]:
        """
        Recursively scan a Google Drive folder and fetch MCP configs from all valid JSON files.

        Filtering conditions:
        1. Modified after min_modified_time (default: 2025-11-20)
        2. File extension is .json
        3. Has valid mcpServers key in root

        Args:
            root_folder_id: Google Drive folder ID to scan
            api_key: Google API key for Drive API access
            min_modified_time: ISO format datetime string (default: 2025-11-20T00:00:00)

        Returns:
            Dict mapping server_id to list of MCPServerConfig objects
        """
        if min_modified_time is None:
            min_modified_time = DEFAULT_MIN_MODIFIED_TIME

        logger.info(f"🔍 Starting recursive folder scan: {root_folder_id}")
        logger.info(f"📅 Filtering files modified after: {min_modified_time}")

        # Step 1: Recursively scan for candidate files
        found_files = await self._scan_folder_recursive(
            root_folder_id, api_key, min_modified_time
        )

        logger.info(f"📁 Found {len(found_files)} candidate JSON file(s)")

        # Step 2: Fetch and validate each file
        server_candidates: dict[str, list[MCPServerConfig]] = {}
        valid_count = 0

        for file_item in found_files:
            file_id = file_item["id"]
            file_name = file_item["name"]
            file_path = file_item.get("path", file_name)

            try:
                # Download and parse the file
                configs = await self._fetch_and_validate_mcp_file(
                    file_id, f"Auto:{file_path}"
                )

                if configs:
                    valid_count += 1
                    logger.info(f"✅ Valid: {file_path} ({len(configs)} servers)")

                    for server_config in configs:
                        if server_config.id not in server_candidates:
                            server_candidates[server_config.id] = []
                        server_candidates[server_config.id].append(server_config)
                else:
                    logger.debug(f"⏭️ Skipped (no mcpServers): {file_path}")

            except Exception as e:
                logger.warning(f"⚠️ Skipped invalid file {file_path}: {e}")
                continue

        total_servers = len(server_candidates)
        logger.info(f"✅ Folder scan complete: {valid_count} valid files, {total_servers} unique servers")
        return server_candidates

    async def _scan_folder_recursive(
        self,
        folder_id: str,
        api_key: str,
        min_modified_time: str,
        current_path: str = "",
    ) -> list[dict[str, Any]]:
        """
        Recursively scan a Google Drive folder for candidate JSON files.

        Uses Drive API v3 with query parameters to filter:
        - Files with .json extension modified after min_modified_time
        - Subfolders for recursive traversal

        Args:
            folder_id: Google Drive folder ID to scan
            api_key: Google API key
            min_modified_time: ISO format datetime string for filtering
            current_path: Current folder path for logging

        Returns:
            List of file metadata dicts with id, name, mimeType, modifiedTime, path
        """
        results: list[dict[str, Any]] = []

        # Drive API v3 endpoint
        url = "https://www.googleapis.com/drive/v3/files"

        # Query: Items in this folder that are either:
        # - Folders (for recursion)
        # - JSON files modified after the threshold
        query = (
            f"'{folder_id}' in parents and trashed = false and ("
            f"mimeType = 'application/vnd.google-apps.folder' or "
            f"(name contains '.json' and modifiedTime >= '{min_modified_time}')"
            f")"
        )

        params = {
            "q": query,
            "key": api_key,
            "fields": "nextPageToken, files(id, name, mimeType, modifiedTime)",
            "pageSize": 1000,
        }

        async with aiohttp.ClientSession() as session:
            page_token = None

            while True:
                if page_token:
                    params["pageToken"] = page_token

                async with session.get(url, params=params) as response:
                    if response.status != 200:
                        error_text = await response.text()
                        raise Exception(
                            f"Drive API error: {response.status} - {error_text}"
                        )

                    data = await response.json()

                files = data.get("files", [])

                for item in files:
                    item_name = item["name"]
                    item_path = f"{current_path}/{item_name}" if current_path else item_name
                    item["path"] = item_path

                    if item["mimeType"] == "application/vnd.google-apps.folder":
                        # Recurse into subfolder
                        logger.debug(f"📂 Entering folder: {item_path}")
                        sub_results = await self._scan_folder_recursive(
                            item["id"], api_key, min_modified_time, item_path
                        )
                        results.extend(sub_results)
                    else:
                        # JSON file candidate
                        results.append(item)

                page_token = data.get("nextPageToken")
                if not page_token:
                    break

        return results

    async def _fetch_and_validate_mcp_file(
        self, file_id: str, source_name: str
    ) -> list[MCPServerConfig]:
        """
        Fetch a file from Drive and validate it has mcpServers structure.

        Validation criteria:
        - Root object is a dict
        - Has 'mcpServers' key
        - 'mcpServers' value is a dict

        Args:
            file_id: Google Drive file ID
            source_name: Label for this source

        Returns:
            List of MCPServerConfig if valid, empty list otherwise
        """
        logger.debug(f"Fetching and validating: {file_id} ({source_name})")

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

                # Check if we got HTML instead of JSON
                if content.strip().startswith("<!DOCTYPE") or content.strip().startswith("<html"):
                    raise Exception(
                        "Received HTML instead of JSON. "
                        "Make sure the file is shared as 'Anyone with the link can view'."
                    )

                data = json.loads(content)

        # Validate mcpServers structure
        if not isinstance(data, dict):
            logger.debug(f"Invalid structure: root is not an object")
            return []

        mcp_servers = data.get("mcpServers")
        if mcp_servers is None:
            logger.debug(f"Invalid structure: no mcpServers key")
            return []

        if not isinstance(mcp_servers, dict):
            logger.debug(f"Invalid structure: mcpServers is not an object")
            return []

        return self._extract_servers(data, source_name)
