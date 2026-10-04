import { readFile } from 'node:fs/promises';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';

/** Parse the committed fighter.glb in Node (it has no textures, so no DOM is needed). */
export async function loadFighterScene() {
  const file = await readFile(new URL('../../public/models/fighter.glb', import.meta.url));
  const data = file.buffer.slice(file.byteOffset, file.byteOffset + file.byteLength);
  return new Promise((resolve, reject) => new GLTFLoader().parse(data, '', (gltf) => resolve(gltf.scene), reject));
}

export function findSkinned(root) {
  let found = null;
  root.traverse((object) => {
    if (!found && object.isSkinnedMesh) found = object;
  });
  if (!found) throw new Error('fighter.glb has no skinned mesh');
  return found;
}
