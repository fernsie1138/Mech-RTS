// Regenerates icons/icon-180.png and icons/icon-512.png. Run: node tests/make-icons.mjs
import { createRequire } from 'node:module';
const { chromium } = createRequire(import.meta.url)('playwright');
import { writeFileSync } from 'node:fs';
const browser = await chromium.launch();
const page = await browser.newPage();
for (const size of [180, 512]) {
  const data = await page.evaluate((S) => {
    const c = document.createElement('canvas'); c.width = c.height = S;
    const g = c.getContext('2d'); const u = S / 100;
    const bg = g.createLinearGradient(0, 0, 0, S); bg.addColorStop(0, '#2b3d4d'); bg.addColorStop(1, '#0b1015');
    g.fillStyle = bg; g.fillRect(0, 0, S, S);
    g.fillStyle = '#5c4a32'; g.beginPath(); g.moveTo(0, 78*u); g.lineTo(30*u, 60*u); g.lineTo(55*u, 72*u); g.lineTo(100*u, 58*u); g.lineTo(100*u, 100*u); g.lineTo(0, 100*u); g.fill();
    g.fillStyle = '#d9a441';                       // mech: legs, body, cockpit, gun
    g.fillRect(36*u, 52*u, 8*u, 20*u); g.fillRect(56*u, 52*u, 8*u, 20*u);
    g.fillRect(30*u, 30*u, 40*u, 24*u);
    g.fillRect(70*u, 36*u, 18*u, 6*u);
    g.fillStyle = '#7fd4ff'; g.fillRect(36*u, 35*u, 18*u, 7*u);
    return c.toDataURL('image/png').split(',')[1];
  }, size);
  writeFileSync(new URL(`../icons/icon-${size}.png`, import.meta.url), Buffer.from(data, 'base64'));
}
await browser.close();
console.log('icons written');
