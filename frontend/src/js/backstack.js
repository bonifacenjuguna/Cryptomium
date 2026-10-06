// Android Back button for overlays (menu, search, sheets, full screen chart) inside the installed app.
// Each open overlay adds one history entry; Back removes it and closes the overlay instead of leaving
// the page. Back order is: top overlay first, then the previous screen, and only then out of the app.
// In a normal browser tab nothing changes: these calls do nothing.
//
// History changes are queued and run one at a time. Opening and closing an overlay in quick succession,
// or pressing Back repeatedly, therefore can never close the wrong thing or leave a stray entry behind.
import { isApp, navTo, inShell } from './pwa.js';

const stack = [];     // open overlays, oldest first
const queue = [];     // pending history operations
let busy = false;
let waiting = null;   // resolves when the popstate of our own history.back() arrives

const pump = () => {
  if (busy) return;
  const op = queue.shift();
  if (!op) return;
  busy = true;
  op();
};
const next = () => { busy = false; pump(); };
const withoutLayer = st => { if (!st || typeof st !== 'object') return null; const { cmLayer, ...rest } = st; return Object.keys(rest).length ? rest : null; }; // eslint-disable-line no-unused-vars

if (isApp()) {
  // A reload while an overlay was open leaves a spare entry behind; make it an ordinary one.
  try { if (history.state && history.state.cmLayer) history.replaceState(withoutLayer(history.state), ''); } catch { /* ignore */ }
  window.addEventListener('popstate', () => {
    if (waiting) { const w = waiting; waiting = null; w(); return; } // that was our own history.back()
    const layer = stack.pop();                                          // the visitor pressed Back
    if (layer) { layer.gone = true; layer.close(); }
  });
  // A page restored from the back/forward cache must not remember overlays that no longer exist.
  window.addEventListener('pageshow', e => { if (e.persisted) { stack.length = 0; queue.length = 0; busy = false; waiting = null; } });
}

/**
 * Register an open overlay. `close` must only close it visually (and be safe to call twice).
 * Returns release(): call it when the overlay is closed by the app (button, backdrop, choice).
 */
export function pushLayer(close) {
  if (!isApp()) return () => {};
  const layer = { close, pushed: false, gone: false };
  stack.push(layer);
  queue.push(() => {
    if (layer.gone) return next(); // closed again before its entry was made: nothing to add
    try { history.pushState({ ...(history.state || {}), cmLayer: true }, ''); layer.pushed = true; } catch { /* ignore */ }
    next();
  });
  pump();
  return () => {
    if (layer.gone) return; // already closed by the Back button
    layer.gone = true;
    const i = stack.indexOf(layer);
    if (i >= 0) stack.splice(i, 1);
    queue.push(() => {
      if (!layer.pushed) return next();
      const timer = setTimeout(() => { if (waiting) { waiting = null; next(); } }, 500); // never get stuck
      waiting = () => { clearTimeout(timer); next(); };
      try { history.back(); } catch { clearTimeout(timer); waiting = null; next(); }
    });
    pump();
  };
}

/** Go to another page from inside an overlay without leaving stray history entries behind. */
export function leave(href) {
  const open = stack.splice(0);
  open.forEach(l => { l.gone = true; });
  const n = open.filter(l => l.pushed).length;
  let done = false;
  const go = () => {
    if (done) return;
    done = true;
    const root = document.documentElement;
    root.classList.add('cm-instant'); // whatever was open vanishes at once: no drawer or search left hanging while the next screen arrives
    open.reverse().forEach(l => { try { l.close(); } catch { /* ignore */ } });
    if (inShell()) { navTo(href); setTimeout(() => root.classList.remove('cm-instant'), 500); } else location.href = href;
  };
  const start = () => {
    if (!n) { go(); return; }
    const timer = setTimeout(go, 450);
    waiting = () => { clearTimeout(timer); go(); };
    try { history.go(-n); } catch { go(); }
  };
  // Let any history change already in flight finish first.
  queue.push(() => { start(); next(); });
  pump();
}
