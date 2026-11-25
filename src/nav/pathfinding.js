// A* paths over the nav grid (CLAUDE.md §8). Pure: no three.js.
// 8-connected, no corner cutting past blocked cells. If the goal can't be reached, the path goes to the
// reachable cell closest to it. Paths are then smoothed (straight runs where the line is clear and no
// costlier than its ends), and carry the list of cells they cross so a unit can tell when to re-plan.
import { NAV } from './navgrid.js';

class Heap {
  constructor() { this.k = []; this.v = []; }
  get size() { return this.k.length; }
  push(key, val) {
    const k = this.k, v = this.v; let i = k.length;
    k.push(key); v.push(val);
    while (i > 0) { const p = (i - 1) >> 1; if (k[p] <= key) break; k[i] = k[p]; v[i] = v[p]; i = p; }
    k[i] = key; v[i] = val;
  }
  pop() {
    const k = this.k, v = this.v, top = v[0], lastK = k.pop(), lastV = v.pop();
    if (k.length) {
      let i = 0;
      for (;;) {
        let c = 2 * i + 1;
        if (c >= k.length) break;
        if (c + 1 < k.length && k[c + 1] < k[c]) c++;
        if (k[c] >= lastK) break;
        k[i] = k[c]; v[i] = v[c]; i = c;
      }
      k[i] = lastK; v[i] = lastV;
    }
    return top;
  }
}

const DIRS = [[1, 0, 1], [-1, 0, 1], [0, 1, 1], [0, -1, 1], [1, 1, Math.SQRT2], [1, -1, Math.SQRT2], [-1, 1, Math.SQRT2], [-1, -1, Math.SQRT2]];

export class PathFinder {
  constructor(grid) {
    this.grid = grid;
    const N = grid.n * grid.n;
    this.g = new Float32Array(N);
    this.from = new Int32Array(N);
    this.seen = new Uint32Array(N);      // search id when g/from were set
    this.closed = new Uint32Array(N);
    this.search = 0;
    this.maxExpand = 60000;
    this.lastExpanded = 0;
  }

  // Path for size class `cls` from (sx, sz) to (tx, tz).
  // Returns { points: [{x, z}...] (first = start), cells: [cell indices], reached: bool, cost } or null if the
  // start itself is impassable (the caller first escapes to the nearest passable cell).
  find(cls, sx, sz, tx, tz) {
    const G = this.grid, n = G.n, cost = G.cost[cls];
    const s = G.idx(sx, sz);
    let t = G.idx(tx, tz);
    if (cost[s] === Infinity) return null;
    const id = ++this.search;
    const ti = t % n, tj = (t - ti) / n;
    const h = (k) => {
      const i = k % n, j = (k - i) / n, dx = Math.abs(i - ti), dy = Math.abs(j - tj);
      return (Math.max(dx, dy) + (Math.SQRT2 - 1) * Math.min(dx, dy)) * NAV.minMult;
    };
    const open = new Heap();
    this.g[s] = 0; this.from[s] = -1; this.seen[s] = id;
    open.push(h(s), s);
    let best = s, bestH = h(s), expanded = 0;
    while (open.size) {
      const k = open.pop();
      if (this.closed[k] === id) continue;
      this.closed[k] = id;
      if (k === t) { best = k; break; }
      const hk = h(k);
      if (hk < bestH) { bestH = hk; best = k; }
      if (++expanded > this.maxExpand) break;
      const i = k % n, j = (k - i) / n, ck = cost[k];
      for (const [di, dj, d] of DIRS) {
        const ii = i + di, jj = j + dj;
        if (ii < 0 || jj < 0 || ii >= n || jj >= n) continue;
        const q = jj * n + ii, cq = cost[q];
        if (cq === Infinity || this.closed[q] === id) continue;
        if (di && dj && (cost[j * n + ii] === Infinity || cost[jj * n + i] === Infinity)) continue;   // no corner cutting
        const gq = this.g[k] + d * (ck + cq) / 2;
        if (this.seen[q] !== id || gq < this.g[q]) {
          this.seen[q] = id; this.g[q] = gq; this.from[q] = k;
          open.push(gq + h(q), q);
        }
      }
    }
    this.lastExpanded = expanded;
    const reached = best === t;
    const cells = [];
    for (let k = best; k !== -1; k = this.from[k]) cells.push(k);
    cells.reverse();
    const pts = cells.map(k => ({ x: G.cx(k % n), z: G.cz((k - (k % n)) / n), g: this.g[k] }));
    pts[0] = { x: sx, z: sz, g: 0 };
    if (reached) pts[pts.length - 1] = { x: tx, z: tz, g: pts[pts.length - 1].g };
    return { points: this.smooth(cls, pts).map(p => ({ x: p.x, z: p.z })), cells, reached, cost: this.g[best] };
  }

  // Cost of walking straight from a to b (Infinity if any cell on the way is impassable).
  lineCost(cls, ax, az, bx, bz) {
    const G = this.grid, cost = G.cost[cls];
    const d = Math.hypot(bx - ax, bz - az), steps = Math.max(1, Math.ceil(d / (NAV.cell * 0.35)));
    let sum = 0;
    for (let s = 0; s <= steps; s++) {
      const t = s / steps, c = cost[G.idx(ax + (bx - ax) * t, az + (bz - az) * t)];
      if (c === Infinity) return Infinity;
      sum += c * (s === 0 || s === steps ? 0.5 : 1);
    }
    return sum * d / steps;
  }

  // Shortcut waypoints where walking straight costs no more than the path it replaces (so smoothing never
  // cuts across slow ground, or off a road, that the path chose to avoid).
  smooth(cls, pts) {
    if (pts.length <= 2) return pts;
    const out = [pts[0]];
    let i = 0;
    while (i < pts.length - 1) {
      let j = Math.min(pts.length - 1, i + 1);
      for (let k = pts.length - 1; k > i + 1; k--) {
        const a = pts[i], b = pts[k];
        if (this.lineCost(cls, a.x, a.z, b.x, b.z) <= (b.g - a.g) * 1.03 + 0.05) { j = k; break; }
      }
      out.push(pts[j]);
      i = j;
    }
    return out;
  }
}
