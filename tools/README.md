# **kamuicode Config Manager Auto Updater**

Google Apps Script (GAS) を使用して、AIモデル情報の調査と設定ファイルの更新を自動化するシステムの設計書および利用マニュアルです。

## **1\. 概要**

mcp-kamui-code.json（Google Drive上の共有ファイル）に加えられた変更を検知し、新規に追加されたAIモデルについて Google Gemini API を使用して詳細情報（正式名称、リリース日、開発元、カテゴリ）を調査します。調査結果に基づき、GitHubリポジトリ上の YAMLファイルおよび Markdownファイルを自動的に更新・コミットします。

## **2\. 要件定義**

### **2.1. 目的**

* 人手によるAIモデルのリリース日調査とYAMLファイル作成の工数を削減する。  
* 常に最新のモデル情報をリポジトリに反映させる。

### **2.2. 主な機能**

1. **差分検知**: mcp-kamui-code.json と GitHub上の kamuicode\_model\_memo.yaml を比較し、未登録のモデルを特定する。  
2. **自動調査 (Deep Research)**: Gemini API と Google検索ツールを利用し、モデルのリリース日や詳細をWebから調査する。  
   * 表記ゆれ（例: flux-2 \-\> FLUX.2）を考慮した検索を行う。  
   * 開発元の特定と裏付け調査を行う。  
3. **ファイル更新**:  
   * **リリース日判明時**: kamuicode\_model\_memo.yaml の適切なカテゴリブロック末尾に情報を追記する。  
   * **リリース日不明時**: docs/development/unknown\_release\_dates.md の冒頭に調査報告を追記する。  
4. **GitHub連携**: 更新内容を GitHub API 経由でリポジトリにコミット・プッシュする。  
   * コミットメッセージには Issue番号 (Refs \#2) を自動付与する。  
5. **長時間実行対応 (Resume機能)**: GASの実行時間制限（6分）を回避するため、制限時間が近づくと処理を中断し、自動的に再開トリガーをセットして次回実行に引き継ぐ。

## **3\. システム設計**

### **3.1. システム構成図**

graph TD  
    Drive\[Google Drive\<br\>(mcp-kamui-code.json)\] \--\>|Fetch| GAS\[Google Apps Script\]  
    GitHub\_R\[GitHub Repo\<br\>(Read)\] \--\>|Fetch YAML/Rules| GAS  
    GAS \--\>|Deep Research| Gemini\[Gemini API\<br\>(Google Search)\]  
    Gemini \--\>|Result| GAS  
    GAS \--\>|Commit/Push| GitHub\_W\[GitHub Repo\<br\>(Write)\]  
    GAS \--\>|Resume Trigger| GAS

### **3.2. 処理フロー**

1. **初期化 & キュー確認**:  
   * スクリプトプロパティから設定を読み込む。  
   * 前回の未完了タスク（キュー）があるか確認。  
2. **データ取得 & 差分抽出 (新規セッション時)**:  
   * Google Drive から JSON を取得。  
   * GitHub から現在の YAML を取得。  
   * 差分（新規モデルリスト）を作成し、プロパティに保存。  
3. **調査ループ (Gemini)**:  
   * キューからモデルを1つ取り出す。  
   * Geminiモデル（例: gemini-1.5-pro）に調査プロンプトを送信。  
   * **カテゴリ判定**: 既存の YAML カテゴリ構造と照合。  
   * **YAML生成**: インデントなしのYAMLエントリを生成。  
4. **結果の蓄積**:  
   * 調査結果（YAML追記用データ or 不明リスト用データ）をメモリに保持。  
5. **制限時間チェック**:  
   * 実行開始から一定時間（例: 4.5分）経過したら、現在の状態を保存して処理を中断。  
   * 1分後の再開トリガーをセットして終了。  
6. **コミット実行**:  
   * 全キューの処理が完了したら、GitHub API でファイルを更新。  
   * YAML: カテゴリごとのブロック末尾に挿入（インデント自動調整）。  
   * Markdown: 最新の履歴が上に来るように挿入。

## **4\. セットアップ手順**

### **4.1. 前提条件**

* Google アカウント (GAS実行用)  
* GitHub アカウント (リポジトリへの書き込み権限あり)  
* Google AI Studio API Key (Gemini API利用用)

### **4.2. GASプロジェクトの作成**

1. [Google Apps Script](https://script.google.com/) にアクセスし、「新しいプロジェクト」を作成。  
2. エディタに tools/code.js のコードを貼り付ける。

### **4.3. スクリプトプロパティの設定**

GASエディタの「プロジェクトの設定 (歯車アイコン)」 \> 「スクリプト プロパティ」に以下を追加してください。

| プロパティ名 | 必須 | 値の例 / 説明 |
| :---- | :---- | :---- |
| GEMINI\_API\_KEY | ✅ | AIzaSy... (Google AI Studioで取得したAPIキー) |
| GITHUB\_TOKEN | ✅ | ghp\_... (GitHub Personal Access Token, repo 権限必須) |
| GEMINI\_MODEL\_NAME | ✅ | gemini-1.5-pro (使用するGeminiモデル名) |
| DRIVE\_JSON\_FILE\_IDS | △ | JSON配列形式 (下記参照) - 推奨 |
| DRIVE\_JSON\_FILE\_ID | △ | 1A2b3C... (単一ファイルID、後方互換用) |
| DRIVE\_FOLDER\_ID | △ | 1FolderID... (フォルダ再帰探索用 - Issue #30) |

**△注意**: `DRIVE_JSON_FILE_IDS`、`DRIVE_JSON_FILE_ID`、`DRIVE_FOLDER_ID` のいずれか1つ以上が必須です。

#### **マルチソースJSON形式 (DRIVE\_JSON\_FILE\_IDS)**

複数のGoogle DriveファイルIDを指定でき、後方のファイルの設定が優先されます（後勝ち）。

```json
[
  {"name": "Legacy", "id": "1ABC_legacy_file_id"},
  {"name": "Latest", "id": "1XYZ_latest_file_id"}
]
```

* **name**: ログ表示用のラベル（任意の名前）
* **id**: Google DriveのファイルID
* **優先順位**: リストの後方に記述されたファイルを優先（後勝ち）

**後方互換性**: `DRIVE_JSON_FILE_IDS` が未設定の場合、`DRIVE_JSON_FILE_ID` (単一ID) がフォールバックとして使用されます。

#### **フォルダ再帰探索 (DRIVE\_FOLDER\_ID) - Issue #30 新機能**

指定したGoogle Driveフォルダ以下を再帰的に探索し、条件を満たすMCP設定ファイルを自動検出します。

```
DRIVE_FOLDER_ID=1FolderID_Here
```

**フィルタリング条件**:

| 条件 | 説明 |
| :---- | :---- |
| 更新日時 | 2025年11月20日以降に更新されたファイルのみ |
| 拡張子 | `.json` ファイルのみ |
| 構造チェック | ルートオブジェクトに `mcpServers` キー（オブジェクト型）を持つこと |

**優先順位**:
* `DRIVE_JSON_FILE_IDS`/`DRIVE_JSON_FILE_ID` で指定したファイルが先に読み込まれます
* `DRIVE_FOLDER_ID` で発見されたファイルの設定は後からマージされます（後勝ち）
* 同じ `server_name` がある場合、フォルダスキャンの設定が優先されます

**使用例**:
```
# 個別ファイルとフォルダの併用
DRIVE_JSON_FILE_IDS=[{"name": "Default", "id": "1ABC..."}]
DRIVE_FOLDER_ID=1FolderID_Here
```

この設定では、まず `1ABC...` のファイルを読み込み、その後 `1FolderID_Here` フォルダ内の有効なJSONファイルを全て探索してマージします。

### **4.4. 初回実行と権限承認**

1. 関数プルダウンから main を選択し、「実行」をクリック。  
2. Google Drive, 外部サービスへの接続(UrlFetchApp), トリガー操作に関する権限承認ポップアップが表示されるので、「許可」する。

### **4.5. 定期実行の設定（運用時）**

継続的に監視する場合は、トリガーを設定します。

1. 左メニューの「トリガー (時計アイコン)」をクリック。
2. 「トリガーを追加」:
   * 実行する関数: main
   * イベントのソース: 時間主導型
   * タイプ: 時間ベースのタイマー
   * 間隔: 1時間おき (または任意の頻度)

> **💡 注意: 定期実行トリガーとResume機能について**
> 本スクリプトにはGASの実行時間制限（6分）を回避するためのResume機能が搭載されています。処理がタイムアウトしそうになると、自動的に「継続用トリガー」を作成して処理を中断し、1分後に再開します。
> この継続用トリガーはスクリプトプロパティ `CONTINUATION_TRIGGER_ID` でID管理されており、処理完了時にはこのIDと一致するトリガーのみが削除されます。ユーザーが手動で設定した定期実行トリガーは削除されません。

## **5\. 仕様詳細**

### **カテゴリ判定ロジック (v2.0 - 接頭辞ベース)**

* **マスタファイル参照**: カテゴリ判定は `tools/category_master.json` に定義された接頭辞マッピングに基づいて行われます。
* **接頭辞抽出**: `server_name` の形式 `{prefix}-kamui-{model_name}` から、`kamui` の直前までを接頭辞として抽出します。
  * 例: `t2i-kamui-flux-schnell` → 接頭辞 `t2i` → カテゴリ `text_to_image`
* **マスタ照合**:
  * 接頭辞がマスタに存在する場合: マスタに定義されたカテゴリキーを使用
  * 接頭辞がマスタに存在しない場合: Gemini APIで推論し、結果をマスタに自動追加

### **新規接頭辞の自動学習**

未知の接頭辞が出現した場合、以下のフローで処理されます:

1. `server_name` から接頭辞を抽出
2. `category_master.json` に該当する接頭辞がないことを確認
3. Gemini APIを使用して、モデルの説明文から適切なカテゴリキーと説明を推論
4. 推論結果を `category_master.json` に自動追加・コミット
5. 新しいカテゴリキーを使用してYAMLに追記

### **YAML追記ルール**

* **挿入位置**: 既存の YAML 内に該当カテゴリのブロックがあれば、そのブロックの末尾に追記します。なければファイル末尾に新設します。
* **フォーマット**:
      \- name: モデル正式名称
        server\_name: server-name-id
        release\_date: YYYY年MM月DD日
        features: "(開発元) 説明文..."

### **既存YAMLの再カテゴライズ**

`recategorizeExistingModels()` 関数を実行することで、既存の `kamuicode_model_memo.yaml` の全エントリを接頭辞ルールに従って再配置できます。これはワンショット実行用の機能です。

### **不明モデルの扱い**

* 調査の結果、リリース日が特定できなかったモデルは YAML には追記されません。
* 代わりに docs/development/unknown\_release\_dates.md に調査ログ（不明理由、参照ソース）が追記されます。

### **コミットメッセージ**

* 自動更新によるコミットには (Refs \#2) が付与され、GitHub Issues \#2 に関連付けられます。
* カテゴリマスタの自動更新には (Refs \#23) が付与されます。

## **6\. 接頭辞とカテゴリのマッピング**

現在定義されている接頭辞とカテゴリの対応は以下の通りです:

| 接頭辞 | カテゴリキー | 説明 |
|--------|-------------|------|
| t2i | text\_to\_image | テキストからの画像生成 |
| i2i | image\_to\_image | 画像編集、スタイル変換、アップスケーリング |
| t2v | text\_to\_video | テキストからの動画生成 |
| i2v | image\_to\_video | 画像からの動画生成 |
| v2v | video\_to\_video | 動画編集、変換、リップシンク、背景除去 |
| r2v | reference\_to\_video | 参照画像/動画を用いた動画生成 |
| flf2v | frame\_to\_video | 始点・終点フレーム指定の動画生成 |
| s2v | speech\_to\_video | 音声からの動画生成 |
| a2v | audio\_to\_video | 音声からのアバター動画生成 |
| t2s | text\_to\_speech | 音声合成（読み上げ） |
| tts | text\_to\_speech | 音声合成（別表記） |
| t2a | text\_to\_audio | テキストからの効果音生成 |
| t2m | text\_to\_music | テキストからの音楽生成 |
| v2a | video\_to\_audio | 動画からの音声・効果音生成 |
| v2sfx | video\_to\_sfx | 動画に合わせた効果音生成 |
| a2t | audio\_to\_text | 音声認識、音声内容の解析・理解 |
| t2visual | text\_to\_visual | テキストからの図解・グラフィック生成 |
| i2i3d | image\_to\_3d | 画像からの3Dモデル生成 |
| t2i3d | text\_to\_3d | テキストからの3Dモデル生成 |
| 3d23d | 3d\_to\_3d | 3Dモデルのリメッシュ、最適化 |
| train | training | LoRA学習、ファインチューニング |
| file-upload | utility\_and\_analysis | ファイルアップロード用ユーティリティ |
| video-analysis | utility\_and\_analysis | 動画解析 |
| voice-clone | voice\_clone | 音声クローン |
| misc | miscellaneous | その他、複合機能 |

*Document created: 2025-11-28*
*Updated: 2025-12-02 (Issue #23 対応)*
*Updated: 2025-12-06 (Issue #26 マルチソースJSON対応)*
*Updated: 2025-12-17 (Issue #30 フォルダ再帰探索機能追加)*