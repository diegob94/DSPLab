// Toolbar: Run / Stop, Delete selected, the Examples menu and the audio status.
import { $ } from '../dom.js';
import { on } from '../core/events.js';
import { deleteSelection } from '../core/graph.js';
import { engine } from '../core/engine.js';
import { loadDiagram } from '../core/persistence.js';
import { EXAMPLES } from '../core/examples.js';

const runBtn = $('#run');
const delBtn = $('#delete');
const statusEl = $('#status');

function setStatus() {
  const running = engine.running;
  runBtn.textContent = running ? '■ Stop' : '▶ Run';
  runBtn.classList.toggle('running', running);
  statusEl.textContent = running ? `Running @ ${engine.ctx.sampleRate} Hz` : 'Stopped';
  statusEl.classList.toggle('on', running);
}

// On narrow screens the palette is a drawer (the properties panel is always visible below the canvas).
function initDrawers() {
  const toggle = $('#show-palette');
  const show = (open) => {
    document.body.classList.toggle('show-palette', open);
    toggle.classList.toggle('active', open);
  };
  toggle.addEventListener('click', () => show(!document.body.classList.contains('show-palette')));
  // tapping the canvas background or adding a block gets the drawer out of the way
  $('#canvas').addEventListener('pointerdown', (e) => { if (!e.target.closest('.node')) show(false); });
  on('node-added', () => show(false));
}

// A <select> that acts as a menu: picking an entry replaces the diagram, then it goes back to the title.
function initExamples() {
  const menu = $('#examples');
  menu.append(new Option('Examples', '', true, true));
  menu.options[0].disabled = true;
  for (const ex of EXAMPLES) menu.append(new Option(ex.title, ex.id));
  menu.addEventListener('change', () => {
    const ex = EXAMPLES.find((e) => e.id === menu.value);
    if (ex) loadDiagram(ex.diagram);
    menu.selectedIndex = 0;
    menu.blur();
  });
}

export function initToolbar() {
  initDrawers();
  initExamples();
  delBtn.addEventListener('click', deleteSelection);
  on('selection', (sel) => { delBtn.disabled = !sel; });

  runBtn.addEventListener('click', async () => {
    runBtn.disabled = true;
    try {
      if (engine.running) await engine.stop(); else await engine.start();
    } catch (err) {
      console.error(err);
      statusEl.textContent = 'Audio error: ' + err.message;
      engine.ctx = null;
      runBtn.disabled = false;
      return;
    }
    runBtn.disabled = false;
    setStatus();
  });
}
