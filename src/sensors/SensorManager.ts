/**
 * SensorManager.ts
 * Manages 6DOF Device Motion Tracking (Orientation + 3D Spatial Translation),
 * iOS 13+ permissions for DeviceOrientation & DeviceMotion,
 * Microphone input (Web Audio API AnalyserNode) with real-time volume & scream detection,
 * and optional Camera passthrough (AR mode).
 */

export interface SensorStatus {
  gyroscopeAllowed: boolean;
  gyroscopeActive: boolean;
  motionActive: boolean;
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

export interface SpatialPosition {
  x: number; // Left (-) / Right (+)
  y: number; // Down (-) / Up (+)
  z: number; // Back (+) / Forward (-) in world coordinates
  forwardDistance: number; // Relative forward advancement
}

export class SensorManager {
  private status: SensorStatus = {
    gyroscopeAllowed: false,
    gyroscopeActive: false,
    motionActive: false,
    micAllowed: false,
    micActive: false,
    cameraAllowed: false,
    cameraActive: false,
  };

  // Orientation state
  private rawOrientation = { alpha: 0, beta: 0, gamma: 0 };
  private smoothedOrientation = { alpha: 0, beta: 0, gamma: 0 };
  private initialAlphaOffset: number | null = null;
  private calibratedBeta: number = 65; // Resting phone pitch angle
  private hasReceivedGyroData = false;

  // Spatial Translation state (6DOF position tracking inside bedroom)
  private readonly DEFAULT_X = 0.2;
  private readonly DEFAULT_Y = 1.6; // Standing eye-level
  private readonly DEFAULT_Z = 1.4; // Standing in open floor facing bed/desk
  private position: SpatialPosition = { x: 0.2, y: 1.6, z: 1.4, forwardDistance: 0 };
  private targetPosition: SpatialPosition = { x: 0.2, y: 1.6, z: 1.4, forwardDistance: 0 };
  private linearVelocity = { x: 0, y: 0, z: 0 };
  private lastMotionTimestamp: number = 0;

  // Sensitivity settings
  public motionSensitivity: number = 2.2; // Forward/backward tracking multiplier
  public tiltAssistEnabled: boolean = true;

  // Manual touch/mouse drag fallback for desktop / non-gyro devices
  private manualEuler = { yaw: 0, pitch: 0 };

  // Microphone state
  private audioStream: MediaStream | null = null;
  private analyser: AnalyserNode | null = null;
  private freqDataArray: Uint8Array<ArrayBuffer> | null = null;
  private audioMetrics: AudioMetrics = { volume: 0, bassLevel: 0, isScreaming: false };
  public screamThreshold: number = 0.62;

  // Camera video element for AR background
  private cameraStream: MediaStream | null = null;
  private videoElement: HTMLVideoElement | null = null;

  // Smoothing factors
  private readonly ROT_LERP = 0.2;
  private readonly POS_LERP = 0.15;

  // Room spatial limits (inside bedroom walls)
  private readonly LIMIT_X = 3.9;
  private readonly LIMIT_Y_UP = 2.6;
  private readonly LIMIT_Y_DOWN = 0.9;
  private readonly LIMIT_Z = 3.6;

  constructor() {
    this.handleDeviceOrientation = this.handleDeviceOrientation.bind(this);
    this.handleDeviceMotion = this.handleDeviceMotion.bind(this);
  }

  /**
   * Request Gyroscope and Accelerometer permissions (required on iOS 13+) and attach listeners
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
        } else {
          this.status.gyroscopeAllowed = false;
          return false;
        }
      } else {
        this.status.gyroscopeAllowed = true;
      }

      // Check if iOS DeviceMotionEvent.requestPermission exists
      const DeviceMotion = window.DeviceMotionEvent as unknown as {
        requestPermission?: () => Promise<'granted' | 'denied'>;
      };
      if (typeof DeviceMotion?.requestPermission === 'function') {
        try {
          await DeviceMotion.requestPermission();
        } catch {
          // ignore if already granted or failed
        }
      }

      this.startMotionListeners();
      return true;
    } catch (e) {
      console.warn('Error requesting gyroscope/motion permission:', e);
      this.status.gyroscopeAllowed = true;
      this.startMotionListeners();
      return true;
    }
  }

  private startMotionListeners() {
    window.addEventListener('deviceorientation', this.handleDeviceOrientation, true);
    window.addEventListener('devicemotion', this.handleDeviceMotion, true);
    this.status.gyroscopeActive = true;
  }

  public calibrateCenter() {
    this.initialAlphaOffset = this.rawOrientation.alpha;
    this.calibratedBeta = this.rawOrientation.beta || 65;
    this.manualEuler.yaw = 0;
    this.manualEuler.pitch = 0;
    this.resetPosition();
  }

  public resetPosition() {
    this.position = { x: this.DEFAULT_X, y: this.DEFAULT_Y, z: this.DEFAULT_Z, forwardDistance: 0 };
    this.targetPosition = { x: this.DEFAULT_X, y: this.DEFAULT_Y, z: this.DEFAULT_Z, forwardDistance: 0 };
    this.linearVelocity = { x: 0, y: 0, z: 0 };
  }

  private handleDeviceOrientation(event: DeviceOrientationEvent) {
    if (event.alpha !== null && event.beta !== null && event.gamma !== null) {
      this.hasReceivedGyroData = true;
      this.status.gyroscopeActive = true;

      if (this.initialAlphaOffset === null) {
        this.initialAlphaOffset = event.alpha;
        this.calibratedBeta = event.beta;
      }

      this.rawOrientation.alpha = event.alpha;
      this.rawOrientation.beta = event.beta;
      this.rawOrientation.gamma = event.gamma;
    }
  }

  /**
   * DeviceMotion handler: calculates physical forward, backward, and lateral acceleration
   */
  private handleDeviceMotion(event: DeviceMotionEvent) {
    this.status.motionActive = true;
    const now = performance.now();
    const dt = this.lastMotionTimestamp > 0 ? Math.min((now - this.lastMotionTimestamp) / 1000, 0.1) : 0.016;
    this.lastMotionTimestamp = now;

    // Prefer linear acceleration (without gravity)
    const acc = event.acceleration || event.accelerationIncludingGravity;
    if (!acc) return;

    const rawX = acc.x ?? 0;
    const rawY = acc.y ?? 0;
    const rawZ = acc.z ?? 0;

    // Deadband threshold to eliminate sensor noise / tremor
    const deadband = 0.22;
    const fx = Math.abs(rawX) > deadband ? rawX : 0;
    const fy = Math.abs(rawY) > deadband ? rawY : 0;
    const fz = Math.abs(rawZ) > deadband ? rawZ : 0;

    // In mobile phone space:
    // Pushing phone forward (away from user):
    // negative Z or positive Y thrust depending on holding angle
    const forwardThrust = (-fz * 0.75 + fy * 0.35) * this.motionSensitivity;
    const strafeThrust = fx * this.motionSensitivity * 0.6;

    // Integrate forward/backward velocity with strong friction damping
    this.linearVelocity.z += forwardThrust * dt * 2.8;
    this.linearVelocity.x += strafeThrust * dt * 2.0;

    // Apply damping so phone stops cleanly
    this.linearVelocity.z *= 0.82;
    this.linearVelocity.x *= 0.82;

    // Add translation along current orientation
    const yaw = this.getYawRad();
    const forwardDirX = -Math.sin(yaw);
    const forwardDirZ = -Math.cos(yaw);
    const rightDirX = Math.cos(yaw);
    const rightDirZ = -Math.sin(yaw);

    const deltaDist = this.linearVelocity.z * dt;
    this.targetPosition.x += forwardDirX * deltaDist + rightDirX * (this.linearVelocity.x * dt);
    this.targetPosition.z += forwardDirZ * deltaDist + rightDirZ * (this.linearVelocity.x * dt);
    this.targetPosition.forwardDistance += deltaDist;

    this.clampTargetPosition();
  }

  private getYawRad(): number {
    const degToRad = Math.PI / 180;
    const calAlpha = this.smoothedOrientation.alpha - (this.initialAlphaOffset || 0);
    return -calAlpha * degToRad + this.manualEuler.yaw;
  }

  /**
   * Advance forward or retreat backward directly (by distance in meters)
   */
  public moveForward(meters: number) {
    const yaw = this.getYawRad();
    const forwardDirX = -Math.sin(yaw);
    const forwardDirZ = -Math.cos(yaw);

    this.targetPosition.x += forwardDirX * meters;
    this.targetPosition.z += forwardDirZ * meters;
    this.targetPosition.forwardDistance += meters;
    this.clampTargetPosition();
  }

  /**
   * Strafe left or right (meters)
   */
  public moveStrafe(meters: number) {
    const yaw = this.getYawRad();
    const rightDirX = Math.cos(yaw);
    const rightDirZ = -Math.sin(yaw);

    this.targetPosition.x += rightDirX * meters;
    this.targetPosition.z += rightDirZ * meters;
    this.clampTargetPosition();
  }

  private clampTargetPosition() {
    this.targetPosition.x = Math.max(-this.LIMIT_X, Math.min(this.LIMIT_X, this.targetPosition.x));
    this.targetPosition.z = Math.max(-this.LIMIT_Z, Math.min(this.LIMIT_Z, this.targetPosition.z));
    this.targetPosition.y = Math.max(this.LIMIT_Y_DOWN, Math.min(this.LIMIT_Y_UP, this.targetPosition.y));
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
    position: SpatialPosition;
    audio: AudioMetrics;
    status: SensorStatus;
  } {
    // 1. Lerp orientation
    let diffAlpha = this.rawOrientation.alpha - this.smoothedOrientation.alpha;
    if (diffAlpha > 180) diffAlpha -= 360;
    if (diffAlpha < -180) diffAlpha += 360;
    this.smoothedOrientation.alpha += diffAlpha * this.ROT_LERP;
    if (this.smoothedOrientation.alpha < 0) this.smoothedOrientation.alpha += 360;
    if (this.smoothedOrientation.alpha >= 360) this.smoothedOrientation.alpha -= 360;

    this.smoothedOrientation.beta += (this.rawOrientation.beta - this.smoothedOrientation.beta) * this.ROT_LERP;
    this.smoothedOrientation.gamma += (this.rawOrientation.gamma - this.smoothedOrientation.gamma) * this.ROT_LERP;

    // Convert to Radians
    const degToRad = Math.PI / 180;
    let yawRad: number;
    let pitchRad: number;
    let rollRad: number;

    if (this.hasReceivedGyroData) {
      const calAlpha = this.smoothedOrientation.alpha - (this.initialAlphaOffset || 0);
      yawRad = -calAlpha * degToRad + this.manualEuler.yaw;
      pitchRad = (this.smoothedOrientation.beta - 70) * degToRad + this.manualEuler.pitch;
      rollRad = -this.smoothedOrientation.gamma * degToRad * 0.5;

      // 2. Physical Tilt-to-Advance assist ("Fiel al movimiento del celular"):
      // When user tilts/pushes phone forward past calibrated resting angle,
      // apply continuous forward advancement; when pulled back, retreat!
      if (this.tiltAssistEnabled) {
        const betaDiff = this.smoothedOrientation.beta - this.calibratedBeta;
        if (Math.abs(betaDiff) > 5) {
          // Tilting forward (higher beta): advance forward
          // Tilting backward (lower beta): retreat
          const tiltThrust = Math.sign(betaDiff) * Math.min(1.2, Math.pow(Math.abs(betaDiff) - 5, 1.2) * 0.05);
          const forwardDirX = -Math.sin(yawRad);
          const forwardDirZ = -Math.cos(yawRad);

          this.targetPosition.x += forwardDirX * tiltThrust * 0.035;
          this.targetPosition.z += forwardDirZ * tiltThrust * 0.035;
          this.targetPosition.forwardDistance += tiltThrust * 0.035;
          this.clampTargetPosition();
        }
      }
    } else {
      yawRad = this.manualEuler.yaw;
      pitchRad = this.manualEuler.pitch;
      rollRad = 0;
    }

    // Smoothly interpolate current spatial position towards target position
    this.position.x += (this.targetPosition.x - this.position.x) * this.POS_LERP;
    this.position.y += (this.targetPosition.y - this.position.y) * this.POS_LERP;
    this.position.z += (this.targetPosition.z - this.position.z) * this.POS_LERP;
    this.position.forwardDistance += (this.targetPosition.forwardDistance - this.position.forwardDistance) * this.POS_LERP;

    // 3. Audio Processing (AnalyserNode)
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
      position: { ...this.position },
      audio: this.audioMetrics,
      status: { ...this.status },
    };
  }

  public triggerHaptic(type: 'swat' | 'bossHit' | 'gameover' | 'victory' | 'step') {
    if (typeof navigator !== 'undefined' && 'vibrate' in navigator) {
      try {
        switch (type) {
          case 'step':
            navigator.vibrate(15);
            break;
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
    window.removeEventListener('devicemotion', this.handleDeviceMotion, true);
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
