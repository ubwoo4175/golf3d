/**
 * The swing path: an editable keyframe track of (torso angle, hand u, hand v)
 * against normalised swing time t in [0, 1]. The hand's perpendicular distance
 * from the rectangle is not authored -- it is solved from the arm rules, see
 * `axisDistanceFor` in arm.js.
 *
 * The torso track models Rory McIlroy's DRIVER swing, from his published GEARS
 * capture numbers: ~116 degrees of shoulder turn at the top (110 in this
 * single-axis torso) on a solved 3:1 tempo. The hand and club positions on top of
 * it are hand-tuned by dragging.
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
 * THE PATH SHAPE, in the torso frame: the takeaway rises straight up the sternum
 * line (u = 0), the backswing swings out to the trail side and over the shoulder
 * line at the top, and the downswing drops back down OUTSIDE it, a loop that
 * closes at release -- then the follow-through climbs out to the lead side.
 *
 * The reference numbers are hand-tuned on this app's own panels -- see the note
 * on REFERENCE_KEYFRAMES.
 */

import * as V from './vec3.js';
import { rad, sub, clamp } from './vec3.js';
import { TIMING, CURVE, RELEASE_BLEND_T } from './config.js';
import { naturalAddress, axisDistanceFor } from './arm.js';
import { ballPosition, torsoBasis } from './rig.js';
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
  // HAND-TUNED. Every position and club aim below was set by dragging on the two
  // panels, then transcribed: hands off the 2D panel, club aims off the club-aim
  // chart, each converted to wrist angles against that keyframe's own hand frame.
  // Times and torso angles are unchanged from the solved tempo profile; the face
  // is re-solved to be square at address and at impact.
  //
  // Address sits level with the release and impact hands -- see ADDRESS in
  // config.js -- and its wrist is re-aimed at the ball whenever the club changes.
  { t: 0, thetaDeg: 0, u: 0, v: -0.3478, cockDeg: 20.4, bowDeg: 3.1, faceDeg: 0, label: 'P1 address' },
  { t: 0.2149, thetaDeg: 25, u: 0, v: -0.317, cockDeg: 9.5, bowDeg: 17.2, faceDeg: -7.5, label: 'P1.5 takeaway' },
  // Backswing: hands straight up the sternum line, then out to the trail side.
  // P3's club was dragged to the rim of the chart -- straight UP the spine axis.
  { t: 0.3316, thetaDeg: 65, u: -0.0101, v: -0.1464, cockDeg: -8.7, bowDeg: 15.7, faceDeg: -11.6, label: 'P2 shaft parallel' },
  { t: 0.4106, thetaDeg: 90, u: -0.0585, v: -0.0374, cockDeg: 34.8, bowDeg: 80.3, faceDeg: -14.4, label: 'P3 lead arm parallel' },
  // The top, and the transition. P4 -> P5 -> P6 aim the club within 8 and 13
  // degrees of each other relative to the body, so the club-aim track runs
  // STRAIGHT between them -- see CURVE.aimStraightBelowDeg.
  { t: 0.6075, thetaDeg: 110, u: -0.2522, v: 0.0272, cockDeg: -23.3, bowDeg: 36.2, faceDeg: -21.3, label: 'P4 top, shoulders 110° away' },
  { t: 0.7317, thetaDeg: 55, u: -0.2926, v: -0.1221, cockDeg: -25.2, bowDeg: 40, faceDeg: -25.7, label: 'P5 early downswing, lead arm parallel' },
  { t: 0.783, thetaDeg: 0, u: -0.1917, v: -0.2917, cockDeg: -52.3, bowDeg: 51.8, faceDeg: -27.5, label: 'P6 delivery, shaft parallel' },
  { t: 0.81, thetaDeg: -35, u: -0.1029, v: -0.3361, cockDeg: -13.3, bowDeg: 14.5, faceDeg: -28.4, label: 'P7 impact' },
  // The handover. Both arms straight, so u must be 0.
  { t: RELEASE_T, thetaDeg: -55, u: 0, v: -0.3483, cockDeg: 18.5, bowDeg: 19.2, faceDeg: -29.2, label: 'P7.5 release, both arms straight' },
  { t: 0.853, thetaDeg: -72, u: 0.0787, v: -0.2837, cockDeg: 46.4, bowDeg: 25.8, faceDeg: -30, label: 'P8 follow-through, shaft parallel' },
  { t: 0.892, thetaDeg: -94, u: 0.1756, v: -0.1666, cockDeg: 60.7, bowDeg: 40.9, faceDeg: -31.3, label: 'P9 shoulders 90° to target' },
  { t: 1, thetaDeg: -120, u: 0.281, v: 0.046, cockDeg: 42.6, bowDeg: 82.5, faceDeg: -35.1, label: 'P10 finish, shoulders 120°' },
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
/**
 * Log map on the unit sphere: the tangent vector at `a` that points toward `b`,
 * with length equal to the angle between them (radians). The inverse of
 * `expMap`. Undefined only at the exact antipode, which two neighbouring
 * keyframes of a swing never are.
 */
function logMap(a, b) {
  const c = clamp(V.dot(a, b), -1, 1);
  const angle = Math.acos(c);
  const perp = V.sub(b, V.scale(a, c));
  const len = V.length(perp);
  if (len < 1e-12) return { x: 0, y: 0, z: 0 };
  return V.scale(perp, angle / len);
}

/** Exp map: walk from `a` along tangent vector `t` (radians) on the sphere. */
function expMap(a, t) {
  const angle = V.length(t);
  if (angle < 1e-12) return a;
  const dir = V.scale(t, 1 / angle);
  return V.normalize(
    V.addScaled(V.scale(a, Math.cos(angle)), dir, Math.sin(angle)),
  );
}

/** Parallel-transport tangent `t` from the tangent plane at `a` to `b`. */
function transportTangent(a, b, t) {
  const axis = V.cross(a, b);
  const sin = V.length(axis);
  if (sin < 1e-12) return t;
  const angle = Math.atan2(sin, V.dot(a, b));
  return V.rotateAbout(t, V.scale(axis, 1 / sin), angle);
}

/**
 * The club-aim panel's chart: a shaft direction in torso components (side, up,
 * fwd) to the exponential map about straight DOWN the spine axis -- radius is the
 * angle from straight down in degrees, bearing is round the body. A straight
 * line in (a, b) is a straight line on the panel.
 */
function torsoToChart(s, u, f) {
  const phi = V.deg(Math.acos(clamp(-u, -1, 1)));
  const flat = Math.hypot(s, f);
  if (flat < 1e-9) return { a: 0, b: 0 };
  return { a: (phi * s) / flat, b: (phi * f) / flat };
}

/** Inverse of `torsoToChart`, straight to a world direction in `basis`. */
function chartToWorld(c, basis) {
  const phi = Math.hypot(c.a, c.b);
  const p = rad(phi);
  let d = V.scale(basis.up, -Math.cos(p));
  if (phi > 1e-9) {
    d = V.addScaled(d, basis.side, (c.a / phi) * Math.sin(p));
    d = V.addScaled(d, basis.fwd, (c.b / phi) * Math.sin(p));
  }
  return V.normalize(d);
}

/** Geodesic interpolation between two unit vectors. */
function slerpDir(a, b, s) {
  return expMap(a, V.scale(logMap(a, b), s));
}

/**
 * One cubic segment on the sphere, as a Bezier evaluated by slerp
 * De Casteljau -- the standard spherical analogue of a Hermite segment.
 *
 * The inner control points sit a third of the endpoint tangents away from
 * their endpoints, which is the exact cubic-Bezier form of a Hermite segment
 * in the plane; on the sphere it inherits the same endpoint positions and
 * endpoint velocities, which is all C1 continuity needs. The exp maps only
 * ever carry the short control offsets (a third of a tangent), never the whole
 * span, so there is no long-chart distortion even across a 120-degree segment.
 */
function sphereCubic(d0, d1, t0, t1, s, span) {
  const b1 = expMap(d0, V.scale(t0, span / 3));
  const b2 = expMap(d1, V.scale(t1, -span / 3));
  const p01 = slerpDir(d0, b1, s);
  const p12 = slerpDir(b1, b2, s);
  const p23 = slerpDir(b2, d1, s);
  const q0 = slerpDir(p01, p12, s);
  const q1 = slerpDir(p12, p23, s);
  return slerpDir(q0, q1, s);
}

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
   * Replace the keyframes wholesale -- an import, or a restored autosave --
   * WITHOUT re-anchoring P1. Only the channels a keyframe stores are taken, and
   * the list must match the reference one keyframe for keyframe, so a stale or
   * foreign file is refused rather than half-applied.
   */
  load(keyframes) {
    if (!Array.isArray(keyframes) || keyframes.length !== REFERENCE_KEYFRAMES.length) {
      throw new Error(`expected ${REFERENCE_KEYFRAMES.length} keyframes`);
    }
    const num = (x) => typeof x === 'number' && Number.isFinite(x);
    this.keys = REFERENCE_KEYFRAMES.map((ref, i) => {
      const k = keyframes[i];
      for (const f of ['t', 'thetaDeg', 'u', 'v', 'cockDeg', 'bowDeg', 'faceDeg']) {
        if (!num(k?.[f])) throw new Error(`keyframe ${i}: bad ${f}`);
      }
      return { ...ref, t: k.t, thetaDeg: k.thetaDeg, u: k.u, v: k.v,
        cockDeg: k.cockDeg, bowDeg: k.bowDeg, faceDeg: k.faceDeg };
    });
    this.emit();
  }

  /** The stored channels of every keyframe, as plain data -- what `load` takes. */
  snapshot() {
    const r = (x) => Math.round(x * 1e4) / 1e4;
    return this.keys.map((k) => ({
      label: k.label, t: r(k.t), thetaDeg: r(k.thetaDeg), u: r(k.u), v: r(k.v),
      cockDeg: r(k.cockDeg), bowDeg: r(k.bowDeg), faceDeg: r(k.faceDeg),
    }));
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
   * The club-aim track: each keyframe's shaft direction as a WORLD unit vector,
   * plus a tangent for the spherical spline that interpolates between them.
   *
   * This is the third frame the club has been interpolated in, and the
   * reasoning is a story of two failures:
   *
   *   - WRIST coordinates: (cock, bow) are joint angles against a forearm that
   *     itself sweeps a huge arc, so smooth wrist curves composed into a world
   *     shaft direction that waved across the swing plane fifteen times.
   *   - An EXPONENTIAL CHART (torso-fixed, then world-fixed): better, but any
   *     single chart of the sphere distorts somewhere, and the swing covers
   *     260+ degrees of direction space -- there is nowhere safe to put the
   *     pole. The world chart's pole sat 40 degrees from the impact aim, where
   *     the map compresses bearing motion three-to-one, and the shaft's
   *     angular speed collapsed from 3000 deg/s to 850 exactly at impact.
   *
   * So the spline now lives ON THE SPHERE itself: geodesic (slerp-style)
   * Hermite segments, with Bessel tangents built from log-maps at each knot
   * and parallel-transported between knots. No frame, no pole, no distortion
   * anywhere -- what is smooth and evenly-paced here is smooth and evenly-
   * paced on screen, which is the thing the whole app is judged by.
   *
   * Keyframes still STORE (cock, bow) -- the club-aim panel drags them, and
   * the address solver writes them -- so this track is derived, cached against
   * the revision counter, and reproduces every stored keyframe exactly at its
   * knot. Handedness needs no special case: a lefty's stored wrist yields
   * mirrored world directions, and the spline of mirrored knots is the
   * mirrored spline.
   */
  aimTrack() {
    if (this.aimRev === this.revision && this.aims) return this.aims;
    this.aimRev = this.revision;
    const charts = [];
    const torsoDirs = [];
    const dirs = this.keys.map((k) => {
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
      const t = {
        s: V.dot(d, pose.basis.side),
        u: V.dot(d, pose.basis.up),
        f: V.dot(d, pose.basis.fwd),
      };
      torsoDirs.push(t);
      charts.push(torsoToChart(t.s, t.u, t.f));
      return d;
    });
    // Segments whose two knots aim the club within `aimStraightBelowDeg` of each
    // other IN THE TORSO FRAME are drawn straight on the club-aim panel instead
    // of curved. See CURVE in config.js.
    const straight = charts.slice(0, -1).map((_, i) => {
      const a = torsoDirs[i];
      const b = torsoDirs[i + 1];
      const cos = clamp(a.s * b.s + a.u * b.u + a.f * b.f, -1, 1);
      return V.deg(Math.acos(cos)) < CURVE.aimStraightBelowDeg;
    });
    this.aims = { dirs, charts, straight };
    // Knot tangents: Bessel-weighted average of the one-sided geodesic slopes,
    // expressed in each knot's own tangent plane. Zero at the ends -- the
    // golfer is at rest at address and at the finish.
    const tangents = dirs.map((d, i) => {
      if (i === 0 || i === dirs.length - 1) return { x: 0, y: 0, z: 0 };
      // A curved segment meeting a straight one has to arrive at the straight
      // one's own velocity, or the straight segment buys a clean line at the
      // price of a kink at each end of it. The straight segment's velocity is
      // measured, not derived: it is chart-linear motion carried round by the
      // turning torso, and a finite difference captures both at once.
      const inStraight = straight[i - 1];
      const outStraight = straight[i];
      if (inStraight !== outStraight) {
        const seg = outStraight ? i : i - 1;
        const k0 = this.keys[seg];
        const k1 = this.keys[seg + 1];
        const h = 1e-4;
        const tAt = outStraight ? k0.t + h : k1.t - h;
        const s = (tAt - k0.t) / (k1.t - k0.t);
        const other = this.straightAim(seg, s, this.thetaAt(tAt));
        const l = logMap(d, other);
        return V.scale(l, (outStraight ? 1 : -1) / h);
      }
      const dtPrev = this.keys[i].t - this.keys[i - 1].t;
      const dtNext = this.keys[i + 1].t - this.keys[i].t;
      const toPrev = logMap(d, dirs[i - 1]);
      const toNext = logMap(d, dirs[i + 1]);
      const w = 1 / (dtPrev + dtNext);
      return {
        x: (dtNext * (-toPrev.x / dtPrev) + dtPrev * (toNext.x / dtNext)) * w,
        y: (dtNext * (-toPrev.y / dtPrev) + dtPrev * (toNext.y / dtNext)) * w,
        z: (dtNext * (-toPrev.z / dtPrev) + dtPrev * (toNext.z / dtNext)) * w,
      };
    });
    this.aims.tangents = tangents;
    return this.aims;
  }

  /** The chart-linear club aim along straight segment `i`, in world space. */
  straightAim(i, s, thetaDeg) {
    const { charts } = this.aims;
    const c = {
      a: charts[i].a + (charts[i + 1].a - charts[i].a) * s,
      b: charts[i].b + (charts[i + 1].b - charts[i].b) * s,
    };
    return chartToWorld(c, torsoBasis(rad(thetaDeg)));
  }

  /** Interpolated torso angle at time t, degrees. Same curve as `sample`. */
  thetaAt(t) {
    const keys = this.keys;
    const clamped = Math.min(Math.max(t, keys[0].t), keys[keys.length - 1].t);
    let i = 0;
    while (i < keys.length - 2 && keys[i + 1].t < clamped) i += 1;
    const span = keys[i + 1].t - keys[i].t || 1e-6;
    return hermite(keys, i, (clamped - keys[i].t) / span, span, (k) => k.thetaDeg, true);
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
     * The club's aim: the spherical spline through the keyframe directions.
     * See `aimTrack` for why it is neither wrist coordinates nor a chart.
     *
     * `faceDeg` is a plain free curve: it is monotone across the whole swing,
     * so there is nothing for a limiter to catch.
     */
    const { dirs, tangents, straight: aimStraight } = this.aimTrack();
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
      /** World shaft direction; `solvePose` turns it back into wrist angles. */
      aim: aimStraight[i]
        ? this.straightAim(i, localT, thetaDeg)
        : sphereCubic(dirs[i], dirs[i + 1], tangents[i], tangents[i + 1], localT, span),
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
