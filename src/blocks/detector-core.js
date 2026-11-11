// The maths of the Detector block, with no Web Audio in it so that it can be tested alone: 1 while the input is above
// the threshold, 0 otherwise (an input exactly at the threshold is not above it).
export function detect(inp, out, threshold) {
  for (let i = 0; i < out.length; i++) out[i] = inp[i] > threshold ? 1 : 0;
}
