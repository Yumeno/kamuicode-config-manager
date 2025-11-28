/**
 * kamuicode Config Manager Auto Updater (Production Mode)
 * * 概要:
 * 1. mcp-kamui-code.json を Google Drive から取得
 * 2. 未処理のモデルキューをチェック (なければ新規作成)
 * 3. Gemini + Google Search で詳細調査
 * 4. 結果判定と更新データの作成:
 * - 判明時: YAMLのカテゴリブロック末尾へ挿入
 * - 不明時: Markdownの先頭(履歴の上)へ追記
 * 5. GitHubへコミット＆プッシュ
 * 6. タイムアウト回避 (Resume機能)
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

  // 実行制限設定 (ミリ秒) - 4分半で切り上げ
  MAX_EXECUTION_TIME_MS: 4.5 * 60 * 1000,

  // コミットメッセージ
  // Issue #2 に関連付けるため (Refs #2) を追加
  COMMIT_MSG_YAML: 'chore(yaml): update model memo via Gemini Auto-Research (Refs #2)',
  COMMIT_MSG_MD: 'docs: update unknown release dates via Gemini Auto-Research (Refs #2)',

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

  return {
    // GitHub設定
    REPO_OWNER: props.getProperty('REPO_OWNER') || DEFAULT_CONFIG.REPO_OWNER,
    REPO_NAME: props.getProperty('REPO_NAME') || DEFAULT_CONFIG.REPO_NAME,
    BRANCH: props.getProperty('BRANCH') || DEFAULT_CONFIG.BRANCH,

    // ファイルパス (スクリプトプロパティキー: PATH_YAML, PATH_RULES, PATH_UNKNOWN_MD)
    YAML_PATH: props.getProperty('PATH_YAML') || DEFAULT_CONFIG.YAML_PATH,
    RULES_PATH: props.getProperty('PATH_RULES') || DEFAULT_CONFIG.RULES_PATH,
    UNKNOWN_MD_PATH: props.getProperty('PATH_UNKNOWN_MD') || DEFAULT_CONFIG.UNKNOWN_MD_PATH,

    // 実行制限設定
    MAX_EXECUTION_TIME_MS: DEFAULT_CONFIG.MAX_EXECUTION_TIME_MS,

    // コミットメッセージ
    COMMIT_MSG_YAML: DEFAULT_CONFIG.COMMIT_MSG_YAML,
    COMMIT_MSG_MD: DEFAULT_CONFIG.COMMIT_MSG_MD,

    // YAMLインデント設定
    INDENT_SIZE: parseInt(props.getProperty('INDENT_SIZE') || DEFAULT_CONFIG.INDENT_SIZE, 10)
  };
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
  const driveFileId = props.getProperty('DRIVE_JSON_FILE_ID');
  const geminiModel = props.getProperty('GEMINI_MODEL_NAME'); // 例: gemini-1.5-pro

  if (!geminiKey || !githubToken || !driveFileId || !geminiModel) {
    console.error('設定不足: スクリプトプロパティ(GEMINI_API_KEY, GITHUB_TOKEN, DRIVE_JSON_FILE_ID, GEMINI_MODEL_NAME)を確認してください。');
    return;
  }

  // --- 1. キュー管理 (Resume機能) ---
  let processingQueue = JSON.parse(props.getProperty('PROCESSING_QUEUE') || '[]');
  let isResuming = processingQueue.length > 0;

  // JSON取得 (Drive)
  console.log('Fetching mcp-kamui-code.json from Google Drive...');
  let jsonContent;
  try {
    const file = DriveApp.getFileById(driveFileId);
    jsonContent = file.getBlob().getDataAsString();
  } catch (e) {
    console.error(`Drive取得エラー: ${e.message}`);
    return;
  }
  const mcpData = JSON.parse(jsonContent);

  // 新規セッション開始時の差分チェック
  if (!isResuming) {
    console.log('Starting new analysis session...');
    
    // 現在のYAMLを取得して比較
    let currentYamlFile;
    try {
      currentYamlFile = fetchGithubFile(CONFIG.REPO_OWNER, CONFIG.REPO_NAME, CONFIG.YAML_PATH, githubToken);
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
    const rulesFile = fetchGithubFile(CONFIG.REPO_OWNER, CONFIG.REPO_NAME, CONFIG.RULES_PATH, githubToken);
    rulesContent = rulesFile.content;
  } catch (e) { console.warn(`ルールファイル取得失敗: ${e.message}`); }

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
    
    // Gemini調査
    const result = researchModelWithGemini(modelKey, modelInfo, rulesContent, geminiKey, geminiModel);
    
    if (result) {
      console.log(`Thought: ${result.thought_process.substring(0, 100)}...`);

      if (result.is_found) {
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
      const yamlFile = fetchGithubFile(CONFIG.REPO_OWNER, CONFIG.REPO_NAME, CONFIG.YAML_PATH, githubToken);
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
      const mdFile = fetchGithubFile(CONFIG.REPO_OWNER, CONFIG.REPO_NAME, CONFIG.UNKNOWN_MD_PATH, githubToken);
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
function researchModelWithGemini(serverName, modelInfo, rulesText, apiKey, modelName) {
  const endpoint = `https://generativelanguage.googleapis.com/v1beta/models/${modelName}:generateContent?key=${apiKey}`;

  const prompt = `
  あなたは厳格かつ柔軟なAIリサーチャーです。
  Web検索を行い、AIモデルの正確な情報をYAML形式で出力してください。

  【調査対象】
  - server_name: ${serverName}
  - description: ${modelInfo.description || 'N/A'}
  - url: ${modelInfo.url || 'N/A'}

  【調査ルール】
  ${rulesText}

  【★重要: カテゴリ分類】
  descriptionの内容から、このモデルが属するカテゴリ(key)を正確に特定してください。
  既存カテゴリ: text_to_image, image_to_image, text_to_video, image_to_video, video_to_video, text_to_speech, audio_to_text, etc.
  新しいカテゴリが必要な場合は適切な英語のキー(snake_case)を作成してください。

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
  const existingTriggerId = props.getProperty('CONTINUATION_TRIGGER_ID');

  // 既に継続トリガーが登録されている場合はスキップ
  if (existingTriggerId) {
    const triggers = ScriptApp.getProjectTriggers();
    for (const trigger of triggers) {
      if (trigger.getUniqueId() === existingTriggerId) {
        console.log('Continuation trigger already exists.');
        return;
      }
    }
    // IDは保存されているがトリガーが見つからない場合はクリア
    props.deleteProperty('CONTINUATION_TRIGGER_ID');
  }

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

function fetchGithubFile(owner, repo, path, token) {
  const url = `https://api.github.com/repos/${owner}/${repo}/contents/${path}`;
  const options = {
    method: 'get',
    headers: { 'Authorization': `token ${token}`, 'Accept': 'application/vnd.github.v3+json' },
    muteHttpExceptions: true
  };
  const response = UrlFetchApp.fetch(url, options);
  if (response.getResponseCode() !== 200) throw new Error(`GitHub Error: ${response.getContentText()}`);
  const data = JSON.parse(response.getContentText());
  return { content: Utilities.newBlob(Utilities.base64Decode(data.content)).getDataAsString('UTF-8'), sha: data.sha };
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