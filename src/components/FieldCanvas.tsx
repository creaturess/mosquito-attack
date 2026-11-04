/**
 * FieldCanvas.tsx
 * MODO CAMPO (Field Mode) 3D Viewport:
 * - Intimate, vibrant outdoor meadow with everything close together (perimeter ~18m)
 * - Realistic curved grass tufts with multiple arched blades, wind sway, and rich botanical details
 * - Full 6DOF mobile support:
 *   - PHYSICAL GYROSCOPE: Pointing and turning the phone looks around 360° in real-time
 *   - PHYSICAL PHONE MOVEMENT & TILT: Moving the phone forward or tilting advances the player
 *   - Virtual joystick & WASD hybrid controls
 * - Mosquitos flying in from nearby tree borders (8m-12m) to orbit tightly around the player (1.5m-2.8m)
 * - Loud, directional 3D HRTF spatial audio
 * - Fruit Ninja slicing with glowing blade trail
 */

import React, { useEffect, useRef, useState } from 'react';
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

// Procedural Terrain Height Helper (Compact 22m clearing with surrounding rolling knolls)
export function getTerrainHeight(x: number, z: number): number {
  const dist = Math.hypot(x, z);
  const centerFlatten = Math.min(1.0, dist / 8.0);
  const baseHill =
    Math.sin(x * 0.08) * 0.6 +
    Math.cos(z * 0.07) * 0.5 +
    Math.sin((x + z) * 0.12) * 0.3;
  // Gentle rim rise starting at 18m
  const rimRise = dist > 18 ? Math.pow((dist - 18) * 0.25, 2) * 0.4 : 0;
  return baseHill * centerFlatten + rimRise;
}

/**
 * Creates realistic, curved, multi-blade grass tuft geometry with natural arching droop
 */
function createCurvedGrassTuftGeometry(bladeCount: number = 7): THREE.BufferGeometry {
  const positions: number[] = [];
  const normals: number[] = [];
  const uvs: number[] = [];
  const colors: number[] = [];
  const indices: number[] = [];

  const segments = 4; // Height segments for smooth parabolic curve
  let vertexOffset = 0;

  for (let b = 0; b < bladeCount; b++) {
    // Random radial angle and curvature direction
    const bladeAngle = (b / bladeCount) * Math.PI * 2 + (Math.random() - 0.5) * 0.4;
    const curveAngle = bladeAngle + (Math.random() - 0.5) * 0.5;
    const bladeHeight = 0.85 + Math.random() * 0.5; // 0.85m to 1.35m tall
    const baseWidth = 0.065 + Math.random() * 0.02;
    const maxArch = 0.28 + Math.random() * 0.32; // arching curve offset

    const cosB = Math.cos(bladeAngle);
    const sinB = Math.sin(bladeAngle);
    const cosC = Math.cos(curveAngle);
    const sinC = Math.sin(curveAngle);

    for (let s = 0; s <= segments; s++) {
      const t = s / segments;
      // Parabolic curve bending outward with gravity
      const droop = Math.pow(t, 1.8) * maxArch;
      const y = t * bladeHeight - droop * 0.3;
      const width = baseWidth * (1.0 - Math.pow(t, 0.9)); // taper towards tip

      // Left vertex
      const lx = cosB * (-width) + cosC * droop;
      const lz = sinB * (-width) + sinC * droop;
      positions.push(lx, y, lz);
      normals.push(-sinB, 0.4, cosB);
      uvs.push(0, t);

      // Color gradient: deep green root -> fresh leaf green -> golden sunlit tip
      const r = THREE.MathUtils.lerp(0.12, 0.68, Math.pow(t, 1.4));
      const g = THREE.MathUtils.lerp(0.32, 0.88, t);
      const bl = THREE.MathUtils.lerp(0.12, 0.22, t);
      colors.push(r, g, bl);

      // Right vertex
      const rx = cosB * width + cosC * droop;
      const rz = sinB * width + sinC * droop;
      positions.push(rx, y, rz);
      normals.push(sinB, 0.4, -cosB);
      uvs.push(1, t);
      colors.push(r, g, bl);

      if (s < segments) {
        const v0 = vertexOffset + s * 2;
        const v1 = v0 + 1;
        const v2 = v0 + 2;
        const v3 = v0 + 3;
        // Two triangles per segment
        indices.push(v0, v1, v2);
        indices.push(v1, v3, v2);
      }
    }
    vertexOffset += (segments + 1) * 2;
  }

  const geom = new THREE.BufferGeometry();
  geom.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geom.setAttribute('normal', new THREE.Float32BufferAttribute(normals, 3));
  geom.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
  geom.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
  geom.setIndex(indices);
  geom.computeVertexNormals();

  return geom;
}

// Pre-allocated scratch instances to avoid per-frame GC allocations and stutter
const _forwardDir = new THREE.Vector3();
const _rightDir = new THREE.Vector3();
const _targetVel = new THREE.Vector3();
const _camQuatInv = new THREE.Quaternion();
const _camQuat = new THREE.Quaternion();
const _tempEuler = new THREE.Euler(0, 0, 0, 'YXZ');
const _relPos = new THREE.Vector3();
const _worldPos = new THREE.Vector3();
const _proj = new THREE.Vector3();
const _sliceScale = new THREE.Vector3();

// Persistent reusable pool for mosquito screen targets (zero allocation in render loop)
const _screenTargetsPool: MosquitoScreenTarget[] = Array.from({ length: 30 }, () => ({
  id: '',
  screenX: 0,
  screenY: 0,
  radiusPx: 0,
  isDead: false,
  userData: null,
}));
let _screenTargetsCount = 0;

export const FieldCanvasComponent: React.FC<FieldCanvasProps> = ({
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
  const [, setTouchActive] = useState(false);
  const [joystickThumb, setJoystickThumb] = useState<{ x: number; y: number }>({ x: 0, y: 0 });
  const joystickCenterRef = useRef<{ x: number; y: number }>({ x: 0, y: 0 });
  const joystickTouchIdRef = useRef<number | null>(null);
  const joystickMoveRef = useRef<{ x: number; y: number }>({ x: 0, y: 0 });

  // Manual look rotation offsets (mouse look on desktop only)
  const manualLookRef = useRef<{ yaw: number; pitch: number }>({ yaw: 0, pitch: 0 });

  // Detect computer/desktop with mouse to hide tactile joystick on PC
  const [isComputer, setIsComputer] = useState(() => {
    if (typeof window === 'undefined') return false;
    return window.matchMedia('(hover: hover) and (pointer: fine)').matches;
  });

  useEffect(() => {
    if (typeof window === 'undefined') return;
    const mq = window.matchMedia('(hover: hover) and (pointer: fine)');
    const handler = (e: MediaQueryListEvent) => setIsComputer(e.matches);
    mq.addEventListener('change', handler);
    return () => mq.removeEventListener('change', handler);
  }, []);

  // Explicit Mobile Gyroscope status, zero-point calibration, and activation state
  const [showGyroPrompt, setShowGyroPrompt] = useState(false);
  const [isGyroActive, setIsGyroActive] = useState(false);
  const [hasStartedExploration, setHasStartedExploration] = useState(false);
  const [calibrationNotice, setCalibrationNotice] = useState<string | null>(null);

  useEffect(() => {
    // Check if iOS Safari or mobile requires explicit permission prompt
    if (typeof window !== 'undefined') {
      const win = window as unknown as { DeviceOrientationEvent?: { requestPermission?: () => Promise<string> } };
      if (typeof win.DeviceOrientationEvent?.requestPermission === 'function' && !sensorManager.hasGyroData()) {
        setShowGyroPrompt(true);
      }
    }
  }, []);

  const handleStartExploration = async () => {
    const granted = await sensorManager.requestSensors();
    sensorManager.calibrateZeroPoint();
    manualLookRef.current = { yaw: 0, pitch: 0 };
    setHasStartedExploration(true);
    setIsGyroActive(granted || sensorManager.hasGyroData());
    setShowGyroPrompt(false);
    setCalibrationNotice('¡Punto Cero Calibrado y Sensores 6DOF Activos!');
    sensorManager.triggerHaptic('swat');
    setTimeout(() => {
      setCalibrationNotice(null);
    }, 2000);
  };

  const handleCalibrateCenter = () => {
    sensorManager.calibrateZeroPoint();
    manualLookRef.current = { yaw: 0, pitch: 0 };
    setCalibrationNotice('¡Punto Cero Calibrado!');
    sensorManager.triggerHaptic('swat');
    setTimeout(() => {
      setCalibrationNotice(null);
    }, 1800);
  };

  useEffect(() => {
    if (!canvasRef.current || !containerRef.current || !bladeCanvasRef.current) return;

    // Calibrate sensor zero point when entering Field Mode
    sensorManager.calibrateZeroPoint();

    const width = containerRef.current.clientWidth || window.innerWidth;
    const height = containerRef.current.clientHeight || window.innerHeight;

    // --- 1. Scene, Camera, Renderer ---
    const scene = new THREE.Scene();
    scene.background = new THREE.Color(0xdcece0);
    // Soft golden-green atmospheric distant fog
    scene.fog = new THREE.FogExp2(0xd6e5c8, 0.024);

    // Near plane 0.35 and far plane 65.0 preserve high 24-bit depth precision on mobile GPUs (prevents Z-fighting and geometry jitter)
    const camera = new THREE.PerspectiveCamera(70, width / height, 0.35, 65.0);

    const renderer = new THREE.WebGLRenderer({
      canvas: canvasRef.current,
      antialias: true,
      powerPreference: 'high-performance',
      alpha: false,
      depth: true,
      stencil: false,
      preserveDrawingBuffer: false,
    });
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.15;
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 1.5));
    renderer.setSize(width, height);
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = THREE.PCFSoftShadowMap;

    bladeCanvasRef.current.width = width;
    bladeCanvasRef.current.height = height;

    // --- 2. Blade Swipe & Slice Manager ---
    const bladeDetector = new BladeSwipeDetector(bladeCanvasRef.current);
    const sliceManager = new MosquitoSliceManager(scene, camera);

    // --- 3. Lighting (Warm Afternoon Golden Light) ---
    const hemiLight = new THREE.HemisphereLight(0xfff0dc, 0x224c1f, 0.9);
    scene.add(hemiLight);

    const sunLight = new THREE.DirectionalLight(0xfff1dc, 1.85);
    sunLight.position.set(30, 32, -35);
    sunLight.castShadow = true;
    sunLight.shadow.mapSize.width = 1024;
    sunLight.shadow.mapSize.height = 1024;
    sunLight.shadow.camera.near = 5;
    sunLight.shadow.camera.far = 80;
    const d = 22;
    sunLight.shadow.camera.left = -d;
    sunLight.shadow.camera.right = d;
    sunLight.shadow.camera.top = d;
    sunLight.shadow.camera.bottom = -d;
    sunLight.shadow.bias = -0.0006;
    scene.add(sunLight);

    // Warm afternoon sky dome
    const skyGeom = new THREE.SphereGeometry(90, 24, 16);
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
          vec3 skyTop = vec3(0.32, 0.58, 0.92);
          vec3 skyHorizon = vec3(0.96, 0.88, 0.74);
          vec3 groundHaze = vec3(0.82, 0.90, 0.78);

          vec3 col;
          if (y > 0.0) {
            col = mix(skyHorizon, skyTop, pow(y, 0.7));
          } else {
            col = mix(skyHorizon, groundHaze, clamp(-y * 2.5, 0.0, 1.0));
          }
          gl_FragColor = vec4(col, 1.0);
        }
      `,
    });
    const skyMesh = new THREE.Mesh(skyGeom, skyMat);
    scene.add(skyMesh);

    // --- 4. Procedural Meadow Terrain (Compact 55m area) ---
    const terrainSize = 65;
    const terrainSegments = 64;
    const terrainGeom = new THREE.PlaneGeometry(terrainSize, terrainSize, terrainSegments, terrainSegments);
    terrainGeom.rotateX(-Math.PI / 2);

    const posAttr = terrainGeom.getAttribute('position') as THREE.BufferAttribute;
    for (let i = 0; i < posAttr.count; i++) {
      const vx = posAttr.getX(i);
      const vz = posAttr.getZ(i);
      posAttr.setY(i, getTerrainHeight(vx, vz));
    }
    terrainGeom.computeVertexNormals();

    // Procedural detailed terrain texture
    const canvasTex = document.createElement('canvas');
    canvasTex.width = 512;
    canvasTex.height = 512;
    const ctx = canvasTex.getContext('2d');
    if (ctx) {
      ctx.fillStyle = '#265820';
      ctx.fillRect(0, 0, 512, 512);
      for (let i = 0; i < 5000; i++) {
        const nx = Math.random() * 512;
        const ny = Math.random() * 512;
        const radius = Math.random() * 2.5 + 0.8;
        const shade = Math.random();
        if (shade > 0.6) {
          ctx.fillStyle = '#38782a';
        } else if (shade > 0.3) {
          ctx.fillStyle = '#1e4818';
        } else {
          ctx.fillStyle = '#4c8e38';
        }
        ctx.beginPath();
        ctx.arc(nx, ny, radius, 0, Math.PI * 2);
        ctx.fill();
      }
    }
    const groundTexture = new THREE.CanvasTexture(canvasTex);
    groundTexture.wrapS = THREE.RepeatWrapping;
    groundTexture.wrapT = THREE.RepeatWrapping;
    groundTexture.repeat.set(12, 12);
    groundTexture.colorSpace = THREE.SRGBColorSpace;

    const terrainMat = new THREE.MeshStandardMaterial({
      map: groundTexture,
      roughness: 0.9,
      metalness: 0.03,
      flatShading: false,
      polygonOffset: true,
      polygonOffsetFactor: 1.0,
      polygonOffsetUnits: 1.0,
    });
    const terrainMesh = new THREE.Mesh(terrainGeom, terrainMat);
    terrainMesh.receiveShadow = true;
    scene.add(terrainMesh);

    // --- 5. Realistic Curved Grass Tufts (InstancedMesh) ---
    const tuftCount = 1800;
    const curvedGrassGeom = createCurvedGrassTuftGeometry(7);

    const grassMat = new THREE.MeshStandardMaterial({
      vertexColors: true,
      roughness: 0.72,
      metalness: 0.04,
      side: THREE.DoubleSide,
    });

    // GPU-driven vertex wind sway without CPU buffer uploads (silky smooth, zero pipeline stalls)
    grassMat.onBeforeCompile = (shader) => {
      shader.uniforms.uTime = { value: 0 };
      shader.vertexShader = `
        uniform float uTime;
        ${shader.vertexShader}
      `;
      shader.vertexShader = shader.vertexShader.replace(
        '#include <begin_vertex>',
        `
        #include <begin_vertex>
        float sway = sin(uTime * 2.2 + position.x * 0.4 + position.z * 0.4) * uv.y * uv.y * 0.12;
        transformed.x += sway;
        transformed.z += sway * 0.4;
        `
      );
      grassMat.userData.shader = shader;
    };

    const grassInstanced = new THREE.InstancedMesh(curvedGrassGeom, grassMat, tuftCount);
    grassInstanced.receiveShadow = true;

    const dummy = new THREE.Object3D();
    const tuftBasePositions: { x: number; y: number; z: number; scale: number; rotY: number }[] = [];

    // Scatter tightly within radius 18m
    for (let i = 0; i < tuftCount; i++) {
      const radius = 1.0 + Math.pow(Math.random(), 0.8) * 19.5;
      const angle = Math.random() * Math.PI * 2;
      const gx = Math.cos(angle) * radius;
      const gz = Math.sin(angle) * radius;
      const gy = getTerrainHeight(gx, gz);

      const s = 0.8 + Math.random() * 0.55;
      const rY = Math.random() * Math.PI * 2;

      dummy.position.set(gx, gy, gz);
      dummy.rotation.set((Math.random() - 0.5) * 0.1, rY, (Math.random() - 0.5) * 0.1);
      dummy.scale.set(s, s, s);
      dummy.updateMatrix();

      grassInstanced.setMatrixAt(i, dummy.matrix);
      tuftBasePositions.push({ x: gx, y: gy, z: gz, scale: s, rotY: rY });
    }
    grassInstanced.instanceMatrix.needsUpdate = true;
    scene.add(grassInstanced);

    // --- 6. Wildflowers & Botanical Details ---
    const flowerCount = 450;
    const flowerGeom = new THREE.SphereGeometry(0.11, 6, 6);
    const flowerMat = new THREE.MeshStandardMaterial({
      roughness: 0.55,
      metalness: 0.05,
    });
    const flowerInstanced = new THREE.InstancedMesh(flowerGeom, flowerMat, flowerCount);

    const flowerColors = [
      0xef4444, // Red poppy
      0xfacc15, // Golden buttercup
      0xa855f7, // Purple wildflower
      0xffffff, // White daisy
      0xf97316, // Orange wild marigold
    ];
    const flowerColor = new THREE.Color();

    for (let i = 0; i < flowerCount; i++) {
      const radius = 1.2 + Math.pow(Math.random(), 0.75) * 18.5;
      const angle = Math.random() * Math.PI * 2;
      const fx = Math.cos(angle) * radius;
      const fz = Math.sin(angle) * radius;
      const fy = getTerrainHeight(fx, fz) + 0.35 + Math.random() * 0.45;

      dummy.position.set(fx, fy, fz);
      dummy.scale.setScalar(0.75 + Math.random() * 0.75);
      dummy.updateMatrix();

      flowerInstanced.setMatrixAt(i, dummy.matrix);
      flowerColor.setHex(flowerColors[Math.floor(Math.random() * flowerColors.length)]);
      flowerInstanced.setColorAt(i, flowerColor);
    }
    flowerInstanced.instanceMatrix.needsUpdate = true;
    if (flowerInstanced.instanceColor) flowerInstanced.instanceColor.needsUpdate = true;
    scene.add(flowerInstanced);

    // --- 7. Surrounding Trees (Cozy clearing border ring at 16m-24m) ---
    const treeGroup = new THREE.Group();
    const treeTrunkMat = new THREE.MeshStandardMaterial({
      color: 0x483424,
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
      const trunkGeom = new THREE.CylinderGeometry(0.32 * scale, 0.58 * scale, trunkHeight, 7);
      trunkGeom.translate(0, trunkHeight * 0.5, 0);
      const trunkMesh = new THREE.Mesh(trunkGeom, treeTrunkMat);
      trunkMesh.castShadow = true;
      trunkMesh.receiveShadow = true;
      tree.add(trunkMesh);

      // Layered canopy
      const foliageMat = new THREE.MeshStandardMaterial({
        color: treeFoliageColors[Math.floor(Math.random() * treeFoliageColors.length)],
        roughness: 0.86,
        metalness: 0.02,
        flatShading: true,
      });

      const canopyCount = 3 + Math.floor(Math.random() * 2);
      for (let c = 0; c < canopyCount; c++) {
        const rad = (1.6 + Math.random() * 0.7) * scale;
        const folGeom = new THREE.SphereGeometry(rad, 7, 6);
        const folMesh = new THREE.Mesh(folGeom, foliageMat);
        folMesh.position.set(
          (Math.random() - 0.5) * 1.1 * scale,
          trunkHeight + (c * 1.1 - 0.2) * scale,
          (Math.random() - 0.5) * 1.1 * scale
        );
        folMesh.scale.set(1.0 + Math.random() * 0.2, 0.9 + Math.random() * 0.3, 1.0 + Math.random() * 0.2);
        folMesh.castShadow = true;
        folMesh.receiveShadow = true;
        tree.add(folMesh);
      }

      return tree;
    };

    // Compact ring of trees enclosing the clearing closely
    for (let i = 0; i < 22; i++) {
      const angle = (i / 22) * Math.PI * 2 + (Math.random() - 0.5) * 0.18;
      const dist = 16.5 + Math.random() * 7.5;
      treeGroup.add(createTree(Math.cos(angle) * dist, Math.sin(angle) * dist, 1.0 + Math.random() * 0.35));
    }
    scene.add(treeGroup);

    // --- 8. Floating Golden Pollen Particles ---
    const pollenCount = 120;
    const pollenGeom = new THREE.BufferGeometry();
    const pollenPositions = new Float32Array(pollenCount * 3);
    for (let i = 0; i < pollenCount; i++) {
      pollenPositions[i * 3 + 0] = (Math.random() - 0.5) * 35;
      pollenPositions[i * 3 + 1] = 0.8 + Math.random() * 4.0;
      pollenPositions[i * 3 + 2] = (Math.random() - 0.5) * 35;
    }
    pollenGeom.setAttribute('position', new THREE.BufferAttribute(pollenPositions, 3));
    const pollenMat = new THREE.PointsMaterial({
      color: 0xfef08a,
      size: 0.07,
      transparent: true,
      opacity: 0.65,
      blending: THREE.AdditiveBlending,
    });
    const pollenPoints = new THREE.Points(pollenGeom, pollenMat);
    scene.add(pollenPoints);

    // --- 9. First-Person Player Navigation State (Decoupled Physics & Visual Interpolation) ---
    const player = {
      position: new THREE.Vector3(0, 0, 0),
      prevPosition: new THREE.Vector3(0, 0, 0),
      visualPosition: new THREE.Vector3(0, 0, 0),
      velocity: new THREE.Vector3(0, 0, 0),
      verticalOffset: 0,
      yaw: 0,
      prevYaw: 0,
      pitch: 0,
      prevPitch: 0,
      roll: 0,
      prevRoll: 0,
      eyeHeight: 1.65,
      walkSpeed: 6.5,
    };
    player.position.y = getTerrainHeight(0, 0) + player.eyeHeight;
    player.prevPosition.copy(player.position);
    player.visualPosition.copy(player.position);
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

    // Mouse look state & Fruit Ninja slicing on PC
    let isMouseDown = false;
    let lastMouseX = 0;
    let lastMouseY = 0;
    let hasMousePosition = false;

    const handleMouseDown = (e: MouseEvent) => {
      if ((e.target as HTMLElement)?.closest('[data-no-swat="true"]')) return;
      isMouseDown = true;
      lastMouseX = e.clientX;
      lastMouseY = e.clientY;
      hasMousePosition = true;
      // Al presionar para rotar la cámara, finaliza el trazo de corte
      bladeDetector.endStroke();
    };

    const handleMouseMove = (e: MouseEvent) => {
      if (!hasMousePosition) {
        lastMouseX = e.clientX;
        lastMouseY = e.clientY;
        hasMousePosition = true;
        return;
      }

      const dx = e.clientX - lastMouseX;
      const dy = e.clientY - lastMouseY;
      lastMouseX = e.clientX;
      lastMouseY = e.clientY;

      if (isMouseDown) {
        // CUANDO MANTENÉS EL CLICK: rotar la visión por el espacio
        if (Math.abs(dx) < 250 && Math.abs(dy) < 250) {
          manualLookRef.current.yaw -= dx * 0.0035;
          manualLookRef.current.pitch -= dy * 0.0035;
          manualLookRef.current.pitch = Math.max(-1.3, Math.min(1.3, manualLookRef.current.pitch));
        }
      } else {
        // CUANDO SOLTÁS EL CLICK (click suelto): matar a los mosquitos cortando con el mouse
        bladeDetector.addPoint(e.clientX, e.clientY);
      }
    };

    const handleMouseUp = () => {
      isMouseDown = false;
      bladeDetector.endStroke();
    };

    const handleMouseLeave = () => {
      isMouseDown = false;
      bladeDetector.endStroke();
      hasMousePosition = false;
    };

    const containerEl = containerRef.current;
    containerEl.addEventListener('mousedown', handleMouseDown);
    window.addEventListener('mousemove', handleMouseMove);
    window.addEventListener('mouseup', handleMouseUp);
    window.addEventListener('mouseleave', handleMouseLeave);

    // --- 10. Fruit Ninja Blade Swipe Handling (Swiping cuts mosquitoes with touch) ---
    const handleTouchStart = (e: TouchEvent) => {
      const targetEl = e.target as HTMLElement | null;
      if (targetEl && targetEl.closest('[data-no-swat="true"]')) return;

      for (let i = 0; i < e.changedTouches.length; i++) {
        const touch = e.changedTouches[i];
        if (touch.identifier === joystickTouchIdRef.current) continue;
        bladeDetector.addPoint(touch.clientX, touch.clientY);
      }
    };

    const handleTouchMove = (e: TouchEvent) => {
      const targetEl = e.target as HTMLElement | null;
      if (targetEl && targetEl.closest('[data-no-swat="true"]')) return;

      for (let i = 0; i < e.changedTouches.length; i++) {
        const touch = e.changedTouches[i];
        if (touch.identifier === joystickTouchIdRef.current) continue;
        bladeDetector.addPoint(touch.clientX, touch.clientY);
      }
    };

    const handleTouchEnd = (e: TouchEvent) => {
      for (let i = 0; i < e.changedTouches.length; i++) {
        const touch = e.changedTouches[i];
        if (touch.identifier !== joystickTouchIdRef.current) {
          bladeDetector.endStroke();
        }
      }
    };

    containerEl.addEventListener('touchstart', handleTouchStart, { passive: true });
    containerEl.addEventListener('touchmove', handleTouchMove, { passive: true });
    containerEl.addEventListener('touchend', handleTouchEnd, { passive: true });

    // --- 11. Mosquitoes in Field Mode ---
    const mosquitoes: FieldMosquito[] = [];
    let killsThisLevel = 0;
    const targetKills = stateRef.current.targetKills;
    const currentLevel = stateRef.current.currentLevel;

    // Spawning waves close by (8m to 14m)
    let spawnTimer = 0;
    let totalSpawned = 0;
    const maxSimultaneous = currentLevel === 3 ? 1 : currentLevel === 2 ? 5 : 4;

    const spawnFieldMosquito = () => {
      if (totalSpawned >= targetKills) return;

      const id = `field_mosq_${Date.now()}_${Math.random().toString(36).substring(2, 6)}`;
      const angle = Math.random() * Math.PI * 2;
      // Close spawn distance so they arrive immediately
      const spawnDist = currentLevel === 3 ? 14 : 8.5 + Math.random() * 5.0;
      const sx = player.position.x + Math.cos(angle) * spawnDist;
      const sz = player.position.z + Math.sin(angle) * spawnDist;
      const groundY = getTerrainHeight(sx, sz);
      const sy = groundY + (currentLevel === 3 ? 2.8 : 1.6 + Math.random() * 1.4);

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

    // Initial batch spawn
    if (currentLevel === 3) {
      spawnFieldMosquito(); // Boss
    } else {
      spawnFieldMosquito();
      spawnFieldMosquito();
      spawnFieldMosquito();
    }

    // --- 12. Main Fixed Timestep Game Loop (Decoupled Physics & Alpha Interpolation) ---
    let animFrameId: number;
    let lastTime = performance.now();
    let accumulator = 0;
    let screamAccumulator = 0;
    const FIXED_DT = 1 / 60; // 60 UPS fixed physics step
    const MAX_ACCUMULATOR = 0.1; // Clamp to avoid spiral of death on backgrounding/stalls

    // Fixed physics update step
    const fixedPhysicsStep = (dt: number) => {
      // Snapshot previous states for sub-frame alpha interpolation
      player.prevPosition.copy(player.position);
      player.prevYaw = player.yaw;
      player.prevPitch = player.pitch;
      player.prevRoll = player.roll;

      // 1. Update SensorManager (DeviceOrientationEvent & Audio)
      const sensorData = sensorManager.update();
      const { orientation } = sensorData;

      // CAMERA ORIENTATION (GYROSCOPE ON MOBILE & MOUSE LOOK ON PC):
      // When physical gyroscope hardware events are actively incoming, orientation follows phone.
      // Mouse look is always applied so desktop PC can rotate the screen smoothly with mouse.
      if (sensorManager.hasGyroData()) {
        player.yaw = orientation.yawRad + manualLookRef.current.yaw;
        player.pitch = Math.max(-1.3, Math.min(1.3, orientation.pitchRad + manualLookRef.current.pitch));
        player.roll = orientation.rollRad;
      } else {
        player.yaw = manualLookRef.current.yaw;
        player.pitch = manualLookRef.current.pitch;
        player.roll = 0;
      }

      // Update camera 3D gaze orientation in local Euler space
      _tempEuler.set(player.pitch, player.yaw, player.roll, 'YXZ');
      _camQuat.setFromEuler(_tempEuler);

      // 1. Horizontal Forward Vector (projected onto ground plane X-Z, normalized)
      _forwardDir.set(0, 0, -1).applyQuaternion(_camQuat);
      _forwardDir.y = 0;
      if (_forwardDir.lengthSq() > 0.0001) {
        _forwardDir.normalize();
      } else {
        _forwardDir.set(0, 0, -1);
      }

      // 2. Horizontal Right Vector (strictly orthogonal to horizontal forward)
      _rightDir.set(-_forwardDir.z, 0, _forwardDir.x);

      // CONTROLS: 100% Tactile Traversal (Touch Joystick on mobile + WASD on keyboard)
      // The camera rotates with the phone's gyroscope, but phone physical displacement is disabled
      let inputForward = 0;
      let inputRight = 0;

      // 1. Keyboard Navigation (Desktop WASD / Arrow Keys)
      if (keys.w) inputForward += 1;
      if (keys.s) inputForward -= 1;
      if (keys.d) inputRight += 1;
      if (keys.a) inputRight -= 1;

      // 2. Touch Navigation: Virtual Joystick (Touch Thumb on Mobile / Tablets)
      const joyX = joystickMoveRef.current.x;
      const joyY = joystickMoveRef.current.y;
      const joyMag = Math.hypot(joyX, joyY);

      if (joyMag > 0.05) {
        // Pushing UP (joyY < 0) advances strictly forward along camera view
        // Pushing RIGHT (joyX > 0) strafes strictly right of camera view
        inputForward += -joyY;
        inputRight += joyX;
      }

      // NO physical displacement: phone movement rotates camera in 360°, but NEVER translates position
      player.verticalOffset = 0;

      // Vector Normalization & Uniform Speed Calculation
      const inputLen = Math.hypot(inputForward, inputRight);
      if (inputLen > 0.02) {
        const speedScale = Math.min(1.0, inputLen);
        const normForward = (inputForward / inputLen) * speedScale;
        const normRight = (inputRight / inputLen) * speedScale;

        _targetVel.set(0, 0, 0)
          .addScaledVector(_forwardDir, normForward * player.walkSpeed)
          .addScaledVector(_rightDir, normRight * player.walkSpeed);
      } else {
        _targetVel.set(0, 0, 0);
      }

      // Smooth velocity interpolation with instant zero clamp at rest
      player.velocity.lerp(_targetVel, dt * 10.0);
      if (player.velocity.lengthSq() < 0.0001 && _targetVel.lengthSq() === 0) {
        player.velocity.set(0, 0, 0);
      }
      player.position.addScaledVector(player.velocity, dt);

      // Clamp player within the compact meadow perimeter (radius 18.5m)
      const distFromCenter = Math.hypot(player.position.x, player.position.z);
      if (distFromCenter > 18.5) {
        const factor = 18.5 / distFromCenter;
        player.position.x *= factor;
        player.position.z *= factor;
      }

      // Ground elevation tracking + vertical physical phone translation
      const targetGroundY = getTerrainHeight(player.position.x, player.position.z);
      player.position.y = THREE.MathUtils.lerp(
        player.position.y,
        targetGroundY + player.eyeHeight + player.verticalOffset,
        dt * 8.0
      );

      // 2. Poll Scream Metric for Level 3 Boss (Voice scream OR repeated GRITAR button clicks)
      if (currentLevel === 3) {
        const { audio } = sensorData;
        const pulse = sensorManager.consumeScreamPulse();
        if (pulse > 0) {
          screamAccumulator += pulse;
          buzzManager.playBossHurtSfx();
          sensorManager.triggerHaptic('bossHit');
          onScreamProgressRef.current(screamAccumulator);
        }

        if (audio.isScreaming) {
          screamAccumulator += dt;
          onScreamProgressRef.current(screamAccumulator);
        }

        if (screamAccumulator >= 10.0 && mosquitoes.length > 0) {
          const boss = mosquitoes[0];
          boss.dispose(scene);
          buzzManager.playVictorySfx();
          sensorManager.triggerHaptic('victory');
          onKillRef.current(1, true);
          onLevelCompleteRef.current();
          return;
        }
      }

      // 3. Spawn more mosquitoes in waves if needed
      if (currentLevel < 3 && totalSpawned < targetKills && mosquitoes.length < maxSimultaneous) {
        spawnTimer += dt;
        if (spawnTimer > 1.2) {
          spawnTimer = 0;
          spawnFieldMosquito();
        }
      }

      // 4. Fixed physics tick for all active mosquitoes
      for (let i = mosquitoes.length - 1; i >= 0; i--) {
        mosquitoes[i].fixedUpdate(dt, player.position, getTerrainHeight);
      }
    };

    const tick = () => {
      animFrameId = requestAnimationFrame(tick);

      const now = performance.now();
      let frameTime = (now - lastTime) * 0.001;
      lastTime = now;

      // Guard against giant frame jumps (e.g. tab unfocus)
      if (frameTime > MAX_ACCUMULATOR) frameTime = MAX_ACCUMULATOR;
      accumulator += frameTime;

      // Execute fixed timestep physics updates at constant 60 UPS
      while (accumulator >= FIXED_DT) {
        fixedPhysicsStep(FIXED_DT);
        accumulator -= FIXED_DT;
      }

      // Compute sub-frame alpha interpolation factor (0.0 to 1.0)
      const alpha = Math.min(1.0, Math.max(0.0, accumulator / FIXED_DT));

      // Sub-frame Camera Position Interpolation (buttery smooth on 60Hz/90Hz/120Hz displays)
      player.visualPosition.lerpVectors(player.prevPosition, player.position, alpha);
      camera.position.copy(player.visualPosition);

      // Sub-frame Camera Orientation Interpolation
      const curYaw = THREE.MathUtils.lerp(player.prevYaw, player.yaw, alpha);
      const curPitch = THREE.MathUtils.lerp(player.prevPitch, player.pitch, alpha);
      const curRoll = THREE.MathUtils.lerp(player.prevRoll, player.roll, alpha);

      camera.rotation.order = 'YXZ';
      camera.rotation.set(curPitch, curYaw, curRoll, 'YXZ');

      // Sub-frame Mosquito Visual Interpolation & 3D Spatial Audio
      _screenTargetsCount = 0;
      _camQuatInv.copy(camera.quaternion).invert();

      for (let i = mosquitoes.length - 1; i >= 0; i--) {
        const mosq = mosquitoes[i];
        mosq.interpolateVisual(alpha);

        // Calculate 3D Positional Audio relative to player camera using scratch vector
        _relPos.copy(mosq.group.position).sub(camera.position).applyQuaternion(_camQuatInv);

        // Loud, clear 3D buzzing
        buzzManager.updateMosquitoBuzz(
          mosq.id,
          _relPos.x,
          _relPos.y,
          _relPos.z,
          mosq.isBoss,
          mosq.currentSpeed / mosq.baseSpeed
        );

        // Project mosquito to screen coordinates for Fruit Ninja slicing
        _worldPos.copy(mosq.group.position);
        _proj.copy(_worldPos).project(camera);

        if (_proj.z <= 1.0) {
          const screenX = ((_proj.x + 1) * width) * 0.5;
          const screenY = ((-_proj.y + 1) * height) * 0.5;
          const distToCam = _worldPos.distanceTo(camera.position);
          const screenRadius = Math.max(45, Math.min(200, (width * (mosq.isBoss ? 1.5 : 0.55)) / Math.max(1, distToCam)));

          if (_screenTargetsCount < _screenTargetsPool.length) {
            const t = _screenTargetsPool[_screenTargetsCount++];
            t.id = mosq.id;
            t.screenX = screenX;
            t.screenY = screenY;
            t.radiusPx = screenRadius;
            t.isDead = mosq.isDead;
            t.userData = mosq;
          }
        }
      }

      // Check Fruit Ninja Blade Intersections (Zero allocation, passing pre-allocated pool + count)
      const sliceHits = bladeDetector.checkIntersections(_screenTargetsPool, _screenTargetsCount);
      for (const hit of sliceHits) {
        const targetMosq = mosquitoes.find((m) => m.id === hit.targetId);
        if (targetMosq && !targetMosq.isDead && !targetMosq.isBoss) {
          targetMosq.isDead = true;

          _sliceScale.setScalar(targetMosq.baseScale);
          sliceManager.spawnSlicedHalves(
            targetMosq.group.position,
            targetMosq.group.quaternion,
            _sliceScale,
            false,
            { p1: hit.p1, p2: hit.p2, swipeSpeed: hit.swipeSpeed }
          );

          buzzManager.playSliceSfx();
          sensorManager.triggerHaptic('swat');
          buzzManager.stopMosquitoBuzz(targetMosq.id);
          targetMosq.dispose(scene);

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

      // Update Sliced Halves & Blade Canvas with frameTime
      sliceManager.update(frameTime);
      bladeDetector.render();

      // GPU Grass Wind Sway Animation (Zero buffer re-upload, zero GPU stall)
      if (grassMat.userData.shader?.uniforms?.uTime) {
        grassMat.userData.shader.uniforms.uTime.value = now * 0.001;
      }

      // Render 3D Scene
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
      window.removeEventListener('mouseleave', handleMouseLeave);
      containerEl.removeEventListener('touchstart', handleTouchStart);
      containerEl.removeEventListener('touchmove', handleTouchMove);
      containerEl.removeEventListener('touchend', handleTouchEnd);
      window.removeEventListener('resize', handleResize);

      buzzManager.stopAll();
      mosquitoes.forEach((m) => m.dispose(scene));
      sliceManager.clearAll();
      renderer.dispose();
      curvedGrassGeom.dispose();
      grassMat.dispose();
      flowerGeom.dispose();
      flowerMat.dispose();
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
      style={{
        touchAction: 'none',
        transform: 'translate3d(0, 0, 0)',
        willChange: 'transform',
        backfaceVisibility: 'hidden',
      }}
    >
      {/* 3D WebGL Canvas with Hardware Acceleration */}
      <canvas
        ref={canvasRef}
        className="absolute inset-0 h-full w-full block"
        style={{
          transform: 'translate3d(0, 0, 0)',
          willChange: 'transform',
          backfaceVisibility: 'hidden',
        }}
      />

      {/* Fruit Ninja Blade Slash Canvas with Hardware Acceleration */}
      <canvas
        ref={bladeCanvasRef}
        className="pointer-events-none absolute inset-0 z-10 h-full w-full block"
        style={{
          transform: 'translate3d(0, 0, 0)',
          willChange: 'transform',
          backfaceVisibility: 'hidden',
        }}
      />

      {/* Initial Exploration & Gyroscope Activation Modal for Mobile & Touch Devices */}
      {!hasStartedExploration && (
        <div className="absolute inset-0 z-50 flex items-center justify-center bg-black/80 p-4 backdrop-blur-md">
          <div className="w-full max-w-sm rounded-3xl border-2 border-emerald-500/50 bg-stone-950 p-6 text-center text-white shadow-2xl shadow-emerald-950/60">
            <div className="mx-auto mb-3 flex h-16 w-16 items-center justify-center rounded-2xl border border-emerald-400/40 bg-emerald-950/60 text-3xl">
              🧭
            </div>
            <h3 className="text-xl font-black text-emerald-400 uppercase tracking-wide">
              Controles del Campo Virtual
            </h3>
            <p className="mt-2 text-xs leading-relaxed text-stone-300">
              <strong className="text-emerald-300">En PC:</strong> <span className="text-amber-300 font-bold">Mantené presionado el click</span> para rotar la visión por el espacio. Con el <span className="text-emerald-300 font-bold">click suelto</span>, mové el mouse para rebanar y matar mosquitos.
              <br className="my-1" />
              <strong className="text-emerald-300">En móvil:</strong> Mové el teléfono para <span className="text-emerald-300 font-bold">rotar la visión en 360°</span> y usá el <span className="text-amber-300 font-bold">joystick táctil</span> para recorrer el campo. Deslizá en pantalla para rebanar mosquitos.
            </p>
            <button
              data-no-swat="true"
              onClick={handleStartExploration}
              className="mt-5 w-full rounded-2xl border-2 border-emerald-400 bg-gradient-to-r from-emerald-600 to-green-600 py-3.5 text-sm font-black text-white shadow-lg shadow-emerald-900/50 active:scale-95 transition"
            >
              ¡COMENZAR A JUGAR!
            </button>
          </div>
        </div>
      )}

      {/* Floating Zero-Point Calibration Toast Notification */}
      {calibrationNotice && (
        <div
          className="pointer-events-none absolute top-28 left-1/2 -translate-x-1/2 z-40 rounded-full border border-emerald-400 bg-emerald-950/95 px-4 py-1.5 text-xs font-bold text-emerald-200 shadow-xl backdrop-blur-md transition-all duration-300"
          style={{ transform: 'translate3d(-50%, 0, 0)' }}
        >
          <span>{calibrationNotice}</span>
        </div>
      )}

      {/* Gyroscope Zero-Point Calibration Button */}
      <button
        data-no-swat="true"
        onClick={handleCalibrateCenter}
        className="absolute top-16 right-3.5 z-30 flex items-center gap-1.5 rounded-full border border-emerald-500/50 bg-black/75 px-3.5 py-1.5 text-[11px] font-bold text-emerald-300 backdrop-blur-md shadow-lg active:scale-95 transition hover:bg-black/90"
        style={{ transform: 'translate3d(0, 0, 0)' }}
      >
        <span>🎯 Calibrar Punto Cero</span>
        <span className="h-2 w-2 rounded-full bg-emerald-400 animate-pulse" />
      </button>

      {/* PC Controls Hint Badge */}
      <div
        className="pointer-events-none absolute bottom-4 left-1/2 -translate-x-1/2 z-20 hidden sm:flex items-center gap-2 rounded-full border border-emerald-500/40 bg-black/60 px-4 py-1.5 backdrop-blur-md text-xs font-semibold text-emerald-200"
        style={{ transform: 'translate3d(-50%, 0, 0)' }}
      >
        <span>🏃 WASD para caminar</span>
        <span className="text-emerald-500">•</span>
        <span>🧭 Mantener click para rotar visión</span>
        <span className="text-emerald-500">•</span>
        <span>⚔️ Click suelto para cortar</span>
      </div>

      {/* Mobile Walking Guidance Badge */}
      <div
        className="pointer-events-none absolute bottom-2 left-1/2 -translate-x-1/2 z-20 flex sm:hidden items-center gap-1.5 rounded-full border border-emerald-500/40 bg-black/80 px-3.5 py-1.5 backdrop-blur-md text-[11px] font-semibold text-emerald-200 shadow-md text-center"
        style={{ transform: 'translate3d(-50%, 0, 0)' }}
      >
        <span>🧭 Mové el celular para rotar • 🕹️ Usá el joystick táctil para caminar</span>
      </div>

      {/* Return to Menu Button */}
      {onReturnToMenu && (
        <button
          data-no-swat="true"
          onClick={onReturnToMenu}
          className="absolute top-16 left-3.5 z-30 flex items-center gap-1.5 rounded-full border border-white/20 bg-black/70 px-3 py-1 text-xs font-bold text-white shadow-lg backdrop-blur-md active:scale-95 transition hover:bg-black/85"
          style={{ transform: 'translate3d(0, 0, 0)' }}
        >
          <span>← Salir al Menú</span>
        </button>
      )}

      {/* Tactile Virtual Joystick for Traversing the Field (Visible on mobile/touch, hidden on computer) */}
      {!isComputer && (
        <div
          data-no-swat="true"
          onTouchStart={handleJoystickTouchStart}
          onTouchMove={handleJoystickTouchMove}
          onTouchEnd={handleJoystickTouchEnd}
          onTouchCancel={handleJoystickTouchEnd}
          className="absolute bottom-6 left-5 z-30 flex h-28 w-28 items-center justify-center rounded-full border-2 border-emerald-400/50 bg-black/60 backdrop-blur-md shadow-2xl active:border-emerald-400 select-none touch-none [@media(hover:hover)_and_(pointer:fine)]:!hidden"
          style={{ transform: 'translate3d(0, 0, 0)' }}
        >
          <span className="absolute top-1.5 text-[9px] text-emerald-400/70 font-black pointer-events-none select-none">▲</span>
          <span className="absolute bottom-1.5 text-[9px] text-emerald-400/70 font-black pointer-events-none select-none">▼</span>
          <span className="absolute left-1.5 text-[9px] text-emerald-400/70 font-black pointer-events-none select-none">◄</span>
          <span className="absolute right-1.5 text-[9px] text-emerald-400/70 font-black pointer-events-none select-none">►</span>

          <div className="h-14 w-14 rounded-full border border-emerald-500/40 bg-emerald-950/60 flex items-center justify-center pointer-events-none">
            <div
              className="h-10 w-10 rounded-full bg-gradient-to-tr from-emerald-500 via-emerald-400 to-green-300 shadow-xl border-2 border-white/90 transition-transform duration-75 flex items-center justify-center"
              style={{
                transform: `translate3d(${joystickThumb.x}px, ${joystickThumb.y}px, 0)`,
                willChange: 'transform',
              }}
            >
              <span className="text-xs">🚶</span>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export const FieldCanvas = React.memo<FieldCanvasProps>(
  FieldCanvasComponent,
  (prev, next) =>
    prev.gameState.currentLevel === next.gameState.currentLevel &&
    prev.gameState.targetKills === next.gameState.targetKills &&
    prev.gameState.isPlaying === next.gameState.isPlaying
);
