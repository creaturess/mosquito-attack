/**
 * SensorManager.ts
 * Manages DeviceOrientation (gyroscope) with iOS 13+ permissions & lerp smoothing,
 * Microphone input (Web Audio API AnalyserNode) with real-time volume & scream detection,
 * and optional Camera passthrough (AR mode).
 */

export interface SensorStatus {
  gyroscopeAllowed: boolean;
  gyroscopeActive: boolean;
  micAllowed: boolean;
  micActive: boolean;
  cameraAllowed: boolean;
  cameraActive: boolean;
}

export interface OrientationValues {
  alpha: number; // yaw (0 to 360)
  beta: number;  // pitch (-180 to 180)
  gamma: number; // roll (-90 to 90)
  calibratedAlpha: number;
}

export interface AudioMetrics {
  volume: number;     // 0.0 to 1.0
  bassLevel: number;  // 0.0 to 1.0
  isScreaming: boolean; // true when volume exceeds scream threshold
}

export class SensorManager {
  private status: SensorStatus = {
    gyroscopeAllowed: false,
    gyroscopeActive: false,
    micAllowed: false,
    micActive: false,
    cameraAllowed: false,
    cameraActive: false,
  };

  // Orientation state
  private rawOrientation = { alpha: 0, beta: 0, gamma: 0 };
  private smoothedOrientation = { alpha: 0, beta: 0, gamma: 0 };
  private initialAlphaOffset: number | null = null;
  private hasReceivedGyroData = false;

  // Manual touch/mouse drag fallback for desktop / non-gyro devices
  private manualEuler = { yaw: 0, pitch: 0 };

  // Microphone state
  private audioStream: MediaStream | null = null;
  private analyser: AnalyserNode | null = null;
  private freqDataArray: Uint8Array<ArrayBuffer> | null = null;
  private audioMetrics: AudioMetrics = { volume: 0, bassLevel: 0, isScreaming: false };
  public screamThreshold: number = 0.62; // Volume required to count as scream

  // Camera video element for AR background
  private cameraStream: MediaStream | null = null;
  private videoElement: HTMLVideoElement | null = null;

  // Smoothing factor (lerp alpha: 0.15 for smooth response without jitter)
  private readonly LERP_FACTOR = 0.18;

  constructor() {
    this.handleDeviceOrientation = this.handleDeviceOrientation.bind(this);
  }

  /**
   * Request Gyroscope permission (required on iOS 13+) and attach listener
   */
  public async requestGyroscope(): Promise<boolean> {
    try {
      // Check if iOS DeviceOrientationEvent.requestPermission exists
      const DeviceOrientation = window.DeviceOrientationEvent as unknown as {
        requestPermission?: () => Promise<'granted' | 'denied'>;
      };

      if (typeof DeviceOrientation?.requestPermission === 'function') {
        const response = await DeviceOrientation.requestPermission();
        if (response === 'granted') {
          this.status.gyroscopeAllowed = true;
          this.startGyroscope();
          return true;
        } else {
          this.status.gyroscopeAllowed = false;
          return false;
        }
      } else {
        // Non-iOS or standard Android browser
        this.status.gyroscopeAllowed = true;
        this.startGyroscope();
        return true;
      }
    } catch (e) {
      console.warn('Error requesting gyroscope permission:', e);
      // Fallback: attach listener anyway
      this.status.gyroscopeAllowed = true;
      this.startGyroscope();
      return true;
    }
  }

  private startGyroscope() {
    window.addEventListener('deviceorientation', this.handleDeviceOrientation, true);
    this.status.gyroscopeActive = true;
  }

  public calibrateCenter() {
    this.initialAlphaOffset = this.rawOrientation.alpha;
    this.manualEuler.yaw = 0;
    this.manualEuler.pitch = 0;
  }

  private handleDeviceOrientation(event: DeviceOrientationEvent) {
    if (event.alpha !== null && event.beta !== null && event.gamma !== null) {
      this.hasReceivedGyroData = true;
      this.status.gyroscopeActive = true;

      if (this.initialAlphaOffset === null) {
        this.initialAlphaOffset = event.alpha;
      }

      this.rawOrientation.alpha = event.alpha;
      this.rawOrientation.beta = event.beta;
      this.rawOrientation.gamma = event.gamma;
    }
  }

  /**
   * Add manual drag offsets (for desktop or manual tilt assist)
   */
  public addManualLook(deltaYaw: number, deltaPitch: number) {
    this.manualEuler.yaw += deltaYaw;
    this.manualEuler.pitch = Math.max(-1.4, Math.min(1.4, this.manualEuler.pitch + deltaPitch));
  }

  /**
   * Request Microphone permission and set up AnalyserNode
   */
  public async requestMicrophone(audioCtx?: AudioContext): Promise<boolean> {
    try {
      this.audioStream = await navigator.mediaDevices.getUserMedia({
        audio: {
          echoCancellation: false,
          noiseSuppression: false,
          autoGainControl: false,
        },
      });

      const ctx = audioCtx || new (window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext)();
      if (ctx.state === 'suspended') {
        await ctx.resume();
      }

      const source = ctx.createMediaStreamSource(this.audioStream);
      this.analyser = ctx.createAnalyser();
      this.analyser.fftSize = 128;
      this.analyser.smoothingTimeConstant = 0.4;
      source.connect(this.analyser);

      const bufferLength = this.analyser.frequencyBinCount;
      this.freqDataArray = new Uint8Array(bufferLength);

      this.status.micAllowed = true;
      this.status.micActive = true;
      return true;
    } catch (err) {
      console.warn('Microphone access denied or error:', err);
      this.status.micAllowed = false;
      this.status.micActive = false;
      return false;
    }
  }

  /**
   * Request and initialize Camera for AR passthrough
   */
  public async requestCamera(): Promise<HTMLVideoElement | null> {
    try {
      this.cameraStream = await navigator.mediaDevices.getUserMedia({
        video: {
          facingMode: { ideal: 'environment' },
          width: { ideal: 1280 },
          height: { ideal: 720 },
        },
        audio: false,
      });

      if (!this.videoElement) {
        this.videoElement = document.createElement('video');
        this.videoElement.setAttribute('autoplay', '');
        this.videoElement.setAttribute('muted', '');
        this.videoElement.setAttribute('playsinline', '');
        this.videoElement.style.display = 'none';
        document.body.appendChild(this.videoElement);
      }

      this.videoElement.srcObject = this.cameraStream;
      await this.videoElement.play();

      this.status.cameraAllowed = true;
      this.status.cameraActive = true;
      return this.videoElement;
    } catch (err) {
      console.warn('Camera access denied or unavailable:', err);
      this.status.cameraAllowed = false;
      this.status.cameraActive = false;
      return null;
    }
  }

  public stopCamera() {
    if (this.cameraStream) {
      this.cameraStream.getTracks().forEach((track) => track.stop());
      this.cameraStream = null;
    }
    this.status.cameraActive = false;
  }

  /**
   * Updates and smooths sensors on each animation frame
   */
  public update(): {
    orientation: { alpha: number; beta: number; gamma: number; yawRad: number; pitchRad: number; rollRad: number };
    audio: AudioMetrics;
    status: SensorStatus;
  } {
    // 1. Lerp orientation
    // Handle wrap-around for alpha (0-360)
    let diffAlpha = this.rawOrientation.alpha - this.smoothedOrientation.alpha;
    if (diffAlpha > 180) diffAlpha -= 360;
    if (diffAlpha < -180) diffAlpha += 360;
    this.smoothedOrientation.alpha += diffAlpha * this.LERP_FACTOR;
    if (this.smoothedOrientation.alpha < 0) this.smoothedOrientation.alpha += 360;
    if (this.smoothedOrientation.alpha >= 360) this.smoothedOrientation.alpha -= 360;

    this.smoothedOrientation.beta += (this.rawOrientation.beta - this.smoothedOrientation.beta) * this.LERP_FACTOR;
    this.smoothedOrientation.gamma += (this.rawOrientation.gamma - this.smoothedOrientation.gamma) * this.LERP_FACTOR;

    // Convert to Radians for Three.js camera rotation
    // Calibrated alpha relative to starting look-forward direction
    const calAlpha = this.smoothedOrientation.alpha - (this.initialAlphaOffset || 0);

    // If device doesn't supply gyro, use manual touch/mouse look
    const degToRad = Math.PI / 180;
    let yawRad: number;
    let pitchRad: number;
    let rollRad: number;

    if (this.hasReceivedGyroData) {
      // Standard mobile phone holding upright or slightly tilted:
      // Beta: tilt forward/back (Pitch)
      // Gamma: tilt left/right (Roll)
      // Alpha: heading (Yaw)
      yawRad = -calAlpha * degToRad + this.manualEuler.yaw;
      pitchRad = (this.smoothedOrientation.beta - 70) * degToRad + this.manualEuler.pitch;
      rollRad = -this.smoothedOrientation.gamma * degToRad * 0.5;
    } else {
      yawRad = this.manualEuler.yaw;
      pitchRad = this.manualEuler.pitch;
      rollRad = 0;
    }

    // 2. Audio Processing (AnalyserNode)
    if (this.analyser && this.freqDataArray) {
      this.analyser.getByteFrequencyData(this.freqDataArray);

      let sum = 0;
      let bassSum = 0;
      const len = this.freqDataArray.length;
      const bassCount = Math.min(8, len);

      for (let i = 0; i < len; i++) {
        sum += this.freqDataArray[i];
        if (i < bassCount) {
          bassSum += this.freqDataArray[i];
        }
      }

      const rawVol = sum / (len * 255);
      const rawBass = bassSum / (bassCount * 255);

      // Boost volume curve for responsiveness
      const smoothVol = Math.min(1.0, rawVol * 2.2);
      const smoothBass = Math.min(1.0, rawBass * 1.8);

      this.audioMetrics.volume = smoothVol;
      this.audioMetrics.bassLevel = smoothBass;
      this.audioMetrics.isScreaming = smoothVol >= this.screamThreshold;
    } else {
      this.audioMetrics.volume = 0;
      this.audioMetrics.bassLevel = 0;
      this.audioMetrics.isScreaming = false;
    }

    return {
      orientation: {
        alpha: this.smoothedOrientation.alpha,
        beta: this.smoothedOrientation.beta,
        gamma: this.smoothedOrientation.gamma,
        yawRad,
        pitchRad,
        rollRad,
      },
      audio: this.audioMetrics,
      status: { ...this.status },
    };
  }

  public triggerHaptic(type: 'swat' | 'bossHit' | 'gameover' | 'victory') {
    if (typeof navigator !== 'undefined' && 'vibrate' in navigator) {
      try {
        switch (type) {
          case 'swat':
            navigator.vibrate([40, 30, 80]);
            break;
          case 'bossHit':
            navigator.vibrate([70, 40, 100]);
            break;
          case 'gameover':
            navigator.vibrate([150, 100, 200]);
            break;
          case 'victory':
            navigator.vibrate([100, 50, 100, 50, 200]);
            break;
        }
      } catch {
        // Ignore on unsupported browsers
      }
    }
  }

  public destroy() {
    window.removeEventListener('deviceorientation', this.handleDeviceOrientation, true);
    this.stopCamera();
    if (this.audioStream) {
      this.audioStream.getTracks().forEach((track) => track.stop());
      this.audioStream = null;
    }
    if (this.videoElement && this.videoElement.parentNode) {
      this.videoElement.parentNode.removeChild(this.videoElement);
      this.videoElement = null;
    }
  }
}

export const sensorManager = new SensorManager();
