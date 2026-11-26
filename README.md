# Mech RTS

A three.js real-time strategy game where mechs fight across hand-designed, fully destructible landscapes. Built for Safari on iPad.

- Play: https://fernsie1138.github.io/Mech-RTS/
- Map editor: https://fernsie1138.github.io/Mech-RTS/editor.html (how to make maps: [maps/README.md](maps/README.md))
- Design and plan: [CLAUDE.md](CLAUDE.md)
- Changes: [CHANGELOG.md](CHANGELOG.md)
- Early prototype (flat terrain): [prototype/index.html](prototype/index.html)

## Tests

Headless tests use Playwright with Chromium and a built-in static server (no install step needed where Playwright is present):

```bash
node tests/smoke.mjs
```

```bash
node tests/terrain-unit.mjs
```

```bash
node tests/terrain.mjs
```

```bash
node tests/maps-unit.mjs
```

```bash
node tests/editor-unit.mjs
```

```bash
node tests/editor.mjs
```

```bash
node tests/world-unit.mjs
```

```bash
node tests/world.mjs
```

```bash
node tests/buildings-unit.mjs
```

```bash
node tests/buildings.mjs
```

```bash
node tests/nav-unit.mjs
```

```bash
node tests/nav.mjs
```

```bash
node tests/effects.mjs
```

```bash
node tests/units-unit.mjs
```

```bash
node tests/combat.mjs
```

```bash
node tests/match-unit.mjs
```

```bash
node tests/match.mjs
```

```bash
node tests/builder-unit.mjs
```

```bash
node tests/builder.mjs
```

```bash
node tests/mobile.mjs
```

```bash
node tests/vision-unit.mjs
```

```bash
node tests/fog.mjs
```

```bash
node tests/stats.mjs
```

```bash
node tests/defend-unit.mjs
```

Screenshots are written to `tests/out/` (not committed).
