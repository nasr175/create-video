const { chromium } = require("playwright");

(async () => {
  const browser = await chromium.connectOverCDP("http://127.0.0.1:9222");

  try {
    const page = browser.contexts()[0].pages()
      .find(p => p.url().includes("flow.google.com"));

    const tiles = await page.locator("flow-video-tile").evaluateAll(els =>
      els.map((tile, i) => ({
        index: i,
        title: tile.querySelector(".footer-title")?.innerText,
        duration: tile.querySelector("video")?.duration,
        readyState: tile.querySelector("video")?.readyState,
        buttons: [...tile.querySelectorAll("button")].map(b => ({
          label: b.getAttribute("aria-label"),
          text: b.innerText.trim(),
          menu: b.getAttribute("aria-haspopup")
        }))
      }))
    );

    console.log(JSON.stringify(tiles, null, 2));

  } finally {
    await browser.close();
  }
})().catch(e => console.error(e));
