# Method Dispatch & Inline Caches — Professional Level

> **Topic:** [Method Dispatch & Inline Caches](README.md)
> **Focus:** Dispatch as the engine of a production JIT — call-site profiling feeding inlining, V8/SpiderMonkey IC tiers, HotSpot C2's inlining decisions, the real cost of `final`/`sealed`, deopt economics, and how to engineer megamorphic call sites out of a hot system.

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

> Focus: **How do production runtimes use dispatch information to drive the optimizer — and how do you, as the engineer, design code and diagnose systems so that the hot call sites stay on the fast path?**

By the senior level the mechanisms were clear: PICs, megamorphic cliffs, CHA, speculative devirtualization, guarded inlining, branch prediction. This page is about how those mechanisms are wired together inside the runtimes you actually deploy on — V8, SpiderMonkey, HotSpot — and about the engineering decisions and diagnostics that follow. The thesis is that **inline caches are not just a dispatch optimization; they are the JIT's primary type-feedback channel.** The IC at a call site, after a warmup period, is a precise record of "which types flowed through here, in what proportion." The optimizing compiler *reads that record* to decide what to inline, what to speculate on, and what to leave as a generic call. Dispatch and inlining are not two topics; they are one feedback loop.

We'll walk the concrete tiering of V8 (Ignition → Sparkplug → Maglev → TurboFan) and HotSpot (interpreter → C1 → C2) specifically through the lens of how each tier collects and consumes IC/type-profile data. We'll quantify the real, measurable cost of `final`/`sealed` hints — not as folklore but as "what they let the compiler prove, and therefore which guards and indirect branches they eliminate." We'll cover the **economics of deoptimization**: a deopt isn't free, and a site that deopts repeatedly can be slower than if it had never been speculated on. And we'll treat the central production skill: **finding and eliminating megamorphic hot call sites** using the runtime's own tracing, profilers, and a disciplined refactoring playbook.

In one sentence: **at this level, method dispatch is the substrate of adaptive optimization — the IC is the sensor, inlining is the actuator, deopt is the safety system, and your job is to keep the loop converged on a fast, stable, monomorphic-or-tightly-polymorphic steady state.**

---

## Prerequisites

- **Required:** Senior-level material — PIC/megamorphic states, CHA and speculative devirtualization, guarded inlining, the branch-predictor interaction.
- **Required:** The hidden-class/shape model as the IC key (topic 01).
- **Required:** A working mental model of a tiered JIT: interpreter for cold code, optimizing compiler for hot code, deopt to fall back.
- **Helpful but not required:** Hands-on exposure to `--trace-*` flags or JIT logs in at least one runtime.
- **Helpful but not required:** Familiarity with a sampling profiler and reading indirect-branch-mispredict counters.

You do **not** need to know:

- The full register allocator or instruction-selection internals of any specific JIT.
- GC algorithm details (touched only where they interact with object headers/shapes).

---

## Glossary

| Term | Definition |
|------|-----------|
| **Type feedback** | The profile of receiver types/shapes recorded at a call site (in its IC), consumed by the optimizing compiler. |
| **Tiering** | Running code through successively more optimizing compilers as it gets hotter (and deoptimizing back when assumptions break). |
| **Ignition / Sparkplug / Maglev / TurboFan** | V8's interpreter, baseline JIT, mid-tier JIT, and top-tier optimizing JIT. |
| **C1 / C2** | HotSpot's client (fast, light) and server (slow, aggressive) JIT compilers; C2 does the heavy inlining and speculation. |
| **Inlining budget** | The compiler's bytecode/IR-size limit governing how much callee code it will inline into a caller. |
| **Polymorphic inlining** | Inlining 2–N speculated targets behind guards at one site, with a fallback. |
| **Uncommon trap / deopt point** | A site in optimized code where a violated assumption triggers deoptimization. |
| **OSR (On-Stack Replacement)** | Swapping a running (e.g. long-loop) frame from interpreted/baseline to optimized code mid-execution. |
| **Lock elision / escape analysis** | Optimizations that become possible only after inlining devirtualized calls. |
| **Megamorphic stub** | The shared generic dispatch handler a site uses once it gives up per-site caching. |
| **Dictionary / hashed mode** | A slow object representation (no stable shape) that makes ICs ineffective. |
| **`final` / `sealed`** | Language hints declaring a class/method non-extensible, letting the compiler prove unique targets without deopt dependencies. |
| **Deopt storm** | Pathological repeated deoptimization from speculation that keeps being violated. |

---

## Core Concepts

### 1. The IC Is the JIT's Type Sensor

The single most important professional reframing: **the inline cache is dual-purpose.** Its first job is dispatch acceleration (skip the lookup). Its second, equally important job is **type profiling**: the set of shapes recorded in a call site's IC during baseline/interpreted execution is exactly the information the optimizing compiler needs. When V8's TurboFan or HotSpot's C2 compiles a hot function, it consults each call site's accumulated IC state and asks: *Is this site monomorphic? Then devirtualize and inline unconditionally (with a deopt guard). Polymorphic with 2–3 types? Polymorphic-inline them. Megamorphic? Leave it as a generic call.* The optimizer's most consequential decisions are driven by IC feedback. This is why warmup matters: a function compiled before its ICs have seen representative types gets bad inlining decisions.

### 2. V8's Tiering Through the Dispatch Lens

V8 runs four tiers, and dispatch/type-feedback threads through all of them:

- **Ignition (interpreter):** executes bytecode; its inline caches collect type feedback into per-site *feedback vectors*. This is where shapes are first observed and recorded.
- **Sparkplug (baseline JIT):** a fast, non-optimizing compile that keeps using the same ICs/feedback vectors — quick code, still collecting feedback.
- **Maglev (mid-tier optimizing JIT):** uses the feedback to do moderate speculative optimization, including devirtualization and some inlining, at lower compile cost than the top tier.
- **TurboFan (top-tier optimizing JIT):** the heavy optimizer; reads the feedback vectors, speculatively devirtualizes monomorphic/polymorphic sites, inlines aggressively, and inserts deopt points guarded by shape checks.

A property access or call that stayed monomorphic through Ignition/Sparkplug becomes, in TurboFan, an inlined load from a fixed offset / an inlined method body behind a single guard. A site that went megamorphic in the lower tiers is compiled to a megamorphic stub call that TurboFan won't inline. The pipeline is, end to end, **a machine for converting stable type feedback into inlined machine code.**

### 3. SpiderMonkey's CacheIR

SpiderMonkey (Firefox) factors ICs through an intermediate representation called **CacheIR**: each IC attaches a small sequence of CacheIR operations describing "guard shape == S, then load slot k" (or "guard klass, call target"). The baseline interpreter and JITs share these CacheIR stubs, and the optimizing tier (WarpMonkey/Ion) consumes the accumulated CacheIR/type information to inline and specialize. The professional point is the same as V8's: **the IC is a structured, compiler-readable description of the site's observed types**, not just an opaque cache — which is what lets a later tier reconstruct exactly what to speculate on.

### 4. HotSpot C2 Inlining Decisions

HotSpot's C2 is the canonical example of dispatch driving inlining in a statically-typed VM:

- **CHA first.** If class hierarchy analysis proves a single implementor of a virtual/interface method, C2 devirtualizes to a direct call and inlines it (subject to the inlining budget), recording a dependency that deoptimizes the method if a conflicting class is later loaded.
- **Profile-guided speculation next.** If CHA can't prove uniqueness, C2 reads the call site's type profile (gathered by C1/the interpreter). A monomorphic profile → guarded inline of the hot type + uncommon trap on miss. A bimorphic/2-type profile → polymorphic inline of two targets + fallback. Megamorphic → a real virtual/interface call, not inlined.
- **The inlining budget gates it all.** Even a devirtualized call is only inlined if the callee fits the budget (`MaxInlineSize`, `FreqInlineSize`, etc.). A large hot method may be devirtualized but not inlined, capturing the call-cost win but not the cross-call optimization win.

`invokeinterface` is handled the same way but starts from a higher base cost (itable resolution), so devirtualizing an interface call is an even bigger relative win.

### 5. The Real Cost (and Value) of `final` / `sealed`

`final` (Java/Kotlin), `sealed` (C#/Kotlin/Scala/Java sealed classes), and non-virtual (C++) are not micro-optimizations to sprinkle blindly — but on hot paths their value is concrete and quantifiable:

- They let the compiler **prove** a unique target instead of speculating, which eliminates the type guard entirely (no compare-and-branch) and removes the deopt dependency (no recompilation risk from class loading).
- A `final` method on a `final` class is the strongest case: the call is provably direct and inlinable with zero runtime checks.
- The win is *not* usually in the call instruction itself (a well-predicted virtual call is cheap); it's in **enabling unconditional inlining** and the optimizations downstream (constant folding of the now-visible body, escape analysis that can stack-allocate or scalar-replace, lock elision). 

The honest caveat: modern JITs already devirtualize most effectively-monomorphic calls via CHA/speculation, so `final` often doesn't change steady-state performance much. Its biggest practical value is (1) on truly open-world hot paths where CHA can't help, (2) removing deopt risk in plugin/classloader-heavy systems, and (3) as a correctness/intent declaration. Reach for it deliberately, measure, and don't expect magic on already-monomorphic sites.

### 6. Deoptimization Economics

Speculation has a price tag, and a professional models it:

- **A single deopt** is moderately expensive: it discards the optimized frame, reconstructs the interpreter/baseline state, and the method must be re-profiled and recompiled. A handful of deopts during warmup are normal and healthy.
- **A deopt *storm*** — a site whose guard keeps failing because the type genuinely flips — is pathological. Each flip pays the deopt cost *and* re-optimizes on a now-stale assumption, only to deopt again. The result can be *slower than never optimizing*. 
- The runtime defends itself: after enough deopts at a site, it stops speculating there and compiles a stable (polymorphic or megamorphic) version. But the warmup waste already happened.
- **The engineering implication:** a site that is honestly polymorphic should be *allowed* to be polymorphic (let the PIC/polymorphic-inline handle it), not forced into a monomorphic speculation that keeps deopting. Over-speculation is as harmful as no speculation. Diagnosing a deopt storm (via `--trace-deopt` / `-XX:+PrintDeoptimization`) and *relaxing* the hot path's type assumptions is a real, recurring fix.

### 7. Engineering Megamorphic Sites Out of a System

The headline production skill. A megamorphic hot call site is almost always fixable, and the playbook is concrete:

1. **Find it.** Use the runtime's IC tracing (`node --trace-ic`, `--trace-opt`/`--trace-deopt`; `-XX:+PrintInlining`, `-XX:+PrintCompilation`, JFR; SpiderMonkey's IC logging) and CPU profilers measuring indirect-branch mispredicts (`perf stat -e branch-misses`, `perf record` on the hot frame).
2. **Classify it.** Is it *essential* polymorphism (genuinely many types, e.g. a generic serializer) or *accidental* (fragmented shapes, an over-general `Object`/`interface{}` container, conditional field init)?
3. **For accidental polymorphism:** stabilize shapes (consistent construction order, no `delete`, no late field addition), homogenize collections, and tighten static types so the site sees one shape.
4. **For essential polymorphism:** hoist the type discrimination to a single point (a `switch`/type dispatch) and route to type-specialized functions whose internal sites are monomorphic; or shard the hot path by type; or accept a small, healthy PIC (2–4) rather than fighting it.
5. **Verify.** Re-trace and re-profile: the site should now be monomorphic/polymorphic, indirect-branch mispredicts should drop, and the optimizer's inlining log should show the hot callee inlined.

The recurring lesson: **megamorphism is usually a data-shape or API-generality problem, not an inherent property of the algorithm.**

### 8. Cross-Language Synthesis

The professional view unifies the runtimes: V8/SpiderMonkey use ICs to profile shapes in dynamically-typed code and feed an optimizing JIT; HotSpot uses ICs and CHA to profile/prove receiver classes in statically-typed bytecode and feed C2; Go does ahead-of-time itab-based interface dispatch with some compiler devirtualization and no IC tier; C++ does fully static vtable dispatch with optional whole-program/LTO devirtualization. They differ in *when* the type information is available (runtime profile vs compile-time proof) but agree on the goal: **resolve the target uniquely so the body can be inlined and optimized, and keep the hot path's type distribution stable enough that the resolution holds.**

---

## Real-World Analogies

| Concept | Real-world thing |
|---------|------------------|
| **IC as type sensor** | A traffic counter at an intersection: it both speeds you through (timed lights) and records the traffic mix that the city later uses to redesign the junction. |
| **Tiered JIT** | A factory that first hand-assembles a product, then, once demand is proven, builds a dedicated automated line — and scraps the line if the product changes. |
| **`final`/`sealed`** | A signed contract that "this supplier is the only one" — now you can build a rigid, optimized supply line with no verification step. |
| **Deopt storm** | Rebuilding the automated line every shift because the product keeps changing — more wasteful than hand-assembly. |
| **Engineering out megamorphism** | Re-routing a chaotic intersection (all traffic through one light) into dedicated lanes per destination. |

---

## Mental Models

### The "Sensor → Actuator → Safety" Loop

Model the adaptive runtime as a control loop: the **IC is the sensor** (measures types), **inlining/devirtualization is the actuator** (commits to a fast layout), and **deopt is the safety system** (reverts when measurement was wrong). Your code is the plant being controlled. Stable inputs (type-stable hot paths) let the loop converge on an aggressive, fast steady state. Noisy inputs (fluctuating types) keep the safety system tripping. Most production tuning is about *feeding the loop clean signal*.

### The "Inlining Budget Ledger" Model

The compiler has a finite ledger of how much callee code it'll pull into a caller. Devirtualization makes a call *eligible* to be inlined, but the budget decides whether it *is*. So two wins are separable: devirtualization (cheaper call, BTB-friendly) and inlining (cross-call optimization). Hot, small, devirtualized callees get both; large ones get only the first. When tuning, distinguish "didn't devirtualize" (a type-stability problem) from "devirtualized but too big to inline" (a code-size problem).

### The "Steady State vs Warmup" Model

Every measurement lives in one of two regimes. **Warmup**: ICs filling, tiers compiling, some deopts — expect noise and don't draw conclusions. **Steady state**: ICs converged, hot methods at top tier, no recurring deopts — this is what production latency reflects. Benchmarks that don't reach steady state (or that measure across a deopt storm) lie. Always ask which regime your numbers describe.

---

## Code Examples

### Reading V8's IC and Deopt Traces

```javascript
// save as dispatch.js, run:  node --trace-ic --trace-opt --trace-deopt dispatch.js
function hot(o) { return o.value(); }

class Stable { value() { return 1; } }
class Other  { value() { return 2; } }

// Phase 1: monomorphic warmup -> IC becomes MONO, TurboFan inlines Stable.value
for (let i = 0; i < 2e6; i++) hot(new Stable());

// Phase 2: introduce a second type AFTER optimization -> guard fails -> DEOPT
for (let i = 0; i < 10; i++) hot(new Other());   // watch --trace-deopt fire here
```

`--trace-ic` shows the `o.value()` site go monomorphic; `--trace-opt` shows `hot` optimized with `Stable.value` inlined; `--trace-deopt` shows the deopt when `Other` arrives. This is the sensor → actuator → safety loop, observable on your laptop.

### Observing HotSpot Inlining and CHA

```java
// Run:  java -XX:+UnlockDiagnosticVMOptions -XX:+PrintInlining \
//            -XX:+PrintCompilation -XX:+PrintDeoptimization Bench
abstract class Op { abstract int apply(int x); }
final class Inc extends Op { int apply(int x) { return x + 1; } }

public class Bench {
    static int run(Op op, int n) {
        int s = 0;
        for (int i = 0; i < n; i++) s = op.apply(s);  // virtual call -> CHA devirtualizes
        return s;
    }
    public static void main(String[] a) {
        Op op = new Inc();
        for (int w = 0; w < 20; w++) run(op, 1_000_000);  // warm up to C2
    }
}
```

`-XX:+PrintInlining` will show `Inc::apply` inlined into `run` (`inline (hot)`), because with only `Inc` loaded, CHA proves a unique target. Add a second `Op` subclass and load it, and you'll see a deopt followed by recompilation to a guarded or virtual form.

### Demonstrating a Deopt Storm (and its fix)

```javascript
// BAD: the site flips type every iteration -> repeated deopt/reoptimize
function bad(items) {
  let s = 0;
  for (const it of items) s += it.weight();   // alternating types here
  return s;
}
// items = [A, B, A, B, ...] where A.weight and B.weight differ
// --trace-deopt shows recurring deopts; throughput is awful.

// FIX: stop forcing monomorphic speculation; sort/group by type so each
// run of the loop is type-stable, OR hoist a single dispatch:
function good(items) {
  let s = 0;
  for (const it of items) {
    s += (it instanceof A) ? aWeight(it) : bWeight(it);  // monomorphic callees
  }
  return s;
}
```

`bad` mis-speculates and deopts on every flip. `good` either keeps callees monomorphic or replaces the unstable virtual call with a stable, predictable branch. Measure both with `--trace-deopt`: the storm disappears.

### Go Compiler Devirtualization (conceptual)

```go
// Go's compiler can devirtualize an interface call when it can prove the
// concrete type at the call site (e.g. the value was just constructed).
func sum(rs []io.Reader) {} // general: indirect calls per element

func process() {
    var r io.Reader = &bytes.Reader{}   // concrete type known here
    _ = r.Read(nil)                     // compiler may devirtualize to (*bytes.Reader).Read
}
```

When the concrete type is statically evident, Go's compiler can turn the interface call into a direct (inlinable) call — the AOT analogue of CHA. When it can't (a slice of arbitrary `io.Reader`), the call stays indirect through the itab. Inspect with `go build -gcflags=-m` for inlining and devirtualization decisions.

### Measuring Indirect-Branch Mispredicts (Linux)

```bash
# Compare a monomorphic vs megamorphic workload at the hardware level.
perf stat -e branches,branch-misses,instructions,cycles ./mono_workload
perf stat -e branches,branch-misses,instructions,cycles ./mega_workload
# Expect the megamorphic run to show a far higher branch-miss rate and lower IPC,
# even if the source 'work' looks identical. Then drill in:
perf record -e branch-misses ./mega_workload && perf report   # find the hot indirect call
```

This is how you confirm, with hardware counters, that a slowdown is dispatch-driven (mispredicted indirect branches and depressed IPC) rather than, say, allocation or cache-capacity misses.

---

## Pros & Cons

| Aspect | Pros | Cons |
|--------|------|------|
| **IC-driven type feedback** | Lets a JIT specialize precisely to observed behavior; near-AOT speed on stable hot paths. | Requires warmup; pre-warmup or transient types cause bad early decisions and deopts. |
| **Aggressive speculative inlining** | Unlocks the full optimizer (const-fold, escape analysis, lock elision) across calls. | Deopt risk; deopt storms on unstable types can be net-negative. |
| **`final`/`sealed` proof** | Eliminates guards and deopt dependencies; robust in open worlds. | Limited steady-state gain on already-monomorphic sites; reduces extensibility. |
| **Megamorphic stub fallback** | Bounded, always-correct, no per-site blowup. | Slow lookup + mispredicts + no inlining; an optimization barrier. |
| **AOT devirtualization (Go/C++/LTO)** | No warmup, predictable; no deopt machinery needed. | Limited to what's provable at compile time; misses runtime-only monomorphism. |

---

## Use Cases

- **Latency-critical services on the JVM/Node.** Keeping hot request-path call sites monomorphic and inlinable is often the difference between p99 targets met and missed; deopt storms show up directly as tail-latency spikes.
- **Designing plugin/extension systems.** Open-world class loading invalidates CHA and can deoptimize hot code at runtime; architecting stable interfaces (or pre-loading implementations) controls this.
- **Optimizing interpreters and DSLs.** AST/bytecode dispatch loops are textbook megamorphic-site risks; the "hoist dispatch + specialize callees" playbook is the standard fix (and the basis of techniques like quickening and threaded interpreters).
- **Cross-runtime performance reviews.** Explaining "why is this hot in production but not in the microbenchmark" almost always involves warmup/steady-state and IC-state differences between the two environments.

---

## Coding Patterns

### Pattern 1: Warm the right types before measuring

```text
Run a representative warmup that exercises the SAME type distribution as production
before taking measurements (or before relying on steady-state latency). Microbenchmarks
that warm with one type and run with another measure deopt, not steady state.
```

### Pattern 2: Hoist dispatch, specialize callees (interpreter pattern)

Move the polymorphism to one `switch`/type-dispatch and call type-specialized functions; each callee's internal call sites then see one type and inline cleanly. This converts one megamorphic site into N monomorphic ones.

### Pattern 3: Stabilize shapes at the data-construction boundary

Centralize object construction so every instance of a logical type gets the identical shape (same fields, same order, no post-hoc mutation). Treat "shape fragmentation" as a code smell to be fixed at the factory, not at the call site.

### Pattern 4: Let honestly-polymorphic sites be polymorphic

Don't force a 3-type site to mis-speculate as monomorphic (deopt storm). Allow a small PIC / polymorphic inline. Over-speculation is a bug.

### Pattern 5: Use `final`/`sealed`/concrete on proven-hot, proven-stable leaves

After profiling identifies a hot, genuinely non-overridden method, seal it to remove guards and deopt dependencies — especially valuable in classloader-heavy systems.

---

## Best Practices

- **Diagnose with the runtime's own tools first.** IC traces, inlining logs, and deopt logs tell you exactly what the optimizer did and why — far more reliable than guessing from source.
- **Separate "didn't devirtualize" from "didn't inline."** The first is a type-stability problem; the second is a code-size/budget problem. They have different fixes.
- **Treat deopt storms as P1 perf bugs.** Recurring deopts can make optimized code slower than the interpreter. Find them with `--trace-deopt`/`PrintDeoptimization` and relax the offending speculation.
- **Always reason in steady state for production latency.** Discard warmup-window measurements; ensure benchmarks reach a converged tier/IC state.
- **Fix megamorphism at the data/API layer, not with micro-tweaks.** Homogenize shapes and collections, or restructure dispatch — don't paper over it.
- **Measure `final`/`sealed` impact; don't cargo-cult it.** It's a real lever in specific situations (open-world hot paths, deopt-prone systems), not a universal speedup.
- **Respect warmup in deployment.** For latency-critical JVM/Node services, account for cold-start/warmup (pre-warming, AOT/CDS, or accepting a ramp) so users don't hit un-optimized dispatch.

---

## Edge Cases & Pitfalls

- **A microbenchmark that "proves" `final` is free** likely tested an already-monomorphic site CHA had handled anyway. Test the open-world / multi-implementor case to see the real effect.
- **Production sees megamorphic where the test saw monomorphic** because production data has more type variety. The benchmark's type distribution must match production's, or the IC states diverge and the numbers are meaningless.
- **Classloader/plugin loading triggers mid-run deopts.** A hot path optimized via CHA can deoptimize when a plugin loads a new subtype — a latency spike unrelated to the request itself. Pre-load or seal to avoid.
- **OSR-compiled loops can have different inlining than method-entry compiles.** A long-running loop entered via OSR may inline differently than the same code reached normally; don't assume one trace generalizes.
- **GC and shape transitions interact.** In some engines, certain object operations (property deletion, very large objects) move objects to dictionary mode, permanently degrading their ICs even after the operation; the slowdown outlives the cause.
- **`instanceof`/type-switch hot paths can themselves go megamorphic.** Replacing virtual dispatch with a manual type ladder doesn't help if the ladder is long and the type distribution is flat — you've just moved the unpredictable branch.
- **Speculation can hide correctness-relevant type assumptions.** A guard that "never fails in testing" but can fail in production turns into a deopt under rare inputs — a performance failure mode that only manifests at scale.

---

## Cheat Sheet

```text
┌──────────────────────────────────────────────────────────────────┐
│         DISPATCH AS THE ENGINE OF ADAPTIVE OPTIMIZATION         │
├──────────────────────────────────────────────────────────────────┤
│ IC = dispatch accelerator AND type-feedback sensor               │
│   optimizer reads IC state to decide inline/speculate/give-up    │
├──────────────────────────────────────────────────────────────────┤
│ V8     Ignition -> Sparkplug -> Maglev -> TurboFan               │
│        (feedback vectors carry shape profiles up the tiers)      │
│ SpiderMonkey  CacheIR stubs describe each IC; Warp/Ion consume   │
│ HotSpot  interp -> C1 -> C2 ; CHA proof first, profile spec next │
│          inlining gated by budget (MaxInlineSize/FreqInlineSize) │
├──────────────────────────────────────────────────────────────────┤
│ DEVIRT WINS = (cheaper call) + (UNLOCKS INLINING -> rest)        │
│   separate "didn't devirt" (type problem)                        │
│   from     "didn't inline" (size/budget problem)                 │
├──────────────────────────────────────────────────────────────────┤
│ final/sealed/concrete:                                           │
│   prove unique target -> no guard, no deopt dependency           │
│   big win in OPEN worlds / plugin systems; small on already-mono │
├──────────────────────────────────────────────────────────────────┤
│ DEOPT economics:                                                 │
│   few during warmup = healthy                                    │
│   STORM (type keeps flipping) = slower than no opt -> fix it     │
│   let honestly-poly sites stay poly (don't over-speculate)       │
├──────────────────────────────────────────────────────────────────┤
│ Kill a megamorphic hot site:                                     │
│   1 find (--trace-ic / PrintInlining / perf branch-misses)       │
│   2 classify (accidental shapes vs essential polymorphism)       │
│   3 accidental -> stabilize shapes / homogenize collections      │
│   4 essential  -> hoist dispatch + specialize callees, or PIC    │
│   5 verify (re-trace; mispredicts drop; callee inlined)          │
├──────────────────────────────────────────────────────────────────┤
│ Always reason in STEADY STATE; warmup numbers lie.               │
└──────────────────────────────────────────────────────────────────┘
```

---

## Summary

- The professional reframing: **the inline cache is the JIT's type sensor.** Its recorded shape profile is exactly the type feedback the optimizing compiler reads to decide what to devirtualize, inline, and speculate on — dispatch and inlining are one feedback loop, not two topics.
- **V8** (Ignition → Sparkplug → Maglev → TurboFan) and **HotSpot** (interpreter → C1 → C2) both thread type feedback up their tiers; **SpiderMonkey** encodes each IC as **CacheIR** stubs the optimizer consumes. HotSpot additionally uses **CHA** to *prove* unique targets (with deopt-on-class-load dependencies), then profile-guided speculation, then megamorphic fallback — all gated by the **inlining budget**.
- `final`/`sealed`/concrete types let the compiler *prove* uniqueness, removing guards and deopt dependencies. Their real value is on **open-world hot paths** and **deopt-prone (plugin/classloader) systems** and in **enabling inlining**, not in shaving the call instruction on already-monomorphic sites. Measure; don't cargo-cult.
- **Deopt has economics.** A few deopts during warmup are healthy; a **deopt storm** from speculating on an unstable type can be slower than no optimization. Honestly-polymorphic sites should be *allowed* to be polymorphic; over-speculation is a bug.
- The core production skill is **engineering megamorphic hot sites out**: find them with runtime traces and hardware counters, classify accidental (shape fragmentation, over-general containers) vs essential polymorphism, then stabilize shapes/homogenize data or hoist dispatch and specialize callees, and verify the fix.
- Across runtimes the goal is identical — **resolve the target uniquely so the body can be inlined and optimized, and keep the hot path's type distribution stable enough that the resolution holds** — whether that resolution is a runtime profile (V8/HotSpot) or a compile-time proof (Go/C++/LTO).

---

## Diagrams & Visual Aids

### The Adaptive-Optimization Control Loop

```text
        ┌──────────── observe ────────────┐
        │                                 │
   [ inline caches ] ──type feedback──► [ optimizing JIT ]
   (SENSOR: shapes)                     (ACTUATOR: devirt + inline)
        ▲                                 │
        │                                 ▼
        │                          [ optimized code ]
        │                                 │
        └────── deopt (SAFETY) ◄──────────┘
             (assumption violated -> revert, re-profile)
```

### V8 Tiering and Where Dispatch Decisions Happen

```text
   Ignition  ──►  Sparkplug  ──►  Maglev  ──►  TurboFan
   (interp,        (baseline      (mid-tier    (top-tier opt:
    ICs collect     JIT, same      opt, some    full devirt +
    shape feedback) ICs)           devirt)      aggressive inline +
                                                deopt guards)
        └────────── feedback vectors carried upward ──────────┘
```

### HotSpot C2 Call-Site Decision Tree

```text
   virtual/interface call at JIT time
        │
   CHA: single implementor?
     yes ──► direct call + inline (+ dependency; deopt if new class loads)
     no
        │
   type profile?
     monomorphic ──► guarded inline of hot type + uncommon trap
     bimorphic   ──► polymorphic inline (2 targets) + fallback
     megamorphic ──► real virtual/interface call (NOT inlined)
        │
   (all inlining still gated by the inlining budget)
```

### Deopt: Healthy vs Storm

```text
   HEALTHY (warmup):
     opt ──guard fails once──► deopt ──re-profile──► opt' (now stable) ──► fast

   STORM (unstable type):
     opt ─►deopt─►opt─►deopt─►opt─►deopt ...   (never converges; < interpreter speed)
     fix: relax speculation / let it be polymorphic / stabilize the type
```

### Megamorphic-Elimination Playbook

```text
   [find]  --trace-ic / PrintInlining / perf branch-misses
      │
   [classify]
      ├─ accidental (shape fragmentation, Object/interface{} soup)
      │      └─► stabilize shapes, homogenize collections, tighten types
      └─ essential (genuinely many types)
             └─► hoist one dispatch (switch) + specialize callees (each MONO)
                 or accept a small healthy PIC
      │
   [verify]  re-trace: site MONO/POLY ; mispredicts down ; callee inlined
```
