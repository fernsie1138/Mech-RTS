// The Artillery: David's model (assets/artillery.gltf), drawn with one InstancedMesh per part.
// The file holds the vehicle twice: in Travel mode (centred: gun compact, treads flush with the chassis, anchors
// raised) and in Deployed mode (the "_Copy" parts, 2.33 to the side: treads out, anchors down, barrel raised and
// extended). Each part moves rigidly from one to the other (a rotation and a shift, found by a best fit of its
// vertices), plus a small per-vertex correction so it lands exactly on the Deployed shape. A unit's `deploy`
// (0 = Travel .. 1 = Deployed) poses every part in between, so deploying and packing up are animated.
// The turret, barrel and its extension turn with the unit's torso (aim); the rest with the hull.
import * as THREE from 'three';
import { paintedMaterial } from './mediummech.js';

const TEAM = [0x3d8fe0, 0xd9442e];
const WHITE = new THREE.Color(1, 0.95, 0.8);
const DX = 2.32901525;                     // the Deployed copy's offset in the file
export const ARTILLERY = {
  url: 'assets/artillery.gltf',
  K: 3.4,                                  // model units -> world units (about 5.3 long, 3.4 wide in Travel)
  origin: [0, -0.5563, 0],                 // model point that stands on the unit's position (bottom of the treads)
  // part: [travel node, deployed node, turns with the turret?, colour]
  parts: {
    chassis: ['Chassis', 'Chassis_Copy', false, 'team'],
    tread0: ['Left_Tread', 'Left_Tread_Copy', false, 0x2e3338], tread1: ['Right_Tread', 'Right_Tread_Copy', false, 0x2e3338],
    anchor0: ['Left_Anchor', 'Left_Anchor_Copy', false, 0x59616a], anchor1: ['Right_Anchor_', 'Right_Anchor__Copy', false, 0x59616a],
    turret: ['Turret', 'Turret_Copy', true, 'team'],
    barrel: ['Main_Barrel', 'Main_Barrel_Copy', true, 0x3a3f45], ext: ['Barrel_Extension', 'Barrel_Extension_Copy', true, 0x8a949c],
  },
};

// Best rigid fit B ~ q A + t (Horn's quaternion method; the point lists correspond one to one).
function rigidFit(A, B) {
  const n = A.length / 3, ca = [0, 0, 0], cb = [0, 0, 0];
  for (let i = 0; i < n; i++) for (let k = 0; k < 3; k++) { ca[k] += A[i * 3 + k] / n; cb[k] += B[i * 3 + k] / n; }
  const S = [[0, 0, 0], [0, 0, 0], [0, 0, 0]];
  for (let i = 0; i < n; i++) for (let r = 0; r < 3; r++) for (let c = 0; c < 3; c++) S[r][c] += (A[i * 3 + r] - ca[r]) * (B[i * 3 + c] - cb[c]);
  const [[xx, xy, xz], [yx, yy, yz], [zx, zy, zz]] = S;
  const N = [[xx + yy + zz, yz - zy, zx - xz, xy - yx], [yz - zy, xx - yy - zz, xy + yx, zx + xz], [zx - xz, xy + yx, -xx + yy - zz, yz + zy], [xy - yx, zx + xz, yz + zy, -xx - yy + zz]];
  let v = [1, 0, 0, 0];
  const shift = 1e3;                        // power iteration on N + shift: its top eigenvector is the rotation
  for (let it = 0; it < 300; it++) {
    const w = N.map((row, r) => row.reduce((s, x, c) => s + x * v[c], 0) + shift * v[r]), l = Math.hypot(...w);
    v = w.map(x => x / l);
  }
  const q = new THREE.Quaternion(v[1], v[2], v[3], v[0]).normalize();
  const t = new THREE.Vector3(...cb).sub(new THREE.Vector3(...ca).applyQuaternion(q));
  // As a turn of `angle` about an axis through a hinge point, plus a slide along that axis: posed part way, a part
  // swings round its hinge (an anchor folding down stays on the hull) instead of round its middle.
  const angle = 2 * Math.acos(Math.min(1, Math.abs(q.w))), s = Math.sqrt(Math.max(0, 1 - q.w * q.w));
  const axis = s > 1e-6 ? new THREE.Vector3(q.x, q.y, q.z).multiplyScalar(Math.sign(q.w || 1) / s) : new THREE.Vector3(0, 1, 0);
  const slide = axis.clone().multiplyScalar(t.dot(axis)), tp = t.clone().sub(slide);
  const hinge = angle > 0.02 ? tp.clone().add(axis.clone().cross(tp).multiplyScalar(1 / Math.tan(angle / 2))).multiplyScalar(0.5) : null;
  return { q, t, axis, angle, hinge, slide };
}

export class ArtilleryView {
  constructor(group, max = 60) {
    this.group = group;
    this.max = max;
    this.ready = false;
    this.meshes = {};
    this.moves = {};                        // part -> { q, t } rigid move from Travel to Deployed (world units)
    this.material = deployMaterial();
    this._m = new THREE.Matrix4(); this._t = new THREE.Matrix4(); this._r = new THREE.Matrix4(); this._c = new THREE.Color();
    this._e = new THREE.Euler(); this._p = new THREE.Vector3(); this._q = new THREE.Quaternion(); this._s = new THREE.Vector3(1, 1, 1);
    this._qi = new THREE.Quaternion(); this._v = new THREE.Vector3();
    this.root = new THREE.Matrix4(); this.hull = new THREE.Matrix4(); this.turretM = new THREE.Matrix4();
  }

  async load(base = '') {
    const S = ARTILLERY, g = await (await fetch(base + S.url)).json();
    const bin = Uint8Array.from(atob(g.buffers[0].uri.split(',')[1]), c => c.charCodeAt(0)).buffer;
    const acc = i => {
      const a = g.accessors[i], bv = g.bufferViews[a.bufferView], n = { SCALAR: 1, VEC2: 2, VEC3: 3, VEC4: 4 }[a.type];
      const T = { 5126: Float32Array, 5125: Uint32Array, 5123: Uint16Array, 5121: Uint8Array }[a.componentType];
      return new T(bin, (bv.byteOffset || 0) + (a.byteOffset || 0), a.count * n);
    };
    // A node's vertices in world units relative to the vehicle (shift: the Deployed copy's offset).
    const bake = (name, shift) => {
      const node = g.nodes.find(n => n.name === name);
      if (!node) throw new Error(`${S.url}: no part "${name}"`);
      const prim = g.meshes[node.mesh].primitives[0], src = acc(prim.attributes.POSITION);
      const m = new THREE.Matrix4().compose(new THREE.Vector3(...(node.translation || [0, 0, 0])), new THREE.Quaternion(...(node.rotation || [0, 0, 0, 1])), new THREE.Vector3(...(node.scale || [1, 1, 1])));
      const out = new Float32Array(src.length), v = new THREE.Vector3();
      for (let i = 0; i < src.length; i += 3) {
        v.set(src[i], src[i + 1], src[i + 2]).applyMatrix4(m);
        out[i] = (v.x + shift - S.origin[0]) * S.K; out[i + 1] = (v.y - S.origin[1]) * S.K; out[i + 2] = (v.z - S.origin[2]) * S.K;
      }
      return { pos: out, index: acc(prim.indices) };
    };
    const turretPivot = new THREE.Vector3();
    for (const [key, [travel, deployed]] of Object.entries(S.parts)) {
      const A = bake(travel, 0), B = bake(deployed, DX);
      if (A.pos.length !== B.pos.length) throw new Error(`${S.url}: "${travel}" and "${deployed}" differ`);
      // Rigid move A -> B, and what is left over (in A's frame, so it turns with the part).
      const fit = rigidFit(A.pos, B.pos), qi = fit.q.clone().invert();
      const delta = new Float32Array(A.pos.length), a = new THREE.Vector3(), b = new THREE.Vector3();
      for (let i = 0; i < A.pos.length; i += 3) {
        a.set(A.pos[i], A.pos[i + 1], A.pos[i + 2]); b.set(B.pos[i], B.pos[i + 1], B.pos[i + 2]);
        b.sub(fit.t).applyQuaternion(qi).sub(a);                       // q^-1 (B - t) - A
        delta[i] = b.x; delta[i + 1] = b.y; delta[i + 2] = b.z;
      }
      this.moves[key] = fit;
      let geo = new THREE.BufferGeometry();
      geo.setAttribute('position', new THREE.BufferAttribute(A.pos, 3));
      geo.setAttribute('aDelta', new THREE.BufferAttribute(delta, 3));
      geo.setIndex(new THREE.BufferAttribute(Uint32Array.from(A.index), 1));
      geo = geo.toNonIndexed();
      geo.computeVertexNormals();
      if (key === 'turret') { geo.computeBoundingBox(); geo.boundingBox.getCenter(turretPivot); }
      geo.setAttribute('aDeploy', new THREE.InstancedBufferAttribute(new Float32Array(this.max), 1).setUsage(THREE.DynamicDrawUsage));
      const mesh = new THREE.InstancedMesh(geo, this.material, this.max);
      mesh.count = 0;
      mesh.castShadow = mesh.receiveShadow = true;
      mesh.frustumCulled = false;
      mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
      mesh.setColorAt(0, this._c.setHex(0xffffff));
      this.group.add(mesh);
      this.meshes[key] = mesh;
    }
    this.turretPivot = turretPivot;
    this.ready = true;
  }

  begin() { this.n = 0; }

  // s: { x, y, z, yaw, torsoYaw, deploy (0..1), flash, tiltX, tiltZ, sink, wreck, phase, amp }
  pose(team, s) {
    if (!this.ready || this.n >= this.max) return;
    const i = this.n++, k = Math.max(0, Math.min(1, s.deploy || 0)), P = this.turretPivot;
    this._e.set(s.tiltX || 0, s.yaw, s.tiltZ || 0, 'YXZ');
    // A slight rock as it drives (tracked vehicles bob less than walkers).
    const bob = (s.amp || 0) * Math.sin((s.phase || 0) * 2) * 0.04;
    this.root.compose(this._p.set(s.x, s.y - (s.sink || 0) + bob, s.z), this._q.setFromEuler(this._e), this._s.set(1, 1, 1));
    this.turretM.copy(this.root).multiply(this._t.makeTranslation(P.x, 0, P.z)).multiply(this._r.makeRotationY(s.torsoYaw || 0)).multiply(this._t.makeTranslation(-P.x, 0, -P.z));
    const flash = s.flash || 0;
    for (const [key, [, , turns, color]] of Object.entries(ARTILLERY.parts)) {
      const mv = this.moves[key], mesh = this.meshes[key];
      // Rigid part of the move, k of the way: turn k of the angle round the hinge and slide k of the way (a part
      // that barely turns just slides).
      if (mv.hinge) {
        this._qi.setFromAxisAngle(mv.axis, mv.angle * k);
        const h = mv.hinge;
        this._m.makeTranslation(h.x + mv.slide.x * k, h.y + mv.slide.y * k, h.z + mv.slide.z * k).multiply(this._r.makeRotationFromQuaternion(this._qi)).multiply(this._t.makeTranslation(-h.x, -h.y, -h.z));
      } else {
        this._qi.identity().slerp(mv.q, k);
        this._m.compose(this._v.copy(mv.t).multiplyScalar(k), this._qi, this._s.set(1, 1, 1));
      }
      this._m.premultiply(turns ? this.turretM : this.root);
      mesh.setMatrixAt(i, this._m);
      mesh.geometry.attributes.aDeploy.array[i] = k;
      this._c.setHex(color === 'team' ? TEAM[team] : color);
      if (s.wreck) this._c.multiplyScalar(0.25).offsetHSL(0, -0.3, 0);
      if (flash > 0) this._c.lerp(WHITE, Math.min(1, flash * 6));
      mesh.setColorAt(i, this._c);
    }
  }

  end() {
    if (!this.ready) return;
    for (const mesh of Object.values(this.meshes)) {
      mesh.count = this.n;
      mesh.instanceMatrix.needsUpdate = true;
      if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
      mesh.geometry.attributes.aDeploy.needsUpdate = true;
    }
  }

  // Where the barrel's end is, in the unit's frame (x right, y up, z forward; turret turned by torsoYaw = 0),
  // when fully deployed. For units.js MUZZLES.
  muzzle() {
    const mesh = this.meshes.ext, pos = mesh.geometry.attributes.position, d = mesh.geometry.attributes.aDelta, mv = this.moves.ext;
    let best = null;
    for (let i = 0; i < pos.count; i++) {
      const v = new THREE.Vector3(pos.getX(i) + d.getX(i), pos.getY(i) + d.getY(i), pos.getZ(i) + d.getZ(i)).applyQuaternion(mv.q).add(mv.t);
      if (!best || v.z > best.z) best = v;
    }
    return best;
  }
}

// The painted look of the mechs, plus each vertex's small correction toward the Deployed shape (aDelta x aDeploy).
function deployMaterial() {
  const m = paintedMaterial(), prev = m.onBeforeCompile;
  m.onBeforeCompile = (sh, r) => {
    prev.call(m, sh, r);
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', '#include <common>\nattribute vec3 aDelta; attribute float aDeploy;')
      .replace('#include <begin_vertex>', '#include <begin_vertex>\ntransformed += aDelta * aDeploy;');
  };
  m.customProgramCacheKey = () => 'artillery-paint';
  return m;
}
