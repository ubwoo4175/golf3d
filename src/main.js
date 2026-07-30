/**
 * Wiring: one store, one swing, two views, one animation loop.
 *
 * The timeline is the master clock. `t` sets the torso angle and the reference
 * hand position; dragging on the 2D plane rewrites a keyframe, which invalidates
 * the cached path so both views pick up the new shape on the next frame.
 */

import { TIMING, REACH } from './config.js';
import { SwingPath, phaseAt } from './swing.js';
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

playButton.addEventListener('click', () => store.set({ playing: !store.state.playing }));
scrub.addEventListener('input', () =>
  store.set({ t: Number(scrub.value) / 1000, playing: false }),
);
speed.addEventListener('input', () => store.set({ speed: Number(speed.value) / 100 }));

$('prev-key').addEventListener('click', () => store.stepKeyframe(-1));
$('next-key').addEventListener('click', () => store.stepKeyframe(1));
$('reset-path').addEventListener('click', () => swing.reset());
$('reset-camera').addEventListener('click', () => sceneView.resetCamera());

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
});

// --- readouts --------------------------------------------------------------

const readouts = {
  phase: $('r-phase'),
  time: $('r-time'),
  torso: $('r-torso'),
  hand: $('r-hand'),
  lead: $('r-lead'),
  trail: $('r-trail'),
};

const armText = (arm) =>
  arm.overextended
    ? `out of reach by ${((arm.reach - REACH) * 100).toFixed(1)} cm`
    : `${(arm.reachRatio * 100).toFixed(0)}% ext · ${arm.flexDeg.toFixed(0)}° flex`;

function updateReadouts(pose) {
  const t = store.state.t;
  const turn = (pose.theta * 180) / Math.PI;
  readouts.phase.textContent = phaseAt(t).label;
  readouts.time.textContent = `${(t * TIMING.swingSeconds).toFixed(2)}s · t ${t.toFixed(3)}`;
  readouts.torso.textContent = `${turn > 0 ? '+' : ''}${turn.toFixed(0)}°`;
  readouts.hand.textContent = `u ${(pose.u * 100).toFixed(1)} v ${(pose.v * 100).toFixed(1)}`;
  readouts.lead.textContent = armText(pose.lead);
  readouts.trail.textContent = armText(pose.trail);
  readouts.lead.classList.toggle('warn', pose.lead.overextended);
  readouts.trail.classList.toggle('warn', pose.trail.overextended);

  const active = swing.keys[swing.nearestKeyframeIndex(t)];
  $('r-keyframe').textContent =
    active && Math.abs(active.t - t) < 1e-3 ? active.label : `→ ${active.label}`;
}

// --- loop ------------------------------------------------------------------

store.subscribe((state) => {
  playButton.textContent = state.playing ? '❚❚ Pause' : '▶ Play';
  if (document.activeElement !== scrub) scrub.value = String(Math.round(state.t * 1000));
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
