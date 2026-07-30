/**
 * Minimal dependency-free 3D vector helpers.
 *
 * Vectors are plain `{x, y, z}` objects and every function is pure, so the
 * kinematics layer stays independent of any rendering library. The Three.js
 * view converts to `THREE.Vector3` only at the boundary.
 */

export const vec = (x = 0, y = 0, z = 0) => ({ x, y, z });

export const add = (a, b) => ({ x: a.x + b.x, y: a.y + b.y, z: a.z + b.z });
export const sub = (a, b) => ({ x: a.x - b.x, y: a.y - b.y, z: a.z - b.z });
export const scale = (a, s) => ({ x: a.x * s, y: a.y * s, z: a.z * s });

/** a + b * s -- the workhorse for building points from a basis. */
export const addScaled = (a, b, s) => ({
  x: a.x + b.x * s,
  y: a.y + b.y * s,
  z: a.z + b.z * s,
});

export const dot = (a, b) => a.x * b.x + a.y * b.y + a.z * b.z;

export const cross = (a, b) => ({
  x: a.y * b.z - a.z * b.y,
  y: a.z * b.x - a.x * b.z,
  z: a.x * b.y - a.y * b.x,
});

export const length = (a) => Math.hypot(a.x, a.y, a.z);
export const distance = (a, b) => length(sub(a, b));

export function normalize(a) {
  const len = length(a);
  return len > 1e-9 ? scale(a, 1 / len) : vec(0, 0, 0);
}

/** Component of `a` orthogonal to the unit vector `unitAxis`. */
export const reject = (a, unitAxis) => sub(a, scale(unitAxis, dot(a, unitAxis)));

/** Rotate `p` about the unit vector `axis` by `angle` radians (Rodrigues). */
export function rotateAbout(p, axis, angle) {
  const c = Math.cos(angle);
  const s = Math.sin(angle);
  const k = cross(axis, p);
  const d = dot(axis, p) * (1 - c);
  return {
    x: p.x * c + k.x * s + axis.x * d,
    y: p.y * c + k.y * s + axis.y * d,
    z: p.z * c + k.z * s + axis.z * d,
  };
}

export function rotateX(p, a) {
  const c = Math.cos(a);
  const s = Math.sin(a);
  return { x: p.x, y: p.y * c - p.z * s, z: p.y * s + p.z * c };
}

export function rotateZ(p, a) {
  const c = Math.cos(a);
  const s = Math.sin(a);
  return { x: p.x * c - p.y * s, y: p.x * s + p.y * c, z: p.z };
}

export const deg = (radians) => (radians * 180) / Math.PI;
export const rad = (degrees) => (degrees * Math.PI) / 180;
export const clamp = (x, lo, hi) => (x < lo ? lo : x > hi ? hi : x);
