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
 * How extended a "straight" arm is held. Not 1.0 for two reasons: a real locked
 * arm keeps a few degrees of flex, and exactly 1.0 would sit on the reach
 * boundary where the IK flags an overextension. 0.997 reads as 8.9 degrees of
 * elbow flex.
 */
export const ARM_LOCK_RATIO = 0.997;

/**
 * The hand rectangle.
 *
 * The rectangle is torso-fixed and parallel to the spine axis, sitting at
 * `offset` from it. It is the surface you DRAG on, and the 2D view is a head-on
 * look at it -- but the hand itself no longer lies on it. The hand sits at a
 * perpendicular distance from the spine axis that is solved so the locked arm
 * stays straight (see `axisDistanceFor` in kinematics.js), so `offset` is now
 * only where the reference rectangle is drawn. It is set near the middle of the
 * distances the reference swing actually visits, so the solved offset swings
 * both in front of and behind the rectangle.
 *
 * In-plane coordinates are measured from the shoulder centre:
 *   u  along the shoulder line, positive toward the lead side
 *   v  along the spine axis, positive toward the head
 */
export const PLANE = {
  offset: 0.33,
  uMin: -0.45,
  uMax: 0.45,
  vMin: -0.62,
  vMax: 0.45,
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

export const TIMING = {
  /** Real-world duration of the full swing at playback speed 1.0, seconds. */
  swingSeconds: 1.35,
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
