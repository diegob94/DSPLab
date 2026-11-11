'use strict';
const { before, after, test } = require('node:test');
const { assert, launch, withApp, addFromPalette, startAudio, sleep } = require('./helpers');

let app;
before(async () => { app = await launch(); });
after(async () => { await app.close(); });

// a 1 kHz sine of amplitude 0.5 (power 0.125) through an Awgn at `snr` dB, 1 s at 44.1 kHz; returns the noise alone
const noiseOf = (page, snr, window = 500) => page.evaluate(async ([snr, window]) => {
  const { Awgn } = await import('/src/blocks/awgn-core.js');
  const n = 44100, x = new Float32Array(n), y = new Float32Array(n);
  for (let i = 0; i < n; i++) x[i] = 0.5 * Math.sin(2 * Math.PI * 1000 * i / 44100);
  new Awgn({ sampleRate: 44100, snr, window }).process(x, y);
  return Array.from(y, (v, i) => v - x[i]);
}, [snr, window]);

const power = (a) => a.reduce((s, v) => s + v * v, 0) / a.length;

test('AWGN adds zero-mean noise at the set SNR (in dB, relative to the input power)', () => withApp(app, async (page) => {
  for (const snr of [0, 10, 20]) {
    const d = await noiseOf(page, snr);
    const measured = 10 * Math.log10(0.125 / power(d.slice(22050)));   // once the power estimate has settled
    assert.ok(Math.abs(measured - snr) < 0.5, `SNR ${snr} dB measured ${measured}`);
    assert.ok(Math.abs(d.reduce((s, v) => s + v, 0) / d.length) < 0.01, 'zero mean');
  }
}));

test('every 10 dB of SNR is a factor of 10 in noise power, and the noise follows the level of the input', () => withApp(app, async (page) => {
  const r = await page.evaluate(async () => {
    const { Awgn } = await import('/src/blocks/awgn-core.js');
    const run = (level, snr) => {
      const x = new Float32Array(44100).fill(level), y = new Float32Array(44100);
      new Awgn({ sampleRate: 44100, snr, window: 100 }).process(x, y);
      let p = 0; for (let i = 22050; i < y.length; i++) p += (y[i] - level) ** 2;
      return p / 22050;
    };
    return { ratio: run(1, 0) / run(1, 10), loud: run(1, 10), quiet: run(0.1, 10) };
  });
  assert.ok(Math.abs(r.ratio / 10 - 1) < 0.1, `ratio ${r.ratio}`);
  assert.ok(Math.abs(r.loud / r.quiet / 100 - 1) < 0.15, `a 10x weaker input gets 100x less noise power: ${r.loud / r.quiet}`);
}));

test('AWGN leaves a silent input silent, and a changed SNR applies without a reset', () => withApp(app, async (page) => {
  const r = await page.evaluate(async () => {
    const { Awgn } = await import('/src/blocks/awgn-core.js');
    const a = new Awgn({ sampleRate: 44100, snr: 0, window: 100 });
    const y = new Float32Array(1000);
    a.process(new Float32Array(1000), y);
    const silent = Math.max(...y.map(Math.abs));
    const x = new Float32Array(44100).fill(1), z = new Float32Array(44100);
    a.process(x, z);
    a.set(40, 100);
    a.process(x, z);
    return { silent, tail: Math.max(...z.slice(40000).map((v) => Math.abs(v - 1))) };
  });
  assert.equal(r.silent, 0);
  assert.ok(r.tail < 0.05, `40 dB below a power of 1 is σ = 0.01: ${r.tail}`);
}));

test('AWGN runs in the engine and takes live changes', () => withApp(app, async (page) => {
  for (const t of ['Wave Generator', 'AWGN', 'Audio Sink']) await addFromPalette(page, t);
  await page.evaluate(() => {
    const by = (t) => [...dsplab.graph.nodes.values()].find((n) => n.type === t);
    const [w, a, k] = ['wave_generator', 'awgn', 'audio_sink'].map(by);
    dsplab.addEdge({ node: w.id, port: 'out' }, { node: a.id, port: 'in' });
    dsplab.addEdge({ node: a.id, port: 'out' }, { node: k.id, port: 'in' });
  });
  await startAudio(page);
  await page.evaluate(() => { [...dsplab.graph.nodes.values()].find((n) => n.type === 'awgn').params.snr = 5; });
  await sleep(300);
  assert.match(await page.textContent('#status'), /^Running/);
}));

test('Delay shifts the signal by the set time', () => withApp(app, async (page) => {
  const first = await page.evaluate(async () => {
    const ctx = new OfflineAudioContext(1, 4410, 44100);
    const blk = dsplab.BLOCKS.delay.build(ctx, { delay: 10 });
    const dc = new ConstantSourceNode(ctx, { offset: 1 });
    dc.connect(blk.inputs.in); dc.start();
    blk.outputs.out.connect(ctx.destination);
    const d = (await ctx.startRendering()).getChannelData(0);
    return d.findIndex((v) => v > 0.5);
  });
  assert.ok(Math.abs(first - 441) <= 1, `first sample ${first}`);
}));

test('AWGN and Delay are in the Processing category with in / out ports', () => withApp(app, async (page) => {
  for (const [title, key] of [['AWGN', 'awgn'], ['Delay', 'delay']]) {
    await addFromPalette(page, title);
    const node = page.locator(`.node:has-text("${title}")`);
    assert.deepEqual(await node.locator('.port.in').evaluateAll((e) => e.map((p) => p.dataset.port)), ['in']);
    assert.deepEqual(await node.locator('.port.out').evaluateAll((e) => e.map((p) => p.dataset.port)), ['out']);
    assert.equal(await page.evaluate((k) => dsplab.BLOCKS[k].category, key), 'Processing blocks');
  }
}));
