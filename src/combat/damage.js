// Single entry point for all damage, to units and to the world (CLAUDE.md §4).
// For now (milestone 2) only the terrain takes damage; units, trees and buildings hook in here later.
import { TERRAIN_DAMAGE } from '../config.js';

export class Damage {
  constructor(world) {
    this.world = world;        // { hf, surface, effects }
    this.log = [];             // recent impacts, for tests/debugging
  }

  // An explosion of weapon type `weapon` (a key of TERRAIN_DAMAGE) at ground position (x, z).
  explode(x, z, weapon) {
    const p = TERRAIN_DAMAGE[weapon];
    if (!p) throw new Error(`unknown weapon terrain profile: ${weapon}`);
    const { hf, surface, effects } = this.world;
    if (!hf.inside(x, z)) return null;
    const y0 = hf.heightAt(x, z);
    let result = { removed: 0, maxDelta: 0 };
    if (p.depth > 0) result = hf.crater(x, z, { radius: p.radius, depth: p.depth, rim: p.rim, erode: p.erode });
    surface.wear(x, z, p.radius * p.wearRadius, p.wear, p.scorch);
    if (effects) effects.explosion(x, hf.heightAt(x, z), z, p.fxSize, (a, b) => hf.heightAt(a, b));
    const hit = { x, z, weapon, y0, y1: hf.heightAt(x, z), ...result };
    this.log.push(hit);
    if (this.log.length > 50) this.log.shift();
    return hit;
  }
}
