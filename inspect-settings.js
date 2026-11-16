const { chromium } = require('playwright');

(async () => {
  const browser = await chromium.connectOverCDP('http://127.0.0.1:9222');
  const page = browser.contexts()[0].pages()[0];

  const settings = page.getByRole('button', {
    name: 'مشغِّل الإعدادات'
  });

  console.log('Settings button:', await settings.count());

  await settings.click();
  await page.waitForTimeout(1000);

  const dialogs = await page.locator('[role="dialog"]:visible').allInnerTexts();
  console.log('Dialogs:', JSON.stringify(dialogs, null, 2));

  const buttons = await page.locator('button:visible').evaluateAll(els =>
    els.map(e => ({
      text: (e.innerText || '').trim(),
      label: e.getAttribute('aria-label')
    })).filter(x => x.text || x.label)
  );

  console.log('Visible options:');
  console.log(JSON.stringify(buttons, null, 2));

  console.log('Inspection only. No generation started.');
})();
