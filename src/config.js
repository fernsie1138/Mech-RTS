// Tunable numbers. Gameplay values (unit stats, damage, costs) will be added here as systems arrive.

export const MAP_SIZE = 256;          // world units across. Mechs are ~3-6 units tall, ranges 18-32.

export const TERRAIN = {
  cells: 512,                         // height grid cells per side -> 0.5 world units per cell
  chunkCells: 64,                     // cells per chunk side -> 8 x 8 = 64 chunk meshes
  maxRebuildsPerFrame: 4,
  bedrock: -8,                        // nothing digs below this height
  maxSlope: 1.6,                      // rise/run; steeper slopes slide after a hit
};

// How each weapon damages the ground. radius/depth in world units.
//   rim: rim height as a fraction of depth   erode: how much a hit flattens peaks/ridges (0..1)
//   wear: damage added at the centre (1 = grass fully churned to dirt)   scorch: burn added (0..1)
//   wearRadius: wear/scorch radius as a multiple of crater radius   fxSize: explosion effect size
//   treeFall: trees within this radius are knocked flat (inner 45% shattered to stumps)   ignite: chance to set trees alight
export const TERRAIN_DAMAGE = {
  mg:     { radius: 0.7, depth: 0.06, rim: 0,   erode: 0,    wear: 0.35, scorch: 0.15, wearRadius: 1.4, fxSize: 0.35, treeFall: 0,   ignite: 0.03 },
  cannon: { radius: 1.8, depth: 0.7,  rim: 0.3, erode: 0.25, wear: 1.2,  scorch: 0.3,  wearRadius: 1.8, fxSize: 1.2,  treeFall: 3,   ignite: 0.15 },
  shell:  { radius: 3.6, depth: 1.7,  rim: 0.3, erode: 0.4,  wear: 1.6,  scorch: 0.45, wearRadius: 1.8, fxSize: 2.6,  treeFall: 6.5, ignite: 0.4 },
};

export const RENDER = {
  maxPixelRatio: 2,
  shadowMapSize: 2048,
  shadowArea: 70,                     // half-size of the shadow camera box, follows the camera target
};

export const CAMERA = {
  fov: 45,
  pitchDeg: 55,                       // angle down from horizontal
  minDistance: 20,
  maxDistance: 240,
  startDistance: 120,
  minClearance: 4,                    // camera stays at least this far above the ground under it
  keyPanSpeed: 1.2,                   // fraction of camera distance per second
  keyRotateSpeed: 1.6,                // radians per second (Q / E)
  wheelZoomFactor: 0.0015,
  tapMaxMove: 12,                     // pixels: a touch that moves less than this is a tap
  tapMaxTime: 350,                    // ms
  doubleTapMs: 400,                   // a second tap on the same type within this selects all of that type
  strokeHoldMs: 120,                  // editor: a finger held this long without moving starts painting
};

export const SIM = {
  stepSeconds: 1 / 60,                // fixed simulation step
  maxStepsPerFrame: 5,
};

// ---------------- units and combat (milestone 7) ----------------
// From the prototype, rebalanced a little for the new terrain. cls = nav size class (0 small, 1 medium, 2 large).
//   hp, speed (from MOVE.speeds via cls), range, dmg per hit, rof (seconds between shots), proj = weapon
//   (also its TERRAIN_DAMAGE profile), projSpeed, splash (radius of damage to units), scale (model size),
//   turn (rad/s legs), spread (miss distance), indirect (lobs shells over obstacles).
export const UNIT_TYPES = {
  scout:   { name: 'Scout',   cls: 0, cost: 100, build: 4,  hp: 140, range: 18, dmg: 9,   rof: 0.22, proj: 'mg',     projSpeed: 90, splash: 0,   scale: 0.8,  turn: 6, accuracy: 0.75 },
  assault: { name: 'Assault', cls: 1, cost: 220, build: 7,  hp: 360, range: 23, dmg: 28,  rof: 0.9,  proj: 'cannon', projSpeed: 60, splash: 1.5, scale: 1.15, turn: 4, accuracy: 0.8 },
  titan:   { name: 'Titan',   cls: 2, cost: 420, build: 12, hp: 950, range: 32, dmg: 110, rof: 2.6,  proj: 'shell',  projSpeed: 20, splash: 5,   scale: 1.6,  turn: 2, accuracy: 1, indirect: true },
};
export const UNIT_KEYS = ['scout', 'assault', 'titan'];

export const COMBAT = {
  retarget: 0.35,            // seconds between target searches
  eyeHeight: 0.8,            // line-of-sight eye height, as a fraction of the mech's height
  forestCover: 0.45,         // hit chance x (1 - cover) inside full forest
  rubbleCover: 0.3,          // ... on a rubble heap / against a ruined wall
  highGround: 0.15,          // +hit chance per 4 units of height above the target (capped at 2x this)
  shellSpread: 1.5,          // Titan shells land within this of the aim point
  sightRange: 40,            // how far a mech spots enemies (for itself and for friendly Titans)
  chaseRange: 12,            // attack-move / idle units go after enemies within range + this
  guardRadius: 30,           // idle units chase this far from where they were left
  wreckTime: 40,             // seconds a wreck stays before sinking away
};
