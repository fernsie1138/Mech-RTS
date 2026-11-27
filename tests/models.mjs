// David's models for the Heavy Mech (assets/heavy-mech.gltf) and the auto turret (assets/turret.gltf): they load,
// are drawn for every Heavy Mech, turret and wreck, are the right size, walk (legs move), turn their torso / head,
// and shots come out of the gun barrels. No errors.
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
const loaded = await page.waitForFunction(() => { const M = window.__game.mechView.models; return M.assault.ready && M.turret.ready; }, null, { timeout: 30000 }).then(() => true, () => false);
check(loaded, 'both models load');

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
check(Math.abs(r.h - 4.14) < 0.5 && r.wide > 2 && r.wide < 4.5 && Math.abs(r.footY) < 0.2, `the Heavy Mech is ${r.h.toFixed(2)} tall and ${r.wide.toFixed(2)} wide, feet on the ground`);
check(Math.abs(r.th - 3.4) < 0.3, `the turret is ${r.th.toFixed(2)} tall`);
check(r.mz.every(d => d < 0.4), `Heavy Mech shots come out of its forearm guns (${r.mz.map(d => d.toFixed(2)).join(', ')} from the barrels), with the torso turned`);
check(r.tz.every(d => d < 0.3), `turret shots come out of its barrels (${r.tz.map(d => d.toFixed(2)).join(', ')}), with the head turned`);
check(r.legMoved > 0.1, `the legs move as it walks (foot moved ${r.legMoved.toFixed(2)})`);
check(r.wreck === 1 && r.wrecks === 1, 'a destroyed Heavy Mech is drawn as a wreck with the model');
await page.evaluate(() => { const G = window.__game, w0 = G.units.wrecks[0]; G.rts.target.set(w0.x + 5, w0.y + 2, w0.z); G.rts.distance = 22; G.rts.update(0); G.render(); });
await page.screenshot({ path: join(out, 'models.png') });
check(w.errors.length === 0, `no console/page errors${w.errors.length ? ':\n   ' + w.errors.join('\n   ') : ''}`);
await browser.close();
await server.close();
done();
