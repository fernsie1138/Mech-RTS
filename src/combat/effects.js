// Pooled visual effects. Nothing is created or destroyed during play: a fixed set of meshes is reused.
import * as THREE from 'three';

const FLASH_TIME = 0.22;
const SMOKE_TIME = 1.6;
const DEBRIS_PER = 6;
const DEBRIS_TIME = 1.1;

export class Effects {
  constructor(scene, poolSize = 32) {
    this.pool = [];
    this.next = 0;
    const flashGeo = new THREE.SphereGeometry(1, 12, 8);
    const smokeGeo = new THREE.IcosahedronGeometry(1, 1);
    const debrisGeo = new THREE.BoxGeometry(1, 1, 1);
    // One debris InstancedMesh for all pooled explosions.
    this.debrisMesh = new THREE.InstancedMesh(debrisGeo, new THREE.MeshLambertMaterial({ color: 0x4a3c2c }), poolSize * DEBRIS_PER);
    this.debrisMesh.frustumCulled = false;
    this.debrisMesh.count = poolSize * DEBRIS_PER;
    this.debris = [];
    const m = new THREE.Matrix4().makeScale(0, 0, 0);
    for (let i = 0; i < poolSize * DEBRIS_PER; i++) {
      this.debrisMesh.setMatrixAt(i, m);
      this.debris.push({ t: DEBRIS_TIME, x: 0, y: 0, z: 0, vx: 0, vy: 0, vz: 0, s: 0, groundAt: 0 });
    }
    scene.add(this.debrisMesh);
    for (let i = 0; i < poolSize; i++) {
      const flash = new THREE.Mesh(flashGeo, new THREE.MeshBasicMaterial({
        color: 0xffc061, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
      }));
      const smoke = new THREE.Mesh(smokeGeo, new THREE.MeshLambertMaterial({
        color: 0x5e554b, transparent: true, depthWrite: false,
      }));
      flash.visible = smoke.visible = false;
      flash.frustumCulled = smoke.frustumCulled = false;
      scene.add(flash, smoke);
      this.pool.push({ flash, smoke, t: Infinity, size: 1 });
    }
    this._m = new THREE.Matrix4();
    this._q = new THREE.Quaternion();
    this._e = new THREE.Euler();
    this._v = new THREE.Vector3();
    this._s = new THREE.Vector3();
  }

  // size ~ crater radius. heightAt lets debris land on the terrain.
  explosion(x, y, z, size, heightAt) {
    const fx = this.pool[this.next];
    const slot = this.next;
    this.next = (this.next + 1) % this.pool.length;
    fx.t = 0; fx.size = size;
    fx.flash.position.set(x, y + size * 0.3, z);
    fx.smoke.position.set(x, y + size * 0.4, z);
    fx.flash.visible = fx.smoke.visible = true;
    fx.smoke.rotation.set(Math.random() * 6, Math.random() * 6, 0);
    for (let n = 0; n < DEBRIS_PER; n++) {
      const d = this.debris[slot * DEBRIS_PER + n];
      const a = Math.random() * Math.PI * 2, sp = (2 + Math.random() * 4) * Math.sqrt(size);
      d.t = 0; d.x = x; d.y = y + 0.3; d.z = z;
      d.vx = Math.cos(a) * sp; d.vz = Math.sin(a) * sp; d.vy = (5 + Math.random() * 6) * Math.sqrt(size);
      d.s = (0.15 + Math.random() * 0.2) * Math.sqrt(size);
      d.heightAt = heightAt;
    }
  }

  update(dt) {
    for (const fx of this.pool) {
      if (fx.t === Infinity) continue;
      fx.t += dt;
      const ft = fx.t / FLASH_TIME;
      if (ft < 1) {
        fx.flash.scale.setScalar(fx.size * (0.6 + ft * 1.2));
        fx.flash.material.opacity = 1 - ft;
      } else fx.flash.visible = false;
      const st = fx.t / SMOKE_TIME;
      if (st < 1) {
        fx.smoke.scale.setScalar(fx.size * (0.5 + st * 1.4));
        fx.smoke.position.y += dt * fx.size * 0.8;
        fx.smoke.material.opacity = 0.7 * (1 - st);
      } else { fx.smoke.visible = false; fx.t = Infinity; }
    }
    let any = false;
    for (let i = 0; i < this.debris.length; i++) {
      const d = this.debris[i];
      if (d.t >= DEBRIS_TIME) continue;
      any = true;
      d.t += dt;
      d.vy -= 25 * dt;
      d.x += d.vx * dt; d.y += d.vy * dt; d.z += d.vz * dt;
      const g = d.heightAt ? d.heightAt(d.x, d.z) : 0;
      if (d.y < g) { d.y = g; d.vy *= -0.3; d.vx *= 0.5; d.vz *= 0.5; }
      const s = d.t >= DEBRIS_TIME ? 0 : d.s;
      this._e.set(d.t * 7 + i, d.t * 5, 0);
      this._m.compose(this._v.set(d.x, d.y, d.z), this._q.setFromEuler(this._e), this._s.set(s, s, s));
      this.debrisMesh.setMatrixAt(i, this._m);
    }
    if (any || this._wasAny) this.debrisMesh.instanceMatrix.needsUpdate = true;
    this._wasAny = any;
  }

  activeCount() { return this.pool.filter(f => f.t !== Infinity).length; }
}
