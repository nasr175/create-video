const { chromium } = require("playwright");

(async () => {
  const browser = await chromium.connectOverCDP("http://127.0.0.1:9222");

  try {
    const page = browser.contexts()[0].pages()
      .find(p => p.url().includes("flow.google.com"));

    const tile = page.locator("flow-video-tile").nth(0);

    console.log(JSON.stringify(
      await tile.evaluate(el => {
        const video = el.querySelector("video");
        const bar = el.querySelector(".progress-bar");

        return {
          title: el.querySelector(".footer-left")?.getAttribute("aria-label"),
          progress: bar?.getAttribute("style"),
          duration: video?.duration,
          readyState: video?.readyState,
          networkState: video?.networkState,
          error: video?.error?.message || null,
          buttons: [...el.querySelectorAll("button")].map(b => ({
            label: b.getAttribute("aria-label"),
            expanded: b.getAttribute("aria-expanded")
          }))
        };
      }), null, 2
    ));

  } finally {
    await browser.close();
  }
})().catch(e => console.error(e));
