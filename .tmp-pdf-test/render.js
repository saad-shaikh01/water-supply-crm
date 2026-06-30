const puppeteer = require('puppeteer');
const path = require('path');

(async () => {
  const browser = await puppeteer.launch({ headless: 'new' });
  const page = await browser.newPage();
  await page.setViewport({ width: 900, height: 1300 });
  const pdfPath = path.join(__dirname, 'statement-test.pdf').replace(/\\/g, '/');
  await page.goto('file:///' + pdfPath, { waitUntil: 'networkidle0', timeout: 30000 });
  await new Promise((r) => setTimeout(r, 1500));
  await page.screenshot({ path: path.join(__dirname, 'statement-test.png'), fullPage: true });
  await browser.close();
  console.log('screenshot done');
})().catch((e) => { console.error(e); process.exit(1); });
