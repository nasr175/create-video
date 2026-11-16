const { chromium } = require('playwright');

(async () => {
  try {
    const browser = await chromium.connectOverCDP('http://127.0.0.1:9222');

    const contexts = browser.contexts();
    const pages = contexts.flatMap(context => context.pages());

    console.log('Connection: SUCCESS');
    console.log('Open tabs:', pages.length);

    for (const page of pages) {
      console.log('Title:', await page.title());
      console.log('URL:', page.url());
    }

    console.log('Google Flow browser is ready.');
  } catch (error) {
    console.error('Connection failed:', error.message);
  }
})();
