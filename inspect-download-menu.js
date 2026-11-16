const { chromium } = require("playwright");

(async () => {
  const browser = await chromium.connectOverCDP("http://127.0.0.1:9222");

  try {
    const page = browser.contexts()[0].pages()
      .find(p => p.url().includes("flow.google.com"));

    const tile = page.locator("flow-video-tile").nth(0);

    const title = await tile.locator(".footer-left")
      .getAttribute("aria-label");

    if (title !== "Skincare serum commercial hero shot") {
      throw new Error("الفيديو المحدد غير مطابق");
    }

    // إظهار أزرار البطاقة بتمرير الماوس
    await tile.hover();
    await page.waitForTimeout(1000);

    const menuButton = tile.locator(
      'button[aria-label="خيارات إضافية"]'
    );

    console.log("الزر ظاهر:", await menuButton.isVisible());

    if (!(await menuButton.isVisible())) {
      throw new Error("زر الخيارات لم يظهر بعد تمرير الماوس");
    }

    await menuButton.click();
    await page.waitForTimeout(1000);

    console.log("\n--- خيارات القائمة ---");

    const items = await page.locator(
      '[role="menu"] button, [role="menuitem"]'
    ).evaluateAll(els => els.map(el => ({
      text: el.innerText.trim(),
      label: el.getAttribute("aria-label"),
      disabled: el.disabled
    })));

    console.log(JSON.stringify(items, null, 2));

    console.log("\n--- النص الظاهر ---");
    console.log((await page.locator("body").innerText()).slice(-2000));

  } finally {
    await browser.close();
  }
})().catch(e => console.error("ERROR:", e.message));
