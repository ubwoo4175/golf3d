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

The 2D view stays face-on by flipping only its horizontal *screen* mapping, so a
right-hander's lead side (their left) appears on your right.

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

`PLANE.offset` is now only where the reference rectangle is *drawn*. In the 3D
view the solved offset is the short blue segment from the drag point out to the
hand; the footer reports it as `⊥ offset`. Across the reference swing `d` runs
0.21 → 0.46 m.

### The arm rules

| Phase | Lead elbow | Trail elbow |
| --- | --- | --- |
| Backswing | straight | folds (to 115° at the top) |
| Downswing | straight | extending |
| **Impact (P7)** | straight | **still extending — 40° from straight** |
| **Release (P8)** | **straight** | **straight** |
| Follow-through | folds (to 98°) | straight |

The handover is at `RELEASE_T`, deliberately later than impact. Verified across
2001 samples: the locked arm holds 99.7% extension through its entire phase, with
no reach violations anywhere.

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
choice, and it is why the P8 keyframe has `u = 0` exactly.

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

### The reference swing

`REFERENCE_KEYFRAMES` in `src/swing.js` — 11 keyframes over `t ∈ [0, 1]`,
Catmull-Rom interpolated, ~1.35 s at full speed. It approximates Rory's
positions: 93° of shoulder turn at the top, a deep transition where the hands drop
while the torso is already unwinding, and long extension through impact.

**It is hand-authored from published swing positions, not motion capture.** Treat
it as a well-shaped starting point you tune by dragging, not as measured truth.
## Controls

| Action | Effect |
| --- | --- |
| Drag on the 2D rectangle | Grabs the nearest keyframe handle, or the keyframe nearest the current time, and moves it. The 3D path reshapes live. |
| Space | Play / pause |
| ← / → | Step keyframe |
| H, or the handedness button | Flip right- / left-handed |
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
