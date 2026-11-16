const { chromium } = require('playwright');

(async () => {
  const browser = await chromium.connectOverCDP('http://127.0.0.1:9222');
  const page = browser.contexts()[0].pages()[0];

  // اختيار Veo 3.1 Lite
  const lite = page.getByText('Veo 3.1 - Lite', { exact: true });
  console.log('Lite option:', await lite.count());

  if (!(await lite.count())) throw new Error('لم يتم العثور على Veo 3.1 Lite');

  await lite.click();
  await page.waitForTimeout(1500);

  // فتح إعدادات الفيديو
  const settings = page.getByRole('button', { name: 'مشغِّل الإعدادات' });
  await settings.click();
  await page.waitForTimeout(700);

  // اختيار 9:16
  const vertical = page.getByText('9:16', { exact: true });
  console.log('9:16 option:', await vertical.count());
  if (!(await vertical.count())) throw new Error('لم يظهر خيار 9:16');
  await vertical.click();
  await page.waitForTimeout(700);

  // إعادة فتح الإعدادات عند إغلاق القائمة
  if (!(await page.getByText('x1', { exact: true }).isVisible().catch(() => false))) {
    await settings.click();
    await page.waitForTimeout(500);
  }

  // اختيار نتيجة واحدة
  const one = page.getByText('x1', { exact: true });
  console.log('x1 option:', await one.count());
  if (!(await one.count())) throw new Error('لم يظهر خيار x1');
  await one.click();
  await page.waitForTimeout(1500);

  // قراءة الإعدادات والتكلفة
  console.log('\n=== CURRENT FLOW SETTINGS ===');
  console.log((await page.locator('body').innerText()).slice(-2500));

  console.log('\nتم ضبط الإعدادات فقط. لم يتم إنشاء فيديو.');
})();
