'use strict';
const { before, after, test } = require('node:test');
const { assert, launch, withApp, addFromPalette, startAudio } = require('./helpers');

let app;
before(async () => { app = await launch(); });
after(async () => { await app.close(); });

// steps: [port, message]; returns what was sent and the final status
const run = (page, join, steps) => page.evaluate(([join, steps]) => {
  const blk = dsplab.BLOCKS.message_concatenate.build({}, { join });
  const got = [];
  blk.outputs.msg.connect({ receive: (m) => got.push(m) });
  steps.forEach(([port, m]) => blk.inputs[port].receive(m));
  return { got, status: blk.status };
}, [join, steps]);

test('columns: b goes after a, side by side', () => withApp(app, async (page) => {
  const { got, status } = await run(page, 'columns', [['a', [[1], [0]]], ['b', [[0, 1], [1, 1]]]]);
  assert.deepEqual(got, [[[1, 0, 1], [0, 1, 1]]]);
  assert.equal(status, '2x1 + 2x2 → 2x3');
}));

test('rows: b goes below a', () => withApp(app, async (page) => {
  const { got } = await run(page, 'rows', [['a', [[1, 0]]], ['b', [[0, 1], [1, 1]]]]);
  assert.deepEqual(got, [[[1, 0], [0, 1], [1, 1]]]);
}));

test('it sends when b arrives, with the last a received; nothing without an a', () => withApp(app, async (page) => {
  const none = await run(page, 'columns', [['b', [[1]]]]);
  assert.deepEqual(none.got, []);
  assert.equal(none.status, 'Waiting for a');
  const { got } = await run(page, 'columns', [['a', [[0]]], ['a', [[1]]], ['b', [[0]]], ['b', [[1]]]]);
  assert.deepEqual(got, [[[1, 0]], [[1, 1]]]);
}));

test('shapes that do not fit are dropped, and the block says so', () => withApp(app, async (page) => {
  const { got, status } = await run(page, 'columns', [['a', [[1], [0]]], ['b', [[1]]]]);
  assert.deepEqual(got, []);
  assert.equal(status, "2x1 and 1x1 can't join by columns");
}));

test('a preamble from one strobe in front of a payload from another is found by the Deserializer', () => withApp(app, async (page) => {
  for (const t of ['Message Strobe', 'Message Strobe', 'Message Concatenate', 'Message Serializer', 'Message Deserializer', 'Message Debug']) await addFromPalette(page, t);
  await page.evaluate(() => {
    const all = (t) => [...dsplab.graph.nodes.values()].filter((n) => n.type === t);
    const [pre, pay] = all('message_strobe');
    const [cat] = all('message_concatenate'), [ser] = all('message_serialize'), [des] = all('message_deserialize'), [dbg] = all('message_debug');
    // the preamble strobe fires first and often; only the payload's tick makes a message
    Object.assign(pre.params, { period: 50, message: '~~' });
    Object.assign(pay.params, { period: 300, message: 'hi' });
    ser.params.baud = 20000;
    Object.assign(des.params, { rows: 8, cols: 2, preamble: '~~' });
    const e = (a, ap, b, bp) => dsplab.addEdge({ node: a.id, port: ap }, { node: b.id, port: bp });
    e(pre, 'msg', cat, 'a'); e(pay, 'msg', cat, 'b'); e(cat, 'msg', ser, 'msg'); e(ser, 'msg', des, 'msg'); e(des, 'msg', dbg, 'msg');
  });
  await startAudio(page);
  await page.waitForFunction(() => /  hi\n?$/m.test(document.querySelector('.msg-log').textContent), null, { timeout: 8000 });
}));
