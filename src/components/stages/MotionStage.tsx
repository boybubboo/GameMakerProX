import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Bone,
  Bookmark,
  Box,
  Camera,
  Check,
  ChevronLeft,
  ChevronRight,
  CircleDot,
  Compass,
  Copy,
  Eye,
  Film,
  FlipHorizontal2,
  Ghost,
  KeyRound,
  Layers,
  Lock,
  Minus,
  Pause,
  Play,
  Plus,
  Repeat,
  RotateCcw,
  Save,
  SlidersHorizontal,
  Sparkles,
  Star,
  Trash2,
  Unlock,
  Upload,
  Zap,
} from 'lucide-react';
import { ActionsStage } from './ActionsStage';
import type { MakerStore } from '../../store/useMakerStore';
import {
  getCachedAssetSync,
  loadCustomAssetToCache,
  resolveRigSettings,
  type CachedGLTF,
} from '../../three/gltfAssetManager';
import {
  DEFAULT_SLOT_MOTION_TUNING,
  resolveSlotMotionTuning,
  sampleMotionPresetToPose,
  type RigTestOverride,
} from '../../three/proceduralRigAnimator';
import type {
  BonePoseAngles,
  CustomAssetMeta,
  CustomClipSlot,
  CustomMotionPreset,
  CustomPoseKeyframe,
  CustomRigSettings,
  MotionEasing,
  RigAnimationMode,
  SavedPosePreset,
  SlotMotionTuning,
} from '../../types/maker';
import { uid } from '../../utils/terrain';
import {
  analyzeLoopSeam,
  buildQuickJointList,
  EASING_OPTIONS,
  EasingCurveIcon,
  getFriendlyBoneLabel,
  getMirroredBoneCounterpart,
  mirrorPoseBones,
  type MirrorPoseMode,
} from '../shared/MotionEditorPanel';
import {
  RigPreviewStage,
  type GizmoAxisFilter,
  type OnionSkinConfig,
  type StageCameraPreset,
} from '../shared/RigPreviewStage';
import { SavedPosesSidebar } from '../shared/SavedPosesSidebar';
import {
  buildStandardMotionPresetTemplate,
  STANDARD_MOTION_SLOTS,
} from '../../data/motionLibrary';

const GIZMO_SIZE_MAP: Record<'M' | 'L' | 'XL', number> = {
  M: 1.05,
  L: 1.48,
  XL: 1.95,
};

const SLOT_OPTIONS: { slot: CustomClipSlot; label: string; short: string; group: 'core' | 'object' | 'character' }[] =
  STANDARD_MOTION_SLOTS.map((s) => ({
    slot: s.slot,
    label: s.label,
    short:
      s.slot === 'interact'
        ? 'Wave'
        : s.slot === 'climbVertical'
        ? 'Climb V.'
        : s.slot === 'climbStairs'
        ? 'Stairs'
        : s.slot === 'bowPull'
        ? 'Bow'
        : s.label.replace(/ \(.*\)$/, ''),
    group: s.group,
  }));

function createBlankMotionDraft(slot: CustomClipSlot): CustomMotionPreset {
  const slotTitle = SLOT_OPTIONS.find((s) => s.slot === slot)?.short ?? 'Move';
  return {
    id: uid(),
    name: `Custom ${slotTitle}`,
    slot,
    duration: slot === 'attack' ? 0.7 : slot === 'idle' ? 2.0 : 1.2,
    loop: slot !== 'attack' && slot !== 'jump',
    autoCloseLoop: true,
    easing: 'smooth',
    keyframes: [
      {
        id: uid(),
        time: 0,
        bones: {},
        hipsOffsetY: 0,
      },
    ],
    updatedAt: new Date().toISOString(),
  };
}

export const MotionStage: React.FC<{ store: MakerStore }> = ({ store }) => {
  // Prioritize hero's custom asset, then motionAssetId, then first rigged asset
  const riggedAssets = useMemo(() => {
    const chars = store.customAssets.filter(
      (a) => a.hasSkeleton || (a.boneNames && a.boneNames.length > 0) || a.category === 'character'
    );
    return chars.length > 0 ? chars : store.customAssets;
  }, [store.customAssets]);

  const defaultSelectedId = useMemo(() => {
    if (store.motionAssetId && store.customAssets.some((a) => a.id === store.motionAssetId)) {
      return store.motionAssetId;
    }
    const heroId = store.currentProject?.heroCustomAssetId;
    if (heroId && store.customAssets.some((a) => a.id === heroId)) {
      return heroId;
    }
    return riggedAssets[0]?.id ?? null;
  }, [store.motionAssetId, store.customAssets, store.currentProject?.heroCustomAssetId, riggedAssets]);

  const [selectedAssetId, setSelectedAssetId] = useState<string | null>(defaultSelectedId);

  // Sync if user jumped here from Asset Vault targeting a specific asset
  useEffect(() => {
    if (store.motionAssetId && store.customAssets.some((a) => a.id === store.motionAssetId)) {
      setSelectedAssetId(store.motionAssetId);
    } else if (!selectedAssetId && defaultSelectedId) {
      setSelectedAssetId(defaultSelectedId);
    }
  }, [store.motionAssetId, store.customAssets, selectedAssetId, defaultSelectedId]);

  const selectedAsset: CustomAssetMeta | null = useMemo(() => {
    if (!selectedAssetId) return riggedAssets[0] ?? null;
    return store.customAssets.find((a) => a.id === selectedAssetId) ?? riggedAssets[0] ?? null;
  }, [selectedAssetId, store.customAssets, riggedAssets]);

  const [cachedInfo, setCachedInfo] = useState<CachedGLTF | null>(null);
  const [uploading, setUploading] = useState(false);
  const [uploadErr, setUploadErr] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  // Viewport display state
  const [cameraPreset, setCameraPreset] = useState<StageCameraPreset>('threeQuarter');
  const [cameraResetNonce, setCameraResetNonce] = useState(0);
  const [showSkeleton, setShowSkeleton] = useState(false);
  const [xrayMesh, setXrayMesh] = useState(false);
  const [showGizmo, setShowGizmo] = useState(true);
  const [showJointDots, setShowJointDots] = useState(true);
  const [showLoopGhost, setShowLoopGhost] = useState(false);
  const [onionEnabled, setOnionEnabled] = useState(true);
  const [onionShowPrev, setOnionShowPrev] = useState(true);
  const [onionShowNext, setOnionShowNext] = useState(true);
  const [onionOpacity, setOnionOpacity] = useState(0.34);
  const [liveMirror, setLiveMirror] = useState(false);
  const [gizmoSizePreset, setGizmoSizePreset] = useState<'M' | 'L' | 'XL'>('L');
  const [gizmoAxisFilter, setGizmoAxisFilter] = useState<GizmoAxisFilter>('all');
  const [lockCameraOrbit, setLockCameraOrbit] = useState(false);

  // Motion Editor state
  const studioMode = store.motionSection;
  const setStudioMode = store.setMotionSection;
  const [gaitPaused, setGaitPaused] = useState<boolean>(false);
  const [gaitRigDraft, setGaitRigDraft] = useState<CustomRigSettings | null>(null);
  const [gaitDirty, setGaitDirty] = useState<boolean>(false);
  const [draft, setDraft] = useState<CustomMotionPreset>(() => createBlankMotionDraft('walk'));
  const [savedPresetId, setSavedPresetId] = useState<string | null>(null);
  const [playhead, setPlayhead] = useState<number>(0);
  const [isPlaying, setIsPlaying] = useState<boolean>(false);
  const [workingBones, setWorkingBones] = useState<Record<string, BonePoseAngles>>({});
  const [workingHipsY, setWorkingHipsY] = useState<number>(0);
  const [isDirtyPose, setIsDirtyPose] = useState<boolean>(false);
  const [selectedBone, setSelectedBone] = useState<string | null>(null);
  const [clipboardPose, setClipboardPose] = useState<{
    bones: Record<string, BonePoseAngles>;
    hipsY: number;
  } | null>(null);
  const [leftSidebarTab, setLeftSidebarTab] = useState<'poses' | 'library'>('poses');
  const [activeSavedPoseId, setActiveSavedPoseId] = useState<string | null>(null);
  const [toast, setToast] = useState<string | null>(null);

  const trackRef = useRef<HTMLDivElement | null>(null);
  const captureLivePoseRef = useRef<
    ((slot: CustomClipSlot) => { bones: Record<string, BonePoseAngles>; hipsOffsetY: number } | null) | null
  >(null);
  const capturePoseThumbnailRef = useRef<(() => string | null) | null>(null);

  const flashToast = useCallback((msg: string) => {
    setToast(msg);
    window.setTimeout(() => setToast((cur) => (cur === msg ? null : cur)), 2200);
  }, []);

  // Load parsed GLTF info & initialize draft when switching characters
  useEffect(() => {
    if (!selectedAsset) {
      setCachedInfo(null);
      return;
    }
    let cancelled = false;
    const sync = getCachedAssetSync(selectedAsset.id);
    if (sync) {
      setCachedInfo(sync);
    } else {
      setCachedInfo(null);
      void loadCustomAssetToCache(selectedAsset.id, selectedAsset.category).then((loaded) => {
        if (!cancelled) setCachedInfo(loaded);
      });
    }

    setIsPlaying(false);
    setGaitPaused(false);
    setGaitDirty(false);
    setPlayhead(0);
    setIsDirtyPose(false);
    setActiveSavedPoseId(null);
    const existing = selectedAsset.customAnimations?.[0];
    if (existing) {
      const cloned: CustomMotionPreset = JSON.parse(JSON.stringify(existing));
      setDraft(cloned);
      setSavedPresetId(cloned.id);
      const startSample = sampleMotionPresetToPose(cloned, 0);
      setWorkingBones(startSample.bones);
      setWorkingHipsY(startSample.hipsOffsetY);
    } else {
      const fresh = createBlankMotionDraft('walk');
      setDraft(fresh);
      setSavedPresetId(null);
      setWorkingBones({});
      setWorkingHipsY(0);
    }
    return () => {
      cancelled = true;
    };
  }, [selectedAsset?.id, selectedAsset?.category]);

  const boneNames = useMemo(() => {
    if (cachedInfo?.skeletonInfo.boneNames.length) return cachedInfo.skeletonInfo.boneNames;
    return selectedAsset?.boneNames ?? [];
  }, [cachedInfo, selectedAsset]);

  const effectiveRig: CustomRigSettings | null = useMemo(() => {
    if (!selectedAsset) return null;
    if (cachedInfo) return resolveRigSettings(cachedInfo, selectedAsset);
    if (selectedAsset.rigSettings) return selectedAsset.rigSettings;
    return {
      mode: selectedAsset.animationClips.length > 0 ? 'auto' : 'procedural',
      boneMap: {},
      limbSwingAxis: 'auto',
      armRelaxAngle: 0,
      armSpreadAngle: 0,
      idleArmSpreadAngle: 0,
      mirrorArmRelax: true,
      mirrorLimbSwing: false,
      motionStrength: 1,
      headMotion: 1,
      facingOffsetDeg: 0,
    };
  }, [cachedInfo, selectedAsset]);

  useEffect(() => {
    if (!effectiveRig) {
      setGaitRigDraft(null);
      return;
    }
    if (!gaitDirty) {
      setGaitRigDraft({
        ...effectiveRig,
        boneMap: { ...effectiveRig.boneMap },
        slotTuning: effectiveRig.slotTuning ? { ...effectiveRig.slotTuning } : undefined,
      });
    }
  }, [effectiveRig, selectedAsset?.id, gaitDirty]);

  const stageRig: CustomRigSettings | null =
    studioMode === 'gait' && gaitRigDraft ? gaitRigDraft : effectiveRig;

  const activeSlotTuning: SlotMotionTuning = useMemo(
    () => resolveSlotMotionTuning(stageRig ?? undefined, draft.slot),
    [stageRig, draft.slot]
  );

  const stageAsset: CustomAssetMeta | null = useMemo(() => {
    if (!selectedAsset) return null;
    if (studioMode !== 'gait') return selectedAsset;
    // In Base Gait mode, preview live procedural motion cleanly even if a keyframe preset overrides the slot
    if (!selectedAsset.defaultSlotPresets?.[draft.slot]) return selectedAsset;
    const nextDefs = { ...(selectedAsset.defaultSlotPresets ?? {}) };
    delete nextDefs[draft.slot];
    return {
      ...selectedAsset,
      defaultSlotPresets: nextDefs,
    };
  }, [selectedAsset, studioMode, draft.slot]);

  // Keep a valid bone selected
  useEffect(() => {
    if (boneNames.length > 0 && (!selectedBone || !boneNames.includes(selectedBone))) {
      const preferred =
        effectiveRig?.boneMap.rightUpperArm ??
        effectiveRig?.boneMap.head ??
        boneNames[0];
      setSelectedBone(preferred);
    }
  }, [boneNames, effectiveRig?.boneMap.rightUpperArm, effectiveRig?.boneMap.head, selectedBone]);

  const quickJoints = useMemo(
    () => (effectiveRig ? buildQuickJointList(boneNames, effectiveRig.boneMap) : []),
    [boneNames, effectiveRig]
  );

  // Organize silhouette body-map groups cleanly (Left Arm, Center Core, Right Arm, Left Leg, Right Leg)
  const bodySilhouette = useMemo(() => {
    const core = quickJoints.filter((q) => q.group === 'core');
    const leftArm = quickJoints.filter((q) => q.group === 'arms' && q.label.startsWith('L '));
    const rightArm = quickJoints.filter((q) => q.group === 'arms' && q.label.startsWith('R '));
    const leftLeg = quickJoints.filter((q) => q.group === 'legs' && q.label.startsWith('L '));
    const rightLeg = quickJoints.filter((q) => q.group === 'legs' && q.label.startsWith('R '));
    return { core, leftArm, rightArm, leftLeg, rightLeg };
  }, [quickJoints]);

  const sortedKeyframes = useMemo(
    () => [...draft.keyframes].sort((a, b) => a.time - b.time),
    [draft.keyframes]
  );

  const activeKeyframe = useMemo(
    () => sortedKeyframes.find((kf) => Math.abs(kf.time - playhead) < 0.018) ?? null,
    [sortedKeyframes, playhead]
  );

  const loopReport = useMemo(
    () => (effectiveRig ? analyzeLoopSeam(draft, effectiveRig.boneMap) : null),
    [draft, effectiveRig]
  );

  const effectiveTestOverride: RigTestOverride = useMemo(() => {
    if (boneNames.length === 0) return null;
    if (studioMode === 'gait') return null;
    if (isPlaying && draft.keyframes.length >= 2) {
      return {
        kind: 'presetPreview',
        preset: draft,
        timeNorm: playhead,
        playing: true,
      };
    }
    return {
      kind: 'poseSnapshot',
      bones: workingBones,
      hipsOffsetY: workingHipsY,
    };
  }, [boneNames.length, studioMode, isPlaying, draft, playhead, workingBones, workingHipsY]);

  const ghostStartPose = useMemo(() => {
    if (!showLoopGhost || !draft.loop || draft.keyframes.length === 0) return null;
    const sorted = [...draft.keyframes].sort((a, b) => a.time - b.time);
    return {
      bones: sorted[0].bones,
      hipsOffsetY: sorted[0].hipsOffsetY ?? 0,
    };
  }, [showLoopGhost, draft]);

  // Resolve adjacent Previous & Next keyframes around the playhead for Onion Skinning
  const { prevKeyframe, nextKeyframe } = useMemo(() => {
    if (sortedKeyframes.length === 0) {
      return { prevKeyframe: null, nextKeyframe: null };
    }
    let prev: CustomPoseKeyframe | null = null;
    let next: CustomPoseKeyframe | null = null;

    for (const kf of sortedKeyframes) {
      if (kf.time < playhead - 0.018) {
        prev = kf;
      } else if (kf.time > playhead + 0.018 && !next) {
        next = kf;
      }
    }

    // Wrap around seamlessly when looping so 0% sees the last key and final key sees 0% start
    if (draft.loop && sortedKeyframes.length >= 2) {
      if (!prev) {
        const last = sortedKeyframes[sortedKeyframes.length - 1];
        if ((!activeKeyframe || last.id !== activeKeyframe.id) && last.id !== next?.id) {
          prev = last;
        }
      }
      if (!next) {
        const first = sortedKeyframes[0];
        if ((!activeKeyframe || first.id !== activeKeyframe.id) && first.id !== prev?.id) {
          next = first;
        }
      }
    }

    return { prevKeyframe: prev, nextKeyframe: next };
  }, [sortedKeyframes, playhead, draft.loop, activeKeyframe]);

  const onionSkinConfig: OnionSkinConfig = useMemo(
    () => ({
      enabled: onionEnabled && (onionShowPrev || onionShowNext),
      prevPose:
        onionEnabled && onionShowPrev && prevKeyframe
          ? { bones: prevKeyframe.bones, hipsOffsetY: prevKeyframe.hipsOffsetY ?? 0 }
          : null,
      nextPose:
        onionEnabled && onionShowNext && nextKeyframe
          ? { bones: nextKeyframe.bones, hipsOffsetY: nextKeyframe.hipsOffsetY ?? 0 }
          : null,
      opacity: onionOpacity,
    }),
    [onionEnabled, onionShowPrev, onionShowNext, prevKeyframe, nextKeyframe, onionOpacity]
  );

  // Pose & Keyframe Handlers
  const handleSelectBone = useCallback((boneName: string) => {
    setIsPlaying(false);
    setSelectedBone(boneName);
  }, []);

  const handleChangeBoneAngles = useCallback(
    (boneName: string, angles: BonePoseAngles) => {
      setIsPlaying(false);
      setIsDirtyPose(true);
      setWorkingBones((prev) => {
        const next = { ...prev };
        const clamped: BonePoseAngles = [
          Math.max(-165, Math.min(165, Math.round(angles[0] * 2) / 2)),
          Math.max(-165, Math.min(165, Math.round(angles[1] * 2) / 2)),
          Math.max(-165, Math.min(165, Math.round(angles[2] * 2) / 2)),
        ];
        const isZero =
          Math.abs(clamped[0]) < 0.25 &&
          Math.abs(clamped[1]) < 0.25 &&
          Math.abs(clamped[2]) < 0.25;

        if (isZero) {
          delete next[boneName];
        } else {
          next[boneName] = clamped;
        }

        // Live Mirror Mode: automatically mirror the opposite limb in real time!
        if (liveMirror && effectiveRig) {
          const opp = getMirroredBoneCounterpart(boneName, boneNames, effectiveRig.boneMap);
          if (opp) {
            if (isZero) {
              delete next[opp];
            } else {
              next[opp] = [clamped[0], -clamped[1], -clamped[2]];
            }
          }
        }
        return next;
      });
    },
    [liveMirror, boneNames, effectiveRig]
  );

  const handleNudgeAxis = useCallback(
    (axisIdx: 0 | 1 | 2, delta: number) => {
      if (!selectedBone) return;
      const cur = workingBones[selectedBone] ?? [0, 0, 0];
      const next: BonePoseAngles = [cur[0], cur[1], cur[2]];
      next[axisIdx] = Math.max(-165, Math.min(165, cur[axisIdx] + delta));
      handleChangeBoneAngles(selectedBone, next);
    },
    [selectedBone, workingBones, handleChangeBoneAngles]
  );

  const handleChangeHipsY = useCallback((hipsY: number) => {
    setIsPlaying(false);
    setIsDirtyPose(true);
    setWorkingHipsY(Math.round(hipsY * 100) / 100);
  }, []);

  const handleResetJoint = useCallback(
    (boneName: string) => {
      setIsPlaying(false);
      setIsDirtyPose(true);
      setWorkingBones((prev) => {
        const next = { ...prev };
        let changed = false;
        if (boneName in next) {
          delete next[boneName];
          changed = true;
        }
        if (liveMirror && effectiveRig) {
          const opp = getMirroredBoneCounterpart(boneName, boneNames, effectiveRig.boneMap);
          if (opp && opp in next) {
            delete next[opp];
            changed = true;
          }
        }
        return changed ? next : prev;
      });
    },
    [liveMirror, boneNames, effectiveRig]
  );

  const handleApplyMirrorPose = useCallback(
    (mode: MirrorPoseMode) => {
      if (!effectiveRig) return;
      setIsPlaying(false);
      setWorkingBones((prev) => mirrorPoseBones(prev, boneNames, effectiveRig.boneMap, mode));
      setIsDirtyPose(true);
      flashToast(
        mode === 'flip'
          ? 'Flipped Left ↔ Right pose'
          : mode === 'leftToRight'
          ? 'Mirrored Left → Right'
          : 'Mirrored Right → Left'
      );
    },
    [boneNames, effectiveRig, flashToast]
  );

  const handleResetPose = useCallback(() => {
    setIsPlaying(false);
    setIsDirtyPose(true);
    setActiveSavedPoseId(null);
    setWorkingBones({});
    setWorkingHipsY(0);
  }, []);

  const handleScrub = useCallback(
    (timeNorm: number) => {
      setIsPlaying(false);
      setPlayhead(timeNorm);
      setActiveSavedPoseId(null);
      const sampled = sampleMotionPresetToPose(draft, timeNorm);
      setWorkingBones(sampled.bones);
      setWorkingHipsY(sampled.hipsOffsetY);
      setIsDirtyPose(false);
    },
    [draft]
  );

  const handleTogglePlay = useCallback(() => {
    setIsPlaying((playing) => {
      if (playing) {
        const sampled = sampleMotionPresetToPose(draft, playhead);
        setWorkingBones(sampled.bones);
        setWorkingHipsY(sampled.hipsOffsetY);
        setIsDirtyPose(false);
        return false;
      }
      if (draft.keyframes.length < 2) return false;
      return true;
    });
  }, [draft, playhead]);

  const handleSaveKeyframe = useCallback(() => {
    setIsPlaying(false);
    setDraft((prev) => {
      const clonedBones: Record<string, BonePoseAngles> = {};
      for (const [k, v] of Object.entries(workingBones)) {
        clonedBones[k] = [v[0], v[1], v[2]];
      }
      const existingIdx = prev.keyframes.findIndex(
        (kf) => Math.abs(kf.time - playhead) < 0.018
      );
      let nextKeys: CustomPoseKeyframe[];
      if (existingIdx >= 0) {
        nextKeys = prev.keyframes.map((kf, i) =>
          i === existingIdx ? { ...kf, bones: clonedBones, hipsOffsetY: workingHipsY } : kf
        );
      } else {
        nextKeys = [
          ...prev.keyframes,
          {
            id: uid(),
            time: Math.round(playhead * 100) / 100,
            bones: clonedBones,
            hipsOffsetY: workingHipsY,
          },
        ].sort((a, b) => a.time - b.time);
      }
      return { ...prev, keyframes: nextKeys, updatedAt: new Date().toISOString() };
    });
    setIsDirtyPose(false);
    flashToast(`Keyframe saved at ${(playhead * draft.duration).toFixed(2)}s`);
  }, [workingBones, workingHipsY, playhead, draft.duration, flashToast]);

  const handleDeleteKeyframe = useCallback(
    (kfId: string) => {
      setIsPlaying(false);
      setDraft((prev) => {
        if (prev.keyframes.length <= 1) return prev;
        const nextKeys = prev.keyframes.filter((k) => k.id !== kfId);
        const nextDraft = { ...prev, keyframes: nextKeys, updatedAt: new Date().toISOString() };
        const sampled = sampleMotionPresetToPose(nextDraft, playhead);
        setWorkingBones(sampled.bones);
        setWorkingHipsY(sampled.hipsOffsetY);
        setIsDirtyPose(false);
        return nextDraft;
      });
    },
    [playhead]
  );

  const handleMatchEndToStart = useCallback(() => {
    setIsPlaying(false);
    setDraft((prev) => {
      const sorted = [...prev.keyframes].sort((a, b) => a.time - b.time);
      if (sorted.length === 0) return prev;
      const start = sorted[0];
      const startBonesCopy: Record<string, BonePoseAngles> = {};
      for (const [k, v] of Object.entries(start.bones)) {
        startBonesCopy[k] = [v[0], v[1], v[2]];
      }
      const startHips = start.hipsOffsetY ?? 0;
      const endIdx = sorted.findIndex((kf) => kf.time >= 0.98);
      let nextKeys: CustomPoseKeyframe[];
      if (endIdx >= 0 && sorted[endIdx].id !== start.id) {
        nextKeys = sorted.map((kf, idx) =>
          idx === endIdx
            ? { ...kf, time: 1, bones: startBonesCopy, hipsOffsetY: startHips }
            : kf
        );
      } else {
        nextKeys = [
          ...sorted,
          {
            id: uid(),
            time: 1,
            bones: startBonesCopy,
            hipsOffsetY: startHips,
          },
        ];
      }
      setPlayhead(1);
      setWorkingBones(startBonesCopy);
      setWorkingHipsY(startHips);
      setIsDirtyPose(false);
      return { ...prev, keyframes: nextKeys, updatedAt: new Date().toISOString() };
    });
    flashToast('End keyframe matched to 0% Start');
  }, [flashToast]);

  const handleGrabLivePose = useCallback(
    (slot: CustomClipSlot) => {
      setIsPlaying(false);
      const captured = captureLivePoseRef.current?.(slot);
      if (!captured) return;
      setWorkingBones(captured.bones);
      setWorkingHipsY(captured.hipsOffsetY);
      setIsDirtyPose(true);
      const label = SLOT_OPTIONS.find((s) => s.slot === slot)?.short ?? slot;
      flashToast(`Sampled ${label} pose`);
    },
    [flashToast]
  );

  const buildFinalizedDraft = (presetId: string, name: string): CustomMotionPreset => {
    let keys = draft.keyframes;
    if (isDirtyPose || keys.length === 0) {
      const clonedBones: Record<string, BonePoseAngles> = {};
      for (const [k, v] of Object.entries(workingBones)) {
        clonedBones[k] = [v[0], v[1], v[2]];
      }
      const existingIdx = keys.findIndex((kf) => Math.abs(kf.time - playhead) < 0.018);
      if (existingIdx >= 0) {
        keys = keys.map((kf, i) =>
          i === existingIdx ? { ...kf, bones: clonedBones, hipsOffsetY: workingHipsY } : kf
        );
      } else {
        keys = [
          ...keys,
          {
            id: uid(),
            time: Math.round(playhead * 100) / 100,
            bones: clonedBones,
            hipsOffsetY: workingHipsY,
          },
        ].sort((a, b) => a.time - b.time);
      }
    }
    return {
      ...draft,
      id: presetId,
      name: name.trim() || draft.name.trim() || `Custom ${draft.slot}`,
      keyframes: keys,
      updatedAt: new Date().toISOString(),
    };
  };

  const handleSaveOverwrite = () => {
    if (!selectedAsset || !savedPresetId) return;
    const finalized = buildFinalizedDraft(savedPresetId, draft.name);
    const list = selectedAsset.customAnimations ?? [];
    const exists = list.some((p) => p.id === savedPresetId);
    const nextList = exists
      ? list.map((p) => (p.id === savedPresetId ? finalized : p))
      : [...list, finalized];
    setDraft(finalized);
    setIsDirtyPose(false);
    void store.updateCustomAssetMeta({
      ...selectedAsset,
      customAnimations: nextList,
    });
    flashToast(`Saved "${finalized.name}"`);
  };

  const handleSaveAsNew = () => {
    if (!selectedAsset) return;
    const newId = uid();
    const baseName = draft.name.trim() || `Custom ${draft.slot}`;
    const existingNames = new Set((selectedAsset.customAnimations ?? []).map((p) => p.name));
    const uniqueName =
      savedPresetId && existingNames.has(baseName) ? `${baseName} Copy` : baseName;
    const finalized = buildFinalizedDraft(newId, uniqueName);
    const nextList = [...(selectedAsset.customAnimations ?? []), finalized];
    setDraft(finalized);
    setSavedPresetId(newId);
    setIsDirtyPose(false);
    void store.updateCustomAssetMeta({
      ...selectedAsset,
      customAnimations: nextList,
    });
    flashToast(`Saved new preset "${finalized.name}"`);
  };

  const handleLoadPreset = (preset: CustomMotionPreset) => {
    const cloned: CustomMotionPreset = JSON.parse(JSON.stringify(preset));
    setStudioMode('pose');
    setIsPlaying(false);
    setDraft(cloned);
    setSavedPresetId(cloned.id);
    setPlayhead(0);
    const startSample = sampleMotionPresetToPose(cloned, 0);
    setWorkingBones(startSample.bones);
    setWorkingHipsY(startSample.hipsOffsetY);
    setIsDirtyPose(false);
  };

  const handleCreateNewDraft = (slot: CustomClipSlot) => {
    const boneMap = stageRig?.boneMap ?? effectiveRig?.boneMap ?? {};
    const fresh =
      slot === 'walk' || slot === 'run' || slot === 'idle' || slot === 'jump' || slot === 'swim'
        ? createBlankMotionDraft(slot)
        : Object.keys(boneMap).length > 0
        ? buildStandardMotionPresetTemplate(slot, boneMap)
        : createBlankMotionDraft(slot);
    setStudioMode('pose');
    setIsPlaying(false);
    setDraft(fresh);
    setSavedPresetId(null);
    setPlayhead(0);
    const startPose = fresh.keyframes[0];
    setWorkingBones(startPose?.bones ? JSON.parse(JSON.stringify(startPose.bones)) : {});
    setWorkingHipsY(startPose?.hipsOffsetY ?? 0);
    setIsDirtyPose(false);
  };

  const updateSlotTuning = useCallback(
    (patch: Partial<SlotMotionTuning>) => {
      if (!stageRig) return;
      const curSlot = resolveSlotMotionTuning(stageRig, draft.slot);
      const nextSlot: SlotMotionTuning = { ...curSlot, ...patch };
      setGaitRigDraft({
        ...stageRig,
        boneMap: { ...stageRig.boneMap },
        slotTuning: {
          ...(stageRig.slotTuning ?? {}),
          [draft.slot]: nextSlot,
        },
      });
      setGaitDirty(true);
    },
    [stageRig, draft.slot]
  );

  const updateSharedRig = useCallback(
    (patch: Partial<CustomRigSettings>) => {
      if (!stageRig) return;
      setGaitRigDraft({
        ...stageRig,
        ...patch,
        boneMap: { ...stageRig.boneMap },
        slotTuning: stageRig.slotTuning ? { ...stageRig.slotTuning } : undefined,
      });
      setGaitDirty(true);
    },
    [stageRig]
  );

  const handleSaveGaitDefault = useCallback(() => {
    if (!selectedAsset || !stageRig) return;
    const slotLabel = SLOT_OPTIONS.find((s) => s.slot === draft.slot)?.short ?? draft.slot;
    const nextSlotTuning = {
      ...(stageRig.slotTuning ?? {}),
      [draft.slot]: { ...resolveSlotMotionTuning(stageRig, draft.slot) },
    };
    const nextRig: CustomRigSettings = {
      ...stageRig,
      mode: stageRig.mode === 'clips' ? 'procedural' : stageRig.mode,
      armRelaxAutoVersion: 2,
      boneMap: { ...stageRig.boneMap },
      slotTuning: nextSlotTuning,
    };
    const nextDefaults = { ...(selectedAsset.defaultSlotPresets ?? {}) };
    if (nextDefaults[draft.slot]) {
      delete nextDefaults[draft.slot];
    }
    setGaitRigDraft(nextRig);
    setGaitDirty(false);
    void store.updateCustomAssetMeta({
      ...selectedAsset,
      rigSettings: nextRig,
      defaultSlotPresets: nextDefaults,
    });
    flashToast(`Saved ${slotLabel} defaults for ${selectedAsset.name}`);
  }, [selectedAsset, stageRig, draft.slot, store, flashToast]);

  const handleResetSlotGait = useCallback(() => {
    if (!stageRig) return;
    const nextTuning = { ...(stageRig.slotTuning ?? {}) };
    nextTuning[draft.slot] = { ...DEFAULT_SLOT_MOTION_TUNING };
    setGaitRigDraft({
      ...stageRig,
      boneMap: { ...stageRig.boneMap },
      slotTuning: nextTuning,
    });
    setGaitDirty(true);
    const slotLabel = SLOT_OPTIONS.find((s) => s.slot === draft.slot)?.short ?? draft.slot;
    flashToast(`Reset ${slotLabel} gait sliders`);
  }, [stageRig, draft.slot, flashToast]);

  const handleDeletePreset = (presetId: string) => {
    if (!selectedAsset) return;
    const nextList = (selectedAsset.customAnimations ?? []).filter((p) => p.id !== presetId);
    const nextDefaults = { ...(selectedAsset.defaultSlotPresets ?? {}) };
    (Object.keys(nextDefaults) as CustomClipSlot[]).forEach((slot) => {
      if (nextDefaults[slot] === presetId) {
        delete nextDefaults[slot];
      }
    });
    if (savedPresetId === presetId) {
      setSavedPresetId(null);
    }
    void store.updateCustomAssetMeta({
      ...selectedAsset,
      customAnimations: nextList,
      defaultSlotPresets: nextDefaults,
    });
  };

  const handleSetDefaultForSlot = (slot: CustomClipSlot, presetId: string | null) => {
    if (!selectedAsset) return;
    const nextDefaults = { ...(selectedAsset.defaultSlotPresets ?? {}) };
    if (presetId) {
      nextDefaults[slot] = presetId;
    } else {
      delete nextDefaults[slot];
    }
    const nextRig =
      presetId && effectiveRig?.mode === 'clips'
        ? { ...effectiveRig, mode: 'auto' as RigAnimationMode }
        : effectiveRig ?? undefined;
    void store.updateCustomAssetMeta({
      ...selectedAsset,
      defaultSlotPresets: nextDefaults,
      rigSettings: nextRig,
    });
    const slotLabel = SLOT_OPTIONS.find((s) => s.slot === slot)?.short ?? slot;
    flashToast(presetId ? `Set as default ${slotLabel} move` : `Reverted ${slotLabel} to built-in`);
  };

  const handleUploadGlb = async (files: FileList | null) => {
    if (!files || files.length === 0) return;
    setUploadErr(null);
    setUploading(true);
    try {
      const file = files[0];
      if (!/\.(glb|gltf)$/i.test(file.name)) {
        throw new Error(`"${file.name}" is not a .glb or .gltf file.`);
      }
      const meta = await store.uploadCustomGlb(file, 'character');
      setSelectedAssetId(meta.id);
      store.setMotionAssetId(meta.id);
      flashToast(`Imported "${meta.name}"`);
    } catch (err) {
      setUploadErr(err instanceof Error ? err.message : 'Could not load 3D model.');
    } finally {
      setUploading(false);
    }
  };

  const triggerCamera = (preset: StageCameraPreset) => {
    setCameraPreset(preset);
    setCameraResetNonce((n) => n + 1);
  };

  const scrubFromClientX = (clientX: number) => {
    const el = trackRef.current;
    if (!el) return;
    const rect = el.getBoundingClientRect();
    if (rect.width <= 0) return;
    const norm = Math.max(0, Math.min(1, (clientX - rect.left) / rect.width));
    handleScrub(Math.round(norm * 100) / 100);
  };

  const selectedAngles: BonePoseAngles = selectedBone
    ? workingBones[selectedBone] ?? [0, 0, 0]
    : [0, 0, 0];
  const selectedLabel =
    selectedBone && effectiveRig
      ? getFriendlyBoneLabel(selectedBone, effectiveRig.boneMap)
      : 'None';

  const savedPresets = selectedAsset?.customAnimations ?? [];
  const savedPoses = selectedAsset?.savedPoses ?? [];
  const isCurrentDefault = Boolean(
    savedPresetId && selectedAsset?.defaultSlotPresets?.[draft.slot] === savedPresetId
  );
  const lastKeyTime =
    sortedKeyframes.length > 0 ? sortedKeyframes[sortedKeyframes.length - 1].time : 0;

  const clonePoseBones = useCallback((bones: Record<string, BonePoseAngles>) => {
    const out: Record<string, BonePoseAngles> = {};
    for (const [k, v] of Object.entries(bones)) {
      if (Math.abs(v[0]) > 0.05 || Math.abs(v[1]) > 0.05 || Math.abs(v[2]) > 0.05) {
        out[k] = [v[0], v[1], v[2]];
      }
    }
    return out;
  }, []);

  const handleCaptureSavedPose = useCallback(
    (rawName: string) => {
      if (!selectedAsset) return;
      setIsPlaying(false);
      const slotLabel = SLOT_OPTIONS.find((s) => s.slot === draft.slot)?.short ?? 'Pose';
      const existingList = selectedAsset.savedPoses ?? [];
      const poseName = rawName.trim() || `${slotLabel} Pose ${existingList.length + 1}`;
      const thumbnailDataUrl = capturePoseThumbnailRef.current?.() ?? undefined;
      const newPose: SavedPosePreset = {
        id: uid(),
        name: poseName,
        bones: clonePoseBones(workingBones),
        hipsOffsetY: workingHipsY,
        thumbnailDataUrl,
        createdAt: new Date().toISOString(),
      };
      const nextPoses = [newPose, ...existingList];
      setActiveSavedPoseId(newPose.id);
      setLeftSidebarTab('poses');
      void store.updateCustomAssetMeta({
        ...selectedAsset,
        savedPoses: nextPoses,
      });
      flashToast(`Captured pose "${poseName}"`);
    },
    [selectedAsset, draft.slot, workingBones, workingHipsY, clonePoseBones, store, flashToast]
  );

  const handleApplySavedPose = useCallback(
    (pose: SavedPosePreset, opts?: { mirror?: boolean; saveKeyframe?: boolean }) => {
      setStudioMode('pose');
      setIsPlaying(false);
      let nextBones = clonePoseBones(pose.bones);
      if (opts?.mirror) {
        nextBones = mirrorPoseBones(nextBones, boneNames, effectiveRig?.boneMap ?? {}, 'flip');
      }
      const nextHipsY = pose.hipsOffsetY ?? 0;
      setWorkingBones(nextBones);
      setWorkingHipsY(nextHipsY);
      setActiveSavedPoseId(pose.id);

      if (opts?.saveKeyframe) {
        setDraft((prev) => {
          const existingIdx = prev.keyframes.findIndex((kf) => Math.abs(kf.time - playhead) < 0.018);
          let nextKeys: CustomPoseKeyframe[];
          if (existingIdx >= 0) {
            nextKeys = prev.keyframes.map((kf, i) =>
              i === existingIdx ? { ...kf, bones: nextBones, hipsOffsetY: nextHipsY } : kf
            );
          } else {
            nextKeys = [
              ...prev.keyframes,
              {
                id: uid(),
                time: Math.round(playhead * 100) / 100,
                bones: nextBones,
                hipsOffsetY: nextHipsY,
              },
            ].sort((a, b) => a.time - b.time);
          }
          return { ...prev, keyframes: nextKeys, updatedAt: new Date().toISOString() };
        });
        setIsDirtyPose(false);
        flashToast(`Applied & keyed "${pose.name}" at ${Math.round(playhead * 100)}%`);
      } else {
        setIsDirtyPose(true);
        flashToast(
          opts?.mirror
            ? `Applied mirrored "${pose.name}"`
            : `Applied pose "${pose.name}"`
        );
      }
    },
    [boneNames, effectiveRig?.boneMap, playhead, clonePoseBones, flashToast]
  );

  const handleOverwriteSavedPose = useCallback(
    (poseId: string) => {
      if (!selectedAsset) return;
      const existingList = selectedAsset.savedPoses ?? [];
      const target = existingList.find((p) => p.id === poseId);
      if (!target) return;
      const thumbnailDataUrl = capturePoseThumbnailRef.current?.() ?? target.thumbnailDataUrl;
      const nextPoses = existingList.map((p) =>
        p.id === poseId
          ? {
              ...p,
              bones: clonePoseBones(workingBones),
              hipsOffsetY: workingHipsY,
              thumbnailDataUrl,
            }
          : p
      );
      setActiveSavedPoseId(poseId);
      void store.updateCustomAssetMeta({
        ...selectedAsset,
        savedPoses: nextPoses,
      });
      flashToast(`Updated pose "${target.name}"`);
    },
    [selectedAsset, workingBones, workingHipsY, clonePoseBones, store, flashToast]
  );

  const handleRenameSavedPose = useCallback(
    (poseId: string, nextName: string) => {
      if (!selectedAsset) return;
      const trimmed = nextName.trim();
      if (!trimmed) return;
      const nextPoses = (selectedAsset.savedPoses ?? []).map((p) =>
        p.id === poseId ? { ...p, name: trimmed } : p
      );
      void store.updateCustomAssetMeta({
        ...selectedAsset,
        savedPoses: nextPoses,
      });
    },
    [selectedAsset, store]
  );

  const handleDeleteSavedPose = useCallback(
    (poseId: string) => {
      if (!selectedAsset) return;
      const nextPoses = (selectedAsset.savedPoses ?? []).filter((p) => p.id !== poseId);
      if (activeSavedPoseId === poseId) setActiveSavedPoseId(null);
      void store.updateCustomAssetMeta({
        ...selectedAsset,
        savedPoses: nextPoses,
      });
      flashToast('Deleted saved pose');
    },
    [selectedAsset, activeSavedPoseId, store, flashToast]
  );

  const hasRig = Boolean(selectedAsset && effectiveRig);

  return (
    <div className="h-full w-full flex flex-col bg-[#F4F5F8] dark:bg-[#0F1117] overflow-hidden">
      {/* TOP MOTION STUDIO HEADER BAR */}
      <div className="shrink-0 flex flex-wrap items-center justify-between gap-2.5 px-4 py-2.5 bg-white dark:bg-[#171A23] border-b border-slate-200/80 dark:border-white/[0.08]">
        <div className="flex flex-wrap items-center gap-2 min-w-0">
          <div className="flex items-center gap-2 pr-2 border-r border-slate-200/80 dark:border-white/[0.08]">
            <Film size={16} className="text-[#7C5CFF] shrink-0" />
            <span className="text-sm font-black tracking-tight whitespace-nowrap">
              Motion Maker
            </span>
          </div>

          <div className="inline-flex items-center p-0.5 rounded-xl bg-slate-100 dark:bg-[#1F2430] border border-slate-200/80 dark:border-white/[0.08]">
            <button
              type="button"
              onClick={() => {
                setIsPlaying(false);
                setStudioMode('gait');
              }}
              className={`px-2.5 py-1 rounded-lg text-xs font-extrabold inline-flex items-center gap-1.5 transition-colors whitespace-nowrap ${
                studioMode === 'gait'
                  ? 'bg-[#7C5CFF] text-white shadow-sm'
                  : 'text-slate-600 dark:text-[#A5AEC4] hover:text-slate-900 dark:hover:text-white'
              }`}
            >
              <SlidersHorizontal size={12} />
              <span>Base Gait &amp; Speed</span>
            </button>
            <button
              type="button"
              onClick={() => setStudioMode('pose')}
              className={`px-2.5 py-1 rounded-lg text-xs font-extrabold inline-flex items-center gap-1.5 transition-colors whitespace-nowrap ${
                studioMode === 'pose'
                  ? 'bg-[#7C5CFF] text-white shadow-sm'
                  : 'text-slate-600 dark:text-[#A5AEC4] hover:text-slate-900 dark:hover:text-white'
              }`}
            >
              <KeyRound size={12} />
              <span>Keyframe Pose</span>
            </button>
            <button
              type="button"
              onClick={() => {
                setIsPlaying(false);
                setStudioMode('actions');
              }}
              className={`px-2.5 py-1 rounded-lg text-xs font-extrabold inline-flex items-center gap-1.5 transition-colors whitespace-nowrap ${
                studioMode === 'actions'
                  ? 'bg-[#F59E0B] text-white shadow-sm'
                  : 'text-slate-600 dark:text-[#A5AEC4] hover:text-slate-900 dark:hover:text-white'
              }`}
            >
              <Zap size={12} />
              <span>Hero Actions</span>
            </button>
          </div>

          {hasRig && studioMode === 'pose' && (
            <input
              type="text"
              value={draft.name}
              onChange={(e) => setDraft((prev) => ({ ...prev, name: e.target.value }))}
              aria-label="Custom move name"
              placeholder="Move name"
              className="w-40 sm:w-48 px-2.5 py-1.5 rounded-lg bg-slate-100 dark:bg-[#1F2430] border border-slate-200/80 dark:border-white/[0.08] text-xs font-bold"
            />
          )}

          {hasRig && studioMode !== 'actions' && (
            <select
              value={draft.slot}
              onChange={(e) =>
                setDraft((prev) => ({ ...prev, slot: e.target.value as CustomClipSlot }))
              }
              aria-label="Action slot"
              className="px-2.5 py-1.5 rounded-lg bg-slate-100 dark:bg-[#1F2430] border border-slate-200/80 dark:border-white/[0.08] text-xs font-semibold"
            >
              <optgroup label="Core Locomotion">
                {SLOT_OPTIONS.filter((o) => o.group === 'core').map((opt) => (
                  <option key={opt.slot} value={opt.slot}>
                    Action: {opt.label}
                  </option>
                ))}
              </optgroup>
              <optgroup label="Object Interactions">
                {SLOT_OPTIONS.filter((o) => o.group === 'object').map((opt) => (
                  <option key={opt.slot} value={opt.slot}>
                    Object: {opt.label}
                  </option>
                ))}
              </optgroup>
              <optgroup label="Character Interactions">
                {SLOT_OPTIONS.filter((o) => o.group === 'character').map((opt) => (
                  <option key={opt.slot} value={opt.slot}>
                    Character: {opt.label}
                  </option>
                ))}
              </optgroup>
            </select>
          )}

          {toast && studioMode !== 'actions' && (
            <span className="text-xs font-bold text-[#20B46A] inline-flex items-center gap-1 whitespace-nowrap">
              <Check size={13} />
              <span>{toast}</span>
            </span>
          )}
        </div>

        <div className="flex flex-wrap items-center gap-1.5">
          {studioMode === 'actions' ? (
            <span className="text-xs font-bold text-slate-500 dark:text-[#949BB0] tabular-nums">
              {store.currentProject?.enabledActions.length ?? 0} hero moves enabled
            </span>
          ) : hasRig && studioMode === 'gait' ? (
            <>
              <button
                type="button"
                onClick={handleSaveGaitDefault}
                className={`px-3.5 py-1.5 rounded-lg text-xs font-bold inline-flex items-center gap-1.5 whitespace-nowrap transition-colors ${
                  gaitDirty
                    ? 'bg-[#20B46A] hover:bg-[#1A9E5C] text-white'
                    : 'bg-[#7C5CFF] hover:bg-[#6A48F5] text-white'
                }`}
              >
                <Star size={12} className="fill-current" />
                <span>
                  Save Default {SLOT_OPTIONS.find((s) => s.slot === draft.slot)?.short}
                </span>
              </button>
              <button
                type="button"
                onClick={handleResetSlotGait}
                className="px-2.5 py-1.5 rounded-lg bg-slate-100 dark:bg-[#1F2430] hover:bg-slate-200 dark:hover:bg-[#2A3142] text-xs font-semibold inline-flex items-center gap-1 whitespace-nowrap"
              >
                <RotateCcw size={12} />
                <span>Reset</span>
              </button>
            </>
          ) : hasRig ? (
            <>
              {savedPresetId && (
                <button
                  type="button"
                  onClick={handleSaveOverwrite}
                  className="px-3 py-1.5 rounded-lg bg-[#7C5CFF] hover:bg-[#6A48F5] text-white text-xs font-bold inline-flex items-center gap-1.5 whitespace-nowrap"
                >
                  <Save size={13} />
                  <span>Save</span>
                </button>
              )}

              <button
                type="button"
                onClick={handleSaveAsNew}
                className={`px-3 py-1.5 rounded-lg text-xs font-bold inline-flex items-center gap-1.5 whitespace-nowrap ${
                  savedPresetId
                    ? 'bg-slate-100 dark:bg-[#1F2430] hover:bg-slate-200 dark:hover:bg-[#2A3142] text-slate-900 dark:text-white'
                    : 'bg-[#7C5CFF] hover:bg-[#6A48F5] text-white'
                }`}
              >
                <Plus size={13} />
                <span>{savedPresetId ? 'Save As New' : 'Save Preset'}</span>
              </button>

              {savedPresetId && (
                <button
                  type="button"
                  onClick={() =>
                    handleSetDefaultForSlot(draft.slot, isCurrentDefault ? null : savedPresetId)
                  }
                  className={`px-3 py-1.5 rounded-lg text-xs font-bold inline-flex items-center gap-1.5 whitespace-nowrap transition-colors ${
                    isCurrentDefault
                      ? 'bg-[#20B46A] text-white'
                      : 'bg-[#20B46A]/15 text-[#16A34A] dark:text-[#34D399] hover:bg-[#20B46A]/25'
                  }`}
                >
                  <Star size={12} className={isCurrentDefault ? 'fill-current' : ''} />
                  <span>
                    {isCurrentDefault
                      ? `Default ${SLOT_OPTIONS.find((s) => s.slot === draft.slot)?.short}`
                      : `Set Default ${SLOT_OPTIONS.find((s) => s.slot === draft.slot)?.short}`}
                  </span>
                </button>
              )}

              <button
                type="button"
                disabled={boneNames.length === 0}
                onClick={() => handleCaptureSavedPose('')}
                title="Capture the current joint positions as a reusable thumbnail in Saved Poses"
                className="px-2.5 py-1.5 rounded-lg bg-slate-100 dark:bg-[#1F2430] hover:bg-[#7C5CFF] hover:text-white text-xs font-bold inline-flex items-center gap-1.5 whitespace-nowrap transition-colors disabled:opacity-40"
              >
                <Camera size={12} />
                <span>Capture Pose</span>
              </button>
            </>
          ) : null}

          {studioMode !== 'actions' && (
            <>
              <input
                ref={fileInputRef}
                type="file"
                accept=".glb,.gltf"
                className="hidden"
                onChange={(e) => {
                  void handleUploadGlb(e.target.files);
                  e.target.value = '';
                }}
              />
              <button
                type="button"
                disabled={uploading}
                onClick={() => fileInputRef.current?.click()}
                className="px-2.5 py-1.5 rounded-lg bg-slate-100 dark:bg-[#1F2430] hover:bg-slate-200 dark:hover:bg-[#2A3142] text-xs font-semibold inline-flex items-center gap-1.5 whitespace-nowrap"
              >
                <Upload size={12} className="text-[#7C5CFF]" />
                <span>{uploading ? 'Loading…' : 'Import GLB'}</span>
              </button>
            </>
          )}
        </div>
      </div>

      {studioMode === 'actions' ? (
        <div className="flex-1 min-h-0 overflow-hidden">
          <ActionsStage store={store} />
        </div>
      ) : !selectedAsset || !effectiveRig ? (
        <div className="flex-1 min-h-0 flex flex-col items-center justify-center p-6 text-center">
          <div className="max-w-md space-y-4">
            <div className="mx-auto w-14 h-14 rounded-2xl bg-[#7C5CFF]/15 text-[#7C5CFF] flex items-center justify-center">
              <Film size={26} />
            </div>
            <h2 className="text-xl font-black tracking-tight">Character Motion Maker</h2>
            <p className="text-sm text-slate-600 dark:text-[#949BB0]">
              Import a rigged 3D character (.glb or .gltf) to pose joints directly in 3D, keyframe
              custom looping animations on the timeline, and set them as default game moves.
            </p>
            {uploadErr && (
              <div className="px-3 py-2 rounded-xl bg-[#F2545B]/15 text-[#F2545B] text-xs font-semibold">
                {uploadErr}
              </div>
            )}
            <div className="flex flex-wrap items-center justify-center gap-2 pt-1">
              <button
                type="button"
                disabled={uploading}
                onClick={() => fileInputRef.current?.click()}
                className="px-4 py-2.5 rounded-xl bg-[#7C5CFF] hover:bg-[#6A48F5] text-white text-xs font-bold inline-flex items-center gap-2"
              >
                <Upload size={14} />
                <span>{uploading ? 'Importing…' : 'Import Rigged GLB'}</span>
              </button>
              <button
                type="button"
                onClick={() => store.setShowingAssetVault(true)}
                className="px-4 py-2.5 rounded-xl bg-white dark:bg-[#171A23] border border-slate-200 dark:border-white/[0.1] text-xs font-bold inline-flex items-center gap-2"
              >
                <Box size={14} className="text-[#7C5CFF]" />
                <span>Open 3D Asset Vault</span>
              </button>
            </div>
          </div>
        </div>
      ) : (
        <>
          {/* MAIN 3-COLUMN WORKSPACE */}
          <div className="flex-1 min-h-0 flex flex-col lg:flex-row overflow-y-auto lg:overflow-hidden maker-scroll">
        {/* LEFT SIDEBAR: SAVED POSES & MOVES LIBRARY */}
        <aside className="w-full lg:w-64 xl:w-72 shrink-0 lg:h-full lg:overflow-y-auto maker-scroll bg-white dark:bg-[#171A23] border-b lg:border-b-0 lg:border-r border-slate-200/80 dark:border-white/[0.08] p-3.5 space-y-3.5">
          {/* Active Character Bar */}
          <div className="flex items-center gap-2 p-2 rounded-xl bg-slate-50 dark:bg-[#12151E] border border-slate-200/70 dark:border-white/[0.08]">
            <div className="w-9 h-9 rounded-lg bg-slate-200/70 dark:bg-[#0B0E16] overflow-hidden shrink-0 flex items-center justify-center">
              {selectedAsset.thumbnailDataUrl ? (
                <img
                  src={selectedAsset.thumbnailDataUrl}
                  alt={selectedAsset.name}
                  className="w-full h-full object-contain"
                />
              ) : (
                <Box size={15} className="text-slate-400" />
              )}
            </div>
            <div className="min-w-0 flex-1">
              {riggedAssets.length > 1 ? (
                <select
                  value={selectedAsset.id}
                  onChange={(e) => {
                    setSelectedAssetId(e.target.value);
                    store.setMotionAssetId(e.target.value);
                  }}
                  aria-label="Select character"
                  className="w-full bg-transparent text-xs font-extrabold truncate focus:outline-none cursor-pointer"
                >
                  {riggedAssets.map((asset) => (
                    <option key={asset.id} value={asset.id} className="bg-white dark:bg-[#171A23]">
                      {asset.name}
                    </option>
                  ))}
                </select>
              ) : (
                <div className="text-xs font-extrabold truncate">{selectedAsset.name}</div>
              )}
              <div className="flex items-center justify-between gap-2 text-[10px] text-slate-500 dark:text-[#949BB0]">
                <span className="truncate">
                  {savedPoses.length} poses · {savedPresets.length} moves
                </span>
                <button
                  type="button"
                  onClick={() => store.setShowingAssetVault(true)}
                  className="text-[#7C5CFF] font-bold hover:underline shrink-0"
                >
                  Rig
                </button>
              </div>
            </div>
          </div>

          {/* Sidebar Mode Tabs: Saved Poses | Moves & Rig */}
          <div className="grid grid-cols-2 gap-1 p-1 rounded-xl bg-slate-100 dark:bg-[#12151E] border border-slate-200/70 dark:border-white/[0.08]">
            <button
              type="button"
              onClick={() => setLeftSidebarTab('poses')}
              className={`py-1.5 px-2 rounded-lg text-[11px] font-bold inline-flex items-center justify-center gap-1.5 transition-colors ${
                leftSidebarTab === 'poses'
                  ? 'bg-[#7C5CFF] text-white shadow-sm'
                  : 'text-slate-600 dark:text-[#A5AEC4] hover:text-slate-900 dark:hover:text-white'
              }`}
            >
              <Bookmark size={12} />
              <span>Saved Poses</span>
              <span
                className={`px-1.5 py-0.2 rounded-full text-[10px] tabular-nums ${
                  leftSidebarTab === 'poses'
                    ? 'bg-white/20 text-white'
                    : 'bg-slate-200/90 dark:bg-[#1F2430] text-slate-600 dark:text-[#B8C0D6]'
                }`}
              >
                {savedPoses.length}
              </span>
            </button>
            <button
              type="button"
              onClick={() => setLeftSidebarTab('library')}
              className={`py-1.5 px-2 rounded-lg text-[11px] font-bold inline-flex items-center justify-center gap-1.5 transition-colors ${
                leftSidebarTab === 'library'
                  ? 'bg-[#7C5CFF] text-white shadow-sm'
                  : 'text-slate-600 dark:text-[#A5AEC4] hover:text-slate-900 dark:hover:text-white'
              }`}
            >
              <Film size={12} />
              <span>Moves</span>
              <span
                className={`px-1.5 py-0.2 rounded-full text-[10px] tabular-nums ${
                  leftSidebarTab === 'library'
                    ? 'bg-white/20 text-white'
                    : 'bg-slate-200/90 dark:bg-[#1F2430] text-slate-600 dark:text-[#B8C0D6]'
                }`}
              >
                {savedPresets.length}
              </span>
            </button>
          </div>

          {leftSidebarTab === 'poses' ? (
            <SavedPosesSidebar
              poses={savedPoses}
              activePoseId={activeSavedPoseId}
              currentPosedJointCount={Object.keys(workingBones).length}
              currentPlayheadPercent={Math.round(playhead * 100)}
              disabled={boneNames.length === 0}
              onCapturePose={handleCaptureSavedPose}
              onApplyPose={handleApplySavedPose}
              onOverwritePose={handleOverwriteSavedPose}
              onRenamePose={handleRenameSavedPose}
              onDeletePose={handleDeleteSavedPose}
            />
          ) : (
            <div className="space-y-4">
              {/* Saved Moves Library */}
              <div className="space-y-2">
                <div className="flex items-center justify-between text-[11px] font-bold text-slate-500 dark:text-[#949BB0]">
                  <span>Saved Moves ({savedPresets.length})</span>
                  <button
                    type="button"
                    onClick={() => handleCreateNewDraft(draft.slot)}
                    className="text-[#7C5CFF] hover:underline inline-flex items-center gap-0.5"
                  >
                    <Plus size={11} />
                    <span>New</span>
                  </button>
                </div>

                {savedPresets.length === 0 ? (
                  <div className="rounded-xl border border-dashed border-slate-300 dark:border-white/[0.1] p-3 text-[11px] text-slate-500 dark:text-[#949BB0] leading-relaxed">
                    Pose joints in the 3D stage, save keyframes on the timeline below, then click{' '}
                    <strong className="text-slate-700 dark:text-white">Save Preset</strong>.
                  </div>
                ) : (
                  <div className="space-y-1.5">
                    {savedPresets.map((preset) => {
                      const isEditing = savedPresetId === preset.id;
                      const isDefault = selectedAsset.defaultSlotPresets?.[preset.slot] === preset.id;
                      const slotShort =
                        SLOT_OPTIONS.find((s) => s.slot === preset.slot)?.short ?? preset.slot;
                      return (
                        <div
                          key={preset.id}
                          className={`p-2 rounded-xl border transition-colors ${
                            isEditing
                              ? 'border-[#7C5CFF] bg-[#7C5CFF]/10'
                              : 'border-slate-200/70 dark:border-white/[0.08] bg-slate-50 dark:bg-[#12151E]'
                          }`}
                        >
                          <div className="flex items-center justify-between gap-1.5">
                            <button
                              type="button"
                              onClick={() => handleLoadPreset(preset)}
                              className="min-w-0 flex-1 text-left"
                            >
                              <div className="text-xs font-extrabold truncate">{preset.name}</div>
                              <div className="text-[10px] text-slate-500 dark:text-[#949BB0] tabular-nums">
                                {slotShort} · {preset.duration.toFixed(1)}s · {preset.keyframes.length}{' '}
                                keys
                              </div>
                            </button>
                            <button
                              type="button"
                              onClick={() =>
                                handleSetDefaultForSlot(preset.slot, isDefault ? null : preset.id)
                              }
                              title={isDefault ? 'Unset as default' : `Set as default ${slotShort}`}
                              className={`px-2 py-1 rounded-lg text-[10px] font-bold inline-flex items-center gap-1 shrink-0 ${
                                isDefault
                                  ? 'bg-[#20B46A] text-white'
                                  : 'bg-slate-200/80 dark:bg-[#1F2430] text-slate-600 dark:text-[#B8C0D6] hover:bg-[#7C5CFF] hover:text-white'
                              }`}
                            >
                              <Star size={10} className={isDefault ? 'fill-current' : ''} />
                              <span>{isDefault ? 'Default' : 'Use'}</span>
                            </button>
                            <button
                              type="button"
                              onClick={() => handleDeletePreset(preset.id)}
                              title="Delete preset"
                              className="p-1 rounded-md text-slate-400 hover:text-[#F2545B] hover:bg-[#F2545B]/10 shrink-0"
                            >
                              <Trash2 size={12} />
                            </button>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>

              {/* Action Slot Defaults Overview */}
              <div className="space-y-1.5 pt-3 border-t border-slate-200/70 dark:border-white/[0.08]">
                <div className="text-[11px] font-bold text-slate-500 dark:text-[#949BB0]">
                  Action Slot Defaults
                </div>
                <div className="space-y-1">
                  {SLOT_OPTIONS.map(({ slot, short }) => {
                    const defId = selectedAsset.defaultSlotPresets?.[slot];
                    const defPreset = defId
                      ? savedPresets.find((p) => p.id === defId)
                      : undefined;
                    return (
                      <div
                        key={slot}
                        className="flex items-center justify-between gap-2 px-2 py-1.5 rounded-lg bg-slate-50 dark:bg-[#12151E] text-[11px]"
                      >
                        <span className="font-bold text-slate-700 dark:text-[#D5DCF0] shrink-0">
                          {short}
                        </span>
                        <button
                          type="button"
                          onClick={() => {
                            if (defPreset) {
                              handleLoadPreset(defPreset);
                            } else {
                              handleCreateNewDraft(slot);
                              handleGrabLivePose(slot);
                            }
                          }}
                          className={`truncate text-right font-semibold hover:underline ${
                            defPreset
                              ? 'text-[#16A34A] dark:text-[#34D399]'
                              : 'text-slate-500 dark:text-[#8E96AB]'
                          }`}
                        >
                          {defPreset ? defPreset.name : 'Built-in / GLB'}
                        </button>
                      </div>
                    );
                  })}
                </div>
              </div>
            </div>
          )}
        </aside>

        {/* CENTER HUGE 3D STAGE */}
        <main className="flex-1 min-w-0 min-h-[360px] lg:min-h-0 relative bg-[#111521]">
          <RigPreviewStage
            asset={stageAsset ?? selectedAsset}
            rigSettings={stageRig ?? effectiveRig}
            boneNames={boneNames}
            previewSlot={draft.slot}
            paused={studioMode === 'gait' ? gaitPaused : false}
            showSkeleton={showSkeleton}
            xrayMesh={xrayMesh}
            cameraPreset={cameraPreset}
            cameraResetNonce={cameraResetNonce}
            testOverride={effectiveTestOverride}
            highlightBoneName={studioMode === 'pose' ? selectedBone : null}
            poseMode={studioMode === 'pose' && boneNames.length > 0}
            motionPlaying={studioMode === 'pose' ? isPlaying : false}
            workingBones={workingBones}
            ghostStartPose={studioMode === 'pose' ? ghostStartPose : null}
            onionSkin={studioMode === 'pose' ? onionSkinConfig : null}
            showGizmo={studioMode === 'pose' && showGizmo}
            showJointDots={studioMode === 'pose' && showJointDots}
            gizmoSize={GIZMO_SIZE_MAP[gizmoSizePreset]}
            gizmoAxisFilter={gizmoAxisFilter}
            lockCameraOrbit={lockCameraOrbit}
            containerClassName="w-full h-full"
            onSelectPoseBone={handleSelectBone}
            onGizmoRotateBone={handleChangeBoneAngles}
            onPlayheadTick={setPlayhead}
            captureLivePoseRef={captureLivePoseRef}
            capturePoseThumbnailRef={capturePoseThumbnailRef}
          />

          {/* Compact Top-Left Camera Controls + Orbit Lock for Touch */}
          <div className="absolute top-3 left-3 flex flex-wrap items-center gap-1 p-1 rounded-xl bg-[#171A23]/95 border border-white/[0.12] z-10">
            {(
              [
                ['front', 'Front'],
                ['side', 'Side'],
                ['back', 'Back'],
                ['threeQuarter', 'Reset'],
              ] as const
            ).map(([preset, label]) => (
              <button
                key={preset}
                type="button"
                onClick={() => triggerCamera(preset)}
                className="px-2.5 py-1.5 rounded-lg text-[11px] font-bold text-[#C8D0E4] hover:text-white hover:bg-white/10 whitespace-nowrap"
              >
                {label}
              </button>
            ))}
            <div className="w-px h-4 bg-white/15 mx-0.5" />
            <button
              type="button"
              onClick={() => setLockCameraOrbit((v) => !v)}
              title="Lock camera orbit so touch drags only rotate the selected joint"
              className={`px-2.5 py-1.5 rounded-lg text-[11px] font-bold inline-flex items-center gap-1 whitespace-nowrap ${
                lockCameraOrbit
                  ? 'bg-[#F59E0B] text-slate-950'
                  : 'text-[#C8D0E4] hover:text-white hover:bg-white/10'
              }`}
            >
              {lockCameraOrbit ? <Lock size={12} /> : <Unlock size={12} />}
              <span>{lockCameraOrbit ? 'Cam Locked' : 'Lock Cam'}</span>
            </button>
          </div>

          {/* Compact Top-Right Viewport Display Toggles */}
          <div className="absolute top-3 right-3 flex flex-wrap items-center gap-1 p-1 rounded-xl bg-[#171A23]/95 border border-white/[0.12] z-10">
            {studioMode === 'gait' ? (
              <button
                type="button"
                onClick={() => setGaitPaused((p) => !p)}
                className={`px-2.5 py-1.5 rounded-lg text-[11px] font-bold inline-flex items-center gap-1 whitespace-nowrap ${
                  gaitPaused ? 'bg-[#F59E0B] text-slate-950' : 'bg-[#20B46A] text-white'
                }`}
              >
                {gaitPaused ? <Play size={12} /> : <Pause size={12} />}
                <span>{gaitPaused ? 'Paused' : 'Live'}</span>
              </button>
            ) : (
              <>
                <button
                  type="button"
                  onClick={() => setOnionEnabled((v) => !v)}
                  title="Toggle ghostly 3D silhouettes of previous (rose) and next (green) keyframes"
                  className={`px-2.5 py-1.5 rounded-lg text-[11px] font-bold inline-flex items-center gap-1 whitespace-nowrap ${
                    onionEnabled ? 'bg-[#FB7185] text-slate-950' : 'text-[#A5AEC4] hover:text-white'
                  }`}
                >
                  <Layers size={12} />
                  <span>Onion Skin</span>
                </button>

                <button
                  type="button"
                  onClick={() => setShowGizmo((v) => !v)}
                  className={`px-2.5 py-1.5 rounded-lg text-[11px] font-bold inline-flex items-center gap-1 whitespace-nowrap ${
                    showGizmo ? 'bg-[#F59E0B] text-slate-950' : 'text-[#A5AEC4] hover:text-white'
                  }`}
                >
                  <Compass size={12} />
                  <span>3D Rings</span>
                </button>

                <button
                  type="button"
                  onClick={() => setShowJointDots((v) => !v)}
                  className={`px-2.5 py-1.5 rounded-lg text-[11px] font-bold inline-flex items-center gap-1 whitespace-nowrap ${
                    showJointDots ? 'bg-[#7C5CFF] text-white' : 'text-[#A5AEC4] hover:text-white'
                  }`}
                >
                  <CircleDot size={12} />
                  <span>Joints</span>
                </button>
              </>
            )}

            <button
              type="button"
              onClick={() => setShowSkeleton((v) => !v)}
              className={`px-2.5 py-1.5 rounded-lg text-[11px] font-bold inline-flex items-center gap-1 whitespace-nowrap ${
                showSkeleton ? 'bg-[#06B6D4] text-slate-950' : 'text-[#A5AEC4] hover:text-white'
              }`}
            >
              <Bone size={12} />
              <span>Bones</span>
            </button>

            <button
              type="button"
              onClick={() => setXrayMesh((v) => !v)}
              className={`px-2.5 py-1.5 rounded-lg text-[11px] font-bold inline-flex items-center gap-1 whitespace-nowrap ${
                xrayMesh ? 'bg-[#7C5CFF] text-white' : 'text-[#A5AEC4] hover:text-white'
              }`}
            >
              <Eye size={12} />
              <span>X-Ray</span>
            </button>

            {studioMode === 'pose' && draft.loop && (
              <button
                type="button"
                onClick={() => setShowLoopGhost((v) => !v)}
                className={`px-2.5 py-1.5 rounded-lg text-[11px] font-bold inline-flex items-center gap-1 whitespace-nowrap ${
                  showLoopGhost ? 'bg-[#22D3EE] text-slate-950' : 'text-[#A5AEC4] hover:text-white'
                }`}
              >
                <Ghost size={12} />
                <span>Start Ghost</span>
              </button>
            )}
          </div>

          {/* Touch-Friendly Gizmo Size & Axis Isolation Dock */}
          {studioMode === 'pose' && boneNames.length > 0 && showGizmo && !isPlaying && (
            <div className="absolute bottom-9 left-1/2 -translate-x-1/2 flex flex-wrap items-center justify-center gap-1.5 px-2.5 py-1.5 rounded-2xl bg-[#171A23]/95 border border-white/[0.14] shadow-lg z-10 max-w-[95%]">
              <span className="text-[11px] font-extrabold text-[#F59E0B] px-1.5 truncate max-w-[130px]">
                {selectedLabel}
              </span>
              <div className="w-px h-4 bg-white/15" />

              {/* Isolate Single Axis for Zero-Miss Touch Dragging */}
              <div className="flex items-center gap-1">
                {(
                  [
                    ['all', 'All', 'bg-white text-slate-950'],
                    ['X', 'X', 'bg-[#FF4D6D] text-white'],
                    ['Y', 'Y', 'bg-[#22C55E] text-slate-950'],
                    ['Z', 'Z', 'bg-[#38BDF8] text-slate-950'],
                  ] as const
                ).map(([axis, label, activeCls]) => (
                  <button
                    key={axis}
                    type="button"
                    onClick={() => setGizmoAxisFilter(axis)}
                    title={
                      axis === 'all'
                        ? 'Show all rotation rings'
                        : `Isolate ${axis} rotation ring for touch`
                    }
                    className={`min-w-[30px] px-2.5 py-1.5 rounded-lg text-[11px] font-extrabold transition-colors ${
                      gizmoAxisFilter === axis
                        ? activeCls
                        : 'text-[#B8C0D6] hover:text-white hover:bg-white/10'
                    }`}
                  >
                    {label}
                  </button>
                ))}
              </div>

              <div className="w-px h-4 bg-white/15" />

              {/* Gizmo Ring Size */}
              <div className="flex items-center gap-1">
                <span className="text-[10px] font-bold text-[#8E96AB] px-0.5 hidden sm:inline">
                  Ring
                </span>
                {(['M', 'L', 'XL'] as const).map((sz) => (
                  <button
                    key={sz}
                    type="button"
                    onClick={() => setGizmoSizePreset(sz)}
                    title={`Set gizmo ring size to ${sz}`}
                    className={`min-w-[28px] px-2 py-1.5 rounded-lg text-[11px] font-extrabold transition-colors ${
                      gizmoSizePreset === sz
                        ? 'bg-[#7C5CFF] text-white'
                        : 'text-[#B8C0D6] hover:text-white hover:bg-white/10'
                    }`}
                  >
                    {sz}
                  </button>
                ))}
              </div>
            </div>
          )}
        </main>

        {/* RIGHT INSPECTOR: BASE GAIT STUDIO OR KEYFRAME JOINT CONTROLLER */}
        <aside className="w-full lg:w-80 xl:w-[340px] shrink-0 lg:h-full lg:overflow-y-auto maker-scroll bg-white dark:bg-[#171A23] border-t lg:border-t-0 lg:border-l border-slate-200/80 dark:border-white/[0.08] p-4 space-y-4">
          {boneNames.length === 0 ? (
            <div className="py-10 text-center text-xs text-slate-500 dark:text-[#949BB0]">
              No skeleton bones detected on this model. Import a rigged character to animate joints.
            </div>
          ) : studioMode === 'gait' && stageRig ? (
            <div className="space-y-4">
              {/* Motion Type Picker */}
              <div className="space-y-2">
                <div className="flex items-center justify-between">
                  <span className="text-xs font-extrabold text-slate-900 dark:text-white">
                    Motion Type ({selectedAsset.name})
                  </span>
                  <button
                    type="button"
                    onClick={() => setGaitPaused((p) => !p)}
                    className={`px-2 py-0.5 rounded-md text-[10px] font-bold inline-flex items-center gap-1 ${
                      gaitPaused
                        ? 'bg-[#F59E0B]/20 text-[#D97706] dark:text-[#FBBF24]'
                        : 'bg-[#20B46A]/15 text-[#16A34A] dark:text-[#34D399]'
                    }`}
                  >
                    {gaitPaused ? <Play size={10} /> : <Pause size={10} />}
                    <span>{gaitPaused ? 'Paused' : 'Playing'}</span>
                  </button>
                </div>

                <div className="grid grid-cols-4 gap-1 max-h-48 overflow-y-auto maker-scroll pr-0.5">
                  {SLOT_OPTIONS.map(({ slot, short }) => {
                    const active = draft.slot === slot;
                    const hasSavedGait = Boolean(selectedAsset.rigSettings?.slotTuning?.[slot]);
                    return (
                      <button
                        key={slot}
                        type="button"
                        onClick={() => setDraft((prev) => ({ ...prev, slot }))}
                        className={`relative px-1.5 py-1.5 rounded-lg text-[10px] font-bold transition-colors truncate ${
                          active
                            ? 'bg-[#7C5CFF] text-white'
                            : 'bg-slate-100 dark:bg-[#1F2430] text-slate-700 dark:text-[#C8D0E4] hover:bg-slate-200 dark:hover:bg-[#2A3142]'
                        }`}
                      >
                        {short}
                        {hasSavedGait && (
                          <span
                            className={`absolute top-1 right-1 w-1.5 h-1.5 rounded-full ${
                              active ? 'bg-white' : 'bg-[#20B46A]'
                            }`}
                          />
                        )}
                      </button>
                    );
                  })}
                </div>

                {selectedAsset.defaultSlotPresets?.[draft.slot] && (
                  <div className="p-2 rounded-xl bg-[#F59E0B]/12 border border-[#F59E0B]/30 text-[11px] text-[#B45309] dark:text-[#FCD34D]">
                    A custom keyframe move is currently set as default for{' '}
                    <strong>{SLOT_OPTIONS.find((s) => s.slot === draft.slot)?.short}</strong>.
                    Click Save Default below to use this gait instead.
                  </div>
                )}
              </div>

              {/* Per-Motion Speed & Gait Controls */}
              <div className="space-y-3 rounded-2xl bg-slate-50 dark:bg-[#12151E] border border-slate-200/70 dark:border-white/[0.08] p-3">
                <div className="flex items-center justify-between">
                  <span className="text-[11px] font-extrabold uppercase tracking-wider text-slate-500 dark:text-[#949BB0]">
                    {SLOT_OPTIONS.find((s) => s.slot === draft.slot)?.label} Gait & Speed
                  </span>
                  <button
                    type="button"
                    onClick={handleResetSlotGait}
                    className="text-[10px] font-bold text-[#7C5CFF] hover:underline"
                  >
                    Reset {SLOT_OPTIONS.find((s) => s.slot === draft.slot)?.short}
                  </button>
                </div>

                {(
                  [
                    {
                      key: 'speedMultiplier',
                      label: 'Step / Motion Speed',
                      min: 0.3,
                      max: 2.2,
                      step: 0.05,
                      fmt: (v: number) => `${v.toFixed(2)}×`,
                    },
                    {
                      key: 'strideLength',
                      label: draft.slot === 'idle' ? 'Stance Width' : 'Stride / Leg Swing',
                      min: 0.3,
                      max: 1.8,
                      step: 0.05,
                      fmt: (v: number) => `${Math.round(v * 100)}%`,
                    },
                    {
                      key: 'kneeBend',
                      label: 'Knee Bend',
                      min: 0.15,
                      max: 1.8,
                      step: 0.05,
                      fmt: (v: number) => `${Math.round(v * 100)}%`,
                    },
                    {
                      key: 'armSwing',
                      label: draft.slot === 'idle' ? 'Idle Arm Sway' : 'Arm Swing',
                      min: 0,
                      max: 1.8,
                      step: 0.05,
                      fmt: (v: number) => `${Math.round(v * 100)}%`,
                    },
                    {
                      key: 'armSideOffsetDeg',
                      label: 'Arms Out / At Sides',
                      min: -20,
                      max: 45,
                      step: 1,
                      fmt: (v: number) => `${v > 0 ? '+' : ''}${Math.round(v)}°`,
                    },
                    {
                      key: 'bounce',
                      label: 'Hip Bounce (Down / Up)',
                      min: 0,
                      max: 1.8,
                      step: 0.05,
                      fmt: (v: number) => `${Math.round(v * 100)}%`,
                    },
                    {
                      key: 'torsoLean',
                      label: 'Torso Lean / Posture',
                      min: -15,
                      max: 25,
                      step: 1,
                      fmt: (v: number) => `${v > 0 ? '+' : ''}${Math.round(v)}°`,
                    },
                  ] as const
                ).map((cfg) => {
                  const val = activeSlotTuning[cfg.key];
                  return (
                    <div key={cfg.key} className="space-y-1">
                      <div className="flex items-center justify-between text-xs font-semibold">
                        <span className="text-slate-700 dark:text-[#D5DCF0]">{cfg.label}</span>
                        <span className="font-mono text-[11px] tabular-nums text-slate-600 dark:text-[#949BB0]">
                          {cfg.fmt(val)}
                        </span>
                      </div>
                      <input
                        type="range"
                        min={cfg.min}
                        max={cfg.max}
                        step={cfg.step}
                        value={val}
                        onChange={(e) => updateSlotTuning({ [cfg.key]: Number(e.target.value) })}
                        className="w-full accent-[#7C5CFF]"
                      />
                    </div>
                  );
                })}
              </div>

              {/* Character Base Arm Hang & Rig Strength */}
              <div className="space-y-3 rounded-2xl bg-slate-50 dark:bg-[#12151E] border border-slate-200/70 dark:border-white/[0.08] p-3">
                <div className="flex items-center justify-between">
                  <span className="text-[11px] font-extrabold uppercase tracking-wider text-slate-500 dark:text-[#949BB0]">
                    Character Base Rig
                  </span>
                  {cachedInfo && (
                    <button
                      type="button"
                      onClick={() =>
                        updateSharedRig({
                          armRelaxAngle: cachedInfo.skeletonInfo.suggestedArmRelaxAngle,
                          armRelaxAutoVersion: 2,
                        })
                      }
                      className="text-[10px] font-bold text-[#7C5CFF] hover:underline"
                    >
                      Auto-Relax Arms ({cachedInfo.skeletonInfo.suggestedArmRelaxAngle}°)
                    </button>
                  )}
                </div>

                <div className="space-y-1">
                  <div className="flex items-center justify-between text-xs font-semibold">
                    <span className="text-slate-700 dark:text-[#D5DCF0]">Base Arm Hang (From A-Pose)</span>
                    <span className="font-mono text-[11px] tabular-nums text-slate-600 dark:text-[#949BB0]">
                      {Math.round(stageRig.armRelaxAngle)}°
                    </span>
                  </div>
                  <input
                    type="range"
                    min={0}
                    max={85}
                    step={1}
                    value={stageRig.armRelaxAngle}
                    onChange={(e) =>
                      updateSharedRig({
                        armRelaxAngle: Number(e.target.value),
                        armRelaxAutoVersion: 2,
                      })
                    }
                    className="w-full accent-[#7C5CFF]"
                  />
                </div>

                <div className="space-y-1">
                  <div className="flex items-center justify-between text-xs font-semibold">
                    <span className="text-slate-700 dark:text-[#D5DCF0]">Overall Motion Strength</span>
                    <span className="font-mono text-[11px] tabular-nums text-slate-600 dark:text-[#949BB0]">
                      {Math.round(stageRig.motionStrength * 100)}%
                    </span>
                  </div>
                  <input
                    type="range"
                    min={0.3}
                    max={2.0}
                    step={0.05}
                    value={stageRig.motionStrength}
                    onChange={(e) => updateSharedRig({ motionStrength: Number(e.target.value) })}
                    className="w-full accent-[#7C5CFF]"
                  />
                </div>

                <div className="space-y-1">
                  <div className="flex items-center justify-between text-xs font-semibold">
                    <span className="text-slate-700 dark:text-[#D5DCF0]">Head Motion</span>
                    <span className="font-mono text-[11px] tabular-nums text-slate-600 dark:text-[#949BB0]">
                      {Math.round(stageRig.headMotion * 100)}%
                    </span>
                  </div>
                  <input
                    type="range"
                    min={0}
                    max={2.0}
                    step={0.05}
                    value={stageRig.headMotion}
                    onChange={(e) => updateSharedRig({ headMotion: Number(e.target.value) })}
                    className="w-full accent-[#7C5CFF]"
                  />
                </div>
              </div>

              {/* Save Default CTA + Sample to Keyframes */}
              <div className="space-y-2">
                <button
                  type="button"
                  onClick={handleSaveGaitDefault}
                  className="w-full py-2.5 px-3 rounded-xl bg-[#20B46A] hover:bg-[#1A9E5C] text-white text-xs font-extrabold inline-flex items-center justify-center gap-1.5 transition-colors shadow-sm"
                >
                  <Star size={13} className="fill-current" />
                  <span className="truncate">
                    Save Default for {selectedAsset.name} (
                    {SLOT_OPTIONS.find((s) => s.slot === draft.slot)?.short})
                  </span>
                </button>

                <button
                  type="button"
                  onClick={() => {
                    setStudioMode('pose');
                    handleGrabLivePose(draft.slot);
                  }}
                  className="w-full py-2 px-3 rounded-xl bg-slate-100 dark:bg-[#1F2430] hover:bg-[#7C5CFF]/15 hover:text-[#7C5CFF] text-xs font-bold inline-flex items-center justify-center gap-1.5 transition-colors"
                >
                  <Sparkles size={13} />
                  <span>Grab Current Pose to Keyframes</span>
                </button>
              </div>
            </div>
          ) : (
            <>
              {/* Active Joint Rotation Controller */}
              <div className="space-y-3">
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <div className="text-xs font-bold text-slate-500 dark:text-[#949BB0]">
                      Selected Joint
                    </div>
                    <div className="text-base font-black truncate text-slate-900 dark:text-white">
                      {selectedLabel}
                    </div>
                  </div>
                  <div className="flex items-center gap-1 shrink-0">
                    {selectedBone && (
                      <button
                        type="button"
                        onClick={() => handleResetJoint(selectedBone)}
                        className="px-2 py-1 rounded-lg bg-slate-100 dark:bg-[#1F2430] hover:bg-slate-200 dark:hover:bg-[#2A3142] text-[11px] font-bold whitespace-nowrap"
                      >
                        Zero Joint
                      </button>
                    )}
                    <button
                      type="button"
                      onClick={handleResetPose}
                      title="Reset all joints in this frame to standing rest pose"
                      className="px-2 py-1 rounded-lg bg-slate-100 dark:bg-[#1F2430] hover:bg-slate-200 dark:hover:bg-[#2A3142] text-[11px] font-semibold inline-flex items-center gap-1 whitespace-nowrap"
                    >
                      <RotateCcw size={11} />
                      <span>Reset Pose</span>
                    </button>
                  </div>
                </div>

                {/* X / Y / Z Precision Rotation Sliders with -5° / +5° nudges */}
                <div className="space-y-3 rounded-2xl bg-slate-50 dark:bg-[#12151E] border border-slate-200/70 dark:border-white/[0.08] p-3">
                  {(
                    [
                      [0, 'Forward / Back (X)', '#EF4444'],
                      [1, 'Turn / Twist (Y)', '#22C55E'],
                      [2, 'Side Tilt / Raise (Z)', '#3B82F6'],
                    ] as const
                  ).map(([idx, label, color]) => (
                    <div key={idx} className="space-y-1">
                      <div className="flex items-center justify-between text-xs font-semibold">
                        <span className="inline-flex items-center gap-1.5">
                          <span
                            style={{ backgroundColor: color }}
                            className="w-2.5 h-2.5 rounded-xs inline-block shrink-0"
                          />
                          <span>{label}</span>
                        </span>
                        <div className="flex items-center gap-1">
                          <button
                            type="button"
                            disabled={!selectedBone}
                            onClick={() => handleNudgeAxis(idx, -5)}
                            aria-label={`Decrease ${label} by 5 degrees`}
                            className="w-5 h-5 rounded bg-slate-200/80 dark:bg-[#1F2430] hover:bg-slate-300 dark:hover:bg-[#2A3142] flex items-center justify-center disabled:opacity-40"
                          >
                            <Minus size={10} />
                          </button>
                          <span className="w-12 text-right font-mono text-[11px] tabular-nums text-slate-700 dark:text-[#D5DCF0]">
                            {selectedAngles[idx] > 0 ? '+' : ''}
                            {selectedAngles[idx]}°
                          </span>
                          <button
                            type="button"
                            disabled={!selectedBone}
                            onClick={() => handleNudgeAxis(idx, 5)}
                            aria-label={`Increase ${label} by 5 degrees`}
                            className="w-5 h-5 rounded bg-slate-200/80 dark:bg-[#1F2430] hover:bg-slate-300 dark:hover:bg-[#2A3142] flex items-center justify-center disabled:opacity-40"
                          >
                            <Plus size={10} />
                          </button>
                        </div>
                      </div>
                      <input
                        type="range"
                        min={-165}
                        max={165}
                        step={0.5}
                        disabled={!selectedBone}
                        value={selectedAngles[idx]}
                        onChange={(e) => {
                          if (!selectedBone) return;
                          const next: BonePoseAngles = [...selectedAngles] as BonePoseAngles;
                          next[idx] = Number(e.target.value);
                          handleChangeBoneAngles(selectedBone, next);
                        }}
                        className="w-full accent-[#F59E0B] disabled:opacity-40"
                      />
                    </div>
                  ))}

                  {/* Hips Vertical Bounce / Crouch */}
                  <div className="space-y-1 pt-2 border-t border-slate-200/70 dark:border-white/[0.08]">
                    <div className="flex items-center justify-between text-xs font-semibold">
                      <span>Body Bounce / Height</span>
                      <span className="font-mono text-[11px] tabular-nums text-slate-600 dark:text-[#A5AEC4]">
                        {workingHipsY > 0 ? '+' : ''}
                        {workingHipsY.toFixed(2)}m
                      </span>
                    </div>
                    <input
                      type="range"
                      min={-0.35}
                      max={0.35}
                      step={0.01}
                      value={workingHipsY}
                      onChange={(e) => handleChangeHipsY(Number(e.target.value))}
                      className="w-full accent-[#7C5CFF]"
                    />
                  </div>
                </div>
              </div>

              {/* Mirror Pose & Symmetry Tool */}
              <div className="p-2.5 rounded-xl bg-slate-50 dark:bg-[#12151E] border border-slate-200/70 dark:border-white/[0.08] space-y-2">
                <div className="flex items-center justify-between gap-2">
                  <div className="inline-flex items-center gap-1.5 text-[11px] font-bold text-slate-700 dark:text-[#D5DCEB]">
                    <FlipHorizontal2 size={13} className="text-[#7C5CFF]" />
                    <span>Mirror Pose</span>
                  </div>
                  <button
                    type="button"
                    onClick={() => setLiveMirror((v) => !v)}
                    title="When active, rotating any left or right limb automatically mirrors the opposite limb in real time"
                    className={`px-2 py-0.5 rounded-md text-[10px] font-bold transition-colors ${
                      liveMirror
                        ? 'bg-[#7C5CFF] text-white'
                        : 'bg-slate-200/80 dark:bg-[#1F2430] text-slate-600 dark:text-[#A5AEC4] hover:bg-slate-300/70 dark:hover:bg-[#2A3142]'
                    }`}
                  >
                    {liveMirror ? 'Live Symmetry: On' : 'Live Symmetry'}
                  </button>
                </div>

                <div className="grid grid-cols-3 gap-1.5">
                  <button
                    type="button"
                    onClick={() => handleApplyMirrorPose('flip')}
                    title="Swap Left and Right limb poses across the body (great for alternating walk/run steps)"
                    className="px-2 py-1.5 rounded-lg text-[11px] font-bold bg-white dark:bg-[#1F2430] border border-slate-200/80 dark:border-white/[0.08] text-slate-800 dark:text-white hover:border-[#7C5CFF] hover:text-[#6A48F5] dark:hover:text-[#C4B5FD] transition-colors"
                  >
                    Flip L↔R
                  </button>
                  <button
                    type="button"
                    onClick={() => handleApplyMirrorPose('leftToRight')}
                    title="Copy the Left limbs mirrored onto the Right side and center the spine"
                    className="px-2 py-1.5 rounded-lg text-[11px] font-bold bg-white dark:bg-[#1F2430] border border-slate-200/80 dark:border-white/[0.08] text-slate-800 dark:text-white hover:border-[#7C5CFF] hover:text-[#6A48F5] dark:hover:text-[#C4B5FD] transition-colors"
                  >
                    Copy L→R
                  </button>
                  <button
                    type="button"
                    onClick={() => handleApplyMirrorPose('rightToLeft')}
                    title="Copy the Right limbs mirrored onto the Left side and center the spine"
                    className="px-2 py-1.5 rounded-lg text-[11px] font-bold bg-white dark:bg-[#1F2430] border border-slate-200/80 dark:border-white/[0.08] text-slate-800 dark:text-white hover:border-[#7C5CFF] hover:text-[#6A48F5] dark:hover:text-[#C4B5FD] transition-colors"
                  >
                    Copy R→L
                  </button>
                </div>
              </div>

              {/* Symmetrical Visual Body-Part Selector */}
              <div className="space-y-2.5 pt-2 border-t border-slate-200/70 dark:border-white/[0.08]">
                <div className="flex items-center justify-between text-[11px] font-bold text-slate-500 dark:text-[#949BB0]">
                  <span>Body Map</span>
                  <span>{Object.keys(workingBones).length} posed</span>
                </div>

                {/* Upper Body Grid: Left Arm | Core | Right Arm */}
                <div className="grid grid-cols-3 gap-1.5">
                  <div className="space-y-1">
                    <div className="text-[10px] font-bold text-center text-slate-400 dark:text-[#7E869C]">
                      Left Arm
                    </div>
                    {bodySilhouette.leftArm.map((item) => {
                      const active = selectedBone === item.boneName;
                      const edited = Boolean(workingBones[item.boneName]);
                      return (
                        <button
                          key={item.boneName}
                          type="button"
                          onClick={() => handleSelectBone(item.boneName)}
                          className={`w-full px-1.5 py-1.5 rounded-lg text-[11px] font-bold truncate transition-colors ${
                            active
                              ? 'bg-[#F59E0B] text-slate-950'
                              : edited
                              ? 'bg-[#7C5CFF]/18 text-[#6A48F5] dark:text-[#C4B5FD] border border-[#7C5CFF]/35'
                              : 'bg-slate-100 dark:bg-[#1F2430] text-slate-700 dark:text-[#C8D0E4] hover:bg-slate-200 dark:hover:bg-[#2A3142]'
                          }`}
                        >
                          {item.label.replace(/^L /, '')}
                        </button>
                      );
                    })}
                  </div>

                  <div className="space-y-1">
                    <div className="text-[10px] font-bold text-center text-slate-400 dark:text-[#7E869C]">
                      Core
                    </div>
                    {bodySilhouette.core.map((item) => {
                      const active = selectedBone === item.boneName;
                      const edited = Boolean(workingBones[item.boneName]);
                      return (
                        <button
                          key={item.boneName}
                          type="button"
                          onClick={() => handleSelectBone(item.boneName)}
                          className={`w-full px-1.5 py-1.5 rounded-lg text-[11px] font-bold truncate transition-colors ${
                            active
                              ? 'bg-[#F59E0B] text-slate-950'
                              : edited
                              ? 'bg-[#7C5CFF]/18 text-[#6A48F5] dark:text-[#C4B5FD] border border-[#7C5CFF]/35'
                              : 'bg-slate-100 dark:bg-[#1F2430] text-slate-700 dark:text-[#C8D0E4] hover:bg-slate-200 dark:hover:bg-[#2A3142]'
                          }`}
                        >
                          {item.label}
                        </button>
                      );
                    })}
                  </div>

                  <div className="space-y-1">
                    <div className="text-[10px] font-bold text-center text-slate-400 dark:text-[#7E869C]">
                      Right Arm
                    </div>
                    {bodySilhouette.rightArm.map((item) => {
                      const active = selectedBone === item.boneName;
                      const edited = Boolean(workingBones[item.boneName]);
                      return (
                        <button
                          key={item.boneName}
                          type="button"
                          onClick={() => handleSelectBone(item.boneName)}
                          className={`w-full px-1.5 py-1.5 rounded-lg text-[11px] font-bold truncate transition-colors ${
                            active
                              ? 'bg-[#F59E0B] text-slate-950'
                              : edited
                              ? 'bg-[#7C5CFF]/18 text-[#6A48F5] dark:text-[#C4B5FD] border border-[#7C5CFF]/35'
                              : 'bg-slate-100 dark:bg-[#1F2430] text-slate-700 dark:text-[#C8D0E4] hover:bg-slate-200 dark:hover:bg-[#2A3142]'
                          }`}
                        >
                          {item.label.replace(/^R /, '')}
                        </button>
                      );
                    })}
                  </div>
                </div>

                {/* Lower Body Grid: Left Leg | Right Leg */}
                <div className="grid grid-cols-2 gap-1.5 pt-1">
                  <div className="space-y-1">
                    <div className="text-[10px] font-bold text-center text-slate-400 dark:text-[#7E869C]">
                      Left Leg
                    </div>
                    {bodySilhouette.leftLeg.map((item) => {
                      const active = selectedBone === item.boneName;
                      const edited = Boolean(workingBones[item.boneName]);
                      return (
                        <button
                          key={item.boneName}
                          type="button"
                          onClick={() => handleSelectBone(item.boneName)}
                          className={`w-full px-2 py-1.5 rounded-lg text-[11px] font-bold truncate transition-colors ${
                            active
                              ? 'bg-[#F59E0B] text-slate-950'
                              : edited
                              ? 'bg-[#7C5CFF]/18 text-[#6A48F5] dark:text-[#C4B5FD] border border-[#7C5CFF]/35'
                              : 'bg-slate-100 dark:bg-[#1F2430] text-slate-700 dark:text-[#C8D0E4] hover:bg-slate-200 dark:hover:bg-[#2A3142]'
                          }`}
                        >
                          {item.label.replace(/^L /, '')}
                        </button>
                      );
                    })}
                  </div>

                  <div className="space-y-1">
                    <div className="text-[10px] font-bold text-center text-slate-400 dark:text-[#7E869C]">
                      Right Leg
                    </div>
                    {bodySilhouette.rightLeg.map((item) => {
                      const active = selectedBone === item.boneName;
                      const edited = Boolean(workingBones[item.boneName]);
                      return (
                        <button
                          key={item.boneName}
                          type="button"
                          onClick={() => handleSelectBone(item.boneName)}
                          className={`w-full px-2 py-1.5 rounded-lg text-[11px] font-bold truncate transition-colors ${
                            active
                              ? 'bg-[#F59E0B] text-slate-950'
                              : edited
                              ? 'bg-[#7C5CFF]/18 text-[#6A48F5] dark:text-[#C4B5FD] border border-[#7C5CFF]/35'
                              : 'bg-slate-100 dark:bg-[#1F2430] text-slate-700 dark:text-[#C8D0E4] hover:bg-slate-200 dark:hover:bg-[#2A3142]'
                          }`}
                        >
                          {item.label.replace(/^R /, '')}
                        </button>
                      );
                    })}
                  </div>
                </div>

                {/* All Skeleton Bones Dropdown */}
                <div className="pt-1 space-y-1">
                  <label className="block text-[10px] font-bold text-slate-500 dark:text-[#8E96AB]">
                    All Skeleton Bones ({boneNames.length})
                  </label>
                  <select
                    value={selectedBone ?? ''}
                    onChange={(e) => e.target.value && handleSelectBone(e.target.value)}
                    className="w-full px-2.5 py-1.5 rounded-lg bg-slate-100 dark:bg-[#1F2430] text-xs font-semibold border border-slate-200/70 dark:border-white/[0.08]"
                  >
                    {boneNames.map((bn) => (
                      <option key={bn} value={bn}>
                        {getFriendlyBoneLabel(bn, effectiveRig.boneMap)} ({bn})
                      </option>
                    ))}
                  </select>
                </div>
              </div>
            </>
          )}
        </aside>
      </div>

      {/* BOTTOM FULL-WIDTH KEYFRAME TIMELINE DOCK */}
      {studioMode === 'pose' && boneNames.length > 0 && (
        <section className="shrink-0 bg-white dark:bg-[#171A23] border-t border-slate-200/80 dark:border-white/[0.08] px-4 py-3 space-y-2.5">
          {/* Row 1: Transport, Keyframe Actions, Pose Utilities, Timing */}
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="flex flex-wrap items-center gap-1.5">
              <button
                type="button"
                onClick={handleTogglePlay}
                disabled={sortedKeyframes.length < 2}
                className={`px-3.5 py-1.5 rounded-lg text-xs font-bold inline-flex items-center gap-1.5 whitespace-nowrap transition-colors disabled:opacity-40 ${
                  isPlaying
                    ? 'bg-[#F59E0B] text-slate-950'
                    : 'bg-[#7C5CFF] hover:bg-[#6A48F5] text-white'
                }`}
              >
                {isPlaying ? <Pause size={13} /> : <Play size={13} />}
                <span>{isPlaying ? 'Pause' : 'Play Move'}</span>
              </button>

              <button
                type="button"
                onClick={handleSaveKeyframe}
                className={`px-3.5 py-1.5 rounded-lg text-xs font-bold inline-flex items-center gap-1.5 whitespace-nowrap transition-colors ${
                  isDirtyPose
                    ? 'bg-[#20B46A] hover:bg-[#1A9E5C] text-white'
                    : 'bg-slate-200 dark:bg-[#23293A] hover:bg-slate-300 dark:hover:bg-[#2D354A] text-slate-900 dark:text-white'
                }`}
              >
                <KeyRound size={13} />
                <span>{activeKeyframe ? 'Update Keyframe' : 'Save Keyframe'}</span>
              </button>

              {activeKeyframe && sortedKeyframes.length > 1 && (
                <button
                  type="button"
                  onClick={() => handleDeleteKeyframe(activeKeyframe.id)}
                  className="px-2.5 py-1.5 rounded-lg bg-[#F2545B]/12 text-[#F2545B] hover:bg-[#F2545B]/20 text-xs font-bold inline-flex items-center gap-1 whitespace-nowrap"
                >
                  <Trash2 size={12} />
                  <span>Delete Key</span>
                </button>
              )}

              <div className="hidden sm:block h-5 w-px bg-slate-200 dark:bg-white/[0.1] mx-1" />

              <button
                type="button"
                onClick={() => handleGrabLivePose(draft.slot)}
                title="Capture the character's current live animation pose to start customizing"
                className="px-2.5 py-1.5 rounded-lg bg-[#7C5CFF]/15 text-[#7C5CFF] hover:bg-[#7C5CFF]/25 text-xs font-bold inline-flex items-center gap-1 whitespace-nowrap"
              >
                <Sparkles size={12} />
                <span>Grab {SLOT_OPTIONS.find((s) => s.slot === draft.slot)?.short} Pose</span>
              </button>

              <button
                type="button"
                onClick={() => {
                  setClipboardPose({
                    bones: JSON.parse(JSON.stringify(workingBones)),
                    hipsY: workingHipsY,
                  });
                  flashToast('Pose copied');
                }}
                className="px-2.5 py-1.5 rounded-lg bg-slate-100 dark:bg-[#1F2430] hover:bg-slate-200 dark:hover:bg-[#2A3142] text-xs font-semibold inline-flex items-center gap-1 whitespace-nowrap"
              >
                <Copy size={12} />
                <span>Copy</span>
              </button>

              {clipboardPose && (
                <button
                  type="button"
                  onClick={() => {
                    setIsPlaying(false);
                    setWorkingBones({ ...clipboardPose.bones });
                    setWorkingHipsY(clipboardPose.hipsY);
                    setIsDirtyPose(true);
                  }}
                  className="px-2.5 py-1.5 rounded-lg bg-slate-100 dark:bg-[#1F2430] hover:bg-slate-200 dark:hover:bg-[#2A3142] text-xs font-semibold whitespace-nowrap"
                >
                  Paste
                </button>
              )}

              {/* Dedicated Mirror Pose Tool */}
              <div className="inline-flex items-center gap-0.5 p-0.5 rounded-lg bg-slate-100 dark:bg-[#1F2430] border border-slate-200/70 dark:border-white/[0.08]">
                <button
                  type="button"
                  onClick={() => handleApplyMirrorPose('flip')}
                  title="Swap Left and Right sides across the body (great for walk/run alternate steps)"
                  className="px-2 py-1 rounded-md text-[11px] font-bold text-slate-700 dark:text-[#D5DCF0] hover:bg-white dark:hover:bg-[#2A3142] inline-flex items-center gap-1 whitespace-nowrap"
                >
                  <FlipHorizontal2 size={12} className="text-[#7C5CFF]" />
                  <span>Flip L↔R</span>
                </button>
                <button
                  type="button"
                  onClick={() => handleApplyMirrorPose('leftToRight')}
                  title="Copy Left limb pose mirrored onto Right side for symmetry"
                  className="px-1.5 py-1 rounded-md text-[11px] font-bold text-slate-600 dark:text-[#B8C0D6] hover:bg-white dark:hover:bg-[#2A3142] whitespace-nowrap"
                >
                  L→R
                </button>
                <button
                  type="button"
                  onClick={() => handleApplyMirrorPose('rightToLeft')}
                  title="Copy Right limb pose mirrored onto Left side for symmetry"
                  className="px-1.5 py-1 rounded-md text-[11px] font-bold text-slate-600 dark:text-[#B8C0D6] hover:bg-white dark:hover:bg-[#2A3142] whitespace-nowrap"
                >
                  R→L
                </button>
                <button
                  type="button"
                  onClick={() => setLiveMirror((v) => !v)}
                  title="Live Symmetry: rotating a left or right limb automatically mirrors the opposite limb in real time"
                  className={`px-2 py-1 rounded-md text-[11px] font-bold whitespace-nowrap transition-colors ${
                    liveMirror
                      ? 'bg-[#7C5CFF] text-white'
                      : 'text-slate-500 dark:text-[#949BB0] hover:bg-white dark:hover:bg-[#2A3142]'
                  }`}
                >
                  {liveMirror ? 'Sym On' : 'Sym'}
                </button>
              </div>

              {/* Pose-to-Pose Keyframe Stepper + Onion Skinning Strip */}
              <div className="hidden sm:block h-5 w-px bg-slate-200 dark:bg-white/[0.1] mx-1" />

              <div className="inline-flex items-center gap-0.5 p-0.5 rounded-lg bg-slate-100 dark:bg-[#1F2430]">
                <button
                  type="button"
                  disabled={!prevKeyframe}
                  onClick={() => prevKeyframe && handleScrub(prevKeyframe.time)}
                  title={
                    prevKeyframe
                      ? `Jump to previous keyframe (${Math.round(prevKeyframe.time * 100)}%)`
                      : 'No previous keyframe'
                  }
                  className="px-1.5 py-1 rounded-md text-slate-600 dark:text-[#C8D0E4] hover:bg-white dark:hover:bg-[#2A3142] disabled:opacity-35"
                >
                  <ChevronLeft size={13} />
                </button>
                <button
                  type="button"
                  onClick={() => setOnionEnabled((v) => !v)}
                  title="Show ghostly 3D silhouettes of the previous and next keyframes"
                  className={`px-2 py-1 rounded-md text-[11px] font-bold inline-flex items-center gap-1 whitespace-nowrap transition-colors ${
                    onionEnabled
                      ? 'bg-[#FB7185] text-slate-950'
                      : 'text-slate-600 dark:text-[#C8D0E4] hover:bg-white dark:hover:bg-[#2A3142]'
                  }`}
                >
                  <Layers size={12} />
                  <span>Onion</span>
                </button>
                <button
                  type="button"
                  disabled={!nextKeyframe}
                  onClick={() => nextKeyframe && handleScrub(nextKeyframe.time)}
                  title={
                    nextKeyframe
                      ? `Jump to next keyframe (${Math.round(nextKeyframe.time * 100)}%)`
                      : 'No next keyframe'
                  }
                  className="px-1.5 py-1 rounded-md text-slate-600 dark:text-[#C8D0E4] hover:bg-white dark:hover:bg-[#2A3142] disabled:opacity-35"
                >
                  <ChevronRight size={13} />
                </button>
              </div>

              {onionEnabled && (
                <div className="inline-flex items-center gap-1.5 px-2 py-1 rounded-lg bg-slate-100 dark:bg-[#12151E] border border-slate-200/80 dark:border-white/[0.08] text-[11px]">
                  <button
                    type="button"
                    onClick={() => setOnionShowPrev((v) => !v)}
                    title="Toggle Previous Keyframe ghost silhouette (Rose)"
                    className={`inline-flex items-center gap-1 px-1.5 py-0.5 rounded font-bold transition-opacity ${
                      onionShowPrev
                        ? 'bg-[#FB7185]/20 text-[#E11D48] dark:text-[#FDA4AF]'
                        : 'text-slate-400 dark:text-[#6B7285] opacity-60'
                    }`}
                  >
                    <span className="w-2 h-2 rounded-full bg-[#FB7185]" />
                    <span>
                      Prev{prevKeyframe ? ` ${Math.round(prevKeyframe.time * 100)}%` : ''}
                    </span>
                  </button>

                  <button
                    type="button"
                    onClick={() => setOnionShowNext((v) => !v)}
                    title="Toggle Next Keyframe ghost silhouette (Green)"
                    className={`inline-flex items-center gap-1 px-1.5 py-0.5 rounded font-bold transition-opacity ${
                      onionShowNext
                        ? 'bg-[#34D399]/20 text-[#059669] dark:text-[#6EE7B7]'
                        : 'text-slate-400 dark:text-[#6B7285] opacity-60'
                    }`}
                  >
                    <span className="w-2 h-2 rounded-full bg-[#34D399]" />
                    <span>
                      Next{nextKeyframe ? ` ${Math.round(nextKeyframe.time * 100)}%` : ''}
                    </span>
                  </button>

                  <label className="hidden md:inline-flex items-center gap-1 text-[10px] font-semibold text-slate-500 dark:text-[#949BB0] pl-0.5">
                    <span>Ghost</span>
                    <input
                      type="range"
                      min={0.12}
                      max={0.6}
                      step={0.02}
                      value={onionOpacity}
                      onChange={(e) => setOnionOpacity(Number(e.target.value))}
                      className="w-14 accent-[#FB7185]"
                    />
                  </label>
                </div>
              )}
            </div>

            {/* Right Timing & Easing Curve Controls */}
            <div className="flex flex-wrap items-center gap-2 text-xs">
              <label className="inline-flex items-center gap-1.5 font-semibold text-slate-600 dark:text-[#A5AEC4]">
                <span>Length</span>
                <input
                  type="number"
                  min={0.3}
                  max={6}
                  step={0.1}
                  value={draft.duration}
                  onChange={(e) => {
                    const v = Math.max(0.3, Math.min(6, Number(e.target.value) || 1.2));
                    setDraft((prev) => ({ ...prev, duration: Math.round(v * 10) / 10 }));
                  }}
                  className="w-14 px-1.5 py-1 rounded-lg bg-slate-100 dark:bg-[#1F2430] border border-slate-200 dark:border-white/[0.08] font-mono text-xs tabular-nums text-center"
                />
                <span>s</span>
              </label>

              <button
                type="button"
                onClick={() => setDraft((prev) => ({ ...prev, loop: !prev.loop }))}
                className={`px-2.5 py-1 rounded-lg text-xs font-bold inline-flex items-center gap-1 whitespace-nowrap ${
                  draft.loop
                    ? 'bg-[#06B6D4]/20 text-[#0E7490] dark:text-[#22D3EE]'
                    : 'bg-slate-100 dark:bg-[#1F2430] text-slate-500 dark:text-[#949BB0]'
                }`}
              >
                <Repeat size={12} />
                <span>{draft.loop ? 'Loop On' : 'Play Once'}</span>
              </button>

              {/* Keyframe Easing Function Dropdown */}
              <div className="inline-flex items-center gap-1.5 px-2 py-1 rounded-lg bg-slate-100 dark:bg-[#1F2430] border border-slate-200 dark:border-white/[0.08]">
                <EasingCurveIcon easing={draft.easing} />
                <span className="text-[11px] font-bold text-slate-500 dark:text-[#949BB0] hidden sm:inline">
                  Easing
                </span>
                <select
                  value={draft.easing}
                  onChange={(e) => {
                    const nextEasing = e.target.value as MotionEasing;
                    setDraft((prev) => ({
                      ...prev,
                      easing: nextEasing,
                      keyframes: prev.keyframes.map((kf) => ({ ...kf, easing: undefined })),
                    }));
                  }}
                  aria-label="Easing function between keyframes"
                  className="bg-transparent text-xs font-bold text-slate-900 dark:text-white focus:outline-none cursor-pointer"
                >
                  {EASING_OPTIONS.map((opt) => (
                    <option key={opt.value} value={opt.value} className="bg-white dark:bg-[#171A23]">
                      {opt.label}
                    </option>
                  ))}
                </select>
              </div>

              <span className="font-mono text-[11px] tabular-nums text-slate-500 dark:text-[#949BB0] pl-1">
                {(playhead * draft.duration).toFixed(2)}s / {draft.duration.toFixed(1)}s ·{' '}
                {Math.round(playhead * 100)}%
              </span>
            </div>
          </div>

          {/* Row 2: Wide Scrubber Track */}
          <div className="space-y-1">
            <div
              ref={trackRef}
              onPointerDown={(e) => {
                e.currentTarget.setPointerCapture(e.pointerId);
                scrubFromClientX(e.clientX);
              }}
              onPointerMove={(e) => {
                if (e.buttons !== 1) return;
                scrubFromClientX(e.clientX);
              }}
              className="relative h-12 rounded-xl bg-slate-200/80 dark:bg-[#0B0E16] border border-slate-300/80 dark:border-white/[0.09] cursor-ew-resize select-none touch-none overflow-hidden"
            >
              {/* 10% subtle grid lines */}
              {[10, 20, 30, 40, 50, 60, 70, 80, 90].map((pct) => (
                <div
                  key={pct}
                  style={{ left: `${pct}%` }}
                  className={`absolute top-0 bottom-0 w-px pointer-events-none ${
                    pct === 50
                      ? 'bg-slate-400/40 dark:bg-white/[0.14]'
                      : 'bg-slate-400/20 dark:bg-white/[0.06]'
                  }`}
                />
              ))}

              {/* Onion Skin Pose-to-Pose Range Highlights on Timeline */}
              {onionEnabled && onionShowPrev && prevKeyframe && prevKeyframe.time < playhead && (
                <div
                  style={{
                    left: `${prevKeyframe.time * 100}%`,
                    width: `${(playhead - prevKeyframe.time) * 100}%`,
                  }}
                  className="absolute top-1 bottom-1 bg-[#FB7185]/16 border-b-2 border-[#FB7185]/70 pointer-events-none"
                />
              )}
              {onionEnabled && onionShowNext && nextKeyframe && nextKeyframe.time > playhead && (
                <div
                  style={{
                    left: `${playhead * 100}%`,
                    width: `${(nextKeyframe.time - playhead) * 100}%`,
                  }}
                  className="absolute top-1 bottom-1 bg-[#34D399]/16 border-b-2 border-[#34D399]/70 pointer-events-none"
                />
              )}

              {/* Auto-Close Loop Return Bridge */}
              {draft.loop &&
                draft.autoCloseLoop !== false &&
                sortedKeyframes.length >= 2 &&
                lastKeyTime < 0.98 && (
                  <div
                    style={{
                      left: `${lastKeyTime * 100}%`,
                      width: `${(1 - lastKeyTime) * 100}%`,
                    }}
                    className="absolute top-2 bottom-2 bg-[#06B6D4]/15 border-y border-dashed border-[#06B6D4]/55 pointer-events-none flex items-center justify-center"
                  >
                    <span className="text-[10px] font-bold text-[#0891B2] dark:text-[#22D3EE] truncate px-2">
                      → Auto-Loop Blend to 0% Start
                    </span>
                  </div>
                )}

              {/* Progress fill */}
              <div
                style={{ width: `${playhead * 100}%` }}
                className="absolute top-0 bottom-0 left-0 bg-[#7C5CFF]/15 pointer-events-none"
              />

              {/* Keyframe diamonds */}
              {sortedKeyframes.map((kf, idx) => {
                const isSelected = activeKeyframe?.id === kf.id;
                const isStart = idx === 0;
                const isOnionPrev = onionEnabled && onionShowPrev && prevKeyframe?.id === kf.id;
                const isOnionNext = onionEnabled && onionShowNext && nextKeyframe?.id === kf.id;
                return (
                  <button
                    key={kf.id}
                    type="button"
                    title={`Keyframe ${idx + 1} (${(kf.time * draft.duration).toFixed(2)}s · ${Math.round(kf.time * 100)}%)${
                      isOnionPrev ? ' · Onion Skin Prev' : isOnionNext ? ' · Onion Skin Next' : ''
                    }`}
                    onPointerDown={(e) => e.stopPropagation()}
                    onClick={(e) => {
                      e.stopPropagation();
                      handleScrub(kf.time);
                    }}
                    style={{ left: `${kf.time * 100}%` }}
                    className="absolute top-1/2 -translate-x-1/2 -translate-y-1/2 w-7 h-7 flex items-center justify-center z-10 group"
                  >
                    <span
                      className={`w-4 h-4 rotate-45 rounded-[2px] border-2 transition-transform ${
                        isSelected
                          ? 'bg-[#F59E0B] border-white scale-110'
                          : isOnionPrev
                          ? 'bg-[#FB7185] border-white ring-2 ring-[#FB7185]/60 group-hover:scale-110'
                          : isOnionNext
                          ? 'bg-[#34D399] border-white ring-2 ring-[#34D399]/60 group-hover:scale-110'
                          : isStart
                          ? 'bg-[#06B6D4] border-white/95 group-hover:scale-110'
                          : 'bg-[#7C5CFF] border-white/90 group-hover:scale-110'
                      }`}
                    />
                  </button>
                );
              })}

              {/* Playhead needle */}
              <div
                style={{ left: `${playhead * 100}%` }}
                className="absolute top-0 bottom-0 w-0.5 bg-[#F59E0B] -translate-x-1/2 pointer-events-none z-20"
              >
                <div className="w-3 h-3 rounded-full bg-[#F59E0B] border border-white -translate-x-[5px] -translate-y-0.5" />
              </div>
            </div>

            {/* Row 3: Time ticks + Seamless Loop Guide */}
            <div className="flex flex-wrap items-center justify-between gap-2 text-[11px] pt-0.5">
              {draft.loop && loopReport ? (
                <div className="flex flex-wrap items-center gap-2 min-w-0">
                  <span
                    className={`font-bold ${
                      loopReport.isSeamless
                        ? 'text-[#16A34A] dark:text-[#34D399]'
                        : 'text-[#D97706] dark:text-[#FBBF24]'
                    }`}
                  >
                    {loopReport.isAutoClosed
                      ? 'Loop Guide · Auto-Blend to Start (100% seamless)'
                      : loopReport.isSeamless
                      ? 'Loop Guide · Start & End Match (100% seamless)'
                      : `Loop Seam · ${loopReport.matchPercent}% match (${loopReport.maxDiffDeg}° off)`}
                  </span>
                  {!loopReport.isSeamless && loopReport.mismatchedJoints.length > 0 && (
                    <span className="text-slate-500 dark:text-[#949BB0] truncate">
                      Adjust: {loopReport.mismatchedJoints.join(', ')}
                    </span>
                  )}
                </div>
              ) : (
                <span className="text-slate-500 dark:text-[#8E96AB]">
                  One-shot action · Clamps cleanly on final keyframe
                </span>
              )}

              {draft.loop && (
                <div className="flex flex-wrap items-center gap-2">
                  <label className="inline-flex items-center gap-1.5 font-semibold text-slate-600 dark:text-[#A5AEC4] cursor-pointer">
                    <input
                      type="checkbox"
                      checked={draft.autoCloseLoop !== false}
                      onChange={(e) =>
                        setDraft((prev) => ({ ...prev, autoCloseLoop: e.target.checked }))
                      }
                      className="accent-[#06B6D4] w-3.5 h-3.5"
                    />
                    <span>Auto-Close Loop</span>
                  </label>

                  <button
                    type="button"
                    onClick={() => setShowLoopGhost((v) => !v)}
                    className={`px-2.5 py-1 rounded-lg font-bold inline-flex items-center gap-1 whitespace-nowrap ${
                      showLoopGhost
                        ? 'bg-[#06B6D4] text-slate-950'
                        : 'bg-slate-100 dark:bg-[#1F2430] text-slate-700 dark:text-[#C8D0E4] hover:bg-slate-200 dark:hover:bg-[#2A3142]'
                    }`}
                  >
                    <Ghost size={12} />
                    <span>{showLoopGhost ? 'Start Ghost On' : 'Start Pose Ghost'}</span>
                  </button>

                  <button
                    type="button"
                    onClick={handleMatchEndToStart}
                    disabled={sortedKeyframes.length === 0}
                    className="px-2.5 py-1 rounded-lg bg-[#20B46A]/15 text-[#16A34A] dark:text-[#34D399] hover:bg-[#20B46A]/25 font-bold whitespace-nowrap disabled:opacity-40"
                  >
                    Match End to Start
                  </button>
                </div>
              )}
            </div>
          </div>
        </section>
      )}
        </>
      )}
    </div>
  );
};
