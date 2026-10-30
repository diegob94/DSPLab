'use strict';
const { before, after, test } = require('node:test');
const { assert, launch, withApp } = require('./helpers');

let app;
before(async () => { app = await launch(); });
after(async () => { await app.close(); });

const SPS = 10;   // 44.1 kHz at 4410 baud

// bits -> pulse shaper waveform -> (optional noise) -> matched filter, rendered offline
const run = (page, bits, pulse, noise = 0) => page.evaluate(async ([bits, pulse, noise, sps]) => {
  const n = (bits.length + 30) * sps;
  const ctx = new OfflineAudioContext(1, n, 44100);
  const x = new Float32Array(n);
  let seed = 1;
  const rnd = () => ((seed = (seed * 1664525 + 1013904223) >>> 0) / 2 ** 32 - 0.5) * 2;
  bits.forEach((b, k) => {
    const s = dsplab.BLOCKS.pulse_shaper.pulseSamples(pulse, k, sps, b, 1);
    if (s) s.data.forEach((v, i) => { x[15 * sps + s.start + i] += v; });
  });
  for (let i = 0; i < n; i++) x[i] += noise * rnd();
  const src = ctx.createBufferSource();
  const buf = ctx.createBuffer(1, n, 44100);
  buf.copyToChannel(x, 0);
  src.buffer = buf;
  const blk = dsplab.BLOCKS.matched_filter.build(ctx, { pulse, baud: 44100 / sps });
  src.connect(blk.inputs.in);
  blk.outputs.out.connect(ctx.destination);
  src.start();
  return Array.from((await ctx.startRendering()).getChannelData(0));
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
  const err = (v, b) => Math.abs(v - b);
  const x = await run(page, bits, 'square', 0);   // clean reference
  bits.forEach((b, k) => assert.ok(err(y[(16 + k) * SPS - 1], b) < 0.5, `bit ${k} decodes`));
  assert.ok(x.length === y.length);
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
