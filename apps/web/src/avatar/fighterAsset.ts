import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { extractModelData, findSkinnedMesh } from './skin/model';
import type { ModelData } from './skin/parts';

export const FIGHTER_URL = `${import.meta.env.BASE_URL}models/fighter.glb`;

let pending: Promise<ModelData> | null = null;

/** Bind-pose geometry for the bake worker; loaded once, retried after a failure. */
export function loadFighterModelData(): Promise<ModelData> {
  pending ??= new GLTFLoader()
    .loadAsync(FIGHTER_URL)
    .then((gltf) => extractModelData(findSkinnedMesh(gltf.scene)))
    .catch((error: unknown) => {
      pending = null;
      throw error;
    });
  return pending;
}
