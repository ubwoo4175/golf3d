/**
 * 2D view: the hand rectangle seen head-on, from in front of the golfer.
 *
 * This is the torso-fixed frame, so the shoulders and the elbow line are almost
 * stationary here while the whole rectangle spins in the 3D view. Horizontal is
 * the shoulder/elbow line, vertical is the spine axis (v, positive toward the
 * head).
 *
 * The horizontal axis is the golfer's OWN point of view -- as if looking down at
 * their own hands -- not a face-on view of them. So a right-hander's lead side is
 * their left and appears on the LEFT of the screen, and the mirror of that for a
 * left-hander. Internally u is always positive toward the lead side; only the
 * mapping to screen x flips.
 *
 * The hand does not lie on the rectangle -- its perpendicular distance is solved
 * from the arm rules -- so this view is an orthographic projection along the
 * rectangle's normal, with the solved offset annotated next to the hand.
 *
 * Dragging edits the swing: grabbing a keyframe handle snaps the timeline to it
 * and moves it, so the 3D path reshapes live.
 */

import { PLANE, COLORS } from './config.js';
import { straightArmLocus, freeArmULimit } from './arm.js';
import { SHOULDER_UV, worldToPlane, getRig } from './rig.js';
import { phaseAt, RELEASE_T } from './swing.js';
import { Canvas2D } from './canvas2d.js';
import { clamp } from './vec3.js';

const GRAB_RADIUS_PX = 14;

export class PlaneView extends Canvas2D {
  constructor(canvas, store, swing) {
    super(canvas);
    this.store = store;
    this.swing = swing;
    this.resize();
    this.bindDrag();
  }

  /** Recompute the plane-to-screen mapping. Also called when handedness flips. */
  layout() {
    // Negated handedness: +H would put the lead side on the right, which is the
    // face-on view of the golfer. Looking out through their own eyes mirrors it.
    this.fitBox(
      { xMin: PLANE.uMin, xMax: PLANE.uMax, yMin: PLANE.vMin, yMax: PLANE.vMax },
      -getRig().H,
    );
  }

  toPlane(x, y) {
    const p = this.fromPx(x, y);
    return { u: p.x, v: p.y };
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

  bindDrag() {
    this.bindPointer({
      onDown: (x, y) => {
        // A hit on a handle grabs it; anywhere else grabs the keyframe nearest
        // in time, so a plain drag always moves the pose you are looking at.
        const index =
          this.pickKeyframe(x, y) ?? this.swing.nearestKeyframeIndex(this.store.state.t);
        this.store.set({ t: this.swing.keys[index].t, playing: false, dragging: index });
        return true;
      },
      onDrag: (x, y) => this.applyDrag(x, y),
      onUp: () => this.store.set({ dragging: null }),
      onHover: (x, y) => {
        const hit = this.pickKeyframe(x, y);
        if (hit !== this.hover) {
          this.hover = hit;
          this.setCursor(hit === null ? 'crosshair' : 'grab');
        }
      },
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

    this.clear();
    this.drawRectangle(pose, showGuides);
    if (showGuides) this.drawReachGuides(pose);
    this.drawAxes(pose);
    if (showPath) this.drawPath();
    this.drawTriangle(pose);
    this.drawElbowLine(pose);
    this.drawKeyframes();
    this.drawHand(pose);
  }

  /** Path for an axis-aligned rectangle given two opposite plane corners. */
  planeRect(ctx, u0, v0, u1, v1) {
    const a = this.toPx(u0, v0);
    const b = this.toPx(u1, v1);
    const x = Math.min(a.x, b.x);
    const y = Math.min(a.y, b.y);
    ctx.beginPath();
    ctx.rect(x, y, Math.abs(b.x - a.x), Math.abs(b.y - a.y));
  }

  rectPath(ctx) {
    this.planeRect(ctx, PLANE.uMin, PLANE.vMin, PLANE.uMax, PLANE.vMax);
  }

  /**
   * Shade where the pose is impossible. The reachable region is the locked arm's
   * disk cut by the half-plane where the FREE arm is still long enough -- not the
   * lens of two circles it used to be, because the perpendicular distance now
   * absorbs the locked arm's constraint.
   */
  drawRectangle(pose, shadeUnreachable) {
    const ctx = this.ctx;
    this.rectPath(ctx);
    ctx.fillStyle = shadeUnreachable ? COLORS.unreachable : '#101725';
    ctx.fill();

    if (shadeUnreachable) {
      const locus = straightArmLocus(pose.constraint);
      const limit = freeArmULimit(pose.constraint);
      ctx.save();
      this.rectPath(ctx);
      ctx.clip();
      const p = this.toPx(locus.u, locus.v);
      ctx.beginPath();
      ctx.arc(p.x, p.y, locus.radius * this.viewport.scale, 0, Math.PI * 2);
      ctx.clip();
      this.planeRect(
        ctx,
        Math.max(limit.min, PLANE.uMin),
        PLANE.vMin,
        Math.min(limit.max, PLANE.uMax),
        PLANE.vMax,
      );
      ctx.clip();
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
      const a = this.toPx(u, PLANE.vMin);
      const b = this.toPx(u, PLANE.vMax);
      ctx.moveTo(a.x, a.y);
      ctx.lineTo(b.x, b.y);
    }
    for (let v = Math.ceil(PLANE.vMin * 10) / 10; v <= PLANE.vMax; v += 0.1) {
      const a = this.toPx(PLANE.uMin, v);
      const b = this.toPx(PLANE.uMax, v);
      ctx.moveTo(a.x, a.y);
      ctx.lineTo(b.x, b.y);
    }
    ctx.stroke();
    ctx.restore();

    this.rectPath(ctx);
    ctx.strokeStyle = 'rgba(74,163,255,0.5)';
    ctx.lineWidth = 1.5;
    ctx.stroke();
  }

  /** Reach limit of the locked arm, solid; the other arm's, faint. */
  drawReachGuides(pose) {
    const ctx = this.ctx;
    ctx.save();
    this.rectPath(ctx);
    ctx.clip();
    for (const which of ['lead', 'trail']) {
      const active = which === pose.constraint;
      const locus = straightArmLocus(which);
      const p = this.toPx(locus.u, locus.v);
      ctx.setLineDash(active ? [6, 4] : [2, 6]);
      ctx.lineWidth = active ? 1.6 : 1;
      ctx.strokeStyle =
        which === 'lead'
          ? `rgba(120,240,190,${active ? 0.75 : 0.25})`
          : `rgba(255,140,140,${active ? 0.7 : 0.22})`;
      ctx.beginPath();
      ctx.arc(p.x, p.y, locus.radius * this.viewport.scale, 0, Math.PI * 2);
      ctx.stroke();
    }
    ctx.restore();
    ctx.setLineDash([]);
  }

  drawAxes(pose) {
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
    ctx.stroke();
    ctx.setLineDash([]);

    // Sternum line, u = 0: the hands sit on the trail side of it until release
    // and the lead side after, so it is where the arms swap roles.
    const c = this.toPx(0, PLANE.vMin);
    const d = this.toPx(0, PLANE.vMax);
    ctx.strokeStyle = 'rgba(255,255,255,0.32)';
    ctx.lineWidth = 1.2;
    ctx.beginPath();
    ctx.moveTo(c.x, c.y);
    ctx.lineTo(d.x, d.y);
    ctx.stroke();

    // Labels sit outside the rectangle so they never collide with the geometry.
    const corner0 = this.toPx(PLANE.uMin, PLANE.vMax);
    const corner1 = this.toPx(PLANE.uMax, PLANE.vMin);
    const left = Math.min(corner0.x, corner1.x);
    const bottom = Math.max(corner0.y, corner1.y);
    const midX = (corner0.x + corner1.x) / 2;
    const midY = (corner0.y + corner1.y) / 2;

    ctx.font = '11px ui-monospace, monospace';
    ctx.fillStyle = 'rgba(255,255,255,0.45)';
    ctx.textAlign = 'center';
    const trailLabel = `trail (${pose.sides.trail})`;
    const leadLabel = `lead (${pose.sides.lead})`;
    const order =
      this.viewport.flip > 0
        ? `← ${trailLabel}     u     ${leadLabel} →`
        : `← ${leadLabel}     u     ${trailLabel} →`;
    ctx.fillText(order, midX, bottom + 22);
    ctx.save();
    ctx.translate(left - 14, midY);
    ctx.rotate(-Math.PI / 2);
    ctx.fillText('v   along spine axis', 0, 0);
    ctx.restore();
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

  /** Shoulders-to-hands triangle. */
  drawTriangle(pose) {
    const ctx = this.ctx;
    const lead = this.toPx(SHOULDER_UV.lead.u, SHOULDER_UV.lead.v);
    const trail = this.toPx(SHOULDER_UV.trail.u, SHOULDER_UV.trail.v);
    const hand = this.toPx(pose.u, pose.v);

    ctx.strokeStyle = 'rgba(255,255,255,0.22)';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(lead.x, lead.y);
    ctx.lineTo(hand.x, hand.y);
    ctx.lineTo(trail.x, trail.y);
    ctx.closePath();
    ctx.stroke();
    ctx.fillStyle = 'rgba(255,255,255,0.035)';
    ctx.fill();

    for (const p of [lead, trail]) {
      ctx.fillStyle = COLORS.body;
      ctx.beginPath();
      ctx.arc(p.x, p.y, 5, 0, Math.PI * 2);
      ctx.fill();
    }
  }

  /**
   * The elbow line -- the reference this view is named for -- plus the arm
   * chains that reach it. Everything here is an orthographic projection onto the
   * rectangle; the joints themselves sit off it.
   */
  drawElbowLine(pose) {
    const ctx = this.ctx;
    const elbows = {
      lead: worldToPlane(pose.basis, pose.lead.elbow),
      trail: worldToPlane(pose.basis, pose.trail.elbow),
    };
    const hand = this.toPx(pose.u, pose.v);

    // Shoulder -> elbow -> hand for each arm, thin, so the elbow line is
    // visibly part of the linkage rather than a floating segment. The locked arm
    // is drawn brighter.
    for (const which of ['lead', 'trail']) {
      const locked = which === pose.constraint;
      const shoulder = this.toPx(SHOULDER_UV[which].u, SHOULDER_UV[which].v);
      const elbow = this.toPx(elbows[which].u, elbows[which].v);
      ctx.lineWidth = locked ? 2.5 : 1.5;
      ctx.strokeStyle =
        which === 'lead'
          ? `rgba(120,240,190,${locked ? 0.95 : 0.55})`
          : `rgba(255,140,140,${locked ? 0.95 : 0.5})`;
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

  drawKeyframes() {
    const ctx = this.ctx;
    const dragging = this.store.state.dragging;
    this.swing.keys.forEach((k, i) => {
      const p = this.toPx(k.u, k.v);
      const active = i === dragging || i === this.hover;
      const isRelease = Math.abs(k.t - RELEASE_T) < 1e-6;

      // Release is the keyframe where the constraint hands over, so it is ringed.
      if (isRelease) {
        ctx.strokeStyle = 'rgba(255,255,255,0.7)';
        ctx.lineWidth = 1.2;
        ctx.beginPath();
        ctx.arc(p.x, p.y, 10, 0, Math.PI * 2);
        ctx.stroke();
      }

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
        ctx.fillText(k.label, p.x + 12, p.y - 10);
      }
    });
  }

  /**
   * The hand, annotated with the one thing this projection cannot show: how far
   * off the rectangle the solved perpendicular distance put it.
   */
  drawHand(pose) {
    const ctx = this.ctx;
    const p = this.toPx(pose.u, pose.v);
    const bad = pose.lead.overextended || pose.trail.overextended || !pose.reachable;

    ctx.beginPath();
    ctx.arc(p.x, p.y, 8, 0, Math.PI * 2);
    ctx.fillStyle = bad ? '#ff5a6a' : COLORS.hand;
    ctx.fill();
    ctx.strokeStyle = 'rgba(0,0,0,0.7)';
    ctx.lineWidth = 2;
    ctx.stroke();

    const cm = pose.normalOffset * 100;
    ctx.font = '11px ui-monospace, monospace';
    ctx.fillStyle = bad ? '#ff8a96' : 'rgba(255,255,255,0.7)';
    ctx.textAlign = 'left';
    ctx.fillText(`⊥ ${cm >= 0 ? '+' : ''}${cm.toFixed(1)} cm`, p.x + 12, p.y + 16);
  }
}
