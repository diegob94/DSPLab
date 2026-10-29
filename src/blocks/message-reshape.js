import { h } from '../dom.js';
import { isBits, messageOutput, reshape, shapeOf } from './message.js';

export const messageReshape = {
  title: 'Message Reshape',
  category: 'Message blocks',
  inputs: ['msg'],
  outputs: ['msg'],
  messagePorts: ['msg'],
  params: [
    // -1 as in numpy.reshape: worked out from the other dimension
    { key: 'rows', label: 'Rows',    show: true, type: 'range', min: -1, max: 4096, step: 1, default: 1 },
    { key: 'cols', label: 'Columns', show: true, type: 'range', min: -1, max: 4096, step: 1, default: -1 },
  ],
  build(ctx, p) {
    let { rows, cols } = p;
    const out = messageOutput();
    const inst = {
      status: 'Waiting for messages',
      inputs: { msg: { receive(m) {
        if (!isBits(m)) return;
        const r = reshape(m, rows, cols);
        // like numpy's error: a message whose size doesn't fit is dropped, and the block says so
        inst.status = r ? `${shapeOf(m)} → ${shapeOf(r)}` : `${shapeOf(m)} can't be ${rows} x ${cols}`;
        if (r) out.send(r);
      } } },
      outputs: { msg: out },
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
