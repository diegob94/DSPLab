import { bitSender } from './bit-sender.js';
import { bytesToBits } from './stream.js';

// array[int8] in, a stream of single bits out: each int8 is a byte (two's complement), sent most significant bit first, one bit per
// symbol at the baud rate. An array that arrives while another is going out is queued behind it.
export const bitSerializer = {
  title: 'Bit Serializer',
  category: 'Processing blocks',
  inputs: ['in'],
  outputs: ['bits'],
  asyncPorts: ['in', 'bits'],
  wireTypes: { in: 'array[int8]' },
  params: [
    { key: 'baud', label: 'Baud rate', show: true, type: 'range', scale: 'log', min: 50, max: 20000, step: 1, unit: 'baud', default: 1000 },
  ],
  build(ctx, p) {
    let baud = p.baud;
    const sender = bitSender(ctx, () => baud);
    return {
      outputs: { bits: sender.out },
      inputs: { in: { receive(bytes) {
        if (Array.isArray(bytes) && bytes.every((b) => Number.isInteger(b) && b >= -128 && b <= 127)) sender.send(bytesToBits(bytes));
      } } },
      update(p) { baud = p.baud; },
      dispose() { sender.dispose(); },
    };
  },
};
