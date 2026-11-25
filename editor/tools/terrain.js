// Terrain brushes: raise, lower, flatten, smooth. Each call applies one dab of `dt` seconds' worth of brush.
// Returns the sample rectangle that changed, or null.
export const BRUSH_LIMITS = { maxHeight: 80 };
export const BRUSH_RATE = {
  raise: 10,       // units per second at full strength, brush centre
  lower: 10,
  flatten: 6,      // fraction-ish per second toward the target height
  smooth: 8,
};

// Smooth cosine fall-off: 1 at the centre, 0 at the edge.
const falloff = (d, r) => d >= r ? 0 : 0.5 * (1 + Math.cos(Math.PI * d / r));

export function applyBrush(hf, tool, x, z, { radius, strength, dt, target = 0 }) {
  const { i0, i1, j0, j1 } = hf.rect(x, z, radius);
  if (i0 > i1 || j0 > j1) return null;
  const h = hf.h, V = hf.verts;
  const rate = BRUSH_RATE[tool] * strength * dt;
  let src = null;
  if (tool === 'smooth') {
    // Read from a copy so the blur doesn't smear in the scan direction.
    src = new Float32Array((i1 - i0 + 3) * (j1 - j0 + 3));
  }
  const W = i1 - i0 + 3;
  if (src) for (let j = j0 - 1; j <= j1 + 1; j++) for (let i = i0 - 1; i <= i1 + 1; i++) src[(j - j0 + 1) * W + (i - i0 + 1)] = hf.sample(i, j);
  for (let j = j0; j <= j1; j++) {
    for (let i = i0; i <= i1; i++) {
      const f = falloff(Math.hypot(hf.wx(i) - x, hf.wz(j) - z), radius);
      if (f <= 0) continue;
      const k = j * V + i;
      let v = h[k];
      if (tool === 'raise') v += rate * f;
      else if (tool === 'lower') v -= rate * f;
      else if (tool === 'flatten') v += (target - v) * Math.min(1, rate * f);
      else if (tool === 'smooth') {
        const c = (j - j0 + 1) * W + (i - i0 + 1);
        const avg = (src[c - W - 1] + src[c - W] + src[c - W + 1] + src[c - 1] + src[c] + src[c + 1] + src[c + W - 1] + src[c + W] + src[c + W + 1]) / 9;
        v += (avg - v) * Math.min(1, rate * f);
      }
      h[k] = Math.min(BRUSH_LIMITS.maxHeight, Math.max(hf.bedrock, v));
    }
  }
  hf.changed(i0, j0, i1, j1);
  return { i0, j0, i1, j1 };
}
