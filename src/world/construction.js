// Construction by Builders: walls, auto turrets and trenches (see BUILD in config.js). Pure: no three.js.
//
// A job is one wall (10 units), one turret, or one 10-unit length of trench; a line drawn with a finger is split
// into several jobs. Jobs are paid for when ordered. Each Builder works through its own list of jobs in order:
// it walks to the site and works on it; several Builders on the same job share the work. New orders queue up
// behind the current ones. A job stays on the map
// as a site until it is finished, so if its Builders are sent elsewhere (or destroyed), tapping the site with
// Builders selected sets them back to work on it.
//   wall:   appears as a building (world.buildings) when finished; it blocks movement and line of sight.
//   turret: a structure (units.structures) that rises out of the ground as it is built and starts shooting
//           when finished. It can be shot at while being built.
//   trench: dug progressively as the Builder works along it. The spoil is heaped on the side facing the enemy.
// Kinds are a table (BUILD), so new things to build (e.g. factories) slot in the same way.
//
// Repair: a Builder ordered to repair a friendly mech, turret or HQ walks over and mends it (UNIT_TYPES.builder.repair
// hp per second; several Builders add up) until it is whole. An idle Builder does this by itself for damaged
// friendly units within BUILD.repairAuto. Repairs are free.
import { BUILD, MAP_SIZE } from '../config.js';
import { FEATURE } from '../terrain/surface.js';
import { flattenFootprint } from './buildings.js';

let nextJob = 1;
export const newJobId = () => nextJob++;

export class Construction {
  // world: { hf, surface, water, buildings, nav, units }   pay(team, cost): true if paid (sandbox: always)
  // onBuilding(): called after a wall is added to world.buildings (the view redraws them)
  constructor(world, { pay = () => true, onBuilding = () => {}, enemyDir = team => (team === 0 ? -1 : 1) } = {}) {
    this.world = world;
    this.pay = pay;
    this.onBuilding = onBuilding;
    this.enemyDir = enemyDir;        // which way (z) the enemy is from a team: spoil banks face that way
    this.jobs = [];
    this.events = [];                // { type: 'built' | 'work', job, x, y, z } for the view and HUD
  }

  get units() { return this.world.units; }

  // Plan jobs for a line from a to b (or a single piece at a when b is null / too close). Returns
  // [{ kind, x, z, rot, ax, az, bx, bz, len, ok }]: ok = false where it can't be built.
  plan(kind, ax, az, bx = null, bz = null, defaultRot = 0) {
    const spec = BUILD[kind], out = [];
    if (kind === 'turret') { out.push({ kind, x: ax, z: az, rot: 0, ok: this._siteOk(kind, ax, az) }); return out; }
    let dx = bx === null ? 0 : bx - ax, dz = bz === null ? 0 : bz - az, L = Math.hypot(dx, dz);
    if (L < spec.len * 0.5) {
      // A single piece centred on a, across the view (defaultRot).
      dx = Math.cos(defaultRot); dz = -Math.sin(defaultRot); L = spec.len;
      ax -= dx * L / 2; az -= dz * L / 2;
    } else { dx /= L; dz /= L; }
    const n = Math.max(1, Math.round(L / spec.len)), seg = L / n, rot = Math.atan2(-dz, dx);
    for (let k = 0; k < n; k++) {
      const sx = ax + dx * seg * k, sz = az + dz * seg * k, ex = sx + dx * seg, ez = sz + dz * seg;
      const x = (sx + ex) / 2, z = (sz + ez) / 2;
      out.push({ kind, x, z, rot, ax: sx, az: sz, bx: ex, bz: ez, len: seg, capA: k === 0, capB: k === n - 1, ok: this._siteOk(kind, x, z, sx, sz, ex, ez) });
    }
    return out;
  }

  // Can this be built here? Not in water, not off the map, not on buildings, HQs, turrets or other sites.
  _siteOk(kind, x, z, ax = x, az = z, bx = x, bz = z) {
    const { water, buildings, nav } = this.world, L = MAP_SIZE / 2 - 3;
    const n = Math.max(1, Math.ceil(Math.hypot(bx - ax, bz - az)));
    for (let k = 0; k <= n; k++) {
      const px = ax + (bx - ax) * k / n, pz = az + (bz - az) * k / n;
      if (Math.abs(px) > L || Math.abs(pz) > L) return false;
      if (water && water.depthAt(px, pz) > 0.05) return false;
      if (kind !== 'trench' && buildings && buildings.blockedAt(px, pz, 0.5)) return false;
      if (nav?._blocker(px, pz)) return false;
      if (nav && nav.slope && nav.slope[nav.idx(px, pz)] > 1.2 && kind !== 'trench') return false;
    }
    for (const j of this.jobs) {
      if (j.done) continue;
      const d = j.kind === 'turret' || kind === 'turret' ? 3.5 : 1.5;
      if (segDist(x, z, j) < d && (kind !== 'trench' || j.kind !== 'trench')) return false;
    }
    return true;
  }

  // Order Builders to build a planned line. Pays for as many pieces as can be afforded.
  // Returns { jobs, refused: 'poor' | 'bv' | 'site' | null }. pay(team, cost, kind) returns true, false (too poor)
  // or a reason ('bv': over the Battle Value limit).
  order(builders, plan) {
    builders = builders.filter(u => u.alive && u.jobs);
    if (!builders.length) return { jobs: [], refused: null };
    const team = builders[0].team, jobs = [];
    let refused = null;
    for (const p of plan) {
      if (!p.ok) { refused = refused || 'site'; continue; }
      const paid = this.pay(team, BUILD[p.kind].cost, p.kind);
      if (paid !== true) { refused = paid || 'poor'; break; }
      const j = { id: nextJob++, ...p, team, progress: 0, done: false, structure: null, dug: 0 };
      if (j.kind === 'trench') this._trenchRef(j);
      this.jobs.push(j);
      jobs.push(j);
    }
    if (jobs.length) this.assign(builders, jobs, true);
    return { jobs, refused };
  }

  // Put Builders to work on these jobs. append: after the work they are already doing (new orders queue up);
  // otherwise these first (a tapped site), then the rest of their list.
  assign(builders, jobs, append = false) {
    for (const u of builders) {
      if (!u.alive || !u.jobs) continue;
      const had = u.order === 'build' ? u.jobs.filter(j => !j.done && !jobs.includes(j)) : [];
      u.jobs = append ? [...had, ...jobs.filter(j => !j.done)] : [...jobs.filter(j => !j.done), ...had];
      u.order = 'build'; u.goal = null; u.attackTarget = null;
      u.workT = 0;
    }
  }

  // The unfinished site under (x, z) for a team, or null.
  siteAt(x, z, team) {
    let best = null, bd = 3;
    for (const j of this.jobs) {
      if (j.done || j.team !== team) continue;
      const d = segDist(x, z, j);
      if (d < bd) { bd = d; best = j; }
    }
    return best;
  }

  step(dt) {
    const units = this.units;
    for (const u of units.list) {
      if (!u.jobs || !u.alive) continue;
      if (u.order === 'repair') { this._repair(u, dt); continue; }
      if (u.order !== 'build') {
        if (u.jobs.length) u.jobs = [];
        u.working = false;
        if (u.order === 'idle' && (u.repairLook = (u.repairLook || 0) - dt) <= 0) {
          u.repairLook = 0.5;
          const t = this._damagedNear(u, BUILD.repairAuto);
          if (t) { u.order = 'repair'; u.repairTarget = t; u.repairAuto = true; u.workT = 0; }
        }
        continue;
      }
      while (u.jobs.length && u.jobs[0].done) u.jobs.shift();
      const j = u.jobs[0];
      u.working = false;
      if (!j) { units.stop([u]); continue; }
      const spot = this._spot(j, u);
      const d = Math.hypot(spot.x - u.x, spot.z - u.z);
      if (d > BUILD.reach) {
        // Walk there (re-plan now and then in case it was pushed away).
        if ((u.workT -= dt) <= 0 || u.mover.state === 'idle') { u.workT = 2; units.movers.order([u.mover], spot.x, spot.z); }
        continue;
      }
      if (u.mover.state !== 'idle') units.movers.stop(u.mover);
      u.working = true;
      // Face the work.
      const tx = j.kind === 'trench' ? spot.wx : j.x, tz = j.kind === 'trench' ? spot.wz : j.z;
      u.yaw = Math.atan2(tx - u.x, tz - u.z);
      u.torsoYaw = Math.sin(units.time * 5 + u.id) * 0.35;
      this._work(j, dt / BUILD[j.kind].work);
      if (Math.random() < dt * 4) this.events.push({ type: 'work', job: j, x: tx, y: this.world.hf.heightAt(tx, tz) + 0.4, z: tz, kind: j.kind });
    }
  }

  // Order Builders to repair a friendly unit or structure.
  repair(builders, target) {
    for (const u of builders) {
      if (!u.alive || !u.jobs || u === target || u.team !== target.team) continue;
      u.order = 'repair'; u.repairTarget = target; u.repairAuto = false; u.goal = null; u.attackTarget = null; u.workT = 0; u.defend = false;
      u.jobs = [];
    }
  }

  // The most damaged friendly unit or structure within r of a Builder (not itself), or null.
  _damagedNear(u, r) {
    let best = null, bf = 0.999;
    for (const lst of [this.units.list, this.units.structures]) for (const o of lst) {
      if (o === u || !o.alive || o.team !== u.team || (o.built !== undefined && o.built < 1)) continue;
      const f = o.hp / o.maxHp;
      if (f < bf && Math.hypot(o.x - u.x, o.z - u.z) - o.radius < r) { bf = f; best = o; }
    }
    return best;
  }

  _repair(u, dt) {
    const t = u.repairTarget, units = this.units;
    u.working = false;
    if (!t || !t.alive || t.hp >= t.maxHp) {
      // Done (or it was destroyed). An automatic repair goes back to guarding; an ordered one holds there.
      u.repairTarget = null;
      units.stop([u]);
      if (u.repairAuto) u.hold = false;
      return;
    }
    const d = Math.hypot(t.x - u.x, t.z - u.z) - t.radius - u.radius;
    if (d > 1.6) {
      if ((u.workT -= dt) <= 0 || u.mover.state === 'idle') {
        u.workT = 1;
        const a = Math.atan2(u.x - t.x, u.z - t.z), r = t.radius + u.radius + 0.8;
        units.movers.order([u.mover], t.x + Math.sin(a) * r, t.z + Math.cos(a) * r);
      }
      if (u.repairAuto && d > BUILD.repairAuto * 1.5) { u.repairTarget = null; units.stop([u]); u.hold = false; }
      return;
    }
    if (u.mover.state !== 'idle') units.movers.stop(u.mover);
    u.working = true;
    u.yaw = Math.atan2(t.x - u.x, t.z - u.z);
    u.torsoYaw = Math.sin(units.time * 5 + u.id) * 0.35;
    t.hp = Math.min(t.maxHp, t.hp + u.t.repair * dt);
    if (Math.random() < dt * 5) this.events.push({ type: 'work', kind: 'repair', x: t.x + (Math.random() - 0.5) * t.radius, y: t.y + t.height * (0.3 + Math.random() * 0.5), z: t.z + (Math.random() - 0.5) * t.radius });
  }

  // Where a Builder stands to work: beside the wall (on its side of it), by the turret, or along the trench
  // at the point being dug (on the side away from the spoil bank).
  _spot(j, u) {
    if (j.kind === 'turret') {
      const a = Math.atan2(u.x - j.x, u.z - j.z);
      return { x: j.x + Math.sin(a) * 2.6, z: j.z + Math.cos(a) * 2.6 };
    }
    const dx = (j.bx - j.ax) / j.len, dz = (j.bz - j.az) / j.len;
    let nx = -dz, nz = dx;                                   // normal to the line
    if (j.kind === 'trench') {
      if (Math.sign(nz) === this.enemyDir(j.team)) { nx = -nx; nz = -nz; }     // stand on the home side
      const t = Math.min(j.len, j.dug + 1.5), wx = j.ax + dx * t, wz = j.az + dz * t;
      return { x: wx + nx * 2.6, z: wz + nz * 2.6, wx, wz };
    }
    if ((u.x - j.x) * nx + (u.z - j.z) * nz < 0) { nx = -nx; nz = -nz; }
    return { x: j.x + nx * 2.2, z: j.z + nz * 2.2 };
  }

  _work(j, amount) {
    if (j.done) return;
    j.progress = Math.min(1, j.progress + amount);
    if (j.kind === 'turret') {
      if (!j.structure) j.structure = this.units.addStructure('turret', j.team, j.x, j.z, 0);
      const s = j.structure;
      if (!s.alive) { j.done = true; return; }                      // shot down while being built
      const before = s.built;
      s.built = j.progress;
      s.hp = Math.min(s.maxHp, s.hp + (s.built - before) * s.maxHp * 0.9);
    } else if (j.kind === 'trench') {
      const to = j.progress * j.len;
      if (to > j.dug + 0.25 || j.progress >= 1) { this._dig(j, j.dug, to); j.dug = to; }
    }
    if (j.progress >= 1) this._finish(j);
  }

  _finish(j) {
    j.done = true;
    if (j.kind === 'wall') {
      const { hf, buildings, nav } = this.world;
      const def = { type: 'wall', x: j.x, z: j.z, rot: j.rot };
      flattenFootprint(hf, def, 1.5);
      buildings._add(def);
      nav?.markDirty(j.x, j.z, BUILD.wall.len / 2 + 3);
      this.onBuilding();
    }
    this.events.push({ type: 'built', job: j, x: j.x, z: j.z });
    this.jobs = this.jobs.filter(o => o !== j);
  }

  // Trench: remember the ground line it is dug relative to (so digging twice doesn't go deeper).
  _trenchRef(j) {
    const hf = this.world.hf;
    j.h0 = hf.heightAt(j.ax, j.az); j.h1 = hf.heightAt(j.bx, j.bz);
  }

  // Dig the part of trench j between distances t0 and t1 along it.
  _dig(j, t0, t1) {
    const { hf, surface } = this.world, spec = BUILD.trench, W = spec.halfWidth, B = spec.bank;
    const dx = (j.bx - j.ax) / j.len, dz = (j.bz - j.az) / j.len;
    const side = (Math.abs(dx) < 1e-6 ? 1 : Math.sign(dx)) === this.enemyDir(j.team) ? 1 : -1;   // (-dz, dx) * side points at the enemy
    const ex = -dz * side, ez = dx * side;
    const x0 = j.ax + dx * t0, z0 = j.az + dz * t0, x1 = j.ax + dx * t1, z1 = j.az + dz * t1;
    const R = W + 2.5;
    const r = hf.rect((x0 + x1) / 2, (z0 + z1) / 2, Math.hypot(x1 - x0, z1 - z0) / 2 + R);
    for (let gj = r.j0; gj <= r.j1; gj++) for (let gi = r.i0; gi <= r.i1; gi++) {
      const x = hf.wx(gi), z = hf.wz(gj);
      const along = (x - j.ax) * dx + (z - j.az) * dz;
      if (along < t0 - 0.6 || along > t1 + 0.6 || along < -0.6 || along > j.len + 0.6) continue;
      const across = (x - j.ax) * ex + (z - j.az) * ez;                 // + toward the enemy
      const ref = j.h0 + (j.h1 - j.h0) * Math.max(0, Math.min(1, along / j.len));
      // Slope the two ends of the whole line (not the joins between sections) rather than leave walls.
      const endFade = Math.min(1, j.capA === false ? 1 : (along + 0.6) / 1.2, j.capB === false ? 1 : (j.len + 0.6 - along) / 1.2);
      const k = gj * hf.verts + gi;
      const a = Math.abs(across);
      if (a < W) {
        const target = ref - spec.depth * endFade * 0.5 * (1 + Math.cos(Math.PI * a / W));
        if (hf.h[k] > target) hf.h[k] = Math.max(hf.bedrock, target);
        surface.features[k] |= FEATURE.TRENCH;
        surface.damage[k] = Math.max(surface.damage[k], 0.9);
      } else if (across > W && across < W + 2.4) {
        // Spoil bank on the enemy side.
        const u = (across - W) / 2.4, target = ref + B * endFade * Math.sin(Math.PI * u);
        if (hf.h[k] < target) hf.h[k] = target;
        surface.damage[k] = Math.max(surface.damage[k], 0.6);
      }
    }
    hf.changed(r.i0, r.j0, r.i1, r.j1);
    surface.changed(r.i0, r.j0, r.i1, r.j1);
  }

  clear() { this.jobs.length = 0; this.events.length = 0; }
}

// Distance from (x, z) to a job: its line, or its centre for a turret.
function segDist(x, z, j) {
  if (j.kind === 'turret' || j.ax === undefined) return Math.hypot(x - j.x, z - j.z);
  const vx = j.bx - j.ax, vz = j.bz - j.az, L2 = vx * vx + vz * vz || 1;
  const t = Math.max(0, Math.min(1, ((x - j.ax) * vx + (z - j.az) * vz) / L2));
  return Math.hypot(x - (j.ax + vx * t), z - (j.az + vz * t));
}

