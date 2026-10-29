'use strict';
const { before, after, test } = require('node:test');
const { assert, launch, withApp, sleep, selectNode, panelControl, startAudio } = require('./helpers');

let app;
before(async () => { app = await launch(); });
after(async () => { await app.close(); });

const seed = {
  version: 1, pan: { x: 0, y: 0 },
  nodes: [
    { id: 1, type: 'wave_generator', x: 40, y: 60, params: { frequency: 1000, amplitude: 0.5 } },
    { id: 2, type: 'fft_plot', x: 340, y: 60, params: {} },
  ],
  edges: [{ from: { node: 1, port: 'out' }, to: { node: 2, port: 'in' } }],
};

// the loudest bin of the plot's current spectrum
const peak = (page) => page.evaluate(async () => {
  const node = [...dsplab.graph.nodes.values()].find((n) => n.type === 'fft_plot');
  await new Promise((r) => setTimeout(r, 400));   // let the analyser fill its window
  const { bins, binHz } = dsplab.engine.live.get(node.id).spectrum();
  let k = 0;
  bins.forEach((v, i) => { if (v > bins[k]) k = i; });
  return { hz: k * binHz, binHz, bins: bins.length };
});

const fftInstance = (page) => page.evaluate(() => dsplab.engine.live.get([...dsplab.graph.nodes.values()].find((n) => n.type === 'fft_plot').id));

test('FFT Plot shows the spectral peak of its input at the right frequency', () => withApp(app, async (page) => {
  await startAudio(page);
  const { hz, binHz } = await peak(page);
  assert.ok(Math.abs(hz - 1000) <= binHz, `peak at ${hz} Hz`);
}, { seed }));

test('Window size changes the number of bins and the resolution without rebuilding', () => withApp(app, async (page) => {
  await startAudio(page);
  await selectNode(page, 'FFT Plot');
  await page.evaluate(() => {
    window.first = dsplab.engine.live.get([...dsplab.graph.nodes.values()].find((n) => n.type === 'fft_plot').id);
  });
  const small = await peak(page);
  assert.equal(small.bins, 1024);
  await panelControl(page, 'Window size').selectOption('8192');
  const big = await peak(page);
  assert.equal(big.bins, 4096);
  assert.ok(big.binHz < small.binHz);
  assert.ok(Math.abs(big.hz - 1000) <= big.binHz);
  assert.ok(await page.evaluate(() => window.first === dsplab.engine.live.get([...dsplab.graph.nodes.values()].find((n) => n.type === 'fft_plot').id)));
}, { seed }));

test('FFT Plot draws a trace in the logarithmic axis', () => withApp(app, async (page) => {
  await sleep(150);   // a frame while stopped
  await startAudio(page);
  await selectNode(page, 'FFT Plot');
  await panelControl(page, 'Freq. axis').selectOption('log');
  await sleep(400);
  // something cyan (the trace) was drawn
  const drawn = await page.locator('.node:has-text("FFT Plot") canvas').evaluate((c) => {
    const d = c.getContext('2d').getImageData(0, 0, c.width, c.height).data;
    let n = 0;
    for (let i = 0; i < d.length; i += 4) if (d[i] < 120 && d[i + 1] > 150 && d[i + 2] > 150) n++;
    return n;
  });
  assert.ok(drawn > 50, `${drawn} trace pixels`);
}, { seed }));
