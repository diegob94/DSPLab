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
    // what is between bursts, and the symbols are sampled and printed by a Debug Sink. Needs microphone permission.
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
        { id: 7, type: 'debug_sink', x: 1456, y: 139, params: { lines: 16 } },
      ],
      edges: [
        edge(1, 'out', 2, 'in'), edge(2, 'out', 3, 'a'), edge(1, 'out', 3, 'b'),
        edge(3, 'out', 4, 'in'), edge(4, 'out', 5, 'in'), edge(5, 'out', 6, 'in'),
        edge(6, 'bits', 7, 'in'),
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
  {
    // A text sent as a baseband signal through a noisy channel and detected again: the Strobe Source's "hello" is
    // unpacked to bytes, reshaped to 40 bits and serialized at 1000 baud; the Upsampler (Factor 40) and the Pulse Shaper
    // (sinc, 40 samples / symbol) turn the bits into a band-limited waveform (1000 baud x 40 = 40 kHz: a faster signal
    // than the sound card's, e.g. 48 kHz on a 44.1 kHz card, can't be carried and its cables would be dropped); AWGN adds noise well above the signal
    // (-15 dB); the Matched Filter (same pulse) pulls the symbols out of it and the Detector slices them at 0.75
    // (a sinc pulse comes out of the matched filter with a peak of 1 at the symbol instant, so 0.75 sits between 0 and 1).
    // The scope shows every stage: ch1 the bits, ch2 the impulses, ch3 the shaped signal, ch4 the noisy one, ch5 the
    // matched filter's output and ch6 the detected bits. Press Run.
    id: 'baseband-noise',
    title: 'Pulse shaping with noise',
    diagram: {
      version: 1, pan: { x: 0, y: 0 }, zoom: 1,
      nodes: [
        { id: 1, type: 'strobe_source', x: 535, y: 41, params: { data: 'hello', period: 1000 } },
        { id: 2, type: 'array_unpack', x: 755, y: 47, params: {} },
        { id: 3, type: 'array_reshape', x: 964, y: 50, params: { rows: 0, cols: -1 } },
        { id: 4, type: 'serializer', x: 131, y: 380, params: { baud: 1000 } },
        { id: 5, type: 'upsampler', x: 336, y: 452, params: { factor: 40 } },
        { id: 6, type: 'pulse_shaper', x: 545, y: 527, params: { pulse: 'sinc', sps: 40 } },
        { id: 7, type: 'awgn', x: 751, y: 600, params: { snr: -15 } },
        { id: 8, type: 'matched_filter', x: 966, y: 681, params: { pulse: 'sinc', sps: 40 } },
        { id: 9, type: 'detector', x: 1171, y: 749, params: { threshold: 0.75 } },
        { id: 10, type: 'oscilloscope', x: 1389, y: 339, params: { channels: 6, trigger: 'ch1', mode: 'normal', level: 0.5, xdiv: 7.7512, ydiv: 2, display1: 'sample & hold', display2: 'impulse' } },
      ],
      edges: [
        edge(1, 'out', 2, 'in'), edge(2, 'out', 3, 'in'), edge(3, 'out', 4, 'in'), edge(4, 'out', 5, 'in'),
        edge(5, 'out', 6, 'in'), edge(6, 'out', 7, 'in'), edge(7, 'out', 8, 'in'), edge(8, 'out', 9, 'in'),
        edge(4, 'out', 10, 'ch1'), edge(5, 'out', 10, 'ch2'), edge(6, 'out', 10, 'ch3'),
        edge(7, 'out', 10, 'ch4'), edge(8, 'out', 10, 'ch5'), edge(9, 'out', 10, 'ch6'),
      ],
    },
  },
];
