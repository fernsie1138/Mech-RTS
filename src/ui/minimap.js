// Minimap (CLAUDE.md §9): the whole map, north up. Ground colours come from the live terrain (so craters, scorch
// and rubble show up as the battle wears the map down), with capture points, HQs, mechs and the camera's view.
// Tap or drag on it to move the camera there.
import { SURFACE, FEATURE } from '../terrain/surface.js';

const RES = 128;                 // ground image resolution
const TEAM = ['#5aa2ff', '#ff5a48'];

export class Minimap {
  // canvas: <canvas>   world: { hf, surface, water, forest }   rts: camera controller   size: map size in world units
  constructor(canvas, { world, rts, units, size, getMatch, selected }) {
    Object.assign(this, { canvas, world, rts, units, size, getMatch, selected });
    this.ctx = canvas.getContext('2d');
    this.ground = document.createElement('canvas');
    this.ground.width = this.ground.height = RES;
    this.gctx = this.ground.getContext('2d');
    this.img = this.gctx.createImageData(RES, RES);
    this.groundT = Infinity;     // seconds since the ground image was drawn
    this.t = 0;
    this._bind();
  }

  // World (x, z) -> minimap pixels.
  toMap(x, z) { const W = this.canvas.width; return [(x / this.size + 0.5) * W, (z / this.size + 0.5) * W]; }

  _drawGround() {
    const { hf, surface, water } = this.world, d = this.img.data, S = this.size;
    for (let j = 0; j < RES; j++) for (let i = 0; i < RES; i++) {
      const x = ((i + 0.5) / RES - 0.5) * S, z = ((j + 0.5) / RES - 0.5) * S;
      const h = hf.heightAt(x, z), k = hf.index(Math.round(hf.gx(x)), Math.round(hf.gz(z)));
      const shade = Math.max(0.55, Math.min(1.35, 0.9 + h * 0.025));
      let r = 86, g = 128, b = 60;                                       // grass
      const base = surface.base[k], f = surface.features[k];
      if (f & FEATURE.FOREST) { r = 40; g = 86; b = 38; }
      else if (f & FEATURE.TREES) { r = 62; g = 106; b = 48; }
      if (base === SURFACE.ROAD) { r = 120; g = 118; b = 110; }
      if (base === SURFACE.RUBBLE) { r = 112; g = 104; b = 96; }
      const dm = Math.min(1, surface.damage[k]), sc = Math.min(1, surface.scorch[k]);
      r += (112 - r) * dm; g += (92 - g) * dm; b += (64 - b) * dm;        // churned to dirt
      r *= 1 - 0.65 * sc; g *= 1 - 0.65 * sc; b *= 1 - 0.65 * sc;        // burnt
      r *= shade; g *= shade; b *= shade;
      const wd = water ? water.depthAt(x, z) : 0;
      if (wd > 0.05) { const t = Math.min(1, 0.55 + wd * 0.3); r += (40 - r) * t; g += (92 - g) * t; b += (150 - b) * t; }
      const o = (j * RES + i) * 4;
      d[o] = r; d[o + 1] = g; d[o + 2] = b; d[o + 3] = 255;
    }
    this.gctx.putImageData(this.img, 0, 0);
  }

  // Redraw. dt: seconds since the last call. The ground image is redrawn every 2 s (it changes slowly).
  update(dt) {
    this.t += dt;
    if ((this.groundT += dt) > 2) { this.groundT = 0; this._drawGround(); }
    const c = this.ctx, W = this.canvas.width, s = W / 180;
    c.imageSmoothingEnabled = true;
    c.drawImage(this.ground, 0, 0, W, W);
    const m = this.getMatch?.();
    if (m) {
      for (const p of m.points) {
        const [x, y] = this.toMap(p.x, p.z);
        c.lineWidth = 3 * s;
        c.strokeStyle = p.owner === null ? '#ffd23a' : TEAM[p.owner];
        c.beginPath(); c.arc(x, y, 6 * s, 0, 7); c.stroke();
        if (p.owner === null && p.control !== 0) {        // capture progress
          c.strokeStyle = TEAM[p.control > 0 ? 0 : 1];
          c.beginPath(); c.arc(x, y, 6 * s, -Math.PI / 2, -Math.PI / 2 + Math.abs(p.control) * Math.PI * 2); c.stroke();
        }
      }
    }
    for (const h of this.units.structures || []) {
      const [x, y] = this.toMap(h.x, h.z), r = 6 * s;
      c.fillStyle = h.alive ? TEAM[h.team] : '#222';
      c.fillRect(x - r, y - r, 2 * r, 2 * r);
      c.strokeStyle = '#000'; c.lineWidth = 1.5 * s; c.strokeRect(x - r, y - r, 2 * r, 2 * r);
    }
    for (const u of this.units.list) {
      if (!u.alive) continue;
      const [x, y] = this.toMap(u.x, u.z), r = (1.6 + u.t.scale * 1.2) * s;
      c.fillStyle = this.selected?.has(u) ? '#b8ffc8' : TEAM[u.team];
      c.fillRect(x - r, y - r, 2 * r, 2 * r);
    }
    // Camera footprint: where the screen's corners meet the ground.
    const cs = [[0, 0], [innerWidth, 0], [innerWidth, innerHeight], [0, innerHeight]].map(([x, y]) => this.rts.groundPoint(x, y));
    if (cs.every(Boolean)) {
      c.strokeStyle = 'rgba(255,255,255,.85)'; c.lineWidth = 1.5 * s;
      c.beginPath();
      cs.forEach((p, i) => { const [x, y] = this.toMap(p.x, p.z); i ? c.lineTo(x, y) : c.moveTo(x, y); });
      c.closePath(); c.stroke();
    }
  }

  // Centre the camera on the map point under a screen position on the minimap.
  jump(clientX, clientY) {
    const r = this.canvas.getBoundingClientRect();
    const x = ((clientX - r.left) / r.width - 0.5) * this.size, z = ((clientY - r.top) / r.height - 0.5) * this.size;
    const L = this.size / 2;
    this.rts.target.set(Math.max(-L, Math.min(L, x)), this.world.hf.heightAt(x, z), Math.max(-L, Math.min(L, z)));
    this.rts.update(0);
  }

  _bind() {
    const el = this.canvas;
    let down = false;
    el.addEventListener('pointerdown', e => { e.preventDefault(); e.stopPropagation(); down = true; el.setPointerCapture?.(e.pointerId); this.jump(e.clientX, e.clientY); });
    el.addEventListener('pointermove', e => { if (down) this.jump(e.clientX, e.clientY); });
    const up = () => { down = false; };
    el.addEventListener('pointerup', up);
    el.addEventListener('pointercancel', up);
  }
}
