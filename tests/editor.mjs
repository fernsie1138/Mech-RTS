// Milestone 3 browser test: the editor's paint / undo / markers / import / save / open / test round trip.
// Run: node tests/editor.mjs
import { serve, outDir, playwright, checker, watchPage, ROOT } from './harness.mjs';
import { join } from 'node:path';
import { readFile } from 'node:fs/promises';

const { chromium, devices } = playwright;
const { check, done } = checker();
const out = await outDir();
const server = await serve();
const browser = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
const ctx = await browser.newContext({ ...devices['iPad Pro 11 landscape'], acceptDownloads: true });
const page = await ctx.newPage();
const w = watchPage(page, server.url);

// Headless software rendering makes each touch event round trip ~2 s, so allow slow taps and don't
// start strokes on a timer (they start when the finger moves). The real limits are for the iPad.
const relax = () => page.evaluate(() => { const c = (window.__editor || window.__game).config.CAMERA; c.tapMaxTime = 1e5; c.strokeHoldMs = 1e9; });
const ready = (name) => page.waitForFunction(n => window[n]?.ready, name, { timeout: 30000 });

await page.goto(server.url + 'editor.html');
await ready('__editor'); await relax();
check(await page.textContent('#mapname') === 'Sample: River Crossing', 'editor opens the sample map when there is no autosave');

const cdp = await ctx.newCDPSession(page);
const touch = (type, pts) => cdp.send('Input.dispatchTouchEvent', { type, touchPoints: pts.map((p, i) => ({ x: p[0], y: p[1], id: i, radiusX: 1, radiusY: 1, force: 1 })) });
const heights = () => page.evaluate(() => Array.from(window.__editor.map.hf.h));
const same = (a, b) => a.length === b.length && a.every((v, k) => v === b[k]);
const ground = (x, y) => page.evaluate(([x, y]) => { const p = window.__editor.view.pickGround(x, y); return p && { x: p.x, z: p.z, h: window.__editor.map.hf.heightAt(p.x, p.z) }; }, [x, y]);

// ---- Raise stroke with one finger ----
const h0 = await heights();
const g0 = await ground(700, 450);
await touch('touchStart', [[680, 450]]);
for (let i = 1; i <= 6; i++) await touch('touchMove', [[680 + i * 7, 450]]);
await page.waitForTimeout(600);
await touch('touchEnd', []);
await page.waitForTimeout(300);
const g1 = await ground(700, 450);
const h1 = await heights();
check(g1.h > g0.h + 0.3, `one-finger drag with Raise raises the ground (${g0.h.toFixed(2)} -> ${g1.h.toFixed(2)})`);
check(await page.evaluate(() => window.__editor.history.undoStack.length) === 1, 'the stroke is one undo step');
await page.tap('#btnUndo');
check(same(await heights(), h0), 'Undo restores the heights exactly');
await page.tap('#btnRedo');
check(same(await heights(), h1), 'Redo re-applies the stroke exactly');

// ---- Two fingers move the view without painting ----
const cam0 = await page.evaluate(() => ({ ...window.__editor.view.rts.target }));
await touch('touchStart', [[500, 400], [700, 400]]);
for (let i = 1; i <= 6; i++) await touch('touchMove', [[500 + i * 15, 400 + i * 10], [700 + i * 15, 400 + i * 10]]);
await touch('touchEnd', []);
const cam1 = await page.evaluate(() => ({ ...window.__editor.view.rts.target }));
check(same(await heights(), h1), 'two-finger drag does not paint');
check(Math.hypot(cam1.x - cam0.x, cam1.z - cam0.z) > 3, `two-finger drag pans the view (moved ${Math.hypot(cam1.x - cam0.x, cam1.z - cam0.z).toFixed(1)})`);

// ---- Markers ----
await page.tap('[data-tool="capture"]');
const nCap = await page.evaluate(() => window.__editor.map.markers.capturePoints.length);
await page.waitForTimeout(400);
await touch('touchStart', [[900, 600]]); await touch('touchEnd', []);
check(await page.evaluate(() => window.__editor.map.markers.capturePoints.length) === nCap + 1, 'tap with Capture pt adds a capture point');
await page.waitForTimeout(400);
await touch('touchStart', [[905, 602]]); await touch('touchEnd', []);
check(await page.evaluate(() => window.__editor.map.markers.capturePoints.length) === nCap, 'tap on it again removes it');
await page.tap('[data-tool="playerHQ"]');
await page.waitForTimeout(400);
const hqAim = await ground(600, 500);
await touch('touchStart', [[600, 500]]); await touch('touchEnd', []);
const hq = await page.evaluate(() => window.__editor.map.markers.playerHQ);
check(Math.hypot(hq.x - hqAim.x, hq.z - hqAim.z) < 0.05, 'tap with Player HQ moves the HQ under the finger');
await page.tap('#btnUndo');
const hqU = await page.evaluate(() => window.__editor.map.markers.playerHQ);
check(Math.hypot(hqU.x - hq.x, hqU.z - hq.z) > 1, 'undo moves the HQ back');
await page.screenshot({ path: join(out, 'editor-edit.png') });

// ---- Rename ----
page.once('dialog', d => d.accept('Test Map'));
await page.tap('#mapname');
await page.waitForTimeout(200);
check(await page.textContent('#mapname') === 'Test Map', 'tapping the name renames the map');

// ---- Import images (the sample PNGs) must reproduce maps/sample.json ----
await page.tap('[data-tool="raise"]');
await page.tap('#btnImport');
await page.setInputFiles('#fileHeight', join(ROOT, 'maps/sample-height.png'));
await page.setInputFiles('#fileFeatures', join(ROOT, 'maps/sample-features.png'));
await page.waitForFunction(() => /512/.test(document.getElementById('nameFeatures').textContent) && /512/.test(document.getElementById('nameHeight').textContent));
const beforeImport = await heights();
await page.tap('#btnDoImport');
await page.waitForTimeout(500);
const cmp = await page.evaluate(async () => {
  const { loadMapUrl } = await import('/src/maps/loader.js');
  const ref = await loadMapUrl('maps/sample.json');
  const m = window.__editor.map;
  let worst = 0; for (let k = 0; k < m.hf.h.length; k++) worst = Math.max(worst, Math.abs(m.hf.h[k] - ref.hf.h[k]));
  return { worst, feat: m.surface.features.every((v, k) => v === ref.surface.features[k]), caps: m.markers.capturePoints.length,
           closed: !document.getElementById('dlgImport').classList.contains('open') };
});
check(cmp.worst < 0.003 && cmp.feat && cmp.caps === 5, `importing the sample PNGs in the editor matches maps/sample.json (height error ${cmp.worst.toFixed(4)}, features equal ${cmp.feat}, ${cmp.caps} capture points)`);
check(cmp.closed, 'import dialog closes when there are no warnings');
await page.screenshot({ path: join(out, 'editor-imported.png') });
await page.tap('#btnUndo');
check(same(await heights(), beforeImport), 'Undo reverts the import');
await page.tap('#btnRedo');

// ---- Save downloads a map file that loads back identically ----
const [dl] = await Promise.all([page.waitForEvent('download'), page.tap('#btnSave')]);
const savedText = await readFile(await dl.path(), 'utf8');
check(dl.suggestedFilename() === 'test-map.json', `Save downloads "${dl.suggestedFilename()}"`);
const rt = await page.evaluate(async text => {
  const { deserializeMap } = await import('/src/maps/format.js');
  const m2 = await deserializeMap(JSON.parse(text)), m = window.__editor.map;
  let worst = 0; for (let k = 0; k < m.hf.h.length; k++) worst = Math.max(worst, Math.abs(m.hf.h[k] - m2.hf.h[k]));
  return { worst, name: m2.name, caps: m2.markers.capturePoints.length };
}, savedText);
check(rt.worst <= 0.0026 && rt.name === 'Test Map' && rt.caps === 5, `saved file loads back (height error ${rt.worst.toFixed(4)}, name "${rt.name}")`);

// ---- Open dialog lists the built-in maps ----
await page.tap('#btnOpen');
await page.waitForFunction(() => document.querySelectorAll('#mapList .btn').length > 0);
check(await page.textContent('#mapList') === 'Sample: River Crossing', 'Open lists the built-in sample map');
await page.tap('#dlgOpen [data-close]');

// ---- Make a distinctive edit, then Test: the game must show exactly this map ----
await page.evaluate(() => {
  const e = window.__editor;
  e.selectTool('raise');
  e.state.stroke = { tool: 'raise', x: 40, z: 40, lastX: 40, lastZ: 40, cx: -1, cy: -1, target: 0, before: Float32Array.from(e.map.hf.h), rect: null };
  e.view.pickGround = () => null;                      // keep the stroke at (40, 40)
  for (let n = 0; n < 20; n++) e.paintStep(0.1);
  e.endStroke();
});
const peak = await page.evaluate(() => window.__editor.map.hf.heightAt(40, 40));
await Promise.all([page.waitForURL(/index\.html\?map=@test/), page.tap('#btnTest')]);
await ready('__game');
const game = await page.evaluate(() => ({ h: window.__game.heightAt(40, 40), name: document.getElementById('mapname').textContent, btn: document.getElementById('btnEditor').textContent }));
check(Math.abs(game.h - peak) < 0.003 && game.name === 'Test Map', `Test opens the game on the edited map (peak ${peak.toFixed(2)} -> game ${game.h.toFixed(2)}, "${game.name}")`);
check(game.btn === '◀ Editor', 'game shows a "◀ Editor" button when testing');
await page.evaluate(() => { const g = window.__game; g.pause(); g.fireAt(40, 40, 'shell'); });
await page.screenshot({ path: join(out, 'editor-test-game.png') });

// ---- Back to the editor: autosave restores the work (and game damage didn't leak back) ----
await relax();
await Promise.all([page.waitForURL(/editor\.html$/), page.tap('#btnEditor')]);
await ready('__editor');
const back = await page.evaluate(() => ({ h: window.__editor.map.hf.heightAt(40, 40), name: window.__editor.map.name }));
check(Math.abs(back.h - peak) < 0.003 && back.name === 'Test Map', `returning to the editor restores the autosaved map, without the game's crater (${back.h.toFixed(2)})`);

// ---- Game opens a map by name; bad names give a readable error ----
await page.goto(server.url + 'index.html?map=nope');
await page.waitForFunction(() => document.getElementById('fatal').style.display === 'flex');
check(/Could not load the map/.test(await page.textContent('#fatal')), `missing map shows an error ("${(await page.textContent('#fatal')).slice(0, 60)}...")`);

const real = w.errors.filter(e => !/nope\.json/.test(e) && !/404/.test(e));
check(real.length === 0, `no console/page errors${real.length ? ':\n   ' + real.join('\n   ') : ''}`);
await browser.close();
await server.close();
done();
