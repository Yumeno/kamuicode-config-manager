# Issue #26: Multi-source JSON with Last-one-wins Priority - 開発計画書

## 概要

MCPサーバーの設定情報が複数のJSONファイルに分散している状況に対応するため、複数のファイルIDを受け入れ可能にする。GAS（更新検知）とPython（クローラー）の両方で**「リストの後方に記述されたファイルを優先する（後勝ち）」**という統一ルールで実装し、設定の一貫性を保つ。

## 運用イメージ

```
DRIVE_FILE_IDS = "ID_Old, ID_New"
```

- **GAS**: `ID_Old` を読み込み、その上に `ID_New` を上書きマージして調査対象リストを作成
- **Python**: まず `ID_New` のURLで接続を試行。もし死んでいれば `ID_Old` のURLでリトライ

---

## Phase 1: Google Apps Script (tools/code.js) の改修

### 1.1 設定プロパティの変更

**現状:**
```javascript
const driveFileId = props.getProperty('DRIVE_JSON_FILE_ID');
```

**変更後:**
```javascript
// JSON配列形式: ["file_id_1", "file_id_2", ...]
const driveFileIdsJson = props.getProperty('DRIVE_JSON_FILE_IDS');
const driveFileIds = JSON.parse(driveFileIdsJson || '[]');
```

| 項目 | 内容 |
|------|------|
| プロパティ名 | `DRIVE_JSON_FILE_IDS` |
| 形式 | JSON配列文字列 |
| 例 | `["1ABC...", "1XYZ..."]` |
| 後方互換性 | 単一IDも配列に変換して処理 |

### 1.2 更新検知ロジックの追加

ファイルごとに `modifiedTime` をチェックし、変更があった場合のみダウンロード処理を実行する。

**新規追加関数:**

```javascript
/**
 * 複数ファイルの更新を検知し、変更があるファイルのみ取得
 * @param {string[]} fileIds - DriveファイルIDの配列
 * @returns {{ fileId: string, content: object }[]} 変更があったファイルの内容
 */
function fetchModifiedFiles(fileIds) {
  const props = PropertiesService.getScriptProperties();
  const lastModifiedTimes = JSON.parse(props.getProperty('LAST_MODIFIED_TIMES') || '{}');

  const modifiedFiles = [];
  const newModifiedTimes = {};

  for (const fileId of fileIds) {
    const file = DriveApp.getFileById(fileId);
    const currentModified = file.getLastUpdated().toISOString();
    newModifiedTimes[fileId] = currentModified;

    if (lastModifiedTimes[fileId] !== currentModified) {
      const content = JSON.parse(file.getBlob().getDataAsString());
      modifiedFiles.push({ fileId, content });
    }
  }

  props.setProperty('LAST_MODIFIED_TIMES', JSON.stringify(newModifiedTimes));
  return modifiedFiles;
}
```

### 1.3 マージロジック（後勝ち）の実装

リストの先頭から順に `mcpServers` オブジェクトをマージし、同一IDがある場合は後方のファイルが前方を上書きする。

**新規追加関数:**

```javascript
/**
 * 複数のMCP設定をマージする（後勝ち）
 * @param {string[]} fileIds - ファイルID配列（先頭から読み込み、後方が優先）
 * @returns {object} マージされたmcpServersオブジェクト
 */
function mergeConfigsLastWins(fileIds) {
  let mergedServers = {};

  for (const fileId of fileIds) {
    const file = DriveApp.getFileById(fileId);
    const content = JSON.parse(file.getBlob().getDataAsString());
    const servers = content.mcpServers || {};

    // 後勝ち: Object.assignで上書き
    mergedServers = { ...mergedServers, ...servers };
  }

  return { mcpServers: mergedServers };
}
```

### 1.4 main() 関数の改修ポイント

1. `DRIVE_JSON_FILE_ID` → `DRIVE_JSON_FILE_IDS` に変更
2. JSON配列をパースして複数ファイルIDを取得
3. `mergeConfigsLastWins()` でマージした結果を使用
4. エラーハンドリング: 個別ファイルの取得失敗時もログを出力して続行

---

## Phase 2: Python Crawler (tools/crawler/) の改修

### 2.1 環境変数の変更

**現状 (main.py:117):**
```python
drive_file_id = os.environ.get("DRIVE_FILE_ID")
```

**変更後:**
```python
# カンマ区切り形式: "file_id_1,file_id_2"
drive_file_ids_str = os.environ.get("DRIVE_FILE_IDS", "")
drive_file_ids = [fid.strip() for fid in drive_file_ids_str.split(",") if fid.strip()]
```

| 項目 | 内容 |
|------|------|
| 環境変数名 | `DRIVE_FILE_IDS` |
| 形式 | カンマ区切り文字列 |
| 例 | `1ABC...,1XYZ...` |
| 後方互換性 | `DRIVE_FILE_ID` もフォールバックとして対応 |

### 2.2 DriveClient の複数ファイル対応

**ファイル:** `tools/crawler/src/drive_client.py`

**新規追加メソッド:**

```python
async def fetch_mcp_configs_multi(
    self, file_ids: list[str]
) -> dict[str, list[MCPServerConfig]]:
    """
    複数のDriveファイルからMCP設定を取得し、server_idごとに候補リストを作成

    Args:
        file_ids: ファイルIDのリスト（順序は後勝ち優先）

    Returns:
        { server_id: [Config_from_file1, Config_from_file2, ...] }
        リストの順序はfile_idsの順序に対応
    """
    server_candidates: dict[str, list[MCPServerConfig]] = {}

    for file_id in file_ids:
        try:
            configs = await self.fetch_mcp_config(file_id)
            for config in configs:
                if config.id not in server_candidates:
                    server_candidates[config.id] = []
                server_candidates[config.id].append(config)
        except Exception as e:
            logger.warning(f"Failed to fetch config from {file_id}: {e}")
            continue

    return server_candidates
```

### 2.3 優先順位付き接続（Reverse Order）の実装

**ファイル:** `tools/crawler/src/mcp_client.py`

**新規追加メソッド:**

```python
async def fetch_tools_with_fallback(
    self,
    server_id: str,
    config_candidates: list[MCPServerConfig],
) -> ServerResult:
    """
    設定候補を逆順（後勝ち優先）で試行し、最初に成功した結果を返す

    Args:
        server_id: サーバーID
        config_candidates: 設定候補リスト（file_ids順。後方優先で逆順処理）

    Returns:
        最初に成功した接続のServerResult、または全失敗時は最後のエラー
    """
    # 逆順で処理（リスト末尾 = 最優先）
    for config in reversed(config_candidates):
        result = await self.fetch_tools_schema(
            server_id, config.url, config.headers
        )

        if result.status == "online":
            logger.info(f"[{server_id}] Connected using URL: {config.url}")
            return result
        else:
            logger.warning(
                f"[{server_id}] Failed with URL {config.url}: {result.error_message}"
            )

    # 全候補が失敗した場合、最後の結果（最も優先度が低いもの）を返す
    return result
```

### 2.4 main.py の改修ポイント

```python
async def main() -> int:
    # 環境変数から複数ファイルIDを取得
    drive_file_ids_str = os.environ.get("DRIVE_FILE_IDS", "")
    drive_file_ids = [fid.strip() for fid in drive_file_ids_str.split(",") if fid.strip()]

    # 後方互換性: 単一ID環境変数もサポート
    if not drive_file_ids:
        single_id = os.environ.get("DRIVE_FILE_ID")
        if single_id:
            drive_file_ids = [single_id]

    if not drive_file_ids:
        logger.error("DRIVE_FILE_IDS (or DRIVE_FILE_ID) environment variable is not set")
        return 1

    # Step 1: 全ファイルから設定を取得（server_idごとに候補リスト化）
    drive_client = DriveClient()
    server_candidates = await drive_client.fetch_mcp_configs_multi(drive_file_ids)

    # Step 2: 優先順位付き接続
    mcp_client = MCPClient(timeout=args.timeout, delay=args.delay)
    results = []

    for server_id, candidates in server_candidates.items():
        result = await mcp_client.fetch_tools_with_fallback(server_id, candidates)
        results.append(result)

    # ... 以降は既存ロジック
```

---

## Phase 3: GitHub Actions の改修

### 3.1 環境変数名の変更

**ファイル:** `.github/workflows/update_catalog.yml`

**現状 (line 52):**
```yaml
env:
  DRIVE_FILE_ID: ${{ secrets.DRIVE_FILE_ID }}
```

**変更後:**
```yaml
env:
  DRIVE_FILE_IDS: ${{ secrets.DRIVE_FILE_IDS }}
  # 後方互換性のため、古いsecretsもフォールバックとして対応
  DRIVE_FILE_ID: ${{ secrets.DRIVE_FILE_ID }}
```

### 3.2 リポジトリSecrets設定（ユーザー向け手順）

1. GitHub リポジトリの Settings → Secrets and variables → Actions
2. 新しいシークレット `DRIVE_FILE_IDS` を追加
3. 値は **カンマ区切り**（例: `1ABC123,1XYZ789`）
4. 旧シークレット `DRIVE_FILE_ID` は後方互換のため残しておく

---

## Phase 4: テストと検証

### 4.1 GAS テストケース

| ケース | 入力 | 期待結果 |
|--------|------|----------|
| 単一ファイル | `["ID_A"]` | ID_Aの設定がそのまま使用される |
| 複数ファイル重複なし | `["ID_A", "ID_B"]` | 両方のサーバーが含まれる |
| 複数ファイル重複あり | `["ID_A", "ID_B"]` (同一server_id) | ID_Bの設定が優先される |
| ファイル取得失敗 | `["ID_invalid", "ID_B"]` | ID_Bのみ使用、エラーログ出力 |

### 4.2 Python Crawler テストケース

| ケース | 入力 | 期待結果 |
|--------|------|----------|
| 単一ファイル | `ID_A` | 通常のクロール動作 |
| 複数ファイル、全オンライン | `ID_A,ID_B` | ID_Bの設定でオンライン |
| 複数ファイル、ID_Bオフライン | `ID_A,ID_B` | ID_Aにフォールバック |
| 複数ファイル、全オフライン | `ID_A,ID_B` | offline ステータス |

---

## 実装チェックリスト

### Google Apps Script (tools/code.js)

- [ ] `DRIVE_JSON_FILE_IDS` プロパティの読み込み対応
- [ ] `fetchModifiedFiles()` 関数の実装
- [ ] `mergeConfigsLastWins()` 関数の実装
- [ ] `main()` 関数の改修
- [ ] エラーハンドリングの実装
- [ ] 後方互換性（単一ID）の確保

### Python Crawler (tools/crawler/)

- [ ] `DRIVE_FILE_IDS` 環境変数の対応 (main.py)
- [ ] `fetch_mcp_configs_multi()` メソッドの実装 (drive_client.py)
- [ ] `fetch_tools_with_fallback()` メソッドの実装 (mcp_client.py)
- [ ] main.py の統合改修
- [ ] 後方互換性（DRIVE_FILE_ID フォールバック）の確保

### GitHub Actions

- [ ] `update_catalog.yml` の環境変数変更
- [ ] Secrets設定手順のドキュメント化

### ドキュメント

- [ ] tools/README.md の更新
- [ ] tools/crawler/README.md の更新
- [ ] .env.example の更新

---

## アーキテクチャ図

```
+------------------+      +------------------+      +------------------+
|   Drive File A   |      |   Drive File B   |      |   Drive File C   |
|   (古い設定)     |      |   (新しい設定)   |      |   (最新設定)     |
+--------+---------+      +--------+---------+      +--------+---------+
         |                         |                         |
         v                         v                         v
+------------------------------------------------------------------------+
|                         Config Loader                                   |
|   DRIVE_FILE_IDS = "ID_A, ID_B, ID_C" (左から右へ読み込み)              |
+------------------------------------------------------------------------+
         |
         v
+------------------------------------------------------------------------+
|                      Merge Logic (Last-one-wins)                       |
|   同一server_idの場合: A ← B ← C (Cが最終的に採用)                     |
+------------------------------------------------------------------------+
         |
         v
+---------------------------+
|   Merged Configuration    |
|   (調査/クロール対象)     |
+---------------------------+
```

---

## 作成日

2025-12-06

## 関連Issue

- Issue #26: Support multi-source JSON with consistent "last-one-wins" priority
