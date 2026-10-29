'use strict';
const { before, after, test } = require('node:test');
const { assert, launch, withApp, addFromPalette, selectNode, panelControl, startAudio, sleep } = require('./helpers');

let app;
before(async () => { app = await launch(); });
after(async () => { await app.close(); });

// the app's own message helpers, from the same module instance the page uses
const toText = (page, bits) => page.evaluate(async (bits) => (await import('./src/blocks/message.js')).bitsToText(bits), bits);

const nodeOf = (page, type) => page.evaluate((type) => [...dsplab.graph.nodes.values()].find((n) => n.type === type).id, type);

// subscribes to the strobe's output and collects what it sends in window.got
const listen = (page, id) => page.evaluate((id) => {
  window.got = [];
  dsplab.engine.live.get(id).outputs.msg.connect({ receive: (m) => window.got.push(m) });
}, id);

test('a running strobe sends its text as an 8 x N array of bits every period and stops with the engine', () => withApp(app, async (page) => {
  await addFromPalette(page, 'Message Strobe');
  const id = await nodeOf(page, 'message_strobe');
  await page.evaluate((id) => {
    const n = dsplab.graph.nodes.get(id);
    n.params.period = 20;
    n.params.message = 'ping 1';
  }, id);
  await startAudio(page);
  await listen(page, id);
  await sleep(300);
  const got = await page.evaluate(() => window.got);
  assert.ok(got.length >= 5, `only ${got.length} messages in 300 ms`);
  assert.ok(got.every((m) => m.length === 8 && m.every((row) => row.length === 6)), 'every message is 8 x 6 (one column per byte)');
  assert.equal(await toText(page, got[0]), 'ping 1');
  assert.deepEqual(got[0].map((row) => row[0]), [0, 1, 1, 1, 0, 0, 0, 0], "first column is 'p' = 0x70, most significant bit first");
  await page.evaluate(() => dsplab.engine.stop());
  const n = await page.evaluate(() => window.got.length);
  await sleep(100);
  assert.equal(await page.evaluate(() => window.got.length), n, 'messages after stop');
}));

test('retyping the message while running applies live, without a rebuild', () => withApp(app, async (page) => {
  await addFromPalette(page, 'Message Strobe');
  const id = await nodeOf(page, 'message_strobe');
  await page.evaluate((id) => { dsplab.graph.nodes.get(id).params.period = 20; }, id);
  await startAudio(page);
  await listen(page, id);   // connected to this very instance: a rebuild would silence it
  await selectNode(page, 'Message Strobe');
  await panelControl(page, 'Message').fill('héllo wörld');
  await sleep(200);
  const got = await page.evaluate(() => window.got);
  assert.ok(got.length >= 3);
  assert.equal(got[got.length - 1][0].length, 'héllo wörld'.length + 2, 'UTF-8: two bytes for each of é and ö');
  assert.equal(await toText(page, got[got.length - 1]), 'héllo wörld');
  assert.equal(await page.locator('.node:has-text("Message Strobe") .kv:has-text("Message") b').textContent(), 'héllo wörld');
}));

test('Message Debug prints the messages the strobe sends, newest last, up to its Lines setting', () => withApp(app, async (page) => {
  await addFromPalette(page, 'Message Strobe');
  await addFromPalette(page, 'Message Debug');
  const edge = await page.evaluate(() => {
    const strobe = [...dsplab.graph.nodes.values()].find((n) => n.type === 'message_strobe');
    const debug = [...dsplab.graph.nodes.values()].find((n) => n.type === 'message_debug');
    strobe.params.period = 20;
    strobe.params.message = 'tick';
    debug.params.lines = 4;
    return !!dsplab.addEdge({ node: strobe.id, port: 'msg' }, { node: debug.id, port: 'msg' });
  });
  assert.ok(edge, 'message cable accepted');
  const log = page.locator('.node:has-text("Message Debug") .msg-log');
  await page.waitForFunction(() => document.querySelector('.msg-log').textContent === 'Stopped');   // first frame
  await startAudio(page);
  await sleep(400);
  const lines = (await log.textContent()).split('\n');
  assert.equal(lines.length, 4, 'keeps only the newest 4');
  assert.ok(lines.every((l) => /^\d+\.\d{3} {2}tick$/.test(l)), lines.join('|'));
}));

test('message ports render square and cannot be cabled to audio ports', () => withApp(app, async (page) => {
  await addFromPalette(page, 'Message Strobe');
  await addFromPalette(page, 'Message Debug');
  assert.equal(await page.locator('.node:has-text("Message Strobe") .port.out.msg').count(), 1);
  assert.equal(await page.locator('.node:has-text("Message Debug") .port.in.msg').count(), 1);
  const result = await page.evaluate(() => {
    const { graph, addEdge } = dsplab;
    const find = (t) => [...graph.nodes.values()].find((n) => n.type === t);
    const before = graph.edges.length;
    const wrong = [
      addEdge({ node: find('message_strobe').id, port: 'msg' }, { node: find('audio_sink').id, port: 'in' }),
      addEdge({ node: find('wave_generator').id, port: 'out' }, { node: find('message_debug').id, port: 'msg' }),
    ];
    return { wrong, added: graph.edges.length - before };
  });
  assert.deepEqual(result.wrong, [null, null]);
  assert.equal(result.added, 0);
}));

test('a text parameter is validated when a diagram is loaded', () => withApp(app, async (page) => {
  const messages = await page.evaluate(() => [...dsplab.graph.nodes.values()].map((n) => n.params.message));
  assert.equal(messages[0].length, 100, 'long text is cut to maxLength');
  assert.equal(messages[1], 'hello', 'a non-string falls back to the default');
}, { seed: { version: 1, pan: { x: 0, y: 0 }, edges: [], nodes: [
  { id: 1, type: 'message_strobe', x: 50, y: 50, params: { period: 500, message: 'x'.repeat(300) } },
  { id: 2, type: 'message_strobe', x: 50, y: 250, params: { period: 500, message: 42 } },
] } }));
