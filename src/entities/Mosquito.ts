/**
 * Mosquito.ts
 * 3D Mosquito entity with:
 * - Unique, cloned materials per instance (no shared material bug)
 * - Deterministic distance-based opacity formula:
 *     d >= 7.0m -> opacity = 0 (invisible)
 *     7.0m > d > 4.5m -> smoothstep(7.0, 4.5, d)
 *     d <= 4.5m -> opacity = 1.0 exact (solid, depthWrite: true, transparent: false)
 * - Single physical steering system (seek wanderTarget, maxSpeed 1.6m/s, maxAcceleration 3m/s²)
 * - Turn rate clamped to <= 120 deg/s
 * - Smooth camera evasion (< 1.5m)
 * - Max apparent screen angular speed clamped to <= 70 deg/s
 * - Correct renderOrder (body 10, trail 1)
 */

import * as THREE from 'three';
import { CONFIG } from '../config/gameplayConfig';

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

  // Steering Physics State
  public velocity: THREE.Vector3 = new THREE.Vector3();
  public wanderTarget: THREE.Vector3 = new THREE.Vector3();
  public acceleration: THREE.Vector3 = new THREE.Vector3();
  private prevVelocity: THREE.Vector3 = new THREE.Vector3(0, 0, -1);

  // Wings & hit detection
  private leftWing: THREE.Mesh;
  private rightWing: THREE.Mesh;
  public hitSphere: THREE.Mesh;

  // Motion Trail
  public trailLine: THREE.Line;
  private trailPoints: TrailPoint[] = [];
  private trailPositionsArray: Float32Array;

  // Speeds & dynamics
  public baseSpeed: number;
  public currentSpeed: number;
  private flapSpeed: number;
  private timeOffset: number;

  // Zigzag acceleration pulses (infrequent, brief)
  private zigzagTimer: number = 0;
  private nextZigzagInterval: number = 5.0;
  private isZigzagging: boolean = false;
  private zigzagProgress: number = 0;
  private zigzagForce: THREE.Vector3 = new THREE.Vector3();

  // Materials & Opacity
  public materials: THREE.Material[] = [];
  public currentOpacity: number = 0.0;
  public baseScale: number;

  constructor(options: MosquitoOptions) {
    this.id = options.id;
    this.nestId = options.nestId;
    this.nestPosition = options.nestPosition.clone();
    this.nestRadius = options.nestRadius || CONFIG.physics.nestWanderRadius;
    this.isBoss = !!options.isBoss;
    this.level = options.level || 1;

    this.baseSpeed = this.isBoss ? 0.9 : CONFIG.physics.maxSpeed;
    this.currentSpeed = this.baseSpeed;
    this.baseScale = options.scale || (this.isBoss ? CONFIG.visibility.bossScale : CONFIG.visibility.baseScale);
    this.flapSpeed = this.isBoss ? 26 : this.level === 1 ? 40 : 54;
    this.timeOffset = Math.random() * 100;

    this.group = new THREE.Group();
    // Start at nest position
    this.group.position.copy(this.nestPosition);
    this.group.renderOrder = 10; // Draw body on top of motion trail

    // Initial velocity
    const initAngle = Math.random() * Math.PI * 2;
    this.velocity.set(Math.cos(initAngle) * 0.5, 0, Math.sin(initAngle) * 0.5);
    this.prevVelocity.copy(this.velocity).normalize();

    // Pick initial wander target inside nest zone
    this.pickNewWanderTarget();

    // --- PROBLEMA B.1: CLONED / UNIQUE MATERIAL INSTANCES PER MOSQUITO ---
    const bodyMat = new THREE.MeshStandardMaterial({
      color: this.isBoss ? 0x2b0615 : CONFIG.visibility.bodyColor,
      roughness: 0.45,
      metalness: 0.1,
      depthWrite: true,
      blending: THREE.NormalBlending,
      transparent: false,
      opacity: 1.0,
    });
    this.materials.push(bodyMat);

    const outlineMat = new THREE.MeshBasicMaterial({
      color: CONFIG.visibility.outlineColor,
      side: THREE.BackSide,
      depthWrite: true,
      blending: THREE.NormalBlending,
      transparent: false,
      opacity: 1.0,
    });
    this.materials.push(outlineMat);

    const eyeMat = new THREE.MeshBasicMaterial({
      color: this.isBoss ? 0xff0044 : 0xff1e00,
      depthWrite: true,
      blending: THREE.NormalBlending,
      transparent: false,
      opacity: 1.0,
    });
    this.materials.push(eyeMat);

    const wingMat = new THREE.MeshBasicMaterial({
      color: this.isBoss ? 0xf472b6 : 0xdbeafe,
      side: THREE.DoubleSide,
      depthWrite: true,
      blending: THREE.NormalBlending,
      transparent: false,
      opacity: 1.0,
    });
    this.materials.push(wingMat);

    const needleMat = new THREE.MeshBasicMaterial({
      color: 0x09090b,
      depthWrite: true,
      blending: THREE.NormalBlending,
      transparent: false,
      opacity: 1.0,
    });
    this.materials.push(needleMat);

    // --- 3D Mesh Hierarchy ---
    // 1. Abdomen
    const abdomenGeo = new THREE.ConeGeometry(0.18, 0.9, 8);
    abdomenGeo.rotateX(Math.PI / 2);
    const abdomen = new THREE.Mesh(abdomenGeo, bodyMat);
    abdomen.position.set(0, 0, 0.45);
    abdomen.renderOrder = 10;
    this.group.add(abdomen);

    // Abdomen rim outline
    const abdomenOutline = new THREE.Mesh(abdomenGeo, outlineMat);
    abdomenOutline.scale.set(1.12, 1.08, 1.12);
    abdomenOutline.position.copy(abdomen.position);
    abdomenOutline.renderOrder = 9;
    this.group.add(abdomenOutline);

    // 2. Thorax
    const thoraxGeo = new THREE.SphereGeometry(0.24, 8, 8);
    const thorax = new THREE.Mesh(thoraxGeo, bodyMat);
    thorax.renderOrder = 10;
    this.group.add(thorax);

    const thoraxOutline = new THREE.Mesh(thoraxGeo, outlineMat);
    thoraxOutline.scale.setScalar(1.14);
    thoraxOutline.renderOrder = 9;
    this.group.add(thoraxOutline);

    // 3. Head
    const headGeo = new THREE.SphereGeometry(0.16, 8, 8);
    const head = new THREE.Mesh(headGeo, bodyMat);
    head.position.set(0, 0.05, -0.32);
    head.renderOrder = 10;
    this.group.add(head);

    // 4. Glowing Red Eyes
    const eyeGeo = new THREE.SphereGeometry(0.075, 6, 6);
    const leftEye = new THREE.Mesh(eyeGeo, eyeMat);
    leftEye.position.set(-0.09, 0.1, -0.38);
    const rightEye = new THREE.Mesh(eyeGeo, eyeMat);
    rightEye.position.set(0.09, 0.1, -0.38);
    leftEye.renderOrder = 10;
    rightEye.renderOrder = 10;
    this.group.add(leftEye, rightEye);

    // 5. Proboscis
    const needleGeo = new THREE.CylinderGeometry(0.018, 0.035, 0.45, 5);
    needleGeo.rotateX(Math.PI / 3);
    const needle = new THREE.Mesh(needleGeo, needleMat);
    needle.position.set(0, -0.15, -0.5);
    needle.renderOrder = 10;
    this.group.add(needle);

    // 6. Wings
    const wingGeo = new THREE.PlaneGeometry(0.3, 0.9);
    wingGeo.translate(0, 0.45, 0);
    wingGeo.rotateX(Math.PI / 2);

    this.leftWing = new THREE.Mesh(wingGeo, wingMat);
    this.leftWing.position.set(-0.12, 0.18, -0.05);
    this.leftWing.rotation.y = 0.5;
    this.leftWing.renderOrder = 10;

    this.rightWing = new THREE.Mesh(wingGeo, wingMat);
    this.rightWing.position.set(0.12, 0.18, -0.05);
    this.rightWing.rotation.y = -0.5;
    this.rightWing.renderOrder = 10;

    this.group.add(this.leftWing, this.rightWing);

    // 7. Legs
    for (let i = -1; i <= 1; i++) {
      const legGeo = new THREE.CylinderGeometry(0.015, 0.015, 0.65, 3);
      const lLeg = new THREE.Mesh(legGeo, needleMat);
      lLeg.position.set(-0.25, -0.2, i * 0.18);
      lLeg.rotation.z = 0.8;
      lLeg.rotation.x = i * 0.3;
      lLeg.renderOrder = 10;

      const rLeg = new THREE.Mesh(legGeo, needleMat);
      rLeg.position.set(0.25, -0.2, i * 0.18);
      rLeg.rotation.z = -0.8;
      rLeg.rotation.x = i * 0.3;
      rLeg.renderOrder = 10;

      this.group.add(lLeg, rLeg);
    }

    // 8. Hit detection sphere - Generous for responsive touch
    const hitRadius = this.isBoss ? 3.2 : CONFIG.combat.hitboxRadius;
    const hitGeo = new THREE.SphereGeometry(hitRadius, 6, 6);
    const hitMat = new THREE.MeshBasicMaterial({ visible: false, wireframe: true });
    this.hitSphere = new THREE.Mesh(hitGeo, hitMat);
    this.hitSphere.userData = { mosquitoId: this.id, isBoss: this.isBoss };
    this.group.add(this.hitSphere);

    // 9. Motion Trail Geometry & Line
    const maxTrailPoints = CONFIG.trail.maxPoints;
    this.trailPositionsArray = new Float32Array(maxTrailPoints * 3);
    const trailGeo = new THREE.BufferGeometry();
    trailGeo.setAttribute(
      'position',
      new THREE.BufferAttribute(this.trailPositionsArray, 3)
    );
    const trailMat = new THREE.LineBasicMaterial({
      color: CONFIG.trail.color,
      transparent: true,
      opacity: CONFIG.trail.opacity,
      depthWrite: false, // Don't occlude the mosquito body
      blending: THREE.NormalBlending,
      linewidth: 2,
    });
    this.materials.push(trailMat);
    this.trailLine = new THREE.Line(trailGeo, trailMat);
    this.trailLine.renderOrder = 1; // Render under the mosquito body
    this.trailLine.frustumCulled = false;

    // Initialize with opacity formula at starting position
    this.group.scale.setScalar(this.baseScale);
  }

  /**
   * Selects a new wander target within 1.5m radius of the nest.
   * Restricts angle to <= 90 deg relative to current velocity to avoid sharp U-turns.
   */
  public pickNewWanderTarget() {
    const radius = CONFIG.physics.nestWanderRadius;
    const forward = this.velocity.lengthSq() > 0.001
      ? this.velocity.clone().normalize()
      : new THREE.Vector3(0, 0, -1);

    // Angle within -75 to +75 degrees (strictly <= 90 deg)
    const yawOffset = (Math.random() - 0.5) * (Math.PI * 0.8);
    const pitchOffset = (Math.random() - 0.5) * 0.5;

    const candidateDir = forward
      .clone()
      .applyAxisAngle(new THREE.Vector3(0, 1, 0), yawOffset);
    candidateDir.y += pitchOffset;
    candidateDir.normalize();

    const candidateDist = 0.6 + Math.random() * (radius - 0.6);
    const candidatePos = this.nestPosition
      .clone()
      .add(candidateDir.multiplyScalar(candidateDist));

    // Clamp candidate height within nest vertical envelope
    candidatePos.y = THREE.MathUtils.clamp(
      candidatePos.y,
      this.nestPosition.y - 0.6,
      this.nestPosition.y + 0.6
    );

    this.wanderTarget.copy(candidatePos);
  }

  /**
   * Physics steering update
   */
  public update(
    delta: number,
    elapsedTime: number,
    playerPos: THREE.Vector3,
    reactiveAudioLevel: number = 0,
    cameraMatrixInverse?: THREE.Matrix4,
    cameraAspect: number = 1.0
  ) {
    // Clamped deltaTime (max 0.05s) to prevent teleporting on lag
    const dt = Math.min(delta, 0.05);

    if (this.isDead) {
      this.group.position.y -= dt * 3.5;
      this.group.rotation.x += dt * 5;
      this.group.scale.multiplyScalar(0.96);
      this.trailPoints = [];
      this.updateTrailGeometry();
      return;
    }

    const dCam = this.group.position.distanceTo(playerPos);

    // --- PROBLEMA B.3: DETERMINISTIC DISTANCE OPACITY FORMULA ---
    // d >= 7.0m -> op = 0
    // 7.0m > d > 4.5m -> smoothstep(7.0, 4.5, d)
    // d <= 4.5m -> op = 1.0 exact
    let op = 0.0;
    if (dCam <= CONFIG.visibility.solidDistance) {
      op = 1.0;
    } else if (dCam < CONFIG.visibility.invisibleDistance) {
      const t = (CONFIG.visibility.invisibleDistance - dCam) /
        (CONFIG.visibility.invisibleDistance - CONFIG.visibility.solidDistance);
      // Hermite smoothstep (0 to 1)
      op = t * t * (3.0 - 2.0 * t);
    }
    this.currentOpacity = Math.max(0.0, Math.min(1.0, op));

    // PROBLEMA B.4: When op = 1, transparent = false, depthWrite = true
    const isSolid = this.currentOpacity >= 0.999;
    for (const mat of this.materials) {
      if (mat !== this.trailLine.material) {
        mat.opacity = this.currentOpacity;
        mat.transparent = !isSolid;
        mat.depthWrite = true;
      }
    }

    // Scale clamp
    const scaleFactor = THREE.MathUtils.lerp(
      CONFIG.visibility.minScaleFactor,
      1.0,
      this.currentOpacity
    );
    this.group.scale.setScalar(this.baseScale * scaleFactor);

    // --- PROBLEMA C: STEERING PHYSICS SYSTEM (SINGLE MOTION MODEL) ---
    // 1. Target arrival check
    const distToTarget = this.group.position.distanceTo(this.wanderTarget);
    if (distToTarget < CONFIG.physics.targetArrivalThreshold) {
      this.pickNewWanderTarget();
    }

    // 2. Seek steering force towards wanderTarget
    const desired = this.wanderTarget.clone().sub(this.group.position);
    if (desired.lengthSq() > 0.0001) {
      desired.normalize().multiplyScalar(this.baseSpeed);
    }
    const steer = desired.sub(this.velocity);
    // Limit acceleration magnitude
    if (steer.length() > CONFIG.physics.maxAcceleration) {
      steer.setLength(CONFIG.physics.maxAcceleration);
    }
    this.acceleration.copy(steer);

    // 3. Smooth Camera Repulsion (if < 1.5m, add progressive repulsion force)
    if (dCam < CONFIG.physics.cameraRepelDistance) {
      const repelDir = this.group.position.clone().sub(playerPos).normalize();
      const repelForce = (CONFIG.physics.cameraRepelDistance - dCam) * CONFIG.physics.cameraRepelStrength;
      this.acceleration.addScaledVector(repelDir, repelForce);
    }

    // 4. Subtle brief zigzag acceleration (infrequent, <= 0.25s)
    this.zigzagTimer += dt;
    if (!this.isZigzagging && this.zigzagTimer >= this.nextZigzagInterval) {
      this.isZigzagging = true;
      this.zigzagProgress = 0;
      this.zigzagTimer = 0;
      this.nextZigzagInterval =
        CONFIG.physics.zigzagMinInterval +
        Math.random() * (CONFIG.physics.zigzagMaxInterval - CONFIG.physics.zigzagMinInterval);

      // Lateral vector perpendicular to velocity
      const lateral = new THREE.Vector3(
        -this.velocity.z,
        (Math.random() - 0.5) * 0.4,
        this.velocity.x
      ).normalize();
      this.zigzagForce.copy(lateral).multiplyScalar(CONFIG.physics.zigzagStrength);
    }

    if (this.isZigzagging) {
      this.zigzagProgress += dt;
      this.acceleration.add(this.zigzagForce);
      if (this.zigzagProgress >= CONFIG.physics.zigzagDuration) {
        this.isZigzagging = false;
      }
    }

    // 5. Integrate Velocity: velocity += acceleration * dt
    this.velocity.addScaledVector(this.acceleration, dt);

    // 6. Turn rate limit (max 120 deg/s)
    if (this.prevVelocity.lengthSq() > 0.001 && this.velocity.lengthSq() > 0.001) {
      const currentDir = this.velocity.clone().normalize();
      const maxTurnRad = (CONFIG.physics.maxTurnRateDeg * Math.PI) / 180 * dt;
      const angle = this.prevVelocity.angleTo(currentDir);
      if (angle > maxTurnRad) {
        // Rotate prevVelocity towards currentDir by maxTurnRad
        const axis = new THREE.Vector3().crossVectors(this.prevVelocity, currentDir).normalize();
        if (axis.lengthSq() > 0.001) {
          this.prevVelocity.applyAxisAngle(axis, maxTurnRad);
          const spd = this.velocity.length();
          this.velocity.copy(this.prevVelocity).multiplyScalar(spd);
        }
      } else {
        this.prevVelocity.copy(currentDir);
      }
    }

    // 7. Damping: light friction to avoid oscillations
    const damp = Math.pow(1.0 - CONFIG.physics.dampingPerSec, dt);
    this.velocity.multiplyScalar(damp);

    // 8. Screen Angular Velocity Clamping (<= 70 deg/s in view)
    let isInView = false;
    if (cameraMatrixInverse) {
      const relCam = this.group.position.clone().applyMatrix4(cameraMatrixInverse);
      if (relCam.z < -0.2) {
        const fovTan = Math.tan((35 * Math.PI) / 180);
        const halfWidthAtZ = -relCam.z * fovTan * cameraAspect;
        const halfHeightAtZ = -relCam.z * fovTan;
        isInView = Math.abs(relCam.x) <= halfWidthAtZ * 1.05 && Math.abs(relCam.y) <= halfHeightAtZ * 1.05;
      }
    }

    if (isInView) {
      const maxScreenRad = (CONFIG.physics.maxScreenAngularSpeed * Math.PI) / 180;
      const maxLinearSpeed = Math.max(0.4, dCam * maxScreenRad);
      if (this.velocity.length() > maxLinearSpeed) {
        const curSpd = this.velocity.length();
        const clampedSpd = THREE.MathUtils.lerp(curSpd, maxLinearSpeed, dt * 5.0);
        this.velocity.setLength(clampedSpd);
      }
    } else {
      if (this.velocity.length() > CONFIG.physics.maxSpeed) {
        this.velocity.setLength(CONFIG.physics.maxSpeed);
      }
    }

    this.currentSpeed = this.velocity.length();

    // 9. Update Position: continuous movement (position += velocity * dt)
    // PROHIBIDO modificar position con valores aleatorios o teletransportes
    this.group.position.addScaledVector(this.velocity, dt);

    // 10. Orient body towards velocity
    if (this.velocity.lengthSq() > 0.0001) {
      this.group.lookAt(this.group.position.clone().add(this.velocity));
      this.group.rotation.z = -this.velocity.x * 0.12;
    }

    // Wing flapping
    const flapRate = this.flapSpeed * (this.isZigzagging ? 1.3 : 1.0);
    const flap = Math.sin((elapsedTime + this.timeOffset) * flapRate) * 0.85;
    this.leftWing.rotation.z = flap;
    this.rightWing.rotation.z = -flap;

    // 11. Motion Trail Update
    if (CONFIG.trail.enabled && this.currentOpacity > 0.05) {
      const tailPos = this.group.position.clone().add(
        new THREE.Vector3(0, 0, 0.35).applyQuaternion(this.group.quaternion)
      );

      this.trailPoints.unshift({
        position: tailPos,
        timestamp: elapsedTime,
      });

      const cutoff = elapsedTime - CONFIG.trail.lifetimeSec;
      while (
        this.trailPoints.length > 0 &&
        this.trailPoints[this.trailPoints.length - 1].timestamp < cutoff
      ) {
        this.trailPoints.pop();
      }

      if (this.trailPoints.length > CONFIG.trail.maxPoints) {
        this.trailPoints.length = CONFIG.trail.maxPoints;
      }

      this.updateTrailGeometry();
    } else {
      this.trailPoints = [];
      this.updateTrailGeometry();
    }

    // Boss shake on scream
    if (this.isBoss && reactiveAudioLevel > 0.05) {
      const shake = reactiveAudioLevel * 0.2;
      this.group.position.x += (Math.random() - 0.5) * shake;
      this.group.position.y += (Math.random() - 0.5) * shake;
      this.group.position.z += (Math.random() - 0.5) * shake;
    }
  }

  private updateTrailGeometry() {
    const geo = this.trailLine.geometry as THREE.BufferGeometry;
    const posAttr = geo.getAttribute('position') as THREE.BufferAttribute;
    const count = this.trailPoints.length;

    for (let i = 0; i < CONFIG.trail.maxPoints; i++) {
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
    this.velocity.set(0, 0, 0);
    this.acceleration.set(0, 0, 0);
    this.currentOpacity = 0.0;
    this.trailPoints = [];
    this.updateTrailGeometry();
    this.pickNewWanderTarget();

    for (const mat of this.materials) {
      if (mat !== this.trailLine.material) {
        mat.opacity = 0.0;
        mat.transparent = true;
      }
    }
    this.group.scale.setScalar(this.baseScale * CONFIG.visibility.minScaleFactor);
  }

  public kill() {
    this.isDead = true;
    this.deathTime = performance.now();
    this.trailPoints = [];
    this.updateTrailGeometry();
  }
}
