import { useEffect, useState, useSyncExternalStore } from 'react';
import { SRGBColorSpace, Texture } from 'three';

const DB_NAME = 'webcamboxer';
const STORE = 'skin';
const KEY = 'local';

let skin: Blob | null = null;
let loading: Promise<void> | null = null;
const listeners = new Set<() => void>();

function emit() {
  for (const listener of listeners) listener();
}

function request<T>(mode: IDBTransactionMode, run: (store: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    const open = indexedDB.open(DB_NAME, 1);
    open.onupgradeneeded = () => open.result.createObjectStore(STORE);
    open.onerror = () => reject(open.error);
    open.onsuccess = () => {
      const db = open.result;
      const call = run(db.transaction(STORE, mode).objectStore(STORE));
      call.onsuccess = () => {
        resolve(call.result);
        db.close();
      };
      call.onerror = () => {
        reject(call.error);
        db.close();
      };
    };
  });
}

function subscribe(listener: () => void) {
  loading ??= request<unknown>('readonly', (store) => store.get(KEY))
    .then((stored) => {
      if (stored instanceof Blob && !skin) {
        skin = stored;
        emit();
      }
    })
    .catch(() => undefined);
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/** The player's saved skin JPEG, or null for the default look. */
export function useSkinBlob(): Blob | null {
  return useSyncExternalStore(subscribe, () => skin, () => null);
}

/** Returns false when the browser blocks storage; the skin then lasts for this session only. */
export async function saveSkin(blob: Blob): Promise<boolean> {
  skin = blob;
  emit();
  try {
    await request('readwrite', (store) => store.put(blob, KEY));
    return true;
  } catch {
    return false;
  }
}

export async function clearSkin(): Promise<void> {
  skin = null;
  emit();
  await request('readwrite', (store) => store.delete(KEY)).catch(() => undefined);
}

const textures = new WeakMap<Blob, Promise<Texture>>();

/** One GPU texture per skin blob, shared by every fighter showing it. */
export function textureForBlob(blob: Blob): Promise<Texture> {
  let texture = textures.get(blob);
  if (!texture) {
    texture = createImageBitmap(blob).then((bitmap) => {
      const next = new Texture(bitmap);
      next.colorSpace = SRGBColorSpace;
      // glTF UVs start at the image's top-left; ImageBitmaps upload unflipped.
      next.flipY = false;
      next.needsUpdate = true;
      return next;
    });
    textures.set(blob, texture);
  }
  return texture;
}

export function useBlobTexture(blob: Blob | null): Texture | null {
  const [loaded, setLoaded] = useState<{ blob: Blob; texture: Texture } | null>(null);
  useEffect(() => {
    if (!blob) return;
    let live = true;
    void textureForBlob(blob).then((texture) => {
      if (live) setLoaded({ blob, texture });
    });
    return () => {
      live = false;
    };
  }, [blob]);
  return blob && loaded?.blob === blob ? loaded.texture : null;
}

export function useSkin(): Texture | null {
  return useBlobTexture(useSkinBlob());
}
