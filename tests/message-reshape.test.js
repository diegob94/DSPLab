'use strict';
const { before, after, test } = require('node:test');
const { assert, launch, withApp, addFromPalette, startAudio } = require('./helpers');

let app;
before(async () => { app = await launch(); });
after(async () => { await app.close(); });

// the reshape function on its own (the app's module instance)
const reshape = (page, m, rows, cols) => page.evaluate(async ([m, rows, cols]) => (await import('./src/blocks/message.js')).reshape(m, rows, cols), [m, rows, cols]);

const ramp = (rows, cols) => Array.from({ length: rows }, (_, i) => Array.from({ length: cols }, (_, j) => (i * cols + j) % 2));
const flat = (m) => m.flat();

test('reshape follows numpy: row-major, any shape with the same number of bits', () => withApp(app, async (page) => {
  const m = ramp(1, 100).map((r) => r.map((_, j) => (j % 3 === 0 ? 1 : 0)));
  const r = await reshape(page, m, 10, 10);
  assert.equal(r.length, 10);
  assert.ok(r.every((row) => row.length === 10));
  assert.deepEqual(flat(r), flat(m), 'same bits in the same order');
  assert.deepEqual(r[1], m[0].slice(10, 20), 'row 1 is bits 10..19');
  assert.deepEqual(await reshape(page, r, 1, 100), m, 'and back');
}));

test('-1 is worked out from the other dimension, like numpy', () => withApp(app, async (page) => {
  const m = ramp(8, 5);   // 40 bits
  assert.deepEqual((await reshape(page, m, -1, 4)).length, 10);
  assert.deepEqual((await reshape(page, m, 2, -1))[0].length, 20);
  assert.deepEqual((await reshape(page, m, 1, -1))[0].length, 40);
}));

test('shapes that do not fit give nothing', () => withApp(app, async (page) => {
  const m = ramp(8, 5);
  assert.equal(await reshape(page, m, 7, 6), null, '42 != 40');
  assert.equal(await reshape(page, m, -1, 7), null, '40 is not a multiple of 7');
  assert.equal(await reshape(page, m, -1, -1), null, 'only one dimension can be -1');
  assert.equal(await reshape(page, m, 0, 40), null);
}));

test('the block reshapes what it receives, passes it on, and reports a misfit instead of sending it', () => withApp(app, async (page) => {
  await addFromPalette(page, 'Message Reshape');
  await page.evaluate(() => {
    const n = [...dsplab.graph.nodes.values()].find((n) => n.type === 'message_reshape');
    n.params.rows = 2;
    n.params.cols = -1;
  });
  await startAudio(page);
  const run = (m) => page.evaluate((m) => {
    const n = [...dsplab.graph.nodes.values()].find((n) => n.type === 'message_reshape');
    const inst = dsplab.engine.live.get(n.id);
    const got = [];
    inst.outputs.msg.connect({ receive: (r) => got.push(r) });
    inst.inputs.msg.receive(m);
    return got;
  }, m);
  const ok = await run(ramp(8, 5));
  assert.equal(ok.length, 1);
  assert.deepEqual([ok[0].length, ok[0][0].length], [2, 20]);
  await page.waitForFunction(() => document.querySelector('.msg-status').textContent === '8x5 → 2x20');
  const bad = await run(ramp(3, 3));   // 9 bits do not split into 2 rows
  assert.deepEqual(bad, []);
  await page.waitForFunction(() => document.querySelector('.msg-status').textContent === "3x3 can't be 2 x -1");
}));

test('the output of a reshape can feed Message Debug, which then prints bits', () => withApp(app, async (page) => {
  await addFromPalette(page, 'Message Strobe');
  await addFromPalette(page, 'Message Reshape');
  await addFromPalette(page, 'Message Debug');
  await page.evaluate(() => {
    const by = (t) => [...dsplab.graph.nodes.values()].find((n) => n.type === t);
    const [s, r, d] = ['message_strobe', 'message_reshape', 'message_debug'].map(by);
    s.params.period = 20;
    s.params.message = 'A';   // 8 x 1
    r.params.rows = 1;
    r.params.cols = -1;       // -> 1 x 8
    dsplab.addEdge({ node: s.id, port: 'msg' }, { node: r.id, port: 'msg' });
    dsplab.addEdge({ node: r.id, port: 'msg' }, { node: d.id, port: 'msg' });
  });
  await startAudio(page);
  await page.waitForFunction(() => /1x8 {2}01000001$/m.test(document.querySelector('.msg-log').textContent));
}));
