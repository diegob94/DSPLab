// Entry point: wires the UI to the core and loads the saved (or a starter) diagram.
import { BLOCKS } from './blocks/index.js';
import {
  graph, select, addNode, removeNode, addEdge, removeEdge, rebuildPorts, syncParams,
} from './core/graph.js';
import { engine } from './core/engine.js';
import { serialize, restore, loadDiagram } from './core/persistence.js';
import { EXAMPLES } from './core/examples.js';
import { initWires, redrawEdges } from './ui/wires.js';
import { initNodes, refreshSummary, startRenderLoop } from './ui/nodes.js';
import { initProperties } from './ui/properties.js';
import { initPalette } from './ui/palette.js';
import { initCanvas } from './ui/canvas.js';
import { initToolbar, openSharedLink } from './ui/toolbar.js';

initWires();
initNodes();
initProperties();
initPalette();
initCanvas();
initToolbar();
startRenderLoop();

if (!restore()) loadDiagram(EXAMPLES[0].diagram);
openSharedLink();   // a shared link wins over the saved diagram (it asks first if that has blocks)

// handle for the tests and for poking at the app from the browser console
window.dsplab = {
  BLOCKS, graph, engine, select,
  addNode, removeNode, addEdge, removeEdge, rebuildPorts, syncParams,
  redrawEdges, refreshSummary, serialize,
};
