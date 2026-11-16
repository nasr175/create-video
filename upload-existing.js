require("dotenv").config();

const fs = require("fs");
const path = require("path");

async function main() {
  const taskId = "1514-0";

  const videoPath = path.join(
    process.env.USERPROFILE,
    "Downloads",
    "Girl_applying_eye_serum_6095102b.mp4"
  );

  const uploadUrl =
    process.env.N8N_UPLOAD_URL ||
    "https://nasr-work.duckdns.org/webhook/beautyworld-upload-video";

  const token = process.env.WORKER_TOKEN;

  if (!token || token.length < 64) {
    throw new Error("Worker token is missing or invalid.");
  }

  if (!fs.existsSync(videoPath)) {
    throw new Error("Video file not found: " + videoPath);
  }

  const stat = fs.statSync(videoPath);

  if (stat.size < 1024) {
    throw new Error("Video file is too small.");
  }

  console.log("Task ID:", taskId);
  console.log("Video:", videoPath);
  console.log("Size:", (stat.size / 1024 / 1024).toFixed(2), "MB");
  console.log("Uploading existing video...");

  const form = new FormData();

  form.append("task_id", taskId);
  form.append("worker_id", "BeautyWorld-Windows");
  form.append("output_path", videoPath);

  form.append(
    "video",
    new Blob(
      [fs.readFileSync(videoPath)],
      { type: "video/mp4" }
    ),
    path.basename(videoPath)
  );

  const response = await fetch(uploadUrl, {
    method: "POST",
    headers: {
      "X-Worker-Token": token
    },
    body: form,
    signal: AbortSignal.timeout(180000)
  });

  const resultText = await response.text();

  console.log("HTTP Status:", response.status);
  console.log("Server Response:", resultText);

  if (!response.ok) {
    throw new Error("Upload failed: HTTP " + response.status);
  }

  let result;

  try {
    result = JSON.parse(resultText);
  } catch {
    throw new Error("Server returned an invalid JSON response.");
  }

  if (
    result.success !== true ||
    result.status !== "completed"
  ) {
    throw new Error(
      "Upload was not confirmed as completed. Check n8n response."
    );
  }

  console.log("SUCCESS: Telegram delivery confirmed.");
}

main().catch(error => {
  console.error("ERROR:", error.message);
  process.exitCode = 1;
});
