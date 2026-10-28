'use strict';
const { before, after, test } = require('node:test');
const { assert, launch, withApp, sleep, selectNode, addFromPalette, setRange } = require('./helpers');

let app;
before(async () => { app = await launch(); });
after(async () => { await app.close(); });

const PORTS = '.node:has-text("Oscilloscope") .port.in';
const portNames = (page) => page.locator(PORTS).evaluateAll((els) => els.map((e) => e.dataset.port));
const triggerOptions = (page) => page.locator('#props select option').allTextContents();
const setInputs = (page, n) => setRange(page.locator('#props input[type=range]').first(), n);

// Reads `frames` snapshots spread over time (audio has to advance between them) and reports,
// per channel, the slope direction of the first samples and the range of the first sample.
const readFrames = (page, { trigger, level = 0, frames = 12 }) => page.evaluate(async ([trigger, level, frames]) => {
  const inst = dsplab.engine.live.get(scope.id);
  const rows = [];
  for (let i = 0; i < frames; i++) {
    rows.push(inst.sample(10, level, trigger).map((d) => d && [d[0], d[6]]));
    await new Promise((r) => setTimeout(r, 37));
  }
  const slope = (k) => {
    const d = rows.map((r) => r[k][1] - r[k][0]);
    return d.every((x) => x > 0) ? 'rising' : d.every((x) => x < 0) ? 'falling' : 'mixed';
  };
  const firsts = (k) => rows.map((r) => r[k][0]);
  return {
    slope: rows[0].map((_, k) => (rows[0][k] ? slope(k) : null)),
    first: [Math.min(...firsts(0)), Math.max(...firsts(0))].map((v) => +v.toFixed(3)),
    unconnected: rows[0].map((r) => r === null),
  };
}, [trigger, level, frames]);

// scope on the default graph: gen -> ch1 and gen -> math(subtract, i.e. -gen) -> ch2
async function wireScope(page) {
  await addFromPalette(page, 'Oscilloscope');
  await setInputs(page, 3);
  await page.evaluate(() => {
    const gen = [...dsplab.graph.nodes.values()][0];
    window.scope = [...dsplab.graph.nodes.values()].find((n) => n.type === 'oscilloscope');
    window.inv = dsplab.addNode('math_operator', 200, 420);
    inv.params.operation = 'subtract';
    dsplab.addEdge({ node: gen.id, port: 'out' }, { node: scope.id, port: 'ch1' });
    dsplab.addEdge({ node: gen.id, port: 'out' }, { node: inv.id, port: 'b' });
    dsplab.addEdge({ node: inv.id, port: 'out' }, { node: scope.id, port: 'ch2' });
  });
}

test('defaults to two inputs; trigger options follow the inputs', () => withApp(app, async (page) => {
  await addFromPalette(page, 'Oscilloscope');
  assert.deepEqual(await portNames(page), ['ch1', 'ch2']);
  assert.deepEqual(await triggerOptions(page), ['ch1', 'ch2']);
  const colours = await page.locator('.node:has-text("Oscilloscope") .port-label').evaluateAll((els) => els.map((e) => e.style.color));
  assert.equal(new Set(colours).size, 2, 'each channel has its own colour');
}));

test('changing the number of inputs adds and removes ports', () => withApp(app, async (page) => {
  await addFromPalette(page, 'Oscilloscope');
  await setInputs(page, 4);
  assert.deepEqual(await portNames(page), ['ch1', 'ch2', 'ch3', 'ch4']);
  assert.equal((await triggerOptions(page)).length, 4);
  assert.equal(await page.locator('#props .val').first().textContent(), '4');
  await setInputs(page, 8);
  assert.equal((await portNames(page)).length, 8);
}));

test('shrinking drops cables on removed ports and resets a trigger that no longer exists', () => withApp(app, async (page) => {
  await addFromPalette(page, 'Oscilloscope');
  await setInputs(page, 4);
  await page.evaluate(() => {
    const gen = [...dsplab.graph.nodes.values()][0];
    window.scope = [...dsplab.graph.nodes.values()].find((n) => n.type === 'oscilloscope');
    dsplab.addEdge({ node: gen.id, port: 'out' }, { node: scope.id, port: 'ch1' });
    dsplab.addEdge({ node: gen.id, port: 'out' }, { node: scope.id, port: 'ch3' });
  });
  await page.locator('#props select').selectOption('ch3');
  await setInputs(page, 2);
  const state = await page.evaluate(() => ({
    ports: dsplab.graph.edges.filter((e) => e.to.node === scope.id).map((e) => e.to.port),
    trigger: scope.params.trigger,
    shownOnNode: scope.el.querySelector('[data-key=trigger]').textContent,
  }));
  assert.deepEqual(state, { ports: ['ch1'], trigger: 'ch1', shownOnNode: 'ch1' });
  assert.equal(await page.locator('#wires path.edge').count(), 2, 'no orphan wires (gen->sink, gen->ch1)');
}));

test('a single input draws a 440 Hz sine: 4 cycles in 10 ms, peak 0.5', () => withApp(app, async (page) => {
  await addFromPalette(page, 'Oscilloscope');
  await page.evaluate(() => {
    window.scope = [...dsplab.graph.nodes.values()].find((n) => n.type === 'oscilloscope');
    dsplab.addEdge({ node: [...dsplab.graph.nodes.values()][0].id, port: 'out' }, { node: scope.id, port: 'ch1' });
  });
  const lit = () => page.evaluate(() => {
    const c = document.querySelector('canvas.scope');
    const d = c.getContext('2d').getImageData(0, 0, c.width, c.height).data;
    let n = 0;
    for (let i = 0; i < d.length; i += 4) if (d[i] > 200 && d[i + 1] > 120 && d[i + 2] < 120) n++;
    return n;
  });
  assert.equal(await lit(), 0, 'nothing drawn while stopped');
  await page.click('#run');
  await sleep(600);
  const s = await page.evaluate(() => {
    const a = Array.from(dsplab.engine.live.get(scope.id).sample(10, 0, 'ch1')[0]);
    return { n: a.length, min: Math.min(...a), max: Math.max(...a), cycles: a.filter((v, k) => k && a[k - 1] < 0 && v >= 0).length };
  });
  assert.equal(s.n, 441);
  assert.equal(s.cycles, 4);
  assert.ok(Math.abs(s.max - 0.5) < 0.01 && Math.abs(s.min + 0.5) < 0.01, `peak ${s.min}..${s.max}`);
  assert.ok(await lit() > 100, 'trace drawn while running');
}));

test('the trigger channel decides where every trace starts', () => withApp(app, async (page) => {
  await wireScope(page);
  await page.click('#run');
  await sleep(500);

  const onCh1 = await readFrames(page, { trigger: 'ch1' });
  assert.deepEqual(onCh1.slope.slice(0, 2), ['rising', 'falling'], 'ch2 is the inverted copy');
  assert.ok(onCh1.first[0] > -0.04 && onCh1.first[1] < 0.04, `starts at the crossing: ${onCh1.first}`);
  assert.deepEqual(onCh1.unconnected, [false, false, true], 'ch3 has no cable');

  const onCh2 = await readFrames(page, { trigger: 'ch2' });
  assert.deepEqual(onCh2.slope.slice(0, 2), ['falling', 'rising'], 'ch1 now aligned to the inverted channel');
}));

test('the trigger level is honoured', () => withApp(app, async (page) => {
  await wireScope(page);
  await page.click('#run');
  await sleep(500);
  const r = await readFrames(page, { trigger: 'ch1', level: 0.25 });
  assert.ok(r.first[0] > 0.2 && r.first[1] < 0.32, `first samples ${r.first}`);
}));

test('trace colours, trigger and time span are shown on the node', () => withApp(app, async (page) => {
  await addFromPalette(page, 'Oscilloscope');
  assert.deepEqual(await page.locator('.node:has-text("Oscilloscope") .kv').allTextContents(), ['Triggerch1', 'Time span10 ms']);
  assert.equal(await page.locator('#props .param').count(), 5);
}));
