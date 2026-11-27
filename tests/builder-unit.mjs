// Tests for Builders: walls, auto turrets and trenches. Pure modules, run in Node.
// Run: node tests/builder-unit.mjs
import { Heightfield } from '../src/terrain/heightfield.js';
import { Surface, FEATURE } from '../src/terrain/surface.js';
import { Water } from '../src/terrain/water.js';
import { Forest } from '../src/world/forest.js';
import { Buildings } from '../src/world/buildings.js';
import { NavGrid } from '../src/nav/navgrid.js';
import { Movers } from '../src/units/movers.js';
import { Units } from '../src/units/units.js';
import { Damage } from '../src/combat/damage.js';
import { Construction } from '../src/world/construction.js';
import { lineOfSight, coverAt } from '../src/combat/los.js';
import { TERRAIN, MAP_SIZE, BUILD, TURRET_TYPE, COMBAT } from '../src/config.js';
import { checker } from './harness.mjs';

const { check, done } = checker();
function world({ credits = Infinity, fn = () => 0 } = {}) {
  const hf = new Heightfield({ size: MAP_SIZE, cells: TERRAIN.cells, bedrock: TERRAIN.bedrock, maxSlope: TERRAIN.maxSlope });
  hf.generate(fn);
  const surface = new Surface(hf);
  const w = { hf, surface, water: new Water(hf, surface), forest: new Forest([], MAP_SIZE, 1) };
  w.buildings = new Buildings([], hf);
  w.nav = new NavGrid(w);
  hf.onChange((a, b, c, d) => w.nav.markSamples(a, b, c, d));
  w.movers = new Movers(w.nav);
  w.damage = new Damage(w);
  w.units = new Units(w, w.movers, w.damage, 5);
  w.credits = credits;
  w.built = 0;
  w.con = new Construction(w, { pay: (team, c) => (w.credits >= c ? ((w.credits -= c), true) : false), onBuilding: () => w.built++ });
  w.run = (secs, until = () => false) => { let t = 0; for (; t < secs && !until(); t += 1 / 60) { w.nav.update(); w.movers.step(1 / 60); w.units.step(1 / 60); w.con.step(1 / 60); } return t; };
  return w;
}
const finite = w => w.units.list.every(u => Number.isFinite(u.x + u.y + u.z + u.hp));

// ---------- a Builder doesn't fight ----------
{
  const w = world(), b = w.units.spawn('builder', 0, 0, 20), e = w.units.spawn('scout', 1, 0, -1);   // within sight 30 x 75%, beyond the Light's chase reach   // out of the Scout's chase reach
  e.t = { ...e.t, range: 0.1 };
  w.units.stop([e]);
  w.run(5);
  check(w.units.stats.shots === 0 && Math.hypot(b.x, b.z - 20) < 1, `a Builder is unarmed: it neither shoots nor chases enemies (shots ${w.units.stats.shots}, moved ${Math.hypot(b.x, b.z - 20).toFixed(1)})`);
  check(e.seenBy[0] > w.units.time, 'but it spots them (for Titans)');
}

// ---------- wall ----------
{
  const w = world({ credits: 500 }), b = w.units.spawn('builder', 0, 0, 20);
  const plan = w.con.plan('wall', -5, 0, 5, 0);
  check(plan.length === 1 && plan[0].ok, 'a 10-unit line plans one wall');
  const r = w.con.order([b], plan);
  check(r.jobs.length === 1 && w.credits === 500 - BUILD.wall.cost, `ordering it costs ${BUILD.wall.cost}`);
  const t = w.run(60, () => r.jobs[0].done);
  check(r.jobs[0].done && w.buildings.list.length === 1 && w.built === 1, `the Builder walks over and builds it (${t.toFixed(1)} s, work ${BUILD.wall.work} s)`);
  w.run(0.5);
  w.nav.flush();
  check(!w.nav.passable(0, 0, 0) && !w.nav.passable(0, 3, 0), 'the wall blocks movement');
  check(!lineOfSight(w, 0, 2, 10, 0, 2, -10).clear, 'and line of sight');
  check(b.order === 'idle' && Math.hypot(b.x, b.z) < 6 && !w.nav.passable(0, 0, 0) && w.nav.passable(0, b.x, b.z), `the Builder stops beside it, out of the way (${b.order} at ${b.x.toFixed(1)}, ${b.z.toFixed(1)})`);
  for (let n = 0; n < 8; n++) w.damage.explode(0, 0, 'shell', 1.3);
  check(w.buildings.list[0].state !== 'intact', `a built wall can be shot down (${w.buildings.list[0].state})`);
}

// ---------- a long line, two Builders ----------
{
  const w = world({ credits: 10000 }), bs = [w.units.spawn('builder', 0, -10, 15), w.units.spawn('builder', 0, 10, 15)];
  const plan = w.con.plan('wall', -20, 0, 20, 0);
  check(plan.length === 4 && plan.every(p => p.ok && Math.abs(p.len - 10) < 0.01), `a 40-unit line plans ${plan.length} walls`);
  const r = w.con.order(bs, plan);
  const t = w.run(120, () => r.jobs.every(j => j.done));
  check(r.jobs.every(j => j.done) && w.buildings.list.length === 4, `two Builders build all four (${t.toFixed(0)} s)`);
  check(t < 4 * BUILD.wall.work * 0.75 + 15, `working together they are faster than one alone (${t.toFixed(0)} s vs ${4 * BUILD.wall.work} s of work)`);
  const poor = world({ credits: 130 }), pb = poor.units.spawn('builder', 0, 0, 20);
  const r2 = poor.con.order([pb], poor.con.plan('wall', -20, 0, 20, 0));
  check(r2.jobs.length === 2 && r2.refused === 'poor', 'with too few credits only what can be paid for is ordered');
  const blocked = world();
  blocked.units.addStructure('turret', 0, 0, 0);
  check(!blocked.con.plan('turret', 0.5, 0.5)[0].ok && !blocked.con.plan('wall', -5, 0, 5, 0)[0].ok && blocked.con.plan('wall', -5, 20, 5, 20)[0].ok, "can't build on top of a turret (but can next to it)");
}

// ---------- turret ----------
{
  const w = world(), b = w.units.spawn('builder', 0, 0, 20);
  const r = w.con.order([b], w.con.plan('turret', 0, 0));
  let mid = null;
  w.run(60, () => { const s = w.units.structures[0]; if (s && !mid && s.built > 0.4 && s.built < 0.6) mid = { built: s.built, hp: s.hp }; return r.jobs[0].done; });
  const s = w.units.structures[0];
  check(r.jobs[0].done && s && s.type === 'turret' && s.built === 1, 'a Builder builds an auto turret');
  check(mid && mid.hp < s.hp && Math.abs(s.hp - TURRET_TYPE.hp) < 1, `it rises and gains strength as it is built (half built: ${mid && mid.hp.toFixed(0)} hp; done: ${s.hp.toFixed(0)})`);
  w.nav.flush();
  check(!w.nav.passable(0, 0, 0), 'it blocks movement');
  const foe = w.units.spawn('scout', 1, 0, -15);
  foe.t = { ...foe.t, range: 0.1 };
  w.units.stop([foe]);
  w.run(20, () => !foe.alive);
  check(!foe.alive, 'it shoots down an enemy Scout that comes in range');
  // Enemy Titans shell it until it is destroyed.
  const titans = [0, 1].map(k => w.units.spawn('titan', 1, -4 + k * 8, -24));
  w.units.attack(titans, s);
  w.run(90, () => !s.alive);
  check(!s.alive && w.units.wrecks.some(x => x.type === 'turret'), 'enemy Titans can destroy it; it leaves a wreck');
  w.nav.flush();
  check(w.nav.passable(1, 0, 0), 'and the ground is free again');
  // An unfinished turret doesn't shoot.
  const w2 = world(), b2 = w2.units.spawn('builder', 0, 0, 20);
  const r2 = w2.con.order([b2], w2.con.plan('turret', 0, 0));
  w2.run(60, () => w2.units.structures[0]?.built > 0.3);
  w2.units.order([b2], 'move', 30, 30);
  const half = w2.units.structures[0], f2 = w2.units.spawn('scout', 1, 0, -12);
  f2.t = { ...f2.t, range: 0.1 }; w2.units.stop([f2]);
  w2.run(6);
  check(half.built < 1 && w2.units.stats.shots === 0, `a half-built turret (${(half.built * 100).toFixed(0)}%) holds fire; its Builder left when sent away`);
  // Tapping the site again: back to work.
  check(w2.con.siteAt(0.5, 0, 0) === r2.jobs[0], 'the unfinished site can be found under a tap');
  w2.con.assign([b2], [r2.jobs[0]]);
  w2.run(60, () => r2.jobs[0].done);
  check(r2.jobs[0].done && half.built === 1, 'sent back to the site, the Builder finishes it');
}

// ---------- trench ----------
{
  const w = world(), b = w.units.spawn('builder', 0, 0, 25);
  const plan = w.con.plan('trench', -10, 0, 10, 0);
  check(plan.length === 2 && plan.every(p => p.ok), 'a 20-unit trench line plans two sections');
  const r = w.con.order([b], plan);
  const t = w.run(120, () => r.jobs.every(j => j.done));
  check(r.jobs.every(j => j.done), `the Builder digs it (${t.toFixed(0)} s)`);
  const hMid = w.hf.heightAt(0, 0), hBank = w.hf.heightAt(0, -BUILD.trench.halfWidth - 1.2), hHome = w.hf.heightAt(0, BUILD.trench.halfWidth + 1.2);
  check(Math.abs(hMid + BUILD.trench.depth) < 0.1, `the trench is ${(-hMid).toFixed(2)} deep`);
  check(hBank > 0.4 && Math.abs(hHome) < 0.05, `the spoil is banked up on the enemy (north) side (${hBank.toFixed(2)} high; home side ${hHome.toFixed(2)})`);
  const k = w.hf.index(Math.round(w.hf.gx(0)), Math.round(w.hf.gz(0)));
  check(w.surface.features[k] & FEATURE.TRENCH && Math.abs(coverAt(w, 0, 0) - COMBAT.trenchCover) < 1e-9 && coverAt(w, 0, 10) === 0, `a mech in the trench has cover (${coverAt(w, 0, 0)})`);
  let steep = 0;
  for (let x = -12; x <= 12; x += 0.5) for (let z = -5; z <= 5; z += 0.5) steep = Math.max(steep, w.hf.slopeAt(x, z));
  check(steep < 1.9, `its sides are never cliffs (steepest ${steep.toFixed(2)}), so it can't trap a mech`);
  // Dug twice over: no deeper.
  w.con._dig(r.jobs[0], 0, r.jobs[0].len);
  check(Math.abs(w.hf.heightAt(-5, 0) + BUILD.trench.depth) < 0.1, 'digging the same stretch again does not deepen it');
  // Mechs cross it, and one in it is harder to hit and lower behind the bank.
  w.nav.flush();
  const crossers = ['scout', 'assault', 'titan'].map((tp, i) => w.units.spawn(tp, 0, -6 + i * 6, 15));
  w.units.order(crossers, 'move', 0, -15);
  w.run(30, () => crossers.every(u => u.mover.state === 'idle'));
  check(crossers.every(u => u.z < -8), `Scouts, Assaults and Titans cross the trench (z ${crossers.map(u => u.z.toFixed(0)).join(', ')})`);
  const inT = w.units.spawn('assault', 0, 2, 0.2), shooter = w.units.spawn('assault', 1, 2, -22), open = w.units.spawn('assault', 0, 30, 0);
  check(w.units.hitChance(shooter, inT) < w.units.hitChance(shooter, open) * 0.6, `a mech in the trench is harder to hit (${(w.units.hitChance(shooter, inT) * 100).toFixed(0)}% vs ${(w.units.hitChance(shooter, open) * 100).toFixed(0)}%)`);
  check(inT.y < open.y - 1, `and stands lower (${inT.y.toFixed(2)} vs ${open.y.toFixed(2)})`);
  check(finite(w), 'no NaN');
}

done();
