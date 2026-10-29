import { h } from '../dom.js';
import { bitsToText, isBits, isByteMessage, shapeOf } from './message.js';

// one log line for a message: the text of an 8 x N message (if decoding is on), otherwise its bits
function describe(m, decode) {
  if (!isBits(m)) return String(m);
  if (decode === 'on' && isByteMessage(m)) return bitsToText(m).replace(/[\u0000-\u001f\u007f]/g, '·');
  return `${shapeOf(m)}  ${m.map((row) => row.join('')).join(' / ')}`;
}

export const messageDebug = {
  title: 'Message Debug',
  category: 'Message blocks',
  inputs: ['msg'],
  outputs: [],
  messagePorts: ['msg'],
  params: [
    { key: 'lines', label: 'Lines', show: true, type: 'select', options: [4, 8, 16], default: 8 },
    { key: 'decode', label: 'Decode', show: true, type: 'select', options: ['on', 'off'], default: 'on' },
  ],
  build(ctx, p) {
    let { lines, decode } = p;
    const log = [];   // the newest `lines` messages: "12.345  text"
    return {
      inputs: { msg: { receive(m) {
        log.push(`${ctx.currentTime.toFixed(3)}  ${describe(m, decode)}`);
        if (log.length > lines) log.splice(0, log.length - lines);
      } } },
      log,
      update(p) {
        ({ lines, decode } = p);
        if (log.length > lines) log.splice(0, log.length - lines);
      },
      dispose() { log.length = 0; },
    };
  },
  ui() {
    const el = h('pre', { className: 'msg-log' });
    let shown = null;
    return {
      el,
      draw(inst) {
        const text = inst ? inst.log.join('\n') || 'Waiting for messages' : 'Stopped';
        if (text !== shown) { shown = text; el.textContent = text; }
      },
    };
  },
};
