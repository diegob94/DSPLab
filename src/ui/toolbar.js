// Toolbar: Run / Stop, Delete selected, the Examples menu and the audio status.
import { $ } from '../dom.js';
import { on } from '../core/events.js';
import { graph, deleteSelection } from '../core/graph.js';
import { engine } from '../core/engine.js';
import { loadDiagram, exportJson, importJson, isDiagramJson } from '../core/persistence.js';
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
    // loading replaces the diagram (and the autosave), so ask unless there is nothing to lose
    if (ex && (!graph.nodes.size || confirm(`Replace the current diagram with "${ex.title}"? This can't be undone.`))) loadDiagram(ex.diagram);
    menu.selectedIndex = 0;
    menu.blur();
  });
}

// Shows a short message on a button, then restores its label.
function flash(btn, text) {
  const label = btn.dataset.label ||= btn.textContent;
  btn.textContent = text;
  clearTimeout(btn.flashTimer);
  btn.flashTimer = setTimeout(() => { btn.textContent = label; }, 1500);
}

// Copy / Paste move the whole diagram as JSON through the system clipboard. If the browser denies
// clipboard access, a prompt lets the user copy or paste the text by hand.
function initClipboard() {
  const copyBtn = $('#copy');
  const pasteBtn = $('#paste');

  copyBtn.addEventListener('click', async () => {
    const text = exportJson();
    try {
      await navigator.clipboard.writeText(text);
      flash(copyBtn, 'Copied');
    } catch (err) {
      prompt('The clipboard is not available. Copy the diagram from here:', text);
    }
  });

  pasteBtn.addEventListener('click', async () => {
    let text;
    try {
      text = await navigator.clipboard.readText();
    } catch (err) {
      text = prompt('The clipboard is not available. Paste the diagram here:');
      if (text === null) return;
    }
    // check before asking, so a bad paste never costs the user a confirmation
    if (!isDiagramJson(text)) { flash(pasteBtn, 'Not a diagram'); return; }
    if (graph.nodes.size && !confirm("Replace the current diagram with the one from the clipboard? This can't be undone.")) return;
    flash(pasteBtn, importJson(text) ? 'Pasted' : 'Not a diagram');
  });
}

export function initToolbar() {
  initClipboard();
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
