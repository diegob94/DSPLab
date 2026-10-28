export const audioSink = {
  title: 'Audio Sink',
  category: 'Sink blocks',
  inputs: ['in'],
  outputs: [],
  params: [
    { key: 'volume', label: 'Volume', show: true, type: 'range', min: 0, max: 1, step: 0.01, default: 0.8 },
  ],
  build(ctx, p) {
    const gain = ctx.createGain();
    gain.connect(ctx.destination);
    const update = (p) => gain.gain.setTargetAtTime(p.volume, ctx.currentTime, 0.01);
    update(p);
    return {
      inputs: { in: gain },
      update,
      dispose() { gain.disconnect(); },
    };
  },
};
