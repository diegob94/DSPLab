'use strict';
const { before, after, test } = require('node:test');
const { assert, launch, withApp, addFromPalette } = require('./helpers');

let app;
before(async () => { app = await launch(); });
after(async () => { await app.close(); });

// the serializer on a fake clock we move by hand; steps are [time, array to deliver | null]
const run = (page, steps) => page.evaluate(async (steps) => {
  const ctx = { currentTime: 0 };
  const blk = dsplab.BLOCKS.serializer.build(ctx, { baud: 1000 });
  const got = [];
  blk.outputs.out.connect({ receive: (b) => got.push(b) });
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

test('the elements of an array go out one by one, whatever they are', () => withApp(app, async (page) => {
  assert.deepEqual((await run(page, [[0, [65, 255, 0]], [1, null]])).got, [65, 255, 0]);
  assert.deepEqual((await run(page, [[0, [[1], 'x', 0.5]], [1, null]])).got, [[1], 'x', 0.5]);
}));

test('the audio clock sets the pace: one symbol per 1 / baud, none early', () => withApp(app, async (page) => {
  // at t=0 the first is out; by 3.5 ms (1000 baud) four are due; by 20 ms all eight
  assert.deepEqual((await run(page, [[0, [1, 2, 3, 4, 5, 6, 7, 8]], [0.0035, null], [0.02, null]])).log, [1, 4, 8]);
}));

test('an array that arrives meanwhile is queued behind; after a pause the next starts at once', () => withApp(app, async (page) => {
  const { log, got } = await run(page, [[0, [7, 8]], [0, [9]], [0.0015, null], [10, [5]]]);
  assert.deepEqual(log, [1, 1, 2, 4]);
  assert.deepEqual(got, [7, 8, 9, 5]);
}));

test('anything that is not an array is ignored', () => withApp(app, async (page) => {
  assert.deepEqual((await run(page, [[0, 1], [0, 'ab'], [0, null], [1, null]])).got, []);
}));

test('Serializer has array[T] in and T out, both async; the output type follows what feeds it', () => withApp(app, async (page) => {
  for (const t of ['Strobe Source', 'Serializer', 'Pulse Shaper', 'Bit Monitor', 'Debug Sink']) await addFromPalette(page, t);
  assert.equal(await page.locator('.node:has-text("Serializer") .port.in.async').count(), 1);
  assert.equal(await page.locator('.node:has-text("Serializer") .port.out.async').count(), 1);
  const r = await page.evaluate(() => {
    const by = (t) => [...dsplab.graph.nodes.values()].find((n) => n.type === t);
    const [s, z, p, m, d] = ['strobe_source', 'serializer', 'pulse_shaper', 'bit_monitor', 'debug_sink'].map(by);
    const e = (a, ap, b, bp) => !!dsplab.addEdge({ node: a.id, port: ap }, { node: b.id, port: bp });
    const out = {};
    out.nothingYet = [e(z, 'out', m, 'bits'), e(z, 'out', d, 'in')];   // T is unknown: anything goes
    out.fromStrobe = e(s, 'out', z, 'in');                             // array[uint8]: T = uint8
    out.left = dsplab.graph.edges.filter((x) => x.from.node === z.id).map((x) => x.to.node === d.id ? 'debug' : 'other');
    out.toPulse = e(z, 'out', p, 'bits');                              // a uint8 is not the int the Pulse Shaper takes (yet)
    out.toMonitor = e(z, 'out', m, 'bits');
    out.audioIn = e(p, 'out', z, 'in');
    return out;
  });
  assert.deepEqual(r.nothingYet, [true, true]);
  assert.equal(r.fromStrobe, true);
  assert.deepEqual(r.left, ['debug'], 'the cable to the Bit Monitor no longer fits and is dropped');
  assert.equal(r.toPulse, false);
  assert.equal(r.toMonitor, false);
  assert.equal(r.audioIn, false);
}));
