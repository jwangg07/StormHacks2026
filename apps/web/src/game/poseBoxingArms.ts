import { Quaternion, Vector3 } from 'three';
import type { Object3D } from 'three';
import { aim, GUARD, restPose, SIDES } from '../avatar/rig';
import type { FighterRig, Side } from '../avatar/rig';
import {
  BLOCK_POSE,
  mixPose,
  punchPose,
  PUNCH_REACH_BOOST,
  strikeStrength,
} from './boxingAnimation';
import type { PunchCue } from './boxingAnimation';

const target = new Vector3();
const rootRotation = new Quaternion();

/** Pose only the arm bones; the fighter's root and opposite arm stay in place. */
export function poseBoxingArms(
  root: Object3D,
  rig: FighterRig,
  armScales: Record<Side, Vector3>,
  punch: PunchCue | null,
  elapsed: number,
  blockBlend: number,
) {
  const strength = strikeStrength(elapsed);
  for (const side of SIDES)
    rig.arms[side].upper.scale
      .copy(armScales[side])
      .multiplyScalar(punch?.hand === side ? 1 + strength * PUNCH_REACH_BOOST : 1);
  restPose(rig);
  root.getWorldQuaternion(rootRotation);
  for (const side of SIDES) {
    const arm = rig.arms[side];
    const idle = mixPose(GUARD[side], BLOCK_POSE[side], blockBlend);
    const goal = punch?.hand === side ? (punchPose(punch.move, side, elapsed, idle) ?? idle) : idle;
    aim(
      arm.upper,
      arm.fore,
      target.set(goal.upper.x, goal.upper.y, goal.upper.z).applyQuaternion(rootRotation),
    );
    aim(
      arm.fore,
      arm.hand,
      target.set(goal.fore.x, goal.fore.y, goal.fore.z).applyQuaternion(rootRotation),
    );
  }
}
