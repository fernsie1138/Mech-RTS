// Map editor (CLAUDE.md §7.2), part 1: image import, terrain brushes, gameplay markers, undo/redo,
// save/load and a Test button that opens the current map in the game.
//
// Touch: one finger paints with the current tool, two fingers pan / pinch-zoom / twist-rotate.
// Mouse: left button paints, right or middle drag pans, wheel zooms.
import * as THREE from 'three';
import { VERSION } from '../src/version.js';
import * as config from '../src/config.js';
import { createView } from '../src/view.js';
import { serializeMap } from '../src/maps/format.js';
import { importImages, FEATURE_KEYS } from '../src/maps/imageimport.js';
import {
  listMaps, loadMapUrl, loadMapFile, loadMapStorage, saveMapStorage, blankMap, decodeImage, downloadJSON,
  snapshot, restore, reloadFresh, clearFreshReload, TEST_KEY, AUTOSAVE_KEY,
} from '../src/maps/loader.js';
import { DebugOverlay } from '../src/ui/debug.js';
import { initMobileMode } from '../src/ui/mobile.js';
import { applyBrush } from './tools/terrain.js';
import { placeMarker } from './tools/markers.js';
import { riverStamp, roadStamp, forestStamp, treeStamp, eraseStamp } from './tools/features.js';
import { blueprint, flattenFootprint, fitBridge, fillLots } from '../src/world/buildings.js';
import { History, copyRect, pasteRect } from './history.js';

const $ = id => document.getElementById(id);
const verEl = $('ver');
verEl.textContent = VERSION;
const htmlBuild = document.querySelector('meta[name="build"]')?.content;
if (htmlBuild && htmlBuild !== VERSION) { verEl.textContent = `${VERSION} (page ${htmlBuild}: stale cache, reload)`; verEl.classList.add('stale'); }

// ---------- initial map: ?map=<id>, else the autosave, else the sample ----------
const params = new URLSearchParams(location.search);
let map;
try {
  if (params.get('map') && /^[\w-]+$/.test(params.get('map'))) map = await loadMapUrl(`maps/${params.get('map')}.json`);
  else map = (await loadMapStorage(AUTOSAVE_KEY)) || await loadMapUrl('maps/sample.json');
} catch (e) {
  if (reloadFresh(e)) { $('loading').textContent = 'Updating to the latest version…'; await new Promise(() => {}); }
  console.warn('initial map failed, starting blank:', e);
  map = blankMap();
}
clearFreshReload();
$('loading').style.display = 'none';

// ---------- view ----------
const view = createView($('view'), map, { maxRebuildsPerFrame: 16 });
const { rts, renderer } = view;
rts.oneFingerPan = false;
const debug = new DebugOverlay($('debug'), $('btnDebug'), renderer);
const mobile = initMobileMode($('btnMobile'));          // compact layout for phones (shared setting with the game)

// Brush cursor: a ring that follows the ground.
const CURSOR_PTS = 64;
const cursor = new THREE.LineLoop(new THREE.BufferGeometry(), new THREE.LineBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.85, depthTest: false }));
cursor.geometry.setAttribute('position', new THREE.BufferAttribute(new Float32Array(CURSOR_PTS * 3), 3));
cursor.renderOrder = 20;
cursor.frustumCulled = false;
cursor.visible = false;
view.scene.add(cursor);
function placeCursor(x, z, r) {
  const pos = cursor.geometry.attributes.position.array;
  for (let n = 0; n < CURSOR_PTS; n++) {
    const a = (n / CURSOR_PTS) * Math.PI * 2, px = x + Math.cos(a) * r, pz = z + Math.sin(a) * r;
    pos[n * 3] = px; pos[n * 3 + 1] = map.hf.heightAt(px, pz) + 0.3; pos[n * 3 + 2] = pz;
  }
  cursor.geometry.attributes.position.needsUpdate = true;
  cursor.visible = true;
}

// ---------- state ----------
const state = { tool: 'raise', size: 10, strength: 0.5, stroke: null, dirty: false };
const history = new History();
const HEIGHT_TOOLS = new Set(['raise', 'lower', 'flatten', 'smooth']);
const FEATURE_TOOLS = new Set(['river', 'road', 'forest', 'tree', 'erase']);
const BRUSH_TOOLS = new Set([...HEIGHT_TOOLS, ...FEATURE_TOOLS]);
const BUILD_TOOLS = new Set(['house', 'factory', 'bunker', 'wall', 'bridge']);
const NO_SIZE = new Set(['tree', ...BUILD_TOOLS]);
const HINTS = {
  raise: 'Drag one finger to raise ground · two fingers to move the view',
  lower: 'Drag one finger to lower ground · two fingers to move the view',
  flatten: 'Drag from the height you want to keep · two fingers to move the view',
  smooth: 'Drag one finger to smooth bumps · two fingers to move the view',
  playerHQ: 'Tap to place the player HQ (blue)',
  enemyHQ: 'Tap to place the enemy HQ (red)',
  capture: 'Tap to add a capture point · tap an existing one to remove it',
  river: 'Draw a river with one finger (Size = width) · two fingers to move the view',
  road: 'Draw a road with one finger (Size = width) · two fingers to move the view',
  forest: 'Spray trees with one finger (Strength = density) · two fingers to move the view',
  tree: 'Tap to place a tree, or drag to plant a row',
  erase: 'Rub out trees, water and roads (the ground shape stays)',
  house: 'Tap to place a house (the ground is levelled) · tap a building to select it',
  factory: 'Tap to place a factory · tap a building to select it',
  bunker: 'Tap to place a bunker · tap a building to select it',
  wall: 'Tap to place a wall section · tap a building to select it',
  bridge: 'Tap on a river to bridge it (fits itself) · tap a building to select it',
  select: 'Selected: drag it to move · Angle slider or ⟲ ⟳ to turn · Delete',
};

function selectTool(t) {
  state.tool = t;
  document.querySelectorAll('[data-tool]').forEach(b => b.classList.toggle('on', b.dataset.tool === t));
  $('hint').textContent = HINTS[t];
  document.getElementById('brush').style.visibility = BRUSH_TOOLS.has(t) && !NO_SIZE.has(t) ? 'visible' : 'hidden';
  document.getElementById('bpanel').style.display = BUILD_TOOLS.has(t) ? 'flex' : 'none';
  document.body.classList.toggle('bpanel-on', BUILD_TOOLS.has(t));
  if (!BUILD_TOOLS.has(t)) select(-1);
  if (!BRUSH_TOOLS.has(t)) cursor.visible = false;
}
document.querySelectorAll('[data-tool]').forEach(b => b.addEventListener('pointerup', () => selectTool(b.dataset.tool)));

for (const [id, key, fmt] of [['size', 'size', v => v], ['strength', 'strength', v => Math.round(v * 100) + '%']]) {
  const input = $(id), out = $(id + 'Val');
  input.value = state[key];
  const sync = () => { state[key] = +input.value; out.textContent = fmt(state[key]); };
  input.addEventListener('input', sync);
  sync();
}

function setName(n) { map.name = n || 'Untitled'; $('mapname').textContent = map.name; }
$('mapname').addEventListener('pointerup', () => {
  const n = prompt('Map name', map.name);
  if (n !== null && n.trim()) { setName(n.trim()); markDirty(); }
});
setName(map.name);

function status(msg) { $('status').textContent = msg; }

// ---------- undo / redo ----------
function applyEntry(e, which) {
  if (e.kind === 'heights') {
    pasteRect(map.hf.h, map.hf.verts, e.rect, e[which]);
    map.hf.changed(e.rect.i0, e.rect.j0, e.rect.i1, e.rect.j1);
  } else if (e.kind === 'region') {
    const V = map.hf.verts, r = e.rect;
    pasteRect(map.hf.h, V, r, e[which].h);
    pasteRect(map.surface.base, V, r, e[which].base);
    pasteRect(map.surface.features, V, r, e[which].features);
    map.trees = e[which].trees;
    view.reloadTrees();
    if (e[which].buildings) { map.buildings = e[which].buildings.map(b => ({ ...b })); select(-1); }
    view.reloadBuildings();
    map.hf.changed(r.i0, r.j0, r.i1, r.j1);
    map.surface.changed(r.i0, r.j0, r.i1, r.j1);
    view.rebuildWater();
  } else if (e.kind === 'markers') {
    map.markers = e[which];
    view.markers.set(map.markers);
  } else if (e.kind === 'map') {
    restore(map, e[which].snap);
    map.markers = e[which].markers;
    setName(e[which].name);
    view.markers.set(map.markers);
    view.terrain.rebuildAll();
    view.reloadTrees();
    view.rebuildWater();
    view.reloadBuildings();
    select(-1);
  }
  if (e.kind === 'heights') { view.rebuildWater(); view.reloadBuildings(); }
  markDirty();
}
const undo = () => history.undo(applyEntry);
const redo = () => history.redo(applyEntry);
history.onChange = () => {
  $('btnUndo').classList.toggle('dis', !history.canUndo());
  $('btnRedo').classList.toggle('dis', !history.canRedo());
};
$('btnUndo').addEventListener('pointerup', undo);
$('btnRedo').addEventListener('pointerup', redo);
window.addEventListener('keydown', e => {
  if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'z') { e.preventDefault(); e.shiftKey ? redo() : undo(); }
  if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'y') { e.preventDefault(); redo(); }
});

// Whole-map changes (import / open / new) are undoable too.
function replaceMap(next, label) {
  const before = { snap: snapshot(map), markers: map.markers, name: map.name };
  if (next.hf.verts !== map.hf.verts || next.hf.size !== map.hf.size) {
    // Different size: switch maps outright (can't be undone).
    map = next;
    view.setMap(map);
    history.clear();
  } else {
    restore(map, snapshot(next));
    map.markers = next.markers;
    map.meta = next.meta || {};
    view.markers.set(map.markers);
    view.terrain.rebuildAll();
    view.reloadTrees();
    view.rebuildWater();
    view.reloadBuildings();
    select(-1);
    history.push({ kind: 'map', before, after: { snap: snapshot(map), markers: map.markers, name: next.name } });
  }
  setName(next.name);
  markDirty();
  status(label);
}

// ---------- painting ----------
function groundAt(cx, cy) { return view.pickGround(cx, cy); }

rts.onStrokeStart = (cx, cy) => {
  const p = groundAt(cx, cy);
  if (!p) return;
  if (BUILD_TOOLS.has(state.tool)) {
    // A one-finger drag that starts on the selected building moves it.
    if (selected >= 0 && view.buildings.at(p.x, p.z) === selected) {
      const d = map.buildings[selected];
      state.drag = { i: selected, dx: d.x - p.x, dz: d.z - p.z, before: buildingSnapshot(), cx, cy };
    }
    return;
  }
  if (!BRUSH_TOOLS.has(state.tool)) return;
  state.stroke = beginStroke(state.tool, p.x, p.z, cx, cy);
};

function beginStroke(tool, x, z, cx = -1, cy = -1) {
  const s = { tool, x, z, lastX: x, lastZ: z, cx, cy, target: map.hf.heightAt(x, z), before: Float32Array.from(map.hf.h), rect: null };
  if (FEATURE_TOOLS.has(tool)) {
    s.baseBefore = Uint8Array.from(map.surface.base);
    s.featBefore = Uint8Array.from(map.surface.features);
    s.treesBefore = view.forest.snapshot();
  }
  return s;
}

// One stamp of the current tool at (x, z); `dt` is the share of brush time for this stamp.
function stamp(s, x, z, dt) {
  const hf = map.hf, sf = map.surface, f = view.forest, r = state.size;
  switch (s.tool) {
    case 'river': return riverStamp(hf, sf, x, z, r * 0.5, s.before);
    case 'road': return roadStamp(hf, sf, x, z, r * 0.3, s.before, f);
    case 'forest': return forestStamp(hf, sf, x, z, r, f, Math.max(1, Math.round(Math.PI * r * r / 7 * state.strength * dt * 4)));
    case 'tree': return treeStamp(hf, sf, x, z, f);
    case 'erase': return eraseStamp(hf, sf, x, z, r, f);
    default: return applyBrush(hf, s.tool, x, z, { radius: r, strength: state.strength, dt, target: s.target });
  }
}
rts.onStrokeMove = (cx, cy) => {
  if (state.drag) { dragBuilding(cx, cy); return; }
  if (!state.stroke) return;
  state.stroke.cx = cx; state.stroke.cy = cy;
};
rts.onStrokeEnd = () => { if (state.drag) endDrag(); else endStroke(); };

function unionRect(a, b) {
  if (!b) return a;
  if (!a) return { ...b };
  return { i0: Math.min(a.i0, b.i0), j0: Math.min(a.j0, b.j0), i1: Math.max(a.i1, b.i1), j1: Math.max(a.j1, b.j1) };
}

// Apply the brush along the path since the last frame, so fast swipes leave no gaps.
function paintStep(dt) {
  const s = state.stroke;
  if (!s) return;
  const p = groundAt(s.cx, s.cy);
  if (p) { s.x = p.x; s.z = p.z; }
  const dist = Math.hypot(s.x - s.lastX, s.z - s.lastZ);
  // Path tools stamp along the path only (not while the finger rests); brushes keep working while held.
  const pathTool = s.tool === 'river' || s.tool === 'road' || s.tool === 'tree';
  const spacing = s.tool === 'tree' ? 3 : Math.max(0.5, state.size * (pathTool ? 0.15 : 0.3));
  if (pathTool && dist < spacing && s.rect) return;
  const n = Math.max(1, Math.ceil(dist / spacing));
  for (let k = 1; k <= n; k++) {
    const x = s.lastX + (s.x - s.lastX) * (k / n), z = s.lastZ + (s.z - s.lastZ) * (k / n);
    s.rect = unionRect(s.rect, stamp(s, x, z, dt / n));
  }
  s.lastX = s.x; s.lastZ = s.z;
}

function endStroke() {
  const s = state.stroke;
  state.stroke = null;
  if (!s || !s.rect) return;
  commitStroke(s);
}

function commitStroke(s) {
  const V = map.hf.verts, r = s.rect;
  if (FEATURE_TOOLS.has(s.tool)) {
    map.trees = view.forest.snapshot();
    history.push({
      kind: 'region', rect: r,
      before: { h: copyRect(s.before, V, r), base: copyRect(s.baseBefore, V, r), features: copyRect(s.featBefore, V, r), trees: s.treesBefore },
      after: { h: copyRect(map.hf.h, V, r), base: copyRect(map.surface.base, V, r), features: copyRect(map.surface.features, V, r), trees: map.trees },
    });
  } else {
    history.push({ kind: 'heights', rect: r, before: copyRect(s.before, V, r), after: copyRect(map.hf.h, V, r) });
  }
  view.rebuildWater();
  view.reloadBuildings();          // buildings sit on the (edited) ground
  markDirty();
}

// A tap: one dab of brush, or place a marker.
rts.onTap = (cx, cy) => {
  const p = groundAt(cx, cy);
  if (!p) return;
  if (BUILD_TOOLS.has(state.tool)) { buildingTap(p.x, p.z); return; }
  if (BRUSH_TOOLS.has(state.tool)) {
    const s = beginStroke(state.tool, p.x, p.z);
    s.rect = stamp(s, p.x, p.z, 0.15);
    if (s.rect) commitStroke(s);
    return;
  } else {
    const before = map.markers;
    map.markers = placeMarker(map.markers, state.tool, p.x, p.z);
    view.markers.set(map.markers);
    history.push({ kind: 'markers', before, after: map.markers });
  }
  markDirty();
};

// ---------- buildings ----------
let selected = -1;
const outline = new THREE.LineLoop(new THREE.BufferGeometry(), new THREE.LineBasicMaterial({ color: 0xffd23a, depthTest: false }));
outline.geometry.setAttribute('position', new THREE.BufferAttribute(new Float32Array(15), 3));
outline.renderOrder = 21; outline.frustumCulled = false; outline.visible = false;
view.scene.add(outline);

const deg = r => ((Math.round(r * 180 / Math.PI) % 360) + 360) % 360;
const NAMES = { house: 'House', factory: 'Factory', bunker: 'Bunker', wall: 'Wall', bridge: 'Bridge' };
function select(i) {
  selected = i;
  const d = map.buildings?.[i];
  outline.visible = !!d;
  $('bdel').classList.toggle('dis', !d);
  $('bname').textContent = d ? `${NAMES[d.type]}: ${deg(d.rot || 0)}°` : `New: ${deg(state.rot || 0)}°`;
  $('bangle').value = deg(d ? d.rot || 0 : state.rot || 0);
  if (d) $('hint').textContent = HINTS.select;
  else if (BUILD_TOOLS.has(state.tool)) $('hint').textContent = HINTS[state.tool];
  if (!d) return;
  const fp = blueprint(d).footprint, c = Math.cos(d.rot || 0), s = Math.sin(d.rot || 0), pos = outline.geometry.attributes.position.array;
  const y = view.buildings.list[i]?.y ?? map.hf.heightAt(d.x, d.z);
  [[-1, -1], [1, -1], [1, 1], [-1, 1], [-1, -1]].forEach(([u, v], n) => {
    const lx = u * (fp.hw + 0.5), lz = v * (fp.hd + 0.5);
    pos[n * 3] = d.x + lx * c + lz * s; pos[n * 3 + 1] = y + 0.4; pos[n * 3 + 2] = d.z - lx * s + lz * c;
  });
  outline.geometry.attributes.position.needsUpdate = true;
}

function buildingSnapshot() {
  return { h: Float32Array.from(map.hf.h), base: Uint8Array.from(map.surface.base), features: Uint8Array.from(map.surface.features),
           trees: map.trees, buildings: map.buildings.map(b => ({ ...b })) };
}

// An undoable change to the building list (and the ground it levels). fn() returns the changed sample rect or null.
// `before`: a snapshot taken before live edits (dragging, the angle slider); default: now.
function editBuildings(fn, before = buildingSnapshot()) {
  const rect0 = fn() || { i0: 0, j0: 0, i1: 1, j1: 1 };
  // A live edit may have moved the building: cover where it started as well.
  const startRect = before.rect;
  const rect = startRect ? union(rect0, startRect) : rect0;
  view.reloadBuildings();
  const V = map.hf.verts;
  history.push({
    kind: 'region', rect,
    before: { h: copyRect(before.h, V, rect), base: copyRect(before.base, V, rect), features: copyRect(before.features, V, rect), trees: before.trees, buildings: before.buildings },
    after: { h: copyRect(map.hf.h, V, rect), base: copyRect(map.surface.base, V, rect), features: copyRect(map.surface.features, V, rect), trees: map.trees, buildings: map.buildings.map(b => ({ ...b })) },
  });
  view.rebuildWater();
  markDirty();
}

// Level the ground for a building and clear trees under it. Returns the changed rect.
function settle(def) {
  if (def.type !== 'bridge') flattenFootprint(map.hf, def);
  const fp = blueprint(def).footprint, R = Math.hypot(fp.hw, fp.hd) + 3;
  view.forest.removeNear(def.x, def.z, def.type === 'bridge' ? 0 : Math.hypot(fp.hw, fp.hd) + 1.8);   // + canopy
  map.trees = view.forest.snapshot();
  return map.hf.rect(def.x, def.z, R);
}
const union = (a, b) => !a ? b : { i0: Math.min(a.i0, b.i0), j0: Math.min(a.j0, b.j0), i1: Math.max(a.i1, b.i1), j1: Math.max(a.j1, b.j1) };

function buildingTap(x, z) {
  const hit = view.buildings.at(x, z);
  if (hit >= 0) { select(hit); return; }
  let def = { type: state.tool, x, z, rot: state.rot || 0 };
  if (state.tool === 'bridge') {
    def = fitBridge(map.hf, view.water, x, z);
    if (!def) { status('Tap on a river to place a bridge'); return; }
  }
  editBuildings(() => { const r = settle(def); map.buildings.push(def); return r; });
  select(map.buildings.length - 1);
}

function rotateSelected(dir) {
  state.rot = ((state.rot || 0) + dir * Math.PI / 12);
  if (selected < 0) { select(-1); return; }
  const old = map.buildings[selected];
  let def = { ...old, rot: (old.rot || 0) + dir * Math.PI / 12 };
  if (def.type === 'bridge') def = fitBridge(map.hf, view.water, old.x, old.z, def.rot) || old;
  const i = selected;
  editBuildings(() => { map.buildings[i] = def; return settle(def); });
  select(i);
}
// Live preview while dragging / turning (no levelling until the edit is committed).
function preview(i, def) {
  map.buildings[i] = def;
  view.reloadBuildings();
  select(i);
}
function dragBuilding(cx, cy) {
  const g = state.drag, p = groundAt(cx, cy);
  if (!p) return;
  const old = map.buildings[g.i];
  let def = { ...old, x: p.x + g.dx, z: p.z + g.dz };
  if (def.type === 'bridge') def = fitBridge(map.hf, view.water, def.x, def.z, old.rot) || old;
  preview(g.i, def);
}
function endDrag() {
  const g = state.drag;
  state.drag = null;
  const d0 = g.before.buildings[g.i], d = map.buildings[g.i];
  if (Math.hypot(d.x - d0.x, d.z - d0.z) < 0.01) return;
  g.before.rect = map.hf.rect(d0.x, d0.z, 14);
  editBuildings(() => settle(d), g.before);
  select(g.i);
}

// Angle slider: turns the selected building live (or sets the angle for new buildings); one undo step on release.
let angleBefore = null;
$('bangle').addEventListener('input', () => {
  const r = +$('bangle').value * Math.PI / 180;
  state.rot = r;
  if (selected < 0) { $('bname').textContent = `New: ${deg(r)}°`; return; }
  angleBefore ||= buildingSnapshot();
  const old = map.buildings[selected];
  let def = { ...old, rot: r };
  if (def.type === 'bridge') def = fitBridge(map.hf, view.water, old.x, old.z, r) || old;
  preview(selected, def);
});
$('bangle').addEventListener('change', () => {
  if (selected < 0 || !angleBefore) { angleBefore = null; return; }
  const i = selected, before = angleBefore;
  angleBefore = null;
  editBuildings(() => settle(map.buildings[i]), before);
  select(i);
});

$('brotL').addEventListener('pointerup', () => rotateSelected(1));
$('brotR').addEventListener('pointerup', () => rotateSelected(-1));
$('bdel').addEventListener('pointerup', () => {
  if (selected < 0) return;
  const i = selected;
  editBuildings(() => { map.buildings.splice(i, 1); return null; });
  select(-1);
});
$('bfill').addEventListener('pointerup', () => {
  const add = fillLots(map.hf, map.surface, map.buildings);
  if (!add.length) { status('No empty building areas (red on the feature map) to fill'); return; }
  editBuildings(() => { let r = null; for (const d of add) { r = union(r, settle(d)); map.buildings.push(d); } return r; });
  status(`Placed ${add.length} buildings`);
});

// Mouse hover shows the brush cursor.
$('view').addEventListener('pointermove', e => {
  if (e.pointerType !== 'mouse' || !BRUSH_TOOLS.has(state.tool)) return;
  const p = groundAt(e.clientX, e.clientY);
  if (p) placeCursor(p.x, p.z, state.size); else cursor.visible = false;
});

// ---------- autosave (survives Safari reloading the tab) ----------
let saveTimer = null;
function markDirty() {
  state.dirty = true;
  clearTimeout(saveTimer);
  saveTimer = setTimeout(autosave, 1200);
}
async function autosave() {
  const ok = await saveMapStorage(AUTOSAVE_KEY, map);
  status(ok ? 'Autosaved' : 'Autosave failed (storage full?)');
}

// ---------- dialogs ----------
function openDialog(id) { $(id).classList.add('open'); }
function closeDialogs() { document.querySelectorAll('.dialog').forEach(d => d.classList.remove('open')); }
document.querySelectorAll('[data-close]').forEach(b => b.addEventListener('pointerup', closeDialogs));

// New
$('btnNew').addEventListener('pointerup', () => {
  if (!confirm('Start a new flat map? (You can undo this.)')) return;
  replaceMap(blankMap(), 'New map');
});

// Open
$('btnOpen').addEventListener('pointerup', async () => {
  const list = $('mapList');
  list.textContent = 'Loading list…';
  openDialog('dlgOpen');
  try {
    const maps = await listMaps();
    list.textContent = '';
    for (const m of maps) {
      const b = document.createElement('div');
      b.className = 'btn';
      b.textContent = m.name;
      b.addEventListener('pointerup', async () => {
        closeDialogs();
        try { replaceMap(await loadMapUrl(`maps/${m.id}.json`), `Opened ${m.name}`); } catch (e) { alert(e.message); }
      });
      list.appendChild(b);
    }
  } catch (e) { list.textContent = `Could not list maps: ${e.message}`; }
});
$('fileMap').addEventListener('change', async e => {
  const f = e.target.files[0];
  e.target.value = '';
  if (!f) return;
  closeDialogs();
  try { replaceMap(await loadMapFile(f), `Opened ${f.name}`); } catch (err) { alert(err.message); }
});

// Save: download the map file.
$('btnSave').addEventListener('pointerup', async () => {
  const json = await serializeMap(map);
  const slug = (map.name || 'map').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'map';
  downloadJSON(json, `${slug}.json`);
  status(`Saved ${slug}.json`);
});

// Import images
const imp = { height: null, features: null };
$('keyList').innerHTML = FEATURE_KEYS.map(k => {
  const c = k.colors[0];
  const hex = '#' + c.map(v => v.toString(16).padStart(2, '0')).join('').toUpperCase();
  return `<span><span class="sw" style="background:${hex}"></span>${hex}</span><span>${k.label}</span>`;
}).join('') + '<span>other</span><span>Open ground</span>';
$('btnImport').addEventListener('pointerup', () => { $('impReport').textContent = ''; openDialog('dlgImport'); });
for (const [id, key, label] of [['fileHeight', 'height', 'nameHeight'], ['fileFeatures', 'features', 'nameFeatures']]) {
  $(id).addEventListener('change', async e => {
    const f = e.target.files[0];
    if (!f) return;
    try {
      imp[key] = await decodeImage(f);
      $(label).textContent = `${f.name} (${imp[key].width} × ${imp[key].height})`;
    } catch (err) { imp[key] = null; $(label).textContent = err.message; }
  });
}
$('btnDoImport').addEventListener('pointerup', () => {
  if (!imp.height && !imp.features) { $('impReport').textContent = 'Choose at least one image.'; return; }
  const r = importImages({
    heightImg: imp.height, featureImg: imp.features,
    maxHeight: +$('impMaxHeight').value || 30, maxDepth: +$('impMaxDepth').value || 0,
  });
  replaceMap({ ...r, name: map.name === 'Untitled' ? 'Imported map' : map.name }, 'Imported images');
  const rep = r.report;
  $('impReport').innerHTML = `Imported: ${rep.markers.capturePoints} capture points, player HQ ${rep.markers.playerHQ ? 'found' : 'missing'}, ` +
    `enemy HQ ${rep.markers.enemyHQ ? 'found' : 'missing'}.` + rep.warnings.map(w => `<br><span class="warn">⚠ ${w}</span>`).join('');
  state.lastImportReport = rep;
  if (!rep.warnings.length) closeDialogs();
});

// Test: hand the map to the game through localStorage and open it.
$('btnTest').addEventListener('pointerup', async () => {
  status('Starting test…');
  clearTimeout(saveTimer);
  const ok = await saveMapStorage([TEST_KEY, AUTOSAVE_KEY], map);
  if (!ok) { alert('Could not hand the map to the game (browser storage full or blocked).'); return; }
  location.href = 'index.html?map=@test';
});

// ---------- loop ----------
let lastT = performance.now();
function frame(now) {
  const dt = Math.min((now - lastT) / 1000, 0.1);
  lastT = now;
  paintStep(dt);
  if (state.stroke) placeCursor(state.stroke.x, state.stroke.z, state.size);
  else if (BRUSH_TOOLS.has(state.tool) && cursor.visible && !matchMedia('(hover: hover)').matches) cursor.visible = false;
  view.update(dt);
  view.render();
  debug.frame(dt);
  requestAnimationFrame(frame);
}
requestAnimationFrame(frame);
selectTool('raise');
history.onChange();

// ---------- test hook ----------
window.__editor = {
  mobile,
  version: VERSION, config, THREE, view, history, state,
  get map() { return map; },
  selectTool, undo, redo, replaceMap, autosave, buildingTap, rotateSelected, get selected() { return selected; }, select,
  paintStep, endStroke,
  ready: true,
};
