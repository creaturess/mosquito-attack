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

  // 1. Raw sensor readings
  private rawOrientation = { alpha: 0, beta: 0, gamma: 0 };

  // 2. Calibrated Zero Point (Point Zero 0,0,0 reference)
  public isCalibrated: boolean = false;
  private zeroAlpha: number = 0;
  private zeroBeta: number = 60; // neutral resting phone pitch
  private zeroGamma: number = 0;

  // 3. Low-Pass Filter (LPF) smoothed relative angles
  private smoothedAlpha: number = 0;
  private smoothedBeta: number = 0;
  private smoothedGamma: number = 0;

  // 4. Robust tuning parameters for smooth organic exploration
  public rotationDamping: number = 0.09; // Low-pass filter damping factor (0.05 to 0.15)
  public angularDeadzoneDeg: number = 0.75; // Hand tremor deadzone in degrees
  public tiltWalkDeadzoneDeg: number = 10.0; // Walk tilt deadzone in degrees
  public yawSensitivity: number = 1.0; // 1:1 proportional scale
  public pitchSensitivity: number = 1.0;

  private hasReceivedGyroData = false;

  // Spatial Translation state (6DOF position tracking in real environment)
  private readonly DEFAULT_X = 0.0;
  private readonly DEFAULT_Y = 1.6; // Standing eye-level
  private readonly DEFAULT_Z = 0.0; // Origin in real room
  private position: SpatialPosition = { x: 0.0, y: 1.6, z: 0.0, forwardDistance: 0 };
  private targetPosition: SpatialPosition = { x: 0.0, y: 1.6, z: 0.0, forwardDistance: 0 };
  private linearVelocity = { x: 0, y: 0, z: 0 };
  private lastMotionTimestamp: number = 0;

  // Sensitivity settings
  public motionSensitivity: number = 1.5; // Calibrated for natural physical phone translation
  public tiltAssistEnabled: boolean = false;

  // Manual touch/mouse drag fallback for desktop / non-gyro devices
  private manualEuler = { yaw: 0, pitch: 0 };

  // Microphone state
  private audioStream: MediaStream | null = null;
  private analyser: AnalyserNode | null = null;
  private freqDataArray: Uint8Array<ArrayBuffer> | null = null;
  private audioMetrics: AudioMetrics = { volume: 0, bassLevel: 0, isScreaming: false };
  public screamThreshold: number = 0.62;

  // Camera video stream for AR background (strictly rear / environment camera)
  private cameraStream: MediaStream | null = null;
  private videoElement: HTMLVideoElement | null = null;

  // Smoothing factors: balanced for rock-solid 1:1 feel without jitter
  private readonly ROT_LERP = 0.16;
  private readonly POS_LERP = 0.22;

  // Real room spatial movement limits (calibrated to the 1.85x bedroom scale)
  private readonly LIMIT_X = 8.1;
  private readonly LIMIT_Y_UP = 3.2;
  private readonly LIMIT_Y_DOWN = 0.8;
  private readonly LIMIT_Z = 7.5;

  private listenersAttached: boolean = false;
  private gravityFilterInitialized: boolean = false;

  constructor() {
    this.handleDeviceOrientation = this.handleDeviceOrientation.bind(this);
    this.handleDeviceOrientationAbsolute = this.handleDeviceOrientationAbsolute.bind(this);
    this.handleDeviceMotion = this.handleDeviceMotion.bind(this);

    // Proactively attach on modern Android / Chromium browsers (no user gesture required)
    if (typeof window !== 'undefined') {
      try {
        this.startMotionListeners();
      } catch {}
    }
  }

  /**
   * Check whether real gyroscope data is actively being received from the device
   */
  public hasGyroData(): boolean {
    return this.hasReceivedGyroData;
  }

  /**
   * Request Gyroscope and Accelerometer permissions (required on iOS 13+) and attach listeners
   */
  public async requestGyroscope(): Promise<boolean> {
    try {
      // Check if iOS DeviceOrientationEvent.requestPermission exists
      const win = window as unknown as {
        DeviceOrientationEvent?: {
          requestPermission?: () => Promise<'granted' | 'denied'>;
        };
        DeviceMotionEvent?: {
          requestPermission?: () => Promise<'granted' | 'denied'>;
        };
      };

      if (typeof win.DeviceOrientationEvent?.requestPermission === 'function') {
        try {
          const response = await win.DeviceOrientationEvent.requestPermission();
          if (response === 'granted') {
            this.status.gyroscopeAllowed = true;
            this.status.gyroscopeActive = true;
          } else {
            this.status.gyroscopeAllowed = false;
            this.status.gyroscopeActive = false;
            return false;
          }
        } catch (permErr) {
          console.warn('DeviceOrientationEvent.requestPermission prompt error:', permErr);
        }
      } else {
        this.status.gyroscopeAllowed = true;
      }

      // Check if iOS DeviceMotionEvent.requestPermission exists
      if (typeof win.DeviceMotionEvent?.requestPermission === 'function') {
        try {
          await win.DeviceMotionEvent.requestPermission();
        } catch {
          // ignore if already granted or failed
        }
      }

      // Android permission queries (Chromium/Android 79+)
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
      return true;
    } catch (e) {
      console.warn('Error requesting gyroscope/motion permission:', e);
      this.status.gyroscopeAllowed = true;
      this.startMotionListeners();
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
      // Many Android phones (Pixel, Samsung, Xiaomi) fire deviceorientationabsolute with full 3D angles
      window.addEventListener('deviceorientationabsolute', this.handleDeviceOrientationAbsolute as EventListener, true);
      window.addEventListener('devicemotion', this.handleDeviceMotion, true);
      this.listenersAttached = true;
      this.status.gyroscopeActive = true;
    } catch (e) {
      console.warn('startMotionListeners error:', e);
    }
  }

  private handleDeviceOrientationAbsolute(event: DeviceOrientationEvent) {
    this.handleDeviceOrientation(event);
  }

  /**
   * Calibrate current device physical posture as the exact Zero Point (0,0) reference
   */
  public calibrateZeroPoint() {
    this.zeroAlpha = this.rawOrientation.alpha;
    this.zeroBeta = this.rawOrientation.beta !== 0 ? this.rawOrientation.beta : 60;
    this.zeroGamma = this.rawOrientation.gamma !== 0 ? this.rawOrientation.gamma : 0;
    this.smoothedAlpha = 0;
    this.smoothedBeta = 0;
    this.smoothedGamma = 0;
    this.isCalibrated = true;
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

  // Backward-compatible alias
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

    // Check for iOS webkitCompassHeading or Android devices with compass heading
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

      // Compensate for screen orientation (portrait vs landscape across diverse phone models)
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

      // Auto-calibrate point zero on the very first orientation event if not yet calibrated
      if (!this.isCalibrated && adjustedAlpha !== 0) {
        this.calibrateZeroPoint();
      }
    }
  }

  // Physical motion tracking
  private gravityFilter = { x: 0, y: 9.8, z: 0 };
  private lastStepTimestamp: number = 0;
  private prevMag: number = 0;
  private isStepPeaking: boolean = false;
  public stepCount: number = 0;
  public physicalSpeedMps: number = 0;
  private accumulatedStepDistance: number = 0;

  /**
   * DeviceMotion handler: calculates physical forward, backward, and lateral displacement
   * when the user physically moves the phone, steps, or pushes/pulls in physical space.
   * Proportional and natural ("a la par con el movimiento del celular").
   */
  private handleDeviceMotion(event: DeviceMotionEvent) {
    this.status.motionActive = true;
    const now = performance.now();
    const dt = this.lastMotionTimestamp > 0 ? Math.min((now - this.lastMotionTimestamp) / 1000, 0.08) : 0.016;
    this.lastMotionTimestamp = now;

    // 1. Extract linear acceleration without gravity
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
      // Fallback to high-pass filtered accelerationIncludingGravity
      const rawGrav = event.accelerationIncludingGravity;
      if (rawGrav && rawGrav.x !== null && rawGrav.y !== null && rawGrav.z !== null) {
        if (!this.gravityFilterInitialized) {
          this.gravityFilter.x = rawGrav.x;
          this.gravityFilter.y = rawGrav.y;
          this.gravityFilter.z = rawGrav.z;
          this.gravityFilterInitialized = true;
        } else {
          const alpha = 0.86;
          this.gravityFilter.x = alpha * this.gravityFilter.x + (1 - alpha) * rawGrav.x;
          this.gravityFilter.y = alpha * this.gravityFilter.y + (1 - alpha) * rawGrav.y;
          this.gravityFilter.z = alpha * this.gravityFilter.z + (1 - alpha) * rawGrav.z;
        }

        lx = rawGrav.x - this.gravityFilter.x;
        ly = rawGrav.y - this.gravityFilter.y;
        lz = rawGrav.z - this.gravityFilter.z;
      }
    }

    // 2. Physical projection based on current phone pitch tilt
    // Player holds phone tilted back by ~45-75 deg. Forward in world is along camera horizontal gaze.
    const pitchRad = (((this.smoothedBeta + this.zeroBeta) || 60) * Math.PI) / 180;
    const cosPitch = Math.cos(pitchRad);
    const sinPitch = Math.sin(pitchRad);

    // Forward/backward thrust in phone orientation:
    // -lz pushes forward into space; +ly projects forward when phone is tilted back
    const rawForwardAcc = -lz * sinPitch + ly * cosPitch;
    const rawStrafeAcc = lx;

    // 3. Pedometer step detection:
    // When physically walking while holding phone, steps create impulse peaks
    const netMag = Math.sqrt(lx * lx + ly * ly + lz * lz);
    if (netMag > 0.85 && netMag > this.prevMag) {
      this.isStepPeaking = true;
    } else if (this.isStepPeaking && netMag < this.prevMag) {
      this.isStepPeaking = false;
      const timeSinceLastStep = now - this.lastStepTimestamp;
      if (timeSinceLastStep >= 240 && timeSinceLastStep <= 1200 && this.prevMag >= 0.85) {
        this.lastStepTimestamp = now;
        this.stepCount++;

        // Stride displacement: step forward or backward in room
        const isRetreating = rawForwardAcc < -0.2;
        const strideMeters = (isRetreating ? -0.55 : 0.65) * this.motionSensitivity;
        this.accumulatedStepDistance += strideMeters;
        this.moveForward(strideMeters);
        this.triggerHaptic('step');
      }
    }
    this.prevMag = netMag;

    // 4. Continuous physical thrust integration (pushing / pulling phone in air)
    // Responsive deadband to reject hand micro-tremors without losing intentional motion
    const deadband = 0.12;
    const applyDeadband = (val: number): number => {
      const abs = Math.abs(val);
      if (abs < deadband) return 0;
      return Math.sign(val) * (abs - deadband);
    };

    const accFwd = applyDeadband(rawForwardAcc);
    const accStrafe = applyDeadband(rawStrafeAcc);

    // Integrate into velocity with calibrated gain
    const thrustGain = 3.6 * this.motionSensitivity;
    if (accFwd !== 0) {
      this.linearVelocity.z += accFwd * dt * thrustGain;
    }
    if (accStrafe !== 0) {
      this.linearVelocity.x += accStrafe * dt * (thrustGain * 0.8);
    }

    // Natural friction damping: smooth halt when phone stops moving
    const drag = 3.8;
    const friction = Math.exp(-drag * dt);
    this.linearVelocity.z *= friction;
    this.linearVelocity.x *= friction;

    // Prevent micro-creeping
    if (Math.abs(this.linearVelocity.z) < 0.015) this.linearVelocity.z = 0;
    if (Math.abs(this.linearVelocity.x) < 0.015) this.linearVelocity.x = 0;

    // Clamp maximum physical translation speed
    const maxSpeed = 1.8 * this.motionSensitivity;
    this.linearVelocity.z = Math.max(-maxSpeed, Math.min(maxSpeed, this.linearVelocity.z));
    this.linearVelocity.x = Math.max(-maxSpeed, Math.min(maxSpeed, this.linearVelocity.x));

    // 5. Apply displacement in 3D bedroom along camera's current gaze yaw
    const yaw = this.getYawRad();
    const forwardDirX = -Math.sin(yaw);
    const forwardDirZ = -Math.cos(yaw);
    const rightDirX = Math.cos(yaw);
    const rightDirZ = -Math.sin(yaw);

    const deltaDistZ = this.linearVelocity.z * dt;
    const deltaDistX = this.linearVelocity.x * dt;

    if (deltaDistZ !== 0 || deltaDistX !== 0) {
      this.targetPosition.x += forwardDirX * deltaDistZ + rightDirX * deltaDistX;
      this.targetPosition.z += forwardDirZ * deltaDistZ + rightDirZ * deltaDistX;
      this.targetPosition.forwardDistance += deltaDistZ;
      this.accumulatedStepDistance += deltaDistZ;
      this.clampTargetPosition();
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
   * Designed specifically for intuitive phone walking in MODO CAMPO:
   * - Holding phone at resting angle (~55°-65°): standstill, zero drift
   * - Dipping phone slightly forward (> 8° from resting): walk forward smoothly
   * - Tilting phone slightly backward (> 14° from resting): back up slowly
   * - Tilting phone sideways (> 10°): strafe left/right
   */
  /**
   * Translates intentional phone forward/backward tilt into fluid walking speed (-1.0 to 1.0)
   * With strict deadzone to guarantee ZERO phantom walking when holding the phone naturally.
   */
  public getPhoneTiltWalk(): { forward: number; strafe: number } {
    if (!this.hasReceivedGyroData) return { forward: 0, strafe: 0 };

    // smoothedBeta is 0 at the calibrated resting posture
    let forward = 0;
    // Deadzone: tilting phone forward by > 10 degrees initiates walking
    if (this.smoothedBeta < -this.tiltWalkDeadzoneDeg) {
      const tiltExcess = -this.smoothedBeta - this.tiltWalkDeadzoneDeg;
      // Proportional scale: smooth acceleration up to 1.0 (reaches max at ~28° forward tilt)
      forward = Math.min(1.0, tiltExcess / 18.0);
    } else if (this.smoothedBeta > this.tiltWalkDeadzoneDeg + 4.0) {
      // Tilting phone backward by > 14 degrees backs up slowly
      const tiltExcess = this.smoothedBeta - (this.tiltWalkDeadzoneDeg + 4.0);
      forward = Math.max(-0.6, -tiltExcess / 20.0);
    }

    let strafe = 0;
    if (Math.abs(this.smoothedGamma) > 12.0) {
      const excess = Math.abs(this.smoothedGamma) - 12.0;
      strafe = Math.min(0.7, Math.max(-0.7, Math.sign(this.smoothedGamma) * (excess / 20.0)));
    }

    return { forward, strafe };
  }

  public getYawRad(): number {
    const degToRad = Math.PI / 180;
    return -this.smoothedAlpha * degToRad * this.yawSensitivity + this.manualEuler.yaw;
  }

  // Virtual Joystick input state
  private joystickInput = { x: 0, y: 0 };

  public setJoystickInput(x: number, y: number) {
    this.joystickInput.x = Math.max(-1, Math.min(1, x));
    this.joystickInput.y = Math.max(-1, Math.min(1, y));
  }

  public getJoystickInput(): { x: number; y: number } {
    return this.joystickInput;
  }

  /**
   * Continuous movement via virtual touch joystick in room space
   * @param strafe: -1.0 (left) to 1.0 (right)
   * @param forward: -1.0 (backward) to 1.0 (forward)
   * @param deltaMeters: distance factor (speed * dt)
   */
  public moveJoystick(strafe: number, forward: number, deltaMeters: number) {
    if (Math.abs(strafe) < 0.05 && Math.abs(forward) < 0.05) return;

    const yaw = this.getYawRad();
    // Forward direction in world space (relative to camera yaw)
    const forwardDirX = -Math.sin(yaw);
    const forwardDirZ = -Math.cos(yaw);
    // Right strafe direction
    const rightDirX = Math.cos(yaw);
    const rightDirZ = -Math.sin(yaw);

    const dx = (forwardDirX * forward + rightDirX * strafe) * deltaMeters;
    const dz = (forwardDirZ * forward + rightDirZ * strafe) * deltaMeters;

    this.targetPosition.x += dx;
    this.targetPosition.z += dz;
    this.targetPosition.forwardDistance += (forward * deltaMeters);

    this.clampTargetPosition();
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
  /**
   * Request Microphone permission and set up AnalyserNode
   */
  public async requestMicrophone(audioCtx?: AudioContext): Promise<boolean> {
    if (typeof navigator === 'undefined' || !navigator.mediaDevices?.getUserMedia) {
      console.warn('Microphone not supported in this browser/context');
      this.status.micAllowed = false;
      this.status.micActive = false;
      return false;
    }

    try {
      const micPromise = navigator.mediaDevices.getUserMedia({
        audio: {
          echoCancellation: false,
          noiseSuppression: false,
          autoGainControl: false,
        },
      });

      // Strict 3.5s timeout so mobile browsers never hang indefinitely
      const timeoutPromise = new Promise<null>((resolve) => setTimeout(() => resolve(null), 3500));
      const stream = await Promise.race([micPromise, timeoutPromise]);

      if (!stream) {
        console.warn('Microphone request timed out or cancelled');
        return false;
      }

      this.audioStream = stream;

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
   * Request and initialize Front Camera (selfie / user-facing camera)
   * Only front camera is permitted.
   */
  public async requestFrontCamera(): Promise<MediaStream | null> {
    if (typeof navigator === 'undefined' || !navigator.mediaDevices?.getUserMedia) {
      console.warn('Camera not supported in this browser/context');
      this.status.cameraAllowed = false;
      this.status.cameraActive = false;
      return null;
    }

    // If stream is already active and healthy, reuse it to avoid video flicker
    if (this.cameraStream && this.cameraStream.active) {
      const videoTracks = this.cameraStream.getVideoTracks();
      if (videoTracks.length > 0 && videoTracks[0].readyState === 'live') {
        this.status.cameraAllowed = true;
        this.status.cameraActive = true;
        return this.cameraStream;
      }
    }

    // Stop any stale tracks
    if (this.cameraStream) {
      this.cameraStream.getTracks().forEach((track) => track.stop());
      this.cameraStream = null;
    }

    try {
      // 1. Strict front camera request (facingMode: 'user')
      const camPromise = navigator.mediaDevices.getUserMedia({
        video: {
          facingMode: { ideal: 'user' },
          width: { ideal: 1280 },
          height: { ideal: 720 },
        },
        audio: false,
      });

      const timeoutPromise = new Promise<null>((resolve) => setTimeout(() => resolve(null), 3500));
      const res = await Promise.race([camPromise, timeoutPromise]);

      if (res) {
        this.cameraStream = res;
        this.status.cameraAllowed = true;
        this.status.cameraActive = true;
        return this.cameraStream;
      }
      throw new Error('Front camera primary request timeout');
    } catch (err) {
      console.warn('Initial front camera request error, trying basic user facingMode:', err);
      try {
        // 2. Fallback: simple facingMode 'user'
        const fallbackPromise = navigator.mediaDevices.getUserMedia({
          video: { facingMode: 'user' },
          audio: false,
        });
        const timeoutPromise = new Promise<null>((resolve) => setTimeout(() => resolve(null), 3000));
        const res = await Promise.race([fallbackPromise, timeoutPromise]);

        if (res) {
          this.cameraStream = res;
          this.status.cameraAllowed = true;
          this.status.cameraActive = true;
          return this.cameraStream;
        }
        throw new Error('Front camera fallback request timeout');
      } catch (fallbackErr) {
        console.warn('Front camera request failed or denied:', fallbackErr);
        this.status.cameraAllowed = false;
        this.status.cameraActive = false;
        return null;
      }
    }
  }

  /**
   * Alias for backward compatibility - points to requestFrontCamera
   */
  public async requestRearCamera(): Promise<MediaStream | null> {
    return this.requestFrontCamera();
  }

  /**
   * Request camera and return an HTMLVideoElement (strictly front camera)
   */
  public async requestCamera(): Promise<HTMLVideoElement | null> {
    const stream = await this.requestFrontCamera();
    if (!stream) return null;

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

  /**
   * Updates and smooths sensors on each animation frame
   */
  public update(): {
    orientation: { alpha: number; beta: number; gamma: number; yawRad: number; pitchRad: number; rollRad: number };
    position: SpatialPosition;
    audio: AudioMetrics;
    status: SensorStatus;
  } {
    // 1. Low-Pass Filter (LPF) & Deadzone applied to rotation angles (alpha, beta, gamma)
    if (this.hasReceivedGyroData) {
      let targetRelAlpha = this.rawOrientation.alpha - this.zeroAlpha;
      while (targetRelAlpha > 180) targetRelAlpha -= 360;
      while (targetRelAlpha < -180) targetRelAlpha += 360;

      const targetRelBeta = this.rawOrientation.beta - this.zeroBeta;
      const targetRelGamma = this.rawOrientation.gamma - this.zeroGamma;

      // Angular deadzone check: reject hand tremor & micro-vibrations
      const dAlpha = targetRelAlpha - this.smoothedAlpha;
      if (Math.abs(dAlpha) > this.angularDeadzoneDeg) {
        this.smoothedAlpha += dAlpha * this.rotationDamping;
      }

      const dBeta = targetRelBeta - this.smoothedBeta;
      if (Math.abs(dBeta) > this.angularDeadzoneDeg) {
        this.smoothedBeta += dBeta * this.rotationDamping;
      }

      const dGamma = targetRelGamma - this.smoothedGamma;
      if (Math.abs(dGamma) > this.angularDeadzoneDeg) {
        this.smoothedGamma += dGamma * this.rotationDamping;
      }
    }

    // Convert smoothed angles to Radians with 1:1 proportional mapping
    const degToRad = Math.PI / 180;
    let yawRad: number;
    let pitchRad: number;
    let rollRad: number;

    if (this.hasReceivedGyroData) {
      yawRad = -this.smoothedAlpha * degToRad * this.yawSensitivity + this.manualEuler.yaw;
      pitchRad = Math.max(-1.42, Math.min(1.42, this.smoothedBeta * degToRad * this.pitchSensitivity + this.manualEuler.pitch));
      rollRad = Math.max(-0.35, Math.min(0.35, -this.smoothedGamma * degToRad * 0.25));
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

  /**
   * Returns a snapshot of the current sensor state and spatial position without advancing lerp interpolation
   */
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
    const pitchRad = Math.max(-1.42, Math.min(1.42, this.smoothedBeta * degToRad * this.pitchSensitivity + this.manualEuler.pitch));
    const rollRad = Math.max(-0.35, Math.min(0.35, -this.smoothedGamma * degToRad * 0.25));

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
