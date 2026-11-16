require("dotenv").config();

const express = require("express");
const crypto = require("crypto");
const fs = require("fs");
const path = require("path");
const { spawn } = require("child_process");
const { chromium } = require("playwright");

const app = express();

const PORT = 3030;
const CDP_URL = "http://127.0.0.1:9222";

const CHROME_PATH =
  "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe";

const CHROME_PROFILE = process.env.LOCALAPPDATA
  ? process.env.LOCALAPPDATA + "\\BeautyWorldFlowChrome"
  : "";

const FLOW_URL =
  "https://flow.google.com/project/c73a6cbd-dd2b-40df-8ce2-32c0284c97a6";

const TOKEN = process.env.WORKER_TOKEN;

const NEXT_TASK_URL = process.env.N8N_NEXT_TASK_URL;
const STATUS_URL = process.env.N8N_STATUS_URL;

const UPLOAD_URL =
  process.env.N8N_UPLOAD_URL ||
  "https://nasr-work.duckdns.org/webhook/beautyworld-upload-video";

const OUTPUT_DIR =
  process.env.OUTPUT_DIR ||
  "C:\\BeautyWorld-Playwright\\output";

const REAL_GENERATION_ENABLED =
  process.env.ALLOW_ONE_REAL_GENERATION === "true";

const GENERATION_LOCK_DIR =
  process.env.GENERATION_LOCK_DIR ||
  path.join(
    path.dirname(
      process.env.GENERATION_LOCK_FILE ||
      "C:\\BeautyWorld-Playwright\\one-generation.lock.json"
    ),
    "generation-locks"
  );

const POLLING_ENABLED =
  process.env.WORKER_POLLING_ENABLED === "true";

const DRY_RUN =
  process.env.DRY_RUN !== "false";

const POLL_INTERVAL_MS =
  Number(process.env.POLL_INTERVAL_MS || 10000);

const WORKER_ID = "BeautyWorld-Windows";

// --------------------------------------------------
// Initial validation
// --------------------------------------------------

if (!TOKEN || TOKEN.length < 64) {
  throw new Error("Worker token is missing or invalid.");
}

if (!fs.existsSync(CHROME_PATH)) {
  throw new Error("Google Chrome was not found.");
}

if (!CHROME_PROFILE) {
  throw new Error("Chrome profile path is missing.");
}

if (POLLING_ENABLED && (!NEXT_TASK_URL || !STATUS_URL)) {
  throw new Error("n8n webhook URLs are missing.");
}

app.use(express.json({ limit: "100kb" }));

let browser = null;
let flowPage = null;

let launchInProgress = false;
let lastLaunchAttempt = 0;
let watchdogBusy = false;
let pollBusy = false;

const state = {
  chrome: "Checking",
  flow: "Checking",
  polling: POLLING_ENABLED ? "Enabled" : "Disabled",
  dryRun: DRY_RUN,
  lastCheck: null,
  lastPoll: null,
  lastTask: null,
  lastError: null
};

// --------------------------------------------------
// Logging
// --------------------------------------------------

function log(message) {
  console.log(
    "[" + new Date().toLocaleTimeString() + "] " + message
  );
}

// --------------------------------------------------
// Authentication
// --------------------------------------------------

function authenticate(req, res, next) {
  const header = req.get("authorization") || "";

  const supplied = header.startsWith("Bearer ")
    ? header.slice(7)
    : "";

  const a = Buffer.from(supplied);
  const b = Buffer.from(TOKEN);

  if (
    a.length !== b.length ||
    !crypto.timingSafeEqual(a, b)
  ) {
    return res.status(401).json({
      success: false,
      message: "Unauthorized"
    });
  }

  next();
}

// --------------------------------------------------
// Chrome launch
// --------------------------------------------------

function launchChrome() {
  const now = Date.now();

  if (
    launchInProgress ||
    now - lastLaunchAttempt < 60000
  ) {
    return;
  }

  launchInProgress = true;
  lastLaunchAttempt = now;

  log("Starting Google Chrome...");

  try {
    const child = spawn(
      CHROME_PATH,
      [
        "--remote-debugging-port=9222",
        "--user-data-dir=" + CHROME_PROFILE,
        "--no-first-run",
        "--no-default-browser-check",
        FLOW_URL
      ],
      {
        detached: true,
        stdio: "ignore",
        windowsHide: false
      }
    );

    child.on("error", error => {
      state.lastError = error.message;
      log("Chrome launch error: " + error.message);
    });

    child.unref();

    log("Chrome launch command sent.");

  } catch (error) {
    state.lastError = error.message;
    log("Could not start Chrome: " + error.message);
  }

  setTimeout(() => {
    launchInProgress = false;
  }, 10000);
}

// --------------------------------------------------
// Browser connection
// --------------------------------------------------

async function connectBrowser() {
  if (browser) {
    try {
      const contexts = browser.contexts();

      if (contexts.length > 0) {
        return browser;
      }
    } catch (_) {
      browser = null;
    }
  }

  try {
    browser = await chromium.connectOverCDP(CDP_URL, {
      timeout: 5000
    });

    browser.on("disconnected", () => {
      log("Chrome connection lost.");

      browser = null;
      flowPage = null;

      state.chrome = "Disconnected";
      state.flow = "Unknown";
    });

    log("Connected to Chrome successfully.");

    return browser;

  } catch (_) {
    browser = null;
    state.chrome = "Offline";

    return null;
  }
}

// --------------------------------------------------
// Ensure exact Flow project page
// --------------------------------------------------

async function ensureFlowPage() {
  const connectedBrowser = await connectBrowser();

  if (!connectedBrowser) {
    state.chrome = "Offline";
    state.flow = "Waiting for Chrome";
    launchChrome();
    return;
  }

  state.chrome = "Connected";

  const contexts = connectedBrowser.contexts();

  if (!contexts.length) {
    state.flow = "No browser context";
    return;
  }

  const context = contexts[0];
  const pages = context.pages();

  const projectUrl =
    "https://flow.google.com/project/c73a6cbd-dd2b-40df-8ce2-32c0284c97a6";

  flowPage = pages.find(page =>
    !page.isClosed() &&
    page.url().includes(
      "/project/c73a6cbd-dd2b-40df-8ce2-32c0284c97a6"
    )
  );

  if (!flowPage) {
    log("Opening the exact BeautyWorld Flow project...");

    flowPage = await context.newPage();

    try {
      await flowPage.goto(projectUrl, {
        waitUntil: "domcontentloaded",
        timeout: 60000
      });

      await flowPage.waitForLoadState("networkidle", {
        timeout: 15000
      }).catch(() => {});

      state.flow = "Open";

      log("BeautyWorld project opened.");

    } catch (error) {
      state.flow = "Navigation error";
      state.lastError = error.message;

      log("Project navigation error: " + error.message);
    }

    return;
  }

  state.flow = "Open";

  log("BeautyWorld project tab detected.");
}

// --------------------------------------------------
// Watchdog
// --------------------------------------------------

async function watchdog() {
  if (watchdogBusy) return;

  watchdogBusy = true;

  try {
    state.lastCheck = new Date().toISOString();

    await ensureFlowPage();

  } catch (error) {
    state.lastError = error.message;

    log("Watchdog error: " + error.message);

  } finally {
    watchdogBusy = false;
  }
}

// --------------------------------------------------
// n8n communication
// --------------------------------------------------

async function n8nRequest(url, options = {}) {
  const response = await fetch(url, {
    ...options,
    headers: {
      "Content-Type": "application/json",
      "X-Worker-Token": TOKEN,
      ...(options.headers || {})
    },
    signal: AbortSignal.timeout(20000)
  });

  const responseText = await response.text();

  let data;

  try {
    data = responseText ? JSON.parse(responseText) : {};
  } catch (_) {
    throw new Error(
      "Invalid JSON response from n8n: " +
      responseText.slice(0, 300)
    );
  }

  if (!response.ok) {
    throw new Error(
      "n8n HTTP " + response.status + ": " +
      (data.message || responseText)
    );
  }

  return data;
}

// --------------------------------------------------
// Normalize task payload
// --------------------------------------------------

function normalizePayload(payload) {
  if (typeof payload === "string") {
    try {
      return JSON.parse(payload);
    } catch (_) {
      throw new Error("Task payload is not valid JSON.");
    }
  }

  if (
    !payload ||
    typeof payload !== "object" ||
    Array.isArray(payload)
  ) {
    throw new Error("Task payload is missing or invalid.");
  }

  return payload;
}

// --------------------------------------------------
// Validate Flow requirements
// --------------------------------------------------

function validateFlowRequirements(payload) {
  const problems = [];

  const prompt = payload.flow_prompt;

  if (typeof prompt !== "string" || !prompt.trim()) {
    problems.push("flow_prompt must be a non-empty string");
  }

  const duration = Number(payload.flow_duration);

  if (!Number.isFinite(duration) || duration !== 8) {
    problems.push("flow_duration must be exactly 8 seconds");
  }

  const resolution = String(
    payload.flow_resolution || ""
  ).trim().toLowerCase();

  if (resolution !== "720p") {
    problems.push("flow_resolution must be 720p");
  }

  const aspectRatio = String(
    payload.flow_aspect_ratio || ""
  ).trim();

  if (aspectRatio !== "9:16") {
    problems.push("flow_aspect_ratio must be 9:16");
  }

  const outputs = Number(payload.flow_outputs);

  if (!Number.isFinite(outputs) || outputs !== 1) {
    problems.push("flow_outputs must be exactly 1");
  }

  const model = String(
    payload.flow_model || ""
  ).toLowerCase();

  if (!model.includes("veo 3.1") || !model.includes("lite")) {
    problems.push("flow_model must identify Veo 3.1 Lite");
  }

  if (problems.length) {
    throw new Error(
      "Invalid Flow task specification: " +
      problems.join("; ")
    );
  }

  return {
    promptLength: prompt.trim().length,
    duration: 8,
    resolution: "720p",
    aspectRatio: "9:16",
    outputs: 1,
    model: String(payload.flow_model).trim()
  };
}

// --------------------------------------------------
// One lock per task
// --------------------------------------------------

function reserveTaskGeneration(taskId) {
  const safeTask = String(taskId).replace(
    /[^a-zA-Z0-9_-]/g,
    "_"
  );

  if (!safeTask) {
    throw new Error("Task ID cannot be used for a generation lock.");
  }

  fs.mkdirSync(GENERATION_LOCK_DIR, {
    recursive: true
  });

  const lockPath = path.join(
    GENERATION_LOCK_DIR,
    safeTask + ".json"
  );

  const lockData = {
    task_id: taskId,
    state: "reserved_before_generate",
    reserved_at: new Date().toISOString()
  };

  try {
    const fd = fs.openSync(lockPath, "wx");

    try {
      fs.writeFileSync(
        fd,
        JSON.stringify(lockData, null, 2)
      );
    } finally {
      fs.closeSync(fd);
    }

  } catch (error) {
    if (error && error.code === "EEXIST") {
      throw new Error(
        "A generation lock already exists for task " +
        taskId +
        "; refusing to generate it again."
      );
    }

    throw error;
  }

  return lockPath;
}

// --------------------------------------------------
// Upload video to n8n
// --------------------------------------------------

async function uploadVideoToN8n(taskId, filePath) {
  const stat = fs.statSync(filePath);

  if (!stat.isFile() || stat.size < 1024) {
    throw new Error("MP4 file is missing or too small.");
  }

  const form = new FormData();

  form.append("task_id", taskId);
  form.append("worker_id", WORKER_ID);
  form.append("output_path", filePath);

  form.append(
    "video",
    new Blob(
      [fs.readFileSync(filePath)],
      { type: "video/mp4" }
    ),
    path.basename(filePath)
  );

  const response = await fetch(UPLOAD_URL, {
    method: "POST",
    headers: {
      "X-Worker-Token": TOKEN
    },
    body: form,
    signal: AbortSignal.timeout(180000)
  });

  const raw = await response.text();

  let data;

  try {
    data = raw ? JSON.parse(raw) : {};
  } catch (_) {
    throw new Error(
      "Upload webhook returned non-JSON: " +
      raw.slice(0, 300)
    );
  }

  if (
    !response.ok ||
    data.success !== true ||
    data.status !== "completed"
  ) {
    throw new Error(
      "Telegram delivery was not confirmed by n8n (HTTP " +
      response.status +
      "): " +
      raw.slice(0, 500)
    );
  }

  return data;
}

// --------------------------------------------------
// Generate, download and deliver
// --------------------------------------------------

async function generateDownloadAndDeliver(taskId, payload) {
  if (!REAL_GENERATION_ENABLED) {
    throw new Error(
      "Paid generation gate is OFF. " +
      "Set ALLOW_ONE_REAL_GENERATION=true only after explicit approval."
    );
  }

  if (!flowPage || flowPage.isClosed()) {
    throw new Error("Google Flow page is unavailable.");
  }

  if (!UPLOAD_URL || !STATUS_URL) {
    throw new Error("n8n upload/status URLs are not configured.");
  }

  fs.mkdirSync(OUTPUT_DIR, {
    recursive: true
  });

  // Prompt editor selectors
  const promptSelectors = [
    'flow-rich-text-editor.prompt-input .prosemirror-editor [role="textbox"][contenteditable="true"][aria-label="ما الذي أردت إنشاءه؟"]',
    'flow-rich-text-editor.prompt-input .prosemirror-editor [role="textbox"][contenteditable="true"]',
    'flow-rich-text-editor.prompt-input [contenteditable="true"].ProseMirror'
  ];

  let promptBox = null;

  for (const selector of promptSelectors) {
    const candidate = flowPage.locator(selector).first();

    try {
      await candidate.waitFor({
        state: "visible",
        timeout: 7000
      });

      promptBox = candidate;
      break;

    } catch (_) {
      // Try the next compatible selector.
    }
  }

  if (!promptBox) {
    let diagnostic = {};

    try {
      diagnostic.url = flowPage.url();
      diagnostic.title = await flowPage.title();
      diagnostic.editorCounts = {};

      for (const selector of promptSelectors) {
        diagnostic.editorCounts[selector] =
          await flowPage.locator(selector).count();
      }

      diagnostic.promptEditorHtml = await flowPage
        .locator("flow-rich-text-editor.prompt-input")
        .first()
        .evaluate(el => el.outerHTML.slice(0, 1800))
        .catch(() => "flow-rich-text-editor.prompt-input not found");

    } catch (diagnosticError) {
      diagnostic.diagnosticError = diagnosticError.message;
    }

    throw new Error(
      "Google Flow prompt editor was not visible. " +
      JSON.stringify(diagnostic)
    );
  }

  await promptBox.fill(
    String(payload.flow_prompt).trim()
  );

  // --------------------------------------------------
  // Safe Flow settings inspection
  // --------------------------------------------------

  const settingsLauncher = flowPage.locator(
    'button.settings-trigger-button[aria-label="مشغِّل الإعدادات"]'
  );

  if (await settingsLauncher.count() !== 1) {
    throw new Error(
      "Could not uniquely identify Flow settings. Stopped before Generate."
    );
  }

  await settingsLauncher.waitFor({
    state: "visible",
    timeout: 15000
  });

  const settingsPane = flowPage.locator(
    ".settings-content"
  );

  // Open settings only if currently closed.
  if (!(await settingsPane.isVisible())) {
    log("Opening Flow settings...");

    await settingsLauncher.click();

    await settingsPane.waitFor({
      state: "visible",
      timeout: 15000
    });
  } else {
    log("Flow settings are already open; inspecting without clicking the launcher.");
  }

  // Verify selected model.
  const modelButton = flowPage.locator(
    'button[aria-label="اختيار فئة النماذج"]'
  );

  await modelButton.waitFor({
    state: "visible",
    timeout: 15000
  });

  // Read model name without the dropdown icon text.
const selectedModel = await modelButton
  .locator(".model-select-trigger-content")
  .evaluate(element => {
    const clone = element.cloneNode(true);

    // Remove icon elements from the copied DOM.
    clone.querySelectorAll(
      "mat-icon, .material-icons, .material-symbols-outlined"
    ).forEach(icon => icon.remove());

    return clone.textContent
      .replace(/\s+/g, " ")
      .trim();
  });

log("Selected Flow model: " + selectedModel);

if (selectedModel.toLowerCase() !== "veo 3.1 - lite") {
  throw new Error(
    "Wrong Flow model selected: " + selectedModel
  );
}

  // Verify aspect ratio and output count.
  const settingsText = (
    await settingsPane.innerText()
  ).toLowerCase();

  if (!settingsText.includes("9:16")) {
    throw new Error("9:16 aspect ratio is not selected.");
  }

  if (!settingsText.includes("x1")) {
    throw new Error("Single output x1 is not confirmed.");
  }

  // Close settings safely.
  await flowPage.keyboard.press("Escape");

  await settingsPane.waitFor({
    state: "hidden",
    timeout: 10000
  });

  // Verify settings summary.
  const settingsSummary = flowPage.locator(
    "button.settings-trigger-button span.settings-summary"
  );

  await settingsSummary.waitFor({
    state: "visible",
    timeout: 10000
  });

  const launcherText = (
    await settingsSummary.innerText()
  ).replace(/\s+/g, " ").trim().toLowerCase();

  log("Current Flow settings: " + launcherText);

  if (!launcherText.includes("720p")) {
    throw new Error(
      "Flow resolution is not 720p. Current: " + launcherText
    );
  }

  if (!/(8\s*ث|8\s*s)/i.test(launcherText)) {
    throw new Error(
      "Flow duration is not 8 seconds. Current: " + launcherText
    );
  }

  if (!launcherText.includes("x1")) {
    throw new Error(
      "Flow output count is not x1. Current: " + launcherText
    );
  }

  if (!launcherText.includes("فيديو")) {
    throw new Error(
      "Flow is not in video mode. Current: " + launcherText
    );
  }

  log("All Flow settings verified successfully.");

  // --------------------------------------------------
  // Generate video
  // --------------------------------------------------

  const generateButton = flowPage.getByRole(
    "button",
    {
      name: "بدء الإنشاء"
    }
  );

  if (
    await generateButton.count() !== 1 ||
    !(await generateButton.isEnabled())
  ) {
    throw new Error(
      "Generate button is missing, ambiguous or disabled."
    );
  }

  // Reserve a unique lock before the paid Generate click.
  const taskLockPath = reserveTaskGeneration(taskId);

  log(
    "Preflight passed. Issuing one Generate click for " +
    taskId
  );

  // Exactly one Generate click.
  await generateButton.click();

  log(
    "Generate clicked once for " + taskId +
    ". Waiting for video..."
  );

  // Wait for generated video.
  await flowPage.locator("video").first().waitFor({
    state: "attached",
    timeout: 300000
  });

  await flowPage.waitForTimeout(5000);

  // --------------------------------------------------
  // Download video
  // --------------------------------------------------

   // --------------------------------------------------
  // Download video - Google Flow submenu
  // --------------------------------------------------

  log("Looking for Flow download menu...");

  // زر القائمة الذي يحتوي على كلمة تنزيل
  const downloadMenuButton = flowPage.locator(
    'button[role="menuitem"]'
  ).filter({
    has: flowPage.locator(
      ".item-text .label",
      { hasText: /^تنزيل$/ }
    )
  });

  const downloadMenuCount = await downloadMenuButton.count();

  if (downloadMenuCount !== 1) {
    throw new Error(
      "Could not uniquely identify the Flow download menu. Found: " +
      downloadMenuCount
    );
  }

  await downloadMenuButton.waitFor({
    state: "visible",
    timeout: 15000
  });

  // افتح القائمة الفرعية
  await downloadMenuButton.click();

  log("Download submenu opened.");

  // انتظر خيارات التنزيل
  const downloadOption = flowPage.locator(
    '[role="menu"] [role="menuitem"]'
  ).filter({
    hasText: /تنزيل|download/i
  });

  await downloadOption.first().waitFor({
    state: "visible",
    timeout: 15000
  });

  const downloadOptionCount = await downloadOption.count();

  log("Download options found: " + downloadOptionCount);

  if (downloadOptionCount < 1) {
    throw new Error(
      "No download option appeared in the submenu."
    );
  }

  // انتظر حدث التنزيل قبل الضغط
  const downloadPromise = flowPage.waitForEvent(
    "download",
    {
      timeout: 90000
    }
  );

  await downloadOption.first().click();

  log("Selected download option. Waiting for MP4...");

  const download = await downloadPromise;

  const suggested =
    download.suggestedFilename() ||
    (taskId + ".mp4");

  if (!suggested.toLowerCase().endsWith(".mp4")) {
    throw new Error(
      "Downloaded asset is not MP4: " + suggested
    );
  }

  const safeTask = taskId.replace(
    /[^a-zA-Z0-9_-]/g,
    "_"
  );

  const target = path.join(
    OUTPUT_DIR,
    safeTask + "_" + path.basename(suggested)
  );

  await download.saveAs(target);

  const downloaded = fs.statSync(target);

  if (downloaded.size < 1024) {
    throw new Error(
      "Downloaded MP4 is empty or too small."
    );
  }

  log(
    "Verified MP4 saved: " +
    target +
    " (" +
    downloaded.size +
    " bytes)"
  );

  // --------------------------------------------------
  // Upload to n8n and Telegram
  // --------------------------------------------------

  const delivery = await uploadVideoToN8n(
    taskId,
    target
  );

  const lock = JSON.parse(
    fs.readFileSync(taskLockPath, "utf8")
  );

  lock.state = "telegram_delivered";
  lock.output_path = target;
  lock.delivered_at = new Date().toISOString();

  fs.writeFileSync(
    taskLockPath,
    JSON.stringify(lock, null, 2)
  );

  log(
    "n8n confirmed Telegram delivery for " +
    taskId
  );

  return {
    outputPath: target,
    delivery
  };
}

// --------------------------------------------------
// Report task status
// --------------------------------------------------

async function sendTaskResult(
  taskId,
  status,
  outputPath = "",
  errorMessage = ""
) {
  const result = await n8nRequest(
    STATUS_URL,
    {
      method: "POST",
      body: JSON.stringify({
        task_id: taskId,
        status,
        worker_id: WORKER_ID,
        output_path: outputPath,
        error: errorMessage,
        message: errorMessage
      })
    }
  );

  log(
    "Task result sent: " +
    taskId +
    " => " +
    status
  );

  return result;
}

// --------------------------------------------------
// Task processing
// --------------------------------------------------

async function processTask(task) {
  const taskId = String(task.task_id || "").trim();

  if (!taskId) {
    throw new Error("Task ID is missing.");
  }

  state.lastTask = taskId;

  log("Received task: " + taskId);

  try {
    const payload = normalizePayload(task.payload);
    const flowSpec = validateFlowRequirements(payload);

    log(
      "Task payload validated: " +
      JSON.stringify({
        duration: flowSpec.duration,
        resolution: flowSpec.resolution,
        aspectRatio: flowSpec.aspectRatio,
        outputs: flowSpec.outputs,
        model: flowSpec.model,
        promptLength: flowSpec.promptLength
      })
    );

    if (DRY_RUN) {
      log(
        "DRY RUN: Flow specification is valid. " +
        "No video generation or credit usage occurred."
      );

      await sendTaskResult(
        taskId,
        "validated",
        "",
        "DRY_RUN_VALIDATED_ONLY: Flow specification validated. No video was generated or downloaded."
      );

      return;
    }

    const delivered = await generateDownloadAndDeliver(
      taskId,
      payload
    );

    log(
      "Delivered video: " +
      delivered.outputPath
    );

    return;

  } catch (error) {
    log(
      "Task error: " +
      error.message
    );

    try {
      await sendTaskResult(
        taskId,
        "failed",
        "",
        error.message
      );

    } catch (reportError) {
      log(
        "Could not report task failure: " +
        reportError.message
      );
    }
  }
}

// --------------------------------------------------
// Queue polling
// --------------------------------------------------

async function pollQueue() {
  if (!POLLING_ENABLED || pollBusy) {
    return;
  }

  pollBusy = true;
  state.lastPoll = new Date().toISOString();

  try {
    const result = await n8nRequest(
      NEXT_TASK_URL,
      {
        method: "GET"
      }
    );

    if (!result.available) {
      return;
    }

    if (!result.task_id) {
      throw new Error(
        "n8n returned a task without task_id."
      );
    }

    log(
      "A queued task was found: " +
      result.task_id
    );

    await processTask(result);

  } catch (error) {
    state.lastError = error.message;

    log(
      "Queue polling error: " +
      error.message
    );

  } finally {
    pollBusy = false;
  }
}

// --------------------------------------------------
// Local API
// --------------------------------------------------

app.get("/health", (req, res) => {
  res.json({
    status: "OK",
    service: "BeautyWorld Playwright Worker",
    worker: WORKER_ID,
    chrome: state.chrome,
    flow: state.flow,
    polling: state.polling,
    dryRun: state.dryRun,
    lastCheck: state.lastCheck,
    lastPoll: state.lastPoll,
    lastTask: state.lastTask,
    lastError: state.lastError
  });
});

app.post("/test", authenticate, (req, res) => {
  res.json({
    success: true,
    message: "Task received securely",
    received: req.body,
    worker: WORKER_ID
  });
});

// --------------------------------------------------
// Start server
// --------------------------------------------------

app.listen(PORT, "127.0.0.1", () => {
  log("BeautyWorld Worker Started");

  log(
    "Local URL: http://127.0.0.1:" +
    PORT
  );

  log("Authentication: ENABLED");
  log("Browser Watchdog: ENABLED");

  log(
    "n8n Polling: " +
    (POLLING_ENABLED ? "ENABLED" : "DISABLED")
  );

  log(
    "Dry Run: " +
    (DRY_RUN ? "ENABLED" : "DISABLED")
  );

  log(
    "Paid generation: " +
    (
      REAL_GENERATION_ENABLED && !DRY_RUN
        ? "ARMED (per-task lock enabled)"
        : "DISABLED"
    )
  );

  watchdog();

  setInterval(
    watchdog,
    15000
  );

  if (POLLING_ENABLED) {
    pollQueue();

    setInterval(
      pollQueue,
      POLL_INTERVAL_MS
    );
  }
});