# Interpretation, Compilation, JIT, AOT — Senior Level

> **Topic:** [Interpretation, Compilation, JIT, AOT](README.md)
> **Focus:** Speculative optimization and deoptimization, method-JIT vs meta-tracing JIT, AOT for managed languages and the closed-world assumption, PGO, and the startup-vs-peak engineering decision.

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

> Focus: **The hard parts.** How does a JIT *un-compile* code when its bets go wrong? Why are there two architecturally different kinds of JIT — method-based and meta-tracing? What does it actually take to AOT-compile a language that was designed around a JIT, and what breaks? And how do you reason about the startup-vs-peak trade-off as an engineering decision rather than a slogan?

By this level you can describe the JIT pipeline and tiering. The senior questions are the ones that decide real systems:

- **Deoptimization** is the linchpin that *makes speculation safe.* A JIT bets that a variable is always an int; when a float finally shows up, the JIT must *abandon the compiled code and resume in the interpreter at exactly the right point*, with all live state correctly reconstructed. Get this wrong and you corrupt the program. Understanding deopt is understanding why aggressive speculation is even legal.
- **Method JITs vs meta-tracing JITs** are two genuinely different philosophies. HotSpot, V8, RyuJIT compile *methods*. PyPy and LuaJIT trace *hot loops across method boundaries* and compile the resulting linear trace. The trade-offs (and failure modes — "trace explosion") are different.
- **AOT for managed languages** (GraalVM native-image, .NET NativeAOT, CrossGen/ReadyToRun) is not "just compile it earlier." It forces a **closed-world assumption** that collides head-on with reflection, dynamic class loading, and runtime code generation. The senior question is *what you give up and how you cope.*
- **PGO** is how AOT claws back *some* of the JIT's profile advantage — collect a profile in a training run, feed it to the AOT compiler. It's the bridge between the two worlds.

This page treats these as design decisions with quantifiable trade-offs. The professional level goes deeper into the compiler internals (SSA, deopt metadata layout, code-cache management) and large-scale economics.

---

## Prerequisites

- **Required:** The middle-level model — dispatch, the JIT-as-runtime-compiler picture, tiered compilation, warmup, OSR.
- **Required:** Comfort with the idea of inlining, virtual dispatch, and what "the stack" and "a stack frame" are.
- **Required:** A working notion of "guard" — a runtime check protecting a speculative assumption.
- **Helpful:** Exposure to one managed runtime's internals (HotSpot, V8, or CLR) at the level of "I've read a `PrintCompilation`/`--trace-opt` log."
- **Helpful:** Awareness that reflection, serialization, and dynamic proxies are "open-world" features.

---

## Glossary

| Term | Definition |
|------|-----------|
| **Speculative optimization** | Compiling code that's correct only under an assumption (a type, a branch, a class hierarchy state), guarded so it can be undone. |
| **Guard** | A cheap runtime check that the speculative assumption still holds; on failure it triggers deoptimization. |
| **Deoptimization (deopt)** | Discarding compiled code and resuming execution in the interpreter (or a lower tier) at the equivalent point, reconstructing all live state. |
| **Uncommon trap** | HotSpot's term for the deopt point a guard jumps to when a speculation fails. |
| **Deopt metadata** | Per-compiled-point bookkeeping mapping compiled-code state (registers/stack slots) back to interpreter state, so deopt can reconstruct the frame. |
| **Method JIT** | A JIT whose unit of compilation is a method/function (HotSpot, V8, RyuJIT). |
| **Meta-tracing JIT** | A JIT that records (traces) the actual instruction path through a hot loop — across method boundaries — and compiles that linear trace (PyPy, LuaJIT). |
| **Trace** | A recorded linear sequence of operations actually executed on one path through a hot loop. |
| **Trace explosion** | Pathology where a meta-tracing JIT records too many divergent traces for branchy code, blowing up code size and compile time. |
| **PGO (Profile-Guided Optimization)** | AOT compilation informed by a profile collected from a representative training run. |
| **Closed-world assumption** | The AOT premise that *all* reachable code is known at build time; nothing new is loaded or generated at runtime. |
| **Reachability analysis** | Static analysis (points-to / call-graph) that determines which code is reachable, so unreachable code can be dropped. |
| **native-image** | GraalVM's AOT compiler turning JVM bytecode into a standalone native executable under closed-world assumptions. |
| **NativeAOT** | .NET's AOT compiler producing a self-contained native binary without the JIT. |
| **ReadyToRun (R2R) / CrossGen** | .NET's *partial* AOT: precompile IL to native at build/publish time, but keep the JIT available for what's left (a hybrid). |
| **Substitution / config (for AOT)** | Build-time declarations (reflection config, substitutions) that tell a closed-world AOT compiler about dynamic behavior it can't infer. |

---

## Core Concepts

### 1. Deoptimization: the mechanism that makes speculation legal

A JIT's aggressive speedups (assume-int, assume-monomorphic, assume-this-branch) are *bets on the past*. Bets can be wrong. **Deoptimization** is the safety net that lets the JIT make those bets without risking correctness.

The mechanism:

1. When the JIT compiles a method under an assumption, it inserts a **guard** that checks the assumption and, at every guard, records **deopt metadata**: a precise map from the compiled code's state (which value lives in which register or stack slot) back to the *interpreter's* notion of state (which local variable, what bytecode index).
2. The compiled code runs at full speed as long as guards pass.
3. When a guard fails — a float arrives where only ints were seen, a never-taken branch finally fires, a new subclass is loaded that breaks a devirtualization — the code jumps to the **uncommon trap**.
4. The runtime uses the deopt metadata to **reconstruct an interpreter frame** from the compiled-code state, discards (or marks not-entrant) the now-invalid compiled code, and **resumes execution in the interpreter** at the exact equivalent point. The program continues correctly; only speed is lost.

The conceptual payoff: **deopt converts "this might not always be true" into "this is true until proven otherwise, and we can recover instantly when disproven."** That's what licenses a JIT to inline a virtual call to a single target, or to compile an arithmetic loop as if everything is an `int`. Without deopt, none of the speculation would be sound — you'd be limited to optimizations provable for *all* inputs, which is roughly what AOT is stuck with.

Deopt is *expensive* when it happens (rebuild frame, fall back to interpreting, possibly recompile later), so the JIT only speculates where the profile says the bet is very likely to hold. Repeated deopt at the same site ("deopt loop") is a real performance bug: the JIT compiles, a guard fails, it deopts, recompiles, fails again — thrashing. Mature runtimes detect this and recompile *without* that particular speculation.

### 2. Method JITs vs meta-tracing JITs

Two architectures, two philosophies.

**Method JITs (HotSpot, V8, RyuJIT, most mainstream)** take a whole method as the compilation unit. Hotness is per-method (and per-loop via OSR). Inlining is how they cross method boundaries: the optimizer pulls callees' bodies into the caller and optimizes the merged code. This is well-understood, maps cleanly onto profiles per method, and is the default everywhere.

**Meta-tracing JITs (PyPy, LuaJIT)** take a radically different unit: the **trace** — the actual linear sequence of operations executed on *one path* through a hot loop, *following calls across method boundaries naturally.* When a loop gets hot, the runtime switches to "tracing mode," records every operation actually executed for one iteration (including into and out of called functions), and compiles that straight-line trace, with guards at every point where control could have diverged. Subsequent iterations run the trace; if a guard fails (the path diverged), control falls back and possibly a new trace is recorded for the other path.

Why meta-tracing? For dynamic languages it's spectacularly effective: the trace is *already specialized* to the observed types and the taken path, inlining happens "for free" by following the calls, and the compiler only ever sees straight-line code (easy to optimize). PyPy is "meta" because the tracer traces the *interpreter* executing the program, not the program directly — write an interpreter, get a tracing JIT for that language almost for free. LuaJIT's tracing JIT is one of the fastest dynamic-language implementations ever built.

The failure mode is **trace explosion**: code with many branches (or many type combinations) generates many divergent traces, exploding code size and compile time, and side exits (guard failures) become frequent enough to erase the benefit. Method JITs degrade more gracefully on branchy code; tracing JITs shine on loop-dominated, type-stable code and struggle on irregular control flow. This trade-off is *the* reason mainstream general-purpose runtimes chose method JITs while specialized dynamic-language implementations chose tracing.

### 3. AOT for managed languages, and the closed-world assumption

For C/C++/Rust/Go, AOT is the native state — the compiler sees all the code (modulo dynamic linking) and there's no JIT. The interesting senior topic is AOT for languages *built around* a JIT: Java and C#.

**The motivation** is concrete and economic: JIT warmup + the JIT's memory footprint are intolerable for short-lived or scale-to-zero workloads. A serverless function that cold-starts on every burst pays warmup on every burst; a CLI never warms up at all; a containerized microservice scaled to dozens of replicas wants each replica to boot in tens of milliseconds with a small RSS, not seconds with hundreds of MB. **AOT delivers fast startup, low memory, and no warmup** — exactly the three things a JIT is worst at.

**The cost** is the **closed-world assumption.** A native-image AOT compiler does whole-program **reachability analysis**: starting from the entry points, it computes the transitive set of reachable methods and types, and *removes everything else* (this is also why native images are small). For this to be correct, *all reachable code must be visible at build time.* That premise collides with the "open-world" features that make managed languages dynamic:

- **Reflection** — `Class.forName("com.x.Y")`, looking up a method by string name at runtime. The AOT compiler can't see that `Y` is used, so it gets dropped. Fix: declare it in a reflection config so the compiler keeps it.
- **Dynamic class loading** — loading bytecode at runtime (plugins, JSP, agents). Fundamentally incompatible with closed-world; generally not supported.
- **Runtime code generation / dynamic proxies** — frameworks that synthesize classes on the fly (many ORMs, mocking libraries, dependency-injection containers historically) must be reworked to generate that code at *build* time instead.
- **Serialization that reflects over arbitrary types** — must be told, at build time, which types to support.

So AOT for managed languages is a **trade of dynamism for startup/memory.** GraalVM native-image addresses it with build-time configuration (reflection/resource/proxy config, often auto-generated by a tracing agent run during testing) and build-time initialization (run static initializers at build time, bake the heap into the image). .NET NativeAOT makes similar demands; the framework and popular libraries have been steadily reworked to be "AOT-friendly" (source generators replacing runtime reflection — e.g. `System.Text.Json`'s source-generated serializers). **The second thing you give up is the JIT's runtime adaptive specialization** — an AOT'd managed program can't respecialize on observed types or devirtualize based on what actually loaded, so its *peak* throughput on long runs can trail a warmed-up JIT.

### 4. ReadyToRun / CrossGen: the hybrid middle

.NET offers a pragmatic in-between: **ReadyToRun (R2R)** images (produced by **CrossGen**) precompile IL to native code *at publish time*, but **keep the JIT in the process.** Startup improves because the common paths are already native — no JIT needed to begin running. But the JIT remains available to (re)optimize hot code with profiles (tiered compilation can promote R2R code to fully optimized Tier-1), and dynamic features still work because the runtime is intact. **R2R trades some of native-AOT's footprint/startup wins for keeping full dynamism and the option of peak JIT optimization.** It's the "fast startup without giving up the JIT" choice, distinct from NativeAOT's "no JIT at all." This three-way menu — full JIT, R2R hybrid, NativeAOT — is the clearest illustration that the execution model is a *spectrum you tune*, not a binary you pick.

### 5. PGO: giving AOT a taste of the profile advantage

The JIT's structural edge is *profiles*. AOT can borrow that edge **offline** with **Profile-Guided Optimization**: build an instrumented binary, run it on representative inputs to collect a profile (branch frequencies, hot functions, call targets), then build a *second* binary using that profile to guide inlining decisions, block layout, and devirtualization. C/C++/Rust/Go all support PGO; GraalVM native-image and .NET support PGO flavors too.

The key distinctions from a JIT:

- PGO's profile is from a *training* run, not the *current* run. If production behavior differs from training, the bets can be wrong — and unlike a JIT, **there's no deopt to recover**; the misprediction just costs you. So PGO profiles must be representative.
- PGO is *static*: it picks one layout for the whole program's lifetime. A JIT can *respecialize* when behavior shifts. PGO can't adapt to phase changes within a run.
- PGO still can't do what closed-world AOT forbids (runtime devirtualization on classes loaded later, etc.), but it captures most of the *common-case layout* benefit.

PGO is the senior's lever for narrowing the AOT-vs-JIT peak gap on workloads with stable, representative behavior — at the cost of a more complex build and the risk of a stale or unrepresentative profile.

### 6. Startup vs peak, framed as an engineering decision

The slogans ("Java is slow to warm, fast at peak"; "use AOT for CLIs") become a decision procedure:

```text
Estimate the workload's lifetime and start frequency, then integrate
throughput-over-time:

  • If process lifetime ≪ warmup time (CLI, scale-to-zero serverless),
    the JIT never reaches peak — AOT (native-image / NativeAOT) wins on
    every axis that matters: startup, memory, predictability.

  • If process lifetime ≫ warmup time (long-lived server, hours/days),
    warmup is amortized; the JIT's peak + adaptivity usually win,
    AND you keep full dynamism. R2R is a fine compromise to cut the
    first-request latency without losing the JIT.

  • If start frequency is high AND lifetime is moderate (autoscaling
    microservices, frequent redeploys), repeated re-warming is a real
    tax — measure it; AOT or R2R often wins on aggregate even though a
    warmed JIT would win a single steady-state benchmark.
```

This is why serverless *resurrected* AOT for managed languages: the economics of cold start inverted the decades-old "JIT is just better for servers" assumption. The senior skill is computing the area under the throughput curve for *your* lifetime distribution, not quoting a steady-state microbenchmark.

---

## Real-World Analogies

| Concept | Real-world thing |
|---------|------------------|
| **Speculation + guard** | A factory that retools to mass-produce one product, with a quick inspection at the start of each batch to confirm the order hasn't changed. |
| **Deoptimization** | That factory getting a "wrong product" alert mid-run, instantly reverting to the slow general-purpose line, and rebuilding the half-finished item correctly. |
| **Deopt metadata** | The detailed paperwork mapping the specialized line's half-built state back to the general line's process, so nothing is lost in the switch. |
| **Method JIT** | Optimizing each department's workflow in isolation, then merging departments by physically combining their lines (inlining). |
| **Meta-tracing JIT** | Following one customer's entire journey end-to-end across all departments, then building a dedicated express lane for *that exact path*. |
| **Trace explosion** | Building a separate express lane for every slightly different customer journey until the warehouse is nothing but lanes. |
| **Closed-world AOT** | Pre-packing a shipping container with *exactly* the items on the manifest and welding it shut — efficient, but you can't add anything en route. |
| **Reflection breaking AOT** | An item that was needed but wasn't on the manifest, so it got left out of the welded container. |
| **PGO** | Studying last quarter's orders to pre-arrange the warehouse, betting next quarter looks similar — with no way to rearrange mid-quarter if it doesn't. |
| **R2R hybrid** | Pre-packing the common items but keeping a worker on board who can fetch and optimize the rest as needed. |

---

## Mental Models

### The "Bet, Guard, Recover" Triad

Every adaptive optimization decomposes into three pieces: the **bet** (assume int / monomorphic / branch-not-taken), the **guard** (cheap check the bet still holds), and the **recovery** (deopt to a correct, slower execution). A JIT can be as aggressive as it likes *because the recovery exists.* AOT lacks the recovery, so it can only make bets that are *provably always true* — which is why it's conservative and why PGO (a static bet with no recovery) demands a representative profile.

### The "Compilation Unit Shapes the Optimizer" Model

What a JIT optimizes follows from what it treats as a *unit*. Method JITs see methods → they need inlining to cross boundaries and they reason about merged control flow. Tracing JITs see linear traces → inlining is automatic (follow the calls), the optimizer only ever faces straight-line code, but branchy programs fragment into many traces. Choose your unit and you've chosen your strengths and your failure mode.

### The "Open vs Closed World" Dial

Picture a dial from fully-open (everything resolvable at runtime: reflection, dynamic loading, JIT codegen — maximum flexibility, maximum startup cost) to fully-closed (everything fixed at build time: native-image — minimum flexibility, minimum startup/memory). Languages and deployment modes are *positions on this dial*: full JVM is open, R2R is mostly-open-with-precompiled-commons, native-image is closed. Engineering is choosing where on the dial your workload belongs.

### The "Area Under the Throughput Curve" Model

Don't compare JIT and AOT at a single point (steady-state) — integrate over the process lifetime. JIT is a curve rising to a high plateau; AOT is a flat line at a slightly-lower-but-immediate level. Multiply by *how often you start a fresh process.* The winner is whoever has more area under the curve for *your* lifetime-and-restart distribution. This reframes a religious debate as arithmetic.

---

## Code Examples

### Forcing — and observing — a deoptimization in the JVM

```java
public class Deopt {
    // The JIT will speculate this is always called with the same concrete type.
    static int describe(Object o) {
        return o.hashCode();           // virtual call: candidate for devirtualization
    }

    public static void main(String[] args) {
        Object intArg = Integer.valueOf(7);
        // Phase 1: hammer with ONE type -> JIT devirtualizes/inlines for Integer.
        for (int i = 0; i < 1_000_000; i++) describe(intArg);

        // Phase 2: introduce a NEW type -> the speculation's guard fails -> DEOPT.
        Object strArg = "now a String";
        for (int i = 0; i < 1_000_000; i++) describe(strArg);
    }
}
```

Run with:

```bash
java -XX:+PrintCompilation -XX:+UnlockDiagnosticVMOptions -XX:+PrintInlining Deopt
```

In phase 1, `describe` compiles and inlines `Integer.hashCode`. When phase 2 introduces `String`, the inline-cache guard fails and you'll see a `made not entrant` / uncommon-trap deopt, followed by recompilation as a more general (megamorphic) version. This is the bet → guard → deopt → recompile cycle, observable.

### Provoking a deopt loop (the anti-pattern)

```java
// Alternating types at the SAME hot call site -> repeated deopt thrash.
static final Object[] inputs = { 1, "two", 3.0, 1, "two", 3.0 };
static int hot(Object o) { return o.hashCode(); }

public static void main(String[] a) {
    for (int i = 0; i < 100_000_000; i++) hot(inputs[i % inputs.length]);
}
```

The call site is *megamorphic and unstable*: the JIT can't find a stable bet, may deopt repeatedly before giving up and emitting general (slow) dispatch. The lesson: keep hot call sites type-stable; instability poisons speculation.

### GraalVM native-image hitting the closed-world wall

```java
public class Reflect {
    public static void main(String[] args) throws Exception {
        // Class named by a runtime string -> invisible to reachability analysis.
        Class<?> c = Class.forName(args[0]);
        Object o = c.getDeclaredConstructor().newInstance();
        System.out.println(o);
    }
}
```

```bash
native-image Reflect
./reflect com.example.Thing
# -> ClassNotFoundException: the class was pruned, the AOT compiler never saw it used.
```

The fix is a `reflect-config.json` (or `@RegisterForReflection`, or running the tracing agent during tests to auto-generate the config) telling native-image to retain `com.example.Thing`. This is the closed-world assumption made tangible: *if the compiler can't see it reachable, it isn't there.*

### Building a .NET app three ways (the spectrum, as build flags)

```bash
# 1) Pure JIT: classic, full dynamism, warmup on first calls.
dotnet build -c Release

# 2) ReadyToRun (CrossGen): precompile common paths, keep the JIT.
dotnet publish -c Release -p:PublishReadyToRun=true

# 3) NativeAOT: no JIT, closed-world, fast startup + small footprint.
dotnet publish -c Release -p:PublishAot=true
```

Measure startup and steady-state for each on *your* workload. You'll typically see NativeAOT start fastest with smallest RSS, R2R in between, pure-JIT slowest to start but able to reach the highest peak after warmup. That measured table — not a slogan — is how a senior picks.

### PGO for an AOT (C) build

```bash
# 1) instrument
gcc -O2 -fprofile-generate hot.c -o hot_instrumented
# 2) train on representative input
./hot_instrumented < representative_workload.txt
# 3) rebuild using the collected profile
gcc -O2 -fprofile-use hot.c -o hot_optimized
```

`hot_optimized` lays out blocks and makes inlining/devirtualization choices guided by *observed* frequencies — an AOT approximation of the JIT's profile advantage, fixed for the binary's lifetime, only as good as the training data's representativeness.

---

## Pros & Cons

| Aspect | Method JIT | Meta-tracing JIT | Closed-world AOT (managed) | AOT + PGO (native) |
|--------|-----------|------------------|----------------------------|--------------------|
| **Cross-method optimization** | Via inlining; bounded by inlining budget. | Automatic (trace follows calls). | Whole-program at build time. | Whole-program + profile-guided. |
| **Adapts at runtime** | Yes (respecialize, OSR, deopt). | Yes (re-trace, side exits). | No. | No. |
| **Branchy code** | Degrades gracefully. | Risks trace explosion. | Fine. | Fine; layout guided by profile. |
| **Startup / memory** | Worst. | Worst. | Best. | Best (native). |
| **Dynamism (reflection, dynamic loading)** | Full. | Full. | Restricted; needs config; some unsupported. | Full (it's native C/Rust/Go anyway). |
| **Recovery from wrong bets** | Deopt. | Side exit. | None (build-time bets only). | None (training-time bets only). |
| **Implementation complexity** | High. | High and subtle. | High (reachability + config tooling). | Medium + build pipeline. |

---

## Use Cases

- **Method JITs** for general-purpose, long-lived, control-flow-diverse workloads: app servers, browsers, databases. The mainstream default for good reason.
- **Meta-tracing JITs** for loop-dominated, type-stable dynamic-language workloads: numeric Python under PyPy, hot Lua game/scripting loops under LuaJIT — where a single hot path repeats billions of times.
- **Closed-world AOT (native-image / NativeAOT)** for CLIs, serverless, scale-to-zero microservices, and anything where startup latency and memory are the product: fast boot, small RSS, no warmup, predictable.
- **R2R / CrossGen** for services that want to shave first-request latency without surrendering the JIT or dynamic features — a common production sweet spot for .NET web apps.
- **AOT + PGO** for native binaries (and AOT'd managed binaries) with stable, representative production behavior where you want maximum static-layout quality without a JIT.

---

## Coding Patterns

### Pattern 1: Keep speculation profitable — stabilize hot call sites

Design hot paths so the JIT's bets hold: avoid feeding one hot call site many unrelated types; prefer monomorphic or low-polymorphism dispatch where it's hot. Unstable sites cause deopt thrash and force fallback to slow general code.

### Pattern 2: Make your code AOT-ready by declaring dynamism at build time

If you target native-image or NativeAOT, push reflection/serialization/proxy needs to build time: use source generators (`System.Text.Json` source-gen, Micronaut/Quarkus build-time DI) instead of runtime reflection, and capture reflection config via the tracing agent during your test suite.

```text
runtime reflection  ──replace──▶  build-time source generation / config
dynamic proxy at runtime  ──replace──▶  compile-time generated implementation
```

### Pattern 3: Choose the execution mode per deployment, not per language

The same .NET or Java codebase can ship as full-JIT, R2R, or native-AOT depending on *where it runs.* Pattern: parameterize the build/publish mode by deployment target (CLI/lambda → AOT; long-lived web tier → JIT or R2R) rather than committing the whole org to one mode.

### Pattern 4: Treat PGO profiles as artifacts with a freshness contract

If you use PGO, version the profile, capture it from representative production-like traffic, and refresh it when behavior shifts. A stale profile silently degrades — there's no deopt to save you. Automate profile collection in the pipeline.

---

## Best Practices

- **Diagnose deopts before chasing micro-optimizations.** A hot method that keeps deoptimizing wastes far more than any arithmetic you could shave. Use `-XX:+PrintCompilation`/`--trace-deopt` to find deopt loops and remove the instability causing them.
- **Pick the compilation philosophy to match the workload's control flow.** Loop-heavy + type-stable favors tracing; branchy + polymorphic favors method JITs. Don't force a numeric kernel through a branchy general path or vice versa.
- **Budget the dynamism you actually need before choosing AOT.** Inventory reflection, dynamic loading, and runtime codegen up front; if they're load-bearing and irremovable, closed-world AOT may cost more than it saves.
- **Measure the area under the curve, not a steady-state point.** Decide JIT vs AOT vs R2R by integrating throughput over your real lifetime-and-restart distribution.
- **Keep PGO profiles representative and fresh.** Validate that training inputs match production; stale or skewed profiles can make PGO a net negative.
- **Prefer build-time over runtime metaprogramming in modern stacks.** Source generators and build-time DI keep you on the AOT-friendly path *and* often improve startup even under a JIT.

---

## Edge Cases & Pitfalls

- **Deopt loops (compile→deopt→recompile→deopt).** An unstable speculation site thrashes, often *slower* than never compiling. Caused by megamorphic/unstable hot call sites or values that violate an assumption intermittently. Stabilize the site or accept the general path.
- **Trace explosion in meta-tracing JITs.** Highly branchy code under PyPy/LuaJIT spawns many traces and frequent side exits, ballooning compile time and code size and erasing the speedup — the classic reason tracing isn't universal.
- **Reflection silently pruned by AOT.** Under native-image/NativeAOT, code reachable only via reflection is removed unless configured, surfacing as `ClassNotFoundException`/missing-member errors *at runtime in production*, not at build. Capture config via the tracing agent over a thorough test suite.
- **Build-time static initialization surprises.** native-image may run static initializers at *build* time and bake the result into the image — so a static field capturing build-machine state (a timestamp, a hostname, a random seed) gets frozen incorrectly. Control initialization timing explicitly.
- **Stale PGO profiles.** A profile from old traffic mis-guides block layout/inlining for new traffic, with no runtime recovery. Worse than no PGO if behavior drifted.
- **Assuming AOT always beats JIT at peak.** On long-lived, type-diverse workloads, a warmed JIT's runtime devirtualization and respecialization can out-throughput a closed-world AOT binary that froze its decisions at build time. Peak winner is workload-dependent.
- **Mixing tiers/modes incorrectly in benchmarks.** Comparing a cold JIT against a native-AOT binary (or a warmed JIT against AOT's first run) yields a meaningless verdict. Compare like-for-like at the lifecycle stage that matches production.
- **R2R misread as full AOT.** ReadyToRun keeps the JIT and still needs the runtime; it does not give NativeAOT's footprint or its no-runtime guarantees. Confusing the two leads to wrong deployment expectations.

---

## Cheat Sheet

```text
┌──────────────────────────────────────────────────────────────────┐
│        SPECULATION, JIT FLAVORS, AOT-FOR-MANAGED, PGO            │
├──────────────────────────────────────────────────────────────────┤
│ Adaptive optimization = BET + GUARD + RECOVER(deopt).             │
│   Deopt: guard fails → rebuild interpreter frame from deopt       │
│   metadata → resume interpreting → maybe recompile less boldly.   │
│   This is what MAKES aggressive speculation correct.              │
├──────────────────────────────────────────────────────────────────┤
│ Two JIT philosophies:                                             │
│   METHOD JIT (HotSpot, V8, RyuJIT): unit = method; inline to      │
│     cross boundaries; graceful on branchy code.                   │
│   META-TRACING (PyPy, LuaJIT): unit = linear trace of a hot loop  │
│     across calls; inlining free; risks TRACE EXPLOSION on branches│
├──────────────────────────────────────────────────────────────────┤
│ AOT for managed langs (GraalVM native-image, .NET NativeAOT):     │
│   + fast startup, low memory, NO warmup (CLI / serverless win)    │
│   − CLOSED-WORLD: reachability prunes unseen code                 │
│   − reflection / dynamic loading / runtime codegen break unless   │
│     declared at build time (config, source generators)            │
│   − no runtime adaptive specialization                            │
│   R2R / CrossGen (.NET): PARTIAL AOT, keeps the JIT — hybrid.     │
├──────────────────────────────────────────────────────────────────┤
│ PGO = AOT borrows a profile (offline training run):               │
│   captures common-case layout, BUT static + no deopt recovery,    │
│   so the profile must be representative & fresh.                  │
├──────────────────────────────────────────────────────────────────┤
│ Decide JIT vs AOT vs R2R by AREA UNDER THE THROUGHPUT CURVE       │
│ over your lifetime × restart-frequency — not a steady-state point.│
│   short-lived / scale-to-zero → AOT   long-lived → JIT/R2R        │
└──────────────────────────────────────────────────────────────────┘
```

---

## Summary

- **Deoptimization is the keystone:** a guard failing triggers reconstruction of an interpreter frame from deopt metadata and a fall back to interpreting. It converts "probably true" into "true until disproven, instantly recoverable," which is precisely what *legalizes* a JIT's aggressive, profile-driven speculation. AOT and PGO lack this recovery, so their bets must be build/training-time and conservative.
- **Method JITs vs meta-tracing JITs** are different bets on the compilation unit. Methods (HotSpot, V8, RyuJIT) cross boundaries via inlining and handle branchy code gracefully; traces (PyPy, LuaJIT) follow one hot path across calls — superb for loop-dominated, type-stable code, but vulnerable to **trace explosion** on branchy programs.
- **AOT for managed languages** (native-image, NativeAOT) buys **fast startup, low memory, no warmup** — at the price of the **closed-world assumption**, which prunes code not provably reachable and thus **breaks reflection, dynamic loading, and runtime codegen** unless declared at build time, and forfeits **runtime adaptive specialization**.
- **ReadyToRun/CrossGen** is the hybrid: precompile common paths but keep the JIT and full dynamism — a deliberate point between full JIT and full AOT.
- **PGO** lets AOT approximate the JIT's profile advantage via an offline training run — capturing common-case layout but statically, with no recovery, so the profile must stay representative.
- The startup-vs-peak choice is **engineering arithmetic**: integrate throughput over the process's lifetime and restart frequency. Short-lived/scale-to-zero → AOT; long-lived → a warmed JIT (or R2R to cut first-request latency). **Serverless cold-start economics are exactly why AOT resurged for managed languages.**

---

## Further Reading

- *Deoptimization* — the HotSpot "uncommon trap" design notes and Urs Hölzle & David Ungar's "Optimizing Dynamically-Dispatched Calls with Run-Time Type Feedback," the foundational work on type feedback and deopt (from the Self project).
- *Tracing the Meta-Level: PyPy's Tracing JIT Compiler* — Bolz, Cuni, Fijałkowski, Rigo. The canonical meta-tracing paper.
- *LuaJIT* documentation and Mike Pall's writings on trace compilation — the fastest practical tracing JIT.
- *GraalVM Native Image* — reachability analysis, reflection configuration, build-time initialization. https://www.graalvm.org/latest/reference-manual/native-image/
- *.NET Native AOT deployment* and *ReadyToRun* docs — Microsoft Learn. The full JIT / R2R / NativeAOT spectrum with trade-offs.
- *Profile-Guided Optimization* — GCC and Clang documentation; the Go and .NET PGO guides for the managed-language angle.
- *Initialize Once, Start Fast: Application Initialization at Build Time* — Wimmer et al., the native-image (Substrate VM) paper.
- *Crafting Interpreters* — for the interpreter foundations these JITs sit on top of. https://craftinginterpreters.com/
