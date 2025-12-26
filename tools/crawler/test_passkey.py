#!/usr/bin/env python3
"""
Passkey Local Testing Tool

ローカル環境でパスキー設定をテストするためのツール。
GitHub Actions で動作しない問題をデバッグするために使用します。

使い方:
    # 環境変数展開のテスト
    python test_passkey.py --test-expand

    # ローカルJSONファイルからテスト（推奨）
    KAMUI_CODE_PASS_KEY=your-passkey python test_passkey.py --config ./mcp_config.json

    # ローカルJSONファイルからテスト（特定サーバーのみ）
    python test_passkey.py --config ./mcp_config.json --server my-server-id

    # MCP サーバー接続テスト（環境変数から）
    KAMUI_CODE_PASS_KEY=your-passkey python test_passkey.py --server-url https://example.com/mcp

    # MCP サーバー接続テスト（直接指定）
    python test_passkey.py --server-url https://example.com/mcp --passkey your-passkey

    # 詳細デバッグモード
    python test_passkey.py --server-url https://example.com/mcp --passkey your-passkey --verbose

    # ドライランモード（接続せずにヘッダーを確認）
    python test_passkey.py --server-url https://example.com/mcp --passkey your-passkey --dry-run
"""

import argparse
import asyncio
import json
import logging
import os
import re
import sys
from dataclasses import dataclass
from datetime import datetime, timezone

import aiohttp
from dotenv import load_dotenv

# カラー出力用のANSIコード
class Colors:
    GREEN = "\033[92m"
    RED = "\033[91m"
    YELLOW = "\033[93m"
    BLUE = "\033[94m"
    CYAN = "\033[96m"
    RESET = "\033[0m"
    BOLD = "\033[1m"


def print_header(text: str) -> None:
    """セクションヘッダーを表示"""
    print(f"\n{Colors.BOLD}{Colors.BLUE}{'=' * 60}{Colors.RESET}")
    print(f"{Colors.BOLD}{Colors.BLUE}{text}{Colors.RESET}")
    print(f"{Colors.BOLD}{Colors.BLUE}{'=' * 60}{Colors.RESET}\n")


def print_success(text: str) -> None:
    """成功メッセージを表示"""
    print(f"{Colors.GREEN}✅ {text}{Colors.RESET}")


def print_error(text: str) -> None:
    """エラーメッセージを表示"""
    print(f"{Colors.RED}❌ {text}{Colors.RESET}")


def print_warning(text: str) -> None:
    """警告メッセージを表示"""
    print(f"{Colors.YELLOW}⚠️  {text}{Colors.RESET}")


def print_info(text: str) -> None:
    """情報メッセージを表示"""
    print(f"{Colors.CYAN}ℹ️  {text}{Colors.RESET}")


def mask_passkey(value: str, show_chars: int = 4) -> str:
    """パスキーをマスクして表示（セキュリティ対策）"""
    if not value:
        return "(empty)"
    if len(value) <= show_chars * 2:
        return "*" * len(value)
    return f"{value[:show_chars]}{'*' * (len(value) - show_chars * 2)}{value[-show_chars:]}"


# ======================================================================
# 環境変数展開機能（drive_client.py からコピー）
# ======================================================================

def expand_env_placeholders(value: str) -> str:
    """
    Expand environment variable placeholders in a string.
    Supports ${VAR_NAME} syntax.
    """
    if not value or not isinstance(value, str):
        return value

    def replace_match(match: re.Match) -> str:
        var_name = match.group(1)
        env_value = os.environ.get(var_name)
        if env_value is not None:
            return env_value
        return match.group(0)

    pattern = r'\$\{([A-Za-z_][A-Za-z0-9_]*)\}'
    return re.sub(pattern, replace_match, value)


def expand_headers(headers: dict[str, str] | None) -> dict[str, str] | None:
    """Expand environment variable placeholders in header values."""
    if headers is None:
        return None

    expanded = {}
    for key, value in headers.items():
        expanded[key] = expand_env_placeholders(value)
    return expanded


# ======================================================================
# テスト機能
# ======================================================================

def test_env_expansion() -> bool:
    """環境変数展開機能のテスト"""
    print_header("環境変数展開テスト")

    all_passed = True

    # テストケース1: KAMUI_CODE_PASS_KEY が設定されている場合
    print_info("テストケース 1: KAMUI_CODE_PASS_KEY 環境変数")
    env_value = os.environ.get("KAMUI_CODE_PASS_KEY")

    if env_value:
        print_success(f"KAMUI_CODE_PASS_KEY が設定されています: {mask_passkey(env_value)}")

        # 展開テスト
        test_input = "${KAMUI_CODE_PASS_KEY}"
        result = expand_env_placeholders(test_input)

        if result == env_value:
            print_success(f"プレースホルダー展開: OK")
            print(f"   入力: {test_input}")
            print(f"   出力: {mask_passkey(result)}")
        else:
            print_error(f"プレースホルダー展開: NG")
            print(f"   入力: {test_input}")
            print(f"   期待値: {mask_passkey(env_value)}")
            print(f"   実際値: {mask_passkey(result)}")
            all_passed = False
    else:
        print_warning("KAMUI_CODE_PASS_KEY が設定されていません")

        # 未設定時の動作テスト
        test_input = "${KAMUI_CODE_PASS_KEY}"
        result = expand_env_placeholders(test_input)

        if result == test_input:
            print_success("未設定時はプレースホルダーがそのまま残る: OK")
        else:
            print_error("未設定時の動作が異常")
            all_passed = False

    # テストケース2: ヘッダー展開
    print()
    print_info("テストケース 2: ヘッダー展開")

    test_headers = {
        "KAMUI-CODE-PASS": "${KAMUI_CODE_PASS_KEY}",
        "Content-Type": "application/json",
        "X-Custom": "static-value",
    }

    expanded = expand_headers(test_headers)
    print("   入力ヘッダー:")
    for k, v in test_headers.items():
        print(f"     {k}: {v}")

    print("   展開後ヘッダー:")
    for k, v in expanded.items():
        display_v = mask_passkey(v) if k == "KAMUI-CODE-PASS" else v
        print(f"     {k}: {display_v}")

    # 静的な値が変更されていないことを確認
    if expanded["Content-Type"] == "application/json" and expanded["X-Custom"] == "static-value":
        print_success("静的ヘッダー値は変更されていない: OK")
    else:
        print_error("静的ヘッダー値が変更されている")
        all_passed = False

    # テストケース3: 複数の環境変数
    print()
    print_info("テストケース 3: 複数の環境変数パターン")

    # テスト用に一時的な環境変数を設定
    os.environ["TEST_VAR_A"] = "value_a"
    os.environ["TEST_VAR_B"] = "value_b"

    test_string = "prefix_${TEST_VAR_A}_middle_${TEST_VAR_B}_suffix"
    expected = "prefix_value_a_middle_value_b_suffix"
    result = expand_env_placeholders(test_string)

    if result == expected:
        print_success("複数環境変数の展開: OK")
    else:
        print_error(f"複数環境変数の展開: NG (期待: {expected}, 実際: {result})")
        all_passed = False

    # クリーンアップ
    del os.environ["TEST_VAR_A"]
    del os.environ["TEST_VAR_B"]

    return all_passed


@dataclass
class ConnectionTestResult:
    """接続テスト結果"""
    success: bool
    status_code: int | None = None
    response_body: str | None = None
    error_message: str | None = None
    headers_sent: dict[str, str] | None = None
    session_id: str | None = None
    tools_count: int = 0


async def test_mcp_connection(
    server_url: str,
    passkey: str | None = None,
    timeout: float = 30.0,
    verbose: bool = False,
    dry_run: bool = False,
    custom_headers: dict[str, str] | None = None,
) -> ConnectionTestResult:
    """MCP サーバー接続テスト"""

    # ヘッダーの構築
    headers = {"Content-Type": "application/json"}

    # カスタムヘッダーが指定されている場合はそれを使用
    if custom_headers:
        headers.update(custom_headers)
    elif passkey:
        headers["KAMUI-CODE-PASS"] = passkey
    else:
        # 環境変数から取得
        env_passkey = os.environ.get("KAMUI_CODE_PASS_KEY")
        if env_passkey:
            headers["KAMUI-CODE-PASS"] = env_passkey

    # ドライランモード
    if dry_run:
        print_info("ドライランモード - 実際の接続は行いません")
        print()
        print("送信予定のヘッダー:")
        for k, v in headers.items():
            display_v = mask_passkey(v) if k == "KAMUI-CODE-PASS" else v
            print(f"  {k}: {display_v}")
        print()
        print(f"接続先URL: {server_url}")
        return ConnectionTestResult(
            success=True,
            headers_sent=headers,
        )

    # 実際の接続テスト
    print_info(f"接続テスト開始: {server_url}")

    if verbose:
        print()
        print("送信ヘッダー:")
        for k, v in headers.items():
            display_v = mask_passkey(v) if k == "KAMUI-CODE-PASS" else v
            print(f"  {k}: {display_v}")
        print()

    try:
        async with aiohttp.ClientSession() as session:
            # Step 1: Initialize
            init_payload = {
                "jsonrpc": "2.0",
                "id": 1,
                "method": "initialize",
                "params": {
                    "protocolVersion": "2024-11-05",
                    "capabilities": {},
                    "clientInfo": {"name": "passkey-tester", "version": "1.0.0"},
                },
            }

            if verbose:
                print_info("Step 1: Initialize リクエスト送信...")
                print(f"  Payload: {json.dumps(init_payload, indent=2)}")

            async with session.post(
                server_url,
                json=init_payload,
                headers=headers,
                timeout=aiohttp.ClientTimeout(total=timeout),
            ) as response:
                status_code = response.status
                response_text = await response.text()

                if verbose:
                    print(f"  Response Status: {status_code}")
                    print(f"  Response Headers: {dict(response.headers)}")
                    print(f"  Response Body: {response_text[:500]}...")

                if status_code != 200:
                    return ConnectionTestResult(
                        success=False,
                        status_code=status_code,
                        response_body=response_text,
                        error_message=f"Initialize failed: HTTP {status_code}",
                        headers_sent=headers,
                    )

                init_result = json.loads(response_text)

                if "error" in init_result:
                    error_info = init_result["error"]
                    return ConnectionTestResult(
                        success=False,
                        status_code=status_code,
                        response_body=response_text,
                        error_message=f"Initialize error: {error_info}",
                        headers_sent=headers,
                    )

                # セッションID取得
                session_id = response.headers.get("Mcp-Session-Id")
                if session_id:
                    headers["Mcp-Session-Id"] = session_id
                    if verbose:
                        print_success(f"Session ID 取得: {session_id}")

            # Step 2: tools/list
            tools_payload = {
                "jsonrpc": "2.0",
                "id": 2,
                "method": "tools/list",
                "params": {},
            }

            if verbose:
                print()
                print_info("Step 2: tools/list リクエスト送信...")

            async with session.post(
                server_url,
                json=tools_payload,
                headers=headers,
                timeout=aiohttp.ClientTimeout(total=timeout),
            ) as response:
                status_code = response.status
                response_text = await response.text()

                if verbose:
                    print(f"  Response Status: {status_code}")
                    print(f"  Response Body: {response_text[:500]}...")

                if status_code != 200:
                    return ConnectionTestResult(
                        success=False,
                        status_code=status_code,
                        response_body=response_text,
                        error_message=f"tools/list failed: HTTP {status_code}",
                        headers_sent=headers,
                        session_id=session_id,
                    )

                tools_result = json.loads(response_text)

                if "error" in tools_result:
                    error_info = tools_result["error"]
                    return ConnectionTestResult(
                        success=False,
                        status_code=status_code,
                        response_body=response_text,
                        error_message=f"tools/list error: {error_info}",
                        headers_sent=headers,
                        session_id=session_id,
                    )

                # ツール数をカウント
                result_data = tools_result.get("result", {})
                tools = result_data.get("tools", [])

                return ConnectionTestResult(
                    success=True,
                    status_code=status_code,
                    response_body=response_text,
                    headers_sent=headers,
                    session_id=session_id,
                    tools_count=len(tools),
                )

    except asyncio.TimeoutError:
        return ConnectionTestResult(
            success=False,
            error_message=f"Connection timeout ({timeout}s)",
            headers_sent=headers,
        )
    except aiohttp.ClientError as e:
        return ConnectionTestResult(
            success=False,
            error_message=f"Connection error: {str(e)}",
            headers_sent=headers,
        )
    except json.JSONDecodeError as e:
        return ConnectionTestResult(
            success=False,
            error_message=f"JSON parse error: {str(e)}",
            headers_sent=headers,
        )
    except Exception as e:
        return ConnectionTestResult(
            success=False,
            error_message=f"Unexpected error: {str(e)}",
            headers_sent=headers,
        )


def load_mcp_config(config_path: str) -> dict:
    """
    ローカルのMCP設定JSONファイルを読み込む

    Args:
        config_path: JSONファイルのパス

    Returns:
        パースされたJSON辞書
    """
    with open(config_path, "r", encoding="utf-8") as f:
        return json.load(f)


async def test_from_config_file(
    config_path: str,
    server_filter: str | None = None,
    timeout: float = 30.0,
    verbose: bool = False,
    dry_run: bool = False,
) -> bool:
    """
    ローカルJSONファイルからMCPサーバー設定を読み込んでテスト

    Args:
        config_path: MCP設定JSONファイルのパス
        server_filter: 特定サーバーIDのみテスト（Noneの場合は全サーバー）
        timeout: 接続タイムアウト
        verbose: 詳細ログ
        dry_run: ドライラン

    Returns:
        全テスト成功ならTrue
    """
    print_header("ローカルJSONファイルからのテスト")

    # ファイル読み込み
    print_info(f"設定ファイル: {config_path}")
    try:
        config = load_mcp_config(config_path)
    except FileNotFoundError:
        print_error(f"ファイルが見つかりません: {config_path}")
        return False
    except json.JSONDecodeError as e:
        print_error(f"JSONパースエラー: {e}")
        return False

    # mcpServers の確認
    mcp_servers = config.get("mcpServers", {})
    if not mcp_servers:
        print_error("mcpServers が見つかりません")
        return False

    print_success(f"サーバー数: {len(mcp_servers)}")
    print()

    # サーバー一覧を表示
    print_info("検出されたサーバー:")
    for server_id, server_config in mcp_servers.items():
        url = server_config.get("url", "(URL未設定)")
        has_headers = "headers" in server_config
        headers_info = "ヘッダーあり" if has_headers else "ヘッダーなし"
        print(f"  - {server_id}: {url} ({headers_info})")
    print()

    # フィルタ適用
    if server_filter:
        if server_filter not in mcp_servers:
            print_error(f"サーバー '{server_filter}' が見つかりません")
            print_info("利用可能なサーバー: " + ", ".join(mcp_servers.keys()))
            return False
        servers_to_test = {server_filter: mcp_servers[server_filter]}
        print_info(f"フィルタ適用: {server_filter} のみテスト")
    else:
        servers_to_test = mcp_servers

    # 各サーバーをテスト
    all_success = True
    results = []

    for server_id, server_config in servers_to_test.items():
        print()
        print_header(f"テスト: {server_id}")

        url = server_config.get("url")
        if not url:
            print_error(f"URL が設定されていません")
            all_success = False
            results.append((server_id, False, "URL未設定"))
            continue

        # ヘッダーを取得して環境変数を展開
        raw_headers = server_config.get("headers", {})
        expanded_headers = expand_headers(raw_headers)

        print_info(f"URL: {url}")

        # ヘッダー情報を表示
        if raw_headers:
            print()
            print_info("元のヘッダー:")
            for k, v in raw_headers.items():
                print(f"  {k}: {v}")

            print()
            print_info("展開後のヘッダー:")
            for k, v in expanded_headers.items():
                # KAMUI-CODE-PASS などの認証ヘッダーはマスク
                if "PASS" in k.upper() or "KEY" in k.upper() or "AUTH" in k.upper():
                    display_v = mask_passkey(v)
                else:
                    display_v = v
                print(f"  {k}: {display_v}")

            # プレースホルダーが残っていないか確認
            for k, v in expanded_headers.items():
                if "${" in v:
                    print_warning(f"未展開のプレースホルダーがあります: {k}={v}")
                    print_info("環境変数が設定されているか確認してください")

        # 接続テスト
        if dry_run:
            print()
            print_info("ドライランモード - 接続は行いません")
            results.append((server_id, True, "ドライラン"))
            continue

        result = await test_mcp_connection(
            server_url=url,
            passkey=None,  # カスタムヘッダーを使用
            timeout=timeout,
            verbose=verbose,
            dry_run=False,
            custom_headers=expanded_headers,
        )

        if result.success:
            print_success(f"接続成功! ツール数: {result.tools_count}")
            results.append((server_id, True, f"ツール数: {result.tools_count}"))
        else:
            print_error(f"接続失敗: {result.error_message}")
            all_success = False
            results.append((server_id, False, result.error_message))

    # サマリー
    print()
    print_header("テスト結果サマリー")
    success_count = sum(1 for _, success, _ in results if success)
    fail_count = len(results) - success_count

    print(f"成功: {success_count} / {len(results)}")
    print(f"失敗: {fail_count} / {len(results)}")
    print()

    for server_id, success, message in results:
        status = f"{Colors.GREEN}✅{Colors.RESET}" if success else f"{Colors.RED}❌{Colors.RESET}"
        print(f"  {status} {server_id}: {message}")

    return all_success


async def run_connection_test(args: argparse.Namespace) -> bool:
    """接続テストを実行"""
    print_header("MCP サーバー接続テスト")

    # パスキーの確認
    passkey = args.passkey
    if not passkey:
        passkey = os.environ.get("KAMUI_CODE_PASS_KEY")

    if passkey:
        print_success(f"パスキー: {mask_passkey(passkey)}")
    else:
        print_warning("パスキーが設定されていません")
        print_info("--passkey オプションまたは KAMUI_CODE_PASS_KEY 環境変数で設定してください")

    print_info(f"サーバーURL: {args.server_url}")
    print_info(f"タイムアウト: {args.timeout}秒")
    print()

    result = await test_mcp_connection(
        server_url=args.server_url,
        passkey=passkey,
        timeout=args.timeout,
        verbose=args.verbose,
        dry_run=args.dry_run,
    )

    print()
    print_header("テスト結果")

    if result.success:
        print_success("接続成功!")
        if result.tools_count > 0:
            print_success(f"取得したツール数: {result.tools_count}")
        if result.session_id:
            print_info(f"Session ID: {result.session_id}")
        return True
    else:
        print_error("接続失敗")
        print_error(f"エラー: {result.error_message}")

        if result.status_code:
            print_info(f"HTTP ステータス: {result.status_code}")

        if result.response_body and args.verbose:
            print()
            print_info("レスポンス本文:")
            print(result.response_body[:1000])

        # デバッグヒント
        print()
        print_header("デバッグヒント")

        if result.status_code == 401 or result.status_code == 403:
            print_warning("認証エラーの可能性があります")
            print_info("1. パスキーが正しいか確認してください")
            print_info("2. パスキーの有効期限を確認してください")
            print_info("3. KAMUI-CODE-PASS ヘッダーが正しく送信されているか確認してください")
        elif result.status_code == 404:
            print_warning("URLが見つかりません")
            print_info("1. サーバーURLが正しいか確認してください")
            print_info("2. MCP エンドポイントのパスを確認してください")
        elif "timeout" in str(result.error_message).lower():
            print_warning("タイムアウトしました")
            print_info("1. サーバーが起動しているか確認してください")
            print_info("2. ネットワーク接続を確認してください")
            print_info("3. --timeout オプションで時間を延長してみてください")

        return False


def parse_args() -> argparse.Namespace:
    """コマンドライン引数をパース"""
    parser = argparse.ArgumentParser(
        description="Passkey Local Testing Tool - パスキー設定のローカルテストツール",
        formatter_class=argparse.RawDescriptionHelpFormatter,
        epilog="""
使用例:
  # 環境変数展開のテスト
  python test_passkey.py --test-expand

  # ローカルJSONファイルからテスト（推奨）
  KAMUI_CODE_PASS_KEY=xxx python test_passkey.py --config ./mcp_config.json

  # 特定のサーバーのみテスト
  python test_passkey.py --config ./mcp_config.json --server my-server-id

  # ドライラン（ヘッダー確認のみ）
  python test_passkey.py --config ./mcp_config.json --dry-run

  # MCP サーバー接続テスト（URL直接指定）
  python test_passkey.py --server-url https://example.com/mcp --passkey YOUR_KEY

  # 詳細モード
  python test_passkey.py --config ./mcp_config.json --verbose
        """,
    )

    parser.add_argument(
        "--test-expand",
        action="store_true",
        help="環境変数展開機能のテストを実行",
    )

    parser.add_argument(
        "--config",
        "-c",
        type=str,
        help="MCP設定JSONファイルのパス（mcpServers形式）",
    )

    parser.add_argument(
        "--server",
        "-s",
        type=str,
        help="テスト対象のサーバーID（--config と併用）",
    )

    parser.add_argument(
        "--server-url",
        type=str,
        help="テスト対象の MCP サーバー URL（直接指定）",
    )

    parser.add_argument(
        "--passkey",
        type=str,
        help="パスキー（指定しない場合は KAMUI_CODE_PASS_KEY 環境変数を使用）",
    )

    parser.add_argument(
        "--timeout",
        type=float,
        default=30.0,
        help="接続タイムアウト秒数（デフォルト: 30）",
    )

    parser.add_argument(
        "--verbose",
        "-v",
        action="store_true",
        help="詳細なデバッグ出力を表示",
    )

    parser.add_argument(
        "--dry-run",
        action="store_true",
        help="ドライラン（実際の接続は行わない）",
    )

    return parser.parse_args()


def main() -> int:
    """メインエントリーポイント"""
    # .env ファイルを読み込み
    load_dotenv()

    args = parse_args()

    print_header("Passkey Local Testing Tool")
    print(f"日時: {datetime.now().strftime('%Y-%m-%d %H:%M:%S')}")
    print()

    # 引数チェック
    if not args.test_expand and not args.server_url and not args.config:
        print_error("--test-expand, --config, または --server-url のいずれかを指定してください")
        print()
        print("使用例:")
        print("  python test_passkey.py --test-expand")
        print("  python test_passkey.py --config ./mcp_config.json")
        print("  python test_passkey.py --server-url https://example.com/mcp --passkey YOUR_KEY")
        return 1

    success = True

    # 環境変数展開テスト
    if args.test_expand:
        if not test_env_expansion():
            success = False

    # JSONファイルからのテスト
    if args.config:
        if not asyncio.run(test_from_config_file(
            config_path=args.config,
            server_filter=args.server,
            timeout=args.timeout,
            verbose=args.verbose,
            dry_run=args.dry_run,
        )):
            success = False

    # 直接URL指定での接続テスト
    if args.server_url:
        if not asyncio.run(run_connection_test(args)):
            success = False

    print()
    if success:
        print_success("すべてのテストが成功しました")
        return 0
    else:
        print_error("一部のテストが失敗しました")
        return 1


if __name__ == "__main__":
    sys.exit(main())
