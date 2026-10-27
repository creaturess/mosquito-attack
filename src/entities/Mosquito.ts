/**
 * Mosquito.ts
 * 3D Mosquito entity:
 * - 100% solid opacity ALWAYS, visible = true ALWAYS while alive
 * - Frustum culling disabled on all meshes to prevent disappearing at screen edges
 * - Soft camera evasion ONLY if < 1.5m (smooth force, no jumps)
 * - Single steering physics (maxSpeed 1.0m/s, maxAcceleration 1.8m/s², maxTurnRate 100°/s)
 * - Patrols in 1.5m radius around nest with smooth arcs (<= 70° from current heading)
 * - Leash to nest: curves back if > 2.2m from nest
 * - Hover/perch pauses of 0.6s to 1.2s every 4s to 7s for aiming
 * - Attached THREE.PositionalAudio instance that plays continuously while alive
 * - Generous ~0.5m hitbox
 */

import * as THREE from 'three';
import { CONFIG } from '../config/gameplayConfig';
import { buzzManager } from '../audio/SpatialBuzzManager';

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

  // Wings & meshes
  private leftWing: THREE.Mesh;
  private rightWing: THREE.Mesh;
  public hitSphere: THREE.Mesh;

  // Dedicated 3D Audio
  public audio?: THREE.PositionalAudio;
  public audioFilter?: BiquadFilterNode;

  // Dynamics & speeds
  public baseSpeed: number;
  public currentSpeed: number;
  private flapSpeed: number;
  private timeOffset: number;
  public baseScale: number;

  // Pausing / Hovering mechanic (perch/hover for 0.6s - 1.2s every 4s - 7s)
  private pauseTimer: number = 0;
  private nextPauseInterval: number = 5.0;
  public isPaused: boolean = false;
  private pauseDuration: number = 0.8;
  private pauseProgress: number = 0;

  constructor(options: MosquitoOptions) {
    this.id = options.id;
    this.nestId = options.nestId;
    this.nestPosition = options.nestPosition.clone();
    this.nestRadius = options.nestRadius || CONFIG.nests.patrolRadius;
    this.isBoss = !!options.isBoss;
    this.level = options.level || 1;

    this.baseSpeed = this.isBoss ? 0.75 : CONFIG.physics.maxSpeed;
    this.currentSpeed = this.baseSpeed;
    this.baseScale = options.scale || (this.isBoss ? CONFIG.visibility.bossScale : CONFIG.visibility.baseScale);
    this.flapSpeed = this.isBoss ? 24 : this.level === 1 ? 38 : 46;
    this.timeOffset = Math.random() * 100;

    this.group = new THREE.Group();
    this.group.position.copy(this.nestPosition);
    this.group.renderOrder = 10;
    this.group.frustumCulled = false; // Never disappear at screen edges

    // Initial heading & velocity
    const initAngle = Math.random() * Math.PI * 2;
    this.velocity.set(Math.cos(initAngle) * 0.4, 0, Math.sin(initAngle) * 0.4);
    this.prevVelocity.copy(this.velocity).normalize();

    // Pick first target inside nest zone
    this.pickNewWanderTarget();

    // --- 100% SOLID MATERIALS (NO TRANSPARENCY) ---
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

    // --- 3D Solid Geometry with Frustum Culling Disabled ---
    // 1. Abdomen
    const abdomenGeo = new THREE.ConeGeometry(0.2, 0.95, 8);
    abdomenGeo.rotateX(Math.PI / 2);
    const abdomen = new THREE.Mesh(abdomenGeo, bodyMat.clone());
    abdomen.position.set(0, 0, 0.48);
    abdomen.renderOrder = 10;
    abdomen.frustumCulled = false;
    this.group.add(abdomen);

    // Abdomen rim outline
    const abdomenOutline = new THREE.Mesh(abdomenGeo, outlineMat.clone());
    abdomenOutline.scale.set(1.12, 1.08, 1.12);
    abdomenOutline.position.copy(abdomen.position);
    abdomenOutline.renderOrder = 9;
    abdomenOutline.frustumCulled = false;
    this.group.add(abdomenOutline);

    // 2. Thorax
    const thoraxGeo = new THREE.SphereGeometry(0.26, 8, 8);
    const thorax = new THREE.Mesh(thoraxGeo, bodyMat.clone());
    thorax.renderOrder = 10;
    thorax.frustumCulled = false;
    this.group.add(thorax);

    const thoraxOutline = new THREE.Mesh(thoraxGeo, outlineMat.clone());
    thoraxOutline.scale.setScalar(1.14);
    thoraxOutline.renderOrder = 9;
    thoraxOutline.frustumCulled = false;
    this.group.add(thoraxOutline);

    // 3. Head
    const headGeo = new THREE.SphereGeometry(0.18, 8, 8);
    const head = new THREE.Mesh(headGeo, bodyMat.clone());
    head.position.set(0, 0.05, -0.34);
    head.renderOrder = 10;
    head.frustumCulled = false;
    this.group.add(head);

    // 4. Eyes
    const eyeGeo = new THREE.SphereGeometry(0.08, 6, 6);
    const leftEye = new THREE.Mesh(eyeGeo, eyeMat.clone());
    leftEye.position.set(-0.1, 0.1, -0.4);
    const rightEye = new THREE.Mesh(eyeGeo, eyeMat.clone());
    rightEye.position.set(0.1, 0.1, -0.4);
    leftEye.renderOrder = 10;
    rightEye.renderOrder = 10;
    leftEye.frustumCulled = false;
    rightEye.frustumCulled = false;
    this.group.add(leftEye, rightEye);

    // 5. Proboscis
    const needleGeo = new THREE.CylinderGeometry(0.02, 0.038, 0.5, 5);
    needleGeo.rotateX(Math.PI / 3);
    const needle = new THREE.Mesh(needleGeo, needleMat.clone());
    needle.position.set(0, -0.16, -0.54);
    needle.renderOrder = 10;
    needle.frustumCulled = false;
    this.group.add(needle);

    // 6. Wings
    const wingGeo = new THREE.PlaneGeometry(0.32, 0.95);
    wingGeo.translate(0, 0.48, 0);
    wingGeo.rotateX(Math.PI / 2);

    this.leftWing = new THREE.Mesh(wingGeo, wingMat.clone());
    this.leftWing.position.set(-0.14, 0.2, -0.05);
    this.leftWing.rotation.y = 0.45;
    this.leftWing.renderOrder = 10;
    this.leftWing.frustumCulled = false;

    this.rightWing = new THREE.Mesh(wingGeo, wingMat.clone());
    this.rightWing.position.set(0.14, 0.2, -0.05);
    this.rightWing.rotation.y = -0.45;
    this.rightWing.renderOrder = 10;
    this.rightWing.frustumCulled = false;

    this.group.add(this.leftWing, this.rightWing);

    // 7. Legs
    for (let i = -1; i <= 1; i++) {
      const legGeo = new THREE.CylinderGeometry(0.016, 0.016, 0.7, 3);
      const lLeg = new THREE.Mesh(legGeo, needleMat.clone());
      lLeg.position.set(-0.28, -0.22, i * 0.2);
      lLeg.rotation.z = 0.8;
      lLeg.rotation.x = i * 0.3;
      lLeg.renderOrder = 10;
      lLeg.frustumCulled = false;

      const rLeg = new THREE.Mesh(legGeo, needleMat.clone());
      rLeg.position.set(0.28, -0.22, i * 0.2);
      rLeg.rotation.z = -0.8;
      rLeg.rotation.x = i * 0.3;
      rLeg.renderOrder = 10;
      rLeg.frustumCulled = false;

      this.group.add(lLeg, rLeg);
    }

    // 8. Hitbox generosa (~0.5m de radio)
    const hitRadius = this.isBoss ? 1.6 : CONFIG.combat.hitboxRadius;
    const hitGeo = new THREE.SphereGeometry(hitRadius, 6, 6);
    const hitSphereMat = new THREE.MeshBasicMaterial({ visible: false });
    this.hitSphere = new THREE.Mesh(hitGeo, hitSphereMat);
    this.hitSphere.userData = { mosquitoId: this.id, isBoss: this.isBoss };
    this.hitSphere.frustumCulled = false;
    this.group.add(this.hitSphere);

    // Apply scale once (always solid, no distance shrinking)
    this.group.scale.setScalar(this.baseScale);

    // Attach Positional Audio
    const audioSetup = buzzManager.attachMosquitoAudio(this.group, this.isBoss);
    if (audioSetup) {
      this.audio = audioSetup.audio;
      this.audioFilter = audioSetup.filter;
      // Start buzzing
      this.audio.setLoop(true);
      if (!this.audio.isPlaying) {
        this.audio.play();
      }
    }
  }

  /**
   * Genera un nuevo objetivo de patrulla en un radio de 1.5m alrededor del nido.
   * Si está a más de 2.2m del nido, fuerza que el objetivo vuelva suavemente hacia el nido.
   */
  public pickNewWanderTarget() {
    const distToNest = this.group.position.distanceTo(this.nestPosition);

    // Si se alejó demasiado del nido (> 2.2m), el siguiente objetivo vuelve hacia el nido
    if (distToNest > CONFIG.nests.leashRadius) {
      const dirBackToNest = this.nestPosition.clone().sub(this.group.position).normalize();
      const returnDist = 1.0 + Math.random() * 0.5;
      this.wanderTarget.copy(this.group.position).addScaledVector(dirBackToNest, returnDist);
      return;
    }

    const radius = CONFIG.nests.patrolRadius;
    const currentHeading = this.velocity.lengthSq() > 0.001
      ? this.velocity.clone().normalize()
      : new THREE.Vector3(0, 0, -1);

    // Ángulo máximo de 70° respecto a la dirección actual (sin giros en U)
    const maxAngleRad = (CONFIG.physics.maxHeadingAngleDeg * Math.PI) / 180;
    const yawOffset = (Math.random() - 0.5) * 2 * maxAngleRad;
    const pitchOffset = (Math.random() - 0.5) * 0.35;

    const candidateDir = currentHeading
      .clone()
      .applyAxisAngle(new THREE.Vector3(0, 1, 0), yawOffset);
    candidateDir.y += pitchOffset;
    candidateDir.normalize();

    const candidateDist = 0.6 + Math.random() * (radius - 0.4);
    const candidatePos = this.nestPosition
      .clone()
      .add(candidateDir.multiplyScalar(candidateDist));

    // Mantener dentro del rango de altura del nido
    candidatePos.y = THREE.MathUtils.clamp(
      candidatePos.y,
      this.nestPosition.y - 0.5,
      this.nestPosition.y + 0.5
    );

    this.wanderTarget.copy(candidatePos);
  }

  /**
   * Actualización física del vuelo (steering suave continuo, sin saltos ni desaparición)
   */
  public update(
    delta: number,
    elapsedTime: number,
    playerPos: THREE.Vector3,
    camForward?: THREE.Vector3
  ) {
    // DeltaTime clamp (máximo 0.05s)
    const dt = Math.min(delta, 0.05);

    if (this.isDead) {
      this.group.position.y -= dt * 3.5;
      this.group.rotation.x += dt * 5;
      return;
    }

    // SIEMPRE visible mientras esté vivo (nunca ocultar por distancia ni tiempo)
    this.group.visible = true;

    // --- PAUSAS DE FLOTACIÓN (0.6s a 1.2s cada 4s a 7s para poder apuntar) ---
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
      // Damping fuerte durante la pausa con flotación sutil
      this.velocity.multiplyScalar(Math.pow(0.18, dt));
      this.group.position.y += Math.sin((elapsedTime + this.timeOffset) * 3.5) * (0.002 * dt * 60);

      if (this.pauseProgress >= this.pauseDuration) {
        this.isPaused = false;
        this.pickNewWanderTarget();
      }
    }

    // --- SISTEMA ÚNICO DE STEERING ---
    // 1. Llegada al objetivo
    const distToTarget = this.group.position.distanceTo(this.wanderTarget);
    if (distToTarget < 0.45) {
      this.pickNewWanderTarget();
    }

    // 2. Fuerza de Seek hacia wanderTarget
    const desired = this.wanderTarget.clone().sub(this.group.position);
    if (desired.lengthSq() > 0.0001) {
      const targetSpd = this.isPaused ? 0.15 : this.baseSpeed;
      desired.normalize().multiplyScalar(targetSpd);
    }
    const steer = desired.sub(this.velocity);
    if (steer.length() > CONFIG.physics.maxAcceleration) {
      steer.setLength(CONFIG.physics.maxAcceleration);
    }
    this.acceleration.copy(steer);

    // 3. Evasión suave de la cámara SOLO si está a menos de 1.5m (fuerza progresiva sin saltos)
    const dCam = this.group.position.distanceTo(playerPos);
    if (dCam < CONFIG.physics.cameraRepelDistance) {
      const repelDir = this.group.position.clone().sub(playerPos).normalize();
      const repelForce =
        (CONFIG.physics.cameraRepelDistance - dCam) * CONFIG.physics.cameraRepelStrength;
      this.acceleration.addScaledVector(repelDir, repelForce);
    }

    // 4. Integrar velocidad: velocity += accel * dt
    this.velocity.addScaledVector(this.acceleration, dt);

    // 5. Límite de giro (maxTurnRate = 100°/s)
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

    // 6. Damping suave
    const damp = Math.pow(1.0 - CONFIG.physics.dampingPerSec, dt);
    this.velocity.multiplyScalar(damp);

    // 7. Límite de velocidad máxima normal (1.0 m/s)
    if (this.velocity.length() > CONFIG.physics.maxSpeed) {
      this.velocity.setLength(CONFIG.physics.maxSpeed);
    }

    this.currentSpeed = this.velocity.length();

    // 8. Actualizar posición continua: position += velocity * dt
    this.group.position.addScaledVector(this.velocity, dt);

    // 9. Orientación continua y peralte en curvas
    if (this.velocity.lengthSq() > 0.0001) {
      this.group.lookAt(this.group.position.clone().add(this.velocity));
      const banking = -this.velocity.x * 0.2;
      this.group.rotation.z = banking;
    }

    // 10. Aleteo continuo
    const flapRate = this.isPaused ? 16 : this.flapSpeed;
    const flap = Math.sin((elapsedTime + this.timeOffset) * flapRate) * 0.85;
    this.leftWing.rotation.z = flap;
    this.rightWing.rotation.z = -flap;

    // 11. Actualizar filtro lowpass direccional del audio según el ángulo de visión
    if (this.audioFilter && camForward) {
      const toMos = this.group.position.clone().sub(playerPos).normalize();
      const angleToForward = camForward.angleTo(toMos);
      buzzManager.updateDirectivity(this.audioFilter, angleToForward);
    }

    // Garantizar que el audio siga sonando
    if (this.audio && !this.audio.isPlaying) {
      this.audio.play();
    }
  }

  public respawnAtNest() {
    this.isDead = false;
    this.deathTime = 0;
    this.group.position.copy(this.nestPosition);
    this.velocity.set(0, 0, 0);
    this.acceleration.set(0, 0, 0);
    this.group.visible = true;
    this.isPaused = false;
    this.pauseTimer = 0;
    this.pickNewWanderTarget();

    // Reanudar zumbido
    if (this.audio) {
      this.audio.setLoop(true);
      if (!this.audio.isPlaying) {
        this.audio.play();
      }
    }
  }

  public kill() {
    this.isDead = true;
    this.deathTime = performance.now();
    this.group.visible = false;
    if (this.audio && this.audio.isPlaying) {
      this.audio.stop();
    }
  }
}
