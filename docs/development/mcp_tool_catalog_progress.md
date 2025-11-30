# MCPツールカタログ自動生成機能 進捗記録

## Phase 1: ローカル環境でのプロトタイプ実装 ✅ 完了

### 完了タスク

| # | タスク | 状態 | 完了日 | 備考 |
|---|--------|------|--------|------|
| 1.1 | ディレクトリ構造作成 | ✅ 完了 | 2025-11-30 | `tools/crawler/`, `tools/crawler/src/` |
| 1.2 | requirements.txt作成 | ✅ 完了 | 2025-11-30 | 依存ライブラリ定義 |
| 1.3 | src/__init__.py作成 | ✅ 完了 | 2025-11-30 | モジュールエクスポート |
| 1.4 | drive_client.py実装 | ✅ 完了 | 2025-11-30 | Google Drive直接ダウンロード |
| 1.5 | mcp_client.py実装 | ✅ 完了 | 2025-11-30 | Streamable HTTP (JSON-RPC) |
| 1.6 | yaml_generator.py実装 | ✅ 完了 | 2025-11-30 | YAML生成、差分マージ |
| 1.7 | main.py実装 | ✅ 完了 | 2025-11-30 | エントリーポイント |
| 1.8 | .env.example作成 | ✅ 完了 | 2025-11-30 | 環境変数テンプレート |
| 1.9 | .gitignore更新 | ✅ 完了 | 2025-11-30 | 認証情報除外設定 |
| 1.10 | 全サーバーテスト | ✅ 完了 | 2025-11-30 | 186サーバー中184成功 |

### テスト結果（2025-11-30）

| 項目 | 数値 |
|------|------|
| 総サーバー数 | 186 |
| Online | 184 (98.9%) |
| Offline | 0 |
| Errors | 2 |
| **発見ツール数** | **547** |

エラー内訳:
- 1件: 認証ヘッダーなし（JSONにheadersフィールドがない）
- 1件: tools/list非対応サーバー

### 作成ファイル一覧

```
tools/crawler/
├── main.py                 # エントリーポイント (CLIオプション対応)
├── requirements.txt        # 依存ライブラリ (aiohttp, pyyaml, python-dotenv)
├── .env.example            # 環境変数テンプレート
└── src/
    ├── __init__.py         # モジュール定義
    ├── drive_client.py     # Google Drive操作
    ├── mcp_client.py       # MCPサーバー通信
    └── yaml_generator.py   # YAML生成ロジック

.gitignore                  # 認証情報除外設定
```

### 実装詳細

#### drive_client.py
- `DriveClient` クラス: Google Driveから公開ファイルを直接ダウンロード
- `MCPServerConfig` dataclass: サーバー設定を構造化
- **APIキー不要**（公開ファイル用直接ダウンロードURL使用）
- Claude Desktop形式のJSON構造をパース
- aiohttp による非同期HTTP通信

#### mcp_client.py
- `MCPClient` クラス: **Streamable HTTP (JSON-RPC)** でMCPサーバーと通信
- プロトコル: `initialize` → `tools/list` の2段階通信
- `Mcp-Session-Id` ヘッダーを後続リクエストに含める
- `ToolSchema` dataclass: ツールスキーマを構造化
- `ServerResult` dataclass: クロール結果を構造化
- `fetch_multiple()`: セマフォによる並列接続制限（デフォルト10並列）
- タイムアウト処理（デフォルト60秒）、リクエスト間ディレイ（デフォルト0.5秒）

#### yaml_generator.py
- `YAMLGenerator` クラス: カタログYAML生成
- `generate_catalog()`: サーバー結果からYAML構造を生成
- `merge_catalogs()`: 既存カタログとの差分マージ
- 認証情報（headers）は**出力に含めない**設計

#### main.py
- CLI引数対応: `--output`, `--max-concurrent`, `--timeout`, `--delay`, `--merge`, `--dry-run`, `--verbose`, `--limit`
- 環境変数: `DRIVE_FILE_ID`（APIキー不要）
- 処理フロー: Drive取得 → MCPクロール → YAML生成 → ファイル出力

### 技術的な変更履歴

1. **SSE → Streamable HTTP**: MCP SDKのsse_clientではなく、aiohttpでJSON-RPCプロトコルを直接実装
2. **セッション管理**: `Mcp-Session-Id`ヘッダーを後続リクエストに含める
3. **APIキー不要化**: Google Drive公開ファイル用の直接ダウンロードURLを使用

---

## Phase 2: 全量取得とYAML生成の実装

### 完了タスク

| # | タスク | 状態 | 備考 |
|---|--------|------|------|
| 2.1 | 非同期並列処理実装 | ✅ 完了 | asyncio.gather + セマフォ |
| 2.2 | セマフォ制御 | ✅ 完了 | デフォルト10並列 |
| 2.3 | YAML Generator実装 | ✅ 完了 | カタログ生成ロジック |
| 2.4 | セキュリティ検証 | ✅ 完了 | headers除外確認 |
| 2.5 | 差分更新ロジック | ✅ 完了 | --merge オプション |
| 2.6 | エラーハンドリング強化 | ✅ 完了 | Partial Success対応 |

---

## Phase 3: GitHub Actions への統合 ✅ 完了

### 完了タスク

| # | タスク | 状態 | 完了日 | 備考 |
|---|--------|------|--------|------|
| 3.1 | workflowsディレクトリ作成 | ✅ 完了 | 2025-11-30 | `.github/workflows/` |
| 3.2 | ワークフロー定義 | ✅ 完了 | 2025-11-30 | `update_catalog.yml` |
| 3.3 | Secrets設定ドキュメント | ✅ 完了 | 2025-11-30 | `tools/crawler/README.md` |
| 3.4 | 手動実行テスト | 📋 要動作確認 | - | workflow_dispatch で検証が必要 |
| 3.5 | 定期実行設定 | ✅ 完了 | 2025-11-30 | 毎日 UTC 3:00 (JST 12:00) |

### 作成ファイル

```
.github/
└── workflows/
    └── update_catalog.yml     # GitHub Actions定義

tools/crawler/
└── README.md                  # セットアップガイド・Secrets設定ドキュメント
```

### ワークフロー機能

- **定期実行**: 毎日 UTC 3:00（JST 12:00）に自動実行
- **手動実行**: Actions タブから `workflow_dispatch` で即時実行可能
- **オプション**: `dry_run`（テスト実行）、`max_concurrent`（並列数）
- **自動コミット**: 変更がある場合のみカタログを更新してコミット

### 必要なSecrets

| Secret名 | 説明 |
|----------|------|
| `DRIVE_FILE_ID` | Google DriveファイルのID |

**注意**: 実際のDrive File IDはユーザーが別途設定する必要があります。

### 次のステップ

1. 下記のワークフローファイルをGitHub上で手動作成
2. リポジトリに `DRIVE_FILE_ID` シークレットを設定
3. Actionsタブから手動実行でワークフローをテスト
4. 動作確認後、定期実行を有効化

### ワークフローファイル（手動追加が必要）

GitHub Appの権限制限により、以下のファイルは手動でGitHub上に追加する必要があります。

**ファイルパス**: `.github/workflows/update_catalog.yml`

```yaml
name: Update MCP Tool Catalog

on:
  schedule:
    # Run daily at UTC 3:00 (JST 12:00)
    - cron: '0 3 * * *'
  workflow_dispatch:
    # Allow manual trigger
    inputs:
      dry_run:
        description: 'Dry run (do not commit changes)'
        required: false
        default: false
        type: boolean
      max_concurrent:
        description: 'Maximum concurrent connections'
        required: false
        default: '10'
        type: string

jobs:
  update-catalog:
    runs-on: ubuntu-latest
    permissions:
      contents: write

    steps:
      - name: Checkout repository
        uses: actions/checkout@v4

      - name: Set up Python
        uses: actions/setup-python@v5
        with:
          python-version: '3.11'
          cache: 'pip'
          cache-dependency-path: tools/crawler/requirements.txt

      - name: Install dependencies
        run: |
          pip install -r tools/crawler/requirements.txt

      - name: Run crawler
        env:
          DRIVE_FILE_ID: ${{ secrets.DRIVE_FILE_ID }}
        run: |
          cd tools/crawler
          if [ "${{ inputs.dry_run }}" = "true" ]; then
            python main.py --dry-run --verbose --max-concurrent ${{ inputs.max_concurrent || '10' }}
          else
            python main.py --max-concurrent ${{ inputs.max_concurrent || '10' }}
          fi

      - name: Check for changes
        id: changes
        if: ${{ inputs.dry_run != 'true' }}
        run: |
          if git diff --quiet mcp_tool_catalog.yaml 2>/dev/null; then
            echo "changed=false" >> $GITHUB_OUTPUT
          else
            echo "changed=true" >> $GITHUB_OUTPUT
          fi

      - name: Commit and push if changed
        if: ${{ steps.changes.outputs.changed == 'true' && inputs.dry_run != 'true' }}
        run: |
          git config user.name "github-actions[bot]"
          git config user.email "github-actions[bot]@users.noreply.github.com"
          git add mcp_tool_catalog.yaml
          git commit -m "chore(catalog): update MCP tool catalog [skip ci]"
          git push
```

**追加方法**:
1. GitHubリポジトリの「Add file」→「Create new file」
2. ファイル名に `.github/workflows/update_catalog.yml` と入力
3. 上記の内容をペースト
4. コミット

---

## 使用方法

### セットアップ

```bash
cd tools/crawler
python -m venv venv
source venv/bin/activate  # Windows: .\venv\Scripts\activate
pip install -r requirements.txt
```

### 環境変数設定

```bash
cp .env.example .env
# .env を編集して DRIVE_FILE_ID を設定
```

### 実行

```bash
# ドライラン（ファイル出力せず確認）
python main.py --dry-run

# 本番実行
python main.py

# オプション付き
python main.py --max-concurrent 5 --timeout 90 --delay 1.0

# テスト用（最初のN個のみ）
python main.py --dry-run --limit 5 --verbose
```

---

## 注意事項

### セキュリティ
- `.env` ファイルは `.gitignore` に追加済み
- 生成されるYAMLには認証情報（headers）を**含めない**

### 動作確認に必要なもの
1. Google DriveファイルID（mcp_config.json）
2. Driveファイルを「リンクを知っている全員」に公開設定
3. Python 3.11+ 環境
