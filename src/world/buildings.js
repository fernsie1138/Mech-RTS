// Modular destructible buildings and bridges (CLAUDE.md §6.2). Pure data and rules: no three.js.
//
// A building is a list of pieces (wall tiles in rows, floor, roof panels, blocks, bridge deck and pillars),
// each a box (or a gable prism for roofs) with its own hit points. Pieces rest on supports:
//   - an upper wall tile rests on the tile below it,
//   - a roof rests on the top row of walls (falls when fewer than half are left),
//   - a bridge deck segment rests on its pillars / the banks (falls when none is left).
// Destroying pieces knocks out what they hold up, so buildings break apart in stages:
//   intact -> damaged (holes) -> ruin (roof down) -> rubble (everything down).
// Every fallen piece adds to a rubble mound in the terrain (applied by combat/damage.js), which stays as
// cover and an obstacle and can itself be shelled.
import { FEATURE, SURFACE } from '../terrain/surface.js';

export const BUILDING = {
  ruinFrac: 0.5,       // structural pieces left below this: the building counts as a ruin
  rubbleFrac: 0.25,    // ... below this, everything left collapses
  rubbleBulk: 0.5,
  brokenFrac: 0.5,     // a piece below this fraction of its strength is broken (a hole, framework showing)     // rubble mound volume per unit of fallen piece volume (a collapsed house: ~1.7 high)
};

// Per weapon: how hard explosions hit buildings. Damage to a piece = power * (1 - d / radius)^2,
// d = distance from the blast to the piece's surface.
export const BUILDING_DAMAGE = {
  mg: { power: 6, radius: 1.2 },
  autocannon: { power: 30, radius: 2 },
  cannon: { power: 80, radius: 3.5 },
  shell: { power: 170, radius: 6 },
};

// Sci-fi palette: pale armour panels, darker trim, roof plates, orange / teal accents.
const C = {
  panel: [0xb9c1c8, 0xaab3bb, 0xc6cbcd, 0xb4b8ae], trim: 0x56606a, roof: [0x7f8a94, 0x737e88, 0x8a8f92], door: 0x3c444c,
  accent: [0xe08a2a, 0x3fb6c4, 0xd9b33a], floor: 0x5e636a, hangar: [0x8d9aa5, 0x7d8b97], concrete: 0x8f948f, steel: 0x6d7378,
  stone: 0x9aa0a2, deck: 0x6b6258, pillar: 0x7c7a74,
};

// ---------- blueprints (local coordinates: x across, z depth, y up from the base; rot turns about y) ----------
// Each returns { pieces: [...], footprint: { hw, hd }, kind }. A piece's `kind` is its shape (world/shapes.js),
// `yaw` turns it within the building (its outside, local -z, faces out), `flat` marks slabs (roof, floor, deck)
// that break across their top rather than their face, and `detail` pieces (antennas, struts) don't block sight.
function piece(o) { return { kind: 'box', role: 'wall', hp: 60, supports: [], need: 1, yaw: 0, ...o }; }

// Offset a convex outline (CCW seen from above, [x, z] points) inward by `d`.
function inset(pts, d) {
  const n = pts.length, lines = [];
  for (let k = 0; k < n; k++) {
    const [ax, az] = pts[k], [bx, bz] = pts[(k + 1) % n], l = Math.hypot(bx - ax, bz - az);
    const tx = (bx - ax) / l, tz = (bz - az) / l, nx = tz, nz = -tx;      // outward normal
    lines.push({ px: ax - nx * d, pz: az - nz * d, tx, tz });
  }
  return lines.map((L, k) => {
    const P = lines[(k + n - 1) % n];          // the edge before: they meet at this corner
    const den = P.tx * L.tz - P.tz * L.tx;
    const t = Math.abs(den) < 1e-9 ? 0 : ((L.px - P.px) * L.tz - (L.pz - P.pz) * L.tx) / den;
    return [P.px + P.tx * t, P.pz + P.tz * t];
  });
}
const chamfered = (w, d, c) => (c > 0
  ? [[-w / 2 + c, -d / 2], [w / 2 - c, -d / 2], [w / 2, -d / 2 + c], [w / 2, d / 2 - c], [w / 2 - c, d / 2], [-w / 2 + c, d / 2], [-w / 2, d / 2 - c], [-w / 2, -d / 2 + c]]
  : [[-w / 2, -d / 2], [w / 2, -d / 2], [w / 2, d / 2], [-w / 2, d / 2]]);

// Walls round a w x d outline with chamfered corners (ch), in rows of tiles about colW long. Each row:
// { h, t (thickness at its base), kind ('batter' leans back by t / 2; 'box' is upright), color(s), hp }.
// Upper tiles rest on the tile below. Returns { top: indices of the top row, tiles: [[row][edge][col] index] }.
function wallRing(out, { w, d, ch = 0, rows, colW, y0 }) {
  const outline = chamfered(w, d, ch), tiles = [];
  let lean = 0, y = y0, below = null;
  rows.forEach((row, r) => {
    const pts = inset(outline, lean), cur = [], firstTile = [];
    let ei = 0;
    pts.forEach(([ax, az], k) => {
      const [bx, bz] = pts[(k + 1) % pts.length], len = Math.hypot(bx - ax, bz - az);
      if (len < 0.2) return;
      const tx = (bx - ax) / len, tz = (bz - az) / len, nx = tz, nz = -tx, yaw = Math.atan2(-nx, -nz);
      const n = Math.max(1, Math.round(len / colW)), L = len / n, edge = [];
      for (let c = 0; c < n; c++) {
        const col = Array.isArray(row.color) ? row.color[(k + c + r) % row.color.length] : row.color;
        const sup = below ? [below[Math.min(ei, below.length - 1)][Math.min(c, below[Math.min(ei, below.length - 1)].length - 1)]] : [];
        edge.push(out.push(piece({
          kind: row.kind, x: ax + tx * L * (c + 0.5) - nx * row.t / 2, z: az + tz * L * (c + 0.5) - nz * row.t / 2, y: y + row.h / 2,
          sx: L, sy: row.h, sz: row.t, yaw, color: col, hp: row.hp, structural: true, supports: sup,
        })) - 1);
      }
      cur.push(edge); ei++;
      firstTile[k] = edge[0];
    });
    // Corner ribs: sloped panels leave a notch where two meet at a corner; a trim rib covers it.
    if (row.kind === 'batter') {
      const n = pts.length, nrm = k => { const [ax, az] = pts[k], [bx, bz] = pts[(k + 1) % n], l = Math.hypot(bx - ax, bz - az); return l < 0.2 ? null : [(bz - az) / l, -(bx - ax) / l]; };
      for (let k = 0; k < n; k++) {
        let kp = (k + n - 1) % n;
        while (!nrm(kp) && kp !== k) kp = (kp + n - 1) % n;
        const n1 = nrm(kp), n2 = nrm(k);
        if (!n1 || !n2 || firstTile[k] === undefined) continue;
        const turn = Math.acos(Math.max(-1, Math.min(1, n1[0] * n2[0] + n1[1] * n2[1])));
        if (turn < 0.3) continue;
        const bl = Math.hypot(n1[0] + n2[0], n1[1] + n2[1]), bx = (n1[0] + n2[0]) / bl, bz = (n1[1] + n2[1]) / bl;
        const [vx, vz] = pts[k];
        out.push(piece({ kind: 'batter', role: 'post', detail: true, x: vx - bx * row.t / 2, z: vz - bz * row.t / 2, y: y + row.h / 2,
          sx: 0.3 + 2.2 * (row.t / 2) * Math.tan(turn / 2), sy: row.h, sz: row.t, yaw: Math.atan2(-bx, -bz), color: C.trim, hp: row.hp, supports: [firstTile[k]] }));
      }
    }
    tiles.push(cur);
    below = cur;
    lean += row.kind === 'batter' ? row.t / 2 : 0;
    y += row.h;
  });
  return { top: below.flat(), tiles, lean, y };
}

// A buttress leaning on wall tile t (offset `off` along it), standing on the tile's base.
function strut(out, t, off, h, depth, width, hp) {
  const p = out[t], c = Math.cos(p.yaw), s = Math.sin(p.yaw), ox = -s, oz = -c;      // outward
  const d = p.sz / 2 + depth / 2 - 0.08;
  out.push(piece({ kind: 'wedge', role: 'strut', detail: true, x: p.x + c * off + ox * d, z: p.z - s * off + oz * d, y: p.y - p.sy / 2 + h / 2,
    sx: width, sy: h, sz: depth, yaw: p.yaw, color: C.trim, hp, supports: [t] }));
}

const pick = (rng, a) => a[Math.floor(rng() * a.length)];

const BLUEPRINTS = {
  // A small sci-fi habitat: chamfered, battered walls, a sloped roof slab with a raised cap, buttresses, antenna.
  house(rng) {
    const w = 8, d = 6, ch = 1.2, out = [];
    out.push(piece({ kind: 'frustum', role: 'floor', flat: true, x: 0, y: 0.15, z: 0, sx: w - 0.6, sy: 0.3, sz: d - 0.6, color: C.floor, hp: 200 }));
    const color = pick(rng, C.panel), accent = pick(rng, C.accent);
    const ring = wallRing(out, { w, d, ch, colW: 2, y0: 0.3, rows: [
      { kind: 'batter', h: 1.7, t: 0.8, color, hp: 60 },
      { kind: 'batter', h: 1.5, t: 0.6, color: [color, color, C.trim], hp: 60 },
    ] });
    // The front's middle lower panel is a dark door, with a light over it.
    const front = ring.tiles[0][0], door = front[Math.floor(front.length / 2)];
    out[door].color = C.door;
    const dp = out[door];
    out.push(piece({ role: 'light', detail: true, x: dp.x, y: 2.15, z: -d / 2 + 0.42, sx: 0.9, sy: 0.14, sz: 0.2, color: accent, hp: 20, supports: [door] }));
    // Buttresses against the long walls.
    for (const t of [front[0], front[front.length - 1], ring.tiles[0][4][0], ring.tiles[0][4].at(-1)]) strut(out, t, 0, 1.5, 1.0, 0.45, 40);
    const roofY = 0.3 + 3.2, rw = w - 2 * ring.lean, rd = d - 2 * ring.lean;
    const roof = out.push(piece({ kind: 'frustum', role: 'roof', flat: true, x: 0, y: roofY + 0.3, z: 0, sx: rw + 0.2, sy: 0.6, sz: rd + 0.2,
      color: pick(rng, C.roof), hp: 90, supports: ring.top, need: 0.5 })) - 1;
    const cap = out.push(piece({ kind: 'frustum', role: 'roof', flat: true, x: -0.6, y: roofY + 0.9, z: 0.3, sx: rw * 0.5, sy: 0.6, sz: rd * 0.55,
      color: C.trim, hp: 70, supports: [roof] })) - 1;
    out.push(piece({ role: 'antenna', detail: true, x: rw * 0.3, y: roofY + 1.6, z: -rd * 0.15, sx: 0.12, sy: 2.6, sz: 0.12, color: C.steel, hp: 15, supports: [roof] }));
    out.push(piece({ kind: 'cyl', role: 'vent', detail: true, x: -0.6, y: roofY + 1.35, z: 0.3, sx: 0.8, sy: 0.3, sz: 0.8, color: accent, hp: 25, supports: [cap] }));
    return { pieces: out, footprint: { hw: w / 2, hd: d / 2 } };
  },
  // A hangar: square plan, battered walls with buttresses, sloped roof halves round a raised ridge, exhaust stacks.
  factory(rng) {
    const w = 16, d = 12, out = [];
    out.push(piece({ role: 'floor', flat: true, x: 0, y: 0.15, z: 0, sx: w, sy: 0.3, sz: d, color: C.floor, hp: 400 }));
    const col = pick(rng, C.hangar), accent = pick(rng, C.accent);
    const ring = wallRing(out, { w, d, colW: 3.2, y0: 0.3, rows: [
      { kind: 'batter', h: 3.2, t: 1.0, color: [col, col, C.trim], hp: 140 },
      { kind: 'box', h: 2.6, t: 0.5, color: [C.panel[1], C.panel[0]], hp: 140 },
    ] });
    // Big door in the middle of the front.
    const front = ring.tiles[0][0];
    for (const k of [1, 2]) out[front[k]].color = C.door;
    for (const k of [1, 2]) out[ring.tiles[1][0][k]].color = accent;
    // Buttresses along both long walls.
    for (const e of [0, 2]) for (const t of ring.tiles[0][e]) strut(out, t, -out[t].sx / 2 + 0.3, 3.2, 1.6, 0.6, 80);
    const roofY = ring.y, rw = w - 2 * ring.lean, rd = d - 2 * ring.lean;
    // Two sloped halves (front and back) and a flat ridge between them.
    for (const side of [-1, 1]) {
      out.push(piece({ kind: 'batter', role: 'roof', flat: true, x: 0, y: roofY + 0.7, z: side * rd * 0.3, sx: rw, sy: 1.4, sz: rd * 0.4,
        yaw: side < 0 ? 0 : Math.PI, color: pick(rng, C.roof), hp: 120, supports: ring.top, need: 0.5 }));
    }
    const ridge = out.push(piece({ role: 'roof', flat: true, x: 0, y: roofY + 1.1, z: 0, sx: rw, sy: 0.6, sz: rd * 0.22, color: C.trim, hp: 120, supports: ring.top, need: 0.5 })) - 1;
    for (const x of [-rw * 0.3, 0, rw * 0.3]) out.push(piece({ role: 'light', detail: true, x, y: roofY + 1.45, z: 0, sx: 1.4, sy: 0.12, sz: 0.5, color: accent, hp: 20, supports: [ridge] }));
    let below;
    for (const sx of [-1, 1]) {        // two exhaust stacks in sections
      below = -1;
      for (let r = 0; r < 3; r++) {
        below = out.push(piece({ kind: 'cyl', role: 'chimney', x: sx * (w / 2 - 2.5), y: 0.3 + 3 * (r + 0.5), z: d / 2 - 2.2, sx: 1.6 - r * 0.15, sy: 3, sz: 1.6 - r * 0.15,
          color: r === 2 ? C.trim : C.steel, hp: 120, structural: true, supports: below >= 0 ? [below] : [] })) - 1;
      }
    }
    return { pieces: out, footprint: { hw: w / 2, hd: d / 2 } };
  },
  // An octagonal pillbox: thick sloped walls, a domed slab roof with a periscope.
  bunker() {
    const w = 8, d = 8, out = [];
    const ring = wallRing(out, { w, d, ch: 2.3, colW: 4, y0: 0, rows: [{ kind: 'batter', h: 2.4, t: 1.4, color: C.concrete, hp: 420 }] });
    const rw = w - 2 * ring.lean;
    const roof = out.push(piece({ kind: 'frustum', role: 'roof', flat: true, x: 0, y: 2.75, z: 0, sx: rw + 0.3, sy: 0.7, sz: rw + 0.3, color: C.concrete, hp: 900, supports: ring.top, need: 0.5 })) - 1;
    out.push(piece({ kind: 'cyl', role: 'vent', detail: true, x: 0.8, y: 3.4, z: 0.6, sx: 1.2, sy: 0.6, sz: 1.2, color: C.trim, hp: 120, supports: [roof] }));
    out.push(piece({ role: 'antenna', detail: true, x: -1.2, y: 4.2, z: -0.8, sx: 0.12, sy: 2.2, sz: 0.12, color: C.steel, hp: 15, supports: [roof] }));
    return { pieces: out, footprint: { hw: w / 2, hd: d / 2 } };
  },
  // A barrier: a sloped plinth with an armour panel on top, in five sections.
  wall() {
    const len = 10, out = [], n = 5, L = len / n;
    for (let c = 0; c < n; c++) {
      const lo = out.push(piece({ kind: 'taper', x: -len / 2 + L * (c + 0.5), y: 0.65, z: 0, sx: L, sy: 1.3, sz: 0.8,
        color: C.stone, hp: 150, structural: true })) - 1;
      out.push(piece({ x: -len / 2 + L * (c + 0.5), y: 1.95, z: 0, sx: L, sy: 1.3, sz: 0.4,
        color: c % 2 ? C.panel[1] : C.panel[0], hp: 150, structural: true, supports: [lo] }));
    }
    return { pieces: out, footprint: { hw: len / 2, hd: 0.4 } };
  },
  // Bridge along local x, `len` long, deck top at local y = 0 (the building's base is the deck height).
  // Pillars go down `drop` units (to the riverbed).
  bridge(rng, { len = 20, drop = 4 } = {}) {
    const out = [], width = 5, seg = 4, n = Math.max(2, Math.round(len / seg)), L = len / n;
    const pillars = [];
    for (let k = 1; k < n; k++) {
      pillars[k] = out.push(piece({ role: 'pillar', x: -len / 2 + L * k, y: -drop / 2 - 0.3, z: 0, sx: 1.2, sy: drop, sz: 3.2,
        color: C.pillar, hp: 450, structural: true })) - 1;
    }
    for (let k = 0; k < n; k++) {
      const sup = [pillars[k], pillars[k + 1]].filter(i => i !== undefined);
      // End segments also rest on a bank (never destroyed): they fall only when shot to pieces.
      const deck = out.push(piece({ role: 'deck', flat: true, x: -len / 2 + L * (k + 0.5), y: -0.3, z: 0, sx: L - 0.05, sy: 0.6, sz: width,
        color: C.deck, hp: 220, structural: true, supports: (k === 0 || k === n - 1) ? [] : sup, need: 0.5 })) - 1;
      for (const side of [-1, 1]) {      // side rails, held up by their deck segment
        out.push(piece({ role: 'rail', x: -len / 2 + L * (k + 0.5), y: 0.35, z: side * (width / 2 - 0.15), sx: L - 0.05, sy: 0.7, sz: 0.3,
          color: C.pillar, hp: 50, supports: [deck] }));
      }
    }
    return { pieces: out, footprint: { hw: len / 2, hd: width / 2 } };
  },
};

export const BUILDING_TYPES = Object.keys(BLUEPRINTS);
// Volume of a cosine mound of height h and radius r is h * pi * r^2 * MOUND_SHAPE.
const MOUND_SHAPE = 0.5 - 2 / (Math.PI * Math.PI);

function hash(a, b) { let h = (Math.round(a * 100) * 374761393 + Math.round(b * 100) * 668265263) | 0; h = Math.imul(h ^ (h >>> 13), 1274126177); return ((h ^ (h >>> 16)) >>> 0) / 4294967295; }
function rngFor(def) { let s = Math.floor(hash(def.x, def.z) * 2 ** 31) || 1; return () => { s = (s * 16807) % 2147483647; return s / 2147483647; }; }

// Average ground height over a building's footprint.
export function footprintHeight(hf, def) {
  const fp = blueprint(def).footprint;
  const c = Math.cos(def.rot || 0), s = Math.sin(def.rot || 0);
  let sum = 0, n = 0;
  for (let u = -1; u <= 1; u += 0.5) for (let v = -1; v <= 1; v += 0.5) {
    const lx = u * fp.hw, lz = v * fp.hd;
    sum += hf.heightAt(def.x + lx * c + lz * s, def.z - lx * s + lz * c); n++;
  }
  return sum / n;
}

export function blueprint(def) {
  const bp = BLUEPRINTS[def.type];
  if (!bp) throw new Error(`unknown building type "${def.type}"`);
  return bp(rngFor(def), def);
}

// ---------- live buildings ----------
export class Buildings {
  // defs: [{ type, x, z, rot, y?, len?, drop? }]   heightAt: ground height function (for bases and rubble)
  constructor(defs, hf) {
    this.hf = hf;
    this.list = [];
    this.pieces = [];             // every piece of every building (flat, for the renderer)
    this.changed = new Set();     // piece indices whose state changed (read and cleared by the renderer)
    this.falling = [];            // pieces just destroyed: { i, vx, vy, vz, spin } (the renderer animates them)
    this.chunks = [];             // rubble chunks lying on the ground: { x, z, s, color, rot, alive }
    this.chunksChanged = false;
    this.piles = new Map();         // rubble chips per 0.8-unit cell (they stack up)
    this.brokenChanged = false;     // a piece became broken or one that was broken fell (renderer: framework)
    this._seed = 12345;
    for (const def of defs) this._add(def);
  }

  _add(def) {
    const bp = blueprint(def);
    const y = def.y ?? footprintHeight(this.hf, def);
    const c = Math.cos(def.rot || 0), s = Math.sin(def.rot || 0);
    const b = { def: { ...def }, y, first: this.pieces.length, count: bp.pieces.length, footprint: bp.footprint, state: 'intact' };
    for (const p of bp.pieces) {
      this.pieces.push({
        ...p, b: this.list.length, alive: true, maxHp: p.hp,
        px: def.x + p.x * c + p.z * s, py: y + p.y, pz: def.z - p.x * s + p.z * c, rot: (def.rot || 0) + p.yaw,
        marks: [], brk: null,
        supports: p.supports.map(k => k + b.first),
      });
    }
    this.list.push(b);
    return b;
  }

  piecesOf(b) { return this.pieces.slice(b.first, b.first + b.count); }

  // Explosion at (x, y, z). Returns rubble to add to the terrain: [{ x, z, r, h }] (bridge pieces over water
  // drop into the river and leave no mound). `power`/`radius` from BUILDING_DAMAGE.
  blast(x, y, z, { power, radius }) {
    const hit = new Set();
    this.lastHit = [];            // pieces damaged by this blast (for fire and debris effects)
    for (const b of this.list) {
      const fr = Math.hypot(b.footprint.hw, b.footprint.hd) + radius + 6;
      if (Math.hypot(b.def.x - x, b.def.z - z) > fr) continue;
      for (let i = b.first; i < b.first + b.count; i++) {
        const p = this.pieces[i];
        if (!p.alive) continue;
        const half = Math.max(p.sx, p.sy, p.sz) / 2;
        const d = Math.max(0, Math.hypot(p.px - x, p.py - y, p.pz - z) - half);
        if (d >= radius) continue;
        const dmg = power * (1 - d / radius) ** 2;
        p.hp -= dmg;
        this.changed.add(i);
        this.lastHit.push(i);
        if (p.hp <= 0) this._destroy(i, x, y, z);
        else this._scar(p, x, y, z, dmg, radius);
        hit.add(p.b);
      }
    }
    for (const bi of hit) this._settle(this.list[bi]);
    return this._takeRubble();
  }

  // A hit that doesn't destroy a piece: (1) a blast mark where it struck, (2) below half strength the piece is
  // broken (a jagged hole showing its framework), and chips of it pile up at the foot of the wall.
  _scar(p, x, y, z, dmg, radius) {
    const c = Math.cos(p.rot), s = Math.sin(p.rot), dx = x - p.px, dy = y - p.py, dz = z - p.pz;
    const h = [p.sx / 2, p.sy / 2, p.sz / 2];
    const l = [dx * c - dz * s, dy, dx * s + dz * c].map((v, k) => Math.max(-h[k], Math.min(h[k], v)));
    // Inside the piece: out to its nearest face.
    if (l.every((v, k) => Math.abs(v) < h[k])) { const k = [0, 1, 2].sort((a, b) => (h[a] - Math.abs(l[a])) - (h[b] - Math.abs(l[b])))[0]; l[k] = Math.sign(l[k] || 1) * h[k]; }
    const big = radius > 1.5;
    if (big || this._rand() < 0.35) {
      const r = Math.min(1.7, radius * 0.32) * (0.8 + 0.4 * this._rand());
      const m = p.marks.find(m => Math.hypot(m[0] - l[0], m[1] - l[1], m[2] - l[2]) < m[3] * 0.4);
      if (m) m[3] = Math.min(2, Math.max(m[3], r) * 1.1);
      else { p.marks.push([l[0], l[1], l[2], r]); if (p.marks.length > 4) p.marks.shift(); }
    }
    if (!p.brk && p.hp < p.maxHp * BUILDING.brokenFrac && p.kind !== 'wedge' && !p.detail) {
      const fu = p.sx, fv = p.flat ? p.sz : p.sy, u = l[0], v = p.flat ? l[2] : l[1];
      const r = 0.3 * (fu + fv), cl = (a, f) => Math.max(-f * 0.3, Math.min(f * 0.3, a));
      p.brk = [cl(u, fu), cl(v, fv), r, (p.flat ? -1 : 1) * (1 + this._rand() * 50)];
      this.brokenChanged = true;
      this._chips(p, x, z, 8 + Math.round(p.sx * p.sy * p.sz * 2));
    }
    this._chips(p, x, z, dmg / p.maxHp * 6 * Math.min(2, p.sx * p.sy * 0.5));
  }

  // Small chips of a piece, lying at the foot of its wall (on the side that was hit), piling up over time.
  _chips(p, bx, bz, n) {
    if (p.flat || p.role === 'deck' || p.role === 'pillar' || p.role === 'rail') return;
    let k = Math.floor(n) + (this._rand() < n % 1 ? 1 : 0);
    if (!k) return;
    const c = Math.cos(p.rot), s = Math.sin(p.rot);
    // Which side of the piece the blast was on (its local z).
    const side = ((bx - p.px) * s + (bz - p.pz) * c) < 0 ? -1 : 1;
    for (; k > 0; k--) {
      const along = (this._rand() - 0.5) * p.sx, out = side * (p.sz / 2 + 0.2 + this._rand() * this._rand() * 1.6);
      const x = p.px + along * c + out * s, z = p.pz - along * s + out * c;
      const key = Math.round(x / 0.8) * 4096 + Math.round(z / 0.8), pile = this.piles.get(key) || 0;
      this.piles.set(key, pile + 1);
      this.chunks.push({ x, z, s: 0.14 + 0.2 * this._rand(), color: p.color, rot: this._rand() * 6.283, lift: Math.min(1.1, pile * 0.055), alive: true });
    }
    if (this.chunks.length > 5000) this.chunks = this.chunks.filter(c => c.alive).slice(-4000);
    this.chunksChanged = true;
  }

  _rand() { this._seed = (this._seed * 16807) % 2147483647; return this._seed / 2147483647; }

  // Destroy a piece directly (tests, scripted events).
  destroy(i) { this._destroy(i, this.pieces[i].px, this.pieces[i].py - 3, this.pieces[i].pz); this._settle(this.list[this.pieces[i].b]); return this._takeRubble(); }

  _destroy(i, bx, by, bz) {
    const p = this.pieces[i];
    if (!p.alive) return;
    p.alive = false;
    p.hp = 0;
    if (p.brk) this.brokenChanged = true;
    this.changed.add(i);
    // Thrown away from the blast a little, then falls.
    const dx = p.px - bx, dz = p.pz - bz, l = Math.hypot(dx, dz) || 1;
    this.falling.push({ i, vx: dx / l * 2.5, vy: 1.5 + Math.max(0, p.py - by) * 0.2, vz: dz / l * 2.5, spin: (hash(p.px, p.pz) - 0.5) * 6 });
    (this._rubble ||= []).push(i);
  }

  // Collapse anything no longer held up, then update the building's state.
  _settle(b) {
    let changed = true;
    while (changed) {
      changed = false;
      for (let i = b.first; i < b.first + b.count; i++) {
        const p = this.pieces[i];
        if (!p.alive || !p.supports.length) continue;
        const ok = p.supports.filter(k => this.pieces[k].alive).length / p.supports.length;
        if (ok < p.need || ok === 0) { this._destroy(i, p.px, p.py + 2, p.pz); changed = true; }
      }
    }
    const ps = this.piecesOf(b), structural = ps.filter(p => p.structural);
    const frac = structural.length ? structural.filter(p => p.alive).length / structural.length : 1;
    if (b.def.type === 'bridge') {
      b.state = ps.every(p => p.alive) ? 'intact' : ps.some(p => p.role === 'deck' && !p.alive) ? 'broken' : 'damaged';
      return;
    }
    if (frac < BUILDING.rubbleFrac) {
      for (let i = b.first; i < b.first + b.count; i++) if (this.pieces[i].alive) this._destroy(i, this.pieces[i].px, this.pieces[i].py + 2, this.pieces[i].pz);
    }
    const alive = ps.filter(p => p.alive);
    b.state = alive.length === ps.length ? 'intact'
      : !alive.some(p => p.structural) ? 'rubble'
      : frac < BUILDING.ruinFrac || ps.some(p => p.role === 'roof' && !p.alive) ? 'ruin' : 'damaged';
  }

  _takeRubble() {
    const out = [];
    for (const i of this._rubble || []) {
      const p = this.pieces[i], b = this.list[p.b];
      if (b.def.type === 'bridge' && p.role !== 'pillar') {
        // Deck over water falls into the river: no mound. Over land (the ends): small heap.
        const ground = this.hf.heightAt(p.px, p.pz);
        if (p.py - ground > 2) continue;
      }
      const vol = p.sx * p.sy * p.sz * BUILDING.rubbleBulk;
      const r = Math.max(p.sx, p.sz) * 0.6 + 1.2;
      out.push({ x: p.px, z: p.pz, r, h: vol / (Math.PI * r * r * MOUND_SHAPE) });
      // A few loose chunks in the piece's colour, so the heap reads as rubble.
      const n = Math.max(1, Math.min(6, Math.round(vol * 1.2)));
      for (let k = 0; k < n; k++) {
        const a = hash(p.px + k, p.pz) * 6.283, d = Math.sqrt(hash(p.pz, p.px + k)) * r * 0.7;
        this.chunks.push({ x: p.px + Math.cos(a) * d, z: p.pz + Math.sin(a) * d, s: 0.35 + 0.5 * hash(k, p.px), color: p.color, rot: a * 3, alive: true });
      }
      this.chunksChanged = true;
    }
    this._rubble = [];
    return out;
  }

  // A crater blows away rubble chunks lying in it.
  clearChunks(x, z, r) {
    for (const c of this.chunks) if (c.alive && (c.x - x) ** 2 + (c.z - z) ** 2 < r * r) { c.alive = false; this.chunksChanged = true; }
    for (const k of this.piles.keys()) { const cx = Math.round(k / 4096), cz = k - cx * 4096; if ((cx * 0.8 - x) ** 2 + (cz * 0.8 - z) ** 2 < r * r) this.piles.delete(k); }
  }

  // Deck top height if (x, z) is on a standing bridge deck segment, else null (units walk on it later).
  deckAt(x, z) {
    for (const b of this.list) {
      if (b.def.type !== 'bridge') continue;
      for (let i = b.first; i < b.first + b.count; i++) {
        const p = this.pieces[i];
        if (p.role !== 'deck' || !p.alive) continue;
        if (inBox(p, x, z, 0)) return p.py + p.sy / 2;
      }
    }
    return null;
  }

  // True if a standing wall / block / pillar stands at (x, z) (an obstacle for movement, milestone 6).
  blockedAt(x, z, pad = 0) {
    for (const b of this.list) {
      if (Math.hypot(b.def.x - x, b.def.z - z) > Math.hypot(b.footprint.hw, b.footprint.hd) + pad + 1) continue;
      for (let i = b.first; i < b.first + b.count; i++) {
        const p = this.pieces[i];
        if (p.alive && p.structural && p.role !== 'deck' && p.role !== 'pillar' && p.py - p.sy / 2 < this.hf.heightAt(p.px, p.pz) + 1.5 && inBox(p, x, z, pad)) return true;
      }
    }
    return false;
  }

  // Height of the top of the standing pieces over (x, z) (walls, roofs, blocks; not bridge decks), or -Infinity.
  // Thin panels count as at least 0.6 thick, so sight lines sampled every 0.5 can't slip through them.
  // Line of sight uses this: shots can't pass through standing walls.
  topAt(x, z) {
    let top = -Infinity;
    for (const b of this.list) {
      if (b.def.type === 'bridge') continue;
      if (Math.hypot(b.def.x - x, b.def.z - z) > Math.hypot(b.footprint.hw, b.footprint.hd) + 1) continue;
      for (let i = b.first; i < b.first + b.count; i++) {
        const p = this.pieces[i];
        if (p.alive && p.role !== 'floor' && !p.detail && inBox(p, x, z, Math.max(0, 0.3 - Math.min(p.sx, p.sz) / 2))) top = Math.max(top, p.py + p.sy / 2);
      }
    }
    return top;
  }

  // Building containing (x, z) in its footprint, or null.
  at(x, z) {
    for (let k = this.list.length - 1; k >= 0; k--) {
      const b = this.list[k];
      const c = Math.cos(b.def.rot || 0), s = Math.sin(b.def.rot || 0), dx = x - b.def.x, dz = z - b.def.z;
      if (Math.abs(dx * c - dz * s) <= b.footprint.hw && Math.abs(dx * s + dz * c) <= b.footprint.hd) return k;
    }
    return -1;
  }

  counts() {
    const c = { intact: 0, damaged: 0, ruin: 0, rubble: 0, broken: 0 };
    for (const b of this.list) c[b.state]++;
    return c;
  }

  defs() { return this.list.map(b => ({ ...b.def })); }
}

function inBox(p, x, z, pad) {
  const c = Math.cos(p.rot), s = Math.sin(p.rot), dx = x - p.px, dz = z - p.pz;
  return Math.abs(dx * c - dz * s) <= p.sx / 2 + pad && Math.abs(dx * s + dz * c) <= p.sz / 2 + pad;
}

// ---------- terrain helpers (placement and rubble) ----------
// Raise a smooth rubble mound and paint it as rubble.
export function addRubble(hf, surface, { x, z, r, h }) {
  const { i0, i1, j0, j1 } = hf.rect(x, z, r);
  for (let j = j0; j <= j1; j++) for (let i = i0; i <= i1; i++) {
    const d = Math.hypot(hf.wx(i) - x, hf.wz(j) - z) / r;
    if (d >= 1) continue;
    const k = j * hf.verts + i;
    hf.h[k] += h * (1 + Math.cos(Math.PI * d)) / 2;
    if (d < 0.8) surface.base[k] = SURFACE.RUBBLE;
  }
  hf.changed(i0, j0, i1, j1);
  surface.changed(i0, j0, i1, j1);
}

// Flatten the ground under a building's footprint (plus a blended margin) to its average height.
export function flattenFootprint(hf, def, margin = 3) {
  const fp = blueprint(def).footprint, y = footprintHeight(hf, def);
  const c = Math.cos(def.rot || 0), s = Math.sin(def.rot || 0);
  const R = Math.hypot(fp.hw, fp.hd) + margin;
  const { i0, i1, j0, j1 } = hf.rect(def.x, def.z, R);
  for (let j = j0; j <= j1; j++) for (let i = i0; i <= i1; i++) {
    const dx = hf.wx(i) - def.x, dz = hf.wz(j) - def.z;
    const u = Math.abs(dx * c - dz * s) - fp.hw, v = Math.abs(dx * s + dz * c) - fp.hd;
    const out = Math.hypot(Math.max(0, u), Math.max(0, v));          // distance outside the footprint
    if (out >= margin) continue;
    const t = out <= 0 ? 1 : 1 - out / margin;
    const k = j * hf.verts + i;
    hf.h[k] += (y - hf.h[k]) * t * t * (3 - 2 * t);
  }
  hf.changed(i0, j0, i1, j1);
  return y;
}

// Fit a bridge across water at (x, z): try directions, pick the shortest span; deck at the bank height.
// Returns a def { type: 'bridge', x, z, rot, len, drop, y } or null if there's no water here.
export function fitBridge(hf, water, x, z, rot = null) {
  const wet = (px, pz) => water.levelAt(px, pz) > hf.heightAt(px, pz);
  if (!wet(x, z)) return null;
  const span = (a) => {
    const dx = Math.cos(a), dz = -Math.sin(a);      // local +x direction for rotation a
    let t1 = 0, t2 = 0;
    while (t1 < 60 && wet(x + dx * t1, z + dz * t1)) t1 += 0.5;
    while (t2 < 60 && wet(x - dx * t2, z - dz * t2)) t2 += 0.5;
    return { a, t1, t2, len: t1 + t2 };
  };
  let best = null;
  if (rot !== null) best = span(rot);
  else for (let k = 0; k < 24; k++) { const s = span(k * Math.PI / 24); if (!best || s.len < best.len) best = s; }
  if (best.len >= 118) return null;
  const margin = 3.5, len = best.len + 2 * margin;
  const dx = Math.cos(best.a), dz = -Math.sin(best.a);
  const cx = x + dx * (best.t1 - best.t2) / 2, cz = z + dz * (best.t1 - best.t2) / 2;
  const endA = hf.heightAt(cx + dx * len / 2, cz + dz * len / 2), endB = hf.heightAt(cx - dx * len / 2, cz - dz * len / 2);
  const y = Math.max(endA, endB, water.levelAt(cx, cz) + 1.2) + 0.3;
  let bed = Infinity;
  for (let t = -best.len / 2; t <= best.len / 2; t += 1) bed = Math.min(bed, hf.heightAt(cx + dx * t, cz + dz * t));
  return { type: 'bridge', x: cx, z: cz, rot: best.a, len: Math.round(len * 10) / 10, drop: Math.max(2, y - bed + 0.5), y };
}

// Bridges wherever a road crosses water (import and v2 maps). Returns defs.
export function autoBridges(hf, surface, water) {
  const V = hf.verts, seen = new Uint8Array(V * V), out = [];
  const isX = k => (surface.features[k] & FEATURE.WATER) && surface.base[k] === SURFACE.ROAD;
  for (let k0 = 0; k0 < V * V; k0++) {
    if (seen[k0] || !isX(k0)) continue;
    let sx = 0, sz = 0, n = 0; const stack = [k0]; seen[k0] = 1;
    while (stack.length) {
      const k = stack.pop(), i = k % V, j = (k - i) / V;
      sx += hf.wx(i); sz += hf.wz(j); n++;
      for (const q of [k - 1, k + 1, k - V, k + V]) if (q >= 0 && q < V * V && !seen[q] && isX(q)) { seen[q] = 1; stack.push(q); }
    }
    if (n < 6) continue;
    const cx = sx / n, cz = sz / n;
    // Road direction: principal axis of nearby dry road samples.
    let mxx = 0, mzz = 0, mxz = 0, m = 0;
    const { i0, i1, j0, j1 } = hf.rect(cx, cz, 14);
    for (let j = j0; j <= j1; j++) for (let i = i0; i <= i1; i++) {
      const k = j * V + i;
      if (surface.base[k] !== SURFACE.ROAD || (surface.features[k] & FEATURE.WATER)) continue;
      const dx = hf.wx(i) - cx, dz = hf.wz(j) - cz;
      if (dx * dx + dz * dz > 196) continue;
      mxx += dx * dx; mzz += dz * dz; mxz += dx * dz; m++;
    }
    const rot = m ? -0.5 * Math.atan2(2 * mxz, mxx - mzz) : null;      // angle of the major axis (our rot convention)
    const def = fitBridge(hf, water, cx, cz, rot) || fitBridge(hf, water, cx, cz);
    if (def) out.push(def);
  }
  return out;
}

// Fill BUILDING feature areas with houses (and a factory where a lot is big), skipping lots that already have
// buildings. Returns new defs (the caller flattens their footprints).
export function fillLots(hf, surface, existing = []) {
  const V = hf.verts, seen = new Uint8Array(V * V), out = [];
  const occupied = (x, z, r) => [...existing, ...out].some(d => Math.hypot(d.x - x, d.z - z) < r);
  for (let k0 = 0; k0 < V * V; k0++) {
    if (seen[k0] || !(surface.features[k0] & FEATURE.BUILDING)) continue;
    let minX = Infinity, maxX = -Infinity, minZ = Infinity, maxZ = -Infinity;
    const cells = [], stack = [k0]; seen[k0] = 1;
    while (stack.length) {
      const k = stack.pop(), i = k % V, j = (k - i) / V, x = hf.wx(i), z = hf.wz(j);
      cells.push(k);
      minX = Math.min(minX, x); maxX = Math.max(maxX, x); minZ = Math.min(minZ, z); maxZ = Math.max(maxZ, z);
      for (const q of [k - 1, k + 1, k - V, k + V]) if (q >= 0 && q < V * V && !seen[q] && (surface.features[q] & FEATURE.BUILDING)) { seen[q] = 1; stack.push(q); }
    }
    const inLot = (x, z) => { const q = hf.index(Math.round(hf.gx(x)), Math.round(hf.gz(z))); return !!(surface.features[q] & FEATURE.BUILDING); };
    const w = maxX - minX, d = maxZ - minZ;
    if (Math.max(w, d) >= 20 && Math.min(w, d) >= 15) {           // big lot: one factory
      if (!occupied((minX + maxX) / 2, (minZ + maxZ) / 2, 8)) out.push({ type: 'factory', x: (minX + maxX) / 2, z: (minZ + maxZ) / 2, rot: w >= d ? 0 : Math.PI / 2 });
      continue;
    }
    for (let z = minZ + 4; z <= maxZ - 3; z += 9) for (let x = minX + 5; x <= maxX - 4; x += 11) {
      if (!inLot(x - 4, z - 3) || !inLot(x + 4, z + 3) || occupied(x, z, 7)) continue;
      out.push({ type: 'house', x, z, rot: ((Math.round(x * 3 + z * 7) % 2) ? 0 : Math.PI) });
    }
  }
  return out;
}
