'use strict';
const { before, after, test } = require('node:test');
const { assert, launch, withApp, addFromPalette, startAudio, sleep } = require('./helpers');

let app;
before(async () => { app = await launch(); });
after(async () => { await app.close(); });

const SPS = 10;

// bits -> pulse shaper waveform (at the sound card's rate) -> optional noise -> the matched filter's signal
const run = (page, bits, pulse, noise = 0) => page.evaluate(async ([bits, pulse, noise, sps]) => {
  const { ShaperSignal } = await import('/src/blocks/shaper-core.js');
  const n = Math.ceil((bits.length + 30) * sps / 128) * 128;
  const x = new Float32Array(n);
  let seed = 1;
  const rnd = () => ((seed = (seed * 1664525 + 1013904223) >>> 0) / 2 ** 32 - 0.5) * 2;
  bits.forEach((b, k) => {
    const s = dsplab.BLOCKS.pulse_shaper.pulseSamples(pulse, k, sps, b, 1);
    if (s) s.data.forEach((v, i) => { x[15 * sps + s.start + i] += v; });
  });
  for (let i = 0; i < n; i++) x[i] += noise * rnd();
  const mf = new ShaperSignal(48000, 48000, pulse, sps, true);
  const y = new Float32Array(n);
  for (let i = 0; i < n; i += 128) mf.process(x.subarray(i, i + 128), y.subarray(i, i + 128), i);
  return Array.from(y);
}, [bits, pulse, noise, SPS]);

const bits = [1, 0, 1, 1, 0, 0, 1, 0];

test('square: the output peaks at the end of each symbol with the original amplitude', () => withApp(app, async (page) => {
  const y = await run(page, bits, 'square');
  // symbol k spans [15+k, 16+k) * SPS; the peak is its last sample
  bits.forEach((b, k) => assert.ok(Math.abs(y[(16 + k) * SPS - 1] - b) < 1e-4, `bit ${k}`));
}));

test('sinc: no inter-symbol interference at the sampling instants', () => withApp(app, async (page) => {
  const y = await run(page, bits, 'sinc');
  // peak = pulse centre + 4 symbols; the pulses are cut off at 4 symbols, so the ISI is small but not zero
  bits.forEach((b, k) => assert.ok(Math.abs(y[(15 + k + 0.5 + 4) * SPS] - b) < 0.15, `bit ${k}: ${y[(15 + k + 4.5) * SPS]}`));
}));

test('it improves the signal-to-noise ratio of noisy symbols', () => withApp(app, async (page) => {
  const y = await run(page, bits, 'square', 1);
  bits.forEach((b, k) => assert.ok(Math.abs(y[(16 + k) * SPS - 1] - b) < 0.5, `bit ${k} decodes`));
}));

test('the kernel is scaled to unit peak gain and the block is registered', () => withApp(app, async (page) => {
  const r = await page.evaluate(() => {
    const k = dsplab.BLOCKS.matched_filter.matchedKernel('square', 10);
    return { len: k.length, sum: k.reduce((a, b) => a + b, 0), cat: dsplab.BLOCKS.matched_filter.category };
  });
  assert.equal(r.len, 10);
  assert.ok(Math.abs(r.sum - 1) < 1e-6);
  assert.equal(r.cat, 'Processing blocks');
}));

test('Matched Filter has a signal in and a signal out; its rate follows its input; it runs in the engine', () => withApp(app, async (page) => {
  for (const t of ['Strobe Source', 'Serializer', 'Upsampler', 'Matched Filter', 'Audio Sink']) await addFromPalette(page, t);
  assert.equal(await page.locator('.node:has-text("Matched Filter") .async').count(), 0);
  const r = await page.evaluate(async () => {
    const g = await import('/src/core/graph.js');
    const by = (t) => [...dsplab.graph.nodes.values()].find((n) => n.type === t);
    const [s, z, u, m, k] = ['strobe_source', 'serializer', 'upsampler', 'matched_filter', 'audio_sink'].map(by);
    const e = (a, ap, b, bp) => !!dsplab.addEdge({ node: a.id, port: ap }, { node: b.id, port: bp });
    z.params.baud = 500; u.params.factor = 8;
    e(s, 'out', z, 'in'); e(z, 'out', u, 'in'); e(u, 'out', m, 'in'); e(m, 'out', k, 'in');
    return g.outRate(m, 'out');
  });
  assert.equal(r, 4000);
  await startAudio(page);
  await sleep(300);
  assert.match(await page.textContent('#status'), /^Running/);
}));
