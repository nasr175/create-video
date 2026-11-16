const { chromium } = require('playwright');

(async () => {
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage();

  await page.setContent('<h1>Beauty World AI Studio</h1><p>Playwright is working!</p>');

  console.log('Browser:', browser.browserType().name());
  console.log('Title:', await page.locator('h1').textContent());
  console.log('Status: SUCCESS');

  await browser.close();
})();
