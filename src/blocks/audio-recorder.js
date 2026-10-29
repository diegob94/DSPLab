// Records a sample from the microphone (button in the properties panel) and plays it in a loop,
// with a configurable pause between plays. The sample lives only in memory (it is not saved with
// the diagram), keyed by the model node so it survives the engine rebuilding the audio graph.
import { h } from '../dom.js';

const recordings = new WeakMap();   // node -> { data: Float32Array, rate }
const recording = new WeakMap();    // node -> { startedAt } while the microphone is being recorded

const WIDTH = 220, HEIGHT = 44;

// microphone -> MediaRecorder for `seconds` -> decoded mono samples
async function capture(seconds) {
  // raw signal, as in the Audio Source
  const stream = await navigator.mediaDevices.getUserMedia({
    audio: { echoCancellation: false, noiseSuppression: false, autoGainControl: false },
  });
  try {
    const rec = new MediaRecorder(stream);
    const chunks = [];
    rec.ondataavailable = (e) => chunks.push(e.data);
    const stopped = new Promise((resolve, reject) => { rec.onstop = resolve; rec.onerror = (e) => reject(e.error); });
    rec.start();
    await new Promise((r) => setTimeout(r, seconds * 1000));
    rec.stop();
    await stopped;
    const rate = 44100;   // decodeAudioData resamples to the context's rate; the engine resamples on playback
    const decoded = await new OfflineAudioContext(1, 1, rate).decodeAudioData(await new Blob(chunks).arrayBuffer());
    return { data: decoded.getChannelData(0).slice(), rate };
  } finally {
    stream.getTracks().forEach((t) => t.stop());   // releases the microphone indicator
  }
}

export const audioRecorder = {
  title: 'Audio Recorder',
  category: 'Source blocks',
  inputs: [],
  outputs: ['out'],
  params: [
    { key: 'length', label: 'Record length', show: true, type: 'range', min: 0.5, max: 10, step: 0.5, unit: 's', default: 2 },
    { key: 'gap',    label: 'Pause', show: true, type: 'range', min: 0, max: 10, step: 0.1, unit: 's', default: 1 },
    { key: 'gain',   label: 'Gain', type: 'range', min: 0, max: 2, step: 0.01, default: 1 },
  ],
  // buttons of the properties panel; run() returns a promise, busy() says whether it is still going
  actions: [{
    label: (node) => recording.has(node) ? 'Recording…' : recordings.has(node) ? 'Record again' : 'Record',
    busy: (node) => recording.has(node),
    async run(node) {
      if (recording.has(node)) return;
      recording.set(node, { startedAt: performance.now() });
      try {
        recordings.set(node, await capture(node.params.length));
      } finally {
        recording.delete(node);
      }
    },
  }],
  build(ctx, p, node) {
    const out = ctx.createGain();
    let src = null, playing = null, playedGap;

    // the sample followed by `gap` seconds of silence, looped
    const restart = (p) => {
      if (src) { src.stop(); src.disconnect(); src = null; }
      playing = recordings.get(node);
      playedGap = p.gap;
      if (!playing) return;
      const { data, rate } = playing;
      const buffer = ctx.createBuffer(1, data.length + Math.round(p.gap * rate), rate);
      buffer.copyToChannel(data, 0);
      src = ctx.createBufferSource();
      src.buffer = buffer;
      src.loop = true;
      src.connect(out);
      src.start();
    };
    const update = (p) => {
      out.gain.setTargetAtTime(p.gain, ctx.currentTime, 0.01);
      // a new recording or a new gap restarts the loop; the gain alone doesn't
      if (recordings.get(node) !== playing || p.gap !== playedGap) restart(p);
    };
    out.gain.value = p.gain;
    restart(p);
    return {
      outputs: { out },
      update,
      // length in seconds of the looping buffer (sample + pause); 0 without a sample
      loopSeconds: () => src ? src.buffer.duration : 0,
      dispose() { if (src) { src.stop(); src.disconnect(); } out.disconnect(); },
    };
  },
  ui(node) {
    const dpr = window.devicePixelRatio || 1;
    const text = h('div', { className: 'rec-status' });
    const wave = h('canvas', { className: 'rec-wave', width: WIDTH * dpr, height: HEIGHT * dpr });
    const g = wave.getContext('2d');
    const el = h('div', { className: 'rec' }, text, wave);
    let drawn = null, status = '';
    return {
      el,
      draw() {
        const rec = recordings.get(node), now = recording.get(node);
        const s = now ? `● Recording… ${Math.min(node.params.length, (performance.now() - now.startedAt) / 1000).toFixed(1)} / ${node.params.length} s`
          : rec ? `Sample ${(rec.data.length / rec.rate).toFixed(1)} s`
          : 'No sample: select the block and press Record';
        if (s !== status) { status = s; text.textContent = s; text.classList.toggle('recording', !!now); }
        if (rec === drawn) return;
        drawn = rec;
        g.setTransform(dpr, 0, 0, dpr, 0, 0);
        g.fillStyle = '#0d0f12';
        g.fillRect(0, 0, WIDTH, HEIGHT);
        if (!rec) return;
        // the lowest and highest sample of each pixel column
        g.fillStyle = '#f2a65a';
        const { data } = rec;
        for (let x = 0; x < WIDTH; x++) {
          let lo = 0, hi = 0;
          const end = Math.floor((x + 1) * data.length / WIDTH);
          for (let i = Math.floor(x * data.length / WIDTH); i < end; i++) {
            if (data[i] < lo) lo = data[i];
            if (data[i] > hi) hi = data[i];
          }
          const y0 = HEIGHT / 2 - Math.min(1, hi) * HEIGHT / 2, y1 = HEIGHT / 2 - Math.max(-1, lo) * HEIGHT / 2;
          g.fillRect(x, y0, 1, Math.max(1, y1 - y0));
        }
      },
    };
  },
};
