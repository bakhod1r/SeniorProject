# Compile-Time vs Runtime Trade-offs — Professional Level

> **Topic:** [Compile-Time vs Runtime Trade-offs](README.md)
> **Focus:** Making the where-does-the-meta-level-run decision in production — cold start, native image, build economics, and migration.

---

## Table of Contents

1. [Introduction](#introduction)
2. [The Decision in Production Terms](#the-decision-in-production-terms)
3. [Cold Start & Native Image: The Forcing Functions](#cold-start--native-image-the-forcing-functions)
4. [Build Economics](#build-economics)
5. [Migrating Runtime Magic to Compile Time](#migrating-runtime-magic-to-compile-time)
6. [Best Practices](#best-practices)
7. [Edge Cases & Pitfalls](#edge-cases--pitfalls)
8. [War Stories](#war-stories)
9. [Summary](#summary)

---

## Introduction

At the professional tier the compile-time/runtime choice is an architecture decision with
budget consequences: it determines your p99 cold-start, whether you can ship a native
image, how long your CI takes, and how a "method not found" turns up — in a code review or
in a 2am page. The technique catalogue (reflection, macros, codegen, proxies) is settled;
what's hard is reading a system's real constraints and putting the meta-level where the
dominant cost lives, then migrating when those constraints change (as they did across the
industry when serverless and AOT arrived).

---

## The Decision in Production Terms

Translate the trade-off dimensions into operational questions:

- **What is the request lifetime vs the boot time?** A long-lived server amortizes a slow
  reflective boot; a serverless function billed per-100ms cannot. Short-lived → compile-time.
- **Do you need a native image / AOT?** If yes, runtime reflection is a liability that needs
  exhaustive configuration; compile-time is native. This is increasingly a hard requirement,
  not a preference.
- **How dynamic is the workload, really?** Genuine plugin systems, hot-reload, user-defined
  schemas need runtime. "We might add a type someday" usually does not — that's build-time
  variation in disguise.
- **Where can you afford the cost — build or runtime?** Compile-time moves cost into CI
  (slower builds, generator maintenance) and out of production; runtime keeps CI simple and
  taxes every execution.
- **What's the on-call story?** Fail-fast (build-time) errors are cheaper to operate than
  runtime reflective failures discovered in production.

The professional answer is rarely "always X." It's "for this service, with these SLOs and
this deployment target, the dominant cost is Y, so the meta-level goes here."

---

## Cold Start & Native Image: The Forcing Functions

The two forces that reshaped the default:

- **Cold start.** Reflective DI/ORM frameworks scan the classpath and build object graphs
  at boot — seconds on a large app. For serverless and autoscaling, that boot tax is paid on
  every cold instance and directly hits tail latency and cost. Quarkus and Micronaut answer
  by doing the wiring at build time; Spring Boot 3 added AOT processing for the same reason.
- **Native image (closed-world AOT).** GraalVM native-image and .NET NativeAOT compile a
  closed world; anything reached only via runtime reflection must be declared in
  configuration (`reflect-config.json`, trimming descriptors) or it's absent at runtime.
  Heavy reflection makes native images painful or impossible without large config or a move
  to compile-time generation. This single constraint has pushed entire ecosystems toward
  build-time metaprogramming.

If your deployment target is serverless or native image, the compile-time/runtime choice is
largely made *for* you.

---

## Build Economics

Compile-time isn't free — it relocates cost:

- **Slower builds.** Code generation, annotation processing, and macro expansion add to
  compile time; large monomorphized generic/template code compiles slowly and bloats
  binaries. Incremental builds and caching (Gradle build cache, sccache, Bazel) matter.
- **Generator maintenance & version skew.** A schema-driven generator is another dependency
  to version and keep in lockstep with consumers; stale generated code is a real hazard.
- **Determinism/hermeticity.** Generation should be reproducible (same inputs → same output)
  so builds are cacheable and reviewable; nondeterministic generators wreck caching.

The trade is usually worth it for startup/AOT-sensitive systems, but "push it to build time"
has a CI bill you must plan for.

---

## Migrating Runtime Magic to Compile Time

The common modern project. The playbook:

1. **Find the reflective hot/critical paths** (serialization, DI, ORM mapping) and the AOT
   blockers (reflective access that breaks native-image).
2. **Replace with a compile-time equivalent** — derive macros / codegen for serialization
   (serde, generated mappers), compile-time DI (Dagger, Micronaut), annotation processors —
   keeping behavior identical under a strong test suite.
3. **Measure** startup, p99, and native-image build success before/after.
4. **Keep readable output** so you don't trade reflection's opacity for codegen's opacity.

The recurring result: more lines of code, but faster startup, AOT-compatibility, fail-fast
errors, and code the whole team can navigate.

---

## Best Practices

- **Pick the camp by deployment target and SLO**, not by familiarity.
- **For serverless/CLI/native image, default compile-time**; audit and minimize runtime
  reflection early.
- **Budget the build cost** of compile-time techniques (build cache, incremental, hermetic
  generation).
- **Reserve runtime metaprogramming for genuine dynamism** (plugins, dynamic schemas,
  hot reload).
- **Prefer readable generated output** and treat generators as versioned dependencies.
- **Test behavior parity** when migrating camps; the dynamic edge cases differ.

---

## Edge Cases & Pitfalls

- **AOT surprise in production:** an app that ran fine on the JVM fails as a native image
  because a reflective path wasn't configured — discovered late if native-image builds aren't
  in CI.
- **Cold-start regression from a new annotation:** adding a reflective/scanning library
  silently inflates boot time and tail latency.
- **Build-time blowup:** unbounded monomorphization/codegen explodes binary size and compile
  time — compile-time's own failure mode.
- **Stale generated code:** forgetting to regenerate after a schema change ships
  inconsistent behavior; enforce a generate-and-verify CI check.
- **Over-staging:** compiling away flexibility a plugin system actually needed, forcing
  redeploys for what should be runtime configuration.

---

## War Stories

- **Spring → Quarkus/Micronaut for cold start:** teams moving latency-sensitive serverless
  workloads off reflective Spring boot to build-time-wired Quarkus/Micronaut cut cold starts
  from seconds to tens of milliseconds — the textbook runtime→compile-time migration.
- **GraalVM forced the rewrite:** a reflection-heavy service couldn't be native-imaged without
  unmanageable config; migrating serialization and DI to compile-time generation made the
  native image viable and improved startup.
- **serde vs Jackson under native image:** Rust's compile-time serde "just works" under AOT
  with zero reflection config, illustrating why compile-time serialization became the default
  for AOT-targeted systems.

---

## Summary

Where the meta-level runs is a production architecture decision dominated by deployment target
and SLOs: request-lifetime-vs-boot, native-image/AOT requirements, real dynamism, build-cost
tolerance, and the on-call story. Cold start and closed-world AOT are the forcing functions
that moved the industry default toward compile time (Quarkus/Micronaut, Dagger, Spring AOT,
serde), but compile-time relocates cost into the build and sacrifices runtime flexibility.
The professional decision reads the dominant constraint, places the meta-level accordingly,
budgets the build cost, reserves runtime magic for genuine dynamism, and migrates camps with
behavior-parity tests when the constraints change.
