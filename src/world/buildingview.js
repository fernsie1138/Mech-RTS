// Draws buildings and bridges: one InstancedMesh per piece shape (world/shapes.js), all sharing one material.
// The material paints panel seams and lines, and per piece (instance attributes):
//   - up to four blast marks where it was hit (soot, ragged edged),
//   - once broken, a jagged hole through it (with charred edges) that shows its framework (a second instanced
//     mesh of girders, drawn only for broken pieces) and the dark inside of the building.
// Destroyed pieces tumble down for a moment and then disappear (their rubble is already in the terrain).
// Rubble chips lie round the buildings and stack up where many land.
import * as THREE from 'three';
import { SHAPES, SHAPE_KINDS, frameGeometry } from './shapes.js';

const FALL_TIME = 1.1;
const MAX_FRAMES = 800;

// Shared GLSL: is this fragment (piece-local position L, metres) inside the piece's hole? brk = (u, v, r, seed);
// seed < 0: a slab, holed across x-z; else a wall, holed across x-y.
const HOLE = `
  float holeDist( vec3 L, vec4 brk ) {
    vec2 q = ( brk.w < 0.0 ? L.xz : L.xy ) - brk.xy;
    float seed = abs( brk.w ), a = atan( q.y, q.x );
    float jag = 0.74 + 0.15 * sin( a * 5.0 + seed ) + 0.09 * sin( a * 11.0 + seed * 2.3 ) + 0.06 * sin( a * 23.0 + seed * 1.7 );
    return length( q ) - brk.z * jag;     // < 0: inside the hole
  }`;

function patchPieces(m) {
  m.onBeforeCompile = sh => {
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', `#include <common>
        attribute vec4 aMark0; attribute vec4 aMark1; attribute vec4 aMark2; attribute vec4 aMark3; attribute vec4 aBreak;
        varying vec3 vLocal; varying vec3 vUnit; varying vec4 vM0; varying vec4 vM1; varying vec4 vM2; varying vec4 vM3; varying vec4 vBreak;`)
      .replace('#include <begin_vertex>', `#include <begin_vertex>
        vec3 sc = vec3( length( instanceMatrix[ 0 ].xyz ), length( instanceMatrix[ 1 ].xyz ), length( instanceMatrix[ 2 ].xyz ) );
        vUnit = position; vLocal = position * sc;
        vM0 = aMark0; vM1 = aMark1; vM2 = aMark2; vM3 = aMark3; vBreak = aBreak;`);
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', `#include <common>
        varying vec3 vLocal; varying vec3 vUnit; varying vec4 vM0; varying vec4 vM1; varying vec4 vM2; varying vec4 vM3; varying vec4 vBreak;
        ${HOLE}
        float soot( vec4 M ) {
          if ( M.w <= 0.0 ) return 0.0;
          vec3 p = vLocal - M.xyz;
          float n = 0.5 + 0.22 * sin( p.x * 7.3 + p.y * 3.1 + M.x ) + 0.18 * sin( p.y * 9.7 - p.z * 6.1 + M.z * 3.0 ) + 0.1 * sin( ( p.x + p.z ) * 17.0 );
          float d = length( p ) / ( M.w * ( 0.75 + 0.5 * n ) );
          return ( 1.0 - smoothstep( 0.3, 1.0, d ) ) * ( 0.8 + 0.2 * n );
        }`)
      .replace('#include <color_fragment>', `#include <color_fragment>
        float edge = 0.0;
        if ( vBreak.z > 0.0 ) {
          float hd = holeDist( vLocal, vBreak );
          if ( hd < 0.0 ) discard;
          edge = 1.0 - smoothstep( 0.0, 0.28, hd );
        }
        // Panel seams at the piece's edges, and panel lines across it.
        vec3 au = abs( vUnit );
        float seam = vBreak.w < 0.0 ? max( step( 0.485, au.x ), step( 0.485, au.z ) ) : max( step( 0.488, au.x ), step( 0.485, au.y ) * step( au.z, 0.49 ) );
        vec2 pl = vBreak.w < 0.0 ? vLocal.xz : vLocal.xy;
        float line = max( 1.0 - smoothstep( 0.0, 0.035, abs( fract( pl.x / 0.95 + 0.5 ) - 0.5 ) * 0.95 ),
                          1.0 - smoothstep( 0.0, 0.03, abs( fract( pl.y / 0.8 ) - 0.5 ) * 0.8 ) );
        diffuseColor.rgb *= ( 1.0 - 0.28 * seam ) * ( 1.0 - 0.13 * line );
        float burn = max( max( soot( vM0 ), soot( vM1 ) ), max( soot( vM2 ), soot( vM3 ) ) );
        diffuseColor.rgb *= 1.0 - 0.9 * max( burn, edge * 0.9 );
        diffuseColor.rgb += vec3( 0.25, 0.08, 0.0 ) * edge * edge * 0.6;          // hot edge
        if ( !gl_FrontFacing ) diffuseColor.rgb *= 0.28;                      // the dark inside, seen through a hole`);
  };
  m.customProgramCacheKey = () => 'buildingPieces1';
  return m;
}

// Shadows: the same holes.
function depthMaterial() {
  const m = new THREE.MeshDepthMaterial({ depthPacking: THREE.RGBADepthPacking });
  m.onBeforeCompile = sh => {
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', '#include <common>\nattribute vec4 aBreak; varying vec3 vLocal; varying vec4 vBreak;')
      .replace('#include <begin_vertex>', `#include <begin_vertex>
        vLocal = position * vec3( length( instanceMatrix[ 0 ].xyz ), length( instanceMatrix[ 1 ].xyz ), length( instanceMatrix[ 2 ].xyz ) ); vBreak = aBreak;`);
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', `#include <common>\nvarying vec3 vLocal; varying vec4 vBreak;\n${HOLE}`)
      .replace('#include <clipping_planes_fragment>', '#include <clipping_planes_fragment>\nif ( vBreak.z > 0.0 && holeDist( vLocal, vBreak ) < 0.0 ) discard;');
  };
  m.customProgramCacheKey = () => 'buildingDepth1';
  return m;
}

const ATTRS = ['aMark0', 'aMark1', 'aMark2', 'aMark3', 'aBreak'];

export class BuildingView {
  constructor(scene, heightAt) {
    this.heightAt = heightAt;
    this.group = new THREE.Group();
    this.group.name = 'buildings';
    scene.add(this.group);
    this.geos = Object.fromEntries(SHAPE_KINDS.map(k => [k, SHAPES[k]()]));
    this.mat = patchPieces(new THREE.MeshLambertMaterial({ flatShading: true, side: THREE.DoubleSide }));
    this.depthMat = depthMaterial();
    this.meshes = [];
    this.anims = [];
    this._m = new THREE.Matrix4(); this._q = new THREE.Quaternion(); this._p = new THREE.Vector3(); this._s = new THREE.Vector3();
    this._e = new THREE.Euler(); this._c = new THREE.Color(); this._m2 = new THREE.Matrix4();
    this._ray = new THREE.Raycaster();
    this.maxChunks = 3500;
    this.chunkMesh = new THREE.InstancedMesh(new THREE.DodecahedronGeometry(0.5, 0), new THREE.MeshLambertMaterial({ flatShading: true }), this.maxChunks);
    this.chunkMesh.count = 0;
    this.chunkMesh.castShadow = this.chunkMesh.receiveShadow = true;
    this.chunkMesh.frustumCulled = false;
    this.group.add(this.chunkMesh);
    // Framework inside broken pieces.
    this.frameMesh = new THREE.InstancedMesh(frameGeometry(), new THREE.MeshLambertMaterial({ color: 0x3a3e42, flatShading: true }), MAX_FRAMES);
    this.frameMesh.count = 0;
    this.frameMesh.castShadow = true;
    this.frameMesh.frustumCulled = false;
    this.group.add(this.frameMesh);
  }

  // Rubble chunks: rewritten when they change or the ground under them moves.
  _writeChunks() {
    const B = this.buildings, list = B.chunks.filter(c => c.alive).slice(-this.maxChunks);
    list.forEach((c, n) => {
      this._e.set(c.rot, c.rot * 1.7, 0);
      this._m.compose(this._p.set(c.x, this.heightAt(c.x, c.z) + c.s * 0.2 + (c.lift || 0), c.z), this._q.setFromEuler(this._e), this._s.set(c.s * 1.4, c.s, c.s * 1.1));
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
    for (const m of this.meshes) { this.group.remove(m); m.geometry.dispose(); m.dispose(); }
    const ps = buildings.pieces;
    this.meshes = [];
    this.byKind = {};
    this.slot = new Int32Array(ps.length);
    this.meshOf = new Array(ps.length);
    this.pieceOf = new Map();             // mesh -> instance -> piece index
    for (const kind of SHAPE_KINDS) {
      const idx = [];
      ps.forEach((p, i) => { if ((p.kind || 'box') === kind) idx.push(i); });
      if (!idx.length) continue;
      const geo = this.geos[kind].clone();
      for (const a of ATTRS) geo.setAttribute(a, new THREE.InstancedBufferAttribute(new Float32Array(idx.length * 4), 4).setUsage(THREE.DynamicDrawUsage));
      const mesh = new THREE.InstancedMesh(geo, this.mat, idx.length);
      mesh.customDepthMaterial = this.depthMat;
      mesh.castShadow = mesh.receiveShadow = true;
      mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
      idx.forEach((i, n) => { this.slot[i] = n; this.meshOf[i] = mesh; });
      this.pieceOf.set(mesh, idx);
      this.meshes.push(mesh);
      this.group.add(mesh);
    }
    ps.forEach((p, i) => this._write(i));
    this.anims = [];
    this._writeChunks();
    this._writeFrames();
    buildings.changed.clear();
    buildings.falling.length = 0;
    this._flush();
  }

  _matrix(p, o) {
    this._e.set(o.rx, p.rot, o.rz, 'YXZ');
    return this._m.compose(this._p.set(o.x, o.y, o.z), this._q.setFromEuler(this._e), this._s.set(p.sx, p.sy, p.sz));
  }

  _write(i, override) {
    const p = this.buildings.pieces[i], mesh = this.meshOf[i], n = this.slot[i];
    if (!p.alive && !override) this._m.makeScale(0, 0, 0);
    else this._matrix(p, override || { x: p.px, y: p.py, z: p.pz, rx: 0, rz: 0 });
    mesh.setMatrixAt(n, this._m);
    // Damaged pieces darken a little (their marks do most of the showing).
    const hpFrac = p.alive ? Math.max(0, p.hp / p.maxHp) : 0.3;
    this._c.setHex(p.color).multiplyScalar(0.8 + 0.2 * hpFrac);
    mesh.setColorAt(n, this._c);
    const g = mesh.geometry.attributes;
    for (let k = 0; k < 4; k++) {
      const m = p.marks?.[k], a = g['aMark' + k];
      if (m) a.setXYZW(n, m[0], m[1], m[2], m[3]); else a.setXYZW(n, 0, 0, 0, 0);
      a.needsUpdate = true;
    }
    const b = p.brk, ab = g.aBreak;
    if (b) ab.setXYZW(n, b[0], b[1], b[2], b[3]); else ab.setXYZW(n, 0, 0, 0, p.flat ? -1 : 1);
    ab.needsUpdate = true;
  }

  // Framework in every broken piece still standing.
  _writeFrames() {
    const B = this.buildings;
    let n = 0;
    const flat = new THREE.Matrix4().makeRotationX(-Math.PI / 2);
    for (const p of B.pieces) {
      if (!p.alive || !p.brk || n >= MAX_FRAMES) continue;
      this._matrix(p, { x: p.px, y: p.py, z: p.pz, rx: 0, rz: 0 });
      // The frame lies in the panel's plane: a wall's x-y, a slab's x-z. Centred in depth except in a battered wall.
      if (p.flat) this._m.multiply(flat);
      else if (p.kind !== 'batter') this._m.multiply(this._m2.makeTranslation(0, 0, -0.2));
      this.frameMesh.setMatrixAt(n++, this._m);
    }
    this.frameMesh.count = n;
    this.frameMesh.instanceMatrix.needsUpdate = true;
    B.brokenChanged = false;
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
    if (B.brokenChanged) this._writeFrames();
  }

  // Recolour every standing piece (after blasts that damaged but didn't destroy).
  refreshColors() { this.buildings.pieces.forEach((p, i) => { if (p.alive) this._write(i); }); this._flush(); }

  // First building piece hit by a ray, or null: { point, piece }.
  pick(ray) {
    this._ray.ray.copy(ray);
    const hits = this._ray.intersectObjects(this.meshes, false);
    for (const h of hits) {
      const i = this.pieceOf.get(h.object)?.[h.instanceId];
      if (i !== undefined && this.buildings.pieces[i].alive) return { point: h.point, piece: i };
    }
    return null;
  }
}
