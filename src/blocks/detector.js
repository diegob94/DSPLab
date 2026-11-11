// A comparator: the output is 1 while the input is above the threshold and 0 otherwise, sample by sample, at the
// rate of the input. It turns a waveform (e.g. a Matched Filter's output) into a clean 0 / 1 signal.
export const detector = {
  title: 'Detector',
  category: 'Processing blocks',
  inputs: ['in'],
  outputs: ['out'],
  inputRate: 'any',
  rates: { out: (params, inRate) => inRate },   // a comparison keeps the sample rate
  params: [
    { key: 'threshold', label: 'Threshold', show: true, type: 'range', min: -2, max: 2, step: 0.01, default: 0.5 },
  ],
  // the processor must be registered before build() can create the worklet node
  setup(ctx) {
    return ctx.audioWorklet.addModule(new URL('./detector-processor.js', import.meta.url).href);
  },
  build(ctx, p) {
    const worklet = new AudioWorkletNode(ctx, 'dsplab-detector', {
      numberOfInputs: 1, numberOfOutputs: 1, outputChannelCount: [1],
      channelCount: 1, channelCountMode: 'explicit',
      processorOptions: { threshold: p.threshold },
    });
    // the node only runs if it reaches the destination, so keep a muted copy of it going there
    const mute = ctx.createGain();
    mute.gain.value = 0;
    worklet.connect(mute).connect(ctx.destination);
    return {
      inputs: { in: worklet },
      outputs: { out: worklet },
      update(p) { worklet.port.postMessage({ threshold: p.threshold }); },
      dispose() { worklet.port.onmessage = null; worklet.disconnect(); mute.disconnect(); },
    };
  },
};
