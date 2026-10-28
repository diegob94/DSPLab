// Entry point: wires the UI to the core and loads the saved (or a starter) diagram.
import { BLOCKS } from './blocks/index.js';
import {
  graph, select, addNode, removeNode, addEdge, removeEdge, rebuildPorts, syncParams,
} from './core/graph.js';
import { engine } from './core/engine.js';
import { serialize, restore } from './core/persistence.js';
import { initWires, redrawEdges } from './ui/wires.js';
import { initNodes, refreshSummary, startRenderLoop } from './ui/nodes.js';
import { initProperties } from './ui/properties.js';
import { initPalette } from './ui/palette.js';
import { initCanvas } from './ui/canvas.js';
import { initToolbar } from './ui/toolbar.js';

initWires();
initNodes();
initProperties();
initPalette();
initCanvas();
initToolbar();
startRenderLoop();

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
