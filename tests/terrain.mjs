// Milestone 2 browser test: chunk rebuilds, seams, tap-to-fire, barrage, reset, rotate.
// Run: node tests/terrain.mjs
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
// Drive time from the test. Headless software rendering takes ~2 s per touch event round-trip, so allow
// slow taps here; the real 350 ms limit is for the iPad.
await page.evaluate(() => { window.__game.pause(true); window.__game.config.CAMERA.tapMaxTime = 10000; });

// Geometry vs heightfield, for chunks (or all). Returns max |mesh y - hf height| and seam errors.
const meshCheck = () => page.evaluate(() => {
  const { terrain, hf } = window.__game;
  let worst = 0;
  for (const c of terrain.chunks) {
    const pos = c.geo.attributes.position.array;
    for (let j = 0; j < c.d; j++) for (let i = 0; i < c.w; i++) {
      const k = (j * c.w + i) * 3;
      worst = Math.max(worst, Math.abs(pos[k + 1] - hf.h[hf.index(c.i0 + i, c.j0 + j)]));
    }
  }
  // Seams: shared edge vertices of horizontal neighbours must match in position and normal.
  let seamPos = 0, seamNrm = 0;
  const n = terrain.n;
  for (let cz = 0; cz < n; cz++) for (let cx = 0; cx < n - 1; cx++) {
    const a = terrain.chunks[cz * n + cx], b = terrain.chunks[cz * n + cx + 1];
    const pa = a.geo.attributes.position.array, pb = b.geo.attributes.position.array;
    const na = a.geo.attributes.normal.array, nb = b.geo.attributes.normal.array;
    for (let j = 0; j < a.d; j++) {
      const ka = (j * a.w + a.w - 1) * 3, kb = (j * b.w) * 3;
      for (let q = 0; q < 3; q++) {
        seamPos = Math.max(seamPos, Math.abs(pa[ka + q] - pb[kb + q]));
        seamNrm = Math.max(seamNrm, Math.abs(na[ka + q] - nb[kb + q]));
      }
    }
  }
  return { worst, seamPos, seamNrm };
});

const s0 = await page.evaluate(() => ({ chunks: window.__game.terrain.chunks.length, dirty: window.__game.terrain.dirty.size }));
check(s0.chunks === 64 && s0.dirty === 0, `64 terrain chunks built at load, none dirty (${s0.chunks}, dirty ${s0.dirty})`);
let m = await meshCheck();
check(m.worst < 1e-5, `mesh heights match the heightfield at load (max error ${m.worst})`);
check(m.seamPos === 0 && m.seamNrm < 1e-6, `chunk seams match (position ${m.seamPos}, normal ${m.seamNrm})`);

// Fire a shell on a chunk corner: up to 4 chunks (plus neighbours for normals) go dirty, rebuilt a few per frame.
const fire = await page.evaluate(() => {
  const g = window.__game;
  const x = g.hf.wx(128), z = g.hf.wz(192);      // chunk corner (cells 128,192)
  const y0 = g.heightAt(x, z);
  const before = g.terrain.rebuildCount;
  g.fireAt(x, z, 'shell');
  const dirty = g.terrain.dirty.size;
  const perFrame = [];
  for (let f = 0; f < 10 && g.terrain.dirty.size; f++) perFrame.push(g.terrain.update());
  return { y0, y1: g.heightAt(x, z), dirty, perFrame, rebuilt: g.terrain.rebuildCount - before, left: g.terrain.dirty.size };
});
check(fire.y1 < fire.y0 - 1.4, `shell lowers the ground (${fire.y0.toFixed(2)} -> ${fire.y1.toFixed(2)})`);
check(fire.dirty >= 4, `a hit on a chunk corner marks the touching chunks dirty (${fire.dirty})`);
check(fire.perFrame.every(n => n <= 4) && fire.left === 0, `dirty chunks rebuilt at most 4 per frame (${fire.perFrame.join(', ')})`);
m = await meshCheck();
check(m.worst < 1e-5 && m.seamPos === 0 && m.seamNrm < 1e-6, `after the hit, mesh matches heightfield and seams match (err ${m.worst}, seam ${m.seamPos}/${m.seamNrm})`);

// Tap on the screen centre fires at the ground under the finger.
const cdp = await ctx.newCDPSession(page);
const touch = (type, pts) => cdp.send('Input.dispatchTouchEvent', { type, touchPoints: pts.map((p, i) => ({ x: p[0], y: p[1], id: i, radiusX: 1, radiusY: 1, force: 1 })) });
await page.evaluate(() => { const g = window.__game; g.rts.target.set(-60, g.heightAt(-60, 40), 40); g.rts.distance = 80; g.rts.update(0); g.selectWeapon('shell'); });
const vp = page.viewportSize();
const tapX = vp.width * 0.5, tapY = vp.height * 0.45;
const aim = await page.evaluate(([x, y]) => { const p = window.__game.pickGround(x, y); return { x: p.x, z: p.z, h: window.__game.heightAt(p.x, p.z), n: window.__game.damage.log.length }; }, [tapX, tapY]);
await page.waitForTimeout(400);
await touch('touchStart', [[tapX, tapY]]); await touch('touchEnd', []);
const tap = await page.evaluate(() => { const g = window.__game; const l = g.damage.log[g.damage.log.length - 1]; return { n: g.damage.log.length, x: l.x, z: l.z, weapon: l.weapon }; });
const off = Math.hypot(tap.x - aim.x, tap.z - aim.z);
check(tap.n === aim.n + 1 && tap.weapon === 'shell', `tap fires one shot with the selected weapon (${tap.weapon})`);
check(off < 0.05, `shot lands on the ground under the finger (off by ${off.toFixed(3)})`);
const after = await page.evaluate(([x, z]) => window.__game.heightAt(x, z), [aim.x, aim.z]);
check(after < aim.h - 1, `the tapped spot is cratered (${aim.h.toFixed(2)} -> ${after.toFixed(2)})`);

// A drag must not fire.
await page.waitForTimeout(400);
const nBefore = await page.evaluate(() => window.__game.damage.log.length);
await touch('touchStart', [[400, 400]]);
for (let i = 1; i <= 6; i++) await touch('touchMove', [[400 + i * 15, 400]]);
await touch('touchEnd', []);
check(await page.evaluate(() => window.__game.damage.log.length) === nBefore, 'a one-finger drag pans and does not fire');

// Two-finger twist rotates the view.
await page.waitForTimeout(400);
const yaw0 = await page.evaluate(() => window.__game.rts.yaw);
const cx = 600, cy = 400, R = 150;
await touch('touchStart', [[cx - R, cy], [cx + R, cy]]);
for (let i = 1; i <= 10; i++) {
  const a = i * 0.05;
  await touch('touchMove', [[cx - R * Math.cos(a), cy - R * Math.sin(a)], [cx + R * Math.cos(a), cy + R * Math.sin(a)]]);
}
await touch('touchEnd', []);
const yaw1 = await page.evaluate(() => window.__game.rts.yaw);
check(Math.abs(Math.abs(yaw1 - yaw0) - 0.5) < 0.05, `two-finger twist of 0.5 rad rotates the camera (yaw ${yaw0.toFixed(2)} -> ${yaw1.toFixed(2)})`);

// Buttons: weapon select, barrage, reset.
await page.evaluate(() => { const g = window.__game; g.rts.target.set(0, g.heightAt(0, 0), 10); g.rts.yaw = 0; g.rts.distance = 110; g.rts.update(0); });
await page.tap('[data-weapon="mg"]');
check(await page.evaluate(() => window.__game.state.weapon) === 'mg', 'MG button selects the machine gun');
const n0 = await page.evaluate(() => window.__game.damage.log.length);
await page.tap('#btnBarrage');
const pend = await page.evaluate(() => window.__game.state.pending.length);
check(pend === 24, `Barrage queues 24 shells (${pend})`);
await page.evaluate(() => window.__game.step(1.0));
await page.evaluate(() => window.__game.render());
await page.screenshot({ path: join(out, 'terrain-barrage-mid.png') });
await page.evaluate(() => window.__game.step(3.0));
const fired = await page.evaluate(n0 => ({ n: window.__game.damage.log.length - n0, pending: window.__game.state.pending.length }), n0);
check(fired.n === 24 && fired.pending === 0, `all 24 barrage shells land within 3 s (${fired.n}, pending ${fired.pending})`);
await page.evaluate(() => window.__game.step(2.0));
await page.evaluate(() => window.__game.render());
await page.screenshot({ path: join(out, 'terrain-barrage-after.png') });
const fin = await page.evaluate(() => window.__game.hf.h.every(Number.isFinite) && window.__game.surface.damage.every(Number.isFinite));
check(fin, 'heights and damage map are finite after the barrage');
check(await page.evaluate(() => window.__game.effects.activeCount()) === 0, 'all pooled explosion effects finished and returned to the pool');

const dmg = await page.evaluate(() => { let s = 0; for (const v of window.__game.surface.damage) s += v; return s; });
await page.tap('#btnReset');
const reset = await page.evaluate(() => { const g = window.__game; let s = 0; for (const v of g.surface.damage) s += v; g.render(); return { dmg: s, dirty: g.terrain.dirty.size }; });
check(dmg > 0 && reset.dmg === 0, `Reset clears the damage map (${dmg.toFixed(0)} -> ${reset.dmg})`);
m = await meshCheck();
check(m.worst < 1e-5, `after Reset the mesh matches the fresh heightfield (err ${m.worst})`);

// Overview screenshot of the whole map.
await page.evaluate(() => { const g = window.__game; g.rts.target.set(0, 0, 0); g.rts.distance = 240; g.rts.update(0); g.render(); });
await page.screenshot({ path: join(out, 'terrain-overview.png') });

check(w.errors.length === 0, `no console/page/network errors${w.errors.length ? ':\n   ' + w.errors.join('\n   ') : ''}`);
await browser.close();
await server.close();
done();
