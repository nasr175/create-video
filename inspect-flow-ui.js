const { chromium } = require("playwright");

(async () => {
  const browser = await chromium.connectOverCDP("http://127.0.0.1:9222");

  const context = browser.contexts()[0];
  const pages = context.pages();

  console.log("عدد صفحات Chrome:", pages.length);

  for (let i = 0; i < pages.length; i++) {
    console.log({
      index: i,
      url: pages[i].url(),
      title: await pages[i].title()
    });
  }

  console.log("انتهى الفحص دون إغلاق Chrome.");
  process.exit(0);
})().catch(error => {
  console.error("ERROR:", error.message);
  process.exit(1);
});
