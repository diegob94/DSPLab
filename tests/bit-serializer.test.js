'use strict';
const { before, after, test } = require('node:test');
const { assert, launch, withApp, addFromPalette } = require('./helpers');

let app;
before(async () => { app = await launch(); });
after(async () => { await app.close(); });

// the serializer on a fake clock we move by hand; steps are [time, array to deliver | null]
const run = (page, steps) => page.evaluate(async (steps) => {
  const ctx = { currentTime: 0 };
  const blk = dsplab.BLOCKS.bit_serializer.build(ctx, { baud: 1000 });
  const got = [];
  blk.outputs.bits.connect({ receive: (b) => got.push(b) });
  const log = [];
  for (const [time, bytes] of steps) {
    ctx.currentTime = time;
    if (bytes) blk.inputs.in.receive(bytes);
    await new Promise((r) => setTimeout(r, 30));   // a few timer ticks
    log.push(got.length);
  }
  blk.dispose();
  return { log, got };
}, steps);

test('each int goes out as 8 bits, most significant bit first', () => withApp(app, async (page) => {
  const r = await run(page, [[0, [0x41, 0xff]], [1, null]]);
  assert.deepEqual(r.got, [0, 1, 0, 0, 0, 0, 0, 1, 1, 1, 1, 1, 1, 1, 1, 1]);
}));

test('the audio clock sets the pace: one symbol per 1 / baud, none early', () => withApp(app, async (page) => {
  // at t=0 the first is out; by 3.5 ms (1000 baud) four are due; by 20 ms all eight
  assert.deepEqual((await run(page, [[0, [0x41]], [0.0035, null], [0.02, null]])).log, [1, 4, 8]);
}));

test('an array that arrives meanwhile is queued behind; after a pause the next starts at once', () => withApp(app, async (page) => {
  const { log, got } = await run(page, [[0, [0x80]], [0, [0x01]], [0.0015, null], [10, [0xff]]]);
  assert.deepEqual(log, [1, 1, 2, 24]);
  assert.deepEqual(got.slice(0, 16), [1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1]);
}));

test('anything that is not an array of bytes is ignored', () => withApp(app, async (page) => {
  assert.deepEqual((await run(page, [[0, 1], [0, [256]], [0, [-1]], [0, [1.5]], [0, ['a']], [1, null]])).got, []);
}));

test('Bit Serializer takes array[uint8] and gives bits, both on an async clock', () => withApp(app, async (page) => {
  await addFromPalette(page, 'Bit Serializer');
  assert.equal(await page.locator('.node:has-text("Bit Serializer") .port.in.async').count(), 1);
  assert.equal(await page.locator('.node:has-text("Bit Serializer") .port.out.async').count(), 1);
}));
