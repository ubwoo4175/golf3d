/**
 * The composer: driving values in, a full world-space pose out.
 *
 * This is the only module that knows the whole chain. It asks `rig.js` where the
 * torso is, `arm.js` where the rules put the hand and where the elbows fold to,
 * and `club.js` where the shaft points -- and assembles the result. Everything it
 * returns is world space, ready for a renderer.
 *
 *   theta            -> rig.torsoBasis         the one body DOF
 *   (u, v, blend)    -> arm.solveAxisDistance  the hand, via the arm rules
 *   shoulders + hand -> arm.solveArm           the elbows
 *   hand + wrist     -> club.solveClub         the shaft and the face
 */

import * as V from './vec3.js';
import { BODY } from './config.js';
import {
  getRig,
  torsoBasis,
  shoulderWorld,
  planeToWorld,
  getPlaneOffset,
} from './rig.js';
import { solveAxisDistance, solveArm, elbowHint } from './arm.js';
import { solveClub, wristForDirection, WRIST_ZERO } from './club.js';

/**
 * An orthonormal frame at the hand, which is what a club has to be parented to.
 *
 * The old placeholder used `hand - leadShoulder` as a stand-in shaft direction.
 * That is the lead arm's own line, not the shaft: a real club leaves the hands at
 * a wrist angle, and it can also roll about its own axis, neither of which a
 * single direction can express. So the frame is a full basis:
 *
 *   f  the lead forearm extended (elbow -> hand). The shaft lies along this when
 *      the wrist is neutral, so it is the zero of the hinge angle.
 *   n  normal to the plane of the two forearms. The wrist's bow/cup axis.
 *   r  completes the frame, in the plane of the forearms. The wrist's cock axis.
 *
 * The forearm plane is the natural reference because it is how the hands are
 * actually held together on the grip -- and it degenerates only if the two
 * forearms become parallel, which cannot happen with the elbows at two shoulders
 * a shoulder-width apart. The fallback is there for dragged poses anyway.
 *
 * BOTH `n` and `r` carry the handedness sign, and both have to. Handedness is a
 * mirror in Z, and a cross product does not survive a mirror unchanged: reflect
 * both arguments and the result comes back NEGATED. `n` is one cross product deep
 * and `r` is two, so without the sign on each the lefty's frame is a reflection of
 * the righty's in `n` but the ANTI-reflection in `r` -- and the same stored
 * (cock, bow) then hinges the club the wrong way round the forearm. With the sign
 * on both, the frame mirrors cleanly and one stored swing serves both golfers.
 *
 * `H` rides along on the frame because the club needs it too: the shaft direction
 * mirrors, but the ROLL about it has to reverse, and a mirrored golfer holds a
 * mirrored club.
 */
export function handFrame(hand, leadElbow, trailElbow, basis) {
  const H = getRig().H;
  const f = V.normalize(V.sub(hand, leadElbow));
  const w = V.normalize(V.sub(hand, trailElbow));
  let n = V.cross(f, w);
  if (V.length(n) < 1e-6) n = V.cross(f, basis.up);
  if (V.length(n) < 1e-6) n = V.cross(f, basis.side);
  n = V.scale(V.normalize(n), H);
  return { origin: hand, f, r: V.scale(V.normalize(V.cross(n, f)), H), n, H };
}

/**
 * Full pose from the driving values.
 *
 * @param {object} d
 * @param {number} d.theta       torso rotation, radians, + = backswing
 * @param {number} d.u           along the shoulder line, + toward the lead side
 * @param {number} d.v           along the spine axis, + toward the head
 * @param {'lead'|'trail'} d.constraint  which arm is held straight
 * @param {number} d.blend       0 = lead arm locked, 1 = trail arm locked
 * @param {object} d.wrist       { cockDeg, bowDeg, faceDeg }
 * @param {object} [d.aim]       torso-chart club aim { a, b }, degrees. When
 *   present it overrides the wrist's cock/bow: the shaft direction is rebuilt
 *   in the torso basis and converted back to wrist angles against this pose's
 *   own hand frame. This is how the interpolated track arrives -- see
 *   `SwingPath.aimChart` for why the club is interpolated in the torso frame
 *   rather than in wrist coordinates.
 */
export function solvePose({
  theta,
  u,
  v,
  constraint = 'lead',
  blend = constraint === 'trail' ? 1 : 0,
  wrist = WRIST_ZERO,
  aim,
  ratio,
}) {
  const basis = torsoBasis(theta);
  const solved = solveAxisDistance(u, v, blend, ratio);

  const hand = planeToWorld(basis, u, v, solved.distance);
  /** Where the drag point itself sits, on the rectangle. */
  const planePoint = planeToWorld(basis, u, v);

  const leadShoulder = shoulderWorld(basis, 'lead');
  const trailShoulder = shoulderWorld(basis, 'trail');

  const lead = solveArm(leadShoulder, hand, elbowHint(basis, 'lead'));
  const trail = solveArm(trailShoulder, hand, elbowHint(basis, 'trail'));

  const frame = handFrame(hand, lead.elbow, trail.elbow, basis);

  if (aim) {
    // Chart -> torso direction -> world -> wrist angles. `a` runs along `side`
    // and `b` along `fwd`, both of which mirror with handedness, so one chart
    // serves both golfers.
    const phi = Math.hypot(aim.a, aim.b);
    const phiRad = (phi * Math.PI) / 180;
    let dir = V.scale(basis.up, -Math.cos(phiRad));
    if (phi > 1e-9) {
      const sin = Math.sin(phiRad) / phi;
      dir = V.addScaled(dir, basis.side, aim.a * sin);
      dir = V.addScaled(dir, basis.fwd, aim.b * sin);
    }
    wrist = { ...wristForDirection(frame, dir), faceDeg: wrist.faceDeg ?? 0 };
  }

  return {
    theta,
    u,
    v,
    constraint,
    /** Perpendicular distance from the spine axis to the hand. */
    axisDistance: solved.distance,
    /** Signed offset of the hand from the reference rectangle, along its normal. */
    normalOffset: solved.distance - getPlaneOffset(),
    reachable: solved.reachable,
    basis,
    handedness: getRig().handedness,
    sides: getRig().sides,
    shoulderCenter: getRig().shoulderCenter,
    leadShoulder,
    trailShoulder,
    hand,
    planePoint,
    lead,
    trail,
    elbowLineDir: V.normalize(V.sub(trail.elbow, lead.elbow)),
    head: V.addScaled(getRig().shoulderCenter, basis.up, BODY.neckLength + BODY.headRadius),
    handFrame: frame,
    wrist,
    club: solveClub(frame, wrist),
  };
}
