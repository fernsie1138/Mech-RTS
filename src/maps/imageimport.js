// Image import (CLAUDE.md §7.1): a greyscale height map plus a flat-colour feature map -> a map.
// Pure: works on { width, height, data: RGBA bytes } objects (e.g. canvas ImageData), so it runs in Node tests.
//
// Orientation: the top of the image is north (-z), left is west (-x).
import { Heightfield } from '../terrain/heightfield.js';
import { Surface, SURFACE, FEATURE } from '../terrain/surface.js';
import { TERRAIN, MAP_SIZE } from '../config.js';
import { emptyMarkers } from './format.js';

// Feature-map key colours. Each class accepts a few common shades; a pixel snaps to the nearest key
// colour within MATCH_DISTANCE, anything further away (or transparent) is open ground.
export const FEATURE_KEYS = [
  { id: 'water',   label: 'River / water',       colors: [[0, 0, 255], [0, 90, 255], [30, 144, 255]] },
  { id: 'forest',  label: 'Dense forest',        colors: [[0, 100, 0], [0, 128, 0], [34, 139, 34]] },
  { id: 'trees',   label: 'Scattered trees',     colors: [[0, 255, 0], [144, 238, 144], [100, 230, 100]] },
  { id: 'road',    label: 'Road',                colors: [[128, 128, 128], [150, 150, 150], [100, 100, 100]] },
  { id: 'building', label: 'Building area',      colors: [[255, 0, 0], [220, 30, 30]] },
  { id: 'capture', label: 'Capture point',       colors: [[255, 255, 0], [255, 220, 0]] },
  { id: 'player',  label: 'Player HQ',           colors: [[255, 255, 255]] },
  { id: 'enemy',   label: 'Enemy HQ',            colors: [[0, 0, 0]] },
];
export const MATCH_DISTANCE = 60;
const CLASS = Object.fromEntries(FEATURE_KEYS.map((k, i) => [k.id, i + 1]));   // 0 = open ground

export const IMPORT_DEFAULTS = {
  maxHeight: 30,      // white = this many units above flat ground
  maxDepth: 6,        // black = this many units below flat ground
  smooth: 2,          // blur passes on the height map (hides 8-bit steps)
  riverDepth: 2.5,    // extra depth carved under water
  hqPad: 9,           // radius flattened around each HQ
  crossingGap: 6,     // samples: road crossings up to twice this wide keep the river flowing under them
};

// Classify one RGBA pixel -> class index (0 = open ground).
export function classify(r, g, b, a = 255) {
  if (a < 128) return 0;
  let best = 0, bestD = MATCH_DISTANCE * MATCH_DISTANCE;
  for (let c = 0; c < FEATURE_KEYS.length; c++) {
    for (const k of FEATURE_KEYS[c].colors) {
      const d = (r - k[0]) ** 2 + (g - k[1]) ** 2 + (b - k[2]) ** 2;
      if (d <= bestD) { bestD = d; best = c + 1; }
    }
  }
  return best;
}

function boxBlur(src, V, radius, passes) {
  let a = Float32Array.from(src), b = new Float32Array(src.length);
  for (let p = 0; p < passes; p++) {
    // Horizontal then vertical running sums.
    for (let j = 0; j < V; j++) {
      for (let i = 0; i < V; i++) {
        let s = 0, n = 0;
        for (let d = -radius; d <= radius; d++) { const ii = i + d; if (ii >= 0 && ii < V) { s += a[j * V + ii]; n++; } }
        b[j * V + i] = s / n;
      }
    }
    for (let j = 0; j < V; j++) {
      for (let i = 0; i < V; i++) {
        let s = 0, n = 0;
        for (let d = -radius; d <= radius; d++) { const jj = j + d; if (jj >= 0 && jj < V) { s += b[jj * V + i]; n++; } }
        a[j * V + i] = s / n;
      }
    }
  }
  return a;
}

// Separable max / min filters on a 0/1 mask (square neighbourhood).
function morph(src, V, r, isMax) {
  const a = new Float32Array(src.length), b = new Float32Array(src.length);
  const pick = isMax ? Math.max : Math.min;
  for (let j = 0; j < V; j++) for (let i = 0; i < V; i++) {
    let v = isMax ? 0 : 1;
    for (let d = -r; d <= r; d++) { const ii = Math.min(V - 1, Math.max(0, i + d)); v = pick(v, src[j * V + ii]); }
    a[j * V + i] = v;
  }
  for (let j = 0; j < V; j++) for (let i = 0; i < V; i++) {
    let v = isMax ? 0 : 1;
    for (let d = -r; d <= r; d++) { const jj = Math.min(V - 1, Math.max(0, j + d)); v = pick(v, a[jj * V + i]); }
    b[j * V + i] = v;
  }
  return b;
}
const dilate = (m, V, r) => morph(m, V, r, true);
const erode = (m, V, r) => morph(m, V, r, false);

// Connected components of one class in image space -> [{ px, py, count }] centroids (pixels).
function components(cls, W, H, id, minPixels) {
  const seen = new Uint8Array(W * H), out = [], stack = [];
  for (let start = 0; start < W * H; start++) {
    if (cls[start] !== id || seen[start]) continue;
    let sx = 0, sy = 0, n = 0;
    stack.push(start); seen[start] = 1;
    while (stack.length) {
      const p = stack.pop(), x = p % W, y = (p - x) / W;
      sx += x; sy += y; n++;
      for (const q of [x > 0 ? p - 1 : -1, x < W - 1 ? p + 1 : -1, y > 0 ? p - W : -1, y < H - 1 ? p + W : -1]) {
        if (q >= 0 && !seen[q] && cls[q] === id) { seen[q] = 1; stack.push(q); }
      }
    }
    if (n >= minPixels) out.push({ px: sx / n + 0.5, py: sy / n + 0.5, count: n });
  }
  return out;
}

// heightImg / featureImg: { width, height, data } or null. Returns { hf, surface, markers, report }.
export function importImages({ heightImg = null, featureImg = null, size = MAP_SIZE, cells = TERRAIN.cells, ...opts } = {}) {
  const o = { ...IMPORT_DEFAULTS, ...opts };
  const hf = new Heightfield({ size, cells, bedrock: TERRAIN.bedrock, maxSlope: TERRAIN.maxSlope });
  const surface = new Surface(hf);
  const V = hf.verts, N = V * V;
  const report = { warnings: [], counts: {}, markers: {} };
  for (const img of [heightImg, featureImg]) {
    if (img && img.width !== img.height) report.warnings.push(`image is ${img.width} x ${img.height}; it is stretched to a square map`);
  }
  if (heightImg && featureImg && (heightImg.width !== featureImg.width || heightImg.height !== featureImg.height)) {
    report.warnings.push(`height map (${heightImg.width} x ${heightImg.height}) and feature map (${featureImg.width} x ${featureImg.height}) are different sizes`);
  }

  // ---- heights: bilinear sample of the grey value ----
  let h = new Float32Array(N);
  if (heightImg) {
    const { width: W, height: H, data } = heightImg;
    const grey = (x, y) => { const p = (y * W + x) * 4; return (0.299 * data[p] + 0.587 * data[p + 1] + 0.114 * data[p + 2]) / 255; };
    for (let j = 0; j < V; j++) for (let i = 0; i < V; i++) {
      const fx = (i / (V - 1)) * (W - 1), fy = (j / (V - 1)) * (H - 1);
      const x0 = Math.floor(fx), y0 = Math.floor(fy), x1 = Math.min(W - 1, x0 + 1), y1 = Math.min(H - 1, y0 + 1);
      const tx = fx - x0, ty = fy - y0;
      const g = (grey(x0, y0) * (1 - tx) + grey(x1, y0) * tx) * (1 - ty) + (grey(x0, y1) * (1 - tx) + grey(x1, y1) * tx) * ty;
      h[j * V + i] = g >= 0.5 ? (g - 0.5) * 2 * o.maxHeight : (g - 0.5) * 2 * o.maxDepth;
    }
    if (o.smooth > 0) h = boxBlur(h, V, 1, o.smooth);
  } else {
    report.warnings.push('no height map: terrain is flat');
  }

  // ---- features: nearest-pixel class per sample ----
  const markers = emptyMarkers();
  const sampleCls = new Uint8Array(N);
  if (featureImg) {
    const { width: W, height: H, data } = featureImg;
    const cls = new Uint8Array(W * H);
    for (let p = 0; p < W * H; p++) cls[p] = classify(data[p * 4], data[p * 4 + 1], data[p * 4 + 2], data[p * 4 + 3]);
    for (const k of FEATURE_KEYS) report.counts[k.id] = 0;
    for (let p = 0; p < W * H; p++) if (cls[p]) report.counts[FEATURE_KEYS[cls[p] - 1].id]++;
    for (let j = 0; j < V; j++) for (let i = 0; i < V; i++) {
      const x = Math.min(W - 1, Math.floor((i / (V - 1)) * W)), y = Math.min(H - 1, Math.floor((j / (V - 1)) * H));
      sampleCls[j * V + i] = cls[y * W + x];
    }
    // Markers from pixel blobs. Ignore specks of 1-2 pixels (stray anti-aliasing).
    const toWorld = c => ({ x: -size / 2 + (c.px / W) * size, z: -size / 2 + (c.py / H) * size });
    const minPx = Math.max(2, Math.round(W * H / (512 * 512) * 3));
    const caps = components(cls, W, H, CLASS.capture, minPx);
    markers.capturePoints = caps.map(toWorld);
    for (const [id, key] of [['player', 'playerHQ'], ['enemy', 'enemyHQ']]) {
      const blobs = components(cls, W, H, CLASS[id], minPx).sort((a, b) => b.count - a.count);
      if (blobs.length) markers[key] = toWorld(blobs[0]);
      if (blobs.length > 1) report.warnings.push(`${blobs.length} ${FEATURE_KEYS[CLASS[id] - 1].label} squares found; using the largest`);
      if (!blobs.length) report.warnings.push(`no ${FEATURE_KEYS[CLASS[id] - 1].label} square found`);
    }
    if (!caps.length) report.warnings.push('no capture points found');
  } else {
    report.warnings.push('no feature map: no water, forests, roads or markers');
  }

  const mask = id => { const m = new Float32Array(N); for (let k = 0; k < N; k++) m[k] = sampleCls[k] === CLASS[id] ? 1 : 0; return m; };

  // ---- rivers: carve a channel with soft banks ----
  // A road drawn across a river replaces the water pixels. Close such gaps (only on road pixels), so the
  // river keeps flowing under the crossing; bridges go there in a later milestone.
  const water = mask('water');
  {
    const closed = erode(dilate(water, V, o.crossingGap), V, o.crossingGap);
    for (let k = 0; k < N; k++) if (!water[k] && closed[k] && sampleCls[k] === CLASS.road) water[k] = 1;
  }
  const waterSoft = boxBlur(water, V, 2, 2);
  for (let k = 0; k < N; k++) {
    const m = Math.min(1, waterSoft[k] * 1.6);
    h[k] -= o.riverDepth * m * m * (3 - 2 * m);
  }

  // ---- roads: flatten toward a smoothed height (not across water) and paint ----
  const road = mask('road');
  const roadSoft = boxBlur(road, V, 2, 1);
  const smoothH = boxBlur(h, V, 4, 2);
  for (let k = 0; k < N; k++) {
    const m = Math.min(1, roadSoft[k] * 1.5) * (1 - Math.min(1, waterSoft[k] * 2));
    h[k] += (smoothH[k] - h[k]) * m * 0.9;
    if (road[k]) surface.base[k] = SURFACE.ROAD;
  }

  // ---- HQ pads: flatten a disc to its average height ----
  for (const p of [markers.playerHQ, markers.enemyHQ]) {
    if (!p) continue;
    const { i0, i1, j0, j1 } = hf.rect(p.x, p.z, o.hqPad * 1.5);
    let s = 0, n = 0;
    for (let j = j0; j <= j1; j++) for (let i = i0; i <= i1; i++) {
      if (Math.hypot(hf.wx(i) - p.x, hf.wz(j) - p.z) <= o.hqPad) { s += h[j * V + i]; n++; }
    }
    const avg = n ? s / n : 0;
    for (let j = j0; j <= j1; j++) for (let i = i0; i <= i1; i++) {
      const d = Math.hypot(hf.wx(i) - p.x, hf.wz(j) - p.z);
      const t = d <= o.hqPad ? 1 : Math.max(0, 1 - (d - o.hqPad) / (o.hqPad * 0.5));
      h[j * V + i] += (avg - h[j * V + i]) * t;
    }
  }

  // ---- feature bits ----
  for (let k = 0; k < N; k++) {
    const c = sampleCls[k];
    if (c === CLASS.water) surface.features[k] |= FEATURE.WATER;
    if (c === CLASS.forest) surface.features[k] |= FEATURE.FOREST;
    if (c === CLASS.trees) surface.features[k] |= FEATURE.TREES;
    if (c === CLASS.building) surface.features[k] |= FEATURE.BUILDING;
  }

  // Clamp to bedrock.
  for (let k = 0; k < N; k++) h[k] = Math.max(hf.bedrock, h[k]);
  hf.h.set(h);
  report.markers = { playerHQ: !!markers.playerHQ, enemyHQ: !!markers.enemyHQ, capturePoints: markers.capturePoints.length };
  return { hf, surface, markers, report, meta: { import: { maxHeight: o.maxHeight, maxDepth: o.maxDepth } } };
}
