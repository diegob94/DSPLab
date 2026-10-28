'use strict';
const { before, after, test } = require('node:test');
const { assert, launch, withApp, startAudio } = require('./helpers');

let app;
before(async () => { app = await launch(); });
after(async () => { await app.close(); });

const seed = {
  version: 1, pan: { x: 0, y: 0 },
  nodes: [
    { id: 1, type: 'audio_source', x: 60, y: 60, params: { gain: 1 } },
    { id: 2, type: 'audio_sink', x: 360, y: 60, params: { volume: 0.8 } },
  ],
  edges: [{ from: { node: 1, port: 'out' }, to: { node: 2, port: 'in' } }],
};

// counts getUserMedia calls so tests can tell whether the microphone was asked for
const countMicRequests = (page) => page.addInitScript(() => {
  window.micRequests = 0;
  const gum = navigator.mediaDevices.getUserMedia.bind(navigator.mediaDevices);
  navigator.mediaDevices.getUserMedia = (c) => { window.micRequests++; return gum(c); };
});

test('the microphone is only requested when the diagram has an Audio Source', () => withApp(app, async (page) => {
  await countMicRequests(page);
  await page.reload();
  await startAudio(page);
  assert.equal(await page.evaluate(() => window.micRequests), 0);
}));

test('Audio Source receives the input stream and Stop releases the microphone', () => withApp(app, async (page) => {
  await countMicRequests(page);
  await page.reload();
  await startAudio(page);
  assert.equal(await page.evaluate(() => window.micRequests), 1);
  assert.match(await page.textContent('#status'), /^Running/);
  // the fake device beeps periodically: wait until some signal reaches the block's output
  await page.waitForFunction(async () => {
    const { engine, graph } = dsplab;
    const node = [...graph.nodes.values()].find((n) => n.type === 'audio_source');
    if (!window.tap) {
      window.tap = engine.ctx.createAnalyser();
      engine.live.get(node.id).outputs.out.connect(window.tap);
    }
    const buf = new Float32Array(window.tap.fftSize);
    window.tap.getFloatTimeDomainData(buf);
    return buf.some((v) => Math.abs(v) > 0.001);
  }, null, { timeout: 10000, polling: 100 });
  await page.click('#run');
  await page.waitForFunction(() => !dsplab.engine.running);
}, { seed }));

test('Gain scales the input', () => withApp(app, async (page) => {
  // an OfflineAudioContext has no stream, so feed the block's gain node with a constant instead
  const level = await page.evaluate(async () => {
    const ctx = new OfflineAudioContext(1, 4410, 44100);
    const blk = dsplab.BLOCKS.audio_source.build(ctx, { gain: 0.5 });
    const dc = ctx.createConstantSource();
    dc.connect(blk.outputs.out);   // into the gain stage, as the stream would be
    dc.start();
    blk.outputs.out.connect(ctx.destination);
    return +(await ctx.startRendering()).getChannelData(0)[4000].toFixed(2);
  });
  assert.equal(level, 0.5);
}));
