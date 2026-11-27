# Mech RTS — Design Document

Working title: **Mech RTS** (final name TBD).

This file is read by Claude at the start of every session. It describes what we are building, how it is built, and how work is done on this project. Keep it up to date when decisions change.

---

## 1. Vision

A real-time strategy game where squads of mechs fight across **hand-designed, fully destructible 3D landscapes**. Mountains, rivers, forests, roads and buildings all take damage. Over the course of a battle the map is ground down, bit by bit, from a living landscape into a cratered, burned, rubble-strewn wasteland. The changing terrain is the core of the game: cover disappears, new paths open, rivers flood craters and bridges fall.

Built with **three.js**, played in **Safari on iPad** (touch first), with mouse and keyboard also supported.

---

## 2. About the developer and how to work

- The developer (David) builds and tests on an **iPad**. He tests every build in Safari and gives specific, concrete feedback from actually playing.
- He describes himself as a **novice with command-line tools**. Any setup step he has to do himself (GitHub, Pages, settings) must be given as **exact, numbered, step-by-step instructions** with no assumed knowledge.
- **Never claim a fix works without verifying it.** Verify with a test script, numerical checks or a headless runtime simulation (see §11) before reporting something as done. Say plainly what was and wasn't verified, especially anything that can only be checked on a real iPad (touch feel, performance).
- Keep a visible **version label** in the game UI (e.g. `v12`) and bump it with every change, so David can confirm Safari isn't showing a cached build.
  Bump with `node tools/bump-version.mjs vN`: it also versions every module URL in the import maps, which is what stops Safari mixing cached old modules with new ones. Never add a module without re-running it (the smoke test checks).
- Add a short entry to `CHANGELOG.md` for every version.

---

## 3. Platform and technical constraints

- **Target:** Safari on iPad, hosted on **GitHub Pages**. Phones are supported through **Mobile Mode** (a compact UI, on by default on phone-sized screens; `tests/mobile.mjs` checks nothing overlaps in landscape or portrait). It must run from the Pages URL with no server-side code.
- **No build step.** Plain ES modules loaded by the browser. three.js is loaded through an `importmap`. Prefer a **vendored copy** of three.js in `lib/` so the game doesn't depend on a CDN.
- ES modules don't load from `file://` in Safari, so testing always happens through Pages (or a local server in headless tests).
- Safari on iPad blocks the Fullscreen API in normal tabs. Support **Add to Home Screen** (web app manifest plus `apple-mobile-web-app-capable`) for full-screen play.
- Prevent page zoom, scrolling and long-press callouts during play (`touch-action: none`, block `gesturestart`).
- **Performance is the main constraint.** Design every system to fit the budget in §10.

---

## 4. Code structure

```
index.html            game entry (importmap, canvas, HUD)
editor.html           map editor entry
style.css             styles shared by both pages
lib/three.module.js   vendored three.js
src/
  main.js             game bootstrap and loop
  view.js             renderer, scene, lights, camera and terrain shared by game and editor
  config.js           tunable numbers (unit stats, damage, costs)
  version.js          version label (bump every change)
  terrain/
    heightfield.js    height grid data, sampling, deformation
    chunks.js         chunked terrain meshes, rebuild of dirty chunks
    surface.js        surface paint layers (grass/dirt/scorch/road)
    water.js          rivers, water level, flooding
    watermesh.js      chunked water surface
  world/
    forest.js         tree data, placement, damage states, fire (no three.js)
    trees.js          instanced tree rendering
    markers.js        HQ and capture-point markers
    buildings.js      modular destructible buildings, bridges and rubble (no three.js)
    buildingview.js   instanced building rendering (blast marks, holes and framework in its shader)
    shapes.js         unit shapes for building pieces and the HQ (sloped panel, roof slab, buttress, ...)
    construction.js   Builders' jobs: walls, auto turrets, trenches (no three.js)
    fogview.js        fog of war drawing: a fog texture every material samples
    decals.js         crater and rubble pictures (assets/craters.png, assets/rubble.png; tools/make-craters.mjs, make-rubble.mjs) baked into a ground texture; every stamp logged for saves
    props.js          rocks, debris, wrecks
  nav/
    navgrid.js        walkability/cost grid, updated as terrain changes
    pathfinding.js    A* and/or flow fields
  units/
    movers.js         path following, re-planning, unsticking, separation (no three.js)
    units.js          mechs: orders, targeting, facing, firing, wrecks (no three.js; stats in config.js)
    mech.js           instanced mech models, walk animation, selection rings, health bars, tracers
    mediummech.js     the Medium Mech's model (assets/medium-mech.gltf): instanced parts, digitigrade walk, painted look
    modelview.js      glTF models with named parts (Light, Heavy and Assault Mechs, turret: assets/*.gltf): instanced parts, walk, torso turn
  combat/
    projectiles.js    bullets, cannon rounds and arcing shells (no three.js)
    los.js            line of sight (terrain and walls), cover (forest, rubble, walls)
    damage.js         single entry point for all damage to units and terrain
    effects.js        explosions, smoke, fire, sparks (pooled)
  game/match.js       credits, income, HQ build queues, capture points, win/lose (no three.js)
  game/vision.js      fog of war: who sees whom (line of sight), seen/explored ground grid (no three.js)
  game/savegame.js    save the whole battle to a JSON file and load it back (Pause menu; loading reloads the page with ?resume)
  ai/enemy.js         enemy AI: build mix, waves at capture points and the HQ, base defence (no three.js)
  ui/camera.js        RTS camera and touch/mouse gestures
  ui/command.js       selection (tap, double tap, box drag) and orders
  ui/hud.js           match HUD: resources, build buttons, banners, start and end screens
  ui/minimap.js       minimap from the live terrain, tap to jump
  ui/mobile.js        Mobile Mode toggle, game and editor (compact UI for phones; CSS under body.mobile in each page)
  ui/stats.js         Dev: edit every unit's stats live (saved on the device)
  maps/
    loader.js         loads map files (maps/, uploaded file, editor hand-off), decodes images
    imageimport.js    image import format (§7.1)
    format.js         map file schema and versioning
editor/
  editor.js, history.js, tools/*.js
maps/                 map files (*.json), index.json listing them, and source images
tools/                scripts that generate files (e.g. the sample map)
tests/                headless test scripts (see §11)
```

The game opens a match by default; `index.html?sandbox` is the combat sandbox (no AI, test tools showing), which most browser tests use. The Pause button (top right) opens Resume / Save game / Load game. A saved game is one JSON file (`game/savegame.js`); add any new piece of game state to it.

Keep files focused. **All damage**, to units or to the world, goes through `combat/damage.js`, so terrain destruction stays consistent.

---

## 5. Terrain system

### 5.1 Heightfield
- The terrain is a **height grid** (for example 512 × 512 samples over the map area; resolution is tunable).
- It is drawn as **chunks** (for example 32 × 32 samples each). Deformation marks chunks as dirty, and only dirty chunks are rebuilt, at most a few per frame.
- Every system (units, projectiles, trees, buildings, water) samples height through one function: `heightAt(x, z)`.

### 5.2 Destruction
- Explosions dig **craters** by lowering height in a radius, with a raised rim. The size scales with the weapon. Craters are shallow (a shell digs about 0.8), and in a match the ground never goes more than `TERRAIN.maxDig` (1.5) below where it began.
- Each cannon or shell crater also stamps one of six crater pictures (random, at a random angle) into a ground texture over the whole map, so the art stays where it hit.
- Repeated hits **erode** mountains and ridges, so sustained artillery can wear a ridge down.
- Clamp deformation so the terrain stays sane: a minimum height (bedrock) and a maximum slope created per hit.

### 5.3 Surface wear
- A **surface layer** records what the ground looks like: grass, dirt, mud, road, scorched or rubble.
- Damage pushes the surface toward wasteland: grass, then dirt, then scorched and cratered.
- A cumulative **damage map** is stored, so the landscape visibly degrades over the battle and never fully heals.

### 5.4 Water and rivers
- Rivers are carved channels with a water surface at a set level.
- **Craters next to water flood**: if a crater connects to water and sits below the water level, it fills.
- Water affects movement: shallow water is slow and deep water is impassable for mechs.

---

## 6. World objects

### 6.1 Trees and forests
- Drawn with **InstancedMesh** to allow thousands of trees.
- Damage states: standing → knocked flat → burning → stump/ash.
- Large mechs (Titans) flatten trees by walking through them.
- Forests give **cover** (concealment and/or reduced accuracy against units inside).

### 6.2 Buildings
- Built from **modular pieces** (walls, floors, roofs) so they break apart in stages, not all at once.
- Damage states: intact → damaged (holes, missing sections) → ruin → rubble pile.
- Each piece has its own three stages: blast marks where hit → broken (below half strength: a jagged hole showing its framework) → blown away. Chips pile up at the foot of a wall as it is hit.
- Look: simple sci-fi structures (sloped armour panels, chamfered corners, buttresses, flat sloped roofs; no pitched roofs). Shapes are in `world/shapes.js`.
- Rubble stays in the world as **cover and an obstacle**, and updates the nav grid. Rubble heap pictures are baked into the ground round damaged buildings.
- Types to start with: houses, factory, bunker, walls, bridges. Bridges can be destroyed, which cuts the river crossing.

### 6.3 Roads
- Painted into the surface layer and slightly flattened into the terrain.
- Faster movement on intact road. Craters break the road and remove the bonus at that spot.

---

## 7. Maps

Every map is **unique and hand-designed**. There are two ways to make one, and they work together.

### 7.1 Image import (rough landscape)
Two PNG images of the same size (512 × 512 recommended):

**Height map**: greyscale. Black = lowest ground (riverbeds, valleys), white = highest (peaks), mid-grey = ordinary flat ground.

**Feature map**: flat colours, no blending or anti-aliasing (the importer snaps each pixel to the nearest key colour):

| Colour | Meaning |
|---|---|
| Blue | River / water |
| Dark green | Dense forest |
| Light green | Scattered trees |
| Grey | Road |
| Red | Building area (buildings get placed in the editor) |
| Yellow dot | Capture point |
| White square | Player HQ position |
| Black square | Enemy HQ position |
| Anything else | Open ground |

The importer turns these into a map file, which is then refined in the editor.

### 7.2 Map editor (detail)
A separate page (`editor.html`), designed for **touch on iPad**:
- **Terrain brushes:** raise, lower, flatten, smooth, with adjustable size and strength.
- **Rivers and roads:** drawn as paths with a finger. Rivers carve their channel and roads flatten and paint the ground.
- **Forests:** density spray brush, single-tree placement and an eraser.
- **Buildings:** place from a palette, rotate and scale.
- **Gameplay layer:** HQ positions, capture points, start positions.
- **Undo/redo.**
- **Test button:** jumps straight into a match on the current map.
- **Save/load:** exports a map file to download (to be committed to `maps/`), and can import the two images from §7.1.

### 7.3 Map file
- One JSON file per map. The height grid, the per-sample layers (ground type, feature bits) and the tree list are embedded in it as gzipped, base64 blobs, so a map is a single file to save and move around on the iPad (~220 KB). It holds terrain, surface, water, trees, buildings, roads and gameplay markers.
- Built-in maps are listed in `maps/index.json`; the game loads `index.html?map=<id>` (default `sample`).
- It includes a `formatVersion` field so older maps can be upgraded.
- **A match never modifies the map file.** Destruction happens on an in-memory copy.

---

## 8. Movement and pathfinding

- A **nav grid** sits over the map. Each cell gets a movement cost from slope, water depth, surface (road is faster), trees, rubble and buildings.
- When terrain or objects change, only the **affected cells** are updated.
- Paths use A* (or flow fields for large groups). Paths are recomputed when the cells they cross change.
- Unit size matters: Scouts can squeeze through gaps that Titans can't, and Titans can push through light forest.
- Slope limits per class are soft (a slow scramble); only cliffs steeper than 1.9 block everyone. Crater walls never exceed 1.6, so craters can never trap a unit.
- Units must never get stuck in new craters or rubble. This needs automated tests (§11).

---

## 9. Units, combat and AI

The single-file prototype v1 (`prototype/index.html`) contains a working version of the parts below. Reuse its ideas, but rebuild them on the new terrain.

- **Mech classes** (shown names; internal keys in brackets, kept so saved stats and tests still work)
  - **Light Mech** [scout]: fast, machine gun. David's model (`assets/light-mech.gltf`, `units/modelview.js`).
  - **Medium Mech** [medium]: between Light and Heavy; autocannon. David's model (`assets/medium-mech.gltf`, drawn by `units/mediummech.js`): digitigrade legs, walk and crouch animated in code, colours and panel lines painted in the shader.
  - **Heavy Mech** [assault]: twin cannons (forearm guns), scale 1.84 (the tallest). David's model (`assets/heavy-mech.gltf`, drawn by `units/modelview.js`).
  - **Assault Mech** [titan]: slow; fires salvos of small arcing missiles (indirect fire; `salvo` missiles `salvoGap` s apart, together its `dmg`, each with splash) that can miss fast targets. David's model (`assets/assault-mech.gltf`, `units/modelview.js`).
- Mechs have animated walking legs and a **torso that turns independently** of the legs, so they can fire while moving.
- **Builder:** unarmed; builds walls and auto turrets, digs trenches (cover) and repairs friendly mechs, turrets and the HQ (only when ordered: the player picks the target). Walls and trenches are planned first (tap or drag), can be turned in 15° steps, then built. Later: buildings that produce other units (new kinds go in `BUILD` in config.js and `world/construction.js`).
- **Detection factor** (`detect`, % per unit type; Light Mech 75, others 100): an enemy spots a unit only within its own sight × that factor (and with a clear line of sight); fog of war still clears as normal. In a trench it is ×0.8, and never below 40% in total.
- **Spotting:** a unit may fire at any enemy in weapon range that its side has spotted (another unit can spot for it); direct fire still needs its own clear line of fire.
- **Defend** stance: selected mechs crouch and hold; harder to hit (×0.55) and less hurt by splash, stacking with trench cover.
- **Economy:** base income plus capture points that add income. The HQ produces units from a queue.
- **Battle Value (BV)** instead of a unit cap (`bv` per type in config.js): Turret 1, Light 1, Medium 2, Builder 3, Heavy 4, Assault 6. A side's mechs (alive and queued) and turrets may total `ECONOMY.bvStart` (30) + `bvPerPoint` (5) per capture point held.
- **Orders:** move (default: a tap on the ground; mechs always obey it, shoot on the way, then hold their ground without chasing), attack-move (the A-Move toggle: stop to fight anything met), and attack a specific target (a tap on the enemy's body). Touch: tap to select, double-tap to select all of a type, one-finger drag to box-select, two-finger pan, pinch zoom, minimap tap to jump.
- **Enemy AI:** builds a unit mix, sends growing waves at capture points and the HQ, and defends its base.
- Weapons damage terrain as well as units, so every weapon type needs a terrain-damage profile.
- Terrain should affect combat: line of sight is blocked by mountains and buildings, and high ground helps. Titans fire indirectly over obstacles.
- **Fog of war** (on in a match): a side sees an enemy only while one of its units has a clear line of sight to it within its sight range. Ground never seen is black, ground seen before is dimmed, and hidden enemies aren't drawn, tappable or on the minimap. The enemy AI does not use the fog yet (it knows where everything is).

---

## 10. Performance budget (iPad Safari)

The targets below are starting points, to be confirmed on the real device:
- 60 fps target, never below 30 fps in a large battle.
- Up to about 80 mechs on the map.
- Terrain rebuilds limited to a few chunks per frame.
- Trees through InstancedMesh, and effects drawn from **pooled** objects (don't create and destroy meshes per particle).
- Shadows from one directional light, with the shadow area following the camera.
- Device pixel ratio capped at 2.
- Add a debug overlay (fps, draw calls, triangles) that can be toggled from the UI.

---

## 11. Testing and verification

Before reporting any change as working:
- Run a **headless browser test** (Playwright with Chrome) that loads the game, checks that there are no console or page errors, and takes screenshots that Claude inspects.
- Use **runtime simulation** for gameplay logic: step the game forward in time and check numbers (units reach their targets, nothing gets stuck, no NaN positions, the match ends, the economy flows).
- **Terrain tests:** craters change height by the expected amount, dirty chunks rebuild, the nav grid updates after damage, and units route around new obstacles.
- The game exposes a test hook (`window.__game`) for these scripts.
- Clearly flag anything that can only be confirmed on the iPad, such as touch feel, real performance and Safari-only quirks.

---

## 12. Build order (milestones)

Each milestone should end with something David can test on the iPad.

1. **Project setup:** repo structure, vendored three.js, GitHub Pages working, version label, test harness.
2. **Deformable terrain:** chunked heightfield, camera controls, craters from a test "fire" tap, surface wear and the damage map.
3. **Map import and editor (part 1):** image import (§7.1), terrain brushes, save/load, test button.
4. **Water, trees and roads:** rivers and flooding, instanced forests with damage states, roads, plus the matching editor tools.
5. **Buildings:** modular destructible buildings, rubble and bridges, plus editor placement.
6. **Nav grid and pathfinding:** updates as terrain changes, no stuck units.
7. **Mechs and combat:** port the prototype's units, weapons that damage terrain, line of sight and cover.
8. **Economy, capture points, AI and HUD:** a complete playable match.
9. **First hand-designed map,** then polish, sound and balance.

---

## 13. Open decisions

- Final game name.
- Map size in world units and the height-grid resolution. Currently 256 × 256 units with 512 × 512 cells (0.5 units each), drawn as 64 chunks; to be confirmed on the iPad.
- Art direction: realistic, stylised, or the low-poly look of the prototype.
- Whether terrain damage should cost the attacker anything, or be purely a side effect.
- Multiplayer (assumed out of scope for now).
