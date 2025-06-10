import puppeteer from 'puppeteer';

let browserPromise;          // resolved once and reused
export const getBrowser = () => {
  if (!browserPromise) {
    if (process.env.NODE_ENV === 'production') {
        // specify chromium path for ubuntu
        browserPromise = puppeteer.launch({
            headless: 'shell',
            executablePath: '/usr/bin/chromium-browser',
            args: ['--no-sandbox', '--disable-setuid-sandbox'],
            protocolTimeout: 120000, // 2 minutes timeout
        })
    } else {
        browserPromise = puppeteer.launch({ headless: 'shell' });
    }
  }
  return browserPromise;
};