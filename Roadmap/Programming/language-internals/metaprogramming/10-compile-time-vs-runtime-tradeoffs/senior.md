# Compile-Time vs Runtime Trade-offs — Senior Level

> **Topic:** [Compile-Time vs Runtime Trade-offs](README.md)
> **Focus:** The dimension-by-dimension comparison that decides where the meta-level should run — and the modern shift toward compile time.

---

## Table of Contents

1. [Introduction](#introduction)
2. [The Two Camps](#the-two-camps)
3. [The Trade-off Dimensions, Head to Head](#the-trade-off-dimensions-head-to-head)
4. [The Modern Shift Toward Compile Time](#the-modern-shift-toward-compile-time)
5. [Mental Models](#mental-models)
6. [Code Examples](#code-examples)
7. [Best Practices](#best-practices)
8. [Edge Cases & Pitfalls](#edge-cases--pitfalls)
9. [Summary](#summary)

---

## Introduction

This is the synthesis topic of the section. Every technique covered so far —
reflection, metaclasses, proxies, macros, code generation, annotations — is a point on
one axis: **when does the meta-level run?** A derive macro and runtime reflection can
produce the *same* serializer; the difference is entirely *when* the work happens and
therefore what it costs. At the senior level you stop treating "compile-time" and
"runtime" as language trivia and start using the axis as a design tool: given a problem,
you decide where the meta-level belongs by reasoning through performance, startup, type
safety, flexibility, tooling, and AOT-compatibility — and you recognize the strong
industry current now pulling toward compile time.

---

## The Two Camps

**Compile-time / build-time:** macros (Rust, Lisp), code generation (protoc, Dagger,
go generate), annotation processors (APT), C++ templates/`constexpr`/`consteval`, Rust
`derive`, static reflection. The metaprogram runs *before* the program; its output is
ordinary, optimizable, statically-checkable code.

**Runtime:** reflection, metaclasses, dynamic proxies, `eval`, monkeypatching. The
metaprogram runs *while the program runs*; it adapts to information available only then.

The same outcome is often reachable from either camp — serde (`derive`, compile-time)
vs Jackson (reflection, runtime); Dagger (compile-time DI) vs Spring (runtime DI). That
equivalence of *outcome* with divergence of *cost* is exactly why the choice matters.

---

## The Trade-off Dimensions, Head to Head

| Dimension | Compile-time | Runtime |
|---|---|---|
| **Performance** | Zero runtime cost; fully inlinable/optimizable | Per-operation overhead; defeats JIT inlining |
| **Startup time** | Fast — no scanning at boot | Pays a boot tax (reflective scanning, proxy setup) |
| **Artifact size** | Can bloat (monomorphization, generated stubs) | Reflection metadata has size too; usually smaller code |
| **Type safety / error timing** | Errors at build (fail fast); static guarantees | Errors in production ("method not found"); no static check |
| **Flexibility / dynamism** | Fixed once built (closed-world) | Adapts to data unknown until runtime (plugins, hot reload) |
| **Observability / debugging** | Generated code is real source you can step | Harder to trace, but can inspect live state |
| **Tooling** | Autocomplete/refactor on generated code | Defeats static analysis, grep, refactoring |
| **Build vs deploy complexity** | Cost pushed into the build (slow builds, generators) | Simple builds; cost shipped to runtime |
| **AOT / native-image** | Friendly (closed-world) | Needs config or breaks (GraalVM, .NET trimming, tree-shaking) |

The table is the topic. A senior reads a requirement and predicts which row dominates:
a tight inner loop → performance row → compile-time; a plugin host loading unknown
third-party code → flexibility row → runtime; a serverless function → startup + AOT rows
→ compile-time.

---

## The Modern Shift Toward Compile Time

For two decades the mainstream (especially the JVM) leaned runtime: Spring, Hibernate,
and Jackson all reflect and scan at boot, trading startup for flexibility and developer
convenience. Three forces reversed the current:

1. **Serverless cold-start.** A function that runs for 200ms can't afford a 4-second
   reflective Spring boot. Quarkus and Micronaut do the DI/ORM wiring at *build* time so
   the app starts in milliseconds.
2. **AOT / native image.** GraalVM native-image and .NET NativeAOT assume a closed world;
   runtime reflection must be exhaustively configured or it breaks. Compile-time
   techniques are AOT-native. This pushed Spring itself (Spring Boot 3 AOT) toward
   build-time processing.
3. **Observability & fail-fast.** Compile-time errors and readable generated code beat
   "NoSuchMethodError in production." serde-over-Jackson and Dagger-over-Guice trade
   authoring convenience for build-time guarantees.

The current isn't absolute — runtime metaprogramming still wins where genuine dynamism
is required — but the default for new, performance- and startup-sensitive systems has
visibly moved to compile time.

---

## Mental Models

- **"Pay once vs pay forever."** Compile-time pays the meta cost once, at build; runtime
  pays a slice of it on every execution and every boot.
- **"Known-when?"** If the variation is known at build time, compile-time fits; if it's
  only known at runtime (plugins, dynamic schemas), runtime is required. This single
  question resolves most cases.
- **"Closed world vs open world."** Compile-time/AOT assumes the whole program is known
  at build; runtime reflection thrives in an open world where new types arrive later.
- **Multi-stage programming** is "have it both ways": stage some computation to compile
  time while keeping runtime flexibility where needed.

---

## Code Examples

The same serializer, two camps:

```rust
// Compile-time (Rust serde): the impl is generated at build; zero reflection at runtime.
#[derive(Serialize, Deserialize)]
struct User { name: String, age: u32 }
```

```java
// Runtime (Jackson): reflects over fields at runtime; flexible, but pays per-call and
// needs reflection config for GraalVM native-image.
String json = new ObjectMapper().writeValueAsString(user);
```

DI, two camps:

```text
Spring  (runtime DI):  scans annotations + builds the graph at startup → boot tax, flexible.
Dagger  (compile DI):  generates the graph at build → instant startup, AOT-friendly, fail-fast.
```

---

## Best Practices

- **Choose by the dominant dimension.** Identify whether performance, startup, AOT,
  flexibility, or tooling dominates the requirement, and let that pick the camp.
- **Default to compile-time for startup/perf/AOT-sensitive systems** (serverless, CLIs,
  native images); reserve runtime for genuine dynamism.
- **Prefer compile-time techniques whose output is readable** (codegen, derive) so you
  keep debuggability and tooling.
- **Don't pay runtime reflection costs for variation known at build time.**
- **If you need AOT, audit runtime reflection early** — it's the thing that breaks.

---

## Edge Cases & Pitfalls

- **Closed-world breakage:** AOT-compiling a reflection-heavy app without configuring every
  reflective access → runtime `ClassNotFound`/`NoSuchMethod` in the native image.
- **Compile-time bloat:** aggressive monomorphization/codegen can balloon binary size and
  build time — the opposite cost.
- **False equivalence:** assuming compile-time and runtime versions behave identically;
  they can differ on dynamic edge cases (runtime can see data the build couldn't).
- **Over-staging:** pushing everything to compile time sacrifices flexibility the system
  actually needed (e.g. plugins), forcing rebuilds for what should be configuration.

---

## Summary

The compile-time vs runtime axis is the organizing principle of metaprogramming: the same
outcome from either camp, with costs that diverge across performance, startup, type
safety, flexibility, tooling, and AOT-compatibility. Seniors decide by the dominant
dimension and the "known-when?" question — build-time variation goes compile-time, runtime
variation goes runtime. The modern current, driven by serverless cold-start, native-image
AOT, and fail-fast observability, runs strongly toward compile time (Quarkus/Micronaut,
Dagger, serde, Spring AOT) — but runtime metaprogramming remains the right tool wherever
genuine dynamism is the requirement.
