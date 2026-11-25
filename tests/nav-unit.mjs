// Tests for the nav grid, A* paths and unit movement (pure modules, run in Node).
// Run: node tests/nav-unit.mjs
import { readFileSync } from 'node:fs';
import { Heightfield } from '../src/terrain/heightfield.js';
import { Surface, SURFACE, FEATURE } from '../src/terrain/surface.js';
import { Water } from '../src/terrain/water.js';
import { Forest, newTree } from '../src/world/forest.js';
import { Buildings, addRubble } from '../src/world/buildings.js';
import { Damage } from '../src/combat/damage.js';
import { NavGrid, NAV_CLASSES } from '../src/nav/navgrid.js';
import { PathFinder } from '../src/nav/pathfinding.js';
import { Movers } from '../src/units/movers.js';
import { deserializeMap } from '../src/maps/format.js';
import { TERRAIN, MAP_SIZE } from '../src/config.js';
import { checker } from './harness.mjs';

const { check, done } = checker();
const S = 0, M = 1, L = 2;
function world(fn = () => 0, { river = null, trees = [], buildings = [], road = null } = {}) {
  const hf = new Heightfield({ size: MAP_SIZE, cells: TERRAIN.cells, bedrock: TERRAIN.bedrock, maxSlope: TERRAIN.maxSlope });
  hf.generate(fn);
  const surface = new Surface(hf);
  for (let j = 0; j < hf.verts; j++) for (let i = 0; i < hf.verts; i++) {
    const x = hf.wx(i), z = hf.wz(j), k = j * hf.verts + i;
    if (river && river(x, z)) surface.features[k] |= FEATURE.WATER;
    if (road && road(x, z)) surface.base[k] = SURFACE.ROAD;
  }
  const w = { hf, surface, water: new Water(hf, surface), forest: new Forest(trees, MAP_SIZE, 1) };
  w.buildings = new Buildings(buildings, hf);
  w.nav = new NavGrid(w);
  w.pf = new PathFinder(w.nav);
  return w;
}
const pathLen = p => p.points.reduce((s, q, i) => i ? s + Math.hypot(q.x - p.points[i - 1].x, q.z - p.points[i - 1].z) : 0, 0);
const run = (mv, secs, until = () => false) => { let t = 0; for (; t < secs && !until(); t += 1 / 60) { mv.grid.update(); mv.grid.update(); mv.step(1 / 60); } return t; };

// ---------- gaps by unit size ----------
for (const gap of [4, 8]) {
  // A line of walls across the map at z = 0 with one gap of `gap` units at x = 0.
  const walls = [];
  for (let k = 0; k < 13; k++) { const off = gap / 2 + 5 + 10 * k; walls.push({ type: 'wall', x: off, z: 0, rot: 0 }, { type: 'wall', x: -off, z: 0, rot: 0 }); }
  const w = world(() => 0, { buildings: walls });
  const through = c => { const p = w.pf.find(c, 0, -20, 0, 20); return p.reached && pathLen(p) < 60; };
  const res = [S, M, L].map(through);
  const want = gap === 4 ? [true, false, false] : [true, true, true];
  check(res.join() === want.join(), `${gap}-unit gap in a wall: Scout ${res[0] ? 'passes' : 'blocked'}, Assault ${res[1] ? 'passes' : 'blocked'}, Titan ${res[2] ? 'passes' : 'blocked'}`);
}

// ---------- river, ford, bridge ----------
{
  // River along z at x in [-6, 6], 3 deep; a shallow ford at z in [60, 70].
  const w = world((x, z) => (Math.abs(x) <= 6 ? (z > 60 && z < 70 ? -0.6 : -3) : 0), { river: (x) => Math.abs(x) <= 6 });
  check(!w.nav.passable(M, 0, 0) && w.nav.passable(M, 0, 65), 'deep river blocks, the ford is passable');
  check(w.nav.costAt(M, 0, 65) > 2 * w.nav.costAt(M, 20, 65), `shallow water is slow (cost ${w.nav.costAt(M, 0, 65).toFixed(2)} vs ${w.nav.costAt(M, 20, 65).toFixed(2)})`);
  const viaFord = w.pf.find(M, -20, 0, 20, 0);
  check(viaFord.reached && pathLen(viaFord) > 120, `without a bridge, the path crosses at the ford (length ${pathLen(viaFord).toFixed(0)})`);
  // Add a bridge at z = 0.
  w.buildings = new Buildings([{ type: 'bridge', x: 0, z: 0, rot: 0, len: 20, drop: 4, y: 0.3 }], w.hf);
  w.nav.markDirty(0, 0, 14); w.nav.flush();
  const viaBridge = w.pf.find(M, -20, 0, 20, 0);
  check(viaBridge.reached && pathLen(viaBridge) < 45 && w.nav.standHeight(0, 0) > 0, `with a bridge, the path goes straight over it (length ${pathLen(viaBridge).toFixed(0)}, deck height ${w.nav.standHeight(0, 0).toFixed(2)})`);
  check(w.pf.find(L, -20, 0, 20, 0).reached && pathLen(w.pf.find(L, -20, 0, 20, 0)) < 45, 'Titans fit over the bridge too');
  // Destroy the bridge pillars: the middle falls and the route goes back to the ford.
  w.buildings.pieces.forEach((p, i) => { if (p.role === 'pillar') w.buildings.destroy(i); });
  w.nav.markDirty(0, 0, 14); w.nav.flush();
  const after = w.pf.find(M, -20, 0, 20, 0);
  check(after.reached && pathLen(after) > 120, `destroying the bridge sends the route back to the ford (length ${pathLen(after).toFixed(0)})`);
}

// ---------- roads, slopes, forest ----------
{
  // Road along x = 30 from z = -60 to 60; goal straight north. The road path is a little longer but cheaper.
  const w = world(() => 0, { road: (x, z) => Math.abs(x - 12) < 2 });
  const p = w.pf.find(M, 0, -60, 0, 60);
  const onRoad = p.points.filter(q => Math.abs(q.x - 12) < 2).length;
  check(onRoad >= 2, `paths use a nearby road (${onRoad} waypoints on it)`);
  check(w.nav.costAt(M, 12, 0) < w.nav.costAt(M, 0, 0), 'intact road is cheaper than grass');
  const dmg = new Damage({ hf: w.hf, surface: w.surface });
  dmg.explode(12, 0, 'shell'); w.nav.markSamples(0, 0, w.hf.verts - 1, w.hf.verts - 1); w.nav.flush();
  check(w.nav.costAt(M, 12, 0) > w.nav.costAt(M, 12, 30), 'a crater breaks the road: no road bonus there');
}
{
  // A hill with 0.9 slopes: too steep for Titans (max 0.8), fine for Assaults (1.0) and Scouts.
  const w = world((x, z) => Math.max(0, 18 - 0.9 * Math.hypot(x, z)));
  check(w.nav.costAt(L, 10, 0) > 5 * w.nav.costAt(M, 10, 0), `a 0.9 slope is a slow scramble for Titans (cost ${w.nav.costAt(L, 10, 0).toFixed(1)} vs Assault ${w.nav.costAt(M, 10, 0).toFixed(1)})`);
  const lp = w.pf.find(L, -40, 0, 40, 0);
  check(lp.reached && Math.min(...lp.points.map(q => Math.hypot(q.x, q.z))) > 15, `Titans go round the hill (closest approach ${Math.min(...lp.points.map(q => Math.hypot(q.x, q.z))).toFixed(1)})`);
  const cliff = world((x) => (x > 0 ? 30 : 0) * Math.min(1, Math.max(0, x / 10)));     // a 3:1 cliff
  check(!cliff.nav.passable(S, 5, 0), 'a cliff steeper than 1.9 blocks everyone');
}
{
  const trees = [];
  for (let x = -30; x <= 30; x += 2.6) for (let z = -10; z <= 10; z += 2.6) trees.push(newTree(x, z));
  const w = world(() => 0, { trees });
  check(w.nav.passable(S, 0.6, 1.3) && !w.nav.passable(M, 0.6, 1.3) && w.nav.passable(L, 0.6, 1.3), 'dense forest: Scouts and Titans get in, Assaults do not');
  check(w.nav.costAt(S, 0.6, 1.3) > w.nav.costAt(S, 0, 40) * 1.3, `forest slows Scouts (cost ${w.nav.costAt(S, 0.6, 1.3).toFixed(2)} vs ${w.nav.costAt(S, 0, 40).toFixed(2)})`);
  // Knock the trees flat: the way opens.
  w.forest.blast(0, 0, { fallR: 40 }); w.nav.markDirty(0, 0, 40); w.nav.flush();
  check(w.nav.passable(M, 0.6, 1.3), 'flattened forest no longer blocks Assaults');
}

// ---------- incremental updates match a full rebuild ----------
{
  const m = await deserializeMap(JSON.parse(readFileSync(new URL('../maps/sample.json', import.meta.url), 'utf8')));
  const w = { hf: m.hf, surface: m.surface, water: new Water(m.hf, m.surface), forest: new Forest(Forest.fromSnapshot(m.trees), MAP_SIZE), buildings: new Buildings(m.buildings, m.hf) };
  const t0 = performance.now();
  w.nav = new NavGrid(w);
  const buildMs = performance.now() - t0;
  m.hf.onChange((i0, j0, i1, j1) => w.nav.markSamples(i0, j0, i1, j1));
  w.water.onChange((i0, j0, i1, j1) => w.nav.markSamples(i0, j0, i1, j1));
  const dmg = new Damage(w);
  let s = 3; const rnd = () => (s = (s * 16807) % 2147483647) / 2147483647;
  const house = w.buildings.list.find(b => b.def.type === 'house').def, br = w.buildings.list.find(b => b.def.type === 'bridge').def;
  for (let n = 0; n < 40; n++) dmg.explode((rnd() - 0.5) * 220, (rnd() - 0.5) * 220, ['cannon', 'shell'][n % 2]);
  for (let n = 0; n < 6; n++) dmg.explode(house.x + rnd() * 4 - 2, house.z, 'shell', 3);
  for (let n = 0; n < 4; n++) dmg.explode(br.x, br.z, 'shell', br.y ?? 0);
  w.nav.flush();
  const fresh = new NavGrid(w);
  let diff = 0;
  for (let c = 0; c < 3; c++) for (let k = 0; k < fresh.cost[c].length; k++) if (fresh.cost[c][k] !== w.nav.cost[c][k]) diff++;
  check(diff === 0, `after 50 explosions (craters, a destroyed house, a broken bridge), incremental nav updates match a full rebuild (${diff} cells differ)`);
  check(buildMs < 1500, `full nav build of the sample map: ${buildMs.toFixed(0)} ms here`);
  const pf = new PathFinder(w.nav);
  const t1 = performance.now();
  for (let n = 0; n < 20; n++) pf.find(n % 3, -100 + n, 110, 100 - n, -110);
  check((performance.now() - t1) / 20 < 60, `a corner-to-corner path takes ${((performance.now() - t1) / 20).toFixed(1)} ms here`);
}

// ---------- movers: re-plan around new craters, never stuck ----------
{
  const w = world();
  w.hf.onChange((i0, j0, i1, j1) => w.nav.markSamples(i0, j0, i1, j1));
  const mv = new Movers(w.nav), dmg = new Damage(w);
  const u = mv.add(0, -80, L);
  mv.order([u], 0, 80);
  run(mv, 3);
  // A deep pit right across the route ahead (Titans can't climb out of steep craters).
  for (let x = -14; x <= 14; x += 2) w.hf.crater(x, -40, { radius: 3, depth: 6, rim: 0.2, erode: 0 });
  const r0 = mv.stats.replans;
  run(mv, 120, () => u.state === 'idle');
  check(mv.stats.replans > r0, `a new obstacle on the route makes the unit re-plan (${mv.stats.replans - r0} re-plans)`);
  check(u.state === 'idle' && Math.hypot(u.x, u.z - 80) < 2, `the Titan goes round and arrives (${u.x.toFixed(1)}, ${u.z.toFixed(1)})`);
}
{
  // Shell units while they move, and bury one in rubble: they must never stay stuck.
  const w = world((x, z) => Math.sin(x / 9) * 2 + Math.cos(z / 7) * 2);
  w.hf.onChange((i0, j0, i1, j1) => w.nav.markSamples(i0, j0, i1, j1));
  const mv = new Movers(w.nav), dmg = new Damage(w);
  const units = [];
  for (let k = 0; k < 9; k++) units.push(mv.add(-60 + (k % 3) * 8, -60 + Math.floor(k / 3) * 8, k % 3));
  mv.order(units, 60, 60);
  let stuckMax = 0, t = 0;
  const blockedFor = new Map();
  for (let step = 0; step < 60 * 90; step++) {
    if (step % 30 === 0 && step < 60 * 40) {
      const v = units[(step / 30) % units.length];
      dmg.explode(v.x + 0.5, v.z, 'shell');                                     // a shell lands right on a unit
    }
    if (step === 60 * 10) addRubble(w.hf, w.surface, { x: units[4].x, z: units[4].z, r: 5, h: 3 });   // rubble heap on another
    w.nav.update(); w.nav.update();
    mv.step(1 / 60); t += 1 / 60;
    for (const v of units) {
      const b = w.nav.passable(v.cls, v.x, v.z) ? 0 : (blockedFor.get(v) || 0) + 1 / 60;
      blockedFor.set(v, b); stuckMax = Math.max(stuckMax, b);
    }
    if (units.every(v => v.state === 'idle') && step > 60 * 41) break;
  }
  const finite = units.every(v => Number.isFinite(v.x) && Number.isFinite(v.z) && Number.isFinite(v.y));
  const arrived = units.filter(v => Math.hypot(v.x - 60, v.z - 60) < 20).length;
  check(finite, 'no NaN positions while being shelled');
  check(stuckMax < 3, `no unit stays on impassable ground for long (longest ${stuckMax.toFixed(2)} s, ${mv.stats.escapes} escapes)`);
  check(arrived === units.length, `all ${units.length} shelled units still reach the target area (${arrived})`);
}
{
  // A group of 30 arrives without piling on top of each other.
  const w = world();
  const mv = new Movers(w.nav), units = [];
  for (let k = 0; k < 30; k++) units.push(mv.add(-80 + (k % 6) * 6, -80 + Math.floor(k / 6) * 6, k % 3));
  mv.order(units, 50, 50);
  const t = run(mv, 120, () => units.every(u => u.state === 'idle'));
  let minGap = Infinity;
  for (let a = 0; a < units.length; a++) for (let b = a + 1; b < units.length; b++) {
    const A = units[a], B = units[b];
    minGap = Math.min(minGap, Math.hypot(A.x - B.x, A.z - B.z) - A.radius - B.radius);
  }
  check(units.every(u => u.state === 'idle') && t < 60, `30 units arrive in ${t.toFixed(1)} s`);
  check(minGap > -0.6, `they spread out at the destination (closest pair overlap ${(-minGap).toFixed(2)})`);
}
{
  // Unreachable goal (an island in a lake): go to the closest shore and stop, without looping.
  const w = world((x, z) => (Math.hypot(x, z) < 30 && Math.hypot(x, z) > 8 ? -3 : 0), { river: (x, z) => Math.hypot(x, z) < 30 && Math.hypot(x, z) > 8 });
  const mv = new Movers(w.nav), u = mv.add(-60, 0, M);
  mv.order([u], 0, 0);
  run(mv, 40, () => u.state === 'idle' && !u.goal);
  check(u.state === 'idle' && Math.hypot(u.x, u.z) < 36 && mv.stats.paths < 6, `unreachable island: the unit stops at the nearest shore (${Math.hypot(u.x, u.z).toFixed(1)} from centre, ${mv.stats.paths} path searches)`);
}

done();
