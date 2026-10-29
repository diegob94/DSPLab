// The flowgraph model: nodes, edges, selection and pan. It knows nothing about the DOM or
// audio; everything else reacts to the events it emits (see events.js). The UI attaches its
// own `el` / `view` to nodes and `el` to edges.
import { BLOCKS } from '../blocks/index.js';
import { emit } from './events.js';
import { optionsOf, portKind, portNames, validParam } from './params.js';

export const MIN_ZOOM = 0.3;
export const MAX_ZOOM = 2.5;
const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));

export const graph = {
  nodes: new Map(),   // id -> { id, type, x, y, params }
  edges: [],          // { id, from: {node, port}, to: {node, port} }
  nextId: 1,          // shared by nodes and edges
  pan: { x: 0, y: 0 },
  zoom: 1,            // world -> screen scale; screen = pan + world * zoom
};
let selection = null; // { kind: 'node' | 'edge', id }

export const getSelection = () => selection;

export function select(sel) {
  selection = sel;
  emit('selection', sel);
}

export function addNode(type, x, y, saved = {}) {
  const def = BLOCKS[type];
  const id = Number.isInteger(saved.id) ? saved.id : graph.nextId;
  graph.nextId = Math.max(graph.nextId, id + 1);
  const params = {};
  for (const p of def.params) params[p.key] = validParam(p, saved.params && saved.params[p.key], params);
  const node = { id, type, x: Math.round(x), y: Math.round(y), params };
  graph.nodes.set(id, node);
  emit('node-added', node);
  select({ kind: 'node', id });
  emit('changed');
  return node;
}

export function removeNode(id) {
  const node = graph.nodes.get(id);
  if (!node) return;
  graph.edges.filter((e) => e.from.node === id || e.to.node === id).forEach(removeEdge);
  graph.nodes.delete(id);
  emit('node-removed', node);
  if (selection && selection.kind === 'node' && selection.id === id) select(null);
  emit('changed');
}

// empties the diagram (a new one is about to be loaded); ids start over
export function clearGraph() {
  [...graph.nodes.keys()].forEach(removeNode);
  graph.nextId = 1;
  select(null);
}

export function addEdge(from, to) {
  const a = graph.nodes.get(from.node), b = graph.nodes.get(to.node);
  // audio and message ports are different kinds of cable
  if (!a || !b || portKind(BLOCKS[a.type], from.port) !== portKind(BLOCKS[b.type], to.port)) return null;
  // an input accepts a single connection; replace any existing one
  graph.edges.filter((e) => e.to.node === to.node && e.to.port === to.port).forEach(removeEdge);
  const edge = { id: graph.nextId++, from, to };
  graph.edges.push(edge);
  emit('edge-added', edge);
  emit('changed');
  return edge;
}

export function removeEdge(edge) {
  graph.edges = graph.edges.filter((e) => e !== edge);
  emit('edge-removed', edge);
  emit('changed');
}

export function deleteSelection() {
  if (!selection) return;
  if (selection.kind === 'node') removeNode(selection.id);
  else { const e = graph.edges.find((e) => e.id === selection.id); if (e) removeEdge(e); }
  select(null);
}

export function moveNode(node, x, y) {
  node.x = x;
  node.y = y;
  emit('moved', node);
}

export function setPan(x, y) {
  graph.pan.x = x;
  graph.pan.y = y;
  emit('pan');
}

export function setView(x, y, zoom) {
  graph.pan.x = x;
  graph.pan.y = y;
  graph.zoom = clamp(zoom, MIN_ZOOM, MAX_ZOOM);
  emit('pan');
}

export function setParam(node, key, value) {
  node.params[key] = value;
  emit('param', node, key);
}

// a select whose options depend on other params may have lost its value
export function syncParams(node) {
  for (const p of BLOCKS[node.type].params) {
    if (p.type === 'select' && !optionsOf(p, node.params).includes(node.params[p.key])) setParam(node, p.key, p.default);
  }
}

// after a param changed the number of input ports: drop the cables that lost their port
export function rebuildPorts(node) {
  const names = portNames(BLOCKS[node.type], 'inputs', node.params);
  graph.edges.filter((e) => e.to.node === node.id && !names.includes(e.to.port)).forEach(removeEdge);
  emit('ports', node);
  emit('changed');
}

export function hasPort(nodeId, port, dir) {
  const node = graph.nodes.get(nodeId);
  return !!node && portNames(BLOCKS[node.type], dir === 'in' ? 'inputs' : 'outputs', node.params).includes(port);
}
