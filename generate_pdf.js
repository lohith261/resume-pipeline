const puppeteer = require('puppeteer');
const path = require('path');
const fs = require('fs');

async function generatePDF(htmlFile, outputFile) {
  const browser = await puppeteer.launch({
    headless: true,
    args: ['--no-sandbox', '--disable-setuid-sandbox']
  });
  const page = await browser.newPage();

  const htmlPath = 'file://' + path.resolve(htmlFile);
  await page.goto(htmlPath, { waitUntil: 'networkidle0', timeout: 30000 });

  // Wait for fonts to load
  await page.evaluateHandle('document.fonts.ready');

  await page.pdf({
    path: outputFile,
    format: 'A4',
    printBackground: true,
    margin: { top: '0mm', bottom: '0mm', left: '0mm', right: '0mm' },
    displayHeaderFooter: false,
  });

  await browser.close();
  console.log('PDF generated:', outputFile);
}

const htmlFile = process.argv[2] || './resume_base.html';
const outputFile = process.argv[3] || './resume_base.pdf';

generatePDF(htmlFile, outputFile).catch(err => {
  console.error(err);
  process.exit(1);
});
