// Water surface meshes, chunked like the terrain. A chunk is rebuilt when the water level or the ground
// under it changes (at most a few per frame). Triangles are emitted only where there is water; vertices on the
// shore take the neighbouring water level so the surface meets the bank (the terrain hides the overlap).
import * as THREE from 'three';

const SHALLOW = new THREE.Color(0x6fa9a0), DEEP = new THREE.Color(0x1d4f73);

export class WaterMesh {
  constructor(water, { chunkCells, maxRebuildsPerFrame }) {
    this.water = water;
    this.hf = water.hf;
    this.chunkCells = chunkCells;
    this.maxRebuilds = maxRebuildsPerFrame;
    this.n = Math.ceil(this.hf.cells / chunkCells);
    this.group = new THREE.Group();
    this.group.name = 'water';
    this.material = new THREE.MeshPhongMaterial({
      vertexColors: true, transparent: true, opacity: 0.82, shininess: 80, specular: 0x557788, depthWrite: false,
    });
    this.chunks = [];
    this.dirty = new Set();
    this.rebuildCount = 0;
    for (let cz = 0; cz < this.n; cz++) for (let cx = 0; cx < this.n; cx++) this._make(cx, cz);
    const mark = (i0, j0, i1, j1) => this.markDirty(i0, j0, i1, j1);
    water.onChange(mark);
    this.hf.onChange(mark);
    this.rebuildAll();
  }

  _make(cx, cz) {
    const C = this.chunkCells, hf = this.hf;
    const i0 = cx * C, j0 = cz * C, i1 = Math.min(hf.cells, i0 + C), j1 = Math.min(hf.cells, j0 + C);
    const w = i1 - i0 + 1, d = j1 - j0 + 1;
    const pos = new Float32Array(w * d * 3), col = new Float32Array(w * d * 3);
    for (let j = 0; j < d; j++) for (let i = 0; i < w; i++) { const k = (j * w + i) * 3; pos[k] = hf.wx(i0 + i); pos[k + 2] = hf.wz(j0 + j); }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(pos, 3).setUsage(THREE.DynamicDrawUsage));
    geo.setAttribute('color', new THREE.BufferAttribute(col, 3).setUsage(THREE.DynamicDrawUsage));
    const nrm = new Float32Array(w * d * 3);
    for (let k = 1; k < nrm.length; k += 3) nrm[k] = 1;
    geo.setAttribute('normal', new THREE.BufferAttribute(nrm, 3));
    const idx = new (w * d > 65535 ? Uint32Array : Uint16Array)((w - 1) * (d - 1) * 6);
    geo.setIndex(new THREE.BufferAttribute(idx, 1).setUsage(THREE.DynamicDrawUsage));
    geo.boundingBox = new THREE.Box3(); geo.boundingSphere = new THREE.Sphere();
    const mesh = new THREE.Mesh(geo, this.material);
    mesh.receiveShadow = true;
    mesh.matrixAutoUpdate = false;
    mesh.renderOrder = 2;
    mesh.visible = false;
    this.group.add(mesh);
    this.chunks.push({ i0, j0, i1, j1, w, d, mesh, geo, ext: new Float32Array(w * d) });
  }

  markDirty(i0, j0, i1, j1) {
    const C = this.chunkCells, n = this.n;
    const cx0 = Math.max(0, Math.floor((i0 - 1) / C)), cx1 = Math.min(n - 1, Math.floor((i1 + 1) / C));
    const cz0 = Math.max(0, Math.floor((j0 - 1) / C)), cz1 = Math.min(n - 1, Math.floor((j1 + 1) / C));
    for (let cz = cz0; cz <= cz1; cz++) for (let cx = cx0; cx <= cx1; cx++) this.dirty.add(cz * n + cx);
  }

  rebuildAll() { for (const c of this.chunks) this._rebuild(c); this.dirty.clear(); }

  update(limit = this.maxRebuilds) {
    let done = 0;
    for (const id of this.dirty) {
      if (done >= limit) break;
      this.dirty.delete(id);
      this._rebuild(this.chunks[id]);
      done++;
    }
    return done;
  }

  _rebuild(c) {
    const hf = this.hf, V = hf.verts, L = this.water.level, H = hf.h, ext = c.ext;
    const pos = c.geo.attributes.position.array, col = c.geo.attributes.color.array, idx = c.geo.index.array;
    let minY = Infinity, maxY = -Infinity, any = false;
    // Level per vertex: its own if wet, else the highest wet neighbour's (so the surface reaches the bank).
    for (let j = 0; j < c.d; j++) for (let i = 0; i < c.w; i++) {
      const gi = c.i0 + i, gj = c.j0 + j, k = gj * V + gi;
      let lv = L[k] > H[k] ? L[k] : -Infinity;
      if (lv === -Infinity) {
        for (let dj = -1; dj <= 1; dj++) for (let di = -1; di <= 1; di++) {
          const ii = gi + di, jj = gj + dj;
          if (ii < 0 || jj < 0 || ii >= V || jj >= V) continue;
          const q = jj * V + ii;
          if (L[q] > H[q] && L[q] > lv) lv = L[q];
        }
      }
      const v = j * c.w + i;
      ext[v] = lv;
      if (lv !== -Infinity) {
        any = true;
        pos[v * 3 + 1] = lv;
        if (lv < minY) minY = lv;
        if (lv > maxY) maxY = lv;
        const t = Math.min(1, Math.max(0, (lv - H[k]) / 1.6));
        col[v * 3] = SHALLOW.r + (DEEP.r - SHALLOW.r) * t;
        col[v * 3 + 1] = SHALLOW.g + (DEEP.g - SHALLOW.g) * t;
        col[v * 3 + 2] = SHALLOW.b + (DEEP.b - SHALLOW.b) * t;
      }
    }
    let n = 0;
    if (any) {
      for (let j = 0; j < c.d - 1; j++) for (let i = 0; i < c.w - 1; i++) {
        const a = j * c.w + i, b = a + 1, cc = a + c.w, e = cc + 1;
        if (ext[a] === -Infinity || ext[b] === -Infinity || ext[cc] === -Infinity || ext[e] === -Infinity) continue;
        idx[n++] = a; idx[n++] = cc; idx[n++] = b;
        idx[n++] = b; idx[n++] = cc; idx[n++] = e;
      }
    }
    c.geo.setDrawRange(0, n);
    c.mesh.visible = n > 0;
    if (n > 0) {
      c.geo.index.needsUpdate = true;
      c.geo.attributes.position.needsUpdate = true;
      c.geo.attributes.color.needsUpdate = true;
      c.geo.boundingBox.min.set(hf.wx(c.i0), minY - 0.1, hf.wz(c.j0));
      c.geo.boundingBox.max.set(hf.wx(c.i1), maxY + 0.1, hf.wz(c.j1));
      c.geo.boundingBox.getBoundingSphere(c.geo.boundingSphere);
    }
    this.rebuildCount++;
  }

  // Triangles currently drawn (for tests / debug).
  triangleCount() { return this.chunks.reduce((s, c) => s + (c.mesh.visible ? c.geo.drawRange.count / 3 : 0), 0); }

  dispose() { for (const c of this.chunks) c.geo.dispose(); this.material.dispose(); }
}
