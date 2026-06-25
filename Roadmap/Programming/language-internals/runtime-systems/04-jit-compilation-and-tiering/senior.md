# JIT Compilation & Tiering — Senior Level

> **Topic:** [JIT Compilation & Tiering](README.md)
> **Focus:** The profile-guided optimizations that make a JIT beat AOT — aggressive inlining, speculative devirtualization, type specialization, escape analysis with scalar replacement, range-check elimination, and loop transforms — and how each depends on runtime information the AOT compiler never had.

---

## Table of Contents

1. [Introduction](#introduction)
2. [Prerequisites](#prerequisites)
3. [Glossary](#glossary)
4. [Core Concepts](#core-concepts)
5. [Real-World Analogies](#real-world-analogies)
6. [Mental Models](#mental-models)
7. [Code Examples](#code-examples)
8. [Trade-offs](#trade-offs)
9. [Use Cases](#use-cases)
10. [Coding Patterns](#coding-patterns)
11. [Best Practices](#best-practices)
12. [Edge Cases & Pitfalls](#edge-cases--pitfalls)
13. [Summary](#summary)
14. [Further Reading](#further-reading)

---

## Introduction

> 🎓 At junior level you learned *that* a JIT compiles hot code. At middle level you learned *which tiers* it moves code through and *what* it profiles. At senior level you answer the question that justifies the entire machinery: **what specific optimizations does a JIT apply, and why can a runtime that observed your program produce code that a from-scratch AOT compiler provably cannot?**

The standard intuition — "AOT had all the time, the JIT is rushed, so AOT must win" — is wrong, and understanding *why* is the heart of this level. An AOT compiler must produce code that is correct for **every** possible execution. It cannot assume `shape` is always a `Circle`, that a list only ever holds `String`, that a branch is taken 99.97% of the time, or that a method is never overridden — because at compile time *any* of those could be false at runtime, and code that is wrong in even one case is simply wrong. A JIT operates under a different contract: it can assume whatever it has *observed*, compile code that is correct *only under those assumptions*, and **install a guard plus an escape hatch** so that if an assumption is ever violated, it discards the specialized code and falls back to a safe path (deoptimization — its own topic). This changes everything. Optimizations that are unsound in general become sound *when guarded*, and the profile tells the JIT exactly which speculative bets are worth making.

Above all else, the enabler is **inlining**. Almost every other optimization on this page only becomes possible *after* inlining has pulled a callee's body into the caller, exposing it to analysis. A JIT can inline aggressively and *speculatively* — inlining a virtual call's most likely target, guarded — because it has both the call-site type profile and the deopt safety net. Inlining is the keystone; remove it and the arch collapses.

This page walks through each major optimization, always answering two questions: **what runtime information does it consume**, and **what makes it unsound for AOT but sound for a guarded JIT?** It then connects to the realities a senior engineer must manage: megamorphic sites that starve inlining, the cost model of speculation, and where the handoff to deoptimization sits.

---

## Prerequisites

- **Required:** The middle-level pipeline model — HotSpot tiers, V8 Ignition→...→TurboFan, inline caches and type feedback, OSR, background compilation.
- **Required:** Comfort with the idea that a compiler works on an intermediate representation (IR) and applies optimization *passes*.
- **Required:** Solid grasp of virtual dispatch / vtables, heap vs stack allocation, and what a bounds check is.
- **Helpful:** Having read disassembly or IR dumps before (e.g., `-XX:+PrintAssembly`, `--print-opt-code`).
- **Helpful:** Familiarity with classic AOT optimizations (constant folding, CSE, loop-invariant code motion) so you can see what the *profile* adds on top.

You do **not** need (handled elsewhere):

- The frame-reconstruction mechanics of deoptimization — its own topic; we use it as a black-box safety net.
- Code-cache sizing, eviction, and production warmup engineering — `professional.md`.
- Register allocation and instruction-scheduling internals — beyond this topic's scope.

---

## Glossary

| Term | Definition |
|------|-----------|
| **Speculation** | Compiling code that is correct only under an assumption observed at runtime, protected by a guard that triggers deoptimization if violated. |
| **Guard** | A cheap runtime check (a type test, a null test, a branch predicate) that protects a speculative assumption. On failure, control deoptimizes. |
| **Inlining** | Replacing a call with the callee's body. The primary enabler — exposes the callee to all other optimizations in the caller's context. |
| **Inlining budget** | The size/heat limit governing what the JIT will inline; large callees and cold callees are excluded. |
| **Devirtualization** | Turning a virtual/dynamic dispatch into a direct call. *Speculative* devirtualization does so based on the observed receiver-type profile, guarded. |
| **Monomorphic / bimorphic / polymorphic / megamorphic** | A call site's degree: one, two, a few, or too-many observed receiver types. Megamorphic sites cannot be speculatively devirtualized or inlined. |
| **Type specialization** | Compiling a code path for the concrete types actually seen (e.g., int-only arithmetic, a specific array element type), guarded against other types. |
| **Escape analysis** | Proving an object never escapes the method (or thread) that created it, enabling stack allocation or its elimination. |
| **Scalar replacement** | The payoff of escape analysis: an unescaping object's fields are replaced by plain local variables (scalars) in registers, removing the allocation entirely. |
| **Range-check / bounds-check elimination (RCE/BCE)** | Removing array bounds checks the compiler can prove are always in range, often using loop-induction-variable reasoning. |
| **Loop-invariant code motion (LICM)** | Hoisting a computation that does not change across iterations out of the loop. |
| **Loop unrolling** | Replicating the loop body N times to amortize loop overhead and expose instruction-level parallelism. |
| **Uncommon trap** | HotSpot's name for a deoptimization point inserted where a speculative assumption is checked. |
| **Profile pollution** | When unrepresentative early executions skew the profile, leading the JIT to specialize for the wrong case. |
| **PIC (polymorphic inline cache)** | An inline cache that handles a small fixed set of types with inlined fast paths, one per observed type. |

---

## Core Concepts

### 1. Inlining — the keystone optimization

Inlining replaces `y = f(x)` with the *body* of `f`, substituting `x`. The direct win is removing the call: no argument marshaling, no jump, no return, no frame setup. But the **real** win is *context*: once `f`'s body is in the caller, the optimizer can fold the caller's constants into it, eliminate redundant checks across the boundary, propagate types, and chain further inlining. Most other optimizations on this page are *enabled* by inlining first having flattened the call graph.

A JIT inlines using a **budget** informed by the profile: small, hot callees are inlined; large or cold ones are not (inlining everything would explode code size and blow the code cache). The profile lets it spend the budget where calls are actually frequent. Crucially, a JIT can inline through *virtual* calls — which an AOT compiler often cannot, because it does not know the target. That requires the next optimization.

### 2. Speculative devirtualization

A call like `shape.area()` is virtual: the target depends on `shape`'s runtime class. AOT generally must emit an indirect dispatch through a vtable — and cannot inline, because it does not know which `area` to inline.

The JIT has the **type profile** for that call site, recorded in the inline cache. Suppose the profile says: of the last 100,000 calls, 99,998 had receiver type `Circle`. The JIT compiles:

```text
if (shape.class == Circle):      # the guard
    <inlined body of Circle.area()>   # direct + inlined!
else:
    deoptimize / take slow path
```

It has turned a non-inlinable virtual call into an inlined, direct, fully-optimizable body — *correct because guarded*. If a `Square` ever arrives, the guard fails and the runtime deoptimizes. For **bimorphic** or small **polymorphic** sites, it emits a few guarded cases (a PIC). For **megamorphic** sites it cannot do this at all — there is no dominant type to bet on — and must fall back to a plain dispatch with no inlining. **This is why megamorphic sites are catastrophic: they sever inlining at the root, and with it most downstream optimization.**

> This single optimization is the clearest example of *why a JIT can beat AOT*: the JIT exploits a fact (the receiver is almost always `Circle`) that is true at runtime but unprovable at compile time.

### 3. Type specialization

Dynamic languages have no static types; even in Java, a generic container erases to `Object`. The JIT observes the *concrete* types flowing through an operation and compiles a path specialized to them. In V8, `a + b` where the profile shows both are small integers compiles to integer addition with an overflow guard, instead of the fully general "could be string, double, object with valueOf" path. In a Java loop over a profiled-as-`Integer` collection, the JIT specializes the body for `Integer`.

The pattern is always the same: **observe the common type, compile the narrow fast path, guard against the rest.** The guard is cheap; the specialized body is far faster than the polymorphic general case. AOT cannot do this for genuinely dynamic or erased types because it has no concrete type to specialize to.

### 4. Escape analysis + scalar replacement

Allocating on the heap costs an allocation, costs GC pressure later, and costs pointer indirection on every field access. Many objects, though, never outlive the method that created them — an iterator, a temporary `Point`, a boxed `Integer` used once.

**Escape analysis** proves an object does not *escape*: it is never stored in a field/array reachable after the method returns, never returned, never passed somewhere that could retain it, and (for thread-escape) never shared with another thread. If it provably does not escape, the JIT applies **scalar replacement**: it deletes the object and replaces its fields with ordinary local variables that live in registers. The allocation, the GC cost, and the indirection all vanish — the object effectively never existed.

```java
// Without scalar replacement: allocates a Point on the heap.
Point p = new Point(x, y);
return p.x * p.x + p.y * p.y;
// After EA + scalar replacement: no Point object at all.
int px = x, py = y;
return px * px + py * py;
```

Why is this more powerful in a JIT? Because after *inlining* (often speculative/guarded), the JIT can see the object's *entire* lifetime in one compiled region. An AOT compiler that could not inline a virtual factory call cannot prove the object does not escape; the JIT, having inlined through the profile, can. Escape analysis and inlining reinforce each other.

### 5. Range-check (bounds-check) elimination

Memory-safe languages bounds-check every array access: `a[i]` becomes `if (i < 0 || i >= a.length) throw; else load`. In a tight loop this check can cost as much as the work. But the compiler can often *prove* the index is always in range — e.g., a loop `for (i = 0; i < a.length; i++)` accessing `a[i]` can never be out of bounds, so the check is dead. The JIT eliminates it, sometimes by hoisting a single check out of the loop (one guarded check up front, none inside).

The JIT advantage here is again **profile + speculation + inlining**: the loop bound, the array, and the index may only become statically relatable *after* inlining merged several methods, and the JIT can speculate on a loop's typical shape and guard the rest. AOT can do classic BCE, but the JIT can do it on code AOT could not even assemble into one place.

### 6. Loop optimizations

On the now-flattened, type-specialized, bounds-check-eliminated loop body, the JIT applies the classic loop transforms — and they hit harder because the body is clean:

- **Loop-invariant code motion:** hoist computations that do not vary per iteration.
- **Unrolling:** replicate the body to amortize loop overhead and expose instruction-level parallelism and vectorization.
- **Strength reduction, induction-variable simplification, range analysis.**
- **Vectorization (SIMD):** when the body is uniform and the element type is known, pack multiple iterations into one SIMD instruction. This is realistic only *after* type specialization and BCE made the body uniform and check-free.

The senior insight: these are "textbook" optimizations, but their *effectiveness* in a JIT comes from the earlier profile-guided passes that handed them a pristine loop body to work on.

### 7. The cost model: when speculation pays

Every speculative optimization installs a guard, and every guard can fail. The JIT is implicitly computing an expected value: `P(assumption holds) × (savings) − P(assumption fails) × (deopt + re-profile + re-compile cost)`. When the profile shows an assumption holds 99.99% of the time, the bet is overwhelmingly positive. When the profile is *mixed* (a branch is 55/45, a site is genuinely polymorphic), speculation is a bad bet — the guard fails too often, deopts churn, and the JIT either declines to specialize or, worse, enters a deopt loop. A senior engineer's job is often to make the profile *cleaner* — push a site toward monomorphism — so the JIT's bets become safe. **You cannot make the JIT smarter; you can make your program more predictable.**

---

## Real-World Analogies

**The surgeon who reviewed the chart (speculative devirtualization + the AOT contrast).** An AOT compiler is a field medic who must be ready for *any* patient walking in — no history, prepare for everything, move cautiously. A JIT is a surgeon who read this specific patient's chart: "99.99% chance it's appendicitis." They prep precisely for that, fast and direct — with a guard in place ("if I open up and it's not appendicitis, stop and reassess"). The chart is the runtime profile. The medic *cannot* be that fast because they *cannot* know; the surgeon can, because they *observed*.

**Mise en place (escape analysis + scalar replacement).** A line cook who knows a sauce will be used and discarded within this one dish doesn't plate it, store it, or label it for the walk-in — they keep it in a bowl on the counter (a register) and use it immediately. Only ingredients that *escape* this dish (go to the fridge, to another station) get the full container-and-label treatment (heap allocation). Proving "this never leaves the counter" is escape analysis; skipping the container is scalar replacement.

**Removing the bag-check you already did (bounds-check elimination).** If a guard checked your bag at the building entrance and you never left the secured floor, re-checking it at every interior door is pure waste. Prove you stayed inside the proven-safe region (the loop range) and all the interior checks can be removed, keeping just the one at the entrance.

---

## Mental Models

**Model 1 — Optimization is a tree rooted at inlining.** Draw inlining as the trunk. Devirtualization is what lets the trunk grow through virtual calls. Type specialization, escape analysis, BCE, and loop transforms are branches that can only grow once the trunk (inlined, flattened code) exists. Cut the trunk (megamorphic site → no inlining) and the whole tree dies. When diagnosing a slow hot path, *always check inlining first*.

**Model 2 — Every JIT optimization is "assume + guard + escape hatch."** Internalize this triple. The assumption comes from the profile; the guard is a cheap check; the escape hatch is deoptimization. This single shape explains devirtualization, type specialization, null-check elision, branch speculation, and BCE. AOT lacks the escape hatch, so it cannot make the assumption.

**Model 3 — The profile is a probability distribution, and the JIT is a bettor.** A monomorphic site is a near-certain bet — bet big (inline, specialize). A 50/50 branch is a coin flip — don't bet (don't speculate; emit balanced code). Megamorphic is "no favorite" — don't bet at all (generic dispatch). Your job as an engineer is to *sharpen the distribution* so the JIT can bet confidently.

**Model 4 — Why JIT > AOT, in one line.** AOT must be correct for the union of all executions; a JIT must be correct only for the executions it observed, *plus a guarded fallback for the rest*. The gap between "all possible" and "actually observed" is precisely the optimization headroom the JIT exploits.

---

## Code Examples

### Example 1 — Speculative devirtualization in action (HotSpot)

```java
interface Shape { double area(); }
final class Circle implements Shape {
    final double r; Circle(double r){this.r=r;}
    public double area(){ return Math.PI*r*r; }
}
final class Square implements Shape {
    final double s; Square(double s){this.s=s;}
    public double area(){ return s*s; }
}

public class Devirt {
    static double total(Shape[] xs) {
        double t = 0;
        for (Shape x : xs) t += x.area();   // virtual call site
        return t;
    }
    public static void main(String[] a) {
        Shape[] xs = new Shape[10000];
        for (int i=0;i<xs.length;i++) xs[i] = new Circle(i); // ALL Circles
        double acc=0;
        for (int r=0;r<100000;r++) acc += total(xs);
        System.out.println(acc);
    }
}
```

```bash
java -XX:+PrintCompilation -XX:+UnlockDiagnosticVMOptions -XX:+PrintInlining Devirt
```

`PrintInlining` will show `Circle::area` being inlined into `total` despite the call being virtual — because the profile saw only `Circle`. The compiled loop is a tight `Math.PI*r*r` with a class guard. Now change half the array to `Square` and re-run: the site becomes bimorphic, inlining changes to two guarded cases, and the loop slows. Make it megamorphic (many `Shape` subclasses) and inlining disappears — the loop falls back to vtable dispatch and the speed collapses. You have just observed, end to end, why type stability dictates JIT performance.

### Example 2 — Escape analysis and scalar replacement

```java
public class Escape {
    static final class Vec { final double x,y; Vec(double x,double y){this.x=x;this.y=y;} }
    static double dot(double ax, double ay, double bx, double by) {
        Vec a = new Vec(ax, ay);   // does NOT escape dot()
        Vec b = new Vec(bx, by);   // does NOT escape dot()
        return a.x*b.x + a.y*b.y;
    }
    public static void main(String[] args) {
        double acc=0;
        for (int i=0;i<500_000_000L;i++) acc += dot(i, i+1, i+2, i+3);
        System.out.println(acc);
    }
}
```

Run with escape analysis on (default) versus off:

```bash
java Escape                              # EA on: zero Vec allocations
java -XX:-DoEscapeAnalysis Escape        # EA off: allocates 2 Vec per call
```

With EA on, this loop allocates *nothing* on the heap despite "creating" a billion `Vec` objects — scalar replacement turned them into registers. With EA off, it allocates two objects per iteration and the GC works hard. The throughput difference is large, and it comes entirely from a profile-and-inlining-enabled analysis AOT often cannot perform on the same code.

### Example 3 — Bounds-check elimination

```java
public class BCE {
    static long sum(int[] a) {
        long s = 0;
        for (int i = 0; i < a.length; i++) s += a[i];  // i provably in [0,len)
        return s;
    }
    public static void main(String[] x){
        int[] a = new int[1_000_000];
        for (int i=0;i<a.length;i++) a[i]=i;
        long acc=0;
        for (int r=0;r<2000;r++) acc += sum(a);
        System.out.println(acc);
    }
}
```

In the tier-4 disassembly (`-XX:+PrintAssembly`, needs hsdis), the inner loop contains **no** per-iteration bounds comparison — the JIT proved `i` stays in range and removed the check. Rewrite the loop to index with a value the JIT *cannot* relate to `a.length` (e.g., index by a separately-computed array of indices) and the checks reappear, slowing the loop. The lesson: write loops whose index relationship to the array length is *obvious*, so BCE can fire.

### Example 4 — Watching type specialization in V8

```js
function add(a, b) { return a + b; }
// Phase 1: only integers -> V8 specializes to int add with overflow guard.
let s = 0;
for (let i = 0; i < 50_000_000; i++) s += add(i, i + 1);
console.log(s);
```

```bash
node --trace-opt --trace-deopt --allow-natives-syntax spec.js
```

`add` optimizes to a specialized integer path. If you later call `add("x", "y")`, V8 prints a `deoptimizing` line — the integer assumption was violated — and recompiles a more general (slower) version. The deopt line is the boundary where this topic hands off to the deoptimization topic.

### Example 5 — Inlining budget and method size

```java
// A method too large to inline blocks optimization of its callers.
static int hot(int x) {
    // ... 600 lines of logic ...   // exceeds the inline budget
}
```

If `hot` is on a hot path but too large to inline, the caller cannot fold constants into it, cannot devirtualize through it, and cannot scalar-replace objects that cross its boundary. Splitting `hot` into a small inlinable fast path plus a cold `hotSlow()` (the `@HotSpotIntrinsicCandidate`-style "fast path tiny, slow path separate" pattern) frequently restores the optimizations. This is why "small methods on the hot path" is performance advice, not just style advice.

---

## Trade-offs

- **Speculation depth vs deopt risk.** Deeper speculation (assume more) yields faster code but more guards and higher deopt probability. The profile's sharpness sets the right depth; over-speculating on a mixed profile causes deopt churn.
- **Inlining aggressiveness vs code size.** More inlining → faster code but larger compiled output → more code-cache pressure (`professional.md`). The budget balances these.
- **Optimization time vs warmup.** The top tier's analyses (EA, deep inlining) are expensive to run; doing more of them lengthens warmup. The mid tiers exist precisely to avoid paying full price too early.
- **Specialization vs generality.** A specialized path is fast but narrow; if the program is genuinely polymorphic, specialization is wasted effort and the general path is the honest choice.
- **JIT vs AOT.** AOT gives predictable, allocation-free startup and no warmup, at the cost of forgoing every profile-guided optimization above. The right choice depends on process lifetime — the central theme of `professional.md`.

> 🎓 Every item here is the same lever viewed differently: **how much do we assume, and what does a wrong assumption cost?** Senior performance work is the art of arranging your code so the JIT's assumptions are almost always right.

---

## Use Cases

- **Throughput-critical JVM services** rely on C2's inlining + EA + BCE to reach near-native loop speeds (stream processing, serialization, JSON parsing hot loops).
- **High-performance JavaScript** (game engines, spreadsheet calc, crypto in JS) depends on TurboFan's type specialization and inlining; keeping shapes monomorphic is the difference between fast and unusable.
- **Numeric kernels** benefit most from BCE + loop unrolling + vectorization, which only fire after specialization makes the body uniform.
- **Allocation-heavy idiomatic code** (lots of small temporary objects, iterators, boxing) is rescued by escape analysis — letting you write clean code that performs like hand-optimized code.

---

## Coding Patterns

**Pattern 1 — Engineer monomorphism on hot sites.** The highest-leverage thing you can do for a JIT. Keep one concrete receiver type per hot virtual call; use `final` classes/methods where appropriate (a `final` method is trivially devirtualizable); avoid passing many subtypes through the same hot site.

**Pattern 2 — Keep hot methods inlinable.** Small, single-purpose hot methods get inlined; split a large hot method into a tiny fast path plus a separate cold slow path so the fast path fits the budget.

**Pattern 3 — Don't let temporaries escape.** Keep short-lived objects local — don't stash them in fields, don't return them, don't hand them to unknown callers — so escape analysis can scalar-replace them. Avoid unnecessary boxing on hot paths.

**Pattern 4 — Make index/length relationships obvious for BCE.** Loop directly `for (i=0; i<a.length; i++)` over the same array you index; avoid indirection that hides the relationship from the analyzer.

**Pattern 5 — Stabilize object shapes (dynamic languages).** Initialize all fields in the constructor, in one order, and never add/delete fields later, so type specialization and ICs stay valid.

---

## Best Practices

- **Diagnose inlining first.** When a hot path is slow, check whether the key calls inlined (`-XX:+PrintInlining`, V8 `%GetOptimizationStatus`). A non-inlined hot call is usually the root cause; chase *why* (too big? megamorphic? not hot enough?).
- **Read the assembly when it matters.** For a truly hot kernel, look at the tier-4/TurboFan output. Confirm bounds checks are gone, allocations are gone, and the dispatch was devirtualized. The source cannot tell you; the machine code can.
- **Treat the profile as a tunable input.** You influence the profile by how you structure types and call sites. Cleaner profiles → safer speculation → faster code. This is the senior lever.
- **Watch for deopt loops.** Repeated deopt+recompile on one hot method means a guard keeps failing — your assumption is genuinely unstable. Find the offending speculation and either stabilize the data or accept the general path. (Full mechanics: deoptimization topic.)
- **Prefer `final` and sealed hierarchies on hot paths.** They give the JIT (and sometimes AOT) statically provable devirtualization, reducing reliance on speculation.

---

## Edge Cases & Pitfalls

**Pitfall 1 — Megamorphic call sites starving inlining.** The dominant senior-level performance bug. A library "convenience" method called from everywhere with every type becomes megamorphic and stops inlining for *all* its callers. Fix by splitting the site or specializing call paths. (Demonstrated in Example 1.)

**Pitfall 2 — Profile pollution from warmup traffic.** If a service's first requests are unrepresentative (health checks, a synthetic warmup loop with the wrong types), the JIT specializes for the wrong case, then deopts when real traffic arrives. Warm up with *representative* data.

**Pitfall 3 — Escape analysis defeated by a leak you didn't notice.** Storing a "temporary" in a field, returning it, passing it to a virtual method that *might* retain it, or capturing it in a lambda can make it escape, silently killing scalar replacement. EA is all-or-nothing per object: one leak path disables it.

**Pitfall 4 — Bounds-check elimination defeated by hidden index math.** Indexing through an indirection, using a long index where the array length is int, or mutating the array length-relevant variable inside the loop can prevent BCE. The check returns and the loop slows with no source-level hint.

**Pitfall 5 — Over-relying on speculation for branchy logic.** A 60/40 branch is not worth speculating; if the JIT speculates and the minority case is common, you pay deopts. Sometimes the *general* path is genuinely the right answer, and forcing speculation hurts.

**Pitfall 6 — `final` removed, devirtualization lost.** Dropping `final` from a hot class/method "for flexibility," or a framework generating subclasses, can quietly turn a statically-devirtualizable call into a speculative or megamorphic one. Performance regresses with no obvious cause.

**Pitfall 7 — Assuming the optimizer is consistent across runs.** Because optimizations depend on the *profile*, and the profile depends on execution order and timing, the same code can be optimized differently across runs (or across machines). Reproduce performance with controlled, representative warmup.

---

## Summary

- A JIT beats AOT because it may assume what it *observed* and **guard** it with a deoptimization escape hatch; AOT must be correct for *all* executions and therefore cannot make those assumptions.
- **Inlining is the keystone.** It flattens the call graph and exposes callees to every other optimization. Lose it (megamorphic sites) and the rest collapses.
- **Speculative devirtualization** turns profiled virtual calls into inlined direct calls behind a type guard — the clearest demonstration of JIT-over-AOT.
- **Type specialization** compiles narrow fast paths for the concrete types seen, guarded against the rest — essential for dynamic and type-erased code.
- **Escape analysis + scalar replacement** delete non-escaping objects, turning fields into registers and removing allocation/GC cost — supercharged by inlining.
- **Range-check elimination** removes provably-safe bounds checks; **loop transforms** (LICM, unrolling, vectorization) then hit a clean, uniform body hard.
- Every optimization is **assume + guard + escape hatch**, and its profitability is a bet sized by the profile's sharpness. The senior lever is making your program *predictable* so the JIT's bets are safe.
- The boundary where a guard fails hands off to **deoptimization** (its own topic); repeated failures are a deopt loop and a real performance bug.

---

## Further Reading

- HotSpot C2 documentation and the OpenJDK wiki on inlining, escape analysis (`-XX:+DoEscapeAnalysis`), and the `-XX:+PrintInlining` / `-XX:+PrintAssembly` (hsdis) tooling.
- V8 TurboFan design docs and "An Introduction to Speculative Optimization in V8" for the assume-guard-deopt model in a dynamic language.
- "Optimizing Java" (Evans, Gough, Newland) for practical inlining/EA/BCE diagnosis on the JVM.
- Papers on partial escape analysis (Graal) for the state of the art in scalar replacement under branching.
- The professional tier of this topic, which turns these optimizations into operational concerns: code-cache management, warmup strategy, and the engineering pressures that drove AOT alternatives.
