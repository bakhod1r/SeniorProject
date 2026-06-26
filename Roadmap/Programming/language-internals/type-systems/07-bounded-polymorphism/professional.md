# Bounded Polymorphism — Professional Level

> **Topic:** [Bounded Polymorphism](README.md)
> **Focus:** Engineering with bounds at scale — monomorphization vs witness-table dispatch trade-offs, C++ pre-concepts SFINAE error-hell vs concepts, designing ecosystem-wide bound hierarchies, API evolution under coherence, and choosing the right mechanism per constraint.

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

> Focus: **The decisions a staff engineer makes around bounds** — code size vs dispatch cost, error-message quality, API stability across an ecosystem, and which of the (now many) bound mechanisms to reach for under real constraints.

At this level the question is no longer "how do bounds work" but "how do I *wield* them in a system that ships, evolves, and is depended upon." Four pressures dominate:

1. **Cost.** A bounded generic can be **monomorphized** (one specialized copy per type — fast, but binary bloat and compile-time cost) or **dispatched dynamically** (one copy, a witness/vtable hop per call — small, but a runtime cost and an object-safety constraint). Choosing per-API is a real engineering decision, not a default.
2. **Diagnostics.** C++ templates pre-concepts had no *declared* bounds; constraints were enforced implicitly via **SFINAE**, producing the infamous pages-long error dumps. **C++20 concepts** retrofit declared bounds onto templates, turning a wall of instantiation errors into one line: "`T` does not satisfy `Sortable`." This is one of the largest practical improvements in C++'s history, and it's pure bounded polymorphism.
3. **Evolution under coherence.** Once you ship a trait/typeclass with instances across an ecosystem, adding a supertrait, a method, or a new default is a *compatibility event*. Coherence means you can't just add an instance somewhere; you must reason about what existing code recompiles or breaks.
4. **Mechanism choice.** Modern languages give you several ways to express "this code needs a capability": subtype bound, dictionary-passing trait (static or `dyn`), structural `concept`, even duck-typed templates. Picking correctly per constraint — and knowing the migration paths between them — is the senior-to-staff jump.

> 🎓 **Why this matters at the professional level:** These choices have a half-life of years. A trait you make object-unsafe forecloses `dyn` forever; a generic you monomorphize across hundreds of types inflates every downstream binary; a concept you write badly leaks implementation into your contract. Bounds are an API surface, and at scale, API surfaces are forever.

This page covers the monomorphization/dynamic-dispatch cost model in production terms, the SFINAE-vs-concepts story end to end, designing and evolving bound hierarchies for whole ecosystems, and a decision framework for choosing among the available mechanisms.

---

## Prerequisites

- **Required:** The senior page — dictionary translation, coherence, orphan rules, associated types, the expression problem.
- **Required:** Production experience with at least one bounded-generics ecosystem (Rust crates, a C++ template-heavy codebase, a Haskell/Scala library, or a large Java generic API).
- **Required:** Comfort reading compiler errors and reasoning about binary size and compile times.
- **Helpful:** Having debugged a template error dump, or migrated an API across a breaking trait change.

You do **not** need: compiler-internal trait-solver algorithms, formal type-theory proofs, or the higher-kinded `Functor`/`Monad` tower (adjacent, separate topic).

---

## Glossary

| Term | Definition |
|------|-----------|
| **Monomorphization** | Compiling a separate specialized copy of a bounded generic per concrete type. Static dispatch, inlining, no runtime witness — at the cost of code size and compile time. |
| **Dynamic dispatch / witness-table dispatch** | One generic copy; the bound's operations reached at runtime through a vtable/dictionary pointer (`dyn Trait`, an interface-typed value). Small code, an indirection per call. |
| **Object safety** | The conditions a trait must meet to be usable as `dyn` (no generic methods, no `Self`-by-value returns, etc.). |
| **SFINAE** | "Substitution Failure Is Not An Error." C++'s pre-concepts mechanism: a template overload is silently discarded if substituting the type fails, used to emulate bounds. |
| **Concept (C++20)** | A *declared, named* predicate on types (`template<class T> concept Sortable = requires(T a){ ... };`) that constrains templates with readable diagnostics. |
| **`requires` clause / expression** | C++20 syntax stating a template's constraints, or testing whether expressions are valid for a type. |
| **Constraint subsumption** | C++20 rule letting the compiler pick the *more constrained* overload when several concepts apply. |
| **Specialization** | Providing a more specific impl that overrides a generic one (Rust unstable; C++ template specialization; Haskell `OVERLAPPING`). |
| **Code bloat** | Binary-size growth from monomorphizing a generic across many types. |
| **Sealed / sealed trait** | A trait/interface whose set of implementers is fixed by the author, controlling evolution (`sealed` in Java/Kotlin/Scala; the "sealed trait" idiom in Rust). |
| **Coherence event** | An API change (new supertrait, new method, new instance) whose effect must be analyzed against the global coherence invariant. |
| **`impl Trait` / existential** | Returning/accepting "some type satisfying a bound" without naming it (`impl Trait` in Rust, `some`/`any` in Swift). |

---

## Core Concepts

### 1. The cost model: monomorphization vs dynamic dispatch

Every bounded generic must, at some point, be *given* its operations. Two strategies, with opposite cost profiles:

**Monomorphization (static).** The compiler stamps out a fresh, specialized copy of the function for each concrete type it's used with, inlining the bound's operations. Used by Rust (default), C++ templates, and (partially) specialized JITs.

- *Pros:* no runtime indirection, full inlining, the fastest possible dispatch, often zero abstraction cost.
- *Cons:* **code bloat** (N types → N copies), longer compile times, larger binaries, worse instruction-cache behavior if the copies are hot and numerous, and slower incremental builds.

**Dynamic dispatch (witness table).** One copy of the function; the bound's operations reached through a runtime pointer to a vtable/dictionary (`&dyn Trait`, a Java interface reference, a Go interface value, a Swift existential).

- *Pros:* one copy regardless of type count, smaller binaries, faster compiles, the ability to store heterogeneous types behind one bound (`Vec<Box<dyn Draw>>`).
- *Cons:* an indirect call per operation (defeats inlining, a branch-predictor and i-cache cost), often a heap allocation/boxing, and the trait must be **object-safe**.

The professional reflex: **monomorphize hot, small, few-typed generics; dynamically dispatch cold, large, or heterogeneously-typed ones.** A 3-line comparator used in a tight sort across 5 types: monomorphize. A 2,000-line request handler parameterized over a `Plugin` trait with 50 implementations: probably `dyn`, to keep the binary and compile sane. Many codebases mix both: a monomorphized fast path, a `dyn` slow/heterogeneous path.

### 2. Object safety: the gate on `dyn`

You can only choose dynamic dispatch if the trait is **object-safe**. The core restrictions (Rust's formulation, but the principle is universal): the trait must not have methods that are *generic* over additional type parameters, must not return `Self` by value, and must not have non-`self` `Self`-typed parameters in dispatchable methods — because a vtable is a fixed table of monomorphic function pointers, and none of those shapes can be put in such a table. `Clone` (returns `Self`) and `Ord` (`cmp(&self, &Self)`) are **not** object-safe; `Display`, `Iterator` (mostly), and `Draw { fn draw(&self); }` are. A staff engineer designing a trait that *must* support `dyn` (plugin systems, heterogeneous collections) keeps it object-safe deliberately — and knows that a single `Self`-returning method forecloses that option permanently.

### 3. SFINAE: bounds without declarations (the bad old C++ way)

Before C++20, templates had **no way to declare a bound**. `template<class T> T max(T a, T b){ return a < b ? b : a; }` simply *assumed* `T` had `<`. If you instantiated it with a type lacking `<`, the error surfaced *deep inside the instantiation* — not at the call site — and dumped every candidate, every nested template, every overload considered. A missing `operator<` could produce hundreds of lines mentioning types you've never heard of.

To *emulate* bounds, library authors used **SFINAE** ("Substitution Failure Is Not An Error"): write overloads whose signatures are only valid when the type has the required operations, relying on the rule that an *ill-formed substitution* removes a candidate rather than erroring. The canonical tool was `std::enable_if`:

```cpp
template <class T,
          typename = std::enable_if_t<std::is_integral_v<T>>>   // bound, smuggled in
T half(T x) { return x / 2; }
```

This *worked* but was write-only: the constraint was buried in template metaprogramming, the diagnostics when it *failed* were still catastrophic, and expressing "has a `.size()` method" required detection idioms (`void_t`, expression SFINAE) that read like cryptography. SFINAE is bounded polymorphism with the bound *implicit and undiagnosable* — the worst of both worlds.

### 4. C++20 concepts: declared bounds, sane errors

**Concepts** finally give C++ *declared, named, checkable* bounds — exactly what `T: Ord` always was elsewhere:

```cpp
#include <concepts>

template <class T>
concept Sortable = std::totally_ordered<T> && requires(T a, T b) {
    { a < b } -> std::convertible_to<bool>;
};

template <Sortable T>                 // the bound, named and up front
T max_of(T a, T b) { return a < b ? b : a; }
```

What changes in practice:

- **Diagnostics collapse** from a wall of instantiation noise to *"constraint `Sortable<Widget>` not satisfied: `Widget` has no `operator<`"* — at the *call site*. This alone has measurably cut C++ debugging time.
- **Overload resolution improves** via **subsumption**: when several constrained overloads match, the compiler prefers the *more constrained* one, replacing fragile SFINAE-ordering tricks.
- **Contracts become readable**: a concept *documents* what a template needs, so the bound is part of the API, not buried in `enable_if`.

Concepts are *structural* (a type satisfies `Sortable` by *having* the operations, no declaration needed) — unlike Rust traits (nominal, you must `impl`). That keeps C++'s duck-typed template flavor while adding the missing declared-bound and diagnostic layer. The migration story for a large codebase: replace `enable_if` SFINAE with concepts incrementally; the payoff is error-message quality and overload clarity.

### 5. Designing bound hierarchies for an ecosystem

When your trait/typeclass is depended on by *other people's code*, design shifts from "does it compile" to "can it evolve and compose":

- **Granularity.** One fat trait (`trait Db { connect; query; migrate; backup; }`) forces every implementer to provide everything and every consumer to depend on everything. Many small traits (`Connect`, `Query`, `Migrate`) let consumers bound by exactly what they use and let implementers opt in. Prefer *fine-grained capability traits* with supertrait relationships over monoliths.
- **Default methods as evolution insurance.** Adding a method with a default to a published trait is (usually) non-breaking — existing impls inherit it. Adding a method *without* a default breaks every downstream impl. So: ship the minimal required surface, grow via defaulted methods.
- **Supertrait additions are breaking.** Tightening `trait Foo` to `trait Foo: Bar` requires every `Foo` implementer to now also implement `Bar` — a breaking change. Plan the hierarchy up front; loosening is fine, tightening is not.
- **Sealed traits to control the implementer set.** If you must be able to add methods freely later (or pattern-match exhaustively), *seal* the trait so only you can implement it. You trade extensibility for evolvability — a deliberate choice (e.g. `error` enums, protocol state machines).
- **Coherence shapes packaging.** Because of orphan rules, decide *who* ships the instance for popular foreign types. The idiomatic answer: the crate that *owns the trait* provides feature-gated impls for well-known external types, so downstream users don't need orphans.

### 6. API evolution under coherence: the breaking-change taxonomy

For a published trait `C`, classify each change:

| Change | Breaking? | Why |
|---|---|---|
| Add a method **with** a default | Usually no | Existing impls inherit it. |
| Add a method **without** a default | **Yes** | Every impl must now provide it. |
| Add a **supertrait** (`C: D`) | **Yes** | Every `C` impl must now also be a `D` impl. |
| Add a **new instance** for a type you own | No (but watch overlap) | New capability, no existing code changes — unless it overlaps. |
| Add a **blanket impl** (`impl C for all T: D`) | **Yes, often** | Can collide with existing/ downstream impls; coherence rejects overlaps. |
| Add an **associated type** | **Yes** | Impls must specify it (unless defaulted, where supported). |
| Loosen a bound on a function | No | Accepts strictly more types. |
| Tighten a bound on a function | **Yes** | Rejects previously-accepted callers. |

The staff takeaway: **a trait's required surface and its supertrait set are nearly frozen the moment you publish.** Everything growable should be defaulted; everything mandatory should be right the first time. Blanket impls are powerful and *especially* dangerous to add later because of overlap with downstream impls you can't see.

### 7. Choosing the mechanism: a decision framework

Given "this code needs capability `K` on type `T`," choose:

- **Static bounded generic (monomorphized trait/typeclass/concept)** — default for hot paths, small functions, few concrete types, and where you want maximum inlining. Best diagnostics in Rust/Haskell; in C++ use a *concept*, not SFINAE.
- **Dynamic dispatch (`dyn Trait` / interface / existential)** — for heterogeneous collections (`Vec<Box<dyn Draw>>`), plugin boundaries, large generic bodies you don't want duplicated, and ABI-stable boundaries. Requires object safety.
- **Subtype bound (Java/C#/Swift interface/protocol)** — when you're in an OO ecosystem, need runtime polymorphism by default, and don't need to retrofit foreign types.
- **`impl Trait` / `some`/`any` (existential return/param)** — to hide a concrete type behind a bound at an API boundary without committing callers to monomorphization choices.
- **Explicit operation argument (comparator/closure)** — when you need *per-call* behavior or multiple behaviors for one type, where coherence would otherwise force a newtype.

The mechanisms aren't mutually exclusive: large systems route the *common, hot* case through static bounds and the *heterogeneous, cold, or boundary* case through dynamic dispatch, sometimes behind the same trait.

---

## Real-World Analogies

| Concept | Real-world thing |
|---------|------------------|
| **Monomorphization** | Pre-printing a custom manual for every appliance model — instant to use, but a warehouse full of manuals. |
| **Dynamic dispatch** | One generic manual plus a per-appliance lookup card — compact, but you flip to the card every step. |
| **Object safety** | A rule that only appliances with a *standard* plug fit the universal socket; a hardwired unit (returns `Self`) can't. |
| **SFINAE errors** | A compliance failure reported as a 300-page audit dump instead of "missing signature on page 1." |
| **C++20 concepts** | The same audit, now reported as one line: "Form 7 (Sortable) not satisfied." |
| **Sealed trait** | A membership club where only the founder can admit new members — so the founder can change the rules safely. |
| **Default method as evolution insurance** | Shipping a contract amendment that auto-applies to existing signatories rather than requiring everyone to re-sign. |
| **Adding a supertrait (breaking)** | Retroactively requiring every existing licensee to *also* hold a second license. |

---

## Mental Models

### The "one copy or N copies" model

Every time you reach for a bound, ask: *will this become one copy (dynamic) or N copies (mono)?* That single question predicts binary size, compile time, inlining, and whether heterogeneous storage is possible. Hot + small + few types → N copies pays off. Cold + large + many types → one copy wins. When the answer is "both, at different points," design the trait to support both (keep it object-safe) and route per call site.

### The "bound is a frozen contract" model

Treat a *published* trait's required-method set and supertrait set as **immutable** the moment a second team depends on it. Everything you might want to add later must be expressible as a *defaulted* method or a *separate* trait. Design as if you can never tighten — because in a live ecosystem, you effectively can't without a major version and an ecosystem-wide migration. This reframes trait design from "what do I need now" to "what will I need to add without breaking anyone."

### The "diagnostics are part of the bound" model

A bound's *error message* is part of its API. SFINAE bounds technically work but fail unreadably, costing every user hours. A named concept/trait fails with one line. When you write a constraint, imagine the message a downstream engineer sees when their type *doesn't* satisfy it — and choose the mechanism (named concept over `enable_if`, a trait alias over a sprawling `where` clause) that makes that message clear. Good bounds are *legible in failure*, not just in success.

---

## Code Examples

### Static vs dynamic, same trait (Rust)

```rust
trait Draw { fn draw(&self) -> String; }   // object-safe: no Self return, no generics

// STATIC: monomorphized — one copy per T, fully inlinable, no indirection.
fn render_static<T: Draw>(item: &T) -> String { item.draw() }

// DYNAMIC: one copy, vtable hop — enables heterogeneous storage.
fn render_dyn(item: &dyn Draw) -> String { item.draw() }

fn render_all(items: &[Box<dyn Draw>]) -> Vec<String> {   // heterogeneous: needs dyn
    items.iter().map(|i| i.draw()).collect()
}
```

`render_all` *cannot* be written with a single static `T` — the elements are different types. Dynamic dispatch is not a fallback here; it's the only option.

### Object-unsafe trait forecloses `dyn`

```rust
trait Cloneable { fn clone_box(&self) -> Self; }   // returns Self by value
// fn f(x: &dyn Cloneable)   // ERROR: `Cloneable` is not object-safe
// Fix idiom: trait CloneBox { fn clone_box(&self) -> Box<dyn CloneBox>; }
```

The `-> Self` makes it impossible to store in a vtable. A staff engineer who wants `dyn` support designs around this from the start.

### SFINAE (pre-concepts) vs concept (C++20)

```cpp
// PRE-C++20: bound smuggled via enable_if; failure = instantiation-deep error dump.
template <class T, std::enable_if_t<std::is_arithmetic_v<T>, int> = 0>
T twice(T x) { return x + x; }

// C++20: declared concept; failure = one readable line at the call site.
template <class T>
concept Arithmetic = std::is_arithmetic_v<T>;

template <Arithmetic T>
T twice2(T x) { return x + x; }

// twice2(std::string{"x"});
//   -> "constraint 'Arithmetic<std::string>' was not satisfied"  (clear!)
```

### A concept with a `requires` expression (structural bound)

```cpp
template <class T>
concept HasSize = requires(const T& t) {
    { t.size() } -> std::convertible_to<std::size_t>;   // "must have a .size() returning size-like"
};

template <HasSize C>
bool nonEmpty(const C& c) { return c.size() > 0; }
// Works structurally for std::vector, std::string, your own type with .size() — no inheritance.
```

### Ecosystem-friendly trait design (Rust)

```rust
// Fine-grained capability + defaulted growth method = evolvable.
trait Encoder {
    fn encode(&self, out: &mut Vec<u8>);          // required, minimal
    fn encoded_len(&self) -> usize {              // defaulted: added later, non-breaking
        let mut buf = Vec::new();
        self.encode(&mut buf);
        buf.len()
    }
}
```

### Existential at the boundary (`impl Trait`)

```rust
// Caller gets "some Iterator of u32" without the concrete type leaking,
// and without forcing a dyn allocation.
fn evens(n: u32) -> impl Iterator<Item = u32> {
    (0..n).filter(|x| x % 2 == 0)
}
```

---

## Pros & Cons

| Aspect | Pros | Cons |
|--------|------|------|
| **Monomorphization** | Fastest dispatch, full inlining, zero-cost abstraction. | Code bloat, slow/large builds, i-cache pressure for many hot copies. |
| **Dynamic dispatch** | One copy, small binaries, heterogeneous storage, ABI-friendly. | Indirection per call, boxing, requires object safety. |
| **C++20 concepts** | Readable diagnostics, subsumption-based overloads, bounds as documentation. | Migration effort from SFINAE; structural (no nominal guarantee); concept design has its own subtleties. |
| **SFINAE (legacy)** | Universally available pre-C++20; very flexible detection. | Write-only, catastrophic errors, fragile overload ordering. |
| **Fine-grained trait hierarchies** | Consumers bound by exactly what they use; evolvable. | More traits to learn; supertrait planning required up front. |
| **Sealed traits** | Free evolution + exhaustive matching for the owner. | Closed to third-party extension; a deliberate loss. |

---

## Use Cases

- **High-performance generic algorithms** (sorting, numeric kernels, parsers) — monomorphized bounded generics for zero-cost dispatch.
- **Plugin / heterogeneous systems** (renderers, middleware chains, codecs) — object-safe traits + `dyn`/interfaces for one copy and mixed storage.
- **Large C++ template libraries** — concepts to replace SFINAE, fixing error ergonomics and overload resolution (the STL's `ranges` is built on concepts).
- **Foundational ecosystem traits** (`serde`'s `Serialize`, `std`'s `Iterator`, a company-wide `Metric`/`Codec` trait) — fine-grained, defaulted, carefully evolved under coherence.
- **ABI-stable boundaries** (dynamic libraries, plugin ABIs) — dynamic dispatch because monomorphization can't cross a stable ABI.
- **API boundaries hiding concrete types** — `impl Trait`/existentials to expose a capability without leaking implementation.

---

## Coding Patterns

### Pattern 1: Static fast path + `dyn` slow/heterogeneous path

```rust
fn handle<T: Handler>(req: &Req, h: &T) { h.handle(req); }        // hot, monomorphized
fn dispatch(req: &Req, h: &dyn Handler) { h.handle(req); }        // heterogeneous registry
```

Expose both; let the call site pick. Keep the trait object-safe so the `dyn` path is even possible.

### Pattern 2: Minimal required surface + defaulted extensions

Publish a trait with the *smallest* set of required methods; grow it only via defaulted methods so existing impls never break. This is your single most important evolution lever.

### Pattern 3: Prefer concepts over `enable_if` in modern C++

```cpp
template <std::integral T> T f(T);          // not: template<class T, enable_if_t<is_integral...>>
```

Named concepts as the *only* sanctioned way to constrain new templates — better errors, better overloads, self-documenting.

### Pattern 4: Trait aliases / bundled bounds for repeated constraint sets

When the same `T: A + B + C` recurs, bundle it (`trait Abc: A + B + C {}` + blanket impl in Rust; a `concept` in C++; a `type` alias for constraints in Haskell). DRY the bound and improve the failure message.

### Pattern 5: Seal traits you must evolve aggressively

If a trait is an internal extension point you need to keep changing, seal it (private supertrait marker) so only you implement it — then add methods freely.

### Pattern 6: Box the heterogeneous, monomorphize the homogeneous

`Vec<Box<dyn Trait>>` for mixed types; `Vec<T>` with a bounded function for one type. Don't pay `dyn` costs for homogeneous data, and don't try to force a single `T` over heterogeneous data.

---

## Best Practices

- **Choose dispatch per API consciously.** Document why a given generic is monomorphized vs `dyn`. Default to static for hot/small/few-typed, dynamic for cold/large/heterogeneous.
- **Keep traits object-safe unless you have a reason not to.** Object safety preserves the `dyn` option; a single `Self`-returning method throws it away forever. If you need both, split the `Self`-returning part into a separate trait.
- **Treat published required-surface and supertrait set as frozen.** Grow via defaults and new traits; never plan to tighten.
- **In C++, write concepts, never new SFINAE.** Migrate `enable_if` to concepts where touched; the diagnostic payoff is enormous.
- **Design bounds for legible failure.** Name your constraints; bundle repeated bound sets; imagine the error a downstream engineer sees.
- **Watch monomorphization bloat in widely-instantiated generics.** Measure binary size and compile time; consider a `dyn` inner core with a thin monomorphized outer shell (the "outline the cold path" technique) for huge generic bodies.
- **Provide instances for popular foreign types from the trait-owning crate** (feature-gated) so users never need orphans.
- **Reserve specialization/overlapping/blanket-impl additions for designed-in cases.** Adding a blanket impl post-publication is among the most coherence-dangerous changes you can make.

### "Outline the cold path" — taming bloat

```rust
// Thin monomorphized shell forwards to one shared non-generic body → less duplicated code.
fn parse<R: std::io::Read>(mut r: R) -> Result<Vec<u8>, std::io::Error> {
    let mut buf = Vec::new();
    r.read_to_end(&mut buf)?;
    parse_bytes(&buf)            // the heavy logic is NON-generic, compiled once
}
fn parse_bytes(_b: &[u8]) -> Result<Vec<u8>, std::io::Error> { /* big, shared */ Ok(vec![]) }
```

---

## Edge Cases & Pitfalls

- **A single object-unsafe method poisons the whole trait for `dyn`.** Adding `fn clone(&self) -> Self` to a trait silently removes the ability to use it as a trait object — a surprising, far-reaching consequence.
- **Monomorphization explosion.** A generic instantiated over hundreds of types (or recursively, like deeply nested combinators) can dominate compile time and binary size; profile with size/compile-time tooling, not intuition.
- **Adding a non-defaulted method or a supertrait silently breaks every downstream impl.** This is the #1 accidental breaking change in trait ecosystems.
- **Blanket-impl overlap.** Adding `impl C for all T: D` after publication can collide with downstream `impl C for SpecificType` — a hard, ecosystem-wide coherence conflict you can't see at design time.
- **C++ concept *subsumption* is partial-order, not total.** Two unrelated concepts both matching can be *ambiguous*; subsumption only disambiguates when one concept's requirements strictly imply the other's. Misdesigned concepts give "ambiguous overload" instead of the hoped-for resolution.
- **Concepts are structural, so unintended types may satisfy them.** A concept "has `.size()`" matches anything with a `.size()`, including types you never meant — the dual of Rust traits' nominal safety. Add semantic checks where it matters.
- **`dyn` boxing in hot loops.** A `Vec<Box<dyn Trait>>` iterated millions of times pays an allocation + an indirect call per element; if it's hot and homogeneous, you wanted monomorphization.
- **Cross-ABI monomorphization is impossible.** You cannot monomorphize across a stable dynamic-library boundary; such boundaries force dynamic dispatch (or a C-style erased interface).
- **`impl Trait` in return position pins one concrete type.** `-> impl Iterator` means *all* return paths must yield the *same* concrete type; branches returning different iterators won't compile (use `Box<dyn>` then).
- **Default-method changes can alter behavior silently.** Changing a defaulted method's body affects every impl that didn't override it — a subtle behavioral (not compile) break.

---

## Test Yourself

1. Given a trait used in (a) a hot 4-type sort and (b) a heterogeneous plugin registry, decide static vs dynamic dispatch for each and justify with the cost model. Could one trait serve both? What must be true of it?
2. Take an object-*unsafe* trait and refactor it to be object-safe without losing functionality. What did you move, and why does the vtable now accept it?
3. Convert a real `std::enable_if` SFINAE constraint to a C++20 concept. Compare the error message when you pass a non-conforming type. Quantify the difference in lines.
4. For a published trait, classify five proposed changes (add defaulted method, add required method, add supertrait, add blanket impl, loosen a function bound) as breaking or not, and explain each via coherence/impl obligations.
5. A teammate adds `impl Serialize for Vec<T> where T: Serialize` (a blanket impl) to a shared crate and downstream builds break. Diagnose the coherence conflict and propose a fix.
6. Demonstrate monomorphization bloat: instantiate a nontrivial generic over 20 types, measure binary size, then apply the "outline the cold path" refactor and measure again.
7. Explain why `-> impl Trait` can't be used for a function that returns one of two different iterator types in different branches, and give the two idiomatic fixes.

---

## Cheat Sheet

```text
┌──────────────────────────────────────────────────────────────────┐
│            BOUNDED POLYMORPHISM (Professional)                    │
├──────────────────────────────────────────────────────────────────┤
│ DISPATCH COST MODEL:                                             │
│   MONO (static): N copies, inline, fastest | bloat, slow builds  │
│     -> hot, small, few types                                     │
│   DYN (vtable): 1 copy, indirection       | smaller, heterogen.  │
│     -> cold, large body, mixed types; needs OBJECT SAFETY        │
├──────────────────────────────────────────────────────────────────┤
│ OBJECT SAFETY (to allow dyn): no Self-by-value return,           │
│   no generic methods. One bad method poisons the whole trait.    │
├──────────────────────────────────────────────────────────────────┤
│ C++:  SFINAE (enable_if) = implicit bound, error-dump hell       │
│       CONCEPTS (C++20)  = declared bound, 1-line error,          │
│                            subsumption-based overloads           │
│       -> write concepts, never new SFINAE                        │
├──────────────────────────────────────────────────────────────────┤
│ TRAIT EVOLUTION (published = frozen-ish):                        │
│   +defaulted method ...... usually OK                            │
│   +required method ....... BREAKS impls                          │
│   +supertrait ............ BREAKS impls                          │
│   +blanket impl .......... BREAKS (overlap)                      │
│   loosen fn bound ........ OK | tighten ...... BREAKS callers    │
│   -> grow via defaults & new traits; never tighten               │
├──────────────────────────────────────────────────────────────────┤
│ MECHANISM PICKER: static bound (hot) | dyn (heterogeneous/ABI)   │
│   | subtype iface (OO) | impl Trait (hide type) | explicit fn arg│
├──────────────────────────────────────────────────────────────────┤
│ Bloat fix: "outline the cold path" — generic shell, shared body  │
│ Orphan-free ecosystems: trait-owner ships foreign-type impls     │
└──────────────────────────────────────────────────────────────────┘
```

---

## Summary

- The defining professional decision is **monomorphization vs dynamic dispatch**: N specialized copies (fast, inlinable, but bloat + slow builds) vs one copy behind a witness table (small, heterogeneous, but an indirection and **object-safety** requirement). Monomorphize hot/small/few-typed; dynamically dispatch cold/large/heterogeneous; mix both behind one (object-safe) trait when needed.
- A single **object-unsafe** method (`-> Self`, generic method) forecloses `dyn` for the whole trait — a far-reaching design consequence.
- C++'s evolution from **SFINAE** (implicit, undiagnosable bounds, error-dump hell) to **C++20 concepts** (declared, named, one-line errors, subsumption-based overloads) is bounded polymorphism finally arriving in C++ — write concepts, retire SFINAE.
- A **published trait's required surface and supertrait set are effectively frozen**: grow only via *defaulted* methods and *new* traits; required methods, supertraits, blanket impls, and bound-tightening are breaking changes. Plan hierarchies up front; design for legible failure.
- **Coherence** turns API evolution into a discipline (the breaking-change taxonomy), and orphan rules push trait owners to ship foreign-type instances so users avoid orphans.
- **Mechanism choice** is per-constraint: static bound, `dyn`, subtype interface, `impl Trait`/existential, or an explicit operation argument — chosen by hotness, heterogeneity, ABI, and who owns the types.
- **Bloat** is real; the "outline the cold path" technique (thin monomorphized shell, shared non-generic body) tames it.

---

## What You Can Build

- **A dispatch-cost benchmark harness** comparing a monomorphized bounded generic against `dyn`/interface dispatch across type counts, reporting binary size, compile time, and per-call latency — the data behind the static-vs-dynamic decision.
- **A SFINAE-to-concepts migration of a small C++ template library**, with before/after error-message screenshots and a line-count of the diagnostic improvement.
- **An object-safety linter/checklist** that flags trait methods that would foreclose `dyn`, plus refactorings to restore object safety.
- **A trait-evolution simulator**: a published trait + several downstream impls, then apply each change from the breaking-change taxonomy and observe what recompiles or breaks.
- **A "bloat budget" tool** that measures monomorphization cost per generic in a real codebase and suggests cold-path outlining candidates.
- **An ecosystem-friendly foundational trait** (e.g. a `Codec` or `Metric`) designed with fine-grained capabilities, defaulted growth methods, feature-gated foreign-type instances, and documented dispatch guidance — shipped as a small library.

---

## Further Reading

- *C++20 Concepts* — the standard's `[concepts]` clause and Bjarne Stroustrup / Gabriel Dos Reis / Andrew Sutton's concepts papers. The definitive source.
- *A Tour of C++* (2nd/3rd ed.) — Stroustrup. Practical concepts and the `ranges` library built on them.
- *The Rust Performance Book* and *Rust API Guidelines* — monomorphization cost, object safety, and trait-design-for-evolution guidance. https://rust-lang.github.io/api-guidelines/
- *Rust RFCs* on object safety, `dyn`, `impl Trait`, and specialization — the engineering rationale in primary form.
- *Generic Programming and the STL* — Austern. The template-programming tradition concepts formalize.
- *Effective Modern C++* — Scott Meyers. Template and type-deduction subtleties that motivate concepts.
- *Haskell type-class evolution writings* (GHC proposals on `DerivingVia`, `QuantifiedConstraints`) — ecosystem-scale typeclass design and evolution.
- *"Zero-cost abstractions"* talks (Bjarne Stroustrup; the Rust project) — the philosophy behind monomorphized bounds.
- The `serde` and `ranges` codebases — real, large-scale bounded-polymorphism API design under coherence and evolution pressure.
