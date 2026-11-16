const { chromium } = require("playwright");
const fs = require("fs");
const path = require("path");

(async () => {
  const outputDir = path.join(__dirname, "output");
  fs.mkdirSync(outputDir, { recursive: true });

  const browser = await chromium.connectOverCDP("http://127.0.0.1:9222");
  const context = browser.contexts()[0];
  const page = context.pages().find(p => p.url().includes("flow.google.com"));

  if (!page) throw new Error("صفحة Flow غير موجودة");

  const tile = page.locator("flow-video-tile").filter({
    hasText: "Skincare serum commercial hero shot"
  }).first();

  const cdp = await context.newCDPSession(page);

  cdp.on("Browser.downloadWillBegin", e => {
    console.log("بدأ Chrome تنزيل ملف:");
    console.log("اسم الملف:", e.suggestedFilename);
    console.log("معرّف التنزيل:", e.guid);
    console.log("العنوان:", e.url);
  });

  cdp.on("Browser.downloadProgress", e => {
    console.log("حالة التنزيل:", e.state, "| المستلم:", e.receivedBytes);
  });

  page.on("download", d => {
    console.log("Playwright رصد تنزيل:", d.suggestedFilename());
  });

  try {
    await cdp.send("Browser.setDownloadBehavior", {
      behavior: "allowAndName",
      downloadPath: outputDir,
      eventsEnabled: true
    });
    console.log("تم تفعيل مراقبة تنزيلات Chrome.");
  } catch (e) {
    console.log("تعذر تفعيل مراقبة Browser:", e.message);
  }

  await page.keyboard.press("Escape");
  await tile.hover();
  await tile.locator('button[aria-label="خيارات إضافية"]').click();

  const item = page.getByRole("menuitem", { name: /تنزيل/ });
  await item.waitFor({ state: "visible", timeout: 10000 });

  console.log("اضغط تنزيل مرة واحدة...");
  await item.click();

  await page.waitForTimeout(30000);

  console.log("الملفات الموجودة:", fs.readdirSync(outputDir));
  console.log("عدد صفحات المتصفح:", context.pages().length);

  for (const p of context.pages()) {
    console.log("صفحة:", p.url());
  }

  await cdp.detach();
  await browser.close();
})().catch(e => console.error("خطأ:", e.message));
