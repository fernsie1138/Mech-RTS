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
export const TERRAIN_DAMAGE = {
  mg:     { radius: 0.7, depth: 0.06, rim: 0,    erode: 0,    wear: 0.35, scorch: 0.15, wearRadius: 1.4, fxSize: 0.35 },
  cannon: { radius: 1.8, depth: 0.7,  rim: 0.3,  erode: 0.25, wear: 1.2,  scorch: 0.3,   wearRadius: 1.8, fxSize: 1.2 },
  shell:  { radius: 3.6, depth: 1.7,  rim: 0.3,  erode: 0.4,  wear: 1.6,  scorch: 0.45,  wearRadius: 1.8, fxSize: 2.6 },
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
};

export const SIM = {
  stepSeconds: 1 / 60,                // fixed simulation step
  maxStepsPerFrame: 5,
};
