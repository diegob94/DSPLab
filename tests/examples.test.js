'use strict';
const { before, after, test } = require('node:test');
const { assert, launch, withApp, sleep, startAudio } = require('./helpers');

let app;
before(async () => { app = await launch(); });
after(async () => { await app.close(); });

const types = (page) => page.evaluate(() => [...dsplab.graph.nodes.values()].map((n) => n.type).sort());

test('the Examples menu lists the examples under its title', () => withApp(app, async (page) => {
  assert.deepEqual(await page.locator('#examples option').allTextContents(), ['Examples', 'Simple tone', 'ASK modulation', 'Audio source scope']);
  assert.equal(await page.locator('#examples').inputValue(), '');
}));

test('ASK modulation replaces the diagram with the wired example and the menu goes back to its title', () => withApp(app, async (page) => {
  await page.selectOption('#examples', { label: 'ASK modulation' });
  assert.deepEqual(await types(page), ['audio_sink', 'math_operator', 'oscilloscope', 'wave_generator', 'wave_generator']);
  assert.equal(await page.locator('.node').count(), 5);
  assert.equal(await page.locator('#wires path.edge').count(), 5);
  assert.equal(await page.locator('#examples').inputValue(), '');
  const op = await page.evaluate(() => [...dsplab.graph.nodes.values()].find((n) => n.type === 'math_operator').params.operation);
  assert.equal(op, 'multiply');
  const scope = await page.evaluate(() => [...dsplab.graph.nodes.values()].find((n) => n.type === 'oscilloscope').params);
  assert.equal(scope.trigger, 'ch2');
  assert.equal(scope.channels, 2);
}));

test('Simple tone brings back the starter diagram', () => withApp(app, async (page) => {
  await page.selectOption('#examples', { label: 'ASK modulation' });
  await page.selectOption('#examples', { label: 'Simple tone' });
  assert.deepEqual(await types(page), ['audio_sink', 'wave_generator']);
  assert.equal(await page.locator('#wires path.edge').count(), 1);
}));

test('loading an example is autosaved and the old blocks are gone from the canvas', () => withApp(app, async (page) => {
  await page.selectOption('#examples', { label: 'ASK modulation' });
  const saved = await page.evaluate(() => JSON.parse(localStorage.getItem('dsplab.diagram')));
  assert.equal(saved.nodes.length, 5);
  assert.equal(saved.edges.length, 5);
  await page.selectOption('#examples', { label: 'Simple tone' });
  assert.equal(await page.locator('.node').count(), 2);
}));

test('an example can be loaded while running and keeps running', () => withApp(app, async (page) => {
  await startAudio(page);
  await page.selectOption('#examples', { label: 'ASK modulation' });
  await sleep(300);
  assert.equal(await page.evaluate(() => dsplab.engine.running), true);
  assert.equal(await page.locator('.node').count(), 5);
}));

test('Audio source scope wires the Audio Source to a one-channel Oscilloscope', () => withApp(app, async (page) => {
  await page.selectOption('#examples', { label: 'Audio source scope' });
  assert.deepEqual(await types(page), ['audio_source', 'oscilloscope']);
  assert.equal(await page.locator('#wires path.edge').count(), 1);
  assert.equal(await page.locator('.node:has-text("Oscilloscope") .port.in').count(), 1);
}));
