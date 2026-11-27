// Tests for a match: economy, production, capture points, HQs, the enemy AI, and a whole AI-vs-AI match on the
// sample map that must end with no NaN and no stuck mechs. Pure modules, run in Node.
// Run: node tests/match-unit.mjs
import { readFileSync } from 'node:fs';
import { Heightfield } from '../src/terrain/heightfield.js';
import { Surface } from '../src/terrain/surface.js';
import { Water } from '../src/terrain/water.js';
import { Forest } from '../src/world/forest.js';
import { Buildings } from '../src/world/buildings.js';
import { NavGrid } from '../src/nav/navgrid.js';
import { Movers } from '../src/units/movers.js';
import { Units } from '../src/units/units.js';
import { Damage } from '../src/combat/damage.js';
import { Match } from '../src/game/match.js';
import { EnemyAI } from '../src/ai/enemy.js';
import { deserializeMap } from '../src/maps/format.js';
import { TERRAIN, MAP_SIZE, ECONOMY, UNIT_TYPES, CAPTURE, TURRET_TYPE } from '../src/config.js';
import { checker } from './harness.mjs';

const { check, done } = checker();
function wire(w, seed) {
  w.nav = new NavGrid(w);
  w.hf.onChange((a, b, c, d) => w.nav.markSamples(a, b, c, d));
  w.water?.onChange?.((a, b, c, d) => w.nav.markSamples(a, b, c, d));
  w.movers = new Movers(w.nav);
  w.damage = new Damage(w);
  w.units = new Units(w, w.movers, w.damage, seed);
  w.run = (secs, every = null, until = () => false) => {
    let t = 0;
    for (; t < secs && !until(); t += 1 / 60) {
      w.nav.update(); w.damage.update(1 / 60); w.movers.step(1 / 60); w.units.step(1 / 60);
      w.match?.step(1 / 60); w.ai?.step(1 / 60); w.ai0?.step(1 / 60);
      for (const e of w.units.events) if (e.type === 'death') w.match?.unitLost(e.unit);
      w.units.events.length = 0;
      every?.(t);
    }
    return t;
  };
  return w;
}
function flat(seed = 3) {
  const hf = new Heightfield({ size: MAP_SIZE, cells: TERRAIN.cells, bedrock: TERRAIN.bedrock, maxSlope: TERRAIN.maxSlope });
  hf.generate(() => 0);
  const surface = new Surface(hf);
  return wire({ hf, surface, water: new Water(hf, surface), forest: new Forest([], MAP_SIZE, 1), buildings: new Buildings([], hf) }, seed);
}
const MARKS = { playerHQ: { x: 0, z: 100 }, enemyHQ: { x: 0, z: -100 }, capturePoints: [{ x: 0, z: 0 }, { x: 60, z: 0 }] };
const finite = w => w.units.list.every(u => Number.isFinite(u.x + u.y + u.z + u.hp + u.yaw + u.torsoYaw));

// ---------- economy and production ----------
{
  const w = flat(), m = w.match = new Match(w.units, MARKS);
  const c0 = m.teams[0].credits;
  w.run(10);
  check(Math.abs(m.teams[0].credits - c0 - 10 * ECONOMY.baseIncome) < 0.5, `base income: +${ECONOMY.baseIncome}/s (${c0} -> ${m.teams[0].credits.toFixed(0)} in 10 s)`);
  const before = m.teams[0].credits;
  check(m.enqueue(0, 'scout') === true && Math.abs(m.teams[0].credits - (before - UNIT_TYPES.scout.cost)) < 1e-6, 'queueing a Scout pays for it up front');
  check(m.enqueue(0, 'titan') === 'poor', `can't queue a Titan without ${UNIT_TYPES.titan.cost} credits`);
  check(m.dequeue(0, 'scout') && Math.abs(m.teams[0].credits - before) < 1e-6 && m.enqueue(0, 'scout') === true, 'taking a mech off the queue refunds it');
  w.run(UNIT_TYPES.scout.build - 0.2);
  check(w.units.counts()[0] === 0, `nothing comes out before the build time (${UNIT_TYPES.scout.build} s)`);
  w.run(0.4);
  const u = w.units.list.find(u => u.team === 0);
  check(!!u && u.type === 'scout' && m.teams[0].built === 1, 'the Scout comes out of the HQ when it is built');
  w.run(8);
  const T = m.teams[0];
  check(u && Math.hypot(u.x - T.rally.x, u.z - T.rally.z) < 12 && Math.hypot(u.x - T.hq.x, u.z - T.hq.z) > T.hq.radius + 5, `it walks out to the rally point in front of the HQ (${Math.hypot(u.x - T.rally.x, u.z - T.rally.z).toFixed(1)} from it)`);
  m.teams[0].credits = 1e6;
  let n = 0; while (m.enqueue(0, 'scout') === true) n++;
  check(n === ECONOMY.queueMax && m.enqueue(0, 'scout') === 'full', `the build queue holds ${ECONOMY.queueMax}`);
  // Battle Value: a side's mechs (alive and queued) and turrets add up to at most 30, +5 per capture point.
  m.teams[0].queue.length = 0;
  check(m.bvCap(0) === 30 && m.bvUsed(0) === UNIT_TYPES.scout.bv, `Battle Value: limit ${m.bvCap(0)} at the start; one Light Mech uses ${m.bvUsed(0)}`);
  check([['scout', 1], ['medium', 2], ['builder', 3], ['assault', 4], ['titan', 6]].every(([k, v]) => UNIT_TYPES[k].bv === v) && TURRET_TYPE.bv === 1, 'BV: Light 1, Medium 2, Builder 3, Heavy 4, Assault 6, Turret 1');
  for (let k = 0; k < 4; k++) w.units.spawn('titan', 0, -60 + k * 8, 60);           // 24
  check(m.enqueue(0, 'medium') === true && m.bvUsed(0) === 27, `queued mechs count too (${m.bvUsed(0)} used)`);
  check(m.enqueue(0, 'assault') === 'bv' && m.enqueue(0, 'titan') === 'bv', 'a Heavy (4) or Assault (6) over the limit is refused');
  check(m.enqueue(0, 'scout') === true && m.enqueue(0, 'medium') === true && m.bvUsed(0) === 30 && m.enqueue(0, 'scout') === 'bv', 'small mechs fill it up exactly to 30, then nothing more');
  w.units.addStructure('turret', 0, 40, 40);
  check(m.bvUsed(0) === 31 && m.bvLeft(0) === -1, 'turrets count (1 each)');
  m.points[0].owner = 0; m.points[1].owner = 0;
  check(m.bvCap(0) === 40 && m.enqueue(0, 'assault') === true && m.enqueue(0, 'titan') === 'bv', `holding 2 capture points raises the limit to ${m.bvCap(0)}: room for a Heavy, not then an Assault`);
  const nUnits = w.units.list.length;
  m.points[0].owner = null;
  check(m.bvCap(0) === 35 && w.units.list.length === nUnits && m.enqueue(0, 'scout') === 'bv', 'losing a point lowers the limit; nothing is taken away, but nothing more can be built');
  check(m.bvUsed(1) === 0 && m.enqueue(1, 'titan') === true, 'each side has its own limit');
}

// ---------- capture points ----------
{
  const w = flat(), m = w.match = new Match(w.units, MARKS), p = m.points[0];
  const a = w.units.spawn('scout', 0, 0, 0);
  const t1 = w.run(30, null, () => p.owner === 0);
  check(p.owner === 0 && Math.abs(t1 - 1 / CAPTURE.rate) < 0.5, `one mech captures a point in ${t1.toFixed(1)} s`);
  check(Math.abs(m.income(0) - ECONOMY.baseIncome - ECONOMY.pointIncome) < 1e-9, `holding it raises income to +${m.income(0)}/s`);
  const ev = m.events.find(e => e.type === 'captured');
  check(ev && ev.team === 0 && ev.point === p, 'capturing it is reported (for the HUD banner)');
  // An enemy squad alone in the ring takes it back: neutral first, then theirs.
  w.units.kill(a);
  const foes = ['scout', 'scout', 'scout'].map((t, k) => w.units.spawn(t, 1, -2 + k * 2, 2));
  const t2 = w.run(30, null, () => p.owner === null);
  const t3 = w.run(30, null, () => p.owner === 1);
  check(p.owner === 1 && t2 < 4 && t3 < 4, `three enemy mechs neutralise it in ${t2.toFixed(1)} s and take it in ${t3.toFixed(1)} s`);
  check(m.events.some(e => e.type === 'lost' && e.team === 0), 'losing it is reported');
  // Contested: both sides in the ring, nothing changes.
  const mine = w.units.spawn('assault', 0, 3, -3);
  for (const u of [...foes, mine]) { u.t = { ...u.t, range: 0.1 }; w.units.stop([u]); }
  const c = p.control;
  w.run(3);
  check(p.control === c, 'a contested point does not change hands');
}

// ---------- HQs ----------
{
  const w = flat(), m = w.match = new Match(w.units, MARKS), H = m.teams[1].hq;
  w.nav.flush?.();
  check(!w.nav.passable(1, H.x, H.z) && !w.nav.passable(0, H.x + 4, H.z), 'the HQ blocks movement');
  const s = w.units.spawn('scout', 0, H.x, H.z + 25);
  w.units.stop([s]); s.t = { ...s.t, range: 0.1 };
  w.run(20, null, () => !s.alive);
  check(!s.alive, 'the HQ turret destroys a mech that comes in range');
  const squad = [];
  for (let k = 0; k < 6; k++) squad.push(w.units.spawn(['titan', 'assault'][k % 2], 0, -15 + k * 6, H.z + 45));
  w.units.attack(squad, H);
  const t = w.run(240, null, () => !!m.over);
  check(m.over && m.over.winner === 0 && !H.alive, `six mechs ordered to attack the enemy HQ destroy it in ${t.toFixed(0)} s: the match is won`);
  check(m.events.some(e => e.type === 'end' && e.winner === 0), 'the end of the match is reported');
  const q = m.enqueue(1, 'scout');
  check(q === 'over', 'nothing can be built after the match is over');
}

// ---------- the AI ----------
{
  const w = flat(), m = w.match = new Match(w.units, MARKS), ai = w.ai = new EnemyAI(m);
  w.run(90);
  check(m.teams[1].built >= 4, `the AI builds mechs (${m.teams[1].built} in 90 s)`);
  check(ai.wave >= 1 && m.held(1) >= 1, `it sends waves (${ai.wave}) and takes capture points (${m.held(1)} held)`);
  // Player mechs near its HQ: it defends.
  const raid = [0, 1, 2].map(k => w.units.spawn('assault', 0, -8 + k * 8, -60));
  w.units.stop(raid);
  w.run(3);
  check(ai.defending, 'player mechs near its HQ make it defend');
}

// ---------- a whole match on the sample map, AI against AI ----------
{
  const m0 = await deserializeMap(JSON.parse(readFileSync(new URL('../maps/sample.json', import.meta.url), 'utf8')));
  const w = wire({ hf: m0.hf, surface: m0.surface, water: new Water(m0.hf, m0.surface), forest: new Forest(Forest.fromSnapshot(m0.trees), MAP_SIZE), buildings: new Buildings(m0.buildings, m0.hf) }, 11);
  const m = w.match = new Match(w.units, m0.markers);
  w.ai = new EnemyAI(m, 1); w.ai0 = new EnemyAI(m, 0);
  w.ai0.waveSize = 5;                      // a little different from its opponent, so it isn't a perfect mirror
  const last = new Map();
  const stuckInfo = [];
  let stuck = 0, nan = false, maxUnits = 0, maxBV = 0, ms = 0, steps = 0;
  const t0 = performance.now();
  const t = w.run(25 * 60, t => {
    steps++;
    maxUnits = Math.max(maxUnits, w.units.list.length);
    maxBV = Math.max(maxBV, m.bvUsed(0), m.bvUsed(1));
    if (steps % 600 !== 0) return;          // every 10 s
    if (!finite(w)) nan = true;
    for (const u of w.units.list) {
      const prev = last.get(u);
      // Stuck: told to go somewhere, nothing to shoot, and hasn't moved 1 unit in 30 s.
      if (prev && u.order !== 'idle' && !u.target && u.mover.state !== 'idle' && Math.hypot(u.x - prev.x, u.z - prev.z) < 1) { if (++prev.n === 3) { stuck++; stuckInfo.push(`${u.type} team ${u.team} at (${u.x.toFixed(1)}, ${u.z.toFixed(1)}) order ${u.order} goal (${u.goal?.x.toFixed(1)}, ${u.goal?.z.toFixed(1)}) mover ${u.mover.state} path ${u.mover.path?.points.length} t ${(t / 60).toFixed(1)}`); } }
      else last.set(u, { x: u.x, z: u.z, n: 0 });
    }
  }, () => !!m.over);
  ms = (performance.now() - t0) / steps;
  check(!!m.over, `an AI-vs-AI match on the sample map ends: ${m.over ? (m.over.winner ? 'enemy' : 'player') + ' side wins' : 'no winner'} after ${(t / 60).toFixed(1)} min`);
  check(!nan && finite(w), 'no NaN positions in the whole match');
  check(stuck === 0, `no mech got stuck (${stuck})${stuckInfo.length ? ':\n   ' + stuckInfo.join('\n   ') : ''}`);
  check(m.teams.every(T => T.built > 10) && m.teams.every(T => T.lost > 3), `both sides build and lose mechs (built ${m.teams.map(T => T.built).join(' / ')}, lost ${m.teams.map(T => T.lost).join(' / ')})`);
  const bvMax = ECONOMY.bvStart + ECONOMY.bvPerPoint * m.points.length;
  check(maxBV <= bvMax, `neither side ever goes over the Battle Value limit (peak ${maxBV}, the most it could be ${bvMax}; ${maxUnits} mechs on the map at most)`);
  let dug = 0; for (const v of w.hf.h) if (v < -0.5) dug++;
  check(dug > 2000, `the battle cratered the map (${dug} samples dug)`);
  check(ms < 5, `average simulation step over the match: ${ms.toFixed(2)} ms here`);
}

done();
