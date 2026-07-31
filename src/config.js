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

/** Skeleton dimensions, loosely scaled to a ~1.88 m tour player. */
export const BODY = {
  // Base of the spine axis: the fixed pivot the torso rotates about.
  hipPivotHeight: 1.0,
  // Distance from the hip pivot to the shoulder centre, along the spine axis.
  torsoLength: 0.52,
  shoulderWidth: 0.42,
  upperArm: 0.32,
  // Elbow to grip centre (forearm + hand), i.e. the second IK link.
  forearm: 0.35,

  // Static posture. The legs and the spine tilt never change during the swing;
  // only the rotation about the spine axis does.
  spineTiltForwardDeg: 32, // bend from vertical, top of spine toward the ball
  spineTiltLateralDeg: 8, // lean away from the target, lead shoulder rides high

  // Cosmetic / static scaffolding for the 3D view.
  pelvisWidth: 0.34,
  footSpread: 0.32,
  // Knee height and how far it sits toward the ball. Purely visual -- the legs
  // never move, this just stops them reading as stilts. Forward distances are
  // magnitudes along fwd; the view multiplies them by the handedness sign.
  kneeHeight: 0.53,
  kneeForward: 0.1,
  neckLength: 0.13,
  headRadius: 0.105,
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
 * The hand rectangle.
 *
 * The rectangle is torso-fixed and parallel to the spine axis. It is the surface
 * you DRAG on, and the 2D view is a head-on look at it -- but the hand itself no
 * longer lies on it. The hand sits at a perpendicular distance from the spine
 * axis that is solved so the locked arm stays straight (see `axisDistanceFor` in
 * kinematics.js).
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
 * in the (u, v) plane are therefore joined with a straight line instead.
 *
 * The cutoff is set from measurement, not taste. Comparing each segment's arc
 * length against its own chord on the reference swing:
 *
 *     P7 to P7.5    0.074 m    arc/chord 1.135   <- a 13.5% detour, the distortion
 *     P7.5 to P8    0.137 m    arc/chord 1.004
 *     every other   >= 0.15 m  arc/chord <= 1.027
 *
 * so the curve only misbehaves below about 0.10 m, and 0.10 sits in the gap
 * between the bad segment and the next shortest good one. Straightening that one
 * segment takes its arc/chord to exactly 1.000.
 *
 * Set `straightBelow: Infinity` to make the entire path straight-line -- the
 * one-line change to a pure polyline.
 */
export const CURVE = {
  straightBelow: 0.1,
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
 * The address hand is ANCHORED at a fixed point on the rectangle: it does not
 * move when the spine tilt changes. The anchor is defined by the short-iron
 * setup, `anchorTiltDeg`, where the arms hang plumb -- straight down in the side
 * view. That single reference fixes (u, v) once and for all.
 *
 * Everything else follows from the torso frame rotating. Lift the spine toward
 * the long clubs and the whole arm assembly lifts with it, so the hands rise and
 * swing away from the body, while their position ON the rectangle stays put.
 * The arm never changes relative to the torso; only the torso's angle changes.
 */
export const ADDRESS = {
  anchorTiltDeg: 40,
  /**
   * Slider range for the forward spine tilt, degrees from vertical: driver at the
   * shallow end, short iron at the steep end. The steep end is the anchor tilt on
   * purpose -- past it the fixed anchor would swing the hands BEHIND the plumb
   * line, which no one addresses a ball from.
   */
  tiltMin: 22,
  tiltMax: 40,
};

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
   * Chosen so the backswing lands at ~0.75 s and the downswing at ~0.25 s, the
   * ~3:1 tour tempo. Every angular velocity scales with this.
   */
  swingSeconds: 1.45,
  defaultSpeed: 0.3,
  /** Samples used to draw the hand-path curves. */
  pathSamples: 260,
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
  normalAxis: '#7fd4ff',
  guide: '#5a6b80',
  unreachable: '#241a24',
};
