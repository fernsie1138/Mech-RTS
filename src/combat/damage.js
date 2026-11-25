// Single entry point for all damage, to units and to the world (CLAUDE.md §4).
// Terrain (craters, wear, flooding) and trees take damage here; units and buildings hook in later.
import { TERRAIN_DAMAGE } from '../config.js';
import { BUILDING_DAMAGE, addRubble } from '../world/buildings.js';

export class Damage {
  constructor(world) {
    this.world = world;        // { hf, surface, effects, water?, forest? }
    this.log = [];             // recent impacts, for tests/debugging
  }

  // An explosion of weapon type `weapon` (a key of TERRAIN_DAMAGE) at (x, z), at height y (default: the ground).
  // A blast well above the ground (e.g. on a roof or bridge deck) doesn't crater the ground.
  explode(x, z, weapon, y = null) {
    const p = TERRAIN_DAMAGE[weapon];
    if (!p) throw new Error(`unknown weapon terrain profile: ${weapon}`);
    const { hf, surface, effects } = this.world;
    if (!hf.inside(x, z)) return null;
    const y0 = hf.heightAt(x, z);
    const by = y ?? y0 + 0.3;
    const onGround = by - y0 < p.radius * 0.5;        // only bursts near the ground dig craters
    let result = { removed: 0, maxDelta: 0 };
    if (onGround && p.depth > 0) result = hf.crater(x, z, { radius: p.radius, depth: p.depth, rim: p.rim, erode: p.erode });
    if (onGround) surface.wear(x, z, p.radius * p.wearRadius, p.wear, p.scorch);
    const { water, forest, buildings } = this.world;
    let flooded = 0, trees = 0, rubble = [];
    if (buildings && BUILDING_DAMAGE[weapon]) {
      rubble = buildings.blast(x, by, z, BUILDING_DAMAGE[weapon]);
      for (const r of rubble) {
        addRubble(hf, surface, r);
        effects?.dust(r.x, hf.heightAt(r.x, r.z), r.z, Math.min(3, r.r * 0.7));
      }
    }
    if (buildings && onGround && p.depth > 0) buildings.clearChunks(x, z, p.radius * 1.1);
    if (water && onGround && p.depth > 0) {
      const r = hf.rect(x, z, p.radius * 1.5 + 4 * hf.spacing);
      flooded = water.flood(r.i0, r.j0, r.i1, r.j1);
    }
    if (forest && onGround) trees = forest.blast(x, z, { fallR: p.treeFall, ignite: p.ignite });
    if (effects) effects.explosion(x, onGround ? hf.heightAt(x, z) : by, z, p.fxSize, (a, b) => hf.heightAt(a, b));
    const hit = { x, z, y: by, weapon, y0, y1: hf.heightAt(x, z), flooded, trees, pieces: rubble.length, ...result };
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
