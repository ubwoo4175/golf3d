/**
 * Club view: which way the club points, in the TORSO frame.
 *
 * The hand is pinned at the centre and never moves -- this view says nothing
 * about WHERE the hands are, only about what the club is doing. What it is
 * measured against is the torso: the shoulder line and the spine axis, the same
 * frame the hand rectangle lives in, so this pane and the one above it are two
 * halves of one picture of the body.
 *
 * It used to be measured against the LEAD FOREARM instead. That is the frame the
 * numbers are STORED in -- a wrist angle is a joint angle, and joints are
 * relative to the bone above them -- but it is a poor frame to look at, because
 * the forearm is itself swinging round. The club could be dead still in space and
 * this pane would show it moving. Reading it meant holding two rotations in your
 * head at once. The torso frame removes one of them: legs and spine are static in
 * this model, so a shaft that holds still on the chart is a shaft that is close to
 * holding still in the world.
 *
 * THE CHART is a sphere of directions, looked at straight DOWN THE SPINE AXIS,
 * from above the golfer's head.
 *
 *   centre       the club hanging straight down the spine axis
 *   radius       phi, the angle away from straight down, 0 at the centre and 180
 *                at the rim -- so the whole sphere fits, and the club may point
 *                anywhere at all. Radius is phi/180, evenly spaced, which is what
 *                makes the map one-to-one: a true orthographic sphere would put
 *                phi and 180-phi on the same ring and a drag could not tell them
 *                apart.
 *   bearing      which way round the body the club is pointing: toward the ball,
 *                behind you, toward the lead side, toward the trail side.
 *
 * The surface is drawn at the sphere's own HEIGHT, `-cos(phi)`, so it reads as a
 * bowl with a flared rim: the club hanging straight down is at the bottom of the
 * bowl, horizontal is the 90 ring at the lip, and anything above horizontal is out
 * on the brim. Contours are lines of equal height, as on a topographic map, which
 * is what makes a flat circle read as a curved surface.
 *
 * The shaft is drawn translucent from the hand at the centre out to the surface.
 * Seen from directly above it is foreshortened, and that foreshortening is the
 * depth cue: a short stub means the club is pointing nearly straight up or down.
 *
 * A 2D overlay carries the text and the face dial. Roll about the shaft is the
 * third degree of freedom, and having no direction of its own it has nowhere to
 * live on a direction chart.
 */

import * as THREE from 'three';

import { COLORS, CLUB } from './config.js';
import { getRig, getClub } from './rig.js';
import { wristForDirection } from './club.js';
import { phaseAt, RELEASE_T } from './swing.js';
import { clamp } from './vec3.js';

const GRAB_RADIUS_PX = 15;
/** The chart holds the whole sphere: straight down to straight up. */
const MAX_PHI = 180;
const CHART_R = 1;
/** Contour spacing, as a fraction of the sphere radius. Equal HEIGHT steps. */
const CONTOUR_STEP = 0.1;
/** Rings worth a number, at their own radii. 90 is the horizon. */
const LABELLED = [45, 90, 135];
const DIAL_RADIUS = 30;
const DIAL_INSET = 46;

const v3 = (x, y, z) => new THREE.Vector3(x, y, z);
const rad = (deg) => (deg * Math.PI) / 180;

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
    // an orbit control would fight the drag for the same mouse button.
    //
    // Orthographic and straight down the spine axis. Perspective would scale the
    // rings by their height and pull the map off the even radial spacing it
    // depends on; orthographic makes screen position exactly the chart position.
    //
    // With the camera up at -Z, screen right is +X and screen UP is -Z. So the
    // scene's +X is the trail side and its -Z is the ball -- see `chartPoint`.
    this.camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0.01, 20);
    this.camera.position.set(0, 6, 0);
    this.camera.up.set(0, 0, -1);
    this.camera.lookAt(0, 0, 0);

    this.build();
    this.resize();
    this.bind();
  }

  // --- the chart -----------------------------------------------------------

  /** Chart radius for a polar angle away from straight down. Evenly spaced. */
  chartRadius(phiDeg) {
    return (CHART_R * phiDeg) / MAX_PHI;
  }

  /** Height of the surface there: the sphere's own, which is what curves it. */
  domeHeight(phiDeg) {
    return -CHART_R * Math.cos(rad(phiDeg));
  }

  /**
   * A direction in TORSO components to a point on the chart.
   *
   * @param s  along the shoulder line, + toward the lead side
   * @param u  along the spine axis, + toward the head
   * @param f  along the chest normal, + toward the ball
   *
   * Screen right is the TRAIL side and screen up is the ball, which is the same
   * arrangement as the hand rectangle above: the golfer's own view of their own
   * hands, mirrored with handedness so it holds for a lefty too.
   */
  chartPoint(s, u, f) {
    const phi = (Math.acos(clamp(-u, -1, 1)) * 180) / Math.PI;
    const r = this.chartRadius(phi);
    const flat = Math.hypot(s, f);
    const H = getRig().H;
    if (flat < 1e-9) return v3(0, this.domeHeight(phi), 0);
    return v3((-H * s * r) / flat, this.domeHeight(phi), (-f * r) / flat);
  }

  /** Inverse: a point's horizontal position back to a torso-frame direction. */
  chartToDirection(p) {
    const H = getRig().H;
    const r = Math.min(Math.hypot(p.x, p.z), CHART_R);
    const phi = rad((r / CHART_R) * MAX_PHI);
    const u = -Math.cos(phi);
    const flat = Math.hypot(p.x, p.z);
    if (flat < 1e-9) return { s: 0, u, f: 0 };
    const k = Math.sin(phi) / flat;
    return { s: -H * p.x * k, u, f: -p.z * k };
  }

  /** The club's direction at a pose, in torso components. */
  torsoDirection(pose) {
    const d = pose.club.shaftDir;
    const b = pose.basis;
    return {
      s: d.x * b.side.x + d.y * b.side.y + d.z * b.side.z,
      u: d.x * b.up.x + d.y * b.up.y + d.z * b.up.z,
      f: d.x * b.fwd.x + d.y * b.fwd.y + d.z * b.fwd.z,
    };
  }

  /** Where a pose puts the clubhead on the chart. */
  pointFor(pose) {
    const { s, u, f } = this.torsoDirection(pose);
    return this.chartPoint(s, u, f);
  }

  /** Polar angle away from straight down, in degrees -- the chart's radius. */
  phiOf(pose) {
    return (Math.acos(clamp(-this.torsoDirection(pose).u, -1, 1)) * 180) / Math.PI;
  }

  // --- scene ---------------------------------------------------------------

  build() {
    // Lit from LOW and to one side, not from the camera. Overhead light on a
    // top-down surface is nearly uniform, which is what would make it read as a
    // flat disk -- the whole job of the shading here is to say "this is curved".
    this.scene.add(new THREE.AmbientLight('#4a5f80', 0.55));
    const key = new THREE.DirectionalLight('#eaf2ff', 1.5);
    key.position.set(-2.2, 1.1, -1.6);
    this.scene.add(key);
    const fill = new THREE.DirectionalLight('#3d5f8f', 0.7);
    fill.position.set(2.0, 0.6, 1.8);
    this.scene.add(fill);

    // The surface: the sphere of directions, radially re-parameterised so the far
    // half does not fold back over the near one. Translucent and double-sided so
    // the shaft inside it stays visible, with depthWrite off so it never occludes
    // what it contains.
    const rings = 96;
    const segments = 96;
    const positions = [];
    const index = [];
    for (let i = 0; i <= rings; i += 1) {
      const phi = (i / rings) * MAX_PHI;
      const r = this.chartRadius(phi);
      const y = this.domeHeight(phi);
      for (let j = 0; j <= segments; j += 1) {
        const b = (j / segments) * Math.PI * 2;
        positions.push(r * Math.cos(b), y, r * Math.sin(b));
      }
    }
    for (let i = 0; i < rings; i += 1) {
      for (let j = 0; j < segments; j += 1) {
        const a = i * (segments + 1) + j;
        const c = a + segments + 1;
        index.push(a, c, a + 1, a + 1, c, c + 1);
      }
    }
    const surfaceGeometry = new THREE.BufferGeometry();
    surfaceGeometry.setAttribute(
      'position',
      new THREE.Float32BufferAttribute(positions, 3),
    );
    surfaceGeometry.setIndex(index);
    surfaceGeometry.computeVertexNormals();
    const surface = new THREE.Mesh(
      surfaceGeometry,
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

    // Contours of equal HEIGHT, like a topographic map. They bunch where the
    // surface is steep and open out where it flattens, and that unevenness is
    // what reads as curvature -- rings spaced by angle would be evenly spaced and
    // read as a flat target.
    const contours = [];
    for (let k = -1 + CONTOUR_STEP; k < 1; k += CONTOUR_STEP) {
      const phi = (Math.acos(clamp(-k, -1, 1)) * 180) / Math.PI;
      const r = this.chartRadius(phi);
      const y = this.domeHeight(phi);
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
      new THREE.LineBasicMaterial({ color: '#7d9cc4', transparent: true, opacity: 0.36 }),
    );
    contourLines.renderOrder = 1;
    this.scene.add(contourLines);

    // The horizon -- the club exactly level -- and the rim, the club straight up.
    // The horizon is the one ring worth picking out: inside it the club points
    // below level, outside it above.
    for (const [phi, color, opacity] of [
      [90, '#9fb8d8', 0.85],
      [MAX_PHI, '#5b779a', 0.5],
    ]) {
      const pts = [];
      const r = this.chartRadius(phi);
      const y = this.domeHeight(phi);
      for (let i = 0; i <= 160; i += 1) {
        const b = (i / 160) * Math.PI * 2;
        pts.push(v3(r * Math.cos(b), y, r * Math.sin(b)));
      }
      const line = new THREE.Line(
        new THREE.BufferGeometry().setFromPoints(pts),
        new THREE.LineBasicMaterial({ color, transparent: true, opacity }),
      );
      line.renderOrder = 1;
      this.scene.add(line);
    }

    // Meridians every 30 degrees of bearing.
    const meridians = [];
    for (let b = 0; b < 360; b += 30) {
      const bearing = rad(b);
      for (let i = 0; i < 48; i += 1) {
        for (const phi of [(MAX_PHI * i) / 48, (MAX_PHI * (i + 1)) / 48]) {
          const r = this.chartRadius(phi);
          meridians.push(
            v3(r * Math.cos(bearing), this.domeHeight(phi), r * Math.sin(bearing)),
          );
        }
      }
    }
    const meridianLines = new THREE.LineSegments(
      new THREE.BufferGeometry().setFromPoints(meridians),
      new THREE.LineBasicMaterial({ color: '#5b779a', transparent: true, opacity: 0.26 }),
    );
    meridianLines.renderOrder = 1;
    this.scene.add(meridianLines);

    // The hand is the centre of the sphere, which is also the centre of the
    // circle on screen. The spine axis runs straight away from the camera in this
    // view, so there is nothing to draw for it.
    const hand = new THREE.Mesh(
      new THREE.SphereGeometry(0.05, 20, 16),
      new THREE.MeshStandardMaterial({ color: COLORS.hand, roughness: 0.4 }),
    );
    this.scene.add(hand);

    // The club: shaft, head body and face, in a group whose basis is set from the
    // shaft direction and the roll each frame. Translucent, and drawn after the
    // surface so it reads through it.
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
    // Chart positions depend on handedness through the mirror, so a flip has to
    // invalidate the cached track.
    this.trackStamp = null;
  }

  activeIndex() {
    return this.swing.nearestKeyframeIndex(this.store.state.t);
  }

  /** Project a scene point to overlay pixels. */
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
      const p = this.toScreen(this.pointFor(this.swing.poseAt(k.t)));
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
        this.mode = 'aim';
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

  /**
   * Turn a drag into a stored wrist pair.
   *
   * The chart is in the torso frame and the storage is in the hand frame, so this
   * goes the long way round: chart point -> torso components -> world direction ->
   * `wristForDirection`. The hand frame is built from the hand and the two elbows,
   * none of which the wrist touches, so it is fixed for the whole of a drag.
   */
  applyDrag(x, y) {
    if (this.mode === 'face') {
      const deg = (Math.atan2(this.dial.y - y, x - this.dial.x) * 180) / Math.PI;
      this.swing.setKeyframeWrist(this.index, { faceDeg: Math.round(90 - deg) });
      return;
    }
    const { s, u, f } = this.chartToDirection(this.rayToChart(x, y));
    const pose = this.swing.poseAt(this.swing.keys[this.index].t);
    const b = pose.basis;
    const dir = {
      x: s * b.side.x + u * b.up.x + f * b.fwd.x,
      y: s * b.side.y + u * b.up.y + f * b.fwd.y,
      z: s * b.side.z + u * b.up.z + f * b.fwd.z,
    };
    const { cockDeg, bowDeg } = wristForDirection(pose.handFrame, dir);
    this.swing.setKeyframeWrist(this.index, { cockDeg, bowDeg });
  }

  // --- drawing -------------------------------------------------------------

  draw(pose) {
    const { faceDeg } = pose.wrist;

    const hand = v3(0, 0, 0);
    const tip = this.pointFor(pose);
    const along = tip.clone().sub(hand);
    const len = Math.max(along.length(), 1e-4);
    const dir = along.clone().divideScalar(len);

    this.shaft.position.copy(hand);
    this.shaft.quaternion.setFromUnitVectors(v3(0, 1, 0), dir);
    this.shaft.scale.set(1, len, 1);

    // Head orientation: the roll is a rotation about the shaft, so the head frame
    // is the shaft direction plus a reference perpendicular rolled by faceDeg.
    // Reusing the pose's own head axes would be wrong here -- those are in world
    // space and this scene is the chart -- so it is rebuilt locally.
    let ref = new THREE.Vector3(0, 1, 0).cross(dir);
    if (ref.lengthSq() < 1e-8) ref = new THREE.Vector3(1, 0, 0);
    ref.normalize();
    const roll = rad(CLUB.faceZeroDeg + faceDeg);
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

  /** The club's track and the keyframe markers, rebuilt when the swing changes. */
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
      const p = this.pointFor(this.swing.poseAt(t));
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
      m.position.copy(this.pointFor(this.swing.poseAt(k.t)));
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
      const maxX =
        this.w - (opts.align === 'left' ? w + pad : opts.align === 'right' ? pad : w / 2 + pad);
      ctx.fillText(text, clamp(x, minX, Math.max(minX, maxX)), clamp(y, 26, this.h - pad));
    };

    // A few rings numbered at their own radii, on the lower-left diagonal. The
    // contours themselves are heights, not angles, so without these there would
    // be no scale to read.
    LABELLED.forEach((deg, i) => {
      const bearing = rad(-134 + i * 10);
      const r = this.chartRadius(deg);
      const p = this.toScreen(
        v3(r * Math.cos(bearing), this.domeHeight(deg), r * Math.sin(bearing)),
      );
      label(`${deg}°`, p.x, p.y + 4, { color: 'rgba(255,255,255,0.45)' });
    });

    const active = this.activeIndex();
    const k = this.swing.keys[active];
    if (k) {
      const p = this.toScreen(this.pointFor(this.swing.poseAt(k.t)));
      label(k.label, p.x + 12, p.y - 16, { align: 'left', color: '#ffffff' });
    }

    // The four bearings, on the rim. This is the whole point of the torso frame:
    // the chart's compass is the body, not the forearm.
    const sides = getRig().sides;
    // Each label is placed by asking the chart itself where that direction goes,
    // pushed just outside the rim. Height does not matter -- the camera is
    // orthographic and straight down, so only x and z reach the screen.
    const compass = [
      ['toward the ball', 0, 0, 1],
      ['behind you', 0, 0, -1],
      [`lead (${sides.lead})`, 1, 0, 0],
      [`trail (${sides.trail})`, -1, 0, 0],
    ];
    for (const [text, s, u, f] of compass) {
      const c = this.chartPoint(s, u, f);
      const p = this.toScreen(v3(c.x * 2.14, 0, c.z * 2.14));
      label(text, p.x, p.y, { color: 'rgba(255,255,255,0.4)' });
    }

    label(
      `${this.phiOf(pose).toFixed(0)}° from straight down` +
        `   ·   face ${pose.wrist.faceDeg >= 0 ? '+' : ''}${pose.wrist.faceDeg.toFixed(0)}°`,
      this.w - 12,
      this.h - 12,
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

    const a = rad(90 - roll);
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
