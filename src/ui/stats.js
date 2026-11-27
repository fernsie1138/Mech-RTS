// Dev tools: change the stats of every unit while playing (for testing and balancing).
// Changes apply at once, to units already on the map too, and are remembered on this device until "Reset to
// defaults". "Copy" puts the changed values on the clipboard as text (to paste into a message).
import { UNIT_TYPES, UNIT_KEYS, HQ_TYPE, TURRET_TYPE, BUILD, ECONOMY } from '../config.js';
import { MOVE } from '../units/movers.js';

const KEY = 'mechrts.stats';
const TYPES = { ...Object.fromEntries(UNIT_KEYS.map(k => [k, UNIT_TYPES[k]])), turret: TURRET_TYPE, hq: HQ_TYPE };
const COLS = [...UNIT_KEYS, 'turret', 'hq'];

// Rows of the unit table: [label, key, hint]. 'speed' is units per second; 'cost' / 'build' of a turret are the
// Builder's turret job (BUILD.turret.cost / work).
const ROWS = [
  ['Cost (⚡)', 'cost', 'credits to build one'],
  ['Battle Value', 'bv', 'counts against the side\'s Battle Value limit (bigger units more)'],
  ['Build time (s)', 'build', 'seconds to build (a turret: Builder-seconds)'],
  ['Speed', 'speed', 'world units per second on open ground'],
  ['Strength (hp)', 'hp', 'hit points'],
  ['Damage', 'dmg', 'damage per hit (Assault, Heavy and Medium Mechs also splash)'],
  ['Fire every (s)', 'rof', 'seconds between shots'],
  ['Range', 'range', 'how far it shoots'],
  ['Sight', 'sight', 'how far it sees (with a clear line of sight)'],
  ['Detection (%)', 'detect', 'how easily enemies spot it: 100 = normally; 50 = only within half their sight range'],
  ['Accuracy', 'accuracy', 'chance to hit in the open, 0 to 1'],
  ['Splash radius', 'splash', 'damage to units round the impact'],
  ['Shot speed', 'projSpeed', 'projectile speed'],
  ['Turn speed', 'turn', 'radians per second'],
  ['Repair (hp/s)', 'repair', 'how fast a Builder mends a damaged unit'],
];
const MOVING = new Set(UNIT_KEYS);
const ARMED = k => !TYPES[k].unarmed;

// Every editable value as [id, label, get, set].
function fields() {
  const f = [];
  for (const [label, key] of ROWS) for (const k of COLS) {
    const t = TYPES[k];
    let get, set;
    if (key === 'speed') {
      if (!MOVING.has(k)) continue;
      get = () => MOVE.speeds[t.cls] * (t.speed || 1);
      set = v => { t.speed = v / MOVE.speeds[t.cls]; };
    } else if ((key === 'cost' || key === 'build') && k === 'turret') {
      const bk = key === 'cost' ? 'cost' : 'work';
      get = () => BUILD.turret[bk]; set = v => { BUILD.turret[bk] = v; };
    } else if ((key === 'cost' || key === 'build' || key === 'bv') && k === 'hq') continue;
    else if (!ARMED(k) && ['dmg', 'rof', 'range', 'accuracy', 'splash', 'projSpeed'].includes(key)) continue;
    else if (t[key] === undefined) continue;
    else { get = () => t[key]; set = v => { t[key] = v; }; }
    f.push({ id: `${k}.${key}`, k, key, label, get, set });
  }
  for (const j of ['wall', 'trench']) {
    f.push({ id: `build.${j}.cost`, k: j, key: 'cost', label: 'Cost (⚡)', get: () => BUILD[j].cost, set: v => { BUILD[j].cost = v; } });
    f.push({ id: `build.${j}.work`, k: j, key: 'work', label: 'Build time (s)', get: () => BUILD[j].work, set: v => { BUILD[j].work = v; } });
  }
  for (const [key, label] of [['startCredits', 'Starting credits'], ['baseIncome', 'Income per second'], ['pointIncome', '+ per capture point'], ['bvStart', 'Battle Value at the start'], ['bvPerPoint', '+ BV per capture point'], ['queueMax', 'Build queue length']]) {
    f.push({ id: `economy.${key}`, k: 'economy', key, label, get: () => ECONOMY[key], set: v => { ECONOMY[key] = v; } });
  }
  return f;
}

export class StatsEditor {
  // units: Units (to update mechs already on the map)   onChange(): after a change (the HUD refreshes costs)
  constructor({ units, onChange = () => {} }) {
    this.units = units;
    this.onChange = onChange;
    this.fields = fields();
    this.defaults = Object.fromEntries(this.fields.map(f => [f.id, f.get()]));
    this.el = null;
    this.load();
  }

  byId(id) { return this.fields.find(f => f.id === id); }

  // Set one value (by id, e.g. 'scout.cost'), and bring units on the map up to date.
  set(id, v, save = true) {
    const f = this.byId(id);
    if (!f || !Number.isFinite(v)) return false;
    if (f.key === 'hp' && TYPES[f.k]) {
      // Units already out there keep the same fraction of their strength.
      for (const lst of [this.units.list, this.units.structures]) for (const u of lst) {
        if (u.type !== f.k || !u.alive) continue;
        const frac = u.hp / u.maxHp;
        u.maxHp = v; u.hp = Math.max(1, frac * v);
      }
    }
    f.set(v);
    if (f.key === 'speed') for (const u of this.units.list) if (u.type === f.k && u.mover) u.mover.speedMult = TYPES[f.k].speed || 1;
    if (save) this.save();
    this.onChange();
    return true;
  }

  changed() {
    const out = {};
    for (const f of this.fields) { const v = f.get(); if (v !== this.defaults[f.id]) out[f.id] = v; }
    return out;
  }
  save() { try { localStorage.setItem(KEY, JSON.stringify(this.changed())); } catch { /* not remembered */ } }
  load() {
    let saved = null;
    try { saved = JSON.parse(localStorage.getItem(KEY) || 'null'); } catch { saved = null; }
    if (saved) for (const [id, v] of Object.entries(saved)) this.set(id, v, false);
  }
  reset() {
    for (const f of this.fields) this.set(f.id, this.defaults[f.id], false);
    this.save();
    if (this.el) this._fill();
  }

  // ---------- the dialog ----------
  open() {
    if (!this.el) this._build();
    this._fill();
    this.el.style.display = 'flex';
  }
  close() { if (this.el) this.el.style.display = 'none'; }

  _build() {
    const el = this.el = document.createElement('div');
    el.id = 'statsDialog';
    el.className = 'screen';
    const name = k => (TYPES[k] ? TYPES[k].short || TYPES[k].name : k[0].toUpperCase() + k.slice(1));
    const cell = (k, key) => {
      const f = this.fields.find(f => f.k === k && f.key === key);
      return f ? `<td><input type="number" inputmode="decimal" step="any" data-id="${f.id}"></td>` : '<td class="na">–</td>';
    };
    const unitRows = ROWS.map(([label, key, hint]) => `<tr><th title="${hint}">${label}</th>${COLS.map(k => cell(k, key)).join('')}</tr>`).join('');
    const jobRows = [['Cost (⚡)', 'cost'], ['Build time (s)', 'work']].map(([label, key]) =>
      `<tr><th>${label}</th>${['wall', 'trench'].map(k => cell(k, key)).join('')}</tr>`).join('');
    const ecoRows = this.fields.filter(f => f.k === 'economy').map(f => `<tr><th>${f.label}</th><td><input type="number" inputmode="decimal" step="any" data-id="${f.id}"></td></tr>`).join('');
    el.innerHTML = `<div class="box panel stats">
      <h2>Unit stats</h2>
      <p class="sub">Changes apply straight away, also to units already on the map, and are remembered on this device.</p>
      <div class="scroll"><table class="grid"><tr><th></th>${COLS.map(k => `<th>${name(k)}</th>`).join('')}</tr>${unitRows}</table>
      <h3>Builder jobs</h3><table class="grid"><tr><th></th><th>Wall</th><th>Trench (10 units)</th></tr>${jobRows}</table>
      <h3>Economy</h3><table class="grid">${ecoRows}</table></div>
      <div class="actions"><div class="btn" id="statsReset">Reset to defaults</div><div class="btn" id="statsCopy">Copy</div><div class="btn go" id="statsDone">Done</div></div>
    </div>`;
    document.body.appendChild(el);
    el.addEventListener('change', e => {
      const id = e.target.dataset?.id;
      if (!id) return;
      const v = parseFloat(e.target.value);
      if (!this.set(id, v)) e.target.value = this.byId(id).get();
      e.target.classList.toggle('mod', this.byId(id).get() !== this.defaults[id]);
    });
    // Keep game gestures (and the canvas) from reacting to touches in the dialog.
    for (const t of ['pointerdown', 'pointerup', 'touchstart', 'wheel']) el.addEventListener(t, e => e.stopPropagation());
    el.querySelector('#statsDone').addEventListener('click', () => this.close());
    el.querySelector('#statsReset').addEventListener('click', () => this.reset());
    el.querySelector('#statsCopy').addEventListener('click', () => {
      const txt = JSON.stringify(this.changed(), null, 1);
      navigator.clipboard?.writeText(txt).catch(() => {});
      el.querySelector('#statsCopy').textContent = 'Copied';
      setTimeout(() => { el.querySelector('#statsCopy').textContent = 'Copy'; }, 1500);
    });
  }

  _fill() {
    for (const inp of this.el.querySelectorAll('input[data-id]')) {
      const id = inp.dataset.id, v = this.byId(id).get();
      inp.value = Math.round(v * 1000) / 1000;
      inp.classList.toggle('mod', v !== this.defaults[id]);
    }
  }
}
