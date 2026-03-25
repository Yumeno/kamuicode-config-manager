/**
 * kamuicode Config Manager Auto Updater (Production Mode)
 *
 * 概要:
 * 1. mcp-kamui-code.json を Google Drive から取得 (Resume対応)
 * 2. 未処理のモデルキューをチェック (なければ新規作成)
 * 3. カテゴリマスタ (category_master.json) に基づいてカテゴリを判定
 * 4. 未知の接頭辞の場合は Gemini で推論してマスタを自動更新
 * 5. 結果判定と更新データの作成:
 *    - 判明時: YAMLのカテゴリブロック末尾へ挿入
 *    - 不明時: Markdownの先頭(履歴の上)へ追記
 * 6. GitHubへコミット＆プッシュ
 * 7. タイムアウト回避 (Resume機能)
 *
 * Resume機能の概要 (Issue #30 対応):
 * - GAS実行時間制限(6分)対策として、スキャン/調査の進行状況をGoogle Driveに保存
 * - 再帰的フォルダ探索を反復処理(while loop)に変更し、中断・再開を可能に
 * - フェーズ管理: Phase1(スキャン) → Phase2(調査) → Phase3(コミット)
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
  // GAS制限は6分だが、余裕を持って4.5分で中断
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

// フィルタリング基準日 (2025年11月20日)
// この日付以降に更新されたファイルのみをスキャン対象とする
const DEFAULT_TARGET_DATE = new Date('2025-11-20T00:00:00');

/**
 * スクリプトプロパティから設定を取得する
 * 未設定の場合はデフォルト値を使用
 * @returns {Object} 設定オブジェクト
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

    // ファイルパス
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

    // フォルダ再帰探索設定 (配列)
    DRIVE_FOLDER_IDS: driveFolderIds,

    // Resume用キャッシュフォルダID (状態ファイルの保存先)
    RESUME_CACHE_FOLDER_ID: props.getProperty('RESUME_CACHE_FOLDER_ID') || null
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
              return { name: item.name || `Source_${i + 1}`, id: item.id || '' };
            } else if (typeof item === 'string') {
              return { name: `Source_${i + 1}`, id: item };
            }
            return { name: `Source_${i + 1}`, id: '' };
          }).filter(c => c.id);
        }
      } catch (e) {
        console.warn(`JSON parse failed: ${e.message}`);
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
// ユーティリティ: 時間管理 & 状態保存
// ==========================================

/**
 * 実行時間が制限に近づいているか判定する
 * @param {number} startTime - 開始時刻 (Date.now())
 * @param {number} limitMs - 制限時間(ms)
 * @returns {boolean} 時間切れならtrue
 */
function isTimeUp(startTime, limitMs) {
  // 安全マージンとして30秒前に判定 (状態保存の時間を確保)
  return (Date.now() - startTime) > (limitMs - 30000);
}

/**
 * JSONデータをGoogle Driveの一時ファイルとして保存する
 * @param {string} filename - ファイル名
 * @param {Object} data - 保存するデータ
 * @param {string|null} folderId - 保存先フォルダID (nullの場合はルートフォルダ)
 * @returns {string} 作成されたファイルのID
 */
function saveStateToDrive(filename, data, folderId) {
  const blob = Utilities.newBlob(JSON.stringify(data), 'application/json', filename);
  let file;

  if (folderId) {
    try {
      // 指定フォルダにファイルを作成
      const folder = DriveApp.getFolderById(folderId);
      file = folder.createFile(blob);
      console.log(`📁 State saved to folder: ${folder.getName()}`);
    } catch (e) {
      console.warn(`⚠️ Failed to access folder ${folderId}: ${e.message}. Falling back to root folder.`);
      file = DriveApp.createFile(blob);
    }
  } else {
    // フォルダ未指定の場合はルートフォルダに作成
    file = DriveApp.createFile(blob);
  }

  return file.getId();
}

/**
 * Google Driveから状態ファイルを読み込む
 * @param {string} fileId - ファイルID
 * @returns {Object|null} パースされたJSONデータ、失敗時はnull
 */
function loadStateFromDrive(fileId) {
  try {
    const file = DriveApp.getFileById(fileId);
    return JSON.parse(file.getBlob().getDataAsString());
  } catch (e) {
    console.warn(`Failed to load state file ${fileId}: ${e.message}`);
    return null;
  }
}

/**
 * Google Driveのファイルをゴミ箱に移動する
 * @param {string} fileId - ファイルID
 */
function deleteFileFromDrive(fileId) {
  try {
    DriveApp.getFileById(fileId).setTrashed(true);
  } catch (e) {
    console.warn(`Failed to delete file ${fileId}: ${e.message}`);
  }
}

// ==========================================
// フォルダ探索ロジック (反復・Resume対応版)
// ==========================================

/**
 * 反復的(Iterative)なフォルダスキャンを実行する
 *
 * 従来の再帰的探索ではスタックオーバーフローや中断困難の問題があったため、
 * whileループによる反復探索に変更。これにより:
 * - スタックオーバーフローを防止
 * - 任意のタイミングで中断・再開が可能
 * - 状態(キュー)を外部に保存可能
 *
 * @param {Object} scanState - スキャン状態 { scanQueue: string[], foundServers: Object }
 * @param {Date} targetDate - フィルタリング基準日
 * @param {number} startTime - スクリプト開始時刻
 * @param {number} timeLimit - 制限時間(ms)
 * @returns {{isInterrupted: boolean}} 中断されたかどうか
 */
function performIterativeScan(scanState, targetDate, startTime, timeLimit) {
  let isInterrupted = false;

  // 処理済みファイルセットの初期化（Resume対応）
  // scanState.processedFiles: { folderId: Set<fileName> } の形式で管理
  if (!scanState.processedFiles) {
    scanState.processedFiles = {};
  }

  // scanQueue: 探索待ちのフォルダIDリスト (FIFO: 幅優先探索)
  while (scanState.scanQueue.length > 0) {
    // 時間チェック (フォルダ単位)
    if (isTimeUp(startTime, timeLimit)) {
      console.warn('⏳ Scan time limit reached (folder loop). Suspending...');
      isInterrupted = true;
      break;
    }

    // キューから先頭のフォルダを取り出す
    const currentFolderId = scanState.scanQueue.shift();

    // このフォルダの処理済みファイルセットを取得（なければ空セット）
    const processedInThisFolder = new Set(scanState.processedFiles[currentFolderId] || []);

    try {
      const folder = DriveApp.getFolderById(currentFolderId);

      // 1. ファイル処理
      const files = folder.getFiles();
      while (files.hasNext()) {
        // 時間チェック (ファイル単位)
        if (isTimeUp(startTime, timeLimit)) {
          // 時間切れの場合、処理済みファイル情報を保存してフォルダをキューの先頭に戻す
          scanState.processedFiles[currentFolderId] = Array.from(processedInThisFolder);
          scanState.scanQueue.unshift(currentFolderId);
          console.warn('⏳ Scan time limit reached (file loop). Suspending...');
          isInterrupted = true;
          break;
        }

        const file = files.next();
        const fileName = file.getName();

        // 条件0: すでに処理済みのファイルはスキップ（Resume時の堂々巡り防止）
        if (processedInThisFolder.has(fileName)) continue;

        // 条件1: 拡張子が .json であること
        if (!fileName.endsWith('.json')) continue;

        // 条件2: 更新日時が基準日以降であること
        if (file.getLastUpdated() < targetDate) continue;

        try {
          const content = JSON.parse(file.getBlob().getDataAsString());

          // 条件3: 構造チェック (mcpServersキーがあるか、かつオブジェクトか)
          if (content && content.mcpServers && typeof content.mcpServers === 'object' && !Array.isArray(content.mcpServers)) {
            // マージ処理 (後勝ち)
            scanState.foundServers = { ...scanState.foundServers, ...content.mcpServers };
            console.log(`✅ Found config: ${fileName} in ${folder.getName()}`);
          }
        } catch (e) {
          // JSONパースエラー等は無視して次のファイルへ
        }

        // 処理済みとしてマーク
        processedInThisFolder.add(fileName);
      }

      if (isInterrupted) break;

      // フォルダ処理完了: 処理済みファイル情報をクリーンアップ（不要になったため）
      delete scanState.processedFiles[currentFolderId];

      // 2. サブフォルダをキューに追加 (幅優先探索)
      const subFolders = folder.getFolders();
      while (subFolders.hasNext()) {
        const subFolder = subFolders.next();
        scanState.scanQueue.push(subFolder.getId());
      }

    } catch (e) {
      console.warn(`❌ Error accessing folder ${currentFolderId}: ${e.message}`);
      // アクセス権限がないなどの場合、このフォルダはスキップして次へ
      // 処理済みファイル情報もクリーンアップ
      delete scanState.processedFiles[currentFolderId];
    }
  }

  return { isInterrupted };
}

// ==========================================
// メイン関数
// ==========================================

/**
 * メインエントリポイント
 *
 * フェーズ管理:
 * - Phase 1: Scan (フォルダスキャン) - Drive内のMCP設定ファイルを収集
 * - Phase 2: Research (Gemini調査) - 新規モデルの情報を調査
 * - Phase 3: Apply Updates (更新適用) - GitHub上のファイルを更新
 *
 * 各フェーズで時間切れになった場合、状態を保存して1分後に再実行
 */
function main() {
  const startTime = Date.now();
  const props = PropertiesService.getScriptProperties();
  const CONFIG = getConfig();

  // 必須プロパティの取得と検証
  const geminiKey = props.getProperty('GEMINI_API_KEY');
  const githubToken = props.getProperty('GITHUB_TOKEN');
  const geminiModel = props.getProperty('GEMINI_MODEL_NAME'); // 例: gemini-1.5-pro
  const fileConfigs = CONFIG.DRIVE_FILE_CONFIGS;
  const folderIds = CONFIG.DRIVE_FOLDER_IDS;

  if (!geminiKey || !githubToken || !geminiModel) {
    console.error('設定不足: GEMINI_API_KEY, GITHUB_TOKEN, GEMINI_MODEL_NAME を確認してください。');
    return;
  }
  if (fileConfigs.length === 0 && folderIds.length === 0) {
    console.error('設定不足: DRIVE_JSON_FILE_IDS、DRIVE_JSON_FILE_ID、または DRIVE_FOLDER_ID のいずれかを設定してください。');
    return;
  }

  // === フェーズ管理用の状態変数 ===
  let processingQueue = JSON.parse(props.getProperty('PROCESSING_QUEUE') || '[]');
  let sessionDataId = props.getProperty('SESSION_DATA_FILE_ID');
  let mcpData = { mcpServers: {} };

  // -----------------------------------------------
  // Phase 2 Resume Check: 調査フェーズの途中再開
  // -----------------------------------------------
  if (processingQueue.length > 0 && sessionDataId) {
    console.log('🔄 Resuming Research Session (Phase 2)...');
    const sessionData = loadStateFromDrive(sessionDataId);
    if (sessionData) {
      mcpData = sessionData;
    } else {
      // セッションデータの読み込み失敗: 状態をクリアして新規スキャンからやり直す
      console.error('❌ Failed to load session data. Clearing state and restarting...');
      props.deleteProperty('PROCESSING_QUEUE');
      props.deleteProperty('SESSION_DATA_FILE_ID');
      props.deleteProperty('COMMITTED_RESULTS');
      deleteContinuationTriggers();
      // 次回実行で新規スキャンが開始される
      return;
    }
  }
  // -----------------------------------------------
  // Phase 1: Scan (新規セッション or スキャン再開)
  // -----------------------------------------------
  else {
    let scanStateId = props.getProperty('SCAN_STATE_FILE_ID');
    let scanState = { scanQueue: [], foundServers: {}, processedFiles: {} };

    // スキャン中断からの再開チェック
    if (scanStateId) {
      console.log('🔄 Resuming Folder Scan (Phase 1)...');
      const loaded = loadStateFromDrive(scanStateId);
      if (loaded) {
        scanState = loaded;
        // processedFilesが古い形式（存在しない）場合は初期化
        if (!scanState.processedFiles) {
          scanState.processedFiles = {};
        }
        const pendingFilesCount = Object.values(scanState.processedFiles).reduce((sum, arr) => sum + arr.length, 0);
        console.log(`📊 Resumed state: Queue=${scanState.scanQueue.length}, Found=${Object.keys(scanState.foundServers).length}, PendingFiles=${pendingFilesCount}`);
      } else {
        console.warn('⚠️ Failed to load scan state. Clearing and restarting scan.');
        props.deleteProperty('SCAN_STATE_FILE_ID');
        scanStateId = null;
      }
    }

    // 新規スキャン開始時の初期化
    if (!scanStateId) {
      console.log('🚀 Starting New Scan Session...');

      // Step 1a: 明示的ファイルID(高速)を先にロード
      if (fileConfigs.length > 0) {
        console.log(`📋 Loading ${fileConfigs.length} explicit config file(s)...`);
        const fileData = mergeConfigsLastWins(fileConfigs);
        scanState.foundServers = fileData.mcpServers;
      }

      // Step 1b: フォルダ探索キューの初期化
      scanState.scanQueue = [...folderIds];
    }

    // スキャン実行 (反復処理)
    if (scanState.scanQueue.length > 0) {
      console.log(`📂 Scanning folders (Queue: ${scanState.scanQueue.length})...`);
      const result = performIterativeScan(scanState, DEFAULT_TARGET_DATE, startTime, CONFIG.MAX_EXECUTION_TIME_MS);

      if (result.isInterrupted) {
        // タイムアウト中断: 状態を保存して終了
        const pendingFilesCount = Object.values(scanState.processedFiles).reduce((sum, arr) => sum + arr.length, 0);
        console.log(`💾 Saving scan state: Queue=${scanState.scanQueue.length}, Found=${Object.keys(scanState.foundServers).length}, PendingFiles=${pendingFilesCount}`);

        // 古い状態ファイルがあれば削除（重複防止）
        if (scanStateId) deleteFileFromDrive(scanStateId);

        const newScanStateId = saveStateToDrive('kamui_scan_state_temp.json', scanState, CONFIG.RESUME_CACHE_FOLDER_ID);
        props.setProperty('SCAN_STATE_FILE_ID', newScanStateId);
        setContinuationTrigger();
        return; // 終了、1分後に再開
      }
    }

    // スキャン完了
    console.log(`✅ Scan Complete. Total servers found: ${Object.keys(scanState.foundServers).length}`);
    mcpData.mcpServers = scanState.foundServers;

    // スキャン状態ファイルのクリーンアップ
    if (scanStateId) {
      deleteFileFromDrive(scanStateId);
      props.deleteProperty('SCAN_STATE_FILE_ID');
    }

    // 調査フェーズ用にセッションデータを保存
    const newSessionId = saveStateToDrive('kamui_session_data.json', mcpData, CONFIG.RESUME_CACHE_FOLDER_ID);
    props.setProperty('SESSION_DATA_FILE_ID', newSessionId);

    // --- 差分チェック & キュー作成 ---
    console.log('Comparing with existing YAML...');
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
      console.log('✨ No new models found. All models are already in YAML.');
      // セッションデータ削除
      deleteFileFromDrive(newSessionId);
      props.deleteProperty('SESSION_DATA_FILE_ID');
      return;
    }

    console.log(`Found ${newModels.length} new models to process.`);
    processingQueue = newModels;
    props.setProperty('PROCESSING_QUEUE', JSON.stringify(processingQueue));
  }

  // -----------------------------------------------
  // Phase 2: Deep Research (Gemini調査)
  // -----------------------------------------------

  // ルールファイル取得
  let rulesContent = "";
  try {
    const rulesFile = fetchGithubFile(CONFIG.REPO_OWNER, CONFIG.REPO_NAME, CONFIG.RULES_PATH, githubToken, CONFIG.BRANCH);
    rulesContent = rulesFile.content;
  } catch (e) {
    console.warn(`ルールファイル取得失敗: ${e.message}`);
  }

  // カテゴリマスタ取得
  let categoryMasterInfo = fetchCategoryMaster(CONFIG, githubToken);
  let categoryMaster = categoryMasterInfo.data;
  let categoryMasterSha = categoryMasterInfo.sha;

  // 既存カテゴリキー一覧を抽出（重複排除）してGeminiに渡す
  const existingCategories = [...new Set(
    Object.values(categoryMaster.prefix_to_category || {}).map(v => v.category_key)
  )];

  // 調査結果の一時保存（Resume時に復元）
  let resultsToCommit = JSON.parse(props.getProperty('COMMITTED_RESULTS') || '{"yamlUpdates":[], "mdUpdates":[]}');

  const initialQueueLength = processingQueue.length;
  let processedCount = 0;

  // 調査ループ
  while (processingQueue.length > 0) {
    // タイムアウト監視
    if (isTimeUp(startTime, CONFIG.MAX_EXECUTION_TIME_MS)) {
      console.warn(`⏳ Research time limit. Suspending...`);
      props.setProperty('PROCESSING_QUEUE', JSON.stringify(processingQueue));
      props.setProperty('COMMITTED_RESULTS', JSON.stringify(resultsToCommit));
      setContinuationTrigger();
      return; // 終了、1分後に再開
    }

    const modelKey = processingQueue[0];
    const modelInfo = mcpData.mcpServers[modelKey];
    console.log(`\n[${processedCount + 1}/${initialQueueLength}] 🔍 Researching: ${modelKey}...`);

    // セッションデータにモデル情報がない場合はスキップ
    if (!modelInfo) {
      console.warn('⚠️ Model info missing from session data. Skipping.');
      processingQueue.shift();
      continue;
    }

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

    // Gemini調査 (カテゴリ情報と既存カテゴリ一覧を渡す)
    const result = researchModelWithGemini(modelKey, modelInfo, rulesContent, geminiKey, geminiModel, categoryInfo, existingCategories);

    if (result) {
      // Gemini結果のバリデーション
      const validation = validateGeminiResult(result, modelKey);
      if (!validation.valid) {
        console.warn(`⚠️ Gemini result validation failed for ${modelKey}:`);
        validation.errors.forEach(err => console.warn(`  - ${err}`));
        console.warn('Skipping this entry to prevent YAML corruption.');
        // 不正な結果は不明扱いとしてMarkdownに記録
        const errorDetail = `### ${modelKey}\n- 自動調査結果がフォーマット不正のためスキップ\n- エラー: ${validation.errors.join(', ')}`;
        resultsToCommit.mdUpdates.push(errorDetail);
      } else if (result.is_found) {
        // 未知の接頭辞の場合、Geminiの推論結果でマスタを更新
        if (isNewPrefix && result.category) {
          const description = result.category_description || `${prefix}から始まるモデルのカテゴリ (自動生成)`;
          addPrefixToCategoryMaster(prefix, result.category, description, categoryMaster, categoryMasterSha, CONFIG, githubToken);
          // SHAを更新するために再取得
          categoryMasterInfo = fetchCategoryMaster(CONFIG, githubToken);
          categoryMaster = categoryMasterInfo.data;
          categoryMasterSha = categoryMasterInfo.sha;
        }
        console.log(`✅ FOUND: ${result.category}`);
        resultsToCommit.yamlUpdates.push({ category: result.category, entry: result.yaml_entry });
      } else {
        console.log(`❓ UNKNOWN - will be added to unknown_release_dates.md`);
        resultsToCommit.mdUpdates.push(result.unknown_reason_markdown);
      }
    } else {
      console.error(`Failed to research ${modelKey}`);
    }

    // キューから削除して進行状況を保存
    processingQueue.shift();
    props.setProperty('PROCESSING_QUEUE', JSON.stringify(processingQueue));
    props.setProperty('COMMITTED_RESULTS', JSON.stringify(resultsToCommit));
    processedCount++;

    // Rate Limit対策 (2秒待機)
    Utilities.sleep(2000);
  }

  // -----------------------------------------------
  // Phase 3: Apply Updates (GitHubへの更新適用)
  // -----------------------------------------------
  console.log("\n========================================");
  console.log("          APPLYING UPDATES              ");
  console.log("========================================");

  // 1) YAMLの更新
  if (resultsToCommit.yamlUpdates.length > 0) {
    try {
      console.log(`Updating YAML (${resultsToCommit.yamlUpdates.length} entries)...`);
      const yamlFile = fetchGithubFile(CONFIG.REPO_OWNER, CONFIG.REPO_NAME, CONFIG.YAML_PATH, githubToken, CONFIG.BRANCH);
      let newContent = yamlFile.content;

      // 複数件ある場合、文字列が変化するので都度検索して挿入
      for (const update of resultsToCommit.yamlUpdates) {
        newContent = insertIntoYaml(newContent, update.category, update.entry, CONFIG.INDENT_SIZE);
      }

      updateGithubFile(CONFIG.REPO_OWNER, CONFIG.REPO_NAME, CONFIG.YAML_PATH, newContent, yamlFile.sha, CONFIG.COMMIT_MSG_YAML, githubToken, CONFIG.BRANCH);
      console.log('YAML updated successfully.');
    } catch (e) {
      console.error(`Failed to update YAML: ${e.message}`);
    }
  }

  // 2) Markdownの更新 (リリース日不明のモデル)
  if (resultsToCommit.mdUpdates.length > 0) {
    try {
      console.log(`Updating Markdown (${resultsToCommit.mdUpdates.length} entries)...`);
      const mdFile = fetchGithubFile(CONFIG.REPO_OWNER, CONFIG.REPO_NAME, CONFIG.UNKNOWN_MD_PATH, githubToken, CONFIG.BRANCH);
      let content = mdFile.content;

      // 追記ブロックの作成
      const today = Utilities.formatDate(new Date(), 'JST', 'yyyy-MM-dd HH:mm');
      const block = `\n## 調査報告 (${today})\n` + resultsToCommit.mdUpdates.join("\n") + "\n---";

      // 挿入位置: 最初のH2見出しの直前（最新を上にする）
      const idx = content.indexOf('\n## ');
      content = idx !== -1 ? content.substring(0, idx) + block + content.substring(idx) : content + block;

      updateGithubFile(CONFIG.REPO_OWNER, CONFIG.REPO_NAME, CONFIG.UNKNOWN_MD_PATH, content, mdFile.sha, CONFIG.COMMIT_MSG_MD, githubToken, CONFIG.BRANCH);
      console.log('Markdown updated successfully.');
    } catch (e) {
      console.error(`Failed to update Markdown: ${e.message}`);
    }
  }

  // --- クリーンアップ ---
  props.deleteProperty('PROCESSING_QUEUE');
  props.deleteProperty('COMMITTED_RESULTS');

  if (sessionDataId) {
    deleteFileFromDrive(sessionDataId);
    props.deleteProperty('SESSION_DATA_FILE_ID');
  }

  deleteContinuationTriggers();
  console.log("✅ All done.");
}

// ==========================================
// 複数ソースJSON マージ機能
// ==========================================

/**
 * 複数のMCP設定ファイルをマージする（後勝ち）
 * リストの先頭から順に読み込み、後方のファイルで前方を上書きする
 * @param {Array<{name: string, id: string}>} fileConfigs - ファイル設定の配列
 * @returns {{mcpServers: Object}} マージされた設定
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
      console.warn(`Failed to load ${config.name} (${config.id}): ${e.message}`);
    }
  }

  const totalCount = Object.keys(mergedServers).length;
  console.log(`✅ Merged total: ${totalCount} servers`);
  return { mcpServers: mergedServers };
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
  const githubToken = props.getProperty('GITHUB_TOKEN');

  if (!githubToken) {
    console.error('GITHUB_TOKEN missing');
    return;
  }

  // カテゴリマスタ取得
  const categoryMasterInfo = fetchCategoryMaster(CONFIG, githubToken);
  const categoryMaster = categoryMasterInfo.data;

  // 既存YAML取得
  let yamlFile;
  try {
    yamlFile = fetchGithubFile(CONFIG.REPO_OWNER, CONFIG.REPO_NAME, CONFIG.YAML_PATH, githubToken, CONFIG.BRANCH);
  } catch (e) {
    console.error(`YAML Error: ${e.message}`);
    return;
  }

  // YAMLをパースして全モデルを抽出
  const allModels = parseYamlModels(yamlFile.content);
  console.log(`Found ${allModels.length} models to recategorize.`);

  // 新しいカテゴリ構造を構築
  const newCategories = {};
  let unknownPrefixes = [];

  for (const model of allModels) {
    const prefix = extractPrefixFromServerName(model.server_name);
    const categoryInfo = getCategoryFromPrefix(prefix, categoryMaster);
    let targetCategory = categoryInfo ? categoryInfo.category_key : (model.original_category || 'miscellaneous');

    if (!categoryInfo) {
      unknownPrefixes.push({ prefix, server_name: model.server_name });
    }

    if (!newCategories[targetCategory]) {
      newCategories[targetCategory] = [];
    }
    newCategories[targetCategory].push(model);
  }

  // カテゴリ順序を定義
  const categoryOrder = [
    'text_to_image', 'image_to_image', 'text_to_video', 'image_to_video', 'video_to_video',
    'reference_to_video', 'frame_to_video', 'speech_to_video', 'audio_to_video', 'text_to_speech',
    'text_to_audio', 'text_to_music', 'video_to_audio', 'video_to_sfx', 'audio_to_text',
    'text_to_visual', 'image_to_3d', 'text_to_3d', '3d_to_3d', 'training', 'utility_and_analysis',
    'voice_clone', 'miscellaneous'
  ];

  // 新しいYAMLを生成
  let newYamlContent = 'ai_models:\n';
  const indent = ' '.repeat(CONFIG.INDENT_SIZE);
  const listIndent = ' '.repeat(CONFIG.INDENT_SIZE * 2);

  const outputCategory = (cat) => {
    if (newCategories[cat] && newCategories[cat].length > 0) {
      newYamlContent += `${indent}${cat}:\n`;
      for (const model of newCategories[cat]) {
        newYamlContent += `${listIndent}- name: ${model.name}\n`;
        newYamlContent += `${listIndent}  server_name: ${model.server_name}\n`;
        newYamlContent += `${listIndent}  release_date: ${model.release_date}\n`;
        newYamlContent += `${listIndent}  features: ${escapeYamlString(model.features)}\n`;
      }
    }
  };

  // 定義順でカテゴリを出力
  categoryOrder.forEach(outputCategory);
  // 定義順にないカテゴリも出力
  Object.keys(newCategories).forEach(cat => {
    if (!categoryOrder.includes(cat)) outputCategory(cat);
  });

  // GitHubに保存
  try {
    updateGithubFile(CONFIG.REPO_OWNER, CONFIG.REPO_NAME, CONFIG.YAML_PATH, newYamlContent, yamlFile.sha, 'refactor(yaml): recategorize models based on server_name prefix', githubToken, CONFIG.BRANCH);
    console.log('YAML updated successfully.');
  } catch (e) {
    console.error(`YAML update error: ${e.message}`);
  }

  // 未知の接頭辞を報告
  if (unknownPrefixes.length > 0) {
    console.warn('=== Unknown Prefixes ===');
    for (const item of unknownPrefixes) {
      console.warn(`  ${item.prefix}: ${item.server_name}`);
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
      if (currentModel) models.push(currentModel);
      currentModel = { name: nameMatch[1], server_name: '', release_date: '', features: '', original_category: currentCategory };
      continue;
    }

    // server_name を検出
    const snMatch = line.match(/^      server_name: (.+)$/);
    if (snMatch && currentModel) currentModel.server_name = snMatch[1];

    // release_date を検出
    const rdMatch = line.match(/^      release_date: (.+)$/);
    if (rdMatch && currentModel) currentModel.release_date = rdMatch[1];

    // features を検出
    const ftMatch = line.match(/^      features: (.+)$/);
    if (ftMatch && currentModel) currentModel.features = ftMatch[1];
  }

  // 最後のモデルを保存
  if (currentModel) models.push(currentModel);
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
// トリガー管理
// ==========================================

/**
 * Resume用の継続トリガーを作成する
 * トリガーのUniqueIdをスクリプトプロパティに保存し、後で特定・削除できるようにする
 */
function setContinuationTrigger() {
  const props = PropertiesService.getScriptProperties();

  // 既存の継続トリガーがあれば削除（クリーンアップ）
  deleteContinuationTriggers();

  // 新規トリガーを作成（1分後に実行）
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
 * YAMLコンテンツからserver_nameの一覧を抽出する
 * @param {string} yamlContent - YAMLコンテンツ
 * @returns {string[]} server_nameの配列
 */
function extractServerNamesFromYaml(yamlContent) {
  const names = [];
  const regex = /server_name:\s*([^\s#]+)/g;
  let match;
  while ((match = regex.exec(yamlContent)) !== null) {
    names.push(match[1]);
  }
  return names;
}

/**
 * カテゴリマスタをGitHubから取得する
 * @param {Object} CONFIG - 設定オブジェクト
 * @param {string} githubToken - GitHubトークン
 * @returns {{data: Object, sha: string|null}} カテゴリマスタデータとSHA
 */
function fetchCategoryMaster(CONFIG, githubToken) {
  try {
    const file = fetchGithubFile(CONFIG.REPO_OWNER, CONFIG.REPO_NAME, CONFIG.CATEGORY_MASTER_PATH, githubToken, CONFIG.BRANCH);
    return { data: JSON.parse(file.content), sha: file.sha };
  } catch (e) {
    console.error(`カテゴリマスタ取得エラー: ${e.message}`);
    // デフォルトの空マスタを返す
    return { data: { prefix_to_category: {} }, sha: null };
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
 * @returns {string} 更新後のYAMLコンテンツ
 */
function insertIntoYaml(yamlContent, category, entry, indentSize) {
  indentSize = indentSize || DEFAULT_CONFIG.INDENT_SIZE;

  // インデント文字列を生成
  const listIndent = ' '.repeat(indentSize * 2);  // リストアイテム用 (4スペース)

  // エントリのインデント処理
  // Geminiにはフラットに出力させるため、ここで階層構造のインデントを付与
  const indentedEntry = entry.trim().split('\n').map(line => listIndent + line).join('\n');

  // カテゴリブロックを探す (例: "  text_to_image:")
  const categoryRegex = new RegExp(`^\\s{0,${indentSize}}${category}:`, 'm');
  const match = categoryRegex.exec(yamlContent);

  if (match) {
    // カテゴリが存在する場合:
    // 次のカテゴリまたはファイル末尾を探し、その直前に挿入
    const startIdx = match.index + match[0].length;
    const nextKeyRegex = new RegExp(`^\\s{0,${indentSize}}[a-z0-9_]+:`, 'm');
    const nextMatch = nextKeyRegex.exec(yamlContent.substring(startIdx));
    const insertPos = nextMatch ? startIdx + nextMatch.index : yamlContent.length;

    return yamlContent.substring(0, insertPos) + indentedEntry + "\n" + yamlContent.substring(insertPos);
  } else {
    // カテゴリが存在しない場合: ファイル末尾に新設
    return yamlContent + `\n${' '.repeat(indentSize)}${category}:\n${indentedEntry}\n`;
  }
}

// ==========================================
// GitHub API
// ==========================================

/**
 * GitHubからファイルを取得する
 * 1MB超のファイルはBlobs APIを使用して取得
 * @param {string} owner - リポジトリオーナー
 * @param {string} repo - リポジトリ名
 * @param {string} path - ファイルパス
 * @param {string} token - GitHubトークン
 * @param {string} branch - ブランチ名
 * @returns {{content: string, sha: string}} ファイル内容とSHA
 */
function fetchGithubFile(owner, repo, path, token, branch) {
  branch = branch || DEFAULT_CONFIG.BRANCH;
  const url = `https://api.github.com/repos/${owner}/${repo}/contents/${path}?ref=${branch}`;
  const options = {
    method: 'get',
    headers: { 'Authorization': `token ${token}`, 'Accept': 'application/vnd.github.v3+json' },
    muteHttpExceptions: true
  };

  const response = UrlFetchApp.fetch(url, options);
  if (response.getResponseCode() !== 200) {
    throw new Error(`GitHub Error: ${response.getContentText()}`);
  }

  const data = JSON.parse(response.getContentText());
  let contentStr = "";

  if (data.content) {
    // 1MB以下の通常ファイル
    contentStr = Utilities.newBlob(Utilities.base64Decode(data.content)).getDataAsString('UTF-8');
  } else if (data.sha) {
    // 1MB超のファイル: Git Blobs APIを使用
    console.log(`Info: File ${path} is large. Fetching via Blobs API.`);
    const blobUrl = `https://api.github.com/repos/${owner}/${repo}/git/blobs/${data.sha}`;
    const blobOptions = {
      method: 'get',
      headers: { 'Authorization': `token ${token}`, 'Accept': 'application/vnd.github.v3.raw' },
      muteHttpExceptions: true
    };
    const blobResponse = UrlFetchApp.fetch(blobUrl, blobOptions);
    if (blobResponse.getResponseCode() !== 200) {
      throw new Error(`Failed to fetch blob: ${blobResponse.getContentText()}`);
    }
    contentStr = blobResponse.getContentText();
  }

  return { content: contentStr, sha: data.sha };
}

/**
 * GitHubのファイルを更新する
 * @param {string} owner - リポジトリオーナー
 * @param {string} repo - リポジトリ名
 * @param {string} path - ファイルパス
 * @param {string} newContent - 新しいファイル内容
 * @param {string} sha - 現在のファイルのSHA
 * @param {string} message - コミットメッセージ
 * @param {string} token - GitHubトークン
 * @param {string} branch - ブランチ名
 */
function updateGithubFile(owner, repo, path, newContent, sha, message, token, branch) {
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

// ==========================================
// Gemini API 連携
// ==========================================

/**
 * Geminiの調査結果を検証する
 * yaml_entryが正しい書式か、categoryがsnake_caseかをチェック
 * @param {Object} result - Geminiの調査結果
 * @param {string} serverName - 期待されるserver_name
 * @returns {{valid: boolean, errors: string[]}} 検証結果
 */
function validateGeminiResult(result, serverName) {
  const errors = [];

  if (!result || typeof result !== 'object') {
    return { valid: false, errors: ['Result is null or not an object'] };
  }

  // is_found が false の場合、yaml_entry の検証はスキップ
  if (!result.is_found) {
    return { valid: true, errors: [] };
  }

  // category の検証: snake_case であること
  if (!result.category || !/^[a-z0-9_]+$/.test(result.category)) {
    errors.push(`Invalid category format: "${result.category}" (must be snake_case)`);
  }

  // yaml_entry の検証
  const entry = result.yaml_entry;
  if (!entry || typeof entry !== 'string') {
    errors.push('yaml_entry is missing or not a string');
  } else {
    const trimmed = entry.trim();

    // "- name: " で始まること
    if (!trimmed.startsWith('- name: ')) {
      errors.push(`yaml_entry must start with "- name: ", got: "${trimmed.substring(0, 30)}..."`);
    }

    // 必須4フィールドが含まれていること
    if (!trimmed.includes('server_name: ')) {
      errors.push('yaml_entry missing "server_name" field');
    }
    if (!trimmed.includes('release_date: ')) {
      errors.push('yaml_entry missing "release_date" field');
    }
    if (!trimmed.includes('features: ')) {
      errors.push('yaml_entry missing "features" field');
    }

    // server_name が正しいこと
    if (trimmed.includes('server_name: ') && !trimmed.includes(`server_name: ${serverName}`)) {
      errors.push(`yaml_entry has wrong server_name (expected: ${serverName})`);
    }
  }

  return { valid: errors.length === 0, errors };
}

/**
 * Gemini APIを使用してモデル情報を調査する
 * @param {string} serverName - server_name
 * @param {Object} modelInfo - モデル情報 (description, url等)
 * @param {string} rulesText - 調査ルールのテキスト
 * @param {string} apiKey - Gemini APIキー
 * @param {string} modelName - 使用するGeminiモデル名
 * @param {Object|null} categoryInfo - カテゴリマスタからの情報 (null の場合はGeminiに推論させる)
 * @param {string[]} existingCategories - 既存のカテゴリキー一覧 (snake_case)
 * @returns {Object|null} 調査結果
 */
function researchModelWithGemini(serverName, modelInfo, rulesText, apiKey, modelName, categoryInfo, existingCategories) {
  const endpoint = `https://generativelanguage.googleapis.com/v1beta/models/${modelName}:generateContent?key=${apiKey}`;

  // カテゴリが事前に決まっているかどうかでプロンプトを変える
  let categoryInstruction;
  if (categoryInfo && categoryInfo.category_key) {
    categoryInstruction = `The category for this model is already determined: "${categoryInfo.category_key}". You MUST use this exact string as the "category" value.`;
  } else {
    categoryInstruction = `The category is unknown. Choose from the existing categories listed below if one fits. Only create a new snake_case category key if none of the existing ones are appropriate.`;
  }

  // 既存カテゴリ一覧を文字列化
  const categoryList = (existingCategories || []).map(c => `  - ${c}`).join('\n');

  const prompt = `You are a research assistant that investigates AI model information and outputs structured YAML data.

## Task
Research the following AI model and return a JSON object with the results.

## Model Information
- server_name: ${serverName}
- description: ${modelInfo.description || 'N/A'}
- url: ${modelInfo.url || 'N/A'}

## Research Rules
${rulesText}

## Category Instructions
${categoryInstruction}

Existing category keys (snake_case, use one of these if applicable):
${categoryList}

IMPORTANT: The "category" field MUST be a snake_case string (e.g. "audio_to_text", "text_to_image"). NEVER use human-readable names like "Audio to Text".

## YAML Entry Format (CRITICAL)
The "yaml_entry" field MUST follow this EXACT template with NO indentation:
\`\`\`
- name: {human-readable model name}
  server_name: ${serverName}
  release_date: {YYYY年M月D日 format (no zero-padding), e.g. 2025年10月15日 or 2025年1月5日, or 2025年10月頃 if day unknown}
  features: "({developer name}) {description of model features in Japanese}"
\`\`\`

Rules for yaml_entry:
- MUST start with "- name: "
- MUST contain exactly 4 fields: name, server_name, release_date, features
- server_name MUST be exactly: ${serverName}
- release_date MUST use Japanese date format: YYYY年M月D日 without zero-padding (e.g. 2026年1月5日, not 2026年01月05日). Use YYYY年M月頃 / YYYY年中頃 if partially unknown
- features MUST be a double-quoted string starting with "({developer name}) " followed by a Japanese description
- Do NOT add any extra fields (publisher, model_name, model_type, url, description, etc.)

## Output JSON Schema
{
  "thought_process": "string - your research reasoning",
  "category": "string - snake_case category key",
  "category_description": "string - Japanese description of category (only needed for new categories)",
  "yaml_entry": "string - YAML entry following the EXACT template above",
  "is_found": "boolean - true if release date was found",
  "unknown_reason_markdown": "string - markdown explanation if is_found is false"
}
`;

  try {
    const response = UrlFetchApp.fetch(endpoint, {
      method: 'post',
      contentType: 'application/json',
      payload: JSON.stringify({
        contents: [{ parts: [{ text: prompt }] }],
        tools: [{ google_search: {} }],
        generationConfig: { responseMimeType: "application/json" }
      }),
      muteHttpExceptions: true
    });

    const json = JSON.parse(response.getContentText());
    if (json.candidates && json.candidates[0] && json.candidates[0].content) {
      return JSON.parse(json.candidates[0].content.parts[0].text);
    }
  } catch (e) {
    console.error(`Gemini API Error: ${e.message}`);
  }

  return null;
}
