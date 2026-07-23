// Combat & event one-shots, all synthesized (no asset files), rate-limited so
// a big fight sounds like a fight instead of a modem.

let ctx: AudioContext | null = null;

function audio(): AudioContext | null {
  if (typeof AudioContext === 'undefined') return null;
  ctx ??= new AudioContext();
  if (ctx.state === 'suspended') void ctx.resume();
  return ctx;
}

const lastPlayed = new Map<string, number>();

function limited(key: string, ms: number): boolean {
  const now = performance.now();
  if ((lastPlayed.get(key) ?? 0) + ms > now) return true;
  lastPlayed.set(key, now);
  return false;
}

function env(ac: AudioContext, t0: number, peak: number, dur: number): GainNode {
  const g = ac.createGain();
  g.gain.setValueAtTime(peak, t0);
  g.gain.exponentialRampToValueAtTime(0.001, t0 + dur);
  g.connect(ac.destination);
  return g;
}

function osc(ac: AudioContext, type: OscillatorType, f0: number, f1: number, t0: number, dur: number, peak: number): void {
  const o = ac.createOscillator();
  o.type = type;
  o.frequency.setValueAtTime(f0, t0);
  if (f1 !== f0) o.frequency.exponentialRampToValueAtTime(Math.max(20, f1), t0 + dur);
  o.connect(env(ac, t0, peak, dur));
  o.start(t0);
  o.stop(t0 + dur);
}

function noise(ac: AudioContext, t0: number, dur: number, peak: number, filterHz: number, type: BiquadFilterType): void {
  const buf = ac.createBuffer(1, Math.ceil(ac.sampleRate * dur), ac.sampleRate);
  const data = buf.getChannelData(0);
  for (let i = 0; i < data.length; i++) data[i] = Math.random() * 2 - 1;
  const src = ac.createBufferSource();
  src.buffer = buf;
  const f = ac.createBiquadFilter();
  f.type = type;
  f.frequency.value = filterHz;
  src.connect(f).connect(env(ac, t0, peak, dur));
  src.start(t0);
}

export const sfx = {
  hit(): void {
    const ac = audio();
    if (!ac || limited('hit', 70)) return;
    noise(ac, ac.currentTime, 0.06, 0.1, 900, 'lowpass');
  },
  zap(): void {
    const ac = audio();
    if (!ac || limited('zap', 90)) return;
    osc(ac, 'square', 1900, 300, ac.currentTime, 0.07, 0.05);
  },
  /** Rage-quit: a record scratch and an indignant descending "ugh". */
  death(): void {
    const ac = audio();
    if (!ac || limited('death', 140)) return;
    const t = ac.currentTime;
    noise(ac, t, 0.08, 0.07, 2400, 'bandpass');
    osc(ac, 'sawtooth', 500, 140, t + 0.05, 0.16, 0.06);
  },
  /** Shut down by the city council: rumble + a little sad trombone slide. */
  raze(): void {
    const ac = audio();
    if (!ac || limited('raze', 400)) return;
    const t = ac.currentTime;
    noise(ac, t, 0.7, 0.22, 220, 'lowpass');
    osc(ac, 'sine', 120, 35, t, 0.7, 0.18);
    osc(ac, 'triangle', 220, 174, t + 0.15, 0.35, 0.08);
    osc(ac, 'triangle', 174, 146, t + 0.5, 0.45, 0.08);
  },
  airhorn(): void {
    const ac = audio();
    if (!ac || limited('airhorn', 500)) return;
    const t = ac.currentTime;
    for (const detune of [0, 8, -6]) {
      osc(ac, 'sawtooth', 440 + detune, 392 + detune, t, 0.5, 0.08);
    }
  },
  levelUp(): void {
    const ac = audio();
    if (!ac) return;
    const t = ac.currentTime;
    osc(ac, 'triangle', 523, 523, t, 0.1, 0.1);
    osc(ac, 'triangle', 659, 659, t + 0.09, 0.1, 0.1);
    osc(ac, 'triangle', 784, 784, t + 0.18, 0.16, 0.12);
  },
  drop(): void {
    const ac = audio();
    if (!ac) return;
    const t = ac.currentTime;
    noise(ac, t, 1.2, 0.3, 500, 'lowpass');
    osc(ac, 'sine', 200, 30, t, 1.0, 0.3);
  },
  stinger(win: boolean): void {
    const ac = audio();
    if (!ac) return;
    const t = ac.currentTime;
    const notes = win ? [392, 494, 587, 784] : [392, 370, 311, 233];
    notes.forEach((f, i) => osc(ac, 'triangle', f, f, t + i * 0.16, 0.3, 0.12));
  },
};
