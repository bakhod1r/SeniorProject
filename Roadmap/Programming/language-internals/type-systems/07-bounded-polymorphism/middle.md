# Bounded Polymorphism — Middle Level

> **Topic:** [Bounded Polymorphism](README.md)
> **Focus:** Multiple bounds, the self-referential `T extends Comparable<T>` (F-bounded) pattern, and the two ways a language can answer "what can I do with a bounded `T`": **subtype bounds** vs **dictionary passing**.

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
13. [Test Yourself](#test-yourself)
14. [Cheat Sheet](#cheat-sheet)
15. [Summary](#summary)
16. [What You Can Build](#what-you-can-build)
17. [Further Reading](#further-reading)

---

## Introduction

> Focus: **The shapes bounds take once you go past one simple upper bound** — multiple capabilities at once, recursive self-referential bounds, and the two fundamentally different machineries underneath.

At the junior level a bound was a single permission slip: `T: Ord` and you could compare. Real generic code is richer. You often need *two* capabilities at once (`T` that is both orderable *and* printable). You frequently hit the strange-looking `T extends Comparable<T>` — a bound that **mentions `T` inside itself** — and need to understand why it's written that way and where it bites. And, most importantly, you should understand that "what does a bound let me do" is answered by two genuinely different mechanisms across languages:

1. **Subtype bounds** (Java, C#, Swift): `T` must be a *subtype* of the bound interface. The capability is reached by ordinary method dispatch on the object — the object *carries* its methods.
2. **Dictionary passing** (Haskell typeclasses, Rust traits, Scala givens): the type is *not* a subtype of anything; instead the compiler finds a *separate table of operations* (a "dictionary" / "vtable" / "witness") for that type and threads it into the call — or monomorphizes it away entirely.

These two mechanisms look similar in source (`<T extends Ord>` vs `T: Ord`) but differ in deep ways: whether a type can be made to satisfy a bound *after the fact* without modifying it, whether values are boxed, whether dispatch is virtual or static, and whether you can have a type satisfy a bound in *two different ways*. This page makes that split concrete.

> 🎓 **Why this matters at this level:** Once you write generic *libraries* rather than one-off functions, you must reason about bounds compositionally — combining them, propagating them through `where` clauses, and choosing types that satisfy them. The subtype-vs-dictionary distinction explains most of the "why does Rust let me add an interface to `i32` but Java doesn't?" / "why does Haskell need no inheritance?" questions you'll hit.

This page covers multiple bounds and `where` clauses, the F-bounded (recursively bounded) pattern and the canonical `enum Color extends Enum<Color>` / `Self`-referential trait, the subtype-bound vs dictionary-passing implementation split, and what each buys you. The full dictionary/vtable internals, coherence and orphan rules, associated types, and the expression problem are deepened in `senior.md` and `professional.md`.

---

## Prerequisites

- **Required:** The junior page — unbounded vs bounded, upper bounds, the `max` example, bound propagation.
- **Required:** Comfort reading interfaces/traits/protocols and implementing them for a type.
- **Required:** Basic subtyping (`Dog <: Animal`) in at least one OO language.
- **Helpful:** Having implemented `Comparable`/`Ord`/`Comparable` for one of your own types.
- **Helpful:** Awareness that some method calls are *virtual* (looked up at runtime) and some are *static* (resolved at compile time).

You do **not** need: the full vtable/dictionary internals (`senior.md`), coherence/orphan rules and associated types (`senior.md`), the expression problem framing (`professional.md`), or variance.

---

## Glossary

| Term | Definition |
|------|-----------|
| **Multiple bounds** | A type parameter constrained by more than one interface at once: `<T extends A & B>`, `T: A + B`, `(A a, B a) =>`. |
| **`where` clause** | A separate place to write bounds, often clearer for many/complex constraints (`where T: Ord` in Rust/C#/Swift). |
| **F-bounded polymorphism** | A bound that *refers to the type parameter itself*: `<T extends Comparable<T>>`. "`T` is comparable *to its own type*." |
| **Recursive / self-referential bound** | Synonym-ish for F-bounded: the constraint mentions the thing it constrains. |
| **CRTP** | "Curiously Recurring Template Pattern" — C++'s structural cousin: `class D : Base<D>`. The same self-reference, used for static polymorphism. |
| **`Self` type** | In Rust/Swift, the placeholder for "the implementing type" inside a trait/protocol — the dictionary-passing way to express what F-bounds express by hand. |
| **Subtype bound** | A bound satisfied because `T` *is a subtype of* the bound interface (Java/C#/Swift). The object carries its methods. |
| **Dictionary passing** | A bound satisfied by passing a separate table of the bound's operations for `T` (Haskell/Rust/Scala). The type need not subtype anything. |
| **Dictionary / witness / vtable** | The table of function pointers implementing the bound's operations for a specific type. |
| **Instance / impl** | A declaration that a given type satisfies a typeclass/trait (Haskell `instance Ord Foo`, Rust `impl Ord for Foo`). |
| **Monomorphization** | Compiling a generic function into a separate specialized copy per concrete type, erasing the dictionary at compile time (Rust, C++). |
| **Static vs dynamic dispatch** | Resolving a bounded call at compile time (static, monomorphized) vs via a runtime table (dynamic, `dyn Trait`/virtual). |

---

## Core Concepts

### 1. Multiple bounds: needing more than one capability

A function may need `T` to do two things. You conjoin the bounds.

```java
static <T extends Comparable<T> & Serializable> T pick(T a, T b) {   // Java: A & B
    return a.compareTo(b) >= 0 ? a : b;   // uses Comparable; Serializable is a separate promise
}
```
```rust
fn pick<T: Ord + Clone>(a: T, b: T) -> T {    // Rust: A + B
    if a >= b { a } else { b }
}
```
```haskell
pick :: (Ord a, Show a) => a -> a -> a        -- Haskell: tuple of constraints
pick a b = if a >= b then a else b
```

`T extends A & B` means "`T` implements **both**." Note an asymmetry in Java: you may name at most **one class** but any number of **interfaces** in a multiple bound, and the class (if present) must come first — because a type can extend only one class.

### 2. `where` clauses: the same bounds, more readable

When bounds pile up, inline syntax gets noisy. `where` clauses move them aside:

```rust
fn process<T, U>(items: Vec<T>, f: U) -> Vec<String>
where
    T: Clone + std::fmt::Display,
    U: Fn(&T) -> bool,
{ /* ... */ }
```
```csharp
static T Pick<T>(T a, T b) where T : IComparable<T>, ISerializable { ... }
```
```swift
func pick<T>(_ a: T, _ b: T) -> T where T: Comparable & Codable { ... }
```

`where` clauses are not a different *kind* of bound — they're the same constraints, relocated. They shine when a bound is long (e.g. `U: Fn(&T) -> bool`) or references multiple parameters.

### 3. F-bounded polymorphism: the self-referential bound

Look hard at the canonical Java signature:

```java
static <T extends Comparable<T>> T max(T a, T b) { ... }
```

`T` appears **inside its own bound**: `Comparable<T>`. This is **F-bounded polymorphism** (the "F" is historical, from the original paper's use of a type operator `F`). Read it as: *"`T` is a type that can be compared **to itself**."*

Why is it written this way rather than `T extends Comparable`? Because `Comparable<X>` means "comparable *to* `X`". You want `T` comparable to *the same type*, so the type argument has to be `T` again. Plain `Comparable` (the raw type) would let you compare a `T` to *anything*, losing the precision — you could accidentally compare a `Banana` to a `Wrench`.

The recursive bound shows up across the ecosystem:

```java
public abstract class Enum<E extends Enum<E>> implements Comparable<E> { ... }
```

`java.lang.Enum` is F-bounded so that `compareTo`, `getDeclaringClass`, etc. are typed in terms of *the specific enum subclass*, not `Enum` in general. Every `enum Color {...}` desugars to `class Color extends Enum<Color>`. The bound enforces "an enum's natural ordering is only with enums of its own kind."

In dictionary-passing languages you usually *don't* write this by hand — you use a **`Self` type** instead:

```rust
trait Ord {
    fn cmp(&self, other: &Self) -> Ordering;   // Self = the implementing type
}
```
```swift
protocol Comparable {
    static func < (lhs: Self, rhs: Self) -> Bool   // Self does the self-reference for you
}
```

`Self` *is* the F-bound, baked into the language so you don't hand-write `Comparable<T>` everywhere. That's a real ergonomic advantage of the dictionary-passing model.

### 4. CRTP — the C++ structural cousin

C++ before concepts achieved a similar self-reference with the **Curiously Recurring Template Pattern**:

```cpp
template <typename Derived>
struct Comparable {
    bool operator>(const Derived& other) const {
        return static_cast<const Derived&>(*this).compare(other) > 0;
    }
};

struct Money : Comparable<Money> {   // <-- passes itself as the template argument
    int cents;
    int compare(const Money& o) const { return cents - o.cents; }
};
```

`Money : Comparable<Money>` mirrors `Color extends Enum<Color>`. The base class is parameterized on the derived class, letting the base call derived methods with the *exact* derived type and no virtual dispatch. It's the static-polymorphism dual of an F-bound. (C++20 concepts give a cleaner alternative for many uses; see `senior.md`.)

### 5. The big split: subtype bounds vs dictionary passing

Here is the conceptual heart of this page. Two languages can write nearly identical generic code, yet satisfy the bound by completely different machinery.

**Subtype bounds (Java, C#, Swift class/protocol-as-type).** `T extends Comparable<T>` is satisfied because the *object itself* is a `Comparable` — its methods live on the object (in its class's method table). The generic call `a.compareTo(b)` is an ordinary (often virtual) dispatch through `a`. Consequence: to make a type satisfy the bound, the type's *own definition* must declare it implements the interface. You cannot, in general, retrofit `Comparable` onto a class you don't own.

**Dictionary passing (Haskell typeclasses, Rust traits, Scala givens/implicits).** `T: Ord` is satisfied because somewhere there's an `instance Ord T` / `impl Ord for T` declaration — a **separate** table of the operations for `T`. The type `T` itself doesn't subtype anything. The compiler finds the right dictionary and either passes it as a hidden argument (Haskell, `dyn Trait` in Rust) or specializes the function and inlines the operations (Rust monomorphization). Consequence: you can write `impl MyTrait for SomeoneElsesType` — adding a capability to a type *after the fact*, without touching its definition.

A picture of one bounded call, both ways:

```text
SUBTYPE BOUND (Java)                  DICTIONARY PASSING (Haskell/Rust)

 a : Comparable<T>                     a : T          dict : Ord-for-T
   │   (methods on the object)           │              │ {compare, lt, ...}
   ▼                                      ▼              ▼
 a.compareTo(b)  ── virtual call      cmp(a, b)  uses ── dict.compare(a, b)
   into a's class vtable                                 (passed in / inlined)
```

Same source intent. Different answer to "where do the operations come from."

### 6. What the split buys you

| Question | Subtype bound (Java/C#/Swift) | Dictionary passing (Haskell/Rust/Scala) |
|---|---|---|
| Add a capability to a type you don't own? | No (must edit the type) | **Yes** (`impl Trait for Foreign`) |
| Type can satisfy bound two different ways? | No (one set of methods on the object) | Yes in principle (one *instance* each, but you can pick via newtype/wrapper) |
| Values boxed / carry a vtable pointer? | Often yes (object header) | Often **no** — monomorphized to plain values (Rust/C++) |
| Dispatch | Usually virtual | Static (monomorphized) or dynamic (`dyn`) by choice |
| Self-reference (`compareTo` to own type) | F-bound by hand (`Comparable<T>`) | `Self` type, built in |

These differences aren't cosmetic — they drive whole design philosophies (Rust's "implement traits for any type," Haskell's `instance`-based extensibility) explored in `senior.md`.

### 7. Default methods on the bound

Both worlds let the bound's interface ship **default implementations**, so satisfying a bound can require implementing only a *core* operation and inheriting the rest:

```rust
trait Comparable {
    fn cmp(&self, other: &Self) -> Ordering;        // you must provide this
    fn max(self, other: Self) -> Self where Self: Sized {  // default, free
        if self.cmp(&other) == Ordering::Less { other } else { self }
    }
}
```

Java interfaces (`default` methods), Swift protocol extensions, and Haskell typeclass default methods all do this. Practical upshot: a well-designed bound has a *minimal* required surface and a *rich* derived surface, so implementing it is cheap but using it is powerful.

---

## Real-World Analogies

| Concept | Real-world thing |
|---------|------------------|
| **Subtype bound** | A badge sewn onto a uniform. The person *is* a certified electrician; you read it off them directly. |
| **Dictionary passing** | A separate certification *card* you hand to the foreman along with the worker. The worker need not be modified; the card vouches for them. |
| **Adding `impl Trait for Foreign`** | Issuing a new certification card for an existing worker without changing the worker. |
| **F-bounded `Comparable<T>`** | A rule that says "this referee may only officiate matches *between players of their own league*," not just "any match." |
| **`Self` type** | A form that auto-fills "your own league" so the referee rule writes itself. |
| **Multiple bounds `A & B`** | A job needing *both* a driver's license *and* a food-handler's permit. |
| **Default methods** | A toolkit that comes with one custom part you must forge and ten standard parts already included. |
| **Monomorphization** | Printing a custom, type-specific instruction sheet for each kind of worker instead of one generic sheet plus a lookup card. |

---

## Mental Models

### The "where do the methods live" model

When you see a bounded call `op(x)`, ask: *where does `op`'s implementation physically come from?* In a subtype-bound language, it lives **on the object `x`** (in its class's method table) — `x` carries it. In a dictionary-passing language, it lives in a **separate witness table** selected for `x`'s type and threaded into the function (or inlined). This single question predicts almost every behavioral difference between the two worlds: retrofitting, boxing, dispatch kind.

### The "F-bound is a fixed point" model

`T extends Comparable<T>` looks circular but isn't paradoxical: it's a *constraint with a fixed point*. You're not defining `T` in terms of itself; you're saying "find me a `T` such that `T` is comparable specifically to `T`." `String` satisfies it (`String implements Comparable<String>`); `Object` does not. Read every self-referential bound as "a type that relates to *its own kind*," and the recursion stops being scary.

### The "two columns" model for choosing a language's mechanism

Keep two columns in your head — *subtype bounds* (Java/C#/Swift) and *dictionaries* (Haskell/Rust/Scala). When a question arises ("can I add `Ord` to a third-party type?", "is this value boxed?", "does dispatch cost a vtable hop?"), look up which column the language is in and the answer usually falls out. Most cross-language confusion about bounds is really confusion about which column you're standing in.

---

## Code Examples

### Multiple bounds, four languages

```java
// Java: at most one class, then any interfaces, joined with &
static <T extends Number & Comparable<T>> T clampToMin(T x, T min) {
    return x.compareTo(min) < 0 ? min : x;
}
```
```rust
fn summarize<T: std::fmt::Display + Clone + PartialOrd>(items: &[T]) -> String {
    let mut out = String::new();
    for it in items { out.push_str(&format!("{} ", it.clone())); }
    out
}
```
```csharp
static bool Between<T>(T x, T lo, T hi) where T : IComparable<T>
    => x.CompareTo(lo) >= 0 && x.CompareTo(hi) <= 0;
```
```haskell
describe :: (Show a, Ord a) => a -> a -> String
describe a b = show (if a >= b then a else b)
```

### F-bounded by hand (Java) vs Self type (Rust)

```java
// Java: the F-bound is explicit. Note T appears inside Comparable<T>.
static <T extends Comparable<T>> T maxOf(java.util.List<T> xs) {
    T best = xs.get(0);
    for (T x : xs) if (x.compareTo(best) > 0) best = x;
    return best;
}
```
```rust
// Rust: no hand-written self-reference. `Ord` already uses Self internally.
fn max_of<T: Ord + Copy>(xs: &[T]) -> T {
    let mut best = xs[0];
    for &x in xs { if x > best { best = x; } }
    best
}
```

The Java version *must* spell `Comparable<T>`. The Rust version doesn't, because `Ord::cmp(&self, other: &Self)` carries the self-reference inside the trait.

### Retrofitting a bound: dictionary passing wins

```rust
// Add a capability to a type you don't own — legal because the dictionary
// (the impl) is separate from the type's definition.
trait Summary { fn summary(&self) -> String; }

impl Summary for i32 {                 // i32 is not yours; you extend it anyway
    fn summary(&self) -> String { format!("the integer {}", self) }
}

fn announce<T: Summary>(x: T) { println!("{}", x.summary()); }
// announce(42);  ->  "the integer 42"
```

In Java/C#/Swift you generally cannot make a pre-existing third-party class implement a new interface; the type's *own* declaration would have to change. (Swift extensions and C# extension methods soften this, but they don't make the type a true *subtype* of a new protocol/interface in all cases.) This single example captures the practical difference between the two mechanisms.

### Default methods reduce what an impl must provide

```rust
trait Greet {
    fn name(&self) -> String;                      // required
    fn hello(&self) -> String {                    // default: derived from name()
        format!("Hello, {}!", self.name())
    }
}
struct Dog;
impl Greet for Dog { fn name(&self) -> String { "Rex".into() } }  // hello() comes free
// Dog.hello()  ->  "Hello, Rex!"
```
```java
interface Greet {
    String name();
    default String hello() { return "Hello, " + name() + "!"; }  // Java default method
}
```

### CRTP self-bound in C++ (pre-concepts static polymorphism)

```cpp
template <typename D>
struct Ordered {
    bool operator<=(const D& o) const {
        const D& self = static_cast<const D&>(*this);
        return self.cmp(o) <= 0;            // calls into Derived, no virtual
    }
};
struct Version : Ordered<Version> {
    int n;
    int cmp(const Version& o) const { return n - o.n; }
};
// Version{2} <= Version{5}  ->  true
```

---

## Pros & Cons

| Aspect | Pros | Cons |
|--------|------|------|
| **Multiple bounds** | Express exactly the conjunction of capabilities you need. | Long signatures; Java's one-class-first rule is a foot-gun. |
| **`where` clauses** | Readability for many/complex bounds; can reference multiple params. | Splits the signature into two places to read. |
| **F-bounded** | Precise self-typed APIs (`compareTo` to *own* type; fluent builders that return the subtype). | Boilerplate, alien syntax, and well-known cracks (see pitfalls). |
| **Subtype bounds** | Simple mental model; one method table on the object; familiar OO. | Cannot retrofit; values often boxed; one impl per type only. |
| **Dictionary passing** | Retrofit any type; static dispatch + monomorphization; `Self` removes F-bound boilerplate. | Coherence/orphan rules (next page); possible code bloat from monomorphization. |
| **Default methods** | Minimal required surface, rich derived surface; evolve interfaces without breaking impls. | Diamonds / conflicting defaults need resolution rules. |

---

## Use Cases

- **Numeric generic code** — `<T extends Number & Comparable<T>>` for clamping, normalizing, statistics over any numeric type.
- **Self-typed fluent APIs / builders** — F-bounds so each `with...()` returns the *concrete* builder subtype, not the base (`abstract class Builder<B extends Builder<B>>`).
- **Enums and ordered tag types** — `Enum<E extends Enum<E>>`: comparison and `valueOf` typed to the exact enum.
- **Retrofitting third-party types** — Rust/Haskell `impl`/`instance` to give an external type your interface (e.g. make a vendor struct `Serialize`).
- **Capability composition** — "needs to be hashed *and* displayed *and* cloned" expressed as `T: Hash + Display + Clone`.
- **Static polymorphism in C++** — CRTP / concepts to avoid virtual dispatch in hot paths while still sharing code through a base.

---

## Coding Patterns

### Pattern 1: Self-typed builder via F-bound

```java
abstract class Builder<B extends Builder<B>> {
    @SuppressWarnings("unchecked")
    protected B self() { return (B) this; }
    B name(String n) { /* set */ return self(); }   // returns the *subtype*
}
class UserBuilder extends Builder<UserBuilder> {
    UserBuilder email(String e) { /* set */ return self(); }
}
// new UserBuilder().name("a").email("b")  -- email() is visible after name()
```

The F-bound makes `name()` return `UserBuilder`, so subtype-specific methods stay chainable. Without it, `name()` returns `Builder` and you lose `email()`.

### Pattern 2: Prefer `Self`/dictionary self-reference when the language offers it

```rust
trait Builder: Sized {
    fn name(self, n: &str) -> Self;   // Self handles the self-typing for free
}
```

No hand-written F-bound; `Self` is the cleaner idiom in Rust/Swift.

### Pattern 3: Split many bounds into a `where` clause

```rust
fn run<T, F, E>(input: T, f: F) -> Result<String, E>
where
    T: Clone + std::fmt::Debug,
    F: Fn(T) -> Result<String, E>,
    E: std::error::Error,
{ f(input.clone()) }
```

### Pattern 4: Give the bound a rich default surface

Design your interface/trait so impls provide one or two *core* methods and inherit the rest via defaults — cheaper to implement, easier to use, and easier to evolve without breaking existing impls.

### Pattern 5: Retrofit with a newtype when you can't `impl` directly

In dictionary-passing languages, if you can't add an impl for a foreign type (coherence forbids it — see `senior.md`), wrap it: `struct MyInt(i32)` and `impl MyTrait for MyInt`. The newtype is *yours*, so the impl is allowed.

---

## Best Practices

- **Use `where` clauses once you have more than one or two bounds.** Inline `<T extends A & B & C>` becomes unreadable fast.
- **Reach for `Self`/associated self-reference before hand-rolling an F-bound.** If the language has `Self` (Rust/Swift), prefer it; F-bounds are a workaround for languages without it.
- **Know which mechanism your language uses** before reasoning about retrofitting, boxing, or dispatch. Stand in the right column.
- **In Java multiple bounds, put the (single) class first, interfaces after.** The compiler enforces it; remember it to avoid confusing errors.
- **Keep F-bounds shallow.** They compose poorly: a *list* of F-bounded things, or an F-bound nested in another generic, gets ugly fast. If it's getting deep, reconsider the design.
- **Design bounds with minimal required methods + generous defaults.** It lowers the cost of conforming and lets you extend the interface later without breaking impls.
- **Don't fake retrofitting with casts.** If a language can't retrofit a bound, use a wrapper/newtype or an adapter — never a runtime cast that throws.

---

## Edge Cases & Pitfalls

- **`Comparable<T>` vs `Comparable<? super T>`.** `<T extends Comparable<T>>` rejects a subclass `D` whose comparison is defined on a *parent* type (because `D` implements `Comparable<Parent>`, not `Comparable<D>`). The robust idiom is `<T extends Comparable<? super T>>`. Beginners hit this when an enum or a subclass "should" be comparable but the tight bound refuses it. (Full treatment in `senior.md`.)
- **F-bound doesn't actually stop you passing a *different* type.** `class A implements Comparable<B>` can sneak past loosely written bounds; the recursive bound narrows but doesn't make the API foolproof.
- **Java's raw-type escape hatch.** Using `Comparable` raw (no type argument) silences the F-bound and reintroduces unsafe comparisons. Don't.
- **One class only in a multiple bound (Java).** `<T extends ClassA & ClassB>` is illegal — a type can extend only one class. Multiple *interfaces* are fine.
- **Conflicting default methods (diamond).** When two bounds both supply a default with the same signature, the type must override to disambiguate. Java forces an explicit override; be ready for it.
- **Monomorphization bloat.** In Rust/C++, every distinct `T` you instantiate a bounded generic with creates a fresh code copy. Great for speed, but binary size and compile time can balloon for widely-instantiated generics.
- **Subtype-bound boxing surprise.** In Java, `<T extends Comparable<T>>` with `int` boxes to `Integer`; the autoboxing cost in hot loops is real and invisible in the source.
- **CRTP `static_cast` is unchecked.** `static_cast<const D&>(*this)` trusts that the derived type passed itself correctly. Pass the wrong type and you get undefined behavior, silently.
- **`dyn`/virtual loses monomorphization wins.** Choosing dynamic dispatch (`dyn Trait`, an interface-typed field) over a bounded generic re-introduces a vtable hop and boxing. Sometimes worth it (smaller code), but know the trade.

---

## Test Yourself

1. Rewrite `<T extends Comparable<T> & Serializable>` as a `where`/separate-clause form in C# and Swift. Which methods does the *body* get from each bound?
2. Why does `Enum` use `class Enum<E extends Enum<E>>` instead of `class Enum<E extends Enum>`? What would break with the looser bound?
3. In Rust, write a trait `Doublable` with a required `value()` and a default `doubled()`. Implement it for `i32`, which you don't own. Why is that legal in Rust but the analogous move is hard in Java?
4. Show, with a tiny drawing, where the `compareTo` implementation physically lives in (a) Java's subtype-bound call and (b) Haskell's dictionary-passing call.
5. Explain why a self-typed builder needs an F-bound in Java but only `Self` in Rust. What concrete chained-method call breaks without it?
6. Give a type `D` that satisfies `<T extends Comparable<? super T>>` but *not* `<T extends Comparable<T>>`. Why?
7. You instantiate one Rust bounded generic with 50 different types. What happens to your binary, and why? What's the alternative if that's a problem?

---

## Cheat Sheet

```text
┌──────────────────────────────────────────────────────────────────┐
│              BOUNDED POLYMORPHISM (Middle)                        │
├──────────────────────────────────────────────────────────────────┤
│ Multiple bounds (need >1 capability):                            │
│   Java     <T extends A & B>    (one class first, then ifaces)    │
│   Rust     T: A + B                                               │
│   Haskell  (A a, B a) =>                                          │
│   C#/Swift where T : A, B   /   where T: A & B                    │
├──────────────────────────────────────────────────────────────────┤
│ F-bounded / recursive bound: T mentions T                        │
│   Java     <T extends Comparable<T>>   "comparable to ITSELF"     │
│   Enum     class Enum<E extends Enum<E>>                          │
│   C++      class D : Base<D>            (CRTP)                    │
│   Rust/Swift use Self instead — no hand-written F-bound           │
├──────────────────────────────────────────────────────────────────┤
│ TWO MECHANISMS for "what can I do with bounded T":               │
│   SUBTYPE BOUND   (Java/C#/Swift): T <: Interface;               │
│        methods live ON the object; usually virtual; no retrofit  │
│   DICTIONARY PASS (Haskell/Rust/Scala): separate witness table;  │
│        retrofit any type; static (mono) or dynamic (dyn)         │
├──────────────────────────────────────────────────────────────────┤
│ Default methods: bound supplies derived ops; impls give only core│
├──────────────────────────────────────────────────────────────────┤
│ Watch out:                                                       │
│   Comparable<T> vs Comparable<? super T>   (subclass refusal)    │
│   monomorphization bloat (Rust/C++)                              │
│   diamond default-method conflicts -> must override              │
└──────────────────────────────────────────────────────────────────┘
```

---

## Summary

- **Multiple bounds** conjoin capabilities: `<T extends A & B>`, `T: A + B`, `(A a, B a) =>`. **`where` clauses** are the same constraints relocated for readability.
- **F-bounded polymorphism** is a bound that mentions its own parameter: `<T extends Comparable<T>>` = "comparable to its own type." It powers `Enum<E extends Enum<E>>` and self-typed builders, and has a structural C++ cousin in **CRTP** (`class D : Base<D>`).
- Dictionary-passing languages avoid hand-written F-bounds via the **`Self` type**, built into the trait/protocol.
- The deep split: **subtype bounds** (Java/C#/Swift) satisfy a bound because `T` *is a subtype* — methods ride on the object, dispatch is usually virtual, and you can't retrofit. **Dictionary passing** (Haskell/Rust/Scala) satisfies a bound via a *separate witness table* — you can retrofit any type, and dispatch can be static (monomorphized) or dynamic (`dyn`).
- That split predicts the practical differences: retrofitting, boxing, dispatch cost, and one-impl-per-type.
- **Default methods** let a bound require a small core and provide a rich derived surface.
- Watch the classics: `Comparable<T>` vs `Comparable<? super T>`, Java's one-class multiple-bound rule, diamond default conflicts, and monomorphization bloat.

---

## What You Can Build

- **A self-typed builder hierarchy** in Java using `Builder<B extends Builder<B>>`, then the same in Rust with `Self`. Compare the boilerplate.
- **A "retrofit" demo:** add your own `Summary` trait to a built-in type in Rust/Haskell, then try (and fail) to do the equivalent in Java — and document why.
- **A numeric-stats library** bounded by `<T extends Number & Comparable<T>>` (Java) / `T: Num + Ord` (Haskell-ish) computing min/max/median over any numeric type.
- **A CRTP `Ordered<D>` base** in C++ that supplies `<`, `<=`, `>`, `>=` from a single `cmp`, with zero virtual calls. Benchmark it against a virtual `Comparable` interface.
- **A side-by-side "where do the methods live" diagram generator** for one bounded call in Java vs Rust vs Haskell, to teach the subtype-vs-dictionary split to a teammate.

---

## Further Reading

- *On Understanding Types, Data Abstraction, and Polymorphism* — Cardelli & Wegner, 1985. The origin of the bounded-quantification framing.
- *F-Bounded Polymorphism for Object-Oriented Programming* — Canning, Cook, Hill, Olthoff, Mitchell, 1989. The paper that named the pattern.
- *Effective Java* — Joshua Bloch. Recursive type bounds and the builder pattern in practice.
- *The Rust Book* — Chapter 10 (traits, `where` clauses) and Chapter 19 (advanced traits, `Self`, associated items). https://doc.rust-lang.org/book/
- *Programming in Scala* — Odersky et al. Implicits/givens as dictionary passing.
- *Real World Haskell* — chapters on typeclasses; how `instance` declarations are the dictionaries.
- *C++ Templates: The Complete Guide* — Vandevoorde, Josuttis, Gregor. CRTP and static polymorphism.
- *Type Classes as Objects and Implicits* — Oliveira, Moors, Odersky, 2010. The bridge between typeclasses and dictionary passing.
