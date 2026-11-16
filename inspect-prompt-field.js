const { chromium } = require("playwright");

(async () => {
  const browser = await chromium.connectOverCDP("http://127.0.0.1:9222");

  try {
    const page = browser.contexts()[0].pages()
      .find(p => p.url().includes("flow.google.com"));

    const fields = await page.locator(
      'textarea, input, [contenteditable="true"], [role="textbox"]'
    ).evaluateAll(elements => elements.map((el, i) => ({
      index: i,
      tag: el.tagName,
      role: el.getAttribute("role"),
      ariaLabel: el.getAttribute("aria-label"),
      placeholder: el.getAttribute("placeholder"),
      text: el.innerText || "",
      value: el.value || "",
      contenteditable: el.getAttribute("contenteditable")
    })));

    console.log(JSON.stringify(fields, null, 2));

    const arrow = page.getByRole("button", { name: "arrow_forward" });
    console.log("زر المتابعة موجود:", await arrow.count());
    console.log("زر المتابعة مفعّل:", await arrow.isEnabled());

  } finally {
    await browser.close();
  }
})().catch(e => console.error(e));
