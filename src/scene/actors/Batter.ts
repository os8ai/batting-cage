import * as THREE from 'three';
import { SWING_CONTACT_OFFSET_S } from '../../core/constants';
import type { DomainEvent, Bat as BatChoice, Grade, Handedness } from '../../core/types';
import { swingTimeScale, type SwingClipMeta } from './swingRetiming';

/**
 * The batter actor: a rigged, animated hierarchy with four states — relaxed
 * idle, load/waggle anticipation, the swing (contact frame anchored at
 * K = 150 ms via swingRetiming), and reaction/recoil (§11).
 *
 * M1 ships the PROCEDURAL rig — a code-built athlete (named-joint hierarchy +
 * programmatic AnimationClips through the standard AnimationMixer). This is
 * the M1-PLAN §3 fallback path: the Mixamo/glTF swap later is a content
 * change (same joint names, same clip metadata contract), not code.
 */

interface Pose {
  [joint: string]: [number, number, number]; // XYZ Euler, degrees
}

const D = Math.PI / 180;

/**
 * Base athletic stance every pose is layered on. Rig-local axes: +z = toward
 * the plate (chest normal), +x = the batter's LEFT (lead side, toward the
 * machine), −x = his RIGHT (rear side, toward the catcher). Hands sit at the
 * REAR (right) shoulder — righty bat carry; the lead arm crosses the chest
 * to the grip. All batWrist values are numerically solved for target bat
 * directions (see M1-NOTES; solver in the repo history).
 */
const BASE: Pose = {
  hips: [0, 0, 0],
  spine: [4, 0, 0],
  chest: [4, 0, 0],
  head: [-6, 18, 0],
  shoulderL: [0, 0, -55], // lead arm crosses toward the rear shoulder
  elbowL: [-50, 0, -30],
  shoulderR: [0, 0, -20], // rear upper arm stays on his right side
  elbowR: [-115, 0, 0], // forearm folds up — wrist at the right shoulder
  thighL: [-6, 0, -7],
  shinL: [10, 0, 0],
  thighR: [-6, 0, 7],
  shinR: [10, 0, 0],
  batWrist: [150, -25, 85],
};

function mergePose(over: Pose): Pose {
  return { ...BASE, ...over };
}

/** Build an AnimationClip from timed poses (quaternion tracks per joint). */
function clipFromPoses(name: string, keys: Array<{ t: number; pose: Pose }>): THREE.AnimationClip {
  const joints = Object.keys(BASE);
  const tracks: THREE.KeyframeTrack[] = [];
  const e = new THREE.Euler();
  const q = new THREE.Quaternion();
  for (const j of joints) {
    const times: number[] = [];
    const values: number[] = [];
    for (const k of keys) {
      const rot = k.pose[j] ?? BASE[j]!;
      e.set(rot[0] * D, rot[1] * D, rot[2] * D, 'XYZ');
      q.setFromEuler(e);
      times.push(k.t);
      values.push(q.x, q.y, q.z, q.w);
    }
    tracks.push(new THREE.QuaternionKeyframeTrack(`${j}.quaternion`, times, values));
  }
  return new THREE.AnimationClip(name, keys[keys.length - 1]!.t, tracks);
}

/** Swing clip metadata — the contact frame the retiming math anchors on. */
export const SWING_META: SwingClipMeta = { durationS: 0.5, contactTimeS: 0.21 };

export class Batter {
  readonly group = new THREE.Group();
  private mixer: THREE.AnimationMixer;
  private actions: Record<'idle' | 'load' | 'swing' | 'reaction', THREE.AnimationAction>;
  private current: THREE.AnimationAction;
  private joints = new Map<string, THREE.Object3D>();
  private batWood: THREE.Group;
  private batMetal: THREE.Group;
  private inRound = false;
  private lastGrade: Grade | null = null;

  bat: BatChoice = 'WOOD';
  handedness: Handedness = 'R';

  constructor() {
    this.buildRig();
    this.batWood = this.buildBat('WOOD');
    this.batMetal = this.buildBat('METAL');
    const wrist = this.joints.get('batWrist')!;
    wrist.add(this.batWood, this.batMetal);
    this.batMetal.visible = false;

    this.mixer = new THREE.AnimationMixer(this.group);
    const clips = this.buildClips();
    this.actions = {
      idle: this.mixer.clipAction(clips.idle),
      load: this.mixer.clipAction(clips.load),
      swing: this.mixer.clipAction(clips.swing),
      reaction: this.mixer.clipAction(clips.reaction),
    };
    this.actions.idle.setLoop(THREE.LoopRepeat, Infinity);
    this.actions.load.setLoop(THREE.LoopRepeat, Infinity);
    this.actions.swing.setLoop(THREE.LoopOnce, 1);
    this.actions.swing.clampWhenFinished = true;
    this.actions.reaction.setLoop(THREE.LoopOnce, 1);
    this.actions.reaction.clampWhenFinished = true;

    this.current = this.actions.idle;
    this.current.play();

    this.mixer.addEventListener('finished', (ev) => {
      if (ev.action === this.actions.swing) this.crossTo(this.actions.reaction, 0.12);
      else if (ev.action === this.actions.reaction) this.crossTo(this.inRound ? this.actions.load : this.actions.idle, 0.4);
    });

    this.setHandedness('R');
  }

  // -- rig ------------------------------------------------------------------

  private joint(name: string, parent: THREE.Object3D, x: number, y: number, z: number): THREE.Object3D {
    const g = new THREE.Group();
    g.name = name;
    g.position.set(x, y, z);
    parent.add(g);
    this.joints.set(name, g);
    return g;
  }

  private limb(parent: THREE.Object3D, r1: number, r2: number, len: number, mat: THREE.Material): THREE.Mesh {
    const m = new THREE.Mesh(new THREE.CylinderGeometry(r2, r1, len, 10), mat);
    m.position.y = -len / 2;
    m.castShadow = true;
    parent.add(m);
    return m;
  }

  private buildRig(): void {
    const skin = new THREE.MeshStandardMaterial({ color: 0xb98a68, roughness: 0.7 });
    const jersey = new THREE.MeshStandardMaterial({ color: 0x8a8f96, roughness: 0.85 });
    const pants = new THREE.MeshStandardMaterial({ color: 0x3a3d44, roughness: 0.9 });
    const helmetMat = new THREE.MeshStandardMaterial({ color: 0x202b4a, roughness: 0.35, metalness: 0.3 });

    const hips = this.joint('hips', this.group, 0, 0.98, 0);
    const pelvis = new THREE.Mesh(new THREE.BoxGeometry(0.34, 0.2, 0.22), pants);
    pelvis.castShadow = true;
    hips.add(pelvis);

    const spine = this.joint('spine', hips, 0, 0.16, 0);
    const chest = this.joint('chest', spine, 0, 0.22, 0);
    const torso = new THREE.Mesh(new THREE.BoxGeometry(0.38, 0.42, 0.24), jersey);
    torso.position.y = -0.05;
    torso.castShadow = true;
    chest.add(torso);

    const head = this.joint('head', chest, 0, 0.32, 0);
    const skull = new THREE.Mesh(new THREE.SphereGeometry(0.115, 16, 12), skin);
    skull.castShadow = true;
    head.add(skull);
    const helmet = new THREE.Mesh(new THREE.SphereGeometry(0.125, 16, 12, 0, Math.PI * 2, 0, Math.PI * 0.62), helmetMat);
    helmet.position.y = 0.015;
    head.add(helmet);
    const brim = new THREE.Mesh(new THREE.CylinderGeometry(0.125, 0.14, 0.02, 12, 1, false, 0, Math.PI), helmetMat);
    brim.position.set(0, 0.04, 0.08);
    brim.rotation.y = -Math.PI / 2;
    head.add(brim);

    // Arms. L = lead arm (machine side, local +x), R = rear/top hand.
    const shoulderL = this.joint('shoulderL', chest, 0.24, 0.16, 0);
    this.limb(shoulderL, 0.052, 0.046, 0.27, jersey);
    const elbowL = this.joint('elbowL', shoulderL, 0, -0.27, 0);
    this.limb(elbowL, 0.044, 0.036, 0.25, skin);

    const shoulderR = this.joint('shoulderR', chest, -0.24, 0.16, 0);
    this.limb(shoulderR, 0.052, 0.046, 0.27, jersey);
    const elbowR = this.joint('elbowR', shoulderR, 0, -0.27, 0);
    this.limb(elbowR, 0.044, 0.036, 0.25, skin);

    // Hands meet at the grip; the bat hangs off a wrist joint on the rear arm.
    const batWrist = this.joint('batWrist', elbowR, 0, -0.27, 0);
    const hands = new THREE.Mesh(new THREE.SphereGeometry(0.055, 10, 8), skin);
    batWrist.add(hands);

    // Legs.
    const thighL = this.joint('thighL', hips, 0.12, -0.08, 0);
    this.limb(thighL, 0.07, 0.058, 0.42, pants);
    const shinL = this.joint('shinL', thighL, 0, -0.42, 0);
    this.limb(shinL, 0.052, 0.04, 0.42, pants);
    const footL = new THREE.Mesh(new THREE.BoxGeometry(0.1, 0.07, 0.24), pants);
    footL.position.set(0, -0.4, 0.06);
    footL.castShadow = true;
    shinL.add(footL);

    const thighR = this.joint('thighR', hips, -0.12, -0.08, 0);
    this.limb(thighR, 0.07, 0.058, 0.42, pants);
    const shinR = this.joint('shinR', thighR, 0, -0.42, 0);
    this.limb(shinR, 0.052, 0.04, 0.42, pants);
    const footR = footL.clone();
    shinR.add(footR);
  }

  private buildBat(kind: BatChoice): THREE.Group {
    const g = new THREE.Group();
    const profile: THREE.Vector2[] = [];
    // Knob → handle → taper → barrel (34 in ≈ 0.86 m).
    const pts: Array<[number, number]> = [
      [0.018, 0],
      [0.025, 0.012],
      [0.014, 0.03],
      [0.013, 0.28],
      [0.022, 0.5],
      [0.033, 0.68],
      [0.034, 0.84],
      [0.028, 0.86],
      [0, 0.865],
    ];
    for (const [r, y] of pts) profile.push(new THREE.Vector2(r, y));
    const geo = new THREE.LatheGeometry(profile, 14);
    const mat =
      kind === 'WOOD'
        ? new THREE.MeshStandardMaterial({ color: 0xa9742f, roughness: 0.55 })
        : new THREE.MeshStandardMaterial({ color: 0xc3c8cf, roughness: 0.3, metalness: 0.85 });
    const mesh = new THREE.Mesh(geo, mat);
    mesh.castShadow = true;
    g.add(mesh);
    if (kind === 'METAL') {
      const grip = new THREE.Mesh(new THREE.CylinderGeometry(0.016, 0.016, 0.26, 10), new THREE.MeshStandardMaterial({ color: 0x16181d, roughness: 0.9 }));
      grip.position.y = 0.16;
      g.add(grip);
    }
    // Rest angle out of the wrist joint.
    g.rotation.set(-0.5, 0, -0.35);
    return g;
  }

  // -- clips ------------------------------------------------------------------

  private buildClips(): Record<'idle' | 'load' | 'swing' | 'reaction', THREE.AnimationClip> {
    // IDLE: bat resting up over the RIGHT (rear) shoulder, slow breathing
    // sway. Solved bat dir ≈ (-0.30, 0.90, -0.25): up, over his right side,
    // behind the head plane.
    const idleA = mergePose({ hips: [0, -4, 0], batWrist: [150, -25, 85] });
    const idleB = mergePose({ hips: [0, -2, 0], spine: [6, 0, 0], batWrist: [148, -23, 83], head: [-4, 16, 0] });
    const idle = clipFromPoses('idle', [
      { t: 0, pose: idleA },
      { t: 1.3, pose: idleB },
      { t: 2.6, pose: idleA },
    ]);

    // LOAD: crouched anticipation, hands by the rear shoulder, bat cocked up
    // over the right shoulder (solved dir ≈ (-0.40, 0.82, -0.40)).
    const loadA = mergePose({
      hips: [0, -22, 0],
      spine: [10, -10, 0],
      chest: [8, -14, 0],
      head: [-8, 38, 0],
      shoulderL: [0, 0, -62],
      elbowL: [-55, 0, -28],
      shoulderR: [-10, 0, -28],
      elbowR: [-125, 0, 0],
      thighL: [-14, 0, -9],
      shinL: [22, 0, 0],
      thighR: [-16, 0, 9],
      shinR: [24, 0, 0],
      batWrist: [50, 180, -50], // near-vertical carry — tip stays in the play frame
    });
    const loadB = mergePose({
      ...loadA,
      batWrist: [52, 175, -47],
      chest: [8, -17, 0],
    });
    const load = clipFromPoses('load', [
      { t: 0, pose: loadA },
      { t: 0.8, pose: loadB },
      { t: 1.6, pose: loadA },
    ]);

    // SWING: load → stride → CONTACT (t = 0.21 s, the metadata anchor) →
    // extension. Hips lead, chest follows; at contact both arms extend
    // toward the plate and the bat sweeps LEVEL (solved dir ≈
    // (0.35, 0.00, 0.94) — horizontal, barrel over the plate), wrapping
    // around to the lead side on the follow-through.
    const stride = mergePose({
      ...loadA,
      hips: [0, -8, 0],
      thighL: [-22, 0, -9],
      elbowR: [-120, 0, 0],
      batWrist: [65, 30, 75], // uncocking — barrel dropping toward the plane
    });
    const contact = mergePose({
      hips: [0, 38, 0],
      spine: [6, 26, 0],
      chest: [4, 30, 0],
      head: [-6, 10, 0],
      shoulderL: [-75, 0, -15], // both arms extended toward the plate
      elbowL: [-10, 0, 0],
      shoulderR: [-75, 0, 15],
      elbowR: [-15, 0, 0],
      thighL: [-10, 0, -16],
      shinL: [6, 0, 0],
      thighR: [-2, 0, 22],
      shinR: [30, 0, 0],
      batWrist: [-5, 165, -70],
    });
    const extension = mergePose({
      hips: [0, 78, 0],
      spine: [2, 48, 0],
      chest: [0, 52, 0],
      head: [-4, -16, 0],
      shoulderL: [-65, 0, -35],
      elbowL: [-25, 0, 0],
      shoulderR: [-70, 0, 30],
      elbowR: [-20, 0, 0],
      thighL: [-8, 0, -18],
      shinL: [4, 0, 0],
      thighR: [4, 0, 30],
      shinR: [38, 0, 0],
      batWrist: [-50, 175, -85], // wrapped around the lead shoulder
    });
    const swing = clipFromPoses('swing', [
      { t: 0, pose: loadA },
      { t: 0.09, pose: stride },
      { t: SWING_META.contactTimeS, pose: contact },
      { t: SWING_META.durationS, pose: extension },
    ]);

    // REACTION: follow-through hold, eyes tracking the ball.
    const hold = mergePose({
      ...extension,
      head: [-10, -30, 0],
      batWrist: [-55, 170, -85],
    });
    const settle = mergePose({ hips: [0, 24, 0], spine: [4, 12, 0], chest: [4, 12, 0], head: [-6, 6, 0] });
    const reaction = clipFromPoses('reaction', [
      { t: 0, pose: hold },
      { t: 0.55, pose: hold },
      { t: 1.0, pose: settle },
    ]);

    return { idle, load, swing, reaction };
  }

  // -- state ------------------------------------------------------------------

  private crossTo(next: THREE.AnimationAction, fadeS: number): void {
    if (next === this.current) return;
    next.reset();
    next.setEffectiveTimeScale(next === this.actions.swing ? swingTimeScale(SWING_META, SWING_CONTACT_OFFSET_S) : 1);
    next.play();
    this.current.crossFadeTo(next, fadeS, false);
    this.current = next;
  }

  onEvent(e: DomainEvent): void {
    switch (e.type) {
      case 'TOKEN':
        this.inRound = true;
        this.crossTo(this.actions.load, 0.5);
        break;
      case 'SWING_JUDGED':
        this.lastGrade = e.record.grade;
        if (e.record.grade !== 'TAKE') {
          // The retimed clip puts the contact frame exactly K = 150 ms from
          // this moment — the same offset the core judged ε against (E5).
          this.crossTo(this.actions.swing, 0.04);
        }
        break;
      case 'ROUND_END':
        this.inRound = false;
        if (this.current === this.actions.load) this.crossTo(this.actions.idle, 0.6);
        break;
      default:
        break;
    }
  }

  /** Handedness = which batter's box the body occupies (§What). */
  setHandedness(h: Handedness): void {
    this.handedness = h;
    if (h === 'R') {
      this.group.position.set(0.85, 0, 0.1);
      this.group.rotation.y = -Math.PI / 2;
      this.group.scale.set(1, 1, 1);
    } else {
      this.group.position.set(-0.85, 0, 0.1);
      this.group.rotation.y = Math.PI / 2;
      this.group.scale.set(-1, 1, 1);
    }
  }

  /** Bat choice swaps the prop mesh and the contact voice only (§6). */
  setBat(b: BatChoice): void {
    this.bat = b;
    this.batWood.visible = b === 'WOOD';
    this.batMetal.visible = b === 'METAL';
  }

  get gradeOfLastSwing(): Grade | null {
    return this.lastGrade;
  }

  update(dt: number): void {
    this.mixer.update(dt);
  }
}
