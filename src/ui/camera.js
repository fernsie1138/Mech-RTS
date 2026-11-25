// RTS camera: looks down at a target point on the ground at a fixed pitch.
// Touch: one-finger drag pans, two fingers pan + pinch zoom.
// Mouse: drag pans, wheel zooms. Keys: WASD / arrows pan, +/- zoom.
// The point under the finger stays under the finger while panning (ground-anchored).
import * as THREE from 'three';
import { CAMERA, MAP_SIZE } from '../config.js';

export class RTSCamera {
  constructor(camera, dom) {
    this.camera = camera;
    this.dom = dom;
    this.target = new THREE.Vector3(0, 0, 0);
    this.distance = CAMERA.startDistance;
    this.pitch = THREE.MathUtils.degToRad(CAMERA.pitchDeg);
    this.yaw = 0;
    this.keys = new Set();
    this.pointers = new Map();        // id -> {x, y}
    this._ray = new THREE.Raycaster();
    this._plane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);
    this._ndc = new THREE.Vector2();
    this._bind();
    this.update(0);
  }

  // World point on the ground plane under a screen position, or null.
  groundPoint(clientX, clientY, out = new THREE.Vector3()) {
    const r = this.dom.getBoundingClientRect();
    this._ndc.set(((clientX - r.left) / r.width) * 2 - 1, -((clientY - r.top) / r.height) * 2 + 1);
    this._ray.setFromCamera(this._ndc, this.camera);
    return this._ray.ray.intersectPlane(this._plane, out);
  }

  _centroid() {
    let x = 0, y = 0;
    for (const p of this.pointers.values()) { x += p.x; y += p.y; }
    const n = this.pointers.size || 1;
    return { x: x / n, y: y / n };
  }

  _spread() {
    const pts = [...this.pointers.values()];
    if (pts.length < 2) return 0;
    return Math.hypot(pts[0].x - pts[1].x, pts[0].y - pts[1].y);
  }

  // Move the target so that world point `a` (under the old screen pos) ends up under the new screen pos.
  _panScreen(oldX, oldY, newX, newY) {
    const a = this.groundPoint(oldX, oldY, new THREE.Vector3());
    const b = this.groundPoint(newX, newY, new THREE.Vector3());
    if (!a || !b) return;
    this.target.x += a.x - b.x;
    this.target.z += a.z - b.z;
    this.update(0);
  }

  zoomBy(factor) {
    this.distance = THREE.MathUtils.clamp(this.distance * factor, CAMERA.minDistance, CAMERA.maxDistance);
    this.update(0);
  }

  _bind() {
    const el = this.dom;
    el.addEventListener('pointerdown', e => {
      el.setPointerCapture?.(e.pointerId);
      this.pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
      this._last = this._centroid();
      this._lastSpread = this._spread();
    });
    el.addEventListener('pointermove', e => {
      const p = this.pointers.get(e.pointerId);
      if (!p) return;
      p.x = e.clientX; p.y = e.clientY;
      const c = this._centroid();
      if (this._last) this._panScreen(this._last.x, this._last.y, c.x, c.y);
      const s = this._spread();
      if (s > 0 && this._lastSpread > 0) this.zoomBy(this._lastSpread / s);
      this._last = c;
      this._lastSpread = s;
    });
    const up = e => {
      this.pointers.delete(e.pointerId);
      this._last = this.pointers.size ? this._centroid() : null;
      this._lastSpread = this._spread();
    };
    el.addEventListener('pointerup', up);
    el.addEventListener('pointercancel', up);
    el.addEventListener('wheel', e => {
      e.preventDefault();
      this.zoomBy(Math.exp(e.deltaY * CAMERA.wheelZoomFactor));
    }, { passive: false });
    window.addEventListener('keydown', e => this.keys.add(e.key.toLowerCase()));
    window.addEventListener('keyup', e => this.keys.delete(e.key.toLowerCase()));
    window.addEventListener('blur', () => this.keys.clear());
  }

  update(dt) {
    const k = this.keys;
    if (dt > 0 && k.size) {
      const speed = CAMERA.keyPanSpeed * this.distance * dt;
      let dx = 0, dz = 0;
      if (k.has('w') || k.has('arrowup')) dz -= 1;
      if (k.has('s') || k.has('arrowdown')) dz += 1;
      if (k.has('a') || k.has('arrowleft')) dx -= 1;
      if (k.has('d') || k.has('arrowright')) dx += 1;
      const c = Math.cos(this.yaw), s = Math.sin(this.yaw);
      this.target.x += (dx * c + dz * s) * speed;
      this.target.z += (-dx * s + dz * c) * speed;
      if (k.has('=') || k.has('+')) this.distance *= 1 - dt;
      if (k.has('-') || k.has('_')) this.distance *= 1 + dt;
      this.distance = THREE.MathUtils.clamp(this.distance, CAMERA.minDistance, CAMERA.maxDistance);
    }
    const half = MAP_SIZE / 2;
    this.target.x = THREE.MathUtils.clamp(this.target.x, -half, half);
    this.target.z = THREE.MathUtils.clamp(this.target.z, -half, half);

    const h = Math.sin(this.pitch) * this.distance;
    const back = Math.cos(this.pitch) * this.distance;
    this.camera.position.set(
      this.target.x + Math.sin(this.yaw) * back,
      this.target.y + h,
      this.target.z + Math.cos(this.yaw) * back,
    );
    this.camera.lookAt(this.target);
  }
}
