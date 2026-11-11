import type { BodyKind, SfxName } from './types';
import type { Settings } from './persistence';

type Wave = OscillatorType;

const DRONE_ROOT: Record<BodyKind | 'menu', number> = {
  menu: 55,
  planet: 55,
  star: 46.25,
  neutron: 73.42,
  blackhole: 41.2,
  gasgiant: 61.74,
  smallbody: 65.41,
};

/**
 * Procedural retro sound effects built on the Web Audio API.
 * The AudioContext is only created after a user gesture (autoplay policy).
 */
export class AudioManager {
  private ctx: AudioContext | null = null;
  private master: GainNode | null = null;
  private sfxBus: GainNode | null = null;
  private ambBus: GainNode | null = null;
  private noiseBuf: AudioBuffer | null = null;
  private thrustGain: GainNode | null = null;
  private thrustFilter: BiquadFilterNode | null = null;
  private droneOscs: OscillatorNode[] = [];
  private droneFilter: BiquadFilterNode | null = null;
  private droneGain: GainNode | null = null;
  private settings: Settings | null = null;
  private last = new Map<SfxName, number>();
  private droneKind: BodyKind | 'menu' = 'menu';
  private ambienceLevel = 1;

  get ready(): boolean {
    return this.ctx !== null;
  }

  /** Must be called from a user gesture handler. Safe to call repeatedly. */
  unlock(): void {
    if (this.ctx) {
      if (this.ctx.state === 'suspended') void this.ctx.resume().catch(() => undefined);
      return;
    }
    const AC: typeof AudioContext | undefined =
      window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!AC) return;
    try {
      this.ctx = new AC();
    } catch {
      this.ctx = null;
      return;
    }
    const ctx = this.ctx;
    const comp = ctx.createDynamicsCompressor();
    comp.threshold.value = -14;
    comp.ratio.value = 4;
    comp.connect(ctx.destination);
    this.master = ctx.createGain();
    this.master.connect(comp);
    this.sfxBus = ctx.createGain();
    this.sfxBus.connect(this.master);
    this.ambBus = ctx.createGain();
    this.ambBus.connect(this.master);

    // Shared white-noise buffer.
    const len = ctx.sampleRate * 2;
    this.noiseBuf = ctx.createBuffer(1, len, ctx.sampleRate);
    const data = this.noiseBuf.getChannelData(0);
    for (let i = 0; i < len; i++) data[i] = Math.random() * 2 - 1;

    // Continuous engine rumble, gated by thrust level.
    const src = ctx.createBufferSource();
    src.buffer = this.noiseBuf;
    src.loop = true;
    this.thrustFilter = ctx.createBiquadFilter();
    this.thrustFilter.type = 'bandpass';
    this.thrustFilter.frequency.value = 260;
    this.thrustFilter.Q.value = 1.4;
    this.thrustGain = ctx.createGain();
    this.thrustGain.gain.value = 0;
    src.connect(this.thrustFilter).connect(this.thrustGain).connect(this.sfxBus);
    src.start();

    // Ambient drone.
    this.droneFilter = ctx.createBiquadFilter();
    this.droneFilter.type = 'lowpass';
    this.droneFilter.frequency.value = 420;
    this.droneFilter.Q.value = 2;
    this.droneGain = ctx.createGain();
    this.droneGain.gain.value = 0;
    this.droneFilter.connect(this.droneGain).connect(this.ambBus);
    const ratios = [1, 1.5, 2.003];
    for (const r of ratios) {
      const o = ctx.createOscillator();
      o.type = r === 1 ? 'triangle' : 'sine';
      o.frequency.value = DRONE_ROOT[this.droneKind] * r;
      o.connect(this.droneFilter);
      o.start();
      this.droneOscs.push(o);
    }
    const lfo = ctx.createOscillator();
    lfo.frequency.value = 0.07;
    const lfoGain = ctx.createGain();
    lfoGain.gain.value = 160;
    lfo.connect(lfoGain).connect(this.droneFilter.frequency);
    lfo.start();
    this.droneGain.gain.setTargetAtTime(0.06, ctx.currentTime, 1.5);

    if (this.settings) this.applySettings(this.settings);
  }

  applySettings(s: Settings): void {
    this.settings = s;
    if (!this.ctx || !this.master || !this.sfxBus || !this.ambBus) return;
    const t = this.ctx.currentTime;
    const vol = s.muted ? 0 : s.masterVolume * s.masterVolume;
    this.master.gain.setTargetAtTime(vol, t, 0.03);
    this.sfxBus.gain.setTargetAtTime(s.sfx ? 1 : 0, t, 0.03);
    this.ambBus.gain.setTargetAtTime(s.ambience ? this.ambienceLevel : 0, t, 0.3);
  }

  /** Lower the ambience while paused / in menus. */
  setAmbienceLevel(level: number): void {
    this.ambienceLevel = level;
    if (this.settings) this.applySettings(this.settings);
  }

  setDrone(kind: BodyKind | 'menu'): void {
    this.droneKind = kind;
    if (!this.ctx) return;
    const root = DRONE_ROOT[kind];
    const ratios = [1, 1.5, 2.003];
    this.droneOscs.forEach((o, i) => o.frequency.setTargetAtTime(root * ratios[i], this.ctx!.currentTime, 0.8));
  }

  setThrust(amount: number, pitch = 1): void {
    if (!this.ctx || !this.thrustGain || !this.thrustFilter) return;
    const t = this.ctx.currentTime;
    this.thrustGain.gain.setTargetAtTime(Math.min(1, amount) * 0.22, t, 0.04);
    this.thrustFilter.frequency.setTargetAtTime(200 + 220 * pitch, t, 0.08);
  }

  suspend(): void {
    this.setThrust(0);
  }

  destroy(): void {
    if (this.ctx) void this.ctx.close().catch(() => undefined);
    this.ctx = null;
    this.droneOscs = [];
  }

  private tone(type: Wave, f0: number, f1: number, dur: number, vol: number, delay = 0): void {
    const ctx = this.ctx;
    if (!ctx || !this.sfxBus) return;
    const t = ctx.currentTime + delay;
    const o = ctx.createOscillator();
    const g = ctx.createGain();
    o.type = type;
    o.frequency.setValueAtTime(f0, t);
    if (f1 !== f0) o.frequency.exponentialRampToValueAtTime(Math.max(20, f1), t + dur);
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(vol, t + 0.006);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.connect(g).connect(this.sfxBus);
    o.start(t);
    o.stop(t + dur + 0.02);
  }

  private noise(dur: number, type: BiquadFilterType, f0: number, f1: number, vol: number, delay = 0, q = 1): void {
    const ctx = this.ctx;
    if (!ctx || !this.sfxBus || !this.noiseBuf) return;
    const t = ctx.currentTime + delay;
    const src = ctx.createBufferSource();
    src.buffer = this.noiseBuf;
    const f = ctx.createBiquadFilter();
    f.type = type;
    f.Q.value = q;
    f.frequency.setValueAtTime(f0, t);
    f.frequency.exponentialRampToValueAtTime(Math.max(20, f1), t + dur);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(vol, t + 0.008);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    src.connect(f).connect(g).connect(this.sfxBus);
    src.start(t, Math.random() * 1.5);
    src.stop(t + dur + 0.02);
  }

  play(name: SfxName, intensity = 1): void {
    if (!this.ctx || this.ctx.state !== 'running') return;
    const now = this.ctx.currentTime;
    const minGap: Partial<Record<SfxName, number>> = {
      energy: 0.025,
      heat: 0.18,
      beam: 0.3,
      hover: 0.04,
      destroy: 0.04,
      nearmiss: 0.1,
      warning: 0.25,
    };
    const gap = minGap[name] ?? 0.02;
    const prev = this.last.get(name) ?? -1;
    if (now - prev < gap) return;
    this.last.set(name, now);

    switch (name) {
      case 'collide':
        this.noise(0.38, 'lowpass', 1400, 160, 0.55);
        this.tone('square', 120, 38, 0.3, 0.28);
        break;
      case 'destroy':
        this.noise(0.22, 'bandpass', 2200, 380, 0.4, 0, 0.8);
        this.tone('square', 260, 70, 0.16, 0.12);
        break;
      case 'explode':
        this.noise(1.1, 'lowpass', 1000, 60, 0.7);
        this.tone('sawtooth', 90, 28, 0.9, 0.3);
        this.tone('square', 180, 40, 0.5, 0.12, 0.05);
        break;
      case 'energy': {
        const f = 740 * Math.pow(2, Math.min(intensity, 14) / 12);
        this.tone('square', f, f, 0.05, 0.09);
        this.tone('square', f * 1.5, f * 1.5, 0.06, 0.06, 0.045);
        break;
      }
      case 'upgrade':
        [523.25, 659.25, 783.99, 1046.5, 1318.5].forEach((f, i) => this.tone('triangle', f, f, 0.12, 0.2, i * 0.055));
        this.noise(0.4, 'highpass', 3000, 8000, 0.08, 0.1);
        break;
      case 'offer':
        this.tone('square', 660, 660, 0.07, 0.12);
        this.tone('square', 990, 990, 0.1, 0.12, 0.08);
        break;
      case 'level':
        this.noise(1.3, 'bandpass', 250, 3800, 0.3, 0, 2);
        [220, 329.63, 440].forEach((f) => this.tone('triangle', f, f * 2, 1.2, 0.08, 0.1));
        break;
      case 'clear':
        [659.25, 783.99, 987.77, 1318.5].forEach((f, i) => this.tone('square', f, f, 0.1, 0.1, i * 0.08));
        break;
      case 'gameover':
        [440, 349.23, 293.66, 196].forEach((f, i) => this.tone('square', f, f * 0.98, 0.22, 0.16, 0.25 + i * 0.2));
        this.tone('triangle', 98, 49, 1.4, 0.2, 0.25);
        break;
      case 'boost':
        this.noise(0.35, 'highpass', 600, 4200, 0.28);
        this.tone('sawtooth', 180, 720, 0.22, 0.1);
        break;
      case 'warning':
        this.tone('square', 880, 880, 0.07, 0.1);
        this.tone('square', 880, 880, 0.07, 0.1, 0.12);
        break;
      case 'critical':
        this.tone('square', 330, 320, 0.11, 0.13);
        this.tone('square', 330, 320, 0.11, 0.13, 0.16);
        break;
      case 'click':
        this.tone('square', 1200, 900, 0.035, 0.07);
        break;
      case 'hover':
        this.tone('square', 1800, 1800, 0.015, 0.025);
        break;
      case 'nearmiss':
        this.noise(0.16, 'bandpass', 3200, 1400, 0.18, 0, 1.5);
        this.tone('triangle', 1320, 1760, 0.09, 0.08);
        break;
      case 'shield':
        this.tone('sine', 1400, 280, 0.32, 0.25);
        this.noise(0.25, 'highpass', 2000, 6000, 0.15);
        break;
      case 'flare':
        this.noise(0.7, 'lowpass', 300, 1800, 0.28);
        break;
      case 'beam':
        this.tone('sawtooth', 1600, 1300, 0.28, 0.05);
        break;
      case 'wave':
        this.tone('sine', 95, 38, 0.7, 0.4);
        this.noise(0.5, 'lowpass', 500, 80, 0.18);
        break;
      case 'temporal':
        this.tone('sine', 900, 220, 0.6, 0.18);
        this.tone('triangle', 450, 110, 0.7, 0.1, 0.05);
        break;
      case 'heat':
        this.noise(0.12, 'lowpass', 700, 300, 0.1);
        break;
    }
  }
}
