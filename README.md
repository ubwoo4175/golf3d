# Golf Swing Hand Path — 3D Simulator

Two synchronised views of how the hands move **relative to the torso** through a
golf swing, shaped after Rory McIlroy's sequencing.

- **Left — 2D hand plane.** The torso-fixed plane seen head-on, relative to the
  elbow line. Drag here to reshape the swing.
- **Right — 3D world space.** The same motion with the torso rotating about a
  fixed spine axis, plus the full-swing hand path.

Both views read from a single normalised swing time `t`, so they can never drift
out of step.

## Running it

No build step. Any static server works:

```sh
python3 -m http.server 8000     # then open http://localhost:8000
```

Three.js is loaded from a CDN via an import map, so it must be served over HTTP —
opening `index.html` straight off the filesystem will fail on module CORS.

## The model

Assumptions, per the spec:

| Element | Treatment |
| --- | --- |
| Legs, pelvis, spine angle | Static. Drawn once, never animated. |
| Torso | One degree of freedom: rotation `θ` about a fixed, tilted spine axis. |
| Shoulders | Fixed to the top of the torso, so they rotate with it. |
| Arms | Shoulder → elbow → hands, both hands meeting at one grip point. Shoulders + hands form the classic triangle. |
| Hands | Confined to a torso-fixed rectangle. |

### Coordinates

World space is Y-up with the ground at `y = 0`, `+X` the target direction (also
the golfer's lead side), and `−Z` the direction the chest faces at address. The
model is a right-handed golfer.

The torso basis is `(side, up, fwd)`: `up` is the spine axis, `side` runs along
the shoulder line toward the lead side, `fwd` is the chest normal.

### The hand plane

> *"The hand will move on a rectangle plane, with equal distance from the spine axis."*

A plane is equidistant from a line only when it is **parallel** to it, so the hand
plane is parallel to the spine axis at a constant `PLANE.offset` (30 cm) in front
of the chest. Being torso-fixed, it rotates with the torso — which is exactly
what makes it the natural 2D view. In-plane coordinates are measured from the
shoulder centre:

- `u` along the shoulder line, positive toward the lead side
- `v` along the spine axis, positive toward the head

`kinematics.js` verifies this: the axis-to-plane distance is 0.300000 m at every
torso angle.

### The elbow rules, and one geometric conflict

The spec's rules are:

| Phase | Lead (left) elbow | Trail (right) elbow |
| --- | --- | --- |
| Backswing | straight | folds |
| Downswing | straight | extends |
| Impact | straight | *still* extending |
| Follow-through | folds | extended |

**These cannot hold while the hand roams the whole rectangle.** A straight lead
arm puts the hand on a sphere of radius `REACH` about the lead shoulder;
intersecting that sphere with the hand plane gives a *circle*, not an area. So a
freely dragged hand cannot keep the lead elbow locked.

The app resolves this by making the rules shape the **authored reference swing**
rather than clamping the cursor:

- Address through impact, the keyframes' `v` is **derived** from `u` by
  `lockedLeadV()` so the lead arm sits at exactly `LEAD_LOCK_RATIO` (99%) of full
  extension. Only `t`, torso angle and `u` are hand-authored. The rule holds by
  construction and cannot drift when you edit the data.
- Through the follow-through, `v` is authored directly, because the lead elbow is
  now folding.
- Dragging is free. Both elbows are solved by IK and the footer reports each
  one's extension and flex, so you can see the rules hold — or watch them break.
- The two dashed circles on the 2D plane are where each arm is exactly straight.
  Outside their overlap the point is out of reach; that region is shaded, the
  hand marker turns red, and the offending arm turns red in 3D.

Note that "straight" reads as ~16° of flex in the readout rather than 0°. That is
not an error: the cosine is extremely flat near full extension, so 99% extension
of a 32 cm + 35 cm arm really is a 16° elbow angle. Real lead arms carry a few
degrees of flex too. Set `LEAD_LOCK_RATIO` to 1.0 for a mathematically straight
arm, at the cost of sitting exactly on the reach boundary.

### The reference swing

`REFERENCE_KEYFRAMES` in `src/swing.js` — 12 keyframes over `t ∈ [0, 1]`,
Catmull-Rom interpolated, ~1.35 s at full speed. It approximates Rory's
positions: a wide low takeaway, 93° of shoulder turn at the top, a deep
transition where the hands drop while the torso is already unwinding, and long
extension through impact.

**It is hand-authored from published swing positions, not motion capture.** Treat
it as a well-shaped starting point you tune by dragging, not as measured truth.

## Controls

| Action | Effect |
| --- | --- |
| Drag on the 2D plane | Grabs the nearest keyframe handle, or the keyframe nearest the current time, and moves it. The 3D path reshapes live. |
| Space | Play / pause |
| ← / → | Step keyframe |
| Drag / scroll on 3D | Orbit / zoom |

The timeline is the master clock: `t` sets both the torso angle and the reference
hand position. Dragging rewrites a keyframe's hand position; it never changes its
time or torso angle.

## Layout

| File | Responsibility |
| --- | --- |
| `src/config.js` | Every tunable: anthropometrics, plane geometry, timing, palette. |
| `src/vec3.js` | Dependency-free vector maths on plain `{x,y,z}`. |
| `src/kinematics.js` | Torso basis, plane ↔ world mapping, two-link arm IK. No rendering, no time. |
| `src/swing.js` | Keyframe track, interpolation, phase segmentation, path sampling. |
| `src/state.js` | The single observable store both views subscribe to. |
| `src/view2d.js` | Canvas 2D plane view and drag editing. |
| `src/view3d.js` | Three.js scene. |
| `src/main.js` | Wiring, controls, readouts, animation loop. |

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
