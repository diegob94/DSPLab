import { parseBits } from './stream.js';
import { bitSender } from './bit-sender.js';

// A bit stream on an asynchronous clock: the bits of a text, hex bytes or a bit pattern go out one per symbol
// at the baud rate, most significant bit of each byte first, and again every period.
export const strobeSource = {
  title: 'Strobe Source',
  category: 'Source blocks',
  inputs: [],
  outputs: ['bits'],
  asyncPorts: ['bits'],
  params: [
    { key: 'type',   label: 'Type',      type: 'select', options: ['text', 'hex', 'bits'], default: 'text' },
    { key: 'data',   label: 'Data',      show: true, type: 'text', default: 'hello' },
    { key: 'baud',   label: 'Baud rate', show: true, type: 'range', scale: 'log', min: 50, max: 20000, step: 1, unit: 'baud', default: 1000 },
    { key: 'period', label: 'Period',    show: true, type: 'range', scale: 'log', min: 10, max: 10000, step: 1, unit: 'ms', default: 1000 },
  ],
  build(ctx, p) {
    let params = p;
    const sender = bitSender(ctx, () => params.baud);
    let timer = null;
    let period = null;
    const emit = () => sender.send(parseBits(params.type, params.data));
    const start = (ms) => {
      clearInterval(timer);
      period = ms;
      timer = setInterval(emit, ms);
    };
    // the engine wires the cables after building every block, so the first send waits until that is done
    const first = setTimeout(emit, 0);
    start(p.period);
    return {
      outputs: { bits: sender.out },
      // retyping the data must not restart the clock
      update(next) { params = next; if (next.period !== period) start(next.period); },
      dispose() { clearTimeout(first); clearInterval(timer); sender.dispose(); },
    };
  },
};
