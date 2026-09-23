/**
 * Toggleable constraints: keyframe rules that are re-imposed after every edit.
 *
 * Each one pins something the P-system (or plain physics) says a keyframe
 * must be, and leaves the rest of the swing alone. While a constraint is on,
 * dragging the keyframe it owns still moves whatever the rule leaves free --
 * the rule simply wins on the part it owns.
 *
 *   p2  P2: the shaft parallel to the ground AND the target line, pointing back
 *   p6  P6: the same, at delivery
 *   p1  P1: the middle of the face right against the ball, face square. The
 *       club is rigid and the hand sits on the arms' circle, so the only way to
 *       reach a ball you have moved is to move the address hand along that
 *       circle -- P1's v -- until the club is exactly long enough.
 *   p7  P7: the club at impact where it was at address. The head lands exactly
 *       on P1's head, face square; the hand gets as close to P1's hand as the
 *       arm rules allow -- close, not exact, since the lead shoulder has turned
 *       away from where it was. If the turn is too open for the club to reach
 *       at all, the turn is eased toward square just far enough, and reported.
 *
 * Order matters and is fixed: P1 first (P7 copies it), then P7, then P2 and P6.
 */

import * as V from './vec3.js';
import { SCENE } from './config.js';
import { getRig, getClub, ballPosition } from './rig.js';
import { freeArmULimit } from './arm.js';
import { wristForDirection, solveClub, faceAngleToTarget, getClubLength } from './club.js';
import { solvePose } from './pose.js';
import { constraintAt, releaseBlendAt } from './swing.js';

export const CONSTRAINTS = [
  { id: 'p2', label: 'P2', hint: 'shaft ∥ ground & target line',
    title: 'P2: shaft parallel to the ground and the target line' },
  { id: 'p6', label: 'P6', hint: 'shaft ∥ ground & target line',
    title: 'P6: shaft parallel to the ground and the target line' },
  { id: 'p1', label: 'P1', hint: 'face centre against the ball',
    title: 'P1: middle of the face right against the ball, face square' },
  { id: 'p7', label: 'P7', hint: 'club back where it was at P1',
    title: 'P7: head exactly on the P1 head, hands as close to P1 as the arms allow, face square' },
];

/** Keyframe index by its P-number, from the label. */
const indexOf = (keys, tag) => keys.findIndex((k) => k.label.split(' ')[0] === tag);

/** A keyframe's own pose, from its stored values alone. */
export function keyPose(k, override = {}) {
  const key = { ...k, ...override };
  return solvePose({
    theta: V.rad(key.thetaDeg),
    u: key.u,
    v: key.v,
    constraint: constraintAt(key.t),
    blend: releaseBlendAt(key.t),
    wrist: key,
  });
}

/**
 * Middle of the club FACE. `club.head` is the middle of the head -- the box --
 * and the face is half the head's depth in front of it along the face normal.
 */
export function faceCentre(club) {
  return V.addScaled(club.head, club.faceNormal, getClub().head.depth / 2 + 0.002);
}

/** Minimise |f| over one variable: coarse scan, then golden refinement. */
function argminAbs(f, lo, hi, steps) {
  let best = lo;
  let bestV = Infinity;
  for (let i = 0; i <= steps; i += 1) {
    const x = lo + ((hi - lo) * i) / steps;
    const v = Math.abs(f(x));
    if (v < bestV) {
      bestV = v;
      best = x;
    }
  }
  let step = (hi - lo) / steps;
  for (let n = 0; n < 40 && step > 1e-7; n += 1) {
    let moved = false;
    for (const x of [best - step, best + step]) {
      const v = Math.abs(f(x));
      if (v < bestV) {
        bestV = v;
        best = x;
        moved = true;
      }
    }
    if (!moved) step /= 2;
  }
  return { x: best, residual: bestV };
}

/** The face roll that squares the face to the target line, in `frame`. */
function squareFaceDeg(frame, wrist) {
  const H = getRig().H;
  return argminAbs(
    (x) => faceAngleToTarget(solveClub(frame, { ...wrist, faceDeg: x }), H),
    -180,
    180,
    360,
  ).x;
}

/** Aim a keyframe's shaft along a world direction, keeping its roll. */
function aimKey(k, dir) {
  const pose = keyPose(k);
  Object.assign(k, wristForDirection(pose.handFrame, dir));
}

function applyP1(keys) {
  const k = keys[indexOf(keys, 'P1')];
  const L = getClubLength();
  const ball = ballPosition();
  const x = V.vec(1, 0, 0);
  // The face centre sits one ball radius behind the ball's centre along the
  // target line, at ball height: face touching ball, square to the target.
  const face = V.addScaled(ball, x, -SCENE.ballRadius);
  const handAt = (v) => keyPose(k, { u: 0, v }).hand;
  let offset = getClub().head.depth / 2 + 0.002;
  let normal = x;
  let residual = 0;
  for (let pass = 0; pass < 4; pass += 1) {
    const head = V.addScaled(face, normal, -offset);
    // Roots of |head - hand(v)| = L along the arms' circle; the one nearest
    // where P1 already is, so the address does not jump between solutions.
    const f = (v) => V.distance(head, handAt(v)) - L;
    let best = null;
    const lo = -0.62;
    const hi = 0.0;
    const n = 124;
    for (let i = 0; i < n; i += 1) {
      const a = lo + ((hi - lo) * i) / n;
      const b = lo + ((hi - lo) * (i + 1)) / n;
      const fa = f(a);
      const fb = f(b);
      if (fa * fb > 0) continue;
      let p = a;
      let q = b;
      for (let j = 0; j < 40; j += 1) {
        const m = (p + q) / 2;
        if (f(p) * f(m) <= 0) q = m;
        else p = m;
      }
      const root = (p + q) / 2;
      if (!best || Math.abs(root - k.v) < Math.abs(best - k.v)) best = root;
    }
    if (best === null) {
      // Out of reach: get as close as the arms allow and say by how much.
      const r = argminAbs(f, lo, hi, 124);
      best = r.x;
      residual = r.residual;
    } else {
      residual = 0;
    }
    k.u = 0;
    k.v = best;
    aimKey(k, V.sub(head, handAt(best)));
    const pose = keyPose(k);
    k.faceDeg = squareFaceDeg(pose.handFrame, k);
    normal = keyPose(k).club.faceNormal;
    offset = getClub().head.depth / 2 + 0.002;
  }
  return residual > 0.002 ? `ball out of reach by ${(residual * 100).toFixed(1)} cm` : 'on';
}

function applyP7(keys) {
  const k1 = keys[indexOf(keys, 'P1')];
  const k = keys[indexOf(keys, 'P7')];
  const p1 = keyPose(k1);
  const headTarget = p1.club.head;
  const handTarget = p1.hand;
  const L = getClubLength();
  const limit = freeArmULimit(constraintAt(k.t));
  const uLo = Math.max(limit.min, -0.45);
  const uHi = Math.min(limit.max, 0.45);
  const vLo = -0.62;
  const vHi = 0.3;
  // How far the club is from reaching P1's head from hand (u, v) at turn
  // `thetaDeg`: positive = too short. NaN where the arms cannot place the hand.
  const reach = (thetaDeg, u, v) => {
    const pose = keyPose(k, { thetaDeg, u, v });
    return pose.reachable ? V.distance(headTarget, pose.hand) - L : NaN;
  };

  // Can the head reach at all at this turn? The smallest `reach` over the
  // rectangle, by pattern search from the middle of where hands can be.
  const shortfall = (thetaDeg) => {
    let u = Math.min(Math.max(k.u, uLo), uHi);
    let v = Math.min(Math.max(k.v, vLo), vHi);
    let best = reach(thetaDeg, u, v);
    if (Number.isNaN(best)) {
      u = 0;
      v = -0.3;
      best = reach(thetaDeg, u, v);
    }
    let step = 0.05;
    while (step > 1e-4) {
      let moved = false;
      for (const [du, dv] of [[step, 0], [-step, 0], [0, step], [0, -step]]) {
        const cu = u + du;
        const cv = v + dv;
        if (cu < uLo || cu > uHi || cv < vLo || cv > vHi) continue;
        const r = reach(thetaDeg, cu, cv);
        if (r < best) {
          best = r;
          u = cu;
          v = cv;
          moved = true;
        }
      }
      if (!moved) step /= 2;
    }
    return best;
  };

  // The rig turns the shoulders about a fixed spine -- no hip slide, no side
  // bend -- so with the shoulders well open the arms cannot get the hands back
  // down to where the club reaches the ball. When that is so, ease the turn
  // back toward square just as far as it takes, and say so.
  const stored = k.thetaDeg;
  let thetaDeg = stored;
  if (!(shortfall(stored) <= 0)) {
    let bad = stored;
    let good = 0;
    if (!(shortfall(good) <= 0)) return 'ball out of reach at any turn';
    for (let i = 0; i < 24; i += 1) {
      const mid = (bad + good) / 2;
      if (shortfall(mid) <= 0) good = mid;
      else bad = mid;
    }
    // A little inside the edge, on a round number, so the next pass finds the
    // same turn reachable and leaves it alone.
    thetaDeg = Math.sign(good) * Math.max(0, Math.floor((Math.abs(good) - 0.1) * 2) / 2);
  }

  // Along each vertical line u of the rectangle, the hands that are exactly one
  // club length from P1's head: the roots of reach(v) = 0. Of those, the one
  // whose hand is closest to P1's hand. The head is then exact by construction.
  const onLine = (u) => {
    const f = (v) => reach(thetaDeg, u, v);
    let best = null;
    const n = 46;
    let a = vLo;
    let fa = f(a);
    for (let i = 1; i <= n; i += 1) {
      const b = vLo + ((vHi - vLo) * i) / n;
      const fb = f(b);
      if (fa * fb <= 0) {
        let p = a;
        let q = b;
        let fp = fa;
        for (let j = 0; j < 36; j += 1) {
          const m = (p + q) / 2;
          const fm = f(m);
          if (Number.isNaN(fm)) break;
          if (fp * fm <= 0) q = m;
          else {
            p = m;
            fp = fm;
          }
        }
        const v = (p + q) / 2;
        const pose = keyPose(k, { thetaDeg, u, v });
        const d = V.distance(pose.hand, handTarget);
        if (pose.reachable && (!best || d < best.d)) best = { v, d };
      }
      a = b;
      fa = fb;
    }
    return best;
  };
  let u = null;
  let fit = null;
  const steps = 36;
  for (let i = 0; i <= steps; i += 1) {
    const cu = uLo + ((uHi - uLo) * i) / steps;
    const r = onLine(cu);
    if (r && (!fit || r.d < fit.d)) {
      fit = r;
      u = cu;
    }
  }
  if (!fit) {
    // Only a tangent touch: take the hand where the club comes closest.
    let best = { r: Infinity };
    for (let i = 0; i <= steps; i += 1) {
      for (let j = 0; j <= 46; j += 1) {
        const cu = uLo + ((uHi - uLo) * i) / steps;
        const cv = vLo + ((vHi - vLo) * j) / 46;
        const r = Math.abs(reach(thetaDeg, cu, cv));
        if (r < best.r) best = { r, u: cu, v: cv };
      }
    }
    u = best.u;
    fit = { v: best.v };
  } else {
    let step = (uHi - uLo) / steps;
    while (step > 1e-5) {
      let moved = false;
      for (const cu of [u - step, u + step]) {
        if (cu < uLo || cu > uHi) continue;
        const r = onLine(cu);
        if (r && r.d < fit.d) {
          fit = r;
          u = cu;
          moved = true;
        }
      }
      if (!moved) step /= 2;
    }
  }
  k.thetaDeg = thetaDeg;
  k.u = u;
  k.v = fit.v;
  const hand = keyPose(k).hand;
  aimKey(k, V.sub(headTarget, hand));
  const pose = keyPose(k);
  k.faceDeg = squareFaceDeg(pose.handFrame, k);
  const headErr = V.distance(keyPose(k).club.head, headTarget);
  const handErr = V.distance(hand, handTarget);
  const eased = Math.abs(thetaDeg - stored) > 0.05 ? ` · turn ${thetaDeg.toFixed(0)}°` : '';
  return headErr > 0.005
    ? `head off by ${(headErr * 100).toFixed(1)} cm${eased}`
    : `on · hands ${(handErr * 100).toFixed(0)} cm apart${eased}`;
}

function applyParallel(keys, tag) {
  const k = keys[indexOf(keys, tag)];
  aimKey(k, V.vec(-1, 0, 0));
  return 'on';
}

const FIELDS = ['t', 'thetaDeg', 'u', 'v', 'cockDeg', 'bowDeg', 'faceDeg'];
const fields = (k) => FIELDS.map((f) => k[f]);

/**
 * The P1 and P7 solves take tens of milliseconds and run after every edit,
 * including every drag frame on keyframes they do not touch. So each remembers
 * the inputs it last left behind -- its keyframes, the ball, the club, the
 * handedness -- and does nothing while those have not moved.
 */
const memo = {};
function once(id, deps, solve) {
  if (memo[id]?.sig === JSON.stringify(deps())) return memo[id].status;
  const status = solve();
  memo[id] = { sig: JSON.stringify(deps()), status };
  return status;
}

/**
 * Impose every active constraint on the keyframes, in place.
 * @returns {{ changed: boolean, status: Object<string, string> }}
 */
export function applyConstraints(keys, active) {
  const before = keys.map(fields);
  const k1 = () => keys[indexOf(keys, 'P1')];
  const k7 = () => keys[indexOf(keys, 'P7')];
  const world = () => [ballPosition(), getClubLength(), getRig().H, getClub().id];
  const status = {};
  if (active.p1) status.p1 = once('p1', () => [fields(k1()), world()], () => applyP1(keys));
  if (active.p7) {
    status.p7 = once('p7', () => [fields(k1()), fields(k7()), world()], () => applyP7(keys));
  }
  if (active.p2) status.p2 = applyParallel(keys, 'P2');
  if (active.p6) status.p6 = applyParallel(keys, 'P6');
  const changed = keys.some((k, i) =>
    fields(k).some((x, j) => Math.abs(x - before[i][j]) > 1e-6),
  );
  return { changed, status };
}
