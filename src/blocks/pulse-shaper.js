import { isBits } from './message.js';

const SPAN = 4;     // the sinc pulse is cut off this many symbols to each side of its peak
const LEAD = 0.05;  // s of head start when the shaper is idle, so symbols that arrive in a burst can be placed
const sinc = (x) => (x === 0 ? 1 : Math.sin(Math.PI * x) / (Math.PI * x));

// The samples of symbol k on a grid of sps samples per symbol: { start, data }, start being the first
// sample, counted from the start of the grid (negative for the sinc's early tail). Symbol k is centred
// on (k + 0.5) * sps. A square pulse is one symbol long (NRZ) and consecutive ones tile exactly; a sinc
// has zero crossings at the other symbols' centres. Returns null when there is nothing to play.
export function pulseSamples(pulse, k, sps, bit, amplitude) {
  if (!bit || !amplitude) return null;
  if (pulse === 'sinc') {
    const c = (k + 0.5) * sps;
    const from = Math.ceil(c - SPAN * sps);
    const data = new Float32Array(Math.floor(c + SPAN * sps) - from + 1);
    for (let i = 0; i < data.length; i++) data[i] = amplitude * sinc((from + i - c) / sps);
    return { start: from, data };
  }
  const start = Math.round(k * sps);
  return { start, data: new Float32Array(Math.round((k + 1) * sps) - start).fill(amplitude) };
}

// Pulse-shapes a train of symbols: the convolution of an impulse train (1 for a one, 0 for a zero, one per
// 1x1 message) with the pulse, done by adding one pulse per one rather than convolving with all the zeros.
// Symbols are placed on a grid of 1 / baud, one slot after the other: it doesn't matter when exactly a
// message arrives (a serializer sends them in bursts), only in which order.
export const pulseShaper = {
  title: 'Pulse Shaper',
  category: 'Processing blocks',
  inputs: ['msg'],
  outputs: ['out'],
  messagePorts: ['msg'],
  pulseSamples,
  params: [
    { key: 'pulse',     label: 'Pulse',     show: true, type: 'select', options: ['square', 'sinc'], default: 'square' },
    { key: 'baud',      label: 'Baud rate', show: true, type: 'range', scale: 'log', min: 50, max: 20000, step: 1, unit: 'baud', default: 1000 },
    { key: 'amplitude', label: 'Amplitude', type: 'range', min: 0, max: 1, step: 0.01, default: 0.5 },
  ],
  build(ctx, p) {
    let params = p;
    const out = ctx.createGain();
    const playing = new Set();
    let origin = 0;     // sample at which slot 0 starts
    let k = -1;         // slot of the last symbol; -1 when idle
    return {
      outputs: { out },
      inputs: { msg: { receive(m) {
        if (!isBits(m) || m.length !== 1 || m[0].length !== 1) return;
        const sps = ctx.sampleRate / params.baud;
        // idle, or the stream fell behind real time: begin a new one a little ahead (the sinc's lead-in needs room)
        if (k < 0 || origin + Math.round((k + 1) * sps) < ctx.currentTime * ctx.sampleRate) {
          origin = Math.ceil(ctx.currentTime * ctx.sampleRate + Math.max(LEAD * ctx.sampleRate, (SPAN + 1) * sps));
          k = -1;
        }
        k++;
        const s = pulseSamples(params.pulse, k, sps, m[0][0], params.amplitude);
        if (!s) return;
        const buffer = ctx.createBuffer(1, s.data.length, ctx.sampleRate);
        buffer.copyToChannel(s.data, 0);
        const src = ctx.createBufferSource();
        src.buffer = buffer;
        src.connect(out);
        src.onended = () => { playing.delete(src); src.disconnect(); };
        playing.add(src);
        src.start((origin + s.start) / ctx.sampleRate);
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
