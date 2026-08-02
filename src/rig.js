/**
 * The body frame: the spine axis and the single rotation about it.
 *
 * This is the bottom of the kinematic chain and knows nothing above it -- no
 * arms, no hand, no club. Everything downstream asks this module two questions:
 * "where is the torso frame right now" (`torsoBasis`) and "where does a
 * torso-local point land in the world" (`planeToWorld`).
 *
 * The static rig depends on handedness and spine tilt only. Both are rebuilt
 * rather than mutated, so a rebuild is the single place a flip can go wrong.
 */

import * as V from './vec3.js';
import { BODY, PLANE, CLUBS, DEFAULT_CLUB, DEFAULT_HANDEDNESS } from './config.js';

/** Sign convention: theta > 0 is the backswing (torso turns away from target). */
export const BACKSWING_SIGN = 1;

/** The hip pivot -- origin of the spine axis. Handedness-independent. */
export const HIP_PIVOT = V.vec(0, BODY.hipPivotHeight, 0);

/**
 * Plane coordinates of the two shoulders. Independent of theta, of the spine
 * tilts and of handedness: the lead side is always +u, because the lead side is
 * by definition the one facing the target.
 */
export const SHOULDER_UV = {
  lead: { u: BODY.shoulderWidth / 2, v: 0 },
  trail: { u: -BODY.shoulderWidth / 2, v: 0 },
};

/** Which physical side each role is, for labelling the UI. */
export const ROLE_SIDES = {
  right: { lead: 'left', trail: 'right' },
  left: { lead: 'right', trail: 'left' },
};

/**
 * The static rig: everything that depends on handedness but not on time.
 * Rebuilt by `setHandedness`, read through `getRig`.
 */
let rig;

/**
 * Forward spine tilt in degrees. Runtime state, driven by the spine slider: it
 * stands for club length, since a wedge is addressed with more forward bend than
 * a driver.
 */
let spineTiltForwardDeg = BODY.spineTiltForwardDeg;

export const getSpineTilt = () => spineTiltForwardDeg;

/** Set the forward tilt and rebuild the rig around it. */
export function setSpineTilt(deg) {
  spineTiltForwardDeg = deg;
  return setHandedness(rig.handedness);
}

/**
 * (side, up, cross(side, up)) is a right-handed triple whose third vector points
 * +Z at address. That is the chest normal for a righty; a lefty faces the other
 * way, hence the H factor.
 */
const chestNormal = (side, up, H) => V.scale(V.normalize(V.cross(side, up)), H);

/**
 * @param {'right'|'left'} handedness
 *
 * H = +1 for a right-handed golfer. It flips two things and only two things:
 * the chest normal (a righty faces +Z, a lefty -Z) and the direction the spine
 * tilts forward, since "forward" means toward the ball. The lateral tilt does
 * not flip -- both lean away from the target, which is +X either way, so the
 * lead shoulder rides high for both.
 */
export function setHandedness(handedness) {
  const H = handedness === 'left' ? -1 : 1;
  const forward = V.rad(spineTiltForwardDeg) * H;
  const lateral = V.rad(BODY.spineTiltLateralDeg);
  const tilt = (p) => V.rotateZ(V.rotateX(p, forward), lateral);

  const up = V.normalize(tilt(V.vec(0, 1, 0)));
  const side = V.normalize(tilt(V.vec(1, 0, 0)));

  rig = {
    handedness,
    H,
    sides: ROLE_SIDES[handedness] ?? ROLE_SIDES.right,
    rest: { up, side, fwd: chestNormal(side, up, H) },
    spineAxis: { base: HIP_PIVOT, dir: up },
    shoulderCenter: V.addScaled(HIP_PIVOT, up, BODY.torsoLength),
  };
  return rig;
}

export const getRig = () => rig;

setHandedness(DEFAULT_HANDEDNESS);

/**
 * The selected club. It owns the spine tilt and the ball position, so changing
 * club is the one call that re-poses the whole address.
 */
let club = CLUBS.find((c) => c.id === DEFAULT_CLUB) ?? CLUBS[0];

export const getClub = () => club;

export function setClub(id) {
  club = CLUBS.find((c) => c.id === id) ?? club;
  setSpineTilt(club.spineTiltDeg);
  return club;
}

/**
 * Where the ball sits: solved per club, not scene furniture. Longer club, more
 * upright posture, higher hands, ball further away and further forward in the
 * stance -- the whole address moves together. Mirrored with the golfer.
 */
export const ballPosition = () =>
  V.vec(club.ballLateral, club.ballHeight, rig.H * club.ballForward);

// The default club owns the starting spine tilt, so apply it rather than leaving
// the rig on the placeholder in BODY.
setSpineTilt(club.spineTiltDeg);

/**
 * Orthonormal torso basis after rotating `theta` radians about the spine axis.
 *
 * The rotation is by `-H * theta` so that positive theta is always the
 * backswing: it has to carry the lead shoulder toward the ball, and the ball is
 * on opposite sides for the two handednesses.
 */
export function torsoBasis(theta) {
  const { rest, H } = rig;
  const up = rest.up;
  const side = V.normalize(V.rotateAbout(rest.side, up, -H * theta));
  return { up, side, fwd: chestNormal(side, up, H) };
}

/** World position of a shoulder in the given torso basis. */
export const shoulderWorld = (basis, which) =>
  V.addScaled(rig.shoulderCenter, basis.side, SHOULDER_UV[which].u);

/**
 * Where the reference rectangle sits, measured from the spine axis.
 *
 * This is purely where the rectangle is DRAWN. The hand's own distance from the
 * axis is solved from the arm rules and does not depend on it, so moving the
 * rectangle leaves the swing, the hand path and every joint untouched -- only
 * the reported `normalOffset` and the rectangle's position in the 3D view move.
 */
let planeOffset = PLANE.offset;

export const setPlaneOffset = (distance) => {
  planeOffset = distance;
};

export const getPlaneOffset = () => planeOffset;

/**
 * World position of a hand-plane point at perpendicular distance `distance` from
 * the spine axis. Omitting `distance` puts it on the reference rectangle itself.
 */
export function planeToWorld(basis, u, v, distance = planeOffset) {
  let p = V.addScaled(rig.shoulderCenter, basis.fwd, distance);
  p = V.addScaled(p, basis.side, u);
  return V.addScaled(p, basis.up, v);
}

/** Inverse of `planeToWorld`: project a world point into plane coordinates. */
export function worldToPlane(basis, p) {
  const d = V.sub(p, rig.shoulderCenter);
  return {
    u: V.dot(d, basis.side),
    v: V.dot(d, basis.up),
    distance: V.dot(d, basis.fwd),
  };
}
