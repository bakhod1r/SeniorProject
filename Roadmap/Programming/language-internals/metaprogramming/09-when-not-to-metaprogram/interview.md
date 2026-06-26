# When NOT to Metaprogram — Interview Questions

> **Topic:** [When NOT to Metaprogram](README.md)

---

## Introduction

This is a judgment topic, so the questions are mostly scenario- and trade-off-based.
They test whether a candidate defaults to the simplest tool, can price the real costs of
metaprogramming (comprehension, debugging, tooling, startup, staffing), and can
articulate the few cases where the magic genuinely pays. Strong answers cite the
simplicity ladder, the rule of three, fail-fast vs fail-late, and the framework-level vs
app-level distinction. Weak answers treat "it's possible" as "it's a good idea."

## Table of Contents

- [Conceptual](#conceptual)
- [Scenario / Judgment](#scenario--judgment)
- [Tricky / Trap](#tricky--trap)
- [Design](#design)

---

## Conceptual

## Question 1

**What are the main costs of metaprogramming you weigh against its benefits?**

Comprehensibility (action-at-a-distance — behavior not visible at the call site),
debuggability (can't breakpoint code that doesn't textually exist; failures move to
runtime), tooling (defeats autocomplete/refactoring/grep), error-message quality
(implementation-term errors), performance/startup (reflection/proxy overhead, scanning
cost), and maintenance/staffing (fragile, raises the bar to touch the code).

## Question 2

**State the "simplest tool that works" ladder.**

Plain code → a function → a generic/parameterized type → a little reflection → code
generation (readable output) → a macro → a metaclass/heavy runtime magic. Climb only when
the current rung genuinely fails; each step up spends more of the codebase's "magic
budget."

## Question 3

**What is the "magic budget"?**

The finite tolerance a codebase has for indirection that isn't visible at the call site.
Frameworks already spend a lot; every added reflection/proxy/metaclass/macro spends more.
Overdraw it and you get distrust, slow debugging, and "don't touch it" code. It reframes
the question from "can I?" to "is it worth the magic, given how much is already spent?"

## Question 4

**Why does "fail at compile time vs runtime" matter so much here?**

Compile-time failures are caught in CI by everyone, cheaply, with the build pointing at
the mistake. Runtime failures from reflective/dynamic magic surface in production as
"method not found" with no static warning — the most expensive place to discover a bug.
Prefer techniques that fail fast.

---

## Scenario / Judgment

## Question 5

**A colleague wants a metaclass to enforce that every subclass defines a `name`
attribute. Better options?**

`__init_subclass__` validates subclasses with far less magic; or a simple base-class
assertion; or just code review / a linter. A metaclass is overkill. The judgment: use the
lightest tool that gives the guarantee, and prefer one that fails at definition with a
clear message.

## Question 6

**You can replace a 12-line `switch` over types with three lines of reflection. Do you?**

Usually no. The `switch` is statically checked, greppable, debuggable, fast, and obvious;
the reflection trades all of that to save nine lines. Reflection wins only when the set of
types is open/unknown at compile time or the boilerplate is large and genuinely painful —
not to shave a few lines.

## Question 7

**When is a DSL the wrong call?**

When the "domain" is static data (use YAML/JSON), when usage is narrow (a plain API is
cheaper than a second language), or when the DSL would have cryptic errors and no IDE
support. A DSL is justified when the domain is used widely and benefits from reading like
a language, with good errors and tooling.

## Question 8

**Your team is moving to GraalVM native image / serverless and the app is reflection-heavy.
What's the tension?**

Runtime reflection fights AOT compilation's closed-world assumption (needs extensive
config or breaks) and inflates cold-start via scanning. The pressure pushes you toward
compile-time alternatives (code generation, derive macros, compile-time DI like
Quarkus/Micronaut/Dagger) — a concrete modern reason to *not* metaprogram at runtime.

---

## Tricky / Trap

## Question 9

**"It's DRY, so it's better." Critique in the metaprogramming context.**

DRY is a means, not an end. Metaprogramming to remove mild duplication can cost far more in
comprehension and debuggability than the duplication did. The rule of three and "the wrong
abstraction is more expensive than duplication" both apply: a little repetition is often
cheaper than clever magic that removes it.

## Question 10

**Why is monkeypatching a third-party library especially dangerous?**

It's invisible at the call site, silently breaks across library upgrades (the patched
internals change), defeats tooling, and surprises every reader. It's a maintenance time
bomb that a future upgrade detonates far from the patch.

## Question 11

**A reflective system "works" but the team is afraid to change it. What's the real cost
being paid?**

The staffing/comprehension cost: the magic exceeded the team's ability to understand and
debug it, so velocity collapsed into fear. "Works" ignores that nobody can safely modify
it — the code became a liability even though it runs.

## Question 12

**Is using Spring/Hibernate (heavy metaprogramming) a contradiction of "don't
metaprogram"?**

No — the principle is about *your* code. Framework-level magic that's owned, documented,
and serves thousands of usages can be a good trade; the guidance is against *adding* app-
level magic casually. Even then, you must understand the framework's magic (e.g. the
self-invocation trap) to use it safely.

---

## Design

## Question 13

**Design a review checklist a team can apply when someone proposes a metaprogramming
technique.**

Could a simpler rung (plain code/function/generic) do it? Is the eliminated boilerplate
large and painful, or trivial? Does it fail at compile or run time? Will autocomplete/
refactor/grep still work? Will a junior understand it in six months? Can you debug it in
production? Is it framework-level (justifiable) or app-level (suspect)? Default to "no"
unless it clears these.

## Question 14

**How would you migrate a codebase off over-used runtime reflection?**

Identify the hot/critical reflective paths, replace them with code generation or explicit
code (readable output, compile-time checking), keep behavior identical with tests, and
measure startup/throughput improvements. Often the result is more lines but faster,
AOT-compatible, debuggable code the whole team can own — the recurring "rewrote the magic
as boring code" win.

## Question 15

**Give a principle you'd put in a style guide about metaprogramming.**

"Write the boring version first; reach for metaprogramming only when the boring version is
demonstrably worse at scale, prefer compile-time techniques with readable output, and keep
the magic in owned framework layers — never sprinkle it through application code." Pair it
with Kernighan's law on debugging being harder than writing.
