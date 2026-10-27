/**
 * Mosquito.ts
 * 3D Mosquito entity with:
 * - 100% solid opacity ALWAYS (transparent = false, opacity = 1, depthWrite = true, depthTest = true)
 * - No distance opacity fade! Instead, distance scaling (0.6x to 1.0x between 9m and 6m; invisible > 9m)
 * - Unique, cloned materials per instance (no shared material bugs)
 * - Single physical steering system (seek wanderTarget, maxSpeed 1.2 m/s, maxAcceleration 2 m/s², maxTurnRate 90°/s)
 * - Arc/figure-eight patrolling in 2m radius around nest, new target <= 70° from current direction
 * - Occasional hovering/perching pauses (0.5s - 1.2s) for player to aim
 * - Screen angular velocity capped to <= 40°/s
 * - Smooth camera evasion (< 3.0m)
 * - Generous ~0.48m hitbox sphere
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

  // Speeds & dynamics
  public baseSpeed: number;
  public currentSpeed: number;
  private flapSpeed: number;
  private timeOffset: number;
  public baseScale: number;

  // Pausing / Hovering mechanic (perch/hover for 0.5s - 1.2s to facilitate aiming)
  private pauseTimer: number = 0;
  private nextPauseInterval: number = 6.0;
  private isPaused: boolean = false;
  private pauseDuration: number = 0.8;
  private pauseProgress: number = 0;

  // Zigzag pulses (brief, infrequent, amplitude < 0.4m)
  private zigzagTimer: number = 0;
  private nextZigzagInterval: number = 9.0;
  private isZigzagging: boolean = false;
  private zigzagProgress: number = 0;
  private zigzagForce: THREE.Vector3 = new THREE.Vector3();

  constructor(options: MosquitoOptions) {
    this.id = options.id;
    this.nestId = options.nestId;
    this.nestPosition = options.nestPosition.clone();
    this.nestRadius = options.nestRadius || CONFIG.nests.patrolRadius;
    this.isBoss = !!options.isBoss;
    this.level = options.level || 1;

    this.baseSpeed = this.isBoss ? 0.8 : CONFIG.physics.maxSpeed;
    this.currentSpeed = this.baseSpeed;
    this.baseScale = options.scale || (this.isBoss ? CONFIG.visibility.bossScale : CONFIG.visibility.baseScale);
    this.flapSpeed = this.isBoss ? 24 : this.level === 1 ? 38 : 48;
    this.timeOffset = Math.random() * 100;

    this.group = new THREE.Group();
    this.group.position.copy(this.nestPosition);
    this.group.renderOrder = 10;

    // Initial heading & velocity
    const initAngle = Math.random() * Math.PI * 2;
    this.velocity.set(Math.cos(initAngle) * 0.4, 0, Math.sin(initAngle) * 0.4);
    this.prevVelocity.copy(this.velocity).normalize();

    // Pick first target inside nest patrol area
    this.pickNewWanderTarget();

    // --- REGLA 2: OPACIDAD 100% SIEMPRE. NADA DE TRANSPARENCIA ---
    // Cada mosquito tiene sus propios materiales (.clone() / fresh)
    const bodyMat = new THREE.MeshStandardMaterial({
      color: this.isBoss ? 0x220510 : CONFIG.visibility.bodyColor,
      roughness: 0.5,
      metalness: 0.1,
      transparent: false,
      opacity: 1.0,
      depthWrite: true,
      depthTest: true,
      blending: THREE.NormalBlending,
    });

    // Reborde / Outline claro fino para contraste sobre fondos claros y oscuros
    const outlineMat = new THREE.MeshBasicMaterial({
      color: CONFIG.visibility.outlineColor,
      side: THREE.BackSide,
      transparent: false,
      opacity: 1.0,
      depthWrite: true,
      depthTest: true,
      blending: THREE.NormalBlending,
    });

    const eyeMat = new THREE.MeshBasicMaterial({
      color: this.isBoss ? 0xff0044 : 0xff1e00,
      transparent: false,
      opacity: 1.0,
      depthWrite: true,
      depthTest: true,
    });

    const wingMat = new THREE.MeshBasicMaterial({
      color: this.isBoss ? 0xf472b6 : 0xdbeafe,
      side: THREE.DoubleSide,
      transparent: false,
      opacity: 1.0,
      depthWrite: true,
      depthTest: true,
      blending: THREE.NormalBlending,
    });

    const needleMat = new THREE.MeshBasicMaterial({
      color: 0x09090b,
      transparent: false,
      opacity: 1.0,
      depthWrite: true,
      depthTest: true,
    });

    // --- Geometría 3D sólida y contrastada ---
    // 1. Abdomen ovalado
    const abdomenGeo = new THREE.ConeGeometry(0.2, 0.95, 8);
    abdomenGeo.rotateX(Math.PI / 2);
    const abdomen = new THREE.Mesh(abdomenGeo, bodyMat.clone());
    abdomen.position.set(0, 0, 0.48);
    abdomen.renderOrder = 10;
    this.group.add(abdomen);

    // Outline abdomen
    const abdomenOutline = new THREE.Mesh(abdomenGeo, outlineMat.clone());
    abdomenOutline.scale.set(1.12, 1.08, 1.12);
    abdomenOutline.position.copy(abdomen.position);
    abdomenOutline.renderOrder = 9;
    this.group.add(abdomenOutline);

    // 2. Tórax
    const thoraxGeo = new THREE.SphereGeometry(0.26, 8, 8);
    const thorax = new THREE.Mesh(thoraxGeo, bodyMat.clone());
    thorax.renderOrder = 10;
    this.group.add(thorax);

    const thoraxOutline = new THREE.Mesh(thoraxGeo, outlineMat.clone());
    thoraxOutline.scale.setScalar(1.14);
    thoraxOutline.renderOrder = 9;
    this.group.add(thoraxOutline);

    // 3. Cabeza
    const headGeo = new THREE.SphereGeometry(0.18, 8, 8);
    const head = new THREE.Mesh(headGeo, bodyMat.clone());
    head.position.set(0, 0.05, -0.34);
    head.renderOrder = 10;
    this.group.add(head);

    // 4. Ojos rojos contrastados
    const eyeGeo = new THREE.SphereGeometry(0.08, 6, 6);
    const leftEye = new THREE.Mesh(eyeGeo, eyeMat.clone());
    leftEye.position.set(-0.1, 0.1, -0.4);
    const rightEye = new THREE.Mesh(eyeGeo, eyeMat.clone());
    rightEye.position.set(0.1, 0.1, -0.4);
    leftEye.renderOrder = 10;
    rightEye.renderOrder = 10;
    this.group.add(leftEye, rightEye);

    // 5. Probóscide / Aguijón
    const needleGeo = new THREE.CylinderGeometry(0.02, 0.038, 0.5, 5);
    needleGeo.rotateX(Math.PI / 3);
    const needle = new THREE.Mesh(needleGeo, needleMat.clone());
    needle.position.set(0, -0.16, -0.54);
    needle.renderOrder = 10;
    this.group.add(needle);

    // 6. Alas sólidas y nítidas
    const wingGeo = new THREE.PlaneGeometry(0.32, 0.95);
    wingGeo.translate(0, 0.48, 0);
    wingGeo.rotateX(Math.PI / 2);

    this.leftWing = new THREE.Mesh(wingGeo, wingMat.clone());
    this.leftWing.position.set(-0.14, 0.2, -0.05);
    this.leftWing.rotation.y = 0.45;
    this.leftWing.renderOrder = 10;

    this.rightWing = new THREE.Mesh(wingGeo, wingMat.clone());
    this.rightWing.position.set(0.14, 0.2, -0.05);
    this.rightWing.rotation.y = -0.45;
    this.rightWing.renderOrder = 10;

    this.group.add(this.leftWing, this.rightWing);

    // 7. Patas
    for (let i = -1; i <= 1; i++) {
      const legGeo = new THREE.CylinderGeometry(0.016, 0.016, 0.7, 3);
      const lLeg = new THREE.Mesh(legGeo, needleMat.clone());
      lLeg.position.set(-0.28, -0.22, i * 0.2);
      lLeg.rotation.z = 0.8;
      lLeg.rotation.x = i * 0.3;
      lLeg.renderOrder = 10;

      const rLeg = new THREE.Mesh(legGeo, needleMat.clone());
      rLeg.position.set(0.28, -0.22, i * 0.2);
      rLeg.rotation.z = -0.8;
      rLeg.rotation.x = i * 0.3;
      rLeg.renderOrder = 10;

      this.group.add(lLeg, rLeg);
    }

    // 8. Hitbox generosa de golpe (~0.48m de radio)
    const hitRadius = this.isBoss ? 1.6 : CONFIG.combat.hitboxRadius;
    const hitGeo = new THREE.SphereGeometry(hitRadius, 6, 6);
    const hitSphereMat = new THREE.MeshBasicMaterial({ visible: false });
    this.hitSphere = new THREE.Mesh(hitGeo, hitSphereMat);
    this.hitSphere.userData = { mosquitoId: this.id, isBoss: this.isBoss };
    this.group.add(this.hitSphere);

    // Initial scale
    this.group.scale.setScalar(this.baseScale);
  }

  /**
   * Genera un nuevo objetivo de patrulla en un radio de 2m alrededor del nido.
   * El nuevo objetivo forma como máximo 70° con la dirección actual (evita giros en U).
   */
  public pickNewWanderTarget() {
    const radius = CONFIG.nests.patrolRadius;
    const currentHeading = this.velocity.lengthSq() > 0.001
      ? this.velocity.clone().normalize()
      : new THREE.Vector3(0, 0, -1);

    // Ángulo máximo de 70° respecto a la dirección actual
    const maxAngleRad = (CONFIG.physics.maxHeadingAngleDeg * Math.PI) / 180;
    const yawOffset = (Math.random() - 0.5) * 2 * maxAngleRad;
    const pitchOffset = (Math.random() - 0.5) * 0.45;

    const candidateDir = currentHeading
      .clone()
      .applyAxisAngle(new THREE.Vector3(0, 1, 0), yawOffset);
    candidateDir.y += pitchOffset;
    candidateDir.normalize();

    // Distancia suave de patrullaje
    const candidateDist = 0.8 + Math.random() * (radius - 0.8);
    const candidatePos = this.nestPosition
      .clone()
      .add(candidateDir.multiplyScalar(candidateDist));

    // Mantener dentro del sobre vertical del nido
    candidatePos.y = THREE.MathUtils.clamp(
      candidatePos.y,
      this.nestPosition.y - 0.7,
      this.nestPosition.y + 0.7
    );

    this.wanderTarget.copy(candidatePos);
  }

  /**
   * Actualización física del vuelo (steering único, sin opacidades)
   */
  public update(
    delta: number,
    elapsedTime: number,
    playerPos: THREE.Vector3,
    reactiveAudioLevel: number = 0,
    cameraMatrixInverse?: THREE.Matrix4,
    cameraAspect: number = 1.0
  ) {
    // DeltaTime clamp (máximo 0.05s)
    const dt = Math.min(delta, 0.05);

    if (this.isDead) {
      this.group.position.y -= dt * 3.5;
      this.group.rotation.x += dt * 5;
      this.group.scale.multiplyScalar(0.96);
      return;
    }

    const dCam = this.group.position.distanceTo(playerPos);

    // --- REGLA 2: ESCALADO ENTRE 9m y 6m (OPACIDAD SIEMPRE 1.0) ---
    // Si d > 9m: mosquito.visible = false
    // Si d <= 9m: crece suavemente de 0.6 a 1.0 entre 9m y 6m
    if (dCam > CONFIG.visibility.maxVisibleDistance) {
      this.group.visible = false;
      return;
    } else {
      this.group.visible = true;
      const t = THREE.MathUtils.clamp(
        (CONFIG.visibility.maxVisibleDistance - dCam) /
          (CONFIG.visibility.maxVisibleDistance - CONFIG.visibility.fullScaleDistance),
        0.0,
        1.0
      );
      // Interpolación suave Hermite
      const smoothT = t * t * (3.0 - 2.0 * t);
      const scaleFactor = THREE.MathUtils.lerp(
        CONFIG.visibility.minScaleRatio,
        1.0,
        smoothT
      );
      this.group.scale.setScalar(this.baseScale * scaleFactor);
    }

    // --- REGLA 4: PAUSAS OCASIONALES (se posa/flota casi quieto 0.5s a 1.2s) ---
    this.pauseTimer += dt;
    if (!this.isPaused && this.pauseTimer >= this.nextPauseInterval) {
      this.isPaused = true;
      this.pauseProgress = 0;
      this.pauseTimer = 0;
      this.pauseDuration =
        CONFIG.physics.pauseDurationMin +
        Math.random() *
          (CONFIG.physics.pauseDurationMax - CONFIG.physics.pauseDurationMin);
      this.nextPauseInterval =
        CONFIG.physics.pauseMinInterval +
        Math.random() *
          (CONFIG.physics.pauseMaxInterval - CONFIG.physics.pauseMinInterval);
    }

    if (this.isPaused) {
      this.pauseProgress += dt;
      // Damping fuerte durante la pausa, permitiendo leve oscilación natural
      this.velocity.multiplyScalar(Math.pow(0.15, dt));
      this.group.position.y += Math.sin((elapsedTime + this.timeOffset) * 4.0) * (0.002 * dt * 60);

      if (this.pauseProgress >= this.pauseDuration) {
        this.isPaused = false;
        this.pickNewWanderTarget();
      }
    }

    // --- SISTEMA ÚNICO DE STEERING ---
    // 1. Llegada al objetivo
    const distToTarget = this.group.position.distanceTo(this.wanderTarget);
    if (distToTarget < 0.5) {
      this.pickNewWanderTarget();
    }

    // 2. Fuerza de Seek hacia wanderTarget
    const desired = this.wanderTarget.clone().sub(this.group.position);
    if (desired.lengthSq() > 0.0001) {
      const targetSpd = this.isPaused ? 0.2 : this.baseSpeed;
      desired.normalize().multiplyScalar(targetSpd);
    }
    const steer = desired.sub(this.velocity);
    if (steer.length() > CONFIG.physics.maxAcceleration) {
      steer.setLength(CONFIG.physics.maxAcceleration);
    }
    this.acceleration.copy(steer);

    // 3. Evasión de cámara suave (< 3.0m, NUNCA a menos de 3m)
    if (dCam < CONFIG.physics.cameraRepelDistance) {
      const repelDir = this.group.position.clone().sub(playerPos).normalize();
      const repelForce =
        (CONFIG.physics.cameraRepelDistance - dCam) * CONFIG.physics.cameraRepelStrength;
      this.acceleration.addScaledVector(repelDir, repelForce);
    }

    // 4. Zigzag ocasional suave (amplitud < 0.4m, duración <= 0.3s, cada 8 a 12s)
    this.zigzagTimer += dt;
    if (!this.isZigzagging && this.zigzagTimer >= this.nextZigzagInterval) {
      this.isZigzagging = true;
      this.zigzagProgress = 0;
      this.zigzagTimer = 0;
      this.nextZigzagInterval =
        CONFIG.physics.zigzagMinInterval +
        Math.random() *
          (CONFIG.physics.zigzagMaxInterval - CONFIG.physics.zigzagMinInterval);

      const lateral = new THREE.Vector3(
        -this.velocity.z,
        (Math.random() - 0.5) * 0.3,
        this.velocity.x
      ).normalize();
      this.zigzagForce.copy(lateral).multiplyScalar(CONFIG.physics.zigzagAmplitude * 3.0);
    }

    if (this.isZigzagging) {
      this.zigzagProgress += dt;
      this.acceleration.add(this.zigzagForce);
      if (this.zigzagProgress >= CONFIG.physics.zigzagDuration) {
        this.isZigzagging = false;
      }
    }

    // 5. Integrar velocidad: velocity += accel * dt
    this.velocity.addScaledVector(this.acceleration, dt);

    // 6. Límite de giro (maxTurnRate = 90°/s)
    if (this.prevVelocity.lengthSq() > 0.001 && this.velocity.lengthSq() > 0.001) {
      const currentHeading = this.velocity.clone().normalize();
      const maxTurnRad = ((CONFIG.physics.maxTurnRateDeg * Math.PI) / 180) * dt;
      const angle = this.prevVelocity.angleTo(currentHeading);
      if (angle > maxTurnRad) {
        const axis = new THREE.Vector3()
          .crossVectors(this.prevVelocity, currentHeading)
          .normalize();
        if (axis.lengthSq() > 0.001) {
          this.prevVelocity.applyAxisAngle(axis, maxTurnRad);
          const spd = this.velocity.length();
          this.velocity.copy(this.prevVelocity).multiplyScalar(spd);
        }
      } else {
        this.prevVelocity.copy(currentHeading);
      }
    }

    // 7. Damping suave
    const damp = Math.pow(1.0 - CONFIG.physics.dampingPerSec, dt);
    this.velocity.multiplyScalar(damp);

    // 8. Límite de velocidad angular en pantalla (CONFIG.maxScreenAngularSpeed = 40°/s)
    let isInView = false;
    if (cameraMatrixInverse) {
      const relCam = this.group.position.clone().applyMatrix4(cameraMatrixInverse);
      if (relCam.z < -0.2) {
        const fovTan = Math.tan(((35 * Math.PI) / 180));
        const halfWidthAtZ = -relCam.z * fovTan * cameraAspect;
        const halfHeightAtZ = -relCam.z * fovTan;
        isInView =
          Math.abs(relCam.x) <= halfWidthAtZ * 1.05 &&
          Math.abs(relCam.y) <= halfHeightAtZ * 1.05;
      }
    }

    if (isInView) {
      const maxScreenRad = (CONFIG.physics.maxScreenAngularSpeed * Math.PI) / 180;
      const maxLinearSpeed = Math.max(0.35, dCam * maxScreenRad);
      if (this.velocity.length() > maxLinearSpeed) {
        const curSpd = this.velocity.length();
        const clampedSpd = THREE.MathUtils.lerp(curSpd, maxLinearSpeed, dt * 4.0);
        this.velocity.setLength(clampedSpd);
      }
    } else {
      if (this.velocity.length() > CONFIG.physics.maxSpeed) {
        this.velocity.setLength(CONFIG.physics.maxSpeed);
      }
    }

    this.currentSpeed = this.velocity.length();

    // 9. Actualizar posición continua: position += velocity * dt
    // PROHIBIDO teletransportar o sumar offsets aleatorios directos
    this.group.position.addScaledVector(this.velocity, dt);

    // 10. Orientación y peralte (banking) en curvas
    if (this.velocity.lengthSq() > 0.0001) {
      this.group.lookAt(this.group.position.clone().add(this.velocity));
      // Inclinación leve (banking) proporcional a la aceleración lateral
      const banking = -this.velocity.x * 0.22;
      this.group.rotation.z = banking;
    }

    // Aleteo
    const flapRate = this.isPaused ? 16 : this.flapSpeed;
    const flap = Math.sin((elapsedTime + this.timeOffset) * flapRate) * 0.85;
    this.leftWing.rotation.z = flap;
    this.rightWing.rotation.z = -flap;

    // Boss shake
    if (this.isBoss && reactiveAudioLevel > 0.05) {
      const shake = reactiveAudioLevel * 0.2;
      this.group.position.x += (Math.random() - 0.5) * shake;
      this.group.position.y += (Math.random() - 0.5) * shake;
      this.group.position.z += (Math.random() - 0.5) * shake;
    }
  }

  public respawnAtNest() {
    this.isDead = false;
    this.deathTime = 0;
    this.group.position.copy(this.nestPosition);
    this.velocity.set(0, 0, 0);
    this.acceleration.set(0, 0, 0);
    this.group.visible = true;
    this.pickNewWanderTarget();
    this.group.scale.setScalar(this.baseScale * CONFIG.visibility.minScaleRatio);
  }

  public kill() {
    this.isDead = true;
    this.deathTime = performance.now();
  }
}
