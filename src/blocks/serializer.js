// array of numbers in, signal out. The input arrays go into a buffer and the output is a signal whose sample rate is
// the baud rate: it takes one sample every 1 / baud seconds, for as long as the block runs, the next number of the
// buffer or 0 when the buffer is empty. Integers (of any width) become floats implicitly: the values are the same.
// The output is the same kind of signal as the audio of the sound card, only with another sample rate: it is
// delivered at the sound card's rate holding each sample for its whole period, and the cables refuse to join ports
// with different sample rates (see graph.js).
export const serializer = {
  title: 'Serializer',
  category: 'Processing blocks',
  inputs: ['in'],
  outputs: ['out'],
  asyncPorts: ['in'],
  wireTypes: { in: 'array[numeric]' },
  rates: { out: (params) => params.baud },   // samples per second of the output; audio ports without one run at the sound card's rate
  params: [
    { key: 'baud', label: 'Baud rate', show: true, type: 'range', scale: 'log', min: 50, max: 20000, step: 1, unit: 'baud', default: 1000 },
  ],
  // the processor must be registered before build() can create the worklet node
  setup(ctx) {
    return ctx.audioWorklet.addModule(new URL('./serializer-processor.js', import.meta.url).href);
  },
  build(ctx, p) {
    const node = new AudioWorkletNode(ctx, 'dsplab-serializer', {
      numberOfInputs: 0, numberOfOutputs: 1, outputChannelCount: [1],
      processorOptions: { baud: p.baud },
    });
    // the node only runs if it reaches the destination, so keep a muted copy of it going there even when nothing is cabled
    const mute = ctx.createGain();
    mute.gain.value = 0;
    node.connect(mute).connect(ctx.destination);
    return {
      outputs: { out: node },
      inputs: { in: { receive(items) { if (Array.isArray(items) && items.every(Number.isFinite)) node.port.postMessage({ items }); } } },
      update(p) { node.port.postMessage({ baud: p.baud }); },
      dispose() { node.disconnect(); mute.disconnect(); },
    };
  },
};
