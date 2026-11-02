/**
 * ThreeCanvas.tsx
 * Full-screen Three.js WebGL viewport:
 * - 6 fixed world-space nests (360-degree, 3.6m to 7.2m away, varied heights)
 * - Solid mosquitoes (opacity 1.0 at <= 4m, fade-in between 6m and 4m)
 * - Motion trail (estela de movimiento) fading over ~0.4s
 * - Capped angular velocity (<= 75 deg/s in view) and eased turns
 * - Screen-edge lingering and directional exit tracking
 * - 3D HRTF spatial audio with amplified left/right stereo spread
 * - Generous hit tolerance and reactive central targeting reticle
 * - Interactive 3D wireframe debug visualization of nests
 */

import React, { useEffect, useRef } from 'react';
import * as THREE from 'three';
import { Mosquito } from '../entities/Mosquito';
import { mosquitoModelLoader } from '../entities/MosquitoModelLoader';
import { ParticleSystem } from '../entities/ParticleSystem';
import { sensorManager } from '../sensors/SensorManager';
import { buzzManager } from '../audio/SpatialBuzzManager';
import { GAMEPLAY_CONFIG } from '../config/gameplayConfig';

// ==========================================
// FRUIT NINJA SWIPE & SLICING INTERNAL TYPES & MANAGERS
// Self-contained to guarantee Vercel builds without external path errors
// ==========================================

export interface SwipePoint {
  x: number;
  y: number;
  time: number;
}

export interface MosquitoScreenTarget {
  id: string;
  screenX: number;
  screenY: number;
  radiusPx: number;
  isDead: boolean;
  userData: unknown;
}

export interface SliceHitResult {
  targetId: string;
  p1: { x: number; y: number };
  p2: { x: number; y: number };
  swipeSpeed: number;
}

export class BladeSwipeDetector {
  private canvas: HTMLCanvasElement;
  private ctx: CanvasRenderingContext2D | null;
  private points: SwipePoint[] = [];

  public trailLifetimeMs: number = 160;
  public minSwipeSpeed: number = 220;
  public minSegmentLength: number = 8;
  public coreColor: string = '#ffffff';
  public glowColor: string = '#38bdf8';

  constructor(canvas: HTMLCanvasElement) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d');
  }

  public resize(width: number, height: number) {
    this.canvas.width = width;
    this.canvas.height = height;
  }

  public addPoint(x: number, y: number) {
    const now = performance.now();
    this.points.push({ x, y, time: now });
  }

  public endStroke() {}

  public checkIntersections(targets: MosquitoScreenTarget[]): SliceHitResult[] {
    const hits: SliceHitResult[] = [];
    if (this.points.length < 2) return hits;

    const p2 = this.points[this.points.length - 1];
    const p1 = this.points[this.points.length - 2];

    const dx = p2.x - p1.x;
    const dy = p2.y - p1.y;
    const len = Math.hypot(dx, dy);
    if (len < this.minSegmentLength) return hits;

    const dt = Math.max((p2.time - p1.time) / 1000, 0.001);
    const speed = len / dt;

    if (speed < this.minSwipeSpeed) return hits;

    const lenSq = len * len;

    for (const target of targets) {
      if (target.isDead) continue;

      const cx = target.screenX;
      const cy = target.screenY;
      const radius = target.radiusPx;

      const dot = (cx - p1.x) * dx + (cy - p1.y) * dy;
      const t = Math.max(0, Math.min(1, dot / lenSq));

      const qx = p1.x + t * dx;
      const qy = p1.y + t * dy;

      const distSq = (cx - qx) * (cx - qx) + (cy - qy) * (cy - qy);

      if (distSq <= radius * radius) {
        hits.push({
          targetId: target.id,
          p1: { x: p1.x, y: p1.y },
          p2: { x: p2.x, y: p2.y },
          swipeSpeed: speed,
        });
      }
    }

    return hits;
  }

  public render() {
    if (!this.ctx) return;
    const ctx = this.ctx;
    const now = performance.now();

    this.points = this.points.filter((pt) => now - pt.time <= this.trailLifetimeMs);

    ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);
    if (this.points.length < 2) return;

    ctx.save();
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';

    for (let i = 0; i < this.points.length - 1; i++) {
      const ptA = this.points[i];
      const ptB = this.points[i + 1];

      const ageA = (now - ptA.time) / this.trailLifetimeMs;
      const progress = i / (this.points.length - 1);
      const alpha = Math.max(0, (1 - ageA) * progress);

      ctx.beginPath();
      ctx.moveTo(ptA.x, ptA.y);
      ctx.lineTo(ptB.x, ptB.y);

      ctx.strokeStyle = this.glowColor;
      ctx.globalAlpha = alpha * 0.85;
      ctx.lineWidth = 10 * progress + 2;
      ctx.shadowColor = this.glowColor;
      ctx.shadowBlur = 12;
      ctx.stroke();
    }

    for (let i = 0; i < this.points.length - 1; i++) {
      const ptA = this.points[i];
      const ptB = this.points[i + 1];

      const ageA = (now - ptA.time) / this.trailLifetimeMs;
      const progress = i / (this.points.length - 1);
      const alpha = Math.max(0, (1 - ageA) * progress);

      ctx.beginPath();
      ctx.moveTo(ptA.x, ptA.y);
      ctx.lineTo(ptB.x, ptB.y);

      ctx.strokeStyle = this.coreColor;
      ctx.globalAlpha = alpha;
      ctx.lineWidth = 4 * progress + 1;
      ctx.shadowBlur = 0;
      ctx.stroke();
    }

    ctx.restore();
  }

  public clear() {
    this.points = [];
    if (this.ctx) {
      this.ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);
    }
  }
}

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
  p1: { x: number; y: number };
  p2: { x: number; y: number };
  swipeSpeed: number;
}

export class MosquitoSliceManager {
  private scene: THREE.Scene;
  private camera: THREE.PerspectiveCamera;
  private activeHalves: SlicedHalf[] = [];
  private particleGroup: THREE.Group;

  public separationForce: number = 2.4;
  public upwardPopForce: number = 1.3;
  public gravity: number = -7.8;
  public tumbleSpeed: number = 9.5;
  public halfLifetime: number = 1.2;

  constructor(scene: THREE.Scene, camera: THREE.PerspectiveCamera) {
    this.scene = scene;
    this.camera = camera;

    this.particleGroup = new THREE.Group();
    this.scene.add(this.particleGroup);
  }

  public spawnSlicedHalves(
    mosquitoPos: THREE.Vector3,
    mosquitoQuat: THREE.Quaternion,
    mosquitoScale: THREE.Vector3,
    isBoss: boolean,
    sliceParams: SliceParams
  ) {
    const { p1, p2 } = sliceParams;

    const dx = p2.x - p1.x;
    const dy = p2.y - p1.y;
    const len = Math.hypot(dx, dy) || 1;
    const dirX = dx / len;
    const dirY = dy / len;

    const normX = -dirY;
    const normY = dirX;

    const cameraRight = new THREE.Vector3(1, 0, 0).applyQuaternion(this.camera.quaternion);
    const cameraUp = new THREE.Vector3(0, 1, 0).applyQuaternion(this.camera.quaternion);

    const worldCutNormal = new THREE.Vector3()
      .addScaledVector(cameraRight, normX)
      .addScaledVector(cameraUp, -normY)
      .normalize();

    const worldSwipeDir = new THREE.Vector3()
      .addScaledVector(cameraRight, dirX)
      .addScaledVector(cameraUp, -dirY)
      .normalize();

    const planeA = new THREE.Plane();
    planeA.setFromNormalAndCoplanarPoint(worldCutNormal, mosquitoPos);

    const planeB = new THREE.Plane();
    planeB.setFromNormalAndCoplanarPoint(worldCutNormal.clone().negate(), mosquitoPos);

    const createHalfMesh = (plane: THREE.Plane, sign: number): SlicedHalf | null => {
      const model = mosquitoModelLoader.createInstance(isBoss);
      if (!model) return null;

      const halfGroup = new THREE.Group();
      halfGroup.position.copy(mosquitoPos);
      halfGroup.quaternion.copy(mosquitoQuat);
      halfGroup.scale.copy(mosquitoScale);

      halfGroup.position.addScaledVector(worldCutNormal, sign * 0.04);

      const halfMaterials: THREE.Material[] = [];

      model.traverse((child) => {
        if ((child as THREE.Mesh).isMesh) {
          const mesh = child as THREE.Mesh;
          mesh.castShadow = false;
          mesh.receiveShadow = false;

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

      const sepVel = worldCutNormal.clone().multiplyScalar(sign * this.separationForce);
      const upVel = cameraUp.clone().multiplyScalar(this.upwardPopForce * (0.8 + Math.random() * 0.4));
      const followVel = worldSwipeDir.clone().multiplyScalar(0.4);

      const initialVelocity = sepVel.add(upVel).add(followVel);

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

    this.emitSliceBurst(mosquitoPos, worldCutNormal, worldSwipeDir);
  }

  private emitSliceBurst(pos: THREE.Vector3, cutNormal: THREE.Vector3, swipeDir: THREE.Vector3) {
    const count = 14;
    const geom = new THREE.BufferGeometry();
    const positions = new Float32Array(count * 3);
    const velocities: THREE.Vector3[] = [];

    for (let i = 0; i < count; i++) {
      positions[i * 3 + 0] = pos.x;
      positions[i * 3 + 1] = pos.y;
      positions[i * 3 + 2] = pos.z;

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
      color: 0x84cc16,
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
        vel.y -= 9.8 * 0.016;
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

  public update(delta: number) {
    for (let i = this.activeHalves.length - 1; i >= 0; i--) {
      const half = this.activeHalves[i];
      half.age += delta;

      if (half.age >= half.maxLifetime) {
        this.scene.remove(half.group);
        half.materials.forEach((m) => m.dispose());
        this.activeHalves.splice(i, 1);
        continue;
      }

      half.velocity.y += this.gravity * delta;
      half.group.position.addScaledVector(half.velocity, delta);

      half.group.rotation.x += half.angularVelocity.x * delta;
      half.group.rotation.y += half.angularVelocity.y * delta;
      half.group.rotation.z += half.angularVelocity.z * delta;

      half.plane.setFromNormalAndCoplanarPoint(half.plane.normal, half.group.position);

      const remainingProgress = (half.maxLifetime - half.age) / (half.maxLifetime * 0.35);
      if (remainingProgress < 1.0) {
        const alpha = Math.max(0, remainingProgress);
        half.materials.forEach((m) => {
          m.opacity = alpha;
        });
      }
    }
  }

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


export interface GameState {
  currentLevel: 1 | 2 | 3;
  isPlaying: boolean;
  timeLeft: number;
  kills: number;
  targetKills: number;
  bossHealthPercent: number;
  screamSecondsAccumulated: number;
  isBossDead: boolean;
  isARMode: boolean;
}

export interface NearestMosquitoInfo {
  direction: 'center' | 'left' | 'right' | 'behind';
  distance: number;
}

export interface DebugNestInfo {
  id: string;
  x: number;
  y: number;
  z: number;
  distance: number;
  mosquitoCount: number;
  aliveCount: number;
}

export interface EdgeIndicatorInfo {
  x: number;
  y: number;
  opacity: number;
}

interface MosquitoNest {
  id: string;
  position: THREE.Vector3;
  radius: number;
  mosquitoIds: string[];
}

interface ThreeCanvasProps {
  gameState: GameState;
  onKill: (newKills: number, isBoss: boolean) => void;
  onLevelComplete: () => void;
  onGameOver: (reason: string) => void;
  onScreamProgress: (accumulatedSec: number) => void;
  isARMode: boolean;
  videoElement: HTMLVideoElement | null;
  onNearestMosquitoUpdate?: (info: NearestMosquitoInfo | null) => void;
  onProximityHeatUpdate?: (heat: number, isAimingNear: boolean) => void;
  onEdgeIndicatorUpdate?: (indicator: EdgeIndicatorInfo | null) => void;
  isDebugMode?: boolean;
  onToggleDebug?: () => void;
  onDebugUpdate?: (nests: DebugNestInfo[]) => void;
}

export const ThreeCanvas: React.FC<ThreeCanvasProps> = ({
  gameState,
  onKill,
  onLevelComplete,
  onGameOver,
  onScreamProgress,
  onNearestMosquitoUpdate,
  onProximityHeatUpdate,
  onEdgeIndicatorUpdate,
  isDebugMode = false,
  onToggleDebug,
  onDebugUpdate,
}) => {
  const containerRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const bladeCanvasRef = useRef<HTMLCanvasElement>(null);

  // References to keep animation loop synchronized
  const stateRef = useRef(gameState);
  stateRef.current = gameState;

  const onKillRef = useRef(onKill);
  onKillRef.current = onKill;

  const onLevelCompleteRef = useRef(onLevelComplete);
  onLevelCompleteRef.current = onLevelComplete;

  const onGameOverRef = useRef(onGameOver);
  onGameOverRef.current = onGameOver;

  const onScreamProgressRef = useRef(onScreamProgress);
  onScreamProgressRef.current = onScreamProgress;

  const onNearestMosquitoUpdateRef = useRef(onNearestMosquitoUpdate);
  onNearestMosquitoUpdateRef.current = onNearestMosquitoUpdate;

  const onProximityHeatUpdateRef = useRef(onProximityHeatUpdate);
  onProximityHeatUpdateRef.current = onProximityHeatUpdate;

  const onEdgeIndicatorUpdateRef = useRef(onEdgeIndicatorUpdate);
  onEdgeIndicatorUpdateRef.current = onEdgeIndicatorUpdate;

  const isDebugModeRef = useRef(isDebugMode);
  isDebugModeRef.current = isDebugMode;

  const onToggleDebugRef = useRef(onToggleDebug);
  onToggleDebugRef.current = onToggleDebug;

  const onDebugUpdateRef = useRef(onDebugUpdate);
  onDebugUpdateRef.current = onDebugUpdate;

  useEffect(() => {
    if (!canvasRef.current || !containerRef.current || !bladeCanvasRef.current) return;

    // --- 1. Scene, Camera, Transparent Renderer ---
    const scene = new THREE.Scene();

    const camera = new THREE.PerspectiveCamera(
      70,
      window.innerWidth / window.innerHeight,
      0.1,
      100
    );
    camera.position.set(0.0, 1.6, 0.0);

    const renderer = new THREE.WebGLRenderer({
      canvas: canvasRef.current,
      antialias: true,
      alpha: true,
      powerPreference: 'high-performance',
    });
    renderer.localClippingEnabled = true;
    renderer.setClearColor(0x000000, 0);
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    renderer.setSize(window.innerWidth, window.innerHeight);

    // Fruit Ninja Slicing and Split Halves Physics Managers
    const sliceManager = new MosquitoSliceManager(scene, camera);
    const bladeDetector = new BladeSwipeDetector(bladeCanvasRef.current);
    bladeDetector.resize(window.innerWidth, window.innerHeight);

    // --- 2. Lighting & Phone Flashlight for AR ---
    const ambientLight = new THREE.AmbientLight(0xffffff, 1.8);
    scene.add(ambientLight);

    const dirLight = new THREE.DirectionalLight(0xfff5ea, 1.4);
    dirLight.position.set(3, 6, 2);
    scene.add(dirLight);

    const flashlight = new THREE.SpotLight(0xfffaec, 2.6, 14, Math.PI / 4, 0.45, 1.2);
    flashlight.position.set(0, 0, 0);
    camera.add(flashlight);
    flashlight.target.position.set(0, 0, -1);
    camera.add(flashlight.target);
    scene.add(camera);

    // --- 3. Particle System ---
    const particles = new ParticleSystem();
    scene.add(particles.group);

    // --- 4. Debug 3D Group ---
    const debugGroup = new THREE.Group();
    debugGroup.visible = isDebugModeRef.current;
    scene.add(debugGroup);

    // --- 5. World Nests & Mosquito Population ---
    let nests: MosquitoNest[] = [];
    let mosquitoes: Mosquito[] = [];
    let bossInstance: Mosquito | null = null;
    let nextMosquitoId = 1;
    let currentKills = 0;
    let accumulatedScreamTime = 0;
    let lastVibrateTime = 0;
    let debugUpdateThrottle = 0;

    // Clear all active mosquitoes and debug meshes
    const clearMosquitoes = () => {
      mosquitoes.forEach((m) => {
        m.dispose();
        scene.remove(m.group);
        scene.remove(m.trailLine);
        buzzManager.stopMosquitoBuzz(m.id);
      });
      mosquitoes = [];
      bossInstance = null;
      sliceManager.clearAll();
      bladeDetector.clear();

      while (debugGroup.children.length > 0) {
        const obj = debugGroup.children[0];
        debugGroup.remove(obj);
      }
      nests = [];
    };

    // Rebuild 3D visual markers for debug mode
    const rebuildDebugMeshes = () => {
      while (debugGroup.children.length > 0) {
        const obj = debugGroup.children[0];
        debugGroup.remove(obj);
      }

      nests.forEach((nest, idx) => {
        const sphereGeo = new THREE.IcosahedronGeometry(nest.radius, 1);
        const sphereMat = new THREE.MeshBasicMaterial({
          color: idx % 2 === 0 ? 0x22c55e : 0x06b6d4,
          wireframe: true,
          transparent: true,
          opacity: 0.55,
        });
        const sphereMesh = new THREE.Mesh(sphereGeo, sphereMat);
        sphereMesh.position.copy(nest.position);
        debugGroup.add(sphereMesh);

        const coreGeo = new THREE.SphereGeometry(0.12, 8, 8);
        const coreMat = new THREE.MeshBasicMaterial({ color: 0xf59e0b });
        const coreMesh = new THREE.Mesh(coreGeo, coreMat);
        coreMesh.position.copy(nest.position);
        debugGroup.add(coreMesh);

        const poleHeight = nest.position.y;
        const poleGeo = new THREE.CylinderGeometry(0.015, 0.015, poleHeight, 6);
        const poleMat = new THREE.MeshBasicMaterial({ color: 0x94a3b8, transparent: true, opacity: 0.4 });
        const poleMesh = new THREE.Mesh(poleGeo, poleMat);
        poleMesh.position.set(nest.position.x, poleHeight / 2, nest.position.z);
        debugGroup.add(poleMesh);

        const ringGeo = new THREE.RingGeometry(0.2, 0.28, 16);
        ringGeo.rotateX(-Math.PI / 2);
        const ringMat = new THREE.MeshBasicMaterial({ color: 0x38bdf8, side: THREE.DoubleSide });
        const ringMesh = new THREE.Mesh(ringGeo, ringMat);
        ringMesh.position.set(nest.position.x, 0.02, nest.position.z);
        debugGroup.add(ringMesh);
      });
    };

    /**
     * Generate fixed world nests configured via GAMEPLAY_CONFIG
     */
    const initLevelSpawns = () => {
      clearMosquitoes();
      currentKills = 0;
      accumulatedScreamTime = 0;
      const currentLvl = stateRef.current.currentLevel;
      const cfg = GAMEPLAY_CONFIG;

      if (currentLvl === 3) {
        // Level 3 Boss: ONLY the King Mosquito, placed at a clear ~5m distance
        buzzManager.stopAll();
        const bossNestPos = new THREE.Vector3(0.0, 1.2, -5.0);
        const bossMos = new Mosquito({
          id: `boss_${nextMosquitoId++}`,
          nestId: 'boss_nest',
          nestPosition: bossNestPos,
          nestRadius: 1.5,
          isBoss: true,
          scale: cfg.visibility.bossScale,
          speed: 0.22,
          level: 3,
        });
        bossMos.group.position.copy(bossNestPos);
        bossMos.group.lookAt(camera.position);
        scene.add(bossMos.group);
        scene.add(bossMos.trailLine);
        mosquitoes.push(bossMos);
        bossInstance = bossMos;

        nests.push({
          id: 'boss_nest',
          position: bossNestPos,
          radius: 2.0,
          mosquitoIds: [bossMos.id],
        });
      } else {
        // Levels 1 & 2: Wide 360-degree spread, strictly 1 mosquito per sector so they NEVER spawn together
        const totalMosquitoes = currentLvl === 1 ? 10 : 12;
        for (let i = 0; i < totalMosquitoes; i++) {
          const baseAngle = (i / totalMosquitoes) * Math.PI * 2;
          const angle = baseAngle + (Math.random() - 0.5) * 0.25;
          const dist =
            cfg.nests.minDistance +
            (i % 3 === 0 ? 0.2 : i % 3 === 1 ? 1.2 : 2.0) +
            Math.random() * 0.6;
          // Stagger heights so they don't share elevation (from 0.8m to 2.8m)
          const height = 0.8 + ((i * 0.45) % 2.0) + Math.random() * 0.2;
          const nestPos = new THREE.Vector3(Math.cos(angle) * dist, height, Math.sin(angle) * dist);
          const nestRadius = currentLvl === 2 ? 4.2 + Math.random() * 1.5 : 2.4 + Math.random() * 1.2;
          const nestId = `nest_${i + 1}`;
          const id = `mosquito_${nextMosquitoId++}`;
          const speed = currentLvl === 1 ? cfg.movement.baseSpeedLvl1 : cfg.movement.baseSpeedLvl2;
          const scale = currentLvl === 1 ? cfg.visibility.lvl1Scale : cfg.visibility.lvl2Scale;

          const mos = new Mosquito({
            id,
            nestId,
            nestPosition: nestPos,
            nestRadius,
            scale,
            speed,
            level: currentLvl,
          });

          scene.add(mos.group);
          scene.add(mos.trailLine);
          mosquitoes.push(mos);

          nests.push({
            id: nestId,
            position: nestPos,
            radius: nestRadius,
            mosquitoIds: [id],
          });
        }
      }

      rebuildDebugMeshes();
    };

    initLevelSpawns();

    // --- 6. Raycasting for Touch / Mouse Swatting ---
    const raycaster = new THREE.Raycaster();
    const mousePos = new THREE.Vector2();

    const handleSwat = (clientX: number, clientY: number) => {
      if (!stateRef.current.isPlaying) return;

      mousePos.x = (clientX / window.innerWidth) * 2 - 1;
      mousePos.y = -(clientY / window.innerHeight) * 2 + 1;

      raycaster.setFromCamera(mousePos, camera);

      const hitObjects: THREE.Object3D[] = [];
      mosquitoes.forEach((m) => {
        if (!m.isDead) {
          hitObjects.push(m.hitSphere);
        }
      });

      const intersects = raycaster.intersectObjects(hitObjects, true);

      let hitTarget: Mosquito | null = null;
      let hitPoint: THREE.Vector3 = new THREE.Vector3();

      if (intersects.length > 0) {
        const hitSphere = intersects[0].object as THREE.Mesh;
        const mosquitoId = hitSphere.userData?.mosquitoId;
        hitTarget = mosquitoes.find((m) => m.id === mosquitoId && !m.isDead) || null;
        if (hitTarget) {
          hitPoint.copy(intersects[0].point);
        }
      }

      // Screen-space proximity fallback with generous tolerance
      if (!hitTarget) {
        let bestDistancePx = GAMEPLAY_CONFIG.trackingAid.screenTouchTolerancePx;
        const screenPos = new THREE.Vector3();

        for (const mos of mosquitoes) {
          if (mos.isDead) continue;
          screenPos.setFromMatrixPosition(mos.group.matrixWorld);

          const viewPos = screenPos.clone().applyMatrix4(camera.matrixWorldInverse);
          if (viewPos.z >= -0.15) continue;

          screenPos.project(camera);
          if (screenPos.z > 1.0 || screenPos.z < -1.0) continue;

          const mosScreenX = ((screenPos.x + 1) * window.innerWidth) / 2;
          const mosScreenY = ((-screenPos.y + 1) * window.innerHeight) / 2;

          const distPx = Math.hypot(clientX - mosScreenX, clientY - mosScreenY);
          if (distPx < bestDistancePx) {
            bestDistancePx = distPx;
            hitTarget = mos;
            hitPoint.setFromMatrixPosition(mos.group.matrixWorld);
          }
        }
      }

      if (hitTarget) {
        if (hitTarget.isBoss) {
          buzzManager.playBossHurtSfx();
          sensorManager.triggerHaptic('bossHit');
          particles.emitSplat(hitPoint, true);
        } else {
          hitTarget.kill();
          buzzManager.stopMosquitoBuzz(hitTarget.id);
          buzzManager.playSwatSfx();
          sensorManager.triggerHaptic('swat');
          particles.emitSplat(hitPoint, false);

          currentKills++;
          onKillRef.current(currentKills, false);

          if (stateRef.current.currentLevel < 3 && currentKills >= stateRef.current.targetKills) {
            buzzManager.playVictorySfx();
            sensorManager.triggerHaptic('victory');
            onLevelCompleteRef.current();
          }
        }
      } else {
        buzzManager.playSwatSfx(false);
      }
    };

    const handleSliceHit = (hit: SliceHitResult) => {
      const mos = mosquitoes.find((m) => m.id === hit.targetId && !m.isDead);
      if (!mos) return;

      if (mos.isBoss) {
        buzzManager.playBossHurtSfx();
        sensorManager.triggerHaptic('bossHit');
        particles.emitSplat(mos.group.position, true);
        return;
      }

      // 1. Spatially divide the mosquito into 2 halves with ballistic physics & gravity
      sliceManager.spawnSlicedHalves(
        mos.group.position,
        mos.group.quaternion,
        mos.group.scale,
        mos.isBoss,
        {
          p1: hit.p1,
          p2: hit.p2,
          swipeSpeed: hit.swipeSpeed,
        }
      );

      // 2. Kill original mosquito instance
      mos.kill();
      buzzManager.stopMosquitoBuzz(mos.id);
      buzzManager.playSliceSfx();
      sensorManager.triggerHaptic('swat');
      particles.emitSplat(mos.group.position, false);

      currentKills++;
      onKillRef.current(currentKills, false);

      if (stateRef.current.currentLevel < 3 && currentKills >= stateRef.current.targetKills) {
        buzzManager.playVictorySfx();
        sensorManager.triggerHaptic('victory');
        onLevelCompleteRef.current();
      }
    };

    let isDragging = false;
    let pointerStartX = 0;
    let pointerStartY = 0;
    let prevPointer = { x: 0, y: 0 };
    let hasMovedSignificantly = false;

    const onPointerDown = (e: PointerEvent) => {
      const targetEl = e.target as HTMLElement | null;
      if (
        targetEl &&
        (targetEl.closest('[data-no-swat]') ||
          targetEl.closest('button') ||
          targetEl.closest('input'))
      ) {
        return;
      }
      isDragging = true;
      hasMovedSignificantly = false;
      pointerStartX = e.clientX;
      pointerStartY = e.clientY;
      prevPointer = { x: e.clientX, y: e.clientY };
      bladeDetector.addPoint(e.clientX, e.clientY);
    };

    const onPointerMove = (e: PointerEvent) => {
      if (!isDragging) return;

      const deltaX = e.clientX - prevPointer.x;
      const deltaY = e.clientY - prevPointer.y;
      const totalDist = Math.hypot(e.clientX - pointerStartX, e.clientY - pointerStartY);
      if (totalDist > 8) {
        hasMovedSignificantly = true;
      }

      bladeDetector.addPoint(e.clientX, e.clientY);

      // Screen-space targets for slicing
      if (stateRef.current.isPlaying) {
        const screenTargets: MosquitoScreenTarget[] = [];
        const tempVec = new THREE.Vector3();

        for (const mos of mosquitoes) {
          if (mos.isDead) continue;
          tempVec.setFromMatrixPosition(mos.group.matrixWorld);

          const viewPos = tempVec.clone().applyMatrix4(camera.matrixWorldInverse);
          if (viewPos.z >= -0.15) continue;

          tempVec.project(camera);
          if (tempVec.z > 1.0 || tempVec.z < -1.0) continue;

          const screenX = ((tempVec.x + 1) * window.innerWidth) / 2;
          const screenY = ((-tempVec.y + 1) * window.innerHeight) / 2;

          screenTargets.push({
            id: mos.id,
            screenX,
            screenY,
            radiusPx: mos.isBoss ? 130 : 75,
            isDead: mos.isDead,
            userData: mos,
          });
        }

        const hits = bladeDetector.checkIntersections(screenTargets);
        for (const hit of hits) {
          handleSliceHit(hit);
        }
      }

      // Slicing does not rotate/pan the camera: view remains solidly locked to AR/gyro
      prevPointer = { x: e.clientX, y: e.clientY };
    };

    const onPointerUp = (e: PointerEvent) => {
      if (isDragging) {
        isDragging = false;
        bladeDetector.endStroke();
        // If user tapped without dragging, trigger swat at touch point
        if (!hasMovedSignificantly) {
          handleSwat(e.clientX, e.clientY);
        }
      }
    };

    const onPointerCancel = () => {
      isDragging = false;
      bladeDetector.endStroke();
    };

    // Selectively prevent browser viewport scroll/pull-to-refresh without blocking buttons/inputs
    const handleTouchMovePreventScroll = (e: TouchEvent) => {
      const targetEl = e.target as HTMLElement | null;
      if (
        targetEl &&
        (targetEl.closest('button') ||
          targetEl.closest('input') ||
          targetEl.closest('select') ||
          targetEl.closest('[data-allow-scroll]'))
      ) {
        return; // Retain native touch behavior for interactive UI controls
      }

      if (e.cancelable) {
        e.preventDefault();
      }
    };

    window.addEventListener('pointerdown', onPointerDown as unknown as EventListener);
    window.addEventListener('pointermove', onPointerMove as unknown as EventListener);
    window.addEventListener('pointerup', onPointerUp as unknown as EventListener);
    window.addEventListener('pointercancel', onPointerCancel as unknown as EventListener);
    window.addEventListener('touchmove', handleTouchMovePreventScroll, { passive: false });

    // --- 7. Keyboard Navigation & F3 for Debug Toggle ---
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'w' || e.key === 'W' || e.key === 'ArrowUp') {
        sensorManager.moveForward(0.35);
      } else if (e.key === 's' || e.key === 'S' || e.key === 'ArrowDown') {
        sensorManager.moveForward(-0.35);
      } else if (e.key === 'a' || e.key === 'A' || e.key === 'ArrowLeft') {
        sensorManager.moveStrafe(-0.35);
      } else if (e.key === 'd' || e.key === 'D' || e.key === 'ArrowRight') {
        sensorManager.moveStrafe(0.35);
      } else if (e.key === 'F3') {
        onToggleDebugRef.current?.();
      }
    };

    const handleWheel = (e: WheelEvent) => {
      sensorManager.moveForward(-Math.sign(e.deltaY) * 0.3);
    };

    window.addEventListener('keydown', handleKeyDown);
    window.addEventListener('wheel', handleWheel, { passive: true });

    // --- 8. Window Resize ---
    const handleResize = () => {
      const width = window.innerWidth;
      const height = window.innerHeight;
      camera.aspect = width / height;
      camera.updateProjectionMatrix();
      renderer.setSize(width, height);
      renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
      bladeDetector.resize(width, height);
    };
    window.addEventListener('resize', handleResize);

    // --- 9. Animation Loop ---
    let animationFrameId: number;
    let lastTime = performance.now();
    let lastObservedLevel = stateRef.current.currentLevel;
    let lastIsPlaying = stateRef.current.isPlaying;

    const animate = () => {
      animationFrameId = requestAnimationFrame(animate);

      if (
        stateRef.current.currentLevel !== lastObservedLevel ||
        (stateRef.current.isPlaying && !lastIsPlaying)
      ) {
        lastObservedLevel = stateRef.current.currentLevel;
        lastIsPlaying = stateRef.current.isPlaying;
        initLevelSpawns();
      } else {
        lastIsPlaying = stateRef.current.isPlaying;
      }

      debugGroup.visible = isDebugModeRef.current;

      const now = performance.now();
      const delta = Math.min((now - lastTime) / 1000, 0.1);
      lastTime = now;

      // Update sensors (Orientation + 6DOF Spatial Position + Audio)
      const { orientation, position, audio } = sensorManager.update();

      // Camera rotation: Euler order YXZ (Yaw, Pitch, Roll)
      camera.rotation.order = 'YXZ';
      camera.rotation.y = orientation.yawRad;
      camera.rotation.x = orientation.pitchRad;
      camera.rotation.z = orientation.rollRad;

      // Camera spatial translation
      camera.position.set(position.x, position.y, position.z);
      camera.updateMatrixWorld();

      const camForward = new THREE.Vector3(0, 0, -1).applyQuaternion(camera.quaternion).normalize();

      if (stateRef.current.isPlaying) {
        // --- Boss scream mechanic in Level 3 ---
        if (stateRef.current.currentLevel === 3 && bossInstance && !bossInstance.isDead) {
          if (audio.isScreaming) {
            accumulatedScreamTime += delta;
            onScreamProgressRef.current(accumulatedScreamTime);

            const lookDir = camForward.clone();
            particles.triggerShockwave(camera.position, lookDir);
            buzzManager.playBossHurtSfx();
            sensorManager.triggerHaptic('bossHit');

            if (accumulatedScreamTime >= 10) {
              bossInstance.kill();
              particles.emitSplat(bossInstance.group.position, true);
              buzzManager.stopMosquitoBuzz(bossInstance.id);
              buzzManager.playVictorySfx();
              sensorManager.triggerHaptic('victory');
              onLevelCompleteRef.current();
            }
          }
        }

        const cameraMatrixInverse = camera.matrixWorldInverse;
        const cameraPos = camera.position;
        let minDistance = Infinity;
        let closestRelPos: THREE.Vector3 | null = null;
        let isAimingNear = false;
        let activeExitIndicator: EdgeIndicatorInfo | null = null;

        const targetConeDot = Math.cos(
          (GAMEPLAY_CONFIG.trackingAid.reticleTargetConeDeg * Math.PI) / 180
        );

        // Update all mosquitoes
        for (let i = 0; i < mosquitoes.length; i++) {
          const mos = mosquitoes[i];

          if (mos.isDead) {
            mos.update(
              delta,
              now * 0.001,
              cameraPos,
              audio.volume,
              cameraMatrixInverse,
              camera.aspect,
              camForward
            );

            const respawnDelayMs = mos.level === 2 ? 1200 : 1800;
            if (!mos.isBoss && now - mos.deathTime > respawnDelayMs) {
              mos.respawnAtNest();
            }
          } else {
            mos.update(
              delta,
              now * 0.001,
              cameraPos,
              audio.volume,
              cameraMatrixInverse,
              camera.aspect,
              camForward,
              mosquitoes
            );

            // Calculate spatial audio position relative to camera view
            const relPos = mos.group.position.clone().applyMatrix4(cameraMatrixInverse);
            const dist = relPos.length();
            const speedRatio = mos.currentSpeed / (mos.baseSpeed || 0.35);

            // King mosquito makes NO noise so player can scream without audio interference
            if (!mos.isBoss && stateRef.current.currentLevel !== 3) {
              buzzManager.updateMosquitoBuzz(
                mos.id,
                relPos.x,
                relPos.y,
                relPos.z,
                false,
                1.0,
                speedRatio
              );
            }

            if (dist < minDistance) {
              minDistance = dist;
              closestRelPos = relPos;
            }

            // Aiming detection: check if camera aims near mosquito
            const dirToMos = mos.group.position.clone().sub(cameraPos).normalize();
            const dot = camForward.dot(dirToMos);
            if (dot > targetConeDot && dist < 8.8) {
              isAimingNear = true;
            }

            // Track recent screen exit indicator (fades over 1.5s)
            if (
              mos.lastExitDirection &&
              now - mos.lastExitTimestamp <
                GAMEPLAY_CONFIG.trackingAid.edgeIndicatorDuration * 1000
            ) {
              const elapsed = (now - mos.lastExitTimestamp) / 1000;
              const alpha =
                1.0 - elapsed / GAMEPLAY_CONFIG.trackingAid.edgeIndicatorDuration;
              if (!activeExitIndicator || alpha > activeExitIndicator.opacity) {
                activeExitIndicator = {
                  x: mos.lastExitDirection.x,
                  y: mos.lastExitDirection.y,
                  opacity: alpha,
                };
              }
            }
          }
        }

        // Haptic feedback when aiming at a mosquito
        if (isAimingNear && navigator.vibrate && now - lastVibrateTime > 400) {
          try {
            navigator.vibrate(25);
          } catch {
            // Ignored if browser prevents vibration
          }
          lastVibrateTime = now;
        }

        // Emit edge indicator update
        onEdgeIndicatorUpdateRef.current?.(activeExitIndicator);

        // Proximity heat calculation (caliente/frío up to 8.8m)
        const proximityHeat = THREE.MathUtils.clamp((8.8 - minDistance) / 5.5, 0, 1);
        onProximityHeatUpdateRef.current?.(proximityHeat, isAimingNear);

        // Radar guidance
        if (closestRelPos && minDistance < 15) {
          const horizAngle = Math.atan2(closestRelPos.x, -closestRelPos.z) * (180 / Math.PI);
          let dir: 'center' | 'left' | 'right' | 'behind' = 'center';
          if (Math.abs(horizAngle) <= 28 && closestRelPos.z < 0) {
            dir = 'center';
          } else if (horizAngle > 28 && horizAngle < 130) {
            dir = 'right';
          } else if (horizAngle < -28 && horizAngle > -130) {
            dir = 'left';
          } else {
            dir = 'behind';
          }
          onNearestMosquitoUpdateRef.current?.({ direction: dir, distance: minDistance });
        } else {
          onNearestMosquitoUpdateRef.current?.(null);
        }

        // Periodic debug update
        debugUpdateThrottle += delta;
        if (debugUpdateThrottle > 0.1) {
          debugUpdateThrottle = 0;
          const debugList: DebugNestInfo[] = nests.map((nest) => {
            const nestMos = mosquitoes.filter((m) => m.nestId === nest.id);
            const alive = nestMos.filter((m) => !m.isDead).length;
            const distToCam = nest.position.distanceTo(cameraPos);
            return {
              id: nest.id,
              x: parseFloat(nest.position.x.toFixed(1)),
              y: parseFloat(nest.position.y.toFixed(1)),
              z: parseFloat(nest.position.z.toFixed(1)),
              distance: parseFloat(distToCam.toFixed(1)),
              mosquitoCount: nestMos.length,
              aliveCount: alive,
            };
          });
          onDebugUpdateRef.current?.(debugList);
        }
      } else {
        buzzManager.stopAll();
        onNearestMosquitoUpdateRef.current?.(null);
        onProximityHeatUpdateRef.current?.(0, false);
        onEdgeIndicatorUpdateRef.current?.(null);
      }

      renderer.setClearColor(0x000000, 0);

      sliceManager.update(delta);
      bladeDetector.render();
      particles.update(delta, audio.volume);
      renderer.render(scene, camera);
    };

    animationFrameId = requestAnimationFrame(animate);

    // --- Cleanup ---
    return () => {
      cancelAnimationFrame(animationFrameId);
      window.removeEventListener('touchmove', handleTouchMovePreventScroll);
      window.removeEventListener('pointerdown', onPointerDown as unknown as EventListener);
      window.removeEventListener('pointermove', onPointerMove as unknown as EventListener);
      window.removeEventListener('pointerup', onPointerUp as unknown as EventListener);
      window.removeEventListener('pointercancel', onPointerCancel as unknown as EventListener);
      window.removeEventListener('keydown', handleKeyDown);
      window.removeEventListener('wheel', handleWheel);
      window.removeEventListener('resize', handleResize);
      clearMosquitoes();
      buzzManager.stopAll();
      renderer.dispose();
    };
  }, []);

  return (
    <div
      ref={containerRef}
      className="absolute inset-0 h-full w-full overflow-hidden touch-none select-none"
      style={{ touchAction: 'none', overscrollBehavior: 'none' }}
    >
      <canvas
        ref={canvasRef}
        className="absolute inset-0 h-full w-full touch-none select-none"
        style={{ touchAction: 'none' }}
      />
      <canvas
        ref={bladeCanvasRef}
        className="absolute inset-0 h-full w-full pointer-events-none touch-none select-none"
        style={{ touchAction: 'none' }}
      />
    </div>
  );
};
