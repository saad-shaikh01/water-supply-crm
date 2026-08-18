const puppeteer = require('puppeteer');
const path = require('path');

(async () => {
  const browser = await puppeteer.launch({ headless: 'new' });
  const page = await browser.newPage();
  // Taller viewport than the receipt/statement scripts — this PDF commonly
  // runs 2+ pages (Trip Summary blocks + 13-col Delivery Items table);
  // fullPage:true screenshots Chrome's PDF viewer's whole continuous-scroll
  // height regardless of viewport, this just gives it more room up front.
  await page.setViewport({ width: 900, height: 2400 });
  const pdfPath = path.join(__dirname, 'daily-sheet-test.pdf').replace(/\\/g, '/');
  await page.goto('file:///' + pdfPath, { waitUntil: 'networkidle0', timeout: 30000 });
  await new Promise((r) => setTimeout(r, 1500));
  await page.screenshot({ path: path.join(__dirname, 'daily-sheet-test.png'), fullPage: true });
  await browser.close();
  console.log('screenshot done');
})().catch((e) => { console.error(e); process.exit(1); });
