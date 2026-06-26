# Variance — Interview Questions

> **Topic:** [Variance](README.md)

---

## Introduction

These questions probe whether a candidate truly understands variance — the rules deciding when `F<Cat>` is a subtype of `F<Animal>` — or has only memorized "use `? extends` for reading." A strong candidate reasons from the producer/consumer test and the soundness argument, derives the function rule ("accept more, return less") on the spot, and knows precisely why mutable containers must be invariant and where real languages ship unsoundness (Java/C# arrays, TypeScript method parameters). A weak candidate recites PECS without being able to explain *why* covariance plus mutation crashes.

The questions are grouped: Conceptual (the four variances, soundness, the array bug, function variance); Language-Specific (Java wildcards, C# `in`/`out`, Scala `+`/`-`, Kotlin, TypeScript); Tricky/Trap (the places intuition fails); and Design (signatures and API choices that depend on getting variance right).

## Table of Contents

- [Conceptual](#conceptual)
- [Language-Specific](#language-specific)
- [Tricky / Trap](#tricky--trap)
- [Design](#design)

---

## Conceptual

## Question 1

**Define covariant, contravariant, invariant, and bivariant using `Cat <: Animal`.**

Given `Cat <: Animal`:
- **Covariant** in `T`: `F<Cat> <: F<Animal>` — the subtype relationship is preserved (same direction).
- **Contravariant** in `T`: `F<Animal> <: F<Cat>` — the relationship is reversed.
- **Invariant** in `T`: neither holds; `F<Cat>` and `F<Animal>` are unrelated types.
- **Bivariant** in `T`: both hold at once — `F<Cat>` and `F<Animal>` are mutually substitutable. Almost always unsound.

## Question 2

**Why must mutable containers be invariant? Walk through the soundness argument.**

A mutable container has both a reader and a writer. If it were **covariant**, you could view a `List<Cat>` as a `List<Animal>` and then `add(aDog)` — writing a `Dog` into a list that's really cats; a later reader pulls out a "cat" that's a dog. If it were **contravariant**, you could view a `List<Animal>` as a `List<Cat>` and then `read()` expecting a `Cat` but receive any `Animal`. Either variance permits a lie the runtime can't prevent at compile time. The getter forces `T` into a covariant position and the setter into a contravariant position, so `T` is invariant overall. Hence the only sound variance for a read-and-write container is **invariant**.

## Question 3

**Explain the array covariance bug. What does it prove about variance?**

`Object[] a = new String[1]; a[0] = 42;` compiles in Java because arrays are covariant (`String[] <: Object[]`) and `42` is an `Object`. At runtime the JVM checks every array store against the array's *actual* element type, finds `String[]` can't hold an `Integer`, and throws `ArrayStoreException`. It proves that **covariance plus mutation is unsound** — and is exactly why Java/C# made generics invariant. The cost of the array choice is a runtime store-check on every reference-array write.

## Question 4

**State the function subtyping rule and explain each half.**

`(A1 -> B1) <: (A2 -> B2)` iff `A2 <: A1` (parameter: **contravariant**) and `B1 <: B2` (return: **covariant**). The parameter is contravariant because a substitute function must accept everything the original might be given — so a *wider* parameter type is the subtype. The return is covariant because the substitute must deliver something usable where the original's result was expected — so a *narrower* return type is the subtype. The slogan: **"accept more, return less."**

## Question 5

**Why is a function contravariant in its argument? Give the substitution argument.**

Code expecting `g: Cat -> Int` will call `g(someCat)`. To substitute `f` for `g`, `f` must accept that `Cat`. If `f: Animal -> Int`, it accepts any animal, so it accepts the cat — safe. If `f: Persian -> Int` (narrower), it would reject a plain `Cat` — unsafe. Therefore the function with the *more general* (supertype) parameter is the subtype, which is contravariance.

## Question 6

**What is the producer/consumer test (PECS), and how does it map to variance?**

Ask whether the generic only *produces* `T` (you read it out), only *consumes* `T` (you write it in), or both. Producer → covariant (safe to widen). Consumer → contravariant (safe to substitute a broader consumer). Both → invariant. In Java this is **PECS — Producer Extends, Consumer Super**: `? extends T` for reading/producing, `? super T` for writing/consuming.

## Question 7

**How do override rules follow from function variance?**

Method overriding *is* function subtyping. The override may **narrow the return** (covariant return — `Cat reproduce()` overriding `Animal reproduce()`, legal in Java 5+/C#/Kotlin) and, where the language supports it, **widen the parameter** (contravariant). It may never widen the return or narrow the parameter. The LSP-form slogan: "a subtype method may **promise more** (narrower return) and **demand less** (wider parameter)."

## Question 8

**Why is an immutable list safely covariant when a mutable one isn't?**

Covariance is unsound only because of *writing* through the covariant alias. An immutable list has no writer — you can only read — so viewing a `List<Cat>` as a `List<Animal>` is safe: everything you read out is a `Cat`, which is a valid `Animal`. Remove mutation and the soundness hole disappears. This is why Kotlin's read-only `List<out T>` is covariant while `MutableList<T>` is invariant.

## Question 9

**Explain how variance composes under nesting (the sign rule).**

Tag covariant `+`, contravariant `−`. A nested type parameter's overall variance is the product of the variances of every enclosing position: `+×+ = +`, `−×− = +`, `+×− = −`. So in `(Cat -> Int) -> String`, the inner `Cat` sits in a parameter position (`−`) inside another parameter position (`−`), giving `−×− = +` — `Cat` is in a **covariant** position overall. "Minus times minus is plus."

## Question 10

**What does the compiler's positional variance check do, and why is it sound?**

For a declaration-site annotation like `out T`, the compiler scans every position where `T` appears and requires each be covariant (return types, immutable fields, `out` slots of nested generics); `in T` requires all positions contravariant. A `var`/mutable field makes `T` appear in both positions → invariant → neither `out` nor `in` passes. This mechanically guarantees the declared variance matches the actual data flow, which is what makes declaration-site variance sound.

---

## Language-Specific

## Question 11

**Java: what's the difference between `? extends T` and `? super T`, and what can you do with each?**

`List<? extends T>` is a **covariant** (upper-bounded) view: you may **read** elements as `T`, but you may **not** `add` any non-null element (the compiler captured `?` as an unknown subtype of `T` and can't prove your value matches). `List<? super T>` is a **contravariant** (lower-bounded) view: you may **add** `T` (and subtypes), but reads come out as `Object`. Producer → `extends`; consumer → `super`.

## Question 12

**Java: why can't you `add` to a `List<? extends Animal>`?**

Because the wildcard `?` is *captured* as some specific-but-unknown subtype of `Animal` — it could be `List<Cat>` or `List<Dog>`. The compiler can't prove that the value you want to add matches that unknown type, so it rejects every `add(x)` except `add(null)` (since `null` belongs to every reference type). It's not "cats aren't animals"; it's "the compiler doesn't know *which* animal subtype this list actually holds."

## Question 13

**C#: what do `in` and `out` mean on a generic interface, and what does the compiler enforce?**

`out T` declares the parameter **covariant** — `T` may appear only in **output** positions (method return types); the compiler forbids it as a parameter. `in T` declares it **contravariant** — `T` may appear only in **input** positions; the compiler forbids it as a return type. So `IEnumerable<out T>` is covariant, `IComparer<in T>` is contravariant. Note: C# allows this on *interfaces and delegates*, not on classes, and arrays remain (unsoundly) covariant for legacy reasons.

## Question 14

**Scala: what do `+T` and `-T` mean, and what does "covariant type T occurs in contravariant position" mean?**

`+T` declares covariance, `-T` contravariance. The error "covariant type T occurs in contravariant position" fires when you put a `+T` parameter into an input slot — e.g., a method parameter of type `T` on a `class C[+T]`. It's the positional check rejecting an unsound declaration: a covariant `T` may only be produced, not consumed. The escape hatch is `@uncheckedVariance`, which suppresses the check and transfers the soundness proof to you (used carefully in Scala's collections).

## Question 15

**Kotlin: what's the difference between declaration-site `out`/`in` and a use-site projection like `Array<out T>`?**

Declaration-site `out`/`in` on an interface (`interface Source<out T>`) fixes the variance once, verified by the compiler, applied at every use. A use-site projection (`Array<out T>`) borrows variance at a single use of an otherwise-invariant type: `Array<out Animal>` is a covariant, **read-only** view of an array — you can read `Animal`s but cannot write. Kotlin offers both because some types (`Array`, `MutableList`) are inherently invariant but you sometimes need a variant view of them locally.

## Question 16

**Kotlin: why is `List<out T>` covariant but `MutableList<T>` invariant?**

`List` exposes only producers (`get`, `iterator`) — `T` is output-only, so `out T` passes the position check and the type is covariant. `MutableList` adds `add(T)`/`set(i, T)` — `T` is now also in input positions, so it's invariant. Same underlying data, different variance, driven entirely by whether a write method exists.

## Question 17

**TypeScript: what does `strictFunctionTypes` change, and what does it deliberately not cover?**

Without it, function parameters are checked **bivariantly** (unsound). With it, **standalone function-typed** parameters are checked **contravariantly** (sound — a `(a: Animal) => void` is assignable where `(c: Cat) => void` is wanted, but not vice versa). It deliberately leaves **method** parameters bivariant, for backward compatibility with array methods and DOM event handlers. So `{ cb: (x: T) => void }` (property) is checked soundly, while `{ cb(x: T): void }` (method) is not.

## Question 18

**TypeScript: is `ReadonlyArray<T>` covariant, and is that sound?**

Yes and yes. `ReadonlyArray<T>` exposes only reads, so a `ReadonlyArray<Cat>` is safely assignable to `ReadonlyArray<Animal>` — covariance over immutable data is sound. The *mutable* `Array<T>` is also treated covariantly by TS (`Cat[]` assignable to `Animal[]`), but that is **unsound** — `push`ing through the `Animal[]` view corrupts the underlying `Cat[]`, mirroring the Java array bug.

## Question 19

**What is `Comparable<? super T>` / `Comparator<? super T>` and why the `? super`?**

`Comparable`/`Comparator` **consume** `T` (they take `T`s to compare), so they're contravariant — a comparator that can order `Animal`s can order `Cat`s. Writing the bound as `Comparator<? super T>` lets a `Comparator<Animal>` be passed where a `Comparator<Cat>` is needed, which is essential so that base-class orderings work for subclasses. Drop the `? super` and `Collections.sort(catList, animalComparator)` stops compiling.

---

## Tricky / Trap

## Question 20

**"A list of cats is a list of animals — so `List<Cat>` should be a `List<Animal>`, right?"**

No — not for a *mutable* `List`. If it were, you could `add(aDog)` to your cat list through the `List<Animal>` view, corrupting it. Java/C#/Kotlin generics are invariant precisely to forbid this. The intuition is only valid for *immutable*/read-only lists (`ReadonlyArray<T>`, Kotlin `List<out T>`), which genuinely are covariant. The trap is forgetting that mutation is what breaks covariance.

## Question 21

**Is `(Cat) => void` assignable to `(Animal) => void`?**

No (under sound rules). A function taking `Cat` cannot stand in where a function taking `Animal` is expected, because the caller might pass a `Dog`, which the `Cat`-handler can't handle. The sound direction is the reverse: `(Animal) => void` *is* assignable to `(Cat) => void` (contravariant parameters — accept more). TypeScript without `strictFunctionTypes`, or with method-syntax parameters, wrongly allows both directions.

## Question 22

**This compiles and crashes — explain: `Object[] a = new String[1]; a[0] = 42;`**

Covariant arrays let `String[]` be assigned to `Object[]`, and `42` boxes to an `Object`, so the store type-checks. But the JVM tags the array with its real element type (`String`) and checks every store at runtime; storing an `Integer` into a `String[]` throws `ArrayStoreException`. The bug is covariance + mutation; the fix is to use an invariant `List<Object>` (or a correctly-typed array).

## Question 23

**Your TypeScript callback receives the wrong object type at runtime but there's no exception — why?**

Probably a bivariant **method** parameter. You assigned a narrower-parameter handler (`(c: Cat) => ...`) where a broader one (`(a: Animal) => ...`) was expected; TS allowed it because method parameters are bivariant even under `strictFunctionTypes`. At runtime an `Animal` flows in, the handler calls a `Cat`-only method, and since TS types are erased there's no runtime check — you get silent wrong behavior, not an exception. Fix: write the callback as a function-typed property.

## Question 24

**Can you `add` to a `List<? super Cat>`? Can you read a `Cat` from it?**

You **can** `add(aCat)` (and any `Cat` subtype) — it's a contravariant consumer view, so writing `Cat`s is exactly what it's for. You **cannot** read a `Cat` from it — the compiler only knows the list holds "some supertype of `Cat`," so reads come back as `Object`. This read/write asymmetry is the mirror image of `? extends` and confuses people who expect `super` to be "more powerful."

## Question 25

**An override returns a subtype — fine. An override accepts a subtype parameter — why is that a different (and unsafe) thing?**

Returning a subtype is **covariant return** — sound, because callers expecting the supertype are satisfied by a more specific result. Accepting only a *subtype* parameter is **narrowing**, which is unsound: a caller holding the supertype reference could pass a sibling type the narrowed method can't handle. In Java/C#, a method with a different parameter type isn't even treated as an override — it's an *overload* — which is the language quietly steering you away from the unsound case.

## Question 26

**Is bivariance ever what you want?**

Essentially never on purpose. Bivariance lets you both read a wrong type out and write a wrong type in, defeating static typing. It survives in real languages only as a pragmatic concession (TypeScript method parameters) for backward compatibility, and it's a documented unsoundness, not a feature to seek. If you find yourself wanting bivariance, you usually want to split the type into a covariant producer and a contravariant consumer instead.

## Question 27

**Why do generic varargs reintroduce the array bug?**

`<T> f(T... items)` compiles `items` to a `T[]` — an array, which is covariant and thus subject to the same store hazard, plus "unchecked generic array creation" because the element type is erased. That's why such methods need `@SafeVarargs`, by which you assert you don't do anything unsafe (like storing a wrong type into the varargs array or leaking it). The array hole leaks into generics through varargs.

## Question 28

**Kotlin `Array<out T>` — can you write to it? People assume `out` keeps it writable.**

No. `out` projects the array to a covariant, **read-only** view; the position check forbids writes because writing `T` is a contravariant operation incompatible with `out`. The misconception is that "covariant" implies "still fully usable" — but the only way covariance is sound over a mutable type is to remove the write, which is exactly what the out-projection does.

---

## Design

## Question 29

**Design the signature of a `copy` function that copies one list into another, as flexibly as possible.**

```java
static <T> void copy(List<? super T> dest, List<? extends T> src) {
    for (int i = 0; i < src.size(); i++) dest.set(i, src.get(i));
}
```

`src` is a **producer** of `T` → `? extends T` (covariant, you read). `dest` is a **consumer** of `T` → `? super T` (contravariant, you write). This is PECS, and it's the shape of `java.util.Collections.copy`. With these bounds you can copy a `List<Cat>` into a `List<Animal>`; swap the wildcards and it won't compile.

## Question 30

**You want to expose internal mutable state as a read-only, covariant view. How?**

Return a read-only interface that exposes only producers: `IReadOnlyList<out T>` (C#), `ReadonlyArray<T>` (TS), or Kotlin's `List<out T>`. The internal storage stays a mutable invariant collection; the public getter narrows it to the covariant read-only type. Because the exposed view has no write method, covariance is sound — and callers can treat your `List<Cat>` view as a `List<Animal>` view safely. Never expose the mutable type itself through a covariant alias.

## Question 31

**Design a callback/event interface that one broad handler can serve for many specific event types.**

Make it contravariant in the event type: `interface Handler<in E> { fun handle(e: E) }` (Kotlin/C# `in`) or accept `Consumer<? super E>` (Java). Then a `Handler<Any>`/`Consumer<Object>` (e.g., a generic logger) can be registered wherever a `Handler<ClickEvent>` is wanted. Contravariance is the right tool because a handler *consumes* events, and a handler of a broader type can always handle a narrower one.

## Question 32

**You're designing a generic `Box<T>` with `get` and `set`. A team wants covariance. What do you tell them and what do you build?**

I tell them an invariant `Box<T>` (both get and set) *cannot* be covariant soundly — the setter would let a wrong type in. I split it: a covariant `Readable<out T> { fun get(): T }` and a contravariant `Writable<in T> { fun set(x: T) }`, with `Box<T> : Readable<T>, Writable<T>` for the full read-write (invariant) case. Code that only reads takes `Readable<out T>` and gets covariance; code that only writes takes `Writable<in T>` and gets contravariance; code needing both stays invariant. This is the standard producer/consumer split.

## Question 33

**Design `sort` so a base-class comparator can sort a list of a subtype.**

```java
static <T> void sort(List<T> list, Comparator<? super T> cmp) { ... }
```

The `Comparator<? super T>` bound is contravariance: a comparator that orders any supertype of `T` can order `T`. This lets `sort(catList, animalComparator)` work — the `Comparator<Animal>` is accepted for a `List<Cat>`. Without `? super`, generic ordering utilities would force callers to write a comparator at exactly the element type, which is needlessly rigid.

## Question 34

**A TypeScript codebase is migrating to soundness. What variance-related steps do you take?**

Enable `strictFunctionTypes` to get sound contravariant checking of function-typed parameters. Convert callback definitions from method syntax (`{ cb(x: T): void }`, bivariant) to function-property syntax (`{ cb: (x: T) => void }`, contravariant) so the strict check applies. Replace mutable-array covariance at boundaries with `ReadonlyArray<T>` where the data is only read. Then fix the errors the strict check surfaces — each one is a real unsound assignment that was silently allowed before.

## Question 35

**When designing a public collections library, how do you decide each type's variance?**

Classify each type by data flow: pure producers (iterators, immutable lists, suppliers) → covariant (`out`/`? extends`); pure consumers (sinks, comparators, writers) → contravariant (`in`/`? super`); read-and-write containers → invariant. Prefer declaration-site annotations on interfaces with a single clear role, and split read/write types into producer + consumer interfaces so callers get maximal safe flexibility. Use wildcards in public Java method signatures, concrete types internally. The guiding reflex: if you want covariance, make the type immutable so it's sound by construction.
