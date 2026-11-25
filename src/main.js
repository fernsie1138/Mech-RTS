// Game bootstrap and main loop.
// Loads a map (?map=<name> from maps/, ?map=@test from the editor, ?map=@procedural), then runs the
// test-fire sandbox from milestone 2 on it.
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
import { MoverView } from './units/moverview.js';

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
const effects = new Effects(scene);
const world = { hf, surface, get water() { return view.water; }, get forest() { return view.forest; }, get buildings() { return view.buildings; } };
const damage = new Damage({ hf, surface, effects,
  get water() { return view.water; }, get forest() { return view.forest; }, get buildings() { return view.buildings; }, get nav() { return nav; } });

// ---------- nav grid and test units (milestone 6) ----------
const nav = new NavGrid(world);
hf.onChange((i0, j0, i1, j1) => nav.markSamples(i0, j0, i1, j1));
let waterHooked = null;
function hookWater() { if (waterHooked !== view.water) { waterHooked = view.water; view.water.onChange((i0, j0, i1, j1) => nav.markSamples(i0, j0, i1, j1)); } }
hookWater();
const movers = new Movers(nav);
const moverView = new MoverView(scene);
const selected = new Set();
function spawnSquad(x, z) {
  const out = [];
  [0, 1, 2].forEach((cls, k) => {
    const p = nav.nearestPassable(cls, x + (k - 1) * 6, z, 30) || { x, z };
    out.push(movers.add(p.x, p.z, cls));
  });
  return out;
}
if (map.markers.playerHQ) spawnSquad(map.markers.playerHQ.x, map.markers.playerHQ.z - 16).forEach(m => selected.add(m));
// Nav overlay: tint ground the selected (or medium) class can't cross red, slow ground yellow.
const navOverlay = { on: false };
function overlayClass() { const s = [...selected][0]; return s ? s.cls : 1; }
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
  return `units      ${movers.list.length} (${movers.list.filter(m => m.state !== 'idle').length} moving) paths ${movers.stats.paths}\n` +
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
  view.terrain.rebuildAll();
  view.rebuildWater();
  view.reloadTrees();
  view.reloadBuildings();
  hookWater();
  nav.queue.length = 0;
  nav.rebuild();
  if (navOverlay.on) view.terrain.rebuildAll();
}

// ---------- HUD: test-fire toolbar ----------
// Move mode: tap a unit to select it, tap the ground to send the selected units (all, if none) there.
// Fire modes: tap fires at the building piece or ground under the finger, whichever is nearer.
function moveTap(cx, cy) {
  const hit = moverView.pick(rts.screenRay(cx, cy), movers);
  if (hit) { selected.clear(); selected.add(hit); if (navOverlay.on) view.terrain.rebuildAll(); return; }
  const g = pickGround(cx, cy);
  if (!g) return;
  const group = selected.size ? [...selected] : movers.list;
  movers.order(group, g.x, g.z);
  effects.dust(g.x, g.y, g.z, 0.6);
}
rts.onTap = (cx, cy) => {
  if (state.weapon === 'move') { moveTap(cx, cy); return; }
  const g = pickGround(cx, cy), b = view.pickBuilding(cx, cy);
  const camPos = camera.position;
  if (b && (!g || b.point.distanceTo(camPos) < Math.hypot(g.x - camPos.x, g.y - camPos.y, g.z - camPos.z))) {
    damage.explode(b.point.x, b.point.z, state.weapon, b.point.y);
  } else if (g) fireAt(g.x, g.z);
};
const weaponBtns = document.querySelectorAll('[data-weapon]');
function selectWeapon(w) {
  state.weapon = w;
  weaponBtns.forEach(b => b.classList.toggle('on', b.dataset.weapon === w));
}
weaponBtns.forEach(b => b.addEventListener('pointerup', () => selectWeapon(b.dataset.weapon)));
selectWeapon(state.weapon);
document.getElementById('btnAll').addEventListener('pointerup', () => { movers.list.forEach(m => selected.add(m)); if (navOverlay.on) view.terrain.rebuildAll(); });
document.getElementById('btnSpawn').addEventListener('pointerup', () => {
  const sq = spawnSquad(rts.target.x, rts.target.z);
  selected.clear(); sq.forEach(m => selected.add(m));
});
document.getElementById('btnBarrage').addEventListener('pointerup', () => barrage(rts.target.x, rts.target.z, { seed: (state.steps % 9973) + 1 }));
document.getElementById('btnReset').addEventListener('pointerup', resetTerrain);
window.addEventListener('keydown', e => {
  if (e.key === '0') selectWeapon('move');
  if (e.key === '1') selectWeapon('mg');
  if (e.key === '2') selectWeapon('cannon');
  if (e.key === '3') selectWeapon('shell');
  if (e.key === 'b') barrage(rts.target.x, rts.target.z, { seed: (state.steps % 9973) + 1 });
});

// ---------- main loop ----------
let paused = false;          // tests can pause the real-time loop and drive simStep() via __game.step()
let accum = 0;
let lastT = performance.now();

function frame(now) {
  const dt = Math.min((now - lastT) / 1000, 0.25);
  lastT = now;
  if (!paused) {
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
  moverView.update(movers, selected, (x, z) => nav.standHeight(x, z));
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
  nav, movers, moverView, selected, spawnSquad, setNavOverlay, moveTap, NAV_CLASSES,
  pause(on = true) { paused = on; },
  // Advance the simulation by `seconds` in fixed steps, independent of real time.
  step(seconds) {
    const n = Math.round(seconds / SIM.stepSeconds);
    for (let i = 0; i < n; i++) simStep(SIM.stepSeconds);
    return state.time;
  },
  // Rebuild dirty chunks (all, or up to `limit`) and render one frame immediately.
  render(limit = Infinity) { view.update(0, limit); moverView.update(movers, selected, (x, z) => nav.standHeight(x, z)); view.render(); return debug.stats(); },
  stats: () => debug.stats(),
  ready: true,
};
