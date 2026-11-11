'use strict';
const { before, after, test } = require('node:test');
const { assert, launch, withApp, addFromPalette, panelControl, startAudio, sleep } = require('./helpers');

let app;
before(async () => { app = await launch(); });
after(async () => { await app.close(); });

const SPS = 10;   // 44.1 kHz at 4410 baud: symbol centres fall on whole samples

// the pulse train of a list of bits, laid out the way the block does it, summed into one array
const wave = (page, bits, pulse, sps = SPS) => page.evaluate(([bits, pulse, sps]) => {
  const y = new Float32Array(Math.ceil((bits.length + 12) * sps));
  bits.forEach((b, k) => {
    const s = dsplab.BLOCKS.pulse_shaper.pulseSamples(pulse, k, sps, b, 1);
    if (s) s.data.forEach((v, i) => { y[Math.round(6 * sps) + s.start + i] += v; });
  });
  return Array.from(y);
}, [bits, pulse, sps]);

test('a square pulse holds each one for a whole symbol and tiles with the next', () => withApp(app, async (page) => {
  const y = await wave(page, [1, 0, 0, 1, 1], 'square');
  const at = (k, o) => y[6 * SPS + k * SPS + o];
  assert.deepEqual([at(0, 0), at(0, 9), at(1, 0), at(2, 9), at(3, 0), at(3, 9), at(4, 0), at(4, 9)], [1, 1, 0, 0, 1, 1, 1, 1]);
  // fractional samples per symbol: the pulses still tile with no gap and no overlap
  const r = await wave(page, [1, 1, 1, 1, 1, 1, 1], 'square', 7.3);
  const from = Math.round(6 * 7.3);
  assert.ok(r.slice(from, from + Math.round(7 * 7.3)).every((v) => v === 1), 'a run of ones is flat');
}));

test('a sinc pulse reproduces every bit at its symbol centre (no inter-symbol interference)', () => withApp(app, async (page) => {
  const bits = [1, 0, 1, 1, 0, 0, 1, 0];
  const y = await wave(page, bits, 'sinc');
  bits.forEach((b, k) => assert.ok(Math.abs(y[(6 + k) * SPS + 5] - b) < 1e-6, `bit ${k}`));
  assert.ok(y[(6 + 2) * SPS + 10] > 1.1, 'overshoot between two ones: a band-limited wave, not a staircase');
}));

test('a lone sinc pulse: peak 1, zeros at whole symbols, symmetric, sinc(0.5) = 2/pi', () => withApp(app, async (page) => {
  const y = await wave(page, [1], 'sinc');
  const c = 6 * SPS + 5;
  assert.ok(Math.abs(y[c] - 1) < 1e-6);
  for (const k of [1, 2, 3]) assert.ok(Math.abs(y[c + SPS * k]) < 1e-6 && Math.abs(y[c - SPS * k]) < 1e-6);
  assert.ok(Math.abs(y[c + 3] - y[c - 3]) < 1e-6);
  assert.ok(Math.abs(y[c + 5] - 2 / Math.PI) < 1e-6);
}));

// an input signal at `inRate` made of `symbols` (each held for sampleRate / inRate samples) through a ShaperSignal
const shape = (page, { symbols, inRate = 48000, sampleRate = 48000, pulse = 'square', sps = 4, amplitude = 1, late = 0 }) => page.evaluate(async ([symbols, inRate, sampleRate, pulse, sps, amplitude, late]) => {
  const { SerializerSignal } = await import('/src/blocks/serializer-core.js');
  const { ShaperSignal } = await import('/src/blocks/shaper-core.js');
  const src = new SerializerSignal(sampleRate, inRate);
  src.push(symbols);
  const sh = new ShaperSignal(sampleRate, inRate, pulse, sps, amplitude);
  const n = Math.ceil((symbols.length + 12 * sps) * sampleRate / inRate / 128) * 128;
  const inp = new Float32Array(n), out = new Float32Array(n);
  for (let i = 0; i < n; i += 128) {
    const a = inp.subarray(i, i + 128);
    src.process(a, i);
    if (i >= late) sh.process(a, out.subarray(i, i + 128), i);
  }
  return Array.from(out);
}, [symbols, inRate, sampleRate, pulse, sps, amplitude, late]);

test('it convolves its input with the pulse: an impulse train becomes one square pulse per one', () => withApp(app, async (page) => {
  // symbols at the sound card's rate (sps 4): 1 0 0 0 | 0 0 0 0 | 1 0 0 0 | 0 0 0 0 ...
  const y = await shape(page, { symbols: [1, 0, 0, 0, 0, 0, 0, 0, 1, 0, 0, 0], sps: 4 });
  assert.deepEqual(y.slice(0, 16), [1, 1, 1, 1, 0, 0, 0, 0, 1, 1, 1, 1, 0, 0, 0, 0]);
}));

test('a run of impulses tiles the square pulses, and the amplitude scales the kernel', () => withApp(app, async (page) => {
  const y = await shape(page, { symbols: [1, 0, 0, 0, 1, 0, 0, 0, 1, 0, 0, 0], sps: 4, amplitude: 0.5 });
  assert.deepEqual(y.slice(0, 12), Array(12).fill(0.5));
  assert.deepEqual((await shape(page, { symbols: [3, 0, 0, 0], sps: 4, amplitude: 0.5 })).slice(0, 5), [1.5, 1.5, 1.5, 1.5, 0]);   // linear
}));

test('a sinc pulse: peak at the middle of the kernel, zeros at whole symbols, symmetric', () => withApp(app, async (page) => {
  const sps = 4;
  const y = await shape(page, { symbols: [1], pulse: 'sinc', sps });
  const c = 4 * sps;   // the kernel is centred 4 symbols after the impulse
  assert.ok(Math.abs(y[c] - 1) < 1e-6);
  for (const k of [1, 2, 3]) assert.ok(Math.abs(y[c + sps * k]) < 1e-6 && Math.abs(y[c - sps * k]) < 1e-6);
  assert.ok(Math.abs(y[c + 1] - y[c - 1]) < 1e-6);
  assert.ok(Math.abs(y[c + 2] - 2 / Math.PI) < 1e-6);
}));

test('it works at the rate of its input: a signal at a lower rate is convolved at that rate and held', () => withApp(app, async (page) => {
  // 12000 samples/s into a 48000 Hz card: each input sample lasts 4 card samples; sps 3 = three input samples per pulse
  const y = await shape(page, { symbols: [1, 0, 0, 0, 0, 0, 1, 0, 0], inRate: 12000, sps: 3 });
  assert.deepEqual(y.slice(0, 36), [...Array(12).fill(1), ...Array(12).fill(0), ...Array(12).fill(1)]);
}));

test('the output stays in step with the input when its processor starts later', () => withApp(app, async (page) => {
  const a = await shape(page, { symbols: [1, 0, 0, 0, 0, 0, 0, 0, 1, 0, 0, 0, 0, 0, 0, 0, 1], sps: 4, inRate: 12000 });
  const b = await shape(page, { symbols: [1, 0, 0, 0, 0, 0, 0, 0, 1, 0, 0, 0, 0, 0, 0, 0, 1], sps: 4, inRate: 12000, late: 384 });
  assert.deepEqual(b.slice(1000), a.slice(1000));   // once it has heard a whole kernel it is the same
}));

test('Pulse Shaper has a signal in and a signal out (no async ports); its rate follows its input', () => withApp(app, async (page) => {
  for (const t of ['Strobe Source', 'Serializer', 'Upsampler', 'Pulse Shaper', 'Wave Generator']) await addFromPalette(page, t);
  assert.equal(await page.locator('.node:has-text("Pulse Shaper") .port.in').count(), 1);
  assert.equal(await page.locator('.node:has-text("Pulse Shaper") .port.out').count(), 1);
  assert.equal(await page.locator('.node:has-text("Pulse Shaper") .async').count(), 0);
  const r = await page.evaluate(async () => {
    const g = await import('/src/core/graph.js');
    const by = (t) => [...dsplab.graph.nodes.values()].find((n) => n.type === t);
    const [s, z, u, p, w] = ['strobe_source', 'serializer', 'upsampler', 'pulse_shaper', 'wave_generator'].map(by);
    const e = (a, ap, b, bp) => !!dsplab.addEdge({ node: a.id, port: ap }, { node: b.id, port: bp });
    z.params.baud = 500; u.params.factor = 8;
    e(s, 'out', z, 'in');
    const out = { fromWave: e(w, 'out', p, 'in'), wave: g.outRate(p, 'out') };   // the sound card's rate, kept
    e(z, 'out', u, 'in'); e(u, 'out', p, 'in');
    out.chain = g.outRate(p, 'out');                                              // 500 * 8
    return out;
  });
  assert.deepEqual(r, { fromWave: true, wave: null, chain: 4000 });
}));

test('Pulse Shaper in the engine accepts live changes', () => withApp(app, async (page) => {
  for (const t of ['Wave Generator', 'Pulse Shaper', 'Audio Sink']) await addFromPalette(page, t);
  await page.evaluate(() => {
    const by = (t) => [...dsplab.graph.nodes.values()].find((n) => n.type === t);
    const [w, p, k] = ['wave_generator', 'pulse_shaper', 'audio_sink'].map(by);
    dsplab.addEdge({ node: w.id, port: 'out' }, { node: p.id, port: 'in' });
    dsplab.addEdge({ node: p.id, port: 'out' }, { node: k.id, port: 'in' });
  });
  await startAudio(page);
  // new blocks overlap at the canvas centre, so select it through the model rather than by clicking
  await page.evaluate(() => dsplab.select({ kind: 'node', id: [...dsplab.graph.nodes.values()].find((n) => n.type === 'pulse_shaper').id }));
  await panelControl(page, 'Pulse').selectOption('sinc');   // live change, no rebuild
  await sleep(300);
  assert.match(await page.textContent('#status'), /^Running/);
}));
