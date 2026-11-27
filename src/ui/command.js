// Selecting and ordering mechs (CLAUDE.md §9 orders and touch controls).
//   Tap one of your mechs: select it. Double-tap: select all of that type on screen.
//   One-finger drag (left-drag with a mouse): box-select.
//   Tap an enemy: the selected mechs attack it. Tap the ground: they go there, by attack-move (default) or move.
//   Two fingers pan / pinch / rotate the camera (right or middle drag with a mouse).
// In a fire test mode (MG / Cannon / Shell) a tap fires at the ground or building instead.
// Builder orders (placing = 'wall' | 'turret' | 'trench'): a turret is placed with a tap. A wall or trench is
// planned first (`pending`, shown as a green / red preview): tap for one (across the screen) or drag a line for a
// row; tap again to move it; turn it with rotatePending(); then confirmPending() orders it (cancelPending drops it).
// Tapping an unfinished site with Builders selected puts them back to work on it.
import { CAMERA, BUILD } from '../config.js';


export class Commander {
  constructor({ units, mechView, view, rts, effects, damage, selected, state, boxEl, construction = null }) {
    Object.assign(this, { units, mechView, view, rts, effects, damage, selected, state, boxEl, construction });
    this.canSee = () => true;    // fog of war: can enemies be seen (and so tapped)?
    this.tapSlop = 14;           // screen pixels: a tap this close to a mech counts as tapping it (more in Mobile Mode)
    this.placing = null;
    this.line = null;
    this.onPlaced = null;        // fn(result, kind) after a Builder order (result from construction.order)
    this.pending = null;         // a planned wall / trench: { kind, cx, cz, len, rot }
    this.onPending = null;       // fn(pending or null) when it changes (the page shows Turn / Build / Cancel)
    this.team = 0;
    this.moveKind = 'move';      // a tap on the ground: plain move (the A-Move button switches to attack-move)
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

  nearestOnScreen(cx, cy, team, px = this.tapSlop) {
    let best = null, bd = px;
    for (const u of this.units.list) {
      if (!u.alive || u.team !== team || !this.canSee(u)) continue;
      const p = this.screen(u);
      if (!p) continue;
      const d = Math.hypot(p.x - cx, p.y - cy);
      if (d < bd) { bd = d; best = u; }
    }
    return best;
  }

  builders() { return [...this.selected].filter(u => u.alive && u.t.unarmed); }

  setPlacing(kind) { this.placing = kind; this.line = null; this.pending = null; this.mechView.preview = null; this.onPending?.(null); }

  // ---------- a planned wall / trench, before it is ordered ----------
  _setPending(p) {
    this.pending = p;
    this.mechView.preview = p ? this._pendingPlan() : null;
    this.onPending?.(p);
  }
  _pendingPlan() {
    const p = this.pending, dx = Math.cos(p.rot), dz = -Math.sin(p.rot);
    return this.construction.plan(p.kind, p.cx - dx * p.len / 2, p.cz - dz * p.len / 2, p.cx + dx * p.len / 2, p.cz + dz * p.len / 2);
  }
  rotatePending(d) { if (this.pending) this._setPending({ ...this.pending, rot: this.pending.rot + d }); }
  confirmPending() { if (this.pending) this._place(this._pendingPlan()); }
  cancelPending() { this.setPlacing(null); }

  // Wall / trench direction for a single tap: across the screen at (cx, cy).
  _acrossRot(cx, cy) {
    const a = this.view.pickGround(cx - 60, cy), b = this.view.pickGround(cx + 60, cy);
    return a && b ? Math.atan2(-(b.z - a.z), b.x - a.x) : 0;
  }
  _plan(a, b, cx, cy) {
    return this.construction.plan(this.placing, a.x, a.z, b ? b.x : null, b ? b.z : null, this._acrossRot(cx, cy));
  }
  _place(plan) {
    const kind = this.placing;
    const r = this.construction.order(this.builders(), plan);
    this.setPlacing(null);
    this.onPlaced?.(r, kind);
  }

  tap(cx, cy) {
    if (this.state.weapon !== 'move') return this.fireTap(cx, cy);
    if (this.placing === 'repair' && this.construction) {
      // Repair: tap one of your mechs, turrets or the HQ; the selected Builders go and mend it.
      const t = this.mechView.pick(this.rts.screenRay(cx, cy), this.units, this.team, true) || this.nearestOnScreen(cx, cy, this.team);
      const kind = this.placing;
      this.setPlacing(null);
      if (t) this.construction.repair(this.builders(), t);
      this.onPlaced?.({ jobs: [], refused: t ? null : 'none', repair: t }, kind);
      return;
    }
    if (this.placing && this.construction) {
      const g = this.view.pickGround(cx, cy);
      if (!g) return;
      if (this.placing === 'turret') { this._place(this._plan(g, null, cx, cy)); return; }
      // Wall / trench: plan one here (or move the one already planned, keeping its angle and length).
      const p = this.pending;
      this._setPending(p ? { ...p, cx: g.x, cz: g.z } : { kind: this.placing, cx: g.x, cz: g.z, len: BUILD[this.placing].len, rot: this._acrossRot(cx, cy) });
      return;
    }
    const ray = this.rts.screenRay(cx, cy);
    // A ray through the body, or failing that the nearest mech within a finger's width on screen (small mechs
    // are tiny when zoomed out, especially on a phone).
    const own = this.mechView.pick(ray, this.units, this.team) || this.nearestOnScreen(cx, cy, this.team);
    // Enemies only by a tap on their body: a tap near one in a crowded fight is a move order, not an attack.
    let enemy = own ? null : this.mechView.pick(ray, this.units, 1 - this.team, true, 0.2);
    if (enemy && !this.canSee(enemy)) enemy = null;
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
    if (enemy) { this.units.attack(sel.filter(u => !u.t.unarmed), enemy); this.effects.dust(enemy.x, enemy.y, enemy.z, 0.8); return; }
    const g = this.view.pickGround(cx, cy);
    if (!g) return;
    // An unfinished site: selected Builders go back to work on it; the rest of the selection moves there.
    const site = this.construction?.siteAt(g.x, g.z, this.team);
    const builders = site ? this.builders() : [];
    if (builders.length) this.construction.assign(builders, [site]);
    const rest = sel.filter(u => !builders.includes(u));
    if (rest.length) this.units.order(rest, this.moveKind, g.x, g.z);
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
    // Repair mode: a press that lasts a moment or drifts a little (easy with a finger) is still a tap on the mech.
    if (this.placing === 'repair') { this.repairPress = { cx, cy }; return; }
    if (this.placing && this.construction && BUILD[this.placing]) {
      const a = this.view.pickGround(cx, cy);
      if (a) { this.line = { a }; this.mechView.preview = this._plan(a, null, cx, cy); }
      return;
    }
    this.box = { x0: cx, y0: cy, x1: cx, y1: cy };
    this._drawBox();
  }
  boxMove(cx, cy) {
    if (this.line) {
      const b = this.view.pickGround(cx, cy);
      if (b) { this.line.b = b; this.mechView.preview = this._plan(this.line.a, b, cx, cy); }
      return;
    }
    if (!this.box) return;
    this.box.x1 = cx; this.box.y1 = cy; this._drawBox();
  }
  boxEnd(cx, cy) {
    if (this.repairPress) { const p = this.repairPress; this.repairPress = null; this.tap(p.cx, p.cy); return; }
    if (this.line) {
      const { a, b } = this.line;
      this.line = null;
      if (this.placing === 'turret') { this._place(this._plan(a, b || null, cx, cy)); return; }
      // A line drawn with a finger: planned along it, ready to turn or build.
      const L = b ? Math.hypot(b.x - a.x, b.z - a.z) : 0, len = BUILD[this.placing].len;
      if (L < len * 0.5) this._setPending({ kind: this.placing, cx: a.x, cz: a.z, len, rot: this._acrossRot(cx, cy) });
      else this._setPending({ kind: this.placing, cx: (a.x + b.x) / 2, cz: (a.z + b.z) / 2, len: L, rot: Math.atan2(-(b.z - a.z), b.x - a.x) });
      return;
    }
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
