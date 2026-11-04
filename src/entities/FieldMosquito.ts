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

// Reusable scratch vectors to completely prevent GC thrashing and frame drops during flight loop
const _prevPos = new THREE.Vector3();
const _toPlayer = new THREE.Vector3();
const _targetPoint = new THREE.Vector3();
const _desiredDir = new THREE.Vector3();
const _moveStep = new THREE.Vector3();
const _scratchEuler = new THREE.Euler(0, 0, 0, 'YXZ');

export class FieldMosquito {
  public id: string;
  public group: THREE.Group;
  public isBoss: boolean;
  public isDead: boolean = false;
  public deathTime: number = 0;
  public level: 1 | 2 | 3;

  // Physics & sub-frame interpolation vectors (zero GC allocation)
  public physicsPosition: THREE.Vector3 = new THREE.Vector3();
  public prevPosition: THREE.Vector3 = new THREE.Vector3();
  public visualPosition: THREE.Vector3 = new THREE.Vector3();
  public physicsQuat: THREE.Quaternion = new THREE.Quaternion();
  public prevQuat: THREE.Quaternion = new THREE.Quaternion();
  public visualQuat: THREE.Quaternion = new THREE.Quaternion();

  // Normalized animation phase accumulator (0.0 to 1.0) for stutter-free wing flapping
  private wingPhase: number = 0;
  private flightBlend: number = 0; // Cross-fading blend factor between approach and orbit

  // 3D GLTF Model instance
  public gltfModel: THREE.Group | null = null;
  private gltfLeftWing: THREE.Mesh | null = null;
  private gltfRightWing: THREE.Mesh | null = null;
  public hitSphere: THREE.Mesh;

  // Motion Trail
  public trailLine: THREE.Line;
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
  public bossAnchorPos: THREE.Vector3;

  constructor(options: FieldMosquitoOptions) {
    this.id = options.id;
    this.isBoss = !!options.isBoss;
    this.level = options.level || 1;
    this.bossAnchorPos = options.spawnPosition.clone();

    // Movement speeds and tighter orbits for Field Mode
    if (this.isBoss) {
      this.baseSpeed = 3.2;
      this.flapSpeed = 38;
      this.baseScale = 1.35;
      this.orbitRadius = 0;
      this.orbitSpeed = 0;
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

    this.physicsPosition.copy(options.spawnPosition);
    this.prevPosition.copy(options.spawnPosition);
    this.visualPosition.copy(options.spawnPosition);
    this.physicsQuat.copy(this.group.quaternion);
    this.prevQuat.copy(this.group.quaternion);
    this.visualQuat.copy(this.group.quaternion);

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

  /**
   * Fixed Timestep Physics Update (60 UPS decoupled from screen refresh rate)
   */
  public fixedUpdate(fixedDt: number, playerPos: THREE.Vector3, groundHeightAt: (x: number, z: number) => number) {
    if (this.isDead) return;

    // Snapshot previous physics tick state for sub-frame alpha interpolation
    this.prevPosition.copy(this.physicsPosition);
    this.prevQuat.copy(this.physicsQuat);

    // Normalized wing phase accumulator (0.0 to 1.0)
    this.wingPhase = (this.wingPhase + fixedDt * (this.flapSpeed * 0.16)) % 1.0;

    const time = performance.now() * 0.001 + this.timeOffset;

    _prevPos.copy(this.physicsPosition);

    // Flight target computation using scratch vectors
    _toPlayer.copy(playerPos).sub(this.physicsPosition);
    const distToPlayer = _toPlayer.length();

    // ----------------------------------------------------
    // LEVEL 3 FINAL BOSS: FLOTANDO EN UN MISMO LUGAR
    // (NO DA VUELTAS ALREDEDOR DEL JUGADOR - COMO ANTES)
    // ----------------------------------------------------
    if (this.isBoss) {
      // Si el jugador se aleja mucho (> 6.5m), el ancla se ajusta suavemente para mantenerse a distancia cómoda
      if (distToPlayer > 6.5 && distToPlayer > 0.01) {
        const toNormX = _toPlayer.x / distToPlayer;
        const toNormZ = _toPlayer.z / distToPlayer;
        const targetAnchorX = playerPos.x - toNormX * 4.8;
        const targetAnchorZ = playerPos.z - toNormZ * 4.8;
        this.bossAnchorPos.x = THREE.MathUtils.lerp(this.bossAnchorPos.x, targetAnchorX, fixedDt * 1.5);
        this.bossAnchorPos.z = THREE.MathUtils.lerp(this.bossAnchorPos.z, targetAnchorZ, fixedDt * 1.5);
        this.bossAnchorPos.y = THREE.MathUtils.lerp(this.bossAnchorPos.y, playerPos.y + 0.3, fixedDt * 1.5);
      }

      // Flotación suave y respiración vertical en un mismo lugar (sin dar vueltas ni órbitas circulares)
      const hoverY = this.bossAnchorPos.y + Math.sin(time * 1.5) * 0.18;
      const hoverX = this.bossAnchorPos.x + Math.sin(time * 0.7) * 0.12;
      const hoverZ = this.bossAnchorPos.z + Math.cos(time * 0.6) * 0.12;

      _targetPoint.set(hoverX, hoverY, hoverZ);
      this.dartOffset.set(0, 0, 0);

      _desiredDir.copy(_targetPoint).sub(this.physicsPosition);
      const distToAnchor = _desiredDir.length();
      if (distToAnchor > 0.02) {
        _desiredDir.normalize();
        this.flightVelocity.lerp(_desiredDir.multiplyScalar(Math.min(3.5, distToAnchor * 3.0)), fixedDt * 5.0);
      } else {
        this.flightVelocity.multiplyScalar(0.85);
      }

      // Micro revoloteo sutil de insecto suspendido en el aire
      const flutterX = Math.sin(time * 28 + this.flutterPhase) * 0.02;
      const flutterY = Math.cos(time * 31 + this.flutterPhase) * 0.03;
      const flutterZ = Math.sin(time * 25) * 0.02;

      this.physicsPosition.addScaledVector(this.flightVelocity, fixedDt);
      this.physicsPosition.x += flutterX;
      this.physicsPosition.y += flutterY;
      this.physicsPosition.z += flutterZ;

      // Terreno: nunca atravesar el suelo
      const terrainY = groundHeightAt(this.physicsPosition.x, this.physicsPosition.z);
      if (this.physicsPosition.y < terrainY + 2.0) {
        this.physicsPosition.y = THREE.MathUtils.lerp(this.physicsPosition.y, terrainY + 2.0, fixedDt * 6.0);
      }

      // Mira fijamente de frente hacia el jugador/cámara amenazantemente
      _toPlayer.copy(playerPos).sub(this.physicsPosition);
      if (_toPlayer.lengthSq() > 0.01) {
        const faceYaw = Math.atan2(_toPlayer.x, _toPlayer.z) + Math.PI;
        this.currentYaw = THREE.MathUtils.lerp(this.currentYaw, faceYaw, fixedDt * 6.0);

        const horizDist = Math.hypot(_toPlayer.x, _toPlayer.z);
        const pitchTarget = Math.atan2(_toPlayer.y, Math.max(0.1, horizDist));
        this.currentPitch = THREE.MathUtils.lerp(this.currentPitch, THREE.MathUtils.clamp(pitchTarget, -0.25, 0.25), fixedDt * 5.0);

        _scratchEuler.set(-this.currentPitch, this.currentYaw, 0, 'YXZ');
        this.physicsQuat.setFromEuler(_scratchEuler);
      }

      return;
    }

    if (this.isApproaching) {
      this.flightBlend = Math.max(0.0, this.flightBlend - fixedDt * 2.5);
      // Phase 1: Flying in smoothly from afar towards the player
      _targetPoint.set(
        playerPos.x + Math.cos(this.orbitAngle) * this.orbitRadius,
        playerPos.y + 1.2 + this.orbitHeightOffset,
        playerPos.z + Math.sin(this.orbitAngle) * this.orbitRadius
      );

      if (distToPlayer <= this.orbitRadius + 1.2) {
        this.isApproaching = false;
      }
    } else {
      this.flightBlend = Math.min(1.0, this.flightBlend + fixedDt * 2.5);
      // Phase 2: Orbiting, swooping, and hovering around the player's current position
      this.orbitAngle += this.orbitSpeed * fixedDt;
      const targetX = playerPos.x + Math.cos(this.orbitAngle) * this.orbitRadius;
      const targetZ = playerPos.z + Math.sin(this.orbitAngle) * this.orbitRadius;
      const targetY = playerPos.y + 0.3 + Math.sin(time * 2.2) * 0.8 + this.orbitHeightOffset;

      _targetPoint.set(targetX, targetY, targetZ);

      // If player moved away (> 5.5m), fly back towards player smoothly
      if (distToPlayer > 5.5) {
        this.isApproaching = true;
      }
    }

    // Erratic darting (insect revoloteo)
    this.dartTimer += fixedDt;
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

    _targetPoint.add(this.dartOffset);

    // Steer towards target point
    _desiredDir.copy(_targetPoint).sub(this.physicsPosition);
    const desiredDist = _desiredDir.length();
    if (desiredDist > 0.05) {
      _desiredDir.normalize();
      const speed = this.isApproaching
        ? this.baseSpeed * (this.isBoss ? 1.1 : 1.3)
        : this.baseSpeed * (0.8 + Math.sin(time * 3) * 0.2);

      this.flightVelocity.lerp(_desiredDir.multiplyScalar(speed), fixedDt * 4.5);
    }

    // Micro buzz flutter
    const flutterX = Math.sin(time * 28 + this.flutterPhase) * 0.04;
    const flutterY = Math.cos(time * 31 + this.flutterPhase) * 0.05;
    const flutterZ = Math.sin(time * 25) * 0.04;

    this.physicsPosition.addScaledVector(this.flightVelocity, fixedDt);
    this.physicsPosition.x += flutterX;
    this.physicsPosition.y += flutterY;
    this.physicsPosition.z += flutterZ;

    // Terrain ground avoidance: never clip into grass/terrain
    const terrainY = groundHeightAt(this.physicsPosition.x, this.physicsPosition.z);
    const minHeightAboveGround = this.isBoss ? 2.5 : 0.75;
    if (this.physicsPosition.y < terrainY + minHeightAboveGround) {
      this.physicsPosition.y = THREE.MathUtils.lerp(
        this.physicsPosition.y,
        terrainY + minHeightAboveGround,
        fixedDt * 6.0
      );
      this.flightVelocity.y = Math.max(0.5, this.flightVelocity.y);
    }

    // Upright heading orientation (look towards movement direction)
    _moveStep.copy(this.physicsPosition).sub(_prevPos);
    if (_moveStep.lengthSq() > 0.0001) {
      const heading = Math.atan2(_moveStep.x, _moveStep.z);
      this.currentYaw = THREE.MathUtils.lerp(this.currentYaw, heading, fixedDt * 7.0);

      const horizontalSpeed = Math.hypot(_moveStep.x, _moveStep.z);
      const pitchTarget = Math.atan2(_moveStep.y, Math.max(0.05, horizontalSpeed));
      this.currentPitch = THREE.MathUtils.lerp(
        this.currentPitch,
        THREE.MathUtils.clamp(pitchTarget, -0.4, 0.4),
        fixedDt * 6.0
      );

      const rollTarget = -_moveStep.x * 0.35;
      this.currentRoll = THREE.MathUtils.lerp(
        this.currentRoll,
        THREE.MathUtils.clamp(rollTarget, -0.35, 0.35),
        fixedDt * 5.0
      );

      _scratchEuler.set(-this.currentPitch, this.currentYaw, this.currentRoll, 'YXZ');
      this.physicsQuat.setFromEuler(_scratchEuler);
    }
  }

  /**
   * Sub-frame Linear & Spherical Interpolation for Display Refresh (60Hz / 90Hz / 120Hz)
   */
  public interpolateVisual(alpha: number) {
    if (this.isDead) return;

    // Mathematically exact sub-frame linear position interpolation
    this.visualPosition.lerpVectors(this.prevPosition, this.physicsPosition, alpha);
    this.group.position.copy(this.visualPosition);

    // Spherical interpolation for buttery smooth rotation on high refresh screens
    this.visualQuat.slerpQuaternions(this.prevQuat, this.physicsQuat, alpha);
    this.group.quaternion.copy(this.visualQuat);

    // Stutter-free normalized wing flapping
    if (this.gltfLeftWing && this.gltfRightWing) {
      const flap = Math.sin((this.wingPhase + alpha * (1 / 60) * (this.flapSpeed * 0.16)) * Math.PI * 2) * 0.55;
      this.gltfLeftWing.rotation.z = flap;
      this.gltfRightWing.rotation.z = -flap;
    }

    // Update motion trail with visual position
    this.updateTrail();
  }

  /**
   * Backward-compatible synchronous update
   */
  public update(delta: number, playerPos: THREE.Vector3, groundHeightAt: (x: number, z: number) => number) {
    this.fixedUpdate(delta, playerPos, groundHeightAt);
    this.interpolateVisual(1.0);
  }

  private updateTrail() {
    const arr = this.trailPositionsArray;
    // In-place typed array shift: ZERO object allocations
    for (let i = 11; i > 0; i--) {
      const src = (i - 1) * 3;
      const dst = i * 3;
      arr[dst] = arr[src];
      arr[dst + 1] = arr[src + 1];
      arr[dst + 2] = arr[src + 2];
    }
    arr[0] = this.group.position.x;
    arr[1] = this.group.position.y;
    arr[2] = this.group.position.z;

    const posAttr = this.trailLine.geometry.getAttribute('position') as THREE.BufferAttribute;
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
