// Milestone 5 browser test: buildings and bridges in the game (tap-to-fire on a building, collapse, rubble,
// reset) and in the editor (place, select, rotate, delete, bridge, fill lots, undo, test).
// Run: node tests/buildings.mjs
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
const ready = n => page.waitForFunction(x => window[x]?.ready, n, { timeout: 30000 });
const cdp = await ctx.newCDPSession(page);
const touch = (type, pts) => cdp.send('Input.dispatchTouchEvent', { type, touchPoints: pts.map((p, i) => ({ x: p[0], y: p[1], id: i, radiusX: 1, radiusY: 1, force: 1 })) });
const tap = async (x, y) => { await page.waitForTimeout(400); await touch('touchStart', [[x, y]]); await touch('touchEnd', []); await page.waitForTimeout(200); };
const relax = () => page.evaluate(() => { const c = (window.__game || window.__editor).config.CAMERA; c.tapMaxTime = 1e5; c.strokeHoldMs = 1e9; });

// ================= game =================
await page.goto(server.url + '?sandbox');
await ready('__game'); await relax();
const g0 = await page.evaluate(() => {
  const g = window.__game, B = g.buildings;
  const house = B.list.find(b => b.def.type === 'house');
  g.pause(); g.rts.target.set(house.def.x, house.y, house.def.z); g.rts.distance = 35; g.rts.yaw = 0; g.rts.update(0);
  const stats = g.render();
  return { n: B.list.length, pieces: B.pieces.length, calls: stats.calls, counts: B.counts(), house: B.list.indexOf(house), meshes: g.view.buildingView.meshes.map(m => m.count), ground: g.heightAt(house.def.x, house.def.z) };
});
check(g0.n === 12 && g0.counts.intact === 12, `sample map has ${g0.n} intact buildings (${g0.pieces} pieces)`);
check(g0.meshes[0] + g0.meshes[1] === g0.pieces, `all pieces drawn by ${g0.meshes.length} instanced meshes (${g0.meshes.join(' + ')})`);
await page.screenshot({ path: join(out, 'buildings-town.png') });

// Tap on the house wall with Shell selected: the blast happens on the building (not the ground behind it).
await page.evaluate(() => window.__game.selectWeapon('shell'));
const aim = await page.evaluate(i => {
  const g = window.__game, b = g.buildings.list[i], v = new g.THREE.Vector3(b.def.x, b.y + 2, b.def.z + 3.2).project(g.camera);
  return { x: (v.x + 1) / 2 * innerWidth, y: (1 - v.y) / 2 * innerHeight };
}, g0.house);
const pickAt = await page.evaluate(([x, y]) => !!window.__game.view.pickBuilding(x, y), [aim.x, aim.y]);
check(pickAt, 'a tap on a wall hits the building');
await tap(aim.x, aim.y);
const hit1 = await page.evaluate(i => { const g = window.__game, l = g.damage.log.at(-1); return { y: l.y, ground: l.y0, pieces: l.pieces, state: g.buildings.list[i].state }; }, g0.house);
check(hit1.pieces > 0 && hit1.y > hit1.ground + 1, `the shell bursts on the wall (${(hit1.y - hit1.ground).toFixed(1)} above ground), breaking ${hit1.pieces} pieces; house is "${hit1.state}"`);
await page.evaluate(() => window.__game.step(0.6));
await page.evaluate(() => window.__game.render());
await page.screenshot({ path: join(out, 'buildings-hit.png') });

// Keep shelling: ruin, then rubble pile (raised, rubble-painted ground with chunks).
const coll = await page.evaluate(([i, ground0]) => {
  const g = window.__game, b = g.buildings.list[i];
  const seen = [];
  for (let n = 0; n < 15 && b.state !== 'rubble'; n++) { g.damage.explode(b.def.x + (n % 3 - 1) * 2.5, b.def.z + (n % 2 ? 1.5 : -1.5), 'shell', b.y + 4.5); seen.push(b.state); }   // bursts above the growing rubble heap
  g.step(1.5); g.view.buildingView.update(2); g.render();
  return { seen: [...new Set(seen)], state: b.state, rise: g.heightAt(b.def.x, b.def.z) - ground0, chunks: g.buildings.chunks.filter(c => c.alive).length, anims: g.view.buildingView.anims.length };
}, [g0.house, g0.ground]);
check(coll.state === 'rubble' && coll.seen.includes('ruin'), `shelling takes the house through ${coll.seen.join(' -> ')} -> rubble`);
check(coll.rise > 0.5 && coll.chunks > 10, `its rubble raises the ground ${coll.rise.toFixed(2)} and leaves ${coll.chunks} chunks`);
check(coll.anims === 0, 'falling-piece animations finish');
await page.screenshot({ path: join(out, 'buildings-rubble.png') });

// Bridge: shell it until the crossing is cut.
const br = await page.evaluate(() => {
  const g = window.__game, b = g.buildings.list.find(b => b.def.type === 'bridge');
  const d0 = g.buildings.deckAt(b.def.x, b.def.z);
  for (let n = 0; n < 6 && b.state !== 'broken'; n++) g.damage.explode(b.def.x, b.def.z, 'shell', b.y);
  g.step(1.5);
  g.rts.target.set(b.def.x, b.y, b.def.z); g.rts.distance = 35; g.rts.update(0); g.render();
  return { d0, d1: g.buildings.deckAt(b.def.x, b.def.z), state: b.state };
});
check(br.d0 !== null && br.d1 === null && br.state === 'broken', `shelling the bridge breaks its middle (deck ${br.d0.toFixed(2)} -> none, "${br.state}")`);
await page.screenshot({ path: join(out, 'buildings-bridge.png') });

await page.tap('#btnReset');
const rs = await page.evaluate(() => { const g = window.__game; g.render(); return { c: g.buildings.counts(), chunks: g.buildings.chunks.length }; });
check(rs.c.intact === 12 && rs.chunks === 0, 'Reset restores every building and clears the rubble');

// ================= editor =================
await page.goto(server.url + 'editor.html');
await ready('__editor'); await relax();
const st = () => page.evaluate(() => ({ n: window.__editor.map.buildings.length, sel: window.__editor.selected, list: window.__editor.map.buildings.map(b => b.type) }));
const e0 = await st();
await page.evaluate(() => { const e = window.__editor, v = e.view; v.rts.target.set(40, 0, -30); v.rts.distance = 60; v.rts.yaw = 0; v.rts.update(0); });
await page.tap('[data-tool="house"]');
check(await page.evaluate(() => getComputedStyle(document.getElementById('bpanel')).display) === 'flex', 'building tools show the rotate / delete / fill panel');
await tap(600, 420);
const e1 = await st();
check(e1.n === e0.n + 1 && e1.list.at(-1) === 'house' && e1.sel === e1.n - 1, 'House tool: a tap places a house and selects it');
const placed = await page.evaluate(() => { const e = window.__editor, d = e.map.buildings.at(-1); return { d, flat: Math.abs(e.map.hf.heightAt(d.x - 3.5, d.z - 2.5) - e.map.hf.heightAt(d.x + 3.5, d.z + 2.5)), trees: e.view.forest.near(d.x, d.z, 4).length }; });
check(placed.flat < 0.01 && placed.trees === 0, `the ground under it is levelled (corner difference ${placed.flat.toFixed(4)}) and clear of trees`);
await page.tap('#brotL');
const rot = await page.evaluate(() => window.__editor.map.buildings.at(-1).rot);
check(Math.abs(rot - Math.PI / 12) < 1e-6, `⟲ rotates the selected building 15° (${(rot * 180 / Math.PI).toFixed(0)}°)`);
await tap(600, 420);     // the house again: stays selected
check((await st()).sel === e1.n - 1, 'tapping an existing building selects it (instead of placing another)');
await page.tap('#bdel');
check((await st()).n === e0.n, 'Delete removes the selected building');
await page.tap('#btnUndo');
check((await st()).n === e1.n, 'Undo brings it back');
await page.screenshot({ path: join(out, 'buildings-editor.png') });

// Bridge tool on the river.
const river = await page.evaluate(() => {
  const e = window.__editor, wt = e.view.water;
  for (let z = -80; z < 80; z += 2) for (let x = -80; x < 0; x += 0.5) if (wt.depthAt(x, z) > 1 && !e.view.buildings.list.some(b => Math.hypot(b.def.x - x, b.def.z - z) < 15)) {
    e.view.rts.target.set(x, e.map.hf.heightAt(x, z), z); e.view.rts.distance = 50; e.view.rts.update(0);
    return { x, z };
  }
});
await page.waitForTimeout(1500);      // let the camera settle on the ground height
Object.assign(river, await page.evaluate(({ x, z }) => {
  const e = window.__editor, v = new e.THREE.Vector3(x, e.view.water.levelAt(x, z), z).project(e.view.camera);
  return { sx: (v.x + 1) / 2 * innerWidth, sy: (1 - v.y) / 2 * innerHeight };
}, river));
await page.tap('[data-tool="bridge"]');
await tap(river.sx, river.sy);
const bridge = await page.evaluate(() => { const e = window.__editor, d = e.map.buildings.at(-1); return { type: d.type, len: d.len, deck: e.view.buildings.deckAt(d.x, d.z) }; });
check(bridge.type === 'bridge' && bridge.deck !== null && bridge.len > 8, `Bridge tool: a tap on the river places a bridge that fits it (length ${bridge.len})`);

// Fill lots: the sample's lots are full already, so New map + paint is overkill; check it reports nothing to fill.
await page.tap('[data-tool="house"]');
const nBefore = (await st()).n;
await page.tap('#bfill');
check((await st()).n === nBefore && /No empty building areas/.test(await page.textContent('#status')), 'Fill lots reports when every lot is already built on');

// Test: the game shows the edited buildings.
const ed = await st();
await Promise.all([page.waitForURL(/map=@test/), page.tap('#btnTest')]);
await ready('__game');
const gm = await page.evaluate(() => window.__game.buildings.list.map(b => b.def.type));
check(gm.length === ed.n && gm.join() === ed.list.join(), `Test carries the ${gm.length} buildings into the game`);

check(w.errors.length === 0, `no console/page errors${w.errors.length ? ':\n   ' + w.errors.join('\n   ') : ''}`);
await browser.close();
await server.close();
done();
