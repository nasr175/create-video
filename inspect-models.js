const { chromium } = require('playwright');

(async () => {
  const browser = await chromium.connectOverCDP('http://127.0.0.1:9222');
  const page = browser.contexts()[0].pages()[0];

  const modelMenu = page.getByRole('button', {
    name: 'اختيار فئة النماذج'
  });

  await modelMenu.click();
  await page.waitForTimeout(1000);

  const result = await page.locator('body').innerText();

  console.log('=== AVAILABLE MODEL OPTIONS ===');
  console.log(result.slice(-5000));

  console.log('\nInspection only. Nothing selected or generated.');
})();
