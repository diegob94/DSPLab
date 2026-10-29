import { h } from '../dom.js';
import { isBits, messageOutput, freezeBits, shapeOf } from './message.js';

// Joins two messages: `a` then `b`. Typical use: a preamble in front of a payload. `a` is remembered (the
// last one received) and the joined message goes out when `b` arrives, so a slow clock on `b` sets the pace.
// Returns null when the shapes don't fit: columns need the same rows, rows need the same columns.
export function concat(a, b, join) {
  if (join === 'rows') return a[0].length === b[0].length ? freezeBits([...a, ...b]) : null;
  return a.length === b.length ? freezeBits(a.map((row, i) => [...row, ...b[i]])) : null;
}

export const messageConcatenate = {
  title: 'Message Concatenate',
  category: 'Message blocks',
  inputs: ['a', 'b'],
  outputs: ['msg'],
  messagePorts: ['a', 'b', 'msg'],
  concat,
  params: [
    // columns: side by side, so two 8 x N texts make one longer text
    { key: 'join', label: 'Join', show: true, type: 'select', options: ['columns', 'rows'], default: 'columns' },
  ],
  build(ctx, p) {
    let join = p.join;
    let a = null;
    const out = messageOutput();
    const inst = {
      status: 'Waiting for a',
      inputs: {
        a: { receive(m) { if (isBits(m)) a = m; } },
        b: { receive(m) {
          if (!isBits(m)) return;
          if (!a) { inst.status = 'Waiting for a'; return; }
          const r = concat(a, m, join);
          inst.status = r ? `${shapeOf(a)} + ${shapeOf(m)} → ${shapeOf(r)}` : `${shapeOf(a)} and ${shapeOf(m)} can't join by ${join}`;
          if (r) out.send(r);
        } },
      },
      outputs: { msg: out },
      update(p) { join = p.join; },
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
