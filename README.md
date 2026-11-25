# Mech RTS

A three.js real-time strategy game where mechs fight across hand-designed, fully destructible landscapes. Built for Safari on iPad.

- Play: https://fernsie1138.github.io/Mech-RTS/ (once GitHub Pages is enabled)
- Design and plan: [CLAUDE.md](CLAUDE.md)
- Changes: [CHANGELOG.md](CHANGELOG.md)
- Early prototype (flat terrain): [prototype/index.html](prototype/index.html)

## Tests

Headless tests use Playwright with Chromium and a built-in static server (no install step needed where Playwright is present):

```bash
node tests/smoke.mjs
```

Screenshots are written to `tests/out/` (not committed).
