/**
 * FieldMosquito.ts
 * Dedicated 3D Mosquito entity tailored specifically for MODO CAMPO:
 * - Flies in from far away in the open 3D meadow (18m - 35m) towards the player.
 * - Swoops, circles, and hovers organically around the player in 3D field space.
 * - Realistic wing flapping, upright orientation, and motion trail.
 * - Generous slicing hit box compatible with BladeSwipeDetector.
 * - Level 3 Boss flies in from the horizon as a giant menacing mosquito.
 */

import * as THREE from 'three';
import { mosquitoModelLoader } from './MosquitoModelLoader';

export interface FieldMosquitoOptions {
  id: string;
  spawnPosition: THREE.Vector3;
  playerInitialPos: THREE.Vector3;
  isBoss?: boolean;
  scale?: number;
  speed?: number;
  level?: 1 | 2 | 3;
}

interface TrailPoint {
  position: THREE.Vector3;
  timestamp: number;
}

export class FieldMosquito {
  public id: string;
  public group: THREE.Group;
  public isBoss: boolean;
  public isDead: boolean = false;
  public deathTime: number = 0;
  public level: 1 | 2 | 3;

  // 3D GLTF Model instance
  public gltfModel: THREE.Group | null = null;
  private gltfLeftWing: THREE.Mesh | null = null;
  private gltfRightWing: THREE.Mesh | null = null;
  public hitSphere: THREE.Mesh;

  // Motion Trail
  public trailLine: THREE.Line;
  private trailPoints: TrailPoint[] = [];
  private trailPositionsArray: Float32Array;

  // Flight dynamics
  public baseSpeed: number;
  public currentSpeed: number;
  private flapSpeed: number;
  private timeOffset: number;
  public flightVelocity: THREE.Vector3 = new THREE.Vector3();

  // Approach from afar logic
  public isApproaching: boolean = true;
  private approachTarget: THREE.Vector3;
  private orbitRadius: number;
  private orbitAngle: number;
  private orbitHeightOffset: number;
  private orbitSpeed: number;

  // Orientation
  private currentYaw: number = 0;
  private currentPitch: number = 0;
  private currentRoll: number = 0;

  // Erratic flutter
  private flutterPhase: number;
  private dartTimer: number = 0;
  private isDarting: boolean = false;
  private dartOffset: THREE.Vector3 = new THREE.Vector3();

  // Materials & Scale
  public materials: THREE.Material[] = [];
  public baseScale: number;

  constructor(options: FieldMosquitoOptions) {
    this.id = options.id;
    this.isBoss = !!options.isBoss;
    this.level = options.level || 1;

    // Movement speeds and tighter orbits for Field Mode
    if (this.isBoss) {
      this.baseSpeed = 4.8;
      this.flapSpeed = 38;
      this.baseScale = 1.35;
      this.orbitRadius = 2.2;
    } else if (this.level === 2) {
      this.baseSpeed = 7.5; // Fast in Level 2
      this.flapSpeed = 68;
      this.baseScale = 0.32;
      this.orbitRadius = 1.4 + Math.random() * 1.3;
    } else {
      this.baseSpeed = 5.4; // Lively in Level 1
      this.flapSpeed = 54;
      this.baseScale = 0.36;
      this.orbitRadius = 1.6 + Math.random() * 1.4;
    }

    if (options.scale) {
      this.baseScale = options.scale;
    }

    this.currentSpeed = this.baseSpeed;
    this.timeOffset = Math.random() * 100;
    this.flutterPhase = Math.random() * Math.PI * 2;
    this.orbitAngle = Math.random() * Math.PI * 2;
    this.orbitHeightOffset = (Math.random() - 0.5) * 0.9;
    this.orbitSpeed = (Math.random() > 0.5 ? 1 : -1) * (1.1 + Math.random() * 0.8);

    this.group = new THREE.Group();
    this.group.name = `FieldMosquito_${this.id}`;
    this.group.position.copy(options.spawnPosition);

    this.approachTarget = options.playerInitialPos.clone();

    // Hit sphere for raycasting / slicing
    const hitRadius = this.isBoss ? 1.6 : 0.65;
    const hitGeom = new THREE.SphereGeometry(hitRadius, 8, 8);
    const hitMat = new THREE.MeshBasicMaterial({
      visible: false,
      transparent: true,
      opacity: 0,
      depthWrite: false,
    });
    this.hitSphere = new THREE.Mesh(hitGeom, hitMat);
    this.hitSphere.name = `FieldHit_${this.id}`;
    this.hitSphere.userData = { mosquitoId: this.id, isBoss: this.isBoss };
    this.group.add(this.hitSphere);

    // Motion trail setup
    const maxTrailPoints = 12;
    this.trailPositionsArray = new Float32Array(maxTrailPoints * 3);
    const trailGeom = new THREE.BufferGeometry();
    trailGeom.setAttribute('position', new THREE.BufferAttribute(this.trailPositionsArray, 3));
    const trailMat = new THREE.LineBasicMaterial({
      color: this.isBoss ? 0xef4444 : 0x10b981,
      transparent: true,
      opacity: 0.45,
      blending: THREE.AdditiveBlending,
    });
    this.trailLine = new THREE.Line(trailGeom, trailMat);
    this.trailLine.frustumCulled = false;

    // Attach 3D Model
    this.initModel();
  }

  private initModel() {
    const instance = mosquitoModelLoader.createInstance(this.isBoss);
    if (instance) {
      this.attachLoadedModel(instance);
    } else {
      // Fallback if not yet ready
      const unsub = mosquitoModelLoader.onReady(() => {
        const inst = mosquitoModelLoader.createInstance(this.isBoss);
        if (inst && !this.isDead) {
          this.attachLoadedModel(inst);
        }
      });
      setTimeout(unsub, 10000);
    }
  }

  private attachLoadedModel(model: THREE.Group) {
    this.gltfModel = model;
    this.gltfModel.scale.setScalar(this.baseScale);
    this.group.add(this.gltfModel);

    // Find wings and collect materials
    this.materials = [];
    this.gltfModel.traverse((child) => {
      if ((child as THREE.Mesh).isMesh) {
        const mesh = child as THREE.Mesh;
        if (mesh.material) {
          if (Array.isArray(mesh.material)) {
            mesh.material.forEach((m) => this.materials.push(m));
          } else {
            this.materials.push(mesh.material);
          }
        }
        const name = (mesh.name || '').toLowerCase();
        if (name.includes('wing')) {
          if (name.includes('left') || (!this.gltfLeftWing && !name.includes('right'))) {
            this.gltfLeftWing = mesh;
          } else if (name.includes('right') || !this.gltfRightWing) {
            this.gltfRightWing = mesh;
          }
        }
      }
    });
  }

  public update(delta: number, playerPos: THREE.Vector3, groundHeightAt: (x: number, z: number) => number) {
    if (this.isDead) return;

    const time = performance.now() * 0.001 + this.timeOffset;

    // Wing flapping animation
    if (this.gltfLeftWing && this.gltfRightWing) {
      const flap = Math.sin(time * this.flapSpeed) * 0.55;
      this.gltfLeftWing.rotation.z = flap;
      this.gltfRightWing.rotation.z = -flap;
    }

    const prevPos = this.group.position.clone();

    // Flight target computation
    const toPlayer = playerPos.clone().sub(this.group.position);
    const distToPlayer = toPlayer.length();

    let targetPoint: THREE.Vector3;

    if (this.isApproaching) {
      // Phase 1: Flying in smoothly from afar towards the player
      targetPoint = playerPos.clone().add(new THREE.Vector3(
        Math.cos(this.orbitAngle) * this.orbitRadius,
        1.2 + this.orbitHeightOffset,
        Math.sin(this.orbitAngle) * this.orbitRadius
      ));

      if (distToPlayer <= this.orbitRadius + 1.2) {
        this.isApproaching = false;
      }
    } else {
      // Phase 2: Orbiting, swooping, and hovering around the player's current position
      this.orbitAngle += this.orbitSpeed * delta;
      const targetX = playerPos.x + Math.cos(this.orbitAngle) * this.orbitRadius;
      const targetZ = playerPos.z + Math.sin(this.orbitAngle) * this.orbitRadius;
      const targetY = playerPos.y + 0.3 + Math.sin(time * 2.2) * 0.8 + this.orbitHeightOffset;

      targetPoint = new THREE.Vector3(targetX, targetY, targetZ);

      // If player moved away (> 5.5m), fly back towards player immediately
      if (distToPlayer > 5.5) {
        this.isApproaching = true;
      }
    }

    // Erratic darting (insect revoloteo)
    this.dartTimer += delta;
    if (this.dartTimer > (this.level === 2 ? 0.6 : 1.2)) {
      this.dartTimer = 0;
      this.isDarting = Math.random() > 0.4;
      if (this.isDarting) {
        const dartMag = this.level === 2 ? 1.4 : 0.8;
        this.dartOffset.set(
          (Math.random() - 0.5) * dartMag,
          (Math.random() - 0.5) * dartMag * 0.5,
          (Math.random() - 0.5) * dartMag
        );
      } else {
        this.dartOffset.set(0, 0, 0);
      }
    }

    targetPoint.add(this.dartOffset);

    // Steer towards target point
    const desiredDir = targetPoint.clone().sub(this.group.position);
    const desiredDist = desiredDir.length();
    if (desiredDist > 0.05) {
      desiredDir.normalize();
      const speed = this.isApproaching
        ? this.baseSpeed * (this.isBoss ? 1.1 : 1.3)
        : this.baseSpeed * (0.8 + Math.sin(time * 3) * 0.2);

      this.flightVelocity.lerp(desiredDir.multiplyScalar(speed), delta * 4.5);
    }

    // Micro buzz flutter
    const flutterX = Math.sin(time * 28 + this.flutterPhase) * 0.04;
    const flutterY = Math.cos(time * 31 + this.flutterPhase) * 0.05;
    const flutterZ = Math.sin(time * 25) * 0.04;

    this.group.position.addScaledVector(this.flightVelocity, delta);
    this.group.position.x += flutterX;
    this.group.position.y += flutterY;
    this.group.position.z += flutterZ;

    // Terrain ground avoidance: never clip into grass/terrain
    const terrainY = groundHeightAt(this.group.position.x, this.group.position.z);
    const minHeightAboveGround = this.isBoss ? 2.5 : 0.75;
    if (this.group.position.y < terrainY + minHeightAboveGround) {
      this.group.position.y = THREE.MathUtils.lerp(
        this.group.position.y,
        terrainY + minHeightAboveGround,
        delta * 6.0
      );
      this.flightVelocity.y = Math.max(0.5, this.flightVelocity.y);
    }

    // Upright heading orientation (look towards movement direction)
    const moveStep = this.group.position.clone().sub(prevPos);
    if (moveStep.lengthSq() > 0.0001) {
      const heading = Math.atan2(moveStep.x, moveStep.z);
      this.currentYaw = THREE.MathUtils.lerp(this.currentYaw, heading, delta * 7.0);

      const horizontalSpeed = Math.hypot(moveStep.x, moveStep.z);
      const pitchTarget = Math.atan2(moveStep.y, Math.max(0.05, horizontalSpeed));
      this.currentPitch = THREE.MathUtils.lerp(
        this.currentPitch,
        THREE.MathUtils.clamp(pitchTarget, -0.4, 0.4),
        delta * 6.0
      );

      const rollTarget = -moveStep.x * 0.35;
      this.currentRoll = THREE.MathUtils.lerp(
        this.currentRoll,
        THREE.MathUtils.clamp(rollTarget, -0.35, 0.35),
        delta * 5.0
      );

      this.group.rotation.set(0, 0, 0);
      this.group.rotateY(this.currentYaw);
      this.group.rotateX(-this.currentPitch);
      this.group.rotateZ(this.currentRoll);
    }

    // Update Motion Trail
    this.updateTrail();
  }

  private updateTrail() {
    const now = performance.now();
    this.trailPoints.unshift({
      position: this.group.position.clone(),
      timestamp: now,
    });

    while (this.trailPoints.length > 10) {
      this.trailPoints.pop();
    }

    const posAttr = this.trailLine.geometry.getAttribute('position') as THREE.BufferAttribute;
    const arr = posAttr.array as Float32Array;

    for (let i = 0; i < 10; i++) {
      if (i < this.trailPoints.length) {
        const pt = this.trailPoints[i].position;
        arr[i * 3 + 0] = pt.x;
        arr[i * 3 + 1] = pt.y;
        arr[i * 3 + 2] = pt.z;
      } else if (this.trailPoints.length > 0) {
        const last = this.trailPoints[this.trailPoints.length - 1].position;
        arr[i * 3 + 0] = last.x;
        arr[i * 3 + 1] = last.y;
        arr[i * 3 + 2] = last.z;
      }
    }
    posAttr.needsUpdate = true;
  }

  public dispose(scene: THREE.Scene) {
    this.isDead = true;
    scene.remove(this.group);
    scene.remove(this.trailLine);
    this.trailLine.geometry.dispose();
    if (this.hitSphere.geometry) this.hitSphere.geometry.dispose();
  }
}
