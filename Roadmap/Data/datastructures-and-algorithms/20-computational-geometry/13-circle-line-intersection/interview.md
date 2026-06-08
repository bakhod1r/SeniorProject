# Circle–Line Intersection — Interview Preparation

> Coverage: the geometric (foot + half-chord) and algebraic (quadratic-substitution) methods, the 0/1/2-point classification, circle-segment / circle-ray clamping, the tangent case, numerical robustness, and the ray-tracing / collision applications. Questions are tiered junior → professional, followed by a 3-language coding challenge.

---

## How to Use This File

Each question lists the **expected answer focus** — the points an interviewer wants to hear. Practice saying the answer out loud, then check yourself against the focus column. The coding challenge at the end should be solved cleanly in all three languages.

---

## Junior Questions

| # | Question | Expected Answer Focus |
|---|----------|-----------------------|
| 1 | What are the possible numbers of intersection points between a line and a circle? | Exactly 0, 1, or 2. 1 is the tangent case. |
| 2 | How do you decide the count without finding the points? | Compute `d` = perpendicular distance from centre to line; compare with `r`: `d>r`→0, `d==r`→1, `d<r`→2. |
| 3 | What is the formula for the perpendicular distance from a point to a line through `A`, `B`? | `d = |cross(A,B,C)| / |AB|`, where `cross(A,B,C)=(Bx-Ax)(Cy-Ay)-(By-Ay)(Cx-Ax)`. |
| 4 | What is the half-chord length and where does it come from? | `h = sqrt(r² - d²)`; it is Pythagoras on the right triangle with legs `d` and `h`, hypotenuse `r`. |
| 5 | Given the foot of perpendicular `F`, how do you get the two points? | `P = F ± h·û`, where `û` is the unit direction of the line. |
| 6 | What is the foot of perpendicular and how do you compute it? | The closest point on the line to the centre; `t = ((C-A)·dir)/(dir·dir)`, `F = A + t·dir`. |
| 7 | Why avoid the `y = mx + b` substitution? | Vertical lines have infinite slope; the vector method has no such special case. |
| 8 | What happens to `r² - d²` when the line misses the circle? | It is negative; `sqrt` of a negative is the signal for "0 points." Check the sign first. |
| 9 | What is a tangent line, in terms of `d` and `r`? | A line with `d == r`; it touches at exactly one point (`h = 0`). |
| 10 | A line passes through the circle's centre. How many points, and what is `h`? | Two points (a diameter); `d = 0`, so `h = r`. |
| 11 | Why must you use an epsilon to detect tangency with floats? | `d == r` is essentially never exactly true in floating point; use `|d - r| < eps` or `h < eps`. |
| 12 | What is the time complexity of one circle–line test? | `O(1)` — a fixed amount of arithmetic and one sqrt. |
| 13 | Name two real applications. | Ray tracing (ray vs round object), collision (ball vs circular wall), robot range sensing, map zone crossing. |
| 14 | How do you check a point lies on the circle? | `(x-cx)² + (y-cy)² == r²` (within eps). |

---

## Middle Questions

| # | Question | Expected Answer Focus |
|---|----------|-----------------------|
| 1 | Derive the quadratic from substituting the parametric line into the circle. | `P=O+tD`, `f=O-C`; `(D·D)t² + 2(f·D)t + (f·f - r²) = 0`, so `a=D·D, b=2(f·D), c=f·f-r²`. |
| 2 | What is the discriminant and what does its sign mean? | `Δ = b² - 4ac`; `<0`→0 pts, `==0`→1 (tangent), `>0`→2 (secant). |
| 3 | How is the discriminant related to `r² - d²`? | `Δ = 4a²(r² - d²)` (with `a = D·D`), so same sign — the two methods test the same thing. |
| 4 | How do you turn an infinite-line result into a **segment** result? | Each root has a parameter `t`; keep only `0 <= t <= 1` (with `O=A, D=B-A`). |
| 5 | How do you turn it into a **ray** result? | Keep only roots with `t >= 0`. |
| 6 | For a ray, how do you find the nearest hit including the origin-inside case? | Roots `t1<=t2`: if `t2<0` miss; if `t1>=0` return `t1`; else (`t1<0<=t2`) origin is inside, return `t2`. |
| 7 | A segment lies entirely inside the circle. How many intersection points? | Zero — both roots are outside `[0,1]`; the segment never reaches the boundary. |
| 8 | What is the surface normal at an intersection point? | `(P - C)/r`, pointing outward; flip for an inside hit (refraction/collision response). |
| 9 | Why does graphics prefer the quadratic method over the geometric one? | It yields the parameter `t` directly (needed for clamping/nearest hit) and generalises unchanged to 3-D spheres. |
| 10 | Why is comparing `d²` vs `r²` better than `d` vs `r` for the count? | It avoids a square root; you only sqrt when you actually need the points. |
| 11 | What goes wrong with a fixed absolute epsilon for the discriminant? | `Δ` has units of length⁴; a fixed eps is scale-dependent. Normalise `D` (a=1) or test `|d-r|`. |
| 12 | What is the danger of computing `r² - d²` directly near tangency? | Catastrophic cancellation: a tiny result from subtracting two large near-equal numbers loses precision. |
| 13 | How do you reduce that cancellation? | Translate `C` to origin, normalise `D`, use relative epsilons, and a stable root formula. |
| 14 | A circle has radius 0. When does a line intersect it? | Only if the centre `C` lies on the line (`d = 0`); the "circle" is the point `C`. |
| 15 | How do you detect a degenerate line in the parametric form? | `a = D·D == 0` means `A == B`; reject it. |
| 16 | Where does division enter, and what must you guard? | In `t = .../a` and the unit direction; guard `a > eps` and the sqrt radicand `>= 0`. |

---

## Senior Questions

| # | Question | Expected Answer Focus |
|---|----------|-----------------------|
| 1 | You must intersect a ray against 100k circles per ray. How do you avoid `O(n)`? | Broad-phase: BVH or uniform grid + cheap ray-vs-AABB slab test; exact quadratic only on survivors. |
| 2 | What is the broad-phase / narrow-phase split here? | Broad-phase culls candidates (AABB/grid/BVH); narrow-phase is the exact circle–line test. |
| 3 | How do you keep the nearest-hit search fast across many candidates? | Carry a `t_far` that shrinks to the best hit; later candidates self-reject when `t1 >= t_far`. |
| 4 | How does SIMD help, and what data layout enables it? | Structure-of-Arrays (`cx[], cy[], r2[]`) + branchless classification → test 4–8 circles per instruction. |
| 5 | Reduce circle vs moving body to circle–line. | The centre traces a segment; inflate the wall by `r` (Minkowski with a disc) and intersect the swept segment — earliest `t` is time of impact. |
| 6 | What is tunnelling and how do you prevent it? | A fast body skipping a thin wall between frames; fix with continuous collision (swept segment vs inflated wall). |
| 7 | What causes silhouette flicker on round objects, and the fix? | Near-tangent `disc≈0` toggling the 1↔2 count frame to frame; fix with a consistent tangent band + temporal hysteresis. |
| 8 | What is shadow acne / self-intersection and how do you suppress it? | A secondary ray re-hitting its origin surface at `t≈0`; use a `t_min=eps` floor or offset the origin along the normal. |
| 9 | How does scene scale affect numerical accuracy? | Large absolute coordinates inflate `f·f`, `r²`; their subtraction loses bits. Work in the circle's local frame (`C` at origin). |
| 10 | Which metric best signals broad-phase health? | Broad-phase cull ratio (fraction of circles rejected before the exact test); a drop means rebuild/refit the index. |
| 11 | When is the per-circle test (no broad-phase) the right choice? | Small `n` (a few obstacles) where index build/maintenance overhead outweighs the savings. |
| 12 | How do you handle a ray that starts inside a circle? | Detect `t1 < t_min <= t2`; return the exit root `t2`, and flip the normal for transmission. |
| 13 | Grid vs BVH for circle scenes — trade-offs? | Grid: O(1) expected, great for uniform sizes/bounded world; BVH: O(log n), better for varied sizes and static scenes. |
| 14 | What must you do to a BVH when the scene moves? | Refit (cheap) or rebuild (accurate) on dirty frames; stale indices return wrong candidate sets. |

---

## Professional Questions

| # | Question | Expected Answer Focus |
|---|----------|-----------------------|
| 1 | Prove the geometric and algebraic methods give the same points. | Translate `C` to origin, write `O = αD̂ + βn̂`; show `Δ = 4a(r²-d²)`, midpoint root = foot `F`, half-width in `t` × `|D|` = `h`; so roots are `F ± hD̂`. |
| 2 | Why is the *count* harder than the *coordinates*? | Count is `sign(Δ)`; near `Δ=0` the sign is ill-conditioned (difference of near-equal numbers). Coordinates are well-conditioned away from tangency. |
| 3 | Give the cancellation-free quadratic root formula. | `q = -(b' + sign(b')√Δ'); t1 = q/a; t2 = c/q` — one root by addition, the other by Vieta's product `t1·t2 = c/a`. |
| 4 | Why does `c/q` work for the second root? | `t1·t2 = c/a` (product of roots), and `q = a·t1`, so `t2 = (c/a)/t1 = c/q`. No subtraction of near-equal numbers. |
| 5 | What is the condition number of subtracting near-equal numbers, and the implication? | `(|x|+|y|)/|x-y|` → ∞ as `x-y → 0`; tangency decision is intrinsically ill-conditioned, no reformulation removes it. |
| 6 | How do you decide the count *exactly* for integer inputs? | `a=D·D, b'=f·D, c=f·f-r²`, `Δ'=b'²-a·c` — all exact integers; `sign(Δ')` gives the count with no rounding. |
| 7 | What is the overflow risk in the exact count and the fix? | Coordinate products near `10^k` push `Δ'` to `10^(4k)`; use `__int128` / `BigInteger` / Python big ints. |
| 8 | Describe adaptive-precision evaluation of the discriminant. | Compute `Δ'` in double with a forward error bound; if `|Δ̂'|` exceeds the bound, the sign is certified; escalate to exact only on near-tangent inputs. |
| 9 | Forward error bound on `Δ' = b'² - a·c`? | `|Δ̂' - Δ'| ≲ u·(|b'|² + |a·c|)`; relative error blows up as `Δ' → 0`. |
| 10 | Most effective single fix to shrink that error floor? | Translate to a local frame (small `|O-C|`) and normalise `D` (a=1) to minimise `|b'|² + |a c|`. |
| 11 | How does `Δ` change as `r` grows or the line moves away? | `∂Δ/∂(r²) = 4a > 0` (miss→tangent→secant as `r↑`); `∂Δ/∂(d²) = -4a < 0` (secant→tangent→miss as `d↑`); tangent at `r = d`. |
| 12 | List the degenerate cases that need explicit handling. | Zero direction (`A=B`), zero radius, diameter (`d=0`), tangent (`Δ=0`), origin on circle (`c=0`), segment fully inside. |
| 13 | Why report only the count exactly but coordinates in double? | Points are irrational (`a + b√Δ'`); exact coordinates need algebraic numbers, but the count was the only ill-conditioned step. |
| 14 | How does this exact-predicate philosophy mirror `02-line-intersection`? | Both reduce the discrete decision to an integer sign test (orientation / discriminant) computed exactly, with approximate coordinates afterward. |

---

## Rapid-Fire Conceptual Checks

| # | Prompt | One-line answer |
|---|--------|-----------------|
| 1 | The count is the sign of … | `r² - d²` (equivalently the discriminant `Δ`). |
| 2 | Foot of perpendicular is also … | the midpoint of the chord and the closest line point to `C`. |
| 3 | Tangent point equals … | the foot `F`, i.e. the midpoint root `-b/(2a)`. |
| 4 | Clamp range for a segment / ray. | `[0,1]` / `[0, ∞)`. |
| 5 | Skip a sqrt by comparing … | `d²` against `r²`. |
| 6 | The single most numerically delicate quantity. | the sign of `Δ` near tangency. |
| 7 | Best frame to compute in. | the circle's local frame (`C` at origin), with `D` normalised. |
| 8 | Generalises to 3-D spheres? | the quadratic method does, unchanged. |

---

## Extended Junior Questions

| # | Question | Expected Answer Focus |
|---|----------|-----------------------|
| 15 | What does the dot product compute in this method? | The projection of one vector onto another — used to find how far along the line the foot lies. |
| 16 | Why is the foot of perpendicular also the chord's midpoint? | By symmetry: both intersection points are equidistant (`h`) from `F` along the line. |
| 17 | If the radius is 0, when is there an intersection? | Only when the centre lies exactly on the line; the "circle" is the single point `C`. |
| 18 | What is the difference between a secant and a tangent line? | Secant cuts at 2 points (`d < r`); tangent touches at 1 (`d = r`). |
| 19 | How would you find just the chord length, not the points? | Chord length is `2h = 2·sqrt(r² - d²)`. |

## Extended Middle Questions

| # | Question | Expected Answer Focus |
|---|----------|-----------------------|
| 17 | Why "halve `b`" in the quadratic (`b' = f·D`)? | Fewer multiplies, identical result; `Δ' = b'² - a·c`, `t = (-b' ± √Δ')/a`. |
| 18 | When clamping to a segment, why use `>= -EPS` and `<= 1+EPS`? | To count boundary hits at the endpoints despite floating-point noise. |
| 19 | How do you order the two returned points deterministically? | Sort by parameter `t` (or project onto the direction) so output is stable. |
| 20 | What does it mean if both roots are complex (negative `Δ`)? | The line misses the circle entirely; return no points. |
| 21 | Give the surface normal and why a collision system needs it. | `(P - C)/r`; it is the bounce/reflect direction for response. |

## Extended Senior Questions

| # | Question | Expected Answer Focus |
|---|----------|-----------------------|
| 15 | Why is Structure-of-Arrays better than Array-of-Structs here? | One SIMD load fetches several centres; enables 4–8 circles per instruction. |
| 16 | What does precomputing `r²` save? | One multiply per test; keeps hot arrays smaller (bandwidth). |
| 17 | How do adjacent sensor beams help performance? | Beam coherence — reuse the previous beam's candidate set as a warm start. |
| 18 | Why carry a shrinking `t_far` in nearest-hit search? | Later candidates self-reject once their nearest root exceeds the best so far. |
| 19 | What metric most directly signals a failing broad-phase? | Broad-phase cull ratio dropping (too many exact tests per ray). |

## Cross-Topic Connection Questions

These probe whether you see circle–line intersection as part of a bigger geometry toolkit, not an isolated trick.

| # | Question | Expected Answer Focus |
|---|----------|-----------------------|
| 1 | How does the perpendicular distance connect to the cross product from segment intersection? | `d = |cross(A,B,C)| / |AB|`; the same cross product gives side (sign) and distance (magnitude/base). |
| 2 | How does circle–circle intersection relate to circle–line? | Subtract the two circle equations → the **radical line**; then intersect that line with one circle (`14-circle-circle-intersection`). |
| 3 | How do circle tangents from an external point relate? | The tangent lines touch at `d = r`; finding them uses the same distance/discriminant condition (`15-circle-tangents`). |
| 4 | What 3-D analogue uses the identical algebra? | Ray–sphere intersection — same quadratic, `dot` over three components. |
| 5 | How would you find where a circle crosses a polygon boundary? | Run circle–segment against each polygon edge; collect and order the hits. |
| 6 | What broader primitive set does this share with convex hull / point-in-polygon? | The orientation / cross-product primitive and vector projection. |
| 7 | How does Minkowski sum turn "circle vs wall" into "point vs inflated wall"? | Inflate the wall by `r` (sum with a disc); the circle's centre then tests as a point (`10-minkowski-sum`). |

---

## Whiteboard Complexity Table to Recite

| Query | Complexity | One-line reason |
|-------|-----------|-----------------|
| Count points (line vs circle) | O(1) | compare `d²` and `r²` |
| Find the points | O(1) | foot + half-chord, one sqrt |
| Circle vs segment / ray | O(1) | quadratic + clamp `t` |
| Ray vs `n` circles (naive) | O(n) | test each |
| Ray vs `n` circles (BVH) | ~O(log n) | tree-traversed candidates |
| All hits of a ray (CSG) | O(n log n) | per-circle roots, then sort |
| Exact integer count | O(1) | integer `sign(Δ')`, big-int if large |

Reciting this fluidly signals you have internalised both the per-test and the system-level complexity.

---

## Worked Long-Form Answers

Interviewers often pick one question and ask you to "go deep." Here are model answers for the four most common deep-dives — spoken at length, the way you would at a whiteboard.

### Deep-dive A: "Walk me through finding the two intersection points from scratch."

> "I'll use the geometric method because it needs no equation solving. I have a circle with centre `C` and radius `r`, and a line through `A` and `B`.
>
> First I form the direction vector `dir = B - A`. The key trick is **projection**: I want the point on the line nearest to `C`, called the foot of perpendicular `F`. I compute the parameter `t = ((C - A) · dir) / (dir · dir)` — that's the dot product of `C - A` onto `dir`, normalised by `dir`'s squared length — and then `F = A + t·dir`.
>
> Now `d = |C - F|` is the shortest distance from the centre to the line. I compare `d` with `r`. If `d > r` the line misses, zero points. If `d` equals `r` within an epsilon, it's tangent, one point, and that point *is* `F`. If `d < r`, it's a secant with two points.
>
> For the two points I use Pythagoras: the radius `r` is the hypotenuse of a right triangle with one leg `d` (centre to foot) and the other leg `h` (foot to crossing point along the line). So `h = sqrt(r² - d²)`. I take the unit direction `û = dir / |dir|` and step `h` in both directions: `P1 = F + h·û`, `P2 = F - h·û`. Done — no slopes, no vertical-line special case, one square root.
>
> The only guard I add is `sqrt(max(0, r² - d²))` so floating-point noise on a near-tangent doesn't hand me a negative radicand."

### Deep-dive B: "Derive the quadratic and explain the discriminant."

> "I parametrise the line as `P(t) = O + t·D`, with `O` a point on the line and `D` its direction. The circle is `|P - C|² = r²`. Substituting and letting `f = O - C`, I expand `|t·D + f|² = r²` into `(D·D)t² + 2(f·D)t + (f·f - r²) = 0`. That's a quadratic `a·t² + b·t + c = 0` with `a = D·D`, `b = 2(f·D)`, `c = f·f - r²`.
>
> The discriminant `Δ = b² - 4ac` decides everything by its sign: negative means no real roots, so zero points; zero means a double root, the tangent; positive means two roots, a secant. And there's a beautiful identity — `Δ = 4a²(r² - d²)` — so the discriminant test and the distance test are literally the same fact scaled by a positive constant.
>
> The reason graphics code prefers this form is that solving for `t` gives me the parameter directly, which I need for clamping to a ray (`t >= 0`) or a segment (`t ∈ [0,1]`), and it generalises to 3-D spheres with zero changes to the algebra."

### Deep-dive C: "Your ray-tracer flickers on the edges of spheres. Diagnose it."

> "Flicker on silhouettes is the classic near-tangent symptom. On the outline of a sphere, the ray grazes it, so `d ≈ r` and the discriminant is near zero. From frame to frame, tiny floating-point differences flip the count between one and two — or between hit and miss — and the pixel toggles.
>
> Three fixes. First, I work in a **local frame**: translate so the sphere centre is at the origin before the math, and normalise the ray direction so `a = 1`. That minimises the magnitudes I subtract in `r² - d²`, shrinking the cancellation error. Second, I use a **relative tolerance** tied to `r`, not an absolute epsilon, when deciding the tangent boundary. Third, if it still shimmers, I add a small **temporal hysteresis** band so the count doesn't oscillate on the knife-edge. The root cause is that the *count* is a sign test on a near-zero quantity, which is intrinsically ill-conditioned — I can't make it exact in floating point, only stable."

### Deep-dive D: "A fast ball tunnels through a thin wall. Fix it."

> "Static tests sample only the ball's position each frame. If the ball moves more than its diameter between frames, it can be on one side at frame N and the far side at frame N+1, never overlapping the wall in any sampled frame — that's tunnelling.
>
> The fix is **continuous collision**. Instead of testing a point against the wall, I treat the ball's *centre* as moving along a segment from its old position `C0` to its new position `C1`. I inflate the wall by the ball's radius `r` — that's a Minkowski sum of the wall with a disc — and intersect the centre's swept segment against the inflated wall. The earliest parameter `t ∈ [0,1]` where they meet is the **time of impact**; I advance the ball only to that point and resolve the collision there. For the rounded ends of the inflated wall I fall back to a circle–segment test against the wall's endpoints. This reduces directly to the circle–line machinery — the difference is only that the centre is a moving segment instead of a static point."

---

## Scenario / Whiteboard Prompts

| # | Scenario | What the interviewer is probing |
|---|----------|-------------------------------|
| 1 | "Design the data layout for testing one ray against a million circles." | SoA arrays, precomputed `r²`, broad-phase index, SIMD readiness. |
| 2 | "You can only afford one square root per test. Where do you spend it?" | Compare `d²` vs `r²` for the count; sqrt only when producing points. |
| 3 | "How would you unit-test this function?" | Secant, tangent, miss, diameter, degenerate `A=B`, zero radius, segment-inside, ray-origin-inside. |
| 4 | "Port your 2-D test to 3-D spheres." | Quadratic method unchanged; `dot` sums three terms; normal is `(P-C)/r`. |
| 5 | "Two circles instead of a circle and line — what changes?" | Different problem (`14-circle-circle-intersection`): radical line, then circle–line. |
| 6 | "Your epsilon passes tests but fails in production. Why?" | Absolute epsilon is scale-dependent; use relative, normalise direction, local frame. |
| 7 | "Report all enter/exit points of a ray through overlapping circles." | Per-circle two roots, merge-sort by `t`, tag by sign of `D·normal` (CSG). |

---

## Mock Interview Dialogue

A realistic back-and-forth, so you can rehearse the *flow*, not just isolated facts.

> **Interviewer:** Given a circle and a line, how many ways can they intersect?
>
> **You:** Zero, one, or two points. Two when the line cuts through, one when it's tangent — just grazing — and zero when it passes outside.
>
> **Interviewer:** How would you decide which case without computing the points?
>
> **You:** Compute the perpendicular distance `d` from the centre to the line and compare it with the radius `r`. If `d > r` it misses, `d == r` is tangent, `d < r` is two points. I'd actually compare `d²` with `r²` to skip a square root.
>
> **Interviewer:** Good. Now find the actual points.
>
> **You:** I project the centre onto the line to get the foot of perpendicular `F` — that's the closest point on the line to the centre, and also the midpoint of the chord. Then the half-chord length is `h = sqrt(r² - d²)` by Pythagoras, and the two points are `F ± h·û` where `û` is the line's unit direction.
>
> **Interviewer:** What if it's a segment, not an infinite line?
>
> **You:** Each point corresponds to a parameter `t` along the line. For a segment I keep only points with `t ∈ [0,1]`; for a ray, `t >= 0`. So a line crossing twice might give zero, one, or two points once clamped.
>
> **Interviewer:** Your ray-tracer renders fine but flickers on sphere edges. Why?
>
> **You:** Those are grazing rays — near tangent, so the discriminant is near zero and the count flips frame to frame from floating-point noise. I'd work in the sphere's local frame, normalise the direction, use a relative epsilon tied to `r`, and add a small hysteresis band so the count doesn't oscillate. The count is a sign test on a near-zero number, which is intrinsically ill-conditioned.
>
> **Interviewer:** Can you make the *count* exact?
>
> **You:** Yes, for integer inputs. `a = D·D`, `b' = f·D`, `c = f·f - r²`, and `Δ' = b'² - a·c` are all exact integers, so `sign(Δ')` gives the count with no rounding. I'd use a wide integer type to avoid overflow. The point coordinates are irrational, but the count — the hard part — is exact.
>
> **Interviewer:** Last one: a fast ball passes through a thin wall. Fix it.
>
> **You:** Tunnelling. Static tests sample positions; a fast ball jumps the wall between frames. I'd do continuous collision: treat the ball's centre as a moving segment, inflate the wall by the radius, and find the earliest time of impact `t ∈ [0,1]`. That reduces right back to the circle–line machinery.

Rehearsing this dialogue trains you to *lead* — volunteering the `d²` optimisation, the clamp, the robustness story, and the exact-count option before being asked.

---

## Common Pitfalls Interviewers Watch For

1. **Dividing by the slope** (`y = mx + b`) and forgetting vertical lines exist.
2. **`sqrt` without a sign check** — crashes or `NaN` on a miss.
3. **`==` for tangency** on floats — the case is then never detected.
4. **Returning infinite-line points for a segment query** — forgetting to clamp `t`.
5. **Two coincident points at tangency** instead of collapsing to one.
6. **Negative entry root on a ray** — mishandling the origin-inside case.
7. **`O(n)` over all circles** with no broad-phase when `n` is large.
8. **Absolute magic epsilons** that silently break under a unit change.

Say these *before* the interviewer points them out — it signals production experience.

---

## Coding Challenge (3 Languages)

### Challenge: Circle–Segment Intersection

> **Problem.** Given a circle (centre `(cx, cy)`, radius `r`) and a line **segment** from `A = (ax, ay)` to `B = (bx, by)`, return the intersection points that lie **on the segment** (parameter `t ∈ [0, 1]`), sorted by `t`. Return 0, 1, or 2 points. Use the quadratic method, clamp to the segment, collapse the tangent case to a single point, and guard all sqrt/division.
>
> **Examples.**
> - Circle `(0,0), r=5`, segment `(-6,3)→(6,3)` → two points `(-4,3)` and `(4,3)`.
> - Circle `(0,0), r=5`, segment `(0,0)→(3,0)` → zero points (segment ends inside the circle).
> - Circle `(0,0), r=5`, segment `(0,0)→(10,0)` → one point `(5,0)`.
> - Circle `(0,0), r=5`, segment `(-6,5)→(6,5)` → one point `(0,5)` (tangent).

#### Go

```go
package main

import (
	"fmt"
	"math"
	"sort"
)

const EPS = 1e-9

type Pt struct{ X, Y float64 }

// circleSegment returns the intersection points of segment A-B with circle (C,r)
// that lie on the segment, sorted by parameter t along A→B.
func circleSegment(cx, cy, r float64, A, B Pt) []Pt {
	dx, dy := B.X-A.X, B.Y-A.Y
	fx, fy := A.X-cx, A.Y-cy
	a := dx*dx + dy*dy
	if a < EPS { // A == B: degenerate "segment"
		// it's a point; intersects iff that point is on the circle
		if math.Abs(fx*fx+fy*fy-r*r) < EPS {
			return []Pt{A}
		}
		return nil
	}
	bHalf := fx*dx + fy*dy
	c := fx*fx + fy*fy - r*r
	disc := bHalf*bHalf - a*c
	if disc < -EPS {
		return nil // miss
	}
	if disc < 0 {
		disc = 0 // round-off → tangent
	}
	sq := math.Sqrt(disc)

	var ts []float64
	if sq < EPS {
		ts = []float64{-bHalf / a} // tangent: single root
	} else {
		ts = []float64{(-bHalf - sq) / a, (-bHalf + sq) / a}
	}

	var out []Pt
	for _, t := range ts {
		if t >= -EPS && t <= 1+EPS {
			out = append(out, Pt{A.X + t*dx, A.Y + t*dy})
		}
	}
	// already in t-order for the two-root case; sort defensively
	sort.Slice(out, func(i, j int) bool {
		ti := (out[i].X-A.X)*dx + (out[i].Y-A.Y)*dy
		tj := (out[j].X-A.X)*dx + (out[j].Y-A.Y)*dy
		return ti < tj
	})
	return out
}

func main() {
	fmt.Println(circleSegment(0, 0, 5, Pt{-6, 3}, Pt{6, 3}))   // 2 points
	fmt.Println(circleSegment(0, 0, 5, Pt{0, 0}, Pt{3, 0}))    // 0 points
	fmt.Println(circleSegment(0, 0, 5, Pt{0, 0}, Pt{10, 0}))   // 1 point (5,0)
	fmt.Println(circleSegment(0, 0, 5, Pt{-6, 5}, Pt{6, 5}))   // tangent (0,5)
}
```

#### Java

```java
import java.util.*;

public class CircleSegment {
    static final double EPS = 1e-9;
    record Pt(double x, double y) {}

    static List<Pt> circleSegment(double cx, double cy, double r, Pt A, Pt B) {
        double dx = B.x() - A.x(), dy = B.y() - A.y();
        double fx = A.x() - cx, fy = A.y() - cy;
        double a = dx * dx + dy * dy;
        List<Pt> out = new ArrayList<>();
        if (a < EPS) { // degenerate segment = point
            if (Math.abs(fx * fx + fy * fy - r * r) < EPS) out.add(A);
            return out;
        }
        double bHalf = fx * dx + fy * dy;
        double c = fx * fx + fy * fy - r * r;
        double disc = bHalf * bHalf - a * c;
        if (disc < -EPS) return out;     // miss
        if (disc < 0) disc = 0;          // round-off → tangent
        double sq = Math.sqrt(disc);

        double[] ts = (sq < EPS)
            ? new double[]{-bHalf / a}
            : new double[]{(-bHalf - sq) / a, (-bHalf + sq) / a};

        for (double t : ts)
            if (t >= -EPS && t <= 1 + EPS)
                out.add(new Pt(A.x() + t * dx, A.y() + t * dy));

        out.sort(Comparator.comparingDouble(
            p -> (p.x() - A.x()) * dx + (p.y() - A.y()) * dy));
        return out;
    }

    public static void main(String[] args) {
        System.out.println(circleSegment(0, 0, 5, new Pt(-6, 3), new Pt(6, 3)));
        System.out.println(circleSegment(0, 0, 5, new Pt(0, 0), new Pt(3, 0)));
        System.out.println(circleSegment(0, 0, 5, new Pt(0, 0), new Pt(10, 0)));
        System.out.println(circleSegment(0, 0, 5, new Pt(-6, 5), new Pt(6, 5)));
    }
}
```

#### Python

```python
import math

EPS = 1e-9


def circle_segment(cx, cy, r, A, B):
    """Intersection points of segment A-B with circle (cx,cy,r), on the
    segment (t in [0,1]), sorted by t."""
    ax, ay = A
    bx, by = B
    dx, dy = bx - ax, by - ay
    fx, fy = ax - cx, ay - cy
    a = dx * dx + dy * dy
    if a < EPS:                          # degenerate segment = point
        if abs(fx * fx + fy * fy - r * r) < EPS:
            return [A]
        return []
    b_half = fx * dx + fy * dy
    c = fx * fx + fy * fy - r * r
    disc = b_half * b_half - a * c
    if disc < -EPS:
        return []                        # miss
    if disc < 0:
        disc = 0.0                       # round-off → tangent
    sq = math.sqrt(disc)

    ts = [-b_half / a] if sq < EPS else [(-b_half - sq) / a, (-b_half + sq) / a]

    out = []
    for t in ts:
        if -EPS <= t <= 1 + EPS:
            out.append((ax + t * dx, ay + t * dy))

    out.sort(key=lambda p: (p[0] - ax) * dx + (p[1] - ay) * dy)
    return out


if __name__ == "__main__":
    print(circle_segment(0, 0, 5, (-6, 3), (6, 3)))  # 2 points
    print(circle_segment(0, 0, 5, (0, 0), (3, 0)))   # 0 points
    print(circle_segment(0, 0, 5, (0, 0), (10, 0)))  # 1 point (5,0)
    print(circle_segment(0, 0, 5, (-6, 5), (6, 5)))  # tangent (0,5)
```

**Evaluation criteria:**

- Correct count for secant / tangent / miss, and correct clamping to `[0,1]`.
- Tangent collapses to a **single** point (not two coincident ones).
- All sqrt radicands and divisions are guarded (no `NaN`, no divide-by-zero).
- Degenerate segment (`A == B`) handled.
- Points returned sorted by `t` for determinism.

**Follow-up questions an interviewer may ask:**

1. Change it to a **ray** (`t >= 0`) and return only the **nearest** hit. (Handle the origin-inside case → exit root.)
2. Make the **count** exact for integer inputs. (Integer `Δ' = b'² - a·c`; sign test; wide integer type.)
3. Replace the naive roots with the **cancellation-free** form (`q = -(b' + sign(b')√Δ'); t1 = q/a; t2 = c/q`) and explain why.
4. Extend to a **3-D sphere** — what changes? (Nothing in the algebra; `Pt` gains a `z` and `dot` sums three terms.)

---

## Self-Assessment Checklist

Before you walk into an interview on this topic, confirm you can do each of these *without notes*:

| Skill | Can you do it cold? |
|-------|---------------------|
| State the 0/1/2 rule in terms of `d` and `r` | ☐ |
| Compute the perpendicular distance from a point to a line two ways (cross / normal form) | ☐ |
| Derive the foot of perpendicular via projection | ☐ |
| Derive `h = sqrt(r² - d²)` from Pythagoras | ☐ |
| Set up the quadratic `a, b, c` and read the discriminant | ☐ |
| Explain `Δ = 4a²(r² - d²)` (the equivalence) | ☐ |
| Clamp to a segment and to a ray correctly | ☐ |
| Handle the ray-origin-inside case (exit root) | ☐ |
| Explain why near-tangent is ill-conditioned | ☐ |
| Give the cancellation-free root formula and why it works | ☐ |
| Make the count exact for integer inputs | ☐ |
| Reduce circle-vs-moving-body to circle–line (time of impact) | ☐ |
| Describe a broad-phase to scale to many circles | ☐ |
| Generalise the algebra to a 3-D sphere | ☐ |

If any box is unchecked, re-read the corresponding level file (`junior` → `professional`) before the interview. The single most common failure is fumbling the **clamp** (segment/ray) and the **near-tangent robustness** story — drill those two hardest.

---

## One-Page Summary to Memorise

```
COUNT:   sign of (r² − d²)   ≡   sign of discriminant Δ
         d>r → 0,  d=r → 1,  d<r → 2

GEOMETRIC (points):
  dir = B − A
  t   = (C−A)·dir / dir·dir
  F   = A + t·dir            # foot = chord midpoint
  d   = |C − F|
  h   = sqrt(max(0, r² − d²))
  P   = F ± h·(dir/|dir|)

ALGEBRAIC (quadratic, gives t):
  f = O − C
  a = D·D,  b = 2(f·D),  c = f·f − r²
  Δ = b² − 4ac
  t = (−b ± sqrt(Δ)) / (2a)
  STABLE: q = −(b + sign(b)√Δ)/2;  t1 = q/a;  t2 = c/q

CLAMP:   line: any t;  ray: t≥0;  segment: 0≤t≤1
NORMAL:  (P − C)/r
ROBUST:  local frame, normalise D, relative eps, integer count for exactness
```

Carry this in your head; everything else is derivable from it.

---

**Next step:** [tasks.md](./tasks.md) — graded practice tasks (beginner / intermediate / advanced) plus a cross-language benchmark.
