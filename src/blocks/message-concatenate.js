import { h } from '../dom.js';
import { isBits, messageOutput, freezeBits, shapeOf } from './message.js';

// Joins two messages: `a` then `b`. Typical use: a preamble in front of a payload.
// Returns null when the shapes don't fit: columns need the same rows, rows need the same columns.
export function concat(a, b, join) {
  if (join === 'rows') return a[0].length === b[0].length ? freezeBits([...a, ...b]) : null;
  return a.length === b.length ? freezeBits(a.map((row, i) => [...row, ...b[i]])) : null;
}

const LETTERS = ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h'];
const inputNames = (p) => LETTERS.slice(0, p.inputs);

// Joins the messages that arrive at its inputs in the order of the inputs (a, b, c...). Every input but the
// last one remembers the latest message it received; the joined message goes out when one arrives at the last
// input, so that input's clock sets the pace. Typical use: a preamble in front of a payload.
export const messageConcatenate = {
  title: 'Message Concatenate',
  category: 'Message blocks',
  inputs: inputNames,
  outputs: ['msg'],
  messagePorts: [...LETTERS, 'msg'],
  concat,
  params: [
    { key: 'inputs', label: 'Inputs', type: 'select', options: [2, 3, 4, 5, 6, 7, 8], ports: true, default: 2 },
    // columns: side by side, so two 8 x N texts make one longer text
    { key: 'join', label: 'Join', show: true, type: 'select', options: ['columns', 'rows'], default: 'columns' },
  ],
  build(ctx, p) {
    let join = p.join;
    const names = inputNames(p);
    const held = new Map();   // input name -> the latest message that arrived there
    const out = messageOutput();
    const inst = {
      status: 'Waiting for a',
      inputs: {},
      outputs: { msg: out },
      update(p) { join = p.join; },
      dispose() { out.disconnect(); },
    };
    names.forEach((name, i) => {
      const last = i === names.length - 1;
      inst.inputs[name] = { receive(m) {
        if (!isBits(m)) return;
        held.set(name, m);
        if (!last) return;
        const missing = names.find((n) => !held.has(n));
        if (missing) { inst.status = `Waiting for ${missing}`; return; }
        const parts = names.map((n) => held.get(n));
        let r = parts[0];
        for (let k = 1; k < parts.length; k++) {
          const next = concat(r, parts[k], join);
          if (!next) { inst.status = `${shapeOf(r)} and ${shapeOf(parts[k])} can't join by ${join}`; return; }
          r = next;
        }
        inst.status = `${parts.map(shapeOf).join(' + ')} → ${shapeOf(r)}`;
        out.send(r);
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
