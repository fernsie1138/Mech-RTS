// David's models for the Light, Heavy and Assault Mechs (assets/light-mech.gltf, heavy-mech.gltf, assault-mech.gltf)
// and the auto turret (assets/turret.gltf): they load, are drawn for every unit and wreck, are the right size (the
// Heavy Mech 60% bigger than before), walk (legs move), turn their torso / head, and shots come out of the gun
// barrels. No errors.
// Run: node tests/models.mjs
import { serve, outDir, playwright, checker, watchPage } from './harness.mjs';
import { join } from 'node:path';

const { chromium, devices } = playwright;
const { check, done } = checker();
const out = await outDir();
const server = await serve();
const browser = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
const ctx = await browser.newContext({ ...devices['iPad Pro 11 landscape'] });
const page = await ctx.newPage();
const w = watchPage(page, server.url);
await page.goto(server.url + '?sandbox');
await page.waitForFunction(() => window.__game?.ready, null, { timeout: 30000 });
const loaded = await page.waitForFunction(() => Object.values(window.__game.mechView.models).every(m => m.ready), null, { timeout: 30000 }).then(() => true, () => false);
check(loaded, 'all four models load');

// Each mech model: size, feet on the ground, shots from its guns (torso turned), legs moving as it walks.
const mechs = await page.evaluate(() => {
  const G = window.__game, THREE = G.THREE, M = G.mechView.models;
  G.pause();
  for (const u of [...G.units.list]) G.movers.remove(u.mover);
  G.units.list.length = 0;
  const out = {};
  for (const [type, guns] of [['scout', ['gun']], ['assault', ['arm0', 'arm1']], ['titan', ['arm0', 'arm1']]]) {
    for (const u of [...G.units.list]) G.movers.remove(u.mover);
    G.units.list.length = 0;
    const u = G.units.spawn(type, 0, 20, 20, 0.4);
    u.torsoYaw = 0.5;
    G.render();
    const mv = M[type], m = new THREE.Matrix4(), v = new THREE.Vector3(), all = new THREE.Box3();
    for (const mesh of Object.values(mv.meshes)) { mesh.getMatrixAt(0, m); const b = (mesh.geometry.boundingBox || (mesh.geometry.computeBoundingBox(), mesh.geometry.boundingBox)).clone().applyMatrix4(m); all.union(b); }
    const dist = p => {
      let d = Infinity;
      for (const g of guns) { const mesh = mv.meshes[g], pos = mesh.geometry.attributes.position; mesh.getMatrixAt(0, m); for (let k = 0; k < pos.count; k++) d = Math.min(d, v.fromBufferAttribute(pos, k).applyMatrix4(m).distanceTo(p)); }
      return d;
    };
    const mz = [];
    for (let k = 0; k < 4; k++) { const p = G.units.muzzle(u); mz.push(dist(new THREE.Vector3(p.x, p.y, p.z))); }
    const foot = () => { mv.meshes.foot0.getMatrixAt(0, m); return v.set(0, 0, 0).applyMatrix4(m).sub(new THREE.Vector3(u.x, 0, u.z)).clone(); };
    const f0 = foot();
    G.units.order([u], 'move', 20, 60); G.step(0.5); G.render();
    out[type] = { h: all.max.y - all.min.y, footY: all.min.y - u.y, mz: Math.max(...mz), legMoved: f0.distanceTo(foot()), count: mv.meshes.body.count, want: u.height };
  }
  return out;
});
for (const [type, r] of Object.entries(mechs)) {
  const name = { scout: 'Light', assault: 'Heavy', titan: 'Assault' }[type];
  check(r.count === 1 && Math.abs(r.h - r.want) < 0.3 && Math.abs(r.footY) < 0.25, `${name} Mech: drawn with the model, ${r.h.toFixed(2)} tall (unit height ${r.want.toFixed(2)}), feet on the ground (${r.footY.toFixed(2)})`);
  check(r.mz < r.want * 0.1, `${name} Mech: shots come out of its guns, torso turned (${r.mz.toFixed(2)} from the barrel's corners; allowed ${(r.want * 0.1).toFixed(2)}, the barrels being that wide)`);
  check(r.legMoved > 0.05, `${name} Mech: legs move as it walks (${r.legMoved.toFixed(2)})`);
}
check(Math.abs(mechs.assault.h / 4.14 - 1.6) < 0.05, `the Heavy Mech is 60% bigger than before (${mechs.assault.h.toFixed(2)} vs 4.14)`);
check(Math.abs(mechs.scout.h - 2.88) < 0.2 && Math.abs(mechs.titan.h - 5.76) < 0.3, `Light and Assault Mechs are the size of the old ones (${mechs.scout.h.toFixed(2)}, ${mechs.titan.h.toFixed(2)})`);

const r = await page.evaluate(() => {
  const G = window.__game, THREE = G.THREE, M = G.mechView.models;
  G.pause();
  // Only our test subjects on the map: one Heavy Mech and one turret.
  for (const u of [...G.units.list]) { G.movers.remove(u.mover); }
  G.units.list.length = 0;
  const x = 20, z = 20;
  const heavy = G.units.spawn('assault', 0, x, z, 0.4);
  const tur = G.units.addStructure('turret', 0, x + 10, z, 1);
  heavy.torsoYaw = 0.5; tur.yaw = 1.1; tur.torsoYaw = 0.3;
  G.render();
  const box = (mesh, i) => {      // world-space box of one instance of a part
    const m = new THREE.Matrix4(); mesh.getMatrixAt(i, m);
    const b = mesh.geometry.boundingBox || (mesh.geometry.computeBoundingBox(), mesh.geometry.boundingBox);
    return b.clone().applyMatrix4(m);
  };
  const dist = (mesh, p) => {      // nearest vertex of instance 0 of a part to a point
    const m = new THREE.Matrix4(); mesh.getMatrixAt(0, m);
    const pos = mesh.geometry.attributes.position, v = new THREE.Vector3();
    let d = Infinity;
    for (let k = 0; k < pos.count; k++) d = Math.min(d, v.fromBufferAttribute(pos, k).applyMatrix4(m).distanceTo(p));
    return d;
  };
  const all = new THREE.Box3();
  for (const mesh of Object.values(M.assault.meshes)) all.union(box(mesh, 0));
  const tb = new THREE.Box3();
  for (const mesh of Object.values(M.turret.meshes)) tb.union(box(mesh, 0));
  // Muzzles: each gun's shot starts at its barrel.
  const mz = [], tz = [];
  for (let k = 0; k < 2; k++) { const p = G.units.muzzle(heavy); mz.push(Math.min(dist(M.assault.meshes.arm0, new THREE.Vector3(p.x, p.y, p.z)), dist(M.assault.meshes.arm1, new THREE.Vector3(p.x, p.y, p.z)))); }
  for (let k = 0; k < 2; k++) { const p = G.units.muzzle(tur); tz.push(Math.min(dist(M.turret.meshes.gun0, new THREE.Vector3(p.x, p.y, p.z)), dist(M.turret.meshes.gun1, new THREE.Vector3(p.x, p.y, p.z)))); }
  // Walking: the feet move.
  const foot0 = box(M.assault.meshes.foot0, 0).getCenter(new THREE.Vector3());
  G.units.order([heavy], 'move', x, z + 40);
  G.step(0.6); G.render();
  const foot1 = box(M.assault.meshes.foot0, 0).getCenter(new THREE.Vector3()).sub(new THREE.Vector3(heavy.x, 0, heavy.z));
  const rel0 = foot0.sub(new THREE.Vector3(x, 0, z));
  // A destroyed one is drawn as a wreck with the same model.
  G.damage.hitUnit(heavy, 1e6);
  G.step(1); G.render();
  return {
    counts: [M.assault.meshes.body.count, M.turret.meshes.head.count],
    h: all.max.y - all.min.y, wide: all.max.x - all.min.x, footY: all.min.y - heavy.y,
    th: tb.max.y - tb.min.y, mz, tz, legMoved: rel0.distanceTo(foot1),
    wreck: M.assault.meshes.body.count, wrecks: G.units.wrecks.length,
  };
});
check(r.counts[0] === 1 && r.counts[1] === 1, `one Heavy Mech and one turret drawn with the models (${r.counts.join(', ')})`);

check(Math.abs(r.th - 3.4) < 0.3, `the turret is ${r.th.toFixed(2)} tall`);
check(r.mz.every(d => d < 0.66), `Heavy Mech shots come out of its forearm guns (${r.mz.map(d => d.toFixed(2)).join(', ')} from the barrels), with the torso turned`);
check(r.tz.every(d => d < 0.3), `turret shots come out of its barrels (${r.tz.map(d => d.toFixed(2)).join(', ')}), with the head turned`);
check(r.legMoved > 0.1, `the legs move as it walks (foot moved ${r.legMoved.toFixed(2)})`);
check(r.wreck === 1 && r.wrecks === 1, 'a destroyed Heavy Mech is drawn as a wreck with the model');
// The Artillery: Travel vs Deployed shapes, and shells from the end of its barrel when deployed (turret turned).
await page.waitForFunction(() => window.__game.mechView.artillery.ready, null, { timeout: 30000 });
const art = await page.evaluate(() => {
  const G = window.__game, THREE = G.THREE, V = G.mechView.artillery;
  for (const u of [...G.units.list]) G.movers.remove(u.mover);
  G.units.list.length = 0;
  const a = G.units.spawn('artillery', 0, 40, 40, 0.3);
  const box = k => { a.deploy = k; G.render(); const b = new THREE.Box3(), m = new THREE.Matrix4(), v = new THREE.Vector3();
    for (const mesh of Object.values(V.meshes)) { mesh.getMatrixAt(0, m); const p = mesh.geometry.attributes.position, d = mesh.geometry.attributes.aDelta;
      for (let i = 0; i < p.count; i++) b.expandByPoint(v.set(p.getX(i) + d.getX(i) * k, p.getY(i) + d.getY(i) * k, p.getZ(i) + d.getZ(i) * k).applyMatrix4(m)); }
    return b; };
  const travel = box(0), deployed = box(1);
  a.torsoYaw = 0.5; a.deploy = 1; G.render();
  const p = G.units.muzzle(a), mesh = V.meshes.ext, m = new THREE.Matrix4(), v = new THREE.Vector3(), pos = mesh.geometry.attributes.position, d = mesh.geometry.attributes.aDelta;
  mesh.getMatrixAt(0, m);
  let dist = Infinity;
  for (let i = 0; i < pos.count; i++) dist = Math.min(dist, v.set(pos.getX(i) + d.getX(i), pos.getY(i) + d.getY(i), pos.getZ(i) + d.getZ(i)).applyMatrix4(m).distanceTo(new THREE.Vector3(p.x, p.y, p.z)));
  const size = b => b.getSize(new THREE.Vector3());
  return { tH: size(travel).y, dH: size(deployed).y, tLen: Math.max(size(travel).x, size(travel).z), dLow: deployed.min.y - a.y, tLow: travel.min.y - a.y, dist, n: mesh.count };
});
check(art.n === 1 && art.tLen > 4 && art.tLen < 7, `the Artillery is drawn with your model (${art.tLen.toFixed(1)} long in Travel)`);
check(art.dH > art.tH + 0.8 && art.dLow < art.tLow - 0.1, `Deployed it stands taller (barrel raised: ${art.dH.toFixed(1)} vs ${art.tH.toFixed(1)}) with its anchors dug in below the treads`);
check(art.dist < 0.4, `deployed, its shells leave the end of the barrel, turret turned (${art.dist.toFixed(2)} from it)`);
await page.evaluate(() => { const G = window.__game, w0 = G.units.wrecks[0]; G.rts.target.set(w0.x + 5, w0.y + 2, w0.z); G.rts.distance = 22; G.rts.update(0); G.render(); });
await page.screenshot({ path: join(out, 'models.png') });
check(w.errors.length === 0, `no console/page errors${w.errors.length ? ':\n   ' + w.errors.join('\n   ') : ''}`);
await browser.close();
await server.close();
done();
