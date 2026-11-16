const { chromium } = require("playwright");

(async () => {
  const browser = await chromium.connectOverCDP("http://127.0.0.1:9222");

  try {
    const page = browser.contexts()[0].pages()
      .find(p => p.url().includes("flow.google.com"));

    const result = await page.locator("flow-video-tile").evaluateAll(tiles =>
      tiles.map(tile => ({
        title: tile.innerText,
        progress: tile.querySelector(".progress-bar")?.getAttribute("style"),
        videoReady: tile.querySelector("video")?.readyState,
        videoDuration: tile.querySelector("video")?.duration,
        videoError: tile.querySelector("video")?.error?.code
      }))
    );

    console.log(JSON.stringify(result, null, 2));
    console.log("\nحالة الصفحة:");
    console.log((await page.locator("body").innerText()).slice(-2500));

  } finally {
    await browser.close();
  }
})().catch(e => console.error(e));
