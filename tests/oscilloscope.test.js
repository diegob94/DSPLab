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

test('X / div goes from 0.1 ms to 1000 ms, i.e. a 1 ms to 10 s screen', () => withApp(app, async (page) => {
  await addFromPalette(page, 'Oscilloscope');
  const slider = panelControl(page, 'X / div');
  const shown = () => page.locator('.node:has-text("Oscilloscope") [data-key=xdiv]').textContent();
  await setRange(slider, 1);
  assert.equal(await page.evaluate(() => [...dsplab.graph.nodes.values()].find((n) => n.type === 'oscilloscope').params.xdiv), 1000);
  assert.equal(await shown(), '1000 ms');
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
  assert.deepEqual(await page.locator('.node:has-text("Oscilloscope") .kv').allTextContents(), ['Triggerch1', 'Trig modeauto', 'X / div1 ms', 'Y / div0.25']);
  assert.equal(await page.locator('#props .param').count(), 8);
}));

test('the screen carries no text besides "Stopped", "Waiting for trigger" and the trigger level line (the settings are on the node)', () => withApp(app, async (page) => {
  await addFromPalette(page, 'Oscilloscope');
  const draw = (running) => page.evaluate((running) => {
    const node = [...dsplab.graph.nodes.values()].find((n) => n.type === 'oscilloscope');
    const texts = [];
    const ctx = node.view.el.getContext('2d');
    const orig = ctx.fillText.bind(ctx);
    ctx.fillText = (t, ...rest) => { texts.push(t); return orig(t, ...rest); };
    node.view.draw(running ? { sample: () => [] } : undefined);
    ctx.fillText = orig;
    return texts;
  }, running);
  assert.deepEqual(await draw(false), ['Stopped']);
  assert.deepEqual(await draw(true), []);
  await panelControl(page, 'Trig mode').selectOption('normal');
  assert.deepEqual(await draw(true), ['Waiting for trigger'], 'nothing to show until the trigger fires');
}));

test('the trigger level line is drawn while the level is being changed, and goes away again', () => withApp(app, async (page) => {
  await addFromPalette(page, 'Oscilloscope');
  const texts = () => page.evaluate(async () => {
    const node = [...dsplab.graph.nodes.values()].find((n) => n.type === 'oscilloscope');
    const ctx = node.view.el.getContext('2d');
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

test('the longest time span is 10 s (X / div up to 1000 ms)', () => withApp(app, async (page) => {
  await addFromPalette(page, 'Oscilloscope');
  const r = await page.evaluate(() => {
    const scope = [...dsplab.graph.nodes.values()].find((n) => n.type === 'oscilloscope');
    const max = dsplab.BLOCKS.oscilloscope.params.find((q) => q.key === 'xdiv').max;
    return { max, sr: dsplab.engine.ctx ? dsplab.engine.ctx.sampleRate : 0, id: scope.id };
  });
  assert.equal(r.max, 1000);
  await page.evaluate(() => {
    const scope = [...dsplab.graph.nodes.values()].find((q) => q.type === 'oscilloscope');
    dsplab.addEdge({ node: [...dsplab.graph.nodes.values()][0].id, port: 'out' }, { node: scope.id, port: 'ch1' });
  });
  await startAudio(page);
  const n = await page.evaluate(() => {
    const scope = [...dsplab.graph.nodes.values()].find((q) => q.type === 'oscilloscope');
    const d = dsplab.engine.live.get(scope.id).sample(1e6, 0, 'ch1');
    return { len: d.find(Boolean) ? d.find(Boolean).length : 0, sr: dsplab.engine.ctx.sampleRate };
  });
  assert.equal(n.len, n.sr * 10);
}));

test('trigger modes: auto falls back to the newest samples, normal shows nothing, single holds a sweep', () => withApp(app, async (page) => {
  await addFromPalette(page, 'Oscilloscope');
  await page.evaluate(() => {
    window.scope = [...dsplab.graph.nodes.values()].find((n) => n.type === 'oscilloscope');
    dsplab.addEdge({ node: [...dsplab.graph.nodes.values()][0].id, port: 'out' }, { node: scope.id, port: 'ch1' });
  });
  assert.equal(await panelControl(page, 'Trig mode').inputValue(), 'auto');
  assert.deepEqual(await panelControl(page, 'Trig mode').locator('option').allTextContents(), ['auto', 'normal', 'single']);
  await startAudio(page);
  await sleep(1400);                       // start-up transients must be older than the searched history
  // the screen redraws every frame with the node's own settings (10 ms span, ch1, its level, mode and X position 0), and the
  // state of normal / single lives in the block, so the probes below use the same arguments as the screen
  const probe = (level, mode) => page.evaluate(async ([level, mode]) => {
    const inst = dsplab.engine.live.get(scope.id);
    const get = () => inst.sample(10, level, 'ch1', mode, 0, 0)[0];
    const a = get();
    await new Promise((r) => setTimeout(r, 250));
    const b = get();
    const head = (d) => d && Array.from(d.subarray(0, 8));
    return { a: head(a), b: head(b) };
  }, [level, mode]);
  const level = panelControl(page, 'Trig level');

  // level 1 is never reached by the 0.5 amplitude tone
  await setRange(level, 1);
  const auto = await probe(1, 'auto');
  assert.ok(auto.a && auto.b, 'auto draws the newest samples');
  await panelControl(page, 'Trig mode').selectOption('normal');
  const normal = await probe(1, 'normal');
  assert.equal(normal.b, null, 'normal without a trigger shows nothing');

  await setRange(level, 0.25);
  await panelControl(page, 'Trig mode').selectOption('single');
  await probe(0.25, 'single');            // arms it (or the screen already did), then waits for a trigger
  const held = await probe(0.25, 'single');
  assert.ok(held.a, 'captured');
  assert.deepEqual(held.a, held.b, 'and then held');
  assert.ok(held.a[0] < held.a[7], 'on a rising slope');
}));

// ---- big screen ----

const openBig = async (page) => {
  await addFromPalette(page, 'Oscilloscope');
  await page.evaluate(() => {
    window.scope = [...dsplab.graph.nodes.values()].find((n) => n.type === 'oscilloscope');
    dsplab.addEdge({ node: [...dsplab.graph.nodes.values()][0].id, port: 'out' }, { node: scope.id, port: 'ch1' });
  });
  await page.click('.node:has-text("Oscilloscope") .title-button');
};

test('the big screen stays inside the viewport at any window size (the canvas never pushes it out)', () => withApp(app, async (page) => {
  await openBig(page);
  await page.keyboard.press('Escape');
  for (const [w, h] of [[1280, 560], [1280, 800], [820, 420], [600, 900]]) {
    await page.setViewportSize({ width: w, height: h });
    await page.evaluate(() => scope.el.querySelector('.title-button').click());
    await page.waitForTimeout(200);   // a few frames: a size feedback loop would grow the canvas
    const box = async (sel) => page.locator(sel).boundingBox();
    const win = await box('.screen-window'), view = await box('.screen-canvas'), side = await box('.screen-side');
    for (const [name, b] of [['window', win], ['canvas', view], ['settings', side]]) {
      assert.ok(b.x >= -1 && b.y >= -1 && b.x + b.width <= w + 1 && b.y + b.height <= h + 1, `${name} ${JSON.stringify(b)} outside ${w}x${h}`);
    }
    assert.ok(view.width > 100 && view.height > 80, `canvas ${view.width}x${view.height} at ${w}x${h}`);
    await page.keyboard.press('Escape');
  }
}));

test('the expand button opens a window with the waveform left of the settings; Esc and × close it', () => withApp(app, async (page) => {
  await openBig(page);
  const view = await page.locator('.screen-canvas').boundingBox();
  const side = await page.locator('.screen-side').boundingBox();
  assert.ok(view.x + view.width <= side.x + 1, 'waveform on the left, options on the right');
  assert.ok(view.width > 400 && view.height > 300, `big canvas ${view.width}x${view.height}`);
  await page.keyboard.press('Escape');
  assert.equal(await page.locator('.screen-window').count(), 0);
  await page.click('.node:has-text("Oscilloscope") .title-button');
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

test('holdoff makes a signal with two crossings per period lock onto one of them', () => withApp(app, async (page) => {
  await addFromPalette(page, 'Oscilloscope');
  // 100 Hz + 300 Hz crosses 0.5 upwards twice per 10 ms period (at about 0.2 ms and 3.1 ms)
  await page.evaluate(() => {
    const gen = [...dsplab.graph.nodes.values()][0];
    gen.params.frequency = 100;
    window.scope = [...dsplab.graph.nodes.values()].find((n) => n.type === 'oscilloscope');
    const gen3 = dsplab.addNode('wave_generator', 200, 420);
    gen3.params.frequency = 300;
    const sum = dsplab.addNode('math_operator', 400, 420);
    dsplab.addEdge({ node: gen.id, port: 'out' }, { node: sum.id, port: 'a' });
    dsplab.addEdge({ node: gen3.id, port: 'out' }, { node: sum.id, port: 'b' });
    dsplab.addEdge({ node: sum.id, port: 'out' }, { node: scope.id, port: 'ch1' });
  });
  await startAudio(page);
  await sleep(1400);
  // spread of the sample 2.5 ms after the trigger over many frames: the same crossing every time gives no spread
  const spread = (holdoff) => page.evaluate(async (holdoff) => {
    const inst = dsplab.engine.live.get(scope.id);
    const v = [];
    for (let i = 0; i < 20; i++) {
      v.push(inst.sample(5, 0.5, 'ch1', 'auto', holdoff)[0][110]);
      await new Promise((r) => setTimeout(r, 37));
    }
    return Math.max(...v) - Math.min(...v);
  }, holdoff);
  assert.ok(await spread(0) > 0.3, 'without holdoff the trigger hops between the two crossings');
  assert.ok(await spread(5) < 0.05, 'with a 5 ms holdoff it stays on one');
}));

test('the holdoff setting is in the panel, 0 to 3000 ms, default 0', () => withApp(app, async (page) => {
  await addFromPalette(page, 'Oscilloscope');
  assert.equal(await panelControl(page, 'Holdoff').inputValue(), '0');
  const p = await page.evaluate(() => dsplab.BLOCKS.oscilloscope.params.find((q) => q.key === 'holdoff'));
  assert.deepEqual([p.min, p.max, p.unit], [0, 3000, 'ms']);
}));

test('the big screen labels every grid line with its time (0 = the trigger, in the middle) and level; the small one stays clean', () => withApp(app, async (page) => {
  await openBig(page);
  // record what the screen draws by wrapping fillText on the next frames
  const texts = await page.evaluate(async () => {
    const out = new Set();
    const orig = CanvasRenderingContext2D.prototype.fillText;
    CanvasRenderingContext2D.prototype.fillText = function (t, ...r) { out.add([this.canvas.className, t].join('|')); return orig.call(this, t, ...r); };
    await new Promise((r) => setTimeout(r, 200));
    CanvasRenderingContext2D.prototype.fillText = orig;
    return [...out];
  });
  const big = texts.filter((t) => t.startsWith('screen-canvas|')).map((t) => t.split('|')[1]);
  const small = texts.filter((t) => t.startsWith('scope|')).map((t) => t.split('|')[1]);
  // X / div 1 ms with X position 0: the grid runs from -4 ms to 4 ms and t = 0 is in the middle
  for (const t of ['-4 ms', '-1 ms', '0', '1 ms', '4 ms', '0.75', '-0.25', '-0.75']) assert.ok(big.includes(t), `big screen shows ${t}: ${big}`);
  assert.deepEqual(small, ['Stopped']);
}));

test('the holdoff line is drawn while the holdoff is being changed, at that time after the trigger', () => withApp(app, async (page) => {
  await addFromPalette(page, 'Oscilloscope');
  // record the dashed lines and texts the node's screen draws
  const record = (ms) => page.evaluate(async (ms) => {
    const node = [...dsplab.graph.nodes.values()].find((n) => n.type === 'oscilloscope');
    const g = node.view.el.getContext('2d');
    const seen = { texts: [], xs: [] };
    const text = g.fillText, move = g.moveTo;
    g.fillText = function (t, ...r) { seen.texts.push(t); return text.call(this, t, ...r); };
    g.moveTo = function (x, y) { if (y === 0) seen.xs.push(x); return move.call(this, x, y); };
    await new Promise((r) => setTimeout(r, ms));
    g.fillText = text; g.moveTo = move;
    return seen;
  }, ms);
  assert.ok(!(await record(100)).texts.some((t) => t.startsWith('holdoff')), 'no line until it is changed');
  const quiet = record(300);
  await setRange(panelControl(page, 'Holdoff'), 5);   // xdiv 1 ms, 10 ms across with the trigger in the middle: 5 ms after it is the right edge
  const seen = await quiet;
  assert.ok(seen.texts.includes('holdoff 5 ms'), `label: ${seen.texts}`);
  assert.ok(seen.xs.includes(219.5), `vertical line at the right edge x=219.5: ${[...new Set(seen.xs)]}`);
  await sleep(1700);
  assert.ok(!(await record(100)).texts.some((t) => t.startsWith('holdoff')), 'the line disappears after a moment');
}));

test('X position is the time at the centre of the window relative to the trigger, before or after it', () => withApp(app, async (page) => {
  await addFromPalette(page, 'Oscilloscope');
  await page.evaluate(() => {
    window.scope = [...dsplab.graph.nodes.values()].find((n) => n.type === 'oscilloscope');
    dsplab.addEdge({ node: [...dsplab.graph.nodes.values()][0].id, port: 'out' }, { node: scope.id, port: 'ch1' });
  });
  const p = await page.evaluate(() => dsplab.BLOCKS.oscilloscope.params.find((q) => q.key === 'xpos'));
  assert.deepEqual([p.min, p.max, p.unit, p.default], [-10000, 10000, 'ms', 0]);
  await startAudio(page);
  await sleep(1400);
  // a 440 Hz sine of amplitude 0.5 triggers on its rising zero crossing; a quarter period (0.568 ms) later it
  // peaks. X position is the time at the centre of the 10 ms window, so the middle sample is at that time
  const mid = (xpos) => page.evaluate((xpos) => { const d = dsplab.engine.live.get(scope.id).sample(10, 0, 'ch1', 'auto', 0, xpos)[0]; return d[Math.floor(d.length / 2)]; }, xpos);
  assert.ok(Math.abs(await mid(0)) < 0.05, 't = 0, the trigger, is in the middle');
  assert.ok(Math.abs(await mid(0.568) - 0.5) < 0.03, 'a quarter period later: the peak');
  assert.ok(Math.abs(await mid(-0.568) + 0.5) < 0.03, 'a quarter period before: the trough');
}));

test('dragging the big waveform pans in time (X position) and the wheel zooms X / div around the pointer', () => withApp(app, async (page) => {
  await openBig(page);
  const box = await page.locator('.screen-canvas').boundingBox();
  const params = () => page.evaluate(() => ({ xpos: scope.params.xpos, xdiv: scope.params.xdiv }));
  assert.deepEqual(await params(), { xpos: 0, xdiv: 1 });
  // a drag across a tenth of the screen moves the view by one division (1 ms): the waveform follows the pointer
  await page.mouse.move(box.x + 200, box.y + 200);
  await page.mouse.down();
  await page.mouse.move(box.x + 200 + box.width / 10, box.y + 200, { steps: 5 });
  await page.mouse.up();
  const dragged = await params();
  assert.ok(Math.abs(dragged.xpos + 1) < 0.05, `dragging right shows earlier time: ${dragged.xpos}`);
  assert.equal(await page.locator('.screen-side .param:has(label:text-is("X position")) input[type=number]').inputValue(), String(dragged.xpos), 'the settings follow');
  // zoom in with the wheel at the screen's centre: X / div shrinks, the time under the pointer stays put
  const centre = { x: box.x + box.width / 2, y: box.y + 200 };
  const before = dragged.xpos;   // the centre of the screen is at t = X position
  await page.mouse.move(centre.x, centre.y);
  await page.mouse.wheel(0, -300);
  const zoomed = await params();
  assert.ok(zoomed.xdiv < 1, `zoomed in: ${zoomed.xdiv}`);
  assert.ok(Math.abs(zoomed.xpos - before) < 0.05, 'the time at the centre is unchanged');
  await page.mouse.wheel(0, 600);
  assert.ok((await params()).xdiv > zoomed.xdiv, 'and out again');
  // the ↺ button of the X position setting puts it back to 0, in the model and in the settings, and leaves X / div alone
  const xdiv = (await params()).xdiv;
  assert.notEqual((await params()).xpos, 0);
  await page.click('.screen-side .param:has(label:text-is("X position")) button.reset');
  assert.deepEqual(await params(), { xpos: 0, xdiv });
  assert.equal(await page.locator('.screen-side .param:has(label:text-is("X position")) input[type=number]').inputValue(), '0');
  assert.equal(await page.evaluate(() => dsplab.graph.nodes.has(scope.id)), true);
}));

test('the grid is centred on t = 0 and moves with X position', () => withApp(app, async (page) => {
  await addFromPalette(page, 'Oscilloscope');
  // record the x of the vertical lines the node's screen strokes (moveTo at the top edge) after each setting
  const lines = (xpos) => page.evaluate(async (xpos) => {
    const node = [...dsplab.graph.nodes.values()].find((n) => n.type === 'oscilloscope');
    node.params.xpos = xpos;
    const g = node.view.el.getContext('2d');
    const xs = [];
    const move = g.moveTo;
    g.moveTo = function (x, y) { if (y === 0) xs.push(x); return move.call(this, x, y); };
    await new Promise((r) => setTimeout(r, 100));
    g.moveTo = move;
    return [...new Set(xs)].sort((a, b) => a - b);
  }, xpos);
  const centred = await lines(0);
  assert.ok(centred.includes(110.5), `a line (t = 0) at the centre: ${centred}`);
  assert.equal(centred.length, 9, 'X / div 1 ms over 10 ms: lines at -4..4 ms');
  const moved = await lines(0.5);   // the view's centre is half a division later, so the lines move left
  assert.ok(!moved.includes(110.5) && moved.includes(110.5 - 11), `the grid followed: ${moved}`);
}));

test('the X position setting in the panel has a reset button too', () => withApp(app, async (page) => {
  await addFromPalette(page, 'Oscilloscope');
  await setRange(panelControl(page, 'X position'), 3);
  assert.notEqual(await panelControl(page, 'X position').inputValue(), '0');
  await page.click('#props .param:has(label:text-is("X position")) button.reset');
  assert.equal(await page.evaluate(() => [...dsplab.graph.nodes.values()].find((n) => n.type === 'oscilloscope').params.xpos), 0);
  assert.equal(await panelControl(page, 'X position').inputValue(), '0');
  assert.equal(await page.locator('#props .param:has(label:text-is("X / div")) button.reset').count(), 0, 'only the params that ask for it');
}));
