/**
 * SensorManager.ts
 * High-precision 6DOF sensor architecture for MOSQUITO ATTACK.
 * Features:
 * 1. Zero-Point Calibration (Origin Reset) capturing exact neutral hand posture (0,0,0).
 * 2. Exponential Low-Pass Filter (LPF) with strict damping (0.05 to 0.10) and deadband
 *    to eliminate hand tremors, micro-stutters, and autonomous drift.
 * 3. Shortest-arc angular delta calculation preventing wild 360-degree spins.
 * 4. Proportional, bounded spatial displacement mapping phone tilt and physical steps to world coordinates.
 * 5. Robust mobile permission management (iOS DeviceOrientationEvent.requestPermission + Chromium).
 * 6. Web Audio scream analysis for Level 3 Boss.
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
  yawRad: number;
  pitchRad: number;
  rollRad: number;
}

export interface AudioMetrics {
  volume: number;       // 0.0 to 1.0
  bassLevel: number;    // 0.0 to 1.0
  isScreaming: boolean; // true when volume exceeds scream threshold
}

export interface SpatialPosition {
  x: number; // Left (-) / Right (+)
  y: number; // Down (-) / Up (+)
  z: number; // Back (+) / Forward (-) in world coordinates
  forwardDistance: number;
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

  // 1. Raw sensor readings directly from hardware
  private rawOrientation = { alpha: 0, beta: 0, gamma: 0 };
  private hasReceivedGyroData = false;

  // 2. Calibrated Origin (Zero-Point Reset)
  public isCalibrated: boolean = false;
  private needsPendingCalibration: boolean = false;
  private zeroAlpha: number = 0;
  private zeroBeta: number = 55; // Default resting phone posture in hand
  private zeroGamma: number = 0;

  // 3. Low-Pass Filter (LPF) Exponential Smoothed Relative Angles
  private smoothedAlpha: number = 0; // Relative yaw from zero point
  private smoothedBeta: number = 0;  // Relative pitch from zero point
  private smoothedGamma: number = 0; // Relative roll from zero point

  // Filter Tuning:
  // Damping factor between 0.05 and 0.10 guarantees organic inertia without micro-jitter
  public rotationDamping: number = 0.08;
  // Angular deadzone in degrees: rejects physiological hand tremor (< 0.70°)
  public angularDeadzoneDeg: number = 0.70;
  // Walk tilt deadzone: phone held within ±9.0° of calibrated neutral results in ZERO movement
  public tiltWalkDeadzoneDeg: number = 9.0;

  // 4. Spatial Position (6DOF physical translation)
  private readonly DEFAULT_X = 0.0;
  private readonly DEFAULT_Y = 1.6;
  private readonly DEFAULT_Z = 0.0;
  private position: SpatialPosition = { x: 0.0, y: 1.6, z: 0.0, forwardDistance: 0 };
  private targetPosition: SpatialPosition = { x: 0.0, y: 1.6, z: 0.0, forwardDistance: 0 };
  private linearVelocity = { x: 0, y: 0, z: 0 };
  private lastMotionTimestamp: number = 0;

  public motionSensitivity: number = 1.4;
  private accumulatedStepDistance: number = 0;
  public stepCount: number = 0;
  public physicalSpeedMps: number = 0;

  // 5. Desktop fallback manual look (Mouse / Keyboard)
  private manualEuler = { yaw: 0, pitch: 0 };

  // 6. Audio Analysis (Microphone for Level 3 Boss scream)
  private audioStream: MediaStream | null = null;
  private analyser: AnalyserNode | null = null;
  private freqDataArray: Uint8Array<ArrayBuffer> | null = null;
  private audioMetrics: AudioMetrics = { volume: 0, bassLevel: 0, isScreaming: false };
  public screamThreshold: number = 0.62;

  // 7. AR Camera Passthrough
  private cameraStream: MediaStream | null = null;
  private videoElement: HTMLVideoElement | null = null;

  // Smoothing for translation
  private readonly POS_LERP = 0.20;

  // Accelerometer gravity filter
  private gravityFilter = { x: 0, y: 9.8, z: 0 };
  private gravityFilterInitialized: boolean = false;
  private lastStepTimestamp: number = 0;
  private prevMag: number = 0;
  private isStepPeaking: boolean = false;

  constructor() {
    this.handleDeviceOrientation = this.handleDeviceOrientation.bind(this);
    this.handleDeviceOrientationAbsolute = this.handleDeviceOrientationAbsolute.bind(this);
    this.handleDeviceMotion = this.handleDeviceMotion.bind(this);

    if (typeof window !== 'undefined') {
      try {
        this.startMotionListeners();
      } catch {}
    }
  }

  public hasGyroData(): boolean {
    return this.hasReceivedGyroData;
  }

  /**
   * Request Gyroscope and Accelerometer permissions (required on iOS 13+ and Android)
   */
  public async requestGyroscope(): Promise<boolean> {
    try {
      const win = window as unknown as {
        DeviceOrientationEvent?: {
          requestPermission?: () => Promise<'granted' | 'denied'>;
        };
        DeviceMotionEvent?: {
          requestPermission?: () => Promise<'granted' | 'denied'>;
        };
      };

      let orientationGranted = true;
      if (typeof win.DeviceOrientationEvent?.requestPermission === 'function') {
        try {
          const response = await win.DeviceOrientationEvent.requestPermission();
          orientationGranted = response === 'granted';
        } catch (e) {
          console.warn('DeviceOrientationEvent permission prompt error:', e);
          orientationGranted = false;
        }
      }

      if (typeof win.DeviceMotionEvent?.requestPermission === 'function') {
        try {
          await win.DeviceMotionEvent.requestPermission();
        } catch {}
      }

      this.status.gyroscopeAllowed = orientationGranted;
      this.status.gyroscopeActive = orientationGranted;

      // Request Chromium permissions if queryable
      try {
        if (typeof navigator !== 'undefined' && 'permissions' in navigator) {
          (navigator.permissions as unknown as { query: (p: { name: string }) => Promise<unknown> })
            .query({ name: 'accelerometer' })
            .catch(() => {});
          (navigator.permissions as unknown as { query: (p: { name: string }) => Promise<unknown> })
            .query({ name: 'gyroscope' })
            .catch(() => {});
        }
      } catch {}

      this.startMotionListeners();

      // Immediately queue zero calibration so the user's initial hand position becomes (0,0,0)
      this.calibrateZeroPoint();

      return orientationGranted;
    } catch (e) {
      console.warn('requestGyroscope error:', e);
      this.status.gyroscopeAllowed = true;
      this.startMotionListeners();
      this.calibrateZeroPoint();
      return true;
    }
  }

  public startMotionListeners() {
    if (typeof window === 'undefined') return;
    try {
      window.removeEventListener('deviceorientation', this.handleDeviceOrientation, true);
      window.removeEventListener('deviceorientationabsolute', this.handleDeviceOrientationAbsolute as EventListener, true);
      window.removeEventListener('devicemotion', this.handleDeviceMotion, true);

      window.addEventListener('deviceorientation', this.handleDeviceOrientation, true);
      window.addEventListener('deviceorientationabsolute', this.handleDeviceOrientationAbsolute as EventListener, true);
      window.addEventListener('devicemotion', this.handleDeviceMotion, true);
      this.status.gyroscopeActive = true;
    } catch (e) {
      console.warn('startMotionListeners error:', e);
    }
  }

  private handleDeviceOrientationAbsolute(event: DeviceOrientationEvent) {
    this.handleDeviceOrientation(event);
  }

  /**
   * Calibrate current device physical posture as the exact Origin / Zero Point (0,0,0)
   * Eliminates autonomous drift and hand fatigue.
   */
  public calibrateZeroPoint() {
    if (this.hasReceivedGyroData && (this.rawOrientation.beta !== 0 || this.rawOrientation.alpha !== 0)) {
      this.zeroAlpha = this.rawOrientation.alpha;
      this.zeroBeta = this.rawOrientation.beta;
      this.zeroGamma = this.rawOrientation.gamma;
      this.smoothedAlpha = 0;
      this.smoothedBeta = 0;
      this.smoothedGamma = 0;
      this.isCalibrated = true;
      this.needsPendingCalibration = false;
    } else {
      // Data hasn't arrived yet; set flag so first incoming event becomes zero reference
      this.needsPendingCalibration = true;
      this.smoothedAlpha = 0;
      this.smoothedBeta = 0;
      this.smoothedGamma = 0;
    }

    this.manualEuler.yaw = 0;
    this.manualEuler.pitch = 0;
    this.linearVelocity.x = 0;
    this.linearVelocity.y = 0;
    this.linearVelocity.z = 0;
    this.accumulatedStepDistance = 0;
    this.gravityFilter = { x: 0, y: 9.8, z: 0 };
    this.gravityFilterInitialized = false;
    this.stepCount = 0;
    this.physicalSpeedMps = 0;
    this.resetPosition();
  }

  public calibrateCenter() {
    this.calibrateZeroPoint();
  }

  public resetPosition() {
    this.position = { x: this.DEFAULT_X, y: this.DEFAULT_Y, z: this.DEFAULT_Z, forwardDistance: 0 };
    this.targetPosition = { x: this.DEFAULT_X, y: this.DEFAULT_Y, z: this.DEFAULT_Z, forwardDistance: 0 };
    this.linearVelocity = { x: 0, y: 0, z: 0 };
  }

  private handleDeviceOrientation(event: DeviceOrientationEvent) {
    let alpha = event.alpha;
    const beta = event.beta;
    const gamma = event.gamma;

    // Check for iOS webkitCompassHeading
    if (
      (alpha === null || alpha === undefined) &&
      (event as unknown as { webkitCompassHeading?: number }).webkitCompassHeading !== undefined
    ) {
      alpha = (event as unknown as { webkitCompassHeading: number }).webkitCompassHeading;
    }

    if (beta !== null && beta !== undefined && gamma !== null && gamma !== undefined) {
      this.hasReceivedGyroData = true;
      this.status.gyroscopeActive = true;
      this.status.gyroscopeAllowed = true;

      // Compensate for screen orientation (portrait vs landscape)
      const screenAngle =
        typeof window !== 'undefined'
          ? ((window.screen?.orientation as unknown as { angle?: number })?.angle ??
              (typeof window.orientation === 'number' ? window.orientation : 0))
          : 0;

      let adjustedBeta = beta;
      let adjustedGamma = gamma;
      let adjustedAlpha = alpha !== null && alpha !== undefined ? alpha : 0;

      if (screenAngle === 90) {
        const temp = adjustedBeta;
        adjustedBeta = -adjustedGamma;
        adjustedGamma = temp;
      } else if (screenAngle === -90 || screenAngle === 270) {
        const temp = adjustedBeta;
        adjustedBeta = adjustedGamma;
        adjustedGamma = -temp;
      } else if (screenAngle === 180) {
        adjustedBeta = -adjustedBeta;
        adjustedGamma = -adjustedGamma;
      }

      this.rawOrientation.alpha = adjustedAlpha;
      this.rawOrientation.beta = adjustedBeta;
      this.rawOrientation.gamma = adjustedGamma;

      // If pending calibration or first initialization, capture exact current posture as neutral (0,0,0)
      if (this.needsPendingCalibration || (!this.isCalibrated && adjustedAlpha !== 0)) {
        this.zeroAlpha = adjustedAlpha;
        this.zeroBeta = adjustedBeta;
        this.zeroGamma = adjustedGamma;
        this.smoothedAlpha = 0;
        this.smoothedBeta = 0;
        this.smoothedGamma = 0;
        this.isCalibrated = true;
        this.needsPendingCalibration = false;
      }
    }
  }

  /**
   * DeviceMotion handler: calculates physical forward and lateral displacement
   * without phantom drift.
   */
  private handleDeviceMotion(event: DeviceMotionEvent) {
    this.status.motionActive = true;
    const now = performance.now();
    const dt = this.lastMotionTimestamp > 0 ? Math.min((now - this.lastMotionTimestamp) / 1000, 0.08) : 0.016;
    this.lastMotionTimestamp = now;

    let lx = 0;
    let ly = 0;
    let lz = 0;

    const rawLin = event.acceleration;
    if (
      rawLin &&
      rawLin.x !== null &&
      rawLin.y !== null &&
      rawLin.z !== null &&
      (rawLin.x !== 0 || rawLin.y !== 0 || rawLin.z !== 0)
    ) {
      lx = rawLin.x;
      ly = rawLin.y;
      lz = rawLin.z;
    } else {
      const rawGrav = event.accelerationIncludingGravity;
      if (rawGrav && rawGrav.x !== null && rawGrav.y !== null && rawGrav.z !== null) {
        if (!this.gravityFilterInitialized) {
          this.gravityFilter.x = rawGrav.x;
          this.gravityFilter.y = rawGrav.y;
          this.gravityFilter.z = rawGrav.z;
          this.gravityFilterInitialized = true;
        } else {
          const alpha = 0.88;
          this.gravityFilter.x = alpha * this.gravityFilter.x + (1 - alpha) * rawGrav.x;
          this.gravityFilter.y = alpha * this.gravityFilter.y + (1 - alpha) * rawGrav.y;
          this.gravityFilter.z = alpha * this.gravityFilter.z + (1 - alpha) * rawGrav.z;
        }

        lx = rawGrav.x - this.gravityFilter.x;
        ly = rawGrav.y - this.gravityFilter.y;
        lz = rawGrav.z - this.gravityFilter.z;
      }
    }

    // Physical projection using pitch
    const pitchRad = (((this.smoothedBeta + this.zeroBeta) || 55) * Math.PI) / 180;
    const cosPitch = Math.cos(pitchRad);
    const sinPitch = Math.sin(pitchRad);

    const rawForwardAcc = -lz * sinPitch + ly * cosPitch;
    const rawStrafeAcc = lx;

    // Pedometer step detection: intentional footsteps while exploring
    const netMag = Math.sqrt(lx * lx + ly * ly + lz * lz);
    if (netMag > 0.95 && netMag > this.prevMag) {
      this.isStepPeaking = true;
    } else if (this.isStepPeaking && netMag < this.prevMag) {
      this.isStepPeaking = false;
      const timeSinceLastStep = now - this.lastStepTimestamp;
      if (timeSinceLastStep >= 250 && timeSinceLastStep <= 1200 && this.prevMag >= 0.95) {
        this.lastStepTimestamp = now;
        this.stepCount++;

        const isRetreating = rawForwardAcc < -0.25;
        const strideMeters = (isRetreating ? -0.55 : 0.65) * this.motionSensitivity;
        this.accumulatedStepDistance += strideMeters;
        this.triggerHaptic('step');
      }
    }
    this.prevMag = netMag;

    // Deadband threshold: completely cuts out hand tremors (< 0.16 m/s^2)
    const deadband = 0.16;
    const applyDeadband = (val: number): number => {
      const abs = Math.abs(val);
      if (abs < deadband) return 0;
      return Math.sign(val) * (abs - deadband);
    };

    const accFwd = applyDeadband(rawForwardAcc);
    const accStrafe = applyDeadband(rawStrafeAcc);

    const thrustGain = 2.8 * this.motionSensitivity;
    if (accFwd !== 0) {
      this.linearVelocity.z += accFwd * dt * thrustGain;
    }
    if (accStrafe !== 0) {
      this.linearVelocity.x += accStrafe * dt * (thrustGain * 0.8);
    }

    // High friction damping: halts immediately when phone physical thrust stops
    const drag = 4.5;
    const friction = Math.exp(-drag * dt);
    this.linearVelocity.z *= friction;
    this.linearVelocity.x *= friction;

    // Hard clamp to zero when velocity drops below creeping threshold (eliminates creeping drift)
    if (Math.abs(this.linearVelocity.z) < 0.02) this.linearVelocity.z = 0;
    if (Math.abs(this.linearVelocity.x) < 0.02) this.linearVelocity.x = 0;

    // Maximum translation velocity clamp
    const maxSpeed = 1.6 * this.motionSensitivity;
    this.linearVelocity.z = Math.max(-maxSpeed, Math.min(maxSpeed, this.linearVelocity.z));
    this.linearVelocity.x = Math.max(-maxSpeed, Math.min(maxSpeed, this.linearVelocity.x));

    const deltaDistZ = this.linearVelocity.z * dt;
    if (deltaDistZ !== 0) {
      this.accumulatedStepDistance += deltaDistZ;
    }

    this.physicalSpeedMps = Math.hypot(this.linearVelocity.z, this.linearVelocity.x);
  }

  /**
   * Consume accumulated physical step/thrust displacement (meters) for external 3D spaces
   */
  public consumePhysicalStepDisplacement(): number {
    const dist = this.accumulatedStepDistance;
    this.accumulatedStepDistance = 0;
    return dist;
  }

  /**
   * Translates intentional phone forward/backward tilt into fluid walking speed (-1.0 to 1.0)
   * Guaranteed ZERO autonomous movement when phone is held naturally within deadzone.
   */
  public getPhoneTiltWalk(): { forward: number; strafe: number } {
    if (!this.hasReceivedGyroData || !this.isCalibrated) return { forward: 0, strafe: 0 };

    // smoothedBeta is 0 at the calibrated resting posture
    let forward = 0;
    // Tilting phone forward beyond deadzone initiates walking
    if (this.smoothedBeta < -this.tiltWalkDeadzoneDeg) {
      const tiltExcess = -this.smoothedBeta - this.tiltWalkDeadzoneDeg;
      // Proportional, clamped mapping (reaches 1.0 at ~26° forward dip)
      forward = Math.min(1.0, tiltExcess / 17.0);
    } else if (this.smoothedBeta > this.tiltWalkDeadzoneDeg + 3.0) {
      // Tilting phone backward backs up slowly
      const tiltExcess = this.smoothedBeta - (this.tiltWalkDeadzoneDeg + 3.0);
      forward = Math.max(-0.55, -tiltExcess / 18.0);
    }

    let strafe = 0;
    if (Math.abs(this.smoothedGamma) > 11.0) {
      const excess = Math.abs(this.smoothedGamma) - 11.0;
      strafe = Math.min(0.65, Math.max(-0.65, Math.sign(this.smoothedGamma) * (excess / 18.0)));
    }

    return { forward, strafe };
  }

  public getYawRad(): number {
    const degToRad = Math.PI / 180;
    return -this.smoothedAlpha * degToRad + this.manualEuler.yaw;
  }

  /**
   * Updates and smooths sensors on each frame using Exponential Low-Pass Filtering
   * with shortest-arc angular wrapping to eliminate stutter and 360-degree spins.
   */
  public update(): {
    orientation: { alpha: number; beta: number; gamma: number; yawRad: number; pitchRad: number; rollRad: number };
    position: SpatialPosition;
    audio: AudioMetrics;
    status: SensorStatus;
  } {
    if (this.hasReceivedGyroData && this.isCalibrated) {
      // 1. Target relative Yaw (Alpha) from zero point
      let targetRelAlpha = this.rawOrientation.alpha - this.zeroAlpha;
      // Wrap targetRelAlpha to [-180, 180]
      targetRelAlpha = ((((targetRelAlpha + 180) % 360) + 360) % 360) - 180;

      // Shortest angular difference from current smoothed yaw
      let deltaAlpha = targetRelAlpha - this.smoothedAlpha;
      deltaAlpha = ((((deltaAlpha + 180) % 360) + 360) % 360) - 180;

      // Deadzone check: suppress physiological hand tremor
      if (Math.abs(deltaAlpha) > this.angularDeadzoneDeg) {
        // Exponential Low-Pass Filter (strict damping 0.08)
        this.smoothedAlpha += deltaAlpha * this.rotationDamping;
      }

      // 2. Target relative Pitch (Beta) from zero point
      const targetRelBeta = Math.max(-75, Math.min(75, this.rawOrientation.beta - this.zeroBeta));
      const deltaBeta = targetRelBeta - this.smoothedBeta;
      if (Math.abs(deltaBeta) > this.angularDeadzoneDeg) {
        this.smoothedBeta += deltaBeta * this.rotationDamping;
      }

      // 3. Target relative Roll (Gamma) from zero point
      const targetRelGamma = Math.max(-45, Math.min(45, this.rawOrientation.gamma - this.zeroGamma));
      const deltaGamma = targetRelGamma - this.smoothedGamma;
      if (Math.abs(deltaGamma) > this.angularDeadzoneDeg) {
        this.smoothedGamma += deltaGamma * this.rotationDamping;
      }
    }

    // Convert smoothed angles to Radians with natural 1:1 proportional mapping
    const degToRad = Math.PI / 180;
    let yawRad: number;
    let pitchRad: number;
    let rollRad: number;

    if (this.hasReceivedGyroData) {
      yawRad = -this.smoothedAlpha * degToRad + this.manualEuler.yaw;
      pitchRad = Math.max(-1.35, Math.min(1.35, this.smoothedBeta * degToRad + this.manualEuler.pitch));
      rollRad = Math.max(-0.35, Math.min(0.35, -this.smoothedGamma * degToRad * 0.22));
    } else {
      yawRad = this.manualEuler.yaw;
      pitchRad = this.manualEuler.pitch;
      rollRad = 0;
    }

    // Audio Processing
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
        alpha: (this.smoothedAlpha + this.zeroAlpha + 360) % 360,
        beta: this.smoothedBeta + this.zeroBeta,
        gamma: this.smoothedGamma + this.zeroGamma,
        yawRad,
        pitchRad,
        rollRad,
      },
      position: { ...this.position },
      audio: this.audioMetrics,
      status: { ...this.status },
    };
  }

  public getSnapshot(): {
    orientation: { alpha: number; beta: number; gamma: number; yawRad: number; pitchRad: number; rollRad: number };
    position: SpatialPosition;
    audio: AudioMetrics;
    status: SensorStatus;
    stepCount: number;
    speed: number;
  } {
    const degToRad = Math.PI / 180;
    const yawRad = this.getYawRad();
    const pitchRad = Math.max(-1.35, Math.min(1.35, this.smoothedBeta * degToRad + this.manualEuler.pitch));
    const rollRad = Math.max(-0.35, Math.min(0.35, -this.smoothedGamma * degToRad * 0.22));

    return {
      orientation: {
        alpha: (this.smoothedAlpha + this.zeroAlpha + 360) % 360,
        beta: this.smoothedBeta + this.zeroBeta,
        gamma: this.smoothedGamma + this.zeroGamma,
        yawRad,
        pitchRad,
        rollRad,
      },
      position: { ...this.position },
      audio: { ...this.audioMetrics },
      status: { ...this.status },
      stepCount: this.stepCount,
      speed: this.physicalSpeedMps,
    };
  }

  public moveForward(distMeters: number) {
    const yaw = this.getYawRad();
    this.targetPosition.x += -Math.sin(yaw) * distMeters;
    this.targetPosition.z += -Math.cos(yaw) * distMeters;
    this.targetPosition.forwardDistance += distMeters;
    this.clampPosition();
  }

  public moveStrafe(distMeters: number) {
    const yaw = this.getYawRad();
    this.targetPosition.x += Math.cos(yaw) * distMeters;
    this.targetPosition.z += -Math.sin(yaw) * distMeters;
    this.clampPosition();
  }

  private clampPosition() {
    this.targetPosition.x = Math.max(-8, Math.min(8, this.targetPosition.x));
    this.targetPosition.z = Math.max(-8, Math.min(8, this.targetPosition.z));
  }

  public addManualLook(deltaYaw: number, deltaPitch: number) {
    this.manualEuler.yaw += deltaYaw;
    this.manualEuler.pitch = Math.max(-1.35, Math.min(1.35, this.manualEuler.pitch + deltaPitch));
  }

  public setManualLook(yaw: number, pitch: number) {
    this.manualEuler.yaw = yaw;
    this.manualEuler.pitch = Math.max(-1.35, Math.min(1.35, pitch));
  }

  // Audio / Microphone Setup for Level 3 Boss
  public async requestMicrophone(externalAudioCtx?: AudioContext): Promise<boolean> {
    try {
      if (this.audioStream) return true;
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: {
          echoCancellation: true,
          noiseSuppression: false,
          autoGainControl: true,
        },
        video: false,
      });

      this.audioStream = stream;
      const audioCtx =
        externalAudioCtx ||
        new (window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext)();
      const source = audioCtx.createMediaStreamSource(stream);
      this.analyser = audioCtx.createAnalyser();
      this.analyser.fftSize = 256;
      this.analyser.smoothingTimeConstant = 0.45;
      source.connect(this.analyser);

      this.freqDataArray = new Uint8Array(this.analyser.frequencyBinCount);
      this.status.micAllowed = true;
      this.status.micActive = true;
      return true;
    } catch (e) {
      console.warn('Microphone permission error:', e);
      this.status.micAllowed = false;
      this.status.micActive = false;
      return false;
    }
  }

  public async requestFrontCamera(): Promise<MediaStream | null> {
    try {
      if (this.cameraStream) return this.cameraStream;
      const constraints: MediaStreamConstraints = {
        video: {
          facingMode: 'user',
          width: { ideal: 1280 },
          height: { ideal: 720 },
        },
        audio: false,
      };

      let stream: MediaStream;
      try {
        stream = await navigator.mediaDevices.getUserMedia(constraints);
      } catch {
        stream = await navigator.mediaDevices.getUserMedia({ video: true, audio: false });
      }

      this.cameraStream = stream;
      this.status.cameraAllowed = true;
      this.status.cameraActive = true;
      return stream;
    } catch (e) {
      console.warn('Front camera request error:', e);
      this.status.cameraAllowed = false;
      this.status.cameraActive = false;
      return null;
    }
  }

  public async requestCamera(): Promise<HTMLVideoElement | null> {
    try {
      if (this.cameraStream && this.videoElement) return this.videoElement;

      const constraints: MediaStreamConstraints = {
        video: {
          facingMode: { ideal: 'environment' },
          width: { ideal: 1280 },
          height: { ideal: 720 },
        },
        audio: false,
      };

      let stream: MediaStream;
      try {
        stream = await navigator.mediaDevices.getUserMedia(constraints);
      } catch {
        stream = await navigator.mediaDevices.getUserMedia({ video: true, audio: false });
      }

      this.cameraStream = stream;
      this.status.cameraAllowed = true;
      this.status.cameraActive = true;

      return await this.attachVideoElement(stream);
    } catch (e) {
      console.warn('Camera request error:', e);
      this.status.cameraAllowed = false;
      this.status.cameraActive = false;
      return null;
    }
  }

  private async attachVideoElement(stream: MediaStream): Promise<HTMLVideoElement> {
    if (!this.videoElement) {
      this.videoElement = document.createElement('video');
      this.videoElement.setAttribute('autoplay', '');
      this.videoElement.setAttribute('muted', '');
      this.videoElement.setAttribute('playsinline', '');
      this.videoElement.setAttribute('webkit-playsinline', '');
      this.videoElement.style.position = 'fixed';
      this.videoElement.style.top = '0';
      this.videoElement.style.left = '0';
      this.videoElement.style.width = '100%';
      this.videoElement.style.height = '100%';
      this.videoElement.style.objectFit = 'cover';
      this.videoElement.style.pointerEvents = 'none';
      this.videoElement.style.zIndex = '-1';
    }

    if (this.videoElement.srcObject !== stream) {
      this.videoElement.srcObject = stream;
      await this.videoElement.play().catch(() => {});
    }

    return this.videoElement;
  }

  public getCameraStream(): MediaStream | null {
    return this.cameraStream;
  }

  public stopCamera() {
    if (this.cameraStream) {
      this.cameraStream.getTracks().forEach((track) => track.stop());
      this.cameraStream = null;
    }
    this.status.cameraActive = false;
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
      } catch {}
    }
  }

  public simulateScream(isScreaming: boolean) {
    this.audioMetrics.isScreaming = isScreaming;
    this.audioMetrics.volume = isScreaming ? 0.95 : 0;
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
