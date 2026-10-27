/**
 * Mosquito.ts
 * High-legibility 3D Mosquito entity with:
 * - Full opacity (1.0 solid) within visible range (<= 4m), smooth fade-in between 6m and 4m
 * - High-contrast body with subtle light outline/rim for visibility on dark and light backgrounds
 * - Guaranteed minimum screen size (never becomes an invisible speck)
 * - Motion trail (estela de movimiento) fading over ~0.4s to aid visual tracking
 * - Angular velocity capping (<= 75 deg/sec in view) and smooth eased turns
 * - Screen-edge lingering to prevent losing sight of the mosquito abruptly
 * - 3D world-nest anchoring and 4.0s respawning upon death
 */

import * as THREE from 'three';
import { GAMEPLAY_CONFIG } from '../config/gameplayConfig';

export interface MosquitoOptions {
  id: string;
  nestId: string;
  nestPosition: THREE.Vector3;
  nestRadius?: number;
  isBoss?: boolean;
  scale?: number;
  speed?: number;
  level?: 1 | 2 | 3;
}

interface TrailPoint {
  position: THREE.Vector3;
  timestamp: number;
}

export class Mosquito {
  public id: string;
  public nestId: string;
  public nestPosition: THREE.Vector3;
  public nestRadius: number;
  public group: THREE.Group;
  public isBoss: boolean;
  public isDead: boolean = false;
  public deathTime: number = 0;
  public level: 1 | 2 | 3;

  // Wings & body meshes
  private leftWing: THREE.Mesh;
  private rightWing: THREE.Mesh;
  public hitSphere: THREE.Mesh;

  // Motion Trail (Estela de movimiento)
  public trailLine: THREE.Line;
  private trailPoints: TrailPoint[] = [];
  private trailPositionsArray: Float32Array;

  // Flight dynamics & speed
  public baseSpeed: number;
  public currentSpeed: number;
  private flapSpeed: number;
  private timeOffset: number;
  public flightVelocity: THREE.Vector3 = new THREE.Vector3();

  // Lissajous orbital frequencies & phases
  private freqX1: number;
  private freqX2: number;
  private freqY1: number;
  private freqY2: number;
  private freqZ1: number;
  private freqZ2: number;
  private phaseX: number;
  private phaseY: number;
  private phaseZ: number;

  // Picos de aceleración ocasionales (zigzags breves y poco frecuentes)
  private dartTimer: number = 0;
  private nextDartInterval: number = 5.0;
  private dartDuration: number = 0.22;
  private dartProgress: number = 0;
  public isDarting: boolean = false;
  private dartOffset: THREE.Vector3 = new THREE.Vector3();

  // Screen tracking state
  public wasInView: boolean = false;
  public edgeLingerTimer: number = 0;
  public lastExitDirection: { x: number; y: number } | null = null;
  public lastExitTimestamp: number = 0;

  // Materials & Opacity
  public materials: THREE.Material[] = [];
  public currentOpacity: number = 0.0;
  public baseScale: number;

  constructor(options: MosquitoOptions) {
    this.id = options.id;
    this.nestId = options.nestId;
    this.nestPosition = options.nestPosition.clone();
    this.nestRadius = options.nestRadius || (options.isBoss ? 2.5 : 1.35 + Math.random() * 0.9);
    this.isBoss = !!options.isBoss;
    this.level = options.level || 1;

    const cfg = GAMEPLAY_CONFIG;
    const defaultSpeed = this.isBoss
      ? 0.2
      : this.level === 1
      ? cfg.movement.baseSpeedLvl1
      : cfg.movement.baseSpeedLvl2;
    this.baseSpeed = options.speed || defaultSpeed;
    this.currentSpeed = this.baseSpeed;

    this.baseScale = options.scale || (this.isBoss ? cfg.visibility.bossScale : cfg.visibility.baseScale);
    this.flapSpeed = this.isBoss ? 28 : this.level === 1 ? 42 : 58;
    this.timeOffset = Math.random() * 100;

    // Organic Lissajous frequencies
    this.freqX1 = 0.35 + Math.random() * 0.25;
    this.freqX2 = 0.75 + Math.random() * 0.3;
    this.freqY1 = 0.28 + Math.random() * 0.22;
    this.freqY2 = 0.65 + Math.random() * 0.28;
    this.freqZ1 = 0.42 + Math.random() * 0.25;
    this.freqZ2 = 0.85 + Math.random() * 0.3;

    this.phaseX = Math.random() * Math.PI * 2;
    this.phaseY = Math.random() * Math.PI * 2;
    this.phaseZ = Math.random() * Math.PI * 2;

    this.group = new THREE.Group();
    this.group.position.copy(this.nestPosition);

    // --- High-Contrast Materials with Clean Light Outline ---
    // Dark body with subtle metallic reflection
    const bodyMat = new THREE.MeshStandardMaterial({
      color: this.isBoss ? 0x2b0615 : 0x141619,
      roughness: 0.45,
      metalness: 0.15,
      transparent: true,
      opacity: 0.0,
    });
    this.materials.push(bodyMat);

    // Subtle light outline/rim material for high contrast on light & dark backgrounds
    const outlineMat = new THREE.MeshBasicMaterial({
      color: cfg.visibility.outlineColor,
      side: THREE.BackSide,
      transparent: true,
      opacity: 0.0,
    });
    this.materials.push(outlineMat);

    // Bright glowing compound eyes
    const eyeMat = new THREE.MeshBasicMaterial({
      color: this.isBoss ? 0xff0055 : 0xff2200,
      transparent: true,
      opacity: 0.0,
    });
    this.materials.push(eyeMat);

    // Visible translucent wings
    const wingMat = new THREE.MeshBasicMaterial({
      color: this.isBoss ? 0xf472b6 : 0xdbeafe,
      transparent: true,
      opacity: 0.0,
      side: THREE.DoubleSide,
    });
    this.materials.push(wingMat);

    const needleMat = new THREE.MeshBasicMaterial({
      color: 0x09090b,
      transparent: true,
      opacity: 0.0,
    });
    this.materials.push(needleMat);

    // --- Mesh Hierarchy ---
    // 1. Abdomen
    const abdomenGeo = new THREE.ConeGeometry(0.18, 0.9, 8);
    abdomenGeo.rotateX(Math.PI / 2);
    const abdomen = new THREE.Mesh(abdomenGeo, bodyMat);
    abdomen.position.set(0, 0, 0.45);
    this.group.add(abdomen);

    // Outline for Abdomen
    const abdomenOutline = new THREE.Mesh(
      abdomenGeo,
      outlineMat
    );
    abdomenOutline.scale.set(1.12, 1.08, 1.12);
    abdomenOutline.position.copy(abdomen.position);
    this.group.add(abdomenOutline);

    // 2. Thorax
    const thoraxGeo = new THREE.SphereGeometry(0.24, 8, 8);
    const thorax = new THREE.Mesh(thoraxGeo, bodyMat);
    this.group.add(thorax);

    // Outline for Thorax
    const thoraxOutline = new THREE.Mesh(thoraxGeo, outlineMat);
    thoraxOutline.scale.setScalar(1.14);
    this.group.add(thoraxOutline);

    // 3. Head
    const headGeo = new THREE.SphereGeometry(0.16, 8, 8);
    const head = new THREE.Mesh(headGeo, bodyMat);
    head.position.set(0, 0.05, -0.32);
    this.group.add(head);

    // 4. Glowing Eyes
    const eyeGeo = new THREE.SphereGeometry(0.075, 6, 6);
    const leftEye = new THREE.Mesh(eyeGeo, eyeMat);
    leftEye.position.set(-0.09, 0.1, -0.38);
    const rightEye = new THREE.Mesh(eyeGeo, eyeMat);
    rightEye.position.set(0.09, 0.1, -0.38);
    this.group.add(leftEye, rightEye);

    // 5. Proboscis
    const needleGeo = new THREE.CylinderGeometry(0.018, 0.035, 0.45, 5);
    needleGeo.rotateX(Math.PI / 3);
    const needle = new THREE.Mesh(needleGeo, needleMat);
    needle.position.set(0, -0.15, -0.5);
    this.group.add(needle);

    // 6. Wings
    const wingGeo = new THREE.PlaneGeometry(0.3, 0.9);
    wingGeo.translate(0, 0.45, 0);
    wingGeo.rotateX(Math.PI / 2);

    this.leftWing = new THREE.Mesh(wingGeo, wingMat);
    this.leftWing.position.set(-0.12, 0.18, -0.05);
    this.leftWing.rotation.y = 0.5;

    this.rightWing = new THREE.Mesh(wingGeo, wingMat);
    this.rightWing.position.set(0.12, 0.18, -0.05);
    this.rightWing.rotation.y = -0.5;

    this.group.add(this.leftWing, this.rightWing);

    // 7. Legs
    for (let i = -1; i <= 1; i++) {
      const legGeo = new THREE.CylinderGeometry(0.015, 0.015, 0.65, 3);
      const lLeg = new THREE.Mesh(legGeo, needleMat);
      lLeg.position.set(-0.25, -0.2, i * 0.18);
      lLeg.rotation.z = 0.8;
      lLeg.rotation.x = i * 0.3;
      const rLeg = new THREE.Mesh(legGeo, needleMat);
      rLeg.position.set(0.25, -0.2, i * 0.18);
      rLeg.rotation.z = -0.8;
      rLeg.rotation.x = i * 0.3;
      this.group.add(lLeg, rLeg);
    }

    // 8. Hit detection sphere - Generous hitbox
    const hitRadius = this.isBoss ? 3.2 : cfg.trackingAid.hitSphereRadius;
    const hitGeo = new THREE.SphereGeometry(hitRadius, 6, 6);
    const hitMat = new THREE.MeshBasicMaterial({ visible: false, wireframe: true });
    this.hitSphere = new THREE.Mesh(hitGeo, hitMat);
    this.hitSphere.userData = { mosquitoId: this.id, isBoss: this.isBoss };
    this.group.add(this.hitSphere);

    // 9. Motion Trail Geometry & Line
    const maxTrailPoints = cfg.trail.maxPoints;
    this.trailPositionsArray = new Float32Array(maxTrailPoints * 3);
    const trailGeo = new THREE.BufferGeometry();
    trailGeo.setAttribute(
      'position',
      new THREE.BufferAttribute(this.trailPositionsArray, 3)
    );
    const trailMat = new THREE.LineBasicMaterial({
      color: cfg.trail.color,
      transparent: true,
      opacity: cfg.trail.opacity,
      linewidth: 2,
    });
    this.materials.push(trailMat);
    this.trailLine = new THREE.Line(trailGeo, trailMat);
    this.trailLine.frustumCulled = false;

    // Start with zero opacity
    this.group.scale.setScalar(this.baseScale * cfg.visibility.minScaleFactor);
  }

  /**
   * Flight physics & organic Lissajous orbital update with angular speed clamping
   */
  public update(
    delta: number,
    elapsedTime: number,
    playerPos: THREE.Vector3,
    reactiveAudioLevel: number = 0,
    cameraMatrixInverse?: THREE.Matrix4,
    cameraAspect: number = 1.0
  ) {
    const cfg = GAMEPLAY_CONFIG;

    if (this.isDead) {
      this.group.position.y -= delta * 3.5;
      this.group.rotation.x += delta * 6;
      this.group.rotation.z += delta * 4;
      this.group.scale.multiplyScalar(0.95);
      // Clear trail when dead
      this.trailPoints = [];
      this.updateTrailGeometry();
      return;
    }

    const t = elapsedTime + this.timeOffset;
    const distToCamera = this.group.position.distanceTo(playerPos);

    // --- 1. Check if mosquito is in player's field of view ---
    let isInView = false;
    let screenRelX = 0;
    let screenRelY = 0;

    if (cameraMatrixInverse) {
      const relCam = this.group.position.clone().applyMatrix4(cameraMatrixInverse);
      if (relCam.z < -0.2) {
        const fovTan = Math.tan((35 * Math.PI) / 180); // 70deg FOV half
        const halfWidthAtZ = -relCam.z * fovTan * cameraAspect;
        const halfHeightAtZ = -relCam.z * fovTan;

        screenRelX = relCam.x / halfWidthAtZ;
        screenRelY = relCam.y / halfHeightAtZ;

        isInView = Math.abs(screenRelX) <= 1.05 && Math.abs(screenRelY) <= 1.05;
      }
    }

    // Detect exit from screen and record edge exit direction
    if (this.wasInView && !isInView) {
      this.edgeLingerTimer = cfg.movement.screenEdgeLingerTime;
      const angle = Math.atan2(screenRelY, screenRelX);
      this.lastExitDirection = { x: Math.cos(angle), y: Math.sin(angle) };
      this.lastExitTimestamp = performance.now();
    }
    this.wasInView = isInView;

    if (this.edgeLingerTimer > 0) {
      this.edgeLingerTimer -= delta;
    }

    // --- 2. Lissajous Organic Trajectory around fixed Nest ---
    const rad = this.nestRadius;
    const lissX = Math.sin(t * this.freqX1 + this.phaseX) * rad + Math.cos(t * this.freqX2) * (rad * 0.4);
    const lissY = Math.sin(t * this.freqY1 + this.phaseY) * (rad * 0.4) + Math.cos(t * this.freqY2) * 0.22;
    const lissZ = Math.cos(t * this.freqZ1 + this.phaseZ) * rad + Math.sin(t * this.freqZ2) * (rad * 0.4);

    let targetPos = this.nestPosition.clone().add(new THREE.Vector3(lissX, lissY, lissZ));

    // If lingering near edge, curve trajectory gently towards center to give player time to reacquire
    if (this.edgeLingerTimer > 0 && this.lastExitDirection) {
      const nudgeBack = new THREE.Vector3(
        -this.lastExitDirection.x * 0.8,
        -this.lastExitDirection.y * 0.5,
        0
      );
      targetPos.add(nudgeBack);
    }

    // --- 3. Darting Acceleration & Zigzags (brief and infrequent) ---
    this.dartTimer += delta;
    if (!this.isDarting && this.dartTimer >= this.nextDartInterval) {
      this.isDarting = true;
      this.dartProgress = 0;
      this.dartTimer = 0;
      this.dartDuration = cfg.movement.dartDuration;
      this.nextDartInterval =
        cfg.movement.dartMinInterval +
        Math.random() * (cfg.movement.dartMaxInterval - cfg.movement.dartMinInterval);
      this.dartOffset.set(
        (Math.random() - 0.5) * 0.5,
        (Math.random() - 0.5) * 0.25,
        (Math.random() - 0.5) * 0.5
      );
    }

    let speedMultiplier = 1.0;
    if (this.isDarting) {
      this.dartProgress += delta;
      targetPos.add(this.dartOffset);
      speedMultiplier = cfg.movement.dartSpeedMultiplier;
      if (this.dartProgress >= this.dartDuration) {
        this.isDarting = false;
      }
    }

    // Direction to orbital target
    const desiredDir = targetPos.clone().sub(this.group.position);
    const distToTarget = desiredDir.length();
    if (distToTarget > 0.001) desiredDir.normalize();

    // Base target speed
    let nominalSpeed = this.baseSpeed * speedMultiplier * Math.min(2.0, Math.max(0.6, distToTarget * 1.2));

    // --- 4. ANGULAR VELOCITY LIMITING (Requirement 2.1 & 2.4) ---
    // When in player's view, enforce maximum angular velocity in screen space
    if (isInView) {
      nominalSpeed *= cfg.movement.inViewSpeedDamp;
      const maxLinearSpeed = distToCamera * (cfg.movement.maxAngularSpeedDeg * (Math.PI / 180));
      nominalSpeed = Math.min(nominalSpeed, maxLinearSpeed);
    }

    this.currentSpeed = nominalSpeed;
    const targetVel = desiredDir.multiplyScalar(this.currentSpeed);

    // Curved, smooth inertial turns (ease-in / ease-out)
    this.flightVelocity.lerp(targetVel, delta * cfg.movement.turnSmoothing);

    // --- 5. Camera Repulsion (Never collide or stick to camera) ---
    if (distToCamera < cfg.movement.cameraRepelDistance) {
      const repelDir = this.group.position.clone().sub(playerPos).normalize();
      const repelForce = (cfg.movement.cameraRepelDistance - distToCamera) * 3.5;
      this.flightVelocity.addScaledVector(repelDir, repelForce);
    }

    // Move mosquito group
    this.group.position.addScaledVector(this.flightVelocity, delta);

    // Orient body towards flight velocity
    if (this.flightVelocity.lengthSq() > 0.0001) {
      this.group.lookAt(this.group.position.clone().add(this.flightVelocity));
      this.group.rotation.z = -this.flightVelocity.x * 0.15;
    }

    // Wing flapping
    const flapRate = this.flapSpeed * (this.isDarting ? 1.3 : 1.0);
    const flap = Math.sin(t * flapRate) * 0.85;
    this.leftWing.rotation.z = flap;
    this.rightWing.rotation.z = -flap;

    // --- 6. OPACITY & VISIBILITY (PROBLEM 1 FIX) ---
    // Full opacity 1.0 at <= 4m; smooth fade-in between 6m and 4m; 0.0 beyond 6m
    const maxVisDist = cfg.visibility.maxVisibleDistance; // 6.0m
    const fullOpDist = cfg.visibility.fullOpacityDistance; // 4.0m

    let targetOpacity = 0.0;
    if (distToCamera <= fullOpDist) {
      targetOpacity = 1.0; // 100% SÓLIDO
    } else if (distToCamera < maxVisDist) {
      targetOpacity = (maxVisDist - distToCamera) / (maxVisDist - fullOpDist);
    }

    this.currentOpacity = Math.max(0.0, Math.min(1.0, targetOpacity));

    for (const mat of this.materials) {
      mat.opacity = this.currentOpacity;
      // When at full opacity, disable alpha blending overhead
      mat.transparent = this.currentOpacity < 0.999;
    }

    // Guaranteed minimum size clamp: scale between minScaleFactor (0.75) and 1.0
    const scaleFactor = THREE.MathUtils.lerp(
      cfg.visibility.minScaleFactor,
      1.0,
      this.currentOpacity
    );
    this.group.scale.setScalar(this.baseScale * scaleFactor);

    // --- 7. MOTION TRAIL UPDATE (PROBLEM 2.3) ---
    if (cfg.trail.enabled && this.currentOpacity > 0.05) {
      // Record world position of abdomen / tail
      const tailPos = this.group.position.clone().add(
        new THREE.Vector3(0, 0, 0.35).applyQuaternion(this.group.quaternion)
      );

      this.trailPoints.unshift({
        position: tailPos,
        timestamp: elapsedTime,
      });

      // Filter out points older than lifetimeSec (0.4s)
      const cutoffTime = elapsedTime - cfg.trail.lifetimeSec;
      while (
        this.trailPoints.length > 0 &&
        this.trailPoints[this.trailPoints.length - 1].timestamp < cutoffTime
      ) {
        this.trailPoints.pop();
      }

      // Cap to max points
      if (this.trailPoints.length > cfg.trail.maxPoints) {
        this.trailPoints.length = cfg.trail.maxPoints;
      }

      this.updateTrailGeometry();
    } else {
      this.trailPoints = [];
      this.updateTrailGeometry();
    }

    // Boss scream damage shake
    if (this.isBoss && reactiveAudioLevel > 0.05) {
      const shakeAmt = reactiveAudioLevel * 0.25;
      this.group.position.x += (Math.random() - 0.5) * shakeAmt;
      this.group.position.y += (Math.random() - 0.5) * shakeAmt;
      this.group.position.z += (Math.random() - 0.5) * shakeAmt;
    }
  }

  /**
   * Updates the Motion Trail line geometry buffer
   */
  private updateTrailGeometry() {
    const geo = this.trailLine.geometry as THREE.BufferGeometry;
    const posAttr = geo.getAttribute('position') as THREE.BufferAttribute;
    const count = this.trailPoints.length;

    for (let i = 0; i < GAMEPLAY_CONFIG.trail.maxPoints; i++) {
      if (i < count) {
        const pt = this.trailPoints[i].position;
        this.trailPositionsArray[i * 3] = pt.x;
        this.trailPositionsArray[i * 3 + 1] = pt.y;
        this.trailPositionsArray[i * 3 + 2] = pt.z;
      } else if (count > 0) {
        // Stretch last point
        const lastPt = this.trailPoints[count - 1].position;
        this.trailPositionsArray[i * 3] = lastPt.x;
        this.trailPositionsArray[i * 3 + 1] = lastPt.y;
        this.trailPositionsArray[i * 3 + 2] = lastPt.z;
      }
    }

    posAttr.needsUpdate = true;
    geo.setDrawRange(0, Math.max(2, count));
  }

  /**
   * Respawns the mosquito back in its assigned world Nest
   */
  public respawnAtNest() {
    this.isDead = false;
    this.deathTime = 0;
    this.group.position.copy(this.nestPosition);
    this.flightVelocity.set(0, 0, 0);
    this.currentOpacity = 0.0;
    this.trailPoints = [];
    this.updateTrailGeometry();
    for (const mat of this.materials) {
      mat.opacity = 0.0;
      mat.transparent = true;
    }
    this.group.scale.setScalar(
      this.baseScale * GAMEPLAY_CONFIG.visibility.minScaleFactor
    );
  }

  public kill() {
    this.isDead = true;
    this.deathTime = performance.now();
    this.trailPoints = [];
    this.updateTrailGeometry();
  }
}
