'use strict';
const { before, after, test } = require('node:test');
const { assert, launch, withApp, sleep, startAudio } = require('./helpers');

let app;
before(async () => { app = await launch(); });
after(async () => { await app.close(); });

// Playwright dismisses dialogs by default; accept them, and keep the messages
const accepting = (page) => { const seen = []; page.on('dialog', (d) => { seen.push(d.message()); d.accept(); }); return seen; };
const types = (page) => page.evaluate(() => [...dsplab.graph.nodes.values()].map((n) => n.type).sort());

test('the Examples menu lists the examples under its title', () => withApp(app, async (page) => {
  assert.deepEqual(await page.locator('#examples option').allTextContents(), ['Examples', 'Simple tone', 'ASK modulation', 'ASK receiver', 'Audio source scope']);
  assert.equal(await page.locator('#examples').inputValue(), '');
}));

test('ASK modulation replaces the diagram with the wired example and the menu goes back to its title', () => withApp(app, async (page) => {
  accepting(page);
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
  accepting(page);
  await page.selectOption('#examples', { label: 'ASK modulation' });
  await page.selectOption('#examples', { label: 'Simple tone' });
  assert.deepEqual(await types(page), ['audio_sink', 'wave_generator']);
  assert.equal(await page.locator('#wires path.edge').count(), 1);
}));

test('loading an example is autosaved and the old blocks are gone from the canvas', () => withApp(app, async (page) => {
  accepting(page);
  await page.selectOption('#examples', { label: 'ASK modulation' });
  const saved = await page.evaluate(() => JSON.parse(localStorage.getItem('dsplab.diagram')));
  assert.equal(saved.nodes.length, 5);
  assert.equal(saved.edges.length, 5);
  await page.selectOption('#examples', { label: 'Simple tone' });
  assert.equal(await page.locator('.node').count(), 2);
}));

test('an example can be loaded while running and keeps running', () => withApp(app, async (page) => {
  accepting(page);
  await startAudio(page);
  await page.selectOption('#examples', { label: 'ASK modulation' });
  await sleep(300);
  assert.equal(await page.evaluate(() => dsplab.engine.running), true);
  assert.equal(await page.locator('.node').count(), 5);
}));

test('Audio source scope wires the Audio Source to a one-channel Oscilloscope', () => withApp(app, async (page) => {
  accepting(page);
  await page.selectOption('#examples', { label: 'Audio source scope' });
  assert.deepEqual(await types(page), ['audio_source', 'oscilloscope']);
  assert.equal(await page.locator('#wires path.edge').count(), 1);
  assert.equal(await page.locator('.node:has-text("Oscilloscope") .port.in').count(), 1);
}));

test('ASK receiver loads the whole chain with its settings, every cable connected', () => withApp(app, async (page) => {
  accepting(page);
  await page.selectOption('#examples', { label: 'ASK receiver' });
  assert.deepEqual(await types(page), ['audio_source', 'carrier_recovery', 'filter', 'math_operator', 'message_debug', 'message_deserialize', 'squelch', 'symbol_timing']);
  assert.equal(await page.locator('#wires path.edge').count(), 8);
  const p = await page.evaluate(() => Object.fromEntries([...dsplab.graph.nodes.values()].map((n) => [n.type, n.params])));
  assert.equal(p.carrier_recovery.frequency, 440);
  assert.equal(p.filter.frequency, 517);
  assert.equal(p.symbol_timing.baud, 1000);
  assert.deepEqual([p.message_deserialize.rows, p.message_deserialize.cols, p.message_deserialize.preamble], [8, 5, 'ddd']);
  assert.equal(p.message_debug.lines, 16);
}));

test('loading an example asks first, naming it, and cancelling keeps the diagram', () => withApp(app, async (page) => {
  const before = await page.evaluate(() => JSON.stringify(dsplab.serialize()));
  const messages = [];
  page.on('dialog', (d) => { messages.push(d.message()); d.dismiss(); });
  await page.selectOption('#examples', { label: 'ASK modulation' });
  assert.equal(messages.length, 1);
  assert.match(messages[0], /ASK modulation/);
  assert.equal(await page.evaluate(() => JSON.stringify(dsplab.serialize())), before);
  assert.equal(await page.locator('#examples').inputValue(), '', 'the menu goes back to its title');
}));

test('an empty diagram is replaced without asking', () => withApp(app, async (page) => {
  const seen = accepting(page);
  await page.evaluate(() => [...dsplab.graph.nodes.keys()].forEach(dsplab.removeNode));
  await page.selectOption('#examples', { label: 'ASK modulation' });
  assert.equal(seen.length, 0);
  assert.equal(await page.locator('.node').count(), 5);
}));
