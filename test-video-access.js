const { chromium } = require("playwright");

(async () => {
  const browser = await chromium.connectOverCDP("http://127.0.0.1:9222");

  try {
    const page = browser.contexts()[0].pages()
      .find(p => p.url().includes("flow.google.com"));

    const tile = page.locator("flow-video-tile").nth(0);

    const result = await tile.locator("video").evaluate(async video => {
      const response = await fetch(video.currentSrc, {
        method: "GET",
        headers: { Range: "bytes=0-1023" }
      });

      return {
        src: video.currentSrc,
        status: response.status,
        contentType: response.headers.get("content-type"),
        contentLength: response.headers.get("content-length"),
        contentRange: response.headers.get("content-range"),
        readable: response.ok
      };
    });

    console.log(JSON.stringify(result, null, 2));

  } finally {
    await browser.close();
  }
})().catch(e => console.error("ERROR:", e.message));
