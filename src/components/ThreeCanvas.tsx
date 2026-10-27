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

export interface NearestMosquitoInfo {
  direction: 'center' | 'left' | 'right' | 'behind';
  distance: number;
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
}

export const ThreeCanvas: React.FC<ThreeCanvasProps> = ({
  gameState,
  onKill,
  onLevelComplete,
  onGameOver,
  onScreamProgress,
  isARMode,
  videoElement,
  onNearestMosquitoUpdate,
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

  const onNearestMosquitoUpdateRef = useRef(onNearestMosquitoUpdate);
  onNearestMosquitoUpdateRef.current = onNearestMosquitoUpdate;

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
    let currentKills = 0;
    let accumulatedScreamTime = 0;
    let bossInstance: Mosquito | null = null;
    let ambushSpawnTimer = 0;
    let nextAmbushDelay = 0.5;

    // Helper to spawn a surprise ambush mosquito from behind the player's current view frustum
    const spawnAmbushMosquito = (isBoss: boolean = false) => {
      const id = `mosquito_${nextMosquitoId++}`;
      const currentLvl = stateRef.current.currentLevel;

      if (isBoss) {
        const scale = 3.8;
        const speed = 0.16;
        const initialPosition = new THREE.Vector3(0.0, 1.6, -2.2);
        const mos = new Mosquito({
          id,
          isBoss: true,
          scale,
          speed,
          initialPosition,
          level: currentLvl,
        });
        scene.add(mos.group);
        mosquitoes.push(mos);
        bossInstance = mos;
        return mos;
      }

      // 1. Get the player's current gaze direction in the horizontal plane (XZ)
      const camForward = new THREE.Vector3(0, 0, -1).applyQuaternion(camera.quaternion);
      camForward.y = 0;
      if (camForward.lengthSq() < 0.001) camForward.set(0, 0, -1);
      camForward.normalize();

      // 2. GUARANTEE SPAWN IN THE BLIND SPOT OUTSIDE CAMERA FIELD OF VIEW
      // Base blind spot is strictly behind the camera: camForward.clone().negate()
      // Pick a random rear angle (-65 degrees to +65 degrees behind the player)
      const rearAngleOffset = (Math.random() - 0.5) * (Math.PI * 0.72);
      const spawnDir = camForward
        .clone()
        .negate()
        .applyAxisAngle(new THREE.Vector3(0, 1, 0), rearAngleOffset)
        .normalize();

      // Spawn at 3.6m to 4.4m behind the player (far outside view, perfect for surprise dive)
      const spawnDist = 3.6 + Math.random() * 0.8;
      const initialPosition = camera.position.clone().add(spawnDir.clone().multiplyScalar(spawnDist));
      // Variable height from above or behind (1.1m to 2.8m)
      initialPosition.y = Math.max(1.1, Math.min(2.8, camera.position.y + (Math.random() - 0.25) * 1.5));

      // 3. Ambush Swoop Target: The mosquito swoops from the blind spot into the room space!
      // Pick a target in front or to the side of the player (1.7m to 2.8m away)
      const targetSideAngle = (Math.random() > 0.5 ? 1 : -1) * (0.35 + Math.random() * 0.9);
      const targetDir = camForward.clone().applyAxisAngle(new THREE.Vector3(0, 1, 0), targetSideAngle).normalize();
      const targetDist = 1.7 + Math.random() * 1.1;
      const ambushTargetPos = camera.position.clone().add(targetDir.multiplyScalar(targetDist));
      ambushTargetPos.y = camera.position.y + (Math.random() - 0.5) * 0.7;

      const scale = currentLvl === 1 ? 1.35 : 1.05;
      const speed = currentLvl === 1 ? 0.16 : 0.23;

      const mos = new Mosquito({
        id,
        isBoss: false,
        scale,
        speed,
        initialPosition,
        level: currentLvl,
        isAmbush: true,
        ambushTargetPos,
        assignedAngle: Math.atan2(ambushTargetPos.z - camera.position.z, ambushTargetPos.x - camera.position.x),
        assignedRadius: targetDist,
        preferredAltitudeOffset: (Math.random() - 0.5) * 0.6,
      });

      scene.add(mos.group);
      mosquitoes.push(mos);

      // Trigger audio pitch surge as it starts its surprise dive!
      buzzManager.triggerAttackFlutter(id);

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

    // Initialize level population with staggered ambush attacks
    const initLevelSpawns = () => {
      clearMosquitoes();
      currentKills = 0;
      accumulatedScreamTime = 0;
      ambushSpawnTimer = 0;

      if (stateRef.current.currentLevel === 3) {
        // Spawn Giant Boss in front
        spawnAmbushMosquito(true);
        // First surprise minion attack within 1.2s
        nextAmbushDelay = 1.2;
      } else {
        // First surprise attack launches after 0.5s from behind the player!
        nextAmbushDelay = 0.5;
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

      // Screen-space proximity fallback: guarantees that mosquitoes at farther distances (2.5m - 3.8m)
      // are effortlessly selectable with touch or click (80px radius tolerance)
      if (!hitTarget) {
        let bestDistancePx = 80;
        const screenPos = new THREE.Vector3();

        for (const mos of mosquitoes) {
          if (mos.isDead) continue;
          screenPos.setFromMatrixPosition(mos.group.matrixWorld);

          // Check if in front of camera
          const viewPos = screenPos.clone().applyMatrix4(camera.matrixWorldInverse);
          if (viewPos.z >= -0.15) continue; // Behind or right on the camera plane

          screenPos.project(camera);
          // Check if within viewport NDC bounds
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
          // Boss takes damage from taps but primarily needs scream
          buzzManager.playBossHurtSfx();
          sensorManager.triggerHaptic('bossHit');
          particles.emitSplat(hitPoint, true);
        } else {
          // Kill normal mosquito
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

        // Maintain mosquito population through surprise ambush attacks from blind spots
        ambushSpawnTimer += delta;
        const targetActiveCount = stateRef.current.currentLevel === 3 ? 5 : 7;
        const aliveCount = mosquitoes.filter((m) => !m.isDead).length;

        if (stateRef.current.currentLevel < 3) {
          const neededKills = stateRef.current.targetKills - currentKills;
          const maxAllowed = Math.min(targetActiveCount, neededKills);
          if (aliveCount < maxAllowed && ambushSpawnTimer >= nextAmbushDelay) {
            ambushSpawnTimer = 0;
            // Suspenseful, unpredictable ambush interval (1.4s to 2.8s)
            nextAmbushDelay = 1.4 + Math.random() * 1.4;
            spawnAmbushMosquito(false);
          }
        } else {
          // In level 3, minions perform surprise ambush attacks from blind spots
          if (aliveCount < targetActiveCount && ambushSpawnTimer >= nextAmbushDelay) {
            ambushSpawnTimer = 0;
            nextAmbushDelay = 2.0 + Math.random() * 2.2;
            spawnAmbushMosquito(false);
          }
        }

        // Update active mosquitoes
        const cameraMatrixInverse = camera.matrixWorldInverse;
        const cameraPos = camera.position;
        let minDistance = Infinity;
        let closestRelPos: THREE.Vector3 | null = null;

        // Collect active positions to enforce anti-clustering separation (never fly in groups)
        const alivePositions: THREE.Vector3[] = [];
        for (let k = 0; k < mosquitoes.length; k++) {
          if (!mosquitoes[k].isDead) alivePositions.push(mosquitoes[k].group.position);
        }

        for (let i = mosquitoes.length - 1; i >= 0; i--) {
          const mos = mosquitoes[i];
          mos.update(delta, now * 0.001, cameraPos, audio.volume, alivePositions);

          if (!mos.isDead) {
            // Calculate spatial audio position relative to camera view
            const relPos = mos.group.position.clone().applyMatrix4(cameraMatrixInverse);
            const speedFactor = stateRef.current.currentLevel === 2 ? 1.15 : 1.0;
            buzzManager.updateMosquitoBuzz(mos.id, relPos.x, relPos.y, relPos.z, mos.isBoss, speedFactor);

            const dist = relPos.length();
            if (dist < minDistance) {
              minDistance = dist;
              closestRelPos = relPos;
            }
          } else {
            // Dead mosquito animation timeout removal
            if (now - mos.deathTime > 900) {
              scene.remove(mos.group);
              mosquitoes.splice(i, 1);
            }
          }
        }

        // Radar guidance for visual location
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
      } else {
        // Paused or ended: stop all buzzing and clear radar
        buzzManager.stopAll();
        onNearestMosquitoUpdateRef.current?.(null);
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
