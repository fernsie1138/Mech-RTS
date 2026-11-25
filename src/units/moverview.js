// Placeholder bodies for movers (milestone 6 test units; milestone 7 replaces them with mechs):
// a body and a "nose" per unit, a ring under selected units, and lines along their planned paths.
import * as THREE from 'three';

const COLORS = [0x6fc3ff, 0x3d7be0, 0x2a4fa0];     // small / medium / large
const MAX = 200;

export class MoverView {
  constructor(scene) {
    this.group = new THREE.Group();
    this.group.name = 'movers';
    scene.add(this.group);
    const body = new THREE.CylinderGeometry(0.8, 1, 1, 10).translate(0, 0.5, 0);
    const nose = new THREE.ConeGeometry(0.35, 0.9, 8).rotateX(Math.PI / 2).translate(0, 0.75, 0.9);
    this.body = new THREE.InstancedMesh(body, new THREE.MeshLambertMaterial(), MAX);
    this.nose = new THREE.InstancedMesh(nose, new THREE.MeshLambertMaterial({ color: 0xffd23a }), MAX);
    this.ring = new THREE.InstancedMesh(new THREE.RingGeometry(1.05, 1.25, 32).rotateX(-Math.PI / 2),
      new THREE.MeshBasicMaterial({ color: 0x7cff9a, transparent: true, opacity: 0.9, depthTest: false }), MAX);
    this.ring.renderOrder = 15;
    for (const m of [this.body, this.nose, this.ring]) { m.count = 0; m.frustumCulled = false; this.group.add(m); }
    this.body.castShadow = this.nose.castShadow = true;
    const lineGeo = new THREE.BufferGeometry();
    lineGeo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(6000 * 3), 3).setUsage(THREE.DynamicDrawUsage));
    this.lines = new THREE.LineSegments(lineGeo, new THREE.LineBasicMaterial({ color: 0x7cff9a, transparent: true, opacity: 0.8, depthTest: false }));
    this.lines.renderOrder = 14;
    this.lines.frustumCulled = false;
    this.group.add(this.lines);
    this._m = new THREE.Matrix4(); this._q = new THREE.Quaternion(); this._p = new THREE.Vector3(); this._s = new THREE.Vector3();
    this._y = new THREE.Vector3(0, 1, 0); this._c = new THREE.Color();
  }

  // movers: Movers, selected: Set of movers, standHeight: fn(x, z)
  update(movers, selected, standHeight) {
    const L = movers.list.slice(0, MAX);
    let r = 0;
    L.forEach((m, n) => {
      const h = [2.2, 3.2, 4.6][m.cls], s = m.radius;
      this._q.setFromAxisAngle(this._y, m.heading);
      this._m.compose(this._p.set(m.x, m.y, m.z), this._q, this._s.set(s, h, s));
      this.body.setMatrixAt(n, this._m);
      this.body.setColorAt(n, this._c.setHex(m.state === 'escaping' ? 0xff8a3a : COLORS[m.cls]));
      this._m.compose(this._p.set(m.x, m.y + h * 0.55, m.z), this._q, this._s.set(s, s, s));
      this.nose.setMatrixAt(n, this._m);
      if (selected.has(m)) {
        this._m.compose(this._p.set(m.x, m.y + 0.15, m.z), this._q.identity(), this._s.set(s, 1, s));
        this.ring.setMatrixAt(r++, this._m);
      }
    });
    this.body.count = this.nose.count = L.length;
    this.ring.count = r;
    for (const m of [this.body, this.nose, this.ring]) { m.instanceMatrix.needsUpdate = true; }
    if (this.body.instanceColor) this.body.instanceColor.needsUpdate = true;
    // Paths of selected movers (from the unit to each remaining waypoint).
    const pos = this.lines.geometry.attributes.position.array;
    let v = 0;
    const put = (x, z) => { pos[v++] = x; pos[v++] = standHeight(x, z) + 0.4; pos[v++] = z; };
    for (const m of selected) {
      if (!m.path || m.state !== 'moving') continue;
      let px = m.x, pz = m.z;
      for (let k = m.wp; k < m.path.points.length && v < pos.length - 600; k++) {
        const w = m.path.points[k], d = Math.hypot(w.x - px, w.z - pz), n = Math.max(1, Math.ceil(d / 3));
        for (let s = 0; s < n; s++) {      // short segments so the line follows the ground
          put(px + (w.x - px) * s / n, pz + (w.z - pz) * s / n);
          put(px + (w.x - px) * (s + 1) / n, pz + (w.z - pz) * (s + 1) / n);
        }
        px = w.x; pz = w.z;
      }
    }
    this.lines.geometry.setDrawRange(0, v / 3);
    this.lines.geometry.attributes.position.needsUpdate = true;
  }

  // Mover under a screen ray (nearest to the ray within its radius), or null.
  pick(ray, movers) {
    let best = null, bd = Infinity;
    const p = new THREE.Vector3(), c = new THREE.Vector3();
    for (const m of movers.list) {
      c.set(m.x, m.y + 1.5, m.z);
      ray.closestPointToPoint(c, p);
      const d = p.distanceTo(c);
      if (d < m.radius + 1 && d < bd) { bd = d; best = m; }
    }
    return best;
  }
}
