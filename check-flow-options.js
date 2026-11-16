const { chromium } = require('playwright');

(async () => {
  const browser = await chromium.connectOverCDP('http://127.0.0.1:9222');
  const page = browser.contexts()[0].pages()[0];

  const settings = page.getByRole('button', { name: 'مشغِّل الإعدادات' });

  await settings.click();
  await page.waitForTimeout(1000);

  const body = await page.locator('body').innerText();

  console.log('=== CURRENT SETTINGS MENU ===');
  console.log(body.slice(-2500));

  console.log('\n=== VERTICAL OPTION ===');
  console.log('9:16 count:', await page.getByText('9:16', { exact: true }).count());

  console.log('\nInspection only. No generation.');
})();
