# Changelog

## v10 — Milestone 7: mechs and combat
- Mechs from the prototype, rebuilt on the new terrain: **Scout** (fast, machine gun), **Assault** (twin cannons, small splash), **Titan** (slow, arcing shells with a big splash). Walking legs, and a torso that turns on its own so mechs fire on the move. All mech parts are one instanced mesh; health bars show once a mech is hurt.
- Every weapon damages the ground as it does to units: machine-gun fire scuffs it, cannons dig small craters, shells dig big ones, knock trees flat and set them alight. Misses land beside the target. Destroyed mechs explode and leave a burning wreck.
- Line of sight: hills and standing walls block direct fire (trees don't). Cover: mechs in forest, on rubble or behind a wall are harder to hit. High ground makes hits easier.
- Titans fire over hills, but only at enemies their side can see: any friendly mech that spots an enemy (within 40) lets the Titans shell it. Shells land where the target was, so a running Scout can dodge them.
- Titans flatten trees as they walk through forest.
- Controls: tap a mech to select it, **double-tap** to select all of that type on screen, **one-finger drag** to box-select (two fingers move the camera). Tap the ground to send them; **A-Move** (default: stop to fight anything on the way) toggles to **Move** (ignore enemies). Tap an enemy to attack it (they chase it and shoot only that). **+Enemy** brings an enemy squad for testing. Idle mechs guard where they stand.
- Pinch zoom now zooms around your fingers instead of the screen centre, so the ground stays under them.
- Tests: `tests/units-unit.mjs`, `tests/combat.mjs`.

## v9 — Bigger explosions, fires and drifting smoke; rotate and move buildings
- Explosions rebuilt as pooled particles (one instanced mesh per kind): a flash that lights up the ground, a rolling fireball, a shockwave ring, showers of sparks, tumbling and bouncing debris (some trailing smoke), dust thrown out along the ground, and a billowing smoke column that lingers 6-10 s and drifts sideways on the wind.
- Buildings that are hit catch fire for 6-12 s (flames and smoke; a fire goes out if its wall falls) and shed debris in their own colours; some rubble smoulders.
- Trees caught in a blast burn for a few seconds and are left charred (a few still catch properly and can spread, as before). Burning trees give off drifting smoke.
- Editor: a selected building shows its name and angle; turn it live with the **Angle** slider (or ⟲ / ⟳ 15°); **drag** it with one finger to move it. The angle also applies to the next building you place. All undoable.
- Tests: `tests/effects.mjs`.

## v8 — Milestone 6: nav grid and pathfinding
- Nav grid (1 cell per unit, 256 x 256) with a movement cost per unit size (Scout / Assault / Titan): slope (steep ground is a slow scramble, cliffs over 1.9 block everyone), deep water blocks, shallow water slows, intact road is faster, rubble slows, buildings block with clearance by size (Scouts fit through 3-unit gaps, Titans need 7), dense forest stops Assaults (Scouts squeeze through, Titans push through), bridge decks carry units over rivers until destroyed.
- Only cells touched by craters, rubble, flooding, falling / burnt trees and collapsing buildings are recomputed; incremental updates match a full rebuild exactly.
- A* paths (8-way, no corner cutting) smoothed without cutting across slower ground; unreachable goals go to the closest reachable point.
- Test units (placeholders until mechs arrive): follow paths at their class speed, re-plan when the ground on their route changes or they stop making progress, steer round each other, spread into a formation at the target, and always escape if a crater or rubble lands on them.
- Game: **Move** mode (default): tap the ground to send the selected units, tap a unit to select it, **All**, **+Squad**. **Nav** button tints ground the selected unit can't cross (red) or crosses slowly (yellow). Path lines show the route.
- Fixed: forest lookups near the map edge counted some trees twice.
- Tests: `tests/nav-unit.mjs`, `tests/nav.mjs`.

## v7 — Milestone 5: buildings, rubble and bridges
- Modular buildings: house, factory, bunker, wall, bridge. Each is made of pieces (wall tiles in rows, roof, floor, blocks, deck, pillars, rails) with their own hit points, drawn with 2 instanced meshes.
- Pieces rest on supports: knocking out a lower wall tile drops the one above (holes); the roof falls when half its walls are gone; a bridge deck falls when its pillars go. Buildings go intact -> damaged -> ruin -> rubble. Falling pieces tumble down.
- Rubble: fallen pieces raise a real rubble mound in the terrain (a collapsed house leaves a heap ~1.7 high), painted as rubble with loose chunks. It is cover and an obstacle, and shells dig into it.
- Bridges: placed automatically where roads cross rivers (import and older maps); walkable deck (`deckAt`) for units later; shelling the middle cuts the crossing.
- Weapons damage buildings (MG chips, cannon breaks tiles, shells wreck houses; a bunker takes ~17 shells). Tapping a building fires at the building itself; bursts above the ground don't crater it.
- Editor: House, Factory, Bunker, Wall, Bridge tools (tap to place on levelled ground, tap a building to select), rotate 15°, Delete, Fill lots (builds on the red building areas). All undoable.
- Map format v3 stores buildings (v2 maps get bridges at road crossings). Sample map: a town of houses, a bridge, bunkers by the HQs and a wall.
- Tests: `tests/buildings-unit.mjs`, `tests/buildings.mjs`.

## v6 — Fix: "map formatVersion 2 is newer than this game supports"
- Cause: Safari kept old cached copies of the game's modules (GitHub Pages lets browsers cache files for up to 10 minutes) while loading the new map, so old code met a new map file.
- Every module is now loaded through an import map with `?v=N` on every file, so a new version always fetches all-new code. `node tools/bump-version.mjs vN` updates the version, labels and import maps in one step.
- If old cached code still meets a newer map, the game / editor reloads itself once with a fresh URL instead of showing the error.
- Smoke test checks every module is versioned and simulates a stale cache.

## v5 — Milestone 4: water, trees and roads
- Rivers hold water: the level is worked out from the river layer and the bank heights, so rivers follow the land. Drawn with a chunked water surface, shaded by depth. Rivers are mostly deep (impassable for mechs later), shallow at the edges.
- Flooding: a crater beside water that dips below its level fills (water pours over low lips in the blast area). Floods stay local, so one shell can't drain a river over a whole plain; a chain of craters floods one crater at a time.
- Trees: instanced low-poly conifers and broadleaf trees placed in forest areas (475 on the sample map). Blasts shatter nearby trees to stumps, knock others flat away from the blast and can set them alight. Fires spread slowly to neighbours, burn out to stumps and scorch the ground. Hooks ready for Titans crushing trees and for forest cover.
- Map format v2 stores the tree list (v1 maps are upgraded by planting trees in their forest areas). Imported rivers are carved with steeper banks so they run nearly full.
- Editor tools: **River** (draw a channel that fills with water), **Road** (flatten and paint), **Forest** (spray trees), **Tree** (tap one, or drag a row), **Erase** (trees, water, roads). All undoable; tool panel is now two columns.
- Save / Test serialise faster (layers compressed in parallel, one serialisation for Test).
- Debug overlay shows water triangles and tree counts.
- Tests: `tests/world-unit.mjs`, `tests/world.mjs`.

## v4 — Milestone 3: map import and editor (part 1)
- Map files: one JSON per map (`maps/*.json`, listed in `maps/index.json`) with versioned format and gzipped height / ground / feature layers (~220 KB). Matches never modify the file.
- Image import (height map + feature map, see `maps/README.md`): rivers carve channels (and keep flowing under road crossings), roads flatten and paint, forests / building areas are recorded (shown as ground tints until trees and buildings arrive), capture points and HQs are found from coloured dots and squares, HQ pads are flattened.
- Sample map "River Crossing" built from `maps/sample-height.png` + `maps/sample-features.png`; the game now opens it by default (`?map=<id>` picks another).
- Map editor (`editor.html`): Raise / Lower / Flatten / Smooth brushes with size and strength; Player HQ / Enemy HQ / Capture point tools; undo / redo (also Ctrl/Cmd+Z); New, Open (built-in or from file), Import images, Save (download), rename; autosave; **Test ▶** opens the current map in the game and **◀ Editor** comes back.
- Editor touch: one finger paints, two fingers pan / pinch / rotate. Mouse: left paints, right or middle drag pans.
- Game: HQ and capture-point markers, an Editor button, the map name, a loading message and readable load errors. The map edge has an earth wall so hills at the border don't float.
- Tests: `tests/maps-unit.mjs`, `tests/editor-unit.mjs`, `tests/editor.mjs`.

## v3 — Milestone 2: deformable terrain
- Height grid terrain: 256 x 256 world units, 512 x 512 cells (0.5 units each), drawn as 64 chunks. Only chunks touched by damage are rebuilt, at most 4 per frame, reusing their buffers.
- Placeholder test landscape (until map import): rolling hills, a mountain (NE) with a snowy peak, a long ridge (NW), a dry riverbed and a road.
- Craters with a raised rim, sized per weapon (MG / Cannon / Shell). Repeated hits wear down peaks and ridges; material slides when a slope gets too steep; nothing digs below bedrock; the map edge can't be holed.
- Surface wear and a permanent damage map: grass churns to dirt, then torn earth; blasts leave scorch marks; craters break the road.
- Test-fire toolbar: tap the ground to fire the selected weapon, Barrage drops 24 shells around the view centre, Reset restores the map. Keys: 1/2/3 select, B barrage.
- Pooled explosion effects (flash, smoke, debris).
- Camera: two-finger twist rotates (Q/E on keyboard), follows the ground height, never dips into hills.
- Tests: `node tests/terrain-unit.mjs` (numerical crater/erosion/bedrock/slope/wear checks) and `node tests/terrain.mjs` (browser: chunk rebuilds, seams, tap-to-fire, buttons).

## v2 — Milestone 1: project setup
- New game entry `index.html` loading plain ES modules from `src/`; three.js r170 vendored in `lib/` (no CDN).
- Placeholder scene (flat ground, markers) with one shadow-casting sun whose shadow area follows the camera.
- RTS camera: one-finger drag pans (ground stays under the finger), pinch zooms; mouse drag/wheel and WASD/arrows/+/- on desktop.
- Debug overlay (fps, frame time, draw calls, triangles) toggled by the **FPS** button or the ` key.
- Version label bottom-right; turns red with a "stale cache" note if the page and the JS come from different builds.
- Add to Home Screen support: web app manifest, icons, full-screen meta tags. Page zoom, scroll and long-press callouts blocked.
- Errors during load are shown on screen.
- Test hook `window.__game` (pause, step, render, stats) and headless test harness: `node tests/smoke.mjs`.

## prototype v1
- Single-file three.js prototype (`prototype/index.html`): Scout/Assault/Titan mechs with walking legs and independent torso aiming, HQ production, 5 capture points, enemy AI waves, touch + mouse controls, minimap. Flat terrain only — reference for the real build described in CLAUDE.md.
