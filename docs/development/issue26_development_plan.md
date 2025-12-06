# Issue #26: Support Multi-source JSON with Failover & Last-one-wins - 開発計画書

## 概要

MCPサーバーの設定情報が複数のJSONファイル（レガシー、最新版など）に分散している状況に対応するため、複数のファイルIDを受け入れ可能にする。
GAS（更新検知）とPython（クローラー）の両方で**「リストの後方に記述されたファイルを優先する（後勝ち）」**という統一ルールで実装し、設定の一貫性を保つ。
設定フォーマットには **JSON配列形式** を採用し、ファイル名（ラベル）とIDをペアで管理することで、ログの可読性と運用性を向上させる。

---

## 運用イメージ

**環境変数 / スクリプトプロパティ (`DRIVE_FILE_IDS` / `DRIVE_JSON_FILE_IDS`)**

```json
[
  {"name": "Legacy (A)", "id": "1ABC_legacy_id..."},
  {"name": "Future (C)", "id": "1XYZ_future_id..."},
  {"name": "Latest (B)", "id": "1DEF_latest_id..."}
]
```

| 項目 | 説明 |
|------|------|
| **リスト順序の意味** | 上から順に「優先度が低い → 高い」とする（後勝ち） |
| **GAS** | リスト順に読み込み、後続のファイルで上書きマージして調査対象リストを作成 |
| **Python** | まずリスト末尾（Latest）のURLで接続を試行。失敗した場合、一つ手前（Future → Legacy）のURLでリトライする（フェイルオーバー） |

---

## Phase 1: Google Apps Script (tools/code.js) の改修

### 1.1 設定プロパティの変更とパース処理

**変更点:**
- プロパティ名: `DRIVE_JSON_FILE_ID` → `DRIVE_JSON_FILE_IDS`
- 値の形式: JSON配列文字列 `[{"name": "...", "id": "..."}]`

**実装イメージ (`getConfig` 内):**

```javascript
// デフォルトは空配列
let driveFileConfigs = [];
const rawValue = props.getProperty('DRIVE_JSON_FILE_IDS');

if (rawValue) {
  try {
    // JSON形式を試行
    driveFileConfigs = JSON.parse(rawValue);
  } catch (e) {
    console.warn('JSON parse failed, falling back to comma-separated string');
    // 後方互換性: カンマ区切り文字列対応
    driveFileConfigs = rawValue.split(',').map((id, i) => ({
      name: `Source_${i+1}`,
      id: id.trim()
    }));
  }
}

// 配列でない場合（単一オブジェクト等）の正規化
if (!Array.isArray(driveFileConfigs)) {
  driveFileConfigs = [driveFileConfigs];
}

// configオブジェクトに格納
return {
  // ...
  DRIVE_FILE_CONFIGS: driveFileConfigs
};
```

### 1.2 更新検知ロジックの実装

ファイルごとに `modifiedTime` をチェックし、変更があったファイルのみダウンロード対象とする。

**新規関数 `fetchModifiedFiles(fileConfigs)`:**

```javascript
/**
 * 複数ファイルの更新を検知し、変更があるファイルのみ取得
 * @param {Array<{name: string, id: string}>} fileConfigs - ファイル設定の配列
 * @returns {Array<{name: string, id: string, content: object}>} 変更があったファイルの内容
 */
function fetchModifiedFiles(fileConfigs) {
  const props = PropertiesService.getScriptProperties();
  const lastModifiedTimes = JSON.parse(props.getProperty('LAST_MODIFIED_TIMES') || '{}');

  const modifiedFiles = [];
  const newModifiedTimes = {};

  for (const config of fileConfigs) {
    try {
      const file = DriveApp.getFileById(config.id);
      const currentModified = file.getLastUpdated().toISOString();
      newModifiedTimes[config.id] = currentModified;

      if (lastModifiedTimes[config.id] !== currentModified) {
        console.log(`📝 Modified: ${config.name} (${config.id})`);
        const content = JSON.parse(file.getBlob().getDataAsString());
        modifiedFiles.push({ ...config, content });
      } else {
        console.log(`⏭️ Unchanged: ${config.name}`);
      }
    } catch (e) {
      console.error(`❌ Failed to fetch ${config.name}: ${e.message}`);
    }
  }

  props.setProperty('LAST_MODIFIED_TIMES', JSON.stringify(newModifiedTimes));
  return modifiedFiles;
}
```

**処理フロー:**
1. `LAST_MODIFIED_TIMES` プロパティ（JSON）をロード
2. 各ファイルの最終更新日時を取得・比較
3. 変更がある場合のみ `DriveApp.getFileById` で内容を取得
4. 更新日時を保存
5. コンテンツを含むファイルオブジェクトの配列を返却

### 1.3 マージロジック（後勝ち）の実装

**新規関数 `mergeConfigsLastWins(fileConfigs)`:**

```javascript
/**
 * 複数のMCP設定をマージする（後勝ち）
 * @param {Array<{name: string, id: string}>} fileConfigs - ファイル設定の配列
 * @returns {{mcpServers: object}} マージされた設定
 */
function mergeConfigsLastWins(fileConfigs) {
  let mergedServers = {};

  for (const config of fileConfigs) {
    try {
      const file = DriveApp.getFileById(config.id);
      const content = JSON.parse(file.getBlob().getDataAsString());
      const servers = content.mcpServers || {};
      const serverCount = Object.keys(servers).length;

      console.log(`📂 Loaded ${config.name}: ${serverCount} servers`);

      // 後勝ち: スプレッド構文で上書き
      mergedServers = { ...mergedServers, ...servers };
    } catch (e) {
      console.error(`❌ Failed to load ${config.name}: ${e.message}`);
    }
  }

  console.log(`✅ Merged total: ${Object.keys(mergedServers).length} servers`);
  return { mcpServers: mergedServers };
}
```

### 1.4 main() 関数の改修

1. `getConfig` で複数設定を取得
2. `mergeConfigsLastWins` でマージされた `mcpServers` を取得
3. 以降の処理はマージ済みデータを使用

```javascript
function main() {
  const CONFIG = getConfig();

  // 複数ファイルから設定をマージ
  const fileConfigs = CONFIG.DRIVE_FILE_CONFIGS;
  if (fileConfigs.length === 0) {
    console.error('DRIVE_JSON_FILE_IDS が設定されていません。');
    return;
  }

  console.log(`📋 Loading ${fileConfigs.length} config files...`);
  const mcpData = mergeConfigsLastWins(fileConfigs);

  // 以降は既存ロジックを mcpData で処理
  // ...
}
```

---

## Phase 2: Python Crawler (tools/crawler/) の改修

### 2.1 環境変数の変更とパース処理

**変更点:**
- 環境変数名: `DRIVE_FILE_IDS`
- 値の形式: JSON配列文字列（推奨）、カンマ区切り（互換）

**実装イメージ (`main.py`):**

```python
import json
from typing import TypedDict

class FileConfig(TypedDict):
    name: str
    id: str

def parse_drive_file_ids(env_value: str) -> list[FileConfig]:
    """
    環境変数をパースして [{name, id}, ...] のリストを返す

    Args:
        env_value: 環境変数の値（JSON配列 or カンマ区切り）

    Returns:
        FileConfigのリスト
    """
    if not env_value:
        return []

    env_value = env_value.strip()

    # JSON形式を試行
    if env_value.startswith('['):
        try:
            configs = json.loads(env_value)
            # 配列内の各要素を検証・正規化
            result = []
            for i, item in enumerate(configs):
                if isinstance(item, dict):
                    result.append({
                        "name": item.get("name", f"Source_{i+1}"),
                        "id": item.get("id", "")
                    })
                elif isinstance(item, str):
                    result.append({"name": f"Source_{i+1}", "id": item})
            return result
        except json.JSONDecodeError:
            pass

    # 後方互換性: カンマ区切り文字列
    ids = [id.strip() for id in env_value.split(',') if id.strip()]
    return [{"name": f"Source_{i+1}", "id": id} for i, id in enumerate(ids)]
```

### 2.2 DriveClient の複数ファイル対応

**ファイル:** `tools/crawler/src/drive_client.py`

**改修内容:**
- `fetch_mcp_config` は単一ファイル用として維持
- **新規メソッド `fetch_mcp_configs_multi(file_configs)`:**

```python
async def fetch_mcp_configs_multi(
    self, file_configs: list[dict]
) -> dict[str, list[MCPServerConfig]]:
    """
    複数のDriveファイルからMCP設定を取得し、server_idごとに候補リストを作成

    Args:
        file_configs: [{"name": "...", "id": "..."}, ...] 形式のリスト
                      順序は後勝ち優先（リスト末尾が最優先）

    Returns:
        { server_id: [Config_from_file1, Config_from_file2, ...] }
        候補リストの順序は、入力 file_configs の順序と一致
    """
    server_candidates: dict[str, list[MCPServerConfig]] = {}

    for config in file_configs:
        name = config.get("name", "Unknown")
        file_id = config.get("id", "")

        if not file_id:
            logger.warning(f"Skipping {name}: no file ID provided")
            continue

        try:
            configs = await self.fetch_mcp_config(file_id)
            logger.info(f"📂 Loaded {name}: {len(configs)} servers")

            for server_config in configs:
                if server_config.id not in server_candidates:
                    server_candidates[server_config.id] = []
                # 設定にソース名を付与（ログ用）
                server_config.source_name = name
                server_candidates[server_config.id].append(server_config)

        except Exception as e:
            logger.warning(f"❌ Failed to fetch {name} ({file_id}): {e}")
            continue

    total_servers = len(server_candidates)
    logger.info(f"✅ Total unique servers: {total_servers}")
    return server_candidates
```

### 2.3 優先順位付き接続とフェイルオーバー

**ファイル:** `tools/crawler/src/mcp_client.py`

**新規メソッド `fetch_tools_with_fallback(server_id, candidates)`:**

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
        config_candidates: 設定候補リスト（file_configs順。後方優先で逆順処理）

    Returns:
        最初に成功した接続のServerResult、または全失敗時は最後のエラー
    """
    last_result = None

    # 逆順で処理（リスト末尾 = 最優先）
    for config in reversed(config_candidates):
        source_name = getattr(config, 'source_name', 'Unknown')
        logger.debug(f"[{server_id}] Trying {source_name}: {config.url}")

        result = await self.fetch_tools_schema(
            server_id, config.url, config.headers
        )
        last_result = result

        if result.status == "online":
            logger.info(f"✅ [{server_id}] Connected via {source_name}")
            return result
        else:
            logger.warning(
                f"⚠️ [{server_id}] Failed via {source_name}: {result.error_message}"
            )

    # 全候補が失敗した場合、最後の結果を返す
    logger.error(f"❌ [{server_id}] All {len(config_candidates)} sources failed")
    return last_result
```

### 2.4 main.py の統合改修（並列処理の維持）

```python
async def main() -> int:
    # 環境変数から複数ファイル設定を取得
    drive_file_ids_str = os.environ.get("DRIVE_FILE_IDS", "")
    file_configs = parse_drive_file_ids(drive_file_ids_str)

    # 後方互換性: 単一ID環境変数もサポート
    if not file_configs:
        single_id = os.environ.get("DRIVE_FILE_ID")
        if single_id:
            file_configs = [{"name": "Default", "id": single_id}]

    if not file_configs:
        logger.error("DRIVE_FILE_IDS (or DRIVE_FILE_ID) environment variable is not set")
        return 1

    logger.info(f"📋 Loading {len(file_configs)} config files...")

    # Step 1: 全ファイルから設定を取得（server_idごとに候補リスト化）
    drive_client = DriveClient()
    server_candidates = await drive_client.fetch_mcp_configs_multi(file_configs)

    if not server_candidates:
        logger.warning("No MCP servers found in configuration")
        return 0

    # Step 2: 並列処理でフェイルオーバー付き接続
    logger.info(f"🔍 Crawling {len(server_candidates)} servers...")

    mcp_client = MCPClient(timeout=args.timeout, delay=args.delay)
    semaphore = asyncio.Semaphore(args.max_concurrent)

    async def process_server_with_limit(server_id: str, candidates: list) -> ServerResult:
        async with semaphore:
            result = await mcp_client.fetch_tools_with_fallback(server_id, candidates)
            if mcp_client.delay > 0:
                await asyncio.sleep(mcp_client.delay)
            return result

    # タスクを作成
    tasks = [
        process_server_with_limit(server_id, candidates)
        for server_id, candidates in server_candidates.items()
    ]

    # 並列実行
    results = await asyncio.gather(*tasks, return_exceptions=True)

    # 例外処理
    processed_results: list[ServerResult] = []
    server_ids = list(server_candidates.keys())
    for i, result in enumerate(results):
        if isinstance(result, Exception):
            server_id = server_ids[i]
            processed_results.append(
                ServerResult(
                    id=server_id,
                    url="(multiple sources)",
                    status="error",
                    last_checked=datetime.now(timezone.utc).isoformat(),
                    error_message=str(result),
                )
            )
        else:
            processed_results.append(result)

    # 以降は既存ロジック
    # ...
```

---

## Phase 3: GitHub Actions の改修

### 3.1 ワークフロー定義の更新

**ファイル:** `.github/workflows/update_catalog.yml`

```yaml
- name: Run crawler
  env:
    # JSON形式のIDリストを受け取る
    DRIVE_FILE_IDS: ${{ secrets.DRIVE_FILE_IDS }}
    # 後方互換用（DRIVE_FILE_IDSが未設定の場合のフォールバック）
    DRIVE_FILE_ID: ${{ secrets.DRIVE_FILE_ID }}
  run: |
    cd tools/crawler
    # ...
```

### 3.2 Secrets設定手順

**リポジトリSecrets設定（ユーザー向け手順）:**

1. GitHub リポジトリの **Settings** → **Secrets and variables** → **Actions**
2. 新しいシークレット `DRIVE_FILE_IDS` を作成
3. 値として以下の形式のJSON文字列を設定:

```json
[
  {"name": "Legacy", "id": "1ABC_legacy_id..."},
  {"name": "Latest", "id": "1DEF_latest_id..."}
]
```

4. 旧シークレット `DRIVE_FILE_ID` は後方互換のため残しておく（任意）

---

## Phase 4: テスト計画

### 4.1 GAS テストケース

| ケース | 入力 | 期待結果 |
|--------|------|----------|
| JSON形式 | `[{"name":"A","id":"id_a"}]` | 正常にパース、ログに `Loaded A: N servers` |
| 複数ファイル重複なし | `[{"name":"A","id":"id_a"},{"name":"B","id":"id_b"}]` | 両方のサーバーが含まれる |
| 複数ファイル重複あり | `[{"name":"A","id":"id_a"},{"name":"B","id":"id_b"}]` (同一server_id) | B（後方）の設定が優先される |
| カンマ区切り互換 | `id_a,id_b` | `Source_1`, `Source_2` として処理 |
| 単一ID互換 | `id_a` | `Source_1` として処理 |
| ファイル取得失敗 | `[{"name":"Invalid","id":"bad_id"},{"name":"Valid","id":"good_id"}]` | Validのみ使用、エラーログ出力 |

### 4.2 Python Crawler テストケース

| ケース | 入力 | 期待結果 |
|--------|------|----------|
| JSON形式 | `[{"name":"A","id":"id_a"}]` | 正常にパース |
| フェイルオーバー (後方成功) | `[A(無効URL), B(有効URL)]` | B（末尾）で即座に接続成功 |
| フェイルオーバー (前方フォールバック) | `[A(有効URL), B(無効URL)]` | B失敗 → Aにフォールバック成功 |
| 全オフライン | `[A(無効), B(無効)]` | offline ステータス、全ソース試行ログ |
| 並列処理 | 多数のサーバー + `--max-concurrent 5` | 同時接続が5に制限される |
| カンマ区切り互換 | `id_a,id_b` | `Source_1`, `Source_2` として処理 |
| 後方互換 (DRIVE_FILE_ID) | `DRIVE_FILE_ID=id_a` のみ設定 | `Default` として処理 |

---

## 実装チェックリスト

### Google Apps Script (tools/code.js)

- [ ] `DRIVE_JSON_FILE_IDS` プロパティの読み込み対応（JSON配列形式）
- [ ] カンマ区切り文字列の後方互換性対応
- [ ] `fetchModifiedFiles()` 関数の実装
- [ ] `mergeConfigsLastWins()` 関数の実装
- [ ] `main()` 関数の改修
- [ ] エラーハンドリング（個別ファイル失敗時の継続）
- [ ] ログ出力にファイル名（name）を含める

### Python Crawler (tools/crawler/)

- [ ] `parse_drive_file_ids()` 関数の実装（main.py）
- [ ] `fetch_mcp_configs_multi()` メソッドの実装（drive_client.py）
- [ ] `MCPServerConfig` に `source_name` 属性追加
- [ ] `fetch_tools_with_fallback()` メソッドの実装（mcp_client.py）
- [ ] main.py の統合改修（並列処理維持）
- [ ] 後方互換性（DRIVE_FILE_ID フォールバック）の確保
- [ ] ログ出力にソース名を含める

### GitHub Actions

- [ ] `update_catalog.yml` の環境変数更新
- [ ] Secrets設定手順のドキュメント化

### ドキュメント

- [ ] tools/README.md の更新
- [ ] tools/crawler/README.md の更新
- [ ] tools/crawler/.env.example の更新

---

## アーキテクチャ図

```
+------------------+      +------------------+      +------------------+
|   Drive File A   |      |   Drive File B   |      |   Drive File C   |
|   "Legacy"       |      |   "Future"       |      |   "Latest"       |
+--------+---------+      +--------+---------+      +--------+---------+
         |                         |                         |
         v                         v                         v
+------------------------------------------------------------------------+
|                         Config Loader                                   |
|   DRIVE_FILE_IDS = [                                                   |
|     {"name": "Legacy", "id": "A"},                                     |
|     {"name": "Future", "id": "B"},                                     |
|     {"name": "Latest", "id": "C"}                                      |
|   ]                                                                    |
+------------------------------------------------------------------------+
         |
         v
+------------------------------------------------------------------------+
|                      Merge Logic (Last-one-wins)                       |
|   同一server_idの場合: A ← B ← C (Cが最終的に採用)                     |
|   ログ出力: "Loaded Legacy: 10 servers"                                |
|             "Loaded Future: 5 servers"                                  |
|             "Loaded Latest: 8 servers"                                  |
+------------------------------------------------------------------------+
         |
         v
+---------------------------+     +---------------------------+
|   GAS: Merged mcpServers  |     |   Python: server_candidates |
|   (調査対象リスト)        |     |   { server_id: [A,B,C] }   |
+---------------------------+     +-------------+-------------+
                                                |
                                                v
                                  +---------------------------+
                                  |   Failover Connection     |
                                  |   Try C → B → A          |
                                  |   (逆順で優先度高い順)    |
                                  +---------------------------+
```

---

## 作成日

2025-12-06

## 関連Issue

- Issue #26: Support multi-source JSON with consistent "last-one-wins" priority
