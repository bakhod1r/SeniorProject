# Generic Programming — Junior Level

> **Roadmap:** [Programming Paradigms](../README.md) → Generic Programming
> *Write the algorithm once, abstracted over the type it works on — and let the compiler give you a `max` for `int`, `double`, and `string` for free, with no copy-paste and no loss of type safety.*

---

## Table of Contents

1. [Introduction](#introduction)
2. [Prerequisites](#prerequisites)
3. [Glossary](#glossary)
4. [Core Concept 1 — The Duplication Problem](#core-concept-1--the-duplication-problem)
5. [Core Concept 2 — Type Parameters](#core-concept-2--type-parameters)
6. [Core Concept 3 — A Generic Container](#core-concept-3--a-generic-container)
7. [Core Concept 4 — Why Not Just Use `Object` / `interface{}`?](#core-concept-4--why-not-just-use-object--interface)
8. [The Same Idea in Four Languages](#the-same-idea-in-four-languages)
9. [Real-World Examples](#real-world-examples)
10. [Mental Models](#mental-models)
11. [Common Mistakes](#common-mistakes)
12. [Test Yourself](#test-yourself)
13. [Cheat Sheet](#cheat-sheet)
14. [Summary](#summary)
15. [Further Reading](#further-reading)
16. [Related Topics](#related-topics)

---

## Introduction

> Focus: **What is it, and why does it matter?**

Suppose you need a function that returns the larger of two numbers. Easy:

```java
int max(int a, int b) { return a > b ? a : b; }
```

Now you need it for `double`. So you write `max(double, double)`. Then `long`. Then `String` (by length, or alphabetically). Then your own `Money` type. Four, five, six copies of the *same three lines* — the only thing that changes is the **type**. The logic ("compare, return the bigger one") is identical every time. You're copy-pasting a shape and filling in a different blank.

That smell — *the same algorithm, written again and again only because the types differ* — is exactly what **generic programming** removes. The idea is to write the algorithm **once**, leaving the type as a *blank to be filled in later*, and let the compiler generate (or reuse) the right version for whatever type you actually use it with. You get the convenience of writing it once **and** keep full type safety: a generic `max<T>` knows it's comparing two `T`s, and the compiler still stops you from passing an `int` where a `String` belongs.

> **The mindset shift:** stop thinking "a function works on *one* type." Start thinking "an algorithm has a *shape* that's independent of the type it runs on — write the shape once, parameterize over the type." This is the paradigm behind every `List<T>`, every `sort`, and the entire C++ Standard Template Library.

---

## Prerequisites

- **Required:** You can write functions and use built-in collections (a list, an array, a map) in at least one typed language. Examples use **Java**, **Go**, **C++**, and **Rust**, with a small **Haskell** aside.
- **Required:** You've felt the pain of copy-pasting a function and changing only the type — or of using `Object`/`interface{}`/`void*` and casting it back.
- **Helpful:** You know what a *compile-time error* is versus a *runtime error*. Generics' whole selling point is moving "wrong type" mistakes from runtime to compile time.
- **Not required:** Type theory. The deeper mechanics (variance, monomorphization, type erasure) come at the [middle](middle.md) and [senior](senior.md) levels; the mechanics of *type systems* live in [Language Internals → Type Systems](../../language-internals/type-systems/).

---

## Glossary

| Term | Definition |
|------|-----------|
| **Generic programming** | Writing an algorithm or data structure **once**, abstracted over the types it operates on, so it works for many types without duplication or loss of type safety. |
| **Type parameter** | A placeholder for a type, supplied later — the `T` in `List<T>`, `max<T>`, `Vec<T>`. |
| **Generic function** | A function with one or more type parameters (`max<T>`, `swap<T>`). |
| **Generic type / container** | A data structure parameterized over the type it holds (`List<T>`, `Vec<T>`, `Map<K, V>`). |
| **Instantiation** | Supplying a concrete type for a type parameter — turning `List<T>` into `List<String>`. |
| **Parametric polymorphism** | The formal name for this kind of generics: one definition that works *uniformly* for all types. |
| **Type safety** | The compiler guarantees you only combine values in type-correct ways — no `String` where an `int` is required. |
| **`Object` / `interface{}` / `void*`** | The "give up the type" escape hatches generics exist to replace — a single super-type that holds anything, at the cost of casts and lost safety. |

> The two words to lock in now are **type parameter** (the blank, `T`) and **instantiation** (filling the blank with a real type, `String`). Everything else is built on those.

---

## Core Concept 1 — The Duplication Problem

Without generics, every algorithm is tied to one concrete type, so you duplicate it per type. Watch the duplication pile up:

```java
// Three functions. The bodies are IDENTICAL. Only the types differ.
int    maxInt(int a, int b)          { return a > b ? a : b; }
double maxDouble(double a, double b) { return a > b ? a : b; }
String maxStr(String a, String b)    { return a.compareTo(b) > 0 ? a : b; }
```

The cost isn't just typing. It's **maintenance**: fix a bug in one copy and you must remember to fix it in all the others. It's **coverage**: you only have versions for the types you bothered to write — a new `Money` type gets no `max` until someone writes a fourth copy. And it's **bloat**: a list utility (`reverse`, `contains`, `indexOf`, …) multiplied across `int`, `String`, `User`, `Order`… becomes hundreds of near-identical functions.

Generic programming collapses all of that into **one** definition:

```java
// One function. Works for every type that can be compared.
static <T extends Comparable<T>> T max(T a, T b) {
    return a.compareTo(b) > 0 ? a : b;
}

max(3, 7);                  // T = Integer  → 7
max(2.5, 1.5);              // T = Double   → 2.5
max("apple", "banana");     // T = String   → "banana"
```

One source of truth. Fix it once, every type benefits. Add a new comparable type, `max` already works for it. The `<T extends Comparable<T>>` part says "*T* can be any type, **as long as** it knows how to compare itself" — a **constraint** we'll explore at the [middle](middle.md) level. For now, notice the shape: a single definition, a type left blank.

---

## Core Concept 2 — Type Parameters

A **type parameter** is a placeholder for a type — written `<T>` (Java, C++, C#), `[T any]` (Go), or `<T>` (Rust). You declare it once, then use it throughout the function or type as if it were a real type whose name you simply don't know yet.

```rust
// Rust: <T> declares a type parameter; the body uses T like any type.
fn first<T>(items: &[T]) -> &T {
    &items[0]
}

first(&[1, 2, 3]);            // T = i32
first(&["a", "b", "c"]);      // T = &str
```

The compiler **infers** `T` from how you call the function — you rarely write it out. When you call `first(&[1, 2, 3])`, the compiler sees a slice of `i32`, sets `T = i32`, and you get back an `&i32`. Call it with strings and `T` becomes the string type, with no change to the source. That's the payoff: **one body, many types, inferred automatically.**

A function can have several type parameters:

```go
// Go: K and V are two independent type parameters.
func pairUp[K any, V any](key K, value V) struct{ Key K; Value V } {
    return struct{ Key K; Value V }{key, value}
}
```

> **Key insight:** a type parameter isn't a type — it's a *blank for* a type. The generic definition is a **template** (in the everyday sense) that the compiler completes once you supply the real type. The same source serves `int`, `String`, and `YourType` because the type was never baked in.

---

## Core Concept 3 — A Generic Container

The most familiar generics aren't functions — they're **containers**: `List<T>`, `Vec<T>`, `Map<K, V>`. A container is the perfect case for generics because the *storage and operations* (add, get, length, iterate) are genuinely independent of *what you store*.

```java
List<String> names = new ArrayList<>();
names.add("Ada");
String first = names.get(0);   // returns String — no cast needed
names.add(42);                 // COMPILE ERROR: 42 is not a String
```

`ArrayList<T>` is written once. By writing `List<String>`, you instantiate it with `T = String`, and the compiler now *knows* every element is a `String`: `get` returns a `String` (no cast), and `add(42)` is rejected at compile time. Compare the same idea across languages:

```go
nums := []int{1, 2, 3}          // Go: built-in generic slice []T
m := map[string]int{"a": 1}     // map[K]V, two type parameters
```

```cpp
std::vector<int> v{1, 2, 3};        // C++: vector<T>
std::map<std::string, int> m;       // map<K, V>
```

```rust
let v: Vec<i32> = vec![1, 2, 3];          // Rust: Vec<T>
let mut m = std::collections::HashMap::<String, i32>::new();
```

In every case the container author wrote the data structure **once** over a type parameter, and you specialized it to your element type at the use site. You get a `Vec<i32>` that *cannot* hold a string — the type system enforces it — without the `Vec` author ever knowing about `i32`.

---

## Core Concept 4 — Why Not Just Use `Object` / `interface{}`?

Before generics existed (or when people avoid them), the workaround is a **single super-type that holds anything**: `Object` in old Java, `interface{}` / `any` in Go, `void*` in C. A "generic" list becomes a list of `Object`.

```java
// Pre-generics Java: a list of Object holds anything…
List list = new ArrayList();
list.add("Ada");
list.add(42);                          // compiles! anything goes in
String s = (String) list.get(0);       // must CAST on the way out
String bad = (String) list.get(1);     // compiles, then CRASHES at runtime:
                                        // ClassCastException — 42 is not a String
```

This "works," but throws away the very thing a type system is *for*. Three problems, all of which generics fix:

1. **You lose type safety.** Nothing stops `list.add(42)` into a "list of strings." The mistake isn't caught until something casts and **crashes at runtime** — exactly the bug a compiler should have caught.
2. **You must cast on the way out.** Every `get` returns `Object`, so you cast it back. Casts are noise *and* a place to be wrong.
3. **It's slower and clunkier in some languages** (boxing, runtime type checks) — covered at the [senior](senior.md) level.

Generics give you the *flexibility* of "works for many types" **and** the *safety* of "the compiler knows exactly which type." That combination — **flexible *and* checked** — is the whole point. `Object`/`interface{}` is flexible but unchecked; a non-generic per-type function is checked but inflexible; generics are both.

```go
// Go: the unsafe way vs the generic way
var box []any                // holds anything; element type is lost
box = append(box, "x", 42)   // no error; you'll type-assert and maybe panic

func First[T any](s []T) T { return s[0] }   // generic: type preserved, no assertion
```

---

## The Same Idea in Four Languages

> Task: **write `swap` once — exchange two values of the same type — for every type.**

```java
// JAVA — <T> type parameter; works for any reference type.
static <T> void swap(T[] arr, int i, int j) {
    T tmp = arr[i]; arr[i] = arr[j]; arr[j] = tmp;
}
```

```go
// GO — [T any] type parameter (since Go 1.18).
func Swap[T any](s []T, i, j int) {
    s[i], s[j] = s[j], s[i]
}
```

```cpp
// C++ — template<typename T>; the original generic-programming workhorse.
template <typename T>
void swap(T& a, T& b) { T tmp = a; a = b; b = tmp; }
```

```rust
// RUST — <T>; though the standard library's std::mem::swap already does this.
fn swap<T>(a: &mut T, b: &mut T) { std::mem::swap(a, b); }
```

```haskell
-- HASKELL — type variables are lowercase; no keyword needed.
swap :: (a, b) -> (b, a)
swap (x, y) = (y, x)
```

Five languages, one idea: the swap *logic* never mentions a concrete type, so it serves all of them. The differences are syntactic — `<T>`, `[T any]`, `template<typename T>`, lowercase `a` — but the paradigm is identical: **one algorithm, parameterized over its types.**

---

## Real-World Examples

| Thing you've used | The generics underneath |
|---|---|
| `ArrayList<User>`, `HashMap<String, Order>` (Java) | The whole `java.util` collections are generic over their element/key/value types. |
| `Vec<T>`, `Option<T>`, `Result<T, E>` (Rust) | Core types are generic; `Option<T>` is "maybe a `T`" for *any* `T`. |
| `std::vector`, `std::sort`, `std::map` (C++) | The STL is the canonical generic library — containers + algorithms, decoupled. |
| `[]T` slices and `map[K]V` (Go) | Built-in generic containers; user generics arrived in Go 1.18. |
| `Comparator<T>`, `Stream<T>` (Java) | Generic over the element type so one `sort`/`map` serves every type. |
| `Promise<T>` / `Task<T>` (TS / C#) | "An eventual value of type `T`" — generic over the result type. |

You already *use* generics constantly — every typed collection you've touched is generic. This topic just makes the pattern explicit so you can *write* your own generic code instead of only consuming it.

---

## Mental Models

- **Fill in the blank.** A generic definition is a sentence with a blank: "a list of ⬚." You write the sentence once; the compiler fills the blank with `String`, `int`, `User` each time you use it. The blank is the type parameter.
- **The cookie cutter.** The generic code is the cutter (the *shape*); the type you instantiate with is the dough (`int`, `String`). One cutter, many cookies, all the same shape. You don't carve a new cutter per flavor of dough.
- **A contract with a hole in it.** `max<T>` promises "give me two `T`s, I'll return the bigger `T`" — without committing to *which* `T`. The hole is filled at the call site, and the compiler checks both sides agree.
- **Generics vs `Object`: a labeled box vs an unlabeled box.** `List<String>` is a box *labeled* "strings only" — the compiler enforces the label. `List<Object>` is an unlabeled box you toss anything into and squint at later, hoping you guessed the contents right.

---

## Common Mistakes

- **Reaching for `Object`/`interface{}`/`any` to "be flexible."** That flexibility costs you type safety and adds casts. If the code is generic over a type, use a *type parameter* and keep the type. Save `any` for genuinely heterogeneous bags.
- **Thinking generics are just for collections.** Containers are the famous case, but *algorithms* (`sort`, `max`, `find`, `map`) are generic too — and that's where the STL's power comes from. An algorithm parameterized over its element type is generic programming at its best.
- **Confusing a generic type parameter with a value parameter.** `T` is a *type*, supplied (usually inferred) at compile time; it's not a variable you pass at runtime. `List<String>` and `List<Integer>` are *different types*, decided at compile time.
- **Assuming "generic = works on literally any type."** Often the algorithm needs the type to *support something* (compare, add, print). That's a **constraint** (`T extends Comparable`, a Go constraint, a C++ concept, a Rust trait bound) — covered next level. Unconstrained `T` can only be moved around, not operated on.
- **Over-genericizing.** If only one type will ever use it, a plain function is clearer than a generic one. Generics earn their keep when *several* types genuinely share the algorithm. (More on over-abstraction at the [senior](senior.md) level.)

---

## Test Yourself

1. In your own words: what problem does generic programming solve, and what does it refuse to give up while solving it?
2. What is a *type parameter*? What is *instantiation*? Give the `List<T>` example for both.
3. Why is `List<String>` safer than a `List` of `Object`? Name the two concrete advantages.
4. Write a generic `identity` function (returns its argument unchanged) in any language you know. What's its type parameter?
5. Give one example of a generic *function* and one of a generic *container*. Why is generics a natural fit for containers?
6. When would you *not* make something generic — when is a plain, single-type function the better call?

> Try each before reading on. If #3 is fuzzy, re-read [Why Not Just Use `Object`](#core-concept-4--why-not-just-use-object--interface).

---

## Cheat Sheet

```
GENERIC PROGRAMMING = write the algorithm/data structure ONCE,
                      abstracted over the TYPE it works on.
Goal: no duplication  AND  no loss of type safety. (Flexible AND checked.)

THE PROBLEM IT SOLVES:
  maxInt + maxDouble + maxString + ...   ← same body, different type = copy-paste
  →  max<T>(a, b)                        ← one definition, every type

TYPE PARAMETER = a blank for a type, supplied (usually inferred) later.
  Java/C++/Rust:  <T>        Go:  [T any]
  INSTANTIATION  = filling the blank:  List<T>  →  List<String>

GENERIC FUNCTION   :  max<T>, swap<T>, first<T>
GENERIC CONTAINER  :  List<T>, Vec<T>, Map<K,V>, Option<T>

WHY NOT Object / interface{} / any ?
  - loses type safety (anything goes in → crash on the way out)
  - forces casts / type assertions
  generics keep the type → compiler checks it → no cast, no runtime surprise

DON'T over-genericize: one type only → just write a plain function.
Often need a CONSTRAINT (T must be comparable / addable) → see middle.md
```

---

## Summary

**Generic programming** means writing an algorithm or data structure **once**, abstracted over the types it works on, so it serves many types without duplication and without losing type safety. It solves the **duplication problem** — the `maxInt`/`maxDouble`/`maxString` copy-paste — by introducing a **type parameter** (`<T>`, `[T any]`), a blank for a type that the compiler fills in (usually by inference) at each use, a step called **instantiation**. The most familiar examples are **generic containers** (`List<T>`, `Vec<T>`, `Map<K, V>`), but generic *algorithms* (`sort`, `max`, `find`) are just as central — that decoupling of algorithms from the types they operate on is the heart of the C++ STL. Crucially, generics beat the `Object`/`interface{}`/`void*` escape hatch because they keep the type **flexible *and* checked**: no casts, no runtime `ClassCastException`, the compiler knowing exactly what you hold. Reach for generics when several types genuinely share an algorithm — and reach for a plain function when only one ever will.

---

## Further Reading

- Alexander Stepanov & Paul McJones, *Elements of Programming* — the book by the STL's designer on generic programming as a discipline.
- *The C++ Standard Template Library* documentation — the canonical generic library; read `<algorithm>` and see how algorithms decouple from containers via iterators.
- The Java Tutorials, *Generics* trail — the clearest beginner path to `<T>`, bounds, and wildcards.
- *The Go Programming Language* blog, "An Introduction to Generics" (Go 1.18) — type parameters and constraints, from scratch.

---

## Related Topics

- [`middle.md`](middle.md) — bounded type parameters / constraints, parametric vs ad-hoc vs subtype polymorphism, the STL design, type inference, variance basics.
- [`senior.md`](senior.md) — monomorphization vs type erasure vs Go's approach, the *cost* of generic abstraction, when generics become over-engineering.
- [01 — Overview & Taxonomy](../01-overview-and-taxonomy/) — where generic programming sits among the paradigms.
- [Type Systems → Generics & Parametric Polymorphism](../../language-internals/type-systems/05-generics-and-parametric-polymorphism/) — the *mechanics* of the type system feature behind this style.
- [Type Systems → What Is a Type](../../language-internals/type-systems/01-what-is-a-type/) — the foundation generics build on.
- [Functional Programming](../../code-craft/functional-programming/) — parametric polymorphism shows up there too (`map<A, B>`).
