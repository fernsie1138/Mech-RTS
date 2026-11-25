# Changelog

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
