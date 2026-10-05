// Android back button for overlays (menu, sheets, full screen chart) inside the installed app.
// Each open overlay adds one history entry; Back removes it and closes the overlay instead of
// leaving the page. In a normal browser tab nothing changes: these calls do nothing.
import { isApp } from './pwa.js';

const stack = [];
let skip = 0; // popstate events caused by our own history.back()

if (isApp()) {
  // A reload while an overlay was open leaves a spare entry behind; make it an ordinary one.
  try { if (history.state && history.state.cmLayer) history.replaceState(null, ''); } catch { /* ignore */ }
  window.addEventListener('popstate', () => {
    if (skip > 0) { skip--; return; }
    const layer = stack.pop();
    if (layer) layer.close();
  });
  // A page restored from the back/forward cache must not remember overlays that no longer exist.
  window.addEventListener('pageshow', e => { if (e.persisted) { stack.length = 0; skip = 0; } });
}

/**
 * Register an open overlay. `close` must only close it visually (and be safe to call twice).
 * Returns release(): call it when the overlay is closed by the app (button, backdrop, choice).
 */
export function pushLayer(close) {
  if (!isApp()) return () => {};
  const layer = { close };
  stack.push(layer);
  try { history.pushState({ cmLayer: stack.length }, ''); } catch { /* ignore */ }
  return () => {
    const i = stack.indexOf(layer);
    if (i < 0) return; // already closed by the Back button
    stack.splice(i, 1);
    skip++;
    try { history.back(); } catch { skip--; }
  };
}

/** Go to another page from inside an overlay without leaving stray history entries behind. */
export function leave(href) {
  const n = stack.length;
  if (!n) { location.href = href; return; }
  const layers = stack.splice(0);
  let done = false;
  const go = () => {
    if (done) return;
    done = true;
    layers.reverse().forEach(l => { try { l.close(); } catch { /* ignore */ } });
    location.href = href;
  };
  window.addEventListener('popstate', go, { once: true });
  setTimeout(go, 450);
  try { history.go(-n); } catch { go(); }
}
