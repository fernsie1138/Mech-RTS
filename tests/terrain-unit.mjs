// Numerical tests for the heightfield and surface layers (pure modules, run directly in Node).
// Run: node tests/terrain-unit.mjs
import { Heightfield } from '../src/terrain/heightfield.js';
import { Surface, SURFACE } from '../src/terrain/surface.js';
import { TERRAIN, TERRAIN_DAMAGE, MAP_SIZE } from '../src/config.js';
import { buildTestMap } from '../src/terrain/testmap.js';
import { checker } from './harness.mjs';

const { check, done } = checker();
const make = () => new Heightfield({ size: MAP_SIZE, cells: TERRAIN.cells, bedrock: TERRAIN.bedrock, maxSlope: TERRAIN.maxSlope });
const P = TERRAIN_DAMAGE;
const crater = (hf, x, z, w) => hf.crater(x, z, { radius: P[w].radius, depth: P[w].depth, rim: P[w].rim, erode: P[w].erode });
const allFinite = hf => hf.h.every(Number.isFinite);
function maxNeighbourSlope(hf) {
  let m = 0; const V = hf.verts, h = hf.h;
  for (let j = 0; j < V; j++) for (let i = 0; i < V; i++) {
    const k = j * V + i;
    if (i < V - 1) m = Math.max(m, Math.abs(h[k] - h[k + 1]));
    if (j < V - 1) m = Math.max(m, Math.abs(h[k] - h[k + V]));
  }
  return m / hf.spacing;
}

// --- heightAt is exact bilinear on a plane, and clamps outside the map ---
{
  const hf = make();
  hf.generate((x, z) => 0.04 * x - 0.02 * z + 2);
  let worst = 0;
  for (let n = 0; n < 1000; n++) {
    const x = (Math.random() - 0.5) * MAP_SIZE * 0.99, z = (Math.random() - 0.5) * MAP_SIZE * 0.99;
    worst = Math.max(worst, Math.abs(hf.heightAt(x, z) - (0.04 * x - 0.02 * z + 2)));
  }
  check(worst < 1e-3, `heightAt matches a plane exactly (max error ${worst.toExponential(2)})`);
  check(Math.abs(hf.heightAt(1e6, 0) - hf.heightAt(MAP_SIZE / 2, 0)) < 1e-4, 'heightAt outside the map returns the edge height');
}

// --- Crater shape on flat ground: depth at centre, raised rim, untouched outside ---
for (const w of ['cannon', 'shell']) {
  const hf = make(); hf.generate(() => 0);
  const p = P[w];
  const r = crater(hf, 10.1, -20.3, w);
  const centre = hf.heightAt(10.1, -20.3);
  check(Math.abs(centre + p.depth) < p.depth * 0.1, `${w}: centre lowered by ~${p.depth} (got ${(-centre).toFixed(3)})`);
  const rimH = hf.heightAt(10.1 + p.radius * 1.08, -20.3);
  check(rimH > p.depth * p.rim * 0.4, `${w}: rim raised (height ${rimH.toFixed(3)} at 1.08 x radius, rim target ${(p.depth * p.rim).toFixed(3)})`);
  const far = hf.heightAt(10.1 + p.radius * 1.5 + 2 * hf.spacing, -20.3);
  check(far === 0, `${w}: ground beyond 1.5 x radius untouched (got ${far})`);
  check(r.removed > 0, `${w}: crater removes material (net ${r.removed.toFixed(2)} cubic units)`);
}

// --- Crater size scales with the weapon ---
{
  const vols = ['mg', 'cannon', 'shell'].map(w => { const hf = make(); hf.generate(() => 0); return crater(hf, 0, 0, w).removed; });
  check(vols[0] < vols[1] && vols[1] < vols[2], `crater volume scales mg < cannon < shell (${vols.map(v => v.toFixed(2)).join(' < ')})`);
}

// --- Bedrock clamp and slope limit under sustained fire on one spot ---
{
  const hf = make(); hf.generate(() => 0);
  for (let n = 0; n < 300; n++) crater(hf, 0.2, 0.1, 'shell');
  let min = Infinity; for (const v of hf.h) min = Math.min(min, v);
  check(min >= TERRAIN.bedrock - 1e-6, `300 shells on one spot never dig below bedrock ${TERRAIN.bedrock} (min ${min.toFixed(3)})`);
  check(min < TERRAIN.bedrock + 0.5, `sustained fire does reach bedrock (min ${min.toFixed(3)})`);
  const s = maxNeighbourSlope(hf);
  check(s <= TERRAIN.maxSlope + 1e-3, `slopes stay within maxSlope ${TERRAIN.maxSlope} (max ${s.toFixed(3)})`);
  check(allFinite(hf), 'no NaN/Infinity heights after 300 shells');
}

// --- Erosion: shelling a ridge crest wears it down ---
{
  const hf = make();
  hf.generate((x, z) => Math.max(0, 12 * (1 - (x / 10) ** 2)));             // ridge along z, 12 high
  const crest0 = hf.heightAt(0, 0);
  for (let n = 0; n < 60; n++) crater(hf, (n % 3 - 1) * 1.5, -15 + (n * 7.3) % 30, 'shell');
  let crest = -Infinity; for (let z = -10; z <= 10; z += 0.5) crest = Math.max(crest, hf.heightAt(0, z));
  check(crest < crest0 * 0.7, `60 shells wear the ridge crest down (max crest ${crest0.toFixed(1)} -> ${crest.toFixed(1)})`);
  const flank = hf.heightAt(0, 60);
  check(Math.abs(flank - crest0) < 1e-4, 'ridge away from the bombardment is untouched');
}

// --- Map edge is pinned (no holes at the border) ---
{
  const hf = make(); hf.generate(() => 0);
  const half = MAP_SIZE / 2;
  for (let n = 0; n < 20; n++) crater(hf, half - 0.3, half - 0.2, 'shell');
  crater(hf, -half, 0, 'shell');
  const V = hf.verts; let edgeMax = 0;
  for (let i = 0; i < V; i++) for (const k of [i, (V - 1) * V + i, i * V, i * V + V - 1]) edgeMax = Math.max(edgeMax, Math.abs(hf.h[k]));
  check(edgeMax === 0, `edge samples unchanged by craters at the border (max ${edgeMax})`);
  check(allFinite(hf), 'no NaN after border craters');
}

// --- Change notifications cover every changed sample ---
{
  const hf = make(); hf.generate(() => 0);
  const before = Float32Array.from(hf.h);
  let rect = null; hf.onChange((i0, j0, i1, j1) => { rect = { i0, j0, i1, j1 }; });
  crater(hf, 31.7, 44.2, 'shell');
  let ok = true;
  for (let j = 0; j < hf.verts; j++) for (let i = 0; i < hf.verts; i++) {
    const k = j * hf.verts + i;
    if (hf.h[k] !== before[k] && !(i >= rect.i0 && i <= rect.i1 && j >= rect.j0 && j <= rect.j1)) ok = false;
  }
  check(ok, `change rectangle covers all changed samples (${JSON.stringify(rect)})`);
}

// --- Surface wear: damage map accumulates and never heals; roads break ---
{
  const hf = make(); hf.generate(() => 0);
  const sf = new Surface(hf);
  sf.paint(0, 0, 3, SURFACE.ROAD);
  check(sf.roadIntact(0, 0), 'painted road is intact');
  const k = hf.index(Math.round(hf.gx(0)), Math.round(hf.gz(0)));
  const p = P.cannon;
  sf.wear(0, 0, p.radius * p.wearRadius, p.wear, p.scorch);
  const d1 = sf.damage[k];
  check(d1 > 0 && !sf.roadIntact(0, 0), `a cannon hit damages the road (damage ${d1.toFixed(2)}, intact=${sf.roadIntact(0, 0)})`);
  for (let n = 0; n < 50; n++) sf.wear(0, 0, p.radius * p.wearRadius, p.wear, p.scorch);
  check(sf.damage[k] > d1 * 40, `damage keeps accumulating (${sf.damage[k].toFixed(1)})`);
  check(sf.scorch.every(v => v >= 0 && v <= 1), 'scorch stays within 0..1');
  const c0 = [0, 0, 0], c1 = [0, 0, 0];
  const fresh = new Surface(hf);
  fresh.colorAt(300, 300, 0, 0, c0); sf.colorAt(256, 256, 0, 0, c1);
  const lum = c => 0.3 * c[0] + 0.59 * c[1] + 0.11 * c[2];
  check(lum(c1) < lum(c0) * 0.7, `worn, scorched ground is darker than fresh grass (${lum(c0).toFixed(3)} -> ${lum(c1).toFixed(3)})`);
}

// --- Raycast lands on the surface ---
{
  const hf = make(); const sf = new Surface(hf);
  buildTestMap(hf, sf);
  let worst = 0, misses = 0;
  for (let n = 0; n < 200; n++) {
    const tx = (Math.random() - 0.5) * 200, tz = (Math.random() - 0.5) * 200;
    const ox = tx + 60, oy = 120, oz = tz + 80;
    let dx = tx - ox, dy = hf.heightAt(tx, tz) - oy, dz = tz - oz; const l = Math.hypot(dx, dy, dz);
    const hit = hf.raycast(ox, oy, oz, dx / l, dy / l, dz / l);
    if (!hit) { misses++; continue; }
    worst = Math.max(worst, Math.abs(hit.y - hf.heightAt(hit.x, hit.z)));
  }
  check(misses === 0 && worst < 1e-3, `200 rays hit the test map surface (misses ${misses}, max error ${worst.toExponential(2)})`);
  check(allFinite(hf), 'test map heights are finite');
}

// --- Speed of one crater (CPU only; real iPad time will differ) ---
{
  const hf = make(); hf.generate(() => 0);
  const t0 = performance.now();
  for (let n = 0; n < 200; n++) crater(hf, (n % 20) * 8 - 80, Math.floor(n / 20) * 8 - 40, 'shell');
  const ms = (performance.now() - t0) / 200;
  check(ms < 2, `shell crater costs ${ms.toFixed(3)} ms on this CPU (budget 2 ms)`);
}

done();
