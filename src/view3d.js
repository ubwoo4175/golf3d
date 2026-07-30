/**
 * 3D view: the whole swing in world space.
 *
 * Static scaffolding (ground, ball, legs, pelvis, spine axis) is built once.
 * Everything downstream of the torso rotation is repositioned each frame from
 * the pose, including the hand plane, which spins with the torso and carries
 * the 2D view's rectangle with it.
 */

import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';

import { BODY, PLANE, SCENE, COLORS } from './config.js';
import { HIP_PIVOT, SHOULDER_CENTER, SPINE_AXIS, planeToWorld } from './kinematics.js';
import { PHASES } from './swing.js';
import * as V from './vec3.js';

const v3 = (p) => new THREE.Vector3(p.x, p.y, p.z);
const UP_Y = new THREE.Vector3(0, 1, 0);

/** A capsule-ish limb that can be re-aimed between two points every frame. */
class Segment {
  constructor(parent, radius, color, opacity = 1) {
    const geometry = new THREE.CylinderGeometry(radius, radius, 1, 12);
    geometry.translate(0, 0.5, 0); // origin at the base so scale.y == length
    this.mesh = new THREE.Mesh(
      geometry,
      new THREE.MeshStandardMaterial({
        color,
        roughness: 0.55,
        metalness: 0.1,
        transparent: opacity < 1,
        opacity,
        depthWrite: opacity >= 1,
      }),
    );
    parent.add(this.mesh);
  }

  aim(a, b) {
    const from = v3(a);
    const to = v3(b);
    const dir = to.clone().sub(from);
    const len = dir.length();
    this.mesh.position.copy(from);
    this.mesh.quaternion.setFromUnitVectors(UP_Y, dir.normalize());
    this.mesh.scale.set(1, Math.max(len, 1e-4), 1);
  }

  setColor(hex) {
    this.mesh.material.color.set(hex);
  }
}

/**
 * A phase-coloured tube through a sampled path.
 *
 * One tube per phase rather than one vertex-coloured tube: the phase boundaries
 * land exactly on the right sample, and `LineBasicMaterial` cannot be made
 * thicker than a hairline on any platform we care about.
 */
class PathTube {
  constructor(parent, radius, opacity = 1) {
    this.radius = radius;
    this.meshes = PHASES.map((phase) => {
      const mesh = new THREE.Mesh(
        new THREE.BufferGeometry(),
        new THREE.MeshBasicMaterial({
          color: COLORS[phase.id],
          transparent: opacity < 1,
          opacity,
        }),
      );
      mesh.visible = false;
      mesh.userData.phase = phase.id;
      parent.add(mesh);
      return mesh;
    });
    this.wanted = true;
  }

  /**
   * @param samples  ordered samples carrying a `phase` id
   * @param toPoint  sample -> THREE.Vector3
   */
  update(samples, toPoint) {
    for (const mesh of this.meshes) {
      const first = samples.findIndex((s) => s.phase === mesh.userData.phase);
      let last = -1;
      for (let i = samples.length - 1; i >= 0; i -= 1) {
        if (samples[i].phase === mesh.userData.phase) {
          last = i;
          break;
        }
      }
      if (first < 0 || last - first < 1) {
        mesh.userData.empty = true;
        mesh.visible = false;
        continue;
      }
      // Extend one sample either side so neighbouring phases butt together.
      const points = samples
        .slice(Math.max(0, first - 1), Math.min(samples.length, last + 2))
        .map(toPoint);
      mesh.geometry.dispose();
      mesh.geometry = new THREE.TubeGeometry(
        new THREE.CatmullRomCurve3(points),
        points.length - 1,
        this.radius,
        7,
        false,
      );
      mesh.userData.empty = false;
      mesh.visible = this.wanted;
    }
  }

  setVisible(visible) {
    this.wanted = visible;
    for (const mesh of this.meshes) mesh.visible = visible && !mesh.userData.empty;
  }
}

function joint(parent, radius, color, opacity = 1) {
  const mesh = new THREE.Mesh(
    new THREE.SphereGeometry(radius, 18, 14),
    new THREE.MeshStandardMaterial({
      color,
      roughness: 0.4,
      transparent: opacity < 1,
      opacity,
      depthWrite: opacity >= 1,
    }),
  );
  parent.add(mesh);
  return mesh;
}

export class SceneView {
  constructor(canvas, store, swing) {
    this.canvas = canvas;
    this.store = store;
    this.swing = swing;

    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));

    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color('#0a0f1a');
    this.scene.fog = new THREE.Fog('#0a0f1a', 6, 14);

    this.camera = new THREE.PerspectiveCamera(45, 1, 0.05, 100);
    this.camera.position.copy(v3(SCENE.cameraStart));

    this.controls = new OrbitControls(this.camera, canvas);
    this.controls.target.copy(v3(SCENE.cameraTarget));
    this.controls.enableDamping = true;
    this.controls.dampingFactor = 0.08;

    this.buildLights();
    this.buildStatic();
    this.buildBody();
    this.buildPaths();

    this.resize();
  }

  buildLights() {
    this.scene.add(new THREE.HemisphereLight('#cfe4ff', '#1b2436', 0.85));
    const key = new THREE.DirectionalLight('#ffffff', 1.1);
    key.position.set(2.5, 4, -1.5);
    this.scene.add(key);
    const rim = new THREE.DirectionalLight('#7fb2ff', 0.4);
    rim.position.set(-3, 1.5, 2);
    this.scene.add(rim);
  }

  buildStatic() {
    const grid = new THREE.GridHelper(6, 24, '#22303f', '#161f2b');
    this.scene.add(grid);

    const ball = joint(this.scene, SCENE.ballRadius, '#ffffff');
    ball.position.copy(v3(SCENE.ballPosition));

    // Target line, marking the +X direction the ball flies.
    const target = new THREE.Line(
      new THREE.BufferGeometry().setFromPoints([
        new THREE.Vector3(SCENE.ballPosition.x - 1.2, 0.002, SCENE.ballPosition.z),
        new THREE.Vector3(SCENE.ballPosition.x + 2.4, 0.002, SCENE.ballPosition.z),
      ]),
      new THREE.LineBasicMaterial({ color: '#2f6f4f' }),
    );
    this.scene.add(target);

    // Legs and pelvis: static by assumption, so they are placed once.
    const op = SCENE.bodyOpacity;
    const half = BODY.pelvisWidth / 2;
    for (const s of [1, -1]) {
      const hip = V.vec(HIP_PIVOT.x + s * half, HIP_PIVOT.y, HIP_PIVOT.z);
      const knee = V.vec(s * (half + BODY.footSpread / 2) / 2, BODY.kneeHeight, BODY.kneeForward);
      const foot = V.vec((s * BODY.footSpread) / 2, 0.03, 0.02);
      new Segment(this.scene, 0.04, '#5c6a7d', op).aim(hip, knee);
      new Segment(this.scene, 0.035, '#5c6a7d', op).aim(knee, foot);
      joint(this.scene, 0.045, '#5c6a7d', op).position.copy(v3(hip));
      joint(this.scene, 0.04, '#5c6a7d', op).position.copy(v3(knee));
    }
    new Segment(this.scene, 0.045, '#5c6a7d', op).aim(
      V.vec(HIP_PIVOT.x + half, HIP_PIVOT.y, HIP_PIVOT.z),
      V.vec(HIP_PIVOT.x - half, HIP_PIVOT.y, HIP_PIVOT.z),
    );

    // Spine axis: the fixed rotation axis, drawn well past the head.
    const axisEnd = V.addScaled(HIP_PIVOT, SPINE_AXIS.dir, BODY.torsoLength + 0.55);
    const axisStart = V.addScaled(HIP_PIVOT, SPINE_AXIS.dir, -0.25);
    this.scene.add(
      new THREE.Line(
        new THREE.BufferGeometry().setFromPoints([v3(axisStart), v3(axisEnd)]),
        new THREE.LineDashedMaterial({ color: '#4d5f75', dashSize: 0.05, gapSize: 0.04 }),
      ).computeLineDistances(),
    );
  }

  buildBody() {
    const op = SCENE.bodyOpacity;
    this.torso = new Segment(this.scene, 0.06, COLORS.body, op);
    this.torso.aim(HIP_PIVOT, SHOULDER_CENTER);
    this.shoulderLine = new Segment(this.scene, 0.045, COLORS.body, op);
    this.neck = new Segment(this.scene, 0.03, COLORS.body, op);

    this.head = joint(this.scene, BODY.headRadius, '#b9c6d6', op);
    this.joints = {
      leadShoulder: joint(this.scene, 0.05, COLORS.body, op + 0.2),
      trailShoulder: joint(this.scene, 0.05, COLORS.body, op + 0.2),
      leadElbow: joint(this.scene, 0.042, '#78f0be'),
      trailElbow: joint(this.scene, 0.042, '#ff8c8c'),
      hand: joint(this.scene, 0.05, COLORS.hand),
    };

    // Arms and hands stay fully opaque: they are what the app is about.
    this.limbs = {
      leadUpper: new Segment(this.scene, 0.038, '#78f0be'),
      leadFore: new Segment(this.scene, 0.033, '#78f0be'),
      trailUpper: new Segment(this.scene, 0.038, '#ff8c8c'),
      trailFore: new Segment(this.scene, 0.033, '#ff8c8c'),
      elbowLine: new Segment(this.scene, 0.013, COLORS.elbowLine),
    };

    // Shoulders-to-hands triangle, redrawn each frame.
    this.triangle = new THREE.Line(
      new THREE.BufferGeometry().setAttribute(
        'position',
        new THREE.BufferAttribute(new Float32Array(4 * 3), 3),
      ),
      new THREE.LineBasicMaterial({ color: '#ffffff', transparent: true, opacity: 0.35 }),
    );
    this.scene.add(this.triangle);

    // The hand plane rectangle. Held in a group so the pose only has to set the
    // group's transform.
    this.planeGroup = new THREE.Group();
    const geometry = new THREE.PlaneGeometry(PLANE.uMax - PLANE.uMin, PLANE.vMax - PLANE.vMin);
    this.planeMesh = new THREE.Mesh(
      geometry,
      new THREE.MeshBasicMaterial({
        color: COLORS.plane,
        transparent: true,
        opacity: 0.09,
        side: THREE.DoubleSide,
        depthWrite: false,
      }),
    );
    this.planeOutline = new THREE.LineSegments(
      new THREE.EdgesGeometry(geometry),
      new THREE.LineBasicMaterial({ color: COLORS.plane, transparent: true, opacity: 0.5 }),
    );
    this.planeGroup.add(this.planeMesh, this.planeOutline);
    this.scene.add(this.planeGroup);
  }

  buildPaths() {
    this.worldPath = new PathTube(this.scene, 0.009);
    // The same path in torso-local coordinates, drawn on the rotating plane so
    // you can see the 2D trace ride around with the body. Lives in the plane
    // group, whose own frame is (u, v, plane normal).
    this.localTrace = new THREE.Group();
    this.planeGroup.add(this.localTrace);
    this.localPath = new PathTube(this.localTrace, 0.005, 0.85);
    this.refreshPaths();
  }

  /** Recompute both path curves. Called whenever a keyframe moves. */
  refreshPaths() {
    const { world, local } = this.swing.sampledPath();
    this.worldPath.update(world, (s) => v3(s.p));
    this.localPath.update(local, (s) => new THREE.Vector3(s.u, s.v, 0));
  }

  resize() {
    const rect = this.canvas.getBoundingClientRect();
    const w = Math.max(1, rect.width);
    const h = Math.max(1, rect.height);
    // `false` leaves the CSS size to the flex layout; only the drawing buffer
    // is resized, which is what keeps it in step with the measured box.
    this.renderer.setSize(w, h, false);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
  }

  resetCamera() {
    this.camera.position.copy(v3(SCENE.cameraStart));
    this.controls.target.copy(v3(SCENE.cameraTarget));
    this.controls.update();
  }

  draw(pose) {
    const { showPath, showPlane, showLocalPath } = this.store.state;
    const { basis, lead, trail } = pose;

    this.shoulderLine.aim(pose.trailShoulder, pose.leadShoulder);
    this.neck.aim(pose.shoulderCenter, pose.head);
    this.head.position.copy(v3(pose.head));

    this.joints.leadShoulder.position.copy(v3(pose.leadShoulder));
    this.joints.trailShoulder.position.copy(v3(pose.trailShoulder));
    this.joints.leadElbow.position.copy(v3(lead.elbow));
    this.joints.trailElbow.position.copy(v3(trail.elbow));
    this.joints.hand.position.copy(v3(pose.hand));

    this.limbs.leadUpper.aim(pose.leadShoulder, lead.elbow);
    this.limbs.leadFore.aim(lead.elbow, pose.hand);
    this.limbs.trailUpper.aim(pose.trailShoulder, trail.elbow);
    this.limbs.trailFore.aim(trail.elbow, pose.hand);
    this.limbs.elbowLine.aim(lead.elbow, trail.elbow);

    const badLead = lead.overextended ? '#ff3b52' : '#78f0be';
    const badTrail = trail.overextended ? '#ff3b52' : '#ff8c8c';
    this.limbs.leadUpper.setColor(badLead);
    this.limbs.leadFore.setColor(badLead);
    this.limbs.trailUpper.setColor(badTrail);
    this.limbs.trailFore.setColor(badTrail);

    const tri = this.triangle.geometry.attributes.position;
    [pose.leadShoulder, pose.hand, pose.trailShoulder, pose.leadShoulder].forEach((p, i) =>
      tri.setXYZ(i, p.x, p.y, p.z),
    );
    tri.needsUpdate = true;

    // Plane group: centre of the rectangle, oriented by (side, up, fwd).
    const centre = planeToWorld(
      basis,
      (PLANE.uMin + PLANE.uMax) / 2,
      (PLANE.vMin + PLANE.vMax) / 2,
    );
    this.planeGroup.position.copy(v3(centre));
    // (side, up, fwd) is a left-handed triple (fwd = up x side), so the third
    // basis column is negated to keep the rotation matrix a pure rotation. The
    // rectangle is two-sided, so which way its normal faces is immaterial.
    this.planeGroup.setRotationFromMatrix(
      new THREE.Matrix4().makeBasis(v3(basis.side), v3(basis.up), v3(V.scale(basis.fwd, -1))),
    );
    // Offset the local trace so it sits in the rectangle's own centred frame.
    this.localTrace.position.set(
      -(PLANE.uMin + PLANE.uMax) / 2,
      -(PLANE.vMin + PLANE.vMax) / 2,
      0,
    );

    this.planeGroup.visible = showPlane;
    this.localPath.setVisible(showPlane && showLocalPath);
    this.worldPath.setVisible(showPath);

    this.controls.update();
    this.renderer.render(this.scene, this.camera);
  }
}
