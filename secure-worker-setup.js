const fs = require("fs");
const crypto = require("crypto");

if (!fs.existsSync(".env")) {
  const token = crypto.randomBytes(32).toString("hex");
  fs.writeFileSync(".env", `WORKER_TOKEN=${token}\n`, { flag: "wx" });
  console.log("تم إنشاء مفتاح الحماية محليًا.");
} else {
  console.log("ملف الحماية موجود، لم يتم تغييره.");
}

const ignore = fs.existsSync(".gitignore")
  ? fs.readFileSync(".gitignore", "utf8")
  : "";

if (!ignore.split(/\r?\n/).includes(".env")) {
  fs.appendFileSync(".gitignore", "\n.env\n");
}

const code = String.raw`
require("dotenv").config();
const express = require("express");
const crypto = require("crypto");

const app = express();
const PORT = 3030;
const TOKEN = process.env.WORKER_TOKEN;

if (!TOKEN || TOKEN.length < 64) {
  throw new Error("مفتاح الحماية غير موجود أو غير صالح");
}

app.use(express.json({ limit: "100kb" }));

function authenticate(req, res, next) {
  const header = req.get("authorization") || "";
  const supplied = header.startsWith("Bearer ")
    ? header.slice(7)
    : "";

  const a = Buffer.from(supplied);
  const b = Buffer.from(TOKEN);

  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) {
    return res.status(401).json({
      success: false,
      message: "Unauthorized"
    });
  }

  next();
}

app.get("/health", (req, res) => {
  res.json({
    status: "OK",
    service: "BeautyWorld Playwright Worker",
    playwright: "Ready"
  });
});

app.post("/test", authenticate, (req, res) => {
  res.json({
    success: true,
    message: "تم استقبال المهمة بأمان",
    received: req.body,
    worker: "BeautyWorld"
  });
});

app.listen(PORT, "127.0.0.1", () => {
  console.log("BeautyWorld Worker Started");
  console.log("Local URL: http://127.0.0.1:" + PORT);
  console.log("Authentication: ENABLED");
});
`;

fs.writeFileSync("worker.js", code.trimStart(), "utf8");
console.log("تم تحديث worker.js وإضافة المصادقة.");
