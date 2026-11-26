// Selecting and ordering mechs (CLAUDE.md §9 orders and touch controls).
//   Tap one of your mechs: select it. Double-tap: select all of that type on screen.
//   One-finger drag (left-drag with a mouse): box-select.
//   Tap an enemy: the selected mechs attack it. Tap the ground: they go there, by attack-move (default) or move.
//   Two fingers pan / pinch / rotate the camera (right or middle drag with a mouse).
// In a fire test mode (MG / Cannon / Shell) a tap fires at the ground or building instead.
import { CAMERA } from '../config.js';

export class Commander {
  constructor({ units, mechView, view, rts, effects, damage, selected, state, boxEl }) {
    Object.assign(this, { units, mechView, view, rts, effects, damage, selected, state, boxEl });
    this.team = 0;
    this.moveKind = 'amove';
    this.lastTap = { t: 0, unit: null };
    this.box = null;
    this.onSelect = null;        // fn() after the selection changes
    rts.oneFingerPan = false;
    rts.onTap = (cx, cy) => this.tap(cx, cy);
    rts.onStrokeStart = (cx, cy) => this.boxStart(cx, cy);
    rts.onStrokeMove = (cx, cy) => this.boxMove(cx, cy);
    rts.onStrokeEnd = (cx, cy) => this.boxEnd(cx, cy);
  }

  setSelection(list) { this.selected.clear(); for (const u of list) if (u.alive) this.selected.add(u); this.onSelect?.(); }
  mine() { return this.units.list.filter(u => u.team === this.team && u.alive); }

  // Screen position of a unit (or null if behind the camera).
  screen(u) {
    const v = new this.view.camera.position.constructor(u.x, u.y + u.height * 0.5, u.z).project(this.view.camera);
    if (v.z > 1) return null;
    return { x: (v.x + 1) / 2 * innerWidth, y: (1 - v.y) / 2 * innerHeight };
  }

  tap(cx, cy) {
    if (this.state.weapon !== 'move') return this.fireTap(cx, cy);
    const ray = this.rts.screenRay(cx, cy);
    const own = this.mechView.pick(ray, this.units, this.team);
    const enemy = own ? null : this.mechView.pick(ray, this.units, 1 - this.team, true);
    const now = performance.now();
    if (own) {
      if (this.lastTap.unit && this.lastTap.unit.type === own.type && now - this.lastTap.t < CAMERA.doubleTapMs) {
        // Double tap: every mech of this type on screen.
        this.setSelection(this.mine().filter(u => u.type === own.type && this.onScreen(u)));
      } else this.setSelection([own]);
      this.lastTap = { t: now, unit: own };
      return;
    }
    this.lastTap = { t: now, unit: null };
    const sel = [...this.selected].filter(u => u.alive);
    if (!sel.length) return;
    if (enemy) { this.units.attack(sel, enemy); this.effects.dust(enemy.x, enemy.y, enemy.z, 0.8); return; }
    const g = this.view.pickGround(cx, cy);
    if (!g) return;
    this.units.order(sel, this.moveKind, g.x, g.z);
    this.effects.dust(g.x, g.y, g.z, 0.6);
  }

  onScreen(u) { const p = this.screen(u); return p && p.x >= 0 && p.y >= 0 && p.x <= innerWidth && p.y <= innerHeight; }

  fireTap(cx, cy) {
    const g = this.view.pickGround(cx, cy), b = this.view.pickBuilding(cx, cy), cam = this.view.camera.position;
    if (b && (!g || b.point.distanceTo(cam) < Math.hypot(g.x - cam.x, g.y - cam.y, g.z - cam.z))) this.damage.explode(b.point.x, b.point.z, this.state.weapon, b.point.y);
    else if (g) this.damage.explode(g.x, g.z, this.state.weapon);
  }

  boxStart(cx, cy) {
    if (this.state.weapon !== 'move') return;
    this.box = { x0: cx, y0: cy, x1: cx, y1: cy };
    this._drawBox();
  }
  boxMove(cx, cy) { if (!this.box) return; this.box.x1 = cx; this.box.y1 = cy; this._drawBox(); }
  boxEnd() {
    const b = this.box;
    this.box = null;
    this.boxEl.style.display = 'none';
    if (!b) return;
    const x0 = Math.min(b.x0, b.x1), x1 = Math.max(b.x0, b.x1), y0 = Math.min(b.y0, b.y1), y1 = Math.max(b.y0, b.y1);
    if (x1 - x0 < 8 && y1 - y0 < 8) return;
    this.setSelection(this.mine().filter(u => { const p = this.screen(u); return p && p.x >= x0 && p.x <= x1 && p.y >= y0 && p.y <= y1; }));
  }
  _drawBox() {
    const b = this.box, s = this.boxEl.style;
    s.display = 'block';
    s.left = Math.min(b.x0, b.x1) + 'px'; s.top = Math.min(b.y0, b.y1) + 'px';
    s.width = Math.abs(b.x1 - b.x0) + 'px'; s.height = Math.abs(b.y1 - b.y0) + 'px';
  }
}
