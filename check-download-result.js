const { chromium } = require("playwright");
const fs = require("fs");
const path = require("path");

(async () => {
  const browser = await chromium.connectOverCDP("http://127.0.0.1:9222");

  try {
    console.log("--- التبويبات المفتوحة ---");

    for (const p of browser.contexts()[0].pages()) {
      console.log({
        title: await p.title(),
        url: p.url()
      });
    }

    console.log("\n--- ملفات مجلد التنزيل الافتراضي ---");

    const downloads = path.join(
      process.env.USERPROFILE,
      "Downloads"
    );

    if (fs.existsSync(downloads)) {
      const files = fs.readdirSync(downloads)
        .map(name => {
          const full = path.join(downloads, name);
          const stat = fs.statSync(full);

          return {
            name,
            size: stat.size,
            modified: stat.mtime.toLocaleString()
          };
        })
        .sort((a, b) => new Date(b.modified) - new Date(a.modified))
        .slice(0, 15);

      console.log(JSON.stringify(files, null, 2));
    }

    console.log("\n--- مجلد المشروع ---");

    const output = path.join(process.cwd(), "output");
    if (fs.existsSync(output)) {
      console.log(fs.readdirSync(output));
    } else {
      console.log("مجلد output غير موجود أو فارغ.");
    }

  } finally {
    await browser.close();
  }
})().catch(e => console.error("ERROR:", e.message));
