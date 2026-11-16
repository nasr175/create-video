const { chromium } = require("playwright");
const fs = require("fs");
const path = require("path");

(async () => {
  const browser = await chromium.connectOverCDP("http://127.0.0.1:9222");

  try {
    const page = browser.contexts()[0].pages()
      .find(p => p.url().includes("flow.google.com"));

    if (!page) throw new Error("صفحة Flow غير موجودة");

    // إغلاق أي قائمة قديمة مفتوحة
    await page.keyboard.press("Escape");
    await page.waitForTimeout(500);

    const tile = page.locator("flow-video-tile").nth(0);

    const title = await tile.locator(".footer-left")
      .getAttribute("aria-label");

    if (title !== "Skincare serum commercial hero shot") {
      throw new Error("الفيديو المحدد غير مطابق");
    }

    // إظهار خيارات البطاقة
    await tile.hover();
    await page.waitForTimeout(700);

    const menuButton = tile.locator(
      'button[aria-label="خيارات إضافية"]'
    );

    if (!(await menuButton.isVisible())) {
      throw new Error("زر الخيارات غير ظاهر");
    }

    await menuButton.click();
    await page.waitForTimeout(500);

    // التأكد من وجود خيار تنزيل واحد
    const downloadOption = page.getByRole("menuitem", {
      name: /تنزيل/
    });

    if (await downloadOption.count() !== 1) {
      throw new Error("لم يتم تحديد خيار التنزيل بشكل منفرد");
    }

    const outputDir = path.join(process.cwd(), "output");
    fs.mkdirSync(outputDir, { recursive: true });

    const downloadPromise = page.waitForEvent("download", {
      timeout: 120000
    });

    await downloadOption.click();

    console.log("تم اختيار التنزيل، في انتظار الملف...");

    const download = await downloadPromise;

    const filename = download.suggestedFilename() || "beauty-video.mp4";
    const filePath = path.join(outputDir, filename);

    await download.saveAs(filePath);

    const failure = await download.failure();
    if (failure) throw new Error(failure);

    if (!fs.existsSync(filePath)) {
      throw new Error("لم يتم العثور على الملف بعد التنزيل");
    }

    console.log("تم تنزيل الفيديو بنجاح.");
    console.log("الملف:", filePath);
    console.log("الحجم:", fs.statSync(filePath).size, "bytes");

  } finally {
    await browser.close();
  }
})().catch(e => {
  console.error("DOWNLOAD ERROR:", e.message);
  process.exit(1);
});
