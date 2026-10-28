// Edges: the SVG cables, drawing them, and connecting ports by dragging.
import { $, svgEl } from '../dom.js';
import { on } from '../core/events.js';
import { graph, select, addEdge } from '../core/graph.js';

const world = $('#world');
const wires = $('#wires');

export function portEl(nodeId, port, dir) {
  const node = graph.nodes.get(nodeId);
  return node && node.el.querySelector(`.port.${dir}[data-port="${port}"]`);
}

function portPos(dot) {
  const w = world.getBoundingClientRect();
  const r = dot.getBoundingClientRect();
  return { x: (r.left + r.width / 2 - w.left) / graph.zoom, y: (r.top + r.height / 2 - w.top) / graph.zoom };
}

function curve(a, b) {
  const dx = Math.max(50, Math.abs(b.x - a.x) * 0.5);
  return `M${a.x},${a.y} C${a.x + dx},${a.y} ${b.x - dx},${b.y} ${b.x},${b.y}`;
}

export function redrawEdges() {
  for (const e of graph.edges) {
    const a = portEl(e.from.node, e.from.port, 'out');
    const b = portEl(e.to.node, e.to.port, 'in');
    if (a && b) e.el.setAttribute('d', curve(portPos(a), portPos(b)));
  }
}

// pointerdown on an output port: drag a temporary cable and connect it to the input port it is released on
export function startConnect(e, dot) {
  if (e.button !== 0 || dot.dataset.dir !== 'out') return;
  e.stopPropagation();
  const from = { node: +dot.dataset.node, port: dot.dataset.port };
  const temp = svgEl('path', { class: 'temp' });
  wires.append(temp);
  const start = portPos(dot);
  let hot = null;

  const move = (ev) => {
    const w = world.getBoundingClientRect();
    temp.setAttribute('d', curve(start, { x: (ev.clientX - w.left) / graph.zoom, y: (ev.clientY - w.top) / graph.zoom }));
    const t = document.elementFromPoint(ev.clientX, ev.clientY);
    const target = t && t.closest && t.closest('.port.in');
    if (hot && hot !== target) hot.classList.remove('hot');
    hot = target;
    if (hot) hot.classList.add('hot');
  };
  const up = () => {
    window.removeEventListener('pointermove', move);
    window.removeEventListener('pointerup', up);
    window.removeEventListener('dsplab:pinch', cancel);
    temp.remove();
    if (hot) {
      hot.classList.remove('hot');
      const to = { node: +hot.dataset.node, port: hot.dataset.port };
      if (to.node !== from.node) addEdge(from, to);
    }
  };
  // a second finger turns the gesture into a pinch: drop the cable
  const cancel = () => { hot = null; up(); };
  window.addEventListener('pointermove', move);
  window.addEventListener('pointerup', up);
  window.addEventListener('dsplab:pinch', cancel);
}

export function initWires() {
  on('edge-added', (edge) => {
    edge.el = svgEl('path', { class: 'edge' });
    edge.el.addEventListener('pointerdown', (e) => { e.stopPropagation(); select({ kind: 'edge', id: edge.id }); });
    wires.append(edge.el);
    redrawEdges();
  });
  on('edge-removed', (edge) => edge.el.remove());
  on('selection', (sel) => {
    graph.edges.forEach((e) => e.el.classList.toggle('selected', !!sel && sel.kind === 'edge' && sel.id === e.id));
  });
  window.addEventListener('resize', redrawEdges);
}
