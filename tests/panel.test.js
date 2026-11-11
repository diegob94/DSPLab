'use strict';
const { before, after, test } = require('node:test');
const { assert, launch, withApp, selectNode, addFromPalette, setRange, startAudio } = require('./helpers');

let app;
before(async () => { app = await launch(); });
after(async () => { await app.close(); });

test('nodes contain no editable controls', () => withApp(app, async (page) => {
  await addFromPalette(page, 'Oscilloscope');
  await addFromPalette(page, 'Math Operator');
  assert.equal(await page.locator('.node input, .node select').count(), 0);
}));

test('nothing selected shows a hint; selecting a block lists all its parameters', () => withApp(app, async (page) => {
  assert.match(await page.locator('#props .hint').textContent(), /Select a block/);
  await selectNode(page, 'Wave Generator');
  assert.equal(await page.locator('#props .props-head').textContent(), 'Wave Generator');
  assert.deepEqual(await page.locator('#props .param label').allTextContents(), ['Waveform', 'Frequency', 'Amplitude', 'Offset']);
}));

test('nodes only show their key values', () => withApp(app, async (page) => {
  const rows = (title) => page.locator(`.node:has-text("${title}") .kv span`).allTextContents();
  assert.deepEqual(await rows('Wave Generator'), ['Waveform', 'Frequency', 'Offset']);
  assert.deepEqual(await rows('Audio Sink'), ['Volume']);
  await addFromPalette(page, 'Math Operator');
  assert.deepEqual(await rows('Math Operator'), ['Operation']);
  await addFromPalette(page, 'Oscilloscope');
  assert.deepEqual(await rows('Oscilloscope'), ['Trigger', 'Trig mode', 'X / div', 'Y / div']);
}));

test('editing in the panel updates the node, the model and the audio params', () => withApp(app, async (page) => {
  await selectNode(page, 'Wave Generator');
  await page.locator('#props select').selectOption('triangle');
  await setRange(page.locator('#props input[type=range]').first(), 0.8);
  const params = await page.evaluate(() => [...dsplab.graph.nodes.values()][0].params);
  assert.equal(params.waveform, 'triangle');
  const summary = (await page.locator('.node:has-text("Wave Generator") .kv').allTextContents()).join();
  assert.ok(summary.includes('triangle'));
  assert.ok(summary.includes(`${params.frequency} Hz`));
  assert.ok(!summary.includes('Amplitude'));
}));

test('the panel follows the selection and survives interacting with it', () => withApp(app, async (page) => {
  await selectNode(page, 'Audio Sink');
  assert.equal(await page.locator('#props .props-head').textContent(), 'Audio Sink');
  await page.locator('#props input[type=range]').click();
  assert.equal(await page.locator('#props .props-head').textContent(), 'Audio Sink');
  await page.mouse.click(600, 600);   // empty canvas
  assert.equal(await page.locator('#props .param').count(), 0);
  assert.equal(await page.locator('#props .hint').count(), 1);
}));

test('selecting a cable shows its endpoints; deleting a block clears the panel', () => withApp(app, async (page) => {
  await page.locator('#wires path.edge').dispatchEvent('pointerdown');
  assert.match(await page.locator('#props').textContent(), /Wave Generator · out.*Audio Sink · in/);
  await selectNode(page, 'Audio Sink');
  await page.keyboard.press('Delete');
  assert.equal(await page.locator('#props .param').count(), 0);
}));

test('selecting a cable shows its type, clock and, while running, the size of what flows through it', () => withApp(app, async (page) => {
  for (const t of ['Strobe Source', 'Array Unpack', 'Debug Sink', 'Wave Generator', 'Audio Sink']) await addFromPalette(page, t);
  const ids = await page.evaluate(() => {
    const by = (t) => [...dsplab.graph.nodes.values()].find((n) => n.type === t);
    const [s, u, d, w, k] = ['strobe_source', 'array_unpack', 'debug_sink', 'wave_generator', 'audio_sink'].map(by);
    s.params.period = 50;
    const e = (a, ap, b, bp) => dsplab.addEdge({ node: a.id, port: ap }, { node: b.id, port: bp }).id;
    return { sd: e(s, 'out', u, 'in'), ud: e(u, 'out', d, 'in'), wk: e(w, 'out', k, 'in') };
  });
  const show = (id) => page.evaluate((id) => dsplab.select({ kind: 'edge', id }), id);
  const rows = async () => Object.fromEntries(await page.locator('#props-body .kv').evaluateAll((els) => els.map((el) => [el.children[0].textContent, el.children[1].textContent])));
  await show(ids.sd);
  let r = await rows();
  assert.equal(r.Type, 'array[uint8]');
  assert.equal(r.Clock, 'asynchronous');
  assert.equal(r.Size, 'Run to see the size');
  await show(ids.wk);
  r = await rows();
  assert.deepEqual([r.Type, r.Clock, r.Size], ['audio', 'audio (sample rate)', 'continuous signal']);
  await startAudio(page);
  await show(ids.sd);
  await page.waitForFunction(() => /5 elements/.test(document.querySelector('#props-body').textContent));   // 'hello'
  await show(ids.ud);
  await page.waitForFunction(() => /5 × 8 \(rows × columns\)/.test(document.querySelector('#props-body').textContent));   // 5 bytes of 8 bits
  assert.match(await page.textContent('#props-body'), /array\[array\[uint8\]\]/);
}));

test('the Serializer sends a signal whose sample rate is its baud rate, and the cable says so', () => withApp(app, async (page) => {
  for (const t of ['Strobe Source', 'Serializer', 'Debug Sink']) await addFromPalette(page, t);
  const ids = await page.evaluate(() => {
    const by = (t) => [...dsplab.graph.nodes.values()].find((n) => n.type === t);
    const [s, z, d] = ['strobe_source', 'serializer', 'debug_sink'].map(by);
    const e = (a, ap, b, bp) => dsplab.addEdge({ node: a.id, port: ap }, { node: b.id, port: bp }).id;
    z.params.baud = 2400;
    return { sz: e(s, 'out', z, 'in'), zd: e(z, 'out', d, 'in'), z: z.id };
  });
  const clock = () => page.evaluate(() => [...document.querySelectorAll('#props-body .kv')].find((el) => el.children[0].textContent === 'Clock').children[1].textContent);
  await page.evaluate((id) => dsplab.select({ kind: 'edge', id }), ids.zd);
  assert.equal(await clock(), 'asynchronous, 2400 samples/s');
  await page.evaluate((id) => { dsplab.graph.nodes.get(id).params.baud = 500; }, ids.z);   // the panel follows the setting
  await page.waitForFunction(() => /500 samples\/s/.test(document.querySelector('#props-body').textContent));
  await page.evaluate((id) => dsplab.select({ kind: 'edge', id }), ids.sz);
  assert.equal(await clock(), 'asynchronous', 'a Strobe Source sets no sample rate');
}));
