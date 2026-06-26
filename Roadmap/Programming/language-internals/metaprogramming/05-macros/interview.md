# Macros — Interview Questions

> **Topic:** [Macros](README.md)

---

## Introduction

These questions probe whether a candidate truly understands macros — *code that transforms code, mostly at compile time, operating on syntax* — or has only used them as black boxes. The single discriminator across every level is whether the candidate grasps that **a macro receives unevaluated code and produces code**, which is what separates it from a function and explains every macro's power and every macro's footgun.

A strong candidate distinguishes textual substitution (C preprocessor) from syntactic transformation (Lisp, Rust), explains **hygiene** precisely and names which systems provide it, reasons about *when* expansion happens versus when evaluation happens, and — crucially — knows *when not to reach for a macro*. A weaker candidate calls everything "a macro," cannot explain why `i++` breaks `MAX(a,b)`, and thinks `volatile`-style "it's compile-time magic" covers it. The questions move from concepts, through language-specific surfaces (C preprocessor, Lisp/Scheme, Rust, Elixir, C++), into traps where the textbook answer is wrong, and finally to design judgment.

## Table of Contents

- [Conceptual](#conceptual)
- [Language-Specific](#language-specific)
  - [C Preprocessor](#c-preprocessor)
  - [Lisp / Scheme](#lisp--scheme)
  - [Rust](#rust)
  - [Elixir](#elixir)
  - [C++ (templates as macros)](#c-templates-as-macros)
- [Tricky / Trap](#tricky--trap)
- [Design](#design)

---

## Conceptual

### Question 1

**What is a macro, and how is it fundamentally different from a function?**

A macro is code that transforms code: it runs (mostly) at compile time, takes the **unevaluated** source of its arguments, and produces new code that the compiler substitutes in its place. A function runs at *run time* and receives the **evaluated values** of its arguments. The difference is not stylistic — it is the root of everything. Because a macro gets unevaluated code, it can control *whether and when* its arguments are evaluated (enabling short-circuiting, lazy bodies, custom control flow), it can inspect or transform the *structure* of the code (codegen, DSLs), and it can perform *compile-time* checks. Because a function gets evaluated values, it cannot do any of those, but it is type-checked, debuggable, composable, and produces clean errors. The interview-grade summary: **macros operate on syntax before evaluation; functions operate on values during evaluation.**

### Question 2

**Walk me up the spectrum of macro systems from worst to best, and what improves at each step.**

(1) **Textual macros** — the C preprocessor. Blind token substitution with no understanding of syntax, scope, or types. Maximally error-prone (precedence bugs, double evaluation, name capture). (2) **Syntactic / AST macros** — Lisp's `defmacro`: macros receive and return the program's tree (homoiconicity makes code = data), so precedence bugs vanish, but Common Lisp still needs `gensym` to avoid name capture (unhygienic). (3) **Hygienic syntactic macros** — Scheme's `syntax-rules` and Rust's `macro_rules!`: structural *and* automatically hygienic (introduced names cannot collide with the caller's). (4) **Procedural macros with full logic** — Rust's `syn`/`quote` proc-macros, Elixir's `quote`/`unquote`: arbitrary code-to-code transformation in the host language. Each step adds either *structure-awareness* (kills precedence bugs) or *hygiene* (kills capture bugs) or *power* (arbitrary transformation). C++ templates + `constexpr` sit alongside as a different route: type-checked compile-time code generation by type/value substitution.

### Question 3

**What is hygiene, and why does it matter?**

Hygiene is the property that an identifier's meaning is fixed by **where it was written**, not where macro expansion places it. A hygienic macro guarantees two things: names it introduces cannot accidentally **capture** (shadow) the caller's names, and names from the caller cannot accidentally **capture** the macro's references. It matters because the most insidious macro bug is a silent variable collision — a macro that introduces `let tmp = ...` breaking when the caller also has a `tmp`. C has no hygiene (the bug is routine). Common Lisp has none but lets you fake it per-binding with `gensym`. Scheme (`syntax-rules`), Rust (`macro_rules!`), and Elixir (by default) are hygienic automatically — typically implemented by attaching a hygiene context to each identifier (in Rust, via spans) so that name resolution treats same-spelled identifiers from different contexts as different names.

### Question 4

**Why must constructs like `if`, `and`, `or`, and `while` be macros (or special forms) rather than functions?**

Because a function evaluates *all* of its arguments before it runs. `and(a, b)` as a function would evaluate `b` even when `a` is false, defeating short-circuiting; `if(c, then, else)` as a function would evaluate *both* branches, which is wrong (and catastrophic if a branch has side effects or must not run). These constructs must *control evaluation* — evaluate `c`, then evaluate only one branch — and controlling evaluation requires receiving the arguments **unevaluated**, which only macros and built-in special forms do. This is the cleanest demonstration of why macros are not "just functions with extra steps."

### Question 5

**When does a macro "earn its keep," and when is it an abuse?**

It earns its keep when no non-macro mechanism can do the job: controlling evaluation (lazy bodies, resource wrappers like `with-lock`/`with-open-file`), providing genuinely new syntax (a DSL), validating literals at compile time (format-string/SQL/regex checking, turning run-time errors into build errors), or generating per-type code the type system cannot infer (`#[derive(Serialize)]`). It is an abuse when used to save keystrokes where a function, generic, trait, or `const fn` would do — because macros cost compile time, hurt debuggability and tooling, produce worse error messages, and (if public) freeze their syntax as API. The default should be "not a macro"; the burden of proof is on the macro.

### Question 6

**How do you debug a macro that misbehaves?**

You look at what it *expands to*. Every macro system provides a way to see the post-expansion code: `gcc -E` / `clang -E` (C preprocessor), `macroexpand-1`/`macroexpand` (Common Lisp), Racket's macro stepper, `cargo expand` (Rust). The first move when a macro produces wrong behavior or a confusing error is never to guess — it is to print the expansion and read the actual code the compiler saw. Most macro bugs (missing parentheses, double evaluation, statement escaping an `if`, name capture) are obvious the instant you see the expanded text.

---

## Language-Specific

### C Preprocessor

### Question 7

**Why does `#define SQUARE(x) x*x` give the wrong answer for `SQUARE(a+b)`, and how do you fix it?**

The preprocessor performs textual substitution of *tokens*, with no awareness of precedence. `SQUARE(a+b)` expands to `a+b*a+b`, which C parses as `a + (b*a) + b` — not `(a+b)²`. The fix is defensive parenthesization: parenthesize each parameter *and* the whole body: `#define SQUARE(x) ((x)*(x))`, which expands to `((a+b)*(a+b))`. The rule every C programmer internalizes: wrap every parameter and the entire macro body in parentheses, because the preprocessor's blind splicing ignores the precedence the parentheses restore.

### Question 8

**Even with parentheses, `SQUARE(i++)` is broken. Why, and what's the general lesson?**

Parentheses fix precedence, not duplication. `((i++)*(i++))` pastes `i++` **twice**, so `i` is incremented twice and the two factors differ — undefined, garbage result. This is **double evaluation**: a function would have evaluated `i++` once before the call, but a macro duplicates the *text* of the argument wherever the parameter appears. The general lesson: never pass side-effecting expressions to a function-like macro, because the macro may evaluate them more than once. The classic disaster is `MAX(i++, j++)`. The real fix is to prefer a `static inline` function (C) or template (C++), which evaluates each argument exactly once and is type-checked.

### Question 9

**What is the `do { ... } while(0)` idiom and what problem does it solve?**

It wraps a multi-statement macro body so the macro behaves as a single statement. Without it, `#define F() a(); b()` used as `if (c) F();` expands to `if (c) a(); b();` — only `a()` is conditional, `b()` runs unconditionally because a braceless `if` binds only the first statement. Wrapping in `do { a(); b(); } while(0)` makes the body one statement that runs exactly once, works correctly inside `if`/`else`, and requires a trailing semicolon at the call site (so `F();` reads naturally). It is the standard idiom for any multi-statement function-like macro in C.

### Question 10

**What's the difference between `#define`, `const`, and `enum` for a constant in C, and which should you prefer?**

`#define MAX 100` is textual substitution: untyped, unscoped, invisible to the debugger, and replaces every occurrence of the token `MAX` project-wide (a name-clobbering hazard). `const int max = 100;` is a typed, scoped variable the debugger sees, but in C it is not a compile-time constant expression and cannot size an array in older standards. `enum { MAX = 100 };` gives a typed, scoped, compile-time integer constant. Prefer `const`/`enum` (or `constexpr` in C++) for constants; reserve `#define` for what only the preprocessor can do — conditional compilation, include guards, stringizing, token pasting.

### Question 11

**What do `#` and `##` do in a C macro?**

`#x` (stringize) turns the argument *tokens* into a string literal: `#define SHOW(e) printf(#e " = %d\n", (e))` makes `SHOW(a+b)` print `"a+b = 7"`. `a ## b` (token paste) concatenates two tokens into one: `#define MAKE(name) int name ## _count` turns `MAKE(error)` into `int error_count`. Both are things only a macro can do because they operate on the *source text/tokens* of arguments — a function only ever sees evaluated values, never the spelling of its argument.

### Lisp / Scheme

### Question 12

**What is homoiconicity and why does it make Lisp macros powerful?**

Homoiconicity means a language's code is written in one of its own data structures — in Lisp, the list. `(+ 1 2)` is simultaneously a function call and a three-element list. Because code *is* data, a macro is just an ordinary function that takes a list (your code) and returns a list (new code), manipulated with the same `car`/`cdr`/`cons`/`map` you use on any data. There is no separate macro language and no text munging; metaprogramming collapses into normal programming. That is why Lisp macros are the historical gold standard and why people say Lisp lets you "grow the language toward the problem."

### Question 13

**Explain quasiquote, unquote, and unquote-splicing.**

Quasiquote (`` ` ``) starts a *template*: everything inside is treated as literal code-data **except** marked holes. Unquote (`,`) means "evaluate this and insert the single result here." Unquote-splicing (`,@`) means "evaluate this to a *list* and splice its elements in, without the surrounding parentheses." Example: with `body` = `((print x) (log))`, `` `(if ,test (progn ,@body)) `` produces `(if <test> (progn (print x) (log)))`. The point is that the macro's source visually mirrors the code it generates, which is what makes writing macros tractable. Rust's `quote!` (`#x` = unquote, `#(...)* ` = splice) and Elixir's `unquote` are the same idea.

### Question 14

**What bug does `gensym` prevent, and why doesn't Scheme need it?**

`gensym` prevents **variable capture** in Common Lisp's unhygienic `defmacro`. If a macro introduces `` `(let ((tmp ,a)) ...) `` and the caller's code also uses `tmp`, the macro's binding captures the caller's variable and the code breaks silently. `gensym` mints a fresh, un-typeable symbol so the introduced binding cannot collide with anything. Scheme's `syntax-rules` doesn't need `gensym` because it is **hygienic**: the expander automatically renames identifiers the macro introduces so they are distinct from the caller's, regardless of spelling. Same protection, but automatic instead of manual.

### Question 15

**Write a hygienic `swap!` in Scheme and explain why it survives `(let ((tmp 1) (x 2)) (swap! tmp x))`.**

```scheme
(define-syntax swap!
  (syntax-rules ()
    ((_ a b) (let ((tmp a)) (set! a b) (set! b tmp)))))
```

It survives because hygiene makes the `tmp` *introduced by the macro* a different identifier from the `tmp` *written by the caller*, even though both are spelled `tmp`. The expander gives the macro's `tmp` its own hygiene context, so when the caller passes their own `tmp` as `a`, the two never collide. In unhygienic Common Lisp the equivalent would need `(let ((g (gensym))) ...)` to be safe.

### Rust

### Question 16

**What is the difference between `macro_rules!` and procedural macros, and when do you use each?**

`macro_rules!` is *declarative*: you write pattern → template rules over token trees, with fragment specifiers (`$x:expr`, `$t:ty`, `$i:ident`) and repetition (`$(...)*`). It is hygienic by default and needs no extra crate — use it for token-shape transformations, variadic constructors (`vec!`-like), and simple codegen. **Procedural macros** are Rust functions (in a `proc-macro` crate) that map a `TokenStream` to a `TokenStream`, almost always parsing with `syn` and generating with `quote!`. Use them when you must introspect a type's structure, run arbitrary logic, or accept foreign syntax (SQL, GraphQL). They are more powerful but cost compile time and require explicit span/hygiene reasoning. Rule of thumb: try `macro_rules!` first; escalate to a proc-macro only when forced.

### Question 17

**Name the three kinds of procedural macro with a real-world example of each.**

**Derive** macros — `#[derive(Trait)]` generates an `impl` from a type definition; e.g. `#[derive(Serialize)]` (serde), `#[derive(Parser)]` (clap). **Attribute** macros — `#[name(args)]` transforms the item they annotate; e.g. `#[get("/users/{id}")]` rewriting a function into a route handler. **Function-like** macros — `name!(...)` that run procedural code; e.g. `sqlx::query!("SELECT ...")` parsing SQL at compile time and checking it against the database schema. All three use `syn` to parse and `quote!` to generate.

### Question 18

**What does the fragment specifier `:expr` guarantee, and what does it crucially *not* guarantee?**

`:expr` guarantees the captured fragment is a complete, parsed **expression** that splices into the output as a single opaque unit — so the C-style precedence bug is impossible (`2 + 3` cannot "bleed" into a surrounding `*`). It does **not** guarantee single evaluation: if your template uses the metavariable more than once, the expression is still duplicated and runs multiple times — the same double-evaluation hazard as C. So `macro_rules! square { ($x:expr) => { $x * $x } }` still evaluates `$x` twice; you must bind it once: `{ let v = $x; v * v }`. Fragment specifiers fix structure, not duplication.

### Question 19

**Is `macro_rules!` fully hygienic? Are procedural macros hygienic?**

`macro_rules!` is hygienic for identifiers it introduces *literally* (a `let v = ...` inside the macro won't collide with the caller's `v`), but identifiers the caller passes in (e.g. via `$name:ident`) intentionally refer to the caller's scope — that's desired, not a leak. Procedural macros have **opt-in** hygiene: `quote!` by default emits tokens with call-site spans, so a generated identifier can be visible to the caller (sometimes wanted, sometimes a bug). The proc-macro author must reason about spans explicitly — `Span::call_site()` (visible to caller) vs `Span::mixed_site()`/`def_site` (private to the macro). So: `macro_rules!` is hygienic by default; proc-macros require deliberate hygiene management.

### Elixir

### Question 20

**How do Elixir macros work, and how do `quote` and `unquote` map onto the Lisp model?**

Elixir macros are Lisp-style: Elixir code has a well-defined AST representation, `quote do ... end` produces that AST (the analog of Lisp's quasiquote `` ` ``), and `unquote(...)` splices an evaluated value into the quoted AST (the analog of `,`). `defmacro` defines a transformer that returns quoted code, which the compiler substitutes for the call. Elixir variables are hygienic by default; you opt *out* with `var!` when you deliberately want to inject a binding into the caller's scope. Much of Elixir itself (`unless`, `if`'s sugar) and frameworks like Phoenix and Ecto are built from macros over quoted ASTs — the homoiconic-style model on the BEAM.

### C++ (templates as macros)

### Question 21

**How do C++ templates and `constexpr`/`consteval` fix the classic C macro problems, and what can they not do?**

A function template like `template<typename T> T max_t(T a, T b) { return a>b?a:b; }` is a real, *instantiated* function: each argument is evaluated exactly **once** and the call is **type-checked**, eliminating the double-evaluation and type-safety holes of `#define MAX`. `constexpr` marks computation that *may* run at compile time; `consteval` marks computation that *must*. Together they let ordinary-looking, type-checked code do compile-time work that C would have done with fragile macros. What they cannot do: arbitrary *syntax* transformation, accepting foreign DSL syntax, or generating code by rewriting tokens — templates substitute *types and values*, not syntax. That's why modern C++ says "prefer templates/`constexpr` to function-like macros," but Rust proc-macros and Lisp macros still occupy a niche templates can't reach.

### Question 22

**Are C++ templates "macros"? Defend your answer.**

Loosely, yes — they are a compile-time code-generation mechanism, and template metaprogramming is (accidentally) Turing-complete, so they "transform code at compile time" in spirit. Precisely, no — they are not text or token substitution; they are *type/value substitution* integrated with the type system, overload resolution, and name lookup. The practical distinction: a template `max_t<int>` is type-checked and evaluates arguments once (unlike `#define MAX`), but it cannot do what a textual or syntactic macro does — accept invalid-until-transformed syntax or rewrite the structure of arbitrary code. The honest interview answer is "they overlap with macros in *purpose* (compile-time codegen) but differ fundamentally in *mechanism* (typed substitution, not syntactic rewriting)."

---

## Tricky / Trap

### Question 23

**A junior says `#define A A + 1` will loop forever during preprocessing. Are they right?**

No. The C preprocessor refuses to expand a macro recursively *inside its own expansion* — when it expands `A` and sees `A` again in the result, it leaves that inner `A` un-expanded (it's "painted blue"). So `#define A A + 1` expands `A` to literally `A + 1`, with the second `A` left alone (and if no other `A` macro exists, it remains as the identifier `A`). The trap is expecting infinite recursion; C macros specifically prevent it. (Note: *mutually* recursive or argument-driven recursion in other systems — Rust `macro_rules!`, C++ templates — *does* recurse and is bounded by a recursion/instantiation limit instead.)

### Question 24

**`#define MAX(a,b) ((a)>(b)?(a):(b))` is fully parenthesized. Is `MAX(f(), g())` safe?**

Not necessarily — it's safe against *precedence* bugs but not against *double evaluation* and *cost*. `((f())>(g())?(f()):(g()))` evaluates whichever of `f()` or `g()` "wins" **twice**, and evaluates both at least once. If `f()`/`g()` have side effects, behavior is wrong; if they're expensive, you pay twice. Parenthesization never fixes duplication. The correct tool is `std::max` (a template/function) which evaluates each argument exactly once. This question catches candidates who think "I added all the parentheses, therefore the macro is correct."

### Question 25

**You write a Common Lisp macro that introduces `result` and works in all your tests, then a colleague's code breaks. What happened?**

Variable capture: your macro introduced a binding (or referenced a name) called `result`, and the colleague's code used `result` in a way that collided — either the macro's `result` shadowed theirs, or theirs shadowed the macro's reference. Your tests passed only because no test happened to use the name `result`. This is exactly why Common Lisp macro authors `gensym` every introduced binding, and why hygienic systems (Scheme, Rust) eliminate the bug class entirely. The lesson: an unhygienic macro that "works in all my tests" can still carry a latent capture bug that surfaces only on a caller with the wrong variable name.

### Question 26

**Why might a Rust user see a confusing type error pointing at code they never wrote?**

Because a macro generated that code, and the macro author didn't manage **spans** carefully. When generated tokens reference the user's identifiers without carrying the user's source spans, a type error in the generated code is reported against a span inside the macro's `quote!` body — code the user never typed. This is the most common complaint about macro-heavy crates. The fix (on the macro author's side) is to forward the user's spans onto generated tokens and to validate input early with `compile_error!`/`syn::Error` carrying precise spans, so errors point back at the user's actual mistake.

### Question 27

**A teammate added a `#[derive(...)]` to many structs and CI got 40% slower with no run-time change. Explain.**

Procedural macros run at **compile time**, on every build, for every annotated item. A derive applied across hundreds of types means the macro (plus its `syn`/`quote`/`proc-macro2` dependencies) parses and generates code hundreds of times per build — that's pure compile-time cost with zero run-time footprint. This is a classic trap: macros trade compile time for run-time convenience/performance, and at scale the compile-time bill is real. Diagnose with `cargo build --timings`; mitigate by preferring `macro_rules!` where possible, trimming what the derive generates, or moving heavy generation to a `build.rs`/committed-codegen step.

### Question 28

**Is `i = 5; SQUARE(i++)` undefined behavior or just "wrong"? (Assume `#define SQUARE(x) ((x)*(x))`.)**

It's **undefined behavior** in C, not merely a logic error. The expansion `((i++)*(i++))` modifies `i` twice with no sequence point between the two modifications, which the C standard declares UB — the compiler may produce any result, and is even free to do something nonsensical. The trap is candidates saying "it just increments twice and multiplies" as if the result were merely surprising-but-defined. The double-modification-without-a-sequence-point is genuinely undefined. The deeper point: macros can silently produce *undefined behavior* from innocent-looking calls, which is worse than a wrong-but-defined answer.

---

## Design

### Question 29

**You're designing a logging facility. Should the log call be a macro or a function, and why?**

A macro, for two reasons a function can't satisfy. First, **lazy evaluation of arguments**: `log_debug!("state: {}", expensive_dump())` should *not* call `expensive_dump()` when debug logging is disabled — a function would evaluate it unconditionally; a macro can guard the evaluation behind the level check. Second, **compile-time format-string checking** and capturing call-site metadata (file, line, module) — `format!`/`println!`-style macros validate the format string against the arguments at compile time and can stringize/capture source location, which a function cannot do because it never sees the literal's source. So the canonical design is a thin macro that checks the level and source info and otherwise delegates to a real, tested logging function — "thin macro over thick function."

### Question 30

**Your team wants a DSL for defining state machines. How do you decide between a macro-based DSL, a builder API, and a config file + codegen?**

Weigh expressiveness against cost. A **builder API** (plain functions/methods) is the safest default: fully type-checked, IDE-friendly, debuggable, no compile-time tax — choose it unless you genuinely need syntax the language can't express. A **macro DSL** buys nicer syntax and compile-time validation (illegal transitions caught at build time) but costs compile time, degrades tooling/debuggability, freezes its syntax as API, and concentrates maintenance on whoever owns the macro. A **config file + `build.rs`/codegen** is best when the machine definition is large, data-driven, or authored by non-Rust folks, and when you want generation to happen once rather than on every build. Decision: start with the builder; adopt a macro only if compile-time validation or syntax ergonomics are worth the tax and the team will own it; reach for codegen when the source of truth is external data.

### Question 31

**What's your checklist for reviewing a pull request that adds a new macro?**

(1) **Justification** — could a function, generic, trait, or `const fn` do this? If yes, reject the macro. (2) **Hygiene** — does it introduce bindings that could capture the caller's names (unhygienic systems / proc-macro spans)? (3) **Single evaluation** — are any arguments with possible side effects evaluated more than once? (4) **Error messages** — does bad input produce a clear, spanned diagnostic, or a cryptic failure / `panic!`? Are failure paths tested (`trybuild`)? (5) **Compile-time cost** — does it pull in heavy deps or run across many items? (6) **API stability** — if public, is the accepted syntax deliberate, since it's now semver surface? (7) **Determinism/security** — does it read clock/env/network/filesystem (breaking reproducibility), and if it's a proc-macro, is the dependency trusted to run in CI? (8) **Thinness** — is logic delegated to a testable function, or baked into the macro? A macro that passes all eight is one worth merging.

### Question 32

**Explain Greenspun's Tenth Rule and what it implies for how you architect a large system's metaprogramming.**

Greenspun's Tenth Rule — "any sufficiently complicated C or Fortran program contains an ad-hoc, informally-specified, bug-ridden, slow implementation of half of Common Lisp" — observes (half-jokingly) that complex programs inevitably grow a metaprogramming/interpreter layer whether or not it was planned. The architectural implication is not to ban that layer but to make it **deliberate**: sanction a small, owned, documented set of macros/DSLs with clear expansion contracts, a review bar ("no non-macro mechanism suffices"), and tested error paths — rather than letting a sprawl of undocumented clever macros accrete. The goal is to capture the leverage (eliminating boilerplate, compile-time checks) while containing the entropy (unreadable code, slow builds, broken tooling, bus-factor risk). Plan the metaprogramming layer, or it will plan itself, badly.

---
