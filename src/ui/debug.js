// Debug overlay: fps, frame time, draw calls, triangles. Toggled by the FPS button or the ` key.
export class DebugOverlay {
  constructor(el, button, renderer) {
    this.el = el;
    this.button = button;
    this.renderer = renderer;
    this.visible = false;
    this.frames = 0;
    this.accum = 0;
    this.fps = 0;
    this.frameMs = 0;
    this.worst = 0;
    this._worstWindow = 0;
    button.addEventListener('pointerup', () => this.toggle());
    window.addEventListener('keydown', e => { if (e.key === '`') this.toggle(); });
  }

  toggle(on = !this.visible) {
    this.visible = on;
    this.el.style.display = on ? 'block' : 'none';
    this.button.classList.toggle('on', on);
  }

  // Call once per rendered frame, after renderer.render().
  frame(dtSeconds) {
    this.frames++;
    this.accum += dtSeconds;
    this._worstWindow = Math.max(this._worstWindow, dtSeconds);
    if (this.accum >= 0.5) {
      this.fps = this.frames / this.accum;
      this.frameMs = (this.accum / this.frames) * 1000;
      this.worst = this._worstWindow * 1000;
      this.frames = 0; this.accum = 0; this._worstWindow = 0;
      if (this.visible) this._draw();
    }
  }

  stats() {
    const r = this.renderer.info;
    return {
      fps: this.fps,
      frameMs: this.frameMs,
      worstMs: this.worst,
      calls: r.render.calls,
      triangles: r.render.triangles,
      geometries: r.memory.geometries,
      textures: r.memory.textures,
      pixelRatio: this.renderer.getPixelRatio(),
    };
  }

  _draw() {
    const s = this.stats();
    this.el.textContent =
      `fps        ${s.fps.toFixed(0)}\n` +
      `frame ms   ${s.frameMs.toFixed(1)}  (worst ${s.worstMs.toFixed(0)})\n` +
      `draw calls ${s.calls}\n` +
      `triangles  ${s.triangles.toLocaleString()}\n` +
      `geo / tex  ${s.geometries} / ${s.textures}\n` +
      `pixel rat. ${s.pixelRatio}`;
  }
}
