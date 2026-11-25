// Milestone 1 smoke test. Run: node tests/smoke.mjs
// Loads the game as an iPad (touch) and as a desktop (mouse) and checks that it starts cleanly,
// renders, steps the simulation, and that touch/mouse camera controls work without page zoom/scroll.
import { serve, outDir, playwright, checker, watchPage } from './harness.mjs';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';

const { chromium, devices } = playwright;
const { check, done } = checker();
const out = await outDir();
const server = await serve();
const browser = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });

const versionSrc = await readFile(new URL('../src/version.js', import.meta.url), 'utf8');
const VERSION = versionSrc.match(/VERSION = '([^']+)'/)[1];
const html = await readFile(new URL('../index.html', import.meta.url), 'utf8');
check(html.includes(`<meta name="build" content="${VERSION}">`), `index.html build meta matches ${VERSION}`);
check(html.includes(`src/main.js?v=${VERSION.slice(1)}`), `index.html main.js cache-buster matches ${VERSION}`);
check(html.includes(`<div id="ver">${VERSION}</div>`), `index.html fallback label matches ${VERSION}`);

// ---------------- iPad (touch) ----------------
{
  const ctx = await browser.newContext({ ...devices['iPad Pro 11 landscape'] });
  const page = await ctx.newPage();
  const w = watchPage(page, server.url);
  await page.goto(server.url, { waitUntil: 'load' });
  await page.waitForFunction(() => window.__game?.ready, null, { timeout: 15000 });
  await page.waitForTimeout(1500);

  const label = await page.textContent('#ver');
  check(label === VERSION, `version label shows "${VERSION}" (got "${label}")`);
  check(await page.evaluate(() => window.__game.THREE.REVISION) === '170', 'three.js r170 loaded');

  const s = await page.evaluate(() => window.__game.stats());
  check(s.calls > 0 && s.triangles > 0, `rendering: ${s.calls} draw calls, ${s.triangles} triangles`);
  check(s.fps > 0, `frames are running (headless software GL fps ${s.fps.toFixed(1)}; not meaningful for iPad)`);
  check(s.pixelRatio <= 2, `pixel ratio capped at 2 (device 2, got ${s.pixelRatio})`);

  // Simulation stepping through the test hook.
  const t = await page.evaluate(() => { const g = window.__game; g.pause(true); const t0 = g.state.time; g.step(10); return g.state.time - t0; });
  check(Math.abs(t - 10) < 1e-6, `__game.step(10) advances sim time by 10 s (got ${t.toFixed(6)})`);
  await page.evaluate(() => window.__game.pause(false));

  await page.screenshot({ path: join(out, 'smoke-ipad.png') });

  // Touch input via CDP so real touch -> pointer events fire.
  const cdp = await ctx.newCDPSession(page);
  const touch = (type, points) => cdp.send('Input.dispatchTouchEvent', {
    type, touchPoints: points.map((p, i) => ({ x: p[0], y: p[1], id: i, radiusX: 1, radiusY: 1, force: 1 })),
  });
  const getCam = () => page.evaluate(() => {
    const r = window.__game.rts; return { x: r.target.x, z: r.target.z, d: r.distance };
  });

  // One-finger drag: the ground point under the finger should stay under it (dragging right moves camera left).
  const before = await getCam();
  const groundBefore = await page.evaluate(() => { const p = window.__game.rts.groundPoint(400, 400); return [p.x, p.z]; });
  await touch('touchStart', [[400, 400]]);
  for (let i = 1; i <= 10; i++) await touch('touchMove', [[400 + i * 20, 400 + i * 8]]);
  await touch('touchEnd', []);
  const afterPan = await getCam();
  const groundAfter = await page.evaluate(() => { const p = window.__game.rts.groundPoint(600, 480); return [p.x, p.z]; });
  check(afterPan.x < before.x - 1, `one-finger drag right pans camera (target x ${before.x.toFixed(1)} -> ${afterPan.x.toFixed(1)})`);
  const slip = Math.hypot(groundAfter[0] - groundBefore[0], groundAfter[1] - groundBefore[1]);
  check(slip < 0.5, `ground stays under the finger while dragging (slip ${slip.toFixed(3)} world units)`);

  // Pinch out (fingers apart) should zoom in.
  await page.waitForTimeout(400);  // past the double-tap guard window
  await touch('touchStart', [[500, 400], [700, 400]]);
  for (let i = 1; i <= 10; i++) await touch('touchMove', [[500 - i * 15, 400], [700 + i * 15, 400]]);
  await touch('touchEnd', []);
  const afterPinch = await getCam();
  check(afterPinch.d < afterPan.d * 0.8, `pinch out zooms in (distance ${afterPan.d.toFixed(1)} -> ${afterPinch.d.toFixed(1)})`);

  // Pinch in should zoom out.
  await page.waitForTimeout(400);
  await touch('touchStart', [[400, 400], [800, 400]]);
  for (let i = 1; i <= 10; i++) await touch('touchMove', [[400 + i * 15, 400], [800 - i * 15, 400]]);
  await touch('touchEnd', []);
  const afterPinchIn = await getCam();
  check(afterPinchIn.d > afterPinch.d * 1.2, `pinch in zooms out (distance ${afterPinch.d.toFixed(1)} -> ${afterPinchIn.d.toFixed(1)})`);

  const vp = await page.evaluate(() => ({ sx: window.scrollX, sy: window.scrollY, scale: window.visualViewport?.scale ?? 1 }));
  check(vp.sx === 0 && vp.sy === 0 && vp.scale === 1, `page did not scroll or zoom (scroll ${vp.sx},${vp.sy} scale ${vp.scale})`);

  // Debug overlay toggle by tapping the FPS button.
  await page.tap('#btnDebug');
  await page.waitForTimeout(700);
  const dbg = await page.evaluate(() => { const e = document.getElementById('debug'); return { shown: getComputedStyle(e).display !== 'none', text: e.textContent }; });
  check(dbg.shown && /fps/.test(dbg.text) && /draw calls/.test(dbg.text), 'FPS button shows the debug overlay');
  await page.screenshot({ path: join(out, 'smoke-ipad-debug.png') });

  const nan = await page.evaluate(() => { const p = window.__game.camera.position; return [p.x, p.y, p.z].some(v => !Number.isFinite(v)); });
  check(!nan, 'camera position is finite');

  check(w.external.length === 0, `no off-site requests (three.js is vendored)${w.external.length ? ': ' + w.external.join(', ') : ''}`);
  check(w.errors.length === 0, `no console/page/network errors on iPad${w.errors.length ? ':\n   ' + w.errors.join('\n   ') : ''}`);
  await ctx.close();
}

// ---------------- Desktop (mouse + keyboard) ----------------
{
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 } });
  const page = await ctx.newPage();
  const w = watchPage(page, server.url);
  await page.goto(server.url, { waitUntil: 'load' });
  await page.waitForFunction(() => window.__game?.ready, null, { timeout: 15000 });
  const d0 = await page.evaluate(() => window.__game.rts.distance);
  await page.mouse.move(640, 400);
  await page.mouse.wheel(0, -400);
  await page.waitForTimeout(200);
  const d1 = await page.evaluate(() => window.__game.rts.distance);
  check(d1 < d0, `mouse wheel zooms in (distance ${d0.toFixed(1)} -> ${d1.toFixed(1)})`);

  const x0 = await page.evaluate(() => window.__game.rts.target.x);
  await page.keyboard.down('d'); await page.waitForTimeout(500); await page.keyboard.up('d');
  const x1 = await page.evaluate(() => window.__game.rts.target.x);
  check(x1 > x0 + 1, `D key pans right (target x ${x0.toFixed(1)} -> ${x1.toFixed(1)})`);

  await page.mouse.move(640, 400); await page.mouse.down();
  await page.mouse.move(540, 400, { steps: 8 }); await page.mouse.up();
  const x2 = await page.evaluate(() => window.__game.rts.target.x);
  check(x2 > x1 + 1, `mouse drag left pans right (target x ${x1.toFixed(1)} -> ${x2.toFixed(1)})`);

  await page.keyboard.press('`');
  const shown = await page.evaluate(() => getComputedStyle(document.getElementById('debug')).display !== 'none');
  check(shown, '` key toggles the debug overlay');
  await page.waitForTimeout(700);
  await page.screenshot({ path: join(out, 'smoke-desktop.png') });
  check(w.errors.length === 0, `no console/page/network errors on desktop${w.errors.length ? ':\n   ' + w.errors.join('\n   ') : ''}`);
  await ctx.close();
}

// ---------------- Stale-build warning ----------------
{
  const ctx = await browser.newContext({ viewport: { width: 800, height: 600 } });
  const page = await ctx.newPage();
  await page.route('**/index.html', async route => {
    const res = await route.fetch();
    route.fulfill({ response: res, body: (await res.text()).replace(/<meta name="build" content="[^"]+">/, '<meta name="build" content="v0">') });
  });
  await page.goto(server.url + 'index.html');
  await page.waitForFunction(() => window.__game?.ready, null, { timeout: 15000 });
  const stale = await page.evaluate(() => { const e = document.getElementById('ver'); return { cls: e.className, text: e.textContent }; });
  check(stale.cls.includes('stale') && stale.text.includes('stale'), `mismatched page/JS builds are flagged ("${stale.text}")`);
  await ctx.close();
}

await browser.close();
await server.close();
done();
