# DSLs via Metaprogramming — Interview Questions

> **Topic:** [DSLs via Metaprogramming](README.md)

---

## Introduction

These questions test whether a candidate can distinguish internal from external DSLs,
map each internal-DSL style to the metaprogramming technique that enables it (operator
overloading, blocks, lambdas-with-receiver, macros, `method_missing`), and — most
importantly — judge when a DSL earns its keep versus when a plain API is better. Strong
answers weigh error quality, IDE support, and the "now you have two languages" cost.

## Table of Contents

- [Conceptual](#conceptual)
- [Language-Specific](#language-specific)
- [Tricky / Trap](#tricky--trap)
- [Design](#design)

---

## Conceptual

## Question 1

**Internal vs external DSL — what's the difference?**

An internal (embedded) DSL is a library inside a general-purpose host language, built so
its usage reads like a mini-language; it reuses the host's parser, tooling, and types
(RSpec, SQLAlchemy, Gradle Kotlin). An external DSL has its own grammar and a dedicated
lexer/parser (SQL, regex, a config language) — that's compiler territory. Internal DSLs
are the metaprogramming story.

## Question 2

**Which metaprogramming techniques enable internal DSLs?**

Method chaining / fluent builders, operator overloading (building expression trees),
blocks/closures (`instance_eval`, `yield`), lambdas-with-receiver (Kotlin type-safe
builders), macros (compile-checked DSLs in Rust/Lisp), and dynamic method synthesis
(`method_missing`). Each yields a different DSL "feel."

## Question 3

**Why build a DSL at all, instead of a plain API?**

To let code read in the vocabulary of the domain, reducing the translation gap between
intent and implementation for code that's written/read often (tests, queries, config,
UI). The payoff is readability and density; the cost is a second language to learn,
tool, and maintain — so it's only worth it when the domain usage is broad.

---

## Language-Specific

## Question 4

**Ruby: how do `instance_eval` and `method_missing` build DSLs?**

`instance_eval(&block)` runs a block with `self` rebound to a builder object, so bare
method calls inside the block target the builder (`routes.draw do get '/x' end`).
`method_missing` synthesizes DSL keywords/finders dynamically. Together they power
Rails routes, RSpec, and Rakefiles. The cost is weak tooling and opaque errors.

## Question 5

**Kotlin: what makes type-safe builders work, and what does `@DslMarker` solve?**

Lambdas-with-receiver (`fun html(block: HTML.() -> Unit)`) let a block call the
receiver's methods directly, giving nested `html { body { p { ... } } }` with full IDE
autocomplete and type-checking. `@DslMarker` prevents an inner block from accidentally
calling an *outer* receiver's methods (receiver leakage), keeping large nested DSLs
unambiguous.

## Question 6

**Rust: what's special about macro-based DSLs?**

Macros (`vec!`, `json!`, yew's `html!`, `sqlx::query!`) run at compile time, so the DSL
is **compile-checked** and can even validate against external facts (`sqlx::query!`
checks SQL against the database schema). You get fail-fast errors and zero runtime cost,
at the price of harder authoring and sometimes cryptic macro errors.

## Question 7

**How do query DSLs like SQLAlchemy/LINQ/jOOQ work under the hood?**

Operator overloading and builder methods construct an **expression tree / AST** at
runtime (or compile time for jOOQ's generated schema) rather than executing the
comparison — `User.age > 21` produces a predicate object, not a boolean. The tree is
later compiled to SQL. This is metaprogramming: operators are repurposed to build code.

---

## Tricky / Trap

## Question 8

**`User.age > 21` returns a query fragment, not `True`. Why is that both powerful and
dangerous?**

Powerful: overloading `>` lets the DSL capture the *expression* and translate it to SQL.
Dangerous: those operators no longer mean comparison, so using a column in a normal
boolean context (`if User.age > 21:`) does something surprising — the abstraction leaks,
and users must know it's building a tree, not comparing.

## Question 9

**A teammate's `instance_eval` DSL gives a 30-line stack trace on a typo. What's the root
problem and the fix?**

Runtime, dynamically-dispatched DSLs surface errors in implementation terms and swallow
typos via `method_missing`. The fix is to validate DSL usage and raise domain-level
errors (and implement `respond_to_missing?`), or move to a compile-checked/typed builder
so mistakes fail fast with good messages.

## Question 10

**Why might a beautifully fluent DSL still be the wrong choice?**

If its errors are cryptic, the IDE can't autocomplete it, you can't debug into it, and it
adds a second language the team must maintain — the readability win is outweighed. A
plain, well-named API with autocomplete and clear errors often serves better.

## Question 11

**What does `@DslMarker` actually prevent, with an example?**

In `table { row { cell { ... } } }`, without scoping, code inside `cell` could call
`row`'s or `table`'s methods (they're all in scope as receivers), creating ambiguous or
wrong nesting. `@DslMarker` restricts each block to its nearest receiver, so only `cell`'s
methods are callable inside `cell`.

---

## Design

## Question 12

**Design a routing DSL (`get "/users" -> handler`). Which host, which technique, and how
do you keep it debuggable?**

In Kotlin: lambdas-with-receiver + `@DslMarker` for compile-checked, autocompleted
nesting. In Ruby: `instance_eval` blocks. Keep it debuggable by validating routes eagerly
with domain-level errors, preserving real handler stack frames, and offering a plain
register-route API underneath. State the trade: compile-checked (Kotlin) buys tooling;
runtime (Ruby) buys terseness.

## Question 13

**You're choosing between a YAML config file and a Kotlin/Groovy config DSL for build
settings. How do you decide?**

YAML is data — simple, toolable, no logic, safe for non-programmers, but inflexible
(no conditionals/loops/reuse). A code DSL adds programmability and IDE support but is a
second language and can hide complexity. Choose YAML when config is static data; choose a
DSL when config genuinely needs logic/abstraction (Gradle's case). Don't pick a DSL for
prestige.

## Question 14

**When would you reach for a compile-checked macro DSL over a runtime fluent builder?**

When correctness and tooling matter more than authoring ease and flexibility — e.g.
validating a query against a schema at build time (`sqlx::query!`), or a UI/markup DSL
where malformed structure should be a compile error. The macro costs more to write and
can give cryptic errors, but every consumer gets fail-fast checking and autocomplete.

## Question 15

**How do you version and evolve a DSL that many teams depend on?**

Treat its surface as an API contract: additive changes only where possible, deprecation
cycles for removals, semantic-versioned releases, and migration guides. Because a DSL
*reads* like a language, breaking its vocabulary is as disruptive as a breaking API change
— sometimes more, since usages are scattered and idiomatic.
