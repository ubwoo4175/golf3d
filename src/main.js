/**
 * Wiring: one store, one swing, two views, one animation loop.
 *
 * The timeline is the master clock. `t` sets the torso angle, the reference hand
 * position and which arm is locked straight; dragging on the 2D rectangle
 * rewrites a keyframe, which invalidates the cached path so both views pick up
 * the new shape on the next frame.
 */

import { TIMING, REACH } from './config.js';
import { SwingPath, phaseAt, RELEASE_T } from './swing.js';
import { setHandedness, setSpineTilt, setPlaneOffset, getRig } from './kinematics.js';
import { Store } from './state.js';
import { PlaneView } from './view2d.js';
import { SceneView } from './view3d.js';

const $ = (id) => document.getElementById(id);

const swing = new SwingPath();
const store = new Store(swing);

const planeView = new PlaneView($('plane-canvas'), store, swing);
const sceneView = new SceneView($('scene-canvas'), store, swing);

swing.onChange(() => sceneView.refreshPaths());

// --- controls --------------------------------------------------------------

const playButton = $('play');
const scrub = $('scrub');
const speed = $('speed');
const handButton = $('handedness');
const spineTiltInput = $('spine-tilt');
const spineTiltOut = $('spine-tilt-out');

// The rectangle is pinned to the address hand, so it follows P1 wherever P1 goes
// -- dragged, reset, or moved by the spine slider. Registered before the view's
// own listener so the offset is current by the time the paths refresh.
const syncPlaneToAddress = () => setPlaneOffset(swing.addressAxisDistance());
swing.onChange(syncPlaneToAddress);
syncPlaneToAddress();

playButton.addEventListener('click', () => store.set({ playing: !store.state.playing }));
scrub.addEventListener('input', () =>
  store.set({ t: Number(scrub.value) / 1000, playing: false }),
);
speed.addEventListener('input', () => store.set({ speed: Number(speed.value) / 100 }));

/**
 * Spine tilt stands in for club length.
 *
 * P1 is deliberately NOT touched: the address hand is anchored to a fixed point
 * on the rectangle, so tilting only rotates the torso frame underneath it. The
 * world positions all change, hence the emit to drop the cached path, but the
 * camera is left exactly where you put it.
 */
spineTiltInput.addEventListener('input', () => {
  const deg = Number(spineTiltInput.value);
  setSpineTilt(deg);
  swing.emit();
  store.set({ spineTilt: deg });
  sceneView.rebuildRig();
});

$('prev-key').addEventListener('click', () => store.stepKeyframe(-1));
$('next-key').addEventListener('click', () => store.stepKeyframe(1));
$('reset-path').addEventListener('click', () => swing.reset());
$('reset-camera').addEventListener('click', () => sceneView.resetCamera());

/**
 * Flip handedness. The keyframes are untouched -- u is always measured toward
 * the lead side -- so the same swing is simply mirrored onto the other side.
 */
function applyHandedness(handedness) {
  setHandedness(handedness);
  store.set({ handedness });
  swing.emit(); // world positions changed, so drop the cached path
  planeView.layout(); // the 2D horizontal axis follows handedness
  sceneView.rebuildRig({ mirrorCamera: true });
}

handButton.addEventListener('click', () =>
  applyHandedness(store.state.handedness === 'right' ? 'left' : 'right'),
);

for (const key of ['showPath', 'showPlane', 'showLocalPath', 'showGuides']) {
  const input = $(key);
  input.checked = store.state[key];
  input.addEventListener('change', () => store.set({ [key]: input.checked }));
}

window.addEventListener('keydown', (event) => {
  if (event.target.tagName === 'INPUT') return;
  if (event.code === 'Space') {
    event.preventDefault();
    store.set({ playing: !store.state.playing });
  }
  if (event.code === 'ArrowLeft') store.stepKeyframe(-1);
  if (event.code === 'ArrowRight') store.stepKeyframe(1);
  if (event.code === 'KeyH') {
    applyHandedness(store.state.handedness === 'right' ? 'left' : 'right');
  }
});

// --- readouts --------------------------------------------------------------

const readouts = {
  keyframe: $('r-keyframe'),
  phase: $('r-phase'),
  time: $('r-time'),
  torso: $('r-torso'),
  hand: $('r-hand'),
  offset: $('r-offset'),
  lead: $('r-lead'),
  trail: $('r-trail'),
};
const labels = { lead: $('l-lead'), trail: $('l-trail') };

const armText = (arm) =>
  arm.overextended
    ? `out of reach by ${((arm.reach - REACH) * 100).toFixed(1)} cm`
    : `${(arm.reachRatio * 100).toFixed(1)}% ext · ${arm.flexDeg.toFixed(0)}° flex`;

function updateReadouts(pose) {
  const t = store.state.t;
  const turn = (pose.theta * 180) / Math.PI;

  readouts.phase.textContent = phaseAt(t).label;
  readouts.time.textContent = `${(t * TIMING.swingSeconds).toFixed(2)}s · t ${t.toFixed(3)}`;
  readouts.torso.textContent = `${turn > 0 ? '+' : ''}${turn.toFixed(0)}°`;
  readouts.hand.textContent = `u ${(pose.u * 100).toFixed(1)} v ${(pose.v * 100).toFixed(1)}`;

  const off = pose.normalOffset * 100;
  readouts.offset.textContent = pose.reachable
    ? `${off >= 0 ? '+' : ''}${off.toFixed(1)} cm · axis ${(pose.axisDistance * 100).toFixed(1)}`
    : 'no solution';
  readouts.offset.classList.toggle('warn', !pose.reachable);

  for (const which of ['lead', 'trail']) {
    readouts[which].textContent = armText(pose[which]);
    readouts[which].classList.toggle('warn', pose[which].overextended);
    // Mark whichever arm the rules are currently holding straight.
    labels[which].textContent = `${which} (${pose.sides[which]})`;
    labels[which].classList.toggle('locked', pose.constraint === which);
  }

  const active = swing.keys[swing.nearestKeyframeIndex(t)];
  readouts.keyframe.textContent =
    active && Math.abs(active.t - t) < 1e-3 ? active.label : `→ ${active.label}`;
}

// --- loop ------------------------------------------------------------------

store.subscribe((state) => {
  playButton.textContent = state.playing ? '❚❚ Pause' : '▶ Play';
  if (document.activeElement !== scrub) scrub.value = String(Math.round(state.t * 1000));
  const sides = getRig().sides;
  handButton.textContent = `${state.handedness === 'right' ? 'Right' : 'Left'}-handed`;
  handButton.title = `Lead arm is the ${sides.lead}. Click or press H to flip.`;
  spineTiltOut.textContent = `${state.spineTilt}°`;
  spineTiltInput.value = String(state.spineTilt);
});

let last = performance.now();
function frame(now) {
  const dt = Math.min((now - last) / 1000, 0.1);
  last = now;
  store.tick(dt);

  const pose = swing.poseAt(store.state.t);
  planeView.draw(pose);
  sceneView.draw(pose);
  updateReadouts(pose);

  requestAnimationFrame(frame);
}
requestAnimationFrame(frame);

// --- layout ---------------------------------------------------------------

const observer = new ResizeObserver((entries) => {
  for (const entry of entries) {
    if (entry.target === planeView.canvas) planeView.resize();
    if (entry.target === sceneView.canvas) sceneView.resize();
  }
});
observer.observe(planeView.canvas);
observer.observe(sceneView.canvas);

// Surface the constraint handover in the legend so the rule is discoverable.
$('release-label').textContent = `P7.5 release · t ${RELEASE_T}`;
