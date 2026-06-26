# Compile-Time vs Runtime Trade-offs — Middle Level

> **Topic:** [Compile-Time vs Runtime Trade-offs](README.md)
> **Focus:** A dimension-by-dimension head-to-head. For each axis — performance, startup, size, safety, flexibility, observability, tooling, build/deploy, AOT — *why* the two approaches differ, with named frameworks and concrete numbers.

---

## Table of Contents

1. [Introduction](#introduction)
2. [Prerequisites](#prerequisites)
3. [Glossary](#glossary)
4. [Core Concepts](#core-concepts)
5. [The Nine Trade-Off Dimensions](#the-nine-trade-off-dimensions)
6. [Real-World Analogies](#real-world-analogies)
7. [Mental Models](#mental-models)
8. [Code Examples](#code-examples)
9. [Pros & Cons](#pros--cons)
10. [Use Cases](#use-cases)
11. [Coding Patterns](#coding-patterns)
12. [Best Practices](#best-practices)
13. [Edge Cases & Pitfalls](#edge-cases--pitfalls)
14. [Test Yourself](#test-yourself)
15. [Cheat Sheet](#cheat-sheet)
16. [Summary](#summary)

---

## Introduction

> Focus: **Stop talking about compile-time vs runtime as one fuzzy "fast vs flexible" trade-off. Break it into the nine concrete dimensions a senior engineer actually weighs.**

At the junior level the trade-off is a single intuition: compile-time pays once and is fast; runtime pays every time and is flexible. That's true but lossy. In real decisions you don't trade "speed for flexibility" in the abstract — you trade *specific, measurable things*: a 2.8s cold start vs a 40ms one; a `NoSuchMethodError` in prod vs a red build; a 12MB binary vs a 4MB one; an autocompleting IDE vs opaque magic.

This page takes the same canonical examples — **serialization** (Jackson reflection vs Rust serde derive) and **dependency injection** (Spring runtime DI vs Dagger/Micronaut/Quarkus compile-time DI) — and walks each of the nine trade-off dimensions head-to-head. By the end you should be able to say, for any metaprogramming task, *not* "compile-time is better" but "compile-time costs me X and Y here, buys me Z, and the deciding factor for this system is W."

The two running examples are deliberately the ones the industry argues about:

- **Serialization:** Jackson (Java, reflection-based, runtime) vs serde (Rust, derive-based, compile-time). Same job — objects ⇄ JSON — opposite ends of the axis.
- **Dependency injection:** Spring (classic, runtime reflective wiring at boot) vs Dagger (Java/Android, compile-time annotation processor) and Micronaut/Quarkus (compile-time DI on the server). The single clearest illustration of the startup-time dimension.

> 🧠 **Why a middle engineer needs this:** You'll be the one choosing libraries and explaining the choice in a PR review. "We picked serde because it's compile-time" is junior. "We picked the compile-time path because we deploy to native-image, the schema is fixed, and the per-request serialization is on our hot path — accepting a slower build and a bigger binary" is the level you're aiming for.

---

## Prerequisites

- **Required:** The junior-level model — compile-time vs runtime, "pay once vs pay every time," "known at build vs known at run."
- **Required:** Comfort reading code in two of {Java, Rust, Go, C++, Python}.
- **Required:** Having used at least one serialization library and ideally one DI framework.
- **Helpful:** Awareness of what a JIT compiler does (inlining hot code), and roughly what reflection costs.
- **Helpful:** Having deployed something to a serverless platform or built a native binary.

---

## Glossary

| Term | Definition |
|------|-----------|
| **Annotation processor** | A compile-time plugin (Java APT) that reads annotations and generates source/bytecode during the build. Dagger and Micronaut use this. |
| **Reflective scanning** | Walking the program's classes at startup via reflection to discover beans, routes, mappings — the classic boot-time cost. |
| **Monomorphization** | Generating a separate specialized copy of generic code per concrete type (Rust generics, C++ templates). Fast, but multiplies code. |
| **Inlining** | The optimizer replacing a function call with the function body, enabling further optimization. Reflective/virtual calls usually can't be inlined. |
| **Megamorphic call site** | A call site that dispatches to many different implementations, which the JIT can't speculate on/inline well. Reflection-heavy code trends this way. |
| **Tree-shaking** | A bundler removing code it can prove is unused (JS/TS). Reflection defeats it because "used" can't be proven statically. |
| **Trimming** | The .NET equivalent of tree-shaking for native/self-contained builds. Reflection breaks trimming the same way. |
| **Closed-world assumption** | The build assumes it sees all reachable code/types — required for aggressive AOT and dead-code elimination. |
| **reflect-config.json** | GraalVM's manifest telling native-image which classes/members will be reflected on, so it keeps them. Maintaining it is the "reflection tax" under AOT. |
| **Build-time wiring** | Generating the dependency graph / serializers / routes during the build so the runtime just executes them. |
| **Startup tax** | Time spent at boot doing meta-work before serving the first request; dominates serverless cold start. |

---

## Core Concepts

### The decision is multi-dimensional, and the dimensions conflict

There is no single ranking. Compile-time wins performance, startup, safety, tooling, and AOT; runtime wins flexibility and build simplicity, and is roughly a wash on size. A real decision weights these by *your* system:

```text
                COMPILE-TIME            RUNTIME
 performance      ████████ win           ██ lose
 startup          ████████ win           █  lose (cold start)
 binary size      ███ (bloat risk)       ███ (metadata)   ~ tie
 type safety      ████████ win (build)   █  lose (prod)
 flexibility      █  lose (frozen)       ████████ win
 observability    ██████ readable code   ███ live state    mixed
 tooling/IDE      ████████ win           █  lose
 build/deploy     build cost ↑           ████ simple build
 AOT/native-image ████████ win           █  needs config / breaks
```

The art is knowing which rows matter for the system in front of you. A long-running monolith barely cares about startup; a serverless function lives or dies by it.

### The same task lands on different points of the axis

"Serialize an object" isn't inherently compile-time or runtime — it's a *task* you can solve at either point. Jackson chose runtime (reflection), serde chose compile-time (derive). Spring chose runtime DI, Dagger chose compile-time DI. The task is identical; the *placement of the meta-level* differs, and that placement is the whole decision.

---

## The Nine Trade-Off Dimensions

### 1. Performance

**Compile-time:** the meta-work is gone by run time — the generated serializer/wiring is plain code the optimizer can inline and specialize. **Zero per-operation meta-cost.** serde's generated `Serialize` impl is essentially what you'd hand-write.

**Runtime:** every operation re-pays. Jackson reflectively reads fields, looks up getters, boxes values. Even with internal caching, the call sites are more polymorphic and harder for the JIT to inline; reflection trends toward megamorphic dispatch. Typical gap: reflection-based serialization is **several times slower** than generated code on hot paths, and the gap widens at high throughput.

> Nuance: a mature runtime library (Jackson) caches a lot — it doesn't *re-discover* fields on every call forever; it builds a plan once and reuses it. So "runtime = N× slower" is hot-path truth, not a constant. But the floor for compile-time is lower and more inlinable.

### 2. Startup Time (the cold-start dimension)

This is where the trade-off is starkest and most modern.

**Compile-time:** nothing to discover at boot — the DI graph, the routes, the serializers were all generated during the build. Quarkus and Micronaut wire everything at compile time and **boot in tens of milliseconds**.

**Runtime:** classic Spring scans the classpath, reads annotations reflectively, builds the bean graph, and creates proxies — **at startup, every time the process starts.** On a long-running server you pay this once and forget it. On **serverless**, where the process may cold-start per request burst, a 2–5 second boot is a latency disaster.

```text
            Spring (runtime DI)        Quarkus/Micronaut (compile-time DI)
 boot:      ~2–5 s (scan + wire)       ~0.02–0.1 s (graph pre-built)
 driver:    reflective classpath scan  build-time annotation processing
 native:    extra work to support      native-image is a first-class target
```

**Startup is the single biggest reason the industry moved toward compile-time.** Cold start is a real user-facing latency, and serverless made it impossible to ignore.

### 3. Binary / Artifact Size

Not a clean win for either side.

**Compile-time can bloat:** code generation emits a function per type; Rust **monomorphization** and C++ **templates** emit a specialized copy per concrete type — code size grows with the number of type combinations. A heavily generic codebase can balloon.

**Runtime has its own weight:** reflection requires keeping **metadata** (field names, type info, annotations) in the artifact, and the reflection machinery itself. You don't generate per-type code, but you carry the introspection tables.

Net: often a **wash**, sometimes compile-time is bigger (template/monomorphization explosion), sometimes runtime is bigger (metadata + framework). Measure; don't assume.

### 4. Type Safety / Error Timing

**Compile-time = fail fast.** If a derive can't generate a serializer (a field isn't serializable), or a Dagger graph is missing a binding, the **build fails** — red on your screen, before merge. The guarantee is *static*: if it built, the wiring/serialization is structurally sound.

**Runtime = fail late.** Spring's missing bean is a `NoSuchBeanDefinitionException` *at startup*; a reflective method typo is a `NoSuchMethodError` *when that path runs* — potentially in production, potentially at 3 a.m., on the one code path your tests missed. No static check caught it because the call was resolved by string/name at run time.

This is a correctness *and* a velocity argument: compile-time errors are cheaper to fix because they're closer to the keystroke that caused them.

### 5. Flexibility / Dynamism

The dimension where **runtime wins outright.**

**Runtime** can do things compile-time cannot, because it can act on information that didn't exist at build time:

- Deserialize JSON whose **schema is decided at run time** (config-driven, polymorphic, `@JsonTypeInfo`).
- Load a **plugin** compiled separately and discovered in a folder at startup.
- **Hot-reload** code, swap implementations live.
- Power a **REPL** or scripting layer where users type new code.

**Compile-time** is **frozen / closed-world**: it can only handle the types and shapes you built for. If a requirement is "accept a type we'll only know about after deployment," compile-time literally can't.

The decision pivot: **is the variation known at build time, or only at run time?** If genuinely late → you *need* runtime, full stop.

### 6. Observability / Debuggability

Mixed, and subtler than it looks.

**Compile-time** generated code is **real source** (or readable bytecode). You can open the generated serializer, set a breakpoint, step through it, read it in a stack trace. Dagger's generated `*_Factory.java` files are right there in your build output. Debugging is "just debugging normal code."

**Runtime** magic is **harder to trace** — stack traces dive into framework reflection internals, proxies obscure the real call, and "where did this value come from?" leads into a reflective maze. *But* runtime has a unique power: it can **inspect live program state** — dump every bean, list every registered handler, introspect the actual running object graph. Compile-time froze that information into code; runtime can still ask the live system.

So: compile-time is easier to *step through*; runtime is better at *live introspection*. Different observability strengths.

### 7. Tooling / IDE Support

**Compile-time** plays well with static tooling. Generated code gets **autocomplete, go-to-definition, refactoring, and static analysis** because it's real code the IDE sees. A generated `UserSerializer` is as discoverable as a hand-written one.

**Runtime** **defeats static analysis.** A reflective `invoke("doThing")` is invisible to "find usages" and "rename" — refactor `doThing` and the string silently rots. IDEs, linters, and dead-code detectors can't follow reflection, so they either give up or warn. This is a real maintenance cost that compounds over a codebase's life.

### 8. Build Complexity vs Deploy Simplicity

A direct cost transfer.

**Compile-time** pushes cost **into the build**: you run generators/macros/annotation processors, builds get **slower**, and you maintain that generation machinery (a broken generator blocks everyone). The reward is a simple, fast, self-contained runtime artifact.

**Runtime** keeps the **build simple** — no codegen, fast compiles, fewer moving parts — but **ships the cost** with the program (slower startup, per-call overhead, the runtime framework). You didn't delete the work; you moved it to every machine that runs the app.

The right question: *do you want to pay in your CI once, or on every production machine forever?* For widely deployed or latency-sensitive software, paying once in CI is usually the better trade.

### 9. AOT / Native-Image Compatibility

The dimension that turned a preference into a *forcing function*.

**AOT compilers** (GraalVM native-image, .NET Native AOT) and **bundlers** (tree-shaking, .NET trimming) need a **closed world** — they must see all reachable code to eliminate the rest and produce a self-contained, instantly-starting binary.

**Compile-time** approaches are **native-image-native**: the wiring and serializers are ordinary reachable code, so AOT keeps and optimizes them. Quarkus and Micronaut were *designed* around this.

**Runtime reflection breaks the closed-world assumption.** Native-image can't know which classes you'll reflect on, so reflective code either **breaks** at run time or requires a hand-maintained **`reflect-config.json`** listing every reflected member. Tree-shaking removes "unused" code that reflection actually uses. This friction is a major modern driver pushing teams from reflection to codegen.

```text
 NATIVE-IMAGE / TREE-SHAKING / TRIMMING
   compile-time codegen → reachable code → kept & optimized ✓
   runtime reflection   → opaque to analysis → break OR hand-write config ✗
```

---

## Real-World Analogies

| Concept | Real-world thing |
|---------|------------------|
| **Compile-time DI (Dagger/Quarkus)** | Pre-assembling furniture at the factory; it arrives ready to use, boots instantly. |
| **Runtime DI (Spring)** | Flat-pack furniture you assemble on arrival every time you move house — flexible, but slow to "boot." |
| **Cold start tax** | The flat-pack assembly time, paid each new home (each cold start). |
| **Monomorphization bloat** | Printing a separate manual for every furniture model instead of one adjustable manual. |
| **Reflection defeating tree-shaking** | A warehouse can't throw out boxes because someone *might* ask for them by name later. |
| **reflect-config.json** | A guest list you must hand-write so the bouncer (native-image) lets the right reflected members in. |
| **Compile-time fail-fast** | The factory rejecting a mis-cut part on the line, not after delivery. |
| **Runtime live introspection** | Being able to walk through the finished building and ask each room what it's for, while it's occupied. |

---

## Mental Models

### The "Cost Conservation" Model

Meta-work is never free; you only choose **where it's paid**. Compile-time bills your CI (slow builds, big binary). Runtime bills production (startup, per-call). Think of it as conservation of cost: pushing the meta-level earlier reduces runtime cost but raises build cost, and vice versa. The decision is *which budget can absorb it.*

### The "Weighted Dimensions" Model

Don't ask "which is better?" Ask "what's the weight of each row for this system?" A serverless API weights **startup** and **AOT** heavily → compile-time. A plugin-driven IDE weights **flexibility** heavily → runtime. Same nine dimensions, different weights, different answer. Seniority is choosing the weights honestly.

### The "Forcing Function" Model

Some constraints aren't preferences — they *force* a side. "We must run as a native-image" forces compile-time (or a heavy reflection-config burden). "We must load third-party plugins discovered at run time" forces runtime. Identify forcing functions first; they collapse the decision before you even weigh the soft dimensions.

---

## Code Examples

### Serialization: runtime (Jackson) vs compile-time (serde)

```java
// Jackson — RUNTIME reflection. No codegen; the mapper inspects User's
// fields/getters reflectively (caching a plan after first use).
ObjectMapper mapper = new ObjectMapper();
String json = mapper.writeValueAsString(new User("Ada", 36));
// Flexible: handles polymorphism, unknown shapes, @JsonTypeInfo.
// Cost: reflective dispatch, native-image needs reflect-config.
```

```rust
// serde — COMPILE-TIME. #[derive(Serialize)] generates a User-specific
// serializer during the build. Run time = plain, inlinable code.
#[derive(serde::Serialize)]
struct User { name: String, age: u32 }

let json = serde_json::to_string(&User { name: "Ada".into(), age: 36 }).unwrap();
// Fast, AOT-native. Cost: macro expansion at build, frozen to known types.
```

### Dependency injection: runtime (Spring) vs compile-time (Dagger)

```java
// Spring — RUNTIME DI. At startup, Spring scans the classpath, reads
// @Component/@Autowired reflectively, builds the bean graph, makes proxies.
@Component class OrderService {
    @Autowired OrderService(PaymentGateway gw, Repo repo) { /* ... */ }
}
// Flexible (profiles, conditional beans, runtime config) but pays a
// reflective startup tax and needs native-image support work.
```

```java
// Dagger — COMPILE-TIME DI via an annotation processor. The build
// generates explicit factories; the "graph" is plain generated code.
@Component interface AppGraph { OrderService orderService(); }
// Generated at build: DaggerAppGraph + OrderService_Factory (real .java).
// Missing binding? BUILD fails. Boot is instant. Native-image friendly.
```

### The startup difference, made concrete

```text
$ time java -jar spring-app.jar      # reflective scan + wire at boot
   ... started in 2.7 s

$ time ./quarkus-native              # graph pre-built at compile time
   ... started in 0.018 s
```

Two orders of magnitude — and that gap *is* the difference between a usable and an unusable serverless function.

### Reflection vs native-image (the breakage)

```text
# Works on the JVM:
obj.getClass().getMethod("process").invoke(obj);   // fine

# Same code in native-image, no config:
#   com.oracle.svm.core.jdk.UnsupportedFeatureError /
#   ReflectiveOperationException: method not registered
#
# Fix (the tax): add to reflect-config.json
#   { "name": "com.app.Worker", "methods": [ { "name": "process" } ] }
```

---

## Pros & Cons

| Dimension | Compile-time | Runtime |
|-----------|-------------|---------|
| **Performance** | Inlinable, zero meta-cost (serde-class). | Per-op overhead, megamorphic, harder to inline. |
| **Startup** | Tens of ms (graph pre-built). | Seconds (reflective scan/wire) — cold-start killer. |
| **Binary size** | Bloat risk (monomorphization, codegen, templates). | Metadata + framework weight. ~ wash. |
| **Type safety** | Build-time, fail fast, static guarantee. | Prod-time, fail late, no static check. |
| **Flexibility** | Frozen/closed-world. | Plugins, dynamic schema, hot reload, REPL. |
| **Observability** | Readable generated code, steppable. | Opaque stack traces, **but** live introspection. |
| **Tooling/IDE** | Autocomplete, refactor, static analysis work. | Defeats find-usages/rename/dead-code. |
| **Build vs deploy** | Slow build, generator upkeep / simple runtime. | Simple build / cost ships to prod. |
| **AOT/native-image** | First-class. | Breaks or needs `reflect-config.json` / trimming hints. |

---

## Use Cases

**Compile-time fits:** serverless functions, CLIs, edge/native-image deploys, hot serialization paths, fixed-schema APIs, anything tree-shaken (web bundles) or trimmed (.NET), and codebases that value fail-fast wiring (Dagger on Android to keep apps lean and startup fast).

**Runtime fits:** plugin hosts and extension systems, config-driven/polymorphic serialization, scripting/REPL layers, hot-reload dev loops, admin/introspection tools that walk the live object graph, and prototypes where flexibility and build simplicity beat peak performance.

**Hybrid is common:** Jackson caches its reflective plan (runtime, but amortized); Spring added AOT/native-image support that *moves* some wiring to build time; Quarkus is "Spring-like ergonomics, compile-time mechanics." The frontier is having it both ways.

---

## Coding Patterns

### Pattern 1: Identify forcing functions first

Before weighing soft dimensions, check for hard constraints: native-image? serverless cold start budget? third-party plugins at run time? A forcing function often decides it outright.

### Pattern 2: Amortize unavoidable reflection

If you must reflect, build the plan **once** (at startup or first use) and reuse it — exactly what Jackson does. Turns "pay every call" into "pay once," recovering most of the performance gap.

### Pattern 3: Confine dynamism to a boundary

Keep the open-world part (plugin loader, dynamic deserializer) at a thin edge; make everything inside it compile-time and fast. You localize the cost and the unsafety.

### Pattern 4: Prefer build-time wiring for fixed graphs

If your dependency graph or route table is fixed at build, generate it (Dagger/Micronaut-style). Reserve runtime wiring for genuinely conditional/profile-driven cases.

### Pattern 5: Make the deploy target explicit in the decision

Write down "we deploy to X" before choosing a library. The same choice (Jackson vs serde, Spring vs Quarkus) flips depending on whether X is a long-running JVM or a native-image serverless function.

---

## Best Practices

- **Decompose the trade-off into the nine dimensions** and weight them for *this* system; never argue "compile-time is better" in the abstract.
- **Treat startup as a first-class metric** if you deploy serverless or short-lived processes — it's often the deciding dimension.
- **Assume native-image/trimming will come** for anything cloud-deployed; reflection-heavy choices age into a `reflect-config.json` maintenance burden.
- **Read the generated artifacts** of compile-time tools — they're a debugging and trust advantage you should actually use.
- **Cache reflection plans** when you stay runtime; never re-discover structure per call.
- **Don't pay codegen complexity for cold paths.** A twice-a-day admin endpoint doesn't need a generator; reflection's overhead is irrelevant there.
- **Watch build times.** Heavy macros/processors can dominate CI; measure and budget for it like any other cost.

---

## Edge Cases & Pitfalls

- **"Runtime is always slower" is too strong.** A well-cached reflective library is fast enough for most paths; the gap matters on *hot* paths and at *startup*, not everywhere.
- **"Compile-time is always smaller" is false.** Monomorphization/template/codegen explosion can make compile-time *bigger* than reflection + metadata.
- **The reflect-config drift trap.** Native-image works in CI, then a new reflected class is added and someone forgets the config entry → runtime failure only on that path.
- **Hidden startup cost in "fast" frameworks.** Even compile-time frameworks can have a startup cost if they do *some* runtime discovery; measure, don't assume the label.
- **Refactor rot through reflection.** Renaming a method silently breaks `invoke("oldName")`; tooling can't help. A maintenance time bomb.
- **Generated code you can't read.** If a tool emits unreadable output, you lose the observability advantage that justified compile-time in the first place.
- **Build-time work blocking the team.** A flaky generator or slow annotation processor turns into shared pain; runtime would have kept the build simple.

---

## Test Yourself

1. List the nine trade-off dimensions from memory. For each, say which side (compile-time/runtime) tends to win and one reason.
2. Why is **startup time** the dimension most responsible for the industry's shift toward compile-time? Tie it to serverless.
3. Jackson caches its reflective plan after first use. How does that change the naive "runtime is N× slower" claim?
4. Explain why **binary size** is *not* a clean win for compile-time. Give a mechanism that makes compile-time bigger.
5. A reflective method call works on the JVM and fails under native-image. Name the closed-world assumption it violates and the file you'd edit to fix it.
6. Give one observability strength of compile-time and one *different* observability strength of runtime.
7. You're choosing between Spring and Quarkus for a function that cold-starts on every traffic burst. Which dimensions dominate, and what do you pick?
8. A teammate says "we should use serde because compile-time is just better." Rewrite that as a senior-level justification (or rebuttal), naming the dimensions that actually decide it.

---

## Cheat Sheet

```text
┌──────────────────────────────────────────────────────────────────────┐
│        NINE DIMENSIONS — COMPILE-TIME (C) vs RUNTIME (R)             │
├──────────────────────────────────────────────────────────────────────┤
│ 1 PERFORMANCE      C: inlinable, zero meta-cost | R: per-op, megamorph │
│ 2 STARTUP          C: ms (pre-built)            | R: s (scan/wire)     │
│ 3 BINARY SIZE      C: bloat (monomorph/codegen) | R: metadata  (~tie)  │
│ 4 TYPE SAFETY      C: fail fast @build          | R: fail late @prod   │
│ 5 FLEXIBILITY      C: frozen/closed-world       | R: plugins/dynamic ✦ │
│ 6 OBSERVABILITY    C: readable gen code         | R: live introspect   │
│ 7 TOOLING/IDE      C: autocomplete/refactor     | R: defeats analysis  │
│ 8 BUILD vs DEPLOY  C: slow build/simple deploy  | R: simple build/cost │
│ 9 AOT/NATIVE-IMG   C: first-class               | R: breaks/needs cfg  │
├──────────────────────────────────────────────────────────────────────┤
│ RUNNING EXAMPLES                                                      │
│   serde (C)  vs  Jackson (R)        — serialization                   │
│   Dagger/Micronaut/Quarkus (C) vs Spring (R) — dependency injection   │
├──────────────────────────────────────────────────────────────────────┤
│ DECIDE:  forcing functions first (native-image? cold start? plugins?) │
│          then weight the 9 rows for THIS system.                      │
│ COST IS CONSERVED: pay in CI once (C) or in prod forever (R).         │
└──────────────────────────────────────────────────────────────────────┘
```

---

## Summary

- The compile-time/runtime trade-off is **not one axis** — it's **nine concrete dimensions** that often conflict: performance, startup, binary size, type safety, flexibility, observability, tooling, build/deploy, and AOT compatibility.
- **Compile-time wins** performance (inlinable, zero meta-cost), startup (pre-built graph), type safety (fail fast at build), tooling (real code), and AOT/native-image (closed-world). **serde** and **Dagger/Micronaut/Quarkus** exemplify it.
- **Runtime wins** flexibility (plugins, dynamic schemas, hot reload, REPL), keeps **builds simple**, and offers **live introspection**. **Jackson** and **Spring** exemplify it.
- **Binary size is roughly a wash** (monomorphization/codegen bloat vs reflection metadata), and **observability is mixed** (readable generated code vs live state inspection).
- **Startup time is the dimension driving the modern shift to compile-time**, because **serverless cold start** turned boot latency into user-facing latency; **AOT/native-image** turned a preference into a forcing function by breaking runtime reflection.
- **Cost is conserved:** you pay the meta-work in CI once (compile-time) or in production forever (runtime). The decision is which budget absorbs it.
- Senior framing: identify **forcing functions** first (native-image? cold start budget? run-time plugins?), then **weight the nine dimensions** for the specific system — never declare one side universally better.

---

*Continue to `senior.md` for the full industry-shift story and a rigorous decision framework, or `professional.md` for multi-stage programming, hybrid architectures, and real migration case studies (Spring→Quarkus, Guice→Dagger, GraalVM forcing reflection→codegen).*
