const { chromium } = require("playwright");

(async () => {
  const browser = await chromium.connectOverCDP("http://127.0.0.1:9222");
  const context = browser.contexts()[0];
  const page = context.pages().find(p => p.url().includes("flow.google.com"));

  const tile = page.locator("flow-video-tile").filter({
    hasText: "Skincare serum commercial hero shot"
  }).first();

  const cdp = await context.newCDPSession(page);

  await cdp.send("Browser.setDownloadBehavior", {
    behavior: "allow",
    downloadPath: "C:\\BeautyWorld-Playwright\\output",
    eventsEnabled: true
  });

  cdp.on("Browser.downloadWillBegin", e => {
    console.log("بدأ التنزيل:", e.suggestedFilename);
  });

  cdp.on("Browser.downloadProgress", e => {
    console.log("حالة التنزيل:", e.state);
  });

  await tile.hover();

  await tile.locator(
    'button[aria-label="خيارات إضافية"]'
  ).click();

  console.log("تم فتح قائمة الخيارات");

  const download = page.getByRole("menuitem", {
    name: /تنزيل/
  });

  await download.waitFor({ state: "visible" });
  await download.hover();

  const quality = page.getByText("720p", { exact: true });

  await quality.waitFor({
    state: "visible",
    timeout: 10000
  });

  console.log("قائمة الجودة ظهرت بنجاح");
  console.log("اختيار 720p");

  await quality.click();

  console.log("تم اختيار 720p");

  await page.waitForTimeout(30000);

  await cdp.detach();
  await browser.close();
})().catch(e => {
  console.error("خطأ:", e.message);
  process.exitCode = 1;
});
