/**
 * Mosquito.ts
 * Procedural 3D Mosquito entity with animated flapping wings, flight path logic, and hit states.
 */

import * as THREE from 'three';

export interface MosquitoOptions {
  id: string;
  isBoss?: boolean;
  scale?: number;
  speed?: number;
  spawnDistance?: number;
}

export class Mosquito {
  public id: string;
  public group: THREE.Group;
  public isBoss: boolean;
  public isDead: boolean = false;
  public deathTime: number = 0;
  
  // Wings for flapping animation
  private leftWing: THREE.Mesh;
  private rightWing: THREE.Mesh;
  private eyesMesh: THREE.Mesh;
  private bodyMesh: THREE.Mesh;

  // Flight dynamics
  private speed: number;
  private flightAngle: number;
  private flightPitch: number;
  private flightRadius: number;
  private flightTarget: THREE.Vector3;
  private currentVelocity: THREE.Vector3 = new THREE.Vector3();
  private flapSpeed: number = 45;
  private timeOffset: number;

  // Collision hit box mesh for easy raycasting
  public hitSphere: THREE.Mesh;

  constructor(options: MosquitoOptions) {
    this.id = options.id;
    this.isBoss = !!options.isBoss;
    this.speed = (options.speed || 1.0) * (this.isBoss ? 0.6 : 1.2);
    const baseScale = options.scale || (this.isBoss ? 4.2 : 0.85);
    this.timeOffset = Math.random() * 100;

    this.group = new THREE.Group();
    this.flightRadius = options.spawnDistance || (this.isBoss ? 5.5 : 4.0 + Math.random() * 3.5);
    this.flightAngle = Math.random() * Math.PI * 2;
    this.flightPitch = (Math.random() - 0.5) * 1.2;
    this.flightTarget = new THREE.Vector3();

    // Spawn position on a sphere around player
    this.group.position.set(
      Math.cos(this.flightAngle) * Math.cos(this.flightPitch) * this.flightRadius,
      Math.sin(this.flightPitch) * this.flightRadius,
      Math.sin(this.flightAngle) * Math.cos(this.flightPitch) * this.flightRadius
    );

    // --- Build Mosquito Geometry ---
    // Materials
    const bodyColor = this.isBoss ? 0x220510 : 0x1a1a1a;
    const stripeColor = this.isBoss ? 0x990022 : 0x4a4a4a;
    const bodyMat = new THREE.MeshStandardMaterial({
      color: bodyColor,
      roughness: 0.6,
      metalness: 0.2,
    });
    const eyeMat = new THREE.MeshBasicMaterial({
      color: this.isBoss ? 0xff0044 : 0xff2200,
    });
    const wingMat = new THREE.MeshStandardMaterial({
      color: this.isBoss ? 0xcc88bb : 0xffffff,
      transparent: true,
      opacity: 0.65,
      roughness: 0.1,
      metalness: 0.8,
      side: THREE.DoubleSide,
    });

    // 1. Abdomen (elongated striped cone/cylinder)
    const abdomenGeo = new THREE.ConeGeometry(0.18, 0.9, 8);
    abdomenGeo.rotateX(Math.PI / 2);
    const abdomen = new THREE.Mesh(abdomenGeo, bodyMat);
    abdomen.position.set(0, 0, 0.45);
    this.group.add(abdomen);

    // 2. Thorax (mid body sphere)
    const thoraxGeo = new THREE.SphereGeometry(0.24, 8, 8);
    this.bodyMesh = new THREE.Mesh(thoraxGeo, bodyMat);
    this.group.add(this.bodyMesh);

    // 3. Head (front sphere)
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

    // 5. Proboscis (sharp needle)
    const needleGeo = new THREE.CylinderGeometry(0.015, 0.03, 0.45, 5);
    needleGeo.rotateX(Math.PI / 3);
    const needleMat = new THREE.MeshStandardMaterial({ color: 0x111111 });
    const needle = new THREE.Mesh(needleGeo, needleMat);
    needle.position.set(0, -0.15, -0.5);
    this.group.add(needle);

    // 6. Wings
    const wingGeo = new THREE.PlaneGeometry(0.28, 0.85);
    wingGeo.translate(0, 0.42, 0); // anchor at wing root
    wingGeo.rotateX(Math.PI / 2);

    this.leftWing = new THREE.Mesh(wingGeo, wingMat);
    this.leftWing.position.set(-0.12, 0.18, -0.05);
    this.leftWing.rotation.y = 0.5;

    this.rightWing = new THREE.Mesh(wingGeo, wingMat);
    this.rightWing.position.set(0.12, 0.18, -0.05);
    this.rightWing.rotation.y = -0.5;

    this.group.add(this.leftWing, this.rightWing);

    // 7. Slender legs (3 pairs)
    const legMat = new THREE.MeshBasicMaterial({ color: 0x111111 });
    for (let i = -1; i <= 1; i++) {
      const legGeo = new THREE.CylinderGeometry(0.012, 0.012, 0.6, 3);
      // Left leg
      const lLeg = new THREE.Mesh(legGeo, legMat);
      lLeg.position.set(-0.25, -0.2, i * 0.18);
      lLeg.rotation.z = 0.8;
      lLeg.rotation.x = i * 0.3;
      // Right leg
      const rLeg = new THREE.Mesh(legGeo, legMat);
      rLeg.position.set(0.25, -0.2, i * 0.18);
      rLeg.rotation.z = -0.8;
      rLeg.rotation.x = i * 0.3;
      this.group.add(lLeg, rLeg);
    }

    // 8. Hit detection sphere (invisible, generous for finger taps)
    const hitRadius = this.isBoss ? 2.2 : 0.8;
    const hitGeo = new THREE.SphereGeometry(hitRadius, 6, 6);
    const hitMat = new THREE.MeshBasicMaterial({ visible: false, wireframe: true });
    this.hitSphere = new THREE.Mesh(hitGeo, hitMat);
    this.hitSphere.userData = { mosquitoId: this.id, isBoss: this.isBoss };
    this.group.add(this.hitSphere);

    // Apply scale
    this.group.scale.setScalar(baseScale);

    // If Boss, add ominous horns and glow crown
    if (this.isBoss) {
      const crownGeo = new THREE.TorusGeometry(0.4, 0.05, 8, 16);
      crownGeo.rotateX(Math.PI / 2);
      const crownMat = new THREE.MeshBasicMaterial({ color: 0xff0055 });
      const crown = new THREE.Mesh(crownGeo, crownMat);
      crown.position.set(0, 0.3, 0);
      this.group.add(crown);
    }
  }

  /**
   * Flight and wing animation update
   */
  public update(delta: number, elapsedTime: number, playerPos: THREE.Vector3, reactiveAudioLevel: number = 0) {
    if (this.isDead) {
      // Falling dead animation
      this.group.position.y -= delta * 4;
      this.group.rotation.x += delta * 6;
      this.group.rotation.z += delta * 4;
      this.group.scale.multiplyScalar(0.95);
      return;
    }

    // Wing flapping
    const flap = Math.sin((elapsedTime + this.timeOffset) * this.flapSpeed) * 0.85;
    this.leftWing.rotation.z = flap;
    this.rightWing.rotation.z = -flap;

    // Boss special audio reaction
    if (this.isBoss && reactiveAudioLevel > 0.05) {
      // Vibrate / shake violently when player is screaming
      const shakeAmt = reactiveAudioLevel * 0.25;
      this.group.position.x += (Math.random() - 0.5) * shakeAmt;
      this.group.position.y += (Math.random() - 0.5) * shakeAmt;
      this.group.position.z += (Math.random() - 0.5) * shakeAmt;
    }

    // Erratic mosquito flight pattern
    const t = (elapsedTime + this.timeOffset) * this.speed;
    
    // Orbital movement + Perlin-like oscillation
    const radiusFluctuation = Math.sin(t * 1.8) * 0.8;
    const currentR = Math.max(2.0, this.flightRadius + radiusFluctuation);

    // Wander around player
    this.flightAngle += delta * (0.8 * this.speed) * (this.isBoss ? 0.5 : 1.0);
    this.flightPitch = Math.sin(t * 0.9) * 0.7;

    const targetX = playerPos.x + Math.cos(this.flightAngle) * Math.cos(this.flightPitch) * currentR;
    const targetY = playerPos.y + Math.sin(this.flightPitch) * (currentR * 0.7) + Math.cos(t * 2.4) * 0.4;
    const targetZ = playerPos.z + Math.sin(this.flightAngle) * Math.cos(this.flightPitch) * currentR;

    this.flightTarget.set(targetX, targetY, targetZ);

    // Smooth move towards target
    this.group.position.lerp(this.flightTarget, delta * 3.5);

    // Look towards velocity direction
    this.currentVelocity.subVectors(this.flightTarget, this.group.position);
    if (this.currentVelocity.lengthSq() > 0.001) {
      const lookTarget = this.group.position.clone().add(this.currentVelocity);
      this.group.lookAt(lookTarget);
    }
  }

  public kill() {
    this.isDead = true;
    this.deathTime = performance.now();
  }
}
