/**
 * kamuicode Config Manager Auto Updater (Production Mode)
 * * 概要:
 * 1. mcp-kamui-code.json を Google Drive から取得
 * 2. 未処理のモデルキューをチェック (なければ新規作成)
 * 3. カテゴリマスタ (category_master.json) に基づいてカテゴリを判定
 * 4. 未知の接頭辞の場合は Gemini で推論してマスタを自動更新
 * 5. 結果判定と更新データの作成:
 * - 判明時: YAMLのカテゴリブロック末尾へ挿入
 * - 不明時: Markdownの先頭(履歴の上)へ追記
 * 6. GitHubへコミット＆プッシュ
 * 7. タイムアウト回避 (Resume機能)
 */

// ==========================================
// 設定
// ==========================================

// デフォルト設定値
const DEFAULT_CONFIG = {
  // GitHub設定
  REPO_OWNER: 'Yumeno',
  REPO_NAME: 'kamuicode-config-manager',
  BRANCH: 'main',

  // ファイルパス (スクリプトプロパティで上書き可能)
  YAML_PATH: 'kamuicode_model_memo.yaml',
  RULES_PATH: 'docs/development/model_release_date_research_rules.md',
  UNKNOWN_MD_PATH: 'docs/development/unknown_release_dates.md',
  CATEGORY_MASTER_PATH: 'tools/category_master.json',

  // 実行制限設定 (ミリ秒) - 4分半で切り上げ
  MAX_EXECUTION_TIME_MS: 4.5 * 60 * 1000,

  // コミットメッセージ
  // Issue #2 に関連付けるため (Refs #2) を追加
  COMMIT_MSG_YAML: 'chore(yaml): update model memo via Gemini Auto-Research (Refs #2)',
  COMMIT_MSG_MD: 'docs: update unknown release dates via Gemini Auto-Research (Refs #2)',
  COMMIT_MSG_CATEGORY_MASTER: 'feat(tools): auto-update category_master.json with new prefix (Refs #23)',

  // YAMLインデント設定 (スペース数)
  // 既存ファイルのフォーマットに合わせて調整可能
  INDENT_SIZE: 2
};

/**
 * スクリプトプロパティから設定を取得する
 * 未設定の場合はデフォルト値を使用
 */
function getConfig() {
  const props = PropertiesService.getScriptProperties();

  // Drive File IDsのパース処理 (JSON配列形式 or カンマ区切り)
  const driveFileConfigs = parseDriveFileIds(props);

  // フォルダID (再帰探索用) - カンマ区切りで配列化
  const rawFolderIds = props.getProperty('DRIVE_FOLDER_ID') || '';
  const driveFolderIds = rawFolderIds.split(',').map(id => id.trim()).filter(id => id);

  return {
    // GitHub設定
    REPO_OWNER: props.getProperty('REPO_OWNER') || DEFAULT_CONFIG.REPO_OWNER,
    REPO_NAME: props.getProperty('REPO_NAME') || DEFAULT_CONFIG.REPO_NAME,
    BRANCH: props.getProperty('BRANCH') || DEFAULT_CONFIG.BRANCH,

    // ファイルパス (スクリプトプロパティキー: PATH_YAML, PATH_RULES, PATH_UNKNOWN_MD, PATH_CATEGORY_MASTER)
    YAML_PATH: props.getProperty('PATH_YAML') || DEFAULT_CONFIG.YAML_PATH,
    RULES_PATH: props.getProperty('PATH_RULES') || DEFAULT_CONFIG.RULES_PATH,
    UNKNOWN_MD_PATH: props.getProperty('PATH_UNKNOWN_MD') || DEFAULT_CONFIG.UNKNOWN_MD_PATH,
    CATEGORY_MASTER_PATH: props.getProperty('PATH_CATEGORY_MASTER') || DEFAULT_CONFIG.CATEGORY_MASTER_PATH,

    // 実行制限設定
    MAX_EXECUTION_TIME_MS: DEFAULT_CONFIG.MAX_EXECUTION_TIME_MS,

    // コミットメッセージ
    COMMIT_MSG_YAML: DEFAULT_CONFIG.COMMIT_MSG_YAML,
    COMMIT_MSG_MD: DEFAULT_CONFIG.COMMIT_MSG_MD,
    COMMIT_MSG_CATEGORY_MASTER: DEFAULT_CONFIG.COMMIT_MSG_CATEGORY_MASTER,

    // YAMLインデント設定
    INDENT_SIZE: parseInt(props.getProperty('INDENT_SIZE') || DEFAULT_CONFIG.INDENT_SIZE, 10),

    // Drive設定 (複数ファイル対応)
    DRIVE_FILE_CONFIGS: driveFileConfigs,

    // フォルダ再帰探索設定 (配列に変更)
    DRIVE_FOLDER_IDS: driveFolderIds
  };
}

/**
 * Drive File IDsをパースして [{name, id}, ...] 形式の配列を返す
 * @param {GoogleAppsScript.Properties.Properties} props - スクリプトプロパティ
 * @returns {Array<{name: string, id: string}>} ファイル設定の配列
 */
function parseDriveFileIds(props) {
  // 新形式: DRIVE_JSON_FILE_IDS (JSON配列)
  const rawValue = props.getProperty('DRIVE_JSON_FILE_IDS');

  if (rawValue) {
    const trimmed = rawValue.trim();
    // JSON配列形式を試行
    if (trimmed.startsWith('[')) {
      try {
        const parsed = JSON.parse(trimmed);
        // 配列内の各要素を正規化
        if (Array.isArray(parsed)) {
          return parsed.map((item, i) => {
            if (typeof item === 'object' && item !== null) {
              return {
                name: item.name || `Source_${i + 1}`,
                id: item.id || ''
              };
            } else if (typeof item === 'string') {
              return { name: `Source_${i + 1}`, id: item };
            }
            return { name: `Source_${i + 1}`, id: '' };
          }).filter(c => c.id);
        }
      } catch (e) {
        console.warn(`JSON parse failed for DRIVE_JSON_FILE_IDS: ${e.message}`);
      }
    }

    // 後方互換性: カンマ区切り文字列
    const ids = trimmed.split(',').map(id => id.trim()).filter(id => id);
    if (ids.length > 0) {
      return ids.map((id, i) => ({ name: `Source_${i + 1}`, id: id }));
    }
  }

  // 旧形式: DRIVE_JSON_FILE_ID (単一ID) - 後方互換性
  const legacyId = props.getProperty('DRIVE_JSON_FILE_ID');
  if (legacyId) {
    return [{ name: 'Default', id: legacyId.trim() }];
  }

  return [];
}

// ==========================================
// 既存YAML再カテゴライズ (ワンショット実行用)
// ==========================================

/**
 * 既存のkamuicode_model_memo.yamlを読み込み、
 * 全エントリをserver_nameの接頭辞に基づいてカテゴリマスタの定義通りに再配置する。
 * ★注意: この関数は一度だけ実行することを想定したワンショット機能です。
 */
function recategorizeExistingModels() {
  console.log('=== Recategorizing Existing Models ===');

  const props = PropertiesService.getScriptProperties();
  const CONFIG = getConfig();

  // 必須プロパティの取得
  const githubToken = props.getProperty('GITHUB_TOKEN');
  if (!githubToken) {
    console.error('GITHUB_TOKEN が設定されていません。');
    return;
  }

  // カテゴリマスタ取得
  console.log('Fetching category_master.json...');
  const categoryMasterInfo = fetchCategoryMaster(CONFIG, githubToken);
  const categoryMaster = categoryMasterInfo.data;

  if (!categoryMaster.prefix_to_category || Object.keys(categoryMaster.prefix_to_category).length === 0) {
    console.error('カテゴリマスタが空です。');
    return;
  }

  // 既存YAML取得
  console.log('Fetching kamuicode_model_memo.yaml...');
  let yamlFile;
  try {
    yamlFile = fetchGithubFile(CONFIG.REPO_OWNER, CONFIG.REPO_NAME, CONFIG.YAML_PATH, githubToken, CONFIG.BRANCH);
  } catch (e) {
    console.error(`YAML取得エラー: ${e.message}`);
    return;
  }

  // YAMLをパースして全モデルを抽出
  const yamlContent = yamlFile.content;
  const allModels = parseYamlModels(yamlContent);

  console.log(`Found ${allModels.length} models to recategorize.`);

  // 新しいカテゴリ構造を構築
  const newCategories = {};
  let unknownPrefixes = [];

  for (const model of allModels) {
    const prefix = extractPrefixFromServerName(model.server_name);
    const categoryInfo = getCategoryFromPrefix(prefix, categoryMaster);

    let targetCategory;
    if (categoryInfo) {
      targetCategory = categoryInfo.category_key;
    } else {
      // 未知の接頭辞の場合、元のカテゴリを維持するか、miscellaneousに分類
      console.warn(`Unknown prefix: ${prefix} (server_name: ${model.server_name})`);
      unknownPrefixes.push({ prefix, server_name: model.server_name, original_category: model.original_category });
      targetCategory = model.original_category || 'miscellaneous';
    }

    if (!newCategories[targetCategory]) {
      newCategories[targetCategory] = [];
    }
    newCategories[targetCategory].push(model);
  }

  // カテゴリ順序を定義（マスタのキー順序に基づく）
  const categoryOrder = [
    'text_to_image',
    'image_to_image',
    'text_to_video',
    'image_to_video',
    'video_to_video',
    'reference_to_video',
    'frame_to_video',
    'speech_to_video',
    'audio_to_video',
    'text_to_speech',
    'text_to_audio',
    'text_to_music',
    'video_to_audio',
    'video_to_sfx',
    'audio_to_text',
    'text_to_visual',
    'image_to_3d',
    'text_to_3d',
    '3d_to_3d',
    'training',
    'utility_and_analysis',
    'voice_clone',
    'miscellaneous'
  ];

  // 新しいYAMLを生成
  let newYamlContent = 'ai_models:\n';
  const indent = ' '.repeat(CONFIG.INDENT_SIZE);
  const listIndent = ' '.repeat(CONFIG.INDENT_SIZE * 2);

  // 定義順でカテゴリを出力
  for (const category of categoryOrder) {
    if (newCategories[category] && newCategories[category].length > 0) {
      newYamlContent += `${indent}${category}:\n`;
      for (const model of newCategories[category]) {
        newYamlContent += `${listIndent}- name: ${model.name}\n`;
        newYamlContent += `${listIndent}  server_name: ${model.server_name}\n`;
        newYamlContent += `${listIndent}  release_date: ${model.release_date}\n`;
        newYamlContent += `${listIndent}  features: ${escapeYamlString(model.features)}\n`;
      }
    }
  }

  // 定義順にないカテゴリも出力
  for (const category of Object.keys(newCategories)) {
    if (!categoryOrder.includes(category) && newCategories[category].length > 0) {
      newYamlContent += `${indent}${category}:\n`;
      for (const model of newCategories[category]) {
        newYamlContent += `${listIndent}- name: ${model.name}\n`;
        newYamlContent += `${listIndent}  server_name: ${model.server_name}\n`;
        newYamlContent += `${listIndent}  release_date: ${model.release_date}\n`;
        newYamlContent += `${listIndent}  features: ${escapeYamlString(model.features)}\n`;
      }
    }
  }

  // GitHubに保存
  console.log('Committing recategorized YAML...');
  try {
    updateGithubFile(
      CONFIG.REPO_OWNER,
      CONFIG.REPO_NAME,
      CONFIG.YAML_PATH,
      newYamlContent,
      yamlFile.sha,
      'refactor(yaml): recategorize models based on server_name prefix (Refs #23)',
      githubToken,
      CONFIG.BRANCH
    );
    console.log('YAML updated successfully.');
  } catch (e) {
    console.error(`YAML更新エラー: ${e.message}`);
  }

  // 未知の接頭辞を報告
  if (unknownPrefixes.length > 0) {
    console.warn('=== Unknown Prefixes ===');
    for (const item of unknownPrefixes) {
      console.warn(`  ${item.prefix}: ${item.server_name} (was: ${item.original_category})`);
    }
  }

  console.log('=== Recategorization Complete ===');
}

/**
 * YAMLコンテンツから全モデルをパースして配列として返す
 * @param {string} yamlContent - YAMLコンテンツ
 * @returns {Array} モデルオブジェクトの配列
 */
function parseYamlModels(yamlContent) {
  const models = [];
  const lines = yamlContent.split('\n');

  let currentCategory = null;
  let currentModel = null;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];

    // カテゴリ行を検出 (インデント2スペース + 文字 + コロン)
    const categoryMatch = line.match(/^  ([a-z0-9_]+):$/);
    if (categoryMatch) {
      currentCategory = categoryMatch[1];
      continue;
    }

    // モデルエントリ開始を検出 (インデント4スペース + ハイフン + name:)
    const nameMatch = line.match(/^    - name: (.+)$/);
    if (nameMatch) {
      // 前のモデルがあれば保存
      if (currentModel) {
        models.push(currentModel);
      }
      currentModel = {
        name: nameMatch[1],
        server_name: '',
        release_date: '',
        features: '',
        original_category: currentCategory
      };
      continue;
    }

    // server_name を検出
    const serverNameMatch = line.match(/^      server_name: (.+)$/);
    if (serverNameMatch && currentModel) {
      currentModel.server_name = serverNameMatch[1];
      continue;
    }

    // release_date を検出
    const releaseDateMatch = line.match(/^      release_date: (.+)$/);
    if (releaseDateMatch && currentModel) {
      currentModel.release_date = releaseDateMatch[1];
      continue;
    }

    // features を検出
    const featuresMatch = line.match(/^      features: (.+)$/);
    if (featuresMatch && currentModel) {
      currentModel.features = featuresMatch[1];
      continue;
    }
  }

  // 最後のモデルを保存
  if (currentModel) {
    models.push(currentModel);
  }

  return models;
}

/**
 * YAML文字列として安全にエスケープする
 * @param {string} str - 元の文字列
 * @returns {string} エスケープされた文字列
 */
function escapeYamlString(str) {
  if (!str) return '""';
  // 既にクォートで囲まれている場合はそのまま返す
  if ((str.startsWith('"') && str.endsWith('"')) || (str.startsWith("'") && str.endsWith("'"))) {
    return str;
  }
  // 特殊文字が含まれる場合はダブルクォートで囲む
  if (str.includes(':') || str.includes('#') || str.includes('\n') || str.includes('"')) {
    return `"${str.replace(/"/g, '\\"')}"`;
  }
  return str;
}

// ==========================================
// 再帰的フォルダ探索機能 (Issue #30) - 修正版
// ==========================================

// フィルタリング基準日 (2025年11月20日)
const DEFAULT_TARGET_DATE = new Date('2025-11-20T00:00:00');

/**
 * 実行時間が制限に近づいているか判定する
 * @param {number} startTime - 開始時刻
 * @param {number} limitMs - 制限時間(ms)
 * @returns {boolean}
 */
function isTimeUp(startTime, limitMs) {
  // 安全マージンとして少し早めに判定 (例: 10秒前)
  return (Date.now() - startTime) > (limitMs - 10000);
}

/**
 * 指定フォルダ以下を再帰的に探索し、条件を満たすMCP設定をマージして返す
 * ★修正: タイムアウト監視を追加
 *
 * フィルタリング条件:
 * 1. 更新日時: 2025年11月20日以降
 * 2. 拡張子: .json
 * 3. 構造: mcpServersキーを持つ有効なMCP設定
 *
 * @param {string} folderId - 監視対象のルートフォルダID
 * @param {Date} [targetDate] - 基準日 (デフォルト: 2025-11-20)
 * @param {number} startTime - スクリプト開始時刻
 * @param {number} timeLimit - 制限時間(ms)
 * @returns {{mcpServers: object, partial: boolean}} マージされた設定と、スキャンが中断されたかのフラグ
 */
function fetchAllConfigsRecursive(folderId, targetDate, startTime, timeLimit) {
  targetDate = targetDate || DEFAULT_TARGET_DATE;

  const rootFolder = DriveApp.getFolderById(folderId);
  let mergedServers = {};
  let validFileCount = 0;
  let skippedFileCount = 0;
  let isInterrupted = false; // タイムアウト中断フラグ

  console.log(`🔍 Starting recursive scan: ${rootFolder.getName()}`);
  console.log(`📅 Filtering files modified after: ${targetDate.toISOString()}`);

  /**
   * 再帰処理関数
   * @param {GoogleAppsScript.Drive.Folder} folder - 現在のフォルダ
   * @param {string} currentPath - 現在のパス (ログ用)
   */
  function traverse(folder, currentPath) {
    if (isInterrupted) return; // 既に中断フラグが立っていれば何もしない

    // ★ここで時間をチェック (フォルダ単位)
    if (isTimeUp(startTime, timeLimit)) {
      console.warn(`⏳ Scan time limit reached at folder: ${currentPath || 'root'}`);
      isInterrupted = true;
      return;
    }

    currentPath = currentPath || '';
    const folderPath = currentPath ? `${currentPath}/${folder.getName()}` : folder.getName();

    // 1. ファイルの処理
    const files = folder.getFiles();
    while (files.hasNext()) {
      // ★ここで時間をチェック (ファイル単位)
      if (isTimeUp(startTime, timeLimit)) {
        console.warn(`⏳ Scan time limit reached at file loop: ${folderPath}`);
        isInterrupted = true;
        return;
      }

      const file = files.next();
      const fileName = file.getName();
      const filePath = `${folderPath}/${fileName}`;

      // 条件1: 拡張子が .json であること
      if (!fileName.endsWith('.json')) {
        continue;
      }

      // 条件2: 更新日時が基準日以降であること
      const lastUpdated = file.getLastUpdated();
      if (lastUpdated < targetDate) {
        console.log(`⏭️ Skipped (too old): ${filePath} (${lastUpdated.toISOString()})`);
        skippedFileCount++;
        continue;
      }

      try {
        const contentStr = file.getBlob().getDataAsString();
        const content = JSON.parse(contentStr);

        // 条件3: 構造チェック (mcpServersキーがあるか、かつオブジェクトか)
        if (content && content.mcpServers && typeof content.mcpServers === 'object' && !Array.isArray(content.mcpServers)) {
          const serverCount = Object.keys(content.mcpServers).length;
          console.log(`✅ Valid: ${filePath} (${serverCount} servers)`);

          // マージ処理 (後勝ち)
          mergedServers = { ...mergedServers, ...content.mcpServers };
          validFileCount++;
        } else {
          console.log(`⏭️ Skipped (invalid structure): ${filePath}`);
          skippedFileCount++;
        }
      } catch (e) {
        console.warn(`❌ Error reading ${filePath}: ${e.message}`);
        skippedFileCount++;
      }
    }

    // 2. サブフォルダの再帰処理
    const subFolders = folder.getFolders();
    while (subFolders.hasNext()) {
      if (isInterrupted) return;
      const subFolder = subFolders.next();
      console.log(`📂 Entering folder: ${folderPath}/${subFolder.getName()}`);
      traverse(subFolder, folderPath);
    }
  }

  traverse(rootFolder, '');

  const totalServers = Object.keys(mergedServers).length;
  console.log(`✅ Folder scan ${isInterrupted ? 'INTERRUPTED' : 'complete'}: ${validFileCount} valid files, ${skippedFileCount} skipped, ${totalServers} unique servers`);

  return { mcpServers: mergedServers, partial: isInterrupted };
}

// ==========================================
// 複数ソースJSON マージ機能
// ==========================================

/**
 * 複数のMCP設定ファイルをマージする（後勝ち）
 * リストの先頭から順に読み込み、後方のファイルで前方を上書きする
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
      console.error(`❌ Failed to load ${config.name} (${config.id}): ${e.message}`);
    }
  }

  const totalCount = Object.keys(mergedServers).length;
  console.log(`✅ Merged total: ${totalCount} servers`);
  return { mcpServers: mergedServers };
}

// ==========================================
// メイン関数
// ==========================================
function main() {
  const startTime = Date.now();
  const props = PropertiesService.getScriptProperties();

  // 設定を取得 (スクリプトプロパティから、未設定の場合はデフォルト値を使用)
  const CONFIG = getConfig();

  // 必須プロパティの取得
  const geminiKey = props.getProperty('GEMINI_API_KEY');
  const githubToken = props.getProperty('GITHUB_TOKEN');
  const geminiModel = props.getProperty('GEMINI_MODEL_NAME'); // 例: gemini-1.5-pro

  // Drive設定の確認 (複数ファイル対応 + フォルダ探索)
  const fileConfigs = CONFIG.DRIVE_FILE_CONFIGS;
  const folderIds = CONFIG.DRIVE_FOLDER_IDS; // 配列として取得

  if (!geminiKey || !githubToken || !geminiModel) {
    console.error('設定不足: スクリプトプロパティ(GEMINI_API_KEY, GITHUB_TOKEN, GEMINI_MODEL_NAME)を確認してください。');
    return;
  }

  if (fileConfigs.length === 0 && folderIds.length === 0) {
    console.error('設定不足: DRIVE_JSON_FILE_IDS、DRIVE_JSON_FILE_ID、または DRIVE_FOLDER_ID のいずれかを設定してください。');
    return;
  }

  // --- 1. キュー管理 (Resume機能) ---
  let processingQueue = JSON.parse(props.getProperty('PROCESSING_QUEUE') || '[]');
  let isResuming = processingQueue.length > 0;

  // JSON取得 (Drive) - 複数ファイルのマージ + フォルダ探索
  let mcpData = { mcpServers: {} };

  // Step 1a: 明示的なファイルIDからの読み込み
  if (fileConfigs.length > 0) {
    console.log(`📋 Loading ${fileConfigs.length} explicit config file(s) from Google Drive...`);
    try {
      const fileData = mergeConfigsLastWins(fileConfigs);
      mcpData.mcpServers = { ...mcpData.mcpServers, ...fileData.mcpServers };
    } catch (e) {
      console.error(`Drive (explicit files) 取得エラー: ${e.message}`);
      return;
    }
  }

  // Step 1b: フォルダ再帰探索からの読み込み (複数フォルダ対応)
  if (folderIds.length > 0) {
    for (const fId of folderIds) {
      console.log(`📂 Scanning folder recursively: ${fId}`);
      try {
        // タイムアウト監視のため startTime を引き継ぐ
        const folderData = fetchAllConfigsRecursive(fId, DEFAULT_TARGET_DATE, startTime, CONFIG.MAX_EXECUTION_TIME_MS);
        // フォルダからの設定は後勝ち (上書き)
        mcpData.mcpServers = { ...mcpData.mcpServers, ...folderData.mcpServers };

        // スキャン中にタイムアウトした場合の処理
        if (folderData.partial) {
          console.warn('⚠️ Drive scan timed out. Suspending execution to avoid incomplete data processing.');
          // スキャンすら完了していないので、データが不完全な可能性がある。
          // 無理に処理を進めず、次回実行を予約して終了する。
          setContinuationTrigger();
          return;
        }
      } catch (e) {
        console.error(`Drive (folder scan) 取得エラー [${fId}]: ${e.message}`);
        // 1つのフォルダで失敗しても他は続行する場合は return しない
      }
    }
  }

  if (!mcpData.mcpServers || Object.keys(mcpData.mcpServers).length === 0) {
    console.error('有効なMCPサーバー設定が見つかりませんでした。');
    return;
  }

  // 新規セッション開始時の差分チェック
  if (!isResuming) {
    console.log('Starting new analysis session...');
    
    // 現在のYAMLを取得して比較
    let currentYamlFile;
    try {
      currentYamlFile = fetchGithubFile(CONFIG.REPO_OWNER, CONFIG.REPO_NAME, CONFIG.YAML_PATH, githubToken, CONFIG.BRANCH);
    } catch (e) {
      console.error(`GitHub YAML取得エラー: ${e.message}`);
      return;
    }
    
    const jsonServerNames = Object.keys(mcpData.mcpServers);
    const existingServerNames = extractServerNamesFromYaml(currentYamlFile.content);
    const newModels = jsonServerNames.filter(name => !existingServerNames.includes(name));

    if (newModels.length === 0) {
      console.log('新規モデルはありません。');
      return;
    }

    console.log(`Found ${newModels.length} new models to process.`);
    processingQueue = newModels;
    props.setProperty('PROCESSING_QUEUE', JSON.stringify(processingQueue));
  } else {
    console.log(`Resuming session. Remaining: ${processingQueue.length}`);
  }

  // ルールファイル取得
  let rulesContent = "";
  try {
    const rulesFile = fetchGithubFile(CONFIG.REPO_OWNER, CONFIG.REPO_NAME, CONFIG.RULES_PATH, githubToken, CONFIG.BRANCH);
    rulesContent = rulesFile.content;
  } catch (e) { console.warn(`ルールファイル取得失敗: ${e.message}`); }

  // カテゴリマスタ取得
  console.log('Fetching category_master.json...');
  let categoryMasterInfo = fetchCategoryMaster(CONFIG, githubToken);
  let categoryMaster = categoryMasterInfo.data;
  let categoryMasterSha = categoryMasterInfo.sha;

  // --- 2. Deep Research ループ ---
  // 成果物を一時保存する配列
  let resultsToCommit = {
    yamlUpdates: [],  // { category, content }
    mdUpdates: []     // string (markdown section)
  };
  
  // 既に調査済みの結果があればロード (Resume時用)
  let committedResults = JSON.parse(props.getProperty('COMMITTED_RESULTS') || '{"yamlUpdates":[], "mdUpdates":[]}');
  resultsToCommit = committedResults;

  const initialQueueLength = processingQueue.length;
  let processedCount = 0;

  while (processingQueue.length > 0) {
    // タイムアウト監視
    const elapsedTime = Date.now() - startTime;
    if (elapsedTime > CONFIG.MAX_EXECUTION_TIME_MS) {
      console.warn(`⏳ Time limit. Suspending...`);
      props.setProperty('PROCESSING_QUEUE', JSON.stringify(processingQueue));
      props.setProperty('COMMITTED_RESULTS', JSON.stringify(resultsToCommit)); // 途中経過を保存
      setContinuationTrigger();
      return; 
    }

    const modelKey = processingQueue[0];
    const modelInfo = mcpData.mcpServers[modelKey];
    console.log(`\n[${processedCount + 1}/${initialQueueLength}] 🔍 Researching: ${modelKey}...`);

    // 接頭辞を抽出してカテゴリマスタを照合
    const prefix = extractPrefixFromServerName(modelKey);
    let categoryInfo = getCategoryFromPrefix(prefix, categoryMaster);
    let isNewPrefix = false;

    if (categoryInfo) {
      console.log(`✅ Prefix "${prefix}" found in master -> ${categoryInfo.category_key}`);
    } else {
      console.log(`⚠️ Unknown prefix "${prefix}" - will use Gemini to determine category`);
      isNewPrefix = true;
    }

    // Gemini調査 (カテゴリ情報を渡す)
    const result = researchModelWithGemini(modelKey, modelInfo, rulesContent, geminiKey, geminiModel, categoryInfo);

    if (result) {
      console.log(`Thought: ${result.thought_process.substring(0, 100)}...`);

      if (result.is_found) {
        // 未知の接頭辞の場合、Geminiの推論結果でマスタを更新
        if (isNewPrefix && result.category) {
          const categoryDescription = result.category_description || `${prefix}から始まるモデルのカテゴリ`;
          const updated = addPrefixToCategoryMaster(
            prefix,
            result.category,
            categoryDescription,
            categoryMaster,
            categoryMasterSha,
            CONFIG,
            githubToken
          );
          if (updated) {
            // SHAを更新するために再取得
            categoryMasterInfo = fetchCategoryMaster(CONFIG, githubToken);
            categoryMaster = categoryMasterInfo.data;
            categoryMasterSha = categoryMasterInfo.sha;
          }
        }

        console.log(`✅ FOUND: ${result.category}`);
        resultsToCommit.yamlUpdates.push({
          category: result.category,
          entry: result.yaml_entry
        });
      } else {
        console.log(`❓ UNKNOWN`);
        resultsToCommit.mdUpdates.push(result.unknown_reason_markdown);
      }
    } else {
      console.error(`Failed to research ${modelKey}`);
    }

    processingQueue.shift();
    // 進行状況を逐次保存 (クラッシュ対策)
    props.setProperty('PROCESSING_QUEUE', JSON.stringify(processingQueue));
    props.setProperty('COMMITTED_RESULTS', JSON.stringify(resultsToCommit));
    processedCount++;
    
    Utilities.sleep(2000); // Rate Limit
  }

  // --- 3. GitHubへのコミット処理 (キューが空になったら実行) ---
  console.log("\n========================================");
  console.log("          APPLYING UPDATES              ");
  console.log("========================================");

  // 1) YAMLの更新
  if (resultsToCommit.yamlUpdates.length > 0) {
    try {
      console.log(`Updating YAML (${resultsToCommit.yamlUpdates.length} entries)...`);
      const yamlFile = fetchGithubFile(CONFIG.REPO_OWNER, CONFIG.REPO_NAME, CONFIG.YAML_PATH, githubToken, CONFIG.BRANCH);
      let newYamlContent = yamlFile.content;

      // 変更を適用 (テキスト操作)
      // 複数件ある場合、文字列が変化するので都度検索して挿入
      for (const update of resultsToCommit.yamlUpdates) {
        newYamlContent = insertIntoYaml(newYamlContent, update.category, update.entry, CONFIG.INDENT_SIZE);
      }

      updateGithubFile(CONFIG.REPO_OWNER, CONFIG.REPO_NAME, CONFIG.YAML_PATH, newYamlContent, yamlFile.sha, CONFIG.COMMIT_MSG_YAML, githubToken, CONFIG.BRANCH);
      console.log('YAML updated successfully.');
    } catch (e) {
      console.error(`Failed to update YAML: ${e.message}`);
    }
  }

  // 2) Markdownの更新
  if (resultsToCommit.mdUpdates.length > 0) {
    try {
      console.log(`Updating Markdown (${resultsToCommit.mdUpdates.length} entries)...`);
      const mdFile = fetchGithubFile(CONFIG.REPO_OWNER, CONFIG.REPO_NAME, CONFIG.UNKNOWN_MD_PATH, githubToken, CONFIG.BRANCH);
      let newMdContent = mdFile.content;

      // 追記ブロックの作成
      const today = Utilities.formatDate(new Date(), 'JST', 'yyyy-MM-dd HH:mm');
      let additionBlock = `\n## 調査報告 (${today})\n`;
      additionBlock += resultsToCommit.mdUpdates.join("\n");
      additionBlock += "\n---"; // 区切り線

      // 挿入位置: 最初の見出し(# または ##)より後、かつ最新の履歴として上部に
      // 通常はタイトルの直後、または「調査完了」などのセクションの前
      // ここでは、ファイル内の最初の "## " (H2見出し) の直前に挿入することで「最新を上」にする
      const firstH2Index = newMdContent.indexOf('\n## ');
      
      if (firstH2Index !== -1) {
        newMdContent = newMdContent.substring(0, firstH2Index) + additionBlock + newMdContent.substring(firstH2Index);
      } else {
        // H2がない場合は末尾に追加
        newMdContent += additionBlock;
      }

      updateGithubFile(CONFIG.REPO_OWNER, CONFIG.REPO_NAME, CONFIG.UNKNOWN_MD_PATH, newMdContent, mdFile.sha, CONFIG.COMMIT_MSG_MD, githubToken, CONFIG.BRANCH);
      console.log('Markdown updated successfully.');
    } catch (e) {
      console.error(`Failed to update Markdown: ${e.message}`);
    }
  }

  // --- 4. クリーンアップ ---
  props.deleteProperty('PROCESSING_QUEUE');
  props.deleteProperty('COMMITTED_RESULTS');
  deleteContinuationTriggers();
  console.log("Done.");
}

// ==========================================
// カテゴリマスタ関連
// ==========================================

/**
 * server_nameから接頭辞を抽出する
 * 形式: {prefix}-kamui-{model_name} または {prefix}-kamui-{provider}-{model_name}
 * @param {string} serverName - server_name (例: t2i-kamui-flux-schnell)
 * @returns {string} 接頭辞 (例: t2i)
 */
function extractPrefixFromServerName(serverName) {
  if (!serverName) return '';

  // "kamui" の直前までを接頭辞として抽出
  const kamuiIndex = serverName.indexOf('-kamui');
  if (kamuiIndex > 0) {
    return serverName.substring(0, kamuiIndex);
  }

  // "kamui" がない場合は最初のハイフンまでを接頭辞とする
  const firstHyphen = serverName.indexOf('-');
  if (firstHyphen > 0) {
    return serverName.substring(0, firstHyphen);
  }

  return serverName;
}

/**
 * カテゴリマスタをGitHubから取得する
 * @param {Object} CONFIG - 設定オブジェクト
 * @param {string} githubToken - GitHubトークン
 * @returns {Object} カテゴリマスタデータ
 */
function fetchCategoryMaster(CONFIG, githubToken) {
  try {
    const file = fetchGithubFile(CONFIG.REPO_OWNER, CONFIG.REPO_NAME, CONFIG.CATEGORY_MASTER_PATH, githubToken, CONFIG.BRANCH);
    return {
      data: JSON.parse(file.content),
      sha: file.sha
    };
  } catch (e) {
    console.error(`カテゴリマスタ取得エラー: ${e.message}`);
    // デフォルトの空マスタを返す
    return {
      data: { prefix_to_category: {} },
      sha: null
    };
  }
}

/**
 * 接頭辞からカテゴリキーを取得する
 * @param {string} prefix - 接頭辞
 * @param {Object} categoryMaster - カテゴリマスタデータ
 * @returns {Object|null} カテゴリ情報 { category_key, description } または null (未知の場合)
 */
function getCategoryFromPrefix(prefix, categoryMaster) {
  if (categoryMaster.prefix_to_category && categoryMaster.prefix_to_category[prefix]) {
    return categoryMaster.prefix_to_category[prefix];
  }
  return null;
}

/**
 * カテゴリマスタに新しい接頭辞を追加してGitHubにコミットする
 * @param {string} prefix - 新しい接頭辞
 * @param {string} categoryKey - カテゴリキー
 * @param {string} description - カテゴリの説明
 * @param {Object} categoryMaster - 現在のカテゴリマスタデータ
 * @param {string} sha - 現在のファイルのSHA
 * @param {Object} CONFIG - 設定オブジェクト
 * @param {string} githubToken - GitHubトークン
 * @returns {boolean} 成功/失敗
 */
function addPrefixToCategoryMaster(prefix, categoryKey, description, categoryMaster, sha, CONFIG, githubToken) {
  try {
    // マスタデータを更新
    categoryMaster.prefix_to_category[prefix] = {
      category_key: categoryKey,
      description: description
    };

    // JSONとして整形
    const newContent = JSON.stringify(categoryMaster, null, 2) + '\n';

    // GitHubにコミット
    updateGithubFile(
      CONFIG.REPO_OWNER,
      CONFIG.REPO_NAME,
      CONFIG.CATEGORY_MASTER_PATH,
      newContent,
      sha,
      CONFIG.COMMIT_MSG_CATEGORY_MASTER,
      githubToken,
      CONFIG.BRANCH
    );

    console.log(`カテゴリマスタに新規接頭辞を追加: ${prefix} -> ${categoryKey}`);
    return true;
  } catch (e) {
    console.error(`カテゴリマスタ更新エラー: ${e.message}`);
    return false;
  }
}

// ==========================================
// 文字列操作ロジック
// ==========================================

/**
 * YAMLテキスト内の適切な位置にエントリを挿入する
 * @param {string} yamlContent - 既存のYAMLコンテンツ
 * @param {string} category - 挿入先カテゴリ (例: text_to_image)
 * @param {string} entry - 挿入するエントリ (インデントなし)
 * @param {number} indentSize - 基本インデント幅 (スペース数)
 */
function insertIntoYaml(yamlContent, category, entry, indentSize) {
  // デフォルト値 (引数が未指定の場合)
  indentSize = indentSize || DEFAULT_CONFIG.INDENT_SIZE;

  // インデント文字列を生成
  const baseIndent = ' '.repeat(indentSize);           // カテゴリ用 (2スペース)
  const listIndent = ' '.repeat(indentSize * 2);       // リストアイテム用 (4スペース)

  // 1. エントリのインデント処理
  // Geminiにはフラットに出力させるため、ここで階層構造(リストアイテム)のインデントを付与する
  const cleanEntryLines = entry.trim().split('\n');
  const indentedEntry = cleanEntryLines.map(line => listIndent + line).join('\n');

  // 2. カテゴリブロックを探す (例: "  text_to_image:")
  const categoryRegex = new RegExp(`^\\s{0,${indentSize}}${category}:`, 'm');
  const match = categoryRegex.exec(yamlContent);

  if (match) {
    // カテゴリが存在する場合:
    // 次のカテゴリ(インデント0-indentSizeの行)またはファイル末尾を探し、その直前に挿入
    const startIdx = match.index + match[0].length;
    const remaining = yamlContent.substring(startIdx);

    // 次のカテゴリ開始行を探す (正規表現: 行頭スペース0-indentSize個 + 文字 + コロン)
    const nextKeyRegex = new RegExp(`^\\s{0,${indentSize}}[a-z0-9_]+:`, 'm');
    const nextMatch = nextKeyRegex.exec(remaining);

    let insertPos;
    if (nextMatch) {
      insertPos = startIdx + nextMatch.index;
    } else {
      insertPos = yamlContent.length;
    }

    // 挿入 (インデント済みエントリを追加)
    return yamlContent.substring(0, insertPos) + indentedEntry + "\n" + yamlContent.substring(insertPos);

  } else {
    // カテゴリが存在しない場合: ファイル末尾に新設
    return yamlContent + `\n${baseIndent}${category}:\n${indentedEntry}\n`;
  }
}


// ==========================================
// Gemini API 連携
// ==========================================
/**
 * Gemini APIを使用してモデル情報を調査する
 * @param {string} serverName - server_name
 * @param {Object} modelInfo - モデル情報 (description, url等)
 * @param {string} rulesText - 調査ルールのテキスト
 * @param {string} apiKey - Gemini APIキー
 * @param {string} modelName - 使用するGeminiモデル名
 * @param {Object|null} categoryInfo - カテゴリマスタからの情報 (null の場合はGeminiに推論させる)
 * @returns {Object|null} 調査結果
 */
function researchModelWithGemini(serverName, modelInfo, rulesText, apiKey, modelName, categoryInfo) {
  const endpoint = `https://generativelanguage.googleapis.com/v1beta/models/${modelName}:generateContent?key=${apiKey}`;

  // カテゴリが事前に決まっているかどうかでプロンプトを変える
  let categoryInstruction;
  if (categoryInfo && categoryInfo.category_key) {
    categoryInstruction = `
  【★重要: カテゴリ分類】
  このモデルのカテゴリは server_name の接頭辞から既に判明しています。
  以下のカテゴリキーを使用してください:
  - category: ${categoryInfo.category_key}
  - description: ${categoryInfo.description}

  カテゴリの推論は不要です。上記のカテゴリキーをそのまま使用してください。`;
  } else {
    categoryInstruction = `
  【★重要: カテゴリ分類 (未知の接頭辞)】
  このモデルの接頭辞はカテゴリマスタに登録されていません。
  descriptionの内容から、このモデルが属するカテゴリ(key)を推論してください。
  既存カテゴリ: text_to_image, image_to_image, text_to_video, image_to_video, video_to_video,
               text_to_speech, audio_to_text, text_to_audio, text_to_music, video_to_audio,
               image_to_3d, text_to_3d, 3d_to_3d, training, utility_and_analysis, miscellaneous, etc.

  新しいカテゴリが必要な場合は適切な英語のキー(snake_case)を作成し、
  category_description に日本語で説明を記載してください。`;
  }

  const prompt = `
  あなたは厳格かつ柔軟なAIリサーチャーです。
  Web検索を行い、AIモデルの正確な情報をYAML形式で出力してください。

  【調査対象】
  - server_name: ${serverName}
  - description: ${modelInfo.description || 'N/A'}
  - url: ${modelInfo.url || 'N/A'}

  【調査ルール】
  ${rulesText}
  ${categoryInstruction}

  【★重要: YAMLの記述ルール (日本語)】
  既存のYAMLファイルと同様に、**日本語で分かりやすく**記述してください。
  **インデントは付けず、行頭から記述してください（プログラム側で調整します）。**
  - name: モデルの正式名称
  - features: "(開発元) モデルの概要、主な機能、特徴を日本語で簡潔に記述。"

  例:
- name: FLUX.1 [dev]
  server_name: t2i-kamui-flux-1-dev
  release_date: 2024年8月1日
  features: "(Black Forest Labs) 高品質な画像生成モデル。プロンプトへの忠実性が高く、商用利用も可能なオープンウェイトモデル。"

  【★重要: リリース日不明時の対応】
  調査してもリリース日が特定できない場合は、YAMLエントリは作成せず、is_found を false に設定し、
  別途 markdown形式で不明理由を報告してください。

  【出力スキーマ】
  必ず以下のJSON形式で出力すること。
  {
    "thought_process": "簡潔な思考プロセス(200文字以内)",
    "category": "string (例: text_to_image)",
    "category_description": "string (カテゴリの日本語説明。未知の接頭辞の場合のみ必要)",
    "yaml_entry": "string (YAML形式のエントリ。インデントなし)",
    "is_found": boolean (リリース日が特定できたか),
    "unknown_reason_markdown": "string (不明な場合のみ: unknown_release_dates.md に追記するためのMarkdownテキスト)"
  }

  【unknown_reason_markdown のフォーマット】
  - **モデル名**: ... (server_name: ${serverName})
  - **推測される開発元**: ...
  - **調査で確認した情報源**: (URLなど)
  - **不明な理由**: ...
  `;

  const payload = {
    contents: [{ parts: [{ text: prompt }] }],
    tools: [{ google_search: {} }],
    generationConfig: {
      responseMimeType: "application/json",
      responseSchema: {
        type: "OBJECT",
        properties: {
          thought_process: { type: "STRING" },
          category: { type: "STRING" },
          category_description: { type: "STRING" },
          yaml_entry: { type: "STRING" },
          is_found: { type: "BOOLEAN" },
          unknown_reason_markdown: { type: "STRING" }
        },
        required: ["thought_process", "category", "yaml_entry", "is_found"]
      }
    }
  };

  try {
    const response = UrlFetchApp.fetch(endpoint, {
      method: 'post',
      contentType: 'application/json',
      payload: JSON.stringify(payload),
      muteHttpExceptions: true
    });

    const resJson = JSON.parse(response.getContentText());
    if (resJson.error) {
      console.error(`Gemini API Error: ${JSON.stringify(resJson.error)}`);
      return null;
    }
    
    if (resJson.candidates && resJson.candidates[0] && resJson.candidates[0].content) {
      let text = resJson.candidates[0].content.parts[0].text;
      text = text.replace(/^```json\s*/, '').replace(/^```\s*/, '').replace(/```\s*$/, '').trim();
      return JSON.parse(text);
    }
    return null;

  } catch (e) {
    console.error(`JSON Parse Error: ${e.message}`);
    return null;
  }
}

// ==========================================
// トリガー管理 / GitHub API / ユーティリティ
// ==========================================

/**
 * Resume用の継続トリガーを作成する
 * トリガーのUniqueIdをスクリプトプロパティに保存し、後で特定・削除できるようにする
 */
function setContinuationTrigger() {
  const props = PropertiesService.getScriptProperties();
  
  // ★修正: 既存のトリガーIDがあっても、それは「今回の実行を起こした古いトリガー」である可能性が高い。
  // また、再タイムアウト時は「次のための新しいトリガー」が必要なので、
  // 古いトリガー情報は破棄して、常に新しく作り直す（上書きする）のが正しい。

  // 既存の継続トリガーがあれば削除（クリーンアップ）
  deleteContinuationTriggers();

  // 新規トリガーを作成しIDを保存
  const newTrigger = ScriptApp.newTrigger('main').timeBased().after(1 * 60 * 1000).create();
  props.setProperty('CONTINUATION_TRIGGER_ID', newTrigger.getUniqueId());
  console.log(`Continuation trigger created: ${newTrigger.getUniqueId()}`);
}

/**
 * 継続トリガーのみを削除する
 * スクリプトプロパティに保存されたIDと一致するトリガーだけを削除し、
 * ユーザーが設定した定期実行トリガーは保持する
 */
function deleteContinuationTriggers() {
  const props = PropertiesService.getScriptProperties();
  const continuationTriggerId = props.getProperty('CONTINUATION_TRIGGER_ID');

  if (!continuationTriggerId) {
    console.log('No continuation trigger ID found.');
    return;
  }

  const triggers = ScriptApp.getProjectTriggers();
  for (const trigger of triggers) {
    if (trigger.getUniqueId() === continuationTriggerId) {
      ScriptApp.deleteTrigger(trigger);
      console.log(`Continuation trigger deleted: ${continuationTriggerId}`);
      break;
    }
  }

  // IDをクリア
  props.deleteProperty('CONTINUATION_TRIGGER_ID');
}

function extractServerNamesFromYaml(yamlContent) {
  const names = [];
  const regex = /server_name:\s*([^\s#]+)/g;
  let match;
  while ((match = regex.exec(yamlContent)) !== null) {
    names.push(match[1]);
  }
  return names;
}

function fetchGithubFile(owner, repo, path, token, branch) {
  // branch が未指定の場合はデフォルト値を使用
  branch = branch || DEFAULT_CONFIG.BRANCH;
  const url = `https://api.github.com/repos/${owner}/${repo}/contents/${path}?ref=${branch}`;
  const options = {
    method: 'get',
    headers: { 'Authorization': `token ${token}`, 'Accept': 'application/vnd.github.v3+json' },
    muteHttpExceptions: true
  };
  
  const response = UrlFetchApp.fetch(url, options);
  if (response.getResponseCode() !== 200) throw new Error(`GitHub Error: ${response.getContentText()}`);
  
  const data = JSON.parse(response.getContentText());
  let contentStr = "";

  // ★修正: contentプロパティが存在するか確認
  if (data.content) {
    // 1MB以下の通常ファイル
    contentStr = Utilities.newBlob(Utilities.base64Decode(data.content)).getDataAsString('UTF-8');
  } else if (data.sha) {
    // ★重要修正: data.contentがない(1MB超)場合、Git Blobs APIを使って安全に取得する
    // download_url はリダイレクトや認証で不安定なため使用しない
    console.log(`Info: File ${path} is large. Fetching raw content via Blobs API (SHA: ${data.sha}).`);
    
    // Blobs API エンドポイント
    const blobUrl = `https://api.github.com/repos/${owner}/${repo}/git/blobs/${data.sha}`;
    const blobOptions = {
      method: 'get',
      headers: { 
        'Authorization': `token ${token}`,
        'Accept': 'application/vnd.github.v3.raw' // Raw形式(テキスト)で取得
      },
      muteHttpExceptions: true
    };
    
    const blobResponse = UrlFetchApp.fetch(blobUrl, blobOptions);
    if (blobResponse.getResponseCode() !== 200) {
      throw new Error(`Failed to fetch blob content: ${blobResponse.getContentText()}`);
    }
    contentStr = blobResponse.getContentText();
  } else {
    throw new Error('GitHub API response contained neither content nor sha.');
  }

  return { content: contentStr, sha: data.sha };
}

function updateGithubFile(owner, repo, path, newContent, sha, message, token, branch) {
  // branch が未指定の場合はデフォルト値を使用
  branch = branch || DEFAULT_CONFIG.BRANCH;

  const url = `https://api.github.com/repos/${owner}/${repo}/contents/${path}`;
  const payload = {
    message: message,
    content: Utilities.base64Encode(newContent, Utilities.Charset.UTF_8),
    sha: sha,
    branch: branch
  };
  const options = {
    method: 'put',
    headers: { 'Authorization': `token ${token}`, 'Accept': 'application/vnd.github.v3+json' },
    payload: JSON.stringify(payload)
  };
  UrlFetchApp.fetch(url, options);
}
