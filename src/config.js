// Tunable numbers. Gameplay values (unit stats, damage, costs) will be added here as systems arrive.

export const MAP_SIZE = 200;          // world units across (placeholder until §13 decides)

export const RENDER = {
  maxPixelRatio: 2,
  shadowMapSize: 2048,
  shadowArea: 60,                     // half-size of the shadow camera box, follows the camera target
};

export const CAMERA = {
  fov: 45,
  pitchDeg: 55,                       // angle down from horizontal
  minDistance: 25,
  maxDistance: 220,
  startDistance: 110,
  keyPanSpeed: 1.2,                   // fraction of camera distance per second
  wheelZoomFactor: 0.0015,
};

export const SIM = {
  stepSeconds: 1 / 60,                // fixed simulation step
  maxStepsPerFrame: 5,
};
