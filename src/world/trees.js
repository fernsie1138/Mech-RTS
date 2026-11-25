// Draws the forest with InstancedMesh (CLAUDE.md §6.1): one draw call per tree type, one for stumps, one for flames.
// Reads Forest data and its `changed` set; never creates or destroys meshes during play.
import * as THREE from 'three';
import { TREE } from './forest.js';

// Merge simple geometries (each given a flat colour) into one non-indexed geometry with vertex colours.
function merge(parts) {
  const pos = [], nrm = [], col = [];
  for (const [g, hex] of parts) {
    const ng = g.index ? g.toNonIndexed() : g;
    ng.computeVertexNormals();
    const c = new THREE.Color(hex);
    pos.push(...ng.attributes.position.array);
    nrm.push(...ng.attributes.normal.array);
    for (let i = 0; i < ng.attributes.position.count; i++) col.push(c.r, c.g, c.b);
  }
  const out = new THREE.BufferGeometry();
  out.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  out.setAttribute('normal', new THREE.Float32BufferAttribute(nrm, 3));
  out.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
  return out;
}

function conifer() {
  return merge([
    [new THREE.CylinderGeometry(0.18, 0.25, 1.4, 6).translate(0, 0.7, 0), 0x5a4030],
    [new THREE.ConeGeometry(1.6, 3.2, 7).translate(0, 2.6, 0), 0x2f5a2c],
    [new THREE.ConeGeometry(1.15, 2.6, 7).translate(0, 4.2, 0), 0x386b33],
  ]);
}
function broadleaf() {
  return merge([
    [new THREE.CylinderGeometry(0.2, 0.3, 2.0, 6).translate(0, 1.0, 0), 0x5e4532],
    [new THREE.IcosahedronGeometry(1.7, 0).translate(0, 3.2, 0), 0x4c7a33],
    [new THREE.IcosahedronGeometry(1.2, 0).translate(0.7, 4.0, 0.3), 0x5a8a3a],
  ]);
}

const WHITE = new THREE.Color(1, 1, 1), BURNT = new THREE.Color(0.22, 0.18, 0.15), BURNING = new THREE.Color(0.5, 0.25, 0.12);

export class TreeView {
  constructor(scene, forest, heightAt) {
    this.scene = scene;
    this.heightAt = heightAt;
    this.group = new THREE.Group();
    this.group.name = 'trees';
    scene.add(this.group);
    this.geos = [conifer(), broadleaf()];
    this.mat = new THREE.MeshLambertMaterial({ vertexColors: true });
    this.stumpGeo = new THREE.CylinderGeometry(0.28, 0.34, 0.6, 6).translate(0, 0.3, 0);
    this.stumpMat = new THREE.MeshLambertMaterial({ color: 0x4a3a2c });
    this.flameGeo = new THREE.ConeGeometry(0.9, 2.4, 6).translate(0, 1.2, 0);
    this.flameMat = new THREE.MeshBasicMaterial({ color: 0xff8a2a, transparent: true, opacity: 0.85, blending: THREE.AdditiveBlending, depthWrite: false });
    this.maxFlames = 96;
    this.flames = new THREE.InstancedMesh(this.flameGeo, this.flameMat, this.maxFlames);
    this.flames.frustumCulled = false;
    this.flames.count = 0;
    this.group.add(this.flames);
    this.time = 0;
    this._m = new THREE.Matrix4(); this._q = new THREE.Quaternion(); this._p = new THREE.Vector3(); this._s = new THREE.Vector3();
    this._e = new THREE.Euler(0, 0, 0, 'YXZ'); this._c = new THREE.Color();
    this.setForest(forest);
  }

  // Show a forest (on load, or when the editor changes the tree list). Instanced meshes are reused while
  // they have room, and grown by 1.5x when they don't.
  setForest(forest) {
    this.forest = forest;
    const trees = forest.trees;
    const counts = [0, 0];
    for (const t of trees) counts[t.t]++;
    const need = [...counts, trees.length];
    if (!this.meshes || need.some((n, k) => n > this.meshes[k].instanceMatrix.count)) {
      for (const m of this.meshes || []) { this.group.remove(m); m.dispose(); }
      const cap = need.map((n, k) => Math.max(16, Math.ceil(Math.max(n, this.meshes ? this.meshes[k].instanceMatrix.count : 0) * 1.5)));
      this.meshes = this.geos.map((g, type) => {
        const m = new THREE.InstancedMesh(g, this.mat, cap[type]);
        m.castShadow = true;
        m.receiveShadow = true;
        m.name = type ? 'broadleaf' : 'conifer';
        m.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
        return m;
      });
      this.stumps = new THREE.InstancedMesh(this.stumpGeo, this.stumpMat, cap[2]);
      this.stumps.castShadow = true;
      this.stumps.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
      this.meshes.push(this.stumps);
      for (const m of this.meshes) this.group.add(m);
    }
    this.meshes[0].count = counts[0];
    this.meshes[1].count = counts[1];
    this.stumps.count = trees.length;
    // Each tree gets a slot in its type's mesh, and a slot in the stump mesh.
    this.slot = new Int32Array(trees.length);
    const next = [0, 0];
    trees.forEach((t, i) => { this.slot[i] = next[t.t]++; });
    for (let i = 0; i < trees.length; i++) this._write(i);
    this._flush();
    forest.changed.clear();
    forest.allChanged = false;
  }

  _write(i) {
    const t = this.forest.trees[i], mesh = this.meshes[t.t], slot = this.slot[i];
    const y = this.heightAt(t.x, t.z);
    // Tree body.
    if (t.state === TREE.STUMP) {
      this._m.makeScale(0, 0, 0);
    } else if (t.state === TREE.FALLEN) {
      // Lie along `dir`: rotate the upright tree 90 degrees about the horizontal axis across that direction.
      this._e.set(Math.PI / 2 - 0.08, Math.PI / 2 - t.dir, 0);
      this._q.setFromEuler(this._e);
      this._m.compose(this._p.set(t.x, y + 0.25, t.z), this._q, this._s.setScalar(t.s));
    } else {
      this._q.setFromAxisAngle(this._p.set(0, 1, 0), (t.x * 7.13 + t.z * 3.7) % 6.28);
      this._m.compose(this._p.set(t.x, y - 0.1, t.z), this._q, this._s.setScalar(t.s));
    }
    mesh.setMatrixAt(slot, this._m);
    mesh.setColorAt(slot, t.burn > 0 ? BURNING : t.charred ? BURNT : WHITE);
    // Stump: visible once the tree is gone or lying down.
    if (t.state === TREE.STANDING) this._m.makeScale(0, 0, 0);
    else this._m.compose(this._p.set(t.x, y - 0.05, t.z), this._q.identity(), this._s.set(t.s, t.s * (t.charred ? 0.6 : 1), t.s));
    this.stumps.setMatrixAt(i, this._m);
    this.stumps.setColorAt(i, t.charred ? BURNT : WHITE);
  }

  _flush() {
    for (const m of this.meshes) {
      m.instanceMatrix.needsUpdate = true;
      if (m.instanceColor) m.instanceColor.needsUpdate = true;
      m.computeBoundingSphere();         // for frustum culling
    }
  }

  // Ground changed in a world-space circle: re-seat the trees there.
  reseat(x, z, r) { for (const i of this.forest.near(x, z, r)) this.forest.changed.add(i); }

  update(dt) {
    this.time += dt;
    const f = this.forest;
    if (f.allChanged) { this.setForest(f); }
    else if (f.changed.size) {
      for (const i of f.changed) this._write(i);
      f.changed.clear();
      this._flush();
    }
    // Flames on burning trees (nearest-first is unnecessary: cap is generous for one fire front).
    let n = 0;
    for (const i of f.burning) {
      if (n >= this.maxFlames) break;
      const t = f.trees[i];
      const flick = 0.75 + 0.35 * Math.sin(this.time * 13 + i * 1.7) * Math.sin(this.time * 7.3 + i);
      const y = this.heightAt(t.x, t.z);
      if (t.state === TREE.FALLEN) {
        this._m.compose(this._p.set(t.x + Math.cos(t.dir) * 2 * t.s, y, t.z + Math.sin(t.dir) * 2 * t.s), this._q.identity(), this._s.set(1.3 * t.s, flick * t.s, 1.3 * t.s));
      } else {
        this._m.compose(this._p.set(t.x, y + 1.2 * t.s, t.z), this._q.identity(), this._s.set(t.s, flick * 1.6 * t.s, t.s));
      }
      this.flames.setMatrixAt(n++, this._m);
    }
    this.flames.count = n;
    if (n) this.flames.instanceMatrix.needsUpdate = true;
  }
}
