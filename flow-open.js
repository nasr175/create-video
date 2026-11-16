const { chromium } = require('playwright');
const path = require('path');

(async () => {
  const context = await chromium.launchPersistentContext(
    path.join(__dirname, 'flow-profile'),
    {
      headless: false,
      viewport: { width: 1366, height: 900 },
      args: ['--start-maximized']
    }
  );

  const page = context.pages()[0] || await context.newPage();

  await page.goto('https://labs.google/fx/tools/flow', {
    waitUntil: 'domcontentloaded',
    timeout: 60000
  });

  console.log('Google Flow opened.');
  console.log('Page title:', await page.title());
})();
