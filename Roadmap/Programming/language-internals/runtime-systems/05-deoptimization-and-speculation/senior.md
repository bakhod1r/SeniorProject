# Deoptimization & Speculation — Senior Level

> **Topic:** [Deoptimization & Speculation](README.md)
> **Focus:** The hard cases — materializing scalar-replaced objects that escape analysis deleted, on-stack invalidation across threads, safepoints and deopt, and the full taxonomy of speculative optimizations that depend on a flawless rewind.

---

## Table of Contents

1. [Introduction](#introduction)
2. [Prerequisites](#prerequisites)
3. [Glossary](#glossary)
4. [Core Concepts](#core-concepts)
5. [Real-World Analogies](#real-world-analogies)
6. [Mental Models](#mental-models)
7. [Code Examples](#code-examples)
8. [Pros & Cons](#pros--cons)
9. [Use Cases](#use-cases)
10. [Coding Patterns](#coding-patterns)
11. [Best Practices](#best-practices)
12. [Edge Cases & Pitfalls](#edge-cases--pitfalls)
13. [Cheat Sheet](#cheat-sheet)
14. [Summary](#summary)

---

## Introduction

> Focus: **When the optimizer has *deleted* an object, pruned a branch, or assumed no overflow, what does it take to rewind to a correct interpreter state — and how is that done safely while many threads run?**

By the middle level you can describe the reconstruction map and the eager/lazy split. The senior level is about the cases where reconstruction is genuinely *creative*, not just a copy. The headline is **scalar replacement after escape analysis**. When the compiler proves an object never escapes a method, it can **delete the allocation entirely** and keep the object's fields in registers — no heap object exists at all. This is one of the most valuable optimizations on the JVM and in V8. But now consider a deopt point *after* that object was eliminated, where the interpreter state demands that the object **exist** (the bytecode references it, or it must be passed somewhere). The deoptimizer must **materialize** — *reify* — that object on the spot: allocate it, copy the scalar field values back in, and hand the interpreter a real reference, all mid-flight. The object that "never existed" suddenly does.

The second senior theme is **safety in a concurrent runtime**. Deopt doesn't happen in a vacuum: the GC may want to move objects, other threads run their own optimized code, and lazy invalidation must rewrite frames that may be deep in the stack. This is mediated by **safepoints** — points where threads can be brought to a known, describable state. Deopt points are (or coincide with) places where the runtime can describe every live value and reference, which is exactly what both the GC and the deoptimizer need.

The third theme is the **full taxonomy of speculations** and what each costs to rewind: monomorphic/polymorphic inline caches, type/range/null speculation, assuming *no integer overflow*, assuming an array stays *packed* (SMI/elements-kind in V8), loop-invariant hoisting guarded by deopt, and uncommon-trap-driven branch elimination. Every one is a bet whose unwind cost and metadata burden you should be able to reason about.

> 🎓 **Why this matters for a senior:** You're the person who explains why a "free" optimization (escape analysis removing an allocation) interacts with a deopt to suddenly allocate; why a tight loop with rare polymorphism tanks; why a `made not entrant` cascade follows a class load; and how to structure code so the most valuable speculations (inlining, scalar replacement, packed arrays) *stick*. This is the level where you reason about the optimizer as an adversary you can cooperate with.

This page covers: scalar replacement and reification, safepoints and deopt safety, on-stack invalidation across threads, the overflow/range/packed-array speculations, polymorphic inline caches and the mono→poly→mega transition, and how to keep the expensive-to-rewind bets stable.

---

## Prerequisites

- **Required:** `middle.md` — deopt points, scope descriptors/translations, frame reconstruction, eager vs lazy, CHA invalidation.
- **Required:** Solid grasp of **escape analysis** and **inlining** as compiler optimizations.
- **Required:** Working knowledge of **GC safepoints** and why a runtime needs all threads at known states to move objects.
- **Helpful but not required:** SSA / sea-of-nodes IR vocabulary; inline cache (mono/poly/mega) mechanics.
- **Helpful but not required:** V8 *elements kinds* and HotSpot *uncommon trap* internals.

You do **not** need:

- Production-scale fleet diagnosis and cross-engine tuning playbooks (that's `professional.md`).
- Register allocator implementation detail.

---

## Glossary

| Term | Definition |
|------|-----------|
| **Escape analysis** | Compiler analysis proving an object's lifetime is confined to a method (or thread), so it need not be heap-allocated. |
| **Scalar replacement** | Replacing an eliminated object with its individual fields held in registers/stack slots — no object exists. |
| **Materialization / reification** | Re-creating a scalar-replaced object at deopt time: allocate it and copy the scalar fields back in. |
| **Safepoint** | A point where a thread can be paused in a state the runtime fully understands (all live refs known) — used by GC and deopt. |
| **Inline cache (IC)** | A call-site cache recording the receiver type(s) seen and the resolved target(s). Monomorphic / polymorphic / megamorphic. |
| **Megamorphic** | A call site that has seen so many types the engine stops specializing and uses a generic dispatch. |
| **Elements kind** | (V8) The internal representation of an array's contents (PACKED_SMI, PACKED_DOUBLE, PACKED_ELEMENTS, HOLEY_*). Transitions can deopt. |
| **Packed / holey** | An array with all slots present (packed) vs containing holes (holey) — packed enables much faster, deopt-protected code. |
| **Overflow speculation** | Compiling integer arithmetic assuming it won't overflow (e.g. stays in int32/SMI), guarded so overflow triggers deopt to a wider representation. |
| **Range / bounds speculation** | Assuming an index is in bounds or a value is in a range, eliminating a check and guarding it instead. |
| **Null/undefined speculation** | Assuming a reference is non-null based on profiling; a null triggers deopt rather than a per-access null check. |
| **Loop-invariant code motion (LICM)** | Hoisting a computation out of a loop; when guarded by speculation, a failed guard deopts to the un-hoisted form. |
| **Uncommon trap** | (HotSpot) The compiled instruction that, when reached, triggers deopt — used for pruned branches, failed type checks, etc. |
| **OSR (On-Stack Replacement)** | Replacing a running interpreter loop frame with optimized code mid-loop; the constructive inverse of deopt. |
| **Reoptimization** | Recompiling after a deopt, folding the newly observed behavior (new type/branch) into the next compilation. |

---

## Core Concepts

### 1. Escape analysis deletes objects — deopt must un-delete them

Consider, on the JVM:

```java
int dist2(Point a, Point b) {
    Vector v = new Vector(a.x - b.x, a.y - b.y);  // never escapes dist2
    return v.dx * v.dx + v.dy * v.dy;
}
```

Escape analysis proves `v` never leaves `dist2`. Scalar replacement **removes the allocation**: `v.dx` and `v.dy` become two register values, no `Vector` object is created, GC pressure drops, and the method is pure arithmetic. Excellent.

Now suppose `dist2` was inlined into a caller, and somewhere in that optimized region there's a **deopt point** whose reconstructed interpreter state references `v` as a live object (because in the un-optimized bytecode, `v` *is* a real object on the stack). When that deopt fires, the interpreter cannot be handed "two loose registers" — it needs an actual `Vector` reference. So the deoptimizer **materializes** `v`: it allocates a fresh `Vector` on the heap and writes the current register values into `dx` and `dy`, producing a reference that's indistinguishable from one the program would have created normally.

The deopt metadata therefore records not just "where values live" but also **"this scope held a scalar-replaced object of class `Vector` with fields {dx ← R8, dy ← R9} — reify it if you deopt here."** Reification is the most subtle reconstruction case: an object that *never existed at runtime* is conjured into existence precisely so the interpreter's worldview stays consistent. Semantics preserved, as always — the program behaves exactly as if the object had been there the whole time.

### 2. Safepoints make deopt (and GC) safe

The runtime cannot rewrite a thread's frames, move its objects, or reconstruct its state at an *arbitrary* machine instruction — it might be halfway through a multi-instruction sequence with values in transient registers and no recorded mapping. It can only do these things at **safepoints**: locations where the compiler guarantees a complete, accurate description of all live values and references exists.

Deopt points are placed at (or are kinds of) safepoints. This is why:

- **Eager deopt** can reconstruct: the guard sits at a point with full metadata.
- **Lazy deopt** works: when a *not entrant* frame returns (a safepoint), the runtime can correctly intervene.
- **GC and deopt share infrastructure:** both need "where is every live reference right now," recorded as OopMaps at safepoints. (This is also why escape-analysis materialization must know the class and fields — it's recorded alongside the safepoint metadata.)

A consequence: aggressive optimization is *bounded* by the requirement to keep a describable state at every safepoint. The compiler can't optimize so hard that it loses the ability to answer "where is everything" at a deopt/GC point.

### 3. On-stack invalidation across threads

When the runtime invalidates compiled code (CHA broken, a deopt-all on debugger attach, a profiling decision), that code may be executing on **many threads simultaneously**, at different depths. The protocol:

1. Mark the compiled method **not entrant** — atomically, so no new activation starts using it.
2. Patch the method's entry / return handling so any **currently active** frame will deopt **when it next reaches a safepoint** (typically on return, or at a loop back-edge safepoint).
3. Optionally request a **safepoint** (stop-the-world-ish) to expedite patching active frames' return addresses to the deopt handler.
4. Each thread, on hitting its safepoint, reconstructs its frame(s) and continues in the interpreter; the next call recompiles.

The key insight: you never reach into a *running* native frame on another thread from outside and mutate it mid-instruction. You **schedule** the deopt to occur when that thread is itself at a safe, describable point. This is why invalidation has latency and why long-running optimized loops (with back-edge safepoints) are important for responsiveness.

### 4. The overflow / range / packed-array speculations

These are the high-value, easy-to-break bets in dynamic numeric code:

- **No-overflow (SMI/int32) speculation.** V8 represents small integers as **SMIs** and HotSpot keeps ints in 32 bits. Arithmetic is compiled assuming the result stays in range. A guard checks for overflow; overflow deopts to a wider representation (double / boxed). A counter that finally exceeds the SMI range, or a multiply that overflows int32, deopts.
- **Packed-array / elements-kind speculation.** V8 tags each array with an **elements kind**. `[1,2,3]` is `PACKED_SMI_ELEMENTS` — extremely fast. Pushing a `3.14` transitions it to `PACKED_DOUBLE_ELEMENTS`; pushing an object transitions to `PACKED_ELEMENTS`; creating a hole transitions to a `HOLEY_*` kind. **These transitions are one-way and they deopt code specialized for the old kind.** Code that assumed `PACKED_SMI` must bail when the array becomes doubles or holey.
- **Bounds / range speculation.** A loop indexing an array can have its per-iteration bounds check hoisted or eliminated under a speculation that the index stays in range; an out-of-range access deopts to the checked form.
- **Null/undefined speculation.** If a field has only ever been non-null, the compiler may elide null checks and speculate non-null; a null deopts.

Each is a bet that the *value domain* stays narrow. Widening the domain (one overflow, one float in an int array, one hole, one null) pays a deopt and forces a more general recompile.

### 5. Inline caches and the mono → poly → mega slide

A call site (or property access) carries an **inline cache** recording observed receiver types/shapes:

```text
MONOMORPHIC:  one shape seen        -> fastest; inlinable; tight guard.
POLYMORPHIC:  2..N shapes seen      -> a small switch of guarded cases; still ok.
MEGAMORPHIC:  too many shapes       -> engine gives up specializing; generic
                                       dispatch; inlining lost; speculation
                                       largely abandoned at this site.
```

A site that slides to megamorphic loses inlining and most speculation — a frequent root cause of "this got slow and I don't know why." The transition is driven by *how many distinct shapes* flow through the site. Senior-level performance work is often about *keeping critical sites monomorphic or low-polymorphic* — by separating types, stabilizing shapes, or splitting a generic site into several specialized ones.

### 6. Loop-invariant hoisting and other "moved" computations

LICM hoists a computation out of a loop. If the hoist is only valid under a speculation (e.g. the hoisted load assumes the underlying object/field doesn't change shape), the loop carries a guard; a violation deopts back to the un-hoisted loop. The same pattern covers strength reduction, common-subexpression elimination across speculated invariants, and constant-folding of speculated constants. The mental rule: **any optimization that *moved* or *removed* a computation must leave behind a deopt route that restores the original computation if its enabling bet breaks.**

---

## Real-World Analogies

**Flat-pack furniture that was never assembled (reification).** Escape analysis is realizing you never actually need the assembled bookshelf — you only need to know its height and width to fit a gap, so you keep just those two numbers and throw away the box. But if someone suddenly says "hand me the bookshelf" (a deopt that needs the object), you must **assemble it on the spot** from the parts you kept. Materialization is that emergency assembly: the object that was never built gets built exactly when, and only when, reality demands it.

**An evacuation that only happens at marked exits (safepoints).** You can't pull people out of a building mid-stride on a staircase — you guide them to **marked muster points** where a headcount is possible. The runtime can only deopt/GC threads at safepoints, the muster points where everyone's position is known.

**A recall that waits for each car to come in for service (on-stack invalidation).** A defective part is flagged (assumption broken). You don't chase cars on the highway; each gets fixed **the next time it's at the shop** (next safepoint/return). Meanwhile they keep driving — correctly, just on the old part.

**The express lane sign downgrading itself (mono→mega).** The "10 items or fewer" express lane works because almost everyone qualifies. If every kind of customer keeps using it with wildly different cart sizes, the lane loses its speed advantage and effectively becomes a normal lane — the specialization was abandoned because the assumption stopped being useful.

---

## Mental Models

### Model 1: "Removed" is only safe if it can be "restored"

Every aggressive optimization — deleting an allocation, eliding a check, hoisting a load, pruning a branch — is a *removal*. The deopt machinery is the universal **restore** operation. The compiler may remove anything it can describe how to restore. Reification is the most dramatic restore: restoring an entire object from nothing.

### Model 2: Speculation cost = (bet value) × (hit rate) − (deopt cost) × (miss rate)

Senior reasoning about whether a speculation is *worth it* mirrors branch-prediction economics. A high-value bet (inline + scalar-replace a hot allocation) that almost always holds is enormously profitable. The same bet that misses 10% of the time, with an expensive reify-and-reconstruct unwind each miss, can be net-negative. The engine estimates this from profiling; you can shift the equation by raising the hit rate (consistency) or lowering the bet's fragility (stable shapes/types).

### Model 3: Two clocks — value domain and program structure

Eager deopts are driven by the **value-domain clock**: types, ranges, overflow, null, array kind — properties of *data flowing through*. Lazy deopts are driven by the **program-structure clock**: classes loading, dependencies breaking, debuggers attaching — the *shape of the program* changing. Diagnose by asking which clock ticked.

### Model 4: The optimizer keeps a "co-routine to the past"

At every safepoint, optimized code carries enough information to *re-derive the past*: the interpreter state that leads to here. It's as if every fast frame holds a latent, lazily-evaluated interpreter frame, instantiated only on deopt. Reification, frame reconstruction, and bytecode-index resume are that latent past made real.

---

## Code Examples

### Example 1: Provoke and observe scalar-replacement + materialization (HotSpot)

```java
// Escape.java
public class Escape {
    static final class Vec { final int dx, dy; Vec(int a,int b){dx=a;dy=b;} }

    static int dist2(int ax,int ay,int bx,int by){
        Vec v = new Vec(ax-bx, ay-by);   // candidate for scalar replacement
        return v.dx*v.dx + v.dy*v.dy;
    }
    public static void main(String[] a){
        long acc=0;
        for(int i=0;i<2_000_000;i++) acc+=dist2(i,i+1,i-1,i);
        System.out.println(acc);
    }
}
```

Inspect with:

```bash
# Confirm EA eliminated the allocation; watch for deopts if any guard breaks.
java -XX:+UnlockDiagnosticVMOptions -XX:+PrintEscapeAnalysis \
     -XX:+PrintEliminateAllocations -XX:+PrintCompilation Escape
```

`PrintEliminateAllocations` reports the `Vec` allocation removed. If you then introduce a path that makes `v` escape (e.g. store it in a static field under some branch), you'll see the elimination disappear — and any deopt in a version that *had* eliminated it would materialize the `Vec`.

### Example 2: SMI overflow deopt in V8

```js
// overflow.js
function acc(start) {
  let s = start;
  for (let i = 0; i < 50; i++) s = s * 31;   // grows fast; leaves SMI range
  return s;
}
for (let i = 0; i < 100000; i++) acc(1);   // optimized assuming SMI math
console.log(acc(1));                        // result far exceeds SMI -> deopt path
```

```bash
node --trace-deopt overflow.js
```

You'll see deopts with overflow-related reasons as the multiply leaves the small-integer range and V8 must widen to doubles — exactly the no-overflow bet breaking.

### Example 3: Elements-kind transition deopt

```js
// elements.js
function sum(arr) {
  let s = 0;
  for (let i = 0; i < arr.length; i++) s += arr[i];
  return s;
}

const a = [1, 2, 3, 4];        // PACKED_SMI_ELEMENTS -> fastest
for (let i = 0; i < 1_000_000; i++) sum(a);   // optimized for PACKED_SMI

a.push(3.14);                   // transition to PACKED_DOUBLE_ELEMENTS
console.log(sum(a));            // code specialized for SMI must deopt
```

`node --trace-deopt elements.js` shows the deopt when the array's elements kind changes under the optimized `sum`. The fix: keep the array homogeneous, or accept the double representation from the start (`[1.0, 2.0, ...]`).

### Example 4: Watch a call site slide to megamorphic

```js
// mega.js
function field(o) { return o.v; }   // property access -> inline cache here

function shape(extra) {
  const o = { v: 1 };
  // Give each call a structurally different object to blow up the IC.
  for (let k = 0; k < extra; k++) o['k' + k] = k;
  return o;
}

// Feed MANY distinct shapes through the same access site.
for (let n = 0; n < 30; n++) {
  const o = shape(n);
  for (let i = 0; i < 100000; i++) field(o);
}
```

With `--trace-ic` (in a debug build) or by profiling, you can observe `field`'s inline cache moving monomorphic → polymorphic → megamorphic as the shape count climbs, at which point specialization and inlining are abandoned. Keeping `field` fed with one shape keeps it monomorphic and fast.

### Example 5: Disable an optimization to confirm causation

```bash
# Confirm a slowdown is escape-analysis/deopt-related by toggling EA off.
java -XX:-DoEscapeAnalysis YourApp        # does the regression change?

# In V8, narrow down by allow-listing / observing a single function:
node --trace-deopt --trace-opt --print-opt-source app.js
```

Toggling an optimization is a legitimate *diagnostic* (not a fix): if behavior changes, you've localized the speculation involved.

---

## Pros & Cons

### Pros

- **Allocation elimination is huge.** Scalar replacement removes GC pressure and turns object-heavy code into pure register arithmetic — often the single biggest win in hot numeric/data code.
- **Aggressive numeric specialization.** SMI/int32 math, packed arrays, and bounds-check elimination give dynamic languages near-native loops.
- **Inlining + scalar replacement compound.** Inlining exposes objects to escape analysis that wouldn't have been local otherwise; the two reinforce each other.
- **Correctness is total.** Even reification of a deleted object preserves exact semantics — the program can't tell the object was ever gone.

### Cons

- **Reification is the most expensive unwind.** A deopt that must materialize several scalar-replaced objects allocates and reconstructs at the worst possible moment.
- **The most valuable bets are the most fragile.** Escape analysis, packed arrays, and monomorphic inlining all break easily (one escaping store, one float, one extra shape) and breaking them is costly.
- **Concurrency adds latency.** On-stack invalidation across threads can't be instantaneous; it waits for safepoints.
- **Bounded optimization.** The safepoint/describability requirement caps how far some transforms can go; the compiler always pays a "keep state recoverable" tax.

---

## Use Cases

- **Eliminating GC pressure** in hot paths by writing escape-friendly code (objects that don't leak), then verifying with `PrintEliminateAllocations` / heap profiling.
- **Keeping numeric kernels fast** by staying within SMI/int32 ranges and homogeneous packed arrays.
- **Protecting inlining** at hot polymorphic sites by reducing shape/type diversity.
- **Explaining latency spikes** that coincide with class loading (CHA invalidation), debugger attach (deopt-all), or a tier transition.

---

## Coding Patterns

### Pattern 1: Keep allocations non-escaping so EA can delete them

```java
// ✅ Local, non-escaping temporary -> scalar replaced, no heap object.
double norm(double x, double y) {
    Complex c = new Complex(x, y);   // never stored, returned, or thrown
    return Math.hypot(c.re, c.im);
}
// ❌ Storing it anywhere global, returning it, or passing to a non-inlined
//    method that lets it escape defeats EA and forces a real allocation.
```

### Pattern 2: Choose one numeric domain for a hot loop

```js
// ✅ Stay in SMI range, integers only -> packed-SMI arrays, int32 math.
function histogram(samples) {        // samples: all small integers
  const bins = new Int32Array(256);  // typed array: fixed, packed, no deopt
  for (let i = 0; i < samples.length; i++) bins[samples[i] & 255]++;
  return bins;
}
// Typed arrays sidestep elements-kind transitions entirely.
```

### Pattern 3: Pre-size and densely fill arrays (avoid holey + reallocation)

```js
// ✅ Packed from the start; never holey.
const out = new Array(n);
for (let i = 0; i < n; i++) out[i] = compute(i);
// ❌ out = []; out[5] = x;  // creates holes -> HOLEY kind -> slower, deopt-prone
```

### Pattern 4: Split a megamorphic site into monomorphic ones

```js
// ❌ One generic site sees every shape -> megamorphic.
function render(node) { return node.draw(); }

// ✅ Dispatch by kind first so each call site sees one shape.
function render(node) {
  switch (node.kind) {
    case 'text':  return renderText(node);   // monomorphic site
    case 'image': return renderImage(node);  // monomorphic site
  }
}
```

### Pattern 5 (JVM): make hot virtual methods non-overridable

```java
// ✅ final removes the CHA-invalidation risk: the devirtualization/inlining
//    bet becomes permanent, not provisional.
public final int hash() { /* hot, must stay inlined */ }
```

---

## Best Practices

- **Optimize for *stability*, not just speed.** The valuable bets (EA, packed arrays, monomorphic inlining) pay off only if they *persist*. A fast path that keeps deopting is worse than a steady slower one.
- **Use typed arrays for numeric data in JS.** They have a fixed representation and sidestep elements-kind transitions and SMI/double churn entirely.
- **Keep objects local when you can.** Non-escaping objects get scalar-replaced; that's free allocation elimination.
- **Treat megamorphic sites as alarms.** If a hot dispatch site is megamorphic, restructure to make per-site shapes uniform.
- **Verify, don't assume.** Use `PrintEliminateAllocations`, `--trace-deopt`, `--trace-ic` to confirm a speculation is active and stable before relying on it.
- **Account for warm-up and re-opt.** Steady-state behavior, after tier-up settles, is what matters — benchmark past warm-up.

---

## Edge Cases & Pitfalls

### Pitfall 1: An object "escaping" through an un-inlined call

Escape analysis is often only effective *after inlining* exposes the object's full lifetime. If the method that would let an object escape isn't inlined (too big, megamorphic, behind a virtual call), EA conservatively assumes escape and keeps the allocation. A seemingly local object can still be heap-allocated because some callee wasn't inlined.

### Pitfall 2: Reification storms under bad speculation

If a hot region scalar-replaces objects *and* deopts frequently, each deopt re-materializes those objects — you get allocation churn at exactly the moments you were trying to avoid it. The cure is stabilizing whatever causes the deopts, not disabling EA.

### Pitfall 3: One value silently widening the whole loop

A single iteration producing a float, an overflow, a hole, or a null can deopt a loop that ran fast for a million iterations. These are *value-domain* breaks and they're easy to introduce accidentally (e.g. `arr.push(undefined)` deep in a helper).

### Pitfall 4: Typed-array vs regular-array confusion

`Int32Array` won't deopt on elements kind, but it also silently coerces/wraps values (e.g. assigning `3.7` truncates, out-of-range wraps). Choosing typed arrays for stability changes value semantics — make sure that's acceptable.

### Pitfall 5: Debugger / profiler attach causing mass deopt

Attaching certain debuggers or enabling some instrumentation forces a **deopt-all** (the runtime must present interpreter-level state to the debugger). Performance measured under a debugger is not representative — you're measuring de-optimized code.

### Pitfall 6: Assuming invalidation is instantaneous

After a CHA break or invalidation, optimized frames already on the stack keep running until they hit a safepoint/return. A long-running optimized loop may execute its now-invalid (but correct) code for a while; back-edge safepoints bound how long.

### Pitfall 7: Polymorphism reintroduced by frameworks

Proxies, decorators, ORMs, bytecode generators, and dynamic mixins inject extra shapes/types into call sites you thought were monomorphic, quietly pushing them toward megamorphic. The source looks clean; the runtime sees diversity.

---

## Cheat Sheet

```text
SCALAR REPLACEMENT  EA proves object never escapes -> delete allocation, keep
                    fields in registers. DEOPT must MATERIALIZE (reify) it:
                    allocate + copy fields back -> hand interpreter a real ref.

SAFEPOINTS          Only at safepoints can the runtime deopt/GC: full live-value
                    + ref description exists. Deopt points are safepoints.

ON-STACK INVALIDATE Mark "not entrant" -> active frames deopt at next safepoint/
                    return -> new calls recompile. Latency, not instant.

VALUE-DOMAIN BETS   SMI/int32 no-overflow | packed elements-kind | bounds/range |
                    non-null. One float / overflow / hole / null -> deopt + widen.

INLINE CACHE SLIDE  mono (1 shape, inlinable) -> poly (few) -> mega (gives up,
                    no inline, no speculation). Keep hot sites mono/low-poly.

"REMOVED" RULE      Any removed/moved/deleted computation must leave a deopt
                    route that RESTORES the original. That's why it's safe.

TWO CLOCKS          eager = value domain (types/range/overflow/null/kind)
                    lazy  = program structure (class load, CHA break, debugger)

DIAGNOSE            JVM: -XX:+PrintEliminateAllocations -XX:+PrintCompilation
                         -XX:+TraceDeoptimization  (-XX:-DoEscapeAnalysis to A/B)
                    V8 : --trace-deopt --trace-opt --trace-ic (debug build)

INVARIANT           Even reifying a never-existed object preserves semantics.
                    Deopt = slower, never wrong.
```

---

## Summary

The senior story is the deopt cases that are *constructive*, not merely a copy. **Scalar replacement** lets the compiler delete an object whose escape analysis proves it never leaves the method, holding its fields in registers — a top-tier optimization. But a deopt after that deletion may demand the object **exist**, so the deoptimizer **materializes (reifies)** it on the spot: allocate, copy the scalar fields, hand back a real reference. An object that never ran into existence is conjured precisely when reality requires it — and the program can't tell the difference, because semantics are preserved as always.

All of this is made *safe* by **safepoints**: the only places the runtime can deopt or GC, because only there does a complete description of live values and references exist. That same infrastructure powers **on-stack invalidation**, where invalidated code (a broken CHA dependency, a debugger attach) is marked *not entrant* and its already-running frames deopt at their next safepoint — correct, but not instantaneous. Layered on top is the full taxonomy of fragile, high-value bets: **no-overflow SMI/int32 math**, **packed elements-kinds**, **bounds/range elimination**, **non-null speculation**, and the **monomorphic → polymorphic → megamorphic** inline-cache slide that governs whether a site stays inlinable. The senior skill is recognizing that the *most valuable* speculations are the *most fragile*, reasoning about each bet's unwind cost, and structuring code so the bets persist. The `professional.md` level takes this into production: diagnosing deopt storms at scale, reading engine-specific telemetry, and the engineering playbook for keeping a large system on its fast paths.
