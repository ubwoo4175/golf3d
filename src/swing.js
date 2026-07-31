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
import { TIMING, CURVE } from './config.js';
import { solvePose, naturalAddress, axisDistanceFor } from './kinematics.js';

export const PHASES = [
  { id: 'backswing', label: 'Backswing', start: 0, end: 0.52 },
  { id: 'downswing', label: 'Downswing', start: 0.52, end: 0.69 },
  { id: 'followThrough', label: 'Follow-through', start: 0.69, end: 1 },
];

export const phaseAt = (t) =>
  PHASES.find((p) => t <= p.end) ?? PHASES[PHASES.length - 1];

/**
 * Release (P7.5): where the straight-arm constraint hands over from the lead arm
 * to the trail arm. Deliberately after impact (P7, t = 0.69) -- the trail arm is
 * still extending through impact and only reaches full length here.
 */
export const RELEASE_T = 0.725;

/** Which arm is held straight at time t. */
export const constraintAt = (t) => (t <= RELEASE_T ? 'lead' : 'trail');

/**
 * The P-system, with shoulder rotation synced to a tour long-iron swing.
 *
 * Fields: t, torso angle (deg, + = turned away from target), hand u, hand v.
 *
 * SHOULDER ROTATION. The definitions of P4, P6, P9 and P10 are themselves stated
 * in terms of shoulder turn, so those four are pinned exactly: +90 at the top,
 * neutral at delivery, -90 square to the target, -120 at the finish. The rest are
 * interpolated to match long-iron sequencing.
 *
 * TIMING. Backswing 0.75 s, downswing (P4 to P7) 0.25 s -- the ~3:1 tour tempo.
 * That is not cosmetic: it puts peak torso rotation speed through impact at about
 * 690 deg/s, which is the right order for a tour player. Change `swingSeconds`
 * and every angular velocity scales with it.
 *
 * HAND PATH. u is <= 0 up to release and >= 0 after, hitting exactly 0 at
 * release. That is not a stylistic choice -- `freeArmULimit` shows the rules
 * permit nothing else, because the free arm would have to be longer than it is.
 */
export const REFERENCE_KEYFRAMES = [
  // Backswing -- convex upward, so the hands rise early and the arc flattens.
  // P1's u and v are placeholders: `applyNaturalAddress` overwrites them from the
  // current spine tilt on every reset.
  { t: 0.0, thetaDeg: 0, u: 0.0, v: -0.51, label: 'P1 address' },
  { t: 0.11, thetaDeg: 22, u: -0.09, v: -0.374, label: 'P1.5 takeaway' },
  { t: 0.2, thetaDeg: 40, u: -0.19, v: -0.264, label: 'P2 shaft parallel' },
  { t: 0.32, thetaDeg: 60, u: -0.28, v: -0.174, label: 'P3 lead arm parallel' },
  { t: 0.52, thetaDeg: 90, u: -0.37, v: -0.09, label: 'P4 top, shoulders 90° away' },
  // Downswing -- convex downward, tracking under the backswing.
  { t: 0.6, thetaDeg: 45, u: -0.345, v: -0.245, label: 'P5 early downswing, lead arm parallel' },
  { t: 0.655, thetaDeg: 0, u: -0.27, v: -0.405, label: 'P6 delivery, shaft parallel, square' },
  { t: 0.69, thetaDeg: -35, u: -0.055, v: -0.525, label: 'P7 impact' },
  // The handover. Both arms straight, so u must be 0.
  { t: RELEASE_T, thetaDeg: -55, u: 0.0, v: -0.475, label: 'P7.5 release, both arms straight' },
  // Follow-through -- convex downward.
  { t: 0.775, thetaDeg: -72, u: 0.115, v: -0.4, label: 'P8 follow-through, shaft parallel' },
  { t: 0.85, thetaDeg: -90, u: 0.215, v: -0.235, label: 'P9 shoulders 90° to target' },
  { t: 1.0, thetaDeg: -120, u: 0.31, v: 0.09, label: 'P10 finish, shoulders 120°' },
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
    this.applyNaturalAddress();
    this.emit();
  }

  /**
   * Snap P1 to the natural address for the current spine tilt. Called on reset
   * and whenever the tilt changes; dragging P1 overrides it until one of those
   * happens.
   */
  applyNaturalAddress() {
    const { u, v } = naturalAddress();
    this.keys[0].u = u;
    this.keys[0].v = v;
  }

  /**
   * Where the reference rectangle belongs: the address hand's own distance from
   * the spine axis, so that P1 lies exactly on the rectangle.
   */
  addressAxisDistance() {
    const p1 = this.keys[0];
    return axisDistanceFor(constraintAt(p1.t), p1.u, p1.v).distance;
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

  /** Straight-line length of segment `i` in the (u, v) plane, in metres. */
  segmentLength(i) {
    const a = this.keys[i];
    const b = this.keys[i + 1];
    return Math.hypot(b.u - a.u, b.v - a.v);
  }

  /**
   * Whether segment `i` is drawn straight rather than curved. Applied to all
   * three tracks together so the pose stays consistent with the drawn path.
   */
  isStraightSegment(i) {
    return this.segmentLength(i) < CURVE.straightBelow;
  }

  /** Interpolated driving values at normalised time `t`. */
  sample(t) {
    const keys = this.keys;
    const clamped = Math.min(Math.max(t, keys[0].t), keys[keys.length - 1].t);
    let i = 0;
    while (i < keys.length - 2 && keys[i + 1].t < clamped) i += 1;
    const span = keys[i + 1].t - keys[i].t || 1e-6;
    const localT = (clamped - keys[i].t) / span;

    const lerp = (get) => get(keys[i]) + (get(keys[i + 1]) - get(keys[i])) * localT;
    const interp = this.isStraightSegment(i)
      ? lerp
      : (get) => hermite(keys, i, localT, span, get);

    const thetaDeg = interp((k) => k.thetaDeg);
    return {
      theta: rad(thetaDeg),
      thetaDeg,
      u: interp((k) => k.u),
      v: interp((k) => k.v),
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
