# **MCP Tool Catalog Crawler**

MCPサーバーからツールスキーマを自動取得し、mcp\_tool\_catalog.yamlを生成するPythonクローラー。

## **機能**

* Google Driveから公開されているMCP設定JSONを取得  
* 全MCPサーバーに並列アクセスしてツールスキーマを取得  
* YAMLカタログを自動生成（認証情報は含めない）  
* **スマートな差分更新**:  
  * 既存のカタログとマージする際、ツール定義やURLに実質的な変更がある場合のみ情報を更新します。  
  * 単なる死活監視のタイムスタンプ（last\_checked）更新だけではファイル変更とみなさず、無駄なGitコミットが発生するのを防ぎます。  
  * サーバーが一時的にオフラインの場合でも、既存のツール定義を保護して削除されないようにします。

## **セットアップ**

### **1\. Python環境の準備**

cd tools/crawler  
python \-m venv venv  
source venv/bin/activate  \# Windows: .\\venv\\Scripts\\activate  
pip install \-r requirements.txt

### **2\. 環境変数の設定**

cp .env.example .env
\# .envを編集してDRIVE\_FILE\_IDSを設定

#### **設定方法一覧**

| 環境変数 | 必須 | 説明 |
| :---- | :---- | :---- |
| DRIVE\_FILE\_IDS | 任意 | JSON配列形式の個別ファイルID設定（推奨） |
| DRIVE\_FILE\_ID | 任意 | 単一ファイルID（後方互換用） |
| DRIVE\_FOLDER\_ID | 任意 | 監視対象のルートフォルダID（再帰探索） |
| GOOGLE\_API\_KEY | DRIVE\_FOLDER\_ID使用時必須 | Google Drive API キー |

**注意**: `DRIVE_FILE_IDS`/`DRIVE_FILE_ID` と `DRIVE_FOLDER_ID` は併用可能です。両方設定した場合、明示的なファイルIDの設定が先に読み込まれ、フォルダスキャンの結果がマージされます（後勝ち）。

#### **マルチソース形式（推奨）**

```json
DRIVE_FILE_IDS=[{"name": "Legacy", "id": "1ABC..."}, {"name": "Latest", "id": "1XYZ..."}]
```

* **name**: ログ表示用のラベル
* **id**: Google DriveのファイルID
* **優先順位**: リストの後方に記述されたファイルを優先（後勝ち）
  * クローラーは最も優先度の高いソースから接続を試行し、失敗時に次のソースにフォールバック

**後方互換**: `DRIVE_FILE_IDS` が未設定の場合、`DRIVE_FILE_ID`（単一ID）を使用

#### **フォルダ再帰探索形式（Issue #30 新機能）**

```bash
DRIVE_FOLDER_ID=1FolderID_Here
GOOGLE_API_KEY=AIzaSy...
```

指定したフォルダ以下を再帰的に探索し、以下の条件を満たすJSONファイルを自動検出します:

| フィルタ条件 | 説明 |
| :---- | :---- |
| 更新日時 | 2025年11月20日以降に更新されたファイル |
| 拡張子 | `.json` ファイルのみ |
| 構造チェック | ルートに `mcpServers` キー（オブジェクト型）を持つこと |

**Google API キーの取得方法**:
1. [Google Cloud Console](https://console.cloud.google.com/) にアクセス
2. プロジェクトを選択または新規作成
3. 「APIとサービス」→「認証情報」→「認証情報を作成」→「APIキー」
4. Drive API を有効化（「APIとサービス」→「ライブラリ」→「Google Drive API」）
5. 生成されたAPIキーを `GOOGLE_API_KEY` に設定

**重要**: フォルダ内の全ファイルは「リンクを知っている全員が閲覧可」に設定してください。

### **3\. Google Driveファイルの準備**

MCP設定JSONファイルを以下の形式で作成し、Google Driveにアップロード：

{  
  "mcpServers": {  
    "server-id-1": {  
      "url": "\[https://example.com/mcp/sse\](https://example.com/mcp/sse)",  
      "headers": {  
        "Authorization": "Bearer xxx"  
      }  
    },  
    "server-id-2": {  
      "url": "\[https://another.com/mcp\](https://another.com/mcp)"  
    }  
  }  
}

**重要**: ファイルを「リンクを知っている全員が閲覧可」に設定してください。

## **使用方法**

### **基本的な実行**

\# ドライラン（ファイル出力せず確認）  
python main.py \--dry-run

\# 本番実行  
python main.py

\# 詳細ログ付きドライラン  
python main.py \--dry-run \--verbose

### **オプション**

| オプション | 省略形 | 説明 | デフォルト |
| :---- | :---- | :---- | :---- |
| \--output | \-o | 出力ファイルパス | ../../mcp\_tool\_catalog.yaml |
| \--max-concurrent | \-c | 最大並列接続数 | 10 |
| \--timeout | \-t | サーバータイムアウト（秒） | 60.0 |
| \--delay | \-d | リクエスト間の遅延（秒） | 0.5 |
| \--merge | \-m | 既存カタログとマージ（差分検知・更新抑制あり） | false |
| \--dry-run | \- | stdout出力のみ | false |
| \--verbose | \-v | 詳細ログ出力 | false |
| \--limit | \-l | 処理サーバー数制限（テスト用） | なし |

### **使用例**

\# テスト用：最初の5サーバーのみ処理  
python main.py \--dry-run \--limit 5 \--verbose

\# 高並列で実行  
python main.py \--max-concurrent 20

\# 既存カタログとマージ（推奨：変更点のみ更新）  
python main.py \--merge

## **GitHub Actions**

### **必要なSecrets**

リポジトリの Settings \> Secrets and variables \> Actions で以下を設定：

| Secret名 | 必須 | 説明 |
| :---- | :---- | :---- |
| DRIVE\_FILE\_IDS | 任意 | JSON配列形式のファイル設定（推奨） |
| DRIVE\_FILE\_ID | 任意 | Google DriveファイルのID（後方互換用） |
| DRIVE\_FOLDER\_ID | 任意 | 監視対象のルートフォルダID |
| GOOGLE\_API\_KEY | フォルダ探索時必須 | Google Drive API キー |

**注意**: `DRIVE_FILE_IDS`/`DRIVE_FILE_ID`/`DRIVE_FOLDER_ID` のいずれかは必須です。

#### **DRIVE\_FILE\_IDS の形式**

```json
[{"name": "Legacy", "id": "1ABC_legacy_id"}, {"name": "Latest", "id": "1XYZ_latest_id"}]
```

**注意**: GitHub SecretsにJSON値を設定する際は、改行なしの1行で記述してください。

### **ワークフロー**

.github/workflows/update\_catalog.yml で定義：

* **定期実行**: 毎日 UTC 3:00（JST 12:00）  
* **手動実行**: Actions タブから workflow\_dispatch で実行可能

### **手動実行の方法**

1. GitHubリポジトリの「Actions」タブを開く  
2. 左サイドバーから「Update MCP Tool Catalog」を選択  
3. 「Run workflow」ボタンをクリック  
4. オプションを設定して実行

## **セキュリティ**

* 生成されるYAMLには認証情報（headers）を**含めません**  
* .envファイルは.gitignoreに追加済み  
* Driveファイルは公開設定でも、認証ヘッダーの内容は出力されません

## **トラブルシューティング**

### **DRIVE\_FILE\_IDS (or DRIVE\_FILE\_ID) environment variable is not set**

.envファイルが存在し、`DRIVE_FILE_IDS`（推奨）または`DRIVE_FILE_ID`が正しく設定されているか確認してください。

### **Failed to fetch MCP config from Drive**

* Google DriveファイルのIDが正しいか確認  
* ファイルが「リンクを知っている全員」に公開されているか確認

### **タイムアウトエラーが多い**

\--timeoutを増やすか、--max-concurrentを減らしてみてください：

python main.py \--timeout 120 \--max-concurrent 5

---

*Updated: 2025-12-06 (Issue #26 マルチソースJSON対応)*
*Updated: 2025-12-17 (Issue #30 フォルダ再帰探索機能追加)*
