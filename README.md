# Golf Swing Hand Path — 3D Simulator

Three synchronised views of how the hands and the club move **relative to the
torso** through a golf swing, shaped after Rory McIlroy's sequencing.

- **Left — 2D hand rectangle.** The torso-fixed rectangle seen head-on, relative
  to the elbow line. Drag here to reshape the swing.
- **Below it — club aim.** Which way the club points, in the **same torso frame**
  as the panel above, with the hand pinned at the centre. Looked at straight down
  the spine axis, so it reads as a bowl: the middle is the club hanging straight
  down, the rim is straight up. Drag to aim it; a dial rolls the face.
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

The **club** slider replaces the old spine-tilt slider. Six detents, defaulting to
the **driver**, and the club owns the address: its spine angle, its length, and
where the ball sits.

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

In the torso frame the hand path is a narrow **V** — which is what a hand path
looks like once the body's own rotation is taken out of it.

| Phase | Shape |
| --- | --- |
| Takeaway P1 → P1.5 | a straight vertical line — `u` holds at exactly 0 |
| Backswing P1.5 → P4 | up and across to the trail side, reaching its extreme in **both** `u` and `v` at the top |
| Downswing P4 → P7 | back down *inside* the backswing, and much straighter — P5, P6, P7 and release are very nearly collinear |
| Follow-through P7.5 → P10 | out to the lead side and up, shallower than the backswing, finishing level with the lead shoulder |

Two of these have consequences beyond looking right:

- **The takeaway holds `u = 0`.** At `u = 0` the hand is equidistant from both
  shoulders, so *both* arms are equally straight. The takeaway is therefore
  one-piece by construction, not by tuning.
- **The top is an extremum of both coordinates.** That is what makes it a corner
  rather than a curve, and it is why the interpolation has to be careful there —
  see below.

### Why this shape gives a smooth 3D path

2D convexity and 3D smoothness are independent, so the shape alone guarantees
nothing; what does it is the interpolation, and specifically **limiting `u` and
leaving `v` free**. Measured over 3000 samples of the world hand path:

| | `u` and `v` both free | `u` and `v` both limited | **`u` limited, `v` free** |
| --- | --- | --- | --- |
| Largest velocity-direction step | 84.9° | 170.2° | **1.24°** |
| Steps above 2° | 4 | 5 | **0** |
| Minimum hand speed near the top | 0.327 m/s | 0.002 m/s | **0.362 m/s** |
| Tightest radius at the top | 1.0 cm | 0.0 cm | **1.1 cm** |
| Free-arm limit violations (of 4000) | 681 | 0 | **0** |

Both extremes fail, in opposite directions. Left free, `u` bulges 2.5 cm to the
lead side across the takeaway and breaks the free-arm limit — a pose the arms
cannot make, not a cosmetic wobble. Limited on both channels, `u` and `v` turn
together at the top, both tangents go to zero, and the hand stops **dead**: a
zero-radius cusp in world space.

With `u` limited and `v` free the hand lands exactly on the top in `u` while `v`
floats **2.1 cm** past it and comes back. That float is the transition, and it is
what carries the hand around the corner instead of into it.

### The P-system and shoulder rotation

`REFERENCE_KEYFRAMES` in `src/swing.js` — 12 keyframes over `t ∈ [0, 1]`, synced
to **Rory McIlroy's driver** as measured by TaylorMade's GEARS capture: roughly
116° of shoulder turn over 42° of hips at the top, a late wrist set, and ~122 mph
of clubhead speed. This torso is a single rigid rotation, so it carries **110°**
at the top — between his shoulder and hip numbers, weighted to the shoulder line
the model actually pins.

| | Position | t | time | shoulders | u (cm) | v (cm) | axis dist (cm) |
| --- | --- | --- | --- | --- | --- | --- | --- |
| P1 | address | 0.0000 | 0.000 s | 0° | **0.0** | −46.7 | 39.2 |
| P1.5 | takeaway | 0.2149 | 0.265 s | +25° | **0.0** | −36.5 | 48.8 |
| P2 | shaft parallel | 0.3316 | 0.410 s | +65° | −6.6 | −23.0 | 53.8 |
| P3 | lead arm parallel, shoulders 90° | 0.4106 | 0.507 s | +90° | −12.7 | −13.9 | 53.6 |
| P4 | top of backswing | 0.6075 | 0.750 s | **+110°** | −20.3 | −2.9 | 50.2 |
| P5 | early downswing, lead arm parallel | 0.7317 | 0.904 s | +55° | −16.7 | −18.8 | 49.5 |
| P6 | delivery, shaft parallel | 0.7830 | 0.967 s | 0° | −7.9 | −35.8 | 45.5 |
| P7 | impact | 0.8100 | 1.000 s | **−35°** | −4.5 | −38.1 | 45.6 |
| P7.5 | release, both arms straight | 0.8307 | 1.026 s | −55° | **0.0** | −40.1 | 45.9 |
| P8 | follow-through, shaft parallel | 0.8530 | 1.053 s | −72° | +2.2 | −32.2 | 50.9 |
| P9 | shoulders square to target | 0.8920 | 1.102 s | −94° | +6.2 | −26.2 | 52.4 |
| P10 | finish | 1.0000 | 1.235 s | **−120°** | +19.1 | −0.1 | 51.1 |

The three bold angles are the measured anchors — 110 at the top, 35 open at
impact, 120 at the finish. P3 sits at 90 because that is where GEARS puts Rory's
shoulders at lead-arm-parallel. P7.5's `u = 0` is forced by geometry, not chosen.
P1's `u` and `v` are the anchored address and are the same for **every** club;
the axis distance column is solved, never authored.

**Two kinds of times.** The backswing times (P1.5, P2, P3) are the inverse of the
sin² rate profile below at 25°, 65° and 90°. The release times (P6, P8, P9) are
solved from the SHAFT instead: the club rotates at ~2 600 °/s through delivery
and impact and decays through the follow-through, and those checkpoints sit
where that rotation puts them — using the true spherical arc between the
checkpoint directions, not the in-plane angle. P6 to impact is **87°** of real
arc (the aim swings out to the ball as well as down), which at 2 600 °/s puts P6
at t = 0.783; eyeballing it at 0.7767 was enough to spike the shaft rotation to
3 500 °/s, and a uniform spread of P8/P9 had peak clubhead speed landing 50 ms
*after* impact.

**The hand positions are hand-authored — tuned by dragging on this app's own 2D
panel, not motion-captured.** The wrist track is then solved against them. Treat
the whole thing as a well-shaped starting point you keep tuning.

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

- θ = **+110°** at the top (Rory's GEARS-measured driver turn, single-axis model)
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
| Peak backswing rotation | **293°/s**, at 0.375 s |
| Peak downswing rotation | **~1100°/s**, measured just before impact |
| Ratio, as solved | 3.0000 : 1 |

Every angular velocity scales with `TIMING.swingSeconds`, so changing that one
number retimes the whole swing without touching the shape.

The peak backswing figure, 293°/s, sits normally in the tour range. **The peak
downswing figure, ~1000°/s, is above the commonly published tour thorax range of
550–750°/s, and it is worth being clear that this is forced rather than chosen.**
145° of rotation in 0.25 s is a *mean* of 580°/s on its own, and any profile that
starts from rest at the top and peaks smoothly puts the peak at roughly 1.7× the
mean. There is no profile shape that satisfies the constraints and stays under
750°/s. It is also not quite the same quantity: published thorax peaks are
measured on the *thorax segment* over a moving pelvis, whereas this model has one
rigid torso carrying shoulders and hips together — Rory's hips alone unwind more
than 100° from the top to impact, and this axis is carrying that too.

Measured off the interpolated track: ω = 0.0°/s at address, the top and the
finish, so the keyframes really do carry the rest points, not just the positions.

**The same caveat as everywhere else applies: this is derived from Rory's
published GEARS numbers, standard specs and the P-system's own definitions, not
from motion capture I have access to.**

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

**2. Monotone limiting — for the torso angle and for `u`, but not `v`.** With
correct tangents the angle track overshot by 7° past a top that is a *measured*
number. That is a correctness bug — the anchors (the top, impact, the finish) are
data, not shapes — so the angle track gets a Fritsch-Carlson limiter: zero
tangent at a local extremum, capped elsewhere. Max turn is now exactly 110.00° at
P4 and −120.00° at P10.

`u` gets it too, for a different reason: `u` is **bounded by the arm rules**.
`freeArmULimit` shows the free arm runs out of length a few millimetres either
side of the sternum, so an overshoot in `u` is a pose the arms cannot make. `v`
does not get it, because limiting both stops the hand dead at the top. The
numbers for all three cases are in *Why this shape gives a smooth 3D path*.

The club's aim does NOT get it: it is a spherical spline through world
directions — see *The delivery plane* — whose path curves rather than turns, and
the limiter's zero-tangent rule froze the club mid-follow-through when a chart
variant tried it. `faceDeg` is monotone across the whole swing, so there is
nothing to catch.

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

#### Straight segments, and why the rule is now off

Two keyframes close together still inherit a tangent scaled to their distant
neighbours, and the cubic between them detours. `CURVE.straightBelow` joins any
segment shorter than it with a straight line instead.

It is set to **0**, and the measurement is why. Limiting `u` already removes the
overshoot the rule existed to fix, and the current path has several short segments
in a row through impact — P6 → P7 is 4.1 cm, P7 → P7.5 4.9 cm, P7.5 → P8 8.2 cm,
P8 → P9 7.2 cm — so turning the rule on converts that whole stretch into a
polyline and puts a **94° corner at release**, where the hand path has no business
having one. With the rule off, the worst segment on the reference swing runs at
arc/chord **1.033** and the sharpest corner in the `(u, v)` path is **3.2°**.

Raise it to force short segments straight anyway; `CURVE.straightBelow = Infinity`
gives an all-straight polyline — that is the whole change, one value in
`config.js`.

**The rule applies to the hand track only, never to the torso angle.** It is a
statement about the drawn path in `(u, v)` and nothing else. Letting it straighten
the angle track as well makes the torso turn at a *constant* rate for the whole of
that segment — and since the takeaway P1 → P1.5 is a straight segment lasting
273 ms, that alone was enough to put the torso at 80°/s at address, with the
golfer standing still. The angle is always interpolated as a curve.
## Controls

| Action | Effect |
| --- | --- |
| Drag on the 2D rectangle | Grabs the nearest keyframe handle, or the keyframe nearest the current time, and moves it. The 3D path reshapes live. |
| Drag on the club-aim chart | Aims the shaft: distance from the centre is how far the club is from hanging straight down, direction is which way round the body it points. |
| Drag the dial, bottom left of the club-aim chart | Rolls the clubface about the shaft. |
| Space | Play / pause |
| ← / → | Step keyframe |
| H, or the handedness button | Flip right- / left-handed |
| club slider | Six clubs, wedge to driver. Sets the spine tilt, the club length and the ball position together; P1 itself never moves. Defaults to **driver**. |
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
| `src/view-wrist.js` | The club-aim scene: a Three.js chart in the torso frame, with a 2D overlay for text and the face dial. |
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
H   the handedness sign, which both n and r carry, and which the roll needs too.
```

The frame is *stored* in, and drawn *against*, two different things: the numbers
below are joint angles against the forearm, but the panel that shows them is in
the torso frame. See *The panel* below for why.

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
keyframes, purely because azimuth is ill-conditioned when the hinge is small,
which at address and at release it is.

Note what the pair is and is not used for: it is how a keyframe's wrist is
**stored and dragged** — a joint angle, against the bone above it. It is *not*
how the club is interpolated between keyframes; that happens on the torso-frame
chart instead, for reasons given under *The club through the top*.

### The panel: the club's aim, in the torso frame

The wrist panel used to be drawn in the **hand frame**, with the lead forearm
fixed and the club moving against it. That is the frame the numbers are *stored*
in — a wrist angle is a joint angle, and joints are measured against the bone
above them — but it is a poor frame to look at, because the forearm is itself
swinging round. The club could be dead still in space and the panel would show it
moving. Reading it meant holding two rotations in your head at once.

It is now drawn in the **torso frame**, the same one the hand rectangle above it
uses. Legs and spine are static in this model, so a shaft that holds still on the
chart is a shaft that is close to holding still in the world.

```
centre    the club hanging straight down the spine axis
radius    phi, the angle away from straight down: 0 at the centre, 180 at the rim
bearing   which way round the body it points — toward the ball, behind you,
          toward the lead side, toward the trail side
```

Radius is `phi / 180`, **evenly spaced**, which is what makes the map
one-to-one — a true orthographic sphere would put `phi` and `180 − phi` on the
same ring and a drag could not tell them apart. The surface is drawn at the
sphere's own height, `−cos(phi)`, so it reads as a bowl with a flared rim: the
club hanging straight down is at the bottom of the bowl, level is the 90 ring at
the lip, and anything above level is out on the brim. Contours are lines of equal
**height**, as on a topographic map, so they bunch where the surface is steep —
that bunching is the depth cue. The shaft is drawn **translucent** from the hand
at the centre out to the surface, because from directly above a leaning shaft is
foreshortened and its lean is the thing worth seeing.

Dragging goes the long way round — chart point → torso components → world
direction → `wristForDirection` — because the chart and the storage are in
different frames. The hand frame is built from the hand and the two elbows, none
of which the wrist touches, so it is fixed for the whole of a drag. Round-tripping
a keyframe through the chart and back reproduces its shaft direction to 2 × 10⁻¹⁶.

**This is what removed the cap on the finish.** The old hemisphere held exactly
90° of hinge, and past 90 an orthographic picture folded back inside the rim, so
the swing had to be authored to stay inside it — P10 sat at 82° when the real
finish wants the club folded right back over the shoulder. The torso chart holds
the whole sphere, so the cap is gone and P10 is now the real position: **171°** of
hinge away from the forearm. The whole track peaks at 151.8° of torso-frame polar
angle, against 180 available.

### Where the club's defaults come from

Same method as the tempo: solve what the P-system already defines, and only
interpolate the rest. Every one of the twelve positions states where the *club*
is, not where the wrist is, so the wrist angles are back-solved from that:

| | Definition used | Result |
| --- | --- | --- |
| P1 | shaft points at the ball | head **on** the ball, 0.9 cm |
| P1.5 | shaft aimed at a **point** 70 cm back down the target line, 15 cm up | head sweeps back low |
| P2 | *shaft parallel* — to the ground **and** the target line | (−1, 0, 0); only 23° of hinge — Rory's late set |
| P3 | 75° above horizontal, on plane — the set arriving | head at its backswing-high 2.25 m |
| P4 | **12° short of parallel**, pointing at the target, a touch of lay-off | hinge 113° |
| P5 | laid **back** into the delivery plane — the shallowing move | hinge 137°, dynamic lag |
| P6 | *shaft parallel*, still 7° inside | head approaches from behind the hands |
| P7 | shaft points at the ball | |
| P7.5 | 55° past the ball-aim, rotating in the delivery plane | |
| P8 | *follow-through shaft parallel* | (+1, 0, 0) |
| P9, P10 | up past the lead shoulder, then folded back behind it | 171° of hinge at the finish |

Two of these are aimed at things rather than angles, and one is deliberately
off plane. P1.5 aims at a *point* on the ground because address and takeaway are
far apart in bearing around the forearm, and aiming an elevation let the
interpolated hinge dip the head under the turf on the way. And P5 carries a
**z component**, because the real transition move is not on the plane at all:
the hands drop while the shaft falls onto a *flatter* plane behind them. Authored
on plane, the interpolated head swept out toward the ball line while still high —
an over-the-top move Rory does not make; laid back, it drops inside, which is
the tour pattern the down-the-line view shows.

`faceDeg` is solved to be **square** — face normal down the target line — at
address and at impact, the only two moments where "square" is defined. Between
them it interpolates, and because the face reference is parallel-transported along
the shaft, that means the face simply stays square to the swing arc: no authored
manipulation. Measured, the face comes out at −0.03° at address and −0.06° at
impact.

The club's **length is its own spec** — standard men's lengths, less the 0.10 m
from the butt to where the hands sit on the grip. It is the ball that moves to
suit, not the club that is measured off the pose; see *Picking a club*.

Independent checks the defaults were not tuned against:

| | |
| --- | --- |
| Peak clubhead speed | **55.5 m/s = 124 mph at t = 0.799**, 50.7 m/s through impact — Rory's measured driver is ~122 mph. |
| Peak shaft rotation | ~2 700°/s, held nearly flat from delivery through impact, decaying after — the real release shape |
| Shaft off the delivery plane, t 0.66 → release | **≤ 1.5°** |
| Clubhead below ground | **never — all six clubs** |
| Face square at address / impact | −0.03° / −0.06° |
| Handedness mirror | lefty matches `mirror(righty)` to **0.0 m** on hand, head, shaft, face, toe and crown at every sample |

### One thing the club does not fix

**At impact the clubhead falls short of the ball**, and the readout says so rather
than hiding it. How short depends entirely on the club:

| Club | Head → ball, address | Head → ball, impact |
| --- | --- | --- |
| Wedge | 0.2 cm | 23.7 cm |
| Short iron | 0.0 cm | 21.6 cm |
| Mid iron | 0.0 cm | 19.2 cm |
| Long iron | 0.1 cm | 16.8 cm |
| Fairway wood | 0.3 cm | 10.1 cm |
| **Driver** | 0.9 cm | **5.1 cm** |

This is a real inconsistency the club *exposed* in the hand path, not one it
introduced: the authored impact hand is higher than the address hand, so no rigid
club can touch a fixed ball at both. It is not fixable by moving things around,
and that was checked rather than assumed — no position for P7 within ±30 cm
satisfies the constraint, and solving for a ball both hands can reach pushes it
98 cm away from the golfer and still leaves a residual.

The gradient down the table is the same "one hand path, six clubs" limitation as
below: the defaults are solved for the **driver**, so the driver is nearly right
and the wedge is the furthest off. Closing it means deciding the impact hand
should be lower — a change to the authored swing rather than to the club — so it
is left alone. The address position is pinned instead, because that is where a
club's length is *defined*: you pick the club that reaches the ball at setup.

### The delivery plane, and how the club is interpolated

The user-visible test of a golf swing model is the **swing-plane sheet**: draw
the shaft every few milliseconds and look down the line. A real driver sweeps
one flat, tilted sheet from delivery through impact — Hogan's pane of glass,
tilted 45–50° for a driver. Two things had to change before this model's sheet
came out flat instead of crumpled.

**The downswing checkpoints are authored IN a delivery plane.** The plane is
solved, not chosen: it is the tilt at which the impact aim (hand to ball) lies
in a plane through the target line, and it comes out at **50°**, inside the
published driver range. P5's lay-back, P6's parallel, impact and the release are
all projected into that plane. Their directions then sit on one great circle of
the direction sphere.

**The club is interpolated as a spherical spline, in world space.** This is the
third frame the interpolation has lived in, and each move was forced by a
visible failure:

| Interpolated in | What went wrong |
| --- | --- |
| Wrist coordinates (cock, bow) | Joint angles against a forearm that itself sweeps a huge arc: the world shaft direction waved across the swing plane **fifteen times**. |
| An exponential chart (torso, then world) | Any single chart distorts somewhere, and the swing covers 260°+ of direction space. The world chart's pole sat 40° from the impact aim, where the map compresses 3:1 — shaft rotation collapsed from 3 000 °/s to 850 exactly at impact. |
| **Geodesic (slerp) cubic segments on the sphere itself** | Nothing. No frame, no pole, no distortion. |

The two changes lock together: a geodesic between two directions on a great
circle *stays on that circle*, so once the checkpoints are in the plane, the
interpolated shaft is too — measured, it stays within **1.5° of the delivery
plane for the whole of t = 0.66 → release**, and the down-the-line sheet
collapses onto a single tilted blade.

The spline is `sphereCubic` in `swing.js`: cubic Bézier via slerp De Casteljau,
with Bessel knot tangents built from log-maps and zero tangents at address and
finish (the golfer is at rest). Keyframes still *store* (cock, bow) — the panel
drags them, the address solver writes them — the direction track is derived and
cached.

With that in place the top reads like the real thing:

| | P3 | P4 (top) | P5 |
| --- | --- | --- | --- |
| Hand height | 1.23 m | 1.45 m | 1.08 m |
| Shaft elevation | 75° | **12°** | 43°, laid back into the plane |
| Clubhead height | 2.25 m | 1.67 m | 1.72 m |

Head-height turning points over the whole swing, all five of them real:

| t | Clubhead height | |
| --- | --- | --- |
| 0.441 | 2.34 m | backswing high point, before the top |
| 0.684 | 1.39 m | just past the parallel top — a local **low** |
| 0.745 | 1.80 m | crossover apex, the club still travelling |
| 0.810 | 0.09 m | impact |
| 0.904 | 2.35 m | over the shoulder, into the finish |

### One authored hand path, six clubs

The hand path is solved for the **driver**. The other clubs ride the same track
with their own lengths and addresses, and the cost is at impact: the wedge's head
falls 23.7 cm short of the ball (see above). No club ever digs below ground —
that used to be the wood and driver's failure mode by 7–11 cm when the defaults
were solved for the mid iron. A real wedge swing is not the driver swing with a
shorter club, and the model has no way to say so while the hand path is shared;
the honest fixes — a path per club, or a radius that scales with club length —
are both bigger than a constant, so the shortfall is reported rather than papered
over.

### Mounting the head

The head hangs off the end of the shaft at the club's **lie angle**, not square to
it. Square to the shaft is what made it read as a hammerhead, and it was wrong:
the sole runs at the lie angle to the shaft — 56° on the driver, 64.5° on the
wedge — measured on the *heel* side, so the toe sits `180 − lie` round from the
shaft's own direction.

```
toe     = shaft·cos(lie) + across·sin(lie)     the sole line, heel to toe
across  = H · (shaft × faceNormal)             perpendicular to the shaft, in the face plane
crown   = H · (toe × faceNormal)               sole to crown
```

The box sits at `club.head` — the middle of the face, which is where the ball is
struck — and extends toward the **toe**, which is *away from the golfer*. The
shaft stops short of it at the **hosel**, in from the heel and up at the crown,
with a short neck bridging the gap. Getting the sign of `across` backwards hung
the head on the near side of the shaft; running the shaft to the box centre
instead put it straight through the middle of the head.

Two sign traps live here, and both bit:

- **`across` and `crown` carry the handedness sign.** A left-handed club is the
  *mirror image* of a right-handed one, and a cross product comes back **negated**
  under a mirror. Without the sign the lefty's head pointed at his own feet.
- **`(toe, crown, faceNormal)` is a left-handed triple for a righty.** That is
  forced by the geometry, and feeding a reflection to `setRotationFromMatrix` gets
  a nonsense quaternion out — the head ends up at a garbage attitude. The view
  builds its basis as `(toe, crown, toe × crown)`, which is a proper rotation for
  both, and moves the *face slab* to whichever side that lands on.

The same mirror problem was in the wrist frame itself: `n` is one cross product
deep and `r` is two, so `r` needed the handedness sign as well, and the roll about
the shaft has to *reverse* for a lefty because a mirror reverses the sense of a
rotation. Before that, a left-hander addressed the ball with the **back** of the
club, 174° off square. The lefty swing is now `mirror(righty)` to machine
precision at every sample.

### Extending it

- **Two hands.** Split the grip point into two offsets along `club.shaftDir`.
- **Loft.** `solveClub` now angles the head at the club's lie, but the face is
  still vertical: `faceNormal` is perpendicular to the shaft rather than tilted
  back by the loft.
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
