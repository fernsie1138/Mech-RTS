// Explosions, fire, smoke, dust, sparks and debris (CLAUDE.md §10: pooled, nothing created during play).
//
// Each kind of particle lives in one InstancedMesh with a fixed capacity, so a whole barrage costs a handful of
// draw calls. When a pool is full the oldest particle is reused. Particles carry their own opacity (an extra
// per-instance attribute patched into the material), colour ramp, size ramp, gravity, buoyancy and drag, and
// smoke is carried sideways by a light wind as it rises and fades.
//
//   explosion(x, y, z, size)   flash of light, fireball, shockwave ring, sparks, debris (some trailing smoke),
//                              ground dust and a smoke cloud that lingers and drifts
//   fire(x, y, z, size, secs)  a burning spot: flames and smoke for a while (buildings and rubble that were hit)
//   smokePuff(x, y, z, size)   one drifting smoke puff (burning trees)
//   dust(x, y, z, size)        a small dust cloud (collapsing walls, move orders)
import * as THREE from 'three';

export const EFFECTS = {
  wind: { x: 1.6, z: 0.8 },          // world units / s that smoke drifts toward, once it has risen a little
  scale: 1.5,                        // overall size of explosion visuals relative to the crater size
  smokeLife: [6, 10],                // seconds a big explosion's smoke lasts
};

const rand = (a, b) => a + Math.random() * (b - a);

// Patch a material so each instance has its own opacity (attribute iAlpha).
function withInstanceAlpha(mat) {
  mat.onBeforeCompile = sh => {
    sh.vertexShader = 'attribute float iAlpha;\nvarying float vIAlpha;\n' +
      sh.vertexShader.replace('#include <begin_vertex>', '#include <begin_vertex>\n  vIAlpha = iAlpha;');
    sh.fragmentShader = 'varying float vIAlpha;\n' +
      sh.fragmentShader.replace('#include <dithering_fragment>', '#include <dithering_fragment>\n  gl_FragColor.a *= vIAlpha;');
  };
  mat.customProgramCacheKey = () => 'iAlpha';
  return mat;
}

// A pool of particles drawn with one InstancedMesh.
class Pool {
  constructor(scene, geo, mat, max, { alpha = true, ground = false } = {}) {
    this.max = max;
    this.ground = ground;
    this.mesh = new THREE.InstancedMesh(geo, alpha ? withInstanceAlpha(mat) : mat, max);
    this.mesh.frustumCulled = false;
    this.mesh.count = 0;
    this.mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.mesh.setColorAt(0, new THREE.Color());
    this.mesh.instanceColor.setUsage(THREE.DynamicDrawUsage);
    if (alpha) {
      this.alpha = new THREE.InstancedBufferAttribute(new Float32Array(max), 1).setUsage(THREE.DynamicDrawUsage);
      this.mesh.geometry.setAttribute('iAlpha', this.alpha);
    }
    scene.add(this.mesh);
    const F = () => new Float32Array(max);
    Object.assign(this, {
      px: F(), py: F(), pz: F(), vx: F(), vy: F(), vz: F(), age: F(), life: F(), s0: F(), s1: F(),
      r0: F(), g0: F(), b0: F(), r1: F(), g1: F(), b1: F(), a0: F(), a1: F(), rot: F(), spin: F(),
      drag: F(), grav: F(), buoy: F(), wind: F(), trail: F(), trailT: F(),
    });
    this.used = 0;          // high-water mark: slots [0, used) may be alive
    this.next = 0;
    this.alive = 0;
    this._m = new THREE.Matrix4(); this._q = new THREE.Quaternion(); this._e = new THREE.Euler(); this._p = new THREE.Vector3(); this._s = new THREE.Vector3(); this._c = new THREE.Color();
  }

  // Add a particle. o: { x,y,z, vx,vy,vz, life, s0,s1, c0:[r,g,b], c1, a0,a1, spin, drag, grav, buoy, wind, trail }
  emit(o) {
    let i;
    if (this.used < this.max) i = this.used++;
    else { i = this.next; this.next = (this.next + 1) % this.max; if (this.age[i] < this.life[i]) this.alive--; }
    this.px[i] = o.x; this.py[i] = o.y; this.pz[i] = o.z;
    this.vx[i] = o.vx || 0; this.vy[i] = o.vy || 0; this.vz[i] = o.vz || 0;
    this.age[i] = 0; this.life[i] = o.life;
    this.s0[i] = o.s0; this.s1[i] = o.s1 ?? o.s0;
    const c0 = o.c0, c1 = o.c1 || o.c0;
    this.r0[i] = c0[0]; this.g0[i] = c0[1]; this.b0[i] = c0[2]; this.r1[i] = c1[0]; this.g1[i] = c1[1]; this.b1[i] = c1[2];
    this.a0[i] = o.a0 ?? 1; this.a1[i] = o.a1 ?? 0;
    this.rot[i] = Math.random() * 6.28; this.spin[i] = o.spin ?? 0;
    this.drag[i] = o.drag ?? 0; this.grav[i] = o.grav ?? 0; this.buoy[i] = o.buoy ?? 0; this.wind[i] = o.wind ?? 0;
    this.trail[i] = o.trail ?? 0; this.trailT[i] = 0;
    this.alive++;
    return i;
  }

  // Advance and draw. onTrail(x, y, z, size) is called for particles that leave smoke trails.
  update(dt, heightAt, onTrail) {
    const W = EFFECTS.wind;
    let top = 0;
    for (let i = 0; i < this.used; i++) {
      if (this.age[i] >= this.life[i]) { this._hide(i); continue; }
      this.age[i] += dt;
      if (this.age[i] >= this.life[i]) { this.alive--; this._hide(i); continue; }
      top = i + 1;
      const t = this.age[i] / this.life[i];
      // Forces: gravity, buoyancy (fades out), drag, wind (grows as the particle rises and slows).
      const k = Math.max(0, 1 - this.drag[i] * dt);
      this.vx[i] = (this.vx[i] + W.x * this.wind[i] * t * dt * 3) * k;
      this.vz[i] = (this.vz[i] + W.z * this.wind[i] * t * dt * 3) * k;
      this.vy[i] = (this.vy[i] + (this.buoy[i] * (1 - t) - this.grav[i]) * dt) * k;
      this.px[i] += this.vx[i] * dt; this.py[i] += this.vy[i] * dt; this.pz[i] += this.vz[i] * dt;
      if (this.ground && heightAt) {
        const g = heightAt(this.px[i], this.pz[i]);
        if (this.py[i] < g) { this.py[i] = g; this.vy[i] *= -0.35; this.vx[i] *= 0.55; this.vz[i] *= 0.55; this.spin[i] *= 0.6; }
      }
      if (this.trail[i] && onTrail && t < 0.6) {
        this.trailT[i] += dt;
        if (this.trailT[i] > 0.07) { this.trailT[i] = 0; onTrail(this.px[i], this.py[i], this.pz[i], this.trail[i]); }
      }
      this.rot[i] += this.spin[i] * dt;
      // Size grows fast at first then slows (ease out); colour and opacity ramp over the life.
      const e = 1 - (1 - t) * (1 - t);
      const s = this.s0[i] + (this.s1[i] - this.s0[i]) * e;
      this._e.set(this.rot[i], this.rot[i] * 0.7, 0);
      this._m.compose(this._p.set(this.px[i], this.py[i], this.pz[i]), this._q.setFromEuler(this._e), this._s.set(s, s, s));
      this.mesh.setMatrixAt(i, this._m);
      this._c.setRGB(this.r0[i] + (this.r1[i] - this.r0[i]) * t, this.g0[i] + (this.g1[i] - this.g0[i]) * t, this.b0[i] + (this.b1[i] - this.b0[i]) * t);
      this.mesh.setColorAt(i, this._c);
      if (this.alpha) this.alpha.array[i] = this.a0[i] + (this.a1[i] - this.a0[i]) * t;
    }
    this.mesh.count = top;
    if (this.used) {
      this.mesh.instanceMatrix.needsUpdate = true;
      this.mesh.instanceColor.needsUpdate = true;
      if (this.alpha) this.alpha.needsUpdate = true;
    }
    if (!this.alive) { this.used = 0; this.next = 0; this.mesh.count = 0; }
  }

  _hide(i) { this._m.makeScale(0, 0, 0); this.mesh.setMatrixAt(i, this._m); }
}

const DIRT = [[0.36, 0.28, 0.2], [0.42, 0.34, 0.24], [0.3, 0.25, 0.2], [0.45, 0.43, 0.4]];

export class Effects {
  constructor(scene, heightAt = null) {
    this.heightAt = heightAt;
    const ico0 = new THREE.IcosahedronGeometry(1, 0), ico1 = new THREE.IcosahedronGeometry(1, 1);
    this.smoke = new Pool(scene, ico1, new THREE.MeshLambertMaterial({ transparent: true, depthWrite: false, flatShading: true }), 1200);   // lower this if barrages are slow on the iPad
    // Debris smoke trails get their own pool, so a barrage's trails never push out the big smoke clouds.
    this.trails = new Pool(scene, ico0.clone(), new THREE.MeshLambertMaterial({ transparent: true, depthWrite: false, flatShading: true }), 500);
    this.fire = new Pool(scene, ico0.clone(), new THREE.MeshBasicMaterial({ transparent: true, depthWrite: false, blending: THREE.AdditiveBlending }), 700);
    this.sparks = new Pool(scene, new THREE.BoxGeometry(0.12, 0.12, 0.5), new THREE.MeshBasicMaterial({ transparent: true, depthWrite: false, blending: THREE.AdditiveBlending }), 700);
    this.debris = new Pool(scene, new THREE.DodecahedronGeometry(1, 0), new THREE.MeshLambertMaterial({ flatShading: true }), 700, { alpha: false, ground: true });
    this.rings = new Pool(scene, new THREE.RingGeometry(0.8, 1, 40).rotateX(-Math.PI / 2), new THREE.MeshBasicMaterial({ transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide }), 48);
    this.smoke.mesh.renderOrder = 3; this.trails.mesh.renderOrder = 3; this.fire.mesh.renderOrder = 4; this.sparks.mesh.renderOrder = 5; this.rings.mesh.renderOrder = 5;
    this.debris.mesh.castShadow = true;
    this.pools = [this.smoke, this.trails, this.fire, this.sparks, this.debris, this.rings];
    // One flash light, moved to the latest big explosion (a fixed light count: no shader recompiles).
    this.light = new THREE.PointLight(0xffb060, 0, 45, 1.4);
    scene.add(this.light);
    this.lightT = 0;
    this.burners = [];             // active fire spots: { x, y, z, size, t, dur, fAcc, sAcc, alive }
    this.maxBurners = 60;
  }

  // ---------- emitters ----------
  explosion(x, y, z, size, heightAt = this.heightAt) {
    if (heightAt) this.heightAt = heightAt;
    const S = size * EFFECTS.scale, big = size >= 1;
    const n = (base, per) => Math.max(1, Math.round(base + per * size));
    // Light flash.
    if (big && size * 60 >= this.light.intensity * 0.5) {
      this.light.position.set(x, y + S * 0.8, z);
      this.light.intensity = 40 + 35 * size;
      this.light.distance = 18 + 14 * size;
      this.lightT = 0.35 + 0.1 * size;
    }
    // Fireball: bright core, rolling orange puffs rising.
    for (let k = 0, N = n(3, 6); k < N; k++) {
      const a = rand(0, 6.28), r = rand(0, 0.5) * S, up = rand(1.5, 4) * Math.sqrt(size);
      this.fire.emit({ x: x + Math.cos(a) * r, y: y + rand(0.1, 0.6) * S, z: z + Math.sin(a) * r,
        vx: Math.cos(a) * rand(1, 4) * Math.sqrt(size), vy: up, vz: Math.sin(a) * rand(1, 4) * Math.sqrt(size),
        life: rand(0.45, 0.9) * (0.7 + 0.3 * size), s0: 0.3 * S, s1: rand(0.9, 1.4) * S,
        c0: [1, 0.78, 0.4], c1: [0.85, 0.22, 0.04], a0: 0.8, a1: 0, drag: 2.5, buoy: 4, spin: rand(-2, 2) });
    }
    if (big) this.rings.emit({ x, y: y + 0.2, z, life: 0.45, s0: 0.5 * S, s1: 4.5 * S, c0: [1, 0.85, 0.55], c1: [0.7, 0.4, 0.2], a0: 0.85, a1: 0 });
    // Sparks.
    for (let k = 0, N = n(4, 7); k < N; k++) {
      const a = rand(0, 6.28), up = rand(0.3, 1), sp = rand(8, 18) * Math.sqrt(size);
      this.sparks.emit({ x, y: y + 0.4, z, vx: Math.cos(a) * sp * (1 - up * 0.5), vy: sp * up, vz: Math.sin(a) * sp * (1 - up * 0.5),
        life: rand(0.35, 0.9), s0: rand(0.8, 1.6), s1: 0.3, c0: [1, 0.9, 0.5], c1: [1, 0.4, 0.1], a0: 1, a1: 0, grav: 22, drag: 0.6, spin: rand(-12, 12) });
    }
    // Debris: dirt clods and stones thrown up, tumbling, bouncing; a few trail smoke.
    for (let k = 0, N = n(3, 6); k < N; k++) {
      const a = rand(0, 6.28), out = rand(2, 7) * Math.sqrt(size), up = rand(6, 15) * Math.sqrt(size);
      const c = DIRT[k % DIRT.length], s = rand(0.12, 0.35) * Math.sqrt(size);
      this.debris.emit({ x, y: y + 0.3, z, vx: Math.cos(a) * out, vy: up, vz: Math.sin(a) * out, life: rand(2.5, 4.5),
        s0: s, s1: s * 0.7, c0: c, c1: c, grav: 24, drag: 0.15, spin: rand(-9, 9), trail: big && k % 4 === 0 ? 0.2 * Math.sqrt(size) : 0 });
    }
    // Ground dust thrown out low.
    for (let k = 0, N = n(2, 3); k < N; k++) {
      const a = rand(0, 6.28), sp = rand(3, 7) * Math.sqrt(size);
      this.smoke.emit({ x, y: y + 0.3, z, vx: Math.cos(a) * sp, vy: rand(0.2, 1), vz: Math.sin(a) * sp, life: rand(1.6, 2.8),
        s0: 0.4 * S, s1: rand(1.2, 1.8) * S, c0: [0.5, 0.42, 0.32], c1: [0.62, 0.56, 0.48], a0: 0.7, a1: 0, drag: 1.4, wind: 0.5 });
    }
    // Smoke: many puffs rising at different speeds into a billowing column, dark at first, greying, spreading
    // and drifting away with the wind.
    if (size >= 0.6) {
      const [l0, l1] = EFFECTS.smokeLife;
      for (let k = 0, N = n(4, 10); k < N; k++) {
        const a = rand(0, 6.28), r = rand(0, 0.7) * S, rise = rand(0.6, 2.4);
        const g = rand(0.08, 0.22);
        this.smoke.emit({ x: x + Math.cos(a) * r, y: y + rand(0.2, 1) * S, z: z + Math.sin(a) * r,
          vx: Math.cos(a) * rand(0.5, 2.5), vy: rise * 1.8 * Math.sqrt(size), vz: Math.sin(a) * rand(0.5, 2.5),
          life: rand(l0, l1) * (0.55 + 0.25 * size), s0: 0.3 * S, s1: rand(0.9, 1.7) * S,
          c0: [g, g * 0.96, g * 0.92], c1: [0.55, 0.54, 0.52], a0: 0.8, a1: 0, drag: 0.75, buoy: 0.7 * rise, wind: 1.8, spin: rand(-0.6, 0.6) });
      }
    }
  }

  // Coloured debris (pieces of a building) flung from a point.
  rubble(x, y, z, color, count = 4, size = 1) {
    const c = new THREE.Color(color), rgb = [c.r * 0.8, c.g * 0.8, c.b * 0.8];
    for (let k = 0; k < count; k++) {
      const a = rand(0, 6.28), sp = rand(2, 6), s = rand(0.15, 0.45) * size;
      this.debris.emit({ x, y, z, vx: Math.cos(a) * sp, vy: rand(3, 9), vz: Math.sin(a) * sp, life: rand(2.5, 4), s0: s, s1: s, c0: rgb, c1: rgb, grav: 24, drag: 0.15, spin: rand(-8, 8) });
    }
  }

  // Muzzle flash when a mech fires (size ~ weapon).
  muzzle(x, y, z, size) {
    for (let k = 0; k < 2 + Math.round(size * 2); k++) {
      this.fire.emit({ x, y, z, vx: rand(-1, 1), vy: rand(0, 1.5), vz: rand(-1, 1), life: rand(0.06, 0.14), s0: 0.35 * size, s1: 0.8 * size,
        c0: [1, 0.9, 0.55], c1: [1, 0.5, 0.15], a0: 0.95, a1: 0 });
    }
    if (size >= 0.8) this.smokePuff(x, y, z, 0.5 * size, 0.3);
  }

  // Sparks where a round strikes armour.
  sparksAt(x, y, z, n = 6) {
    for (let k = 0; k < n; k++) {
      const a = rand(0, 6.28), up = rand(0.2, 1), sp = rand(5, 12);
      this.sparks.emit({ x, y, z, vx: Math.cos(a) * sp, vy: sp * up, vz: Math.sin(a) * sp, life: rand(0.2, 0.5), s0: rand(0.6, 1.2), s1: 0.2,
        c0: [1, 0.95, 0.6], c1: [1, 0.5, 0.1], a0: 1, a1: 0, grav: 22, spin: rand(-12, 12) });
    }
  }

  smokePuff(x, y, z, size = 1, dark = 0.18) {
    this.smoke.emit({ x: x + rand(-0.3, 0.3) * size, y, z: z + rand(-0.3, 0.3) * size, vx: rand(-0.3, 0.3), vy: rand(1.2, 2.2), vz: rand(-0.3, 0.3),
      life: rand(2.5, 4), s0: 0.35 * size, s1: rand(1.4, 2) * size, c0: [dark, dark, dark], c1: [0.48, 0.47, 0.45], a0: 0.7, a1: 0, drag: 0.4, buoy: 0.6, wind: 1.2, spin: rand(-0.5, 0.5) });
  }

  dust(x, y, z, size) {
    for (let k = 0; k < 3 + Math.round(size * 2); k++) {
      const a = rand(0, 6.28), sp = rand(0.8, 2.2) * size;
      this.smoke.emit({ x, y: y + 0.2, z, vx: Math.cos(a) * sp, vy: rand(0.4, 1.2), vz: Math.sin(a) * sp, life: rand(1.2, 2.2),
        s0: 0.3 * size, s1: rand(1, 1.5) * size, c0: [0.52, 0.46, 0.38], c1: [0.62, 0.58, 0.52], a0: 0.6, a1: 0, drag: 1.2, wind: 0.4 });
    }
  }

  // A burning spot for `secs` seconds. alive(): optional, the fire goes out early when it returns false.
  burn(x, y, z, size, secs, alive = null) {
    if (this.burners.length >= this.maxBurners) this.burners.shift();
    this.burners.push({ x, y, z, size, t: 0, dur: secs, fAcc: 0, sAcc: Math.random(), alive });
  }

  // ---------- per frame ----------
  update(dt) {
    // Fires: flames continuously, smoke a few times a second; they die down at the end.
    this.burners = this.burners.filter(b => {
      b.t += dt;
      if (b.t >= b.dur || (b.alive && !b.alive())) return false;
      const fade = Math.min(1, (b.dur - b.t) / 2, b.t / 0.3);
      b.fAcc += dt * 22 * b.size;
      while (b.fAcc >= 1) {
        b.fAcc -= 1;
        this.fire.emit({ x: b.x + rand(-0.5, 0.5) * b.size, y: b.y, z: b.z + rand(-0.5, 0.5) * b.size, vx: rand(-0.4, 0.4), vy: rand(2, 3.5) * b.size, vz: rand(-0.4, 0.4),
          life: rand(0.4, 0.75), s0: 0.75 * b.size * fade, s1: 0.15, c0: [1, 0.72, 0.3], c1: [0.8, 0.18, 0.03], a0: 0.9, a1: 0, buoy: 1, spin: rand(-3, 3) });
      }
      b.sAcc += dt * 3.5 * b.size;
      while (b.sAcc >= 1) { b.sAcc -= 1; this.smokePuff(b.x, b.y + 1.2 * b.size, b.z, b.size, 0.12); }
      return true;
    });
    const trail = (x, y, z, s) => this.trails.emit({ x, y, z, vy: 0.4, life: rand(0.5, 0.9), s0: s, s1: s * 1.8, c0: [0.25, 0.23, 0.21], c1: [0.45, 0.44, 0.42], a0: 0.45, a1: 0, wind: 0.8, drag: 0.5 });
    for (const p of this.pools) p.update(dt, this.heightAt, p === this.debris ? trail : null);
    if (this.lightT > 0) { this.lightT -= dt; this.light.intensity *= Math.pow(0.0005, dt); if (this.lightT <= 0) this.light.intensity = 0; }
  }

  // Live particles per pool (tests / debug).
  counts() { return { smoke: this.smoke.alive, trails: this.trails.alive, fire: this.fire.alive, sparks: this.sparks.alive, debris: this.debris.alive, rings: this.rings.alive, burners: this.burners.length }; }
  activeCount() { return this.pools.reduce((s, p) => s + p.alive, 0) + this.burners.length; }
}
