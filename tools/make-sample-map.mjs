// Draws the sample import images (maps/sample-height.png, maps/sample-features.png) and imports them with the
// game's own importer into maps/sample.json. Run: node tools/make-sample-map.mjs
import { serve, playwright, ROOT } from '../tests/harness.mjs';
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';

const server = await serve();
const browser = await playwright.chromium.launch();
const page = await browser.newPage();
await page.goto(server.url + 'maps/index.json');

const out = await page.evaluate(async () => {
  const S = 512;
  let seed = 11;
  const rnd = () => { seed = (seed * 16807) % 2147483647; return seed / 2147483647; };
  const canvas = () => { const c = document.createElement('canvas'); c.width = c.height = S; return [c, c.getContext('2d')]; };

  // Shared shapes (image pixels; top = north / enemy side, bottom = south / player side).
  const river = [[150, -10], [170, 60], [205, 120], [190, 190], [230, 250], [300, 300], [330, 370], [310, 440], [340, 522]];
  const roads = [
    [[-10, 262], [80, 258], [160, 250], [229, 252], [300, 262], [400, 250], [522, 240]],   // west-east highway (crosses river)
    [[256, 455], [262, 380], [250, 300], [255, 262]],                                       // player HQ north to the highway
    [[256, 62], [240, 120], [262, 170], [250, 252]],                                        // enemy HQ south to the highway (crosses river)
  ];
  const path = (g, pts) => { g.beginPath(); g.moveTo(...pts[0]); for (let i = 1; i < pts.length - 1; i++) { const [x, y] = pts[i], [nx, ny] = pts[i + 1]; g.quadraticCurveTo(x, y, (x + nx) / 2, (y + ny) / 2); } g.lineTo(...pts[pts.length - 1]); };

  // ---------- height map ----------
  const [hc, h] = canvas();
  h.fillStyle = 'rgb(128,128,128)'; h.fillRect(0, 0, S, S);
  const blob = (x, y, r, grey, alpha = 1) => {
    const gr = h.createRadialGradient(x, y, 0, x, y, r);
    gr.addColorStop(0, `rgba(${grey},${grey},${grey},${alpha})`); gr.addColorStop(1, `rgba(${grey},${grey},${grey},0)`);
    h.fillStyle = gr; h.fillRect(x - r, y - r, 2 * r, 2 * r);
  };
  // Rolling ground.
  for (let n = 0; n < 160; n++) blob(rnd() * S, rnd() * S, 15 + rnd() * 40, rnd() < 0.5 ? 150 : 108, 0.35);
  // Mountain massif, north-east.
  for (let n = 0; n < 26; n++) { const a = rnd() * 6.28, r = rnd() * 55; blob(420 + Math.cos(a) * r, 120 + Math.sin(a) * r, 25 + rnd() * 35, 225 + Math.round(rnd() * 30), 0.55); }
  blob(425, 115, 40, 255, 0.9);
  // Long ridge, west.
  h.save(); h.filter = 'blur(10px)'; h.strokeStyle = 'rgb(190,190,190)'; h.lineWidth = 26; h.lineCap = 'round';
  path(h, [[40, 330], [70, 390], [120, 430], [170, 445]]); h.stroke(); h.restore();
  // Hills near the south-east and a plateau in the north-west.
  blob(430, 400, 45, 175, 0.9); blob(380, 450, 30, 165, 0.8);
  blob(80, 110, 50, 165, 0.9); blob(110, 70, 30, 175, 0.8);
  // River valley.
  h.save(); h.filter = 'blur(8px)'; h.strokeStyle = 'rgb(96,96,96)'; h.lineWidth = 30; h.lineCap = 'round'; path(h, river); h.stroke(); h.restore();
  h.save(); h.filter = 'blur(3px)'; h.drawImage(hc, 0, 0); h.restore();
  // Flat pads where the HQs go.
  for (const [x, y] of [[256, 470], [256, 40]]) blob(x, y, 30, 128, 1);

  // ---------- feature map ----------
  const [fc, f] = canvas();
  f.fillStyle = 'rgb(210,180,140)'; f.fillRect(0, 0, S, S);
  // Forests (dense) and scattered trees.
  const patch = (x, y, r, col, n) => { f.fillStyle = col; for (let i = 0; i < n; i++) { const a = rnd() * 6.28, d = rnd() * r; f.beginPath(); f.arc(x + Math.cos(a) * d, y + Math.sin(a) * d, r * (0.25 + rnd() * 0.3), 0, 6.28); f.fill(); } };
  patch(330, 190, 40, 'rgb(144,238,144)', 10); patch(110, 190, 45, 'rgb(144,238,144)', 10); patch(420, 330, 35, 'rgb(144,238,144)', 8);
  patch(90, 160, 36, 'rgb(0,100,0)', 12); patch(350, 170, 30, 'rgb(0,100,0)', 10); patch(140, 380, 28, 'rgb(0,100,0)', 8);
  patch(440, 300, 26, 'rgb(0,100,0)', 8); patch(60, 470, 30, 'rgb(0,100,0)', 8); patch(470, 470, 25, 'rgb(144,238,144)', 6);
  // River.
  f.strokeStyle = 'rgb(0,0,255)'; f.lineWidth = 11; f.lineCap = 'round'; path(f, river); f.stroke();
  // Building areas: a town west of the river by the highway, a village east, a farm south.
  f.fillStyle = 'rgb(255,0,0)';
  for (const [x, y, w, hh] of [[95, 226, 40, 24], [100, 268, 50, 26], [150, 228, 22, 18], [355, 222, 36, 20], [380, 262, 28, 22], [372, 392, 26, 20]]) f.fillRect(x, y, w, hh);
  // Roads (drawn after the river: the importer keeps the river flowing under the crossings).
  f.strokeStyle = 'rgb(128,128,128)'; f.lineWidth = 6; f.lineJoin = 'round';
  for (const r of roads) { path(f, r); f.stroke(); }
  // Capture points.
  f.fillStyle = 'rgb(255,255,0)';
  for (const [x, y] of [[256, 230], [120, 300], [400, 290], [150, 120], [360, 420]]) { f.beginPath(); f.arc(x, y, 6, 0, 6.28); f.fill(); }
  // HQs: player (white) south, enemy (black) north.
  f.fillStyle = 'rgb(255,255,255)'; f.fillRect(246, 462, 20, 20);
  f.fillStyle = 'rgb(0,0,0)'; f.fillRect(246, 30, 20, 20);

  // Snap every feature pixel to its key colour (or the background) so the PNG is truly flat-coloured.
  const { classify, FEATURE_KEYS, importImages } = await import('/src/maps/imageimport.js');
  const fd = f.getImageData(0, 0, S, S);
  for (let p = 0; p < S * S; p++) {
    const c = classify(fd.data[p * 4], fd.data[p * 4 + 1], fd.data[p * 4 + 2]);
    const col = c ? FEATURE_KEYS[c - 1].colors[0] : [210, 180, 140];
    fd.data.set([...col, 255], p * 4);
  }
  f.putImageData(fd, 0, 0);

  // Import with the game's importer and save.
  const hd = h.getImageData(0, 0, S, S);
  const r = importImages({ heightImg: hd, featureImg: fd });
  const { serializeMap } = await import('/src/maps/format.js');
  const json = await serializeMap({ name: 'Sample: River Crossing', hf: r.hf, surface: r.surface, markers: r.markers, meta: { ...r.meta, source: 'tools/make-sample-map.mjs' } });
  return { height: hc.toDataURL('image/png'), features: fc.toDataURL('image/png'), json: JSON.stringify(json), report: r.report };
});

const png = d => Buffer.from(d.split(',')[1], 'base64');
writeFileSync(join(ROOT, 'maps/sample-height.png'), png(out.height));
writeFileSync(join(ROOT, 'maps/sample-features.png'), png(out.features));
writeFileSync(join(ROOT, 'maps/sample.json'), out.json);
console.log('report:', JSON.stringify(out.report, null, 1));
console.log(`maps/sample.json ${(out.json.length / 1024).toFixed(0)} KB`);
await browser.close();
await server.close();
