/**
 * Wiring: one store, one swing, two views, one animation loop.
 *
 * The timeline is the master clock. `t` sets the torso angle, the reference hand
 * position and which arm is locked straight; dragging on the 2D rectangle
 * rewrites a keyframe, which invalidates the cached path so both views pick up
 * the new shape on the next frame.
 */

import { TIMING, REACH, CLUBS, clubReach } from './config.js';
import { SwingPath, phaseAt, RELEASE_T } from './swing.js';
import { setHandedness, setClub, getClub, setPlaneOffset, getRig, ballPosition } from './rig.js';
import { setClubLength, faceAngleToTarget } from './club.js';
import { distance } from './vec3.js';
import { Store } from './state.js';
import { PlaneView } from './view2d.js';
import { WristView } from './view-wrist.js';
import { SceneView } from './view3d.js';

const $ = (id) => document.getElementById(id);

const swing = new SwingPath();
const store = new Store(swing);

const planeView = new PlaneView($('plane-canvas'), store, swing);
const wristView = new WristView($('wrist-canvas'), $('wrist-overlay'), store, swing);
const sceneView = new SceneView($('scene-canvas'), store, swing);

swing.onChange(() => sceneView.refreshPaths());

// --- controls --------------------------------------------------------------

const playButton = $('play');
const scrub = $('scrub');
const speed = $('speed');
const handButton = $('handedness');
const clubInput = $('club');
const clubOut = $('club-out');

// The rectangle is pinned to the address hand, so it follows P1 wherever P1 goes
// -- dragged, reset, or moved by the spine slider. Registered before the view's
// own listener so the offset is current by the time the paths refresh.
// The club is pinned the same way: its length is the address hand's distance to
// the ball, so the head sits on the ball at address whatever the spine tilt is.
// Order matters -- the rectangle offset has to be current before the club length
// is measured off the address pose, and both before the paths refresh.
const syncToAddress = () => {
  setPlaneOffset(swing.addressAxisDistance());
  // The club's length is its own spec, not something measured off the pose. The
  // ball was solved to sit where that club reaches, so the two agree at address.
  setClubLength(clubReach(getClub()));
};
swing.onChange(syncToAddress);
syncToAddress();

playButton.addEventListener('click', () => store.set({ playing: !store.state.playing }));
scrub.addEventListener('input', () =>
  store.set({ t: Number(scrub.value) / 1000, playing: false }),
);
speed.addEventListener('input', () => store.set({ speed: Number(speed.value) / 100 }));

/**
 * Picking a club re-poses the whole address.
 *
 * Unlike the old spine slider, this is not just a tilt: the club owns its spine
 * angle, its length and its ball position, and the address hand follows from the
 * arms hanging plumb at that angle. So all four are re-derived together, in
 * dependency order -- tilt, then the address hand, then the rectangle and club
 * length that are pinned to it, then the address wrist that aims at the ball.
 *
 * The camera is left exactly where you put it.
 */
function applyClub(index) {
  const club = CLUBS[index];
  setClub(club.id);
  swing.applyNaturalAddress();
  syncToAddress();
  swing.applyAddressClub();
  swing.emit();
  store.set({ club: club.id });
  sceneView.rebuildRig();
}

clubInput.addEventListener('input', () => applyClub(Number(clubInput.value)));

$('prev-key').addEventListener('click', () => store.stepKeyframe(-1));
$('next-key').addEventListener('click', () => store.stepKeyframe(1));
$('reset-path').addEventListener('click', () => {
  swing.reset();
  applyClub(Number(clubInput.value));
});
$('reset-camera').addEventListener('click', () => sceneView.resetCamera());

/**
 * Flip handedness. The keyframes are untouched -- u is always measured toward
 * the lead side -- so the same swing is simply mirrored onto the other side.
 */
function applyHandedness(handedness) {
  setHandedness(handedness);
  store.set({ handedness });
  swing.emit(); // world positions changed, so drop the cached path
  planeView.layout(); // the horizontal axes follow handedness in both panels
  wristView.layout();
  sceneView.rebuildRig({ mirrorCamera: true });
}

handButton.addEventListener('click', () =>
  applyHandedness(store.state.handedness === 'right' ? 'left' : 'right'),
);

for (const key of [
  'showPath',
  'showClub',
  'showHeadPath',
  'showPlane',
  'showLocalPath',
  'showGuides',
]) {
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
  wrist: $('r-wrist'),
  club: $('r-club'),
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

  const { club } = pose;
  readouts.wrist.textContent =
    `${club.hingeDeg.toFixed(0)}° hinge · cock ${club.cockDeg.toFixed(0)} bow ${club.bowDeg.toFixed(0)}`;
  // Face angle is only meaningful when the club is near the ball, so the
  // head-to-ball distance is reported alongside it rather than on its own.
  const toBall = distance(club.head, ballPosition()) * 100;
  readouts.club.textContent =
    `face ${club.faceDeg >= 0 ? '+' : ''}${club.faceDeg.toFixed(0)}° · head ${toBall.toFixed(0)} cm from ball`;

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
  const club = getClub();
  clubOut.textContent = club.label;
  clubInput.value = String(CLUBS.findIndex((c) => c.id === club.id));
});

let last = performance.now();
function frame(now) {
  const dt = Math.min((now - last) / 1000, 0.1);
  last = now;
  store.tick(dt);

  const pose = swing.poseAt(store.state.t);
  planeView.draw(pose);
  wristView.draw(pose);
  sceneView.draw(pose);
  updateReadouts(pose);

  requestAnimationFrame(frame);
}
requestAnimationFrame(frame);

// --- layout ---------------------------------------------------------------

const observer = new ResizeObserver((entries) => {
  for (const entry of entries) {
    if (entry.target === planeView.canvas) planeView.resize();
    if (entry.target === wristView.canvas) wristView.resize();
    if (entry.target === sceneView.canvas) sceneView.resize();
  }
});
observer.observe(planeView.canvas);
observer.observe(wristView.canvas);
observer.observe(sceneView.canvas);

// Surface the constraint handover in the legend so the rule is discoverable.
$('release-label').textContent = `P7.5 release · t ${RELEASE_T}`;
