// Surface paint layers: what the ground looks like at each height sample.
// Pure data (no three.js).
//
// Per sample:
//   base   - painted ground type from the map (grass, dirt, mud, road, rubble)
//   damage - cumulative wear, 0 = pristine. Never decreases: the landscape never heals.
//            0..1 grass/road churns to dirt, 1..3 dirt to torn, cratered earth.
//   scorch - burn marks 0..1, also permanent.
//
// The visible surface is derived from these: grass -> dirt -> scorched/cratered.

export const SURFACE = { GRASS: 0, DIRT: 1, MUD: 2, ROAD: 3, RUBBLE: 4 };

// Linear RGB-ish colours (0..1). Tuned by eye; stylised low-poly palette.
const COL = {
  grass:  [0.36, 0.50, 0.22],
  grass2: [0.45, 0.55, 0.25],   // lighter grass variation
  dirt:   [0.47, 0.38, 0.25],
  mud:    [0.30, 0.25, 0.17],
  road:   [0.42, 0.42, 0.40],
  rubble: [0.50, 0.47, 0.43],
  torn:   [0.30, 0.24, 0.17],   // heavily cratered earth
  scorch: [0.17, 0.15, 0.13],
  rock:   [0.46, 0.44, 0.41],
  snow:   [0.88, 0.90, 0.92],
};

const BASE_COL = [COL.grass, COL.dirt, COL.mud, COL.road, COL.rubble];

function hash(i, j) {
  let h = (i * 374761393 + j * 668265263) | 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967295;
}

export class Surface {
  constructor(hf) {
    this.hf = hf;
    const n = hf.verts * hf.verts;
    this.base = new Uint8Array(n);
    this.damage = new Float32Array(n);
    this.scorch = new Float32Array(n);
    this.listeners = [];
  }

  onChange(fn) { this.listeners.push(fn); }
  changed(i0, j0, i1, j1) { for (const fn of this.listeners) fn(i0, j0, i1, j1); }

  // Paint a base type in a circle (used by map generation, later by the editor).
  paint(x, z, radius, type) {
    const hf = this.hf, { i0, i1, j0, j1 } = hf.rect(x, z, radius);
    for (let j = j0; j <= j1; j++) for (let i = i0; i <= i1; i++) {
      if (Math.hypot(hf.wx(i) - x, hf.wz(j) - z) <= radius) this.base[hf.index(i, j)] = type;
    }
    this.changed(i0, j0, i1, j1);
  }

  // Blast wear around (x, z). `amount` adds to damage at the centre, `burn` to scorch; both fall off to the edge.
  wear(x, z, radius, amount, burn) {
    const hf = this.hf, { i0, i1, j0, j1 } = hf.rect(x, z, radius);
    for (let j = j0; j <= j1; j++) for (let i = i0; i <= i1; i++) {
      const d = Math.hypot(hf.wx(i) - x, hf.wz(j) - z) / radius;
      if (d >= 1) continue;
      const f = 1 - d * d;
      const k = hf.index(i, j);
      this.damage[k] += amount * f;
      // Scorch is strongest in the middle and noisy at the edge.
      const s = burn * f * (0.75 + 0.5 * hash(i, j));
      this.scorch[k] = Math.min(1, this.scorch[k] + s);
    }
    this.changed(i0, j0, i1, j1);
  }

  // Road gives a movement bonus only where it is still intact.
  roadIntact(x, z) {
    const hf = this.hf;
    const k = hf.index(Math.round(hf.gx(x)), Math.round(hf.gz(z)));
    return this.base[k] === SURFACE.ROAD && this.damage[k] < 0.5;
  }

  // Colour of sample k. `slope` (rise/run) and `height` let steep ground show rock and peaks show snow.
  colorAt(i, j, slope, height, out) {
    const k = this.hf.index(i, j);
    const n = hash(i, j);
    let c = BASE_COL[this.base[k]];
    let r = c[0], g = c[1], b = c[2];
    if (this.base[k] === SURFACE.GRASS) {
      const t = hash(i >> 3, j >> 3) * 0.6 + n * 0.4;       // patchy light/dark grass
      r += (COL.grass2[0] - r) * t; g += (COL.grass2[1] - g) * t; b += (COL.grass2[2] - b) * t;
    }
    // Natural rock on steep slopes and snow on high peaks (only on undamaged ground).
    const rock = Math.min(1, Math.max(0, (slope - 0.55) / 0.4));
    if (rock > 0) { r += (COL.rock[0] - r) * rock; g += (COL.rock[1] - g) * rock; b += (COL.rock[2] - b) * rock; }
    const snow = Math.min(1, Math.max(0, (height - 24) / 4)) * (1 - rock * 0.7);
    if (snow > 0) { r += (COL.snow[0] - r) * snow; g += (COL.snow[1] - g) * snow; b += (COL.snow[2] - b) * snow; }

    // Wear: toward dirt, then torn earth.
    const d = this.damage[k];
    if (d > 0) {
      const t1 = Math.min(1, d);
      r += (COL.dirt[0] - r) * t1; g += (COL.dirt[1] - g) * t1; b += (COL.dirt[2] - b) * t1;
      if (d > 1) {
        const t2 = Math.min(1, (d - 1) / 2);
        r += (COL.torn[0] - r) * t2; g += (COL.torn[1] - g) * t2; b += (COL.torn[2] - b) * t2;
      }
    }
    const s = this.scorch[k];
    if (s > 0) {
      const t = s * 0.8;
      r += (COL.scorch[0] - r) * t; g += (COL.scorch[1] - g) * t; b += (COL.scorch[2] - b) * t;
    }
    const v = 0.93 + n * 0.14;                                // per-sample brightness noise
    out[0] = r * v; out[1] = g * v; out[2] = b * v;
    return out;
  }
}
