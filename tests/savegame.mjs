// Pause, save and load: the Pause button stops the match and shows Resume / Save game / Load game; Save game
// downloads a JSON file; loading that file (through the real file picker) brings back the same battle: ground,
// craters and rubble pictures, buildings piece by piece, trees, mechs, structures, wrecks, Builder jobs, credits,
// queues, capture points, explored ground and the camera. Also: rubble pictures round damaged buildings, and fire
// smoke drawn as flat puffs. No errors.
// Run: node tests/savegame.mjs
import { serve, outDir, playwright, checker, watchPage } from './harness.mjs';
import { join } from 'node:path';
import { readFileSync } from 'node:fs';

const { chromium, devices } = playwright;
const { check, done } = checker();
const out = await outDir();
const server = await serve();
const browser = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
const ctx = await browser.newContext({ ...devices['iPad Pro 11 landscape'], acceptDownloads: true });
const page = await ctx.newPage();
const w = watchPage(page, server.url);
const g = (fn, arg) => page.evaluate(fn, arg);

await page.goto(server.url);
await page.waitForFunction(() => window.__game?.ready, null, { timeout: 30000 });
await page.tap('#btnStart');

// ---------- pause ----------
const t0 = await g(() => window.__game.state.time);
await page.waitForTimeout(600);
const t1 = await g(() => window.__game.state.time);
await page.tap('#btnPause');
const shown = await page.isVisible('#pauseScreen');
const t2 = await g(() => window.__game.state.time);
await page.waitForTimeout(800);
const t3 = await g(() => window.__game.state.time);
check(t1 > t0 && shown && t3 === t2, `Pause stops the match (time ${t2.toFixed(2)} -> ${t3.toFixed(2)}) and shows the pause menu`);
check(['#btnResume', '#btnSaveGame', '#btnLoadGame'].every(Boolean) && await page.isVisible('#btnSaveGame') && await page.isVisible('#btnLoadGame'), 'the pause menu has Resume, Save game and Load game');
await page.screenshot({ path: join(out, 'pause-menu.png') });
await page.tap('#btnResume');
await page.waitForTimeout(500);
check(!(await page.isVisible('#pauseScreen')) && (await g(() => window.__game.state.time)) > t3, 'Resume carries on');

// ---------- make a battle worth saving ----------
const before = await g(() => {
  const G = window.__game, B = G.buildings;
  G.pause(); G.ai.step = () => {};
  const T = G.match.teams[0];
  T.credits = 1234.5;
  G.match.enqueue(0, 'medium'); G.match.enqueue(0, 'scout');
  G.match.points[0].control = 0.6;
  // Shell a house (blast marks, holes, rubble), a cannon crater in the open.
  const house = B.list.find(b => b.def.type === 'house');
  for (const [dx, dz, wpn] of [[-4.5, -1, 'cannon'], [4.6, 0.5, 'autocannon'], [0, -3.6, 'shell'], [3, 3.5, 'cannon']]) G.damage.explode(house.def.x + dx, house.def.z + dz, wpn, house.y + 1.2);
  G.damage.explode(house.def.x + 25, house.def.z + 20, 'shell');
  // Knock down some trees.
  const tree = G.forest.trees[Math.floor(G.forest.trees.length / 2)];
  G.damage.explode(tree.x, tree.z, 'shell'); G.damage.explode(tree.x + 3, tree.z, 'shell');
  // A Builder with a wall job half done; a mech sent somewhere; a defending one; an enemy killed (a wreck).
  const hq = G.match.teams[0].hq;
  const b = G.units.spawn('builder', 0, hq.x + 4, hq.z - 22);
  const plan = G.construction.plan('wall', hq.x - 5, hq.z - 26, hq.x + 5, hq.z - 26);
  G.construction.order([b], plan);
  const mine = G.units.list.filter(u => u.team === 0 && !u.t.unarmed);
  G.units.order([mine[0]], 'move', hq.x + 70, hq.z - 90);
  G.units.defend([mine[1]], true);
  const foe = G.units.list.find(u => u.team === 1);
  G.damage.hitUnit(foe, 1e6);
  G.step(4);
  mine[2].hp = 77;
  G.rts.target.set(house.def.x, house.y, house.def.z); G.rts.distance = 40; G.rts.yaw = 0.7; G.rts.update(0);
  G.render();
  const hsum = G.hf.h.reduce((s, v) => s + v, 0);
  const pieces = B.pieces.map(p => (p.alive ? 1 : 0) + (p.brk ? 2 : 0) + p.marks.length * 4).join('');
  return {
    hsum, pieces, defs: B.list.length, chunks: B.chunks.filter(c => c.alive).length, decals: G.decals.log.length, rubbleDecals: G.decals.rubbleCount,
    units: G.units.list.filter(u => u.alive).map(u => `${u.type}/${u.team}/${u.hp.toFixed(0)}`).sort().join(','),
    wrecks: G.units.wrecks.length, credits: T.credits, queue: T.queue.join(','), prog: T.prog, control: G.match.points[0].control,
    jobs: G.construction.jobs.filter(j => !j.done).length, jobProg: G.construction.jobs.find(j => !j.done)?.progress,
    defend: G.units.list.filter(u => u.defend).length, moving: G.units.list.filter(u => u.order === 'move').length,
    explored: G.vision.explored[0].reduce((s, v) => s + v, 0), time: G.state.time, matchTime: G.match.time,
    trees: G.forest.trees.filter(t => t.state !== 0).length, cam: [G.rts.target.x, G.rts.distance, G.rts.yaw].map(v => v.toFixed(2)).join(','),
    plumes: G.effects.plumes.alive, plumeVerts: G.effects.plumes.mesh.geometry.attributes.position.count,
  };
});
check(before.rubbleDecals > 0, `shelling a house leaves rubble pictures on the ground round it (${before.rubbleDecals})`);
const px = await g(() => {
  const G = window.__game, D = G.decals, c = G.config;
  const r = D.log.filter(l => l[0] === 'r')[0];
  const N = D.N, x = Math.round((r[1] / c.MAP_SIZE + 0.5) * N), y = Math.round((r[2] / c.MAP_SIZE + 0.5) * N);
  const d = D.ctx.getImageData(x - 3, y - 3, 7, 7).data;
  let a = 0; for (let i = 3; i < d.length; i += 4) a = Math.max(a, d[i]);
  return a;
});
check(px > 100, `the rubble picture is baked into the ground texture (alpha ${px} at its centre)`);
check(before.plumes > 0 && before.plumeVerts === 4, `fire smoke is drawn as flat puffs (${before.plumes} live, ${before.plumeVerts} vertices each)`);
await page.screenshot({ path: join(out, 'save-before.png') });

// ---------- save ----------
await g(() => window.__game.setUserPause(true));
const [download] = await Promise.all([page.waitForEvent('download'), page.tap('#btnSaveGame')]);
const file = join(out, 'savegame.json');
await download.saveAs(file);
const text = readFileSync(file, 'utf8'), json = JSON.parse(text);
check(json.kind === 'mech-rts-save' && /^mech-rts-.*\.json$/.test(download.suggestedFilename()), `Save game downloads ${download.suggestedFilename()} (${(text.length / 1024).toFixed(0)} KB)`);
check(text.length < 4e6, 'the save is a reasonable size');

// ---------- load (a fresh page, through the file picker) ----------
await page.goto(server.url + '?sandbox');
await page.waitForFunction(() => window.__game?.ready, null, { timeout: 30000 });
await g(() => window.__game.setUserPause(true));
await Promise.all([page.waitForURL(/resume=/, { timeout: 30000 }), page.setInputFiles('#fileLoadGame', file)]);
await page.waitForFunction(() => window.__game?.ready, null, { timeout: 60000 });
const after = await g(() => {
  const G = window.__game, B = G.buildings, T = G.match?.teams[0];
  G.render();
  return {
    paused: G.userPaused, sandbox: G.sandbox, hsum: G.hf.h.reduce((s, v) => s + v, 0),
    pieces: B.pieces.map(p => (p.alive ? 1 : 0) + (p.brk ? 2 : 0) + p.marks.length * 4).join(''), defs: B.list.length, chunks: B.chunks.filter(c => c.alive).length,
    decals: G.decals.log.length,
    units: G.units.list.filter(u => u.alive).map(u => `${u.type}/${u.team}/${u.hp.toFixed(0)}`).sort().join(','),
    wrecks: G.units.wrecks.length, credits: T?.credits, queue: T?.queue.join(','), prog: T?.prog, control: G.match?.points[0].control,
    jobs: G.construction.jobs.filter(j => !j.done).length, jobProg: G.construction.jobs.find(j => !j.done)?.progress,
    builderJobs: G.units.list.filter(u => u.jobs?.length).length,
    defend: G.units.list.filter(u => u.defend).length, moving: G.units.list.filter(u => u.order === 'move').length,
    explored: G.vision.explored[0].reduce((s, v) => s + v, 0), time: G.state.time, matchTime: G.match?.time,
    trees: G.forest.trees.filter(t => t.state !== 0).length, cam: [G.rts.target.x, G.rts.distance, G.rts.yaw].map(v => v.toFixed(2)).join(','),
    hq: G.match?.teams.map(T => T.hq.alive && T.hq.hp > 0),
  };
});
await page.screenshot({ path: join(out, 'save-loaded.png') });
check(after.paused && after.sandbox === false, 'loading reopens the saved match (not the sandbox it was loaded from), paused');
check(Math.abs(after.hsum - before.hsum) < 1, `the ground comes back as it was (height sum ${before.hsum.toFixed(1)} -> ${after.hsum.toFixed(1)})`);
check(after.decals === before.decals, `every crater and rubble picture is back (${after.decals})`);
check(after.defs === before.defs && after.pieces === before.pieces, `buildings come back piece by piece: standing, holed and blast-marked (${before.defs} buildings)`);
check(after.chunks === before.chunks, `and the rubble lying round them (${after.chunks} chips)`);
check(after.trees === before.trees, `trees come back as they were (${after.trees} down or burnt)`);
check(after.units === before.units, `every mech comes back with its strength (${after.units.split(',').length})`);
check(after.wrecks === before.wrecks, `wrecks too (${after.wrecks})`);
check(Math.abs(after.credits - before.credits) < 0.01 && after.queue === before.queue && Math.abs(after.prog - before.prog) < 0.01, `credits ${after.credits}, build queue [${after.queue}] and its progress`);
check(Math.abs(after.control - before.control) < 0.001, `capture point control (${after.control})`);
check(after.jobs === before.jobs && Math.abs(after.jobProg - before.jobProg) < 0.01 && after.builderJobs === 1, `the Builder's unfinished wall (${(after.jobProg * 100).toFixed(0)}% done) and the Builder back on it`);
check(after.defend === before.defend && after.moving === before.moving, `orders: ${after.moving} moving, ${after.defend} defending`);
check(after.explored >= before.explored && after.explored < before.explored * 1.1, `explored ground (${before.explored} cells; ${after.explored} once the units look round again)`);
check(Math.abs(after.time - before.time) < 0.01 && Math.abs(after.matchTime - before.matchTime) < 0.01, `the clock (${after.matchTime.toFixed(1)} s)`);
check(after.cam === before.cam, `the camera (${after.cam})`);
check(after.hq.every(Boolean), 'both HQs standing');
// Play on: no errors, nothing NaN, the moving mech gets there.
await page.tap('#btnResume');
await page.waitForTimeout(300);
const play = await g(() => { const G = window.__game; G.pause(); G.step(20); G.render(); return { ok: G.units.list.every(u => Number.isFinite(u.x + u.z + u.hp)), t: G.match.time }; });
check(play.ok && play.t > after.matchTime + 19, 'the loaded match plays on (20 s, no NaN)');
check(w.errors.length === 0, `no console/page errors${w.errors.length ? ':\n   ' + w.errors.join('\n   ') : ''}`);

// A file that isn't a save is refused with a message.
await page.goto(server.url + '?sandbox');
await page.waitForFunction(() => window.__game?.ready, null, { timeout: 30000 });
await g(() => window.__game.setUserPause(true));
await page.setInputFiles('#fileLoadGame', { name: 'map.json', mimeType: 'application/json', buffer: Buffer.from('{"formatVersion":3}') });
await page.waitForFunction(() => document.getElementById('pauseMsg').textContent, null, { timeout: 5000 }).catch(() => {});
const msg = await page.textContent('#pauseMsg');
check(/not a Mech RTS saved game/.test(msg) && !page.url().includes('resume'), `a file that isn't a saved game is refused ("${msg}")`);

await browser.close();
await server.close();
done();
