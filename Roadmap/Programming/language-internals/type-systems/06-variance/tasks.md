# Variance — Tasks & Exercises

> **Topic:** [Variance](README.md)

---

## Introduction

These exercises build variance intuition by *doing*: predicting compiler decisions, reproducing the array bug, deriving the function rule, writing PECS signatures, and diagnosing real unsoundness in Java, C#, Scala, Kotlin, and TypeScript. Each task has a clear self-check. Hints are collapsed-by-intent (read them only if stuck). Solutions are sparse — given for the trickiest items only; for the rest, the self-check is enough to confirm you got it.

Work top to bottom: the warm-ups establish the four variances, the middle tier drills function variance and PECS, and the final tier puts you in the reviewer's seat diagnosing shipped unsoundness.

## Table of Contents

- [Tier 1 — Foundations](#tier-1--foundations)
- [Tier 2 — Function Variance & PECS](#tier-2--function-variance--pecs)
- [Tier 3 — Declaration-Site & Use-Site](#tier-3--declaration-site--use-site)
- [Tier 4 — Real-World Unsoundness](#tier-4--real-world-unsoundness)
- [Tier 5 — Design Challenges](#tier-5--design-challenges)
- [Hints](#hints)
- [Solutions](#solutions)

---

## Tier 1 — Foundations

### Task 1.1 — Classify the variance

For each, state whether it should be covariant, contravariant, or invariant in `T`, and justify in one sentence using the producer/consumer test:

1. `Iterator<T>` (only `next(): T`)
2. `Comparator<T>` (only `compare(T, T): int`)
3. `MutableList<T>` (`get` and `add`)
4. `Supplier<T>` (only `get(): T`)
5. `Consumer<T>` (only `accept(T)`)
6. `Function<A, B>` (in `A`? in `B`?)

**Self-check:** 1 covariant, 2 contravariant, 3 invariant, 4 covariant, 5 contravariant, 6 contravariant in `A`, covariant in `B`. Each follows from "read out = covariant, write in = contravariant, both = invariant."

### Task 1.2 — Predict the compiler

For each line, will it compile in Java? Why?

```java
List<Cat> cats = new ArrayList<>();
List<Animal> a1 = cats;            // (a)
Animal[] a2 = new Cat[1];          // (b)
List<? extends Animal> a3 = cats;  // (c)
List<? super Cat> a4 = new ArrayList<Animal>(); // (d)
```

**Self-check:** (a) no — generics invariant. (b) yes — arrays covariant. (c) yes — covariant wildcard view. (d) yes — contravariant wildcard view.

### Task 1.3 — Reproduce the array bug

Write a Java (or C#) program that compiles cleanly but throws `ArrayStoreException` (`ArrayTypeMismatchException`) at runtime, using array covariance. Then rewrite it with an invariant `List` and confirm it fails to compile instead.

**Self-check:** Your array version throws at the assignment-into-array line; your `List` version is rejected by the compiler at the upcast line. You've moved the error from runtime to compile time.

### Task 1.4 — The contravariance direction

A `Sink<T>` only has `accept(T)`. Decide which is the subtype: `Sink<Animal>` or `Sink<Cat>`. Then explain it with the garbage-chute analogy in your own words.

**Self-check:** `Sink<Animal> <: Sink<Cat>`. A sink that accepts any animal can stand in wherever a cat-sink is needed — the broader consumer is the subtype. If you said the opposite, re-read the contravariance section in `junior.md`.

---

## Tier 2 — Function Variance & PECS

### Task 2.1 — Derive the function rule

Without looking it up, fill in the blanks: `(A1 -> B1) <: (A2 -> B2)` iff `A__ <: A__` and `B__ <: B__`. Label which is contravariant and which is covariant, and state the one-line slogan.

**Self-check:** `A2 <: A1` (param, contravariant), `B1 <: B2` (return, covariant). Slogan: "accept more, return less."

### Task 2.2 — Which assignments are sound?

Given `Persian <: Cat <: Animal`, mark each function assignment sound or unsound:

1. `Cat -> Animal` assigned to a `Cat -> Animal` variable
2. `Animal -> Persian` assigned to a `Cat -> Animal` variable
3. `Persian -> Animal` assigned to a `Cat -> Animal` variable
4. `Cat -> Object` assigned to a `Cat -> Animal` variable

**Self-check:** 1 sound (identical). 2 sound (param widened `Cat<:Animal` ✓, return narrowed `Persian<:Animal` ✓ — accept more, return less). 3 unsound (param narrowed: `Persian->Animal` can't take a plain `Cat`). 4 unsound (return widened: `Object` isn't a subtype of `Animal`).

### Task 2.3 — Covariant return override

In your language, write a base class `AnimalShelter` with `Animal adopt()`, and a subclass `CatShelter` overriding it with `Cat adopt()`. Confirm it compiles. Then try overriding with `Object adopt()` and confirm it's rejected. Explain both outcomes.

**Self-check:** `Cat adopt()` compiles (covariant return — narrower is OK). `Object adopt()` is rejected (widening a return is unsound — callers expect at least an `Animal`).

### Task 2.4 — Write the PECS signature

Write a generic `transfer` method that moves every element from a source into a destination, as flexibly as the type system allows. Then verify it compiles for `transfer(catList, animalList)` and `transfer(catList, objectList)`.

**Self-check:**
```java
static <T> void transfer(List<? extends T> src, List<? super T> dst) {
    for (T x : src) dst.add(x);
}
```
Source produces → `? extends`; destination consumes → `? super`. Both calls compile. (See Solutions for why swapping the wildcards fails.)

### Task 2.5 — The nested flip

Compute the variance of `T` in each, showing sign multiplication:

1. `(T) -> Int`
2. `(T -> Int) -> Int`
3. `((T -> Int) -> Int) -> Int`

**Self-check:** 1: `−` (contravariant). 2: `−×− = +` (covariant). 3: `−×−×− = −` (contravariant). Each extra parameter-position nesting flips the sign.

---

## Tier 3 — Declaration-Site & Use-Site

### Task 3.1 — Trigger the position check

In Scala or Kotlin, write `class Box[+T]` (Scala) / `class Box<out T>` (Kotlin) and add a method `set(x: T)`. Compile it. Record the exact error. Then remove `set` and confirm it compiles. Explain why the setter broke it.

**Self-check:** The compiler reports that the covariant `T` appears in a contravariant (input) position. The setter consumes `T`, which is incompatible with `out`/`+`. Removing it leaves `T` output-only, so covariance is sound.

### Task 3.2 — Split a read/write type

Take the invalid covariant `Box` from Task 3.1 and refactor into three types: a covariant `Readable<out T>` (get only), a contravariant `Writable<in T>` (set only), and an invariant `Box<T>` extending both. Confirm each compiles and that `Readable<Cat>` is assignable to `Readable<Animal>` while `Box<Cat>` is not assignable to `Box<Animal>`.

**Self-check:** All three compile. The covariant `Readable` view upcasts; the invariant `Box` doesn't. You've recovered covariance for the read-only slice without compromising the writable type.

### Task 3.3 — Use-site projection

In Kotlin, write a function `printAll(items: Array<out Any>)` and confirm you can pass an `Array<String>` to it but cannot write into `items` inside the function. Explain why `out` makes the array read-only here.

**Self-check:** `printAll(arrayOf("a", "b"))` compiles; `items[0] = ...` inside is rejected. The `out` projection gives a covariant read-only view — writing would be the unsound direction, so it's forbidden.

### Task 3.4 — Wildcard capture

Explain, in writing, why this fails to compile, using the word "capture":

```java
void addCat(List<? extends Animal> list) { list.add(new Cat()); }
```

**Self-check:** The compiler captures `?` as some specific unknown subtype of `Animal`; it can't prove a `Cat` matches that unknown type (the list might really be `List<Dog>`), so every non-null `add` is rejected. It's not about cats failing to be animals.

---

## Tier 4 — Real-World Unsoundness

### Task 4.1 — TypeScript: method vs function param

With `strictFunctionTypes: true`, write the *same* callback two ways:

```typescript
interface A { cb(x: Animal): void; }          // method
interface B { cb: (x: Animal) => void; }      // function property
```

Assign a `(c: Cat) => void` handler to each. Record which one the compiler rejects and which it silently accepts. Explain the one-character syntactic difference that flips the safety.

**Self-check:** `B` (function property) is rejected — sound contravariant check. `A` (method) is accepted — bivariant method parameters, an intentional unsoundness. The difference is method-syntax vs `:`-function-property syntax.

### Task 4.2 — Trace the silent failure

For the accepted (method) case in Task 4.1, write code that calls `cb` with a plain `Animal` and show that the `Cat`-only handler then calls a method that doesn't exist on `Animal`. What happens at runtime, and why is there no exception from the type system?

**Self-check:** At runtime the `Cat` handler runs `.meow()` on an `Animal`, producing a runtime error (`meow is not a function`). There's no *type-system* exception because TS types are erased — the bivariant method param let an unsound assignment through and nothing checks types at runtime.

### Task 4.3 — Varargs and the array hole

Explain why this Java method produces an "unchecked generic array creation" warning and how it relates to array covariance:

```java
static <T> List<T> listOf(T... items) { return Arrays.asList(items); }
```

**Self-check:** `T...` compiles to a `T[]`, an array — which is covariant and erased, so its element type can't be checked at runtime, reopening the array-store hazard. `@SafeVarargs` asserts you don't misuse the array (no wrong-type store, no leaking it).

### Task 4.4 — Diagnose the production incident

A service crashes with `ArrayStoreException` in this method:

```java
static void fill(Object[] out, Supplier<?> s) {
    for (int i = 0; i < out.length; i++) out[i] = s.get();
}
```
called as `fill(new String[10], () -> 42)`. Explain the root cause as a variance issue and give a fix that catches it at compile time.

**Self-check:** `String[]` is passed as `Object[]` via array covariance; storing an `Integer` (`42`) into a real `String[]` throws. Root cause: covariance + mutation. Fix: take a `List<T>` / `List<Object>` (invariant) instead of `Object[]`, so the mismatched store is rejected at compile time. (See Solutions.)

### Task 4.5 — C# variant interface vs array

Show, in C#, one covariance that's sound (a variant interface) and one that's unsound (an array). Name the runtime exception the unsound one throws. Explain why one is checked at compile time and the other at runtime.

**Self-check:** `IEnumerable<Cat>` → `IEnumerable<Animal>` is sound (read-only, declaration-site `out`). `Cat[]` → `Animal[]` then writing an `Animal` throws `ArrayTypeMismatchException`. The interface is verified by the position check at compile time; the array defers to a runtime store check.

---

## Tier 5 — Design Challenges

### Task 5.1 — Design a contravariant event bus

Design an event-handler registry so that a single broad handler (e.g., `Handler<Object>` / a logger) can be registered for a specific event type's stream. Specify the variance annotation and show a registration that exploits it.

**Self-check:** `interface Handler<in E> { fun handle(e: E) }` (contravariant). A `Handler<Any>` can be registered where a `Handler<ClickEvent>` is expected because a broader consumer subtypes a narrower one. If your design forced exact-type handlers, you missed the contravariance.

### Task 5.2 — Expose a safe covariant view

You have an internal `MutableList<Cat>`. Design a public API that lets callers read it as a `List<Animal>` (covariant) but never mutate your internals. Name the exact return type in two languages.

**Self-check:** Return Kotlin `List<out Animal>` / C# `IReadOnlyList<Animal>` / TS `ReadonlyArray<Animal>`. The read-only interface has no write method, so covariance is sound and your internal list is protected. Returning the mutable list as a covariant alias would be the array bug reborn.

### Task 5.3 — Design `merge`

Design `merge(a, b, combine)` that merges two sources into a sink. Sources produce, the sink consumes, and `combine` is a function. Write the most flexible signature you can, annotating every variance.

**Self-check (sketch):**
```java
static <T> void merge(List<? extends T> a, List<? extends T> b,
                      List<? super T> out, BinaryOperator<T> combine) { ... }
```
Sources → `? extends` (produce); sink → `? super` (consume); the combine function follows function variance. Bonus if you noted `BinaryOperator<T>` is invariant in `T` because `T` is both input and output.

### Task 5.4 — Audit a hierarchy

You inherit these overrides. Mark each sound or unsound and say why:

1. Base `Number compute()`; Override `Integer compute()`
2. Base `void handle(Animal a)`; Override `void handle(Cat c)` (claimed as an override)
3. Base `Animal make()`; Override `Object make()`
4. Base `void set(Cat c)`; Override `void set(Animal a)` (in a language allowing contravariant params)

**Self-check:** 1 sound (covariant return). 2 unsound *as an override* (narrowed param; most OO treats it as an overload). 3 unsound (widened return). 4 sound (widened/contravariant param — accept more), though most mainstream OO won't treat it as an override.

### Task 5.5 — Decide the variance of a cache

Design a `Cache<K, V>` with `get(K): V?` and `put(K, V)`. State the soundest variance for `K` and for `V` and justify. Then design a read-only `ReadOnlyCache` view and state how its variance differs.

**Self-check:** `Cache` is invariant in both `K` and `V` (`K` is consumed by both get and put — contravariant tendency, but reified key types and `put` make invariance safest; `V` is both produced by `get` and consumed by `put` → invariant). A `ReadOnlyCache<K, out V>` exposing only `get` can be covariant in `V` (output-only). If you marked the writable cache covariant in `V`, recheck `put`.

---

## Hints

- **1.1 / 1.4:** One question only: does the type let you read `T` out, write `T` in, or both? Out → covariant, in → contravariant, both → invariant.
- **1.3:** Upcast a `String[]` to `Object[]`, then store a non-`String` `Object`. For the `List` version, try to upcast `List<String>` to `List<Object>`.
- **2.1 / 2.2:** Remember "accept more, return less." Wider parameter = subtype; narrower return = subtype.
- **2.4:** PECS — Producer Extends, Consumer Super. The source is the producer; the destination is the consumer.
- **2.5:** Tag each parameter position `−`, each return/output position `+`, and multiply through the nesting.
- **3.1:** The error mentions a covariant type in a contravariant position — that's the setter.
- **3.4:** The key word is *capture*: `?` becomes a fresh unknown type the compiler can't match your value against.
- **4.1 / 4.2:** Watch whether you wrote the callback with method syntax `cb(x)` or property syntax `cb: (x) =>`. Only one is checked soundly.
- **4.4:** The hazard is passing a specific array type through an `Object[]` parameter. Replace the array with an invariant collection.
- **5.1:** Consumers want `in` / contravariance so a broad consumer subtypes a narrow one.
- **5.2:** You need a type with *no* write method. Read-only interfaces are covariant and safe.

---

## Solutions

### Solution 2.4 — Why swapping the PECS wildcards fails

```java
static <T> void transfer(List<? extends T> src, List<? super T> dst) {
    for (T x : src) dst.add(x);   // read from src (works: ? extends), write to dst (works: ? super)
}
```

If you swap to `transfer(List<? super T> src, List<? extends T> dst)`:
- Reading from `src` (`? super T`) gives you `Object`, not `T` — the `for (T x : src)` loop fails to compile.
- Writing to `dst` (`? extends T`) is rejected by wildcard capture — you can't `add` to an upper-bounded list.

So both halves break. PECS isn't a convention; it's the only assignment of wildcards under which *both* the read and the write type-check. The producer must be `? extends` (you only read it) and the consumer must be `? super` (you only write it).

### Solution 4.4 — Fixing the `ArrayStoreException`

Root cause: `fill(new String[10], () -> 42)` passes a `String[]` where `Object[]` is expected (array covariance), then stores `Integer` values into a real `String[]`, throwing `ArrayStoreException`. The unsoundness is covariance + mutation, deferred to a runtime store check.

Compile-time-safe fix — make the container invariant and generic:

```java
static <T> void fill(List<? super T> out, Supplier<? extends T> s) {
    for (int i = 0; i < out.size(); i++) out.set(i, s.get());
}
// fill(new ArrayList<String>(...), () -> 42)  // now a COMPILE error: 42 isn't a String
```

With an invariant `List` and PECS bounds, the type system rejects the mismatched element at compile time instead of crashing in production. The general lesson: replace covariant-array parameters at API boundaries with invariant generic collections.

### Solution 5.4 — The override audit, reasoned

1. **Sound.** `Integer <: Number`; narrowing the return is covariant return, and callers expecting a `Number` are satisfied by an `Integer`.
2. **Unsound as an override.** Narrowing the parameter to `Cat` means a caller holding the base type could pass a `Dog`, which the override can't handle. Java/C# treat the differing signature as an *overload*, not an override — the language is protecting you.
3. **Unsound.** `Object` is a *supertype* of `Animal`; widening the return breaks callers who expected at least an `Animal`. Rejected by the compiler.
4. **Sound** (where supported). Widening the parameter to `Animal` is contravariant — the override accepts *more* than required, so any value the base accepts is still handled. Scala/Eiffel allow this; Java/C# won't recognize it as an override.

The single rule behind all four: **promise more (narrower return), demand less (wider parameter)** — anything else is unsound.
