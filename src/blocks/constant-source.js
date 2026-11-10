import { parseBits } from './stream.js';
import { bitSender } from './bit-sender.js';

// A bit stream on an asynchronous clock that is sent once, when the audio starts, and again whenever the data
// is edited: the bits of a text, hex bytes or a bit pattern, one per symbol at the baud rate.
export const constantSource = {
  title: 'Constant Source',
  category: 'Source blocks',
  inputs: [],
  outputs: ['bits'],
  asyncPorts: ['bits'],
  params: [
    { key: 'type', label: 'Type',      type: 'select', options: ['text', 'hex', 'bits'], default: 'text' },
    { key: 'data', label: 'Data',      show: true, type: 'text', default: 'hello' },
    { key: 'baud', label: 'Baud rate', show: true, type: 'range', scale: 'log', min: 50, max: 20000, step: 1, unit: 'baud', default: 1000 },
  ],
  build(ctx, p) {
    let params = p;
    const sender = bitSender(ctx, () => params.baud);
    let key = `${p.type}\u0000${p.data}`;
    // the engine wires the cables after building every block, so the first send waits until that is done
    const first = setTimeout(() => sender.send(parseBits(p.type, p.data)), 0);
    return {
      outputs: { bits: sender.out },
      update(next) {
        params = next;
        const nextKey = `${next.type}\u0000${next.data}`;
        if (nextKey === key) return;
        key = nextKey;
        sender.send(parseBits(next.type, next.data));
      },
      dispose() { clearTimeout(first); sender.dispose(); },
    };
  },
};
