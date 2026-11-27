// Tests for mechs and combat: line of sight, cover, high ground, indirect fire, dodging shells, terrain damage,
// orders, and a performance check. Pure modules, run in Node.
// Run: node tests/units-unit.mjs
import { Heightfield } from '../src/terrain/heightfield.js';
import { Surface, FEATURE } from '../src/terrain/surface.js';
import { Water } from '../src/terrain/water.js';
import { Forest, newTree, TREE } from '../src/world/forest.js';
import { Buildings } from '../src/world/buildings.js';
import { NavGrid } from '../src/nav/navgrid.js';
import { Movers } from '../src/units/movers.js';
import { Units } from '../src/units/units.js';
import { Damage } from '../src/combat/damage.js';
import { lineOfSight, coverAt } from '../src/combat/los.js';
import { TERRAIN, MAP_SIZE , COMBAT} from '../src/config.js';
import { checker } from './harness.mjs';

const { check, done } = checker();
function world(fn = () => 0, { trees = [], buildings = [], seed = 3 } = {}) {
  const hf = new Heightfield({ size: MAP_SIZE, cells: TERRAIN.cells, bedrock: TERRAIN.bedrock, maxSlope: TERRAIN.maxSlope });
  hf.generate(fn);
  hf.setFloor(TERRAIN.maxDig);                    // as in the game: craters never go deeper than this
  const surface = new Surface(hf);
  const w = { hf, surface, water: new Water(hf, surface), forest: new Forest(trees, MAP_SIZE, 1) };
  w.buildings = new Buildings(buildings, hf);
  w.nav = new NavGrid(w);
  hf.onChange((a, b, c, d) => w.nav.markSamples(a, b, c, d));
  w.movers = new Movers(w.nav);
  w.damage = new Damage(w);
  w.units = new Units(w, w.movers, w.damage, seed);
  w.run = (secs, until = () => false) => { let t = 0; for (; t < secs && !until(); t += 1 / 60) { w.nav.update(); w.movers.step(1 / 60); w.units.step(1 / 60); } return t; };
  return w;
}
const finite = w => w.units.list.every(u => Number.isFinite(u.x + u.y + u.z + u.hp + u.yaw + u.torsoYaw));

// ---------- a fair fight in the open resolves ----------
{
  const w = world(), U = w.units, A = [], B = [];
  for (let k = 0; k < 6; k++) { A.push(U.spawn(['scout', 'assault', 'titan'][k % 3], 0, -10 + (k % 3) * 8, 40 + Math.floor(k / 3) * 8)); B.push(U.spawn(['scout', 'assault', 'titan'][k % 3], 1, -10 + (k % 3) * 8, -40 - Math.floor(k / 3) * 8)); }
  U.order(A, 'amove', 0, -40); U.order(B, 'amove', 0, 40);
  const wreckTime = COMBAT.wreckTime; COMBAT.wreckTime = 1e9;          // keep every wreck for the count below
  const t = w.run(120, () => U.counts().some(c => c === 0));
  COMBAT.wreckTime = wreckTime;
  const c = U.counts();
  check(c.some(n => n === 0) && t < 120, `6 v 6 in the open is decided in ${t.toFixed(0)} s (${c[0]} vs ${c[1]} left, ${U.stats.kills} destroyed, ${U.stats.shots} shots, ${U.stats.hits} direct hits)`);
  check(finite(w), 'no NaN positions, angles or hit points');
  check(U.wrecks.length === U.stats.kills, `every destroyed mech leaves a wreck (${U.wrecks.length})`);
  let dug = 0; for (const v of w.hf.h) if (v < -0.3) dug++;
  check(dug > 200, `the fight cratered the ground (${dug} samples dug)`);
}

// ---------- line of sight ----------
{
  const w = world((x, z) => Math.max(0, 10 - Math.abs(z) * 0.8));       // ridge along x at z = 0, 10 high
  const U = w.units, a = U.spawn('assault', 0, 0, 20), b = U.spawn('assault', 1, 0, -20);
  check(!U.canSeeDirect(a, b), 'a ridge between two mechs blocks line of sight');
  const c = U.spawn('scout', 0, 30, 0);
  check(lineOfSight(w, 0, 3, -30, 0, 3, -20).clear, 'clear ground: line of sight is clear');
  const v = world(() => 0, { buildings: [{ type: 'wall', x: 0, z: 0, rot: 0 }] });
  check(!lineOfSight(v, 0, 2, 10, 0, 2, -10).clear && lineOfSight(v, 0, 8, 10, 0, 8, -10).clear, 'a standing wall blocks a low line of sight; a high one passes over');
  const trees = []; for (let x = -4; x <= 4; x += 2) for (let z = -4; z <= 4; z += 2) trees.push(newTree(x, z));
  const f = world(() => 0, { trees });
  check(lineOfSight(f, 0, 3, 15, 0, 3, -15).clear, 'trees do not block line of sight (they give cover instead)');
  check(coverAt(f, 0, 0) > 0.3 && coverAt(f, 40, 0) === 0, `forest gives cover (${coverAt(f, 0, 0).toFixed(2)} in the trees, 0 in the open)`);
}

// ---------- cover and high ground change the hit chance ----------
{
  const trees = []; for (let x = 20; x <= 32; x += 2.2) for (let z = -6; z <= 6; z += 2.2) trees.push(newTree(x, z));
  const w = world((x, z) => (x < -20 ? 8 : 0), { trees }), U = w.units;
  const shooter = U.spawn('assault', 0, 0, 25), inOpen = U.spawn('assault', 1, 0, 0), inWood = U.spawn('scout', 1, 26, 0.5), high = U.spawn('assault', 0, -26, 0);
  const pOpen = U.hitChance(shooter, inOpen), pWood = U.hitChance(shooter, inWood), pHigh = U.hitChance(high, inOpen);
  check(pWood < pOpen * 0.8, `harder to hit a mech in forest (${(pWood * 100).toFixed(0)}% vs ${(pOpen * 100).toFixed(0)}% in the open)`);
  check(pHigh > pOpen, `easier to hit from high ground (${(pHigh * 100).toFixed(0)}% vs ${(pOpen * 100).toFixed(0)}%)`);
}

// ---------- Titans fire over hills, but only at what their side can see ----------
{
  const w = world((x, z) => Math.max(0, 10 - Math.abs(z - 10) * 0.9));   // ridge at z = 10
  const U = w.units, titan = U.spawn('titan', 0, 0, 30), target = U.spawn('assault', 1, 0, 0);
  target.hp = target.maxHp = 1e6;            // keep it alive for counting
  U.stop([titan]);
  w.run(8);
  const blind = U.stats.shots;
  check(!U.canSeeDirect(titan, target) && blind === 0, `a Titan behind a ridge holds fire at an enemy nobody can see (${blind} shots)`);
  const spotter = U.spawn('scout', 0, 30, 0);                              // off to the side, in the open: sees the target
  U.stop([spotter]);
  spotter.t = { ...spotter.t, range: 0.1 };                                 // the spotter itself doesn't shoot
  w.run(10);
  const titanShots = U.stats.shots;
  check(titanShots >= 2 && target.hp < target.maxHp, `once a Scout spots it, the Titan shells it over the ridge (${titanShots} shells, ${Math.round(target.maxHp - target.hp)} damage)`);
}

// ---------- fast movers dodge shells ----------
{
  const dmg = moving => {
    const w = world(), U = w.units, titan = U.spawn('titan', 0, 0, 22), scout = U.spawn('scout', 1, -14, 0);
    scout.hp = scout.maxHp = 1e6; scout.t = { ...scout.t, range: 0.1 };
    // (The Titan has no orders, so it guards: it may step forward to keep sight of the Scout in its craters.)
    if (moving) U.order([scout], 'move', 14, 0);
    let back = false;
    w.run(30, () => {
      if (moving && scout.mover.state === 'idle') { U.order([scout], 'move', back ? 14 : -14, 0); back = !back; }
      return false;
    });
    return scout.maxHp - scout.hp;
  };
  const still = dmg(false), dodging = dmg(true);
  check(dodging < still * 0.6, `a Scout running across a Titan's front takes far less shell damage than one standing still (${dodging.toFixed(0)} vs ${still.toFixed(0)})`);
}

// ---------- Titans flatten trees; shells knock them down ----------
{
  const trees = []; for (let z = -20; z <= 20; z += 2.5) trees.push(newTree(0.5, z));
  const w = world(() => 0, { trees }), U = w.units, t = U.spawn('titan', 0, 0, -30);
  U.order([t], 'move', 0, 30);
  w.run(25);
  const flat = w.forest.trees.filter(tr => tr.state === TREE.FALLEN).length;
  check(flat >= trees.length * 0.7, `a Titan walking down a line of trees flattens them (${flat} of ${trees.length})`);
}

// ---------- orders ----------
{
  const w = world(), U = w.units;
  const a = U.spawn('assault', 0, -15, 40), m = U.spawn('assault', 0, 15, 40);
  const foe = U.spawn('titan', 1, 0, 0); foe.hp = foe.maxHp = 1e6; foe.t = { ...foe.t, range: 0.1 };
  U.order([a], 'amove', -15, -60); U.order([m], 'move', 15, -60);
  w.run(12);
  check(a.z > -5 && m.z < -20, `attack-move stops to fight (z ${a.z.toFixed(0)}); move walks on past (z ${m.z.toFixed(0)})`);
  check(a.cool < a.t.rof && U.stats.shots > 10, 'both fire on the way (the torso turns independently of the legs)');
}
{
  const w = world(), U = w.units, a = U.spawn('assault', 0, 0, 50);
  const near = U.spawn('scout', 1, 0, 20), far = U.spawn('scout', 1, 40, -30);
  near.t = far.t = { ...near.t, range: 0.1 };
  U.attack([a], far);
  w.run(40, () => !far.alive);
  check(!far.alive && near.alive, 'an attack order goes after its target and ignores a closer enemy');
}

// ---------- move orders are obeyed, even in a fight ----------
{
  const w = world(), U = w.units;
  const mine = [U.spawn('assault', 0, -4, 10), U.spawn('assault', 0, 4, 10)];
  const foes = [U.spawn('assault', 1, -4, -8), U.spawn('assault', 1, 4, -8)];
  for (const f of foes) { f.hp = f.maxHp = 1e6; }
  for (const u of mine) { u.hp = u.maxHp = 1e6; }
  U.stop(foes);
  w.run(4);
  check(U.stats.shots > 4 && mine.every(u => u.target), 'two squads are trading fire');
  // Pull back, out of the fight.
  U.order(mine, 'move', 0, 60);
  let stalled = 0;
  w.run(20, () => { if (mine.some(u => u.mover.state === 'idle' && u.z < 50)) stalled++; return mine.every(u => u.mover.state === 'idle' && u.z > 50); });
  check(mine.every(u => u.z > 50) && stalled < 10, `a move order pulls engaged mechs out of the fight (now at z ${mine.map(u => u.z.toFixed(0)).join(', ')})`);
  check(mine.every(u => u.order === 'idle' && u.hold), 'once there, they hold their ground');
  // The enemy follows to 30 away (out of range, inside the old chase distance): they stay put.
  for (const f of foes) f.mover.speedMult = 1;
  U.order(foes, 'move', 0, 60 - 32);
  w.run(10);
  const moved = Math.max(...mine.map(u => Math.hypot(u.x - u.guard.x, u.z - u.guard.z)));
  check(moved < 1.5, `holding: they don't go chasing enemies out of range (moved ${moved.toFixed(1)})`);
  // ... but they shoot whatever comes into range.
  const shots0 = U.stats.shots;
  U.order(foes, 'move', 0, 60 - 15);
  w.run(6);
  check(mine.every(u => u.target) && U.stats.shots > shots0 + 4, 'and they shoot enemies that come into range');
  // Fresh mechs (no orders yet) still guard: they go after a nearby enemy.
  const g = world(), gu = g.units.spawn('assault', 0, 0, 30), gf = g.units.spawn('scout', 1, 0, 0);
  gf.t = { ...gf.t, range: 0.1 }; g.units.order([gf], 'move', 0, 4);
  g.run(6);
  check(gu.z < 29, `a mech that hasn't been given orders still guards (goes after an enemy 26 away; now at z ${gu.z.toFixed(0)})`);
  // Re-ordering mid-fight takes effect at once.
  const r = world(), ra = r.units.spawn('assault', 0, 0, 10), rf = r.units.spawn('titan', 1, 0, -6);
  rf.hp = rf.maxHp = 1e6; r.units.stop([rf]);
  r.units.order([ra], 'amove', 0, -40);
  r.run(3);
  const zA = ra.z;
  r.units.order([ra], 'move', 40, 30);
  r.run(2);
  check(Math.abs(zA) < 30 && ra.x > 5, `an A-Move that stopped to fight can be overridden by a move order (x ${ra.x.toFixed(0)})`);
}

// ---------- the Medium Mech sits between the Light and Heavy ----------
{
  const T = (await import('../src/config.js')).UNIT_TYPES, L = T.scout, M = T.medium, H = T.assault;
  check(L.name === 'Light Mech' && M.name === 'Medium Mech' && H.name === 'Heavy Mech' && T.titan.name === 'Assault Mech', 'names: Light, Medium, Heavy and Assault Mechs');
  check(L.cost < M.cost && M.cost < H.cost && L.hp < M.hp && M.hp < H.hp, `Medium costs and takes more than a Light, less than a Heavy (cost ${L.cost} < ${M.cost} < ${H.cost}, hp ${L.hp} < ${M.hp} < ${H.hp})`);
  const sp = t => [9, 6, 3.6][t.cls] * (t.speed || 1);
  check(sp(L) > sp(M) && sp(M) > sp(H), `and is quicker than a Heavy, slower than a Light (${sp(L)} > ${sp(M)} > ${sp(H)})`);
  const duel = (a, b, seed) => {
    const w = world(() => 0, { seed }), U = w.units, x = U.spawn(a, 0, 0, 12), y = U.spawn(b, 1, 0, -12);
    U.stop([x, y]); x.hold = y.hold = false;
    w.run(60, () => !x.alive || !y.alive);
    return x.alive && !y.alive ? a : y.alive && !x.alive ? b : 'draw';
  };
  const r1 = [1, 2, 3].map(s => duel('medium', 'scout', s)), r2 = [1, 2, 3].map(s => duel('medium', 'assault', s));
  check(r1.filter(r => r === 'medium').length >= 2, `one on one, a Medium usually beats a Light (${r1.join(', ')})`);
  check(r2.filter(r => r === 'assault').length >= 2, `and usually loses to a Heavy (${r2.join(', ')})`);
  const w = world(), U = w.units, m = U.spawn('medium', 0, 0, 10), e = U.spawn('assault', 1, 0, -8);
  e.hp = e.maxHp = 1e6; U.stop([e]);
  w.run(4);
  check(U.stats.shots > 4 && w.damage.log.some(l => l.weapon === 'autocannon'), `it fires its autocannon (${U.stats.shots} shots)`);
}

// ---------- performance: 40 v 40 ----------
{
  const w = world((x, z) => Math.sin(x / 13) * 2 + Math.cos(z / 11) * 2), U = w.units, A = [], B = [];
  for (let k = 0; k < 40; k++) { A.push(U.spawn(['scout', 'assault', 'titan'][k % 3], 0, -60 + (k % 10) * 12, 60 + Math.floor(k / 10) * 8)); B.push(U.spawn(['scout', 'assault', 'titan'][k % 3], 1, -60 + (k % 10) * 12, -60 - Math.floor(k / 10) * 8)); }
  U.order(A, 'amove', 0, -60); U.order(B, 'amove', 0, 60);
  w.run(10);
  const t0 = performance.now();
  w.run(5);
  const ms = (performance.now() - t0) / (5 * 60);
  check(ms < 6, `80 mechs: one simulation step (movement, targeting, line of sight, projectiles) takes ${ms.toFixed(2)} ms here`);
  check(finite(w), 'no NaN in the big battle');
}

// ---------- the Assault Mech fires a stream of small missiles ----------
{
  const w = world(), U = w.units;
  const a = U.spawn('titan', 0, 0, 20), e = U.spawn('assault', 1, 0, -6);
  e.t = { ...e.t, range: 0.1 }; e.hp = e.maxHp = 1e6;
  U.stop([e]); U.stop([a]);
  const T = a.t, seen = [];
  let t = 0;
  for (; t < 6 && seen.length < T.salvo; t += 1 / 60) {
    w.nav.update(); w.movers.step(1 / 60); U.step(1 / 60);
    for (const p of U.projectiles.list) if (!seen.includes(p)) { p.launchT = t; seen.push(p); }
  }
  const spread = seen.length ? seen[seen.length - 1].launchT - seen[0].launchT : 0;
  check(T.dmg === 75 && T.splash === 3 && T.proj === 'missile', `Assault Mech: damage ${T.dmg} a salvo, splash ${T.splash}, missiles`);
  check(seen.length === T.salvo && seen.every(p => p.kind === 'missile'), `a salvo is a stream of ${seen.length} missiles`);
  check(Math.abs(spread - (T.salvo - 1) * T.salvoGap) < 0.05, `launched one after another over ${spread.toFixed(2)} s`);
  check(Math.abs(seen.reduce((s, p) => s + p.dmg, 0) - T.dmg) < 1e-6 && seen.every(p => p.splash === 3), `together they carry its ${T.dmg} damage, each with a splash of 3`);
  check(new Set(seen.map(p => `${p.from.x.toFixed(2)},${p.from.y.toFixed(2)}`)).size >= 3, 'from its barrels in turn');
  const hp0 = e.hp;
  w.run(4);
  check(e.hp < hp0 && U.projectiles.list.length === 0, `they land on the target (${(hp0 - e.hp).toFixed(0)} damage)`);
  check(finite(w), 'no NaN');
}

done();
