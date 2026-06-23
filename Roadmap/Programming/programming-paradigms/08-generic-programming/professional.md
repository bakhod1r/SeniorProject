# Generic Programming — Professional Level

> **Roadmap:** [Programming Paradigms](../README.md) → Generic Programming
> *Generic programming as a paradigm is not "use `<T>`." It's a design discipline: discover the* minimal requirements *an algorithm places on its inputs, name those requirements as concepts, and build a library where any type meeting a concept composes with every algorithm written against it. The STL, Boost, and Rust's trait system are three generations of that idea.*

---

## Table of Contents

1. [Introduction](#introduction)
2. [Designing Reusable Generic APIs](#designing-reusable-generic-apis)
3. [The STL → Boost → Concepts Lineage](#the-stl--boost--concepts-lineage)
4. [Concept-Based Design & C++20 Concepts](#concept-based-design--c20-concepts)
5. [Rust's Trait System as the Generic-Programming Backbone](#rusts-trait-system-as-the-generic-programming-backbone)
6. [Higher-Kinded Types and Their Absence](#higher-kinded-types-and-their-absence)
7. [Generic Code, ABI, and Compile-Time Cost](#generic-code-abi-and-compile-time-cost)
8. [Template Metaprogramming — The Gateway to Compile-Time Computation](#template-metaprogramming--the-gateway-to-compile-time-computation)
9. [Common Mistakes](#common-mistakes)
10. [Summary](#summary)
11. [Further Reading](#further-reading)
12. [Related Topics](#related-topics)

---

## Introduction

> Focus: **How is this done at library scale, and where are the frontiers?**

By the [senior](senior.md) level you can reason about how generics compile and what they cost. The professional concern is different: **designing generic *libraries*** that other people build on — where the abstractions must be discoverable, composable, hard to misuse, and stable across decades and ABIs. This is where generic programming stops being a language feature and becomes a *design methodology*, the one Alexander Stepanov articulated when he built the STL: study a family of concrete algorithms, factor out the *minimal* requirements each places on its operands, name those requirements as **concepts**, and you get a library where the cross-product of algorithms and types "just works."

This level traces that methodology through its three big implementations — the **STL/Boost** lineage in C++, **Rust's trait system**, and the typeclass tradition it descends from — and confronts the hard parts: **higher-kinded types** (and why mainstream languages mostly lack them), the **ABI and compile-time tax** generic code imposes at scale, and **template metaprogramming** as the door from generic programming into full compile-time computation. Throughout, remember the roadmap's division of labor: the *mechanics* of type systems (kinds, variance, inference algorithms) live in [Language Internals → Type Systems](../../language-internals/type-systems/); **this** topic is about the *style of programming* and the *library design* those mechanics enable.

> **The mindset shift:** the unit of generic programming at this level is not the function — it's the **concept** (the named bundle of requirements). Get the concepts right and the algorithms and types compose for free; get them wrong and no amount of `<T>` will save the library.

---

## Designing Reusable Generic APIs

A library-grade generic API is judged by how well it balances four forces, often in tension:

- **Generality** — works for as many types as genuinely make sense.
- **Constraint precision** — demands *exactly* the operations it uses, no more (over-constraining locks out valid types; under-constraining defers errors into the body and weakens guarantees).
- **Inference-friendliness** — callers shouldn't have to spell out type arguments; the design should let inference flow.
- **Diagnosability** — a misuse should fail at the boundary with a message naming the unmet requirement, not 30 frames deep.

Concrete design moves the best generic libraries share:

- **Parameterize over the smallest sufficient concept.** The STL's `sort` requires *random-access iterators* and a *strict weak ordering* — not "a `vector`." `accumulate` requires only *input iterators*. Each algorithm names the weakest concept that makes it correct, maximizing the set of usable types.
- **Separate the generic *interface* from a non-generic *core*** where it cuts code bloat (the "thin shell" / outlining pattern) — the generic wrapper does type plumbing, a monomorphic inner function does the work once per layout.
- **Provide both a function form and an interface/trait form** when callers' needs vary (the `http.Handler`/`http.HandlerFunc` lesson, generalized).
- **Make illegal states unrepresentable through the type parameters** — `Result<T, E>`, `NonEmpty<T>`, typed builders — so the generic types carry invariants, not just storage.
- **Keep variance honest** — expose covariant producers and contravariant consumers where the language supports declaration-site variance, so the API reads naturally without callers reaching for wildcards.

The deep skill is **requirement discovery**: writing the concrete algorithm first, then asking "what is the *least* I actually needed from the operands?" That question, repeated across a family of algorithms, *is* generic-library design.

---

## The STL → Boost → Concepts Lineage

Generic programming in the mainstream has a clear genealogy, and knowing it explains why C++ looks the way it does:

1. **The STL (Stepanov & Lee, 1994)** crystallized the methodology: **containers + iterators + algorithms**, decoupled, so *M* algorithms over *N* containers cost *M + N*. Its abstractions (iterator categories, ranges, function objects) were *concepts* in all but compiler-enforced form — they lived in documentation and convention, since C++98 templates couldn't state them.

2. **Boost (1999– )** became the proving ground for the next generation: type traits (`is_integral`, `enable_if`), SFINAE-based constraints, MPL (compile-time lists/algorithms), Boost.Concept_Check (a *library* emulation of concepts), and eventually **Boost.Hana** (heterogeneous compile-time computation). Boost is where C++ generic programming was pushed to its limits and where many ideas were prototyped before standardization (smart pointers, `optional`, `variant`, `any`, ranges all incubated there).

3. **C++20 Concepts & Ranges** finally gave the language *first-class* names for the requirements the STL always implied. `std::ranges::sort` takes a *range* (a concept) instead of a begin/end pair, and the iterator categories became real, checkable concepts (`std::random_access_range`). The 25-year arc from STL to Concepts is essentially: *the requirements were always there; the language slowly grew the ability to state and enforce them.*

This lineage is why "generic programming" in C++ carries connotations far beyond `<T>` — it means the Stepanov discipline of concept-driven, iterator-mediated, algorithm-centric library design.

---

## Concept-Based Design & C++20 Concepts

A **concept** is a named, compiler-checkable predicate on types — the formal version of "the requirements an algorithm places on its operands."

```cpp
#include <concepts>

// A concept: T is "Addable" if a + b is valid and yields something
// convertible back to T.
template <typename T>
concept Addable = requires(T a, T b) {
    { a + b } -> std::convertible_to<T>;
};

// Constrain an algorithm with it. Misuse fails HERE, naming Addable.
template <Addable T>
T sum(const std::vector<T>& xs) {
    T acc{};
    for (const auto& x : xs) acc = acc + x;
    return acc;
}
```

Concept-based design changes the *unit of reuse* from the function to the concept. Benefits that matter at library scale:

- **Errors at the boundary.** `sum(vector<NotAddable>)` reports "constraint `Addable` not satisfied," not a wall of instantiation noise. This single change is why concepts were the most-requested C++ feature for a decade.
- **Overloading on requirements.** You can provide a fast path for types modeling a stronger concept (`std::contiguous_range`) and a fallback for weaker ones, with the compiler selecting via concept *subsumption* — cleaner than the old `enable_if`/tag-dispatch machinery.
- **Self-documenting contracts.** `template <std::sortable I> void sort(I, I)` *states* what it needs; the concept name is the documentation.

The same idea appears as **Rust trait bounds**, **Swift protocols (with `where`)**, **Haskell typeclasses**, and **Go constraint interfaces** — all are "named requirement sets used to constrain parametric code." Concept-driven design is the cross-language essence of professional generic programming; C++20 just made C++'s version explicit and checkable at last.

---

## Rust's Trait System as the Generic-Programming Backbone

Rust took the typeclass idea and made it the **center** of the language. A trait is simultaneously the constraint mechanism, the dynamic-dispatch mechanism, and the operator-overloading mechanism — generic programming, subtyping-ish polymorphism, and ad-hoc polymorphism unified under one feature.

```rust
use std::ops::Add;

// Generic over any T that can be added to itself, producing a T.
fn sum<T: Add<Output = T> + Copy + Default>(xs: &[T]) -> T {
    let mut acc = T::default();
    for &x in xs { acc = acc + x; }
    acc
}
```

Three things make Rust's trait system the model professional-grade design:

- **Coherence (the orphan rule).** A trait implementation for a type is *globally unique* — you can't have two conflicting `impl`s. This guarantees generic code's behavior is unambiguous, at the cost of the "orphan rule" (you may implement a trait for a type only if you own one of them). Haskell shares this; C++ concepts and Go constraints do *not* enforce coherence, which can lead to ambiguity.
- **Associated types.** A trait can declare *output types*, not just methods: `trait Iterator { type Item; fn next(&mut self) -> Option<Self::Item>; }`. This lets generic code name "the element type of this iterator" without an extra type parameter — a cleaner expressiveness than C++ traits-classes or Java's wildcards achieve.
- **Static *or* dynamic dispatch from one trait.** `fn f<T: Trait>(x: T)` monomorphizes (static, zero-cost); `fn f(x: &dyn Trait)` uses a vtable (dynamic, type-erased). The *same trait* powers both, letting the author choose the speed/size trade-off per call site — the [senior](senior.md)-level monomorphization-vs-erasure choice, exposed as a language knob.

Rust effectively demonstrates that **the typeclass/trait model is a stronger foundation for generic programming than either C++ templates or Java generics** — explicit constraints (so good errors), coherence (so unambiguous), associated types (so expressive), and dual dispatch (so flexible) — which is why newer languages (Swift protocols, the abandoned C++0x concepts, Carbon's interfaces) converge on it.

---

## Higher-Kinded Types and Their Absence

Here is the frontier where mainstream generic programming hits a wall. Ordinary generics parameterize over a **type**: `List<T>` abstracts over the element type. But sometimes you want to parameterize over the **type constructor itself** — over `List` or `Option` or `Future` *as a thing*, independent of what it contains.

The classic example: you'd like to write `map` *once* for *every* container —

```haskell
-- Haskell: Functor abstracts over the CONTAINER f, which is itself
-- a type constructor (* -> *), not a type. This is a higher-kinded type.
class Functor f where
    fmap :: (a -> b) -> f a -> f b      -- one map for List, Maybe, IO, ...
```

Here `f` ranges over *one-argument type constructors* (`Maybe`, `[]`, `Either e`), not over types. That requires **higher-kinded types (HKTs)**: type parameters that are themselves *parameterized*. Haskell and Scala have them; this is what makes `Functor`, `Monad`, and `Traversable` expressible as a *single* abstraction reused by every container.

**Mainstream languages deliberately lack HKTs.** Java, Go, C#, Rust (so far), and pre-Concepts C++ can parameterize over `T` but not over `F<_>`. The consequences for generic programming:

- You **cannot write one `map` for all containers.** Each container gets its own `map`; there's no `Functor` to unify them. Java `Stream.map`, `Optional.map`, `List` mapping are separate methods, not instances of one abstraction.
- "**Monad**" and similar abstractions can't be expressed as reusable interfaces, only as *patterns* re-implemented per type — part of why "monad" feels mysterious in languages without HKTs (see [FP → Monads in Plain English](../../code-craft/functional-programming/09-monads-plain-english/)).
- Libraries simulate HKTs with **encodings** — Scala's `F[_]` (it *has* them), Rust's GAT (generic associated types, a partial step), Java's leaky "lightweight HKT" tricks via defunctionalization — all workarounds for an absent feature.

Why the absence? HKTs complicate type inference and the type checker, raise the learning curve steeply, and the mainstream judged the cost-to-benefit unfavorable for general-purpose languages. It's the clearest example of a *deliberate ceiling* on how generic these languages let you be. The mechanics are detailed in [Type Systems → Higher-Kinded Types](../../language-internals/type-systems/09-higher-kinded-types/).

---

## Generic Code, ABI, and Compile-Time Cost

At library scale, the implementation strategy from the [senior](senior.md) level becomes an *interface-design* problem:

- **Monomorphization breaks ABI stability.** Because C++/Rust generate code per instantiation *at the call site*, a generic function's machine code lives in the *caller's* binary, not the library's. This means generic library code generally **can't be shipped across a stable ABI boundary** — change the template and every caller must recompile. A generic-heavy C++ library is effectively *header-only* (the definitions must be visible to instantiate), and Rust generics don't cross the (unstable) Rust ABI. Type-erased generics (Java) *do* cross their ABI cleanly — one compiled `List` serves all callers — which is a genuine advantage of erasure for *binary* library distribution.
- **Compile-time cost is a design constraint, not an afterthought.** Header-only generic libraries (Boost, Eigen, much of modern C++) can dominate build times because every translation unit re-instantiates them. Mitigations are *API decisions*: `extern template` to instantiate once, explicit instantiation in a `.cpp`, the thin-shell/outlining pattern, PIMPL behind a non-generic facade, and (C++20) modules to avoid re-parsing headers.
- **Binary size is part of the contract.** A library that instantiates a heavy generic for dozens of types bloats every binary that links it. Professional generic libraries are deliberate about *what* they monomorphize, often providing a type-erased fallback (`std::function`, `dyn Trait`, `std::any`) for cases where code size matters more than the last ounce of speed.

The throughline: **the generic-implementation strategy is not hidden from the library's users — it leaks into ABI, build times, and binary size**, and a professional designs the public surface with that leakage in mind.

---

## Template Metaprogramming — The Gateway to Compile-Time Computation

Generic programming in C++ has a powerful side door: templates are **Turing-complete**, so generic machinery can *compute* at compile time. **Template metaprogramming (TMP)** began as a near-accident (Erwin Unruh's 1994 program that printed primes as compiler *error messages*) and grew into a discipline.

```cpp
// Classic TMP: factorial computed entirely at compile time via recursion
// over template instantiation.
template <int N> struct Factorial { static constexpr int value = N * Factorial<N-1>::value; };
template <>      struct Factorial<0> { static constexpr int value = 1; };
static_assert(Factorial<5>::value == 120);   // computed by the COMPILER
```

What started as a curiosity matured into the foundation of:

- **Type traits & introspection** (`std::is_integral`, `std::tuple_size`) — programs that compute *about types*.
- **Compile-time selection** (`std::conditional`, tag dispatch, SFINAE/`enable_if`) — choosing implementations based on type properties.
- **`constexpr` / `consteval`** — the *modern* successor that makes much TMP unnecessary by letting ordinary functions run at compile time, far more readably than recursive-template encodings.

The conceptual point for generic programming: **once you can abstract over types, you're a short step from *computing* over them**, and from there to moving work from run time to compile time (zero-overhead validation, generated lookup tables, dimensional-analysis types that catch unit errors at compile time). This is generic programming's most extreme expression — and a clear boundary case where it shades into a *different* concern (compile-time metaprogramming), which is why modern C++ steers it toward `constexpr` and concepts rather than the old TMP dark arts. Rust's `const` generics and Zig's `comptime` are other languages' answers to the same "compute over types at compile time" impulse.

---

## Common Mistakes

- **Designing generic APIs without discovering the minimal concept.** Parameterizing over a concrete container (or over-constraining to it) instead of the weakest sufficient concept needlessly excludes valid types — the opposite of the STL's `sort`-over-iterators discipline.
- **Shipping monomorphized generics across an ABI boundary.** Generic C++/Rust code can't live behind a stable binary interface; trying to leads to ODR violations or forced recompiles. Use type erasure (`dyn`, `std::function`) at the boundary when ABI stability matters.
- **Reaching for HKT-shaped abstractions in a language without HKTs.** Trying to write "one `map` for all containers" in Java/Rust/Go produces convoluted encodings; accept per-type `map` or move the abstraction to a language that has HKTs. Know the ceiling.
- **TMP where `constexpr`/concepts would do.** Recursive-template metaprograms are write-once, debug-never. Modern C++ replaces most of them with `constexpr` functions and concept constraints — reach for those first.
- **Ignoring compile-time/binary cost as an API property.** A beautiful header-only generic library that triples downstream build times has a real defect. Treat instantiation cost, `extern template`, and erased fallbacks as part of the public design.
- **Confusing coherence-free constraint systems with coherent ones.** C++ concepts and Go constraints don't guarantee a unique implementation per type the way Rust traits / Haskell typeclasses do; designing as if they did invites ambiguity.

---

## Summary

At library scale, generic programming is a **design methodology**, not a syntax: discover the *minimal requirements* an algorithm places on its operands, name them as **concepts**, and build a library where any type meeting a concept composes with every algorithm — the Stepanov discipline that produced the STL. The C++ lineage runs **STL → Boost → C++20 Concepts & Ranges**, a 25-year arc from requirements-as-convention to requirements-as-checkable-predicates; concept-based design's payoff is errors at the boundary, requirement-based overloading, and self-documenting contracts. **Rust's trait system** is arguably the model implementation — explicit bounds, **coherence**, associated types, and one trait powering both static (monomorphized) and dynamic (vtable) dispatch — which is why newer languages converge on it. The frontier is **higher-kinded types**: parameterizing over the *type constructor* (`Functor`, `Monad`) so one `map` serves every container — present in Haskell/Scala, **deliberately absent** from Java/Go/Rust/C#, which is why "one `map` for all containers" and reusable monads can't be expressed there. Generic implementation **leaks into ABI, compile time, and binary size** — monomorphized generics can't cross a stable ABI and inflate builds, making erased fallbacks and outlining genuine API decisions. And **template metaprogramming** shows generic programming's extreme: once you abstract over types you can *compute* over them at compile time, a power modern C++ now channels through `constexpr` and concepts. Throughout, the *type-system mechanics* live in [Type Systems](../../language-internals/type-systems/); this topic owns the *style* and the *library design* they enable.

---

## Further Reading

- Alexander Stepanov & Paul McJones, *Elements of Programming* — the foundational text on generic programming as a mathematical discipline.
- David Vandevoorde, Nicolai Josuttis & Douglas Gregor, *C++ Templates: The Complete Guide* — the definitive treatment of templates, traits, SFINAE, and concepts.
- The Rust Book & *Programming Rust* (Blandy et al.), trait chapters — traits, coherence, associated types, static vs dynamic dispatch.
- "Lightweight Higher-Kinded Polymorphism" (Yallop & White) — how to *encode* HKTs in languages that lack them, and why the absence bites.
- Czarnecki & Eisenecker, *Generative Programming* — generic + metaprogramming as a route to compile-time code generation.

---

## Related Topics

- [`senior.md`](senior.md) — monomorphization vs erasure vs dictionaries, variance in depth, constraint/error-message design.
- [`interview.md`](interview.md) — the whole topic distilled into staff-level Q&A.
- [Type Systems → Higher-Kinded Types](../../language-internals/type-systems/09-higher-kinded-types/) — the mechanics behind `Functor`/`Monad` and HKTs.
- [Type Systems → Generics & Parametric Polymorphism](../../language-internals/type-systems/05-generics-and-parametric-polymorphism/) — the type-system feature underlying this style.
- [FP → Monads in Plain English](../../code-craft/functional-programming/09-monads-plain-english/) — why monads are hard to abstract without HKTs.
- [17 — Multiparadigm in Practice](../17-multiparadigm-in-practice/) — how Rust/Scala/C++ blend generic programming with their other paradigms.
