'use strict';
const { before, after, test } = require('node:test');
const { assert, launch, withApp, addFromPalette } = require('./helpers');

let app;
before(async () => { app = await launch(); });
after(async () => { await app.close(); });

// a Bit Source on a fake audio clock we move by hand; steps are [time, params to apply | null]
const run = (page, params, steps) => page.evaluate(async ([params, steps]) => {
  const ctx = { currentTime: 0 };
  const blk = dsplab.BLOCKS.bit_source.build(ctx, { type: 'text', data: 'A', baud: 1000, repeat: 'once', period: 1000, ...params });
  const got = [];
  blk.outputs.bits.connect({ receive: (b) => got.push(b) });
  const log = [];
  for (const [time, update] of steps) {
    ctx.currentTime = time;
    if (update) blk.update({ type: 'text', data: 'A', baud: 1000, repeat: 'once', period: 1000, ...update });
    await new Promise((r) => setTimeout(r, 30));   // a few timer ticks
    log.push(got.length);
  }
  blk.dispose();
  return { log, got };
}, [params, steps]);

test('text goes out one bit per symbol, most significant bit first', () => withApp(app, async (page) => {
  const { got } = await run(page, {}, [[0, null], [1, null]]);
  assert.deepEqual(got, [0, 1, 0, 0, 0, 0, 0, 1]);   // 'A' = 0x41
}));

test('hex and bits types', () => withApp(app, async (page) => {
  assert.deepEqual((await run(page, { type: 'hex', data: '0xA5 ff' }, [[0, null], [1, null]])).got, [1, 0, 1, 0, 0, 1, 0, 1, 1, 1, 1, 1, 1, 1, 1, 1]);
  assert.deepEqual((await run(page, { type: 'bits', data: '1011 0x' }, [[0, null], [1, null]])).got, [1, 0, 1, 1, 0]);
}));

test('the audio clock sets the pace: one symbol per 1 / baud, none early', () => withApp(app, async (page) => {
  // at t=0 the first is out; by 3.5 ms (1000 baud) four are due; by 20 ms all eight
  const { log } = await run(page, {}, [[0, null], [0.0035, null], [0.02, null]]);
  assert.deepEqual(log, [1, 4, 8]);
}));

test('with Repeat every period it sends the data again, and editing it does not restart the clock', () => withApp(app, async (page) => {
  const { got } = await run(page, { repeat: 'every period', period: 10 }, [[0, null], [1, null], [1, { repeat: 'every period', period: 10, data: 'B' }], [2, null]]);
  assert.ok(got.length >= 16, `sent again: ${got.length}`);
}));

test('with Repeat once it sends again only when its data changes', () => withApp(app, async (page) => {
  const { got } = await run(page, {}, [[0, null], [1, null], [1, { data: 'A' }], [2, { data: 'B' }], [3, null]]);
  assert.deepEqual(got, [0, 1, 0, 0, 0, 0, 0, 1, 0, 1, 0, 0, 0, 0, 1, 0]);
}));

test('Bit Source has an async output only, and cables only join ports on the same clock', () => withApp(app, async (page) => {
  await addFromPalette(page, 'Bit Source');
  assert.equal(await page.locator('.node:has-text("Bit Source") .port.out.async').count(), 1);
  assert.equal(await page.locator('.node:has-text("Bit Source") .port.in').count(), 0);
  await addFromPalette(page, 'Audio Sink');
  const wired = await page.evaluate(() => {
    const by = (t) => [...dsplab.graph.nodes.values()].find((n) => n.type === t);
    return !!dsplab.addEdge({ node: by('bit_source').id, port: 'bits' }, { node: by('audio_sink').id, port: 'in' });
  });
  assert.equal(wired, false);
}));
