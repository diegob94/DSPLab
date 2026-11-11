'use strict';
const { before, after, test } = require('node:test');
const { assert, launch, withApp, addFromPalette } = require('./helpers');

let app;
before(async () => { app = await launch(); });
after(async () => { await app.close(); });

// one page-side helper: adds the blocks, then runs `fn(by, edge)` where by(type, n) is the n-th block of that type
const scenario = (page, types, fn) => page.evaluate(async ([types, fn]) => {
  const g = await import('/src/core/graph.js');
  const by = (t, n = 0) => [...dsplab.graph.nodes.values()].filter((x) => x.type === t)[n];
  const edge = (a, ap, b, bp) => !!dsplab.addEdge({ node: a.id, port: ap }, { node: b.id, port: bp });
  return new Function('by', 'edge', 'g', 'dsplab', `return (async () => { ${fn} })();`)(by, edge, g, dsplab);
}, [types, fn]);

test('blocks that need the sound card rate refuse a signal at another sample rate', () => withApp(app, async (page) => {
  for (const t of ['Strobe Source', 'Serializer', 'Audio Sink', 'Math Operator', 'Filter', 'FFT Plot']) await addFromPalette(page, t);
  const r = await scenario(page, [], `
    edge(by('strobe_source'), 'out', by('serializer'), 'in');
    return ['audio_sink:in', 'math_operator:a', 'filter:in', 'fft_plot:in'].map((s) => edge(by('serializer'), 'out', by(s.split(':')[0]), s.split(':')[1]));`);
  assert.deepEqual(r, [false, false, false, false]);
}));

test('the oscilloscope takes any sample rate on each of its inputs', () => withApp(app, async (page) => {
  for (const t of ['Strobe Source', 'Serializer', 'Serializer', 'Wave Generator', 'Oscilloscope']) await addFromPalette(page, t);
  const r = await scenario(page, [], `
    const [s, z1, z2, w, o] = [by('strobe_source'), by('serializer', 0), by('serializer', 1), by('wave_generator'), by('oscilloscope')];
    o.params.channels = 3; dsplab.rebuildPorts(o);
    z1.params.baud = 1000; z2.params.baud = 2000;
    edge(s, 'out', z1, 'in'); edge(s, 'out', z2, 'in');
    return [edge(z1, 'out', o, 'ch1'), edge(z2, 'out', o, 'ch2'), edge(w, 'out', o, 'ch3'), dsplab.graph.edges.filter((x) => x.to.node === o.id).length];`);
  assert.deepEqual(r, [true, true, true, 3]);
}));

test('changing the baud rate keeps the cables to a scope', () => withApp(app, async (page) => {
  for (const t of ['Strobe Source', 'Serializer', 'Oscilloscope']) await addFromPalette(page, t);
  const r = await scenario(page, [], `
    const [s, z, o] = [by('strobe_source'), by('serializer'), by('oscilloscope')];
    edge(s, 'out', z, 'in'); edge(z, 'out', o, 'ch1');
    g.setParam(z, 'baud', 3000);
    return dsplab.graph.edges.filter((x) => x.to.node === o.id).length;`);
  assert.equal(r, 1);
}));

test('each channel of a running scope is told its own rate, and the rate follows the Serializer live', () => withApp(app, async (page) => {
  for (const t of ['Strobe Source', 'Serializer', 'Wave Generator', 'Oscilloscope']) await addFromPalette(page, t);
  const r = await scenario(page, [], `
    const [s, z, w, o] = [by('strobe_source'), by('serializer'), by('wave_generator'), by('oscilloscope')];
    z.params.baud = 4800; s.params.period = 50;
    edge(s, 'out', z, 'in'); edge(z, 'out', o, 'ch1'); edge(w, 'out', o, 'ch2');
    await dsplab.engine.start();
    const inst = dsplab.engine.live.get(o.id);
    const first = inst.channelRates.slice();
    g.setParam(z, 'baud', 1200);
    const second = inst.channelRates.slice();
    await dsplab.engine.stop();
    return [first, second, inst.sampleRate > 0];`);
  assert.deepEqual(r, [[4800, null], [1200, null], true]);
}));

test('Upsampler needs a signal with a sample rate of its own and multiplies it by the factor', () => withApp(app, async (page) => {
  for (const t of ['Strobe Source', 'Serializer', 'Upsampler', 'Wave Generator', 'Audio Sink', 'Oscilloscope']) await addFromPalette(page, t);
  const r = await scenario(page, [], `
    const [s, z, u, w, k, o] = [by('strobe_source'), by('serializer'), by('upsampler'), by('wave_generator'), by('audio_sink'), by('oscilloscope')];
    z.params.baud = 1000; u.params.factor = 4;
    edge(s, 'out', z, 'in');
    const out = {};
    out.native = edge(w, 'out', u, 'in');           // the sound card's rate: refused
    out.serializer = edge(z, 'out', u, 'in');
    out.rate = g.outRate(u, 'out');
    out.toSink = edge(u, 'out', k, 'in');           // 4000 samples/s: the Audio Sink needs the sound card's
    out.toScope = edge(u, 'out', o, 'ch1');
    g.setParam(z, 'baud', 2000);
    out.followed = g.outRate(u, 'out');             // the rate follows the Serializer
    g.setParam(u, 'factor', 8);
    out.factor = g.outRate(u, 'out');
    return out;`);
  assert.deepEqual(r, { native: false, serializer: true, rate: 4000, toSink: false, toScope: true, followed: 8000, factor: 16000 });
}));

test('Upsamplers chain, and cutting the input leaves the output without a rate (cables that need one are dropped)', () => withApp(app, async (page) => {
  for (const t of ['Strobe Source', 'Serializer', 'Upsampler', 'Upsampler', 'Audio Sink']) await addFromPalette(page, t);
  const r = await scenario(page, [], `
    const [s, z, u1, u2] = [by('strobe_source'), by('serializer'), by('upsampler', 0), by('upsampler', 1)];
    z.params.baud = 100; u1.params.factor = 2; u2.params.factor = 3;
    edge(s, 'out', z, 'in');
    const out = {};
    out.u1 = edge(z, 'out', u1, 'in'); out.u2 = edge(u1, 'out', u2, 'in');
    out.rate = g.outRate(u2, 'out');                 // 100 * 2 * 3
    dsplab.graph.edges.filter((x) => x.from.node === z.id).forEach((x) => dsplab.removeEdge(x));
    out.after = dsplab.graph.edges.filter((x) => x.to.node === u2.id).length;   // u1 -> u2 loses its rate: no longer fits
    return out;`);
  assert.deepEqual(r, { u1: true, u2: true, rate: 600, after: 0 });
}));

test('a signal at exactly the sound card rate is the sound card rate: it can go to an Audio Sink', () => withApp(app, async (page) => {
  for (const t of ['Strobe Source', 'Serializer', 'Upsampler', 'Audio Sink', 'Filter']) await addFromPalette(page, t);
  const r = await scenario(page, [], `
    const [s, z, u, k, f] = [by('strobe_source'), by('serializer'), by('upsampler'), by('audio_sink'), by('filter')];
    g.setNativeRate(48000);
    z.params.baud = 1000; u.params.factor = 48;           // 48000 samples/s
    edge(s, 'out', z, 'in'); edge(z, 'out', u, 'in');
    const out = {};
    out.sink = edge(u, 'out', k, 'in');
    out.filter = edge(u, 'out', f, 'in');
    u.params.factor = 64; g.setParam(u, 'factor', 64);     // 64000: faster than the sound card can carry
    out.tooFast = dsplab.graph.edges.filter((x) => x.from.node === u.id).length;
    u.params.factor = 47; g.setParam(u, 'factor', 47);     // 47000
    out.slower = edge(u, 'out', k, 'in');
    return out;`);
  assert.deepEqual(r, { sink: true, filter: true, tooFast: 0, slower: false });
}));

test('the Upsampler refuses a signal at the sound card rate, also when it comes from another Upsampler', () => withApp(app, async (page) => {
  for (const t of ['Strobe Source', 'Serializer', 'Upsampler', 'Upsampler']) await addFromPalette(page, t);
  const r = await scenario(page, [], `
    const [s, z, u1, u2] = [by('strobe_source'), by('serializer'), by('upsampler', 0), by('upsampler', 1)];
    g.setNativeRate(48000);
    z.params.baud = 1000; u1.params.factor = 48; u2.params.factor = 2;
    edge(s, 'out', z, 'in');
    return [edge(z, 'out', u1, 'in'), edge(u1, 'out', u2, 'in')];`);   // u1 sends 48000 samples/s: the sound card's
  assert.deepEqual(r, [true, false]);
}));
