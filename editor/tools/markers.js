// Gameplay marker tools: tap to place the player HQ / enemy HQ; tap to add a capture point, or tap an
// existing one to remove it. Returns new markers (the caller records undo).
export const CAPTURE_REMOVE_RADIUS = 7;

export function placeMarker(markers, tool, x, z) {
  const m = { playerHQ: markers.playerHQ, enemyHQ: markers.enemyHQ, capturePoints: [...markers.capturePoints] };
  if (tool === 'playerHQ') m.playerHQ = { x, z };
  else if (tool === 'enemyHQ') m.enemyHQ = { x, z };
  else if (tool === 'capture') {
    const i = m.capturePoints.findIndex(p => Math.hypot(p.x - x, p.z - z) < CAPTURE_REMOVE_RADIUS);
    if (i >= 0) m.capturePoints.splice(i, 1);
    else m.capturePoints.push({ x, z });
  }
  return m;
}
