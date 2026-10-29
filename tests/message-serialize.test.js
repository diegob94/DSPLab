'use strict';
const { before, after, test } = require('node:test');
const { assert, launch, withApp, addFromPalette } = require('./helpers');

let app;
before(async () => { app = await launch(); });
after(async () => { await app.close(); });

// the serializer on a fake clock we move by hand; steps are [time, message to deliver | null]
const run = (page, steps) => page.evaluate(async (steps) => {
  const ctx = { currentTime: 0 };
  const blk = dsplab.BLOCKS.message_serialize.build(ctx, { baud: 1000 });
  const got = [];
  blk.outputs.msg.connect({ receive: (m) => got.push(m) });
  const log = [];
  for (const [time, msg] of steps) {
    ctx.currentTime = time;
    if (msg) blk.inputs.msg.receive(msg);
    await new Promise((r) => setTimeout(r, 30));   // a few timer ticks
    log.push(got.length);
  }
  blk.dispose();
  return { log, got: got.map((m) => m[0][0]), shapes: got.every((m) => m.length === 1 && m[0].length === 1) };
}, steps);

test('bits go out as 1 x 1 messages, column by column, top bit first', () => withApp(app, async (page) => {
  const A = [[0], [1], [0], [0], [0], [0], [0], [1]];   // 'A' = 01000001
  const r = await run(page, [[0, A], [1, null]]);
  assert.deepEqual(r.got, [0, 1, 0, 0, 0, 0, 0, 1]);
  assert.ok(r.shapes);
  const cols = await run(page, [[0, [[1, 1], [0, 0]]], [1, null]]);   // columns 1,0 then 1,0
  assert.deepEqual(cols.got, [1, 0, 1, 0]);
}));

test('the audio clock sets the pace: one symbol per 1 / baud, none early', () => withApp(app, async (page) => {
  // at t=0 the first is out; by 3.5 ms (1000 baud) four are due; by 20 ms all eight
  const { log } = await run(page, [[0, [[1, 0, 1, 1, 0, 0, 1, 0]]], [0.0035, null], [0.02, null]]);
  assert.deepEqual(log, [1, 4, 8]);
}));

test('a message that arrives meanwhile is queued behind; after a pause the next starts at once', () => withApp(app, async (page) => {
  const { log, got } = await run(page, [[0, [[1, 1]]], [0, [[0, 0]]], [0.0015, null], [10, [[1]]]]);
  assert.deepEqual(log, [1, 1, 2, 5]);
  assert.deepEqual(got, [1, 1, 0, 0, 1]);
}));

test('Message Serializer is a message block on both ends', () => withApp(app, async (page) => {
  await addFromPalette(page, 'Message Serializer');
  assert.equal(await page.locator('.node:has-text("Message Serializer") .port.in.msg').count(), 1);
  assert.equal(await page.locator('.node:has-text("Message Serializer") .port.out.msg').count(), 1);
}));
