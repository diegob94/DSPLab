// Nodes: rendering a block as a draggable card with ports, a read-only summary of its key
// parameters and an optional live view (e.g. the oscilloscope screen).
import { BLOCKS, CATEGORIES } from '../blocks/index.js';
import { $, h } from '../dom.js';
import { on } from '../core/events.js';
import { portKind, portNames } from '../core/params.js';
import { graph, select, toggleNode, selectedNodeIds, moveNode } from '../core/graph.js';
import { engine } from '../core/engine.js';
import { redrawEdges, startConnect } from './wires.js';

const world = $('#world');

export const fmt = (p, v) => p.unit ? `${v} ${p.unit}` : String(v);

export function refreshSummary(node) {
  for (const p of BLOCKS[node.type].params) {
    const out = node.el.querySelector(`[data-key="${p.key}"]`);
    if (out) out.textContent = fmt(p, node.params[p.key]);
  }
}

function portRow(dir, name, nodeId, color, kind) {
  const row = h('div', { className: `port-row ${dir}` });
  const dot = h('div', { className: `port ${dir}${kind === 'message' ? ' msg' : ''}` });
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

// inputs on the left and outputs on the right, side by side so an output can sit level with the first input
function portsEl(node, def) {
  const ports = h('div', { className: 'ports' });
  for (const dir of ['in', 'out']) {
    const names = portNames(def, dir === 'in' ? 'inputs' : 'outputs', node.params);
    if (!names.length) continue;
    ports.append(h('div', { className: `ports-${dir}` }, ...names.map((name) => portRow(dir, name, node.id, def.portColor && def.portColor(name), portKind(def, name)))));
  }
  return ports;
}

function renderNode(node, def) {
  const el = h('div', { className: 'node' });
  el.style.setProperty('--cat', CATEGORIES[def.category]);
  el.style.left = node.x + 'px';
  el.style.top = node.y + 'px';

  const title = h('div', { className: 'node-title', textContent: def.title });
  el.append(title);

  el.append(portsEl(node, def));

  const body = h('div', { className: 'node-body' });
  if (def.ui) {
    node.view = def.ui(node);
    body.append(node.view.el);
    if (node.view.titleButton) title.append(node.view.titleButton);
  }
  for (const p of def.params.filter((p) => p.show)) {
    const val = h('b');
    val.dataset.key = p.key;
    body.append(h('div', { className: 'kv' }, h('span', { textContent: p.label }), val));
  }
  el.append(body);
  node.el = el;
  refreshSummary(node);

  // select + drag from anywhere on the card (ports stop their own pointerdown). Shift / Ctrl / Cmd
  // toggles the block in the selection; dragging a selected block moves the whole selection.
  el.addEventListener('pointerdown', (e) => {
    if (e.button !== 0) return;
    e.stopPropagation();
    if (e.shiftKey || e.ctrlKey || e.metaKey) { toggleNode(node.id); return; }
    const inSelection = selectedNodeIds().includes(node.id);
    if (!inSelection) select({ kind: 'node', id: node.id });
    const group = selectedNodeIds().map((id) => graph.nodes.get(id));
    const start = group.map((n) => ({ n, x: n.x, y: n.y }));
    const sx = e.clientX, sy = e.clientY;
    let dragged = false;
    const move = (ev) => {
      dragged = true;
      for (const o of start) moveNode(o.n, o.x + (ev.clientX - sx) / graph.zoom, o.y + (ev.clientY - sy) / graph.zoom);
    };
    const up = () => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
      window.removeEventListener('dsplab:pinch', up);
      // a plain click on a block of a multiple selection narrows it down to that block
      if (!dragged && inSelection && group.length > 1) select({ kind: 'node', id: node.id });
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
    window.addEventListener('dsplab:pinch', up);   // a second finger starts a pinch instead
  });
  return el;
}

export function initNodes() {
  on('node-added', (node) => world.append(renderNode(node, BLOCKS[node.type])));
  on('node-removed', (node) => node.el.remove());
  on('param', (node) => refreshSummary(node));
  on('moved', (node) => {
    node.el.style.left = node.x + 'px';
    node.el.style.top = node.y + 'px';
    redrawEdges();
  });
  // the number of input ports changed: re-render them
  on('ports', (node) => {
    node.el.querySelector('.ports').replaceWith(portsEl(node, BLOCKS[node.type]));
    redrawEdges();
  });
  on('selection', (sel) => {
    graph.nodes.forEach((n) => n.el.classList.toggle('selected', !!sel && sel.kind === 'node' && sel.ids.includes(n.id)));
  });
}

// redraw every node's live view each animation frame
export function startRenderLoop() {
  (function frame() {
    for (const node of graph.nodes.values()) {
      if (node.view) node.view.draw(engine.live.get(node.id));
    }
    requestAnimationFrame(frame);
  })();
}
