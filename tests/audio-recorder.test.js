'use strict';
const { before, after, test } = require('node:test');
const { assert, launch, withApp, selectNode, panelControl, setRange, startAudio } = require('./helpers');

let app;
before(async () => { app = await launch(); });
after(async () => { await app.close(); });

const seed = {
  version: 1, pan: { x: 0, y: 0 },
  nodes: [
    { id: 1, type: 'audio_recorder', x: 40, y: 60, params: { length: 1, gap: 0.5 } },
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
const recorded = (page) => page.waitForFunction(() => /^Sample/.test(document.querySelector('.rec-status').textContent), null, { timeout: 10000 });
const sampleSeconds = async (page) => parseFloat((await page.textContent('.rec-status')).slice(7));

test('the Record button records from the microphone and the node shows the sample', () => withApp(app, async (page) => {
  assert.match(await page.textContent('.rec-status'), /^No sample/);
  await selectNode(page, 'Audio Recorder');
  assert.equal(await page.textContent(RECORD), 'Record');
  await page.click(RECORD);
  assert.equal(await page.textContent(RECORD), 'Recording…');
  assert.ok(await page.locator(RECORD).isDisabled());
  await recorded(page);
  assert.match(await page.textContent('.rec-status'), /^Sample [01]\.\d s$/);
  assert.equal(await page.textContent(RECORD), 'Record again');
  assert.ok(await page.locator(RECORD).isEnabled());
}, { seed }));

test('the sample loops with the configured pause and a new recording is picked up while running', () => withApp(app, async (page) => {
  await startAudio(page);
  assert.equal(await loopSeconds(page), 0, 'silent until something is recorded');
  await selectNode(page, 'Audio Recorder');
  await page.click(RECORD);
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
  await page.click(RECORD);
  await recorded(page);
  await startAudio(page);
  const before = await loopSeconds(page);
  assert.ok(before > 0.9);
  // a structural change rebuilds every block
  await page.evaluate(() => dsplab.addNode('wave_generator', 10, 300));
  assert.equal(await loopSeconds(page), before);
  assert.ok(!JSON.stringify(await page.evaluate(() => dsplab.serialize())).includes('Float32'));
}, { seed }));
