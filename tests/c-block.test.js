'use strict';
// The C Block compiles C in the browser (clang on WebAssembly, fetched into vendor/clang/ by
// scripts/fetch-compiler.sh, which `npm test` runs first). Loading the compiler and the first compile take
// several seconds per page, so the tests that compile do as much as they can in one page.
const { before, after, test } = require('node:test');
const { assert, launch, withApp, sleep, selectNode, addFromPalette, setRange, panelControl, startAudio } = require('./helpers');

let app;
before(async () => { app = await launch(); });
after(async () => { await app.close(); });

const COMPILE = '#props button.action';
const CODE = '#props textarea.code';
const STATUS = '.node:has-text("C Block") .c-status';
const TIMEOUT = 90000;   // loading the compiler on a slow machine

const status = (page) => page.textContent(STATUS);
// the node's status line is repainted on the next animation frame, so wait for it instead of reading it once
const expectStatus = (page, re) => page.waitForFunction((src) => new RegExp(src).test(document.querySelector('.c-status').textContent), re.source, { timeout: 15000 });
// "Compiled · 1.2 KB" exactly: the same text with "edited, press Compile" after it is the status of the old build
const compiled = (page) => page.waitForFunction(() => /^Compiled · [\d.]+ KB$/.test(document.querySelector('.c-status').textContent), null, { timeout: TIMEOUT });

// a one-pole low-pass: P1 = 0.466 puts the cutoff at 20 * 1000^0.466 = 500 Hz
const LOWPASS_P1 = '0.466';
// the steady-state peak of a sine of `hz` rendered offline through the C Block (compiled already)
const gainAt = (page, hz) => page.evaluate(async (hz) => {
  const node = [...dsplab.graph.nodes.values()].find((n) => n.type === 'c_block');
  const ctx = new OfflineAudioContext(1, 44100, 44100);
  await dsplab.BLOCKS.c_block.setup(ctx, true, [node]);
  const osc = new OscillatorNode(ctx, { frequency: hz });
  const blk = dsplab.BLOCKS.c_block.build(ctx, node.params, node);
  osc.connect(blk.inputs.in);
  blk.outputs.out.connect(ctx.destination);
  osc.start();
  const d = (await ctx.startRendering()).getChannelData(0);
  let peak = 0;
  for (let i = 22050; i < d.length; i++) peak = Math.max(peak, Math.abs(d[i]));
  return peak;
}, hz);

test('C Block is a Processing block with input in and output out, and starts with a working example', () => withApp(app, async (page) => {
  const def = await page.evaluate(() => {
    const b = dsplab.BLOCKS.c_block;
    return { title: b.title, category: b.category, inputs: b.inputs, outputs: b.outputs, code: b.params.find((p) => p.key === 'code').default };
  });
  assert.deepEqual([def.title, def.category, def.inputs, def.outputs], ['C Block', 'Processing blocks', ['in'], ['out']]);
  assert.match(def.code, /void dsp_process\(const float \*in, float \*out, int n, float fs, const float \*p\)/);
  await addFromPalette(page, 'C Block');
  assert.equal(await page.locator('.node:has-text("C Block")').count(), 1);
  await expectStatus(page, /^Not compiled/);
}));

test('the code is edited in a text area of the panel and saved with the diagram', () => withApp(app, async (page) => {
  await addFromPalette(page, 'C Block');
  await selectNode(page, 'C Block');
  await page.locator(CODE).fill('/* mine */\nvoid dsp_process(const float *in, float *out, int n, float fs, const float *p) {}\n');
  await sleep(500);
  const saved = await page.evaluate(() => JSON.parse(localStorage.getItem('dsplab.diagram')).nodes.find((n) => n.type === 'c_block').params);
  assert.match(saved.code, /^\/\* mine \*\//);
  await page.reload();
  await selectNode(page, 'C Block');
  assert.match(await page.locator(CODE).inputValue(), /^\/\* mine \*\//);
  // only the source is saved, never the compiled module
  assert.ok(!JSON.stringify(await page.evaluate(() => dsplab.serialize())).includes('Module'));
}));

test('Tab indents inside the editor and Escape lets the next Tab leave it', () => withApp(app, async (page) => {
  await addFromPalette(page, 'C Block');
  await selectNode(page, 'C Block');
  await page.locator(CODE).fill('x');
  await page.locator(CODE).press('Home');
  await page.keyboard.press('Tab');
  assert.equal(await page.locator(CODE).inputValue(), '  x');
  assert.equal(await page.evaluate(() => document.activeElement.tagName), 'TEXTAREA');
  assert.equal(await page.evaluate(() => [...dsplab.graph.nodes.values()].find((n) => n.type === 'c_block').params.code), '  x', 'the indentation reaches the model');
  await page.keyboard.press('Escape');
  await page.keyboard.press('Tab');
  assert.notEqual(await page.evaluate(() => document.activeElement.tagName), 'TEXTAREA');
}));

test('a saved diagram cannot smuggle in a non-string or an oversized code', async () => {
  const diagram = (code) => ({ version: 1, pan: { x: 0, y: 0 }, nodes: [{ id: 1, type: 'c_block', x: 40, y: 40, params: { code } }], edges: [] });
  await withApp(app, async (page) => {
    const code = await page.evaluate(() => dsplab.graph.nodes.get(1).params.code);
    assert.equal(code, await page.evaluate(() => dsplab.BLOCKS.c_block.params[0].default), 'a number falls back to the example');
  }, { seed: diagram(42) });
  await withApp(app, async (page) => {
    assert.equal(await page.evaluate(() => dsplab.graph.nodes.get(1).params.code.length), 12000);
  }, { seed: diagram('x'.repeat(50000)) });
});

test('Compile builds the code, the block filters like the C says, and mistakes are reported on the user\'s own line', () => withApp(app, async (page) => {
  await addFromPalette(page, 'C Block');
  await selectNode(page, 'C Block');
  assert.equal(await page.textContent(COMPILE), 'Compile');
  await page.click(COMPILE);
  await expectStatus(page, /^(Compiling…|Loading the compiler)/);
  await compiled(page);
  assert.match(await status(page), /^Compiled · \d+\.\d KB$/);

  // the example is a one-pole low-pass; with P1 = 0.466 the cutoff is 500 Hz, so 5 kHz is attenuated to ~0.1017
  await setRange(panelControl(page, 'P1'), LOWPASS_P1);
  const high = await gainAt(page, 5000), low = await gainAt(page, 100);
  assert.ok(Math.abs(high - 0.1017) < 0.006, `5 kHz through a 500 Hz one-pole: expected ~0.1017, got ${high}`);
  assert.ok(low > 0.97, `100 Hz passes, got ${low}`);

  // an edit is flagged until it is compiled
  const good = await page.locator(CODE).inputValue();
  await page.locator(CODE).fill(good + '\n/* edited */\n');
  await expectStatus(page, /edited, press Compile$/);

  // a mistake on line 3: the message names line 3 (the glue the compiler adds is not counted) and the
  // previous version stays in use
  await page.locator(CODE).fill('#include <math.h>\nvoid dsp_process(const float *in, float *out, int n, float fs, const float *p) {\n  out[0] = undefined_name;\n}\n');
  await page.click(COMPILE);
  await page.waitForFunction(() => /^Compile error/.test(document.querySelector('.c-status').textContent), null, { timeout: TIMEOUT });
  await expectStatus(page, /^Compile error · still running the previous version$/);
  const errors = await page.textContent('.node:has-text("C Block") .c-errors');
  assert.match(errors, /block\.c:3:\d+: error: .*undefined_name/);
  assert.ok(await page.locator('.node:has-text("C Block") .c-errors').isVisible());
  assert.equal(await page.textContent(COMPILE), 'Compile');

  // fixing it clears the report
  await page.locator(CODE).fill(good);
  await page.click(COMPILE);
  await compiled(page);
  assert.ok(await page.locator('.node:has-text("C Block") .c-errors').isHidden());
}));

test('Run compiles the code, and Compile swaps new code into the running block', () => withApp(app, async (page) => {
  // a constant on the output whatever comes in
  const constant = (v) => `void dsp_process(const float *in, float *out, int n, float fs, const float *p) {\n  for (int i = 0; i < n; i++) out[i] = ${v};\n}\n`;
  await page.evaluate((code) => {
    dsplab.addNode('wave_generator', 40, 60);
    dsplab.addNode('c_block', 330, 60, { params: { code } });
    dsplab.addNode('audio_sink', 640, 60);
  }, constant('0.25f'));
  const ids = await page.evaluate(() => Object.fromEntries([...dsplab.graph.nodes.values()].map((n) => [n.type, n.id])));
  await page.evaluate((ids) => {
    dsplab.addEdge({ node: ids.wave_generator, port: 'out' }, { node: ids.c_block, port: 'in' });
    dsplab.addEdge({ node: ids.c_block, port: 'out' }, { node: ids.audio_sink, port: 'in' });
  }, ids);
  await expectStatus(page, /^Not compiled/);

  await startAudio(page);   // compiles first, then builds
  await expectStatus(page, /^Compiled/);

  // read what the live block puts out through an analyser
  const level = () => page.evaluate(async (id) => {
    const inst = dsplab.engine.live.get(id), ctx = dsplab.engine.ctx;
    const an = new AnalyserNode(ctx, { fftSize: 2048 });
    inst.outputs.out.connect(an);
    await new Promise((r) => setTimeout(r, 300));
    const d = new Float32Array(an.fftSize);
    an.getFloatTimeDomainData(d);
    inst.outputs.out.disconnect(an);
    return d.reduce((a, b) => a + b, 0) / d.length;
  }, ids.c_block);
  assert.ok(Math.abs(await level() - 0.25) < 0.01, 'the running block outputs the 0.25 of the code');

  await selectNode(page, 'C Block');
  await page.locator(CODE).fill(constant('-0.5f'));
  assert.ok(Math.abs(await level() - 0.25) < 0.01, 'an edit changes nothing until it is compiled');
  await page.click(COMPILE);
  await compiled(page);
  await sleep(100);
  assert.ok(Math.abs(await level() + 0.5) < 0.01, 'after Compile the running block outputs -0.5');

  // a NaN from the C code never reaches the output
  await page.locator(CODE).fill(constant('(0.0f / 0.0f)'));
  await page.click(COMPILE);
  await compiled(page);
  await sleep(100);
  assert.equal(await level(), 0, 'NaN is replaced by silence');

  // a trap stops the block and says so on the node. (__builtin_trap, not a wild pointer: in the cloud container
  // even plain WebAssembly crashes Chromium on an out-of-bounds access instead of throwing, so that can't be tested)
  await page.evaluate((id) => {
    window.__errors = 0;
    dsplab.engine.live.get(id).inputs.in.port.addEventListener('message', (e) => { if (e.data.error) window.__errors++; });
  }, ids.c_block);
  await page.locator(CODE).fill('void dsp_process(const float *in, float *out, int n, float fs, const float *p) {\n  __builtin_trap();\n}\n');
  await page.click(COMPILE);
  await compiled(page);
  await page.waitForFunction(() => /The C code stopped/.test(document.querySelector('.c-errors').textContent), null, { timeout: 10000 });
  assert.equal(await level(), 0, 'a stopped block is silent');
  assert.ok(await page.evaluate(() => window.__errors) <= 1, 'the failure is reported once, the code is not called again every 3 ms');
  assert.match(await page.textContent('.node:has-text("C Block") .c-status'), /^Compiled/);
}));
