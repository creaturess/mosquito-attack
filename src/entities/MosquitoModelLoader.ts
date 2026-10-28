/**
 * MosquitoModelLoader.ts
 * Manages asynchronous loading, centering, scaling, and caching
 * of the 3D mosquito GLTF asset from src/assets/scene.gltf.
 */

import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import sceneGltfUrl from '../assets/scene.gltf?url';

type ModelLoadCallback = (template: THREE.Group) => void;

class MosquitoModelLoader {
  private loader: GLTFLoader = new GLTFLoader();
  private baseTemplate: THREE.Group | null = null;
  private bossTemplate: THREE.Group | null = null;
  private isLoading: boolean = false;
  private loadError: Error | null = null;
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

    // Try primary asset URL from Vite, with fallback to standard dev/prod paths
    const candidateUrls = [
      sceneGltfUrl,
      '/src/assets/scene.gltf',
      '/assets/scene.gltf',
      'src/assets/scene.gltf',
    ];

    const tryLoad = (index: number) => {
      if (index >= candidateUrls.length) {
        console.warn('[MosquitoModelLoader] All GLTF candidate URLs failed, falling back to procedural model');
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

    // Clone to work on a clean instance
    const model = rawScene.clone(true);

    // Compute bounding box to normalize pivot & scale
    const box = new THREE.Box3().setFromObject(model);
    const center = box.getCenter(new THREE.Vector3());
    const size = box.getSize(new THREE.Vector3());

    // Center geometry so rotation pivot is inside thorax/center of gravity
    model.position.sub(center);

    // Target length is ~1.0m to seamlessly match game world scale
    const maxDim = Math.max(size.x, size.y, size.z);
    const targetScale = maxDim > 0 ? 1.0 / maxDim : 1.0;
    model.scale.setScalar(targetScale);

    // Ensure forward flight direction aligns with -Z (Three.js convention)
    // The model's longest axis is Z
    root.add(model);

    // Process materials for crisp AR visibility
    model.traverse((child) => {
      if ((child as THREE.Mesh).isMesh) {
        const mesh = child as THREE.Mesh;
        mesh.castShadow = true;
        mesh.receiveShadow = true;

        if (mesh.material) {
          // If array of materials or single material
          const mats = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
          mats.forEach((mat) => {
            mat.transparent = false;
            mat.opacity = 1.0;
            mat.side = THREE.DoubleSide;
            if ('roughness' in mat) {
              (mat as THREE.MeshStandardMaterial).roughness = 0.4;
            }
            if ('metalness' in mat) {
              (mat as THREE.MeshStandardMaterial).metalness = 0.2;
            }
          });
        }
      }
    });

    this.baseTemplate = root;

    // Create specialized Boss template (dark crimson carapace, ominous glowing eyes)
    this.bossTemplate = root.clone(true);
    this.bossTemplate.name = 'Mosquito_GLTF_Boss';
    this.bossTemplate.traverse((child) => {
      if ((child as THREE.Mesh).isMesh) {
        const mesh = child as THREE.Mesh;
        if (mesh.material) {
          const mat = (mesh.material as THREE.Material).clone() as THREE.MeshStandardMaterial;
          if (mat.color) {
            mat.color.setHex(0x3a0918); // Dark venomous crimson
          }
          if (mat.emissive) {
            mat.emissive.setHex(0x440510);
            mat.emissiveIntensity = 0.35;
          }
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
   * Returns a fresh clone of the 3D GLTF model
   */
  public createInstance(isBoss: boolean = false): THREE.Group | null {
    const template = isBoss ? this.bossTemplate : this.baseTemplate;
    if (!template) return null;
    return template.clone(true);
  }
}

export const mosquitoModelLoader = new MosquitoModelLoader();
