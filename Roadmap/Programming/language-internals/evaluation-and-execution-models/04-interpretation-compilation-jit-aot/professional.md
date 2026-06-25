# Interpretation, Compilation, JIT, AOT — Professional Level

> **Topic:** [Interpretation, Compilation, JIT, AOT](README.md)
> **Focus:** Engineering and operating execution models at scale — code-cache and compiler-thread management, deopt-metadata cost, security of runtime codegen, WASM's JIT/AOT story, and choosing/tuning the model as a fleet-level decision.

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
15. [Further Reading](#further-reading)

---

## Introduction

> Focus: **Running these models in production at scale**, where the academic trade-offs become SLOs, dollars, CVEs, and incident postmortems. What knobs exist, what they cost, how the model interacts with containers and autoscaling, and why "the JIT generates executable code at runtime" is a security story, not just a performance one.

A senior can explain deopt, tracing, closed-world AOT, and PGO. A professional *operates* these models across a fleet and is accountable for the consequences:

- The JIT's machinery — compiler threads, the **code cache**, profiling counters, **deopt metadata** — consumes CPU, memory, and address space that you must size and monitor. A full code cache silently degrades a JVM to interpretation; runaway compiler threads steal CPU from request handling; deopt metadata bloats memory. These are operational realities with dashboards and alerts.
- **Runtime code generation is an attack surface.** A JIT must hold memory that is *writable and executable* (or rapidly toggle W^X), which is exactly what exploit mitigations try to forbid. JIT spraying, type-confusion bugs in speculative optimizers, and the entire history of browser zero-days route through the JIT. AOT eliminates this surface — a real security argument, not just a performance one.
- **WebAssembly** has made the JIT/AOT distinction a shipping concern in *every browser and edge runtime*: WASM is JIT-compiled (baseline + optimizing, mirroring the JS engine) or AOT-compiled to native (Wasmtime/Wasmer `compile`, edge platforms precompiling modules), with the same startup-vs-peak and the same codegen-security trade-offs you now know — plus near-instant startup as a headline feature.
- At fleet scale the choice of model is an **economic** one: warmup CPU burned across thousands of cold starts, RSS multiplied by replica count, p99 tail dominated by compilation jitter. The professional computes these, not hand-waves them.

This page is about owning the model in production. It assumes you've internalized the senior material and pushes into operations, security, and cost.

---

## Prerequisites

- **Required:** Senior-level command of deopt, method vs tracing JITs, closed-world AOT, R2R, and PGO.
- **Required:** Operational fluency — you've sized JVM/CLR/Node services, read GC and compilation logs, and owned latency SLOs.
- **Required:** A working model of virtual memory permissions (W^X, `mprotect`) and why writable+executable memory is dangerous.
- **Helpful:** Exposure to containerized deployment (cgroup memory/CPU limits) and autoscaling behavior.
- **Helpful:** Awareness of the WASM execution model in browsers and server runtimes.

---

## Glossary

| Term | Definition |
|------|-----------|
| **Code cache** | The fixed-size memory region a JIT writes generated native code into. Exhaustion → compilation stops → fallback to interpreting. |
| **Compiler thread** | A background thread that performs JIT compilation off the application's critical path; competes for CPU. |
| **Compilation jitter** | Latency variance caused by JIT compilation (and deopt) happening concurrently with request handling. |
| **Deopt metadata footprint** | Memory consumed by the per-compiled-point maps needed to reconstruct interpreter frames on deopt. |
| **W^X (Write-XOR-Execute)** | A security policy: memory is writable or executable, never both at once. JITs must work around it. |
| **JIT spraying** | An exploitation technique that coerces a JIT into emitting attacker-chosen byte sequences into executable memory. |
| **RWX memory** | Memory mapped readable+writable+executable — historically how JITs held generated code; a prime exploit target. |
| **Speculative-execution side channels** | Spectre-class hardware issues; relevant because JIT-emitted code (and the engine) became a delivery vehicle in browsers. |
| **Tiering-up / tiering-down** | Promoting code to a higher (more optimized) tier, or demoting it (e.g. after deopt). |
| **WASM baseline/optimizing compiler** | e.g. V8's Liftoff (baseline) and TurboFan (optimizing) for WebAssembly — the JS engine's two-tier model applied to WASM. |
| **AOT-compiled WASM** | Precompiling a `.wasm` module to native ahead of execution (Wasmtime/Wasmer `compile`, edge precompilation). |
| **Cold start** | The latency of bringing a fresh process/instance to first-useful-work, dominated by startup + (for JIT) warmup. |
| **RSS** | Resident set size — physical memory a process occupies; multiplied across replicas at fleet scale. |
| **Ahead-of-time cache (AppCDS / R2R)** | Persisted artifacts (class-data sharing, ReadyToRun images) that cut JVM/CLR startup by reusing pre-processed state. |

---

## Core Concepts

### 1. The JIT's resource budget is yours to size and monitor

A JIT is not free machinery running in the background — it spends *your* CPU, memory, and address space, and each has a failure mode you must operate around.

- **Code cache (address space + memory).** Generated native code lives in a fixed-size region (`-XX:ReservedCodeCacheSize` in HotSpot, analogous limits elsewhere). When it fills — common in large microservice monoliths, heavy use of dynamic proxies, or long-uptime services that compile many methods — the JIT **stops compiling and the JVM reverts hot code to the interpreter**, causing a sudden, mysterious throughput collapse with no exception. You monitor code-cache occupancy and alert before exhaustion; you size it for the application's method count; you enable code-cache flushing where appropriate.
- **Compiler threads (CPU).** Compilation runs on dedicated threads (`-XX:CICompilerCount`). On a small container with tight CPU limits, those threads *compete with request handling*, and a burst of compilation (e.g. right after deploy) shows up as a **latency spike**. Sizing compiler threads to the cgroup's actual CPU quota matters — a JVM that miscounts available CPUs (a classic container pitfall pre-`UseContainerSupport`) over-provisions compiler threads and starves the app.
- **Profiling counters and deopt metadata (memory).** Every compiled method carries deopt metadata mapping compiled state back to interpreter state at each safepoint/guard. This is *not negligible* at scale — it's part of why a warmed JVM's RSS is much larger than the same workload AOT-compiled. You account for it in capacity planning.

The professional reflex: treat the compiler subsystem like any other resource consumer — give it limits, dashboards, and alerts, and understand its degradation mode (silent fallback to interpreting) before it bites you in an incident.

### 2. Compilation as a source of tail latency

Steady-state throughput is the easy metric. The hard one is **tail latency**, and the JIT is a tail-latency source:

- **Warmup tail.** Immediately after deploy or scale-out, fresh instances interpret before compiling; their p99 is far worse than the fleet's steady-state. If you route real traffic to them immediately, users on those instances see the warmup tail.
- **Compilation jitter.** Even in steady state, occasional (re)compilations and deopts perturb latency. A request unlucky enough to run while a hot method deoptimizes can spike.
- **Deopt storms.** A code change or input shift that destabilizes a hot speculation site can trigger correlated deopts across the fleet — a fleet-wide latency event from a "harmless" deploy.

Mitigations are operational: **pre-warm before health-check pass** (replay representative traffic, or use saved profiles), **stagger deploys** so warmup tails don't align, **use class-data sharing / R2R / AppCDS** to cut the startup portion, and **alert on deopt rate** as a leading indicator. The point: a JIT's performance is a *distribution over time and instances*, and the tail of that distribution is an operational responsibility, not a benchmark footnote.

### 3. Runtime code generation is an attack surface (the security argument for AOT)

This is the security story juniors never hear and seniors underweight. A JIT *must* take attacker-influenced input (your program, or in a browser, the website's JavaScript/WASM) and **generate executable machine code from it at runtime.** That capability is intrinsically dangerous:

- **Executable, writable memory.** To emit code, a JIT needs memory that is writable (to write the code) and executable (to run it). Holding **RWX** memory violates **W^X**, the mitigation that stops attackers from writing-then-executing a payload. Modern JITs mitigate by toggling permissions (`mprotect` to write, then to execute), using dual mappings, or hardware features (Apple's `pthread_jit_write_protect_np`), but the executable region still exists and is a target.
- **JIT spraying.** An attacker who can influence the constants/operations a JIT compiles can coax it into laying down a chosen byte sequence in executable memory, then jump into it — turning the optimizer into a code-writing primitive that defeats ASLR/DEP.
- **Optimizer bugs as exploits.** The most valuable browser zero-days for years targeted **speculative-optimizer bugs** in V8/JSC/SpiderMonkey: a type-confusion in TurboFan where a missing or wrong guard lets the engine treat memory as the wrong type, yielding read/write primitives. The very speculation that makes JITs fast is a rich bug surface, because a single incorrect assumption breaks memory safety.

**AOT removes this entire surface.** A native-image/NativeAOT/Go/Rust binary generates no code at runtime; it needs no RWX memory; there's no optimizer for an attacker to confuse with crafted input. This is a *first-class reason* security-sensitive and locked-down environments (some kernels, hardened embedded, certain mobile/console policies that forbid RWX, edge sandboxes) prefer or mandate AOT. When you choose a model, "does this process generate code at runtime, and is that acceptable in this trust environment?" is a real question alongside performance.

### 4. WebAssembly: the JIT/AOT spectrum, shipped to every browser and edge

WASM made everything in this topic a daily concern for web and edge engineers, because WASM is *bytecode for a stack machine* that must reach native — and it does so by the same strategies you now know:

- **In the browser, WASM is JIT-compiled, tiered.** V8 uses **Liftoff** (a fast baseline compiler — compile quickly, run okay) for instant startup, then **TurboFan** (optimizing) for hot modules — the exact baseline/optimizing pattern from JS, applied to WASM. SpiderMonkey and JSC do the analogous two-tier thing. So WASM in the browser has *warmup*, just a much gentler one than JS (WASM bytecode is already typed and close to machine code, so even baseline output is good).
- **On the server/edge, WASM is frequently AOT-compiled.** Wasmtime and Wasmer let you `compile` a module to native (via Cranelift or LLVM) *before* running, or precompile and cache it. Edge platforms (Fastly, Cloudflare, et al.) precompile WASM modules so a request hits *already-native* code with near-zero cold start — WASM's headline pitch for serverless is exactly the AOT advantage (instant startup, low memory) you studied, plus a strong sandbox.
- **The same trade-offs recur, plus sandboxing.** WASM's design (linear memory, structured control flow, validated bytecode) makes it *fast to compile and easy to sandbox* — which is why it can JIT quickly *and* AOT safely, and why it's displacing both heavyweight JIT runtimes and OS-process isolation for multi-tenant edge compute.

The lesson for a professional: the interpret/JIT/AOT spectrum isn't a legacy-language curiosity; it's the substrate of the newest deployment targets, and choosing how WASM is compiled (baseline vs optimizing, JIT vs precompiled-AOT) is a live tuning decision in modern edge architectures.

### 5. Model choice as fleet economics

At one machine, "JIT vs AOT" is a benchmark. At a fleet of thousands, it's a budget:

- **Cold-start CPU cost.** A scale-to-zero serverless platform paying JIT warmup on *every* cold start burns aggregate CPU (and bills the user) proportional to cold-start frequency. AOT (or precompiled WASM) collapses that to near zero — a direct cost line.
- **Memory × replica count.** A warmed JVM might carry hundreds of MB of code cache, profiles, deopt metadata, and JIT working set; the AOT equivalent is a fraction. Multiply by replica count and the RSS difference is real money and real bin-packing density (more containers per node).
- **Tail latency × SLO penalties.** Warmup and compilation jitter inflate p99/p999; if your SLOs carry penalties or your UX is latency-sensitive, the JIT's tail has a price.
- **Conversely, peak-throughput value.** For a saturated long-lived service, the JIT's higher steady-state peak means *fewer machines* for the same throughput — the cost argument can flip entirely.

So the professional decision is an explicit optimization over a cost function: `aggregate_cost = warmup_CPU·coldstart_rate + RSS·replicas·$/GB + tail_penalty − peak_throughput_savings`, evaluated against the workload's lifetime and restart distribution. Serverless and dense microservice fleets push the answer toward AOT/R2R/precompiled-WASM; saturated long-lived monoliths push it toward a well-warmed JIT. **You compute this; you don't quote a blog post.**

### 6. Hybrid and caching strategies blur the line on purpose

Production runtimes give you levers *between* pure JIT and pure AOT, and using them well is the craft:

- **AppCDS / Class-Data Sharing (JVM)** persists parsed class metadata (and, with dynamic CDS, application classes) so startup skips re-parsing — a partial AOT of the *loading* phase that cuts cold start without touching the JIT.
- **ReadyToRun (.NET)** precompiles common IL to native at publish time while keeping the JIT for hot-path reoptimization — startup of AOT, peak of JIT.
- **GraalVM** offers both a JIT (as a HotSpot replacement compiler) *and* native-image AOT from the same toolchain — you pick per deployment.
- **Precompiled + cached WASM** at the edge gives AOT cold-start with a portable, sandboxed artifact.

The mature stance: the model is a *dial with detents*, and matching the detent to each deployment (CLI → native-image; latency-sensitive web tier → R2R + warmup; batch monolith → tuned JIT; multi-tenant edge → precompiled WASM) is how you get the best of the spectrum instead of dogmatically picking an end.

---

## Real-World Analogies

| Concept | Real-world thing |
|---------|------------------|
| **Code cache exhaustion** | A print shop with finite shelf space for plates; once full, it stops making new plates and reverts to slow hand-lettering — no error, just sudden slowness. |
| **Compiler threads stealing CPU** | Back-room staff retooling machines during the lunch rush, competing with the cooks for the same kitchen. |
| **Warmup tail after deploy** | A new branch location on opening day — slow and clumsy until the staff find their rhythm; you don't send your biggest client there first. |
| **RWX / JIT spraying** | A workshop that must keep the engraving machine both loaded and powered; a saboteur who can choose what gets engraved can stamp out a master key. |
| **Optimizer type-confusion exploit** | A factory robot told the part is steel when it's foam; it applies steel-force and punches straight through — attacker-controlled "wrong assumption." |
| **AOT removes the surface** | Shipping pre-stamped parts only; there's no powered engraving machine on site to subvert. |
| **WASM baseline→optimizing** | A food truck that serves a decent dish instantly, then perfects the recipe for the items people keep ordering. |
| **Precompiled edge WASM** | Vending machines stocked with finished meals — instant, no kitchen, no warmup. |
| **Fleet economics** | One slow checkout lane is an annoyance; the same inefficiency across 5,000 stores is a budget line. |

---

## Mental Models

### The "Compiler Subsystem is a Tenant" Model

Treat the JIT like a co-resident service sharing the box: it has a CPU budget (compiler threads), a memory budget (code cache + metadata + working set), and a failure mode (fill the cache → silent fallback to interpreting). You size, limit, monitor, and alert on it exactly as you would a sidecar. This reframes "JIT performance" from a black box into an operable resource.

### The "Throughput Distribution, Not Throughput" Model

A fleet's performance is a *distribution* over instances and time: fresh instances warming, steady instances at peak, unlucky requests hitting compilation/deopt jitter. SLOs live in the *tail* of that distribution. Optimizing the model means shaping the whole distribution — pre-warm to lift the cold instances, stagger deploys to decorrelate warmup tails, cap compiler CPU to bound jitter — not just maximizing the steady-state mode.

### The "Codegen-at-Runtime = Attack Surface" Model

Any process that turns input into executable code at runtime holds RWX-ish memory and runs an optimizer on attacker-influenced data. That's a security liability with a long CVE history. AOT trades the JIT's adaptivity for the *elimination* of this surface. Put "does runtime codegen fit this trust boundary?" on the same decision sheet as latency and cost.

### The "Spectrum with Detents" Model

Don't binarize. The real menu is: interpret · bytecode+interp · interp+baseline-JIT · tiered-JIT · JIT+CDS/AppCDS · R2R(hybrid) · PGO-AOT · closed-world-AOT · precompiled-WASM. Each detent trades startup/memory/security against peak/adaptivity. Production excellence is matching the detent to each deployment, and you have the knobs to do it.

---

## Code Examples

### Monitoring and sizing the JVM code cache

```bash
# Watch code-cache occupancy; alert before it fills (silent interp fallback).
java -XX:+PrintCodeCache -XX:ReservedCodeCacheSize=256m -XX:+UseCodeCacheFlushing MyApp

# Size compiler threads to the container's real CPU quota (avoid starving requests).
java -XX:CICompilerCount=2 -XX:+UseContainerSupport MyApp
```

At runtime, scrape `java.lang.management` / JFR for `CodeCache` usage and the compilation queue length, and alert when occupancy crosses ~80% — the symptom of exhaustion is a throughput cliff with *no exception*, which is exactly the kind of incident that eats hours if you're not watching for it.

### Cutting cold start with AppCDS (partial-AOT of loading)

```bash
# 1) Record the classes the app loads.
java -XX:ArchiveClassesAtExit=app.jsa -jar app.jar --exit-after-startup
# 2) Reuse the shared archive on every subsequent start -> faster cold start.
java -XX:SharedArchiveFile=app.jsa -jar app.jar
```

This doesn't touch the JIT; it removes class-parsing work from the startup critical path — a clean, low-risk cold-start win that stacks with everything else.

### Pre-warming before a service takes traffic

```text
// readiness gate pseudocode — do NOT report healthy until warmed
startServer()
for req in representativeWarmupRequests():     // replay real-ish traffic
    handle(req)                                 // drives hot paths into the JIT
waitUntil(compilationQueueDrained())            // optional: ensure tier-up done
reportReady()                                    // only now join the load balancer
```

This shapes the throughput distribution by lifting fresh instances out of the interpreting phase *before* users reach them — the single most effective JIT tail-latency mitigation in practice.

### Observing the W^X dance / refusing RWX

```c
/* A JIT must make a buffer executable. Modern, W^X-respecting flow: */
void *code = mmap(NULL, len, PROT_READ | PROT_WRITE,           /* writable, NOT exec */
                  MAP_PRIVATE | MAP_ANONYMOUS, -1, 0);
emit_machine_code(code);                                        /* fill in the code  */
mprotect(code, len, PROT_READ | PROT_EXEC);                    /* flip to exec, drop write */
/* The old, dangerous way was PROT_READ|PROT_WRITE|PROT_EXEC (RWX) the whole time. */
```

An AOT binary contains *none* of this — there is no `mmap(...PROT_EXEC...)` of freshly written bytes, which is precisely the surface AOT removes. On platforms that forbid RWX entirely (locked-down iOS/console policies), a classic JIT simply *cannot run*, which forces AOT.

### Compiling WASM both ways (server runtime)

```rust
// Wasmtime: AOT-compile a module to native and cache it (instant later starts).
let engine = Engine::default();
let module = Module::from_file(&engine, "app.wasm")?; // compiled (Cranelift) here
let serialized = module.serialize()?;                 // persist native artifact
std::fs::write("app.cwasm", serialized)?;             // precompiled cache

// Later / on the edge: load the precompiled artifact -> no compile at request time.
let module = unsafe { Module::deserialize(&engine, &std::fs::read("app.cwasm")?)? };
```

This is the AOT path for WASM: pay compilation once at build/deploy, hit native code with near-zero cold start at request time — the edge-serverless pattern. In a browser, by contrast, the engine JITs the same `.wasm` with a baseline tier (Liftoff) then an optimizing tier (TurboFan), accepting a small warmup for zero build-time precompilation.

### A fleet cost estimate (back-of-envelope)

```text
# JIT'd serverless, 10M cold starts/day, ~300ms warmup CPU each:
warmup_CPU/day = 10e6 * 0.3 s = 3.0e6 CPU-seconds/day  (~34.7 CPU-days/day)

# Same workload AOT (native-image / precompiled WASM), ~5ms startup:
warmup_CPU/day = 10e6 * 0.005 s = 5.0e4 CPU-seconds/day (~0.58 CPU-days/day)

# ~60x less compute spent reaching first-useful-work — a direct bill line,
# before counting the RSS-per-replica and tail-latency differences.
```

The arithmetic, not the slogan, is what justifies "serverless resurrected AOT."

---

## Pros & Cons

| Aspect | Tiered JIT (operated) | JIT + CDS/R2R hybrid | Closed-world AOT | Precompiled WASM (edge) |
|--------|----------------------|----------------------|------------------|-------------------------|
| **Cold start** | Slow (warmup tail). | Improved (skip loading/precompiled commons). | Fast. | Near-instant. |
| **Peak throughput** | Highest (adaptive). | High (JIT still available). | Good, but no runtime respecialization. | Good; sandbox overhead. |
| **Memory (RSS) per replica** | Largest (cache+metadata+profiles). | Large-ish. | Small. | Small. |
| **Tail latency** | Warmup + compilation jitter. | Reduced. | Predictable, flat. | Predictable. |
| **Security (runtime codegen)** | RWX-ish surface; optimizer-bug CVEs. | Same (JIT present). | No runtime codegen — surface removed. | Compiled at build; strong sandbox. |
| **Dynamism / reflection** | Full. | Full. | Restricted; build-time config. | Module-scoped; capability-based. |
| **Operational complexity** | High (size/monitor compiler subsystem). | Medium-high. | Build pipeline + reflection config. | Build + cache pipeline. |
| **Fleet cost at scale-to-zero** | High (warmup × cold-starts). | Medium. | Low. | Lowest. |

---

## Use Cases

- **Operated tiered JIT** for saturated, long-lived services where peak throughput buys fewer machines and warmup amortizes — provided you size the code cache and compiler threads, pre-warm, and monitor deopt/compilation as tail-latency sources.
- **JIT + AppCDS/R2R** for latency-sensitive web tiers that redeploy often: cut first-request latency without surrendering the JIT or dynamism.
- **Closed-world AOT** where startup, memory, *or* the removal of the runtime-codegen attack surface is the requirement: CLIs, scale-to-zero serverless, hardened/locked-down environments (no-RWX platforms), dense microservice bin-packing.
- **Precompiled WASM at the edge** for multi-tenant, near-instant-cold-start, strongly-sandboxed compute — the model where the whole spectrum's lessons converge into a single modern deployment target.

---

## Coding Patterns

### Pattern 1: Make the compiler subsystem observable and bounded

Export and alert on code-cache occupancy, compilation queue length, compiler-thread CPU, and deopt rate. Bound them (`ReservedCodeCacheSize`, `CICompilerCount`) to the container's real limits.

```text
metrics: codecache_used / codecache_max, compile_queue_len, deopt_rate
alerts:  codecache_used > 0.8*max  (pre-empt silent interpreter fallback)
         deopt_rate spiking after a deploy (speculation destabilized)
limits:  CICompilerCount ≈ min(cpu_quota-1, default), sized to cgroup
```

### Pattern 2: Decouple "process up" from "ready for traffic"

Never join the load balancer on process start for a JIT'd service. Gate readiness on a warmup phase so users don't eat the interpreting tail.

```text
liveness:  process is up
readiness: hot paths warmed (replayed traffic) AND compile queue drained
```

### Pattern 3: Choose the model per deployment via a cost function

Codify the decision: estimate cold-start rate, replica count, RSS delta, tail penalty, and peak savings; pick interpret/JIT/R2R/AOT/precompiled-WASM accordingly, and re-evaluate when the workload's lifetime/restart profile changes.

### Pattern 4: Treat "runtime codegen allowed?" as a deployment constraint

Before targeting a JIT runtime, confirm the environment permits RWX/dynamic-codegen and that the optimizer-bug surface fits the trust model. If not (no-RWX platform, high-assurance sandbox), require AOT — it's a hard constraint, not a preference.

---

## Best Practices

- **Size and monitor the code cache; alert before exhaustion.** Its failure mode is a silent throughput cliff (fallback to interpreting), one of the nastiest JVM incidents precisely because there's no exception.
- **Cap compiler threads to the container's CPU quota.** Misdetected CPU counts spawn too many compiler threads that starve request handling, especially right after deploy.
- **Pre-warm before readiness; stagger deploys.** Shape the throughput distribution's tail; don't route real traffic to interpreting instances, and don't let many instances warm up in lockstep.
- **Put runtime codegen on the security review.** RWX memory and speculative-optimizer bugs are real CVEs; in hardened or no-RWX environments, AOT is mandatory, not optional.
- **Use the hybrids deliberately.** AppCDS/CDS, ReadyToRun, GraalVM dual-mode, and precompiled WASM are detents on the spectrum — match each to its deployment instead of picking an ideological end.
- **Decide with the cost function, validate with measurement.** Compute aggregate cost over lifetime × restart distribution, then confirm with like-for-like benchmarks at the matching lifecycle stage.
- **Track deopt rate as a leading indicator.** A deploy that destabilizes a hot speculation site shows up as a deopt spike before it shows up as a latency SLO breach.

---

## Edge Cases & Pitfalls

- **Silent code-cache exhaustion.** Long-uptime or method-heavy JVMs fill the code cache; compilation stops; hot code reverts to interpreting; throughput collapses with no error. Monitor occupancy and enable flushing/size appropriately.
- **Container CPU miscount → compiler-thread storm.** A runtime that counts host CPUs instead of the cgroup quota over-provisions compiler threads; post-deploy compilation starves the application. Enforce container-aware CPU detection and cap `CICompilerCount`.
- **Lockstep warmup during scale-out.** An autoscaling event spawns many fresh instances that all warm up simultaneously, producing a correlated fleet-wide latency spike. Stagger and pre-warm.
- **Routing traffic to un-warmed instances.** Readiness gated only on "process up" sends users to the interpreting phase; their p99 is dramatically worse. Gate readiness on warmup.
- **Assuming a JIT can run anywhere.** No-RWX platforms (certain iOS/console/hardened sandbox policies) forbid the writable-then-executable memory a classic JIT needs; the runtime must AOT or it simply won't run.
- **Treating the optimizer as trusted on untrusted input.** In browsers/edge multi-tenant runtimes, the JIT compiles attacker-controlled code; a single speculative-optimizer guard bug is a memory-safety exploit. This is why WASM's validate-then-sandbox design and edge AOT/precompilation are security features, not just speed.
- **WASM cold-start assumptions.** Browser WASM still has a (small) baseline-then-optimizing warmup; server/edge WASM is often AOT/precompiled for near-zero cold start. Conflating the two leads to wrong latency expectations.
- **Comparing across lifecycle stages.** Benchmarking a cold JIT against a native-AOT binary (or vice-versa) yields a meaningless fleet verdict; always compare at the lifecycle stage your production actually runs in, weighted by restart frequency.
- **Stale precompiled artifacts.** Precompiled WASM/R2R/PGO artifacts built against an old engine/profile can silently underperform or fail to load after a runtime upgrade; version and rebuild them in the pipeline.

---

## Cheat Sheet

```text
┌──────────────────────────────────────────────────────────────────┐
│      OPERATING EXECUTION MODELS AT SCALE: CPU · MEM · SEC · $     │
├──────────────────────────────────────────────────────────────────┤
│ The JIT is a TENANT with a budget you must size & monitor:        │
│   code cache (full → SILENT fallback to interpret → throughput    │
│     cliff, no exception)  → alert >80%, size, enable flushing     │
│   compiler threads (steal CPU; size to cgroup quota)              │
│   deopt metadata + profiles (RSS — why warmed JVM RSS ≫ AOT)      │
├──────────────────────────────────────────────────────────────────┤
│ Performance is a DISTRIBUTION over time/instances; SLOs live in   │
│ the TAIL: warmup tail, compilation jitter, deopt storms.          │
│   mitigate: PRE-WARM before readiness · stagger deploys ·         │
│   AppCDS/R2R for startup · alert on deopt rate                    │
├──────────────────────────────────────────────────────────────────┤
│ SECURITY: runtime codegen = attack surface                        │
│   RWX-ish memory · JIT spraying · speculative-optimizer CVEs.     │
│   AOT REMOVES it (no runtime codegen) — required on no-RWX        │
│   platforms & in hardened/untrusted-input environments.           │
├──────────────────────────────────────────────────────────────────┤
│ WASM = the spectrum, shipped everywhere:                          │
│   browser: tiered JIT (Liftoff baseline → TurboFan optimizing)    │
│   edge/server: AOT / precompiled (Wasmtime/Wasmer) → ~0 cold start│
├──────────────────────────────────────────────────────────────────┤
│ Choose the model by FLEET ECONOMICS, not a microbenchmark:        │
│   cost ≈ warmup_CPU·coldstart_rate + RSS·replicas·$ + tail_pen    │
│          − peak_throughput_savings                                │
│   scale-to-zero/serverless → AOT/precompiled-WASM                 │
│   saturated long-lived      → tuned, pre-warmed JIT (or R2R)      │
└──────────────────────────────────────────────────────────────────┘
```

---

## Summary

- A JIT is an **operable resource tenant**: its **code cache**, **compiler threads**, and **deopt/profile metadata** consume CPU, memory, and address space, each with a failure mode you must size, monitor, and alert on. Code-cache exhaustion is the signature incident — a **silent reversion to interpreting** with no exception.
- Production performance is a **distribution**, and SLOs live in its **tail**: warmup tails after deploy/scale-out, compilation jitter, and deopt storms. The mitigations are operational — **pre-warm before readiness, stagger deploys, use AppCDS/R2R, and watch deopt rate** as a leading indicator.
- **Runtime code generation is a security surface**: RWX-ish executable memory, JIT spraying, and speculative-optimizer type-confusion bugs (the engine of countless browser zero-days). **AOT eliminates this surface**, which makes it mandatory on no-RWX platforms and attractive wherever the runtime processes untrusted input. This is a first-class decision factor, not a footnote.
- **WebAssembly** ships the whole interpret/JIT/AOT spectrum to browsers and the edge: **tiered JIT** in the browser (Liftoff baseline → TurboFan optimizing) and **AOT/precompiled** modules on the server/edge for near-instant cold start with strong sandboxing — the same trade-offs you've studied, now the substrate of modern deployment.
- At scale the model choice is **economics**: `warmup_CPU·coldstart_rate + RSS·replicas·$ + tail_penalty − peak_savings`, evaluated over the workload's lifetime and restart distribution. Scale-to-zero/serverless pushes toward **AOT/precompiled-WASM**; saturated long-lived services toward a **tuned, pre-warmed JIT (or R2R)** — and the hybrids (CDS, R2R, GraalVM dual-mode) are **detents on a dial you tune per deployment**, not an ideological binary.

---

## Further Reading

- *Code cache and compiler tuning* — HotSpot `-XX:ReservedCodeCacheSize`, `-XX:CICompilerCount`, `-XX:+UseCodeCacheFlushing` documentation and JFR/`PrintCodeCache` diagnostics.
- *Application Class-Data Sharing (AppCDS)* — JEP 310/350 and the Oracle CDS guides for cutting JVM cold start.
- *Attacking Clientside JIT Compilers* and the broader literature on **JIT spraying** (Dion Blazakis et al.) — the security surface of runtime codegen.
- *V8 and SpiderMonkey security postmortems* — writeups of TurboFan/IonMonkey type-confusion exploits; the practical case that speculation is an attack surface.
- *W^X, RWX, and JIT hardening* — Apple's `pthread_jit_write_protect_np` and the platform discussions on running JITs under no-RWX policies.
- *Wasmtime and Wasmer documentation* — module compilation (Cranelift/LLVM), serialization, and precompiled/AOT caching for the edge.
- *Liftoff: a new baseline compiler for WebAssembly in V8* and *Up to 4GB of memory in WebAssembly* — V8 blog, for the browser WASM tiering model.
- *Containerize your Java applications* and JVM container-awareness (`UseContainerSupport`) guides — for cgroup-correct compiler-thread sizing.
- *Profile-Guided and AOT trade-offs at scale* — Google/Meta engineering writeups on PGO, AutoFDO, and warmup economics across large fleets.
