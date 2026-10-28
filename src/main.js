import { BLOCKS, CATEGORIES } from './blocks/index.js';
import { clamp } from './util.js';
import { $, h, svgEl } from './dom.js';

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
const canvas = $('#canvas');
const world  = $('#world');
const wires  = $('#wires');
const runBtn = $('#run');
const delBtn = $('#delete');
const statusEl = $('#status');
const propsBody = $('#props-body');
const pan = { x: 0, y: 0 };

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
    'Drag from an output port (right) to an input port (left) to connect blocks. Select a block to edit it in the properties panel. Drag the background to pan. Delete removes the selection.' }));
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
function addNode(type, x, y, saved = {}) {
  const def = BLOCKS[type];
  const id = Number.isInteger(saved.id) ? saved.id : graph.nextId;
  graph.nextId = Math.max(graph.nextId, id + 1);
  const params = {};
  for (const p of def.params) params[p.key] = validParam(p, saved.params && saved.params[p.key], params);
  const node = { id, type, x: Math.round(x), y: Math.round(y), params };
  node.el = renderNode(node, def);
  graph.nodes.set(node.id, node);
  world.append(node.el);
  select({ kind: 'node', id: node.id });
  structureChanged();
  return node;
}

const optionsOf = (p, params) => (typeof p.options === 'function' ? p.options(params) : p.options);
const portNames = (def, dir, params) => (typeof def[dir] === 'function' ? def[dir](params) : def[dir]);

const fmt = (p, v) => p.unit ? `${v} ${p.unit}` : String(v);

function refreshSummary(node) {
  for (const p of BLOCKS[node.type].params) {
    const out = node.el.querySelector(`[data-key="${p.key}"]`);
    if (out) out.textContent = fmt(p, node.params[p.key]);
  }
}

// a saved value is only trusted if it still fits the parameter definition
function validParam(p, v, params) {
  if (p.type === 'select') return optionsOf(p, params).includes(v) ? v : p.default;
  if (!Number.isFinite(v)) return p.default;
  const c = clamp(v, p.min, p.max);
  return p.step === 1 ? Math.round(c) : c;
}

function renderNode(node, def) {
  const el = h('div', { className: 'node' });
  el.style.setProperty('--cat', CATEGORIES[def.category]);
  el.style.left = node.x + 'px';
  el.style.top = node.y + 'px';

  const title = h('div', { className: 'node-title', textContent: def.title });
  el.append(title);

  for (const dir of ['in', 'out']) {
    for (const name of portNames(def, dir === 'in' ? 'inputs' : 'outputs', node.params)) {
      el.append(portRow(dir, name, node.id, def.portColor && def.portColor(name)));
    }
  }

  const body = h('div', { className: 'node-body' });
  if (def.ui) { node.view = def.ui(node); body.append(node.view.el); }
  for (const p of def.params.filter((p) => p.show)) {
    const val = h('b');
    val.dataset.key = p.key;
    body.append(h('div', { className: 'kv' }, h('span', { textContent: p.label }), val));
  }
  el.append(body);
  node.el = el;
  refreshSummary(node);

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
    const up = () => { window.removeEventListener('pointermove', move); window.removeEventListener('pointerup', up); save(); };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
  });
  return el;
}

function portRow(dir, name, nodeId, color) {
  const row = h('div', { className: `port-row ${dir}` });
  const dot = h('div', { className: `port ${dir}` });
  if (color) row.style.setProperty('--cat', color);
  dot.dataset.node = nodeId;
  dot.dataset.port = name;
  dot.dataset.dir = dir;
  dot.addEventListener('pointerdown', (e) => startConnect(e, dot));
  const label = h('span', { className: 'port-label', textContent: name });
  if (color) label.style.color = color;
  row.append(dot, label);
  return row;
}

// re-render the input ports after a parameter changed their number
function rebuildPorts(node) {
  const names = portNames(BLOCKS[node.type], 'inputs', node.params);
  graph.edges.filter((e) => e.to.node === node.id && !names.includes(e.to.port)).forEach(removeEdge);
  node.el.querySelectorAll('.port-row.in').forEach((row) => row.remove());
  const def = BLOCKS[node.type];
  node.el.querySelector('.node-title').after(...names.map((name) => portRow('in', name, node.id, def.portColor && def.portColor(name))));
  redrawEdges();
  structureChanged();
}

// a select whose options depend on other params may have lost its value
function syncParams(node) {
  for (const p of BLOCKS[node.type].params) {
    if (p.type === 'select' && !optionsOf(p, node.params).includes(node.params[p.key])) node.params[p.key] = p.default;
  }
  refreshSummary(node);
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
  const show = (v) => fmt(p, v);

  let input;
  if (p.type === 'select') {
    input = h('select', { id });
    optionsOf(p, node.params).forEach((o) => input.append(h('option', { value: o, textContent: o })));
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
    refreshSummary(node);
    engine.updateNode(node);
    save();
  });
  if (p.ports) {
    // applied on release, so dragging a slider across a smaller value doesn't drop cables on the way
    input.addEventListener('change', () => {
      syncParams(node);
      rebuildPorts(node);
      renderProps();
      const again = document.getElementById(id);
      if (again) again.focus();
    });
  }
  return wrap;
}

function removeNode(id) {
  const node = graph.nodes.get(id);
  if (!node) return;
  graph.edges.filter((e) => e.from.node === id || e.to.node === id).forEach(removeEdge);
  node.el.remove();
  graph.nodes.delete(id);
  if (selection && selection.kind === 'node' && selection.id === id) select(null);
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
  renderProps();
}

function renderProps() {
  propsBody.replaceChildren();
  const hint = (text) => propsBody.append(h('p', { className: 'hint', textContent: text }));
  if (!selection) return hint('Select a block to see and edit its properties.');

  if (selection.kind === 'edge') {
    const e = graph.edges.find((e) => e.id === selection.id);
    if (!e) return hint('');
    const name = (end) => `${BLOCKS[graph.nodes.get(end.node).type].title} · ${end.port}`;
    propsBody.append(h('div', { className: 'props-head', textContent: 'Connection' }));
    propsBody.append(h('div', { className: 'kv' }, h('span', { textContent: 'From' }), h('b', { textContent: name(e.from) })));
    propsBody.append(h('div', { className: 'kv' }, h('span', { textContent: 'To' }), h('b', { textContent: name(e.to) })));
    return;
  }

  const node = graph.nodes.get(selection.id);
  const def = BLOCKS[node.type];
  const head = h('div', { className: 'props-head', textContent: def.title });
  head.style.setProperty('--cat', CATEGORIES[def.category]);
  propsBody.append(head, h('div', { className: 'props-cat', textContent: def.category }));
  if (!def.params.length) return hint('This block has no properties.');
  for (const p of def.params) propsBody.append(paramWidget(node, p));
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
    save();
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
  save();
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
 * Persistence: the diagram is autosaved to localStorage and restored on load
 * ------------------------------------------------------------------ */
const STORAGE_KEY = 'dsplab.diagram';
let restoring = false;
let saveTimer = null;

function serialize() {
  return {
    version: 1,
    pan: { x: pan.x, y: pan.y },
    nodes: [...graph.nodes.values()].map(({ id, type, x, y, params }) => ({ id, type, x, y, params })),
    edges: graph.edges.map(({ from, to }) => ({ from, to })),
  };
}

function saveNow() {
  clearTimeout(saveTimer);
  if (restoring) return;
  try { localStorage.setItem(STORAGE_KEY, JSON.stringify(serialize())); } catch (err) { /* storage unavailable or full */ }
}

function save() {
  if (restoring) return;
  clearTimeout(saveTimer);
  saveTimer = setTimeout(saveNow, 200);
}
window.addEventListener('pagehide', saveNow);

// returns false when there is nothing usable saved, so the caller can load the starter graph
function restore() {
  let data;
  try { data = JSON.parse(localStorage.getItem(STORAGE_KEY)); } catch (err) { return false; }
  if (!data || data.version !== 1 || !Array.isArray(data.nodes) || !Array.isArray(data.edges)) return false;

  restoring = true;
  try {
    for (const n of data.nodes) {
      if (n && BLOCKS[n.type] && Number.isFinite(n.x) && Number.isFinite(n.y)) addNode(n.type, n.x, n.y, n);
    }
    for (const e of data.edges) {
      if (e && e.from && e.to && portEl(e.from.node, e.from.port, 'out') && portEl(e.to.node, e.to.port, 'in')) {
        addEdge({ node: e.from.node, port: e.from.port }, { node: e.to.node, port: e.to.port });
      }
    }
    if (data.pan && Number.isFinite(data.pan.x) && Number.isFinite(data.pan.y)) setPan(data.pan.x, data.pan.y);
    redrawEdges();
  } finally {
    restoring = false;
  }
  select(null);
  return true;
}

/* ------------------------------------------------------------------ *
 * Boot: restore the saved diagram, or load a starter flowgraph
 * ------------------------------------------------------------------ */
buildPalette();
window.addEventListener('resize', redrawEdges);

(function frame() {
  for (const node of graph.nodes.values()) {
    if (node.view) node.view.draw(engine.live.get(node.id));
  }
  requestAnimationFrame(frame);
})();

if (!restore()) {
  const gen  = addNode('wave_generator', 80, 90);
  const sink = addNode('audio_sink', 420, 120);
  addEdge({ node: gen.id,  port: 'out' }, { node: sink.id, port: 'in' });
  select(null);
}

// handle for the tests and for poking at the app from the browser console
window.dsplab = {
  BLOCKS, graph, engine, select,
  addNode, removeNode, addEdge, removeEdge, rebuildPorts, syncParams,
  redrawEdges, refreshSummary, serialize,
};
