/**
 * Forward kinematics for the torso + arm triangle.
 *
 * The model, top to bottom:
 *   1. A fixed spine axis (tilted, anchored above the ground) -- static.
 *   2. A torso rotation `theta` about that axis -- the only body DOF.
 *   3. A torso-fixed hand plane parallel to the axis, `PLANE.offset` away.
 *   4. A hand point (u, v) on that plane -- the two DOF you drag.
 *   5. Both elbows solved by two-link IK from shoulder to hand.
 *
 * Nothing here knows about rendering or about time; `swing.js` supplies
 * (theta, u, v) and this module turns it into world-space joints.
 */

import * as V from './vec3.js';
import { BODY, PLANE, REACH, ELBOW_HINT } from './config.js';

/** Sign convention: theta > 0 is the backswing (torso turns away from target). */
export const BACKSWING_SIGN = 1;

/** The hip pivot -- origin of the spine axis, fixed for the whole swing. */
export const HIP_PIVOT = V.vec(0, BODY.hipPivotHeight, 0);

/**
 * Torso basis at theta = 0, after applying the two static spine tilts.
 * `up` is the spine axis, `side` runs along the shoulder line toward the lead
 * side, and `fwd` is the chest normal (pointing at the ball).
 */
const REST = (() => {
  const a = V.rad(BODY.spineTiltForwardDeg);
  const b = V.rad(BODY.spineTiltLateralDeg);
  const tilt = (p) => V.rotateZ(V.rotateX(p, -a), b);
  const up = V.normalize(tilt(V.vec(0, 1, 0)));
  const side = V.normalize(tilt(V.vec(1, 0, 0)));
  return { up, side, fwd: V.normalize(V.cross(up, side)) };
})();

export const SPINE_AXIS = { base: HIP_PIVOT, dir: REST.up };

/** Shoulder centre: a point on the spine axis, invariant under torso rotation. */
export const SHOULDER_CENTER = V.addScaled(HIP_PIVOT, REST.up, BODY.torsoLength);

/** Orthonormal torso basis after rotating `theta` radians about the spine axis. */
export function torsoBasis(theta) {
  const up = REST.up;
  const side = V.normalize(V.rotateAbout(REST.side, up, theta));
  return { up, side, fwd: V.normalize(V.cross(up, side)) };
}

/** World position of a hand-plane point, given a torso basis. */
export function planeToWorld(basis, u, v) {
  let p = V.addScaled(SHOULDER_CENTER, basis.fwd, PLANE.offset);
  p = V.addScaled(p, basis.side, u);
  return V.addScaled(p, basis.up, v);
}

/** Inverse of `planeToWorld`: project a world point into plane coordinates. */
export function worldToPlane(basis, p) {
  const origin = V.addScaled(SHOULDER_CENTER, basis.fwd, PLANE.offset);
  const d = V.sub(p, origin);
  return { u: V.dot(d, basis.side), v: V.dot(d, basis.up), n: V.dot(d, basis.fwd) };
}

/** Plane coordinates of the two shoulders. Independent of theta and of tilt. */
export const SHOULDER_UV = {
  lead: { u: BODY.shoulderWidth / 2, v: 0 },
  trail: { u: -BODY.shoulderWidth / 2, v: 0 },
};

/**
 * The circle on the hand plane where that arm is exactly straight.
 *
 * A straight arm puts the hand on a sphere of radius REACH about the shoulder;
 * intersecting it with the hand plane gives this circle. Inside it the elbow is
 * bent, outside it the point is simply out of reach -- which is why a hand that
 * roams the whole rectangle cannot keep the lead elbow locked.
 */
export function straightArmLocus(which) {
  const shoulder = SHOULDER_UV[which];
  const r2 = REACH * REACH - PLANE.offset * PLANE.offset;
  return { u: shoulder.u, v: shoulder.v, radius: r2 > 0 ? Math.sqrt(r2) : 0 };
}

/**
 * Two-link IK. Returns the elbow plus how flexed the arm ended up.
 *
 * `hint` breaks the swivel symmetry: the elbow is placed on the side of the
 * shoulder-hand line that the hint points toward. When the hand is beyond
 * reach both links are stretched proportionally so the limb still renders as a
 * closed chain, and `overextended` is set for the readout.
 */
export function solveArm(shoulder, hand, hint) {
  const l1 = BODY.upperArm;
  const l2 = BODY.forearm;
  const toHand = V.sub(hand, shoulder);
  const reach = V.length(toHand);
  const axis = V.normalize(toHand);

  const minReach = Math.abs(l1 - l2) + 1e-4;
  const maxReach = REACH - 1e-4;
  const overextended = reach > maxReach;

  if (overextended) {
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
 * Full pose from the three driving values.
 *
 * @param {{theta:number,u:number,v:number}} d  theta in radians, u/v in metres
 * @returns pose with world joints, the torso basis, elbow flex readouts, and a
 *   `handFrame` that a club can be parented to later.
 */
export function solvePose({ theta, u, v }) {
  const basis = torsoBasis(theta);

  const leadShoulder = V.addScaled(SHOULDER_CENTER, basis.side, BODY.shoulderWidth / 2);
  const trailShoulder = V.addScaled(SHOULDER_CENTER, basis.side, -BODY.shoulderWidth / 2);
  const hand = planeToWorld(basis, u, v);

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
    basis,
    shoulderCenter: SHOULDER_CENTER,
    leadShoulder,
    trailShoulder,
    hand,
    lead,
    trail,
    head: V.addScaled(SHOULDER_CENTER, basis.up, BODY.neckLength + BODY.headRadius),
    handFrame: { position: hand, shaftDir, elbowLineDir },
  };
}
