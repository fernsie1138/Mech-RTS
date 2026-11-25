// Chunked terrain meshes. Each chunk is one Mesh covering chunkCells x chunkCells cells.
// Changes to the heightfield or surface mark chunks dirty; update() rebuilds at most a few per frame.
// Rebuilds write into the existing vertex buffers (no new geometry), and normals come from the
// global heightfield, so chunk seams stay invisible.
import * as THREE from 'three';

export class TerrainMesh {
  constructor(hf, surface, { chunkCells, maxRebuildsPerFrame }) {
    this.hf = hf;
    this.surface = surface;
    this.chunkCells = chunkCells;
    this.maxRebuilds = maxRebuildsPerFrame;
    this.n = Math.ceil(hf.cells / chunkCells);        // chunks per side
    this.group = new THREE.Group();
    this.group.name = 'terrain';
    this.material = new THREE.MeshLambertMaterial({ vertexColors: true });
    this.chunks = [];
    this.dirty = new Set();
    this.rebuildCount = 0;                             // total rebuilds (for tests)
    for (let cz = 0; cz < this.n; cz++) for (let cx = 0; cx < this.n; cx++) this._makeChunk(cx, cz);
    const mark = (i0, j0, i1, j1) => this.markDirty(i0, j0, i1, j1);
    hf.onChange(mark);
    surface.onChange(mark);
    this.rebuildAll();
  }

  _makeChunk(cx, cz) {
    const C = this.chunkCells, hf = this.hf;
    const i0 = cx * C, j0 = cz * C;
    const i1 = Math.min(hf.cells, i0 + C), j1 = Math.min(hf.cells, j0 + C);
    const w = i1 - i0 + 1, d = j1 - j0 + 1;
    const pos = new Float32Array(w * d * 3), nrm = new Float32Array(w * d * 3), col = new Float32Array(w * d * 3);
    for (let j = 0; j < d; j++) for (let i = 0; i < w; i++) {
      const k = (j * w + i) * 3;
      pos[k] = hf.wx(i0 + i); pos[k + 2] = hf.wz(j0 + j);
    }
    const idx = [];
    for (let j = 0; j < d - 1; j++) for (let i = 0; i < w - 1; i++) {
      const a = j * w + i, b = a + 1, c = a + w, e = c + 1;
      // Alternate the diagonal for a less directional look.
      if ((i0 + i + j0 + j) & 1) idx.push(a, c, b, b, c, e); else idx.push(a, c, e, a, e, b);
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(pos, 3).setUsage(THREE.DynamicDrawUsage));
    geo.setAttribute('normal', new THREE.BufferAttribute(nrm, 3).setUsage(THREE.DynamicDrawUsage));
    geo.setAttribute('color', new THREE.BufferAttribute(col, 3).setUsage(THREE.DynamicDrawUsage));
    geo.setIndex(w * d > 65535 ? new THREE.Uint32BufferAttribute(idx, 1) : new THREE.Uint16BufferAttribute(idx, 1));
    geo.boundingBox = new THREE.Box3();
    geo.boundingSphere = new THREE.Sphere();
    const mesh = new THREE.Mesh(geo, this.material);
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    mesh.matrixAutoUpdate = false;
    mesh.name = `chunk ${cx},${cz}`;
    const chunk = { cx, cz, i0, j0, i1, j1, w, d, mesh, geo };
    this.chunks.push(chunk);
    this.group.add(mesh);
  }

  // Mark every chunk overlapping the sample rectangle. Expanded by one sample because a chunk's
  // edge normals depend on its neighbour's heights.
  markDirty(i0, j0, i1, j1) {
    const C = this.chunkCells, n = this.n;
    const cx0 = Math.max(0, Math.floor((i0 - 1) / C)), cx1 = Math.min(n - 1, Math.floor((i1 + 1) / C));
    const cz0 = Math.max(0, Math.floor((j0 - 1) / C)), cz1 = Math.min(n - 1, Math.floor((j1 + 1) / C));
    for (let cz = cz0; cz <= cz1; cz++) for (let cx = cx0; cx <= cx1; cx++) this.dirty.add(cz * n + cx);
  }

  rebuildAll() {
    for (const c of this.chunks) this._rebuild(c);
    this.dirty.clear();
  }

  // Rebuild up to maxRebuilds dirty chunks. Returns how many were rebuilt.
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
    const hf = this.hf, sf = this.surface, H = hf.h, V = hf.verts, e2 = 2 * hf.spacing;
    const pos = c.geo.attributes.position.array, nrm = c.geo.attributes.normal.array, col = c.geo.attributes.color.array;
    const rgb = [0, 0, 0];
    let minY = Infinity, maxY = -Infinity;
    for (let j = 0; j < c.d; j++) {
      const gj = c.j0 + j;
      const jm = gj > 0 ? gj - 1 : gj, jp = gj < V - 1 ? gj + 1 : gj;
      for (let i = 0; i < c.w; i++) {
        const gi = c.i0 + i;
        const im = gi > 0 ? gi - 1 : gi, ip = gi < V - 1 ? gi + 1 : gi;
        const y = H[gj * V + gi];
        const k = (j * c.w + i) * 3;
        pos[k + 1] = y;
        if (y < minY) minY = y;
        if (y > maxY) maxY = y;
        const dx = (H[gj * V + ip] - H[gj * V + im]) * (2 / ((ip - im) || 1));
        const dz = (H[jp * V + gi] - H[jm * V + gi]) * (2 / ((jp - jm) || 1));
        // Normal of the surface y = h(x, z): (-dh/dx, 1, -dh/dz), with dh/dx = dx / (2*spacing).
        let nx = -dx, ny = e2, nz = -dz;
        const l = Math.hypot(nx, ny, nz);
        nrm[k] = nx / l; nrm[k + 1] = ny / l; nrm[k + 2] = nz / l;
        const slope = Math.hypot(dx, dz) / e2;
        sf.colorAt(gi, gj, slope, y, rgb);
        // Palette is authored in sRGB; vertex colours are linear in three.js.
        col[k] = rgb[0] ** 2.2; col[k + 1] = rgb[1] ** 2.2; col[k + 2] = rgb[2] ** 2.2;
      }
    }
    const g = c.geo;
    g.attributes.position.needsUpdate = true;
    g.attributes.normal.needsUpdate = true;
    g.attributes.color.needsUpdate = true;
    g.boundingBox.min.set(hf.wx(c.i0), minY, hf.wz(c.j0));
    g.boundingBox.max.set(hf.wx(c.i1), maxY, hf.wz(c.j1));
    g.boundingBox.getBoundingSphere(g.boundingSphere);
    this.rebuildCount++;
  }

  dispose() {
    for (const c of this.chunks) c.geo.dispose();
    this.material.dispose();
  }
}
