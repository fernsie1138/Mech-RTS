// Tests for the map file format and the image importer (pure modules, run in Node).
// Run: node tests/maps-unit.mjs
import { serializeMap, deserializeMap, upgrade, FORMAT_VERSION } from '../src/maps/format.js';
import { importImages, classify, FEATURE_KEYS, IMPORT_DEFAULTS } from '../src/maps/imageimport.js';
import { Heightfield } from '../src/terrain/heightfield.js';
import { Surface, SURFACE, FEATURE } from '../src/terrain/surface.js';
import { buildTestMap } from '../src/terrain/testmap.js';
import { TERRAIN, MAP_SIZE } from '../src/config.js';
import { checker } from './harness.mjs';

const { check, done } = checker();

// Simple RGBA image helper.
function image(W, H, fill = [210, 180, 140, 255]) {
  const data = new Uint8ClampedArray(W * H * 4);
  for (let p = 0; p < W * H; p++) data.set(fill, p * 4);
  const img = { width: W, height: H, data };
  img.rect = (x0, y0, w, h, c) => { for (let y = y0; y < y0 + h; y++) for (let x = x0; x < x0 + w; x++) data.set([...c, 255], (y * W + x) * 4); };
  img.disc = (cx, cy, r, c) => { for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) if ((x + .5 - cx) ** 2 + (y + .5 - cy) ** 2 <= r * r) data.set([...c, 255], (y * W + x) * 4); };
  return img;
}

// ---------- format: round trip ----------
{
  const hf = new Heightfield({ size: MAP_SIZE, cells: TERRAIN.cells, bedrock: TERRAIN.bedrock, maxSlope: TERRAIN.maxSlope });
  const sf = new Surface(hf);
  buildTestMap(hf, sf);
  for (let k = 0; k < sf.features.length; k += 7) sf.features[k] = k % 16;
  hf.h[1234] = -7.99; hf.h[5678] = 60.123;
  const markers = { playerHQ: { x: 1, z: 100 }, enemyHQ: { x: -3, z: -100 }, capturePoints: [{ x: 0, z: 0 }, { x: 50, z: 5 }] };
  const json = await serializeMap({ name: 'Round trip', hf, surface: sf, markers, meta: { a: 1 } });
  const text = JSON.stringify(json);
  check(json.formatVersion === FORMAT_VERSION, `serialized map has formatVersion ${FORMAT_VERSION}`);
  check(text.length < 1.5e6, `map file size ${(text.length / 1024).toFixed(0)} KB`);
  const m = await deserializeMap(JSON.parse(text));
  let worst = 0; for (let k = 0; k < hf.h.length; k++) worst = Math.max(worst, Math.abs(m.hf.h[k] - hf.h[k]));
  check(worst <= 0.0026, `heights survive save/load within quantisation (max error ${worst.toFixed(4)})`);
  check(m.surface.base.every((v, k) => v === sf.base[k]), 'ground types survive save/load exactly');
  check(m.surface.features.every((v, k) => v === sf.features[k]), 'feature bits survive save/load exactly');
  check(JSON.stringify(m.markers) === JSON.stringify(markers), 'markers survive save/load');
  check(m.name === 'Round trip' && m.meta.a === 1 && m.hf.size === MAP_SIZE && m.hf.cells === TERRAIN.cells, 'name, meta and size survive');
  check(m.surface.damage.every(v => v === 0), 'a loaded map starts with no damage (matches never modify the file)');
}

// ---------- format: errors ----------
{
  const err = async (fn) => { try { await fn(); return null; } catch (e) { return e.message; } };
  check(/newer/.test(await err(() => deserializeMap({ formatVersion: FORMAT_VERSION + 1 }))), 'a map from a newer version is rejected with a clear message');
  check(/no formatVersion/.test(await err(() => deserializeMap({ name: 'x' }))), 'JSON without formatVersion is rejected');
  check(/not a map/.test(await err(() => upgrade(null))), 'non-object is rejected');
  const bad = { formatVersion: 1, size: 256, cells: 512, height: { encoding: 'i16-delta-gzip-b64', scale: 0.005, data: 'AAAA' } };
  check(!!(await err(() => deserializeMap(bad))), 'corrupt height data is rejected');
}

// ---------- importer: colour classification ----------
{
  const id = c => c ? FEATURE_KEYS[c - 1].id : 'open';
  const cases = [[[0, 0, 255], 'water'], [[10, 20, 240], 'water'], [[0, 100, 0], 'forest'], [[144, 238, 144], 'trees'], [[0, 255, 0], 'trees'],
    [[128, 128, 128], 'road'], [[255, 0, 0], 'building'], [[255, 255, 0], 'capture'], [[255, 255, 255], 'player'], [[0, 0, 0], 'enemy'],
    [[210, 180, 140], 'open'], [[139, 90, 43], 'open'], [[255, 128, 0], 'open']];
  const wrong = cases.filter(([c, want]) => id(classify(...c)) !== want).map(([c, w]) => `${c} -> ${id(classify(...c))} (want ${w})`);
  check(wrong.length === 0, `feature colours snap to the right class${wrong.length ? ': ' + wrong.join('; ') : ''}`);
  check(classify(0, 0, 255, 0) === 0, 'transparent pixels are open ground');
}

// ---------- importer: heights ----------
{
  const W = 64, img = image(W, W, [128, 128, 128, 255]);
  img.rect(0, 0, 32, 32, [255, 255, 255]);      // NW white
  img.rect(32, 32, 32, 32, [0, 0, 0]);          // SE black
  const r = importImages({ heightImg: img, smooth: 0 });
  const o = IMPORT_DEFAULTS;
  const nw = r.hf.heightAt(-100, -100), se = r.hf.heightAt(100, 100), ne = r.hf.heightAt(100, -100);
  check(Math.abs(nw - o.maxHeight) < 0.01, `white = +maxHeight ${o.maxHeight} (got ${nw.toFixed(2)})`);
  check(Math.abs(se + o.maxDepth) < 0.01, `black = -maxDepth ${o.maxDepth} (got ${se.toFixed(2)})`);
  check(Math.abs(ne) < 0.2, `mid-grey = flat ground ~0 (got ${ne.toFixed(2)})`);
  const r2 = importImages({ heightImg: img, maxHeight: 50, smooth: 0 });
  check(Math.abs(r2.hf.heightAt(-100, -100) - 50) < 0.01, 'maxHeight option scales the peaks');
  check(r.hf.h.length === 513 * 513 && r.hf.h.every(Number.isFinite), 'a 64 px image is resampled to the 513 x 513 grid');
}

// ---------- importer: features and markers ----------
{
  const W = 512, f = image(W, W);
  f.rect(250, 0, 12, 512, [0, 0, 255]);          // river N-S down the middle (x ~ 0)
  f.rect(0, 300, 512, 8, [128, 128, 128]);       // road W-E at y 300-307 (z ~ +22)
  f.rect(40, 40, 80, 80, [0, 100, 0]);           // forest NW
  f.rect(400, 60, 60, 40, [255, 0, 0]);          // building area NE
  f.disc(100, 250, 5, [255, 255, 0]); f.disc(400, 250, 5, [255, 255, 0]); f.disc(256, 150, 4, [255, 255, 0]);
  f.rect(246, 470, 20, 20, [255, 255, 255]);     // player HQ south
  f.rect(246, 20, 20, 20, [0, 0, 0]);            // enemy HQ north
  f.data.set([255, 255, 0, 255], (10 * W + 500) * 4);   // single stray yellow pixel: ignored
  const r = importImages({ featureImg: f });
  const { hf, surface: sf, markers } = r;
  const at = (x, z) => hf.index(Math.round(hf.gx(x)), Math.round(hf.gz(z)));
  const px = v => -128 + (v / 512) * 256;        // image pixel -> world
  check(markers.capturePoints.length === 3, `3 capture points found, stray pixel ignored (${markers.capturePoints.length})`);
  const cp = markers.capturePoints.map(p => `${p.x.toFixed(1)},${p.z.toFixed(1)}`).sort();
  const want = [[100, 250], [400, 250], [256, 150]].map(([x, y]) => [px(x), px(y)]);
  const ok = want.every(([x, z]) => markers.capturePoints.some(p => Math.hypot(p.x - x, p.z - z) < 0.6));
  check(ok, `capture points at the dot centres (${cp.join(' | ')})`);
  check(markers.playerHQ && Math.hypot(markers.playerHQ.x - px(256), markers.playerHQ.z - px(480)) < 0.6, `player HQ at the white square (${JSON.stringify(markers.playerHQ)})`);
  check(markers.enemyHQ && Math.hypot(markers.enemyHQ.x - px(256), markers.enemyHQ.z - px(30)) < 0.6, `enemy HQ at the black square (${JSON.stringify(markers.enemyHQ)})`);
  check(sf.features[at(px(256), -80)] & FEATURE.WATER, 'river pixels become water');
  check(hf.heightAt(px(256), -80) < -2, `river channel is carved (${hf.heightAt(px(256), -80).toFixed(2)})`);
  check(Math.abs(hf.heightAt(px(150), -80)) < 0.01, 'ground away from the river is untouched');
  check(sf.base[at(px(150), px(303))] === SURFACE.ROAD, 'road pixels become road surface');
  check(sf.features[at(px(80), px(80))] & FEATURE.FOREST, 'dark green becomes dense forest');
  check(sf.features[at(px(430), px(80))] & FEATURE.BUILDING, 'red becomes building area');
  check(sf.features[at(px(150), px(150))] === 0 && sf.base[at(px(150), px(150))] === SURFACE.GRASS, 'tan background is open grass');
  check(r.report.warnings.some(w => /no height map/.test(w)), 'missing height map is reported');
  check(sf.base[at(px(256), px(303))] === SURFACE.ROAD && hf.heightAt(px(256), px(303)) < -1.5, 'road crossing the river does not fill the channel (bridges come later)');
}

// ---------- importer: HQ pad is flattened ----------
{
  const W = 512, hImg = image(W, W, [128, 128, 128, 255]), f = image(W, W);
  for (let y = 0; y < W; y++) for (let x = 0; x < W; x++) { const g = 128 + Math.round(60 * Math.sin(x / 9) * Math.sin(y / 11)); hImg.data.set([g, g, g, 255], (y * W + x) * 4); }
  f.rect(246, 246, 20, 20, [255, 255, 255]);
  const { hf, markers } = importImages({ heightImg: hImg, featureImg: f });
  let lo = Infinity, hi = -Infinity;
  for (let a = 0; a < 40; a++) { const r = (a % 8) + 0.5, t = a * 0.7; const v = hf.heightAt(markers.playerHQ.x + Math.cos(t) * r, markers.playerHQ.z + Math.sin(t) * r); lo = Math.min(lo, v); hi = Math.max(hi, v); }
  check(hi - lo < 0.05, `HQ pad is flat (height spread ${(hi - lo).toFixed(3)} within 8 units)`);
}

// ---------- importer: speed ----------
{
  const W = 512, hImg = image(W, W, [128, 128, 128, 255]), f = image(W, W);
  const t0 = performance.now();
  importImages({ heightImg: hImg, featureImg: f });
  const ms = performance.now() - t0;
  check(ms < 3000, `importing two 512 x 512 images takes ${ms.toFixed(0)} ms here`);
}

done();
