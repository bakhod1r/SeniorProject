# Macros — Hands-On Tasks

> **Topic:** [Macros](README.md)

---

## Introduction

This file is a structured set of exercises that take you from "I have seen a
`#define`" to "I can write a hygienic Rust derive macro and reason about its
compile-time cost." Every task is small enough for one or two focused
sessions, and they build on one another. You should attempt each problem
first without the hints — five minutes of struggle on the `SQUARE(i++)` trap
teaches more than reading the answer.

How to use this file: read the task, write the code, and *run the expander*
(`gcc -E`, `macroexpand-1`, `cargo expand`) before you check the hints. The
single most important habit this file builds is **looking at the expansion**.
Mark a self-check box only when you can *explain* the result to someone else,
not when the program merely compiles. Solutions are intentionally sparse —
they appear only where the canonical answer is more instructive than your
first attempt would be.

## Table of Contents

- [Warm-Up](#warm-up)
- [Core](#core)
- [Advanced](#advanced)
- [Capstone](#capstone)

---

## Warm-Up

These tasks rebuild the mental model: a macro receives unevaluated code and
produces code, and you debug it by reading the expansion.

### Task 1: Reproduce the precedence bug

**Problem.** Write `#define SQUARE(x) x*x` in a C file and call
`SQUARE(2 + 3)`. Predict the value, then compile and run. Then run
`gcc -E` and read the expansion.

**Constraints.**
- Do not parenthesize anything yet — the bug is the point.
- Print the result and the literal `gcc -E` expansion side by side.

**Hints (try without first).**
- You will get `11`, not `25`. Write out `2 + 3 * 2 + 3` and apply normal
  precedence.
- The preprocessor never computes `2 + 3`; it pastes the *tokens* `2 + 3`.
- The fix is `((x)*(x))` — parenthesize each parameter and the whole body.

**Self-check.**
- [ ] You can explain why the answer is 11 from the expanded tokens.
- [ ] You ran `gcc -E` and saw the un-parenthesized expansion.
- [ ] You fixed it and confirmed `SQUARE(2 + 3) == 25`.

---

### Task 2: The double-evaluation trap

**Problem.** With the *fixed* `#define SQUARE(x) ((x)*(x))`, set `int i = 5;`
and call `SQUARE(i++)`. Print the result and the final value of `i`. Then
write a `static inline int square_fn(int)` and call `square_fn(i++)` from
`i = 5` again. Compare.

**Constraints.**
- Reset `i` to 5 before each call.
- Report both the returned value and `i` afterward for each version.

**Hints (try without first).**
- The macro pastes `i++` twice, so `i` is modified twice — this is undefined
  behavior, and the value is unpredictable.
- The function evaluates `i++` exactly once; you get `25` and `i == 6`.
- Lesson: parentheses fix precedence, not duplication. Never pass side
  effects to a function-like macro.

**Self-check.**
- [ ] You can state why the macro version is undefined behavior, not just
      "wrong."
- [ ] You can explain why the function version is correct.

---

### Task 3: The dangling-statement bug and `do { } while(0)`

**Problem.** Write `#define LOG_RUN(x) printf("run\n"); run(x)` and use it as
`if (cond) LOG_RUN(t);` with `cond` false. Observe that `run(t)` executes
anyway. Then rewrite the macro with `do { } while(0)` and confirm it no
longer leaks.

**Hints (try without first).**
- A braceless `if` binds only the first statement; the second escapes.
- `do { printf("run\n"); run(x); } while(0)` is one statement and needs a
  trailing `;` at the call site.

**Self-check.**
- [ ] You reproduced `run` executing when `cond` was false.
- [ ] You can explain why `do { } while(0)` (not just `{ }`) is the idiom,
      including the trailing-semicolon behavior in `if/else`.

---

### Task 4: Stringize and a tiny debug macro

**Problem.** Write `#define SHOW(e) printf(#e " = %d\n", (e))` and call
`SHOW(a + b)`. Confirm it prints `a + b = 7`. Then explain in one sentence
why no ordinary function could implement `SHOW`.

**Hints (try without first).**
- `#e` stringizes the *tokens* of the argument into a string literal.
- A function only receives the evaluated value `7`; it never sees the source
  text `a + b`, so it cannot reproduce the string.

**Self-check.**
- [ ] `SHOW(a + b)` prints both the expression text and its value.
- [ ] You can articulate the "macros see source, functions see values"
      distinction using this example.

---

## Core

These tasks move to syntactic macros (Lisp/Scheme) and hygiene.

### Task 5: Write `unless` as a Common Lisp macro

**Problem.** Define `(defmacro my-unless (test &rest body) ...)` that runs
`body` only when `test` is false. Use quasiquote. Run `macroexpand-1` on a
call and confirm the expansion.

**Hints (try without first).**
- Expansion target: `(if (not test) (progn body...))`.
- Template: `` `(if (not ,test) (progn ,@body)) ``. Note `,@body` to splice
  the body forms.
- Verify with `(macroexpand-1 '(my-unless done (cleanup)))`.

**Self-check.**
- [ ] Your macro runs the body only when the test is false.
- [ ] You can explain why `,@` is needed instead of `,` for `body`.
- [ ] You confirmed the expansion with `macroexpand-1`.

**Solution (sparse).**

```lisp
(defmacro my-unless (test &rest body)
  `(if (not ,test)
       (progn ,@body)))
```

---

### Task 6: Trigger and fix a capture bug with `gensym`

**Problem.** Write a Common Lisp `swap` macro using a `tmp` binding *without*
`gensym`. Demonstrate it breaking when the caller's code uses a variable named
`tmp`. Then fix it with `gensym` and show it now works.

**Constraints.**
- The failing demo must use `tmp` as one of the swapped places or a
  surrounding binding.

**Hints (try without first).**
- Unhygienic version: `` `(let ((tmp ,a)) (setf ,a ,b) (setf ,b tmp)) ``.
- Break it: `(let ((tmp 1) (x 2)) (swap tmp x))` — the macro's `tmp` collides.
- Fix: `(let ((g (gensym))) `(let ((,g ,a)) ...))`.

**Self-check.**
- [ ] You produced an incorrect swap caused by capture.
- [ ] The `gensym` version works for the same caller.
- [ ] You can explain why Scheme's `syntax-rules` would need no `gensym`.

**Solution (sparse).**

```lisp
(defmacro swap (a b)
  (let ((g (gensym "TMP")))
    `(let ((,g ,a))
       (setf ,a ,b)
       (setf ,b ,g))))
```

---

### Task 7: A hygienic `swap!` in Scheme

**Problem.** Write `swap!` with `define-syntax`/`syntax-rules`. Prove it is
hygienic by calling `(let ((tmp 1) (x 2)) (swap! tmp x) (list tmp x))` and
confirming you get `(2 1)` — no `gensym` anywhere.

**Hints (try without first).**
- `(define-syntax swap! (syntax-rules () ((_ a b) (let ((tmp a)) (set! a b) (set! b tmp)))))`
- The macro's `tmp` and the caller's `tmp` are automatically distinct.

**Self-check.**
- [ ] The result is `(2 1)` despite the caller using `tmp`.
- [ ] You can explain *how* hygiene makes the two `tmp`s different identifiers.

---

### Task 8: Recursive `my-and` with `syntax-rules`

**Problem.** Implement a hygienic, short-circuiting `my-and` with multiple
clauses (`()`, single expr, and the recursive case). Confirm it short-circuits
by passing an expression with a side effect that must not run.

**Hints (try without first).**
- Three clauses: `((_) #t)`, `((_ e) e)`, `((_ e1 e2 ...) (if e1 (my-and e2 ...) #f))`.
- Test short-circuit: `(my-and #f (begin (display "ran!") #t))` must not print.

**Self-check.**
- [ ] `my-and` returns the correct boolean for 0, 1, and many arguments.
- [ ] The side effect after a false argument does *not* run.
- [ ] You can explain why this must be a macro, not a function.

---

## Advanced

These tasks move to Rust's two macro systems and compile-time reasoning.

### Task 9: `macro_rules!` — a `vec`-like builder, then find its double-eval

**Problem.** Write a `macro_rules!` macro `my_vec![a, b, c]` that builds a
`Vec` via repeated `push`, supporting a trailing comma. Separately, write
`macro_rules! square { ($x:expr) => { $x * $x } }`, call `square!({ println!("hi"); 3 })`,
and observe `hi` printed *twice*. Fix `square!` to evaluate once.

**Hints (try without first).**
- Builder: `( $( $x:expr ),* $(,)? ) => {{ let mut v = Vec::new(); $( v.push($x); )* v }}`.
- The `square!` template uses `$x` twice → double evaluation, exactly like C.
- Fix: `($x:expr) => {{ let v = $x; v * v }}`.

**Self-check.**
- [ ] `my_vec![1, 2, 3,]` (trailing comma) compiles and builds the right Vec.
- [ ] You saw `hi` printed twice and can explain why `:expr` did not prevent it.
- [ ] The fixed `square!` prints `hi` once.

**Solution (sparse).**

```rust
macro_rules! my_vec {
    ( $( $x:expr ),* $(,)? ) => {{
        let mut v = ::std::vec::Vec::new();
        $( v.push($x); )*
        v
    }};
}
```

---

### Task 10: Prove `macro_rules!` hygiene

**Problem.** Write a macro that introduces a local binding (e.g.
`let result = ...;`) and call it inside a function that *already* has a
`result` variable. Confirm both compile and behave independently. Then run
`cargo expand` and observe how the introduced identifier appears.

**Hints (try without first).**
- e.g. `macro_rules! doubled { ($e:expr) => {{ let result = $e; result + result }} }`.
- Call it where the surrounding scope has its own `result`; nothing breaks.
- `cargo expand` shows the macro's identifier with a distinct hygiene marker.

**Self-check.**
- [ ] The caller's `result` and the macro's `result` do not interfere.
- [ ] You can describe what `cargo expand` showed for the introduced name.

---

### Task 11: Write a derive macro

**Problem.** Create a `proc-macro` crate with a `#[derive(Describe)]` that
generates `impl Describe for T { fn describe() -> &'static str { /* type name */ } }`.
Apply it to two structs and call `describe()`. Use `syn` to parse and `quote!`
to generate.

**Constraints.**
- The derive must live in a separate `proc-macro = true` crate.
- Use `parse_macro_input!(input as DeriveInput)` and read `ast.ident`.

**Hints (try without first).**
- Skeleton in `senior.md` (the `HelloName` example) is your template.
- `let name = &ast.ident;` then `quote! { impl Describe for #name { ... stringify!(#name) ... } }`.
- Return `expanded.into()`.

**Self-check.**
- [ ] `#[derive(Describe)]` works on multiple structs without hand-writing impls.
- [ ] You can explain why a `macro_rules!` macro could *not* read the type name
      and generate this — what does the proc-macro give you that it can't?

**Solution (sparse).**

```rust
#[proc_macro_derive(Describe)]
pub fn derive_describe(input: TokenStream) -> TokenStream {
    let ast = parse_macro_input!(input as DeriveInput);
    let name = &ast.ident;
    quote::quote! {
        impl Describe for #name {
            fn describe() -> &'static str { stringify!(#name) }
        }
    }.into()
}
```

---

### Task 12: Engineer a good error message

**Problem.** Extend a function-like proc-macro (or the derive above) to reject
invalid input — e.g. require a struct, reject an enum — and emit a clear,
spanned compile error instead of panicking. Confirm the message points at the
user's code.

**Hints (try without first).**
- Match on `ast.data`; if it's not what you expect, return
  `syn::Error::new_spanned(&ast.ident, "Describe only supports structs")
  .to_compile_error().into()`.
- Compare the experience to a `panic!`, which surfaces as
  "proc macro panicked" with no useful location.

**Self-check.**
- [ ] Invalid input produces a readable message at the user's span.
- [ ] You can explain why `panic!` is the wrong way to report user error.
- [ ] (Bonus) You added a `trybuild` test asserting the exact error output.

---

## Capstone

### Task 13: The X-macro single-source-of-truth pattern (C)

**Problem.** Using the X-macro idiom, define a list of error codes *once* and
generate from it: (a) an `enum`, (b) a `const char *` name table, and (c) a
`describe(code)` function. Add a new code and confirm all three update from the
single edit.

**Hints (try without first).**
- Define `#define ERRORS X(E_OK,"ok") X(E_IO,"io") ...`.
- Expand three times with different `#define X(...)` / `#undef X` blocks.
- The whole point: one list, three synchronized artifacts.

**Self-check.**
- [ ] Adding one `X(...)` line updates the enum, the table, and `describe`.
- [ ] You can explain why no plain C language feature keeps these in sync, and
      why this is one of the few C macro idioms that earns its keep.

---

### Task 14: Compare four solutions to "max"

**Problem.** Implement `max` four ways and write up the trade-offs: (1) a C
function-like macro, (2) a C `static inline` function, (3) a C++ function
template, (4) a generic in Rust (`fn max<T: Ord>(...)`). For each, state how it
handles: precedence, double evaluation, type safety, and error messages.

**Hints (try without first).**
- The macro fails on `max(i++, j++)` and on mismatched types silently.
- The inline function and template evaluate once and type-check.
- The Rust generic is type-checked with trait bounds and clean errors.

**Self-check.**
- [ ] You can fill a 4×4 table (four impls × four properties) from memory.
- [ ] You can state the modern guidance ("prefer functions/templates/generics
      to function-like macros") and justify it from your table.

---

### Task 15: The "should this be a macro?" design review

**Problem.** Pick a real piece of code in a language you use that is currently
a macro (or that you're tempted to make one). Run it through the senior/
professional decision checklist and write a one-paragraph verdict: macro or
not, and why. If "macro," identify what logic could move into a thin-macro-
over-thick-function shape.

**Hints (try without first).**
- Disqualifying question first: could a function, generic, trait, or
  `const fn`/`constexpr` do it?
- Justifying questions: control of evaluation? new syntax? compile-time
  validation of literals? per-type codegen?
- If it stays a macro, where can logic move to a normal, testable function?

**Self-check.**
- [ ] Your verdict cites the specific reason a non-macro mechanism does or
      does not suffice.
- [ ] If macro, you identified the thin-macro/thick-function split.
- [ ] You noted at least one cost (compile time, errors, tooling, API rigidity)
      and weighed it against the benefit.

---

### Task 16: Measure the compile-time cost of a derive

**Problem.** Take the derive from Task 11, apply it to ~50 structs (generate
them in a build script or by hand), and measure the clean-build time with and
without the derive using `cargo build --timings`. Report the delta and where it
goes.

**Hints (try without first).**
- `cargo build --timings` writes an HTML report; look for your proc-macro crate
  and `syn`/`quote`.
- The cost scales with invocation count and the work per invocation.
- Contrast with a `macro_rules!` alternative if one is possible — usually
  cheaper because there's no `syn` parse.

**Self-check.**
- [ ] You measured a real (even if small) compile-time delta and can attribute
      it.
- [ ] You can explain why this cost is paid on *every* build and at scale
      becomes a CI-budget concern.

---
