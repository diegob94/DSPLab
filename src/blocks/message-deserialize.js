import { h } from '../dom.js';
import { messageOutput, freezeBits, shapeOf } from './message.js';

// Collects 1 x 1 messages into rows x cols messages, filling column by column (the inverse of the
// Message Serializer): with 8 x 1 every 8 bits make one byte, most significant first.
export const messageDeserialize = {
  title: 'Message Deserializer',
  category: 'Message blocks',
  inputs: ['msg'],
  outputs: ['msg'],
  messagePorts: ['msg'],
  params: [
    { key: 'rows', label: 'Rows',    show: true, type: 'range', min: 1, max: 64, step: 1, default: 8 },
    { key: 'cols', label: 'Columns', show: true, type: 'range', min: 1, max: 4096, step: 1, default: 1 },
  ],
  build(ctx, p) {
    let { rows, cols } = p;
    const out = messageOutput();
    let bits = [];
    const inst = {
      status: 'Waiting for bits',
      inputs: { msg: { receive(m) {
        if (!Array.isArray(m) || m.length !== 1 || !Array.isArray(m[0]) || m[0].length !== 1) return;
        const b = m[0][0];
        if (b !== 0 && b !== 1) return;
        bits.push(b);
        const need = rows * cols;
        if (bits.length < need) { inst.status = `${bits.length} / ${need} bits`; return; }
        const msg = freezeBits(Array.from({ length: rows }, (_, i) => Array.from({ length: cols }, (_, j) => bits[j * rows + i])));
        bits = [];
        inst.status = `sent ${shapeOf(msg)}`;
        out.send(msg);
      } } },
      outputs: { msg: out },
      // a new size makes the bits collected so far useless
      update(p) { if (p.rows !== rows || p.cols !== cols) bits = []; ({ rows, cols } = p); },
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
