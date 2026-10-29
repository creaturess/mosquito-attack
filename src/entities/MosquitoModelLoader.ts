/**
 * MosquitoModelLoader.ts
 * Manages loading, centering, orientation, and caching of the new 3D mosquito character
 * from public/assets/8342f1f2-a89c-4c3d-905c-3b9dd942498a.glb.
 */

import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import mosquitoGlbUrl from '../assets/8342f1f2-a89c-4c3d-905c-3b9dd942498a.glb?url';

type ModelLoadCallback = (template: THREE.Group) => void;

class MosquitoModelLoader {
  private loader: GLTFLoader = new GLTFLoader();
  private baseTemplate: THREE.Group | null = null;
  private bossTemplate: THREE.Group | null = null;
  private isLoading: boolean = false;
  private listeners: ModelLoadCallback[] = [];

  constructor() {
    this.startLoading();
  }

  public isLoaded(): boolean {
    return this.baseTemplate !== null;
  }

  public onReady(cb: ModelLoadCallback): () => void {
    if (this.baseTemplate) {
      cb(this.baseTemplate);
      return () => {};
    }
    this.listeners.push(cb);
    return () => {
      this.listeners = this.listeners.filter((l) => l !== cb);
    };
  }

  private startLoading() {
    if (this.isLoading || this.baseTemplate) return;
    this.isLoading = true;

    // Load the new 3D mosquito character
    const candidateUrls = [
      mosquitoGlbUrl,
      '/assets/8342f1f2-a89c-4c3d-905c-3b9dd942498a.glb',
      '/public/assets/8342f1f2-a89c-4c3d-905c-3b9dd942498a.glb',
      '/src/assets/8342f1f2-a89c-4c3d-905c-3b9dd942498a.glb',
    ];

    const tryLoad = (index: number) => {
      if (index >= candidateUrls.length) {
        console.warn('[MosquitoModelLoader] All GLB candidate URLs failed, using procedural fallback');
        this.isLoading = false;
        return;
      }

      const url = candidateUrls[index];
      this.loader.load(
        url,
        (gltf) => {
          this.processLoadedModel(gltf.scene);
          this.isLoading = false;
          this.notifyListeners();
        },
        undefined,
        (err) => {
          console.warn(`[MosquitoModelLoader] Could not load from ${url}:`, err);
          tryLoad(index + 1);
        }
      );
    };

    tryLoad(0);
  }

  private processLoadedModel(rawScene: THREE.Group) {
    const root = new THREE.Group();
    root.name = 'Mosquito_GLTF_Root';

    // Clone clean instance
    const model = rawScene.clone(true);

    // Compute bounding box to normalize pivot & scale
    const box = new THREE.Box3().setFromObject(model);
    const center = box.getCenter(new THREE.Vector3());
    const size = box.getSize(new THREE.Vector3());

    // Center geometry so rotation pivot is inside thorax / center of mass
    model.position.sub(center);

    // Orient forward flight direction along -Z
    // In this model, the proboscis/head points along +X, wings along Z, and Y is UP.
    // Rotating +90 degrees (+Math.PI / 2) around Y turns +X into -Z (Forward) and Z into X (Wings).
    model.rotation.y = Math.PI / 2;

    // Target length is ~1.15m to match game world scale
    const maxDim = Math.max(size.x, size.y, size.z);
    const targetScale = maxDim > 0 ? 1.15 / maxDim : 1.0;
    model.scale.setScalar(targetScale);

    // Configure materials for maximum clarity, realistic chitin specular reflections and AR visibility
    model.traverse((child) => {
      if ((child as THREE.Mesh).isMesh) {
        const mesh = child as THREE.Mesh;
        mesh.castShadow = true;
        mesh.receiveShadow = true;

        if (mesh.material) {
          const mat = mesh.material as THREE.MeshStandardMaterial;
          mat.side = THREE.DoubleSide;
          mat.roughness = 0.38;
          mat.metalness = 0.22;
          if (mat.map) {
            mat.map.colorSpace = THREE.SRGBColorSpace;
          } else {
            mat.color.setHex(0x181a1e);
          }
        }
      }
    });

    root.add(model);

    // Add glowing compound eyes on the head for high visibility against all AR backgrounds
    const eyeGeo = new THREE.SphereGeometry(0.065, 8, 8);
    const standardEyeMat = new THREE.MeshStandardMaterial({
      color: 0xff3300,
      emissive: 0xff2200,
      emissiveIntensity: 0.95,
      roughness: 0.2,
      metalness: 0.1,
    });

    const leftEye = new THREE.Mesh(eyeGeo, standardEyeMat);
    leftEye.name = 'Mosquito_LeftEye';
    leftEye.position.set(-0.07, 0.05, -0.42);

    const rightEye = new THREE.Mesh(eyeGeo, standardEyeMat);
    rightEye.name = 'Mosquito_RightEye';
    rightEye.position.set(0.07, 0.05, -0.42);

    root.add(leftEye, rightEye);

    this.baseTemplate = root;

    // --- Specialized Boss Template (Level 3 King Mosquito) ---
    this.bossTemplate = root.clone(true);
    this.bossTemplate.name = 'Mosquito_GLTF_Boss';

    this.bossTemplate.traverse((child) => {
      if ((child as THREE.Mesh).isMesh) {
        const mesh = child as THREE.Mesh;
        if (mesh.name === 'Mosquito_LeftEye' || mesh.name === 'Mosquito_RightEye') {
          mesh.material = new THREE.MeshStandardMaterial({
            color: 0xff0044,
            emissive: 0xff0033,
            emissiveIntensity: 1.5,
            roughness: 0.15,
            metalness: 0.1,
          });
        } else if (mesh.material) {
          const mat = (mesh.material as THREE.Material).clone() as THREE.MeshStandardMaterial;
          mat.side = THREE.DoubleSide;
          mat.roughness = 0.32;
          mat.metalness = 0.38;
          mat.color.setHex(0x380616); // Deep demonic bloodstone crimson
          mat.emissive.setHex(0x550619);
          mat.emissiveIntensity = 0.45;
          mesh.material = mat;
        }
      }
    });
  }

  private notifyListeners() {
    if (!this.baseTemplate) return;
    this.listeners.forEach((cb) => {
      try {
        cb(this.baseTemplate!);
      } catch (err) {
        console.error('[MosquitoModelLoader] Error in listener callback:', err);
      }
    });
    this.listeners = [];
  }

  /**
   * Returns a fresh clone of the new 3D mosquito character
   */
  public createInstance(isBoss: boolean = false): THREE.Group | null {
    const template = isBoss ? this.bossTemplate : this.baseTemplate;
    if (!template) return null;
    return template.clone(true);
  }
}

export const mosquitoModelLoader = new MosquitoModelLoader();
