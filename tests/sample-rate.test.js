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

test('the oscilloscope takes the sample rate of its inputs and refuses other rates once it has one', () => withApp(app, async (page) => {
  for (const t of ['Strobe Source', 'Serializer', 'Serializer', 'Wave Generator', 'Oscilloscope']) await addFromPalette(page, t);
  const r = await scenario(page, [], `
    const [s, z1, z2, w, o] = [by('strobe_source'), by('serializer', 0), by('serializer', 1), by('wave_generator'), by('oscilloscope')];
    o.params.channels = 3; dsplab.rebuildPorts(o);
    z1.params.baud = 1000; z2.params.baud = 2000;
    edge(s, 'out', z1, 'in'); edge(s, 'out', z2, 'in');
    const out = {};
    out.first = edge(z1, 'out', o, 'ch1');         // takes 1000 samples/s
    out.native = edge(w, 'out', o, 'ch2');         // the sound card's rate: not the same
    out.other = edge(z2, 'out', o, 'ch2');         // 2000: not the same
    z2.params.baud = 1000; g.setParam(z2, 'baud', 1000);
    out.same = edge(z2, 'out', o, 'ch2');          // 1000: fine
    out.edges = dsplab.graph.edges.filter((x) => x.to.node === o.id).length;
    return out;`);
  assert.deepEqual(r, { first: true, native: false, other: false, same: true, edges: 2 });
}));

test('a scope with a plain audio input refuses a signal at another rate, and an empty scope takes anything', () => withApp(app, async (page) => {
  for (const t of ['Strobe Source', 'Serializer', 'Wave Generator', 'Oscilloscope']) await addFromPalette(page, t);
  const r = await scenario(page, [], `
    const [s, z, w, o] = [by('strobe_source'), by('serializer'), by('wave_generator'), by('oscilloscope')];
    edge(s, 'out', z, 'in');
    const out = {};
    out.audio = edge(w, 'out', o, 'ch1');
    out.signal = edge(z, 'out', o, 'ch2');
    return out;`);
  assert.deepEqual(r, { audio: true, signal: false });
}));

test('replacing the cable on a port may change the rate when no other input has one', () => withApp(app, async (page) => {
  for (const t of ['Strobe Source', 'Serializer', 'Wave Generator', 'Oscilloscope']) await addFromPalette(page, t);
  const r = await scenario(page, [], `
    const [s, z, w, o] = [by('strobe_source'), by('serializer'), by('wave_generator'), by('oscilloscope')];
    edge(s, 'out', z, 'in');
    const out = {};
    out.audio = edge(w, 'out', o, 'ch1');
    out.replace = edge(z, 'out', o, 'ch1');          // it replaces the only cable, so the rate may change
    out.then = dsplab.graph.edges.filter((x) => x.to.node === o.id).map((x) => x.from.node === z.id);
    return out;`);
  assert.deepEqual(r, { audio: true, replace: true, then: [true] });
}));

test('changing the baud rate drops the cables whose rate no longer agrees', () => withApp(app, async (page) => {
  for (const t of ['Strobe Source', 'Serializer', 'Serializer', 'Oscilloscope']) await addFromPalette(page, t);
  const r = await scenario(page, [], `
    const [s, z1, z2, o] = [by('strobe_source'), by('serializer', 0), by('serializer', 1), by('oscilloscope')];
    z1.params.baud = 1000; z2.params.baud = 1000;
    edge(s, 'out', z1, 'in'); edge(s, 'out', z2, 'in');
    edge(z1, 'out', o, 'ch1'); edge(z2, 'out', o, 'ch2');
    const before = dsplab.graph.edges.filter((x) => x.to.node === o.id).length;
    g.setParam(z2, 'baud', 3000);
    return [before, dsplab.graph.edges.filter((x) => x.to.node === o.id).length];`);
  assert.deepEqual(r, [2, 1]);
}));

test('the signal reaches a scope in the engine, which reports the rate of its inputs', () => withApp(app, async (page) => {
  for (const t of ['Strobe Source', 'Serializer', 'Oscilloscope']) await addFromPalette(page, t);
  const r = await scenario(page, [], `
    const [s, z, o] = [by('strobe_source'), by('serializer'), by('oscilloscope')];
    z.params.baud = 4800; s.params.period = 50;
    edge(s, 'out', z, 'in'); edge(z, 'out', o, 'ch1');
    await dsplab.engine.start();
    const rate = dsplab.engine.live.get(o.id).rate;
    await dsplab.engine.stop();
    return rate;`);
  assert.equal(r, 4800);
}));
