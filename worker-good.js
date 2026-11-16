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

// Fast readiness detection: check the page twice per second by default.
const VIDEO_COMPLETION_TIMEOUT_MS =
  Number(process.env.VIDEO_COMPLETION_TIMEOUT_MS || 15 * 60 * 1000);

const VIDEO_COMPLETION_POLL_MS =
  Number(process.env.VIDEO_COMPLETION_POLL_MS || 500);

const VIDEO_STABLE_CHECKS =
  Math.max(2, Number(process.env.VIDEO_STABLE_CHECKS || 2));

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
let flowWorkspaceReady = false;

let launchInProgress = false;
let lastLaunchAttempt = 0;
let watchdogBusy = false;
let pollBusy = false;
let ensureFlowPromise = null;
let activeGeneration = null;
let lastWorkspaceState = "";

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

function recoveryFlowUrl() {
  // During generation, always restore the exact project that received the prompt.
  return activeGeneration?.projectUrl || FLOW_URL;
}

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
        recoveryFlowUrl()
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
      flowWorkspaceReady = false;

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

async function waitForFlowWorkspace(page, timeoutMs = 90000, options = {}) {
  // Never create a new project while recovering an in-flight generation.
  const allowCreateProject = options.allowCreateProject !== false;
  const deadline = Date.now() + timeoutMs;
  const editorSelector =
    'flow-rich-text-editor.prompt-input .prosemirror-editor [role="textbox"][contenteditable="true"]';
  const newProjectPattern = /^(مشروع جديد|إنشاء مشروع جديد|new project|create new project)$/i;

  while (Date.now() < deadline) {
    if (!page || page.isClosed()) {
      throw new Error("Google Flow tab closed before workspace became ready.");
    }

    const editor = page.locator(editorSelector).first();
    if (await editor.isVisible().catch(() => false)) {
      log("Google Flow project workspace is ready.");
      return true;
    }

    const newProjectButtons = page.getByRole("button", {
      name: newProjectPattern
    });
    const buttonCount = await newProjectButtons.count().catch(() => 0);
    const visibleButtons = [];

    for (let i = 0; i < buttonCount; i++) {
      const candidate = newProjectButtons.nth(i);
      if (await candidate.isVisible().catch(() => false)) {
        visibleButtons.push(candidate);
      }
    }

    if (visibleButtons.length === 1 && !allowCreateProject) {
      // The original project may still be loading or Flow may have returned to its
      // project list. Creating a new project here would detach recovery from the task.
      await page.waitForTimeout(1000);
      continue;
    }

    if (visibleButtons.length === 1 && allowCreateProject) {
      log("Google Flow landing page detected. Clicking New Project...");
      await visibleButtons[0].click();
      log("New Project clicked. Waiting for the project editor...");
      await editor.waitFor({ state: "visible", timeout: timeoutMs });
      log("New Google Flow project workspace is ready.");
      return true;
    }

    if (visibleButtons.length > 1) {
      throw new Error(
        "More than one visible New Project button was found; refusing an ambiguous click."
      );
    }

    await page.waitForTimeout(1000);
  }

  const diagnostics = await page.evaluate(() => ({
    url: location.href,
    title: document.title,
    buttons: Array.from(document.querySelectorAll("button"))
      .filter(el => {
        const r = el.getBoundingClientRect();
        return r.width > 0 && r.height > 0;
      })
      .map(el => (el.innerText || el.getAttribute("aria-label") || "").trim())
      .filter(Boolean)
      .slice(0, 30),
    editorCount: document.querySelectorAll(
      'flow-rich-text-editor.prompt-input .prosemirror-editor [role="textbox"][contenteditable="true"]'
    ).length
  })).catch(() => ({ url: page.url(), title: "unavailable" }));

  throw new Error(
    "Google Flow project workspace did not become ready; " +
    (allowCreateProject ? "New Project button/editor not found. " : "active task recovery refused to create a new project. ") +
    JSON.stringify(diagnostics)
  );
}

async function ensureFlowPage() {
  // Prevent the 15-second watchdog and task recovery from opening duplicate tabs.
  if (ensureFlowPromise) return ensureFlowPromise;

  ensureFlowPromise = (async () => {
    if (flowPage && !flowPage.isClosed() && flowWorkspaceReady) {
      return true;
    }

    const connectedBrowser = await connectBrowser();

    if (!connectedBrowser) {
      state.chrome = "Offline";
      state.flow = activeGeneration ? "Restoring active project" : "Waiting for Chrome";
      flowWorkspaceReady = false;
      launchChrome();
      return false;
    }

    state.chrome = "Connected";

    const contexts = connectedBrowser.contexts();
    if (!contexts.length) {
      state.flow = "No browser context";
      flowWorkspaceReady = false;
      return false;
    }

    const context = contexts[0];
    const pages = context.pages();
    const targetUrl = recoveryFlowUrl();
    const previousPageWasLost = !flowPage || flowPage.isClosed();

    // If idle and the worker lost its Flow tab, start from the Flow landing page
    // so the next task always gets a clean project. During generation, restore
    // the exact existing project URL instead.
    if (activeGeneration) {
      flowPage = pages.find(page =>
        !page.isClosed() &&
        (page.url().includes("flow.google.com") ||
         page.url().includes("labs.google/fx/tools/flow"))
      ) || null;
    } else if (!previousPageWasLost) {
      flowPage = pages.find(page =>
        !page.isClosed() &&
        (page.url().includes("flow.google.com") ||
         page.url().includes("labs.google/fx/tools/flow"))
      ) || null;
    } else {
      flowPage = null;
    }

    if (!flowPage) {
      log(activeGeneration
        ? "Flow tab was closed during generation. Restoring the same project..."
        : "Flow tab is closed. Opening a fresh project workspace...");
      flowPage = await context.newPage();
    }

    try {
      // If a generation is active, do not land on a new/blank project. Restore its URL.
      if (activeGeneration &&
          (!flowPage.url().includes("labs.google/fx/tools/flow") ||
           flowPage.url() !== targetUrl)) {
        await flowPage.goto(targetUrl, {
          waitUntil: "domcontentloaded",
          timeout: 60000
        });
      } else if (!flowPage.url().includes("labs.google/fx/tools/flow") &&
                 !flowPage.url().includes("flow.google.com")) {
        await flowPage.goto(targetUrl, {
          waitUntil: "domcontentloaded",
          timeout: 60000
        });
      }

      state.flow = activeGeneration ? "Restoring active project" : "Preparing project";
      flowWorkspaceReady = await waitForFlowWorkspace(flowPage, 90000, {
        allowCreateProject: !activeGeneration
      });
      state.flow = flowWorkspaceReady ? "Project Ready" : "Not Ready";

      if (flowWorkspaceReady) {
        const statusKey = activeGeneration ? "active:" + activeGeneration.taskId : "idle";
        if (lastWorkspaceState !== statusKey) {
          log(activeGeneration
            ? "Active Google Flow project restored; continuing video detection for " + activeGeneration.taskId
            : "Google Flow workspace is ready.");
          lastWorkspaceState = statusKey;
        }
      }
      return flowWorkspaceReady;
    } catch (error) {
      state.flow = "Not Ready";
      flowWorkspaceReady = false;
      state.lastError = error.message;
      log("Flow workspace recovery error: " + error.message);
      return false;
    }
  })();

  try {
    return await ensureFlowPromise;
  } finally {
    ensureFlowPromise = null;
  }
}

async function watchdog() {
  if (watchdogBusy) return;

  watchdogBusy = true;

  try {
    state.lastCheck = new Date().toISOString();
    if (!flowPage || flowPage.isClosed() || !flowWorkspaceReady || !browser) {
      await ensureFlowPage();
    }
  } catch (error) {
    state.lastError = error.message;
    log("Watchdog error: " + error.message);
  } finally {
    watchdogBusy = false;
  }
}

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

function validateFlowRequirements(payload) {
  const problems = [];
  const prompt = payload.flow_prompt;

  if (typeof prompt !== "string" || !prompt.trim()) {
    problems.push("flow_prompt must be a non-empty string");
  }

  const duration = Number(payload.flow_duration);
  if (!Number.isFinite(duration) || duration !== 15) {
    problems.push("flow_duration must be exactly 15 seconds");
  }

  const resolution = String(payload.flow_resolution || "").trim().toLowerCase();
  if (resolution !== "720p") {
    problems.push("flow_resolution must be 720p");
  }

  const aspectRatio = String(payload.flow_aspect_ratio || "").trim();
  if (aspectRatio !== "9:16") {
    problems.push("flow_aspect_ratio must be 9:16");
  }

  const outputs = Number(payload.flow_outputs);
  if (!Number.isFinite(outputs) || outputs !== 1) {
    problems.push("flow_outputs must be exactly 1");
  }

  const model = String(payload.flow_model || "").toLowerCase();
  if (!model.includes("omni 1.2 flash")) {
    problems.push("flow_model must identify Omni 1.2 Flash");
  }

  if (problems.length) {
    throw new Error("Invalid Flow task specification: " + problems.join("; "));
  }

  return {
    promptLength: prompt.trim().length,
    duration: 15,
    resolution: "720p",
    aspectRatio: "9:16",
    outputs: 1,
    model: String(payload.flow_model).trim()
  };
}

function reserveTaskGeneration(taskId) {
  const safeTask = String(taskId).replace(/[^a-zA-Z0-9_-]/g, "_");

  if (!safeTask) {
    throw new Error("Task ID cannot be used for a generation lock.");
  }

  fs.mkdirSync(GENERATION_LOCK_DIR, { recursive: true });

  const lockPath = path.join(GENERATION_LOCK_DIR, safeTask + ".json");
  const lockData = {
    task_id: taskId,
    state: "reserved_before_generate",
    reserved_at: new Date().toISOString()
  };

  try {
    const fd = fs.openSync(lockPath, "wx");
    try {
      fs.writeFileSync(fd, JSON.stringify(lockData, null, 2));
    } finally {
      fs.closeSync(fd);
    }
  } catch (error) {
    if (error && error.code === "EEXIST") {
      throw new Error(
        "A generation lock already exists for task " + taskId + "; refusing to generate it again."
      );
    }
    throw error;
  }

  return lockPath;
}

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
    new Blob([fs.readFileSync(filePath)], { type: "video/mp4" }),
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
    throw new Error("Upload webhook returned non-JSON: " + raw.slice(0, 300));
  }

  if (!response.ok || data.success !== true || data.status !== "completed") {
    throw new Error(
      "Telegram delivery was not confirmed by n8n (HTTP " + response.status + "): " + raw.slice(0, 500)
    );
  }

  return data;
}

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

      let card = video.parentElement;
      for (let i = 0; card && i < 6; i++, card = card.parentElement) {
        const progressNodes = Array.from(
          card.querySelectorAll("[role='progressbar'],progress,[aria-valuenow]")
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
        nearbyText = (video.parentElement?.parentElement?.innerText || "").slice(0, 1200);
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

      const progress = Array.isArray(progressValues) ? progressValues : [];
      const hasExplicitIncompleteProgress =
        progress.some(v => v < 100) || percentages.some(v => v < 100);
      const hasExplicitCompleteProgress =
        progress.some(v => v >= 100) || percentages.some(v => v >= 100);

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
  const baselineSources = new Set(baselineVideos.map(v => v.src).filter(Boolean));
  const baselineCount = baselineVideos.length;
  let lastLogAt = 0;
  let stableCandidateKey = "";
  let stableCandidateCount = 0;
  let recoveryAttempts = 0;

  log("Watching Google Flow for task " + taskId + "; download starts as soon as the result is playable.");

  while (Date.now() < deadline) {
    if (!flowPage || flowPage.isClosed() || !browser) {
      recoveryAttempts++;
      log("Browser/page closed during task " + taskId + ". Restoring the same Flow project...");
      flowWorkspaceReady = false;
      const restored = await ensureFlowPage().catch(() => false);
      if (!restored) {
        await new Promise(resolve => setTimeout(resolve, 1000));
        continue;
      }
      // The baseline is intentionally retained across reconnects, so the new result
      // remains distinguishable from videos that existed before Generate was clicked.
      continue;
    }

    const videos = await snapshotFlowVideos().catch(() => []);
    const candidates = await inspectGeneratedVideoCandidates().catch(() => []);
    const current = videos.map(v => {
      const detected = candidates.find(c => c.videoIndex === v.index) || {};
      return { ...v, ...detected };
    });

    const newSourceVideos = current.filter(v =>
      v.src && !baselineSources.has(v.src) &&
      v.hasPlayableMedia && !v.hasExplicitIncompleteProgress
    );

    const newElementVideos = current.filter(v =>
      v.index >= baselineCount && v.src &&
      v.hasPlayableMedia && !v.hasExplicitIncompleteProgress
    );

    const ready = newSourceVideos.length ? newSourceVideos : newElementVideos;

    if (ready.length) {
      const candidate = ready[ready.length - 1];
      const candidateKey = [candidate.src, candidate.duration, candidate.index].join("|");
      if (candidateKey === stableCandidateKey) stableCandidateCount++;
      else {
        stableCandidateKey = candidateKey;
        stableCandidateCount = 1;
      }

      if (stableCandidateCount >= VIDEO_STABLE_CHECKS) {
        const video = flowPage.locator("video").nth(candidate.index);
        let cardInfo = null;

        // Prefer the nearest ancestor containing the actual Download control.
        if (Number.isInteger(candidate.ancestorLevel) && candidate.ancestorLevel > 0) {
          cardInfo = { ancestorLevel: candidate.ancestorLevel };
        } else {
          cardInfo = await video.evaluate(el => {
            let node = el;
            let level = 0;
            while (node && level < 16) {
              const r = node.getBoundingClientRect();
              const controls = Array.from(node.querySelectorAll("button,[role='button']"));
              const hasDownload = controls.some(button =>
                /download|تنزيل|تحميل/i.test([
                  button.innerText, button.getAttribute("aria-label"),
                  button.getAttribute("title"), button.getAttribute("data-tooltip")
                ].filter(Boolean).join(" "))
              );
              if (level >= 1 && hasDownload && r.width > 80 && r.height > 100) {
                return { ancestorLevel: level };
              }
              node = node.parentElement;
              level++;
            }
            return null;
          }).catch(() => null);
        }

        if (cardInfo) {
          const card = video.locator("xpath=ancestor::*[" + cardInfo.ancestorLevel + "]");
          log("Playable video detected immediately for " + taskId +
              " (index=" + candidate.index + ", duration=" + candidate.duration + "s). Starting download.");
          return { video, card, candidate, cardInfo };
        }

        // Don't discard a playable result just because Flow changed its card markup.
        const fallbackCard = video.locator("xpath=ancestor::*[1]");
        const fallbackControls = fallbackCard.locator("button,[role='button']");
        if (await fallbackControls.count().catch(() => 0)) {
          log("Playable video detected for " + taskId + ". Using its nearest action container.");
          return { video, card: fallbackCard, candidate, cardInfo: { ancestorLevel: 1 } };
        }
      }
    } else {
      stableCandidateKey = "";
      stableCandidateCount = 0;
    }

    if (Date.now() - lastLogAt >= 60000) {
      const playableCount = current.filter(v => v.hasPlayableMedia).length;
      log("Still waiting for task " + taskId + "; videos=" + current.length +
          ", playable=" + playableCount + ", recoveries=" + recoveryAttempts);
      lastLogAt = Date.now();
    }

    await flowPage.waitForTimeout(VIDEO_COMPLETION_POLL_MS).catch(() => {});
  }

  const diagnostic = await snapshotFlowVideos().catch(() => []);
  const pageInfo = await flowPage.evaluate(() => ({
    url: location.href,
    title: document.title,
    bodyText: (document.body?.innerText || "").slice(0, 1200)
  })).catch(() => ({ url: "unavailable", title: "unavailable", bodyText: "" }));
  throw new Error("Timed out waiting for a playable Google Flow video for task " + taskId +
    ". Last visible video count=" + diagnostic.length +
    ". Recovery page=" + JSON.stringify(pageInfo) +
    ". Check whether Flow preserved the generation after Chrome closed.");
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
    const signature = [info.text, info.aria, info.title, info.html].join(" ").toLowerCase();

    if (
      /more_vert|more_horiz|ellipsis|overflow|kebab|المزيد|خيارات/.test(signature) ||
      /⋮|⋯/.test(signature)
    ) {
      matches.push(button);
    }
  }

  if (matches.length === 1) return matches[0];
  throw new Error("Could not uniquely identify the three-dot menu on task video card.");
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
    throw new Error("Expected one visible '" + label + "' option, found " + visible.length);
  }
  await visible[0].click();
}

async function downloadTaskVideoFromMenu(taskId, card) {
  await card.hover();
  const menuButton = await findThreeDotMenuButton(card);
  await menuButton.click();

  await clickUniqueVisibleText("تنزيل", 10000);

  const downloadPromise = flowPage.waitForEvent("download", { timeout: 90000 });
  await clickUniqueVisibleText("720p", 10000);
  const download = await downloadPromise;

  log("Selected Flow menu Download > 720p for " + taskId);
  return download;
}

async function generateDownloadAndDeliver(taskId, payload) {
  if (!REAL_GENERATION_ENABLED) {
    throw new Error("Paid generation gate is OFF. Set ALLOW_ONE_REAL_GENERATION=true.");
  }

  if (!flowPage || flowPage.isClosed()) {
    throw new Error("Google Flow page is unavailable.");
  }

  fs.mkdirSync(OUTPUT_DIR, { recursive: true });

  const promptSelectors = [
    'flow-rich-text-editor.prompt-input .prosemirror-editor [role="textbox"][contenteditable="true"][aria-label="ما الذي أردت إنشاءه؟"]',
    'flow-rich-text-editor.prompt-input .prosemirror-editor [role="textbox"][contenteditable="true"]',
    'flow-rich-text-editor.prompt-input [contenteditable="true"].ProseMirror'
  ];

  let promptBox = null;
  for (const selector of promptSelectors) {
    const candidate = flowPage.locator(selector).first();
    try {
      await candidate.waitFor({ state: "visible", timeout: 7000 });
      promptBox = candidate;
      break;
    } catch (_) {}
  }

  if (!promptBox) {
    throw new Error("Google Flow prompt editor was not visible.");
  }

  await promptBox.fill(String(payload.flow_prompt).trim());

  const settingsLauncher = flowPage.getByRole("button", {
    name: /مشغِّل الإعدادات|720p.*15|15.*720p/i
  });

  if (await settingsLauncher.count() !== 1) {
    throw new Error("Could not uniquely identify Flow settings.");
  }

  await settingsLauncher.click();
  const settingsPane = flowPage.locator(".settings-content");
  await settingsPane.waitFor({ state: "visible", timeout: 10000 });
  await settingsLauncher.click();

  const generateButton = flowPage.getByRole("button", { name: "بدء الإنشاء" });
  if (await generateButton.count() !== 1 || !(await generateButton.isEnabled())) {
    throw new Error("Generate button is missing or disabled.");
  }

  const baselineVideos = await snapshotFlowVideos();
  const taskLockPath = reserveTaskGeneration(taskId);

  // Persist the active project URL in memory before clicking Generate. If Chrome
  // closes, recovery reopens this same project instead of creating a new one.
  activeGeneration = {
    taskId,
    projectUrl: flowPage.url(),
    startedAt: new Date().toISOString()
  };
  lastWorkspaceState = "active:" + taskId;

  log("Issuing Generate click for " + taskId);
  await generateButton.click();

  const completed = await waitForNewCompletedVideo(taskId, baselineVideos);
  const download = await downloadTaskVideoFromMenu(taskId, completed.card);

  const suggested = download.suggestedFilename() || (taskId + ".mp4");
  const safeTask = taskId.replace(/[^a-zA-Z0-9_-]/g, "_");
  const parsedSuggested = path.parse(path.basename(suggested));
  let safeSuggestedBase = parsedSuggested.name
    .replace(/[<>:"/\\|?*\x00-\x1F]/g, "_")
    .replace(/\s+/g, "_")
    .slice(0, 120);

  const target = path.join(OUTPUT_DIR, safeTask + "_" + safeSuggestedBase + ".mp4");
  await download.saveAs(target);

  const downloaded = fs.statSync(target);
  if (downloaded.size < 1024) {
    throw new Error("Downloaded MP4 is empty or too small.");
  }

  log("Verified MP4 saved: " + target);

  const delivery = await uploadVideoToN8n(taskId, target);

  const lock = JSON.parse(fs.readFileSync(taskLockPath, "utf8"));
  lock.state = "telegram_delivered";
  lock.output_path = target;
  lock.delivered_at = new Date().toISOString();
  fs.writeFileSync(taskLockPath, JSON.stringify(lock, null, 2));

  // Generation and delivery are complete: clear recovery state and open a fresh project.
  log("Task delivered. Opening a clean Google Flow project for the next task...");
  activeGeneration = null;
  lastWorkspaceState = "";
  await closeAndOpenBrandNewProject();

  return { outputPath: target, delivery };
}

// دالة إغلاق الصفحة القديمة تماماً وفتح صفحة نظيفة جديدة عند الاكتمال
async function closeAndOpenBrandNewProject() {
  try {
    activeGeneration = null;
    flowWorkspaceReady = false;
    lastWorkspaceState = "";
    if (flowPage && !flowPage.isClosed()) {
      await flowPage.close();
    }
    flowPage = null;
    await ensureFlowPage();
  } catch (error) {
    log("⚠️ Note while resetting browser for new project: " + error.message);
  }
}

async function sendTaskResult(taskId, status, outputPath = "", errorMessage = "") {
  return await n8nRequest(STATUS_URL, {
    method: "POST",
    body: JSON.stringify({
      task_id: taskId,
      status,
      worker_id: WORKER_ID,
      output_path: outputPath,
      error: errorMessage,
      message: errorMessage
    })
  });
}

async function processTask(task) {
  const taskId = String(task.task_id || "").trim();
  if (!taskId) return;

  state.lastTask = taskId;
  log("Received task: " + taskId);

  try {
    await sendTaskResult(taskId, "processing", "", "بدأ عامل Windows معالجة المهمة.");
  } catch (_) {}

  try {
    const payload = normalizePayload(task.payload);
    validateFlowRequirements(payload);

    if (DRY_RUN) {
      log("DRY RUN: Specification valid. No generation.");
      await sendTaskResult(taskId, "validated", "", "DRY_RUN_VALIDATED_ONLY");
      return;
    }

    await generateDownloadAndDeliver(taskId, payload);
  } catch (error) {
    log("Task error: " + error.message);
    try {
      await sendTaskResult(taskId, "failed", "", error.message);
    } catch (_) {}
  }
}

async function pollQueue() {
  if (!POLLING_ENABLED || pollBusy || activeGeneration) return;

  pollBusy = true;
  state.lastPoll = new Date().toISOString();

  try {
    if (!flowWorkspaceReady) {
      const ready = await ensureFlowPage();
      if (!ready || !flowWorkspaceReady) return;
    }

    const result = await n8nRequest(NEXT_TASK_URL, { method: "GET" });
    if (!result.available || !result.task_id) return;

    log("A queued task was found: " + result.task_id);
    await processTask(result);
  } catch (error) {
    state.lastError = error.message;
  } finally {
    pollBusy = false;
  }
}

app.get("/health", (req, res) => {
  res.json({
    status: "OK",
    service: "BeautyWorld Playwright Worker",
    worker: WORKER_ID,
    chrome: state.chrome,
    flow: state.flow,
    flowWorkspaceReady,
    polling: state.polling,
    dryRun: state.dryRun,
    lastCheck: state.lastCheck,
    lastPoll: state.lastPoll,
    lastTask: state.lastTask,
    activeGeneration: activeGeneration ? { taskId: activeGeneration.taskId, startedAt: activeGeneration.startedAt } : null,
    lastError: state.lastError
  });
});

app.listen(PORT, "127.0.0.1", () => {
  log("BeautyWorld Worker Started on http://127.0.0.1:" + PORT);

  watchdog().finally(() => {
    if (POLLING_ENABLED && flowWorkspaceReady) {
      pollQueue();
    }
  });

  setInterval(watchdog, 15000);

  if (POLLING_ENABLED) {
    setInterval(pollQueue, POLL_INTERVAL_MS);
  }
});