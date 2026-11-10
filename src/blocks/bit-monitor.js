import { h } from '../dom.js';
import { isBit, parseBits, bitsToText } from './stream.js';

// one log line for a frame: its text (control characters shown as ·) or its bits
const describe = (bits, format) => (format === 'text' ? bitsToText(bits).replace(/[\u0000-\u001f\u007f]/g, '·') : bits.join(''));

// Prints what arrives on an asynchronous bit stream, a frame per line with the audio time at which it was
// complete. With a preamble it ignores the stream until it sees those bits (at any bit offset), then collects
// one frame and goes back to waiting; this is what puts the bytes in the right place after a timing recovery.
export const bitMonitor = {
  title: 'Bit Monitor',
  category: 'Sink blocks',
  inputs: ['bits'],
  outputs: [],
  asyncPorts: ['bits'],
  params: [
    { key: 'format', label: 'Format', show: true, type: 'select', options: ['text', 'bits'], default: 'text' },
    { key: 'frame', label: 'Frame', show: true, type: 'range', min: 1, max: 4096, step: 1, default: 8 },
    { key: 'lines', label: 'Lines', type: 'select', options: [4, 8, 16], default: 8 },
    { key: 'preambleType', label: 'Preamble type', type: 'select', options: ['text', 'hex', 'bits'], default: 'text' },
    { key: 'preamble', label: 'Preamble', show: true, type: 'text', default: '' },
  ],
  // the number of bits in a frame: characters of 8 bits in text format
  frameBits: (p) => (p.format === 'text' ? p.frame * 8 : p.frame),
  build(ctx, p) {
    let params = p;
    let preamble = parseBits(p.preambleType, p.preamble);
    const log = [];         // the newest `lines` frames: "12.345  text"
    let bits = [];          // the frame being collected
    let recent = [];        // the last preamble.length bits, while looking for the preamble
    let locked = !preamble.length;
    const reset = () => { bits = []; recent = []; locked = !preamble.length; };
    const trim = () => { if (log.length > params.lines) log.splice(0, log.length - params.lines); };
    const inst = {
      log,
      inputs: { bits: { receive(b) {
        if (!isBit(b)) return;
        if (!locked) {
          recent.push(b);
          if (recent.length > preamble.length) recent.shift();
          if (recent.length === preamble.length && recent.every((v, i) => v === preamble[i])) { locked = true; recent = []; }
          return;
        }
        bits.push(b);
        if (bits.length < bitMonitor.frameBits(params)) return;
        log.push(`${ctx.currentTime.toFixed(3)}  ${describe(bits, params.format)}`);
        trim();
        reset();
      } } },
      outputs: {},
      // a new frame size or preamble makes the bits collected so far useless
      update(next) {
        const changed = bitMonitor.frameBits(next) !== bitMonitor.frameBits(params);
        const nextPreamble = parseBits(next.preambleType, next.preamble);
        const samePreamble = nextPreamble.join() === preamble.join();
        params = next;
        preamble = nextPreamble;
        if (changed || !samePreamble) reset();
        trim();
      },
      dispose() { log.length = 0; },
    };
    return inst;
  },
  ui() {
    const el = h('pre', { className: 'msg-log' });
    let shown = null;
    return {
      el,
      draw(inst) {
        const text = inst ? inst.log.join('\n') || 'Waiting for bits' : 'Stopped';
        if (text !== shown) { shown = text; el.textContent = text; }
      },
    };
  },
};
