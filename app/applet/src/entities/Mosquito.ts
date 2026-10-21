/**
 * Mosquito.ts
 * Procedural 3D Mosquito entity with animated flapping wings, calm hovering flight,
 * organic micro-sway, high visual contrast for AR video backgrounds, and spatial audio alignment.
 */

import * as THREE from 'three';

export interface MosquitoOptions {
  id: string;
  isBoss?: boolean;
  scale?: number;
  speed?: number;
  spawnDistance?: number;
  spawnAngle?: number;
  spawnPitch?: number;
  initialPosition?: THREE.Vector3;
  level?: 1 | 2 | 3;
}

export class Mosquito {
  public id: string;
  public group: THREE.Group;
  public isBoss: boolean;
  public isDead: boolean = false;
  public deathTime: number = 0;
  public level: 1 | 2 | 3;

  // Wings for flapping animation
  private leftWing: THREE.Mesh;
  private rightWing: THREE.Mesh;
  private eyesGlowMesh: THREE.Mesh;

  // Cruising & hovering flight dynamics (calm, predictable hovering)
  private speed: number;
  private flapSpeed: number = 42;
  private timeOffset: number;

  // Stable anchor and gentle local drift
  private anchorPosition: THREE.Vector3 = new THREE.Vector3();
  private localTargetOffset: THREE.Vector3 = new THREE.Vector3();
  private currentWaypoint: THREE.Vector3 = new THREE.Vector3();
  private flightVelocity: THREE.Vector3 = new THREE.Vector3();
  private waypointTimer: number = 0;
  private maxWaypointInterval: number = 8.0;

  // Collision hit box mesh for easy raycasting
  public hitSphere: THREE.Mesh;

  constructor(options: MosquitoOptions) {
    this.id = options.id;
    this.isBoss = !!options.isBoss;
    this.level = options.level || 1;

    // Significantly reduced movement speed:
    // Level 1: 0.14 m/s (calm hovering, very easy to spot and track)
    // Level 2: 0.22 m/s (moderately active but still calm and trackable)
    // Boss: 0.16 m/s (ominous slow hover)
    this.speed = options.speed || (this.isBoss ? 0.16 : this.level === 1 ? 0.14 : 0.22);

    // Boosted scale for immediate visual readability against real-world camera video feeds
    const baseScale = options.scale || (this.isBoss ? 3.8 : this.level === 1 ? 1.35 : 1.05);

    this.flapSpeed = this.isBoss ? 28 : this.level === 1 ? 40 : 52;
    this.timeOffset = Math.random() * 100;

    this.group = new THREE.Group();

    if (options.initialPosition) {
      this.group.position.copy(options.initialPosition);
    } else {
      // Spawn at comfortable 1.5m - 2.1m distance in front / sides of the player
      const spawnDist =
        options.spawnDistance ||
        (this.isBoss ? 2.5 : this.level === 1 ? 1.5 + Math.random() * 0.7 : 1.7 + Math.random() * 0.8);

      const flightAngle = options.spawnAngle !== undefined ? options.spawnAngle : Math.random() * Math.PI * 2;
      const flightPitch = options.spawnPitch !== undefined ? options.spawnPitch : (Math.random() - 0.3) * 0.5;

      const spawnX = Math.cos(flightAngle) * Math.cos(flightPitch) * spawnDist;
      const spawnY = Math.max(1.1, Math.min(2.2, 1.5 + Math.sin(flightPitch) * spawnDist));
      const spawnZ = Math.sin(flightAngle) * Math.cos(flightPitch) * spawnDist;

      this.group.position.set(spawnX, spawnY, spawnZ);
    }

    // Set anchor position to maintain local station-keeping
    this.anchorPosition.copy(this.group.position);
    this.pickNextHoverWaypoint();

    // Initial velocity pointed towards first waypoint
    const initialDir = this.currentWaypoint.clone().sub(this.group.position).normalize();
    this.flightVelocity.copy(initialDir).multiplyScalar(this.speed * 0.8);

    // --- Build Mosquito Geometry with High-Contrast Features ---
    // Dark chitin body with slight specular sheen
    const bodyColor = this.isBoss ? 0x2d0b14 : 0x1f2024;
    const bodyMat = new THREE.MeshStandardMaterial({
      color: bodyColor,
      roughness: 0.45,
      metalness: 0.35,
    });

    // High contrast white bands (Aedes aegypti tiger mosquito pattern)
    const stripeMat = new THREE.MeshBasicMaterial({
      color: 0xeeeeff,
    });

    // Vivid luminous compound eyes that glow in AR
    const eyeMat = new THREE.MeshBasicMaterial({
      color: this.isBoss ? 0xff0044 : 0xff2200,
    });

    // Translucent iridescent wings
    const wingMat = new THREE.MeshStandardMaterial({
      color: this.isBoss ? 0xddaacc : 0xffffff,
      transparent: true,
      opacity: 0.75,
      roughness: 0.15,
      metalness: 0.7,
      side: THREE.DoubleSide,
    });

    // 1. Abdomen (with tiger stripes for immediate visual recognition against camera)
    const abdomenGroup = new THREE.Group();
    const abdomenGeo = new THREE.ConeGeometry(0.18, 0.95, 8);
    abdomenGeo.rotateX(Math.PI / 2);
    const abdomen = new THREE.Mesh(abdomenGeo, bodyMat);
    abdomen.position.set(0, 0, 0.47);
    abdomenGroup.add(abdomen);

    // Add 3 high-contrast silver/white bands around abdomen
    for (let i = 0; i < 3; i++) {
      const ringRadius = 0.15 - i * 0.035;
      const ringGeo = new THREE.TorusGeometry(ringRadius, 0.02, 4, 12);
      const ring = new THREE.Mesh(ringGeo, stripeMat);
      ring.position.set(0, 0, 0.25 + i * 0.22);
      abdomenGroup.add(ring);
    }
    this.group.add(abdomenGroup);

    // 2. Thorax
    const thoraxGeo = new THREE.SphereGeometry(0.24, 8, 8);
    const thorax = new THREE.Mesh(thoraxGeo, bodyMat);
    this.group.add(thorax);

    // Thorax dorsal stripe
    const thoraxStripeGeo = new THREE.BoxGeometry(0.04, 0.04, 0.32);
    const thoraxStripe = new THREE.Mesh(thoraxStripeGeo, stripeMat);
    thoraxStripe.position.set(0, 0.2, 0);
    this.group.add(thoraxStripe);

    // 3. Head
    const headGeo = new THREE.SphereGeometry(0.16, 8, 8);
    const head = new THREE.Mesh(headGeo, bodyMat);
    head.position.set(0, 0.05, -0.32);
    this.group.add(head);

    // 4. Glowing Red/Amber Compound Eyes
    const eyeGeo = new THREE.SphereGeometry(0.075, 8, 8);
    const leftEye = new THREE.Mesh(eyeGeo, eyeMat);
    leftEye.position.set(-0.09, 0.11, -0.38);
    const rightEye = new THREE.Mesh(eyeGeo, eyeMat);
    rightEye.position.set(0.09, 0.11, -0.38);
    this.eyesGlowMesh = leftEye;
    this.group.add(leftEye, rightEye);

    // Subtle eye glow halo to catch attention
    const haloGeo = new THREE.RingGeometry(0.06, 0.14, 12);
    const haloMat = new THREE.MeshBasicMaterial({
      color: this.isBoss ? 0xff0044 : 0xff3300,
      transparent: true,
      opacity: 0.4,
      side: THREE.DoubleSide,
    });
    const leftHalo = new THREE.Mesh(haloGeo, haloMat);
    leftHalo.position.set(-0.09, 0.11, -0.4);
    const rightHalo = new THREE.Mesh(haloGeo, haloMat);
    rightHalo.position.set(0.09, 0.11, -0.4);
    this.group.add(leftHalo, rightHalo);

    // 5. Long Proboscis (feeding needle)
    const needleGeo = new THREE.CylinderGeometry(0.015, 0.025, 0.48, 5);
    needleGeo.rotateX(Math.PI / 3);
    const needleMat = new THREE.MeshStandardMaterial({ color: 0x111111 });
    const needle = new THREE.Mesh(needleGeo, needleMat);
    needle.position.set(0, -0.15, -0.52);
    this.group.add(needle);

    // 6. Large Animated Wings
    const wingGeo = new THREE.PlaneGeometry(0.32, 0.95);
    wingGeo.translate(0, 0.47, 0);
    wingGeo.rotateX(Math.PI / 2);

    this.leftWing = new THREE.Mesh(wingGeo, wingMat);
    this.leftWing.position.set(-0.12, 0.18, -0.05);
    this.leftWing.rotation.y = 0.45;

    this.rightWing = new THREE.Mesh(wingGeo, wingMat);
    this.rightWing.position.set(0.12, 0.18, -0.05);
    this.rightWing.rotation.y = -0.45;

    this.group.add(this.leftWing, this.rightWing);

    // 7. Slender Striped Legs
    const legMat = new THREE.MeshStandardMaterial({ color: 0x1a1a1a, roughness: 0.5 });
    for (let i = -1; i <= 1; i++) {
      const legGeo = new THREE.CylinderGeometry(0.012, 0.012, 0.65, 3);
      const lLeg = new THREE.Mesh(legGeo, legMat);
      lLeg.position.set(-0.26, -0.2, i * 0.18);
      lLeg.rotation.z = 0.8;
      lLeg.rotation.x = i * 0.3;
      const rLeg = new THREE.Mesh(legGeo, legMat);
      rLeg.position.set(0.26, -0.2, i * 0.18);
      rLeg.rotation.z = -0.8;
      rLeg.rotation.x = i * 0.3;
      this.group.add(lLeg, rLeg);
    }

    // 8. Hit detection sphere (generous so swatting is satisfying and accessible)
    const hitRadius = this.isBoss ? 2.2 : (this.level === 1 ? 1.05 : 0.9);
    const hitGeo = new THREE.SphereGeometry(hitRadius, 6, 6);
    const hitMat = new THREE.MeshBasicMaterial({ visible: false, wireframe: true });
    this.hitSphere = new THREE.Mesh(hitGeo, hitMat);
    this.hitSphere.userData = { mosquitoId: this.id, isBoss: this.isBoss };
    this.group.add(this.hitSphere);

    this.group.scale.setScalar(baseScale);

    if (this.isBoss) {
      const crownGeo = new THREE.TorusGeometry(0.42, 0.06, 8, 16);
      crownGeo.rotateX(Math.PI / 2);
      const crownMat = new THREE.MeshBasicMaterial({ color: 0xff0055 });
      const crown = new THREE.Mesh(crownGeo, crownMat);
      crown.position.set(0, 0.32, 0);
      this.group.add(crown);
    }
  }

  /**
   * Choose a gentle, nearby micro-waypoint around the anchor.
   * Instead of darting meters away, mosquitoes stay in their local hovering zone!
   */
  private pickNextHoverWaypoint(playerPos?: THREE.Vector3) {
    if (playerPos) {
      // Ensure anchor stays within comfortable viewing range of the player (1.4m - 2.2m)
      const distToPlayer = Math.hypot(
        this.anchorPosition.x - playerPos.x,
        this.anchorPosition.z - playerPos.z
      );

      if (distToPlayer > 3.0 || distToPlayer < 1.0) {
        // Gently pull anchor closer towards player's radius
        const angle = Math.atan2(
          this.anchorPosition.z - playerPos.z,
          this.anchorPosition.x - playerPos.x
        );
        const desiredRadius = this.isBoss ? 2.4 : 1.7;
        this.anchorPosition.x = playerPos.x + Math.cos(angle) * desiredRadius;
        this.anchorPosition.z = playerPos.z + Math.sin(angle) * desiredRadius;
        this.anchorPosition.y = Math.max(1.1, Math.min(2.1, playerPos.y + 0.1));
      }
    }

    // Small local drift within 0.25m - 0.45m of anchor
    const driftAngle = Math.random() * Math.PI * 2;
    const driftRadius = this.level === 1 ? 0.25 + Math.random() * 0.2 : 0.35 + Math.random() * 0.3;
    const driftY = (Math.random() - 0.5) * 0.25;

    this.localTargetOffset.set(
      Math.cos(driftAngle) * driftRadius,
      driftY,
      Math.sin(driftAngle) * driftRadius
    );

    this.currentWaypoint.copy(this.anchorPosition).add(this.localTargetOffset);
    this.waypointTimer = 0;
    // Long hovering hold: 7.0 - 11.0 seconds of calm hovering in place
    this.maxWaypointInterval = this.level === 1 ? 8.0 + Math.random() * 4.0 : 6.0 + Math.random() * 3.0;
  }

  /**
   * Flight and wing animation update
   * Highly stable, calm hovering with gentle organic micro-bobbing
   */
  public update(
    delta: number,
    elapsedTime: number,
    playerPos: THREE.Vector3,
    reactiveAudioLevel: number = 0
  ) {
    if (this.isDead) {
      this.group.position.y -= delta * 3.5;
      this.group.rotation.x += delta * 5;
      this.group.rotation.z += delta * 3;
      this.group.scale.multiplyScalar(0.95);
      return;
    }

    // Wing flapping
    const flap = Math.sin((elapsedTime + this.timeOffset) * this.flapSpeed) * 0.82;
    this.leftWing.rotation.z = flap;
    this.rightWing.rotation.z = -flap;

    // Boss scream damage shake
    if (this.isBoss && reactiveAudioLevel > 0.05) {
      const shakeAmt = reactiveAudioLevel * 0.22;
      this.group.position.x += (Math.random() - 0.5) * shakeAmt;
      this.group.position.y += (Math.random() - 0.5) * shakeAmt;
      this.group.position.z += (Math.random() - 0.5) * shakeAmt;
    }

    // --- Calm Hovering Flight Dynamics ---
    this.waypointTimer += delta;
    const distToWaypoint = this.group.position.distanceTo(this.currentWaypoint);

    // Pick new nearby waypoint when reached or after hover interval expires
    if (distToWaypoint < 0.25 || this.waypointTimer >= this.maxWaypointInterval) {
      this.pickNextHoverWaypoint(playerPos);
    }

    // Desired direction towards local waypoint
    const desiredDir = this.currentWaypoint.clone().sub(this.group.position);
    const distRemaining = desiredDir.length();
    if (distRemaining > 0.001) {
      desiredDir.normalize();
    }

    // Gentle micro-hover bobbing (very subtle, no wild darting or erratic jumping)
    const t = (elapsedTime + this.timeOffset) * 1.1;
    const hoverBobY = Math.sin(t * 1.8) * 0.04;
    const hoverSwayX = Math.cos(t * 1.3) * 0.03;
    const hoverSwayZ = Math.sin(t * 1.5) * 0.03;

    desiredDir.x += hoverSwayX;
    desiredDir.y += hoverBobY;
    desiredDir.z += hoverSwayZ;
    desiredDir.normalize();

    // Slow, controlled cruising speed
    const approachSpeed = Math.min(1.0, distRemaining / 0.5);
    const targetVelocity = desiredDir.multiplyScalar(this.speed * approachSpeed);

    // Damped, silky smooth steering lerp
    const steeringLerp = this.level === 1 ? 0.9 : 1.4;
    this.flightVelocity.lerp(targetVelocity, delta * steeringLerp);

    // Advance position gently
    this.group.position.addScaledVector(this.flightVelocity, delta);

    // Vertical stability: keep between comfortable eye-level bounds (1.0m to 2.4m)
    this.group.position.y = Math.max(0.9, Math.min(2.4, this.group.position.y));

    // Smooth orientation towards direction of travel or towards player
    if (this.flightVelocity.lengthSq() > 0.0005) {
      const lookTarget = this.group.position.clone().add(this.flightVelocity);
      this.group.lookAt(lookTarget);

      // Subtle bank roll in turns (soft and natural)
      const horizontalTurn = this.flightVelocity.x;
      this.group.rotation.z = -horizontalTurn * 0.15;
    }
  }

  public kill() {
    this.isDead = true;
    this.deathTime = performance.now();
  }
}
