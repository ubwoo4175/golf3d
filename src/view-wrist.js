/**
 * Wrist view: the club's direction, seen from the wrist.
 *
 * The hand is pinned at the origin near the bottom of the panel and never moves
 * -- this view says nothing about WHERE the hands are, only about what the club
 * is doing relative to them. The rest of the app already covers the first part.
 *
 * THE CHART. It is polar, centred on the hand, in the frame of the lead forearm:
 *
 *   distance from the hand   the total hinge between the shaft and the forearm.
 *                            0 at the centre (club in line with the arm), and the
 *                            rings mark 30 / 60 / 90 / 120 degrees.
 *   direction from the hand  which way it hinges. Horizontal is a wrist cock in
 *                            the plane of the two forearms; vertical is bow/cup
 *                            out of that plane.
 *
 * So the line drawn from the centre to the handle IS the shaft, in the only
 * projection where a 2D drag maps one-to-one onto a 3D direction. The Cartesian
 * coordinates of the handle are exactly the stored `(cockDeg, bowDeg)` channels
 * -- see the exponential-map note in club.js for why the pair is stored that way
 * round rather than as (hinge, azimuth).
 *
 * THE DIAL, bottom left, is the third degree of freedom: roll about the shaft's
 * own axis, which turns the clubface. It needs its own control because it is not
 * a direction at all and has nowhere to live on the direction chart.
 */

import { COLORS } from './config.js';
import { getRig } from './rig.js';
import { hingeOf } from './club.js';
import { phaseAt, RELEASE_T } from './swing.js';
import { Canvas2D } from './canvas2d.js';
import { clamp } from './vec3.js';

const GRAB_RADIUS_PX = 14;
/** Chart bounds in degrees. Wide enough for the default swing plus headroom. */
const BOUNDS = { xMin: -80, xMax: 80, yMin: -45, yMax: 170 };
const RINGS = [30, 60, 90, 120, 150];
const DIAL_RADIUS = 30;
const DIAL_INSET = 46;

export class WristView extends Canvas2D {
  constructor(canvas, store, swing) {
    super(canvas);
    this.store = store;
    this.swing = swing;
    /** 'hinge' while dragging the shaft, 'face' while dragging the dial. */
    this.mode = null;
    this.resize();
    this.bind();
  }

  layout() {
    // Same mirror as the hand view, so a cock toward the trail side falls on the
    // same side of the screen in both panels.
    this.fitBox(BOUNDS, -getRig().H);
    this.dial = { x: DIAL_INSET, y: this.h - DIAL_INSET };
  }

  /** The keyframe this panel is currently editing. */
  activeIndex() {
    return this.swing.nearestKeyframeIndex(this.store.state.t);
  }

  pickKeyframe(x, y) {
    let best = null;
    let bestDist = GRAB_RADIUS_PX;
    this.swing.keys.forEach((k, i) => {
      const p = this.toPx(k.cockDeg, k.bowDeg);
      const d = Math.hypot(p.x - x, p.y - y);
      if (d <= bestDist) {
        bestDist = d;
        best = i;
      }
    });
    return best;
  }

  onDial(x, y) {
    return Math.hypot(x - this.dial.x, y - this.dial.y) <= DIAL_RADIUS + 10;
  }

  bind() {
    this.bindPointer({
      onDown: (x, y) => {
        if (this.onDial(x, y)) {
          this.mode = 'face';
          this.index = this.activeIndex();
        } else {
          this.mode = 'hinge';
          this.index = this.pickKeyframe(x, y) ?? this.activeIndex();
        }
        this.store.set({ t: this.swing.keys[this.index].t, playing: false });
        return true;
      },
      onDrag: (x, y) => {
        if (this.mode === 'face') {
          // The dial reads as a compass: the angle from its centre is the roll.
          const deg = (Math.atan2(this.dial.y - y, x - this.dial.x) * 180) / Math.PI;
          this.swing.setKeyframeWrist(this.index, { faceDeg: Math.round(90 - deg) });
        } else {
          const { x: cock, y: bow } = this.fromPx(x, y);
          this.swing.setKeyframeWrist(this.index, {
            cockDeg: clamp(cock, BOUNDS.xMin, BOUNDS.xMax),
            bowDeg: clamp(bow, BOUNDS.yMin, BOUNDS.yMax),
          });
        }
      },
      onUp: () => {
        this.mode = null;
      },
      onHover: (x, y) => {
        const hit = this.onDial(x, y) ? 'dial' : this.pickKeyframe(x, y);
        if (hit !== this.hover) {
          this.hover = hit;
          this.setCursor(hit === null ? 'crosshair' : 'grab');
        }
      },
    });
  }

  // --- drawing -------------------------------------------------------------

  draw(pose) {
    this.clear();
    this.drawChart();
    if (this.store.state.showPath) this.drawTrack();
    this.drawKeyframes();
    this.drawShaft(pose);
    this.drawDial(pose);
  }

  drawChart() {
    const ctx = this.ctx;
    const o = this.toPx(0, 0);
    const { scale } = this.viewport;

    ctx.strokeStyle = 'rgba(255,255,255,0.07)';
    ctx.lineWidth = 1;
    for (const deg of RINGS) {
      ctx.beginPath();
      ctx.arc(o.x, o.y, deg * scale, 0, Math.PI * 2);
      ctx.stroke();
    }
    // Spokes every 30 degrees of hinge azimuth.
    ctx.beginPath();
    for (let a = 0; a < 360; a += 30) {
      const r = RINGS[RINGS.length - 1] * scale;
      ctx.moveTo(o.x, o.y);
      ctx.lineTo(o.x + r * Math.cos((a * Math.PI) / 180), o.y - r * Math.sin((a * Math.PI) / 180));
    }
    ctx.strokeStyle = 'rgba(255,255,255,0.04)';
    ctx.stroke();

    for (const deg of RINGS) {
      this.label(`${deg}°`, o.x + 4, o.y - deg * scale - 3, { align: 'left', color: 'rgba(255,255,255,0.28)' });
    }

    const sides = getRig().sides;
    this.label(`← cock (${sides.trail} side)     cock (${sides.lead} side) →`, this.w / 2, this.h - 10);
    ctx.save();
    ctx.translate(14, this.h / 2);
    ctx.rotate(-Math.PI / 2);
    this.label('bow  ←   →  cup', 0, 0);
    ctx.restore();
  }

  /** The interpolated wrist track, phase-coloured like the other views. */
  drawTrack() {
    const ctx = this.ctx;
    const n = 240;
    ctx.lineWidth = 2;
    ctx.lineCap = 'round';
    let prev = null;
    for (let i = 0; i <= n; i += 1) {
      const t = i / n;
      const w = this.swing.sample(t).wrist;
      const p = this.toPx(w.cockDeg, w.bowDeg);
      if (prev) {
        ctx.strokeStyle = COLORS[phaseAt(t).id];
        ctx.beginPath();
        ctx.moveTo(prev.x, prev.y);
        ctx.lineTo(p.x, p.y);
        ctx.stroke();
      }
      prev = p;
    }
  }

  drawKeyframes() {
    const ctx = this.ctx;
    const active = this.activeIndex();
    this.swing.keys.forEach((k, i) => {
      const p = this.toPx(k.cockDeg, k.bowDeg);
      const lit = i === active || i === this.hover;
      if (Math.abs(k.t - RELEASE_T) < 1e-6) {
        ctx.strokeStyle = 'rgba(255,255,255,0.7)';
        ctx.lineWidth = 1.2;
        ctx.beginPath();
        ctx.arc(p.x, p.y, 10, 0, Math.PI * 2);
        ctx.stroke();
      }
      ctx.fillStyle = COLORS[phaseAt(k.t).id];
      ctx.strokeStyle = lit ? '#ffffff' : 'rgba(0,0,0,0.6)';
      ctx.lineWidth = lit ? 2 : 1;
      ctx.beginPath();
      ctx.arc(p.x, p.y, lit ? 6 : 4, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();
      if (lit) this.label(k.label, p.x + 12, p.y - 14, { align: 'left', color: '#ffffff' });
    });
  }

  /** The shaft itself: centre to handle, with a clubhead at the far end. */
  drawShaft(pose) {
    const ctx = this.ctx;
    const { cockDeg, bowDeg, faceDeg } = pose.wrist;
    const o = this.toPx(0, 0);
    const p = this.toPx(cockDeg, bowDeg);

    ctx.strokeStyle = 'rgba(230,238,248,0.85)';
    ctx.lineWidth = 3;
    ctx.lineCap = 'round';
    ctx.beginPath();
    ctx.moveTo(o.x, o.y);
    ctx.lineTo(p.x, p.y);
    ctx.stroke();

    // The hand, pinned at the origin.
    ctx.fillStyle = COLORS.hand;
    ctx.beginPath();
    ctx.arc(o.x, o.y, 7, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = 'rgba(0,0,0,0.7)';
    ctx.lineWidth = 2;
    ctx.stroke();
    this.label('hand', o.x - 26, o.y + 5, { align: 'right', color: 'rgba(255,255,255,0.55)' });

    // The clubhead, drawn as the leading edge so the face roll is visible here
    // too. Its screen angle is the shaft's plus the roll -- an indicator, not a
    // projection, since a roll about the shaft has no direction on this chart.
    const shaftAngle = Math.atan2(p.y - o.y, p.x - o.x);
    const a = shaftAngle + Math.PI / 2 + (faceDeg * Math.PI) / 180;
    const half = 11;
    ctx.strokeStyle = COLORS.face;
    ctx.lineWidth = 4;
    ctx.beginPath();
    ctx.moveTo(p.x - half * Math.cos(a), p.y - half * Math.sin(a));
    ctx.lineTo(p.x + half * Math.cos(a), p.y + half * Math.sin(a));
    ctx.stroke();

    // Read out in the bottom corner rather than beside the handle: next to the
    // handle it collided with the keyframe label, and the top of the canvas is
    // under the pane title, which is absolutely positioned over it.
    this.label(
      `hinge ${hingeOf(cockDeg, bowDeg).toFixed(0)}°  cock ${cockDeg.toFixed(0)}  bow ${bowDeg.toFixed(0)}`,
      this.w - 12,
      this.h - 28,
      { align: 'right', color: 'rgba(255,255,255,0.7)' },
    );
  }

  /** Face roll dial: drag it round to open or close the face. */
  drawDial(pose) {
    const ctx = this.ctx;
    const { x, y } = this.dial;
    const roll = pose.wrist.faceDeg;
    const lit = this.hover === 'dial' || this.mode === 'face';

    ctx.beginPath();
    ctx.arc(x, y, DIAL_RADIUS, 0, Math.PI * 2);
    ctx.fillStyle = 'rgba(16,23,37,0.9)';
    ctx.fill();
    ctx.strokeStyle = lit ? 'rgba(255,255,255,0.6)' : 'rgba(255,255,255,0.22)';
    ctx.lineWidth = lit ? 2 : 1;
    ctx.stroke();

    // Square is straight up, so the needle reads like a clock hand.
    const a = (90 - roll) * (Math.PI / 180);
    ctx.strokeStyle = COLORS.face;
    ctx.lineWidth = 3;
    ctx.lineCap = 'round';
    ctx.beginPath();
    ctx.moveTo(x, y);
    ctx.lineTo(x + DIAL_RADIUS * 0.8 * Math.cos(a), y - DIAL_RADIUS * 0.8 * Math.sin(a));
    ctx.stroke();

    ctx.strokeStyle = 'rgba(255,255,255,0.3)';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(x, y - DIAL_RADIUS);
    ctx.lineTo(x, y - DIAL_RADIUS + 6);
    ctx.stroke();

    this.label(
      `face ${roll >= 0 ? '+' : ''}${roll.toFixed(0)}°`,
      x,
      y + DIAL_RADIUS + 15,
      { color: lit ? '#ffffff' : 'rgba(255,255,255,0.55)' },
    );
  }
}
