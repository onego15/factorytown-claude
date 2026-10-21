// Procedural audio: UI and world sound effects, gentle generative music and ambience. No asset files.

type Sfx = 'click' | 'place' | 'belt' | 'remove' | 'error' | 'coin' | 'research' | 'milestone' | 'upgrade' | 'house' | 'open' | 'rotate';

const PENTA = [0, 2, 4, 7, 9, 12, 14, 16, 19, 21];

export class AudioEngine {
  ctx: AudioContext | null = null;
  private master!: GainNode;
  private sfxGain!: GainNode;
  private musicGain!: GainNode;
  private ambGain!: GainNode;
  private reverb!: ConvolverNode;
  private noiseBuf!: AudioBuffer;
  private nextNote = 0;
  private chordIdx = 0;
  private lastSfx = new Map<string, number>();
  volumes = { master: 0.8, music: 0.5, sfx: 0.8 };
  night = 0;

  init() {
    if (this.ctx) {
      if (this.ctx.state === 'suspended') this.ctx.resume();
      return;
    }
    const AC = window.AudioContext || (window as any).webkitAudioContext;
    if (!AC) return;
    const ctx = new AC();
    this.ctx = ctx;
    this.master = ctx.createGain();
    this.master.connect(ctx.destination);
    this.sfxGain = ctx.createGain();
    this.musicGain = ctx.createGain();
    this.ambGain = ctx.createGain();
    this.reverb = ctx.createConvolver();
    this.reverb.buffer = this.impulse(2.8);
    const revOut = ctx.createGain();
    revOut.gain.value = 0.5;
    this.reverb.connect(revOut);
    revOut.connect(this.master);
    this.sfxGain.connect(this.master);
    this.musicGain.connect(this.master);
    this.musicGain.connect(this.reverb);
    this.ambGain.connect(this.master);
    this.noiseBuf = ctx.createBuffer(1, ctx.sampleRate * 2, ctx.sampleRate);
    const d = this.noiseBuf.getChannelData(0);
    for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
    this.applyVolumes();
    this.startWind();
    this.nextNote = ctx.currentTime + 0.5;
  }

  applyVolumes() {
    if (!this.ctx) return;
    this.master.gain.value = this.volumes.master;
    this.sfxGain.gain.value = this.volumes.sfx * 0.9;
    this.musicGain.gain.value = this.volumes.music * 0.35;
    this.ambGain.gain.value = this.volumes.sfx * 0.25;
  }

  private impulse(sec: number) {
    const ctx = this.ctx!;
    const len = ctx.sampleRate * sec;
    const b = ctx.createBuffer(2, len, ctx.sampleRate);
    for (let c = 0; c < 2; c++) {
      const d = b.getChannelData(c);
      for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / len, 2.6);
    }
    return b;
  }

  private startWind() {
    const ctx = this.ctx!;
    const src = ctx.createBufferSource();
    src.buffer = this.noiseBuf;
    src.loop = true;
    const f = ctx.createBiquadFilter();
    f.type = 'lowpass';
    f.frequency.value = 400;
    const g = ctx.createGain();
    g.gain.value = 0.12;
    const lfo = ctx.createOscillator();
    lfo.frequency.value = 0.07;
    const lg = ctx.createGain();
    lg.gain.value = 180;
    lfo.connect(lg);
    lg.connect(f.frequency);
    src.connect(f);
    f.connect(g);
    g.connect(this.ambGain);
    src.start();
    lfo.start();
  }

  private tone(freq: number, t: number, dur: number, type: OscillatorType, vol: number, dest: AudioNode, attack = 0.005, bend = 0) {
    const ctx = this.ctx!;
    const o = ctx.createOscillator();
    o.type = type;
    o.frequency.setValueAtTime(freq, t);
    if (bend) o.frequency.exponentialRampToValueAtTime(Math.max(20, freq * bend), t + dur);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(vol, t + attack);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.connect(g);
    g.connect(dest);
    o.start(t);
    o.stop(t + dur + 0.05);
  }

  private noise(t: number, dur: number, vol: number, freq: number, q = 1, type: BiquadFilterType = 'bandpass') {
    const ctx = this.ctx!;
    const s = ctx.createBufferSource();
    s.buffer = this.noiseBuf;
    const f = ctx.createBiquadFilter();
    f.type = type;
    f.frequency.value = freq;
    f.Q.value = q;
    const g = ctx.createGain();
    g.gain.setValueAtTime(vol, t);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    s.connect(f);
    f.connect(g);
    g.connect(this.sfxGain);
    s.start(t, Math.random());
    s.stop(t + dur + 0.05);
  }

  play(name: Sfx) {
    if (!this.ctx) return;
    const ctx = this.ctx;
    const now = ctx.currentTime;
    const last = this.lastSfx.get(name) ?? 0;
    if (now - last < (name === 'belt' ? 0.05 : name === 'coin' ? 0.12 : 0.03)) return;
    this.lastSfx.set(name, now);
    const out = this.sfxGain;
    switch (name) {
      case 'click':
        this.tone(1250, now, 0.05, 'sine', 0.18, out);
        break;
      case 'open':
        this.tone(660, now, 0.08, 'sine', 0.12, out);
        this.tone(990, now + 0.04, 0.1, 'sine', 0.1, out);
        break;
      case 'rotate':
        this.tone(520, now, 0.06, 'triangle', 0.15, out, 0.005, 1.4);
        break;
      case 'place':
        this.noise(now, 0.12, 0.5, 900, 0.8);
        this.tone(140, now, 0.18, 'sine', 0.45, out, 0.002, 0.6);
        this.tone(420, now + 0.03, 0.12, 'triangle', 0.12, out);
        break;
      case 'belt':
        this.noise(now, 0.05, 0.25, 2200, 2);
        this.tone(300 + Math.random() * 40, now, 0.06, 'triangle', 0.12, out);
        break;
      case 'remove':
        this.noise(now, 0.2, 0.35, 600, 0.6);
        this.tone(330, now, 0.18, 'triangle', 0.18, out, 0.003, 0.5);
        break;
      case 'error':
        this.tone(190, now, 0.1, 'square', 0.07, out);
        this.tone(150, now + 0.11, 0.14, 'square', 0.07, out);
        break;
      case 'coin':
        this.tone(1568, now, 0.18, 'sine', 0.08, out);
        this.tone(2093, now + 0.06, 0.25, 'sine', 0.07, out);
        break;
      case 'upgrade':
        [523, 659, 784, 1047].forEach((f, i) => this.tone(f, now + i * 0.07, 0.35, 'triangle', 0.14, out));
        break;
      case 'house':
        [784, 988, 1175].forEach((f, i) => this.tone(f, now + i * 0.06, 0.3, 'sine', 0.1, out));
        break;
      case 'research':
        [523, 659, 784, 988, 1175].forEach((f, i) => this.tone(f, now + i * 0.09, 0.6, 'sine', 0.12, out));
        this.tone(262, now, 1.2, 'triangle', 0.1, out, 0.05);
        break;
      case 'milestone': {
        const seq = [523, 659, 784, 1047, 784, 1047, 1319];
        seq.forEach((f, i) => this.tone(f, now + i * 0.12, 0.5, 'triangle', 0.15, out));
        [262, 330, 392, 523].forEach((f) => this.tone(f, now + 0.85, 1.8, 'sine', 0.1, out, 0.05));
        break;
      }
    }
  }

  /** Called every frame: schedules soft generative music and day/night ambience. */
  update(running: boolean) {
    if (!this.ctx || this.ctx.state !== 'running') return;
    const ctx = this.ctx;
    const now = ctx.currentTime;
    while (this.nextNote < now + 0.3) {
      const t = this.nextNote;
      const roots = [57, 53, 60, 55]; // A F C G — warm, slightly wistful
      const beat = Math.floor(this.nextNote / 0.5) % 16;
      if (beat === 0) this.chordIdx = (this.chordIdx + 1) % roots.length;
      const root = roots[this.chordIdx];
      const mtof = (m: number) => 440 * Math.pow(2, (m - 69) / 12);
      if (beat % 8 === 0) {
        // soft pad chord
        for (const iv of [0, 7, 16]) this.tone(mtof(root - 12 + iv), t, 3.6, 'sine', 0.05, this.musicGain, 0.8);
      }
      if (Math.random() < (running ? 0.55 : 0.3)) {
        const n = PENTA[Math.floor(Math.random() * PENTA.length)];
        const m = root + n + (this.night > 0.5 ? -12 : 0);
        this.tone(mtof(m), t, 1.4, 'triangle', 0.06 + Math.random() * 0.03, this.musicGain, 0.01);
        if (Math.random() < 0.25) this.tone(mtof(m + 12), t + 0.25, 1.0, 'sine', 0.03, this.musicGain, 0.01);
      }
      // ambience: birds by day, crickets at night
      if (this.night < 0.5 && Math.random() < 0.06) this.chirp(t);
      if (this.night > 0.5 && Math.random() < 0.25) this.cricket(t);
      this.nextNote += 0.5;
    }
  }

  private chirp(t: number) {
    const base = 2600 + Math.random() * 1600;
    const n = 2 + Math.floor(Math.random() * 3);
    for (let i = 0; i < n; i++) this.tone(base * (1 + Math.random() * 0.15), t + i * 0.09, 0.07, 'sine', 0.035, this.ambGain, 0.005, 1.3);
  }
  private cricket(t: number) {
    for (let i = 0; i < 3; i++) this.tone(4200, t + i * 0.05, 0.03, 'square', 0.006, this.ambGain);
  }
}

export const audio = new AudioEngine();
