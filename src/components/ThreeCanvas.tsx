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

    // --- 1. Scene, Camera, Renderer ---
    const scene = new THREE.Scene();
    scene.fog = new THREE.FogExp2(0x060913, 0.04);

    const camera = new THREE.PerspectiveCamera(
      70,
      window.innerWidth / window.innerHeight,
      0.1,
      100
    );
    camera.position.set(0, 0, 0);

    const renderer = new THREE.WebGLRenderer({
      canvas: canvasRef.current,
      antialias: true,
      alpha: true,
      powerPreference: 'high-performance',
    });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    renderer.setSize(window.innerWidth, window.innerHeight);

    // --- 2. Lighting ---
    // Ambient moonlit blue tint
    const ambientLight = new THREE.AmbientLight(0x243354, 0.9);
    scene.add(ambientLight);

    // Flashlight attached to camera
    const flashlight = new THREE.SpotLight(0xfff7e6, 3.5, 25, Math.PI / 4, 0.5, 1.2);
    flashlight.position.set(0, 0, 0);
    camera.add(flashlight);
    flashlight.target.position.set(0, 0, -1);
    camera.add(flashlight.target);
    scene.add(camera);

    // --- 3. Room Environment (Visible in Non-AR Mode) ---
    const roomGroup = new THREE.Group();

    // Dark bedroom cube with subtle grid wallpaper & furniture silhouettes
    const roomGeo = new THREE.BoxGeometry(22, 14, 22);
    const roomMat = new THREE.MeshStandardMaterial({
      color: 0x090e1a,
      roughness: 0.9,
      metalness: 0.1,
      side: THREE.BackSide,
    });
    const roomMesh = new THREE.Mesh(roomGeo, roomMat);
    roomGroup.add(roomMesh);

    // Floor texture
    const floorGeo = new THREE.PlaneGeometry(22, 22);
    floorGeo.rotateX(-Math.PI / 2);
    const floorMat = new THREE.MeshStandardMaterial({
      color: 0x05070f,
      roughness: 0.7,
    });
    const floorMesh = new THREE.Mesh(floorGeo, floorMat);
    floorMesh.position.y = -6.9;
    roomGroup.add(floorMesh);

    // Window with dim moonlight silhouette
    const windowGeo = new THREE.PlaneGeometry(4, 5);
    const windowMat = new THREE.MeshBasicMaterial({
      color: 0x1e3a5f,
      side: THREE.DoubleSide,
    });
    const windowMesh = new THREE.Mesh(windowGeo, windowMat);
    windowMesh.position.set(0, 0.5, -10.9);
    roomGroup.add(windowMesh);

    // Ceiling fan silhouette
    const fanCenterGeo = new THREE.CylinderGeometry(0.5, 0.5, 0.2, 12);
    const fanMat = new THREE.MeshBasicMaterial({ color: 0x111827 });
    const fanCenter = new THREE.Mesh(fanCenterGeo, fanMat);
    fanCenter.position.set(0, 6.8, 0);
    roomGroup.add(fanCenter);

    scene.add(roomGroup);

    // --- 4. Video Texture for AR Camera (when active) ---
    let videoTexture: THREE.VideoTexture | null = null;
    let arBackgroundMesh: THREE.Mesh | null = null;

    const setupARBackground = () => {
      if (videoElementRef.current && isARModeRef.current) {
        if (!videoTexture) {
          videoTexture = new THREE.VideoTexture(videoElementRef.current);
          videoTexture.minFilter = THREE.LinearFilter;
          videoTexture.magFilter = THREE.LinearFilter;
        }
        if (!arBackgroundMesh) {
          const bgGeo = new THREE.PlaneGeometry(2, 2);
          const bgMat = new THREE.MeshBasicMaterial({
            map: videoTexture,
            depthTest: false,
            depthWrite: false,
          });
          arBackgroundMesh = new THREE.Mesh(bgGeo, bgMat);
          arBackgroundMesh.renderOrder = -100;
          // Orthographic background or camera fixed plane
          const bgScene = new THREE.Scene();
          const bgCam = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
          bgScene.add(arBackgroundMesh);
          return { bgScene, bgCam };
        }
      }
      return null;
    };

    // --- 5. Particle System ---
    const particles = new ParticleSystem();
    scene.add(particles.group);

    // --- 6. Mosquito Population Management ---
    let mosquitoes: Mosquito[] = [];
    let nextMosquitoId = 1;
    let spawnTimer = 0;
    let currentKills = 0;
    let accumulatedScreamTime = 0;
    let bossInstance: Mosquito | null = null;

    // Helper to spawn a mosquito
    const spawnMosquito = (isBoss: boolean = false) => {
      const id = `mosquito_${nextMosquitoId++}`;
      let scale = 0.85;
      let speed = 1.0;

      if (stateRef.current.currentLevel === 1) {
        scale = 0.9;
        speed = 1.1;
      } else if (stateRef.current.currentLevel === 2) {
        scale = 0.65; // Smaller
        speed = 1.6; // Faster
      } else if (stateRef.current.currentLevel === 3) {
        if (isBoss) {
          scale = 3.6; // Giant Final Boss
          speed = 0.6;
        } else {
          scale = Math.random() > 0.5 ? 0.85 : 0.65;
          speed = 1.3;
        }
      }

      const mos = new Mosquito({
        id,
        isBoss,
        scale,
        speed,
        spawnDistance: isBoss ? 5.2 : 3.8 + Math.random() * 3.0,
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
          spawnMosquito(false);
        }
      } else {
        // Initial wave of 5 mosquitoes, replenish as killed
        for (let i = 0; i < 5; i++) {
          spawnMosquito(false);
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

    // Touch & pointer events
    const onPointerDown = (e: PointerEvent) => {
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
      // Only drag if left click held and dragging
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

    const animate = () => {
      animationFrameId = requestAnimationFrame(animate);

      const now = performance.now();
      const delta = Math.min((now - lastTime) / 1000, 0.1);
      lastTime = now;

      // Update sensors
      const { orientation, audio } = sensorManager.update();

      // Camera rotation: Euler order YXZ (Yaw, Pitch, Roll)
      camera.rotation.order = 'YXZ';
      camera.rotation.y = orientation.yawRad;
      camera.rotation.x = orientation.pitchRad;
      camera.rotation.z = orientation.rollRad;

      // Toggle room visibility based on AR mode
      roomGroup.visible = !isARModeRef.current;

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

        // Maintain mosquito population
        spawnTimer += delta;
        const targetActiveCount = stateRef.current.currentLevel === 3 ? 5 : 5;
        const aliveCount = mosquitoes.filter((m) => !m.isDead).length;

        if (aliveCount < targetActiveCount && spawnTimer > 0.8) {
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
            const speedFactor = stateRef.current.currentLevel === 2 ? 1.5 : 1.0;
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
      window.removeEventListener('mouseup', onMouseUp);
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
