# Golf Swing Hand Path — 3D Simulator

Two synchronised views of how the hands move **relative to the torso** through a
golf swing, shaped after Rory McIlroy's sequencing.

- **Left — 2D hand rectangle.** The torso-fixed rectangle seen head-on, relative
  to the elbow line. Drag here to reshape the swing.
- **Right — 3D world space.** The same motion with the torso rotating about a
  fixed spine axis, plus the full-swing hand path.

Both views read from a single normalised swing time `t`, so they can never drift
out of step.

## Running it

The app itself has no build step — it is `index.html` plus ES modules. It must
be served over HTTP, though: Three.js comes from a CDN via an import map, and
opening `index.html` off the filesystem fails on module CORS.

### With Jekyll (matches GitHub Pages)

```sh
bundle install
bundle exec jekyll serve        # http://localhost:4000
```

The `Gemfile` pins the `github-pages` gem, so a local build is the same Jekyll
that GitHub Pages runs. `_config.yml` sets `theme: null` — the app ships its own
complete stylesheet, and the gem's default `jekyll-theme-primer` would otherwise
be compiled into the output for nothing.

Everything is a static file: `index.html` carries no YAML front matter, so Jekyll
copies it and `src/*.js` through byte-for-byte rather than running them through
Liquid. That keeps the import map's JSON safe from Liquid's `{`-handling, and
means the Jekyll build and a plain static server serve identical bytes.

If Ruby reports `Invalid US-ASCII character`, your shell has no locale set and
Ruby is reading UTF-8 source as ASCII:

```sh
export LANG=C.UTF-8            # or en_US.UTF-8
```

### Without Jekyll

```sh
python3 -m http.server 8000     # http://localhost:8000
```

### Publishing to GitHub Pages

Settings → Pages → Source: *Deploy from a branch*, then pick the branch and the
`/ (root)` folder. GitHub runs Jekyll over the repo with this `_config.yml` and
serves the result at `https://<user>.github.io/golf3d/`. Every asset reference in
`index.html` is relative, so the project-path prefix needs no `baseurl`.

## The model

Assumptions, per the spec:

| Element | Treatment |
| --- | --- |
| Legs, pelvis, spine angle | Static. Drawn once, never animated. |
| Torso | One degree of freedom: rotation `θ` about a fixed, tilted spine axis. |
| Shoulders | Fixed to the top of the torso, so they rotate with it. |
| Arms | Shoulder → elbow → hands, both hands meeting at one grip point. Shoulders + hands form the classic triangle. |
| Hands | Dragged in 2D on a torso-fixed rectangle; the perpendicular distance off it is solved, not authored. |

### Coordinates

World space is Y-up with the ground at `y = 0` and `+X` the target direction.
`+X` is also the golfer's **lead** side — the lead side faces the target whichever
hand you play with, so this holds for both handednesses.

The torso basis is `(side, up, fwd)`: `up` is the spine axis, `side` runs along
the shoulder line toward the lead side, `fwd` is the chest normal.

In-plane coordinates are measured from the shoulder centre:

- `u` along the shoulder line, positive toward the lead side
- `v` along the spine axis, positive toward the head

### Handedness

`lead` and `trail` are **roles, not sides**: lead is the left arm for a
right-hander, the right arm for a left-hander. Flipping handedness is a mirror in
Z, because a righty and a lefty hitting the same target stand on opposite sides of
the ball facing opposite ways. Exactly two things flip:

- `fwd`, the chest normal — `+Z` for a righty, `−Z` for a lefty
- the direction the spine tilts forward, since "forward" means toward the ball

The lateral tilt does *not* flip: both lean away from the target, which is `+X`
either way, so the lead shoulder rides high for both. Neither does `u` — it is
always positive toward the lead side, which is why the keyframes are untouched by
a flip and the same swing is simply mirrored onto the other side.

The 2D view is drawn from the golfer's **own** point of view — as if they were
looking down at their own hands, not as if you were facing them. So a
right-hander's lead side is their left and appears on the *left* of the screen,
and a left-hander's mirrors it. Only the horizontal screen mapping flips; `u` is
always positive toward the lead side internally.

### The rectangle and the automatic perpendicular axis

The rectangle is torso-fixed and parallel to the spine axis. It is the surface you
drag on; the hand does **not** lie on it. Given `(u, v)`, the hand's perpendicular
distance `d` from the spine axis is solved so the locked arm is exactly straight:

```
d = √(target² − (u − u_shoulder)² − v²)
```

A straight arm puts the hand on a sphere about that shoulder; the line through
`(u, v)` normal to the rectangle pierces that sphere. So there is a solution for
every `(u, v)` inside a **disk** of radius `target` — an area, where the old fixed
distance left only a circle. That is what makes free dragging compatible with a
locked arm, and it is why the earlier version could not do both.

**The rectangle is pinned to the address hand.** Its distance from the spine axis
is P1's own solved distance, so P1 always lies exactly on the rectangle and its
`⊥ offset` reads 0.0 cm — a standing self-check. Drag P1 and the rectangle follows
it. In the 3D view the solved offset is the short blue segment from the drag point
out to the hand. Across the reference swing `d` runs 0.20 → 0.47 m.

### Spine tilt and the anchored address

The **spine** slider sets forward tilt from 22° to 40°, standing in for club
length: 40° is a short iron, 22° a driver. It rebuilds the rig and **leaves the
camera exactly where you put it** — only flipping handedness moves the camera, and
even then it mirrors the current view in Z rather than resetting, so your orbit
distance and elevation survive.

The address hand is **anchored** at a fixed point on the rectangle. At `u = 0` the
hand is equidistant from both shoulders, so a locked lead arm confines it to a
circle of radius `r = √(target² − (w/2)²)` about the shoulder centre in the
sagittal plane. The anchor is the point on that circle where the arms hang plumb
at the short-iron setup:

```
v = −r·cos(anchorTilt)        distance = r·sin(anchorTilt)
```

**One consequence is worth being explicit about.** Anchoring `(u, v)` fixes the
perpendicular distance too — the arm-length constraint ties all three together —
so the rectangle, pinned to P1, does not move either. Changing spine tilt leaves
the hand completely fixed *in the torso frame*. What changes is the world pose:
the torso frame rotates and carries the whole arm assembly with it.

That still produces the effect you want, by a different route:

| Tilt | Hand height | Ahead of plumb | Hand-to-hip, horizontal |
| --- | --- | --- | --- |
| 22° (driver) | 0.882 m | 19.6 cm | 39.1 cm |
| 26° | 0.855 m | 15.3 cm | 38.2 cm |
| 32° (long iron, default) | 0.816 m | 8.8 cm | 36.5 cm |
| 40° (short iron, anchor) | 0.768 m | **0.0 cm** | 33.6 cm |

So the hands sit **5.5 cm further from the body** with a driver than a short iron,
and 11.4 cm higher, while `(u, v)` stays at (0.0, −48.5) and the axis distance at
40.7 cm throughout. The arm length stays 0.667 m at every tilt — the anchor sits on
the constraint circle, so it is always exactly reachable with no clamping.

40° is the top of the slider on purpose: past the anchor the fixed arm would swing
the hands *behind* the plumb line, which no one addresses a ball from.

### The arm rules

| Position | Lead elbow | Trail elbow |
| --- | --- | --- |
| P1 address | straight | straight (both, by symmetry at `u = 0`) |
| P2 → P4 backswing | straight | folds, to 114° at the top |
| P5 → P6 downswing | straight | extending — 108°, then 91° |
| **P7 impact** | straight | **still extending — 39° from straight** |
| **P7.5 release** | **straight** | **straight** |
| P8 → P10 follow-through | folds, to 100° at the finish | straight |

The handover is at `RELEASE_T`, deliberately after impact. Verified across 4001
samples: the locked arm holds 99.7% extension through its entire phase, with no
reach violations anywhere.

#### Why the hands must cross the sternum at release

Substitute the solved `d` back into the *free* arm's length and it collapses to a
function of `u` alone:

```
free² = target² ∓ 2·u·shoulderWidth      (− trail locked, + lead locked)
```

So `u` is the free elbow's fold control, and the free arm running out of length
bounds `u` to a half-plane. With the lock ratio near 1 that bound sits ~3 mm from
zero, which means **the rules by themselves force the hands onto the trail side of
the sternum until release and the lead side after it, meeting at `u = 0`.** Both
arms can only be straight together at `u = 0`; that is geometry, not a stylistic
choice, and it is why the P7.5 keyframe has `u = 0` exactly.

Two consequences worth knowing:

- `d` peaks at release. Maximum extension away from the body happens exactly at
  the handover, which is correct golf — and it puts a deliberate kink in `d` there,
  since which arm is binding switches.
- The reachable region shaded in the 2D view **changes with the phase you are
  editing**, because it is the locked arm's disk cut by that half-plane. During
  the lead-locked phase only the trail half of the rectangle is usable.

Dragging is free, so you can still leave the reachable region — the hand marker
turns red, the offending arm turns red in 3D, and the readout says by how much.
Note that what fails is the *free* arm, not the locked one: the locked arm is
always satisfied by construction.

`ARM_LOCK_RATIO` is 0.997, not 1.0, for two reasons: a real locked arm keeps a few
degrees of flex, and exactly 1.0 would sit on the reach boundary where the IK
flags an overextension. It reads as 8.9° of elbow flex — the cosine is very flat
near full extension, so that really is what 99.7% of a 32 + 35 cm arm looks like.

### The path shape

| Phase | Shape |
| --- | --- |
| Backswing | convex **upward** — bows above the chord from address to the top |
| Downswing | convex downward, so it tracks 13–22 cm *below* the backswing |
| Follow-through | convex downward |

Backswing high and downswing low is the classic shallowing loop. Convexity is
verified by a chord test, which is independent of traversal direction.

### The P-system and shoulder rotation

`REFERENCE_KEYFRAMES` in `src/swing.js` — 11 keyframes over `t ∈ [0, 1]`, synced
to a tour long-iron swing.

| | Position | t | time | shoulders | u (cm) | v (cm) | axis dist (cm) |
| --- | --- | --- | --- | --- | --- | --- | --- |
| P1 | address | 0.000 | 0.00 s | 0° | 0.0 | −48.5 | 40.7 |
| P1.5 | takeaway | 0.110 | 0.16 s | +22° | −9.0 | −37.4 | 46.5 |
| P2 | shaft parallel | 0.200 | 0.29 s | +40° | −19.0 | −26.4 | 46.5 |
| P3 | lead arm parallel to ground | 0.320 | 0.46 s | +60° | −28.0 | −17.4 | 41.9 |
| P4 | top of backswing | 0.520 | 0.75 s | **+90°** | −37.0 | −9.0 | 31.9 |
| P5 | early downswing, lead arm parallel | 0.600 | 0.87 s | +45° | −34.5 | −24.5 | 28.0 |
| P6 | delivery, shaft parallel | 0.655 | 0.95 s | **0°** | −27.0 | −40.5 | 22.8 |
| P7 | impact | 0.690 | 1.00 s | −35° | −5.5 | −52.5 | 31.7 |
| P7.5 | release, both arms straight | 0.725 | 1.05 s | −55° | **0.0** | −47.5 | 42.0 |
| P8 | follow-through, shaft parallel | 0.775 | 1.12 s | −72° | +11.5 | −40.0 | 42.5 |
| P9 | shoulders square to target | 0.850 | 1.23 s | **−90°** | +21.5 | −23.5 | 45.9 |
| P10 | finish | 1.000 | 1.45 s | **−120°** | +31.0 | +9.0 | 41.0 |

The four bold angles are not free parameters — P4, P6, P9 and P10 are *defined*
by their shoulder rotation, so they are pinned exactly and the rest interpolate
between them. P7.5's `u = 0` is forced by geometry, not chosen. P1's `u` and `v`
are derived from the spine tilt and are the values for the 32° default; the axis
distance column is solved, never authored.

Timing is a real constraint, not decoration. Backswing 0.75 s against a 0.25 s
downswing is the ~3:1 tour tempo, and it puts peak torso rotation at **748°/s**
through impact — the right order for a tour player, and Rory sits at the quick end
of that range. Change `TIMING.swingSeconds` and every angular velocity scales
with it.

**The positions are hand-authored from published swing positions, not motion
capture.** Treat them as a well-shaped starting point you tune by dragging.

### Interpolation, and keeping the 3D path smooth

Four things had to be right before the world hand path flowed without a corner.
Measured on the world path, the largest step in velocity direction anywhere went
from **15.4° to 1.05°**, and the tightest corner from a 0.47 mm radius to a
genuine, smooth reversal at the top.

**1. Non-uniform tangents.** The familiar
`(y[i+1] − y[i−1]) / (t[i+1] − t[i−1])` is the *uniform* Catmull-Rom formula, and
using it on unequal knot spacing was a real bug, not a tuning choice. At the top,
P3 and P5 sit only 9.6 cm apart while P4 stands 12–16 cm off both, over time spans
of 0.20 and 0.08 — so the difference across P4 was small, the tangent collapsed,
and the hand covered 1.6 cm in 80 ms before lurching away. A cusp. The correct
generalisation weights each one-sided slope by the *opposite* interval, and
reduces to the uniform formula when spacing is even.

**2. Monotone limiting, for the torso angle only.** With correct tangents the
angle track then overshot to **97°** on its way to a P4 that is *defined* as 90°.
That is a correctness bug, since P4/P6/P9/P10 are pinned by the P-system, so the
angle track gets a Fritsch-Carlson limiter: zero tangent at a local extremum,
capped elsewhere. Max turn is now exactly 90.00° at P4 and −120.00° at P10.

The hand track deliberately does *not* get it. There it would be actively
harmful — `u` and `v` both reverse at the top, so zeroing both tangents stops the
hand dead and gives a worse cusp than the one being fixed. The hand path is a free
curve; it only has to be smooth.

**3. C1 joins on straightened segments.** A straightened segment is a line, so its
curved neighbour has to *arrive along that line* or the straight-line rule buys a
clean chord at the price of a corner at each end — and at impact, the fastest part
of the swing, that corner was the more visible artefact. Forcing the shared
tangent to the chord slope took it from 223 to 22 rad/m.

**4. A blended release.** Switching the locked arm at a single instant puts a
corner in the path, because the perpendicular distance is solved from a different
shoulder either side and its slope flips sign. `RELEASE_BLEND_T` smoothsteps the
handover across ±0.025. It is nearly free: the two solutions coincide exactly at
release, where `u = 0`. It does push one arm ~3 mm past its target mid-handover,
which is why `ARM_LOCK_RATIO` is 0.995 rather than 0.997 — that leaves headroom
under `REACH` so the safety cap in `solvePose` never has to bind (it stays as a
guard for dragged poses, with 0.8 mm to spare).

#### Straight segments

Two keyframes close together still inherit a tangent scaled to their distant
neighbours, and the cubic between them detours — the distortion that shows up when
points bunch. Correct tangents reduce it but do not remove it.

The cutoff is set from measurement. Comparing each segment's arc length against
its own chord:

| Segment | Length | arc / chord |
| --- | --- | --- |
| P7 → P7.5 | 0.074 m | **1.135** — a 13.5% detour |
| P7.5 → P8 | 0.137 m | 1.004 |
| all others | ≥ 0.15 m | ≤ 1.027 |

So the curve only misbehaves below about 0.10 m, and `CURVE.straightBelow = 0.10`
sits in the gap between the bad segment and the next shortest good one. Segments
below it are drawn as straight lines, which takes P7 → P7.5 to exactly 1.000.

Set `CURVE.straightBelow = Infinity` for an all-straight polyline — that is the
whole change, one value in `config.js`.

One curve is *not* distortion and is deliberately kept: P4 → P5 reverses direction
slightly in `u`, because the hands drift a little past the top before changing
direction. That is the transition float, and it is 0.9 cm.
## Controls

| Action | Effect |
| --- | --- |
| Drag on the 2D rectangle | Grabs the nearest keyframe handle, or the keyframe nearest the current time, and moves it. The 3D path reshapes live. |
| Space | Play / pause |
| ← / → | Step keyframe |
| H, or the handedness button | Flip right- / left-handed |
| spine slider | Forward tilt 20–45°, standing in for club length. Resets P1 to the natural address, which drags the rectangle with it. |
| Drag / scroll on 3D | Orbit / zoom |

The timeline is the master clock: `t` sets both the torso angle and the reference
hand position. Dragging rewrites a keyframe's hand position; it never changes its
time or torso angle.

## Layout

| File | Responsibility |
| --- | --- |
| `src/config.js` | Every tunable: anthropometrics, rectangle geometry, lock ratio, timing, palette. |
| `src/vec3.js` | Dependency-free vector maths on plain `{x,y,z}`. |
| `src/kinematics.js` | The rig and handedness, torso basis, the perpendicular-axis solve, two-link arm IK. No rendering, no time. |
| `src/swing.js` | Keyframe track, interpolation, phase segmentation, path sampling. |
| `src/state.js` | The single observable store both views subscribe to. |
| `src/view2d.js` | Canvas 2D rectangle view and drag editing. |
| `src/view3d.js` | Three.js scene. |
| `src/main.js` | Wiring, controls, readouts, animation loop. |
| `_config.yml`, `Gemfile` | Jekyll / GitHub Pages setup only. The app does not depend on them. |

`kinematics.js` deliberately does not import Three.js — vectors convert to
`THREE.Vector3` only at the rendering boundary, so the model stays testable and
reusable.

## Adding a club

`solvePose()` returns a `handFrame` for exactly this:

```js
const { position, shaftDir, elbowLineDir } = pose.handFrame;
```

- `position` — the grip point where both hands meet
- `shaftDir` — a unit vector from the grip toward the clubhead, taken as the
  natural extension of the lead arm
- `elbowLineDir` — unit vector along the elbow line, a ready-made reference for
  deriving clubface normal / shaft lean

A clubhead at `position + shaftDir * clubLength` is a one-liner. Note that until
a club exists, the hands do not reach the ball marker in the 3D scene — the
shaft is what closes that gap, which is why the ball sits where it does.

Two things worth knowing before you build on this:

- `shaftDir` carries no roll, so it cannot express face angle on its own. Use
  `elbowLineDir` (or forearm rotation, if you add it) to build a full frame.
- The hands are one point. Modelling lead and trail hands separately means
  splitting the grip point into two offsets along `shaftDir`.

## Tuning

Elbow swivel is resolved by a hint vector per arm (`ELBOW_HINT` in
`config.js`), expressed as `up`/`fwd`/`side` weights in the rotating torso basis.
Both elbows default to pointing down and slightly behind the shoulder-to-hand
line. The hint is constant through the swing, so the finish position in
particular is a plausible solve rather than a matched one — adjust the weights,
or make the hint time-varying, if you need a specific elbow attitude.
