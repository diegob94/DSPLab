const SPAN = 4;     // the sinc pulse is cut off this many symbols to each side of its peak
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

// A simple convolutional filter: its input is a signal and its output is that signal convolved with a pulse (an FIR
// filter whose impulse response is the pulse, `sps` samples per symbol), at the same sample rate. Fed with an impulse
// train (a one every `sps` samples, zeros between: what a Serializer followed by an Upsampler gives) it puts one pulse
// per symbol, which is what pulse shaping is. The kernel is the pulse of pulseSamples, scaled by the amplitude; a sinc
// is centred on its peak, so the output is delayed by half the kernel (4 symbols).
export const pulseShaper = {
  title: 'Pulse Shaper',
  category: 'Processing blocks',
  inputs: ['in'],
  outputs: ['out'],
  inputRate: 'any',
  rates: { out: (params, inRate) => inRate },   // a convolution keeps the sample rate
  pulseSamples,
  params: [
    { key: 'pulse',     label: 'Pulse',     show: true, type: 'select', options: ['square', 'sinc'], default: 'square' },
    { key: 'sps',       label: 'Samples / symbol', show: true, type: 'range', min: 1, max: 64, step: 1, default: 8 },
    { key: 'amplitude', label: 'Amplitude', type: 'range', min: 0, max: 1, step: 0.01, default: 0.5 },
  ],
  // the processor must be registered before build() can create the worklet node
  setup(ctx) {
    return ctx.audioWorklet.addModule(new URL('./shaper-processor.js', import.meta.url).href);
  },
  build(ctx, p, node, wires, rates = {}) {
    let inRate = rates.in || ctx.sampleRate;
    let params = p;
    const worklet = new AudioWorkletNode(ctx, 'dsplab-shaper', {
      numberOfInputs: 1, numberOfOutputs: 1, outputChannelCount: [1],
      channelCount: 1, channelCountMode: 'explicit',
      processorOptions: { inRate, pulse: p.pulse, sps: p.sps, amplitude: p.amplitude },
    });
    // the node only runs if it reaches the destination, so keep a muted copy of it going there
    const mute = ctx.createGain();
    mute.gain.value = 0;
    worklet.connect(mute).connect(ctx.destination);
    const send = () => worklet.port.postMessage({ inRate, pulse: params.pulse, sps: params.sps, amplitude: params.amplitude });
    return {
      inputs: { in: worklet },
      outputs: { out: worklet },
      update(p) { params = p; send(); },
      setRates(r) { inRate = r.in || ctx.sampleRate; send(); },
      dispose() { worklet.port.onmessage = null; worklet.disconnect(); mute.disconnect(); },
    };
  },
};
