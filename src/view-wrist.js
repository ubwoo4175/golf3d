/**
 * Wrist view: the club's direction, seen from the wrist, in 3D.
 *
 * The hand is pinned at the origin and never moves -- this view says nothing
 * about WHERE the hands are, only about what the club is doing relative to them.
 * The scene is drawn in the HAND FRAME, so the lead forearm always points the
 * same way on screen and the only thing that moves is the club. That is what
 * isolates the wrist from the rest of the swing.
 *
 *   +Y   the lead forearm extended. The club lies along it at zero hinge.
 *   +X   the cock axis  -- hinging in the plane of the two forearms
 *   +Z   the bow axis   -- hinging out of that plane
 *
 * THE DOME is the surface the clubhead sweeps: every direction the shaft can
 * point, at one shaft length from the hand. It is drawn hollow-side-down over the
 * hand, and the clubhead sits ON it, so the handle you drag and the clubhead are
 * the same object. The rings are hinge latitudes at 30 / 60 / 90 / 120 / 150
 * degrees from the forearm axis.
 *
 * The camera looks at the hand from the front with the forearm running DOWN the
 * screen, which is the framing the flat version had and the one that reads as a
 * wrist rather than as a chart. Dragging ray-casts onto the dome, so the clubhead
 * goes where the cursor goes.
 *
 * That mapping is still one-to-one with `(cockDeg, bowDeg)` -- the stored pair is
 * the dome point in azimuthal-equidistant coordinates. See the exponential-map
 * note in club.js for why the pair is stored that way round.
 *
 * A 2D overlay carries the text and the face dial. Roll about the shaft is the
 * third degree of freedom, and having no direction of its own it has nowhere to
 * live on a direction chart.
 */

import * as THREE from 'three';

import { COLORS, CLUB } from './config.js';
import { getRig, getClub } from './rig.js';
import { hingeOf, shaftDirection } from './club.js';
import { phaseAt, RELEASE_T } from './swing.js';
import { clamp } from './vec3.js';

const GRAB_RADIUS_PX = 15;
/** How far the wrist can hinge, and the dome radius, which is the shaft length. */
const MAX_DEG = 150;
const SHAFT_LEN = 0.95;
const RINGS = [30, 60, 90, 120, 150];
const FOREARM_LEN = 0.45;
const DIAL_RADIUS = 30;
const DIAL_INSET = 46;

const v3 = (x, y, z) => new THREE.Vector3(x, y, z);

export class WristView {
  constructor(canvas, overlay, store, swing) {
    this.canvas = canvas;
    this.overlay = overlay;
    this.ctx = overlay.getContext('2d');
    this.store = store;
    this.swing = swing;
    this.hover = null;
    this.mode = null;

    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color('#0c1220');

    // A fixed camera, deliberately: the pane's whole job is to be dragged on, and
    // an orbit control would fight the drag for the same mouse button. The angle
    // is high enough that the chart disk never becomes edge-on, which is what
    // would make the ray-cast ill-conditioned.
    // Fixed direction, distance fitted to the pane -- see `frame()`. This pane is
    // tall and narrow, so a hard-coded distance that looks right on one shape
    // clips the chart on another.
    this.camera = new THREE.PerspectiveCamera(42, 1, 0.05, 40);
    // From the front and a little above: the forearm runs down the screen and the
    // club stands up out of the dome. Straight down the forearm axis would put
    // the club end-on and foreshorten it to a dot.
    this.viewDir = new THREE.Vector3(0.30, 0.34, 1.0).normalize();
    this.target = v3(0, 0.3, 0);

    this.raycaster = new THREE.Raycaster();
    this.domeRadius = SHAFT_LEN;

    this.build();
    this.resize();
    this.bind();
  }

  // --- scene ---------------------------------------------------------------

  build() {
    this.scene.add(new THREE.HemisphereLight('#cfe4ff', '#141c2c', 1.0));
    const key = new THREE.DirectionalLight('#ffffff', 1.0);
    key.position.set(2, 3, 2);
    this.scene.add(key);

    // The dome: every direction the shaft can point, at one shaft length. Drawn
    // double-sided and faint so the club reads whether it is in front of the
    // surface or behind it.
    this.scene.add(
      new THREE.Mesh(
        new THREE.SphereGeometry(SHAFT_LEN, 48, 32, 0, Math.PI * 2, 0, (MAX_DEG * Math.PI) / 180),
        new THREE.MeshBasicMaterial({
          color: '#16233a',
          transparent: true,
          opacity: 0.4,
          side: THREE.DoubleSide,
          depthWrite: false,
        }),
      ),
    );

    // Hinge latitudes, and meridians every 30 degrees of bearing.
    for (const deg of RINGS) {
      const a = (deg * Math.PI) / 180;
      const pts = [];
      for (let i = 0; i <= 96; i += 1) {
        const b = (i / 96) * Math.PI * 2;
        pts.push(
          v3(
            SHAFT_LEN * Math.sin(a) * Math.cos(b),
            SHAFT_LEN * Math.cos(a),
            SHAFT_LEN * Math.sin(a) * Math.sin(b),
          ),
        );
      }
      this.scene.add(
        new THREE.Line(
          new THREE.BufferGeometry().setFromPoints(pts),
          new THREE.LineBasicMaterial({
            color: '#4a6080',
            transparent: true,
            opacity: deg === 90 ? 0.75 : 0.35,
          }),
        ),
      );
    }
    const meridians = [];
    for (let b = 0; b < 360; b += 30) {
      const r = (b * Math.PI) / 180;
      for (let i = 0; i < 24; i += 1) {
        const a0 = ((MAX_DEG * i) / 24) * (Math.PI / 180);
        const a1 = ((MAX_DEG * (i + 1)) / 24) * (Math.PI / 180);
        meridians.push(
          v3(SHAFT_LEN * Math.sin(a0) * Math.cos(r), SHAFT_LEN * Math.cos(a0), SHAFT_LEN * Math.sin(a0) * Math.sin(r)),
          v3(SHAFT_LEN * Math.sin(a1) * Math.cos(r), SHAFT_LEN * Math.cos(a1), SHAFT_LEN * Math.sin(a1) * Math.sin(r)),
        );
      }
    }
    this.scene.add(
      new THREE.LineSegments(
        new THREE.BufferGeometry().setFromPoints(meridians),
        new THREE.LineBasicMaterial({ color: '#33415c', transparent: true, opacity: 0.4 }),
      ),
    );

    // The lead forearm, running down from the hand: the axis everything is
    // measured against, and the club's position at zero hinge.
    this.scene.add(this.cylinder(0.026, '#5c6a7d', v3(0, 0, 0), v3(0, -FOREARM_LEN, 0)));
    this.zeroMark = this.cylinder(0.005, '#40506a', v3(0, 0, 0), v3(0, SHAFT_LEN * 0.5, 0));
    this.scene.add(this.zeroMark);

    const hand = new THREE.Mesh(
      new THREE.SphereGeometry(0.045, 20, 16),
      new THREE.MeshStandardMaterial({ color: COLORS.hand, roughness: 0.4 }),
    );
    this.scene.add(hand);

    // The club: shaft, head body and face, in a group whose basis is set from the
    // shaft direction and the roll each frame.
    this.shaft = this.cylinder(0.013, COLORS.shaft, v3(0, 0, 0), v3(0, 1, 0));
    this.scene.add(this.shaft);
    this.headGroup = new THREE.Group();
    this.scene.add(this.headGroup);
    this.buildHead();

    this.track = new THREE.Group();
    this.scene.add(this.track);
    this.markers = new THREE.Group();
    this.scene.add(this.markers);
  }

  buildHead() {
    for (const c of [...this.headGroup.children]) {
      this.headGroup.remove(c);
      c.geometry?.dispose();
      c.material?.dispose();
    }
    // Proportional to the real head but 1.5x oversized: at true scale against a
    // 0.95-unit shaft the head is 9% of it, too small to read the face on, and
    // reading the face is what this pane is for.
    const s = (SHAFT_LEN / 0.84) * 1.5;
    const { length, height, depth } = getClub().head;
    const body = new THREE.Mesh(
      new THREE.BoxGeometry(length * s, height * s, depth * s),
      new THREE.MeshStandardMaterial({ color: '#c8d2de', roughness: 0.35, metalness: 0.6 }),
    );
    body.position.set(length * s * 0.32, height * s * 0.35, 0);
    const face = new THREE.Mesh(
      new THREE.BoxGeometry(length * s * 0.92, height * s * 0.86, 0.008),
      new THREE.MeshStandardMaterial({ color: COLORS.face, roughness: 0.5 }),
    );
    face.position.set(length * s * 0.32, height * s * 0.35, (depth * s) / 2 + 0.005);
    this.headGroup.add(body, face);
  }

  cylinder(radius, color, from, to) {
    const dir = to.clone().sub(from);
    const geo = new THREE.CylinderGeometry(radius, radius, 1, 14);
    geo.translate(0, 0.5, 0);
    const mesh = new THREE.Mesh(
      geo,
      new THREE.MeshStandardMaterial({ color, roughness: 0.5, metalness: 0.2 }),
    );
    mesh.position.copy(from);
    mesh.quaternion.setFromUnitVectors(v3(0, 1, 0), dir.clone().normalize());
    mesh.scale.set(1, Math.max(dir.length(), 1e-4), 1);
    return mesh;
  }

  /**
   * Where a (cock, bow) pair puts the clubhead: a point on the dome. The
   * horizontal axis is mirrored with handedness, the same as the hand panel, so
   * a cock toward the trail side falls on the same side of the screen in both.
   */
  chartPoint(cockDeg, bowDeg) {
    return this.tipFor(cockDeg, bowDeg);
  }

  /** The view-space frame the dome is drawn in. */
  viewFrame() {
    return {
      f: { x: 0, y: 1, z: 0 },
      r: { x: -getRig().H, y: 0, z: 0 },
      n: { x: 0, y: 0, z: -1 },
    };
  }

  /** Inverse of `chartPoint`: a point on the dome back to the stored pair. */
  chartToWrist(p) {
    const d = p.clone().normalize();
    const hinge = (Math.acos(clamp(d.y, -1, 1)) * 180) / Math.PI;
    const az = Math.atan2(-d.z, -getRig().H * d.x);
    return { cockDeg: hinge * Math.cos(az), bowDeg: hinge * Math.sin(az) };
  }

  /** The shaft tip for a wrist pair, in view space. */
  tipFor(cockDeg, bowDeg) {
    const d = shaftDirection(this.viewFrame(), cockDeg, bowDeg);
    return v3(d.x, d.y, d.z).multiplyScalar(SHAFT_LEN);
  }

  // --- interaction ---------------------------------------------------------

  resize() {
    const rect = this.canvas.getBoundingClientRect();
    this.w = Math.max(1, rect.width);
    this.h = Math.max(1, rect.height);
    this.renderer.setSize(this.w, this.h, false);
    this.camera.aspect = this.w / this.h;
    this.camera.updateProjectionMatrix();
    this.frame();

    const dpr = window.devicePixelRatio || 1;
    this.overlay.width = Math.round(this.w * dpr);
    this.overlay.height = Math.round(this.h * dpr);
    this.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    this.layout();
  }

  /**
   * Pull the camera back far enough that the chart and a fully hinged club fit
   * BOTH ways. The horizontal half-angle is the binding one here: the pane is
   * about half as wide as it is tall, so fitting only the height leaves the chart
   * running off the sides.
   */
  frame() {
    // Fit the camera to the content by projecting it, rather than by bounding it
    // with a box or a sphere. Neither approximation survives an oblique camera:
    // a sphere of the largest dimension wastes a third of the pane, and a box
    // fitted axis-aligned still let the club run off the top, because a point
    // high above the target projects further up than its height suggests.
    //
    // For a point p measured from the target, with the camera at distance `dist`
    // along `viewDir`, the depth is `dist - p.d` and the point is inside the
    // frustum when |p.right| <= tanH * aspect * depth and |p.up| <= tanH * depth.
    // Each inequality gives a lower bound on `dist`; the answer is the largest.
    const d = this.viewDir;
    const right = new THREE.Vector3().crossVectors(v3(0, 1, 0), d).normalize();
    const up = new THREE.Vector3().crossVectors(d, right).normalize();
    const tanV = Math.tan((this.camera.fov * Math.PI) / 360);
    const tanH = tanV * this.camera.aspect;

    this.target.set(0, (SHAFT_LEN - FOREARM_LEN) / 2, 0);
    const pts = [v3(0, -FOREARM_LEN, 0)];
    for (let a = 0; a < 360; a += 20) {
      const r = (a * Math.PI) / 180;
      // The whole dome, so no hinge angle can push the club out of frame.
      for (const hinge of [0, 45, 90, 135, MAX_DEG]) {
        pts.push(this.tipFor(hinge * Math.cos(r), hinge * Math.sin(r)));
      }
    }

    let dist = 0;
    for (const p of pts) {
      const q = p.clone().sub(this.target);
      const along = q.dot(d);
      dist = Math.max(
        dist,
        along + Math.abs(q.dot(right)) / tanH,
        along + Math.abs(q.dot(up)) / tanV,
      );
    }
    this.camera.position.copy(this.target).addScaledVector(d, dist * 1.04);
    this.camera.lookAt(this.target);
  }

  layout() {
    this.dial = { x: DIAL_INSET, y: this.h - DIAL_INSET };
    this.buildHead();
  }

  activeIndex() {
    return this.swing.nearestKeyframeIndex(this.store.state.t);
  }

  /** Project a view-space point to overlay pixels. */
  toScreen(p) {
    const v = p.clone().project(this.camera);
    return { x: ((v.x + 1) / 2) * this.w, y: ((1 - v.y) / 2) * this.h };
  }

  /**
   * Where the pointer ray meets the dome, in view space.
   *
   * A ray that misses the dome is projected onto its silhouette rather than
   * ignored, so dragging past the edge slides along the rim instead of sticking.
   */
  rayToChart(x, y) {
    this.raycaster.setFromCamera(
      new THREE.Vector2((x / this.w) * 2 - 1, -(y / this.h) * 2 + 1),
      this.camera,
    );
    const { origin: o, direction: d } = this.raycaster.ray;
    const R = this.domeRadius;
    const b = 2 * o.dot(d);
    const c = o.lengthSq() - R * R;
    const disc = b * b - 4 * c;
    if (disc <= 0) {
      const t = -o.dot(d);
      return o.clone().addScaledVector(d, t).normalize().multiplyScalar(R);
    }
    const root = Math.sqrt(disc);
    const t1 = (-b - root) / 2;
    const t2 = (-b + root) / 2;
    // The near hit is the front of the dome, which is what the cursor is over.
    const t = t1 > 0 ? t1 : t2;
    return o.clone().addScaledVector(d, t);
  }

  pickKeyframe(x, y) {
    let best = null;
    let bestDist = GRAB_RADIUS_PX;
    this.swing.keys.forEach((k, i) => {
      const p = this.toScreen(this.chartPoint(k.cockDeg, k.bowDeg));
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
    const at = (event) => {
      const rect = this.overlay.getBoundingClientRect();
      return { x: event.clientX - rect.left, y: event.clientY - rect.top };
    };
    let dragging = false;

    this.overlay.addEventListener('pointerdown', (event) => {
      const { x, y } = at(event);
      if (this.onDial(x, y)) {
        this.mode = 'face';
        this.index = this.activeIndex();
      } else {
        this.mode = 'hinge';
        this.index = this.pickKeyframe(x, y) ?? this.activeIndex();
      }
      this.store.set({ t: this.swing.keys[this.index].t, playing: false });
      dragging = true;
      this.overlay.setPointerCapture(event.pointerId);
      this.applyDrag(x, y);
    });

    this.overlay.addEventListener('pointermove', (event) => {
      const { x, y } = at(event);
      if (dragging) {
        this.applyDrag(x, y);
      } else {
        const hit = this.onDial(x, y) ? 'dial' : this.pickKeyframe(x, y);
        if (hit !== this.hover) {
          this.hover = hit;
          this.overlay.style.cursor = hit === null ? 'crosshair' : 'grab';
        }
      }
    });

    const end = (event) => {
      dragging = false;
      this.mode = null;
      if (this.overlay.hasPointerCapture?.(event.pointerId)) {
        this.overlay.releasePointerCapture(event.pointerId);
      }
    };
    this.overlay.addEventListener('pointerup', end);
    this.overlay.addEventListener('pointercancel', end);
    this.overlay.addEventListener('pointerleave', () => {
      this.hover = null;
    });
  }

  applyDrag(x, y) {
    if (this.mode === 'face') {
      const deg = (Math.atan2(this.dial.y - y, x - this.dial.x) * 180) / Math.PI;
      this.swing.setKeyframeWrist(this.index, { faceDeg: Math.round(90 - deg) });
      return;
    }
    const hit = this.rayToChart(x, y);
    if (!hit) return;
    const { cockDeg, bowDeg } = this.chartToWrist(hit);
    // Clamp to the chart, in polar rather than per-axis: the chart is a disk, and
    // clamping the components separately would let a drag past the rim slide
    // round it instead of stopping.
    const hinge = Math.hypot(cockDeg, bowDeg);
    const k = hinge > MAX_DEG ? MAX_DEG / hinge : 1;
    this.swing.setKeyframeWrist(this.index, {
      cockDeg: clamp(cockDeg * k, -MAX_DEG, MAX_DEG),
      bowDeg: clamp(bowDeg * k, -MAX_DEG, MAX_DEG),
    });
  }

  // --- drawing -------------------------------------------------------------

  draw(pose) {
    const { cockDeg, bowDeg, faceDeg } = pose.wrist;

    const tip = this.tipFor(cockDeg, bowDeg);

    this.shaft.position.set(0, 0, 0);
    this.shaft.quaternion.setFromUnitVectors(v3(0, 1, 0), tip.clone().normalize());
    this.shaft.scale.set(1, SHAFT_LEN, 1);

    // Head orientation: the roll is a rotation about the shaft, so the head frame
    // is the shaft direction plus a reference perpendicular rolled by faceDeg.
    // Reusing the pose's own leading edge would be wrong here -- that is in world
    // space and this scene is in the hand frame -- so it is rebuilt locally.
    const dir = tip.clone().normalize();
    let ref = new THREE.Vector3(0, 0, 1).cross(dir);
    if (ref.lengthSq() < 1e-8) ref = new THREE.Vector3(1, 0, 0);
    ref.normalize();
    const roll = ((CLUB.faceZeroDeg + faceDeg) * Math.PI) / 180;
    const faceNormal = ref.clone().applyAxisAngle(dir, roll).normalize();
    const leading = new THREE.Vector3().crossVectors(faceNormal, dir).normalize();
    const headUp = new THREE.Vector3().crossVectors(faceNormal, leading).normalize();
    this.headGroup.position.copy(tip);
    this.headGroup.setRotationFromMatrix(
      new THREE.Matrix4().makeBasis(leading, headUp, faceNormal),
    );

    this.refreshTrack();
    this.renderer.render(this.scene, this.camera);
    this.drawOverlay(pose);
  }

  /** The wrist track and the keyframe markers, rebuilt when the swing changes. */
  refreshTrack() {
    if (this.trackStamp === this.swing.revision && this.markers.children.length) return;
    this.trackStamp = this.swing.revision;

    for (const g of [this.track, this.markers]) {
      for (const c of [...g.children]) {
        g.remove(c);
        c.geometry?.dispose();
        c.material?.dispose();
      }
    }

    const n = 200;
    const byPhase = {};
    let prev = null;
    for (let i = 0; i <= n; i += 1) {
      const t = i / n;
      const w = this.swing.sample(t).wrist;
      const p = this.chartPoint(w.cockDeg, w.bowDeg);
      const id = phaseAt(t).id;
      if (prev) (byPhase[id] ??= []).push(prev.clone(), p.clone());
      prev = p;
    }
    for (const [id, pts] of Object.entries(byPhase)) {
      this.track.add(
        new THREE.LineSegments(
          new THREE.BufferGeometry().setFromPoints(pts),
          new THREE.LineBasicMaterial({ color: COLORS[id], linewidth: 2 }),
        ),
      );
    }
    this.swing.keys.forEach((k) => {
      const m = new THREE.Mesh(
        new THREE.SphereGeometry(Math.abs(k.t - RELEASE_T) < 1e-6 ? 0.032 : 0.024, 14, 10),
        new THREE.MeshStandardMaterial({ color: COLORS[phaseAt(k.t).id], roughness: 0.4 }),
      );
      m.position.copy(this.chartPoint(k.cockDeg, k.bowDeg));
      this.markers.add(m);
    });
  }

  drawOverlay(pose) {
    const ctx = this.ctx;
    ctx.clearRect(0, 0, this.w, this.h);
    const label = (text, x, y, opts = {}) => {
      ctx.font = opts.font ?? '11px ui-monospace, monospace';
      ctx.fillStyle = opts.color ?? 'rgba(255,255,255,0.5)';
      ctx.textAlign = opts.align ?? 'center';
      ctx.fillText(text, x, y);
    };

    // Ring labels along the chart's horizontal axis, which is the one direction
    // the oblique camera does not foreshorten -- on any other bearing the inner
    // rings bunch together and the numbers overlap.
    for (const deg of RINGS) {
      const p = this.toScreen(this.chartPoint(deg, 0));
      label(`${deg}°`, p.x, p.y + 4, { color: 'rgba(255,255,255,0.32)' });
    }

    const active = this.activeIndex();
    const k = this.swing.keys[active];
    if (k) {
      const p = this.toScreen(this.chartPoint(k.cockDeg, k.bowDeg));
      label(k.label, p.x + 12, p.y - 16, { align: 'left', color: '#ffffff' });
    }

    const sides = getRig().sides;
    label(`← cock (${sides.trail} side)     cock (${sides.lead} side) →`, this.w / 2, this.h - 10);
    label(
      `hinge ${hingeOf(pose.wrist.cockDeg, pose.wrist.bowDeg).toFixed(0)}°   ` +
        `cock ${pose.wrist.cockDeg.toFixed(0)}   bow ${pose.wrist.bowDeg.toFixed(0)}`,
      this.w - 12,
      this.h - 28,
      { align: 'right', color: 'rgba(255,255,255,0.7)' },
    );
    const origin = this.toScreen(v3(0, 0, 0));
    label('hand', origin.x + 14, origin.y + 18, { align: 'left', color: 'rgba(255,255,255,0.55)' });

    this.drawDial(pose);
  }

  drawDial(pose) {
    const ctx = this.ctx;
    const { x, y } = this.dial;
    const roll = pose.wrist.faceDeg;
    const lit = this.hover === 'dial' || this.mode === 'face';

    ctx.beginPath();
    ctx.arc(x, y, DIAL_RADIUS, 0, Math.PI * 2);
    ctx.fillStyle = 'rgba(12,18,32,0.92)';
    ctx.fill();
    ctx.strokeStyle = lit ? 'rgba(255,255,255,0.6)' : 'rgba(255,255,255,0.22)';
    ctx.lineWidth = lit ? 2 : 1;
    ctx.stroke();

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

    ctx.font = '11px ui-monospace, monospace';
    ctx.fillStyle = lit ? '#ffffff' : 'rgba(255,255,255,0.55)';
    ctx.textAlign = 'center';
    ctx.fillText(`face ${roll >= 0 ? '+' : ''}${roll.toFixed(0)}°`, x, y + DIAL_RADIUS + 15);
  }
}
