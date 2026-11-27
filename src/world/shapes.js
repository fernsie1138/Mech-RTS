// Unit shapes for buildings and the HQ (sci-fi panels): each fits the unit cube (-0.5..0.5 on every axis) and is
// scaled per piece. Flat-shaded, non-indexed. Local -z is a piece's outside face (walls lean back from it).
import * as THREE from 'three';

// Triangles of a convex solid, wound to face away from its centre (so the outside is the front face).
function solid(tris, out) {
  const c = [0, 0, 0];
  let n = 0;
  for (const t of tris) for (const v of t) { c[0] += v[0]; c[1] += v[1]; c[2] += v[2]; n++; }
  c[0] /= n; c[1] /= n; c[2] /= n;
  for (const [a, b, d] of tris) {
    const u = [b[0] - a[0], b[1] - a[1], b[2] - a[2]], v = [d[0] - a[0], d[1] - a[1], d[2] - a[2]];
    const nx = u[1] * v[2] - u[2] * v[1], ny = u[2] * v[0] - u[0] * v[2], nz = u[0] * v[1] - u[1] * v[0];
    const m = [(a[0] + b[0] + d[0]) / 3 - c[0], (a[1] + b[1] + d[1]) / 3 - c[1], (a[2] + b[2] + d[2]) / 3 - c[2]];
    const flip = nx * m[0] + ny * m[1] + nz * m[2] < 0;
    out.push(...a, ...(flip ? d : b), ...(flip ? b : d));
  }
  return out;
}
const poly = (tris, ring) => { for (let k = 1; k < ring.length - 1; k++) tris.push([ring[0], ring[k], ring[k + 1]]); };

// Loft between a bottom ring (y = -0.5) and a top ring (y = +0.5) of [x, z] points with the same count.
function loft(bot, top, out = []) {
  const B = bot.map(([x, z]) => [x, -0.5, z]), T = top.map(([x, z]) => [x, 0.5, z]), tris = [];
  poly(tris, B); poly(tris, T);
  for (let k = 0; k < B.length; k++) { const k2 = (k + 1) % B.length; tris.push([B[k], B[k2], T[k2]], [B[k], T[k2], T[k]]); }
  return solid(tris, out);
}
// Extrude a [z, y] cross-section along x (-0.5..0.5).
function extrudeX(sec, out = []) {
  const L = sec.map(([z, y]) => [-0.5, y, z]), R = sec.map(([z, y]) => [0.5, y, z]), tris = [];
  poly(tris, L); poly(tris, R);
  for (let k = 0; k < L.length; k++) { const k2 = (k + 1) % L.length; tris.push([L[k], L[k2], R[k2]], [L[k], R[k2], R[k]]); }
  return solid(tris, out);
}
const square = a => [[-a, -a], [a, -a], [a, a], [-a, a]];
const octagon = (a, c) => [[-a + c, -a], [a - c, -a], [a, -a + c], [a, a - c], [a - c, a], [-a + c, a], [-a, a - c], [-a, -a + c]];
const circle = (r, n) => Array.from({ length: n }, (_, k) => [Math.cos((k + 0.5) / n * Math.PI * 2) * r, Math.sin((k + 0.5) / n * Math.PI * 2) * r]);

function geo(arr) {
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(arr, 3));
  g.computeVertexNormals();
  g.computeBoundingSphere();
  return g;
}

export const SHAPES = {
  box: () => geo(loft(square(0.5), square(0.5))),
  // Wall panel whose outside (-z) leans back: half as thick at the top as at the base.
  batter: () => geo(extrudeX([[-0.5, -0.5], [0, 0.5], [0.5, 0.5], [0.5, -0.5]])),
  // Free-standing barrier: leans in on both sides.
  taper: () => geo(extrudeX([[-0.5, -0.5], [-0.25, 0.5], [0.25, 0.5], [0.5, -0.5]])),
  // Roof slab: octagonal, edges sloping in to a smaller top.
  frustum: () => geo(loft(octagon(0.5, 0.17), octagon(0.4, 0.12))),
  // Buttress: vertical back (+z, against the wall), sloping front.
  wedge: () => geo(extrudeX([[-0.5, -0.5], [0.5, 0.5], [0.5, -0.5]])),
  cyl: () => geo(loft(circle(0.5, 8), circle(0.5, 8))),
};
export const SHAPE_KINDS = Object.keys(SHAPES);

// Exposed framework inside a broken panel: posts, rails and a diagonal brace (in the x-y plane, thin in z,
// set back toward the inside, +z). Lies inside every wall shape.
export function frameGeometry() {
  const out = [], z0 = 0.2, dz = 0.1;
  const bar = (x0, y0, x1, y1, w) => {
    // A thin box from (x0, y0) to (x1, y1) in the x-y plane.
    const dx = x1 - x0, dy = y1 - y0, l = Math.hypot(dx, dy), nx = -dy / l * w / 2, ny = dx / l * w / 2;
    const ring = [[x0 + nx, y0 + ny], [x1 + nx, y1 + ny], [x1 - nx, y1 - ny], [x0 - nx, y0 - ny]];
    const F = ring.map(([x, y]) => [x, y, z0 - dz]), K = ring.map(([x, y]) => [x, y, z0 + dz]), tris = [];
    poly(tris, F); poly(tris, K);
    for (let k = 0; k < 4; k++) { const k2 = (k + 1) % 4; tris.push([F[k], F[k2], K[k2]], [F[k], K[k2], K[k]]); }
    solid(tris, out);
  };
  for (const x of [-0.4, 0, 0.4]) bar(x, -0.45, x, 0.45, 0.07);
  for (const y of [-0.15, 0.25]) bar(-0.42, y, 0.42, y, 0.06);
  bar(-0.4, -0.4, 0.4, 0.4, 0.05);
  return geo(out);
}
