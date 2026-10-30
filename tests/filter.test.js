'use strict';
const { before, after, test } = require('node:test');
const { assert, launch, withApp, addFromPalette } = require('./helpers');

let app;
before(async () => { app = await launch(); });
after(async () => { await app.close(); });

// renders a sine of `hz` through the filter and returns its steady-state peak amplitude
const gainAt = (page, type, frequency, hz) => page.evaluate(async ([type, frequency, hz]) => {
  const ctx = new OfflineAudioContext(1, 44100, 44100);
  const osc = new OscillatorNode(ctx, { frequency: hz });
  const blk = dsplab.BLOCKS.filter.build(ctx, { type, frequency, q: 0.707 });
  osc.connect(blk.inputs.in);
  blk.outputs.out.connect(ctx.destination);
  osc.start();
  const d = (await ctx.startRendering()).getChannelData(0);
  let peak = 0;
  for (let i = 22050; i < d.length; i++) peak = Math.max(peak, Math.abs(d[i]));
  return peak;
}, [type, frequency, hz]);

test('low-pass passes below the cutoff and attenuates above it', () => withApp(app, async (page) => {
  assert.ok(await gainAt(page, 'lowpass', 1000, 100) > 0.95);
  assert.ok(await gainAt(page, 'lowpass', 1000, 8000) < 0.05);
}));

test('high-pass attenuates below the cutoff and passes above it', () => withApp(app, async (page) => {
  assert.ok(await gainAt(page, 'highpass', 1000, 100) < 0.05);
  assert.ok(await gainAt(page, 'highpass', 1000, 8000) > 0.95);
}));

test('band-pass passes the centre frequency and attenuates far from it', () => withApp(app, async (page) => {
  assert.ok(await gainAt(page, 'bandpass', 1000, 1000) > 0.95);
  assert.ok(await gainAt(page, 'bandpass', 1000, 100) < 0.2);
  assert.ok(await gainAt(page, 'bandpass', 1000, 10000) < 0.2);
}));

test('notch removes the centre frequency and passes far from it', () => withApp(app, async (page) => {
  assert.ok(await gainAt(page, 'notch', 1000, 1000) < 0.05);
  assert.ok(await gainAt(page, 'notch', 1000, 100) > 0.95);
  assert.ok(await gainAt(page, 'notch', 1000, 10000) > 0.95);
}));

test('Filter has input in and output out, in the Processing category', () => withApp(app, async (page) => {
  await addFromPalette(page, 'Filter');
  const node = page.locator('.node:has-text("Filter")');
  assert.deepEqual(await node.locator('.port.in').evaluateAll((e) => e.map((p) => p.dataset.port)), ['in']);
  assert.deepEqual(await node.locator('.port.out').evaluateAll((e) => e.map((p) => p.dataset.port)), ['out']);
  assert.equal(await page.evaluate(() => dsplab.BLOCKS.filter.category), 'Processing blocks');
}));
