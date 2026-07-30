/**
 * Every tunable number lives here.
 *
 * WORLD CONVENTIONS (right-handed golfer)
 *   +Y  up, ground plane at y = 0
 *   +X  target direction (ball flies toward +X); also the golfer's lead side
 *   -Z  the direction the chest faces at address (the ball sits at -Z)
 *
 * All lengths are metres, all angles in the config are degrees.
 */

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
  // Knee height and how far forward (toward the ball) it sits. Purely visual --
  // the legs never move, this just stops them reading as stilts.
  kneeHeight: 0.53,
  kneeForward: -0.1,
  neckLength: 0.13,
  headRadius: 0.105,
};

export const REACH = BODY.upperArm + BODY.forearm;

/**
 * The hand plane.
 *
 * The hands are constrained to a plane that is PARALLEL to the spine axis and
 * therefore sits at a constant distance (`offset`) from it -- this is the
 * "equal distance from the spine axis" condition. The plane is fixed to the
 * torso, so it rotates with it; the 2D view is a head-on look at this plane.
 *
 * In-plane coordinates are measured from the shoulder centre:
 *   u  along the shoulder line, positive toward the lead (left) side
 *   v  along the spine axis, positive toward the head
 */
export const PLANE = {
  offset: 0.3,
  // Sized to sit just outside the region the arms can actually reach, so the
  // rectangle is mostly usable rather than mostly out of range.
  uMin: -0.45,
  uMax: 0.45,
  vMin: -0.62,
  vMax: 0.4,
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

export const SCENE = {
  ballPosition: { x: 0.06, y: 0.021, z: -0.62 },
  ballRadius: 0.021,
  cameraStart: { x: 2.25, y: 1.7, z: -2.65 },
  cameraTarget: { x: 0, y: 1.0, z: -0.12 },
  /**
   * The body is scaffolding, not the subject: it is drawn translucent so the
   * arms, hands and path stay readable when they pass behind the torso.
   */
  bodyOpacity: 0.52,
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
  guide: '#5a6b80',
  unreachable: '#241a24',
};
