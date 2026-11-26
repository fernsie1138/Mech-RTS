// Builder browser test: build a Builder in a match, select it, and order a wall line, a turret and a trench by
// touch. Checks the panel, the preview, costs, the finished work, and that there are no errors. Screenshots.
// Run: node tests/builder.mjs
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
await page.evaluate(() => { const c = window.__game.config.CAMERA; c.tapMaxTime = 1e5; c.strokeHoldMs = 1e5; });
await page.tap('#btnStart');
// No enemy waves in this test: it checks building, and an unarmed Builder caught by a wave dies.
await page.evaluate(() => { const G = window.__game; G.pause(); G.ai.step = () => {}; });
const cdp = await ctx.newCDPSession(page);
const touch = (type, x, y) => cdp.send('Input.dispatchTouchEvent', { type, touchPoints: type === 'touchEnd' ? [] : [{ x, y, id: 0, radiusX: 1, radiusY: 1, force: 1 }] });
const tap = async (x, y) => { await touch('touchStart', x, y); await touch('touchEnd'); await page.waitForTimeout(150); };
const g = fn => page.evaluate(fn);
const screen = (x, z) => page.evaluate(([x, z]) => { const G = window.__game, v = new G.THREE.Vector3(x, G.heightAt(x, z), z).project(G.camera); return { x: (v.x + 1) / 2 * innerWidth, y: (1 - v.y) / 2 * innerHeight }; }, [x, z]);
const visible = sel => page.evaluate(s => { const e = document.querySelector(s); return !!e && getComputedStyle(e).display !== 'none'; }, sel);

// Build a Builder from the HQ.
check(await page.locator('.card[data-type="builder"]').count() === 1, 'the build buttons include the Builder');
await g(() => { window.__game.match.teams[0].credits = 2000; });
await page.tap('.card[data-type="builder"]');
const b = await g(() => { const G = window.__game; G.step(14); const b = G.units.list.find(u => u.type === 'builder'); return b && { id: b.id, x: b.x, z: b.z }; });
check(!!b, 'a Builder is built and walks out of the HQ');
// Camera over open ground in front of the HQ; select the Builder by tapping it.
const site = await g(() => { const G = window.__game, h = G.map.markers.playerHQ; const s = { x: h.x - 12, z: h.z - 45 }; G.rts.target.set(s.x + 6, 0, s.z + 8); G.rts.distance = 60; G.rts.yaw = 0; G.rts.update(0); G.commander.setSelection([]); G.render(); return s; });
await page.waitForTimeout(200);
let p = await page.evaluate(id => { const G = window.__game, u = G.units.list.find(u => u.id === id); G.render(); return G.commander.screen(u); }, b.id);
await tap(p.x, p.y);
check(await visible('#buildpanel'), 'selecting it shows the Builder panel (Wall, Turret, Trench)');
await g(() => { const G = window.__game; G.commander.setSelection(G.units.list.filter(u => u.team === 0 && u.type === 'scout')); });
await page.waitForTimeout(300);
check(!(await visible('#buildpanel')), 'the panel hides when no Builder is selected');
p = await page.evaluate(id => { const G = window.__game, u = G.units.list.find(u => u.id === id); G.commander.setSelection([u]); G.render(); return G.commander.screen(u); }, b.id);

// Wall: drag a 30-unit line.
const cr0 = await g(() => window.__game.match.teams[0].credits);
await page.tap('[data-build="wall"]');
check((await g(() => window.__game.commander.placing)) === 'wall' && await visible('#buildhint'), 'Wall: placing mode with a hint');
const a = await screen(site.x - 15, site.z), e = await screen(site.x + 15, site.z);
await g(() => { window.__game.config.CAMERA.strokeHoldMs = 0; });
await touch('touchStart', a.x, a.y);
for (let k = 1; k <= 6; k++) await touch('touchMove', a.x + (e.x - a.x) * k / 6, a.y + (e.y - a.y) * k / 6);
const prev = await g(() => (window.__game.mechView.preview || []).map(q => q.ok));
await g(() => window.__game.render());
await page.screenshot({ path: join(out, 'builder-preview.png') });
await touch('touchEnd'); await page.waitForTimeout(150);
await g(() => { window.__game.config.CAMERA.strokeHoldMs = 1e5; });
check(prev.length === 3 && prev.every(Boolean), `dragging shows a preview of the walls (${prev.length}, all buildable)`);
// The line is planned, not yet ordered: turn it a bit, then Build.
check(await page.isVisible('#placebar') && (await g(() => window.__game.construction.jobs.length)) === 0, 'lifting the finger leaves the walls planned, with Turn / Build / Cancel');
const rot0 = await g(() => window.__game.commander.pending.rot);
await page.tap('#btnRotR'); await page.tap('#btnRotL'); await page.tap('#btnRotL');
const rot1 = await g(() => window.__game.commander.pending.rot);
check(Math.abs(rot1 - rot0 - Math.PI / 12) < 1e-6, `⟲ ⟳ turn the planned walls in 15° steps (${((rot1 - rot0) * 180 / Math.PI).toFixed(0)}°)`);
await page.tap('#btnRotR');
await g(() => window.__game.render());
await page.screenshot({ path: join(out, 'builder-planned.png') });
await page.tap('#btnPlace');
check(!(await page.isVisible('#placebar')), 'Build orders them and closes the bar');
const jobs = await g(() => window.__game.construction.jobs.map(j => j.kind));
const cr1 = await g(() => window.__game.match.teams[0].credits);
check(jobs.length === 3 && jobs.every(k => k === 'wall') && Math.abs(cr0 - cr1 - 180) < 1e-6, `Build orders 3 walls for ⚡180 (${jobs.join(', ')})`);

// Turret: tap.
await page.tap('[data-build="turret"]');
const tp = await screen(site.x, site.z + 12);
await tap(tp.x, tp.y);
check((await g(() => window.__game.construction.jobs.filter(j => j.kind === 'turret').length)) === 1, 'Turret: a tap places one');
// Trench: drag in front of the wall. Orders queue up behind each other.
await page.tap('[data-build="trench"]');
const ta = await screen(site.x - 10, site.z - 8), tb = await screen(site.x + 10, site.z - 8);
await g(() => { window.__game.config.CAMERA.strokeHoldMs = 0; });
await touch('touchStart', ta.x, ta.y);
for (let k = 1; k <= 6; k++) await touch('touchMove', ta.x + (tb.x - ta.x) * k / 6, ta.y + (tb.y - ta.y) * k / 6);
await touch('touchEnd'); await page.waitForTimeout(150);
await g(() => { window.__game.config.CAMERA.strokeHoldMs = 1e5; });
check((await g(() => window.__game.commander.pending?.kind)) === 'trench', 'Trench: a drag plans it');
// A single tap elsewhere moves the plan (keeping its length and angle), then turn it 90° and back, and Build.
const tm = await screen(site.x, site.z - 9);
const before = await g(() => ({ ...window.__game.commander.pending }));
await tap(tm.x, tm.y);
const after = await g(() => ({ ...window.__game.commander.pending }));
check(Math.abs(after.len - before.len) < 1e-6 && Math.abs(after.rot - before.rot) < 1e-6 && Math.abs(after.cz - before.cz) > 0.3, 'tapping again moves the planned trench, keeping its length and angle');
for (let k = 0; k < 6; k++) await page.tap('#btnRotL');
const r90 = await g(() => window.__game.mechView.preview.map(p => p.rot));
check(r90.every(r => Math.abs(Math.abs(r - before.rot) - Math.PI / 2) < 1e-6), 'six turns: the trench now runs at right angles to before');
for (let k = 0; k < 6; k++) await page.tap('#btnRotR');
await page.evaluate(b => { const G = window.__game, p = G.commander.pending; G.commander._setPending({ ...p, cz: b.cz, cx: b.cx }); }, before);
await page.tap('#btnPlace');
check((await g(() => window.__game.construction.jobs.filter(j => j.kind === 'trench').length)) === 2, 'Build orders the two trench sections');
await g(() => window.__game.render());
await page.screenshot({ path: join(out, 'builder-sites.png') });
const res = await g(() => {
  const G = window.__game, u = [...G.selected][0];
  const order = u.jobs.map(j => j.kind).join(',');
  const h = G.map.markers.playerHQ, before = G.heightAt(h.x - 12, h.z - 53);
  G.step(45);
  const midway = G.construction.jobs.length;
  G.step(80);
  return { order, midway, left: G.construction.jobs.length, walls: G.buildings.list.filter(b => b.def.type === 'wall').length, turrets: G.units.structures.filter(s => s.type === 'turret' && s.built === 1).length, idle: u.order,
    dug: G.heightAt(h.x - 12, h.z - 53) - before };
});
check(res.order === 'wall,wall,wall,turret,trench,trench', `the orders queue up for the Builder (${res.order})`);
check(res.midway > 0 && res.left === 0 && res.turrets === 1 && res.idle === 'idle', `it works through them all, then waits (${res.walls} walls in the town in all, ${res.turrets} turret; jobs left midway ${res.midway}, at the end ${res.left}; order now ${res.idle})`);
check(res.dug < -1.2, `the trench is dug into the ground (${res.dug.toFixed(2)})`);
await g(() => { const G = window.__game; G.rts.distance = 48; G.rts.yaw = 0.5; G.rts.update(0); G.render(); });
await page.waitForTimeout(300);
await page.screenshot({ path: join(out, 'builder-done.png') });

// Repair: hurt the Titan, then Repair -> tap the Titan with the Builder selected.
const rep = await g(() => {
  const G = window.__game, t = G.units.list.find(u => u.team === 0 && u.type === 'titan'), b = G.units.list.find(u => u.type === 'builder');
  t.hp = t.maxHp * 0.4;
  G.units.order([t], 'move', b.x + 25, b.z + 10); G.step(10);
  G.commander.setSelection([b]);
  G.rts.target.set((t.x + b.x) / 2, 0, (t.z + b.z) / 2); G.rts.distance = 55; G.rts.update(0); G.render();
  return { id: t.id, hp0: t.hp };
});
await page.waitForTimeout(300);
check(await page.isVisible('#btnRepair'), 'the Builder panel has a Repair button');
await page.tap('#btnRepair');
const tp2 = await page.evaluate(id => { const G = window.__game; G.render(); return G.commander.screen(G.units.list.find(u => u.id === id)); }, rep.id);
await tap(tp2.x, tp2.y);
const rr = await page.evaluate(id => { const G = window.__game, t = G.units.list.find(u => u.id === id), b = G.units.list.find(u => u.type === 'builder'); const ord = b.order; G.step(40); return { ord, hp: t.hp, max: t.maxHp }; }, rep.id);
check(rr.ord === 'repair' && rr.hp === rr.max, `Repair, then a tap on a damaged Titan: the Builder goes and mends it (${rep.hp0.toFixed(0)} -> ${rr.hp.toFixed(0)} hp)`);
await g(() => window.__game.render());
await page.screenshot({ path: join(out, 'builder-repair.png') });
check(w.errors.length === 0, `no console/page errors${w.errors.length ? ':\n   ' + w.errors.join('\n   ') : ''}`);
await browser.close();
await server.close();
done();
