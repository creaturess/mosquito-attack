/**
 * FieldCanvas.tsx
 * MODO CAMPO (Field Mode) 3D Viewport:
 * - Lush, realistic 3D outdoor meadow with rolling terrain, tall green grass, wildflowers, composite trees
 * - Golden afternoon sky, warm directional lighting, soft distant atmospheric fog, drifting pollen
 * - First-Person walk & explore navigation:
 *   - PC: WASD / Arrow keys + Mouse look
 *   - Mobile: Virtual floating joystick for walking + right-screen swipe to look
 * - Fruit Ninja blade swipe slicing for killing mosquitoes
 * - Mosquitos flying in from far away in the meadow, circling and buzzing in 3D binaural stereo
 * - Level 1 (20 kills), Level 2 (15 fast kills), Level 3 (Giant Final Boss defeated by screaming)
 */

import React, { useEffect, useRef, useState, useCallback } from 'react';
import * as THREE from 'three';
import { FieldMosquito } from '../entities/FieldMosquito';
import { BladeSwipeDetector, MosquitoSliceManager, MosquitoScreenTarget } from './ThreeCanvas';
import { buzzManager } from '../audio/SpatialBuzzManager';
import { sensorManager } from '../sensors/SensorManager';
import { GameState } from './ThreeCanvas';

interface FieldCanvasProps {
  gameState: GameState;
  onKill: (newKills: number, isBoss: boolean) => void;
  onLevelComplete: () => void;
  onGameOver: (reason: string) => void;
  onScreamProgress: (accumulatedSec: number) => void;
  onReturnToMenu?: () => void;
}

// Procedural Terrain Height Helper
export function getTerrainHeight(x: number, z: number): number {
  const distFromCenter = Math.hypot(x, z);
  // Flatten slightly near initial spawn
  const centerFlatten = Math.min(1.0, distFromCenter / 12.0);

  const baseHill =
    Math.sin(x * 0.055) * 1.1 +
    Math.cos(z * 0.045) * 0.95 +
    Math.sin((x + z) * 0.08) * 0.45;

  // Perimeter rim hills naturally enclosing the meadow
  const perimeterRise = distFromCenter > 38 ? Math.pow((distFromCenter - 38) * 0.16, 2) * 0.5 : 0;

  return (baseHill * centerFlatten + perimeterRise);
}

export const FieldCanvas: React.FC<FieldCanvasProps> = ({
  gameState,
  onKill,
  onLevelComplete,
  onGameOver,
  onScreamProgress,
  onReturnToMenu,
}) => {
  const containerRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const bladeCanvasRef = useRef<HTMLCanvasElement>(null);

  // Synchronized state references
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

  // Touch virtual joystick state for mobile
  const [touchActive, setTouchActive] = useState(false);
  const [joystickThumb, setJoystickThumb] = useState<{ x: number; y: number }>({ x: 0, y: 0 });
  const joystickCenterRef = useRef<{ x: number; y: number }>({ x: 0, y: 0 });
  const joystickTouchIdRef = useRef<number | null>(null);
  const lookTouchIdRef = useRef<number | null>(null);
  const lastLookPosRef = useRef<{ x: number; y: number }>({ x: 0, y: 0 });

  // Virtual joystick movement vector [-1..1]
  const joystickMoveRef = useRef<{ x: number; y: number }>({ x: 0, y: 0 });

  useEffect(() => {
    if (!canvasRef.current || !containerRef.current || !bladeCanvasRef.current) return;

    const width = containerRef.current.clientWidth || window.innerWidth;
    const height = containerRef.current.clientHeight || window.innerHeight;

    // --- 1. Scene, Camera, Renderer ---
    const scene = new THREE.Scene();
    scene.background = new THREE.Color(0xdceee2);
    // Soft golden-green atmospheric distant fog
    scene.fog = new THREE.FogExp2(0xd6e5c8, 0.016);

    const camera = new THREE.PerspectiveCamera(70, width / height, 0.1, 180);

    const renderer = new THREE.WebGLRenderer({
      canvas: canvasRef.current,
      antialias: true,
      powerPreference: 'high-performance',
    });
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.15;
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    renderer.setSize(width, height);
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = THREE.PCFSoftShadowMap;

    bladeCanvasRef.current.width = width;
    bladeCanvasRef.current.height = height;

    // --- 2. Blade Swipe & Slice Manager ---
    const bladeDetector = new BladeSwipeDetector(bladeCanvasRef.current);
    const sliceManager = new MosquitoSliceManager(scene, camera);

    // --- 3. Lighting (Warm Afternoon Golden Light) ---
    // Warm hemisphere ambient light
    const hemiLight = new THREE.HemisphereLight(0xffecd4, 0x245422, 0.85);
    scene.add(hemiLight);

    // Main warm afternoon sun
    const sunLight = new THREE.DirectionalLight(0xfff1dc, 1.8);
    sunLight.position.set(50, 45, -60);
    sunLight.castShadow = true;
    sunLight.shadow.mapSize.width = 1024;
    sunLight.shadow.mapSize.height = 1024;
    sunLight.shadow.camera.near = 10;
    sunLight.shadow.camera.far = 160;
    const d = 35;
    sunLight.shadow.camera.left = -d;
    sunLight.shadow.camera.right = d;
    sunLight.shadow.camera.top = d;
    sunLight.shadow.camera.bottom = -d;
    sunLight.shadow.bias = -0.0006;
    scene.add(sunLight);

    // Soft sky dome with afternoon horizon gradient
    const skyGeom = new THREE.SphereGeometry(140, 24, 16);
    const skyMat = new THREE.ShaderMaterial({
      side: THREE.BackSide,
      depthWrite: false,
      vertexShader: `
        varying vec3 vWorldPosition;
        void main() {
          vec4 worldPos = modelMatrix * vec4(position, 1.0);
          vWorldPosition = worldPos.xyz;
          gl_Position = projectionMatrix * viewMatrix * worldPos;
        }
      `,
      fragmentShader: `
        varying vec3 vWorldPosition;
        void main() {
          vec3 dir = normalize(vWorldPosition);
          float y = dir.y;
          // Gradient from warm golden horizon to vibrant afternoon sky
          vec3 skyTop = vec3(0.32, 0.58, 0.92);
          vec3 skyMid = vec3(0.58, 0.78, 0.95);
          vec3 skyHorizon = vec3(0.96, 0.88, 0.75);
          vec3 groundHaze = vec3(0.84, 0.90, 0.80);

          vec3 col;
          if (y > 0.0) {
            col = mix(skyHorizon, skyTop, pow(y, 0.65));
          } else {
            col = mix(skyHorizon, groundHaze, clamp(-y * 3.0, 0.0, 1.0));
          }
          gl_FragColor = vec4(col, 1.0);
        }
      `,
    });
    const skyMesh = new THREE.Mesh(skyGeom, skyMat);
    scene.add(skyMesh);

    // --- 4. Procedural Meadow Terrain ---
    const terrainSize = 150;
    const terrainSegments = 80;
    const terrainGeom = new THREE.PlaneGeometry(terrainSize, terrainSize, terrainSegments, terrainSegments);
    terrainGeom.rotateX(-Math.PI / 2);

    const posAttr = terrainGeom.getAttribute('position') as THREE.BufferAttribute;
    for (let i = 0; i < posAttr.count; i++) {
      const vx = posAttr.getX(i);
      const vz = posAttr.getZ(i);
      posAttr.setY(i, getTerrainHeight(vx, vz));
    }
    terrainGeom.computeVertexNormals();

    // Procedural lush grass texture via HTML5 canvas
    const canvasTex = document.createElement('canvas');
    canvasTex.width = 512;
    canvasTex.height = 512;
    const ctx = canvasTex.getContext('2d');
    if (ctx) {
      // Base vibrant meadow green
      ctx.fillStyle = '#2f6828';
      ctx.fillRect(0, 0, 512, 512);

      // Noise & flecks
      for (let i = 0; i < 4000; i++) {
        const nx = Math.random() * 512;
        const ny = Math.random() * 512;
        const radius = Math.random() * 2.5 + 1;
        const shade = Math.random();
        if (shade > 0.6) {
          ctx.fillStyle = '#3e8433';
        } else if (shade > 0.3) {
          ctx.fillStyle = '#265420';
        } else {
          ctx.fillStyle = '#4f9b42';
        }
        ctx.beginPath();
        ctx.arc(nx, ny, radius, 0, Math.PI * 2);
        ctx.fill();
      }
    }
    const groundTexture = new THREE.CanvasTexture(canvasTex);
    groundTexture.wrapS = THREE.RepeatWrapping;
    groundTexture.wrapT = THREE.RepeatWrapping;
    groundTexture.repeat.set(24, 24);
    groundTexture.colorSpace = THREE.SRGBColorSpace;

    const terrainMat = new THREE.MeshStandardMaterial({
      map: groundTexture,
      roughness: 0.92,
      metalness: 0.04,
      flatShading: false,
    });
    const terrainMesh = new THREE.Mesh(terrainGeom, terrainMat);
    terrainMesh.receiveShadow = true;
    scene.add(terrainMesh);

    // --- 5. Tall Green Grass Tufts (InstancedMesh) ---
    const grassCount = 2800;
    // Cross-plane grass blade geometry
    const bladeGeom = new THREE.PlaneGeometry(0.55, 1.1, 1, 2);
    bladeGeom.translate(0, 0.55, 0);

    const grassMat = new THREE.MeshStandardMaterial({
      color: 0x4aa63b,
      roughness: 0.85,
      metalness: 0.02,
      side: THREE.DoubleSide,
    });
    const grassInstanced = new THREE.InstancedMesh(bladeGeom, grassMat, grassCount);
    grassInstanced.receiveShadow = true;

    const dummy = new THREE.Object3D();
    const grassColor = new THREE.Color();
    const grassPalette = [0x3d8c32, 0x4aa63b, 0x58bf47, 0x2e6e25, 0x6ac955];

    for (let i = 0; i < grassCount; i++) {
      const radius = 2.0 + Math.pow(Math.random(), 0.75) * 44;
      const angle = Math.random() * Math.PI * 2;
      const gx = Math.cos(angle) * radius;
      const gz = Math.sin(angle) * radius;
      const gy = getTerrainHeight(gx, gz);

      dummy.position.set(gx, gy, gz);
      dummy.rotation.y = Math.random() * Math.PI * 2;
      dummy.rotation.x = (Math.random() - 0.5) * 0.18;
      dummy.rotation.z = (Math.random() - 0.5) * 0.18;

      const scaleY = 0.8 + Math.random() * 0.65;
      dummy.scale.set(0.9 + Math.random() * 0.4, scaleY, 0.9 + Math.random() * 0.4);
      dummy.updateMatrix();

      grassInstanced.setMatrixAt(i, dummy.matrix);

      grassColor.setHex(grassPalette[Math.floor(Math.random() * grassPalette.length)]);
      grassInstanced.setColorAt(i, grassColor);
    }
    grassInstanced.instanceMatrix.needsUpdate = true;
    if (grassInstanced.instanceColor) grassInstanced.instanceColor.needsUpdate = true;
    scene.add(grassInstanced);

    // --- 6. Wildflowers (Poppies, Dandelions, Cornflowers, Daisies) ---
    const flowerCount = 500;
    const flowerGeom = new THREE.SphereGeometry(0.12, 6, 6);
    const flowerMat = new THREE.MeshStandardMaterial({
      roughness: 0.6,
      metalness: 0.05,
    });
    const flowerInstanced = new THREE.InstancedMesh(flowerGeom, flowerMat, flowerCount);

    const flowerColors = [
      0xef4444, // Red poppy
      0xfacc15, // Yellow buttercup/dandelion
      0xa855f7, // Purple wildflower
      0xffffff, // White daisy
      0xf97316, // Orange wild marigold
    ];
    const flowerColor = new THREE.Color();

    for (let i = 0; i < flowerCount; i++) {
      const radius = 3.0 + Math.pow(Math.random(), 0.8) * 42;
      const angle = Math.random() * Math.PI * 2;
      const fx = Math.cos(angle) * radius;
      const fz = Math.sin(angle) * radius;
      const fy = getTerrainHeight(fx, fz) + 0.35 + Math.random() * 0.4;

      dummy.position.set(fx, fy, fz);
      dummy.scale.setScalar(0.7 + Math.random() * 0.8);
      dummy.updateMatrix();

      flowerInstanced.setMatrixAt(i, dummy.matrix);
      flowerColor.setHex(flowerColors[Math.floor(Math.random() * flowerColors.length)]);
      flowerInstanced.setColorAt(i, flowerColor);
    }
    flowerInstanced.instanceMatrix.needsUpdate = true;
    if (flowerInstanced.instanceColor) flowerInstanced.instanceColor.needsUpdate = true;
    scene.add(flowerInstanced);

    // --- 7. Procedural Composite Trees ---
    const treeGroup = new THREE.Group();
    const treeTrunkMat = new THREE.MeshStandardMaterial({
      color: 0x4a3728,
      roughness: 0.95,
      metalness: 0.02,
    });
    const treeFoliageColors = [0x2d6a4f, 0x40916c, 0x1b4332, 0x52b788];

    const createTree = (tx: number, tz: number, scale: number = 1.0) => {
      const tree = new THREE.Group();
      const ty = getTerrainHeight(tx, tz);
      tree.position.set(tx, ty, tz);

      // Trunk
      const trunkHeight = 4.2 * scale;
      const trunkGeom = new THREE.CylinderGeometry(0.35 * scale, 0.65 * scale, trunkHeight, 7);
      trunkGeom.translate(0, trunkHeight * 0.5, 0);
      const trunkMesh = new THREE.Mesh(trunkGeom, treeTrunkMat);
      trunkMesh.castShadow = true;
      trunkMesh.receiveShadow = true;
      tree.add(trunkMesh);

      // Canopy layers (3 to 4 intersecting organic spheres)
      const foliageMat = new THREE.MeshStandardMaterial({
        color: treeFoliageColors[Math.floor(Math.random() * treeFoliageColors.length)],
        roughness: 0.88,
        metalness: 0.02,
        flatShading: true,
      });

      const canopyCount = 3 + Math.floor(Math.random() * 2);
      for (let c = 0; c < canopyCount; c++) {
        const rad = (1.8 + Math.random() * 0.8) * scale;
        const folGeom = new THREE.SphereGeometry(rad, 7, 6);
        const folMesh = new THREE.Mesh(folGeom, foliageMat);
        folMesh.position.set(
          (Math.random() - 0.5) * 1.2 * scale,
          trunkHeight + (c * 1.2 - 0.2) * scale,
          (Math.random() - 0.5) * 1.2 * scale
        );
        folMesh.scale.set(1.0 + Math.random() * 0.2, 0.9 + Math.random() * 0.3, 1.0 + Math.random() * 0.2);
        folMesh.castShadow = true;
        folMesh.receiveShadow = true;
        tree.add(folMesh);
      }

      return tree;
    };

    // Scatter trees: near clumps and perimeter forest ring
    const treePositions: [number, number, number][] = [
      // Close clusters
      [-16, -14, 1.1],
      [18, -12, 1.2],
      [-22, 16, 1.0],
      [24, 18, 1.25],
      [-12, 22, 0.95],
      [14, -24, 1.15],
      [-28, -6, 1.3],
      [26, -5, 1.2],
    ];

    // Perimeter grove ring
    for (let i = 0; i < 28; i++) {
      const angle = (i / 28) * Math.PI * 2 + (Math.random() - 0.5) * 0.15;
      const dist = 38 + Math.random() * 18;
      treePositions.push([Math.cos(angle) * dist, Math.sin(angle) * dist, 1.1 + Math.random() * 0.4]);
    }

    treePositions.forEach(([x, z, s]) => {
      treeGroup.add(createTree(x, z, s));
    });
    scene.add(treeGroup);

    // --- 8. Floating Golden Pollen Particles ---
    const pollenCount = 180;
    const pollenGeom = new THREE.BufferGeometry();
    const pollenPositions = new Float32Array(pollenCount * 3);
    for (let i = 0; i < pollenCount; i++) {
      pollenPositions[i * 3 + 0] = (Math.random() - 0.5) * 60;
      pollenPositions[i * 3 + 1] = 1.0 + Math.random() * 5.0;
      pollenPositions[i * 3 + 2] = (Math.random() - 0.5) * 60;
    }
    pollenGeom.setAttribute('position', new THREE.BufferAttribute(pollenPositions, 3));
    const pollenMat = new THREE.PointsMaterial({
      color: 0xfef08a,
      size: 0.08,
      transparent: true,
      opacity: 0.65,
      blending: THREE.AdditiveBlending,
    });
    const pollenPoints = new THREE.Points(pollenGeom, pollenMat);
    scene.add(pollenPoints);

    // --- 9. First-Person Player Navigation State ---
    const player = {
      position: new THREE.Vector3(0, 0, 0),
      velocity: new THREE.Vector3(0, 0, 0),
      yaw: 0,
      pitch: 0,
      eyeHeight: 1.65,
      walkSpeed: 6.8,
    };
    player.position.y = getTerrainHeight(0, 0) + player.eyeHeight;
    camera.position.copy(player.position);

    // Keyboard states for PC
    const keys = {
      w: false,
      a: false,
      s: false,
      d: false,
      ArrowUp: false,
      ArrowLeft: false,
      ArrowDown: false,
      ArrowRight: false,
    };

    const handleKeyDown = (e: KeyboardEvent) => {
      const k = e.key.toLowerCase();
      if (k === 'w' || k === 'arrowup') keys.w = true;
      if (k === 'a' || k === 'arrowleft') keys.a = true;
      if (k === 's' || k === 'arrowdown') keys.s = true;
      if (k === 'd' || k === 'arrowright') keys.d = true;
    };

    const handleKeyUp = (e: KeyboardEvent) => {
      const k = e.key.toLowerCase();
      if (k === 'w' || k === 'arrowup') keys.w = false;
      if (k === 'a' || k === 'arrowleft') keys.a = false;
      if (k === 's' || k === 'arrowdown') keys.s = false;
      if (k === 'd' || k === 'arrowright') keys.d = false;
    };

    window.addEventListener('keydown', handleKeyDown);
    window.addEventListener('keyup', handleKeyUp);

    // Mouse look state (PC drag or click)
    let isMouseDown = false;
    let lastMouseX = 0;
    let lastMouseY = 0;

    const handleMouseDown = (e: MouseEvent) => {
      // Ignore if clicking on UI overlay buttons
      if ((e.target as HTMLElement)?.closest('[data-no-swat="true"]')) return;
      isMouseDown = true;
      lastMouseX = e.clientX;
      lastMouseY = e.clientY;
      bladeDetector.addPoint(e.clientX, e.clientY);
    };

    const handleMouseMove = (e: MouseEvent) => {
      bladeDetector.addPoint(e.clientX, e.clientY);

      if (isMouseDown) {
        const dx = e.clientX - lastMouseX;
        const dy = e.clientY - lastMouseY;
        lastMouseX = e.clientX;
        lastMouseY = e.clientY;

        player.yaw -= dx * 0.0032;
        player.pitch -= dy * 0.0032;
        player.pitch = Math.max(-1.3, Math.min(1.3, player.pitch));
      }
    };

    const handleMouseUp = () => {
      isMouseDown = false;
      bladeDetector.endStroke();
    };

    const containerEl = containerRef.current;
    containerEl.addEventListener('mousedown', handleMouseDown);
    window.addEventListener('mousemove', handleMouseMove);
    window.addEventListener('mouseup', handleMouseUp);

    // --- 10. Mobile Touch Look & Fruit Ninja Swipe Handling ---
    const handleTouchStart = (e: TouchEvent) => {
      for (let i = 0; i < e.changedTouches.length; i++) {
        const touch = e.changedTouches[i];
        // If on right half of screen, treat as camera look drag
        if (touch.clientX > window.innerWidth * 0.42 && lookTouchIdRef.current === null) {
          lookTouchIdRef.current = touch.identifier;
          lastLookPosRef.current = { x: touch.clientX, y: touch.clientY };
        }
        bladeDetector.addPoint(touch.clientX, touch.clientY);
      }
    };

    const handleTouchMove = (e: TouchEvent) => {
      for (let i = 0; i < e.changedTouches.length; i++) {
        const touch = e.changedTouches[i];
        if (touch.identifier === lookTouchIdRef.current) {
          const dx = touch.clientX - lastLookPosRef.current.x;
          const dy = touch.clientY - lastLookPosRef.current.y;
          lastLookPosRef.current = { x: touch.clientX, y: touch.clientY };

          player.yaw -= dx * 0.0042;
          player.pitch -= dy * 0.0042;
          player.pitch = Math.max(-1.3, Math.min(1.3, player.pitch));
        }
        bladeDetector.addPoint(touch.clientX, touch.clientY);
      }
    };

    const handleTouchEnd = (e: TouchEvent) => {
      for (let i = 0; i < e.changedTouches.length; i++) {
        const touch = e.changedTouches[i];
        if (touch.identifier === lookTouchIdRef.current) {
          lookTouchIdRef.current = null;
        }
      }
      bladeDetector.endStroke();
    };

    containerEl.addEventListener('touchstart', handleTouchStart, { passive: true });
    containerEl.addEventListener('touchmove', handleTouchMove, { passive: true });
    containerEl.addEventListener('touchend', handleTouchEnd, { passive: true });

    // --- 11. Mosquitoes in Field Mode ---
    const mosquitoes: FieldMosquito[] = [];
    let killsThisLevel = 0;
    const targetKills = stateRef.current.targetKills;
    const currentLevel = stateRef.current.currentLevel;

    // Spawning waves from far away in the meadow (18m to 35m)
    let spawnTimer = 0;
    let totalSpawned = 0;
    const maxSimultaneous = currentLevel === 3 ? 1 : currentLevel === 2 ? 4 : 3;

    const spawnFieldMosquito = () => {
      if (totalSpawned >= targetKills) return;

      const id = `field_mosq_${Date.now()}_${Math.random().toString(36).substring(2, 6)}`;
      const angle = Math.random() * Math.PI * 2;
      // Spawn far away in the meadow
      const spawnDist = currentLevel === 3 ? 32 : 20 + Math.random() * 12;
      const sx = player.position.x + Math.cos(angle) * spawnDist;
      const sz = player.position.z + Math.sin(angle) * spawnDist;
      const groundY = getTerrainHeight(sx, sz);
      const sy = groundY + (currentLevel === 3 ? 3.5 : 1.8 + Math.random() * 2.0);

      const mosq = new FieldMosquito({
        id,
        spawnPosition: new THREE.Vector3(sx, sy, sz),
        playerInitialPos: player.position,
        isBoss: currentLevel === 3,
        level: currentLevel,
      });

      mosquitoes.push(mosq);
      scene.add(mosq.group);
      scene.add(mosq.trailLine);
      totalSpawned++;
    };

    // Initial batch spawn from afar
    if (currentLevel === 3) {
      spawnFieldMosquito(); // Giant Boss
    } else {
      spawnFieldMosquito();
      spawnFieldMosquito();
    }

    // --- 12. Main Animation Loop ---
    let animFrameId: number;
    let lastTime = performance.now();
    let screamAccumulator = 0;

    const tick = () => {
      animFrameId = requestAnimationFrame(tick);

      const now = performance.now();
      const delta = Math.min((now - lastTime) / 1000, 0.1);
      lastTime = now;

      // 1. Update Player Movement (Keyboard + Virtual Joystick)
      let moveForward = 0;
      let moveRight = 0;

      if (keys.w) moveForward += 1;
      if (keys.s) moveForward -= 1;
      if (keys.d) moveRight += 1;
      if (keys.a) moveRight -= 1;

      // Virtual Joystick input
      moveRight += joystickMoveRef.current.x;
      moveForward -= joystickMoveRef.current.y;

      // Normalize movement vector
      const moveLen = Math.hypot(moveForward, moveRight);
      if (moveLen > 1.0) {
        moveForward /= moveLen;
        moveRight /= moveLen;
      }

      // Compute world direction based on camera yaw
      const forwardDir = new THREE.Vector3(-Math.sin(player.yaw), 0, -Math.cos(player.yaw));
      const rightDir = new THREE.Vector3(Math.cos(player.yaw), 0, -Math.sin(player.yaw));

      const targetVel = new THREE.Vector3()
        .addScaledVector(forwardDir, moveForward * player.walkSpeed)
        .addScaledVector(rightDir, moveRight * player.walkSpeed);

      player.velocity.lerp(targetVel, delta * 9.0);
      player.position.addScaledVector(player.velocity, delta);

      // Clamp player within playable meadow perimeter (radius 44m)
      const distFromCenter = Math.hypot(player.position.x, player.position.z);
      if (distFromCenter > 44) {
        const factor = 44 / distFromCenter;
        player.position.x *= factor;
        player.position.z *= factor;
      }

      // Ground elevation tracking
      const targetGroundY = getTerrainHeight(player.position.x, player.position.z);
      player.position.y = THREE.MathUtils.lerp(
        player.position.y,
        targetGroundY + player.eyeHeight,
        delta * 8.0
      );

      // Update Camera Transform
      camera.position.copy(player.position);
      camera.rotation.set(0, 0, 0);
      camera.rotateY(player.yaw);
      camera.rotateX(player.pitch);

      // 2. Poll Scream Metric for Level 3 Boss
      if (currentLevel === 3) {
        const { audio } = sensorManager.getSnapshot();
        if (audio.isScreaming) {
          screamAccumulator += delta;
          onScreamProgressRef.current(screamAccumulator);

          if (screamAccumulator >= 10.0 && mosquitoes.length > 0) {
            // Boss killed!
            const boss = mosquitoes[0];
            boss.dispose(scene);
            buzzManager.playVictorySfx();
            onKillRef.current(1, true);
            onLevelCompleteRef.current();
            return;
          }
        }
      }

      // 3. Spawn more mosquitoes in waves if needed
      if (currentLevel < 3 && totalSpawned < targetKills && mosquitoes.length < maxSimultaneous) {
        spawnTimer += delta;
        if (spawnTimer > 1.8) {
          spawnTimer = 0;
          spawnFieldMosquito();
        }
      }

      // 4. Update Mosquitos & 3D Spatial Audio
      const screenTargets: MosquitoScreenTarget[] = [];
      const camQuatInv = camera.quaternion.clone().invert();

      for (let i = mosquitoes.length - 1; i >= 0; i--) {
        const mosq = mosquitoes[i];
        mosq.update(delta, player.position, getTerrainHeight);

        // Calculate 3D Positional Audio relative to player camera
        const relPos = mosq.group.position.clone().sub(camera.position);
        relPos.applyQuaternion(camQuatInv);

        // Loud, clear 3D buzzing
        buzzManager.updateMosquitoBuzz(
          mosq.id,
          relPos.x,
          relPos.y,
          relPos.z,
          mosq.isBoss,
          mosq.currentSpeed / mosq.baseSpeed
        );

        // Project mosquito to screen coordinates for Fruit Ninja slicing
        const worldPos = mosq.group.position.clone();
        const proj = worldPos.clone().project(camera);

        // Behind camera?
        if (proj.z <= 1.0) {
          const screenX = ((proj.x + 1) * width) / 2;
          const screenY = ((-proj.y + 1) * height) / 2;
          const distToCam = worldPos.distanceTo(camera.position);
          const screenRadius = Math.max(38, Math.min(180, (width * (mosq.isBoss ? 1.4 : 0.45)) / Math.max(1, distToCam)));

          screenTargets.push({
            id: mosq.id,
            screenX,
            screenY,
            radiusPx: screenRadius,
            isDead: mosq.isDead,
            userData: mosq,
          });
        }
      }

      // 5. Check Fruit Ninja Blade Intersections
      const sliceHits = bladeDetector.checkIntersections(screenTargets);
      for (const hit of sliceHits) {
        const targetMosq = mosquitoes.find((m) => m.id === hit.targetId);
        if (targetMosq && !targetMosq.isDead && !targetMosq.isBoss) {
          targetMosq.isDead = true;

          // Spawn satisfying sliced mosquito halves
          sliceManager.spawnSlicedHalves(
            targetMosq.group.position,
            targetMosq.group.quaternion,
            new THREE.Vector3(targetMosq.baseScale, targetMosq.baseScale, targetMosq.baseScale),
            false,
            { p1: hit.p1, p2: hit.p2, swipeSpeed: hit.swipeSpeed }
          );

          buzzManager.playSliceSfx();
          sensorManager.triggerHaptic('swat');
          buzzManager.stopMosquitoBuzz(targetMosq.id);
          targetMosq.dispose(scene);

          // Remove from active list
          const idx = mosquitoes.indexOf(targetMosq);
          if (idx !== -1) mosquitoes.splice(idx, 1);

          killsThisLevel++;
          onKillRef.current(killsThisLevel, false);

          if (killsThisLevel >= targetKills) {
            buzzManager.playVictorySfx();
            sensorManager.triggerHaptic('victory');
            onLevelCompleteRef.current();
            return;
          }
        }
      }

      // 6. Update Sliced Halves & Blade Canvas
      sliceManager.update(delta);
      bladeDetector.render();

      // 7. Render 3D Scene
      renderer.render(scene, camera);
    };

    animFrameId = requestAnimationFrame(tick);

    // Resize Handler
    const handleResize = () => {
      if (!containerRef.current || !canvasRef.current || !bladeCanvasRef.current) return;
      const w = containerRef.current.clientWidth || window.innerWidth;
      const h = containerRef.current.clientHeight || window.innerHeight;
      camera.aspect = w / h;
      camera.updateProjectionMatrix();
      renderer.setSize(w, h);
      bladeDetector.resize(w, h);
    };
    window.addEventListener('resize', handleResize);

    // Cleanup on unmount
    return () => {
      cancelAnimationFrame(animFrameId);
      window.removeEventListener('keydown', handleKeyDown);
      window.removeEventListener('keyup', handleKeyUp);
      containerEl.removeEventListener('mousedown', handleMouseDown);
      window.removeEventListener('mousemove', handleMouseMove);
      window.removeEventListener('mouseup', handleMouseUp);
      containerEl.removeEventListener('touchstart', handleTouchStart);
      containerEl.removeEventListener('touchmove', handleTouchMove);
      containerEl.removeEventListener('touchend', handleTouchEnd);
      window.removeEventListener('resize', handleResize);

      buzzManager.stopAll();
      mosquitoes.forEach((m) => m.dispose(scene));
      sliceManager.clearAll();
      renderer.dispose();
    };
  }, []);

  // --- Virtual Joystick Touch Event Handlers ---
  const handleJoystickTouchStart = (e: React.TouchEvent<HTMLDivElement>) => {
    e.stopPropagation();
    const touch = e.changedTouches[0];
    joystickTouchIdRef.current = touch.identifier;
    const rect = e.currentTarget.getBoundingClientRect();
    const cx = rect.left + rect.width / 2;
    const cy = rect.top + rect.height / 2;
    joystickCenterRef.current = { x: cx, y: cy };
    setTouchActive(true);
  };

  const handleJoystickTouchMove = (e: React.TouchEvent<HTMLDivElement>) => {
    e.stopPropagation();
    for (let i = 0; i < e.changedTouches.length; i++) {
      const touch = e.changedTouches[i];
      if (touch.identifier === joystickTouchIdRef.current) {
        const dx = touch.clientX - joystickCenterRef.current.x;
        const dy = touch.clientY - joystickCenterRef.current.y;
        const maxDist = 45;
        const dist = Math.hypot(dx, dy);
        const clampedDist = Math.min(dist, maxDist);
        const angle = Math.atan2(dy, dx);

        const thumbX = Math.cos(angle) * clampedDist;
        const thumbY = Math.sin(angle) * clampedDist;

        setJoystickThumb({ x: thumbX, y: thumbY });
        joystickMoveRef.current = {
          x: thumbX / maxDist,
          y: thumbY / maxDist,
        };
      }
    }
  };

  const handleJoystickTouchEnd = (e: React.TouchEvent<HTMLDivElement>) => {
    e.stopPropagation();
    for (let i = 0; i < e.changedTouches.length; i++) {
      if (e.changedTouches[i].identifier === joystickTouchIdRef.current) {
        joystickTouchIdRef.current = null;
        setTouchActive(false);
        setJoystickThumb({ x: 0, y: 0 });
        joystickMoveRef.current = { x: 0, y: 0 };
      }
    }
  };

  return (
    <div
      ref={containerRef}
      className="relative h-full w-full select-none overflow-hidden touch-none"
      style={{ touchAction: 'none' }}
    >
      {/* 3D WebGL Canvas */}
      <canvas ref={canvasRef} className="absolute inset-0 h-full w-full block" />

      {/* Fruit Ninja Blade Slash Canvas */}
      <canvas
        ref={bladeCanvasRef}
        className="pointer-events-none absolute inset-0 z-10 h-full w-full block"
      />

      {/* PC Controls Hint Badge */}
      <div className="pointer-events-none absolute bottom-4 left-1/2 -translate-x-1/2 z-20 hidden sm:flex items-center gap-2 rounded-full border border-emerald-500/40 bg-black/60 px-4 py-1.5 backdrop-blur-md text-xs font-semibold text-emerald-200">
        <span>🏃 WASD para caminar</span>
        <span className="text-emerald-500">•</span>
        <span>🖱️ Arrastrar para mirar</span>
        <span className="text-emerald-500">•</span>
        <span>⚔️ Deslizar rápido para cortar</span>
      </div>

      {/* Return to Menu Button */}
      {onReturnToMenu && (
        <button
          data-no-swat="true"
          onClick={onReturnToMenu}
          className="absolute top-16 left-3.5 z-30 flex items-center gap-1.5 rounded-full border border-white/20 bg-black/70 px-3 py-1 text-xs font-bold text-white shadow-lg backdrop-blur-md active:scale-95 transition hover:bg-black/85"
        >
          <span>← Salir al Menú</span>
        </button>
      )}

      {/* Mobile Virtual Joystick */}
      <div
        data-no-swat="true"
        onTouchStart={handleJoystickTouchStart}
        onTouchMove={handleJoystickTouchMove}
        onTouchEnd={handleJoystickTouchEnd}
        onTouchCancel={handleJoystickTouchEnd}
        className="sm:hidden absolute bottom-8 left-6 z-30 flex h-28 w-28 items-center justify-center rounded-full border-2 border-emerald-400/40 bg-black/50 backdrop-blur-sm shadow-xl active:border-emerald-400/70"
      >
        {/* Joystick Base Ring */}
        <div className="h-14 w-14 rounded-full border border-emerald-500/30 bg-emerald-950/40 flex items-center justify-center">
          {/* Draggable Thumb Knob */}
          <div
            className="h-10 w-10 rounded-full bg-gradient-to-tr from-emerald-500 to-emerald-400 shadow-lg border-2 border-white/80 transition-transform duration-75"
            style={{
              transform: `translate(${joystickThumb.x}px, ${joystickThumb.y}px)`,
            }}
          />
        </div>
      </div>
    </div>
  );
};
