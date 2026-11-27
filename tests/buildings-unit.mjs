// Tests for buildings, bridges, rubble and map format v3 (pure modules, run in Node).
// Run: node tests/buildings-unit.mjs
import { readFileSync } from 'node:fs';
import { Heightfield } from '../src/terrain/heightfield.js';
import { Surface, SURFACE, FEATURE } from '../src/terrain/surface.js';
import { Water } from '../src/terrain/water.js';
import { Buildings, BUILDING_DAMAGE, BUILDING, blueprint, addRubble, flattenFootprint, fitBridge, autoBridges, fillLots, footprintHeight } from '../src/world/buildings.js';
import { Damage } from '../src/combat/damage.js';
import { serializeMap, deserializeMap, FORMAT_VERSION } from '../src/maps/format.js';
import { TERRAIN, MAP_SIZE } from '../src/config.js';
import { checker } from './harness.mjs';

const { check, done } = checker();
const make = (fn = () => 0) => { const hf = new Heightfield({ size: MAP_SIZE, cells: TERRAIN.cells, bedrock: TERRAIN.bedrock, maxSlope: TERRAIN.maxSlope }); hf.generate(fn); return { hf, sf: new Surface(hf) }; };
const D = BUILDING_DAMAGE;

// ---------- house: holes, support, roof collapse, ruin, rubble ----------
{
  const { hf, sf } = make(() => 2);
  const B = new Buildings([{ type: 'house', x: 10, z: 20, rot: 0 }], hf);
  const b = B.list[0], ps = () => B.piecesOf(b);
  check(Math.abs(b.y - 2) < 1e-6 && b.state === 'intact', `house sits on the ground (base ${b.y}) and starts intact`);
  const walls = ps().filter(p => p.role === 'wall');
  check(walls.length === 28 && ps().filter(p => p.role === 'roof').length === 2 && ps().filter(p => p.role === 'strut').length === 4,
    `house is built from ${ps().length} pieces (floor, 28 wall panels in 2 rows round a chamfered plan, roof slab and cap, buttresses, antenna, vent, light)`);
  check(walls.every(p => p.kind === 'batter') && new Set(walls.map(p => Math.round(p.rot * 100))).size === 8, 'its walls are sloped panels facing 8 ways (chamfered corners)');
  // Knock out one lower wall tile on the south side: the tile above it falls too.
  const lower = ps().findIndex(p => p.role === 'wall' && p.py < 4 && p.pz < 18);
  const upper = ps().findIndex(p => p.supports.includes(b.first + lower));
  B.destroy(b.first + lower);
  check(!ps()[upper].alive && ps().filter(p => !p.alive && p.role === 'wall').length === 2 && b.state === 'damaged', 'destroying a lower wall tile brings down the tile above it (a hole), house is "damaged"');
  check(B.changed.size >= 2 && B.falling.length >= 2, 'destroyed pieces are reported to the renderer and fall');
  // One cannon hit on a wall: some damage, not a collapse.
  const before = ps().filter(p => p.alive).length;
  B.blast(14, 3, 20, D.cannon);
  const after = ps().filter(p => p.alive).length;
  check(after < before && after > 15, `a cannon hit on a wall breaks a few tiles (${before} -> ${after} pieces standing)`);
  // MG fire only chips.
  const c0 = ps().filter(p => p.alive).length;
  B.blast(6, 1, 17, D.mg);
  check(ps().filter(p => p.alive).length === c0, 'one machine-gun burst does not destroy a wall tile');
  // Shell the house until the roof falls and it is a ruin, then rubble.
  const states = [];
  for (let n = 0; n < 12 && b.state !== 'rubble'; n++) { B.blast(10 + (n % 3 - 1) * 3, 3, 20 + (n % 2 ? 2 : -2), D.shell); states.push(b.state); }
  check(states.includes('ruin') && b.state === 'rubble', `sustained shelling: ${[...new Set(states)].join(' -> ')}`);
  check(ps().every(p => !p.alive), 'a rubble pile has no standing pieces');
}

// ---------- each panel: blast marks -> broken (hole, framework) -> blown away; rubble piles up ----------
{
  const { hf } = make();
  const B = new Buildings([{ type: 'house', x: 0, z: 0, rot: 0.4 }], hf);
  // A lower wall panel on the south side, hit from outside.
  const i = B.pieces.findIndex(p => p.role === 'wall' && p.kind === 'batter' && p.py < 1.5 && p.pz < -2.5 && Math.abs(p.px) < 1.5);
  const p = B.pieces[i], c = Math.cos(p.rot), s = Math.sin(p.rot);
  const out = (d) => [p.px - s * d, p.py, p.pz - c * d];     // d units out from the panel, on its outside
  const [x, y, z] = out(1.2);
  B.blast(x, y, z, D.autocannon);
  check(p.alive && p.marks.length === 1 && !p.brk, `1. a hit leaves a blast mark (${p.marks.map(m => m.map(v => v.toFixed(2)).join(', '))}), the panel still whole (${p.hp.toFixed(0)}/${p.maxHp} hp)`);
  check(p.marks[0][2] < -p.sz / 2 + 0.01, 'the mark is on the outside face, where it was hit');
  const chips0 = B.chunks.length;
  let n = 0;
  while (p.alive && !p.brk && n < 20) { B.blast(x + (n % 3 - 1) * 0.6, y + 0.3, z, D.autocannon); n++; }
  check(p.alive && p.brk && p.hp < p.maxHp * BUILDING.brokenFrac && B.brokenChanged, `2. below half strength it is broken: a jagged hole (radius ${p.brk && p.brk[2].toFixed(2)}) showing its framework`);
  check(p.marks.length >= 2 && p.marks.length <= 4, `more hits, more marks (${p.marks.length}, at most 4 per panel)`);
  while (p.alive && n < 40) { B.blast(x, y + 0.3, z, D.autocannon); n++; }
  check(!p.alive, `3. then it is blown away (${n} autocannon hits in all)`);
  const chips = B.chunks.slice(chips0).filter(k => k.alive && k.s < 0.35);
  const side = chips.every(k => ((k.x - p.px) * s + (k.z - p.pz) * c) < 0);
  check(chips.length >= 10 && side, `as it took damage, ${chips.length} chips of it fell at the foot of the wall, on the side that was hit`);
  check(Math.max(...chips.map(k => k.lift)) > 0.2, `and they pile up (highest ${Math.max(...chips.map(k => k.lift)).toFixed(2)} above the ground)`);
  check(chips.every(k => Math.hypot(k.x - p.px, k.z - p.pz) < p.sx / 2 + 2.5), 'close to the wall');
  // Roof slabs break across their top; buttresses and details never show holes.
  const roof = B.pieces.find(q => q.role === 'roof' && q.alive);
  B.blast(roof.px + 1, roof.py + 0.6, roof.pz, { power: roof.hp * 0.6, radius: 2 });
  check(roof.brk && roof.brk[3] < 0, 'a roof slab can be broken too (holed from above)');
}

// ---------- roof rests on the top row of walls ----------
{
  const { hf } = make();
  const B = new Buildings([{ type: 'house', x: 0, z: 0, rot: 0.7 }], hf);
  const b = B.list[0], roof = B.pieces.findIndex(p => p.role === 'roof');
  const top = B.pieces[roof].supports;
  for (let k = 0; k < Math.floor(top.length / 2) - 1; k++) B.destroy(top[k]);
  check(B.pieces[roof].alive, `roof stays up with ${top.length - (Math.floor(top.length / 2) - 1)} of ${top.length} top tiles left`);
  B.destroy(top[Math.floor(top.length / 2)]); B.destroy(top[Math.floor(top.length / 2) + 1]);
  check(!B.pieces[roof].alive && b.state === 'ruin', 'roof falls when fewer than half its supporting walls remain (house is a ruin)');
}

// ---------- rubble mound ----------
{
  const { hf, sf } = make();
  const B = new Buildings([{ type: 'house', x: 0, z: 0, rot: 0 }], hf);
  let rubble = [];
  for (let i = 0; i < B.pieces.length; i++) rubble.push(...B.destroy(i));
  let vol = 0; for (const p of B.pieces) vol += p.sx * p.sy * p.sz * BUILDING.rubbleBulk;
  for (const r of rubble) addRubble(hf, sf, r);
  let added = 0; for (const v of hf.h) added += v * hf.spacing * hf.spacing;
  check(Math.abs(added - vol) / vol < 0.25, `collapsed house leaves a rubble mound of about its volume (${added.toFixed(0)} vs ${vol.toFixed(0)} cubic units)`);
  check(hf.heightAt(0, 0) > 0.8, `the mound stands ${hf.heightAt(0, 0).toFixed(2)} units high in the middle (cover and an obstacle)`);
  check(sf.base[hf.index(Math.round(hf.gx(0)), Math.round(hf.gz(0)))] === SURFACE.RUBBLE, 'the mound is painted as rubble');
  check(B.chunks.length > 20, `loose rubble chunks are scattered (${B.chunks.length})`);
  B.clearChunks(0, 0, 3);
  check(B.chunks.some(c => !c.alive) && B.chunks.some(c => c.alive), 'a crater clears the chunks inside it only');
}

// ---------- bunker toughness ----------
{
  const { hf } = make();
  const B = new Buildings([{ type: 'bunker', x: 0, z: 0, rot: 0 }], hf);
  B.blast(4.5, 1, 0, D.shell);
  check(B.list[0].state !== 'rubble' && B.pieces.filter(p => p.alive).length === B.pieces.length, 'one shell does not break a bunker block');
  let n = 0; while (B.list[0].state !== 'rubble' && n < 30) { B.blast(n % 2 ? 4.5 : -4.5, 1, 0, D.shell); n++; }
  check(n >= 6 && B.list[0].state === 'rubble', `a bunker takes ${n} shells to destroy`);
}

// ---------- obstacles ----------
{
  const { hf } = make();
  const B = new Buildings([{ type: 'wall', x: 0, z: 0, rot: Math.PI / 2 }], hf);
  check(B.blockedAt(0, 3) && !B.blockedAt(3, 0) && !B.blockedAt(0, 20), 'a wall turned 90° blocks along z, not across x');
  for (let i = 0; i < B.pieces.length; i++) B.destroy(i);
  check(!B.blockedAt(0, 3), 'a destroyed wall no longer blocks (its rubble does, through the terrain)');
  const H = new Buildings([{ type: 'house', x: 30, z: 0, rot: 0 }], hf);
  check(H.at(31, 1) === 0 && H.at(40, 0) === -1, 'at() finds the building whose footprint contains a point');
}

// ---------- river, bridges ----------
function riverMap() {
  const m = make((x) => (Math.abs(x) <= 6 ? -3 : 0));
  for (let j = 0; j < m.hf.verts; j++) for (let i = 0; i < m.hf.verts; i++) if (Math.abs(m.hf.wx(i)) <= 6) m.sf.features[j * m.hf.verts + i] |= FEATURE.WATER;
  return m;
}
{
  const { hf, sf } = riverMap();
  const w = new Water(hf, sf);
  const def = fitBridge(hf, w, 0.3, 10);
  check(def && Math.abs(Math.cos(def.rot)) > 0.99 && def.len > 12 && def.len < 22, `bridge fits across a river running north-south (rot ${def.rot.toFixed(2)}, length ${def.len})`);
  const B = new Buildings([def], hf);
  const top = B.deckAt(0, 10);
  check(top !== null && top > w.levelAt(0, 10) + 1, `deck is walkable above the water (deck ${top.toFixed(2)}, water ${w.levelAt(0, 10).toFixed(2)})`);
  check(B.deckAt(0, 15) === null, 'no deck beside the bridge');
  const pillars = B.pieces.map((p, i) => p.role === 'pillar' ? i : -1).filter(i => i >= 0);
  for (const i of pillars) B.destroy(i);
  check(B.deckAt(0, 10) === null && B.list[0].state === 'broken', 'destroying the pillars drops the middle of the bridge: crossing cut');
  check(B.pieces.some(p => p.role === 'deck' && p.alive), 'bank-end deck segments stay');
  // Auto bridges where a road crosses the river.
  for (let j = 0; j < hf.verts; j++) for (let i = 0; i < hf.verts; i++) if (Math.abs(hf.wz(j) - 40) < 2) sf.base[j * hf.verts + i] = SURFACE.ROAD;
  const auto = autoBridges(hf, sf, w);
  check(auto.length === 1 && Math.abs(auto[0].z - 40) < 1.5 && Math.abs(Math.cos(auto[0].rot)) > 0.99, `a road across the river gets one bridge along the road (${JSON.stringify(auto.map(a => [a.x.toFixed(1), a.z.toFixed(1), a.rot.toFixed(2)]))})`);
}

// ---------- lots and placement ----------
{
  const { hf, sf } = make((x, z) => Math.sin(x / 7) + Math.cos(z / 5));
  for (let j = 0; j < hf.verts; j++) for (let i = 0; i < hf.verts; i++) {
    const x = hf.wx(i), z = hf.wz(j);
    if (x > -40 && x < -10 && z > 0 && z < 14) sf.features[j * hf.verts + i] |= FEATURE.BUILDING;   // street lot
    if (x > 20 && x < 44 && z > 0 && z < 18) sf.features[j * hf.verts + i] |= FEATURE.BUILDING;    // big lot
  }
  const defs = fillLots(hf, sf);
  const houses = defs.filter(d => d.type === 'house'), factories = defs.filter(d => d.type === 'factory');
  check(houses.length >= 2 && factories.length === 1, `fill lots: ${houses.length} houses on the street lot, ${factories.length} factory on the big lot`);
  const B = new Buildings(defs, hf);
  let overlap = false;
  for (const a of B.list) for (const b of B.list) if (a !== b && Math.abs(a.def.x - b.def.x) < 8.5 && Math.abs(a.def.z - b.def.z) < 6.5) overlap = true;
  check(!overlap, 'filled buildings do not overlap');
  check(fillLots(hf, sf, defs).length === 0, 'filling again adds nothing');
  flattenFootprint(hf, houses[0]);
  const y = footprintHeight(hf, houses[0]);
  let worst = 0; for (const [u, v] of [[-3.9, -2.9], [3.9, 2.9], [0, 0], [3.9, -2.9]]) worst = Math.max(worst, Math.abs(hf.heightAt(houses[0].x + u, houses[0].z + v) - y));
  check(worst < 0.01, `placement levels the ground under the footprint (max difference ${worst.toFixed(4)})`);
}

// ---------- damage.js integration ----------
{
  const { hf, sf } = make();
  const B = new Buildings([{ type: 'house', x: 0, z: 0, rot: 0 }], hf);
  const dmg = new Damage({ hf, surface: sf, buildings: B });
  const roofY = B.pieces.find(p => p.role === 'roof').py;
  const hit = dmg.explode(0, 0, 'shell', roofY);
  check(hit.pieces > 0 && hf.heightAt(0, 0) >= 0, `a shell on the roof breaks pieces (${hit.pieces}) without cratering the ground under the house`);
  const h2 = dmg.explode(0, 6, 'shell');
  check(h2.y1 < h2.y0, 'a shell on the ground beside it still craters the ground');
}

// ---------- map format v3 ----------
{
  const { hf, sf } = make();
  const buildings = [{ type: 'house', x: 1.5, z: -2.25, rot: 0.5 }, { type: 'bridge', x: 3, z: 4, rot: 1.2, len: 14.5, drop: 3.2, y: -0.75 }, { type: 'castle', x: 0, z: 0 }];
  const json = await serializeMap({ name: 'b', hf, surface: sf, markers: {}, trees: [], buildings });
  check(json.formatVersion === 3 && FORMAT_VERSION === 3, 'maps are saved as formatVersion 3');
  const m = await deserializeMap(JSON.parse(JSON.stringify(json)));
  check(JSON.stringify(m.buildings) === JSON.stringify(buildings.slice(0, 2)), `buildings survive save/load; unknown types are dropped (${JSON.stringify(m.buildings)})`);
  const r = riverMap();
  for (let j = 0; j < r.hf.verts; j++) for (let i = 0; i < r.hf.verts; i++) if (Math.abs(r.hf.wz(j)) < 2) r.sf.base[j * r.hf.verts + i] = SURFACE.ROAD;
  const v2 = await serializeMap({ name: 'old', hf: r.hf, surface: r.sf, markers: {}, trees: [], buildings: [] });
  v2.formatVersion = 2; delete v2.buildings;
  const m2 = await deserializeMap(JSON.parse(JSON.stringify(v2)));
  check(m2.buildings.length === 1 && m2.buildings[0].type === 'bridge', 'a v2 map is upgraded with bridges where roads cross rivers');
  const sample = await deserializeMap(JSON.parse(readFileSync(new URL('../maps/sample.json', import.meta.url), 'utf8')));
  const types = sample.buildings.map(b => b.type);
  check(types.filter(t => t === 'bridge').length === 1 && types.filter(t => t === 'house').length >= 5, `sample map: ${types.join(', ')}`);
}

done();
