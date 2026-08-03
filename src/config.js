/**
 * Every tunable number lives here.
 *
 * WORLD CONVENTIONS
 *   +Y   up, ground plane at y = 0
 *   +X   target direction (ball flies toward +X)
 *   +X   also the golfer's LEAD side -- the lead side always faces the target,
 *        whichever hand they play with, so this holds for both handednesses
 *   fwd  the chest normal, +Z for a right-handed golfer and -Z for a left-handed
 *        one. The ball sits on the fwd side.
 *
 * Handedness is therefore a mirror in Z: a righty and a lefty hitting the same
 * target stand on opposite sides of the ball facing opposite ways. `lead` and
 * `trail` are roles, not sides -- lead is the left arm for a righty, the right
 * arm for a lefty.
 *
 * All lengths are metres, all angles in the config are degrees.
 */

/** 'right' | 'left'. Which hand the golfer plays with. */
export const DEFAULT_HANDEDNESS = 'right';

/**
 * Skeleton dimensions.
 *
 * Scaled to Rory McIlroy's published standing height of 1.75 m using Winter's
 * anthropometric segment fractions -- his height is public, his segment lengths
 * are not, so the ratios do the rest. Every length below is that fraction times
 * 1.75 m, and the two adjustments are noted where they occur.
 *
 *   acromion height     0.818 H     upper arm          0.186 H
 *   trochanter height   0.530 H     forearm            0.146 H
 *   knee height         0.285 H     hand length        0.108 H
 *   biacromial breadth  0.259 H     hip breadth        0.191 H
 *
 * The previous numbers were sized for a ~1.85 m player, which is 10 cm taller
 * than Rory. That mattered: it is what put REACH at 0.670 m instead of 0.641 m.
 */
export const BODY = {
  // Base of the spine axis: the fixed pivot the torso rotates about. Greater
  // trochanter height, 0.530 H.
  hipPivotHeight: 0.928,
  // Hip pivot to shoulder centre along the spine: acromion minus trochanter.
  torsoLength: 0.504,
  // Distance between the two SHOULDER JOINTS, which is biacromial breadth less
  // the acromion-to-glenohumeral inset (0.035 m each side), not the breadth.
  shoulderWidth: 0.383,
  upperArm: 0.326,
  // Elbow to grip centre, i.e. the second IK link: forearm (0.146 H) plus the
  // 0.060 m from the wrist to the middle of the palm on the grip.
  forearm: 0.316,

  // Static posture. The legs and the spine tilt never change during the swing;
  // only the rotation about the spine axis does. The forward tilt is set by the
  // club selector -- see CLUBS -- rather than authored here.
  spineTiltForwardDeg: 34, // bend from vertical; replaced on club select
  spineTiltLateralDeg: 8, // lean away from the target, lead shoulder rides high

  // Cosmetic / static scaffolding for the 3D view.
  pelvisWidth: 0.334,
  footSpread: 0.34,
  // Knee height and how far it sits toward the ball. Purely visual -- the legs
  // never move, this just stops them reading as stilts. Forward distances are
  // magnitudes along fwd; the view multiplies them by the handedness sign.
  kneeHeight: 0.499,
  kneeForward: 0.1,
  neckLength: 0.10,
  headRadius: 0.114,
};

export const REACH = BODY.upperArm + BODY.forearm;

/**
 * How extended a "straight" arm is held. Not 1.0 for three reasons: a real locked
 * arm keeps a few degrees of flex; exactly 1.0 would sit on the reach boundary
 * where the IK flags an overextension; and the release blend momentarily pushes
 * one arm ~3 mm past its target, which needs headroom underneath REACH or the
 * safety cap in `solvePose` starts binding and putting kinks back into the path.
 * 0.995 reads as 11.5 degrees of elbow flex and leaves that headroom.
 */
export const ARM_LOCK_RATIO = 0.995;

/**
 * Hard ceiling on arm extension, just under 1.0 so it stays clear of the IK's own
 * overextension threshold. Only the release blend ever reaches it, and with
 * `ARM_LOCK_RATIO` at 0.995 it no longer binds even there.
 */
export const ARM_CAP_RATIO = 0.999;

/**
 * The hand rectangle.
 *
 * The rectangle is torso-fixed and parallel to the spine axis. It is the surface
 * you DRAG on, and the 2D view is a head-on look at it -- but the hand itself no
 * longer lies on it. The hand sits at a perpendicular distance from the spine
 * axis that is solved so the locked arm stays straight (see `axisDistanceFor` in
 * arm.js).
 *
 * The rectangle is pinned to the address hand: its distance from the axis is
 * P1's own solved distance, so P1 always lies exactly on the rectangle and its
 * perpendicular offset reads 0. Move P1 -- by dragging it or by changing the
 * spine tilt -- and the rectangle follows.
 *
 * In-plane coordinates are measured from the shoulder centre:
 *   u  along the shoulder line, positive toward the lead side
 *   v  along the spine axis, positive toward the head
 */
export const PLANE = {
  /**
   * Initial rectangle distance. Immediately replaced: the rectangle is pinned to
   * the address hand, so its distance is whatever P1's own solved distance is.
   * See `SwingPath.addressAxisDistance`.
   */
  offset: 0.33,
  uMin: -0.45,
  uMax: 0.45,
  vMin: -0.62,
  vMax: 0.45,
};

/**
 * Path interpolation.
 *
 * Catmull-Rom takes its tangent at a keyframe from that keyframe's NEIGHBOURS,
 * so two keyframes close together inherit a tangent scaled to the distant ones.
 * The cubic between them then overshoots its own endpoints -- the bulge or loop
 * that shows up when points are bunched. Segments shorter than `straightBelow`
 * in the (u, v) plane are joined with a straight line instead.
 *
 * It is OFF, and the measurements are why. The hand track is now interpolated
 * with the Fritsch-Carlson limiter (see `tangent` in swing.js), which forbids the
 * cubic from leaving the box its own endpoints define -- so there is no overshoot
 * left for a straight segment to fix. With the limiter on, the worst segment on
 * the reference swing runs at arc/chord 1.033; without it, P3 to P4 reaches 1.30.
 * Turning this rule on as well only trades curves for polyline corners: at 0.15 m
 * the sharpest corner in the path moves from the top of the backswing, where the
 * hand really does reverse, to release, where it does not.
 *
 * Raise it to force short segments straight anyway; `Infinity` makes the whole
 * path a polyline, which is the one-line change to a pure keyframe-to-keyframe
 * reading of the swing.
 */
export const CURVE = {
  straightBelow: 0,
};

/**
 * Elbow placement hints, expressed in the rotating torso basis as
 * `{ up, fwd, side }` weights. A two-link IK solve leaves the elbow free to
 * swivel on a circle; the hint picks the point on that circle nearest to it.
 * Both elbows want to sit low and slightly behind the shoulder-to-hand line.
 */
export const ELBOW_HINT = {
  lead: { up: -1.0, fwd: -0.3, side: 0.1 },
  trail: { up: -1.0, fwd: -0.35, side: -0.2 },
};

/**
 * The address position.
 *
 * The address hand is ANCHORED at a FIXED point on the rectangle -- the same
 * (u, v) for every club. The anchor is where the arms hang plumb at the WEDGE,
 * the shortest club and the most bent-over setup.
 *
 * Everything else follows from the torso frame rotating underneath it. Pick a
 * longer club, the spine stands up, and the whole arm assembly rotates with it:
 * the hands rise and move FORWARD, from plumb at the wedge to 15.8 cm ahead of
 * plumb at the driver. That is the real behaviour, and it costs nothing in the
 * model -- because (u, v) never changes, no keyframe ever moves when you change
 * club, and the authored swing is untouched.
 *
 * The ball is what moves instead: it is placed where the club actually reaches.
 * A brief experiment had this the other way round, with the arms re-hung plumb
 * per club and the whole path translated to follow; that shifted P1 by several
 * centimetres between clubs and tore the takeaway off its own start.
 */
export const ADDRESS = {
  /** The tilt at which the arms hang plumb, which is the wedge's own setup. */
  anchorTiltDeg: 40,
  /** Butt of the club to the midpoint of the two hands on the grip. */
  gripDown: 0.1,
};

/**
 * The clubs.
 *
 * `lengthIn` and `lieDeg` are standard men's specs, not invented: 45.5" driver
 * down to a 35.25" wedge, lie 56 degrees to 64.5. Rory plays standard length, so
 * these are his lengths too; his own lie and loft tolerances are not public.
 *
 * `spineTiltDeg` is the forward bend at address, from published tour address
 * ranges -- longer club, more upright. This is the one number here that is a
 * published RANGE rather than a spec, because per-club spine angle is not
 * something Rory's team has released.
 *
 * `ballForward` is SOLVED, not authored: given the fixed address hand and the
 * club's length, it is where the head reaches the ground. See the club section of
 * the README. The emergent shaft angle comes out 5 degrees flatter than the spec
 * lie for the irons and 11 flatter for the driver -- which is closer to how a
 * shaft actually looks at address than the static spec number is, that being a
 * measurement with the sole flat rather than a posture.
 *
 * Head dimensions are real proportions in metres: toe-to-heel, crown-to-sole,
 * face-to-back.
 */
export const CLUBS = [
  { id: 'wedge', label: 'Wedge', lengthIn: 35.25, lieDeg: 64.5, spineTiltDeg: 40,
    ballHeight: 0.021, ballForward: 0.727, ballLateral: -0.02,
    type: 'iron', head: { length: 0.080, height: 0.058, depth: 0.025 } },
  { id: 'shortIron', label: 'Short iron', lengthIn: 36, lieDeg: 64, spineTiltDeg: 38,
    ballHeight: 0.021, ballForward: 0.752, ballLateral: 0.0,
    type: 'iron', head: { length: 0.078, height: 0.054, depth: 0.023 } },
  { id: 'midIron', label: 'Mid iron', lengthIn: 37, lieDeg: 62.5, spineTiltDeg: 35,
    ballHeight: 0.021, ballForward: 0.783, ballLateral: 0.03,
    type: 'iron', head: { length: 0.078, height: 0.052, depth: 0.022 } },
  { id: 'longIron', label: 'Long iron', lengthIn: 38.5, lieDeg: 61, spineTiltDeg: 32,
    ballHeight: 0.021, ballForward: 0.836, ballLateral: 0.06,
    type: 'iron', head: { length: 0.080, height: 0.050, depth: 0.021 } },
  { id: 'wood', label: 'Fairway wood', lengthIn: 43, lieDeg: 56.5, spineTiltDeg: 28,
    ballHeight: 0.021, ballForward: 1.004, ballLateral: 0.1,
    type: 'wood', head: { length: 0.095, height: 0.042, depth: 0.060 } },
  { id: 'driver', label: 'Driver', lengthIn: 45.5, lieDeg: 56, spineTiltDeg: 25,
    ballHeight: 0.055, ballForward: 1.121, ballLateral: 0.16,
    type: 'wood', head: { length: 0.118, height: 0.062, depth: 0.086 } },
];

export const DEFAULT_CLUB = 'driver';

/** Hand-to-clubhead distance for a club: its length less the grip-down. */
export const clubReach = (club) => club.lengthIn * 0.0254 - ADDRESS.gripDown;

/**
 * Half-width, in normalised time, of the window over which the straight-arm
 * constraint hands from the lead arm to the trail arm at release.
 *
 * A hard switch puts a corner in the hand path: the perpendicular distance is
 * solved from a different shoulder either side, and its slope flips sign. Real
 * hand paths have no such corner, because in reality neither arm is exactly
 * straight through the handover. Blending over a short window reproduces that.
 * It is nearly free: the two solutions coincide exactly at release (u = 0), so
 * the blend only ever departs from "straight" by a fraction of the gap.
 */
export const RELEASE_BLEND_T = 0.025;

export const TIMING = {
  /**
   * Real-world duration of the full swing at playback speed 1.0, seconds.
   *
   * Solved, not chosen. A 0.75 s backswing and the 3:1 tempo fix impact at
   * 1.00 s; requiring the torso to decelerate from its peak to a standstill at
   * the finish while covering the remaining 85 degrees then fixes the rest at
   * 0.235 s. Every angular velocity scales with this.
   */
  swingSeconds: 1.235,
  defaultSpeed: 0.3,
  /** Samples used to draw the hand-path curves. */
  pathSamples: 260,
};

/**
 * The club.
 *
 * Lengths are hand-to-clubhead, not the manufacturer's shaft length: the grip is
 * held some way down. The club tracks the spine slider rather than getting one of
 * its own, since that slider already stands for club length -- you bend more for a
 * wedge than for a driver.
 *
 * `longest` and `shortest` are SOLVED, not chosen: at each end of the tilt range
 * they are the distance from the address hand to the ball, so the head sits on the
 * ball at address. See the club section of the README.
 */
export const CLUB = {
  /**
   * Fallback hand-to-head distance, used only until `main.js` pins the club to
   * the selected club. The live value is `clubReach(club)`.
   */
  defaultLength: 0.84,
  /**
   * Roll offset that makes an authored `faceDeg` of 0 mean SQUARE -- face normal
   * straight down the target line -- at address. Solved, not chosen: the roll-0
   * reference is the forearm-plane normal carried along the shaft, which is a
   * convenient frame but an arbitrary zero, and this shifts it onto one that
   * means something. Re-solve it if the address wrist angles change.
   */
  faceZeroDeg: -84.2,
  /** How far the butt end sticks out beyond the hands -- the grip-down. */
  buttBeyondHands: 0.1,
  shaftRadius: 0.006,
  /** Shaft taper: the butt is thicker than the tip. */
  buttRadius: 0.009,
};

/**
 * Scene furniture. `forward` distances are magnitudes along the chest normal;
 * the 3D view multiplies them by the handedness sign, so flipping handedness
 * mirrors the ball and the camera along with the golfer.
 */
export const SCENE = {
  ballRadius: 0.021,
  ballLateral: 0.06, // toward the lead side: ball forward in the stance
  ballForward: 0.62,
  cameraStart: { x: 2.4, y: 1.82, forward: 2.9 },
  cameraTarget: { x: 0, y: 1.1, forward: 0.1 },
  /**
   * The body is scaffolding, not the subject: it is drawn translucent so the
   * arms, hands and path stay readable when they pass behind the torso.
   */
  bodyOpacity: 0.6,
};

/** Shared palette so the two views read as one instrument. */
export const COLORS = {
  backswing: '#4aa3ff',
  downswing: '#ff9f43',
  followThrough: '#c46bff',
  hand: '#ffffff',
  body: '#9aa7b8',
  plane: '#4aa3ff',
  elbowLine: '#ffd166',
  shaft: '#e6eef8',
  face: '#ffd166',
  normalAxis: '#7fd4ff',
  guide: '#5a6b80',
  unreachable: '#241a24',
};
