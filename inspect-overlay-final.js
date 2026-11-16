const { chromium } = require("playwright");

(async () => {
  const browser = await chromium.connectOverCDP(
    "http://127.0.0.1:9222"
  );

  const page = browser.contexts()[0].pages().find(
    p => p.url().includes("flow.google.com")
  );

  if (!page) throw new Error("صفحة Flow غير موجودة");

  for (let i = 1; i <= 3; i++) {
    await page.keyboard.press("Escape");
    await page.waitForTimeout(500);

    const count = await page.locator(
      ".cdk-overlay-backdrop"
    ).count();

    console.log(`المحاولة ${i} - طبقات التغطية: ${count}`);

    if (count === 0) break;
  }

  const tile = page.locator("flow-video-tile").filter({
    hasText: "Skincare serum commercial hero shot"
  }).first();

  console.log(
    "الفيديو:",
    await tile.locator(".footer-left").getAttribute("aria-label")
  );

  console.log(
    "زر الخيارات:",
    await tile.locator(
      'button[aria-label="خيارات إضافية"]'
    ).isVisible()
  );

  await browser.close();
})().catch(e => console.log("خطأ:", e.message));
