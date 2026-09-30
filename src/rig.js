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
import { BODY, PLANE, CLUBS, DEFAULT_CLUB, DEFAULT_HANDEDNESS, TRANSITION } from './config.js';

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
    forward,
    lateral,
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

// --- the transition shift ----------------------------------------------------
//
// The spine axis is fixed except in one window around the top; see TRANSITION
// in config.js. `shiftAt(t)` says how far through that move the body is at
// time t, and `torsoBasis` takes it and moves the axis accordingly.

let transition = { ...TRANSITION };

export const getTransition = () => transition;

export function setTransition(patch) {
  transition = { ...transition, ...patch };
  return transition;
}

/** No shift at all: the address axis. */
export const NO_SHIFT = Object.freeze({ w: 0, tiltDeg: 0, slide: 0, hipOpenDeg: 0, hipRiseDeg: 0 });

/**
 * How far through the transition shift the body is at time t: 0 up to
 * `startT`, 1 from `endT` on, and a quintic smootherstep between -- zero
 * velocity AND zero acceleration at both ends, so the axis starts and stops
 * moving without a jolt in the hand or clubhead path.
 */
export function shiftAt(t) {
  const { enabled, startT, endT } = transition;
  if (!enabled) return NO_SHIFT;
  let x = endT > startT ? (t - startT) / (endT - startT) : t >= endT ? 1 : 0;
  x = Math.min(1, Math.max(0, x));
  const w = x * x * x * (x * (6 * x - 15) + 10);
  if (w === 0) return NO_SHIFT;
  return {
    w,
    tiltDeg: w * transition.tiltDeg,
    slide: w * transition.slide,
    hipOpenDeg: w * transition.hipOpenDeg,
    hipRiseDeg: w * transition.hipRiseDeg,
  };
}

/**
 * The un-turned torso frame for a given shift: the spine axis leaned further
 * away from the target by `tiltDeg`, pivoting about a hip pivot slid `slide`
 * toward the target. Both are the same for either handedness -- the target is
 * +X for both -- exactly like the address lean they add to.
 */
function restFrame(shift) {
  if (!shift || (!shift.tiltDeg && !shift.slide)) {
    return { up: rig.rest.up, side: rig.rest.side, pivot: HIP_PIVOT, shoulder: rig.shoulderCenter };
  }
  const lateral = rig.lateral + V.rad(shift.tiltDeg);
  const tilt = (p) => V.rotateZ(V.rotateX(p, rig.forward), lateral);
  const up = V.normalize(tilt(V.vec(0, 1, 0)));
  const side = V.normalize(tilt(V.vec(1, 0, 0)));
  const pivot = V.vec(HIP_PIVOT.x + shift.slide, HIP_PIVOT.y, HIP_PIVOT.z);
  return { up, side, pivot, shoulder: V.addScaled(pivot, up, BODY.torsoLength) };
}

/**
 * Orthonormal torso basis after rotating `theta` radians about the spine axis,
 * with the axis itself moved by `shift` (see `shiftAt`; omitted = address).
 *
 * The rotation is by `-H * theta` so that positive theta is always the
 * backswing: it has to carry the lead shoulder toward the ball, and the ball is
 * on opposite sides for the two handednesses.
 *
 * The basis carries its own origin -- the hip `pivot` and the `shoulder`
 * centre -- so everything placed in the torso frame follows the axis when it
 * moves.
 */
export function torsoBasis(theta, shift = NO_SHIFT) {
  const { H } = rig;
  const { up, side: rest, pivot, shoulder } = restFrame(shift);
  const side = V.normalize(V.rotateAbout(rest, up, -H * theta));
  return { up, side, fwd: chestNormal(side, up, H), pivot, shoulder };
}

/** World position of a shoulder in the given torso basis. */
export const shoulderWorld = (basis, which) =>
  V.addScaled(basis.shoulder, basis.side, SHOULDER_UV[which].u);

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
  let p = V.addScaled(basis.shoulder, basis.fwd, distance);
  p = V.addScaled(p, basis.side, u);
  return V.addScaled(p, basis.up, v);
}

/** Inverse of `planeToWorld`: project a world point into plane coordinates. */
export function worldToPlane(basis, p) {
  const d = V.sub(p, basis.shoulder);
  return {
    u: V.dot(d, basis.side),
    v: V.dot(d, basis.up),
    distance: V.dot(d, basis.fwd),
  };
}
