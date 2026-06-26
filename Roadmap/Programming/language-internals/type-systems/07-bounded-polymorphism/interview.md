# Bounded Polymorphism — Interview Questions

> **Topic:** [Bounded Polymorphism](README.md)
> **Focus:** Constraining a type parameter so generic code can *do* something with it — bounded quantification, F-bounds, typeclasses/traits vs subtype bounds, coherence, and the dispatch trade-offs — across Java, Rust, Haskell, Swift, and C++.

---

## Introduction

These questions probe whether a candidate understands *why* a plain `<T>` can only move values around (parametricity), *what a bound buys* (the capability to call operations on `T`), and the genuinely different machinery languages use to deliver that capability — subtype bounds (the object carries its methods) versus dictionary passing (a separate witness table for the type). Strong candidates speak precisely: they distinguish a bound from a cast, explain `Comparable<T>` vs `Comparable<? super T>`, know that coherence is what makes `Set` sound, and can articulate the monomorphization-vs-dynamic-dispatch trade-off. Weaker candidates conflate bounds with inheritance, think `volatile`-style "it just works," or can't say why typeclasses are more than interfaces.

The questions move from conceptual foundations, through language-specific surfaces (Java bounds, Rust trait bounds, Haskell typeclasses, Swift protocols, C++ concepts), into traps where the obvious answer is wrong, and finally to design scenarios that reveal whether the candidate has built and evolved bounded-generic APIs.

## Table of Contents

- [Conceptual / Foundational](#conceptual--foundational)
- [Language-Specific](#language-specific)
- [Tricky / Trap Questions](#tricky--trap-questions)
- [Design Questions](#design-questions)
- [Cheat Sheet](#cheat-sheet)
- [Further Reading](#further-reading)

---

## Conceptual / Foundational

## Question 1

**What can you do with an unbounded `<T>`, and why so little?**

With a truly unbounded type parameter you can only **store, pass, return, and place into / retrieve from generic containers** a value of type `T`. You cannot call methods on it, compare it, add it, or print it meaningfully. The reason is *parametricity*: the function promised to work for *every* type, so it can only use operations that *every* type shares — which is essentially none beyond reference identity. The compiler holds you to the promise: since `T` could be any type, including ones with no `<` or `.foo()`, those operations are rejected. This restriction is not a limitation to fight; it's a guarantee — unbounded generic code is provably uniform across all types, which is why, for example, `reverse` on a list can't accidentally depend on element contents.

## Question 2

**What does adding a bound change, and what's the trade-off?**

A bound (`<T extends Comparable<T>>`, `T: Ord`, `where T: IComparable<T>`) narrows the set of acceptable types to those satisfying it and, in exchange, grants the body the bound's operations. The trade is **fewer accepted types for more capability**: `<T>` works for everything and can do nothing; `<T extends Comparable<T>>` works only for comparable types and can call `compareTo`. Stated as a slogan: a bound *shrinks who can call you so it can grow what you can do*. Crucially, this is checked at compile time at the call site — supply a non-conforming type and it won't compile — so there's no cast and no runtime failure.

## Question 3

**What is an upper bound, and is it the common case?**

An upper bound says "`T` must be (a subtype of / must implement) this interface" — `extends`, `:`, `where T :`. It's by far the most common kind of bound; the everyday `max`, `sort`, `dedup` all use one. It contrasts with lower bounds / variance annotations (`? super T`), which constrain what can flow *into* a container rather than what capabilities `T` has, and which solve a different problem. When people say "bounded polymorphism" without qualification they almost always mean upper bounds.

## Question 4

**What is F-bounded (recursive) polymorphism, and why is `<T extends Comparable<T>>` written that way?**

F-bounded polymorphism is a bound that *mentions the type parameter inside itself*. `Comparable<X>` means "comparable *to* `X`"; you want `T` comparable to *its own type*, so the argument is `T` again: `Comparable<T>`. Without the self-reference (raw `Comparable`), you could compare a `T` to *anything*, losing type safety — comparing a `Banana` to a `Wrench` would type-check. The pattern powers `java.lang.Enum<E extends Enum<E>>` (so an enum's ordering is typed to its own kind) and self-typed fluent builders (`Builder<B extends Builder<B>>`, so chained methods return the concrete subtype). C++'s structural cousin is CRTP (`class D : Base<D>`). Rust and Swift avoid hand-writing it via the built-in `Self` type.

## Question 5

**Explain the two implementation strategies for "what can I do with a bounded `T`."**

**Subtype bounds** (Java, C#, Swift): `T` must *be a subtype of* the bound interface; its methods live on the object, and a bounded call is ordinary (often virtual) dispatch through the object. You generally can't retrofit a bound onto a type you don't own. **Dictionary passing** (Haskell typeclasses, Rust traits, Scala givens): the type subtypes nothing; instead a *separate table of operations* (a dictionary/witness) for that type is found by the compiler and threaded into the call — or monomorphized away. Because the dictionary is separate from the type, you *can* retrofit (`impl Trait for ForeignType`). The split predicts retrofitting ability, boxing, and dispatch kind.

## Question 6

**Why are typeclasses called "ad-hoc polymorphism done right"?**

Ad-hoc polymorphism is one operation name with genuinely different per-type implementations (`+` is integer add for ints, concat for strings). Raw overloading is the *undisciplined* form: resolved syntactically, can't be abstracted over, no global consistency guarantee. Typeclasses are the *disciplined* form: one declared signature (`class Eq a where (==) :: a -> a -> Bool`), many independent **instances**, the ability to write generic code over "any type with an `Eq` instance," and **coherence** — the guarantee that the *same* instance is used everywhere for a type. That coherence is what makes `Set a` sound; overloading provides none of it.

## Question 7

**What is coherence and why does it matter?**

Coherence is the invariant that for a given type and class, the whole program uses **one** instance. It matters because data structures depend on it: a `BTreeSet<T>` orders elements via `Ord<T>`; if one part of the program inserted with one ordering and another looked up with a different ordering, the tree invariant would silently break — duplicate entries, failed lookups, corruption. Coherence guarantees one canonical instance, so the set stays sound. It's a *global* property, which is why languages need rules (orphan rules) to enforce it modularly.

## Question 8

**What's the orphan rule and why does it exist?**

The orphan rule says an instance (`impl C for T`) may only be defined in the module/crate that owns the class `C` or the type `T`. It exists to make *coherence* enforceable without whole-program analysis: if orphans were allowed, two independent libraries could each define a different `impl Display for VendorType`, and a program depending on both would have conflicting instances meeting at link time — incoherence. By anchoring each instance to a crate owning one of its components, at most one such crate can exist per (class, type) pair. The practical pain — you can't implement someone else's trait for someone else's type — is worked around with a **newtype** wrapper you own.

## Question 9

**Associated type vs type parameter on the class — when each?**

Use an **associated type** when the implementing type *determines* the companion type: `Iterator` has `type Item` because a given iterator yields exactly one item type, so you write `Iterator` not `Iterator<u8>`, keeping inference clean. Use a **type parameter on the class** when a single type can genuinely satisfy the bound *multiple ways* differing in that type: `Add<Rhs>` lets you add a scalar to a vector *and* a vector to a vector. The deciding test: *does the implementing type determine the other type?* Yes → associated type; no → parameter. (Rust's `Add` is instructive: `Rhs` is a parameter, but its `Output` is an associated type, because given the inputs the result type is fixed.)

## Question 10

**State the expression problem and how typeclasses solve it.**

The expression problem: extend a datatype with new *cases* **and** new *operations*, each independently, statically type-safe, no recompilation of old code, no casts. OO subtype interfaces make new types easy (new class) but new operations hard (edit every existing class). Functional pattern-matching makes new operations easy (new function) but new types hard (edit every existing `case`). Typeclasses open both axes: model each *operation* as a class; add a new type by writing its instances (no existing code changes), add a new operation by writing a new class with instances for existing types (no existing code changes). This is the precise sense in which typeclass-style bounds are strictly more extensible than subtype interfaces.

## Question 11

**Why does a bound propagate up the call chain?**

If function `g` calls a bounded helper `f` that requires `T: Ord`, then `g` must *also* declare `T: Ord` — otherwise it couldn't supply a conforming type to `f`. You can never have *less* constraint than the things you call; constraints flow outward. In dictionary terms, `g` must receive the `Ord` dictionary so it can pass it to `f`. The common beginner error — "bound not satisfied" — is usually fixed by repeating the bound on the *outer* function, not by casting.

## Question 12

**Is a bound a cast? Explain.**

No. A cast is a *runtime* assertion that can fail (`ClassCastException`); a bound is a *compile-time* contract that's verified at the call site and *cannot* fail at runtime. With `<T extends Comparable<T>>`, the compiler refuses any call whose argument type isn't `Comparable`, so inside the body `compareTo` is guaranteed present — no check, no exception. Replacing a bound with a runtime cast throws away exactly this safety and reintroduces the failure the bound eliminated.

---

## Language-Specific

## Question 13

**(Java) Read `<T extends Number & Comparable<T>>`. What are the rules for multiple bounds?**

It means `T` must be both a `Number` and `Comparable<T>`; the body may call `Number`'s methods (`doubleValue`) and `compareTo`. Java's rules: a multiple bound may name **at most one class**, and it must come **first**, followed by any number of interfaces, all joined with `&`. The single-class rule follows from single inheritance — a type can extend only one class. `extends` is reused regardless of whether the bound is a class or an interface.

## Question 14

**(Java) Why does `java.lang.Enum` use `class Enum<E extends Enum<E>>`?**

So that operations like `compareTo` and `getDeclaringClass` are typed in terms of *the specific enum subclass*, not `Enum` in general. The F-bound enforces "an enum's natural ordering is only with enums of its own kind" — you can't compare `Color.RED` to `Suit.HEARTS`. Every `enum Color {...}` desugars to `class Color extends Enum<Color>`. The looser `Enum<E extends Enum>` (raw) would let unrelated enums be compared and lose the precise typing.

## Question 15

**(Rust) What does `T: Ord` give you that `T` alone doesn't, and how is it dispatched?**

`T: Ord` provides the comparison operators (`<`, `>`, `cmp`) because `Ord` declares them with `Self`-typed parameters; an unbounded `T` has none. By default Rust **monomorphizes** the generic — it stamps out a specialized copy per concrete `T` and inlines the comparison, so dispatch is static and zero-cost. You can opt into **dynamic** dispatch with `&dyn Trait` (one copy, a vtable hop), but only for *object-safe* traits — and `Ord` is *not* object-safe (its `cmp(&self, other: &Self)` mentions `Self`), so `dyn Ord` is illegal.

## Question 16

**(Rust) Explain the orphan rule with a concrete example and the standard workaround.**

`impl std::fmt::Display for Vec<i32>` is rejected: both `Display` and `Vec` are foreign to your crate, so the instance is an orphan and would threaten coherence. The standard workaround is a **newtype**: `struct Csv(Vec<i32>); impl Display for Csv { ... }`. Because `Csv` is *yours*, the impl is legal. The newtype also lets you supply a *non-default* behavior (e.g. a second ordering) for a type without violating coherence.

## Question 17

**(Haskell) Walk through how `Ord a => a -> a -> a` is compiled.**

Via **dictionary translation**. The constraint `Ord a` becomes an explicit value parameter — a dictionary of `Ord`'s operations for `a`. So `maxOf :: Ord a => a -> a -> a` compiles roughly to `maxOf :: OrdDict a -> a -> a -> a`, where each use of `>=`/`compare` becomes a field access into the dictionary. At a call site, the compiler finds the `Ord Int` instance, materializes its dictionary, and passes it. Because `Ord` has a superclass `Eq`, the `Ord` dictionary *contains* the `Eq` dictionary, so an `Ord a` constraint supplies `Eq a` for free.

## Question 18

**(Haskell) What's the difference between a typeclass and an OO interface?**

Three big ones. (1) **Retrofitting**: you can write `instance MyClass ExistingType` for a type defined elsewhere, without modifying it — an interface requires editing the type's declaration. (2) **Coherence**: Haskell guarantees one instance per type globally, so collections are sound; interfaces have no such guarantee (an object just carries whatever methods it was built with). (3) **Return-position / `Self` polymorphism**: typeclass methods can mention the type in return position and constraints (`mempty :: a`, `read :: String -> a`) — there's no object to dispatch on, the *type* is resolved by inference — which interfaces, dispatching on a receiver object, cannot express.

## Question 19

**(Swift) How do protocol bounds work, and what's a `some`/`any` distinction?**

Swift bounds a generic by protocol: `<T: Comparable>` or `func f<T>(_ x: T) where T: Comparable`. The protocol's requirements (`<`, `==`) become available in the body. Swift uses `associatedtype` for associated types (the `Element` of a `Sequence`). The modern `some P` (opaque type) means "one specific concrete type satisfying `P`, hidden from the caller" — monomorphized, no boxing — while `any P` (existential) means "any type satisfying `P`, boxed behind a witness table" — the dynamic-dispatch form. Choosing `some` vs `any` mirrors the static-vs-dynamic dispatch decision elsewhere.

## Question 20

**(C++) What problem do C++20 concepts solve that SFINAE didn't?**

Before C++20, templates had no *declared* bound — `template<class T> T max(T,T)` just assumed `T` had `<`, and a missing operator produced an error *deep inside instantiation* with pages of candidate dumps. Authors emulated bounds with **SFINAE** (`enable_if`), which worked but was write-only and still failed unreadably. **Concepts** add declared, named predicates on types (`template<class T> concept Sortable = requires(T a, T b){ a < b; };`) so the constraint is checked at the call site, the error is one readable line ("`Widget` does not satisfy `Sortable`"), and overload resolution uses **subsumption** to prefer the more-constrained candidate. Concepts are *structural* (satisfy by having the operations, no inheritance), preserving C++'s template flavor while fixing diagnostics and overloads.

## Question 21

**(C++) Are concepts nominal or structural, and why does it matter?**

**Structural**: a type satisfies `HasSize` by *having* a conforming `.size()`, with no declaration that it "implements" the concept. This matters two ways. Upside: zero-friction conformance, works with types you don't own, matches duck-typed templates. Downside: *unintended* types can satisfy a concept (anything with a `.size()` matches `HasSize`, even if semantically unrelated), so a concept constrains *syntax*, not *meaning* — you add semantic guarantees by convention or extra requirements. Contrast Rust traits, which are **nominal** (you must `impl`), giving an explicit conformance act at the cost of needing the orphan-rule machinery.

## Question 22

**(C#) How does `where T : IComparable<T>` compare to Java's `extends`?**

Conceptually identical — an upper bound expressed with a `where` clause instead of inline `extends`. The body gains `IComparable<T>.CompareTo`. C# also supports constraints Java lacks at the syntax level: `where T : class` / `where T : struct` (reference vs value type), `where T : new()` (parameterless constructor), and `where T : unmanaged`. Like Java it's a subtype bound (the object carries the interface), so retrofitting a sealed third-party type with a new interface generally isn't possible without a wrapper or extension methods (which don't make it a true subtype).

---

## Tricky / Trap Questions

## Question 23

**What's the difference between `<T extends Comparable<T>>` and `<T extends Comparable<? super T>>`, and when does it bite?**

`Comparable<T>` requires `T` to compare *to exactly its own type*. `Comparable<? super T>` requires `T` to compare to *itself or any supertype*. The trap: a subclass `D extends C` that inherits `Comparable<C>` (it implements comparison at the *parent* level) does **not** satisfy `<T extends Comparable<T>>` — because `D` implements `Comparable<C>`, not `Comparable<D>`. The robust idiom for library APIs (e.g. `Collections.max`) is `<T extends Comparable<? super T>>`, which accepts such subclasses. Beginners hit this when an enum or a subclass "should obviously" be comparable but the tight bound refuses it.

## Question 24

**A candidate says "typeclasses are just interfaces." What's the strongest counterexample?**

A method that mentions the type *only in return position with no receiver*: Haskell's `mempty :: Monoid a => a` or `read :: Read a => String -> a`. There's no object to dispatch on — the instance is chosen by the *result type*, resolved by inference. An OO interface dispatches on a receiver object, so it fundamentally cannot express "produce a value of the conforming type out of nothing." That, plus retrofitting and coherence, shows typeclasses are a different mechanism, not interfaces with syntax.

## Question 25

**"I'll just retrofit `Comparable` onto this third-party class." What happens, by language?**

In Java/C#/Swift (subtype bounds) you generally **can't** — the type's own declaration would have to change; you wrap it or supply an explicit comparator instead. In Rust/Haskell (dictionary passing) you *can* `impl`/`instance` for a foreign type **only if you own the trait or the type** — otherwise the orphan rule forbids it, and you newtype-wrap. The trap is assuming the mechanism your favorite language uses generalizes; it doesn't. The right answer names the mechanism (subtype vs dictionary), the orphan rule, and the newtype escape.

## Question 26

**Why can't `Ord` (Rust) or `Clone` be used as a `dyn` trait object?**

Because they're not **object-safe**. A trait object's vtable is a fixed table of monomorphic function pointers; methods that return `Self` by value (`Clone::clone -> Self`) or take `Self` by value/another `Self` parameter in a way the vtable can't encode (`Ord::cmp(&self, other: &Self)`) can't be placed in it — the concrete type isn't known at the `dyn` call. So `Box<dyn Ord>` and `Box<dyn Clone>` are illegal. The trap: candidates assume any trait can be `dyn`. The senior answer ties it to vtable mechanics and notes the workaround (a separate object-safe trait, e.g. `clone_box(&self) -> Box<dyn ...>`).

## Question 27

**Does adding a defaulted method to a published trait break downstream impls? What about a required method or a supertrait?**

A **defaulted** method is usually non-breaking — existing impls inherit the default. A **required** method (no default) **breaks** every downstream impl, which must now provide it. Adding a **supertrait** (`trait Foo: Bar`) **breaks** every `Foo` impl, which must now also implement `Bar`. So the evolution rule is: grow a published trait only via *defaulted* methods and *new* traits; treat the required surface and supertrait set as frozen. Candidates who say "adding to an interface is always safe" miss the required-method and supertrait cases.

## Question 28

**Your generic compiles but the binary tripled in size. Why, and how do you fix it?**

**Monomorphization bloat**: a Rust/C++ bounded generic instantiated over many types stamps out a separate code copy per type. The fix options: route the heterogeneous case through **dynamic dispatch** (`dyn Trait` — one copy); or **outline the cold path** — keep a thin monomorphized shell that immediately forwards to a single *non-generic* function holding the heavy logic, so only the small shell is duplicated. The trap is treating monomorphization as free; it trades binary size and compile time for dispatch speed.

## Question 29

**Can a type have two different `Ord` instances? You "need" sort-by-name and sort-by-age for one struct.**

Not under coherence — there's exactly one canonical `Ord` per type. Trying to declare two is a conflict. The correct approaches: (1) **newtype** wrappers (`ByName(Person)`, `ByAge(Person)`), each with its own `Ord`; or (2) pass the ordering **explicitly** as an argument (`sort_by(|a, b| ...)`, an explicit `Comparator`). Coherence is for the *canonical* ordering; per-call behavior belongs in an ordinary argument, not a second instance. Candidates who try to register two instances are fighting the mechanism.

## Question 30

**Is `<T>` with `T: Any`/`T: Sized`/`T: Object` actually "unbounded"?**

Mostly yes, with caveats. Rust's implicit `Sized` bound and Go's `any` are not *capability* bounds — they don't let you call domain operations, only move values. Java's `<T>` implicitly allows `Object`'s methods (`equals`, `hashCode`, `toString`) because every reference type extends `Object`, so those *are* callable — but a *meaningful, type-specific* comparison still needs `Comparable`. The trap is thinking `equals`/`toString` being callable means `T` is "bounded"; those are the universal floor, not a capability bound.

## Question 31

**Why is "negative reasoning" (`T` does *not* implement `C`) generally forbidden?**

Because it breaks the **open-world assumption** that makes coherence composable. If code branches on "`T` is not `Foo`," then a downstream crate later adding `impl Foo for T` would silently flip the branch — spooky action at a distance, a non-monotonic behavior change from a *purely additive* edit. Most languages forbid it (or restrict it heavily) so that adding instances can never invalidate existing code. The trap is wanting "if not serializable, do X" specialization; the principled designs avoid it.

---

## Design Questions

## Question 32

**Design a generic `max`/`min`/`sort` API that works across an ecosystem. What bound, and what pitfalls?**

Bound by *ordering*: `<T extends Comparable<? super T>>` (Java — note the `? super T` to accept subclasses), `T: Ord` (Rust), `Ord a =>` (Haskell). Provide both a natural-ordering version *and* an explicit-comparator version (`sort_by`, `Comparator`) so callers with non-canonical or multiple orderings aren't forced into newtypes. Pitfalls: the tight `Comparable<T>` self-bound rejecting subclasses; coherence forbidding two orderings (hence the comparator overload); and, for performance, deciding monomorphized (hot, few types) vs `dyn` (heterogeneous) — though comparison traits often aren't object-safe, pushing you toward monomorphization or explicit closures.

## Question 33

**Design an extensible AST / interpreter that must accept new node types and new passes. Which mechanism?**

This is the **expression problem**; choose typeclass/trait-per-operation, not a subtype interface or a closed ADT. Model each pass (`Eval`, `Pretty`, `Optimize`) as a class/trait; each node type provides instances. New node type = new type + its instances (no existing code edits). New pass = new class + instances for existing nodes (no existing code edits). If the language only has subtype interfaces, you'll be forced to edit every node class to add a pass; if only ADTs, every pass to add a node. Call out the trade: typeclass solutions risk instance proliferation and the temptation of overlapping instances.

## Question 34

**Design a plugin system where many implementations are stored together and dispatched at runtime. Static or dynamic bound?**

**Dynamic** (`Vec<Box<dyn Plugin>>`, a list of interface references): the implementations are *heterogeneous* types stored together, which a single monomorphized `T` cannot express, and the dispatch is cold relative to plugin work, so the vtable hop is negligible. Design the `Plugin` trait to be **object-safe** (no `Self`-returning methods, no generic methods) — this is a hard requirement for `dyn`, and one accidental `-> Self` method forecloses it. Keep any hot, homogeneous fast path as a separate monomorphized generic. Document the dispatch choice.

## Question 35

**Design a foundational trait (e.g. `Codec`/`Serialize`) for a library others depend on. What governs your decisions?**

Coherence and evolution. (1) **Granularity**: prefer small capability traits (`Encode`, `Decode`) over one fat trait, so consumers bound by exactly what they use. (2) **Minimal required surface + defaulted growth**: ship the smallest required method set; add everything later as *defaulted* methods so existing impls don't break. (3) **Supertraits up front**: you can't add one later without breaking impls. (4) **Orphan-friendliness**: provide feature-gated instances for popular foreign types *from your crate* (you own the trait), so users never need orphans. (5) **Object safety** if `dyn` use is expected. The meta-principle: a published trait's required surface and supertrait set are effectively frozen — design as if you can never tighten.

## Question 36

**You must choose between a subtype interface and a typeclass/trait for a new abstraction. What are the deciding factors?**

Ask: (a) Do third parties need to add the capability to types *they don't own*? → typeclass/trait (retrofittable) over subtype interface. (b) Do you need *coherence* (sound collections, one canonical behavior)? → typeclass/trait. (c) Do you need methods that return the type or have no receiver (`parse`, `default`)? → typeclass/trait. (d) Are you in an OO ecosystem where runtime polymorphism and familiarity dominate, and retrofitting isn't needed? → subtype interface is fine and simpler. (e) Do you need both new-type and new-operation extensibility (expression problem)? → typeclass/trait. The honest answer weighs ecosystem and extensibility, not dogma.

## Question 37

**A teammate proposes adding a blanket impl (`impl Trait for all T: OtherTrait`) to a shared published crate. What's your review?**

Push back hard. A blanket impl is a major **coherence event**: it can collide with *downstream* impls you can't see (`impl Trait for SpecificType` in a dependent crate), producing an unresolvable overlap and breaking their builds — a far-reaching, often irreversible change. It's also nearly impossible to *remove* later without breaking everyone relying on it. If the capability is genuinely universal and designed-in from the start, a blanket impl is fine; bolting one onto a published trait is one of the most dangerous additive changes in the taxonomy. Prefer explicit impls, a new trait, or a helper function.

---

## Cheat Sheet

```text
+------------------------------------------------------------------+
|              BOUNDED POLYMORPHISM — INTERVIEW MUST-KNOW          |
+------------------------------------------------------------------+
| Unbounded <T>: store/pass/return only (parametricity).          |
| Bound: shrink who can call you -> grow what you can do.          |
| Checked at CALL SITE, compile time. Not a cast. Never throws.   |
+------------------------------------------------------------------+
| Upper bound = "T implements/<: Interface" (the common case).    |
| F-bound  = T mentions T: <T extends Comparable<T>>.             |
|   Enum<E extends Enum<E>>, self-typed builders; C++ CRTP.       |
|   Rust/Swift use Self instead.                                  |
+------------------------------------------------------------------+
| TWO mechanisms:                                                 |
|   subtype bound (Java/C#/Swift): methods on object; no retrofit |
|   dictionary pass (Haskell/Rust/Scala): separate witness;       |
|       retrofittable; static (mono) or dynamic (dyn)             |
+------------------------------------------------------------------+
| Typeclasses = ad-hoc poly done right: 1 sig, many instances,    |
|   COHERENCE (one instance/type -> sound Set/Map).               |
| Orphan rule: instance where CLASS or TYPE is defined.           |
|   escape = newtype.                                             |
+------------------------------------------------------------------+
| Assoc type (impl determines it: Iterator::Item)                 |
|   vs class param (multiple impls: Add<Rhs>).                    |
| Expression problem: typeclasses open BOTH types & operations.   |
+------------------------------------------------------------------+
| C++: SFINAE(enable_if)=hidden bound, error-hell;                |
|      concepts(C++20)=declared, 1-line error, subsumption.       |
| dyn needs OBJECT SAFETY (no -> Self, no generic methods).       |
| Published trait: grow via DEFAULTS; +required/+supertrait BREAK |
| Comparable<T> vs Comparable<? super T> (subclass refusal).      |
| Mono = fast but BLOAT; dyn = small but indirection.             |
+------------------------------------------------------------------+
```

---

## Further Reading

- *On Understanding Types, Data Abstraction, and Polymorphism* — Cardelli & Wegner, 1985. Bounded quantification's origin.
- *F-Bounded Polymorphism for Object-Oriented Programming* — Canning et al., 1989.
- *How to Make Ad-Hoc Polymorphism Less Ad Hoc* — Wadler & Blott, 1989. Typeclasses and dictionary translation.
- *The Expression Problem* — Wadler's note.
- *The Rust Book*, Chapters 10 & 19 — trait bounds, `where`, `Self`, object safety, associated types. https://doc.rust-lang.org/book/
- *Effective Java* — Bloch. Recursive type bounds and `Comparable<? super T>` idioms.
- *C++20 Concepts* — the standard, plus Stroustrup/Sutton's papers; the `ranges` library as a worked example.
- *The Swift Programming Language* — Generics and `some`/`any` chapters.
- *Types and Programming Languages* — Pierce. The formal background on bounded quantification and parametricity.
