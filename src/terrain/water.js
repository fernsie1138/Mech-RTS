// Rivers, water level and flooding (CLAUDE.md §5.4). Pure: no three.js, runs in Node tests.
//
// `level[k]` is the water surface height at sample k, or -Infinity where there is no water.
// The level is worked out from the map's WATER feature bits: it sits a little below the height of the
// nearby banks, smoothed along the river, so rivers follow the land downhill.
// Water is present where level > ground height; depth = level - ground.
//
// Flooding: after a crater, connected ground below an adjacent water level fills to that level (locally).
import { FEATURE } from './surface.js';

export const WATER = {
  freeboard: 0.35,       // water surface sits this far below the bank height
  bankRadius: 6,         // samples: how far to look for bank heights
  shallowMax: 1.0,       // deeper than this is impassable for mechs (nav, milestone 6)
  floodReach: 16,        // samples (8 units): a flood spreads at most this far beyond the blast area
  breach: 0.6,           // inside a fresh blast, water pours over lips up to this far above its level
};

function blurSep(src, V, r) {
  const a = new Float32Array(src.length), b = new Float32Array(src.length);
  for (let j = 0; j < V; j++) {
    let s = 0;
    const row = j * V;
    for (let i = -r; i <= r; i++) s += src[row + Math.min(V - 1, Math.max(0, i))];
    for (let i = 0; i < V; i++) {
      a[row + i] = s / (2 * r + 1);
      s += src[row + Math.min(V - 1, i + r + 1)] - src[row + Math.max(0, i - r)];
    }
  }
  for (let i = 0; i < V; i++) {
    let s = 0;
    for (let j = -r; j <= r; j++) s += a[Math.min(V - 1, Math.max(0, j)) * V + i];
    for (let j = 0; j < V; j++) {
      b[j * V + i] = s / (2 * r + 1);
      s += a[Math.min(V - 1, j + r + 1) * V + i] - a[Math.max(0, j - r) * V + i];
    }
  }
  return b;
}

export class Water {
  constructor(hf, surface) {
    this.hf = hf;
    this.surface = surface;
    this.level = new Float32Array(hf.verts * hf.verts).fill(-Infinity);
    this.listeners = [];
    this.rebuild();
  }

  onChange(fn) { this.listeners.push(fn); }
  changed(i0, j0, i1, j1) { for (const fn of this.listeners) fn(i0, j0, i1, j1); }

  // Recompute every water level from the WATER feature bits and the current heights.
  rebuild() {
    const hf = this.hf, V = hf.verts, N = V * V, h = hf.h, f = this.surface.features;
    const W = new Float32Array(N);
    let any = false;
    for (let k = 0; k < N; k++) if (f[k] & FEATURE.WATER) { W[k] = 1; any = true; }
    this.level.fill(-Infinity);
    if (any) {
      // Banks: dry samples next to water. Bank height = weighted average of nearby bank samples.
      const near = blurSep(W, V, 2);
      const B = new Float32Array(N), hB = new Float32Array(N);
      for (let k = 0; k < N; k++) if (!W[k] && near[k] > 0) { B[k] = 1; hB[k] = h[k]; }
      let num = hB, den = B;
      for (let p = 0; p < 2; p++) { num = blurSep(num, V, WATER.bankRadius); den = blurSep(den, V, WATER.bankRadius); }
      const L = new Float32Array(N).fill(NaN);
      for (let k = 0; k < N; k++) if (W[k] && den[k] > 1e-4) L[k] = num[k] / den[k] - WATER.freeboard;
      // Water far from any bank (middle of a big lake): take the level of neighbouring water.
      let frontier = [];
      for (let k = 0; k < N; k++) if (W[k] && Number.isNaN(L[k])) frontier.push(k);
      while (frontier.length) {
        const next = [];
        for (const k of frontier) {
          const i = k % V, j = (k - i) / V;
          let s = 0, n = 0;
          for (const q of [i > 0 ? k - 1 : -1, i < V - 1 ? k + 1 : -1, j > 0 ? k - V : -1, j < V - 1 ? k + V : -1]) {
            if (q >= 0 && W[q] && !Number.isNaN(L[q])) { s += L[q]; n++; }
          }
          if (n) L[k] = s / n; else next.push(k);
        }
        if (next.length === frontier.length) break;
        frontier = next;
      }
      // Smooth the level along the water so it has no steps.
      const Lw = new Float32Array(N), Wv = new Float32Array(N);
      for (let k = 0; k < N; k++) if (W[k] && !Number.isNaN(L[k])) { Lw[k] = L[k]; Wv[k] = 1; }
      const sn = blurSep(Lw, V, 3), sd = blurSep(Wv, V, 3);
      for (let k = 0; k < N; k++) if (Wv[k]) this.level[k] = sn[k] / sd[k];
    }
    this.changed(0, 0, V - 1, V - 1);
  }

  // Water surface height at the nearest sample (or -Infinity).
  levelAt(x, z) {
    const hf = this.hf;
    if (!hf.inside(x, z)) return -Infinity;
    return this.level[hf.index(Math.round(hf.gx(x)), Math.round(hf.gz(z)))];
  }

  depthAt(x, z) {
    const L = this.levelAt(x, z);
    return L === -Infinity ? 0 : Math.max(0, L - this.hf.heightAt(x, z));
  }

  isDeep(x, z) { return this.depthAt(x, z) > WATER.shallowMax; }

  // After the ground changed in a rectangle: water next to it pours into connected ground below its level.
  // Inside the rectangle (the blast area) the broken ground lets water over low lips (WATER.breach), so a
  // crater dug beside a river fills even if its rim or the bank edge is a little above the water.
  // The flood stays local (WATER.floodReach beyond the blast), so one shell can't drain a river over a whole
  // plain; a chain of craters still floods one crater at a time.
  // Returns the number of samples that flooded.
  flood(i0, j0, i1, j1, breach = WATER.breach) {
    const hf = this.hf, V = hf.verts, h = hf.h, L = this.level, R = WATER.floodReach;
    i0 = Math.max(0, i0 - 1); j0 = Math.max(0, j0 - 1); i1 = Math.min(V - 1, i1 + 1); j1 = Math.min(V - 1, j1 + 1);
    const inBlast = q => { const qi = q % V, qj = (q - qi) / V; return qi >= i0 && qi <= i1 && qj >= j0 && qj <= j1; };
    const inReach = q => { const qi = q % V, qj = (q - qi) / V; return qi >= i0 - R && qi <= i1 + R && qj >= j0 - R && qj <= j1 + R; };
    const queue = [];
    for (let j = j0; j <= j1; j++) for (let i = i0; i <= i1; i++) {
      const k = j * V + i;
      if (L[k] > h[k]) queue.push(k);              // wet samples next to (or in) the changed area
    }
    let filled = 0, qi = 0;
    let bi0 = V, bj0 = V, bi1 = -1, bj1 = -1;
    while (qi < queue.length) {
      const k = queue[qi++], lv = L[k];
      const i = k % V, j = (k - i) / V;
      for (const q of [i > 0 ? k - 1 : -1, i < V - 1 ? k + 1 : -1, j > 0 ? k - V : -1, j < V - 1 ? k + V : -1]) {
        if (q < 0 || L[q] !== -Infinity || !inReach(q)) continue;   // only fill dry ground nearby; never raise a river's own level
        const below = h[q] < lv - 0.01;
        if (!below && !(breach > 0 && h[q] < lv + breach && inBlast(q))) continue;
        L[q] = lv;                       // (a breached lip carries the level but stays dry: level < ground)
        queue.push(q);
        if (below) filled++;
        const qi_ = q % V, qj = (q - qi_) / V;
        if (qi_ < bi0) bi0 = qi_; if (qi_ > bi1) bi1 = qi_;
        if (qj < bj0) bj0 = qj; if (qj > bj1) bj1 = qj;
      }
    }
    if (filled) this.changed(bi0, bj0, bi1, bj1);
    return filled;
  }

  wetCount() { let n = 0; for (let k = 0; k < this.level.length; k++) if (this.level[k] > this.hf.h[k]) n++; return n; }
}
