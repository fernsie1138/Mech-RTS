// Game bootstrap and main loop.
// Milestone 2: deformable chunked terrain with a test "fire" tap, surface wear and a damage map.
import * as THREE from 'three';
import { VERSION } from './version.js';
import * as config from './config.js';
import { MAP_SIZE, TERRAIN, RENDER, CAMERA, SIM } from './config.js';
import { Heightfield } from './terrain/heightfield.js';
import { Surface } from './terrain/surface.js';
import { TerrainMesh } from './terrain/chunks.js';
import { buildTestMap } from './terrain/testmap.js';
import { Effects } from './combat/effects.js';
import { Damage } from './combat/damage.js';
import { RTSCamera } from './ui/camera.js';
import { DebugOverlay } from './ui/debug.js';

// ---------- version label (warns if index.html and the JS are from different builds) ----------
const htmlBuild = document.querySelector('meta[name="build"]')?.content;
const verEl = document.getElementById('ver');
verEl.textContent = VERSION;
if (htmlBuild && htmlBuild !== VERSION) {
  verEl.textContent = `${VERSION} (page ${htmlBuild}: stale cache, reload)`;
  verEl.classList.add('stale');
}

// ---------- renderer ----------
const canvas = document.getElementById('view');
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance' });
renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, RENDER.maxPixelRatio));
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;

const scene = new THREE.Scene();
scene.background = new THREE.Color(0x9fb8c8);
scene.fog = new THREE.Fog(0x9fb8c8, 220, 520);

// ---------- terrain ----------
const hf = new Heightfield({ size: MAP_SIZE, cells: TERRAIN.cells, bedrock: TERRAIN.bedrock, maxSlope: TERRAIN.maxSlope });
const surface = new Surface(hf);
buildTestMap(hf, surface);
const terrain = new TerrainMesh(hf, surface, TERRAIN);
scene.add(terrain.group);
const heightAt = (x, z) => hf.heightAt(x, z);

// Ground beyond the map edge (a frame around the map, so it never shows through the terrain).
const outside = new THREE.Group();
{
  const mat = new THREE.MeshLambertMaterial({ color: 0x5f7f38 });
  const far = 1500, half = MAP_SIZE / 2;
  for (const [x, z, w, d] of [[0, -(half + far) / 2, 2 * far, far - half], [0, (half + far) / 2, 2 * far, far - half],
                              [-(half + far) / 2, 0, far - half, 2 * half], [(half + far) / 2, 0, far - half, 2 * half]]) {
    const m = new THREE.Mesh(new THREE.PlaneGeometry(w, d).rotateX(-Math.PI / 2), mat);
    m.position.set(x, -0.02, z);
    m.receiveShadow = true;
    outside.add(m);
  }
}
scene.add(outside);

const camera = new THREE.PerspectiveCamera(CAMERA.fov, 1, 1, 1200);
const rts = new RTSCamera(camera, canvas, heightAt);

// ---------- lights: one directional light whose shadow box follows the camera target ----------
scene.add(new THREE.HemisphereLight(0xdfeeff, 0x4a4030, 1.0));
const sun = new THREE.DirectionalLight(0xfff2dd, 2.3);
const sunOffset = new THREE.Vector3(70, 110, 45);
sun.castShadow = true;
sun.shadow.mapSize.set(RENDER.shadowMapSize, RENDER.shadowMapSize);
const sc = sun.shadow.camera;
sc.left = -RENDER.shadowArea; sc.right = RENDER.shadowArea;
sc.top = RENDER.shadowArea; sc.bottom = -RENDER.shadowArea;
sc.near = 10; sc.far = 400;
sun.shadow.bias = -0.0006;
sun.shadow.normalBias = 0.4;
scene.add(sun, sun.target);

function updateSun() {
  // Snap to shadow texels so shadows don't shimmer while panning.
  const texel = (RENDER.shadowArea * 2) / RENDER.shadowMapSize;
  const tx = Math.round(rts.target.x / texel) * texel;
  const tz = Math.round(rts.target.z / texel) * texel;
  sun.target.position.set(tx, 0, tz);
  sun.position.set(tx + sunOffset.x, sunOffset.y, tz + sunOffset.z);
}

// ---------- effects and damage ----------
const effects = new Effects(scene);
const damage = new Damage({ hf, surface, effects });

// ---------- resize ----------
function resize() {
  const w = window.innerWidth, h = window.innerHeight;
  renderer.setSize(w, h, false);
  camera.aspect = w / h;
  camera.updateProjectionMatrix();
}
window.addEventListener('resize', resize);
window.addEventListener('orientationchange', () => setTimeout(resize, 200));
resize();

// ---------- debug overlay ----------
const debug = new DebugOverlay(document.getElementById('debug'), document.getElementById('btnDebug'), renderer);
debug.extra = () => `chunks     ${terrain.chunks.length} (dirty ${terrain.dirty.size})\n` +
                    `rebuilds   ${terrain.rebuildCount}`;

// ---------- simulation (fixed step) ----------
const state = { time: 0, steps: 0, weapon: 'cannon', pending: [] };   // pending: scheduled impacts {at, x, z, weapon}

function simStep(dt) {
  state.time += dt;
  state.steps++;
  while (state.pending.length && state.pending[0].at <= state.time) {
    const s = state.pending.shift();
    damage.explode(s.x, s.z, s.weapon);
  }
  effects.update(dt);
}

// Terrain point under a screen position (ray against the heightfield).
function pickGround(clientX, clientY) {
  const ray = rts.screenRay(clientX, clientY);
  return hf.raycast(ray.origin.x, ray.origin.y, ray.origin.z, ray.direction.x, ray.direction.y, ray.direction.z);
}

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
  surface.base.fill(0); surface.damage.fill(0); surface.scorch.fill(0);
  buildTestMap(hf, surface);
  terrain.rebuildAll();
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
  terrain.update();
  rts.update(dt);
  updateSun();
  renderer.render(scene, camera);
  debug.frame(dt);
  requestAnimationFrame(frame);
}
requestAnimationFrame(frame);

// ---------- test hook (see CLAUDE.md §11) ----------
window.__game = {
  version: VERSION,
  config,               // live tunables (tests may adjust, e.g. tap timing under slow software rendering)
  THREE, renderer, scene, camera, rts, state, debug,
  hf, surface, terrain, effects, damage,
  heightAt, pickGround, fireAt, barrage, resetTerrain, selectWeapon,
  pause(on = true) { paused = on; },
  // Advance the simulation by `seconds` in fixed steps, independent of real time.
  step(seconds) {
    const n = Math.round(seconds / SIM.stepSeconds);
    for (let i = 0; i < n; i++) simStep(SIM.stepSeconds);
    return state.time;
  },
  // Rebuild dirty chunks (all, or up to `limit`) and render one frame immediately.
  render(limit = Infinity) { terrain.update(limit); rts.update(0); updateSun(); renderer.render(scene, camera); return debug.stats(); },
  stats: () => debug.stats(),
  ready: true,
};
