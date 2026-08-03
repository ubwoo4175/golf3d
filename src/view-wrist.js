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
 * THE HEMISPHERE is a real one, radius = one shaft length, looked at STRAIGHT
 * DOWN the forearm axis through an orthographic camera. So it draws as a circle,
 * the clubhead sits on the surface, and the shaft runs from the hand at the
 * CENTRE of the sphere out to it -- drawn translucent, because seen from directly
 * above a leaning shaft is foreshortened and the lean is the thing worth seeing.
 *
 * Contours are lines of equal HEIGHT, as on a topographic map, which is what
 * makes a circle read as a dome. They bunch toward the rim exactly as they should
 * on a sphere, and that bunching is the depth cue.
 *
 * A true hemisphere only holds 90 degrees of hinge, and past 90 an orthographic
 * picture would fold back inside the rim -- two clubs on one pixel, and a drag
 * that cannot tell them apart. So the swing is authored to stay inside 90; see
 * the note on the finish in swing.js. Within that, screen radius is
 * `sin(hinge)` and the map is one-to-one.
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
/** A hemisphere holds exactly this much hinge. */
const MAX_DEG = 90;
const CHART_R = 1;
/** Contour spacing, as a fraction of the sphere radius. Equal HEIGHT steps. */
const CONTOUR_STEP = 0.1;
/** Angles worth a number, placed at their true radii. */
const LABELLED = [30, 60, 90];
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
    // Orthographic and straight down. Perspective would scale the contour rings
    // by their height and pull the map off the even angular spacing it depends
    // on; orthographic makes screen position exactly the stored pair.
    this.camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0.01, 20);
    this.camera.position.set(0, 6, 0);
    this.camera.up.set(0, 0, -1);
    this.camera.lookAt(0, 0, 0);

    this.build();
    this.resize();
    this.bind();
  }

  // --- scene ---------------------------------------------------------------

  build() {
    // Lit from LOW and to one side, not from the camera. Overhead light on a
    // top-down dome is nearly uniform, which is what made the surface read as a
    // flat disk -- the whole job of the shading here is to say "this is raised".
    this.scene.add(new THREE.AmbientLight('#4a5f80', 0.55));
    const key = new THREE.DirectionalLight('#eaf2ff', 1.5);
    key.position.set(-2.2, 1.1, -1.6);
    this.scene.add(key);
    const fill = new THREE.DirectionalLight('#3d5f8f', 0.7);
    fill.position.set(2.0, 0.6, 1.8);
    this.scene.add(fill);

    // A real hemisphere. Translucent and double-sided so the shaft inside it
    // stays visible, with depthWrite off so it never occludes what it contains.
    const surface = new THREE.Mesh(
      new THREE.SphereGeometry(CHART_R, 72, 36, 0, Math.PI * 2, 0, Math.PI / 2),
      new THREE.MeshStandardMaterial({
        color: '#2b4060',
        roughness: 0.7,
        metalness: 0.05,
        side: THREE.DoubleSide,
        transparent: true,
        opacity: 0.42,
        depthWrite: false,
      }),
    );
    surface.renderOrder = 0;
    this.scene.add(surface);

    // Contours of equal HEIGHT, like a topographic map. On a sphere they bunch
    // toward the rim, and that bunching is what reads as curvature -- rings
    // spaced by angle would be evenly spaced and read as a flat target.
    const contours = [];
    for (let k = CONTOUR_STEP; k < 1; k += CONTOUR_STEP) {
      const y = CHART_R * k;
      const r = Math.sqrt(Math.max(0, CHART_R * CHART_R - y * y));
      for (let i = 0; i < 160; i += 1) {
        const b0 = (i / 160) * Math.PI * 2;
        const b1 = ((i + 1) / 160) * Math.PI * 2;
        contours.push(
          v3(r * Math.cos(b0), y, r * Math.sin(b0)),
          v3(r * Math.cos(b1), y, r * Math.sin(b1)),
        );
      }
    }
    const contourLines = new THREE.LineSegments(
      new THREE.BufferGeometry().setFromPoints(contours),
      new THREE.LineBasicMaterial({ color: '#7d9cc4', transparent: true, opacity: 0.42 }),
    );
    contourLines.renderOrder = 1;
    this.scene.add(contourLines);

    // The rim, and meridians every 30 degrees of bearing.
    const rim = [];
    for (let i = 0; i <= 160; i += 1) {
      const b = (i / 160) * Math.PI * 2;
      rim.push(v3(CHART_R * Math.cos(b), 0, CHART_R * Math.sin(b)));
    }
    this.scene.add(
      new THREE.Line(
        new THREE.BufferGeometry().setFromPoints(rim),
        new THREE.LineBasicMaterial({ color: '#9fb8d8', transparent: true, opacity: 0.8 }),
      ),
    );
    const meridians = [];
    for (let b = 0; b < 360; b += 30) {
      const rad = (b * Math.PI) / 180;
      for (let i = 0; i < 36; i += 1) {
        const a0 = ((Math.PI / 2) * i) / 36;
        const a1 = ((Math.PI / 2) * (i + 1)) / 36;
        meridians.push(
          v3(CHART_R * Math.sin(a0) * Math.cos(rad), CHART_R * Math.cos(a0), CHART_R * Math.sin(a0) * Math.sin(rad)),
          v3(CHART_R * Math.sin(a1) * Math.cos(rad), CHART_R * Math.cos(a1), CHART_R * Math.sin(a1) * Math.sin(rad)),
        );
      }
    }
    const meridianLines = new THREE.LineSegments(
      new THREE.BufferGeometry().setFromPoints(meridians),
      new THREE.LineBasicMaterial({ color: '#5b779a', transparent: true, opacity: 0.3 }),
    );
    meridianLines.renderOrder = 1;
    this.scene.add(meridianLines);

    // The hand is the CENTRE of the sphere, which is also the centre of the
    // circle on screen. The forearm runs straight away from the camera in this
    // view, so there is nothing to draw for it.
    const hand = new THREE.Mesh(
      new THREE.SphereGeometry(0.05, 20, 16),
      new THREE.MeshStandardMaterial({ color: COLORS.hand, roughness: 0.4 }),
    );
    this.scene.add(hand);

    // The club: shaft, head body and face, in a group whose basis is set from the
    // shaft direction and the roll each frame.
    // Translucent, and drawn after the dome so it reads through it: from
    // straight above a leaning shaft is foreshortened, and its lean is what says
    // how far round the sphere the club has gone.
    this.shaft = this.cylinder(0.026, COLORS.shaft, v3(0, 0, 0), v3(0, 1, 0));
    this.shaft.material.transparent = true;
    this.shaft.material.opacity = 0.62;
    this.shaft.material.depthWrite = false;
    this.shaft.renderOrder = 2;
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
    // Oversized against the chart: reading the face is what this pane is for, and
    // at true proportion the head would be a speck on a unit circle.
    const s = 2.0;
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

  /** Screen radius for a hinge angle: the sphere's own, so this is a real dome. */
  chartRadius(hingeDeg) {
    return CHART_R * Math.sin((hingeDeg * Math.PI) / 180);
  }

  /** Height of the surface at a hinge angle. */
  domeHeight(hingeDeg) {
    return CHART_R * Math.cos((hingeDeg * Math.PI) / 180);
  }

  /**
   * Where a (cock, bow) pair puts the clubhead on the dome. The horizontal axis
   * is mirrored with handedness, the same as the hand panel, so a cock toward the
   * trail side falls on the same side of the screen in both.
   */
  chartPoint(cockDeg, bowDeg) {
    const hinge = Math.hypot(cockDeg, bowDeg);
    const k = hinge > 1e-9 ? this.chartRadius(hinge) / hinge : 0;
    const H = getRig().H;
    return v3(-H * cockDeg * k, this.domeHeight(hinge), -bowDeg * k);
  }

  /** Inverse of `chartPoint`, from a point's horizontal position alone. */
  chartToWrist(p) {
    const r = Math.hypot(p.x, p.z);
    if (r < 1e-9) return { cockDeg: 0, bowDeg: 0 };
    const hinge = (Math.asin(clamp(r / CHART_R, 0, 1)) * 180) / Math.PI;
    const H = getRig().H;
    return { cockDeg: (-H * p.x * hinge) / r, bowDeg: (-p.z * hinge) / r };
  }

  /** Alias kept for the frame fit and the track. */
  tipFor(cockDeg, bowDeg) {
    return this.chartPoint(cockDeg, bowDeg);
  }

  // --- interaction ---------------------------------------------------------

  resize() {
    const rect = this.canvas.getBoundingClientRect();
    this.w = Math.max(1, rect.width);
    this.h = Math.max(1, rect.height);
    this.renderer.setSize(this.w, this.h, false);
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
  /**
   * Fit the circle to the pane. Orthographic, so this is just the half-extents;
   * the shorter side binds and the longer one gets the slack.
   */
  frame() {
    // Generous enough that the rim clears the pane title, which is drawn over the
    // top of the canvas rather than above it.
    const margin = 1.34;
    const half = CHART_R * margin;
    const aspect = this.w / this.h;
    const halfW = aspect >= 1 ? half * aspect : half;
    const halfH = aspect >= 1 ? half : half / aspect;
    this.camera.left = -halfW;
    this.camera.right = halfW;
    this.camera.top = halfH;
    this.camera.bottom = -halfH;
    this.camera.updateProjectionMatrix();
    // Cached for `rayToChart`, which undoes exactly this mapping.
    this.fit = margin;
    this.camera.aspectX = halfW / half;
    this.camera.aspectZ = halfH / half;
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
   * Where the pointer is on the chart. With an orthographic camera pointing
   * straight down, screen position and chart position are the same thing up to a
   * scale, so this only has to undo that scale -- no ray-sphere solve, and no
   * near/far branch to get wrong.
   */
  rayToChart(x, y) {
    const half = CHART_R * this.fit;
    return v3(
      ((x / this.w) * 2 - 1) * half * this.camera.aspectX,
      0,
      ((y / this.h) * 2 - 1) * half * this.camera.aspectZ,
    );
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

    const hand = v3(0, 0, 0);
    const tip = this.chartPoint(cockDeg, bowDeg);
    const along = tip.clone().sub(hand);
    const len = Math.max(along.length(), 1e-4);
    const dir = along.clone().divideScalar(len);

    this.shaft.position.copy(hand);
    this.shaft.quaternion.setFromUnitVectors(v3(0, 1, 0), dir);
    this.shaft.scale.set(1, len, 1);

    // Head orientation: the roll is a rotation about the shaft, so the head frame
    // is the shaft direction plus a reference perpendicular rolled by faceDeg.
    // Reusing the pose's own leading edge would be wrong here -- that is in world
    // space and this scene is the chart -- so it is rebuilt locally.
    let ref = new THREE.Vector3(0, 1, 0).cross(dir);
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
      // Keep labels inside the canvas: a keyframe near the rim otherwise puts its
      // name under the pane title or off the edge entirely.
      const pad = 6;
      const w = ctx.measureText(text).width;
      const minX = opts.align === 'left' ? pad : opts.align === 'right' ? w + pad : w / 2 + pad;
      const maxX = this.w - (opts.align === 'left' ? w + pad : opts.align === 'right' ? pad : w / 2 + pad);
      ctx.fillText(text, clamp(x, minX, Math.max(minX, maxX)), clamp(y, 26, this.h - pad));
    };

    // A few hinge angles numbered at their true radii, on the lower-left
    // diagonal. The contours themselves are heights, not angles, so without
    // these there would be no scale to read.
    // Staggered in bearing as well as radius: on a sphere 60 and 90 degrees sit
    // at radii 0.87 and 1.00, so on a single bearing their numbers collide.
    LABELLED.forEach((deg, i) => {
      const bearing = (-136 + i * 13) * (Math.PI / 180);
      const p = this.toScreen(this.chartPoint(deg * Math.cos(bearing), deg * Math.sin(bearing)));
      label(`${deg}°`, p.x, p.y + 4, { color: 'rgba(255,255,255,0.45)' });
    });

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
