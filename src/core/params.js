import { clamp } from '../util.js';

export const optionsOf = (p, params) => (typeof p.options === 'function' ? p.options(params) : p.options);
export const portNames = (def, dir, params) => (typeof def[dir] === 'function' ? def[dir](params) : def[dir]);

export const portKind = (def, name) => ((def.messagePorts || []).includes(name) ? 'message' : 'audio');

// a saved value is only trusted if it still fits the parameter definition
export function validParam(p, v, params) {
  if (p.type === 'select') return optionsOf(p, params).includes(v) ? v : p.default;
  if (p.type === 'text') return typeof v === 'string' ? v.slice(0, p.maxLength || 100) : p.default;
  if (!Number.isFinite(v)) return p.default;
  const c = clamp(v, p.min, p.max);
  return p.step === 1 ? Math.round(c) : c;
}
