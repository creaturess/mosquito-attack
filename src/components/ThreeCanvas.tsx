/**
 * ThreeCanvas.tsx
 * Full-screen Three.js WebGL viewport:
 * - Fixed world nests separated >= 50° and >= 4m from each other, 5m to 12m away
 * - Max 1 mosquito per nest, max 3 active mosquitoes simultaneously (CONFIG.nests.maxActive = 3)
 * - 100% solid mosquitoes with distance-based scaling (no transparency fade)
 * - Smooth steering physics with 40°/s screen angular speed clamp and hovering pauses
 * - Never approaches closer than 3.0m to camera
 * - Audio PositionalAudio updated with the exact visual position in the same frame
 * - Generous ~0.48m hitbox
 */

import React, { useEffect, useRef } from 'react';
import * as THREE from 'three';
import { Mosquito } from '../entities/Mosquito';
import { ParticleSystem } from '../entities/ParticleSystem';
import { sensorManager } from '../sensors/SensorManager';
import { buzzManager } from '../audio/SpatialBuzzManager';
import { CONFIG } from '../config/gameplayConfig';

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
    renderer.setClearColor(0x000000, 0);
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    renderer.setSize(window.innerWidth, window.innerHeight);

    // --- 2. Lighting & AR Spotlight ---
    const ambientLight = new THREE.AmbientLight(0xffffff, 1.8);
    scene.add(ambientLight);

    const dirLight = new THREE.DirectionalLight(0xfff5ea, 1.4);
    dirLight.position.set(3, 6, 2);
    scene.add(dirLight);

    const flashlight = new THREE.SpotLight(0xfffaec, 2.5, 16, Math.PI / 4, 0.45, 1.2);
    flashlight.position.set(0, 0, 0);
    camera.add(flashlight);
    flashlight.target.position.set(0, 0, -1);
    camera.add(flashlight.target);

    // AudioListener attached to player camera
    const audioListener = new THREE.AudioListener();
    camera.add(audioListener);
    buzzManager.init(audioListener);

    scene.add(camera);

    // --- 3. Particle System ---
    const particles = new ParticleSystem();
    scene.add(particles.group);

    // --- 4. Debug 3D Group ---
    const debugGroup = new THREE.Group();
    debugGroup.visible = CONFIG.showDebug && isDebugModeRef.current;
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

    const clearMosquitoes = () => {
      mosquitoes.forEach((m) => {
        scene.remove(m.group);
        m.kill();
      });
      mosquitoes = [];
      bossInstance = null;

      while (debugGroup.children.length > 0) {
        const obj = debugGroup.children[0];
        debugGroup.remove(obj);
      }
      nests = [];
    };

    const rebuildDebugMeshes = () => {
      while (debugGroup.children.length > 0) {
        const obj = debugGroup.children[0];
        debugGroup.remove(obj);
      }

      if (!CONFIG.showDebug) return;

      nests.forEach((nest, idx) => {
        const sphereGeo = new THREE.IcosahedronGeometry(nest.radius, 1);
        const sphereMat = new THREE.MeshBasicMaterial({
          color: idx % 2 === 0 ? 0x22c55e : 0x06b6d4,
          wireframe: true,
        });
        const sphereMesh = new THREE.Mesh(sphereGeo, sphereMat);
        sphereMesh.position.copy(nest.position);
        debugGroup.add(sphereMesh);
      });
    };

    /**
     * ESCALA DE CUARTO (CONFIGURACIÓN DE NIDOS):
     * - 8 nidos distribuidos en 360° en 8 sectores (separación horizontal mínima de 45°)
     * - Distancia entre 2m y 5m
     * - Altura entre -0.5m y +2.0m respecto a la cámara
     * - 1 mosquito por nido
     * - Al inicio, activar 5 mosquitos garantizando al menos 2 en el semicírculo frontal (<= 120°)
     */
    const initLevelSpawns = () => {
      clearMosquitoes();
      currentKills = 0;
      accumulatedScreamTime = 0;
      const currentLvl = stateRef.current.currentLevel;
      const cfg = CONFIG;

      if (currentLvl === 3) {
        // Nivel 3: Jefe a 4m al frente
        const bossNestPos = new THREE.Vector3(0.0, camera.position.y + 0.3, -4.0);
        const bossMos = new Mosquito({
          id: `boss_${nextMosquitoId++}`,
          nestId: 'boss_nest',
          nestPosition: bossNestPos,
          nestRadius: 1.5,
          isBoss: true,
          scale: cfg.visibility.bossScale,
          speed: 0.35,
          level: 3,
        });
        scene.add(bossMos.group);
        mosquitoes.push(bossMos);
        bossInstance = bossMos;

        // 2 esbirros a 3.5m
        for (let i = 0; i < 2; i++) {
          const angle = (i === 0 ? 1 : -1) * (Math.PI * 0.4);
          const dist = 3.5;
          const nestPos = new THREE.Vector3(
            Math.cos(angle) * dist,
            camera.position.y + 0.2,
            Math.sin(angle) * dist
          );
          const nestId = `minion_nest_${i + 1}`;

          const minion = new Mosquito({
            id: `mosquito_${nextMosquitoId++}`,
            nestId,
            nestPosition: nestPos,
            nestRadius: cfg.nests.patrolRadius,
            scale: cfg.visibility.baseScale,
            speed: cfg.physics.maxSpeed,
            level: 3,
          });
          scene.add(minion.group);
          mosquitoes.push(minion);
          nests.push({ id: nestId, position: nestPos, radius: cfg.nests.patrolRadius, mosquitoIds: [minion.id] });
        }
      } else {
        // Niveles 1 y 2: Generar 8 nidos a escala de cuarto (2m a 5m)
        const totalNests = cfg.nests.count; // 8
        const sectorAngle = (Math.PI * 2) / totalNests; // 45°
        const minSeparationRad = (cfg.nests.nestMinSeparationAngleDeg * Math.PI) / 180; // 45°
        const generatedPositions: THREE.Vector3[] = [];

        for (let i = 0; i < totalNests; i++) {
          let attempts = 0;
          let chosenPos: THREE.Vector3 | null = null;

          while (attempts < 50 && !chosenPos) {
            attempts++;
            const baseAngle = i * sectorAngle;
            const jitter = (Math.random() - 0.5) * (sectorAngle * 0.3);
            const angle = baseAngle + jitter;

            // Distancia entre 2m y 5m
            const dist =
              cfg.nests.nestMinDistance +
              Math.random() * (cfg.nests.nestMaxDistance - cfg.nests.nestMinDistance);

            // Altura entre -0.5m y +2.0m respecto a la cámara
            const height =
              camera.position.y +
              (cfg.nests.minHeight + Math.random() * (cfg.nests.maxHeight - cfg.nests.minHeight));

            const candidate = new THREE.Vector3(
              Math.cos(angle) * dist,
              height,
              Math.sin(angle) * dist
            );

            // Validar separación angular horizontal mínima de 45°
            let valid = true;
            for (const existing of generatedPositions) {
              const angleCand = Math.atan2(candidate.z, candidate.x);
              const angleExist = Math.atan2(existing.z, existing.x);
              let diff = Math.abs(angleCand - angleExist);
              if (diff > Math.PI) diff = Math.PI * 2 - diff;
              if (diff < minSeparationRad) {
                valid = false;
                break;
              }
            }

            if (valid) {
              chosenPos = candidate;
            }
          }

          if (!chosenPos) {
            const fallbackAngle = i * sectorAngle;
            const fallbackDist = cfg.nests.nestMinDistance + 1.2;
            chosenPos = new THREE.Vector3(
              Math.cos(fallbackAngle) * fallbackDist,
              camera.position.y + (i % 2 === 0 ? 0.7 : 0.0),
              Math.sin(fallbackAngle) * fallbackDist
            );
          }

          generatedPositions.push(chosenPos);

          const nestId = `nest_${i + 1}`;
          nests.push({
            id: nestId,
            position: chosenPos,
            radius: cfg.nests.patrolRadius,
            mosquitoIds: [],
          });
        }

        // Población: 1 mosquito por nido (8 en total)
        // Al inicio, activar initialActive (5) mosquitos, garantizando al menos 2 en el semicírculo frontal (<= 120° del forward inicial (0,0,-1))
        const initialActiveTarget = Math.min(cfg.nests.initialActive, nests.length); // 5

        const frontalIndices: number[] = [];
        const otherIndices: number[] = [];

        nests.forEach((nest, idx) => {
          const dirHoriz = new THREE.Vector2(nest.position.x, nest.position.z).normalize();
          // forward inicial es (0, -1) en XZ
          const dot = -dirHoriz.y;
          const angleDeg = Math.acos(Math.max(-1, Math.min(1, dot))) * (180 / Math.PI);
          if (angleDeg <= 120) {
            frontalIndices.push(idx);
          } else {
            otherIndices.push(idx);
          }
        });

        const activeIndices = new Set<number>();
        // Tomar al menos 2 frontales
        frontalIndices.sort(() => Math.random() - 0.5);
        for (let i = 0; i < Math.min(2, frontalIndices.length); i++) {
          activeIndices.add(frontalIndices[i]);
        }

        // Llenar el resto hasta llegar a 5 activos
        const pool = [...frontalIndices.slice(2), ...otherIndices].sort(() => Math.random() - 0.5);
        for (const idx of pool) {
          if (activeIndices.size >= initialActiveTarget) break;
          activeIndices.add(idx);
        }

        for (let i = 0; i < nests.length; i++) {
          const nest = nests[i];
          const id = `mosquito_${nextMosquitoId++}`;
          nest.mosquitoIds.push(id);

          const mos = new Mosquito({
            id,
            nestId: nest.id,
            nestPosition: nest.position,
            nestRadius: nest.radius,
            scale: cfg.visibility.baseScale,
            speed: cfg.physics.maxSpeed,
            level: currentLvl,
          });

          // Los no seleccionados inician inactivos/muertos como reserva de respawn
          if (!activeIndices.has(i)) {
            mos.kill();
            mos.group.visible = false;
          }

          scene.add(mos.group);
          mosquitoes.push(mos);
        }
      }

      rebuildDebugMeshes();
    };

    initLevelSpawns();

    // --- 6. Raycasting for Touch / Mouse Swatting ---
    const raycaster = new THREE.Raycaster();
    const mousePos = new THREE.Vector2();

    const handleSwat = (clientX: number, clientY: number) => {
      buzzManager.resumeContext();
      if (!stateRef.current.isPlaying) return;

      mousePos.x = (clientX / window.innerWidth) * 2 - 1;
      mousePos.y = -(clientY / window.innerHeight) * 2 + 1;

      raycaster.setFromCamera(mousePos, camera);

      const hitObjects: THREE.Object3D[] = [];
      mosquitoes.forEach((m) => {
        if (!m.isDead && m.group.visible) {
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

      // Proximidad en pantalla con tolerancia generosa
      if (!hitTarget) {
        let bestDistancePx = CONFIG.combat.screenTouchTolerancePx;
        const screenPos = new THREE.Vector3();

        for (const mos of mosquitoes) {
          if (mos.isDead || !mos.group.visible) continue;
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
          hitTarget.group.visible = false;
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
      handleSwat(e.clientX, e.clientY);
    };

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

    window.addEventListener('keydown', handleKeyDown);
    window.addEventListener('wheel', handleWheel, { passive: true });

    const handleResize = () => {
      const width = window.innerWidth;
      const height = window.innerHeight;
      camera.aspect = width / height;
      camera.updateProjectionMatrix();
      renderer.setSize(width, height);
      renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    };
    window.addEventListener('resize', handleResize);

    // --- 7. Animation Loop ---
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

      debugGroup.visible = CONFIG.showDebug && isDebugModeRef.current;

      const now = performance.now();
      const delta = Math.min((now - lastTime) / 1000, 0.05);
      lastTime = now;

      const { orientation, position, audio } = sensorManager.update();

      camera.rotation.order = 'YXZ';
      camera.rotation.y = orientation.yawRad;
      camera.rotation.x = orientation.pitchRad;
      camera.rotation.z = orientation.rollRad;

      camera.position.set(position.x, position.y, position.z);
      camera.updateMatrixWorld();

      const camForward = new THREE.Vector3(0, 0, -1).applyQuaternion(camera.quaternion).normalize();

      if (stateRef.current.isPlaying) {
        // Boss scream mechanic
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

        const targetConeDot = Math.cos((14 * Math.PI) / 180);

        // SISTEMA DIRECTOR:
        // Asegura que siempre haya juego (mínimo minActive = 4, máximo maxActive = 6).
        // Respawn sólo en nidos fuera del campo de visión (ángulo > 50° respecto a camForward)
        // para que ningún mosquito aparezca o se materialice en la vista del jugador.
        let aliveMosquitoes = mosquitoes.filter((m) => !m.isDead);
        let aliveCount = aliveMosquitoes.length;

        if (aliveCount < CONFIG.nests.maxActive) {
          const isBelowMin = aliveCount < CONFIG.nests.minActive;
          const deadMosquitoes = mosquitoes.filter((m) => m.isDead);

          for (const deadMos of deadMosquitoes) {
            const timeSinceDeath = now - deadMos.deathTime;
            // Espera mínima de 1.5s tras morir
            if (timeSinceDeath < CONFIG.nests.respawnDelaySec * 1000) continue;

            // Nido fuera del campo de visión (ángulo > 50° respecto al forward de la cámara)
            const dirToNest = deadMos.nestPosition.clone().sub(cameraPos).normalize();
            const angleToCamDeg = (camForward.angleTo(dirToNest) * 180) / Math.PI;

            if (angleToCamDeg > 50 || (isBelowMin && timeSinceDeath > 3500)) {
              deadMos.respawnAtNest();
              aliveCount++;
              if (aliveCount >= CONFIG.nests.maxActive) break;
            }
          }
        }

        // Actualizar todos los mosquitos activos
        for (let i = 0; i < mosquitoes.length; i++) {
          const mos = mosquitoes[i];
          if (!mos.isDead) {
            mos.update(delta, now * 0.001, cameraPos, camForward);

            const dist = mos.group.position.distanceTo(cameraPos);
            if (dist < minDistance && mos.group.visible) {
              minDistance = dist;
              closestRelPos = mos.group.position.clone().applyMatrix4(cameraMatrixInverse);
            }

            // Detección de puntería para haptic feedback
            const dirToMos = mos.group.position.clone().sub(cameraPos).normalize();
            const dot = camForward.dot(dirToMos);
            if (dot > targetConeDot && dist < 6.0 && mos.group.visible) {
              isAimingNear = true;
            }
          }
        }

        // Haptic feedback suave al apuntar
        if (isAimingNear && navigator.vibrate && now - lastVibrateTime > 400) {
          try {
            navigator.vibrate(25);
          } catch {
            // Ignorado si el navegador bloquea vibración
          }
          lastVibrateTime = now;
        }

        // Radar guidance (solo si el HUD lo necesitara)
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

        // Debug info update
        if (CONFIG.showDebug) {
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
        }
      } else {
        buzzManager.stopAll();
        onNearestMosquitoUpdateRef.current?.(null);
      }

      particles.update(delta, audio.volume);
      renderer.render(scene, camera);
    };

    animationFrameId = requestAnimationFrame(animate);

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
