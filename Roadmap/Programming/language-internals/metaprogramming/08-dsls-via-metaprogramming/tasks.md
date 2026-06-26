# DSLs via Metaprogramming — Hands-On Tasks

> **Topic:** [DSLs via Metaprogramming](README.md)

---

## Introduction

The way to understand internal DSLs is to build the same little language several ways —
a fluent builder, an operator-overloaded expression tree, a block-based DSL, a type-safe
builder — and then judge them on the criteria that decide real adoption: error quality,
IDE support, debuggability, and whether a plain API would have been better. These tasks
are language-flexible; use Python/JS for the fluent/operator versions, Kotlin or Ruby for
the block/builder versions where you can.

Tick a self-check box when you can explain *which technique* produced the DSL feel and
*what it costs*, not merely when it runs.

---

## Table of Contents

1. [Warm-Up](#warm-up)
2. [Core](#core)
3. [Advanced](#advanced)
4. [Capstone](#capstone)
5. [Self-Assessment](#self-assessment)

---

## Warm-Up

### Task 1 — A fluent builder

Build a tiny query builder so `Query().select("id","name").from("users").where("age>21").build()`
returns a SQL string.

**Self-check:**
- [ ] Each method returns `self`/`this` to enable chaining.
- [ ] I can explain that method chaining is the simplest internal-DSL technique.

### Task 2 — Spot the technique

For each DSL, name the enabling metaprogramming technique: RSpec `describe/it`; SQLAlchemy
`User.age > 21`; Kotlin `html { body { } }`; Rust `vec![1,2,3]`; Rails `routes.draw do ... end`.

**Self-check:**
- [ ] blocks/`instance_eval`; operator overloading; lambdas-with-receiver; macro; blocks/`instance_eval`.
- [ ] I can state why each technique fits its DSL's shape.

---

## Core

### Task 3 — Operator-overloaded expression tree

Build a mini query DSL where `col("age") > 21` returns a predicate *object* (not a
boolean) that you can render to SQL. Add `&`/`|` for AND/OR.

**Self-check:**
- [ ] `col("age") > 21` builds a tree node; rendering gives `age > 21`.
- [ ] I can explain why overloading `>` is powerful *and* a leak risk (it no longer means comparison).

### Task 4 — Block-based config DSL

Build a routing DSL: `routes { get("/users", handler); post("/users", handler) }` that
collects route definitions. (Ruby `instance_eval`, or a JS/Python builder passed to a
callback.)

**Self-check:**
- [ ] The block populates a route table.
- [ ] I can explain how `self`/receiver rebinding (or a passed builder) makes the bare calls resolve.

### Task 5 — Make errors speak the domain

Take your Task 4 DSL and add validation: a duplicate route or a missing handler raises a
*domain-level* error ("route GET /users already defined"), not a generic stack trace.

**Self-check:**
- [ ] Misuse produces a clear, domain-vocabulary message.
- [ ] I can argue this is the single biggest factor in whether a DSL gets adopted.

---

## Advanced

### Task 6 — Type-safe / scoped builder

In Kotlin (or by simulating the constraint), build a nested `html { body { p { +"hi" } } }`
builder using lambdas-with-receiver, and apply `@DslMarker` so an inner block can't call an
outer receiver's methods.

**Self-check:**
- [ ] Nesting works with autocomplete on each level's methods.
- [ ] `@DslMarker` blocks receiver leakage, and I can show a case it prevents.

### Task 7 — Compile-checked vs runtime, compared

Implement the same small DSL twice: once runtime (fluent/`method_missing`) and once
compile-checked (Kotlin builder, or a Rust macro, or a typed builder). Compare error
timing, IDE help, and authoring effort.

**Self-check:**
- [ ] The compile-checked version fails at build time with autocomplete; the runtime one fails later with weaker tooling.
- [ ] I can state when each is the right choice.

### Task 8 — The "should this be a DSL?" review

Take a real config currently expressed as a fluent DSL (or invent one) and rewrite it as
plain data (YAML/JSON) and as a plain typed API. Write a one-paragraph verdict on which is
best and why.

**Self-check:**
- [ ] I weighed flexibility, tooling, error quality, and the two-languages cost.
- [ ] My verdict is justified by the *usage pattern*, not aesthetics.

---

## Capstone

### Task 9 — Ship a small DSL with production manners

Design and build an internal DSL for one domain (test specs, query building, or UI/markup).
Requirements:

1. Reads like the domain.
2. Produces **domain-level error messages** on misuse.
3. Has the best IDE/tooling support your host allows (typed builder where possible).
4. Provides a **plain-API escape hatch** beneath the DSL.
5. Ships a short "when to use / when not to use this DSL" doc.

Then write an honest assessment: did the DSL earn its place over a plain API for this
domain?

**Self-check:**
- [ ] The DSL is fluent *and* gives good errors and tooling.
- [ ] There's an escape hatch and a usage doc.
- [ ] My assessment honestly judges whether the second language was worth it.

---

## Self-Assessment

You own this topic when you can:

- [ ] Distinguish internal vs external DSLs and map DSL styles to their enabling techniques.
- [ ] Build fluent, operator-overloaded, block-based, and type-safe-builder DSLs.
- [ ] Make a DSL fail with domain-level errors and scope its receivers.
- [ ] Compare compile-checked vs runtime DSLs on errors, tooling, and effort.
- [ ] Judge honestly when a plain API or plain data beats a DSL.
