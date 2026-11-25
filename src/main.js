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
const damage = new Damage({ hf, surface, effects, get water() { return view.water; }, get forest() { return view.forest; } });

// ---------- debug overlay ----------
const debug = new DebugOverlay(document.getElementById('debug'), document.getElementById('btnDebug'), renderer);
debug.extra = () => {
  const c = view.forest.counts();
  return `chunks     ${view.terrain.chunks.length} (dirty ${view.terrain.dirty.size})\n` +
         `rebuilds   ${view.terrain.rebuildCount}\n` +
         `water tris ${view.waterMesh.triangleCount()}\n` +
         `trees      ${view.forest.trees.length} (${c.fallen} down, ${c.burning} burning, ${c.stump} gone)`;
};

// ---------- simulation (fixed step) ----------
const state = { time: 0, steps: 0, weapon: 'cannon', pending: [] };   // pending: scheduled impacts {at, x, z, weapon}

function simStep(dt) {
  state.time += dt;
  state.steps++;
  while (state.pending.length && state.pending[0].at <= state.time) {
    const s = state.pending.shift();
    damage.explode(s.x, s.z, s.weapon);
  }
  damage.update(dt);
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
}

// ---------- HUD: test-fire toolbar ----------
rts.onTap = (cx, cy) => {
  const p = pickGround(cx, cy);
  if (p) fireAt(p.x, p.z);
};
const weaponBtns = document.querySelectorAll('[data-weapon]');
function selectWeapon(w) {
  state.weapon = w;
  weaponBtns.forEach(b => b.classList.toggle('on', b.dataset.weapon === w));
}
weaponBtns.forEach(b => b.addEventListener('pointerup', () => selectWeapon(b.dataset.weapon)));
selectWeapon(state.weapon);
document.getElementById('btnBarrage').addEventListener('pointerup', () => barrage(rts.target.x, rts.target.z, { seed: (state.steps % 9973) + 1 }));
document.getElementById('btnReset').addEventListener('pointerup', resetTerrain);
window.addEventListener('keydown', e => {
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
  get water() { return view.water; }, get forest() { return view.forest; },
  heightAt, pickGround, fireAt, barrage, resetTerrain, selectWeapon,
  pause(on = true) { paused = on; },
  // Advance the simulation by `seconds` in fixed steps, independent of real time.
  step(seconds) {
    const n = Math.round(seconds / SIM.stepSeconds);
    for (let i = 0; i < n; i++) simStep(SIM.stepSeconds);
    return state.time;
  },
  // Rebuild dirty chunks (all, or up to `limit`) and render one frame immediately.
  render(limit = Infinity) { view.update(0, limit); view.render(); return debug.stats(); },
  stats: () => debug.stats(),
  ready: true,
};
