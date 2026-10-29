import { h } from '../dom.js';
import { messageOutput, freezeBits, shapeOf, textToBits, bytesToBits, hexToBytes } from './message.js';
import { bitStream } from './message-serialize.js';

// The bits of a preamble, as the Message Serializer would send them: text (UTF-8), hex bytes, or bits as typed.
function preambleBits(type, value) {
  if (type === 'bits') return [...value].filter((c) => c === '0' || c === '1').map(Number);
  if (type === 'hex') return hexToBytes(value).length ? bitStream(bytesToBits(hexToBytes(value))) : [];
  return value ? bitStream(textToBits(value)) : [];
}

// Collects 1 x 1 messages into rows x cols messages, filling column by column (the inverse of the
// Message Serializer): with 8 x 1 every 8 bits make one byte, most significant first.
// With a preamble it first waits for that bit pattern in the stream and collects the message that follows it,
// then goes back to waiting; this is what puts the bytes in the right place after a timing recovery.
export const messageDeserialize = {
  title: 'Message Deserializer',
  category: 'Message blocks',
  inputs: ['msg'],
  outputs: ['msg'],
  messagePorts: ['msg'],
  params: [
    { key: 'rows', label: 'Rows',    show: true, type: 'range', min: 1, max: 64, step: 1, default: 8 },
    { key: 'cols', label: 'Columns', show: true, type: 'range', min: 1, max: 4096, step: 1, default: 1 },
    { key: 'preambleType', label: 'Preamble type', type: 'select', options: ['text', 'hex', 'bits'], default: 'text' },
    { key: 'preamble', label: 'Preamble', show: true, type: 'text', default: '' },
  ],
  build(ctx, p) {
    let { rows, cols } = p;
    let preamble = preambleBits(p.preambleType, p.preamble);
    const out = messageOutput();
    let bits = [];          // the message being collected
    let recent = [];        // the last preamble.length bits, while looking for the preamble
    let locked = !preamble.length;
    const reset = () => { bits = []; recent = []; locked = !preamble.length; };
    const idle = () => (preamble.length ? 'Looking for the preamble' : 'Waiting for bits');
    const inst = {
      status: idle(),
      inputs: { msg: { receive(m) {
        if (!Array.isArray(m) || m.length !== 1 || !Array.isArray(m[0]) || m[0].length !== 1) return;
        const b = m[0][0];
        if (b !== 0 && b !== 1) return;
        if (!locked) {
          recent.push(b);
          if (recent.length > preamble.length) recent.shift();
          if (recent.length === preamble.length && recent.every((v, i) => v === preamble[i])) {
            locked = true;
            recent = [];
            inst.status = `Preamble found, 0 / ${rows * cols} bits`;
          }
          return;
        }
        bits.push(b);
        const need = rows * cols;
        if (bits.length < need) { inst.status = `${bits.length} / ${need} bits`; return; }
        const msg = freezeBits(Array.from({ length: rows }, (_, i) => Array.from({ length: cols }, (_, j) => bits[j * rows + i])));
        reset();
        inst.status = `sent ${shapeOf(msg)}`;
        out.send(msg);
      } } },
      outputs: { msg: out },
      // a new size or preamble makes the bits collected so far useless
      update(p) {
        const next = preambleBits(p.preambleType, p.preamble);
        if (p.rows !== rows || p.cols !== cols || next.join() !== preamble.join()) { rows = p.rows; cols = p.cols; preamble = next; reset(); inst.status = idle(); }
      },
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
