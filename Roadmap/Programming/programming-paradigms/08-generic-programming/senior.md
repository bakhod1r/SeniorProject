# Generic Programming — Senior Level

> **Roadmap:** [Programming Paradigms](../README.md) → Generic Programming
> *`List<T>` looks the same in Java, Rust, and Go. Underneath, the three compilers do something completely different with it — and those differences decide your binary size, your inlining, your boxing, and whether a "zero-cost abstraction" is actually zero-cost.*

---

## Table of Contents

1. [Introduction](#introduction)
2. [Implementation Strategy 1 — Monomorphization](#implementation-strategy-1--monomorphization)
3. [Implementation Strategy 2 — Type Erasure](#implementation-strategy-2--type-erasure)
4. [Implementation Strategy 3 — Go's Dictionaries & GCShape Stenciling](#implementation-strategy-3--gos-dictionaries--gcshape-stenciling)
5. [The Strategies Side by Side](#the-strategies-side-by-side)
6. [Variance in Depth](#variance-in-depth)
7. [Designing Constraints for Good Error Messages](#designing-constraints-for-good-error-messages)
8. [The Cost of Generic Abstraction](#the-cost-of-generic-abstraction)
9. [When Generics Help vs Over-Abstraction](#when-generics-help-vs-over-abstraction)
10. [Common Mistakes](#common-mistakes)
11. [Summary](#summary)
12. [Further Reading](#further-reading)
13. [Related Topics](#related-topics)

---

## Introduction

> Focus: **What are the trade-offs, and what does the compiler actually do?**

At the surface, `Vec<T>`, `List<T>`, and `[]T` are the same idea. But "write the algorithm once over a type parameter" is a *source-level* promise; the compiler still has to produce real machine code that handles each concrete type. There are fundamentally **three** ways to keep that promise, and a language's choice among them is one of its deepest design commitments — it ripples into binary size, runtime speed, the ability to inline, whether values get boxed, and even what you're *allowed to express* in generic code.

The three strategies are **monomorphization** (C++, Rust: generate a specialized copy per concrete type — fast, but code bloat), **type erasure** (Java: keep one copy, forget the type at runtime — small, but boxing and lost type info), and a **hybrid dictionary-passing** approach (Go's GCShape stenciling: one copy per memory layout, plus a runtime dictionary for the rest). This level is about understanding these trade-offs well enough to predict performance, read disassembly, design constraints that produce *readable* errors, and — crucially — know when a generic abstraction is *earning* its complexity versus when you've over-abstracted.

> **The mindset shift:** "generics" is not one feature. It's a *contract* (one definition, many types) with several radically different *implementations*. A senior reasons about generic code in terms of which implementation is running underneath, because that's what determines the cost.

---

## Implementation Strategy 1 — Monomorphization

**Monomorphization** ("making single-form") means the compiler generates a **separate, specialized copy** of the generic code for *each concrete type* it's used with. `Vec<i32>` and `Vec<String>` compile to two distinct, fully-concrete data structures, as if you'd hand-written each. This is what **C++ templates** and **Rust generics** do.

```rust
fn id<T>(x: T) -> T { x }
id(5_i32);        // compiler emits id::<i32>
id("hi");         // compiler emits a SEPARATE id::<&str>
```

After monomorphization there is *no generic code left at runtime* — only ordinary, type-specific functions. The consequences:

**Upsides — speed and zero-cost abstraction:**
- **No boxing, no indirection.** `Vec<i32>` stores raw `i32`s inline; `T` is the actual type, so there's no pointer chasing and no heap allocation just to hold a value.
- **Full inlining and optimization.** Because each copy is monomorphic, the optimizer sees concrete types and can inline the element operations, unroll, vectorize — the comparison in a generic `sort<i32>` becomes a direct `i32` compare. This is the basis of Rust's and C++'s "**zero-cost abstraction**": the generic version compiles to the same code you'd write by hand.

**Downsides — code bloat and compile time:**
- **Code bloat.** A generic function used with 20 types produces 20 copies in the binary. A heavily generic C++/Rust program can balloon in size; instruction-cache pressure from many near-identical copies can even *hurt* performance.
- **Slow compiles.** The compiler does the work *per instantiation*, which is a major reason C++ and Rust build times are long. Each new type that touches a generic re-triggers code generation.
- **Templates are not type-checked until instantiated** (classic C++): a template can be syntactically fine yet fail to compile only when used with a bad type — the historical source of unreadable template errors (which C++20 concepts address).

---

## Implementation Strategy 2 — Type Erasure

**Type erasure** means the compiler uses the type parameters to *check* your code, then **throws the type information away**, compiling **one** copy that operates on a common representation. This is **Java's** approach: at runtime, a `List<String>` and a `List<Integer>` are *both just* `List` — the `<String>`/`<Integer>` is **erased**.

```java
List<String> a = new ArrayList<>();
List<Integer> b = new ArrayList<>();
a.getClass() == b.getClass();   // true! both are ArrayList at runtime
// T is erased to its bound — Object here, or the bound if one exists.
```

The single compiled copy treats `T` as its **bound** (`Object` if unbounded). The compiler inserts **casts** at use sites where it knows the real type, so *you* never see them and type safety is preserved *at compile time*.

**Upsides:**
- **One copy — no code bloat.** `List<T>` generates one `List` class no matter how many element types exist. Smaller binaries, faster compiles, fast class loading.
- **Backward compatibility.** Erasure let Java add generics in 1.5 without changing the JVM or breaking pre-generics `.class` files — a `List` and a `List<String>` interoperate.

**Downsides — boxing and lost runtime type:**
- **Boxing of primitives.** Because the one copy works on `Object`, primitives must be **boxed**: `List<Integer>` stores `Integer` *objects* on the heap, not raw `int`s. That's an allocation per element and pointer-chasing on access — the reason `List<Integer>` is far slower and fatter than an `int[]`. (Project Valhalla aims to fix this with value types and specialized generics.)
- **The type isn't there at runtime.** You can't write `new T[n]`, `x instanceof T`, or `T.class` — the information is gone. You see awkward workarounds: passing a `Class<T>` token explicitly, or `@SuppressWarnings("unchecked")` casts.
- **Erasure leaks.** `List<String>` and `List<Integer>` having the same runtime type blocks overloading on them and surprises people via reflection.

---

## Implementation Strategy 3 — Go's Dictionaries & GCShape Stenciling

Go (since 1.18) deliberately chose **neither** pure extreme, to keep both binary size and compile time reasonable while avoiding Java-style universal boxing. Its scheme is **GCShape stenciling with dictionaries**.

The key idea is the **GCShape**: two types share a GCShape if they have the **same memory layout from the garbage collector's point of view** — crucially, *all pointer-shaped types share one GCShape*. Go generates **one copy of the generic code per GCShape**, not per type:

- All pointer types (`*User`, `*Order`, `string`, `[]byte`, interfaces…) collapse to a single pointer-shaped GCShape → **one** stenciled copy serves all of them.
- Distinct value layouts (`int`, `float64`, a struct) get their own GCShapes → their own copies.

Because one stencil serves many *different* types, the code can't know type-specific details (which method to call, the exact type's metadata). Go supplies those at runtime through a hidden **dictionary** argument passed into the generic function — a table of the type-specific information (type descriptors, method pointers) for the actual type. So Go's generic call is "shared code + a dictionary telling it what to do," conceptually similar to how Haskell implements typeclasses.

**The trade-off Go bought:**
- **Less bloat than full monomorphization** (pointer types share a stencil) and **no universal boxing** like Java (value types keep their layout).
- **But** dictionary indirection means some generic calls go through the dictionary instead of being inlined — so Go generics can be *slower* than both a hand-specialized function and, sometimes, the equivalent interface call, on hot paths. Go's implementation has been improving, but "generics are always faster than `interface{}`" is **not** reliably true in Go today; measure.

---

## The Strategies Side by Side

| | **Monomorphization** (C++, Rust) | **Type erasure** (Java) | **GCShape + dicts** (Go) |
|---|---|---|---|
| Copies generated | One **per concrete type** | **One**, total | One **per GCShape** (pointers share) |
| Runtime type info | Baked in (concrete) | **Erased** (treated as bound) | Passed via **dictionary** |
| Primitives | Stored inline, no boxing | **Boxed** (`Integer`) | Value types keep layout |
| Inlining / optimization | **Full** (zero-cost) | Limited (one generic copy) | Partial; dictionary indirection |
| Binary size | **Bloat** (many copies) | Small | Middle |
| Compile time | **Slow** (per instantiation) | Fast | Middle |
| Can do `new T[]` / `T.class`? | Yes (type is known) | **No** (erased) | Partially (dictionary has type info) |

There is **no free lunch** — each language picked a point on the speed ↔ size ↔ compile-time triangle. Rust/C++ buy raw speed with bloat and slow builds; Java buys small fast-compiling binaries with boxing and lost runtime types; Go split the difference. Knowing which one you're standing on tells you where to look when a generic abstraction underperforms.

---

## Variance in Depth

The [middle](middle.md) level introduced variance as "why `List<Cat>` isn't a `List<Animal>`." The deep rule is about **positions**:

A type parameter used in an **output / read / producer** position can be **covariant** (widen safely); used in an **input / write / consumer** position it can be **contravariant** (narrow safely); used in **both** it must be **invariant**.

```
Function type  (A) -> B  is contravariant in A, covariant in B:
  a function that accepts a wider A and returns a narrower B
  can stand in wherever (narrowerA) -> widerB is expected.
```

This is why `Supplier<? extends T>` (produces `T`s — covariant) and `Consumer<? super T>` (consumes `T`s — contravariant) are the safe forms, and why a mutable `List<T>` — which both *produces* (`get`) and *consumes* (`add`) `T` — must be **invariant**. Languages express variance at two sites:

- **Use-site variance** (Java wildcards): the *caller* annotates each use — `List<? extends Animal>`. Flexible but verbose; PECS is the survival rule.
- **Declaration-site variance** (C#, Kotlin, Scala): the *type author* annotates the parameter once — Kotlin `out T` (covariant, e.g. `Producer<out T>`), `in T` (contravariant). The compiler then *enforces* that `out T` appears only in output positions, so the type is safe by construction and callers write nothing.

**Arrays are the cautionary tale.** Java made arrays **covariant** (`String[]` *is* an `Object[]`), which is *unsound*: you can assign a `String[]` to an `Object[]` and then store an `Integer`, which compiles but throws `ArrayStoreException` at runtime — a type error the compiler should have caught, deferred to a runtime check on *every* array write. Generics learned from this: they're invariant by default precisely to avoid repeating the array mistake. The formal treatment lives in [Type Systems → Variance](../../language-internals/type-systems/06-variance/).

---

## Designing Constraints for Good Error Messages

A constraint is also a **diagnostic surface**: when a caller passes the wrong type, the *constraint* is what the compiler reports against. Badly designed constraints produce the legendarily awful errors of pre-concepts C++ ("instantiated from here" walls of template-expansion noise pointing deep inside the library).

The senior practice:

- **State requirements explicitly and narrowly.** A `requires std::totally_ordered<T>` (C++20) or `where T: Ord` (Rust) fails *at the call site* with "T does not satisfy Ordered," not 40 lines into the algorithm. The constraint moves the error from *use of the operation* to *acceptance of the type* — a vastly better message.
- **Prefer many small named concepts/traits over one giant bound.** `Hashable`, `Comparable`, `Serializable` compose and each names a single requirement, so failures are specific. A monolithic `MyBigConstraint` reports the whole thing failed without saying which part.
- **Constrain to the minimum the algorithm uses.** Over-constraining narrows applicability; under-constraining defers errors to deep inside the body. The right bound is *exactly* the operations the algorithm performs on `T`.
- **In Rust, lean on trait bounds and `where` clauses; in C++20, on concepts; in Java, on bounded type parameters and (when needed) intersection bounds.** Each language's error quality is roughly proportional to how explicitly you stated the requirement.

This is why C++20 concepts were a landmark: they turned "it didn't compile somewhere in the template" into "your type doesn't model this named concept," which is the difference between a 5-minute and a 50-minute debug.

---

## The Cost of Generic Abstraction

Generics are not free, and the costs are *different per strategy* — a senior accounts for all of them:

- **Compile-time cost** (monomorphization): every instantiation is recompiled. A pervasively generic Rust/C++ codebase pays in build times; this is a real productivity tax, not a rounding error.
- **Binary-size cost** (monomorphization): code bloat from many copies; can pressure the instruction cache. Mitigation: keep the *generic shell* thin and delegate to a *non-generic inner function* (the "outlining" trick) so only a small wrapper is duplicated per type.
- **Runtime cost** (erasure / dictionaries): boxing and indirection. Java's `List<Integer>` allocates per element; Go's dictionary calls can't always inline. A "generic" abstraction can be *slower* than the `interface{}`/`Object` version it replaced if it forces boxing the other approach avoided.
- **Cognitive cost** (all strategies): deeply generic signatures (`<T extends Comparable<? super T> & Serializable>`, or a four-bound `where` clause) are hard to read and hard to call. Type inference helps at the call site but not at the *definition* site, where the next maintainer reads it.

The discipline: **generics trade duplication for indirection/bloat/complexity.** That trade is worth it when the algorithm genuinely serves many types; it's a net loss when you've abstracted a thing used by one type, "just in case."

---

## When Generics Help vs Over-Abstraction

Generics **help** when:
- *Multiple* concrete types genuinely share an algorithm or data structure (collections, `sort`, `Option<T>`, a generic cache).
- You'd otherwise duplicate code per type, or fall back to `Object`/`interface{}` and lose type safety.
- The abstraction is *stable* — the shared shape isn't going to fork into type-specific special cases.

Generics are **over-abstraction** when:
- Only **one** type ever uses it. `Repository<T>` with a single `Repository<User>` is ceremony; write `UserRepository`. (YAGNI applies to type parameters too.)
- The "shared" algorithm keeps sprouting `if (type == X)` special cases — a sign the types *don't* actually share behavior, and you're forcing a false abstraction. Two clear concrete versions beat one generic version riddled with type checks.
- The generic signature becomes harder to understand than the duplication it removes. If a reader needs five minutes to decode `<R, T extends Comparable<? super T>>`, the abstraction is costing more than it saves.
- You add a type parameter "for future flexibility" that no caller needs. Speculative generality is a [code smell](../../code-craft/refactoring/); add the parameter when the *second* type actually appears.

> **The senior call:** the threshold is **two or more real types that share the *same* behavior**, plus a signature a teammate can read. Below that, prefer the concrete version — duplication you can see beats abstraction you can't understand.

---

## Common Mistakes

- **Assuming "generic" means one implementation.** It's three (monomorphization, erasure, dictionaries) with opposite cost profiles. Reasoning about a Java `List<T>` as if it were a Rust `Vec<T>` (no boxing, full inlining) is simply wrong.
- **Believing generics are always faster than `Object`/`interface{}`.** In Java, `List<Integer>` *boxes* and can lose to a primitive array; in Go, dictionary-passing generics can lose to a well-predicted interface call. Generics' guaranteed win is *type safety*, not unconditional speed — measure on hot paths.
- **Repeating Java's covariant-array mistake.** Treating a mutable generic container as covariant opens the `Dog`-in-cats / `ArrayStoreException` hole. Invariance for mutable containers is correct, not pedantic.
- **Writing constraints that fail deep inside the body.** Under-specified bounds defer errors to template/trait expansion. State the requirement at the boundary (concept/trait bound) so the error names the type, not a line 40 frames in.
- **Over-constraining or speculatively genericizing.** Requiring more than the algorithm uses shrinks applicability; adding a `<T>` no caller needs adds cost with no benefit. Constrain to the minimum; genericize on the second real type.
- **Ignoring binary/compile-time cost in monomorphized languages.** A pervasively generic header-heavy C++/Rust module can dominate build times and binary size; the "thin generic shell over a non-generic core" pattern exists for exactly this.

---

## Summary

The same `List<T>` rides on **three** different engines, and a senior reasons in terms of which one is running. **Monomorphization** (C++, Rust) emits a specialized copy per concrete type — *zero-cost* speed and full inlining, paid for in code bloat and slow compiles. **Type erasure** (Java) keeps one copy and forgets the type at runtime — small fast-building binaries and seamless backward compatibility, paid for in primitive **boxing** and the inability to do `new T[]`/`T.class`. **Go** splits the difference with **GCShape stenciling + dictionaries** — one copy per memory layout (pointers share one), with type-specific behavior supplied by a runtime dictionary — avoiding both universal boxing and full bloat, but adding indirection that can make generics *not* a guaranteed win over `interface{}`. **Variance** deepens into a positions rule (covariant outputs, contravariant inputs, invariant both), with Java's unsound covariant arrays as the cautionary tale generics were designed to avoid. Good **constraint design** turns inscrutable deep-instantiation errors into "your type doesn't model this concept." And the central judgment is **cost vs benefit**: generics trade duplication for indirection, bloat, and cognitive load — worth it for *two or more* types that truly share behavior behind a readable signature, and over-abstraction otherwise.

---

## Further Reading

- The Rust Reference & "Rust Performance Book" on monomorphization — and the `dyn Trait` chapter for the *erasure-like* alternative Rust also offers.
- *Effective Java* (Bloch), items on generics, bounded wildcards (PECS), and why arrays and generics don't mix.
- The Go blog, "The Generics Implementation" / dictionaries-and-gcshape design docs — the GCShape stenciling approach explained by its authors.
- "C++ Concepts" (the C++20 proposal and Stroustrup's papers) — why explicit constraints fix template error messages.
- Project Valhalla design notes — how Java plans to add value types and *specialized* generics to kill boxing.

---

## Related Topics

- [`middle.md`](middle.md) — constraints, the three polymorphisms, the STL design, variance basics.
- [`professional.md`](professional.md) — generic programming at library scale, concept-based design, higher-kinded types, ABI/compile-time cost.
- [`interview.md`](interview.md) — the trade-offs as Q&A: monomorphization vs erasure, variance, when generics over-engineer.
- [Type Systems → Variance](../../language-internals/type-systems/06-variance/) — the formal positions rule.
- [Type Systems → Generics & Parametric Polymorphism](../../language-internals/type-systems/05-generics-and-parametric-polymorphism/) — the mechanics this style rides on.
- [Refactoring](../../code-craft/refactoring/) — speculative generality as a code smell; when to *remove* over-abstraction.
