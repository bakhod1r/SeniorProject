# JIT Compilation & Tiering — Interview Questions

> **Topic:** [JIT Compilation & Tiering](README.md)

---

## Introduction

These questions probe whether a candidate understands what a Just-In-Time compiler actually does, why it can outperform an ahead-of-time compiler on the same source, and how real engines (HotSpot, V8, SpiderMonkey, RyuJIT, LuaJIT, PyPy) implement tiered and tracing compilation. The aim is not trivia. A strong candidate reasons in terms of *profiles* — invocation and back-edge counters, type feedback in inline caches — and explains every speculative optimization as "assume what was observed, guard it, deoptimize if the guard fails." They distinguish warmup from steady state without prompting, they know why megamorphic call sites are catastrophic, and they can connect code-cache exhaustion or a deopt storm to a concrete production incident.

A weaker candidate says "the JIT makes it faster" and "Java is slow at startup" without explaining the mechanism, conflates the interpreter with the optimizing compiler, or believes an AOT compiler must always beat a JIT because "it had more time." The questions below run from foundational concepts, through engine-specific internals, into traps where the obvious answer is wrong, and finish with design scenarios that reveal whether the candidate has actually operated JIT-based systems.

## Table of Contents

- [Conceptual / Foundational](#conceptual--foundational)
- [Engine-Specific](#engine-specific)
- [Tricky / Trap Questions](#tricky--trap-questions)
- [Design Scenarios](#design-scenarios)
- [Cheat Sheet](#cheat-sheet)
- [Further Reading](#further-reading)

---

## Conceptual / Foundational

## Question 1

**Q: What is a JIT compiler, and how does it differ from an interpreter and from an AOT compiler?**

An interpreter executes bytecode one operation at a time, paying dispatch overhead per operation — portable and instant to start, but slow. An AOT (ahead-of-time) compiler translates source to native machine code *before* the program runs, producing fast code with no warmup but with no knowledge of runtime behavior. A JIT (just-in-time) compiler sits between them in the runtime: it starts by interpreting (or quickly baseline-compiling), watches which code runs often, and compiles that *hot* code to native machine code *while the program runs*, guided by profiling data it gathered. The defining difference is timing and information: the JIT compiles late, on demand, and with knowledge of the actual execution that neither the interpreter (which doesn't compile) nor the AOT compiler (which compiled blind) possesses.

## Question 2

**Q: Why can a JIT produce faster code than an AOT compiler given the same source?**

Because it can exploit facts that are true at runtime but unprovable at compile time. An AOT compiler must emit code correct for *every* possible execution: it cannot assume a virtual call's receiver is always `Circle`, that a branch is taken 99.99% of the time, that a collection only holds one element type, or that a class is never subclassed. A JIT observes the running program, sees that these things are *in fact* true, and compiles code specialized to them — protected by a cheap guard. If a guard is ever violated, it deoptimizes and falls back to a safe path. The gap between "correct for all possible executions" (AOT's contract) and "correct for the observed executions plus a guarded fallback" (the JIT's contract) is exactly the optimization headroom the JIT exploits.

## Question 3

**Q: What profiling data does a JIT collect, and how does it use it?**

Primarily three things. **Invocation counters** (how often each method is entered) and **loop back-edge counters** (how often a loop jumps back to its header) decide *what* is hot enough to compile and trigger on-stack replacement. **Type feedback** at call sites and operations — recorded in inline caches — records *which concrete types* showed up, which drives speculative devirtualization, inlining, and type specialization. **Branch profiles** record which way conditionals went, enabling the optimizer to lay out the common path and speculate on rare paths. All of this is collected by the interpreter and the lower compiled tiers, then consumed by the top optimizing tier.

## Question 4

**Q: Explain tiered compilation and why engines use multiple tiers instead of one compiler.**

There is an irreconcilable tension: a compiler that produces excellent code is slow to run, and a compiler that runs fast produces mediocre code. A single compiler can't be both. So engines use several: an interpreter (instant, slowest code), a fast baseline/template JIT (compiles quickly, decent code, gets you off the interpreter), and a slow optimizing JIT (compiles slowly, best code, reserved for the hottest methods). A method climbs the tiers as it proves itself hot, and the lower compiled tiers also gather the profile the top tier needs. This delivers both fast startup *and* high peak throughput, spending the expensive compiler only where it pays.

## Question 5

**Q: What is On-Stack Replacement (OSR) and what problem does it solve?**

OSR solves the long-running-loop problem: a method that is *called* only once but contains a loop that runs millions of times. Its invocation counter never trips, so method-entry-based compilation never fires — but the loop is blisteringly hot. The back-edge counter catches this, and OSR replaces the *running, interpreted loop with a compiled version mid-execution*. The runtime compiles a special version entered at the loop header, maps the live state (loop variable, accumulators, locals) into the compiled code's expected layout, and jumps into the compiled loop at the correct iteration. Without OSR, such loops would be stuck at interpreter speed forever, because there's no future call to trigger normal compilation.

## Question 6

**Q: Why is inlining called the most important JIT optimization?**

Because almost every other optimization depends on it. Inlining pastes a callee's body into the caller, which removes the call overhead but, far more importantly, exposes the callee to the caller's context: constants fold across the boundary, redundant checks merge, types propagate, escape analysis can see the object's whole lifetime, and further inlining chains. A JIT can inline *through virtual calls* (which AOT often cannot) by using the type profile to speculatively inline the dominant target behind a guard. Remove inlining — for example, at a megamorphic site — and the entire downstream optimization tree collapses.

## Question 7

**Q: Walk through speculative devirtualization.**

A virtual call like `shape.area()` dispatches based on the runtime type, so AOT must emit an indirect vtable call and cannot inline. The JIT has the call site's type profile from its inline cache. If the profile shows the receiver is, say, `Circle` 99.99% of the time, the JIT emits: a cheap guard checking `shape.class == Circle`; on success, the *inlined, direct* body of `Circle.area()`; on failure, deoptimization or a slow path. A non-inlinable virtual call has become an inlined, fully-optimizable direct body — correct because guarded. For bimorphic/small-polymorphic sites it emits a few guarded cases; for megamorphic sites it cannot, and falls back to plain dispatch with no inlining.

## Question 8

**Q: What are escape analysis and scalar replacement?**

Escape analysis proves an object never *escapes* the method that created it — never stored where it outlives the call, never returned, never shared with another thread. If it provably doesn't escape, scalar replacement deletes the object entirely and replaces its fields with local variables in registers. The allocation, the GC pressure, and the field-access indirection all vanish. This lets idiomatic code that creates many short-lived temporaries (iterators, small value objects, boxed primitives) run as if it allocated nothing. It's far more powerful in a JIT because inlining (often speculative) lets the JIT see the object's entire lifetime in one compiled region, which AOT frequently cannot.

## Question 9

**Q: What is warmup, and why are the JVM and JavaScript "slow then fast"?**

Warmup is the interval before hot code reaches its top tier. At process start everything is interpreted (slow), then hot methods get baseline-compiled (faster), then the hottest reach the optimizing tier (fast). So the same program speeds up over its first seconds without any code change. People who time a fresh process and conclude "this language is slow" measured warmup, not steady state. It also means a freshly restarted service is slow until it re-warms, which has major consequences for benchmarks, deploys, and serverless cold starts.

## Question 10

**Q: What is the difference between a method JIT and a tracing JIT?**

A method JIT (HotSpot, V8, RyuJIT) compiles whole methods as the unit of compilation. A tracing JIT (LuaJIT, PyPy) compiles hot *loop traces*: it records the exact straight-line path taken through one iteration — following calls into other functions, implicitly inlining them — and compiles that linear trace with **guards** at every decision point. If a guard fails at runtime, control takes a **side-exit** back to the interpreter or another trace. Traces are pre-inlined and branch-free, so the optimizer sees ideal code — excellent for tight numeric loops — but branchy or highly dynamic code explodes into many traces and side-exits and can perform poorly.

## Question 11

**Q: Why does compilation usually happen on a background thread?**

Because compiling — especially in the optimizing tier — is expensive, and blocking execution to compile would stall the program. Engines run the compiler on dedicated background threads (HotSpot's C1/C2 threads, V8's TurboFan/Maglev threads) while the program keeps running the method in its current lower tier. When the compile finishes, future executions are routed to the new code. A consequence is that speedups arrive *asynchronously* — at some unpredictable moment after the threshold trips, not instantly — and a burst of compilation can briefly steal CPU from the application.

## Question 12

**Q: What is range-check (bounds-check) elimination?**

Memory-safe languages bounds-check every array access. In a loop like `for (i=0; i<a.length; i++) a[i]`, the index provably stays in range, so the compiler can remove the per-iteration check (sometimes hoisting a single guarded check out of the loop). The JIT's advantage is that after inlining flattens several methods and type specialization makes the body uniform, the relationship between the index and the array length often becomes statically provable in places AOT couldn't even assemble into one region, and the JIT can speculate on the loop's typical shape and guard the rest.

---

## Engine-Specific

## Question 13

**Q: Describe HotSpot's tiers and the common path a method takes through them.**

HotSpot has the interpreter plus two compilers, C1 (fast "client" compiler) and C2 (heavyweight "server" optimizing compiler), arranged as five tiers: tier 0 (interpreter, with counters), tiers 1–3 (C1 variants — tier 1 no profiling, tier 2 limited, tier 3 full profiling), and tier 4 (C2, fully optimized, consuming the profile). The common path is **0 → 3 → 4**: interpret, then C1-with-full-profiling (runs fast *and* gathers type/branch data), then C2 using that profile. Tiers 1 and 2 are used in special cases — e.g., when the C2 queue is backed up, a method may be parked at tier 1 to avoid tier 3's profiling overhead.

## Question 14

**Q: What do C1 and C2 each do, and why have both?**

C1 (client compiler) compiles fast and applies light optimizations (basic inlining, constant folding, simple loop handling); its job is to get off the interpreter quickly and, at tier 3, to instrument the code for profiling. C2 (server compiler) compiles slowly but applies aggressive, profile-driven optimizations — deep inlining, speculative devirtualization, escape analysis, sophisticated loop transforms — for peak throughput. You have both because no single compiler can be both fast-to-invoke and produce optimal code; tiered compilation uses C1 for startup and C2 for the hottest methods, with C1's tier-3 profiling feeding C2.

## Question 15

**Q: Describe V8's pipeline: Ignition, Sparkplug, Maglev, TurboFan.**

Ignition is the bytecode interpreter where all JS starts and where type feedback first accumulates in inline caches. Sparkplug is a *baseline* JIT doing an almost one-to-one, single-pass bytecode→machine-code translation with essentially no optimization — so cheap that V8 compiles to it eagerly, removing interpreter dispatch overhead. Maglev is a *mid-tier* optimizing JIT (added later) that uses type feedback to produce good code far faster than TurboFan, filling the gap so hot code gets decent optimized code quickly. TurboFan is the *top* optimizing JIT — fully speculative, profile-driven, slowest to compile, fastest output — reserved for the hottest functions.

## Question 16

**Q: What is an inline cache in V8, and what do monomorphic, polymorphic, and megamorphic mean?**

When V8 executes `obj.x` it doesn't statically know `obj`'s type, so it keeps an inline cache at that site recording the object *shape(s)* (hidden class) seen and where `x` lives on each. **Monomorphic** = one shape seen → a fast, specialized, inlinable access. **Polymorphic** = a few shapes → a small set of guarded fast paths. **Megamorphic** = too many shapes → the IC gives up caching and falls back to a slow generic lookup. The IC's recorded shapes *are* the type feedback the optimizer consumes; megamorphic sites block specialization and inlining and are where JIT performance collapses.

## Question 17

**Q: How does SpiderMonkey's pipeline compare?**

SpiderMonkey (Firefox) follows the same multi-tier philosophy with its own names: a C++ bytecode interpreter, then a **Baseline Interpreter**, then a **Baseline JIT** (fast, lightly optimized, collects type information), then **Warp/IonMonkey**, the top speculative optimizing compiler. As in V8 and HotSpot, the lower tiers gather type feedback that the top tier uses for speculative inlining, devirtualization, and type specialization, with deoptimization (called "bailout" in Ion) as the safety net when a speculation is invalidated.

## Question 18

**Q: What is RyuJIT, and is .NET purely JIT?**

RyuJIT is the .NET CLR's just-in-time compiler, which compiles IL (intermediate language) to native code. .NET is *not* purely JIT: it offers AOT-leaning options — **ReadyToRun (R2R)** pre-compiles IL to native at publish time to cut startup/warmup (with a JIT still available for hot paths), and **Native AOT** compiles fully ahead of time to a self-contained native binary with no JIT at all. .NET also has **dynamic PGO** (profile-guided optimization) where the JIT collects profile data and tiers up hot methods, much like HotSpot's tiering — tier-0 quick JIT, then tier-1 fully optimized using the gathered profile.

## Question 19

**Q: How do meta-tracing JITs like PyPy and LuaJIT work?**

Both are tracing JITs that compile hot loop traces rather than methods. LuaJIT traces hot Lua loops directly. PyPy is *meta-tracing*: rather than tracing the user's Python program, its JIT traces the *interpreter* executing the user's program, then specializes that trace — a powerful technique because you write one interpreter and get a JIT "for free" for the language it interprets. Both record a linear trace of one hot iteration, insert guards at every branch and type assumption, and compile it; guard failures cause side-exits. They excel at tight loops and struggle with branchy, highly dynamic control flow.

## Question 20

**Q: How do you observe what HotSpot and V8 are doing?**

On HotSpot: `-XX:+PrintCompilation` prints each compilation event with its tier (a `%` marks OSR, `made not entrant` marks a superseded version); `-XX:+PrintInlining` (with `-XX:+UnlockDiagnosticVMOptions`) shows inlining decisions; `-XX:+PrintAssembly` (with hsdis) dumps the generated machine code; JFR and async-profiler give production-grade views including deopt and code-cache events. On V8/Node: `--trace-opt` and `--trace-deopt` print optimization and deoptimization events; `--print-opt-code` dumps optimized code; `%GetOptimizationStatus` (with `--allow-natives-syntax`) inspects a function's tier. These flags turn "the JIT is magic" into observable, debuggable behavior.

---

## Tricky / Trap Questions

## Question 21

**Q: Your microbenchmark reports a function runs in 0 ms. What happened?**

Almost certainly dead-code elimination. If the benchmark computes a result and never uses it, the JIT is free to delete the entire computation under the as-if rule — there's no observable effect — and you time nothing. The fix is to *consume* the result: print it, accumulate it into a sink, return it from a `@Benchmark` method, or use a blackhole (JMH provides one). A related trap is failing to warm up: timing a single call measures the interpreter, not the JIT. Real benchmark harnesses (JMH, benchmark.js) force warmup and consume results precisely to avoid these two traps.

## Question 22

**Q: "An AOT compiler always beats a JIT because it had unlimited compile time." True or false?**

False, and the reasoning is the trap. Compile *time* isn't the binding constraint — *information* is. An AOT compiler with infinite time still cannot prove that a virtual call's receiver is always one type, that a branch is essentially never taken, or that an object never escapes through a path that depends on runtime data — because those facts may be false on some execution, and AOT must be correct for all of them. A JIT observes the actual execution and specializes behind guards. For long-running, dynamic, or type-erased code, the JIT routinely beats AOT in peak throughput. AOT wins on *startup and warmup*, which is a different axis.

## Question 23

**Q: A hot loop runs fast inside a long-running call but slow when the method is called fresh. Why?**

Likely OSR. The long call's loop tripped the back-edge counter and was replaced mid-flight by an OSR-compiled version — but OSR code is entered at the loop header and is slightly *less* optimal than a normally-entered tier-4 method. When the method is later called fresh (entered at the top), it may run a different compiled version, or not yet be compiled at all, hence different timing. To measure true peak, call the method normally many times so it reaches normal (non-OSR) top-tier compilation, rather than relying on one giant OSR'd call.

## Question 24

**Q: Adding a single new subclass to a hierarchy suddenly halved throughput across an unrelated part of the service. How?**

A hot call site that was monomorphic (or small-polymorphic) on that hierarchy went **megamorphic** when the new subtype started flowing through it. Megamorphic sites can't be speculatively devirtualized or inlined, so the JIT falls back to generic dispatch — and because inlining was the keystone, every downstream optimization at that path collapses (no constant folding across the boundary, no escape analysis, etc.). The change is invisible in the local source and spread thinly in CPU profiles; you need inlining/IC tooling to diagnose it. This is a classic real-world regression.

## Question 25

**Q: You see repeated `deoptimizing` lines for the same hot function in V8's trace. Is that normal?**

A *single* deopt is normal and healthy — it means a speculative assumption was invalidated and the runtime correctly fell back to re-profile. *Repeated* deopt-then-reoptimize on the same hot method is a **deopt storm**: a pathology where a guard keeps failing, so the function endlessly optimizes and bails, burning CPU on recompilation and running slow in between. The cause is genuinely unstable types or branches on the hot path (e.g., a value that flips between int and string), or profile pollution from unrepresentative warmup. The fix is upstream — stabilize the data or accept the general path — not a compiler flag.

## Question 26

**Q: Your JVM service was fast for a week, then throughput suddenly dropped by half with nothing in the application logs. What's a prime suspect?**

Code-cache exhaustion. The JIT installs all generated machine code into a fixed-size code cache; when it fills, HotSpot can disable the compiler (`CodeCache is full. Compiler has been disabled.`) and affected methods fall back to the interpreter — a throughput cliff with no app-level explanation. Causes include a large or growing code footprint (frameworks, generated proxies/lambdas, heavy reflection) outgrowing the default size. Diagnosis: `jcmd <pid> Compiler.codecache` and the `CodeCache` JMX pool. Remedy: monitor occupancy, alert before saturation, and raise `ReservedCodeCacheSize` based on observed working set.

## Question 27

**Q: In V8, why might `for (const x of arr) f(x.value)` be slow even though it looks trivial?**

Because the objects in `arr` may have *unstable shapes*. If they were constructed inconsistently — properties added conditionally, in different orders, or deleted later — they have different hidden classes, so the inline cache at `x.value` goes polymorphic or megamorphic, defeating specialization and inlining of `f`. The source looks identical to the fast case; the only difference is shape stability. The fix is to give every object the same shape: initialize all fields in the constructor, in one order, and never add or delete properties afterward.

## Question 28

**Q: Why might lowering compile thresholds to "warm up faster" make things worse?**

Lower thresholds compile methods sooner, including methods that turn out *not* to be hot, wasting compiler CPU and code-cache space on code that won't be reused — especially harmful in short-lived processes. It can also compile methods before their profile is mature, leading to mis-specialization and later deopts. And the extra compiler-thread activity competes with the application for cores, which can *increase* latency during the very startup window you were trying to improve. The defaults balance these effects; lowering thresholds is a hypothesis that must be validated against the real workload, not an obvious win.

## Question 29

**Q: `final` is "just an API hint," so removing it is safe for performance. Right?**

No. On the JVM, a `final` method (or a method on a `final` class) is *statically* devirtualizable — the JIT (and sometimes even tooling) knows there can be no override, so it can inline directly without a speculative guard. Removing `final` turns that into a virtual call that now depends on speculation (and the type profile), and if a framework starts generating subclasses, the site can go polymorphic or megamorphic, losing the inline entirely. So "removing `final` for flexibility" can quietly regress a hot path with no obvious cause.

---

## Design Scenarios

## Question 30

**Q: You're deploying a latency-sensitive JVM service across a large fleet. Design the deploy to avoid warmup-induced brownouts.**

Treat warmup as a deploy property. (1) **Never cold-restart the whole fleet at once** under load — roll instances so warm capacity always covers traffic while new instances warm. (2) **Pre-warm** each new instance: drive its hot paths with representative synthetic traffic *before* attaching it to the load balancer, converting user-visible cold-start latency into invisible startup time. (3) **Use representative warmup data** so the JIT doesn't mis-specialize on synthetic types and then deopt under real traffic. (4) **Monitor JIT signals** (compilation rate, code-cache occupancy, deopt rate) during rollout. (5) Consider **CRaC/checkpoint-restore** to restore an already-warmed process and skip warmup entirely on restart.

## Question 31

**Q: A serverless function written for the JVM has unacceptable cold-start latency and high cost. What do you do?**

Recognize that the function dies deep in warmup — interpreted or barely baseline-compiled — and re-pays warmup on every cold start, so the JIT's investment is never recouped. The structural fix is to **change the compilation model to match the process lifetime**: compile ahead-of-time with **GraalVM Native Image** (millisecond startup, flat warmup-free profile) accepting lower peak throughput (irrelevant for a 300 ms function) and the closed-world constraints (configure reflection/dynamic loading). Alternatives: **CRaC/SnapStart** to restore a warmed snapshot, or `-XX:TieredStopAtLevel=1` to skip the expensive C2 compiles the function would never benefit from. Validate the choice by measuring cold-path latency on the real platform.

## Question 32

**Q: How would you guard against a future code change silently making a critical hot path megamorphic and regressing performance?**

Encode "this hot call must inline / stay monomorphic" as an automated invariant. In CI, run a warmup of the hot path, then assert from JFR compiler events or `-XX:+PrintInlining` output (or V8's `%GetOptimizationStatus`) that the critical call inlined; fail the build if it didn't. This converts a fragile, invisible runtime property into a testable guarantee, so a change that adds a fourth subtype to a hot hierarchy or injects proxies fails CI rather than surfacing as a mysterious latency regression in production. Pair it with code-review awareness that new implementation types on hot hierarchies are performance-sensitive.

## Question 33

**Q: You must decide between a JIT runtime and an AOT-compiled binary for a new service. What's your decision framework?**

Key the decision to **process lifetime and dynamism**, not to peak-throughput benchmarks alone. Long-lived, throughput-bound, dynamic (reflection, plugins, dynamic loading) → **JIT**: it warms up once and runs at peak essentially forever, and AOT's constraints would hurt. Short-lived, startup/latency-bound, closed-world (CLI tool, serverless handler) → **AOT** (Native Image / Native AOT): instant start, no warmup, smaller footprint, flat latency, at the cost of peak throughput the process never reaches anyway. Restart-heavy but warmup-expensive and dynamic → consider **checkpoint-restore (CRaC)**. Quantify warmup duration and cold-start frequency, check whether the app's dynamism survives AOT's closed-world assumption, and validate on the production container shape.

## Question 34

**Q: A team proposes copying a set of `-XX` JIT flags from a popular blog post to "speed up" the service. How do you respond?**

Push back: every tuning flag is an unproven hypothesis, and the tiered defaults encode substantial expertise that most tuning regresses. Blog-post flags are tuned for *someone else's* workload, hardware, and container shape — a custom `ReservedCodeCacheSize` smaller than your working set can *cause* code-cache exhaustion; aggressive threshold changes can trigger mis-specialization or deopt churn; pinned compiler-thread counts can starve request handlers on small containers. Require a controlled before/after measurement on the real workload and the production container shape for *each* flag, and keep only flags that improve a metric you actually care about. Default-first, evidence-driven, one flag at a time.

---

## Cheat Sheet

| Concept | One-liner |
|---------|-----------|
| **JIT vs AOT** | JIT may assume what it *observed* + guard it + deopt on violation; AOT must be correct for *all* executions. |
| **Why JIT can win** | It exploits runtime facts (dominant type, hot branch, non-escape) AOT can't prove statically. |
| **Tiered compilation** | Interpreter → fast baseline (good startup) → optimizing JIT (good peak); lower tiers also profile. |
| **HotSpot tiers** | 0 interpreter → 3 C1+profiling → 4 C2; back-edge counter + OSR handle hot loops. |
| **V8 pipeline** | Ignition (interp) → Sparkplug (baseline) → Maglev (mid) → TurboFan (top), type feedback in ICs. |
| **Profiling inputs** | Invocation counters, back-edge counters, type feedback (inline caches), branch profiles. |
| **OSR** | Replace a still-running hot loop with compiled code mid-flight; marked `%` in PrintCompilation. |
| **Inlining** | The keystone; enables devirtualization, EA, specialization, loop transforms. |
| **Speculative devirtualization** | Profiled virtual call → guarded inlined direct call. |
| **Escape analysis + scalar replacement** | Non-escaping object → fields in registers → zero allocation. |
| **Range-check elimination** | Remove provably-in-range array bounds checks. |
| **Monomorphic/poly/megamorphic** | 1 / few / too-many types at a site; megamorphic kills inlining. |
| **Method vs tracing JIT** | Compile whole methods (HotSpot/V8) vs hot loop traces with guards + side-exits (LuaJIT/PyPy). |
| **Warmup** | Slow until hot code hits top tier; kills short-lived/serverless processes → drove AOT. |
| **Code cache** | Fixed-size store for compiled code; full → fallback to interpreter (throughput cliff). |
| **Deopt storm** | Repeated optimize/deopt churn from unstable assumptions; an incident, not a flag fix. |
| **Tuning levers** | `TieredStopAtLevel`, compile thresholds, `ReservedCodeCacheSize`, `CICompilerCount`, V8 `--no-opt`/`--jitless` — defaults-first. |
| **AOT alternatives** | GraalVM Native Image, .NET Native AOT/ReadyToRun, CRaC checkpoint-restore. |
| **Observe it** | HotSpot `-XX:+PrintCompilation`/`+PrintInlining`; V8 `--trace-opt`/`--trace-deopt`; LuaJIT `-jdump`. |

---

## Further Reading

- HotSpot tiered-compilation and `-XX` flag documentation; the OpenJDK wiki on C1, C2, inlining, and escape analysis.
- V8 blog: Ignition + TurboFan, Sparkplug, Maglev; "An Introduction to Speculative Optimization in V8."
- SpiderMonkey docs (Baseline Interpreter, Baseline JIT, Warp/IonMonkey) and .NET docs on RyuJIT, dynamic PGO, ReadyToRun, and Native AOT.
- LuaJIT `-jdump` documentation and the PyPy meta-tracing papers.
- "Optimizing Java" and JMH documentation for benchmarking, warmup, and diagnosing inlining/EA/BCE in practice.
- The junior, middle, senior, and professional tiers of this topic for the full progression from "what a JIT is" to "how to operate one in production."
