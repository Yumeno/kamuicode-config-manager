#!/usr/bin/env python3
"""
MCP Tool Catalog Crawler - Entry Point

This script fetches MCP server configurations from Google Drive,
crawls each server to retrieve tool schemas, and generates a YAML catalog.

Usage:
    python main.py [--output PATH] [--max-concurrent N] [--timeout SECONDS]

Environment Variables:
    GOOGLE_API_KEY: Google Drive API key
    DRIVE_FILE_ID: Google Drive file ID for MCP config JSON
"""

import argparse
import asyncio
import logging
import os
import sys
from pathlib import Path

from dotenv import load_dotenv

from src.drive_client import DriveClient
from src.mcp_client import MCPClient
from src.yaml_generator import YAMLGenerator

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
        default=50,
        help="Maximum concurrent connections (default: 50)",
    )

    parser.add_argument(
        "--timeout",
        "-t",
        type=float,
        default=30.0,
        help="Timeout per server in seconds (default: 30.0)",
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

    return parser.parse_args()


async def main() -> int:
    """Main entry point."""
    # Load environment variables from .env file
    load_dotenv()

    args = parse_args()

    if args.verbose:
        logging.getLogger().setLevel(logging.DEBUG)

    # Validate environment variables
    drive_file_id = os.environ.get("DRIVE_FILE_ID")
    if not drive_file_id:
        logger.error("DRIVE_FILE_ID environment variable is not set")
        return 1

    api_key = os.environ.get("GOOGLE_API_KEY")
    if not api_key:
        logger.error("GOOGLE_API_KEY environment variable is not set")
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
    logger.info("Step 1: Fetching MCP configuration from Google Drive...")
    try:
        drive_client = DriveClient(api_key)
        server_configs = await drive_client.fetch_mcp_config(drive_file_id)
        logger.info(f"Found {len(server_configs)} MCP servers in configuration")
    except Exception as e:
        logger.error(f"Failed to fetch MCP config from Drive: {e}")
        return 1

    if not server_configs:
        logger.warning("No MCP servers found in configuration")
        return 0

    # Step 2: Crawl MCP servers
    logger.info(f"Step 2: Crawling {len(server_configs)} MCP servers...")
    logger.info(f"  Max concurrent: {args.max_concurrent}")
    logger.info(f"  Timeout: {args.timeout}s")

    mcp_client = MCPClient(timeout=args.timeout)

    # Prepare server list (id, url, headers)
    servers = [
        (config.id, config.url, config.headers)
        for config in server_configs
    ]

    results = await mcp_client.fetch_multiple(
        servers,
        max_concurrent=args.max_concurrent,
    )

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
