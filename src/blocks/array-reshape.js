import { h } from '../dom.js';
import { streamOutput } from './stream.js';

// numpy.reshape of an array of arrays (N x M) into rows x cols, in row-major order; one of rows / cols may be -1
// (worked out from the other). Returns null when the elements don't fit the new shape or the input isn't a
// rectangle (every inner array the same length).
export function reshape(a, rows, cols) {
  if (!Array.isArray(a) || !a.length || !a.every((r) => Array.isArray(r) && r.length === a[0].length)) return null;
  const flat = a.flat();
  const total = flat.length;
  if (rows === -1 && cols > 0 && total % cols === 0) rows = total / cols;
  else if (cols === -1 && rows > 0 && total % rows === 0) cols = total / rows;
  if (!(rows > 0 && cols > 0 && rows * cols === total)) return null;
  return Object.freeze(Array.from({ length: rows }, (_, i) => Object.freeze(flat.slice(i * cols, (i + 1) * cols))));
}

const shapeOf = (a) => `${a.length}x${Array.isArray(a[0]) ? a[0].length : '?'}`;

// array[array[T]] in, array[array[T]] out: the same N * M elements laid out in another number of rows and columns.
export const arrayReshape = {
  title: 'Array Reshape',
  category: 'Processing blocks',
  inputs: ['in'],
  outputs: ['out'],
  asyncPorts: ['in', 'out'],
  wireTypes: { in: 'array[array[T]]', out: 'same' },
  params: [
    // -1 as in numpy.reshape: worked out from the other dimension
    { key: 'rows', label: 'Rows',    show: true, type: 'range', min: -1, max: 4096, step: 1, default: 1 },
    { key: 'cols', label: 'Columns', show: true, type: 'range', min: -1, max: 4096, step: 1, default: -1 },
  ],
  build(ctx, p) {
    let { rows, cols } = p;
    const out = streamOutput();
    const inst = {
      status: 'Waiting for arrays',
      inputs: { in: { receive(a) {
        if (!Array.isArray(a) || !a.length || !a.every((r) => Array.isArray(r))) return;
        const r = reshape(a, rows, cols);
        // like numpy's error: an array whose size doesn't fit is dropped, and the block says so
        inst.status = r ? `${shapeOf(a)} → ${shapeOf(r)}` : `${shapeOf(a)} can't be ${rows} x ${cols}`;
        if (r) out.send(r);
      } } },
      outputs: { out },
      update(p) { ({ rows, cols } = p); },
      dispose() { out.disconnect(); },
    };
    return inst;
  },
  ui() {
    const el = h('div', { className: 'msg-status' });
    let shown = null;
    return {
      el,
      draw(inst) {
        const text = inst ? inst.status : 'Stopped';
        if (text !== shown) { shown = text; el.textContent = text; }
      },
    };
  },
};
