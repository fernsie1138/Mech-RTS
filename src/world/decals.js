// Crater decals baked into the ground: one texture over the whole map (DECALS.pxPerUnit texels per world unit)
// that the terrain shader lays over its own colours. Each crater stamps one of the six crater pictures in
// assets/craters.png (chosen at random, turned at random) into it, and they stay for the rest of the match.
// Rubble heaps (assets/rubble.png, 12 pictures made by tools/make-rubble.mjs) are stamped the same way round the
// foot of damaged buildings and structures.
// Stamps are drawn on a canvas, and only the changed square is copied to the GPU texture, once per frame.
// Every stamp is logged (log), so a saved game can replay them.
import * as THREE from 'three';
import { MAP_SIZE, DECALS } from '../config.js';

const RUBBLE_PICKS = [0, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11];

export class Decals {
  constructor(renderer, url = 'assets/craters.png?v=1', rubbleUrl = 'assets/rubble.png?v=1') {
    this.renderer = renderer;
    this.N = Math.round(MAP_SIZE * DECALS.pxPerUnit);
    this.canvas = document.createElement('canvas');
    this.canvas.width = this.canvas.height = this.N;
    this.ctx = this.canvas.getContext('2d', { willReadFrequently: true });
    this.tex = new THREE.DataTexture(new Uint8Array(this.N * this.N * 4), this.N, this.N, THREE.RGBAFormat);
    this.tex.colorSpace = THREE.SRGBColorSpace;
    this.tex.magFilter = this.tex.minFilter = THREE.LinearFilter;
    this.tex.generateMipmaps = false;
    this.tex.needsUpdate = true;
    this.uniforms = { decalMap: { value: this.tex }, decalSize: { value: MAP_SIZE } };
    this.sprites = null;                     // the 6-picture sheet, once loaded
    this.rubbleSheet = null;                 // the 12 rubble pictures, once loaded
    this.rubbleCount = 0;
    this.log = [];                           // every stamp: ['c' | 'r', x, z, r, pick, angle]
    this.dirty = null;                       // canvas rectangle to upload: [x0, y0, x1, y1]
    this.queue = [];                         // stamps waiting for the picture to load
    this.count = 0;
    const img = new Image();
    img.onload = () => { this.sprites = img; for (const q of this.queue.splice(0)) this.crater(...q); };
    img.src = url;
    const rub = new Image();
    rub.onload = () => { this.rubbleSheet = rub; for (const q of this.rubbleQueue.splice(0)) this.rubble(...q); };
    rub.src = rubbleUrl;
    this.rubbleQueue = [];
  }

  // Lay the decal over a terrain material's colours (before lighting, so craters are lit like the ground).
  patch(material) {
    const U = this.uniforms, prev = material.onBeforeCompile;
    material.onBeforeCompile = function (sh, r) {
      if (prev && prev !== THREE.Material.prototype.onBeforeCompile) prev.call(this, sh, r);
      Object.assign(sh.uniforms, U);
      sh.vertexShader = sh.vertexShader
        .replace('#include <common>', '#include <common>\nvarying vec2 vDecalXZ;')
        .replace('#include <project_vertex>', '#include <project_vertex>\nvDecalXZ = ( modelMatrix * vec4( transformed, 1.0 ) ).xz;');
      sh.fragmentShader = sh.fragmentShader
        .replace('#include <common>', '#include <common>\nuniform sampler2D decalMap; uniform float decalSize; varying vec2 vDecalXZ;')
        .replace('#include <color_fragment>', `#include <color_fragment>
          { vec4 dc = texture2D( decalMap, vDecalXZ / decalSize + 0.5 ); diffuseColor.rgb = mix( diffuseColor.rgb, dc.rgb, dc.a ); }`);
    };
    const prevKey = material.customProgramCacheKey;
    material.customProgramCacheKey = function () { return 'decal|' + (prevKey ? prevKey.call(this) : ''); };
    material.needsUpdate = true;
  }

  // Stamp a crater of radius r (world units) at (x, z). pick / angle: which picture and turn (random if left out).
  crater(x, z, r, pick = Math.floor(Math.random() * 6), angle = Math.random() * Math.PI * 2) {
    if (!this.sprites) { this.queue.push([x, z, r, pick, angle]); return; }
    this.log.push(['c', +x.toFixed(2), +z.toFixed(2), +r.toFixed(2), pick, +angle.toFixed(3)]);
    const cell = this.sprites.width / 3;
    this._stamp(this.sprites, (pick % 3) * cell, Math.floor(pick / 3) * cell, cell, x, z, r * DECALS.scale * DECALS.pxPerUnit, angle, DECALS.opacity);
    this.count++;
  }

  // Stamp a rubble heap about `size` world units across at (x, z). pick: 0..11 (the overgrown heap, 1, is left out
  // when picking at random).
  rubble(x, z, size, pick = RUBBLE_PICKS[Math.floor(Math.random() * RUBBLE_PICKS.length)], angle = Math.random() * Math.PI * 2) {
    if (!this.rubbleSheet) { this.rubbleQueue.push([x, z, size, pick, angle]); return; }
    this.log.push(['r', +x.toFixed(2), +z.toFixed(2), +size.toFixed(2), pick, +angle.toFixed(3)]);
    const cell = this.rubbleSheet.width / 4;
    this._stamp(this.rubbleSheet, (pick % 4) * cell, Math.floor(pick / 4) * cell, cell, x, z, size * DECALS.pxPerUnit, angle, DECALS.rubbleOpacity);
    this.rubbleCount++;
  }

  // Replay logged stamps (a saved game), in order.
  replay(log) { for (const [k, ...a] of log || []) k === 'c' ? this.crater(...a) : this.rubble(...a); }

  _stamp(img, sx, sy, cell, x, z, size, angle, alpha) {
    const cx = (x / MAP_SIZE + 0.5) * this.N, cy = (z / MAP_SIZE + 0.5) * this.N;
    const k = this.ctx;
    k.save();
    k.translate(cx, cy); k.rotate(angle);
    k.globalAlpha = alpha;
    k.drawImage(img, sx, sy, cell, cell, -size / 2, -size / 2, size, size);
    k.restore();
    const h = size * 0.72;                   // half-diagonal of the turned square, plus a texel
    const rect = [Math.floor(cx - h), Math.floor(cy - h), Math.ceil(cx + h), Math.ceil(cy + h)];
    this.dirty = this.dirty ? [Math.min(this.dirty[0], rect[0]), Math.min(this.dirty[1], rect[1]), Math.max(this.dirty[2], rect[2]), Math.max(this.dirty[3], rect[3])] : rect;
  }

  // Copy the changed part of the canvas to the GPU texture (call once per frame, before rendering).
  flush() {
    if (!this.dirty) return;
    const N = this.N, [a, b, c, d] = this.dirty;
    this.dirty = null;
    const x0 = Math.max(0, a), y0 = Math.max(0, b), x1 = Math.min(N, c), y1 = Math.min(N, d);
    if (x1 <= x0 || y1 <= y0) return;
    const img = this.ctx.getImageData(x0, y0, x1 - x0, y1 - y0);
    const src = new THREE.DataTexture(new Uint8Array(img.data.buffer), x1 - x0, y1 - y0, THREE.RGBAFormat);
    src.needsUpdate = true;
    if (!this.renderer.properties.get(this.tex).__webglTexture) this.renderer.initTexture(this.tex);
    this.renderer.copyTextureToTexture(src, this.tex, null, new THREE.Vector2(x0, y0));
    src.dispose();
  }

  clear() {
    this.ctx.clearRect(0, 0, this.N, this.N);
    this.dirty = [0, 0, this.N, this.N];
    this.queue.length = 0;
    this.rubbleQueue.length = 0;
    this.log.length = 0;
    this.count = 0;
    this.rubbleCount = 0;
  }
}
