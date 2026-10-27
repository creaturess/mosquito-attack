/**
 * SpatialBuzzManager.ts
 * Manages 3D Positional Audio for all mosquitoes in the room:
 * - Uses THREE.AudioListener attached to the camera
 * - Generates high-fidelity synthetic buzzing AudioBuffer (seamless 2s loop)
 * - Assigns an independent THREE.PositionalAudio instance per mosquito
 * - Configured with room-scale parameters (refDistance 0.8m, rolloff 1.2, max 12m, inverse, HRTF)
 * - Individual detune/playbackRate per mosquito (0.9 to 1.15)
 * - Direction-dependent Lowpass filter (crisp 7500Hz when aiming, muffled 1800Hz when behind/sides)
 * - AudioContext auto-resumption on user interaction
 */

import * as THREE from 'three';
import { CONFIG } from '../config/gameplayConfig';

export class SpatialBuzzManager {
  private listener: THREE.AudioListener | null = null;
  private sharedBuzzBuffer: AudioBuffer | null = null;
  private isMuted: boolean = false;

  /**
   * Initializes audio listener and precomputes the shared mosquito buzz buffer
   */
  public init(listener?: THREE.AudioListener): THREE.AudioListener {
    if (listener) {
      this.listener = listener;
    } else if (!this.listener) {
      this.listener = new THREE.AudioListener();
    }
    this.resumeContext();
    this.getSharedBuffer();
    return this.listener;
  }

  public getContext(): AudioContext | null {
    return (this.listener?.context as AudioContext) || null;
  }

  public getListener(): THREE.AudioListener | null {
    return this.listener;
  }

  /**
   * Resumes AudioContext on user interaction
   */
  public resumeContext() {
    if (this.listener && this.listener.context && this.listener.context.state === 'suspended') {
      this.listener.context.resume().catch(() => {});
    }
  }

  public setMuted(muted: boolean) {
    this.isMuted = muted;
    if (this.listener) {
      this.listener.setMasterVolume(muted ? 0 : 1.0);
    }
  }

  /**
   * Generates a seamless 2-second looped AudioBuffer for realistic mosquito buzzing
   * (Fundamental ~210-230 Hz + 2nd & 3rd nasal harmonics + 380 Hz wing-flutter vibrato)
   */
  public getSharedBuffer(): AudioBuffer | null {
    if (this.sharedBuzzBuffer) return this.sharedBuzzBuffer;
    if (!this.listener) return null;

    const ctx = this.listener.context;
    const sampleRate = ctx.sampleRate || 44100;
    const duration = 2.0; // 2 seconds seamless loop
    const length = Math.floor(sampleRate * duration);
    const buffer = ctx.createBuffer(1, length, sampleRate);
    const data = buffer.getChannelData(0);

    const baseFreq = 220; // 220 Hz fundamental frequency
    for (let i = 0; i < length; i++) {
      const t = i / sampleRate;
      // High-speed wing-flutter vibrato (~380 Hz)
      const flutter = Math.sin(2 * Math.PI * 380 * t) * 0.12;
      // Gentle pitch wandering
      const wander = Math.sin(2 * Math.PI * 2.2 * t) * 7.0;
      const currentFreq = baseFreq + wander;

      // Sawtooth waveform with strong nasal harmonics
      const phase = (t * currentFreq + flutter) % 1.0;
      let s = (phase * 2 - 1) * 0.45;
      s += Math.sin(2 * Math.PI * phase * 2.0) * 0.32; // 2nd harmonic (nasal whine)
      s += Math.sin(2 * Math.PI * phase * 3.0) * 0.22; // 3rd harmonic
      s += Math.sin(2 * Math.PI * phase * 5.0) * 0.12; // Raspy edge

      // Crossfade boundaries for click-free looping
      const fadeSamples = Math.floor(sampleRate * 0.04);
      let envelope = 1.0;
      if (i < fadeSamples) {
        envelope = i / fadeSamples;
      } else if (i > length - fadeSamples) {
        envelope = (length - i) / fadeSamples;
      }

      data[i] = s * envelope * 0.7;
    }

    this.sharedBuzzBuffer = buffer;
    return buffer;
  }

  /**
   * Creates and attaches a dedicated THREE.PositionalAudio instance to a mosquito
   */
  public attachMosquitoAudio(
    mosquitoGroup: THREE.Object3D,
    isBoss: boolean = false
  ): { audio: THREE.PositionalAudio; filter: BiquadFilterNode } | null {
    if (!this.listener) return null;

    const buffer = this.getSharedBuffer();
    if (!buffer) return null;

    const audio = new THREE.PositionalAudio(this.listener);
    audio.setBuffer(buffer);
    audio.setLoop(true);

    // Room scale parameters
    audio.setRefDistance(CONFIG.audio.refDistance); // 0.8m
    audio.setRolloffFactor(CONFIG.audio.rolloffFactor); // 1.2
    audio.setMaxDistance(CONFIG.audio.maxDistance); // 12m
    audio.setDistanceModel(CONFIG.audio.distanceModel); // 'inverse'
    if (audio.panner) {
      audio.panner.panningModel = CONFIG.audio.panningModel; // 'HRTF'
    }

    // Direction-dependent lowpass filter
    const ctx = this.listener.context;
    const filter = ctx.createBiquadFilter();
    filter.type = 'lowpass';
    filter.frequency.setValueAtTime(4500, ctx.currentTime);
    filter.Q.setValueAtTime(1.2, ctx.currentTime);
    audio.setFilter(filter);

    // Slight pitch variation per mosquito (0.9 to 1.15) to tell them apart
    const rate = isBoss ? 0.72 : (0.92 + Math.random() * 0.22);
    audio.setPlaybackRate(rate);
    audio.setVolume(isBoss ? 1.0 : 0.85);

    // Attach directly to the mosquito 3D mesh
    mosquitoGroup.add(audio);

    return { audio, filter };
  }

  /**
   * Updates directional lowpass filter based on gaze angle:
   * Crisp (7500Hz) when aimed at it, muffled (1800Hz) when behind/sides
   */
  public updateDirectivity(filter: BiquadFilterNode, angleRad: number) {
    if (!this.listener) return;
    const now = this.listener.context.currentTime;
    // angleRad: 0 (directly ahead) to PI (directly behind)
    const normalizedAngle = Math.min(1.0, Math.max(0.0, angleRad / Math.PI));
    // When aimed directly (< 25 deg ~ 0.44 rad) -> 7500 Hz
    // When behind (> 90 deg ~ 1.57 rad) -> 1800 Hz
    const targetFreq = 7500 - Math.pow(normalizedAngle, 1.3) * 5700;
    filter.frequency.setTargetAtTime(targetFreq, now, 0.04);
  }

  /**
   * Play swat slap sound effect
   */
  public playSwatSfx(isCritical: boolean = false) {
    if (!this.listener || this.isMuted) return;
    const ctx = this.listener.context;
    this.resumeContext();
    const t = ctx.currentTime;

    const bufferSize = Math.floor(ctx.sampleRate * 0.12);
    const noiseBuffer = ctx.createBuffer(1, bufferSize, ctx.sampleRate);
    const output = noiseBuffer.getChannelData(0);
    for (let i = 0; i < bufferSize; i++) {
      output[i] = Math.random() * 2 - 1;
    }

    const whiteNoise = ctx.createBufferSource();
    whiteNoise.buffer = noiseBuffer;

    const filter = ctx.createBiquadFilter();
    filter.type = 'lowpass';
    filter.frequency.setValueAtTime(1400, t);
    filter.frequency.exponentialRampToValueAtTime(200, t + 0.08);

    const gain = ctx.createGain();
    gain.gain.setValueAtTime(isCritical ? 0.9 : 0.6, t);
    gain.gain.exponentialRampToValueAtTime(0.001, t + 0.1);

    whiteNoise.connect(filter);
    filter.connect(gain);
    gain.connect(this.listener.getInput());

    whiteNoise.start(t);

    const popOsc = ctx.createOscillator();
    const popGain = ctx.createGain();
    popOsc.type = 'sine';
    popOsc.frequency.setValueAtTime(isCritical ? 140 : 180, t);
    popOsc.frequency.exponentialRampToValueAtTime(40, t + 0.09);

    popGain.gain.setValueAtTime(0.5, t);
    popGain.gain.exponentialRampToValueAtTime(0.001, t + 0.09);

    popOsc.connect(popGain);
    popGain.connect(this.listener.getInput());

    popOsc.start(t);
    popOsc.stop(t + 0.1);
  }

  /**
   * Play Boss damage sound
   */
  public playBossHurtSfx() {
    if (!this.listener || this.isMuted) return;
    const ctx = this.listener.context;
    this.resumeContext();
    const t = ctx.currentTime;

    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = 'sawtooth';
    osc.frequency.setValueAtTime(320, t);
    osc.frequency.linearRampToValueAtTime(90, t + 0.25);

    gain.gain.setValueAtTime(0.4, t);
    gain.gain.exponentialRampToValueAtTime(0.001, t + 0.25);

    osc.connect(gain);
    gain.connect(this.listener.getInput());
    osc.start(t);
    osc.stop(t + 0.26);
  }

  /**
   * Play victory fanfare
   */
  public playVictorySfx() {
    if (!this.listener || this.isMuted) return;
    const ctx = this.listener.context;
    this.resumeContext();
    const notes = [261.63, 329.63, 392.0, 523.25];
    notes.forEach((freq, idx) => {
      const t = ctx.currentTime + idx * 0.12;
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = 'triangle';
      osc.frequency.setValueAtTime(freq, t);
      gain.gain.setValueAtTime(0.4, t);
      gain.gain.exponentialRampToValueAtTime(0.001, t + 0.35);
      osc.connect(gain);
      gain.connect(this.listener!.getInput());
      osc.start(t);
      osc.stop(t + 0.36);
    });
  }

  /**
   * Play defeat sound
   */
  public playDefeatSfx() {
    if (!this.listener || this.isMuted) return;
    const ctx = this.listener.context;
    this.resumeContext();
    const notes = [300, 260, 220, 160];
    notes.forEach((freq, idx) => {
      const t = ctx.currentTime + idx * 0.15;
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = 'sawtooth';
      osc.frequency.setValueAtTime(freq, t);
      gain.gain.setValueAtTime(0.35, t);
      gain.gain.exponentialRampToValueAtTime(0.001, t + 0.25);
      osc.connect(gain);
      gain.connect(this.listener!.getInput());
      osc.start(t);
      osc.stop(t + 0.26);
    });
  }

  public stopAll() {
    // Positional audio instances are stopped with their mosquitoes
  }
}

export const buzzManager = new SpatialBuzzManager();
