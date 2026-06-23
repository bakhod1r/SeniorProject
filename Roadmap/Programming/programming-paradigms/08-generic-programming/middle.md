# Generic Programming — Middle Level

> **Roadmap:** [Programming Paradigms](../README.md) → Generic Programming
> *Unconstrained `T` can only be moved around. The moment your algorithm needs the type to* do *something — compare, add, print — you need a constraint. Constraints are where generics become useful, and they're the dividing line between three different kinds of polymorphism.*

---

## Table of Contents

1. [Introduction](#introduction)
2. [Prerequisites](#prerequisites)
3. [Three Kinds of Polymorphism](#three-kinds-of-polymorphism)
4. [Bounded Type Parameters & Constraints](#bounded-type-parameters--constraints)
5. [The STL Design — Containers + Iterators + Algorithms](#the-stl-design--containers--iterators--algorithms)
6. [Type Inference for Generics](#type-inference-for-generics)
7. [Variance — An Introduction](#variance--an-introduction)
8. [Putting It Together — A Constrained Generic Algorithm](#putting-it-together--a-constrained-generic-algorithm)
9. [Common Mistakes](#common-mistakes)
10. [Summary](#summary)
11. [Further Reading](#further-reading)
12. [Related Topics](#related-topics)

---

## Introduction

> Focus: **How does it actually work, and what are the moving parts?**

At the [junior](junior.md) level you learned to write `max<T>` and `List<T>` — one definition, many types. But there was a quiet cheat in `max`: it needed `T extends Comparable<T>`. An unconstrained `T` is nearly useless. If the compiler knows *nothing* about `T`, the only things you can legally do with a `T` value are move it around: store it, return it, pass it on. You can't call `a > b`, because some types have no `>`. You can't call `a.length()`, because some types have no length.

So real generic programming is a negotiation: **the algorithm states what it needs from the type, and the compiler admits only types that provide it.** That "what it needs" is a **constraint** (Java calls it a *bound*, C++20 a *concept*, Rust a *trait bound*, Go a *constraint*). This level is about that negotiation — and about placing it correctly among the *three kinds of polymorphism* it's easy to confuse. We'll also look at the design that made generic programming famous: the **STL's** separation of containers, iterators, and algorithms, where any algorithm runs over any container.

> **The mindset shift:** generics aren't "code that ignores types." They're "code that states its *minimum requirement* on a type and works for everything meeting it." Design the requirement well and one algorithm covers a whole family of types; design it badly and you get cryptic errors or a leaky abstraction.

---

## Prerequisites

- **Required:** The [junior](junior.md) level — type parameters, instantiation, generic functions and containers, and why generics beat `Object`/`interface{}`.
- **Required:** Comfort reading **Java**, **Go**, **C++**, and **Rust** generics syntax. A **Haskell** typeclass appears once.
- **Helpful:** A passing familiarity with interfaces/traits — constraints are usually *expressed* as "T must implement this interface/trait."
- **Background:** The formal type-theory names (parametric polymorphism, bounded polymorphism, variance) live in [Type Systems](../../language-internals/type-systems/); this page stays at the *programming-style* level and cross-links there.

---

## Three Kinds of Polymorphism

"Polymorphism" means "one name, many forms." There are three distinct mechanisms, and conflating them is a classic muddle. Generics are **one** of them.

| Kind | Mechanism | One body or many? | Example |
|---|---|---|---|
| **Parametric** | Type parameters (generics) | **One** body, works uniformly for all types | `max<T>`, `List<T>`, `map` |
| **Ad-hoc** (overloading) | Several definitions, same name, chosen by argument types | **Many** bodies, picked at compile time | `print(int)` vs `print(String)`; operator `+` for ints vs strings |
| **Subtype** (inclusion) | A supertype reference holds any subtype; dispatch at runtime | **One** call site, many implementations behind it | `Shape.area()` dispatching to `Circle`/`Square` |

```java
// PARAMETRIC: one body, every type. The body never names a concrete type.
static <T> int size(List<T> xs) { return xs.size(); }

// AD-HOC (overloading): two SEPARATE bodies; the compiler picks by type.
static void show(int n)    { System.out.println("int " + n); }
static void show(String s) { System.out.println("str " + s); }

// SUBTYPE: one call site; the runtime picks the implementation.
Shape s = new Circle();
s.area();   // calls Circle.area() — chosen at run time by the object's type
```

The crucial distinction: **parametric polymorphism is *uniform*** — the *same code* runs for every type, so it can't depend on type-specific behavior unless a constraint grants it. **Ad-hoc polymorphism is *non-uniform*** — you write a *different* body per type, so each can do something type-specific. **Subtype polymorphism** defers the choice to *run time* via a supertype.

Generic programming sits primarily on **parametric** polymorphism, but it *leans on* the others: a constraint like `T extends Comparable` is how a uniform parametric algorithm reaches type-specific behavior (`compareTo`) — effectively borrowing ad-hoc/subtype dispatch to fill the "what `T` can do" hole. Haskell makes this explicit: its **typeclasses** are *constrained parametric polymorphism* — `(Ord a) => a -> a -> a` is a parametric function whose `Ord a` constraint supplies the comparison.

---

## Bounded Type Parameters & Constraints

A **bound** / **constraint** narrows "any type `T`" to "any type `T` that supports *these operations*." It does two jobs at once: it **lets the algorithm use** those operations on `T`, and it **rejects** types that don't qualify — at compile time, with (ideally) a clear message.

**Java — `extends` bound:**

```java
// T must implement Comparable<T>, so compareTo is available inside.
static <T extends Comparable<T>> T max(T a, T b) {
    return a.compareTo(b) >= 0 ? a : b;   // legal: the bound guarantees compareTo
}
max(3, 7);                 // ok: Integer is Comparable
// max(new Object(), ...); // COMPILE ERROR: Object isn't Comparable
```

**Go — interface as constraint:**

```go
// A constraint is an interface; constraints.Ordered permits <, >, ==.
import "cmp"

func Max[T cmp.Ordered](a, b T) T {
    if a > b { return a }   // legal: Ordered permits >
    return b
}
```

**C++20 — concepts:**

```cpp
#include <concepts>
// requires the expression a > b to be valid and bool-like.
template <typename T>
    requires std::totally_ordered<T>
T max(T a, T b) { return a > b ? a : b; }
```

**Rust — trait bounds:**

```rust
// T must implement PartialOrd, which provides comparison operators.
fn max<T: PartialOrd>(a: T, b: T) -> T {
    if a >= b { a } else { b }
}
```

**Haskell — typeclass constraint:**

```haskell
-- (Ord a) => is the constraint: a must be an instance of Ord.
maxOf :: (Ord a) => a -> a -> a
maxOf a b = if a >= b then a else b
```

The same idea, five spellings. Each says: *"T can be anything, **provided** it offers comparison."* Before C++20, C++ had no formal way to *state* this — template constraints were implicit ("if it compiles, it works"), which produced infamously unreadable error messages. C++20 **concepts** exist precisely to make the requirement explicit and the errors legible — designing good concepts is a [senior](senior.md)-level skill. Constraints can also bundle several requirements (`T extends Comparable<T> & Serializable`, or a Go constraint interface listing multiple methods).

---

## The STL Design — Containers + Iterators + Algorithms

The C++ **Standard Template Library** is the canonical demonstration of generic programming, and its design is worth studying even if you never write C++. Its insight: **decouple algorithms from containers** so that *M* algorithms and *N* containers need *M + N* pieces of code, not *M × N*.

It does this with three orthogonal concepts:

- **Containers** (`vector`, `list`, `map`, `set`) — generic over the element type; they own the *storage*.
- **Iterators** — a generic abstraction of "a position in a sequence," with operations like advance (`++`) and dereference (`*`). They are the *glue*.
- **Algorithms** (`sort`, `find`, `accumulate`, `copy`) — generic over *iterators*, not over containers. An algorithm asks only for "a begin and an end position," never "a vector" or "a list."

```cpp
std::vector<int> v{3, 1, 2};
std::list<std::string> l{"c", "a", "b"};

std::sort(v.begin(), v.end());          // sorts a vector
std::find(l.begin(), l.end(), "a");     // searches a list — SAME find
```

Because `find` is written against *iterators*, not against any specific container, the **one** `find` works on a `vector`, a `list`, a `deque`, an array, even a stream — anything that can hand out iterators. Add a new container that exposes iterators, and *every* existing algorithm works on it for free. Add a new algorithm over iterators, and it works on *every* existing container. That `M + N` instead of `M × N` is the economic argument for generic programming, made concrete.

> **Key insight:** the iterator is the *interface* that lets generic algorithms ignore the container's internals. This is generic programming's version of "program to an interface": the algorithm is parameterized over a *concept* (iterator) rather than a concrete type, so it composes with anything satisfying that concept. Java's `Iterator<T>`/`Iterable<T>`, Rust's `Iterator` trait, and Go's `range`-over-func iterators are the same idea in other languages.

---

## Type Inference for Generics

You rarely write type arguments explicitly, because the compiler **infers** them from the call. Inference is what makes generics feel lightweight rather than ceremonial.

```rust
let xs = vec![1, 2, 3];     // Rust infers Vec<i32> from the literals
let n = max(2.0, 3.0);      // T = f64, inferred from the arguments
```

```go
nums := []int{1, 2, 3}
m := Max(nums[0], nums[1])  // T = int, inferred — no Max[int](...) needed
```

```java
var list = new ArrayList<String>();    // var + diamond <> infer the rest
Map<String, List<Integer>> m = new HashMap<>();  // <> = "same as the left"
```

Inference flows from the *arguments' types* to the *type parameters*. When the compiler can't see enough to decide — a generic function whose type parameter appears only in the *return* type, say — you must supply it explicitly (`Collections.<String>emptyList()`, `Vec::<i32>::new()`, `Max[int](...)`). The limits of inference differ by language: Rust and C++ infer aggressively; Go 1.18's inference was initially limited (sometimes forcing explicit `[T]`) and has since improved; Java's is solid for arguments but weaker across long generic chains. The skill is knowing *when* inference will give up so you can annotate without flailing.

---

## Variance — An Introduction

Here's a question that trips up nearly everyone. If `Cat` is a subtype of `Animal`, is `List<Cat>` a subtype of `List<Animal>`?

**Intuition says yes. The type system usually says no** — and for a good reason:

```java
List<Cat> cats = new ArrayList<>();
List<Animal> animals = cats;     // IF this were allowed…
animals.add(new Dog());          // …you could put a Dog into a list of Cats.
Cat c = cats.get(0);             // …and then read it back as a Cat. Boom.
```

Allowing `List<Cat>` to *be* a `List<Animal>` would let you smuggle a `Dog` into the cat list through the `Animal` view, breaking type safety. So by default, generic types are **invariant**: `List<Cat>` and `List<Animal>` are simply *different, unrelated types*, regardless of how `Cat` and `Animal` relate.

**Variance** is the rule for *when* the subtyping of type arguments carries over to the generic type:

- **Invariant** (the safe default): `G<Cat>` and `G<Animal>` are unrelated. Java collections, most generics.
- **Covariant** (`out` / `? extends`): if `Cat <: Animal` then `G<Cat> <: G<Animal>`. Safe when the type is only **produced/read** (a read-only source). Java: `List<? extends Animal>` — you can *read* `Animal`s out, but can't `add` (the compiler forbids it, closing the hole above).
- **Contravariant** (`in` / `? super`): the relationship flips. Safe when the type is only **consumed/written** (a sink). Java: `Comparator<? super Cat>` — a comparator that can compare `Animal`s can certainly compare `Cat`s.

The mnemonic, **PECS** ("Producer `extends`, Consumer `super`"), captures the safe-direction rule for Java wildcards. The deep "why" — that read-only positions can widen and write-only positions can narrow — is covered in depth at the [senior](senior.md) level and formally in [Type Systems → Variance](../../language-internals/type-systems/06-variance/). For now, the takeaway: **generic types are invariant by default for safety, and variance annotations let you safely relax that when the type only produces, or only consumes, its parameter.**

---

## Putting It Together — A Constrained Generic Algorithm

A single example tying the threads together: a generic "max element of a collection," constrained, inferred, and container-agnostic.

```rust
// One algorithm: max of any iterable of any comparable type.
// - parametric over T (the element)
// - constrained: T: PartialOrd  (so we can compare)
// - container-agnostic: takes an IntoIterator, like an STL algorithm
fn max_of<T: PartialOrd, I: IntoIterator<Item = T>>(items: I) -> Option<T> {
    let mut it = items.into_iter();
    let mut best = it.next()?;          // None if empty
    for x in it {
        if x > best { best = x; }       // legal because T: PartialOrd
    }
    Some(best)
}

max_of(vec![3, 1, 2]);                  // T = i32, from a Vec
max_of(vec!["b", "a", "c"]);            // T = &str, from a Vec
// max_of(vec![3, 1, 2].into_iter().map(...))  // works over any iterator too
```

Every middle-level idea is here: **parametric** polymorphism (`T`), a **constraint** (`PartialOrd`, granting `>`), **type inference** (`T` and `I` deduced from the argument), and the **STL-style decoupling** (it takes *any* `IntoIterator`, not a specific container — `find`/`sort` design in miniature). This is what "an algorithm parameterized over its types" looks like in practice.

---

## Common Mistakes

- **Forgetting the constraint, then being surprised you can't use `>` / `.field`.** Unconstrained `T` supports only move-it-around operations. If you need to compare, add, or call a method, *state the constraint* — don't reach for `Object`/`any` and a cast to escape it.
- **Confusing overloading with generics.** Two `print` bodies (one per type) is *ad-hoc* polymorphism, not generics. Generics are *one* body for all types. If you're tempted to write per-type bodies, ask whether the behavior is truly the same (→ generic) or genuinely differs (→ overload/trait).
- **Expecting `List<Cat>` to be a `List<Animal>`.** Generics are invariant by default. Reaching for it without `? extends`/`? super` (or `out`/`in`) gets a compile error that confuses people who haven't met variance. Learn PECS.
- **Adding to a `? extends` (covariant) collection.** You can *read* from a producer but not *write* to it — the compiler forbids `list.add(x)` on a `List<? extends Animal>` precisely to keep the `Dog`-in-cats hole closed.
- **Over-constraining.** Requiring `Serializable & Comparable & Cloneable` when the algorithm only ever compares shrinks the set of usable types for no benefit. State the *minimum* the algorithm actually needs — no more.
- **Leaning on inference past its limits.** When a type parameter appears only in the return type, inference can't see it; annotate explicitly instead of fighting an "cannot infer type" error.

---

## Summary

Real generic programming hinges on **constraints** (bounds / concepts / trait bounds): an unconstrained `T` can only be moved around, so the algorithm must declare the *minimum operations* it needs from the type, and the compiler admits only types that provide them. Generics are **parametric** polymorphism — *one* body, uniform across all types — which is distinct from **ad-hoc** polymorphism (overloading: many bodies, chosen by type) and **subtype** polymorphism (one call site, runtime dispatch); constraints are how a parametric algorithm reaches type-specific behavior. The **STL** is the design lesson: by parameterizing algorithms over **iterators** rather than containers, *M* algorithms and *N* containers cost *M + N* instead of *M × N*, and any new container or algorithm composes with all the others for free. **Type inference** keeps all this lightweight by deducing type arguments from the call. And **variance** explains why `List<Cat>` is *not* a `List<Animal>` by default (invariance for safety), with covariance (`? extends`, producers) and contravariance (`? super`, consumers) as the safe ways to relax it — the PECS rule in one breath.

---

## Further Reading

- Bjarne Stroustrup, *The C++ Programming Language*, the templates and concepts chapters — generic programming from the language's designer.
- Andrei Alexandrescu, *Modern C++ Design* — generic programming pushed to its limits (policy-based design, traits).
- The Java Tutorials, *Bounded Type Parameters* and *Wildcards* — `extends` bounds and PECS, with the Cat/Animal example worked out.
- Go blog, "Type Parameters Proposal" and the `cmp`/`slices` package docs — constraints as interfaces, inference limits.
- Philip Wadler & Stephen Blott, *How to make ad-hoc polymorphism less ad hoc* — the paper that introduced typeclasses (constrained parametric polymorphism).

---

## Related Topics

- [`junior.md`](junior.md) — type parameters, instantiation, generic containers, generics vs `Object`.
- [`senior.md`](senior.md) — monomorphization vs type erasure vs Go's approach, variance in depth, concept/error-message design, the cost of abstraction.
- [`professional.md`](professional.md) — generic programming at library scale, the STL/Boost lineage, higher-kinded types.
- [Type Systems → Bounded Polymorphism](../../language-internals/type-systems/07-bounded-polymorphism/) — the formal account of constraints/bounds.
- [Type Systems → Variance](../../language-internals/type-systems/06-variance/) — covariance/contravariance, formally.
- [Type Systems → Subtyping & Liskov](../../language-internals/type-systems/08-subtyping-and-liskov/) — subtype polymorphism, the third kind.
- [Functional Programming](../../code-craft/functional-programming/) — typeclasses and constrained parametric polymorphism in the FP tradition.
