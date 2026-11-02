/**
 * SpatialBuzzManager.ts
 * Synthesizes ultra-realistic 3D spatial mosquito buzzing matching the uploaded audio recording.
 * Features:
 * - Authentic dual-oscillator wing tone + nasal formant filtering + waveshaper buzz saturation
 * - High-speed wing-flutter vibrato (~380Hz) and organic wandering pitch swoops
 * - High-fidelity distance-reactive intensity curve (piercing loud in-ear buzz when close, muffled when far)
 * - 3D HRTF spatial panner following player phone orientation and position
 */

import { GAMEPLAY_CONFIG } from '../config/gameplayConfig';

export class SpatialBuzzManager {
  private ctx: AudioContext | null = null;
  private masterGain: GainNode | null = null;
  private distortionCurve: Float32Array<ArrayBuffer> | null = null;

  private activeVoices: Map<
    string,
    {
      oscPrimary: OscillatorNode;
      oscHarmonic: OscillatorNode;
      lfoFlutter: OscillatorNode;
      lfoFlutterGain: GainNode;
      lfoWander: OscillatorNode;
      lfoWanderGain: GainNode;
      shaper: WaveShaperNode;
      lowpassFilter: BiquadFilterNode;
      peakingFilter: BiquadFilterNode;
      gain: GainNode;
      panner: PannerNode;
      baseFreq: number;
    }
  > = new Map();

  private isMuted: boolean = false;

  constructor() {
    // Lazy initialized on user gesture
  }

  public init(): AudioContext {
    if (!this.ctx) {
      const AudioCtx =
        window.AudioContext ||
        (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
      this.ctx = new AudioCtx();
      this.masterGain = this.ctx.createGain();
      this.masterGain.gain.setValueAtTime(1.2, this.ctx.currentTime);
      this.masterGain.connect(this.ctx.destination);
      this.distortionCurve = this.createDistortionCurve(18);
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
      this.masterGain.gain.setValueAtTime(muted ? 0 : 1.2, this.ctx.currentTime);
    }
  }

  /**
   * Generates a soft-saturation curve for realistic insect chitin and wing rasp
   */
  private createDistortionCurve(amount: number = 18): Float32Array<ArrayBuffer> {
    const k = amount;
    const n_samples = 44100;
    const curve = new Float32Array(n_samples);
    const deg = Math.PI / 180;
    for (let i = 0; i < n_samples; ++i) {
      const x = (i * 2) / n_samples - 1;
      curve[i] = ((3 + k) * x * 20 * deg) / (Math.PI + k * Math.abs(x));
    }
    return curve;
  }

  /**
   * Starts or updates buzzing sound for a specific mosquito ID at (x, y, z) in camera relative coordinates.
   * High-contrast, piercing, unmistakable mosquito whine across all levels,
   * plus a deep thrumming acoustic vibration for the Level 3 boss.
   */
  public updateMosquitoBuzz(
    id: string,
    relX: number,
    relY: number,
    relZ: number,
    isBoss: boolean = false,
    speedFactor: number = 1.0,
    speedRatio: number = 1.0
  ) {
    if (!this.ctx || this.isMuted) return;

    // The Level 3 Boss mosquito is completely silent (no buzzing noise)
    if (isBoss) {
      if (this.activeVoices.has(id)) {
        this.stopMosquitoBuzz(id);
      }
      return;
    }

    const now = this.ctx.currentTime;
    const distance = Math.max(0.25, Math.sqrt(relX * relX + relY * relY + relZ * relZ));

    // High, prominent distance gain curve: stays loud and crisp across entire play space
    const distNorm = Math.max(0, Math.min(1, (13.0 - distance) / 12.0));
    let distanceGain = isBoss
      ? 1.15
      : Math.pow(distNorm, 0.7) * 1.05 + 0.22;

    let voice = this.activeVoices.get(id);

    if (!voice) {
      const oscPrimary = this.ctx.createOscillator();
      const oscHarmonic = this.ctx.createOscillator();
      const lfoFlutter = this.ctx.createOscillator();
      const lfoFlutterGain = this.ctx.createGain();
      const lfoWander = this.ctx.createOscillator();
      const lfoWanderGain = this.ctx.createGain();
      const shaper = this.ctx.createWaveShaper();
      const lowpassFilter = this.ctx.createBiquadFilter();
      const peakingFilter = this.ctx.createBiquadFilter();
      const gain = this.ctx.createGain();
      const panner = this.ctx.createPanner();

      // Configure HRTF spatial panner with gentle rolloff to preserve clear volume
      panner.panningModel = 'HRTF';
      panner.distanceModel = 'inverse';
      panner.refDistance = 3.5;
      panner.maxDistance = 30;
      panner.rolloffFactor = isBoss ? 0.25 : 0.42;
      panner.coneInnerAngle = 360;

      // Base Frequency:
      // - Normal mosquitoes: ~640Hz - 750Hz sharp nasal buzz
      // - Boss: Deep 110Hz thrumming drone with 55Hz sub-vibration
      const baseFreq = isBoss
        ? 110 + Math.random() * 8
        : (speedFactor > 1.1 ? 740 + (Math.random() - 0.5) * 45 : 640 + (Math.random() - 0.5) * 35);

      oscPrimary.type = 'sawtooth';
      oscPrimary.frequency.setValueAtTime(baseFreq, now);

      // Harmonic / Sub-harmonic oscillator
      // For boss: 0.5x sub-harmonic (55Hz) creates intense deep acoustic rumble
      oscHarmonic.type = isBoss ? 'sawtooth' : 'triangle';
      oscHarmonic.frequency.setValueAtTime(isBoss ? baseFreq * 0.5 : baseFreq * 2.01, now);

      // Fast Wing-Flutter Vibrato LFO:
      // For boss: 26Hz heavy vibration modulation
      lfoFlutter.type = 'sawtooth';
      lfoFlutter.frequency.setValueAtTime(isBoss ? 26 : (speedFactor > 1.1 ? 460 : 390) + Math.random() * 30, now);
      lfoFlutterGain.gain.setValueAtTime(isBoss ? 75 : (speedFactor > 1.1 ? 85 : 72), now);

      lfoFlutter.connect(lfoFlutterGain);
      lfoFlutterGain.connect(oscPrimary.frequency);
      lfoFlutterGain.connect(oscHarmonic.frequency);

      // Pitch wander LFO
      lfoWander.type = 'sine';
      lfoWander.frequency.setValueAtTime(isBoss ? 1.2 : 2.0 + Math.random() * 2.0, now);
      lfoWanderGain.gain.setValueAtTime(isBoss ? 15 : 35, now);

      lfoWander.connect(lfoWanderGain);
      lfoWanderGain.connect(oscPrimary.frequency);

      // Waveshaper saturation for raspy wing buzz
      if (this.distortionCurve) {
        shaper.curve = this.distortionCurve;
      }

      // Nasal / Resonant Peaking Filter:
      // +14dB boost for signature sharp mosquito whine
      peakingFilter.type = 'peaking';
      peakingFilter.frequency.setValueAtTime(isBoss ? 320 : 2150, now);
      peakingFilter.Q.setValueAtTime(isBoss ? 2.5 : 3.8, now);
      peakingFilter.gain.setValueAtTime(isBoss ? 10 : 14, now);

      // Distance-Reactive Low-pass Filter
      lowpassFilter.type = 'lowpass';
      lowpassFilter.frequency.setValueAtTime(isBoss ? 2600 : 5800, now);
      lowpassFilter.Q.setValueAtTime(1.2, now);

      // Initial gain
      gain.gain.setValueAtTime(0.001, now);
      gain.gain.linearRampToValueAtTime(Math.max(0.001, distanceGain), now + 0.1);

      // Routing:
      oscPrimary.connect(shaper);
      oscHarmonic.connect(shaper);
      shaper.connect(peakingFilter);
      peakingFilter.connect(lowpassFilter);
      lowpassFilter.connect(gain);
      gain.connect(panner);
      if (this.masterGain) {
        panner.connect(this.masterGain);
      }

      // Start oscillators
      oscPrimary.start(now);
      oscHarmonic.start(now);
      lfoFlutter.start(now);
      lfoWander.start(now);

      voice = {
        oscPrimary,
        oscHarmonic,
        lfoFlutter,
        lfoFlutterGain,
        lfoWander,
        lfoWanderGain,
        shaper,
        lowpassFilter,
        peakingFilter,
        gain,
        panner,
        baseFreq,
      };

      this.activeVoices.set(id, voice);
    }

    // --- REALTIME DISTANCE-REACTIVE AUDIO UPDATES ---
    // 1. Update Spatial Panner Coordinates with amplified stereo separation
    const stereoX = relX * GAMEPLAY_CONFIG.trackingAid.stereoSpreadBoost;
    if ('positionX' in voice.panner) {
      voice.panner.positionX.setTargetAtTime(stereoX, now, 0.04);
      voice.panner.positionY.setTargetAtTime(relY, now, 0.04);
      voice.panner.positionZ.setTargetAtTime(relZ, now, 0.04);
    } else {
      (voice.panner as unknown as { setPosition: (x: number, y: number, z: number) => void }).setPosition(
        stereoX,
        relY,
        relZ
      );
    }

    // 2. Proximity Volume Intensity
    voice.gain.gain.setTargetAtTime(Math.max(0.001, distanceGain), now, 0.04);

    // 3. Directional Lowpass Filter (apuntado = claro y brillante, costados/atrás = apagado)
    // -relZ / distance: 1.0 when pointing directly at it, 0 at 90 deg lateral, -1.0 when directly behind
    const aimAlignment = Math.max(-1.0, Math.min(1.0, -relZ / distance));
    const aimFactor = (aimAlignment + 1.0) / 2.0; // 0 (behind) to 1.0 (straight ahead)
    
    // Lerp from 1300Hz (behind, dark/muffled) to 8200Hz (front, biting and crisp)
    let targetCutoff = 1300 + Math.pow(aimFactor, 1.4) * 6900;
    // Air absorption over distance
    targetCutoff = Math.max(900, targetCutoff - Math.max(0, distance - 2.0) * 350);
    voice.lowpassFilter.frequency.setTargetAtTime(targetCutoff, now, 0.04);

    // 4. Pitch & flutter variation with mosquito speed (nota cuando acelera)
    const speedPitch = (speedRatio - 1.0) * 85;
    const closeSurge = distance < 1.3 ? (1.3 - distance) * 35 : 0;
    voice.oscPrimary.frequency.setTargetAtTime(voice.baseFreq + speedPitch + closeSurge, now, 0.05);
  }

  /**
   * Stop buzzing for a specific mosquito
   */
  public stopMosquitoBuzz(id: string) {
    const voice = this.activeVoices.get(id);
    if (!voice || !this.ctx) return;

    try {
      const now = this.ctx.currentTime;
      voice.gain.gain.linearRampToValueAtTime(0.001, now + 0.05);
      setTimeout(() => {
        try {
          voice.oscPrimary.stop();
          voice.oscHarmonic.stop();
          voice.lfoFlutter.stop();
          voice.lfoWander.stop();
          voice.oscPrimary.disconnect();
          voice.oscHarmonic.disconnect();
          voice.lfoFlutter.disconnect();
          voice.lfoFlutterGain.disconnect();
          voice.lfoWander.disconnect();
          voice.lfoWanderGain.disconnect();
          voice.shaper.disconnect();
          voice.peakingFilter.disconnect();
          voice.lowpassFilter.disconnect();
          voice.gain.disconnect();
          voice.panner.disconnect();
        } catch {
          // ignore
        }
      }, 70);
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
    const bufferSize = Math.floor(this.ctx.sampleRate * 0.12);
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
   * Play sharp blade slice / swoosh cut sound effect
   */
  public playSliceSfx() {
    if (!this.ctx || this.isMuted) return;
    const t = this.ctx.currentTime;

    // High blade swoosh (bandpass filtered noise with frequency sweep)
    const bufferSize = Math.floor(this.ctx.sampleRate * 0.15);
    const noiseBuffer = this.ctx.createBuffer(1, bufferSize, this.ctx.sampleRate);
    const output = noiseBuffer.getChannelData(0);
    for (let i = 0; i < bufferSize; i++) {
      output[i] = Math.random() * 2 - 1;
    }
    const noise = this.ctx.createBufferSource();
    noise.buffer = noiseBuffer;

    const filter = this.ctx.createBiquadFilter();
    filter.type = 'bandpass';
    filter.Q.value = 4.0;
    filter.frequency.setValueAtTime(3200, t);
    filter.frequency.exponentialRampToValueAtTime(700, t + 0.12);

    const gain = this.ctx.createGain();
    gain.gain.setValueAtTime(0.75, t);
    gain.gain.exponentialRampToValueAtTime(0.001, t + 0.14);

    noise.connect(filter);
    filter.connect(gain);
    if (this.masterGain) gain.connect(this.masterGain);
    noise.start(t);

    // Sharp metallic bite
    const biteOsc = this.ctx.createOscillator();
    const biteGain = this.ctx.createGain();
    biteOsc.type = 'triangle';
    biteOsc.frequency.setValueAtTime(880, t);
    biteOsc.frequency.exponentialRampToValueAtTime(240, t + 0.08);

    biteGain.gain.setValueAtTime(0.5, t);
    biteGain.gain.exponentialRampToValueAtTime(0.001, t + 0.08);

    biteOsc.connect(biteGain);
    if (this.masterGain) biteGain.connect(this.masterGain);
    biteOsc.start(t);
    biteOsc.stop(t + 0.09);
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
    const notes = [261.63, 329.63, 392.0, 523.25];
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

  /**
   * Attack flutter: brief pitch surge and vibrato rush when an ambush dive starts
   */
  public triggerAttackFlutter(id: string) {
    if (!this.ctx || this.isMuted) return;
    const voice = this.activeVoices.get(id);
    if (voice) {
      const now = this.ctx.currentTime;
      try {
        voice.oscPrimary.frequency.cancelScheduledValues(now);
        voice.oscPrimary.frequency.setValueAtTime(voice.baseFreq, now);
        voice.oscPrimary.frequency.linearRampToValueAtTime(voice.baseFreq + 130, now + 0.35);
        voice.oscPrimary.frequency.exponentialRampToValueAtTime(voice.baseFreq, now + 1.2);
      } catch {
        // Ignore audio schedule timing conflicts
      }
    }
  }
}

export const buzzManager = new SpatialBuzzManager();
