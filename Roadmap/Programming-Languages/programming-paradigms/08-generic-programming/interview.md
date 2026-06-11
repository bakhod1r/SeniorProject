# Generic Programming — Interview Q&A

> **Roadmap:** [Programming Paradigms](../README.md) → Generic Programming
>
> *Generic programming means writing an algorithm or data structure **once**, abstracted over the types it operates on, so it serves many types without duplication and without losing type safety. The famous case is a container (`List<T>`, `Vec<T>`); the deeper case is an algorithm decoupled from the types it runs on — the C++ STL. The interesting questions are never the syntax; they're the **trade-offs**: monomorphization vs type erasure, variance, why generics beat `Object`, and when a `<T>` is over-engineering.*

A bank of 40+ interview questions spanning definitions, polymorphism distinctions, implementation strategies, variance, library design, and code-reading. Each answer models the reasoning a strong candidate gives — including the runtime reality underneath. Use the `<details>` toggles to self-quiz: read the question, answer out loud, then expand.

Examples are in **Java**, **Go**, **C++**, and **Rust**, with a **Haskell** aside where the pure form clarifies an idea.

---

## Table of Contents

1. [Fundamentals / Junior](#fundamentals--junior)
2. [Polymorphism & Constraints / Middle](#polymorphism--constraints--middle)
3. [Implementation Strategies / Senior](#implementation-strategies--senior)
4. [Variance](#variance)
5. [Library Design & Frontiers / Staff](#library-design--frontiers--staff)
6. [Code-Reading — What Happens Here?](#code-reading--what-happens-here)
7. [Curveballs](#curveballs)
8. [Rapid-Fire / One-Liners](#rapid-fire--one-liners)
9. [How to Talk About Generics in Interviews](#how-to-talk-about-generics-in-interviews)
10. [Summary](#summary)
11. [Related Topics](#related-topics)

---

## Fundamentals / Junior

> Definitions, the duplication problem, and the "why not `Object`" reasoning.

**Q1. What is generic programming, in one sentence?**

<details><summary>Answer</summary>

Writing an algorithm or data structure **once**, abstracted over the types it operates on, so it works for many types without code duplication and without losing type safety. The two halves both matter: a non-generic per-type function avoids the second problem but not the first; an `Object`/`interface{}` container avoids the first but not the second. Generics give you *both* — flexible **and** type-checked.
</details>

**Q2. What problem does it solve? Give the canonical example.**

<details><summary>Answer</summary>

The **duplication problem**: `maxInt`, `maxDouble`, `maxString` have *identical* bodies and differ only in the type. Without generics you copy-paste the algorithm per type — a maintenance and coverage nightmare (fix a bug in one, miss it in the others; a new type gets no `max` until someone writes another copy). A single generic `max<T>` collapses all copies into one definition that serves every comparable type.
</details>

**Q3. What is a type parameter, and what is instantiation?**

<details><summary>Answer</summary>

A **type parameter** is a placeholder for a type, supplied later — the `T` in `List<T>` or `max<T>` (`[T any]` in Go). **Instantiation** is filling that blank with a concrete type: `List<T>` becomes `List<String>`. The type parameter is a *blank for a type*, decided at compile time (usually by inference), not a value passed at run time. `List<String>` and `List<Integer>` are different *types*.
</details>

**Q4. Why is `List<String>` better than a `List` of `Object`?**

<details><summary>Answer</summary>

Two concrete wins. **Type safety:** the compiler rejects `add(42)` into a `List<String>` at compile time; with `List<Object>` anything goes in and you only discover the mistake when a cast crashes at runtime (`ClassCastException`). **No casts:** `get` returns `String` directly, not `Object` you must cast back — casts are noise *and* a place to be wrong. Generics keep the type **flexible *and* checked**; `Object`/`interface{}` is flexible but unchecked.
</details>

**Q5. Is generic programming only about containers?**

<details><summary>Answer</summary>

No — that's the famous case, not the whole story. *Algorithms* are generic too: `sort`, `find`, `max`, `map`. The C++ STL's power comes precisely from generic *algorithms* decoupled from containers. A generic algorithm parameterized over its element type is generic programming at its purest; containers are just the most visible example because everyone uses `List<T>`.
</details>

**Q6. Can you do *anything* with an unconstrained `T`?**

<details><summary>Answer</summary>

Almost nothing useful — only move it around: store it, return it, pass it on. You **can't** call `a > b`, `a.length()`, or `a + b`, because the compiler knows nothing about `T` and not every type supports those. To *operate* on `T` you need a **constraint** (a bound) that promises the operations exist. Unconstrained generics are for plumbing (containers, `identity`, `swap`); constrained generics are where algorithms live.
</details>

**Q7. Show the same generic function in two languages.**

<details><summary>Answer</summary>

```go
func First[T any](s []T) T { return s[0] }     // Go: [T any]
```
```rust
fn first<T>(items: &[T]) -> &T { &items[0] }   // Rust: <T>
```

Same idea, different spelling: one body, the type left blank, inferred from the call. Java would be `<T> T first(List<T> xs)`, C++ `template<typename T> T first(const std::vector<T>&)`.
</details>

---

## Polymorphism & Constraints / Middle

> The three polymorphisms, bounds, the STL design, inference.

**Q8. Parametric vs ad-hoc vs subtype polymorphism — distinguish all three.**

<details><summary>Answer</summary>

- **Parametric** (generics): **one** body that works *uniformly* for all types — `max<T>`, `List<T>`. The same code runs for every type, so it can't depend on type-specific behavior without a constraint.
- **Ad-hoc** (overloading): **several** bodies sharing a name, the compiler picks by argument type — `print(int)` vs `print(String)`, operator `+` for numbers vs strings. Each body can do something type-specific.
- **Subtype** (inclusion): **one** call site, a supertype reference dispatches to a subtype's implementation at **run time** — `shape.area()` → `Circle.area()`.

Generics are *parametric*; the muddle is calling overloading "generics." A constraint like `T extends Comparable` is how parametric code reaches type-specific behavior — it borrows ad-hoc/subtype dispatch to fill the hole.
</details>

**Q9. What is a bounded type parameter / constraint, and why do you need one?**

<details><summary>Answer</summary>

A constraint narrows "any `T`" to "any `T` that supports *these operations*." It does two jobs: **grants** the algorithm the right to use those operations on `T`, and **rejects** types that don't qualify — at compile time. `<T extends Comparable<T>>` (Java), `T: PartialOrd` (Rust), `[T cmp.Ordered]` (Go), `requires std::totally_ordered<T>` (C++20), `(Ord a) =>` (Haskell) all say the same thing: "T can be anything, *provided* it offers comparison." Without it, you can't write `a > b` inside the generic body.
</details>

**Q10. What are C++20 concepts and why were they added?**

<details><summary>Answer</summary>

A **concept** is a named, compiler-checkable predicate on types — a first-class name for a constraint. Before them, C++ template constraints were *implicit* ("if it compiles, it works"), so a type mismatch failed *deep inside* the template with infamous walls of instantiation noise. Concepts move the error **to the boundary**: `sum(vector<NotAddable>)` reports "constraint `Addable` not satisfied" instead of 40 frames of expansion. They also enable cleaner requirement-based overloading via subsumption, replacing `enable_if`/SFINAE hacks. They were the most-requested C++ feature for a decade for exactly the error-message reason.
</details>

**Q11. Explain the STL's design and why it's the canonical generic library.**

<details><summary>Answer</summary>

The STL decouples **containers** (own the storage, generic over element type), **iterators** (a generic abstraction of "a position in a sequence"), and **algorithms** (generic over *iterators*, not containers). Because `sort`/`find` are written against iterators, **one** `find` works on a `vector`, `list`, `deque`, array, or stream — anything that exposes iterators. The economic payoff: *M* algorithms and *N* containers cost **M + N** pieces of code, not M × N. Add a container exposing iterators and every algorithm works on it for free; add an algorithm and it works on every container. The iterator is the *interface* that lets algorithms ignore container internals — "program to a concept, not a concrete type."
</details>

**Q12. How does type inference work for generics, and when does it give up?**

<details><summary>Answer</summary>

The compiler deduces type arguments from the *arguments' types* at the call: `max(2.0, 3.0)` sets `T = f64`; `vec![1,2,3]` infers `Vec<i32>`. You rarely write type arguments. Inference **gives up** when the type parameter doesn't appear in the arguments — e.g. it's only in the return type (`Collections.emptyList()`) — then you annotate explicitly (`Vec::<i32>::new()`, `Max[int](...)`). Inference power varies: Rust/C++ infer aggressively, Go 1.18 started limited, Java is solid for arguments but weak across long generic chains.
</details>

---

## Implementation Strategies / Senior

> Monomorphization vs erasure vs Go's dictionaries — the heart of the topic.

**Q13. What is monomorphization, and who uses it? What are the trade-offs?**

<details><summary>Answer</summary>

The compiler generates a **separate specialized copy** of the generic code per concrete type. `Vec<i32>` and `Vec<String>` become two distinct concrete structures; after monomorphization no generic code remains at runtime. **C++ templates** and **Rust generics** do this. **Upsides:** no boxing (values stored inline), full **inlining and optimization** → "zero-cost abstraction," the generic compiles to what you'd write by hand. **Downsides:** **code bloat** (a function used with 20 types → 20 copies, instruction-cache pressure) and **slow compiles** (codegen per instantiation — a major reason C++/Rust builds are slow).
</details>

**Q14. What is type erasure, and what does it cost?**

<details><summary>Answer</summary>

The compiler uses type parameters to *type-check*, then **erases** them, compiling **one** copy that treats `T` as its bound (`Object` if unbounded) and inserting casts at use sites. **Java** does this: at runtime `List<String>` and `List<Integer>` are *both just* `List` (`a.getClass() == b.getClass()` is `true`). **Upsides:** one copy → no bloat, fast compiles, small binaries, and it let Java add generics in 1.5 *without changing the JVM* (backward compatibility). **Downsides:** primitives must be **boxed** (`List<Integer>` stores heap `Integer` objects, not raw `int`s — slow and fat vs `int[]`), and the type isn't available at runtime (no `new T[]`, no `x instanceof T`, no `T.class`).
</details>

**Q15. How do Go generics work, and are they always faster than `interface{}`?**

<details><summary>Answer</summary>

Go uses **GCShape stenciling with dictionaries**. It generates one copy per **GCShape** — types sharing a memory layout from the GC's view — and crucially *all pointer types share one GCShape*, so `*User`, `*Order`, `string`, `[]byte` collapse to a single stenciled copy. Since one stencil serves many types, type-specific info (method pointers, type descriptors) is supplied at runtime via a hidden **dictionary** argument — conceptually like how Haskell implements typeclasses. This avoids both Java-style universal boxing and full monomorphization bloat. **But** dictionary indirection means some calls can't inline, so Go generics are **not** reliably faster than a well-predicted `interface{}` call — measure on hot paths.
</details>

**Q16. Put monomorphization, erasure, and Go's approach on a trade-off axis.**

<details><summary>Answer</summary>

It's a **speed ↔ binary-size ↔ compile-time** triangle, no free lunch:

| | Monomorphization (C++/Rust) | Erasure (Java) | GCShape+dict (Go) |
|---|---|---|---|
| Copies | one per type | one total | one per GCShape |
| Primitives | inline | **boxed** | keep layout |
| Inlining | full (zero-cost) | limited | partial (dict indirection) |
| Binary size | bloat | small | middle |
| Compile time | slow | fast | middle |
| `new T[]`/`T.class` | yes | **no** (erased) | partial |

Rust/C++ buy speed with bloat + slow builds; Java buys small fast-building binaries with boxing + lost runtime types; Go splits the difference.
</details>

**Q17. Are generics always faster than using `Object`/`interface{}`/`any`?**

<details><summary>Answer</summary>

No. Generics' *guaranteed* win is **type safety**, not speed. In Java, `List<Integer>` **boxes** and can lose to a primitive `int[]`; in Go, dictionary-passing generics can lose to a well-predicted interface call. Monomorphized Rust/C++ generics *are* typically as fast as hand-written code, but at the cost of binary size and compile time. The honest framing: generics buy you compile-time safety and one source of truth; whether they're *faster* than the dynamic alternative depends on the language's strategy — profile, don't assume.
</details>

**Q18. Why can't a Java generic do `new T[n]` or `x instanceof T`?**

<details><summary>Answer</summary>

Because of **erasure** — at runtime `T` is gone (it's the bound, usually `Object`), so there's no runtime type to allocate an array of or test against. The workarounds are passing a `Class<T>` token explicitly (`Array.newInstance(clazz, n)`) or `@SuppressWarnings("unchecked")` casts. This is the price of erasure's small-binary, backward-compatible design: you trade runtime type information for it. Monomorphized languages (Rust/C++) *can* do the equivalent because the concrete type is baked into each copy.
</details>

---

## Variance

> The `List<Cat>` / `List<Animal>` question and the rules behind it.

**Q19. If `Cat` is a subtype of `Animal`, is `List<Cat>` a subtype of `List<Animal>`?**

<details><summary>Answer</summary>

**No** — generic types are **invariant** by default, and for a good reason. If `List<Cat>` *were* a `List<Animal>`, you could view your cat list through the `Animal` type and `add(new Dog())` — smuggling a `Dog` into a list of `Cat`s — then read it back as a `Cat` and crash. To keep that hole closed, `List<Cat>` and `List<Animal>` are *unrelated types* regardless of how `Cat`/`Animal` relate. Variance annotations let you *safely* relax this when the type only produces or only consumes its parameter.
</details>

**Q20. Define covariance, contravariance, and invariance, with the safe-use rule.**

<details><summary>Answer</summary>

- **Invariant** (default): `G<Cat>` and `G<Animal>` unrelated. Safe for mutable containers (read *and* write).
- **Covariant** (`? extends`, `out`): `Cat <: Animal` ⟹ `G<Cat> <: G<Animal>`. Safe when the type only **produces/reads** `T` (a source). Java's `List<? extends Animal>` lets you *read* `Animal`s but forbids `add`.
- **Contravariant** (`? super`, `in`): the relationship flips. Safe when the type only **consumes/writes** `T` (a sink). `Comparator<? super Cat>`.

The positions rule: **output positions can be covariant, input positions contravariant, both → invariant.** Java's mnemonic is **PECS** — Producer `extends`, Consumer `super`.
</details>

**Q21. Why are Java arrays a cautionary tale for variance?**

<details><summary>Answer</summary>

Java made arrays **covariant** — `String[]` *is* an `Object[]` — which is **unsound**. You can assign a `String[]` to an `Object[]` variable and then store an `Integer` into it; that compiles but throws `ArrayStoreException` at runtime, a type error deferred to a per-write runtime check. Generics deliberately learned from this and are **invariant by default** to avoid repeating the mistake. It's the textbook example of why "intuitive" covariance for mutable containers breaks type safety.
</details>

**Q22. Use-site vs declaration-site variance — what's the difference?**

<details><summary>Answer</summary>

**Use-site** (Java wildcards): the *caller* annotates each use — `List<? extends Animal>`. Flexible but verbose; PECS everywhere. **Declaration-site** (C#, Kotlin, Scala): the *type author* annotates the parameter once — Kotlin `out T` / `in T` — and the compiler *enforces* that `out T` appears only in output positions, so the type is safe by construction and callers write nothing. Declaration-site front-loads the work onto the author for cleaner call sites; use-site distributes it to every caller.
</details>

---

## Library Design & Frontiers / Staff

> Concept-driven design, traits, higher-kinded types, ABI.

**Q23. What does "generic programming as a design discipline" mean (the Stepanov view)?**

<details><summary>Answer</summary>

It means the unit of design is the **concept** — the *named, minimal set of requirements* an algorithm places on its operands — not the function. The methodology: write concrete algorithms, factor out the *least* each needs from its inputs, name those requirements as concepts, and you get a library where the cross-product of algorithms and types composes for free. The STL embodies this — `sort` requires *random-access iterators* + a *strict weak ordering*, not "a `vector`." Requirement *discovery* ("what's the weakest concept that makes this correct?") is the real skill, far more than writing `<T>`.
</details>

**Q24. Why is Rust's trait system considered a strong model for generic programming?**

<details><summary>Answer</summary>

Four reasons. **Explicit bounds** (`T: Ord`) → errors name the unmet trait at the boundary. **Coherence** (the orphan rule): a trait impl for a type is *globally unique*, so generic behavior is unambiguous (Haskell shares this; C++ concepts and Go constraints don't). **Associated types** (`type Item`): a trait declares output types, so generic code can name "this iterator's element type" without an extra parameter. **Dual dispatch**: the *same* trait powers static monomorphized dispatch (`fn f<T: Trait>`) *and* dynamic vtable dispatch (`&dyn Trait`) — exposing the senior-level monomorphization-vs-erasure choice as a per-call-site knob. Newer languages (Swift protocols, Carbon interfaces) converge on this model.
</details>

**Q25. What are higher-kinded types, and why can't you write "one `map` for all containers" in Java/Go/Rust?**

<details><summary>Answer</summary>

Ordinary generics parameterize over a *type* (`List<T>` abstracts the element). **HKTs** parameterize over a *type constructor* — over `List`/`Option`/`Future` *as a thing*, written `F<_>`. Haskell's `Functor f` abstracts over `f`, a one-argument type constructor, so `fmap` is **one** `map` for every container. Java, Go, C#, and (so far) Rust **lack HKTs** — they can parameterize over `T` but not over `F<_>` — so you *cannot* unify all containers' `map` into one abstraction; each gets its own (`Stream.map`, `Optional.map`, …), and "monad" can't be a reusable interface, only a per-type pattern. Mainstream languages omit HKTs deliberately: they complicate inference and the type checker and raise the learning curve steeply. It's the clearest *ceiling* on how generic these languages let you be.
</details>

**Q26. How does the generic implementation strategy affect ABI and binary distribution?**

<details><summary>Answer</summary>

**Monomorphization breaks ABI stability.** Because C++/Rust generate code per instantiation *at the call site*, generic code lives in the *caller's* binary, not the library's — so generic library code generally **can't cross a stable ABI boundary** (change the template, recompile every caller). That's why generic-heavy C++ is effectively *header-only* and Rust generics don't cross its ABI. **Type-erased** generics (Java) *do* cross cleanly — one compiled `List` serves all callers. So erasure has a real, underrated advantage for *binary* library distribution, and monomorphization's "zero cost" hides a build-time and ABI cost.
</details>

**Q27. When are generics over-engineering? Where's the threshold?**

<details><summary>Answer</summary>

Generics over-abstract when: only **one** type ever uses it (`Repository<T>` with a single `Repository<User>` — write `UserRepository`); the "shared" algorithm sprouts `if (type == X)` special cases (the types don't actually share behavior); the generic signature is harder to read than the duplication it removes; or you added a `<T>` "for future flexibility" no caller needs (speculative generality, a code smell). The threshold is **two or more real types that share the *same* behavior, behind a signature a teammate can read.** Below that, the concrete version wins — duplication you can see beats abstraction you can't understand. YAGNI applies to type parameters.
</details>

**Q28. What is template metaprogramming, and how does it relate to generic programming?**

<details><summary>Answer</summary>

C++ templates are Turing-complete, so generic machinery can *compute at compile time* — **TMP**. It started as an accident (Unruh's 1994 prime-printing program via compiler errors) and grew into type traits (`is_integral`), compile-time selection (`enable_if`/SFINAE), and `constexpr`. The conceptual link: *once you can abstract over types, you're a step from computing over them*, moving work from run time to compile time (validation, lookup tables, unit-checking types). It's generic programming's most extreme expression — and a boundary case that shades into a different concern, which is why modern C++ steers it toward readable `constexpr`/concepts rather than recursive-template dark arts. Rust `const` generics and Zig `comptime` answer the same impulse.
</details>

**Q29. When would you choose dynamic dispatch (`dyn Trait`, `Object`) *over* generics?**

<details><summary>Answer</summary>

When you need a **heterogeneous collection** (a `Vec<Box<dyn Draw>>` holding different concrete types — monomorphized generics can't, since each `T` is one type), when **binary size** matters more than the last ounce of speed (one vtable-dispatched copy vs many monomorphized copies), when you want a **stable ABI** across a library boundary, or when the concrete type genuinely isn't known until runtime (plugin loaded by name). Generics (static dispatch) win for homogeneous, hot-path, type-safe code; dynamic dispatch wins for heterogeneity, code-size, and runtime-decided types. Rust exposing both from one trait is the clean illustration of the trade.
</details>

---

## Code-Reading — What Happens Here?

> You're shown a snippet; say what compiles, what it costs, and why.

**Q30. Java — does this compile? What's stored?**

```java
List<Integer> xs = new ArrayList<>();
xs.add(1); xs.add(2);
int sum = 0;
for (int x : xs) sum += x;
```

<details><summary>Answer</summary>

It compiles and works, but `List<Integer>` **boxes**: each `1`, `2` is stored as a heap `Integer` object, not a raw `int`, and the `for` loop **auto-unboxes** each back to `int`. So this allocates per element and chases pointers — far slower and fatter than an `int[]`. That's erasure's cost: the one compiled `List` works on `Object`, so primitives can't be stored inline. Project Valhalla aims to fix exactly this with value types and specialized generics.
</details>

**Q31. Java — why doesn't this compile?**

```java
static <T> T[] makeArray(int n) {
    return new T[n];           // ???
}
```

<details><summary>Answer</summary>

It **doesn't compile**: you can't do `new T[n]` because `T` is **erased** — at runtime there's no `T` to allocate an array of. The fix is to pass a runtime type token and use reflection: `static <T> T[] makeArray(Class<T> cls, int n) { return (T[]) Array.newInstance(cls, n); }`, or use a `List<T>` instead of an array. This is a direct, frequently-asked consequence of type erasure.
</details>

**Q32. Rust — how many copies of `print_all` does the compiler emit?**

```rust
fn print_all<T: std::fmt::Debug>(xs: &[T]) {
    for x in xs { println!("{:?}", x); }
}
fn main() {
    print_all(&[1, 2, 3]);
    print_all(&["a", "b"]);
}
```

<details><summary>Answer</summary>

**Two** — Rust **monomorphizes**: one specialized copy for `T = i32` and a separate one for `T = &str`, each with `Debug` formatting inlined for that concrete type. There's no generic code or dictionary at runtime; both copies are fully concrete, fast, and inlinable — at the cost of two copies in the binary. Use it with ten types and you'd get ten copies. (The `dyn` alternative — `&[&dyn Debug]` — would emit *one* vtable-dispatched copy instead.)
</details>

**Q33. Go — what does this print, and what's the runtime mechanism?**

```go
func Map[T, U any](s []T, f func(T) U) []U {
    r := make([]U, len(s))
    for i, v := range s { r[i] = f(v) }
    return r
}
// Map([]int{1,2,3}, func(x int) string { return fmt.Sprint(x*x) })
```

<details><summary>Answer</summary>

It returns `["1","4","9"]`. Mechanism: Go compiles `Map` via **GCShape stenciling** — `int` and `string` here have distinct GCShapes, but the generic code is shared per shape with a hidden **dictionary** supplying type-specific operations. This is a clean generic `map` Go couldn't write before 1.18 (you'd have used `interface{}` and type assertions). Note: Go still has no *built-in* generic `Map` in the standard library by default for slices beyond the `slices`/`maps` helpers — `map`/`filter` aren't built in the way `len`/`append` are.
</details>

**Q34. Java — why is the `add` line an error?**

```java
List<? extends Number> nums = new ArrayList<Integer>();
Number n = nums.get(0);     // (1)
nums.add(42);               // (2) ???
```

<details><summary>Answer</summary>

Line (1) is fine — a `? extends Number` is a **producer**, you can *read* a `Number` out. Line (2) is a **compile error**: with `? extends Number`, the compiler doesn't know the *exact* element type (it could be `List<Integer>`, `List<Double>`, …), so it can't let you `add` anything (except `null`) — adding a `42` (`Integer`) to what might be a `List<Double>` would break type safety. That's the **PECS** rule: a `? extends` producer is read-only. To add, you'd need `? super` (a consumer).
</details>

**Q35. C++ — what's the difference in error quality between these two?**

```cpp
template <typename T> T mx(T a, T b) { return a > b ? a : b; }           // (A) unconstrained
template <std::totally_ordered T> T mx2(T a, T b) { return a > b ? a : b; } // (B) concept
```

<details><summary>Answer</summary>

Functionally identical for valid types. The difference is the **error message** when you pass a type without `>`. (A) fails *inside* the template body — "no match for `operator>`" pointing into `mx`, with "instantiated from here" noise — a deep, confusing error. (B) fails *at the call site*: "constraint `totally_ordered<T>` not satisfied" — naming the unmet requirement up front. This is the entire motivation for C++20 concepts: move the error from deep instantiation to the boundary.
</details>

---

## Curveballs

> Questions designed to catch glib answers.

**Q36. "Generics are just a fancy `Object` with casts the compiler writes for you." True?**

<details><summary>Answer</summary>

That's *literally true for Java's erasure implementation* (the compiler inserts the casts you'd otherwise write) — but it's the wrong mental model in general. In Rust/C++, generics are **monomorphized** to concrete, unboxed, fully-inlined code with *no* `Object`, no casts, no boxing — the opposite of "Object with casts." So the statement describes *one implementation strategy*, not generics. The portable truth: generics are *one definition over a type parameter, checked at compile time*; how that's realized (erasure-with-casts, monomorphization, dictionaries) is a per-language choice with very different costs.
</details>

**Q37. Are templates and generics the same thing?**

<details><summary>Answer</summary>

Same *paradigm* (parametric polymorphism), different *semantics*. C++ **templates** are monomorphized and were historically *duck-typed at instantiation* ("if it compiles for this type, it works") — no declared constraints pre-C++20, so errors surfaced deep inside. Java/C# **generics** are *constraint-checked up front* (bounded type parameters) and (Java) erased. So templates are more powerful in some ways (full compile-time computation, non-type parameters) and weaker in others (historically no real constraints, terrible errors). "Generics" usually implies the checked-up-front flavor; "templates" the monomorphized, late-checked C++ flavor.
</details>

**Q38. Can you overload a method on `List<String>` vs `List<Integer>` in Java?**

<details><summary>Answer</summary>

**No** — because of **erasure**, both have the same runtime type `List`, so the two overloads `f(List<String>)` and `f(List<Integer>)` would erase to the *same* signature `f(List)`, which is a compile error ("name clash: both have the same erasure"). This is a classic erasure leak: types that are distinct at compile time become indistinguishable at the JVM level, so they can't be used to differentiate overloads. In a monomorphized language the two are genuinely distinct types.
</details>

**Q39. Does adding a generic parameter ever make code *worse*?**

<details><summary>Answer</summary>

Frequently. A `<T>` used by exactly one type is pure ceremony (`Repository<T>` → just write `UserRepository`). A generic whose body is full of `instanceof`/type checks is a false abstraction forcing unrelated types together. A signature like `<R, T extends Comparable<? super T> & Serializable>` can cost more reading time than the duplication it removed. In monomorphized languages, an over-used generic also bloats the binary and slows compiles. Generics earn their keep at **two-plus types sharing the same behavior behind a readable signature** — below that, they make code worse.
</details>

**Q40. Can two `List<T>` instantiations share code, or is it always separate?**

<details><summary>Answer</summary>

Depends on the strategy. **Java (erasure):** *one* `List` class, fully shared — `List<String>` and `List<Integer>` are the same code. **C++/Rust (monomorphization):** *separate* code per type, nothing shared. **Go (GCShape):** *partially* shared — `List[*User]` and `List[*Order]` share a stencil (both pointer-shaped), but `List[int]` gets its own. So "do instantiations share code?" is one of the sharpest ways to reveal which implementation strategy a language uses.
</details>

**Q41. Is `interface{}`/`any` ever the right choice over generics?**

<details><summary>Answer</summary>

Yes — when the data is *genuinely heterogeneous* and you don't have a single type relationship to capture: a JSON document (`map[string]any`), a generic event bus carrying unrelated payloads, a `printf`-style varargs API. Generics shine when *one* algorithm serves *many but uniform* types; `any`/`interface{}` is right when there's no uniform type at all and you'll branch on the dynamic type anyway. Forcing generics onto truly heterogeneous data produces tortured signatures; reaching for `any` on uniform data throws away safety. Match the tool to whether the types are *uniform* or *heterogeneous*.
</details>

---

## Rapid-Fire / One-Liners

> Crisp answers; what an interviewer wants in one or two sentences.

**Q42. Generic programming in one line?**

<details><summary>Answer</summary>

Write the algorithm/data structure once, abstracted over its types, so it serves many types without duplication or loss of type safety.
</details>

**Q43. Monomorphization vs type erasure in one line each?**

<details><summary>Answer</summary>

Monomorphization = a specialized copy per type (fast, bloated — Rust/C++). Erasure = one copy, type forgotten at runtime (small, boxed — Java).
</details>

**Q44. Why is `List<Cat>` not a `List<Animal>`?**

<details><summary>Answer</summary>

Invariance for safety — otherwise you could add a `Dog` through the `Animal` view and corrupt the cat list.
</details>

**Q45. PECS stands for?**

<details><summary>Answer</summary>

Producer `extends`, Consumer `super` — the rule for safe covariant/contravariant wildcards in Java.
</details>

**Q46. One reason generics beat `Object`/`interface{}`?**

<details><summary>Answer</summary>

The type survives — the compiler catches type errors at compile time and you need no casts.
</details>

**Q47. Why are C++ template error messages historically awful?**

<details><summary>Answer</summary>

Pre-C++20 templates had no declared constraints, so type errors surfaced deep inside instantiation instead of at the call site; concepts fix this.
</details>

**Q48. Why does Java box `List<Integer>`?**

<details><summary>Answer</summary>

Erasure compiles one `List` over `Object`, and `Object` can't hold a raw `int`, so primitives become heap `Integer` objects.
</details>

**Q49. What's a higher-kinded type, in a phrase?**

<details><summary>Answer</summary>

A type parameter that is itself a type constructor (`F<_>`) — lets you write one `map`/`Functor` for all containers; absent from Java/Go/Rust.
</details>

**Q50. When is a `<T>` over-engineering?**

<details><summary>Answer</summary>

When only one type ever uses it, or the body is full of type checks — abstract on the *second* real type, not speculatively.
</details>

---

## How to Talk About Generics in Interviews

A few habits separate a strong answer from a textbook recital:

- **Lead with the dual goal.** "Generics give you flexibility *and* type safety — unlike `Object`, which keeps flexibility but loses safety, or per-type functions, which keep safety but duplicate." This framing shows you understand *why* generics exist, not just *what* they are.
- **Keep the three polymorphisms straight.** Parametric (one body, generics), ad-hoc (overloading, many bodies), subtype (runtime dispatch). Conflating overloading with generics is a junior tell.
- **Own the implementation trade-off.** Monomorphization (fast, bloated) vs erasure (small, boxed) vs Go's dictionaries — and the consequences (`new T[]`, `List<Integer>` boxing, ABI). This is the single most differentiating area; have the table in your head.
- **Resist absolutism.** "Generics are always faster than `interface{}`" is wrong; "always use generics" is wrong. Their guaranteed win is *type safety*; speed depends on strategy. "It depends, and here's on what" beats a slogan.
- **Use the variance hole.** The `Dog`-in-cats / `ArrayStoreException` example explains invariance, covariance, and PECS in one breath and shows you understand *why*, not just the rule.
- **Name the STL design.** Containers + iterators + algorithms, *M + N* not *M × N* — it's the canonical generic-programming insight and signals you know the discipline, not just the syntax.
- **Know the ceiling.** Mentioning higher-kinded types (and that Java/Go/Rust lack them) shows you see where generic programming *stops* in mainstream languages — a staff-level signal.

---

## Summary

- **Generic programming** = write the algorithm/data structure **once**, over a type parameter, so it serves many types with **no duplication and no loss of type safety** — flexible *and* checked, beating both per-type copy-paste and the `Object`/`interface{}` escape hatch. The famous case is a container; the deep case is an *algorithm* decoupled from its types (the STL).
- The junior bar is the **duplication problem**, **type parameters/instantiation**, and **why not `Object`**; the middle bar is the **three polymorphisms**, **constraints/bounds/concepts**, the **STL's containers+iterators+algorithms** design, and **inference**; the senior bar is the **implementation strategies** — **monomorphization** (fast, bloated), **type erasure** (small, boxed, no `new T[]`), and **Go's GCShape+dictionaries** — plus **variance** in depth and the **cost** of abstraction; the staff bar is **concept-driven library design**, **Rust's trait system**, **higher-kinded types and their deliberate absence**, **ABI/compile-time leakage**, and **template metaprogramming**.
- The strongest answers lead with the **dual goal** (flexibility + safety), name the **implementation trade-off** and its consequences (boxing, `new T[]`, ABI, binary size), explain **invariance via the `Dog`-in-cats hole**, and resist absolutism — generics' guaranteed win is *type safety*, not speed, and a `<T>` no one needs is over-engineering, not future-proofing.

---

## Related Topics

- [`junior.md`](junior.md) — the duplication problem, type parameters, generic containers, generics vs `Object`.
- [`middle.md`](middle.md) — the three polymorphisms, constraints, the STL design, inference, variance basics.
- [`senior.md`](senior.md) — monomorphization vs erasure vs Go's dictionaries, variance in depth, constraint/error design, the cost of abstraction.
- [`professional.md`](professional.md) — generic programming at library scale, concept-based design, Rust traits, higher-kinded types, ABI, TMP.
- [Type Systems → Generics & Parametric Polymorphism](../../language-internals/type-systems/05-generics-and-parametric-polymorphism/) · [Variance](../../language-internals/type-systems/06-variance/) · [Higher-Kinded Types](../../language-internals/type-systems/09-higher-kinded-types/) — the type-system mechanics.
- [Functional Programming](../../code-craft/functional-programming/) — typeclasses and constrained parametric polymorphism in the FP tradition.
