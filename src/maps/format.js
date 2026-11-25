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
//   "meta":     { ... free-form: import settings, editor info }
// }
// Heights are stored as 16-bit integers (step `scale` = 0.005 units, range about +/-163), each row
// delta-encoded and gzipped, so a 513 x 513 map is a few hundred KB.
//
// A match never modifies the map file: the game decodes it into fresh in-memory arrays.
import { Heightfield } from '../terrain/heightfield.js';
import { Surface } from '../terrain/surface.js';
import { TERRAIN } from '../config.js';

export const FORMAT_VERSION = 1;
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
  // 1: json => { ...; json.formatVersion = 2; return json; },
};
export function upgrade(json) {
  if (!json || typeof json !== 'object') throw new Error('not a map file (expected a JSON object)');
  let v = json.formatVersion;
  if (!Number.isInteger(v)) throw new Error('not a map file (no formatVersion)');
  if (v > FORMAT_VERSION) throw new Error(`map formatVersion ${v} is newer than this game supports (${FORMAT_VERSION}). Reload to get the latest version.`);
  while (v < FORMAT_VERSION) {
    if (!UPGRADES[v]) throw new Error(`cannot upgrade map from formatVersion ${v}`);
    json = UPGRADES[v](json);
    v = json.formatVersion;
  }
  return json;
}

// ---------- public API ----------
// map = { name, hf, surface, markers, meta } -> JSON-able object
export async function serializeMap({ name, hf, surface, markers, meta }) {
  return {
    formatVersion: FORMAT_VERSION,
    name: name || 'Untitled',
    size: hf.size,
    cells: hf.cells,
    bedrock: hf.bedrock,
    height: await encodeHeights(hf.h, hf.verts),
    surface: await encodeBytes(surface.base),
    features: await encodeBytes(surface.features),
    markers: cleanMarkers(markers),
    meta: meta || {},
  };
}

// JSON object -> { name, hf, surface, markers, meta }. Throws an Error with a readable message if invalid.
export async function deserializeMap(json) {
  json = upgrade(json);
  const { size, cells } = json;
  if (!(size > 0) || !Number.isInteger(cells) || cells < 8 || cells > 2048) throw new Error(`bad map size ${size} / cells ${cells}`);
  const hf = new Heightfield({ size, cells, bedrock: json.bedrock ?? TERRAIN.bedrock, maxSlope: TERRAIN.maxSlope });
  hf.h.set(await decodeHeights(json.height, hf.verts));
  const surface = new Surface(hf);
  const n = hf.verts * hf.verts;
  if (json.surface) surface.base.set(await decodeBytes(json.surface, n, 'surface'));
  if (json.features) surface.features.set(await decodeBytes(json.features, n, 'features'));
  return { name: json.name || 'Untitled', hf, surface, markers: cleanMarkers(json.markers), meta: json.meta || {} };
}

// Copy map content (heights, ground types, features) from one map into another of the same size, in place.
export function copyMapInto(src, dst) {
  if (src.hf.verts !== dst.hf.verts) throw new Error('map sizes differ');
  dst.hf.h.set(src.hf.h);
  dst.surface.clear();
  dst.surface.base.set(src.surface.base);
  dst.surface.features.set(src.surface.features);
  dst.markers = cleanMarkers(src.markers);
  dst.name = src.name;
  dst.meta = { ...src.meta };
}
