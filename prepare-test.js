const { chromium } = require("playwright");

(async () => {
  const browser = await chromium.connectOverCDP("http://127.0.0.1:9222");
  const page = browser.contexts()[0].pages()
    .find(p => p.url().includes("flow.google.com"));

  if (!page) throw new Error("صفحة Google Flow غير مفتوحة");

  const prompt = `Create an 8-second premium photorealistic cinematic vertical 9:16 beauty commercial featuring an elegant generic skincare serum bottle with no readable brand text. Begin with an extreme macro shot of translucent serum droplets on glass, then a slow smooth camera push-in toward the bottle. Use luxurious soft studio lighting, refined reflections, realistic materials, shallow depth of field, and premium beauty campaign color grading. Finish with a clean centered hero shot of the product. No subtitles, no logos, no watermark, no medical claims, and no misleading product claims.`;

  const textbox = page.getByRole("textbox", { name: "نص قابل للتعديل" });
  await textbox.fill(prompt);

  const enteredText = await textbox.inputValue();
  if (enteredText !== prompt) {
    throw new Error("لم يتم التأكد من إدخال نص الطلب بالكامل");
  }

  console.log("تم إدخال وصف الفيديو بنجاح.");
  console.log("راجع مربع الطلب في Google Flow قبل الإنشاء.");
  console.log("لم يتم الضغط على زر الإنشاء في هذا السكربت.");
  await browser.close();
})().catch(e => {
  console.error("ERROR:", e.message);
  process.exit(1);
});
