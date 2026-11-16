const { chromium } = require("playwright");
const fs = require("fs");
const path = require("path");

(async () => {
  const browser = await chromium.connectOverCDP("http://127.0.0.1:9222");

  try {
    const page = browser.contexts()[0].pages()
      .find(p => p.url().includes("flow.google.com"));

    const tile = page.locator("flow-video-tile").nth(0);
    const title = await tile.locator(".footer-left")
      .getAttribute("aria-label");

    if (title !== "Skincare serum commercial hero shot") {
      throw new Error("الفيديو الأول ليس الفيديو الجديد");
    }

    const downloadsDir = path.join(
      process.env.USERPROFILE, "Downloads"
    );

    const before = new Set(
      fs.readdirSync(downloadsDir)
        .filter(f => f.toLowerCase().endsWith(".mp4"))
    );

    await page.keyboard.press("Escape");
    await tile.hover();
    await page.waitForTimeout(700);

    await tile.locator(
      'button[aria-label="خيارات إضافية"]'
    ).click();

    const option = page.getByRole("menuitem", { name: /تنزيل/ });

    if (await option.count() !== 1) {
      throw new Error("خيار التنزيل غير محدد بشكل منفرد");
    }

    console.log("بدأ طلب تنزيل الفيديو الجديد...");
    await option.click();

    for (let i = 0; i < 60; i++) {
      await page.waitForTimeout(2000);

      const files = fs.readdirSync(downloadsDir)
        .filter(f => f.toLowerCase().endsWith(".mp4"));

      const fresh = files.filter(f => !before.has(f));

      if (fresh.length) {
        const results = fresh.map(name => {
          const full = path.join(downloadsDir, name);
          const stat = fs.statSync(full);
          return { name, size: stat.size, path: full };
        });

        console.log("ملفات MP4 الجديدة:");
        console.log(JSON.stringify(results, null, 2));
        return;
      }
    }

    console.log("لم يظهر ملف جديد خلال دقيقتين.");
    console.log("لم يتم إعادة إنشاء الفيديو.");

  } finally {
    await browser.close();
  }
})().catch(e => {
  console.error("ERROR:", e.message);
  process.exit(1);
});
