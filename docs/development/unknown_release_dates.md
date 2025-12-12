# **リリース日が不明なモデルのリスト**

このドキュメントは、Web検索で特定できなかったモデルのリリース日をリストアップするためのものです。

## 調査報告 (2025-12-12 22:06)
- **モデル名**: Wan Vision Enhancer (server_name: `v2v-kamui-fal-wan-vision-enhancer`)
- **推測される開発元**: Fal.ai (Wan-AI / Alibaba Cloud のモデルを利用)
- **調査で確認した情報源**: 
  - Wan 2.1 Open Source Release: 2025年2月25日 (GitHub)
  - Wan 2.5 Preview on Fal: 2025年9月24日 (Fal Blog)
  - Fal 'Recently Added' List: 2025年12月確認時点で掲載あり
- **不明な理由**: Fal.ai 上での 'Wan Vision Enhancer' という名称でのリリース告知記事が見当たらず、正確な提供開始日が特定できません。Wan 2.1 (2月) ベースなのか、Wan 2.5 (9月) ベースなのか、あるいはその後に追加されたFal独自のパイプライン (11-12月頃) なのか判別が困難です。
---
## **✅ 調査完了（2025-11-22）**

調査完了: 8/8モデル（100%）  
調査方法: Web検索（fal.ai公式、GitHub、開発元プレスリリース）  
今回追加されたモデル（ByteDance Lynx, Sana Video, Nano Banana Pro / Gemini 3, SAM 3）については、すべてのリリース日が判明しました。  
kamuicode\_model\_memo.yaml に最新のリリース情報を反映済みです。

## **過去の調査記録**

## ✅ 調査完了（2025-11-10）

**調査完了**: 3/3モデル（100%）
**調査方法**: X（Twitter）のGrok検索 + fal.ai公式アカウントの投稿確認

---

## 判明したリリース日

### 1. Image Apps V2 Outpaint
- **確定リリース日**: 2025年11月5日頃
- **情報源**: fal.aiチームメンバー（@ilkerigz）のXポスト
- **投稿ID**: 1986083564140814647
- **投稿URL**: https://x.com/ilkerigz/status/1986083564140814647
- **備考**: fal.aiの「Image Apps」エンドポイントに新機能（Outpaint）が追加されたことを発表

### 2. Easel AI Fashion Size Estimator
- **確定リリース日**: 2025年9月4日頃
- **情報源**: Easel AI公式Xポスト
- **投稿ID**: 1961165948368687329
- **投稿URL**: https://x.com/easel_ai/status/1961165948368687329
- **備考**: Easel AIの「Fashion Size Estimator」モデルがfal.aiで利用可能であることを発表

### 3. ByteDance Video Upscaler
- **確定リリース日**: 2025年11月4日
- **情報源**: fal.ai公式Xポスト
- **投稿ID**: 1985768545595130015
- **投稿URL**: https://x.com/fal/status/1985768545595130015
- **備考**: ByteDance Video Upscalerのfal.ai上での提供開始を明確に告知（1080p/2K/4Kアップスケール、$0.0072/s）

---

## 以下は調査前の記録（参考資料）

### 不明モデル一覧（調査前）

### 1. Image Apps V2 Outpaint
- **モデル名**: Image Apps V2 Outpaint
- **server_name**: `i2i-kamui-image-apps-v2-outpaint`
- **推測される開発元**: fal.ai（独自開発）
- **調査で確認した情報源**:
  - fal.ai モデルページ: https://fal.ai/models/fal-ai/image-apps-v2/outpaint
  - 機能説明: 方向性を持ったアウトペイント（左、右、上、中央）、拡張された領域のみを生成
- **不明な理由**: fal.aiの公式ブログやX投稿で明確なリリース日のアナウンスが見つからなかった
- **備考**: モデルは現在fal.aiで利用可能。第三者ツール（Toolplay.aiなど）でも使用されている

### 2. Easel AI Fashion Size Estimator
- **モデル名**: Easel AI Fashion Size Estimator
- **server_name**: `i2i-kamui-easel-ai-fashion-size-estimator`
- **推測される開発元**: Easel AI
- **調査で確認した情報源**:
  - fal.ai モデルページ: https://fal.ai/models/easel-ai/fashion-size-estimator
  - fal.ai ブログ（2025年3月）: Easel AIの画像編集モデルがfal.aiで利用可能になった旨の記事
  - 機能説明: 人体画像から服のサイズ（S/M/L/XL）と身体測定値（身長、バスト、ウエスト、ヒップ）を推定
  - 価格: $0.01/生成
- **不明な理由**: Easel AIのfal.ai統合は2025年3月頃と判明したが、Fashion Size Estimatorの具体的なリリース日は不明
- **備考**: Easel AIは他にもFashion Photoshoot、Fashion Try-on、Face/Body Swapモデルをfal.aiで提供している

### 3. ByteDance Video Upscaler
- **モデル名**: ByteDance Video Upscaler
- **server_name**: `v2v-kamui-bytedance-upscale-video`
- **推測される開発元**: ByteDance
- **調査で確認した情報源**:
  - fal.ai モデルページ: https://fal.ai/models/fal-ai/bytedance-upscaler/upscale/video
  - fal.ai X（Twitter）投稿: ByteDance Video Upscalerの提供開始を告知
    - ツイートURL: https://x.com/fal/status/1985768545595130015
  - 機能説明: 1080p、2K、4K解像度へのアップスケール、30/60fps対応、プロフェッショナルグレードの品質向上
  - 価格: $0.0072/秒（1080pアップスケール）
- **不明な理由**: fal.aiのX投稿やモデルページは確認できたが、正確なリリース日（年月日）が記載されていなかった
- **備考**:
  - X投稿のステータスID（1985768545595130015）から、おおよその投稿時期を特定できる可能性がある
  - Topaz Video AIやSima Upscalerなど、他のビデオアップスケーラーもfal.aiで提供されている

## 追加調査の推奨事項

### X（Twitter）での調査キーワード例
1. **Image Apps V2 Outpaint**:
   - `fal.ai image apps v2 outpaint`
   - `@fal outpaint release`
   - `fal.ai directional outpainting`

2. **Easel AI Fashion Size Estimator**:
   - `easel ai fashion size estimator release`
   - `@fal easel ai fashion`
   - `easel ai fal.ai march 2025`

3. **ByteDance Video Upscaler**:
   - `fal.ai bytedance upscaler`
   - `@fal bytedance video upscaler`
   - ステータスID `1985768545595130015` から投稿日時を特定

### その他の調査方法
- fal.aiのGitHubリポジトリのコミット履歴を確認
- fal.aiのChangelogを確認
- ByteDanceの公式リリース情報を確認（Seedance Upscalerなどの関連モデル）
- Easel AIの公式ウェブサイトやブログを確認

## まとめ

- **調査完了**: 18/21モデル（85.7%）
- **要追加調査**: 3/21モデル（14.3%）

これらのモデルについて、X（Twitter）のGrokを使用した調査を実施することで、より正確なリリース日を特定できる可能性があります。
