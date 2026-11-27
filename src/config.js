// Tunable numbers. Gameplay values (unit stats, damage, costs) will be added here as systems arrive.

export const MAP_SIZE = 256;          // world units across. Mechs are ~3-6 units tall, ranges 18-32.

export const TERRAIN = {
  cells: 512,                         // height grid cells per side -> 0.5 world units per cell
  chunkCells: 64,                     // cells per chunk side -> 8 x 8 = 64 chunk meshes
  maxRebuildsPerFrame: 4,
  bedrock: -8,                        // nothing digs below this height
  maxSlope: 1.6,                      // rise/run; steeper slopes slide after a hit
  maxDig: 1.5,                        // in a match, craters never take the ground more than this below where it began
};

// Crater pictures baked into the ground (world/decals.js, assets/craters.png).
export const DECALS = {
  pxPerUnit: 8,                       // ground decal texture resolution: 2048 x 2048 over the map
  scale: 3.4,                         // picture size = crater radius x this (the bowl fills about 60% of it)
  opacity: 0.95,
  minDepth: 0.2,                      // weapons that dig at least this deep leave a crater picture (not MG)
};

// How each weapon damages the ground. radius/depth in world units.
//   rim: rim height as a fraction of depth   erode: how much a hit flattens peaks/ridges (0..1)
//   wear: damage added at the centre (1 = grass fully churned to dirt)   scorch: burn added (0..1)
//   wearRadius: wear/scorch radius as a multiple of crater radius   fxSize: explosion effect size
//   treeFall: trees within this radius are knocked flat (inner 45% shattered to stumps)   ignite: chance to set trees alight
export const TERRAIN_DAMAGE = {
  mg:     { radius: 0.7, depth: 0.03, rim: 0,   erode: 0,    wear: 0.35, scorch: 0.15, wearRadius: 1.4, fxSize: 0.35, treeFall: 0,   ignite: 0.03 },
  autocannon: { radius: 1.0, depth: 0.1, rim: 0.2, erode: 0.05, wear: 0.6, scorch: 0.2, wearRadius: 1.5, fxSize: 0.6, treeFall: 1.2, ignite: 0.06 },
  cannon: { radius: 1.8, depth: 0.3,  rim: 0.3, erode: 0.25, wear: 1.2,  scorch: 0.3,  wearRadius: 1.8, fxSize: 1.2,  treeFall: 3,   ignite: 0.15 },
  shell:  { radius: 3.6, depth: 0.8,  rim: 0.3, erode: 0.6,  wear: 1.6,  scorch: 0.45, wearRadius: 1.8, fxSize: 2.6,  treeFall: 6.5, ignite: 0.4 },
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
//   detect: detection factor, % (100 = normal). An enemy only spots this unit within its sight x detect / 100, so a
//   stealthy 50% unit is seen at half the usual distance. (The enemy still clears the fog of war as normal.)
export const UNIT_TYPES = {
  scout:   { name: 'Light Mech', short: 'Light', cls: 0, detect: 75, cost: 100, build: 4,  hp: 140, range: 18, sight: 46,  dmg: 9,   rof: 0.22, proj: 'mg',     projSpeed: 90, splash: 0,   scale: 0.8,  turn: 6, accuracy: 0.75 },
  // Medium Mech (David's model, units/mediummech.js): between the Light and Heavy. Autocannon, digitigrade legs.
  medium:  { name: 'Medium Mech', short: 'Medium', cls: 1, detect: 100, cost: 160, build: 5.5, hp: 250, range: 21, sight: 40, dmg: 15, rof: 0.45, proj: 'autocannon', projSpeed: 75, splash: 0.6, scale: 1, turn: 5, accuracy: 0.78, speed: 1.25 },
  assault: { name: 'Heavy Mech', short: 'Heavy', cls: 1, detect: 100, cost: 220, build: 7,  hp: 360, range: 23, sight: 36,  dmg: 28,  rof: 0.9,  proj: 'cannon', projSpeed: 60, splash: 1.5, scale: 1.15, turn: 4, accuracy: 0.8 },
  titan:   { name: 'Assault Mech', short: 'Assault', cls: 2, detect: 100, cost: 420, build: 12, hp: 950, range: 32, sight: 34,  dmg: 110, rof: 2.6,  proj: 'shell',  projSpeed: 32, splash: 5,   scale: 1.6,  turn: 2, accuracy: 1, indirect: true },
  // Unarmed: builds walls and turrets and digs trenches (see BUILD). Spots for Titans like any mech.
  builder: { name: 'Builder', short: 'Builder', cls: 0, detect: 100, cost: 150, build: 6,  hp: 220, range: 0, sight: 30,  dmg: 0,   rof: 1,    proj: null,     projSpeed: 0,  splash: 0,   scale: 0.85, turn: 5, accuracy: 0, unarmed: true, speed: 0.7, repair: 25 },   // repair: hp per second it mends
};
// Internal keys stay as they were (saved stats, tests); the names shown are in `name` / `short`:
//   scout = Light Mech, medium = Medium Mech, assault = Heavy Mech, titan = Assault Mech.
export const UNIT_KEYS = ['scout', 'medium', 'assault', 'titan', 'builder'];
export const COMBAT_KEYS = ['scout', 'medium', 'assault', 'titan'];

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
  trenchCover: 0.5,          // hit chance x (1 - this) for a mech standing in a trench
  trenchDetect: 0.8,         // detection factor x this for a unit in a trench (on top of its own)
  minDetect: 0.4,            // no unit's detection factor ever goes below this in total
  defendHit: 0.55,           // Defend stance: incoming hit chance x this (on top of cover, e.g. a trench)
  defendSplash: 0.65,        // ... and splash damage (shells, cannon bursts) x this
  trenchSplash: 0.6,         // splash damage x this for a mech in a trench
};

// ---------------- match: economy, HQs, capture points, enemy AI (milestone 8) ----------------
export const ECONOMY = {
  startCredits: 400,
  baseIncome: 6,             // credits per second
  pointIncome: 3,            // + per capture point held
  queueMax: 8,               // build queue length per HQ
  unitCap: 40,               // mechs per side (alive + queued); 80 in all is the §10 budget
};
// The HQ: produces mechs, defends itself with a twin-cannon turret, and losing it loses the match.
export const HQ_TYPE = { name: 'HQ', cls: 2, detect: 100, hp: 8000, range: 26, sight: 40, dmg: 26, rof: 0.7, proj: 'cannon', projSpeed: 60, splash: 1.5,
  scale: 1, turn: 2.5, accuracy: 0.8, radius: 6.5, height: 12 };
// Auto turret, built by Builders: twin machine guns on a pivot. Shoots enemies in range by itself.
export const TURRET_TYPE = { name: 'Turret', cls: 1, detect: 100, hp: 700, range: 35, sight: 30, dmg: 9, rof: 0.16, proj: 'mg', projSpeed: 90, splash: 0,
  scale: 1, turn: 3, accuracy: 0.75, radius: 1.7, height: 3.4 };

// What Builders make. cost: credits, paid when ordered. work: builder-seconds to finish one (two Builders take half).
//   wall: a 10-unit stone wall (cover; blocks movement and line of sight; can be shot down).
//   turret: an auto turret (TURRET_TYPE).
//   trench: a 10-unit length of trench, ~1.4 deep, with a spoil bank on the side facing the enemy. Mechs in it
//   are harder to hit and partly hidden behind the bank. Longer lines are split into 10-unit pieces.
export const BUILD = {
  wall:   { name: 'Wall',   cost: 60,  work: 8,  len: 10 },
  turret: { name: 'Turret', cost: 180, work: 12 },
  trench: { name: 'Trench', cost: 30,  work: 7,  len: 10, depth: 1.4, halfWidth: 1.7, bank: 0.7 },
  reach: 3,                  // a Builder works from this close to the site
  repairAuto: 10,            // an idle Builder repairs damaged friendly mechs and turrets this close by itself
};
export const BUILD_KEYS = ['wall', 'turret', 'trench'];

export const CAPTURE = {
  radius: 8,                 // mechs inside this ring capture it
  rate: 0.12,                // control per second per mech (up to 3 mechs)
  maxCount: 3,
  decay: 0.05,               // an empty point drifts back to its owner's side at this rate
};
export const AI = {
  think: 1,                  // seconds between decisions
  firstWave: 4,              // mechs in the first attack wave; each wave adds one, up to maxWave
  maxWave: 14,
  defendRadius: 42,          // enemies this close to its HQ make it defend
  lateGame: 180,             // seconds: after this it builds more Assaults and Titans
};

// Fog of war (game/vision.js). sight (per unit type above): how far a unit sees, given a clear line of sight.
export const VISION = {
  cell: 2,                   // ground grid cell size (world units): 128 x 128 over the map
  update: 0.25,              // seconds between ground-grid updates
  targetHeight: 1.6,         // a cell counts as seen if something this tall standing there would be in view
  defaultSight: 36,
  explored: 0.45,            // brightness of ground seen before but not now
  hidden: 0.07,              // ... of ground never seen
};
