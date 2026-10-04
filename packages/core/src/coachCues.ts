/** Fixed spoken lines shared by the server TTS route and in-game captions. */
export const COACH_CUES = {
  cameraOn: 'Turn on your camera, then step back until I can see your upper body and both hands.',
  cameraWaiting: 'Approve the camera permission prompt so I can see your stance and hands.',
  trackerLoading: 'Hold still for a moment while I bring your movement tracker online.',
  trackerRetry: 'The movement tracker has stopped. Tap retry tracking, then find your mark again.',
  findFrame:
    'Step back until your head, shoulders, elbows and both hands are inside the corner marks. Face the camera.',
  neutral:
    'Stand relaxed. Bend both elbows and hold your fists near your chest, below your face. Stay steady until the bar fills.',
  leftPunch: 'Now throw one controlled left punch. Bring your fist straight back to your chest.',
  rightPunch: 'Now throw one controlled right punch. Bring your fist straight back to your chest.',
  guard:
    'Raise both fists to your upper chest or shoulders. Keep your elbows relaxed and cover your face.',
  calibrationReady:
    'That is it. Your punches and guard are calibrated. You are clear to step into the ring.',
  combo: 'Three clean shots in a row. That is a combination. Keep your guard up and stay on them.',
  opponentBelowHalf: 'Your opponent is below fifty health. Keep your guard up and press forward.',
  opponentCritical:
    'Your opponent is below twenty-five health. They are hurt. Stay composed and finish strong.',
  fightFinished: 'That is the bell. The fight is over.',
} as const;

export type CoachCueId = keyof typeof COACH_CUES;

export const CALIBRATION_CUES = [
  'cameraOn',
  'cameraWaiting',
  'trackerLoading',
  'trackerRetry',
  'findFrame',
  'neutral',
  'leftPunch',
  'rightPunch',
  'guard',
  'calibrationReady',
] as const satisfies readonly CoachCueId[];

export type CalibrationCueId = (typeof CALIBRATION_CUES)[number];
