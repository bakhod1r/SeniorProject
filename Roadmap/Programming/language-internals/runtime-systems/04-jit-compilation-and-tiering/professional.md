# JIT Compilation & Tiering — Professional Level

> **Topic:** [JIT Compilation & Tiering](README.md)
> **Focus:** Running a JIT in production — code-cache sizing and exhaustion incidents, warmup economics for short-lived and serverless processes (and why this drove AOT), the operational cost of megamorphic sites, tuning levers (`TieredStopAtLevel`, compile thresholds, `--no-opt`), and the engineering decision of JIT vs AOT.

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

> 🎓 At senior level you learned *which optimizations* the JIT applies and *why* they beat AOT. At professional level the question changes from "how fast can the JIT make this code?" to "**how do I operate a JIT-based fleet so that it is fast when it matters, doesn't fall over, and costs what I budgeted?**" This is where the abstraction leaks into pager alerts, capacity plans, and architecture decisions.

The JIT's bargain — spend resources during execution to learn from the program — has an operational invoice attached. The compiled machine code has to *live somewhere*: a finite **code cache**. The compiler threads consume CPU that competes with your request handlers. The **warmup** period, harmless on a server that runs for weeks, becomes the dominant cost for a function that runs for 300 milliseconds and exits — and that single fact reshaped an industry, pushing the JVM and .NET worlds toward ahead-of-time options (GraalVM Native Image, CRaC, .NET Native AOT, ReadyToRun) for exactly the workloads where the JIT never gets to collect on its loan. A professional has to know *when the JIT is the right tool at all*, and when it is actively the wrong one.

This page is about the things that page you at 3am: a code cache that filled up and silently dropped the JVM back to the interpreter, halving throughput fleet-wide; a deploy strategy that restarted every instance at once and put the whole service into cold-start at peak; a serverless cost overrun because every cold start re-paid warmup; a latency SLO blown by a megamorphic site that never let the hot path compile. It is also about the levers you reach for — and, just as importantly, the levers you should *not* reach for without a measurement, because the defaults are tuned by specialists and most tuning makes things worse.

---

## Prerequisites

- **Required:** The senior-level optimization model (inlining, devirtualization, EA, BCE, speculation + guards + deopt) and the middle-level tier pipelines.
- **Required:** Operational fluency — you have run a service in production, read its GC and CPU metrics, and survived a deploy.
- **Required:** Understanding of the warmup/steady-state distinction and why short-lived processes suffer.
- **Helpful:** Exposure to JFR/async-profiler, V8 `--prof`, or equivalent production profiling.
- **Helpful:** Familiarity with serverless cold-start economics and rolling-deploy mechanics.

You do **not** need (covered elsewhere):

- The frame-by-frame mechanics of deoptimization — its own topic; here it appears only as an operational signal (deopt storms).
- GC internals — a separate runtime-systems topic, though it interacts with EA and the code cache.

---

## Glossary

| Term | Definition |
|------|-----------|
| **Code cache** | The fixed-size memory region holding all JIT-generated machine code (and stubs, adapters). HotSpot: `ReservedCodeCacheSize`. |
| **Code-cache exhaustion** | The cache fills; the JIT cannot install new code and may stop compiling — often dropping affected methods back to the interpreter. A throughput cliff. |
| **Segmented code cache** | HotSpot's split of the cache into non-method, profiled (C1), and non-profiled (C2) segments, so one class of code can't starve another. |
| **Sweeper / eviction** | The mechanism that reclaims space from cold or superseded compiled methods so the cache can host new ones. |
| **Warmup** | The interval before hot code reaches its top tier; throughput and tail latency are degraded during it. |
| **Cold start** | A fresh process (or serverless invocation) that must warm up from scratch — interpreter speed, no profile, empty code cache. |
| **AOT (Native Image / R2R / Native AOT)** | Compiling to native code before deployment, trading peak throughput and dynamism for instant startup and no warmup. |
| **CRaC / checkpoint-restore** | Snapshotting a warmed-up JVM process and restoring it, skipping warmup on restart. |
| **TieredStopAtLevel** | HotSpot flag capping the highest tier used (1 = C1 only; 4 = full). Used to trade peak throughput for faster, cheaper startup. |
| **CompileThreshold / TierNInvocationThreshold** | Tunable counts that govern when methods compile / tier up. |
| **`--no-opt` / `--jitless`** | V8/Node flags to disable optimizing compilation (or all JIT), for debugging, security sandboxing, or predictability. |
| **Deopt storm** | A burst of repeated deoptimization+recompilation on hot methods, burning CPU and tanking throughput. An operational incident. |
| **Profile-guided AOT** | Recording a profile from a real run and feeding it to an AOT compiler (e.g., V8 code cache, .NET PGO, Graal PGO) to get *some* JIT-like benefit without runtime compilation. |
| **Warmup harness / pre-touch** | Sending synthetic representative traffic to a fresh instance before it serves real users, to force compilation. |

---

## Core Concepts

### 1. The code cache is a finite, shared resource

Everything the JIT compiles must be installed into the **code cache** — a fixed-size memory region reserved at startup. When it fills, the runtime cannot install new compiled methods. On HotSpot this historically meant **the JIT shuts off entirely** and prints `CodeCache is full. Compiler has been disabled.` — and any method not already compiled (or that gets flushed) runs in the **interpreter**, often halving or worse the throughput of an otherwise-warm service. This is a genuine production incident class: a deploy adds code paths, the working set of hot methods grows past the cache, compilation stops, latency doubles, and nothing in the application logs explains it.

Modern HotSpot mitigates this with a **segmented code cache** (separate regions for non-method stubs, profiled C1 code, and non-profiled C2 code) and a **sweeper** that evicts cold and superseded (`not entrant`) methods. But the cache is still finite. Applications with enormous code footprints — big frameworks, lots of generated code (proxies, lambdas, scripting), heavy reflection/megamorphic expansion — can outgrow the default `ReservedCodeCacheSize` and need it raised, *with monitoring*, not guessing.

The operational discipline: **monitor code-cache occupancy** as a first-class metric (JFR, `jcmd Compiler.codecache`, or the JMX `CodeCache` pool), alert before it saturates, and size it from observed peak working set, not folklore.

### 2. Warmup economics and the rise of AOT

Warmup is free amortized cost on a process that lives for weeks. It is the *dominant* cost on a process that lives for milliseconds. Quantify it:

- A JVM microservice may take **seconds** to reach peak throughput.
- A serverless function may run for **hundreds of milliseconds** and exit.

The function dies deep in warmup — interpreted or barely C1-compiled — having paid the JIT's overhead (compiler threads, profiling) and collected almost none of its reward. Worse, *every cold start* re-pays it. At scale (millions of invocations, frequent cold starts), this is real money and real p99 latency.

This economic mismatch is *why ahead-of-time compilation came roaring back* in managed-language ecosystems:

- **GraalVM Native Image** AOT-compiles a JVM application (with a closed-world assumption) to a native binary that starts in milliseconds with a flat, warmup-free profile — at the cost of lower peak throughput and loss of runtime dynamism (reflection/dynamic class loading must be configured).
- **.NET Native AOT / ReadyToRun (R2R)** pre-compiles IL to native to cut startup and warmup.
- **CRaC (Coordinated Restore at Checkpoint)** takes the other route: warm the JVM up *once*, snapshot the process, and restore from the snapshot — startup skips warmup because the code cache and profiles are restored.
- **Profile-guided AOT** (V8 compile caches, .NET dynamic PGO baked into AOT, Graal PGO) tries to capture *some* of the JIT's profile-driven wins without paying for runtime compilation.

The professional decision is therefore not "JIT or AOT is better" but "**what is this process's lifetime and dynamism profile, and which compilation model matches it?**" Long-lived, throughput-bound, dynamic → JIT. Short-lived, latency/startup-bound, closed-world → AOT.

### 3. Megamorphic sites as an operational cost

At senior level a megamorphic site was a missed optimization. In production it is a **latency and capacity** problem. A hot path that cannot inline because a key site went megamorphic runs at a fraction of its potential speed, consuming more CPU per request, which means more instances to hold the SLO, which means more cost. The insidious part: it is invisible in the source and in ordinary CPU profiles (the time is spread thinly across generic dispatch and missed inlining), and it often *appears* after an innocuous change — a new subclass added to a hierarchy, a framework upgrade that injects proxies, a "generalization" that made a method accept more types. Diagnosing it requires inlining/IC-level tooling (`-XX:+PrintInlining`, JFR's compiler events, V8 IC state), not just a flame graph.

### 4. Compiler threads compete with the application

The optimizing compiler runs on background threads, but those threads are not free — they consume CPU cores. On a busy multi-core box this is usually fine. On a constrained container (1–2 vCPUs), a burst of compilation right after startup steals cycles from request handling, *adding* latency exactly when the service is also slow from being cold. This is why aggressively low-core serverless and sidecar deployments feel disproportionately punished by JIT warmup: there is no spare core to hide the compilation in. Tuning the number of compiler threads (`-XX:CICompilerCount`) is a real lever in tight-core environments, but again, measure first.

### 5. The tuning levers (and when to touch them)

The honest default position is **don't tune** — the tiered defaults are excellent and most tuning regresses something. Reach for these only with a measurement showing the default hurts *your* workload:

- **`-XX:TieredStopAtLevel=1`** — interpreter + C1 only, no C2. Faster, cheaper startup; lower peak throughput. Rational for short-lived JVM CLIs/tools and some serverless where C2 would never pay off.
- **`-XX:-TieredCompilation`** — go straight to C2 (no C1 profiling tier). Slow start, high peak. Niche; rarely the right call since tiered usually dominates.
- **`-XX:ReservedCodeCacheSize`** — raise when monitoring shows cache pressure on a large-code-footprint app.
- **`-XX:CICompilerCount`** — adjust compiler thread count in core-constrained environments.
- **Compile thresholds** (`-XX:Tier3/Tier4InvocationThreshold`, `-XX:CompileThreshold`) — lower to compile sooner (helps medium-lived processes warm faster), raise to compile less (saves compilation cost for very short processes). High blast radius; change with care.
- **V8 `--max-opt` / `--no-opt` / `--jitless`** — cap or disable optimization. `--jitless` disables JIT entirely for security-sandboxed contexts (no W^X-violating writable+executable pages) at a large throughput cost; `--no-opt` aids debugging/repro.

The meta-rule: **a tuning flag is a hypothesis. Test it against your real workload, in your real container shape, and keep it only if a metric you care about improved.**

### 6. Deopt storms as incidents

A single deoptimization is healthy. A **deopt storm** — a hot method that optimizes, deopts, re-optimizes, deopts, repeatedly — burns CPU on recompilation and runs the hot path at slow-tier speed in between. Causes: genuinely unstable types/branches on a hot path, profile pollution from non-representative warmup, or a guard tied to a value that flips frequently. Symptoms: high compiler CPU, sawtooth throughput, `--trace-deopt` (V8) or JFR deopt events firing repeatedly on the same method. The fix is upstream — stabilize the data or accept the general path — not a flag. (Mechanics live in the deoptimization topic; here it is an operational signal you must recognize.)

---

## Real-World Analogies

**The warehouse with fixed shelf space (code cache).** The JIT keeps producing finished goods (compiled methods) and must shelve them. The warehouse has fixed shelves. When they fill, no new goods can be stocked — production halts and you ship from the slow workshop floor (the interpreter) instead. Smart warehouses clear stale stock (the sweeper) and segregate shelves by product type (segmented cache) so one line can't crowd out another. But the building has walls; outgrow them and you must expand it deliberately (raise the size), with inventory tracking (monitoring), not by hoping.

**The food truck vs the restaurant (warmup economics → AOT).** A restaurant open all week amortizes the morning prep over hundreds of covers — prep (warmup) is negligible. A food truck open for one 20-minute rush cannot afford an hour of prep; by the time the kitchen is "warm," service is over. So food trucks pre-prep at a commissary the night before (AOT / Native Image) and arrive ready to serve instantly, accepting a slightly less flexible menu (closed world, reduced dynamism). Same dish, different economics, different right answer.

**The toll plaza that only has staff during compilation (compiler threads on few cores).** If the same small crew that processes cars also has to repaint the lanes (compile), then during repainting the queue backs up — exactly when traffic is heaviest right after opening. On a big plaza with spare staff, repainting is invisible. On a two-booth plaza, it visibly stalls traffic.

---

## Mental Models

**Model 1 — Lifetime decides the compilation model.** Plot process lifetime on an axis. Far right (weeks): JIT wins decisively; warmup is noise. Far left (milliseconds): AOT wins; the JIT never collects. The middle is where checkpoint-restore (CRaC) and `TieredStopAtLevel` tuning live. *Before optimizing a JIT, ask where on this axis the process sits — the answer may be "use AOT instead."*

**Model 2 — The code cache is a budget, not infinity.** Treat compiled code like any other finite resource (heap, file descriptors, connections): measure its working set, size it from data, alert before saturation, and understand the failure mode (fallback to interpreter, a throughput cliff). Teams that don't monitor it get surprised by it.

**Model 3 — Warmup is a deployment property, not just a benchmark artifact.** Every restart, scale-out, and rolling deploy injects cold instances into the fleet. Your deploy strategy *is* a warmup strategy: stagger restarts, pre-warm new instances with representative traffic before adding them to the load balancer, and never cold-restart the whole fleet at peak.

**Model 4 — Defaults are a strong prior; tuning is evidence against it.** The tiered defaults encode enormous expertise. A tuning flag must overturn that prior with measured evidence from your workload. Most "tuning" you see in blog posts is cargo-culting; demand the before/after numbers, on the right hardware shape.

---

## Code Examples

### Example 1 — Monitoring and provoking code-cache pressure (HotSpot)

```bash
# Inspect code cache live.
jcmd <pid> Compiler.codecache

# Run an app with a deliberately tiny cache to see the failure mode.
java -XX:ReservedCodeCacheSize=8m -XX:+PrintCodeCache -XX:+PrintCompilation BigApp
```

With a tiny cache, you will eventually see `CodeCache is full. Compiler has been disabled.` and a measurable throughput drop as hot methods stop being compiled. In production, expose the `CodeCache` JMX memory pool to your metrics system and alert at, say, 80% occupancy. The point of the experiment is to *recognize the cliff* before you meet it unplanned.

### Example 2 — Quantifying warmup cost

```java
public class WarmupCost {
    static long work(int n){ long s=0; for(int i=0;i<n;i++) s += (i*2654435761L)>>>11; return s; }
    public static void main(String[] a){
        for (int r=0; r<30; r++){
            long t=System.nanoTime(); long acc=0;
            for (int k=0;k<500;k++) acc += work(50_000);
            System.out.printf("round %2d: %5d us  (acc=%d)%n", r, (System.nanoTime()-t)/1000, acc);
        }
    }
}
```

```bash
java WarmupCost                          # watch first rounds vs steady state
java -XX:TieredStopAtLevel=1 WarmupCost  # faster start, higher steady-state floor
```

Record the round at which timings flatten — that is your warmup duration. Multiply by your cold-start frequency to estimate the warmup tax on the fleet. For a serverless function, this number directly informs whether to switch to Native Image.

### Example 3 — Choosing AOT for a short-lived process (GraalVM)

```bash
# JIT build: fast peak, slow start.
java -jar app.jar              # ~seconds to warm up, high throughput

# Native Image (AOT): instant start, no warmup, lower peak.
native-image -jar app.jar
./app                          # starts in ~milliseconds, flat profile
```

For a CLI tool or a serverless handler, the native binary's startup (milliseconds, no warmup) is decisive even though its peak throughput is lower — the process never runs long enough to reach the JIT's peak anyway. This is the warmup-economics decision made concrete: **match the compilation model to the lifetime.**

### Example 4 — Disabling optimization in V8 for predictability/security

```bash
node --no-opt app.js        # keep baseline tiers, skip optimizing JIT (debug/repro)
node --jitless app.js       # no JIT at all: no writable+executable pages (sandbox), big perf cost
```

`--jitless` is used where executable-page generation is a security risk (some sandboxes, certain embedded contexts). You trade a large amount of throughput for the absence of runtime-generated code. Knowing this lever exists — and its cost — is part of operating V8 in constrained or hardened environments.

### Example 5 — Detecting a megamorphic regression in CI

```java
// Pseudocode for a guardrail test:
// 1. Warm up the hot path.
// 2. Use JFR or -XX:+PrintInlining to assert the key call inlined.
// 3. Fail the build if the critical call did NOT inline (megamorphic regression).
```

Mature teams encode "this hot call must inline" as an automated check (parse JFR compiler events or `PrintInlining` output), so a future change that adds a fourth subtype to a hot hierarchy — silently making the site megamorphic — fails CI instead of surfacing as a mysterious latency regression in production. Treat inlining of critical paths as a testable invariant.

---

## Trade-offs

- **JIT vs AOT:** peak throughput + dynamism + portability (JIT) versus instant startup + no warmup + flat latency + smaller footprint (AOT). Decided by process lifetime and closed-world feasibility.
- **Bigger code cache vs memory:** larger cache avoids the exhaustion cliff but consumes RAM that could be heap. Size from measured working set.
- **More compiler threads vs application CPU:** faster warmup vs stealing cores from request handling on constrained boxes.
- **Lower compile thresholds vs wasted compilation:** earlier peak for medium-lived processes vs compiling code that short-lived processes never reuse.
- **Pre-warming vs deploy speed/cost:** warm-before-serve removes cold-start latency but adds time and synthetic load to every deploy/scale-out.
- **Checkpoint-restore (CRaC) vs operational complexity:** skips warmup entirely but adds snapshot lifecycle, security, and state-validity concerns.

> 🎓 Every trade-off reduces to the same governing question from junior level, now with a price tag: **will this process run long enough for the JIT's investment to pay off — and can I afford the warmup, the code cache, and the compiler CPU until it does?**

---

## Use Cases

- **Long-lived throughput services (JIT, defaults):** Kafka brokers, databases, Spring Boot APIs under steady load. Tune only code-cache size if monitoring demands it.
- **Serverless / FaaS (AOT or CRaC):** functions with frequent cold starts; Native Image or SnapStart/CRaC to eliminate per-invocation warmup tax.
- **CLI tools and short batch jobs (AOT or `TieredStopAtLevel=1`):** processes that exit before C2 would ever pay off.
- **Latency-SLO-bound services (JIT + pre-warm + deploy discipline):** keep instances warm, stagger restarts, pre-touch before LB attach.
- **Security-hardened/sandboxed runtimes (`--jitless`):** where generated executable memory is unacceptable, trading throughput for the absence of W^X-violating pages.

---

## Coding Patterns

**Pattern 1 — Pre-warm before serving traffic.** On startup, drive the hot paths with representative synthetic requests, *then* signal readiness to the load balancer. This converts user-visible cold-start latency into invisible startup time.

**Pattern 2 — Stagger restarts and scale-outs.** Never cold-restart the whole fleet at once under load. Roll instances so warm capacity always covers traffic while new instances warm up.

**Pattern 3 — Treat code-cache occupancy as a monitored SLI.** Export it, dashboard it, alert before saturation, and size `ReservedCodeCacheSize` from observed peak — especially for large-framework or codegen-heavy apps.

**Pattern 4 — Encode inlining-critical paths as tests.** Assert in CI that key hot calls still inline (no megamorphic regression), so performance-critical assumptions are guarded by the build, not by hope.

**Pattern 5 — Pick the compilation model per workload, explicitly.** Make "JIT vs AOT vs CRaC" a deliberate, documented decision keyed to the process's lifetime and dynamism, not a default you inherited.

---

## Best Practices

- **Default first, tune with evidence.** Run the tiered defaults until a metric proves they hurt *your* workload on *your* hardware shape. Keep before/after numbers for every flag you set.
- **Make warmup a first-class part of deploys.** Pre-warm, stagger, and never put the whole fleet cold at peak. Your deploy pipeline owns warmup.
- **Monitor the JIT, not just the app.** Code-cache occupancy, compiler CPU, deopt-event rate, and inlining of critical paths are operational signals. Most teams watch heap and GC but ignore these until an incident.
- **Right-size the compilation model.** Short-lived or cold-start-heavy? Seriously evaluate Native Image / CRaC. Don't brute-force a JIT into a workload it structurally mismatches.
- **Guard against megamorphic regressions.** Adding a subtype to a hot hierarchy, introducing proxies, or "generalizing" a hot method can silently destroy inlining. Review and, ideally, test for it.
- **Respect constrained containers.** On 1–2 vCPU boxes, account for compiler-thread CPU during warmup; consider `TieredStopAtLevel=1` or AOT rather than fighting the contention.

---

## Edge Cases & Pitfalls

**Pitfall 1 — Silent code-cache exhaustion.** The cache fills, the JIT disables, throughput halves, and nothing in the app log explains it. Without code-cache monitoring you will chase the wrong cause for hours. Monitor it. (Demonstrated in Example 1.)

**Pitfall 2 — Whole-fleet cold restart at peak.** A "safe" config rollout that restarts every instance simultaneously drops the entire fleet into warmup under full load — a self-inflicted brownout. Always roll.

**Pitfall 3 — Benchmarking on a beefy box, deploying on a tiny container.** Warmup and compiler-thread contention behave very differently on 32 cores versus 1.5 vCPUs. Performance-test on the *production* container shape, or your warmup estimates will be optimistic.

**Pitfall 4 — Serverless warmup tax ignored.** A function that looks fast in a warm benchmark may be dominated by cold-start interpreter time in production, with every cold invocation re-paying it. Measure cold-path latency explicitly; consider AOT/snapshot.

**Pitfall 5 — Tuning by blog post.** Copying `-XX` flags from an article tuned for a different workload commonly regresses throughput or causes new incidents (e.g., a too-small custom code-cache size). Treat every flag as an unproven hypothesis.

**Pitfall 6 — Profile pollution from health checks / warmup traffic.** Synthetic warmup with unrepresentative types/branches teaches the JIT the wrong thing; real traffic then triggers deopts. Warm up with traffic that resembles production.

**Pitfall 7 — Megamorphic regression from a "harmless" change.** A new implementation class, a mocking framework in a perf test, or a dependency upgrade injecting proxies can push a hot site megamorphic. CPU per request creeps up, you add instances to compensate, and cost rises with no obvious culprit. (Guard with Example 5's test.)

**Pitfall 8 — Forgetting AOT's constraints.** Native Image's closed-world assumption breaks naive reflection/dynamic loading; CRaC requires snapshot-safe state (no stale connections/secrets). Adopting AOT/CRaC without honoring their constraints trades a warmup problem for a correctness problem.

---

## Summary

- The JIT's "spend resources at runtime to learn" bargain has an **operational invoice**: code-cache memory, compiler-thread CPU, and warmup time.
- The **code cache is finite**; exhaustion drops methods back to the interpreter — a throughput cliff with no application-level explanation. Monitor occupancy, size from data, and know the segmented-cache/sweeper mitigations.
- **Warmup economics** are decisive for short-lived and serverless processes that die before collecting the JIT's reward — the force that drove **AOT** (GraalVM Native Image, .NET Native AOT/R2R) and **checkpoint-restore (CRaC)** back into managed ecosystems.
- **Megamorphic sites** are an operational cost: silently more CPU per request, more instances, more money, often introduced by an innocuous change. Guard critical inlining in CI.
- **Compiler threads compete** with the application, punishing core-constrained containers during warmup.
- **Tuning levers** (`TieredStopAtLevel`, thresholds, `CICompilerCount`, `ReservedCodeCacheSize`, V8 `--no-opt`/`--jitless`) exist, but the **defaults are a strong prior**: tune only with measured evidence on the real workload and container shape.
- **Deopt storms** are incidents to recognize (repeated optimize/deopt churn); fix the data, not the flag.
- The governing decision is **process lifetime and dynamism vs compilation model**: long-lived/dynamic → JIT; short-lived/closed-world → AOT; restart-heavy but warmup-expensive → checkpoint-restore.

---

## Further Reading

- HotSpot code-cache documentation: `ReservedCodeCacheSize`, segmented code cache, the sweeper, and `jcmd Compiler.codecache`.
- GraalVM Native Image, OpenJDK Project CRaC, and the Spring/Quarkus/Micronaut AOT guides for the JIT-vs-AOT operational trade-offs in practice.
- .NET documentation on ReadyToRun, Native AOT, and dynamic PGO for the equivalent story on the CLR.
- V8 flags reference (`--no-opt`, `--jitless`, `--max-opt`) and the V8 code-caching design docs.
- async-profiler, JFR, and JMC guides for observing compilation, inlining, deopt, and code-cache behavior in production.
- The interview and tasks files for this topic, which test and exercise the operational reasoning above.
