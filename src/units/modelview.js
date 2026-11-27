// Units drawn from David's glTF models (assets/*.gltf, one mesh per named part): one InstancedMesh per part.
// Used for the Heavy Mech (assets/heavy-mech.gltf) and the auto turret (assets/turret.gltf). (The Medium Mech, with
// its digitigrade legs, has its own view: mediummech.js.)
//
// A model spec says which node is which part, how big the model is in the world, where its feet are, which way it
// faces, and how each part moves:
//   group 'torso'  turns with the unit's torso (upper body, guns)
//   group 'body'   moves with the body (bobs, crouches) but doesn't turn with the torso (hips)
//   group 'root'   stays put (a turret's tower)
//   leg parts      'thigh0/1', 'calf0/1', 'foot0/1': normal (forward-bending) knees. Each joint is at the top of
//                  its part (hip = top of the thigh, knee = top of the calf, ankle = top of the foot). The walk swings
//                  the thigh, bends the knee and keeps the foot flat.
// The models have no textures: team colours, panel seams and grime are painted in the shader (paintedMaterial).
import * as THREE from 'three';
import { paintedMaterial } from './mediummech.js';

const TEAM = [0x3d8fe0, 0xd9442e];
const WHITE = new THREE.Color(1, 0.95, 0.8);

// Specs. size: model units -> world units; origin: model point that stands on the unit's position; yaw: turn the
// model so its front faces +z; parts: key -> [node name, group, colour ('team' or hex)].
export const MODELS = {
  heavy: {
    url: 'assets/heavy-mech.gltf', height: 4.14, origin: [0, -23.55, 0], yaw: 0,
    parts: {
      body: ['Body', 'torso', 'team'], pod: ['Rocket_Pod', 'torso', 0x3a3f45], arm0: ['Left_Arm', 'torso', 0x59616a], arm1: ['Right_Arm', 'torso', 0x59616a],
      hips: ['Hips', 'body', 0x2e3338],
      thigh0: ['Left_Thigh', 'leg', 'team'], calf0: ['Left_Calf', 'leg', 0x8a949c], foot0: ['Left_Foot', 'leg', 0x2e3338],
      thigh1: ['Right_Thigh', 'leg', 'team'], calf1: ['Right_Calf', 'leg', 0x8a949c], foot1: ['Right_Foot', 'leg', 0x2e3338],
    },
    walk: { bob: 0.16, hip: 0.5, knee: 0.75 }, crouch: { drop: 0.8, hip: 0.8, knee: 1.5 },
    torsoPivot: 'body',                                  // (not the middle of body + pod: the pod is off to one side)
  },
  turret: {
    url: 'assets/turret.gltf', height: 3.4, origin: [0, -0.7674, 0], yaw: -Math.PI / 2,
    parts: {
      tower: ['Tower', 'root', 0x8a949c], head: ['Turret', 'torso', 'team'], gun0: ['Barrel_1', 'torso', 0x2e3338], gun1: ['Barrel_2', 'torso', 0x2e3338],
    },
    torsoPivot: 'head',
  },
};


export class ModelView {
  constructor(group, spec, max = 200) {
    this.group = group;
    this.spec = spec;
    this.max = max;
    this.ready = false;
    this.meshes = {};
    this.material = paintedMaterial();
    this._t = new THREE.Matrix4(); this._rm = new THREE.Matrix4(); this._c = new THREE.Color(); this._e = new THREE.Euler(); this._e2 = new THREE.Euler();
    this._p = new THREE.Vector3(); this._q = new THREE.Quaternion(); this._s = new THREE.Vector3();
    this.g = {};
    for (const k of ['root', 'body', 'torso', 'thigh0', 'thigh1', 'calf0', 'calf1', 'foot0', 'foot1']) this.g[k] = new THREE.Matrix4();
  }

  async load(base = '') {
    const S = this.spec, g = await (await fetch(base + S.url)).json();
    const bin = Uint8Array.from(atob(g.buffers[0].uri.split(',')[1]), c => c.charCodeAt(0)).buffer;
    const acc = i => {
      const a = g.accessors[i], bv = g.bufferViews[a.bufferView], n = { SCALAR: 1, VEC2: 2, VEC3: 3, VEC4: 4 }[a.type];
      const T = { 5126: Float32Array, 5125: Uint32Array, 5123: Uint16Array, 5121: Uint8Array }[a.componentType];
      return new T(bin, (bv.byteOffset || 0) + (a.byteOffset || 0), a.count * n);
    };
    // Model -> world: stand the origin on the ground, face +z, scale to the unit's height.
    const geos = {}, all = new THREE.Box3();
    for (const [key, [name]] of Object.entries(S.parts)) {
      const node = g.nodes.find(n => n.name === name);
      if (!node) throw new Error(`${S.url}: no part "${name}"`);
      const prim = g.meshes[node.mesh].primitives[0];
      const geo = new THREE.BufferGeometry();
      geo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(acc(prim.attributes.POSITION)), 3));
      if (prim.indices !== undefined) geo.setIndex(new THREE.BufferAttribute(new Uint32Array(acc(prim.indices)), 1));
      geo.applyMatrix4(new THREE.Matrix4().compose(new THREE.Vector3(...(node.translation || [0, 0, 0])), new THREE.Quaternion(...(node.rotation || [0, 0, 0, 1])), new THREE.Vector3(...(node.scale || [1, 1, 1]))));
      geo.applyMatrix4(new THREE.Matrix4().makeTranslation(-S.origin[0], -S.origin[1], -S.origin[2]));
      geo.applyMatrix4(new THREE.Matrix4().makeRotationY(S.yaw || 0));
      geo.computeBoundingBox();
      all.union(geo.boundingBox);
      geos[key] = geo;
    }
    const K = S.height / (all.max.y - all.min.y);
    this.joints = {};
    for (const [key, geo] of Object.entries(geos)) {
      geo.applyMatrix4(new THREE.Matrix4().makeScale(K, K, K));
      geo.computeBoundingBox();
      const b = geo.boundingBox;
      this.joints[key] = new THREE.Vector3((b.min.x + b.max.x) / 2, b.max.y - (b.max.y - b.min.y) * 0.08, (b.min.z + b.max.z) / 2);   // top of the part
      let flat = geo.toNonIndexed();
      flat.computeVertexNormals();
      const mesh = new THREE.InstancedMesh(flat, this.material, this.max);
      mesh.count = 0;
      mesh.castShadow = mesh.receiveShadow = true;
      mesh.frustumCulled = false;
      mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
      mesh.setColorAt(0, this._c.setHex(0xffffff));
      this.group.add(mesh);
      this.meshes[key] = mesh;
    }
    // The torso turns about the middle of the body (or the turret head).
    const tb = new THREE.Box3();
    for (const [key, [, grp]] of Object.entries(S.parts)) if (grp === 'torso' && (!S.torsoPivot || key === S.torsoPivot)) tb.union(this.meshes[key].geometry.boundingBox || (this.meshes[key].geometry.computeBoundingBox(), this.meshes[key].geometry.boundingBox));
    this.torsoPivot = tb.getCenter(new THREE.Vector3());
    this.scale = K;
    this.ready = true;
  }

  begin() { this.n = 0; }

  // Pose one unit (or wreck). s: { x, y, z, yaw, torsoYaw, phase, amp, flash, crouch, tiltX, tiltZ, sink, wreck }
  pose(team, s) {
    if (!this.ready || this.n >= this.max) return;
    const S = this.spec, g = this.g, T = this._t, i = this.n++;
    const amp = s.amp || 0, cr = s.crouch || 0, W = S.walk || {}, C = S.crouch || {};
    this._e.set(s.tiltX || 0, s.yaw, s.tiltZ || 0, 'YXZ');
    g.root.compose(this._p.set(s.x, s.y - (s.sink || 0), s.z), this._q.setFromEuler(this._e), this._s.set(1, 1, 1));
    g.body.multiplyMatrices(g.root, T.makeTranslation(0, -Math.abs(Math.cos(s.phase || 0)) * (W.bob || 0) * amp - (C.drop || 0) * cr, 0));
    const P = this.torsoPivot;
    g.torso.copy(g.body).multiply(T.makeTranslation(P.x, 0, P.z)).multiply(this._r(0, s.torsoYaw || 0)).multiply(T.makeTranslation(-P.x, 0, -P.z));
    if (W.hip) for (const k of [0, 1]) {
      const ph = (s.phase || 0) + k * Math.PI;
      const hip = -Math.sin(ph) * W.hip * amp - (C.hip || 0) * cr;                     // + swings the foot back
      const knee = (0.15 + Math.max(0, Math.cos(ph))) * W.knee * amp + (C.knee || 0) * cr;
      this._joint(g[`thigh${k}`], g.body, this.joints[`thigh${k}`], hip);
      this._joint(g[`calf${k}`], g[`thigh${k}`], this.joints[`calf${k}`], knee);
      this._joint(g[`foot${k}`], g[`calf${k}`], this.joints[`foot${k}`], -(hip + knee));    // foot stays flat
    }
    const flash = s.flash || 0;
    for (const [key, [, grp, color]] of Object.entries(S.parts)) {
      const mesh = this.meshes[key];
      mesh.setMatrixAt(i, grp === 'leg' ? g[key] : g[grp]);
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
    }
  }

  _joint(out, parent, j, a) {
    const T = this._t;
    out.copy(parent).multiply(T.makeTranslation(j.x, j.y, j.z)).multiply(this._r(a, 0)).multiply(T.makeTranslation(-j.x, -j.y, -j.z));
  }
  _r(ax, ay) { return this._rm.makeRotationFromEuler(this._e2.set(ax, ay, 0, 'YXZ')); }
}
