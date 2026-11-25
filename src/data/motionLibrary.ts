import type {
  BonePoseAngles,
  CharacterInteractionMotionId,
  CustomClipSlot,
  CustomMotionPreset,
  CustomPoseKeyframe,
  ObjectInteractionAttributeId,
  ObjectInteractionCalibration,
} from '../types/maker';
import { uid } from '../utils/terrain';

export interface ObjectInteractionAttrDef {
  id: ObjectInteractionAttributeId;
  label: string;
  shortLabel: string;
  description: string;
  clipSlot: CustomClipSlot;
  defaultCalibration: ObjectInteractionCalibration;
}

export const OBJECT_INTERACTION_ATTRIBUTES: ObjectInteractionAttrDef[] = [
  {
    id: 'sit',
    label: 'Sit (Chair / Log / Rock / Stump)',
    shortLabel: 'Sit',
    description: 'Player can press Use in front of it to turn around and sit down to recover Energy.',
    clipSlot: 'sit',
    defaultCalibration: { offset: [0, 0.42, 0.22], yawDeg: 0 },
  },
  {
    id: 'hold',
    label: 'Hold / Carry',
    shortLabel: 'Hold',
    description: 'Character grips and carries the item cleanly in hand.',
    clipSlot: 'hold',
    defaultCalibration: { offset: [0.3, 0.85, 0.35], yawDeg: 0 },
  },
  {
    id: 'swing',
    label: 'Swing (Axe / Sword / Tool)',
    shortLabel: 'Swing',
    description: 'Wide forehand right-hand swing with elbow wind-up.',
    clipSlot: 'swing',
    defaultCalibration: { offset: [0, 0, 1.05], yawDeg: 0 },
  },
  {
    id: 'throw',
    label: 'Throw',
    shortLabel: 'Throw',
    description: 'Overhand wind-up and forward release.',
    clipSlot: 'throw',
    defaultCalibration: { offset: [0, 0, 1.1], yawDeg: 0 },
  },
  {
    id: 'sleep',
    label: 'Sleep / Lie Down',
    shortLabel: 'Sleep',
    description: 'Recline horizontally on a bed, mat, or camp roll.',
    clipSlot: 'sleep',
    defaultCalibration: { offset: [0, 0.45, 0], yawDeg: 90 },
  },
  {
    id: 'jump',
    label: 'Jump / Spring',
    shortLabel: 'Jump',
    description: 'Vertical leap or springboard launch motion.',
    clipSlot: 'jump',
    defaultCalibration: { offset: [0, 0.5, 0], yawDeg: 0 },
  },
  {
    id: 'fishing',
    label: 'Fishing',
    shortLabel: 'Fishing',
    description: 'Cast line, wait on dock/bank, and reel in.',
    clipSlot: 'fishing',
    defaultCalibration: { offset: [0, 0, -0.9], yawDeg: 0 },
  },
  {
    id: 'lift',
    label: 'Lift Heavy Object',
    shortLabel: 'Lift',
    description: 'Bend knees and hoist overhead or chest-high.',
    clipSlot: 'lift',
    defaultCalibration: { offset: [0, 0, -0.75], yawDeg: 0 },
  },
  {
    id: 'pull',
    label: 'Pull (Lever / Crate / Rope)',
    shortLabel: 'Pull',
    description: 'Lean back with both hands gripping and drawing inward.',
    clipSlot: 'pull',
    defaultCalibration: { offset: [0, 0, -0.82], yawDeg: 0 },
  },
  {
    id: 'push',
    label: 'Push (Block / Crate / Cart)',
    shortLabel: 'Push',
    description: 'Brace forward with both palms pressed against surface.',
    clipSlot: 'push',
    defaultCalibration: { offset: [0, 0, -0.82], yawDeg: 0 },
  },
  {
    id: 'dig',
    label: 'Dig (Shovel / Pick)',
    shortLabel: 'Dig',
    description: 'Two-handed downward scoop and earth-toss cycle.',
    clipSlot: 'dig',
    defaultCalibration: { offset: [0, 0, -0.85], yawDeg: 0 },
  },
  {
    id: 'climbVertical',
    label: 'Climb Up / Down (Ladder / Tree / Cliff)',
    shortLabel: 'Climb Vertical',
    description: 'Alternating hand-over-hand & knee drive vertical climb.',
    clipSlot: 'climbVertical',
    defaultCalibration: { offset: [0, 0.2, -0.62], yawDeg: 0 },
  },
  {
    id: 'climbStairs',
    label: 'Climb Stairs (Up / Down)',
    shortLabel: 'Climb Stairs',
    description: 'Higher-knee stair stepping gait for stairs and ramps.',
    clipSlot: 'climbStairs',
    defaultCalibration: { offset: [0, 0.35, 0], yawDeg: 0 },
  },
  {
    id: 'crouch',
    label: 'Crouch / Inspect Low',
    shortLabel: 'Crouch',
    description: 'Lowered stance with bent knees for low passages or inspection.',
    clipSlot: 'crouch',
    defaultCalibration: { offset: [0, 0, -0.75], yawDeg: 0 },
  },
  {
    id: 'sneak',
    label: 'Sneak / Creep',
    shortLabel: 'Sneak',
    description: 'Quiet low-profile crouched tip-toe walk past objects.',
    clipSlot: 'sneak',
    defaultCalibration: { offset: [0, 0, -0.85], yawDeg: 0 },
  },
  {
    id: 'stab',
    label: 'Stab / Thrust',
    shortLabel: 'Stab',
    description: 'Direct forward lunge and weapon thrust.',
    clipSlot: 'stab',
    defaultCalibration: { offset: [0, 0, -1.05], yawDeg: 0 },
  },
  {
    id: 'bowPull',
    label: 'Pull Bowstring',
    shortLabel: 'Bow Pull',
    description: 'Left arm extended aiming forward while right hand draws bowstring.',
    clipSlot: 'bowPull',
    defaultCalibration: { offset: [0, 0, -1.0], yawDeg: 0 },
  },
];

export const OBJECT_ATTRIBUTE_BY_ID: Record<
  ObjectInteractionAttributeId,
  ObjectInteractionAttrDef
> = OBJECT_INTERACTION_ATTRIBUTES.reduce(
  (acc, item) => {
    acc[item.id] = item;
    return acc;
  },
  {} as Record<ObjectInteractionAttributeId, ObjectInteractionAttrDef>
);

export function getClipSlotForObjectAttribute(
  attr: ObjectInteractionAttributeId
): CustomClipSlot {
  return OBJECT_ATTRIBUTE_BY_ID[attr]?.clipSlot ?? 'interact';
}

export interface CharacterInteractionMotionDef {
  id: CharacterInteractionMotionId;
  clipSlot: CustomClipSlot;
  label: string;
  description: string;
}

export const CHARACTER_INTERACTION_MOTIONS: CharacterInteractionMotionDef[] = [
  {
    id: 'hug',
    clipSlot: 'hug',
    label: 'Hug (Character Interaction)',
    description: 'Warm forward lean with both arms wrapping around a friend.',
  },
  {
    id: 'punch',
    clipSlot: 'punch',
    label: 'Punch (Character Interaction)',
    description: 'Crisp cross-body right fist strike with guard left hand.',
  },
  {
    id: 'push',
    clipSlot: 'push',
    label: 'Push (Character / Object)',
    description: 'Two-handed forward shove stance.',
  },
  {
    id: 'kick',
    clipSlot: 'kick',
    label: 'Kick (Character Interaction)',
    description: 'Balanced high front snap kick.',
  },
];

export interface StandardMotionSlotOption {
  slot: CustomClipSlot;
  label: string;
  group: 'core' | 'object' | 'character';
  hint: string;
}

export const STANDARD_MOTION_SLOTS: StandardMotionSlotOption[] = [
  { slot: 'idle', label: 'Idle (Stand)', group: 'core', hint: 'Default standing breathing stance' },
  { slot: 'walk', label: 'Walk Cycle', group: 'core', hint: 'Balanced walking gait' },
  { slot: 'run', label: 'Run Cycle', group: 'core', hint: 'Energetic sprint cycle' },
  { slot: 'jump', label: 'Jump', group: 'core', hint: 'Airborne leap / springboard jump' },
  { slot: 'swim', label: 'Swim', group: 'core', hint: 'Water stroke and kick' },
  { slot: 'attack', label: 'Attack (Weapon Swing)', group: 'core', hint: 'Primary forehand melee strike' },
  { slot: 'interact', label: 'Interact / Wave', group: 'core', hint: 'General hand wave / use emote' },
  // Object interactions
  { slot: 'sit', label: 'Sit', group: 'object', hint: 'Seated hip & knee bend for chairs, logs, rocks, stumps' },
  { slot: 'hold', label: 'Hold / Carry', group: 'object', hint: 'Grip pose for held items' },
  { slot: 'swing', label: 'Swing Tool', group: 'object', hint: 'Forehand axe or sword swing' },
  { slot: 'throw', label: 'Throw', group: 'object', hint: 'Overhand wind-up & release' },
  { slot: 'sleep', label: 'Sleep / Lie Down', group: 'object', hint: 'Reclined rest pose (for beds later)' },
  { slot: 'fishing', label: 'Fishing', group: 'object', hint: 'Cast and hold fishing rod' },
  { slot: 'lift', label: 'Lift', group: 'object', hint: 'Hoist crate or rock upward' },
  { slot: 'pull', label: 'Pull', group: 'object', hint: 'Lean back pulling rope or lever' },
  { slot: 'push', label: 'Push', group: 'object', hint: 'Two-handed forward push (objects & characters)' },
  { slot: 'dig', label: 'Dig', group: 'object', hint: 'Shovel plunge and earth toss' },
  { slot: 'climbVertical', label: 'Climb Vertical', group: 'object', hint: 'Climb ladders, trees, and rockfaces' },
  { slot: 'climbStairs', label: 'Climb Stairs', group: 'object', hint: 'High-step ascending/descending stairs' },
  { slot: 'crouch', label: 'Crouch', group: 'object', hint: 'Low crouched stance' },
  { slot: 'sneak', label: 'Sneak', group: 'object', hint: 'Stealthy low creep cycle' },
  { slot: 'stab', label: 'Stab / Thrust', group: 'object', hint: 'Forward lunge weapon thrust' },
  { slot: 'bowPull', label: 'Pull Bowstring', group: 'object', hint: 'Aiming bow and drawing string back' },
  // Character-to-character interactions
  { slot: 'hug', label: 'Hug', group: 'character', hint: 'Warm two-armed embrace' },
  { slot: 'punch', label: 'Punch', group: 'character', hint: 'Quick right-hand punch' },
  { slot: 'kick', label: 'Kick', group: 'character', hint: 'Front snap kick' },
];

type RolePoseMap = Partial<
  Record<
    | 'hips'
    | 'spine'
    | 'chest'
    | 'head'
    | 'leftUpperArm'
    | 'leftLowerArm'
    | 'rightUpperArm'
    | 'rightLowerArm'
    | 'leftUpperLeg'
    | 'leftLowerLeg'
    | 'rightUpperLeg'
    | 'rightLowerLeg',
    BonePoseAngles
  >
>;

function mapRolePosesToBoneMap(
  boneMap: Partial<Record<string, string>>,
  roles: RolePoseMap
): Record<string, BonePoseAngles> {
  const out: Record<string, BonePoseAngles> = {};
  for (const [role, angles] of Object.entries(roles)) {
    const boneName = boneMap[role];
    if (boneName && angles) {
      out[boneName] = angles;
    }
  }
  return out;
}

/**
 * Generates an editable keyframe preset for any standard motion slot using the character's mapped bones,
 * so creators can inspect, tweak, and calibrate any standard action in Motion Maker or Object Tester.
 */
export function buildStandardMotionPresetTemplate(
  slot: CustomClipSlot,
  boneMap: Partial<Record<string, string>>,
  customName?: string
): CustomMotionPreset {
  const meta = STANDARD_MOTION_SLOTS.find((s) => s.slot === slot);
  const mkFrame = (
    time: number,
    roles: RolePoseMap,
    hipsOffsetY = 0
  ): CustomPoseKeyframe => ({
    id: uid(),
    time,
    bones: mapRolePosesToBoneMap(boneMap, roles),
    hipsOffsetY,
    easing: 'smooth',
  });

  let duration = 1.0;
  let loop = true;
  let keyframes: CustomPoseKeyframe[];

  switch (slot) {
    case 'sit':
      duration = 1.4;
      keyframes = [
        mkFrame(
          0,
          {
            spine: [4, 0, 0],
            leftUpperLeg: [-82, 6, 0],
            rightUpperLeg: [-82, -6, 0],
            leftLowerLeg: [84, 0, 0],
            rightLowerLeg: [84, 0, 0],
            leftUpperArm: [-24, 0, 12],
            rightUpperArm: [-24, 0, -12],
            leftLowerArm: [-35, 0, 0],
            rightLowerArm: [-35, 0, 0],
          },
          -0.28
        ),
        mkFrame(
          0.5,
          {
            spine: [8, 0, 0],
            head: [4, 4, 0],
            leftUpperLeg: [-82, 6, 0],
            rightUpperLeg: [-82, -6, 0],
            leftLowerLeg: [84, 0, 0],
            rightLowerLeg: [84, 0, 0],
            leftUpperArm: [-22, 0, 12],
            rightUpperArm: [-22, 0, -12],
            leftLowerArm: [-36, 0, 0],
            rightLowerArm: [-36, 0, 0],
          },
          -0.29
        ),
      ];
      break;
    case 'hug':
      duration = 1.2;
      keyframes = [
        mkFrame(0, {
          spine: [10, 0, 0],
          leftUpperArm: [-68, 28, 18],
          rightUpperArm: [-68, -28, -18],
          leftLowerArm: [-52, 0, 0],
          rightLowerArm: [-52, 0, 0],
        }),
        mkFrame(0.5, {
          spine: [16, 0, 0],
          head: [6, 10, 8],
          leftUpperArm: [-78, 48, 8],
          rightUpperArm: [-78, -48, -8],
          leftLowerArm: [-68, 0, 0],
          rightLowerArm: [-68, 0, 0],
        }),
      ];
      break;
    case 'punch':
      duration = 0.55;
      loop = false;
      keyframes = [
        mkFrame(0, {
          spine: [6, -24, 0],
          leftUpperArm: [-52, 16, 18],
          leftLowerArm: [-74, 0, 0],
          rightUpperArm: [18, -12, -24],
          rightLowerArm: [-88, 0, 0],
        }),
        mkFrame(0.35, {
          spine: [14, 34, 0],
          chest: [6, 18, 0],
          leftUpperArm: [-40, 12, 22],
          leftLowerArm: [-86, 0, 0],
          rightUpperArm: [-92, 12, -6],
          rightLowerArm: [-8, 0, 0],
        }),
        mkFrame(1.0, {
          spine: [4, 0, 0],
          leftUpperArm: [-36, 10, 16],
          rightUpperArm: [-36, -10, -16],
        }),
      ];
      break;
    case 'kick':
      duration = 0.65;
      loop = false;
      keyframes = [
        mkFrame(0, {
          spine: [-8, 0, 0],
          rightUpperLeg: [-36, 0, 0],
          rightLowerLeg: [92, 0, 0],
          leftUpperArm: [-42, 0, 26],
          rightUpperArm: [-20, 0, -28],
        }),
        mkFrame(0.42, {
          spine: [-16, -14, 0],
          rightUpperLeg: [-92, 0, 0],
          rightLowerLeg: [8, 0, 0],
          leftUpperLeg: [14, 0, 0],
          leftLowerLeg: [12, 0, 0],
        }),
        mkFrame(1.0, {
          spine: [0, 0, 0],
          rightUpperLeg: [0, 0, 0],
          rightLowerLeg: [6, 0, 0],
        }),
      ];
      break;
    case 'push':
      duration = 0.9;
      keyframes = [
        mkFrame(0, {
          spine: [20, 0, 0],
          leftUpperArm: [-78, 0, 12],
          rightUpperArm: [-78, 0, -12],
          leftLowerArm: [-28, 0, 0],
          rightLowerArm: [-28, 0, 0],
          leftUpperLeg: [-24, 0, 0],
          rightUpperLeg: [28, 0, 0],
        }),
        mkFrame(0.5, {
          spine: [28, 0, 0],
          leftUpperArm: [-88, 0, 8],
          rightUpperArm: [-88, 0, -8],
          leftLowerArm: [-10, 0, 0],
          rightLowerArm: [-10, 0, 0],
          leftUpperLeg: [-32, 0, 0],
          rightUpperLeg: [36, 0, 0],
        }),
      ];
      break;
    case 'climbVertical':
      duration = 0.9;
      keyframes = [
        mkFrame(0, {
          spine: [10, 0, 0],
          leftUpperArm: [-138, 0, 16],
          leftLowerArm: [-44, 0, 0],
          rightUpperArm: [-70, 0, -16],
          rightLowerArm: [-68, 0, 0],
          leftUpperLeg: [-26, 0, 0],
          leftLowerLeg: [52, 0, 0],
          rightUpperLeg: [-76, 0, 0],
          rightLowerLeg: [92, 0, 0],
        }),
        mkFrame(0.5, {
          spine: [10, 0, 0],
          leftUpperArm: [-70, 0, 16],
          leftLowerArm: [-68, 0, 0],
          rightUpperArm: [-138, 0, -16],
          rightLowerArm: [-44, 0, 0],
          leftUpperLeg: [-76, 0, 0],
          leftLowerLeg: [92, 0, 0],
          rightUpperLeg: [-26, 0, 0],
          rightLowerLeg: [52, 0, 0],
        }),
      ];
      break;
    default:
      duration = 0.9;
      keyframes = [
        mkFrame(0, {
          spine: [8, -10, 0],
          rightUpperArm: [-48, 0, -18],
          rightLowerArm: [-42, 0, 0],
          leftUpperArm: [-24, 0, 18],
        }),
        mkFrame(0.5, {
          spine: [12, 12, 0],
          rightUpperArm: [-78, 0, -10],
          rightLowerArm: [-24, 0, 0],
          leftUpperArm: [-36, 0, 14],
        }),
      ];
      break;
  }

  return {
    id: uid(),
    name: customName ?? meta?.label ?? slot,
    slot,
    duration,
    loop,
    autoCloseLoop: loop,
    easing: 'smooth',
    keyframes,
    updatedAt: new Date().toISOString(),
  };
}
