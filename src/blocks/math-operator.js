export const mathOperator = {
  title: 'Math Operator',
  category: 'Processing blocks',
  inputs: ['a', 'b'],
  outputs: ['out'],
  params: [
    { key: 'operation', label: 'Operation', show: true, type: 'select', options: ['add', 'subtract', 'multiply'], default: 'add' },
  ],
  // An unconnected input counts as 0. Every operation shares one topology and
  // is selected by gains, so changing it needs no graph rebuild:
  //   out = ka*a + kb*b + km*(a*b),  with a*b made by driving a gain's AudioParam with b
  build(ctx, p) {
    const a = ctx.createGain(), b = ctx.createGain();
    const ga = ctx.createGain(), gb = ctx.createGain();
    const prod = ctx.createGain(), gm = ctx.createGain();
    const out = ctx.createGain();
    prod.gain.value = 0;
    a.connect(ga).connect(out);
    b.connect(gb).connect(out);
    a.connect(prod);
    b.connect(prod.gain);
    prod.connect(gm).connect(out);
    const all = [a, b, ga, gb, prod, gm, out];
    const K = { add: [1, 1, 0], subtract: [1, -1, 0], multiply: [0, 0, 1] };
    const update = (p) => {
      const t = ctx.currentTime;
      const [ka, kb, km] = K[p.operation];
      ga.gain.setTargetAtTime(ka, t, 0.005);
      gb.gain.setTargetAtTime(kb, t, 0.005);
      gm.gain.setTargetAtTime(km, t, 0.005);
    };
    update(p);
    return {
      inputs: { a, b },
      outputs: { out },
      update,
      dispose() { all.forEach((n) => n.disconnect()); },
    };
  },
};
