/**
 * ThreeCanvas.tsx
 * Full-screen Three.js WebGL viewport:
 * - 5 to 7 fixed world-space nests (360-degree, 3.5m to 7.5m away, varied heights)
 * - Mosquitoes fly Lissajous organic paths around nests with continuous motion
 * - Camera repulsion (> 1.5m) ensures mosquitoes never clip or spawn in front of player
 * - Dead mosquitoes respawn after 4.0s at their assigned world nest
 * - 3D HRTF spatial audio with distance rolloff, lowpass aiming clarity, & pitch acceleration
 * - Progressive visibility fade & speck scaling (invisible > 5.8m)
 * - Proximity hot/cold detection & subtle haptic feedback when aiming near
 * - Interactive 3D wireframe debug visualization of nests
 */

import React, { useEffect, useRef } from 'react';
import * as THREE from 'three';
import { Mosquito } from '../entities/Mosquito';
import { ParticleSystem } from '../entities/ParticleSystem';
import { sensorManager } from '../sensors/SensorManager';
import { buzzManager } from '../audio/SpatialBuzzManager';

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
  isDebugMode = false,
  onToggleDebug,
  onDebugUpdate,
}) => {
  const containerRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);

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

  const isDebugModeRef = useRef(isDebugMode);
  isDebugModeRef.current = isDebugMode;

  const onToggleDebugRef = useRef(onToggleDebug);
  onToggleDebugRef.current = onToggleDebug;

  const onDebugUpdateRef = useRef(onDebugUpdate);
  onDebugUpdateRef.current = onDebugUpdate;

  useEffect(() => {
    if (!canvasRef.current || !containerRef.current) return;

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
    renderer.setClearColor(0x000000, 0); // Transparent WebGL background for live camera
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    renderer.setSize(window.innerWidth, window.innerHeight);

    // --- 2. Lighting & Phone Flashlight for AR ---
    const ambientLight = new THREE.AmbientLight(0xffffff, 1.7);
    scene.add(ambientLight);

    const dirLight = new THREE.DirectionalLight(0xfff5ea, 1.3);
    dirLight.position.set(3, 6, 2);
    scene.add(dirLight);

    // Flashlight attached to camera
    const flashlight = new THREE.SpotLight(0xfffaec, 2.5, 14, Math.PI / 4, 0.45, 1.2);
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
        scene.remove(m.group);
        buzzManager.stopMosquitoBuzz(m.id);
      });
      mosquitoes = [];
      bossInstance = null;

      // Clear debug group
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
        // Wireframe sphere for nest orbital bounds
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

        // Center nest core marker
        const coreGeo = new THREE.SphereGeometry(0.12, 8, 8);
        const coreMat = new THREE.MeshBasicMaterial({ color: 0xf59e0b });
        const coreMesh = new THREE.Mesh(coreGeo, coreMat);
        coreMesh.position.copy(nest.position);
        debugGroup.add(coreMesh);

        // Vertical pole to ground (y = 0)
        const poleHeight = nest.position.y;
        const poleGeo = new THREE.CylinderGeometry(0.015, 0.015, poleHeight, 6);
        const poleMat = new THREE.MeshBasicMaterial({ color: 0x94a3b8, transparent: true, opacity: 0.4 });
        const poleMesh = new THREE.Mesh(poleGeo, poleMat);
        poleMesh.position.set(nest.position.x, poleHeight / 2, nest.position.z);
        debugGroup.add(poleMesh);

        // Ground ring marker
        const ringGeo = new THREE.RingGeometry(0.2, 0.28, 16);
        ringGeo.rotateX(-Math.PI / 2);
        const ringMat = new THREE.MeshBasicMaterial({ color: 0x38bdf8, side: THREE.DoubleSide });
        const ringMesh = new THREE.Mesh(ringGeo, ringMat);
        ringMesh.position.set(nest.position.x, 0.02, nest.position.z);
        debugGroup.add(ringMesh);
      });
    };

    /**
     * Generate 5 to 7 fixed world nests around the player in 360 degrees
     * (3m to 8m distance, varied heights), and assign 1 or 2 mosquitoes per nest.
     */
    const initLevelSpawns = () => {
      clearMosquitoes();
      currentKills = 0;
      accumulatedScreamTime = 0;
      const currentLvl = stateRef.current.currentLevel;

      if (currentLvl === 3) {
        // --- LEVEL 3: GIANT BOSS + 4 SURROUNDING MINION NESTS ---
        // Boss at fixed world location 4.5m forward-left
        const bossNestPos = new THREE.Vector3(0.5, 1.8, -4.5);
        const bossMos = new Mosquito({
          id: `boss_${nextMosquitoId++}`,
          nestId: 'boss_nest',
          nestPosition: bossNestPos,
          nestRadius: 1.4,
          isBoss: true,
          scale: 3.8,
          speed: 0.16,
          level: 3,
        });
        scene.add(bossMos.group);
        mosquitoes.push(bossMos);
        bossInstance = bossMos;

        // 4 Minion nests placed 4m to 7m in world coordinates
        const numMinionNests = 4;
        for (let i = 0; i < numMinionNests; i++) {
          const angle = (i / numMinionNests) * Math.PI * 2 + (Math.random() - 0.5) * 0.4;
          const dist = 4.0 + Math.random() * 3.0;
          const height = 1.0 + Math.random() * 2.0;
          const nestPos = new THREE.Vector3(Math.cos(angle) * dist, height, Math.sin(angle) * dist);
          const nestRadius = 0.9 + Math.random() * 0.6;
          const nestId = `nest_${i + 1}`;

          const minionId = `mosquito_${nextMosquitoId++}`;
          const minion = new Mosquito({
            id: minionId,
            nestId,
            nestPosition: nestPos,
            nestRadius,
            scale: 1.05,
            speed: 0.22,
            level: 3,
          });
          scene.add(minion.group);
          mosquitoes.push(minion);

          nests.push({
            id: nestId,
            position: nestPos,
            radius: nestRadius,
            mosquitoIds: [minionId],
          });
        }
      } else {
        // --- LEVELS 1 & 2: 6 FIXED WORLD NESTS DISTRIBUTED 360° ---
        const totalNests = 6;
        for (let i = 0; i < totalNests; i++) {
          // Angular distribution covering full 360° with slight organic jitter
          const baseAngle = (i / totalNests) * Math.PI * 2;
          const angle = baseAngle + (Math.random() - 0.5) * 0.4;
          // Distances strictly between 3.5m and 7.5m (within 3m-8m specification)
          const dist = 3.6 + Math.random() * 3.6;
          // Varied heights: some low (0.9m), some at eye-level (1.6m), some high near ceiling (3.1m)
          const height = 0.85 + Math.random() * 2.3;
          const nestPos = new THREE.Vector3(Math.cos(angle) * dist, height, Math.sin(angle) * dist);
          const nestRadius = 0.85 + Math.random() * 0.65;
          const nestId = `nest_${i + 1}`;

          // Assign 1 or 2 mosquitoes per nest
          const mosPerNest = currentLvl === 1 ? (i % 3 === 0 ? 2 : 1) : (i % 2 === 0 ? 2 : 1);
          const assignedIds: string[] = [];

          for (let m = 0; m < mosPerNest; m++) {
            const id = `mosquito_${nextMosquitoId++}`;
            assignedIds.push(id);
            const scale = currentLvl === 1 ? 1.35 : 1.1;
            const speed = currentLvl === 1 ? 0.17 : 0.24;

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
            mosquitoes.push(mos);
          }

          nests.push({
            id: nestId,
            position: nestPos,
            radius: nestRadius,
            mosquitoIds: assignedIds,
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

      // Collect all alive interactive hitSpheres
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

      // Screen-space proximity fallback: guarantees responsive hit registration (80px radius)
      if (!hitTarget) {
        let bestDistancePx = 80;
        const screenPos = new THREE.Vector3();

        for (const mos of mosquitoes) {
          if (mos.isDead) continue;
          screenPos.setFromMatrixPosition(mos.group.matrixWorld);

          // Check if in front of camera
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
          // Kill mosquito: marks dead and records deathTime for respawn timer
          hitTarget.kill();
          buzzManager.stopMosquitoBuzz(hitTarget.id);
          buzzManager.playSwatSfx();
          sensorManager.triggerHaptic('swat');
          particles.emitSplat(hitPoint, false);

          currentKills++;
          onKillRef.current(currentKills, false);

          // Check level victory for Level 1 and 2
          if (stateRef.current.currentLevel < 3 && currentKills >= stateRef.current.targetKills) {
            buzzManager.playVictorySfx();
            sensorManager.triggerHaptic('victory');
            onLevelCompleteRef.current();
          }
        }
      } else {
        // Miss swat
        buzzManager.playSwatSfx(false);
      }
    };

    const onPointerDown = (e: PointerEvent) => {
      const targetEl = e.target as HTMLElement | null;
      if (
        targetEl &&
        (targetEl.closest('[data-no-swat]') ||
          targetEl.closest('button') ||
          targetEl.closest('input') ||
          targetEl.closest('.pointer-events-auto'))
      ) {
        return;
      }
      handleSwat(e.clientX, e.clientY);
    };

    // Touch drag for looking around on desktop or manual fallback
    let isDragging = false;
    let prevPointer = { x: 0, y: 0 };

    const onPointerMove = (e: PointerEvent) => {
      if (isDragging) {
        const deltaX = e.clientX - prevPointer.x;
        const deltaY = e.clientY - prevPointer.y;
        sensorManager.addManualLook(-deltaX * 0.005, -deltaY * 0.005);
        prevPointer = { x: e.clientX, y: e.clientY };
      }
    };

    const onMouseDown = (e: MouseEvent) => {
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
      prevPointer = { x: e.clientX, y: e.clientY };
    };

    const onMouseUp = () => {
      isDragging = false;
    };

    window.addEventListener('pointerdown', onPointerDown as unknown as EventListener);
    window.addEventListener('mousedown', onMouseDown);
    window.addEventListener('mousemove', onPointerMove as unknown as EventListener);
    window.addEventListener('mouseup', onMouseUp);

    // --- 7. Keyboard Navigation & 'D' key for Debug Toggle ---
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'w' || e.key === 'W' || e.key === 'ArrowUp') {
        sensorManager.moveForward(0.35);
      } else if (e.key === 's' || e.key === 'S' || e.key === 'ArrowDown') {
        sensorManager.moveForward(-0.35);
      } else if (e.key === 'a' || e.key === 'A' || e.key === 'ArrowLeft') {
        sensorManager.moveStrafe(-0.35);
      } else if (e.key === 'd' || e.key === 'D') {
        // Toggle Debug mode with 'D' key
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
    };
    window.addEventListener('resize', handleResize);

    // --- 9. Animation Loop ---
    let animationFrameId: number;
    let lastTime = performance.now();
    let lastObservedLevel = stateRef.current.currentLevel;
    let lastIsPlaying = stateRef.current.isPlaying;

    const animate = () => {
      animationFrameId = requestAnimationFrame(animate);

      // Detect level transition or new round start/restart
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

      // Sync debug mesh visibility
      debugGroup.visible = isDebugModeRef.current;

      const now = performance.now();
      const delta = Math.min((now - lastTime) / 1000, 0.1);
      lastTime = now;

      // Update sensors (Orientation + 6DOF Spatial Position + Audio)
      const { orientation, position, audio } = sensorManager.update();

      // Camera rotation: Euler order YXZ (Yaw, Pitch, Roll)
      // The world and nests stay completely fixed as player rotates 360°
      camera.rotation.order = 'YXZ';
      camera.rotation.y = orientation.yawRad;
      camera.rotation.x = orientation.pitchRad;
      camera.rotation.z = orientation.rollRad;

      // Camera spatial translation
      camera.position.set(position.x, position.y, position.z);
      camera.updateMatrixWorld();

      // Forward direction vector of camera in world space
      const camForward = new THREE.Vector3(0, 0, -1).applyQuaternion(camera.quaternion).normalize();

      // Gameplay updates
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

        // Collect other alive positions for separation
        const alivePositions: THREE.Vector3[] = [];
        for (let k = 0; k < mosquitoes.length; k++) {
          if (!mosquitoes[k].isDead) alivePositions.push(mosquitoes[k].group.position);
        }

        // Update all mosquitoes (alive flight and respawning)
        for (let i = 0; i < mosquitoes.length; i++) {
          const mos = mosquitoes[i];

          if (mos.isDead) {
            // Animate fall
            mos.update(delta, now * 0.001, cameraPos, audio.volume);

            // Rebirth after 4 seconds at its SAME assigned world nest (never at camera!)
            if (now - mos.deathTime > 4000) {
              mos.respawnAtNest();
            }
          } else {
            // Active mosquito flight
            mos.update(delta, now * 0.001, cameraPos, audio.volume);

            // Calculate spatial audio position relative to camera view
            const relPos = mos.group.position.clone().applyMatrix4(cameraMatrixInverse);
            const dist = relPos.length();
            const speedRatio = mos.currentSpeed / (mos.baseSpeed || 0.18);
            buzzManager.updateMosquitoBuzz(
              mos.id,
              relPos.x,
              relPos.y,
              relPos.z,
              mos.isBoss,
              1.0,
              speedRatio
            );

            if (dist < minDistance) {
              minDistance = dist;
              closestRelPos = relPos;
            }

            // Aiming detection: check if camera is pointing towards this mosquito (< 18° cone & < 6.5m)
            const dirToMos = mos.group.position.clone().sub(cameraPos).normalize();
            const dot = camForward.dot(dirToMos);
            if (dot > 0.94 && dist < 6.5) {
              isAimingNear = true;
            }
          }
        }

        // Haptic feedback when crosshair is pointing near a mosquito (subtle phone vibration)
        if (isAimingNear && navigator.vibrate && now - lastVibrateTime > 420) {
          try {
            navigator.vibrate(25);
          } catch {
            // Ignored if browser policy blocks vibration
          }
          lastVibrateTime = now;
        }

        // Proximity heat calculation: subtle "caliente/frío" metric (1.0 when close ~1.5m, 0.0 at >= 6.5m)
        const proximityHeat = THREE.MathUtils.clamp((6.5 - minDistance) / 4.8, 0, 1);
        onProximityHeatUpdateRef.current?.(proximityHeat, isAimingNear);

        // Radar direction guidance
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

        // Periodic debug info update (~10Hz)
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
      }

      // Update particles
      particles.update(delta, audio.volume);

      // Render 3D Scene
      renderer.render(scene, camera);
    };

    animationFrameId = requestAnimationFrame(animate);

    // --- Cleanup ---
    return () => {
      cancelAnimationFrame(animationFrameId);
      window.removeEventListener('pointerdown', onPointerDown as unknown as EventListener);
      window.removeEventListener('mousedown', onMouseDown);
      window.removeEventListener('mousemove', onPointerMove as unknown as EventListener);
      window.removeEventListener('keydown', handleKeyDown);
      window.removeEventListener('wheel', handleWheel);
      window.removeEventListener('resize', handleResize);
      clearMosquitoes();
      buzzManager.stopAll();
      renderer.dispose();
    };
  }, []);

  return (
    <div ref={containerRef} className="absolute inset-0 h-full w-full overflow-hidden">
      <canvas ref={canvasRef} className="absolute inset-0 h-full w-full touch-none" />
    </div>
  );
};
