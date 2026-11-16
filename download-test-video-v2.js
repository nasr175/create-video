const { chromium } = require("playwright");
const fs = require("fs");
const path = require("path");

(async () => {
  const outputDir = path.join(__dirname, "output");
  fs.mkdirSync(outputDir, { recursive: true });

  const browser = await chromium.connectOverCDP("http://127.0.0.1:9222");
  const context = browser.contexts()[0];

  const page = context.pages().find(p => p.url().includes("flow.google.com"));
  if (!page) throw new Error("لم يتم العثور على صفحة Google Flow");

  const tile = page.locator("flow-video-tile").filter({
    hasText: "Skincare serum commercial hero shot"
  }).first();

  console.log("الفيديو المحدد:", await tile.locator(".footer-left").getAttribute("aria-label"));

  const cdp = await context.newCDPSession(page);

  await cdp.send("Page.setDownloadBehavior", {
    behavior: "allow",
    downloadPath: outputDir
  });

  console.log("تم تجهيز مجلد التنزيل:", outputDir);

  await tile.hover();
  await tile.locator('button[aria-label="خيارات إضافية"]').click();

  const downloadItem = page.getByRole("menuitem", { name: /تنزيل/ });
  await downloadItem.waitFor({ state: "visible", timeout: 10000 });

  console.log("قائمة التنزيل ظهرت بنجاح.");
  console.log("اضغط على تنزيل الآن...");

  await downloadItem.click();

  console.log("تم الضغط على تنزيل. سأراقب مجلد الإخراج لمدة 90 ثانية.");

  const start = Date.now();
  let found = false;

  while (Date.now() - start < 90000) {
    const files = fs.readdirSync(outputDir);
    const video = files.find(f => f.toLowerCase().endsWith(".mp4"));

    if (video) {
      const fullPath = path.join(outputDir, video);
      const size = fs.statSync(fullPath).size;

      if (size > 100000) {
        console.log("تم العثور على ملف فيديو:");
        console.log("الاسم:", video);
        console.log("الحجم:", size, "بايت");
        console.log("المسار:", fullPath);
        found = true;
        break;
      }
    }

    await new Promise(resolve => setTimeout(resolve, 2000));
  }

  if (!found) {
    console.log("لم يظهر ملف MP4 خلال 90 ثانية.");
    console.log("محتويات المجلد:", fs.readdirSync(outputDir));
  }

  await cdp.detach();
  await browser.close();
})().catch(e => {
  console.error("خطأ:", e.message);
  process.exitCode = 1;
});
