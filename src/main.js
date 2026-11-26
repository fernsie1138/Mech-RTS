// Game bootstrap and main loop.
// Loads a map (?map=<name> from maps/, ?map=@test from the editor, ?map=@procedural), then plays a match on it:
// both HQs, an economy, capture points and the enemy AI (CLAUDE.md §9). With ?sandbox (or a map without both
// HQs) it is the combat sandbox instead: your squad, test enemy squads and the test weapons, no AI.
import * as THREE from 'three';
import { VERSION } from './version.js';
import * as config from './config.js';
import { SIM } from './config.js';
import { createView } from './view.js';
import { loadMapUrl, loadMapStorage, proceduralMap, snapshot, restore, reloadFresh, clearFreshReload, TEST_KEY } from './maps/loader.js';
import { Effects } from './combat/effects.js';
import { Damage } from './combat/damage.js';
import { DebugOverlay } from './ui/debug.js';
import { NavGrid, NAV_CLASSES } from './nav/navgrid.js';
import { Movers } from './units/movers.js';
import { Units } from './units/units.js';
import { MechView } from './units/mech.js';
import { Commander } from './ui/command.js';
import { Match } from './game/match.js';
import { EnemyAI } from './ai/enemy.js';
import { Hud } from './ui/hud.js';
import { Minimap } from './ui/minimap.js';
import { MAP_SIZE, BUILD, BUILD_KEYS, TERRAIN } from './config.js';
import { Construction } from './world/construction.js';
import { initMobileMode } from './ui/mobile.js';
import { Vision } from './game/vision.js';
import { StatsEditor } from './ui/stats.js';
import { FogView } from './world/fogview.js';
import { Decals } from './world/decals.js';

// ---------- version label (warns if index.html and the JS are from different builds) ----------
const htmlBuild = document.querySelector('meta[name="build"]')?.content;
const verEl = document.getElementById('ver');
verEl.textContent = VERSION;
if (htmlBuild && htmlBuild !== VERSION) {
  verEl.textContent = `${VERSION} (page ${htmlBuild}: stale cache, reload)`;
  verEl.classList.add('stale');
}

const loading = document.getElementById('loading');
function fatal(msg) {
  const f = document.getElementById('fatal');
  f.style.display = 'flex';
  f.textContent = msg;
  loading.style.display = 'none';
}

// ---------- which map ----------
const params = new URLSearchParams(location.search);
const mapParam = params.get('map') || 'sample';
const fromEditor = mapParam === '@test';
const wantSandbox = params.has('sandbox');

async function loadChosenMap() {
  if (mapParam === '@procedural') return proceduralMap();
  if (fromEditor) {
    const m = await loadMapStorage(TEST_KEY);
    if (!m) throw new Error('No map from the editor was found. Open the editor and press Test again.');
    return m;
  }
  if (!/^[\w-]+$/.test(mapParam)) throw new Error(`Bad map name "${mapParam}"`);
  return loadMapUrl(`maps/${mapParam}.json`);
}

let map;
try {
  map = await loadChosenMap();
} catch (e) {
  if (reloadFresh(e)) { loading.textContent = 'Updating to the latest version…'; await new Promise(() => {}); }
  fatal(`Could not load the map: ${e.message}`);
  await new Promise(() => {});     // stop here; the message stays on screen
}
clearFreshReload();
loading.style.display = 'none';
const pristine = snapshot(map);   // matches never modify the map file: Reset restores this copy

// Editor button: back to the editor (with this map if it came from there).
const btnEditor = document.getElementById('btnEditor');
btnEditor.textContent = fromEditor ? '◀ Editor' : 'Editor';
btnEditor.addEventListener('pointerup', () => {
  location.href = fromEditor ? 'editor.html' : `editor.html?map=${encodeURIComponent(mapParam)}`;
});
document.getElementById('mapname').textContent = map.name;

// ---------- view ----------
const canvas = document.getElementById('view');
const view = createView(canvas, map);
const { renderer, scene, camera, rts } = view;
const { hf, surface } = map;
const heightAt = view.heightAt;
// Start looking at the player HQ if the map has one.
if (map.markers.playerHQ) { rts.target.set(map.markers.playerHQ.x, heightAt(map.markers.playerHQ.x, map.markers.playerHQ.z), map.markers.playerHQ.z - 30); rts.update(0); }

// ---------- effects and damage ----------
const effects = new Effects(scene, (x, z) => hf.heightAt(x, z));
const world = { hf, surface, get water() { return view.water; }, get forest() { return view.forest; }, get buildings() { return view.buildings; } };
// Crater pictures baked into the ground, and in a match a limit on how deep craters can go.
const decals = new Decals(renderer, `assets/craters.png?${VERSION}`);
decals.patch(view.terrain.material);
hf.setFloor(TERRAIN.maxDig);
const damage = new Damage({ hf, surface, effects, decals,
  get water() { return view.water; }, get forest() { return view.forest; }, get buildings() { return view.buildings; }, get nav() { return nav; }, get units() { return units; } });

// ---------- nav grid and test units (milestone 6) ----------
const nav = new NavGrid(world);
hf.onChange((i0, j0, i1, j1) => nav.markSamples(i0, j0, i1, j1));
let waterHooked = null;
function hookWater() { if (waterHooked !== view.water) { waterHooked = view.water; view.water.onChange((i0, j0, i1, j1) => nav.markSamples(i0, j0, i1, j1)); } }
hookWater();
const movers = new Movers(nav);
world.nav = nav;
const units = new Units(world, movers, damage, 7);
// Dev: unit stats editor. Saved changes are applied now, before anything is built or spawned.
let costsReady = false;           // the HUD and Builder panel exist (set further down)
const stats = new StatsEditor({ units, onChange: () => refreshCosts() });
const mechView = new MechView(scene, heightAt);
mechView.loadModels().catch(e => console.warn('Medium Mech model did not load:', e.message));
// Builders' construction: walls, turrets, trenches. Paid from the match's credits (free in the sandbox).
const construction = new Construction(world, {
  pay: (team, cost) => { if (!match) return true; const T = match.teams[team]; if (T.credits < cost) return false; T.credits -= cost; return true; },
  onBuilding: () => view.buildingView.setBuildings(view.buildings),
  enemyDir: team => { const m = map.markers; return m.playerHQ && m.enemyHQ ? Math.sign((team === 0 ? m.enemyHQ.z - m.playerHQ.z : m.playerHQ.z - m.enemyHQ.z)) || -1 : (team === 0 ? -1 : 1); },
});
mechView.construction = construction;
world.units = units;
const selected = new Set();
const SQUAD = ['scout', 'assault', 'titan'];
function spawnSquad(team, x, z, types = SQUAD) {
  return types.map((type, k) => units.spawn(type, team, x + (k - 1) * 7, z));
}
// Match or sandbox.
const sandbox = wantSandbox || !map.markers.playerHQ || !map.markers.enemyHQ;
document.body.classList.toggle('match', !sandbox);
let match = null, ai = null;
// Fog of war: on in a match (?fog=0 or the Dev "Fog" button turns it off), off in the sandbox.
const vision = new Vision(world, units, { teams: [0] });
const fogView = new FogView(vision.n);
const fog = { on: !sandbox && params.get('fog') !== '0' };
fogView.enabled = fog.on;
const seesEnemy = u => !fog.on || u.team === 0 || vision.sees(0, u);
mechView.shown = u => seesEnemy(u) || (u.isStructure && u.known);
mechView.inView = (x, z, explored) => !fog.on || vision.isVisible(0, x, z) || (explored && vision.isExplored(0, x, z));
const game = { started: sandbox, endAt: null, hqWarnT: -99 };
function resetFog() {
  vision.clear();
  vision.update(Infinity, true);
  fogView.clear();
  fogView.snap(vision);
}
function setFog(on) {
  fog.on = on;
  fogView.enabled = on;
  document.getElementById('btnFog')?.classList.toggle('on', on);
  if (on) resetFog();
}
function clearUnits() {
  for (const u of units.list) movers.remove(u.mover);
  units.list.length = 0; units.structures.length = 0; units.wrecks.length = 0; units.projectiles.list.length = 0; units.events.length = 0;
  world.blockers = [];
  selected.clear();
  construction.clear();
}
// Units at the start: a squad each side in a match (by the HQs), just yours in the sandbox.
function startUnits() {
  clearUnits();
  if (!sandbox) {
    match = new Match(units, map.markers, { size: MAP_SIZE });
    ai = new EnemyAI(match);
    nav.flush();                                // the HQs block movement before anything spawns
    for (const T of match.teams) {
      const sq = spawnSquad(T.team, T.rally.x, T.rally.z);
      if (T.team === 0) sq.forEach(u => selected.add(u));
    }
    game.endAt = null;
    resetFog();
    return;
  }
  const P = map.markers.playerHQ || { x: 0, z: 40 };
  const sq = spawnSquad(0, P.x, P.z - 18);
  selected.clear(); sq.forEach(u => selected.add(u));
}
startUnits();
// Nav overlay: tint ground the selected (or medium) class can't cross red, slow ground yellow.
const navOverlay = { on: false };
function overlayClass() { const s = [...selected][0]; return s ? s.t.cls : 1; }
function setNavOverlay(on) {
  navOverlay.on = on;
  view.terrain.overlay = on ? (gi, gj, rgb) => {
    const c = nav.cost[overlayClass()][nav.idx(hf.wx(gi), hf.wz(gj))];
    const t = c === Infinity ? 0.6 : c > 2 ? 0.3 : 0, col = c === Infinity ? [0.9, 0.1, 0.05] : [0.95, 0.8, 0.1];
    for (let q = 0; q < 3; q++) rgb[q] += (col[q] - rgb[q]) * t;
  } : null;
  view.terrain.rebuildAll();
  document.getElementById('btnNav').classList.toggle('on', on);
}
document.getElementById('btnNav').addEventListener('pointerup', () => setNavOverlay(!navOverlay.on));

// ---------- debug overlay ----------
const debug = new DebugOverlay(document.getElementById('debug'), document.getElementById('btnDebug'), renderer);
debug.extra = () => {
  const c = view.forest.counts();
  const uc = units.counts();
  return (match ? `match      ${match.time.toFixed(0)} s  credits ${match.teams.map(T => Math.floor(T.credits)).join(' / ')}  queue ${match.teams.map(T => T.queue.length).join(' / ')}  AI wave ${ai.wave} (next ${ai.waveSize})\n` : '') +
         `mechs      ${uc[0]} yours, ${uc[1]} enemy (${units.wrecks.length} wrecks) shots ${units.stats.shots} hits ${units.stats.hits}\n` +
         `paths      ${movers.stats.paths}  projectiles ${units.projectiles.list.length}  particles ${effects.activeCount()}\n` +
         `nav queue  ${nav.queue.length}  escapes ${movers.stats.escapes}  replans ${movers.stats.replans}\n` +
         `chunks     ${view.terrain.chunks.length} (dirty ${view.terrain.dirty.size})\n` +
         `rebuilds   ${view.terrain.rebuildCount}\n` +
         `water tris ${view.waterMesh.triangleCount()}\n` +
         `trees      ${view.forest.trees.length} (${c.fallen} down, ${c.burning} burning, ${c.stump} gone)\n` +
         `buildings  ${view.buildings.list.length} (${Object.entries(view.buildings.counts()).filter(e => e[1]).map(e => e[1] + ' ' + e[0]).join(', ')})`;
};

// ---------- simulation (fixed step) ----------
const state = { time: 0, steps: 0, weapon: 'move', pending: [] };   // weapon 'move' = Move mode. pending: scheduled impacts

function simStep(dt) {
  state.time += dt;
  state.steps++;
  while (state.pending.length && state.pending[0].at <= state.time) {
    const s = state.pending.shift();
    damage.explode(s.x, s.z, s.weapon);
  }
  damage.update(dt);
  // Nav changes: apply a couple of dirty rectangles per step, refreshing the overlay there.
  for (let k = 0; k < 2 && nav.queue.length; k++) {
    const r = nav.queue[0];
    nav.update();
    if (navOverlay.on && r) view.terrain.markDirty(hf.gx(nav.cx(r[0]) - 4), hf.gz(nav.cz(r[1]) - 4), hf.gx(nav.cx(r[2]) + 4), hf.gz(nav.cz(r[3]) + 4));
  }
  movers.step(dt);
  units.step(dt);
  construction.step(dt);
  if (fog.on) vision.update(dt);
  for (const e of construction.events) {
    if (e.type === 'work') { if (e.kind === 'trench') effects.dust(e.x, e.y, e.z, 0.5); else effects.sparksAt(e.x, e.y + 0.8, e.z, 2); }
    else if (e.type === 'built' && e.job.team === 0) hud.banner(`${BUILD[e.job.kind].name} finished`, '#e8b02a', 1.5);
  }
  construction.events.length = 0;
  if (match) { match.step(dt); ai.step(dt); }
  for (const e of units.events) {
    if (e.type === 'fire') effects.muzzle(e.x, e.y, e.z, e.kind === 'mg' ? 0.4 : e.kind === 'autocannon' ? 0.6 : e.kind === 'cannon' ? 0.8 : 1.3);
    else if (e.type === 'hit') {
      effects.sparksAt(e.x, e.y, e.z, e.kind === 'mg' ? 3 : 8);
      if (e.unit.isHQ && e.unit.team === 0 && state.time - game.hqWarnT > 20) { game.hqWarnT = state.time; hud.banner('Your HQ is under attack!', '#ff8a70'); }
    }
    else if (e.type === 'death') { selected.delete(e.unit); match?.unitLost(e.unit); }
  }
  units.events.length = 0;
  if (match) {
    for (const e of match.events) {
      if (e.type === 'captured') hud.banner(e.team === 0 ? 'Capture point secured' : 'The enemy took a capture point', e.team === 0 ? '#7cb8ff' : '#ff8a70');
      else if (e.type === 'lost' && e.team === 0) hud.banner('Capture point lost', '#ff8a70');
      else if (e.type === 'end') { game.endAt = state.time + 3; hud.banner(e.winner === 0 ? 'Enemy HQ destroyed!' : 'Your HQ has fallen', e.winner === 0 ? '#7cb8ff' : '#ff8a70', 3); }
    }
    match.events.length = 0;
    for (const e of ai.events) if (e.target === 'hq') hud.banner('Enemy attack heading for your HQ!', '#ff8a70');
    ai.events.length = 0;
    if (game.endAt !== null && state.time >= game.endAt) { game.endAt = null; hud.end(match.over.winner === 0, match); }
  }
  effects.update(dt);
}

const pickGround = view.pickGround;
function fireAt(x, z, weapon = state.weapon) { return damage.explode(x, z, weapon); }

// Barrage: shells land at random around a point over a few seconds.
function barrage(cx, cz, { count = 24, radius = 22, seconds = 3, weapon = 'shell', seed = 1 } = {}) {
  let s = seed;
  const rnd = () => { s = (s * 16807) % 2147483647; return s / 2147483647; };
  const shots = [];
  for (let n = 0; n < count; n++) {
    const a = rnd() * Math.PI * 2, r = Math.sqrt(rnd()) * radius;
    shots.push({ at: state.time + rnd() * seconds, x: cx + Math.cos(a) * r, z: cz + Math.sin(a) * r, weapon });
  }
  state.pending.push(...shots);
  state.pending.sort((a, b) => a.at - b.at);
}

function resetTerrain() {
  state.pending.length = 0;
  restore(map, pristine);
  hf.setFloor(TERRAIN.maxDig);
  decals.clear();
  view.terrain.rebuildAll();
  view.rebuildWater();
  view.reloadTrees();
  view.reloadBuildings();
  hookWater();
  clearUnits();
  nav.queue.length = 0;
  nav.rebuild();
  if (navOverlay.on) view.terrain.rebuildAll();
  startUnits();
}

// ---------- HUD: orders and test toolbar ----------
const commander = new Commander({ units, mechView, view, rts, effects, damage, selected, state, boxEl: document.getElementById('boxsel'), construction });
commander.canSee = u => seesEnemy(u) || (u.isStructure && u.known);
document.getElementById('btnFog').classList.toggle('on', fog.on);
commander.onSelect = () => { if (navOverlay.on) view.terrain.rebuildAll(); updateSelInfo(); };
// Builder panel: shown while Builders are selected.
const buildPanel = document.getElementById('buildpanel'), buildHint = document.getElementById('buildhint');
const buildBtns = buildPanel.querySelectorAll('[data-build]');
function refreshCosts() {
  if (!costsReady) return;
  buildBtns.forEach(b => { b.querySelector('.c').textContent = `⚡${BUILD[b.dataset.build].cost}`; });
  hud.refreshCosts();
}
function setPlacing(kind) {
  commander.setPlacing(kind);
  document.getElementById('btnRepair')?.classList.remove('on');
  buildBtns.forEach(b => b.classList.toggle('on', b.dataset.build === kind));
  buildHint.style.display = kind ? 'block' : 'none';
  buildHint.textContent = kind === 'turret' ? 'Tap where the turret goes' : kind ? `Tap to place a ${BUILD[kind].name.toLowerCase()}, or drag a line for a longer one` : '';
}
// A planned wall / trench: Turn (15° steps), Build, Cancel.
const btnRepair = document.getElementById('btnRepair');
btnRepair.addEventListener('pointerup', () => {
  selectWeapon('move');
  const on = commander.placing !== 'repair';
  setPlacing(null);
  if (on) { commander.setPlacing('repair'); btnRepair.classList.add('on'); buildHint.style.display = 'block'; buildHint.textContent = 'Tap the mech, turret or HQ to repair'; }
});
const placeBar = document.getElementById('placebar');
commander.onPending = p => {
  placeBar.style.display = p ? 'flex' : 'none';
  document.body.classList.toggle('pending', !!p);
  if (p) buildHint.textContent = 'Turn it with ⟲ ⟳ · tap elsewhere to move it · then Build';
};
const ROT = Math.PI / 12;
document.getElementById('btnRotL').addEventListener('pointerup', () => commander.rotatePending(ROT));
document.getElementById('btnRotR').addEventListener('pointerup', () => commander.rotatePending(-ROT));
document.getElementById('btnPlace').addEventListener('pointerup', () => commander.confirmPending());
document.getElementById('btnPlaceX').addEventListener('pointerup', () => setPlacing(null));
buildBtns.forEach(b => b.addEventListener('pointerup', () => { selectWeapon('move'); setPlacing(commander.placing === b.dataset.build ? null : b.dataset.build); }));
commander.onPlaced = (r, kind) => {
  setPlacing(null);
  commander.onPending(null);
  if (kind === 'repair') { hud.banner(r.repair ? `Repairing ${r.repair.t.name}` : 'Tap one of your mechs to repair it', '#e8b02a', 1.5); return; }
  if (r.refused === 'poor') hud.refused('poor');
  else if (r.refused === 'site' && !r.jobs.length) hud.banner("Can't build there", '#ffd25a', 1.8);
  else if (r.jobs.length) hud.banner(`${r.jobs.length > 1 ? r.jobs.length + ' ' : ''}${BUILD[kind].name}${r.jobs.length > 1 ? (kind === 'trench' ? ' sections' : 's') : ''} ordered`, '#e8b02a', 1.5);
};
function updateBuildPanel() {
  const any = commander.builders().length > 0;
  buildPanel.style.display = any ? 'flex' : 'none';
  if (!any && commander.placing) setPlacing(null);
}
const weaponBtns = document.querySelectorAll('[data-weapon]');
function selectWeapon(w) {
  state.weapon = w;
  weaponBtns.forEach(b => b.classList.toggle('on', b.dataset.weapon === w));
}
weaponBtns.forEach(b => b.addEventListener('pointerup', () => selectWeapon(b.dataset.weapon)));
selectWeapon(state.weapon);
const btnKind = document.getElementById('btnKind');
// Tap-on-ground order: Move (default; go there, shooting on the way) or A-Move (stop to fight anything met).
function setMoveKind(k) { commander.moveKind = k; btnKind.textContent = k === 'amove' ? 'A-Move' : 'Move'; btnKind.classList.toggle('on', k === 'amove'); }
btnKind.addEventListener('pointerup', () => setMoveKind(commander.moveKind === 'amove' ? 'move' : 'amove'));
setMoveKind('move');
document.getElementById('btnAll').addEventListener('pointerup', () => { selectWeapon('move'); commander.setSelection(commander.mine()); });
document.getElementById('btnSpawn').addEventListener('pointerup', () => { selectWeapon('move'); commander.setSelection(spawnSquad(0, rts.target.x, rts.target.z + 12)); });
document.getElementById('btnEnemy').addEventListener('pointerup', () => spawnSquad(1, rts.target.x, rts.target.z - 30, [...SQUAD, 'scout', 'assault']));
document.getElementById('btnFog').addEventListener('pointerup', () => setFog(!fog.on));
document.getElementById('btnStats').addEventListener('pointerup', () => stats.open());
document.getElementById('btnStop').addEventListener('pointerup', () => units.stop([...selected].filter(u => u.alive)));
// Defend: on for the selected mechs (off again if they are all defending already).
const btnDefend = document.getElementById('btnDefend');
function toggleDefend() {
  const sel = [...selected].filter(u => u.alive && !u.isStructure);
  if (!sel.length) return;
  units.defend(sel, !sel.every(u => u.defend));
}
btnDefend.addEventListener('pointerup', toggleDefend);
function updateDefendBtn() {
  const sel = [...selected].filter(u => u.alive);
  btnDefend.classList.toggle('on', sel.length > 0 && sel.every(u => u.defend));
}
document.getElementById('btnDev').addEventListener('pointerup', () => {
  const on = document.body.classList.toggle('devopen');
  document.getElementById('btnDev').classList.toggle('on', on);
  if (!on) selectWeapon('move');
});
document.getElementById('btnBarrage').addEventListener('pointerup', () => barrage(rts.target.x, rts.target.z, { seed: (state.steps % 9973) + 1 }));
document.getElementById('btnReset').addEventListener('pointerup', resetTerrain);
const selInfo = document.getElementById('selinfo');
function updateSelInfo() {
  const n = {}; for (const u of selected) n[u.t.name] = (n[u.t.name] || 0) + 1;
  const txt = Object.entries(n).map(([k, v]) => `${v} ${k}${v > 1 ? 's' : ''}`).join(', ');
  selInfo.textContent = txt; selInfo.style.display = txt ? 'block' : 'none';
}
updateSelInfo();
// Match HUD and minimap.
const hud = new Hud({
  getMatch: () => match,
  onBuild: type => { if (!match) return; const r = match.enqueue(0, type); if (r !== true) hud.refused(r); },
  onUnbuild: type => match?.dequeue(0, type),
  onStart: () => { game.started = true; hud.banner('Build mechs and take the capture points'); },
  onAgain: () => { resetTerrain(); game.started = true; },
});
costsReady = true;
refreshCosts();
// Mobile Mode: compact UI for phones; the camera starts a little closer so mechs are big enough to tap.
let mobileFirst = true;
const mobile = initMobileMode(document.getElementById('btnMobile'), on => {
  commander.tapSlop = on ? 26 : 14;
  if (mobileFirst && on) { rts.distance = Math.min(rts.distance, 85); rts.update(0); }
  mobileFirst = false;
});
const minimap = new Minimap(document.getElementById('minimap'), { world, rts, units, size: MAP_SIZE, getMatch: () => match, selected, fog: { vision, on: () => fog.on } });
if (!sandbox) hud.showStart();
let patchT = Infinity;
function updateFogView(dt) {
  if ((patchT += dt) > 1) { patchT = 0; fogView.patchScene(scene); }       // new materials (e.g. rebuilt buildings)
  if (!fog.on) return;
  fogView.update(dt, vision);
  for (const h of units.structures) if (h.team !== 0 && vision.sees(0, h)) h.known = true;
}
function updateMatchView(dt) {
  if (!match) return;
  for (const h of units.structures) view.markers.setHQ(h.team, h.yaw + h.torsoYaw, h.alive);
  for (const p of match.points) view.markers.setCapture(p.index, p.control);
  hud.update(dt);
  minimap.update(dt);
}

window.addEventListener('keydown', e => {
  if (e.key === '0') selectWeapon('move');
  if (e.key === '1') selectWeapon('mg');
  if (e.key === '2') selectWeapon('cannon');
  if (e.key === '3') selectWeapon('shell');
  if (e.key === 'm') setMoveKind(commander.moveKind === 'amove' ? 'move' : 'amove');
  if (e.key === 'b') barrage(rts.target.x, rts.target.z, { seed: (state.steps % 9973) + 1 });
});

// ---------- main loop ----------
let paused = false;          // tests can pause the real-time loop and drive simStep() via __game.step()
let accum = 0;
let lastT = performance.now();
let lastSel = -1;

function frame(now) {
  const dt = Math.min((now - lastT) / 1000, 0.25);
  lastT = now;
  if (!paused && game.started) {
    accum += dt;
    let n = 0;
    while (accum >= SIM.stepSeconds && n < SIM.maxStepsPerFrame) {
      simStep(SIM.stepSeconds);
      accum -= SIM.stepSeconds;
      n++;
    }
    if (n === SIM.maxStepsPerFrame) accum = 0;   // fell behind: drop time rather than spiral
  }
  view.update(dt);
  updateFogView(dt);
  decals.flush();
  mechView.update(units, selected, camera);
  updateMatchView(dt);
  if (selected.size !== lastSel) { lastSel = selected.size; updateSelInfo(); }
  updateBuildPanel();
  updateDefendBtn();
  view.render();
  debug.frame(dt);
  requestAnimationFrame(frame);
}
requestAnimationFrame(frame);

// ---------- test hook (see CLAUDE.md §11) ----------
window.__game = {
  version: VERSION,
  config,               // live tunables (tests may adjust, e.g. tap timing under slow software rendering)
  THREE, renderer, scene, camera, rts, state, debug, view, map,
  hf, surface, terrain: view.terrain, effects, damage,
  get water() { return view.water; }, get forest() { return view.forest; }, get buildings() { return view.buildings; },
  heightAt, pickGround, fireAt, barrage, resetTerrain, selectWeapon,
  nav, movers, units, mechView, commander, selected, spawnSquad, setNavOverlay, setMoveKind, NAV_CLASSES,
  get match() { return match; }, get ai() { return ai; }, sandbox, game, hud, minimap, construction, setPlacing, mobile,
  vision, fogView, fog, setFog, statsEditor: stats, decals,
  pause(on = true) { paused = on; },
  // Advance the simulation by `seconds` in fixed steps, independent of real time.
  step(seconds) {
    const n = Math.round(seconds / SIM.stepSeconds);
    for (let i = 0; i < n; i++) simStep(SIM.stepSeconds);
    return state.time;
  },
  // Rebuild dirty chunks (all, or up to `limit`) and render one frame immediately.
  render(limit = Infinity) { view.update(0, limit); updateFogView(1); decals.flush(); mechView.update(units, selected, camera); updateMatchView(0.3); view.render(); return debug.stats(); },
  stats: () => debug.stats(),
  ready: true,
};
