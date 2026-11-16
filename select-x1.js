const { chromium } = require('playwright');

(async () => {
  const browser = await chromium.connectOverCDP('http://127.0.0.1:9222');
  const page = browser.contexts()[0].pages()[0];

  await page.getByRole('button', { name: 'مشغِّل الإعدادات' }).click();
  await page.waitForTimeout(700);

  const options = await page.getByText('x1', { exact: true }).count();
  console.log('x1 options:', options);

  if (options !== 1) {
    throw new Error('عدد خيارات x1 غير متوقع، أوقفنا التنفيذ بأمان.');
  }

  await page.getByText('x1', { exact: true }).click();
  await page.waitForTimeout(1000);

  console.log('\n=== FINAL SETTINGS ===');
  console.log((await page.locator('body').innerText()).slice(-1200));
  console.log('\nNo generation started.');
})();
