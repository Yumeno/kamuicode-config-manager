# MCPツールカタログ自動生成機能 進捗記録

## Phase 1: ローカル環境でのプロトタイプ実装

### 完了タスク

| # | タスク | 状態 | 完了日 | 備考 |
|---|--------|------|--------|------|
| 1.1 | ディレクトリ構造作成 | ✅ 完了 | 2025-11-30 | `tools/crawler/`, `tools/crawler/src/` |
| 1.2 | requirements.txt作成 | ✅ 完了 | 2025-11-30 | 依存ライブラリ定義 |
| 1.3 | src/__init__.py作成 | ✅ 完了 | 2025-11-30 | モジュールエクスポート |
| 1.4 | drive_client.py実装 | ✅ 完了 | 2025-11-30 | Google Drive API連携 |
| 1.5 | mcp_client.py実装 | ✅ 完了 | 2025-11-30 | MCP SSE通信、並列処理 |
| 1.6 | yaml_generator.py実装 | ✅ 完了 | 2025-11-30 | YAML生成、差分マージ |
| 1.7 | main.py実装 | ✅ 完了 | 2025-11-30 | エントリーポイント |
| 1.8 | .env.example作成 | ✅ 完了 | 2025-11-30 | 環境変数テンプレート |
| 1.9 | .gitignore更新 | ✅ 完了 | 2025-11-30 | 認証情報除外設定 |

### 作成ファイル一覧

```
tools/crawler/
├── main.py                 # エントリーポイント (CLIオプション対応)
├── requirements.txt        # 依存ライブラリ
├── .env.example            # 環境変数テンプレート
└── src/
    ├── __init__.py         # モジュール定義
    ├── drive_client.py     # Google Drive操作
    ├── mcp_client.py       # MCPサーバー通信
    └── yaml_generator.py   # YAML生成ロジック

.gitignore                  # 新規作成（認証情報除外）
```

### 実装詳細

#### drive_client.py
- `DriveClient` クラス: Google Drive APIを使用してMCP設定JSONを取得
- `MCPServerConfig` dataclass: サーバー設定を構造化
- **APIキー認証方式**（公開ファイル用、サービスアカウント不要）
- Claude Desktop形式のJSON構造をパース
- aiohttp による非同期HTTP通信

#### mcp_client.py
- `MCPClient` クラス: MCP SDKを使用してSSE接続
- `ToolSchema` dataclass: ツールスキーマを構造化
- `ServerResult` dataclass: クロール結果を構造化
- `fetch_multiple()`: セマフォによる並列接続制限（デフォルト50並列）
- タイムアウト処理、エラーハンドリング対応

#### yaml_generator.py
- `YAMLGenerator` クラス: カタログYAML生成
- `generate_catalog()`: サーバー結果からYAML構造を生成
- `merge_catalogs()`: 既存カタログとの差分マージ
- 認証情報（headers）は**出力に含めない**設計

#### main.py
- CLI引数対応: `--output`, `--max-concurrent`, `--timeout`, `--merge`, `--dry-run`, `--verbose`
- 環境変数: `GOOGLE_API_KEY`, `DRIVE_FILE_ID`
- 処理フロー: Drive取得 → MCPクロール → YAML生成 → ファイル出力

---

## 次のステップ

### 未完了タスク
- [ ] ローカル環境でのテスト実行（認証設定が必要）
- [ ] Python仮想環境セットアップ・依存インストール

### Phase 2への準備
- Google Drive APIキーの準備
- テスト用MCPサーバーの選定

---

## 注意事項

### セキュリティ
- `.env` ファイルは `.gitignore` に追加済み
- 生成されるYAMLには認証情報（headers）を**含めない**

### 動作確認に必要なもの
1. Google Drive APIキー（Google Cloud Consoleで取得）
2. Google DriveファイルID（mcp_config.json）
3. Driveファイルを「リンクを知っている全員」に公開設定
4. Python 3.11+ 環境

### APIキー取得手順
1. [Google Cloud Console](https://console.cloud.google.com/) にアクセス
2. プロジェクトを選択（または新規作成）
3. **APIとサービス** → **有効なAPIとサービス** → **Google Drive API** を有効化
4. **APIとサービス** → **認証情報** → **認証情報を作成** → **APIキー**
5. 作成されたAPIキーをコピーして `.env` に設定
