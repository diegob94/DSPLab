'use strict';
const { before, after, test } = require('node:test');
const { assert, launch, withApp, addFromPalette, selectNode, panelControl, startAudio } = require('./helpers');

let app;
before(async () => { app = await launch(); });
after(async () => { await app.close(); });

// Message Debug on its own, started; send(page, bits) delivers a message straight to its input.
async function withDebug(page, params = {}) {
  await addFromPalette(page, 'Message Debug');
  await page.evaluate((params) => {
    Object.assign([...dsplab.graph.nodes.values()].find((n) => n.type === 'message_debug').params, params);
  }, params);
  await startAudio(page);
}
const send = (page, bits) => page.evaluate((bits) => {
  const id = [...dsplab.graph.nodes.values()].find((n) => n.type === 'message_debug').id;
  dsplab.engine.live.get(id).inputs.msg.receive(bits);
}, bits);
const lastLine = async (page) => {
  await page.waitForFunction(() => !/^(Stopped|Waiting)/.test(document.querySelector('.msg-log').textContent));
  return (await page.locator('.msg-log').textContent()).split('\n').pop().replace(/^\d+\.\d{3} {2}/, '');
};

const A = [[0], [1], [0], [0], [0], [0], [0], [1]];   // 8 x 1: 'A' = 0x41

test('an 8 x N message is decoded to text', () => withApp(app, async (page) => {
  await withDebug(page);
  await send(page, A);
  assert.equal(await lastLine(page), 'A');
}));

test('other shapes are printed as bits, one group per row', () => withApp(app, async (page) => {
  await withDebug(page);
  await send(page, [[1, 0, 1], [0, 1, 1]]);
  assert.equal(await lastLine(page), '2x3  101 / 011');
}));

test('with Decode off an 8 x N message is printed as bits; the panel switches it live', () => withApp(app, async (page) => {
  await withDebug(page, { decode: 'off' });
  await send(page, A);
  assert.equal(await lastLine(page), '8x1  0 / 1 / 0 / 0 / 0 / 0 / 0 / 1');
  await selectNode(page, 'Message Debug');
  await panelControl(page, 'Decode').selectOption('on');
  await send(page, A);
  await page.waitForFunction(() => document.querySelector('.msg-log').textContent.endsWith('  A'));
}));

test('control characters in decoded text show as a dot so a line stays a line', () => withApp(app, async (page) => {
  await withDebug(page);
  await send(page, [[0], [0], [0], [0], [0], [0], [1], [0]]);   // 0x02
  assert.equal(await lastLine(page), '·');
}));
