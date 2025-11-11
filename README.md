# kamuicode Config Manager

AIモデルのサーバー構成を簡単に管理できるWebアプリケーションです。
複数のモデルから必要なものだけを選んで、フィルタリングされた設定ファイルを出力できます。

## 概要

このツールは以下の機能を提供します：

- **モデル構成の読み込み**: JSON形式のサーバー構成ファイルを読み込み
- **詳細情報の表示**: YAMLファイルからモデルの詳細情報（カテゴリ、正式名称、リリース日、説明）を表示
- **柔軟なフィルタリング**: カテゴリやキーワードでモデルを絞り込み
- **チェック状態の管理**: 必要なモデルだけを選択し、その状態を保存・復元
- **設定ファイルの出力**: 選択したモデルだけを含む新しいJSON設定ファイルを生成

## インストール

1. このリポジトリをクローンします：

```bash
git clone https://github.com/Yumeno/kamuicode-config-manager.git
cd kamuicode-config-manager
```

2. ブラウザでHTMLファイルを開きます：

```bash
# Windowsの場合
start kamuicode-config-manager.html

# macOSの場合
open kamuicode-config-manager.html

# Linuxの場合
xdg-open kamuicode-config-manager.html
```

または、ファイルエクスプローラーから `kamuicode-config-manager.html` をダブルクリックして開いてください。

## 使い方

### ステップ1: JSONファイルの読み込み（必須）

1. **「1. mcpServers (.json)」** のファイル選択ボタンをクリック
2. あなたのサーバー構成JSONファイルを選択
3. 読み込みが成功すると、すべてのモデルが一覧表示されます

**JSON形式の例：**
```json
{
  "mcpServers": {
    "file-upload-kamui-fal": {
      "type": "http",
      "url": "https://example.com/...",
      "description": "File Upload to FAL..."
    },
    "t2i-kamui-dreamina-v31": {
      "type": "http",
      "url": "https://example.com/t2i/...",
      "description": "Bytedance Dreamina v3.1..."
    }
  }
}
```

### ステップ2: モデル詳細情報の読み込み（推奨）

このリポジトリには **`kamuicode_model_memo.yaml`** ファイルが同梱されています。
このファイルには各モデルの詳細情報（カテゴリ、正式名称、リリース日、特徴）が記載されています。

1. **「2. Model Memo (.yaml)」** のファイル選択ボタンをクリック
2. 同梱の **`kamuicode_model_memo.yaml`** ファイルを選択
3. 一覧が自動更新され、モデル情報が補完されます
   - JSONにのみ存在するモデルは「(未分類)」として表示されます

**YAMLファイルの操作：**
- **再読み込み**: 再度ファイルを選択
- **クリア**: 「YAMLクリア」ボタンで適用を解除

**YAML形式の例：**
```yaml
ai_models:
  text_to_image:
    - name: ByteDance Dreamina v3.1
      server_name: t2i-kamui-dreamina-v31
      release_date: 2024-12
      features: "(ByteDance) 高品質なテキストからの画像生成。"
```

> **注意**: `features` にコロン（:）が含まれる場合は、文字列全体をダブルクォーテーション（"）で囲んでください。

### ステップ3: フィルタとソート

モデル一覧から必要なものを見つけやすくします。

#### カテゴリで絞り込み
- ドロップダウンメニューから特定のカテゴリを選択
- 例: `text_to_video` を選択すると、そのカテゴリのモデルのみ表示

#### テキストで検索
- 検索ボックスにキーワードを入力
- モデル名、server_name、解説のいずれかに部分一致するモデルを表示
- 例: 「Vidu」と入力すると、Viduを含むモデルのみ表示

#### ソート（並び替え）
- テーブルヘッダーの **「モデル名」** または **「リリース時期」** をクリック
- クリックごとに **昇順（▲）→ 降順（▼）→ 解除（元の順序）** と切り替わります

### ステップ4: チェック状態の管理（便利機能）

複数のプロジェクトで異なるモデルセットを使い分ける場合に便利です。

#### チェックボックスの操作
- **個別選択**: 各モデルのチェックボックスをON/OFF
- **一括操作**:
  - 「フィルタ内すべてチェック」: 現在表示中のモデルをすべて選択
  - 「フィルタ内すべて解除」: 現在表示中のモデルをすべて解除

#### チェック状態の保存と読み込み
- **状態を保存**: 現在のチェック状態を `mcp-check-state.yaml` としてダウンロード
- **状態を読み込む**: 過去に保存したYAMLファイルを読み込んでチェック状態を復元
  - **注意**: YAMLに記載がないモデルは、デフォルトで `true`（チェックあり）になります
- **クリア**: 読み込んだ状態をリセットし、すべて `true` に戻します

**チェック状態YAML形式の例：**
```yaml
file-upload-kamui-fal: true
t2i-kamui-dreamina-v31: true
t2i-kamui-flux-krea-lora: false
```

### ステップ5: 最終JSONの出力

1. **「4. 最終JSONを出力」** エリアの「出力JSONファイル名」を入力
   - デフォルト: `mcp-kamui-code-filtered`
2. **「JSONを生成して保存」** ボタンをクリック
3. チェックがONのモデルだけを含むJSONファイルがダウンロードされます
   - 元のmcpServers形式と同じ構造で出力されます

## トラブルシューティング

### YAMLファイルが正しく読み込めない
- `features` フィールドにコロン（:）が含まれている場合、文字列全体をダブルクォーテーション（"）で囲んでください
- YAML形式が正しいか確認してください（インデントはスペース2個）

### JSONファイルが読み込めない
- ファイルが正しいJSON形式か確認してください
- `mcpServers` キーがトップレベルに存在するか確認してください

## 開発者向け情報

開発に関する詳細なドキュメントは [`docs/development/`](docs/development/) ディレクトリを参照してください：

- [モデルリリース日調査ルール](docs/development/model_release_date_research_rules.md)
- [リリース日不明のモデル一覧](docs/development/unknown_release_dates.md)

## ライセンス

このプロジェクトの詳細については、リポジトリのライセンスファイルを参照してください。

## 貢献

バグ報告や機能リクエストは、GitHubのIssuesページでお願いします。
