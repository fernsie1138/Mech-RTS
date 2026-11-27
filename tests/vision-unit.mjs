// Tests for fog of war: mechs see each other only with a clear line of sight within their sight range; the ground
// grid shows what is seen now and what was explored; hills and walls cast shadows. Pure modules, run in Node.
// Run: node tests/vision-unit.mjs
import { Heightfield } from '../src/terrain/heightfield.js';
import { Surface } from '../src/terrain/surface.js';
import { Water } from '../src/terrain/water.js';
import { Forest, newTree } from '../src/world/forest.js';
import { Buildings } from '../src/world/buildings.js';
import { NavGrid } from '../src/nav/navgrid.js';
import { Movers } from '../src/units/movers.js';
import { Units } from '../src/units/units.js';
import { Damage } from '../src/combat/damage.js';
import { Vision } from '../src/game/vision.js';
import { Match } from '../src/game/match.js';
import { EnemyAI } from '../src/ai/enemy.js';
import { TERRAIN, MAP_SIZE, UNIT_TYPES } from '../src/config.js';
import { checker } from './harness.mjs';

const { check, done } = checker();
function world(fn = () => 0, { trees = [], buildings = [] } = {}) {
  const hf = new Heightfield({ size: MAP_SIZE, cells: TERRAIN.cells, bedrock: TERRAIN.bedrock, maxSlope: TERRAIN.maxSlope });
  hf.generate(fn);
  const surface = new Surface(hf);
  const w = { hf, surface, water: new Water(hf, surface), forest: new Forest(trees, MAP_SIZE, 1), buildings: new Buildings(buildings, hf) };
  w.nav = new NavGrid(w);
  w.movers = new Movers(w.nav);
  w.damage = new Damage(w);
  w.units = new Units(w, w.movers, w.damage, 3);
  w.vision = new Vision(w, w.units, { teams: [0, 1] });
  w.run = secs => { for (let t = 0; t < secs; t += 1 / 60) { w.nav.update(); w.movers.step(1 / 60); w.units.step(1 / 60); w.match?.step(1 / 60); w.ai?.step(1 / 60); w.vision.update(1 / 60); } };
  return w;
}
const still = (w, ...us) => { for (const u of us) { u.t = { ...u.t, range: 0.1 }; w.units.stop([u]); } };

// ---------- mechs see each other only with line of sight, within sight range ----------
{
  const w = world((x, z) => Math.max(0, 10 - Math.abs(z) * 0.8));     // a ridge along z = 0
  const a = w.units.spawn('assault', 0, 0, 25), b = w.units.spawn('assault', 1, 0, -25), c = w.units.spawn('scout', 1, 20, 25);
  still(w, a, b, c);
  w.run(1);
  check(!w.vision.sees(0, b), 'a mech can\'t see an enemy on the other side of a ridge');
  check(w.vision.sees(0, c) && w.vision.sees(1, a), 'mechs on the same side, in the open, see each other');
  check(w.vision.sees(0, a), 'a side always sees its own mechs');
  const far = world(), p = far.units.spawn('assault', 0, 0, 30), q = far.units.spawn('assault', 1, 0, 30 - UNIT_TYPES.assault.sight - 8);
  still(far, p, q); far.run(1);
  check(!far.vision.sees(0, q), `beyond its sight range (${UNIT_TYPES.assault.sight}) a mech sees nothing, even in the open`);
  const s = far.units.spawn('scout', 0, 3, 30); still(far, s); far.run(1);
  check(far.vision.sees(0, q), `a Scout sees further (${UNIT_TYPES.scout.sight})`);
  // Once out of sight, it disappears again soon after.
  far.units.kill(s);
  far.run(1.5);
  check(!far.vision.sees(0, q), 'when nothing has sight of it any more, it is hidden again');
}

// ---------- detection factor (stealth) ----------
{
  const w = world(), U = w.units, sc = U.spawn('scout', 0, 0, 40), st = U.spawn('assault', 1, 0, 40 - 30), norm = U.spawn('assault', 1, 25, 40 - 30);
  st.t = { ...st.t, detect: 50 };                          // a stealthy unit: seen at half the usual distance
  still(w, sc, st, norm);
  w.run(1);
  check(w.vision.sees(0, norm) && !w.vision.sees(0, st), `a stealthy (50%) mech 30 away is not seen by a Light Mech (sight ${sc.t.sight}), a normal one beside it is`);
  check(w.vision.isVisible(0, st.x, st.z), 'the ground it stands on is still clear of fog');
  const shots0 = U.stats.shots;
  const sh = U.spawn('scout', 0, 2, 40); sh.t = { ...sh.t, range: 32 };   // in range, but it can't see it
  U.attack([sh], st);
  U.stop([sh]); U.attack([sh], st);
  w.run(0.5);
  const fired = U.list.filter(u => u.team === 0).some(u => u.target === st);
  check(!fired, 'nobody targets the stealthy mech while it is unseen');
  sc.mover.x = sc.x = 0; sc.mover.z = sc.z = 40 - 30 + 20;   // a Light Mech walks up to 20 away (within 46 x 50% = 23)
  w.run(1);
  check(w.vision.sees(0, st), 'within sight x detection factor (23), it is spotted');
  check(U.stats.shots >= shots0, 'and can then be fired on');
}

// ---------- walls block sight; trees don't ----------
{
  const w = world(() => 0, { buildings: [{ type: 'wall', x: 0, z: 0, rot: 0 }, { type: 'wall', x: 10, z: 0, rot: 0 }, { type: 'wall', x: -10, z: 0, rot: 0 }] });
  const a = w.units.spawn('scout', 0, 0, 3.5), b = w.units.spawn('scout', 1, 0, -3.5);
  still(w, a, b); w.run(1);
  check(!w.vision.sees(0, b), 'two Scouts either side of a wall can\'t see each other');
  const trees = []; for (let x = -6; x <= 6; x += 2) for (let z = -6; z <= 6; z += 2) trees.push(newTree(x, z));
  const f = world(() => 0, { trees }), c = f.units.spawn('assault', 0, 0, 15), d = f.units.spawn('assault', 1, 0, -15);
  still(f, c, d); f.run(1);
  check(f.vision.sees(0, d), 'trees don\'t block sight');
}

// ---------- the ground grid: seen, explored, and hill shadows ----------
{
  const w = world((x, z) => (Math.abs(z + 20) < 6 ? 9 - Math.abs(z + 20) * 0.5 : 0));   // a ridge across z = -20
  const v = w.vision, a = w.units.spawn('assault', 0, 0, 5);
  still(w, a);
  w.run(0.5);
  check(v.isVisible(0, 0, 0) && v.isVisible(0, 20, 5) && v.isVisible(0, 0, -15), 'ground near a mech and up to the ridge is seen');
  check(!v.isVisible(0, 0, -28), 'the ground just behind the ridge is hidden from it (a hill shadow)');
  check(!v.isVisible(0, 0, 60) && !v.isVisible(0, 100, 5), 'ground beyond its sight range is not seen');
  const seen = v.visible[0].reduce((s, x) => s + x, 0);
  check(seen > 300 && seen < 0.07 * v.n * v.n, `it sees ${seen} cells of ${v.n * v.n}`);
  // Walk it away: what it saw stays explored but is no longer seen.
  w.units.order([a], 'move', 0, 90);
  w.run(15);
  check(!v.isVisible(0, 0, 0) && v.isExplored(0, 0, 0) && v.isExplored(0, 20, 5), 'after it leaves, the ground it saw stays explored (but not seen)');
  check(!v.isExplored(0, 100, -100), 'ground it never saw is unexplored');
  check(v.visible[1].every(x => x === 0), 'the other side, with no units, sees nothing');
  // A wall casts a shadow on the grid too.
  const ww = world(() => 0, { buildings: [{ type: 'wall', x: 0, z: 0, rot: 0 }] }), s2 = ww.units.spawn('scout', 0, 0, 4);
  still(ww, s2); ww.run(0.5);
  check(!ww.vision.isVisible(0, 0, -3) && ww.vision.isVisible(0, 9, -3), 'a wall hides the ground right behind it (but not off to the side)');
  // Knock the wall down: the shadow goes.
  for (let n = 0; n < 10; n++) ww.damage.explode(0, 0, 'shell', 1.3);
  ww.run(0.5);
  check(ww.vision.isVisible(0, 0, -3), 'once the wall is shot down, the ground behind it can be seen');
}

// ---------- Titans can only shell what their side sees ----------
{
  const w = world((x, z) => Math.max(0, 10 - Math.abs(z - 10) * 0.9));
  const t = w.units.spawn('titan', 0, 0, 30), e = w.units.spawn('assault', 1, 0, 0);
  e.hp = e.maxHp = 1e6; still(w, e); w.units.stop([t]);
  w.run(6);
  check(!w.vision.sees(0, e) && w.units.stats.shots === 0, 'a hidden enemy is not shelled');
}

// ---------- cost: a big battle ----------
{
  const w = world((x, z) => Math.sin(x / 13) * 3 + Math.cos(z / 11) * 3);
  for (let k = 0; k < 40; k++) { w.units.spawn(['scout', 'assault', 'titan'][k % 3], 0, -60 + (k % 10) * 12, 40 + Math.floor(k / 10) * 8); w.units.spawn('assault', 1, -60 + (k % 10) * 12, -40 - Math.floor(k / 10) * 8); }
  w.units.addHQ(0, 0, 110);
  w.vision.teams = [0];
  let ms = 0; for (let n = 0; n < 10; n++) { w.vision.update(1, true); ms += w.vision.stats.ms; }
  check(ms / 10 < 12, `the player's view of 40 mechs and an HQ takes ${(ms / 10).toFixed(1)} ms here, 4 times a second`);
  // Spread over the steps in between: the most any one step does.
  let worst = 0;
  for (let n = 0; n < 60; n++) { const t0 = performance.now(); w.vision.update(1 / 60); worst = Math.max(worst, performance.now() - t0); }
  check(worst < 2.5, `spread over the simulation steps, no step spends more than ${worst.toFixed(2)} ms on it`);
}

// ---------- a match: nobody knows where the other is at first ----------
{
  const w = world();
  const m = w.match = new Match(w.units, { playerHQ: { x: 0, z: 108 }, enemyHQ: { x: 0, z: -108 }, capturePoints: [{ x: 0, z: 0 }] });
  w.run(0.5);
  check(!w.vision.sees(0, m.teams[1].hq) && !w.vision.isExplored(0, 0, -108), 'at the start the enemy HQ is hidden in unexplored fog');
  check(w.vision.isVisible(0, 0, 108) && w.vision.isVisible(0, 0, 80), 'the area round your own HQ is seen');
}

done();
