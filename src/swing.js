/**
 * The swing path: an editable keyframe track of (torso angle, hand u, hand v)
 * against normalised swing time t in [0, 1]. The hand's perpendicular distance
 * from the rectangle is not authored -- it is solved from the arm rules, see
 * `axisDistanceFor` in arm.js.
 *
 * The reference values model Rory McIlroy's DRIVER swing, from his published
 * GEARS capture numbers: ~116 degrees of shoulder turn at the top (110 in this
 * single-axis torso), a late wrist set, a transition where the shaft lays back
 * as the hands drop, and a peak clubhead speed that lands on his measured
 * 122 mph. They are authored from published measurements and checkpoints, not
 * motion capture, so treat them as a well-shaped starting point you tune by
 * dragging.
 *
 * THE ARM RULES
 *   t <= RELEASE_T   the lead arm is straight (all folding is at the trail elbow)
 *   t >= RELEASE_T   the trail arm is straight (the lead elbow folds)
 *   t == RELEASE_T   both are straight, which forces u = 0 there
 *
 * Impact is NOT where the trail arm straightens -- it is still extending through
 * impact and only reaches full length at release.
 *
 * THE CLUB. Checkpoints the P-system names as parallel to the target line (P2,
 * P6, P8) are authored ON PLANE; the top and the transition carry a deliberate
 * lay-off/lay-back z component, because that is the shallowing move -- see the
 * keyframe notes. Every direction is authored in WORLD space and back-solved to
 * wrist angles; nothing here is a hand-picked (cock, bow) pair.
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

import { rad, deg, sub, dot, clamp } from './vec3.js';
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
 * The P-system, with shoulder rotation synced to Rory's driver capture.
 *
 * Fields: t, torso angle (deg, + = turned away from target), hand u, hand v.
 *
 * SHOULDER ROTATION. GEARS puts Rory's driver turn at ~116 degrees of shoulders
 * over ~42 of hips; this torso is a single rigid rotation, so it carries 110 --
 * between the two, weighted to the shoulder line the model actually pins. P3 is
 * at 90 (his lead-arm-parallel point), impact is -35 open, the finish -120.
 *
 * TIMING. The P times are NOT authored -- they are solved from a torso
 * angular-velocity profile, because the angles alone say nothing about how fast
 * the torso passes through them. The profile has three rest points (address, the
 * top, the finish) joined by smooth ramps, with the downswing peak 40 ms before
 * impact, as the thorax leads the club in the kinematic sequence:
 *
 *     backswing   w = A sin^2(pi t / T_back)        peak  293 deg/s
 *     post-top    ramp up to the peak, then down     peak measured ~1100 deg/s
 *
 * Constraints: +110 at the top, -35 at impact, -120 at the finish, impact on
 * the 3:1 mark, 1.235 s total. The backswing keyframe times below (0.2149,
 * 0.3316, 0.4106) are the inverse of that sin^2 profile at 25, 65 and 90
 * degrees.
 *
 * HAND PATH. u is <= 0 up to release and >= 0 after, hitting exactly 0 at
 * release. That is not a stylistic choice -- `freeArmULimit` shows the rules
 * permit nothing else, because the free arm would have to be longer than it is.
 */
export const REFERENCE_KEYFRAMES = [
  // Takeaway -- u holds at 0, so the hand rises on a straight vertical line and
  // both arms stay equally straight through it: a one-piece takeaway. The club
  // is aimed at a POINT on the ground, 70 cm back down the target line, rather
  // than at an elevation: address and takeaway are far apart in bearing around
  // the forearm, and aiming an elevation let the interpolated hinge dip the
  // head under the turf on the way.
  { t: 0, thetaDeg: 0, u: 0.0, v: -0.4668, cockDeg: 19.9, bowDeg: 24.5, faceDeg: 0, label: 'P1 address' },
  { t: 0.2149, thetaDeg: 25, u: 0.0, v: -0.3651, cockDeg: 17.7, bowDeg: 16.3, faceDeg: -3.3, label: 'P1.5 takeaway' },
  // Backswing. Rory sets the club LATE for the driver: barely 23 degrees of
  // hinge at P2, the full set only arriving with P3. The times are solved from
  // the sin^2 rate profile -- see the tempo notes -- so the torso rests at
  // address and accelerates smoothly through the turn.
  { t: 0.3316, thetaDeg: 65, u: -0.0658, v: -0.23, cockDeg: 3.1, bowDeg: 22.5, faceDeg: -5.2, label: 'P2 shaft parallel' },
  { t: 0.4106, thetaDeg: 90, u: -0.1273, v: -0.1393, cockDeg: 14.7, bowDeg: 76.6, faceDeg: -6.4, label: 'P3 lead arm parallel' },
  // The top. GEARS measures Rory's driver shoulder turn at ~116 degrees; the
  // single-axis torso here carries 110 of it. The shaft is just SHORT OF
  // PARALLEL, pointing at the target with 12 degrees of elevation and a touch
  // of lay-off. The clubhead's own apex comes ~50 ms later, between here and
  // P5 -- the crossover loop -- because the wrists keep deepening while the
  // hands have already turned back down.
  { t: 0.6075, thetaDeg: 110, u: -0.2025, v: -0.0285, cockDeg: -80.9, bowDeg: 78.9, faceDeg: -9.4, label: 'P4 top, shoulders 110° away' },
  // Transition. The shaft LAYS BACK as the hands drop -- the z component is the
  // shallowing move, the club falling to a flatter plane behind the hands --
  // and the hinge deepens to 139 degrees, dynamic lag beyond the top's 113.
  // On-plane targets here (z = 0) read as over-the-top: the head swept out
  // toward the ball line while still high, which no tour swing does.
  { t: 0.7317, thetaDeg: 55, u: -0.1665, v: -0.1875, cockDeg: -93.1, bowDeg: 102.8, faceDeg: -11.4, label: 'P5 early downswing, lead arm parallel' },
  // Delivery: shaft parallel to the ground again, still tipped 7 degrees
  // inside; the head approaches the ball from behind the hands.
  { t: 0.7767, thetaDeg: 5, u: -0.0788, v: -0.3578, cockDeg: -63.2, bowDeg: 29.8, faceDeg: -12.1, label: 'P6 delivery, shaft parallel' },
  { t: 0.81, thetaDeg: -35, u: -0.045, v: -0.3812, cockDeg: -16.6, bowDeg: 6.6, faceDeg: -12.6, label: 'P7 impact' },
  // The handover. Both arms straight, so u must be 0.
  { t: RELEASE_T, thetaDeg: -55, u: 0.0, v: -0.4009, cockDeg: 18.7, bowDeg: -15.5, faceDeg: -12.9, label: 'P7.5 release, both arms straight' },
  // Follow-through -- the mirror checkpoints of the backswing.
  { t: 0.853, thetaDeg: -72, u: 0.0219, v: -0.322, cockDeg: 29, bowDeg: 17.5, faceDeg: -13.3, label: 'P8 follow-through, shaft parallel' },
  { t: 0.892, thetaDeg: -94, u: 0.0618, v: -0.2624, cockDeg: 7.2, bowDeg: 75.7, faceDeg: -13.9, label: 'P9 shoulders 90° to target' },
  // The finish folds the club right back over the shoulder: 171 degrees of
  // hinge away from the forearm. The torso-frame chart holds the whole sphere,
  // so nothing caps it.
  { t: 1, thetaDeg: -120, u: 0.1912, v: -0.0014, cockDeg: 71.2, bowDeg: 155.5, faceDeg: -15.5, label: 'P10 finish, shoulders 120°' },
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

  /**
   * The club-aim track: each keyframe's shaft direction as a point on the
   * TORSO-FRAME direction chart -- the same chart the club-aim panel draws.
   *
   *   phi      angle away from straight down the spine axis, degrees
   *   bearing  which way round the body, from `side` toward `fwd`
   *   (a, b) = phi * (cos bearing, sin bearing)     the exponential map
   *
   * This exists because of what happened when the club was interpolated in
   * WRIST coordinates instead. (cock, bow) are joint angles against the lead
   * forearm, and the forearm itself swings through a huge arc -- so a shaft
   * direction that moves smoothly through the world is a wildly oscillating
   * curve in wrist space, and vice versa: smooth wrist curves composed with the
   * swinging forearm made the world shaft direction WAVE ACROSS THE SWING PLANE
   * fifteen times in one swing. Every keyframe was authored on plane; all the
   * waving happened between them. Interpolating on this chart instead makes the
   * club's motion smooth in the torso frame by construction, and the world
   * motion is that composed with the (smooth, monotone) torso rotation.
   *
   * The chart is non-singular everywhere except straight UP the spine axis
   * (phi = 180), which no part of the swing approaches within 25 degrees.
   * Keyframes still STORE (cock, bow) -- the club-aim panel drags them, and the
   * address solver writes them -- so this track is derived, cached against the
   * revision counter, and reproduces every stored keyframe exactly at its knot.
   */
  aimChart() {
    if (this.chartRev === this.revision && this.chart) return this.chart;
    this.chartRev = this.revision;
    this.chart = this.keys.map((k) => {
      // The keyframe's own pose, from stored values alone -- no interpolation,
      // so this cannot recurse back into sample().
      const pose = solvePose({
        theta: rad(k.thetaDeg),
        u: k.u,
        v: k.v,
        constraint: constraintAt(k.t),
        blend: releaseBlendAt(k.t),
        wrist: k,
      });
      const d = pose.club.shaftDir;
      const s = dot(d, pose.basis.side);
      const up = dot(d, pose.basis.up);
      const f = dot(d, pose.basis.fwd);
      const phi = deg(Math.acos(clamp(-up, -1, 1)));
      const flat = Math.hypot(s, f);
      if (flat < 1e-9) return { a: 0, b: 0 };
      return { a: (phi * s) / flat, b: (phi * f) / flat };
    });
    return this.chart;
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
     * The club's aim, interpolated on the torso-frame chart -- see `aimChart`
     * for why NOT in wrist coordinates. FREE curves, deliberately: the chart
     * path never doubles back on itself -- the club sweeps continuously round
     * the body -- so per-channel extrema are places where the path is CURVING,
     * not turning, and the Fritsch-Carlson limiter's zero-tangent rule is
     * exactly wrong there. Applied here it froze the club dead for ~30 ms at
     * P9, where both channels happen to peak together: a visible hitch in the
     * follow-through, with the clubhead momentarily at 9 m/s between two
     * 40 m/s neighbours. (The overshoot the limiter would guard against was
     * real once, but it was the transition targets' fault -- authored on plane
     * when the real move lays the shaft back INSIDE the plane -- and fixing
     * the targets removed it; see the P5 keyframe note.)
     *
     * `faceDeg` is a plain free curve too: it is monotone across the whole
     * swing, so there is nothing for a limiter to catch.
     */
    const chart = this.aimChart();
    const curve = (get) => hermite(keys, i, localT, span, get, false);
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
      /** Torso-chart club aim; `solvePose` turns it back into wrist angles. */
      aim: {
        a: curve((k) => chart[keys.indexOf(k)].a),
        b: curve((k) => chart[keys.indexOf(k)].b),
      },
      wrist: {
        faceDeg: curve((k) => k.faceDeg),
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
