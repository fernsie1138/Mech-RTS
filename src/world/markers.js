// Gameplay markers drawn in the world: player HQ (blue), enemy HQ (red), capture points (yellow flags).
// Placeholders until the real HQ buildings and capture mechanics arrive (milestones 5 and 8).
import * as THREE from 'three';

export class MarkerView {
  constructor(scene) {
    this.group = new THREE.Group();
    this.group.name = 'markers';
    scene.add(this.group);
    this.items = [];
    this.time = 0;
    const hqGeo = new THREE.CylinderGeometry(5, 6, 6, 8).translate(0, 3, 0);
    const towerGeo = new THREE.BoxGeometry(2.5, 8, 2.5).translate(0, 8, 0);
    this.hq = (color) => {
      const g = new THREE.Group();
      const mat = new THREE.MeshLambertMaterial({ color });
      const a = new THREE.Mesh(hqGeo, mat), b = new THREE.Mesh(towerGeo, mat);
      a.castShadow = b.castShadow = a.receiveShadow = true;
      g.add(a, b);
      return g;
    };
    const poleGeo = new THREE.CylinderGeometry(0.15, 0.15, 6, 6).translate(0, 3, 0);
    const flagGeo = new THREE.PlaneGeometry(2.2, 1.3).translate(1.1, 5.2, 0);
    const ringGeo = new THREE.RingGeometry(7.6, 8, 48).rotateX(-Math.PI / 2);
    const poleMat = new THREE.MeshLambertMaterial({ color: 0xdddddd });
    const flagMat = new THREE.MeshLambertMaterial({ color: 0xffd23a, side: THREE.DoubleSide });
    const ringMat = new THREE.MeshBasicMaterial({ color: 0xffd23a, transparent: true, opacity: 0.55, depthWrite: false, depthTest: false });  // drawn over bumpy ground
    this.cap = () => {
      const g = new THREE.Group();
      const pole = new THREE.Mesh(poleGeo, poleMat), flag = new THREE.Mesh(flagGeo, flagMat), ring = new THREE.Mesh(ringGeo, ringMat);
      pole.castShadow = flag.castShadow = true;
      ring.position.y = 0.25;
      ring.renderOrder = 10;
      g.add(pole, flag, ring);
      g.userData.flag = flag;
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

  // Keep markers on the (changing) ground; wave the flags.
  update(heightAt, dt = 0) {
    this.time += dt;
    for (const it of this.items) {
      it.obj.position.y = heightAt(it.p.x, it.p.z);
      if (it.obj.userData.flag) it.obj.userData.flag.rotation.y = Math.sin(this.time * 2 + (it.index || 0)) * 0.25;
    }
  }
}
