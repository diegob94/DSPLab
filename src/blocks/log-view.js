import { h } from '../dom.js';
import { emit } from '../core/events.js';

// The size params of the blocks that show a log; the view is resized by dragging its corner or from the panel.
export const logSizeParams = [
  { key: 'width',  label: 'Width',  type: 'range', min: 120, max: 1000, step: 1, unit: 'px', default: 220 },
  { key: 'height', label: 'Height', type: 'range', min: 40,  max: 800,  step: 1, unit: 'px', default: 120 },
];

// A log box that shows the newest lines (it sticks to the bottom) and has a grip in its corner to resize it.
// text(inst) -> what to show for the built block (inst is undefined while the engine is stopped).
export function logView(node, text) {
  const pre = h('pre', { className: 'msg-log' });
  const grip = h('div', { className: 'log-grip', title: 'Drag to resize' });
  const el = h('div', { className: 'log-wrap' }, pre, grip);
  let shown = null;
  let size = '';

  grip.addEventListener('pointerdown', (e) => {
    if (e.button !== 0) return;
    e.stopPropagation();   // not a block drag
    e.preventDefault();
    const scale = el.getBoundingClientRect().width / el.offsetWidth || 1;   // the canvas zoom
    const w0 = node.params.width, h0 = node.params.height, sx = e.clientX, sy = e.clientY;
    const set = (key, v) => {
      const p = logSizeParams.find((p) => p.key === key);
      v = Math.round(Math.min(p.max, Math.max(p.min, v)));
      if (v !== node.params[key]) { node.params[key] = v; emit('param', node, key); }
    };
    const move = (ev) => {
      set('width', w0 + (ev.clientX - sx) / scale);
      set('height', h0 + (ev.clientY - sy) / scale);
    };
    const up = () => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
  });

  return {
    el,
    draw(inst) {
      const nextSize = `${node.params.width}x${node.params.height}`;
      if (nextSize !== size) {
        size = nextSize;
        el.style.width = node.params.width + 'px';
        el.style.height = node.params.height + 'px';
      }
      const next = text(inst);
      if (next !== shown) { shown = next; pre.textContent = next; pre.scrollTop = pre.scrollHeight; }
    },
  };
}
