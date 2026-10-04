import { Matrix4, Vector3 } from 'three';
import type { Object3D, SkinnedMesh } from 'three';
import type { ModelData } from './parts';

export function findSkinnedMesh(root: Object3D): SkinnedMesh {
  let found: SkinnedMesh | null = null;
  root.traverse((object) => {
    if (!found && (object as SkinnedMesh).isSkinnedMesh) found = object as SkinnedMesh;
  });
  if (!found) throw new Error('Fighter model has no skinned mesh.');
  return found;
}

/** Copy bind-pose geometry out of three.js so the worker and tests work with plain arrays. */
export function extractModelData(mesh: SkinnedMesh): ModelData {
  const geometry = mesh.geometry;
  const position = geometry.getAttribute('position');
  const uv = geometry.getAttribute('uv');
  const skinIndex = geometry.getAttribute('skinIndex');
  const skinWeight = geometry.getAttribute('skinWeight');
  if (!uv) throw new Error('Fighter model has no UVs. Re-run tools/blender/export_fighter.py.');
  const count = position.count;
  const positions = new Float32Array(count * 3);
  const uvs = new Float32Array(count * 2);
  const indices4 = new Uint16Array(count * 4);
  const weights4 = new Float32Array(count * 4);
  const point = new Vector3();
  for (let i = 0; i < count; i++) {
    point.fromBufferAttribute(position, i).applyMatrix4(mesh.bindMatrix);
    positions.set([point.x, point.y, point.z], i * 3);
    uvs.set([uv.getX(i), uv.getY(i)], i * 2);
    indices4.set([skinIndex.getX(i), skinIndex.getY(i), skinIndex.getZ(i), skinIndex.getW(i)], i * 4);
    weights4.set([skinWeight.getX(i), skinWeight.getY(i), skinWeight.getZ(i), skinWeight.getW(i)], i * 4);
  }
  const indices = geometry.index
    ? Uint32Array.from(geometry.index.array)
    : Uint32Array.from({ length: count }, (_, i) => i);
  const bind = new Matrix4();
  const bones = mesh.skeleton.bones.map((bone, i) => {
    point.setFromMatrixPosition(bind.copy(mesh.skeleton.boneInverses[i]).invert());
    return { name: bone.name, head: [point.x, point.y, point.z] as const };
  });
  return { positions, uvs, indices, skinIndex: indices4, skinWeight: weights4, bones };
}
