// Makes assets/rubble.png (12 rubble-heap decals, 4 x 3 cells of 256 x 256 with a transparent background) from
// the artwork in assets/rubble-source.png (twelve heaps on white, 4 across and 3 down).
// The white background is found by flooding in from each cell's edges over near-white pixels, so light concrete
// inside a heap stays opaque; the heap's outline is softened by a pixel.
// Run: node tools/make-rubble.mjs        (uses the headless Chromium that the tests use, for its canvas)
import { readFileSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
const { chromium } = createRequire(import.meta.url)('playwright');

const src = 'data:image/png;base64,' + readFileSync(new URL('../assets/rubble-source.png', import.meta.url)).toString('base64');
const browser = await chromium.launch();
const page = await browser.newPage();
const out = await page.evaluate(async src => {
  const img = new Image(); img.src = src; await img.decode();
  const W = img.width, H = img.height, cols = 4, rows = 3, cw = W / cols, ch = H / rows, S = 256;
  const c = document.createElement('canvas'); c.width = W; c.height = H;
  const k = c.getContext('2d'); k.drawImage(img, 0, 0);
  const d = k.getImageData(0, 0, W, H), p = d.data;
  const whiteish = i => Math.min(p[i], p[i + 1], p[i + 2]) > 222 && Math.max(p[i], p[i + 1], p[i + 2]) - Math.min(p[i], p[i + 1], p[i + 2]) < 22;
  const bg = new Uint8Array(W * H);
  const atlas = document.createElement('canvas'); atlas.width = S * cols; atlas.height = S * rows;
  const ak = atlas.getContext('2d');
  const boxes = [];
  for (let r = 0; r < rows; r++) for (let q = 0; q < cols; q++) {
    const x0c = Math.floor(q * cw), x1c = Math.floor((q + 1) * cw) - 1, y0c = Math.floor(r * ch), y1c = Math.floor((r + 1) * ch) - 1;
    // Flood the background from the cell's border.
    const stack = [];
    const push = (x, y) => { const n = y * W + x; if (!bg[n] && whiteish(n * 4)) { bg[n] = 1; stack.push(n); } };
    for (let x = x0c; x <= x1c; x++) { push(x, y0c); push(x, y1c); }
    for (let y = y0c; y <= y1c; y++) { push(x0c, y); push(x1c, y); }
    while (stack.length) {
      const n = stack.pop(), x = n % W, y = (n - x) / W;
      if (x > x0c) push(x - 1, y); if (x < x1c) push(x + 1, y); if (y > y0c) push(x, y - 1); if (y < y1c) push(x, y + 1);
    }
    let x0 = Infinity, y0 = Infinity, x1 = -1, y1 = -1;
    for (let y = y0c; y <= y1c; y++) for (let x = x0c; x <= x1c; x++) {
      const n = y * W + x, i = n * 4;
      if (bg[n]) { p[i + 3] = 0; continue; }
      // Outline pixels (next to the background) are half transparent.
      const edge = (x > x0c && bg[n - 1]) || (x < x1c && bg[n + 1]) || (y > y0c && bg[n - W]) || (y < y1c && bg[n + W]);
      p[i + 3] = edge ? 120 : 255;
      if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y;
    }
    boxes.push({ x0, y0, x1, y1 });
  }
  k.putImageData(d, 0, 0);
  boxes.forEach(({ x0, y0, x1, y1 }, n) => {
    const q = n % cols, r = Math.floor(n / cols), bw = x1 - x0 + 1, bh = y1 - y0 + 1, s = (S - 4) / Math.max(bw, bh);
    ak.drawImage(c, x0, y0, bw, bh, q * S + (S - bw * s) / 2, r * S + (S - bh * s) / 2, bw * s, bh * s);
  });
  return { png: atlas.toDataURL('image/png'), boxes: boxes.map(b => `${b.x1 - b.x0 + 1}x${b.y1 - b.y0 + 1}`) };
}, src);
writeFileSync(new URL('../assets/rubble.png', import.meta.url), Buffer.from(out.png.split(',')[1], 'base64'));
console.log('wrote assets/rubble.png; heap sizes in the source:', out.boxes.join(', '));
await browser.close();
