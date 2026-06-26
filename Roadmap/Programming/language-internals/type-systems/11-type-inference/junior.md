# Type Inference — Junior Level

> **Topic:** [Type Inference](README.md)
> **Focus:** The compiler figuring out the types you didn't write — what `var`, `auto`, `:=`, and `<>` actually do, and where they stop helping.

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
13. [Cheat Sheet](#cheat-sheet)
14. [Summary](#summary)
15. [Further Reading](#further-reading)

---

## Introduction

> Focus: **What does it mean for a compiler to "know" a type you never typed?** And **why does it work for `var x = 5` but fail for an empty list?**

When you write `var name = "Bakhodir";` in Java, or `auto n = 42;` in C++, or `count := 0` in Go, you did not write a type — and yet the program is fully, statically typed. The compiler **inferred** the type: it looked at the value on the right-hand side (`"Bakhodir"` is a `String`, `42` is an `int`, `0` is an `int`) and silently gave the variable that type, exactly as if you had written it out.

**Type inference** is the compiler deducing types you left out. It is *not* dynamic typing. In Python or JavaScript, types are checked at runtime and a variable can hold anything over its life. In an inferred language, the type is decided **at compile time** and is then completely fixed — `count := 0` makes `count` an `int` forever; `count = "hello"` is a compile error. You got the safety of static typing without the keystrokes.

In one sentence: **type inference is the compiler reading the same clues you would read, and filling in the type so you don't have to.**

> 🎓 **Why this matters for a junior:** Modern languages lean on inference everywhere — `var`, `auto`, `:=`, the diamond `<>`. If you treat it as magic, you will be baffled the first time it infers a type you didn't want, or refuses to infer anything and demands an annotation. Understanding the *simple rule* the compiler follows ("look at the value, take its type") turns the magic into something you can predict and steer.

This page covers: what inference is (and isn't), the everyday inference in C++ `auto`, Java `var` and `<>`, C# `var`, Go `:=`, and Rust function bodies, why a `String` literal makes inference easy and an empty container makes it hard, and the single most useful junior habit — knowing *when* the compiler can figure it out and when you have to tell it.

---

## Prerequisites

What you should know before reading this:

- **Required:** What a *type* is — `int`, `String`, `bool`, a list, a struct/class.
- **Required:** The difference between a *declaration* (`int x;`) and an *initialization* (`int x = 5;`).
- **Required:** Basic experience writing variables and calling functions in at least one statically typed language (Java, C#, C++, Go, Rust, or TypeScript).
- **Helpful but not required:** A sense that some languages check types at compile time (Java, Go) and some at runtime (Python, JavaScript).
- **Helpful but not required:** Having seen a confusing compiler error that mentioned a type you never wrote.

You do **not** need to know:

- Hindley-Milner or "Algorithm W" (that's `middle.md` and `senior.md`).
- Unification, constraints, or the occurs-check (later levels).
- Generics deeply, or higher-kinded types, or bidirectional checking.

---

## Glossary

| Term | Definition |
|------|-----------|
| **Type inference** | The compiler deducing the type of a value or variable you did not write explicitly. |
| **Type annotation** | A type you *do* write explicitly: `int x`, `let x: i32`, `name: string`. The opposite of leaving it to inference. |
| **Static typing** | Types are fixed and checked at compile time. Inference is a feature *of* static typing, not an alternative to it. |
| **Dynamic typing** | Types are checked at runtime; a variable can hold different types over time (Python, JavaScript). **Not** the same as inference. |
| **Inferred type** | The type the compiler assigned to something you left blank. |
| **Initializer** | The expression on the right of `=`. Most local inference reads the initializer to decide the type. |
| **`var` / `auto` / `:=`** | The keywords/operators that say "infer the type of this local from its initializer" (Java/C#, C++, Go). |
| **Diamond `<>`** | Java's `new ArrayList<>()` — infer the generic type arguments from the variable's declared type. |
| **Local inference** | Inference limited to a small scope (one statement, one function body). Requires you to annotate signatures and boundaries. |
| **Literal** | A value written directly in code: `42`, `"hi"`, `true`, `3.14`. The compiler knows the type of a literal immediately. |
| **Return type** | The type a function gives back. Some languages infer it; many require you to write it. |

---

## Core Concepts

### 1. Inference Is Static Typing Without the Typing

The single most important idea: **inference does not make your language dynamic.** When you write `var x = 5;`, the compiler decides *right then* that `x` is an `int`, bakes that into the program, and enforces it forever. This:

```java
var x = 5;
x = "hello";   // COMPILE ERROR — x is an int, always
```

is just as illegal as if you had written `int x = 5;`. The only thing inference removed is the word `int`. Everything else — the safety, the speed, the IDE autocomplete — is identical.

### 2. The Simple Rule: Look at the Initializer

For everyday local inference, the compiler follows a rule you could follow yourself: **look at the value on the right-hand side, take its type, give it to the variable.**

```go
count := 0          // 0 is an int   → count is int
name  := "Ada"      // "Ada" is a string → name is string
ok    := true       // true is a bool → ok is bool
ratio := 3.14       // 3.14 is a float64 → ratio is float64
```

There is nothing mysterious here. You can predict every one of these by asking, "What type is the thing on the right?"

### 3. Why a Literal Is Easy and an Empty List Is Hard

The compiler can only infer when there are **clues**. A literal is a perfect clue: `42` can only be a number, `"x"` can only be a string. But some initializers carry no clue:

```java
var list = new ArrayList<>();  // ArrayList of WHAT? No element to look at.
```

An *empty* list contains nothing, so there's nothing for the compiler to read. This is the recurring junior surprise: **inference fails not because the compiler is dumb, but because you genuinely didn't give it enough information.** The fix is to supply the missing clue — an annotation:

```java
var list = new ArrayList<String>();   // now the element type is explicit
```

### 4. Local Inference Has a Range Limit

The inference in `var`, `auto`, `:=`, and `<>` is **local**: it works *inside* a small scope but stops at boundaries you must annotate yourself. The classic boundary is a **function signature**:

```go
// You MUST write the parameter and return types — Go will not infer them.
func add(a int, b int) int {
    sum := a + b      // but INSIDE the body, := infers freely
    return sum
}
```

A useful mental split: **annotate the edges, infer the insides.** Function parameters and return types are edges; local variables are insides. (Languages like Haskell and OCaml lift even this restriction with whole-program inference — that's the next levels.)

### 5. The Compiler Reads More Than the Initializer (a Little)

Sometimes there's no initializer but there *is* a target. Java's diamond is the example: `List<String> xs = new ArrayList<>();`. Here the compiler reads the *declared* type on the left (`List<String>`) and fills the `<>` on the right. So inference can flow from the **expected type**, not just the initializer. You'll meet this idea formally later as "contextual typing" and "bidirectional checking"; for now, just notice the compiler sometimes looks left, not only right.

### 6. Return-Type Inference: Sometimes Yes, Usually Annotate

Languages vary on whether a function's *return* type can be inferred:

- **C++** (`auto` return type): yes — the compiler reads your `return` statements.
- **Rust:** no for top-level functions — you must write `-> Type`. (It infers everything *inside* the body, though.)
- **Go:** no — you always write the return type.
- **Java/C#:** no — methods always declare their return type.

The reason mainstream languages *require* return annotations even when they could infer them is **readability and error quality**: a written return type documents the function and localizes errors to that function instead of letting a mistake ripple out to every caller.

---

## Real-World Analogies

| Concept | Real-world thing |
|---------|------------------|
| **Type inference** | A tailor who measures you by eye instead of asking your size. The suit still has an exact size — they just didn't make you say it. |
| **Annotation** | You telling the tailor "I'm a 40 regular." Sometimes faster, sometimes necessary when they can't see you. |
| **Inferring from a literal** | Guessing someone's age from a birthday cake with "30" on it. Easy — the clue is right there. |
| **Empty-list failure** | Being handed an empty gift box and asked what was in it. Nothing to go on. |
| **Local vs. global inference** | A local cashier knows the price of *this* item; a full audit can deduce the whole store's pricing. Two very different scopes. |
| **Boundary annotations** | Labels on the *outside* of shipping crates. The contents (the function body) are figured out on arrival, but the crate must be labeled to move between warehouses. |
| **Wrong inferred type** | The tailor measuring you in a thick coat and cutting the suit too big. The clue was misleading, so the guess was off. |

---

## Mental Models

### The "Fill in the Blank" Model

Picture every variable declaration as a fill-in-the-blank sentence: `___ x = 5;`. Inference is the compiler writing `int` in the blank for you. The value is the only thing that determines what goes in the blank. If two different things could go in the blank — or *nothing* could (the empty list) — the compiler can't fill it, and it asks you to.

### The "Annotate the Edges, Infer the Insides" Model

Draw a box around a function. The **walls** of the box — parameters and return type — must be labeled by you in most mainstream languages. The **inside** of the box — local variables — the compiler labels for free. When inference "fails," it's almost always because you left a wall unlabeled or gave the inside nothing to read. This single picture explains 90% of junior inference confusion.

### The "It's Still There, Just Invisible" Model

When you write `var x = 5`, mentally replace it with `int x = 5`. The `int` didn't disappear — it's still in the compiled program, in the IDE tooltip, in the type checker. Inference is *invisible* typing, not *absent* typing. Carry this and you'll never mistake `var` for "dynamic" or "untyped."

---

## Code Examples

The same idea — declare a local without writing its type — across the mainstream "local inference" languages.

### Go — `:=` short variable declaration

```go
package main

import "fmt"

func main() {
    count := 0          // int
    name := "Bakhodir"  // string
    pi := 3.14159       // float64
    ready := true       // bool

    // count = "x"      // would be: cannot use "x" (string) as int
    fmt.Printf("%T %T %T %T\n", count, name, pi, ready)
    // prints: int string float64 bool
}
```

`:=` is Go's inference operator. It only works for *new* locals inside a function. At package level and for function parameters, you write types.

### Java — `var` (since Java 10) and the diamond `<>`

```java
import java.util.ArrayList;
import java.util.List;

public class Infer {
    public static void main(String[] args) {
        var count = 0;                 // int
        var name = "Bakhodir";         // String
        var nums = new ArrayList<Integer>();  // ArrayList<Integer>

        // The diamond: type args inferred from the LEFT side
        List<String> words = new ArrayList<>();  // <> = <String>
        words.add("hi");

        // var cannot be used without an initializer:
        // var x;        // ERROR — nothing to infer from
        System.out.println(name + " " + count + " " + words);
    }
}
```

`var` only works on locals *with an initializer*. You cannot use it for fields, parameters, or return types.

### C# — `var`

```csharp
var count = 0;                  // int
var name = "Bakhodir";          // string
var list = new List<int>();     // List<int>

// var x;          // ERROR — no initializer, nothing to infer
```

C#'s `var` is identical in spirit to Java's: local, initializer-driven, fully static.

### C++ — `auto`

```cpp
#include <string>
#include <vector>

int main() {
    auto count = 0;              // int
    auto name = std::string{"Bakhodir"};  // std::string
    auto pi = 3.14;              // double
    std::vector<int> v = {1, 2, 3};
    for (auto x : v) {           // x is int, inferred from the vector
        (void)x;
    }
    // auto y;        // ERROR — auto needs an initializer
    return 0;
}
```

A subtle C++ note for later: `auto` strips references and `const` by default (`auto x = ref;` copies). Juniors should just know `auto` reads the initializer; the reference/const rules are a `middle.md` topic.

### Rust — function-body inference

```rust
fn main() {
    let count = 0;          // i32 (Rust's default integer)
    let name = "Bakhodir";  // &str
    let pi = 3.14;          // f64

    let mut nums = Vec::new();  // type not known YET...
    nums.push(1);               // ...now Rust knows it's Vec<i32>

    println!("{name} {count} {pi} {nums:?}");
}
```

Rust shows off something stronger than the others: `Vec::new()` had no type at first, but Rust *waited*, saw `nums.push(1)` later, and inferred `Vec<i32>` from the **usage**. That's a step up from "just read the initializer," and it's a preview of the real inference engine you'll meet in `middle.md`.

### Where inference fails — and the fix

```rust
fn main() {
    // let v = Vec::new();   // ERROR: type annotations needed
                             // (nothing is ever pushed, so no clue)

    let v: Vec<i32> = Vec::new();  // FIX 1: annotate the variable
    let w = Vec::<i32>::new();     // FIX 2: annotate the call
    let _ = (v, w);
}
```

```java
// var list = new ArrayList<>();  // ERROR / infers ArrayList<Object>
var list = new ArrayList<String>();  // FIX: give the element type
```

The pattern is always the same: **inference failed because you withheld the only clue. Supply it.**

---

## Pros & Cons

| Aspect | Pros | Cons |
|--------|------|------|
| **Verbosity** | Far less typing; no repeating obvious types like `Map<String, List<Integer>> m = new HashMap<String, List<Integer>>()`. | The reader loses an explicit type they sometimes wanted to see. |
| **Safety** | Identical to writing the type — fully static, fully checked. | None for safety; inferred code is exactly as safe. |
| **Readability** | Cleaner code when the type is obvious from the value (`var users = repo.findAll();`). | Worse when the type is *not* obvious (`var x = process();` — `x` is what?). |
| **Refactoring** | Change the initializer's type and the variable follows automatically. | The variable *silently* changes type — sometimes you wanted a compile error instead. |
| **Learning** | One rule ("read the value") covers the common cases. | The failure modes (empty containers, ambiguous numerics) confuse beginners. |
| **Tooling** | IDEs show the inferred type on hover; you lose nothing. | Without an IDE (code review, diffs, terminals) the type is invisible. |

---

## Use Cases

Local inference (`var`/`auto`/`:=`) is the right call when:

- **The type is obvious from the right-hand side.** `var user = new User();`, `count := len(items)`. Repeating `User`/`int` adds nothing.
- **The type is long and noisy.** `var iterator = map.entrySet().iterator();` is far kinder than spelling out `Iterator<Map.Entry<String, List<Integer>>>`.
- **Inside loops over known collections.** `for (auto& item : items)` — the element type is clear from `items`.
- **Chained/fluent calls where the type is an implementation detail** you don't want to name.

Prefer an explicit annotation when:

- **The type is *not* obvious from the call.** `var result = compute();` — write the type so the reader knows what `result` is.
- **You're at a boundary** — public method signatures, fields, return types. These are documentation; spell them out.
- **You want a specific type, not the inferred default.** `var x = 0;` gives `int`; if you wanted `long`, annotate.
- **Inference fails** (empty containers, ambiguous numeric literals). You have no choice.

---

## Coding Patterns

### Pattern 1: Infer when the right-hand side names the type

```java
var user = userRepository.findById(id);   // type is User — obvious, infer it
var users = new ArrayList<User>();         // type is in the expression — infer it
```

If a human reading the line already sees the type, the `var` keyword costs nothing and saves clutter.

### Pattern 2: Annotate when the right-hand side hides the type

```java
// var x = parse(input);            // x is... ? Reader has to chase parse().
Token x = parse(input);             // now the line is self-documenting.
```

### Pattern 3: Supply the clue when a container is empty

```rust
let scores: Vec<i32> = Vec::new();      // annotate the variable, OR
let scores = Vec::<i32>::new();         // annotate the constructor
```

```go
items := make([]string, 0)              // the make() call carries the type
```

### Pattern 4: Let the diamond mirror the declaration (Java)

```java
Map<String, List<Integer>> m = new HashMap<>();   // <> repeats the left side
```

Write the full type once on the left; let `<>` avoid repeating it on the right.

### Pattern 5: Annotate function edges, infer locals

```rust
fn parse_line(line: &str) -> Option<i32> {   // edges: annotated
    let trimmed = line.trim();               // local: inferred
    let parsed = trimmed.parse();            // local: inferred from context
    parsed.ok()
}
```

---

## Best Practices

- **Treat `var`/`auto`/`:=` as "the type is clear from this line."** If it isn't clear, write the type. This single guideline resolves most `var` style debates.
- **Always annotate public API boundaries.** Method parameters and return types are read far more than they're written; make them explicit even when a language *could* infer them.
- **Never assume inference makes code dynamic.** `var x = 5` is `int x = 5`. The type is fixed.
- **When inference fails, read the error literally.** "type annotations needed" or "cannot infer" means *you* withheld a clue, not that the compiler is broken. Find the empty container or ambiguous literal and label it.
- **Watch the default numeric type.** A bare integer literal becomes `int`/`i32`; a bare float becomes `double`/`f64`. If you need `long`/`i64`, annotate or use a typed literal (`0L`, `0i64`).
- **Use your IDE's "show inferred type" feature** before committing inferred locals — confirm the compiler inferred what you expected.
- **Be stricter in code that's reviewed in diffs.** A reviewer reading a `.diff` in a terminal has no IDE hover; explicit types help them.

---

## Edge Cases & Pitfalls

- **Empty containers infer nothing.** `var list = new ArrayList<>();` and `let v = Vec::new();` have no element to read. Annotate the element type.
- **Numeric literals default surprisingly.** `var x = 0;` is `int`, not `long` or `byte`. `auto x = 0;` is `int`, not `size_t`. If a later `x = someBigValue` overflows, the bug is the inferred narrow type.
- **`var` with no initializer is illegal.** `var x;` has nothing to infer from — every local-inference language rejects it. You must initialize on the same line.
- **The inferred type can be wider or narrower than you wanted.** `var x = condition ? 1 : 2.0;` might infer `double` (the common type), surprising you if you expected `int`.
- **C++ `auto` drops `const` and references.** `const std::string& r = get(); auto x = r;` makes `x` a **copy**, not a reference. Use `auto&` / `const auto&` when you want to bind by reference. (Detail for `middle.md`, but the copy can bite a junior.)
- **`var` hides the type from readers without an IDE.** Code review tools, `git diff`, and printouts don't show hovers. Over-using `var` on non-obvious lines hurts reviewers.
- **Float/int mixing.** `auto avg = sum / count;` where both are `int` does **integer** division — inference faithfully gives you `int`, including the truncation bug. Inference reflects the expression; it doesn't fix your arithmetic.
- **It is *not* dynamic typing.** The most common beginner misconception. You cannot reassign `var x = 5` to a string later. If you came from Python/JavaScript, unlearn this immediately.

---

## Cheat Sheet

```text
┌──────────────────────────────────────────────────────────────────┐
│                  TYPE INFERENCE — JUNIOR                          │
├──────────────────────────────────────────────────────────────────┤
│ What it is:  compiler deduces a type you didn't write            │
│ What it is NOT:  dynamic typing. The type is FIXED, compile-time │
├──────────────────────────────────────────────────────────────────┤
│ The simple rule:  look at the value on the right, take its type  │
│   count := 0        → int                                        │
│   name  := "Ada"    → string                                     │
│   pi    := 3.14     → float64 / double                           │
├──────────────────────────────────────────────────────────────────┤
│ Local-inference keywords                                         │
│   Go      x := value                                             │
│   Java    var x = value;     +  diamond  new ArrayList<>()       │
│   C#      var x = value;                                         │
│   C++     auto x = value;                                        │
│   Rust    let x = value;     (also infers from later usage)      │
├──────────────────────────────────────────────────────────────────┤
│ Rule of thumb:  annotate the EDGES, infer the INSIDES            │
│   edges  = params, return types, public fields → write them      │
│   insides = local variables → let the compiler infer             │
├──────────────────────────────────────────────────────────────────┤
│ When inference FAILS, you withheld a clue:                       │
│   empty container        → annotate element type                 │
│   no initializer         → add one (or write the type)           │
│   ambiguous numeric      → use 0L / 0i64 or annotate             │
├──────────────────────────────────────────────────────────────────┤
│ Style:  use var/auto when the type is OBVIOUS from the line;     │
│         write the type when it is NOT.                           │
└──────────────────────────────────────────────────────────────────┘
```

---

## Summary

- **Type inference is the compiler deducing the types you left out** — and it is a feature *of* static typing, not a move toward dynamic typing. `var x = 5` is exactly `int x = 5` with the word `int` hidden.
- For everyday locals, the compiler follows a rule you can follow too: **read the initializer, take its type.** `0` → `int`, `"x"` → `string`, `3.14` → `float64`.
- Inference needs **clues**. A literal is a great clue; an **empty container** is no clue at all, which is why `new ArrayList<>()` and `Vec::new()` can fail and ask you to annotate.
- The mainstream tools — Go `:=`, Java `var` and the diamond `<>`, C# `var`, C++ `auto`, Rust `let` — all do **local** inference: they work inside a scope but require you to **annotate the edges** (function parameters and return types).
- Rust goes a little further by inferring from **later usage**, not just the initializer — a hint of the more powerful engines covered in the next levels.
- The pro is less noise; the con is hidden types. The discipline: **infer when the type is obvious from the line, annotate when it is not, and annotate every public boundary.**
- When inference fails, the message ("type annotations needed") means *you* withheld information. Find the empty container or ambiguous literal and supply it.

---

## Further Reading

- *The Java Language Specification* — section on Local Variable Type Inference (`var`, JEP 286). https://openjdk.org/jeps/286
- *Style Guidelines for Local Variable Type Inference in Java* — Stuart Marks, the official `var` style guide. https://openjdk.org/projects/amber/guides/lvti-style-guide
- *The Rust Programming Language* — Chapter 3, "Data Types," and the inference notes. https://doc.rust-lang.org/book/
- *cppreference: `auto` specifier* — https://en.cppreference.com/w/cpp/language/auto
- *Effective Go* — the section on short variable declarations (`:=`). https://go.dev/doc/effective_go
- *C# language reference: Implicitly typed local variables (`var`)* — Microsoft Docs.
- *A Tour of Go* — the "Variables" and "Short variable declarations" pages. https://go.dev/tour/
