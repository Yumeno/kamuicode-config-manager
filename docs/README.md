# docs/ - ドキュメントディレクトリ

このディレクトリには、kamuicode Config Manager の開発・運用に関するドキュメントが含まれています。

## ドキュメント一覧

### 運用ガイド

| ファイル | 説明 |
|----------|------|
| [github_releases_setup.md](./github_releases_setup.md) | GitHub Releases を使用した配布パッケージ（ZIP）の作成・公開手順 |

### 開発ドキュメント

| ファイル | 説明 |
|----------|------|
| [development/model_release_date_research_rules.md](./development/model_release_date_research_rules.md) | AIモデルのリリース日調査に関するルールと手順 |
| [development/unknown_release_dates.md](./development/unknown_release_dates.md) | リリース日が不明なモデルの一覧と調査ログ |

## ディレクトリ構成

```
docs/
├── README.md                              # このファイル
├── github_releases_setup.md               # Releases設定手順書
└── development/                           # 開発者向けドキュメント
    ├── model_release_date_research_rules.md
    └── unknown_release_dates.md
```

## 関連リンク

- [ルートREADME](../README.md) - プロジェクトの概要と使い方
- [tools/README.md](../tools/README.md) - 開発ツール（Auto Updater）の説明
