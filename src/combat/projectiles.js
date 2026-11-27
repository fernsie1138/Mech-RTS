// Projectiles (CLAUDE.md §9). Pure: no three.js.
//   Direct fire (mg, cannon): flies straight. A shot that will hit homes onto its target; a miss flies at a point
//   beside it. If the line runs into the ground or a standing wall on the way, it bursts there instead.
//   Shells and missiles (Assault Mechs): an arc to a fixed aim point (where the target was), so fast units can dodge
//   them. Missiles fly a flatter arc than shells.
// On impact, onImpact(p, x, y, z, unitHit) is called: the owner applies damage through combat/damage.js.

export class Projectiles {
  constructor(world, onImpact) {
    this.world = world;
    this.onImpact = onImpact;
    this.list = [];
  }

  // o: { kind, team, dmg, splash, from: {x,y,z}, to: {x,y,z}, speed, target (unit or null), willHit, shooter }
  fire(o) {
    const d = Math.hypot(o.to.x - o.from.x, o.to.y - o.from.y, o.to.z - o.from.z);
    const p = { ...o, x: o.from.x, y: o.from.y, z: o.from.z, t: 0, dur: Math.max(0.05, d / o.speed), arc: o.kind === 'shell' ? d * 0.3 : o.kind === 'missile' ? d * 0.16 : 0, alive: true };
    this.list.push(p);
    return p;
  }

  step(dt) {
    const { hf, buildings } = this.world;
    for (const p of this.list) {
      if (p.kind === 'shell' || p.kind === 'missile') {
        p.t += dt;
        const k = Math.min(1, p.t / p.dur);
        p.px = p.x; p.py = p.y; p.pz = p.z;
        p.x = p.from.x + (p.to.x - p.from.x) * k;
        p.z = p.from.z + (p.to.z - p.from.z) * k;
        p.y = p.from.y + (p.to.y - p.from.y) * k + Math.sin(Math.PI * k) * p.arc;
        if (k >= 1) this._impact(p, p.to.x, hf.heightAt(p.to.x, p.to.z), p.to.z, null);
        continue;
      }
      // Direct fire: home onto the target if this shot hits.
      if (p.willHit && p.target && p.target.alive) { p.to.x = p.target.x; p.to.y = p.target.y + p.target.height * 0.55; p.to.z = p.target.z; }
      const dx = p.to.x - p.x, dy = p.to.y - p.y, dz = p.to.z - p.z, d = Math.hypot(dx, dy, dz), s = p.speed * dt;
      const k = d <= s ? 1 : s / d;
      // Check the path this step for ground or walls (sampled every half unit).
      const n = Math.max(1, Math.ceil(Math.min(d, s) / 0.5));
      let blocked = null;
      for (let i = 1; i <= n && !blocked; i++) {
        const t = k * i / n, x = p.x + dx * t, y = p.y + dy * t, z = p.z + dz * t;
        let top = hf.heightAt(x, z);
        if (buildings) top = Math.max(top, buildings.topAt(x, z));
        if (y < top && Math.hypot(x - p.from.x, z - p.from.z) > 1.5) blocked = { x, y, z };
      }
      p.px = p.x; p.py = p.y; p.pz = p.z;
      if (blocked) { this._impact(p, blocked.x, blocked.y, blocked.z, null); continue; }
      p.x += dx * k; p.y += dy * k; p.z += dz * k;
      if (k >= 1) {
        const hitUnit = p.willHit && p.target && p.target.alive ? p.target : null;
        this._impact(p, p.x, hitUnit ? p.y : Math.max(p.y, hf.heightAt(p.x, p.z)), p.z, hitUnit);
      }
    }
    this.list = this.list.filter(p => p.alive);
  }

  _impact(p, x, y, z, unit) {
    p.alive = false;
    this.onImpact(p, x, y, z, unit);
  }
}
