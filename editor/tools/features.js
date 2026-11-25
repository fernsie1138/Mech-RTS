// Editor tools for rivers, roads and trees (CLAUDE.md §7.2). Each stamp works at one point of a finger path
// and returns the changed sample rectangle (or null).
//   river: carves a channel (relative to the ground before the stroke, so repeated passes don't dig deeper)
//          and marks it as water.
//   road:  flattens toward the local average height and paints road; clears trees and forest tint.
//   forest: sprays trees (and forest-floor tint); tree: places single trees; erase: removes trees, water,
//          roads and forest tint (heights are left alone).
import { SURFACE, FEATURE } from '../../src/terrain/surface.js';
import { FOREST } from '../../src/world/forest.js';

export const RIVER_DEPTH = 3;
const smooth01 = t => t <= 0 ? 0 : t >= 1 ? 1 : t * t * (3 - 2 * t);

export function riverStamp(hf, surface, x, z, radius, before) {
  const { i0, i1, j0, j1 } = hf.rect(x, z, radius * 1.15);
  for (let j = j0; j <= j1; j++) for (let i = i0; i <= i1; i++) {
    const d = Math.hypot(hf.wx(i) - x, hf.wz(j) - z), k = j * hf.verts + i;
    // Full depth in the middle, steep banks: the water level comes from the bank height, so banks must stay high.
    const p = 1 - smooth01((d - radius * 0.7) / (radius * 0.4));
    if (p <= 0) continue;
    const target = Math.max(hf.bedrock, before[k] - RIVER_DEPTH * p);
    if (hf.h[k] > target) hf.h[k] = target;
    if (d < radius * 0.9) surface.features[k] = (surface.features[k] | FEATURE.WATER) & ~(FEATURE.FOREST | FEATURE.TREES);
  }
  hf.changed(i0, j0, i1, j1); surface.changed(i0, j0, i1, j1);
  return { i0, j0, i1, j1 };
}

export function roadStamp(hf, surface, x, z, radius, before, forest) {
  const R = radius * 1.6;
  const { i0, i1, j0, j1 } = hf.rect(x, z, R);
  // Local average of the ground before the stroke (water samples excluded, so roads don't fill rivers).
  let s = 0, n = 0;
  for (let j = j0; j <= j1; j++) for (let i = i0; i <= i1; i++) {
    const k = j * hf.verts + i;
    if (!(surface.features[k] & FEATURE.WATER)) { s += before[k]; n++; }
  }
  if (!n) return null;
  const avg = s / n;
  for (let j = j0; j <= j1; j++) for (let i = i0; i <= i1; i++) {
    const d = Math.hypot(hf.wx(i) - x, hf.wz(j) - z), k = j * hf.verts + i;
    if (d > R || (surface.features[k] & FEATURE.WATER)) continue;
    const p = 1 - smooth01((d - radius) / (R - radius));
    hf.h[k] += (avg - hf.h[k]) * 0.5 * p;
    if (d < radius) { surface.base[k] = SURFACE.ROAD; surface.features[k] &= ~(FEATURE.FOREST | FEATURE.TREES); }
  }
  forest?.removeNear(x, z, radius + 0.5);
  hf.changed(i0, j0, i1, j1); surface.changed(i0, j0, i1, j1);
  return { i0, j0, i1, j1 };
}

// Ground where a tree may stand.
export function treeOk(hf, surface, x, z) {
  if (!hf.inside(x, z)) return false;
  const k = hf.index(Math.round(hf.gx(x)), Math.round(hf.gz(z)));
  return !(surface.features[k] & FEATURE.WATER) && surface.base[k] !== SURFACE.ROAD && hf.slopeAt(x, z) <= FOREST.maxSlope;
}

export function forestStamp(hf, surface, x, z, radius, forest, attempts) {
  const { i0, i1, j0, j1 } = hf.rect(x, z, radius);
  for (let j = j0; j <= j1; j++) for (let i = i0; i <= i1; i++) {
    const k = j * hf.verts + i;
    if (Math.hypot(hf.wx(i) - x, hf.wz(j) - z) < radius && !(surface.features[k] & FEATURE.WATER) && surface.base[k] !== SURFACE.ROAD) {
      surface.features[k] |= FEATURE.FOREST;
    }
  }
  forest.spray(x, z, radius, attempts, (px, pz) => treeOk(hf, surface, px, pz));
  surface.changed(i0, j0, i1, j1);
  return { i0, j0, i1, j1 };
}

// Single tree (if the spot is free).
export function treeStamp(hf, surface, x, z, forest) {
  if (!treeOk(hf, surface, x, z) || forest.near(x, z, FOREST.denseSpacing * 0.8).length) return null;
  forest.add(x, z, 0.85 + 0.4 * forest.rng(), forest.rng() < 0.6 ? 0 : 1);
  const { i0, i1, j0, j1 } = hf.rect(x, z, 1);
  return { i0, j0, i1, j1 };
}

export function eraseStamp(hf, surface, x, z, radius, forest) {
  const { i0, i1, j0, j1 } = hf.rect(x, z, radius);
  for (let j = j0; j <= j1; j++) for (let i = i0; i <= i1; i++) {
    if (Math.hypot(hf.wx(i) - x, hf.wz(j) - z) >= radius) continue;
    const k = j * hf.verts + i;
    surface.features[k] &= ~(FEATURE.WATER | FEATURE.FOREST | FEATURE.TREES);
    if (surface.base[k] === SURFACE.ROAD) surface.base[k] = SURFACE.GRASS;
  }
  forest.removeNear(x, z, radius);
  surface.changed(i0, j0, i1, j1);
  return { i0, j0, i1, j1 };
}
