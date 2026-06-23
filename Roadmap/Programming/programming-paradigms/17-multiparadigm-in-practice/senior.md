# Multiparadigm in Practice — Senior Level

> **Roadmap:** [Programming Paradigms](../README.md) → Multiparadigm in Practice
> *Middle learned the standard blends; senior learns the **judgement** — choosing a paradigm by the local shape, recognizing the half-OO-half-functional mud that costs you, treating paradigm boundaries as seams, and keeping each module coherent. Plus the two languages that model multiparadigm done right: Rust and Scala.*

---

## Table of Contents

1. [Introduction](#introduction)
2. [Choosing a Paradigm by Problem Shape — Inside One Codebase](#choosing-a-paradigm-by-problem-shape--inside-one-codebase)
3. [The Cost of Mixing Badly](#the-cost-of-mixing-badly)
4. [Paradigm Boundaries Are Seams](#paradigm-boundaries-are-seams)
5. [Keeping Each Module Coherent](#keeping-each-module-coherent)
6. [Least Power, Per Layer](#least-power-per-layer)
7. [Deep Dive — Rust as a Multiparadigm Language](#deep-dive--rust-as-a-multiparadigm-language)
8. [Deep Dive — Scala and the OO/FP Fusion](#deep-dive--scala-and-the-oofp-fusion)
9. [Code-Review Heuristics & Team Conventions](#code-review-heuristics--team-conventions)
10. [Common Mistakes](#common-mistakes)
11. [Test Yourself](#test-yourself)
12. [Cheat Sheet](#cheat-sheet)
13. [Summary](#summary)
14. [Further Reading](#further-reading)
15. [Related Topics](#related-topics)

---

## Introduction

> Focus: **judgement — choosing, bounding, and policing the paradigm mix in a real codebase.** Not "what blends exist" (that was middle), but "given *this* module, which paradigm, where's the seam, and how do I stop the mix from rotting into mud?"

The middle level handed you a catalog of blends — functional core / imperative shell, declarative-inside-imperative, paradigm-per-layer. A catalog is necessary but not sufficient. The senior reality is that **knowing the blends doesn't tell you when each is right, and a mix applied without judgement degrades into something worse than any single paradigm would have been.** The most common failure in a multiparadigm codebase isn't choosing the wrong paradigm — it's *blending them incoherently*: a function that's half object-oriented and half functional, a `map` that mutates, a "domain object" that's secretly a procedural script. That mud is the signature cost of multiparadigm freedom used carelessly.

So the senior skill has three parts. First, **choose by shape** — the same skill [01 → senior](../01-overview-and-taxonomy/senior.md) taught for whole systems, now applied *region by region* inside one codebase. Second, **treat every paradigm change as a seam** — a deliberate, visible boundary where one paradigm's guarantees end and another's begin — and refuse to mix paradigms *within* a unit. Third, **keep each module coherent** so a reader knows, on entering it, which rules apply. And running underneath all three: **least power per layer** — reach for the weakest paradigm that fits each region.

The two deep dives — **Rust** and **Scala** — are here because they're the languages that make multiparadigm *coherent* rather than chaotic. Rust fuses ownership, traits/generics, functional iterators, imperative control, and a touch of declarative macros, and the borrow checker keeps the mix honest. Scala fuses OO and FP so completely that the boundary between an object and a function nearly disappears. Studying how *they* keep the seams clean is how you learn to keep yours clean in any language.

> **The senior mindset shift:** the junior mixes paradigms by habit, the middle mixes them by pattern, and the senior mixes them *by judgement* — choosing per shape, fencing every seam, and protecting each module's coherence so the freedom of multiparadigm doesn't curdle into mud.

---

## Choosing a Paradigm by Problem Shape — Inside One Codebase

[01 → senior](../01-overview-and-taxonomy/senior.md) taught the master skill: read a problem's *shape* before choosing a paradigm. At the system level you choose per service; at *this* level you make the same call **per module, per function, sometimes per block** — because inside one codebase the shapes change every few hundred lines.

Recall the shape→paradigm map, now read as a within-codebase routine:

| Local shape | Tell-tale sign | Reach for | Where it lives in a codebase |
|---|---|---|---|
| Transformation pipeline | data in → stages → data out, no shared state | Functional | the core, reporting, ETL, request mapping |
| Entity with identity & lifecycle | a noun with state, invariants, rules over time | Object-oriented | the domain model, aggregates, services |
| "Which records match…" | aggregate/filter over a dataset | Declarative (SQL) | the data-access boundary |
| Steps with effects | read, write, call, in order | Imperative | the shell, I/O adapters, orchestration |
| Hot numeric loop | tight budget, cache-bound | Imperative / data-oriented | one proven-hot region (see [10](../10-data-oriented-programming/)) |
| Independent units + messages | concurrency, fault isolation | Actor / CSP | the concurrency layer (see [07](../07-actor-model-and-csp/)) |
| State that changes & propagates | derived values must stay consistent | Reactive | the UI / live-update layer (see [05](../05-reactive-programming/)) |

The senior move is to **stop at every region boundary and re-read the shape.** A single request handler might cross four shapes: parse input (imperative shell) → load entities (OO + SQL) → compute the decision (functional core) → emit events (event-driven). Each region gets the paradigm its shape wants, not the paradigm the file started in.

```rust
// One function, three local shapes, three paradigms — chosen deliberately.
fn settle(order_id: OrderId, repo: &Repo, bus: &EventBus) -> Result<Receipt, Error> {
    let order = repo.load(order_id)?;                 // OO/imperative: effect + entity

    let receipt = compute_receipt(&order);            // ← FUNCTIONAL core (pure, below)

    bus.publish(Event::Settled(order_id));            // event-driven: fire-and-forget effect
    Ok(receipt)
}

// Pure functional region: a transformation pipeline. No I/O, no mutation.
fn compute_receipt(order: &Order) -> Receipt {
    let subtotal: Money = order.lines.iter()          // functional pipeline
        .map(|l| l.price * l.qty)
        .sum();
    Receipt { subtotal, tax: subtotal * order.region.tax_rate() }
}
```

> **The within-codebase rule:** the right paradigm isn't a property of the *project* or even the *file* — it's a property of the *region's shape*. Re-read the shape at every boundary and let the paradigm follow it.

---

## The Cost of Mixing Badly

Multiparadigm freedom has a dark side the middle level only hinted at: a mix applied without discipline produces code that's *worse* than committing to any single paradigm. Naming these failure modes is how you catch them in review.

**Half-OO-half-functional mud.** The classic rot: a class that's neither a real object nor a clean transformation. It has mutable fields *and* methods that return new values, so callers can't tell whether calling a method mutates the object or produces a copy. Sometimes it does both.

```python
# MUD: is this object stateful (OO) or a value transformer (FP)? It's both, confusingly.
class Report:
    def __init__(self, rows): self.rows = rows
    def filtered(self, pred):
        self.rows = [r for r in self.rows if pred(r)]   # MUTATES self... 
        return self                                      # ...AND returns self for chaining
# r.filtered(a).filtered(b)  — looks functional (chained), but each call mutates r.
# Aliased? Every holder of `r` sees the filtering. Neither paradigm's guarantees hold.
```

The reader can't reason about it: the chaining *signals* FP (immutable, no aliasing surprises), but the mutation *delivers* OO state with aliasing hazards. Either make it a true value type (return a *new* `Report`, mutate nothing) or a true stateful object (mutate, return `None`, no chaining). The hybrid is the worst option.

**Mutation inside a `map`.** The single most common bad mix — a transform that's secretly an effect:

```python
seen = set()
names = [register(u) or u.name for u in users if seen.add(u.id) is None]  # don't
```

It *looks* like a pure pipeline, so a reader assumes it's reorderable, parallelizable, and side-effect-free. It is none of those. The cost isn't aesthetic: someone will later parallelize it (a `map` *should* be safe to parallelize) and introduce a race, or reorder it and break the dedup. **A paradigm's value is the set of assumptions it lets a reader make; a bad mix lies about which assumptions hold.**

**Effects smuggled into the functional core.** A "pure" core function that logs, reads the clock, or hits a cache *looks* testable but isn't deterministic — you've paid the cost of the functional-core blend (discipline, indirection) and gotten none of the benefit (isolation, reproducibility).

The unifying cost: **bad mixing destroys *local reasoning*.** The entire economic point of choosing a paradigm for a region is that a reader entering the region knows what's true — pure means no effects, OO means state changes only through methods, declarative means no hidden control flow. Mix paradigms *within* a unit and the reader can rely on *nothing*, which is strictly worse than the most verbose single-paradigm version. (This is [01 → senior](../01-overview-and-taxonomy/senior.md)'s seam rule, seen from the cost side.)

---

## Paradigm Boundaries Are Seams

The cure for bad mixing is to treat every paradigm change as a **seam** — a deliberate, named, visible boundary, never an accident in the middle of an expression. A seam is where one paradigm's guarantees end and the next paradigm's begin, and good multiparadigm code makes those boundaries *obvious*.

What makes a good paradigm seam:

- **It coincides with an existing structural boundary** — a function signature, a module's public API, a class boundary, a layer interface. You don't invent a new kind of boundary; you align the paradigm change with one the language already enforces. The function call from imperative shell into functional core *is* the seam.
- **It's typed or named, not implicit.** `compute_receipt(order: &Order) -> Receipt` announces "pure transformation: data in, data out." A repository interface announces "OO/declarative data access lives behind here." The signature tells the reader which paradigm they're crossing into.
- **It's one-directional in effects.** Effects flow *outward* toward the shell; purity is preserved *inward* toward the core. The seam enforces that direction — the core can't reach out and do I/O, because it was never handed the I/O capabilities (no `db`, no `clock`, no `bus` parameter).
- **It's where data changes *representation*, too.** Crossing from the OO domain into the SQL boundary, entities become rows; crossing from the declarative config into the running system, data becomes behavior. The seam is a translation point, and naming it makes the translation auditable.

```scala
// The seam is the trait boundary: above it, OO service; below it, the paradigm changes.
trait OrderRepository:                      // SEAM: an OO/declarative data boundary
  def load(id: OrderId): IO[Order]          // effects fenced behind IO (FP effect type)

class OrderService(repo: OrderRepository):  // OO: an entity with a dependency
  def settle(id: OrderId): IO[Receipt] =
    for                                       // FP: composing effects via for-comprehension
      order   <- repo.load(id)                // cross the seam into the data layer
      receipt =  computeReceipt(order)        // PURE region (no IO type → no effects)
      _       <- audit.record(receipt)        // cross another seam: back to effects
    yield receipt

  // PURE seam: signature has no IO, so the type system PROVES no effects here.
  def computeReceipt(order: Order): Receipt = ...
```

Notice how the *type* marks the seam: `IO[_]` means "effects beyond this point," its absence means "pure." Scala (and Haskell, and Rust's ownership) turn the paradigm seam into something the *compiler* checks — the ideal a senior aims for even in languages where it's only a convention.

> **The seam principle:** make every paradigm change coincide with a structural boundary, mark it in the signature/type, and keep effects flowing one way across it. A paradigm boundary you can't *point to* is a bad mix waiting to happen.

---

## Keeping Each Module Coherent

Seams bound the *transitions* between paradigms; coherence governs what happens *inside* a region. A coherent module is one where, having crossed into it, a reader can hold a single set of assumptions for its whole extent.

What module coherence demands:

- **One dominant paradigm per module, deviations fenced.** The domain module is OO; the transforms module is functional; the I/O adapter is imperative. A module that's 60% OO and 40% functional with no internal boundary forces the reader to re-derive the rules paragraph by paragraph. If a module *needs* two paradigms, it needs an *internal seam* (a private pure function, a nested helper) that makes the switch explicit.
- **Consistent idiom, not just consistent paradigm.** Two functional modules that disagree on error handling — one throws, one returns `Result`, one returns `Option` and logs — are incoherent even though both are "functional." Coherence is at the idiom level: *how* this codebase does the paradigm, picked once.
- **Effects visible at the module edge.** A coherent module's *signature* tells you its paradigm: a pure module exposes pure functions; an effectful module exposes effectful ones and doesn't hide effects inside ostensibly-pure helpers. The reader shouldn't have to read the body to learn whether the module is pure.
- **No paradigm leakage across the API.** An OO module that returns its internal mutable list (letting callers mutate its guts) has leaked its paradigm; a functional module that exposes a mutable builder has too. The public surface should speak one paradigm's contract.

The test of coherence is the **onboarding paragraph** ([01 → senior](../01-overview-and-taxonomy/senior.md)): can you tell a new hire, in two sentences, "this module is functional — pure functions, immutable data, errors as `Result`; that one is OO — entities mutate only through methods, effects return `IO`"? If you can, the module is coherent. If describing it requires "well, mostly functional but these three methods mutate and that one does I/O," it isn't — and that fuzziness is exactly what the next maintainer will trip on.

> **Coherence in one line:** within a module, a reader should need *one* set of assumptions, learnable from the signatures alone — one dominant paradigm, one idiom, effects visible at the edge, no paradigm leaking across the API.

---

## Least Power, Per Layer

The compass for *which* paradigm a layer should default to is the **principle of least power** ([01 → senior](../01-overview-and-taxonomy/senior.md)): reach for the *weakest* paradigm that still expresses the layer cleanly, because less power means more can be analyzed, optimized, and guaranteed.

Applied across a multiparadigm codebase, least power produces a natural ordering — start declarative, escalate only when forced:

1. **Can this layer be plain data (declarative)?** Configuration, routing tables, validation rules, feature flags — express as data first. Validated, diffable, generatable, no arbitrary logic to misbehave. Escalate only if the layer needs real computation.
2. **Can it be pure functions (functional)?** Business rules, transformations, calculations — pure functions next. Testable in isolation, cacheable, parallelizable, referentially transparent. Escalate only if it needs identity or coordinated state.
3. **Does it need entities with state (OO)?** A noun with a lifecycle and invariants enforced over time — *now* OO earns its keep. Escalate only where the shape genuinely has stateful identity.
4. **Does it need effects or fine control (imperative)?** I/O, mutation, hot loops — the most powerful, least analyzable region. Confine it to the shell and the proven-hot paths.

Each step *up* this ladder is power purchased with lost guarantees, so each escalation should be a *deliberate* decision you could defend in review. The anti-pattern is escalating by default — writing a stateful class for what wanted a pure function, a script for what wanted config — which hands away analyzability you didn't need to spend.

This is why a healthy multiparadigm codebase is *declarative at the edges (config, data) and imperative only at its core of effects*, with functional and OO in between — it's least power, layer by layer. The paradigm mix isn't arbitrary; it's the *minimum power gradient* that the system's shapes demand.

> **Least power, per layer:** default each layer to the weakest paradigm that fits — data, then pure functions, then objects, then effects — and treat every escalation up the ladder as a power purchase you must justify.

---

## Deep Dive — Rust as a Multiparadigm Language

Rust is the modern reference for **coherent** multiparadigm design, because it fuses five paradigm flavors *and* gives the compiler the means to keep the mix honest. Studying how Rust holds them together is a masterclass in seams.

The paradigms Rust fuses:

- **Ownership / affine types** — Rust's defining paradigm-flavor: every value has one owner, and the borrow checker tracks moves and borrows at compile time. This isn't a "classic" paradigm from [01](../01-overview-and-taxonomy/), but it's the substrate that makes the others *safe to mix* — it's why a functional iterator and an imperative mutation can't quietly alias.
- **Traits + generics (generic programming)** — behavior is abstracted via traits (like interfaces/typeclasses) and code is parameterized over types with `<T: Trait>` bounds and monomorphized at compile time (see [08 — Generic Programming](../08-generic-programming/)). This is Rust's polymorphism: not class inheritance, but trait bounds.
- **Functional iterators** — `iter().filter(...).map(...).fold(...)` is a lazy, zero-cost functional pipeline; `Option`/`Result` are algebraic data types ([FP → ADTs](../../code-craft/functional-programming/06-algebraic-data-types/junior.md)); `match` is exhaustive pattern matching. Closures are first-class. This is a genuinely functional core.
- **Imperative control** — `let mut`, `for` loops, and in-place mutation are first-class and idiomatic where they fit (a hot loop, a stateful builder). Rust doesn't shame imperative code; it *fences* it with the borrow checker.
- **Declarative macros** — `macro_rules!` and derive macros (`#[derive(Debug, Clone)]`) are a small declarative, code-generating sublanguage. `vec![...]`, `println!`, and serde's `#[derive(Serialize)]` are declarative spliced into imperative code.

```rust
// All five, coherently, in one idiomatic function:
#[derive(Debug, Clone)]                              // DECLARATIVE macro: derive behavior
struct Order { lines: Vec<Line>, region: Region }

// GENERIC over any iterator of Order via trait bounds:
fn total_revenue<I: IntoIterator<Item = Order>>(orders: I) -> Money {
    orders.into_iter()                                // FUNCTIONAL pipeline...
        .filter(|o| o.region.is_active())             // ...lazy, zero-cost
        .map(|o| o.lines.iter().map(|l| l.price * l.qty).sum::<Money>())
        .fold(Money::ZERO, |acc, x| acc + x)          // FUNCTIONAL fold
}

fn drain_queue(q: &mut Vec<Job>) {                    // OWNERSHIP: &mut = exclusive borrow
    while let Some(job) = q.pop() {                   // IMPERATIVE loop + mutation
        process(job);                                 // ...safe: borrow checker proves no alias
    }
}
```

What makes Rust's mix *coherent* rather than muddy: **the type system marks the seams.** `&mut` vs `&` distinguishes "I will mutate" from "I only read" *in the signature* — the half-OO-half-functional mud from earlier is *impossible* because mutation through a shared reference doesn't compile. `Result`/`Option` make effects-of-failure explicit in types. The borrow checker means a functional iterator and an imperative mutation can coexist in one function without the aliasing hazards that make such mixes dangerous in Python or C++. Rust's lesson: **the way to mix paradigms safely is to make the seams checkable** — to push "which paradigm's rules apply here" from convention into the type system.

---

## Deep Dive — Scala and the OO/FP Fusion

Where Rust fuses many flavors under ownership, Scala does something subtler and more radical: it **fuses object-orientation and functional programming so completely that the distinction nearly dissolves.** Scala's design thesis (Odersky) is that OO and FP aren't opposites to be balanced but two facets of one unified model.

How the fusion works:

- **Everything is an object, including functions.** A function value in Scala is an object with an `apply` method (`Function1[A, B]`). So "pass a function" and "pass an object" are *the same act* — the OO/FP boundary that other languages negotiate doesn't exist here. (This is the "closure is a poor man's object, object is a poor man's closure" duality made literal — see [FP → First-Class Functions](../../code-craft/functional-programming/01-first-class-and-higher-order-functions/interview.md).)
- **Traits unify interfaces and mixins.** Scala traits are OO (interfaces with implementations, mixed into classes) *and* the home of FP typeclasses (`Monad`, `Functor` — see [FP → Functors & Applicatives](../../code-craft/functional-programming/13-functors-and-applicatives/junior.md)). One construct serves both paradigms.
- **Case classes are OO syntax for algebraic data types.** `case class` and `sealed trait` give you ADTs and exhaustive pattern matching ([FP → ADTs](../../code-craft/functional-programming/06-algebraic-data-types/junior.md)) — pure FP — expressed in OO class syntax. Immutable by default, `==` by value, ready for `match`.
- **Immutability and effects are library choices, not language walls.** `val` vs `var`, immutable collections by default, and effect types (`IO` from Cats Effect / ZIO) let you write the *same* code OO-heavy or FP-pure, dialing the mix per module.

```scala
sealed trait Shape                                    // ADT (FP) via sealed trait (OO)
case class Circle(r: Double)   extends Shape           // case class = ADT constructor
case class Rect(w: Double, h: Double) extends Shape

object Shape:
  // FP: exhaustive pattern match on the ADT — compiler checks all cases covered.
  def area(s: Shape): Double = s match
    case Circle(r)  => math.Pi * r * r
    case Rect(w, h) => w * h

// OO + FP: a trait that's both an interface and a functional abstraction.
trait Discount:
  def apply(price: Money): Money                       // it's literally a function (FP)
                                                       // AND a named type / interface (OO)
val seasonal: Discount = price => price * 0.9          // a "function object" — both at once
```

The danger Scala famously courts: **because it permits *everything*, a codebase can fracture into incompatible dialects** — "deep FP" Scala (Cats/ZIO, effect types, typeclasses) reads almost like a different language than "Java-with-better-syntax" Scala (mutable, OO, exceptions). This is the *every-paradigm-at-once* failure the professional level warns about, and it's why Scala teams must pick a *house style* and enforce it. Scala's lesson is two-edged: it shows that OO and FP can be one thing rather than two, *and* it shows that a language powerful enough to mix freely makes **team convention the load-bearing discipline** — the language won't keep you coherent, only the team will.

---

## Code-Review Heuristics & Team Conventions

Judgement has to scale past one engineer's head into review and convention, or the codebase fractures. Concrete heuristics a senior applies in review:

- **"Does this `map`/`filter` have side effects?"** A pure-looking pipeline that mutates, logs, or does I/O is the #1 bad mix. Flag it: either make it pure or make it an explicit imperative loop. Never a lying `map`.
- **"Is this object stateful *or* a value — and which does its API claim?"** Methods that both mutate and return `self` are mud. Push toward one: immutable value (return new) or stateful object (mutate, return `None`).
- **"What paradigm is this module, in one phrase?"** If you can't say it ("functional, errors as `Result`" / "OO domain entity"), the module isn't coherent. Ask for an internal seam.
- **"Did effects leak into the core?"** A function named like a pure calculation that takes a `db`/`clock`/`logger` is a smell — effects belong in the shell. Push the I/O up to the caller, pass *data* down.
- **"Is this escalating power unnecessarily?"** A class for what's a pure function; a script for what's config; a `mut` for what could be a fold. Least power: default down, escalate only with a reason.
- **"Does the paradigm change happen at a boundary I can point to?"** A paradigm switch mid-function with no signature/seam is the precursor to mud. Ask for it to land on a function or module boundary.

And the conventions that make these heuristics *enforceable* rather than per-reviewer taste (extending [01 → senior](../01-overview-and-taxonomy/senior.md)'s "standardize per layer"):

- **Written per-layer paradigm defaults** — "domain = OO; transforms = functional with `Result` errors; config = declarative YAML; concurrency = channels." So review compares against a standard, not a mood.
- **Idiom standardization** — one error-handling style, one immutability default (`val`/`final`/`frozen`), one effect-type convention. Coherence is at the idiom level.
- **Lint/compiler enforcement** — immutability by default, a linter flagging mutation in the functional layer, `#[must_use]`/`@CheckReturnValue` so chained "functional" calls can't be silently discarded. Make the right paradigm the path of least resistance.
- **Fenced, justified deviations** — a hot imperative loop inside a functional module is fine *if* it's bounded by a clear function and a comment saying why. Deviation is allowed; *unmarked* deviation isn't.

---

## Common Mistakes

1. **Choosing the file's starting paradigm instead of the region's shape.** Continuing in OO through a transformation pipeline because the file is "an OO file." *Re-read the shape at every region boundary.*
2. **Half-OO-half-functional mud.** A class that mutates *and* returns `self` for chaining; a value type with hidden state. *Commit each unit to one: immutable value, or stateful object — never both.*
3. **The lying `map`.** A functional-looking pipeline that mutates or does I/O. *A paradigm's value is the assumptions it lets readers make; don't lie about which hold.*
4. **Effects in the "pure" core.** A core function that logs, reads a clock, or hits a cache. *All effects in the shell; pass data into the core, not capabilities.*
5. **A paradigm switch with no seam.** Changing paradigm mid-expression instead of at a function/module boundary. *Align every paradigm change with a structural, named, typed boundary.*
6. **Incoherent modules.** A module that's "mostly functional but these methods mutate and that one does I/O." *One dominant paradigm per module; fence deviations behind an internal seam.*
7. **Escalating power by default.** A class for a pure function, a script for config, mutation for a fold. *Least power per layer; default down the ladder, escalate only with cause.*
8. **Relying on the language to keep the mix coherent.** In Scala/Python/C++ the language *permits* mud; only convention prevents it. *Write per-layer defaults, standardize idioms, enforce with lint — don't trust the language.*

---

## Test Yourself

1. You're editing one request handler that parses input, loads an entity, computes a decision, and emits an event. How many paradigms might that be, and where are the seams?
2. Show a piece of "half-OO-half-functional mud" and explain precisely why a reader can't reason about it. How would you fix it in each direction?
3. What makes a paradigm boundary a *good seam*? List four properties.
4. Define module coherence operationally. What's the "onboarding paragraph" test, and what does failing it reveal?
5. Apply least power per layer to: (a) feature flags, (b) a pricing calculation, (c) a connection pool, (d) an image-processing inner loop.
6. Name the five paradigm-flavors Rust fuses. *How* does the type system keep that mix coherent where Python's or C++'s wouldn't?
7. In what sense does Scala make OO and FP "the same thing"? What's the failure mode that same power invites, and what's the only thing that prevents it?
8. Give three code-review heuristics for catching a bad paradigm mix.

<details>
<summary>Answers</summary>

1. Up to four: **imperative shell** (parse input, emit event are effects), **OO + declarative** (load the entity, likely via SQL behind a repository), **functional core** (compute the decision — pure). Seams: the repository interface (into data access), the call into the pure decision function (into the core), and the event publish (back out to effects). Each seam is a function/interface boundary marking where one paradigm's guarantees end.
2. A class with mutable fields whose methods mutate `self` *and* return `self` for chaining (`r.filtered(a).filtered(b)`): the chaining signals FP (immutable, no aliasing surprise) but the mutation delivers OO state (every alias of `r` sees the change), so the reader can't tell whether a call copies or mutates — neither paradigm's assumptions hold. Fix toward FP: return a *new* instance, mutate nothing. Fix toward OO: mutate, return `None`, no chaining.
3. (a) It coincides with a structural boundary (function/module/class/layer API); (b) it's typed or named, not implicit — the signature announces the paradigm crossed into; (c) effects flow one direction across it (outward to the shell, purity inward to the core); (d) it's often a representation-translation point (entities↔rows, config↔behavior), making the translation auditable.
4. A module is coherent if a reader, on entering, needs *one* set of assumptions for its whole extent — one dominant paradigm, one idiom (e.g., one error style), effects visible at the edge, no paradigm leaking across the public API. The onboarding-paragraph test: can you describe the module's paradigm in two sentences to a new hire? Failing it ("mostly functional but these three mutate and that one does I/O") reveals the exact fuzziness the next maintainer will trip on.
5. (a) Feature flags → **declarative data** (validated, versioned, no deploy to change). (b) Pricing calc → **pure function** (testable, cacheable, deterministic). (c) Connection pool → **OO** (an entity with lifecycle: open/close, state, invariants). (d) Image inner loop → **imperative/data-oriented** (the one place you escalate to full power for cache/perf). Default down the ladder; escalate only where the shape forces it.
6. **Ownership/affine types, traits+generics (generic programming), functional iterators (+ ADTs, pattern matching, closures), imperative control, declarative macros.** The type system keeps it coherent because the seams are *checkable*: `&mut` vs `&` distinguishes mutating from read-only *in the signature* (so the half-OO-half-FP mud literally won't compile), `Result`/`Option` make failure-effects explicit, and the borrow checker proves a functional iterator and an imperative mutation don't alias — eliminating the hazards that make such mixes dangerous in Python/C++.
7. Scala makes functions objects (a function *is* an object with `apply`) and uses traits as both OO interfaces and FP typeclasses, and case classes as OO syntax for ADTs — so "pass a function" and "pass an object" are the same act and the OO/FP boundary dissolves. The failure mode: because it permits everything, codebases fracture into incompatible dialects (deep-FP Cats/ZIO vs Java-with-better-syntax). The only thing that prevents it is an enforced team house-style — the language won't keep you coherent.
8. E.g.: "Does this `map`/`filter` have side effects?" (catch the lying pipeline); "Is this object a value or stateful — and does its API claim match?" (catch mud); "Did effects leak into a pure-named core function (a `db`/`clock` parameter)?" (catch core impurity). Also: "Can I name this module's paradigm in one phrase?", "Is this escalating power unnecessarily?", "Does the paradigm switch land on a boundary I can point to?"

</details>

---

## Cheat Sheet

```
CHOOSE BY SHAPE — per region, not per file:
  pipeline → functional   entity+lifecycle → OO   "which match" → declarative/SQL
  steps+effects → imperative   hot loop → data-oriented   units+msgs → actor   derived state → reactive
  → re-read the shape at EVERY region boundary; the paradigm follows the shape.

THE COST OF MIXING BADLY (what review must catch):
  half-OO-half-FP mud  — mutates AND returns self; value-or-object unclear
  the lying map        — pure-looking pipeline that mutates / does I/O
  effects in the core  — "pure" fn that logs / reads clock / hits cache
  → all three destroy LOCAL REASONING — worse than any single paradigm.

PARADIGM BOUNDARIES = SEAMS:
  coincide with a structural boundary (fn / module / class / layer API)
  typed or named in the signature, not implicit
  effects flow ONE way (outward to shell; purity inward to core)
  a boundary you can't POINT TO is mud waiting to happen.

KEEP MODULES COHERENT:
  one dominant paradigm + one idiom per module; deviations fenced by an internal seam
  effects visible at the edge; no paradigm leaks across the API
  TEST: can you name the module's paradigm in one onboarding sentence?

LEAST POWER, PER LAYER (default down, escalate only with cause):
  data (declarative) → pure fn (functional) → entity (OO) → effects/control (imperative)

MODEL LANGUAGES:
  RUST  — ownership + traits/generics + functional iterators + imperative + decl. macros;
          coherent because the TYPE SYSTEM marks the seams (&mut vs &, Result, borrow check).
  SCALA — OO/FP fused (functions ARE objects; traits = interfaces + typeclasses;
          case classes = ADTs). So powerful it invites dialect-fracture → house style is mandatory.

TEAM: written per-layer defaults · standardized idioms · lint/compiler enforcement · fenced deviations.
```

---

## Summary

- The senior skill is **judgement over the mix**, in three parts: choose a paradigm by the *local region's shape* (re-reading the shape at every boundary, not committing the whole file), bound every paradigm change with a **seam**, and keep each module **coherent**.
- **Mixing badly is worse than any single paradigm**: half-OO-half-functional mud (mutates *and* returns `self`), the lying `map` (pure-looking, secretly effectful), and effects smuggled into the pure core all destroy *local reasoning* — the entire reason to choose a paradigm for a region.
- A **good seam** coincides with a structural boundary, is typed/named in the signature, keeps effects flowing one direction (out to the shell, purity in to the core), and often marks a representation translation. A paradigm boundary you can't point to is mud waiting to happen.
- **Module coherence** means a reader needs one set of assumptions for the whole module — one dominant paradigm, one idiom, effects visible at the edge, no leakage across the API; the test is whether you can name the module's paradigm in an onboarding sentence.
- **Least power per layer** is the compass: default each layer down the ladder (data → pure functions → objects → effects) and treat every escalation as a justified power purchase.
- **Rust** models coherent multiparadigm because the *type system marks the seams* (`&mut` vs `&`, `Result`, the borrow checker) — making the bad mixes uncompilable. **Scala** fuses OO and FP into one model (functions are objects, traits are interfaces *and* typeclasses, case classes are ADTs) — so powerful it invites dialect-fracture, which only an enforced house style prevents.
- The throughline: in most languages the *language permits* mud; only **judgement, seams, coherence, least power, and enforced team convention** keep a multiparadigm codebase from rotting. Next: [`professional.md`](professional.md) — paradigm strategy across a whole system and org.

---

## Further Reading

- **Martin Odersky — *Programming in Scala*** (and the "Scala: Unifying OOP and FP" talks) — the design thesis that OO and FP are facets of one model.
- **Steve Klabnik & Carol Nichols — *The Rust Programming Language*** — ownership as the substrate that makes mixing paradigms safe; iterators, traits, and macros as the functional/generic/declarative layers.
- **Gary Bernhardt — *Boundaries*** — seams between paradigms as the unit of design (functional core, imperative shell).
- **Tim Berners-Lee — *The Rule of Least Power*** — the compass for which paradigm a layer should default to.
- **Fred Brooks — *No Silver Bullet*** — accidental vs essential complexity; bad mixing as an accidental-complexity factory.
- **Li Haoyi — *Hands-on Scala*** — pragmatic, house-style Scala that resists dialect-fracture.

---

## Related Topics

- [01 — Overview & Taxonomy (senior)](../01-overview-and-taxonomy/senior.md) — shape→paradigm, least power, the seam rule, team standardization at system scale.
- [`middle.md`](middle.md) — the blends this page exercises judgement over (functional core/imperative shell, declarative-inside-imperative, paradigm-per-layer).
- [`professional.md`](professional.md) — paradigm strategy across a whole system and organization.
- [08 — Generic Programming](../08-generic-programming/) — Rust traits/generics and Scala typeclasses.
- [10 — Data-Oriented Programming](../10-data-oriented-programming/) — the hot-loop paradigm you escalate to.
- [Object-Oriented Programming](../../object-oriented-programming/) · [Functional Programming](../../code-craft/functional-programming/) — the two paradigms Scala fuses and most modules are built from.
- [FP → Algebraic Data Types](../../code-craft/functional-programming/06-algebraic-data-types/junior.md) · [Functors & Applicatives](../../code-craft/functional-programming/13-functors-and-applicatives/junior.md) — the FP constructs Rust and Scala express in OO syntax.
