const { chromium } = require("playwright");

(async () => {
  const browser = await chromium.connectOverCDP("http://127.0.0.1:9222");
  const context = browser.contexts()[0];

  let page = context.pages().find(p =>
    p.url().includes("flow.google.com")
  );

  if (!page) {
    page = await context.newPage();
    await page.goto("https://labs.google/fx/tools/flow", {
      waitUntil: "domcontentloaded",
      timeout: 60000
    });
    console.log("تم فتح Google Flow");
  } else {
    console.log("Google Flow مفتوح بالفعل");
  }

  console.log("العنوان:", page.url());
  console.log("الصفحة:", await page.title());

  process.exit(0);
})().catch(error => {
  console.error("ERROR:", error.message);
  process.exit(1);
});
