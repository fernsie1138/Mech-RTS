// Milestone 7 browser test: mechs render, touch selection (tap, double tap, box drag), orders (attack-move, move,
// attack a target), +Enemy, a battle with no errors, and screenshots.
// Run: node tests/combat.mjs
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
// Headless touch round trips are slow: widen the tap and double-tap windows.
await page.evaluate(() => { const c = window.__game.config.CAMERA; c.tapMaxTime = 1e5; c.doubleTapMs = 1e5; c.strokeHoldMs = 1e5; window.__game.pause(); });
const cdp = await ctx.newCDPSession(page);
const touch = (type, x, y) => cdp.send('Input.dispatchTouchEvent', { type, touchPoints: type === 'touchEnd' ? [] : [{ x, y, id: 0, radiusX: 1, radiusY: 1, force: 1 }] });
const tap = async (x, y) => { await touch('touchStart', x, y); await touch('touchEnd'); await page.waitForTimeout(150); };
const drag = async (x0, y0, x1, y1) => { await touch('touchStart', x0, y0); for (let k = 1; k <= 6; k++) await touch('touchMove', x0 + (x1 - x0) * k / 6, y0 + (y1 - y0) * k / 6); await touch('touchEnd'); await page.waitForTimeout(150); };
const mine = () => page.evaluate(() => window.__game.units.list.filter(u => u.alive && u.team === 0).map(u => ({ id: u.id, type: u.type, x: u.x, z: u.z, order: u.order, sel: window.__game.selected.has(u) })));
const scr = id => page.evaluate(id => { const g = window.__game, u = g.units.list.find(u => u.id === id); g.render(); return g.commander.screen(u); }, id);

// Camera over a clear patch south of the river, with two squads.
await page.evaluate(() => {
  const g = window.__game, h = g.map.markers.playerHQ;
  g.rts.target.set(h.x, 0, h.z - 25); g.rts.distance = 75; g.rts.yaw = 0; g.rts.update(0);
  g.commander.setSelection(g.spawnSquad(0, h.x + 14, h.z - 25));
  g.commander.setSelection([]); g.render();
});
let u = await mine();
check(u.length === 6 && u.filter(x => x.type === 'scout').length === 2, `two player squads on the field (${u.map(x => x.type).join(', ')})`);
const drawn = await page.evaluate(() => { const V = window.__game.mechView; return Object.values(V.models).reduce((s, m) => s + (m.ready ? m.meshes.body?.count || 0 : 0), 0) + V.medium.n + V.parts.count / 15; });
check(drawn >= 6, `all 6 mechs are drawn (from their models, instanced)`);
await page.screenshot({ path: join(out, 'combat-squads.png') });

// Tap a Titan: just it. Double tap a Scout: both Scouts.
const titan = u.find(x => x.type === 'titan'), scouts = u.filter(x => x.type === 'scout');
let p = await scr(titan.id); await tap(p.x, p.y);
let s = (await mine()).filter(x => x.sel);
check(s.length === 1 && s[0].id === titan.id, 'tapping a mech selects just that mech');
await page.evaluate(() => { window.__game.commander.lastTap = { t: 0, unit: null }; });
p = await scr(scouts[0].id); await tap(p.x, p.y); await tap(p.x, p.y);
s = (await mine()).filter(x => x.sel);
check(s.length === 2 && s.every(x => x.type === 'scout'), `double tapping a Scout selects every Scout on screen (${s.length})`);

// Box select with a one-finger drag around everything.
const all = await Promise.all(u.map(x => scr(x.id)));
const xs = all.map(q => q.x), ys = all.map(q => q.y);
await page.evaluate(() => { window.__game.config.CAMERA.strokeHoldMs = 0; });
await drag(Math.min(...xs) - 40, Math.min(...ys) - 40, Math.max(...xs) + 40, Math.max(...ys) + 40);
s = (await mine()).filter(x => x.sel);
check(s.length === 6, `a one-finger drag box-selects (${s.length} of 6)`);
const box = await page.evaluate(() => document.getElementById('boxsel').style.display);
check(box === 'none', 'the selection box disappears when the finger lifts');
check((await page.evaluate(() => window.__game.rts.target.z)) === (await page.evaluate(() => window.__game.map.markers.playerHQ.z - 25)), 'a one-finger drag does not pan the camera');
await page.evaluate(() => { window.__game.config.CAMERA.strokeHoldMs = 1e5; });

// Tap the ground: a plain move by default; the A-Move button switches to attack-move.
const ground = await page.evaluate(() => { const g = window.__game, h = g.map.markers.playerHQ, c = window.__game.camera; const v = new g.THREE.Vector3(h.x - 10, g.heightAt(h.x - 10, h.z - 40), h.z - 40).project(c); return { x: (v.x + 1) / 2 * innerWidth, y: (1 - v.y) / 2 * innerHeight }; });
check((await page.textContent('#btnKind')) === 'Move', 'the order button starts on Move');
await tap(ground.x, ground.y);
check((await mine()).every(x => x.order === 'move'), 'tapping the ground gives a move order by default');
await page.tap('#btnKind');
check((await page.textContent('#btnKind')) === 'A-Move', 'the button toggles to A-Move');
await tap(ground.x, ground.y);
check((await mine()).every(x => x.order === 'amove'), 'with A-Move on, tapping the ground gives an attack-move order');
await page.tap('#btnKind');
const info = await page.textContent('#selinfo');
check(/2 Light Mechs/.test(info) && /2 Assault Mechs/.test(info), `the selection panel lists the selected mechs ("${info.trim()}")`);

// +Enemy, then tap an enemy: attack it.
await page.tap('#btnEnemy');
const foes = await page.evaluate(() => window.__game.units.list.filter(u => u.alive && u.team === 1).map(u => ({ id: u.id, type: u.type })));
check(foes.length === 5, `+Enemy brings an enemy squad (${foes.map(f => f.type).join(', ')})`);
await page.evaluate(() => window.__game.render());
const foe = foes.find(f => f.type === 'titan');
p = await scr(foe.id); await tap(p.x, p.y);
const att = await page.evaluate(id => window.__game.units.list.filter(u => u.alive && u.team === 0).map(u => u.order === 'attack' && u.attackTarget?.id === id), foe.id);
check(att.every(Boolean), 'tapping an enemy with mechs selected orders them to attack it');
// In the middle of a fight, a tap on the ground just beside an enemy is still a move order, and they go.
const retreat = await page.evaluate(id => {
  const g = window.__game, f = g.units.list.find(u => u.id === id), p = g.commander.screen(f);
  g.step(3);                                                   // engaged
  return { x: p.x + 45, y: p.y + 4, engaged: g.commander.mine().some(u => u.target) };
}, foe.id);
await tap(retreat.x, retreat.y);
const ord = await page.evaluate(() => window.__game.commander.mine().map(u => u.order));
check(retreat.engaged && ord.every(o => o === 'move'), `engaged mechs given a tap beside an enemy get a move order (${ord.join(', ')})`);
const back = await page.evaluate(() => { const g = window.__game, h = g.map.markers.playerHQ; const mine = g.commander.mine(); g.units.order(mine, 'move', h.x, h.z - 20); g.step(30); return mine.filter(u => u.alive).map(u => Math.hypot(u.x - h.x, u.z - (h.z - 20))); });
check(back.length && back.every(d => d < 12), `ordered back home mid-fight, they all get there (${back.map(d => d.toFixed(0)).join(', ')} from the spot)`);
await page.evaluate(id => { const g = window.__game, f = g.units.list.find(u => u.id === id); g.units.attack(g.commander.mine(), f); }, foe.id);

// The battle: step it on and take screenshots mid-fight and after.
const mid = await page.evaluate(() => { const g = window.__game; g.step(6); g.render(); return { shots: g.units.stats.shots, proj: g.units.projectiles.list.length }; });
await page.screenshot({ path: join(out, 'combat-fight.png') });
check(mid.shots > 10, `both sides open fire (${mid.shots} shots in 6 s)`);
const end = await page.evaluate(() => {
  const g = window.__game;
  for (let i = 0; i < 90 && g.units.counts().every(c => c > 0); i++) {
    // Every 15 s, as a player would, send what's left after any enemy left (they may be out of sight of each other).
    if (i % 15 === 14) { const foe = g.units.list.find(u => u.alive && u.team === 1); if (foe) g.units.order(g.commander.mine(), 'amove', foe.x, foe.z); }
    g.step(1);
  }
  g.render();
  const dbg = g.units.list.filter(u => u.alive).map(u => `${u.type}/${u.team} ${u.order}${u.hold ? ' hold' : ''} at ${u.x.toFixed(0)},${u.z.toFixed(0)} target ${!!u.target} near ${!!u.near} sees ${g.units.list.filter(o => o.alive && o.team !== u.team).map(o => g.units.canSeeDirect(u, o) + '@' + Math.hypot(o.x - u.x, o.z - u.z).toFixed(0)).join(',')}`).join(' | ');
  return { dbg, counts: g.units.counts(), kills: g.units.stats.kills, wrecks: g.units.wrecks.length, nan: g.units.list.some(u => !Number.isFinite(u.x + u.z + u.y + u.hp)), sel: [...g.selected].every(u => u.alive) };
});
await page.screenshot({ path: join(out, 'combat-after.png') });
check(end.counts.some(c => c === 0) && end.kills > 0 && end.wrecks > 0, `the fight is decided (${end.counts.join(' vs ')} left, ${end.kills} destroyed, ${end.wrecks} wrecks)${end.counts.every(c => c) ? ' ' + end.dbg : ''}`);
check(!end.nan && end.sel, 'no NaN positions; destroyed mechs drop out of the selection');

// Reset clears the field and brings back the starting squad.
await page.tap('#btnReset');
const r = await page.evaluate(() => ({ n: window.__game.units.list.filter(u => u.alive).length, p: window.__game.units.projectiles.list.length }));
check(r.n === 3 && r.p === 0, `Reset brings back just the starting squad (${r.n} mechs)`);

check(w.errors.length === 0, `no console/page errors${w.errors.length ? ':\n   ' + w.errors.join('\n   ') : ''}`);
await browser.close();
await server.close();
done();
