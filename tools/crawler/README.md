# MCP Tool Catalog Crawler

MCPサーバーからツールスキーマを自動取得し、`mcp_tool_catalog.yaml`を生成するPythonクローラー。

## 機能

- Google Driveから公開されているMCP設定JSONを取得
- 全MCPサーバーに並列アクセスしてツールスキーマを取得
- YAMLカタログを自動生成（認証情報は含めない）

## セットアップ

### 1. Python環境の準備

```bash
cd tools/crawler
python -m venv venv
source venv/bin/activate  # Windows: .\venv\Scripts\activate
pip install -r requirements.txt
```

### 2. 環境変数の設定

```bash
cp .env.example .env
# .envを編集してDRIVE_FILE_IDを設定
```

### 3. Google Driveファイルの準備

MCP設定JSONファイルを以下の形式で作成し、Google Driveにアップロード：

```json
{
  "mcpServers": {
    "server-id-1": {
      "url": "https://example.com/mcp/sse",
      "headers": {
        "Authorization": "Bearer xxx"
      }
    },
    "server-id-2": {
      "url": "https://another.com/mcp"
    }
  }
}
```

**重要**: ファイルを「リンクを知っている全員が閲覧可」に設定してください。

## 使用方法

### 基本的な実行

```bash
# ドライラン（ファイル出力せず確認）
python main.py --dry-run

# 本番実行
python main.py

# 詳細ログ付きドライラン
python main.py --dry-run --verbose
```

### オプション

| オプション | 省略形 | 説明 | デフォルト |
|------------|--------|------|------------|
| `--output` | `-o` | 出力ファイルパス | `../../mcp_tool_catalog.yaml` |
| `--max-concurrent` | `-c` | 最大並列接続数 | 10 |
| `--timeout` | `-t` | サーバータイムアウト（秒） | 60.0 |
| `--delay` | `-d` | リクエスト間の遅延（秒） | 0.5 |
| `--merge` | `-m` | 既存カタログとマージ | false |
| `--dry-run` | - | stdout出力のみ | false |
| `--verbose` | `-v` | 詳細ログ出力 | false |
| `--limit` | `-l` | 処理サーバー数制限（テスト用） | なし |

### 使用例

```bash
# テスト用：最初の5サーバーのみ処理
python main.py --dry-run --limit 5 --verbose

# 高並列で実行
python main.py --max-concurrent 20

# 既存カタログとマージ
python main.py --merge
```

## GitHub Actions

### 必要なSecrets

リポジトリの Settings > Secrets and variables > Actions で以下を設定：

| Secret名 | 説明 |
|----------|------|
| `DRIVE_FILE_ID` | Google DriveファイルのID（URLの`/d/`と`/`の間の文字列） |

### ワークフロー

`.github/workflows/update_catalog.yml` で定義：

- **定期実行**: 毎日 UTC 3:00（JST 12:00）
- **手動実行**: Actions タブから `workflow_dispatch` で実行可能

### 手動実行の方法

1. GitHubリポジトリの「Actions」タブを開く
2. 左サイドバーから「Update MCP Tool Catalog」を選択
3. 「Run workflow」ボタンをクリック
4. オプションを設定して実行

## セキュリティ

- 生成されるYAMLには認証情報（headers）を**含めません**
- `.env`ファイルは`.gitignore`に追加済み
- Driveファイルは公開設定でも、認証ヘッダーの内容は出力されません

## トラブルシューティング

### `DRIVE_FILE_ID environment variable is not set`

`.env`ファイルが存在し、`DRIVE_FILE_ID`が正しく設定されているか確認してください。

### `Failed to fetch MCP config from Drive`

- Google DriveファイルのIDが正しいか確認
- ファイルが「リンクを知っている全員」に公開されているか確認

### タイムアウトエラーが多い

`--timeout`を増やすか、`--max-concurrent`を減らしてみてください：

```bash
python main.py --timeout 120 --max-concurrent 5
```
