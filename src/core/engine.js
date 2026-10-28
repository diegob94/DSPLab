// Audio engine: maps the graph onto Web Audio nodes and keeps them in sync with it.
import { BLOCKS } from '../blocks/index.js';
import { graph } from './graph.js';
import { on } from './events.js';

export const engine = {
  ctx: null,
  live: new Map(), // node id -> built block instance

  get running() { return !!this.ctx; },

  async start() {
    const ctx = new (window.AudioContext || window.webkitAudioContext)();
    try {
      // blocks may need to load modules (e.g. an AudioWorklet) before they can be built
      await Promise.all(Object.values(BLOCKS).map((block) => block.setup && block.setup(ctx)));
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

on('changed', () => { if (engine.running) engine.rebuild(); });
on('param', (node) => engine.updateNode(node));
