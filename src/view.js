// Shared 3D view used by the game and the editor: renderer, scene, lights, camera, terrain and markers.
import * as THREE from 'three';
import { TERRAIN, RENDER, CAMERA } from './config.js';
import { TerrainMesh } from './terrain/chunks.js';
import { RTSCamera } from './ui/camera.js';
import { MarkerView } from './world/markers.js';

export function createView(canvas, map, { maxRebuildsPerFrame = TERRAIN.maxRebuildsPerFrame } = {}) {
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance' });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, RENDER.maxPixelRatio));
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;

  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0x9fb8c8);
  scene.fog = new THREE.Fog(0x9fb8c8, 220, 520);

  const view = { renderer, scene, map, terrain: null, outside: null };   // map set early: the camera samples heights
  const heightAt = (x, z) => view.map.hf.heightAt(x, z);

  const camera = new THREE.PerspectiveCamera(CAMERA.fov, 1, 1, 1200);
  const rts = new RTSCamera(camera, canvas, heightAt);

  // Lights: one directional light whose shadow box follows the camera target.
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
    const texel = (RENDER.shadowArea * 2) / RENDER.shadowMapSize;      // snap to texels: no shimmer while panning
    const tx = Math.round(rts.target.x / texel) * texel;
    const tz = Math.round(rts.target.z / texel) * texel;
    sun.target.position.set(tx, 0, tz);
    sun.position.set(tx + sunOffset.x, sunOffset.y, tz + sunOffset.z);
  }

  const markers = new MarkerView(scene);

  // Ground beyond the map edge: a frame around the map, so it never shows through the terrain.
  function makeOutside(size) {
    const g = new THREE.Group(), mat = new THREE.MeshLambertMaterial({ color: 0x5f7f38 });
    const far = 1500, half = size / 2;
    for (const [x, z, w, d] of [[0, -(half + far) / 2, 2 * far, far - half], [0, (half + far) / 2, 2 * far, far - half],
                                [-(half + far) / 2, 0, far - half, 2 * half], [(half + far) / 2, 0, far - half, 2 * half]]) {
      const m = new THREE.Mesh(new THREE.PlaneGeometry(w, d).rotateX(-Math.PI / 2), mat);
      m.position.set(x, -0.02, z);
      m.receiveShadow = true;
      g.add(m);
    }
    return g;
  }

  // Show a map (replaces the previous one).
  function setMap(m) {
    if (view.terrain) { scene.remove(view.terrain.group); view.terrain.dispose(); }
    if (view.outside) scene.remove(view.outside);
    view.map = m;
    view.terrain = new TerrainMesh(m.hf, m.surface, { ...TERRAIN, maxRebuildsPerFrame });
    scene.add(view.terrain.group);
    view.outside = makeOutside(m.hf.size);
    scene.add(view.outside);
    rts.mapSize = m.hf.size;
    markers.set(m.markers);
  }

  function resize() {
    const w = window.innerWidth, h = window.innerHeight;
    renderer.setSize(w, h, false);
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
  }
  window.addEventListener('resize', resize);
  window.addEventListener('orientationchange', () => setTimeout(resize, 200));
  resize();

  // Terrain point under a screen position (ray against the heightfield), or null.
  function pickGround(clientX, clientY) {
    const ray = rts.screenRay(clientX, clientY);
    return view.map.hf.raycast(ray.origin.x, ray.origin.y, ray.origin.z, ray.direction.x, ray.direction.y, ray.direction.z);
  }

  // Per-frame: rebuild a few dirty chunks, move camera and sun, update markers. limit = chunk rebuild budget.
  function update(dt, limit) {
    view.terrain.update(limit);
    rts.update(dt);
    updateSun();
    markers.update(heightAt, dt);
  }
  function render() { renderer.render(scene, camera); }

  setMap(map);
  Object.assign(view, { camera, rts, sun, markers, setMap, update, render, resize, pickGround, heightAt });
  return view;
}
