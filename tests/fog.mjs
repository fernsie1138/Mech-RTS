// Fog of war browser test: unexplored ground is dark and explored ground dim; enemies out of sight aren't drawn,
// can't be tapped and aren't on the minimap; scouting reveals them; the Dev Fog button turns it off. Screenshots.
// Run: node tests/fog.mjs
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
await page.goto(server.url);
await page.waitForFunction(() => window.__game?.ready, null, { timeout: 30000 });
await page.evaluate(() => { const c = window.__game.config.CAMERA; c.tapMaxTime = 1e5; });
await page.tap('#btnStart');
await page.evaluate(() => { const G = window.__game; G.pause(); G.ai.step = () => {}; });
const g = fn => page.evaluate(fn);

// Average brightness of the 3D view in a screen rectangle (fractions of the screen), right after a render.
const bright = (x0, y0, x1, y1) => page.evaluate(([x0, y0, x1, y1]) => {
  const G = window.__game; G.render();
  const src = G.renderer.domElement, c = document.createElement('canvas');
  c.width = src.width; c.height = src.height;
  const k = c.getContext('2d'); k.drawImage(src, 0, 0);
  const d = k.getImageData(x0 * c.width, y0 * c.height, (x1 - x0) * c.width, (y1 - y0) * c.height).data;
  let s = 0; for (let i = 0; i < d.length; i += 4) s += d[i] + d[i + 1] + d[i + 2];
  return s / (d.length / 4) / 3;
}, [x0, y0, x1, y1]);

check(await g(() => window.__game.fog.on), 'fog of war is on in a match');
// Look up the map from your HQ: your own area near the bottom of the screen, unexplored ground at the top.
await g(() => { const G = window.__game, h = G.map.markers.playerHQ; G.rts.target.set(h.x, 0, h.z - 60); G.rts.distance = 140; G.rts.yaw = 0; G.rts.update(0); G.fogView.snap(G.vision); });
const near = await bright(0.35, 0.8, 0.65, 0.95), far = await bright(0.35, 0.05, 0.65, 0.25);
await page.screenshot({ path: join(out, 'fog-start.png') });
await g(() => window.__game.setFog(false));
const farClear = await bright(0.35, 0.05, 0.65, 0.25);
await g(() => { window.__game.setFog(true); window.__game.fogView.snap(window.__game.vision); });
check(far < farClear * 0.3 && near > far * 3, `unexplored ground is dark (brightness ${far.toFixed(0)}, or ${farClear.toFixed(0)} without fog; your area ${near.toFixed(0)})`);
check(await g(() => !window.__game.vision.sees(0, window.__game.units.structures[1]) && !window.__game.vision.isExplored(0, 0, -108)), 'the enemy HQ starts hidden in unexplored fog');

// An enemy squad out of sight: not drawn, not tappable, not on the minimap.
const foe = await g(() => {
  const G = window.__game, h = G.map.markers.playerHQ;
  const sq = G.spawnSquad(1, h.x + 30, h.z - 95, ['assault', 'assault', 'assault']);
  for (const u of sq) { u.t = { ...u.t, range: 0.1 }; G.units.stop([u]); }
  G.step(1);
  G.rts.target.set(h.x + 30, 0, h.z - 85); G.rts.distance = 70; G.rts.update(0); G.render();
  const u = sq[1], p = G.commander.screen(u);
  return { id: u.id, x: u.x, z: u.z, sx: p.x, sy: p.y, seen: G.vision.sees(0, u), shown: G.mechView.shown(u) };
});
check(!foe.seen && !foe.shown, 'an enemy squad out of sight is hidden');
const cdp = await ctx.newCDPSession(page);
await g(() => { const G = window.__game; G.commander.setSelection(G.commander.mine()); });
await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: foe.sx, y: foe.sy, id: 0, radiusX: 1, radiusY: 1, force: 1 }] });
await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
await page.waitForTimeout(200);
check(await g(() => window.__game.commander.mine().every(u => u.order !== 'attack')), 'tapping where a hidden enemy stands is a move order, not an attack');
// Call them back home (out of sight of the enemy squad).
await g(() => { const G = window.__game, h = G.map.markers.playerHQ; G.units.order(G.commander.mine(), 'move', h.x, h.z - 22); G.step(12); });
const mmRed = () => page.evaluate(([x, z]) => {
  const G = window.__game, m = G.minimap; m.update(1);
  const [px, py] = m.toMap(x, z), d = m.ctx.getImageData(px - 2, py - 2, 5, 5).data;
  let red = 0; for (let i = 0; i < d.length; i += 4) if (d[i] > 200 && d[i + 1] < 120) red++;
  return red;
}, [foe.x, foe.z]);
check(await mmRed() === 0, 'hidden enemies are not on the minimap');
await page.screenshot({ path: join(out, 'fog-hidden.png') });

// Scout them out.
const seen = await g(() => {
  const G = window.__game, h = G.map.markers.playerHQ;
  const s = G.spawnSquad(0, h.x + 37, h.z - 68, ['scout'])[0];
  G.step(1.5); G.render();
  return { seen: G.units.list.filter(u => u.team === 1 && u.alive && Math.hypot(u.x - (h.x + 30), u.z - (h.z - 95)) < 15).every(u => G.vision.sees(0, u)), cell: G.vision.isVisible(0, h.x + 30, h.z - 95), id: s.id };
});
check(seen.seen && seen.cell, 'a Scout within sight reveals them, and the ground round them');
check(await mmRed() > 0, 'now they show on the minimap');
await g(() => window.__game.fogView.snap(window.__game.vision));
await g(() => window.__game.render());
await page.screenshot({ path: join(out, 'fog-scouted.png') });
// Pull the Scout back: they vanish again, but the ground stays explored.
const gone = await g(() => {
  const G = window.__game, h = G.map.markers.playerHQ, s = G.units.list.find(u => u.team === 0 && u.type === 'scout' && u.z < h.z - 40);
  G.units.order([s], 'move', h.x + 30, h.z - 10);
  G.step(10);
  return { seen: G.units.list.filter(u => u.team === 1 && u.alive).some(u => G.vision.sees(0, u)), explored: G.vision.isExplored(0, h.x + 30, h.z - 95), visible: G.vision.isVisible(0, h.x + 30, h.z - 95) };
});
check(!gone.seen && gone.explored && !gone.visible, 'when the Scout leaves they are hidden again; the ground stays explored (dimmed)');
await g(() => { window.__game.fogView.snap(window.__game.vision); window.__game.render(); });
await page.screenshot({ path: join(out, 'fog-explored.png') });

// Dev: Fog off shows everything.
await page.tap('#btnDev');
await page.tap('#btnFog');
check(await g(() => !window.__game.fog.on && window.__game.mechView.shown(window.__game.units.list.find(u => u.team === 1))), 'the Dev Fog button turns fog of war off (everything shown)');
await g(() => window.__game.render());
await page.screenshot({ path: join(out, 'fog-off.png') });

check(w.errors.length === 0, `no console/page errors${w.errors.length ? ':\n   ' + w.errors.join('\n   ') : ''}`);
await browser.close();
await server.close();
done();
