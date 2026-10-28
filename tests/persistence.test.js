'use strict';
const { before, after, test } = require('node:test');
const { assert, launch, withApp, sleep, selectNode, addFromPalette, connect, setRange, snapshot } = require('./helpers');

let app;
before(async () => { app = await launch(); });
after(async () => { await app.close(); });

test('edits survive a reload, even one right after the change', () => withApp(app, async (page) => {
  await addFromPalette(page, 'Oscilloscope');
  await addFromPalette(page, 'Math Operator');
  await selectNode(page, 'Wave Generator');
  await page.locator('#props select').selectOption('square');
  await setRange(page.locator('#props input[type=range]').first(), 0.7);

  const title = await page.locator('.node:has-text("Math Operator") .node-title').boundingBox();   // drag a block
  await page.mouse.move(title.x + 20, title.y + 8);
  await page.mouse.down();
  await page.mouse.move(title.x + 60, title.y + 160, { steps: 5 });
  await page.mouse.up();
  await page.mouse.move(300, 700);                                                                  // pan the canvas (empty spot)
  await page.mouse.down();
  await page.mouse.move(240, 660, { steps: 4 });
  await page.mouse.up();
  await connect(page, '.node:has-text("Wave Generator") .port.out', '.node:has-text("Oscilloscope") .port.in[data-port="ch2"]');

  const before = await snapshot(page);
  assert.equal(JSON.parse(before).edges.length, 2);
  assert.deepEqual(JSON.parse(before).pan, { x: -60, y: -40 });

  await page.reload();   // no waiting: the page flushes on pagehide
  assert.equal(await snapshot(page), before);
  assert.equal(await page.locator('.node').count(), 4);
  assert.equal(await page.locator('#wires path.edge[d]').count(), 2, 'wires are drawn again');
  await selectNode(page, 'Wave Generator');
  assert.equal(await page.locator('#props select').inputValue(), 'square');
}));

test('changes are autosaved shortly afterwards, without closing the page', () => withApp(app, async (page) => {
  const saved = () => page.evaluate(() => JSON.parse(localStorage.getItem('dsplab.diagram')));
  await addFromPalette(page, 'Math Operator');            // structure
  await sleep(500);
  assert.equal((await saved()).nodes.length, 3);

  await selectNode(page, 'Wave Generator');               // parameter
  await page.locator('#props select').selectOption('sawtooth');
  await sleep(500);
  assert.equal((await saved()).nodes[0].params.waveform, 'sawtooth');

  const t = await page.locator('.node:has-text("Audio Sink") .node-title').boundingBox();   // position
  await page.mouse.move(t.x + 30, t.y + 10);
  await page.mouse.down();
  await page.mouse.move(t.x + 80, t.y + 90, { steps: 4 });
  await page.mouse.up();
  await sleep(500);
  const sink = (await saved()).nodes.find((n) => n.type === 'audio_sink');
  assert.deepEqual([sink.x, sink.y], await page.evaluate(() => { const n = [...dsplab.graph.nodes.values()].find((n) => n.type === 'audio_sink'); return [n.x, n.y]; }));
  assert.notDeepEqual([sink.x, sink.y], [420, 120], 'the new position, not the starter one');
}));

test('the number of oscilloscope inputs, the trigger and their cables are restored', () => withApp(app, async (page) => {
  await addFromPalette(page, 'Oscilloscope');
  await setRange(page.locator('#props input[type=range]').first(), 3);
  await page.locator('#props select').selectOption('ch3');
  await page.evaluate(() => {
    const scope = [...dsplab.graph.nodes.values()].find((n) => n.type === 'oscilloscope');
    dsplab.addEdge({ node: [...dsplab.graph.nodes.values()][0].id, port: 'out' }, { node: scope.id, port: 'ch3' });
  });
  const before = await snapshot(page);
  await page.reload();
  assert.equal(await snapshot(page), before);
  assert.equal(await page.locator('.node:has-text("Oscilloscope") .port.in').count(), 3);
}));

test('new blocks after a restore get fresh ids', () => withApp(app, async (page) => {
  await page.evaluate(() => dsplab.removeNode(2));        // leave a gap in the ids
  await sleep(300);
  await page.reload();
  await addFromPalette(page, 'Audio Sink');
  const ids = await page.evaluate(() => [...dsplab.graph.nodes.keys()]);
  assert.equal(new Set(ids).size, ids.length, `ids ${ids}`);
}));

test('a restored diagram can run', () => withApp(app, async (page) => {
  await addFromPalette(page, 'Math Operator');
  await page.reload();
  await page.click('#run');
  await sleep(300);
  assert.match(await page.textContent('#status'), /^Running/);
}));

test('an emptied diagram stays empty', () => withApp(app, async (page) => {
  await page.evaluate(() => [...dsplab.graph.nodes.keys()].forEach(dsplab.removeNode));
  await sleep(300);
  await page.reload();
  assert.equal(await page.locator('.node').count(), 0);
}));

test('corrupt saved data falls back to the starter diagram', () => withApp(app, async (page) => {
  assert.equal(await page.locator('.node').count(), 2);
  assert.equal(await page.locator('#wires path.edge').count(), 1);
}, { seed: '{not json' }));

test('saved data is sanitised: bad values reset, unknown blocks/ports dropped, ranges clamped', () => withApp(app, async (page) => {
  const state = await page.evaluate(() => dsplab.serialize());
  assert.equal(state.nodes.length, 3);
  assert.deepEqual(state.edges.length, 1);
  assert.deepEqual(state.nodes[0].params, { waveform: 'sine', frequency: 440, amplitude: 0.25 });
  assert.deepEqual(state.pan, { x: 0, y: 0 });
  const scope = state.nodes[2].params;
  assert.deepEqual([scope.channels, scope.trigger, scope.level], [8, 'ch1', 1]);
}, {
  seed: {
    version: 1,
    pan: { x: 'a' },
    nodes: [
      { id: 7, type: 'wave_generator', x: 50, y: 60, params: { waveform: 'bogus', frequency: 'NaN', amplitude: 0.25 } },
      { id: 8, type: 'does_not_exist', x: 1, y: 1 },
      { id: 9, type: 'audio_sink', x: 400, y: 60, params: {} },
      { id: 10, type: 'oscilloscope', x: 50, y: 300, params: { channels: 99, trigger: 'ch9', level: 5 } },
    ],
    edges: [
      { from: { node: 7, port: 'out' }, to: { node: 9, port: 'in' } },
      { from: { node: 7, port: 'out' }, to: { node: 8, port: 'in' } },
      { from: { node: 7, port: 'nope' }, to: { node: 9, port: 'in' } },
    ],
  },
}));

test('the app still works when localStorage is blocked', async () => {
  const ctx = await app.browser.newContext();
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.addInitScript(() => { Object.defineProperty(window, 'localStorage', { get() { throw new Error('blocked'); } }); });
  await page.goto(app.url);
  await addFromPalette(page, 'Math Operator');
  await sleep(400);
  assert.equal(await page.locator('.node').count(), 3);
  assert.deepEqual(errors, []);
  await ctx.close();
});
