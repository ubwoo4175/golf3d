/**
 * The club, and the wrist that aims it.
 *
 * The hand is one point in this model, so the club is not a separate linkage --
 * it is an orientation. Three numbers, all measured in the hand frame that
 * `pose.js` builds from the two forearms:
 *
 *   cockDeg   hinge of the shaft away from the forearm, in the plane of the two
 *             forearms. This is the big one: the wrist cock that sets the club.
 *   bowDeg    the same hinge, but out of that plane -- the bow/cup component.
 *   faceDeg   roll about the shaft's own axis, + opens the face. Zeroed by
 *             `CLUB.faceZeroDeg` so that 0 means square at address.
 *
 * (cock, bow) is the EXPONENTIAL MAP of the direction sphere about the forearm
 * axis: the total hinge is `hypot(cock, bow)` degrees and its compass direction
 * is `atan2(bow, cock)`. Two properties earn it its place:
 *
 *   - It is a bijection onto the sphere (minus the far pole), so the wrist view
 *     can drag it directly. An orthographic projection would have been
 *     two-to-one and needed a hidden sign bit to disambiguate.
 *   - It is NON-SINGULAR at zero hinge, where the equivalent polar chart
 *     (hinge, azimuth) is not. That is not a fine point: with the polar form the
 *     solved azimuths jumped by up to 270 degrees between neighbouring
 *     keyframes -- the club spun through nonsense between checkpoints -- purely
 *     because azimuth is ill-conditioned when the hinge is small, which at
 *     address and at release it is. In (cock, bow) those same keyframes are a
 *     few degrees apart and interpolate cleanly.
 *
 * Nothing here knows about time or rendering.
 */

import * as V from './vec3.js';
import { CLUB, CLUBS, DEFAULT_CLUB } from './config.js';

/** A neutral wrist: shaft in line with the arm, face unrolled. */
export const WRIST_ZERO = { cockDeg: 0, bowDeg: 0, faceDeg: 0 };

/**
 * Hand-to-clubhead distance.
 *
 * Not a config constant and not a slider: it is SOLVED from the address pose, as
 * the distance from the address hand to the ball, so the head sits on the ball at
 * address by construction. That makes the spine slider do double duty exactly as
 * it already claims to -- bend further for a wedge and the club that reaches the
 * ball is shorter -- and it keeps following if you drag P1 somewhere else.
 *
 * Same pattern as the rectangle offset in rig.js: `main.js` pins it to P1 on
 * every change. `CLUB.defaultLength` is only the value before that first sync.
 */
let clubLength = CLUB.defaultLength;

export const setClubLength = (metres) => {
  clubLength = metres;
};

export const getClubLength = () => clubLength;

/**
 * The lie angle, which is what fixes the HEAD on the end of the shaft.
 *
 * The head is not square to the shaft -- if it were, the club would be a hammer,
 * which is exactly what it looked like. The sole runs at the lie angle to the
 * shaft, measured on the HEEL side, so the toe-to-heel axis sits `180 - lie`
 * degrees round from the shaft's own direction. Kept here rather than read from
 * `rig.js` so this module stays free of the rig; `main.js` pins it alongside the
 * length whenever the club changes.
 */
let clubLie = (CLUBS.find((c) => c.id === DEFAULT_CLUB) ?? CLUBS[0]).lieDeg;

export const setClubLie = (deg) => {
  clubLie = deg;
};

export const getClubLie = () => clubLie;

/** Total hinge away from the forearm axis, degrees. */
export const hingeOf = (cockDeg, bowDeg) => Math.hypot(cockDeg, bowDeg);

/**
 * Shaft direction from the wrist angles.
 *
 * Read (cock, bow) as polar: tip the forearm axis `f` by `hinge` toward the
 * compass direction the pair points in within the (r, n) plane.
 *
 *     a = r cos(az) + n sin(az)          the hinge direction
 *     d = f cos(hinge) + a sin(hinge)    the shaft
 *
 * At zero hinge `a` is undefined but irrelevant -- sin(hinge) is zero, so the
 * shaft is just `f`. That is exactly the singularity the (cock, bow) form keeps
 * out of the stored track.
 */
export function shaftDirection(frame, cockDeg, bowDeg) {
  const hingeDeg = hingeOf(cockDeg, bowDeg);
  const hinge = V.rad(hingeDeg);
  if (hingeDeg < 1e-9) return frame.f;
  const a = V.addScaled(
    V.scale(frame.r, cockDeg / hingeDeg),
    frame.n,
    bowDeg / hingeDeg,
  );
  return V.normalize(V.addScaled(V.scale(frame.f, Math.cos(hinge)), a, Math.sin(hinge)));
}

/**
 * The inverse: which (cock, bow) aims the shaft along a world direction. Used to
 * SOLVE the default swing, since several P positions are defined by where the
 * shaft points rather than by what the wrist is doing.
 */
export function wristForDirection(frame, dir) {
  const d = V.normalize(dir);
  const hingeDeg = V.deg(Math.acos(V.clamp(V.dot(d, frame.f), -1, 1)));
  const az = Math.atan2(V.dot(d, frame.n), V.dot(d, frame.r));
  return { cockDeg: hingeDeg * Math.cos(az), bowDeg: hingeDeg * Math.sin(az) };
}

/**
 * Carry a vector along with the shaft as the wrist hinges.
 *
 * The face needs a reference direction perpendicular to the shaft, and any FIXED
 * reference degenerates the moment the shaft lines up with it -- which the shaft
 * does, at hinge 0. So the reference is parallel-transported instead: apply to it
 * the same minimal rotation that carries the forearm axis onto the shaft. That is
 * smooth everywhere except a 180 degree fold, which no wrist reaches.
 */
function transport(frame, dir, vector) {
  const axis = V.cross(frame.f, dir);
  const sin = V.length(axis);
  if (sin < 1e-9) return vector; // shaft already along the forearm: identity
  const angle = Math.atan2(sin, V.dot(frame.f, dir));
  return V.rotateAbout(vector, V.scale(axis, 1 / sin), angle);
}

/**
 * Where the club is and which way it looks.
 *
 * @param frame  the hand frame from `pose.handFrame`
 * @param wrist  { hingeDeg, azimuthDeg, faceDeg }
 * @param length hand-to-head distance; defaults to the configured club
 */
export function solveClub(frame, wrist = WRIST_ZERO, length = clubLength) {
  const { cockDeg = 0, bowDeg = 0, faceDeg = 0 } = wrist ?? {};
  const H = frame.H ?? 1;
  const shaftDir = shaftDirection(frame, cockDeg, bowDeg);

  // Face reference: the forearm-plane normal, carried along with the shaft, then
  // rolled by the face angle about the shaft itself.
  //
  // The roll is signed by handedness. A left-hander is the mirror image of a
  // right-hander, and a mirror reverses the sense of a rotation -- so the same
  // stored `faceDeg` has to turn the face the other way round the shaft, or the
  // lefty addresses the ball with the BACK of the club. It read 174 degrees off
  // square before this.
  const faceRef = transport(frame, shaftDir, frame.n);
  const faceNormal = V.normalize(
    V.rotateAbout(faceRef, shaftDir, V.rad(H * (CLUB.faceZeroDeg + faceDeg))),
  );

  // The head's own axes. Both lie in the FACE PLANE -- the plane the shaft leans
  // in when the club is soled -- which is why they are built off `faceNormal`.
  //
  //   across  perpendicular to the shaft within that plane, pointing to the toe
  //           side. `cross(shaftDir, faceNormal)` and not the other order: that
  //           is the sign that points AWAY from the golfer at address, which is
  //           where the head has to stick out. Signed by handedness, since a
  //           cross product comes back negated under the mirror.
  //   toe     the sole line, at the lie angle to the shaft. The lie is measured
  //           on the heel side, so the toe is `180 - lie` round from `shaftDir`:
  //               toe = shaft cos(lie) + across sin(lie)
  //           Square to the shaft -- the old behaviour -- is the lie = 90 case,
  //           and it is what made the head read as a hammerhead.
  //   crown   sole to crown, completing the frame.
  const across = V.scale(V.normalize(V.cross(shaftDir, faceNormal)), H);
  const lie = V.rad(clubLie);
  const toe = V.normalize(
    V.addScaled(V.scale(shaftDir, Math.cos(lie)), across, Math.sin(lie)),
  );
  const crown = V.scale(V.normalize(V.cross(toe, faceNormal)), H);

  return {
    cockDeg,
    bowDeg,
    faceDeg,
    hingeDeg: hingeOf(cockDeg, bowDeg),
    length,
    shaftDir,
    /** Butt end, a short way back up the shaft from the hands. */
    butt: V.addScaled(frame.origin, shaftDir, -CLUB.buttBeyondHands),
    /** Middle of the face: the point that meets the ball, and the head's trace. */
    head: V.addScaled(frame.origin, shaftDir, length),
    faceNormal,
    toe,
    crown,
    lieDeg: clubLie,
  };
}

/**
 * Face angle relative to square, in degrees, + open.
 *
 * Square means the face normal points down the target line (+X for either
 * handedness). Only meaningful near address and impact, where the club is
 * actually pointing at the ball, so the readout is labelled accordingly.
 */
export function faceAngleToTarget(club, H = 1) {
  // Measure in the horizontal plane: the face's aim, ignoring loft and lie.
  const n = club.faceNormal;
  return V.deg(Math.atan2(H * n.z, n.x));
}
