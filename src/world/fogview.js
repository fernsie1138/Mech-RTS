// Draws the fog of war: a small texture over the map (one texel per Vision cell) that every material in the scene
// samples by world position. Seen now: normal. Explored: dimmed and greyed. Never seen: almost black.
// Patching is done once per material (onBeforeCompile, chained after any patch it already has).
import * as THREE from 'three';
import { VISION, MAP_SIZE } from '../config.js';

export class FogView {
  constructor(n) {
    this.n = n;
    this.data = new Uint8Array(n * n);
    this.shown = new Float32Array(n * n).fill(VISION.hidden);
    this.tex = new THREE.DataTexture(this.data, n, n, THREE.RedFormat, THREE.UnsignedByteType);
    this.tex.magFilter = this.tex.minFilter = THREE.LinearFilter;
    this.tex.needsUpdate = true;
    this.uniforms = { fogMap: { value: this.tex }, fogSize: { value: MAP_SIZE }, fogOn: { value: 1 } };
  }

  get enabled() { return this.uniforms.fogOn.value > 0; }
  set enabled(on) { this.uniforms.fogOn.value = on ? 1 : 0; }

  patch(m) {
    if (!m || m.userData.fogPatched || !(m.isMeshBasicMaterial || m.isMeshLambertMaterial || m.isMeshPhongMaterial || m.isMeshStandardMaterial)) return;
    m.userData.fogPatched = true;
    const prev = m.onBeforeCompile, prevKey = m.customProgramCacheKey;
    const U = this.uniforms;
    m.onBeforeCompile = function (sh, r) {
      if (prev && prev !== THREE.Material.prototype.onBeforeCompile) prev.call(this, sh, r);
      Object.assign(sh.uniforms, U);
      sh.vertexShader = sh.vertexShader
        .replace('#include <common>', '#include <common>\nvarying vec2 vFogXZ;')
        .replace('#include <project_vertex>', `#include <project_vertex>
          { vec4 fw = vec4( transformed, 1.0 );
          #ifdef USE_INSTANCING
            fw = instanceMatrix * fw;
          #endif
            fw = modelMatrix * fw; vFogXZ = fw.xz; }`);
      sh.fragmentShader = sh.fragmentShader
        .replace('#include <common>', '#include <common>\nuniform sampler2D fogMap; uniform float fogSize; uniform float fogOn; varying vec2 vFogXZ;')
        .replace('#include <dithering_fragment>', `{
            float fogV = mix( 1.0, texture2D( fogMap, vFogXZ / fogSize + 0.5 ).r, fogOn );
            vec3 fogGrey = vec3( dot( gl_FragColor.rgb, vec3( 0.299, 0.587, 0.114 ) ) );
            gl_FragColor.rgb = mix( fogGrey, gl_FragColor.rgb, smoothstep( 0.4, 0.95, fogV ) ) * fogV;
          }
          #include <dithering_fragment>`);
    };
    m.customProgramCacheKey = function () { return 'fog|' + (prevKey ? prevKey.call(this) : '') + '|' + (prev ? prev.toString() : ''); };
    m.needsUpdate = true;
  }

  // Patch every material in the scene that isn't yet (cheap after the first time).
  patchScene(scene) {
    scene.traverse(o => { const m = o.material; if (!m) return; if (Array.isArray(m)) m.forEach(x => this.patch(x)); else this.patch(m); });
  }

  // Fade the shown fog toward what `team` sees and explores. dt: seconds since the last frame.
  update(dt, vision, team = 0) {
    const vis = vision.visible[team], exp = vision.explored[team], s = this.shown, d = this.data;
    const k = Math.min(1, dt * 6);
    for (let i = 0; i < s.length; i++) {
      const target = vis[i] ? 1 : exp[i] ? VISION.explored : VISION.hidden;
      s[i] += (target - s[i]) * k;
      d[i] = s[i] * 255;
    }
    this.tex.needsUpdate = true;
  }

  // Straight to the current state (no fade), e.g. after a reset or in tests.
  snap(vision, team = 0) { this.update(1, vision, team); }

  clear() { this.shown.fill(VISION.hidden); this.data.fill(Math.round(VISION.hidden * 255)); this.tex.needsUpdate = true; }
}
