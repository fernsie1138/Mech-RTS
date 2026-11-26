// The Medium Mech: David's model (assets/medium-mech.gltf), drawn with one InstancedMesh per part.
// Parts: body (with its left-shoulder launcher tube), gun (right shoulder), and per leg a hip pod ("thigh"), shin
// ("calf") and foot. The legs are digitigrade: hip -> knee goes back and down, knee -> ankle forward and down, so
// the knee bends backwards. The walk cycle swings each leg at the hip, folds the knee back to lift the foot and
// keeps the foot level; the torso (body and gun) turns on its own. The model has no textures or UVs: its look
// (team colours, armour panel lines, grime toward the feet) is painted in the shader from the part's position.
import * as THREE from 'three';

// Where the model's parts are (node names in the file) and how it maps to game units.
const NODES = {
  body: 'Heavy_Mech_Body', gun: 'Heavy_Mech_Gun',
  thigh0: 'Heavy_Mech_Left_Thigh', calf0: 'Heavy_Mech_Left_Calf', foot0: 'Heavy_Mech_Right_foot',     // (+x side; the file names this foot "Right_foot")
  thigh1: 'Heavy_Mech_Right_Thigh', calf1: 'Heavy_Mech_Right_Calf', foot1: 'Heavy_Mech_Right_Foot',
};                                                       // ("Heavy_Mech_Right_Thigh_Copy" duplicates the right thigh: not used)
const K = 1.45;                                          // model units -> world units (3.5 tall)
const ORIGIN = [-0.076, -1.65, -0.3];                    // model point that stands on the unit's position (between the feet)
// Joints in model coordinates (from the geometry): hip = hip pod centre, knee = top of shin, ankle = bottom of shin.
const JOINTS = { hip: [-0.24, -0.575], knee: [-0.715, -0.784], ankle: [-1.339, -0.431] };   // [y, z]
const LEG_X = [0.598, -0.75];
const TORSO_PIVOT = [-0.076, -0.45];                     // [x, z] the torso turns about
// Defend crouch: body drop (world units) and joint angles (radians) at full crouch.
export const CROUCH = { drop: 0.5, hip: 0.5, knee: 0.9, ankle: -1.2 };
const toWorld = (x, y, z) => new THREE.Vector3((x - ORIGIN[0]) * K, (y - ORIGIN[1]) * K, (z - ORIGIN[2]) * K);

// Muzzle of the gun in world units relative to the unit (for units.js MUZZLES, torso frame at TORSO_Y = 2.45).
export const MEDIUM_MUZZLE = (() => { const p = toWorld(0.553, 0.546, 0.33); return [p.x, p.y - 2.45, p.z]; })();

const TEAM = [0x3d8fe0, 0xd9442e];
const PART_COLOR = { gun: 0x3a3f45, thigh: 0x59616a, calf: 0x8a949c, foot: 0x2e3338 };

export class MediumMechView {
  constructor(group, max = 200) {
    this.group = group;
    this.max = max;
    this.ready = false;
    this.meshes = {};
    this._m = new THREE.Matrix4(); this._t = new THREE.Matrix4(); this._c = new THREE.Color(); this._e = new THREE.Euler();
    this._p = new THREE.Vector3(); this._q = new THREE.Quaternion(); this._s = new THREE.Vector3();
    this._rm = new THREE.Matrix4(); this._e2 = new THREE.Euler();
    this.g = {};
    for (const k of ['root', 'body', 'torso', 'hip0', 'hip1', 'knee0', 'knee1', 'ankle0', 'ankle1']) this.g[k] = new THREE.Matrix4();
    this.hip = LEG_X.map(x => toWorld(x, JOINTS.hip[0], JOINTS.hip[1]));
    this.knee = LEG_X.map(x => toWorld(x, JOINTS.knee[0], JOINTS.knee[1]));
    this.ankle = LEG_X.map(x => toWorld(x, JOINTS.ankle[0], JOINTS.ankle[1]));
    this.torsoPivot = toWorld(TORSO_PIVOT[0], 0, TORSO_PIVOT[1]);
    this.material = paintedMaterial();
  }

  // Load the model file (glTF with an embedded buffer).
  async load(url) {
    const g = await (await fetch(url)).json();
    const bin = Uint8Array.from(atob(g.buffers[0].uri.split(',')[1]), c => c.charCodeAt(0)).buffer;
    const acc = i => {
      const a = g.accessors[i], bv = g.bufferViews[a.bufferView], n = { SCALAR: 1, VEC2: 2, VEC3: 3, VEC4: 4 }[a.type];
      const T = { 5126: Float32Array, 5125: Uint32Array, 5123: Uint16Array, 5121: Uint8Array }[a.componentType];
      return new T(bin, (bv.byteOffset || 0) + (a.byteOffset || 0), a.count * n);
    };
    for (const [part, name] of Object.entries(NODES)) {
      const node = g.nodes.find(n => n.name === name);
      if (!node) throw new Error(`Medium Mech model: no part "${name}"`);
      const prim = g.meshes[node.mesh].primitives[0];
      let geo = new THREE.BufferGeometry();
      geo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(acc(prim.attributes.POSITION)), 3));
      if (prim.indices !== undefined) geo.setIndex(new THREE.BufferAttribute(new Uint32Array(acc(prim.indices)), 1));
      // Bake the node's placement, then model -> world units.
      const m = new THREE.Matrix4().compose(new THREE.Vector3(...(node.translation || [0, 0, 0])), new THREE.Quaternion(...(node.rotation || [0, 0, 0, 1])), new THREE.Vector3(...(node.scale || [1, 1, 1])));
      geo.applyMatrix4(m);
      geo.applyMatrix4(new THREE.Matrix4().makeTranslation(-ORIGIN[0], -ORIGIN[1], -ORIGIN[2]));
      geo.applyMatrix4(new THREE.Matrix4().makeScale(K, K, K));
      geo = geo.toNonIndexed();                           // flat faces
      geo.computeVertexNormals();
      const mesh = new THREE.InstancedMesh(geo, this.material, this.max);
      mesh.count = 0;
      mesh.castShadow = true; mesh.receiveShadow = true;
      mesh.frustumCulled = false;
      mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
      mesh.setColorAt(0, this._c.setHex(0xffffff));
      this.group.add(mesh);
      this.meshes[part] = mesh;
    }
    this.ready = true;
  }

  begin() { this.n = 0; }

  // Pose one Medium Mech (or wreck). s: { x, y, z, yaw, torsoYaw, phase, amp, flash, crouch, tiltX, tiltZ, sink, wreck }
  pose(team, s) {
    if (!this.ready || this.n >= this.max) return;
    const g = this.g, i = this.n++, T = this._t;
    const amp = s.amp || 0, cr = s.crouch || 0;
    this._e.set(s.tiltX || 0, s.yaw, s.tiltZ || 0, 'YXZ');
    g.root.compose(this._p.set(s.x, s.y - (s.sink || 0), s.z), this._q.setFromEuler(this._e), this._s.set(1, 1, 1));
    // Body bob in step, lower when crouched.
    g.body.multiplyMatrices(g.root, T.makeTranslation(0, -Math.abs(Math.cos(s.phase)) * 0.14 * amp - CROUCH.drop * cr, 0));
    const P = this.torsoPivot;
    g.torso.copy(g.body).multiply(T.makeTranslation(P.x, 0, P.z)).multiply(this._r(0, s.torsoYaw)).multiply(T.makeTranslation(-P.x, 0, -P.z));
    for (const k of [0, 1]) {
      const ph = s.phase + k * Math.PI;
      const swing = -Math.sin(ph) * 0.42 * amp + CROUCH.hip * cr;           // + forward
      const lift = Math.max(0, Math.cos(ph)) * 0.75 * amp + CROUCH.knee * cr;   // knee folds back, lifting the foot
      const ankle = -(Math.sin(ph) * -0.42 * amp + Math.max(0, Math.cos(ph)) * 0.75 * amp) * 0.9 + CROUCH.ankle * cr;   // keep the foot level
      this._joint(g[`hip${k}`], g.body, this.hip[k], swing);
      this._joint(g[`knee${k}`], g[`hip${k}`], this.knee[k], lift);
      this._joint(g[`ankle${k}`], g[`knee${k}`], this.ankle[k], ankle);
    }
    const flash = s.flash || 0;
    const set = (part, M, hex) => {
      const mesh = this.meshes[part];
      mesh.setMatrixAt(i, M);
      this._c.setHex(hex);
      if (s.wreck) this._c.multiplyScalar(0.25).offsetHSL(0, -0.3, 0);
      if (flash > 0) this._c.lerp(WHITE, Math.min(1, flash * 6));
      mesh.setColorAt(i, this._c);
    };
    set('body', g.torso, TEAM[team]);
    set('gun', g.torso, PART_COLOR.gun);
    for (const k of [0, 1]) {
      set(`thigh${k}`, g[`hip${k}`], PART_COLOR.thigh);
      set(`calf${k}`, g[`knee${k}`], PART_COLOR.calf);
      set(`foot${k}`, g[`ankle${k}`], PART_COLOR.foot);
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

  // Rotation about x through a joint (world-unit point in the mech's frame): out = parent * T(j) * Rx(a) * T(-j).
  _joint(out, parent, j, a) {
    const T = this._t;
    out.copy(parent).multiply(T.makeTranslation(j.x, j.y, j.z)).multiply(this._r(a, 0)).multiply(T.makeTranslation(-j.x, -j.y, -j.z));
  }
  _r(ax, ay) { return this._rm.makeRotationFromEuler(this._e2.set(ax, ay, 0, 'YXZ')); }
}

const WHITE = new THREE.Color(1, 0.95, 0.8);

// Flat-shaded armour with panel lines and grime painted from the model-space position (no textures needed).
function paintedMaterial() {
  const m = new THREE.MeshLambertMaterial({ flatShading: true });
  m.onBeforeCompile = sh => {
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', '#include <common>\nvarying vec3 vPartPos;')
      .replace('#include <begin_vertex>', '#include <begin_vertex>\nvPartPos = position;');
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', `#include <common>
        varying vec3 vPartPos;
        float mmHash(vec3 p) { return fract(sin(dot(p, vec3(12.9898, 78.233, 37.719))) * 43758.5453); }`)
      .replace('#include <color_fragment>', `#include <color_fragment>
        {
          // Armour panels: thin dark seams on a 0.55-unit grid.
          vec3 f = abs(fract(vPartPos * 1.8) - 0.5);
          float seam = smoothstep(0.455, 0.49, max(max(f.x, f.y), f.z));
          // Grime: blotchy variation, and dirt toward the feet.
          float blot = mmHash(floor(vPartPos * 5.0)) * 0.14;
          float dirt = 1.0 - (1.0 - smoothstep(0.0, 1.2, vPartPos.y)) * 0.28;
          diffuseColor.rgb *= (1.0 - 0.42 * seam) * (0.93 + blot) * dirt;
        }`);
  };
  m.customProgramCacheKey = () => 'medium-mech-paint';
  return m;
}
