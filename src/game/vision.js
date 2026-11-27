// Fog of war (CLAUDE.md §13): what each side can see. Pure: no three.js.
//
// Two things are tracked:
//   - Mechs and structures: an enemy is seen by a side while one of that side's units has a clear line of sight
//     to it within its sight range (Units._findTargets marks e.seenBy[team]; the same line of sight as combat).
//   - The ground, on a grid (VISION.cell units per cell), for drawing the fog: `visible` (seen right now) and
//     `explored` (ever seen). Each viewer casts rays outward over the terrain and standing walls, remembering the
//     steepest angle so far (a horizon): a cell counts as seen if something mech-sized standing on it would show
//     above that horizon. So hills, ridges and walls cast "shadows" you can't see into, as with mechs.
// Trees don't block sight (as in combat; they give cover instead).
import { VISION, MAP_SIZE } from '../config.js';

export class Vision {
  // world: { hf, buildings }   units: Units   teams: which sides to compute the ground grid for (default the player)
  constructor(world, units, { teams = [0] } = {}) {
    this.world = world;
    this.units = units;
    this.teams = teams;
    this.n = Math.round(MAP_SIZE / VISION.cell);
    this.cell = MAP_SIZE / this.n;
    const N = this.n * this.n;
    this.visible = [new Uint8Array(N), new Uint8Array(N)];
    this.explored = [new Uint8Array(N), new Uint8Array(N)];
    // Tops of standing walls / roofs on a 1-unit grid (rebuilt when buildings change), so rays don't loop over
    // every building at every step.
    this.bn = Math.round(MAP_SIZE);
    this.bTop = new Float32Array(this.bn * this.bn).fill(-Infinity);
    this._bSig = -1;
    this.t = Infinity;
    this.pass = null;
    this.stats = { ms: 0, rays: 0, perStep: 0 };
  }

  idx(x, z) {
    const i = Math.max(0, Math.min(this.n - 1, Math.floor((x / MAP_SIZE + 0.5) * this.n)));
    const j = Math.max(0, Math.min(this.n - 1, Math.floor((z / MAP_SIZE + 0.5) * this.n)));
    return j * this.n + i;
  }
  isVisible(team, x, z) { return this.visible[team][this.idx(x, z)] === 1; }
  isExplored(team, x, z) { return this.explored[team][this.idx(x, z)] === 1; }
  // Is this mech or structure seen by `team` right now? (Own units always.)
  sees(team, u) { return u.team === team || u.seenBy[team] > this.units.time; }

  // Rebuild the wall-top grid if any building piece changed state.
  _buildingTops() {
    const B = this.world.buildings;
    if (!B) return;
    let sig = B.list.length * 7919;
    for (const p of B.pieces) if (p.alive) sig++;
    if (sig === this._bSig) return;
    this._bSig = sig;
    const g = this.bTop, n = this.bn, h = MAP_SIZE / 2;
    g.fill(-Infinity);
    for (const p of B.pieces) {
      if (!p.alive || p.detail || p.role === 'floor' || p.role === 'deck' || p.role === 'pillar') continue;
      const r = Math.hypot(p.sx, p.sz) / 2, top = p.py + p.sy / 2;
      const i0 = Math.max(0, Math.floor(p.px - r + h)), i1 = Math.min(n - 1, Math.floor(p.px + r + h));
      const j0 = Math.max(0, Math.floor(p.pz - r + h)), j1 = Math.min(n - 1, Math.floor(p.pz + r + h));
      const c = Math.cos(p.rot || 0), s = Math.sin(p.rot || 0);
      for (let j = j0; j <= j1; j++) for (let i = i0; i <= i1; i++) {
        // Cell centre inside the piece's rotated box?
        const dx = i + 0.5 - h - p.px, dz = j + 0.5 - h - p.pz;
        const lx = dx * c - dz * s, lz = dx * s + dz * c;
        if (Math.abs(lx) <= p.sx / 2 + 0.35 && Math.abs(lz) <= p.sz / 2 + 0.35) { const k = j * n + i; if (top > g[k]) g[k] = top; }
      }
    }
  }

  // Height that blocks sight at (x, z): the ground, or the top of a standing wall there.
  _occ(x, z) {
    const g = this.world.hf.heightAt(x, z), n = this.bn, h = MAP_SIZE / 2;
    const i = Math.floor(x + h), j = Math.floor(z + h);
    if (i < 0 || j < 0 || i >= n || j >= n) return g;
    const t = this.bTop[j * n + i];
    return t > g ? t : g;
  }

  // Recompute the ground grids from every viewer, every VISION.update seconds. The work is spread over the
  // simulation steps in between (a few viewers each step, into a back buffer that is swapped in when complete),
  // so a big battle doesn't cause a hitch. force: do a whole pass now. Returns true when a pass completes.
  update(dt = Infinity, force = false) {
    this.t += dt;
    if (force) { this._start(); this._work(Infinity); return true; }
    if (!this.pass && this.t >= VISION.update) this._start();
    if (!this.pass) return false;
    const steps = Math.max(1, Math.round(VISION.update / Math.max(1e-3, Math.min(dt, VISION.update))) - 1);
    return this._work(Math.ceil(this.pass.list.length / steps));
  }

  _start() {
    this.t = 0;
    this._buildingTops();
    const list = [];
    for (const team of this.teams) for (const lst of [this.units.list, this.units.structures]) for (const u of lst) {
      if (u.alive && u.team === team && !(u.built !== undefined && u.built < 1)) list.push(u);
    }
    this.back ||= [new Uint8Array(this.n * this.n), new Uint8Array(this.n * this.n)];
    for (const team of this.teams) this.back[team].fill(0);
    this.pass = { list, i: 0, rays: 0, ms: 0 };
  }

  _work(count) {
    const P = this.pass, t0 = performance.now();
    for (let k = 0; k < count && P.i < P.list.length; k++, P.i++) {
      const u = P.list[P.i];
      if (u.alive) P.rays += this._cast(u, this.back[u.team]);
    }
    P.ms += performance.now() - t0;
    if (P.i < P.list.length) return false;
    for (const team of this.teams) {
      const done = this.back[team];
      this.back[team] = this.visible[team];
      this.visible[team] = done;
      const exp = this.explored[team];
      for (let k = 0; k < done.length; k++) if (done[k]) exp[k] = 1;
    }
    this.stats = { ms: P.ms, rays: P.rays, perStep: P.ms / Math.max(1, Math.round(VISION.update * 60)) };
    this.pass = null;
    return true;
  }

  // Cast rays round one viewer, marking visible cells.
  _cast(u, vis) {
    const R = u.t.sight || VISION.defaultSight, C = this.cell, step = C * 0.75;
    const eye = u.y + u.height * 0.8;
    const rays = Math.max(24, Math.ceil(2 * Math.PI * R / C));
    // Its own surroundings are always seen.
    const near = Math.max(u.radius + 1, C * 1.5);
    for (let a = 0; a < 6.283; a += 0.5) vis[this.idx(u.x + Math.cos(a) * near * 0.7, u.z + Math.sin(a) * near * 0.7)] = 1;
    vis[this.idx(u.x, u.z)] = 1;
    for (let r = 0; r < rays; r++) {
      const a = r / rays * Math.PI * 2, dx = Math.cos(a), dz = Math.sin(a);
      let horizon = -Infinity;
      for (let d = step; d <= R; d += step) {
        const x = u.x + dx * d, z = u.z + dz * d;
        if (Math.abs(x) > MAP_SIZE / 2 || Math.abs(z) > MAP_SIZE / 2) break;
        const g = this._occ(x, z);
        // Something VISION.targetHeight tall standing here: does its top clear the horizon?
        if ((g + VISION.targetHeight - eye) / d >= horizon) vis[this.idx(x, z)] = 1;
        const s = (g - eye) / d;
        if (s > horizon) horizon = s;
      }
    }
    return rays;
  }

  clear() {
    for (let t = 0; t < 2; t++) { this.visible[t].fill(0); this.explored[t].fill(0); }
    this.t = Infinity;
    this._bSig = -1;
    this.pass = null;
  }
}
