# When NOT to Metaprogram — Hands-On Tasks

> **Topic:** [When NOT to Metaprogram](README.md)

---

## Introduction

This is a judgment topic, so the exercises are mostly *evaluate, refactor, and decide*
rather than "write a macro." You'll take metaprogrammed code and de-magic it, price the
costs, apply the simplicity ladder, and practice saying no. The goal is a reflex: reach
for the simplest tool, and reserve magic for where it genuinely pays.

Tick a self-check box when you can *justify the decision* with costs and alternatives, not
merely when something compiles.

---

## Table of Contents

1. [Warm-Up](#warm-up)
2. [Core](#core)
3. [Advanced](#advanced)
4. [Capstone](#capstone)
5. [Self-Assessment](#self-assessment)

---

## Warm-Up

### Task 1 — Walk the ladder

For each problem, name the *lowest* rung of the ladder (plain code → function → generic →
reflection → codegen → macro → metaclass) that solves it well:

1. Format three log lines the same way.
2. Serialize 200 data classes to JSON.
3. Dispatch on a known, closed set of five shape types.
4. Register plugins discovered at runtime from third-party packages.

**Self-check:**
- [ ] (1) function, (2) codegen/derive, (3) interface+switch (plain code/polymorphism), (4) some reflection/registration.
- [ ] I can justify why climbing higher would overspend.

### Task 2 — Price the magic

Take a snippet that uses reflection to call a method by a string name. List every cost:
what breaks for autocomplete, grep, refactoring, error-timing, and performance.

**Self-check:**
- [ ] I named at least four concrete tooling/runtime costs.
- [ ] I can state what a non-reflective version would recover.

---

## Core

### Task 3 — De-magic a reflection dispatch

Given code that uses reflection (or a stringly-typed map) to dispatch over a *closed* set
of types, rewrite it with an interface/`switch`/polymorphism. Compare static safety and
readability.

**Self-check:**
- [ ] The rewrite is statically checked and greppable.
- [ ] I can explain when reflection *would* have been justified (open/unknown type set).

### Task 4 — Replace a metaclass/decorator with a simpler tool

Find (or write) a metaclass or class decorator enforcing a convention and replace it with
`__init_subclass__`, a base-class check, or a linter rule. Compare.

**Self-check:**
- [ ] Behavior is preserved with less magic.
- [ ] I can argue the simpler version is easier to read, debug, and tool.

### Task 5 — Fail fast instead of late

Take a piece of runtime magic that fails in production with an opaque error and redesign it
so the same mistake is caught earlier (compile-time, startup validation, or a clear
domain-level error).

**Self-check:**
- [ ] The failure now happens earlier and with a clearer message.
- [ ] I can explain why compile-time/startup failure is cheaper than production failure.

---

## Advanced

### Task 6 — The rule of three

Find a place where someone abstracted after *one* occurrence of "duplication" using
metaprogramming. Inline it back to explicit code and judge whether the abstraction was
premature.

**Self-check:**
- [ ] I can show the explicit version is clearer and the abstraction was premature (or wasn't).
- [ ] I can articulate "the wrong abstraction costs more than duplication."

### Task 7 — AOT / startup audit

Take a reflection- or annotation-scanning-heavy component and reason about (or measure) its
startup cost and AOT/native-image compatibility. Sketch how you'd migrate it to a
compile-time approach.

**Self-check:**
- [ ] I identified the scanning/reflection cost and the AOT obstacle.
- [ ] My migration sketch moves the work to build time (codegen/derive/compile-time DI).

### Task 8 — Write the "no" memo

Someone proposes a clever metaprogramming solution. Write a short, respectful memo applying
the decision framework that recommends a simpler approach — or, if it's genuinely
justified, says so and explains why.

**Self-check:**
- [ ] My memo walks the ladder and the cost questions.
- [ ] My recommendation is justified by usage pattern and costs, not taste.

---

## Capstone

### Task 9 — Refactor a "magic" module to boring code

Take a module (real or constructed) that overuses metaprogramming — say a reflective,
annotation-driven mini-framework for a simple CRUD concern. Rewrite it as explicit, plain
code (or readable codegen). Then produce:

1. A before/after comparison of readability, debuggability, tooling, and startup.
2. An honest note on anything the magic version did better (and whether it mattered).
3. A one-line guideline you'd add to a style guide.

**Self-check:**
- [ ] The boring version is easier to read, debug, grep, and tool.
- [ ] I fairly acknowledged any real loss and judged its importance.
- [ ] My guideline captures the principle crisply.

---

## Self-Assessment

You own this topic when you can:

- [ ] Apply the simplicity ladder and pick the lowest rung that works.
- [ ] Price the comprehension, debugging, tooling, error-timing, startup, and staffing costs of a magic approach.
- [ ] De-magic reflection/metaclass/DSL code into explicit code and defend the trade.
- [ ] Recognize the few framework-level, cross-cutting cases where metaprogramming genuinely pays.
- [ ] Write a respectful, framework-grounded "use the simpler tool" recommendation.
