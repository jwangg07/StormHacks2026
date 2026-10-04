export const SLOT_COUNT = 8;
export const SLOT_STEP_DEG = 360 / SLOT_COUNT;
export const SLOT_WINDOW_DEG = 20;
export const MIN_SLOTS_TO_FINISH = 6;

export function slotFor(yawDeg: number): number | null {
  const wrapped = ((yawDeg % 360) + 360) % 360;
  const slot = Math.round(wrapped / SLOT_STEP_DEG) % SLOT_COUNT;
  const offset = Math.abs(wrapped - slot * SLOT_STEP_DEG);
  return Math.min(offset, 360 - offset) <= SLOT_WINDOW_DEG ? slot : null;
}

/** Best value per angle slot. Check `accepts` before building an expensive value. */
export class SlotBuffer<T> {
  private slots: ({ score: number; value: T } | null)[] = Array(SLOT_COUNT).fill(null);

  accepts(slot: number, score: number): boolean {
    const current = this.slots[slot];
    return !current || score > current.score;
  }

  put(slot: number, score: number, value: T) {
    this.slots[slot] = { score, value };
  }

  get filled(): boolean[] {
    return this.slots.map(Boolean);
  }

  get count(): number {
    return this.slots.filter(Boolean).length;
  }

  values(): T[] {
    return this.slots.flatMap((entry) => (entry ? [entry.value] : []));
  }

  clear() {
    this.slots = Array(SLOT_COUNT).fill(null);
  }
}

/**
 * What the capture does after a frame: bake once every slot is filled, or when the turn
 * is done with enough slots; a done turn with too few slots means the player turned too fast.
 */
export function captureStep({ done, filled }: { done: boolean; filled: number }): 'continue' | 'bake' | 'too-few' {
  if (filled >= SLOT_COUNT) return 'bake';
  if (!done) return 'continue';
  return filled >= MIN_SLOTS_TO_FINISH ? 'bake' : 'too-few';
}
