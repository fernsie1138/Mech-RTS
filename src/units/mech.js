// Mech models (from the prototype) drawn with instancing: every box part of every mech is one instance of a
// single box mesh, so 80 walking mechs cost one draw call (plus shadows). Each frame the parts are posed from
// the unit's state: walk cycle (hips and knees), body bob, independent torso yaw, hit flash. Wrecks are drawn
// the same way, dark, tilted and sinking. Also: selection rings, health bars and projectile tracers.
import * as THREE from 'three';
import { TORSO_Y, STRUCTURE_TYPES } from './units.js';
import { COMBAT, UNIT_TYPES, BUILD } from '../config.js';

const TEAM = [0x3d8fe0, 0xd9442e];
const ROLE = { metal: 0x8a949c, dark: 0x2e3338, glass: 0x9fe8ff, hazard: 0xe8b02a };
const SITE = { plan: 0xe8b02a, ok: 0x7cff9a, bad: 0xff5040 };

// Part lists: [group, role, w, h, d, x, y, z]. Groups: body, hip0/1 (left/right), knee0/1, torso.
function legs() {
  const p = [['body', 'dark', 1.3, 0.45, 0.8, 0, 2.2, 0]];
  for (const i of [0, 1]) {
    p.push([`hip${i}`, 'metal', 0.45, 1.15, 0.55, 0, -0.55, 0]);
    p.push([`knee${i}`, 'team', 0.5, 0.35, 0.6, 0, 0, 0.05]);
    p.push([`knee${i}`, 'metal', 0.4, 1.1, 0.5, 0, -0.5, -0.05]);
    p.push([`knee${i}`, 'dark', 0.62, 0.2, 1.05, 0, -1.02, 0.12]);
  }
  return p;
}
const PARTS = {
  scout: [...legs(),
    ['torso', 'team', 1.6, 0.9, 1.3, 0, 0.45, 0], ['torso', 'glass', 0.9, 0.32, 0.1, 0, 0.55, 0.66],
    ['torso', 'dark', 0.3, 0.35, 0.8, -0.98, 0.35, 0.1], ['torso', 'metal', 0.16, 0.16, 1.2, -0.98, 0.35, 0.9],
    ['torso', 'dark', 0.3, 0.35, 0.8, 0.98, 0.35, 0.1], ['torso', 'metal', 0.16, 0.16, 1.2, 0.98, 0.35, 0.9],
    ['torso', 'dark', 0.08, 0.9, 0.08, -0.5, 1.2, -0.4]],
  assault: [...legs(),
    ['torso', 'team', 2.0, 1.2, 1.6, 0, 0.6, 0], ['torso', 'glass', 1.0, 0.36, 0.1, 0, 0.8, 0.81], ['torso', 'dark', 2.3, 0.25, 1.2, 0, 1.25, -0.1],
    ['torso', 'team', 0.6, 0.8, 1.2, -1.32, 0.5, 0.1], ['torso', 'dark', 0.28, 0.28, 1.8, -1.32, 0.45, 1.3],
    ['torso', 'team', 0.6, 0.8, 1.2, 1.32, 0.5, 0.1], ['torso', 'dark', 0.28, 0.28, 1.8, 1.32, 0.45, 1.3]],
  titan: [...legs(),
    ['torso', 'team', 2.4, 1.4, 1.9, 0, 0.7, 0], ['torso', 'glass', 1.2, 0.4, 0.1, 0, 0.95, 0.96], ['torso', 'dark', 2.6, 0.3, 1.6, 0, 1.5, -0.1],
    ['torso', 'team', 0.8, 1.0, 1.4, 1.6, 0.6, 0.1], ['torso', 'dark', 0.5, 0.5, 2.8, 1.6, 0.55, 1.7], ['torso', 'dark', 0.7, 0.7, 0.4, 1.6, 0.55, 0.6],
    ['torso', 'team', 1.1, 0.9, 1.4, -1.5, 1.7, -0.1], ['torso', 'dark', 0.9, 0.7, 0.1, -1.5, 1.7, 0.62]],
  // Builder: a squat cab with a work arm and shovel on the right, a toolbox and beacon on the back.
  builder: [...legs(),
    ['torso', 'team', 1.5, 0.95, 1.4, 0, 0.45, 0], ['torso', 'glass', 0.9, 0.3, 0.1, -0.15, 0.6, 0.71],
    ['torso', 'hazard', 1.55, 0.18, 1.45, 0, 1.0, 0], ['torso', 'dark', 0.9, 0.55, 0.6, 0, 0.6, -0.9],
    ['torso', 'hazard', 0.22, 0.22, 0.22, -0.45, 1.25, -0.4],
    ['torso', 'hazard', 0.28, 0.28, 1.5, 0.95, 0.5, 0.6], ['torso', 'metal', 0.22, 0.6, 0.22, 0.95, 0.25, 1.35],
    ['torso', 'dark', 0.7, 0.14, 0.55, 0.95, -0.05, 1.55]],
  // Auto turret: base and pillar (root), turning head with twin guns (torso, at TORSO_Y).
  turret: [
    ['root', 'dark', 2.6, 0.5, 2.6, 0, 0.25, 0], ['root', 'metal', 1.3, 1.8, 1.3, 0, 1.4, 0], ['root', 'hazard', 1.4, 0.15, 1.4, 0, 2.3, 0],
    ['torso', 'team', 1.7, 0.95, 1.7, 0, 0.45, 0], ['torso', 'glass', 0.7, 0.2, 0.1, 0, 0.75, 0.86],
    ['torso', 'dark', 0.2, 0.2, 1.7, -0.3, 0.55, 1.1], ['torso', 'dark', 0.2, 0.2, 1.7, 0.3, 0.55, 1.1]],
};
const scaleOf = type => (UNIT_TYPES[type] || STRUCTURE_TYPES[type]).scale;
const MAX_PARTS = 4000, MAX_UNITS = 200, MAX_TRACERS = 300;

export class MechView {
  // heightAt: ground height (for construction sites). construction / preview are set by the game.
  constructor(scene, heightAt = () => 0) {
    this.heightAt = heightAt;
    this.construction = null;
    this.preview = null;
    // Fog of war: which enemy mechs/structures to draw, and whether a spot is in view (wrecks, tracers).
    this.shown = () => true;
    this.inView = () => true;
    this.group = new THREE.Group();
    this.group.name = 'mechs';
    scene.add(this.group);
    this.parts = new THREE.InstancedMesh(new THREE.BoxGeometry(1, 1, 1), new THREE.MeshLambertMaterial({ flatShading: true }), MAX_PARTS);
    this.parts.castShadow = this.parts.receiveShadow = true;
    this.parts.frustumCulled = false;
    this.parts.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.group.add(this.parts);
    this.rings = new THREE.InstancedMesh(new THREE.RingGeometry(1.05, 1.3, 32).rotateX(-Math.PI / 2),
      new THREE.MeshBasicMaterial({ color: 0x7cff9a, transparent: true, opacity: 0.9, depthTest: false }), MAX_UNITS);
    this.rings.renderOrder = 15;
    const bar = new THREE.PlaneGeometry(1, 1);
    // Health bars: bright, unlit colours on an opaque black backing; never darkened by the fog.
    this.barBg = new THREE.InstancedMesh(bar, new THREE.MeshBasicMaterial({ color: 0x000000, transparent: true, opacity: 0.88, depthTest: false, toneMapped: false }), MAX_UNITS);
    this.barFg = new THREE.InstancedMesh(bar.clone(), new THREE.MeshBasicMaterial({ depthTest: false, toneMapped: false }), MAX_UNITS);
    this.barBg.material.userData.fogPatched = this.barFg.material.userData.fogPatched = true;
    this.barBg.renderOrder = 16; this.barFg.renderOrder = 17;
    this.tracers = new THREE.InstancedMesh(new THREE.BoxGeometry(1, 1, 1), new THREE.MeshBasicMaterial({ transparent: true, blending: THREE.AdditiveBlending, depthWrite: false }), MAX_TRACERS);
    for (const m of [this.rings, this.barBg, this.barFg, this.tracers]) { m.frustumCulled = false; m.count = 0; this.group.add(m); }
    this._m = new THREE.Matrix4(); this._g = {}; this._t = new THREE.Matrix4(); this._q = new THREE.Quaternion(); this._p = new THREE.Vector3(); this._s = new THREE.Vector3();
    this._e = new THREE.Euler(); this._c = new THREE.Color(); this._y = new THREE.Vector3(0, 1, 0); this._x = new THREE.Vector3(1, 0, 0);
    for (const k of ['root', 'body', 'hip0', 'hip1', 'knee0', 'knee1', 'torso']) this._g[k] = new THREE.Matrix4();
  }

  // Pose one mech (or wreck) and write its parts from instance index n. Returns the next free index.
  _pose(n, type, team, s) {
    const g = this._g, sc = scaleOf(type);
    // Root: position, legs yaw (+ wreck tilt), scale.
    this._e.set(s.tiltX || 0, s.yaw, s.tiltZ || 0, 'YXZ');
    g.root.compose(this._p.set(s.x, s.y - (s.sink || 0), s.z), this._q.setFromEuler(this._e), this._s.setScalar(sc));
    g.body.multiplyMatrices(g.root, this._t.makeTranslation(0, -Math.abs(Math.cos(s.phase)) * 0.12 * s.amp, 0));
    for (const i of [0, 1]) {
      const ph = s.phase + i * Math.PI, side = i ? 1 : -1;
      g[`hip${i}`].multiplyMatrices(g.body, this._t.makeTranslation(side * 0.62, 2.2, 0)).multiply(this._t.makeRotationX(-Math.sin(ph) * 0.55 * s.amp));
      g[`knee${i}`].multiplyMatrices(g[`hip${i}`], this._t.makeTranslation(0, -1.1, 0.05)).multiply(this._t.makeRotationX((0.15 + 0.75 * Math.max(0, Math.cos(ph))) * s.amp));
    }
    g.torso.multiplyMatrices(g.body, this._t.makeTranslation(0, TORSO_Y, 0)).multiply(this._t.makeRotationY(s.torsoYaw));
    const flash = s.flash || 0;
    for (const [grp, role, w, h, d, x, y, z] of PARTS[type]) {
      if (n >= MAX_PARTS) break;
      this._m.multiplyMatrices(g[grp], this._t.makeTranslation(x, y, z)).multiply(this._t.makeScale(w, h, d));
      this.parts.setMatrixAt(n, this._m);
      const base = role === 'team' ? TEAM[team] : ROLE[role];
      this._c.setHex(base);
      if (s.wreck) this._c.multiplyScalar(0.25).offsetHSL(0, -0.3, 0);
      if (flash > 0) this._c.lerp(new THREE.Color(1, 0.95, 0.8), Math.min(1, flash * 6));
      this.parts.setColorAt(n, this._c);
      n++;
    }
    return n;
  }

  update(units, selected, camera) {
    let n = 0;
    for (const u of units.list) {
      if (!this.shown(u)) continue;
      n = this._pose(n, u.type, u.team, { x: u.x, y: u.y, z: u.z, yaw: u.yaw, torsoYaw: u.torsoYaw, phase: u.phase, amp: u.amp, flash: u.hitT });
    }
    for (const h of units.structures || []) {
      // Turrets rise out of the ground while they are being built.
      if (h.type !== 'turret' || !h.alive || !this.shown(h)) continue;
      n = this._pose(n, 'turret', h.team, { x: h.x, y: h.y, z: h.z, yaw: h.yaw, torsoYaw: h.torsoYaw, phase: 0, amp: 0, flash: h.hitT, sink: (1 - h.built) * h.height });
    }
    n = this._sites(n, this.construction, this.preview);
    for (const w of units.wrecks) {
      if (!this.inView(w.x, w.z, true)) continue;
      // Wrecks topple over in the first second, then sink into the ground at the end of their time.
      const fall = Math.min(1, w.t / 0.8);
      n = this._pose(n, w.type, w.team, { x: w.x, y: w.y, z: w.z, yaw: w.yaw, torsoYaw: w.torsoYaw, phase: w.phase, amp: 0.3,
        tiltX: 0.35 * fall, tiltZ: w.tilt * 1.1 * fall, wreck: true, sink: (w.sink0 || 0) + Math.max(0, w.t - COMBAT.wreckTime) * 1.5 });
    }
    this.parts.count = n;
    this.parts.instanceMatrix.needsUpdate = true;
    if (this.parts.instanceColor) this.parts.instanceColor.needsUpdate = true;

    // Selection rings and health bars (shown when selected or damaged), facing the camera.
    let r = 0, b = 0;
    const camQ = camera.quaternion;
    for (const u of units.structures ? [...units.list, ...units.structures] : units.list) {
      if (!u.alive || !this.shown(u)) continue;
      const sel = selected.has(u);
      if (sel && r < MAX_UNITS) {
        this._m.compose(this._p.set(u.x, u.y + 0.15, u.z), this._q.identity(), this._s.set(u.radius, 1, u.radius));
        this.rings.setMatrixAt(r++, this._m);
      }
      if ((sel || u.hp < u.maxHp) && b < MAX_UNITS) {
        // Bigger when the camera is further away, so they stay readable zoomed out.
        const y = u.y + u.height + 0.8, k = Math.min(2.6, Math.max(1, camera.position.distanceTo(this._p.set(u.x, y, u.z)) / 55));
        const wdt = Math.max(1.8, u.radius * 1.8) * k, frac = Math.max(0, u.hp / u.maxHp);
        this._m.compose(this._p.set(u.x, y, u.z), camQ, this._s.set(wdt + 0.24 * k, 0.6 * k, 1));
        this.barBg.setMatrixAt(b, this._m);
        // Foreground bar shrinks from the right: shift its centre left along the camera's right vector.
        this._p.set(-(1 - frac) * wdt / 2, 0, 0).applyQuaternion(camQ).add(this._s.set(u.x, y, u.z));
        this._m.compose(this._p, camQ, this._s.set(Math.max(0.001, wdt * frac), 0.4 * k, 1));
        this.barFg.setMatrixAt(b, this._m);
        this.barFg.setColorAt(b, this._c.setHex(frac > 0.6 ? 0x3dff5a : frac > 0.3 ? 0xffe62e : 0xff2e2e));
        b++;
      }
    }
    this.rings.count = r; this.barBg.count = this.barFg.count = b;
    for (const m of [this.rings, this.barBg, this.barFg]) m.instanceMatrix.needsUpdate = true;
    if (this.barFg.instanceColor) this.barFg.instanceColor.needsUpdate = true;

    // Tracers: a streak from where the projectile was to where it is.
    let t = 0;
    for (const p of units.projectiles.list) {
      if (t >= MAX_TRACERS || p.px === undefined || !this.inView(p.x, p.z)) continue;
      const dx = p.x - p.px, dy = p.y - p.py, dz = p.z - p.pz, len = Math.hypot(dx, dy, dz) || 0.01;
      const w = p.kind === 'mg' ? 0.1 : p.kind === 'cannon' ? 0.25 : 0.55;
      const l = p.kind === 'shell' ? 0.8 : Math.max(len, p.kind === 'mg' ? 1.6 : 1.1);
      this._q.setFromUnitVectors(this._p.set(0, 0, 1), this._s.set(dx / len, dy / len, dz / len));
      this._m.compose(this._p.set(p.x - dx / 2, p.y - dy / 2, p.z - dz / 2), this._q, this._s.set(w, w, l));
      this.tracers.setMatrixAt(t, this._m);
      this.tracers.setColorAt(t, this._c.setHex(p.kind === 'mg' ? 0xfff08a : p.kind === 'cannon' ? 0xffa040 : 0xff7a2a));
      t++;
    }
    this.tracers.count = t;
    this.tracers.instanceMatrix.needsUpdate = true;
    if (this.tracers.instanceColor) this.tracers.instanceColor.needsUpdate = true;
  }

  // Construction sites (yellow): a wall rising as it is built, a pad for a turret not yet started, a marked line
  // for trench still to dig. Plus the placement preview while a Builder order is being drawn (green / red).
  _sites(n, construction, preview) {
    const box = (x, y, z, rot, w, h, d, color) => {
      if (n >= MAX_PARTS) return;
      this._m.compose(this._p.set(x, y, z), this._q.setFromAxisAngle(this._y, rot), this._s.set(w, h, d));
      this.parts.setMatrixAt(n, this._m);
      this.parts.setColorAt(n, this._c.setHex(color));
      n++;
    };
    const hf = this.heightAt;
    const draw = (j, color, planned) => {
      const y = hf(j.x, j.z);
      if (j.kind === 'turret') { if (planned || !j.structure) box(j.x, y + 0.08, j.z, 0, 3, 0.16, 3, color); return; }
      if (j.kind === 'wall') {
        const h = planned ? 0.7 : Math.max(0.12, 2.6 * j.progress);
        box(j.x, y + (planned ? 0.1 : h / 2), j.z, j.rot, j.len, h, planned ? 0.5 : 0.8, color);
        if (!planned) for (const e of [-0.5, 0.5]) box(j.x + Math.cos(j.rot) * j.len * e, y + 1.4, j.z - Math.sin(j.rot) * j.len * e, j.rot, 0.15, 2.8, 0.15, ROLE.dark);
        return;
      }
      // Trench: a marker line along what is still to dig.
      const from = planned ? 0 : j.dug, L = j.len - from;
      if (L < 0.3) return;
      const dx = (j.bx - j.ax) / j.len, dz = (j.bz - j.az) / j.len, cx = j.ax + dx * (from + L / 2), cz = j.az + dz * (from + L / 2);
      box(cx, hf(cx, cz) + 0.1, cz, j.rot, L, planned ? 0.5 : 0.3, planned ? 0.6 : 0.3, color);
    };
    if (construction) for (const j of construction.jobs) if (!j.done && j.team === 0) draw(j, SITE.plan, false);
    if (preview) for (const p of preview) draw(p, p.ok ? SITE.ok : SITE.bad, true);
    return n;
  }

  // Unit under a screen ray (closest to the ray within its body), or null.
  // withStructures: HQs can be picked too (to attack them).
  pick(ray, units, team = null, withStructures = false) {
    let best = null, bd = Infinity;
    const c = new THREE.Vector3(), p = new THREE.Vector3();
    for (const u of withStructures && units.structures ? [...units.list, ...units.structures] : units.list) {
      if (!u.alive || (team !== null && u.team !== team)) continue;
      c.set(u.x, u.y + u.height * 0.55, u.z);
      ray.closestPointToPoint(c, p);
      const d = p.distanceTo(c);
      if (d < Math.max(u.radius, u.height * 0.5) + 0.8 && d < bd) { bd = d; best = u; }
    }
    return best;
  }
}
