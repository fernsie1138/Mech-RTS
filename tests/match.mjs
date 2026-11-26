// Milestone 8 browser test: a whole match through the UI. Start screen, HUD, building mechs, capture points,
// minimap, the Dev tools, attacking the enemy HQ, victory and defeat screens, Play again; no errors.
// Run: node tests/match.mjs
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
const cdp = await ctx.newCDPSession(page);
const touch = (type, x, y) => cdp.send('Input.dispatchTouchEvent', { type, touchPoints: type === 'touchEnd' ? [] : [{ x, y, id: 0, radiusX: 1, radiusY: 1, force: 1 }] });
const tap = async (x, y) => { await touch('touchStart', x, y); await touch('touchEnd'); await page.waitForTimeout(150); };
const g = fn => page.evaluate(fn);
const visible = sel => page.evaluate(s => { const e = document.querySelector(s); return !!e && getComputedStyle(e).display !== 'none'; }, sel);

// ---------- start ----------
check(await g(() => !window.__game.sandbox && !!window.__game.match), 'the game opens a match on the sample map');
check(await visible('#startScreen'), 'the start screen is shown');
await page.screenshot({ path: join(out, 'match-start.png') });
const t0 = await g(() => window.__game.state.time);
await page.waitForTimeout(800);
check(await g(() => window.__game.state.time) === t0, 'nothing moves until Start is pressed');
const s0 = await g(() => ({ mine: window.__game.units.list.filter(u => u.team === 0).length, foes: window.__game.units.list.filter(u => u.team === 1).length, hqs: window.__game.units.structures.length }));
check(s0.mine === 3 && s0.foes === 3 && s0.hqs === 2, `each side starts with an HQ and a squad (${s0.mine} vs ${s0.foes}, ${s0.hqs} HQs)`);
await page.tap('#btnStart');
await page.waitForTimeout(600);
check(!(await visible('#startScreen')) && (await g(() => window.__game.state.time)) > t0, 'Start closes the screen and the match runs');
await g(() => window.__game.pause());

// ---------- HUD and building ----------
await g(() => window.__game.render());
await page.waitForTimeout(300);
const hud = await g(() => ({ c: document.getElementById('credits').textContent, p: document.getElementById('points').textContent, cards: document.querySelectorAll('#build .card').length }));
check(/⚡ \d+/.test(hud.c) && /0\/5/.test(hud.p) && hud.cards === 3, `HUD: credits "${hud.c}", points "${hud.p}", ${hud.cards} build buttons`);
check(!(await visible('#btnSpawn')) && (await visible('#btnDev')), 'test tools are tucked away behind Dev');
await page.tap('#btnDev');
check(await visible('#btnSpawn') && await visible('[data-weapon="shell"]'), 'Dev shows the test tools');
await page.tap('#btnDev');
const cr0 = await g(() => window.__game.match.teams[0].credits);
await page.tap('.card[data-type="scout"]');
const q1 = await g(() => ({ c: window.__game.match.teams[0].credits, q: [...window.__game.match.teams[0].queue] }));
check(q1.q.join() === 'scout' && Math.abs(cr0 - q1.c - 100) < 1e-6, `tapping Scout queues one and pays 100 (${q1.q})`);
await page.tap('.card[data-type="titan"]');
const q2 = await g(() => window.__game.match.teams[0].queue.length);
await page.waitForTimeout(300);
check(q2 === 1 && /power/.test(await page.textContent('#banner')), 'a Titan with too little power is refused with a message');
await g(() => window.__game.match.teams[0].credits = 2000);
await page.tap('.card[data-type="assault"]');
// Press and hold to take it back.
const card = await page.locator('.card[data-type="assault"]').boundingBox();
await touch('touchStart', card.x + 30, card.y + 30); await page.waitForTimeout(800); await touch('touchEnd'); await page.waitForTimeout(150);
const qh = await g(() => window.__game.match.teams[0].queue.join());
check(qh === 'scout', `press and hold on a build button cancels one (queue: ${qh})`);
const built = await g(() => { const G = window.__game; G.step(5); return G.units.list.filter(u => u.team === 0).length; });
check(built === 4, `the Scout is built and joins the army (${built} mechs)`);

// ---------- capture point ----------
const cap = await g(() => {
  const G = window.__game, p = G.match.points.reduce((a, b) => Math.hypot(b.x - G.map.markers.playerHQ.x, b.z - G.map.markers.playerHQ.z) < Math.hypot(a.x - G.map.markers.playerHQ.x, a.z - G.map.markers.playerHQ.z) ? b : a);
  const mine = G.units.list.filter(u => u.team === 0);
  G.units.order(mine, 'move', p.x, p.z);
  for (let i = 0; i < 90 && p.owner !== 0; i++) G.step(1);
  G.rts.target.set(p.x, 0, p.z + 10); G.rts.distance = 70; G.rts.update(0); G.render();
  return { owner: p.owner, income: G.match.income(0), banner: document.getElementById('banner').textContent };
});
await page.waitForTimeout(300);
check(cap.owner === 0 && cap.income === 9, `walking the army onto a capture point takes it (income now +${cap.income}/s)`);
check(/secured/.test(cap.banner), `a banner says so ("${cap.banner}")`);
await page.screenshot({ path: join(out, 'match-capture.png') });

// ---------- minimap ----------
const mm = await page.locator('#minimap').boundingBox();
await tap(mm.x + mm.width * 0.5, mm.y + mm.height * 0.1);
const cam = await g(() => ({ x: window.__game.rts.target.x, z: window.__game.rts.target.z }));
check(Math.abs(cam.x) < 4 && Math.abs(cam.z - (-0.4 * 256)) < 4, `tapping the minimap moves the camera there (${cam.x.toFixed(0)}, ${cam.z.toFixed(0)})`);

// ---------- attack the enemy HQ by tapping it ----------
const hqTap = await g(() => {
  const G = window.__game, H = G.units.structures[1];
  G.rts.target.set(H.x, 0, H.z + 20); G.rts.distance = 80; G.rts.update(0); G.render();
  G.commander.setSelection(G.commander.mine());
  const v = new G.THREE.Vector3(H.x, H.y + 6, H.z).project(G.camera);
  return { x: (v.x + 1) / 2 * innerWidth, y: (1 - v.y) / 2 * innerHeight };
});
await tap(hqTap.x, hqTap.y);
check(await g(() => window.__game.units.list.filter(u => u.team === 0).every(u => u.order === 'attack' && u.attackTarget?.isHQ)), 'tapping the enemy HQ orders the selected mechs to attack it');
await page.screenshot({ path: join(out, 'match-hq.png') });

// ---------- a stretch of real play: the AI builds, attacks, and the map wears down ----------
const mid = await g(() => {
  const G = window.__game, m = G.match;
  m.teams[0].credits = 1500;
  for (const k of ['assault', 'assault', 'titan', 'scout', 'scout']) m.enqueue(0, k);
  G.units.order(G.commander.mine(), 'amove', 0, -13);
  G.step(150);
  const P = m.points[1];
  G.rts.target.set(P.x, 0, P.z); G.rts.distance = 110; G.rts.update(0); G.render();
  return { t: m.time, foes: G.units.counts()[1], mine: G.units.counts()[0], built: m.teams.map(T => T.built), wave: G.ai.wave, held: [m.held(0), m.held(1)], over: !!m.over,
    nan: G.units.list.some(u => !Number.isFinite(u.x + u.z + u.y)) };
});
check(mid.built[1] >= 5 && mid.wave >= 1, `the enemy builds (${mid.built[1]} mechs) and sends waves (${mid.wave})`);
check(!mid.nan, `no NaN after ${mid.t.toFixed(0)} s of play (${mid.mine} vs ${mid.foes} mechs, points ${mid.held.join(' / ')})`);
await page.waitForTimeout(300);
await page.screenshot({ path: join(out, 'match-midgame.png') });

// ---------- victory ----------
const win = await g(() => {
  const G = window.__game, H = G.units.structures[1];
  if (!G.match.over) { H.hp = 1; G.damage.explode(H.x, H.z, 'shell', H.y + 4, { dmg: 50, splash: 9, team: 0 }); }
  G.step(4); G.render();
  return { over: G.match.over, alive: H.alive };
});
await page.waitForTimeout(400);
const endTxt = await page.textContent('#endTitle');
check(win.over?.winner === 0 && !win.alive && await visible('#endScreen') && endTxt === 'VICTORY', `destroying the enemy HQ wins: "${endTxt}"`);
await page.screenshot({ path: join(out, 'match-victory.png') });

// ---------- play again, then a defeat ----------
await page.tap('#btnAgain');
const again = await g(() => { const G = window.__game; return { over: G.match.over, hqs: G.units.structures.map(h => h.alive), n: G.units.list.length, t: G.match.time }; });
check(!(await visible('#endScreen')) && again.over === null && again.hqs.every(Boolean) && again.n === 6 && again.t === 0, 'Play again starts a fresh match (both HQs back, a squad each)');
const lose = await g(() => { const G = window.__game, H = G.units.structures[0]; H.hp = 1; G.damage.hitUnit(H, 10); G.step(4); return G.match.over; });
await page.waitForTimeout(400);
check(lose?.winner === 1 && (await page.textContent('#endTitle')) === 'DEFEAT', 'losing your HQ ends the match in defeat');
await page.screenshot({ path: join(out, 'match-defeat.png') });

check(w.errors.length === 0, `no console/page errors${w.errors.length ? ':\n   ' + w.errors.join('\n   ') : ''}`);
await browser.close();
await server.close();
done();
