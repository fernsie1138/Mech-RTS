// Map file schema and versioning (CLAUDE.md §7.3). Pure: no three.js or DOM, runs in Node tests too.
//
// A map is one JSON file:
// {
//   "formatVersion": 1,
//   "name": "Sample",
//   "size": 256,                 world units across
//   "cells": 512,                height grid cells per side (cells+1 samples)
//   "bedrock": -8,
//   "height":   { "encoding": "i16-delta-gzip-b64", "scale": 0.005, "data": "..." },
//   "surface":  { "encoding": "u8-gzip-b64", "data": "..." },     ground type per sample (SURFACE)
//   "features": { "encoding": "u8-gzip-b64", "data": "..." },     feature bits per sample (FEATURE)
//   "markers":  { "playerHQ": {x,z} | null, "enemyHQ": {x,z} | null, "capturePoints": [{x,z}, ...] },
//   "trees":    { "encoding": "trees6-gzip-b64", "count": n, "data": "..." }   (v2+) x, z (int16, 1/100 unit),
//                                                                             scale (uint8, 1/100), type (uint8)
//   "buildings": [{ "type": "house" | "factory" | "bunker" | "wall" | "bridge", "x", "z", "rot",
//                   bridges also "len", "drop", "y" (deck height) }]          (v3+)
//   "meta":     { ... free-form: import settings, editor info }
// }
// Heights are stored as 16-bit integers (step `scale` = 0.005 units, range about +/-163), each row
// delta-encoded and gzipped, so a 513 x 513 map is a few hundred KB.
//
// A match never modifies the map file: the game decodes it into fresh in-memory arrays.
import { Heightfield } from '../terrain/heightfield.js';
import { Surface } from '../terrain/surface.js';
import { TERRAIN } from '../config.js';
import { generateTrees } from '../world/forest.js';
import { autoBridges, BUILDING_TYPES } from '../world/buildings.js';
import { Water } from '../terrain/water.js';

export const FORMAT_VERSION = 3;
const HEIGHT_SCALE = 0.005;

// ---------- bytes <-> base64, gzip ----------
export function bytesToBase64(bytes) {
  let s = '';
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
  return btoa(s);
}
export function base64ToBytes(b64) {
  const s = atob(b64), out = new Uint8Array(s.length);
  for (let i = 0; i < s.length; i++) out[i] = s.charCodeAt(i);
  return out;
}
function b64(data, what) {
  if (typeof data !== 'string') throw new Error(`${what} data is missing`);
  try { return base64ToBytes(data); } catch { throw new Error(`${what} data is corrupt (bad base64)`); }
}
async function pipe(bytes, stream) {
  const buf = await new Response(new Blob([bytes]).stream().pipeThrough(stream)).arrayBuffer();
  return new Uint8Array(buf);
}
export const gzip = bytes => pipe(bytes, new CompressionStream('gzip'));
export async function gunzip(bytes, what = 'map') {
  try { return await pipe(bytes, new DecompressionStream('gzip')); }
  catch (e) { throw new Error(`${what} data is corrupt (${e.message || e.name || 'cannot decompress'})`); }
}

// ---------- layers ----------
async function encodeHeights(h, verts) {
  const q = new Int16Array(h.length);
  for (let j = 0; j < verts; j++) {
    let prev = 0;
    for (let i = 0; i < verts; i++) {
      const k = j * verts + i;
      const v = Math.max(-32767, Math.min(32767, Math.round(h[k] / HEIGHT_SCALE)));
      q[k] = v - prev;            // wraps in 16 bits; decoding wraps back
      prev = v;
    }
  }
  return { encoding: 'i16-delta-gzip-b64', scale: HEIGHT_SCALE, data: bytesToBase64(await gzip(new Uint8Array(q.buffer))) };
}

async function decodeHeights(layer, verts) {
  if (layer.encoding !== 'i16-delta-gzip-b64') throw new Error(`unknown height encoding "${layer.encoding}"`);
  const bytes = await gunzip(b64(layer.data, 'height'), 'height');
  if (bytes.length !== verts * verts * 2) throw new Error(`height data has ${bytes.length / 2} samples, expected ${verts * verts}`);
  const q = new Int16Array(bytes.buffer, bytes.byteOffset, verts * verts);
  const out = new Float32Array(verts * verts);
  const acc = new Int16Array(1);
  for (let j = 0; j < verts; j++) {
    acc[0] = 0;
    for (let i = 0; i < verts; i++) {
      const k = j * verts + i;
      acc[0] += q[k];
      out[k] = acc[0] * layer.scale;
    }
  }
  return out;
}

async function encodeBytes(arr) { return { encoding: 'u8-gzip-b64', data: bytesToBase64(await gzip(arr)) }; }
async function decodeBytes(layer, n, what) {
  if (layer.encoding !== 'u8-gzip-b64') throw new Error(`unknown ${what} encoding "${layer.encoding}"`);
  const bytes = await gunzip(b64(layer.data, what), what);
  if (bytes.length !== n) throw new Error(`${what} data has ${bytes.length} samples, expected ${n}`);
  return bytes;
}

// ---------- trees ----------
async function encodeTrees(trees) {
  const buf = new Uint8Array(trees.length * 6), dv = new DataView(buf.buffer);
  trees.forEach((t, n) => {
    dv.setInt16(n * 6, Math.round(t.x * 100), true);
    dv.setInt16(n * 6 + 2, Math.round(t.z * 100), true);
    dv.setUint8(n * 6 + 4, Math.max(1, Math.min(255, Math.round(t.s * 100))));
    dv.setUint8(n * 6 + 5, t.t | 0);
  });
  return { encoding: 'trees6-gzip-b64', count: trees.length, data: bytesToBase64(await gzip(buf)) };
}
async function decodeTrees(layer) {
  if (layer.encoding !== 'trees6-gzip-b64') throw new Error(`unknown trees encoding "${layer.encoding}"`);
  const bytes = await gunzip(b64(layer.data, 'trees'), 'trees');
  if (bytes.length !== layer.count * 6) throw new Error(`trees data has ${bytes.length / 6} trees, expected ${layer.count}`);
  const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.length), out = [];
  for (let n = 0; n < layer.count; n++) {
    out.push({ x: dv.getInt16(n * 6, true) / 100, z: dv.getInt16(n * 6 + 2, true) / 100, s: dv.getUint8(n * 6 + 4) / 100, t: dv.getUint8(n * 6 + 5) });
  }
  return out;
}

// ---------- markers ----------
export function emptyMarkers() { return { playerHQ: null, enemyHQ: null, capturePoints: [] }; }
function cleanMarkers(m = {}) {
  const pt = p => (p && Number.isFinite(p.x) && Number.isFinite(p.z)) ? { x: +p.x, z: +p.z } : null;
  return {
    playerHQ: pt(m.playerHQ),
    enemyHQ: pt(m.enemyHQ),
    capturePoints: Array.isArray(m.capturePoints) ? m.capturePoints.map(pt).filter(Boolean) : [],
  };
}

// ---------- versioning ----------
// Upgrade older map JSON to the current version. Each step converts version n to n+1.
const UPGRADES = {
  // v1 had no tree list: trees are generated from the forest areas when the map is decoded.
  1: json => ({ ...json, formatVersion: 2, trees: null }),
  // v2 had no buildings: bridges are placed where roads cross rivers when the map is decoded.
  2: json => ({ ...json, formatVersion: 3, buildings: null }),
};

function cleanBuildings(list) {
  if (!Array.isArray(list)) return [];
  return list.filter(b => b && BUILDING_TYPES.includes(b.type) && Number.isFinite(b.x) && Number.isFinite(b.z)).map(b => {
    const o = { type: b.type, x: +b.x, z: +b.z, rot: +b.rot || 0 };
    for (const k of ['len', 'drop', 'y']) if (Number.isFinite(b[k])) o[k] = +b[k];
    return o;
  });
}
export function upgrade(json) {
  if (!json || typeof json !== 'object') throw new Error('not a map file (expected a JSON object)');
  let v = json.formatVersion;
  if (!Number.isInteger(v)) throw new Error('not a map file (no formatVersion)');
  if (v > FORMAT_VERSION) {
    const e = new Error(`map formatVersion ${v} is newer than this game supports (${FORMAT_VERSION}). Reload to get the latest version.`);
    e.newerFormat = true;     // the page is running old (cached) code: loader.reloadFresh() recovers
    throw e;
  }
  while (v < FORMAT_VERSION) {
    if (!UPGRADES[v]) throw new Error(`cannot upgrade map from formatVersion ${v}`);
    json = UPGRADES[v](json);
    v = json.formatVersion;
  }
  return json;
}

// ---------- public API ----------
// map = { name, hf, surface, markers, trees, meta } -> JSON-able object. trees: [{x, z, s, t}]
export async function serializeMap({ name, hf, surface, markers, trees, buildings, meta }) {
  // The layers compress independently, so do them at the same time.
  const [height, surfaceLayer, features, treeLayer] = await Promise.all([
    encodeHeights(hf.h, hf.verts), encodeBytes(surface.base), encodeBytes(surface.features), encodeTrees(trees || []),
  ]);
  return {
    formatVersion: FORMAT_VERSION,
    name: name || 'Untitled',
    size: hf.size,
    cells: hf.cells,
    bedrock: hf.bedrock,
    height,
    surface: surfaceLayer,
    features,
    markers: cleanMarkers(markers),
    trees: treeLayer,
    buildings: cleanBuildings(buildings).map(b => Object.fromEntries(Object.entries(b).map(([k, v]) => [k, typeof v === 'number' && k !== 'type' ? Math.round(v * 1000) / 1000 : v]))),
    meta: meta || {},
  };
}

// JSON object -> { name, hf, surface, markers, trees, buildings, meta }. Throws an Error with a readable message if invalid.
export async function deserializeMap(json) {
  json = upgrade(json);
  const { size, cells } = json;
  if (!(size > 0) || !Number.isInteger(cells) || cells < 8 || cells > 2048) throw new Error(`bad map size ${size} / cells ${cells}`);
  const hf = new Heightfield({ size, cells, bedrock: json.bedrock ?? TERRAIN.bedrock, maxSlope: TERRAIN.maxSlope });
  const surface = new Surface(hf);
  const n = hf.verts * hf.verts;
  const [h, base, feats, treeList] = await Promise.all([
    decodeHeights(json.height, hf.verts),
    json.surface ? decodeBytes(json.surface, n, 'surface') : null,
    json.features ? decodeBytes(json.features, n, 'features') : null,
    json.trees ? decodeTrees(json.trees) : null,
  ]);
  hf.h.set(h);
  if (base) surface.base.set(base);
  if (feats) surface.features.set(feats);
  const trees = treeList || generateTrees(hf, surface).map(t => ({ x: t.x, z: t.z, s: t.s, t: t.t }));
  const buildings = json.buildings ? cleanBuildings(json.buildings) : autoBridges(hf, surface, new Water(hf, surface));
  return { name: json.name || 'Untitled', hf, surface, markers: cleanMarkers(json.markers), trees, buildings, meta: json.meta || {} };
}

// Copy map content (heights, ground types, features) from one map into another of the same size, in place.
export function copyMapInto(src, dst) {
  if (src.hf.verts !== dst.hf.verts) throw new Error('map sizes differ');
  dst.hf.h.set(src.hf.h);
  dst.surface.clear();
  dst.surface.base.set(src.surface.base);
  dst.surface.features.set(src.surface.features);
  dst.markers = cleanMarkers(src.markers);
  dst.trees = (src.trees || []).map(t => ({ ...t }));
  dst.buildings = (src.buildings || []).map(b => ({ ...b }));
  dst.name = src.name;
  dst.meta = { ...src.meta };
}
