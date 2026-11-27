// Saved games: the whole state of a match (or the sandbox) in one JSON file, and loading it back.
//
// A save holds the map as it was at the start (so Reset and the crater depth limit still work), the ground as it
// is now (heights, ground types, wear and scorch, features such as flooded craters and trenches), the trees, the
// buildings piece by piece (strength, blast marks, holes) and the rubble round them, every crater and rubble
// picture on the ground (replayed in order), the mechs, turrets, HQs and wrecks, Builders' unfinished jobs, the
// economy, capture points and the enemy AI, what each side has explored, and the camera.
// Not saved: smoke and fires burning at the time, shells in flight, and each mech's exact path (mechs that were
// moving or attacking are given the same order again).
//
// Loading: the file is stashed in IndexedDB and the page reloads with ?resume, so the game starts up normally on
// the saved map and then applies the rest (applySave).
import { serializeMap, deserializeMap, encodeHeights, decodeHeights, encodeBytes, decodeBytes, encodeF32, decodeF32 } from '../maps/format.js';
import { Buildings } from '../world/buildings.js';
import { newJobId } from '../world/construction.js';

export const SAVE_KIND = 'mech-rts-save';
export const SAVE_VERSION = 1;

const r2 = v => Math.round(v * 100) / 100;
const r3 = v => Math.round(v * 1000) / 1000;

// ---------- capture ----------
// G: the game's parts (see main.js).
export async function captureSave(G) {
  const { map, pristine, view, units, construction, decals, vision, rts, state } = G;
  const match = G.match, ai = G.ai, hf = map.hf, surface = map.surface, V = hf.verts;
  const pristineMap = await serializeMap({
    name: map.name, markers: map.markers, meta: map.meta, trees: pristine.trees, buildings: pristine.buildings,
    hf: { h: pristine.h, verts: V, size: hf.size, cells: hf.cells, bedrock: hf.bedrock },
    surface: { base: pristine.base, features: pristine.features },
  });
  const [height, base, features, damage, scorch] = await Promise.all([
    encodeHeights(hf.h, V), encodeBytes(surface.base), encodeBytes(surface.features), encodeF32(surface.damage), encodeF32(surface.scorch),
  ]);
  const B = view.buildings;
  const ids = new Map();          // unit / structure object -> its id in the save
  const idOf = o => (o ? ids.get(o) ?? null : null);
  units.structures.forEach((h, k) => ids.set(h, 's' + k));
  units.list.forEach((u, k) => ids.set(u, 'u' + k));
  const jobIds = new Map(construction.jobs.filter(j => !j.done).map((j, k) => [j, k]));
  return {
    kind: SAVE_KIND, saveVersion: SAVE_VERSION, gameVersion: G.version, savedAt: new Date().toISOString(),
    mapId: G.mapId, mapName: map.name, sandbox: G.sandbox, fog: G.fog.on, time: r3(state.time),
    pristine: pristineMap,
    ground: { height, base, features, damage, scorch },
    trees: view.forest.trees.map(t => [r2(t.x), r2(t.z), r2(t.s), t.t, t.state, r3(t.dir || 0), r2(t.burn || 0), t.charred ? 1 : 0, t.short ? 1 : 0]),
    buildings: {
      defs: B.list.map(b => ({ ...b.def, y: r3(b.y) })),
      // Pieces that aren't as built: [index, hp, alive, marks, broken hole]
      pieces: B.pieces.map((p, i) => (p.alive && p.hp >= p.maxHp && !p.marks.length ? null
        : [i, r2(p.hp), p.alive ? 1 : 0, p.marks.map(m => m.map(r3)), p.brk ? p.brk.map(r3) : null])).filter(Boolean),
      chunks: B.chunks.filter(c => c.alive).map(c => [r2(c.x), r2(c.z), r2(c.s), c.color, r2(c.rot), r2(c.lift || 0)]),
    },
    decals: decals.log,
    structures: units.structures.map(h => ({ type: h.type, team: h.team, x: r2(h.x), z: r2(h.z), hp: r2(h.hp), alive: h.alive, built: h.built, yaw: r3(h.yaw), known: !!h.known })),
    units: units.list.filter(u => u.alive).map(u => ({
      id: idOf(u), type: u.type, team: u.team, x: r2(u.x), z: r2(u.z), yaw: r3(u.yaw), torsoYaw: r3(u.torsoYaw), hp: r2(u.hp), maxHp: u.maxHp,
      order: u.order, goal: u.goal && { x: r2(u.goal.x), z: r2(u.goal.z) }, guard: u.guard && { x: r2(u.guard.x), z: r2(u.guard.z) },
      hold: !!u.hold, defend: !!u.defend, attack: idOf(u.attackTarget), jobs: u.jobs ? u.jobs.filter(j => jobIds.has(j)).map(j => jobIds.get(j)) : null,
      selected: G.selected.has(u),
    })),
    wrecks: units.wrecks.map(w => ({ ...w, x: r2(w.x), y: r2(w.y), z: r2(w.z) })),
    jobs: [...jobIds.keys()].map(j => {
      const o = {};
      for (const [k, v] of Object.entries(j)) if (k !== 'structure' && k !== 'id') o[k] = typeof v === 'number' ? r3(v) : v;
      o.structure = j.structure ? idOf(j.structure) : null;
      return o;
    }),
    match: match && {
      time: r3(match.time), over: match.over,
      teams: match.teams.map(T => ({ credits: r2(T.credits), queue: [...T.queue], prog: r3(T.prog), built: T.built, lost: T.lost })),
      points: match.points.map(p => ({ control: r3(p.control), owner: p.owner })),
    },
    ai: ai && { timer: r3(ai.timer), wave: ai.wave, waveSize: ai.waveSize },
    explored: await Promise.all(vision.explored.map(a => encodeBytes(a))),
    camera: { x: r2(rts.target.x), y: r2(rts.target.y), z: r2(rts.target.z), distance: r2(rts.distance), yaw: r3(rts.yaw), pitch: r3(rts.pitch) },
  };
}

// A file name for a save: mech-rts-<map>-<date>-<time>.json
export function saveFileName(save) {
  const slug = (save.mapName || 'map').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'map';
  const d = new Date(save.savedAt), p = n => String(n).padStart(2, '0');
  return `mech-rts-${slug}-${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}.json`;
}

// Check a parsed file is a save this version can load. Throws an Error with a readable message.
export function checkSave(json) {
  if (!json || typeof json !== 'object' || json.kind !== SAVE_KIND) throw new Error('That file is not a Mech RTS saved game.');
  if (!(json.saveVersion <= SAVE_VERSION)) throw new Error('That saved game is from a newer version of the game. Reload to get the latest version.');
  if (!json.pristine || !json.ground) throw new Error('That saved game is incomplete.');
  return json;
}

// The map to start the game on.
export function saveMap(save) { return deserializeMap(save.pristine); }

// ---------- apply ----------
// After the game has started up on saveMap(save): put everything back as it was. G: the game's parts, plus
// newMatch() (sets up a Match and AI with their HQs, no units) and clearUnits().
export async function applySave(G, save) {
  const { map, view, units, construction, decals, vision, rts, state, nav } = G;
  const hf = map.hf, surface = map.surface, V = hf.verts, N = V * V, g = save.ground;
  const [h, base, features, damage, scorch] = await Promise.all([
    decodeHeights(g.height, V), decodeBytes(g.base, N, 'ground'), decodeBytes(g.features, N, 'features'), decodeF32(g.damage, N, 'wear'), decodeF32(g.scorch, N, 'scorch'),
  ]);
  hf.h.set(h);
  surface.base.set(base); surface.features.set(features); surface.damage.set(damage); surface.scorch.set(scorch);
  view.terrain.rebuildAll();
  view.rebuildWater();
  // Trees as they were (standing, fallen, burning, gone).
  view.forest.setTrees(save.trees.map(([x, z, s, t, st, dir, burn, charred, short]) => ({ x, z, s, t, state: st, dir, burn, charred: !!charred, short: !!short })));
  view.trees.setForest(view.forest);
  // Buildings, piece by piece, and the rubble round them.
  const B = new Buildings(save.buildings.defs, hf);
  for (const [i, hp, alive, marks, brk] of save.buildings.pieces) {
    const p = B.pieces[i];
    if (!p) continue;
    p.hp = hp; p.alive = !!alive; p.marks = marks || []; p.brk = brk || null;
  }
  for (const b of B.list) B._settle(b);
  B.falling.length = 0; B.changed.clear(); B._rubble = [];
  B.chunks = save.buildings.chunks.map(([x, z, s, color, rot, lift]) => ({ x, z, s, color, rot, lift, alive: true }));
  B.heaps.length = 0;
  for (const c of B.chunks) { const key = Math.round(c.x / 0.8) * 4096 + Math.round(c.z / 0.8); B.piles.set(key, (B.piles.get(key) || 0) + 1); }
  view.buildings = B;
  view.buildingView.setBuildings(B);
  decals.clear();
  decals.replay(save.decals);
  // Units.
  G.clearUnits();
  const byId = new Map();
  if (save.match) {
    const m = G.newMatch();
    save.structures.filter(s => s.type === 'hq').forEach((s, k) => { const hq = m.teams[k]?.hq; if (hq) byId.set('s' + save.structures.indexOf(s), hq); });
    m.time = save.match.time; m.over = save.match.over;
    save.match.teams.forEach((t, k) => Object.assign(m.teams[k], { credits: t.credits, queue: [...t.queue], prog: t.prog, built: t.built, lost: t.lost }));
    save.match.points.forEach((p, k) => { if (m.points[k]) Object.assign(m.points[k], p); });
    if (save.ai && G.ai) Object.assign(G.ai, save.ai);
  }
  save.structures.forEach((s, k) => {
    if (!s.alive && s.type !== 'hq') return;          // a destroyed turret is only its wreck now (saved with the wrecks)
    let h = byId.get('s' + k);
    if (!h) { h = units.addStructure(s.type, s.team, s.x, s.z, s.built ?? 1); byId.set('s' + k, h); }
    h.hp = s.hp; h.yaw = s.yaw; h.known = s.known;
    if (s.built !== undefined) h.built = s.built;
    if (!s.alive) units.kill(h);
  });
  for (const s of save.units) {
    const u = units.spawn(s.type, s.team, s.x, s.z, s.yaw);
    u.hp = s.hp; u.maxHp = s.maxHp; u.torsoYaw = s.torsoYaw;
    if (s.guard) u.guard = { ...s.guard };
    byId.set(s.id, u);
    if (s.selected) G.selected.add(u);
  }
  units.wrecks.push(...save.wrecks.map(w => ({ ...w })));
  // Builders' unfinished jobs.
  const jobs = save.jobs.map(j => ({ ...j, id: newJobId(), structure: j.structure ? byId.get(j.structure) || null : null }));
  construction.jobs.push(...jobs);
  // Orders again.
  for (const s of save.units) {
    const u = byId.get(s.id);
    if (!u) continue;
    const target = s.attack ? byId.get(s.attack) : null;
    if (s.jobs?.length) construction.assign([u], s.jobs.map(k => jobs[k]).filter(Boolean));
    else if (s.order === 'attack' && target?.alive) units.attack([u], target);
    else if ((s.order === 'move' || s.order === 'amove') && s.goal) units.order([u], s.order, s.goal.x, s.goal.z);
    else if (s.hold || s.defend) units.stop([u]);
    if (s.defend) units.defend([u], true);
  }
  units.events.length = 0;
  nav.rebuild();
  // Explored ground, and the camera.
  G.setFog(save.fog);
  if (save.explored) {
    const n = vision.explored[0].length;
    const ex = await Promise.all(save.explored.map(l => decodeBytes(l, n, 'explored')));
    ex.forEach((a, k) => vision.explored[k]?.set(a));
    vision.update(Infinity, true);
    G.fogView.snap(vision);
  }
  state.time = save.time || 0;
  const c = save.camera;
  if (c) { rts.target.set(c.x, c.y, c.z); rts.distance = c.distance; rts.yaw = c.yaw; rts.pitch = c.pitch; rts.update(0); }
}

// ---------- hand-off between page loads (IndexedDB: saves can be larger than localStorage allows) ----------
function db() {
  return new Promise((res, rej) => {
    const q = indexedDB.open('mechrts', 1);
    q.onupgradeneeded = () => q.result.createObjectStore('kv');
    q.onsuccess = () => res(q.result);
    q.onerror = () => rej(q.error);
  });
}
export async function stashSave(text) {
  const d = await db();
  await new Promise((res, rej) => { const t = d.transaction('kv', 'readwrite'); t.objectStore('kv').put(text, 'resume'); t.oncomplete = res; t.onerror = () => rej(t.error); });
  d.close();
}
export async function takeStash() {
  const d = await db();
  const text = await new Promise((res, rej) => { const t = d.transaction('kv', 'readonly'), q = t.objectStore('kv').get('resume'); q.onsuccess = () => res(q.result); q.onerror = () => rej(q.error); });
  d.close();
  return text || null;
}
