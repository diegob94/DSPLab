'use strict';
const { before, after, test } = require('node:test');
const { assert, launch, withApp, addFromPalette, startAudio, sleep } = require('./helpers');

let app;
before(async () => { app = await launch(); });
after(async () => { await app.close(); });

const strobeNode = (page) => page.evaluate(() => [...dsplab.graph.nodes.values()].find((n) => n.type === 'message_strobe').id);

// subscribes to the strobe's output and returns the messages received so far
const listen = (page, id) => page.evaluate((id) => {
  window.got = [];
  dsplab.engine.live.get(id).outputs.msg.connect({ receive: (m) => window.got.push(m) });
}, id);

test('a running strobe sends its value every period and stops with the engine', () => withApp(app, async (page) => {
  await addFromPalette(page, 'Message Strobe');
  const id = await strobeNode(page);
  await page.evaluate((id) => {
    const n = dsplab.graph.nodes.get(id);
    n.params.period = 20;
    n.params.value = 7;
  }, id);
  await startAudio(page);
  await listen(page, id);
  await sleep(300);
  const got = await page.evaluate(() => window.got);
  assert.ok(got.length >= 5, `only ${got.length} messages in 300 ms`);
  assert.ok(got.every((m) => m === 7));
  await page.evaluate(() => dsplab.engine.stop());
  const n = await page.evaluate(() => window.got.length);
  await sleep(100);
  assert.equal(await page.evaluate(() => window.got.length), n, 'messages after stop');
}));

test('changing the value and the period applies without rebuilding', () => withApp(app, async (page) => {
  await addFromPalette(page, 'Message Strobe');
  const id = await strobeNode(page);
  await startAudio(page);
  await listen(page, id);
  await page.evaluate((id) => {
    const n = dsplab.graph.nodes.get(id);
    n.params.period = 20;
    n.params.value = -3;
    dsplab.engine.updateNode(n);
  }, id);
  await sleep(200);
  const got = await page.evaluate(() => window.got);
  assert.ok(got.length >= 3);
  assert.ok(got.every((m) => m === -3), 'the listener (connected before) still receives: no rebuild happened');
}));

test('message ports render square and cannot be cabled to audio ports', () => withApp(app, async (page) => {
  await addFromPalette(page, 'Message Strobe');
  assert.equal(await page.locator('.node:has-text("Message Strobe") .port.out.msg').count(), 1);
  const result = await page.evaluate(() => {
    const { graph, addEdge } = dsplab;
    const strobe = [...graph.nodes.values()].find((n) => n.type === 'message_strobe');
    const sink = [...graph.nodes.values()].find((n) => n.type === 'audio_sink');
    const before = graph.edges.length;
    const edge = addEdge({ node: strobe.id, port: 'msg' }, { node: sink.id, port: 'in' });
    return { edge, added: graph.edges.length - before };
  });
  assert.equal(result.edge, null);
  assert.equal(result.added, 0);
}));
