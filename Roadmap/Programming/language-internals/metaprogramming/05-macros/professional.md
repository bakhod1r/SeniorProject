# Macros — Professional Level

> **Topic:** [Macros](README.md)
> **Focus:** Macros as an engineering decision at scale — when they earn their keep versus when they wreck a codebase; compile-time budgets, error-message engineering, debuggability, API stability, security, and how to lead a team that uses macros without being ruled by them.

---

## Table of Contents

1. [Introduction](#introduction)
2. [Prerequisites](#prerequisites)
3. [Glossary](#glossary)
4. [Core Concepts](#core-concepts)
5. [Real-World Analogies](#real-world-analogies)
6. [Mental Models](#mental-models)
7. [Code Examples](#code-examples)
8. [Trade-offs](#trade-offs)
9. [Use Cases](#use-cases)
10. [Coding Patterns](#coding-patterns)
11. [Best Practices](#best-practices)
12. [Edge Cases & Pitfalls](#edge-cases--pitfalls)
13. [Common Mistakes](#common-mistakes)
14. [Test Yourself](#test-yourself)
15. [Cheat Sheet](#cheat-sheet)
16. [Summary](#summary)
17. [Further Reading](#further-reading)

---

## Introduction

> 🎓 Junior: what a macro is and the C foot-guns. Middle: syntactic macros and hygiene. Senior: Rust's two systems, hygiene formally, and the neighbouring designs. Professional: the decisions that determine whether a macro is an asset or a liability for *a team, over years* — because a macro is a piece of API that you cannot change easily, that the compiler runs on every build, that produces the error messages your colleagues will curse, and that the next engineer must understand before they can change anything near it.

By this level the mechanics are not the hard part — judgment is. Every macro is a small compiler embedded in your codebase, and it inherits every compiler's responsibilities: parse user input charitably, produce code that is correct *and* fast, emit errors that point at the user's mistake (not your generated tokens), and stay stable across releases so you do not break downstream users. Most macro disasters in real codebases are not bugs in the expansion; they are *engineering* failures — a macro that should have been a function, a derive that doubled the build time, an error message that sent a team on a two-hour debugging detour, a clever DSL nobody else could maintain after the author left.

The animating principle is **Greenspun's Tenth Rule**, stated tongue-in-cheek but pointing at something real: *"Any sufficiently complicated C or Fortran program contains an ad-hoc, informally-specified, bug-ridden, slow implementation of half of Common Lisp."* The serious reading: powerful programs tend to grow a metaprogramming layer whether you plan for it or not. The professional question is not *whether* to allow that layer, but whether to make it **deliberate, scoped, documented, and tested** — or to let it metastasize as a pile of clever undocumented macros.

This page is about that judgment: the decision matrix for "macro vs. not," the operational costs (compile time, error quality, debuggability, IDE support), API stability and security concerns, and how to set team policy so macros stay a force multiplier rather than a tax. It draws examples from across the spectrum — C build-config macros, Lisp DSLs, Rust derive ecosystems, Elixir frameworks.

---

## Prerequisites

- **Required:** All prior tiers — textual/syntactic/procedural macros, hygiene, fragment specifiers, `syn`/`quote`, `cargo expand`.
- **Required:** Experience reading and reviewing other people's code; some exposure to maintaining a library with external users.
- **Required:** A working notion of build pipelines and CI (where compile-time cost is paid).
- **Helpful but not required:** Having debugged a macro-generated error message in anger.

You do **not** need to know:

- Compiler-internals beyond what `senior.md` covered.
- Any specific framework's macro implementation in detail (we generalize).

---

## Glossary

| Term | Definition |
|------|-----------|
| **Greenspun's Tenth Rule** | The aphorism that complex programs grow an ad-hoc metaprogramming layer; a caution to make that layer deliberate. |
| **Expansion contract** | The documented promise of what syntax a macro accepts and what code it generates — a macro's "API." |
| **Compile-time budget** | The build time a macro consumes per invocation × invocation count; a real cost that scales with the codebase. |
| **Error-message engineering** | Deliberately shaping a macro's failure output (spans, `compile_error!`, messages) so errors point at user code. |
| **Span hygiene** | (Rust) Choosing `call_site` vs `def_site`/`mixed_site` spans so generated identifiers and errors land where intended. |
| **`trybuild` / expectation tests** | Tests that assert a macro produces a *specific compile error* for bad input — testing the failure path. |
| **Macro API stability** | The constraint that a public macro's accepted syntax is part of your semver surface; changing it breaks users. |
| **Build determinism** | A macro must produce the same output for the same input every build (no time, randomness, network, or filesystem reads that change). |
| **`build.rs` / codegen** | Build-script code generation; an alternative to macros for large or external-data-driven generation. |
| **IDE friendliness** | Whether tooling (autocomplete, go-to-definition, type hints) works *through* the macro for users. |
| **X-macro** | A C idiom: a single list of items expanded multiple ways (enum + name table + handler table) from one source of truth. |

---

## Core Concepts

### 1. The Decision: Should This Be a Macro At All?

The professional default is **no**. Macros are justified only when a non-macro mechanism *cannot* do the job. The honest checklist:

- **Can a function do it?** If the thing operates on *values* and does not need to control evaluation, write a function. Functions have signatures, type-check, compose, debug, and produce clean errors.
- **Can a generic + trait do it?** In Rust/C++/Swift, parametric polymorphism handles most "same code, many types" needs without code generation.
- **Can a `const fn` / `constexpr` do it?** Compile-time *computation* over values does not need a macro.
- **Do you need to control evaluation** (short-circuit, wrap a body in setup/teardown, lazy arguments)? Then you need a macro (or a closure-taking function, which is often cleaner).
- **Do you need new *syntax*** the language does not offer (a DSL, an embedded query language)? Macro territory.
- **Do you need *compile-time validation* of literal arguments** (format strings, SQL, regexes, routes)? Macro territory — this is one of the strongest justifications, because it converts run-time failures into build failures.
- **Do you need per-type code generation** the type system cannot infer (`#[derive(Serialize)]`)? Macro territory.

If none of the last four apply, you are about to write a macro to save typing, and that almost always costs more than it saves. The cost is paid by *every future reader*, not by you today.

### 2. Compile Time Is a Production Cost

Macros move work to compile time, and at scale that bill is large. A procedural-macro-heavy Rust crate (`serde`, `diesel`, async frameworks) pulls `syn`/`quote`/`proc-macro2` into the build graph and runs real parsing on *every* annotated item, *every* build. Symptoms: a derive applied to 500 structs adding minutes to a clean build; `cargo build --timings` showing proc-macro crates dominating; CI times creeping up. C++ template metaprogramming has the same pathology — deep instantiation chains and heavy headers blowing up compile time and memory. The professional practices:

- **Measure** (`cargo build --timings`, `-ftime-trace` in Clang) before and after adding a macro-heavy dependency.
- **Prefer `macro_rules!` over proc-macros** when possible — no `syn` parse, much cheaper.
- **Consider `build.rs`/codegen** for *large* or external-data-driven generation, where running a script once and committing/caching the output beats re-parsing on every build.
- **Bound recursion** and avoid quadratic expansion patterns.

The lesson: a macro that makes the *program* faster can make the *team* slower. Both are real costs; weigh them.

### 3. Error Messages Are the Macro's User Interface

The most common professional complaint about macros is not that they are wrong — it is that when *the user* is wrong, the macro's error is incomprehensible. A type error in generated code, reported against a span the user never wrote, sends people on long detours. A macro is a compiler-for-others, and like any compiler its diagnostics are a feature, not an afterthought. Concretely:

- **Forward user spans.** When generated tokens reference the caller's identifiers, attach the caller's span so type errors point at the caller's source.
- **Validate input early and explicitly.** Reject malformed input with `compile_error!`/`syn::Error` carrying a clear message and the offending span, instead of emitting code that fails cryptically three layers down.
- **Never `panic!` in a proc-macro** for user error — it surfaces as "proc macro panicked," the least helpful message possible.
- **Test the failure paths.** Tools like `trybuild` (Rust) snapshot the *exact* compile error for bad input, so you notice when a refactor degrades your diagnostics. The error output is part of your contract.

`println!`/`format!` are the gold standard here: a wrong format string yields a precise, underlined compiler error at the exact byte — that quality is the bar.

### 4. A Public Macro Is Frozen API

The syntax a public macro accepts is part of your semantic-versioning surface, exactly like a function signature. If users write `my_macro!{ name: "x", retries: 3 }`, you cannot quietly rename `retries` or reorder fields without breaking them — and macro inputs are often *harder* to deprecate gracefully than function parameters because there is no overloading and no default-argument story. Implications:

- **Design the accepted syntax as deliberately as a public API.** Once shipped, it is hard to change.
- **Version macro DSLs** and provide migration paths; treat a breaking change to accepted syntax as a major-version bump.
- **Keep the *generated* code's public surface minimal** — every public item a macro emits is also API you must keep stable.

### 5. Debuggability and Tooling Reality

Macros degrade the developer-experience tools your team relies on:

- **Debuggers** step through *generated* code; breakpoints and line numbers can be confusing or wrong.
- **IDEs** may not see through a macro for autocomplete, go-to-definition, or inline type hints — a heavily macro-driven DSL can leave engineers without the tooling they expect for ordinary code.
- **Code review** is harder: a reviewer must mentally expand the macro to judge correctness, and `git blame` points at the macro, not the logic.
- **Mitigation:** `cargo expand` / `gcc -E` / `macroexpand` in the dev loop; keep macros thin (a macro that just calls a normal, well-tested function is far easier to reason about than one with logic inline); and document the expansion so readers do not have to reverse-engineer it.

### 6. Security and Determinism

Procedural macros run **arbitrary code at compile time on the developer's and CI's machines**. That is a supply-chain consideration: a malicious or compromised proc-macro dependency can read files, exfiltrate secrets, or alter generated code during your build. And every macro must be **deterministic** — the same input must produce the same output on every machine and every build. A macro that reads the system clock, the network, an environment variable, or an unsorted directory listing breaks reproducible builds and caching, and produces "works on my machine" failures.

- **Vet proc-macro dependencies** as you would any code that runs in CI with your credentials.
- **Keep macros pure** — input tokens in, tokens out; no I/O that changes the result. (`sqlx`'s compile-time DB check is a deliberate, documented exception that requires explicit configuration precisely because it *does* touch external state.)

### 7. Greenspun in Practice: Designing the Metaprogramming Layer

Large systems accrete a metaprogramming layer. The professional move is to make it intentional: a small, documented, tested set of macros with clear ownership, rather than a sprawl of one-off clever macros. Decide as a team: which DSLs are sanctioned, who owns them, where the expansion contracts are documented, and what the bar is for adding a new macro (usually: "a senior reviewer agrees no non-macro mechanism suffices"). The goal is to capture the *leverage* of macros — eliminating real boilerplate, enabling compile-time checks — while containing their *entropy*.

---

## Real-World Analogies

**A macro is a power tool, and you are running the shop.** A nail gun (macro) drives a hundred nails in the time a hammer drives one. In skilled hands on the right job, it is transformative. Handed to everyone for every task, you get nails in walls that should have had screws, the occasional injury, and a shop nobody else can safely work in. The professional's job is not to ban the nail gun — it is to decide which jobs it is for, train people, and keep the safety on for the rest.

**Macros are the spice, not the meal.** A pinch transforms a dish (one well-placed derive, one compile-time-checked DSL). A handful ruins it (a codebase where you cannot read a function without expanding three macros first). Taste as you go — `cargo expand` is tasting.

**A public macro is a tattoo, not a marker drawing.** A function signature you can change with a deprecation cycle (marker — wipes off). A widely-used public macro's syntax is a tattoo: removing it hurts everyone wearing it. Decide what to ink before you ink it.

---

## Mental Models

- **Default to "not a macro."** The burden of proof is on the macro: it must do something no function, generic, trait, or `const fn` can. Most "macros for convenience" fail this test.
- **A macro is a compiler you ship.** It has the same duties: charitable parsing, correct & fast output, excellent diagnostics, stable interface, reproducible behavior. Hold it to a compiler's standard.
- **Three bills come due:** compile time (every build), cognitive load (every reader), and API rigidity (every downstream user). The run-time win must outweigh all three.
- **Errors are the UI.** Users meet your macro when something is wrong. If the failure message is bad, the macro is bad, however elegant the happy path.
- **Keep macros thin.** Macro for syntax/timing/codegen; ordinary, tested functions for logic. A thin macro over a thick function is debuggable; a thick macro is not.
- **Make the metaprogramming layer deliberate.** Greenspun says it will exist; your job is to make it owned, documented, and bounded rather than emergent and chaotic.

---

## Code Examples

### A thin macro over a tested function (the maintainable shape)

```rust
// The macro does ONLY syntax/ergonomics; all logic is in a normal function.
macro_rules! retry {
    ($attempts:expr, $body:expr) => {
        $crate::retry_impl($attempts, || $body)   // wrap body in a closure → control evaluation
    };
}

// Real, unit-testable, debuggable, clean errors:
pub fn retry_impl<T, E>(attempts: u32, mut f: impl FnMut() -> Result<T, E>) -> Result<T, E> {
    let mut last = None;
    for _ in 0..attempts {
        match f() {
            Ok(v) => return Ok(v),
            Err(e) => last = Some(e),
        }
    }
    Err(last.expect("attempts must be > 0"))
}
```

The macro exists only to let callers write `retry!(3, do_thing())` and have `do_thing()` evaluated lazily on each attempt — the one thing a function cannot do. Everything else is a normal function you can test and debug. This pattern (thin macro, thick function) is the single most important professional habit.

### Validating input and producing a real error (proc-macro)

```rust
// Inside a proc-macro: reject bad input with a spanned, readable error.
let field = match parse_field(&input) {
    Ok(f) => f,
    Err(span) => {
        return syn::Error::new(span, "expected `name = \"...\"`; got something else")
            .to_compile_error()
            .into();   // user sees a clear message at THEIR span, not a panic
    }
};
```

### The C X-macro: one source of truth, many expansions

```c
// Define the list ONCE...
#define COLORS                \
    X(RED,   "red")           \
    X(GREEN, "green")         \
    X(BLUE,  "blue")

// ...expand it as an enum:
typedef enum { 
#define X(sym, str) sym,
    COLORS
#undef X
} Color;

// ...and as a name table, from the SAME list:
static const char *color_name[] = {
#define X(sym, str) str,
    COLORS
#undef X
};
```

Add a color in exactly one place and both the enum and the table update — the X-macro's whole point is a single source of truth. It is one of the few C macro idioms that genuinely earns its keep, because no C language feature otherwise keeps an enum and a parallel table in sync.

### Measuring the compile-time cost

```bash
# Rust: which (often proc-macro) crates dominate the build?
$ cargo build --timings        # writes an HTML report of per-crate build time

# C++: where does the compiler spend its time (templates/instantiation)?
$ clang++ -ftime-trace foo.cpp # emits a Chrome-tracing JSON of compile phases
```

---

## Trade-offs

- **Boilerplate saved vs. tooling lost.** A derive that erases 2,000 lines of hand-written impls is a clear win — *unless* it also blinds the IDE and confuses the debugger for the team. Weigh both.
- **Run-time speed vs. compile-time cost.** Compile-time checks and zero-cost expansions buy run-time performance and safety at the price of build time. At small scale, free; at large scale, a CI-budget line item.
- **Expressiveness vs. accessibility.** A powerful DSL is a productivity multiplier for those fluent in it and a wall for everyone else. The more "magic," the higher the onboarding cost and the bus-factor risk.
- **`macro_rules!` vs proc-macro vs `build.rs`.** Declarative macros: cheap, hygienic, limited. Proc-macros: powerful, costly, must engineer hygiene/errors. Build-scripts: best for large external-data-driven generation, but opaque and outside the type system. Match the tool to the scale and source of the generation.
- **Centralized macro DSL vs. plain code everywhere.** A sanctioned DSL standardizes patterns but concentrates risk and ownership; plain code is verbose but universally readable. Most healthy codebases keep the macro layer small and the plain-code layer large.

---

## Use Cases

Strong, professionally-defensible uses:

- **Compile-time validation of literals** — `format!`/`println!` argument checking, `sqlx::query!` schema checks, compile-time regex/route validation. Converts run-time bugs into build failures; hard to overstate the value.
- **Per-type boilerplate the type system cannot infer** — serialization, comparison, builders, error enums (`thiserror`). Massive, correct, free-of-typos code generation.
- **Single-source-of-truth code generation** — the X-macro; enum + table + dispatch from one list; FFI bindings generated from a declaration.
- **Framework ergonomics with bounded scope** — routing attributes, test harnesses, instrumentation — *when* the framework owns and documents them.

Uses to push back on in review:

- **Macros to save a few keystrokes** where a function/generic works.
- **Clever control-flow DSLs** invented in-house with no documentation and one author.
- **Macros that embed business logic** (untestable, undebuggable) instead of delegating to functions.

---

## Coding Patterns

**Pattern: thin macro, thick function.** The macro handles only syntax/laziness/codegen; all logic lives in an ordinary, tested function the expansion calls.

**Pattern: fail fast with great errors.** Validate input at the top of the macro; emit `compile_error!`/`syn::Error` with the user's span and a sentence explaining the fix.

**Pattern: snapshot the failure path.** Keep `trybuild`-style tests asserting the exact diagnostic for malformed input, so error quality is regression-tested.

**Pattern: document the expansion contract.** A doc comment stating accepted syntax and (a sketch of) generated output, so callers and reviewers need not run `cargo expand` to understand it.

**Pattern: single source of truth (X-macro / one declaration → many outputs).** When several artifacts must stay in sync, generate them all from one list.

**Pattern: prefer `build.rs`/committed codegen for big or data-driven generation**, keeping per-build macro cost low.

---

## Best Practices

- **Make "is a macro justified?" an explicit review question.** Require sign-off that no function/generic/trait/`const fn` suffices before a new macro lands.
- **Budget compile time.** Measure with `cargo build --timings` / `-ftime-trace`; prefer `macro_rules!` to proc-macros; consider build-scripts for heavy generation.
- **Engineer diagnostics deliberately** — forward spans, `compile_error!` over `panic!`, test failure paths. Treat the error message as the macro's primary UI.
- **Keep public macro syntax stable** — it is semver surface; version DSLs and provide migrations.
- **Keep macros thin and pure** — logic in functions, no nondeterministic I/O, deterministic output for reproducible builds.
- **Vet proc-macro dependencies** as code that runs in CI with your secrets.
- **Document the expansion contract** and keep `cargo expand` in the team's dev loop.
- **Bound the metaprogramming layer** — a small, owned, documented set of macros, not an emergent sprawl.

---

## Edge Cases & Pitfalls

- **The derive that doubled the build.** A heavyweight proc-macro applied across hundreds of types silently inflating CI time. Catch it with timing reports, not surprise.
- **The error that pointed at generated code.** A missing span turning every user mistake into a confusing diagnostic against tokens they never wrote.
- **The macro that read the environment.** Non-deterministic output breaking reproducible builds and caching ("works on my machine").
- **The frozen DSL.** A widely-adopted macro syntax you now cannot change without a major version bump and a fleet of broken downstreams.
- **The untestable business logic** baked into a macro body, defeating unit testing and debugging.
- **IDE/debugger blindness** leaving a team without tooling around a macro-heavy module.
- **Supply-chain exposure** from an unvetted proc-macro running arbitrary code in CI.
- **C-specific:** unbounded `#define` clobbering names project-wide (the `<windows.h>` `min`/`max` saga), and conditional-compilation thickets where `#ifdef` combinations are never all tested.

---

## Common Mistakes

1. **Writing a macro that should have been a function/generic** — paying all the macro costs for none of the unique benefits.
2. **Neglecting error-message engineering** — shipping a macro whose failures are unreadable.
3. **Ignoring compile-time cost** until CI is slow, then struggling to attribute it.
4. **Treating public macro syntax as changeable** — breaking downstream users on a "minor" change.
5. **Putting logic in the macro instead of a function** — making it untestable and undebuggable.
6. **Trusting proc-macro dependencies** without considering they run arbitrary code in your build.
7. **Letting the metaprogramming layer grow unowned and undocumented** — the Greenspun trap.

---

## Test Yourself

1. Give the decision checklist for "should this be a macro?" What single question disqualifies most candidate macros?
2. Why is a macro fairly described as "a compiler you ship," and what duties does that framing impose?
3. Name the three bills that come due for every macro, and who pays each.
4. Why is a public macro's accepted syntax a semver concern, and how is changing it harder than changing a function signature?
5. What are the security and determinism constraints on procedural macros, and why do they matter for CI?
6. What does "thin macro, thick function" mean and why is it the most important maintainability habit?

<details>
<summary>Answers</summary>

1. Can a function / generic+trait / `const fn` do it? Do you need to control evaluation, new syntax, compile-time validation of literals, or per-type codegen? If only the first set applies (it could be a function), it should not be a macro — that disqualifies most "convenience" macros.
2. It parses user input, generates correct/fast code, and reports errors — exactly a compiler's job. It imposes the duties of charitable parsing, good diagnostics, a stable interface, and deterministic, reproducible output.
3. **Compile time** (paid every build, by CI and every developer), **cognitive load** (paid by every reader/reviewer), and **API rigidity** (paid by every downstream user when you want to change it).
4. Users write code against the macro's accepted syntax; changing it breaks their builds. It is harder than a function signature because macros lack overloading and default-argument deprecation paths, so graceful migration is awkward.
5. Proc-macros run arbitrary code at compile time on dev/CI machines (supply-chain risk; vet dependencies) and must be deterministic (same input → same output) or they break reproducible builds and caching. CI runs them with your credentials, so both matter operationally.
6. The macro does only what a function cannot (syntax, lazy evaluation, codegen) and delegates all real logic to an ordinary, unit-testable, debuggable function it calls. It keeps the hard-to-debug surface minimal and the testable surface maximal.

</details>

---

## Cheat Sheet

```text
DEFAULT = NOT A MACRO. Burden of proof is on the macro.
JUSTIFIED ONLY IF you need: control of evaluation | new syntax/DSL |
                            compile-time validation of literals | per-type codegen
DISQUALIFIED IF a function / generic+trait / const fn would do it.

A MACRO IS A COMPILER YOU SHIP → owes: charitable parse, fast+correct output,
                                         great errors, stable API, determinism.

THREE BILLS
  compile time   → every build (measure: cargo build --timings / clang -ftime-trace)
  cognitive load → every reader/reviewer (keep thin; document the expansion contract)
  API rigidity   → every downstream user (accepted syntax = semver surface)

ERRORS = THE UI
  forward user spans | compile_error!/syn::Error, NEVER panic! | test failures (trybuild)

OPERATIONAL
  prefer macro_rules! > proc-macro; consider build.rs for big/data-driven codegen
  keep macros PURE + DETERMINISTIC (no clock/net/env/unsorted-FS reads)
  VET proc-macro deps — they run arbitrary code in CI with your secrets
  pattern: THIN MACRO over THICK (tested) FUNCTION
  C: X-macro for single-source-of-truth; beware name-clobbering #defines

GREENSPUN: the metaprogramming layer will exist — make it owned, scoped, documented.
```

---

## Summary

At professional scale a macro stops being a language feature and becomes an **engineering decision with a long tail**. The default answer is *no*: a macro is justified only when it does something a function, generic, trait, or `const fn` cannot — controlling evaluation, providing new syntax, validating literals at compile time, or generating per-type code. Every macro is **a compiler you ship**, owing charitable parsing, fast and correct output, excellent diagnostics, a stable interface, and deterministic behavior. It bills you three ways — **compile time** (every build), **cognitive load** (every reader), and **API rigidity** (every downstream user) — and its **error messages are its true user interface**, so spans, `compile_error!`, and failure-path tests matter as much as the happy path. Procedural macros add **supply-chain and determinism** constraints because they run arbitrary code in CI. The durable habits are: keep macros **thin over thick tested functions**, **budget and measure compile time**, **document the expansion contract**, **treat public syntax as semver**, and **bound the metaprogramming layer** deliberately — heeding **Greenspun's Rule** that the layer will form whether or not you plan for it. Used this way, macros remain what they should be: a precise tool that erases real boilerplate and turns run-time failures into build failures, rather than a clever tax the rest of the team pays forever. The `interview.md` and `tasks.md` files turn these principles into questions and hands-on exercises across C, Lisp/Scheme, Rust, Elixir, and C++.

---

## Further Reading

- Philip Greenspun's Tenth Rule (origin and the serious reading of it) — and Robert Morris's corollary.
- *The Rust API Guidelines* and *The Cargo Book* on `--timings`; David Tolnay's `trybuild` for testing macro diagnostics.
- *Out of the Tar Pit* (Moseley & Marks) — on accidental complexity, the broader frame for "should this exist?"
- The `serde`, `diesel`, and `tracing` codebases — real, large-scale proc-macro engineering with strong error-message discipline to study.
- C: the GCC manual on conditional compilation and the X-macro idiom; the long history of `<windows.h>` `min`/`max` clashes as a cautionary tale.
- Try it: take a clever macro in your codebase, run `cargo expand` (or `gcc -E`), and ask whether a thin-macro-over-function rewrite would be clearer — then measure its build cost with `cargo build --timings`.
