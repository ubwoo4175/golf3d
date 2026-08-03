/**
 * The swing path: an editable keyframe track of (torso angle, hand u, hand v)
 * against normalised swing time t in [0, 1]. The hand's perpendicular distance
 * from the rectangle is not authored -- it is solved from the arm rules, see
 * `axisDistanceFor` in arm.js.
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
 * THE CLUB. Every shaft direction the P-system names as parallel to the target line
 * is authored ON PLANE, with no sideways component. Authoring those with a
 * sideways lean of 0.15 to 0.41 was what had the club wandering across itself at
 * the top.
 *
 * THE PATH SHAPE is a narrow V in the torso frame, which is what a hand path
 * really looks like once the body's own rotation is taken out of it:
 *
 *   takeaway         a straight vertical line: u holds at 0 while v rises
 *   backswing        up and across to the trail side, reaching its extreme in
 *                    BOTH u and v at the top, where the hand turns
 *   downswing        back down inside the backswing, and much straighter: from
 *                    delivery to release it is very nearly a line
 *   follow-through   out to the lead side and up, the mirror of the backswing but
 *                    shallower, finishing level with the lead shoulder
 *
 * The reference numbers come from a hand-tuned pass over this app's own 2D panel
 * rather than from a solver, and the wrist track is then SOLVED against them --
 * every shaft direction below is a checkpoint aimed in world space and converted,
 * not a hand-picked pair of angles. See the club section of the README.
 */

import { rad, sub } from './vec3.js';
import { TIMING, CURVE, RELEASE_BLEND_T } from './config.js';
import { naturalAddress, axisDistanceFor } from './arm.js';
import { ballPosition } from './rig.js';
import { wristForDirection } from './club.js';
import { solvePose } from './pose.js';

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
  // both arms stay equally straight through it: a one-piece takeaway. The line is
  // exact and needs no special case: u is flat on both sides of P1.5, so the
  // overshoot limiter takes the tangent there to zero and the cubic for u is
  // identically zero across the whole segment.
  //
  // The club is not aimed at an ELEVATION here but at a point on the ground, 65 cm
  // back down the target line. Aiming an elevation drove the head 5 cm under the
  // turf halfway to P1.5: address and takeaway are 125 degrees apart in bearing
  // around the forearm, and the short way round dips the hinge in between.
  { t: 0.0, thetaDeg: 0, u: 0.0, v: -0.4668, cockDeg: 19.9, bowDeg: 24.5, faceDeg: 0.0, label: 'P1 address' },
  { t: 0.2213, thetaDeg: 22, u: 0.0, v: -0.3651, cockDeg: 15.6, bowDeg: 17.8, faceDeg: -3.4, label: 'P1.5 takeaway' },
  // Backswing -- up and across, with the club setting from parallel to the ground
  // at P2 to 58 degrees above it at P3.
  { t: 0.2868, thetaDeg: 40, u: -0.0658, v: -0.23, cockDeg: -21.7, bowDeg: 28.4, faceDeg: -4.5, label: 'P2 shaft parallel' },
  { t: 0.3556, thetaDeg: 60, u: -0.1273, v: -0.1393, cockDeg: 6.2, bowDeg: 71.3, faceDeg: -5.5, label: 'P3 lead arm parallel' },
  // The top. The hands reach their extreme in BOTH u and v here -- the point of
  // the V in the 2D panel. u lands on it exactly, because u is overshoot-limited;
  // v floats 2.1 cm past and comes back, which is the transition float and is what
  // keeps the hand from stopping dead as it turns.
  //
  // The club is SHORT OF PARALLEL and ON PLANE: 45 degrees above horizontal,
  // pointing away from the target, with no sideways component. Not vertical -- an
  // earlier version solved the top to keep the clubhead rising, which stood the
  // club on end and left it pointing at the sky.
  //
  // The clubhead's own high point is at t = 0.47, before the top rather than at
  // it, because the shaft is already flattening (58 degrees at P3, 45 here, 25 at
  // P5) faster than the hands are still rising. That is the shallowing move, and
  // it is what keeps the head's trace a single arc instead of the loop it used to
  // draw here.
  { t: 0.6075, thetaDeg: 90, u: -0.2025, v: -0.0285, cockDeg: 34.1, bowDeg: 27.4, faceDeg: -9.4, label: 'P4 top, shoulders 90° away' },
  // Downswing -- inside the backswing, and much straighter than it: P5, P6, P7 and
  // release are very nearly collinear in the (u, v) plane.
  { t: 0.7317, thetaDeg: 45, u: -0.1665, v: -0.1875, cockDeg: -0.9, bowDeg: 47.4, faceDeg: -11.4, label: 'P5 early downswing, lead arm parallel' },
  { t: 0.7767, thetaDeg: 0, u: -0.0788, v: -0.3578, cockDeg: -61.8, bowDeg: 33.7, faceDeg: -12.1, label: 'P6 delivery, shaft parallel, square' },
  { t: 0.81, thetaDeg: -35, u: -0.045, v: -0.3812, cockDeg: -16.6, bowDeg: 6.6, faceDeg: -12.6, label: 'P7 impact' },
  // The handover. Both arms straight, so u must be 0.
  { t: RELEASE_T, thetaDeg: -55, u: 0.0, v: -0.4009, cockDeg: 18.7, bowDeg: -15.5, faceDeg: -12.9, label: 'P7.5 release, both arms straight' },
  // Follow-through -- out to the lead side and up, shallower than the backswing.
  { t: 0.8505, thetaDeg: -72, u: 0.0219, v: -0.322, cockDeg: 28.8, bowDeg: 17.8, faceDeg: -13.2, label: 'P8 follow-through, shaft parallel' },
  { t: 0.8756, thetaDeg: -90, u: 0.0618, v: -0.2624, cockDeg: 10.2, bowDeg: 67.5, faceDeg: -13.6, label: 'P9 shoulders 90° to target' },
  // The finish folds the club right back over the shoulder: 171 degrees of hinge
  // away from the forearm. It used to be capped at 82, because the old wrist chart
  // was a hemisphere and could not show more; the torso-frame chart holds the
  // whole sphere, so the cap is gone and the finish is the real one.
  { t: 1.0, thetaDeg: -120, u: 0.1912, v: -0.0014, cockDeg: 71.2, bowDeg: 155.5, faceDeg: -15.5, label: 'P10 finish, shoulders 120°' },
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
 * to zero at a local extremum and is capped elsewhere.
 *
 * It is applied to the torso angle and to the hand's `u`, and NOT to `v`. That
 * split is not taste, it is what each coordinate means:
 *
 *   thetaDeg  pinned by the P-system. P4 IS 90 degrees of shoulder turn by
 *             definition, so interpolating through 97 on the way is wrong, not
 *             merely ugly.
 *   u         BOUNDED by the arm rules. `freeArmULimit` shows the free arm runs
 *             out of length a few millimetres either side of the sternum, so an
 *             overshoot in u is not a cosmetic bulge -- it is a pose the arms
 *             cannot make. Unlimited, the takeaway (u flat at 0 on both sides,
 *             then a hard turn at P2) bulged 2.5 cm to the lead side and broke
 *             that limit on 681 of 4000 samples. Limited, u is exactly 0 across
 *             the takeaway and the count is zero.
 *   v         FREE, and it has to stay free. u and v both turn at the top, so
 *             limiting v as well would zero both tangents at P4 and stop the hand
 *             dead: the world path's largest velocity-direction step goes from
 *             1.2 degrees to 170, a genuine cusp with a zero-radius corner. Left
 *             free, v floats 2.1 cm past the top and comes back -- which is the
 *             transition float, and is what a real hand path does.
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
    // Fill in every channel so a partial keyframe list -- one written before the
    // club existed, say -- interpolates as a neutral wrist rather than as NaN.
    this.keys = keyframes.map((k) => ({ cockDeg: 0, bowDeg: 0, faceDeg: 0, ...k }));
    this.applyNaturalAddress();
    this.emit();
  }

  /**
   * Snap P1 back to the anchored address.
   *
   * P1 only -- nothing else moves. The anchor is the same (u, v) for every club,
   * so in practice this is a no-op except after a drag or a reset. An earlier
   * version re-hung the arms plumb per club and had to translate the whole path
   * to follow; holding the anchor fixed removes the need entirely.
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

  /**
   * Aim the address club at the ball.
   *
   * The address HAND is anchored and never moves, but the address WRIST still
   * has to be re-derived per club: the torso frame rotates underneath it, so the
   * same (cock, bow) aims the shaft somewhere new, and the ball has moved as
   * well. Holding the numbers fixed left the clubhead well off the ball at the
   * ends of the range.
   */
  applyAddressClub() {
    const pose = this.poseAt(this.keys[0].t);
    const aim = sub(ballPosition(), pose.hand);
    Object.assign(this.keys[0], wristForDirection(pose.handFrame, aim));
  }

  onChange(fn) {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  emit() {
    this.cache = null;
    // Bumped on every change so views that cache derived geometry can tell
    // cheaply whether they need to rebuild it.
    this.revision = (this.revision ?? 0) + 1;
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

  /**
   * Set one keyframe's wrist channels. Accepts a partial patch, so the wrist view
   * can drag the shaft direction without disturbing the face roll and vice versa.
   */
  setKeyframeWrist(index, patch) {
    const key = this.keys[index];
    if (!key) return;
    const changed = Object.entries(patch).some(([k, value]) => key[k] !== value);
    if (!changed) return;
    Object.assign(key, patch);
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

    /**
     * The wrist channels. `cockDeg` and `bowDeg` are overshoot-limited for the
     * same reason `u` is, one level further out: an overshoot in the wrist is a
     * wobble of the SHAFT, and the clubhead sits a metre from the hand, so a few
     * degrees of it draws a large curl in the head's trace. `bowDeg` turns at the
     * top (71 -> 27 -> 47), and unlimited the cubic dipped several degrees below
     * that 27 and came back: measured over the top, the head's trace turned
     * through 527 degrees -- more than a full circle, which is exactly the extra
     * loop it looked like -- against 345 with the limiter.
     *
     * `faceDeg` is left free. It is monotone across the whole swing, so there is
     * nothing for a limiter to catch, and the roll should not be made to pause at
     * a keyframe.
     */
    const curve = (name) =>
      hermite(keys, i, localT, span, (k) => k[name], name !== 'faceDeg');
    /**
     * The hand track. `u` is overshoot-limited and `v` is not -- see `tangent` --
     * and this is the only track the straight-segment rule applies to. Letting
     * that rule also straighten the angle track would make the torso turn at a
     * constant rate for the whole of that segment, and since the takeaway is a
     * straight segment lasting 273 ms, that alone put the torso at 80 deg/s at
     * address, with the golfer standing still.
     */
    const hand = (name) =>
      straight
        ? lerp((k) => k[name])
        : hermite(keys, i, localT, span, (k) => k[name], name === 'u', isStraight);

    // The torso angle is pinned by the P-system, so it is interpolated without
    // overshoot; the wrist channels are free curves.
    const thetaDeg = hermite(keys, i, localT, span, (k) => k.thetaDeg, true);
    return {
      theta: rad(thetaDeg),
      thetaDeg,
      u: hand('u'),
      v: hand('v'),
      constraint: constraintAt(clamped),
      blend: releaseBlendAt(clamped),
      wrist: {
        cockDeg: curve('cockDeg'),
        bowDeg: curve('bowDeg'),
        faceDeg: curve('faceDeg'),
      },
    };
  }

  poseAt(t) {
    return solvePose(this.sample(t));
  }

  /**
   * Densely sampled path, cached until a keyframe moves or handedness changes.
   * `local` is the (u, v) trace on the rectangle, `world` the true 3D hand trace
   * -- which is no longer planar, since the solved perpendicular distance varies
   * -- and `head` the clubhead's trace.
   */
  sampledPath() {
    if (this.cache) return this.cache;
    const n = TIMING.pathSamples;
    const local = [];
    const world = [];
    const head = [];
    for (let i = 0; i < n; i += 1) {
      const t = i / (n - 1);
      const d = this.sample(t);
      const pose = solvePose(d);
      const phase = phaseAt(t).id;
      local.push({ t, u: d.u, v: d.v, phase });
      world.push({ t, p: pose.hand, phase });
      head.push({ t, p: pose.club.head, phase });
    }
    this.cache = { local, world, head };
    return this.cache;
  }
}
