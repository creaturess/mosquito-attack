/**
 * ThreeCanvas.tsx
 * Full-screen Three.js WebGL viewport handling 3D scene, camera flashlight,
 * gyro orientation, spatial audio buzz tracking, raycast touch swatting,
 * and AR video pass-through background.
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
  bossHealthPercent: number; // 0 to 100
  screamSecondsAccumulated: number; // Goal is 10s
  isBossDead: boolean;
  isARMode: boolean;
}

interface ThreeCanvasProps {
  gameState: GameState;
  onKill: (newKills: number, isBoss: boolean) => void;
  onLevelComplete: () => void;
  onGameOver: (reason: string) => void;
  onScreamProgress: (accumulatedSec: number) => void;
  isARMode: boolean;
  videoElement: HTMLVideoElement | null;
}

export const ThreeCanvas: React.FC<ThreeCanvasProps> = ({
  gameState,
  onKill,
  onLevelComplete,
  onGameOver,
  onScreamProgress,
  isARMode,
  videoElement,
}) => {
  const containerRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);

  // References to keep animation loop in sync with current state
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

  const videoElementRef = useRef(videoElement);
  videoElementRef.current = videoElement;

  const isARModeRef = useRef(isARMode);
  isARModeRef.current = isARMode;

  useEffect(() => {
    if (!canvasRef.current || !containerRef.current) return;

    // --- 1. Scene, Camera, Transparent Renderer ---
    const scene = new THREE.Scene();
    // No fog to keep real-world camera video crisp and transparent

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
    // Ambient light so mosquitoes are clearly visible in any real-world lighting
    const ambientLight = new THREE.AmbientLight(0xffffff, 1.6);
    scene.add(ambientLight);

    const dirLight = new THREE.DirectionalLight(0xfff5ea, 1.2);
    dirLight.position.set(3, 6, 2);
    scene.add(dirLight);

    // Flashlight attached to camera (player's phone light for hunting in real dark rooms)
    const flashlight = new THREE.SpotLight(0xfffaec, 2.4, 14, Math.PI / 4, 0.45, 1.2);
    flashlight.position.set(0, 0, 0);
    camera.add(flashlight);
    flashlight.target.position.set(0, 0, -1);
    camera.add(flashlight.target);
    scene.add(camera);

    // --- 3. Particle System ---
    const particles = new ParticleSystem();
    scene.add(particles.group);

    // --- 4. Mosquito Population Management ---
    let mosquitoes: Mosquito[] = [];
    let nextMosquitoId = 1;
    let spawnTimer = 0;
    let currentKills = 0;
    let accumulatedScreamTime = 0;
    let bossInstance: Mosquito | null = null;

    // 8 distinct 360-degree spatial sectors around the player in real physical space:
    const REAL_SPACE_SPAWN_SECTORS = [
      // 1. Directly Ahead (Front Center, eye-level)
      new THREE.Vector3(0.0, 1.6, -2.2),
      // 2. Front-Right (Elevated)
      new THREE.Vector3(1.8, 2.3, -1.8),
      // 3. Right Flank (Around ear level)
      new THREE.Vector3(2.4, 1.7, 0.2),
      // 4. Behind-Right (Deep right rear)
      new THREE.Vector3(1.9, 1.8, 2.0),
      // 5. Directly Behind (Rear center)
      new THREE.Vector3(0.0, 1.9, 2.4),
      // 6. Behind-Left (Deep left rear)
      new THREE.Vector3(-1.9, 1.8, 2.0),
      // 7. Left Flank (Around ear level)
      new THREE.Vector3(-2.4, 1.7, 0.2),
      // 8. Front-Left (Lower elevation)
      new THREE.Vector3(-1.8, 1.1, -1.8),
    ];

    // Helper to spawn a mosquito in real physical space
    const spawnMosquito = (isBoss: boolean = false, sectorIndex?: number) => {
      const id = `mosquito_${nextMosquitoId++}`;
      const currentLvl = stateRef.current.currentLevel;
      let scale = 0.85;
      let speed = 1.0;
      let initialPosition: THREE.Vector3 | undefined = undefined;

      if (currentLvl === 1) {
        scale = 1.0; // Clear, easy to spot when close
        speed = 0.52; // Moving slowly as requested
        // Pick one of the 8 real sectors to guarantee full 360-degree dispersal in the real environment
        const secIdx = sectorIndex !== undefined ? sectorIndex : Math.floor(Math.random() * REAL_SPACE_SPAWN_SECTORS.length);
        const basePos = REAL_SPACE_SPAWN_SECTORS[secIdx % REAL_SPACE_SPAWN_SECTORS.length];
        initialPosition = new THREE.Vector3(
          basePos.x + (Math.random() - 0.5) * 0.8,
          Math.max(0.7, Math.min(3.0, basePos.y + (Math.random() - 0.5) * 0.5)),
          basePos.z + (Math.random() - 0.5) * 0.8
        );
      } else if (currentLvl === 2) {
        scale = 0.72; // Un poco más pequeños que los del nivel 1
        speed = 0.92; // Un poco más rápidos y ágiles que los del nivel 1
        // Dispersed across all 8 sectors of real space
        const secIdx = sectorIndex !== undefined ? sectorIndex : Math.floor(Math.random() * REAL_SPACE_SPAWN_SECTORS.length);
        const basePos = REAL_SPACE_SPAWN_SECTORS[secIdx % REAL_SPACE_SPAWN_SECTORS.length];
        initialPosition = new THREE.Vector3(
          basePos.x + (Math.random() - 0.5) * 0.9,
          Math.max(0.7, Math.min(3.0, basePos.y + (Math.random() - 0.5) * 0.6)),
          basePos.z + (Math.random() - 0.5) * 0.9
        );
      } else if (currentLvl === 3) {
        if (isBoss) {
          scale = 3.6; // Giant Final Boss
          speed = 0.6;
          // Spawn right in front of the player in real space
          initialPosition = new THREE.Vector3(0.0, 1.8, -2.2);
        } else {
          scale = 0.72;
          speed = 0.92;
          const basePos = REAL_SPACE_SPAWN_SECTORS[Math.floor(Math.random() * REAL_SPACE_SPAWN_SECTORS.length)];
          initialPosition = new THREE.Vector3(basePos.x, basePos.y, basePos.z);
        }
      }

      const mos = new Mosquito({
        id,
        isBoss,
        scale,
        speed,
        initialPosition,
        level: currentLvl,
      });

      scene.add(mos.group);
      mosquitoes.push(mos);

      if (isBoss) {
        bossInstance = mos;
      }
      return mos;
    };

    // Clear all active mosquitoes
    const clearMosquitoes = () => {
      mosquitoes.forEach((m) => {
        scene.remove(m.group);
        buzzManager.stopMosquitoBuzz(m.id);
      });
      mosquitoes = [];
      bossInstance = null;
    };

    // Initialize level population
    const initLevelSpawns = () => {
      clearMosquitoes();
      currentKills = 0;
      accumulatedScreamTime = 0;

      if (stateRef.current.currentLevel === 3) {
        // Spawn Giant Boss
        spawnMosquito(true);
        // Spawn accompanying minion mosquitoes
        for (let i = 0; i < 4; i++) {
          spawnMosquito(false, i);
        }
      } else if (stateRef.current.currentLevel === 1) {
        // Initial wave of 8 mosquitoes dispersed across ALL 8 sectors of real physical space!
        for (let i = 0; i < REAL_SPACE_SPAWN_SECTORS.length; i++) {
          spawnMosquito(false, i);
        }
      } else if (stateRef.current.currentLevel === 2) {
        // Initial wave of 8 mosquitoes for Level 2 dispersed across ALL 8 sectors of real physical space!
        for (let i = 0; i < REAL_SPACE_SPAWN_SECTORS.length; i++) {
          spawnMosquito(false, i);
        }
      }
    };

    initLevelSpawns();

    // --- 7. Raycasting for Touch / Mouse Swatting ---
    const raycaster = new THREE.Raycaster();
    const mousePos = new THREE.Vector2();

    const handleSwat = (clientX: number, clientY: number) => {
      if (!stateRef.current.isPlaying) return;

      mousePos.x = (clientX / window.innerWidth) * 2 - 1;
      mousePos.y = -(clientY / window.innerHeight) * 2 + 1;

      raycaster.setFromCamera(mousePos, camera);

      // Collect all interactive hitSpheres
      const hitObjects: THREE.Object3D[] = [];
      mosquitoes.forEach((m) => {
        if (!m.isDead) {
          hitObjects.push(m.hitSphere);
        }
      });

      const intersects = raycaster.intersectObjects(hitObjects, true);

      if (intersects.length > 0) {
        const hitSphere = intersects[0].object as THREE.Mesh;
        const mosquitoId = hitSphere.userData?.mosquitoId;
        const isBoss = hitSphere.userData?.isBoss;

        const target = mosquitoes.find((m) => m.id === mosquitoId);
        if (target && !target.isDead) {
          if (isBoss) {
            // Boss takes damage from taps but primarily needs scream!
            // Give tactile feedback and hurt noise
            buzzManager.playBossHurtSfx();
            sensorManager.triggerHaptic('bossHit');
            particles.emitSplat(intersects[0].point, true);
          } else {
            // Kill normal mosquito
            target.kill();
            buzzManager.stopMosquitoBuzz(target.id);
            buzzManager.playSwatSfx();
            sensorManager.triggerHaptic('swat');
            particles.emitSplat(intersects[0].point, false);

            currentKills++;
            onKillRef.current(currentKills, false);

            // Check level victory for Level 1 and 2
            if (stateRef.current.currentLevel < 3 && currentKills >= stateRef.current.targetKills) {
              buzzManager.playVictorySfx();
              sensorManager.triggerHaptic('victory');
              onLevelCompleteRef.current();
            }
          }
        }
      } else {
        // Miss swat
        buzzManager.playSwatSfx(false);
      }
    };

    // Touch & pointer events for swatting mosquitoes
    const onPointerDown = (e: PointerEvent) => {
      const targetEl = e.target as HTMLElement | null;
      // Do not swat if tapping on virtual joystick, controls, or modals
      if (targetEl && (targetEl.closest('[data-no-swat]') || targetEl.closest('button') || targetEl.closest('input') || targetEl.closest('.pointer-events-auto'))) {
        return;
      }
      handleSwat(e.clientX, e.clientY);
    };

    // Touch drag for looking around on non-gyro devices or desktop
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
      if (targetEl && (targetEl.closest('[data-no-swat]') || targetEl.closest('button') || targetEl.closest('input'))) {
        return;
      }
      // Only drag if left click held and dragging on background/canvas
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

    // --- 8. Keyboard & Wheel Navigation (Desktop / Testing support) ---
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'w' || e.key === 'W' || e.key === 'ArrowUp') {
        sensorManager.moveForward(0.35);
      } else if (e.key === 's' || e.key === 'S' || e.key === 'ArrowDown') {
        sensorManager.moveForward(-0.35);
      } else if (e.key === 'a' || e.key === 'A' || e.key === 'ArrowLeft') {
        sensorManager.moveStrafe(-0.35);
      } else if (e.key === 'd' || e.key === 'D' || e.key === 'ArrowRight') {
        sensorManager.moveStrafe(0.35);
      }
    };

    const handleWheel = (e: WheelEvent) => {
      sensorManager.moveForward(-Math.sign(e.deltaY) * 0.3);
    };

    // Two-finger touch drag for mobile forward/backward movement
    let touchStartY = 0;
    let isTwoFingerTouch = false;

    const onTouchStart = (e: TouchEvent) => {
      if (e.touches.length === 2) {
        isTwoFingerTouch = true;
        touchStartY = (e.touches[0].clientY + e.touches[1].clientY) / 2;
      } else {
        isTwoFingerTouch = false;
      }
    };

    const onTouchMove = (e: TouchEvent) => {
      if (isTwoFingerTouch && e.touches.length === 2) {
        const currentY = (e.touches[0].clientY + e.touches[1].clientY) / 2;
        const dy = touchStartY - currentY;
        if (Math.abs(dy) > 4) {
          sensorManager.moveForward(dy * 0.018);
          touchStartY = currentY;
        }
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    window.addEventListener('wheel', handleWheel, { passive: true });
    window.addEventListener('touchstart', onTouchStart, { passive: true });
    window.addEventListener('touchmove', onTouchMove, { passive: true });

    // --- 9. Window Resize ---
    const handleResize = () => {
      const width = window.innerWidth;
      const height = window.innerHeight;
      camera.aspect = width / height;
      camera.updateProjectionMatrix();
      renderer.setSize(width, height);
      renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    };
    window.addEventListener('resize', handleResize);

    // --- 10. Animation Loop ---
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

      const now = performance.now();
      const delta = Math.min((now - lastTime) / 1000, 0.1);
      lastTime = now;

      // Process virtual touch joystick movement (360-degree analog walk & strafe)
      const joy = sensorManager.getJoystickInput();
      if (Math.abs(joy.x) > 0.02 || Math.abs(joy.y) > 0.02) {
        const walkSpeed = 2.8; // meters per second
        sensorManager.moveJoystick(joy.x, joy.y, walkSpeed * delta);
      }

      // Update sensors (Orientation + 6DOF Spatial Position + Audio)
      const { orientation, position, audio } = sensorManager.update();

      // Camera rotation: Euler order YXZ (Yaw, Pitch, Roll)
      camera.rotation.order = 'YXZ';
      camera.rotation.y = orientation.yawRad;
      camera.rotation.x = orientation.pitchRad;
      camera.rotation.z = orientation.rollRad;

      // Camera 6DOF spatial translation in real room
      camera.position.set(position.x, position.y, position.z);
      camera.updateMatrixWorld();

      // Gameplay updates if active
      if (stateRef.current.isPlaying) {
        // --- Level 3 Final Boss Scream mechanic ---
        if (stateRef.current.currentLevel === 3 && bossInstance && !bossInstance.isDead) {
          if (audio.isScreaming) {
            // Scream detected!
            accumulatedScreamTime += delta;
            onScreamProgressRef.current(accumulatedScreamTime);

            // Visual shockwaves & boss shake
            const lookDir = new THREE.Vector3(0, 0, -1).applyQuaternion(camera.quaternion);
            particles.triggerShockwave(camera.position, lookDir);
            buzzManager.playBossHurtSfx();
            sensorManager.triggerHaptic('bossHit');

            // If 10 seconds reached: Defeat Giant Boss!
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

        // Maintain mosquito population across all room sectors
        spawnTimer += delta;
        const targetActiveCount = stateRef.current.currentLevel === 3 ? 5 : 8;
        const aliveCount = mosquitoes.filter((m) => !m.isDead).length;

        if (aliveCount < targetActiveCount && spawnTimer > 0.6) {
          spawnTimer = 0;
          if (stateRef.current.currentLevel < 3) {
            const neededKills = stateRef.current.targetKills - currentKills;
            if (aliveCount < neededKills) {
              spawnMosquito(false);
            }
          } else {
            // In level 3, spawn minions to distract
            spawnMosquito(false);
          }
        }

        // Update active mosquitoes
        const cameraMatrixInverse = camera.matrixWorldInverse;
        const cameraPos = camera.position;

        for (let i = mosquitoes.length - 1; i >= 0; i--) {
          const mos = mosquitoes[i];
          mos.update(delta, now * 0.001, cameraPos, audio.volume);

          if (!mos.isDead) {
            // Calculate spatial audio position relative to camera view
            const relPos = mos.group.position.clone().applyMatrix4(cameraMatrixInverse);
            const speedFactor = stateRef.current.currentLevel === 2 ? 1.35 : 1.0;
            buzzManager.updateMosquitoBuzz(mos.id, relPos.x, relPos.y, relPos.z, mos.isBoss, speedFactor);
          } else {
            // Dead mosquito animation timeout removal
            if (now - mos.deathTime > 900) {
              scene.remove(mos.group);
              mosquitoes.splice(i, 1);
            }
          }
        }
      } else {
        // Paused or ended: stop all buzzing
        buzzManager.stopAll();
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
      window.removeEventListener('touchstart', onTouchStart);
      window.removeEventListener('touchmove', onTouchMove);
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
