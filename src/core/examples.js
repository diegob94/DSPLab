// Example diagrams for the Examples menu, in the saved format (see persistence.js).
// The first one is also the starter diagram of a fresh page.
const edge = (from, fromPort, to, toPort) => ({ from: { node: from, port: fromPort }, to: { node: to, port: toPort } });

export const EXAMPLES = [
  {
    id: 'tone',
    title: 'Simple tone',
    diagram: {
      version: 1, pan: { x: 0, y: 0 }, zoom: 1,
      nodes: [
        { id: 1, type: 'wave_generator', x: 80, y: 90, params: {} },
        { id: 2, type: 'audio_sink', x: 420, y: 120, params: {} },
      ],
      edges: [edge(1, 'out', 2, 'in')],
    },
  },
  {
    // a 440 Hz carrier (the generator's defaults) multiplied by a 2 Hz square wave in 0..1: the carrier switches on and off
    id: 'ask',
    title: 'ASK modulation',
    diagram: {
      version: 1, pan: { x: 0, y: 0 }, zoom: 1,
      nodes: [
        { id: 1, type: 'wave_generator', x: 20, y: 40, params: {} },
        { id: 2, type: 'wave_generator', x: 20, y: 330, params: { waveform: 'square', frequency: 2, offset: 0.5 } },
        { id: 3, type: 'math_operator', x: 290, y: 170, params: { operation: 'multiply' } },
        { id: 4, type: 'audio_sink', x: 570, y: 40, params: {} },
        { id: 5, type: 'oscilloscope', x: 570, y: 260, params: { channels: 2, trigger: 'ch2', level: 0.5, xdiv: 100 } },
      ],
      edges: [
        edge(1, 'out', 3, 'a'), edge(2, 'out', 3, 'b'),
        edge(3, 'out', 4, 'in'), edge(3, 'out', 5, 'ch1'), edge(2, 'out', 5, 'ch2'),
      ],
    },
  },
  {
    // An ASK receiver for a message played into the microphone (a 440 Hz carrier keyed by Pulse Shaper symbols at
    // 1000 baud, with the preamble "ddd" in front of 5 characters). The carrier is recovered with a PLL and
    // multiplied with the signal (a product detector); the low-pass keeps the baseband, the squelch silences
    // what is between bursts, and the symbols are sampled and framed by the preamble. Needs microphone permission.
    id: 'ask-receiver',
    title: 'ASK receiver',
    diagram: {
      version: 1, pan: { x: 0, y: 0 }, zoom: 1,
      nodes: [
        { id: 1, type: 'audio_source', x: 50, y: 160, params: {} },
        { id: 2, type: 'carrier_recovery', x: 290, y: 57, params: { frequency: 440, bandwidth: 20 } },
        { id: 3, type: 'math_operator', x: 520, y: 138, params: { operation: 'multiply' } },
        { id: 4, type: 'filter', x: 770, y: 136, params: { type: 'lowpass', frequency: 517 } },
        { id: 5, type: 'squelch', x: 988, y: 137, params: { threshold: 0.1 } },
        { id: 6, type: 'symbol_timing', x: 1216, y: 137, params: { baud: 1000 } },
        { id: 7, type: 'message_deserialize', x: 1456, y: 139, params: { rows: 8, cols: 5, preamble: 'ddd' } },
        { id: 8, type: 'message_debug', x: 1731, y: 139, params: { lines: 16, decode: 'on' } },
      ],
      edges: [
        edge(1, 'out', 2, 'in'), edge(2, 'out', 3, 'a'), edge(1, 'out', 3, 'b'),
        edge(3, 'out', 4, 'in'), edge(4, 'out', 5, 'in'), edge(5, 'out', 6, 'in'),
        edge(6, 'msg', 7, 'msg'), edge(7, 'msg', 8, 'msg'),
      ],
    },
  },
  {
    // needs microphone permission when Run is pressed
    id: 'mic-scope',
    title: 'Audio source scope',
    diagram: {
      version: 1, pan: { x: 0, y: 0 }, zoom: 1,
      nodes: [
        { id: 1, type: 'audio_source', x: 40, y: 80, params: {} },
        { id: 2, type: 'oscilloscope', x: 380, y: 60, params: { channels: 1, xdiv: 5 } },
      ],
      edges: [edge(1, 'out', 2, 'ch1')],
    },
  },
];
