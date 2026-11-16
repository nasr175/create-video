const { chromium } = require('playwright');

(async () => {
  const browser = await chromium.connectOverCDP('http://127.0.0.1:9222');
  const page = browser.contexts()[0].pages()[0];

  const promptBox = page.getByRole('textbox', {
    name: 'نص قابل للتعديل'
  });

  console.log('Prompt box count:', await promptBox.count());

  await promptBox.fill(
    'اختبار Beauty World AI Studio - مشهد تجميلي سينمائي لمنتج عناية بالبشرة'
  );

  console.log('Prompt entered:', await promptBox.inputValue());
  console.log('No generation started.');
})();
