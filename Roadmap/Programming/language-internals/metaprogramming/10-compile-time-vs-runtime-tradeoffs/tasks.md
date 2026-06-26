# Compile-Time vs Runtime Trade-offs — Hands-On Tasks

> **Topic:** [Compile-Time vs Runtime Trade-offs](README.md)

---

## Introduction

This synthesis topic is best practiced by *deciding* and *measuring*: given a requirement,
choose where the meta-level runs and justify it; then build or compare the two camps and
observe the costs (startup, AOT-compatibility, error timing). The exercises are
language-flexible — use serde vs Jackson, Dagger vs Spring, a Rust macro vs reflection, or
equivalents in your stack.

Tick a self-check box when you can *justify the camp from the dominant constraint*, not merely
when something runs.

---

## Table of Contents

1. [Warm-Up](#warm-up)
2. [Core](#core)
3. [Advanced](#advanced)
4. [Capstone](#capstone)
5. [Self-Assessment](#self-assessment)

---

## Warm-Up

### Task 1 — Place the requirement

For each, choose compile-time or runtime and name the dominant dimension:

1. A serverless function with a 50ms cold-start budget.
2. A plugin host loading third-party jars at runtime.
3. A tight numeric inner loop that must not pay per-call overhead.
4. A target that must ship as a GraalVM native image.

**Self-check:**
- [ ] (1) compile-time/startup, (2) runtime/flexibility, (3) compile-time/performance, (4) compile-time/AOT.
- [ ] I named the dominant dimension, not just the answer.

### Task 2 — Same outcome, two camps

For serialization and for DI, name a compile-time tool and a runtime tool that achieve the
same outcome, and state the key cost difference.

**Self-check:**
- [ ] Serialization: serde vs Jackson; DI: Dagger/Micronaut vs Spring/Guice.
- [ ] I can state the startup/AOT/error-timing difference for each pair.

---

## Core

### Task 3 — Measure the startup tax

Take (or build) a small app using a runtime-reflective framework and one using a compile-time
equivalent. Measure time-to-first-response / startup for each.

**Self-check:**
- [ ] The compile-time version starts measurably faster.
- [ ] I can explain the boot-time work (scanning/graph building) the runtime version does.

### Task 4 — Two serializers, one type

Serialize the same data type with a compile-time approach (derive/codegen) and a runtime
approach (reflection). Compare per-call performance and where errors surface.

**Self-check:**
- [ ] The compile-time version has no per-call reflection cost.
- [ ] A mismatch (e.g. a renamed field) fails at build for one and at runtime for the other.

### Task 5 — Break it under AOT

Take the reflective version from Task 4 and attempt to AOT-compile it (GraalVM native-image,
or reason precisely about what would break). Identify the reflection config required.

**Self-check:**
- [ ] I can name what the closed-world compiler can't see and must be told.
- [ ] I can explain why the compile-time version needs no such config.

---

## Advanced

### Task 6 — The dimension table, applied

Take a real component you own and fill in the nine trade-off dimensions (performance, startup,
size, type-safety, flexibility, observability, tooling, build-vs-deploy, AOT) for a
compile-time vs runtime implementation. Decide which dominates.

**Self-check:**
- [ ] I filled all nine rows honestly.
- [ ] My decision follows from the dominant row(s), not habit.

### Task 7 — Migrate a path to compile time

Pick one reflective path (serialization, a small DI graph, or mapping) and migrate it to a
compile-time equivalent with behavior-parity tests. Measure startup and note any behavior
differences.

**Self-check:**
- [ ] Behavior is preserved under tests.
- [ ] Startup improved and the path is now AOT-friendly; I noted any dynamic edge-case differences.

### Task 8 — Multi-stage "have it both ways"

Find a place that's all-runtime or all-compile-time and sketch a multi-stage split: what could
move to build time while keeping the genuinely dynamic part at runtime?

**Self-check:**
- [ ] I identified what's known at build time vs only at runtime.
- [ ] My split stages the early-known work and keeps real dynamism runtime.

---

## Capstone

### Task 9 — Architect the camp decision for a service

Given a concrete service spec (deployment target, SLOs, dynamism needs), produce a short design
doc that:

1. Walks the decision procedure (known-when? deployment target? real dynamism? cost tolerance?).
2. Chooses compile-time or runtime for each metaprogramming concern (serialization, DI,
   validation, plugins).
3. Budgets the build cost of any compile-time choices.
4. States what would change the decision (e.g. "if we add native-image, move X to build time").

**Self-check:**
- [ ] Each choice is justified by a dominant constraint.
- [ ] I budgeted build cost and named the conditions that would flip a decision.
- [ ] Genuine dynamism (if any) is kept runtime; everything else leans compile-time where it pays.

---

## Self-Assessment

You own this topic when you can:

- [ ] Compare the two camps across all nine trade-off dimensions.
- [ ] Choose a camp from the dominant constraint (startup, AOT, performance, flexibility).
- [ ] Explain the cold-start and native-image forces behind the modern shift to compile time.
- [ ] Migrate a reflective path to compile-time with behavior-parity tests and measure the gain.
- [ ] Apply multi-stage thinking to get build-time specialization plus runtime flexibility.
