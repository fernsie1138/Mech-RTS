// Game bootstrap and main loop.
// Milestone 1: renderer, lighting, a placeholder ground, RTS camera, debug overlay, version label, test hook.
import * as THREE from 'three';
import { VERSION } from './version.js';
import { MAP_SIZE, RENDER, CAMERA, SIM } from './config.js';
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
renderer.info.autoReset = true;

const scene = new THREE.Scene();
scene.background = new THREE.Color(0x9fb8c8);
scene.fog = new THREE.Fog(0x9fb8c8, 180, 420);

const camera = new THREE.PerspectiveCamera(CAMERA.fov, 1, 1, 1000);
const rts = new RTSCamera(camera, canvas);

// ---------- lights: one directional light whose shadow box follows the camera target ----------
scene.add(new THREE.HemisphereLight(0xdfeeff, 0x4a4030, 1.1));
const sun = new THREE.DirectionalLight(0xfff2dd, 2.2);
const sunOffset = new THREE.Vector3(60, 100, 40);
sun.castShadow = true;
sun.shadow.mapSize.set(RENDER.shadowMapSize, RENDER.shadowMapSize);
const sc = sun.shadow.camera;
sc.left = -RENDER.shadowArea; sc.right = RENDER.shadowArea;
sc.top = RENDER.shadowArea; sc.bottom = -RENDER.shadowArea;
sc.near = 10; sc.far = 300;
sun.shadow.bias = -0.0005;
scene.add(sun, sun.target);

function updateSun() {
  // Snap to shadow texels so shadows don't shimmer while panning.
  const texel = (RENDER.shadowArea * 2) / RENDER.shadowMapSize;
  const tx = Math.round(rts.target.x / texel) * texel;
  const tz = Math.round(rts.target.z / texel) * texel;
  sun.target.position.set(tx, 0, tz);
  sun.position.set(tx + sunOffset.x, sunOffset.y, tz + sunOffset.z);
}

// ---------- placeholder world (replaced by the terrain system in milestone 2) ----------
const ground = new THREE.Mesh(
  new THREE.PlaneGeometry(MAP_SIZE, MAP_SIZE),
  new THREE.MeshLambertMaterial({ color: 0x6f8f4e }),
);
ground.rotation.x = -Math.PI / 2;
ground.receiveShadow = true;
scene.add(ground);

const grid = new THREE.GridHelper(MAP_SIZE, 20, 0x3f5a2c, 0x56733d);
grid.position.y = 0.02;
scene.add(grid);

// A few scale markers so panning and shadows are visible.
const markerMat = new THREE.MeshLambertMaterial({ color: 0x8a8f96 });
const markerGeo = new THREE.BoxGeometry(4, 8, 4);
for (let i = 0; i < 9; i++) {
  const m = new THREE.Mesh(markerGeo, markerMat);
  m.position.set(((i % 3) - 1) * 50, 4, (Math.floor(i / 3) - 1) * 50);
  m.castShadow = m.receiveShadow = true;
  scene.add(m);
}
const spinner = new THREE.Mesh(
  new THREE.TorusKnotGeometry(4, 1.2, 96, 12),
  new THREE.MeshLambertMaterial({ color: 0xd9a441 }),
);
spinner.position.set(0, 9, 0);
spinner.castShadow = true;
scene.add(spinner);

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

// ---------- simulation (fixed step) ----------
const state = { time: 0, steps: 0 };

function simStep(dt) {
  state.time += dt;
  state.steps++;
  spinner.rotation.y = state.time * 0.8;
}

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
  THREE, renderer, scene, camera, rts, state, debug,
  pause(on = true) { paused = on; },
  // Advance the simulation by `seconds` in fixed steps, independent of real time.
  step(seconds) {
    const n = Math.round(seconds / SIM.stepSeconds);
    for (let i = 0; i < n; i++) simStep(SIM.stepSeconds);
    return state.time;
  },
  // Render one frame immediately (useful for screenshots after step()).
  render() { rts.update(0); updateSun(); renderer.render(scene, camera); return debug.stats(); },
  stats: () => debug.stats(),
  ready: true,
};
