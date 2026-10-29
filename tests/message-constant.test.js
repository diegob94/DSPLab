'use strict';
const { before, after, test } = require('node:test');
const { assert, launch, withApp, addFromPalette, panelControl, startAudio } = require('./helpers');

let app;
before(async () => { app = await launch(); });
after(async () => { await app.close(); });

const make = (page, type, value) => page.evaluate(([type, value]) => dsplab.BLOCKS.message_constant.constantMessage(type, value), [type, value]);

test('text is an 8 x N message, bits are a 1 x N message that ignores everything but 0 and 1', () => withApp(app, async (page) => {
  assert.deepEqual(await make(page, 'text', 'A'), [[0], [1], [0], [0], [0], [0], [0], [1]]);
  assert.deepEqual(await make(page, 'bits', '1011 0x1'), [[1, 0, 1, 1, 0, 1]]);
  assert.equal(await make(page, 'text', ''), null);
  assert.equal(await make(page, 'bits', 'abc'), null);
}));

test('it sends once after the cables are wired, and again only when the message changes', () => withApp(app, async (page) => {
  for (const t of ['Message Constant', 'Message Debug']) await addFromPalette(page, t);
  await page.evaluate(() => {
    const by = (t) => [...dsplab.graph.nodes.values()].find((n) => n.type === t);
    const [c, d] = ['message_constant', 'message_debug'].map(by);
    c.params.message = 'A';
    dsplab.addEdge({ node: c.id, port: 'msg' }, { node: d.id, port: 'msg' });
  });
  await startAudio(page);
  await page.waitForFunction(() => document.querySelector('.msg-log').textContent.endsWith('  A'));
  await page.evaluate(() => dsplab.select({ kind: 'node', id: [...dsplab.graph.nodes.values()].find((n) => n.type === 'message_constant').id }));
  await panelControl(page, 'Message').fill('B');
  await page.waitForFunction(() => document.querySelector('.msg-log').textContent.endsWith('  B'));
  await panelControl(page, 'Type').selectOption('bits');   // '1x1 ...' : the text "B" has no 0 or 1, so nothing is sent
  const lines = (await page.locator('.msg-log').textContent()).trim().split('\n');
  assert.equal(lines.length, 2, 'one line per different message');
}));

test('as the preamble of a Message Concatenate it is there before the first payload', () => withApp(app, async (page) => {
  for (const t of ['Message Constant', 'Message Strobe', 'Message Concatenate', 'Message Debug']) await addFromPalette(page, t);
  await page.evaluate(() => {
    const by = (t) => [...dsplab.graph.nodes.values()].find((n) => n.type === t);
    const [c, s, k, d] = ['message_constant', 'message_strobe', 'message_concatenate', 'message_debug'].map(by);
    c.params.message = 'ab';
    Object.assign(s.params, { period: 100, message: 'cd' });
    d.params.decode = 'on';
    dsplab.addEdge({ node: c.id, port: 'msg' }, { node: k.id, port: 'a' });
    dsplab.addEdge({ node: s.id, port: 'msg' }, { node: k.id, port: 'b' });
    dsplab.addEdge({ node: k.id, port: 'msg' }, { node: d.id, port: 'msg' });
  });
  await startAudio(page);
  await page.waitForFunction(() => document.querySelector('.msg-log').textContent.endsWith('  abcd'));
}));
