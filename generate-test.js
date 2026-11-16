const { chromium } = require("playwright");

(async () => {
  const browser = await chromium.connectOverCDP("http://127.0.0.1:9222");

  try {
    const page = browser.contexts()[0].pages()
      .find(p => p.url().includes("flow.google.com"));

    if (!page) throw new Error("صفحة Flow غير موجودة");

    const editor = page.getByRole("textbox", {
      name: "ما الذي أردت إنشاءه؟"
    });

    const prompt = await editor.innerText();
    if (!prompt.includes("8-second premium photorealistic")) {
      throw new Error("وصف الفيديو غير مطابق. تم إلغاء العملية.");
    }

    const button = page.getByRole("button", {
      name: "بدء الإنشاء",
      exact: true
    });

    if (await button.count() !== 1 || !(await button.isEnabled())) {
      throw new Error("زر الإنشاء غير جاهز.");
    }

    const body = await page.locator("body").innerText();
    if (!body.includes("10 من الوحدات")) {
      throw new Error("تعذر التأكد من تكلفة 10 وحدات.");
    }

    console.log("تم التحقق من الوصف والإعدادات والتكلفة.");
    await button.click();
    console.log("تم إرسال طلب إنشاء الفيديو مرة واحدة.");

  } finally {
    await browser.close();
  }
})().catch(e => {
  console.error("ERROR:", e.message);
  process.exit(1);
});
