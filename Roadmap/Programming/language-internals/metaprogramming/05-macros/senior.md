# Macros — Senior Level

> **Topic:** [Macros](README.md)
> **Focus:** Hygienic, structured macros in a statically typed world — Rust's `macro_rules!` (token-tree pattern matching) and procedural macros (`syn` + `quote`, the three kinds), the formal meaning of hygiene, expansion ordering, and how C++ templates/`constexpr` and Elixir's `quote`/`unquote` occupy the same design space.

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

> 🎓 At junior level you saw textual macros and their bugs. At middle level you saw Lisp's homoiconic, syntactic macros and the concept of hygiene. At senior level you must answer the engineering questions: *how do you get hygienic, structured macros into a statically typed language with no homoiconicity?* How do you parse arbitrary syntax inside a macro, generate a hundred lines of trait implementation from a `#[derive]`, and keep the error messages from becoming unreadable? The answer, in the language that took macros most seriously since Lisp, is Rust.

Rust is interesting because it is *not* homoiconic — its surface syntax is conventional C-family text, not lists — yet it ships a powerful, **hygienic** macro system. It does this by exposing the program as **token trees**: not flat tokens (like C) and not fully-parsed ASTs (like Lisp lists), but a tree of tokens where bracket pairs `() [] {}` group their contents. Rust offers two distinct macro mechanisms over this representation:

1. **Declarative macros** (`macro_rules!`): pattern-match on token trees and emit token trees, with **fragment specifiers** (`$x:expr`, `$t:ty`, `$i:ident`) that constrain what each piece must be, and **repetition** (`$(...)*`). Hygienic by default. The descendant of Scheme's `syntax-rules`.
2. **Procedural macros**: ordinary Rust functions that receive a `TokenStream`, parse it (almost always with the `syn` crate into a real AST), and produce a `TokenStream` (almost always built with the `quote!` macro). These come in three kinds: **derive** (`#[derive(Serialize)]`), **attribute** (`#[route(GET, "/")]`), and **function-like** (`sql!(...)`). This is the descendant of Lisp's `defmacro` — a Turing-complete transformation written in the host language.

Around this sits the central, hard-won concept that distinguishes good macro systems from bad: **hygiene**. A hygienic macro guarantees that identifiers it introduces neither *capture* the caller's identifiers nor *are captured by* them. C has zero hygiene (the `tmp` collision). Common Lisp has none but lets you fake it with `gensym`. Scheme and Rust have it built in. Understanding *why* hygiene is hard — and where even Rust's hygiene has seams — is a senior-level distinction.

This page covers Rust's two systems in depth, hygiene formally, expansion ordering and recursion, debugging expanded code (`cargo expand`), and how C++ templates + `constexpr`/`consteval` and Elixir's `quote`/`unquote` solve overlapping problems. `professional.md` then covers shipping macro-heavy crates: compile-time budgets, error-message engineering, and when a macro is the wrong tool at organizational scale.

---

## Prerequisites

- **Required:** The junior and middle pages — textual vs syntactic macros, homoiconicity, quasiquotation, and the capture/hygiene problem with `gensym`.
- **Required:** Working Rust knowledge — traits, generics, ownership at a reading level. You should recognize `#[derive(Debug)]`.
- **Required:** What an AST is and what a parser does.
- **Helpful but not required:** C++ template syntax and a sense of what `constexpr` means.
- **Helpful but not required:** Any compiler-frontend exposure (token streams, spans).

You do **not** need to know:

- The internals of `rustc`'s macro expander or its name-resolution algorithm.
- How to write a full parser by hand (`syn` does this).

---

## Glossary

| Term | Definition |
|------|-----------|
| **Token tree** | Rust's macro input model: a sequence of tokens where each bracket pair groups its contents into a sub-tree. Coarser than an AST, finer than flat tokens. |
| **`macro_rules!`** | Rust's *declarative* macro form: pattern → template rules over token trees. Hygienic. |
| **Fragment specifier** | In `macro_rules!`, the `:kind` that constrains a metavariable: `expr`, `ty`, `ident`, `pat`, `block`, `stmt`, `path`, `tt`, `literal`, etc. |
| **Metavariable** | A `$name` in a `macro_rules!` pattern that captures a fragment. |
| **Repetition** | `$( ... )sep*` / `$( ... )+` / `$( ... )?` — match/emit a fragment zero-or-more, one-or-more, or zero-or-one times. |
| **Procedural macro** | A Rust function (in a special `proc-macro` crate) that maps a `TokenStream` to a `TokenStream`. Three kinds: derive, attribute, function-like. |
| **`TokenStream`** | The input/output type of a procedural macro: a flat-ish stream of tokens with spans. |
| **`syn`** | The de-facto crate that parses a `TokenStream` into a typed Rust AST. |
| **`quote!`** | The de-facto crate/macro that builds a `TokenStream` from a quasiquote-like template (`#var` interpolates, `#(...)*` repeats). Rust's quasiquotation. |
| **Derive macro** | `#[derive(Trait)]` — generates an `impl` block for a type from its definition. The most common procedural macro. |
| **Attribute macro** | `#[name(args)]` — transforms the item it is attached to (e.g. a function → a route handler). |
| **Hygiene** | The guarantee that macro-introduced identifiers do not collide with the caller's, in either direction. |
| **Span** | Source-location + hygiene context attached to every token; drives both error messages and hygiene. |
| **`cargo expand`** | Tool that prints the fully macro-expanded source — Rust's `gcc -E` / `macroexpand`. |
| **`constexpr` / `consteval`** | C++ keywords marking computation that may (`constexpr`) or must (`consteval`) run at compile time. A different route to compile-time work than macros. |

---

## Core Concepts

### 1. Token Trees: Rust's Macro Substrate

Rust macros do not see characters (like C) or fully-parsed ASTs (like Lisp). They see **token trees**: a stream of tokens in which every `()`, `[]`, `{}` pair groups everything between it into a nested unit. So `f(a + b)` is the identifier `f` followed by a parenthesized group containing `a`, `+`, `b`. This representation is deliberately chosen: it is structured enough that brackets always balance and a macro can recurse into groups, but loose enough that a macro can accept syntax that is *not yet valid Rust* (a `sql!("SELECT …")` macro can accept tokens that mean nothing to Rust's grammar). The macro's job is to turn token trees into *valid* Rust.

### 2. `macro_rules!`: Declarative, Fragment-Typed, Hygienic

A `macro_rules!` macro is a list of `(matcher => transcriber)` rules. The matcher is a token-tree pattern with **metavariables** like `$x`, each tagged with a **fragment specifier** that says what category of syntax it must be:

```rust
macro_rules! square {
    ($x:expr) => { ($x) * ($x) };   // $x must be an expression
}

let b = square!(2 + 3);   // expands to ((2 + 3)) * ((2 + 3)) → 25
```

Crucially, `$x:expr` does **not** paste tokens. It captures `2 + 3` as a *parsed expression*, an opaque unit. When it is substituted into `($x) * ($x)`, Rust treats it as one expression — so the C precedence bug **cannot happen**: there is no way for `2 + 3` to "bleed" into the surrounding `*`. The fragment specifier turns the macro from a text-splicer into a syntax-splicer.

Fragment specifiers you will use constantly: `expr` (expression), `ty` (type), `ident` (identifier), `pat` (pattern), `block`, `stmt`, `path`, `literal`, and `tt` (a single token tree — the escape hatch for "anything"). Choosing the right specifier is a real design decision: `expr` lets the matcher accept rich syntax but *restricts* where the result can be used afterward (Rust will not let you re-inspect an `expr` fragment's internals), while `tt` is maximally flexible but unstructured.

**Repetition** handles variable arity:

```rust
macro_rules! my_vec {
    ( $( $x:expr ),* $(,)? ) => {        // zero or more exprs, comma-separated
        {
            let mut v = Vec::new();
            $( v.push($x); )*            // emit one push per captured $x
            v
        }
    };
}

let xs = my_vec![1, 2, 3];   // builds a Vec with 1, 2, 3
```

`$( ... ),*` means "match this group zero or more times, separated by commas." In the transcriber, `$( v.push($x); )*` *replays* the group once per match. The `$(,)?` allows an optional trailing comma. This is the same idea as Scheme's `...` ellipsis.

**Hygiene:** the `v` introduced inside `my_vec!` is automatically distinct from any `v` in the caller's scope. You can call `my_vec!` inside a function that already has a `v` and nothing breaks — Rust's macro expander attaches hygiene context (via spans) so the macro's `v` and the caller's `v` are different identifiers even though they are spelled the same. This is `syntax-rules` hygiene, carried into a statically typed language.

### 3. Procedural Macros: Parse with `syn`, Generate with `quote`

`macro_rules!` is declarative and limited — it matches shapes and replays templates, but it cannot run arbitrary logic, read a struct's fields by name, or talk to the type system. **Procedural macros** can: they are ordinary Rust functions, compiled into a compiler plugin, that receive a `TokenStream` and return a `TokenStream`. In practice you never manipulate raw tokens — you use two crates:

- **`syn`** parses the input `TokenStream` into a typed AST (`syn::DeriveInput`, `syn::ItemFn`, `syn::Expr`, …).
- **`quote!`** builds the output `TokenStream` from a quasiquote template, where `#var` interpolates a value and `#(...)* ` repeats — the direct analog of Lisp's `` ` ``/`,`/`,@`.

There are **three kinds**:

**(a) Derive macros** — `#[derive(MyTrait)]` on a type, generating an `impl`. This is what powers `#[derive(Debug, Clone, Serialize)]`. The macro receives the type's definition and emits an implementation:

```rust
use proc_macro::TokenStream;
use quote::quote;
use syn::{parse_macro_input, DeriveInput};

#[proc_macro_derive(HelloName)]
pub fn derive_hello(input: TokenStream) -> TokenStream {
    let ast = parse_macro_input!(input as DeriveInput);
    let name = &ast.ident;                       // the struct's name
    let expanded = quote! {                       // a quasiquote template
        impl HelloName for #name {
            fn hello() -> &'static str {
                stringify!(#name)
            }
        }
    };
    expanded.into()
}
```

Now `#[derive(HelloName)] struct Widget;` automatically gains a `HelloName` impl. The macro reads the type's name via `syn` and writes the `impl` via `quote!`. This is how `serde` generates serialization code, how `clap` generates argument parsers — enormous boilerplate, written once, generated per type.

**(b) Attribute macros** — `#[name(args)]` that *transform the item they annotate*. Web frameworks use these: `#[get("/users/{id}")]` on a function rewrites it into a registered route handler. The macro receives both the attribute's arguments and the annotated item, and returns replacement tokens.

**(c) Function-like procedural macros** — `name!(...)` that look like `macro_rules!` calls but run procedural code. Example: `sqlx::query!("SELECT * FROM users")` parses the SQL *at compile time*, checks it against your database schema, and generates strongly-typed result code — a compile-time check no function or declarative macro could do.

### 4. Hygiene, Formally

Hygiene is the property that **the meaning of an identifier is determined by where it was *written*, not where it ends up after expansion.** Two failure modes it prevents:

- **Capture of caller by macro:** a macro introduces `let tmp = ...;`. Hygiene guarantees this `tmp` is invisible to the caller's code and does not shadow the caller's `tmp`.
- **Capture of macro by caller:** a macro expands to `result + 1` referring to a function `result` from the macro's own crate. Hygiene guarantees the caller cannot accidentally redirect that `result` to a local of their own.

Implementation-wise, hygiene is carried by **spans**: every token gets a hygiene context, and name resolution treats two same-spelled identifiers from different hygiene contexts as *different names*. This is the modern, span-based reformulation of Scheme's renaming algorithm. (Common Lisp's `gensym` is a *manual* approximation: by minting an un-typeable name, you simulate a distinct hygiene context for that one binding.)

Two important nuances a senior should know:
- **`macro_rules!` is mostly hygienic, but not for everything.** Identifiers passed *in by the caller* (`$x:ident`) are intentionally not renamed — they refer to the caller's scope, which is what you want. Hygiene applies to identifiers the macro *writes literally*.
- **Procedural macros have *opt-in* hygiene.** `quote!` by default produces tokens with call-site spans, which means an identifier you generate can be visible to the caller (sometimes desired, sometimes a bug). You control this explicitly via `Span::call_site()` vs `Span::mixed_site()`/`def_site`. Senior engineers writing proc-macros must reason about spans deliberately; hygiene is not fully automatic the way `macro_rules!` is.

### 5. Expansion Ordering and Recursion

Macros expand outside-in in Rust, and a macro may expand to code containing further macro calls, which are then expanded in turn. `macro_rules!` macros can be **recursive** (a rule that calls the same macro on the "rest" of its input), which is how they implement variadic and structural transformations:

```rust
macro_rules! count {
    () => { 0 };
    ($head:tt $($tail:tt)*) => { 1 + count!($($tail)*) };
}
```

Rust caps recursion depth (`#![recursion_limit]`) to bound compile time. C++ template instantiation recurses similarly (and historically had the same depth-limit dance). The senior insight: **macro recursion runs at compile time, so deep recursion costs *compile* time, not run time** — a real budget you spend.

### 6. The Same Design Space: C++ Templates and Elixir

**C++ templates** are, in effect, a separate (Turing-complete, accidentally so) compile-time language. Template metaprogramming generates code by *instantiation*, and modern `constexpr`/`consteval` functions let ordinary-looking code run at compile time:

```cpp
template <typename T> T max_t(T a, T b) { return a > b ? a : b; }  // no double-eval, type-checked

constexpr int factorial(int n) {        // may run at compile time
    return n <= 1 ? 1 : n * factorial(n - 1);
}
consteval int must_be_compile_time(int n) { return n * n; }  // MUST run at compile time
```

`max_t` solves the C `MAX` macro's double-evaluation and type-safety problems entirely — it is a real (instantiated) function, so each argument is evaluated once and type-checked. This is why modern C++ guidance is *"replace function-like macros with templates and `constexpr`."* Templates do not, however, give you arbitrary syntax transformation or new control flow the way Rust proc-macros or Lisp macros do — they generate code by substituting *types and values*, not by rewriting *syntax*.

**Elixir** brings Lisp-style macros to the BEAM: `quote` turns code into its AST representation, `unquote` splices values in, and `defmacro` defines a transformer. Elixir's entire `if`/`unless`/`with` surface, and much of Phoenix and Ecto's DSL, is built from macros over a quoted AST — the same homoiconic-style model as Lisp, with Elixir-specific hygiene rules (variables are hygienic by default; you opt out with `var!` when you deliberately want to inject into the caller's scope).

---

## Real-World Analogies

**Three tiers of pasta-making.** A C macro is squeezing dough through a stencil — you get a shape, but the machine has no idea it is food. `macro_rules!` is a pasta press with *interchangeable dies* (`:expr`, `:ty`, `:ident`): each die only accepts dough of a certain kind and produces a guaranteed-valid shape. A procedural macro is a chef who takes your raw ingredients (`TokenStream`), reads the recipe (`syn` parses it), and cooks an arbitrary dish (`quote!` plates it). More power, more responsibility, more ways to over-season.

**Hygiene as a sterile operating room.** An unhygienic macro is surgery in a kitchen — the macro's instruments (`tmp`) and the patient's belongings (the caller's `tmp`) get mixed on the same table. Hygiene is the sterile field: every instrument the macro brings in is tagged and quarantined from the patient's environment, so nothing the macro introduces can touch — or be touched by — the caller's names by accident.

**`#[derive]` as a contract-printing machine.** Writing `Debug`, `Clone`, `PartialEq`, `Serialize` by hand for every struct is like hand-copying a legal contract for each new client. `#[derive(...)]` is the machine that prints the correct contract from the client's details automatically — the boilerplate the type system *could* infer but the language will not write for you.

---

## Mental Models

- **Choose your representation: text → token-tree → AST.** C works on text (no safety). `macro_rules!` works on token trees with typed fragments (structural safety, limited logic). Proc-macros work on a parsed AST via `syn` (full logic, full responsibility). Pick the weakest tool that suffices.
- **Fragment specifiers are types for syntax.** `$x:expr` is "this must be an expression," giving you the structural guarantees that make precedence bugs impossible.
- **Hygiene = identity by origin, not by spelling.** Two `tmp`s from different hygiene contexts are different variables. Spans carry the context. This is why Rust/Scheme macros are safe and C macros are not.
- **`quote!` is quasiquotation; `#x` is unquote, `#(...)* ` is splicing.** If you understood Lisp's `` ` ``/`,`/`,@`, you already understand `quote!`.
- **Macro work is compile-time work.** Recursion depth, `syn` parsing, and template generation all cost build time. A macro that saves run time can cost minutes of compile time — a trade you must weigh.
- **Templates ≠ macros.** C++ templates generate code by substituting types/values and are type-checked; they fix the double-eval/type-safety problems of C macros but do not transform syntax. Different tool, overlapping use cases.

---

## Code Examples

### `macro_rules!` with multiple fragment specifiers and repetition

```rust
macro_rules! hash_map {
    ( $( $key:expr => $val:expr ),* $(,)? ) => {{
        let mut m = ::std::collections::HashMap::new();
        $( m.insert($key, $val); )*
        m
    }};
}

let m = hash_map!{ "a" => 1, "b" => 2 };   // hygienic 'm', one insert per pair
```

### A derive macro skeleton (`syn` + `quote`)

```rust
#[proc_macro_derive(Builder)]
pub fn derive_builder(input: TokenStream) -> TokenStream {
    let ast = parse_macro_input!(input as DeriveInput);
    let name = &ast.ident;
    let builder = quote::format_ident!("{}Builder", name);

    // (real code would iterate ast.data's fields here)
    let expanded = quote! {
        pub struct #builder { /* per-field Option<...> */ }
        impl #name {
            pub fn builder() -> #builder { #builder { } }
        }
    };
    expanded.into()
}
```

This is the shape of `serde`, `clap`, `thiserror`: parse the type, iterate fields, emit an `impl`. The `#name` / `#builder` interpolations are `quote!`'s unquote.

### Seeing the truth: `cargo expand`

```bash
$ cargo install cargo-expand
$ cargo expand            # prints the whole crate with all macros expanded
$ cargo expand my_module::my_fn
```

`cargo expand` is non-negotiable when debugging a macro — it shows the actual generated code, with hygiene-mangled identifiers rendered, so you can see exactly what the compiler compiled. It is the Rust analog of `gcc -E` and `macroexpand`.

### Elixir `quote`/`unquote`

```elixir
defmacro unless(condition, do: block) do
  quote do
    if !unquote(condition), do: unquote(block)
  end
end

# unless x > 0, do: IO.puts("non-positive")
# expands to:  if !(x > 0), do: IO.puts("non-positive")
```

`quote do ... end` builds the AST; `unquote(...)` splices the caller's expressions in — homoiconic macros on the BEAM, hygienic by default.

---

## Trade-offs

- **`macro_rules!` vs procedural macros.** Declarative macros are simpler, hygienic by default, and need no separate crate — prefer them for token-shape transformations and variadic helpers. Procedural macros are required when you must read a type's structure, run logic, or accept foreign syntax (SQL, GraphQL), but they live in a separate `proc-macro` crate, slow compiles, and demand careful span/hygiene reasoning.
- **Compile time vs run time.** Macros move work to compile time — great for run-time performance and compile-time checks (`println!` validates its format string; `sqlx::query!` validates SQL against the schema), but heavy macro use (and `syn`/`quote` in dependency trees) is a leading cause of slow Rust builds.
- **Power vs error quality.** The more a macro transforms, the worse its errors can become — generated code that fails to type-check points at *generated* spans the user never wrote. Good macros invest heavily in span management so errors point back at the user's source.
- **Macros vs templates (C++).** Templates are type-checked and integrate with overload resolution, but their error messages are notoriously verbose; macros transform syntax but lack type awareness. Modern C++ prefers templates/`constexpr` over function-like macros for exactly the safety reasons in `junior.md`.
- **Macros vs plain functions/traits.** A macro that could be a generic function + trait usually *should* be — functions have signatures, are debuggable, compose, and produce clean errors. Reserve macros for what functions provably cannot do.

---

## Use Cases

- **Eliminating boilerplate the type system cannot infer** — `#[derive(Debug, Clone, Serialize)]` generates per-type impls; without it you would hand-write thousands of lines.
- **Compile-time-checked DSLs** — `println!`/`format!` validate format strings *at compile time*; `sqlx::query!` checks SQL against a live schema; routing macros validate URL patterns. These checks are impossible with functions.
- **Variadic / ergonomic constructors** — `vec![1, 2, 3]`, `hashmap!{...}`, `json!({...})` — pleasant syntax expanding to efficient code.
- **Custom control flow** — `tokio::select!`, error-handling macros, test-harness macros (`#[test]`, `#[tokio::test]`).
- **Attribute-driven frameworks** — web routing (`#[get("/")]`), benchmark/test registration, FFI bindings.

When *not* to: anything a generic function, trait, or `const fn` can express. Reach for the macro only when you need new syntax, compile-time validation, or per-type code generation.

---

## Coding Patterns

**Pattern: prefer `macro_rules!` first.** Reach for a proc-macro only when you need to inspect type structure or run logic.

**Pattern: `syn` to parse, `quote!` to generate.** Never hand-build `TokenStream`s; the `syn`/`quote` pair is the standard, and `quote!`'s `#var`/`#(...)* ` is your quasiquotation.

**Pattern: forward spans for good errors.** When generating tokens that reference the user's identifiers, carry the user's spans so type errors point at *their* code, not the macro body. Use `syn::Error::to_compile_error()` to emit precise diagnostics instead of `panic!`.

**Pattern: a `macro_rules!` "internal" recursion accumulator.** Use a private `(@internal ...)` rule to thread state through recursive expansion.

**Pattern: `compile_error!` for invalid input.** Emit a clear message at compile time rather than producing code that fails cryptically downstream.

---

## Best Practices

- **Use the weakest macro mechanism that works:** function/trait < `macro_rules!` < proc-macro. Escalate only when forced.
- **`cargo expand` every non-trivial macro** during development and read the output, exactly as you would `gcc -E`.
- **Engineer error messages deliberately** — preserve user spans, prefer `compile_error!`/`syn::Error` over `panic!`, and test the *failure* paths (use a tool like `trybuild` to assert error output).
- **Bind potentially side-effecting fragments once** in `macro_rules!` (`let x = $e;`) before reusing them, just as you `gensym` in Lisp — `:expr` does not protect against repeated evaluation if your template uses it twice.
- **Reason about hygiene in proc-macros explicitly** — know whether a generated identifier should be `call_site` (visible to caller) or `def_site`/`mixed_site` (private to the macro), and choose deliberately.
- **Watch the compile-time budget** — `syn`/`quote` and deep recursion cost build time; profile with `cargo build --timings`.
- **Document the macro's expansion contract and the syntax it accepts** — callers cannot read it from a signature.

---

## Edge Cases & Pitfalls

- **Repeated `:expr` still double-evaluates.** `macro_rules! square { ($x:expr) => { $x * $x } }` evaluates `$x` *twice* — same double-eval hazard as C, despite the fragment typing. Bind once: `{ let v = $x; v * v }`.
- **Fragment specifier "follow-set" restrictions.** After an `:expr` fragment, `macro_rules!` only permits certain following tokens (`=>`, `,`, `;`). The parser must stay unambiguous; you will hit cryptic "no rules expected this token" errors when you violate this.
- **`:expr` opacity.** Once a fragment is captured as `:expr`, you cannot re-match its internals in a later rule — it is a sealed unit. Use `:tt` when you need to keep inspecting structure.
- **Proc-macro hygiene leaks.** A generated identifier with a `call_site` span can collide with — or be shadowed by — the caller's names. Subtle, and the opposite of the safety `macro_rules!` gives you by default.
- **Order/recursion-limit hits.** Deeply recursive `macro_rules!` or template instantiation blows `recursion_limit`/instantiation depth and fails to compile.
- **Errors pointing at generated code.** Without span care, a type error in generated code shows the user a span inside `quote!` they never wrote — the single most common complaint about macro-heavy crates.
- **C++ template double-error-storm and SFINAE noise** — the template equivalent of "bad macro error messages."

---

## Common Mistakes

1. **Reaching for a proc-macro when `macro_rules!`, a generic, or a trait would do.**
2. **Assuming `:expr` prevents double evaluation** — it prevents *precedence* bugs, not *duplication* bugs.
3. **`panic!`-ing in a proc-macro** instead of emitting a spanned `compile_error!`, giving users an unhelpful "proc macro panicked."
4. **Ignoring spans**, so every error from generated code is unreadable.
5. **Not reasoning about proc-macro hygiene** (`call_site` vs `def_site`) and leaking or capturing identifiers.
6. **Treating C++ templates as text macros** — they substitute *types/values* and are type-checked, a different model.

---

## Test Yourself

1. What representation do Rust macros operate on, and how is it different from C's tokens and Lisp's lists?
2. What does the fragment specifier `:expr` guarantee, and what does it *not* guarantee?
3. Name the three kinds of procedural macro and a real-world example of each.
4. State hygiene precisely. How is it implemented in Rust, and how does Common Lisp's `gensym` approximate it?
5. Why can `#[derive(Serialize)]` do something no `macro_rules!` macro can?
6. How do C++ templates fix the C `MAX` macro's double-evaluation and type-safety problems, and what can they *not* do that Rust proc-macros can?

<details>
<summary>Answers</summary>

1. **Token trees** — tokens grouped by bracket pairs. Coarser than Lisp's fully-parsed lists, but more structured than C's flat token stream (brackets always balance and can be recursed into). It can also accept syntax that is not yet valid Rust.
2. `:expr` guarantees the captured fragment is a complete, parsed expression that splices in as one unit (so precedence bugs are impossible). It does *not* prevent double evaluation if the template uses the metavariable more than once.
3. **Derive** (`#[derive(Serialize)]` / serde), **attribute** (`#[get("/")]` / web routers), **function-like** (`sqlx::query!("SELECT …")`).
4. Hygiene: an identifier's meaning is fixed by where it was *written*, not where expansion places it, preventing capture in both directions. Rust implements it via spans carrying a hygiene context that name resolution respects. `gensym` approximates it by minting a unique, un-typeable symbol for one binding, simulating a distinct context.
5. It can *read the type's structure* (its fields, generics) via `syn` and run arbitrary logic to generate a tailored `impl`. `macro_rules!` only pattern-matches token shapes; it cannot introspect a type's fields.
6. `max_t<T>` is a real instantiated function: each argument is evaluated exactly once and the call is type-checked, eliminating double-eval and type-safety holes. Templates cannot transform arbitrary *syntax* or accept foreign DSL syntax / run arbitrary compile-time logic over tokens the way proc-macros can; they substitute types and values.

</details>

---

## Cheat Sheet

```text
RUST MACRO SUBSTRATE = TOKEN TREES (brackets group; can hold not-yet-valid Rust)

DECLARATIVE: macro_rules!  (hygienic by default)
  matcher => transcriber, over token trees
  fragment specifiers: $x:expr $t:ty $i:ident $p:pat $b:block $s:stmt $:path $:tt $:literal
  repetition: $( ... )sep*   $( ... )+   $( ... )?
  PITFALL: repeated $x still double-evaluates → bind once: { let v=$x; v*v }

PROCEDURAL: fn(TokenStream)->TokenStream   (hygiene = opt-in via spans)
  parse with: syn      generate with: quote!  (#var = unquote, #(...)* = splice)
  three kinds:
    derive    #[derive(Serialize)]   read type, emit impl   (serde, clap, thiserror)
    attribute #[get("/")]            transform the item     (web routers)
    fn-like   sqlx::query!("SELECT") compile-time DSL/check

HYGIENE = identity by ORIGIN, not spelling (spans carry context)
  C: none | CL: gensym (manual) | Scheme/Rust macro_rules!: automatic | proc-macro: explicit

DEBUG:  cargo expand        (the Rust gcc -E / macroexpand)
ERRORS: forward spans; use compile_error!/syn::Error, NOT panic!; test with trybuild

NEIGHBORS:
  C++ templates + constexpr/consteval = compile-time code by TYPE/VALUE substitution,
      type-checked, no double-eval — but not syntax transformation
  Elixir quote/unquote/defmacro = Lisp-style homoiconic macros on the BEAM
```

---

## Summary

Rust shows that you can have **hygienic, structured macros without homoiconicity** by exposing the program as **token trees** and offering two layers. **`macro_rules!`** matches token-tree patterns with **fragment specifiers** (`:expr`, `:ty`, `:ident`) that make precedence bugs impossible and is **hygienic by default** — the descendant of Scheme's `syntax-rules`. **Procedural macros** are Rust functions that **parse with `syn` and generate with `quote!`**, in three kinds — **derive**, **attribute**, **function-like** — and power serde, clap, web routers, and compile-time-checked DSLs like `sqlx::query!`; they are the descendant of Lisp's `defmacro` and require *explicit* span/hygiene reasoning. **Hygiene** — identity by origin, carried by spans — is the line between safe macro systems (Scheme, Rust) and dangerous ones (C); `gensym` is its manual Common Lisp approximation. The same design space is occupied by **C++ templates + `constexpr`/`consteval`** (compile-time code generation by type/value substitution, type-checked, no double-eval, but not syntax transformation) and **Elixir's `quote`/`unquote`** (homoiconic BEAM macros). The senior throughline: choose the weakest mechanism that works, treat compile-time as a budget, and engineer your spans so the errors stay human — themes `professional.md` turns into shipping discipline.

---

## Further Reading

- *The Rust Reference*, "Macros" chapter, and *The Little Book of Rust Macros* — `macro_rules!` from basics to advanced recursion.
- *The `syn`, `quote`, and `proc-macro2` crate docs* — the standard procedural-macro toolchain.
- David Tolnay's `proc-macro-workshop` — hands-on derive/attribute/function-like exercises (the `Builder`, `Debug`, `seq!` problems).
- *The hygiene papers*: Kohlbecker et al., "Hygienic Macro Expansion" (1986); Clinger & Rees, "Macros that Work" — the formal origins.
- C++: Scott Meyers, *Effective Modern C++* on `constexpr`; the C++ Core Guidelines' "prefer templates to function-like macros" rules.
- Try it: `cargo install cargo-expand`, write a trivial `#[derive]`, and run `cargo expand` to see the generated impl.
