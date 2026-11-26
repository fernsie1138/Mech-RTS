// Mobile Mode test: phone-sized screens (landscape and portrait). The compact UI turns itself on, every control
// is on screen and nothing overlaps; the toggle works and is remembered; tapping beside a small mech selects it.
// Run: node tests/mobile.mjs
import { serve, outDir, playwright, checker, watchPage } from './harness.mjs';
import { join } from 'node:path';

const { chromium, devices } = playwright;
const { check, done } = checker();
const out = await outDir();
const server = await serve();
const browser = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });

// Boxes of the visible HUD elements, and any pairs that overlap or stick out of the screen.
const layout = page => page.evaluate(() => {
  const ids = ['res', 'build', 'fire', 'minimap', 'topright', 'buildpanel', 'selinfo'];
  const box = {};
  for (const id of ids) {
    const e = document.getElementById(id);
    if (!e || getComputedStyle(e).display === 'none') continue;
    const r = e.getBoundingClientRect();
    if (r.width && r.height) box[id] = r;
  }
  const bad = [], off = [];
  const k = Object.keys(box);
  for (let a = 0; a < k.length; a++) {
    const A = box[k[a]];
    if (A.left < 0 || A.top < 0 || A.right > innerWidth + 0.5 || A.bottom > innerHeight + 0.5) off.push(k[a]);
    for (let b = a + 1; b < k.length; b++) {
      const B = box[k[b]];
      if (A.left < B.right && B.left < A.right && A.top < B.bottom && B.top < A.bottom) bad.push(`${k[a]}/${k[b]}`);
    }
  }
  // How much of the screen the HUD covers (the rest is the battlefield).
  const area = Object.values(box).reduce((s, r) => s + r.width * r.height, 0) / (innerWidth * innerHeight);
  return { shown: k, bad, off, area, w: innerWidth, h: innerHeight };
});

for (const [name, dev] of [['landscape', devices['iPhone 13 landscape']], ['portrait', devices['iPhone 13']]]) {
  const ctx = await browser.newContext({ ...dev });
  const page = await ctx.newPage();
  const w = watchPage(page, server.url);
  await page.goto(server.url);
  await page.waitForFunction(() => window.__game?.ready, null, { timeout: 30000 });
  check(await page.evaluate(() => document.body.classList.contains('mobile') && window.__game.mobile.on), `${name} phone: Mobile Mode turns itself on`);
  const st = await page.evaluate(() => { const r = document.getElementById('btnStart').getBoundingClientRect(); return r.bottom <= innerHeight && r.top >= 0; });
  await page.screenshot({ path: join(out, `mobile-${name}-start.png`) });
  check(st, `${name}: the Start button fits on screen`);
  await page.tap('#btnStart');
  await page.evaluate(() => { const G = window.__game; G.pause(); G.ai.step = () => {}; G.match.teams[0].credits = 1000; });
  // Select a Builder so its panel shows too.
  await page.tap('.card[data-type="builder"]');
  await page.evaluate(() => { const G = window.__game; G.step(10); G.commander.setSelection(G.units.list.filter(u => u.team === 0)); G.render(); });
  await page.waitForTimeout(400);
  const L = await layout(page);
  await page.screenshot({ path: join(out, `mobile-${name}.png`) });
  check(L.shown.includes('buildpanel') && L.shown.includes('minimap') && L.shown.includes('build'), `${name}: HUD, build buttons, Builder panel and minimap all showing (${L.w}x${L.h})`);
  check(L.bad.length === 0 && L.off.length === 0, `${name}: no controls overlap or run off the screen${L.bad.length ? ' (overlap: ' + L.bad.join(', ') + ')' : ''}${L.off.length ? ' (off screen: ' + L.off.join(', ') + ')' : ''}`);
  check(L.area < 0.35, `${name}: controls cover ${(L.area * 100).toFixed(0)}% of the screen`);
  // Dev tools open: the bar wraps but still fits.
  await page.tap('#btnDev');
  await page.waitForTimeout(200);
  const D = await layout(page);
  check(D.bad.length === 0 && D.off.length === 0, `${name}: with Dev tools open nothing overlaps${D.bad.length ? ' (' + D.bad.join(', ') + ')' : ''}${D.off.length ? ' (off: ' + D.off.join(', ') + ')' : ''}`);
  await page.screenshot({ path: join(out, `mobile-${name}-dev.png`) });
  await page.tap('#btnDev');
  if (name === 'landscape') {
    // Tap just beside a small mech: it is selected.
    const cdp = await ctx.newCDPSession(page);
    const p = await page.evaluate(() => { const G = window.__game, u = G.units.list.find(u => u.team === 0 && u.type === 'scout'); G.commander.setSelection([]); G.render(); const q = G.commander.screen(u); return { x: q.x + 18, y: q.y + 6, id: u.id }; });
    await page.evaluate(() => { window.__game.config.CAMERA.tapMaxTime = 1e5; });
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: p.x, y: p.y, id: 0, radiusX: 1, radiusY: 1, force: 1 }] });
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
    await page.waitForTimeout(200);
    const sel = await page.evaluate(() => [...window.__game.selected].map(u => u.id));
    check(sel.length === 1 && sel[0] === p.id, 'a tap a finger-width beside a Scout selects it');
    // Toggle off: remembered after a reload.
    await page.tap('#btnMobile');
    check(!(await page.evaluate(() => document.body.classList.contains('mobile'))), 'the Mobile button turns it off');
    await page.reload();
    await page.waitForFunction(() => window.__game?.ready, null, { timeout: 30000 });
    check(!(await page.evaluate(() => document.body.classList.contains('mobile'))), 'and the choice is remembered after a reload');
    await page.tap('#btnMobile');
    check(await page.evaluate(() => document.body.classList.contains('mobile')), 'tapping it again turns it back on');
  }
  check(w.errors.length === 0, `${name}: no console/page errors${w.errors.length ? ':\n   ' + w.errors.join('\n   ') : ''}`);
  await ctx.close();
}

// On an iPad it stays off unless asked for.
{
  const ctx = await browser.newContext({ ...devices['iPad Pro 11 landscape'] });
  const page = await ctx.newPage();
  await page.goto(server.url);
  await page.waitForFunction(() => window.__game?.ready, null, { timeout: 30000 });
  check(!(await page.evaluate(() => document.body.classList.contains('mobile'))), 'on an iPad Mobile Mode starts off');
  await page.goto(server.url + '?mobile=1');
  await page.waitForFunction(() => window.__game?.ready, null, { timeout: 30000 });
  check(await page.evaluate(() => document.body.classList.contains('mobile')), '?mobile=1 turns it on anywhere');
  await ctx.close();
}

await browser.close();
await server.close();
done();
