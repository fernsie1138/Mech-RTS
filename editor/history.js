// Undo / redo for the editor.
// Entries:
//   { kind: 'heights', rect, before: Float32Array, after: Float32Array }   (a brush stroke: only the touched rectangle)
//   { kind: 'markers', before, after }                                    (marker placement)
//   { kind: 'map', before: snapshot, after: snapshot }                     (import / open / new: whole map)
export class History {
  constructor(limit = 60) {
    this.limit = limit;
    this.undoStack = [];
    this.redoStack = [];
    this.onChange = null;
  }
  push(entry) {
    this.undoStack.push(entry);
    if (this.undoStack.length > this.limit) this.undoStack.shift();
    // Keep at most 4 whole-map snapshots (they're ~1.5 MB each).
    let maps = 0;
    for (let i = this.undoStack.length - 1; i >= 0; i--) {
      if (this.undoStack[i].kind === 'map' && ++maps > 4) { this.undoStack.splice(0, i + 1); break; }
    }
    this.redoStack.length = 0;
    this.onChange?.();
  }
  canUndo() { return this.undoStack.length > 0; }
  canRedo() { return this.redoStack.length > 0; }
  undo(apply) {
    const e = this.undoStack.pop();
    if (!e) return false;
    apply(e, 'before');
    this.redoStack.push(e);
    this.onChange?.();
    return true;
  }
  redo(apply) {
    const e = this.redoStack.pop();
    if (!e) return false;
    apply(e, 'after');
    this.undoStack.push(e);
    this.onChange?.();
    return true;
  }
  clear() { this.undoStack.length = 0; this.redoStack.length = 0; this.onChange?.(); }
}

// Copy a rectangle of a heightfield's samples.
export function copyRect(h, V, r) {
  const w = r.i1 - r.i0 + 1, out = new Float32Array(w * (r.j1 - r.j0 + 1));
  for (let j = r.j0; j <= r.j1; j++) out.set(h.subarray(j * V + r.i0, j * V + r.i1 + 1), (j - r.j0) * w);
  return out;
}
export function pasteRect(h, V, r, data) {
  const w = r.i1 - r.i0 + 1;
  for (let j = r.j0; j <= r.j1; j++) h.set(data.subarray((j - r.j0) * w, (j - r.j0 + 1) * w), j * V + r.i0);
}
