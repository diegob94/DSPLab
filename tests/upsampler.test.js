'use strict';
const { before, after, test } = require('node:test');
const { assert, launch, withApp, addFromPalette } = require('./helpers');

let app;
before(async () => { app = await launch(); });
after(async () => { await app.close(); });

// feeds a SerializerSignal at `inRate` through an UpsamplerSignal and returns [input, output] samples. The upsampler's
// processor may start later than the serializer's (they are created asynchronously): `late` frames later.
const run = (page, { numbers, inRate, factor, sampleRate = 48000, samples, late = 0 }) => page.evaluate(async ([numbers, inRate, factor, sampleRate, samples, late]) => {
  const { SerializerSignal } = await import('/src/blocks/serializer-core.js');
  const { UpsamplerSignal } = await import('/src/blocks/upsampler-core.js');
  const src = new SerializerSignal(sampleRate, inRate);
  src.push(numbers);
  const up = new UpsamplerSignal(sampleRate, inRate, factor);
  const inp = new Float32Array(samples), out = new Float32Array(samples);
  for (let i = 0; i < samples; i += 128) {   // render quanta
    const a = inp.subarray(i, i + 128), b = out.subarray(i, i + 128);
    src.process(a, i);
    if (i >= late) up.process(a, b, i);
  }
  return [Array.from(inp), Array.from(out)];
}, [numbers, inRate, factor, sampleRate, samples, late]);

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

test('the output stays aligned with the input when its processor starts later, whatever the factor and rate', () => withApp(app, async (page) => {
  // a Serializer at 1000 baud, an Upsampler by 2: the input sample must be in the first half of its symbol
  for (const [inRate, factor] of [[1000, 2], [1000, 3], [700, 5], [4800, 2]]) {
    const [inp, out] = await run(page, { numbers: Array.from({ length: 60 }, (_, i) => i + 1), inRate, factor, samples: 6400, late: 128 * 3 });
    for (let k = 0; k < 20; k++) {
      const start = Math.ceil(k * 48000 / inRate);                    // the frame at which input symbol k starts
      if (start < 128 * 3) continue;                                  // before the upsampler existed
      assert.equal(out[start], inp[start], `rate ${inRate} x ${factor}: the first output sample of symbol ${k} is the input's`);
      assert.equal(out[Math.ceil((k * factor + 1) * 48000 / (inRate * factor))], 0, 'and the next output symbol is 0');
    }
  }
}));

test('in the real engine the upsampled channel lines up with the serializer on the scope (no matter when each worklet started)', () => withApp(app, async (page) => {
  const { startAudio, sleep } = require('./helpers');
  for (const t of ['Strobe Source', 'Serializer', 'Upsampler', 'Oscilloscope']) await addFromPalette(page, t);
  await page.evaluate(() => {
    const by = (t) => [...dsplab.graph.nodes.values()].find((n) => n.type === t);
    const [s, z, u, o] = ['strobe_source', 'serializer', 'upsampler', 'oscilloscope'].map(by);
    Object.assign(s.params, { type: 'hex', data: 'FF', period: 60 });   // [255]: one symbol of 255, then zeros
    z.params.baud = 1000; u.params.factor = 2;
    const e = (a, ap, b, bp) => dsplab.addEdge({ node: a.id, port: ap }, { node: b.id, port: bp });
    e(s, 'out', z, 'in'); e(z, 'out', u, 'in'); e(z, 'out', o, 'ch1'); e(u, 'out', o, 'ch2');
  });
  await startAudio(page);
  // the same engine start is repeated a few times: the worklets start at a different frame each time
  for (let run = 0; run < 3; run++) {
    await sleep(400);
    const r = await page.evaluate(() => {
      const o = [...dsplab.graph.nodes.values()].find((n) => n.type === 'oscilloscope');
      const inst = dsplab.engine.live.get(o.id);
      const sps = inst.sampleRate / 1000;   // output samples per symbol of the serializer
      const [ch1, ch2] = inst.sample(20, 0.5, 'ch1', 'auto', 0).map((x) => Array.from(x));   // starts at a rising edge of ch1
      const at = (x, i) => Math.round(x[i]);
      return { sps, ch1: [at(ch1, 1), at(ch1, Math.floor(sps) - 2), at(ch1, Math.ceil(sps) + 2)], ch2: [at(ch2, 1), at(ch2, Math.floor(sps / 2) - 2), at(ch2, Math.ceil(sps / 2) + 2), at(ch2, Math.floor(sps) - 2)] };
    });
    // ch1: 255 for the whole symbol, then 0. ch2: 255 for the first half of it, then 0 (not shifted by half a symbol)
    assert.deepEqual(r.ch1, [255, 255, 0], `ch1 ${JSON.stringify(r)}`);
    assert.deepEqual(r.ch2, [255, 255, 0, 0], `ch2 ${JSON.stringify(r)}`);
    await page.evaluate(async () => { await dsplab.engine.stop(); await dsplab.engine.start(); });
  }
}));
