const { chromium } = require("playwright");
const fs = require("fs");
const path = require("path");

(async () => {
  const browser = await chromium.connectOverCDP("http://127.0.0.1:9222");

  try {
    const context = browser.contexts()[0];
    const page = context.pages().find(p =>
      p.url().includes("flow.google.com")
    );

    console.log("--- إعدادات Chrome ---");

    const settings = await context.newPage();
    await settings.goto("chrome://settings/downloads");
    await settings.waitForTimeout(1500);

    console.log(
      (await settings.locator("body").innerText()).slice(0, 2500)
    );

    await settings.close();

    console.log("\n--- ملفات التنزيل الحديثة ---");

    const dirs = [
      path.join(process.env.USERPROFILE, "Downloads"),
      path.join(process.cwd(), "output"),
      path.join(process.env.LOCALAPPDATA, "BeautyWorldFlowChrome")
    ];

    for (const dir of dirs) {
      if (!fs.existsSync(dir)) continue;

      console.log("\nالمجلد:", dir);

      const files = fs.readdirSync(dir)
        .filter(name => /\.(mp4|crdownload)$/i.test(name))
        .map(name => {
          const full = path.join(dir, name);
          const stat = fs.statSync(full);
          return {
            name,
            size: stat.size,
            modified: stat.mtime.toLocaleString()
          };
        });

      console.log(JSON.stringify(files, null, 2));
    }

    if (page) console.log("\nFlow:", page.url());

  } finally {
    await browser.close();
  }
})().catch(e => console.error("ERROR:", e.message));
