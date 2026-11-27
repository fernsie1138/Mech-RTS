// Dev stats editor test: open it from Dev, change stats through the inputs, and check they apply at once (to new
// and existing units), show on the build buttons, are remembered after a reload, and reset. No errors.
// Run: node tests/stats.mjs
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
const g = fn => page.evaluate(fn);
const start = async () => {
  await page.waitForFunction(() => window.__game?.ready, null, { timeout: 30000 });
  await page.tap('#btnStart');
  await g(() => { const G = window.__game; G.pause(); G.ai.step = () => {}; });
};
// Type a value into the stats dialog's input for an id (e.g. 'scout.cost').
const setInput = async (id, v) => { const sel = `#statsDialog input[data-id="${id}"]`; await page.fill(sel, String(v)); await page.dispatchEvent(sel, 'change'); };

await page.goto(server.url);
await start();
await page.tap('#btnDev');
check(await page.isVisible('#btnStats'), 'Dev has a Stats button');
await page.tap('#btnStats');
check(await page.isVisible('#statsDialog'), 'it opens the unit stats dialog');
const cols = await g(() => [...document.querySelectorAll('#statsDialog table:first-of-type tr:first-child th')].map(t => t.textContent).filter(Boolean));
const rows = await g(() => [...document.querySelectorAll('#statsDialog table:first-of-type tr th:first-child')].map(t => t.textContent).filter(Boolean));
check(['Light', 'Medium', 'Heavy', 'Assault', 'Builder', 'Turret', 'HQ'].every(c => cols.includes(c)), `columns for every unit (${cols.join(', ')})`);
check(['Cost (⚡)', 'Build time (s)', 'Speed', 'Strength (hp)', 'Damage', 'Sight'].every(r => rows.includes(r)), `rows include cost, build time, speed, strength, damage, sight (+ ${rows.length - 6} more)`);
await page.screenshot({ path: join(out, 'stats-dialog.png') });

// Change some stats.
const assault0 = await g(() => { const a = window.__game.units.list.find(u => u.team === 0 && u.type === 'assault'); return { hp: a.hp, max: a.maxHp }; });
await setInput('scout.cost', 55);
await setInput('scout.speed', 18);
await setInput('assault.hp', 720);
await setInput('titan.dmg', 300);
await setInput('scout.sight', 60);
await setInput('turret.cost', 99);
await setInput('economy.baseIncome', 12);
const r = await g(() => {
  const G = window.__game, C = G.config, a = G.units.list.find(u => u.team === 0 && u.type === 'assault'), s = G.units.list.find(u => u.team === 0 && u.type === 'scout');
  return { cost: C.UNIT_TYPES.scout.cost, card: document.querySelector('.card[data-type="scout"] .cost').textContent, speed: s.mover.speedMult * 9, sm: s.mover.speedMult,
    ahp: a.hp, amax: a.maxHp, tdmg: C.UNIT_TYPES.titan.dmg, sight: C.UNIT_TYPES.scout.sight, turret: C.BUILD.turret.cost, turretBtn: document.querySelector('[data-build="turret"] .c').textContent, inc: G.match.income(0),
    mod: document.querySelectorAll('#statsDialog input.mod').length };
});
check(r.cost === 55 && r.card === '⚡55', `Scout cost changed to 55, and the build button shows it (${r.card})`);
check(Math.abs(r.speed - 18) < 1e-6, `Scouts already on the map move at the new speed (${r.speed.toFixed(1)})`);
check(r.amax === 720 && Math.abs(r.ahp / r.amax - assault0.hp / assault0.max) < 1e-9, `Assault strength 720: the one on the map now has ${r.ahp.toFixed(0)}/${r.amax}`);
check(r.tdmg === 300 && r.sight === 60 && r.turret === 99 && r.turretBtn === '⚡99', 'Titan damage, Scout sight and the turret price change too');
check(r.inc === 12, `economy values change (income now +${r.inc}/s)`);
check(r.mod === 7, `changed values are highlighted (${r.mod})`);
const bad = await g(() => { const i = document.querySelector('#statsDialog input[data-id="scout.hp"]'); i.value = 'abc'; i.dispatchEvent(new Event('change', { bubbles: true })); return { v: i.value, hp: window.__game.config.UNIT_TYPES.scout.hp }; });
check(bad.hp === 140 && bad.v === '140', 'a value that isn\'t a number is ignored');
// A new Scout gets the new stats; queuing costs the new price.
const q = await g(() => { const G = window.__game, m = G.match, c0 = m.teams[0].credits; m.enqueue(0, 'scout'); return c0 - m.teams[0].credits; });
check(Math.abs(q - 55) < 1e-6, `building a Scout now costs ${q}`);
await page.tap('#statsDone');
check(!(await page.isVisible('#statsDialog')), 'Done closes it');

// Remembered after a reload; the new match uses them.
await page.reload();
await start();
const kept = await g(() => { const C = window.__game.config; return [C.UNIT_TYPES.scout.cost, C.UNIT_TYPES.assault.hp, C.UNIT_TYPES.titan.dmg, window.__game.units.list.find(u => u.type === 'assault' && u.team === 0).maxHp, document.querySelector('.card[data-type="scout"] .cost').textContent]; });
check(kept[0] === 55 && kept[1] === 720 && kept[2] === 300 && kept[3] === 720 && kept[4] === '⚡55', `the changes are remembered after a reload (${kept.join(', ')})`);
// Reset.
await page.tap('#btnDev');
await page.tap('#btnStats');
await page.tap('#statsReset');
const back = await g(() => { const C = window.__game.config; return [C.UNIT_TYPES.scout.cost, C.UNIT_TYPES.assault.hp, C.UNIT_TYPES.titan.dmg, C.UNIT_TYPES.scout.sight, C.BUILD.turret.cost, C.ECONOMY.baseIncome, document.querySelectorAll('#statsDialog input.mod').length]; });
check(back.join() === '100,360,75,46,180,6,0', `Reset to defaults puts everything back (${back.join(', ')})`);

// On a phone (Mobile Mode) the dialog fits.
const pctx = await browser.newContext({ ...devices['iPhone 13 landscape'] });
const pp = await pctx.newPage();
await pp.goto(server.url);
await pp.waitForFunction(() => window.__game?.ready, null, { timeout: 30000 });
await pp.evaluate(() => window.__game.statsEditor.open());
const fit = await pp.evaluate(() => { const r = document.querySelector('#statsDialog .box').getBoundingClientRect(), d = document.getElementById('statsDone').getBoundingClientRect(); return r.top >= 0 && r.bottom <= innerHeight && d.bottom <= innerHeight && d.right <= innerWidth; });
await pp.screenshot({ path: join(out, 'stats-phone.png') });
check(fit, 'on a phone the stats dialog fits on screen (its table scrolls)');
await pctx.close();

check(w.errors.length === 0, `no console/page errors${w.errors.length ? ':\n   ' + w.errors.join('\n   ') : ''}`);
await browser.close();
await server.close();
done();
