<p align="center"><img src="assets/banner.png" alt="DSPLab: experiment signal processing right in your browser" width="640"></p>

Works on desktop and on mobile: on a phone the side panels become drawers (see [On a phone](#on-a-phone)).

Build audio signal chains by wiring blocks together on a canvas, then hear them and watch them on an
oscilloscope. It is a small node-based flowgraph editor (think GNU Radio, for the browser) that runs
**entirely in your browser**: no server, no account, nothing to install except a way to serve a few files.

## Quick start

You need Python 3 (only to serve the files) and a modern browser. DSPLab is developed and tested in
Chromium-based browsers (Chrome, Edge, Chromium); others are untested.

```
./serve.sh
```

Open <http://localhost:8000>. (Another port: `./serve.sh 9000`.)

> Double-clicking `index.html` won't work: browsers refuse to load JavaScript modules from `file://`.
> Always go through `serve.sh`.

You start with a **Wave Generator** already connected to an **Audio Sink**. Press **▶ Run** and you hear a
440 Hz tone. Press **■ Stop** to end it.

> Start with a low system volume. A full-scale square wave at a high frequency is harsh.

## The screen

```
┌───────────────────────────────────────────────────────────────────┐
│ DSPLab   [▶ Run]  [Delete selected]                     Stopped   │
├────────────┬──────────────────────────────────────┬───────────────┤
│ PROPERTIES │                                      │ SOURCE BLOCKS │
│            │            canvas                    │ PROCESSING    │
│ settings   │   blocks and the cables between      │ SINK BLOCKS   │
│ of the     │   them                               │               │
│ selected   │                                      │ (drag or      │
│ block      │                                      │  double-click)│
└────────────┴──────────────────────────────────────┴───────────────┘
```

- **Canvas** (centre): your diagram.
- **Block palette** (right): the available blocks, grouped by category.
- **Properties** (left): every setting of the selected block. Blocks themselves only show their key
  values, read-only; you change them here.
- **Toolbar** (top): Run/Stop, delete, the **Examples** menu, and the audio status (the sample rate while
  running).
- **Examples** (toolbar): *Simple tone* (the starting diagram), *ASK modulation* and *Audio source scope* (microphone → oscilloscope). Picking one replaces
  the current diagram, so it can't be undone (the old diagram is overwritten by the autosave).

### On a phone

On narrow screens (or a phone held sideways) the canvas fills the screen. **Properties** are always
shown in a panel below the canvas, and the **Blocks** palette is a drawer that slides up from the
bottom: open it with the **Blocks** button in the toolbar; tapping the empty canvas closes it. **Tap** a
block in the palette to add it, since drag and drop and double-click don't work well on touch screens.
Everything else (moving blocks, connecting ports, panning) works with your finger as it does with the
mouse, and pinching the canvas zooms.

## Working with blocks

| To… | Do this |
|---|---|
| Add a block | Drag it from the palette onto the canvas, or double-click it in the palette |
| Move a block | Drag it by any part of the block (title bar or body) |
| Connect blocks | Drag from an **output** port (right side of a block) to an **input** port (left side of another) |
| Select a block or a cable | Click it. Its settings (or, for a cable, where it goes from and to) appear in Properties |
| Edit a setting | Select the block, then use the controls in Properties |
| Set an exact value | Type it in the number field under a slider and press Enter (or leave the field). Values outside the range are clamped to it |
| Delete the selection | `Delete` or `Backspace`, or the **Delete selected** button |
| Pan the canvas | Drag the empty background |
| Zoom the canvas | Pinch with two fingers (a two-finger drag also pans), or scroll the mouse wheel over the canvas. 30 %–250 %; the zoom is saved with the diagram |
| Deselect | Click the empty background |

Connection rules:

- A cable always goes from an output to an input, and never from a block to itself.
- An **input takes one cable**: connecting a second one replaces the first.
- An **output can feed many inputs**.
- An unconnected input counts as silence (zero).

You can change settings while the audio is running and hear the result immediately. Adding or removing
blocks and cables while running also works, but rebuilds the audio graph, so expect a brief click and
the oscillators restarting their phase.

## Blocks

### Source blocks

**Wave Generator**: a tone generator. Output: `out`.

| Setting | Range | Default |
|---|---|---|
| Waveform | sine, square, sawtooth, triangle | sine |
| Frequency | 1 Hz – 20 000 Hz (logarithmic slider) | 440 Hz |
| Amplitude | 0 – 1 | 0.5 |
| Offset | −1 – 1 | 0 |

Offset adds a constant (DC) level to the wave, so the output swings around that level instead of around
0. It is independent of Amplitude: amplitude 0.5 with offset 0.3 goes from −0.2 to 0.8.

Shown on the block: Waveform, Frequency and Offset.

**Audio Source**: your microphone (or the browser's default audio input). Output: `out`.

| Setting | Range | Default |
|---|---|---|
| Gain | 0 – 2 | 1 |

The browser asks for microphone permission when you press **Run** with an Audio Source in the diagram
(never otherwise). Echo cancellation, noise suppression and automatic gain are turned off so you get the
raw signal. Wear headphones when sending it to an Audio Sink, or it will feed back. An Audio Source
added while running stays silent until you press Stop and Run again.

Shown on the block: Gain.

### Processing blocks

**Math Operator**: combines two signals sample by sample. Inputs: `a`, `b`. Output: `out`.

| Operation | Result |
|---|---|
| add | a + b |
| subtract | a − b |
| multiply | a × b |

An unconnected input is 0, so `add` with only `a` connected passes `a` through, `multiply` with `b`
open gives silence, and `subtract` with only `b` connected inverts it.

### Sink blocks

**Audio Sink**: plays a signal on your speakers. Input: `in`. Setting: **Volume** 0 – 1 (default 0.8).

Audio is clipped at ±1 by the browser, and nothing in DSPLab prevents that. If you add signals or
turn amplitudes up so the sum exceeds 1, you'll hear distortion; lower the amplitudes. A Wave
Generator's Offset counts too: amplitude 0.5 with offset 0.8 already goes past 1.

**Oscilloscope**: draws signals over time. Inputs: `ch1` … `chN`, each channel in its own colour. It
only draws while the audio is running (otherwise it reads *Stopped*).

| Setting | What it does | Range | Default |
|---|---|---|---|
| Inputs | How many channels (inputs) the block has | 1 – 8 | 2 |
| Trigger | Which channel starts each sweep | `ch1` … `chN` | ch1 |
| Trig level | Level the trigger channel must cross going upwards | −1 – 1 | 0 |
| Time span | How much time fits on the screen | 1 ms – 1000 ms (logarithmic) | 10 ms |
| Scale | Vertical zoom, shared by all channels | 0.1× – 10× (logarithmic) | 1× |

Shown on the block: Trigger and Time span.

- **Trigger.** Each sweep starts where the trigger channel rises through *Trig level*, and every
  channel is drawn from that same instant, so a repeating signal holds still and channels can be
  compared. The trigger channel can be any of them, which lets you synchronise to a clean reference
  while looking at a messy signal.
- If the trigger channel has no cable, or never crosses the level, the newest samples are drawn
  without synchronisation.
- Channels without a cable aren't drawn.
- If you reduce *Inputs*, cables on the channels that disappear are removed, and the trigger returns to
  `ch1` if its channel is gone.
- At long time spans a fast signal fills the screen as a solid band (440 cycles in 1 s can't be told
  apart in 220 pixels). Use a slow signal, or a shorter span, to see the shape. The band's outline is
  the signal's envelope, which is useful on its own (see *Beats* below).

## Recipes

**Hear a tone.** Wave Generator → Audio Sink (this is the starting diagram). Press Run and move the
Frequency slider.

**See a wave.** Add an Oscilloscope and connect the generator's `out` to `ch1` as well (an output can feed
several inputs). Press Run. The default 10 ms span shows about four cycles of 440 Hz.

**Amplitude-shift keying.** Pick *ASK modulation* in the Examples menu: a 440 Hz sine is multiplied by a
2 Hz square wave that swings between 0 and 1, so the tone switches on and off. The scope shows the keyed
signal (`ch1`) against the square wave (`ch2`, the trigger).

**Compare two waves.** Add a second Wave Generator and connect it to `ch2`. Set the scope's Time span to
5 ms, both generators to 1000 Hz, one to *sine* and the other to *square*, and set *Trigger* to `ch2`:
both traces start where the square wave rises, and you see how the sine lines up with it.

**Beats.** Two generators at 440 Hz and 444 Hz, both into a Math Operator set to *add*, whose output goes
to an Audio Sink and to an Oscilloscope with a Time span of 1000 ms. You hear the tone swell four times a
second, and the scope's band shows four lobes.

**Ring modulation.** Same wiring, but set the second generator to 5 Hz and the Math Operator to
*multiply*. The slow wave shapes the 440 Hz tone, which goes silent at every zero crossing of the
slow wave. The result peaks at 0.25 with both amplitudes at 0.5.

**Invert a signal.** Math Operator set to *subtract*, with only `b` connected: the output is `−b`. Feeding
the original on `ch1` and the inverted copy on `ch2` of a scope shows two mirrored traces.

## Saving your work

The diagram is saved automatically in your browser (its `localStorage`) every time you change it, and
is restored when you reload the page. You'll find it exactly as you left it: blocks, positions,
settings, cables and the position of the canvas. Audio doesn't restart by itself, because browsers
require a click to start sound: press Run.

Things to know:

- The saved diagram belongs to **one browser and one address**. `localhost:8000` and `localhost:9000` are
  different places, and so are two browsers.
- Clearing the site's data erases it. There is no file export or import yet.
- To start over, delete all the blocks (an empty diagram is remembered too). There is no "new diagram"
  button yet, so the starting Wave Generator → Audio Sink diagram only comes back in a browser profile
  or address that has never saved one (for example a private window). Removing the saved entry by hand
  isn't enough: the page saves again when it unloads.
- If the browser blocks storage (for example in some private windows), DSPLab still works, it just
  can't remember your diagram.

## Troubleshooting

| Symptom | Likely cause |
|---|---|
| Blank page or no blocks | You opened `index.html` directly. Use `./serve.sh` |
| No sound | Did you press **Run**? Is the Wave Generator connected to an Audio Sink? Check Amplitude, Volume, your system volume and that the tab isn't muted |
| Scope says *Stopped* | Press Run; it only draws while the audio is running |
| Scope draws a flat line | The channel has no cable, or the signal is silent (e.g. a Math Operator with an input open) |
| Trace jitters | The trigger channel has no cable or never crosses *Trig level*, so the sweep is not synchronised |
| Distorted sound | The signal exceeds ±1: lower the amplitudes |
| "Audio error" in the toolbar | The browser couldn't start audio; reload and press Run again |

## Not supported yet

Undo/redo, copy and paste, selecting several blocks at once, zooming the canvas, exporting or importing
diagrams as files, a divide operation, and audio inputs from a microphone or file. Blocks are a short
list for now (one generator, one operator, two sinks).

## For developers

`npm install && npm test` runs the browser test suite. Architecture, conventions and how to add a block
are in [`CLAUDE.md`](CLAUDE.md).
