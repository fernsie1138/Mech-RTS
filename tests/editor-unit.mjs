// Tests for editor brushes, undo storage and marker placement (pure modules, run in Node).
// Run: node tests/editor-unit.mjs
import { applyBrush, BRUSH_LIMITS } from '../editor/tools/terrain.js';
import { placeMarker } from '../editor/tools/markers.js';
import { History, copyRect, pasteRect } from '../editor/history.js';
import { Heightfield } from '../src/terrain/heightfield.js';
import { TERRAIN, MAP_SIZE } from '../src/config.js';
import { checker } from './harness.mjs';

const { check, done } = checker();
const make = (fn = () => 0) => { const hf = new Heightfield({ size: MAP_SIZE, cells: TERRAIN.cells, bedrock: TERRAIN.bedrock, maxSlope: TERRAIN.maxSlope }); hf.generate(fn); return hf; };
const opts = { radius: 10, strength: 1, dt: 0.1 };

{
  const hf = make();
  const r = applyBrush(hf, 'raise', 5, 5, opts);
  check(Math.abs(hf.heightAt(5, 5) - 1) < 0.02, `raise: centre goes up by rate x strength x dt = 1 (got ${hf.heightAt(5, 5).toFixed(3)})`);
  check(hf.heightAt(5 + 10.6, 5) === 0, 'raise: nothing changes beyond the brush radius');
  check(hf.heightAt(5 + 5, 5) > 0.3 && hf.heightAt(5 + 5, 5) < 0.7, `raise: soft fall-off (half radius ${hf.heightAt(10, 5).toFixed(3)})`);
  check(r && r.i0 <= hf.gx(-5) && r.i1 >= hf.gx(15), 'raise: returns the changed rectangle');
  for (let n = 0; n < 200; n++) applyBrush(hf, 'raise', 5, 5, { ...opts, dt: 1 });
  check(Math.abs(hf.heightAt(5, 5) - BRUSH_LIMITS.maxHeight) < 1e-4, `raise is capped at maxHeight ${BRUSH_LIMITS.maxHeight}`);
  for (let n = 0; n < 200; n++) applyBrush(hf, 'lower', 5, 5, { ...opts, dt: 1 });
  check(Math.abs(hf.heightAt(5, 5) - TERRAIN.bedrock) < 1e-4, `lower is capped at bedrock ${TERRAIN.bedrock}`);
}
{
  const hf = make((x, z) => Math.sin(x / 3) * 4 + z * 0.1);
  for (let n = 0; n < 60; n++) applyBrush(hf, 'flatten', 0, 0, { ...opts, radius: 12, target: 2 });
  let worst = 0; for (let a = 0; a < 30; a++) worst = Math.max(worst, Math.abs(hf.heightAt(Math.cos(a) * 5, Math.sin(a) * 5) - 2));
  check(worst < 0.05, `flatten pulls the brush area to the target height (max error within half radius ${worst.toFixed(3)})`);
}
{
  const hf = make((x, z) => ((Math.floor(x * 2) + Math.floor(z * 2)) & 1) * 2);   // 0.5-unit checkerboard
  const spread = () => { let lo = Infinity, hi = -Infinity; for (let a = 0; a < 50; a++) { const v = hf.heightAt(Math.cos(a) * 3 + .1, Math.sin(a) * 3 + .1); lo = Math.min(lo, v); hi = Math.max(hi, v); } return hi - lo; };
  const s0 = spread();
  for (let n = 0; n < 20; n++) applyBrush(hf, 'smooth', 0, 0, opts);
  const s1 = spread();
  check(s1 < s0 * 0.2, `smooth flattens bumps (spread ${s0.toFixed(2)} -> ${s1.toFixed(2)})`);
}
{
  const hf = make((x, z) => x + z);
  const r = { i0: 10, j0: 20, i1: 40, j1: 33 };
  const before = copyRect(hf.h, hf.verts, r);
  const orig = Float32Array.from(hf.h);
  applyBrush(hf, 'raise', hf.wx(25), hf.wz(26), opts);
  pasteRect(hf.h, hf.verts, { i0: 0, j0: 0, i1: hf.verts - 1, j1: hf.verts - 1 }, orig);
  const again = copyRect(hf.h, hf.verts, r);
  check(again.every((v, k) => v === before[k]), 'copyRect / pasteRect round trip is exact');
  const h = new History(5); let applied = [];
  for (let n = 0; n < 8; n++) h.push({ kind: 'markers', before: n, after: n + 1 });
  check(h.undoStack.length === 5, 'history keeps at most its limit');
  h.undo((e, w) => applied.push(e[w])); h.redo((e, w) => applied.push(e[w]));
  check(applied.join() === '7,8', `undo applies "before", redo applies "after" (${applied})`);
  h.undo(() => {}); h.push({ kind: 'markers', before: 0, after: 0 });
  check(!h.canRedo(), 'a new action clears redo');
}
{
  let m = { playerHQ: null, enemyHQ: null, capturePoints: [] };
  m = placeMarker(m, 'playerHQ', 1, 2); m = placeMarker(m, 'enemyHQ', 3, 4);
  m = placeMarker(m, 'capture', 10, 10); m = placeMarker(m, 'capture', 40, 10);
  check(m.playerHQ.x === 1 && m.enemyHQ.z === 4 && m.capturePoints.length === 2, 'HQs placed, two capture points added');
  const m2 = placeMarker(m, 'capture', 12, 11);
  check(m2.capturePoints.length === 1 && m.capturePoints.length === 2, 'tapping near a capture point removes it (without mutating the old markers)');
}
done();
