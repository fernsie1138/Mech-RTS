// Procedural test landscape used until map files arrive (milestone 3).
// Deterministic: the same seed always gives the same map.
// Features: rolling hills, a big mountain (NE), a long ridge (NW), a dry riverbed valley and a road.
import { SURFACE } from './surface.js';

function makeNoise(seed) {
  const hash = (i, j) => {
    let h = (i * 374761393 + j * 668265263 + seed * 2147483647) | 0;
    h = Math.imul(h ^ (h >>> 13), 1274126177);
    return ((h ^ (h >>> 16)) >>> 0) / 4294967295;
  };
  const smooth = t => t * t * (3 - 2 * t);
  const value = (x, z) => {
    const i = Math.floor(x), j = Math.floor(z);
    const tx = smooth(x - i), tz = smooth(z - j);
    const a = hash(i, j), b = hash(i + 1, j), c = hash(i, j + 1), d = hash(i + 1, j + 1);
    return (a * (1 - tx) + b * tx) * (1 - tz) + (c * (1 - tx) + d * tx) * tz;
  };
  return (x, z, octaves = 4) => {
    let s = 0, amp = 1, f = 1, norm = 0;
    for (let o = 0; o < octaves; o++) { s += (value(x * f, z * f) * 2 - 1) * amp; norm += amp; amp *= 0.5; f *= 2.03; }
    return s / norm;   // -1..1
  };
}

// Distance from point p to segment a-b, plus the parameter t along it.
function segDist(px, pz, ax, az, bx, bz) {
  const dx = bx - ax, dz = bz - az;
  const t = Math.max(0, Math.min(1, ((px - ax) * dx + (pz - az) * dz) / (dx * dx + dz * dz)));
  return { d: Math.hypot(px - (ax + dx * t), pz - (az + dz * t)), t };
}

const smoothstep = (a, b, x) => { const t = Math.max(0, Math.min(1, (x - a) / (b - a))); return t * t * (3 - 2 * t); };

// River centreline: winds north-south through the west-centre of the map.
export const riverX = z => -30 + Math.sin(z * 0.022) * 22 + Math.sin(z * 0.061 + 1) * 6;
// Road: west to east, slightly bent.
export const ROAD = [[-128, -14], [-60, -10], [0, 4], [60, 14], [128, 8]];

export function buildTestMap(hf, surface, seed = 7) {
  const noise = makeNoise(seed);
  const half = hf.half;

  hf.generate((x, z) => {
    let h = noise(x / 40, z / 40, 4) * 2.5 + noise(x / 12, z / 12, 2) * 0.4;

    // Mountain to the north-east, with ridged detail.
    const md = Math.hypot(x - 62, z + 62);
    const m = Math.max(0, 1 - md / 48);
    h += m * m * (3 - 2 * m) * 30 * (0.8 + 0.35 * Math.abs(noise(x / 14, z / 14, 3)));

    // Long ridge to the north-west.
    const r = segDist(x, z, -100, -30, -40, -95);
    h += Math.max(0, 1 - (r.d / 11) ** 2) * 13 * (0.75 + 0.25 * Math.sin(r.t * Math.PI));

    // Low hill in the south-east.
    const hd = Math.hypot(x - 70, z - 70);
    h += Math.max(0, 1 - (hd / 26) ** 2) * 8;

    // Dry riverbed valley (water comes in milestone 4).
    const rd = Math.abs(x - riverX(z));
    h -= (1 - smoothstep(4, 14, rd)) * 4.5;

    // Flatten along the road.
    let roadD = Infinity;
    for (let s = 0; s < ROAD.length - 1; s++) {
      roadD = Math.min(roadD, segDist(x, z, ...ROAD[s], ...ROAD[s + 1]).d);
    }
    const flat = 1 - smoothstep(3, 9, roadD);
    h = h * (1 - flat * 0.85) + 0.3 * flat;

    // Fade to flat at the map edge so the border is tidy.
    const edge = smoothstep(0, 14, half - Math.max(Math.abs(x), Math.abs(z)));
    return h * edge;
  });

  // Paint the road.
  for (let s = 0; s < ROAD.length - 1; s++) {
    const [ax, az] = ROAD[s], [bx, bz] = ROAD[s + 1];
    const len = Math.hypot(bx - ax, bz - az);
    for (let t = 0; t <= len; t += hf.spacing) {
      surface.paint(ax + (bx - ax) * t / len, az + (bz - az) * t / len, 2.4, SURFACE.ROAD);
    }
  }
}
