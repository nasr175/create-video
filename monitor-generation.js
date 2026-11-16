const { chromium } = require("playwright");

(async () => {
  const browser = await chromium.connectOverCDP("http://127.0.0.1:9222");

  try {
    const page = browser.contexts()[0].pages()
      .find(p => p.url().includes("flow.google.com"));

    if (!page) throw new Error("صفحة Flow غير موجودة");

    for (let i = 1; i <= 30; i++) {
      const progress = await page.locator(
        "flow-video-tile .progress-bar"
      ).evaluateAll(els =>
        els.map(el => {
          const style = el.getAttribute("style") || "";
          const match = style.match(/progress-percent:\s*([\d.]+)%/);
          return match ? Number(match[1]) : null;
        })
      );

      const percent = progress.length ? progress[0] : null;

      console.log(
        new Date().toLocaleTimeString(),
        "نسبة التقدم:",
        percent === null ? "غير ظاهرة" : percent + "%"
      );

      if (percent === null || percent >= 100) {
        console.log("قد تكون عملية التوليد انتهت؛ يلزم فحص النتيجة.");
        break;
      }

      await page.waitForTimeout(10000);
    }

    console.log("\nانتهت المتابعة. لم يتم الضغط على أي زر.");

  } finally {
    await browser.close();
  }
})().catch(e => console.error("ERROR:", e.message));
