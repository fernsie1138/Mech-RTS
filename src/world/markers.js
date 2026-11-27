// Gameplay markers drawn in the world: player HQ (blue), enemy HQ (red), capture points (yellow flags).
// In a match the game drives them: the HQ turret turns, a destroyed HQ is a blackened ruin, and capture flags and
// rings take the colour of the side that controls them (setHQ / setCapture).
import * as THREE from 'three';
import { SHAPES } from './shapes.js';

const CAP_NEUTRAL = new THREE.Color(0xffd23a), CAP_TEAM = [new THREE.Color(0x3d8bff), new THREE.Color(0xe0453a)];

export class MarkerView {
  constructor(scene) {
    this.group = new THREE.Group();
    this.group.name = 'markers';
    scene.add(this.group);
    this.items = [];
    this.time = 0;
    // Command centre: an octagonal, battered base on a skirt, buttresses round it, a stepped deck, a tapered
    // command tower with the gun turret on top, an antenna mast and a dish. Grey armour with team-coloured bands.
    const oct = (rt, rb, h, y) => new THREE.CylinderGeometry(rt, rb, h, 8).rotateY(Math.PI / 8).translate(0, y + h / 2, 0);
    const parts = {
      skirt: oct(6.4, 7.0, 1.2, 0), body: oct(5.0, 6.0, 4.2, 1.2), band: oct(5.05, 5.25, 0.5, 4.4), deck: oct(3.9, 5.0, 1.0, 5.4),
      tower: new THREE.CylinderGeometry(1.7, 2.5, 5.2, 6).translate(0, 9.0, 0), crown: new THREE.CylinderGeometry(2.3, 1.7, 0.9, 6).translate(0, 12.05, 0),
      ring: new THREE.CylinderGeometry(2.55, 2.55, 0.4, 6).translate(0, 8.0, 0),
    };
    const strutGeo = SHAPES.wedge();
    const mastGeo = new THREE.BoxGeometry(0.22, 5, 0.22).translate(0, 2.5, 0);
    const dishGeo = new THREE.ConeGeometry(1.3, 0.5, 10, 1, true).rotateX(Math.PI);
    const turretGeo = new THREE.BoxGeometry(2.4, 1.3, 2.4), barrelGeo = new THREE.BoxGeometry(0.35, 0.35, 2.6).translate(0, 0, 1.6);
    const darkMat = new THREE.MeshLambertMaterial({ color: 0x2a2f35 });
    this.hq = (color) => {
      const g = new THREE.Group();
      const mat = new THREE.MeshLambertMaterial({ color, flatShading: true });              // team colour
      const armour = new THREE.MeshLambertMaterial({ color: 0xa9b1b8, flatShading: true });
      const trim = new THREE.MeshLambertMaterial({ color: 0x59626b, flatShading: true });
      const add = (geo, m, setup) => { const o = new THREE.Mesh(geo, m); o.castShadow = o.receiveShadow = true; setup?.(o); g.add(o); return o; };
      add(parts.skirt, trim); add(parts.body, armour); add(parts.band, mat); add(parts.deck, trim); add(parts.ring, mat);
      const tower = new THREE.Group();
      tower.add(...[add(parts.tower, armour), add(parts.crown, mat)]);
      g.add(tower);
      for (let k = 0; k < 8; k++) {           // buttresses on the corners of the base, sloping out
        const a = (k + 0.5) / 8 * Math.PI * 2;
        add(strutGeo, trim, o => { o.scale.set(0.9, 4.2, 1.8); o.position.set(Math.sin(a) * 6.35, 2.1, Math.cos(a) * 6.35); o.rotation.y = a + Math.PI; });
      }
      add(mastGeo, darkMat, o => o.position.set(3.2, 6.4, -1.5));
      add(dishGeo, armour, o => { o.position.set(-2.8, 7.4, 2.2); o.rotation.set(-0.6, 0.8, 0); });
      add(new THREE.CylinderGeometry(0.15, 0.25, 1.2, 6), darkMat, o => o.position.set(-2.8, 6.8, 2.2));
      // Roof turret (turns toward what the HQ is shooting at).
      const turret = new THREE.Group();
      turret.position.y = 12.6;
      const tb = new THREE.Mesh(turretGeo, trim), b0 = new THREE.Mesh(barrelGeo, darkMat), b1 = new THREE.Mesh(barrelGeo, darkMat);
      b0.position.set(-0.4, 0.1, 0); b1.position.set(0.4, 0.1, 0);
      tb.castShadow = true;
      turret.add(tb, b0, b1);
      g.add(turret);
      g.userData = { turret, tower, mats: [mat, armour, trim], colors: [new THREE.Color(color), armour.color.clone(), trim.color.clone()] };
      return g;
    };
    const poleGeo = new THREE.CylinderGeometry(0.15, 0.15, 6, 6).translate(0, 3, 0);
    const flagGeo = new THREE.PlaneGeometry(2.2, 1.3).translate(1.1, 5.2, 0);
    const ringGeo = new THREE.RingGeometry(7.6, 8, 48).rotateX(-Math.PI / 2);
    const poleMat = new THREE.MeshLambertMaterial({ color: 0xdddddd });
    this.cap = () => {
      const g = new THREE.Group();
      // Own materials per point, so each can show who controls it.
      const flagMat = new THREE.MeshLambertMaterial({ color: 0xffd23a, side: THREE.DoubleSide });
      const ringMat = new THREE.MeshBasicMaterial({ color: 0xffd23a, transparent: true, opacity: 0.55, depthWrite: false, depthTest: false });  // drawn over bumpy ground
      const pole = new THREE.Mesh(poleGeo, poleMat), flag = new THREE.Mesh(flagGeo, flagMat), ring = new THREE.Mesh(ringGeo, ringMat);
      pole.castShadow = flag.castShadow = true;
      ring.position.y = 0.25;
      ring.renderOrder = 10;
      g.add(pole, flag, ring);
      g.userData.flag = flag;
      g.userData.mats = [flagMat, ringMat];
      return g;
    };
  }

  // markers = { playerHQ, enemyHQ, capturePoints }
  set(markers) {
    for (const it of this.items) this.group.remove(it.obj);
    this.items = [];
    if (!markers) return;
    if (markers.playerHQ) this._add(this.hq(0x3d7be0), markers.playerHQ, 'playerHQ');
    if (markers.enemyHQ) this._add(this.hq(0xd0453a), markers.enemyHQ, 'enemyHQ');
    (markers.capturePoints || []).forEach((p, i) => this._add(this.cap(), p, 'capture', i));
  }

  _add(obj, p, kind, index) {
    obj.position.set(p.x, 0, p.z);
    this.group.add(obj);
    this.items.push({ obj, p, kind, index });
  }

  // HQ state from the match: turret yaw (world), alive (a dead HQ is a dark, slumped ruin).
  setHQ(team, yaw, alive) {
    const it = this.items.find(i => i.kind === (team === 0 ? 'playerHQ' : 'enemyHQ'));
    if (!it) return;
    const u = it.obj.userData;
    u.turret.rotation.y = yaw;
    if (!alive && !u.dead) {
      u.dead = true;
      u.mats.forEach((m, k) => m.color.copy(u.colors[k]).multiplyScalar(0.18));
      u.tower.scale.y = 0.45; u.tower.position.y = 1.5; u.tower.rotation.z = 0.25;
      u.turret.visible = false;
    } else if (alive && u.dead) {
      u.dead = false;
      u.mats.forEach((m, k) => m.color.copy(u.colors[k]));
      u.tower.scale.y = 1; u.tower.position.y = 0; u.tower.rotation.z = 0;
      u.turret.visible = true;
    }
  }

  // Capture point colour: control -1 (enemy, red) .. 0 (neutral, yellow) .. +1 (player, blue).
  setCapture(index, control) {
    const it = this.items.find(i => i.kind === 'capture' && i.index === index);
    if (!it) return;
    const c = CAP_NEUTRAL.clone().lerp(control >= 0 ? CAP_TEAM[0] : CAP_TEAM[1], Math.min(1, Math.abs(control)));
    for (const m of it.obj.userData.mats) m.color.copy(c);
  }

  // Keep markers on the (changing) ground; wave the flags.
  update(heightAt, dt = 0) {
    this.time += dt;
    for (const it of this.items) {
      it.obj.position.y = heightAt(it.p.x, it.p.z);
      if (it.obj.userData.flag) it.obj.userData.flag.rotation.y = Math.sin(this.time * 2 + (it.index || 0)) * 0.25;
    }
  }
}
