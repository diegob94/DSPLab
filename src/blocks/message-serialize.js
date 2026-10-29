import { isBits, shapeOf } from './message.js';

const SPAN = 4;   // the sinc pulse is cut off this many symbols to each side of its peak
const sinc = (x) => (x === 0 ? 1 : Math.sin(Math.PI * x) / (Math.PI * x));

// The bits of a message in transmission order: byte after byte ('columns') or row after row ('rows').
function bitStream(m, order) {
  if (order === 'rows') return m.flat();
  const out = [];
  for (let j = 0; j < m[0].length; j++) for (let i = 0; i < m.length; i++) out.push(m[i][j]);
  return out;
}

// Pulse-shapes a message: a train of impulses, one per bit, spaced sampleRate / baud samples apart,
// convolved with the pulse. Each impulse is added straight in rather than run through a generic
// convolution, which would multiply by all the zeros between them. Symbol k is centred on
// (k + 0.5) * samplesPerSymbol, plus SPAN symbols of lead-in for the sinc so its early tail isn't cut.
// A square pulse is one symbol long (NRZ); a sinc has zero crossings at the other symbols' centres.
export function waveform(m, { pulse, baud, levels, amplitude, order }, sampleRate) {
  const bits = bitStream(m, order);
  const sps = sampleRate / baud;
  const lead = pulse === 'sinc' ? SPAN : 0;
  const y = new Float32Array(Math.ceil((bits.length + 2 * lead) * sps));
  const low = levels === 'bipolar' ? -1 : 0;
  bits.forEach((bit, k) => {
    const a = (bit ? 1 : low) * amplitude;
    if (!a) return;
    if (pulse === 'sinc') {
      const c = (k + lead + 0.5) * sps;
      const to = Math.min(y.length - 1, Math.floor(c + SPAN * sps));
      for (let n = Math.max(0, Math.ceil(c - SPAN * sps)); n <= to; n++) y[n] += a * sinc((n - c) / sps);
    } else {
      const to = Math.min(y.length, Math.round((k + 1) * sps));
      for (let n = Math.round(k * sps); n < to; n++) y[n] += a;
    }
  });
  return y;
}

export const messageSerialize = {
  title: 'Message Serialize',
  category: 'Message blocks',
  inputs: ['msg'],
  outputs: ['out'],
  messagePorts: ['msg'],
  waveform,
  params: [
    { key: 'pulse',     label: 'Pulse',     show: true, type: 'select', options: ['square', 'sinc'], default: 'square' },
    { key: 'baud',      label: 'Baud rate', show: true, type: 'range', scale: 'log', min: 50, max: 20000, step: 1, unit: 'baud', default: 1000 },
    { key: 'levels',    label: 'Levels',    type: 'select', options: ['bipolar', 'unipolar'], default: 'bipolar' },
    { key: 'amplitude', label: 'Amplitude', type: 'range', min: 0, max: 1, step: 0.01, default: 0.5 },
    { key: 'order',     label: 'Read',      type: 'select', options: ['columns', 'rows'], default: 'columns' },
  ],
  build(ctx, p) {
    let params = p;
    const out = ctx.createGain();
    const playing = new Set();
    return {
      outputs: { out },
      inputs: { msg: { receive(m) {
        if (!isBits(m)) return;
        const y = waveform(m, params, ctx.sampleRate);
        const buffer = ctx.createBuffer(1, y.length, ctx.sampleRate);
        buffer.copyToChannel(y, 0);
        // one source per message, played once; a message that arrives meanwhile is added on top
        const src = ctx.createBufferSource();
        src.buffer = buffer;
        src.connect(out);
        src.onended = () => { playing.delete(src); src.disconnect(); };
        playing.add(src);
        src.start();
      } } },
      update(p) { params = p; },
      dispose() {
        playing.forEach((src) => { src.onended = null; src.stop(); src.disconnect(); });
        playing.clear();
        out.disconnect();
      },
    };
  },
};
