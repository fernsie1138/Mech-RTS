// Milestone 4 browser test: water, flooding, trees in the game; river / road / forest / tree / erase in the editor.
// Run: node tests/world.mjs
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

// ================= game =================
await page.goto(server.url + '?sandbox');
await ready('__game');
await page.evaluate(() => window.__game.pause());

const g0 = await page.evaluate(() => {
  const g = window.__game;
  return { tris: g.view.waterMesh.triangleCount(), trees: g.forest.trees.length, wet: g.water.wetCount(),
           meshes: g.view.trees.meshes.map(m => m.count), dirty: g.view.waterMesh.dirty.size };
});
check(g0.tris > 3000 && g0.dirty === 0, `river water surface is drawn (${g0.tris} triangles)`);
check(g0.trees === 475 && g0.meshes[0] + g0.meshes[1] === 475, `475 trees drawn with instancing (${g0.meshes[0]} conifers + ${g0.meshes[1]} broadleaf)`);
const calls = await page.evaluate(() => { const g = window.__game; g.rts.target.set(-80, 0, -45); g.rts.distance = 55; g.rts.update(0); return g.render().calls; });
check(calls < 40, `forest view costs few draw calls (${calls} total)`);
await page.screenshot({ path: join(out, 'world-forest.png') });

// Shells beside the river flood; the water mesh updates.
const flood = await page.evaluate(() => {
  const g = window.__game, wt = g.water;
  let edge = null; for (let x = -60; x < 0; x += 0.25) if (wt.depthAt(x, -20) > 0.05) { edge = x; break; }
  const wet0 = wt.wetCount();
  const hits = [g.fireAt(edge - 2, -20, 'shell'), g.fireAt(edge - 5, -20, 'shell'), g.fireAt(edge - 8, -20, 'shell')];
  g.render();
  let deepest = 0; for (let x = edge - 5; x <= edge; x += 0.25) deepest = Math.max(deepest, wt.depthAt(x, -20));
  return { edge, flooded: hits.map(h => h.flooded), wet: wt.wetCount() - wet0, depth: deepest, dirty: g.view.waterMesh.dirty.size };
});
check(flood.flooded[0] > 20 && flood.depth > 0.05, `shell beside the river floods the part of its crater below the river level (${flood.flooded.join(', ')} samples; deepest water ${flood.depth.toFixed(2)})`);
check(flood.dirty === 0, 'water mesh rebuilt after flooding');
await page.evaluate(() => { const g = window.__game; g.rts.target.set(-40, 0, -20); g.rts.distance = 40; g.rts.update(0); g.render(); });
await page.screenshot({ path: join(out, 'world-flood.png') });

// Shell barrage on the forest: trees fall, shatter and burn; flames show; burnt trees scorch the ground.
const fire = await page.evaluate(() => {
  const g = window.__game;
  g.barrage(-80, -45, { count: 12, radius: 12, seed: 5 });
  g.step(3.5);
  const c1 = g.forest.counts();
  g.render();
  const flames = g.view.trees.flames.count;
  return { c1, flames };
});
check(fire.c1.fallen > 10 && fire.c1.stump > 5 && fire.c1.burning > 5, `barrage knocks trees down (${fire.c1.fallen}), shatters some (${fire.c1.stump}) and starts fires (${fire.c1.burning})`);
check(fire.flames === Math.min(fire.c1.burning, 96), `flames drawn on burning trees (${fire.flames})`);
await page.screenshot({ path: join(out, 'world-fire.png') });
const later = await page.evaluate(() => {
  const g = window.__game;
  let s0 = 0; for (const v of g.surface.scorch) s0 += v;
  for (let t = 0; t < 600 && g.forest.burning.size; t++) g.step(1);
  let s1 = 0; for (const v of g.surface.scorch) s1 += v;
  g.render();
  return { c: g.forest.counts(), scorch: s1 - s0 };
});
check(later.c.burning === 0 && later.c.standing > 200, `fires burn out and much of the forest survives (${later.c.standing} standing, ${later.c.stump} gone)`);
check(later.scorch > 10, `burnt-out trees scorch the ground (+${later.scorch.toFixed(0)})`);
await page.screenshot({ path: join(out, 'world-after-fire.png') });

// Reset restores trees and water.
await page.tap('#btnReset');
const reset = await page.evaluate(() => { const g = window.__game; g.render(); return { c: g.forest.counts(), wet: g.water.wetCount() }; });
check(reset.c.standing === 475 && reset.c.burning === 0, `Reset restores all trees (${reset.c.standing})`);
check(reset.wet === g0.wet, `Reset restores the water (${reset.wet} wet samples)`);

// ================= editor =================
await page.goto(server.url + 'editor.html');
await ready('__editor');
await page.evaluate(() => { const c = window.__editor.config.CAMERA; c.tapMaxTime = 1e5; c.strokeHoldMs = 1e9; });
await page.evaluate(() => { const e = window.__editor; e.map.hf; e.view.rts.target.set(60, 0, 60); e.view.rts.distance = 70; e.view.rts.yaw = 0; e.view.rts.update(0); });
const cdp = await ctx.newCDPSession(page);
const touch = (type, pts) => cdp.send('Input.dispatchTouchEvent', { type, touchPoints: pts.map((p, i) => ({ x: p[0], y: p[1], id: i, radiusX: 1, radiusY: 1, force: 1 })) });
const drag = async (pts) => { await touch('touchStart', [pts[0]]); for (const p of pts.slice(1)) await touch('touchMove', [p]); await page.waitForTimeout(400); await touch('touchEnd', []); await page.waitForTimeout(300); };
const line = (x0, y0, x1, y1, n = 10) => Array.from({ length: n + 1 }, (_, i) => [x0 + (x1 - x0) * i / n, y0 + (y1 - y0) * i / n]);
const state = () => page.evaluate(() => { const e = window.__editor; return { h: Array.from(e.map.hf.h), trees: e.map.trees.length, wet: e.view.water.wetCount() }; });
const sameArr = (a, b) => a.length === b.length && a.every((v, i) => v === b[i]);

// River
await page.tap('[data-tool="river"]');
const s0 = await state();
await drag(line(450, 250, 900, 600));
const river = await page.evaluate(() => { const e = window.__editor, p = e.view.pickGround(675, 425); return { depth: e.view.water.depthAt(p.x, p.z), tris: e.view.waterMesh.triangleCount() }; });
const s1 = await state();
check(s1.wet > s0.wet + 300 && river.depth > 1, `River tool: drawn river holds deep water (+${s1.wet - s0.wet} wet samples, depth ${river.depth.toFixed(2)})`);
await page.tap('#btnUndo');
const su = await state();
check(sameArr(su.h, s0.h) && su.wet === s0.wet, 'Undo removes the river (heights and water)');
await page.tap('#btnRedo');
check((await state()).wet === s1.wet, 'Redo puts it back');

// Road across the river
await page.tap('[data-tool="road"]');
await drag(line(400, 600, 950, 300));
const road = await page.evaluate(() => { const e = window.__editor, p = e.view.pickGround(500, 545); const k = e.map.hf.index(Math.round(e.map.hf.gx(p.x)), Math.round(e.map.hf.gz(p.z))); return e.map.surface.base[k]; });
check(road === 3, 'Road tool paints road under the finger');

// Forest spray, single tree, erase
await page.tap('[data-tool="forest"]');
const t0 = (await state()).trees;
await drag([...line(300, 300, 360, 300, 6), ...line(360, 300, 300, 330, 6)]);
const t1 = (await state()).trees;
check(t1 > t0 + 5, `Forest tool sprays trees (${t0} -> ${t1})`);
await page.tap('[data-tool="tree"]');
await page.waitForTimeout(400);
await touch('touchStart', [[1000, 250]]); await touch('touchEnd', []);
const t2 = (await state()).trees;
check(t2 === t1 + 1, `Tree tool: a tap plants one tree (${t1} -> ${t2})`);
await page.screenshot({ path: join(out, 'world-editor.png') });
await page.tap('[data-tool="erase"]');
await drag(line(290, 310, 370, 310, 6));
const t3 = (await state()).trees;
check(t3 < t2, `Erase removes trees (${t2} -> ${t3})`);
await page.tap('#btnUndo');
check((await state()).trees === t2, 'Undo brings erased trees back');

// Test: the game shows the edited water and trees.
const ed = await page.evaluate(() => ({ trees: window.__editor.map.trees.length, wet: window.__editor.view.water.wetCount() }));
await Promise.all([page.waitForURL(/map=@test/), page.tap('#btnTest')]);
await ready('__game');
const gm = await page.evaluate(() => ({ trees: window.__game.forest.trees.length, wet: window.__game.water.wetCount() }));
check(ed.wet < 20000, `edited map water stays in its rivers (${ed.wet} wet samples)`);
check(gm.trees === ed.trees && Math.abs(gm.wet - ed.wet) <= ed.wet * 0.01, `Test carries the edited trees (${gm.trees}) and water (${gm.wet} vs ${ed.wet} wet) into the game`);

check(w.errors.length === 0, `no console/page errors${w.errors.length ? ':\n   ' + w.errors.join('\n   ') : ''}`);
await browser.close();
await server.close();
done();
