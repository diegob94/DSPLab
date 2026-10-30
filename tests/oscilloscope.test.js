'use strict';
const { before, after, test } = require('node:test');
const { assert, launch, withApp, sleep, selectNode, addFromPalette, panelControl, setRange, startAudio } = require('./helpers');

let app;
before(async () => { app = await launch(); });
after(async () => { await app.close(); });

const PORTS = '.node:has-text("Oscilloscope") .port.in';
const portNames = (page) => page.locator(PORTS).evaluateAll((els) => els.map((e) => e.dataset.port));
const triggerOptions = (page) => panelControl(page, 'Trigger').locator('option').allTextContents();
const setInputs = (page, n) => panelControl(page, 'Inputs').selectOption(String(n));

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

test('the number of inputs is picked from a dropdown, 1 to 8', () => withApp(app, async (page) => {
  await addFromPalette(page, 'Oscilloscope');
  const control = panelControl(page, 'Inputs');
  assert.equal(await control.evaluate((el) => el.tagName), 'SELECT');
  assert.deepEqual(await control.locator('option').allTextContents(), ['1', '2', '3', '4', '5', '6', '7', '8']);
  assert.equal(await control.inputValue(), '2');
  await control.selectOption('5');
  const channels = await page.evaluate(() => [...dsplab.graph.nodes.values()].find((n) => n.type === 'oscilloscope').params.channels);
  assert.strictEqual(channels, 5, 'stored as a number, not as the text "5"');
}));

test('changing the number of inputs adds and removes ports', () => withApp(app, async (page) => {
  await addFromPalette(page, 'Oscilloscope');
  await setInputs(page, 4);
  assert.deepEqual(await portNames(page), ['ch1', 'ch2', 'ch3', 'ch4']);
  assert.equal((await triggerOptions(page)).length, 4);
  assert.equal(await panelControl(page, 'Inputs').inputValue(), '4');
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
  await panelControl(page, 'Trigger').selectOption('ch3');
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
  await startAudio(page);
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

test('X / div goes from 0.1 ms to 100 ms, i.e. a 1 ms to 1 s screen', () => withApp(app, async (page) => {
  await addFromPalette(page, 'Oscilloscope');
  const slider = panelControl(page, 'X / div');
  const shown = () => page.locator('.node:has-text("Oscilloscope") [data-key=xdiv]').textContent();
  await setRange(slider, 1);
  assert.equal(await page.evaluate(() => [...dsplab.graph.nodes.values()].find((n) => n.type === 'oscilloscope').params.xdiv), 100);
  assert.equal(await shown(), '100 ms');
  await setRange(slider, 0);
  assert.equal(await shown(), '0.1 ms');
}));

test('a 1 s window holds a full second of signal (440 cycles of a 440 Hz sine)', () => withApp(app, async (page) => {
  await addFromPalette(page, 'Oscilloscope');
  await page.evaluate(() => {
    window.scope = [...dsplab.graph.nodes.values()].find((n) => n.type === 'oscilloscope');
    dsplab.addEdge({ node: [...dsplab.graph.nodes.values()][0].id, port: 'out' }, { node: scope.id, port: 'ch1' });
  });
  await startAudio(page);
  await sleep(2300);                       // let the 2 s history fill up
  const r = await page.evaluate(() => {
    const sr = dsplab.engine.ctx.sampleRate;
    const w = Array.from(dsplab.engine.live.get(scope.id).sample(1000, 0, 'ch1')[0]);
    let zeros = 0, run = 0, longestZeroRun = 0;
    for (const v of w) { if (v === 0) { zeros++; run++; longestZeroRun = Math.max(longestZeroRun, run); } else run = 0; }
    return { sr, n: w.length, cycles: w.filter((v, k) => k && w[k - 1] < 0 && v >= 0).length, min: Math.min(...w), max: Math.max(...w), longestZeroRun };
  });
  assert.equal(r.n, r.sr, 'one second of samples');
  assert.ok(r.cycles >= 438 && r.cycles <= 441, `cycles ${r.cycles}`);
  assert.ok(Math.abs(r.max - 0.5) < 0.01 && Math.abs(r.min + 0.5) < 0.01, `peak ${r.min}..${r.max}`);
  assert.ok(r.longestZeroRun < 50, 'no gaps: the whole window is real signal');

  const lit = await page.evaluate(() => {
    const c = document.querySelector('canvas.scope');
    const d = c.getContext('2d').getImageData(0, 0, c.width, c.height).data;
    let n = 0;
    for (let i = 0; i < d.length; i += 4) if (d[i] > 200 && d[i + 1] > 120 && d[i + 2] < 120) n++;
    return n;
  });
  assert.equal(await page.locator('.node:has-text("Oscilloscope") canvas.scope').count(), 1);
  assert.ok(lit > 100, 'the long window is drawn');
}));

test('the trigger channel decides where every trace starts', () => withApp(app, async (page) => {
  await wireScope(page);
  await startAudio(page);
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
  await startAudio(page);
  await sleep(500);
  const r = await readFrames(page, { trigger: 'ch1', level: 0.25 });
  assert.ok(r.first[0] > 0.2 && r.first[1] < 0.32, `first samples ${r.first}`);
}));

test('trace colours, trigger, X / div and Y / div are shown on the node', () => withApp(app, async (page) => {
  await addFromPalette(page, 'Oscilloscope');
  assert.deepEqual(await page.locator('.node:has-text("Oscilloscope") .kv').allTextContents(), ['Triggerch1', 'X / div1 ms', 'Y / div0.25']);
  assert.equal(await page.locator('#props .param').count(), 5);
}));

test('the screen carries no text besides "Stopped" and the trigger level line (the settings are on the node)', () => withApp(app, async (page) => {
  await addFromPalette(page, 'Oscilloscope');
  const draw = (running) => page.evaluate((running) => {
    const node = [...dsplab.graph.nodes.values()].find((n) => n.type === 'oscilloscope');
    const texts = [];
    const ctx = node.view.el.querySelector('canvas').getContext('2d');
    const orig = ctx.fillText.bind(ctx);
    ctx.fillText = (t, ...rest) => { texts.push(t); return orig(t, ...rest); };
    node.view.draw(running ? { sample: () => [] } : undefined);
    ctx.fillText = orig;
    return texts;
  }, running);
  assert.deepEqual(await draw(false), ['Stopped']);
  assert.deepEqual(await draw(true), []);
}));

test('the trigger level line is drawn while the level is being changed, and goes away again', () => withApp(app, async (page) => {
  await addFromPalette(page, 'Oscilloscope');
  const texts = () => page.evaluate(async () => {
    const node = [...dsplab.graph.nodes.values()].find((n) => n.type === 'oscilloscope');
    const ctx = node.view.el.querySelector('canvas').getContext('2d');
    const seen = [];
    const orig = ctx.fillText.bind(ctx);
    ctx.fillText = (t, ...rest) => { seen.push(t); return orig(t, ...rest); };
    await new Promise((r) => setTimeout(r, 100));   // a few animation frames
    ctx.fillText = orig;
    return seen;
  });
  assert.ok(!(await texts()).some((t) => t.startsWith('level')), 'no level line until it is touched');
  await setRange(panelControl(page, 'Trig level'), 0.3);
  assert.ok((await texts()).includes('level 0.3'), 'level line while adjusting');
  await sleep(1700);
  assert.ok(!(await texts()).some((t) => t.startsWith('level')), 'the line disappears after a moment');
}));

// ---- big screen ----

const openBig = async (page) => {
  await addFromPalette(page, 'Oscilloscope');
  await page.evaluate(() => {
    window.scope = [...dsplab.graph.nodes.values()].find((n) => n.type === 'oscilloscope');
    dsplab.addEdge({ node: [...dsplab.graph.nodes.values()][0].id, port: 'out' }, { node: scope.id, port: 'ch1' });
  });
  await page.click('.node:has-text("Oscilloscope") .scope-expand');
};

test('the expand button opens a window with the waveform left of the settings; Esc and × close it', () => withApp(app, async (page) => {
  await openBig(page);
  const view = await page.locator('.screen-canvas').boundingBox();
  const side = await page.locator('.screen-side').boundingBox();
  assert.ok(view.x + view.width <= side.x + 1, 'waveform on the left, options on the right');
  assert.ok(view.width > 400 && view.height > 300, `big canvas ${view.width}x${view.height}`);
  await page.keyboard.press('Escape');
  assert.equal(await page.locator('.screen-window').count(), 0);
  await page.click('.node:has-text("Oscilloscope") .scope-expand');
  await page.click('.screen-close');
  assert.equal(await page.locator('.screen-window').count(), 0);
}));

test('the big window edits the block and draws the live trace', () => withApp(app, async (page) => {
  await startAudio(page);   // first: the window covers the toolbar
  await openBig(page);
  await sleep(600);
  const lit = () => page.evaluate(() => {
    const c = document.querySelector('canvas.screen-canvas');
    const d = c.getContext('2d').getImageData(0, 0, c.width, c.height).data;
    let n = 0;
    for (let i = 0; i < d.length; i += 4) if (d[i] > 200 && d[i + 1] > 120 && d[i + 2] < 120) n++;
    return n;
  });
  assert.ok(await lit() > 500, 'trace drawn in the big canvas');
  await page.locator('.screen-side .param:has(label:text-is("X / div")) input[type=number]').fill('5');
  await page.locator('.screen-side .param:has(label:text-is("X / div")) input[type=number]').press('Enter');
  assert.equal(await page.evaluate(() => scope.params.xdiv), 5);
  // changing the inputs re-renders the trigger choices inside the window
  await setRange(page.locator('.screen-side .param:has(label:text-is("Inputs")) select'), '4');
  assert.deepEqual(await page.locator('.screen-side .param:has(label:text-is("Trigger")) option').allTextContents(), ['ch1', 'ch2', 'ch3', 'ch4']);
}));

test('Delete while the window is open does not remove the block behind it', () => withApp(app, async (page) => {
  await openBig(page);
  await page.keyboard.press('Delete');
  assert.equal(await page.evaluate(() => dsplab.graph.nodes.has(scope.id)), true);
}));
