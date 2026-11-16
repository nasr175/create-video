const { chromium } = require("playwright");

(async () => {
  const browser = await chromium.connectOverCDP("http://127.0.0.1:9222");

  try {
    const page = browser.contexts()[0].pages()
      .find(p => p.url().includes("flow.google.com"));

    await page.keyboard.press("Escape");
    await page.waitForTimeout(500);

    const overlay = await page.locator(
      ".cdk-overlay-backdrop"
    ).count();

    console.log("عدد طبقات التغطية:", overlay);
    console.log("حالة الصفحة:", page.url());

    const tile = page.locator("flow-video-tile").nth(0);

    console.log(
      "الفيديو:",
      await tile.locator(".footer-left").getAttribute("aria-label")
    );

    console.log(
      "زر الخيارات ظاهر:",
      await tile.locator(
        'button[aria-label="خيارات إضافية"]'
      ).isVisible()
    );

  } finally {
    await browser.close();
  }
})().catch(e => console.error("ERROR:", e.message));
