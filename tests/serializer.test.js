'use strict';
const { before, after, test } = require('node:test');
const { assert, launch, withApp, addFromPalette, startAudio } = require('./helpers');

let app;
before(async () => { app = await launch(); });
after(async () => { await app.close(); });

// the signal behind the block: [numbers to push | null, number of output samples to take] steps; returns what came out
const run = (page, steps, { baud = 1000, sampleRate = 48000 } = {}) => page.evaluate(async ([steps, baud, sampleRate]) => {
  const { SerializerSignal } = await import('/src/blocks/serializer-core.js');
  const s = new SerializerSignal(sampleRate, baud);
  const out = [];
  let frame = 0;
  for (const [items, n] of steps) {
    if (items) s.push(items);
    const buf = new Float32Array(n);
    s.process(buf, frame);
    frame += n;
    out.push(...buf);
  }
  return out;
}, [steps, baud, sampleRate]);

// one sample per symbol, from the output samples
const every = (out, per) => out.filter((_, i) => i % per === 0);

test('each number is held for a whole period (sampleRate / baud output samples), then the next one', () => withApp(app, async (page) => {
  const out = await run(page, [[[3, -2.5, 7], 480]], { baud: 4800 });   // 10 output samples per symbol
  assert.deepEqual(out.slice(0, 10), Array(10).fill(3));
  assert.deepEqual(out.slice(10, 20), Array(10).fill(-2.5));
  assert.deepEqual(out.slice(20, 30), Array(10).fill(7));
  assert.ok(out.slice(30).every((v) => v === 0), 'then zeros');
}));

test('it never stops: an empty buffer gives zeros, and numbers that arrive later are consumed on the next symbol', () => withApp(app, async (page) => {
  const out = await run(page, [[null, 100], [[1, 2], 40]], { baud: 4800 });
  assert.ok(out.slice(0, 100).every((v) => v === 0));
  assert.deepEqual(out.slice(100, 110), Array(10).fill(1));   // symbols start every 10 samples
  assert.deepEqual(out.slice(110, 120), Array(10).fill(2));
  assert.ok(out.slice(120).every((v) => v === 0));
}));

test('the average rate is exactly the baud rate, also when it does not divide the sound card rate', () => withApp(app, async (page) => {
  const out = await run(page, [[Array.from({ length: 1000 }, (_, i) => i + 1), 48000]], { baud: 700 });   // one second
  const changes = out.filter((v, i) => i === 0 || v !== out[i - 1]).length;
  assert.equal(changes, 700);
  assert.equal(out[out.length - 1], 700);
}));

test('a new rate takes effect from the next sample', () => withApp(app, async (page) => {
  const out = await page.evaluate(async () => {
    const { SerializerSignal } = await import('/src/blocks/serializer-core.js');
    const s = new SerializerSignal(48000, 4800);
    s.push([1, 2, 3, 4, 5, 6]);
    const a = new Float32Array(20); s.process(a, 0);       // 1, 2
    s.set(2400);
    const b = new Float32Array(40); s.process(b, 20);      // 20 samples per symbol from now on, on the grid of the new rate
    return [Array.from(a), Array.from(b)];
  });
  assert.deepEqual(out[0], [...Array(10).fill(1), ...Array(10).fill(2)]);
  assert.deepEqual(out[1], [...Array(20).fill(2), ...Array(20).fill(3)]);   // 2 is still held when the new grid says symbol 1 goes on until frame 40
}));

test('Serializer takes an array of numbers (async) and gives a signal (audio); ignores what is not an array of numbers', () => withApp(app, async (page) => {
  for (const t of ['Strobe Source', 'Serializer', 'Pulse Shaper', 'Audio Sink']) await addFromPalette(page, t);
  assert.equal(await page.locator('.node:has-text("Serializer") .port.in.async').count(), 1);
  assert.equal(await page.locator('.node:has-text("Serializer") .port.out').count(), 1);
  assert.equal(await page.locator('.node:has-text("Serializer") .port.out.async').count(), 0, 'its output is a signal');
  const r = await page.evaluate(() => {
    const by = (t) => [...dsplab.graph.nodes.values()].find((n) => n.type === t);
    const [s, z, p, k] = ['strobe_source', 'serializer', 'pulse_shaper', 'audio_sink'].map(by);
    const e = (a, ap, b, bp) => !!dsplab.addEdge({ node: a.id, port: ap }, { node: b.id, port: bp });
    return {
      fromStrobe: e(s, 'out', z, 'in'),     // array[uint8]
      toSink: e(z, 'out', k, 'in'),         // a signal at the baud rate; the Audio Sink needs the sound card's
      audioToIn: e(k, 'out', z, 'in') || e(p, 'out', z, 'in'),
    };
  });
  assert.deepEqual(r, { fromStrobe: true, toSink: false, audioToIn: false });
}));

test('the input takes arrays of numbers, not arrays of arrays', () => withApp(app, async (page) => {
  for (const t of ['Strobe Source', 'Array Unpack', 'Array Reshape', 'Serializer']) await addFromPalette(page, t);
  const r = await page.evaluate(async () => {
    const g = await import('/src/core/graph.js');
    const by = (t) => [...dsplab.graph.nodes.values()].find((n) => n.type === t);
    const [s, u, z, k] = ['strobe_source', 'array_unpack', 'array_reshape', 'serializer'].map(by);
    const e = (a, ap, b, bp) => !!dsplab.addEdge({ node: a.id, port: ap }, { node: b.id, port: bp });
    const out = {};
    out.flat = e(s, 'out', k, 'in');
    e(s, 'out', u, 'in');
    out.nested = e(u, 'out', k, 'in');
    out.stillFlat = dsplab.graph.edges.some((x) => x.from.node === s.id && x.to.node === k.id);
    e(s, 'out', z, 'in');
    out.reshapeNested = e(z, 'out', k, 'in');
    g.setParam(z, 'rows', 0);
    out.reshapeFlat = e(z, 'out', k, 'in');
    g.setParam(z, 'rows', 3);
    out.dropped = !dsplab.graph.edges.some((x) => x.from.node === z.id && x.to.node === k.id);
    return out;
  });
  assert.deepEqual(r, { flat: true, nested: false, stillFlat: true, reshapeNested: false, reshapeFlat: true, dropped: true });
}));

test('the Serializer runs in the engine and an Oscilloscope takes it', () => withApp(app, async (page) => {
  for (const t of ['Strobe Source', 'Serializer', 'Oscilloscope']) await addFromPalette(page, t);
  await page.evaluate(() => {
    const by = (t) => [...dsplab.graph.nodes.values()].find((n) => n.type === t);
    const [s, z, o] = ['strobe_source', 'serializer', 'oscilloscope'].map(by);
    s.params.period = 50;
    z.params.baud = 4800;
    dsplab.addEdge({ node: s.id, port: 'out' }, { node: z.id, port: 'in' });
    dsplab.addEdge({ node: z.id, port: 'out' }, { node: o.id, port: 'ch1' });
  });
  await startAudio(page);
  const rates = await page.evaluate(() => dsplab.engine.live.get([...dsplab.graph.nodes.values()].find((n) => n.type === 'oscilloscope').id).channelRates);
  assert.deepEqual(rates, [4800, null], 'the scope knows the rate of each input');
  assert.match(await page.textContent('#status'), /^Running/);
}));
