// Makes assets/craters.png (6 crater decals, 3 x 2 cells of 256 x 256 with a transparent background) from the
// artwork in assets/craters-source.png (six craters on white, 3 across and 2 down).
// Run: node tools/make-craters.mjs        (uses the headless Chromium that the tests use, for its canvas)
import { readFileSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
const { chromium } = createRequire(import.meta.url)('playwright');

const src = 'data:image/png;base64,' + readFileSync(new URL('../assets/craters-source.png', import.meta.url)).toString('base64');
const browser = await chromium.launch();
const page = await browser.newPage();
const out = await page.evaluate(async src => {
  const img = new Image(); img.src = src; await img.decode();
  const W = img.width, H = img.height, cols = 3, rows = 2, cw = W / cols, ch = H / rows, S = 256;
  const c = document.createElement('canvas'); c.width = W; c.height = H;
  const k = c.getContext('2d'); k.drawImage(img, 0, 0);
  const d = k.getImageData(0, 0, W, H), p = d.data;
  // White background -> transparent: alpha from how far a pixel is from white, then un-blend the colour.
  for (let i = 0; i < p.length; i += 4) {
    const dist = 255 - Math.min(p[i], p[i + 1], p[i + 2]);
    const a = Math.max(0, Math.min(1, (dist - 16) / 34));
    for (let q = 0; q < 3; q++) p[i + q] = a > 0 ? Math.max(0, Math.min(255, (p[i + q] - (1 - a) * 255) / a)) : 0;
    p[i + 3] = Math.round(a * 255);
  }
  k.putImageData(d, 0, 0);
  const atlas = document.createElement('canvas'); atlas.width = S * cols; atlas.height = S * rows;
  const ak = atlas.getContext('2d');
  const boxes = [];
  for (let r = 0; r < rows; r++) for (let q = 0; q < cols; q++) {
    // Bounding box of the crater in its cell; it is drawn centred, scaled to fit its 256 x 256 cell.
    let x0 = Infinity, y0 = Infinity, x1 = -1, y1 = -1;
    for (let y = Math.floor(r * ch); y < (r + 1) * ch; y++) for (let x = Math.floor(q * cw); x < (q + 1) * cw; x++) {
      if (p[(y * W + x) * 4 + 3] > 40) { if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y; }
    }
    const bw = x1 - x0 + 1, bh = y1 - y0 + 1, s = (S - 4) / Math.max(bw, bh);
    ak.drawImage(c, x0, y0, bw, bh, q * S + (S - bw * s) / 2, r * S + (S - bh * s) / 2, bw * s, bh * s);
    boxes.push([bw, bh]);
  }
  return { png: atlas.toDataURL('image/png'), boxes };
}, src);
writeFileSync(new URL('../assets/craters.png', import.meta.url), Buffer.from(out.png.split(',')[1], 'base64'));
console.log('wrote assets/craters.png; crater sizes in the source:', out.boxes.map(b => b.join('x')).join(', '));
await browser.close();
