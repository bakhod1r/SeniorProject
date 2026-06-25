# Deoptimization & Speculation — Professional Level

> **Topic:** [Deoptimization & Speculation](README.md)
> **Focus:** Production reality — diagnosing deopt storms at scale, reading engine telemetry across V8 / HotSpot / SpiderMonkey / .NET, the deopt-bailout-reason taxonomy, warm-up and tier policy, and the engineering playbook for keeping a large system on its fast paths.

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

> Focus: **You own a hot service or library. Something keeps deoptimizing in production. How do you find it, prove it, fix it, and prevent regressions — across four very different engines?**

Everything below the professional level explains *how* speculation and deopt work. This level is about *operating* a system where they matter. In production you'll meet:

- A Node.js service whose p99 latency degraded after a refactor, because one hot handler slid to **megamorphic** and stopped inlining.
- A JVM service whose throughput collapses for seconds after a deploy, because dynamically loaded classes triggered a wave of **CHA invalidations** and re-compilation.
- A numeric pipeline that's mysteriously slow because one code path produces a **hole** or a **double** that deopts a `PACKED_SMI` loop a billion times.
- A **deopt storm**: a function pinned in an optimize → deopt → re-optimize cycle, where the runtime burns CPU compiling code it immediately discards, and the function is effectively *never* fast.

The professional job is to make these *legible* and *fixable*: turn on the right telemetry, read the **bailout/deopt reason taxonomy** (each reason names the broken bet), localize the offending site, fix it by *stabilizing the speculation* (type, shape, target, value domain) rather than by disabling optimization, and add a regression guard so it doesn't silently return. And you must do this across engines that disagree on vocabulary: V8 *bailouts*, HotSpot *uncommon traps* / *not entrant*, SpiderMonkey *bailouts* between its tiers, and .NET's tiered JIT (which historically does **not** speculatively deopt the way V8/HotSpot do — an important cross-engine distinction).

> 🎓 **Why this matters for a professional:** Deopt pathologies are among the most expensive and least obvious performance bugs, because the source code looks innocent and the slowdown is emergent. The engineer who can read `--trace-deopt` / `PrintCompilation` and say "this site went megamorphic on commit X; here's the one-line fix and the regression test" is worth a great deal. This is also the level where you decide *policy*: warm-up handling, tier configuration, when to give the engine type hints, and when to stop fighting it.

This page covers: the cross-engine deopt model and vocabulary, the reason-code taxonomy, diagnosing and killing deopt storms, warm-up and tiering policy, production telemetry, and the regression-prevention discipline.

---

## Prerequisites

- **Required:** `junior.md` → `senior.md` in full — bet/guard/deopt, reconstruction metadata, eager/lazy, CHA, scalar replacement/reification, safepoints, IC mono→mega, value-domain bets.
- **Required:** Comfort reading runtime flags and logs (`-XX:...`, `node --trace-*`).
- **Required:** Production performance fundamentals — percentiles, warm-up, throughput vs latency, profiling.
- **Helpful but not required:** Exposure to more than one of V8 / HotSpot / SpiderMonkey / CLR.

You do **not** need:

- To have implemented a JIT. This is operations and engineering, not compiler construction.

---

## Glossary

| Term | Definition |
|------|-----------|
| **Deopt storm / loop** | A pathology where a function is repeatedly optimized then deopted, never reaching stable fast code. |
| **Bailout reason** | (V8/SpiderMonkey) The named cause of a deopt: `wrong map`, `not a Smi`, `insufficient type feedback`, etc. |
| **Uncommon trap** | (HotSpot) The compiled trap that triggers deopt; trap *reasons* (`class_check`, `null_check`, `range_check`, `unstable_if`) name the broken bet. |
| **Not entrant / zombie** | (HotSpot) Lifecycle states of invalidated compiled code: *not entrant* (no new entries), then *zombie* (reclaimable). |
| **Tiered compilation** | Running multiple compilers (interpreter → baseline → optimizing) with promotion/demotion policy between them. |
| **Reoptimization budget / bailout cap** | A limit after which an engine stops re-optimizing a chronically-deopting function and leaves it in a lower tier. |
| **Deopt-all** | Mass deoptimization of all optimized code (e.g. on debugger attach, certain runtime reconfigurations). |
| **FeedbackVector** | (V8) Per-function structure storing type feedback (IC states) that drives speculation. |
| **OSR (On-Stack Replacement)** | Compiling and entering an optimized version of a long-running loop mid-execution. |
| **Tiered JIT (CLR)** | .NET's QuickJIT → optimized JIT (Tier-1) progression; ReadyToRun for AOT-ish startup. Notably **not** speculative-deopt-driven. |
| **PGO** | Profile-guided optimization; in .NET, *Dynamic PGO* feeds Tier-1; in HotSpot, profiling drives C2. |
| **Megamorphic** | A site with too many shapes/types to specialize; loses inlining and most speculation. |
| **Warm-up** | The interval during which a process is still profiling and tiering up; pre-steady-state performance is unrepresentative. |
| **Steady state** | Post-warm-up behavior, after compilation has settled — what production latency actually reflects. |

---

## Core Concepts

### 1. The cross-engine model (same idea, four dialects)

All speculative JITs share the bet/guard/deopt core, but differ in vocabulary, tiers, and how aggressively they deopt:

```text
ENGINE         TIERS (roughly)                   "DEOPT" CALLED      NOTES
V8 (JS)        Ignition -> Sparkplug -> Maglev    "deopt"/"bailout"   FeedbackVector-driven;
               -> TurboFan                                            shapes(maps)+elements kinds.
HotSpot (JVM)  Interpreter -> C1 -> C2            "uncommon trap" /   CHA + profiling; lazy
               (Graal as alt C2)                  "not entrant"       invalidation on class load.
SpiderMonkey   Interpreter -> Baseline ->         "bailout"           Bails between IonMonkey/
               WarpMonkey/Ion                                         Warp and Baseline.
.NET CLR       Interpreter? no -> QuickJIT(T0)    NOT speculative-    Tiers UP via call counts;
               -> Tier-1(opt, Dyn-PGO)            deopt in the        does not abandon a frame
                                                  V8/HotSpot sense    mid-run on a broken type bet.
```

The .NET distinction is important and often misunderstood: the CLR's tiering promotes hot methods to an optimized JIT and uses **Dynamic PGO**, but it does **not** speculatively compile a method assuming a type/shape and then *deoptimize a running frame* when the bet breaks the way V8 and HotSpot do. Its guarded devirtualization falls back via a *runtime branch* in the compiled code, not a frame-rewinding deopt. So "deopt storms" as a pathology are primarily a V8 / HotSpot / SpiderMonkey concern; on .NET you reason about tiering, guarded devirt, and PGO quality instead.

### 2. The deopt-reason taxonomy is your primary signal

Every deopt carries a *reason*, and the reason **names the broken bet**. Reading it is the fastest path to root cause:

**V8 (selected):**

```text
wrong map / wrong map dynamic   -> object shape (hidden class) changed
unstable map                    -> shape isn't stabilizing; access keeps changing maps
not a Smi / lost precision       -> integer bet broke (overflow / became double)
not a heap number               -> expected a number, saw something else
hole                            -> array hole encountered where packed assumed
insufficient type feedback      -> site never gathered enough feedback to specialize
out of bounds                   -> index/range speculation broke
```

**HotSpot uncommon-trap reasons (selected):**

```text
class_check / class_check2      -> receiver type not the speculated one (devirt bet broke)
null_check                      -> a non-null speculation hit null
range_check                     -> array bounds speculation broke
unstable_if / unstable_fused_if -> a pruned/biased branch was taken
bimorphic / unloaded            -> call site polymorphism / unloaded class
made not entrant                -> code invalidated (often CHA / class load)
```

Pattern: **a stable reason on a stable site = a real, fixable speculation break.** A scatter of different reasons during the first seconds = normal warm-up.

### 3. Anatomy of a deopt storm and how to kill it

A storm has a signature: the **same function**, the **same reason**, **repeating** long after warm-up, with re-optimization in between. Diagnosis loop:

1. **Confirm it's steady-state, not warm-up.** Let the process run; does the deopt keep firing after minutes / millions of iterations?
2. **Get the reason + site.** `--trace-deopt` (V8) or `PrintCompilation`+`TraceDeoptimization` (HotSpot). The reason names the bet; the position names the site.
3. **Find the input that breaks the bet.** `wrong map` → which call path constructs a different shape? `not a Smi` → which path produces a double/overflow? `class_check` → which subclass got introduced?
4. **Stabilize the speculation at the source** — *not* by disabling optimization:
   - shape break → unify construction so one hidden class is produced;
   - SMI break → keep the loop's value domain integer (or move to typed arrays / accept doubles uniformly);
   - megamorphic → split the site by kind into monomorphic sites;
   - CHA break → make the hot method `final` / avoid late class loading on the hot path.
5. **Verify the storm is gone** (deopt count drops to ~warm-up only) and **lock it with a regression test**.

The anti-pattern fix is reaching for `--no-opt`, `-Xint`, or `-XX:-TieredCompilation` to "stop the deopts." That removes the *symptom* by removing the *fast path* — you end up uniformly slow. Fix the *bet*, not the optimizer.

### 4. Warm-up and tier policy as a production concern

Speculation means **your service is slowest right after it starts** and gets faster as it tiers up. This has real operational consequences:

- **Cold-start latency** (serverless, autoscaling, blue/green deploys) is dominated by un-tiered code. A pod that just came up serves interpreter/baseline-speed traffic.
- **Load-balancer warm-up / slow-start** matters: routing full traffic to a freshly-started JVM/Node process hits its un-optimized phase.
- **Benchmarks must run past warm-up**, or you're measuring the wrong tier. Always discard warm-up iterations; report steady state.
- **Tier flags are policy levers** (use sparingly, measure always): `-XX:TieredStopAtLevel`, `-XX:CompileThreshold`, V8 `--max-opt`, `--no-flush-bytecode`; .NET `DOTNET_TieredCompilation`, `DOTNET_TC_QuickJitForLoops`, `DOTNET_TieredPGO`, ReadyToRun for faster startup.

### 5. Guarded devirtualization vs speculative-deopt devirtualization

A subtle cross-engine point. Both HotSpot and .NET want to turn virtual calls into direct/inlinable ones using profile data. The difference:

- **HotSpot** may *speculatively* devirtualize under CHA and **deopt** (uncommon trap) if a new override appears — frame-rewinding fallback.
- **.NET (Dynamic PGO)** emits **guarded devirtualization**: `if (type == ProfiledType) { inlined fast path } else { normal virtual call }`. The fallback is a *branch in the same compiled method*, not a deopt of the frame.

Both are speculative; only one *deoptimizes*. When tuning .NET, you reason about whether PGO captured the right dominant type (so the guard usually hits), not about deopt storms.

### 6. Telemetry: making invisible deopts observable in production

You rarely run production with `--trace-deopt` (it's noisy/expensive). Instead:

- **JVM:** JFR (Java Flight Recorder) events for compilation and deopt; `jcmd Compiler.*`; async-profiler in *wall/CPU* mode shows time in interpreter vs compiled; `-XX:+PrintCompilation` in canary, not fleet-wide.
- **V8/Node:** `--prof` + tick processor (shows time in optimized vs unoptimized), `--log-deopt` in canaries, `perf` + `--perf-prof` for flame graphs that label optimized vs builtin/interpreter frames; `%GetOptimizationStatus` (with `--allow-natives-syntax`) in tests.
- **SpiderMonkey:** `IONFLAGS`, `--ion-offthread-compile`, JIT spew in dev builds.
- **.NET:** EventPipe / `dotnet-trace` with the JIT provider, `DOTNET_JitDisasmSummary`, ETW compilation events; `dotnet-counters` for time-in-JIT.

The professional move is **canary tracing**: enable verbose deopt logging on one instance, capture, analyze, disable — never fleet-wide.

---

## Real-World Analogies

**A factory that keeps re-tooling for the wrong product (deopt storm).** A line is re-tooled to mass-produce one widget super-efficiently (optimize). Then a different widget arrives, the line jams and re-tools for the general case (deopt + re-opt). If the product mix keeps flip-flopping, the line spends all day re-tooling and ships almost nothing. The fix isn't to ban efficient tooling — it's to *sort the inputs* so each line sees a consistent product (stabilize the bet).

**New-hire ramp-up (warm-up).** A new employee is slow on day one — they don't know the shortcuts yet (interpreter). Over weeks they learn the fast paths (tier up). Judging the team's throughput by the new hire's first morning (un-warmed benchmark) is misleading; judge by steady state.

**Four dialects of the same trade (cross-engine vocabulary).** V8 says "bailout," HotSpot says "uncommon trap," SpiderMonkey says "bailout," .NET mostly says "I don't do that, I branch instead." Same craft, different words; a professional speaks all four well enough to diagnose any of them.

---

## Mental Models

### Model 1: The reason code is a root-cause pointer

Don't treat deopt logs as noise. Each reason is a **direct pointer to the broken bet**: `wrong map` → shape, `not a Smi` → numeric domain, `class_check` → devirt target, `range_check` → bounds. Reading reasons turns a vague "it's slow" into a specific "site X bets on Y, input Z breaks Y."

### Model 2: Stabilize the bet, never disable the optimizer

The fix space has two doors. Door A: *disable optimization* (`-Xint`, `--no-opt`) — makes the symptom vanish by making everything uniformly slow. Door B: *stabilize the speculation* — unify shapes, fix the value domain, split megamorphic sites, make methods final. Always take Door B. Door A is only for *diagnosis* (A/B confirmation), never for *production fix*.

### Model 3: Steady state is the only state that matters (mostly)

For long-lived services, optimize and benchmark **steady state**. For short-lived / cold-start-sensitive workloads (serverless, CLIs), **warm-up is the product** — and you switch strategy toward AOT (GraalVM native-image, .NET ReadyToRun/NativeAOT), lower tiers, or keeping processes warm. Know which regime you're in *before* tuning.

### Model 4: .NET is the exception that proves the rule

Holding .NET next to V8/HotSpot sharpens the concept: speculation is universal, but *frame-rewinding deoptimization* is one specific implementation of fallback. .NET shows you can speculate (PGO, guarded devirt) and fall back via *in-method branches* instead. Don't over-generalize "JIT ⇒ deopt storms."

---

## Code Examples

### Example 1: Query a function's optimization status programmatically (V8)

```js
// status.js  —  run with: node --allow-natives-syntax status.js
function work(o) { return o.x + o.y; }

const a = { x: 1, y: 2 };
for (let i = 0; i < 200000; i++) work(a);     // warm up

%OptimizeFunctionOnNextCall(work);
work(a);
console.log('status:', %GetOptimizationStatus(work));  // bitmask: optimized?

// Break the shape and re-check.
work({ y: 1, x: 2, z: 3 });                    // different map
console.log('after shape change:', %GetOptimizationStatus(work));
```

`%GetOptimizationStatus` returns a bitmask you decode (is-optimized, is-turbofanned, is-interpreted, marked-for-deopt…). This is the canonical way to *assert* optimization state in tests so a regression that causes deopt fails CI.

### Example 2: A deopt-count regression guard (Node, conceptual harness)

```js
// guard.test.js (pseudo) — parse --trace-deopt output and assert a ceiling.
const { execSync } = require('child_process');
const out = execSync('node --trace-deopt ./hot-path-bench.js 2>&1').toString();
const deopts = (out.match(/deoptimizing \(DEOPT/g) || []).length;

// Allow a small warm-up budget; fail if a refactor reintroduces a storm.
if (deopts > 25) {
  throw new Error(`Deopt regression: ${deopts} deopts (budget 25). Check shapes/types.`);
}
console.log(`OK: ${deopts} deopts`);
```

The point isn't the exact threshold; it's making deopt count a **measured, asserted** quantity so storms can't silently creep back in.

### Example 3: JVM — confirm a class-load-driven invalidation wave

```bash
# Run with compilation + deopt tracing; correlate "made not entrant" bursts
# with class-loading on the timeline.
java -XX:+UnlockDiagnosticVMOptions \
     -XX:+PrintCompilation -XX:+TraceDeoptimization \
     -Xlog:class+load=info \
     -jar service.jar | tee jit.log

# Then: grep for invalidation bursts and the class loads just before them.
grep -E "not entrant|made zombie" jit.log     # invalidations
grep "class,load" jit.log                       # what loaded around them
```

If invalidation bursts cluster right after batches of `class,load` lines (e.g. lazy framework init, plugin loading, proxy generation), you've found a CHA-invalidation wave. The fix is to *front-load* class loading (warm up the classpath before serving traffic) so invalidation happens once, during warm-up, not under live load.

### Example 4: .NET — observe tiering / PGO instead of deopt

```bash
# Dynamic PGO on; observe tier transitions and disassembly summary.
DOTNET_TieredPGO=1 \
DOTNET_TieredCompilation=1 \
DOTNET_JitDisasmSummary=1 \
dotnet run -c Release

# Trace JIT activity without verbose flags in prod-like runs:
dotnet-trace collect --providers Microsoft-Windows-DotNETRuntime:0x1000:5 -- dotnet myapp.dll
```

Here you're checking that hot methods reached **Tier-1** and that guarded devirtualization picked the right dominant type — *not* hunting frame-rewinding deopts, which the CLR doesn't do in that sense.

### Example 5: Localizing a megamorphic site that lost inlining (V8)

```js
// Run a CPU profile; in the flame graph the hot site shows time in a generic
// "LoadIC"/"CallIC" builtin rather than inlined into the caller -> megamorphic.
node --prof megabench.js
node --prof-process isolate-*.log > processed.txt
// Look for the site spending time in *IC builtins instead of optimized code.
```

Time concentrated in `*IC` builtins (rather than inlined optimized frames) is the fingerprint of a site that went polymorphic/megamorphic and can no longer be inlined or specialized.

---

## Pros & Cons

### Pros (of mastering this at the professional level)

- **You can fix the most opaque perf bugs.** Deopt storms and megamorphic regressions are invisible in source; reason-code literacy makes them tractable.
- **You set sound policy.** Warm-up handling, tier flags, AOT vs JIT, canary tracing — informed, measured decisions instead of cargo-culting flags.
- **You prevent regressions.** Asserting optimization status / deopt counts in CI keeps the fast path fast across refactors.

### Cons / hazards

- **Engine-specific knowledge dates quickly.** V8 added Maglev; HotSpot has Graal; .NET added Dynamic PGO. Reason strings and tier names shift release to release. Re-verify against current docs.
- **Over-tuning for the JIT hurts readability.** Shape-stable, monomorphic, typed-array code can be uglier; apply it only on proven hot paths.
- **Tracing is expensive.** Verbose deopt/compile logging perturbs timing and floods logs; canary it, don't fleet it.
- **Wrong regime, wrong fix.** Optimizing steady state for a cold-start-bound workload (or vice versa) wastes effort. Identify the regime first.

---

## Use Cases

- **Latency regression triage** after a deploy: was a hot site pushed megamorphic, or did class loading trigger an invalidation wave?
- **Throughput tuning** of long-lived services: keep hot paths monomorphic and value-domain-stable; verify scalar replacement / inlining held.
- **Cold-start optimization** for serverless/CLI: AOT (native-image / NativeAOT / ReadyToRun), lower tiers, or process pre-warming.
- **Library design** for a hot ecosystem dependency: ship shape-stable, monomorphic-friendly APIs so *consumers* stay on fast paths.
- **CI performance gates**: assert optimization status and deopt budgets so regressions fail builds.

---

## Coding Patterns

### Pattern 1: Front-load class loading / warm-up before serving traffic

```java
// ✅ Warm the JIT and pre-load classes during readiness, not under live load,
//    so CHA invalidations and tier-up happen once, off the hot path.
void warmUp() {
    for (int i = 0; i < 50_000; i++) handle(syntheticRequest());
}
// Gate readiness/health-check on warm-up completion before the LB routes to you.
```

### Pattern 2: Keep DTO/object shapes uniform across construction sites

```js
// ✅ A single factory yields one hidden class everywhere -> shape-stable consumers.
function makeUser(id, name, email) {
  return { id, name, email };          // always same keys, same order
}
// ❌ Constructing the "same" object with different key orders or optional keys
//    in different code paths spawns multiple maps and pushes consumers poly/mega.
```

### Pattern 3: Type-stable hot numeric loops via typed arrays

```js
// ✅ Fixed representation; no SMI/double churn, no elements-kind transitions.
function dot(a /* Float64Array */, b /* Float64Array */) {
  let s = 0;
  for (let i = 0; i < a.length; i++) s += a[i] * b[i];
  return s;
}
```

### Pattern 4: Split a hot megamorphic dispatch into specialized sites

```js
// ✅ One monomorphic site per kind keeps each inlinable.
const handlers = { a: handleA, b: handleB, c: handleC };
function dispatch(msg) {
  const h = handlers[msg.kind];   // table lookup, then...
  return h(msg);                  // ...each handler sees one concrete shape
}
```

### Pattern 5: Make intentionally-final hot virtuals `final` (JVM)

```java
public final class RouteKey { /* hot, hashed; final removes CHA risk */ }
```

---

## Best Practices

- **Read the reason code first.** It names the broken bet; let it drive the investigation instead of guessing.
- **Fix the bet, never disable the optimizer in production.** Door B (stabilize), not Door A (`-Xint`/`--no-opt`).
- **Measure steady state for services, warm-up for cold-start workloads.** Identify the regime before tuning.
- **Canary your tracing.** Verbose deopt/compile logs on one instance, analyze, disable. Never fleet-wide.
- **Gate readiness on warm-up.** Don't let load balancers send peak traffic to un-tiered processes.
- **Assert optimization state in CI.** `%GetOptimizationStatus` / deopt-count budgets / JFR thresholds turn invisible regressions into red builds.
- **Re-verify engine specifics per release.** Tier names, reason strings, and flags change; treat memorized details as perishable.
- **Know .NET is different.** Reason about tiering, guarded devirt, and PGO, not frame-rewinding deopt storms.

---

## Edge Cases & Pitfalls

### Pitfall 1: "I disabled the JIT and it got slower" — yes, that's expected

Turning off optimization to "stop deopts" removes the fast path entirely. It's a *diagnostic* (does the regression involve the optimizer?), never a fix. Steady-state throughput will drop.

### Pitfall 2: Benchmarking inside warm-up

Microbenchmarks that don't discard warm-up iterations measure interpreter/baseline tiers and lie about steady-state performance. Use a proper harness (JMH on JVM; BenchmarkDotNet on .NET; `tinybench`/manual warm-up on Node) that separates warm-up from measurement.

### Pitfall 3: A profiler/debugger triggering deopt-all

Profiling under a debugger, or with certain instrumentation, forces mass deoptimization so the runtime can present interpreter-level state. Your "profiled" numbers then reflect de-optimized code. Use low-overhead sampling profilers (async-profiler, `perf`, EventPipe) that don't deopt.

### Pitfall 4: Framework-induced megamorphism

ORMs, DI containers, proxies, serializers, and bytecode generators inject extra shapes/types into call sites you believed were monomorphic. The regression appears far from the framework code. Profile the *actual* shapes flowing through the hot site, not the source.

### Pitfall 5: Class-load invalidation under live traffic

Lazy class loading, plugin systems, dynamic proxy generation, and reflective bootstrapping can fire CHA invalidations *during* peak traffic, causing throughput dips. Front-load loading during warm-up.

### Pitfall 6: Treating all engines as V8

Porting a "avoid deopt storms" mental model directly to .NET leads to chasing a pathology that mostly doesn't exist there. Match the model to the engine: deopt-driven (V8/HotSpot/SpiderMonkey) vs branch-guarded (.NET).

### Pitfall 7: Over-tuning cold code

Shape-stabilizing and monomorphizing everything makes a codebase rigid and uglier for zero gain on cold paths. Apply JIT-friendly patterns only where a profiler proves heat and a trace proves instability.

### Pitfall 8: Reason-string drift breaking your log parsers

Deopt/uncommon-trap reason strings are *not* a stable API. A regression-guard parser keyed on exact strings can silently break on an engine upgrade. Parse loosely and re-validate after runtime upgrades.

---

## Cheat Sheet

```text
CROSS-ENGINE     V8: bailout/deopt (maps, elements-kind, FeedbackVector)
                 HotSpot: uncommon trap / "not entrant" (CHA, profiling)
                 SpiderMonkey: bailout (Warp/Ion <-> Baseline)
                 .NET: tiering + guarded devirt + Dyn-PGO; NOT frame-deopt

REASON = ROOT    wrong map->shape | not a Smi->numeric domain | hole->packed
                 class_check->devirt target | range_check->bounds |
                 null_check->non-null bet | insufficient feedback->cold site

STORM SIGNATURE  same function + same reason + repeats AFTER warm-up + re-opt.
                 Fix: stabilize the bet (shape/type/target/domain), then
                 lock with a deopt-count / opt-status regression test.

NEVER FIX BY     -Xint / --no-opt / -XX:-TieredCompilation  (diagnosis only!)

TELEMETRY        JVM: JFR, PrintCompilation+TraceDeoptimization (canary),
                      async-profiler, -Xlog:class+load
                 V8 : --trace-deopt, --prof, --allow-natives-syntax
                      (%GetOptimizationStatus), --perf-prof
                 .NET: dotnet-trace/EventPipe, DOTNET_TieredPGO,
                       DOTNET_JitDisasmSummary

WARM-UP POLICY   services -> tune & bench STEADY STATE; gate LB on warm-up.
                 cold-start -> AOT (native-image / NativeAOT / R2R), keep warm.

INVARIANT        Semantics preserved across every engine. Deopt/bailout/trap =
                 slower, never wrong.
```

---

## Summary

At the professional level, speculation and deopt stop being compiler trivia and become **operational reality**. The flagship pathology is the **deopt storm**: a function trapped in optimize → deopt → re-optimize, burning CPU compiling code it discards, never running fast. You diagnose it by confirming it's steady-state (not warm-up), reading the **deopt reason** — which directly names the broken bet (`wrong map` → shape, `not a Smi` → numeric domain, `class_check` → devirt target, `range_check` → bounds) — localizing the input that breaks the bet, and **stabilizing the speculation at its source**: unify shapes, fix the value domain, split megamorphic sites, make hot virtuals `final`, front-load class loading. The cardinal rule is *fix the bet, never disable the optimizer* — `-Xint`/`--no-opt` is a diagnostic, not a production fix.

You operate across four engines that share the bet/guard core but differ in dialect and aggression: **V8** (bailouts, maps, elements-kinds), **HotSpot** (uncommon traps, CHA, *not entrant*), **SpiderMonkey** (bailouts between Warp/Ion and Baseline), and **.NET** — the instructive exception, which speculates via tiering, **guarded devirtualization**, and **Dynamic PGO** but does **not** frame-rewind-deopt, so its fallbacks are in-method branches rather than storms. You treat **warm-up** as a first-class production concern (gate load balancers on it; choose AOT for cold-start-bound workloads), make deopt observable through **canary tracing and low-overhead profilers**, and lock fixes in with **CI regression guards** that assert optimization status or deopt budgets. Through all of it, the invariant from `junior.md` still holds without exception: every deopt, bailout, and uncommon trap is *slower but correct* — semantics are never traded for speed.
