// Mechs: orders, targeting, line of sight, firing, torso aim and death (CLAUDE.md §9). Pure: no three.js.
// Movement is done by the Movers (nav grid paths); this layer decides where each mech goes and what it shoots.
//
// Orders:
//   amove  (default) walk to a point, stopping to fight anything met on the way
//   move   walk to a point regardless, shooting at targets in range while walking (torso turns independently)
//   attack go after one target and shoot it
// Stance: Defend (u.defend) crouches the mech where it stands: harder to hit and less hurt by splash, still firing.
// Any move or attack order stands it up again.
//   idle   hold position; shoot what comes in range, chase it a little, then return (guard). After a move order
//          or Stop it holds its ground instead (u.hold): it shoots what is in range but never chases.
// Direct-fire weapons need a clear line of sight. Titans lob shells over obstacles at anything their side can
// see. Hit chance falls with the target's cover (forest, rubble, ruins) and rises with height advantage.
import { UNIT_TYPES, COMBAT, HQ_TYPE, TURRET_TYPE } from '../config.js';

export const STRUCTURE_TYPES = { hq: HQ_TYPE, turret: TURRET_TYPE };
import { NAV_CLASSES } from '../nav/navgrid.js';
import { lineOfSight, coverAt } from '../combat/los.js';
import { Projectiles } from '../combat/projectiles.js';

// The mover already finished a path to this goal (arrived, or stopped as close as it could get).
const doneWith = (m, g) => m.state === 'idle' && m.doneGoal && Math.hypot(m.doneGoal.x - g.x, m.doneGoal.z - g.z) < 0.5;
const wrap = a => { while (a > Math.PI) a -= Math.PI * 2; while (a < -Math.PI) a += Math.PI * 2; return a; };
const turnToward = (cur, target, step) => { const d = wrap(target - cur); return Math.abs(d) <= step ? target : cur + Math.sign(d) * step; };

// Muzzles in the mech's torso frame (x right, y up from the torso pivot, z forward), from the prototype models.
export const MUZZLES = {
  scout: [[-0.98, 0.35, 1.5], [0.98, 0.35, 1.5]],
  assault: [[-1.32, 0.45, 2.2], [1.32, 0.45, 2.2]],
  titan: [[1.6, 0.55, 3.15], [-1.5, 1.7, 0.75]],
  hq: [[-0.4, 10.3, 2.9], [0.4, 10.3, 2.9]],          // the HQ's roof turret
  turret: [[-0.3, 0.55, 1.8], [0.3, 0.55, 1.8]],
  builder: [[0.85, 0.4, 1.6]],
};
export const TORSO_Y = 2.45;          // torso pivot height in model units (x scale)
export const MECH_HEIGHT = 3.6;       // model height in model units

let nextId = 1;

export class Units {
  // world: { hf, surface, water?, forest?, buildings?, nav }   movers: Movers   damage: Damage
  constructor(world, movers, damage, seed = 1) {
    this.world = world;
    this.movers = movers;
    this.damage = damage;
    this.list = [];            // mechs
    this.structures = [];      // HQs: targets with hit points that don't move (their turret shoots)
    this.wrecks = [];
    this.events = [];          // for the view: { type: 'fire' | 'hit' | 'death', ... } (cleared by whoever reads them)
    this.time = 0;
    let s = seed >>> 0 || 1;
    this.rng = () => { s ^= s << 13; s >>>= 0; s ^= s >>> 17; s ^= s << 5; s >>>= 0; return s / 4294967296; };
    this.projectiles = new Projectiles(world, (p, x, y, z, unit) => this._impact(p, x, y, z, unit));
    this.stats = { shots: 0, hits: 0, kills: 0 };
  }

  spawn(type, team, x, z, yaw = team === 0 ? Math.PI : 0) {
    const t = UNIT_TYPES[type], nav = this.world.nav;
    const p = nav.nearestPassable(t.cls, x, z, 30) || { x, z };
    const mover = this.movers.add(p.x, p.z, t.cls);
    const u = {
      id: nextId++, type, t, team, alive: true, hp: t.hp, maxHp: t.hp, mover,
      x: p.x, z: p.z, y: mover.y, yaw, torsoYaw: 0, radius: NAV_CLASSES[t.cls].radius, height: MECH_HEIGHT * t.scale,
      order: 'idle', goal: null, guard: { x: p.x, z: p.z }, attackTarget: null, target: null, near: null,
      cool: this.rng() * t.rof, retargetT: this.rng() * COMBAT.retarget, chaseT: 0, gun: 0,
      seenBy: [0, 0], hitT: 0, phase: this.rng() * 6, amp: 0,
    };
    mover.unit = u;
    mover.speedMult = t.speed || 1;
    if (t.unarmed) u.jobs = [];
    this.list.push(u);
    return u;
  }

  // An HQ at (x, z): blocks movement (world.blockers), has a turret, and is a target.
  addHQ(team, x, z) { return this.addStructure('hq', team, x, z); }

  // A structure (HQ or auto turret): doesn't move, blocks movement, turret shoots what comes in range.
  // built: 0..1 while under construction (a turret only shoots once finished).
  addStructure(type, team, x, z, built = 1) {
    const t = STRUCTURE_TYPES[type], y = this.world.hf.heightAt(x, z);
    const h = {
      id: nextId++, type, isHQ: type === 'hq', isStructure: true, t, team, alive: true, hp: t.hp * Math.max(0.1, built), maxHp: t.hp,
      x, z, y, yaw: team === 0 ? Math.PI : 0, torsoYaw: 0, radius: t.radius, height: t.height, built,
      target: null, near: null, cool: 0, retargetT: 0, gun: 0, seenBy: [0, 0], hitT: 0,
    };
    this.structures.push(h);
    h.blocker = { x, z, r: t.radius + 0.5 };
    (this.world.blockers ||= []).push(h.blocker);
    this.world.nav?.markDirty(x, z, t.radius + 4);
    return h;
  }

  // ---------- orders ----------
  order(units, kind, x, z) {
    const live = units.filter(u => u.alive);
    for (const u of live) { u.order = kind; u.goal = { x, z }; u.attackTarget = null; u.hold = false; u.defend = false; }
    if (live.length) this.movers.order(live.map(u => u.mover), x, z);
    // Remember each unit's formation slot as its goal.
    for (const u of live) if (u.mover.goal) u.goal = { ...u.mover.goal };
  }
  attack(units, target) {
    for (const u of units) {
      if (!u.alive || u.team === target.team) continue;
      u.order = 'attack'; u.attackTarget = target; u.goal = null; u.chaseT = 0; u.hold = false; u.defend = false;
    }
  }
  // Defend stance on or off: on also stops them where they are (they hold their ground and keep firing).
  defend(units, on = true) {
    for (const u of units) {
      if (!u.alive || u.isStructure) continue;
      if (on) this.stop([u]);
      u.defend = on;
    }
  }
  stop(units) { for (const u of units) { u.order = 'idle'; u.goal = null; u.attackTarget = null; u.guard = { x: u.x, z: u.z }; u.hold = true; this.movers.stop(u.mover); } }

  // ---------- helpers ----------
  eye(u) { return u.y + u.height * COMBAT.eyeHeight; }
  centre(u) { return u.y + u.height * 0.55; }
  inRange(u, e, range = u.t.range) { return Math.hypot(e.x - u.x, e.z - u.z) - e.radius <= range; }
  canSeeDirect(u, e) { return lineOfSight(this.world, u.x, this.eye(u), u.z, e.x, this.centre(e), e.z).clear; }
  // Can u shoot e now? Direct fire needs its own line of sight; indirect needs anyone on its side to see e.
  canShoot(u, e) {
    if (!e.alive || !this.inRange(u, e)) return false;
    if (u.t.indirect) return e.seenBy[u.team] > this.time || this.canSeeDirect(u, e);
    return this.canSeeDirect(u, e);
  }

  _findTargets(u) {
    // Nearest shootable enemy in range, and nearest visible enemy within chase distance.
    let best = null, bd = Infinity, near = null, nd = Infinity;
    const reach = u.t.range + COMBAT.chaseRange;
    for (let li = 0; li < 2; li++) for (const e of li ? this.structures : this.list) {
      if (!e.alive || e.team === u.team) continue;
      const d = Math.hypot(e.x - u.x, e.z - u.z) - e.radius;
      const sight = u.t.sight || COMBAT.sightRange;
      if (d > Math.max(reach, sight)) continue;
      const sees = d <= sight && this.canSeeDirect(u, e);
      if (sees) e.seenBy[u.team] = this.time + 1.0;       // spotted: friendly Titans may shell it for a while
      if (d <= u.t.range && d < bd && (sees || (u.t.indirect && e.seenBy[u.team] > this.time))) { bd = d; best = e; }
      if (d <= reach && d < nd && (sees || e.seenBy[u.team] > this.time)) { nd = d; near = e; }
    }
    u.target = best; u.near = near;
  }

  _goTo(u, x, z) {
    const m = u.mover, g = m.goal;
    if (m.state !== 'idle' && g && Math.hypot(g.x - x, g.z - z) < 4) return;
    this.movers.order([m], x, z);
  }

  // ---------- simulation ----------
  step(dt) {
    this.time += dt;
    const world = this.world;
    for (const u of this.list) {
      if (!u.alive) continue;
      const m = u.mover;
      u.x = m.x; u.z = m.z; u.y = m.y;
      // Targeting.
      if (u.attackTarget && !u.attackTarget.alive) { u.attackTarget = null; if (u.order === 'attack') this.stop([u]); }
      if ((u.retargetT -= dt) <= 0) { u.retargetT = COMBAT.retarget; this._findTargets(u); if (u.t.unarmed) u.target = u.near = null; }
      if (u.target && !this.canShootQuick(u, u.target)) u.target = null;
      // An attack order fires only at its target; other orders shoot whatever is in reach.
      let target = u.t.unarmed ? null : u.order === 'attack' && u.attackTarget
        ? (this.inRange(u, u.attackTarget) && this.canShoot(u, u.attackTarget) ? u.attackTarget : null)
        : u.target;
      // Movement decisions.
      if (u.order === 'attack' && u.attackTarget) {
        if (target === u.attackTarget) { if (m.state !== 'idle') this.movers.stop(m); }
        else if ((u.chaseT -= dt) <= 0) { u.chaseT = 1; this._goTo(u, u.attackTarget.x, u.attackTarget.z); }
      } else if (u.order === 'amove' || u.order === 'idle') {
        const home = u.order === 'amove' ? u.goal : u.guard;
        if (target) { if (m.state !== 'idle') this.movers.stop(m); }
        else if (u.near && !u.hold && (u.order === 'amove' || Math.hypot(u.near.x - u.guard.x, u.near.z - u.guard.z) < COMBAT.guardRadius)) {
          if ((u.chaseT -= dt) <= 0) { u.chaseT = 1; this._goTo(u, u.near.x, u.near.z); }
        } else if (home && Math.hypot(home.x - u.x, home.z - u.z) > (u.order === 'amove' ? 2.5 : 3) && !doneWith(m, home)) {
          if (m.state === 'idle' && (u.chaseT -= dt) <= 0) { u.chaseT = 1; this.movers.order([m], home.x, home.z); }
        } else if (u.order === 'amove' && m.state === 'idle') { u.order = 'idle'; u.guard = { x: u.x, z: u.z }; u.goal = null; }
      } else if (u.order === 'move' && m.state === 'idle') {
        // Arrived: hold this ground (shoot what comes in range, but don't go chasing).
        u.order = 'idle'; u.guard = { x: u.x, z: u.z }; u.goal = null; u.hold = true;
      }
      // Facing: legs follow the walk; the torso turns toward the target independently.
      const moving = m.state === 'moving' && m.speedNow > 0.1;
      const aim = target ? Math.atan2(target.x - u.x, target.z - u.z) : u.yaw + u.torsoYaw;
      if (moving) u.yaw = turnToward(u.yaw, m.heading, u.t.turn * dt);
      else if (target) u.yaw = turnToward(u.yaw, aim, u.t.turn * 0.5 * dt);
      const rel = Math.max(-2.3, Math.min(2.3, wrap(aim - u.yaw)));
      u.torsoYaw = turnToward(u.torsoYaw, target ? rel : 0, u.t.turn * 1.5 * dt);
      // Firing.
      u.cool -= dt;
      if (target && u.cool <= 0 && Math.abs(wrap(aim - u.yaw - u.torsoYaw)) < 0.2) {
        u.cool = u.t.rof * (0.9 + this.rng() * 0.2);
        this._fire(u, target);
      }
      // Titans flatten trees as they walk.
      if (u.t.cls === 2 && moving && world.forest) {
        if (world.forest.crush(u.x, u.z, u.radius * 0.9, m.heading) && world.nav) world.nav.markDirty(u.x, u.z, u.radius + 2);
      }
      // Walk animation state.
      const sp = moving ? m.speedNow : 0;
      u.amp += (Math.min(1, sp / 3) - u.amp) * Math.min(1, dt * 6);
      u.phase += dt * sp / (2.4 * u.t.scale) * Math.PI * 2;
      if (u.hitT > 0) u.hitT -= dt;
      u.crouch = (u.crouch || 0) + ((u.defend ? 1 : 0) - (u.crouch || 0)) * Math.min(1, dt * 5);
    }
    for (const h of this.structures) if (h.alive && h.built >= 1) this._stepHQ(h, dt);
    this.projectiles.step(dt);
    for (const w of this.wrecks) w.t += dt;
    this.wrecks = this.wrecks.filter(w => w.t < COMBAT.wreckTime + 3);
  }

  // HQ turret: turn toward the nearest visible enemy in range and fire.
  _stepHQ(h, dt) {
    h.y = this.world.hf.heightAt(h.x, h.z);
    if ((h.retargetT -= dt) <= 0) { h.retargetT = COMBAT.retarget; this._findTargets(h); }
    if (h.target && !this.canShootQuick(h, h.target)) h.target = null;
    const target = h.target;
    if (target) {
      const aim = wrap(Math.atan2(target.x - h.x, target.z - h.z) - h.yaw);
      h.torsoYaw = turnToward(h.torsoYaw, aim, h.t.turn * dt);
      h.cool -= dt;
      if (h.cool <= 0 && Math.abs(wrap(aim - h.torsoYaw)) < 0.15) { h.cool = h.t.rof * (0.9 + this.rng() * 0.2); this._fire(h, target); }
    } else h.cool = Math.max(0, h.cool - dt);
    if (h.hitT > 0) h.hitT -= dt;
  }

  // Cheap re-check between target searches: still in range and (for direct fire) still visible every few frames.
  canShootQuick(u, e) {
    if (!e.alive || !this.inRange(u, e)) return false;
    if (u.t.indirect) return e.seenBy[u.team] > this.time;
    return true;
  }

  muzzle(u) {
    const mz = MUZZLES[u.type][u.gun = (u.gun + 1) % MUZZLES[u.type].length], s = u.t.scale, a = u.yaw + u.torsoYaw;
    const c = Math.cos(a), sn = Math.sin(a);
    return { x: u.x + (mz[0] * c + mz[2] * sn) * s, y: u.y + (TORSO_Y + mz[1]) * s, z: u.z + (-mz[0] * sn + mz[2] * c) * s };
  }

  // Chance that a direct shot from u hits e.
  hitChance(u, e) {
    const cover = coverAt(this.world, e.x, e.z);
    const high = Math.max(-1, Math.min(2, (u.y - e.y) / 4)) * COMBAT.highGround;
    const p = u.t.accuracy * (1 - cover) + high;
    return Math.max(0.03, Math.min(0.98, e.defend ? p * COMBAT.defendHit : p));
  }

  _fire(u, e) {
    const from = this.muzzle(u), t = u.t;
    this.stats.shots++;
    let to, willHit = false;
    if (t.indirect) {
      // Shells aim where the target is now (not where it will be) and scatter a little.
      const a = this.rng() * 6.283, r = Math.sqrt(this.rng()) * COMBAT.shellSpread;
      const x = e.x + Math.cos(a) * r, z = e.z + Math.sin(a) * r;
      to = { x, y: this.world.hf.heightAt(x, z), z };
    } else {
      willHit = this.rng() < this.hitChance(u, e);
      if (willHit) to = { x: e.x, y: this.centre(e), z: e.z };
      else {
        // A miss lands on the ground beside or beyond the target.
        const a = this.rng() * 6.283, r = e.radius + 1 + this.rng() * 3;
        const x = e.x + Math.cos(a) * r, z = e.z + Math.sin(a) * r;
        to = { x, y: this.world.hf.heightAt(x, z), z };
      }
    }
    const p = this.projectiles.fire({ kind: t.proj, team: u.team, dmg: t.dmg, splash: t.splash, from, to, speed: t.projSpeed, target: e, willHit, shooter: u });
    this.events.push({ type: 'fire', kind: t.proj, x: from.x, y: from.y, z: from.z, unit: u, p });
  }

  _impact(p, x, y, z, unit) {
    if (unit) {
      this.stats.hits++;
      this.damage.hitUnit(unit, p.dmg, p.shooter);
      this.events.push({ type: 'hit', kind: p.kind, x, y, z, unit, team: p.team });
      // Cannon rounds also burst (splash) on the mech they hit.
      if (p.splash > 0) this.damage.explode(x, z, p.kind, y, { dmg: p.dmg * 0.4, splash: p.splash, team: p.team, exclude: unit });
      return;
    }
    // Missed or blocked: it hits the ground (or a wall) there.
    this.damage.explode(x, z, p.kind, y, p.splash > 0 ? { dmg: p.dmg, splash: p.splash, team: p.team } : null);
  }

  // Called by Damage when a unit's hp reaches 0.
  kill(u) {
    if (!u.alive) return;
    if (u.isStructure) {
      u.alive = false; u.hp = 0;
      if (u.isHQ) { this.events.push({ type: 'hqDestroyed', team: u.team, x: u.x, y: u.y + u.height * 0.5, z: u.z, unit: u }); return; }
      // A turret: a wreck in its place, and the ground is free again.
      this.stats.kills++;
      this.structures = this.structures.filter(o => o !== u);
      const b = this.world.blockers;
      if (b) b.splice(b.indexOf(u.blocker), 1);
      this.world.nav?.markDirty(u.x, u.z, u.radius + 4);
      this.wrecks.push({ x: u.x, y: u.y, z: u.z, yaw: u.yaw, torsoYaw: u.torsoYaw, type: u.type, team: u.team, t: 0, tilt: this.rng() < 0.5 ? -1 : 1, phase: 0, sink0: (1 - u.built) * u.height });
      this.events.push({ type: 'death', x: u.x, y: u.y + u.height * 0.5, z: u.z, unit: u });
      return;
    }
    u.alive = false; u.hp = 0;
    this.stats.kills++;
    this.movers.remove(u.mover);
    this.wrecks.push({ x: u.x, y: u.y, z: u.z, yaw: u.yaw, torsoYaw: u.torsoYaw, type: u.type, team: u.team, t: 0, tilt: this.rng() < 0.5 ? -1 : 1, phase: u.phase });
    this.events.push({ type: 'death', x: u.x, y: u.y + u.height * 0.5, z: u.z, unit: u });
    this.list = this.list.filter(o => o !== u);
  }

  counts() {
    const c = [0, 0];
    for (const u of this.list) if (u.alive) c[u.team]++;
    return c;
  }
}
