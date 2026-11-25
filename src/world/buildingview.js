// Draws buildings and bridges: one InstancedMesh for all box pieces, one for gable roofs. Destroyed pieces
// tumble down for a moment and then disappear (their rubble is already in the terrain).
import * as THREE from 'three';

function prismGeometry() {
  // Unit gable prism: ridge along x, triangle in the y-z plane, centred on the origin (y from -0.5 to 0.5).
  const v = [
    [-0.5, -0.5, -0.5], [-0.5, -0.5, 0.5], [-0.5, 0.5, 0], [0.5, -0.5, -0.5], [0.5, -0.5, 0.5], [0.5, 0.5, 0],
  ];
  // Counter-clockwise seen from outside (so the outer faces are the front faces).
  const tris = [[0, 1, 2], [3, 5, 4], [0, 5, 3], [0, 2, 5], [1, 5, 2], [1, 4, 5], [0, 4, 1], [0, 3, 4]];
  const pos = [];
  for (const t of tris) for (const i of t) pos.push(...v[i]);
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.computeVertexNormals();
  return g;
}

const FALL_TIME = 1.1;

export class BuildingView {
  constructor(scene, heightAt) {
    this.heightAt = heightAt;
    this.group = new THREE.Group();
    this.group.name = 'buildings';
    scene.add(this.group);
    this.boxGeo = new THREE.BoxGeometry(1, 1, 1);
    this.prismGeo = prismGeometry();
    this.mat = new THREE.MeshLambertMaterial({ flatShading: true });
    this.meshes = [];
    this.anims = [];
    this._m = new THREE.Matrix4(); this._q = new THREE.Quaternion(); this._p = new THREE.Vector3(); this._s = new THREE.Vector3();
    this._e = new THREE.Euler(); this._c = new THREE.Color();
    this._ray = new THREE.Raycaster();
    this.maxChunks = 3000;
    this.chunkMesh = new THREE.InstancedMesh(new THREE.DodecahedronGeometry(0.5, 0), new THREE.MeshLambertMaterial({ flatShading: true }), this.maxChunks);
    this.chunkMesh.count = 0;
    this.chunkMesh.castShadow = this.chunkMesh.receiveShadow = true;
    this.chunkMesh.frustumCulled = false;
    this.group.add(this.chunkMesh);
  }

  // Rubble chunks: rewritten when they change or the ground under them moves.
  _writeChunks() {
    const B = this.buildings, list = B.chunks.filter(c => c.alive).slice(-this.maxChunks);
    list.forEach((c, n) => {
      this._e.set(c.rot, c.rot * 1.7, 0);
      this._m.compose(this._p.set(c.x, this.heightAt(c.x, c.z) + c.s * 0.2, c.z), this._q.setFromEuler(this._e), this._s.set(c.s * 1.4, c.s, c.s * 1.1));
      this.chunkMesh.setMatrixAt(n, this._m);
      this.chunkMesh.setColorAt(n, this._c.setHex(c.color).multiplyScalar(0.75));
    });
    this.chunkMesh.count = list.length;
    this.chunkMesh.instanceMatrix.needsUpdate = true;
    if (this.chunkMesh.instanceColor) this.chunkMesh.instanceColor.needsUpdate = true;
    B.chunksChanged = false;
  }

  setBuildings(buildings) {
    this.buildings = buildings;
    for (const m of this.meshes) { this.group.remove(m); m.dispose(); }
    const ps = buildings.pieces;
    const nBox = ps.filter(p => p.kind === 'box').length, nPrism = ps.length - nBox;
    this.box = new THREE.InstancedMesh(this.boxGeo, this.mat, Math.max(1, nBox));
    this.prism = new THREE.InstancedMesh(this.prismGeo, this.mat, Math.max(1, nPrism));
    this.box.count = nBox; this.prism.count = nPrism;
    this.meshes = [this.box, this.prism];
    this.slot = new Int32Array(ps.length);
    this.pieceOf = [[], []];             // mesh index -> instance -> piece index
    let a = 0, b = 0;
    ps.forEach((p, i) => {
      if (p.kind === 'box') { this.slot[i] = a; this.pieceOf[0][a++] = i; }
      else { this.slot[i] = b; this.pieceOf[1][b++] = i; }
    });
    for (const m of this.meshes) {
      m.castShadow = m.receiveShadow = true;
      m.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
      this.group.add(m);
    }
    ps.forEach((p, i) => this._write(i));
    this.anims = [];
    this._writeChunks();
    buildings.changed.clear();
    buildings.falling.length = 0;
    this._flush();
  }

  _mesh(p) { return p.kind === 'box' ? this.box : this.prism; }

  _write(i, override) {
    const p = this.buildings.pieces[i];
    if (!p.alive && !override) this._m.makeScale(0, 0, 0);
    else {
      const o = override || { x: p.px, y: p.py, z: p.pz, rx: 0, rz: 0 };
      this._e.set(o.rx, p.rot, o.rz, 'YXZ');
      this._m.compose(this._p.set(o.x, o.y, o.z), this._q.setFromEuler(this._e), this._s.set(p.sx, p.sy, p.sz));
    }
    const mesh = this._mesh(p);
    mesh.setMatrixAt(this.slot[i], this._m);
    // Damaged pieces darken a little.
    const hpFrac = p.alive ? Math.max(0, p.hp / p.maxHp) : 0.3;
    this._c.setHex(p.color).multiplyScalar(0.6 + 0.4 * hpFrac);
    mesh.setColorAt(this.slot[i], this._c);
  }

  _flush() {
    for (const m of this.meshes) {
      m.instanceMatrix.needsUpdate = true;
      if (m.instanceColor) m.instanceColor.needsUpdate = true;
      m.computeBoundingSphere();
    }
  }

  update(dt) {
    const B = this.buildings;
    if (!B) return;
    let dirty = false;
    for (const f of B.falling) {
      const p = B.pieces[f.i];
      this.anims.push({ ...f, t: 0, x: p.px, y: p.py, z: p.pz, rx: 0, rz: 0 });
    }
    B.falling.length = 0;
    for (const i of B.changed) { this._write(i); dirty = true; }
    B.changed.clear();
    // Hit pieces show damage (colour) as soon as they are hit.
    if (this.anims.length) {
      dirty = true;
      this.anims = this.anims.filter(a => {
        a.t += dt;
        if (a.t >= FALL_TIME) { this._write(a.i); return false; }
        a.vy -= 20 * dt;
        a.x += a.vx * dt; a.y += a.vy * dt; a.z += a.vz * dt;
        const g = this.heightAt(a.x, a.z);
        if (a.y < g) { a.y = g; a.vy = 0; a.vx *= 0.6; a.vz *= 0.6; }
        a.rx += a.spin * dt; a.rz += a.spin * 0.7 * dt;
        this._write(a.i, a);
        return true;
      });
    }
    if (dirty) this._flush();
    if (B.chunksChanged) this._writeChunks();
  }

  // Recolour every standing piece (after blasts that damaged but didn't destroy).
  refreshColors() { this.buildings.pieces.forEach((p, i) => { if (p.alive) this._write(i); }); this._flush(); }

  // First building piece hit by a ray, or null: { point, piece }.
  pick(ray) {
    this._ray.ray.copy(ray);
    const hits = this._ray.intersectObjects(this.meshes, false);
    for (const h of hits) {
      const m = h.object === this.box ? 0 : 1;
      const i = this.pieceOf[m][h.instanceId];
      if (i !== undefined && this.buildings.pieces[i].alive) return { point: h.point, piece: i };
    }
    return null;
  }
}
