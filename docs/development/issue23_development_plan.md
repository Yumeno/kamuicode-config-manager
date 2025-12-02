# Issue #23: server_name接頭辞に基づくモデルカテゴリ再編成 - 開発計画書

## 概要

server_nameの接頭辞（例: t2i, i2v 等）に基づいた厳格なルールでモデルカテゴリを統一し、自動更新スクリプトにマスタ参照ロジックと未知接頭辞の自動学習機能を実装する。

## 作業スケジュール

### Phase 1: 基盤整備

#### 1.1 カテゴリマスタファイルの作成
- **ファイル**: `tools/category_master.json`
- **内容**: server_name接頭辞とカテゴリキーのマッピング定義
- **データ構造**:
```json
{
  "prefix_to_category": {
    "t2i": {
      "category_key": "text_to_image",
      "description": "テキストからの画像生成"
    }
  }
}
```

#### 1.2 接頭辞抽出ロジックの設計
- `server_name`の形式: `{prefix}-kamui-{model_name}` または `{prefix}-kamui-{provider}-{model_name}`
- 抽出方法: 最初のハイフンより前の部分、または`kamui`の直前までの部分

### Phase 2: 機能実装

#### 2.1 既存YAML再カテゴライズ機能
- `tools/code.js`に新規関数 `recategorizeExistingModels()` を追加
- 全エントリを読み込み、接頭辞に基づいてカテゴリを再割り当て
- 結果をYAMLに保存

#### 2.2 自動更新ロジックの改修
- `researchModelWithGemini()`関数の修正
- マスタ照合ロジックの追加
- 未知接頭辞時のGemini活用とマスタ自動更新機能

### Phase 3: 表示・ドキュメント整備

#### 3.1 Webビューア対応確認
- `docs/index.html`のカテゴリフィルタ動作確認
- 新カテゴリキーでの正常表示確認

#### 3.2 ドキュメント更新
- `tools/README.md`の仕様詳細セクション更新
- 新規接頭辞の扱いについて追記

## 接頭辞とカテゴリのマッピング

| 接頭辞 | カテゴリキー | 説明 |
|--------|-------------|------|
| 3d23d | 3d_to_3d | 3Dモデルのリメッシュ、最適化 |
| a2t | audio_to_text | 音声認識、音声内容の解析・理解 |
| a2v | audio_to_video | 音声からのアバター動画生成 |
| file-upload | utility_and_analysis | ファイルアップロード用ユーティリティ |
| flf2v | frame_to_video | 始点・終点フレーム指定の動画生成 |
| i2i | image_to_image | 画像編集、スタイル変換、アップスケーリング |
| i2i3d | image_to_3d | 画像からの3Dモデル生成 |
| i2v | image_to_video | 画像からの動画生成 |
| misc | miscellaneous | その他、複合機能 |
| r2v | reference_to_video | 参照画像/動画を用いた動画生成 |
| s2v | speech_to_video | 音声からの動画生成 |
| t2a | text_to_audio | テキストからの効果音生成 |
| t2i | text_to_image | テキストからの画像生成 |
| t2i3d | text_to_3d | テキストからの3Dモデル生成 |
| t2m | text_to_music | テキストからの音楽生成 |
| t2s | text_to_speech | 音声合成（読み上げ） |
| t2v | text_to_video | テキストからの動画生成 |
| t2visual | text_to_visual | テキストからの図解・グラフィック生成 |
| train | training | LoRA学習、ファインチューニング |
| tts | text_to_speech | 音声合成（Klingモデル等での別表記） |
| v2a | video_to_audio | 動画からの音声・効果音生成 |
| v2sfx | video_to_sfx | 動画に合わせた効果音生成 |
| v2v | video_to_video | 動画編集、変換、リップシンク、背景除去 |
| video-analysis | utility_and_analysis | 動画解析 |
| voice-clone | voice_clone | 音声クローン |

## 完了条件

- [x] `tools/category_master.json` が作成されていること
- [x] `kamuicode_model_memo.yaml` の全エントリが接頭辞ルールに従って再配置されていること（※GAS環境で `recategorizeExistingModels()` を実行）
- [x] `tools/code.js` にマスタ参照ロジックと未知接頭辞の自動学習機能が実装されていること
- [x] `docs/index.html` でモデル一覧が正しくカテゴリ分けされて表示・検索できること
- [x] `tools/README.md` が最新の仕様に合わせて更新されていること

## 作成日

2025-12-02

## 関連Issue

- Issue #23: Feature: server_name接頭辞に基づくモデルカテゴリの再編成と自動化ツールの改修
