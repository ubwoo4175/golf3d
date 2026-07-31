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
 *   takeaway         a straight vertical line: u holds at 0 while v rises
 *   backswing        convex upward: bows ABOVE the chord from the takeaway to the top
 *   downswing        convex downward, and so drops below the backswing -- the
 *                    shallowing loop
 *   follow-through   slightly convex upward
 *
 * Those four together are what make the WORLD path flow: see the interpolation
 * notes in the README for the measurements.
 */

import { rad } from './vec3.js';
import { TIMING, CURVE, RELEASE_BLEND_T } from './config.js';
import { solvePose, naturalAddress, axisDistanceFor } from './kinematics.js';

export const PHASES = [
  { id: 'backswing', label: 'Backswing', start: 0, end: 0.6075 },
  { id: 'downswing', label: 'Downswing', start: 0.6075, end: 0.81 },
  { id: 'followThrough', label: 'Follow-through', start: 0.81, end: 1 },
];

export const phaseAt = (t) =>
  PHASES.find((p) => t <= p.end) ?? PHASES[PHASES.length - 1];

/**
 * Release (P7.5): where the straight-arm constraint hands over from the lead arm
 * to the trail arm. Deliberately after impact (P7, t = 0.81, 26 ms earlier) --
 * the trail arm is still extending through impact and only reaches full length
 * here.
 */
export const RELEASE_T = 0.8307;

/** Which arm is held straight at time t. */
export const constraintAt = (t) => (t <= RELEASE_T ? 'lead' : 'trail');

/**
 * Handover weight at time t: 0 while the lead arm is locked, 1 once the trail
 * arm is, smoothstepped across a short window centred on release so the hand
 * path stays smooth through it. See `RELEASE_BLEND_T`.
 */
export function releaseBlendAt(t) {
  const w = RELEASE_BLEND_T;
  if (w <= 0) return t <= RELEASE_T ? 0 : 1;
  const x = Math.min(1, Math.max(0, (t - (RELEASE_T - w)) / (2 * w)));
  return x * x * (3 - 2 * x);
}

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
 * TIMING. The P times are NOT authored -- they are solved from a torso
 * angular-velocity profile, because the angles alone say nothing about how fast
 * the torso passes through them. The profile has three rest points (address, the
 * top, the finish) joined by smooth ramps, with the downswing peak 40 ms before
 * impact, as the thorax leads the club in the kinematic sequence:
 *
 *     backswing   w = A sin^2(pi t / T_back)        peak  240 deg/s
 *     post-top    ramp up to the peak, then down     peak  867 deg/s
 *
 * Constraints: +90 at the top, -35 at impact, -120 at the finish, and impact on
 * the 3:1 mark. Those four fix everything else, including the total duration of
 * 1.235 s -- see the README for the derivation and for why the peak comes out
 * where it does.
 *
 * HAND PATH. u is <= 0 up to release and >= 0 after, hitting exactly 0 at
 * release. That is not a stylistic choice -- `freeArmULimit` shows the rules
 * permit nothing else, because the free arm would have to be longer than it is.
 */
export const REFERENCE_KEYFRAMES = [
  // Takeaway -- u holds at 0, so the hand rises on a straight vertical line and
  // both arms stay equally straight through it: a one-piece takeaway. The
  // segment is 8 cm, under `CURVE.straightBelow`, so it is drawn straight too.
  { t: 0.0, thetaDeg: 0, u: 0.0, v: -0.45, label: 'P1 address' },
  { t: 0.2213, thetaDeg: 22, u: 0.0, v: -0.406, label: 'P1.5 takeaway' },
  // Backswing -- convex upward.
  { t: 0.2868, thetaDeg: 40, u: -0.059, v: -0.252, label: 'P2 shaft parallel' },
  { t: 0.3556, thetaDeg: 60, u: -0.156, v: -0.114, label: 'P3 lead arm parallel' },
  { t: 0.6075, thetaDeg: 90, u: -0.237, v: -0.015, label: 'P4 top, shoulders 90° away' },
  // Downswing -- convex downward. Note P5 sits FURTHER back than P4: the hands
  // keep drifting away from the target while the torso has already started down.
  // That is the transition float, and it is what opens the loop at the top --
  // P4 is no longer a simultaneous extremum of u and v, so the hand never stops.
  { t: 0.7317, thetaDeg: 45, u: -0.287, v: -0.21, label: 'P5 early downswing, lead arm parallel' },
  { t: 0.7767, thetaDeg: 0, u: -0.23, v: -0.332, label: 'P6 delivery, shaft parallel, square' },
  { t: 0.81, thetaDeg: -35, u: -0.131, v: -0.384, label: 'P7 impact' },
  // The handover. Both arms straight, so u must be 0.
  { t: RELEASE_T, thetaDeg: -55, u: 0.0, v: -0.354, label: 'P7.5 release, both arms straight' },
  // Follow-through -- slightly convex UPWARD, unlike the downswing.
  { t: 0.8505, thetaDeg: -72, u: 0.04, v: -0.265, label: 'P8 follow-through, shaft parallel' },
  { t: 0.8756, thetaDeg: -90, u: 0.128, v: -0.117, label: 'P9 shoulders 90° to target' },
  { t: 1.0, thetaDeg: -120, u: 0.22, v: 0.002, label: 'P10 finish, shoulders 120°' },
];


/**
 * Catmull-Rom tangent for a NON-UNIFORMLY spaced scalar track.
 *
 * The familiar `(y[i+1] - y[i-1]) / (t[i+1] - t[i-1])` is the *uniform* formula.
 * Applied to unequal knot spacing it misbehaves badly: when a keyframe juts out
 * between two neighbours that sit close to each other, the difference across it
 * is small, so the tangent collapses and the curve stalls at that keyframe and
 * then lurches away -- a near-cusp. That is exactly what the top of the backswing
 * is: P3 and P5 are 9.6 cm apart while P4 stands 12-16 cm off both of them, over
 * time spans of 0.20 and 0.08.
 *
 * The correct generalisation weights each one-sided slope by the OPPOSITE
 * interval, so the nearer neighbour dominates:
 *
 *     m = (dtNext * slopePrev + dtPrev * slopeNext) / (dtPrev + dtNext)
 *
 * It reduces to the uniform formula when the spacing is even, and it keeps the
 * hand moving through the top instead of stalling. Endpoints fall back to a
 * one-sided difference.
 *
 * `monotone` additionally applies the Fritsch-Carlson limiter, which forbids the
 * cubic from overshooting the keyframe values it passes through: the tangent goes
 * to zero at a local extremum and is capped elsewhere. That is used for the torso
 * angle and ONLY for the torso angle, because those values are pinned by the
 * P-system -- P4 IS 90 degrees of shoulder turn by definition, so interpolating
 * through 97 on the way is wrong, not merely ugly.
 *
 * The hand track deliberately does not use it. There the limiter would be
 * actively harmful: u and v both reverse at the top, so zeroing both tangents
 * would stop the hand dead and produce a far worse cusp than the one being fixed.
 * The hand path is a free curve and only needs to be smooth.
 */
function tangent(keys, i, get, monotone = false, isStraight = () => false) {
  const prev = keys[i - 1];
  const next = keys[i + 1];
  const cur = keys[i];
  // The swing starts and ends at rest: the golfer is motionless at address and
  // has stopped at the finish. A one-sided difference here would instead start
  // the torso already turning at ~140 deg/s and leave it still turning at the
  // finish, which is what made the old timing look like constant angular speed.
  if (!prev || !next) return 0;
  const dtPrev = cur.t - prev.t;
  const dtNext = next.t - cur.t;
  const slopePrev = (get(cur) - get(prev)) / dtPrev;
  const slopeNext = (get(next) - get(cur)) / dtNext;

  // A straightened segment is a line, so for the joint to stay smooth its curved
  // neighbour has to arrive along that same line. Without this the straight-line
  // rule buys a clean chord at the cost of a corner at each end of it -- which at
  // impact, the fastest part of the swing, is the more visible artefact of the
  // two. When both sides are straight the keyframe is a genuine polyline corner
  // and neither neighbour consults this tangent at all.
  const prevStraight = isStraight(i - 1);
  const nextStraight = isStraight(i);
  if (nextStraight && !prevStraight) return slopeNext;
  if (prevStraight && !nextStraight) return slopePrev;

  const m = (dtNext * slopePrev + dtPrev * slopeNext) / (dtPrev + dtNext);
  if (!monotone) return m;
  if (slopePrev * slopeNext <= 0) return 0; // local extremum: land on it exactly
  const limit = 3 * Math.min(Math.abs(slopePrev), Math.abs(slopeNext));
  return Math.sign(m) * Math.min(Math.abs(m), limit);
}

function hermite(keys, i, localT, span, get, monotone = false, isStraight = () => false) {
  const a = keys[i];
  const b = keys[i + 1];
  const m0 = tangent(keys, i, get, monotone, isStraight) * span;
  const m1 = tangent(keys, i + 1, get, monotone, isStraight) * span;
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
   * Snap P1 back to the anchored address. Called on reset only -- the anchor does
   * not depend on spine tilt, so the tilt slider leaves P1 alone. Dragging P1
   * overrides the anchor until the next reset.
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
    const straight = this.isStraightSegment(i);
    const isStraight = (index) =>
      index >= 0 && index < keys.length - 1 && this.isStraightSegment(index);
    const hand = (get) =>
      straight ? lerp(get) : hermite(keys, i, localT, span, get, false, isStraight);

    // The torso angle is pinned by the P-system, so it is interpolated without
    // overshoot; the hand track is free and is interpolated for smoothness.
    //
    // The straight-segment rule applies to the HAND ONLY. It exists to stop the
    // cubic bulging when two keyframes are close together in the (u, v) plane,
    // which is a statement about the drawn path and nothing else. Letting it also
    // straighten the angle track would make the torso turn at a constant rate for
    // the whole of that segment -- and since the takeaway is a straight segment
    // lasting 273 ms, that alone put the torso at 80 deg/s at address, when the
    // golfer is standing still. The angle is always interpolated as a curve.
    const thetaDeg = hermite(keys, i, localT, span, (k) => k.thetaDeg, true);
    return {
      theta: rad(thetaDeg),
      thetaDeg,
      u: hand((k) => k.u),
      v: hand((k) => k.v),
      constraint: constraintAt(clamped),
      blend: releaseBlendAt(clamped),
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
