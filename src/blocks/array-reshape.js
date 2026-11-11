import { h } from '../dom.js';
import { streamOutput } from './stream.js';
import { elementOf } from '../core/params.js';

const isArray2 = (a) => a.every((r) => Array.isArray(r));

// numpy.reshape of an array (1-D, or N arrays of M elements) into rows x cols, in row-major order; one of rows / cols
// may be -1 (worked out from the other). A dimension set to 0 disappears: the other one then holds every element and
// the result is a plain array. Returns null when the elements don't fit the new shape or the input isn't
// rectangular (every inner array the same length).
export function reshape(a, rows, cols) {
  if (!Array.isArray(a) || !a.length) return null;
  const nested = isArray2(a);
  if (!nested && a.some((r) => Array.isArray(r))) return null;
  if (nested && !a.every((r) => r.length === a[0].length)) return null;
  const flat = nested ? a.flat() : a;
  const total = flat.length;
  if (rows === 0 || cols === 0) {
    const kept = rows === 0 ? cols : rows;   // the dimension that stays: all the elements, or -1 for "work it out"
    return rows === 0 && cols === 0 || !(kept === -1 || kept === total) ? null : Object.freeze(flat.slice());
  }
  if (rows === -1 && cols > 0 && total % cols === 0) rows = total / cols;
  else if (cols === -1 && rows > 0 && total % rows === 0) cols = total / rows;
  if (!(rows > 0 && cols > 0 && rows * cols === total)) return null;
  return Object.freeze(Array.from({ length: rows }, (_, i) => Object.freeze(flat.slice(i * cols, (i + 1) * cols))));
}

// 5 -> '5', a 3 x 4 array -> '3x4'
const shapeOf = (a) => (isArray2(a) ? `${a.length}x${a[0].length}` : String(a.length));

// the type that comes out when `in` carries `wire` ('array[T]' or 'array[array[T]]'): a plain array when a dimension
// is 0, an array of arrays otherwise
const squeezed = (rows, cols) => rows === 0 || cols === 0;
const outType = (params, wire) => {
  const inner = elementOf(wire);                       // 'array[X]' or 'X'
  const leaf = elementOf(inner) || inner;              // X
  return squeezed(params.rows, params.cols) ? `array[${leaf}]` : `array[array[${leaf}]]`;
};

export const arrayReshape = {
  title: 'Array Reshape',
  category: 'Processing blocks',
  inputs: ['in'],
  outputs: ['out'],
  asyncPorts: ['in', 'out'],
  wireTypes: { in: 'array[T]', out: outType },
  params: [
    // -1 as in numpy.reshape: worked out from the other dimension; 0: the dimension disappears
    { key: 'rows', label: 'Rows',    show: true, type: 'range', min: -1, max: 4096, step: 1, default: 1 },
    { key: 'cols', label: 'Columns', show: true, type: 'range', min: -1, max: 4096, step: 1, default: -1 },
  ],
  build(ctx, p) {
    let { rows, cols } = p;
    const out = streamOutput();
    const inst = {
      status: 'Waiting for arrays',
      inputs: { in: { receive(a) {
        if (!Array.isArray(a) || !a.length) return;
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
