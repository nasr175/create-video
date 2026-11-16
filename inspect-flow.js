const { chromium } = require('playwright');

(async () => {
  const browser = await chromium.connectOverCDP('http://127.0.0.1:9222');
  const page = browser.contexts()[0].pages()[0];

  console.log('\n=== FLOW PAGE ===');
  console.log('URL:', page.url());

  const buttons = await page.locator('button:visible').evaluateAll(els =>
    els.map((e, i) => ({
      number: i + 1,
      text: (e.innerText || '').trim().slice(0, 100),
      label: e.getAttribute('aria-label'),
      title: e.getAttribute('title')
    }))
  );

  console.log('\n=== VISIBLE BUTTONS ===');
  console.log(JSON.stringify(buttons, null, 2));

  const fields = await page.locator('textarea:visible, input:visible:not([type="password"]):not([type="email"])').evaluateAll(els =>
    els.map((e, i) => ({
      number: i + 1,
      tag: e.tagName,
      type: e.type || '',
      placeholder: e.getAttribute('placeholder'),
      label: e.getAttribute('aria-label')
    }))
  );

  console.log('\n=== VISIBLE TEXT FIELDS ===');
  console.log(JSON.stringify(fields, null, 2));

  console.log('\nInspection completed. No buttons were clicked.');
})();
