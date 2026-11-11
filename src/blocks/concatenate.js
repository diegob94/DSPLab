import { h } from '../dom.js';
import { streamOutput } from './stream.js';

const LETTERS = ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h'];
const inputNames = (p) => LETTERS.slice(0, p.inputs);

const isBytes = (x) => Array.isArray(x) && x.every((b) => Number.isInteger(b) && b >= 0 && b <= 255);

// Joins the arrays that arrive at its inputs, in the order of the inputs (a, b, c...). Every input but the last
// one remembers the latest array it received; the joined array goes out when one arrives at the last input, so
// that input's clock sets the pace. Typical use: a preamble (a Constant Source) in front of a payload.
export const concatenate = {
  title: 'Concatenate',
  category: 'Processing blocks',
  inputs: inputNames,
  outputs: ['out'],
  asyncPorts: [...LETTERS, 'out'],
  wireTypes: { ...Object.fromEntries(LETTERS.map((l) => [l, 'array[uint8]'])), out: 'array[uint8]' },
  params: [
    { key: 'inputs', label: 'Inputs', show: true, type: 'select', options: [2, 3, 4, 5, 6, 7, 8], ports: true, default: 2 },
  ],
  build(ctx, p) {
    const names = inputNames(p);
    const held = new Map();   // input name -> the latest array that arrived there
    const out = streamOutput();
    const inst = {
      status: `Waiting for ${names[0]}`,
      inputs: {},
      outputs: { out },
      update() {},
      dispose() { out.disconnect(); },
    };
    names.forEach((name, i) => {
      const last = i === names.length - 1;
      inst.inputs[name] = { receive(bytes) {
        if (!isBytes(bytes)) return;
        held.set(name, bytes);
        if (!last) return;
        const missing = names.find((n) => !held.has(n));
        if (missing) { inst.status = `Waiting for ${missing}`; return; }
        const joined = Object.freeze(names.flatMap((n) => held.get(n)));
        inst.status = `${names.map((n) => held.get(n).length).join(' + ')} → ${joined.length} bytes`;
        out.send(joined);
      } };
    });
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
