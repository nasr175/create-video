const { chromium } = require("playwright");

(async () => {
  const browser = await chromium.connectOverCDP("http://127.0.0.1:9222");

  try {
    const page = browser.contexts()[0].pages()
      .find(p => p.url().includes("flow.google.com"));

    if (!page) throw new Error("صفحة Flow غير موجودة");

    console.log("انتظار ظهور نتيجة الفيديو...");
    await page.waitForTimeout(15000);

    console.log("\n--- نص الصفحة ---");
    console.log((await page.locator("body").innerText()).slice(-6000));

    console.log("\n--- عناصر الفيديو ---");
    const videos = await page.locator("video").evaluateAll(els =>
      els.map(v => ({
        src: v.currentSrc || v.src,
        readyState: v.readyState,
        duration: v.duration,
        paused: v.paused
      }))
    );
    console.log(JSON.stringify(videos, null, 2));

    console.log("\n--- أزرار التنزيل ---");
    const downloads = await page.locator("button").evaluateAll(els =>
      els.map(b => ({
        text: b.innerText.trim(),
        label: b.getAttribute("aria-label"),
        title: b.getAttribute("title")
      })).filter(b =>
        /تنزيل|download|تحميل/i.test(
          b.text + " " + b.label + " " + b.title
        )
      )
    );
    console.log(JSON.stringify(downloads, null, 2));

  } finally {
    await browser.close();
  }
})().catch(e => console.error("ERROR:", e.message));
