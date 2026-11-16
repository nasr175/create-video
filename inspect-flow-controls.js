
const { chromium } = require("playwright");

(async () => {
  let browser;

  try {
    browser = await chromium.connectOverCDP(
      "http://127.0.0.1:9222"
    );

    const context = browser.contexts()[0];

    const page = context.pages().find(p =>
      p.url().includes("flow.google.com/project/")
    );

    if (!page) throw new Error("Project not found");

    const prompt = page.getByRole("textbox", {
      name: "ما الذي أردت إنشاءه؟"
    });

    if (await prompt.count() !== 1) {
      throw new Error("Prompt textbox is not unique");
    }

    const testText =
      "اختبار Beauty World AI Studio - لا تنشئ فيديو";

    await prompt.fill(testText);

    const enteredText = await prompt.innerText();

    console.log("Entered text:", enteredText);
    console.log("Text verified:", enteredText.includes(testText));

    await prompt.fill("");

    const finalText = await prompt.innerText();

    console.log("Prompt cleared:", finalText.trim() === "");
    console.log("No generation started.");

  } catch (error) {
    console.error("Test error:", error.message);
  } finally {
    if (browser) await browser.close().catch(() => {});
  }
})();
