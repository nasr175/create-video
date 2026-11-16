const { chromium } = require("playwright");

(async () => {
  const browser = await chromium.connectOverCDP("http://127.0.0.1:9222");

  try {
    const page = browser.contexts()[0].pages()
      .find(p => p.url().includes("flow.google.com"));

    const tile = page.locator("flow-video-tile").nth(0);

    console.log("الفيديو:", await tile.locator(".footer-left").getAttribute("aria-label"));

    await page.keyboard.press("Escape");
    await tile.hover();
    await page.waitForTimeout(500);

    await tile.locator('button[aria-label="خيارات إضافية"]').click();
    await page.waitForTimeout(500);

    const downloadItem = page.getByRole("menuitem", { name: /تنزيل/ });

    console.log("خيار التنزيل موجود:", await downloadItem.count());

    const popupPromise = page.context().waitForEvent("page", {
      timeout: 5000
    }).catch(() => null);

    await downloadItem.click();

    const popup = await popupPromise;

    console.log("ظهرت نافذة جديدة:", !!popup);

    if (popup) {
      console.log("رابط النافذة:", popup.url());
      console.log("عنوان النافذة:", await popup.title());
    }

    console.log("رابط الصفحة الأصلية:", page.url());
    console.log("نص الصفحة:", (await page.locator("body").innerText()).slice(-1500));

  } finally {
    await browser.close();
  }
})().catch(e => console.error("ERROR:", e.message));
