// Tests for the Defend stance, trench protection, and planning walls / trenches at an angle. Pure modules (Node).
// Run: node tests/defend-unit.mjs
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
import { TERRAIN, MAP_SIZE, COMBAT, BUILD } from '../src/config.js';
import { checker } from './harness.mjs';

const { check, done } = checker();
function world() {
  const hf = new Heightfield({ size: MAP_SIZE, cells: TERRAIN.cells, bedrock: TERRAIN.bedrock, maxSlope: TERRAIN.maxSlope });
  hf.generate(() => 0);
  const surface = new Surface(hf);
  const w = { hf, surface, water: new Water(hf, surface), forest: new Forest([], MAP_SIZE, 1), buildings: new Buildings([], hf) };
  w.nav = new NavGrid(w);
  hf.onChange((a, b, c, d) => w.nav.markSamples(a, b, c, d));
  w.movers = new Movers(w.nav);
  w.damage = new Damage(w);
  w.units = new Units(w, w.movers, w.damage, 9);
  w.con = new Construction(w);
  w.run = (secs, until = () => false) => { let t = 0; for (; t < secs && !until(); t += 1 / 60) { w.nav.update(); w.movers.step(1 / 60); w.units.step(1 / 60); w.con.step(1 / 60); } return t; };
  return w;
}

// ---------- Defend ----------
{
  const w = world(), U = w.units, shooter = U.spawn('assault', 1, 0, -14), a = U.spawn('assault', 0, -10, 0), b = U.spawn('assault', 0, 10, 0);
  U.order([a], 'move', -10, 30);
  w.run(0.5);
  U.defend([a]);
  check(a.defend && a.order === 'idle' && a.mover.state === 'idle', 'Defend stops a mech where it is');
  const pa = U.hitChance(shooter, a), pb = U.hitChance(shooter, b);
  check(Math.abs(pa - pb * COMBAT.defendHit) < 1e-9, `a defending mech is harder to hit (${(pa * 100).toFixed(0)}% vs ${(pb * 100).toFixed(0)}%)`);
  w.run(1);
  check(a.crouch > 0.9, `it crouches (${a.crouch.toFixed(2)})`);
  // Still fights.
  const shots = U.stats.shots;
  w.run(4);
  check(U.stats.shots > shots && a.target, 'a defending mech keeps firing');
  // Splash: the same shell burst next to each.
  a.hp = b.hp = a.maxHp; a.x = -10; b.x = 10;
  w.damage.explode(a.x + 2, a.z, 'shell', null, { dmg: 100, splash: 5, team: 1 });
  w.damage.explode(b.x + 2, b.z, 'shell', null, { dmg: 100, splash: 5, team: 1 });
  const la = a.maxHp - a.hp, lb = b.maxHp - b.hp;
  check(lb > 0 && Math.abs(la / lb - COMBAT.defendSplash) < 0.02, `and takes less from a nearby blast (${la.toFixed(0)} vs ${lb.toFixed(0)})`);
  // A move order stands it up and it goes.
  U.order([a], 'move', -10, 40);
  w.run(4);
  check(!a.defend && a.z > 15, `a move order ends Defend and it moves off (z ${a.z.toFixed(0)})`);
}

// ---------- Defend and trenches stack ----------
{
  const w = world(), U = w.units, b = U.spawn('builder', 0, 0, 12);
  const r = w.con.order([b], w.con.plan('trench', -10, 0, 10, 0));
  w.run(80, () => r.jobs.every(j => j.done));
  const shooter = U.spawn('assault', 1, 0, -22);
  const open = U.spawn('assault', 0, 30, 0), inT = U.spawn('assault', 0, -6, 0.3), both = U.spawn('assault', 0, 6, 0.3);
  U.defend([both]);
  const p0 = U.hitChance(shooter, open), p1 = U.hitChance(shooter, inT), p2 = U.hitChance(shooter, both);
  check(p1 < p0 && p2 < p1 && Math.abs(p2 - p1 * COMBAT.defendHit) < 1e-9, `hit chance: in the open ${(p0 * 100).toFixed(0)}%, in a trench ${(p1 * 100).toFixed(0)}%, in a trench and defending ${(p2 * 100).toFixed(0)}%`);
  // Splash in the trench, and trench + defend.
  for (const u of [open, inT, both]) u.hp = u.maxHp;
  for (const u of [open, inT, both]) w.damage.explode(u.x + 2.5, u.z, 'cannon', null, { dmg: 100, splash: 4, team: 1 });
  const l = [open, inT, both].map(u => u.maxHp - u.hp);
  check(l[1] < l[0] * 0.75 && l[2] < l[1] * 0.8, `a nearby blast hurts less in a trench, and less again defending (${l.map(x => x.toFixed(0)).join(' / ')})`);
}

// ---------- walls and trenches at any angle ----------
{
  const w = world();
  for (const deg of [0, 30, 45, 90, 135]) {
    const rot = deg * Math.PI / 180, dx = Math.cos(rot), dz = -Math.sin(rot);
    const plan = w.con.plan('wall', -dx * 5, -dz * 5, dx * 5, dz * 5);
    check(plan.length === 1 && Math.abs(((plan[0].rot - rot) % (2 * Math.PI) + 3 * Math.PI) % (2 * Math.PI) - Math.PI) < 1e-6, `a wall planned at ${deg}° keeps that angle`);
  }
  const b = w.units.spawn('builder', 0, 0, 12), rot = Math.PI / 4;
  const dx = Math.cos(rot), dz = -Math.sin(rot);
  const r = w.con.order([b], w.con.plan('wall', -dx * 5, -dz * 5, dx * 5, dz * 5));
  w.run(40, () => r.jobs.every(j => j.done));
  w.nav.flush();
  const B = w.buildings.list[0];
  check(B && Math.abs(B.def.rot - rot) < 1e-6 && !w.nav.passable(0, dx * 3, dz * 3) && w.nav.passable(0, -dz * 3, dx * 3), 'a wall built at 45° stands at 45° (blocks along its line, not across it)');
  const t = w.con.plan('trench', 0, -10, 0, 10);
  check(t.length === 2 && t.every(p => Math.abs(Math.abs(p.rot) - Math.PI / 2) < 1e-6), 'a trench can run north–south too');
  check(BUILD.wall.len === 10, 'walls are 10 long');
}

done();
