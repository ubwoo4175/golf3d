/**
 * The swing path: an editable keyframe track of (torso angle, hand u, hand v)
 * against normalised swing time t in [0, 1].
 *
 * The reference values approximate Rory McIlroy's sequencing -- a wide, low
 * takeaway, ~93 degrees of shoulder turn at the top, a deep transition where
 * the hands drop while the torso is already unwinding, and a long extension
 * through impact. They are hand-authored from published swing positions, not
 * motion capture, so treat them as a well-shaped starting point that you tune
 * by dragging.
 *
 * The keyframes honour the elbow rules by construction:
 *   backswing + downswing  lead hand distance stays ~REACH (lead elbow locked),
 *                          so all of the folding happens at the trail elbow
 *   through impact          the trail elbow is still extending, not yet straight
 *   follow-through          the lead elbow folds, the trail elbow stays extended
 */

import { rad } from './vec3.js';
import { TIMING, PLANE, REACH } from './config.js';
import { solvePose, SHOULDER_UV } from './kinematics.js';

export const PHASES = [
  { id: 'backswing', label: 'Backswing', start: 0, end: 0.55 },
  { id: 'downswing', label: 'Downswing', start: 0.55, end: 0.76 },
  { id: 'followThrough', label: 'Follow-through', start: 0.76, end: 1 },
];

export const phaseAt = (t) =>
  PHASES.find((p) => t <= p.end) ?? PHASES[PHASES.length - 1];

/**
 * How extended the lead arm is while it is "locked". Not 1.0: a real lead arm
 * keeps a few degrees of flex, and full extension would sit exactly on the
 * reach boundary where interpolation between keyframes tips out of range.
 */
export const LEAD_LOCK_RATIO = 0.99;

/**
 * The `v` that places the hand on the lead arm's locked-extension circle for a
 * given `u`. Deriving `v` rather than typing it is what guarantees the authored
 * backswing and downswing actually obey "lead elbow straight, trail elbow does
 * all the folding". The lower intersection is taken, i.e. hands below the
 * shoulder line.
 */
export function lockedLeadV(u, ratio = LEAD_LOCK_RATIO) {
  const target = ratio * REACH;
  const du = u - SHOULDER_UV.lead.u;
  const r2 = target * target - PLANE.offset * PLANE.offset - du * du;
  return -Math.sqrt(Math.max(0, r2));
}

/** Address through impact: lead elbow locked, so only (t, torso turn, u) is authored. */
const LEAD_LOCKED = [
  { t: 0.0, thetaDeg: 0, u: 0.0, label: 'Address (P1)' },
  { t: 0.13, thetaDeg: 15, u: -0.055, label: 'Takeaway (P2)' },
  { t: 0.27, thetaDeg: 40, u: -0.15, label: 'Lead arm horizontal (P3)' },
  { t: 0.42, thetaDeg: 70, u: -0.28, label: 'Shaft parallel (P4)' },
  { t: 0.55, thetaDeg: 93, u: -0.375, label: 'Top of backswing (P5)' },
  { t: 0.62, thetaDeg: 66, u: -0.345, label: 'Transition' },
  { t: 0.68, thetaDeg: 26, u: -0.255, label: 'Delivery (P6)' },
  { t: 0.72, thetaDeg: -8, u: -0.14, label: 'Pre-impact' },
  // Slightly trail-side of centre so the trail elbow still has flex left to
  // give: impact happens while it is extending, not after it has straightened.
  { t: 0.76, thetaDeg: -38, u: -0.01, label: 'Impact (P7)' },
];

/** Follow-through: the lead elbow folds, so `v` is authored directly. */
const LEAD_FOLDING = [
  { t: 0.82, thetaDeg: -60, u: 0.12, v: -0.47, label: 'Release (P8)' },
  { t: 0.9, thetaDeg: -80, u: 0.215, v: -0.33, label: 'Trail arm extended (P9)' },
  { t: 1.0, thetaDeg: -95, u: 0.3, v: 0.03, label: 'Finish (P10)' },
];

export const REFERENCE_KEYFRAMES = [
  ...LEAD_LOCKED.map((k) => ({ ...k, v: lockedLeadV(k.u) })),
  ...LEAD_FOLDING,
];

/**
 * Catmull-Rom tangent for a non-uniformly spaced scalar track.
 * Endpoints fall back to a one-sided difference.
 */
function tangent(keys, i, get) {
  const prev = keys[i - 1];
  const next = keys[i + 1];
  const cur = keys[i];
  if (!prev) return (get(next) - get(cur)) / (next.t - cur.t);
  if (!next) return (get(cur) - get(prev)) / (cur.t - prev.t);
  return (get(next) - get(prev)) / (next.t - prev.t);
}

function hermite(keys, i, localT, span, get) {
  const a = keys[i];
  const b = keys[i + 1];
  const m0 = tangent(keys, i, get) * span;
  const m1 = tangent(keys, i + 1, get) * span;
  const t2 = localT * localT;
  const t3 = t2 * localT;
  return (
    (2 * t3 - 3 * t2 + 1) * get(a) +
    (t3 - 2 * t2 + localT) * m0 +
    (-2 * t3 + 3 * t2) * get(b) +
    (t3 - t2) * m1
  );
}

/**
 * An editable swing. Emits a change event whenever a keyframe moves so both
 * views and the cached path can refresh.
 */
export class SwingPath {
  constructor(keyframes = REFERENCE_KEYFRAMES) {
    this.reset(keyframes);
    this.listeners = new Set();
  }

  reset(keyframes = REFERENCE_KEYFRAMES) {
    this.keys = keyframes.map((k) => ({ ...k }));
    this.cache = null;
    this.emit();
  }

  onChange(fn) {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  emit() {
    this.cache = null;
    this.listeners?.forEach((fn) => fn(this));
  }

  /** Move one keyframe's hand position. Time and torso angle are untouched. */
  setKeyframeHand(index, u, v) {
    const key = this.keys[index];
    if (!key || (key.u === u && key.v === v)) return;
    key.u = u;
    key.v = v;
    this.emit();
  }

  /** Index of the keyframe closest in time to `t`. */
  nearestKeyframeIndex(t) {
    let best = 0;
    let bestDist = Infinity;
    this.keys.forEach((k, i) => {
      const d = Math.abs(k.t - t);
      if (d < bestDist) {
        bestDist = d;
        best = i;
      }
    });
    return best;
  }

  /** Interpolated driving values at normalised time `t`. */
  sample(t) {
    const keys = this.keys;
    const clamped = Math.min(Math.max(t, keys[0].t), keys[keys.length - 1].t);
    let i = 0;
    while (i < keys.length - 2 && keys[i + 1].t < clamped) i += 1;
    const span = keys[i + 1].t - keys[i].t || 1e-6;
    const localT = (clamped - keys[i].t) / span;
    return {
      theta: rad(hermite(keys, i, localT, span, (k) => k.thetaDeg)),
      thetaDeg: hermite(keys, i, localT, span, (k) => k.thetaDeg),
      u: hermite(keys, i, localT, span, (k) => k.u),
      v: hermite(keys, i, localT, span, (k) => k.v),
    };
  }

  poseAt(t) {
    return solvePose(this.sample(t));
  }

  /**
   * Densely sampled path, cached until a keyframe moves.
   * `local` is the 2D hand trace on the torso plane, `world` the 3D trace.
   */
  sampledPath() {
    if (this.cache) return this.cache;
    const n = TIMING.pathSamples;
    const local = [];
    const world = [];
    for (let i = 0; i < n; i += 1) {
      const t = i / (n - 1);
      const d = this.sample(t);
      const pose = solvePose(d);
      local.push({ t, u: d.u, v: d.v, phase: phaseAt(t).id });
      world.push({ t, p: pose.hand, phase: phaseAt(t).id });
    }
    this.cache = { local, world };
    return this.cache;
  }
}
