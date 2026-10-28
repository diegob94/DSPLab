'use strict';

/* ------------------------------------------------------------------ *
 * Block definitions
 *
 * Each block describes its ports, its parameters (rendered as widgets
 * in the node) and how it maps onto Web Audio nodes:
 *   build(ctx, params) -> { inputs: {port: AudioNode}, outputs: {port: AudioNode}, update(params), dispose() }
 * build() may also return onConnect(port), called when an edge feeds that input port.
 * A block may also define ui(node) -> { el, draw(inst) }: a view shown inside the
 * node and redrawn every animation frame (inst is the built instance, or undefined
 * while the engine is stopped).
 * ------------------------------------------------------------------ */
const CATEGORIES = {
  'Source blocks': 'var(--source)',
  'Processing blocks': 'var(--proc)',
  'Sink blocks':   'var(--sink)',
};

const BLOCKS = {
  wave_generator: {
    title: 'Wave Generator',
    category: 'Source blocks',
    inputs: [],
    outputs: ['out'],
    params: [
      { key: 'waveform',  label: 'Waveform',  type: 'select', options: ['sine', 'square', 'sawtooth', 'triangle'], default: 'sine' },
      { key: 'frequency', label: 'Frequency', type: 'range', scale: 'log', min: 1, max: 20000, unit: 'Hz', default: 440 },
      { key: 'amplitude', label: 'Amplitude', type: 'range',  min: 0, max: 1, step: 0.01, default: 0.5 },
    ],
    build(ctx, p) {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.connect(gain);
      osc.start();
      const update = (p) => {
        const t = ctx.currentTime;
        osc.type = p.waveform;
        osc.frequency.setTargetAtTime(clamp(p.frequency, 1, 20000), t, 0.01);
        gain.gain.setTargetAtTime(p.amplitude, t, 0.01);
      };
      update(p);
      return {
        outputs: { out: gain },
        update,
        dispose() { osc.stop(); osc.disconnect(); gain.disconnect(); },
      };
    },
  },

  audio_sink: {
    title: 'Audio Sink',
    category: 'Sink blocks',
    inputs: ['in'],
    outputs: [],
    params: [
      { key: 'volume', label: 'Volume', type: 'range', min: 0, max: 1, step: 0.01, default: 0.8 },
    ],
    build(ctx, p) {
      const gain = ctx.createGain();
      gain.connect(ctx.destination);
      const update = (p) => gain.gain.setTargetAtTime(p.volume, ctx.currentTime, 0.01);
      update(p);
      return {
        inputs: { in: gain },
        update,
        dispose() { gain.disconnect(); },
      };
    },
  },

  oscilloscope: {
    title: 'Oscilloscope',
    category: 'Sink blocks',
    inputs: ['in', 'trigger'],
    outputs: [],
    params: [
      { key: 'timespan', label: 'Time span', type: 'range', scale: 'log', min: 1, max: 100, unit: 'ms', default: 10 },
      { key: 'scale',    label: 'Scale',     type: 'range', scale: 'log', min: 0.1, max: 10, unit: '×', default: 1 },
      { key: 'level',    label: 'Trig level', type: 'range', min: -1, max: 1, step: 0.01, default: 0 },
    ],
    build(ctx) {
      const analyser = ctx.createAnalyser();
      const trig = ctx.createAnalyser();
      analyser.fftSize = trig.fftSize = 16384;
      const buf = new Float32Array(analyser.fftSize);
      const trigBuf = new Float32Array(trig.fftSize);
      const check = new Float32Array(analyser.fftSize);
      let external = false;

      // Read both analysers as one aligned snapshot: if the audio thread advanced
      // while we were reading, `in` differs between the first and last read, so retry.
      const snapshot = () => {
        for (let attempt = 0; attempt < 4; attempt++) {
          analyser.getFloatTimeDomainData(buf);
          trig.getFloatTimeDomainData(trigBuf);
          analyser.getFloatTimeDomainData(check);
          if (buf.every((v, i) => v === check[i])) return;
        }
      };

      return {
        inputs: { in: analyser, trigger: trig },
        outputs: {},
        update() {},
        onConnect(port) { if (port === 'trigger') external = true; },
        get externalTrigger() { return external; },
        // latest `spanMs` of `in`, starting at a rising crossing of `level` so the trace holds still.
        // The trigger input is used when connected, otherwise `in` triggers itself.
        sample(spanMs, level = 0) {
          let ref = buf;
          if (external) { snapshot(); ref = trigBuf; } else analyser.getFloatTimeDomainData(buf);
          const n = Math.min(Math.round(spanMs * ctx.sampleRate / 1000), buf.length >> 1);
          // newest crossing that still leaves a full window after it; the oldest data
          // can hold start-up transients
          let start = 0;
          for (let i = ref.length - n - 1; i > 0; i--) {
            if (ref[i - 1] < level && ref[i] >= level) { start = i; break; }
          }
          return buf.subarray(start, start + n);
        },
        dispose() { analyser.disconnect(); trig.disconnect(); },
      };
    },
    ui(node) {
      const W = 220, H = 130, dpr = window.devicePixelRatio || 1;
      const el = h('canvas', { className: 'scope', width: W * dpr, height: H * dpr });
      const g = el.getContext('2d');
      const css = getComputedStyle(document.documentElement);
      return {
        el,
        draw(inst) {
          g.setTransform(dpr, 0, 0, dpr, 0, 0);
          g.fillStyle = '#0d0f12';
          g.fillRect(0, 0, W, H);
          g.lineWidth = 1;
          g.strokeStyle = '#242a33';
          g.beginPath();
          for (let i = 1; i < 10; i++) { g.moveTo(Math.round(i * W / 10) + .5, 0); g.lineTo(Math.round(i * W / 10) + .5, H); }
          for (let i = 1; i < 8; i++)  { g.moveTo(0, Math.round(i * H / 8) + .5);  g.lineTo(W, Math.round(i * H / 8) + .5); }
          g.stroke();
          g.strokeStyle = '#3a4350';
          g.beginPath(); g.moveTo(0, H / 2 + .5); g.lineTo(W, H / 2 + .5); g.stroke();

          g.fillStyle = '#6b7482';
          g.font = '10px system-ui, sans-serif';
          if (!inst) { g.fillText('Stopped', 6, 14); return; }
          g.fillText(`${node.params.timespan} ms${inst.externalTrigger ? ' · ext trigger' : ''}`, 6, 14);

          const data = inst.sample(node.params.timespan, node.params.level);
          if (data.length < 2) return;
          const amp = (H / 2) * 0.9 * node.params.scale;
          g.strokeStyle = css.getPropertyValue('--sink').trim() || '#e0894a';
          g.lineWidth = 1.5;
          g.beginPath();
          for (let i = 0; i < data.length; i++) {
            const x = i * (W - 1) / (data.length - 1);
            const y = Math.min(H, Math.max(0, H / 2 - data[i] * amp));
            if (i) g.lineTo(x, y); else g.moveTo(x, y);
          }
          g.stroke();
        },
      };
    },
  },

  math_operator: {
    title: 'Math Operator',
    category: 'Processing blocks',
    inputs: ['a', 'b'],
    outputs: ['out'],
    params: [
      { key: 'operation', label: 'Operation', type: 'select', options: ['add', 'subtract', 'multiply'], default: 'add' },
    ],
    // An unconnected input counts as 0. Every operation shares one topology and
    // is selected by gains, so changing it needs no graph rebuild:
    //   out = ka*a + kb*b + km*(a*b),  with a*b made by driving a gain's AudioParam with b
    build(ctx, p) {
      const a = ctx.createGain(), b = ctx.createGain();
      const ga = ctx.createGain(), gb = ctx.createGain();
      const prod = ctx.createGain(), gm = ctx.createGain();
      const out = ctx.createGain();
      prod.gain.value = 0;
      a.connect(ga).connect(out);
      b.connect(gb).connect(out);
      a.connect(prod);
      b.connect(prod.gain);
      prod.connect(gm).connect(out);
      const all = [a, b, ga, gb, prod, gm, out];
      const K = { add: [1, 1, 0], subtract: [1, -1, 0], multiply: [0, 0, 1] };
      const update = (p) => {
        const t = ctx.currentTime;
        const [ka, kb, km] = K[p.operation];
        ga.gain.setTargetAtTime(ka, t, 0.005);
        gb.gain.setTargetAtTime(kb, t, 0.005);
        gm.gain.setTargetAtTime(km, t, 0.005);
      };
      update(p);
      return {
        inputs: { a, b },
        outputs: { out },
        update,
        dispose() { all.forEach((n) => n.disconnect()); },
      };
    },
  },
};

const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, Number.isFinite(v) ? v : lo));

/* ------------------------------------------------------------------ *
 * Graph model
 * ------------------------------------------------------------------ */
const graph = {
  nodes: new Map(),   // id -> { id, type, x, y, params, el }
  edges: [],          // { id, from: {node, port}, to: {node, port}, el }
  nextId: 1,
};
let selection = null; // { kind: 'node' | 'edge', id }

/* ------------------------------------------------------------------ *
 * DOM refs
 * ------------------------------------------------------------------ */
const $ = (sel) => document.querySelector(sel);
const canvas = $('#canvas');
const world  = $('#world');
const wires  = $('#wires');
const runBtn = $('#run');
const delBtn = $('#delete');
const statusEl = $('#status');
const pan = { x: 0, y: 0 };

const SVG_NS = 'http://www.w3.org/2000/svg';
const svgEl = (name, attrs = {}) => {
  const e = document.createElementNS(SVG_NS, name);
  for (const [k, v] of Object.entries(attrs)) e.setAttribute(k, v);
  return e;
};
const h = (tag, props = {}, ...kids) => {
  const e = Object.assign(document.createElement(tag), props);
  e.append(...kids);
  return e;
};

/* ------------------------------------------------------------------ *
 * Palette
 * ------------------------------------------------------------------ */
function buildPalette() {
  const pal = $('#palette');
  for (const [cat, color] of Object.entries(CATEGORIES)) {
    pal.append(h('h2', { textContent: cat }));
    for (const [type, def] of Object.entries(BLOCKS)) {
      if (def.category !== cat) continue;
      const item = h('div', { className: 'palette-item', textContent: def.title, draggable: true, title: 'Drag onto the canvas, or double-click to add' });
      item.style.setProperty('--cat', color);
      item.addEventListener('dragstart', (e) => e.dataTransfer.setData('text/block', type));
      item.addEventListener('dblclick', () => {
        const r = canvas.getBoundingClientRect();
        addNode(type, r.width / 2 - pan.x - 90, r.height / 2 - pan.y - 40);
      });
      pal.append(item);
    }
  }
  pal.append(h('p', { className: 'hint', textContent:
    'Drag from an output port (right) to an input port (left) to connect blocks. Drag the background to pan. Delete removes the selection.' }));
}

canvas.addEventListener('dragover', (e) => e.preventDefault());
canvas.addEventListener('drop', (e) => {
  const type = e.dataTransfer.getData('text/block');
  if (!BLOCKS[type]) return;
  e.preventDefault();
  const r = canvas.getBoundingClientRect();
  addNode(type, e.clientX - r.left - pan.x - 90, e.clientY - r.top - pan.y - 14);
});

/* ------------------------------------------------------------------ *
 * Nodes
 * ------------------------------------------------------------------ */
function addNode(type, x, y) {
  const def = BLOCKS[type];
  const node = {
    id: graph.nextId++, type, x: Math.round(x), y: Math.round(y),
    params: Object.fromEntries(def.params.map((p) => [p.key, p.default])),
  };
  node.el = renderNode(node, def);
  graph.nodes.set(node.id, node);
  world.append(node.el);
  select({ kind: 'node', id: node.id });
  structureChanged();
  return node;
}

function renderNode(node, def) {
  const el = h('div', { className: 'node' });
  el.style.setProperty('--cat', CATEGORIES[def.category]);
  el.style.left = node.x + 'px';
  el.style.top = node.y + 'px';

  const title = h('div', { className: 'node-title', textContent: def.title });
  el.append(title);

  def.inputs.forEach((name) => el.append(portRow('in', name, node.id)));
  def.outputs.forEach((name) => el.append(portRow('out', name, node.id)));

  const body = h('div', { className: 'node-body' });
  if (def.ui) { node.view = def.ui(node); body.append(node.view.el); }
  for (const p of def.params) body.append(paramWidget(node, p));
  el.append(body);

  // select + drag by title
  el.addEventListener('pointerdown', () => select({ kind: 'node', id: node.id }));
  title.addEventListener('pointerdown', (e) => {
    if (e.button !== 0) return;
    e.stopPropagation();
    select({ kind: 'node', id: node.id });
    const sx = e.clientX, sy = e.clientY, ox = node.x, oy = node.y;
    const move = (ev) => {
      node.x = ox + ev.clientX - sx;
      node.y = oy + ev.clientY - sy;
      el.style.left = node.x + 'px';
      el.style.top = node.y + 'px';
      redrawEdges();
    };
    const up = () => { window.removeEventListener('pointermove', move); window.removeEventListener('pointerup', up); };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
  });
  return el;
}

function portRow(dir, name, nodeId) {
  const row = h('div', { className: `port-row ${dir}` });
  const dot = h('div', { className: `port ${dir}` });
  dot.dataset.node = nodeId;
  dot.dataset.port = name;
  dot.dataset.dir = dir;
  dot.addEventListener('pointerdown', (e) => startConnect(e, dot));
  row.append(dot, h('span', { className: 'port-label', textContent: name }));
  return row;
}

function paramWidget(node, p) {
  const wrap = h('div', { className: 'param' });
  const id = `p${node.id}-${p.key}`;
  wrap.append(h('label', { htmlFor: id, textContent: p.label }));

  // log sliders move over 0..1 and map to [min, max] exponentially
  const log = p.type === 'range' && p.scale === 'log';
  const toSlider = (v) => log ? Math.log(v / p.min) / Math.log(p.max / p.min) : v;
  const fromSlider = (t) => {
    if (!log) return t;
    return Number((p.min * Math.pow(p.max / p.min, t)).toPrecision(3));
  };
  const show = (v) => p.unit ? `${v} ${p.unit}` : v;

  let input;
  if (p.type === 'select') {
    input = h('select', { id });
    p.options.forEach((o) => input.append(h('option', { value: o, textContent: o })));
  } else if (log) {
    input = h('input', { id, type: 'range', min: 0, max: 1, step: 0.001 });
  } else {
    input = h('input', { id, type: p.type, min: p.min, max: p.max, step: p.step });
  }
  input.value = toSlider(node.params[p.key]);
  wrap.append(input);

  let readout;
  if (p.type === 'range') {
    readout = h('div', { className: 'val', textContent: show(node.params[p.key]) });
    wrap.append(readout);
  }

  input.addEventListener('pointerdown', (e) => e.stopPropagation());
  input.addEventListener('input', () => {
    node.params[p.key] = p.type === 'select' ? input.value : fromSlider(parseFloat(input.value));
    if (readout) readout.textContent = show(node.params[p.key]);
    engine.updateNode(node);
  });
  return wrap;
}

function removeNode(id) {
  const node = graph.nodes.get(id);
  if (!node) return;
  graph.edges.filter((e) => e.from.node === id || e.to.node === id).forEach(removeEdge);
  node.el.remove();
  graph.nodes.delete(id);
  structureChanged();
}

/* ------------------------------------------------------------------ *
 * Edges
 * ------------------------------------------------------------------ */
function portEl(nodeId, port, dir) {
  const node = graph.nodes.get(nodeId);
  return node && node.el.querySelector(`.port.${dir}[data-port="${port}"]`);
}

function portPos(dot) {
  const w = world.getBoundingClientRect();
  const r = dot.getBoundingClientRect();
  return { x: r.left + r.width / 2 - w.left, y: r.top + r.height / 2 - w.top };
}

function curve(a, b) {
  const dx = Math.max(50, Math.abs(b.x - a.x) * 0.5);
  return `M${a.x},${a.y} C${a.x + dx},${a.y} ${b.x - dx},${b.y} ${b.x},${b.y}`;
}

function addEdge(from, to) {
  // an input accepts a single connection; replace any existing one
  graph.edges.filter((e) => e.to.node === to.node && e.to.port === to.port).forEach(removeEdge);
  const edge = { id: graph.nextId++, from, to, el: svgEl('path', { class: 'edge' }) };
  edge.el.addEventListener('pointerdown', (e) => { e.stopPropagation(); select({ kind: 'edge', id: edge.id }); });
  wires.append(edge.el);
  graph.edges.push(edge);
  redrawEdges();
  structureChanged();
}

function removeEdge(edge) {
  edge.el.remove();
  graph.edges = graph.edges.filter((e) => e !== edge);
  structureChanged();
}

function redrawEdges() {
  for (const e of graph.edges) {
    const a = portEl(e.from.node, e.from.port, 'out');
    const b = portEl(e.to.node, e.to.port, 'in');
    if (a && b) e.el.setAttribute('d', curve(portPos(a), portPos(b)));
  }
}

function startConnect(e, dot) {
  if (e.button !== 0 || dot.dataset.dir !== 'out') return;
  e.stopPropagation();
  const from = { node: +dot.dataset.node, port: dot.dataset.port };
  const temp = svgEl('path', { class: 'temp' });
  wires.append(temp);
  const start = portPos(dot);
  let hot = null;

  const move = (ev) => {
    const w = world.getBoundingClientRect();
    temp.setAttribute('d', curve(start, { x: ev.clientX - w.left, y: ev.clientY - w.top }));
    const t = document.elementFromPoint(ev.clientX, ev.clientY);
    const target = t && t.closest && t.closest('.port.in');
    if (hot && hot !== target) hot.classList.remove('hot');
    hot = target;
    if (hot) hot.classList.add('hot');
  };
  const up = () => {
    window.removeEventListener('pointermove', move);
    window.removeEventListener('pointerup', up);
    temp.remove();
    if (hot) {
      hot.classList.remove('hot');
      const to = { node: +hot.dataset.node, port: hot.dataset.port };
      if (to.node !== from.node) addEdge(from, to);
    }
  };
  window.addEventListener('pointermove', move);
  window.addEventListener('pointerup', up);
}

/* ------------------------------------------------------------------ *
 * Selection, panning, keyboard
 * ------------------------------------------------------------------ */
function select(sel) {
  selection = sel;
  graph.nodes.forEach((n) => n.el.classList.toggle('selected', !!sel && sel.kind === 'node' && sel.id === n.id));
  graph.edges.forEach((e) => e.el.classList.toggle('selected', !!sel && sel.kind === 'edge' && sel.id === e.id));
  delBtn.disabled = !sel;
}

function deleteSelection() {
  if (!selection) return;
  if (selection.kind === 'node') removeNode(selection.id);
  else { const e = graph.edges.find((e) => e.id === selection.id); if (e) removeEdge(e); }
  select(null);
}
delBtn.addEventListener('click', deleteSelection);

window.addEventListener('keydown', (e) => {
  if ((e.key === 'Delete' || e.key === 'Backspace') && !/^(INPUT|SELECT|TEXTAREA)$/.test(e.target.tagName)) {
    e.preventDefault();
    deleteSelection();
  }
});

canvas.addEventListener('pointerdown', (e) => {
  if (e.button !== 0 || e.target.closest('.node')) return;
  select(null);
  canvas.classList.add('panning');
  const sx = e.clientX, sy = e.clientY, ox = pan.x, oy = pan.y;
  const move = (ev) => { setPan(ox + ev.clientX - sx, oy + ev.clientY - sy); };
  const up = () => {
    canvas.classList.remove('panning');
    window.removeEventListener('pointermove', move);
    window.removeEventListener('pointerup', up);
  };
  window.addEventListener('pointermove', move);
  window.addEventListener('pointerup', up);
});

function setPan(x, y) {
  pan.x = x; pan.y = y;
  world.style.transform = `translate(${x}px, ${y}px)`;
  canvas.style.backgroundPosition = `${x}px ${y}px`;
}

/* ------------------------------------------------------------------ *
 * Audio engine: maps the graph onto Web Audio nodes
 * ------------------------------------------------------------------ */
const engine = {
  ctx: null,
  live: new Map(), // node id -> built block instance

  get running() { return !!this.ctx; },

  async start() {
    this.ctx = new (window.AudioContext || window.webkitAudioContext)();
    this.rebuild();
    await this.ctx.resume();
  },

  async stop() {
    this.teardown();
    const ctx = this.ctx;
    this.ctx = null;
    await ctx.close();
  },

  teardown() {
    this.live.forEach((inst) => inst.dispose());
    this.live.clear();
  },

  rebuild() {
    this.teardown();
    for (const node of graph.nodes.values()) {
      this.live.set(node.id, BLOCKS[node.type].build(this.ctx, node.params));
    }
    for (const e of graph.edges) {
      const src = this.live.get(e.from.node);
      const dst = this.live.get(e.to.node);
      const from = src && src.outputs[e.from.port];
      const to = dst && dst.inputs[e.to.port];
      if (from && to) { from.connect(to); if (dst.onConnect) dst.onConnect(e.to.port); }
    }
  },

  updateNode(node) {
    const inst = this.live.get(node.id);
    if (inst) inst.update(node.params);
  },
};

function structureChanged() {
  if (engine.running) engine.rebuild();
}

function setStatus() {
  const on = engine.running;
  runBtn.textContent = on ? '■ Stop' : '▶ Run';
  runBtn.classList.toggle('running', on);
  statusEl.textContent = on ? `Running @ ${engine.ctx.sampleRate} Hz` : 'Stopped';
  statusEl.classList.toggle('on', on);
}

runBtn.addEventListener('click', async () => {
  runBtn.disabled = true;
  try {
    if (engine.running) await engine.stop(); else await engine.start();
  } catch (err) {
    console.error(err);
    statusEl.textContent = 'Audio error: ' + err.message;
    engine.ctx = null;
    runBtn.disabled = false;
    return;
  }
  runBtn.disabled = false;
  setStatus();
});

/* ------------------------------------------------------------------ *
 * Boot: a starter flowgraph
 * ------------------------------------------------------------------ */
buildPalette();
window.addEventListener('resize', redrawEdges);

(function frame() {
  for (const node of graph.nodes.values()) {
    if (node.view) node.view.draw(engine.live.get(node.id));
  }
  requestAnimationFrame(frame);
})();

const gen  = addNode('wave_generator', 80, 90);
const sink = addNode('audio_sink', 420, 120);
addEdge({ node: gen.id,  port: 'out' }, { node: sink.id, port: 'in' });
select(null);
