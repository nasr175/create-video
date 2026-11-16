const { chromium } = require("playwright");

(async () => {
  const browser = await chromium.connectOverCDP("http://127.0.0.1:9222");

  try {
    const page = browser.contexts()[0].pages()
      .find(p => p.url().includes("flow.google.com"));

    if (!page) throw new Error("صفحة Flow غير مفتوحة");

    console.log("\n--- حالة الصفحة ---");
    console.log("URL:", page.url());

    console.log("\n--- أزرار الصفحة ---");
    const buttons = await page.locator("button").evaluateAll(els =>
      els.map((b, i) => ({
        index: i,
        text: (b.innerText || "").trim(),
        disabled: b.disabled,
        ariaDisabled: b.getAttribute("aria-disabled"),
        title: b.getAttribute("title")
      }))
    );

    console.log(JSON.stringify(buttons, null, 2));

    console.log("\n--- نص الصفحة ---");
    console.log((await page.locator("body").innerText()).slice(-5000));

  } finally {
    await browser.close();
  }
})().catch(e => console.error("ERROR:", e.message));
