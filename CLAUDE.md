# DSPLab

A node-based flowgraph editor for audio DSP (in the spirit of GNU Radio) that runs **entirely in the
browser**: vanilla JavaScript ES modules, Web Audio, no backend, no build step, no runtime
dependencies. Blocks are wired together on a canvas and the graph is turned into Web Audio nodes
when you press Run.

Language: the user writes in Spanish; code, comments, commit messages and UI text are in English.

User-facing documentation is in `README.md` (a user guide: screen, blocks and their settings, recipes,
saving, troubleshooting). When you change what a block does, a setting's range/default or an
interaction, update it in the same commit.

## Commands

```
./serve.sh                  # http://localhost:8000  (./serve.sh 9000 for another port)
npm install                 # only needed for the tests
npx playwright install chromium   # first time only
npm test                    # whole suite, ~10 s
node --test tests/oscilloscope.test.js   # one file
DSPLAB_URL=http://127.0.0.1:8000/ npm test   # test against a server you already run
```

- **Never open `index.html` from `file://`.** ES modules (and the AudioWorklet) don't load that way;
  use `serve.sh` (a thin wrapper around `python3 -m http.server`).
- Node 20+ is required by Playwright. Python 3 is only used by `serve.sh`.
- There is no linter, formatter or bundler. Match the surrounding code style (2-space indent,
  single quotes, semicolons, short comments that explain *why*).

## Architecture

```
index.html            page skeleton; loads src/main.js as a module
src/
  main.js             boot: init the UI modules, restore the saved diagram or load a starter one
  blocks/             one module per block + index.js (registry, categories, the block contract)
  core/               no DOM here
    graph.js          the model: nodes, edges, selection, pan. Emits events.
    events.js         tiny event bus (`on` / `emit`); the event list is documented at the top
    params.js        optionsOf / portNames / validParam helpers
    engine.js         graph -> Web Audio nodes; subscribes to the model
    persistence.js    autosave to localStorage + restore (subscribes to the model)
  ui/                 everything that touches the DOM, each module subscribes to what it needs
    nodes.js wires.js properties.js palette.js canvas.js toolbar.js
  dom.js util.js      shared helpers (h(), svgEl(), $, clamp)
tests/                Playwright + node:test
```

**The one rule that matters:** `core/` never imports from `ui/` and never touches the DOM. State flows
one way: UI calls a `core/graph.js` function -> it changes the model and emits an event -> the engine,
persistence and UI modules react. Don't call the engine or `save()` from UI code; emit through the
model instead. No import cycles exist today; keep it that way.

The UI attaches its own `el` (and `view` for blocks with a live display) to model nodes, and `el` to
edges. These are not serialized.

`window.dsplab` exposes the graph, engine, `BLOCKS` and the edit functions. It exists for the tests
and for debugging from the console; app code must not use it.

### Model details worth knowing

- Node and edge ids come from one shared counter (`graph.nextId`), so a new node after a starter
  graph is **not** id 3 (the starter cable is). Never hard-code ids in tests; look the node up by type.
- An input port accepts one cable: connecting again replaces it. An output can feed many inputs.
- Parameter values are validated whenever a diagram is loaded (`validParam`): unknown values reset
  to the default, numbers are clamped. Saved data is never trusted.
- The saved format is `{ version: 1, pan, nodes: [{id,type,x,y,params}], edges: [{from,to}] }` under
  the `dsplab.diagram` localStorage key. Changing a block's port or parameter names silently drops the
  saved cables/values that referred to the old ones. Bump `version` or add a migration if that matters.

## Adding a block

1. Create `src/blocks/<name>.js` exporting a definition object, and register it in
   `src/blocks/index.js` (`BLOCKS`; the palette and nodes are generated from it). The full contract is
   in the comment at the top of `blocks/index.js`. In short:
   - `title`, `category` (a key of `CATEGORIES`), `inputs` / `outputs` (port names; `inputs` may be a
     function of the params for a configurable number of ports), `params`.
   - A param is `{ key, label, type: 'select' | 'range', default, ... }`. Selects take `options`
     (strings or numbers, or a function of the params); ranges take `min`, `max`, `step`, optional
     `scale: 'log'` and `unit`. `show: true` also displays the value (read-only) on the node; every
     param is editable in the properties panel. `ports: true` rebuilds the ports when it changes.
   - `build(ctx, params)` returns `{ inputs: {port: AudioNode}, outputs: {port: AudioNode}, update(params), dispose() }`
     (optional `onConnect(port)`). `update` must apply parameter changes without rebuilding.
   - Optional `ui(node)` -> `{ el, draw(inst) }` for a live view redrawn every frame (see the
     oscilloscope), and an async `setup(ctx)` awaited before the first build.
2. Add tests in `tests/`. Verify audio maths with an `OfflineAudioContext` (see `math.test.js`).
3. A new colour category needs a `--<name>` CSS variable in `src/styles.css`.

## Testing

- Tests are real-browser (Chromium) tests. Each test gets a fresh page and context, and **fails if the
  page logs any console/page error**.
- `tests/helpers.js`: `withApp(app, fn, { seed })` (seed = a saved diagram placed in localStorage
  *before* the app starts), `selectNode`, `addFromPalette`, `connect` (real mouse drag between ports),
  `setRange`, `panelControl(page, label)` (a properties-panel control by its label), `startAudio`.
- Always use `startAudio(page)` rather than clicking Run: starting is asynchronous (it loads the
  oscilloscope's worklet).
- Reaching into `dsplab.*` inside `page.evaluate` is fine in tests; assertions on the DOM should go
  through the real UI where it is cheap.
- To check a test really guards something, break the app on purpose (a one-line mutation), confirm
  the suite fails, then `git checkout` the file. An early version of the autosave tests passed even with
  autosave disabled, because reloading the page flushes the save on `pagehide`; there is now a test that
  reads localStorage without reloading.
- The environment has no audio output, so tests can verify that the engine starts and that signals are
  computed correctly (offline rendering, analysis of captured samples), but nobody can *listen* to the
  result. Don't claim you heard anything.

## Gotchas

- The diagram is also saved on `pagehide`, so removing the localStorage key by hand and reloading does
  **not** reset it (the page writes its state back as it unloads). In tests, put a diagram in storage
  before the app starts with `withApp(..., { seed })`.
- Web Audio only starts after a user gesture, so the diagram is restored on load but audio waits for Run.
- `AnalyserNode` can't hold more than 32768 samples (0.74 s at 44.1 kHz), which is why the oscilloscope
  captures through an `AudioWorklet` into 2 s ring buffers (`blocks/scope-processor.js`).
- Oscilloscope trigger: the newest rising crossing of the chosen channel that leaves a full window
  after it. Searching from the oldest data picks up start-up transients.
- Playwright `selectOption` fires both `input` and `change`; the panel applies port-count changes on
  `change` so dragging a slider doesn't drop cables on the way. Mimic that in tests with `setRange`.
- Hit-testing in tests: new blocks added by double-click all land at the canvas centre and overlap.
  Move them (`dsplab.graph` nodes + `moved`) or drag from a spot you know is empty.

## Git

- `main` is the only long-lived branch; the remote is `origin` (`github.com/diegob94/DSPlab`). Every
  feature starts from `main` on a `feature/*` branch and ends with a PR back into `main`. Don't
  force-push `main` without asking.
- Commit and push in small, separate commits (a refactor, a feature and the tests that cover it are
  different commits). Run `npm test` first; all tests must pass.
- No git identity is configured in the container; pass it per command:
  `git -c user.name=... -c user.email=... commit`.
- Release flow: `feature/*` branch off `main` (ideally in a worktree under `.claude/worktrees/`, which is
  git-ignored) -> PR into `main` -> merge. `.github/workflows/pages.yml` runs the tests on every PR to
  `main` and, on a push to `main`, deploys `index.html` + `src/` to GitHub Pages. All paths are
  relative, so the site works under `/DSPlab/` as-is. Merge PRs with a merge commit or rebase, not
  squash, so branches keep sharing history. Pages must be enabled by hand (Settings -> Pages ->
  Source: GitHub Actions); ask before enabling it or publishing anything.
