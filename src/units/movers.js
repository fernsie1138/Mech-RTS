// Unit movement over the nav grid (CLAUDE.md §8). Pure: no three.js. Milestone 7's mechs use this for their legs.
//
// Each mover follows an A* path at its class speed, slowed or sped up by the ground under it. It re-plans when
// cells on its remaining path change, when it stops making progress, and if the ground under it becomes
// impassable (a crater or rubble lands on it) it first walks straight to the nearest passable cell, so units
// never stay stuck. Movers push each other apart.
import { NAV_CLASSES } from '../nav/navgrid.js';
import { PathFinder } from '../nav/pathfinding.js';

export const MOVE = {
  speeds: [9, 6, 3.6],          // world units per second for small / medium / large (Scout, Assault, Titan)
  costExponent: 0.6,            // speed x (1 / cell cost) ^ this
  arriveDist: 1.2,
  crowdArrive: 4,               // stalled this close to the end of a path (spot taken): arrived
  waypointDist: 0.8,
  checkEvery: 0.5,              // seconds between path-validity / progress checks
  stuckTime: 2.0,               // no progress for this long: re-plan
  maxReplans: 8,                // ... this many times in a row, then give up
  avoidRange: 3,                // steer round units within this distance (beyond touching) ahead
  pathsPerStep: 4,              // A* searches per step (spreads the cost over frames)
};

let nextId = 1;

export class Movers {
  constructor(grid) {
    this.grid = grid;
    this.finder = new PathFinder(grid);
    this.list = [];
    this.requests = [];
    this.stats = { paths: 0, escapes: 0, replans: 0, giveUps: 0 };
  }

  add(x, z, cls) {
    const m = {
      id: nextId++, x, z, y: this.grid.standHeight(x, z), cls, radius: NAV_CLASSES[cls].radius,
      heading: 0, goal: null, path: null, wp: 1, state: 'idle', escape: null,
      check: 0, best: Infinity, stuckT: 0, replans: 0, moved: 0, speedNow: 0,
    };
    this.list.push(m);
    return m;
  }

  remove(m) { this.list = this.list.filter(o => o !== m); }

  // Order movers to (x, z). Several movers spread into a formation around the point.
  order(movers, x, z) {
    const spacing = 2 * Math.max(...movers.map(m => m.radius)) + 1.5;
    movers.forEach((m, k) => {
      // Slots on rings round the target: 1, 6, 12, ...
      let ring = 0, first = 0, size = 1;
      while (k >= first + size) { first += size; ring++; size = ring * 6; }
      const a = ring ? (k - first) / size * Math.PI * 2 : 0;
      const gx = x + Math.cos(a) * ring * spacing, gz = z + Math.sin(a) * ring * spacing;
      const g = this.grid.nearestPassable(m.cls, gx, gz, 30) || { x: gx, z: gz };
      m.goal = { x: g.x, z: g.z };
      m.replans = 0;
      this._request(m);
    });
  }

  stop(m) { m.goal = null; m.path = null; m.state = 'idle'; }
  // End of the path. doneGoal remembers which goal this was, so whoever gave the order can tell it is done
  // (even if the unit stopped short because the spot was taken or out of reach).
  _arrive(m) { m.lastReached = m.path ? m.path.reached : false; m.doneGoal = m.goal; m.goal = null; m.state = 'idle'; m.path = null; }

  _request(m) {
    if (!this.requests.includes(m)) this.requests.push(m);
    m.state = 'waiting';
  }

  _plan(m) {
    if (!m.goal) { m.state = 'idle'; return; }
    const p = this.finder.find(m.cls, m.x, m.z, m.goal.x, m.goal.z);
    this.stats.paths++;
    if (!p) { this._escape(m); return; }
    m.path = p; m.path.tick = this.grid.tick; m.wp = 1;
    m.state = p.points.length > 1 ? 'moving' : 'idle';
    m.best = Infinity; m.stuckT = 0; m.check = 0;
    if (m.state === 'idle' && !p.reached) { m.doneGoal = m.goal; m.goal = null; }
  }

  // Standing on impassable ground: head straight for the nearest passable cell.
  _escape(m) {
    const t = this.grid.nearestPassable(m.cls, m.x, m.z, 40);
    m.escape = t;
    m.state = t ? 'escaping' : 'idle';
    if (t) this.stats.escapes++;
  }

  step(dt) {
    const G = this.grid;
    // Plan a few paths this step.
    for (let n = 0; n < MOVE.pathsPerStep && this.requests.length; n++) {
      const m = this.requests.shift();
      if (this.list.includes(m)) this._plan(m);
    }
    for (const m of this.list) {
      m.speedNow = 0;
      const here = G.costAt(m.cls, m.x, m.z);
      if (here === Infinity && m.state !== 'escaping') this._escape(m);
      if (m.state === 'escaping') {
        if (!m.escape || G.passable(m.cls, m.escape.x, m.escape.z) === false) this._escape(m);
        if (m.escape) {
          this._moveToward(m, m.escape.x, m.escape.z, MOVE.speeds[m.cls] * 0.6 * dt, true);
          if (Math.hypot(m.escape.x - m.x, m.escape.z - m.z) < 0.3 || G.passable(m.cls, m.x, m.z)) {
            m.escape = null;
            if (m.goal) this._request(m); else m.state = 'idle';
          }
        }
        continue;
      }
      if (m.state !== 'moving') continue;
      const pts = m.path.points;
      // Periodic checks: did the ground on the remaining path change? Are we making progress?
      m.check += dt;
      if (m.check >= MOVE.checkEvery) {
        m.check = 0;
        const remaining = m.path.cells;
        if (G.latestChange(remaining) > m.path.tick) { this.stats.replans++; this._request(m); continue; }
        const d = Math.hypot(pts[m.wp].x - m.x, pts[m.wp].z - m.z);
        if (d < m.best - 0.2) { m.best = d; m.stuckT = 0; }
        else if ((m.stuckT += MOVE.checkEvery) >= MOVE.stuckTime) {
          // Nearly there but not getting closer (another mech is standing on the spot): call it arrived.
          if (m.wp === pts.length - 1 && d < MOVE.crowdArrive) { this._arrive(m); continue; }
          if (++m.replans > MOVE.maxReplans) { this.stats.giveUps++; m.doneGoal = m.goal; this.stop(m); continue; }
          this.stats.replans++; this._request(m); continue;
        }
      }
      const speed = MOVE.speeds[m.cls] * (m.speedMult || 1) * Math.pow(1 / Math.max(0.3, here), MOVE.costExponent);
      let budget = speed * dt;
      while (budget > 0 && m.state === 'moving') {
        const w = pts[m.wp], d = Math.hypot(w.x - m.x, w.z - m.z);
        const last = m.wp === pts.length - 1;
        if (d <= (last ? 0.05 : MOVE.waypointDist) || d <= budget) {
          const ok = this._moveToward(m, w.x, w.z, Math.min(d, budget));
          if (!ok) { this._request(m); break; }
          budget -= d;
          if (last) {
            // At the goal, or as close as the ground allows if it can't be reached.
            this._arrive(m);
            break;
          }
          m.wp++; m.best = Infinity;
        } else {
          if (!this._moveToward(m, w.x, w.z, budget)) { this._request(m); break; }
          budget = 0;
        }
      }
      m.speedNow = speed;
    }
    this._separate(dt);
    for (const m of this.list) m.y = G.standHeight(m.x, m.z);
  }

  // Unit direction toward (dx, dz), bent sideways round units just ahead (so fast units overtake slow ones
  // instead of being shoved back by separation).
  _steer(m, dx, dz) {
    let ax = 0, az = 0;
    for (const o of this.list) {
      if (o === m) continue;
      const ox = o.x - m.x, oz = o.z - m.z, d = Math.hypot(ox, oz);
      const min = m.radius + o.radius + 0.3;
      if (d < 1e-6 || d > min + MOVE.avoidRange) continue;
      const ahead = (ox * dx + oz * dz) / d;
      if (ahead < 0.3) continue;
      const side = (dx * oz - dz * ox) > 0 ? -1 : 1;           // pass on the side away from the other unit
      const wgt = ahead * Math.min(1, 1 - (d - min) / MOVE.avoidRange);
      ax += -dz * side * wgt; az += dx * side * wgt;
    }
    if (!ax && !az) return [dx, dz];
    // Pass on the chosen side unless that runs into a wall or a cliff a little way ahead; then the other side.
    const G = this.grid, look = m.radius + 1.2;
    for (const sgn of [1, -1]) {
      const nx = dx + sgn * ax * 1.5, nz = dz + sgn * az * 1.5, l = Math.hypot(nx, nz) || 1;
      if (G.passable(m.cls, m.x + nx / l * look, m.z + nz / l * look)) return [nx / l, nz / l];
    }
    return [dx, dz];
  }

  // Move up to `dist` toward (tx, tz). Won't step into an impassable cell unless `force`. Returns false if blocked.
  _moveToward(m, tx, tz, dist, force = false) {
    const dx = tx - m.x, dz = tz - m.z, d = Math.hypot(dx, dz);
    if (d < 1e-6) return true;
    const s = Math.min(dist, d);
    const [ux, uz] = force ? [dx / d, dz / d] : this._steer(m, dx / d, dz / d);
    let nx = m.x + ux * s, nz = m.z + uz * s;
    const G = this.grid;
    if (!force && !G.passable(m.cls, nx, nz)) {
      // Blocked (usually clipping the corner of an impassable cell): slide along one axis, or failing that
      // step toward the middle of the current cell, which is always passable.
      if (G.passable(m.cls, nx, m.z)) nz = m.z;
      else if (G.passable(m.cls, m.x, nz)) nx = m.x;
      else {
        const k = G.idx(m.x, m.z), cx = G.cx(k % G.n), cz = G.cz((k - (k % G.n)) / G.n), dc = Math.hypot(cx - m.x, cz - m.z);
        if (dc < 0.05) return false;
        nx = m.x + (cx - m.x) / dc * Math.min(s, dc); nz = m.z + (cz - m.z) / dc * Math.min(s, dc);
      }
    }
    m.moved += Math.hypot(nx - m.x, nz - m.z);
    m.heading = Math.atan2(dx, dz);
    m.x = nx; m.z = nz;
    return true;
  }

  // Push overlapping movers apart (never into impassable cells).
  _separate() {
    const L = this.list, G = this.grid;
    for (let a = 0; a < L.length; a++) for (let b = a + 1; b < L.length; b++) {
      const A = L[a], B = L[b], dx = B.x - A.x, dz = B.z - A.z, min = A.radius + B.radius + 0.2;
      const d2 = dx * dx + dz * dz;
      if (d2 >= min * min) continue;
      const d = Math.sqrt(d2) || 0.01, push = (min - d) / 2, ux = d2 ? dx / d : 1, uz = d2 ? dz / d : 0;
      // Moving units shove idle ones more than the other way round.
      const wa = A.state === 'moving' && B.state !== 'moving' ? 0.3 : B.state === 'moving' && A.state !== 'moving' ? 1.7 : 1;
      const ax = A.x - ux * push * wa, az = A.z - uz * push * wa, bx = B.x + ux * push * (2 - wa), bz = B.z + uz * push * (2 - wa);
      if (G.passable(A.cls, ax, az)) { A.x = ax; A.z = az; }
      if (G.passable(B.cls, bx, bz)) { B.x = bx; B.z = bz; }
    }
  }
}
