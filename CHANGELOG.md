# Changelog

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
