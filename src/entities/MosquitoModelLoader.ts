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
          const mats = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
          mats.forEach((m) => {
            const stdMat = m as THREE.MeshStandardMaterial;
            stdMat.side = THREE.DoubleSide;
            if (stdMat.map) {
              stdMat.map.colorSpace = THREE.SRGBColorSpace;
            }
            // Preserve the original textures, vertex colors and chitin patterns from the user's GLB model!
          });
        }
      }
    });

    root.add(model);

    // Add smaller compound eyes on the head with subtle insect glow
    const eyeGeo = new THREE.SphereGeometry(0.038, 8, 8);
    const standardEyeMat = new THREE.MeshStandardMaterial({
      color: 0x991b1b,
      emissive: 0x7f1d1d,
      emissiveIntensity: 0.75,
      roughness: 0.25,
      metalness: 0.1,
    });

    const leftEye = new THREE.Mesh(eyeGeo, standardEyeMat);
    leftEye.name = 'Mosquito_LeftEye';
    leftEye.position.set(-0.06, 0.04, -0.42);

    const rightEye = new THREE.Mesh(eyeGeo, standardEyeMat);
    rightEye.name = 'Mosquito_RightEye';
    rightEye.position.set(0.06, 0.04, -0.42);

    root.add(leftEye, rightEye);

    this.baseTemplate = root;

    // --- Specialized Boss Template (Level 3 King Mosquito) ---
    // Preserves the full authentic colors, textures and striped patterns of the attached model!
    this.bossTemplate = root.clone(true);
    this.bossTemplate.name = 'Mosquito_GLTF_Boss';

    this.bossTemplate.traverse((child) => {
      if ((child as THREE.Mesh).isMesh) {
        const mesh = child as THREE.Mesh;
        if (mesh.name === 'Mosquito_LeftEye' || mesh.name === 'Mosquito_RightEye') {
          // Smaller refined red eyes
          mesh.scale.setScalar(0.7);
          mesh.material = new THREE.MeshStandardMaterial({
            color: 0x991b1b,
            emissive: 0x450a0a,
            emissiveIntensity: 0.5,
            roughness: 0.25,
            metalness: 0.1,
          });
        } else if (mesh.material) {
          // Clone material so boss is independent, retaining all original colors, maps and textures of the attached 3D model
          if (Array.isArray(mesh.material)) {
            mesh.material = mesh.material.map((mat) => {
              const m = mat.clone();
              m.side = THREE.DoubleSide;
              return m;
            });
          } else {
            const m = mesh.material.clone();
            m.side = THREE.DoubleSide;
            mesh.material = m;
          }
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
