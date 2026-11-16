const { chromium } = require("playwright");

(async () => {
  const browser = await chromium.connectOverCDP("http://127.0.0.1:9222");

  try {
    const page = browser.contexts()[0].pages()
      .find(p => p.url().includes("flow.google.com"));

    const info = await page.locator("video").evaluateAll(videos =>
      videos.map(v => ({
        src: v.currentSrc,
        duration: v.duration,
        poster: v.poster,
        parent: v.parentElement?.parentElement?.outerHTML.slice(0, 5000)
      }))
    );

    console.log("--- معلومات الفيديو ---");
    console.log(JSON.stringify(info, null, 2));

    console.log("\n--- الروابط ---");
    console.log(JSON.stringify(
      await page.locator("a").evaluateAll(links =>
        links.map(a => ({
          text: a.innerText,
          href: a.href,
          label: a.getAttribute("aria-label")
        }))
      ), null, 2
    ));

    console.log("\n--- عناصر التنزيل ---");
    console.log(JSON.stringify(
      await page.locator("[aria-label], [title]").evaluateAll(els =>
        els.map(e => ({
          tag: e.tagName,
          label: e.getAttribute("aria-label"),
          title: e.getAttribute("title")
        })).filter(x =>
          /download|تنزيل|تحميل/i.test(
            (x.label || "") + " " + (x.title || "")
          )
        )
      ), null, 2
    ));

  } finally {
    await browser.close();
  }
})().catch(e => console.error("ERROR:", e.message));
