# Bounded Polymorphism — Tasks & Exercises

> **Topic:** [Bounded Polymorphism](README.md)
> **Focus:** Hands-on exercises that make the unbounded-vs-bounded contrast, F-bounds, typeclass/trait mechanics, coherence, and dispatch trade-offs concrete — with self-checks, hints, and sparse solutions.

---

## How to Use This Page

Each task states a goal, a **self-check** (how you'll know you succeeded), a **hint** (collapsed-in-spirit — read it only if stuck), and, for the harder ones, a **sparse solution** (a sketch, not a copy-paste answer). Pick the language each task names, or port it to your own — the point is the *bound*, not the syntax. Tasks are grouped by tier; do them in order if you're new to the topic.

A recurring discipline: when a task says "make it fail to compile first," *actually* compile the unbounded version and read the error. The error message is the lesson.

---

## Tier 1 — Foundations (Junior)

### Task 1.1 — Feel the wall

**Goal.** Write the smallest generic function that *won't* compile unbounded and *will* compile bounded.

```java
static <T> T pickBigger(T a, T b) { return a.compareTo(b) >= 0 ? a : b; } // make this fail
```

**Self-check.** The unbounded version produces a "cannot find symbol `compareTo`" (or equivalent) error; adding `extends Comparable<T>` fixes it and `pickBigger(3, 7)` returns `7`.

**Hint.** The single line that forces the bound is the one that *uses* a capability not shared by all types.

<details><summary>Sparse solution</summary>

`static <T extends Comparable<T>> T pickBigger(T a, T b) { return a.compareTo(b) >= 0 ? a : b; }`. The bound is forced by `compareTo`; without it, `T` is "any type," and most types have no `compareTo`.
</details>

### Task 1.2 — Five languages, one `max`

**Goal.** Implement a generic `max(a, b)` bounded by ordering in Java, Rust, Go, Swift, and Haskell (pick the three you know best).

**Self-check.** Each compiles, returns the larger of two values for at least `int` and `string`, and *rejects* a non-comparable type with a clear error.

**Hint.** The bound names per language: `extends Comparable<T>`, `: Ord`, `[T cmp.Ordered]`, `: Comparable`, `Ord a =>`.

### Task 1.3 — Identity stays unbounded

**Goal.** Show that `identity(x) { return x; }` needs *no* bound, and explain why adding one is a mistake.

**Self-check.** You can state: an identity/move-only function uses no capability of `T`, so bounding it needlessly rejects valid types and adds coupling for zero benefit.

### Task 1.4 — Propagate the bound

**Goal.** Write `maxOf(list)` that calls your bounded `max(a, b)`. Deliberately omit the bound on `maxOf` first; read the error; then fix it.

**Self-check.** Before: "bound not satisfied / `T` is not `Comparable`." After: `maxOf([3,1,4,1,5])` returns `5`.

**Hint.** A function can never carry *less* constraint than the functions it calls.

### Task 1.5 — Minimal bound wins

**Goal.** Write `prettyPrint(x)` bounded by a *display* capability (`Display`/`toString`/`Codable`), then try (and fail) to feed it a type that has ordering but no display. Then write `dedup(list)` bounded by *equality*.

**Self-check.** `prettyPrint` rejects the no-display type; `dedup` works with the equality bound but would *not* need an ordering bound. You can articulate "bound by the smallest interface that compiles."

---

## Tier 2 — Combining & Recursing (Middle)

### Task 2.1 — Two capabilities at once

**Goal.** Write a function needing *both* ordering and display: pick the larger of two values and print it. Use multiple bounds in two languages.

**Self-check.** `<T extends Comparable<T> & ...>` (Java) / `T: Ord + Display` (Rust) compiles; using only one bound fails on the operation from the other.

**Hint.** Java multiple bounds: at most one class, first, then interfaces, joined with `&`.

### Task 2.2 — Decode the F-bound

**Goal.** Explain, in your own words and with a failing example, why `Enum` is `class Enum<E extends Enum<E>>` and not `class Enum<E extends Enum>`.

**Self-check.** You can show that the loose (raw) bound would permit comparing two *different* enum types, and the F-bound forbids it.

<details><summary>Sparse solution</summary>

`Comparable<X>` means "comparable to `X`." `Enum<E extends Enum<E>>` makes each enum `Comparable<` *its own type* `>`, so `Color.RED.compareTo(Suit.HEARTS)` won't type-check. The raw `Enum` bound erases the type argument and reintroduces cross-enum comparison.
</details>

### Task 2.3 — Self-typed builder

**Goal.** Build a fluent builder where subclass methods stay chainable. In Java use `Builder<B extends Builder<B>>`; in Rust use `Self`.

**Self-check.** `new UserBuilder().name("a").email("b")` compiles — `email` is visible *after* `name`. Remove the F-bound (make `name` return `Builder`) and watch `email` disappear.

**Hint.** The F-bound makes inherited methods return the *concrete* subtype, not the base.

### Task 2.4 — Where do the methods live?

**Goal.** For one bounded call (`a.compareTo(b)` / `cmp(a, b)`), draw where the implementation physically lives in (a) a subtype-bound language and (b) a dictionary-passing language.

**Self-check.** Your diagram shows methods *on the object* for the subtype case and a *separate witness table* threaded in for the dictionary case. You can name which language is which.

### Task 2.5 — Retrofit a capability

**Goal.** Add your own trait `Summary` (with one method) to a *built-in* type (e.g. `i32`) in Rust or Haskell. Then attempt the equivalent in Java/C# and document why it's hard.

**Self-check.** The Rust/Haskell version compiles and `42.summary()` works; you can explain that subtype-bound languages can't make a pre-existing class a subtype of a new interface without editing it.

**Hint.** This only works because the dictionary (the `impl`/`instance`) is *separate* from the type's definition.

### Task 2.6 — CRTP in C++

**Goal.** Write a CRTP base `Ordered<D>` that supplies `<=`, `>`, `>=` from a single `cmp` the derived type provides, with zero virtual calls.

**Self-check.** `Version{2} <= Version{5}` is `true`; there's no `virtual` keyword anywhere; the base calls the derived `cmp` via `static_cast<const D&>(*this)`.

---

## Tier 3 — Typeclasses, Coherence, Extensibility (Senior)

### Task 3.1 — Desugar a constraint by hand

**Goal.** Take `shout :: Show a => a -> String; shout x = show x ++ "!"` and rewrite it in *explicit dictionary-passing* form (define a `ShowDict`, pass it).

**Self-check.** Your `shout'` takes a `ShowDict a` parameter and `show x` becomes a field access; `shout' showDictInt 42` yields `"42!"`.

<details><summary>Sparse solution</summary>

`data ShowDict a = ShowDict { showImpl :: a -> String }`; `shout' d x = showImpl d x ++ "!"`. The `Show a =>` constraint became a value parameter — the whole point of dictionary translation.
</details>

### Task 3.2 — Coherence corruption exhibit

**Goal.** Build a set/map keyed by a type with a *deliberately unlawful* `Ord`/`Eq`+`Hash` (e.g. non-transitive ordering, or `a == b` but `hash(a) != hash(b)`). Observe silent breakage.

**Self-check.** You can demonstrate duplicate entries, missing lookups, or a `len` that's "impossible" — with *no* error thrown. You can explain that coherence + lawful instances are what normally prevent this.

**Hint.** The bug is in the *instance*, not the collection. The collection trusts the bound.

### Task 3.3 — Orphan rule and the newtype escape

**Goal.** In Rust or Haskell, try `impl Display for Vec<i32>` (or a foreign type) and hit the orphan error. Then fix it with a newtype.

**Self-check.** The direct impl is rejected as an orphan; the newtype (`struct Csv(Vec<i32>)`) version compiles and prints `"1,2,3"`. You can state the orphan rule precisely.

### Task 3.4 — Associated type vs parameter

**Goal.** Write a `Stream` trait two ways: once with an associated `type Item`, once with a `Collection<Item>` parameter. Write generic code over each.

**Self-check.** The associated-type version lets callers write `S::Item` and never annotate `Item`; the parameter version forces annotations and permits a type to (in principle) have multiple impls. You can justify Rust's choice for `Iterator::Item` using "does the impl determine it?"

### Task 3.5 — Solve the expression problem

**Goal.** Model two node types (`Lit`, `Neg`) and two operations (`eval`, `show`) with typeclasses. Then add a *third* node type (`Add`) and a *third* operation (`optimize`) **without editing any existing instance or type**.

**Self-check.** Adding `Add` required only new code (a type + its instances); adding `Optimize` required only new code (a class + instances for existing types). No existing file changed. You can argue why the OO-subtype version would force edits to add `optimize`.

<details><summary>Sparse solution</summary>

One class per operation (`class Eval a`, `class Show' a`, later `class Optimize a`); one type per node, each with instances. New type → add `instance Eval NewNode` etc. New op → add a new class + instances. Both axes open because operations are classes (open to new instances) and types are independent data (open to new declarations).
</details>

### Task 3.6 — Superclass dictionaries

**Goal.** Write `sortUnique :: Ord a => [a] -> [a]` using `sort` (`Ord`) and `nub` (`Eq`). Explain why a single `Ord a` constraint discharges both.

**Self-check.** It compiles with only `Ord a`; you can state that `Ord`'s superclass `Eq` means the `Ord` dictionary *contains* the `Eq` dictionary.

---

## Tier 4 — Dispatch, Diagnostics, Evolution (Professional)

### Task 4.1 — Static vs dynamic, measured

**Goal.** Implement the same `Draw` capability twice: a monomorphized `render<T: Draw>` and a `render(&dyn Draw)`. Store a heterogeneous list and observe that only `dyn` can hold mixed types.

**Self-check.** `Vec<Box<dyn Draw>>` compiles and iterates; the equivalent with a single `T` does not. You can state the cost trade (inlining vs one copy + indirection).

### Task 4.2 — Object safety refactor

**Goal.** Take an object-*unsafe* trait (one with `fn clone(&self) -> Self`) and refactor it so it *can* be used as `dyn`.

**Self-check.** `Box<dyn YourTrait>` was rejected before and compiles after; you moved the `Self`-returning method to a `-> Box<dyn ...>` form (or split it out). You can explain why a vtable couldn't hold the original.

**Hint.** A vtable is a fixed table of monomorphic pointers; `-> Self` has no fixed type at the `dyn` call.

### Task 4.3 — SFINAE to concepts

**Goal.** Write a C++ function constrained the old way with `std::enable_if`, then rewrite it with a C++20 `concept`. Pass a non-conforming type to both and compare the errors.

**Self-check.** The `enable_if` version errors deep/verbosely; the concept version errors at the call site with a one-line "constraint not satisfied." You can quantify the line-count difference.

<details><summary>Sparse solution</summary>

Old: `template<class T, std::enable_if_t<std::is_integral_v<T>, int> = 0> T f(T)`. New: `template<class T> concept Int = std::is_integral_v<T>; template<Int T> T f(T)`. Feed `std::string` to both; the concept version says `constraint 'Int<std::string>' was not satisfied`.
</details>

### Task 4.4 — Breaking-change taxonomy

**Goal.** Take a published trait with two downstream impls. Apply each change and record whether it breaks the impls: (a) add a defaulted method, (b) add a required method, (c) add a supertrait, (d) add a blanket impl, (e) loosen a function bound, (f) tighten a function bound.

**Self-check.** Your table matches: defaulted/loosen = OK; required/supertrait/blanket/tighten = breaking. You can explain each via impl obligations or coherence/overlap.

### Task 4.5 — Tame monomorphization bloat

**Goal.** Instantiate a nontrivial generic over ~20 types and measure binary size / compile time. Apply the "outline the cold path" refactor (thin generic shell → shared non-generic body) and measure again.

**Self-check.** Binary size and/or compile time drop measurably after outlining; behavior is unchanged. You can explain that only the small shell is now duplicated per type.

### Task 4.6 — Two orderings, no coherence violation

**Goal.** Give a `Person` struct *two* orderings (by name, by age) without declaring two `Ord` instances.

**Self-check.** You used either newtype wrappers (`ByName`, `ByAge`) each with one `Ord`, or an explicit comparator passed to `sort_by` — never two instances for `Person`. You can explain why coherence forbids the naive approach.

---

## Capstone Projects

### Capstone A — A bounded-generics teaching kit

Build a single repo demonstrating, for one bounded call, all of: (1) unbounded fails / bounded compiles; (2) the same `max` across 4 languages; (3) subtype-bound vs dictionary-passing "where do the methods live" diagrams; (4) an F-bounded builder; (5) a retrofit + orphan + newtype example; (6) static vs `dyn` dispatch with a heterogeneous list. **Self-check:** a newcomer can read it top to bottom and explain the unbounded→bounded→typeclass→dispatch progression.

### Capstone B — Expression-problem in three styles

Implement the same small expression language (cases + operations) three ways: OO subtype interfaces, FP ADT + pattern matching, and typeclasses/traits. For each, document exactly which files must change to (a) add a new case and (b) add a new operation. **Self-check:** the typeclass version is the only one open on *both* axes, and you can point to the unchanged files to prove it.

### Capstone C — Evolvable foundational trait

Design and ship a small `Codec` (or `Metric`) trait built for an ecosystem: fine-grained capabilities, minimal required surface, defaulted growth methods, feature-gated foreign-type instances (no orphans needed downstream), and object safety where `dyn` is expected. Then write a CHANGELOG that walks three releases applying *only* non-breaking changes. **Self-check:** every release adds capability without breaking a sample downstream impl, and you can name the one change you *couldn't* make non-breakingly (a required method or supertrait).

---

## Self-Assessment Checklist

```text
[ ] I can explain why unbounded <T> can only move values (parametricity).
[ ] I can read and write an upper bound in Java/Rust/Haskell/Swift/C#.
[ ] I can explain the bound trade: fewer types <-> more capability.
[ ] I can decode an F-bound (T extends Comparable<T>) and say why it's recursive.
[ ] I can distinguish subtype bounds from dictionary passing and predict their differences.
[ ] I can explain coherence and why it makes Set/Map sound.
[ ] I can state the orphan rule and the newtype escape.
[ ] I can choose associated type vs class parameter via "does the impl determine it?".
[ ] I can solve the expression problem with typeclasses and say why OO/ADT can't.
[ ] I know object safety and why Ord/Clone can't be dyn.
[ ] I can convert SFINAE to a C++20 concept and explain the diagnostic win.
[ ] I can classify trait changes as breaking or not (the evolution taxonomy).
[ ] I can decide monomorphization vs dynamic dispatch and tame bloat.
[ ] I can give a type two orderings without violating coherence.
```

---

## Hints Index

- **"Cannot call method on T"** → you forgot a bound. Add the smallest interface that supplies the method.
- **"Bound not satisfied" on an outer function** → propagate the bound; the caller needs ≥ the constraint of everything it calls.
- **Subclass refused by `Comparable<T>`** → use `Comparable<? super T>`.
- **"Conflicting implementations" / "orphan instance"** → coherence/orphan rule; newtype-wrap.
- **Want two behaviors for one type** → newtype wrappers or an explicit comparator/closure, never two instances.
- **`Box<dyn Trait>` rejected** → trait isn't object-safe; remove `-> Self`/generic methods or split them out.
- **Binary too big after generics** → monomorphization bloat; outline the cold path or use `dyn`.
- **C++ error dump from a template** → declare a `concept`; the error moves to the call site and shrinks to one line.

---

## Further Reading

- *The Rust Book*, Chapters 10 & 19 — the most exercise-friendly trait-bounds material. https://doc.rust-lang.org/book/
- *Effective Java* — Bloch. Recursive type bounds, `Comparable<? super T>`, and the builder pattern as practice problems.
- *Learn You a Haskell for Great Good!* — Typeclasses chapters; great for the dictionary-translation and coherence intuitions.
- *C++20 Concepts* references and the `ranges` library — work through converting `enable_if` to concepts.
- *The Expression Problem* — Wadler's note; the source for Capstone B.
- *Types and Programming Languages* — Pierce, Chapters on parametric polymorphism and bounded quantification, for the rigorous backing.
