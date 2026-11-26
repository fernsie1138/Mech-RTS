// Single entry point for all damage, to units and to the world (CLAUDE.md §4).
// Terrain (craters, wear, flooding), trees, buildings and units take damage here. Every change is
// reported to the nav grid (world.nav) so paths re-plan around new craters, rubble and fallen trees.
import { TERRAIN_DAMAGE } from '../config.js';
import { BUILDING_DAMAGE, addRubble } from '../world/buildings.js';

export class Damage {
  constructor(world) {
    this.world = world;        // { hf, surface, effects, water?, forest?, buildings?, nav?, units? }
    this.log = [];             // recent impacts, for tests/debugging
  }

  // An explosion of weapon type `weapon` (a key of TERRAIN_DAMAGE) at (x, z), at height y (default: the ground).
  // A blast well above the ground (e.g. on a roof or bridge deck) doesn't crater the ground.
  // unitHit: { dmg, splash, team, exclude } damages enemy units (not `team`) within `splash` of the blast.
  explode(x, z, weapon, y = null, unitHit = null) {
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
        if (effects && Math.random() < 0.3) effects.burn(r.x, hf.heightAt(r.x, r.z) + 0.3, r.z, 0.7, 4 + Math.random() * 4);   // smouldering rubble
      }
      // Hit buildings catch fire for a while and shed pieces in their colours.
      if (effects && weapon !== 'mg' && buildings.lastHit.length) {
        const pieces = buildings.lastHit.map(i => [i, buildings.pieces[i]]);
        for (const [, p] of pieces.slice(0, 6)) effects.rubble(p.px, p.py, p.pz, p.color, weapon === 'shell' ? 3 : 2, 1);
        const standing = pieces.filter(([, p]) => p.alive && p.role !== 'deck' && p.role !== 'pillar');
        for (const [i, p] of standing.sort(() => Math.random() - 0.5).slice(0, weapon === 'shell' ? 2 : 1)) {
          effects.burn(p.px, p.py - p.sy * 0.2, p.pz, weapon === 'shell' ? 1.3 : 0.9, 6 + Math.random() * 6, () => buildings.pieces[i].alive);
        }
      }
    }
    if (buildings && onGround && p.depth > 0) buildings.clearChunks(x, z, p.radius * 1.1);
    if (water && onGround && p.depth > 0) {
      const r = hf.rect(x, z, p.radius * 1.5 + 4 * hf.spacing);
      flooded = water.flood(r.i0, r.j0, r.i1, r.j1);
    }
    if (forest && onGround) trees = forest.blast(x, z, { fallR: p.treeFall, ignite: p.ignite });
    if (effects) effects.explosion(x, onGround ? hf.heightAt(x, z) : by, z, p.fxSize, (a, b) => hf.heightAt(a, b));
    // Terrain and water changes reach the nav grid through their own change events; trees and buildings don't.
    if (this.world.nav && (trees || rubble.length || p.treeFall)) {
      const fall = buildings && rubble.length ? Math.max(...rubble.map(r => Math.hypot(r.x - x, r.z - z) + r.r)) : 0;
      this.world.nav.markDirty(x, z, Math.max(p.treeFall || 0, fall) + 2);
    }
    let unitsHit = 0;
    if (unitHit && this.world.units) {
      for (const u of [...this.world.units.list, ...this.world.units.structures]) {
        if (!u.alive || u.team === unitHit.team || u === unitHit.exclude) continue;
        const d = Math.hypot(u.x - x, u.z - z) - u.radius;
        if (d < unitHit.splash && Math.abs(u.y + u.height / 2 - by) < u.height + unitHit.splash) {
          this.hitUnit(u, unitHit.dmg * (1 - 0.6 * Math.max(0, d) / unitHit.splash));
          unitsHit++;
        }
      }
    }
    const hit = { x, z, y: by, weapon, y0, y1: hf.heightAt(x, z), flooded, trees, pieces: rubble.length, unitsHit, ...result };
    this.log.push(hit);
    if (this.log.length > 50) this.log.shift();
    return hit;
  }

  // Damage a unit. At 0 hp it is destroyed: a big explosion and a scorched patch where it fell.
  hitUnit(u, amount) {
    if (!u.alive) return false;
    u.hp -= amount;
    u.hitT = 0.15;
    if (u.hp > 0) return false;
    const { surface, effects, units } = this.world;
    units?.kill(u);
    if (u.isHQ) {
      // The HQ goes up in a chain of blasts and burns for a long time.
      surface.wear(u.x, u.z, 14, 1, 1);
      for (let k = 0; k < 5; k++) effects?.explosion(u.x + (Math.random() - 0.5) * 8, u.y + 2 + Math.random() * 6, u.z + (Math.random() - 0.5) * 8, 2.2);
      effects?.burn(u.x, u.y + 3, u.z, 3, 60);
      return true;
    }
    surface.wear(u.x, u.z, 3 * u.t.scale, 0.6, 0.7);
    effects?.explosion(u.x, u.y + u.height * 0.4, u.z, 1.1 * u.t.scale);
    effects?.burn(u.x, u.y + 0.5, u.z, 0.9 * u.t.scale, 8 + Math.random() * 6);
    return true;
  }

  // Per simulation step: fires burn and spread; burnt-out trees scorch the ground under them.
  update(dt) {
    const { forest, surface, effects, hf } = this.world;
    if (!forest) return;
    // Burning trees give off smoke that drifts away.
    if (effects) for (const i of forest.burning) {
      if (Math.random() > dt * 2.5) continue;
      const t = forest.trees[i];
      effects.smokePuff(t.x, hf.heightAt(t.x, t.z) + (t.state === 0 ? 3.5 : 1) * t.s, t.z, 1.1 * t.s);
    }
    for (const i of forest.update(dt)) {
      const t = forest.trees[i];
      surface.wear(t.x, t.z, 2.4 * t.s, 0.4, 0.6);
      this.world.nav?.markDirty(t.x, t.z, 2);        // a burnt-out tree no longer blocks
    }
  }
}
