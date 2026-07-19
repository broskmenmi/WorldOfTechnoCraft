// The soundtrack is synthesized at runtime — no asset files, and the mix IS
// game state: combat adds the acid line, high Heat adds distortion drive.
// 128 BPM four-on-the-floor, scheduled with a lookahead so it never stutters.

const BPM = 128;
const STEP = 60 / BPM / 4; // 16th note seconds
const LOOKAHEAD_S = 0.15;
const TICK_MS = 40;

/** 16-step acid bassline (semitone offsets from A1, -1 = rest). */
const BASS_PATTERN = [0, -1, 0, 12, 0, -1, 3, 0, 0, 12, -1, 0, 5, 3, 0, -1];
const ACID_PATTERN = [12, 15, 12, 19, 17, 15, 12, 24, 12, 15, 19, 12, 24, 22, 19, 15];

export class TechnoEngine {
  private ctx: AudioContext | null = null;
  private master: GainNode | null = null;
  private drive: WaveShaperNode | null = null;
  private nextStepTime = 0;
  private stepIndex = 0;
  private timer: ReturnType<typeof setInterval> | null = null;
  muted = false;
  /** 0 = ambient, 1 = +bass, 2 = +acid (combat), 3 = +overdrive (raid). */
  intensity = 1;

  /** Must be called from a user gesture at least once. */
  start(): void {
    if (this.ctx) return;
    this.ctx = new AudioContext();
    this.master = this.ctx.createGain();
    this.master.gain.value = 0.5;
    this.drive = this.ctx.createWaveShaper();
    this.setDrive(0);
    this.drive.connect(this.master).connect(this.ctx.destination);
    this.nextStepTime = this.ctx.currentTime + 0.05;
    this.timer = setInterval(() => this.schedule(), TICK_MS);
  }

  toggleMute(): void {
    this.muted = !this.muted;
    if (this.master) this.master.gain.value = this.muted ? 0 : 0.5;
  }

  /** Current beat phase 0..1 (for UI pulse sync). */
  beatPhase(): number {
    if (!this.ctx) return 0;
    return (this.ctx.currentTime % (STEP * 4)) / (STEP * 4);
  }

  private setDrive(amount: number): void {
    if (!this.drive) return;
    const curve = new Float32Array(256);
    for (let i = 0; i < 256; i++) {
      const x = (i / 128) - 1;
      curve[i] = amount > 0 ? Math.tanh(x * (1 + amount * 4)) : x;
    }
    this.drive.curve = curve;
  }

  private schedule(): void {
    const ctx = this.ctx;
    if (!ctx || this.muted) {
      if (ctx) this.nextStepTime = Math.max(this.nextStepTime, ctx.currentTime + 0.05);
      if (!this.muted) return;
    }
    if (!ctx) return;
    this.setDrive(this.intensity >= 3 ? 1 : 0);
    while (this.nextStepTime < ctx.currentTime + LOOKAHEAD_S) {
      this.playStep(this.stepIndex, this.nextStepTime);
      this.stepIndex = (this.stepIndex + 1) % 16;
      this.nextStepTime += STEP;
    }
  }

  private playStep(i: number, t: number): void {
    // Kick on every beat.
    if (i % 4 === 0) this.kick(t);
    // Offbeat hats.
    if (i % 4 === 2) this.hat(t);
    if (this.intensity >= 1) {
      const note = BASS_PATTERN[i]!;
      if (note >= 0) this.bass(t, 55 * Math.pow(2, note / 12));
    }
    if (this.intensity >= 2) {
      this.acid(t, 110 * Math.pow(2, ACID_PATTERN[i]! / 12));
    }
  }

  private kick(t: number): void {
    const ctx = this.ctx!;
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.frequency.setValueAtTime(150, t);
    osc.frequency.exponentialRampToValueAtTime(45, t + 0.09);
    gain.gain.setValueAtTime(1, t);
    gain.gain.exponentialRampToValueAtTime(0.001, t + 0.24);
    osc.connect(gain).connect(this.drive!);
    osc.start(t);
    osc.stop(t + 0.25);
  }

  private hat(t: number): void {
    const ctx = this.ctx!;
    const len = 0.04;
    const buf = ctx.createBuffer(1, Math.ceil(ctx.sampleRate * len), ctx.sampleRate);
    const data = buf.getChannelData(0);
    for (let i = 0; i < data.length; i++) data[i] = (Math.random() * 2 - 1) * (1 - i / data.length);
    const src = ctx.createBufferSource();
    src.buffer = buf;
    const hp = ctx.createBiquadFilter();
    hp.type = 'highpass';
    hp.frequency.value = 7000;
    const gain = ctx.createGain();
    gain.gain.value = 0.25;
    src.connect(hp).connect(gain).connect(this.drive!);
    src.start(t);
  }

  private bass(t: number, freq: number): void {
    const ctx = this.ctx!;
    const osc = ctx.createOscillator();
    osc.type = 'sawtooth';
    osc.frequency.value = freq;
    const lp = ctx.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.setValueAtTime(900, t);
    lp.frequency.exponentialRampToValueAtTime(250, t + STEP * 0.9);
    lp.Q.value = 6;
    const gain = ctx.createGain();
    gain.gain.setValueAtTime(0.22, t);
    gain.gain.exponentialRampToValueAtTime(0.001, t + STEP * 0.95);
    osc.connect(lp).connect(gain).connect(this.drive!);
    osc.start(t);
    osc.stop(t + STEP);
  }

  private acid(t: number, freq: number): void {
    const ctx = this.ctx!;
    const osc = ctx.createOscillator();
    osc.type = 'square';
    osc.frequency.value = freq;
    const lp = ctx.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.setValueAtTime(400 + 2400 * Math.abs(Math.sin(t * 2)), t);
    lp.Q.value = 12;
    const gain = ctx.createGain();
    gain.gain.setValueAtTime(0.09, t);
    gain.gain.exponentialRampToValueAtTime(0.001, t + STEP * 0.8);
    osc.connect(lp).connect(gain).connect(this.drive!);
    osc.start(t);
    osc.stop(t + STEP);
  }
}
