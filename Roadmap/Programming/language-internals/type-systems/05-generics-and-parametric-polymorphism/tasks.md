# Generics & Parametric Polymorphism — Tasks & Exercises

> **Topic:** [Generics & Parametric Polymorphism](README.md)
> **Focus:** Hands-on exercises that build intuition for parametric polymorphism, the implementation strategies (monomorphization / erasure / reified / hybrid), free theorems, and the production trade-offs. Each task has a **self-check**, a **hint**, and (for the harder ones) a **sparse solution sketch** — write your answer first, then compare.

---

## How to Use This Page

Work top to bottom; difficulty rises. For coding tasks, *run* your code — generics behavior (especially boxing and erasure) is the kind of thing that surprises you only when measured. For reasoning tasks, write your answer down *before* expanding the hint or solution. The goal isn't to get the "right" answer fast; it's to be able to *predict* what each language's generics will do and *why*.

Pick a primary language you're comfortable in, but for the cross-language tasks, try at least two of {Java, C#, Go, Rust, C++, TypeScript, Haskell} — the *contrast* is where the learning is.

---

## Tier 1 — Foundations (Junior)

### Task 1.1 — Replace `Object` with `<T>`

Take this pre-generics container and make it generic. Remove every cast.

```java
class ObjectStack {
    private java.util.List items = new java.util.ArrayList();
    void push(Object item) { items.add(item); }
    Object pop() { return items.remove(items.size() - 1); }
}
// Usage today:  String s = (String) stack.pop();   // cast, can throw at runtime
```

**Self-check:** After your change, the usage line should be `String s = stack.pop();` with *no cast*, and trying to `push` a non-`String` onto a `Stack<String>` should be a *compile* error, not a runtime one.

<details>
<summary>Hint</summary>

Add a type parameter `<T>` to the class, replace every `Object` with `T`, and make the backing list `List<T>`. Instantiate as `Stack<String>`.
</details>

---

### Task 1.2 — Write `identity`, `first`, and `pair`

In your language, implement three generic functions:

- `identity<T>(x: T) -> T`
- `first<T>(items: List<T>) -> T` (returns element 0)
- `pair<A, B>(a: A, b: B) -> (A, B)`

**Self-check:** None of them should need a cast, a bound, or any type-specific code. If you reached for a bound, you over-constrained. Confirm `identity` works for `int`, `String`, and a custom type without changes.

<details>
<summary>Hint</summary>

These are the *maximally* parametric functions — their bodies can only move values around, never inspect them. That's the point. If the compiler complains you need a bound, you tried to do something type-specific (don't).
</details>

---

### Task 1.3 — Why doesn't this compile?

Explain, in one sentence each, why the body fails for an *unbounded* `T`:

```text
fn mystery<T>(a: T, b: T) -> T {
    if a < b { return a; }     // (1)
    let x: T = new T();        // (2)
    print(a.name);             // (3)
    return b;
}
```

**Self-check:** Your three explanations should all reduce to the same root cause: an unbounded `T` is an *opaque box* the function can't inspect, construct, or assume structure about.

<details>
<summary>Solution</summary>

(1) `<` requires `T` to be comparable/ordered — needs a bound like `T: Ord`/`Comparable`. (2) `new T()` requires knowing `T`'s constructor — needs reification or a factory/`Default` bound. (3) `.name` requires `T` to have that field — needs a bound describing the structure. Root cause: unbounded `T` is opaque; you can only hold, move, and store it.
</details>

---

### Task 1.4 — Generic type vs. generic method

Write a non-generic class containing a generic *method*, and a generic *class* containing a non-generic method. Confirm you understand they're independent.

**Self-check:** Your generic method should declare its *own* type parameter (e.g. `<U> U echo(U x)`) inside an otherwise plain class. Your generic class (`Box<T>`) should have a method like `boolean isEmpty()` that uses no type parameter of its own.

---

## Tier 2 — Implementation Strategies (Middle)

### Task 2.1 — Observe boxing

In Java (or Scala/Kotlin on the JVM), benchmark summing a `List<Integer>` of 10 million elements vs. an `int[]` of the same. Measure both time and allocations (use an allocation profiler or `-verbose:gc`).

**Self-check:** The `int[]` version should be *several times faster* and allocate essentially nothing in the loop, while the `List<Integer>` version allocates millions of `Integer` objects. If you don't see a difference, your JIT may have optimized the boxing away — increase N and ensure the result is used (print it) so it isn't dead-code-eliminated.

<details>
<summary>Hint</summary>

`List<Integer>` *must* box because erasure makes the list operate on `Object`. The `int[]` stores contiguous primitives with no boxing. This is the erasure boxing tax made visible.
</details>

---

### Task 2.2 — Trigger the same-erasure error

In Java, write a class with two overloads `void process(List<String>)` and `void process(List<Integer>)`. Observe the compile error. Then explain why C++ (`void process(std::vector<std::string>)` + `void process(std::vector<int>)`) accepts the equivalent.

**Self-check:** Java reports "name clash: both methods have the same erasure." C++ compiles fine. You should be able to state *exactly why*: erasure collapses both Java signatures to `process(List)`; monomorphization keeps the C++ types genuinely distinct.

---

### Task 2.3 — `new T()` across three languages

Implement a generic `Factory` that constructs a fresh `T` in: (a) C#, (b) Java, (c) Rust. Note how the design *changes* per language.

**Self-check:** C# uses `where T : new()` and `new T()` directly. Java *cannot* do `new T()` — you must pass a `Supplier<T>`/`Class<T>`. Rust requires a bound: `T: Default` (then `T::default()`) or a closure. If your three designs are identical, you missed the point — the difference *is* the lesson.

<details>
<summary>Solution sketch</summary>

```csharp
class Factory<T> where T : new() { public T Make() => new T(); }     // C#: reified
```
```java
class Factory<T> {                                                    // Java: erased
    private final java.util.function.Supplier<T> ctor;
    Factory(java.util.function.Supplier<T> c) { ctor = c; }
    T make() { return ctor.get(); }
}
```
```rust
fn make<T: Default>() -> T { T::default() }                          // Rust: mono + bound
```
Unifying idea: erased/monomorphized languages can't conjure a `T`; you pass the construction capability in. Reification lets the runtime supply it.
</details>

---

### Task 2.4 — The super-type-token trick

In Java, implement a `TypeRef<T>` abstract class that recovers `T` at runtime via `getGenericSuperclass()`. Use it as `new TypeRef<java.util.List<String>>(){}` and print the recovered type.

**Self-check:** Printing should show `java.util.List<java.lang.String>` (the full parameterized type), proving you recovered information that plain erasure removed. If you get a raw `List`, you didn't subclass via an anonymous class — the trick *requires* the anonymous subclass so the type argument lands in the superclass metadata.

<details>
<summary>Hint</summary>

Cast `getClass().getGenericSuperclass()` to `ParameterizedType` and read `getActualTypeArguments()[0]`. Reflect on why a *subclass's* superclass-type-argument survives erasure while a *class's own* `T` does not.
</details>

---

### Task 2.5 — Predict, then verify, Go's behavior

Write a generic `Max[T constraints.Ordered](a, b T) T` in Go and call it with `int`, `float64`, and `string`. Before running, predict: will Go monomorphize per type, or share code? Then read about GC-shape stenciling and confirm your mental model.

**Self-check:** You should be able to explain that Go emits a copy *per GC shape* (not per type) and passes a hidden *dictionary* of type operations — a hybrid between full monomorphization and full boxing. Your prediction should account for "fewer copies than Rust, some runtime indirection."

---

## Tier 3 — Parametricity & Free Theorems (Senior)

### Task 3.1 — Enumerate the inhabitants

For each type, list *every* total, pure function that inhabits it (in an idealized parametric language, ignoring bottom):

1. `forall T. T -> T`
2. `forall A B. A -> B -> A`
3. `forall T. T -> T -> T`
4. `forall T. (T, T) -> (T, T)`

**Self-check:** (1) exactly one: `identity`. (2) exactly one: `const` (return the `A`). (3) exactly two: return first, or return second. (4) exactly four: `(a,b)`, `(b,a)`, `(a,a)`, `(b,b)` — every way to build a pair from the two available `T`s. If you listed more, you assumed a capability the unbounded type doesn't grant.

<details>
<summary>Hint</summary>

The function can only *return* values of type `T` that it can *obtain*. Count how many `T`s (or `A`s/`B`s) are in scope; the inhabitants are exactly the ways to wire inputs to outputs. No fabrication, no inspection.
</details>

---

### Task 3.2 — What can `forall T. List<T> -> List<T>` do?

List three operations a function of this type *can* perform and three it *cannot*. Justify each "cannot."

**Self-check:** *Can*: reverse, take first k, drop, duplicate-the-whole-list-structure, dedup-by-position. *Cannot*: insert a new element (can't fabricate a `T`), filter by value (can't inspect a `T`), sort (can't compare `T`s without a bound). Each "cannot" traces to "the function can't see or make a `T`."

---

### Task 3.3 — Find the parametricity leak

This C# function has the signature `forall T. T -> T` but is *not* the identity. Explain how, and state the general lesson.

```csharp
static T Sneaky<T>(T x) {
    if (typeof(T) == typeof(int)) return default(T);
    return x;
}
```

**Self-check:** `Sneaky<int>(5)` returns `0`, not `5` — it branches on the runtime type via `typeof(T)`. Lesson: free theorems hold only as strongly as the language is parametric; **reflection (and `null`, effects, `unsafe`) leak parametricity** and void the theorem. Name at least two *other* leaks beyond reflection.

<details>
<summary>Solution</summary>

Other leaks: `null` (`return default(T)` / `null` for reference types breaks identity), exceptions/non-termination (`throw`/infinite loop → "identity *or* bottom"), side effects (observe order/count via I/O or mutation), and `unsafe`/pointer casts. The theorem `T -> T == identity` is a guarantee only in pure, total, non-reflective parametric code (≈ Haskell), and mere design guidance in C#/Java/Go.
</details>

---

### Task 3.4 — Rank-1 vs. higher-rank

Explain why this Haskell function *requires* a rank-2 type, and why a rank-1 type can't express it:

```haskell
applyAtTwoTypes :: ??? -> (Int, Bool)
applyAtTwoTypes f = (f 3, f True)
```

**Self-check:** The answer is `(forall a. a -> a) -> (Int, Bool)`. A rank-1 `(a -> a) -> (Int, Bool)` fixes `a` once at the call site, so `f` can't be used at *both* `Int` and `Bool` inside the body. The rank-2 `forall a` keeps `f` polymorphic *as an argument*, so the callee can instantiate it at each type. Bonus: explain why this breaks type inference (and so needs an annotation).

---

### Task 3.5 — Use a free theorem to skip tests

You have `dedupe : forall T. Eq T => [T] -> [T]` (removes consecutive duplicates). A colleague wants per-type tests for `Int`, `String`, and `User`. Argue, using parametricity, why one representative type plus a *property* suffices.

**Self-check:** Your argument should note that `dedupe` is parametric in `T` and only uses `Eq` (equality) — so its behavior is *uniform* across all `T` with `Eq`; it can't special-case `User`. Testing the *property* ("output is a subsequence of input with no two consecutive equal elements") on one type, plus checking `Eq` is used correctly, covers all types. This is the foundation of property-based testing.

---

## Tier 4 — Production Trade-offs (Professional)

### Task 4.1 — Diagnose accidental boxing

You're given a JVM service whose p99 latency spikes during GC. The hot path uses `Map<Long, List<Integer>>`. Lay out a diagnosis plan and the fix.

**Self-check:** Plan: run an allocation profiler (async-profiler `-e alloc`, or JFR) and look for a flood of `Long`/`Integer` allocations correlated with GC. Fix: replace with a primitive-specialized structure (fastutil `Long2ObjectOpenHashMap` + `IntArrayList`, or restructure to primitive arrays), keeping boxing only at the API boundary. You should *measure first* and name the binding cost (GC pressure from boxing), not guess.

---

### Task 4.2 — Cap monomorphization bloat

A Rust binary grew 2x and builds slowed after adding a generic-heavy crate. Write the step-by-step plan to find and reduce the bloat *without* abandoning the API.

**Self-check:** Steps: (1) `cargo llvm-lines` to rank functions by generated lines; `cargo bloat --release` for size. (2) Identify the over-instantiated generics. (3) For large/cold ones, route through `dyn Trait` (one shared copy, dynamic dispatch). (4) Factor a *thin generic shell over a non-generic core* so only a tiny adapter duplicates per type. (5) Re-measure size *and* build time, and confirm you didn't regress a hot path's latency. The discipline is measure → locate → turn one knob → re-measure.

---

### Task 4.3 — The four-cost trade-off table

Fill in this table from memory (✅ best / ❌ worst / ~ middle), then justify the two cells you were least sure about.

| Strategy | Runtime speed | Binary size | Compile time | Runtime type info |
|----------|:-:|:-:|:-:|:-:|
| Monomorphization | ? | ? | ? | ? |
| Erasure | ? | ? | ? | ? |
| Reified (C#) | ? | ? | ? | ? |
| Hybrid (Go) | ? | ? | ? | ? |

**Self-check:** Mono: ✅ / ❌ / ❌ / ✅. Erasure: ❌ / ✅ / ✅ / ❌. Reified: ✅ / ~ / ~ / ✅. Hybrid: ~ / ~ / ✅ / ~. The key insight you should articulate: *no strategy wins all four* — generics engineering is choosing which cost is binding and turning that knob.

---

### Task 4.4 — Reproduce the raw-type time bomb

In Java, write a method that uses a raw `List` to insert an `Integer` into what's typed as a `List<String>`, then a *separate, distant* reader that crashes. Confirm the `ClassCastException` fires at the *reader*, not the writer. Then enable `-Xlint:unchecked` and `-Werror`-equivalent and show the build now catches it.

**Self-check:** The exception's stack trace points at the reader's `for (String s : list)` loop (the compiler-inserted cast), *not* at the `raw.add(42)` line. Your defense should reject the bad value at the *boundary* — validate element types where untyped data enters — so detonation distance shrinks to zero.

---

### Task 4.5 — Erase vs. specialize, per call site

You maintain a Scala library with a generic numeric routine that's (a) called in a hot loop with `Int`/`Double`, and (b) also used in cold code with a dozen reference types. Design the strategy.

**Self-check:** Specialize the hot value-type path with `@specialized(Int, Double)` (opt-in monomorphization to kill boxing) for the minimal hot set; leave the cold reference-type uses on the erased/shared path. You should explicitly note that `@specialized` *multiplies* generated classes, so you specialize the *minimum* parameters and types — never blanket-specialize. This is the "per-call-site slider" in practice.

---

## Tier 5 — Synthesis & Design

### Task 5.1 — Type-safe heterogeneous container

Implement Bloch's typesafe heterogeneous container: a `put(Class<T>, T)` / `get(Class<T>) -> T` map where each key is a type and each value has that type. Make `get` safe despite the internal `Map<Class<?>, Object>`.

**Self-check:** `get` must do `key.cast(map.get(key))` so the `Class<T>` token performs a *checked* cast at runtime — recovering, at the API surface, the safety that erasure removed internally. Confirm storing a `String` under `String.class` and an `Integer` under `Integer.class` both round-trip with correct static types and no cast at the call site. Note how C# would use reified `typeof(T)` instead.

<details>
<summary>Hint</summary>

The internal map *can't* be statically type-safe (keys map to different value types), so the safety lives in `get`'s use of the class token to cast. The type token is the bridge across the erasure boundary.
</details>

---

### Task 5.2 — Expression problem mini-project

Implement a tiny expression evaluator (variants: `Lit`, `Add`) with operations (`eval`, `pretty`). Then *add a new variant* (`Mul`) and *add a new operation* (`depth`) — and observe which axis your design makes easy and which it makes painful.

**Self-check:** A naive OOP design makes the new *variant* easy (new class) but the new *operation* painful (touch every class). A naive pattern-matching design is the reverse. To open *both* axes, you need typeclasses/traits, the visitor pattern, object algebras, or a tagless-final encoding. Your write-up should name the expression problem and state which encoding opens both axes.

<details>
<summary>Solution sketch</summary>

Object-algebra style (opens both axes): define an interface `Alg<R>` with a method per variant (`lit`, `add`); each *operation* is an implementation of `Alg<R>` for some `R`; each *variant* is a method any algebra must provide. Adding a variant = extend the algebra interface (and its implementations); adding an operation = a new `Alg` implementation, no existing code touched. Generics (`<R>`) are essential but not sufficient — the algebra encoding is what reconciles the two axes.
</details>

---

### Task 5.3 — Design review

A teammate proposes a public API: `Object transform(Object input, Object config)`. Rewrite the signature using generics, justify each type parameter and bound, and explain what *guarantee* your version gives callers that theirs doesn't.

**Self-check:** A reasonable rewrite is `<T, C> T transform(T input, C config)` *if* the transform is genuinely type-preserving and config-agnostic — which then *proves* (parametricity) it can't fabricate or inspect-and-replace the input. If `transform` genuinely needs a capability, add the *minimal* bound. Your justification should invoke "most polymorphic type that still compiles" and the caller guarantee that follows from it (no casts, no `ClassCastException`, free-theorem reasoning about what the function can't do).

---

### Task 5.4 — Cross-language prediction quiz

Without running anything, predict the answer for each, then verify:

1. Does `List<int>` box in C#? In Java?
2. Is `new T()` legal in C#? In Java? In Rust (and under what bound)?
3. Does `instanceof List<String>` compile in Java?
4. Will `Vec<i32>` and `Vec<String>` share generated code in Rust?
5. Does Go monomorphize per concrete type, or per GC shape?

**Self-check:** (1) C# no, Java yes (boxed `Integer`). (2) C# yes (`where T : new()`), Java no, Rust yes with `T: Default` (or a closure). (3) No — only raw `instanceof List`. (4) No — distinct monomorphized copies. (5) Per GC shape, with a dictionary. If you missed any, re-read the relevant tier of `middle.md`.

---

## Self-Assessment Checklist

You've mastered this topic when you can, *without notes*:

- [ ] Define parametric polymorphism and distinguish it from ad-hoc, subtype, and coercion polymorphism.
- [ ] Explain why generics beat `Object`/`any` + casting (compile-time vs. runtime safety).
- [ ] State the difference between monomorphization and erasure and predict their consequences (boxing, bloat, `new T()`, `instanceof`, same-erasure overload, compile time).
- [ ] Place C# (reified) and Go (GC-shape hybrid) on the spectrum and explain their trade-offs.
- [ ] Derive a free theorem from a type (`forall T. T -> T` is identity) and name the leaks (reflection, `null`, effects, `unsafe`) that void it.
- [ ] Distinguish rank-1 from higher-rank polymorphism and explain the inference trade-off.
- [ ] Diagnose accidental boxing and monomorphization bloat in production, naming the tools and the fix.
- [ ] Explain the raw-type `ClassCastException` failure mode and how to prevent it.
- [ ] Recognize the expression problem and name encodings that open both axes.
- [ ] Choose, per call site, between specializing and erasing a generic, justified by measurement.
