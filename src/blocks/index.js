/* ------------------------------------------------------------------ *
 * Block definitions (one module per block, registered below)
 *
 * Each block describes its ports, its parameters (rendered as widgets
 * in the node) and how it maps onto Web Audio nodes:
 *   build(ctx, params) -> { inputs: {port: AudioNode}, outputs: {port: AudioNode}, update(params), dispose() }
 * build() is also given the model node as a third argument (to keep per-node data, e.g. a recording, across rebuilds).
 * build() may also return onConnect(port), called when an edge feeds that input port.
 * `inputs` may be a function of the params (a block with a configurable number of ports); a
 * parameter flagged `ports: true` rebuilds the node's ports when it changes, and a select's
 * `options` (strings or numbers) may be a function of the params too. A `type: 'text'` param is a
 * free string (optional `maxLength`, default 100).
 * A range param flagged `reset: true` gets a ↺ button next to its value that puts it back to the default.
 * `asyncPorts` lists the port names (inputs or outputs) whose signal has an asynchronous clock: its samples
 * (bits) come at their own instants instead of at the audio sample rate. An output is any object with
 * connect(target) and send(sample) (see stream.js), an input any object with receive(sample).
 * `wireTypes` maps an async port to the type of its samples when it isn't a plain int (e.g. { out: 'array[uint8]' }); '*' takes any async port.
 * Ports with different clocks or sample types cannot be cabled together.
 * Parameters are edited in the properties panel; those marked `show: true` are also
 * displayed (read-only) on the node itself.
 * A block may also define an async setup(ctx, inUse), awaited before the first build (e.g. to register
 * an AudioWorklet module); inUse says whether the diagram has a node of this type.
 * A block may also define actions: [{ label(node), press(node), release(node) }], press-and-hold buttons in the properties
 * panel (press returns a promise that settles when the action is over; then the engine calls update() on the live block, see the 'data' event).
 * A block may also define ui(node) -> { el, draw(inst) }: a view shown inside the
 * node and redrawn every animation frame (inst is the built instance, or undefined
 * while the engine is stopped).
 * ------------------------------------------------------------------ */
import { waveGenerator } from './wave-generator.js';
import { audioSource } from './audio-source.js';
import { audioSink } from './audio-sink.js';
import { oscilloscope } from './oscilloscope.js';
import { mathOperator } from './math-operator.js';
import { strobeSource } from './strobe-source.js';
import { constantSource } from './constant-source.js';
import { bitSerializer } from './bit-serializer.js';
import { concatenate } from './concatenate.js';
import { bitMonitor } from './bit-monitor.js';
import { debugSink } from './debug-sink.js';
import { pulseShaper } from './pulse-shaper.js';
import { symbolTiming } from './symbol-timing.js';
import { squelch } from './squelch.js';
import { carrierRecovery } from './carrier-recovery.js';
import { fftPlot } from './fft-plot.js';
import { audioRecorder } from './audio-recorder.js';
import { filter } from './filter.js';
import { agc } from './agc.js';
import { matchedFilter } from './matched-filter.js';
import { awgn } from './awgn.js';
import { delay } from './delay.js';
import { vco } from './vco.js';

export const CATEGORIES = {
  'Source blocks': 'var(--source)',
  'Processing blocks': 'var(--proc)',
  'Sink blocks':   'var(--sink)',
};

export const BLOCKS = {
  wave_generator: waveGenerator,
  audio_source: audioSource,
  audio_sink: audioSink,
  oscilloscope,
  math_operator: mathOperator,
  strobe_source: strobeSource,
  constant_source: constantSource,
  bit_serializer: bitSerializer,
  concatenate,
  bit_monitor: bitMonitor,
  debug_sink: debugSink,
  pulse_shaper: pulseShaper,
  symbol_timing: symbolTiming,
  squelch,
  carrier_recovery: carrierRecovery,
  fft_plot: fftPlot,
  audio_recorder: audioRecorder,
  filter,
  agc,
  matched_filter: matchedFilter,
  awgn,
  delay,
  vco,
};
