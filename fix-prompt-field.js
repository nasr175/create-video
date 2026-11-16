const { chromium } = require("playwright");

(async () => {
  const browser = await chromium.connectOverCDP("http://127.0.0.1:9222");

  try {
    const page = browser.contexts()[0].pages()
      .find(p => p.url().includes("flow.google.com"));

    if (!page) throw new Error("صفحة Flow غير موجودة");

    const prompt = `Create an 8-second premium photorealistic cinematic vertical 9:16 beauty commercial featuring an elegant generic skincare serum bottle with no readable brand text. Begin with an extreme macro shot of translucent serum droplets on glass, then a slow smooth camera push-in toward the bottle. Use luxurious soft studio lighting, refined reflections, realistic materials, shallow depth of field, and premium beauty campaign color grading. Finish with a clean centered hero shot of the product. No subtitles, no logos, no watermark, no medical claims, and no misleading product claims.`;

    const editor = page.getByRole("textbox", {
      name: "ما الذي أردت إنشاءه؟"
    });

    await editor.fill(prompt);

    await page.waitForTimeout(1000);

    console.log("النص داخل مربع الطلب:");
    console.log((await editor.innerText()).slice(0, 250));

    const enabled = await page.locator("button").evaluateAll(buttons =>
      buttons.map((b, i) => ({
        index: i,
        text: b.innerText.trim(),
        disabled: b.disabled,
        ariaLabel: b.getAttribute("aria-label")
      })).filter(b => !b.disabled)
    );

    console.log("\nالأزرار المفعّلة:");
    console.log(JSON.stringify(enabled, null, 2));

    console.log("\nلم يتم الضغط على أي زر إنشاء.");

  } finally {
    await browser.close();
  }
})().catch(e => {
  console.error("ERROR:", e.message);
  process.exit(1);
});
