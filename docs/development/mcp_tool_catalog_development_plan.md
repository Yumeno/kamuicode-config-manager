# MCPツールカタログ自動生成機能 開発計画書

## 1. 現状分析

### 1.1 既存リソース
| 項目 | 状態 | 備考 |
|------|------|------|
| `tools/code.js` | ✅ 存在 | GAS版Auto Updater（Gemini API連携） |
| `kamuicode_model_memo.yaml` | ✅ 存在 | 100+モデル、757行 |
| `.github/workflows/` | ❌ 未作成 | ディレクトリ自体が存在しない |
| Python環境 | ❌ 未構築 | requirements.txt等なし |
| `mcp_tool_catalog.yaml` | ❌ 新規作成 | 本機能の成果物 |

### 1.2 技術的な依存関係
- 既存の `tools/code.js` はGoogle Drive上の `mcp-kamui-code.json` を参照
- 同じDriveファイルを新規Pythonクローラーでも使用予定

---

## 2. 開発フェーズ詳細

### Phase 1: ローカル環境でのプロトタイプ実装

#### 1.1 ディレクトリ・ファイル作成
```
tools/crawler/
├── main.py                 # エントリーポイント
├── requirements.txt        # 依存ライブラリ
├── .env.example            # 環境変数テンプレート
└── src/
    ├── __init__.py
    ├── drive_client.py     # Google Drive操作
    ├── mcp_client.py       # MCPサーバー通信
    └── yaml_generator.py   # YAML生成ロジック
```

#### 1.2 タスク一覧

| # | タスク | 詳細 | 成果物 |
|---|--------|------|--------|
| 1.1 | プロジェクト初期化 | ディレクトリ構造作成、`.gitignore`更新 | `tools/crawler/` |
| 1.2 | 依存ライブラリ定義 | `requirements.txt`作成 | requirements.txt |
| 1.3 | Drive Client実装 | サービスアカウント認証、JSON取得 | `drive_client.py` |
| 1.4 | MCP Client実装 | SSE接続、`tools/list`リクエスト送信 | `mcp_client.py` |
| 1.5 | 単体テスト | 単一サーバーへの接続検証 | 動作確認完了 |

#### 1.3 技術選定

```
# requirements.txt (想定)
google-auth>=2.0.0
google-api-python-client>=2.0.0
aiohttp>=3.9.0
pyyaml>=6.0.0
python-dotenv>=1.0.0
mcp>=1.0.0  # MCP Python SDK (利用可能な場合)
```

#### 1.4 drive_client.py 設計

```python
class DriveClient:
    """Google Drive からMCP設定JSONを取得"""

    async def fetch_mcp_config(self, file_id: str) -> dict:
        """
        Returns:
            {
                "servers": [
                    {"id": "xxx", "url": "https://...", "headers": {...}},
                    ...
                ]
            }
        """
```

#### 1.5 mcp_client.py 設計

```python
class MCPClient:
    """MCPサーバーとの通信を担当"""

    async def fetch_tools_schema(
        self,
        server_url: str,
        headers: dict | None = None
    ) -> dict:
        """
        tools/list リクエストを送信し、スキーマを取得

        Returns:
            {
                "status": "online" | "offline" | "error",
                "tools": [
                    {
                        "name": "tool_name",
                        "description": "...",
                        "inputSchema": {...}
                    }
                ],
                "error_message": None | "..."
            }
        """
```

---

### Phase 2: 全量取得とYAML生成の実装

#### 2.1 タスク一覧

| # | タスク | 詳細 | 成果物 |
|---|--------|------|--------|
| 2.1 | 非同期並列処理実装 | `asyncio.gather`による並列アクセス | `main.py`更新 |
| 2.2 | セマフォ制御 | 同時接続数制限（例: 50並列） | 過負荷防止 |
| 2.3 | YAML Generator実装 | カタログYAML生成ロジック | `yaml_generator.py` |
| 2.4 | セキュリティ検証 | 認証情報の除外確認 | テストケース |
| 2.5 | 差分更新ロジック | 既存YAML比較、増分更新 | `yaml_generator.py`更新 |
| 2.6 | エラーハンドリング強化 | Partial Success対応 | ログ出力 |

#### 2.2 yaml_generator.py 設計

```python
class YAMLGenerator:
    """MCPツールカタログYAMLの生成"""

    def generate_catalog(
        self,
        server_results: list[dict],
        exclude_auth: bool = True  # 認証情報除外フラグ
    ) -> str:
        """
        YAML形式のカタログを生成

        出力形式:
        servers:
          - id: server-unique-id
            url: https://api.example.com/sse
            status: online
            last_checked: "2025-11-30T12:00:00Z"
            tools:
              - name: text_to_image
                description: "Generate an image from text..."
                inputSchema:
                  type: object
                  properties:
                    prompt: { type: string }
        """

    def merge_with_existing(
        self,
        new_data: dict,
        existing_path: str
    ) -> dict:
        """既存YAMLとの差分マージ"""
```

#### 2.3 main.py 処理フロー

```python
async def main():
    # 1. Google Driveから設定取得
    drive_client = DriveClient()
    config = await drive_client.fetch_mcp_config(DRIVE_FILE_ID)

    # 2. 並列でMCPサーバーにアクセス
    mcp_client = MCPClient()
    semaphore = asyncio.Semaphore(50)  # 同時接続制限

    async def fetch_with_limit(server):
        async with semaphore:
            return await mcp_client.fetch_tools_schema(
                server["url"],
                server.get("headers")
            )

    results = await asyncio.gather(
        *[fetch_with_limit(s) for s in config["servers"]],
        return_exceptions=True
    )

    # 3. YAML生成（認証情報除外）
    generator = YAMLGenerator()
    catalog_yaml = generator.generate_catalog(results)

    # 4. ファイル出力
    output_path = Path("../../mcp_tool_catalog.yaml")
    output_path.write_text(catalog_yaml, encoding="utf-8")
```

---

### Phase 3: GitHub Actions への統合

#### 3.1 タスク一覧

| # | タスク | 詳細 | 成果物 |
|---|--------|------|--------|
| 3.1 | workflowsディレクトリ作成 | `.github/workflows/` 新設 | ディレクトリ |
| 3.2 | ワークフロー定義 | `update_catalog.yml` 作成 | YAMLファイル |
| 3.3 | Secrets設定ドキュメント | 必要なSecrets一覧 | README更新 |
| 3.4 | 手動実行テスト | `workflow_dispatch`で検証 | 動作確認 |
| 3.5 | 定期実行設定 | `schedule`トリガー設定 | 自動化完了 |

#### 3.2 update_catalog.yml 設計

```yaml
name: Update MCP Tool Catalog

on:
  schedule:
    - cron: '0 3 * * *'  # 毎日 UTC 3:00 (JST 12:00)
  workflow_dispatch:      # 手動実行

jobs:
  update-catalog:
    runs-on: ubuntu-latest

    steps:
      - name: Checkout repository
        uses: actions/checkout@v4

      - name: Set up Python
        uses: actions/setup-python@v5
        with:
          python-version: '3.11'
          cache: 'pip'

      - name: Install dependencies
        run: |
          pip install -r tools/crawler/requirements.txt

      - name: Create credentials file
        run: |
          echo '${{ secrets.GCP_SA_KEY }}' > /tmp/sa_key.json

      - name: Run crawler
        env:
          GOOGLE_APPLICATION_CREDENTIALS: /tmp/sa_key.json
          DRIVE_FILE_ID: ${{ secrets.DRIVE_FILE_ID }}
        run: |
          python tools/crawler/main.py

      - name: Commit and push if changed
        run: |
          git config user.name "github-actions[bot]"
          git config user.email "github-actions[bot]@users.noreply.github.com"
          git add mcp_tool_catalog.yaml
          git diff --staged --quiet || git commit -m "chore(catalog): update MCP tool catalog"
          git push
```

---

## 3. 実装順序とチェックリスト

```
Phase 1 (プロトタイプ)
├── [1.1] tools/crawler/ ディレクトリ作成
├── [1.2] requirements.txt 作成
├── [1.3] src/__init__.py 作成
├── [1.4] src/drive_client.py 実装
├── [1.5] src/mcp_client.py 実装
├── [1.6] main.py 基本実装
└── [1.7] 単一サーバーでの動作確認

Phase 2 (全量取得)
├── [2.1] 非同期並列処理実装
├── [2.2] セマフォによる同時接続制限
├── [2.3] src/yaml_generator.py 実装
├── [2.4] 認証情報除外の検証テスト
├── [2.5] 差分更新ロジック実装
├── [2.6] エラーハンドリング強化
└── [2.7] mcp_tool_catalog.yaml 生成テスト

Phase 3 (CI/CD統合)
├── [3.1] .github/workflows/ ディレクトリ作成
├── [3.2] update_catalog.yml 作成
├── [3.3] tools/crawler/README.md ドキュメント作成
├── [3.4] workflow_dispatch での動作確認
└── [3.5] schedule トリガーの有効化
```

---

## 4. セキュリティチェックリスト

| 項目 | 対策 |
|------|------|
| 認証情報のYAML出力防止 | `YAMLGenerator`で`headers`フィールドを明示的に除外 |
| サービスアカウントキー | GitHub Secrets（`GCP_SA_KEY`）で管理、コードに含めない |
| Drive File ID | GitHub Secrets（`DRIVE_FILE_ID`）で管理 |
| `.env`ファイル | `.gitignore`に追加、リポジトリに含めない |
| ログ出力 | 認証情報をログに出力しない |

---

## 5. 成果物一覧

### 新規作成ファイル
```
.github/
└── workflows/
    └── update_catalog.yml          # GitHub Actions定義

tools/
└── crawler/
    ├── main.py                     # エントリーポイント
    ├── requirements.txt            # 依存ライブラリ
    ├── .env.example                # 環境変数テンプレート
    ├── README.md                   # セットアップガイド
    └── src/
        ├── __init__.py
        ├── drive_client.py         # Google Drive操作
        ├── mcp_client.py           # MCPサーバー通信
        └── yaml_generator.py       # YAML生成ロジック

mcp_tool_catalog.yaml               # 自動生成されるカタログ（成果物）
```

### 更新ファイル
```
.gitignore                          # .env, credentials追加
README.md                           # 新機能のドキュメント追加（任意）
```

---

## 6. リスクと対策

| リスク | 影響度 | 対策 |
|--------|--------|------|
| 一部MCPサーバーがダウン | 中 | Partial Successで継続、エラーログ出力 |
| GitHub Actions タイムアウト | 中 | 並列処理で高速化、必要に応じてジョブ分割 |
| Drive認証エラー | 高 | 適切なSecrets設定、エラーメッセージの明確化 |
| YAML構造の破損 | 高 | バリデーション実装、差分コミット前の検証 |
