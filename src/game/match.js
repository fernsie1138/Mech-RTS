// A match (CLAUDE.md §9): credits and income, HQ build queues, capture points, and winning or losing.
// Pure: no three.js. Team 0 is the player, team 1 the enemy.
//
// Income = baseIncome + pointIncome x capture points held, every second. Each HQ builds the mechs in its queue
// one at a time (paid when queued) and sends them to a rally point in front of it. A capture point has a control
// value from -1 (enemy) to +1 (player): mechs of one side alone in the ring push it their way; when it reaches
// +-1 that side owns it, and it is neutral again once control crosses 0. Destroying the other HQ wins.
// Battle Value (BV): every mech and turret has one (bigger ones more). A side's mechs alive and queued, and its
// turrets (standing, being built, or ordered), may add up to bvStart + bvPerPoint x capture points held. Losing a
// point lowers the limit but takes nothing away: the side just can't build more until it is under the limit.
import { ECONOMY, CAPTURE, UNIT_TYPES, TURRET_TYPE } from '../config.js';

export class Match {
  // units: Units   markers: { playerHQ, enemyHQ, capturePoints }
  constructor(units, markers, { size = 256 } = {}) {
    this.units = units;
    this.time = 0;
    this.over = null;                    // { winner, time } once an HQ falls
    this.events = [];                    // { type: 'captured' | 'lost' | 'built' | 'hqHit' | 'end', ... } for the HUD
    const hqs = [markers.playerHQ, markers.enemyHQ].map((p, team) => units.addHQ(team, p.x, p.z));
    this.teams = hqs.map((hq, team) => {
      // Units come out of the side of the HQ facing the middle of the map, and gather a little further on.
      const dx = -hq.x, dz = -hq.z, d = Math.hypot(dx, dz) || 1, ux = d > 1 ? dx / d : 0, uz = d > 1 ? dz / d : (team ? 1 : -1);
      const out = hq.radius + 4;
      return {
        team, hq, credits: ECONOMY.startCredits, queue: [], prog: 0,
        spawn: { x: hq.x + ux * out, z: hq.z + uz * out },
        rally: { x: hq.x + ux * (out + 14), z: hq.z + uz * (out + 14) },
        built: 0, lost: 0,
      };
    });
    this.points = (markers.capturePoints || []).map((p, index) => ({ index, x: p.x, z: p.z, control: 0, owner: null, count: [0, 0] }));
    this.size = size;
  }

  income(team) { return ECONOMY.baseIncome + ECONOMY.pointIncome * this.points.filter(p => p.owner === team).length; }
  held(team) { return this.points.filter(p => p.owner === team).length; }
  army(team) { return this.units.list.filter(u => u.alive && u.team === team).length + this.teams[team].queue.length; }
  // Battle Value: the limit, what is used, and what is left.
  bvCap(team) { return ECONOMY.bvStart + ECONOMY.bvPerPoint * this.held(team); }
  bvUsed(team) {
    let n = this.pendingBV(team);
    for (const u of this.units.list) if (u.alive && u.team === team) n += u.t.bv || 0;
    for (const s of this.units.structures) if (s.alive && s.team === team && !s.isHQ) n += s.t.bv || 0;
    for (const k of this.teams[team].queue) n += UNIT_TYPES[k].bv || 0;
    return n;
  }
  bvLeft(team) { return this.bvCap(team) - this.bvUsed(team); }
  // BV of things ordered but not yet on the map (turret jobs not started). Set by the game (main.js).
  pendingBV() { return 0; }

  // Queue a mech. Returns true, or the reason it can't: 'poor', 'full' (queue), 'bv' (Battle Value limit), 'over'.
  enqueue(team, type) {
    const T = this.teams[team], cost = UNIT_TYPES[type].cost;
    if (this.over || !T.hq.alive) return 'over';
    if (T.queue.length >= ECONOMY.queueMax) return 'full';
    if (this.bvLeft(team) < (UNIT_TYPES[type].bv || 0)) return 'bv';
    if (T.credits < cost) return 'poor';
    T.credits -= cost;
    T.queue.push(type);
    return true;
  }
  // Take the last queued mech of a type back off the queue, with a refund.
  dequeue(team, type) {
    const T = this.teams[team], i = T.queue.lastIndexOf(type);
    if (i < 0) return false;
    T.queue.splice(i, 1);
    if (i === 0) T.prog = 0;
    T.credits += UNIT_TYPES[type].cost;
    return true;
  }

  step(dt) {
    if (this.over) return;
    this.time += dt;
    for (const T of this.teams) {
      T.credits += this.income(T.team) * dt;
      if (!T.hq.alive || !T.queue.length) continue;
      T.prog += dt;
      const type = T.queue[0];
      if (T.prog >= UNIT_TYPES[type].build) {
        T.prog = 0; T.queue.shift();
        const u = this.units.spawn(type, T.team, T.spawn.x, T.spawn.z);
        T.built++;
        // Spread out round the rally point so a stream of new mechs doesn't pile up.
        const a = this.units.rng() * Math.PI * 2, r = 3 + this.units.rng() * 7;
        this.units.order([u], 'amove', T.rally.x + Math.cos(a) * r, T.rally.z + Math.sin(a) * r);
        this.events.push({ type: 'built', team: T.team, unit: u });
      }
    }
    this._capture(dt);
    for (const T of this.teams) if (!T.hq.alive && !this.over) {
      this.over = { winner: 1 - T.team, time: this.time };
      this.events.push({ type: 'end', winner: 1 - T.team });
    }
  }

  _capture(dt) {
    const R2 = CAPTURE.radius * CAPTURE.radius;
    for (const p of this.points) {
      const n = p.count; n[0] = n[1] = 0;
      for (const u of this.units.list) if (u.alive && (u.x - p.x) ** 2 + (u.z - p.z) ** 2 < R2) n[u.team]++;
      if (n[0] && !n[1]) p.control += CAPTURE.rate * Math.min(CAPTURE.maxCount, n[0]) * dt;
      else if (n[1] && !n[0]) p.control -= CAPTURE.rate * Math.min(CAPTURE.maxCount, n[1]) * dt;
      else if (!n[0] && !n[1]) {
        const rest = p.owner === 0 ? 1 : p.owner === 1 ? -1 : 0;
        p.control += Math.max(-CAPTURE.decay * dt, Math.min(CAPTURE.decay * dt, rest - p.control));
      }
      p.control = Math.max(-1, Math.min(1, p.control));
      const was = p.owner;
      if (p.owner === 0 && p.control <= 0) p.owner = null;
      if (p.owner === 1 && p.control >= 0) p.owner = null;
      if (p.control >= 1) p.owner = 0;
      if (p.control <= -1) p.owner = 1;
      if (was !== p.owner) {
        if (was !== null) this.events.push({ type: 'lost', team: was, point: p });
        if (p.owner !== null) this.events.push({ type: 'captured', team: p.owner, point: p });
      }
    }
  }

  // Count kills against each side (called from the game when a mech dies).
  unitLost(u) { if (!u.isStructure && this.teams[u.team]) this.teams[u.team].lost++; }
}
