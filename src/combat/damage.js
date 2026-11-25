// Single entry point for all damage, to units and to the world (CLAUDE.md §4).
// Terrain (craters, wear, flooding) and trees take damage here; units and buildings hook in later.
import { TERRAIN_DAMAGE } from '../config.js';

export class Damage {
  constructor(world) {
    this.world = world;        // { hf, surface, effects, water?, forest? }
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
    const { water, forest } = this.world;
    let flooded = 0, trees = 0;
    if (water && p.depth > 0) {
      const r = hf.rect(x, z, p.radius * 1.5 + 4 * hf.spacing);
      flooded = water.flood(r.i0, r.j0, r.i1, r.j1);
    }
    if (forest) trees = forest.blast(x, z, { fallR: p.treeFall, ignite: p.ignite });
    if (effects) effects.explosion(x, hf.heightAt(x, z), z, p.fxSize, (a, b) => hf.heightAt(a, b));
    const hit = { x, z, weapon, y0, y1: hf.heightAt(x, z), flooded, trees, ...result };
    this.log.push(hit);
    if (this.log.length > 50) this.log.shift();
    return hit;
  }

  // Per simulation step: fires burn and spread; burnt-out trees scorch the ground under them.
  update(dt) {
    const { forest, surface } = this.world;
    if (!forest) return;
    for (const i of forest.update(dt)) {
      const t = forest.trees[i];
      surface.wear(t.x, t.z, 2.4 * t.s, 0.4, 0.6);
    }
  }
}
