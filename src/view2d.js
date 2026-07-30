/**
 * 2D view: the hand plane seen head-on, from in front of the golfer.
 *
 * This is the torso-fixed frame, so the shoulders and the elbow line are almost
 * stationary here while the whole rectangle spins in the 3D view. Horizontal is
 * the shoulder/elbow line (u, positive toward the lead side), vertical is the
 * spine axis (v, positive toward the head).
 *
 * Dragging edits the swing: grabbing a keyframe handle snaps the timeline to it
 * and moves it, so the 3D path reshapes live.
 */

import { PLANE, COLORS } from './config.js';
import { straightArmLocus, SHOULDER_UV, worldToPlane } from './kinematics.js';
import { phaseAt } from './swing.js';
import { clamp } from './vec3.js';

const GRAB_RADIUS_PX = 14;
const MARGIN = 34;

export class PlaneView {
  constructor(canvas, store, swing) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d');
    this.store = store;
    this.swing = swing;
    this.hover = null;
    this.viewport = { scale: 1, ox: 0, oy: 0 };

    this.resize();
    this.bindPointer();
  }

  resize() {
    // Measure the canvas's own box, never the parent's: flex decides the
    // canvas height, and the CSS size must match the backing store or pointer
    // coordinates and drawn coordinates drift apart.
    const dpr = window.devicePixelRatio || 1;
    const rect = this.canvas.getBoundingClientRect();
    this.w = Math.max(1, rect.width);
    this.h = Math.max(1, rect.height);
    this.canvas.width = Math.round(this.w * dpr);
    this.canvas.height = Math.round(this.h * dpr);
    this.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

    const spanU = PLANE.uMax - PLANE.uMin;
    const spanV = PLANE.vMax - PLANE.vMin;
    const scale = Math.min((this.w - 2 * MARGIN) / spanU, (this.h - 2 * MARGIN) / spanV);
    // Screen y is inverted so +v points up. Centre the rectangle in the canvas.
    this.viewport = {
      scale,
      ox: (this.w - spanU * scale) / 2 - PLANE.uMin * scale,
      oy: (this.h - spanV * scale) / 2 + PLANE.vMax * scale,
    };
  }

  toPx(u, v) {
    const { scale, ox, oy } = this.viewport;
    return { x: ox + u * scale, y: oy - v * scale };
  }

  toPlane(x, y) {
    const { scale, ox, oy } = this.viewport;
    return { u: (x - ox) / scale, v: (oy - y) / scale };
  }

  pointerToCanvas(event) {
    const rect = this.canvas.getBoundingClientRect();
    return { x: event.clientX - rect.left, y: event.clientY - rect.top };
  }

  /** Keyframe handle under the cursor, if any. */
  pickKeyframe(x, y) {
    let best = null;
    let bestDist = GRAB_RADIUS_PX;
    this.swing.keys.forEach((k, i) => {
      const p = this.toPx(k.u, k.v);
      const d = Math.hypot(p.x - x, p.y - y);
      if (d <= bestDist) {
        bestDist = d;
        best = i;
      }
    });
    return best;
  }

  bindPointer() {
    const onDown = (event) => {
      const { x, y } = this.pointerToCanvas(event);
      // A hit on a handle grabs it; anywhere else grabs the keyframe nearest in
      // time, so a plain drag always moves the pose you are looking at.
      const index = this.pickKeyframe(x, y) ?? this.swing.nearestKeyframeIndex(this.store.state.t);
      this.store.set({ t: this.swing.keys[index].t, playing: false, dragging: index });
      this.canvas.setPointerCapture(event.pointerId);
      this.applyDrag(x, y);
    };

    const onMove = (event) => {
      const { x, y } = this.pointerToCanvas(event);
      if (this.store.state.dragging !== null) {
        this.applyDrag(x, y);
      } else {
        const hit = this.pickKeyframe(x, y);
        if (hit !== this.hover) {
          this.hover = hit;
          this.canvas.style.cursor = hit === null ? 'crosshair' : 'grab';
        }
      }
    };

    const onUp = (event) => {
      if (this.store.state.dragging !== null) this.store.set({ dragging: null });
      if (this.canvas.hasPointerCapture?.(event.pointerId)) {
        this.canvas.releasePointerCapture(event.pointerId);
      }
    };

    this.canvas.addEventListener('pointerdown', onDown);
    this.canvas.addEventListener('pointermove', onMove);
    this.canvas.addEventListener('pointerup', onUp);
    this.canvas.addEventListener('pointercancel', onUp);
    this.canvas.addEventListener('pointerleave', () => {
      this.hover = null;
    });
  }

  applyDrag(x, y) {
    const index = this.store.state.dragging;
    if (index === null) return;
    const { u, v } = this.toPlane(x, y);
    this.swing.setKeyframeHand(
      index,
      clamp(u, PLANE.uMin, PLANE.uMax),
      clamp(v, PLANE.vMin, PLANE.vMax),
    );
  }

  // --- drawing -------------------------------------------------------------

  draw(pose) {
    const ctx = this.ctx;
    const { showPath, showGuides } = this.store.state;

    ctx.clearRect(0, 0, this.w, this.h);
    this.drawRectangle(showGuides);
    if (showGuides) this.drawStraightArmCircles();
    this.drawAxes();
    if (showPath) this.drawPath();
    this.drawTriangle(pose);
    this.drawElbowLine(pose);
    this.drawKeyframes();
    this.drawHand(pose);
  }

  rectPath(ctx) {
    const a = this.toPx(PLANE.uMin, PLANE.vMax);
    const b = this.toPx(PLANE.uMax, PLANE.vMin);
    ctx.beginPath();
    ctx.rect(a.x, a.y, b.x - a.x, b.y - a.y);
  }

  drawRectangle(shadeUnreachable) {
    const ctx = this.ctx;
    this.rectPath(ctx);
    ctx.fillStyle = shadeUnreachable ? COLORS.unreachable : '#101725';
    ctx.fill();

    if (shadeUnreachable) {
      // The reachable region is the intersection of the two arm-reach disks;
      // successive clips intersect, so paint the base colour through both.
      ctx.save();
      this.rectPath(ctx);
      ctx.clip();
      for (const which of ['lead', 'trail']) {
        const c = straightArmLocus(which);
        const p = this.toPx(c.u, c.v);
        ctx.beginPath();
        ctx.arc(p.x, p.y, c.radius * this.viewport.scale, 0, Math.PI * 2);
        ctx.clip();
      }
      ctx.fillStyle = '#101725';
      ctx.fillRect(0, 0, this.w, this.h);
      ctx.restore();
    }

    // Metric grid every 10 cm.
    ctx.save();
    this.rectPath(ctx);
    ctx.clip();
    ctx.strokeStyle = 'rgba(255,255,255,0.05)';
    ctx.lineWidth = 1;
    ctx.beginPath();
    for (let u = Math.ceil(PLANE.uMin * 10) / 10; u <= PLANE.uMax; u += 0.1) {
      const p = this.toPx(u, PLANE.vMin);
      const q = this.toPx(u, PLANE.vMax);
      ctx.moveTo(p.x, p.y);
      ctx.lineTo(q.x, q.y);
    }
    for (let v = Math.ceil(PLANE.vMin * 10) / 10; v <= PLANE.vMax; v += 0.1) {
      const p = this.toPx(PLANE.uMin, v);
      const q = this.toPx(PLANE.uMax, v);
      ctx.moveTo(p.x, p.y);
      ctx.lineTo(q.x, q.y);
    }
    ctx.stroke();
    ctx.restore();

    this.rectPath(ctx);
    ctx.strokeStyle = 'rgba(74,163,255,0.5)';
    ctx.lineWidth = 1.5;
    ctx.stroke();
  }

  drawStraightArmCircles() {
    const ctx = this.ctx;
    ctx.save();
    this.rectPath(ctx);
    ctx.clip();
    ctx.setLineDash([5, 5]);
    ctx.lineWidth = 1.2;
    for (const which of ['lead', 'trail']) {
      const c = straightArmLocus(which);
      const p = this.toPx(c.u, c.v);
      ctx.strokeStyle = which === 'lead' ? 'rgba(120,240,190,0.55)' : 'rgba(255,140,140,0.45)';
      ctx.beginPath();
      ctx.arc(p.x, p.y, c.radius * this.viewport.scale, 0, Math.PI * 2);
      ctx.stroke();
    }
    ctx.restore();
  }

  drawAxes() {
    const ctx = this.ctx;
    ctx.setLineDash([3, 6]);
    ctx.lineWidth = 1;
    ctx.strokeStyle = 'rgba(255,255,255,0.2)';
    ctx.beginPath();
    // Shoulder line, v = 0.
    const a = this.toPx(PLANE.uMin, 0);
    const b = this.toPx(PLANE.uMax, 0);
    ctx.moveTo(a.x, a.y);
    ctx.lineTo(b.x, b.y);
    // Spine axis projection, u = 0.
    const c = this.toPx(0, PLANE.vMin);
    const d = this.toPx(0, PLANE.vMax);
    ctx.moveTo(c.x, c.y);
    ctx.lineTo(d.x, d.y);
    ctx.stroke();
    ctx.setLineDash([]);

    // Labels sit outside the rectangle so they never collide with the geometry.
    const left = this.toPx(PLANE.uMin, PLANE.vMax);
    const right = this.toPx(PLANE.uMax, PLANE.vMin);
    ctx.font = '11px ui-monospace, monospace';
    ctx.fillStyle = 'rgba(255,255,255,0.45)';
    ctx.textAlign = 'center';
    ctx.fillText('← trail side    u    lead side →', (left.x + right.x) / 2, right.y + 20);
    ctx.save();
    ctx.translate(left.x - 12, (left.y + right.y) / 2);
    ctx.rotate(-Math.PI / 2);
    ctx.fillText('v   along spine axis', 0, 0);
    ctx.restore();
  }

  /**
   * The elbow line -- the reference this view is named for -- plus the arm
   * chains that reach it. Everything here is an orthographic projection onto the
   * hand plane; the elbows themselves sit behind it.
   */
  drawElbowLine(pose) {
    const ctx = this.ctx;
    const elbows = {
      lead: worldToPlane(pose.basis, pose.lead.elbow),
      trail: worldToPlane(pose.basis, pose.trail.elbow),
    };
    const hand = this.toPx(pose.u, pose.v);

    // Shoulder -> elbow -> hand for each arm, thin, so the elbow line is
    // visibly part of the linkage rather than a floating segment.
    ctx.lineWidth = 1.5;
    for (const which of ['lead', 'trail']) {
      const shoulder = this.toPx(SHOULDER_UV[which].u, SHOULDER_UV[which].v);
      const elbow = this.toPx(elbows[which].u, elbows[which].v);
      ctx.strokeStyle = which === 'lead' ? 'rgba(120,240,190,0.75)' : 'rgba(255,140,140,0.7)';
      ctx.beginPath();
      ctx.moveTo(shoulder.x, shoulder.y);
      ctx.lineTo(elbow.x, elbow.y);
      ctx.lineTo(hand.x, hand.y);
      ctx.stroke();
    }

    const a = this.toPx(elbows.lead.u, elbows.lead.v);
    const b = this.toPx(elbows.trail.u, elbows.trail.v);
    ctx.strokeStyle = COLORS.elbowLine;
    ctx.lineWidth = 2.5;
    ctx.beginPath();
    ctx.moveTo(a.x, a.y);
    ctx.lineTo(b.x, b.y);
    ctx.stroke();

    ctx.fillStyle = COLORS.elbowLine;
    for (const p of [a, b]) {
      ctx.beginPath();
      ctx.arc(p.x, p.y, 4, 0, Math.PI * 2);
      ctx.fill();
    }
  }

  drawPath() {
    const ctx = this.ctx;
    const { local } = this.swing.sampledPath();
    ctx.lineWidth = 2.5;
    ctx.lineCap = 'round';
    for (let i = 1; i < local.length; i += 1) {
      const a = this.toPx(local[i - 1].u, local[i - 1].v);
      const b = this.toPx(local[i].u, local[i].v);
      ctx.strokeStyle = COLORS[local[i].phase];
      ctx.beginPath();
      ctx.moveTo(a.x, a.y);
      ctx.lineTo(b.x, b.y);
      ctx.stroke();
    }
  }

  /** Shoulders-to-hands triangle, plus the projected elbows. */
  drawTriangle(pose) {
    const ctx = this.ctx;
    const lead = this.toPx(SHOULDER_UV.lead.u, SHOULDER_UV.lead.v);
    const trail = this.toPx(SHOULDER_UV.trail.u, SHOULDER_UV.trail.v);
    const hand = this.toPx(pose.u, pose.v);

    ctx.strokeStyle = 'rgba(255,255,255,0.5)';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(lead.x, lead.y);
    ctx.lineTo(hand.x, hand.y);
    ctx.lineTo(trail.x, trail.y);
    ctx.closePath();
    ctx.stroke();
    ctx.fillStyle = 'rgba(255,255,255,0.05)';
    ctx.fill();

    for (const p of [lead, trail]) {
      ctx.fillStyle = COLORS.body;
      ctx.beginPath();
      ctx.arc(p.x, p.y, 5, 0, Math.PI * 2);
      ctx.fill();
    }
  }

  drawKeyframes() {
    const ctx = this.ctx;
    const dragging = this.store.state.dragging;
    this.swing.keys.forEach((k, i) => {
      const p = this.toPx(k.u, k.v);
      const active = i === dragging || i === this.hover;
      ctx.fillStyle = COLORS[phaseAt(k.t).id];
      ctx.strokeStyle = active ? '#ffffff' : 'rgba(0,0,0,0.6)';
      ctx.lineWidth = active ? 2 : 1;
      ctx.beginPath();
      ctx.arc(p.x, p.y, active ? 6.5 : 4.5, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();

      if (active) {
        ctx.font = '11px ui-monospace, monospace';
        ctx.fillStyle = '#ffffff';
        ctx.textAlign = 'left';
        ctx.fillText(k.label, p.x + 10, p.y - 8);
      }
    });
  }

  drawHand(pose) {
    const ctx = this.ctx;
    const p = this.toPx(pose.u, pose.v);
    const bad = pose.lead.overextended || pose.trail.overextended;
    ctx.beginPath();
    ctx.arc(p.x, p.y, 8, 0, Math.PI * 2);
    ctx.fillStyle = bad ? '#ff5a6a' : COLORS.hand;
    ctx.fill();
    ctx.strokeStyle = 'rgba(0,0,0,0.7)';
    ctx.lineWidth = 2;
    ctx.stroke();
  }
}
