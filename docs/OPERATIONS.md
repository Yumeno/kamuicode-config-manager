# 運用・継承ガイド（Operations & Handover Guide）

> このドキュメントは、本リポジトリを **フォークして自動更新を継承・再開** する方を対象とした運用設定の手引きです。
> 通常の利用方法（Webアプリ・ビューアの使い方）は [README.md](../README.md) を参照してください。

---

## 0. 現在の状態（重要）

**2026-05-25 をもって、すべての自動更新を停止しています。**

| 対象 | 状態 | 停止方法 |
| :--- | :--- | :--- |
| GitHub Actions（カタログ更新） | **停止中** | `.github/workflows/update_catalog.yml` の `schedule` をコメントアウト＋ジョブに `if: false` ガードを付与 |
| GAS（Gemini Auto-Research） | **停止が必要** | Apps Script の時間主導型トリガーを **手動で削除**（リポジトリのコードからは制御不可） |

フォーク後に更新を再開する場合は、本ドキュメントの手順に従って各設定を復元してください。

---

## 1. システム全体像

本リポジトリのデータ（`kamuicode_model_memo.yaml` / `mcp_tool_catalog.yaml`）は、2つの独立した自動更新パイプラインで維持されていました。

```
┌─────────────────────────────────────────────────────────────┐
│ パイプライン A: GAS（Gemini Auto-Research）                   │
│   Google Drive (mcp-kamui-code.json)                         │
│     → GAS (tools/code.js)                                    │
│     → Gemini API でリリース日・詳細を調査                      │
│     → kamuicode_model_memo.yaml を GitHub API でコミット      │
└─────────────────────────────────────────────────────────────┘
┌─────────────────────────────────────────────────────────────┐
│ パイプライン B: GitHub Actions（カタログクローラー）          │
│   Google Drive (設定JSON)                                    │
│     → crawler (tools/crawler/main.py) が各MCPサーバーに接続   │
│     → tools/list を取得                                       │
│     → mcp_tool_catalog.yaml を生成・コミット                  │
└─────────────────────────────────────────────────────────────┘
```

| | パイプライン A (GAS) | パイプライン B (Actions) |
| :--- | :--- | :--- |
| 実行環境 | Google Apps Script | GitHub Actions (ubuntu-latest) |
| 更新対象 | `kamuicode_model_memo.yaml` | `mcp_tool_catalog.yaml` |
| 役割 | モデルの**メタ情報**（名称・リリース日・説明）を調査・追記 | 各MCPサーバーの**ツール仕様**（パラメータ等）を取得 |
| トリガー | GAS の時間主導型トリガー | cron スケジュール（旧: 毎日 UTC 13:00） |
| 設定の保存先 | GAS スクリプトプロパティ | GitHub Secrets |
| 詳細マニュアル | [tools/README.md](../tools/README.md) | [tools/crawler/README.md](../tools/crawler/README.md) |

---

## 2. フォーク後にまず行うこと

1. **既存トリガーが動かないことを確認する**
   - GitHub Actions: フォーク直後は Actions が無効化されていることが多い。`Settings > Actions` で状態を確認。
   - GAS: フォークしてもGASプロジェクトは引き継がれない（別途自分のGoogleアカウントで作成が必要）。
2. **シークレット類はフォークに引き継がれない** ことを理解する。すべて自分の値で再設定が必要（後述）。
3. **再開する/しないを決める**。停止したまま静的なビューアとして使う場合、本ドキュメント以降の設定は不要です。

---

## 3. パイプライン A（GAS）の再開手順

詳細は [tools/README.md](../tools/README.md) を参照。要点のみ記載します。

### 3.1 必要なもの

- Google アカウント（GAS実行用）
- GitHub Personal Access Token（フォーク先リポジトリへの `repo` 書き込み権限）
- Google AI Studio API Key（Gemini API用）
- 監視対象の Google Drive 上 JSON ファイル（または共有フォルダ）へのアクセス権

### 3.2 セットアップ

1. [Google Apps Script](https://script.google.com/) で新規プロジェクトを作成。
2. `tools/code.js` の内容を貼り付ける。
3. **コード内の GitHub リポジトリ参照を自分のフォーク先に書き換える**（owner/repo のハードコード箇所がある場合は要修正）。
4. スクリプトプロパティを設定（下表）。
5. `main` 関数を手動実行し、権限を承認。
6. 時間主導型トリガー（例: 1時間おき）を設定。

### 3.3 スクリプトプロパティ

| プロパティ名 | 必須 | 説明 |
| :--- | :---: | :--- |
| `GEMINI_API_KEY` | ✅ | Google AI Studio の API キー |
| `GITHUB_TOKEN` | ✅ | フォーク先への `repo` 権限を持つ PAT |
| `GEMINI_MODEL_NAME` | ✅ | 使用する Gemini モデル名 |
| `DRIVE_JSON_FILE_IDS` | △ | 監視対象JSONのファイルID（JSON配列、推奨） |
| `DRIVE_JSON_FILE_ID` | △ | 単一ファイルID（後方互換） |
| `DRIVE_FOLDER_ID` | △ | フォルダ再帰探索用（カンマ区切りで複数可） |
| `RESUME_CACHE_FOLDER_ID` | | Resume状態ファイルの保存先フォルダID |

> △ … `DRIVE_JSON_FILE_IDS` / `DRIVE_JSON_FILE_ID` / `DRIVE_FOLDER_ID` のいずれか1つ以上が必須。

### 3.4 停止方法（再掲）

GAS の左メニュー「トリガー（時計アイコン）」から、`main` の時間主導型トリガーを削除すれば停止します。
※ Resume用の継続トリガー（`CONTINUATION_TRIGGER_ID` 管理）は処理完了時に自動削除されるため、手動削除対象は定期実行トリガーのみです。

---

## 4. パイプライン B（GitHub Actions / クローラー）の再開手順

詳細は [tools/crawler/README.md](../tools/crawler/README.md) を参照。

### 4.1 ワークフローを再有効化する

`.github/workflows/update_catalog.yml` を編集します。

1. **ジョブの停止ガードを外す** — `jobs.update-catalog` の `if: false` 行を削除。
2. **スケジュールを復活させる** — `on:` の以下のコメントを解除。
   ```yaml
   on:
     schedule:
       - cron: '0 13 * * *'   # 毎日 UTC 13:00 (JST 22:00)
     workflow_dispatch:
       # ...
   ```

### 4.2 GitHub Secrets を設定する

`Settings > Secrets and variables > Actions` に以下を登録します。

| Secret 名 | 必須 | 説明 |
| :--- | :---: | :--- |
| `KAMUI_CODE_PASS_KEY` | ✅ | MCPサーバー認証用パスキー。ヘッダ内 `${KAMUI_CODE_PASS_KEY}` プレースホルダを置換 |
| `GOOGLE_API_KEY` | ✅ | Google Drive API 用キー（設定JSONの取得に使用） |
| `DRIVE_FILE_IDS` | △ | 取得対象JSONのファイルID（JSON配列形式） |
| `DRIVE_FILE_ID` | △ | 単一ファイルID（後方互換） |
| `DRIVE_FOLDER_ID` | △ | フォルダ再帰探索用（カンマ区切りで複数可） |

> △ … いずれか1つ以上が必須。
> `KAMUI_CODE_PASS_KEY` が未設定の場合、ワークフローは明示的に失敗します（`exit 1`）。

> ⚠️ **パスキー・APIキーは絶対にコミットしないでください。** すべて Secrets 経由で渡します。
> ローカルで `tools/crawler` を動かす場合は `.env` を使い、`.env` が `.gitignore` 対象であることを必ず確認してください。

### 4.3 ローカルでの試験実行

```bash
cd tools/crawler
pip install -r requirements.txt
# .env に上記の値を設定したうえで
python main.py --dry-run --verbose
```

`--dry-run` を付けるとファイル生成・コミットを行わず動作確認のみ可能です。

### 4.4 手動実行（再有効化後）

`Actions > Update MCP Tool Catalog > Run workflow` から `mode`（merge / full_rebuild）と `dry_run` を選んで実行できます。

---

## 5. データスキーマと検証

更新を再開する場合、データ品質を担保する仕組みも合わせて引き継いでください。

- **スキーマ仕様**: `kamuicode_model_memo.yaml` の必須キー・`deprecated` ブロックの仕様は [README.md](../README.md) の「データスキーマ仕様」節を参照。
- **バリデーター**: `tools/validate_model_memo.py` が必須キー・禁止キー・`deprecated` 参照整合性を検査します。
  ```bash
  python tools/validate_model_memo.py
  ```
- **CI**: `.github/workflows/validate.yml` が main への push と関連ファイルの PR で自動的にバリデーターを実行します。このワークフローは **停止対象ではありません**（更新を停止していてもデータ整合性チェックとして有効）。

---

## 6. その他のワークフロー

| ワークフロー | トリガー | 役割 | 停止対象か |
| :--- | :--- | :--- | :---: |
| `update_catalog.yml` | schedule（停止中）/ dispatch | カタログ自動更新 | **停止中** |
| `validate.yml` | push (main) / PR | YAMLスキーマ検証 | 稼働継続 |
| `pages.yml` | push (main) | GitHub Pages デプロイ | 稼働継続 |
| `release.yml` | release created / dispatch | リリース成果物の生成 | 稼働継続 |

`validate` / `pages` / `release` は自動更新とは無関係のため停止していません。フォーク後、GitHub Pages を使う場合は `Settings > Pages` でソースを有効化してください。

---

## 7. チェックリスト（再開時）

- [ ] フォーク先で Actions を有効化した
- [ ] `update_catalog.yml` の `if: false` を削除し `schedule` を復活させた
- [ ] GitHub Secrets（`KAMUI_CODE_PASS_KEY` / `GOOGLE_API_KEY` / Drive ID 系）を登録した
- [ ] GASプロジェクトを自分のアカウントで作成し、スクリプトプロパティとトリガーを設定した
- [ ] GAS コード内の GitHub リポジトリ参照をフォーク先に変更した
- [ ] `python tools/validate_model_memo.py` がローカルで通ることを確認した
- [ ] `.env` や PAT・パスキーがコミットに含まれていないことを確認した

---

*Document created: 2026-05-25 — 自動更新停止に伴う継承ガイドとして作成*
