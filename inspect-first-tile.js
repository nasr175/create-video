const { chromium } = require("playwright");

(async () => {
  const browser = await chromium.connectOverCDP("http://127.0.0.1:9222");

  try {
    const page = browser.contexts()[0].pages()
      .find(p => p.url().includes("flow.google.com"));

    const tile = page.locator("flow-video-tile").nth(0);

    const details = await tile.evaluate(el => ({
      html: el.outerHTML.slice(0, 10000),
      buttons: [...el.querySelectorAll("button")].map((b, i) => ({
        index: i,
        label: b.getAttribute("aria-label"),
        text: b.innerText,
        expanded: b.getAttribute("aria-expanded"),
        menu: b.getAttribute("aria-haspopup")
      }))
    }));

    console.log(JSON.stringify(details, null, 2));

  } finally {
    await browser.close();
  }
})().catch(e => console.error("ERROR:", e.message));
