# Functional vs OO in Practice — Interview Q&A

> **Roadmap:** [Functional Programming](../README.md) → Functional vs OO in Practice
>
> *Two ways of organizing the same computation: OO bundles state with the behavior that guards it; FP separates immutable data from the functions that transform it. Neither wins universally — the senior skill is knowing which fault line your problem runs along, and how to blend both in languages that let you.*

A bank of **65+ interview questions** spanning definitions, fit, hybrid architectures, the Expression Problem, data-oriented design, performance, and code-reading rewrites in **Java, Python, and Go** (with Scala / Kotlin / Rust asides). Every answer names the trade-off and stays non-dogmatic — *both paradigms are tools*. Use the `<details>` toggles to self-quiz: read the question, answer aloud, then expand.

---

## Table of Contents

1. [Fundamentals / Junior](#fundamentals--junior)
2. [Intermediate / Middle](#intermediate--middle)
3. [Senior — Architecture, DDD, Migration](#senior--architecture-ddd-migration)
4. [Professional / Deep — Dispatch, Memory, Cache](#professional--deep--dispatch-memory-cache)
5. [Code-Reading — Rewrite & Choose](#code-reading--rewrite--choose)
6. [Curveballs](#curveballs)
7. [Rapid-Fire / One-Liners](#rapid-fire--one-liners)
8. How to Talk About FP vs OO in Interviews
9. [Summary](#summary)
10. [Related Topics](#related-topics)

---

## Fundamentals / Junior

> Define each paradigm and state the key differences without caricature.

**Q1. Define object-oriented programming in one breath.**

<details><summary>Answer</summary>

OO organizes a program as a collection of **objects** that bundle **state** (fields) with the **behavior** that operates on and guards that state (methods), communicating by sending messages (method calls). Its three classic pillars are **encapsulation** (hide state behind an interface), **polymorphism** (one call site, many runtime behaviors via dynamic dispatch), and **inheritance/composition** (reuse and substitution). The defining move is *data and the code that owns it live together*, and identity persists as the object mutates over time.
</details>

**Q2. Define functional programming in one breath.**

<details><summary>Answer</summary>

FP organizes a program as the **composition of functions** that transform **immutable values** into new values, ideally without side effects. Its hallmarks are **pure functions** (output depends only on input; same input → same output), **immutability** (you create new data instead of mutating), **first-class and higher-order functions** (functions are values you pass and return), and **algebraic data types + pattern matching** for modeling. The defining move is *data and behavior are separate* — data is inert, functions act on it.
</details>

**Q3. What is the single sharpest difference between the two?**

<details><summary>Answer</summary>

**Where state lives and how it changes.** OO co-locates mutable state with behavior and lets objects evolve in place behind an encapsulated interface; identity is stable, value drifts. FP keeps data immutable and separate from the functions that transform it; you don't change a value, you derive a new one. Almost every other contrast — dynamic dispatch vs. pattern matching, inheritance vs. composition, "tell don't ask" vs. "transform values" — follows from this root difference about state.
</details>

**Q4. How does each paradigm achieve "polymorphism"?**

<details><summary>Answer</summary>

OO uses **subtype/runtime polymorphism**: the object carries its type, and a method call dispatches to the right implementation at runtime (a vtable lookup). FP uses **parametric polymorphism** (generics — one function works for any type, e.g. `map`) and **ad-hoc polymorphism via typeclasses/traits** (Haskell typeclasses, Rust traits, Scala givens) plus **pattern matching** on sum types to dispatch by case. OO puts the dispatch table inside the object; FP puts it in the function (a `match`) or in a separately-defined typeclass instance.
</details>

**Q5. Is `map`/`filter`/`reduce` "functional programming"?**

<details><summary>Answer</summary>

It's the *most visible borrowed idea*, but FP is broader. Using higher-order functions over collections is functional **style**, and it's now available in Java Streams, Python comprehensions/`functools`, and Go's `slices` package. True FP adds **purity discipline** (no hidden side effects), **immutability by default**, **algebraic data types**, and **explicit effect handling**. A program full of `map`/`filter` calls that mutate shared state in the lambdas is not functional in spirit. So `map`/`filter`/`reduce` is the gateway, not the destination. See [Map / Filter / Reduce](../04-map-filter-reduce/junior.md).
</details>

**Q6. Give a tiny example of the same task in OO and FP style.**

<details><summary>Answer</summary>

"Total price of paid orders." OO (object owns and mutates a running total):

```java
class Cart {
    private int total = 0;
    void add(Order o) { if (o.isPaid()) total += o.price(); }  // mutate state
    int total() { return total; }
}
```

FP (transform an immutable list into a value):

```java
int total = orders.stream()
    .filter(Order::isPaid)
    .mapToInt(Order::price)
    .sum();                       // no mutable accumulator the caller sees
```

Same result; the FP version has no observable mutable state and reads as a data pipeline, while the OO version encapsulates an evolving total behind `Cart`'s interface.
</details>

**Q7. What is encapsulation, and does FP have an equivalent?**

<details><summary>Answer</summary>

Encapsulation in OO hides mutable state behind a method interface so invariants can't be violated from outside. FP achieves the same *invariant protection* differently: **immutability** means there's no mutation to guard against, and **smart constructors / opaque types** (a type whose only constructor validates, exposed via a module boundary) ensure you can't build an invalid value in the first place. So both protect invariants — OO by *guarding mutation*, FP by *making invalid states unrepresentable and values unchangeable*.
</details>

**Q8. "FP avoids state entirely" — true or false?**

<details><summary>Answer</summary>

False, and a common junior misconception. FP doesn't *avoid* state — it makes state changes **explicit and local** instead of implicit and pervasive. A pure function can thread state through as an argument and a return value (`(state, input) -> (newState, output)`), and effectful programs eventually mutate the real world (write a file, update a DB). The discipline is to keep the *core* pure and push state/effects to the *edges*, not to pretend state doesn't exist. See [Effect Tracking](../10-effect-tracking/junior.md).
</details>

**Q9. What does "referential transparency" mean and why does OO usually lack it?**

<details><summary>Answer</summary>

An expression is referentially transparent if you can replace it with its result without changing the program's meaning — which requires the function to be pure. `add(2, 3)` is always `5`; you can substitute it freely. OO method calls usually aren't transparent because they read and mutate object state: `cart.add(o)` returns nothing useful and changes the world, so `cart.total()` depends on the *history* of calls, not just arguments. Referential transparency is what lets you reason about FP code by **substitution** rather than by **simulating execution**. See [Pure Functions](../02-pure-functions-and-referential-transparency/junior.md).
</details>

**Q10. Name a kind of problem that fits OO naturally.**

<details><summary>Answer</summary>

A domain of **long-lived stateful entities with identity and lifecycle** — a game with thousands of mutating actors, a GUI widget tree, a connection/session object, a hardware device driver. When the problem is naturally "things that *are* something and *change over time*," objects model it cleanly: each entity owns its state and the operations that keep it valid. Trying to thread all that state functionally can be more awkward than just letting an object hold it.
</details>

**Q11. Name a kind of problem that fits FP naturally.**

<details><summary>Answer</summary>

A **data-transformation pipeline**: parse → validate → transform → aggregate → render, especially over collections, where each stage is a pure function of its input. Compilers, ETL jobs, financial calculations, query engines, and anything you'd describe as "given this input, produce that output" map directly onto function composition. The absence of mutable state makes these trivially testable, parallelizable, and easy to reason about by substitution. See [Composition](../05-composition/junior.md).
</details>

**Q12. Is inheritance part of the OO/FP divide?**

<details><summary>Answer</summary>

Inheritance is an OO *mechanism*, not the essence of OO, and it's the most contested one — "favor composition over inheritance" is mainstream OO advice precisely because deep inheritance hierarchies are fragile. FP has no implementation inheritance; it reuses behavior through **composition of functions** and **typeclasses/traits** for shared interfaces. So the real divide isn't "inheritance vs. composition" — both paradigms now prefer composition. The divide is about *state and dispatch*, not the reuse mechanism.
</details>

---

## Intermediate / Middle

> Where each fits, hybrid patterns, the Expression Problem, strategy-as-function.

**Q13. How do you decide, for a given module, whether to lean OO or FP?**

<details><summary>Answer</summary>

Ask which axis the module varies along. If you mostly **add new *operations* over a fixed set of data shapes** (a stable AST you keep adding passes to), FP's functions + pattern matching shine. If you mostly **add new *data variants* that all support a fixed set of operations** (a plugin system where each plugin implements the same interface), OO's polymorphism shines — this is the **Expression Problem** in disguise. Also weigh: heavy long-lived mutable state and identity → OO; stateless transformation of values → FP. Most real modules mix both, and that's fine.
</details>

**Q14. What is the Expression Problem?**

<details><summary>Answer</summary>

It's the challenge of extending a system along **two axes at once** without modifying existing code or losing type safety: adding new **data variants** (e.g. a new shape) *and* adding new **operations** (e.g. a new function over all shapes). OO makes adding a *variant* easy (new class implements the interface) but adding an *operation* hard (you must edit every class). FP makes adding an *operation* easy (new function with a `match`) but adding a *variant* hard (you must edit every existing `match`). Each paradigm is strong on one axis and weak on the other — that asymmetry *is* the problem.
</details>

**Q15. Show the Expression Problem concretely in Java vs. a functional style.**

<details><summary>Answer</summary>

OO (easy to add a shape, hard to add an operation):

```java
interface Shape { double area(); }                 // add op = edit EVERY class
class Circle implements Shape { double area() {...} }
class Square implements Shape { double area() {...} }
// New shape Triangle: trivial. New op perimeter(): touch all classes + interface.
```

Functional (easy to add an operation, hard to add a variant):

```java
sealed interface Shape permits Circle, Square {}   // add variant = edit EVERY switch
double area(Shape s) { return switch (s) {         // new op = just a new function
    case Circle c -> Math.PI * c.r() * c.r();
    case Square q -> q.side() * q.side();
}; }
// New op perimeter(Shape): trivial. New variant Triangle: touch every switch.
```

The strengths are mirror images. Knowing *which axis your domain grows along* tells you which to pick.
</details>

**Q16. What are the known "solutions" to the Expression Problem?**

<details><summary>Answer</summary>

None are free, but the classic escapes are: **typeclasses/traits** (Haskell, Rust, Scala givens) — you can add a new type *and* add a new operation as separately-defined instances without editing either; the **Visitor pattern** in OO (lets you add operations to a closed hierarchy at the cost of making *new variants* painful — it flips the trade-off); and **open/multiple dispatch** systems (Clojure protocols, Julia, the Common Lisp Object System). The pragmatic answer in everyday Java/Python/Go is: pick the axis you expect to vary more and accept friction on the other, or use a `sealed`/closed hierarchy so the compiler at least *tells you* every place to update.
</details>

**Q17. "Strategy pattern is just a function." Explain.**

<details><summary>Answer</summary>

The OO Strategy pattern wraps an interchangeable algorithm in an interface with one method and injects an implementing object. In a language with first-class functions, that's exactly a **higher-order function taking a function parameter** — the interface-with-one-method *is* a function type. `Comparator<T>` in Java is a strategy; `list.sort((a,b)->...)` passes the strategy as a lambda. So in FP-capable languages, many "patterns" (Strategy, Command, Template Method, Observer) collapse into "pass a function." The class ceremony was a workaround for languages that lacked first-class functions.

```java
// OO Strategy                          // FP equivalent
interface Discount { int apply(int p); } int apply(int p, IntUnaryOperator discount)
class Ten implements Discount {...}      apply(price, p -> p * 9 / 10)
```
</details>

**Q18. When is the *class* still better than the bare function, even if a function would do?**

<details><summary>Answer</summary>

When the strategy carries **state or configuration**, has **multiple related operations**, or benefits from a **name and discoverability**. A `RetryPolicy` with `maxAttempts`, `backoff`, and several methods is clearer as an object than as a tangle of closures capturing config. A single-method, stateless strategy is better as a function. The rule of thumb: *one behavior, no state → function; bundle of related behavior or configured state → object*. Don't cargo-cult a class for what is genuinely one lambda, and don't smear five captured variables across closures when an object would document them.
</details>

**Q19. What does "functional core, imperative shell" mean and why is it a hybrid?**

<details><summary>Answer</summary>

It's an architecture that puts **all decision logic in pure functions** (the core: takes data, returns data/decisions, no I/O) and confines **all side effects** (DB, network, clock, randomness) to a thin **imperative/OO shell** that calls the core and then acts on its output. It's the dominant practical blend: you get FP's testability and reasoning where the logic lives, and you keep OO/imperative code for the unavoidable stateful edges. Tests hit the core with plain values (fast, no mocks); the shell stays thin enough to cover with a few integration tests. See [Effect Tracking](../10-effect-tracking/middle.md).
</details>

**Q20. Give the functional-core/imperative-shell split for a "charge customer" feature.**

<details><summary>Answer</summary>

```python
# CORE (pure): decides what should happen, touches nothing external
def decide_charge(account, amount, now) -> Decision:
    if account.frozen:        return Decision.reject("frozen")
    if amount > account.limit: return Decision.reject("over limit")
    return Decision.charge(amount, idempotency_key(account, now))

# SHELL (impure): does I/O based on the decision
def charge(account_id, amount):
    account = repo.load(account_id)          # effect: read
    decision = decide_charge(account, amount, clock.now())  # pure
    if decision.rejected: return decision
    gateway.charge(decision)                 # effect: network
    repo.save(account.applied(decision))     # effect: write
    return decision
```

All the *rules* are in `decide_charge`, testable with plain objects and no mocks. The shell is mechanical and small. That's the blend interviewers want to see.
</details>

**Q21. Is immutability always worth it? What's the trade-off?**

<details><summary>Answer</summary>

Immutability buys safe sharing (no defensive copies, thread-safety for free), trivial equality/caching, and easy reasoning — but it costs **allocation and GC pressure** because "changing" a value means building a new one. Persistent data structures with structural sharing (used by Clojure, Scala, immutable.js) make this `O(log n)` rather than `O(n)`, which is usually fine. The exception is **hot, tight loops over large arrays** (numerics, game frames) where in-place mutation of a local buffer is dramatically faster and the mutation never escapes — there, controlled local mutability wins. Default to immutable; reach for mutation locally and deliberately. See [Immutability](../03-immutability/middle.md).
</details>

**Q22. How do `Optional`/`Result` types relate to the FP-vs-OO question?**

<details><summary>Answer</summary>

They're FP's answer to two OO/imperative habits: returning `null` and throwing exceptions for expected failures. `Optional<T>`/`Result<T,E>` are **sum types** (algebraic data types) that make "might be absent" or "might fail" *visible in the signature* and *force the caller to handle both cases*, replacing implicit control flow (null checks, try/catch) with explicit data. Java has `Optional`, Rust/Scala have `Option`/`Result`, Go uses the idiomatic `(value, error)` pair (a poor-man's Result). The point: errors become **values you compose**, not exceptions you hope someone catches. See [Algebraic Data Types](../06-algebraic-data-types/middle.md).
</details>

**Q23. What's the FP critique of inheritance, and the OO rebuttal?**

<details><summary>Answer</summary>

FP critique: implementation inheritance couples subclass to superclass internals (the fragile base class problem), spreads behavior across a hierarchy you must read top-to-bottom, and is a rigid form of code reuse that composition does more flexibly. OO rebuttal: modern OO *agrees* — "favor composition over inheritance" is OO orthodoxy, and inheritance is reserved for genuine **subtype (is-a) substitutability**, not reuse. So this isn't really FP-vs-OO; it's "good OO vs. naive OO." Both mature paradigms reuse via composition; OO keeps inheritance as a narrow tool for polymorphic substitution.
</details>

**Q24. How do you handle "shared mutable state across threads" in each paradigm?**

<details><summary>Answer</summary>

OO traditionally guards it: `synchronized`, locks, monitors around the object that owns the state — correct but error-prone (deadlocks, forgotten locks). FP largely *dissolves* the problem: if data is immutable, it can be shared across threads with **zero locking** because there's nothing to race on; state changes become a single coordinated swap (atomic reference, software transactional memory, or the actor model where each actor owns its state and communicates by messages). The FP advantage here is real and is the main reason functional ideas spread into concurrency. See [Immutability](../03-immutability/senior.md).
</details>

**Q25. Can you write functional code in Java? What helps and what hurts?**

<details><summary>Answer</summary>

Yes, substantially. **Helps:** `record` (concise immutable products), `sealed interface` + pattern-matching `switch` (sum types + exhaustiveness), `Stream` and lambdas (map/filter/reduce), `Optional`, `Function`/`BiFunction` types. **Hurts:** no native immutability for collections (you reach for `List.copyOf` or Guava/Vavr), no tail-call optimization (deep recursion overflows the stack — use loops/streams), no real `Result` type or HKTs, and the verbosity of generic functional signatures. The verdict: idiomatic functional-*style* Java is very achievable and increasingly common; pure-FP Java (effect systems, monad transformers) is possible but fights the grain. Use functional core / OO shell.
</details>

**Q26. Can you write functional code in Go? Where does Go push back?**

<details><summary>Answer</summary>

Partially. **Helps:** functions are first-class, closures work, generics (1.18+) enable generic `Map`/`Filter`/`Reduce`, and the `slices`/`maps` packages add functional helpers. **Pushes back hard:** no immutability (slices and maps are reference types, mutated freely), no sum types / pattern matching (you fake it with interfaces + type switches or tagged structs), no generics-over-methods richness, and the community idiom favors explicit imperative loops over `map`/`filter` chains ("clear is better than clever"). Go is deliberately imperative; you can borrow first-class functions and `Result`-like `(T, error)` returns, but going full-FP fights both the language and its culture.
</details>

**Q27. Why do most "Gang of Four" patterns shrink in functional languages?**

<details><summary>Answer</summary>

Because many GoF patterns are *workarounds for missing first-class functions and sum types*. Strategy, Command, Template Method, and Observer become "pass/store a function." Iterator becomes a lazy sequence/generator. Visitor exists to dodge the Expression Problem that pattern matching solves directly. State and Chain-of-Responsibility become data + a fold. The patterns aren't *wrong* — they're language-feature emulation. When the language has the feature natively, the pattern dissolves into a one-liner, which is Peter Norvig's old observation that 16 of 23 GoF patterns are "invisible or simpler" in dynamic/functional languages.
</details>

**Q28. What is "data-oriented design" and is it FP or OO?**

<details><summary>Answer</summary>

Data-oriented design (DOD) organizes code around **how data is laid out in memory for the CPU and cache**, typically favoring *structure-of-arrays* over *array-of-structures* so hot fields are contiguous and processed in tight loops. It is **neither FP nor OO** — and that's the point. It rejects OO's "bundle data with behavior per object" (which scatters hot data across heap objects, wrecking cache locality) *and* it doesn't care about FP's purity or immutability (DOD loops often mutate big buffers in place). DOD's loyalty is to the hardware, not a paradigm. It overlaps with FP's "separate data from functions" instinct but for performance reasons, not reasoning reasons.
</details>

---

## Senior — Architecture, DDD, Migration

> Functional core / OO shell at scale, DDD with FP, language blends, migration.

**Q29. How does Domain-Driven Design map onto FP vs OO?**

<details><summary>Answer</summary>

Classic DDD is OO: **entities** (identity + mutable lifecycle), **value objects** (immutable, equality by value), **aggregates** (consistency boundaries), **domain services**. Functional DDD (popularized by Scott Wlaschin's *Domain Modeling Made Functional*) keeps the strategic patterns but reshapes the tactical ones: model the domain with **algebraic data types** (make illegal states unrepresentable — an `UnvalidatedOrder` and a `ValidatedOrder` are *different types*), express **workflows as function pipelines** (`UnvalidatedOrder -> Result<ValidatedOrder>`), and treat the aggregate as an immutable value transformed by pure functions. Both share the *ubiquitous language* and *bounded context* ideas; they differ on whether the aggregate mutates in place or is re-derived.
</details>

**Q30. "Make illegal states unrepresentable" — what does that mean and which paradigm leans on it?**

<details><summary>Answer</summary>

It's the FP/type-driven principle of choosing types so that invalid combinations *cannot be constructed*, pushing whole classes of bugs to compile time. Instead of an `Order` with a nullable `paidAt` and a boolean `isPaid` (which can disagree), you model a sum type: `Order = Unpaid | Paid(timestamp)` — there's no way to be "paid with no timestamp." Instead of validating a string is an email everywhere, you have an `Email` type whose only constructor validates. OO can approximate this with private constructors and factories, but sum types + exhaustive matching make it natural. It's the structural cousin of OO's invariant-guarding, achieved through the type system rather than runtime checks. See [Algebraic Data Types](../06-algebraic-data-types/senior.md).
</details>

**Q31. You're designing a new service. How do you decide the OO/FP balance at the architecture level?**

<details><summary>Answer</summary>

Slice by responsibility, not by ideology. Put **business rules and calculations in a pure functional core** — they're the part that's worth testing exhaustively and reasoning about. Put **I/O, persistence, messaging, and external integrations behind OO/imperative adapters** (ports-and-adapters / hexagonal), because those are inherently stateful and effectful. Use **objects for long-lived stateful infrastructure** (connection pools, caches, the HTTP server) and **functions/immutable data for the request-to-response transformation**. The seam between core and shell is where you decide: anything that can be a pure function of its inputs *should* be; everything else is an adapter. This is functional core / imperative shell scaled to a service.
</details>

**Q32. How do you migrate a mutable, OO-heavy codebase toward a functional core incrementally?**

<details><summary>Answer</summary>

Don't rewrite — **strangle**. (1) Find a decision-heavy method buried in a stateful class. (2) Extract the *pure* part: a new function that takes the data it reads as parameters and returns a decision/value, doing no I/O. (3) Have the old method call the new pure function, then perform the effects with its result — now the logic is testable with plain values. (4) Add characterization tests against the pure function. (5) Repeat, growing the pure core outward and shrinking the stateful method to a thin shell. Each step is green-to-green and shippable. Over time the effectful code becomes a thin rim around a large, well-tested pure center. Never mix the structural extraction with behavioral changes in one commit.
</details>

**Q33. What goes wrong when teams adopt FP dogmatically?**

<details><summary>Answer</summary>

Several failure modes: **monad-transformer astronautics** — abstractions so general the team can't read them; **performance regressions** from naive immutability in hot paths (allocations, GC churn) without measuring; **fighting the language** (full-FP in Go or pre-records Java is a verbosity tax); and **purity theater** where effects are smuggled through cleverly-typed wrappers that obscure rather than clarify. The senior signal is recognizing that FP's *value* is testability, reasoning, and concurrency-safety — and that you can capture 90% of it with "pure core, immutable data by default, effects at the edges" *without* HKTs and free monads. Dogma in either direction (FP or OO) is the smell.
</details>

**Q34. What goes wrong when teams adopt OO dogmatically?**

<details><summary>Answer</summary>

The classic pathologies: **deep inheritance hierarchies** that are fragile and hard to follow; **anemic domain models** (data-only classes + service classes that hold all behavior — accidentally rebuilding procedural code while paying OO ceremony); **AbstractFactoryFactory** over-abstraction and pattern-cargo-culting; **God Objects** that accrete responsibilities; and **mutable shared state** that breeds concurrency bugs. Forcing everything into objects produces ceremony where a function would do (a `Calculator` class with one static-feeling method). Mature OO already borrows FP correctives: immutability for value objects, composition over inheritance, functions-as-strategies. Again, the dogma is the problem, not the paradigm.
</details>

**Q35. How do Scala and Kotlin position themselves on this spectrum?**

<details><summary>Answer</summary>

Both are **deliberate hybrids on the JVM**. **Scala** leans furthest into FP — first-class functions, pattern matching, immutable collections by default, `Option`/`Either`, higher-kinded types, and ecosystems (Cats, ZIO) for pure effect tracking — while still supporting full OO with classes and traits; it lets you go as pure as you dare. **Kotlin** is more pragmatically blended: `data class` (immutable products), sealed classes (sum types), `when` expressions, extension functions, and good null-safety, but it stays comfortable with mutation and OO and doesn't chase HKTs. Scala says "FP-first, OO available"; Kotlin says "pleasant OO with FP ergonomics." Both validate the thesis that the future is *blended*.
</details>

**Q36. Where does Rust sit, given it has no GC?**

<details><summary>Answer</summary>

Rust is a fascinating blend: heavily **FP-influenced** (iterators, closures, `Option`/`Result`, pattern matching, traits as ad-hoc polymorphism, immutability by default with `let`) but with **no garbage collector** — so it gets FP's *expressiveness* while controlling FP's usual *allocation cost* through ownership and borrowing. You write functional-looking iterator chains that compile to tight loops with no heap churn, and the borrow checker enforces the "no shared mutable aliasing" discipline that FP achieves via immutability — but at compile time, with zero runtime overhead. Rust shows FP ergonomics and systems performance aren't mutually exclusive; you pay in compile-time complexity instead.
</details>

**Q37. Anemic domain model — is it OO done wrong, or FP in disguise?**

<details><summary>Answer</summary>

It's usually OO done *accidentally*, and it sits in an uncomfortable middle. Data-only classes with all behavior in service classes is procedural code wearing OO clothes — it pays OO's ceremony (getters, setters, object graph) without OO's benefit (behavior co-located with the data it guards). It's *not* principled FP either, because FP would make the data **immutable** and the functions **pure**, whereas anemic models have mutable setters and stateful services. The honest paths are: commit to OO (push behavior into the entities — rich domain model) *or* commit to FP (immutable data + pure transformation functions). The anemic model is the worst-of-both stuck in between.
</details>

**Q38. How do you test the two styles, and why does it matter for design?**

<details><summary>Answer</summary>

Pure functional code is tested by **example and property**: feed inputs, assert outputs, no setup or mocks — and property-based testing (QuickCheck-style) is natural because pure functions have invariants. Stateful OO code is tested by **arranging state, acting, asserting state/interactions**, often needing mocks/stubs for collaborators, which is slower and more brittle. This testing asymmetry is itself a design argument: the more logic you can push into the pure core, the cheaper and more thorough your tests get, and the fewer mocks you write. "How hard is this to test?" is a proxy for "how much hidden state and effect does it carry?"
</details>

**Q39. Does FP or OO better support evolving a long-lived system?**

<details><summary>Answer</summary>

Neither universally — it depends on *how* the system evolves (the Expression Problem again). Systems that grow by **adding new operations over stable data** age better in FP. Systems that grow by **adding new variants/plugins behind stable interfaces** age better in OO. Real systems do both, so the durable answer is architectural: a **pure functional core** (easy to reason about and refactor because no hidden state) inside an **OO/hexagonal shell** (easy to swap adapters and add integrations). The thing that actually predicts maintainability is **low coupling and high cohesion**, which both paradigms can achieve or violate.
</details>

---

## Professional / Deep — Dispatch, Memory, Cache

> Runtime cost of dispatch, immutability GC vs. mutation, DOD cache effects, no universal winner.

**Q40. What's the runtime cost difference between virtual dispatch (OO) and pattern matching (FP)?**

<details><summary>Answer</summary>

**Virtual/interface dispatch** is an indirect call through a vtable: load the type's method-table pointer, index it, call — a couple of dependent loads plus an indirect branch the CPU must predict. When the call site is **monomorphic** (one type in practice), JITs devirtualize and inline it to near-zero cost; when **megamorphic** (many types), the indirect branch mispredicts and inlining fails, costing tens of cycles. **Pattern matching** on a sum type is typically a tag read + a `switch` (a jump table or a few compares) — usually cheaper and more predictable than megamorphic dispatch, and trivially inlinable. Neither dominates universally: monomorphic virtual calls and small `switch`es are both nearly free; the costs appear at the polymorphic extremes.
</details>

**Q41. Does immutability hurt performance through GC, and when?**

<details><summary>Answer</summary>

It can. Immutable updates allocate: "change one field" means a new object, so update-heavy code produces lots of short-lived garbage. On modern **generational GCs** (JVM, Go, .NET) short-lived allocations are cheap to collect (the nursery/young gen is bump-allocated and swept fast), so the cost is often modest — but it's *not zero*, and in allocation-storm workloads it shows up as GC pause time and throughput loss. **Persistent data structures** with structural sharing make large-structure updates `O(log n)` instead of copying everything. The pathological case is mutating a large array element-by-element immutably (each step copies) — there, in-place mutation is orders of magnitude faster. Measure: default immutable, optimize the proven hot allocation paths.
</details>

**Q42. Why does data-oriented design beat object-oriented layout for cache, concretely?**

<details><summary>Answer</summary>

Cache lines are ~64 bytes and the CPU loads whole lines. **Array-of-structures (OO)**: `Entity[]` where each `Entity` has 20 fields scatters the one hot field you're summing across many cache lines, so iterating loads mostly cold data and thrashes the cache. **Structure-of-arrays (DOD)**: a contiguous `float[] positions` packs the hot field tightly, so each cache line is fully useful, the hardware prefetcher streams perfectly, and the loop often auto-vectorizes (SIMD). For a tight loop over a million entities touching one field, SoA can be several times faster purely from cache behavior — no algorithmic change. This is why game engines and high-perf systems use DOD, and why it's "neither FP nor OO": it's organized for the memory hierarchy.
</details>

**Q43. Is there a memory-locality argument *for* OO?**

<details><summary>Answer</summary>

Yes, for the *opposite* access pattern. If you process **one entity at a time touching most of its fields** (a request handler that reads the whole user record), array-of-structures keeps that entity's fields on the same few cache lines — good locality. SoA would scatter that entity's fields across many separate arrays, hurting locality and possibly causing more cache misses. So AoS (the natural OO layout) wins for "process whole objects occasionally," SoA (DOD) wins for "process one field across all objects in a tight loop." The layout should follow the **dominant access pattern**, which is exactly why DOD says "design for the data's usage, not for conceptual modeling."
</details>

**Q44. How does each paradigm interact with the JIT / inlining?**

<details><summary>Answer</summary>

JITs love **monomorphic, small** call sites. FP code that passes lambdas everywhere can defeat inlining if the lambda target varies (megamorphic), and deeply layered higher-order composition can exceed inlining budgets — though escape analysis often eliminates the closure allocations and JITs specialize hot monomorphic lambdas well. OO suffers the same at megamorphic virtual call sites, but benefits from **profile-guided devirtualization** when one type dominates. Functional immutability *helps* the optimizer (no aliasing means freer reordering and caching of loads). Net: both paradigms optimize well in the common monomorphic case; both degrade at high polymorphism; immutability gives the optimizer more freedom but allocates more.
</details>

**Q45. "Functional code is slower" — is that true?**

<details><summary>Answer</summary>

Sometimes, sometimes faster, mostly "it depends and the difference is usually small." Slower when: naive immutability allocates in hot loops, or higher-order abstraction defeats inlining. Faster/equal when: immutability removes defensive copies and locks (huge in concurrent code), the compiler reorders freely thanks to no aliasing (Rust, Haskell with fusion), or stream fusion eliminates intermediate collections. The honest professional answer: paradigm is rarely the bottleneck — algorithm and data layout dominate. Benchmark the actual hot path; don't reject FP for theoretical allocation cost or adopt it expecting magic. **There is no universal performance winner.**
</details>

**Q46. Why is "no universal winner" the correct senior stance, stated rigorously?**

<details><summary>Answer</summary>

Because the paradigms optimize *different objectives* that genuinely conflict: OO optimizes for **adding data variants and modeling stateful identity**; FP optimizes for **adding operations, reasoning by substitution, and concurrency-safety**; DOD optimizes for **hardware throughput**. The Expression Problem proves you can't have FP's and OO's extensibility strengths simultaneously without extra machinery. Cache analysis shows the best memory layout depends on the access pattern, not the paradigm. So a claim that one paradigm is universally best would have to be best along axes that demonstrably trade off against each other — which is impossible. The mature position isn't relativism ("anything goes"); it's *fit*: match the tool to the dominant axis of change and the dominant access pattern.
</details>

**Q47. How does immutability change your concurrency cost model?**

<details><summary>Answer</summary>

Dramatically, and usually in FP's favor. Mutable shared state forces **synchronization** — locks (contention, deadlocks), atomics, memory barriers — whose cost scales badly with core count and whose bugs are the hardest to find. Immutable data needs **none of that for reads**: any number of threads can read a shared immutable value with zero coordination, and "updates" become a single atomic pointer swap (compare-and-swap on a reference) or an STM transaction. You trade lock contention for allocation. On many-core hardware this is often a net win and is *the* reason functional ideas dominate modern concurrency (actors, channels, persistent structures). See [Immutability](../03-immutability/professional.md).
</details>

**Q48. What's the cost of `Optional`/`Result` vs. null/exceptions at runtime?**

<details><summary>Answer</summary>

`Optional<T>` in Java is a heap object wrapping the value (an extra allocation and indirection) unless escape analysis scalar-replaces it — measurable in a tight loop, negligible elsewhere. Rust's `Option<T>` is **zero-cost** (often niche-optimized, e.g. `Option<&T>` is just a nullable pointer with no extra space). Exceptions are cheap when *not* thrown but expensive when thrown (stack-trace capture, unwinding), so using them for *expected* control flow (e.g. "not found") is a real cost that `Result` avoids. The reasoning-and-safety benefit of explicit error values usually outweighs the small allocation cost; in hot loops, prefer Rust-style zero-cost sum types or avoid boxing.
</details>

---

## Code-Reading — Rewrite & Choose

> Given a snippet, rewrite it in the other paradigm and say which fits better.

**Q49. Rewrite this OO Python accumulator in functional style. Which is clearer here?**

```python
class Stats:
    def __init__(self): self.total = 0; self.count = 0
    def add(self, x): self.total += x; self.count += 1
    def mean(self): return self.total / self.count
```

<details><summary>Answer</summary>

```python
def mean(xs):
    return sum(xs) / len(xs)          # pure function of the data
```

For a one-shot calculation over a known collection, the function is clearly better: no object lifecycle, no "did I call `add` before `mean`?" ordering risk, trivially testable. **But** the OO version isn't pointless — if data *streams in over time* and you can't hold it all, an incremental accumulator object (or a `reduce` with a running tuple) is the right shape. So: batch over a collection → function; online/streaming with retained state → the stateful object (or a fold). The data's arrival pattern decides.
</details>

**Q50. Rewrite this functional Go pipeline as idiomatic OO/imperative Go. Which is more idiomatic in Go?**

```go
func activeEmails(users []User) []string {
    return Map(Filter(users, func(u User) bool { return u.Active }),
               func(u User) string { return u.Email })
}
```

<details><summary>Answer</summary>

```go
func activeEmails(users []User) []string {
    out := make([]string, 0, len(users))
    for _, u := range users {
        if u.Active {
            out = append(out, u.Email)   // single explicit pass
        }
    }
    return out
}
```

In **Go**, the explicit loop is more idiomatic: one pass instead of two, no intermediate slice, no generic helper indirection, and it reads the way Go programmers expect ("clear is better than clever"). The functional version would be idiomatic in Java Streams or Scala, where the chaining is the norm and fusion/laziness avoids the intermediate. Same logic, different "home turf": Go rewards the loop, JVM/FP languages reward the pipeline.
</details>

**Q51. Rewrite this OO Java shape hierarchy functionally with sealed types. When would you NOT do this?**

```java
abstract class Shape { abstract double area(); }
class Circle extends Shape { double r; double area(){ return Math.PI*r*r; } }
class Square extends Shape { double s; double area(){ return s*s; } }
```

<details><summary>Answer</summary>

```java
sealed interface Shape permits Circle, Square {}
record Circle(double r) implements Shape {}
record Square(double s) implements Shape {}

double area(Shape sh) { return switch (sh) {
    case Circle c -> Math.PI * c.r() * c.r();
    case Square s -> s.s() * s.s();
}; }
```

The functional version makes adding a *new operation* (`perimeter`, `describe`) trivial — just another function — and the exhaustive `switch` fails compilation if you add a variant and forget a case. **Don't do this** when you expect to add many new *shapes* over time (especially from outside code / plugins): then the OO version, where each new shape brings its own `area()` without touching existing code, is better. It's the Expression Problem — choose by which axis grows.
</details>

**Q52. Read this Python. Which paradigm does it actually want, and why?**

```python
class OrderProcessor:
    def __init__(self, repo, mailer, gateway):
        self.repo, self.mailer, self.gateway = repo, mailer, gateway
    def process(self, order_id):
        o = self.repo.load(order_id)
        if o.total > o.customer.limit: raise OverLimit()
        self.gateway.charge(o.total)
        o.status = "PAID"; self.repo.save(o)
        self.mailer.send(o.customer.email, "paid")
```

<details><summary>Answer</summary>

It wants a **blend** — specifically functional core / imperative shell. The *decision* (`o.total > o.customer.limit`) is pure logic tangled with three effects (load, charge, save, send), which is why it'd need three mocks to test. Refactor the rule into a pure `decide(order) -> Decision` function (testable with plain objects, no mocks), and keep `OrderProcessor` as the thin OO shell that performs the effects based on the decision. The OO object is the right home for the *injected collaborators and orchestration*; the FP function is the right home for the *rule*. Neither paradigm alone is the answer.
</details>

**Q53. Rewrite this mutable Java loop immutably with Streams. Is the rewrite always an improvement?**

```java
Map<String,Integer> counts = new HashMap<>();
for (String w : words) counts.merge(w, 1, Integer::sum);
```

<details><summary>Answer</summary>

```java
Map<String,Long> counts = words.stream()
    .collect(Collectors.groupingBy(w -> w, Collectors.counting()));
```

The stream version is declarative and has no externally-visible mutable accumulator, which reads well and parallelizes (`.parallelStream()`) safely. **But it's not strictly better:** the imperative `merge` loop is arguably *clearer* to many readers, allocates less, and is easy to step through in a debugger. For a hot path over huge input, the explicit loop may win on allocation. This is a case where both are fine — pick for readability in your team, and reach for the stream when you want declarativeness or parallelism, not as a reflex.
</details>

**Q54. This Go code fakes a sum type with an interface. Rewrite the consumer; what's lost vs. real pattern matching?**

```go
type Event interface{ isEvent() }
type Click struct{ X, Y int };      func (Click) isEvent() {}
type Key   struct{ Code int };       func (Key) isEvent() {}

func handle(e Event) {
    switch ev := e.(type) {
    case Click: fmt.Println("click", ev.X, ev.Y)
    case Key:   fmt.Println("key", ev.Code)
    }
}
```

<details><summary>Answer</summary>

This *is* the idiomatic Go approximation — a sealed-ish interface + type switch. What's **lost** versus real sum types (Rust/Scala/sealed-Java): there's **no exhaustiveness checking** — add a `Scroll` event and the compiler won't warn that `handle` ignores it; the "sealed" property is only enforced by the unexported `isEvent()` marker (a convention, not a guarantee against the same package adding variants); and there's no destructuring in the match. The OO interface dispatch alternative (`e.Handle()`) would flip the Expression Problem trade-off. Go's type switch is a pragmatic middle, but it trades the compiler safety that makes FP sum types valuable.
</details>

**Q55. Read this Scala. Identify the paradigm blend and whether it's well-chosen.**

```scala
final case class Account(id: String, balance: Long, frozen: Boolean)

def withdraw(a: Account, amount: Long): Either[String, Account] =
  if (a.frozen)            Left("frozen")
  else if (amount > a.balance) Left("insufficient")
  else                     Right(a.copy(balance = a.balance - amount))
```

<details><summary>Answer</summary>

Well-chosen functional modeling. `Account` is an **immutable value object** (`case class`), `withdraw` is a **pure function** returning `Either[Error, Account]` — a sum type that forces the caller to handle failure, with no exceptions and no in-place mutation (`copy` derives a new account). This is textbook functional DDD: the domain rule is a total, referentially-transparent function, trivially unit-testable and safe to share across threads. The *effects* (loading/saving the account) would live in an outer shell. The only thing to watch: if accounts are extremely high-churn, the `copy` allocations matter — but for a banking domain, correctness and clarity rightly win. Good blend.
</details>

---

## Curveballs

> The questions designed to catch dogma.

**Q56. FP or OO — which is better?**

<details><summary>Answer</summary>

Neither in general — they're **tools optimized for different problems**, and the honest answer is "it depends, and here's on what." OO fits long-lived stateful entities with identity and systems that grow by adding data variants behind stable interfaces; FP fits data-transformation pipelines, calculation-heavy logic, concurrency, and systems that grow by adding operations. The Expression Problem proves their extensibility strengths are mirror images you can't both have for free. Most production systems are best served by a **blend** — a pure functional core inside an OO/imperative shell. Anyone who answers "X is just better" without "for what?" is signaling dogma, which is the opposite of the senior signal.
</details>

**Q57. What is the Expression Problem, in one minute?**

<details><summary>Answer</summary>

Extending a system along two axes — new **data variants** and new **operations** — without editing existing code and without losing type safety. OO makes new variants easy (new class) but new operations hard (edit every class); FP makes new operations easy (new function with a match) but new variants hard (edit every match). It's a fundamental asymmetry: each paradigm is strong on one axis and weak on the other. Typeclasses/traits and the Visitor pattern are partial escapes, each with its own cost. The practical takeaway: **pick the paradigm whose easy axis matches the way your domain actually grows.**
</details>

**Q58. When is OO *clearly* the right choice?**

<details><summary>Answer</summary>

When the domain is naturally **stateful entities with identity and lifecycle**, and when the system grows by **adding new variants behind a stable interface**. Concrete cases: a GUI framework (widgets are objects with state and behavior, and third parties add new widget types implementing the same interface); a plugin architecture (each plugin is a new variant of a fixed contract); a simulation/game with thousands of mutating actors; stateful infrastructure (connection pools, sessions, the framework's own objects). In all of these, "open to new types, closed to new operations" is the dominant growth pattern — exactly OO's strength.
</details>

**Q59. Can you do FP in Java and Go, honestly?**

<details><summary>Answer</summary>

**Java: yes, substantially** — records, sealed interfaces + pattern-matching switch, streams, lambdas, `Optional`, and functional interfaces make functional-*style* Java idiomatic and increasingly common; the gaps are no TCO, no native immutable collections, no real `Result`/HKTs, and verbosity. **Go: partially** — first-class functions, closures, and generics give you `map`/`filter`/`reduce`, and `(T, error)` is a `Result`-ish idiom, but there's no immutability, no sum types/pattern matching, and the culture prefers explicit loops. So: functional *style* (pure core, immutable-by-convention, effects at edges) is very achievable in both. Pure-FP (effect systems, monad transformers) fights Java's grain and largely fights Go's language and culture. Match ambition to the language.
</details>

**Q60. Is data-oriented design FP or OO?**

<details><summary>Answer</summary>

**Neither.** DOD organizes code around the CPU and cache — structure-of-arrays layouts, tight loops over contiguous hot data — to maximize throughput. It rejects OO's "bundle data with behavior per object," because that scatters hot fields across heap objects and wrecks cache locality. It also doesn't share FP's goals: DOD loops happily **mutate big buffers in place** and don't care about purity or referential transparency. It *coincidentally* echoes FP's "separate data from functions," but for hardware reasons, not reasoning reasons. DOD's allegiance is to the memory hierarchy; treating it as a flavor of either paradigm misses its entire point.
</details>

**Q61. "Pure functions are always better than methods." React.**

<details><summary>Answer</summary>

Overstated. Pure functions are better *for logic you want to test and reason about* — most business rules and calculations. But "always" ignores legitimate cases: a method that **encapsulates and guards mutable state** is the right tool for a stateful entity; an interface method is the right tool when you need **runtime polymorphism over an open set of types**; and effectful operations (I/O) *must* be impure somewhere. The mature stance is "make pure what *can* be pure, push effects and necessary state to the edges" — which keeps methods for what they're good at (encapsulated state, polymorphic dispatch) and functions for what they're good at (transformation logic). Absolutism in either direction is the tell.
</details>

**Q62. If FP is so testable and safe, why isn't everyone using Haskell?**

<details><summary>Answer</summary>

Because language adoption is driven by far more than paradigm purity: existing codebases and talent pools, ecosystem and library maturity, hiring, the learning curve of advanced FP (monads, HKTs), tooling, and the fact that **most of FP's practical value is capturable in mainstream languages** without going all-in. Teams got 90% of the benefit — immutability, pure cores, `map`/`filter`/`reduce`, `Optional`/`Result` — by absorbing FP ideas into Java, C#, Kotlin, Swift, Rust, and JS. The market chose *gradual blending* over *paradigm migration* because the migration cost is high and the marginal benefit over a good blend is modest. That's an economics answer, not a quality one.
</details>

**Q63. A teammate says "we're an OO shop, so no lambdas or immutable types." How do you respond?**

<details><summary>Answer</summary>

Reframe the false dichotomy. Lambdas and immutable value objects aren't "switching to FP" — they're *good OO practice* now. Immutable value objects are core to Domain-Driven Design and eliminate whole classes of aliasing bugs; lambdas are just the Strategy/Command pattern without boilerplate; `Optional` beats `null`. Every major OO language (Java, C#, Kotlin, Swift) added these *because* they make OO code better, not to abandon OO. The mature position isn't "we're an X shop"; it's "we use the tool that makes each piece clearest." I'd show a concrete before/after where an immutable record removed a defensive-copy bug — evidence beats labels.
</details>

**Q64. "We should rewrite our OO monolith in a functional language for the benefits." React.**

<details><summary>Answer</summary>

Skeptical. A paradigm rewrite is among the highest-risk, lowest-ROI moves a team can make: you discard accumulated domain knowledge and battle-tested edge-case handling, halt feature delivery, and bet on a smaller talent pool — all for benefits you can capture *incrementally in place*. The same wins (pure cores, immutability, explicit errors, fewer mocks) come from refactoring toward a functional core inside the existing language, one decision-heavy method at a time, green-to-green. If a *specific* module has a problem the current language genuinely can't address (e.g. fearless concurrency → Rust), rewrite *that module* behind a stable interface — not the monolith. "Rewrite for paradigm purity" is usually dogma wearing an ROI costume.
</details>

**Q65. Both an OO and an FP person call the same code "well-designed." What are they each seeing?**

<details><summary>Answer</summary>

They're seeing the same underlying virtues through different vocabularies: **low coupling and high cohesion**. The OO person sees clear responsibilities, narrow interfaces, encapsulated invariants, and dependency injection at the seams. The FP person sees pure functions with explicit inputs/outputs, immutable data, no hidden state, and composition at the seams. Both are describing code where *each unit does one thing, depends on little, and hides nothing surprising*. That convergence is the deepest lesson of this topic: the paradigms are different routes to the same destination — **decoupled, cohesive, reason-able code** — which is why "no universal winner" doesn't mean "anything goes."
</details>

---

## Rapid-Fire / One-Liners

> Crisp answers; what an interviewer wants in one or two sentences.

**Q66. One-line essence of OO vs. FP?**

<details><summary>Answer</summary>

OO bundles state with the behavior that guards it; FP separates immutable data from the pure functions that transform it.
</details>

**Q67. The Expression Problem in one sentence?**

<details><summary>Answer</summary>

OO makes adding *types* easy and adding *operations* hard; FP makes adding *operations* easy and adding *types* hard — and you can't have both for free.
</details>

**Q68. When OO, when FP — one line each?**

<details><summary>Answer</summary>

OO for stateful entities with identity and "open to new variants"; FP for data-transformation pipelines, calculations, concurrency, and "open to new operations."
</details>

**Q69. Strategy pattern in FP?**

<details><summary>Answer</summary>

A function passed as an argument — the single-method interface *was* a function type all along.
</details>

**Q70. Functional core, imperative shell — one line?**

<details><summary>Answer</summary>

Pure functions make the decisions; a thin impure shell does the I/O based on those decisions.
</details>

**Q71. Is data-oriented design FP or OO?**

<details><summary>Answer</summary>

Neither — it's organized for the CPU cache, mutates buffers freely, and ignores purity.
</details>

**Q72. Can you do real FP in Go?**

<details><summary>Answer</summary>

Functional *style* yes (closures, generic map/filter); full FP no (no immutability, no sum types, and the culture prefers loops).
</details>

**Q73. Faster: virtual dispatch or pattern matching?**

<details><summary>Answer</summary>

Both are ~free when monomorphic/small; megamorphic dispatch is the slow case, and pattern matching is usually more predictable.
</details>

**Q74. Biggest concrete win of immutability?**

<details><summary>Answer</summary>

Lock-free sharing across threads — there's nothing to race on.
</details>

**Q75. Which is the better paradigm?**

<details><summary>Answer</summary>

Wrong question — match the tool to the problem's dominant axis of change and access pattern; blend in practice.
</details>

---

## How to Talk About FP vs OO in Interviews

A few habits separate a strong answer from a partisan recital:

- **Never pick a side unconditionally.** The instant question "which is better?" is a dogma test. Answer "it depends, and here's on what" — stateful identity and new-variant growth lean OO; transformation, calculation, concurrency, and new-operation growth lean FP. Picking a winner with no "for what" is the junior tell.
- **Reach for the Expression Problem.** It's the single most powerful framing for *why* neither wins: the two extensibility axes trade off. Naming it signals you understand the structural reason, not just preferences.
- **Default to the blend.** "Functional core, imperative shell" is the answer to most architecture questions — pure logic that's cheap to test, effects pushed to the edges. Show you'd put rules in pure functions and I/O behind OO adapters.
- **Show you can blend in mainstream languages.** Records + sealed types in Java, `data class` + sealed in Kotlin, `(T, error)` and closures in Go. You don't need Haskell to use FP ideas — and you should say so.
- **Tie performance claims to measurement.** Dispatch cost, immutability allocations, and DOD cache effects are real but small and context-dependent. "Benchmark the hot path; algorithm and layout dominate" beats "FP is slow" or "OO is slow."
- **Know that DOD is neither.** When asked, separate the *performance* axis (DOD, cache layout) from the *reasoning* axis (FP/OO). Conflating them is a common trap.
- **Recognize the convergence.** Good OO and good FP both pursue low coupling and high cohesion. The deepest answer is that they're different routes to *decoupled, cohesive, reason-able code*.

---

## Summary

- The root difference is **where state lives**: OO co-locates mutable state with the behavior that guards it; FP keeps data immutable and separate from the pure functions that transform it. Most other contrasts (dispatch vs. matching, inheritance vs. composition, identity vs. value) follow from this.
- The **Expression Problem** explains why there's no universal winner: OO makes new *variants* easy and new *operations* hard; FP makes new *operations* easy and new *variants* hard. Choose by the axis your domain actually grows along; typeclasses/traits and Visitor are partial escapes with their own costs.
- The dominant practical blend is **functional core / imperative shell**: pure decision logic (cheap to test, easy to reason about) inside a thin OO/imperative shell that performs effects. Functional DDD ("make illegal states unrepresentable") and hexagonal architecture are senior expressions of this.
- You can capture most of FP's value — immutability, pure cores, `map`/`filter`/`reduce`, `Optional`/`Result` — in **Java** (records, sealed types, streams) and partially in **Go** (closures, generics), without adopting a functional language; Scala, Kotlin, and Rust are deliberate blends.
- On performance there is **no universal winner**: monomorphic dispatch and small `switch`es are both nearly free; immutability trades lock contention for allocation (often a concurrency win); **data-oriented design is neither paradigm** — it serves the cache. Measure the hot path; algorithm and data layout dominate.
- The strongest answers are **non-dogmatic**: lead with "it depends on what," name the trade-off, default to the blend, and recognize that good OO and good FP both converge on **low coupling and high cohesion**.

---

## Related Topics

- [`junior.md`](junior.md) — define each paradigm and spot which fits a problem.
- [`middle.md`](middle.md) — hybrid patterns, the Expression Problem, strategy-as-function.
- [`senior.md`](senior.md) — functional core / OO shell at scale, functional DDD, migration.
- [`professional.md`](professional.md) — dispatch cost, immutability GC, DOD cache effects.
- [Effect Tracking](../10-effect-tracking/senior.md) — the pure-core / impure-shell pattern in depth.
- [Composition](../05-composition/middle.md) — why composition beats inheritance, pipelines.
- [Algebraic Data Types](../06-algebraic-data-types/senior.md) — sum types, pattern matching, "make illegal states unrepresentable."
- [Immutability](../03-immutability/professional.md) — persistent structures, structural sharing, GC, concurrency.
- [Pure Functions & Referential Transparency](../02-pure-functions-and-referential-transparency/middle.md) — the reasoning foundation of the functional core.
- [Map / Filter / Reduce](../04-map-filter-reduce/junior.md) — the gateway functional idioms in OO languages.
- [Clean Code → Classes](../../clean-code/09-classes/README.md) — cohesion and SRP, the OO half of "well-designed."
- [Clean Code → Pure Functions](../../clean-code/15-pure-functions/README.md) — pure-function discipline in everyday code.
- [Design Patterns](../../design-patterns/README.md) — many GoF patterns are workarounds for missing first-class functions.