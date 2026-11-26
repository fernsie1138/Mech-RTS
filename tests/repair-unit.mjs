// Tests for shallow craters with a depth limit, and Builders repairing. Pure modules, run in Node.
// Run: node tests/repair-unit.mjs
import { Heightfield } from '../src/terrain/heightfield.js';
import { Surface } from '../src/terrain/surface.js';
import { Water } from '../src/terrain/water.js';
import { Forest } from '../src/world/forest.js';
import { Buildings } from '../src/world/buildings.js';
import { NavGrid } from '../src/nav/navgrid.js';
import { Movers } from '../src/units/movers.js';
import { Units } from '../src/units/units.js';
import { Damage } from '../src/combat/damage.js';
import { Construction } from '../src/world/construction.js';
import { TERRAIN, MAP_SIZE, TERRAIN_DAMAGE, UNIT_TYPES, BUILD } from '../src/config.js';
import { checker } from './harness.mjs';

const { check, done } = checker();
function world() {
  const hf = new Heightfield({ size: MAP_SIZE, cells: TERRAIN.cells, bedrock: TERRAIN.bedrock, maxSlope: TERRAIN.maxSlope });
  hf.generate(() => 0);
  hf.setFloor(TERRAIN.maxDig);
  const surface = new Surface(hf);
  const w = { hf, surface, water: new Water(hf, surface), forest: new Forest([], MAP_SIZE, 1), buildings: new Buildings([], hf) };
  w.nav = new NavGrid(w);
  hf.onChange((a, b, c, d) => w.nav.markSamples(a, b, c, d));
  w.movers = new Movers(w.nav);
  w.stamps = [];
  w.decals = { crater: (x, z, r) => w.stamps.push({ x, z, r }) };
  w.damage = new Damage(w);
  w.units = new Units(w, w.movers, w.damage, 4);
  w.con = new Construction(w);
  w.run = (secs, until = () => false) => { let t = 0; for (; t < secs && !until(); t += 1 / 60) { w.nav.update(); w.movers.step(1 / 60); w.units.step(1 / 60); w.con.step(1 / 60); } return t; };
  return w;
}

// ---------- shallow craters, never deeper than maxDig ----------
{
  const w = world();
  w.damage.explode(0, 0, 'shell');
  const d1 = -w.hf.heightAt(0, 0);
  check(d1 > 0.5 && d1 < 1.0, `one shell digs a shallow crater (${d1.toFixed(2)} deep; was 1.7)`);
  w.damage.explode(30, 0, 'cannon');
  const d2 = -w.hf.heightAt(30, 0);
  check(d2 > 0.15 && d2 < 0.4, `a cannon round digs ${d2.toFixed(2)} (was 0.7)`);
  for (let n = 0; n < 120; n++) w.damage.explode((n % 3 - 1) * 0.8, ((n * 7) % 3 - 1) * 0.8, 'shell');
  let low = Infinity; for (let x = -6; x <= 6; x += 0.5) for (let z = -6; z <= 6; z += 0.5) low = Math.min(low, w.hf.heightAt(x, z));
  check(low >= -TERRAIN.maxDig - 1e-3, `120 shells in one spot go no deeper than ${TERRAIN.maxDig} (deepest ${(-low).toFixed(2)})`);
  check(w.stamps.length === 122 && w.stamps.every(s => s.r > 1), `every cannon and shell crater stamps a crater picture (${w.stamps.length})`);
  w.damage.explode(60, 0, 'mg');
  check(w.stamps.length === 122, 'machine-gun hits leave no crater picture');
  w.damage.explode(60, 20, 'shell', 6);
  check(w.stamps.length === 122, 'a burst high above the ground (on a roof) leaves none on the ground');
}

// ---------- Builders repair ----------
{
  const w = world(), U = w.units;
  const b = U.spawn('builder', 0, 0, 0), a = U.spawn('assault', 0, 6, 0);
  a.hp = a.maxHp * 0.3;
  const t = w.run(30, () => a.hp >= a.maxHp);
  const need = a.maxHp * 0.7 / UNIT_TYPES.builder.repair;
  check(a.hp === a.maxHp, `an idle Builder repairs a damaged mech next to it by itself (${t.toFixed(1)} s; ${need.toFixed(1)} s of work)`);
  w.run(1);
  check(b.order === 'idle' && !b.repairTarget, 'then it stops');
  // Not out of range: a damaged mech far away is left alone...
  const far = U.spawn('titan', 0, 60, 0); far.hp = far.maxHp * 0.5;
  w.run(5);
  check(far.hp === far.maxHp * 0.5 && Math.hypot(b.x, b.z) < 5, `a damaged mech ${60} away isn't repaired by itself`);
  // ...unless ordered.
  w.con.repair([b], far);
  const t2 = w.run(60, () => far.hp >= far.maxHp);
  check(far.hp === far.maxHp && Math.hypot(b.x - far.x, b.z - far.z) < 6, `ordered to, the Builder walks over and repairs it (${t2.toFixed(0)} s)`);
  // Two Builders repair twice as fast.
  const b2 = U.spawn('builder', 0, 57, 3);
  far.hp = far.maxHp * 0.2;
  const t3 = w.run(60, () => far.hp >= far.maxHp);
  const one = far.maxHp * 0.8 / UNIT_TYPES.builder.repair;
  check(t3 < one * 0.65, `two Builders repair faster than one (${t3.toFixed(1)} s vs ${one.toFixed(1)} s)`);
  // Turrets too; not enemies; not itself.
  const tur = U.addStructure('turret', 0, -20, 0); tur.hp = 100;
  w.con.repair([b], tur);
  w.run(60, () => tur.hp >= tur.maxHp);
  check(tur.hp === tur.maxHp, 'Builders repair turrets');
  const foe = U.spawn('scout', 1, 4, 30); foe.hp = 10; foe.t = { ...foe.t, range: 0.1 }; U.stop([foe]);
  w.con.repair([b], foe);
  check(b.repairTarget !== foe, "they won't repair enemies");
  b.hp = 50; U.stop([b]);
  w.run(3);
  check(b.hp === 50, 'a Builder alone does not repair itself');
  const helper = U.spawn('builder', 0, b.x + 4, b.z);
  w.run(10, () => b.hp >= b.maxHp);
  check(helper.hp === helper.maxHp && b.hp === b.maxHp, 'but another Builder nearby will');
  // A move order takes it off the repair.
  const c = U.spawn('assault', 0, 0, 40); c.hp = 10;
  w.con.repair([b], c);
  w.run(1);
  U.order([b], 'move', -40, -40);
  w.run(2);
  check(b.order === 'move' && !b.working, 'a move order ends a repair');
  check(BUILD.repairAuto > 0, 'auto-repair distance set');
}

done();
