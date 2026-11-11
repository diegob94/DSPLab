'use strict';
const { before, after, test } = require('node:test');
const { assert, launch, withApp, addFromPalette } = require('./helpers');

let app;
before(async () => { app = await launch(); });
after(async () => { await app.close(); });

// feeds a SerializerSignal at `inRate` through an UpsamplerSignal and returns [input, output] samples
const run = (page, { numbers, inRate, factor, sampleRate = 48000, samples }) => page.evaluate(async ([numbers, inRate, factor, sampleRate, samples]) => {
  const { SerializerSignal } = await import('/src/blocks/serializer-core.js');
  const { UpsamplerSignal } = await import('/src/blocks/upsampler-core.js');
  const src = new SerializerSignal(sampleRate, inRate);
  src.push(numbers);
  const up = new UpsamplerSignal(sampleRate, inRate, factor);
  const inp = new Float32Array(samples), out = new Float32Array(samples);
  for (let i = 0; i < samples; i += 128) {   // render quanta
    const a = inp.subarray(i, i + 128), b = out.subarray(i, i + 128);
    src.process(a);
    up.process(a, b);
  }
  return [Array.from(inp), Array.from(out)];
}, [numbers, inRate, factor, sampleRate, samples]);

// the value of each symbol of a held signal at `rate` samples per second
const symbols = (x, rate, sampleRate = 48000) => Array.from({ length: Math.floor(x.length * rate / sampleRate) }, (_, k) => x[Math.ceil(k * sampleRate / rate)]);

test('every input sample is followed by factor - 1 zeros, at factor times the rate', () => withApp(app, async (page) => {
  const [inp, out] = await run(page, { numbers: [1, 2, 3], inRate: 4800, factor: 4, samples: 480 });
  assert.deepEqual(symbols(inp, 4800).slice(0, 5), [1, 2, 3, 0, 0]);
  assert.deepEqual(symbols(out, 19200).slice(0, 16), [1, 0, 0, 0, 2, 0, 0, 0, 3, 0, 0, 0, 0, 0, 0, 0]);
}));

test('the first sample of every input symbol is at the same instant as the output symbol it becomes', () => withApp(app, async (page) => {
  const [inp, out] = await run(page, { numbers: [5, 6], inRate: 4800, factor: 2, samples: 96 });
  assert.deepEqual(out.slice(0, 5), [5, 5, 5, 5, 5]);   // 5 held for 5 samples (9600 symbols/s at 48 kHz)
  assert.deepEqual(out.slice(5, 10), [0, 0, 0, 0, 0]);
  assert.deepEqual(out.slice(10, 15), [6, 6, 6, 6, 6]);
  assert.equal(inp[0], 5);
  assert.equal(inp[10], 6, 'the second input symbol starts where the third output symbol does');
}));

test('negative and float values pass through, and a rate that does not divide the sound card rate keeps the average', () => withApp(app, async (page) => {
  const [, out] = await run(page, { numbers: Array.from({ length: 700 }, (_, i) => -(i + 0.5)), inRate: 700, factor: 3, samples: 48000 });
  const changes = out.filter((v, i) => i > 0 && v !== out[i - 1]).length;   // 2100 symbols a second, a third of them with a value
  assert.ok(Math.abs(changes - 1400) <= 2, `${changes}`);   // value, 0, value, 0, ... : a change at every symbol that differs from the last
  assert.ok(out.some((v) => v === -0.5) && out.some((v) => v === -1.5));
}));

test('Upsampler has a signal in and a signal out (no async ports) and shows its factor', () => withApp(app, async (page) => {
  await addFromPalette(page, 'Upsampler');
  assert.equal(await page.locator('.node:has-text("Upsampler") .port.in').count(), 1);
  assert.equal(await page.locator('.node:has-text("Upsampler") .port.out').count(), 1);
  assert.equal(await page.locator('.node:has-text("Upsampler") .async').count(), 0);
  assert.match(await page.locator('.node:has-text("Upsampler")').textContent(), /Factor2/);
}));
