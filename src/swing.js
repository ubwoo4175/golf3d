/**
 * The swing path: an editable keyframe track of (torso angle, hand u, hand v)
 * against normalised swing time t in [0, 1]. The hand's perpendicular distance
 * from the rectangle is not authored -- it is solved from the arm rules, see
 * `axisDistanceFor` in kinematics.js.
 *
 * The reference values approximate Rory McIlroy's sequencing -- ~93 degrees of
 * shoulder turn at the top, a deep transition where the hands drop while the
 * torso is already unwinding, and long extension through impact. They are
 * hand-authored from published swing positions, not motion capture, so treat
 * them as a well-shaped starting point that you tune by dragging.
 *
 * THE ARM RULES
 *   t <= RELEASE_T   the lead arm is straight (all folding is at the trail elbow)
 *   t >= RELEASE_T   the trail arm is straight (the lead elbow folds)
 *   t == RELEASE_T   both are straight, which forces u = 0 there
 *
 * Impact is NOT where the trail arm straightens -- it is still extending through
 * impact and only reaches full length at release.
 *
 * THE PATH SHAPE
 *   backswing        convex upward: bows ABOVE the chord from address to the top
 *   downswing        convex downward, and so drops below the backswing -- the
 *                    shallowing loop
 *   follow-through   convex downward
 */

import { rad } from './vec3.js';
import { TIMING } from './config.js';
import { solvePose } from './kinematics.js';

export const PHASES = [
  { id: 'backswing', label: 'Backswing', start: 0, end: 0.55 },
  { id: 'downswing', label: 'Downswing', start: 0.55, end: 0.76 },
  { id: 'followThrough', label: 'Follow-through', start: 0.76, end: 1 },
];

export const phaseAt = (t) =>
  PHASES.find((p) => t <= p.end) ?? PHASES[PHASES.length - 1];

/**
 * Release (P8): where the straight-arm constraint hands over from the lead arm
 * to the trail arm. Deliberately later than impact (t = 0.76).
 */
export const RELEASE_T = 0.82;

/** Which arm is held straight at time t. */
export const constraintAt = (t) => (t <= RELEASE_T ? 'lead' : 'trail');

/**
 * t, torso angle (deg, + = away from target), hand u, hand v, label.
 *
 * u is <= 0 up to release and >= 0 after, hitting exactly 0 at release. That is
 * not a stylistic choice -- `freeArmULimit` shows the rules permit nothing else,
 * because the free arm would have to be longer than it is.
 */
export const REFERENCE_KEYFRAMES = [
  // Backswing -- convex upward, so the hands rise early and the arc flattens.
  { t: 0.0, thetaDeg: 0, u: 0.0, v: -0.55, label: 'Address (P1)' },
  { t: 0.13, thetaDeg: 15, u: -0.075, v: -0.435, label: 'Takeaway (P2)' },
  { t: 0.27, thetaDeg: 40, u: -0.18, v: -0.29, label: 'Lead arm horizontal (P3)' },
  { t: 0.42, thetaDeg: 70, u: -0.29, v: -0.17, label: 'Shaft parallel (P4)' },
  { t: 0.55, thetaDeg: 93, u: -0.375, v: -0.1, label: 'Top of backswing (P5)' },
  // Downswing -- convex downward, tracking under the backswing.
  { t: 0.62, thetaDeg: 66, u: -0.36, v: -0.23, label: 'Transition' },
  { t: 0.68, thetaDeg: 26, u: -0.29, v: -0.39, label: 'Delivery (P6)' },
  { t: 0.76, thetaDeg: -38, u: -0.06, v: -0.52, label: 'Impact (P7)' },
  // Release: the handover. Both arms straight, so u must be 0.
  { t: RELEASE_T, thetaDeg: -60, u: 0.0, v: -0.48, label: 'Release (P8)' },
  // Follow-through -- convex downward.
  { t: 0.9, thetaDeg: -80, u: 0.19, v: -0.33, label: 'Trail arm extended (P9)' },
  { t: 1.0, thetaDeg: -95, u: 0.3, v: 0.05, label: 'Finish (P10)' },
];

/**
 * Catmull-Rom tangent for a non-uniformly spaced scalar track.
 * Endpoints fall back to a one-sided difference.
 */
function tangent(keys, i, get) {
  const prev = keys[i - 1];
  const next = keys[i + 1];
  const cur = keys[i];
  if (!prev) return (get(next) - get(cur)) / (next.t - cur.t);
  if (!next) return (get(cur) - get(prev)) / (cur.t - prev.t);
  return (get(next) - get(prev)) / (next.t - prev.t);
}

function hermite(keys, i, localT, span, get) {
  const a = keys[i];
  const b = keys[i + 1];
  const m0 = tangent(keys, i, get) * span;
  const m1 = tangent(keys, i + 1, get) * span;
  const t2 = localT * localT;
  const t3 = t2 * localT;
  return (
    (2 * t3 - 3 * t2 + 1) * get(a) +
    (t3 - 2 * t2 + localT) * m0 +
    (-2 * t3 + 3 * t2) * get(b) +
    (t3 - t2) * m1
  );
}

/**
 * An editable swing. Emits a change event whenever a keyframe moves so both
 * views and the cached path can refresh.
 */
export class SwingPath {
  constructor(keyframes = REFERENCE_KEYFRAMES) {
    this.listeners = new Set();
    this.reset(keyframes);
  }

  reset(keyframes = REFERENCE_KEYFRAMES) {
    this.keys = keyframes.map((k) => ({ ...k }));
    this.emit();
  }

  onChange(fn) {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  emit() {
    this.cache = null;
    this.listeners.forEach((fn) => fn(this));
  }

  /** Move one keyframe's hand position. Time and torso angle are untouched. */
  setKeyframeHand(index, u, v) {
    const key = this.keys[index];
    if (!key || (key.u === u && key.v === v)) return;
    key.u = u;
    key.v = v;
    this.emit();
  }

  /** Index of the keyframe closest in time to `t`. */
  nearestKeyframeIndex(t) {
    let best = 0;
    let bestDist = Infinity;
    this.keys.forEach((k, i) => {
      const d = Math.abs(k.t - t);
      if (d < bestDist) {
        bestDist = d;
        best = i;
      }
    });
    return best;
  }

  /** Interpolated driving values at normalised time `t`. */
  sample(t) {
    const keys = this.keys;
    const clamped = Math.min(Math.max(t, keys[0].t), keys[keys.length - 1].t);
    let i = 0;
    while (i < keys.length - 2 && keys[i + 1].t < clamped) i += 1;
    const span = keys[i + 1].t - keys[i].t || 1e-6;
    const localT = (clamped - keys[i].t) / span;
    return {
      theta: rad(hermite(keys, i, localT, span, (k) => k.thetaDeg)),
      thetaDeg: hermite(keys, i, localT, span, (k) => k.thetaDeg),
      u: hermite(keys, i, localT, span, (k) => k.u),
      v: hermite(keys, i, localT, span, (k) => k.v),
      constraint: constraintAt(clamped),
    };
  }

  poseAt(t) {
    return solvePose(this.sample(t));
  }

  /**
   * Densely sampled path, cached until a keyframe moves or handedness changes.
   * `local` is the (u, v) trace on the rectangle, `world` the true 3D trace --
   * which is no longer planar, since the solved perpendicular distance varies.
   */
  sampledPath() {
    if (this.cache) return this.cache;
    const n = TIMING.pathSamples;
    const local = [];
    const world = [];
    for (let i = 0; i < n; i += 1) {
      const t = i / (n - 1);
      const d = this.sample(t);
      const pose = solvePose(d);
      local.push({ t, u: d.u, v: d.v, phase: phaseAt(t).id });
      world.push({ t, p: pose.hand, phase: phaseAt(t).id });
    }
    this.cache = { local, world };
    return this.cache;
  }
}
