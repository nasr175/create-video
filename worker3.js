
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

const FLOW_URL = "https://labs.google/fx/tools/flow";

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

// Google Flow can show a video card while rendering is still in progress.
// Do not attempt download until the generated video and its own Download
// control are both ready. Defaults: wait up to 15 minutes, inspect every 3s.
const VIDEO_COMPLETION_TIMEOUT_MS =
  Number(process.env.VIDEO_COMPLETION_TIMEOUT_MS || 15 * 60 * 1000);

const VIDEO_COMPLETION_POLL_MS =
  Number(process.env.VIDEO_COMPLETION_POLL_MS || 3000);

const WORKER_ID = "BeautyWorld-Windows";

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

function log(message) {
  console.log(
    "[" + new Date().toLocaleTimeString() + "] " + message
  );
}

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

  // Prefer the actual Flow project tab that contains the prompt editor.
  // A stale Flow tab can exist beside the current project tab.
  flowPage = null;

  const flowCandidates = pages.filter(page => {
    const url = page.url();
    return (
      url.includes("flow.google.com") ||
      url.includes("labs.google/fx/tools/flow")
    );
  });

  for (const candidate of flowCandidates) {
    if (candidate.isClosed()) continue;
    try {
      const editor = candidate.locator(
        'flow-rich-text-editor.prompt-input .prosemirror-editor [role="textbox"][contenteditable="true"]'
      ).first();
      if (await editor.count()) {
        flowPage = candidate;
        break;
      }
    } catch (_) {
      // Ignore a tab that is navigating or not ready yet.
    }
  }

  if (!flowPage) {
    flowPage =
      flowCandidates.find(page =>
        !page.isClosed() && /flow\.google\.com\/project\//i.test(page.url())
      ) ||
      flowCandidates.find(page => !page.isClosed()) ||
      null;
  }

  if (flowPage && !flowPage.isClosed()) {
    state.flow = "Open";
    return;
  }

  log("Google Flow page is missing. Opening it...");

  flowPage = await context.newPage();

  try {
    await flowPage.goto(FLOW_URL, {
      waitUntil: "domcontentloaded",
      timeout: 60000
    });

    state.flow = "Open";

    log("Google Flow opened successfully.");

  } catch (error) {
    state.flow = "Navigation error";
    state.lastError = error.message;

    log("Flow navigation error: " + error.message);
  }
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
// Wait for a completed Google Flow video and its own Download button
// --------------------------------------------------

async function inspectGeneratedVideoCandidates() {
  return await flowPage.evaluate(() => {
    const isVisible = el => {
      if (!el) return false;
      const style = window.getComputedStyle(el);
      const rect = el.getBoundingClientRect();
      return style.visibility !== "hidden" &&
        style.display !== "none" &&
        Number(style.opacity || 1) > 0 &&
        rect.width > 0 &&
        rect.height > 0;
    };

    const isDownloadControl = el => {
      const label = [
        el.innerText,
        el.getAttribute("aria-label"),
        el.getAttribute("title"),
        el.getAttribute("data-tooltip")
      ].filter(Boolean).join(" ").toLowerCase();
      return /(download|تنزيل|تحميل)/i.test(label);
    };

    const videos = Array.from(document.querySelectorAll("video"));
    return videos.map((video, videoIndex) => {
      let ancestor = video.parentElement;
      let ancestorLevel = 1;
      let chosen = null;

      // Find the nearest container that holds this video and exactly one
      // visible Download control. This avoids counting controls belonging
      // to other generated videos elsewhere on the page.
      while (ancestor && ancestorLevel <= 14) {
        const controls = Array.from(
          ancestor.querySelectorAll("button,[role='button']")
        ).filter(el => isVisible(el) && isDownloadControl(el));

        if (controls.length === 1) {
          chosen = {
            ancestorLevel,
            downloadControls: controls.length,
            downloadLabel: [
              controls[0].innerText,
              controls[0].getAttribute("aria-label"),
              controls[0].getAttribute("title")
            ].filter(Boolean).join(" ").trim()
          };
          break;
        }

        ancestor = ancestor.parentElement;
        ancestorLevel += 1;
      }

      // Read visible progress indicators near the video. Flow's UI has used
      // both native progress elements and aria-valuenow; also inspect nearby
      // text for percentage labels such as "24%".
      let card = video.parentElement;
      for (let i = 0; card && i < 6; i++, card = card.parentElement) {
        const progressNodes = Array.from(
          card.querySelectorAll(
            "[role='progressbar'],progress,[aria-valuenow]"
          )
        ).filter(isVisible);

        const values = progressNodes.map(el => {
          const raw = el.getAttribute("aria-valuenow") ??
            (el.tagName.toLowerCase() === "progress" ? el.value : null);
          const value = Number(raw);
          return Number.isFinite(value) ? value : null;
        }).filter(v => v !== null);

        if (values.length) {
          var progressValues = values;
          break;
        }
      }

      let nearbyText = "";
      try {
        nearbyText = (video.parentElement?.parentElement?.innerText || "")
          .slice(0, 1200);
      } catch (_) {}

      const percentMatches = nearbyText.match(/\b(\d{1,3})\s*%/g) || [];
      const percentages = percentMatches
        .map(s => Number(s.replace("%", "").trim()))
        .filter(n => n >= 0 && n <= 100);

      const readyState = Number(video.readyState || 0);
      const duration = Number(video.duration);
      const hasPlayableMedia =
        readyState >= 2 &&
        Number.isFinite(duration) &&
        duration > 0 &&
        Boolean(video.currentSrc || video.src);

      const progress = Array.isArray(progressValues)
        ? progressValues
        : [];

      const hasExplicitIncompleteProgress =
        progress.some(v => v < 100) ||
        percentages.some(v => v < 100);

      const hasExplicitCompleteProgress =
        progress.some(v => v >= 100) ||
        percentages.some(v => v >= 100);

      return {
        videoIndex,
        ancestorLevel: chosen?.ancestorLevel ?? null,
        downloadControls: chosen?.downloadControls ?? 0,
        downloadLabel: chosen?.downloadLabel ?? "",
        readyState,
        duration: Number.isFinite(duration) ? duration : null,
        hasPlayableMedia,
        progressValues: progress,
        percentages,
        hasExplicitIncompleteProgress,
        hasExplicitCompleteProgress,
        currentSrcPresent: Boolean(video.currentSrc || video.src)
      };
    });
  });
}

async function snapshotFlowVideos() {
  if (!flowPage || flowPage.isClosed()) return [];
  return await flowPage.locator("video").evaluateAll(nodes =>
    nodes.map((video, index) => ({
      index,
      src: String(video.currentSrc || video.src || ""),
      duration: Number.isFinite(video.duration) ? video.duration : null
    }))
  );
}

async function waitForNewCompletedVideo(taskId, baselineVideos) {
  const deadline = Date.now() + VIDEO_COMPLETION_TIMEOUT_MS;
  const baselineSources = new Set(
    baselineVideos.map(v => v.src).filter(Boolean)
  );
  const baselineCount = baselineVideos.length;
  let lastLogAt = 0;
  let lastState = [];

  log(
    "Waiting for the new Google Flow result for " + taskId +
    " (timeout " + Math.round(VIDEO_COMPLETION_TIMEOUT_MS / 60000) + " minutes)."
  );

  while (Date.now() < deadline) {
    if (!flowPage || flowPage.isClosed()) {
      throw new Error("Google Flow tab closed while waiting for video completion.");
    }

    const videos = await snapshotFlowVideos().catch(() => []);
    const candidates = await inspectGeneratedVideoCandidates().catch(() => []);
    const current = videos.map(v => {
      const state = candidates.find(c => c.videoIndex === v.index) || {};
      return { ...v, ...state };
    });
    lastState = current;

    // Prefer a source that did not exist before this task. This prevents
    // accidentally downloading an older gallery item.
    const newSourceVideos = current.filter(v =>
      v.src &&
      !baselineSources.has(v.src) &&
      v.hasPlayableMedia &&
      !v.hasExplicitIncompleteProgress
    );

    // If Flow reuses the same media URL, only allow a new video element added
    // after the Generate click; do not fall back to an arbitrary old video.
    const newElementVideos = current.filter(v =>
      v.index >= baselineCount &&
      v.src &&
      v.hasPlayableMedia &&
      !v.hasExplicitIncompleteProgress
    );

    const ready = newSourceVideos.length ? newSourceVideos : newElementVideos;

    if (ready.length) {
      const chosen = ready[ready.length - 1];
      const video = flowPage.locator("video").nth(chosen.index);

      // Identify the portrait media tile surrounding this exact video.
      const cardInfo = await video.evaluate(el => {
        let node = el;
        let level = 0;
        while (node && level < 14) {
          const r = node.getBoundingClientRect();
          const buttons = node.querySelectorAll("button,[role='button']");
          const ratio = r.height ? r.width / r.height : 0;
          if (
            level >= 1 &&
            r.width >= 90 && r.width <= 650 &&
            r.height >= 120 && r.height <= 750 &&
            ratio >= 0.35 && ratio <= 1.25 &&
            buttons.length >= 1
          ) {
            return {
              ancestorLevel: level,
              width: Math.round(r.width),
              height: Math.round(r.height),
              buttons: buttons.length
            };
          }
          node = node.parentElement;
          level++;
        }
        return null;
      }).catch(() => null);

      if (cardInfo) {
        const card = video.locator(
          "xpath=ancestor::*[" + cardInfo.ancestorLevel + "]"
        );
        log(
          "New completed video identified for " + taskId +
          ": index=" + chosen.index +
          ", duration=" + chosen.duration +
          "s, card=" + JSON.stringify(cardInfo)
        );
        return { video, card, candidate: chosen, cardInfo };
      }
    }

    if (Date.now() - lastLogAt >= 15000) {
      log(
        "Waiting for new video completion for " + taskId + ": " +
        JSON.stringify(current.map(v => ({
          index: v.index,
          duration: v.duration,
          readyState: v.readyState,
          hasSource: Boolean(v.src),
          newSource: Boolean(v.src && !baselineSources.has(v.src)),
          newElement: v.index >= baselineCount,
          incompleteProgress: v.hasExplicitIncompleteProgress
        })))
      );
      lastLogAt = Date.now();
    }

    await flowPage.waitForTimeout(VIDEO_COMPLETION_POLL_MS);
  }

  throw new Error(
    "Timed out waiting for the new playable video for task " + taskId +
    ". Existing gallery videos were not selected. Last state: " +
    JSON.stringify(lastState)
  );
}

async function findThreeDotMenuButton(card) {
  const buttons = card.locator("button,[role='button']");
  const count = await buttons.count();
  const matches = [];

  for (let i = 0; i < count; i++) {
    const button = buttons.nth(i);
    if (!(await button.isVisible().catch(() => false))) continue;

    const info = await button.evaluate(el => ({
      text: (el.innerText || "").trim(),
      aria: el.getAttribute("aria-label") || "",
      title: el.getAttribute("title") || "",
      html: (el.innerHTML || "").slice(0, 1600)
    })).catch(() => null);

    if (!info) continue;
    const signature = [
      info.text, info.aria, info.title, info.html
    ].join(" ").toLowerCase();

    if (
      /more_vert|more_horiz|ellipsis|overflow|kebab|المزيد|خيارات/.test(signature) ||
      /⋮|⋯/.test(signature)
    ) {
      matches.push(button);
    }
  }

  if (matches.length === 1) return matches[0];

  const diagnostics = await buttons.evaluateAll(els => els.map(el => ({
    text: (el.innerText || "").trim(),
    aria: el.getAttribute("aria-label"),
    title: el.getAttribute("title"),
    html: (el.innerHTML || "").slice(0, 700)
  }))).catch(() => []);

  throw new Error(
    "Could not uniquely identify the three-dot menu on task video card. " +
    "Matching controls=" + matches.length +
    "; card buttons=" + JSON.stringify(diagnostics)
  );
}

async function clickUniqueVisibleText(label, timeout = 10000) {
  const locator = flowPage.getByText(label, { exact: true });
  await locator.first().waitFor({ state: "visible", timeout });

  const visible = [];
  const count = await locator.count();
  for (let i = 0; i < count; i++) {
    if (await locator.nth(i).isVisible().catch(() => false)) {
      visible.push(locator.nth(i));
    }
  }

  if (visible.length !== 1) {
    throw new Error(
      "Expected one visible '" + label + "' option, found " + visible.length
    );
  }
  await visible[0].click();
}

async function downloadTaskVideoFromMenu(taskId, card) {
  // The user's screenshots show: card kebab menu -> تنزيل -> 720p (الحجم الأصلي).
  await card.hover();
  const menuButton = await findThreeDotMenuButton(card);
  await menuButton.click();

  await clickUniqueVisibleText("تنزيل", 10000);

  // 720p is explicitly the original-size option in the user's screenshot.
  const downloadPromise = flowPage.waitForEvent("download", {
    timeout: 90000
  });
  await clickUniqueVisibleText("720p", 10000);
  const download = await downloadPromise;

  log("Selected Flow menu Download > 720p (original size) for " + taskId);
  return download;
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

  // Match the real DOM structure inspected in Google Flow.
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

  await promptBox.fill(String(payload.flow_prompt).trim());

  const settingsLauncher = flowPage.getByRole(
    "button",
    {
      name: /مشغِّل الإعدادات|720p.*8ث|720p.*8s/i
    }
  );

  if (await settingsLauncher.count() !== 1) {
    throw new Error(
      "Could not uniquely identify Flow settings. Stopped before Generate."
    );
  }

  await settingsLauncher.click();

  const settingsPane = flowPage.locator(
    ".settings-content"
  );

  await settingsPane.waitFor({
    state: "visible",
    timeout: 10000
  });

  const settingsText = (
    await settingsPane.innerText()
  ).toLowerCase();

  if (!settingsText.includes("veo 3.1 - lite")) {
    throw new Error(
      "Veo 3.1 Lite is not selected."
    );
  }

  if (!settingsText.includes("9:16")) {
    throw new Error("9:16 is not selected.");
  }

  if (!settingsText.includes("x1")) {
    throw new Error("Single output x1 is not confirmed.");
  }

  await settingsLauncher.click();

  const launcherText = (
    await settingsLauncher.innerText()
  ).toLowerCase();

  if (
    !launcherText.includes("720p") ||
    !/(8ث|8s)/i.test(launcherText) ||
    !launcherText.includes("x1")
  ) {
    throw new Error(
      "Launcher does not confirm 8 seconds, 720p and x1."
    );
  }

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

  // Snapshot the gallery before Generate. The new task result must be
  // distinguishable from the user's existing Flow videos.
  const baselineVideos = await snapshotFlowVideos();

  // Reserve task lock before the paid Generate click.
  const taskLockPath = reserveTaskGeneration(taskId);

  log(
    "Preflight passed. Issuing one Generate click for " +
    taskId + "; baseline video elements=" + baselineVideos.length
  );

  await generateButton.click();

  // Wait for the newly-created playable video, not merely any old <video>.
  const completed = await waitForNewCompletedVideo(taskId, baselineVideos);

  // User-confirmed UI path: three-dot card menu > تنزيل > 720p (الحجم الأصلي).
  const download = await downloadTaskVideoFromMenu(taskId, completed.card);

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

  // Tell n8n that the Windows worker has started this task.
  // The bridge persists the status and sends the Telegram progress notification.
  try {
    await sendTaskResult(
      taskId,
      "processing",
      "",
      "بدأ عامل Windows معالجة المهمة."
    );
  } catch (statusError) {
    log("Could not report processing status: " + statusError.message);
  }

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
    "Flow completion wait: " +
    Math.round(VIDEO_COMPLETION_TIMEOUT_MS / 60000) +
    " minutes; poll every " +
    VIDEO_COMPLETION_POLL_MS +
    "ms"
  );

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
