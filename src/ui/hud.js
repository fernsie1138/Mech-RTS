// Match HUD (CLAUDE.md §9): credits and income, capture points held, build buttons with queue counts and
// progress, banners for events, and the start and end screens. The DOM lives in index.html.
import { UNIT_TYPES, UNIT_KEYS } from '../config.js';

const HOLD_MS = 500;                // press and hold a build button this long to cancel one
const $ = id => document.getElementById(id);
const fmtTime = t => `${Math.floor(t / 60)}:${String(Math.floor(t % 60)).padStart(2, '0')}`;

export class Hud {
  // getMatch(): the current Match.   onBuild(type) / onUnbuild(type): queue or un-queue a mech.
  constructor({ getMatch, onBuild, onUnbuild, onStart, onAgain }) {
    Object.assign(this, { getMatch, onBuild, onUnbuild });
    this.el = { res: $('res'), credits: $('credits'), income: $('income'), points: $('points'), army: $('army'), clock: $('clock'),
      build: $('build'), banner: $('banner'), start: $('startScreen'), end: $('endScreen'), endTitle: $('endTitle'), endText: $('endText') };
    this.cards = {};
    for (const k of UNIT_KEYS) {
      const t = UNIT_TYPES[k], c = document.createElement('div');
      c.className = 'card btn';
      c.dataset.type = k;
      c.innerHTML = `<div class="nm">${t.short || t.name}</div><div class="cost">⚡${t.cost}</div><div class="bv">BV ${t.bv}</div><div class="q"></div><div class="pb"></div>`;
      this.el.build.appendChild(c);
      this.cards[k] = c;
      // Tap: build one. Press and hold: take one off the queue (refund).
      // The timer gives feedback while the finger is still down; the release time decides if the timer was late.
      let hold = null, downT = 0;
      c.addEventListener('pointerdown', e => { e.stopPropagation(); downT = e.timeStamp; hold = setTimeout(() => { hold = 'done'; this.onUnbuild(k); }, HOLD_MS); });
      c.addEventListener('pointerup', e => {
        if (hold === null) return;
        if (hold !== 'done') { clearTimeout(hold); if (e.timeStamp - downT >= HOLD_MS) this.onUnbuild(k); else this.onBuild(k); }
        hold = null;
      });
      c.addEventListener('pointercancel', () => { clearTimeout(hold); hold = null; });
      c.addEventListener('contextmenu', e => e.preventDefault());
    }
    $('btnStart').addEventListener('pointerup', () => { this.el.start.style.display = 'none'; onStart(); });
    $('btnAgain').addEventListener('pointerup', () => { this.el.end.style.display = 'none'; onAgain(); });
    this.bannerT = 0;
    this.t = 1;
  }

  // Prices on the build buttons (after the stats are changed in Dev).
  refreshCosts() {
    for (const k of UNIT_KEYS) { this.cards[k].querySelector('.cost').textContent = `⚡${UNIT_TYPES[k].cost}`; this.cards[k].querySelector('.bv').textContent = `BV ${UNIT_TYPES[k].bv}`; }
  }

  show(on) {
    for (const e of [this.el.res, this.el.build]) e.style.display = on ? '' : 'none';
  }
  showStart() { this.el.start.style.display = 'flex'; }

  banner(text, color = '#fff', secs = 3) {
    const b = this.el.banner;
    b.textContent = text; b.style.color = color; b.style.opacity = 1;
    this.bannerT = secs;
  }

  // Why a build was refused, as a banner.
  refused(reason) {
    const m = this.getMatch();
    const msg = { poor: 'Not enough power', full: 'Build queue full', over: 'The match is over',
      bv: m ? `Battle Value limit (${m.bvUsed(0)}/${m.bvCap(0)}): take capture points to raise it` : 'Battle Value limit' }[reason];
    if (msg) this.banner(msg, '#ffd25a', reason === 'bv' ? 2.5 : 1.8);
  }

  end(won, m) {
    const T = m.teams[0], E = m.teams[1];
    this.el.endTitle.textContent = won ? 'VICTORY' : 'DEFEAT';
    this.el.endTitle.style.color = won ? '#7cb8ff' : '#ff6a58';
    this.el.endText.innerHTML = `${won ? 'Enemy HQ destroyed' : 'Your HQ was destroyed'} after ${fmtTime(m.over.time)}.<br>` +
      `Mechs built ${T.built}, lost ${T.lost}. Enemy mechs destroyed: ${E.lost}.`;
    this.el.end.style.display = 'flex';
  }

  // Per frame. Text is refreshed a few times a second; the progress bar every frame.
  update(dt) {
    const m = this.getMatch();
    if (this.bannerT > 0 && (this.bannerT -= dt) <= 0) this.el.banner.style.opacity = 0;
    if (!m) return;
    const T = m.teams[0];
    for (const k of UNIT_KEYS) {
      const c = this.cards[k];
      c.querySelector('.pb').style.width = T.queue[0] === k ? `${Math.min(100, T.prog / UNIT_TYPES[k].build * 100)}%` : '0';
    }
    if ((this.t += dt) < 0.25) return;
    this.t = 0;
    this.el.credits.textContent = `⚡ ${Math.floor(T.credits)}`;
    this.el.income.textContent = `+${m.income(0)}/s`;
    this.el.points.textContent = `⚑ ${m.held(0)}/${m.points.length}`;
    const used = m.bvUsed(0), cap = m.bvCap(0);
    this.el.army.textContent = `BV ${used}/${cap}`;
    this.el.army.classList.toggle('full', used >= cap);
    this.el.clock.textContent = fmtTime(m.time);
    for (const k of UNIT_KEYS) {
      const c = this.cards[k], n = T.queue.filter(q => q === k).length;
      c.querySelector('.q').textContent = n ? `×${n}` : '';
      c.classList.toggle('poor', T.credits < UNIT_TYPES[k].cost);
      c.classList.toggle('nobv', used + (UNIT_TYPES[k].bv || 0) > cap);
    }
  }
}
