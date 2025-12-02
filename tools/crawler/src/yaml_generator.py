"""YAML generator for MCP tool catalog."""

import json
import logging
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

import yaml

from .mcp_client import ServerResult

logger = logging.getLogger(__name__)


class YAMLGenerator:
    """Generator for MCP tool catalog YAML files."""

    def __init__(self):
        """Initialize YAMLGenerator."""
        pass

    def generate_catalog(
        self,
        server_results: list[ServerResult],
    ) -> dict[str, Any]:
        """
        Generate catalog data from server results.
        """
        # Sort servers by ID for consistent output
        sorted_results = sorted(server_results, key=lambda r: r.id)

        catalog: dict[str, Any] = {
            "metadata": {
                "generated_at": datetime.now(timezone.utc).isoformat(),
                "total_servers": len(sorted_results),
                "online_servers": sum(1 for r in sorted_results if r.status == "online"),
                "offline_servers": sum(1 for r in sorted_results if r.status == "offline"),
                "error_servers": sum(1 for r in sorted_results if r.status == "error"),
            },
            "servers": [result.to_dict() for result in sorted_results],
        }

        return catalog

    def to_yaml_string(self, catalog: dict[str, Any]) -> str:
        """Convert catalog dictionary to YAML string."""
        # Custom representer for cleaner output
        def str_representer(dumper: yaml.Dumper, data: str) -> yaml.ScalarNode:
            if "\n" in data:
                return dumper.represent_scalar("tag:yaml.org,2002:str", data, style="|")
            return dumper.represent_scalar("tag:yaml.org,2002:str", data)

        yaml.add_representer(str, str_representer)

        return yaml.dump(
            catalog,
            default_flow_style=False,
            allow_unicode=True,
            sort_keys=False,
            width=120,
        )

    def save_catalog(
        self,
        catalog: dict[str, Any],
        output_path: str | Path,
    ) -> None:
        """Save catalog to YAML file."""
        output_path = Path(output_path)
        yaml_content = self.to_yaml_string(catalog)

        output_path.write_text(yaml_content, encoding="utf-8")
        logger.info(f"Catalog saved to {output_path}")

    def load_existing_catalog(self, path: str | Path) -> dict[str, Any] | None:
        """Load existing catalog from YAML file."""
        path = Path(path)

        if not path.exists():
            logger.info(f"No existing catalog found at {path}")
            return None

        try:
            content = path.read_text(encoding="utf-8")
            catalog = yaml.safe_load(content)
            logger.info(f"Loaded existing catalog from {path}")
            return catalog
        except Exception as e:
            logger.error(f"Failed to load existing catalog: {e}")
            return None

    def _is_content_changed(self, old_server: dict[str, Any], new_server: dict[str, Any]) -> bool:
        """
        Check if the meaningful content (URL or tools) has changed.
        Ignores status, last_checked, and error_message.
        """
        # 1. URL Check
        if old_server.get("url") != new_server.get("url"):
            return True

        # 2. Tools Check (Deep comparison using JSON serialization for stability)
        # Normalize tools list by sorting to ensure order doesn't affect comparison
        old_tools = sorted(old_server.get("tools", []), key=lambda x: x.get("name", ""))
        new_tools = sorted(new_server.get("tools", []), key=lambda x: x.get("name", ""))

        # Use JSON dump to compare deep structures (inputSchema etc.) ignoring specific formatting
        return json.dumps(old_tools, sort_keys=True) != json.dumps(new_tools, sort_keys=True)

    def merge_catalogs(
        self,
        new_results: list[ServerResult],
        existing_catalog: dict[str, Any] | None,
    ) -> dict[str, Any]:
        """
        Merge new results with existing catalog.
        
        Logic:
        - Only updates entry if 'tools' or 'url' actually changed.
        - Preserves 'last_checked' timestamp if no content change occurred.
        - If the new result is offline/error, keeps the old entry (prevents wiping tool definitions).
        - If absolutely no changes across all servers, preserves the original 'generated_at'.
        """
        if existing_catalog is None:
            return self.generate_catalog(new_results)

        # Build lookup maps
        new_results_map = {r.id: r for r in new_results}
        existing_servers_map: dict[str, dict[str, Any]] = {}

        if "servers" in existing_catalog:
            for server in existing_catalog["servers"]:
                server_id = server.get("id", "")
                if server_id:
                    existing_servers_map[server_id] = server

        merged_servers: list[dict[str, Any]] = []
        has_any_change = False

        # 1. Process all new results (updates or new entries)
        for server_id, new_result_obj in new_results_map.items():
            new_server_data = new_result_obj.to_dict()
            existing_server_data = existing_servers_map.get(server_id)

            if existing_server_data:
                # Case A: Server exists in previous catalog
                
                # Check 1: If new result is Offline/Error, don't overwrite valid existing data
                if new_result_obj.status != "online":
                    logger.info(f"Server {server_id} is {new_result_obj.status}. Keeping existing entry.")
                    merged_servers.append(existing_server_data)
                    continue

                # Check 2: If Online, check if content actually changed
                if self._is_content_changed(existing_server_data, new_server_data):
                    logger.info(f"Server {server_id} content changed. Updating.")
                    merged_servers.append(new_server_data)
                    has_any_change = True
                else:
                    # No content change -> Keep OLD entry (preserves old last_checked)
                    # logger.debug(f"Server {server_id} unchanged. Keeping existing entry.")
                    merged_servers.append(existing_server_data)
            else:
                # Case B: New server found
                logger.info(f"New server found: {server_id}")
                merged_servers.append(new_server_data)
                has_any_change = True

        # 2. Add servers from existing catalog that weren't in new results
        # (e.g. removed from Drive config, or temporary network partition?)
        # Current logic: If not in Drive config (new_results), we assume it should be removed?
        # Or should we keep them? 
        # Usually, if it's removed from Drive config, it should be removed from Catalog.
        # But `drive_client` fetches only what's in Drive.
        # Let's assume: If it's not in new_results (Drive), it is REMOVED.
        
        # Check for removed servers to set has_any_change flag correctly
        for existing_id in existing_servers_map:
            if existing_id not in new_results_map:
                logger.info(f"Server removed (not in Drive config): {existing_id}")
                has_any_change = True

        # Sort by ID
        merged_servers.sort(key=lambda s: s.get("id", ""))

        # 3. Final Decision: Did anything change?
        if not has_any_change:
            logger.info("No content changes detected. Preserving existing catalog metadata.")
            return existing_catalog

        # If changed, generate new metadata
        online_count = sum(1 for s in merged_servers if s.get("status") == "online")
        offline_count = sum(1 for s in merged_servers if s.get("status") == "offline")
        error_count = sum(1 for s in merged_servers if s.get("status") in ("error", "unknown"))

        return {
            "metadata": {
                "generated_at": datetime.now(timezone.utc).isoformat(),
                "total_servers": len(merged_servers),
                "online_servers": online_count,
                "offline_servers": offline_count,
                "error_servers": error_count,
            },
            "servers": merged_servers,
        }
