// Tests for water, flooding, forests/tree damage, map format v2 trees and the river/road/tree editor tools.
// Run: node tests/world-unit.mjs
import { readFileSync } from 'node:fs';
import { Heightfield } from '../src/terrain/heightfield.js';
import { Surface, SURFACE, FEATURE } from '../src/terrain/surface.js';
import { Water, WATER } from '../src/terrain/water.js';
import { Forest, TREE, FOREST, generateTrees, newTree } from '../src/world/forest.js';
import { serializeMap, deserializeMap, FORMAT_VERSION } from '../src/maps/format.js';
import { riverStamp, roadStamp, forestStamp, eraseStamp, treeStamp, RIVER_DEPTH } from '../editor/tools/features.js';
import { TERRAIN, MAP_SIZE, TERRAIN_DAMAGE as P } from '../src/config.js';
import { checker } from './harness.mjs';

const { check, done } = checker();
const make = (fn = () => 0) => { const hf = new Heightfield({ size: MAP_SIZE, cells: TERRAIN.cells, bedrock: TERRAIN.bedrock, maxSlope: TERRAIN.maxSlope }); hf.generate(fn); return { hf, sf: new Surface(hf) }; };
const crater = (hf, x, z, w) => hf.crater(x, z, { radius: P[w].radius, depth: P[w].depth, rim: P[w].rim, erode: P[w].erode });
const k = (hf, x, z) => hf.index(Math.round(hf.gx(x)), Math.round(hf.gz(z)));

// A straight river along z at x = 0: channel 3 deep, 8 wide, banks at height 0.
function riverMap() {
  const m = make((x) => -3 * Math.max(0, 1 - Math.max(0, Math.abs(x) - 3) / 2));
  for (let j = 0; j < m.hf.verts; j++) for (let i = 0; i < m.hf.verts; i++) if (Math.abs(m.hf.wx(i)) <= 4) m.sf.features[j * m.hf.verts + i] |= FEATURE.WATER;
  return m;
}

// ---------- water level ----------
{
  const { hf, sf } = riverMap();
  const w = new Water(hf, sf);
  const lv = w.levelAt(0, 0);
  check(lv < 0 && lv > -1.2, `river level sits below the bank top (level ${lv.toFixed(2)}, bank top 0, channel floor -3)`);
  check(Math.abs(w.depthAt(0, 10) - (lv + 3)) < 0.05, `depth in the channel = level - ground (${w.depthAt(0, 10).toFixed(2)})`);
  check(w.isDeep(0, 10) && !w.isDeep(20, 10), 'channel is deep water, the field is dry');
  check(w.depthAt(20, 0) === 0 && w.levelAt(20, 0) === -Infinity, 'no water away from the river');

  // Flooding: a shell crater on the bank right next to the river fills; one far away stays dry.
  const near = crater(hf, 6.5, 0, 'shell'); const r1 = hf.rect(6.5, 0, P.shell.radius * 1.5 + 2);
  const f1 = w.flood(r1.i0, r1.j0, r1.i1, r1.j1);
  check(f1 > 20 && w.depthAt(6.5, 0) > 0.5, `shell crater beside the river floods (${f1} samples, depth at centre ${w.depthAt(6.5, 0).toFixed(2)})`);
  check(Math.abs(w.levelAt(6.5, 0) - lv) < 0.05, 'flooded crater fills to the river level');
  crater(hf, 40, 0, 'shell'); const r2 = hf.rect(40, 0, P.shell.radius * 1.5 + 2);
  check(w.flood(r2.i0, r2.j0, r2.i1, r2.j1) === 0 && w.depthAt(40, 0) === 0, 'crater far from water stays dry');
  // A chain of craters leading away from the river floods along its length.
  for (let x = 11; x <= 25; x += 3.5) { crater(hf, x, 0, 'shell'); const r = hf.rect(x, 0, 8); w.flood(r.i0, r.j0, r.i1, r.j1); }
  check(w.depthAt(18, 0) > 0.3 && w.depthAt(25, 0) > 0.1, `a chain of craters from the river floods along its length (depth at 18: ${w.depthAt(18, 0).toFixed(2)}, at 25: ${w.depthAt(25, 0).toFixed(2)})`);
  check(w.depthAt(18, 15) === 0, 'ground beside the flooded chain stays dry');
}

// ---------- a breach into a low plain floods locally, not the whole plain ----------
{
  // River at height 0 on a raised strip; the plain east of x = 12 is 2 below the river.
  const { hf, sf } = make((x) => (Math.abs(x) <= 4 ? -3 : x > 12 ? -3 : 0));
  for (let j = 0; j < hf.verts; j++) for (let i = 0; i < hf.verts; i++) if (Math.abs(hf.wx(i)) <= 4) sf.features[j * hf.verts + i] |= FEATURE.WATER;
  const w = new Water(hf, sf);
  const dry0 = w.depthAt(40, 0);
  for (let x = 6; x <= 12; x += 3) { crater(hf, x, 0, 'shell'); const r = hf.rect(x, 0, 8); w.flood(r.i0, r.j0, r.i1, r.j1); }
  check(dry0 === 0 && w.depthAt(9, 0) > 0.3, `shelling through the bank floods the breach (depth ${w.depthAt(9, 0).toFixed(2)})`);
  check(w.depthAt(60, 0) === 0 && w.depthAt(14, 80) === 0, 'but the low plain beyond is not flooded wholesale');
}

// ---------- water: a crater in an isolated hollow (no water) stays dry; lake far from banks gets a level ----------
{
  const { hf, sf } = make((x, z) => (Math.hypot(x, z) < 30 ? -2 : 0));
  for (let j = 0; j < hf.verts; j++) for (let i = 0; i < hf.verts; i++) if (Math.hypot(hf.wx(i), hf.wz(j)) < 30) sf.features[j * hf.verts + i] |= FEATURE.WATER;
  const w = new Water(hf, sf);
  check(Number.isFinite(w.levelAt(0, 0)) && w.depthAt(0, 0) > 0, `lake: the middle (far from any bank) gets water (depth ${w.depthAt(0, 0).toFixed(2)})`);
  const t0 = performance.now(); w.rebuild(); const ms = performance.now() - t0;
  check(ms < 400, `water rebuild for the whole map takes ${ms.toFixed(0)} ms here`);
}

// ---------- sample map water ----------
{
  const m = await deserializeMap(JSON.parse(readFileSync(new URL('../maps/sample.json', import.meta.url), 'utf8')));
  const w = new Water(m.hf, m.surface);
  const d = []; for (let q = 0; q < w.level.length; q++) if (w.level[q] > m.hf.h[q]) d.push(w.level[q] - m.hf.h[q]);
  d.sort((a, b) => a - b);
  check(d.length > 4000 && d[Math.floor(d.length / 2)] > WATER.shallowMax, `sample map river: ${d.length} wet samples, median depth ${d[Math.floor(d.length / 2)].toFixed(2)} (deep)`);
  check(m.trees.length > 300, `sample map has ${m.trees.length} trees`);
}

// ---------- forest generation ----------
{
  const { hf, sf } = make();
  for (let j = 0; j < hf.verts; j++) for (let i = 0; i < hf.verts; i++) {
    const x = hf.wx(i), z = hf.wz(j), q = j * hf.verts + i;
    if (x > -50 && x < -10 && z > -20 && z < 20) sf.features[q] |= FEATURE.FOREST;
    if (x > 10 && x < 50 && z > -20 && z < 20) sf.features[q] |= FEATURE.TREES;
    if (x > -30 && x < -26) sf.features[q] |= FEATURE.WATER;          // a stream through the forest
  }
  const trees = generateTrees(hf, sf);
  const dense = trees.filter(t => t.x < 0).length, sparse = trees.filter(t => t.x > 0).length;
  check(dense > 150 && sparse > 15 && dense > sparse * 4, `dense forest is denser than scattered trees (${dense} vs ${sparse} in equal areas)`);
  check(!trees.some(t => t.x > -29.6 && t.x < -26.4), 'no trees in water');
  check(JSON.stringify(generateTrees(hf, sf)) === JSON.stringify(trees), 'tree placement is deterministic');
}

// ---------- tree damage ----------
{
  const trees = []; for (let x = -20; x <= 20; x += 2.5) for (let z = -20; z <= 20; z += 2.5) trees.push(newTree(x, z));
  const f = new Forest(trees, 256, 7);
  f.blast(0, 0, { fallR: 6.5, ignite: 0 });
  const at = (x, z) => f.trees[f.near(x, z, 0.1)[0]];
  check(at(0, 0).state === TREE.STUMP && at(2.5, 0).state === TREE.STUMP, 'trees at the blast centre are shattered to stumps');
  const fallen = at(5, 0);
  check(fallen.state === TREE.FALLEN && Math.abs(fallen.dir - 0) < 1e-6, 'trees further out are knocked flat, falling away from the blast');
  check(at(-5, 0).state === TREE.FALLEN && Math.abs(Math.abs(at(-5, 0).dir) - Math.PI) < 1e-6, '... in every direction');
  check(at(10, 0).state === TREE.STANDING, 'trees outside the blast stay standing');
  check(f.changed.size > 0, 'damaged trees are reported to the renderer');

  // Fires: over 10 seeds, a single burning tree should sometimes spread, never take everything, and always end.
  const results = [];
  for (let seed = 1; seed <= 10; seed++) {
    const g = new Forest(trees.map(t => newTree(t.x, t.z)), 256, seed);
    g.ignite(g.near(0, 0, 0.1)[0]);
    let burnt = 0;
    for (let s = 0; s < 600 * 10 && (s < 10 || g.burning.size); s++) burnt += g.update(0.1).length;
    results.push({ burnt, stumps: g.counts().stump, left: g.burning.size });
  }
  const burnt = results.map(r => r.burnt).sort((a, b) => a - b);
  check(burnt[9] > 5, `fire spreads to neighbours (largest fire of 10: ${burnt[9]} trees)`);
  check(burnt[5] < trees.length * 0.5, `a single tree fire does not usually take the whole wood (median ${burnt[5]} of ${trees.length})`);
  check(results.every(r => r.left === 0 && r.stumps === r.burnt), 'every fire burns out (within 10 minutes), leaving stumps');
  const h = new Forest(trees.map(t => newTree(t.x, t.z)), 256, 1);
  const n = h.crush(0, 0, 3, Math.PI / 2);
  check(n > 0 && h.trees[h.near(0, 0, 0.1)[0]].state === TREE.FALLEN, `crush() knocks trees flat (${n}) for Titans later`);
  check(h.coverAt(15, 15) > h.coverAt(0, 0), 'cover is higher in intact forest than in a flattened patch');
}

// ---------- map format v2: trees round trip; v1 maps get generated trees ----------
{
  const { hf, sf } = make();
  for (let q = 0; q < sf.features.length; q += 1) if (hf.wx(q % hf.verts) < -60) sf.features[q] |= FEATURE.FOREST;
  const trees = [{ x: 1.23, z: -4.56, s: 1.1, t: 1 }, { x: -100.5, z: 99.99, s: 0.85, t: 0 }];
  const json = await serializeMap({ name: 't', hf, surface: sf, markers: {}, trees });
  check(json.formatVersion === FORMAT_VERSION && FORMAT_VERSION === 2, 'maps are saved as formatVersion 2');
  const m = await deserializeMap(JSON.parse(JSON.stringify(json)));
  check(JSON.stringify(m.trees) === JSON.stringify(trees), `tree list survives save/load (${JSON.stringify(m.trees)})`);
  const v1 = { ...json, formatVersion: 1 }; delete v1.trees;
  const m1 = await deserializeMap(JSON.parse(JSON.stringify(v1)));
  check(m1.trees.length > 100 && m1.trees.every(t => t.x < -59), `a v1 map (no tree list) is upgraded with trees generated from its forest areas (${m1.trees.length})`);
}

// ---------- editor tools ----------
{
  const { hf, sf } = make((x, z) => z * 0.05);
  const before = Float32Array.from(hf.h);
  for (let z = -40; z <= 40; z += 1) riverStamp(hf, sf, 0, z, 4, before);
  for (let z = -40; z <= 40; z += 1) riverStamp(hf, sf, 0, z, 4, before);     // second pass: no deeper
  const drop = before[k(hf, 0, 10)] - hf.h[k(hf, 0, 10)];
  check(Math.abs(drop - RIVER_DEPTH) < 0.01, `river tool carves ${RIVER_DEPTH} below the original ground, following its slope, and repeat passes don't dig deeper (${drop.toFixed(3)})`);
  check(sf.features[k(hf, 0, 10)] & FEATURE.WATER, 'river tool marks water');
  const w = new Water(hf, sf);
  check(w.depthAt(0, 10) > 1 && w.levelAt(0, -30) < w.levelAt(0, 30), `drawn river holds water that follows the slope (level ${w.levelAt(0, -30).toFixed(2)} -> ${w.levelAt(0, 30).toFixed(2)})`);

  const g = make((x, z) => Math.sin(x / 2) * 1.5 + Math.cos(z / 3));
  const f = new Forest([newTree(30, 0), newTree(30, 3), newTree(30, 9)], 256);
  const gb = Float32Array.from(g.hf.h);
  for (let z = -20; z <= 20; z += 0.5) roadStamp(g.hf, g.sf, 30, z, 2, gb, f);
  for (let z = -20; z <= 20; z += 0.5) roadStamp(g.hf, g.sf, 30, z, 2, Float32Array.from(g.hf.h), f);
  let bump = 0; for (let z = -10; z < 10; z += 0.5) bump = Math.max(bump, Math.abs(g.hf.heightAt(30, z + 0.5) - g.hf.heightAt(30, z)));
  check(g.sf.base[k(g.hf, 30, 5)] === SURFACE.ROAD, 'road tool paints road');
  check(bump < 0.3, `road tool flattens bumps along the road (max step ${bump.toFixed(3)} per 0.5 units)`);
  check(f.trees.length === 0, 'road tool clears trees on the road');

  const e = make();
  const fe = new Forest([], 256, 2);
  forestStamp(e.hf, e.sf, 0, 0, 10, fe, 200);
  const n1 = fe.trees.length;
  let minGap = Infinity; for (const a of fe.trees) for (const b of fe.trees) if (a !== b) minGap = Math.min(minGap, Math.hypot(a.x - b.x, a.z - b.z));
  check(n1 > 15 && minGap >= FOREST.denseSpacing * 0.8 - 1e-6, `forest spray adds trees with spacing (${n1} trees, closest ${minGap.toFixed(2)})`);
  check(treeStamp(e.hf, e.sf, 50, 50, fe) && fe.trees.length === n1 + 1, 'tree tool places a single tree');
  check(!treeStamp(e.hf, e.sf, 50, 50.5, fe), 'tree tool will not place a tree on top of another');
  eraseStamp(e.hf, e.sf, 0, 0, 12, fe);
  check(fe.trees.length === 1 && !(e.sf.features[k(e.hf, 0, 0)] & FEATURE.FOREST), 'erase removes trees and forest tint');
}

done();
