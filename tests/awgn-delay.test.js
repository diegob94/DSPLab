'use strict';
const { before, after, test } = require('node:test');
const { assert, launch, withApp, addFromPalette } = require('./helpers');

let app;
before(async () => { app = await launch(); });
after(async () => { await app.close(); });

test('AWGN adds zero-mean Gaussian noise of standard deviation sigma', () => withApp(app, async (page) => {
  const r = await page.evaluate(async () => {
    const ctx = new OfflineAudioContext(1, 44100, 44100);
    const blk = dsplab.BLOCKS.awgn.build(ctx, { sigma: 0.3 });
    const dc = new ConstantSourceNode(ctx, { offset: 0.5 });
    dc.connect(blk.inputs.in); dc.start();
    blk.outputs.out.connect(ctx.destination);
    const d = (await ctx.startRendering()).getChannelData(0);
    let m = 0; for (const v of d) m += v; m /= d.length;
    let s = 0; for (const v of d) s += (v - m) ** 2;
    return { mean: m, std: Math.sqrt(s / d.length) };
  });
  assert.ok(Math.abs(r.mean - 0.5) < 0.02, `mean ${r.mean}`);
  assert.ok(Math.abs(r.std - 0.3) < 0.02, `std ${r.std}`);
}));

test('AWGN with sigma 0 passes the signal unchanged', () => withApp(app, async (page) => {
  const peak = await page.evaluate(async () => {
    const ctx = new OfflineAudioContext(1, 4410, 44100);
    const blk = dsplab.BLOCKS.awgn.build(ctx, { sigma: 0 });
    const dc = new ConstantSourceNode(ctx, { offset: 0.25 });
    dc.connect(blk.inputs.in); dc.start();
    blk.outputs.out.connect(ctx.destination);
    const d = (await ctx.startRendering()).getChannelData(0);
    return Math.max(...d.map((v) => Math.abs(v - 0.25)));
  });
  assert.ok(peak < 1e-6);
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
