'use strict';
const { before, after, test } = require('node:test');
const { assert, launch, withApp, addFromPalette } = require('./helpers');

let app;
before(async () => { app = await launch(); });
after(async () => { await app.close(); });

// feeds a=3 and (optionally) b=2 through the block in an OfflineAudioContext and reads the output
const render = (page, operation, bConnected) => page.evaluate(async ([operation, bConnected]) => {
  const ctx = new OfflineAudioContext(1, 4410, 44100);
  const a = new ConstantSourceNode(ctx, { offset: 3 });
  const b = new ConstantSourceNode(ctx, { offset: 2 });
  const blk = dsplab.BLOCKS.math_operator.build(ctx, { operation });
  a.connect(blk.inputs.a);
  if (bConnected) b.connect(blk.inputs.b);
  blk.outputs.out.connect(ctx.destination);
  a.start(); b.start();
  const buf = await ctx.startRendering();
  return +buf.getChannelData(0)[4000].toFixed(3);
}, [operation, bConnected]);

test('Math Operator computes a+b, a-b and a*b on signals', () => withApp(app, async (page) => {
  assert.equal(await render(page, 'add', true), 5);
  assert.equal(await render(page, 'subtract', true), 1);
  assert.equal(await render(page, 'multiply', true), 6);
}));

test('an unconnected input counts as 0', () => withApp(app, async (page) => {
  assert.equal(await render(page, 'add', false), 3);
  assert.equal(await render(page, 'multiply', false), 0);
}));

test('Math Operator has inputs a and b and output out, in the Processing category', () => withApp(app, async (page) => {
  await addFromPalette(page, 'Math Operator');
  const node = page.locator('.node:has-text("Math Operator")');
  assert.deepEqual(await node.locator('.port.in').evaluateAll((e) => e.map((p) => p.dataset.port)), ['a', 'b']);
  assert.deepEqual(await node.locator('.port.out').evaluateAll((e) => e.map((p) => p.dataset.port)), ['out']);
  assert.equal(await page.evaluate(() => dsplab.BLOCKS.math_operator.category), 'Processing blocks');
}));
