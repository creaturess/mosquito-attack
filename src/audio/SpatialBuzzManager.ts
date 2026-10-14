/**
 * SpatialBuzzManager.ts
 * Synthesizes ultra-realistic 3D spatial mosquito buzzing matching the uploaded audio recording.
 * Features:
 * - Authentic dual-oscillator wing tone + nasal formant filtering + waveshaper buzz saturation
 * - High-speed wing-flutter vibrato (~380Hz) and organic wandering pitch swoops
 * - High-fidelity distance-reactive intensity curve (piercing loud in-ear buzz when close, muffled when far)
 * - 3D HRTF spatial panner following player phone orientation and position
 */

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
      this.masterGain.gain.setValueAtTime(0.85, this.ctx.currentTime);
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
      this.masterGain.gain.setValueAtTime(muted ? 0 : 0.85, this.ctx.currentTime);
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
   * Intensity, timbre and cutoff dynamically react to distance:
   * - < 0.8m: Intense, piercing in-ear buzz identical to the audio file
   * - 1.5m - 3m: Moderate directional buzzing
   * - > 4m: Faint, air-absorbed muffled hum
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

    const now = this.ctx.currentTime;
    const distance = Math.max(0.25, Math.sqrt(relX * relX + relY * relY + relZ * relZ));

    // --- PROXIMITY & GUIDANCE AUDIO GAIN ---
    // Maintain a distinct audible floor (0.13 - 0.18) even at 6m-9m so sound can guide the player
    // Ramps up dramatically to 0.85 - 1.0 when approaching (< 1.2m)
    const floorPresence = isBoss ? 0.22 : 0.14;
    const proximityRamp = Math.min(0.85, Math.pow(1.35 / Math.max(0.45, distance), 1.3) * 0.45);
    let distanceGain = Math.min(1.0, floorPresence + proximityRamp);

    // Acoustic aim focus: when the mosquito is in front and centered in player's field of view,
    // boost presence so sound acts as an acoustic radar
    const isInFront = relZ < 0;
    const isCentered = isInFront && Math.abs(relX) < 1.6;
    if (isCentered) {
      distanceGain = Math.min(1.0, distanceGain * 1.22);
    }

    let voice = this.activeVoices.get(id);

    if (!voice) {
      // 1. Primary Wing Beat Oscillator (sawtooth wave ~630Hz-670Hz)
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

      // Configure HRTF spatial panner
      panner.panningModel = 'HRTF';
      panner.distanceModel = 'inverse';
      panner.refDistance = 1;
      panner.maxDistance = 25;
      panner.rolloffFactor = 1.5;
      panner.coneInnerAngle = 360;

      // Base Frequency matching the audio recording:
      // Real mosquito fundamental is ~635Hz to 670Hz.
      // In level 2, smaller mosquitoes flap faster -> sharper buzz ~725Hz - 765Hz
      // Boss has an ominous lower swarm drone at ~220Hz.
      const baseFreq = isBoss
        ? 220 + Math.random() * 30
        : (speedFactor > 1.1 ? 730 + (Math.random() - 0.5) * 45 : 635 + (Math.random() - 0.5) * 40);

      oscPrimary.type = 'sawtooth';
      oscPrimary.frequency.setValueAtTime(baseFreq, now);

      // 2. Harmonic Oscillator (Adds the nasal 2nd/3rd harmonics prominent in the uploaded recording)
      oscHarmonic.type = isBoss ? 'sawtooth' : 'triangle';
      oscHarmonic.frequency.setValueAtTime(baseFreq * 2.01, now);

      // 3. Fast Wing-Flutter Vibrato LFO (~380Hz for level 1, ~460Hz for smaller agile level 2 mosquitoes)
      lfoFlutter.type = 'sawtooth';
      lfoFlutter.frequency.setValueAtTime(isBoss ? 110 : (speedFactor > 1.1 ? 460 : 380) + Math.random() * 40, now);
      lfoFlutterGain.gain.setValueAtTime(isBoss ? 45 : (speedFactor > 1.1 ? 75 : 65), now);

      lfoFlutter.connect(lfoFlutterGain);
      lfoFlutterGain.connect(oscPrimary.frequency);
      lfoFlutterGain.connect(oscHarmonic.frequency);

      // 4. Slow Pitch Wander LFO (simulates the organic swoop and darting motion)
      lfoWander.type = 'sine';
      lfoWander.frequency.setValueAtTime(1.8 + Math.random() * 2.2, now);
      lfoWanderGain.gain.setValueAtTime(isBoss ? 20 : 35, now);

      lfoWander.connect(lfoWanderGain);
      lfoWanderGain.connect(oscPrimary.frequency);

      // 5. Waveshaper saturation for raspy wing buzz
      if (this.distortionCurve) {
        shaper.curve = this.distortionCurve;
      }

      // 6. Resonant Nasal Peaking Filter (~1900Hz boost for signature mosquito whine)
      peakingFilter.type = 'peaking';
      peakingFilter.frequency.setValueAtTime(isBoss ? 900 : 1950, now);
      peakingFilter.Q.setValueAtTime(3.2, now);
      peakingFilter.gain.setValueAtTime(8, now); // +8dB nasal boost

      // 7. Distance-Reactive Low-pass Filter (muffled when far, sharp when close)
      lowpassFilter.type = 'lowpass';
      lowpassFilter.frequency.setValueAtTime(4500, now);
      lowpassFilter.Q.setValueAtTime(1.2, now);

      // Initial gain
      gain.gain.setValueAtTime(0.001, now);
      gain.gain.linearRampToValueAtTime(Math.max(0.001, distanceGain), now + 0.1);

      // Routing:
      // oscPrimary + oscHarmonic -> shaper -> peakingFilter -> lowpassFilter -> gain -> panner -> masterGain
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
    // 1. Update Spatial Panner Coordinates
    if ('positionX' in voice.panner) {
      voice.panner.positionX.setTargetAtTime(relX, now, 0.04);
      voice.panner.positionY.setTargetAtTime(relY, now, 0.04);
      voice.panner.positionZ.setTargetAtTime(relZ, now, 0.04);
    } else {
      (voice.panner as unknown as { setPosition: (x: number, y: number, z: number) => void }).setPosition(
        relX,
        relY,
        relZ
      );
    }

    // 2. Proximity Volume Intensity
    voice.gain.gain.setTargetAtTime(Math.max(0.001, distanceGain), now, 0.04);

    // 3. Air Absorption & Directivity Cutoff (Crisp highs when aimed at it, softer when behind)
    let targetCutoff: number;
    if (isBoss) {
      targetCutoff = Math.max(700, Math.min(2600, 2600 - distance * 220));
    } else if (isInFront) {
      targetCutoff = Math.max(2400, Math.min(7600, 7600 - (distance - 0.4) * 600));
      if (isCentered) {
        targetCutoff = Math.min(8000, targetCutoff + 700); // Acoustic spotlight when aimed directly at it
      }
    } else {
      // Behind player: softer highs, prompting player to turn their phone to face the sound
      targetCutoff = Math.max(1800, Math.min(3800, 4200 - distance * 300));
    }
    voice.lowpassFilter.frequency.setTargetAtTime(targetCutoff, now, 0.05);

    // 4. Subtle Doppler pitch surge when zooming very close (< 1.2m)
    if (distance < 1.2) {
      const closeSurge = (1.2 - distance) * 28;
      voice.oscPrimary.frequency.setTargetAtTime(voice.baseFreq + closeSurge, now, 0.05);
    } else {
      voice.oscPrimary.frequency.setTargetAtTime(voice.baseFreq, now, 0.1);
    }
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
}

export const buzzManager = new SpatialBuzzManager();
