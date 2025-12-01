# GitHub Releases セットアップガイド

GitHub Releases 機能を使用して、ユーザー向け配布パッケージ（ZIP）を作成・公開する手順をまとめます。

## 概要

GitHub Releases を利用することで、ユーザーは以下のメリットを得られます：

- バージョン管理された安定版をダウンロード可能
- 変更履歴（リリースノート）の確認
- 必要なファイルのみを含むZIPパッケージの配布

## リリースに含めるファイル

ユーザー配布用パッケージには以下のファイルを含めます：

```
kamuicode-config-manager-vX.X.X.zip
├── kamuicode-config-manager.html  # メインアプリケーション
├── kamuicode_model_memo.yaml      # モデル定義ファイル
├── mcp_tool_catalog.yaml          # MCPツールカタログ
└── README.md                      # 使い方ガイド
```

> **注意**: `tools/`, `docs/`, `.claude/`, `.github/` などの開発用ファイルは含めません。

> **Note**: YAMLファイルはアプリ内からWeb取得も可能ですが、オフライン利用のため同梱しています。

## 自動リリース（GitHub Actions）

タグをプッシュすると、GitHub Actions が自動でリリースを作成します。

### ワークフローの仕組み

`.github/workflows/release.yml` により、以下が自動実行されます：

1. `v*` パターンのタグプッシュを検知
2. 配布用ファイルをZIPにパッケージング
3. GitHub Releaseを作成し、ZIPをアップロード
4. コミット履歴からリリースノートを自動生成

### リリース手順

#### 1. リリース準備

```bash
# 最新の main ブランチに切り替え
git checkout main
git pull origin main

# 変更内容を確認
git log --oneline -10
```

#### 2. バージョンタグの作成

セマンティックバージョニング（SemVer）に従います：
- **メジャー** (X.0.0): 破壊的変更
- **マイナー** (0.X.0): 新機能追加
- **パッチ** (0.0.X): バグ修正

```bash
# タグを作成（例: v1.0.0）
git tag -a v1.0.0 -m "Release v1.0.0: YAML Web更新機能を追加"

# リモートにプッシュ（これにより自動リリースがトリガーされる）
git push origin v1.0.0
```

#### 3. リリースの確認

1. リポジトリの **[Actions](../../actions)** タブでワークフローの実行状況を確認
2. 成功すると **[Releases](../../releases)** ページに新しいリリースが作成される
3. 必要に応じてリリースノートを編集

### ワークフロー設定

```yaml
# .github/workflows/release.yml
name: Release

on:
  push:
    tags:
      - 'v*'

jobs:
  release:
    runs-on: ubuntu-latest
    permissions:
      contents: write

    steps:
      - name: Checkout repository
        uses: actions/checkout@v4

      - name: Get version from tag
        id: version
        run: echo "VERSION=${GITHUB_REF#refs/tags/}" >> $GITHUB_OUTPUT

      - name: Create Release ZIP
        run: |
          mkdir release
          cp kamuicode-config-manager.html release/
          cp kamuicode_model_memo.yaml release/
          cp mcp_tool_catalog.yaml release/
          cp README.md release/
          cd release
          zip -r ../kamuicode-config-manager-${{ steps.version.outputs.VERSION }}.zip .

      - name: Create GitHub Release
        uses: softprops/action-gh-release@v2
        with:
          files: kamuicode-config-manager-${{ steps.version.outputs.VERSION }}.zip
          generate_release_notes: true
          draft: false
          prerelease: false
```

## 手動リリース（オプション）

自動リリースを使わず、手動でリリースを作成することも可能です。

### 1. GitHub上でリリースを作成

1. リポジトリの **[Releases](../../releases)** ページにアクセス
2. **「Draft a new release」** をクリック
3. 以下を入力：
   - **Choose a tag**: 作成したタグ（例: `v1.0.0`）を選択
   - **Release title**: `v1.0.0: YAML Web更新機能を追加`
   - **Description**: 変更内容をMarkdownで記述（テンプレート参照）

### 2. 配布用ZIPファイルの作成

```bash
# 一時ディレクトリで作業
mkdir -p /tmp/release-build
cd /tmp/release-build

# 必要なファイルのみコピー
cp /path/to/repo/kamuicode-config-manager.html .
cp /path/to/repo/kamuicode_model_memo.yaml .
cp /path/to/repo/mcp_tool_catalog.yaml .
cp /path/to/repo/README.md .

# ZIP作成
zip -r kamuicode-config-manager-v1.0.0.zip .
```

### 3. ZIPファイルのアップロード

1. リリース編集画面の **「Attach binaries」** エリアにZIPをドラッグ＆ドロップ
2. **「Publish release」** をクリック

## リリースノートのテンプレート

```markdown
## 変更内容

### 新機能
- YAML Web更新機能: GitHubから最新のモデル定義を取得可能に
- カスタムYAMLモード: ローカルファイルの読み込みに対応
- 設定の永続化: 次回起動時に設定を自動復元
- MCPツールカタログ: 各サーバーのツール詳細を閲覧可能

### 改善
- UIの改善: モード選択がラジオボタン式に変更

### バグ修正
- なし

## インストール方法

1. `kamuicode-config-manager-vX.X.X.zip` をダウンロード
2. 任意のフォルダに解凍
3. `kamuicode-config-manager.html` をブラウザで開く

## 動作環境

- モダンブラウザ（Chrome, Firefox, Edge, Safari の最新版）
- JavaScript有効
- インターネット接続（Web更新機能使用時）
```

## フォルダ構成

```
/ (ルート)
├── kamuicode-config-manager.html  # メインアプリケーション
├── kamuicode_model_memo.yaml      # モデル定義ファイル
├── mcp_tool_catalog.yaml          # MCPツールカタログ（自動更新）
├── README.md                      # ユーザー向けドキュメント
├── .github/
│   └── workflows/
│       ├── release.yml            # 自動リリースワークフロー
│       └── update_catalog.yml     # カタログ自動更新ワークフロー
├── tools/                         # 開発ツール
│   ├── code.js                    # Auto Updater (GAS)
│   ├── crawler/                   # MCPカタログクローラー
│   └── README.md
└── docs/                          # 開発者向けドキュメント
    ├── README.md                  # ドキュメント目次
    ├── github_releases_setup.md   # このファイル
    └── development/               # 開発者向け詳細ドキュメント
        ├── model_release_date_research_rules.md
        └── unknown_release_dates.md
```

## 参考リンク

- [GitHub Docs: リリースの管理](https://docs.github.com/ja/repositories/releasing-projects-on-github/managing-releases-in-a-repository)
- [Semantic Versioning](https://semver.org/lang/ja/)
- [softprops/action-gh-release](https://github.com/softprops/action-gh-release)
