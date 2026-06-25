# Method Dispatch & Inline Caches — Senior Level

> **Topic:** [Method Dispatch & Inline Caches](README.md)
> **Focus:** Polymorphic and megamorphic inline caches, hidden-class/shape guards, devirtualization (CHA + speculative), and the branch-predictor interaction that makes "unpredictable dispatch" a real performance cliff.

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
15. [Diagrams & Visual Aids](#diagrams--visual-aids)

---

## Introduction

> Focus: **What happens when a call site sees two, three, or twenty types?** And **how does the runtime turn "this is probably a Dog" into a direct, inlinable call — and what does it cost when it's wrong?**

The middle level left a cliffhanger: one stray type at a call site forces the monomorphic inline cache to hold a second entry. This page is about that transition and everything past it. A cache with a handful of entries is a **polymorphic inline cache (PIC)** — a small linear list of `(shape → target)` guards, tried in order. Push enough distinct types through and the PIC overflows; the runtime gives up on per-site caching and marks the site **megamorphic**, falling back to a slower global lookup or vtable-style dispatch. The slope from monomorphic to megamorphic is the single most important performance gradient in dynamic-language runtimes, and understanding it is the difference between "my benchmark is fast" and "my benchmark is fast and I know why."

The other half of this page is **devirtualization**: the runtime's ability to prove (or bet) that a dynamic call has exactly one possible target, and so replace the indirect dispatch with a direct call — which then becomes *inlinable*, unlocking constant folding, escape analysis, and the rest of the optimizer. Two flavors matter: **CHA (Class Hierarchy Analysis)**, which proves uniqueness from the loaded class hierarchy, and **speculative devirtualization**, which bets on the profiled hot type and protects the bet with a guard plus a deoptimization escape hatch.

Underpinning all of it is the **CPU branch predictor**. An indirect call whose target keeps changing is a branch the predictor mispredicts, and a mispredict on a modern core costs on the order of a dozen-plus cycles of pipeline flush. This is *why* a megamorphic call site is slow at the hardware level — not just because the lookup is longer, but because the indirect jump itself becomes unpredictable.

In one sentence: **this level connects type-stability at the source level to the optimizer's ability to devirtualize and inline, and to the branch predictor's ability to keep the pipeline full — three layers that all reward keeping a call site seeing one type.**

---

## Prerequisites

- **Required:** Middle-level material — vtable layout, thunks, itables/itabs, and the monomorphic inline cache with its guard.
- **Required:** The hidden-class/shape concept (V8 Map, SpiderMonkey Shape, HotSpot klass) as the guard key.
- **Required:** Comfort reading the idea of a guard as a pointer-compare-and-branch.
- **Helpful but not required:** A rough mental model of a CPU pipeline and what a branch misprediction costs.
- **Helpful but not required:** Awareness that JITs profile code and can recompile (covered fully in `professional.md`).

You do **not** need to know:

- The full JIT compilation pipeline and tiering policy (that's `professional.md`).
- Exact V8/HotSpot source-level data structures down to field names.
- Garbage-collection mechanics.

---

## Glossary

| Term | Definition |
|------|-----------|
| **Monomorphic IC** | One cached (shape → target). One guard, then a direct call. The fast state. |
| **Polymorphic IC (PIC)** | A small set (typically up to ~4) of cached (shape → target) entries, tried in order. |
| **Megamorphic** | A call site that has seen more distinct shapes than the PIC can hold; per-site caching is abandoned for a global/generic lookup. |
| **PIC overflow** | The event of exceeding the PIC capacity, transitioning a site to megamorphic. |
| **Shape guard** | The pointer comparison against a hidden class/shape that protects a cached entry. |
| **Devirtualization** | Replacing a dynamic/virtual call with a direct call when the target can be proven or speculated unique. |
| **CHA (Class Hierarchy Analysis)** | Proving a virtual call has a single possible target by analyzing the currently loaded class hierarchy. |
| **Speculative devirtualization** | Betting on the profiled hot receiver type, emitting a guarded direct call, with deopt on guard failure. |
| **Guarded inlining** | Inlining the speculated target's body behind a type guard; the guard's failure path falls back to a generic call or deopt. |
| **Deoptimization (deopt)** | Bailing out of optimized code back to a generic/interpreted version when a speculative assumption is violated. |
| **Monomorphic-then-inline** | The payoff chain: stable type → devirtualize → inline → enable further optimization. |
| **Indirect branch** | A call/jump whose target is in a register/memory, not a constant. The kind the predictor must guess. |
| **BTB (Branch Target Buffer)** | The CPU structure that predicts the target of indirect branches based on history. |
| **Misprediction penalty** | The cycles lost flushing the pipeline when the predicted branch target was wrong. |

---

## Core Concepts

### 1. The Polymorphic Inline Cache (PIC)

When a second shape arrives at a monomorphic site, the runtime upgrades the IC to a **polymorphic inline cache**: a short, ordered list of guards.

```text
PIC at call site `obj.foo()`:
   if shape == Map_A:  call target_A
   elif shape == Map_B: call target_B
   elif shape == Map_C: call target_C
   else:                miss -> resolve, maybe append, or go megamorphic
```

The PIC is still far faster than a generic lookup: each entry is a compare-and-branch, and a hit short-circuits the rest. Crucially, the entries are typically tried **in order of how recently/frequently they were seen**, so a 90/10 type split still hits on the first compare most of the time. A PIC with 2–4 entries is a perfectly healthy state for genuinely polymorphic code (think: an AST visitor that sees a handful of node types). The performance falls off when the *number* of distinct shapes outgrows the cache.

### 2. Megamorphic: The Cliff

Most engines cap the PIC at a small size (V8's classic limit is 4; details vary by engine and IC kind). When a site exceeds it, the engine declares the site **megamorphic** and stops trying to cache per-site. Now every call does a **generic lookup**: V8 consults a global megamorphic stub backed by a hash table keyed by shape; the JVM falls back to the vtable/itable; SpiderMonkey switches to a generic IC stub. This is slower for three compounding reasons:

1. **The lookup itself is longer** — a hash probe or table walk instead of one compare-and-branch.
2. **The call is now an unpredictable indirect branch** — the target genuinely varies, so the CPU mispredicts (see §6).
3. **The optimizer can't devirtualize or inline** a megamorphic call — there's no single target to bet on, so the body stays out-of-line and downstream optimizations (constant propagation across the call, escape analysis) are blocked.

That third point is the killer. A megamorphic call isn't just a slow call; it's an **optimization barrier**. The lost inlining often dwarfs the lookup cost.

### 3. Hidden Classes / Shapes as the Bet's Currency

Every guard and every cache entry is keyed on a hidden class / shape pointer (covered in topic 01 in prose). The senior insight: **shapes are the unit the whole speculation economy trades in.** Two objects that you think are "the same" but that the runtime gave different shapes (because fields were added in a different order, or one got a deleted property, or one was created via a different path) will appear as *two types* at a call site — silently doubling the PIC's entry count. A megamorphic site is frequently not "the code is genuinely polymorphic" but "the code accidentally manufactures many shapes for what is logically one type." Keeping shape count low is therefore as important as keeping the number of *logical* types low.

### 4. Devirtualization via CHA

In a closed-world or partially-closed setting, the compiler can sometimes *prove* a virtual call has exactly one target. **Class Hierarchy Analysis** scans the loaded classes: if `Animal.speak()` is called but only `Dog extends Animal` exists and `Dog` doesn't override... or if `Dog` is the *only* subclass that overrides and the receiver is provably `Dog`... then the call has a unique target and can be compiled as a *direct* call. The JVM does exactly this: if CHA finds a single implementor of a method at JIT time, it emits a direct (and inlinable) call.

The subtlety: the JVM is an *open* world — a new class can be loaded later that adds an override, invalidating the CHA conclusion. So CHA-based devirtualization is paired with a **dependency**: if a class is later loaded that breaks the assumption, the JIT *deoptimizes* the affected compiled methods. CHA is thus "prove it under the current world, and tear it down if the world changes." `final` and `sealed` make CHA's job trivial and its conclusions permanent.

### 5. Speculative Devirtualization and Guarded Inlining

When the world is genuinely open and CHA can't prove uniqueness, the JIT falls back to **speculation**: the profile says this call site is 98% `Dog`, so emit

```text
   if (receiver.klass == Dog) {
       <inlined body of Dog::speak>      // direct, inlined, fully optimizable
   } else {
       <generic virtual call>            // or: deoptimize
   }
```

This is **guarded inlining**. The common path is a guard plus inlined code — as fast as static dispatch and open to all downstream optimization. The cold path handles the rare other types. If the site is monomorphic enough, the JIT may even omit the generic fallback and **deoptimize** on guard failure, betting the other types essentially never occur. For a 2- or 3-type site, the JIT can emit a small "polymorphic inlining" structure — a couple of guarded inlined bodies plus a fallback. Beyond that, it's not worth it, and the call stays a real virtual call. This is the JIT-level mirror of the interpreter's PIC.

### 6. The Branch Predictor Interaction

A virtual/interface/megamorphic call compiles to an **indirect branch** — the target sits in a register or memory. The CPU's **BTB (Branch Target Buffer)** predicts the target from history so the pipeline can keep fetching past the call without stalling. For a *monomorphic* indirect call, the target is always the same, the BTB predicts it perfectly, and the indirect call costs almost nothing beyond the loads. For a *megamorphic* call, the target genuinely varies, the BTB's prediction is frequently wrong, and each misprediction flushes the pipeline — on the order of 15-20 cycles on a modern out-of-order core. So the cost of a polymorphic call site is not merely the lookup; it's the **mispredicted indirect branch** on top of it.

This is the hardware reason the source-level advice ("keep call sites monomorphic") pays off twice: monomorphic sites devirtualize and inline (no indirect branch at all), and even when they don't, a single-target indirect call is BTB-friendly. Megamorphic sites lose both.

### 7. Property Access Rides the Same Machinery

Everything above applies to **property/field access**, not just method calls. `point.x` is, in V8/SpiderMonkey, an inline-cached operation: monomorphic load from a fixed offset, polymorphic small set, megamorphic dictionary lookup. The same monomorphic-to-megamorphic slide degrades a hot field read exactly as it degrades a hot method call. In dynamic-language profiling, "this property access went megamorphic" is as common a finding as "this call went megamorphic," and the fix is the same: stabilize shapes.

### 8. The Whole Chain, End to End

The senior synthesis: **type stability at the source → fewer shapes at the call site → monomorphic IC → CHA/speculative devirtualization → guarded (or unguarded) inlining → constant folding/escape analysis across the call → a BTB-friendly or branch-free hot path.** Break the chain at the top (many types/shapes), and you lose every link below it. This is why "make the collection homogeneous" or "construct objects consistently" can yield order-of-magnitude speedups that look out of proportion to the change — you didn't just speed up a lookup, you re-enabled the entire optimization cascade.

---

## Real-World Analogies

| Concept | Real-world thing |
|---------|------------------|
| **Monomorphic IC** | A barista who's served you the same order for a month — they start it the moment you walk in. |
| **Polymorphic IC** | A barista who knows your group's three usual orders and guesses from who walked in. |
| **Megamorphic** | A convention center coffee stand serving thousands of strangers — they can't predict anyone, so everyone waits in the generic queue. |
| **CHA devirtualization** | Proving "there's only one plumber in town," so any call to 'the plumber' goes straight to them — until a second plumber moves in (deopt). |
| **Speculative devirtualization + guard** | Betting the caller is your usual plumber, prepping their van, but checking the name on the work order first. |
| **Deoptimization** | The bet was wrong; abandon the prepped fast path and fall back to the slow, general process. |
| **Branch misprediction** | The assembly line pre-built the wrong part because it guessed the next order wrong; now it scraps the work and restarts. |

---

## Mental Models

### The "Cache Pressure Gauge" Model

Picture a gauge at each call site: needle at 1 (monomorphic), creeping up as new shapes arrive, redlining at megamorphic. Your job as a performance engineer is to keep hot-path gauges out of the red. Every "I'll just pass an `interface{}` / `Object` / base type here" decision nudges the relevant gauges up. Profiling tools that report IC state (V8's `--trace-ic`, JVM inlining logs) are reading these gauges for you.

### The "Optimization Cascade" Model

Devirtualization isn't a single optimization; it's the *gate* to a cascade. Open the gate (prove/speculate one target) and inlining, constant propagation, dead-code elimination, and escape analysis flow through. Keep it shut (megamorphic) and the call is a wall the optimizer can't see past. When you reason about the cost of a polymorphic call, count the optimizations it *blocks*, not just the cycles it *spends*.

### The "Guard + Trapdoor" Model (speculation)

Speculative devirtualization is a fast path with a trapdoor. The guard is the floor you stand on; as long as it holds (the type is what you bet), you run on the fast inlined path. The moment it fails, the trapdoor opens — deopt — and you fall to the slow but always-correct generic path. This "fast floor, safety trapdoor" structure is the universal shape of all JIT speculation, and dispatch is its most important instance.

---

## Code Examples

### Forcing a Site Through Mono → Poly → Mega (JavaScript)

```javascript
function dispatch(o) { return o.kind(); }   // one call site

class A { kind() { return 'A'; } }
class B { kind() { return 'B'; } }
class C { kind() { return 'C'; } }
class D { kind() { return 'D'; } }
class E { kind() { return 'E'; } }

// MONOMORPHIC: only A
for (let i = 0; i < 1e6; i++) dispatch(new A());

// POLYMORPHIC: A and B (and a couple more) — small PIC, still fast
const few = [new A(), new B()];
for (let i = 0; i < 1e6; i++) dispatch(few[i & 1]);

// MEGAMORPHIC: 5+ distinct shapes through one site — PIC overflows
const many = [new A(), new B(), new C(), new D(), new E()];
for (let i = 0; i < 1e6; i++) dispatch(many[i % 5]);
```

Run with `node --trace-ic` (or in d8) and you'll see the IC state for the `o.kind()` site transition `0 -> 1 (MONO) -> P (POLY) -> N (MEGA)`. The third loop is dramatically slower despite doing "the same amount of work" — that's the cliff.

### CHA Devirtualization in the JVM (conceptual)

```java
abstract class Shape { abstract double area(); }
final class Circle extends Shape {           // 'final' helps CHA enormously
    final double r;
    Circle(double r) { this.r = r; }
    double area() { return Math.PI * r * r; }
}

double totalArea(Shape[] shapes) {
    double sum = 0;
    for (Shape s : shapes) sum += s.area();   // virtual call...
    return sum;
}
```

If, at JIT time, `Circle` is the only concrete subclass of `Shape` that the classloader has loaded, HotSpot's CHA concludes `s.area()` has a single target, devirtualizes it, and inlines `Math.PI * r * r` directly into the loop — turning a virtual call into branch-free arithmetic. The JIT records a CHA dependency; if a second `Shape` subclass is later loaded, `totalArea` is deoptimized and recompiled. `final` on `Circle` makes the analysis trivial and the conclusion robust.

### Speculative Guarded Inlining (pseudo-IR)

```text
; profile says s.area() is 97% Circle at this site
loop:
    klass = load s.klass
    cmp   klass, Circle_klass
    jne   slow
fast:                                  ; GUARDED INLINE of Circle::area
    r     = load s.r
    area  = PI * r * r
    jmp   merge
slow:
    area  = virtual_call s.area()      ; or: deoptimize
merge:
    sum  += area
```

The guarded `Circle` path is straight-line, inlinable arithmetic with one well-predicted branch (the guard almost always falls through). The `slow` path catches the rare non-`Circle`. This is what "devirtualize + inline" physically produces.

### Stabilizing Shapes to Stay Monomorphic (JavaScript)

```javascript
// BAD: fields added in different orders -> different hidden classes -> polymorphic
function makeBad(a, b) {
  const o = {};
  if (a > 0) { o.a = a; o.b = b; }   // shape #1: {a, b}
  else       { o.b = b; o.a = a; }   // shape #2: {b, a}  (DIFFERENT Map!)
  return o;
}

// GOOD: same fields, same order, every time -> one hidden class -> monomorphic
function makeGood(a, b) {
  return { a, b };                   // always shape {a, b}
}
```

`makeBad` manufactures two shapes for what is logically one type; any hot site consuming its output starts polymorphic for no semantic reason. `makeGood` keeps shape count at one. This is the most common real-world cause of accidental polymorphism.

### Go: Avoiding Megamorphic Interface Sites in a Hot Loop

```go
// If a hot loop dispatches through io.Writer over MANY concrete writer types,
// the call site is effectively megamorphic: the indirect call target varies,
// the BTB mispredicts, and the call can't be inlined.

// When the concrete type is known and hot, prefer the concrete call:
func copyFile(dst *os.File, src *os.File) { /* dst.Write is a direct call */ }

// vs the general (sometimes necessary) interface path:
func copyAny(dst io.Writer, src io.Reader) { /* dst.Write is indirect */ }
```

The interface version is the right API; the concrete version is the right hot-path implementation when you have the type. Specializing the hot path is a legitimate, measured optimization — Go's compiler also does some devirtualization of interface calls when it can prove the concrete type.

---

## Pros & Cons

| Aspect | Pros | Cons |
|--------|------|------|
| **Polymorphic IC** | Handles genuinely multi-type sites cheaply (a few guarded branches). | Capacity-limited; overflow → megamorphic cliff. |
| **Megamorphic fallback** | Always correct; bounded memory (no per-site growth). | Slow lookup + mispredicted indirect branch + blocks inlining. |
| **CHA devirtualization** | Turns virtual calls into direct, inlinable calls with no runtime guard. | Open-world fragility: requires deopt machinery when new classes load. |
| **Speculative devirtualization** | Works in open worlds; near-static speed on the hot type. | Guard cost + deopt risk if the bet is wrong; cold path still slow. |
| **Branch-predictor friendliness** | Monomorphic indirect calls predict perfectly; near-free. | Megamorphic calls mispredict, paying full pipeline-flush penalty. |

---

## Use Cases

- **Diagnosing a dynamic-language hot path.** When a JS/Python loop is slow despite "simple" code, the first hypotheses are: a call site or property access went megamorphic, or shapes are being accidentally fragmented. The IC/shape model directs the investigation.
- **Tuning JVM/JS performance with type stability.** Refactoring a heterogeneous `List<Object>` or mixed-shape array into homogeneous data is often the highest-leverage change, precisely because it re-enables devirtualization and inlining.
- **Designing hot interfaces in Go/Java.** Knowing that a hot interface call over many implementors is a cliff guides you to specialize the hot path or narrow the interface.
- **Reasoning about deopt storms.** Repeated deoptimization (a guard that keeps failing because the bet was wrong) is its own pathology; the speculation model explains why and points to the fix (let the site go properly polymorphic instead of mis-speculating).

---

## Coding Patterns

### Pattern 1: Split a megamorphic site into several monomorphic ones

```javascript
// Instead of one site seeing all node types:
function visit(node) { return node.accept(visitor); }   // megamorphic

// Dispatch by kind ONCE, then call type-specialized functions whose
// internal call sites each see one type:
function visit(node) {
  switch (node.type) {
    case 'num': return visitNum(node);   // visitNum's sites are monomorphic
    case 'add': return visitAdd(node);
    // ...
  }
}
```

Moving the polymorphism to a single `switch` and keeping the downstream call sites type-specialized often beats relying on one hot megamorphic site.

### Pattern 2: Make uniqueness provable (`final`/`sealed`)

Mark leaf classes `final` and hierarchies `sealed` so CHA can devirtualize permanently without deopt dependencies. This is a free, intent-revealing speedup for any genuinely-not-overridden method.

### Pattern 3: Construct objects on one shape path

Initialize all fields in a fixed order in the constructor; avoid conditionally adding fields, deleting properties, or mutating object shape after construction. One construction path → one hidden class → monomorphic consumers.

### Pattern 4: Specialize the hot path, keep the general API

Offer the polymorphic/interface API for flexibility, but provide (or let the compiler generate) a concrete-type fast path for the measured hot loop. Don't degrade the whole API for one loop; specialize the loop.

---

## Best Practices

- **Profile IC/inlining state, don't guess.** Use `node --trace-ic`/`--trace-opt`, `-XX:+PrintInlining`/`-XX:+PrintCompilation`, or `perf` for indirect-branch mispredicts. The runtime can tell you exactly which sites went mega.
- **Treat megamorphic hot sites as bugs, not facts of life.** Most are accidental (fragmented shapes, an over-general container), not essential polymorphism.
- **Keep shape count == logical type count.** Accidental shape fragmentation is the stealthiest cause of polymorphism; consistent construction fixes it.
- **Prefer `final`/`sealed`/concrete types on hot paths.** They turn speculation into proof and remove guards entirely.
- **Don't over-speculate.** Forcing a genuinely polymorphic site to mis-speculate causes deopt storms; let it be a healthy PIC instead.
- **Measure the inlining loss, not just the call cost.** The real damage of a megamorphic call is the optimizations it blocks downstream.

---

## Edge Cases & Pitfalls

- **One rare type can wreck a hot site.** A 99.9%-`Dog` site that occasionally sees a `Cat` may still inline `Dog` with a guard — but a site that drifts to 5+ types tips megamorphic and loses everything. The transition is a step function, not gradual.
- **Accidental shape fragmentation looks monomorphic in source.** Two `{x, y}` objects built by different code paths can have different Maps; the call site is polymorphic even though "it's all just points." Hard to spot without shape-level tooling.
- **`delete obj.prop` (JS) demotes objects to dictionary mode**, giving them a slow, non-cacheable shape and forcing nearby ICs to mega. Avoid `delete` on hot objects; set to `undefined` or design the field out.
- **Deopt storms from bad speculation.** If the JIT speculates on a type that flips frequently, every flip deoptimizes and recompiles — pathologically slow. Symptom: high recompilation counts. Fix: make the site honestly polymorphic.
- **CHA conclusions are revoked by class loading.** A plugin/classloader that introduces a new override at runtime can deoptimize hot code mid-run, causing a latency spike. Relevant for app servers and dynamic plugin systems.
- **Branch-predictor state is finite and shared.** Even a monomorphic indirect call can mispredict if BTB entries are evicted by surrounding code with many indirect branches. Locality of hot indirect calls matters.
- **Megamorphic property access is as costly as megamorphic calls.** Don't only audit method calls; a hot `obj[dynamicKey]` or a property read over many shapes degrades identically.

---

## Cheat Sheet

```text
┌──────────────────────────────────────────────────────────────────┐
│        POLYMORPHISM, DEVIRTUALIZATION, AND THE CLIFF             │
├──────────────────────────────────────────────────────────────────┤
│ IC states (per call site / per property access):                 │
│   MONO  1 shape         guard + direct call/load      (fastest)  │
│   POLY  ~2-4 shapes     small ordered guard list      (fine)     │
│   MEGA  > cap           generic lookup + indirect call (CLIFF)   │
├──────────────────────────────────────────────────────────────────┤
│ Why MEGA is slow (3 compounding costs):                          │
│   1. longer lookup (hash/table vs compare-branch)                │
│   2. mispredicted indirect branch (~15-20 cyc pipeline flush)    │
│   3. blocks devirtualization -> blocks inlining -> blocks rest   │
├──────────────────────────────────────────────────────────────────┤
│ DEVIRTUALIZATION                                                 │
│   CHA          prove single target from loaded hierarchy;        │
│                deopt if a new override is loaded                 │
│   SPECULATIVE  bet on profiled hot type; guard + inline;         │
│                deopt on guard failure                            │
│   guarded inlining = the physical output of both                │
├──────────────────────────────────────────────────────────────────┤
│ The cascade:                                                     │
│   type-stable -> mono IC -> devirtualize -> inline ->            │
│   const-fold / escape-analysis / branch-free hot path           │
├──────────────────────────────────────────────────────────────────┤
│ Levers:                                                          │
│   * keep hot sites monomorphic (homogeneous data)               │
│   * shape count == logical type count (consistent construction) │
│   * final/sealed/concrete to enable proof, not just guess       │
│   * split a mega site into a switch + specialized callees       │
│   * avoid `delete` (JS) on hot objects (dictionary mode)        │
└──────────────────────────────────────────────────────────────────┘
```

---

## Summary

- A monomorphic inline cache upgrades to a **polymorphic IC** (a small ordered list of shape guards) when a second type appears, and to **megamorphic** (generic global lookup) when the PIC overflows its small capacity.
- **Megamorphic is a cliff** for three compounding reasons: the lookup is longer, the indirect branch becomes unpredictable (pipeline-flushing mispredicts), and — most importantly — the call can't be devirtualized, which **blocks inlining and the entire downstream optimization cascade**.
- **Hidden classes/shapes are the currency** of all guards and entries. Accidental shape fragmentation (fields added in different orders, `delete`d properties) makes logically-single types appear as many, silently driving sites megamorphic.
- **Devirtualization** turns a dynamic call into a direct (inlinable) one. **CHA** proves uniqueness from the loaded hierarchy (revoked by deopt when new classes load); **speculative devirtualization** bets on the profiled hot type behind a guard, with deopt as the safety net. Both produce **guarded inlining**.
- The **branch predictor** is why this matters at the hardware level: a monomorphic indirect call predicts perfectly (near-free), while a megamorphic one mispredicts and flushes the pipeline.
- The unifying chain runs from **source-level type stability → monomorphic IC → devirtualization → inlining → full optimization**. Breaking it at the top forfeits every benefit below, which is why small data-shape changes can produce outsized speedups.

---

## Diagrams & Visual Aids

### The IC State Machine

```text
        new shape                new shape (overflow cap)
  ┌──────────────┐  ──────►  ┌──────────────┐  ──────►  ┌──────────────┐
  │  MONOMORPHIC │           │ POLYMORPHIC  │           │ MEGAMORPHIC  │
  │  1 guard     │           │ 2..N guards  │           │ generic stub │
  │  fast        │           │ ok           │           │ CLIFF        │
  └──────────────┘           └──────────────┘           └──────────────┘
        ▲                                                      │
        └─────────── (rarely recovers without code/shape fix) ◄┘
```

### Cost Anatomy of a Megamorphic Call

```text
   monomorphic call cost:   [ guard ][ direct/inlined body ]           (cheap)

   megamorphic call cost:   [ generic lookup (hash/table) ]
                          + [ MISPREDICTED indirect branch ~15-20 cyc ]
                          + [ inlining lost -> no const-fold/escape ]
                            ───────────────────────────────────────────
                            = much more than "just a longer lookup"
```

### CHA vs Speculative Devirtualization

```text
   CHA (proof, closed-for-now world):
     only one impl loaded?  ──► direct call + inline
                               └─ if new override loaded later -> DEOPT

   SPECULATIVE (bet, open world):
     profile says 97% Dog  ──► if klass==Dog { inlined Dog::speak }
                                else          { generic call / DEOPT }
```

### Guarded Inlining Layout

```text
   loop body:
      ┌─ guard: klass == HotType ? ───────────────┐
      │  TRUE  -> [ inlined hot body ] (optimizable)│
      │  FALSE -> [ generic call ] or [ deopt ]     │
      └────────────────────────────────────────────┘
   guard almost always falls through -> predictor happy -> straight-line hot path
```

### Branch Predictor and Indirect Calls

```text
   MONOMORPHIC indirect call:
     target always T  ->  BTB predicts T  ->  pipeline stays full   (≈free)

   MEGAMORPHIC indirect call:
     target = T1,T2,T3,... varying  ->  BTB guesses wrong often
                                    ->  flush + refetch (~15-20 cyc each)
```
