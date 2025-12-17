#!/usr/bin/env python3
"""
MCP Tool Catalog Crawler - Entry Point

This script fetches MCP server configurations from Google Drive,
crawls each server to retrieve tool schemas, and generates a YAML catalog.

Usage:
    python main.py [--output PATH] [--max-concurrent N] [--timeout SECONDS]

Environment Variables:
    DRIVE_FOLDER_ID: (New) Google Drive folder ID for recursive scanning.
                     When set, enables automatic discovery of MCP config files.
    DRIVE_FILE_IDS: JSON array of file configs [{"name": "...", "id": "..."}, ...]
                    or comma-separated IDs for backward compatibility
    DRIVE_FILE_ID: (Legacy) Single Google Drive file ID for MCP config JSON
    GOOGLE_API_KEY: (Required for folder scan) Google API key with Drive API access

Priority: DRIVE_FILE_IDS > DRIVE_FILE_ID (explicit files take priority)
          DRIVE_FOLDER_ID configs are merged after explicit files (folder configs win on conflict)
"""

import argparse
import asyncio
import json
import logging
import os
import sys
from pathlib import Path
from typing import TypedDict

from dotenv import load_dotenv

from src.drive_client import DriveClient
from src.mcp_client import MCPClient
from src.yaml_generator import YAMLGenerator


class FileConfig(TypedDict):
    """Configuration for a single Drive file."""

    name: str
    id: str


def parse_drive_file_ids(env_value: str) -> list[FileConfig]:
    """
    Parse environment variable to list of file configs.

    Supports:
    - JSON array format: [{"name": "Label", "id": "file_id"}, ...]
    - Comma-separated IDs: "id1,id2,id3" (backward compatibility)

    Args:
        env_value: Environment variable value

    Returns:
        List of FileConfig dicts with name and id
    """
    if not env_value:
        return []

    env_value = env_value.strip()

    # Try JSON array format first
    if env_value.startswith("["):
        try:
            configs = json.loads(env_value)
            result: list[FileConfig] = []
            for i, item in enumerate(configs):
                if isinstance(item, dict):
                    result.append({
                        "name": item.get("name", f"Source_{i + 1}"),
                        "id": item.get("id", ""),
                    })
                elif isinstance(item, str):
                    result.append({"name": f"Source_{i + 1}", "id": item})
            return [c for c in result if c["id"]]
        except json.JSONDecodeError:
            pass

    # Fallback: comma-separated IDs
    ids = [id.strip() for id in env_value.split(",") if id.strip()]
    return [{"name": f"Source_{i + 1}", "id": id} for i, id in enumerate(ids)]

# Configure logging
logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s - %(name)s - %(levelname)s - %(message)s",
)
logger = logging.getLogger(__name__)


def parse_args() -> argparse.Namespace:
    """Parse command line arguments."""
    parser = argparse.ArgumentParser(
        description="MCP Tool Catalog Crawler",
        formatter_class=argparse.RawDescriptionHelpFormatter,
    )

    parser.add_argument(
        "--output",
        "-o",
        type=str,
        default=None,
        help="Output path for the catalog YAML (default: ../../mcp_tool_catalog.yaml)",
    )

    parser.add_argument(
        "--max-concurrent",
        "-c",
        type=int,
        default=10,
        help="Maximum concurrent connections (default: 10)",
    )

    parser.add_argument(
        "--timeout",
        "-t",
        type=float,
        default=60.0,
        help="Timeout per server in seconds (default: 60.0)",
    )

    parser.add_argument(
        "--delay",
        "-d",
        type=float,
        default=0.5,
        help="Delay between requests in seconds (default: 0.5)",
    )

    parser.add_argument(
        "--merge",
        "-m",
        action="store_true",
        help="Merge with existing catalog instead of replacing",
    )

    parser.add_argument(
        "--dry-run",
        action="store_true",
        help="Print catalog to stdout instead of saving to file",
    )

    parser.add_argument(
        "--verbose",
        "-v",
        action="store_true",
        help="Enable verbose logging",
    )

    parser.add_argument(
        "--limit",
        "-l",
        type=int,
        default=None,
        help="Limit number of servers to crawl (for testing)",
    )

    return parser.parse_args()


async def main() -> int:
    """Main entry point."""
    # Load environment variables from .env file
    load_dotenv()

    args = parse_args()

    if args.verbose:
        logging.getLogger().setLevel(logging.DEBUG)

    # Parse file configs from environment variables
    # Priority: DRIVE_FILE_IDS (new) > DRIVE_FILE_ID (legacy)
    file_configs = parse_drive_file_ids(os.environ.get("DRIVE_FILE_IDS", ""))

    # Fallback to legacy single ID
    if not file_configs:
        legacy_id = os.environ.get("DRIVE_FILE_ID")
        if legacy_id:
            file_configs = [{"name": "Default", "id": legacy_id.strip()}]

    # Check for folder scan mode
    folder_id = os.environ.get("DRIVE_FOLDER_ID", "").strip()
    google_api_key = os.environ.get("GOOGLE_API_KEY", "").strip()

    if folder_id and not google_api_key:
        logger.error("GOOGLE_API_KEY is required when using DRIVE_FOLDER_ID")
        return 1

    if not file_configs and not folder_id:
        logger.error("Either DRIVE_FILE_IDS/DRIVE_FILE_ID or DRIVE_FOLDER_ID must be set")
        return 1

    # Determine output path
    if args.output:
        output_path = Path(args.output)
    else:
        # Default: repository root / mcp_tool_catalog.yaml
        script_dir = Path(__file__).parent
        output_path = script_dir.parent.parent / "mcp_tool_catalog.yaml"

    logger.info("=" * 60)
    logger.info("MCP Tool Catalog Crawler")
    logger.info("=" * 60)

    # Step 1: Fetch MCP config from Google Drive
    drive_client = DriveClient()
    server_candidates: dict[str, list] = {}

    # Step 1a: Fetch from explicit file IDs (if any)
    if file_configs:
        logger.info(f"Step 1a: Fetching MCP configuration from {len(file_configs)} explicit file(s)...")
        try:
            file_candidates = await drive_client.fetch_mcp_configs_multi(file_configs)
            # Merge into server_candidates
            for server_id, configs in file_candidates.items():
                if server_id not in server_candidates:
                    server_candidates[server_id] = []
                server_candidates[server_id].extend(configs)
        except Exception as e:
            logger.error(f"Failed to fetch MCP config from explicit files: {e}")
            return 1

    # Step 1b: Fetch from folder scan (if enabled)
    if folder_id:
        logger.info(f"Step 1b: Scanning folder recursively: {folder_id}")
        try:
            folder_candidates = await drive_client.fetch_mcp_configs_from_folder(
                folder_id, google_api_key
            )
            # Merge into server_candidates (folder configs appended, so they take priority)
            for server_id, configs in folder_candidates.items():
                if server_id not in server_candidates:
                    server_candidates[server_id] = []
                server_candidates[server_id].extend(configs)
        except Exception as e:
            logger.error(f"Failed to scan folder: {e}")
            return 1

    if not server_candidates:
        logger.warning("No MCP servers found in configuration")
        return 0

    # Apply limit if specified
    server_ids = list(server_candidates.keys())
    if args.limit is not None:
        server_ids = server_ids[:args.limit]
        logger.info(f"Limited to first {len(server_ids)} server(s) for testing")

    # Step 2: Crawl MCP servers with fallback support
    logger.info(f"Step 2: Crawling {len(server_ids)} MCP servers...")
    logger.info(f"  Max concurrent: {args.max_concurrent}")
    logger.info(f"  Timeout: {args.timeout}s")
    logger.info(f"  Delay: {args.delay}s")

    mcp_client = MCPClient(timeout=args.timeout, delay=args.delay)
    semaphore = asyncio.Semaphore(args.max_concurrent)

    async def process_server_with_limit(
        server_id: str, candidates: list
    ) -> "ServerResult":
        async with semaphore:
            result = await mcp_client.fetch_tools_with_fallback(server_id, candidates)
            if mcp_client.delay > 0:
                await asyncio.sleep(mcp_client.delay)
            return result

    # Create tasks for parallel execution
    tasks = [
        process_server_with_limit(server_id, server_candidates[server_id])
        for server_id in server_ids
    ]

    # Execute with fallback
    from datetime import datetime, timezone
    from src.mcp_client import ServerResult

    raw_results = await asyncio.gather(*tasks, return_exceptions=True)

    # Process results and handle exceptions
    results: list[ServerResult] = []
    for i, result in enumerate(raw_results):
        if isinstance(result, Exception):
            server_id = server_ids[i]
            results.append(
                ServerResult(
                    id=server_id,
                    url="(multiple sources)",
                    status="error",
                    last_checked=datetime.now(timezone.utc).isoformat(),
                    error_message=str(result),
                )
            )
        else:
            results.append(result)

    # Log summary
    online = sum(1 for r in results if r.status == "online")
    offline = sum(1 for r in results if r.status == "offline")
    errors = sum(1 for r in results if r.status == "error")
    total_tools = sum(len(r.tools) for r in results)

    logger.info("Crawling complete:")
    logger.info(f"  Online:  {online}")
    logger.info(f"  Offline: {offline}")
    logger.info(f"  Errors:  {errors}")
    logger.info(f"  Total tools discovered: {total_tools}")

    # Step 3: Generate YAML catalog
    logger.info("Step 3: Generating YAML catalog...")
    yaml_generator = YAMLGenerator()

    if args.merge:
        existing_catalog = yaml_generator.load_existing_catalog(output_path)
        catalog = yaml_generator.merge_catalogs(results, existing_catalog)
    else:
        catalog = yaml_generator.generate_catalog(results)

    # Step 4: Output
    if args.dry_run:
        logger.info("Dry run - printing catalog to stdout:")
        print(yaml_generator.to_yaml_string(catalog))
    else:
        yaml_generator.save_catalog(catalog, output_path)
        logger.info(f"Catalog saved to: {output_path}")

    logger.info("=" * 60)
    logger.info("Done!")
    logger.info("=" * 60)

    return 0


if __name__ == "__main__":
    sys.exit(asyncio.run(main()))
