'use strict';
const { before, after, test } = require('node:test');
const { assert, launch, withApp, addFromPalette, startAudio, sleep } = require('./helpers');

let app;
before(async () => { app = await launch(); });
after(async () => { await app.close(); });

test('the output is 1 above the threshold and 0 at or below it', () => withApp(app, async (page) => {
  const y = await page.evaluate(async () => {
    const { detect } = await import('/src/blocks/detector-core.js');
    const out = new Float32Array(6);
    detect(Float32Array.from([-1, 0.2, 0.5, 0.51, 1.7, 0]), out, 0.5);
    return Array.from(out);
  });
  assert.deepEqual(y, [0, 0, 0, 1, 1, 0]);
}));

test('a negative threshold works too', () => withApp(app, async (page) => {
  const y = await page.evaluate(async () => {
    const { detect } = await import('/src/blocks/detector-core.js');
    const out = new Float32Array(3);
    detect(Float32Array.from([-1, -0.4, 0]), out, -0.5);
    return Array.from(out);
  });
  assert.deepEqual(y, [0, 1, 1]);
}));

test('Detector keeps the sample rate of its input and runs in the engine, taking live changes', () => withApp(app, async (page) => {
  for (const t of ['Strobe Source', 'Serializer', 'Upsampler', 'Detector', 'Audio Sink']) await addFromPalette(page, t);
  assert.equal(await page.locator('.node:has-text("Detector") .port.in').count(), 1);
  assert.equal(await page.locator('.node:has-text("Detector") .port.out').count(), 1);
  const rate = await page.evaluate(async () => {
    const g = await import('/src/core/graph.js');
    const by = (t) => [...dsplab.graph.nodes.values()].find((n) => n.type === t);
    const [s, z, u, d, k] = ['strobe_source', 'serializer', 'upsampler', 'detector', 'audio_sink'].map(by);
    const e = (a, ap, b, bp) => !!dsplab.addEdge({ node: a.id, port: ap }, { node: b.id, port: bp });
    z.params.baud = 500; u.params.factor = 8;
    e(s, 'out', z, 'in'); e(z, 'out', u, 'in'); e(u, 'out', d, 'in'); e(d, 'out', k, 'in');
    return g.outRate(d, 'out');
  });
  assert.equal(rate, 4000);
  await startAudio(page);
  await page.evaluate(() => dsplab.select({ kind: 'node', id: [...dsplab.graph.nodes.values()].find((n) => n.type === 'detector').id }));
  await page.evaluate(() => { [...dsplab.graph.nodes.values()].find((n) => n.type === 'detector').params.threshold = 1; });
  await sleep(300);
  assert.match(await page.textContent('#status'), /^Running/);
}));

test('through the engine: a constant above the threshold gives 1, below gives 0', () => withApp(app, async (page) => {
  const r = await page.evaluate(async () => {
    const out = [];
    for (const [level, th] of [[0.8, 0.5], [0.3, 0.5]]) {
      const ctx = new OfflineAudioContext(1, 512, 44100);
      await dsplab.BLOCKS.detector.setup(ctx);
      const src = ctx.createConstantSource();
      src.offset.value = level;
      const blk = dsplab.BLOCKS.detector.build(ctx, { threshold: th });
      src.connect(blk.inputs.in);
      blk.outputs.out.connect(ctx.destination);
      src.start();
      const d = (await ctx.startRendering()).getChannelData(0);
      out.push(d[511]);
    }
    return out;
  });
  assert.deepEqual(r, [1, 0]);
}));
