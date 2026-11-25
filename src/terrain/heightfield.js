// Height grid data, sampling and deformation. Pure data: no three.js, so it runs in Node tests too.
//
// The map is a square of `size` world units centred on the origin (x and z from -size/2 to +size/2).
// It is divided into `cells` x `cells` cells, so there are (cells+1)^2 height samples (vertices).
// Sample (i, j) sits at world x = -size/2 + i*spacing, z = -size/2 + j*spacing; index = j*(cells+1) + i.
//
// Every system samples height through heightAt(x, z).

export class Heightfield {
  constructor({ size, cells, bedrock, maxSlope }) {
    this.size = size;
    this.cells = cells;
    this.verts = cells + 1;
    this.spacing = size / cells;
    this.half = size / 2;
    this.bedrock = bedrock;          // nothing can dig below this height
    this.maxSlope = maxSlope;        // rise/run; deformation relaxes steeper slopes (material slides)
    const n = this.verts * this.verts;
    this.h = new Float32Array(n);
    this.listeners = [];             // fn(i0, j0, i1, j1) called with the sample rectangle that changed
  }

  index(i, j) { return j * this.verts + i; }

  // World <-> grid coordinates (fractional).
  gx(x) { return (x + this.half) / this.spacing; }
  gz(z) { return (z + this.half) / this.spacing; }
  wx(i) { return -this.half + i * this.spacing; }
  wz(j) { return -this.half + j * this.spacing; }

  inside(x, z) { return x >= -this.half && x <= this.half && z >= -this.half && z <= this.half; }

  // Height of sample (i, j), clamped to the grid edge.
  sample(i, j) {
    const v = this.verts - 1;
    i = i < 0 ? 0 : i > v ? v : i;
    j = j < 0 ? 0 : j > v ? v : j;
    return this.h[j * this.verts + i];
  }

  // Bilinear height at world position. Outside the map, the edge height is used.
  heightAt(x, z) {
    const v = this.verts - 1;
    let fx = this.gx(x), fz = this.gz(z);
    fx = fx < 0 ? 0 : fx > v ? v : fx;
    fz = fz < 0 ? 0 : fz > v ? v : fz;
    let i = Math.floor(fx), j = Math.floor(fz);
    if (i >= v) i = v - 1;
    if (j >= v) j = v - 1;
    const tx = fx - i, tz = fz - j;
    const k = j * this.verts + i, h = this.h;
    const a = h[k], b = h[k + 1], c = h[k + this.verts], d = h[k + this.verts + 1];
    return (a * (1 - tx) + b * tx) * (1 - tz) + (c * (1 - tx) + d * tx) * tz;
  }

  // Surface normal at world position (unnormalised components are fine for slope checks).
  normalAt(x, z, out = { x: 0, y: 1, z: 0 }) {
    const e = this.spacing;
    const dx = this.heightAt(x + e, z) - this.heightAt(x - e, z);
    const dz = this.heightAt(x, z + e) - this.heightAt(x, z - e);
    const nx = -dx, ny = 2 * e, nz = -dz;
    const l = Math.hypot(nx, ny, nz);
    out.x = nx / l; out.y = ny / l; out.z = nz / l;
    return out;
  }

  // Slope (rise/run) at world position.
  slopeAt(x, z) {
    const e = this.spacing;
    const dx = (this.heightAt(x + e, z) - this.heightAt(x - e, z)) / (2 * e);
    const dz = (this.heightAt(x, z + e) - this.heightAt(x, z - e)) / (2 * e);
    return Math.hypot(dx, dz);
  }

  // Fill every sample from fn(x, z) -> height.
  generate(fn) {
    for (let j = 0; j < this.verts; j++) {
      for (let i = 0; i < this.verts; i++) {
        this.h[j * this.verts + i] = Math.max(this.bedrock, fn(this.wx(i), this.wz(j)));
      }
    }
    this.changed(0, 0, this.verts - 1, this.verts - 1);
  }

  onChange(fn) { this.listeners.push(fn); }

  changed(i0, j0, i1, j1) {
    const v = this.verts - 1;
    i0 = Math.max(0, i0); j0 = Math.max(0, j0); i1 = Math.min(v, i1); j1 = Math.min(v, j1);
    for (const fn of this.listeners) fn(i0, j0, i1, j1);
  }

  // Sample rectangle covering a world-space circle.
  rect(x, z, r) {
    const v = this.verts - 1;
    return {
      i0: Math.max(0, Math.floor(this.gx(x - r))), i1: Math.min(v, Math.ceil(this.gx(x + r))),
      j0: Math.max(0, Math.floor(this.gz(z - r))), j1: Math.min(v, Math.ceil(this.gz(z + r))),
    };
  }

  // Blast a crater at (x, z).
  //   radius: bowl radius (world units); depth: bowl depth at centre.
  //   rim:    rim height as a fraction of depth (the rim extends to 1.5 x radius).
  //   erode:  0..1, how strongly the blast area is pulled toward its local average first. Repeated hits on a
  //           ridge or peak flatten it, so sustained fire wears mountains down.
  // Returns { removed, minH, maxDelta } for tests and effects.
  crater(x, z, { radius, depth, rim = 0.25, erode = 0.3 }) {
    const outer = radius * 1.5;
    const pad = this.spacing * 2;
    // The outermost ring of samples is never changed, so the map edge can't open holes.
    let { i0, i1, j0, j1 } = this.rect(x, z, outer + pad);
    const v = this.verts - 1;
    i0 = Math.max(1, i0); j0 = Math.max(1, j0); i1 = Math.min(v - 1, i1); j1 = Math.min(v - 1, j1);
    if (i0 > i1 || j0 > j1) return { removed: 0, minH: Infinity, maxDelta: 0 };
    const w = i1 - i0 + 1, hgt = j1 - j0 + 1;
    const before = new Float32Array(w * hgt);
    for (let j = j0; j <= j1; j++) for (let i = i0; i <= i1; i++) before[(j - j0) * w + (i - i0)] = this.h[this.index(i, j)];

    // 1. Erosion: blend toward a blurred copy inside the blast radius (knocks peaks and ridge crests down).
    if (erode > 0) {
      const blur = new Float32Array(w * hgt);
      const R = Math.max(1, Math.round(radius / this.spacing / 2));
      for (let j = 0; j < hgt; j++) for (let i = 0; i < w; i++) {
        let s = 0, n = 0;
        for (let dj = -R; dj <= R; dj += R) for (let di = -R; di <= R; di += R) {
          const ii = Math.min(w - 1, Math.max(0, i + di)), jj = Math.min(hgt - 1, Math.max(0, j + dj));
          s += before[jj * w + ii]; n++;
        }
        blur[j * w + i] = s / n;
      }
      for (let j = j0; j <= j1; j++) for (let i = i0; i <= i1; i++) {
        const d = Math.hypot(this.wx(i) - x, this.wz(j) - z) / outer;
        if (d >= 1) continue;
        const k = (j - j0) * w + (i - i0);
        const t = erode * (1 - d * d);
        // Only lower: erosion never builds terrain up.
        const nb = before[k] + (blur[k] - before[k]) * t;
        if (nb < before[k]) this.h[this.index(i, j)] = nb;
      }
    }

    // 2. Bowl and rim.
    const rimH = depth * rim;
    for (let j = j0; j <= j1; j++) for (let i = i0; i <= i1; i++) {
      const d = Math.hypot(this.wx(i) - x, this.wz(j) - z);
      if (d >= outer) continue;
      let dh;
      if (d < radius) {
        const u = d / radius;
        dh = -depth * (1 - u * u) + rimH * u * u * u * u;     // smooth bowl rising into the rim
      } else {
        const u = (d - radius) / (outer - radius);            // 0 at bowl edge, 1 at outer edge
        dh = rimH * (1 - u) * (1 - u) * (1 + 2 * u);           // smoothstep fall-off
      }
      const k = this.index(i, j);
      this.h[k] = Math.max(this.bedrock, this.h[k] + dh);
    }

    // 3. Slope relaxation: material slides until no neighbour pair is steeper than maxSlope.
    //    Done over a slightly larger area, since sliding material can spill past the rim.
    const R = 6;
    const ri0 = Math.max(1, i0 - R), rj0 = Math.max(1, j0 - R), ri1 = Math.min(v - 1, i1 + R), rj1 = Math.min(v - 1, j1 + R);
    this.relax(ri0, rj0, ri1, rj1, 40);

    let removed = 0, minH = Infinity, maxDelta = 0;
    for (let j = j0; j <= j1; j++) for (let i = i0; i <= i1; i++) {
      const k = this.index(i, j);
      const dlt = this.h[k] - before[(j - j0) * w + (i - i0)];   // (relaxation spill outside is mass-neutral)
      removed -= dlt * this.spacing * this.spacing;
      if (this.h[k] < minH) minH = this.h[k];
      if (Math.abs(dlt) > maxDelta) maxDelta = Math.abs(dlt);
    }
    this.changed(ri0, rj0, ri1, rj1);
    return { removed, minH, maxDelta };
  }

  // Talus relaxation inside a rectangle: move material from the higher to the lower sample of any
  // neighbour pair steeper than maxSlope. Mass-conserving (apart from the bedrock clamp).
  relax(i0, j0, i1, j1, passes) {
    const limit = this.maxSlope * this.spacing;
    const V = this.verts, h = this.h;
    for (let p = 0; p < passes; p++) {
      let moved = false;
      for (let j = j0; j <= j1; j++) for (let i = i0; i <= i1; i++) {
        const k = j * V + i;
        if (i < i1) moved = this._pair(k, k + 1, limit) || moved;
        if (j < j1) moved = this._pair(k, k + V, limit) || moved;
      }
      if (!moved) break;
    }
    // Recheck the bedrock clamp.
    for (let j = j0; j <= j1; j++) for (let i = i0; i <= i1; i++) {
      const k = j * V + i;
      if (h[k] < this.bedrock) h[k] = this.bedrock;
    }
  }

  _pair(a, b, limit) {
    const h = this.h, d = h[a] - h[b];
    if (d > limit) { const m = (d - limit) * 0.5; h[a] -= m; h[b] += m; return true; }
    if (-d > limit) { const m = (-d - limit) * 0.5; h[b] -= m; h[a] += m; return true; }
    return false;
  }

  // Ray (origin o, direction d) against the terrain. Returns {x, y, z} or null.
  raycast(ox, oy, oz, dx, dy, dz, maxDist = 2000) {
    const step = this.spacing;
    let t = 0, prevT = 0, prevAbove = oy - this.heightAt(ox, oz);
    if (prevAbove < 0) return null;
    while (t < maxDist) {
      t += step;
      const x = ox + dx * t, y = oy + dy * t, z = oz + dz * t;
      const above = y - this.heightAt(x, z);
      if (above <= 0) {
        // Refine between prevT and t.
        let lo = prevT, hi = t;
        for (let n = 0; n < 20; n++) {
          const m = (lo + hi) / 2;
          const a = oy + dy * m - this.heightAt(ox + dx * m, oz + dz * m);
          if (a > 0) lo = m; else hi = m;
        }
        const m = (lo + hi) / 2;
        return { x: ox + dx * m, y: oy + dy * m, z: oz + dz * m, t: m };
      }
      // Below the lowest possible ground and still descending away: give up early.
      if (dy >= 0 && y > 1e4) return null;
      prevT = t; prevAbove = above;
    }
    return null;
  }
}
