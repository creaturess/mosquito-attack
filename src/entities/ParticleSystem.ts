/**
 * ParticleSystem.ts
 * High-performance mobile particle effects:
 * - Blood splats / swat bursts
 * - Scream soundwave rings (Web Audio reactive)
 * - Ambient floating night dust
 */

import * as THREE from 'three';

interface SplatParticle {
  position: THREE.Vector3;
  velocity: THREE.Vector3;
  color: THREE.Color;
  size: number;
  alpha: number;
  life: number;
  maxLife: number;
}

export class ParticleSystem {
  public group: THREE.Group;
  private splatParticles: SplatParticle[] = [];
  private splatMesh: THREE.InstancedMesh;
  private readonly MAX_SPLAT = 250;
  private dummy = new THREE.Object3D();

  // Scream shockwave rings
  private shockwaveMesh: THREE.Mesh;
  private shockwaveScale: number = 0;
  private shockwaveAlpha: number = 0;

  // Floating dust motes
  private dustPoints: THREE.Points;

  constructor() {
    this.group = new THREE.Group();

    // 1. Instanced Splat Particles
    const sphereGeo = new THREE.SphereGeometry(0.06, 4, 4);
    const splatMat = new THREE.MeshBasicMaterial({
      color: 0xcc0011,
      transparent: true,
      opacity: 0.9,
    });
    this.splatMesh = new THREE.InstancedMesh(sphereGeo, splatMat, this.MAX_SPLAT);
    this.splatMesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    
    // Hide initially
    for (let i = 0; i < this.MAX_SPLAT; i++) {
      this.dummy.position.set(0, -999, 0);
      this.dummy.updateMatrix();
      this.splatMesh.setMatrixAt(i, this.dummy.matrix);
    }
    this.splatMesh.instanceMatrix.needsUpdate = true;
    this.group.add(this.splatMesh);

    // 2. Scream Shockwave Ring (reacts to user screams)
    const ringGeo = new THREE.RingGeometry(0.3, 0.45, 32);
    const ringMat = new THREE.MeshBasicMaterial({
      color: 0x38bdf8,
      transparent: true,
      opacity: 0,
      side: THREE.DoubleSide,
    });
    this.shockwaveMesh = new THREE.Mesh(ringGeo, ringMat);
    this.shockwaveMesh.visible = false;
    this.group.add(this.shockwaveMesh);

    // 3. Ambient dust motes
    const dustCount = 80;
    const dustGeo = new THREE.BufferGeometry();
    const dustPositions = new Float32Array(dustCount * 3);
    for (let i = 0; i < dustCount; i++) {
      dustPositions[i * 3] = (Math.random() - 0.5) * 16;
      dustPositions[i * 3 + 1] = (Math.random() - 0.5) * 10;
      dustPositions[i * 3 + 2] = (Math.random() - 0.5) * 16;
    }
    dustGeo.setAttribute('position', new THREE.BufferAttribute(dustPositions, 3));
    const dustMat = new THREE.PointsMaterial({
      color: 0x94a3b8,
      size: 0.08,
      transparent: true,
      opacity: 0.35,
    });
    this.dustPoints = new THREE.Points(dustGeo, dustMat);
    this.group.add(this.dustPoints);
  }

  public emitSplat(position: THREE.Vector3, isBoss: boolean = false) {
    const count = isBoss ? 60 : 25;
    for (let i = 0; i < count; i++) {
      if (this.splatParticles.length >= this.MAX_SPLAT) {
        this.splatParticles.shift();
      }

      const speed = (0.8 + Math.random() * 2.5) * (isBoss ? 1.6 : 1.0);
      const theta = Math.random() * Math.PI * 2;
      const phi = Math.acos(Math.random() * 2 - 1);

      this.splatParticles.push({
        position: position.clone(),
        velocity: new THREE.Vector3(
          Math.sin(phi) * Math.cos(theta) * speed,
          Math.sin(phi) * Math.sin(theta) * speed + 0.5,
          Math.cos(phi) * speed
        ),
        color: new THREE.Color(isBoss ? (Math.random() > 0.5 ? 0xff0055 : 0x770022) : 0xaa0000),
        size: (0.8 + Math.random() * 0.8) * (isBoss ? 2.0 : 1.0),
        alpha: 1.0,
        life: 0,
        maxLife: 0.6 + Math.random() * 0.4,
      });
    }
  }

  public triggerShockwave(origin: THREE.Vector3, lookDir: THREE.Vector3) {
    this.shockwaveMesh.position.copy(origin).add(lookDir.clone().multiplyScalar(1.5));
    this.shockwaveMesh.lookAt(origin.clone().add(lookDir.clone().multiplyScalar(5)));
    this.shockwaveScale = 0.5;
    this.shockwaveAlpha = 0.9;
    this.shockwaveMesh.visible = true;
  }

  public update(delta: number, audioVolume: number = 0) {
    // 1. Update splat particles
    for (let i = this.splatParticles.length - 1; i >= 0; i--) {
      const p = this.splatParticles[i];
      p.life += delta;
      if (p.life >= p.maxLife) {
        this.splatParticles.splice(i, 1);
        continue;
      }
      p.position.addScaledVector(p.velocity, delta);
      p.velocity.y -= delta * 6; // gravity
      p.alpha = 1 - p.life / p.maxLife;
    }

    // Render splat particles in instanced mesh
    for (let i = 0; i < this.MAX_SPLAT; i++) {
      if (i < this.splatParticles.length) {
        const p = this.splatParticles[i];
        this.dummy.position.copy(p.position);
        const s = p.size * (1 - p.life / p.maxLife);
        this.dummy.scale.set(s, s, s);
        this.dummy.updateMatrix();
        this.splatMesh.setMatrixAt(i, this.dummy.matrix);
      } else {
        this.dummy.position.set(0, -999, 0);
        this.dummy.updateMatrix();
        this.splatMesh.setMatrixAt(i, this.dummy.matrix);
      }
    }
    this.splatMesh.instanceMatrix.needsUpdate = true;

    // 2. Shockwave expansion
    if (this.shockwaveMesh.visible) {
      this.shockwaveScale += delta * 9;
      this.shockwaveAlpha -= delta * 1.8;
      this.shockwaveMesh.scale.setScalar(this.shockwaveScale);
      (this.shockwaveMesh.material as THREE.MeshBasicMaterial).opacity = Math.max(0, this.shockwaveAlpha);
      if (this.shockwaveAlpha <= 0) {
        this.shockwaveMesh.visible = false;
      }
    }

    // React shockwave to high audio screaming
    if (audioVolume > 0.65 && !this.shockwaveMesh.visible) {
      this.shockwaveScale = 0.8 + audioVolume * 1.5;
      this.shockwaveAlpha = 0.75;
      this.shockwaveMesh.visible = true;
    }

    // 3. Gentle dust movement
    if (this.dustPoints) {
      this.dustPoints.rotation.y += delta * 0.04;
    }
  }
}
