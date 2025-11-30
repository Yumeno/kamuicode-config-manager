"""YAML generator for MCP tool catalog."""

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

        Note: This method does NOT include authentication information.
        Headers and other sensitive data are explicitly excluded.

        Args:
            server_results: List of ServerResult objects from MCP crawling.

        Returns:
            Dictionary representing the catalog structure.
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
        """
        Convert catalog dictionary to YAML string.

        Args:
            catalog: Catalog dictionary.

        Returns:
            YAML formatted string.
        """
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
        """
        Save catalog to YAML file.

        Args:
            catalog: Catalog dictionary.
            output_path: Path to output YAML file.
        """
        output_path = Path(output_path)
        yaml_content = self.to_yaml_string(catalog)

        output_path.write_text(yaml_content, encoding="utf-8")
        logger.info(f"Catalog saved to {output_path}")

    def load_existing_catalog(self, path: str | Path) -> dict[str, Any] | None:
        """
        Load existing catalog from YAML file.

        Args:
            path: Path to existing YAML file.

        Returns:
            Catalog dictionary or None if file doesn't exist.
        """
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

    def merge_catalogs(
        self,
        new_results: list[ServerResult],
        existing_catalog: dict[str, Any] | None,
    ) -> dict[str, Any]:
        """
        Merge new results with existing catalog.

        Strategy:
        - New servers are added
        - Existing servers are updated with new data
        - Servers not in new results are preserved (may be temporarily offline)

        Args:
            new_results: New server results from crawling.
            existing_catalog: Existing catalog data or None.

        Returns:
            Merged catalog dictionary.
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

        # Merge: prioritize new results, but keep servers that weren't crawled
        merged_servers: list[dict[str, Any]] = []

        # Add/update servers from new results
        for server_id, result in new_results_map.items():
            merged_servers.append(result.to_dict())

        # Add servers from existing catalog that weren't in new results
        # (these may be temporarily unreachable servers we want to keep)
        for server_id, server_data in existing_servers_map.items():
            if server_id not in new_results_map:
                # Mark as potentially stale
                server_data["status"] = "unknown"
                server_data["error_message"] = "Server not found in latest crawl"
                merged_servers.append(server_data)

        # Sort by ID
        merged_servers.sort(key=lambda s: s.get("id", ""))

        # Build final catalog
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
