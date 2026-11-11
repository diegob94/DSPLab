// The flowgraph model: nodes, edges, selection and pan. It knows nothing about the DOM or
// audio; everything else reacts to the events it emits (see events.js). The UI attaches its
// own `el` / `view` to nodes and `el` to edges.
import { BLOCKS } from '../blocks/index.js';
import { emit } from './events.js';
import { optionsOf, portWire, portNames, wiresMatch, elementOf, validParam } from './params.js';

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
// null | { kind: 'edge', id } | { kind: 'node', id, ids }  (`ids`: every selected block, `id`: the last one added)
let selection = null;

export const getSelection = () => selection;
export const selectedNodeIds = () => (selection && selection.kind === 'node' ? selection.ids : []);

export function select(sel) {
  if (sel && sel.kind === 'node' && !sel.ids) sel = { kind: 'node', id: sel.id, ids: [sel.id] };
  selection = sel;
  emit('selection', sel);
}

export function selectNodes(ids) {
  ids = ids.filter((id) => graph.nodes.has(id));
  select(ids.length ? { kind: 'node', id: ids[ids.length - 1], ids } : null);
}

export const toggleNode = (id) => {
  const ids = selectedNodeIds();
  selectNodes(ids.includes(id) ? ids.filter((i) => i !== id) : [...ids, id]);
};

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
  if (selectedNodeIds().includes(id)) selectNodes(selectedNodeIds().filter((i) => i !== id));
  emit('changed');
}

// empties the diagram (a new one is about to be loaded); ids start over
export function clearGraph() {
  [...graph.nodes.keys()].forEach(removeNode);
  graph.nextId = 1;
  select(null);
}

// What an output port carries. A generic output ('T') carries the element type of the array on the cable
// that feeds the block's `in`, or anything ('*') while that is unknown.
export function outWire(node, port, seen = new Set()) {
  const wire = portWire(BLOCKS[node.type], port);
  if (wire !== 'T') return wire;
  const e = graph.edges.find((e) => e.to.node === node.id && e.to.port === 'in');
  const src = e && graph.nodes.get(e.from.node);
  if (!src || seen.has(node.id)) return '*';
  return elementOf(outWire(src, e.from.port, seen.add(node.id))) || '*';
}

const wiresFit = (e) => {
  const a = graph.nodes.get(e.from.node), b = graph.nodes.get(e.to.node);
  return wiresMatch(outWire(a, e.from.port), portWire(BLOCKS[b.type], e.to.port));
};

// a cable that feeds a generic block can change what that block's output carries: drop the cables that no longer fit
let pruning = false;
function pruneEdges() {
  if (pruning) return;
  pruning = true;
  try {
    let bad;
    while ((bad = graph.edges.find((e) => !wiresFit(e)))) removeEdge(bad);
  } finally { pruning = false; }
}

export function addEdge(from, to) {
  const a = graph.nodes.get(from.node), b = graph.nodes.get(to.node);
  // ports that carry different things (another clock, or another sample type) can't be cabled together
  if (!a || !b || !wiresMatch(outWire(a, from.port), portWire(BLOCKS[b.type], to.port))) return null;
  // an input accepts a single connection; replace any existing one
  graph.edges.filter((e) => e.to.node === to.node && e.to.port === to.port).forEach(removeEdge);
  const edge = { id: graph.nextId++, from, to };
  graph.edges.push(edge);
  emit('edge-added', edge);
  emit('changed');
  pruneEdges();
  return graph.edges.includes(edge) ? edge : null;
}

export function removeEdge(edge) {
  graph.edges = graph.edges.filter((e) => e !== edge);
  emit('edge-removed', edge);
  emit('changed');
  pruneEdges();
}

export function deleteSelection() {
  if (!selection) return;
  if (selection.kind === 'node') [...selection.ids].forEach(removeNode);
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

// a block's runtime data changed (e.g. a new recording): the engine refreshes the live block, nothing is saved
export function dataChanged(node) {
  emit('data', node);
}
