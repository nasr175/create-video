const { chromium } = require("playwright");

(async () => {
  const browser = await chromium.connectOverCDP("http://127.0.0.1:9222");
  const page = browser.contexts()[0].pages().find(
    p => p.url().includes("flow.google.com")
  );

  const tile = page.locator("flow-video-tile").filter({
    hasText: "Skincare serum commercial hero shot"
  }).first();

  await tile.hover({ timeout: 15000 });
  await page.waitForTimeout(1500);

  const button = tile.locator(
    'button[aria-label="خيارات إضافية"]'
  );

  console.log("زر الخيارات ظاهر:", await button.isVisible());
  console.log("طبقات التغطية:", await page.locator(
    ".cdk-overlay-backdrop"
  ).count());

  await browser.close();
})().catch(e => console.log("خطأ:", e.message));
