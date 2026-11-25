// Tree data and tree damage (CLAUDE.md §6.1). Pure: no three.js, runs in Node tests.
//
// Each tree: { x, z, s (scale), t (type: 0 conifer, 1 broadleaf), state, dir, burn, charred }
//   state: STANDING -> FALLEN (knocked flat, lying along `dir`) -> STUMP (stump / ash)
//   burn:  seconds of burning left (0 = not burning). Burning trees can ignite neighbours and end as STUMP.
import { FEATURE } from '../terrain/surface.js';

export const TREE = { STANDING: 0, FALLEN: 1, STUMP: 2 };

export const FOREST = {
  denseSpacing: 2.6,          // jittered grid cell (world units) in dense forest
  sparseSpacing: 6.5,         // ... and for scattered trees
  maxSlope: 1.1,              // no trees on steeper ground
  burnTime: [9, 15],          // seconds a tree burns
  spreadRadius: 3.2,          // fire reaches trees this close
  spreadChance: 0.06,         // per neighbour per second (one tree alight burns ~10% of a forest, sometimes half)
  cell: 8,                    // spatial grid cell size
};

function hash(i, j, seed) {
  let h = (i * 374761393 + j * 668265263 + seed * 1442695041) | 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967295;
}

// Deterministic random number generator (tests and replays get the same fires).
export function makeRng(seed = 1) {
  let s = (seed >>> 0) || 1;
  return () => { s ^= s << 13; s >>>= 0; s ^= s >>> 17; s ^= s << 5; s >>>= 0; return s / 4294967296; };
}

export function newTree(x, z, s = 1, t = 0) {
  return { x, z, s, t, state: TREE.STANDING, dir: 0, burn: 0, charred: false };
}

// Place trees over the FOREST (dense) and TREES (scattered) feature areas. Skips water, roads and steep ground.
export function generateTrees(hf, surface, seed = 3) {
  const out = [];
  const place = (spacing, bit, salt) => {
    const n = Math.ceil(hf.size / spacing);
    for (let cj = 0; cj < n; cj++) for (let ci = 0; ci < n; ci++) {
      const x = -hf.half + (ci + 0.15 + 0.7 * hash(ci, cj, seed + salt)) * spacing;
      const z = -hf.half + (cj + 0.15 + 0.7 * hash(cj, ci, seed + salt + 7)) * spacing;
      if (!hf.inside(x, z)) continue;
      const k = hf.index(Math.round(hf.gx(x)), Math.round(hf.gz(z)));
      const f = surface.features[k];
      if (!(f & bit) || (f & FEATURE.WATER) || surface.base[k] === 3 /* road */) continue;
      if (hf.slopeAt(x, z) > FOREST.maxSlope) continue;
      const r = hash(ci + 911, cj + 37, seed + salt);
      out.push(newTree(x, z, 0.8 + 0.45 * r, hash(ci + 5, cj + 3, seed) < 0.6 ? 0 : 1));
    }
  };
  place(FOREST.denseSpacing, FEATURE.FOREST, 0);
  place(FOREST.sparseSpacing, FEATURE.TREES, 100);
  return out;
}

export class Forest {
  constructor(trees = [], size = 256, seed = 1) {
    this.size = size;
    this.rng = makeRng(seed);
    this.changed = new Set();          // indices whose look changed (read and cleared by the renderer)
    this.setTrees(trees);
  }

  setTrees(trees) {
    this.trees = trees;
    this.reindex();
    this.allChanged = true;            // renderer: rebuild everything
  }

  reindex() {
    const C = FOREST.cell, n = Math.ceil(this.size / C) + 1;
    this.gridN = n;
    this.grid = new Map();
    this.trees.forEach((t, i) => {
      const key = this._cell(t.x, t.z);
      if (!this.grid.has(key)) this.grid.set(key, []);
      this.grid.get(key).push(i);
    });
    this.burning = new Set(this.trees.map((t, i) => t.burn > 0 ? i : -1).filter(i => i >= 0));
  }

  _cell(x, z) {
    const C = FOREST.cell, h = this.size / 2;
    return Math.floor((z + h) / C) * this.gridN + Math.floor((x + h) / C);
  }

  // Indices of trees within r of (x, z).
  near(x, z, r) {
    const C = FOREST.cell, h = this.size / 2, out = [];
    // Clamp to the grid: out-of-range cells would wrap into neighbouring rows and count trees twice.
    const top = this.gridN - 1, cl = v => Math.max(0, Math.min(top, v));
    const ci0 = cl(Math.floor((x - r + h) / C)), ci1 = cl(Math.floor((x + r + h) / C));
    const cj0 = cl(Math.floor((z - r + h) / C)), cj1 = cl(Math.floor((z + r + h) / C));
    for (let cj = cj0; cj <= cj1; cj++) for (let ci = ci0; ci <= ci1; ci++) {
      const list = this.grid.get(cj * this.gridN + ci);
      if (!list) continue;
      for (const i of list) { const t = this.trees[i]; if ((t.x - x) ** 2 + (t.z - z) ** 2 <= r * r) out.push(i); }
    }
    return out;
  }

  ignite(i) {
    const t = this.trees[i];
    if (t.burn > 0 || t.state === TREE.STUMP) return false;
    const [a, b] = FOREST.burnTime;
    t.burn = a + (b - a) * this.rng();
    t.charred = true;
    this.burning.add(i);
    this.changed.add(i);
    return true;
  }

  // An explosion. Trees inside `stumpR` are shattered to stumps, inside `fallR` knocked flat away from
  // the blast, and inside `fallR * 1.4` set alight with probability `ignite`.
  blast(x, z, { fallR, stumpR = fallR * 0.45, ignite = 0 }) {
    if (fallR <= 0 && ignite <= 0) return 0;
    let hit = 0;
    for (const i of this.near(x, z, Math.max(fallR * 1.4, 0.01))) {
      const t = this.trees[i], d = Math.hypot(t.x - x, t.z - z);
      if (t.state === TREE.STUMP) continue;
      if (d < stumpR) { t.state = TREE.STUMP; t.burn = 0; this.burning.delete(i); hit++; }
      else if (d < fallR && t.state === TREE.STANDING) { t.state = TREE.FALLEN; t.dir = Math.atan2(t.z - z, t.x - x); hit++; }
      if (t.state !== TREE.STUMP && this.rng() < ignite) this.ignite(i);
      this.changed.add(i);
    }
    return hit;
  }

  // Something heavy walks through (e.g. a Titan): standing trees in radius fall along `dir`.
  crush(x, z, r, dir) {
    let n = 0;
    for (const i of this.near(x, z, r)) {
      const t = this.trees[i];
      if (t.state !== TREE.STANDING) continue;
      t.state = TREE.FALLEN; t.dir = dir + (this.rng() - 0.5) * 0.6; n++;
      this.changed.add(i);
    }
    return n;
  }

  // Advance fires. Returns the trees that finished burning this step (the caller scorches the ground there).
  update(dt) {
    const burnedOut = [];
    if (!this.burning.size) return burnedOut;
    const spreadP = 1 - Math.pow(1 - FOREST.spreadChance, dt);
    for (const i of [...this.burning]) {
      const t = this.trees[i];
      for (const j of this.near(t.x, t.z, FOREST.spreadRadius)) {
        if (j !== i && this.rng() < spreadP) this.ignite(j);
      }
      t.burn -= dt;
      if (t.burn <= 0) {
        t.burn = 0; t.state = TREE.STUMP;
        this.burning.delete(i);
        this.changed.add(i);
        burnedOut.push(i);
      }
    }
    return burnedOut;
  }

  // Cover density (0..1) for later combat rules: standing trees near a point.
  coverAt(x, z, r = 4) {
    let n = 0;
    for (const i of this.near(x, z, r)) if (this.trees[i].state === TREE.STANDING) n++;
    return Math.min(1, n / 6);
  }

  counts() {
    const c = { standing: 0, fallen: 0, stump: 0, burning: this.burning.size };
    for (const t of this.trees) c[t.state === TREE.STANDING ? 'standing' : t.state === TREE.FALLEN ? 'fallen' : 'stump']++;
    return c;
  }

  // ---- editing ----
  add(x, z, s, type) { this.trees.push(newTree(x, z, s, type)); this.reindex(); this.allChanged = true; }
  removeNear(x, z, r) {
    const kill = new Set(this.near(x, z, r));
    if (!kill.size) return 0;
    this.trees = this.trees.filter((_, i) => !kill.has(i));
    this.reindex(); this.allChanged = true;
    return kill.size;
  }
  // Spray: add trees at random in a circle, keeping a minimum spacing.
  spray(x, z, r, count, ok) {
    let added = 0;
    for (let n = 0; n < count; n++) {
      const a = this.rng() * Math.PI * 2, d = Math.sqrt(this.rng()) * r;
      const px = x + Math.cos(a) * d, pz = z + Math.sin(a) * d;
      if (ok && !ok(px, pz)) continue;
      if (this.near(px, pz, FOREST.denseSpacing * 0.8).length) continue;
      this.trees.push(newTree(px, pz, 0.8 + 0.45 * this.rng(), this.rng() < 0.6 ? 0 : 1));
      const key = this._cell(px, pz);
      if (!this.grid.has(key)) this.grid.set(key, []);
      this.grid.get(key).push(this.trees.length - 1);
      added++;
    }
    if (added) this.allChanged = true;
    return added;
  }
  // Static copy for saving / undo (no damage state).
  snapshot() { return this.trees.map(t => ({ x: t.x, z: t.z, s: t.s, t: t.t })); }
  static fromSnapshot(list) { return list.map(t => newTree(t.x, t.z, t.s, t.t)); }
}
