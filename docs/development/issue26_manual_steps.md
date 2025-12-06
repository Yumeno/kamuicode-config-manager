# Issue #26: 手動対応が必要な残作業

## 概要

Issue #26 の実装において、GitHub Actions ワークフローファイル (`.github/workflows/update_catalog.yml`) の変更は、ワークフロー権限の制限によりプッシュできませんでした。以下の手順で手動対応をお願いします。

---

## 1. ワークフローファイルの変更

### 対象ファイル
`.github/workflows/update_catalog.yml`

### 変更箇所
「Run crawler」ステップの `env` セクションに `DRIVE_FILE_IDS` 環境変数を追加します。

### 変更後の完全なファイル

以下の内容で `.github/workflows/update_catalog.yml` を置き換えてください：

```yaml
name: Update MCP Tool Catalog

on:
  schedule:
    # Run daily at UTC 13:00 (JST 22:00)
    - cron: '0 13 * * *'
  workflow_dispatch:
    # Allow manual trigger
    inputs:
      mode:
        description: 'Update mode'
        required: true
        default: 'merge'
        type: choice
        options:
          - merge
          - full_rebuild
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
          # Multi-source JSON support (Issue #26)
          # Format: [{"name": "Label", "id": "file_id"}, ...]
          DRIVE_FILE_IDS: ${{ secrets.DRIVE_FILE_IDS }}
          # Legacy single ID (backward compatibility)
          DRIVE_FILE_ID: ${{ secrets.DRIVE_FILE_ID }}
        run: |
          cd tools/crawler

          # Build options
          OPTIONS="--max-concurrent ${{ inputs.max_concurrent || '10' }}"

          # Add merge option for scheduled runs or when mode is 'merge'
          # full_rebuild mode does NOT use --merge (complete overwrite)
          if [ "${{ github.event_name }}" = "schedule" ] || [ "${{ inputs.mode }}" = "merge" ]; then
            OPTIONS="$OPTIONS --merge"
          fi

          if [ "${{ inputs.dry_run }}" = "true" ]; then
            OPTIONS="$OPTIONS --dry-run --verbose"
          fi

          echo "Running: python main.py $OPTIONS"
          python main.py $OPTIONS

      - name: Commit and push if changed
        if: ${{ inputs.dry_run != 'true' }}
        run: |
          # Check if file was generated
          if [ ! -f mcp_tool_catalog.yaml ]; then
            echo "No catalog file generated, skipping commit"
            exit 0
          fi

          git config user.name "github-actions[bot]"
          git config user.email "github-actions[bot]@users.noreply.github.com"

          # Stage the file (handles both new and modified files)
          git add mcp_tool_catalog.yaml

          # Commit only if there are staged changes
          if git diff --cached --quiet; then
            echo "No changes to commit"
          else
            git commit -m "chore(catalog): update MCP tool catalog [skip ci]"
            git push
            echo "Changes committed and pushed"
          fi
```

### 変更点の差分

```diff
      - name: Run crawler
        env:
-          DRIVE_FILE_ID: ${{ secrets.DRIVE_FILE_ID }}
+          # Multi-source JSON support (Issue #26)
+          # Format: [{"name": "Label", "id": "file_id"}, ...]
+          DRIVE_FILE_IDS: ${{ secrets.DRIVE_FILE_IDS }}
+          # Legacy single ID (backward compatibility)
+          DRIVE_FILE_ID: ${{ secrets.DRIVE_FILE_ID }}
        run: |
```

---

## 2. GitHub Secrets の設定

### 新しいシークレットの追加

1. GitHub リポジトリの **Settings** → **Secrets and variables** → **Actions** を開く
2. **New repository secret** をクリック
3. 以下の内容で作成:

| Name | Value |
|------|-------|
| `DRIVE_FILE_IDS` | JSON配列形式の設定 (下記参照) |

### DRIVE_FILE_IDS の値の形式

```json
[
  {"name": "Legacy", "id": "1ABC_legacy_file_id"},
  {"name": "Latest", "id": "1XYZ_latest_file_id"}
]
```

**ポイント:**
- `name`: ログ表示用のラベル（任意の名前）
- `id`: Google DriveのファイルID
- **順序**: リストの後方に記述されたファイルが優先（後勝ち）

### 後方互換性について

既存の `DRIVE_FILE_ID` シークレットはそのまま残しておいてください。
`DRIVE_FILE_IDS` が未設定の場合のフォールバックとして機能します。

---

## 3. 動作確認

### ローカルテスト

```bash
cd tools/crawler

# JSON形式でテスト
DRIVE_FILE_IDS='[{"name": "Test", "id": "your_file_id"}]' python main.py --dry-run

# カンマ区切り形式でテスト (後方互換)
DRIVE_FILE_IDS='file_id_1,file_id_2' python main.py --dry-run

# レガシー形式でテスト (後方互換)
DRIVE_FILE_ID='single_file_id' python main.py --dry-run
```

### GitHub Actions テスト

1. Actions タブから **Update MCP Tool Catalog** ワークフローを選択
2. **Run workflow** → `dry_run: true` で手動実行
3. ログで以下を確認:
   - `📂 Loaded {name}: N servers` が各ソースごとに表示される
   - `✅ Total unique servers: N` でマージ後の総数が表示される

---

## 4. コミットメッセージ例

```
ci: add DRIVE_FILE_IDS env var for multi-source JSON support (Refs #26)

Add support for multiple Drive file sources with last-one-wins priority.
- DRIVE_FILE_IDS: JSON array format for labeled sources
- DRIVE_FILE_ID: kept for backward compatibility
```

---

## 関連ファイル

| ファイル | 状態 | 説明 |
|----------|------|------|
| `tools/code.js` | ✅ 完了 | GAS multi-source対応 |
| `tools/crawler/main.py` | ✅ 完了 | パース関数・並列処理改修 |
| `tools/crawler/src/drive_client.py` | ✅ 完了 | fetch_mcp_configs_multi() |
| `tools/crawler/src/mcp_client.py` | ✅ 完了 | fetch_tools_with_fallback() |
| `tools/crawler/.env.example` | ✅ 完了 | ドキュメント更新 |
| `.github/workflows/update_catalog.yml` | ⚠️ 手動対応 | 本ドキュメント参照 |

---

## 作成日

2025-12-06

## 関連Issue

- Issue #26: Support multi-source JSON with consistent "last-one-wins" priority
