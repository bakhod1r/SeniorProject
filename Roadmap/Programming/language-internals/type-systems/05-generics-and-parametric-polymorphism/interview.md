# Generics & Parametric Polymorphism — Interview Questions

> **Topic:** [Generics & Parametric Polymorphism](README.md)

---

## Introduction

These questions probe whether a candidate understands generics as more than "the `<T>` syntax." A strong candidate distinguishes the *programming model* (parametric polymorphism — one implementation, uniform behavior for all types) from the *implementation strategy* (monomorphization vs. erasure vs. reified vs. hybrid) and can predict the practical consequences of each: boxing, binary bloat, `new T()` legality, `instanceof` legality, `ClassCastException` failure modes, compile-time costs. They can place parametric polymorphism precisely among the four polymorphisms, reason with parametricity ("a `T -> T` can only be identity"), and make production trade-offs (specialize vs. erase) by measurement.

A weaker candidate treats every language's generics as interchangeable, conflates parametric with subtype polymorphism, doesn't know why Java boxes or why Rust binaries grow, and can't explain a single free theorem. The questions move from conceptual foundations, through language-specific surfaces (Java erasure, C++ templates, C# reification, Rust monomorphization, Go's hybrid, Haskell typeclasses), into trap questions where the naive answer is wrong, then to design scenarios.

## Table of Contents

- [Conceptual / Foundational](#conceptual--foundational)
- [Language-Specific](#language-specific)
  - [Java](#java)
  - [C++](#c)
  - [C#](#c-1)
  - [Rust](#rust)
  - [Go](#go)
  - [Haskell](#haskell)
- [Tricky / Trap Questions](#tricky--trap-questions)
- [Design Questions](#design-questions)
- [Cheat Sheet](#cheat-sheet)
- [Further Reading](#further-reading)

---

## Conceptual / Foundational

## Question 1

**What is parametric polymorphism, and how does it differ from the other kinds of polymorphism?**

Parametric polymorphism is writing a function or type parameterized by a type variable (`<T>`) that behaves **identically for all types** — it cannot inspect or branch on the type. The four classic kinds: **parametric** (uniform; `List<T>`, `identity<T>`), **ad-hoc** (different implementations per type — overloading and typeclasses/traits; behavior *varies*), **subtype/inclusion** (one interface, runtime picks the implementation by dynamic type — virtual dispatch), and **coercion** (implicit conversion like `int → double`). The defining axis is *does behavior vary by type?* Parametric says no; the other three say yes. Parametric polymorphism's uniqueness is that the code is *forced* to treat values as opaque — which is exactly what makes free theorems possible.

## Question 2

**Why are generics better than using `Object`/`any`/`interface{}` and casting?**

The `Object`-everywhere approach gives reuse but loses type safety: the compiler can't stop you putting a `User` in and pulling it out as a `String`, so the error surfaces as a runtime `ClassCastException` (or panic) far from its cause. Generics give the *same reuse with full compile-time type safety* — a `List<String>` provably holds only `String`s, no cast needed, no runtime surprise. Generics move an entire class of errors from runtime to compile time. The cast-everywhere style *is* the problem generics were invented to solve.

## Question 3

**What's the difference between a generic type and a generic method?**

A generic *type* is parameterized: `List<T>`, `Map<K,V>` — you instantiate it (`List<String>`) to get a concrete type. A generic *method/function* is parameterized: `first<T>(...)` — its type parameter is resolved per call, usually by inference. They're orthogonal: a generic method can live in a non-generic class, and a generic type can have non-generic methods. A generic method inside a generic type can even introduce its *own* fresh type parameter distinct from the class's.

## Question 4

**Explain parametricity and "theorems for free."**

Parametricity (Reynolds) says a parametric function behaves uniformly across type instantiations — it maps related inputs to related outputs and can't tell which type it's running at. The practical consequence (Wadler's "theorems for free") is that you can derive a theorem every implementation of a polymorphic type must satisfy, *from the type alone*. Canonical example: a total, pure `forall T. T -> T` can only be the **identity** — it can't construct a `T`, can't inspect one, and has no other `T` to return. Similarly `map`'s type forces naturality (`map f . map g = map (f . g)`), and `forall T. List<T> -> List<T>` can only permute and drop elements, never fabricate or value-inspect them. The type tells you the behavior.

## Question 5

**What are the two main implementation strategies for generics, and what do they trade?**

**Monomorphization** generates a specialized copy of the code per concrete type (C++ templates, Rust, C# value types): zero runtime cost (no boxing, full inlining) but binary bloat, slow compiles, no code sharing. **Type erasure** generates one shared implementation and discards type arguments after type-checking (Java, Haskell, TypeScript, early Go): small code, fast compiles, easy backward compatibility, but boxing of value types and no runtime knowledge of `T`. They trade compile-time/binary-size against runtime-speed/runtime-type-info. Neither is universally better.

## Question 6

**What is boxing and why does it matter for generics?**

Boxing wraps a value type (like `int`) in a heap object so it can be referenced uniformly. In erased generics, value types *must* be boxed because the one shared implementation operates on references — so `List<Integer>` in Java stores heap `Integer` objects, not raw `int`s. The cost is heap allocation, GC pressure, pointer indirection, and cache misses; a `List<Integer>` sum can be several times slower than an `int[]` sum. Monomorphizing (Rust `Vec<i32>`) and reified (C# `List<int>`) generics avoid it for value types because each knows the real type.

## Question 7

**What's the difference between a bounded and an unbounded type parameter?**

An *unbounded* `T` (`<T>`, Go's `[T any]`) can be any type, so the function can do almost nothing with it — only hold, move, and store it (the source of strong free theorems). A *bounded* `T` (`<T extends Comparable<T>>`, `<T: Ord>`, C# `where T : IComparable<T>`) is restricted to types satisfying a requirement, which lets the body use the corresponding capability (compare, print, construct). Bounds are how parametric structure calls into ad-hoc per-type operations; under the hood the bounded operation is delivered either inlined per monomorphized copy or via a dictionary at runtime.

## Question 8

**What is the difference between rank-1 and higher-rank polymorphism?**

In rank-1 polymorphism all `forall` quantifiers are outermost (`forall T. T -> T`) — the caller fixes the type once at the call site, and this is fully inferable (Hindley–Milner), which is why it's the default everywhere. Higher-rank polymorphism puts a `forall` to the *left* of an arrow (`(forall T. T -> T) -> (Int, Bool)`), so the callee receives a still-polymorphic argument it can use at multiple types internally. Higher-rank is strictly more expressive (full System F) and enables patterns like `runST :: (forall s. ST s a) -> a` (the nested `forall s` is a safety fence preventing state escape), but it breaks full type inference and requires explicit annotations — which is why most languages restrict to rank-1.

---

## Language-Specific

### Java

## Question 9

**How are Java generics implemented, and name three concrete consequences.**

Java uses **type erasure**: type arguments are checked at compile time then erased, leaving one implementation that operates on `Object`. Consequences: (1) **boxing** — `List<Integer>` holds heap `Integer`s, not `int`s; (2) **`new T()` is illegal** — no runtime `T` to construct; (3) **you can't overload on erased generics** — `f(List<String>)` and `f(List<Integer>)` have the same erasure `f(List)`, a compile error; (4) **`instanceof List<String>` is illegal** — only the raw `instanceof List` works; (5) **unchecked-cast warnings and `List<String>[]` array creation are forbidden**. Erasure was chosen for backward compatibility with pre-Java-5 `Object`-based code.

## Question 10

**Why can't you create a generic array (`new T[]` or `new List<String>[10]`) in Java?**

Arrays are **reified and covariant** (an array knows its element type at runtime and checks stores against it — `ArrayStoreException`), while generics are **erased and invariant**. Combining them is unsound: a `List<String>[]` would erase to `List[]`, and the array's runtime store-check only sees the raw `List`, so a `List<Integer>` could be stored without detection, defeating the whole point. So the language forbids generic array creation. Workarounds: use `List<List<String>>`, or create an `Object[]`/`List[]` and cast with a documented unchecked warning.

## Question 11

**What is the super-type-token (TypeReference) trick, and why is it needed?**

Because erasure removes an instance's type arguments, a generic class can't see its own `T` at runtime. But the type argument of a *superclass* is retained in class-file metadata. So you subclass an abstract generic via an anonymous class (`new TypeReference<List<User>>(){}`) and read `getGenericSuperclass()` to recover `List<User>`. Jackson's `TypeReference` and Guice's `TypeLiteral` use exactly this. The need for the trick is the clearest proof that Java erases — in a reified language (C#) you'd just write `typeof(List<User>)`.

### C++

## Question 12

**How do C++ templates relate to monomorphization, and what's distinctive about their instantiation?**

C++ templates are monomorphized: the compiler generates a specialized copy per type argument (`vector<int>`, `vector<string>` are distinct types with distinct code). Distinctive features: templates are **duck-typed** (constraints were implicit pre-C++20 — any type "fits" if the operations compile), instantiation is **lazy** (a member function is only compiled if actually called), and template metaprogramming makes them a Turing-complete compile-time language. The cost is code bloat, long compiles, and notoriously deep error messages when a type doesn't satisfy the (formerly implicit) requirements.

## Question 13

**What are SFINAE and C++20 concepts, and what problem do concepts solve?**

SFINAE ("Substitution Failure Is Not An Error") is the older technique: when template argument substitution fails, that overload is silently dropped from the candidate set rather than producing an error, enabling conditional/constrained templates — powerful but cryptic, with error messages that point deep into library internals. **C++20 concepts** are named, first-class constraints on template parameters (`template <std::integral T>`) that document requirements at the signature and produce *clear* errors at the call site ("constraint not satisfied") instead of pages of instantiation backtrace. Concepts make constrained generics readable and diagnosable — the same role traits/typeclass-bounds play elsewhere.

### C#

## Question 14

**How do C# reified generics differ from Java's erased generics?**

C# generics are **reified**: the CLR knows the type arguments at runtime. So (1) value types aren't boxed — `List<int>` stores real `int`s (the JIT specializes per value-type instantiation; reference types share one body); (2) `typeof(T)` works; (3) `new T()` works with `where T : new()`; (4) `x is List<string>` works. Java erases, so all four are impossible or need workarounds. The trade-off: C# pays for a heavier runtime that carries type metadata and JIT-specializes value-type instantiations, in exchange for no boxing *and* runtime type information.

## Question 15

**In C#, where does boxing still sneak in despite reified generics?**

At boundaries that lose the type. Casting a value-type `T` to `object`, or to a non-generic interface like `IComparable` (rather than `IComparable<T>`), boxes it. Storing value types in a non-generic collection (`ArrayList`) boxes. So while `List<int>` is unboxed, a generic method that internally upcasts `T` to `object`, or compares via the non-generic `IComparable`, reintroduces the box. The reified no-boxing guarantee is *local* to where the concrete type is preserved; it leaks at type-erasing boundaries.

### Rust

## Question 16

**How does Rust implement generics, and what is the practical downside?**

Rust monomorphizes: each generic function/type is compiled to a specialized copy per concrete type argument, so `Vec<i32>` and `Vec<String>` are distinct, and a generic over `i32` compiles to the same machine code as a hand-written `i32` version — a true zero-cost abstraction (no boxing, full inlining). The downside is **monomorphization bloat**: binary size and compile time grow with the number of instantiations, which is why deeply generic crates (`serde`, `futures`) and heavily-instantiated generics can produce large binaries and slow builds. You can opt into erasure with **trait objects** (`dyn Trait`) to share one copy at the cost of dynamic dispatch — sliding toward erasure where size matters more than speed.

## Question 17

**In Rust, when would you choose `dyn Trait` (trait objects) over generic `impl Trait`/`<T: Trait>`?**

Generic bounds monomorphize (fast, but one copy per type → bloat); `dyn Trait` erases to a single copy with a vtable (dynamic dispatch, slight runtime cost, but no per-type code duplication). Choose `dyn Trait` when: the generic body is large and used with many types (bloat dominates), you need heterogeneous collections (`Vec<Box<dyn Trait>>` holding mixed concrete types), or you need to break compile-time dependency/instantiation explosion. Choose static generics for hot paths where inlining and zero-cost matter and the instantiation count is bounded. It's a per-call-site speed-vs-size slider.

### Go

## Question 18

**How does Go implement generics, and why did it choose that approach?**

Go uses a **hybrid**: "GC-shape stenciling with dictionaries." It generates one copy per *GC shape* (roughly, per memory layout — many pointer-shaped types share a copy) rather than per type, and passes a hidden **dictionary** of type-specific operations into the shared body. Go chose this middle path because full monomorphization risked binary bloat and slow builds (Go prizes fast compilation) while full boxing (the old `interface{}` style) was the very pain generics were meant to remove. The result sits between the extremes — less code than full mono, less indirection than full boxing, but *some* dictionary indirection, so not always as fast as Rust.

## Question 19

**What did Go look like before generics, and what did generics actually fix?**

Before Go 1.18, reusable containers/algorithms used `interface{}` plus runtime **type assertions** — hand-rolled erasure with boxing of every element and a runtime `panic` if an assertion was wrong; teams often used `go generate` codegen as manual monomorphization. Generics (`[T any]`) gave compile-time-checked, assertion-free reuse: the wrong-type error became a *compile* error instead of a runtime panic, and an entire category of codegen tooling became unnecessary. The performance is usually better than `interface{}` boxing, though dictionary indirection means it isn't always as fast as monomorphized code.

### Haskell

## Question 20

**How does Haskell achieve ad-hoc polymorphism, and how does it relate to bounded generics elsewhere?**

Haskell uses **typeclasses**: a class like `Ord a` declares operations (`compare`), and instances provide them per type. A function `sort :: Ord a => [a] -> [a]` is parametric in `a` *structurally* but calls the ad-hoc `compare` for whatever `a` is. The compiler implements this by passing a **dictionary** (a record of the class's operations) as a hidden argument — so `Ord a =>` desugars to an extra dictionary parameter. This is *exactly* what a bounded generic (`<T: Comparable>`) is elsewhere: parametric structure plus a per-type operations table, delivered as a dictionary (erased langs) or inlined per copy (monomorphized langs). Typeclasses are the cleanest expression of the parametric/ad-hoc boundary.

## Question 21

**Why are free theorems stronger in Haskell than in Java or C#?**

Free theorems hold exactly as strongly as a language is *parametric* — i.e. as long as polymorphic code genuinely can't observe or fabricate types. Haskell (pure, total-ish, no reflection on type variables) lets a `forall a. a -> a` be only identity (modulo bottom). Java and C# **leak** parametricity: reflection / `instanceof` / `typeof(T)` let code branch on the type, `null` lets `T -> T` return null, and unrestricted effects/exceptions let it observe order or fail — so the "identity" theorem doesn't hold. C#'s reified generics are *by design* not parametric. So in Haskell free theorems are guarantees; in Java/C# they're design guidance you must verify by auditing the body for leaks.

---

## Tricky / Trap Questions

## Question 22

**Is `Box<Cat>` a subtype of `Box<Animal>` if `Cat` is a subtype of `Animal`?**

No — not automatically, in most languages. Generic types are **invariant** by default: `List<Cat>` is *not* a `List<Animal>`, even though `Cat <: Animal`. The reason is soundness: if `List<Cat>` were a `List<Animal>`, you could add a `Dog` to it (it's a `List<Animal>`!) and then read a `Dog` out as a `Cat` — a type hole. Variance annotations (`? extends` in Java, `out`/`in` in C#, covariance/contravariance) selectively relax this where it's safe. This is the variance topic; the trap is assuming generics inherit the subtype relationship of their arguments. (Java arrays *are* covariant, which is exactly why they throw `ArrayStoreException` at runtime — the unsound shortcut generics avoid.)

## Question 23

**A candidate says "a `forall T. T -> T` function must be the identity." When is this wrong?**

It's wrong whenever the language **leaks parametricity**. In C# it could branch on `typeof(T)` and behave differently per type. In any language with `null`, it could return `null` instead of its argument. With exceptions or non-termination it could throw or loop (so even in Haskell the theorem is "identity *or* bottom"). With reflection or `unsafe` it can do anything. The theorem is only a *guarantee* in pure, total, non-reflective parametric code. Claiming it unconditionally is the trap.

## Question 24

**Why does `void f(List<String> x)` and `void f(List<Integer> x)` fail to compile in Java but works fine in C++?**

In Java, both methods erase to the *same* signature `f(List)`, so the JVM can't distinguish them — "name clash: same erasure." In C++, templates are monomorphized and `std::vector<std::string>` and `std::vector<int>` are genuinely distinct types, so the overloads have distinct signatures and coexist. This is a direct, observable difference between erasure and monomorphization — same source intent, opposite outcomes, because of the implementation strategy.

## Question 25

**Your Java service's latency regressed after switching a hot map from `int`-keyed to a generic `Map<Integer, Integer>`. Why, and what's the fix?**

Erasure forces boxing: every key and value is now a heap `Integer`, so the hot path allocates millions of objects, pressures the GC, and chases pointers (cache misses) instead of touching contiguous `int`s. An allocation profiler will show a flood of `Integer` allocations. The fix is a **primitive-specialized** structure — fastutil/Eclipse Collections `Int2IntOpenHashMap`, or restructuring to `int[]`/`IntStream` for the hot loop — boxing only at the API boundary. The generic API is fine for cold code; the boxing tax bites only in hot paths.

## Question 26

**A Rust service's binary doubled in size and builds got much slower after adding a generic dependency. What happened, and how do you diagnose it?**

Monomorphization bloat: the dependency's generics, instantiated across many of your types, emit a specialized copy each, multiplied by inlining — growing both binary size and compile time. Diagnose with `cargo llvm-lines` (functions ranked by generated LLVM lines — the mono offenders) and `cargo bloat` (functions by binary size); for C++ the analogue is `-ftime-trace`. Mitigate by erasing large/cold generics via `dyn Trait`, factoring a thin generic shell over a non-generic core (so only a tiny adapter is duplicated), or reducing the instantiation surface. Crucially, *measure first* — the offending instantiation is rarely the one you'd guess.

## Question 27

**A `ClassCastException` fires in a Java method that does no casts. How is that possible?**

Erasure inserts *invisible* casts at generic read sites. If a wrong-typed value entered a generic collection earlier — via a **raw type** or an **unchecked cast** (heap pollution) — it passes all compile checks, and the compiler-inserted cast at the *read* site is the first place the lie is caught. So the crash appears in innocent reader code, far from the guilty writer. You debug it by tracing the *value's* origin, not the stack trace alone; you prevent it by failing builds on unchecked warnings, banning raw types, and validating types at trust boundaries (deserialization, reflection, interop) so the bad value is rejected at entry.

## Question 28

**Can a program that uses generics still need a runtime type check, and is that a code smell?**

Yes — and it's usually a sign you've stepped *out* of parametric polymorphism. If you find yourself writing `if (T is Int) ... else ...` (where the language allows it), you're doing ad-hoc polymorphism via reflection, not parametric. That defeats the uniformity guarantee, void free theorems, and is often better expressed with overloading, an interface/trait with a method, or a typeclass/dictionary. Legitimate exceptions exist (serialization frameworks recovering erased types via tokens, performance specialization), but reflexive runtime type checks inside "generic" code are usually a design smell.

---

## Design Questions

## Question 29

**Design a type-safe heterogeneous container (a map from type to a value of that type).**

The challenge: a normal `Map<K,V>` ties all values to one `V`, but here each key *is* a type and its value should have *that* type. The classic solution (Bloch's "typesafe heterogeneous container") uses a `Map<Class<?>, Object>` internally but exposes a generic API: `<T> void put(Class<T> key, T value)` and `<T> T get(Class<T> key)`, with `get` doing `key.cast(map.get(key))` so the unchecked cast is *checked* by the class token at runtime. The `Class<T>` token (a type token) is what recovers, at the API surface, the type safety erasure removed internally. In C# you'd lean on reified `typeof(T)` instead. Discuss: where the unsafe cast lives, how the token makes it safe, and the erasure-vs-reification difference.

## Question 30

**You're designing a generic library function and deciding between `<T>` (unbounded), `<T: SomeBound>`, and taking an interface/`Object`. How do you choose?**

Choose the **most polymorphic type that still compiles**. Start unbounded (`<T>`) — it gives callers the strongest guarantee (the function provably can't inspect or alter their values; free-theorem reasoning applies) and maximum reuse. Add a **bound** *only* when the body genuinely needs a capability (compare, print, construct) — and add the *minimal* bound, since every bound restricts callers. Avoid `Object`/`any` entirely (loses type safety, needs casts). The bound is the bridge from parametric structure to ad-hoc per-type operations; keep it as narrow as the implementation truly requires. This maximizes both caller guarantees and reusability.

## Question 31

**Design the generics strategy for a library that must be fast *and* produce small binaries on WASM. How do you reconcile the tension?**

These pull opposite ways — speed wants monomorphization, small binaries want erasure/sharing. Reconcile per call site: monomorphize (or `@specialized`/static-dispatch) the *hot, small* generics where inlining and no-boxing pay off, and erase (`dyn`/virtual, single shared copy) the *cold, large* generics where size dominates. Factor thin generic shells over non-generic cores so only tiny adapters duplicate. Measure with size tools (`cargo bloat`/`cargo-llvm-lines`) and a profiler to find which generics are actually hot vs. actually large — never guess. The deliverable is a per-call-site policy ("specialize these, erase those") justified by measurement, not a single global verdict.

## Question 32

**You need a container that's generic in its element type but also needs to construct fresh elements (`new T()`). How do you design this across Java, C#, and Rust?**

The capability differs by implementation strategy, so the design does too. In **C#** (reified), constrain with `where T : new()` and call `new T()` directly — the runtime knows `T`. In **Java** (erased), `new T()` is impossible; thread a factory: take a `Supplier<T>` (or `Class<T>` plus reflection) in the constructor and call `factory.get()`. In **Rust** (monomorphized), require a bound that provides construction — `T: Default` (call `T::default()`) or take a closure `impl Fn() -> T`. The unifying idea: erased/monomorphized languages can't conjure a `T` from nothing, so you *pass the construction capability in* (factory/closure/`Default`), whereas reification lets the runtime supply it. Recognizing *why* the design varies (who knows `T` at runtime) is the point.

---

## Cheat Sheet

```
+-----------------------------------------------------------------------+
| Generics & Parametric Polymorphism — Must-Know                        |
+-----------------------------------------------------------------------+
| 1. Four polymorphisms:                                                |
|    parametric (uniform) | ad-hoc (overload/typeclass) |               |
|    subtype (virtual)    | coercion (implicit convert)                 |
|    Parametric = behavior IDENTICAL for all types.                     |
|                                                                       |
| 2. Generics > Object/any+cast: same reuse, compile-time safety.       |
|                                                                       |
| 3. Free theorem: forall T. T -> T  ==  identity (if pure/total/       |
|    non-reflective). The type tells you the behavior.                  |
|                                                                       |
| 4. Implementation strategies:                                         |
|    MONOMORPHIZE (C++, Rust, C# value types): copy per type            |
|       -> fast, no box, BUT bloat + slow builds                        |
|    ERASE (Java, Haskell, TS, early Go): one shared copy               |
|       -> small, fast builds, BUT boxing + no runtime T                |
|    REIFIED (C#): no value-type box + typeof(T)/new T() work           |
|    HYBRID (Go): GC-shape stencils + dictionaries (middle path)        |
|                                                                       |
| 5. Erasure consequences (Java): no new T(), no instanceof List<S>,    |
|    no same-erasure overload, no new T[], boxing, unchecked warnings.  |
|                                                                       |
| 6. Bounded vs unbounded: unbounded T can do ~nothing (strong free     |
|    theorem); bound = bridge to ad-hoc op, delivered via dictionary.   |
|                                                                       |
| 7. rank-1 (forall outermost, inferable) vs higher-rank (forall left   |
|    of arrow, more expressive, needs annotations; e.g. runST).         |
|                                                                       |
| 8. Production costs (pick which is binding):                          |
|    boxing -> latency/GC (find w/ alloc profiler)                      |
|    mono bloat -> size/build (find w/ cargo-llvm-lines / bloat)        |
|    raw-type ClassCastException -> detonates far from cause            |
|                                                                       |
| 9. Variance trap: List<Cat> is NOT a List<Animal> (invariant).        |
|                                                                       |
| 10. Free theorems leak via reflection, null, effects, unsafe,         |
|     reified generics. Audit before trusting.                          |
+-----------------------------------------------------------------------+
```

---

## Further Reading

- "Theorems for Free!" — Philip Wadler (1989). The paper that named free theorems.
- "Types, Abstraction and Parametric Polymorphism" — John C. Reynolds (1983). The foundation.
- "On Understanding Types, Data Abstraction, and Polymorphism" — Cardelli & Wegner (1985). The four-kinds taxonomy.
- "Effective Java" — Joshua Bloch. Item on generics, the typesafe heterogeneous container, and bounded wildcards.
- "Java Generics and Collections" — Naftalin & Wadler. The definitive Java erasure reference.
- "Programming Rust" — Blandy, Orendorff, Tindall. Monomorphization, trait objects, and the size-vs-speed trade.
- "C++ Templates: The Complete Guide" — Vandevoorde, Josuttis, Gregor. Templates, SFINAE, concepts.
- "CLR via C#" — Jeffrey Richter. How .NET reifies generics and JIT-specializes value types.
- "Featherweight Generic Java" / Go generics design docs (the "Type Parameters Proposal" and the GC-shape-stenciling blog posts).
- "The Expression Problem" — Philip Wadler's note; plus "Extensibility for the Masses" (object algebras) by Oliveira & Cook.
- "Typeclasses: Exploring the Design Space" — Peyton Jones, Jones, Meijer. Dictionary-passing implementation of ad-hoc polymorphism.
