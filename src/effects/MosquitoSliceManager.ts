/**
 * MosquitoSliceManager.ts
 * Expert game-mathematics implementation for Fruit Ninja-style mosquito slicing.
 * 
 * Manages:
 * 1. Geometric cut-plane calculations in 3D camera space.
 * 2. Instantiation of two physically independent halves (Half A & Half B) with local clipping.
 * 3. Ballistic separation impulse, upward pop, tumbling angular velocities, and gravity simulation.
 * 4. Blood/hemolymph particle bursts along the cut seam.
 * 5. Clean lifecycle disposal to prevent WebGL memory leaks.
 */

import * as THREE from 'three';
import { mosquitoModelLoader } from '../entities/MosquitoModelLoader';

interface SlicedHalf {
  group: THREE.Group;
  velocity: THREE.Vector3;
  angularVelocity: THREE.Vector3;
  age: number;
  maxLifetime: number;
  plane: THREE.Plane;
  materials: THREE.Material[];
}

export interface SliceParams {
  /** Screen cut start position (px) */
  p1: { x: number; y: number };
  /** Screen cut end position (px) */
  p2: { x: number; y: number };
  /** Speed of the swipe (px/sec) */
  swipeSpeed: number;
}

export class MosquitoSliceManager {
  private scene: THREE.Scene;
  private camera: THREE.PerspectiveCamera;
  private activeHalves: SlicedHalf[] = [];
  private particleGroup: THREE.Group;

  // Key adjustable physics parameters
  public separationForce: number = 2.4; // Initial impulse magnitude in m/s
  public upwardPopForce: number = 1.3;  // Initial upward pop in m/s
  public gravity: number = -7.8;        // Downward acceleration in m/s²
  public tumbleSpeed: number = 9.5;      // Angular velocity scale in rad/s
  public halfLifetime: number = 1.2;     // Duration before fade and removal (seconds)

  constructor(scene: THREE.Scene, camera: THREE.PerspectiveCamera) {
    this.scene = scene;
    this.camera = camera;

    this.particleGroup = new THREE.Group();
    this.scene.add(this.particleGroup);
  }

  /**
   * Spawns two physically simulated halves of a sliced mosquito
   * @param mosquitoPos 3D world position of the mosquito at the instant of slicing
   * @param mosquitoQuat 3D rotation quaternion of the mosquito
   * @param mosquitoScale 3D scale vector of the mosquito
   * @param isBoss Whether this entity is the giant boss
   * @param sliceParams 2D screen line of the cut
   */
  public spawnSlicedHalves(
    mosquitoPos: THREE.Vector3,
    mosquitoQuat: THREE.Quaternion,
    mosquitoScale: THREE.Vector3,
    isBoss: boolean,
    sliceParams: SliceParams
  ) {
    const { p1, p2 } = sliceParams;

    // 1. Vector mathematics for cut direction and 2D normal
    const dx = p2.x - p1.x;
    const dy = p2.y - p1.y;
    const len = Math.hypot(dx, dy) || 1;
    const dirX = dx / len;
    const dirY = dy / len;

    // Screen normal: perpendicular to swipe vector (-dirY, dirX)
    const normX = -dirY;
    const normY = dirX;

    // 2. Project screen normal into 3D world space relative to camera orientation
    const cameraRight = new THREE.Vector3(1, 0, 0).applyQuaternion(this.camera.quaternion);
    const cameraUp = new THREE.Vector3(0, 1, 0).applyQuaternion(this.camera.quaternion);
    const cameraForward = new THREE.Vector3(0, 0, -1).applyQuaternion(this.camera.quaternion);

    // Screen Y is down (+Y is downward), Three.js Up is +Y upward
    const worldCutNormal = new THREE.Vector3()
      .addScaledVector(cameraRight, normX)
      .addScaledVector(cameraUp, -normY)
      .normalize();

    // Swipe direction in 3D (momentum follow-through)
    const worldSwipeDir = new THREE.Vector3()
      .addScaledVector(cameraRight, dirX)
      .addScaledVector(cameraUp, -dirY)
      .normalize();

    // 3. Create two clipping planes coplanar with the cut point
    const planeA = new THREE.Plane();
    planeA.setFromNormalAndCoplanarPoint(worldCutNormal, mosquitoPos);

    const planeB = new THREE.Plane();
    planeB.setFromNormalAndCoplanarPoint(worldCutNormal.clone().negate(), mosquitoPos);

    // 4. Instantiation of Half A and Half B
    const createHalfMesh = (plane: THREE.Plane, sign: number): SlicedHalf | null => {
      const model = mosquitoModelLoader.createInstance(isBoss);
      if (!model) return null;

      const halfGroup = new THREE.Group();
      halfGroup.position.copy(mosquitoPos);
      halfGroup.quaternion.copy(mosquitoQuat);
      halfGroup.scale.copy(mosquitoScale);

      // Offset slightly along normal to prevent visual clipping artifacts
      halfGroup.position.addScaledVector(worldCutNormal, sign * 0.04);

      const halfMaterials: THREE.Material[] = [];

      model.traverse((child) => {
        if ((child as THREE.Mesh).isMesh) {
          const mesh = child as THREE.Mesh;
          mesh.castShadow = false;
          mesh.receiveShadow = false;

          // Clone material so clipping plane affects only this half
          if (Array.isArray(mesh.material)) {
            mesh.material = mesh.material.map((mat) => {
              const m = mat.clone();
              m.clippingPlanes = [plane];
              m.clipShadows = true;
              m.side = THREE.DoubleSide;
              m.transparent = true;
              halfMaterials.push(m);
              return m;
            });
          } else if (mesh.material) {
            const m = mesh.material.clone();
            m.clippingPlanes = [plane];
            m.clipShadows = true;
            m.side = THREE.DoubleSide;
            m.transparent = true;
            mesh.material = m;
            halfMaterials.push(m);
          }
        }
      });

      halfGroup.add(model);
      this.scene.add(halfGroup);

      // Ballistic impulses:
      // - Outward separation along cut normal (+sign)
      // - Upward pop
      // - Slight momentum in swipe direction
      const sepVel = worldCutNormal.clone().multiplyScalar(sign * this.separationForce);
      const upVel = cameraUp.clone().multiplyScalar(this.upwardPopForce * (0.8 + Math.random() * 0.4));
      const followVel = worldSwipeDir.clone().multiplyScalar(0.4);

      const initialVelocity = sepVel.add(upVel).add(followVel);

      // Random tumbling angular velocity (rad/s)
      const angularVelocity = new THREE.Vector3(
        (Math.random() - 0.5) * this.tumbleSpeed * 1.5,
        (Math.random() - 0.5) * this.tumbleSpeed * 1.2 + sign * 3.5,
        (Math.random() - 0.5) * this.tumbleSpeed * 1.5
      );

      return {
        group: halfGroup,
        velocity: initialVelocity,
        angularVelocity,
        age: 0,
        maxLifetime: this.halfLifetime,
        plane,
        materials: halfMaterials,
      };
    };

    const halfA = createHalfMesh(planeA, 1.0);
    const halfB = createHalfMesh(planeB, -1.0);

    if (halfA) this.activeHalves.push(halfA);
    if (halfB) this.activeHalves.push(halfB);

    // 5. Emit slice splatter particles along the cut line in 3D
    this.emitSliceBurst(mosquitoPos, worldCutNormal, worldSwipeDir);
  }

  /**
   * Emits cut seam particle droplets
   */
  private emitSliceBurst(pos: THREE.Vector3, cutNormal: THREE.Vector3, swipeDir: THREE.Vector3) {
    const count = 14;
    const geom = new THREE.BufferGeometry();
    const positions = new Float32Array(count * 3);
    const velocities: THREE.Vector3[] = [];

    for (let i = 0; i < count; i++) {
      positions[i * 3 + 0] = pos.x;
      positions[i * 3 + 1] = pos.y;
      positions[i * 3 + 2] = pos.z;

      // Particle spray perpendicular to cut plane with slight forward spray
      const spread = (Math.random() - 0.5) * 1.8;
      const v = cutNormal
        .clone()
        .multiplyScalar(spread)
        .addScaledVector(swipeDir, 0.4 + Math.random() * 0.8)
        .add(new THREE.Vector3(0, 0.6 + Math.random() * 0.8, 0));
      velocities.push(v);
    }

    geom.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    const mat = new THREE.PointsMaterial({
      color: 0x84cc16, // Insect hemolymph / neon lime
      size: 0.09,
      transparent: true,
      opacity: 0.9,
    });

    const pSystem = new THREE.Points(geom, mat);
    this.particleGroup.add(pSystem);

    let age = 0;
    const duration = 0.55;

    const animateParticles = () => {
      age += 0.016;
      if (age > duration) {
        this.particleGroup.remove(pSystem);
        geom.dispose();
        mat.dispose();
        return;
      }

      const posAttr = geom.getAttribute('position') as THREE.BufferAttribute;
      const arr = posAttr.array as Float32Array;

      for (let i = 0; i < count; i++) {
        const vel = velocities[i];
        vel.y -= 9.8 * 0.016; // gravity
        arr[i * 3 + 0] += vel.x * 0.016;
        arr[i * 3 + 1] += vel.y * 0.016;
        arr[i * 3 + 2] += vel.z * 0.016;
      }
      posAttr.needsUpdate = true;
      mat.opacity = 0.9 * (1.0 - age / duration);

      requestAnimationFrame(animateParticles);
    };

    requestAnimationFrame(animateParticles);
  }

  /**
   * Physics step for all active falling halves
   */
  public update(delta: number) {
    for (let i = this.activeHalves.length - 1; i >= 0; i--) {
      const half = this.activeHalves[i];
      half.age += delta;

      if (half.age >= half.maxLifetime) {
        // Dispose resources and remove from scene
        this.scene.remove(half.group);
        half.materials.forEach((m) => m.dispose());
        this.activeHalves.splice(i, 1);
        continue;
      }

      // Physics integration
      half.velocity.y += this.gravity * delta; // Gravity downward
      half.group.position.addScaledVector(half.velocity, delta);

      // Angular tumbling
      half.group.rotation.x += half.angularVelocity.x * delta;
      half.group.rotation.y += half.angularVelocity.y * delta;
      half.group.rotation.z += half.angularVelocity.z * delta;

      // Update clipping plane coplanar point with moving half
      half.plane.setFromNormalAndCoplanarPoint(half.plane.normal, half.group.position);

      // Smooth fade-out in final 35% of life
      const remainingProgress = (half.maxLifetime - half.age) / (half.maxLifetime * 0.35);
      if (remainingProgress < 1.0) {
        const alpha = Math.max(0, remainingProgress);
        half.materials.forEach((m) => {
          m.opacity = alpha;
        });
      }
    }
  }

  /**
   * Clean up all active halves
   */
  public clearAll() {
    this.activeHalves.forEach((half) => {
      this.scene.remove(half.group);
      half.materials.forEach((m) => m.dispose());
    });
    this.activeHalves = [];

    while (this.particleGroup.children.length > 0) {
      const child = this.particleGroup.children[0];
      this.particleGroup.remove(child);
    }
  }
}
