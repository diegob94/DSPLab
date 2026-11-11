// signal in, signal out at factor times the sample rate: factor - 1 zeros are inserted after every sample. The input
// has to be a signal with a sample rate of its own (a Serializer's, or another Upsampler's): the sound card's would
// give an output the sound card can't carry.
export const upsampler = {
  title: 'Upsampler',
  category: 'Processing blocks',
  inputs: ['in'],
  outputs: ['out'],
  inputRate: 'rated',
  rates: { out: (params, inRate) => (inRate ? inRate * params.factor : null) },
  params: [
    { key: 'factor', label: 'Factor', show: true, type: 'range', min: 2, max: 64, step: 1, default: 2 },
  ],
  // the processor must be registered before build() can create the worklet node
  setup(ctx) {
    return ctx.audioWorklet.addModule(new URL('./upsampler-processor.js', import.meta.url).href);
  },
  build(ctx, p, node, wires, rates = {}) {
    let inRate = rates.in || ctx.sampleRate;
    let factor = p.factor;
    const node_ = new AudioWorkletNode(ctx, 'dsplab-upsampler', {
      numberOfInputs: 1, numberOfOutputs: 1, outputChannelCount: [1],
      channelCount: 1, channelCountMode: 'explicit',
      processorOptions: { inRate, factor },
    });
    // the node only runs if it reaches the destination, so keep a muted copy of it going there
    const mute = ctx.createGain();
    mute.gain.value = 0;
    node_.connect(mute).connect(ctx.destination);
    const send = () => node_.port.postMessage({ inRate, factor });
    return {
      inputs: { in: node_ },
      outputs: { out: node_ },
      update(p) { factor = p.factor; send(); },
      setRates(r) { inRate = r.in || ctx.sampleRate; send(); },
      dispose() { node_.port.onmessage = null; node_.disconnect(); mute.disconnect(); },
    };
  },
};
