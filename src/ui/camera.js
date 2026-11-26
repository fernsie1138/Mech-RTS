// RTS camera: looks down at a target point on the ground at a fixed pitch.
// Touch: one-finger drag pans, two fingers pan + pinch zoom + twist to rotate. A quick touch is a tap.
// Mouse: drag pans, wheel zooms, click is a tap. Keys: WASD / arrows pan, Q/E rotate, +/- zoom.
// While panning, the ground point under the finger stays under the finger.
//
// Paint mode (editor, oneFingerPan = false): one finger / left mouse button paints strokes instead of
// panning (onStrokeStart / onStrokeMove / onStrokeEnd); two fingers or the right/middle mouse button
// move the camera. A stroke begins once the finger moves or is held, so a two-finger gesture whose
// first finger lands slightly early doesn't leave a dab.
import * as THREE from 'three';
import { CAMERA, MAP_SIZE } from '../config.js';

export class RTSCamera {
  constructor(camera, dom, heightAt) {
    this.camera = camera;
    this.dom = dom;
    this.heightAt = heightAt || (() => 0);
    this.target = new THREE.Vector3(0, this.heightAt(0, 0), 0);
    this.distance = CAMERA.startDistance;
    this.pitch = THREE.MathUtils.degToRad(CAMERA.pitchDeg);
    this.yaw = 0;
    this.keys = new Set();
    this.pointers = new Map();        // id -> {x, y}
    this.onTap = null;                // fn(clientX, clientY)
    this.oneFingerPan = true;
    this.onStrokeStart = this.onStrokeMove = this.onStrokeEnd = null;   // fn(clientX, clientY)
    this.stroke = null;               // { x, y, t, started }
    this.mapSize = MAP_SIZE;
    this._ray = new THREE.Raycaster();
    this._plane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);
    this._ndc = new THREE.Vector2();
    this._gesture = null;
    this._bind();
    this.update(0);
  }

  // Ray from the camera through a screen position.
  screenRay(clientX, clientY) {
    const r = this.dom.getBoundingClientRect();
    this._ndc.set(((clientX - r.left) / r.width) * 2 - 1, -((clientY - r.top) / r.height) * 2 + 1);
    this._ray.setFromCamera(this._ndc, this.camera);
    return this._ray.ray;
  }

  // Point on the horizontal pan plane (at the target's height) under a screen position, or null.
  groundPoint(clientX, clientY, out = new THREE.Vector3()) {
    this._plane.constant = -this.target.y;
    return this.screenRay(clientX, clientY).intersectPlane(this._plane, out);
  }

  _centroid() {
    let x = 0, y = 0;
    for (const p of this.pointers.values()) { x += p.x; y += p.y; }
    const n = this.pointers.size || 1;
    return { x: x / n, y: y / n };
  }

  _pair() {
    const pts = [...this.pointers.values()];
    if (pts.length < 2) return null;
    return { spread: Math.hypot(pts[0].x - pts[1].x, pts[0].y - pts[1].y),
             angle: Math.atan2(pts[1].y - pts[0].y, pts[1].x - pts[0].x) };
  }

  // Move the target so the world point under (oldX, oldY) ends up under (newX, newY).
  _panScreen(oldX, oldY, newX, newY) {
    const a = this.groundPoint(oldX, oldY, new THREE.Vector3());
    const b = this.groundPoint(newX, newY, new THREE.Vector3());
    if (!a || !b) return;
    this.target.x += a.x - b.x;
    this.target.z += a.z - b.z;
    this._apply();
  }

  // Zoom; with a screen position, around the ground under it (pinch zooms around the fingers).
  zoomBy(factor, cx, cy) {
    const before = cx !== undefined ? this.groundPoint(cx, cy, new THREE.Vector3()) : null;
    this.distance = THREE.MathUtils.clamp(this.distance * factor, CAMERA.minDistance, CAMERA.maxDistance);
    this._apply();
    if (before) {
      const after = this.groundPoint(cx, cy, new THREE.Vector3());
      if (after) { this.target.x += before.x - after.x; this.target.z += before.z - after.z; this._apply(); }
    }
  }

  // Rotate around the point under screen position (cx, cy) so it stays put.
  rotateBy(dYaw, cx, cy) {
    const before = cx !== undefined ? this.groundPoint(cx, cy, new THREE.Vector3()) : null;
    this.yaw += dYaw;
    this._apply();
    if (before) {
      const after = this.groundPoint(cx, cy, new THREE.Vector3());
      if (after) { this.target.x += before.x - after.x; this.target.z += before.z - after.z; this._apply(); }
    }
  }

  _bind() {
    const el = this.dom;
    el.addEventListener('pointerdown', e => {
      el.setPointerCapture?.(e.pointerId);
      this.pointers.set(e.pointerId, { x: e.clientX, y: e.clientY, mousePan: e.pointerType === 'mouse' && e.button !== 0 });
      if (!this.oneFingerPan) {
        if (this.pointers.size === 1 && !(e.pointerType === 'mouse' && e.button !== 0)) {
          this.stroke = { x: e.clientX, y: e.clientY, t: performance.now(), started: false };
        } else this._endStroke();     // second finger: this is a camera gesture
      }
      if (this.pointers.size === 1) {
        this._gesture = { x: e.clientX, y: e.clientY, t: e.timeStamp, maxPointers: 1, moved: 0 };
      } else if (this._gesture) {
        this._gesture.maxPointers = Math.max(this._gesture.maxPointers, this.pointers.size);
      }
      this._last = this._centroid();
      this._lastPair = this._pair();
    });
    el.addEventListener('pointermove', e => {
      const p = this.pointers.get(e.pointerId);
      if (!p) return;
      p.x = e.clientX; p.y = e.clientY;
      const c = this._centroid();
      if (this._gesture) this._gesture.moved = Math.max(this._gesture.moved, Math.hypot(c.x - this._gesture.x, c.y - this._gesture.y));
      if (this.stroke) {
        if (!this.stroke.started && Math.hypot(e.clientX - this.stroke.x, e.clientY - this.stroke.y) > 6) this._startStroke();
        if (this.stroke?.started) this.onStrokeMove?.(e.clientX, e.clientY);
        this.stroke && (this.stroke.cx = e.clientX, this.stroke.cy = e.clientY);
        this._last = c;
        return;
      }
      const painting = !this.oneFingerPan && this.pointers.size === 1 && !p.mousePan;
      if (this._last && !painting) this._panScreen(this._last.x, this._last.y, c.x, c.y);
      const pair = this._pair();
      if (pair && this._lastPair) {
        if (pair.spread > 0 && this._lastPair.spread > 0) this.zoomBy(this._lastPair.spread / pair.spread, c.x, c.y);
        let da = pair.angle - this._lastPair.angle;
        if (da > Math.PI) da -= 2 * Math.PI;
        if (da < -Math.PI) da += 2 * Math.PI;
        // Ignore tiny twists so pinching doesn't wobble the view.
        if (Math.abs(da) > 0.002) this.rotateBy(da, c.x, c.y);
      }
      this._last = c;
      this._lastPair = pair;
    });
    const up = e => {
      if (!this.pointers.has(e.pointerId)) return;
      this.pointers.delete(e.pointerId);
      this._last = this.pointers.size ? this._centroid() : null;
      this._lastPair = this._pair();
      if (this.stroke && this.pointers.size === 0) {
        if (this.stroke.started) this._endStroke();
        else this.stroke = null;          // never started: it's a tap (handled below)
      }
      if (this.pointers.size === 0 && this._gesture) {
        const g = this._gesture;
        this._gesture = null;
        const isTap = e.type === 'pointerup' && g.maxPointers === 1 && g.moved < CAMERA.tapMaxMove &&
          e.timeStamp - g.t < CAMERA.tapMaxTime;   // event times, so a slow frame cannot turn a tap into a hold
        if (isTap && this.onTap) this.onTap(e.clientX, e.clientY);
      }
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

  _startStroke() {
    const s = this.stroke;
    s.started = true;
    s.cx = s.cx ?? s.x; s.cy = s.cy ?? s.y;
    this.onStrokeStart?.(s.x, s.y);
  }

  _endStroke() {
    const s = this.stroke;
    this.stroke = null;
    if (s?.started) this.onStrokeEnd?.(s.cx, s.cy);
  }

  update(dt) {
    // A finger held still in paint mode starts painting after a moment.
    if (this.stroke && !this.stroke.started && performance.now() - this.stroke.t > CAMERA.strokeHoldMs) this._startStroke();
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
      if (k.has('q')) this.yaw += CAMERA.keyRotateSpeed * dt;
      if (k.has('e')) this.yaw -= CAMERA.keyRotateSpeed * dt;
      if (k.has('=') || k.has('+')) this.distance *= 1 - dt;
      if (k.has('-') || k.has('_')) this.distance *= 1 + dt;
      this.distance = THREE.MathUtils.clamp(this.distance, CAMERA.minDistance, CAMERA.maxDistance);
    }
    // Follow the ground height under the target smoothly, but not mid-gesture (keeps the finger anchored).
    if (dt > 0 && this.pointers.size === 0) {
      const t = this.target, r = 8;
      const g = (this.heightAt(t.x, t.z) * 2 + this.heightAt(t.x + r, t.z) + this.heightAt(t.x - r, t.z) +
                 this.heightAt(t.x, t.z + r) + this.heightAt(t.x, t.z - r)) / 6;
      t.y += (g - t.y) * Math.min(1, dt * 3);
    }
    this._apply();
  }

  // Place the camera from target / distance / pitch / yaw.
  _apply() {
    const half = this.mapSize / 2;
    this.target.x = THREE.MathUtils.clamp(this.target.x, -half, half);
    this.target.z = THREE.MathUtils.clamp(this.target.z, -half, half);
    const h = Math.sin(this.pitch) * this.distance;
    const back = Math.cos(this.pitch) * this.distance;
    const cx = this.target.x + Math.sin(this.yaw) * back, cz = this.target.z + Math.cos(this.yaw) * back;
    let cy = this.target.y + h;
    const floor = this.heightAt(cx, cz) + CAMERA.minClearance;
    if (cy < floor) cy = floor;
    this.camera.position.set(cx, cy, cz);
    this.camera.lookAt(this.target);
    this.camera.updateMatrixWorld();
  }
}
