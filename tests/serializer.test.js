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

test('the elements of an array go out one by one, whatever they are, and then it is zeros', () => withApp(app, async (page) => {
  assert.deepEqual((await run(page, [[0, [65, 255, 7]], [0.005, null]])).got, [65, 255, 7, 0, 0, 0]);
  assert.deepEqual((await run(page, [[0, ['x', 0.5, null]], [0.003, null]])).got, ['x', 0.5, null, 0]);
  assert.deepEqual((await run(page, [[0, [[1], 2]], [0.003, null]])).got, [0, 0, 0, 0], 'an array of arrays is ignored');
}));

test('it delivers samples continuously at the baud rate, 0 while the buffer is empty, none early', () => withApp(app, async (page) => {
  // 1000 baud: at t = 0 the first sample is due, by 3.5 ms four, by 20 ms twenty-one (an empty buffer gives zeros)
  const { log, got } = await run(page, [[0, null], [0.0035, null], [0.0035, [9, 9]], [0.02, null], [0.03, null]]);
  assert.deepEqual(log, [1, 4, 4, 21, 31]);
  assert.deepEqual(got.slice(0, 4), [0, 0, 0, 0]);
  assert.deepEqual(got.slice(4, 7), [9, 9, 0], 'the array that arrived is consumed from the next sample on');
}));

test('an array that arrives while another is being consumed waits in the buffer', () => withApp(app, async (page) => {
  const { got } = await run(page, [[0, [7, 8]], [0, [9]], [0.006, null]]);
  assert.deepEqual(got, [7, 8, 9, 0, 0, 0, 0]);
}));

test('a new baud rate starts from now; a long stall skips ahead instead of delivering it all', () => withApp(app, async (page) => {
  const r = await page.evaluate(async () => {
    const ctx = { currentTime: 0 };
    const blk = dsplab.BLOCKS.serializer.build(ctx, { baud: 1000 });
    let n = 0;
    blk.outputs.out.connect({ receive: () => n++ });
    const wait = () => new Promise((r) => setTimeout(r, 30));
    ctx.currentTime = 0.01; await wait();
    const at1000 = n;                                   // 11
    blk.update({ baud: 100 });
    ctx.currentTime = 0.02; await wait();               // the new rate starts at 0.01: samples at 0.01 and 0.02
    const at100 = n - at1000;
    ctx.currentTime = 60; await wait();                 // a minute at once: at most a second of samples
    const stalled = n - at1000 - at100;
    blk.dispose();
    return { at1000, at100, stalled };
  });
  assert.equal(r.at1000, 11);
  assert.equal(r.at100, 2);
  assert.ok(r.stalled <= 100 + 1, `${r.stalled}`);
}));

test('anything that is not an array is ignored (the output stays at zero)', () => withApp(app, async (page) => {
  assert.deepEqual((await run(page, [[0, 1], [0, 'ab'], [0, null], [0.003, null]])).got, [0, 0, 0, 0], 'nothing but zeros');
}));

test('Serializer has array[T] in and T out, both async; the output type follows what feeds it', () => withApp(app, async (page) => {
  for (const t of ['Strobe Source', 'Serializer', 'Pulse Shaper', 'Debug Sink']) await addFromPalette(page, t);
  assert.equal(await page.locator('.node:has-text("Serializer") .port.in.async').count(), 1);
  assert.equal(await page.locator('.node:has-text("Serializer") .port.out.async').count(), 1);
  const r = await page.evaluate(() => {
    const by = (t) => [...dsplab.graph.nodes.values()].find((n) => n.type === t);
    const [s, z, p, d] = ['strobe_source', 'serializer', 'pulse_shaper', 'debug_sink'].map(by);
    const e = (a, ap, b, bp) => !!dsplab.addEdge({ node: a.id, port: ap }, { node: b.id, port: bp });
    const out = {};
    out.nothingYet = [e(z, 'out', p, 'bits'), e(z, 'out', d, 'in')];   // T is unknown: anything goes
    out.fromStrobe = e(s, 'out', z, 'in');                             // array[uint8]: T = uint8
    out.left = dsplab.graph.edges.filter((x) => x.from.node === z.id).map((x) => x.to.node === d.id ? 'debug' : 'other');
    out.toPulse = e(z, 'out', p, 'bits');                              // a uint8 is not the int the Pulse Shaper takes (yet)
    out.audioIn = e(p, 'out', z, 'in');
    return out;
  });
  assert.deepEqual(r.nothingYet, [true, true]);
  assert.equal(r.fromStrobe, true);
  assert.deepEqual(r.left, ['debug'], 'the cable to the Pulse Shaper no longer fits and is dropped');
  assert.equal(r.toPulse, false);
  assert.equal(r.audioIn, false);
}));

test('the input takes array[T] only when T is not an array', () => withApp(app, async (page) => {
  for (const t of ['Strobe Source', 'Array Unpack', 'Array Reshape', 'Serializer']) await addFromPalette(page, t);
  const r = await page.evaluate(async () => {
    const g = await import('/src/core/graph.js');
    const by = (t) => [...dsplab.graph.nodes.values()].find((n) => n.type === t);
    const [s, u, z, k] = ['strobe_source', 'array_unpack', 'array_reshape', 'serializer'].map(by);
    const e = (a, ap, b, bp) => !!dsplab.addEdge({ node: a.id, port: ap }, { node: b.id, port: bp });
    const out = {};
    out.flat = e(s, 'out', k, 'in');                  // array[uint8]
    e(s, 'out', u, 'in');
    out.nested = e(u, 'out', k, 'in');                // array[array[uint8]]: its elements are arrays
    out.stillFlat = dsplab.graph.edges.some((x) => x.from.node === s.id && x.to.node === k.id);   // the refused cable changed nothing
    e(s, 'out', z, 'in');
    out.reshapeNested = e(z, 'out', k, 'in');         // Array Reshape with Rows 1: array[array[uint8]]
    g.setParam(z, 'rows', 0);                         // Rows 0: a plain array[uint8]
    out.reshapeFlat = e(z, 'out', k, 'in');
    g.setParam(z, 'rows', 3);                         // an array of arrays again: the cable to the Serializer no longer fits
    out.dropped = !dsplab.graph.edges.some((x) => x.from.node === z.id && x.to.node === k.id);
    return out;
  });
  assert.deepEqual(r, { flat: true, nested: false, stillFlat: true, reshapeNested: false, reshapeFlat: true, dropped: true });
}));
