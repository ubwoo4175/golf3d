# Golf Swing Hand Path — 3D Simulator

Three synchronised views of how the hands and the club move **relative to the
torso** through a golf swing, shaped after Rory McIlroy's sequencing.

- **Left — 2D hand rectangle.** The torso-fixed rectangle seen head-on, relative
  to the elbow line. Drag here to reshape the swing.
- **Below it — wrist dome.** The club's direction relative to the lead forearm,
  looked at straight down, so it reads as a circle centred on the hand. Drag the
  clubhead; a dial rolls the face.
- **Right — 3D world space.** The same motion with the torso rotating about a
  fixed spine axis, plus the hand and clubhead paths.

All three read from a single normalised swing time `t`, so they can never drift
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
| Club | An orientation at the hand, not a linkage: wrist hinge in two axes plus a roll for the face. Its length is solved from the address pose. |

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
out to the hand. Across the reference swing `d` runs 0.37 → 0.57 m.

### The body

Scaled to **Rory McIlroy's published standing height of 1.75 m** using Winter's
anthropometric segment fractions. His height is public; his segment lengths are
not, so the ratios do the rest.

| | Fraction of height | Value | Previously |
| --- | --- | --- | --- |
| Hip pivot (greater trochanter) | 0.530 H | 0.928 m | 1.000 |
| Torso, hip to shoulder centre | 0.818 − 0.530 H | 0.504 m | 0.520 |
| Shoulder width, joint to joint | 0.259 H − 2×0.035 | 0.383 m | 0.420 |
| Upper arm | 0.186 H | 0.326 m | 0.320 |
| Forearm + hand to the grip | 0.146 H + 0.060 | 0.316 m | 0.350 |
| **REACH** | | **0.641 m** | 0.670 |

The previous numbers were sized for a ~1.85 m player — 10 cm taller than Rory,
which is where the 2.9 cm of extra arm came from. Shoulder width is the distance
between the two shoulder *joints*, which is biacromial breadth less the
acromion-to-glenohumeral inset, not the breadth itself.

The authored hand path was rescaled by the reach ratio (0.9567) so its shape
carries over unchanged onto the smaller frame.

### Picking a club

The **club** slider replaces the old spine-tilt slider. Six detents, and the club
owns the address: its spine angle, its length, and where the ball sits.

**The hand does not move.** P1 sits at the same `(u, v)` on the rectangle for
every club — `u = 0.0, v = −46.7 cm` — so changing club never touches a keyframe
and the authored swing is untouched. The anchor is where the arms hang plumb at
the **wedge**, and everything else follows from the torso frame rotating
underneath it: pick a longer club, the spine stands up, and the hands rise and
move *forward*, from plumb at the wedge to 15.8 cm ahead of plumb at the driver.
The ball is what moves.

| Club | Length | Lie | Spine tilt | Hand height | Hands ahead of plumb | Ball from axis |
| --- | --- | --- | --- | --- | --- | --- |
| Wedge | 35.25″ | 64.5° | 40° | 0.707 m | 0.0 cm | 0.727 m |
| Short iron | 36.0″ | 64.0° | 38° | 0.718 m | +2.1 cm | 0.752 m |
| Mid iron | 37.0″ | 62.5° | 35° | 0.736 m | +5.3 cm | 0.783 m |
| Long iron | 38.5″ | 61.0° | 32° | 0.754 m | +8.5 cm | 0.836 m |
| Fairway wood | 43.0″ | 56.5° | 28° | 0.778 m | +12.7 cm | 1.004 m |
| Driver | 45.5″ | 56.0° | 25° | 0.797 m | +15.8 cm | 1.121 m |

Lengths and lies are **standard men's specs**. Rory plays standard length, so
these are his lengths; his own lie tolerances are not public. The spine tilts come
from published tour address ranges — longer club, more upright — and are the one
column here that is a range rather than a spec, because per-club spine angle is
not something his team has released.

`ballForward` is **solved**: given the fixed address hand and the club's length,
it is where the head reaches the ground. Measured, all six clubs sole within
**0.9 cm** of the ball at address, with the face square to within 3.5°.

#### What had to give

Insisting on the standard *lie angle* at address as well over-determines it. The
lie is what gives, and the model's address shaft comes out about **5° flatter
than spec for the irons and 11° for the driver**. That is closer to how a shaft
actually looks at address than the spec number is: spec lie is a static
measurement with the sole flat, not a posture.

Two approaches were tried and rejected on the way here. Solving the *spine tilt*
from the club gave the driver a 12.9° spine angle — nobody addresses a driver
that upright. Re-hanging the arms plumb at *every* club fixed that, but then P1
moved several centimetres between clubs, which meant translating the whole
authored path to follow it, which in turn tore the takeaway off its own start:
660 of 4000 samples ended up outside the free-arm limit. Holding the anchor at
the wedge and moving the ball instead has neither problem.

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
| Takeaway P1 → P1.5 | a straight vertical line — `u` holds at exactly 0 |
| Backswing P1.5 → P4 | convex **upward** |
| Downswing P4 → P7 | convex **downward**, tracking 25–36 cm *below* the backswing |
| Follow-through P7.5 → P10 | slightly convex **upward** |

Convexity is checked with a chord test, which is independent of traversal
direction. The downswing is the exception: `u` is non-monotonic there (P5 sits
5 cm *further back* than P4), so a chord test does not apply and the turn
direction of the polyline is used instead — it turns one way only.

Two of these have consequences beyond looking right:

- **The takeaway holds `u = 0`.** At `u = 0` the hand is equidistant from both
  shoulders, so *both* arms are equally straight. The takeaway is therefore
  one-piece by construction, not by tuning. It is also 4.4 cm long, under
  `CURVE.straightBelow`, so it comes out straight-joined for free.
- **P5 sits behind P4.** This is what opens the loop at the top, and it is the
  real reason the 3D path flows — see below.

### Why this shape gives a smooth 3D path

The four convexity properties do **not**, by themselves, imply a smooth world
path; 2D convexity and 3D smoothness are independent. What actually does it is a
structural property that happens to come with this shape:

```
u through the top:  P3 −0.156  →  P4 −0.237  →  P5 −0.287     monotonic
v through the top:  P3 −0.114  →  P4 −0.015  →  P5 −0.210     reverses at P4
```

Only **one** of the two coordinates turns at P4 (t = 0.6075), so `du/dt ≠ 0` there
and the hand cannot stop. `u` does not reverse until t = 0.708, well after the
top — the transition float, the hands still drifting back while the torso has
started down.

In the previous default both coordinates reversed at P4 together, which forced the
hand velocity toward zero and pinched the loop into a near-point. Measured over
3000 samples, both shapes run on the *current* solved timing so the columns differ
only in shape:

| | previous default | this shape |
| --- | --- | --- |
| Kink spikes in the world path | 1 | **none** |
| Largest velocity-direction step | 6.16° | **4.27°** |
| Minimum hand speed at the top | 0.395 m/s | **0.526 m/s** |
| Tightest radius at the top | 1.7 cm | **3.5 cm** |
| Peak hand speed | 12.11 m/s | 13.93 m/s |

Peak hand speed is not an improvement, just a consequence — this shape holds a
wider radius through impact, and on an 867°/s torso a wider radius is a faster
hand. See the tempo section for why the torso runs that fast.

### The P-system and shoulder rotation

`REFERENCE_KEYFRAMES` in `src/swing.js` — 11 keyframes over `t ∈ [0, 1]`, synced
to a tour long-iron swing.

| | Position | t | time | shoulders | u (cm) | v (cm) | axis dist (cm) |
| --- | --- | --- | --- | --- | --- | --- | --- |
| P1 | address | 0.0000 | 0.000 s | 0° | **0.0** | −45.0 | 44.5 |
| P1.5 | takeaway | 0.2213 | 0.273 s | +22° | **0.0** | −40.6 | 48.5 |
| P2 | shaft parallel | 0.2868 | 0.354 s | +40° | −5.9 | −25.2 | 55.5 |
| P3 | lead arm parallel to ground | 0.3556 | 0.439 s | +60° | −15.6 | −11.4 | 54.5 |
| P4 | top of backswing | 0.6075 | 0.750 s | **+90°** | −23.7 | −1.5 | 49.4 |
| P5 | early downswing, lead arm parallel | 0.7317 | 0.904 s | +45° | −28.7 | −21.0 | 39.2 |
| P6 | delivery, shaft parallel | 0.7767 | 0.959 s | **0°** | −23.0 | −33.2 | 37.5 |
| P7 | impact | 0.8100 | 1.000 s | −35° | −13.1 | −38.4 | 42.7 |
| P7.5 | release, both arms straight | 0.8307 | 1.026 s | −55° | **0.0** | −35.4 | 52.4 |
| P8 | follow-through, shaft parallel | 0.8505 | 1.050 s | −72° | +4.0 | −26.5 | 55.9 |
| P9 | shoulders square to target | 0.8756 | 1.081 s | **−90°** | +12.8 | −11.7 | 56.3 |
| P10 | finish | 1.0000 | 1.235 s | **−120°** | +22.0 | +0.2 | 50.9 |

The four bold angles are not free parameters — P4, P6, P9 and P10 are *defined*
by their shoulder rotation, so they are pinned exactly and the rest interpolate
between them. P7.5's `u = 0` is forced by geometry, not chosen. P1's `u` and `v`
are derived from the spine tilt and are the values for the 32° default; the axis
distance column is solved, never authored. **The `t` column is solved too** — see
the tempo section below.

**The positions are hand-authored from published swing positions, not motion
capture.** Treat them as a well-shaped starting point you tune by dragging.

### Tempo: where the times come from

The P *angles* say nothing about how fast the torso passes through them, and for a
long time the times were authored by eye. That made the torso turn at a nearly
constant rate, which is wrong in a specific and visible way: it had the golfer
already turning at 138°/s at address and still turning at −138°/s at the finish,
when in fact they are standing still at both.

So the times are no longer authored. What is authored is a torso *angular-velocity*
profile; the times are read off by integrating it.

The profile has three rest points — address, the top, the finish — where ω is
exactly zero, and two smooth humps between them:

```
backswing    ω = A sin²(π t / T_back)     rest → peak → rest
post-top     ramp up to the peak, then decay to rest at the finish
```

The downswing peak is placed 40 ms *before* impact, not at it, because in the
kinematic sequence the thorax peaks and is already handing speed outward by the
time the club arrives.

That leaves four unknowns — the backswing amplitude, the downswing peak, the decay
rate, and the total duration — against four hard constraints, all of which come
from the P-system or from your 3:1 tempo:

- θ = **+90°** at the top (P4 is *defined* as 90° of shoulder turn)
- θ = **−35°** at impact
- θ = **−120°** at the finish (P10 is *defined* as 120°)
- backswing : downswing = **3 : 1**

Four and four, so nothing is fitted or tuned. The solution:

| | |
| --- | --- |
| Backswing (address → top) | **0.750 s** |
| Downswing (top → impact) | **0.250 s** |
| Impact → finish | 0.235 s |
| **Total, `TIMING.swingSeconds`** | **1.235 s** |
| Peak backswing rotation | **240°/s**, at 0.375 s |
| Peak downswing rotation | **867°/s**, 40 ms before impact |
| Ratio, as solved | 3.0000 : 1 |

Every angular velocity scales with `TIMING.swingSeconds`, so changing that one
number retimes the whole swing without touching the shape.

The peak backswing figure, 240°/s, sits normally in the tour range. **The peak
downswing figure, 867°/s, is above the commonly published tour thorax range of
550–750°/s, and it is worth being clear that this is forced rather than chosen.**
125° of rotation in 0.25 s is a *mean* of 500°/s on its own, and any profile that
starts from rest at the top and peaks smoothly puts the peak at roughly 1.7× the
mean. There is no profile shape that satisfies all four constraints and stays under
750°/s. Lowering it means changing one of the constraints, not the profile:

- **less turn at the top** — 80° instead of 90° takes the peak to about 800°/s
- **less unwind by impact** — −25° instead of −35° takes it to about 790°/s
- **a slower ratio** — 3.5:1 with the same backswing lengthens the downswing
- Published thorax peaks are also measured on the *thorax segment*, whereas this
  model has a single rigid torso carrying the shoulders, so the two are not quite
  measuring the same thing.

All four are one-line edits, and the profile re-solves around whichever you pick.

Reconstructing the profile back out of the 12 interpolated keyframes gives 246°/s
and 867°/s against the model's 240 and 867, with ω = 0.0 at all three rest points
— so the keyframe track really does carry the tempo, not just the positions. The
one thing the reconstruction does not hold exactly is *where* the downswing peak
falls: the model places it 40 ms before impact, the interpolated track 23 ms. Only
12 samples describe the whole profile, and the four pinned angles get priority
over the peak's position.

**The same caveat as everywhere else applies: this is derived from published
tour-level kinematic ranges and the P-system's own definitions, not from Rory
McIlroy motion capture, which I do not have.**

### Interpolation, and keeping the 3D path smooth

Five things had to be right before the world hand path flowed without a corner.
When these were fixed, the largest step in velocity direction on the world path
went from **15.4° to 1.05°** and the tightest corner from a 0.47 mm radius to a
genuine, smooth reversal at the top. (Those two figures were measured against the
shape and timing in place at the time; the current defaults are re-measured in the
tables above and below.)

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

**5. Zero tangents at the two ends.** The first and last keyframes have no
neighbour on one side, and the natural fallback is a one-sided difference. But the
golfer is standing still at address and has stopped at the finish, so the correct
end condition is ω = 0, not "whatever the first interval was doing". The one-sided
fallback instead started the torso already turning at ~140°/s and left it still
turning at the finish, and that — more than anything else — is what made the old
timing read as constant angular speed no matter what the keyframe times said.

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

**The rule applies to the hand track only, never to the torso angle.** It is a
statement about the drawn path in `(u, v)` and nothing else. Letting it straighten
the angle track as well makes the torso turn at a *constant* rate for the whole of
that segment — and since the takeaway P1 → P1.5 is a straight segment lasting
273 ms, that alone was enough to put the torso at 80°/s at address, with the
golfer standing still. The angle is always interpolated as a curve.

One curve is *not* distortion and is deliberately kept: P4 → P5 reverses direction
slightly in `u`, because the hands drift a little past the top before changing
direction. That is the transition float, and it is 0.9 cm.
## Controls

| Action | Effect |
| --- | --- |
| Drag on the 2D rectangle | Grabs the nearest keyframe handle, or the keyframe nearest the current time, and moves it. The 3D path reshapes live. |
| Drag the handle on the wrist chart | Aims the shaft: distance from the centre is the wrist hinge, direction is how it hinges. |
| Drag the dial, bottom left of the wrist chart | Rolls the clubface about the shaft. |
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
| `src/config.js` | Every tunable: anthropometrics, rectangle geometry, lock ratio, timing, club, palette. |
| `src/vec3.js` | Dependency-free vector maths on plain `{x,y,z}`. |
| `src/rig.js` | **Spine.** Handedness, spine axis and tilt, the torso rotation, plane ↔ world. Knows nothing above it. |
| `src/arm.js` | **Hand.** The arm rules that solve the perpendicular axis, and two-link elbow IK. |
| `src/club.js` | **Club.** Wrist angles → shaft direction and face normal, and the inverse solve. |
| `src/pose.js` | The composer: driving values in, one full world-space pose out. The only module that knows the whole chain. |
| `src/swing.js` | Keyframe track, interpolation, phase segmentation, path sampling. |
| `src/state.js` | The single observable store all three views subscribe to. |
| `src/canvas2d.js` | Canvas plumbing for the hand panel: fit, hit-test, pointer capture, drag. |
| `src/view2d.js` | The hand rectangle, head-on. |
| `src/view-wrist.js` | The wrist scene: a Three.js chart with a 2D overlay for text and the face dial. |
| `src/view3d.js` | Three.js scene. |
| `src/main.js` | Wiring, controls, readouts, animation loop. |
| `_config.yml`, `Gemfile` | Jekyll / GitHub Pages setup only. The app does not depend on them. |

The chain runs strictly one way — `rig → arm → club → pose` — and none of those
four import Three.js. Vectors convert to `THREE.Vector3` only at the rendering
boundary, so the model stays testable from plain Node and reusable. That split is
what let the club be added by writing one new model file and one new view, rather
than by editing the kinematics.

## The club and the wrist

The club is not a linkage. The hands are one point in this model, so the club is
an **orientation** — three numbers in a frame built at the hand from the two
forearms:

```
f   the lead forearm extended (elbow → hand). The shaft lies along this when the
    wrist is neutral, so it is the zero of the hinge.
n   normal to the plane of the two forearms — the bow/cup axis.
r   completes the frame, in the plane of the forearms — the cock axis.
```

| Channel | Meaning |
| --- | --- |
| `cockDeg` | Hinge of the shaft away from the forearm, **in** the forearm plane. The wrist cock that sets the club. |
| `bowDeg` | The same hinge, **out** of that plane. Bow / cup. |
| `faceDeg` | Roll about the shaft's own axis. Turns the face. `0` is square at address. |

### Why (cock, bow) and not (hinge, azimuth)

The pair is the **exponential map** of the direction sphere about the forearm
axis: total hinge is `hypot(cock, bow)` and its compass direction is
`atan2(bow, cock)`. Two properties earn it its place.

It is a **bijection** onto the sphere, so a 2D drag maps one-to-one onto a 3D
direction. An orthographic projection of the shaft would have been two-to-one and
needed a hidden sign bit to say which way the club leaned out of the screen.

And it is **non-singular at zero hinge**, where the equivalent polar chart is not.
That is not a fine point — it was a bug. Solving the defaults in
`(hinge, azimuth)` gave azimuths that jumped by up to 270° between neighbouring
keyframes, so the club spun through nonsense between checkpoints, purely because
azimuth is ill-conditioned when the hinge is small, which at address and at
release it is. In `(cock, bow)` those same keyframes are a few degrees apart and
interpolate cleanly.

The wrist panel is that chart drawn directly, looked at **straight down the
forearm axis** through an orthographic camera. The hand is the centre of the
circle, distance from it is the hinge, direction round it is the way it hinges —
so screen position simply *is* `(cockDeg, bowDeg)`, and dragging needs no solve
at all. Contour rings at 30 / 60 / 90 / 120 / 150° and the shading of the raised
surface are what make it read as a hemisphere rather than a flat disk.

The screen radius is proportional to the hinge **angle**, not to its sine, and
that is the reason the camera can point straight down at all. A true orthographic
picture of a hemisphere folds everything past 90° back inside the rim, so two
different clubs land on the same pixel and a drag cannot tell them apart. Even
angular spacing keeps the map one-to-one out to 150°, which the finish needs at
148°. The height of the surface is therefore cosmetic — it is what the contours
and the shading describe, and it never affects where anything lands on screen.

### Where the club's defaults come from

Same method as the tempo: solve what the P-system already defines, and only
interpolate the rest. Seven of the twelve positions state where the *club* is,
not where the wrist is, so the wrist angles are back-solved from that:

| | Definition used | Result |
| --- | --- | --- |
| P1 | shaft points at the ball | head **on** the ball |
| P2, P6 | *shaft parallel* — to the ground **and** the target line | shaft exactly (−1, 0, 0) |
| P4 | *not authored* — see below | |
| P7 | shaft points at the ball | |
| P8 | *follow-through shaft parallel* | shaft exactly (+1, 0, 0) |
| P3, P5 | club vertical at lead-arm-parallel, lag retained coming down | |
| P4 | solved to keep the clubhead **rising** into the top | no loop |
| P7.5 | released, in line with the lead arm | |

`faceDeg` is solved to be **square** — face normal down the target line — at
address and at impact, the only two moments where "square" is defined. Between
them it interpolates, and because the face reference is parallel-transported along
the shaft, that means the face simply stays square to the swing arc: no authored
manipulation. Measured, the face comes out at −0.04° at address and +0.02° at
impact.

The club's **length is its own spec** — standard men's lengths, less the 0.10 m
from the butt to where the hands sit on the grip. It is the ball that moves to
suit, not the club that is measured off the pose; see *Picking a club*.

Independent checks the defaults were not tuned against:

| | |
| --- | --- |
| Peak clubhead speed | **45.1 m/s, at t = 0.811** — impact, for the mid iron the defaults are solved at. Tour driver ~50, 6-iron ~35. |
| Peak shaft rotation | 2409°/s, against a `headSpeed / length` ceiling of 3047°/s |
| Clubhead below ground | **never**, for the four irons |
| Face square at address / impact | −0.0° / −0.0° |

### One thing the club does not fix

**At impact the clubhead sits 8.2 cm short of the ball**, and the readout says so
rather than hiding it. This is a real inconsistency the club *exposed* in the hand
path, not one it introduced: the authored impact hand is 8.5 cm **higher** than the
address hand, so no rigid club can touch a fixed ball at both. It is not fixable by
moving things around, and that was checked rather than assumed —

- no position for P7 within ±30 cm of where it sits satisfies the constraint;
- no ball position works either: solving for a ball both hands can reach pushes it
  98 cm away from the golfer and still leaves a 37 mm residual, on a 1.43 m club.

Closing it means deciding that the impact hand should be lower, which is a change
to the authored swing rather than to the club, so it is left alone. The address
position is pinned instead, because that is where a club's length is *defined* —
you pick the club that reaches the ball at setup.

### The loop at the top

**P4's club position is not something the P-system defines.** P4 is defined by
90° of *shoulder* turn — it says nothing about where the club points. Authoring a
"shaft parallel at the top" there was an invented constraint, and it cost:
it forced the wrist hinge down to 34° between 94° at P3 and 77° at P5, so the
wrists **uncocked and re-cocked** across the top. Measured on the clubhead, that
dropped it 57 cm and lifted it 45 cm again — an extra loop in the middle of the
backswing.

The hinge is now solved instead to keep the clubhead *rising* into the top, at
the bearing its two neighbours share so the wrist does not swing round either.
The clubhead height profile goes from four alternating swings to three:

| | Before | After |
| --- | --- | --- |
| Backswing | up 2.15 m, **down 57 cm, up 45 cm** | up 2.17 m |
| Downswing | down 1.93 m | down 2.10 m |
| Follow-through | up 2.17 m | up 2.25 m |

The cost is that the shaft is no longer parallel to the target line at the top.
That is not recoverable here: at this hand position the lead arm points close
enough to the target line that a parallel shaft makes only ~30° with it, so
"parallel at the top" and "wrists still cocked" cannot both hold. Raising the
hand does not help — the hinge stays near 30° at any height, because the arm's
bearing is set by the shoulder turn, not by how high the hands are.

### And one the club change exposed

**On the fairway wood and driver the clubhead passes below ground** through
impact — 6.8 cm and 11.1 cm at its deepest, both at t ≈ 0.816, just after the
strike. The four irons never do.

This is the same kind of finding, from the same cause: there is **one** authored
hand path and six clubs. Going from the mid iron the defaults were solved at to
the driver lengthens the club by 21.6 cm while the address only lifts the hands
by 4.4 cm, so the same arc reaches about 17 cm deeper. A real driver swing is not
the iron swing with a longer club — it is wider and shallower, with the low point
behind a teed ball — and the model has no way to say that while the hand path is
shared.

The honest fixes are both bigger than a constant: author a hand path per club, or
make the path's radius scale with club length. Neither is a tuning change, so the
dip is reported rather than papered over.

### Extending it

- **Two hands.** Split the grip point into two offsets along `club.shaftDir`.
- **Lie and loft.** `solveClub` returns `faceNormal` and `leadingEdge`
  perpendicular to the shaft; a real head sits off the shaft axis and the face is
  tilted back by the loft.
- **A different club per shot.** `setClubLength` is already a runtime setter, and
  `main.js` pins it to the address pose on every change — point it somewhere else
  and everything downstream follows.

## Tuning

Elbow swivel is resolved by a hint vector per arm (`ELBOW_HINT` in
`config.js`), expressed as `up`/`fwd`/`side` weights in the rotating torso basis.
Both elbows default to pointing down and slightly behind the shoulder-to-hand
line. The hint is constant through the swing, so the finish position in
particular is a plausible solve rather than a matched one — adjust the weights,
or make the hint time-varying, if you need a specific elbow attitude.
