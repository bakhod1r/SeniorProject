# DSLs via Metaprogramming — Professional Level

> **Topic:** [DSLs via Metaprogramming](README.md)
> **Focus:** Shipping internal DSLs in production — error quality, IDE support, versioning, and knowing when a plain API is better.

---

## Table of Contents

1. [Introduction](#introduction)
2. [The Production DSL Families](#the-production-dsl-families)
3. [Compile-Checked vs Runtime DSLs](#compile-checked-vs-runtime-dsls)
4. [The Things That Decide Whether a DSL Survives](#the-things-that-decide-whether-a-dsl-survives)
5. [Code Examples](#code-examples)
6. [Best Practices](#best-practices)
7. [Edge Cases & Pitfalls](#edge-cases--pitfalls)
8. [War Stories](#war-stories)
9. [Summary](#summary)

---

## Introduction

An internal DSL is a library designed so that using it reads like a small language for
its domain — `query.select().from(users).where(age > 21)`, `html { body { ... } }`,
`describe "User" do ... end`. It is hosted inside a general-purpose language, so it
reuses that language's parser, tooling, and type system; the metaprogramming
(operator overloading, blocks, builders, macros, `method_missing`) is what makes the
host syntax bend toward the domain. At the professional tier the design questions are
not "can I make this fluent" but "will the error messages make sense, will the IDE
help, can a new hire read it, and would a plain API have been better?" A DSL that
reads beautifully but produces inscrutable errors and zero autocomplete is a net
liability.

---

## The Production DSL Families

| Family | Examples | Technique |
|---|---|---|
| **Configuration** | Gradle, Rails routes, Ktor | blocks / lambdas-with-receiver, `instance_eval` |
| **Querying** | LINQ, SQLAlchemy, jOOQ, Ecto | operator overloading → expression trees, builders |
| **Testing** | RSpec, Spock, Jest `describe/it` | blocks, method chaining |
| **Markup / UI** | Jetpack Compose, kotlinx.html, JSX | type-safe builders, macros/transpilation |
| **Build / tasks** | Rake, Gradle tasks | blocks, dynamic method definition |
| **Validation / schema** | pydantic, Zod, ActiveRecord validations | decorators/operator overloading, DSL methods |

Each maps to a metaprogramming tool: Ruby DSLs lean on `instance_eval`/`method_missing`/
`define_method`; Kotlin DSLs on **lambdas with receiver** and `@DslMarker`; Rust DSLs on
**macros** (`vec!`, `json!`, yew's `html!`, `sqlx::query!`); query DSLs on **operator
overloading** building expression trees that compile to SQL.

---

## Compile-Checked vs Runtime DSLs

The most consequential axis (and the link to the section's central theme):

- **Compile-checked DSLs** (Rust macros, Kotlin type-safe builders, jOOQ, F# computation
  expressions) catch malformed DSL usage at build time and give IDE autocomplete on the
  DSL's vocabulary. `sqlx::query!` even checks your SQL against the database schema at
  compile time. The cost: harder to author (macro/type machinery), and macro errors can
  be cryptic.
- **Runtime DSLs** (Ruby `instance_eval` DSLs, most Python fluent builders) are trivial to
  author and endlessly flexible, but a typo'd DSL keyword fails at runtime, autocomplete
  is weak, and "go to definition" lands in framework internals.

The professional default for a DSL that real teams depend on leans toward
compile-checked where the host language supports it well — the up-front authoring cost
buys back tooling and fail-fast errors that pay off across every consumer.

---

## The Things That Decide Whether a DSL Survives

1. **Error messages in domain terms.** When a user misuses the DSL, do they see "expected
   a `where` clause" or a 40-line macro-expansion / `method_missing` stack trace? Good
   DSLs invest heavily here; it's the difference between adoption and revolt.
2. **IDE support.** Autocomplete on the DSL vocabulary, type-checked builders, jump-to-def.
   Kotlin's `@DslMarker` (preventing the wrong receiver's methods from leaking into an
   inner block) exists precisely to keep large DSLs navigable.
3. **Debuggability.** Can you breakpoint inside the DSL? Runtime block-based DSLs often
   can; macro-expanded ones need `cargo expand`-style tooling.
4. **Discoverability / "now you have two languages."** Every DSL is a second language the
   team must learn and maintain. The bar for introducing one is high.
5. **Leak resistance.** When the host syntax fights the domain, the abstraction leaks and
   users must understand the implementation. A DSL that frequently leaks is worse than a
   plain API.

---

## Code Examples

A Kotlin type-safe builder (compile-checked, IDE-assisted, `@DslMarker`-scoped):

```kotlin
@DslMarker annotation class HtmlDsl

@HtmlDsl class BODY { fun p(block: P.() -> Unit) { /* ... */ } }
@HtmlDsl class P   { operator fun String.unaryPlus() { /* append text */ } }

fun html(block: HTML.() -> Unit): HTML = HTML().apply(block)

// Usage reads like the domain, and the IDE autocompletes p/+ inside body:
html { body { p { +"Hello" } } }
```

The same shape in Ruby is runtime and `instance_eval`-based — terser to build, weaker
to tool:

```ruby
def html(&blk) = HtmlBuilder.new.tap { |b| b.instance_eval(&blk) }
html { body { p { text "Hello" } } }   # `p`, `text` resolved dynamically at runtime
```

---

## Best Practices

- **Make errors speak the domain.** Validate DSL usage and raise messages in the user's
  vocabulary; for macro DSLs, spend effort on diagnostic spans.
- **Prefer compile-checked builders/macros** where the host supports them well — you gain
  autocomplete and fail-fast.
- **Use scope markers** (`@DslMarker`) so nested blocks don't leak outer methods.
- **Keep an escape hatch to a plain API** — power users should be able to drop below the
  DSL.
- **Justify the second language.** Introduce a DSL only when the domain is used widely
  enough that fluency pays back the learning/maintenance cost; otherwise ship a plain
  fluent API.
- **Version the DSL like an API** — its surface is a contract.

---

## Edge Cases & Pitfalls

- **Cryptic errors:** macro/operator-overload DSLs can surface errors in implementation
  terms; unguarded `method_missing` DSLs swallow typos.
- **Receiver leakage:** without `@DslMarker`/scoping, an inner block can accidentally call
  an outer builder's method.
- **Operator-overload surprises:** overloading `>`/`==` to build expression trees means
  those operators no longer mean comparison — confusing if it leaks (e.g. using a query
  column in a boolean context).
- **Debugging through `instance_eval`:** `self` is rebound, stack traces are opaque.
- **Two-languages tax:** onboarding, tooling, and maintenance costs of a bespoke DSL.
- **Over-DSLing:** a DSL where a config file (YAML/JSON) or a plain builder API would do.

---

## War Stories

- **Gradle Groovy → Kotlin DSL:** Gradle's Groovy DSL was flexible but gave almost no IDE
  help and failed at runtime; the Kotlin DSL traded some terseness for autocomplete,
  type-checking, and jump-to-def — a deliberate move toward a compile-checked DSL for
  exactly the survival reasons above.
- **`sqlx::query!`:** compile-time-checking SQL against the live schema turned a whole class
  of runtime query bugs into build errors — the high-water mark of a compile-checked
  embedded DSL.
- **The clever in-house DSL nobody could extend:** a team built an `instance_eval` DSL that
  read wonderfully but produced opaque errors and no autocomplete; new hires couldn't
  modify it, and it was eventually rewritten as a plain typed builder that everyone could
  navigate.

---

## Summary

Internal DSLs make code read like its domain by bending host syntax with metaprogramming
— operator overloading and builders for queries, lambdas-with-receiver for Kotlin
configuration, blocks/`instance_eval` for Ruby, macros for compile-checked Rust DSLs.
What separates a DSL that thrives from one that's resented is not how fluent it reads but
its **error quality, IDE support, debuggability, and whether the second language was worth
it.** Prefer compile-checked builders/macros where you can, scope your receivers, keep an
escape hatch to a plain API, and remember that the highest form of DSL judgment is
sometimes choosing not to build one.
