export const delay = {
  title: 'Delay',
  category: 'Processing blocks',
  inputs: ['in'],
  outputs: ['out'],
  params: [
    { key: 'delay', label: 'Delay', show: true, type: 'range', min: 0, max: 1000, step: 0.1, unit: 'ms', default: 10 },
  ],
  // One DelayNode. Changing the delay while running slides it, which pitch-shifts briefly.
  build(ctx, p) {
    const d = ctx.createDelay(1);
    const update = (p) => d.delayTime.setTargetAtTime(p.delay / 1000, ctx.currentTime, 0.01);
    d.delayTime.value = p.delay / 1000;
    return {
      inputs: { in: d },
      outputs: { out: d },
      update,
      dispose() { d.disconnect(); },
    };
  },
};
