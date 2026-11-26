// Line of sight and cover (CLAUDE.md §9). Pure: no three.js.
// A sight line from a to b is blocked by the terrain and by standing building pieces; trees don't block it,
// but units in forest, on rubble or behind ruined walls are harder to hit (cover).
import { SURFACE } from '../terrain/surface.js';
import { COMBAT } from '../config.js';

// Is the straight line from (ax, ay, az) to (bx, by, bz) clear? Returns { clear, x, y, z } where (x, y, z) is
// the first blocked point if not clear. The ends (within `skip` of either point) aren't tested, so a unit
// standing next to a wall can still shoot past it.
export function lineOfSight(world, ax, ay, az, bx, by, bz, skip = 1.5) {
  const { hf, buildings } = world;
  const d = Math.hypot(bx - ax, by - ay, bz - az);
  if (d < 1e-6) return { clear: true };
  const step = 0.5, n = Math.ceil(d / step);
  for (let k = 1; k < n; k++) {
    const t = k / n, along = t * d;
    if (along < skip || d - along < skip) continue;
    const x = ax + (bx - ax) * t, y = ay + (by - ay) * t, z = az + (bz - az) * t;
    let top = hf.heightAt(x, z);
    if (buildings) top = Math.max(top, buildings.topAt(x, z));
    if (y <= top) return { clear: false, x, y: top, z, t };
  }
  return { clear: true };
}

// How well covered is a unit at (x, z)? 0 = in the open, up to ~0.6 = deep in forest or among ruins.
// Hit chance against it is multiplied by (1 - cover).
export function coverAt(world, x, z) {
  const { hf, surface, forest, buildings } = world;
  let cover = 0;
  if (forest) cover = Math.max(cover, forest.coverAt(x, z, 4) * COMBAT.forestCover);
  const k = hf.index(Math.round(hf.gx(x)), Math.round(hf.gz(z)));
  if (surface.base[k] === SURFACE.RUBBLE) cover = Math.max(cover, COMBAT.rubbleCover);
  if (buildings) {
    // Hugging a standing wall (within 3 units, but not inside it).
    for (let a = 0; a < 6.28; a += 0.785) {
      if (buildings.topAt(x + Math.cos(a) * 2.5, z + Math.sin(a) * 2.5) > hf.heightAt(x, z) + 1) { cover = Math.max(cover, COMBAT.rubbleCover); break; }
    }
  }
  return cover;
}
