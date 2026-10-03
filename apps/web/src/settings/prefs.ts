export interface UserPrefs {
  muted: boolean;
  reducedMotion: boolean;
  sensitivity: number;
}

export const defaultPrefs: UserPrefs = {
  muted: false,
  reducedMotion: false,
  sensitivity: 1,
};
