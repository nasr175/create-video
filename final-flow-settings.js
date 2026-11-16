const { chromium } = require('playwright');

(async () => {
  const browser = await chromium.connectOverCDP('http://127.0.0.1:9222');
  const page = browser.contexts()[0].pages()[0];

  await page.getByText('9:16', { exact: true }).click();
  await page.waitForTimeout(800);

  console.log('After selecting 9:16:');
  console.log((await page.locator('body').innerText()).slice(-1000));

  const settings = page.getByRole('button', { name: 'مشغِّل الإعدادات' });
  if (await settings.count()) {
    await settings.click();
    await page.waitForTimeout(500);
  }

  const x1 = page.getByText('x1', { exact: true });
  console.log('x1 options:', await x1.count());

  if (await x1.count()) {
    await x1.click();
    await page.waitForTimeout(1000);
  }

  console.log('\n=== FINAL COST AND SETTINGS ===');
  console.log((await page.locator('body').innerText()).slice(-1500));

  console.log('\nNo generation started.');
})();
