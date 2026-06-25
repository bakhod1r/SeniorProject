# JIT Compilation & Tiering — Middle Level

> **Topic:** [JIT Compilation & Tiering](README.md)
> **Focus:** The real tier pipelines — HotSpot's interpreter→C1→C2 and V8's Ignition→Sparkplug→Maglev→TurboFan — the counters and thresholds that move code between them, on-stack replacement, and the difference between method JITs and tracing JITs.

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
13. [Summary](#summary)
14. [Further Reading](#further-reading)

---

## Introduction

> Focus: **How does a method actually travel up the tiers, and what data does it collect along the way?** And **why do production engines use three or four tiers instead of just "interpret or compile"?**

At junior level the picture was a two-rung ladder: interpret, then compile. The reality in shipping engines is a **multi-stage pipeline**, and the stages exist to resolve a genuine conflict. A compiler that produces excellent machine code is slow to run; a compiler that runs fast produces mediocre code. You cannot have one compiler that is both fast to invoke and produces optimal output — those are opposing goals. So engines use *several* compilers, each tuned for a different point on the speed-of-compilation versus quality-of-output curve, and they move each method to the tier that matches how hot it has become.

There is a second, subtler reason for the middle tiers: **profiling**. The top optimizing compiler does its best work when it has accurate data about the program — which types flow through each call site, which branches are taken, how often loops spin. That data has to be *collected somewhere*. The interpreter and the lower compiled tiers do double duty: they execute the code *and* they instrument it, recording the profile that the top tier will later consume. A method does not jump straight from cold to fully-optimized; it spends time in a profiling tier, generating the evidence that justifies (and guides) the expensive final compile.

This page makes the abstract "tiers" concrete by walking through the two engines you are most likely to encounter — the JVM's HotSpot and the browser's V8 — naming their actual tiers, their counters, and their thresholds. It then covers on-stack replacement properly and introduces the other major JIT architecture, the **tracing JIT** (LuaJIT, PyPy), which compiles *hot loops as linear traces* rather than *hot methods*.

> 🎓 **Why this matters at middle level:** Once you understand the specific tiers, performance behavior stops being mysterious. "Why is my function fast in the loop but slow when called fresh?" "Why did it speed up *twice*?" "Why does V8 sometimes get faster, then slower, then faster again?" Each of these maps directly to a tier transition. You move from "the JIT is magic" to "I can predict roughly which tier my code is in and why."

---

## Prerequisites

- **Required:** The junior-level model: interpreter, hot code, counters, the fast-rough/slow-good trade-off, basic OSR, and warmup.
- **Required:** Comfort reading `-XX:+PrintCompilation` output and Node's `--trace-opt` output at a surface level.
- **Required:** Knowing what bytecode is and that the JVM and V8 both compile from a bytecode/IR, not from source.
- **Helpful:** Familiarity with the idea of an *inline cache* at a call site (we connect to it here) — even if only the name.
- **Helpful:** A rough sense of what a control-flow loop "back edge" is.

You do **not** yet need:

- The internals of each optimization pass (inlining, escape analysis, range-check elimination) — that is `senior.md`.
- Code-cache sizing, eviction policy, and production warmup engineering — that is `professional.md`.
- The mechanics of how deoptimization rebuilds interpreter frames — its own topic; we only point at the handoff.

---

## Glossary

| Term | Definition |
|------|-----------|
| **C1 (client compiler)** | HotSpot's fast baseline compiler. Compiles quickly, applies light optimizations, and (at some tiers) inserts profiling instrumentation. |
| **C2 (server compiler)** | HotSpot's heavyweight optimizing compiler. Slow to run, produces the fastest code, consumes the profile gathered earlier. |
| **Tier 0–4 (HotSpot)** | Tier 0 = interpreter; tiers 1–3 = C1 variants (3 also profiles); tier 4 = C2. A method's lifecycle is a path through these numbers. |
| **Ignition** | V8's bytecode interpreter. Also where early type-feedback profiling begins. |
| **Sparkplug** | V8's fast baseline JIT. A near-one-to-one bytecode→machine-code compiler; almost no optimization, near-instant to produce. |
| **Maglev** | V8's mid-tier optimizing JIT (newer). Faster to compile than TurboFan, produces good (not maximal) code; fills the gap between baseline and top tier. |
| **TurboFan** | V8's top optimizing JIT. Speculative, profile-driven, slow to compile, fastest output. |
| **Invocation counter** | Per-method tally of how many times the method was entered. Drives method-level tier-up. |
| **Back-edge counter** | Per-loop tally of how many times control jumped back to the loop header. Drives OSR and catches hot loops in rarely-called methods. |
| **Type feedback** | Recorded observations of which concrete types appeared at a call site or operation. The raw material for speculative optimization. Lives in inline caches. |
| **Inline cache (IC)** | A small per-call-site cache recording the type(s) seen there and the resolved target. Monomorphic (1 type), polymorphic (a few), or megamorphic (too many → gives up). |
| **OSR (On-Stack Replacement)** | Switching an *already-running* loop from a lower tier to a compiled version mid-execution, transferring live state. |
| **Method JIT** | Compiles whole methods as the unit of compilation (HotSpot, V8, RyuJIT). |
| **Tracing JIT** | Compiles hot *loop traces* — a single recorded straight-line path through possibly many methods — as the unit (LuaJIT, PyPy). |
| **Trace / guard / side-exit** | A tracing JIT records a linear path (trace) and inserts guards; if a guard fails at runtime, control takes a side-exit back to the interpreter or another trace. |
| **Background compilation** | Running the optimizing compiler on a separate thread so the program keeps executing (interpreted or in a lower tier) while it compiles. |
| **Compilation queue** | The list of methods waiting to be compiled; compiler threads pull from it by priority/heat. |
| **OSR threshold** | The back-edge count at which a still-running loop is replaced with compiled code. |

---

## Core Concepts

### 1. HotSpot's pipeline: interpreter → C1 → C2

The JVM ships with two compilers and an interpreter, organized into five tiers. The key is that **C1 and C2 are different tools for different jobs**:

- **C1 (the "client" compiler)** is fast. It does simple optimizations (basic inlining, constant folding, simple loop handling) and emits machine code quickly. Its job is to get you off the interpreter fast.
- **C2 (the "server" compiler)** is slow but produces the best code. It does aggressive inlining, escape analysis, sophisticated loop optimization, and speculative optimization driven by profiles. Its job is peak throughput.

The five tiers in default (tiered) mode:

| Tier | What runs the code | Profiling? | Speed of code |
|------|--------------------|-----------|---------------|
| 0 | Interpreter | Yes (counters) | Slowest |
| 1 | C1, no profiling | No | Fast |
| 2 | C1, limited profiling | Some | Fast |
| 3 | C1, **full profiling** | Heavy | Fast-ish (instrumentation costs) |
| 4 | C2, fully optimized | No (consumes profile) | Fastest |

The *common* path is **0 → 3 → 4**: a method runs interpreted (tier 0), gets compiled by C1 with full profiling (tier 3) so it both runs fast *and* gathers type/branch data, and once it is hot enough — and a rich profile exists — C2 compiles it to tier 4 using that profile. Tiers 1 and 2 are used in special situations (for example, when the C2 queue is backed up, a method may be parked at tier 1 to avoid the profiling overhead of tier 3).

This is the crucial insight: **tier 3 exists to profile.** The fast C1 code at tier 3 deliberately carries instrumentation so that when C2 runs later, it is not guessing — it has a histogram of what really happened.

### 2. HotSpot counters and thresholds

Each method has an **invocation counter** and a **back-edge counter**. The decision to compile combines them. Roughly, when

```text
invocation_count + back_edge_count > threshold
```

the method is queued for the next tier. The exact thresholds are tunable (`-XX:Tier3InvocationThreshold`, `-XX:Tier4InvocationThreshold`, `-XX:CompileThreshold`, and others), but the principle is what matters: **two signals, combined, decide heat.** The back-edge counter is what lets a loop-heavy method that is only *called* once still get compiled.

When a tier-4 (C2) compile is queued, the method keeps running at tier 3 in the meantime — the compile happens on a **background thread**. When it finishes, future calls are routed to the new tier-4 code.

### 3. V8's pipeline: Ignition → Sparkplug → Maglev → TurboFan

V8 (Chrome, Node.js, Edge) evolved into a four-stage pipeline:

- **Ignition** — the bytecode interpreter. All JS starts here. Ignition also begins collecting **type feedback** in inline caches.
- **Sparkplug** — a *baseline* JIT. It does an almost mechanical, one-pass translation of Ignition bytecode to machine code with essentially no optimization. It is so fast to run that V8 can compile to it eagerly. The win is removing interpreter dispatch overhead without paying for real optimization.
- **Maglev** — a *mid-tier* optimizing JIT (added later). It uses the collected type feedback to produce good code much faster than TurboFan can, filling the gap so hot code gets *decent optimized* code quickly rather than waiting for the slow top tier.
- **TurboFan** — the *top* optimizing JIT. Fully speculative, profile-driven, the slowest to compile and the fastest output. Reserved for the hottest functions.

The same theme as HotSpot, with more rungs: cheap-and-fast to expensive-and-excellent, with profiling (type feedback in ICs) accumulating along the way and feeding the higher tiers. SpiderMonkey (Firefox) follows the same idea with its own names (interpreter → Baseline Interpreter → Baseline JIT → Warp/IonMonkey).

### 4. Type feedback and inline caches (the bridge to optimization)

Dynamic languages do not know types ahead of time. When V8 sees `obj.x`, it does not know what `obj` is. So at that **call/property site** it keeps an **inline cache**: the first time, it looks up where `x` lives on `obj`'s shape and records it. Next time, if `obj` has the same shape, it uses the cached answer — fast.

The IC records *which shapes/types showed up*. That recording **is** the type feedback. A site that always sees one shape is **monomorphic** — the optimizer can compile a direct, specialized access and even speculatively inline the method. A site that sees a handful of shapes is **polymorphic** — the optimizer handles a few cases. A site that sees many shapes is **megamorphic** — the IC gives up caching, and the optimizer cannot specialize; it must emit a slow generic lookup. **Megamorphic sites are where JIT performance goes to die**, because they defeat the inlining that everything else depends on. (This connects directly to the senior-level optimizations.)

HotSpot does the analogous thing for virtual calls: it records the receiver types seen at a call site (its "type profile"), enabling C2 to *speculatively devirtualize* — turn `shape.area()` into a direct call to `Circle.area`, guarded by a type check.

### 5. On-Stack Replacement, properly

Recall the problem: a method with a hot loop that is only *called* once. Its invocation counter never trips, but its back-edge counter does. We must replace the running loop without waiting for re-entry.

OSR works like this:

1. The back-edge counter crosses the **OSR threshold**.
2. The runtime compiles a special **OSR version** of the method, entered *at the loop header* rather than at the method start, and parameterized by the live state at that point.
3. The runtime maps the current interpreter (or lower-tier) frame's live values — loop counter, accumulators, locals — into the layout the compiled code expects.
4. Execution jumps into the compiled loop at the correct iteration. The loop continues, now compiled.

OSR code is slightly less optimal than a normally-entered compiled method (it has constraints from being entered in the middle), but it rescues exactly the long-running-loop case that would otherwise be stuck slow forever. In `-XX:+PrintCompilation` output, OSR compilations are marked with a `%` sign — that is how you spot them.

### 6. Background compilation

Compilation is expensive, so engines run it **off the main execution thread**. HotSpot has dedicated C1 and C2 compiler threads; V8 has background compile threads for TurboFan/Maglev. While a method is queued and being compiled, the program keeps running it in the current (lower) tier. When the compile lands, execution switches over. This is why a tier-up is *asynchronous*: you keep running, and at some unpredictable later moment your code gets faster. It is also why a sudden burst of compilation can briefly steal CPU from the application — the compiler threads are competing for cores.

### 7. Method JITs versus tracing JITs

Everything above compiles **whole methods**. There is a different architecture: the **tracing JIT** (LuaJIT, PyPy, and the historical TraceMonkey). Its unit of compilation is not a method but a **hot loop trace**:

1. The interpreter counts loop iterations. When a loop gets hot, the JIT enters **recording mode**.
2. It records the *exact straight-line path* taken through one iteration — following calls *into* other functions, inlining them implicitly, and noting every decision (this branch, this type) as a **guard**.
3. It compiles that linear trace into tight machine code with the guards baked in.
4. On subsequent iterations, the compiled trace runs. If reality diverges from a guard (a branch goes the other way, a type differs), control takes a **side-exit** back to the interpreter or to another trace.

The appeal: a trace is already inlined and free of unrelated branches, so the optimizer sees a clean, straight piece of code. The cost: traces are linear, so code with many unpredictable branches produces a tangle of traces and side-exits, which can perform poorly. Method JITs and tracing JITs are two answers to the same question — *what is the right granularity to compile?* — with different sweet spots.

---

## Real-World Analogies

**The translation office (method JIT).** A document arrives. A junior translator does a quick rough pass (Sparkplug / C1) so something readable exists immediately. The office tracks which documents get requested most. The most-requested ones go to a senior translator who produces a polished version (TurboFan / C2), using notes the junior left about tricky terms (the profile). Rarely-requested documents never reach the senior translator — not worth it.

**The relay racer learning the track (tracing JIT).** A runner does one lap following every sign and marker (interpreter recording the trace). Having run it once, they memorize the exact line through every corner and run it flat-out without reading signs (compiled trace). But if the course changes — a barrier appears where they expected open track (guard failure) — they have to stop, look around, and rejoin the marked route (side-exit). Brilliant when the course is stable, awkward when it keeps changing.

**The escalating support queue.** A support ticket starts with the bot (interpreter). Common tickets get a canned macro reply (baseline JIT) instantly. The genuinely frequent, high-value tickets get escalated to a specialist who writes a thorough solution (optimizing JIT) informed by the history of similar tickets (the profile). The system spends expert time only where volume justifies it.

---

## Mental Models

**Model 1 — The tier number is a confidence level.** Each tier transition reflects the runtime becoming more *confident* that a method deserves investment. Tier 0: "no opinion yet." Tier 3 (C1+profiling): "this is warm; run it decently and gather evidence." Tier 4 (C2): "this is genuinely hot and I have evidence; spend everything." Profiling is literally how confidence is built.

**Model 2 — Profile-then-exploit.** The pipeline has two phases for any hot method: a *profiling phase* (run it while instrumented, in the interpreter and the profiling tier) and an *exploitation phase* (compile it with that profile in the top tier). The middle tiers exist to make the profiling phase fast enough that you do not suffer in the interpreter while collecting data.

**Model 3 — The inline cache is the JIT's memory.** Every call site has a little notebook (its IC) of "who showed up here and what type were they." Monomorphic = one name in the notebook = the optimizer can hard-wire it. Megamorphic = too many names = the optimizer throws up its hands. When you reason about JIT performance, ask "what does this site's notebook look like?"

**Model 4 — Method vs trace is a granularity dial.** Turn the dial toward "method" and you compile self-contained chunks with clear boundaries (good for branchy code, easier to reason about). Turn it toward "trace" and you compile straight-line hot paths that cross method boundaries freely (great for tight numeric loops, fragile under branchy/dynamic control flow). Neither is universally better.

---

## Code Examples

### Example 1 — Watching HotSpot tier transitions

```java
public class Tiers {
    static int hash(int x) {
        // Small enough to inline; called in a hot loop below.
        return (x * 2654435761L >>> 13) ^ x;
    }
    static long run(int n) {
        long acc = 0;
        for (int i = 0; i < n; i++) acc += hash(i);
        return acc;
    }
    public static void main(String[] args) {
        long acc = 0;
        for (int r = 0; r < 50; r++) acc += run(2_000_000);
        System.out.println(acc);
    }
}
```

Run:

```bash
java -XX:+PrintCompilation Tiers
```

Read the third column (the tier). You will typically see `run` and `hash` first compiled at tier 3, then later recompiled at tier 4 — that 3→4 jump is C1-with-profiling handing off to C2. Lines containing a `%` are OSR compilations (the big loop in `run` being replaced mid-flight on the first long call). Lines marked `made not entrant` mean an old compiled version was retired in favor of a newer one.

### Example 2 — Forcing a single tier to see the difference

```bash
# Interpreter + C1 only (no C2): fast start, lower peak throughput.
java -XX:TieredStopAtLevel=1 Tiers

# Disable tiering entirely, go straight to C2: slow start, high peak.
java -XX:-TieredCompilation -XX:+UnlockDiagnosticVMOptions Tiers

# Default tiered.
java Tiers
```

Time the steady-state phase of each. `TieredStopAtLevel=1` starts quickly but tops out slower; pure-C2 starts slowly but reaches a high peak. Default tiered tries to get both. This experiment *is* the architecture, demonstrated.

### Example 3 — Watching V8 optimize and the cost of polymorphism

```js
// poly.js
function getX(o) { return o.x; }   // the IC at o.x is what we are probing

function bench(objects, iters) {
  let sum = 0;
  for (let i = 0; i < iters; i++) {
    for (const o of objects) sum += getX(o);
  }
  return sum;
}

// Monomorphic: every object has the SAME shape.
const mono = Array.from({length: 1000}, (_, i) => ({ x: i }));

// Megamorphic: many different shapes flow through the same site.
const mega = Array.from({length: 1000}, (_, i) => {
  const o = { x: i };
  o['k' + (i % 50)] = i;   // 50 distinct shapes
  return o;
});

console.time('mono'); bench(mono, 5000); console.timeEnd('mono');
console.time('mega'); bench(mega, 5000); console.timeEnd('mega');
```

```bash
node --trace-opt poly.js          # see getX/bench get optimized
```

The monomorphic run is dramatically faster. Same function, same loop — the *only* difference is whether the inline cache at `o.x` stayed monomorphic or went megamorphic, defeating specialization and inlining. This is the single most important practical lesson about dynamic-language JITs.

### Example 4 — Seeing the deopt handoff (prose connection)

```bash
node --trace-opt --trace-deopt poly.js
```

If you feed a function objects of one shape (so it optimizes), then suddenly a new shape, V8 prints a `deoptimizing` line: the optimized code's assumption was violated, so the runtime discards it and falls back to a lower tier, where it re-profiles. This is the *handoff* to deoptimization — a separate topic — but you can see exactly where the tiering story ends and the deopt story begins.

### Example 5 — Inspecting a tracing JIT (LuaJIT)

```lua
-- sum.lua
local function work(n)
  local s = 0
  for i = 1, n do s = s + (i * 31) end
  return s
end
local acc = 0
for r = 1, 100 do acc = acc + work(2000000) end
print(acc)
```

```bash
luajit -jdump sum.lua     # dumps the recorded traces and their machine code
```

`-jdump` shows LuaJIT *recording a trace* for the hot loop and the guards it inserted. You are watching a fundamentally different JIT model — loops compiled as straight-line traces — instead of HotSpot/V8's whole-method compilation.

---

## Pros & Cons

**Multi-tier method JIT (HotSpot, V8)**

- *Pros:* smooth ramp from fast-start to high-peak; profiling tier makes the top tier's decisions accurate; method boundaries make reasoning and deopt tractable; handles branchy code well.
- *Cons:* more compiler implementations to build and maintain; tier transitions cause unpredictable timing; profiling instrumentation has runtime cost; megamorphic sites blunt the whole pipeline.

**Tracing JIT (LuaJIT, PyPy)**

- *Pros:* traces are pre-inlined and branch-free, so the optimizer sees ideal straight-line code; spectacular on tight numeric loops; relatively small implementation for the peak performance achieved.
- *Cons:* branchy or highly dynamic code explodes into many traces and side-exits; trace selection can pick a bad path; harder to reason about which trace is running; pathological cases ("trace blow-up") degrade badly.

> 🎓 The recurring trade-off across all of these is **granularity and timing of the bet.** More tiers = finer control over when to spend compilation effort. Tracing = bet on a whole hot path being stable. Each design is choosing *what to assume* and *when to commit*.

---

## Use Cases

- **HotSpot / C2:** long-lived JVM servers (Kafka, Cassandra, Spring services) where peak throughput over hours dominates.
- **V8 full pipeline:** browser web apps and Node services kept warm; the baseline tiers (Sparkplug/Maglev) specifically improve *interactive* and *short-burst* latency by getting off the interpreter sooner.
- **Tracing JITs:** numeric and scripting workloads with tight loops — LuaJIT in games and networking (OpenResty), PyPy for compute-bound Python where loops dominate.
- **Tier control in practice:** `-XX:TieredStopAtLevel=1` is sometimes used for short-lived JVM tools/CLIs to skip the expensive C2 compiles they would never benefit from — trading peak throughput for faster startup.

---

## Coding Patterns

**Pattern 1 — Keep hot call sites monomorphic.** Pass one concrete type through a hot site. In JS, construct objects with a *consistent shape* (same properties, same order, set in the constructor) so the IC stays monomorphic. In Java, avoid hot virtual calls with many receiver types where a single type would do.

**Pattern 2 — Initialize object shape once and don't mutate it.** In V8, adding properties later, or deleting properties, changes an object's hidden class and can poison the inline caches that touch it. Define the full shape up front.

**Pattern 3 — Don't defeat OSR with weird loop structure.** Plain counted loops OSR cleanly. Bizarre control flow (a loop that re-enters itself through exceptions, say) can prevent the runtime from compiling and replacing it. Keep hot loops conventional.

**Pattern 4 — Let warmup happen before you measure tiers.** When investigating performance, run long enough for tier-4/TurboFan to land, then capture the trace. Snapshotting at tier 0 or tier 3 tells you nothing about steady state.

---

## Best Practices

- **Read the tier column.** In `PrintCompilation` and `--trace-opt` output, the tier (and the `%` for OSR) tells you exactly where a method is in its lifecycle. Learn to read it.
- **Profile shape, not just time.** A slow hot path is often slow because a call site went polymorphic/megamorphic. Check the *shape stability* of your hot data, not only wall-clock time.
- **Don't over-tune thresholds.** The default invocation/back-edge thresholds are well chosen. Change them only with a measurement showing the default hurts your specific workload.
- **Expect asynchronous speedups.** Because compilation is on a background thread, your code gets faster at an unpredictable moment after the threshold trips — not instantly. Account for this in latency-sensitive tests.
- **Match the engine to the workload.** A branchy, polymorphic program may suit a method JIT; a numeric loop kernel may scream on a tracing JIT. Know which one you are running on.

---

## Edge Cases & Pitfalls

**Pitfall 1 — Megamorphic call sites.** The biggest silent performance killer. A site that sees too many types stops caching and blocks inlining; everything downstream slows down. It is invisible in source code; only ICs/traces reveal it. (Demonstrated in Example 3.)

**Pitfall 2 — Mistaking OSR code for peak code.** OSR-compiled methods are slightly suboptimal because they were entered mid-loop. If your benchmark is dominated by one giant loop entered once, you may be measuring OSR code, not normally-entered tier-4 code. Re-enter the method normally to see true peak speed.

**Pitfall 3 — Shape churn in V8.** Conditionally adding properties (`if (cond) o.flag = true;`) creates multiple hidden classes for "the same" object type, quietly pushing call sites toward polymorphic/megamorphic. Initialize all fields unconditionally.

**Pitfall 4 — Trace explosion in tracing JITs.** Highly branchy code under LuaJIT/PyPy can spawn many traces with frequent side-exits, sometimes performing *worse* than a method JIT would. Tracing JITs are not universally faster.

**Pitfall 5 — Compiler threads stealing CPU.** Under a sudden flood of newly-hot code (e.g., right after startup), background compiler threads can briefly contend for cores with the application, causing a short slowdown *during* the warmup that is the opposite of what you expect.

**Pitfall 6 — Counting on a specific tier sequence.** The exact path (0→3→4 vs 0→2→4 vs straight to OSR) depends on queue pressure, thresholds, and method size. Reason about the *principles*, not a guaranteed sequence; the runtime adapts.

**Pitfall 7 — Confusing "deoptimized" with "broken."** A `deoptimizing` line in the trace is normal — it means a speculative assumption was invalidated and the runtime correctly fell back. Frequent, repeated deopts on a hot path (a "deopt loop") *are* a problem, but a single deopt is just the safety net working. (The full story is in the deoptimization topic.)

---

## Summary

- Production engines use **multi-tier pipelines** to resolve the conflict between *fast-to-compile* and *good-output*: cheap tiers for startup, expensive tiers for hot code.
- **HotSpot:** interpreter (tier 0) → C1 with profiling (tier 3) → C2 (tier 4). The common path is 0→3→4; tier 3's job is to **profile** while running fast.
- **V8:** Ignition (interpreter) → Sparkplug (baseline) → Maglev (mid optimizer) → TurboFan (top optimizer), with **type feedback** accumulating in **inline caches** along the way.
- **Counters** (invocation + back-edge) and **thresholds** drive tier-up; the back-edge counter and **OSR** rescue hot loops in rarely-called methods by replacing them mid-execution.
- **Inline caches** record type feedback; monomorphic sites optimize beautifully, **megamorphic sites defeat inlining** and are the prime silent performance killer.
- Compilation runs on **background threads**, so speedups arrive asynchronously after thresholds trip.
- **Tracing JITs** (LuaJIT, PyPy) compile hot *loop traces* with guards and side-exits instead of whole methods — superb on tight loops, fragile on branchy/dynamic code.
- The tiering story hands off to **deoptimization** when a speculative assumption is violated — a normal, expected mechanism covered in its own topic.

---

## Further Reading

- HotSpot tiered-compilation documentation and the source-level descriptions of C1 and C2; Oracle's `-XX` flag reference for the threshold options.
- V8 team blog: "Ignition + TurboFan," "Sparkplug — a non-optimizing JavaScript compiler," and the Maglev announcement.
- SpiderMonkey documentation on the Baseline Interpreter, Baseline JIT, and Warp/IonMonkey for a third engine's take.
- Mike Pall's LuaFAQ and the LuaJIT `-jdump` documentation for the tracing-JIT model; the PyPy papers on meta-tracing.
- The senior tier of this topic, which opens up the *optimizations* (inlining, speculative devirtualization, escape analysis, range-check elimination, loop transforms) that the top tiers actually apply.
