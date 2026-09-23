/**
 * Wiring: one store, one swing, two views, one animation loop.
 *
 * The timeline is the master clock. `t` sets the torso angle, the reference hand
 * position and which arm is locked straight; dragging on the 2D rectangle
 * rewrites a keyframe, which invalidates the cached path so both views pick up
 * the new shape on the next frame.
 */

import { TIMING, REACH, CLUBS, SCENE, clubReach } from './config.js';
import { SwingPath, phaseAt, RELEASE_T } from './swing.js';
import { CONSTRAINTS, applyConstraints, faceCentre } from './constraints.js';
import { setHandedness, setClub, getClub, setPlaneOffset, getRig, ballPosition } from './rig.js';
import { setClubLength, setClubLie, faceAngleToTarget } from './club.js';
import { distance } from './vec3.js';
import { Store } from './state.js';
import { PlaneView } from './view2d.js';
import { WristView } from './view-wrist.js';
import { SceneView } from './view3d.js';

const $ = (id) => document.getElementById(id);

// --- settings kept between visits: ball position per club, constraints -------
//
// Loaded before anything is built, since the ball's position feeds the address
// the swing starts from and the scene's static geometry.

const SETTINGS_KEY = 'golf3d.settings.v1';
const BALL_FIELDS = ['ballHeight', 'ballForward', 'ballLateral'];
const BALL_DEFAULTS = Object.fromEntries(
  CLUBS.map((c) => [c.id, Object.fromEntries(BALL_FIELDS.map((f) => [f, c[f]]))]),
);
const settings = { balls: {}, constraints: {}, held: {} };
try {
  Object.assign(settings, JSON.parse(localStorage.getItem(SETTINGS_KEY) ?? '{}'));
} catch {
  /* corrupt: start from the defaults */
}
for (const club of CLUBS) {
  const saved = settings.balls[club.id];
  for (const f of BALL_FIELDS) {
    if (typeof saved?.[f] === 'number' && Number.isFinite(saved[f])) club[f] = saved[f];
  }
}
const saveSettings = () => {
  try {
    localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings));
  } catch {
    /* storage unavailable: settings last for this visit only */
  }
};

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
  // The lie goes with it: it is what angles the head on the end of the shaft.
  setClubLength(clubReach(getClub()));
  setClubLie(getClub().lieDeg);
};
swing.onChange(syncToAddress);
syncToAddress();

// --- constraints -----------------------------------------------------------
//
// Re-imposed after every change to the swing, so a rule that is on stays true
// whatever you drag. Registered after syncToAddress so the club length is
// current; the re-entrant emit it makes is ignored by the guard.

const active = Object.fromEntries(CONSTRAINTS.map((c) => [c.id, !!settings.constraints[c.id]]));
const statusEls = {};
const buttons = {};
let enforcing = false;

function showStatus(status = {}) {
  for (const c of CONSTRAINTS) {
    const el = statusEls[c.id];
    const text = active[c.id] ? status[c.id] : null;
    // "on" reads as a tick on the rule itself; anything else is a warning.
    el.textContent = !text ? c.hint : text === 'on' ? `✓ ${c.hint}` : text.replace(/^on · /, '✓ ');
    el.className = !text ? '' : text.startsWith('on') ? 'on' : 'warn';
    el.title = text ? `${c.title} — ${text}` : c.title;
    buttons[c.id].setAttribute('aria-pressed', String(active[c.id]));
  }
}

function enforce() {
  if (enforcing) return;
  enforcing = true;
  try {
    const { changed, status } = applyConstraints(swing.keys, active);
    if (changed) swing.emit();
    showStatus(status);
  } finally {
    enforcing = false;
  }
}
swing.onChange(enforce);

// The keyframe each constraint owns. Its values are held while the rule is on
// and handed back when it is switched off, so a toggle is a toggle.
const OWNED = { p1: 'P1', p2: 'P2', p6: 'P6', p7: 'P7' };
const FIELDS = ['thetaDeg', 'u', 'v', 'cockDeg', 'bowDeg', 'faceDeg'];
const keyOf = (id) => swing.keys.find((k) => k.label.split(' ')[0] === OWNED[id]);
const valuesOf = (key) => Object.fromEntries(FIELDS.map((f) => [f, key[f]]));

/**
 * Make a change that re-derives keyframes -- a new club, a reset, a loaded
 * swing, a flip, a moved ball -- with the rules held off until it is done, then
 * impose them once. A keyframe the change itself rewrote gets its new values
 * held, so switching its rule off later hands back those, not stale ones.
 */
function rebase(change) {
  const before = Object.fromEntries(CONSTRAINTS.map((c) => [c.id, JSON.stringify(valuesOf(keyOf(c.id)))]));
  enforcing = true;
  try {
    change();
  } finally {
    enforcing = false;
  }
  for (const c of CONSTRAINTS) {
    const now = valuesOf(keyOf(c.id));
    if (active[c.id] && JSON.stringify(now) !== before[c.id]) settings.held[c.id] = now;
  }
  saveSettings();
  enforce();
}

for (const c of CONSTRAINTS) {
  const row = document.createElement('div');
  row.className = 'constraint-row';
  const button = document.createElement('button');
  button.textContent = c.label;
  button.title = c.title;
  const status = document.createElement('span');
  row.append(button, status);
  $('constraint-list').append(row);
  buttons[c.id] = button;
  statusEls[c.id] = status;
  button.addEventListener('click', () => {
    active[c.id] = !active[c.id];
    settings.constraints[c.id] = active[c.id];
    const key = keyOf(c.id);
    if (active[c.id]) {
      settings.held[c.id] = valuesOf(key);
      enforce();
    } else {
      const held = settings.held[c.id];
      delete settings.held[c.id];
      if (held) Object.assign(key, held);
      swing.emit();
    }
    saveSettings();
  });
}

playButton.addEventListener('click', () => store.set({ playing: !store.state.playing }));
scrub.addEventListener('input', () =>
  store.set({ t: Number(scrub.value) / 1000, playing: false }),
);

// A tick per keyframe on the scrubber. A click -- not a drag -- that lands
// within a few pixels of one goes exactly to that keyframe.
const ticks = $('scrub-ticks');
let tickTimes = '';
function buildTicks() {
  const times = swing.keys.map((k) => k.t).join();
  if (times === tickTimes) return;
  tickTimes = times;
  ticks.replaceChildren(
    ...swing.keys.map((k) => {
      const tag = k.label.split(' ')[0];
      const tick = document.createElement('i');
      tick.className = `scrub-tick${tag.includes('.') ? ' half' : ''}`;
      tick.style.left = `${k.t * 100}%`;
      if (!tag.includes('.')) {
        const label = document.createElement('b');
        label.textContent = tag.slice(1);
        tick.append(label);
      }
      return tick;
    }),
  );
}
buildTicks();
swing.onChange(buildTicks);

const SNAP_PX = 10;
let press = null;
scrub.addEventListener('pointerdown', (event) => {
  press = { x: event.clientX, y: event.clientY };
});
scrub.addEventListener('pointerup', (event) => {
  if (!press) return;
  const moved = Math.hypot(event.clientX - press.x, event.clientY - press.y);
  press = null;
  if (moved > 4) return;
  const box = ticks.getBoundingClientRect();
  if (box.width <= 0) return;
  let best = null;
  for (const [i, k] of swing.keys.entries()) {
    const px = Math.abs(box.left + k.t * box.width - event.clientX);
    if (px <= SNAP_PX && (!best || px < best.px)) best = { i, px };
  }
  if (best) {
    store.seekKeyframe(best.i);
    scrub.value = String(Math.round(swing.keys[best.i].t * 1000));
  }
});
speed.addEventListener('input', () => store.set({ speed: Number(speed.value) / 100 }));

/**
 * Picking a club re-poses the whole address.
 *
 * Unlike the old spine slider, this is not just a tilt: the club owns its spine
 * angle, its length and its ball position, and the address hand follows from the
 * anchored address point. So all four are re-derived together, in
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

clubInput.addEventListener('input', () => {
  rebase(() => applyClub(Number(clubInput.value)));
  showBall();
});

// --- ball position ---------------------------------------------------------
//
// Per club, in the units you would use on the range: tee height is the gap
// under the ball; "from feet" is measured out from the line the feet stand on;
// stance is + toward the lead foot. Moving the ball re-aims the address club at
// it; with P1 on, the address hand moves too, so the face stays on the ball.

const FEET_LINE = -0.02; // where the legs meet the ground, along the chest normal
const ball = {
  tee: { input: $('ball-tee'), out: $('ball-tee-out'),
    get: (c) => (c.ballHeight - SCENE.ballRadius) * 100,
    set: (c, x) => (c.ballHeight = SCENE.ballRadius + x / 100),
    text: (x) => `${x.toFixed(1)} cm` },
  out: { input: $('ball-out'), out: $('ball-out-out'),
    get: (c) => (c.ballForward - FEET_LINE) * 100,
    set: (c, x) => (c.ballForward = FEET_LINE + x / 100),
    text: (x) => `${x.toFixed(1)} cm` },
  side: { input: $('ball-side'), out: $('ball-side-out'),
    get: (c) => c.ballLateral * 100,
    set: (c, x) => (c.ballLateral = x / 100),
    text: (x) => `${x > 0 ? '+' : ''}${x.toFixed(1)} cm` },
};

function showBall() {
  const club = getClub();
  for (const b of Object.values(ball)) {
    const x = b.get(club);
    b.input.value = String(x);
    b.out.textContent = b.text(x);
  }
}

function moveBall({ remember = true } = {}) {
  const club = getClub();
  if (remember) settings.balls[club.id] = Object.fromEntries(BALL_FIELDS.map((f) => [f, club[f]]));
  else delete settings.balls[club.id];
  sceneView.rebuildRig();
  saveSettings();
  // With P1 on, the rule itself puts the face on the ball -- hand and all.
  if (!active.p1) swing.applyAddressClub();
  swing.emit();
}

for (const b of Object.values(ball)) {
  b.input.addEventListener('input', () => {
    const x = Number(b.input.value);
    b.set(getClub(), x);
    b.out.textContent = b.text(x);
    moveBall();
  });
}
$('reset-ball').addEventListener('click', () => {
  const club = getClub();
  Object.assign(club, BALL_DEFAULTS[club.id]);
  showBall();
  moveBall({ remember: false });
});
showBall();

$('prev-key').addEventListener('click', () => store.stepKeyframe(-1));
$('next-key').addEventListener('click', () => store.stepKeyframe(1));
$('reset-path').addEventListener('click', () =>
  rebase(() => {
    swing.reset();
    applyClub(Number(clubInput.value));
  }),
);
$('reset-camera').addEventListener('click', () => sceneView.resetCamera());

// --- saving and sharing the swing ------------------------------------------
//
// A tuned swing lived only in the open tab: reload, and it was gone, and the
// only way to hand it on was a screenshot someone had to measure by eye. Now:
//
//   - every edit made by DRAGGING is saved to this browser, and restored on load;
//   - "Copy swing" puts the exact keyframes on the clipboard as JSON;
//   - "Load swing" takes that JSON back, in this browser or any other.
//
// Only edits are saved -- not the defaults -- so a saved swing never masks a
// newer set of defaults you have not touched. "Reset swing" forgets it.

const SAVE_KEY = 'golf3d.swing.v1';
const forget = () => {
  try {
    localStorage.removeItem(SAVE_KEY);
  } catch {
    /* storage unavailable: nothing to forget */
  }
};
const save = () => {
  try {
    localStorage.setItem(SAVE_KEY, JSON.stringify(swing.snapshot()));
  } catch {
    /* storage unavailable: the swing still works, it just is not kept */
  }
};

try {
  const saved = JSON.parse(localStorage.getItem(SAVE_KEY) ?? 'null');
  if (saved) swing.load(saved);
} catch {
  forget(); // stale or corrupt: fall back to the defaults
}
enforce(); // rules left on last visit hold from the first frame

// Saved when a drag on either panel actually changed something.
for (const surface of [$('plane-canvas'), $('wrist-overlay')]) {
  let before = null;
  surface.addEventListener('pointerdown', () => {
    before = swing.revision;
  });
  surface.addEventListener('pointerup', () => {
    if (before !== null && swing.revision !== before) save();
    before = null;
  });
}
$('reset-path').addEventListener('click', forget);

$('copy-swing').addEventListener('click', async () => {
  const text = JSON.stringify(swing.snapshot(), null, 1);
  try {
    await navigator.clipboard.writeText(text);
    $('copy-swing').textContent = 'Copied ✓';
    setTimeout(() => ($('copy-swing').textContent = 'Copy swing'), 1500);
  } catch {
    window.prompt('Copy the swing:', text);
  }
});
$('load-swing').addEventListener('click', () => {
  const text = window.prompt('Paste a swing copied with "Copy swing":');
  if (!text) return;
  try {
    const keys = JSON.parse(text);
    rebase(() => swing.load(keys));
    save();
  } catch (error) {
    window.alert(`Could not load that swing: ${error.message}`);
  }
});

// For the console: `golf.swing.snapshot()` is the same JSON "Copy swing" gives.
window.golf = { swing, store };

/**
 * Flip handedness. The keyframes are untouched -- u is always measured toward
 * the lead side -- so the same swing is simply mirrored onto the other side.
 */
function applyHandedness(handedness) {
  setHandedness(handedness);
  store.set({ handedness });
  // The ball mirrors with the golfer, so the address club has to be re-aimed at
  // it -- without this the flip left the head 70 cm off the ball.
  rebase(() => {
    syncToAddress();
    swing.applyAddressClub();
    swing.emit(); // world positions changed, so drop the cached path
  });
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
  // The stored roll, then what it amounts to at the ball: the face's angle to
  // the target line (+ open) and the gap from the middle of the face to the
  // ball. Those two only mean something near the ball, so they come together.
  const gap = (distance(faceCentre(club), ballPosition()) - SCENE.ballRadius) * 100;
  const open = faceAngleToTarget(club, getRig().H);
  const deg = (x) => {
    const r = Math.round(x) || 0; // no "-0"
    return `${r > 0 ? '+' : ''}${r}°`;
  };
  readouts.club.textContent =
    `roll ${deg(club.faceDeg)} · face ${deg(open)} · ${gap.toFixed(gap < 10 ? 1 : 0)} cm`;

  const active = swing.keys[swing.nearestKeyframeIndex(t)];
  readouts.keyframe.textContent =
    active && Math.abs(active.t - t) < 1e-3 ? active.label : `→ ${active.label}`;
}

// --- loop ------------------------------------------------------------------

store.subscribe((state) => {
  playButton.textContent = state.playing ? '❚❚ Pause' : '▶ Play';
  if (document.activeElement !== scrub) scrub.value = String(Math.round(state.t * 1000));
  swing.keys.forEach((k, i) =>
    ticks.children[i]?.classList.toggle('on', Math.abs(k.t - state.t) < 1e-3),
  );
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
