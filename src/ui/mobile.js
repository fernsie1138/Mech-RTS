// Mobile Mode: a compact UI for phones (smaller buttons, HUD, build buttons and minimap; see body.mobile in
// index.html). Toggled with the "Mobile" button; the choice is remembered on this device. With no saved choice it
// starts on when the screen is phone-sized. ?mobile=1 / ?mobile=0 in the URL forces it (tests use this).
const KEY = 'mechrts.mobile';

export function isPhoneSized() { return Math.min(innerWidth, innerHeight) < 500; }

function saved() {
  try { const v = localStorage.getItem(KEY); return v === null ? null : v === '1'; } catch { return null; }
}
function save(on) { try { localStorage.setItem(KEY, on ? '1' : '0'); } catch { /* private mode: not remembered */ } }

// btn: the toggle button. onChange(on): after the mode changes (e.g. to adjust the camera).
export function initMobileMode(btn, onChange = () => {}) {
  const param = new URLSearchParams(location.search).get('mobile');
  let on = param === '1' ? true : param === '0' ? false : saved() ?? isPhoneSized();
  const apply = () => {
    document.body.classList.toggle('mobile', on);
    btn.classList.toggle('on', on);
    onChange(on);
  };
  btn.addEventListener('pointerup', () => { on = !on; save(on); apply(); });
  apply();
  return { get on() { return on; }, set(v) { on = !!v; save(on); apply(); } };
}
