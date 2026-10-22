let ctx = null;
let muted = false;

export function setMuted(value) {
  muted = value;
}

export function isMuted() {
  return muted;
}

// Must be called from a user gesture so browsers allow audio.
export function unlockAudio() {
  if (!ctx && typeof AudioContext !== 'undefined') ctx = new AudioContext();
  if (ctx && ctx.state === 'suspended') ctx.resume();
}

function beep(freq, duration, type = 'sine', gain = 0.06) {
  if (!ctx || muted) return;
  const osc = ctx.createOscillator();
  const g = ctx.createGain();
  osc.type = type;
  osc.frequency.value = freq;
  g.gain.setValueAtTime(gain, ctx.currentTime);
  g.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + duration);
  osc.connect(g).connect(ctx.destination);
  osc.start();
  osc.stop(ctx.currentTime + duration);
}

export function playEvent(type) {
  if (type === 'hit') beep(520, 0.08, 'triangle');
  else if (type === 'wall') beep(260, 0.05, 'sine', 0.035);
  else if (type === 'miss') beep(110, 0.35, 'sawtooth', 0.07);
  else if (type === 'collect') {
    beep(880, 0.12, 'triangle', 0.07);
    beep(1320, 0.18, 'sine', 0.05);
  } else if (type === 'shield') beep(330, 0.25, 'square', 0.04);
}
