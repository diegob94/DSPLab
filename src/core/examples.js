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
