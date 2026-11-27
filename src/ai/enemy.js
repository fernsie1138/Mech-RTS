// Enemy AI (CLAUDE.md §9), ported from the prototype. Pure: no three.js.
//   Builds a mix of mechs (more Assaults and Titans later in the match).
//   Defends: if player mechs come near its HQ, every idle mech and every mech near the base goes for them.
//   Attacks in waves: once enough mechs are waiting, they attack-move to the nearest capture point it doesn't hold
//   (sometimes the second nearest), and every third wave goes for the player's HQ. Waves grow by one each time.
import { AI } from '../config.js';

export class EnemyAI {
  constructor(match, team = 1) {
    this.match = match;
    this.units = match.units;
    this.team = team;
    this.timer = 2;
    this.wave = 0;
    this.waveSize = AI.firstWave;
    this.defending = false;
    this.events = [];                    // { type: 'wave', target: 'point' | 'hq', x, z, size }
  }

  step(dt) {
    const m = this.match, T = m.teams[this.team], me = T.hq, rng = this.units.rng;
    if (m.over || !me.alive) return;
    if ((this.timer -= dt) > 0) return;
    this.timer = AI.think;

    // Keep two mechs in the queue.
    if (T.queue.length < 2) {
      const r = rng(), late = m.time > AI.lateGame;
      const pick = late ? (r < 0.2 ? 'scout' : r < 0.42 ? 'medium' : r < 0.72 ? 'assault' : 'titan') : (r < 0.38 ? 'scout' : r < 0.62 ? 'medium' : r < 0.87 ? 'assault' : 'titan');
      const res = m.enqueue(this.team, pick);
      // At the Battle Value limit: something smaller, if it fits.
      if (res === 'bv') { for (const k of ['medium', 'scout']) if (k !== pick && m.enqueue(this.team, k) === true) break; }
      else if (res === 'poor' && rng() < 0.25) m.enqueue(this.team, 'scout');
    }

    const mine = this.units.list.filter(u => u.alive && u.team === this.team);
    const d2 = (a, b) => Math.hypot(a.x - b.x, a.z - b.z);

    // Defend the base.
    const intruder = this.units.list.find(u => u.alive && u.team !== this.team && d2(u, me) < AI.defendRadius);
    this.defending = !!intruder;
    if (intruder) {
      const near = mine.filter(u => u.order === 'idle' || d2(u, me) < AI.defendRadius + 13);
      const send = near.filter(u => u.order !== 'attack' && !(u.order === 'amove' && u.goal && d2(u.goal, intruder) < 8));
      if (send.length) this.units.order(send, 'amove', intruder.x, intruder.z);
      return;
    }

    // Attack in waves.
    const idle = mine.filter(u => u.order === 'idle');
    if (idle.length >= this.waveSize) {
      const open = m.points.filter(p => p.owner !== this.team).sort((a, b) => d2(a, me) - d2(b, me));
      let dest, target;
      if (!open.length || this.wave % 3 === 2) { dest = m.teams[1 - this.team].hq; target = 'hq'; }
      else { dest = open[Math.min(open.length - 1, rng() < 0.7 ? 0 : 1)]; target = 'point'; }
      this.units.order(idle, 'amove', dest.x, dest.z);
      this.events.push({ type: 'wave', target, x: dest.x, z: dest.z, size: idle.length });
      this.wave++;
      this.waveSize = Math.min(AI.maxWave, AI.firstWave + this.wave);
    }
  }
}
