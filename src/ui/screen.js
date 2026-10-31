// Big screen: a window over the diagram with a block's live view on the left and its settings
// on the right. Opened by a block's `dsplab:screen` event (its view must provide paint()).
import { BLOCKS } from '../blocks/index.js';
import { h } from '../dom.js';
import { on } from '../core/events.js';
import { setParam } from '../core/graph.js';
import { validParam } from '../core/params.js';
import { engine } from '../core/engine.js';
import { paramWidget } from './properties.js';

let open = null;   // { node, root, raf }

export function closeScreen() {
  if (!open) return;
  cancelAnimationFrame(open.raf);
  open.root.remove();
  open.opener && open.opener.focus();
  open = null;
}

function renderOptions(side, node) {
  side.replaceChildren(h('div', { className: 'props-head', textContent: 'Settings' }));
  for (const p of BLOCKS[node.type].params) side.append(paramWidget(node, p, 'big'));
}

function openScreen(node) {
  closeScreen();
  const def = BLOCKS[node.type];
  const canvas = h('canvas', { className: 'screen-canvas' });
  const side = h('div', { className: 'screen-side' });
  const close = h('button', { type: 'button', className: 'screen-close', textContent: '\u00d7', title: 'Close', ariaLabel: 'Close' });
  // gestures on the view (pan, zoom) change the block's params; the settings are redrawn to show them
  const set = (key, value) => {
    const p = def.params.find((q) => q.key === key);
    setParam(node, key, validParam(p, Number(value.toPrecision(5)), node.params));
    renderOptions(side, node);
  };
  const win = h('div', { className: 'screen-window', role: 'dialog', ariaLabel: `${def.title} big screen` },
    h('div', { className: 'screen-title', textContent: def.title }, close),
    h('div', { className: 'screen-body' }, h('div', { className: 'screen-view' }, canvas), side));
  const root = h('div', { className: 'screen-backdrop' }, win);
  root.addEventListener('pointerdown', (e) => { if (e.target === root) closeScreen(); e.stopPropagation(); });
  root.addEventListener('wheel', (e) => e.stopPropagation());
  close.addEventListener('click', closeScreen);
  renderOptions(side, node);
  if (node.view.attach) node.view.attach(canvas, set);
  document.body.append(root);
  open = { node, side, root, opener: document.activeElement, raf: 0 };

  const g = canvas.getContext('2d');
  (function frame() {
    const dpr = window.devicePixelRatio || 1;
    const W = canvas.clientWidth, H = canvas.clientHeight;
    if (canvas.width !== Math.round(W * dpr) || canvas.height !== Math.round(H * dpr)) {
      canvas.width = Math.round(W * dpr);
      canvas.height = Math.round(H * dpr);
    }
    g.setTransform(dpr, 0, 0, dpr, 0, 0);
    node.view.paint(g, W, H, engine.live.get(node.id), 12, true);
    open.raf = requestAnimationFrame(frame);
  })();
  close.focus();
}

export function initScreen() {
  window.addEventListener('dsplab:screen', (e) => { if (e.detail.view && e.detail.view.paint) openScreen(e.detail); });
  window.addEventListener('keydown', (e) => {
    if (open && e.key === 'Escape') closeScreen();
    // keys such as Delete must not reach the diagram behind the window
    else if (open && e.key !== 'Tab') e.stopPropagation();
  }, true);
  on('node-removed', (node) => { if (open && open.node === node) closeScreen(); });
  // the number of channels changed: the trigger choices depend on it
  on('ports', (node) => { if (open && open.node === node) renderOptions(open.side, node); });
}
