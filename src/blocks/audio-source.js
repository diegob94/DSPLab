// Microphone / line input. The stream is requested once per Run (in setup, only if the diagram
// uses this block); build() is synchronous, so a block added while running stays silent until
// the next Run.
const streams = new WeakMap();   // AudioContext -> MediaStream

export const audioSource = {
  title: 'Audio Source',
  category: 'Source blocks',
  inputs: [],
  outputs: ['out'],
  params: [
    { key: 'gain', label: 'Gain', show: true, type: 'range', min: 0, max: 2, step: 0.01, default: 1 },
  ],
  async setup(ctx, inUse) {
    if (!inUse) return;
    // raw signal: echo cancellation, noise suppression and AGC would colour the DSP
    const stream = await navigator.mediaDevices.getUserMedia({
      audio: { echoCancellation: false, noiseSuppression: false, autoGainControl: false },
    });
    streams.set(ctx, stream);
    // release the microphone (and the browser's recording indicator) when the engine stops
    ctx.addEventListener('statechange', () => {
      if (ctx.state === 'closed') stream.getTracks().forEach((t) => t.stop());
    });
  },
  build(ctx, p) {
    const gain = ctx.createGain();
    const stream = streams.get(ctx);
    const src = stream ? ctx.createMediaStreamSource(stream) : null;
    if (src) src.connect(gain);
    const update = (p) => gain.gain.setTargetAtTime(p.gain, ctx.currentTime, 0.01);
    update(p);
    return {
      outputs: { out: gain },
      update,
      dispose() { if (src) src.disconnect(); gain.disconnect(); },
    };
  },
};
