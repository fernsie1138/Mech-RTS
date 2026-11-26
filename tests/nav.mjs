// Milestone 6 browser test: Move mode, selection, squads, the nav overlay, and routing over / round a bridge.
// Run: node tests/nav.mjs
import { serve, outDir, playwright, checker, watchPage } from './harness.mjs';
import { join } from 'node:path';

const { chromium, devices } = playwright;
const { check, done } = checker();
const out = await outDir();
const server = await serve();
const browser = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
const ctx = await browser.newContext({ ...devices['iPad Pro 11 landscape'] });
const page = await ctx.newPage();
const w = watchPage(page, server.url);
await page.goto(server.url + '?sandbox');
await page.waitForFunction(() => window.__game?.ready, null, { timeout: 30000 });
await page.evaluate(() => { const c = window.__game.config.CAMERA; c.tapMaxTime = 1e5; window.__game.pause(); });
const cdp = await ctx.newCDPSession(page);
const tap = async (x, y) => { await page.waitForTimeout(400); await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x, y, id: 0, radiusX: 1, radiusY: 1, force: 1 }] }); await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] }); await page.waitForTimeout(200); };
const units = () => page.evaluate(() => window.__game.units.list.filter(u => u.alive && u.team === 0).map(u => ({ x: u.x, z: u.z, cls: u.t.cls, state: u.mover.state, order: u.order, sel: window.__game.selected.has(u) })));
const screen = (x, z) => page.evaluate(([x, z]) => { const g = window.__game, v = new g.THREE.Vector3(x, g.nav.standHeight(x, z) + 1, z).project(g.camera); return [(v.x + 1) / 2 * innerWidth, (1 - v.y) / 2 * innerHeight]; }, [x, z]);

const u0 = await units();
check(u0.length === 3 && u0.every(u => u.sel) && u0.map(u => u.cls).join() === '0,1,2', 'the game starts with a selected test squad (Scout, Assault, Titan)');
check(await page.evaluate(() => document.querySelector('[data-weapon="move"]').classList.contains('on')), 'Command mode is on by default');

// Tap the ground: the squad moves there.
const target = await page.evaluate(() => { const g = window.__game, h = g.map.markers.playerHQ; g.rts.target.set(h.x + 10, 0, h.z - 40); g.rts.distance = 70; g.rts.yaw = 0; g.rts.update(0); g.render(); return { x: h.x + 10, z: h.z - 40 }; });
await page.waitForTimeout(300);
const [tx, ty] = await screen(target.x, target.z);
await tap(tx, ty);
await page.evaluate(() => { window.__game.step(0.5); window.__game.render(); });
await page.screenshot({ path: join(out, 'nav-move.png') });
await page.evaluate(() => window.__game.step(25));
const u1 = await units();
const near = u1.filter(u => Math.hypot(u.x - target.x, u.z - target.z) < 12).length;
check(near === 3 && u1.every(u => u.state === 'idle'), `a tap on the ground sends the squad there (${near} of 3 arrived)`);

// Tap one unit: only it is selected. All selects everything. +Squad adds three more.
await page.evaluate(() => window.__game.render());
const titan = u1.find(u => u.cls === 2);
const [ux, uy] = await screen(titan.x, titan.z);
await tap(ux, uy);
const sel = (await units()).filter(u => u.sel);
check(sel.length === 1 && sel[0].cls === 2, 'tapping a unit selects just that unit');
await page.tap('#btnAll');
check((await units()).every(u => u.sel), 'All selects every unit');
await page.tap('#btnSpawn');
check((await units()).length === 6, '+Squad adds three units');

// Nav overlay.
await page.tap('#btnNav');
const ov = await page.evaluate(() => { const g = window.__game; g.render(); return { on: document.getElementById('btnNav').classList.contains('on'), fn: typeof g.view.terrain.overlay }; });
check(ov.on && ov.fn === 'function', 'the Nav button turns on the overlay');

// Across the river by the bridge; then with the bridge shelled, the units stop at the near bank.
const br = await page.evaluate(() => {
  const g = window.__game, b = g.buildings.list.find(b => b.def.type === 'bridge').def;
  const mine = g.units.list.filter(u => u.alive && u.team === 0); mine.forEach(u => g.selected.add(u));
  const west = { x: b.x - 30, z: b.z - 8 };
  g.units.order(mine, 'move', west.x, west.z);
  g.step(45);
  const crossed = mine.filter(m => m.x < b.x - 10).length;
  g.rts.target.set(b.x, 0, b.z); g.rts.distance = 70; g.rts.update(0); g.render();
  return { b, crossed, n: mine.length };
});
check(br.crossed === br.n, `all ${br.n} units cross the river by the bridge (${br.crossed})`);
await page.screenshot({ path: join(out, 'nav-bridge.png') });
const cut = await page.evaluate(b => {
  const g = window.__game;
  for (let n = 0; n < 6 && g.buildings.list.find(x => x.def.type === 'bridge').state !== 'broken'; n++) g.damage.explode(b.x, b.z, 'shell', b.y);
  g.step(1);
  const mine = g.units.list.filter(u => u.alive && u.team === 0); g.units.order(mine, 'move', b.x + 40, b.z + 10);       // back east: no way across now
  g.step(40);
  return { closest: Math.min(...mine.map(m => Math.hypot(m.x - (b.x + 40), m.z - (b.z + 10)))), wet: mine.filter(m => !g.nav.passable(m.t.cls, m.x, m.z)).length, states: mine.map(m => m.mover.state), west: mine.filter(m => m.x < b.x).length, n: mine.length, deck: g.buildings.deckAt(b.x, b.z) };
}, br.b);
check(cut.deck === null && cut.closest > 25 && cut.wet === 0 && cut.states.every(s => s === 'idle'), `with the bridge down, the units can't cross: they wait on the near bank (closest ${cut.closest.toFixed(0)} from the target across the river; deck ${cut.deck}, on impassable ground ${cut.wet}, states ${cut.states.join(",")})`);
await page.evaluate(() => window.__game.render());
await page.screenshot({ path: join(out, 'nav-bridge-cut.png') });

check(w.errors.length === 0, `no console/page errors${w.errors.length ? ':\n   ' + w.errors.join('\n   ') : ''}`);
await browser.close();
await server.close();
done();
