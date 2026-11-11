import { streamOutput } from './stream.js';
import { intArrayInfo } from '../core/params.js';

const UNKNOWN = { bits: 32, signed: null };   // the cable's type isn't known (it comes from a generic block): the widest

// array[T] in, array[array[uint8]] out, with T an integer of 8, 16 or 32 bits: every element becomes the array of its
// W bits (W is the width of T), most significant first, so N elements give N x W. Negative numbers give their
// two's complement bits.
export const arrayUnpack = {
  title: 'Array Unpack',
  category: 'Processing blocks',
  inputs: ['in'],
  outputs: ['out'],
  asyncPorts: ['in', 'out'],
  wireTypes: { in: 'array[int*]', out: 'array[array[uint8]]' },
  params: [],
  build(ctx, p, node, wires = {}) {
    const { bits: width, signed } = intArrayInfo(wires.in) || UNKNOWN;
    const lo = signed === false ? 0 : -(2 ** (width - 1));
    const hi = signed === true ? 2 ** (width - 1) - 1 : 2 ** width - 1;
    const out = streamOutput();
    const unpack = (v) => Object.freeze(Array.from({ length: width }, (_, i) => (v >>> (width - 1 - i)) & 1));
    return {
      width,
      outputs: { out },
      inputs: { in: { receive(items) {
        if (!Array.isArray(items) || !items.every((v) => Number.isInteger(v) && v >= lo && v <= hi)) return;
        out.send(Object.freeze(items.map(unpack)));
      } } },
      update() {},
      dispose() { out.disconnect(); },
    };
  },
};
