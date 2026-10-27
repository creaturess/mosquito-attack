/**
 * Mosquito.ts
 * Realistic 3D Mosquito entity:
 * - Anchored to a fixed world-space Nest (5 to 7 nests, 3m-8m away)
 * - Organic Lissajous & noise orbital trajectories with smooth acceleration bursts / zigzags
 * - Camera avoidance (> 1.5m) to prevent clipping through the player
 * - Progressive distance visibility fade (invisible > 5.8m, fades in smoothly)
 * - Direction-aligned body with animated flapping wings
 * - Rebirth directly at its assigned nest upon death
 */

import * as THREE from 'three';

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
  private eyesMesh: THREE.Mesh;
  private bodyMesh: THREE.Mesh;

  // Flight dynamics & speed
  public baseSpeed: number;
  public currentSpeed: number;
  private flapSpeed: number = 48;
  private timeOffset: number;
  private flightVelocity: THREE.Vector3 = new THREE.Vector3();

  // Lissajous orbital frequencies & phases (unique per mosquito for irregular organic motion)
  private freqX1: number;
  private freqX2: number;
  private freqY1: number;
  private freqY2: number;
  private freqZ1: number;
  private freqZ2: number;
  private phaseX: number;
  private phaseY: number;
  private phaseZ: number;

  // Picos de aceleración ocasionales y zigzags
  private dartTimer: number = 0;
  private nextDartInterval: number = 3.0;
  private dartDuration: number = 0.4;
  private dartProgress: number = 0;
  public isDarting: boolean = false;
  private dartOffset: THREE.Vector3 = new THREE.Vector3();

  // Progressive distance opacity & scale
  public materials: (THREE.MeshStandardMaterial | THREE.MeshBasicMaterial)[] = [];
  public currentOpacity: number = 0.0;
  public baseScale: number;

  // Collision hit box mesh for raycasting
  public hitSphere: THREE.Mesh;

  constructor(options: MosquitoOptions) {
    this.id = options.id;
    this.nestId = options.nestId;
    this.nestPosition = options.nestPosition.clone();
    this.nestRadius = options.nestRadius || (options.isBoss ? 2.5 : 1.35 + Math.random() * 0.9);
    this.isBoss = !!options.isBoss;
    this.level = options.level || 1;

    this.baseSpeed = options.speed || (this.isBoss ? 0.45 : this.level === 1 ? 0.55 : 0.85);
    this.currentSpeed = this.baseSpeed;
    this.baseScale = options.scale || (this.isBoss ? 4.0 : this.level === 1 ? 1.35 : 1.05);
    this.flapSpeed = this.isBoss ? 30 : this.level === 1 ? 44 : 64;
    this.timeOffset = Math.random() * 100;

    // Generate unique irrational frequencies for non-repeating organic Lissajous paths
    this.freqX1 = 0.45 + Math.random() * 0.35;
    this.freqX2 = 0.95 + Math.random() * 0.45;
    this.freqY1 = 0.38 + Math.random() * 0.3;
    this.freqY2 = 0.82 + Math.random() * 0.4;
    this.freqZ1 = 0.52 + Math.random() * 0.35;
    this.freqZ2 = 1.05 + Math.random() * 0.45;

    this.phaseX = Math.random() * Math.PI * 2;
    this.phaseY = Math.random() * Math.PI * 2;
    this.phaseZ = Math.random() * Math.PI * 2;

    this.group = new THREE.Group();
    // Position strictly at nest position initially (never near the camera)
    this.group.position.copy(this.nestPosition);

    // --- Build Mosquito Geometry with Transparent Materials for Distance Fade ---
    const bodyColor = this.isBoss ? 0x220510 : 0x1a1a1a;
    const bodyMat = new THREE.MeshStandardMaterial({
      color: bodyColor,
      roughness: 0.6,
      metalness: 0.2,
      transparent: true,
      opacity: 0.0,
    });
    this.materials.push(bodyMat);

    const eyeMat = new THREE.MeshBasicMaterial({
      color: this.isBoss ? 0xff0044 : 0xff2200,
      transparent: true,
      opacity: 0.0,
    });
    this.materials.push(eyeMat);

    const wingMat = new THREE.MeshStandardMaterial({
      color: this.isBoss ? 0xcc88bb : 0xffffff,
      transparent: true,
      opacity: 0.0,
      roughness: 0.1,
      metalness: 0.8,
      side: THREE.DoubleSide,
    });
    this.materials.push(wingMat);

    const needleMat = new THREE.MeshStandardMaterial({
      color: 0x111111,
      transparent: true,
      opacity: 0.0,
    });
    this.materials.push(needleMat);

    const legMat = new THREE.MeshBasicMaterial({
      color: 0x111111,
      transparent: true,
      opacity: 0.0,
    });
    this.materials.push(legMat);

    // 1. Abdomen
    const abdomenGeo = new THREE.ConeGeometry(0.18, 0.9, 8);
    abdomenGeo.rotateX(Math.PI / 2);
    const abdomen = new THREE.Mesh(abdomenGeo, bodyMat);
    abdomen.position.set(0, 0, 0.45);
    this.group.add(abdomen);

    // 2. Thorax
    const thoraxGeo = new THREE.SphereGeometry(0.24, 8, 8);
    this.bodyMesh = new THREE.Mesh(thoraxGeo, bodyMat);
    this.group.add(this.bodyMesh);

    // 3. Head
    const headGeo = new THREE.SphereGeometry(0.16, 8, 8);
    const head = new THREE.Mesh(headGeo, bodyMat);
    head.position.set(0, 0.05, -0.32);
    this.group.add(head);

    // 4. Red Glowing Compound Eyes
    const eyeGeo = new THREE.SphereGeometry(0.07, 6, 6);
    const leftEye = new THREE.Mesh(eyeGeo, eyeMat);
    leftEye.position.set(-0.09, 0.1, -0.38);
    const rightEye = new THREE.Mesh(eyeGeo, eyeMat);
    rightEye.position.set(0.09, 0.1, -0.38);
    this.eyesMesh = leftEye;
    this.group.add(leftEye, rightEye);

    // 5. Proboscis
    const needleGeo = new THREE.CylinderGeometry(0.015, 0.03, 0.45, 5);
    needleGeo.rotateX(Math.PI / 3);
    const needle = new THREE.Mesh(needleGeo, needleMat);
    needle.position.set(0, -0.15, -0.5);
    this.group.add(needle);

    // 6. Wings
    const wingGeo = new THREE.PlaneGeometry(0.28, 0.85);
    wingGeo.translate(0, 0.42, 0);
    wingGeo.rotateX(Math.PI / 2);

    this.leftWing = new THREE.Mesh(wingGeo, wingMat);
    this.leftWing.position.set(-0.12, 0.18, -0.05);
    this.leftWing.rotation.y = 0.5;

    this.rightWing = new THREE.Mesh(wingGeo, wingMat);
    this.rightWing.position.set(0.12, 0.18, -0.05);
    this.rightWing.rotation.y = -0.5;

    this.group.add(this.leftWing, this.rightWing);

    // 7. Slender legs
    for (let i = -1; i <= 1; i++) {
      const legGeo = new THREE.CylinderGeometry(0.012, 0.012, 0.6, 3);
      const lLeg = new THREE.Mesh(legGeo, legMat);
      lLeg.position.set(-0.25, -0.2, i * 0.18);
      lLeg.rotation.z = 0.8;
      lLeg.rotation.x = i * 0.3;
      const rLeg = new THREE.Mesh(legGeo, legMat);
      rLeg.position.set(0.25, -0.2, i * 0.18);
      rLeg.rotation.z = -0.8;
      rLeg.rotation.x = i * 0.3;
      this.group.add(lLeg, rLeg);
    }

    // 8. Hit detection sphere - Generous for responsive touch selection
    const hitRadius = this.isBoss ? 2.6 : 1.35;
    const hitGeo = new THREE.SphereGeometry(hitRadius, 6, 6);
    const hitMat = new THREE.MeshBasicMaterial({ visible: false, wireframe: true });
    this.hitSphere = new THREE.Mesh(hitGeo, hitMat);
    this.hitSphere.userData = { mosquitoId: this.id, isBoss: this.isBoss };
    this.group.add(this.hitSphere);

    // Start with speck scale and zero opacity
    this.group.scale.setScalar(this.baseScale * 0.25);

    if (this.isBoss) {
      const crownGeo = new THREE.TorusGeometry(0.4, 0.05, 8, 16);
      crownGeo.rotateX(Math.PI / 2);
      const crownMat = new THREE.MeshBasicMaterial({ color: 0xff0055, transparent: true, opacity: 0.0 });
      this.materials.push(crownMat);
      const crown = new THREE.Mesh(crownGeo, crownMat);
      crown.position.set(0, 0.3, 0);
      this.group.add(crown);
    }
  }

  /**
   * Flight physics & organic Lissajous orbital update
   */
  public update(
    delta: number,
    elapsedTime: number,
    playerPos: THREE.Vector3,
    reactiveAudioLevel: number = 0
  ) {
    if (this.isDead) {
      this.group.position.y -= delta * 3.5;
      this.group.rotation.x += delta * 6;
      this.group.rotation.z += delta * 4;
      this.group.scale.multiplyScalar(0.95);
      return;
    }

    const t = elapsedTime + this.timeOffset;

    // --- 1. Lissajous Organic Trajectory around fixed Nest ---
    const rad = this.nestRadius;
    const lissX = Math.sin(t * this.freqX1 + this.phaseX) * rad + Math.cos(t * this.freqX2) * (rad * 0.45);
    const lissY = Math.sin(t * this.freqY1 + this.phaseY) * (rad * 0.45) + Math.cos(t * this.freqY2) * 0.25;
    const lissZ = Math.cos(t * this.freqZ1 + this.phaseZ) * rad + Math.sin(t * this.freqZ2) * (rad * 0.45);

    const targetPos = this.nestPosition.clone().add(new THREE.Vector3(lissX, lissY, lissZ));

    // --- 2. Darting Acceleration & Zigzags ---
    this.dartTimer += delta;
    if (!this.isDarting && this.dartTimer >= this.nextDartInterval) {
      this.isDarting = true;
      this.dartProgress = 0;
      this.dartTimer = 0;
      this.dartDuration = 0.35 + Math.random() * 0.3;
      this.nextDartInterval = 2.0 + Math.random() * 3.5;
      this.dartOffset.set(
        (Math.random() - 0.5) * 0.9,
        (Math.random() - 0.5) * 0.45,
        (Math.random() - 0.5) * 0.9
      );
    }

    let speedMultiplier = 1.0;
    if (this.isDarting) {
      this.dartProgress += delta;
      targetPos.add(this.dartOffset);
      speedMultiplier = 2.4;
      if (this.dartProgress >= this.dartDuration) {
        this.isDarting = false;
      }
    }

    // Velocity towards orbital target
    const desiredDir = targetPos.clone().sub(this.group.position);
    const distToTarget = desiredDir.length();
    if (distToTarget > 0.001) desiredDir.normalize();

    this.currentSpeed = this.baseSpeed * speedMultiplier * Math.min(2.5, Math.max(0.6, distToTarget * 1.5));
    const targetVel = desiredDir.multiplyScalar(this.currentSpeed);
    this.flightVelocity.lerp(targetVel, delta * 4.5);

    // --- 3. Camera Repulsion (Never approach or cross closer than ~1.5m to player) ---
    const distToCamera = this.group.position.distanceTo(playerPos);
    if (distToCamera < 1.6) {
      const repelDir = this.group.position.clone().sub(playerPos).normalize();
      const repelForce = (1.6 - distToCamera) * 4.0;
      this.flightVelocity.addScaledVector(repelDir, repelForce);
    }

    // Advance position continuously
    this.group.position.addScaledVector(this.flightVelocity, delta);

    // Orient body towards flight velocity
    if (this.flightVelocity.lengthSq() > 0.001) {
      this.group.lookAt(this.group.position.clone().add(this.flightVelocity));
      this.group.rotation.z = -this.flightVelocity.x * 0.18;
    }

    // Wing flapping (faster during dart bursts)
    const flapRate = this.flapSpeed * (this.isDarting ? 1.5 : 1.0);
    const flap = Math.sin(t * flapRate) * 0.85;
    this.leftWing.rotation.z = flap;
    this.rightWing.rotation.z = -flap;

    // --- 4. Progressive Visibility Fade (Section 4) ---
    // Invisible beyond 5.8m. Fades in smoothly as player gets closer.
    // At > 5.8m opacity is 0.0. At 3.0m opacity is 1.0.
    const visibilityNorm = THREE.MathUtils.clamp((5.8 - distToCamera) / 2.8, 0, 1);
    this.currentOpacity = Math.pow(visibilityNorm, 1.2);

    for (const mat of this.materials) {
      mat.opacity = this.currentOpacity;
    }

    // A distancia deben ser un puntito casi imperceptible:
    // Scale smoothly from 0.2 (at > 5.5m) up to baseScale (at <= 3.2m)
    const scaleFactor = THREE.MathUtils.lerp(0.2, 1.0, visibilityNorm);
    this.group.scale.setScalar(this.baseScale * scaleFactor);

    // Boss scream damage shake
    if (this.isBoss && reactiveAudioLevel > 0.05) {
      const shakeAmt = reactiveAudioLevel * 0.25;
      this.group.position.x += (Math.random() - 0.5) * shakeAmt;
      this.group.position.y += (Math.random() - 0.5) * shakeAmt;
      this.group.position.z += (Math.random() - 0.5) * shakeAmt;
    }
  }

  /**
   * Respawns the mosquito back in its assigned world Nest (never at the camera)
   */
  public respawnAtNest() {
    this.isDead = false;
    this.deathTime = 0;
    this.group.position.copy(this.nestPosition);
    this.flightVelocity.set(0, 0, 0);
    this.currentOpacity = 0.0;
    for (const mat of this.materials) {
      mat.opacity = 0.0;
    }
    this.group.scale.setScalar(this.baseScale * 0.2);
  }

  public kill() {
    this.isDead = true;
    this.deathTime = performance.now();
  }
}
