import { bitSender } from './bit-sender.js';

// array[T] in, T out: the elements of each array go out one by one, one per symbol at the baud rate. T is whatever
// the array holds (see graph.js, where the output type follows the cable that feeds the input).
// An array that arrives while another is going out is queued behind it.
export const serializer = {
  title: 'Serializer',
  category: 'Processing blocks',
  inputs: ['in'],
  outputs: ['out'],
  asyncPorts: ['in', 'out'],
  wireTypes: { in: 'array[T]', out: 'T' },
  params: [
    { key: 'baud', label: 'Baud rate', show: true, type: 'range', scale: 'log', min: 50, max: 20000, step: 1, unit: 'baud', default: 1000 },
  ],
  build(ctx, p) {
    let baud = p.baud;
    const sender = bitSender(ctx, () => baud);
    return {
      outputs: { out: sender.out },
      inputs: { in: { receive(items) { if (Array.isArray(items)) sender.send(items); } } },
      update(p) { baud = p.baud; },
      dispose() { sender.dispose(); },
    };
  },
};
