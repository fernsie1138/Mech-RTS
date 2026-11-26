// v9 browser test: explosion / fire / smoke particles, building fires, and the editor's building rotate & move.
// Run: node tests/effects.mjs
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

// ---- one shell on open ground ----
const e1 = await page.evaluate(() => {
  const g = window.__game, E = g.effects; g.pause();
  const h = g.map.markers.playerHQ, x = h.x + 25, z = h.z - 45;
  g.fireAt(x, z, 'shell');
  const c0 = E.counts(), light0 = E.light.intensity;
  g.step(0.1);
  const cx = () => { let s = 0, n = 0; for (let i = 0; i < E.smoke.used; i++) if (E.smoke.age[i] < E.smoke.life[i]) { s += E.smoke.px[i] - x + (E.smoke.pz[i] - z) * 0.5; n++; } return n ? s / n : 0; };
  const d0 = cx();
  g.step(3);
  const c3 = E.counts(), d3 = cx(), light3 = E.light.intensity;
  g.step(6);
  const c9 = E.counts();
  g.step(8);
  return { c0, c3, c9, c17: E.counts(), light0, light3, drift: d3 - d0 };
});
check(e1.c0.fire > 10 && e1.c0.smoke > 20 && e1.c0.debris > 10 && e1.c0.sparks > 10 && e1.c0.rings === 1, `a shell makes a fireball (${e1.c0.fire}), smoke (${e1.c0.smoke}), debris (${e1.c0.debris}), sparks (${e1.c0.sparks}) and a shockwave ring`);
check(e1.light0 > 50 && e1.light3 === 0, `the flash lights up the ground, then fades (${e1.light0.toFixed(0)} -> ${e1.light3})`);
check(e1.c3.smoke > 20 && e1.c9.smoke > 5, `the smoke lingers (${e1.c3.smoke} puffs at 3 s, ${e1.c9.smoke} at 9 s)`);
check(e1.drift > 2, `the smoke drifts downwind (${e1.drift.toFixed(1)} units in 3 s)`);
check(Object.values(e1.c17).every(v => v === 0), 'after ~17 s every particle is gone and back in its pool');

// ---- a barrage stays within the pools ----
const bar = await page.evaluate(() => {
  const g = window.__game, E = g.effects;
  for (let k = 0; k < 30; k++) g.fireAt(-20 + (k % 6) * 8, 20 + Math.floor(k / 6) * 8, 'shell');
  const t0 = performance.now(); for (let k = 0; k < 30; k++) E.update(1 / 60); const ms = (performance.now() - t0) / 30;
  return { c: E.counts(), caps: E.pools.map(p => [p.alive, p.max]), ms };
});
check(bar.caps.every(([a, m]) => a <= m), `30 shells at once stay within the particle pools (${bar.caps.map(c => c.join('/')).join(', ')})`);
check(bar.ms < 12, `updating a full barrage's particles takes ${bar.ms.toFixed(1)} ms per frame here`);
await page.evaluate(() => { const g = window.__game; g.rts.target.set(0, 0, 40); g.rts.distance = 70; g.rts.update(0); g.step(0.8); g.view.update(0.8); g.render(); });
await page.screenshot({ path: join(out, 'effects-barrage.png') });
await page.evaluate(() => window.__game.step(20));

// ---- a hit building burns for a while; a fire on a piece that falls goes out ----
const fire = await page.evaluate(() => {
  const g = window.__game, E = g.effects, B = g.buildings, b = B.list.find(b => b.def.type === 'house');
  g.damage.explode(b.def.x + 4, b.def.z, 'shell', b.y + 2.5);
  const n0 = E.burners.length;
  g.step(4); const n4 = E.burners.length;
  g.rts.target.set(b.def.x, 0, b.def.z); g.rts.distance = 40; g.rts.update(0); g.view.update(0.1); g.render();
  g.step(10); const n14 = E.burners.length;
  return { n0, n4, n14 };
});
check(fire.n0 > 0 && fire.n4 > 0 && fire.n14 === 0, `a hit house catches fire (${fire.n0} fires), still burning at 4 s (${fire.n4}), out by 14 s`);
const early = await page.evaluate(() => {
  const g = window.__game, E = g.effects, B = g.buildings, b = B.list.filter(b => b.def.type === 'house')[1];
  g.damage.explode(b.def.x + 4, b.def.z, 'shell', b.y + 2.5);
  const n = E.burners.length;
  for (let k = 0; k < 12; k++) g.damage.explode(b.def.x, b.def.z, 'shell', b.y + 3);    // knock the whole house down
  g.step(0.2);
  return { n, after: E.burners.filter(f => f.alive).length, state: b.state };
});
check(early.n > 0 && early.after === 0 && early.state === 'rubble', 'fires on wall pieces go out when those pieces fall');

// ---- editor: rotate with the angle slider, drag to move, undo ----
await page.goto(server.url + 'editor.html');
await page.waitForFunction(() => window.__editor?.ready, null, { timeout: 30000 });
await page.evaluate(() => { const c = window.__editor.config.CAMERA; c.tapMaxTime = 1e5; c.strokeHoldMs = 1e9; });
const sel = await page.evaluate(() => {
  const e = window.__editor, i = e.map.buildings.findIndex(b => b.type === 'house'), d = e.map.buildings[i];
  e.selectTool('house'); e.select(i);
  e.view.rts.target.set(d.x, e.map.hf.heightAt(d.x, d.z), d.z); e.view.rts.distance = 45; e.view.rts.yaw = 0; e.view.rts.update(0);
  return { i, rot: d.rot, x: d.x, z: d.z, label: document.getElementById('bname').textContent };
});
check(/^House: \d+°$/.test(sel.label), `the panel names the selected building and its angle ("${sel.label}")`);
await page.evaluate(() => { const s = document.getElementById('bangle'); s.value = 90; s.dispatchEvent(new Event('input')); });
const live = await page.evaluate(i => ({ rot: window.__editor.map.buildings[i].rot, undo: window.__editor.history.undoStack.length }), sel.i);
await page.evaluate(() => document.getElementById('bangle').dispatchEvent(new Event('change')));
const committed = await page.evaluate(i => ({ rot: window.__editor.map.buildings[i].rot, undo: window.__editor.history.undoStack.length, label: document.getElementById('bname').textContent, pieceRot: window.__editor.view.buildings.list[i].def.rot }), sel.i);
check(Math.abs(live.rot - Math.PI / 2) < 1e-6 && live.undo === 0, 'the Angle slider turns the selected building live');
check(committed.undo === 1 && committed.label === 'House: 90°' && Math.abs(committed.pieceRot - Math.PI / 2) < 1e-6, 'releasing the slider makes it one undo step, and the building is drawn turned');
// Drag it 10 units east with one finger.
await page.waitForTimeout(500);
const [sx, sy] = await page.evaluate(({ x, z }) => { const e = window.__editor, v = new e.THREE.Vector3(x, e.map.hf.heightAt(x, z) + 1, z).project(e.view.camera); return [(v.x + 1) / 2 * innerWidth, (1 - v.y) / 2 * innerHeight]; }, sel);
const [ex] = await page.evaluate(({ x, z }) => { const e = window.__editor, v = new e.THREE.Vector3(x + 10, e.map.hf.heightAt(x, z) + 1, z).project(e.view.camera); return [(v.x + 1) / 2 * innerWidth]; }, sel);
const cdp = await ctx.newCDPSession(page);
const touch = (type, pts) => cdp.send('Input.dispatchTouchEvent', { type, touchPoints: pts.map((p, i) => ({ x: p[0], y: p[1], id: i, radiusX: 1, radiusY: 1, force: 1 })) });
await touch('touchStart', [[sx, sy]]);
for (let k = 1; k <= 8; k++) await touch('touchMove', [[sx + (ex - sx) * k / 8, sy]]);
await page.waitForTimeout(300);
await touch('touchEnd', []);
await page.waitForTimeout(300);
const moved = await page.evaluate(i => ({ x: window.__editor.map.buildings[i].x, z: window.__editor.map.buildings[i].z, undo: window.__editor.history.undoStack.length }), sel.i);
check(Math.abs(moved.x - (sel.x + 10)) < 1.5 && Math.abs(moved.z - sel.z) < 1.5 && moved.undo === 2, `dragging the selected house moves it (${(moved.x - sel.x).toFixed(1)} east)`);
await page.screenshot({ path: join(out, 'effects-editor-rotated.png') });
await page.tap('#btnUndo'); await page.tap('#btnUndo');
const back = await page.evaluate(i => window.__editor.map.buildings[i], sel.i);
check(Math.abs(back.x - sel.x) < 1e-6 && Math.abs(back.rot - sel.rot) < 1e-6, 'two undos put it back where and how it was');

check(w.errors.length === 0, `no console/page errors${w.errors.length ? ':\n   ' + w.errors.join('\n   ') : ''}`);
await browser.close();
await server.close();
done();
