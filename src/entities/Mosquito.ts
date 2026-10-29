/**
 * Mosquito.ts
 * 3D Mosquito entity utilizing the custom 3D model:
 * - Upright posture constraint (back always facing up, legs down, strictly no flipping/tumbling)
 * - Authentic insect hovering and erratic buzzing/darting ("revoloteo")
 * - Scaled appropriately smaller in Level 1 and 2
 * - Inter-mosquito separation to prevent clumping
 * - High-frequency wing buzzing and micro-flight vibration
 * - Motion trail (estela de movimiento) and generous hit detection
 */

import * as THREE from 'three';
import { GAMEPLAY_CONFIG } from '../config/gameplayConfig';
import { mosquitoModelLoader } from './MosquitoModelLoader';

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

  // 3D GLTF Model
  public gltfModel: THREE.Group | null = null;
  private gltfLeftWing: THREE.Mesh | null = null;
  private gltfRightWing: THREE.Mesh | null = null;
  private proceduralModel: THREE.Group | null = null;
  private unsubscribeModelReady: (() => void) | null = null;

  // Procedural Wings (fallback)
  private leftWing: THREE.Mesh | null = null;
  private rightWing: THREE.Mesh | null = null;
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

  // Upright orientation states (Yaw around Y, clamped Pitch, clamped Roll)
  private currentYaw: number = 0;
  private currentPitch: number = 0;
  private currentRoll: number = 0;
  private angularTurnRate: number = 0;

  // Lissajous & Revoloteo errático
  private freqX1: number;
  private freqX2: number;
  private freqY1: number;
  private freqY2: number;
  private freqZ1: number;
  private freqZ2: number;
  private phaseX: number;
  private phaseY: number;
  private phaseZ: number;

  // Piques erráticos frecuentes de insecto (quiebres rápidos y revoloteo)
  private dartTimer: number = 0;
  private nextDartInterval: number = 0.8;
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
    const cfg = GAMEPLAY_CONFIG;
    this.id = options.id;
    this.nestId = options.nestId;
    this.nestPosition = options.nestPosition.clone();
    this.nestRadius =
      options.nestRadius ||
      (options.isBoss
        ? 2.8
        : cfg.nests.minSweepRadius +
          Math.random() * (cfg.nests.maxSweepRadius - cfg.nests.minSweepRadius));
    this.isBoss = !!options.isBoss;
    this.level = options.level || 1;

    const defaultSpeed = this.isBoss
      ? 0.22
      : this.level === 1
      ? cfg.movement.baseSpeedLvl1
      : cfg.movement.baseSpeedLvl2;
    this.baseSpeed = options.speed || defaultSpeed;
    this.currentSpeed = this.baseSpeed;

    // Distinct, realistic scaling: Levels 1 and 2 are significantly smaller
    const defaultScale = this.isBoss
      ? cfg.visibility.bossScale
      : this.level === 1
      ? cfg.visibility.lvl1Scale
      : cfg.visibility.lvl2Scale;
    this.baseScale = options.scale || defaultScale;

    this.flapSpeed = this.isBoss ? 30 : this.level === 1 ? 50 : 64;
    this.timeOffset = Math.random() * 100;

    // Erratic Lissajous frequencies
    this.freqX1 = 0.5 + Math.random() * 0.4;
    this.freqX2 = 1.1 + Math.random() * 0.5;
    this.freqY1 = 0.4 + Math.random() * 0.35;
    this.freqY2 = 0.9 + Math.random() * 0.4;
    this.freqZ1 = 0.55 + Math.random() * 0.4;
    this.freqZ2 = 1.2 + Math.random() * 0.5;

    this.phaseX = Math.random() * Math.PI * 2;
    this.phaseY = Math.random() * Math.PI * 2;
    this.phaseZ = Math.random() * Math.PI * 2;

    this.currentYaw = Math.random() * Math.PI * 2;

    this.group = new THREE.Group();
    this.group.position.copy(this.nestPosition);

    // 1. Attach 3D Model
    const gltfInstance = mosquitoModelLoader.createInstance(this.isBoss);
    if (gltfInstance) {
      this.attachGltfModel(gltfInstance);
    } else {
      this.createProceduralPlaceholder();
      this.unsubscribeModelReady = mosquitoModelLoader.onReady(() => {
        const readyInstance = mosquitoModelLoader.createInstance(this.isBoss);
        if (readyInstance) {
          this.attachGltfModel(readyInstance);
        }
      });
    }

    // 2. Generous Hit detection sphere (ensures easy touching at 4-7m)
    const hitRadius = this.isBoss ? 3.4 : cfg.trackingAid.hitSphereRadius;
    const hitGeo = new THREE.SphereGeometry(hitRadius, 6, 6);
    const hitMat = new THREE.MeshBasicMaterial({ visible: false, wireframe: true });
    this.hitSphere = new THREE.Mesh(hitGeo, hitMat);
    this.hitSphere.userData = { mosquitoId: this.id, isBoss: this.isBoss };
    this.group.add(this.hitSphere);

    // 3. Motion Trail Line
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

    this.group.scale.setScalar(this.baseScale * cfg.visibility.minScaleFactor);
  }

  private attachGltfModel(instance: THREE.Group) {
    if (this.gltfModel) {
      this.group.remove(this.gltfModel);
    }
    if (this.proceduralModel) {
      this.group.remove(this.proceduralModel);
      this.proceduralModel = null;
      this.leftWing = null;
      this.rightWing = null;
    }

    this.gltfModel = instance;
    this.gltfLeftWing = this.gltfModel.getObjectByName('Mosquito_LeftWing') as THREE.Mesh | null;
    this.gltfRightWing = this.gltfModel.getObjectByName('Mosquito_RightWing') as THREE.Mesh | null;
    this.group.add(this.gltfModel);

    // Extract materials from GLTF for opacity tracking
    this.gltfModel.traverse((child) => {
      if ((child as THREE.Mesh).isMesh) {
        const mesh = child as THREE.Mesh;
        if (mesh.material) {
          const mats = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
          mats.forEach((m) => {
            if (!this.materials.includes(m)) {
              this.materials.push(m);
            }
          });
        }
      }
    });
  }

  private createProceduralPlaceholder() {
    const cfg = GAMEPLAY_CONFIG;
    this.proceduralModel = new THREE.Group();

    const bodyMat = new THREE.MeshStandardMaterial({
      color: this.isBoss ? 0x2b0615 : 0x141619,
      roughness: 0.45,
      metalness: 0.15,
      transparent: false,
      opacity: 1.0,
    });
    this.materials.push(bodyMat);

    const outlineMat = new THREE.MeshBasicMaterial({
      color: cfg.visibility.outlineColor,
      side: THREE.BackSide,
      transparent: false,
      opacity: 1.0,
    });
    this.materials.push(outlineMat);

    const eyeMat = new THREE.MeshBasicMaterial({
      color: this.isBoss ? 0xff0055 : 0xff2200,
      transparent: false,
      opacity: 1.0,
    });
    this.materials.push(eyeMat);

    const wingMat = new THREE.MeshBasicMaterial({
      color: this.isBoss ? 0xf472b6 : 0xdbeafe,
      side: THREE.DoubleSide,
      transparent: true,
      opacity: 0.85,
    });
    this.materials.push(wingMat);

    const needleMat = new THREE.MeshBasicMaterial({
      color: 0x09090b,
      transparent: false,
      opacity: 1.0,
    });
    this.materials.push(needleMat);

    // Abdomen
    const abdomenGeo = new THREE.ConeGeometry(0.18, 0.9, 8);
    abdomenGeo.rotateX(Math.PI / 2);
    const abdomen = new THREE.Mesh(abdomenGeo, bodyMat);
    abdomen.position.set(0, 0, 0.45);
    this.proceduralModel.add(abdomen);

    // Thorax
    const thoraxGeo = new THREE.SphereGeometry(0.24, 8, 8);
    const thorax = new THREE.Mesh(thoraxGeo, bodyMat);
    this.proceduralModel.add(thorax);

    // Head
    const headGeo = new THREE.SphereGeometry(0.16, 8, 8);
    const head = new THREE.Mesh(headGeo, bodyMat);
    head.position.set(0, 0.05, -0.32);
    this.proceduralModel.add(head);

    // Eyes
    const eyeGeo = new THREE.SphereGeometry(0.075, 6, 6);
    const leftEye = new THREE.Mesh(eyeGeo, eyeMat);
    leftEye.position.set(-0.09, 0.1, -0.38);
    const rightEye = new THREE.Mesh(eyeGeo, eyeMat);
    rightEye.position.set(0.09, 0.1, -0.38);
    this.proceduralModel.add(leftEye, rightEye);

    // Proboscis
    const needleGeo = new THREE.CylinderGeometry(0.018, 0.035, 0.45, 5);
    needleGeo.rotateX(Math.PI / 3);
    const needle = new THREE.Mesh(needleGeo, needleMat);
    needle.position.set(0, -0.15, -0.5);
    this.proceduralModel.add(needle);

    // Wings
    const wingGeo = new THREE.PlaneGeometry(0.3, 0.9);
    wingGeo.translate(0, 0.45, 0);
    wingGeo.rotateX(Math.PI / 2);

    this.leftWing = new THREE.Mesh(wingGeo, wingMat);
    this.leftWing.position.set(-0.12, 0.18, -0.05);
    this.leftWing.rotation.y = 0.5;

    this.rightWing = new THREE.Mesh(wingGeo, wingMat);
    this.rightWing.position.set(0.12, 0.18, -0.05);
    this.rightWing.rotation.y = -0.5;

    this.proceduralModel.add(this.leftWing, this.rightWing);
    this.group.add(this.proceduralModel);
  }

  /**
   * Flight physics & realistic upright insect flight mechanics
   */
  public update(
    delta: number,
    elapsedTime: number,
    playerPos: THREE.Vector3,
    reactiveAudioLevel: number = 0,
    cameraMatrixInverse?: THREE.Matrix4,
    cameraAspect: number = 1.0,
    camForward?: THREE.Vector3,
    otherMosquitoes?: Mosquito[]
  ) {
    const cfg = GAMEPLAY_CONFIG;

    if (this.isDead) {
      this.group.position.y -= delta * 3.5;
      this.group.rotation.x += delta * 6;
      this.group.rotation.z += delta * 4;
      this.group.scale.multiplyScalar(0.95);
      this.trailPoints = [];
      this.updateTrailGeometry();
      return;
    }

    const t = elapsedTime + this.timeOffset;

    // --- LEVEL 3 BOSS (King Mosquito) ---
    if (this.isBoss) {
      const forwardDir = camForward
        ? camForward.clone().normalize()
        : new THREE.Vector3(0, 0, -1);

      const cycleTime = t * 0.75;
      const hoverDistance = 2.4 + Math.sin(cycleTime) * 0.95;

      const bossTargetPos = playerPos.clone().addScaledVector(forwardDir, hoverDistance);
      // Realistic hover jitter
      bossTargetPos.y += Math.sin(t * 12.0) * 0.035 + Math.cos(t * 18.0) * 0.02;
      bossTargetPos.x += Math.sin(t * 9.0) * 0.04;

      if (reactiveAudioLevel > 0.05) {
        const shakeAmt = reactiveAudioLevel * 0.28;
        bossTargetPos.x += (Math.random() - 0.5) * shakeAmt;
        bossTargetPos.y += (Math.random() - 0.5) * shakeAmt;
        bossTargetPos.z += (Math.random() - 0.5) * shakeAmt;
      }

      this.group.position.lerp(bossTargetPos, Math.min(1.0, delta * 7.0));

      // Strictly upright posture: Rotate around Y to face player, no wild roll/flip
      const toPlayer = playerPos.clone().sub(this.group.position);
      const targetYaw = Math.atan2(toPlayer.x, toPlayer.z) + Math.PI;
      this.currentYaw = THREE.MathUtils.lerp(this.currentYaw, targetYaw, delta * 8.0);
      this.group.rotation.set(0, this.currentYaw, 0, 'YXZ');

      // Wing flapping & flight vibration
      const flapRate = this.flapSpeed * (reactiveAudioLevel > 0.05 ? 1.6 : 1.0);
      const flap = Math.sin(t * flapRate) * 0.85;

      if (this.leftWing && this.rightWing) {
        this.leftWing.rotation.z = flap;
        this.rightWing.rotation.z = -flap;
      }
      if (this.gltfLeftWing && this.gltfRightWing) {
        this.gltfLeftWing.rotation.z = flap;
        this.gltfRightWing.rotation.z = -flap;
      }
      if (this.gltfModel) {
        this.gltfModel.rotation.z = Math.sin(t * flapRate * 1.2) * 0.08;
        this.gltfModel.position.y = Math.sin(t * flapRate * 1.8) * 0.02;
      }

      this.currentOpacity = 1.0;
      for (const mat of this.materials) {
        if (mat.name === 'wingMat') {
          mat.transparent = true;
          mat.opacity = 0.88;
        } else {
          mat.opacity = 1.0;
          mat.transparent = false;
        }
      }
      this.group.scale.setScalar(this.baseScale);

      if (cfg.trail.enabled) {
        const tailPos = this.group.position.clone().add(
          new THREE.Vector3(0, 0, 0.35).applyQuaternion(this.group.quaternion)
        );
        this.trailPoints.unshift({
          position: tailPos,
          timestamp: elapsedTime,
        });
        const cutoffTime = elapsedTime - cfg.trail.lifetimeSec;
        while (
          this.trailPoints.length > 0 &&
          this.trailPoints[this.trailPoints.length - 1].timestamp < cutoffTime
        ) {
          this.trailPoints.pop();
        }
        if (this.trailPoints.length > cfg.trail.maxPoints) {
          this.trailPoints.length = cfg.trail.maxPoints;
        }
        this.updateTrailGeometry();
      }
      return;
    }

    const distToCamera = this.group.position.distanceTo(playerPos);

    // --- 1. Check if mosquito is in player's field of view ---
    let isInView = false;
    let screenRelX = 0;
    let screenRelY = 0;

    if (cameraMatrixInverse) {
      const relCam = this.group.position.clone().applyMatrix4(cameraMatrixInverse);
      if (relCam.z < -0.2) {
        const fovTan = Math.tan((35 * Math.PI) / 180);
        const halfWidthAtZ = -relCam.z * fovTan * cameraAspect;
        const halfHeightAtZ = -relCam.z * fovTan;

        screenRelX = relCam.x / halfWidthAtZ;
        screenRelY = relCam.y / halfHeightAtZ;

        isInView = Math.abs(screenRelX) <= 1.05 && Math.abs(screenRelY) <= 1.05;
      }
    }

    if (this.wasInView && !isInView) {
      const angle = Math.atan2(screenRelY, screenRelX);
      this.lastExitDirection = { x: Math.cos(angle), y: Math.sin(angle) };
      this.lastExitTimestamp = performance.now();
    }
    this.wasInView = isInView;

    // --- 2. Dynamic flight patrol & micro-revoloteo ---
    const toNest = this.nestPosition.clone().sub(playerPos);
    const nestDir = toNest.clone().normalize();
    const tangentDir = new THREE.Vector3(-nestDir.z, 0, nestDir.x).normalize();
    const upDir = new THREE.Vector3(0, 1, 0);

    const rad = this.nestRadius;
    const tangentOffset =
      Math.sin(t * this.freqX1 + this.phaseX) * (rad * 1.3) +
      Math.cos(t * this.freqX2) * (rad * 0.4);
    const verticalOffset =
      Math.sin(t * this.freqY1 + this.phaseY) * (rad * 0.65) +
      Math.cos(t * this.freqY2) * 0.45;
    const radialOffset = Math.cos(t * this.freqZ1 + this.phaseZ) * (rad * 0.35);

    let targetPos = this.nestPosition
      .clone()
      .addScaledVector(tangentDir, tangentOffset)
      .addScaledVector(upDir, verticalOffset)
      .addScaledVector(nestDir, radialOffset);

    // Add high-frequency insect hover vibration (revoloteo micro-oscillation)
    const flutterY = Math.sin(t * cfg.movement.flutterFreq) * cfg.movement.flutterAmp;
    const flutterX = Math.cos(t * (cfg.movement.flutterFreq * 0.85)) * (cfg.movement.flutterAmp * 0.8);
    const flutterZ = Math.sin(t * (cfg.movement.flutterFreq * 1.15)) * (cfg.movement.flutterAmp * 0.8);
    targetPos.x += flutterX;
    targetPos.y += flutterY;
    targetPos.z += flutterZ;

    // Frequent insect darts (quiebres rápidos de dirección)
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
        (Math.random() - 0.5) * 0.65,
        (Math.random() - 0.5) * 0.35,
        (Math.random() - 0.5) * 0.65
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

    const desiredDir = targetPos.clone().sub(this.group.position);
    const distToTarget = desiredDir.length();
    if (distToTarget > 0.001) desiredDir.normalize();

    let nominalSpeed = this.baseSpeed * speedMultiplier * Math.min(2.2, Math.max(0.7, distToTarget * 1.4));

    if (isInView) {
      nominalSpeed *= cfg.movement.inViewSpeedDamp;
      const maxLinearSpeed = distToCamera * (cfg.movement.maxAngularSpeedDeg * (Math.PI / 180));
      nominalSpeed = Math.min(nominalSpeed, maxLinearSpeed);
    }

    this.currentSpeed = nominalSpeed;
    const targetVel = desiredDir.multiplyScalar(this.currentSpeed);
    this.flightVelocity.lerp(targetVel, delta * cfg.movement.turnSmoothing);

    // Camera repel force: keep mosquito from sticking right against screen
    if (distToCamera < cfg.movement.cameraRepelDistance) {
      const repelDir = this.group.position.clone().sub(playerPos).normalize();
      const repelForce = (cfg.movement.cameraRepelDistance - distToCamera) * 3.5;
      this.flightVelocity.addScaledVector(repelDir, repelForce);
    }

    // Inter-mosquito separation force: prevent mosquitoes from clumping together
    if (otherMosquitoes) {
      for (const other of otherMosquitoes) {
        if (other === this || other.isDead) continue;
        const d = this.group.position.distanceTo(other.group.position);
        if (d < cfg.movement.minMosquitoSeparation && d > 0.001) {
          const pushDir = this.group.position.clone().sub(other.group.position).normalize();
          const pushForce = (cfg.movement.minMosquitoSeparation - d) * 2.8;
          this.flightVelocity.addScaledVector(pushDir, pushForce);
        }
      }
    }

    this.group.position.addScaledVector(this.flightVelocity, delta);

    // --- 3. STRICT UPRIGHT ROTATION ("Tienen un lado que respetar") ---
    // The mosquito's back ALWAYS points UP (+Y), legs DOWN (-Y), head facing flight heading (-Z).
    // NO tumbling, NO upside-down flips, NO chaotic rolling!
    const horizontalSpeed = Math.hypot(this.flightVelocity.x, this.flightVelocity.z);

    if (horizontalSpeed > 0.015) {
      // In Three.js forward is -Z. Math.atan2(-vel.x, -vel.z) gives yaw facing travel direction
      const desiredYaw = Math.atan2(-this.flightVelocity.x, -this.flightVelocity.z);

      let diffYaw = desiredYaw - this.currentYaw;
      while (diffYaw < -Math.PI) diffYaw += Math.PI * 2;
      while (diffYaw > Math.PI) diffYaw -= Math.PI * 2;

      const turnStep = diffYaw * Math.min(1.0, delta * 9.5);
      this.currentYaw += turnStep;
      this.angularTurnRate = turnStep / Math.max(0.001, delta);
    }

    // Pitch angle: Pitch slightly forward when descending, slightly up when ascending (capped at 14 degrees)
    const targetPitch = Math.max(-0.25, Math.min(0.25, -this.flightVelocity.y * 0.4));
    this.currentPitch = THREE.MathUtils.lerp(this.currentPitch, targetPitch, delta * 7.5);

    // Roll / Bank angle: subtle banking into horizontal turns (capped at 10 degrees)
    const targetRoll = Math.max(-0.18, Math.min(0.18, -this.angularTurnRate * 0.15));
    this.currentRoll = THREE.MathUtils.lerp(this.currentRoll, targetRoll, delta * 6.5);

    // Apply strict upright rotation in order 'YXZ' (Yaw first, then Pitch, then Bank Roll)
    this.group.rotation.set(this.currentPitch, this.currentYaw, this.currentRoll, 'YXZ');

    // Wing flapping animation
    const flapRate = this.flapSpeed * (this.isDarting ? 1.35 : 1.0);
    const flap = Math.sin(t * flapRate) * 0.85;

    if (this.leftWing && this.rightWing) {
      this.leftWing.rotation.z = flap;
      this.rightWing.rotation.z = -flap;
    }
    if (this.gltfLeftWing && this.gltfRightWing) {
      this.gltfLeftWing.rotation.z = flap;
      this.gltfRightWing.rotation.z = -flap;
    }
    if (this.gltfModel) {
      this.gltfModel.rotation.z = Math.sin(t * flapRate * 1.2) * 0.08;
      this.gltfModel.position.y = Math.sin(t * flapRate * 1.8) * 0.02;
    }

    this.currentOpacity = 1.0;
    for (const mat of this.materials) {
      if (mat.name === 'wingMat') {
        mat.transparent = true;
        mat.opacity = 0.85;
      } else {
        mat.opacity = 1.0;
        mat.transparent = false;
      }
    }

    const scaleFactor = THREE.MathUtils.lerp(
      cfg.visibility.minScaleFactor,
      1.0,
      this.currentOpacity
    );
    this.group.scale.setScalar(this.baseScale * scaleFactor);

    if (cfg.trail.enabled && this.currentOpacity > 0.05) {
      const tailPos = this.group.position.clone().add(
        new THREE.Vector3(0, 0, 0.35).applyQuaternion(this.group.quaternion)
      );

      this.trailPoints.unshift({
        position: tailPos,
        timestamp: elapsedTime,
      });

      const cutoffTime = elapsedTime - cfg.trail.lifetimeSec;
      while (
        this.trailPoints.length > 0 &&
        this.trailPoints[this.trailPoints.length - 1].timestamp < cutoffTime
      ) {
        this.trailPoints.pop();
      }

      if (this.trailPoints.length > cfg.trail.maxPoints) {
        this.trailPoints.length = cfg.trail.maxPoints;
      }

      this.updateTrailGeometry();
    } else {
      this.trailPoints = [];
      this.updateTrailGeometry();
    }
  }

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
        const lastPt = this.trailPoints[count - 1].position;
        this.trailPositionsArray[i * 3] = lastPt.x;
        this.trailPositionsArray[i * 3 + 1] = lastPt.y;
        this.trailPositionsArray[i * 3 + 2] = lastPt.z;
      }
    }

    posAttr.needsUpdate = true;
    geo.setDrawRange(0, Math.max(2, count));
  }

  public respawnAtNest() {
    this.isDead = false;
    this.deathTime = 0;
    this.group.position.copy(this.nestPosition);
    this.flightVelocity.set(0, 0, 0);
    this.currentOpacity = 0.0;
    this.currentYaw = Math.random() * Math.PI * 2;
    this.currentPitch = 0;
    this.currentRoll = 0;
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

  public dispose() {
    if (this.unsubscribeModelReady) {
      this.unsubscribeModelReady();
      this.unsubscribeModelReady = null;
    }
  }
}
