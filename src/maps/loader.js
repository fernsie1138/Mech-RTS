// Loads map files (from maps/, an uploaded file, or the editor's test hand-off) and decodes import images.
import { deserializeMap, serializeMap } from './format.js';
import { Heightfield } from '../terrain/heightfield.js';
import { Surface } from '../terrain/surface.js';
import { buildTestMap } from '../terrain/testmap.js';
import { TERRAIN, MAP_SIZE } from '../config.js';
import { emptyMarkers } from './format.js';

// localStorage keys. The editor hands the current map to the game through TEST_KEY, and autosaves to AUTOSAVE_KEY.
export const TEST_KEY = 'mechrts.testmap';
export const AUTOSAVE_KEY = 'mechrts.editor.autosave';

// The browser served old cached code (it met a map from a newer version). Reload once with a fresh URL, which
// makes Safari fetch the page, and through its import map every module, again. Returns true if reloading.
export function reloadFresh(err) {
  if (!err || !err.newerFormat) return false;
  let tried = false;
  try { tried = sessionStorage.getItem('mechrts.freshReload') === '1'; sessionStorage.setItem('mechrts.freshReload', '1'); } catch { /* storage blocked */ }
  if (tried) return false;                       // already tried once: show the error instead of looping
  const u = new URL(location.href);
  u.searchParams.set('fresh', Date.now().toString(36));
  location.replace(u.toString());
  return true;
}
export function clearFreshReload() { try { sessionStorage.removeItem('mechrts.freshReload'); } catch { /* ignore */ } }

// Built-in maps listed in maps/index.json.
export async function listMaps() {
  const res = await fetch('maps/index.json', { cache: 'no-cache' });
  if (!res.ok) throw new Error(`maps/index.json: HTTP ${res.status}`);
  return (await res.json()).maps;
}

export async function loadMapUrl(url) {
  const res = await fetch(url, { cache: 'no-cache' });
  if (!res.ok) throw new Error(`could not load ${url} (HTTP ${res.status})`);
  let json;
  try { json = await res.json(); } catch { throw new Error(`${url} is not valid JSON`); }
  return deserializeMap(json);
}

export async function loadMapFile(file) {
  let json;
  try { json = JSON.parse(await file.text()); } catch { throw new Error(`${file.name} is not a map file (not valid JSON)`); }
  return deserializeMap(json);
}

export function loadMapStorage(key) {
  let text = null;
  try { text = localStorage.getItem(key); } catch { /* storage blocked */ }
  if (!text) return null;
  return deserializeMap(JSON.parse(text));
}

// Save to localStorage under one or more keys (serialised once). Returns true if it fit.
export async function saveMapStorage(keys, map) {
  const text = JSON.stringify(await serializeMap(map));
  try { for (const k of [].concat(keys)) localStorage.setItem(k, text); return true; } catch { return false; }
}

// The procedural test landscape from milestone 2 (?map=@procedural).
export function proceduralMap() {
  const hf = new Heightfield({ size: MAP_SIZE, cells: TERRAIN.cells, bedrock: TERRAIN.bedrock, maxSlope: TERRAIN.maxSlope });
  const surface = new Surface(hf);
  buildTestMap(hf, surface);
  return { name: 'Procedural test', hf, surface, markers: emptyMarkers(), trees: [], meta: {} };
}

// A flat empty map (new map in the editor).
export function blankMap(name = 'New map') {
  const hf = new Heightfield({ size: MAP_SIZE, cells: TERRAIN.cells, bedrock: TERRAIN.bedrock, maxSlope: TERRAIN.maxSlope });
  return { name, hf, surface: new Surface(hf), markers: emptyMarkers(), trees: [], meta: {} };
}

// Decode an image File/Blob to { width, height, data } RGBA (for the importer).
export async function decodeImage(blob) {
  let bmp;
  try { bmp = await createImageBitmap(blob); } catch { throw new Error(`${blob.name || 'image'} could not be read as an image`); }
  const c = document.createElement('canvas');
  c.width = bmp.width; c.height = bmp.height;
  const g = c.getContext('2d', { willReadFrequently: true });
  g.drawImage(bmp, 0, 0);
  const img = g.getImageData(0, 0, c.width, c.height);
  bmp.close?.();
  return img;
}

// Trigger a download of a JSON object (on iPad Safari this offers to save to Files).
export function downloadJSON(obj, filename) {
  const blob = new Blob([JSON.stringify(obj)], { type: 'application/json' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 10000);
}

// Snapshot of the editable content of a map (for reset in the game).
export function snapshot(map) {
  return { h: Float32Array.from(map.hf.h), base: Uint8Array.from(map.surface.base), features: Uint8Array.from(map.surface.features),
           trees: (map.trees || []).map(t => ({ x: t.x, z: t.z, s: t.s, t: t.t })) };
}
export function restore(map, snap) {
  map.hf.h.set(snap.h);
  map.surface.clear();
  map.surface.base.set(snap.base);
  map.surface.features.set(snap.features);
  map.trees = snap.trees.map(t => ({ ...t }));
}
