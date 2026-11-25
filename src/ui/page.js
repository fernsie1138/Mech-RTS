// Classic (non-module) script loaded first by every page.
// Block page zoom / scroll / callouts during play (Safari ignores user-scalable=no in some cases).
// Form controls (sliders, inputs) and elements marked .scroll keep their normal touch behaviour.
const keepsTouch = t => t && t.closest && t.closest('input, select, textarea, .scroll');
for (const ev of ['gesturestart', 'gesturechange', 'gestureend']) {
  document.addEventListener(ev, e => e.preventDefault(), { passive: false });
}
document.addEventListener('touchmove', e => { if (!keepsTouch(e.target)) e.preventDefault(); }, { passive: false });
document.addEventListener('contextmenu', e => { if (!keepsTouch(e.target)) e.preventDefault(); });
let lastTouchEnd = 0;
document.addEventListener('touchend', e => {          // stop double-tap zoom on the 3D view
  const now = Date.now();
  if (e.target && e.target.tagName === 'CANVAS' && now - lastTouchEnd < 350) e.preventDefault();
  lastTouchEnd = now;
}, { passive: false });
// Show load errors on screen, since there is no console on the iPad.
window.addEventListener('error', e => {
  const f = document.getElementById('fatal');
  if (!f) return;
  f.style.display = 'flex';
  f.textContent = 'Error: ' + (e.message || e.error || 'failed to load') + (e.filename ? ' (' + e.filename.split('/').pop() + ':' + e.lineno + ')' : '');
});
window.addEventListener('unhandledrejection', e => {
  const f = document.getElementById('fatal');
  if (!f || f.style.display === 'flex') return;
  f.style.display = 'flex';
  f.textContent = 'Error: ' + (e.reason && e.reason.message || e.reason || 'unknown');
});
