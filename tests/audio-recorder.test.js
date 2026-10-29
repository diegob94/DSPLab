'use strict';
const { before, after, test } = require('node:test');
const { assert, launch, withApp, sleep, selectNode, panelControl, setRange, startAudio } = require('./helpers');

let app;
before(async () => { app = await launch(); });
after(async () => { await app.close(); });

const seed = {
  version: 1, pan: { x: 0, y: 0 },
  nodes: [
    { id: 1, type: 'audio_recorder', x: 40, y: 60, params: { gap: 0.5 } },
    { id: 2, type: 'audio_sink', x: 360, y: 60, params: {} },
  ],
  edges: [{ from: { node: 1, port: 'out' }, to: { node: 2, port: 'in' } }],
};

const RECORD = '#props button.action';
const loopSeconds = (page) => page.evaluate(() => {
  const node = [...dsplab.graph.nodes.values()].find((n) => n.type === 'audio_recorder');
  const inst = dsplab.engine.live.get(node.id);
  return inst ? inst.loopSeconds() : null;
});
// hold the Record button with the real mouse for `ms`
async function hold(page, ms) {
  const box = await page.locator(RECORD).boundingBox();
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.down();
  await sleep(ms);
  await page.mouse.up();
}
const recorded = (page) => page.waitForFunction(() => /^Sample/.test(document.querySelector('.rec-status').textContent), null, { timeout: 10000 });
const sampleSeconds = async (page) => parseFloat((await page.textContent('.rec-status')).slice(7));

test('the Record button records from the microphone and the node shows the sample', () => withApp(app, async (page) => {
  assert.match(await page.textContent('.rec-status'), /^No sample/);
  await selectNode(page, 'Audio Recorder');
  assert.equal(await page.textContent(RECORD), 'Hold to record');
  const box = await page.locator(RECORD).boundingBox();
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.down();
  await sleep(300);
  assert.match(await page.textContent(RECORD), /^Recording/);
  assert.match(await page.textContent('.rec-status'), /^● Recording/);
  await sleep(500);
  await page.mouse.up();
  await recorded(page);
  const seconds = await sampleSeconds(page);
  assert.ok(seconds >= 0.6 && seconds <= 1.3, `held ~0.8 s, got a ${seconds} s sample`);
  assert.equal(await page.textContent(RECORD), 'Hold to record again');
}, { seed }));

test('the sample loops with the configured pause and a new recording is picked up while running', () => withApp(app, async (page) => {
  await startAudio(page);
  assert.equal(await loopSeconds(page), 0, 'silent until something is recorded');
  await selectNode(page, 'Audio Recorder');
  await hold(page, 800);
  await recorded(page);
  const sample = await sampleSeconds(page);
  const near = (a, b) => Math.abs(a - b) < 0.06;
  assert.ok(near(await loopSeconds(page), sample + 0.5));
  // changing the pause changes the loop
  await setRange(panelControl(page, 'Pause'), '2');
  assert.ok(near(await loopSeconds(page), sample + 2));
  await setRange(panelControl(page, 'Pause'), '0');
  assert.ok(near(await loopSeconds(page), sample));
}, { seed }));

test('the recording survives rebuilding the audio graph and is not saved with the diagram', () => withApp(app, async (page) => {
  await selectNode(page, 'Audio Recorder');
  await hold(page, 800);
  await recorded(page);
  await startAudio(page);
  const before = await loopSeconds(page);
  assert.ok(before > 0.9);
  // a structural change rebuilds every block
  await page.evaluate(() => dsplab.addNode('wave_generator', 10, 300));
  assert.equal(await loopSeconds(page), before);
  assert.ok(!JSON.stringify(await page.evaluate(() => dsplab.serialize())).includes('Float32'));
}, { seed }));

test('a stray click keeps the previous sample, and holding stops by itself at the maximum', () => withApp(app, async (page) => {
  await selectNode(page, 'Audio Recorder');
  await hold(page, 800);
  await recorded(page);
  const first = await sampleSeconds(page);
  await hold(page, 50);
  await sleep(300);
  assert.equal(await sampleSeconds(page), first, 'a 50 ms click does not replace the sample');
  // the limit is 10 s; shorten it for the test
  await page.evaluate(() => { dsplab.BLOCKS.audio_recorder.maxSeconds = 1.5; });
  await hold(page, 4000);   // still held after the limit: it has already stopped
  const capped = await sampleSeconds(page);
  assert.ok(capped >= 1.2 && capped <= 1.8, `capped at ~1.5 s, got ${capped}`);
  assert.equal(await page.textContent(RECORD), 'Hold to record again');
}, { seed }));
