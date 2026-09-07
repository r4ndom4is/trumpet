/* Trumpet Flight - synthesized sound-effect note data.
 * Single source of truth for the flap/score/crash cues played via tone(). Embedded
 * into index.html for atomic offline updates; also loaded as-is by tools/character-lab
 * so the lab's sound reference can never drift from what actually ships.
 *
 * Each note maps 1:1 onto a tone(frequency, duration, endFrequency, delay, append,
 * shape, options) call: freq/dur/to/at/wave carry the positional arguments (append is
 * always true for every note after the first, which silence()s), and every other key
 * (cutoff, gain, attack, close, bend, q, sustain) is passed through as tone()'s options.
 */
window.TRUMPET_SOUNDS = {
  flap: { id: "flap-phrase-1", notes: [
    { freq: 196, dur: 0.026, to: 196, at: 0, wave: "brass", cutoff: 650, gain: 0.034, attack: 0.005 },
    { freq: 174.44, dur: 0.032, to: 174.44, at: 0.026, wave: "brass", cutoff: 700, gain: 0.03, attack: 0.005 }
  ] },
  score: { id: "score-chord-5", notes: [
    { freq: 294, dur: 0.13, to: 294, at: 0, wave: "sine", cutoff: 840, gain: 0.044, attack: 0.012 },
    { freq: 370.44, dur: 0.125, to: 370.44, at: 0.006, wave: "sine", cutoff: 960, gain: 0.026, attack: 0.012 }
  ] },
  crash: { id: "crash-brassfall-2", notes: [
    { freq: 294, dur: 0.1, to: 232.26, at: 0, wave: "brass", cutoff: 1140, close: 0.36, gain: 0.055, attack: 0.006 },
    { freq: 246.96, dur: 0.1, to: 183.49, at: 0.081, wave: "brass", cutoff: 1140, close: 0.36, gain: 0.046, attack: 0.006 },
    { freq: 207.45, dur: 0.1, to: 144.96, at: 0.162, wave: "brass", cutoff: 1140, close: 0.36, gain: 0.037, attack: 0.006 }
  ] }
};
