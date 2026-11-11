// Entry point: wires the UI to the core and loads the saved (or a starter) diagram.
import { BLOCKS } from './blocks/index.js';
import {
  graph, select, selectNodes, addNode, removeNode, addEdge, removeEdge, rebuildPorts, syncParams, setNativeRate,
} from './core/graph.js';
import { engine } from './core/engine.js';
import { serialize, restore, loadDiagram } from './core/persistence.js';
import { EXAMPLES } from './core/examples.js';
import { initWires, redrawEdges } from './ui/wires.js';
import { initNodes, refreshSummary, startRenderLoop } from './ui/nodes.js';
import { initProperties } from './ui/properties.js';
import { initPalette } from './ui/palette.js';
import { initScreen } from './ui/screen.js';
import { initCanvas } from './ui/canvas.js';
import { initHelp } from './ui/help.js';
import { initToolbar, openSharedLink } from './ui/toolbar.js';

initWires();
initNodes();
initProperties();
initPalette();
initCanvas();
initScreen();
initToolbar();
initHelp();
startRenderLoop();

// the sample rate of the sound card, so that a signal at that rate can be cabled to audio ports before Run is pressed
try {
  const probe = new (window.AudioContext || window.webkitAudioContext)();
  setNativeRate(probe.sampleRate);
  probe.close();
} catch (err) { /* no audio: signals at a rate of their own then can't be told from the sound card's */ }

if (!restore()) loadDiagram(EXAMPLES[0].diagram);
openSharedLink();   // a shared link wins over the saved diagram (it asks first if that has blocks)

// handle for the tests and for poking at the app from the browser console
window.dsplab = {
  BLOCKS, graph, engine, select, selectNodes,
  addNode, removeNode, addEdge, removeEdge, rebuildPorts, syncParams,
  redrawEdges, refreshSummary, serialize,
};
