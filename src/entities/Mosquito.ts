/**
 * Mosquito.ts
 * Procedural 3D Mosquito entity with animated flapping wings, dynamic 3D room-cruising flight,
 * bank roll in turns, and realistic audio reactive states.
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
  assignedAngle?: number;
  assignedRadius?: number;
  preferredAltitudeOffset?: number;
  isAmbush?: boolean;
  ambushTargetPos?: THREE.Vector3;
}

export class Mosquito {
  public id: string;
  public group: THREE.Group;
  public isBoss: boolean;
  public isDead: boolean = false;
  public deathTime: number = 0;
  public level: 1 | 2 | 3;

  // Ambush surprise attack swoop dynamics
  public isAmbushAttack: boolean = false;
  private ambushProgress: number = 0;
  private ambushDuration: number = 2.0;
  private ambushTargetPos: THREE.Vector3 = new THREE.Vector3();
  private finalBaseScale: number = 1.0;

  // Individual spatial territory (prevents grouping / clumping)
  public assignedAngle: number;
  public assignedRadius: number;
  public preferredAltitudeOffset: number;

  // Wings for flapping animation
  private leftWing: THREE.Mesh;
  private rightWing: THREE.Mesh;
  private eyesMesh: THREE.Mesh;
  private bodyMesh: THREE.Mesh;

  // Cruising flight dynamics
  private speed: number;
  private flapSpeed: number = 48;
  private timeOffset: number;

  // Waypoint cruising (prevents levitating in place, keeps motion dynamic across the room)
  private currentWaypoint: THREE.Vector3 = new THREE.Vector3();
  private flightVelocity: THREE.Vector3 = new THREE.Vector3();
  private waypointTimer: number = 0;
  private maxWaypointInterval: number = 6.0;

  // Collision hit box mesh for easy raycasting
  public hitSphere: THREE.Mesh;

  constructor(options: MosquitoOptions) {
    this.id = options.id;
    this.isBoss = !!options.isBoss;
    this.level = options.level || 1;
    this.speed = options.speed || (this.isBoss ? 0.6 : this.level === 1 ? 0.52 : 0.92);
    const baseScale = options.scale || (this.isBoss ? 4.2 : this.level === 1 ? 1.0 : 0.72);
    this.flapSpeed = this.isBoss ? 30 : this.level === 1 ? 44 : 64;
    this.timeOffset = Math.random() * 100;

    this.group = new THREE.Group();

    if (options.initialPosition) {
      this.group.position.copy(options.initialPosition);
      this.assignedAngle = options.assignedAngle !== undefined
        ? options.assignedAngle
        : Math.atan2(options.initialPosition.z, options.initialPosition.x);
      this.assignedRadius = options.assignedRadius !== undefined
        ? options.assignedRadius
        : Math.hypot(options.initialPosition.x, options.initialPosition.z);
    } else {
      this.assignedAngle = options.assignedAngle !== undefined ? options.assignedAngle : Math.random() * Math.PI * 2;
      this.assignedRadius = options.assignedRadius !== undefined
        ? options.assignedRadius
        : this.isBoss
        ? 2.6
        : 1.3 + Math.random() * 2.2;

      const flightPitch = options.spawnPitch !== undefined ? options.spawnPitch : (Math.random() - 0.4) * 0.7;
      const spawnX = Math.cos(this.assignedAngle) * Math.cos(flightPitch) * this.assignedRadius;
      const spawnY = Math.max(0.9, Math.min(2.4, 1.5 + Math.sin(flightPitch) * this.assignedRadius));
      const spawnZ = Math.sin(this.assignedAngle) * Math.cos(flightPitch) * this.assignedRadius;

      this.group.position.set(spawnX, spawnY, spawnZ);
    }

    this.preferredAltitudeOffset = options.preferredAltitudeOffset !== undefined
      ? options.preferredAltitudeOffset
      : (Math.random() - 0.5) * 0.6;

    // Initialize first flight destination in real space
    this.pickNextWaypoint();

    // Initial velocity pointed towards first waypoint
    const initialDir = this.currentWaypoint.clone().sub(this.group.position).normalize();
    this.flightVelocity.copy(initialDir).multiplyScalar(this.speed * 1.6);

    // --- Build Mosquito Geometry ---
    const bodyColor = this.isBoss ? 0x220510 : 0x1a1a1a;
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
    const needleMat = new THREE.MeshStandardMaterial({ color: 0x111111 });
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
    const legMat = new THREE.MeshBasicMaterial({ color: 0x111111 });
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

    // 8. Hit detection sphere - Generous radius so varying distances are easily selectable
    const hitRadius = this.isBoss ? 2.6 : 1.35;
    const hitGeo = new THREE.SphereGeometry(hitRadius, 6, 6);
    const hitMat = new THREE.MeshBasicMaterial({ visible: false, wireframe: true });
    this.hitSphere = new THREE.Mesh(hitGeo, hitMat);
    this.hitSphere.userData = { mosquitoId: this.id, isBoss: this.isBoss };
    this.group.add(this.hitSphere);

    this.finalBaseScale = baseScale;
    this.isAmbushAttack = !!options.isAmbush;

    if (this.isAmbushAttack) {
      // Start near invisible so spawn is never seen, then expands during blind-spot dive
      this.group.scale.setScalar(0.02);
      if (options.ambushTargetPos) {
        this.ambushTargetPos.copy(options.ambushTargetPos);
      } else {
        this.ambushTargetPos.copy(this.currentWaypoint);
      }
    } else {
      this.group.scale.setScalar(baseScale);
    }

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
   * Choose a random 3D flight destination across the room space.
   * Avoids picking points directly in the camera's face.
   */
  private pickNextWaypoint(centerPos?: THREE.Vector3) {
    const cx = centerPos ? centerPos.x : 0;
    const cy = centerPos ? centerPos.y : 1.6;
    const cz = centerPos ? centerPos.z : 0;

    if (this.isBoss) {
      // Boss hovers in front of player at comfortable distance (2.2m - 2.8m)
      const angle = (Math.random() - 0.5) * 0.8;
      const dist = 2.2 + Math.random() * 0.7;
      this.currentWaypoint.set(
        cx + Math.sin(angle) * dist,
        Math.max(1.3, Math.min(2.2, cy + (Math.random() - 0.5) * 0.5)),
        cz - Math.cos(angle) * dist
      );
    } else {
      // Pick random 3D destinations throughout the room (cross-room flights, lateral cruises, altitude drifts)
      let targetX = 0;
      let targetY = 1.6;
      let targetZ = 0;
      let found = false;

      for (let attempt = 0; attempt < 8; attempt++) {
        const angle = Math.random() * Math.PI * 2;
        const dist = 1.5 + Math.random() * 2.3; // 1.5m to 3.8m
        const candX = cx + Math.cos(angle) * dist;
        const candZ = cz + Math.sin(angle) * dist;
        const candY = Math.max(0.7, Math.min(2.9, cy + (Math.random() - 0.5) * 1.6));

        // Ensure waypoint is not right in the camera plane (> 1.35m away)
        const distToCenter = Math.hypot(candX - cx, candZ - cz);
        if (distToCenter >= 1.35) {
          targetX = candX;
          targetY = candY;
          targetZ = candZ;
          found = true;
          break;
        }
      }

      if (!found) {
        // Fallback lateral trajectory
        const lateralDist = 1.8 + Math.random() * 1.4;
        const lateralAngle = Math.random() * Math.PI * 2;
        targetX = cx + Math.cos(lateralAngle) * lateralDist;
        targetY = cy + (Math.random() - 0.5) * 0.8;
        targetZ = cz + Math.sin(lateralAngle) * lateralDist;
      }

      this.currentWaypoint.set(targetX, targetY, targetZ);
    }

    this.waypointTimer = 0;
    this.maxWaypointInterval = 4.5 + Math.random() * 3.5;
  }

  /**
   * Flight and wing animation update with camera avoidance and anti-clustering repulsion
   */
  public update(
    delta: number,
    elapsedTime: number,
    playerPos: THREE.Vector3,
    reactiveAudioLevel: number = 0,
    otherPositions?: THREE.Vector3[]
  ) {
    if (this.isDead) {
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

    // Boss scream damage shake
    if (this.isBoss && reactiveAudioLevel > 0.05) {
      const shakeAmt = reactiveAudioLevel * 0.25;
      this.group.position.x += (Math.random() - 0.5) * shakeAmt;
      this.group.position.y += (Math.random() - 0.5) * shakeAmt;
      this.group.position.z += (Math.random() - 0.5) * shakeAmt;
    }

    // --- Ambush Surprise Attack Swoop ---
    if (this.isAmbushAttack) {
      this.ambushProgress += delta / this.ambushDuration;
      // Smooth scale-in from near 0 to full size over first 35% of swoop
      const scaleT = Math.min(1.0, this.ambushProgress / 0.35);
      this.group.scale.setScalar(this.finalBaseScale * scaleT);

      // Frantic high-speed attack wing flapping
      const attackFlap = Math.sin((elapsedTime + this.timeOffset) * (this.flapSpeed * 1.5)) * 0.95;
      this.leftWing.rotation.z = attackFlap;
      this.rightWing.rotation.z = -attackFlap;

      // Fast dive towards ambush target on curved arc
      const attackDir = this.ambushTargetPos.clone().sub(this.group.position).normalize();
      attackDir.y += Math.sin(this.ambushProgress * Math.PI) * 0.2;
      attackDir.normalize();

      const attackSpeed = this.speed * (this.level === 1 ? 2.8 : 3.4);
      this.flightVelocity.lerp(attackDir.multiplyScalar(attackSpeed), delta * 4.5);
      this.group.position.addScaledVector(this.flightVelocity, delta);

      // Face swoop direction and bank body into dive
      if (this.flightVelocity.lengthSq() > 0.001) {
        this.group.lookAt(this.group.position.clone().add(this.flightVelocity));
        this.group.rotation.z = -this.flightVelocity.x * 0.25;
      }

      // Check if ambush completed
      const distToTarget = this.group.position.distanceTo(this.ambushTargetPos);
      if (this.ambushProgress >= 1.0 || distToTarget < 0.65) {
        this.isAmbushAttack = false;
        this.group.scale.setScalar(this.finalBaseScale);
        this.pickNextWaypoint(playerPos);
      }
      return;
    }

    // --- Dynamic Cruising Flight Across Space ---
    this.waypointTimer += delta;
    const distToWaypoint = this.group.position.distanceTo(this.currentWaypoint);

    // Pick new waypoint when reached or after flight timer expires
    if (distToWaypoint < 0.8 || this.waypointTimer >= this.maxWaypointInterval) {
      this.pickNextWaypoint(playerPos);
    }

    // Desired direction towards waypoint
    const desiredDir = this.currentWaypoint.clone().sub(this.group.position).normalize();

    // Sinusoidal gentle hovering wave oscillation
    const t = (elapsedTime + this.timeOffset) * (this.level === 1 ? 1.2 : 1.8);
    const wavyOffsetX = Math.sin(t * 1.4) * (this.level === 1 ? 0.25 : 0.35);
    const wavyOffsetY = Math.cos(t * 1.1) * (this.level === 1 ? 0.2 : 0.3);
    const wavyOffsetZ = Math.sin(t * 1.7) * (this.level === 1 ? 0.25 : 0.35);

    desiredDir.x += wavyOffsetX;
    desiredDir.y += wavyOffsetY;
    desiredDir.z += wavyOffsetZ;

    // CAMERA COMFORT BUBBLE: deflect so mosquitoes don't fly head-on or continuously right in front of lens
    if (!this.isBoss) {
      const distToPlayer = this.group.position.distanceTo(playerPos);
      if (distToPlayer < 1.35) {
        // Push gently away and deflect laterally
        const pushAway = this.group.position.clone().sub(playerPos).normalize();
        const lateral = new THREE.Vector3(-pushAway.z, 0, pushAway.x).normalize();
        const factor = (1.35 - distToPlayer) * 2.2;
        desiredDir.addScaledVector(pushAway, factor);
        desiredDir.addScaledVector(lateral, factor * 0.8);
      }
    }

    // Anti-clustering repulsion from other mosquitoes: NEVER clump into groups!
    if (otherPositions && otherPositions.length > 0) {
      for (let j = 0; j < otherPositions.length; j++) {
        const otherPos = otherPositions[j];
        const sepDist = this.group.position.distanceTo(otherPos);
        if (sepDist > 0.02 && sepDist < 1.4) {
          const push = this.group.position.clone().sub(otherPos).normalize();
          const force = (1.4 - sepDist) * 1.5;
          desiredDir.addScaledVector(push, force);
        }
      }
    }
    desiredDir.normalize();

    // Target velocity: gentle, natural cruising
    const cruiseMultiplier = this.level === 1 ? 1.5 : 1.9;
    const targetVelocity = desiredDir.multiplyScalar(this.speed * cruiseMultiplier);

    // Smooth steering turn
    const steeringLerp = this.level === 1 ? 1.3 : 2.2;
    this.flightVelocity.lerp(targetVelocity, delta * steeringLerp);

    // Advance position through real space
    this.group.position.addScaledVector(this.flightVelocity, delta);

    // Keep mosquitoes within reasonable room bounds (4.2m horizontal radius)
    const horizontalDist = Math.hypot(this.group.position.x - playerPos.x, this.group.position.z - playerPos.z);
    if (horizontalDist > 4.2) {
      const returnDir = new THREE.Vector3(playerPos.x, this.group.position.y, playerPos.z)
        .sub(this.group.position)
        .normalize();
      this.flightVelocity.lerp(returnDir.multiplyScalar(this.speed * 1.6), delta * 2.5);
    }

    // Floor and ceiling bounds relative to standing height
    this.group.position.y = Math.max(0.6, Math.min(3.2, this.group.position.y));

    // Look towards velocity vector & bank body into turns
    if (this.flightVelocity.lengthSq() > 0.001) {
      const lookTarget = this.group.position.clone().add(this.flightVelocity);
      this.group.lookAt(lookTarget);

      // Bank roll in curves
      const horizontalTurn = this.flightVelocity.x;
      this.group.rotation.z = -horizontalTurn * 0.16;
    }
  }

  public kill() {
    this.isDead = true;
    this.deathTime = performance.now();
  }
}
