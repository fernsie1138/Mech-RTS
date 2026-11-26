// Walkability / movement-cost grid (CLAUDE.md §8). Pure: no three.js, runs in Node tests.
//
// One cell per world unit (256 x 256 on the current map size). Each cell stores what's there:
//   slope, water depth, intact road, rubble, standing tree trunks, building structure, bridge deck.
// From that, each unit size class gets a cost per cell (Infinity = can't go there):
//   cost = surface multiplier (road faster, shallow water / rubble slower) x slope penalty x forest penalty.
// Unit size matters: building obstacles are widened by the unit's clearance (Scouts squeeze through gaps
// that Titans can't); trees block Assaults in dense forest, slow Scouts, and Titans push through them.
//
// When the world changes (craters, rubble, flooding, trees falling, buildings collapsing), only the cells in
// the changed rectangle (plus the widest clearance) are recomputed. Each cell records the tick it last
// changed, so paths crossing it know to re-plan.
import { SURFACE } from '../terrain/surface.js';
import { WATER } from '../terrain/water.js';
import { TREE } from '../world/forest.js';

// Unit size classes. radius: body radius (world units). clear: cells of clearance from building obstacles.
// maxSlope: steeper ground is a slow scramble (NAV.steepCost); only ground steeper than NAV.hardSlope is
// impassable for everyone. (Hard class limits would trap units in fresh craters, whose walls reach 1.6.) treeClear: -1 = ignores trees (pushes through), otherwise cells of
// clearance around tree trunks. treeCost: extra cost per standing tree in the cell.
export const NAV_CLASSES = [
  { name: 'small',  radius: 1.4, clear: 1, maxSlope: 1.3, treeClear: 0,  treeCost: 0.5, rubble: 1.5 },   // Scout
  { name: 'medium', radius: 2.0, clear: 2, maxSlope: 1.0, treeClear: 1,  treeCost: 0.8, rubble: 1.8 },   // Assault
  { name: 'large',  radius: 3.0, clear: 3, maxSlope: 0.8, treeClear: -1, treeCost: 0.3, rubble: 1.3 },   // Titan
];
export const NAV = {
  cell: 1,                 // world units per cell
  roadMult: 0.6,           // intact road
  shallowMult: 2.5,        // shallow water
  slopeCost: 1.5,          // cost x (1 + slope * slopeCost)
  steepCost: 8,            // extra factor above a class's maxSlope
  hardSlope: 1.9,          // impassable for everyone (above the 1.6 crater-wall limit, so craters never trap)
  minMult: 0.6,            // cheapest possible cell (for the A* heuristic)
  updateBudget: 4000,      // cells recomputed per update() call
};

export class NavGrid {
  // world: { hf, surface, water?, forest?, buildings? } (getters are fine: read each update)
  constructor(world) {
    this.world = world;
    const hf = world.hf;
    this.size = hf.size;
    this.n = Math.round(hf.size / NAV.cell);
    this.half = hf.size / 2;
    const N = this.n * this.n;
    this.slope = new Float32Array(N);
    this.mult = new Float32Array(N);       // surface multiplier
    this.hard = new Uint8Array(N);         // 1 = building structure (widened by clearance)
    this.wet = new Uint8Array(N);          // 1 = deep water, no deck (blocks the cell itself)
    this.trees = new Uint8Array(N);        // standing trunks in the cell
    this.rubble = new Uint8Array(N);       // rubble surface
    this.deck = new Float32Array(N).fill(NaN);   // bridge deck height, or NaN
    this.cost = NAV_CLASSES.map(() => new Float32Array(N));
    this.stamp = new Uint32Array(N);       // tick of the last change to the cell's costs
    this.tick = 1;
    this.queue = [];                       // pending dirty rectangles (cell coords)
    this.rebuild();
  }

  // ---- coordinates ----
  ci(x) { return Math.max(0, Math.min(this.n - 1, Math.floor((x + this.half) / NAV.cell))); }
  cj(z) { return Math.max(0, Math.min(this.n - 1, Math.floor((z + this.half) / NAV.cell))); }
  cx(i) { return -this.half + (i + 0.5) * NAV.cell; }
  cz(j) { return -this.half + (j + 0.5) * NAV.cell; }
  idx(x, z) { return this.cj(z) * this.n + this.ci(x); }

  costAt(cls, x, z) { return this.cost[cls][this.idx(x, z)]; }
  passable(cls, x, z) { return this.cost[cls][this.idx(x, z)] < Infinity; }

  // Ground (or bridge deck) height for a unit standing at (x, z).
  standHeight(x, z) {
    const d = this.deck[this.idx(x, z)];
    const g = this.world.hf.heightAt(x, z);
    return Number.isNaN(d) ? g : Math.max(g, d);
  }

  rebuild() {
    this._update(0, 0, this.n - 1, this.n - 1);
  }

  // Mark a world-space circle as changed (trees, buildings). Terrain and water changes come through markRect.
  markDirty(x, z, r) {
    this.queue.push([this.ci(x - r), this.cj(z - r), this.ci(x + r), this.cj(z + r)]);
  }
  // Heightfield-sample rectangle (from hf / water onChange).
  markSamples(i0, j0, i1, j1) {
    const hf = this.world.hf;
    this.queue.push([this.ci(hf.wx(i0)), this.cj(hf.wz(j0)), this.ci(hf.wx(i1)), this.cj(hf.wz(j1))]);
  }

  // Process queued changes (merged into one rectangle per call to keep it simple). Returns cells updated.
  update() {
    if (!this.queue.length) return 0;
    let [i0, j0, i1, j1] = this.queue.shift();
    // Merge further queued rects that overlap or touch this one.
    for (let k = this.queue.length - 1; k >= 0; k--) {
      const r = this.queue[k];
      if (r[0] <= i1 + 4 && r[2] >= i0 - 4 && r[1] <= j1 + 4 && r[3] >= j0 - 4) {
        i0 = Math.min(i0, r[0]); j0 = Math.min(j0, r[1]); i1 = Math.max(i1, r[2]); j1 = Math.max(j1, r[3]);
        this.queue.splice(k, 1);
      }
    }
    return this._update(i0, j0, i1, j1);
  }

  // Process everything pending (tests, after loading).
  flush() { let n = 0; while (this.queue.length) n += this.update(); return n; }

  _update(i0, j0, i1, j1) {
    const n = this.n;
    i0 = Math.max(0, i0); j0 = Math.max(0, j0); i1 = Math.min(n - 1, i1); j1 = Math.min(n - 1, j1);
    this._sense(i0, j0, i1, j1);
    // Costs depend on obstacles within the widest clearance, so recompute a wider band.
    const pad = Math.max(...NAV_CLASSES.map(c => Math.max(c.clear, c.treeClear))) + 1;   // + tree-cost neighbourhood
    const a0 = Math.max(0, i0 - pad), b0 = Math.max(0, j0 - pad), a1 = Math.min(n - 1, i1 + pad), b1 = Math.min(n - 1, j1 + pad);
    this.tick++;
    for (let c = 0; c < NAV_CLASSES.length; c++) this._costs(c, a0, b0, a1, b1);
    return (a1 - a0 + 1) * (b1 - b0 + 1);
  }

  // Round obstacles that aren't buildings (HQs): world.blockers = [{ x, z, r }].
  _blocker(x, z) {
    const b = this.world.blockers;
    if (b) for (const o of b) if ((x - o.x) ** 2 + (z - o.z) ** 2 < o.r * o.r) return true;
    return false;
  }

  // Read the world into the per-cell facts.
  _sense(i0, j0, i1, j1) {
    const { hf, surface, water, forest, buildings } = this.world;
    const n = this.n, C = NAV.cell, h = C / 2;
    for (let j = j0; j <= j1; j++) for (let i = i0; i <= i1; i++) {
      const k = j * n + i, x = this.cx(i), z = this.cz(j);
      // Slope: steepest of the two central differences across the cell.
      const sx = Math.abs(hf.heightAt(x + h, z) - hf.heightAt(x - h, z)) / C;
      const sz = Math.abs(hf.heightAt(x, z + h) - hf.heightAt(x, z - h)) / C;
      const sd = Math.max(
        Math.abs(hf.heightAt(x + h, z + h) - hf.heightAt(x - h, z - h)),
        Math.abs(hf.heightAt(x + h, z - h) - hf.heightAt(x - h, z + h))) / (C * Math.SQRT2);
      let slope = Math.max(Math.hypot(sx, sz), sd);
      const deck = buildings ? buildings.deckAt(x, z) : null;
      this.deck[k] = deck ?? NaN;
      const depth = water ? water.depthAt(x, z) : 0;
      let mult = 1;
      const sk = hf.index(Math.round(hf.gx(x)), Math.round(hf.gz(z)));
      if (deck !== null) { slope = 0; mult = NAV.roadMult; this.wet[k] = 0; }
      else {
        this.wet[k] = depth > WATER.shallowMax ? 1 : 0;
        if (depth > 0.05) mult *= NAV.shallowMult;
        if (surface.base[sk] === SURFACE.ROAD && surface.damage[sk] < 0.5) mult *= NAV.roadMult;
      }
      this.slope[k] = slope;
      this.mult[k] = mult;
      this.hard[k] = (buildings && buildings.blockedAt(x, z, 0.1)) || this._blocker(x, z) ? 1 : 0;
      this.rubble[k] = surface.base[sk] === SURFACE.RUBBLE ? 1 : 0;
      this.trees[k] = 0;
    }
    if (forest) {
      // Standing trunks in this rectangle.
      const x0 = this.cx(i0) - C, x1 = this.cx(i1) + C, z0 = this.cz(j0) - C, z1 = this.cz(j1) + C;
      for (const ti of forest.near((x0 + x1) / 2, (z0 + z1) / 2, Math.hypot(x1 - x0, z1 - z0) / 2 + 1)) {
        const t = forest.trees[ti];
        if (t.state !== TREE.STANDING) continue;
        const i = this.ci(t.x), j = this.cj(t.z);
        if (i >= i0 && i <= i1 && j >= j0 && j <= j1) this.trees[j * n + i] = Math.min(255, this.trees[j * n + i] + 1);
      }
    }
  }

  // Combine facts into one class's costs for a rectangle.
  _costs(c, i0, j0, i1, j1) {
    const cls = NAV_CLASSES[c], n = this.n, cost = this.cost[c];
    const R = cls.clear, T = cls.treeClear;
    for (let j = j0; j <= j1; j++) for (let i = i0; i <= i1; i++) {
      const k = j * n + i;
      let v;
      if (this.wet[k] || this.slope[k] > NAV.hardSlope || this._near(this.hard, i, j, R) || (T >= 0 && this._near(this.trees, i, j, T))) v = Infinity;
      else {
        v = this.mult[k] * (1 + this.slope[k] * NAV.slopeCost);
        if (this.slope[k] > cls.maxSlope) v *= NAV.steepCost;
        if (this.rubble[k]) v *= cls.rubble;
        // Trees nearby slow everyone (Titans a little as they push through).
        let tn = 0;
        for (let dj = -1; dj <= 1; dj++) for (let di = -1; di <= 1; di++) {
          const ii = i + di, jj = j + dj;
          if (ii >= 0 && jj >= 0 && ii < n && jj < n) tn += this.trees[jj * n + ii];
        }
        v *= 1 + cls.treeCost * Math.min(tn, 4);
      }
      if (cost[k] !== v) { cost[k] = v; this.stamp[k] = this.tick; }
    }
  }

  // Any non-zero cell of `grid` within r cells (square) of (i, j)? Round corners for r >= 2.
  _near(grid, i, j, r) {
    const n = this.n;
    for (let dj = -r; dj <= r; dj++) for (let di = -r; di <= r; di++) {
      if (r >= 2 && di * di + dj * dj > r * r + r) continue;
      const ii = i + di, jj = j + dj;
      if (ii < 0 || jj < 0 || ii >= n || jj >= n) continue;
      if (grid[jj * n + ii]) return true;
    }
    return false;
  }

  // Latest change tick among the cells a path crosses (for re-planning).
  latestChange(cells) { let t = 0; for (const k of cells) if (this.stamp[k] > t) t = this.stamp[k]; return t; }

  // Nearest passable cell centre to (x, z) for a class (BFS ring search). Returns { x, z } or null.
  nearestPassable(cls, x, z, maxR = 40) {
    const i0 = this.ci(x), j0 = this.cj(z), n = this.n, cost = this.cost[cls];
    if (cost[j0 * n + i0] < Infinity) return { x: this.cx(i0), z: this.cz(j0) };
    let best = null, bd = Infinity;
    for (let r = 1; r <= maxR; r++) {
      for (let dj = -r; dj <= r; dj++) for (let di = -r; di <= r; di++) {
        if (Math.max(Math.abs(di), Math.abs(dj)) !== r) continue;
        const i = i0 + di, j = j0 + dj;
        if (i < 0 || j < 0 || i >= n || j >= n || cost[j * n + i] === Infinity) continue;
        const d = Math.hypot(this.cx(i) - x, this.cz(j) - z);
        if (d < bd) { bd = d; best = { x: this.cx(i), z: this.cz(j) }; }
      }
      if (best) return best;
    }
    return null;
  }
}
