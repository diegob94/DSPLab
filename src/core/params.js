import { clamp } from '../util.js';

export const optionsOf = (p, params) => (typeof p.options === 'function' ? p.options(params) : p.options);
export const portNames = (def, dir, params) => (typeof def[dir] === 'function' ? def[dir](params) : def[dir]);

// the clock of a port: 'audio' (sample rate) or 'async' (samples at their own instants)
export const portClock = (def, name) => ((def.asyncPorts || []).includes(name) ? 'async' : 'audio');

// '*' (in a block's wireTypes) accepts any async port, whatever its sample type; audio only goes with audio
export const wiresMatch = (a, b) => a === b || (a === '*' && b !== 'audio') || (b === '*' && a !== 'audio')
  || (a === 'array[T]' && b.startsWith('array[')) || (b === 'array[T]' && a.startsWith('array['))
  || (a === 'array[int*]' && isIntArray(b)) || (b === 'array[int*]' && isIntArray(a))
  || (a === 'array[numeric]' && isNumericArray(b)) || (b === 'array[numeric]' && isNumericArray(a))
  || (a === 'array[scalar]' && isFlatArray(b)) || (b === 'array[scalar]' && isFlatArray(a))
  || (a === 'array[array[T]]' && isArray2(b)) || (b === 'array[array[T]]' && isArray2(a));

const isArray2 = (wire) => wire.startsWith('array[array[');
// numeric sample types: integers of any width, signed or not, and float
const isNumericArray = (wire) => /^array\[(u?int\d*|float)\]$/.test(wire);
const isFlatArray = (wire) => wire.startsWith('array[') && !isArray2(wire);   // an array whose elements are not arrays

// 'array[int*]' (in a block's wireTypes): an array of integers of a known width
const INT_ARRAY = /^array\[(u?)int(8|16|32)\]$/;
const isIntArray = (wire) => INT_ARRAY.test(wire);

// the width in bits and the signedness of an integer array type, or null ('array[uint16]' -> { bits: 16, signed: false })
export function intArrayInfo(wire) {
  const m = INT_ARRAY.exec(wire || '');
  return m ? { bits: Number(m[2]), signed: m[1] !== 'u' } : null;
}

// 'array[uint8]' -> 'uint8'; null when it isn't an array
export const elementOf = (wire) => { const m = /^array\[(.*)\]$/.exec(wire); return m ? m[1] : null; };

// what a port carries: 'audio', or for an async port the type of its samples ('int' unless the block's
// wireTypes says otherwise, like 'array[uint8]'). Only ports that carry the same thing can be cabled together.
export const portWire = (def, name) => (portClock(def, name) === 'audio' ? 'audio' : (def.wireTypes && def.wireTypes[name]) || 'int');

// a saved value is only trusted if it still fits the parameter definition
export function validParam(p, v, params) {
  if (p.type === 'select') return optionsOf(p, params).includes(v) ? v : p.default;
  if (p.type === 'text') return typeof v === 'string' ? v.slice(0, p.maxLength || 100) : p.default;
  if (!Number.isFinite(v)) return p.default;
  const c = clamp(v, p.min, p.max);
  return p.step === 1 ? Math.round(c) : c;
}
