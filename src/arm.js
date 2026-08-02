/**
 * The arms: the rules that place the hand, and the IK that folds the elbows.
 *
 * Two separate jobs, both about the arms and both independent of rendering:
 *
 *   1. THE ARM RULES. One arm is held straight at any moment, which is what
 *      supplies the hand's perpendicular distance from the rectangle. You drag
 *      (u, v); this module returns the third coordinate.
 *   2. TWO-LINK IK. Given a shoulder and a hand, where does the elbow go.
 *
 * Nothing here knows about time, about the swing, or about the club.
 */

import * as V from './vec3.js';
import {
  BODY,
  REACH,
  ARM_LOCK_RATIO,
  ARM_CAP_RATIO,
  ELBOW_HINT,
  ADDRESS,
} from './config.js';
import { SHOULDER_UV } from './rig.js';

// --- the arm rules ---------------------------------------------------------

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
 * Blend the two locked-arm solutions rather than switching between them, so the
 * hand path has no corner at release. They coincide at u = 0, which is exactly
 * where release sits, so the blend costs almost nothing in arm straightness.
 *
 * Blending moves the distance off each arm's own solution, so mid-handover one
 * arm sits slightly longer than its target -- about 1 mm, but enough to trip the
 * IK's overextension flag and paint the arm red. The cap is the distance at which
 * NEITHER arm exceeds its actual length. It only ever binds inside the blend
 * window, and only by that millimetre.
 */
export function solveAxisDistance(u, v, blend, ratio = ARM_LOCK_RATIO) {
  const byLead = axisDistanceFor('lead', u, v, ratio);
  const byTrail = axisDistanceFor('trail', u, v, ratio);
  const blended = byLead.distance + (byTrail.distance - byLead.distance) * blend;
  const cap = Math.min(
    axisDistanceFor('lead', u, v, ARM_CAP_RATIO).distance,
    axisDistanceFor('trail', u, v, ARM_CAP_RATIO).distance,
  );
  return {
    distance: Math.min(blended, cap),
    reachable:
      blend <= 0
        ? byLead.reachable
        : blend >= 1
          ? byTrail.reachable
          : byLead.reachable && byTrail.reachable,
  };
}

/**
 * The anchored address hand position, in plane coordinates.
 *
 * At u = 0 the hand is equidistant from both shoulders, so a locked lead arm
 * confines it to a circle of radius
 *     r = sqrt(target^2 - (shoulderWidth / 2)^2)
 * about the shoulder centre, in the plane spanned by the spine axis and the chest
 * normal -- the sagittal plane you see the golfer's setup in from the side. The
 * anchor is the point on that circle where the arms hang plumb at the short-iron
 * setup, `ADDRESS.anchorTiltDeg`:
 *     v = -r * cos(anchorTilt)      distance = r * sin(anchorTilt)
 *
 * It does NOT depend on the current spine tilt. Note what that implies: since
 * (u, v) is fixed and the arm length is fixed, the perpendicular distance is
 * fixed too -- the arm-length constraint ties all three together. So changing the
 * tilt leaves the hand completely fixed IN THE TORSO FRAME, and the rectangle,
 * which is pinned to it, never moves either. What changes is the world pose: the
 * torso frame rotates, carrying the whole arm assembly with it, so the hands rise
 * and swing away from the body as the spine lifts toward the long clubs.
 */
export function naturalAddress() {
  const target = ARM_LOCK_RATIO * REACH;
  const half = BODY.shoulderWidth / 2;
  const radius = Math.sqrt(Math.max(0, target * target - half * half));
  const angle = V.rad(ADDRESS.anchorTiltDeg);
  return {
    u: 0,
    v: -radius * Math.cos(angle),
    axisDistance: radius * Math.sin(angle),
  };
}

// --- two-link IK -----------------------------------------------------------

/**
 * Returns the elbow plus how flexed the arm ended up.
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

/** Turn an `{ up, fwd, side }` weight triple into a world vector. */
export const hintVector = (basis, weights) => {
  let h = V.scale(basis.up, weights.up);
  h = V.addScaled(h, basis.fwd, weights.fwd);
  return V.addScaled(h, basis.side, weights.side);
};

/** The configured elbow hint for one arm, in the given torso basis. */
export const elbowHint = (basis, which) => hintVector(basis, ELBOW_HINT[which]);
