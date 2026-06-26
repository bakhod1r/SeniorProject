# Generics & Parametric Polymorphism — Junior Level

> **Topic:** [Generics & Parametric Polymorphism](README.md)
> **Focus:** Writing one piece of code that works for *every* type. What `<T>` actually means, why a `List<T>` is better than a `List<Object>`, and why the same generic function behaves identically whether you hand it an `int`, a `String`, or a spaceship.

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
13. [Summary](#summary)

---

## Introduction

> Focus: **What does it mean to write code that works "for any type"?** And **why is that strictly better than the alternatives — copy-pasting per type, or throwing everything into `Object`?**

Imagine you write a function that returns the first element of a list. With an `int` list you write `firstInt`. With a `String` list you write `firstString`. With a `User` list you write `firstUser`. Three functions, identical *bodies*, differing only in the word `int` / `String` / `User`. That is wasteful, error-prone, and the moment you add a fourth type you copy-paste again.

**Generics** (the language feature) let you write that function *once*, with the type left as a blank to be filled in later:

```text
first<T>(items: List<T>) -> T
```

The `<T>` is a **type parameter** — a placeholder for "some type, you tell me which." When you call `first(myIntList)`, the compiler fills `T = int`. When you call `first(myStringList)`, it fills `T = String`. **One body, all types.** The mechanism that makes this work is called **parametric polymorphism**: "parametric" because the code is *parameterized by a type*, and "polymorphism" (Greek: *many forms*) because the one function takes many forms depending on the type plugged in.

The single most important property — and the thing that separates parametric polymorphism from the other kinds — is **uniformity**. `first<T>` does the *exact same thing* for every `T`. It cannot peek at the type and behave differently for `int` than for `String`. It literally *cannot know* what `T` is, so it must treat every value as an opaque box: hold it, return it, move it, but never inspect it. That sounds like a limitation, and it is, but it is also a superpower: because the function is forced to ignore the contents, you know it *can't* corrupt them, and you can reuse it everywhere with total confidence.

This page covers the absolute foundations: what a type parameter is, the difference between a **generic type** (`List<T>`) and a **generic function** (`first<T>`), why generics beat both copy-paste and `Object`-everything, and the same examples across Java, C#, Go, TypeScript, Rust, and C++. The next level (`middle.md`) goes into the four kinds of polymorphism and how generics are actually *implemented* (monomorphization vs. type erasure); `senior.md` covers parametricity and "theorems for free"; `professional.md` covers the deep performance and design trade-offs of each implementation strategy.

> 🎓 **Why this matters for a junior:** Generics are everywhere — every collection you use (`List`, `Map`, `Set`, `Option`, `Result`, `Promise`, `Future`) is generic. If you don't understand `<T>`, you will either avoid these tools or misuse them. And the #1 junior mistake — reaching for `Object`/`interface{}`/`any` and casting everywhere — is *exactly* the problem generics were invented to kill. Learning this well makes your code shorter, safer, and faster all at once.

---

## Prerequisites

What you should know before reading this:

- **Required:** How to write a function with parameters and a return type in at least one typed language (Java, C#, Go, TypeScript, Rust, or C++).
- **Required:** What a **type** is — `int`, `String`, a class/struct you defined — and what it means for a variable to "have a type."
- **Required:** Basic familiarity with a collection like a list or array.
- **Helpful but not required:** Some exposure to inheritance / interfaces (we contrast generics with them, lightly).
- **Helpful but not required:** Having felt the pain of either copy-pasting a function per type, or casting `Object` back to the real type.

You do **not** need to know:

- How the compiler implements generics (monomorphization, erasure — that's `middle.md`).
- Bounded type parameters / constraints in depth (we touch them; the full treatment is a sibling topic).
- Variance (`? extends`, covariance — a sibling topic).
- Anything about typeclasses, higher-kinded types, or parametricity proofs (`senior.md`).

---

## Glossary

| Term | Definition |
|------|-----------|
| **Generic** | A function, type, or method written with one or more **type parameters** so it works for many types. |
| **Type parameter** | A placeholder for a type, written `<T>` (or `<E>`, `<K, V>`…). Filled in with a real type when the generic is used. |
| **Type argument** | The actual type you supply for a type parameter. In `List<String>`, `String` is the type argument for `List<T>`'s parameter `T`. |
| **Parametric polymorphism** | Writing code parameterized by a type variable that behaves **identically for all types**. The formal name for what generics give you. |
| **Generic type** | A type that takes type parameters: `List<T>`, `Map<K,V>`, `Optional<T>`. |
| **Generic function / method** | A function/method that takes type parameters: `first<T>(...)`, `max<T>(...)`. |
| **Instantiation** | Filling a generic's type parameter with a concrete type — turning `List<T>` into `List<String>`. |
| **Type inference** | The compiler figuring out the type argument for you, so you write `first(myList)` instead of `first<String>(myList)`. |
| **Type variable** | Another name for a type parameter inside the body of a generic; `T` *is* a type variable. |
| **Bounded type parameter** | A type parameter restricted to types satisfying some requirement: `<T extends Comparable<T>>` ("T must be comparable"). |
| **Unbounded type parameter** | A type parameter with no restriction — `T` can be *any* type. The function can only do type-agnostic things with it. |
| **Boxing** | Wrapping a value type (like `int`) in a heap object so it can be treated uniformly as a reference. A common cost of certain generic implementations. |
| **`Object` / `any` / `interface{}`** | The "top type" — a box that holds anything. The pre-generics way to write reusable code, requiring casts and losing type safety. |
| **Cast** | Telling the compiler "trust me, this `Object` is really a `String`." Unchecked casts are where pre-generics code blows up at runtime. |
| **Container / collection** | A data structure holding other values: list, map, set, stack. The most common place you meet generics. |

---

## Core Concepts

### 1. The Problem Generics Solve: Three Bad Options

Before generics, if you wanted a "stack of things," you had three choices, all bad:

**Option A — One stack per type (copy-paste).**

```text
IntStack    { push(int),    pop() -> int    }
StringStack { push(String), pop() -> String }
UserStack   { push(User),   pop() -> User   }
```

Identical code, duplicated N times. A bug fixed in one is still present in the others. Adding a type means copy-pasting again.

**Option B — One stack of `Object` (the "top type").**

```text
ObjectStack { push(Object), pop() -> Object }
```

One implementation — but now every `pop()` returns `Object`, and *you* must cast it back:

```text
String s = (String) stack.pop();   // and if it was actually a User? → crash at runtime
```

You lost type safety. The compiler can no longer stop you from pushing a `User` and popping it as a `String`. The mistake surfaces as a runtime `ClassCastException`, often far from where you made it.

**Option C — Generics.**

```text
Stack<T> { push(T), pop() -> T }
```

One implementation, *and* full type safety. `Stack<String>` only accepts `String`s and `pop()` returns a `String` — checked by the compiler, no cast, no runtime surprise. **This is the whole point.** Generics give you the reuse of Option B with the safety of Option A.

### 2. `<T>` Is Just a Parameter — for Types

You already understand value parameters. In `add(x, y)`, `x` and `y` are placeholders filled in at call time. A type parameter is the *exact same idea*, one level up:

```text
function add(x, y)        ← x, y are VALUE parameters, filled with values
function first<T>(...)     ← T is a TYPE parameter, filled with a type
```

When you call `first<String>(list)` (or just `first(list)` and let inference figure out `T = String`), you are passing `String` as the type argument, exactly as you pass `5` as a value argument. The naming convention `T` is just convention — it stands for "Type." You'll also see `E` (Element), `K`/`V` (Key/Value), `R` (Return). They're all type parameters.

### 3. Uniform Behavior: The Defining Property

Here is the rule that makes parametric polymorphism *parametric*:

> A fully parametric function **does the same thing for every type**. It cannot inspect, branch on, or special-case the type it was given.

Consider `first<T>(items: List<T>) -> T`. Inside the body, `T` is unknown. The function can:

- hold a `T` (store it in a variable),
- move a `T` around (return it, pass it on),
- put `T`s in a `List<T>`.

It *cannot*:

- call `.toUpperCase()` on a `T` (maybe `T` is `int` — no such method),
- compare two `T`s with `<` (maybe `T` is `User` — no ordering),
- create a `new T()` (it doesn't know `T`'s constructor),
- ask "is `T` an `int`?" and behave differently.

This is not a bug. It's the *guarantee*. Because `first<T>` can't touch the contents, you *know* it returns one of the elements unchanged — it can't have transformed your `User` into something else. The type signature alone tells you a lot about what the code does. (At the senior level this becomes "theorems for free": a function of type `T -> T` with no constraints *must* be the identity function — there's literally nothing else it can do.)

### 4. Generic Type vs. Generic Function

Two related but distinct things:

- A **generic type** is parameterized: `List<T>`, `Map<K,V>`, `Optional<T>`. You instantiate it (`List<String>`) and it becomes a concrete type you can make values of.
- A **generic function/method** is parameterized: `first<T>`, `swap<T>`, `map<A,B>`. You call it (often with inference) and the type parameter is resolved per call.

A generic *method* can live inside a non-generic class, and a generic *type* can have non-generic methods. They're orthogonal:

```text
class Box<T> {            // generic TYPE, parameter T
    value: T
    get(): T { ... }      // non-generic method (uses the class's T)
    <U> map(f): Box<U>    // generic METHOD, its own parameter U
}
```

### 5. Type Inference: You Rarely Write `<T>` Explicitly

Modern languages infer the type argument from the values you pass. You write:

```text
let xs = listOf(1, 2, 3)     // compiler infers List<int>
let x  = first(xs)            // compiler infers T = int, x has type int
```

You *can* write it explicitly (`first<int>(xs)`) when inference fails or you want to be clear, but usually you don't. This is why generics feel lightweight in practice — the `<T>` is mostly invisible at the call site.

### 6. A First Taste of Bounds (Constraints)

Sometimes "any type at all" is *too* free. If you want `max<T>(a, b)`, you need to *compare* `a` and `b` — but an unbounded `T` can't be compared. So you **bound** the type parameter: "T must be a type that supports comparison."

```text
max<T: Comparable>(a: T, b: T) -> T { return a > b ? a : b }
```

Now `T` can be any *comparable* type, and inside the body you're allowed to use `>`. This is **bounded polymorphism**, and it sits on the boundary between parametric polymorphism (uniform) and ad-hoc polymorphism (per-type behavior, via the comparison operation). Bounds get a full treatment in the dedicated bounded-polymorphism topic; here, just know that an *unbounded* `T` can do almost nothing, and a *bounded* `T` can do exactly what the bound permits.

---

## Real-World Analogies

| Concept | Real-world thing |
|---------|------------------|
| **Generic type `Box<T>`** | A cardboard shipping box. The same box ships books, shoes, or mugs — it doesn't care what's inside, it just holds and protects. |
| **Type parameter `<T>`** | The label slot on the box: "Contents: ____." You fill it in per shipment. |
| **Type argument** | What you write on the label: "Contents: Books." |
| **Uniform behavior** | The postal system moves the box from A to B *identically* regardless of contents. It physically cannot open it to special-case the route based on what's inside. |
| **`Object`-everything (no generics)** | Shipping everything in unlabeled identical boxes. At the destination, you must *guess and open* each one to find out what it is — and sometimes guess wrong. |
| **Copy-paste per type (no generics)** | Building a custom, single-purpose box for books, another for shoes, another for mugs. Works, but a colossal waste, and a flaw in the design repeats in all of them. |
| **Bounded type parameter** | "This box only ships *fragile* items" — a restriction that lets the shipper assume something (add padding) it couldn't assume for arbitrary contents. |
| **Type inference** | The clerk reads the contents and fills in the label for you, so you don't have to. |
| **Boxing a value type** | Putting a single loose coin into a small protective sleeve so it can travel through the same pipe as everything else. Small overhead, lets it be handled uniformly. |
| **Cast / `ClassCastException`** | Opening an unlabeled box expecting shoes and finding a live snake. The crash. |

---

## Mental Models

### The Fill-in-the-Blank Model

A generic is a piece of code with a *blank* where a type goes. `List<__>`, `first<__>(...)`. The compiler fills the blank with whatever concrete type you use it with. One template, many fillings. Everything else about generics is a refinement of "what can you write, and what can the compiler do, when there's a blank in the type."

### The Opaque-Box Model (for uniformity)

Inside a generic function, a value of type `T` is an **opaque box** with no label and no openable lid. You can pick it up, set it down, hand it to someone, put it in a bigger box — but you cannot open it or ask what's inside. This is *why* the same code works for all types: it never depends on the contents. When you *do* need to look inside (compare, print, construct), you must add a **bound** — which is like stamping "these boxes are guaranteed to contain comparable things" so you're allowed to peek in the one specific way the stamp promises.

### The "Stamp Out a Copy" vs. "One Shared Machine" Model (preview of implementation)

There are two ways a compiler can make `Stack<T>` work for many types. Either it **stamps out a separate copy** of the code for `Stack<int>`, `Stack<String>`, etc. (fast, but more code), or it builds **one shared machine** that treats every element as a generic box and runs the same code for everyone (smaller, but slower because of the boxing). You don't need this yet — `middle.md` is entirely about this choice — but keep the two pictures in your head: *specialize-per-type* vs. *one-size-fits-all*.

---

## Code Examples

We solve the same tiny problems in each language: a generic `Box<T>` container and a generic `first` function. Watch how similar they look — the concept transfers everywhere even though the syntax differs.

### Java

```java
// Generic class
class Box<T> {
    private final T value;
    Box(T value) { this.value = value; }
    T get() { return value; }
}

// Generic method (the <T> before the return type declares the parameter)
static <T> T first(java.util.List<T> items) {
    return items.get(0);
}

public class Demo {
    public static void main(String[] args) {
        Box<String> b = new Box<>("hello");   // T = String, inferred via <>
        String s = b.get();                     // no cast needed — returns String

        var nums = java.util.List.of(10, 20, 30);
        int n = first(nums);                    // T inferred as Integer
        System.out.println(s + " " + n);
    }
}
```

The `<T>` on `class Box<T>` and on `static <T> T first(...)` declares the parameter. `Box<String>` instantiates it. No casts anywhere — that's the win over an `Object`-based box.

### C#

```csharp
class Box<T> {
    private readonly T value;
    public Box(T value) { this.value = value; }
    public T Get() => value;
}

static T First<T>(System.Collections.Generic.List<T> items) => items[0];

class Demo {
    static void Main() {
        var b = new Box<string>("hello");
        string s = b.Get();
        var nums = new System.Collections.Generic.List<int> { 10, 20, 30 };
        int n = First(nums);     // T inferred as int — and note: int is NOT boxed in C#
        System.Console.WriteLine($"{s} {n}");
    }
}
```

C# looks like Java but has one deep difference we'll meet later: `List<int>` stores real `int`s with no boxing, because C# generics are *reified* (the runtime actually knows `T = int`). Hold that thought.

### Go (generics, Go 1.18+)

```go
package main

import "fmt"

// Generic type
type Box[T any] struct {
	value T
}

func (b Box[T]) Get() T { return b.value }

// Generic function. `any` means "no constraint" (unbounded T).
func First[T any](items []T) T {
	return items[0]
}

func main() {
	b := Box[string]{value: "hello"}
	s := b.Get()
	nums := []int{10, 20, 30}
	n := First(nums) // T inferred as int
	fmt.Println(s, n)
}
```

Go uses square brackets `[T any]`. Before Go 1.18, you'd have written `First(items []interface{}) interface{}` and cast the result — exactly Option B above, with all its dangers. Generics removed that pain.

### TypeScript

```typescript
class Box<T> {
  constructor(private readonly value: T) {}
  get(): T { return this.value; }
}

function first<T>(items: T[]): T {
  return items[0];
}

const b = new Box<string>("hello");
const s: string = b.get();
const nums = [10, 20, 30];
const n: number = first(nums); // T inferred as number
console.log(s, n);
```

TypeScript's generics are *compile-time only* — they vanish entirely when compiled to JavaScript (full erasure). They exist purely to help the type checker; at runtime there is no `T` at all.

### Rust

```rust
struct Box2<T> {
    value: T,
}

impl<T> Box2<T> {
    fn get(self) -> T { self.value }
}

fn first<T: Clone>(items: &[T]) -> T {
    items[0].clone()
}

fn main() {
    let b = Box2 { value: String::from("hello") };
    let s = b.get();
    let nums = vec![10, 20, 30];
    let n = first(&nums);  // T inferred as i32
    println!("{} {}", s, n);
}
```

Rust generates a *specialized copy* of `Box2` and `first` for each concrete type (monomorphization) — so `first::<i32>` and `first::<String>` are separate compiled functions, each as fast as if you'd hand-written it. (`Clone` is a bound; an unbounded `T` couldn't be copied out of the slice.)

### C++ (templates)

```cpp
#include <iostream>
#include <vector>

template <typename T>
struct Box {
    T value;
    T get() const { return value; }
};

template <typename T>
T first(const std::vector<T>& items) {
    return items[0];
}

int main() {
    Box<std::string> b{"hello"};
    auto s = b.get();
    std::vector<int> nums{10, 20, 30};
    int n = first(nums);          // T deduced as int
    std::cout << s << " " << n << "\n";
}
```

C++ templates also stamp out a specialized copy per type (like Rust). The compiler generates `Box<int>`, `Box<std::string>`, `first<int>`, etc. — each fully specialized and inlinable.

> **Takeaway:** Six languages, six syntaxes (`<T>`, `[T any]`, `template<typename T>`), but **one idea**: write the code once, leave the type as a parameter, let the compiler fill it in. Whether the compiler stamps out copies (Rust, C++) or shares one implementation (Java, TS, early Go) is an implementation detail you'll study next — but the *programming model* is the same everywhere.

---

## Pros & Cons

| Aspect | Pros | Cons |
|--------|------|------|
| **Reuse** | Write a container or algorithm **once**, use it for every type. No copy-paste. | The generic code is slightly more abstract to read than a concrete version. |
| **Type safety** | The compiler enforces that a `List<String>` holds only `String`s. No runtime casts, no `ClassCastException`. | You sometimes fight the compiler when your design needs bounds or variance you haven't learned yet. |
| **Clarity at call site** | `Map<UserId, User>` documents intent far better than `Map` (of what to what?). | Long generic signatures (`Map<String, List<Pair<K, V>>>`) can get noisy. |
| **Performance (specialized)** | In Rust/C++/C# value types, generics are *zero-cost* — as fast as hand-written code, no boxing. | In Java/erased systems, generic code over value types often **boxes** (heap allocation, indirection). |
| **Maintenance** | A bug fixed in the generic is fixed for all instantiations at once. | Error messages for misused generics can be cryptic (especially C++ templates). |
| **Vs. `Object`/`any`** | Strictly safer and clearer. | Migrating an old `Object`-based API to generics can be a large change. |

---

## Use Cases

Generics are the right tool when:

- **You're writing a container or collection.** Lists, maps, sets, stacks, queues, trees, caches — anything that *holds other values* should be generic in the element type. This is the canonical use.
- **You're writing an algorithm that doesn't care about the element type.** Sort, reverse, find, map, filter, fold — these work uniformly over any element (sometimes with a bound like "comparable").
- **You're wrapping or transforming a value.** `Optional<T>`, `Result<T, E>`, `Future<T>`, `Box<T>`, `Cache<K, V>` — wrappers that add behavior around any payload.
- **You want to eliminate casts.** Any place you currently take or return `Object`/`any`/`interface{}` and cast is a candidate for a type parameter.
- **You want one API to serve many types safely.** A serialization function `serialize<T>(value: T)`, a builder `Builder<T>`, a repository `Repository<Entity>`.

Generics are *not* the right tool when:

- **The behavior genuinely differs per type.** If `area()` means something different for `Circle` and `Square`, that's *subtype* polymorphism (override a method), not parametric. Don't force it into `<T>`.
- **You only ever use one concrete type.** A `Stack<int>` you never reuse for anything else may as well be a plain `IntStack` for clarity. (Though using the standard generic one costs nothing.)
- **You're tempted to inspect `T` at runtime.** If you find yourself wanting `if T == int`, you've left parametric polymorphism and probably want overloading, an interface, or a different design.

---

## Coding Patterns

### Pattern 1: The Generic Container

The bread-and-butter pattern. Hold the type parameter as a field; expose typed operations.

```java
class Stack<T> {
    private final java.util.List<T> items = new java.util.ArrayList<>();
    void push(T item) { items.add(item); }
    T pop() { return items.remove(items.size() - 1); }
    boolean isEmpty() { return items.isEmpty(); }
}
```

`Stack<String>` and `Stack<Integer>` share this one definition, each fully type-safe.

### Pattern 2: The Identity / Pass-Through Function

When you only move a value, not inspect it, leave `T` unbounded.

```typescript
function identity<T>(x: T): T { return x; }
function pair<A, B>(a: A, b: B): [A, B] { return [a, b]; }
```

These are maximally reusable *because* they do nothing type-specific.

### Pattern 3: Prefer a Type Parameter Over `Object`/`any`

Whenever you're about to write `Object` or `any` as a parameter or return type, ask: "could this be `<T>` instead?" Usually yes, and it's strictly better.

```text
// Before (loses type, needs cast):
Object firstOf(List items)           →  String s = (String) firstOf(list);

// After (keeps type, no cast):
<T> T firstOf(List<T> items)         →  String s = firstOf(list);
```

### Pattern 4: Let Inference Work; Annotate Only When Needed

Write `first(xs)`, not `first<String>(xs)`, unless the compiler can't infer it (e.g. an empty collection where there's nothing to infer from). Over-annotating is noise.

### Pattern 5: Name Parameters Meaningfully Past the Basics

`<T>` is fine for a single all-purpose type. For maps and richer types, prefer `<K, V>`, `<Key, Value>`, `<Element>` — names that say what the parameter *is*.

---

## Best Practices

- **Reach for generics before `Object`/`any`/`interface{}`.** The cast-everywhere style is the problem generics solve. If you're casting, you probably wanted a type parameter.
- **Keep unbounded `T` truly unbounded.** If your function works for *any* type, don't accidentally constrain it. The fewer the requirements on `T`, the more reusable the code.
- **Add a bound only when you actually use a capability.** Need to compare? Bound to `Comparable`. Need to print? Bound to whatever the language requires. Don't add bounds "just in case" — they restrict callers.
- **Lean on type inference.** Specify type arguments explicitly only when inference fails or clarity demands it.
- **Use conventional parameter names.** `T`, `E`, `K`, `V`, `R` — your readers know these. Reserve descriptive names (`<Entity>`) for when it genuinely helps.
- **Don't try to inspect or construct `T` at the junior level.** `new T()`, `T.class`, `instanceof T` either don't compile or have surprising caveats (especially under erasure — see pitfalls). If you need that, you've hit an advanced corner; ask for help or use a different design.
- **Make containers generic, behaviors polymorphic.** "A list *of* X" → generic. "An X that *behaves* like a shape" → interface/subtype. Don't mix them up.

---

## Edge Cases & Pitfalls

- **Casting instead of parameterizing.** The classic anti-pattern: taking `Object` and casting back. It compiles, then throws `ClassCastException` at runtime when the actual type isn't what you assumed. Generics move that error to *compile time*, where it belongs.
- **Mixing raw and generic types (Java).** Using a `List` (raw) where a `List<String>` is expected disables the type checks and produces "unchecked" warnings — and re-opens the door to runtime `ClassCastException`. Never use raw types in new code.
- **Expecting `T` to have methods it might not.** `T.toString()` is usually fine (everything has it in many languages), but `T.compareTo`, `T < T`, `T()` (construction) require a *bound* or won't compile. The compiler is protecting you: an unbounded `T` could be *any* type.
- **`new T()` doesn't work in many languages.** In Java (and others using erasure), the runtime doesn't know what `T` is, so it can't construct one. Workarounds (factories, passing a `Class<T>`) exist but are advanced. In C++/Rust/C# the story differs — another preview of the implementation differences ahead.
- **Boxing surprises in Java/erased systems.** `List<Integer>` stores *boxed* `Integer` objects on the heap, not raw `int`s. For large numeric data this is a real performance and memory cost. C#/Rust/C++ don't pay it for value types. (Detail in `middle.md`/`professional.md`.)
- **Assuming `<T>` exists at runtime.** In Java, TypeScript, and Go's design lineage, the type argument is partly or fully *erased* — at runtime you often *can't* ask "what was `T`?" `instanceof List<String>` is illegal in Java for this reason. In C# you *can* (`typeof(T)`), because its generics are reified. Don't assume one model.
- **Over-genericizing.** Not everything needs `<T>`. If a function only ever takes a `User`, making it `<T>` adds noise and obscures intent. Generics are for code that's genuinely type-agnostic.
- **Confusing "generic" with "inheritance."** `Box<Animal>` is *not* a supertype of `Box<Cat>` in most languages — even though `Animal` is a supertype of `Cat`. This surprises everyone at first. The reason (variance) is its own topic; for now, just know `List<Cat>` is *not* automatically a `List<Animal>`, and trying to treat it as one won't compile.

---

## Summary

- **Generics** let you write a function or type **once** with a **type parameter** (`<T>`) standing in for "some type you supply later." The compiler fills the blank when you use it.
- The formal name is **parametric polymorphism**: code *parameterized by a type variable* that behaves **identically for every type**.
- They solve a real problem with three bad pre-generics options: copy-paste per type (wasteful), `Object`/`any` everywhere (unsafe, needs casts and crashes at runtime), or do nothing. Generics give the **reuse of the second with the safety of the first**.
- The defining property is **uniformity**: a generic function can't inspect or special-case `T`, so it must treat values as **opaque boxes** — which is exactly why it's safe and reusable.
- A **generic type** (`List<T>`) and a **generic function** (`first<T>`) are distinct, orthogonal ideas.
- **Type inference** means you rarely write `<T>` explicitly at call sites — generics feel lightweight in practice.
- An **unbounded** `T` can do almost nothing; a **bounded** `T` (`<T: Comparable>`) can do exactly what the bound allows. (Bounds are their own topic.)
- The same idea appears in every typed language: Java/C#/TS `<T>`, Go `[T any]`, Rust/C++ generics & templates. The syntax differs; the model is one.
- Under the hood, compilers either **stamp out a specialized copy per type** (Rust, C++ — fast, more code) or **share one implementation** treating values generically (Java, TS — smaller, slower/boxing). That choice — and its trade-offs — is the heart of the next level.
- A junior's #1 upgrade: **stop casting `Object`/`any`; introduce a `<T>` instead.** Shorter, safer, and faster, all at once.
