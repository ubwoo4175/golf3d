/**
 * Forward kinematics for the torso + arm triangle.
 *
 * The model, top to bottom:
 *   1. A fixed spine axis (tilted, anchored above the ground) -- static.
 *   2. A torso rotation `theta` about that axis -- the only body DOF.
 *   3. A torso-fixed rectangle parallel to the axis, at `PLANE.offset` from it.
 *      This is the surface you drag on.
 *   4. A hand at plane coordinates (u, v), pushed off the rectangle along its
 *      normal by a distance SOLVED so the locked arm stays straight.
 *   5. Both elbows solved by two-link IK from shoulder to hand.
 *
 * Nothing here knows about rendering or about time; `swing.js` supplies
 * (theta, u, v, constraint) and this module turns it into world-space joints.
 */

import * as V from './vec3.js';
import { BODY, PLANE, REACH, ARM_LOCK_RATIO, ELBOW_HINT, DEFAULT_HANDEDNESS } from './config.js';

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
  const forward = V.rad(BODY.spineTiltForwardDeg) * H;
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

/**
 * World position of a hand-plane point at perpendicular distance `distance` from
 * the spine axis. `PLANE.offset` puts it on the reference rectangle itself.
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

/**
 * The perpendicular distance from the spine axis that holds `which` arm straight
 * for a hand at plane coordinates (u, v). This is the automatic axis: you drag
 * (u, v), this supplies the third coordinate.
 *
 * A straight arm puts the hand on a sphere of radius `target` about that
 * shoulder. The line through (u, v) normal to the rectangle pierces that sphere
 * at
 *     distance = sqrt(target^2 - (u - u_shoulder)^2 - v^2)
 *
 * so there is a solution for every (u, v) inside a DISK of radius `target`
 * centred on the shoulder -- an area, where fixing the distance left only a
 * circle. That is exactly what makes free dragging compatible with a locked arm.
 */
export function axisDistanceFor(which, u, v, ratio = ARM_LOCK_RATIO) {
  const target = ratio * REACH;
  const du = u - SHOULDER_UV[which].u;
  const remaining = target * target - du * du - v * v;
  return {
    distance: Math.sqrt(Math.max(0, remaining)),
    reachable: remaining >= 0,
    target,
  };
}

/** Boundary of the disk within which `which` arm can be held straight. */
export function straightArmLocus(which, ratio = ARM_LOCK_RATIO) {
  return { u: SHOULDER_UV[which].u, v: 0, radius: ratio * REACH };
}

/**
 * With the locked arm's distance substituted in, the FREE arm's length collapses
 * to a function of u alone:
 *
 *     free^2 = target^2 -/+ 2 * u * shoulderWidth
 *
 * (minus when the trail arm is locked, plus when the lead arm is). So u is the
 * free elbow's fold control, and the free arm running out of length bounds u to
 * a half-plane. With the lock ratio near 1 that bound is a few millimetres from
 * zero, which means the rules by themselves force the hands onto the trail side
 * of the sternum until release and the lead side after it, meeting at u = 0.
 * That is why both arms can only be straight together at u = 0.
 */
export function freeArmULimit(lockedArm, ratio = ARM_LOCK_RATIO) {
  const target = ratio * REACH;
  const limit = (REACH * REACH - target * target) / (2 * BODY.shoulderWidth);
  return lockedArm === 'lead' ? { max: limit, min: -Infinity } : { max: Infinity, min: -limit };
}

/**
 * Two-link IK. Returns the elbow plus how flexed the arm ended up.
 *
 * `hint` breaks the swivel symmetry: the elbow is placed on the side of the
 * shoulder-hand line that the hint points toward. When the hand is beyond reach
 * both links are stretched proportionally so the limb still renders as a closed
 * chain, and `overextended` is set for the readout.
 */
export function solveArm(shoulder, hand, hint) {
  const l1 = BODY.upperArm;
  const l2 = BODY.forearm;
  const toHand = V.sub(hand, shoulder);
  const reach = V.length(toHand);
  const axis = V.normalize(toHand);

  const minReach = Math.abs(l1 - l2) + 1e-4;
  const maxReach = REACH - 1e-4;

  if (reach > maxReach) {
    // Straight arm, links scaled to span the gap.
    return {
      elbow: V.addScaled(shoulder, axis, (l1 / REACH) * reach),
      flexDeg: 0,
      reach,
      reachRatio: reach / REACH,
      overextended: true,
    };
  }

  const d = Math.max(reach, minReach);
  const along = (l1 * l1 - l2 * l2 + d * d) / (2 * d);
  const offset = Math.sqrt(Math.max(0, l1 * l1 - along * along));

  let perp = V.reject(hint, axis);
  if (V.length(perp) < 1e-6) perp = V.reject(V.vec(0, -1, 0), axis);
  if (V.length(perp) < 1e-6) perp = V.reject(V.vec(1, 0, 0), axis);
  perp = V.normalize(perp);

  const cosInterior = V.clamp((l1 * l1 + l2 * l2 - d * d) / (2 * l1 * l2), -1, 1);

  return {
    elbow: V.addScaled(V.addScaled(shoulder, axis, along), perp, offset),
    flexDeg: 180 - V.deg(Math.acos(cosInterior)),
    reach,
    reachRatio: reach / REACH,
    overextended: false,
  };
}

const hintVector = (basis, weights) => {
  let h = V.scale(basis.up, weights.up);
  h = V.addScaled(h, basis.fwd, weights.fwd);
  return V.addScaled(h, basis.side, weights.side);
};

/**
 * Full pose from the driving values.
 *
 * @param {object} d
 * @param {number} d.theta       torso rotation, radians, + = backswing
 * @param {number} d.u           along the shoulder line, + toward the lead side
 * @param {number} d.v           along the spine axis, + toward the head
 * @param {'lead'|'trail'} d.constraint  which arm is held straight
 * @returns pose with world joints, the torso basis, elbow readouts, and a
 *   `handFrame` that a club can be parented to later.
 */
export function solvePose({ theta, u, v, constraint = 'lead', ratio = ARM_LOCK_RATIO }) {
  const basis = torsoBasis(theta);

  const solved = axisDistanceFor(constraint, u, v, ratio);
  const hand = planeToWorld(basis, u, v, solved.distance);
  /** Where the drag point itself sits, on the rectangle. */
  const planePoint = planeToWorld(basis, u, v);

  const leadShoulder = V.addScaled(rig.shoulderCenter, basis.side, BODY.shoulderWidth / 2);
  const trailShoulder = V.addScaled(rig.shoulderCenter, basis.side, -BODY.shoulderWidth / 2);

  const lead = solveArm(leadShoulder, hand, hintVector(basis, ELBOW_HINT.lead));
  const trail = solveArm(trailShoulder, hand, hintVector(basis, ELBOW_HINT.trail));

  // Shaft direction: the hands' natural extension of the lead arm. This is the
  // hook a club model attaches to -- see README "Adding a club".
  const shaftDir = V.normalize(V.sub(hand, leadShoulder));
  const elbowLineDir = V.normalize(V.sub(trail.elbow, lead.elbow));

  return {
    theta,
    u,
    v,
    constraint,
    /** Perpendicular distance from the spine axis to the hand. */
    axisDistance: solved.distance,
    /** Signed offset of the hand from the reference rectangle, along its normal. */
    normalOffset: solved.distance - planeOffset,
    reachable: solved.reachable,
    basis,
    handedness: rig.handedness,
    sides: rig.sides,
    shoulderCenter: rig.shoulderCenter,
    leadShoulder,
    trailShoulder,
    hand,
    planePoint,
    lead,
    trail,
    head: V.addScaled(rig.shoulderCenter, basis.up, BODY.neckLength + BODY.headRadius),
    handFrame: { position: hand, shaftDir, elbowLineDir },
  };
}
