# Macros — Junior Level

> **Topic:** [Macros](README.md)
> **Focus:** What a macro is, why "code that writes code" is different from a function, and the classic foot-guns of textual macros (the C preprocessor) — the bugs that have bitten every C programmer at least once.

---

## Table of Contents

1. [Introduction](#introduction)
2. [Prerequisites](#prerequisites)
3. [Glossary](#glossary)
4. [Core Concepts](#core-concepts)
5. [Real-World Analogies](#real-world-analogies)
6. [Mental Models](#mental-models)
7. [Code Examples](#code-examples)
8. [Pros & Cons](#pros--cons)
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

> Focus: **A macro is a program that runs while your program is being compiled, and its output is more source code.** A function runs when your program runs; a macro runs *before* it.

When you call a function, the function receives *values*. By the time `print(2 + 3)` runs, the function `print` never sees `2 + 3` — it sees the number `5`. The expression was evaluated first, and only the result was handed over.

A **macro** is different. A macro receives the *text* (or the *structure*) of the code you wrote, **before** that code is evaluated, and it produces new code that takes its place. The compiler then continues as if you had typed that new code yourself. Macros are the simplest form of **metaprogramming**: code that manipulates code.

The most famous macro system — and the one almost every programmer meets first — is the **C preprocessor**. Before your C compiler even begins to understand your program, a separate pass walks through the file doing blind find-and-replace based on `#define` directives. This is powerful (you can name a constant once, generate repetitive boilerplate, conditionally compile code for different platforms) and dangerous, because the C preprocessor understands *nothing*. It does not know what a function is, what a variable is, what a type is, or what scope means. It shuffles **tokens** — little chunks of text — and that ignorance is the source of a whole museum of classic bugs.

In one sentence: **a macro is a stencil the compiler stamps onto your source before reading it**, and the C preprocessor is the bluntest stencil there is — it copies text, nothing more.

> 🎓 **Why this matters for a junior:** You will read C and C++ code full of `#define`s, and you will eventually write one. The first macro you write that has a bug will *look* correct and *behave* insanely — the value will be off by a factor, or a loop will run twice, or a variable will mysteriously change. Almost all of these are the *same five mistakes*, and once you have seen them you will never be fooled again. This page teaches you to see the expansion the way the compiler does.

This page covers: what textual substitution actually does, the canonical preprocessor bugs (missing parentheses, double evaluation, no scoping, the `do { } while(0)` idiom), and how to *see* what a macro expands to. The next level (`middle.md`) introduces macros that understand syntax — Lisp and Scheme. `senior.md` covers Rust's `macro_rules!` and procedural macros and the concept of **hygiene**. `professional.md` covers building and shipping macro-heavy systems.

---

## Prerequisites

What you should know before reading this:

- **Required:** How to write and compile a small C program (`gcc file.c` or `clang file.c`).
- **Required:** What a function is and the difference between an *argument* and the *value it evaluates to*.
- **Required:** Basic arithmetic precedence (`2 + 3 * 4` is `14`, not `20`).
- **Helpful but not required:** Having seen `#include` and `#define` in a header file and wondered what they do.
- **Helpful but not required:** A vague sense that compiling has stages (the preprocessor is the very first one).

You do **not** need to know:

- Lisp, Scheme, Rust, or any AST manipulation (those come in later files).
- What "hygiene" means (that is `senior.md`).
- How a compiler parses code into a tree (`middle.md` introduces it gently).

---

## Glossary

| Term | Definition |
|------|-----------|
| **Macro** | A rule that transforms source code into other source code, applied during compilation rather than at run time. |
| **Metaprogramming** | Writing code whose input or output is itself code. Macros are the compile-time flavor. |
| **Preprocessor** | In C/C++, a text-processing pass that runs *before* the compiler proper. It handles all lines starting with `#`. |
| **Token** | The smallest meaningful chunk of source text: a keyword, an identifier, a number, an operator, a bracket. The preprocessor works on tokens, not characters and not expressions. |
| **`#define`** | The C directive that creates a macro. `#define NAME replacement`. |
| **Object-like macro** | A macro with no parameters, e.g. `#define PI 3.14159`. Pure name → text substitution. |
| **Function-like macro** | A macro that takes arguments, e.g. `#define SQUARE(x) ((x) * (x))`. Looks like a function call but is text substitution. |
| **Expansion** | The text a macro is replaced with. The compiler sees the *expanded* code, never your macro call. |
| **Textual substitution** | Replacing the macro invocation with its body, pasting the argument *tokens* in unchanged. No evaluation, no type checking. |
| **Double evaluation** | A macro bug where an argument with a side effect (like `i++`) is pasted in twice and therefore runs twice. |
| **Argument capture / name collision** | When a name *inside* a macro accidentally clashes with a name from the caller's code. |
| **Hygiene** | The property (which C macros *lack*) that a macro's own identifiers never collide with the caller's. Covered in `senior.md`. |
| **`gcc -E`** | The command that runs *only* the preprocessor and prints the expanded source, so you can see exactly what the compiler will read. |
| **`do { ... } while(0)`** | An idiom that wraps a multi-statement macro body so it behaves like a single statement in `if`/`else`. |

---

## Core Concepts

### 1. A Macro Is Find-and-Replace, Run by the Compiler

Start with the simplest macro:

```c
#define PI 3.14159

double area = PI * r * r;
```

The preprocessor sees `PI` and replaces it — literally, like a text editor's find-and-replace — with `3.14159`. After the preprocessor runs, the compiler reads:

```c
double area = 3.14159 * r * r;
```

The compiler never knew `PI` existed. There is no variable named `PI` in the compiled program, no memory for it, no type. This is the entire idea: **the macro disappears, leaving only its expansion.**

Object-like macros like this are mostly harmless. The trouble starts when macros take arguments.

### 2. Function-Like Macros Paste Tokens, They Do Not Call

```c
#define SQUARE(x) x * x

int a = SQUARE(5);   // becomes  5 * 5  → 25, fine
```

This *looks* like a function call, but it is not. `SQUARE(5)` is replaced by `5 * 5`. No function exists. The argument `5` is pasted in wherever `x` appears in the body. So far so good — but watch what happens when the argument is not a simple number.

### 3. The Missing-Parentheses Bug

```c
#define SQUARE(x) x * x

int b = SQUARE(2 + 3);
```

You expect `25` (because `2 + 3` is `5`, and `5²` is `25`). You get **11**. Why? Because the macro pastes the *tokens* `2 + 3` in place of `x`, with no parentheses:

```c
int b = 2 + 3 * 2 + 3;   // = 2 + 6 + 3 = 11
```

The preprocessor does not evaluate `2 + 3` first — it does not evaluate *anything*. It copies the tokens, and now C's normal precedence rules apply to a garbled expression. The fix is to **parenthesize every parameter and the whole body**:

```c
#define SQUARE(x) ((x) * (x))

int b = SQUARE(2 + 3);   // becomes  ((2 + 3) * (2 + 3))  → 25, correct
```

Rule of thumb every C programmer learns: **wrap each argument in parentheses, and wrap the entire macro body in parentheses.** Forgetting either causes a precedence bug that the compiler will not warn you about.

### 4. The Double-Evaluation Bug

Parentheses fix precedence, but they do **not** fix this:

```c
#define SQUARE(x) ((x) * (x))

int i = 5;
int c = SQUARE(i++);
```

The macro expands to:

```c
int c = ((i++) * (i++));
```

The argument `i++` was pasted **twice**, so `i` is incremented *twice*, and the multiplication uses two different values. The result is unpredictable (and `i` ends at `7`, not `6`). A real function would have evaluated `i++` **once** before the call. A macro cannot, because it does not evaluate — it duplicates text.

This is **double evaluation**, and it is the single most dangerous macro bug, because the code looks completely innocent. The classic real-world example is:

```c
#define MAX(a, b) ((a) > (b) ? (a) : (b))

int m = MAX(i++, j++);   // both i++ and j++ may run twice — chaos
```

There is no general fix in C; you simply must never pass expressions with side effects to a function-like macro. (Languages with *hygienic, syntactic* macros solve this — see `senior.md`.)

### 5. The Multi-Statement Bug and `do { } while(0)`

Suppose a macro needs two statements:

```c
#define LOG_AND_RUN(x) printf("running\n"); run(x);

if (ready)
    LOG_AND_RUN(task);
```

Expands to:

```c
if (ready)
    printf("running\n"); run(task);
```

Only the `printf` is inside the `if`! `run(task)` runs **unconditionally**, because C attaches only the first statement to a braceless `if`. The standard idiom that fixes this is to wrap the body in a `do { ... } while(0)`:

```c
#define LOG_AND_RUN(x) do { printf("running\n"); run(x); } while(0)

if (ready)
    LOG_AND_RUN(task);     // both statements now inside the if
```

`do { } while(0)` is a single statement that runs its body exactly once, **and** it requires a trailing semicolon, so the macro call reads like a normal statement. This idiom looks bizarre the first time you see it; it exists entirely to make multi-statement macros safe inside `if`/`else`.

### 6. The Preprocessor Does Not Understand Scope

```c
#define INCREMENT(x) tmp = x; x = x + 1

int tmp = 0;     // the caller happens to have a 'tmp' too
int value = 10;
INCREMENT(value);
```

The macro silently clobbers the caller's `tmp`. The preprocessor has no idea that `tmp` inside the macro and `tmp` in the caller are "supposed" to be different — to a text substituter, a name is just a name. This is a **capture** bug. Hygienic macro systems (Scheme, Rust) make this *impossible*; C makes it a daily hazard, and the only defence is ugly conventions like naming internal variables `__macro_tmp_xyz`.

---

## Real-World Analogies

**The mail-merge template.** A function is like a clerk you hand a finished letter to — they read the words, do something, and the words are already decided. A macro is like a *mail-merge template*: it has blanks (`Dear ___`) and you fill them with raw text. The template machine does not understand the text it pastes — if you put "Bob, who owes us $5" into the `name` blank, it cheerfully prints "Dear Bob, who owes us $5,". Garbage in, garbage out, pasted verbatim. That verbatim pasting is exactly the missing-parentheses bug.

**The photocopier with a stuck "2x" button.** Double evaluation is a photocopier that, every time you feed it a page, makes two copies because of a quirk. If the page is just a picture, two copies is harmless. If the page is "press the red button," now the red button gets pressed twice. `i++` is the red button.

**The blind stagehand.** The preprocessor is a stagehand who replaces props on a set according to a list, in the dark, before the play begins. "Wherever you see PROP_A, put a chair." He does not watch the play, does not know the plot, does not know two scenes both use a prop called "tmp." He just swaps. The actors (the compiler) then perform with whatever ended up on stage.

---

## Mental Models

- **Macros run before the program runs.** Functions run *during*. A macro's whole job is finished by the time the compiler produces a binary. There is no `SQUARE` in your executable.
- **Macros take unevaluated code; functions take evaluated values.** This is *the* defining difference. `SQUARE(i++)` hands the *text* `i++` to the macro. `square(i++)` hands the *result* of `i++` to the function.
- **The compiler sees the expansion, not your call.** Whenever a macro misbehaves, the first move is: write out what it expands to, by hand or with `gcc -E`. Read *that*.
- **The C preprocessor understands nothing but tokens.** No types, no scopes, no precedence-aware splicing. It cuts and pastes chunks of text. Every C macro bug is a consequence of this single fact.
- **Parenthesize defensively.** Because the preprocessor splices tokens without regard to precedence, the macro author must add the parentheses the splicing destroys.

---

## Code Examples

### Seeing the expansion with `gcc -E`

This is the single most useful debugging tool for macros. It runs *only* the preprocessor:

```c
// file: demo.c
#define SQUARE(x) x * x
int main(void) {
    int b = SQUARE(2 + 3);
    return b;
}
```

```bash
$ gcc -E demo.c
# ... lots of header noise ...
int main(void) {
    int b = 2 + 3 * 2 + 3;   // <-- the bug is now visible
    return b;
}
```

The `-E` flag stops after preprocessing and prints the result. When a macro confuses you, *always* look at `-E` output. (Clang: `clang -E demo.c`. C++: `g++ -E`.)

### The full "safe macro" checklist applied

```c
// BAD: precedence bug + multi-statement bug + capture bug all at once
#define BAD_SWAP(a, b) tmp = a; a = b; b = tmp

// GOOD: parenthesized, single-statement, and we accept its limits
#define SWAP(type, a, b) do {        \
        type swap_tmp_ = (a);        \
        (a) = (b);                   \
        (b) = swap_tmp_;             \
    } while (0)

int x = 1, y = 2;
SWAP(int, x, y);   // x == 2, y == 1; even an outer 'tmp' is untouched
```

Notes on the "good" version:
- The body is wrapped in `do { } while(0)` so it is one statement.
- Backslashes (`\`) continue the macro across lines — a macro is logically one line.
- The internal variable is named `swap_tmp_` to reduce collision risk (still not *guaranteed* safe — true hygiene needs a different language; see `senior.md`).
- Each parameter use is parenthesized.

### Object-like macros for configuration

```c
#define MAX_CONNECTIONS 1024
#define ENABLE_LOGGING  1

char pool[MAX_CONNECTIONS];

#if ENABLE_LOGGING
    log_init();          // compiled in only when ENABLE_LOGGING is non-zero
#endif
```

`#if` / `#ifdef` / `#endif` are **conditional compilation** — the preprocessor deletes whole blocks of code before the compiler sees them. This is how one source file targets Linux, Windows, and macOS, or how "debug" and "release" builds differ.

### A macro vs. the function that should have replaced it

```c
#define SQUARE_MACRO(x) ((x) * (x))     // pastes text, risks double-eval

static inline int square_fn(int x) {     // evaluates the argument ONCE
    return x * x;
}

int main(void) {
    int i = 5;
    int a = SQUARE_MACRO(i++);   // i++ runs TWICE; a is garbage
    i = 5;
    int b = square_fn(i++);      // i++ runs ONCE; b == 25, i == 6
    return a + b;
}
```

Modern C and C++ have `static inline` functions that the compiler can inline for the same speed as a macro, *without* the textual hazards. **If a macro could be a function, make it a function.** This is one of the most important practical lessons here.

---

## Pros & Cons

**Pros**

- **Zero run-time cost.** The macro vanishes; only its expansion is compiled. No function-call overhead (though modern inlining erases that advantage).
- **Works on tokens, not values** — so it can do things a function cannot: name constants, stringify arguments, conditionally include code, generate repetitive declarations.
- **Conditional compilation** lets one codebase target many platforms (`#ifdef _WIN32`).
- **Available everywhere** in C/C++ with no extra tooling.

**Cons**

- **No type checking, no scope awareness.** The preprocessor cannot catch a misuse the way a function signature would.
- **Precedence and double-evaluation bugs** are silent and easy to introduce.
- **Terrible error messages.** A bug in expanded code points at the *expansion*, often with line numbers that confuse you.
- **No hygiene.** Internal names can collide with the caller's (the `tmp` problem).
- **Hard to debug.** Debuggers step through expanded code, not your macro.
- **Easy to abuse** into unreadable "clever" code that nobody can maintain.

---

## Use Cases

Where C-style macros legitimately earn their place:

- **Named constants** — though `const int` or `enum` are usually better in C, and `constexpr` in C++.
- **Conditional compilation** — `#ifdef DEBUG`, platform guards. There is no function-level alternative.
- **Include guards** — `#ifndef HEADER_H` / `#define HEADER_H` / `#endif` to stop a header being included twice. This is the single most common macro use in all of C.
- **Stringizing and token-pasting** — `#x` turns an argument into a string literal; `a ## b` glues two tokens together. Used for logging macros and code generation.
- **Boilerplate generation** — e.g. an `X-macro` pattern to declare an enum and a matching name-array from one list.

Where you should **not** reach for a macro:

- Anything a `static inline` function or a `const`/`enum`/`constexpr` can do — use those; they are type-safe and scope-safe.
- Anything with arguments that might have side effects.

---

## Coding Patterns

**Pattern: parenthesize everything.**

```c
#define ADD(a, b) ((a) + (b))   // not  a + b
```

**Pattern: `do { } while(0)` for multi-statement bodies.**

```c
#define CHECK(cond, msg) do { if (!(cond)) fail(msg); } while (0)
```

**Pattern: include guard (every header you write).**

```c
#ifndef MYLIB_WIDGET_H
#define MYLIB_WIDGET_H
/* declarations */
#endif /* MYLIB_WIDGET_H */
```

**Pattern: stringize for debugging.**

```c
#define SHOW(expr) printf(#expr " = %d\n", (expr))
SHOW(x + y);   // prints:  x + y = 7
```

`#expr` turns the *tokens* `x + y` into the string literal `"x + y"`. This only a macro can do — a function never sees the source text of its argument.

---

## Best Practices

- **Prefer functions, `const`, `enum`, and (C++) `constexpr`.** Reach for a macro only when no language feature can do the job (conditional compilation, stringizing, token pasting).
- **Parenthesize each parameter and the whole body.** Always. No exceptions.
- **Wrap multi-statement bodies in `do { } while(0)`.**
- **NAME macros in `UPPER_SNAKE_CASE`** by long-standing convention, so readers know "this is a macro; arguments may be evaluated oddly."
- **Never pass side-effecting expressions** (`i++`, function calls with effects) to a function-like macro.
- **When confused, run `gcc -E`** and read the real expansion.
- **Keep macros short.** A long macro is a debugging nightmare; extract logic into a real function the macro merely calls.

---

## Edge Cases & Pitfalls

- **`#define SQUARE(x) x*x`** → `SQUARE(a+b)` becomes `a+b*a+b`. Missing parentheses.
- **`SQUARE(i++)`** → `i` incremented twice. Double evaluation.
- **`#define MAX(a,b) a>b?a:b`** used as `MAX(x,y)*2` → expands to `x>y?x:y*2`, which means `x > y ? x : (y*2)`. Missing outer parentheses turn this into a different operator-precedence expression entirely.
- **Trailing semicolons.** `#define F() do {...} while(0)` is called as `F();` — the macro body should *not* end in a semicolon, or you get a double `;;` that breaks `if/else`.
- **Macro argument with a comma.** `SQUARE(a, b)` confuses the preprocessor: `MyMacro(std::pair<int, int>{})` — the comma inside `<...>` is read as an argument separator. Wrap such arguments or use variadic macros.
- **Recursive macros do not recurse.** `#define A A + 1` does *not* loop forever; the preprocessor refuses to expand a macro inside its own expansion. The result is literally `A + 1` (with `A` left un-expanded). Beginners expect infinite expansion; it does not happen.
- **A macro shadowing a real name.** `#define max somethingElse` will break `std::max` and any variable named `max` in scope, because the preprocessor replaces *every* occurrence of the token. This is why `<windows.h>` defining `min`/`max` macros is infamous.

---

## Common Mistakes

1. **Treating a macro like a function.** It does not evaluate arguments; it pastes them. The mental switch from "value" to "text" is the whole battle.
2. **Forgetting parentheses** and blaming the compiler for a "math bug."
3. **Passing `i++` or any side effect** into a macro.
4. **Multi-statement macros without `do { } while(0)`** silently dropping statements out of an `if`.
5. **Using a macro where a `const` or `inline` function would be safer and clearer.**
6. **Not looking at `gcc -E`** when a macro misbehaves, and instead guessing for an hour.

---

## Test Yourself

1. Given `#define DOUBLE(x) x + x`, what does `DOUBLE(3) * 2` evaluate to, and why is it not 12?
2. Why does `#define SQUARE(x) ((x)*(x))` still break with `SQUARE(i++)`?
3. What does the `do { } while(0)` idiom protect against?
4. What command shows you exactly what a macro expands to?
5. Why is `#define MAX_SIZE 100` safer to write than a function but still inferior to `const int MAX_SIZE = 100;` in many ways? Name one advantage of each.
6. What does `#x` do inside a macro body, and why can no ordinary function do the same?

<details>
<summary>Answers</summary>

1. It expands to `3 + 3 * 2` = `3 + 6` = `9`. Missing parentheses: precedence makes `* 2` bind to the second `3`.
2. Parentheses fix *precedence*, not *duplication*. `i++` is still pasted twice, so it runs twice.
3. It makes a multi-statement macro behave as a single statement, so it works correctly inside a braceless `if`/`else` and requires a trailing semicolon at the call site.
4. `gcc -E file.c` (or `clang -E`, `g++ -E`).
5. `#define` works for array sizes and in the preprocessor itself; a `const int` is type-checked, scoped, debuggable, and respects namespaces. Each has a niche.
6. `#x` stringizes the argument tokens into a string literal. A function only receives the *value* of its argument, never the source text, so it cannot reproduce "x + y" as text.

</details>

---

## Cheat Sheet

```text
MACRO            = code that produces code, at compile time
FUNCTION         = code that produces values, at run time
KEY DIFFERENCE   = macro gets UNEVALUATED text; function gets EVALUATED value

C PREPROCESSOR RULES OF THUMB
  - parenthesize every parameter:  ((x) ...)
  - parenthesize the whole body:   (... )
  - multi-statement → do { } while(0)
  - NEVER pass side effects (i++) into a function-like macro
  - UPPER_SNAKE_CASE names
  - debug with:  gcc -E file.c

CLASSIC BUGS
  SQUARE(x) x*x        → SQUARE(a+b) = a+b*a+b   (precedence)
  SQUARE(i++)          → i++ runs twice          (double eval)
  multi-stmt no do{}   → statements escape the if (dangling)
  internal 'tmp'       → clobbers caller's 'tmp' (no hygiene)
  #define A A + 1      → does NOT recurse; yields A + 1

USEFUL OPERATORS
  #x      stringize:   token x → "x"
  a ## b  token paste: a, b → ab
  #ifdef / #ifndef / #if / #endif → conditional compilation
```

---

## Summary

A **macro** transforms source code into more source code, at compile time. Unlike a function, it receives **unevaluated** code and produces text that the compiler then reads. The **C preprocessor** is the bluntest macro system: blind textual substitution of tokens, with no understanding of precedence, scope, or types. That ignorance produces a small, famous family of bugs — missing parentheses, double evaluation of side-effecting arguments, multi-statement bodies escaping an `if`, and internal names colliding with the caller's. The defences are mechanical: parenthesize everything, use `do { } while(0)`, never pass side effects, name macros in upper case, and use `gcc -E` to see the truth. The deeper lesson is that **if a macro could be a function (or a `const`, or an inline function), it should be** — and the reason later languages built *syntactic, hygienic* macro systems is precisely to escape the C preprocessor's blindness, which is where `middle.md` and `senior.md` go next.

---

## Further Reading

- *The C Programming Language* (Kernighan & Ritchie), the preprocessor section — the original source on `#define`.
- The GCC manual chapter "The C Preprocessor" — authoritative on `#`, `##`, conditional compilation, and gotchas.
- *C Traps and Pitfalls* (Andrew Koenig) — a short book with a whole chapter on preprocessor disasters.
- Try it yourself: write `#define SQUARE(x) x*x`, compile with `gcc -E`, and watch your bug appear in plain text.
