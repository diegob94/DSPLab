'use strict';
const { before, after, test } = require('node:test');
const { assert, launch, withApp, selectNode, addFromPalette, setRange } = require('./helpers');

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
