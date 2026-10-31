'use strict';
const { before, after, test } = require('node:test');
const { assert, launch, withApp, addFromPalette } = require('./helpers');

let app;
before(async () => { app = await launch(); });
after(async () => { await app.close(); });

// renders 1 s of a sine VCO (centre 1000 Hz, sensitivity 500) fed a constant `level`; returns the zero-crossing count
const crossings = (page, level) => page.evaluate(async (level) => {
  const ctx = new OfflineAudioContext(1, 44100, 44100);
  const blk = dsplab.BLOCKS.vco.build(ctx, { waveform: 'sine', frequency: 1000, sensitivity: 500, amplitude: 1 });
  const dc = new ConstantSourceNode(ctx, { offset: level });
  dc.connect(blk.inputs.in); dc.start();
  blk.outputs.out.connect(ctx.destination);
  const d = (await ctx.startRendering()).getChannelData(0);
  let n = 0;
  for (let i = 1; i < d.length; i++) if (d[i - 1] < 0 && d[i] >= 0) n++;
  return n;
}, level);

test('VCO runs at the centre frequency with no input', () => withApp(app, async (page) => {
  assert.ok(Math.abs(await crossings(page, 0) - 1000) <= 2);
}));

test('VCO frequency follows the input: centre + sensitivity · input', () => withApp(app, async (page) => {
  assert.ok(Math.abs(await crossings(page, 1) - 1500) <= 2);
  assert.ok(Math.abs(await crossings(page, -1) - 500) <= 2);
}));

test('VCO has input in and output out, in the Processing category', () => withApp(app, async (page) => {
  await addFromPalette(page, 'VCO');
  const node = page.locator('.node:has-text("VCO")');
  assert.deepEqual(await node.locator('.port.in').evaluateAll((e) => e.map((p) => p.dataset.port)), ['in']);
  assert.deepEqual(await node.locator('.port.out').evaluateAll((e) => e.map((p) => p.dataset.port)), ['out']);
  assert.equal(await page.evaluate(() => dsplab.BLOCKS.vco.category), 'Processing blocks');
}));
