/**
 * One tiny observable store. Both views subscribe to it, which is what keeps
 * the 2D plane and the 3D scene synchronised: there is only ever one `t`.
 */

import { TIMING, DEFAULT_HANDEDNESS, BODY } from './config.js';

export class Store {
  constructor(swing) {
    this.swing = swing;
    this.state = {
      t: 0,
      playing: false,
      speed: TIMING.defaultSpeed,
      /** Index of the keyframe currently being dragged, or null. */
      dragging: null,
      /** 'right' | 'left'. Mirrors the whole rig; see kinematics.setHandedness. */
      handedness: DEFAULT_HANDEDNESS,
      /** Forward spine tilt in degrees; stands in for club length. */
      spineTilt: BODY.spineTiltForwardDeg,
      showPath: true,
      showPlane: true,
      showLocalPath: true,
      showGuides: true,
    };
    this.listeners = new Set();
  }

  subscribe(fn) {
    this.listeners.add(fn);
    fn(this.state);
    return () => this.listeners.delete(fn);
  }

  set(patch) {
    let changed = false;
    for (const [k, value] of Object.entries(patch)) {
      if (this.state[k] !== value) {
        this.state[k] = value;
        changed = true;
      }
    }
    if (changed) this.listeners.forEach((fn) => fn(this.state));
  }

  /** Advance playback by `dt` seconds, looping at the finish. */
  tick(dt) {
    if (!this.state.playing) return;
    const step = (dt * this.state.speed) / TIMING.swingSeconds;
    let t = this.state.t + step;
    if (t > 1) t -= 1;
    this.set({ t });
  }

  seekKeyframe(index) {
    const key = this.swing.keys[index];
    if (key) this.set({ t: key.t, playing: false });
  }

  stepKeyframe(direction) {
    const current = this.swing.nearestKeyframeIndex(this.state.t);
    const key = this.swing.keys[current];
    // If we are between keyframes, `nearest` is already the move target in the
    // direction we came from; otherwise advance by one.
    const atKey = key && Math.abs(key.t - this.state.t) < 1e-4;
    const next = atKey ? current + direction : current;
    this.seekKeyframe(Math.min(Math.max(next, 0), this.swing.keys.length - 1));
  }
}
