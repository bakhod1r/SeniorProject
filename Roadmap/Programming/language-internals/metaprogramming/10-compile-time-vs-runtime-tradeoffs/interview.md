# Compile-Time vs Runtime Trade-offs — Interview Questions

> **Topic:** [Compile-Time vs Runtime Trade-offs](README.md)

---

## Introduction

These questions test whether a candidate can use the compile-time/runtime axis as a design
tool: comparing the two camps dimension by dimension (performance, startup, type safety,
flexibility, tooling, AOT), choosing by the dominant constraint, and explaining the modern
industry shift toward compile time driven by cold start and native image. Strong answers
cite concrete pairs (serde vs Jackson, Dagger vs Spring) and reason from deployment targets,
not preferences.

## Table of Contents

- [Conceptual](#conceptual)
- [Scenario](#scenario)
- [Tricky / Trap](#tricky--trap)
- [Design](#design)

---

## Conceptual

## Question 1

**What single question does this whole topic come down to?**

When does the meta-level run — at compile/build time or at runtime? The same outcome (e.g. a
serializer or a DI graph) is reachable either way; the difference is entirely *when* the work
happens, which determines its cost across performance, startup, type safety, flexibility,
tooling, and AOT-compatibility.

## Question 2

**Compare compile-time and runtime on performance and startup.**

Compile-time has zero runtime cost (the work is already done, output is inlinable) and fast
startup (no scanning at boot). Runtime pays a per-operation overhead and a boot tax (reflective
scanning, proxy/graph construction). For hot paths and cold-start-sensitive services,
compile-time wins these rows decisively.

## Question 3

**Compare them on type safety and flexibility.**

Compile-time catches errors at build (fail fast) with static guarantees, but is fixed once
built (closed-world). Runtime defers errors to production ("method not found") with no static
check, but can adapt to information available only at runtime (plugins, dynamic schemas, hot
reload). It's a fail-fast-and-rigid vs flexible-but-late trade.

## Question 4

**Give equivalent compile-time/runtime pairs for the same job.**

Serialization: serde (`derive`, compile-time) vs Jackson (reflection, runtime). DI: Dagger /
Micronaut (compile-time) vs Spring / Guice (runtime). They produce the same outcome; they
differ in startup, AOT-compatibility, and where errors surface.

---

## Scenario

## Question 5

**You're building a serverless function with strict cold-start SLOs. Which camp and why?**

Compile-time. A per-100ms-billed function can't absorb a multi-second reflective boot, and
cold starts hit tail latency on every new instance. Choose build-time DI/serialization
(Quarkus/Micronaut/Dagger, serde-style) so the app starts in milliseconds.

## Question 6

**Your target is a GraalVM native image. What does that imply for metaprogramming?**

Native-image is closed-world AOT: anything reached only via runtime reflection must be declared
in configuration or it's missing at runtime. So you minimize runtime reflection and prefer
compile-time generation, which is AOT-native. The deployment target effectively forces the
compile-time camp.

## Question 7

**You're building a plugin host that loads third-party code unknown at build time. Which
camp?**

Runtime. The whole point is adapting to types/code not known when you compiled — reflection,
dynamic loading, runtime registration. This is the case where runtime metaprogramming is not
just acceptable but required; compile-time can't see code that doesn't exist yet at build.

## Question 8

**A long-lived server with no AOT requirement and a need for dynamic configuration — does
runtime DI still make sense?**

Yes. It amortizes the boot tax over a long lifetime, and the flexibility of runtime wiring
suits dynamic configuration. The compile-time shift is driven by cold-start and AOT; absent
those pressures, runtime's convenience and flexibility remain a reasonable choice.

---

## Tricky / Trap

## Question 9

**"Compile-time is always faster, so always prefer it." Critique.**

It wins *runtime* performance and startup, but it's not free: it relocates cost into the build
(slower CI, generator maintenance), can bloat binaries (monomorphization), and sacrifices
runtime flexibility. And it's simply impossible when the variation is only known at runtime.
"Always" ignores the dimensions where runtime wins.

## Question 10

**Why might a compile-time and runtime version of "the same" feature behave differently?**

The runtime version can observe data and types that didn't exist at build time, so it may
handle dynamic edge cases the compile-time version can't (and vice versa, the compile-time
version enforces constraints the runtime one defers). Assuming exact parity when migrating
camps is a trap — test the dynamic edges.

## Question 11

**An app runs fine on the JVM but fails as a native image. Most likely cause?**

Runtime reflection (or dynamic proxies/resource loading) that the closed-world AOT compiler
couldn't see and that wasn't declared in reflection/trimming config — so the member is absent
at runtime. The fix is config or, better, migrating that path to compile-time generation; and
putting native-image builds in CI to catch it early.

## Question 12

**Why did the industry default shift from runtime to compile time over the last several
years?**

Three forcing functions: serverless cold-start (can't afford reflective boot), native-image/
AOT (closed-world breaks runtime reflection), and fail-fast observability (build-time errors
beat production `NoSuchMethod`). Hence Quarkus/Micronaut over reflective Spring, Dagger over
Guice, serde over Jackson, and Spring's own AOT mode.

---

## Design

## Question 13

**Design the decision procedure you'd document for choosing the camp.**

Ask, in order: Is the variation known at build time? (yes → compile-time). Is the deployment
serverless/CLI/native-image or cold-start-sensitive? (yes → compile-time). Is genuine runtime
dynamism required (plugins, dynamic schema)? (yes → runtime). Can you afford build cost vs
runtime cost? Then place the meta-level at the dominant constraint and budget the build
accordingly.

## Question 14

**How would you migrate a reflection-heavy service to be native-image-compatible?**

Identify reflective hot/critical paths and AOT blockers; replace serialization/DI/ORM mapping
with compile-time equivalents (codegen, derive macros, compile-time DI) under behavior-parity
tests; add native-image builds to CI; measure startup and p99. Expect more lines but faster,
AOT-compatible, fail-fast, navigable code.

## Question 15

**What is multi-stage programming and how does it relate to this trade-off?**

Multi-stage programming explicitly stages computation across phases — doing some work at
compile/build time and some at runtime — so you can have compile-time specialization where it
pays *and* runtime flexibility where it's needed. It's the "have it both ways" answer to the
axis, partially evaluating the parts known early while leaving the rest dynamic.
