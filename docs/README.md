# **docs/ \- ドキュメントディレクトリ**

このディレクトリには、kamuicode Config Manager の開発・運用に関するドキュメントが含まれています。

## **ドキュメント一覧**

### **ツール・リファレンス**

| ファイル | 説明 |
| :---- | :---- |
| [index.html](./index.html) | **KamuiCode MCP Tool List** リモートMCPサーバー集 "KamuiCode" のツール定義とモデル情報を閲覧するためのWebビューア。kamuicode\_model\_memo.yaml と mcp\_tool\_catalog.yaml を動的に読み込んで表示します。 |

### **運用ガイド**

| ファイル | 説明 |
| :---- | :---- |
| [github\_releases\_setup.md](./github_releases_setup.md) | GitHub Releases を使用した配布パッケージ（ZIP）の作成・公開手順 |

### **開発ドキュメント**

| ファイル | 説明 |
| :---- | :---- |
| [development/mcp\_tool\_catalog\_development\_plan.md](./development/mcp_tool_catalog_development_plan.md) | MCPツールカタログ自動生成機能（Pythonクローラー）の開発計画書 |
| [development/mcp\_tool\_catalog\_progress.md](./development/mcp_tool_catalog_progress.md) | MCPツールカタログ自動生成機能の実装進捗とテスト結果の記録 |
| [development/model\_release\_date\_research\_rules.md](./development/model_release_date_research_rules.md) | AIモデルのリリース日調査に関するルールと手順 |
| [development/unknown\_release\_dates.md](./development/unknown_release_dates.md) | リリース日が不明なモデルの一覧と調査ログ |

## **ディレクトリ構成**

docs/  
├── README.md                              \# このファイル  
├── index.html                             \# KamuiCode ツールリスト (Webビューア)  
├── github\_releases\_setup.md               \# Releases設定手順書  
└── development/                           \# 開発者向けドキュメント  
    ├── mcp\_tool\_catalog\_development\_plan.md \# カタログ自動生成 開発計画  
    ├── mcp\_tool\_catalog\_progress.md         \# カタログ自動生成 進捗記録  
    ├── model\_release\_date\_research\_rules.md \# 調査ルール  
    └── unknown\_release\_dates.md             \# 不明モデルリスト

## **関連リンク**

* [ルートREADME](../README.md) \- プロジェクトの概要と使い方  
* [tools/README.md](../tools/README.md) \- GAS版 Auto Updater の説明  
* [tools/crawler/README.md](../tools/crawler/README.md) \- MCPカタログクローラー（Python）の説明
