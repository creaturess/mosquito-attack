/**
 * SpatialBuzzManager.ts
 * Synthesizes procedural 3D spatial buzzing for mosquitoes and swat SFX using Web Audio API.
 */

export class SpatialBuzzManager {
  private ctx: AudioContext | null = null;
  private masterGain: GainNode | null = null;
  private activeVoices: Map<string, {
    osc: OscillatorNode;
    modOsc: OscillatorNode;
    gain: GainNode;
    panner: PannerNode;
    filter: BiquadFilterNode;
  }> = new Map();

  private isMuted: boolean = false;

  constructor() {
    // Lazy initialized on user gesture
  }

  public init(): AudioContext {
    if (!this.ctx) {
      const AudioCtx = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
      this.ctx = new AudioCtx();
      this.masterGain = this.ctx.createGain();
      this.masterGain.gain.setValueAtTime(0.7, this.ctx.currentTime);
      this.masterGain.connect(this.ctx.destination);
    }
    if (this.ctx.state === 'suspended') {
      this.ctx.resume();
    }
    return this.ctx;
  }

  public getAudioContext(): AudioContext | null {
    return this.ctx;
  }

  public setMuted(muted: boolean) {
    this.isMuted = muted;
    if (this.masterGain && this.ctx) {
      this.masterGain.gain.setValueAtTime(muted ? 0 : 0.7, this.ctx.currentTime);
    }
  }

  /**
   * Starts or updates buzzing sound for a specific mosquito ID at (x, y, z) in camera relative coordinates
   */
  public updateMosquitoBuzz(
    id: string,
    relX: number,
    relY: number,
    relZ: number,
    isBoss: boolean = false,
    speedFactor: number = 1.0
  ) {
    if (!this.ctx || this.isMuted) return;

    const distance = Math.max(0.5, Math.sqrt(relX * relX + relY * relY + relZ * relZ));
    // Volume attenuation based on distance (closer = louder and more annoying)
    const baseVolume = isBoss ? 0.45 : 0.22;
    const distanceGain = Math.min(1.0, baseVolume / (distance * 0.45 + 0.3));

    let voice = this.activeVoices.get(id);

    if (!voice) {
      // Create new spatial voice
      const osc = this.ctx.createOscillator();
      const modOsc = this.ctx.createOscillator();
      const modGain = this.ctx.createGain();
      const filter = this.ctx.createBiquadFilter();
      const gain = this.ctx.createGain();
      const panner = this.ctx.createPanner();

      // Configure spatial panner
      panner.panningModel = 'HRTF';
      panner.distanceModel = 'exponential';
      panner.refDistance = 1;
      panner.maxDistance = 30;
      panner.rolloffFactor = 1.2;
      panner.coneInnerAngle = 360;

      // Mosquito frequencies: Regular is high pitched nasal (~520Hz - 680Hz). Boss is deep ominous thrum (~180Hz - 240Hz).
      const baseFreq = isBoss ? (180 + Math.random() * 40) : (500 + Math.random() * 120 * speedFactor);
      osc.type = isBoss ? 'sawtooth' : 'triangle';
      osc.frequency.setValueAtTime(baseFreq, this.ctx.currentTime);

      // Wing flap modulation LFO
      modOsc.type = 'sawtooth';
      modOsc.frequency.setValueAtTime(isBoss ? 80 : (240 + Math.random() * 60), this.ctx.currentTime);
      modGain.gain.setValueAtTime(isBoss ? 35 : 55, this.ctx.currentTime);

      // Connect LFO to main oscillator frequency for wing-flutter vibrato
      modOsc.connect(modGain);
      modGain.connect(osc.frequency);

      // Bandpass filter to create resonant "mosquito whine"
      filter.type = 'bandpass';
      filter.frequency.setValueAtTime(isBoss ? 800 : 1800, this.ctx.currentTime);
      filter.Q.setValueAtTime(2.5, this.ctx.currentTime);

      gain.gain.setValueAtTime(0.01, this.ctx.currentTime);
      gain.gain.linearRampToValueAtTime(distanceGain, this.ctx.currentTime + 0.1);

      // Routing: osc -> filter -> gain -> panner -> masterGain
      osc.connect(filter);
      filter.connect(gain);
      gain.connect(panner);
      if (this.masterGain) {
        panner.connect(this.masterGain);
      }

      osc.start();
      modOsc.start();

      voice = { osc, modOsc, gain, panner, filter };
      this.activeVoices.set(id, voice);
    }

    // Update positions and volumes
    if (this.ctx && voice) {
      voice.panner.setPosition(relX, relY, relZ);
      voice.gain.gain.setValueAtTime(Math.max(0.001, distanceGain), this.ctx.currentTime);
    }
  }

  /**
   * Stop buzzing for a specific mosquito
   */
  public stopMosquitoBuzz(id: string) {
    const voice = this.activeVoices.get(id);
    if (!voice || !this.ctx) return;

    try {
      voice.gain.gain.linearRampToValueAtTime(0.001, this.ctx.currentTime + 0.05);
      setTimeout(() => {
        try {
          voice.osc.stop();
          voice.modOsc.stop();
          voice.osc.disconnect();
          voice.modOsc.disconnect();
          voice.filter.disconnect();
          voice.gain.disconnect();
          voice.panner.disconnect();
        } catch {
          // ignore
        }
      }, 60);
    } catch {
      // ignore
    }
    this.activeVoices.delete(id);
  }

  /**
   * Stop all active buzzing sounds
   */
  public stopAll() {
    this.activeVoices.forEach((_, id) => {
      this.stopMosquitoBuzz(id);
    });
    this.activeVoices.clear();
  }

  /**
   * Play swat slap sound effect
   */
  public playSwatSfx(isCritical: boolean = false) {
    if (!this.ctx || this.isMuted) return;

    const t = this.ctx.currentTime;
    
    // Slap noise burst
    const bufferSize = this.ctx.sampleRate * 0.12;
    const noiseBuffer = this.ctx.createBuffer(1, bufferSize, this.ctx.sampleRate);
    const output = noiseBuffer.getChannelData(0);
    for (let i = 0; i < bufferSize; i++) {
      output[i] = Math.random() * 2 - 1;
    }

    const whiteNoise = this.ctx.createBufferSource();
    whiteNoise.buffer = noiseBuffer;

    const filter = this.ctx.createBiquadFilter();
    filter.type = 'lowpass';
    filter.frequency.setValueAtTime(1400, t);
    filter.frequency.exponentialRampToValueAtTime(200, t + 0.08);

    const gain = this.ctx.createGain();
    gain.gain.setValueAtTime(isCritical ? 0.9 : 0.6, t);
    gain.gain.exponentialRampToValueAtTime(0.001, t + 0.1);

    whiteNoise.connect(filter);
    filter.connect(gain);
    if (this.masterGain) gain.connect(this.masterGain);

    whiteNoise.start(t);

    // Punchy low pop
    const popOsc = this.ctx.createOscillator();
    const popGain = this.ctx.createGain();
    popOsc.type = 'sine';
    popOsc.frequency.setValueAtTime(isCritical ? 140 : 180, t);
    popOsc.frequency.exponentialRampToValueAtTime(40, t + 0.09);

    popGain.gain.setValueAtTime(0.5, t);
    popGain.gain.exponentialRampToValueAtTime(0.001, t + 0.09);

    popOsc.connect(popGain);
    if (this.masterGain) popGain.connect(this.masterGain);

    popOsc.start(t);
    popOsc.stop(t + 0.1);
  }

  /**
   * Play Boss damage / scream hit sound
   */
  public playBossHurtSfx() {
    if (!this.ctx || this.isMuted) return;
    const t = this.ctx.currentTime;

    const osc = this.ctx.createOscillator();
    const gain = this.ctx.createGain();
    osc.type = 'sawtooth';
    osc.frequency.setValueAtTime(320, t);
    osc.frequency.linearRampToValueAtTime(90, t + 0.25);

    gain.gain.setValueAtTime(0.4, t);
    gain.gain.exponentialRampToValueAtTime(0.001, t + 0.25);

    osc.connect(gain);
    if (this.masterGain) gain.connect(this.masterGain);
    osc.start(t);
    osc.stop(t + 0.26);
  }

  /**
   * Play victory fanfare
   */
  public playVictorySfx() {
    if (!this.ctx || this.isMuted) return;
    const notes = [261.63, 329.63, 392.00, 523.25];
    notes.forEach((freq, idx) => {
      const t = this.ctx!.currentTime + idx * 0.12;
      const osc = this.ctx!.createOscillator();
      const gain = this.ctx!.createGain();
      osc.type = 'triangle';
      osc.frequency.setValueAtTime(freq, t);
      gain.gain.setValueAtTime(0.4, t);
      gain.gain.exponentialRampToValueAtTime(0.001, t + 0.35);
      osc.connect(gain);
      if (this.masterGain) gain.connect(this.masterGain);
      osc.start(t);
      osc.stop(t + 0.36);
    });
  }

  /**
   * Play defeat sound
   */
  public playDefeatSfx() {
    if (!this.ctx || this.isMuted) return;
    const notes = [300, 260, 220, 160];
    notes.forEach((freq, idx) => {
      const t = this.ctx!.currentTime + idx * 0.15;
      const osc = this.ctx!.createOscillator();
      const gain = this.ctx!.createGain();
      osc.type = 'sawtooth';
      osc.frequency.setValueAtTime(freq, t);
      gain.gain.setValueAtTime(0.35, t);
      gain.gain.exponentialRampToValueAtTime(0.001, t + 0.25);
      osc.connect(gain);
      if (this.masterGain) gain.connect(this.masterGain);
      osc.start(t);
      osc.stop(t + 0.26);
    });
  }
}

export const buzzManager = new SpatialBuzzManager();
