// Audio engine: maps the graph onto Web Audio nodes and keeps them in sync with it.
import { BLOCKS } from '../blocks/index.js';
import { graph, outWire } from './graph.js';
import { on } from './events.js';
import { portClock } from './params.js';

export const engine = {
  ctx: null,
  live: new Map(), // node id -> built block instance
  last: new Map(), // edge id -> the last sample that went through an async cable (to show its size)

  get running() { return !!this.ctx; },

  async start() {
    const ctx = new (window.AudioContext || window.webkitAudioContext)();
    try {
      // blocks may need to load modules (e.g. an AudioWorklet) before they can be built
      // (knowing which types are in the diagram lets a block skip intrusive work, e.g. the microphone prompt)
      const used = new Set([...graph.nodes.values()].map((n) => n.type));
      await Promise.all(Object.entries(BLOCKS).map(([type, block]) => block.setup && block.setup(ctx, used.has(type))));
    } catch (err) {
      await ctx.close();
      throw err;
    }
    this.ctx = ctx;
    this.rebuild();
    await ctx.resume();
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
    this.last.clear();
  },

  rebuild() {
    this.teardown();
    for (const node of graph.nodes.values()) {
      // what each input port is fed with, for the blocks whose behaviour depends on it
      const wires = {};
      graph.edges.filter((e) => e.to.node === node.id).forEach((e) => { wires[e.to.port] = outWire(graph.nodes.get(e.from.node), e.from.port); });
      this.live.set(node.id, BLOCKS[node.type].build(this.ctx, node.params, node, wires));
    }
    for (const e of graph.edges) {
      const src = this.live.get(e.from.node);
      const dst = this.live.get(e.to.node);
      const from = src && src.outputs[e.from.port];
      const to = dst && dst.inputs[e.to.port];
      // an async cable passes through a tap that remembers the last sample
      if (from && to) { from.connect(portClock(BLOCKS[graph.nodes.get(e.from.node).type], e.from.port) === 'async' ? { receive: (s) => { this.last.set(e.id, s); to.receive(s); } } : to); if (dst.onConnect) dst.onConnect(e.to.port); }
    }
  },

  updateNode(node) {
    const inst = this.live.get(node.id);
    if (inst) inst.update(node.params);
  },
};

on('changed', () => { if (engine.running) engine.rebuild(); });
on('param', (node) => engine.updateNode(node));
on('data', (node) => engine.updateNode(node));
