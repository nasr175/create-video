const { chromium } = require("playwright");

(async () => {
  const browser = await chromium.connectOverCDP("http://127.0.0.1:9222");

  try {
    const page = browser.contexts()[0].pages()
      .find(p => p.url().includes("flow.google.com"));

    const tile = page.locator("flow-video-tile").nth(0);

    for (let i = 0; i < 30; i++) {
      const result = await tile.evaluate(el => {
        const bar = el.querySelector(".progress-bar");
        const match = bar?.getAttribute("style")?.match(/progress-percent:\s*([\d.]+)%/);

        return {
          title: el.querySelector(".footer-left")?.getAttribute("aria-label"),
          progress: match ? Number(match[1]) : null,
          duration: el.querySelector("video")?.duration
        };
      });

      console.log(new Date().toLocaleTimeString(), result);

      if (result.progress === null || result.progress >= 100) {
        console.log("انتهت مرحلة التقدم أو اختفى مؤشرها.");
        break;
      }

      await page.waitForTimeout(10000);
    }

  } finally {
    await browser.close();
  }
})().catch(e => console.error("ERROR:", e.message));
