// A tiny event bus: the model emits, the engine / persistence / UI subscribe.
//
//   node-added(node)  node-removed(node)  edge-added(edge)  edge-removed(edge)
//   selection(sel)    param(node, key)    moved(node)        pan()
//   ports(node)       changed()           (the structure of the graph changed)
const handlers = new Map();

export const on = (name, fn) => {
  if (!handlers.has(name)) handlers.set(name, []);
  handlers.get(name).push(fn);
};

export const emit = (name, ...args) => {
  for (const fn of handlers.get(name) || []) fn(...args);
};
