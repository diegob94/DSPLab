/* ------------------------------------------------------------------ *
 * Block definitions (one module per block, registered below)
 *
 * Each block describes its ports, its parameters (rendered as widgets
 * in the node) and how it maps onto Web Audio nodes:
 *   build(ctx, params) -> { inputs: {port: AudioNode}, outputs: {port: AudioNode}, update(params), dispose() }
 * build() may also return onConnect(port), called when an edge feeds that input port.
 * `inputs` may be a function of the params (a block with a configurable number of ports); a
 * parameter flagged `ports: true` rebuilds the node's ports when it changes, and a select's
 * `options` (strings or numbers) may be a function of the params too.
 * Parameters are edited in the properties panel; those marked `show: true` are also
 * displayed (read-only) on the node itself.
 * A block may also define an async setup(ctx), awaited before the first build (e.g. to register
 * an AudioWorklet module).
 * A block may also define ui(node) -> { el, draw(inst) }: a view shown inside the
 * node and redrawn every animation frame (inst is the built instance, or undefined
 * while the engine is stopped).
 * ------------------------------------------------------------------ */
import { waveGenerator } from './wave-generator.js';
import { audioSink } from './audio-sink.js';
import { oscilloscope } from './oscilloscope.js';
import { mathOperator } from './math-operator.js';

export const CATEGORIES = {
  'Source blocks': 'var(--source)',
  'Processing blocks': 'var(--proc)',
  'Sink blocks':   'var(--sink)',
};

export const BLOCKS = {
  wave_generator: waveGenerator,
  audio_sink: audioSink,
  oscilloscope,
  math_operator: mathOperator,
};
