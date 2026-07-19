// Instant-acknowledgment sounds — the AoE latency-masking trick: the click
// feels instant even though the command executes next tick. Tiny synth blips,
// no asset files. AudioContext is created lazily on first use (user gesture).

let ctx: AudioContext | null = null;

function audio(): AudioContext | null {
  if (typeof AudioContext === 'undefined') return null;
  ctx ??= new AudioContext();
  if (ctx.state === 'suspended') void ctx.resume();
  return ctx;
}

function tone(freq: number, startIn: number, duration: number, type: OscillatorType): void {
  const ac = audio();
  if (!ac) return;
  const t0 = ac.currentTime + startIn;
  const osc = ac.createOscillator();
  const gain = ac.createGain();
  osc.type = type;
  osc.frequency.value = freq;
  gain.gain.setValueAtTime(0.08, t0);
  gain.gain.exponentialRampToValueAtTime(0.001, t0 + duration);
  osc.connect(gain).connect(ac.destination);
  osc.start(t0);
  osc.stop(t0 + duration);
}

/** Order acknowledged: quick rising double-blip. */
export function blipOrder(): void {
  tone(660, 0, 0.06, 'square');
  tone(880, 0.05, 0.08, 'square');
}

/** Units selected: single soft blip. */
export function blipSelect(): void {
  tone(520, 0, 0.05, 'triangle');
}
