# OO Misuse Anti-Patterns — Interview Q&A

> **Category:** [Design Anti-Patterns](../README.md) → **OO Misuse** — *object-orientation applied as procedure-with-classes; the wrong shape for an OO structure.*
> **Covers (collectively):** Anemic Domain Model · BaseBean · Constant Interface · Poltergeist · Object Orgy · Functional Decomposition · Call Super · Magic Container · Flag Arguments · Telescoping Constructor · Fragile Base Class

A bank of 60+ interview questions and answers spanning recognition, design trade-offs, root-cause analysis, and runtime/dispatch/GC implications. Each answer models the reasoning a strong candidate gives — including the trade-offs and the cases where the "anti-pattern" is actually the right call. Use the `<details>` toggles to self-quiz: read the question, answer out loud, then expand.

---

## Table of Contents

1. [Fundamentals / Junior](#fundamentals--junior)
2. [Intermediate / Middle](#intermediate--middle)
3. [Senior — Design Forces, Migration & Boundaries](#senior--design-forces-migration--boundaries)
4. [Professional / Deep — Dispatch, Memory, GC, Toolchain](#professional--deep--dispatch-memory-gc-toolchain)
5. [Code-Reading — Name the Anti-Pattern](#code-reading--name-the-anti-pattern)
6. [Curveballs](#curveballs)
7. [Rapid-Fire / One-Liners](#rapid-fire--one-liners)
8. [How to Talk About Anti-Patterns in Interviews](#how-to-talk-about-anti-patterns-in-interviews)
9. [Summary](#summary)
10. [Related Topics](#related-topics)

---

## Fundamentals / Junior

> Definitions, recognition, and the "why is it bad" reasoning.

**Q1. Name the eleven OO-misuse anti-patterns and give a one-line symptom for each.**

<details><summary>Answer</summary>

- **Anemic Domain Model** — "domain" objects are bags of getters/setters; all behavior lives in service classes.
- **BaseBean** — classes inherit from a utility "Base" class just to reach helper methods, not for real behavioral reuse.
- **Constant Interface** — an interface defines only constants; classes implement it to import the names.
- **Poltergeist** — a short-lived object that exists only to call another object, then vanishes; holds no state.
- **Object Orgy** — objects expose internals so freely (public fields, friend access) that encapsulation is fiction.
- **Functional Decomposition** — an OO program that is really free functions wrapped in a class because the language demands one.
- **Call Super** — the base class requires every subclass to call `super.method()`; forgetting it silently breaks invariants.
- **Magic Container** — `Map<String, Object>` / `dict[str, Any]` passed everywhere; the type system is bypassed and keys are stringly-typed.
- **Flag Arguments** — a boolean parameter flips behavior; the method is really two methods crammed into one.
- **Telescoping Constructor** — an overload chain (`Pizza(size)`, `Pizza(size, crust)`, …) that grows unmanageably.
- **Fragile Base Class** — a change to a base class silently breaks subclasses; the inheritance contract is undocumented and unenforced.

The common thread: each takes an OO mechanism (inheritance, encapsulation, the type system, objects themselves) and uses it for something it wasn't designed for.
</details>

**Q2. What is the Anemic Domain Model, and why did Fowler call it an anti-pattern rather than a style?**

<details><summary>Answer</summary>

An anemic model is one where the "domain objects" hold data (fields with getters/setters) but no behavior — all the business rules live in separate "service" or "manager" classes that reach into the objects to read and mutate them. Fowler's objection is that it has the *cost* of OO (you map objects, you have classes) but none of the *benefit* (encapsulation, behavior next to data). It's procedural code wearing an object costume: the service does `if (account.getBalance() < amount) throw…; account.setBalance(account.getBalance() - amount)` instead of `account.withdraw(amount)`. The rule that should be invariant (you can't overdraw) isn't protected by the object that owns the data, so it can be violated anywhere and tends to be duplicated.
</details>

**Q3. What's the difference between a code *smell* and an *anti-pattern* in this category?**

<details><summary>Answer</summary>

A smell is a local observation — "this constructor has nine overloads," "this method takes a `boolean`," "this class only has getters." The anti-pattern is the *recognized shape* those smells form plus the *flawed reasoning* behind it. "A constructor with many overloads" is a smell; "Telescoping Constructor" is the anti-pattern — the shape that results from adding optional parameters by overloading instead of using a builder. The smell points your nose; the anti-pattern names the disease and implies the cure (here, the Builder pattern or named arguments).
</details>

**Q4. Why is a flag argument like `save(true)` bad? Show the fix.**

<details><summary>Answer</summary>

`save(true)` is unreadable at the call site — you can't tell what `true` means without opening the method (`save(force)`? `save(async)`? `save(overwrite)`?). Worse, the method body branches on the flag, so it's really two methods fused into one, and the two halves usually share little. The fix is to split by behavior:

```java
// before
file.save(true);  file.save(false);
// after
file.saveOverwriting();  file.saveIfAbsent();
```

Now the call site reads as a sentence, each method does one thing, and you can't pass a nonsensical combination. If callers genuinely vary one axis at runtime, pass an `enum` (`SaveMode.OVERWRITE`) rather than a `boolean` — a name beats a bit.
</details>

**Q5. What is a Telescoping Constructor and what does the Builder pattern fix about it?**

<details><summary>Answer</summary>

A telescoping constructor is an overload chain where each version adds one more parameter: `Pizza(size)`, `Pizza(size, crust)`, `Pizza(size, crust, cheese)`, and so on. It fails on three counts: call sites become unreadable (`new Pizza(12, "thin", true, false, true)` — which `boolean` is which?), you can't skip a middle parameter you don't care about without supplying the ones before it, and adding an option means another overload. A Builder fixes all three: `Pizza.builder().size(12).crust(THIN).extraCheese().build()` names every argument at the call site, lets you set only what you want in any order, and adds a new option as one new method. (See [Builder pattern](../../../design-patterns/01-creational/03-builder/junior.md).)
</details>

**Q6. What is Object Orgy, and how is it different from just "having public fields"?**

<details><summary>Answer</summary>

Object Orgy is when objects expose so much of their internals — public fields, public mutable collections, `friend`-style access, getters that hand out the live internal list — that encapsulation is a fiction; any object can reach in and change any other's state. A single public field isn't an orgy; the anti-pattern is the *systemic* loss of boundaries, where invariants can't be enforced because anyone can mutate the data behind the object's back. The tell is `order.getItems().add(x)` mutating the order's internal list, or `obj.status = "DONE"` set from three unrelated places. The cure is to tighten visibility, return copies or immutable views, and force changes through methods that protect invariants.
</details>

**Q7. What is the Constant Interface anti-pattern (Java), and what should you use instead?**

<details><summary>Answer</summary>

A Constant Interface is an interface that contains only `static final` constants, which classes `implement` purely to use the constant names unqualified. It's an abuse because `implements` is supposed to declare a *type/behavior contract*, but here it's used as an import shortcut — and it leaks into the class's public API (the constants become part of every subtype's contract forever, even if they're an implementation detail). Effective Java explicitly lists this. Use a `static import` of constants from a non-instantiable `Constants` class, or — better — an `enum` if the constants form a closed set. The shape generalizes beyond Java: any time `is-a` is used to mean "I'd like to borrow these names," it's the same mistake.
</details>

**Q8. What is a Poltergeist?**

<details><summary>Answer</summary>

A Poltergeist is a class whose only job is to appear, invoke a method or two on another object, and disappear — it holds no meaningful state and adds no behavior of its own. Names often give it away: `OrderManager` that only calls `order.process()`, `DataController` that just forwards to a DAO, `StartUp` objects that exist to call other objects' `run()`. It adds a layer of indirection that the reader must hop through for nothing. The fix is to inline the call: have the real caller talk to the real collaborator directly, and delete the ghost.
</details>

**Q9. What is Functional Decomposition as an OO anti-pattern?**

<details><summary>Answer</summary>

Functional Decomposition is when a program designed procedurally (a `main()` that calls functions, which call functions) gets ported into an OO language by wrapping each function in a class — typically a class with one method and no state, named like a verb (`Calculate`, `Validator`, `Processor`). The result has classes but no objects: no meaningful state, no polymorphism, no encapsulation; the "methods" are just functions that happen to live inside a `class` keyword. It's a sign someone is thinking in procedures and fighting the language. The fix depends on the language: in Python or Go, embrace free functions; in a true OO design, rebuild around objects that own state and behavior together.
</details>

**Q10. What is the Call Super anti-pattern?**

<details><summary>Answer</summary>

Call Super is when a base class's design *requires* every overriding subclass to call `super.method()` — usually first or last — for the object to work correctly, but nothing enforces it. Forget the call and you silently skip initialization, leave invariants unestablished, or break the lifecycle, with no compiler error. It's fragile because the contract lives in documentation and tribal knowledge, not in the code. The cure is the **Template Method** pattern: make the public method `final` on the base class so it controls the flow and is the only thing that runs `super`-style setup, and expose a separate abstract *hook* (`doInit()`) that subclasses fill in. The base guarantees the order; the subclass can't forget anything.
</details>

**Q11. What is a Magic Container and why is it dangerous?**

<details><summary>Answer</summary>

A Magic Container is a generic, untyped bag — `Map<String, Object>`, `dict[str, Any]`, Android `Bundle`, a JSON blob passed around — used in place of a real type with named fields. It's dangerous because it bypasses the type system: keys are stringly-typed (`map.get("usrId")` typos compile fine and return `null`), the value types are `Object`/`Any` so you cast and pray, there's no documentation of what's actually inside, and the compiler can't tell you when you forgot a field or renamed one. The fix is to define a real struct/class/record with named, typed fields, so the compiler enforces presence and type and the IDE can autocomplete.
</details>

**Q12. What is the Fragile Base Class problem?**

<details><summary>Answer</summary>

The Fragile Base Class problem is that a seemingly safe change to a base class can silently break subclasses that depended on its internal behavior — even though the base class's *public* contract didn't change. The classic example: a base `Collection.addAll()` that internally calls `add()`; a subclass overrides `add()` to count elements and also overrides `addAll()`; later the base is "optimized" so `addAll()` no longer calls `add()`, and the subclass's count silently breaks. Inheritance exposes implementation details (the *self-call* structure) as an implicit contract that the base author never meant to promise and can't see. The cures: favor composition over inheritance, mark classes `final` by default, and where inheritance is intended, document and enforce the contract via template methods with explicit hooks.
</details>

**Q13. Why is "it works and the tests pass" not a defense for these designs?**

<details><summary>Answer</summary>

"Works + passes tests" measures correctness *today*. These anti-patterns are taxes on *change* and *safety*, paid later. An anemic model lets the next developer violate an invariant from a new call site; a Magic Container lets a typo'd key ship to production undetected; a Call Super hierarchy breaks the next subclass someone adds; a Fragile Base Class breaks at a distance when the base is "improved." None of those show up in green tests on the current code — they show up as bugs and slow edits in the future, which is precisely the cost that matters because code is changed far more often than it's written once.
</details>

**Q14. Encapsulation in one sentence — and which anti-patterns here violate it most directly?**

<details><summary>Answer</summary>

Encapsulation means an object hides its internal state and exposes behavior that keeps that state valid, so callers can't put it into an illegal configuration. **Object Orgy** violates it head-on (internals are public), **Anemic Domain Model** violates it by intent (state is public via getters/setters, behavior lives elsewhere), and **Magic Container** sidesteps it entirely (there's no object to encapsulate anything — just a bag of fields).
</details>

---

## Intermediate / Middle

> When each design emerges, what to do instead, and the trade-offs.

**Q15. Nobody decides "I'll write an anemic model." How does it actually happen?**

<details><summary>Answer</summary>

Two common paths. First, **ORM/serialization framing**: tools generate or favor classes that are pure field-holders (JPA entities, structs that map to JSON), so developers treat them as data carriers and put the logic "somewhere else." Second, **layered-architecture dogma misread**: "business logic goes in the service layer" gets taken literally, so the entity is left behaviorless and the service does everything. Each step feels like following convention. The middle skill is noticing that a rule belonging to the data (an invariant) is being enforced *outside* the object, and moving it back in — turning `service.withdraw(account, amt)` into `account.withdraw(amt)`.
</details>

**Q16. When is a flag argument actually acceptable?**

<details><summary>Answer</summary>

When the boolean is genuine *data the method operates on*, not a *switch that picks one of two behaviors*. `new Rectangle(width, height, filled)` — `filled` is a property of the rectangle, fine. `circle.draw(antialiased)` is borderline. The anti-pattern is specifically the *behavior-selecting* flag: `save(boolean overwrite)` where the two paths share almost no code. A useful test: would the two values run substantially different code and would the call site read better as two named methods? If yes, split. Also acceptable: a flag on a private/internal helper where readability at the (single) call site isn't a public concern, or when matching an external API you don't control. As always, an `enum` beats a `boolean` the moment the axis might gain a third value.
</details>

**Q17. Composition over inheritance — does that mean always composition?**

<details><summary>Answer</summary>

No. "Favor composition" is a default, not an absolute. Inheritance is the right tool when there's a true `is-a` relationship *and* a genuine substitutability contract (Liskov holds): a `SavingsAccount` is-an `Account`, a `SquareButton` is-a `Button`. It's also fine for sealed template-method hierarchies you control end to end. The rule exists because inheritance is *overused* for the wrong reasons — code reuse (that's BaseBean), or "it's convenient to extend." Inheritance couples subclass to base implementation (Fragile Base Class) and is hard to change; composition couples only to an interface and is swappable. So: use inheritance for genuine polymorphic substitution within a contract you own; reach for composition/delegation for reuse.
</details>

**Q18. How do you tell BaseBean inheritance from legitimate inheritance in review?**

<details><summary>Answer</summary>

Ask *why* the subclass extends the base. If the answer is "to be usable wherever the base type is expected" (polymorphic substitution — callers hold a `Base` reference and pass any subclass), that's legitimate. If the answer is "to get access to `log()`, `getConfig()`, `formatDate()`" — utility methods the subclass calls but that have nothing to do with the base's *type* — that's BaseBean: inheritance used as a shared-utilities shortcut. The smell is a base class named `BaseSomething` whose subclasses are wildly unrelated (a `BaseController` extended by things that aren't controllers) and that's never used polymorphically. Fix: move the utilities to free functions or an injected helper, and drop the inheritance.
</details>

**Q19. When is the Builder pattern overkill?**

<details><summary>Answer</summary>

When the object has few parameters, no optional ones, and no construction-time validation worth centralizing. A `Point(x, y)` or `Money(amount, currency)` does not need a builder — a plain constructor is clearer and the builder is just ceremony (more code, an extra mutable intermediate object, an easy-to-forget `build()`). Builders earn their keep when there are many parameters (roughly 4+), several optional, parameters of the same type that are easy to transpose, or invariants to check before the object exists. In languages with **named/default arguments** (Python, Kotlin, C#), the builder is usually redundant even then — `Pizza(size=12, crust=THIN, cheese=True)` already gives readability and optionality. The Builder is a workaround for a language missing named arguments; don't cargo-cult it where the language already solved the problem.
</details>

**Q20. What do you do instead of a Magic Container when the shape really is dynamic?**

<details><summary>Answer</summary>

First, question whether it's truly dynamic — most "we don't know the fields" claims are actually a known, finite set the author didn't want to type out. If the fields are known, define a real type (struct/record/dataclass). If there's a fixed set of *variants*, use a tagged union / sealed hierarchy / `enum`-with-data so the compiler still checks each case. Genuinely open-ended data (arbitrary user-supplied JSON, a plugin's opaque payload) is the legitimate place for a map — but confine it to the boundary: parse the untyped blob *once* into a typed object at the edge, and let the rest of the system work with the type. The anti-pattern is the map flowing *through* the whole codebase, not its existence at the edge.
</details>

**Q21. How does the Template Method pattern fix Call Super, concretely?**

<details><summary>Answer</summary>

Call Super relies on the subclass to remember to invoke the base. Template Method *removes the choice*: the base owns the algorithm and the subclass only fills holes.

```java
// Call Super (fragile): subclass MUST remember super.onInit()
abstract class Widget { void onInit() { registerMetrics(); } }
class MyWidget extends Widget {
    @Override void onInit() { super.onInit(); /* if forgotten, metrics break */ }
}

// Template Method (safe): base controls flow, hook is separate & abstract
abstract class Widget {
    final void init() { registerMetrics(); doInit(); }  // base guarantees order
    protected abstract void doInit();                     // subclass can't skip setup
}
class MyWidget extends Widget { protected void doInit() { /* just my part */ } }
```

`init()` is `final`, so the base always runs `registerMetrics()`; the subclass implements `doInit()` and literally cannot forget the `super` call because there's no `super` call to forget.
</details>

**Q22. An anemic model has all logic in services. What's the migration toward a richer model?**

<details><summary>Answer</summary>

Move *invariant-protecting* behavior into the entity, one rule at a time. Find a service method that reads an entity, decides something based on its state, and mutates it (`if (acc.getBalance() < amt) throw…; acc.setBalance(acc.getBalance()-amt)`), and replace it with a method on the entity (`acc.withdraw(amt)`) that owns the check and the mutation, then narrow the setters/getters that allowed the external mutation. Keep *orchestration* (transactions, talking to repositories, sending email) in the service — that's the service's real job. The end state is a "rich enough" model: entities guard their own consistency, services coordinate entities and infrastructure. Do it behind tests, incrementally; you don't need to purge every getter to get the safety benefit.
</details>

**Q23. How do you detect Object Orgy in a Go codebase specifically?**

<details><summary>Answer</summary>

Go's visibility is package-level (exported = capitalized), so the tells differ from Java. Look for: structs with all-exported fields passed across package boundaries where invariants matter; methods that return a slice or map that's the struct's *own* backing storage (callers can `append`/mutate it behind the owner's back); and "constructors" that exist but are bypassed because callers can build the struct literal directly. The Go-idiomatic fixes: keep fields unexported and expose methods; return *copies* of slices/maps or read-only views; and make the zero value either valid or impossible to misuse, nudging callers through your constructor. Note Go leans toward simple data structs by design — the orgy is specifically when an *invariant-bearing* type leaks mutable internals.
</details>

**Q24. Diagnose and fix this Python class.**

```python
class Order:
    def __init__(self):
        self.items = []
        self.total = 0.0
        self.status = "NEW"

class OrderService:
    def add_item(self, order, item):
        order.items.append(item)
        order.total += item.price
    def pay(self, order):
        if order.status != "NEW":
            raise ValueError("bad state")
        order.status = "PAID"
```

<details><summary>Answer</summary>

**Anemic Domain Model** (plus a touch of Object Orgy — `items`/`total`/`status` are all freely mutable from outside). The `Order` is a data bag; every rule (keep `total` in sync with `items`, only pay a `NEW` order) lives in `OrderService` and can be bypassed by anyone who touches `order.items` or `order.status` directly. Move the invariants into `Order`:

```python
class Order:
    def __init__(self):
        self._items = []
        self._total = 0.0
        self._status = "NEW"

    def add_item(self, item):
        self._items.append(item)
        self._total += item.price

    def pay(self):
        if self._status != "NEW":
            raise ValueError("bad state")
        self._status = "PAID"

    @property
    def total(self): return self._total
```

Now `total` can't drift, you can't pay twice, and the `OrderService` shrinks to orchestration (load, call `order.pay()`, persist) — which may make it a Poltergeist worth inlining.
</details>

**Q25. Diagnose this Java constructor set. What's the fix and the trade-off?**

```java
public Report(String title) { this(title, "A4"); }
public Report(String title, String size) { this(title, size, false); }
public Report(String title, String size, boolean landscape) { this(title, size, landscape, null); }
public Report(String title, String size, boolean landscape, String watermark) { /* ... */ }
```

<details><summary>Answer</summary>

**Telescoping Constructor**, compounded by a **flag argument** (`landscape`). Call sites are unreadable (`new Report("Q3", "A3", true, null)` — what's `true`? what's `null`?) and you can't set `watermark` without supplying `landscape`. Fix with a Builder:

```java
Report r = Report.builder().title("Q3").size("A3").landscape().watermark("DRAFT").build();
```

`landscape()` replaces the opaque `boolean`; each option is named; you set only what you need. **Trade-off:** more boilerplate (the Builder class) and a mutable intermediate object, for far more readable call sites and validatable construction. In Kotlin/Python this would just be default named arguments — no builder needed.
</details>

**Q26. Why is a `Map<String, Object>` returned from a public API worse than one used internally?**

<details><summary>Answer</summary>

Internally, a Magic Container's blast radius is your own codebase — painful but fixable in one PR. At a *public API boundary* it becomes a contract: every consumer now depends on the stringly-typed keys and the untyped values, so you can never safely rename a key, tighten a type, or remove a field without a coordinated breaking change across all clients. You've also pushed the "what's actually in here?" problem onto people who can't read your code. A typed return (a documented struct/DTO) makes the contract explicit, versionable, and tool-checkable on both sides.
</details>

**Q27. When does extracting a Poltergeist actually improve things vs. just removing a useful seam?**

<details><summary>Answer</summary>

Inline a Poltergeist when it has *no state and no decision* — it just forwards a call, so it's pure indirection. But pause if the "ghost" is actually doing something subtle: holding a transaction boundary, adapting between two interfaces, sequencing multiple calls, or providing a substitution seam for tests. Those aren't Poltergeists — they're thin but real collaborators (Facade, Adapter, a test double point). The discriminator: does removing it force the caller to know things or do work it shouldn't? If inlining just deletes a needless hop, do it; if it leaks responsibility back into the caller, the object was earning its keep.
</details>

**Q28. A junior wraps every function in a one-method class "to be object-oriented." How do you coach them?**

<details><summary>Answer</summary>

Name it: that's **Functional Decomposition** — classes without objects. Explain that OO's value is *state + behavior together* and *polymorphism*, neither of which a stateless one-method class provides; it's a function with extra ceremony. Then give the decision rule: if the thing has no state and you'd never have a second polymorphic implementation, it's a function — write a function (or a static method, or a Go free function). Reach for a class when you have invariant-bearing state to encapsulate, or a behavior with multiple interchangeable implementations. "Object-oriented" isn't a synonym for "everything in a class"; it's a synonym for "data and the rules that protect it live together."
</details>

---

## Senior — Design Forces, Migration & Boundaries

> Large-system design, organizational root causes, and when the "anti-pattern" is the right call.

**Q29. Is an Anemic Domain Model *always* wrong?**

<details><summary>Answer</summary>

No — this is the key senior nuance. Anemic *is* the correct shape in several places. **DTOs / wire types** at API and serialization boundaries *should* be dumb field-holders — they carry data across a boundary and have no business invariants; adding behavior to them couples transport to domain. **Read models / projections** in CQRS are intentionally behaviorless query shapes. **Configuration objects** and **value-less data records** are fine anemic. The anti-pattern is specifically an anemic *domain* model — where rich business invariants exist but are enforced *outside* the objects that own the data. Anemic data structures at boundaries are not just acceptable, they're correct; conflating the two is a common junior error in the other direction. Also note: in functional or data-oriented designs (and idiomatic Go), separating data from behavior is a deliberate, valid architecture, not an accident.
</details>

**Q30. What organizational and tooling forces breed these anti-patterns?**

<details><summary>Answer</summary>

Several systemic forces. **ORM/framework defaults** push entities toward anemic field-bags. **Layered-architecture cargo-culting** ("logic goes in services") drains behavior from the model. **Deadline pressure** rewards the cheap `add a boolean flag` over the costlier `split the method`. **Inheritance-for-reuse training** (taught early, rarely un-taught) breeds BaseBean and Fragile Base Class. **Missing language features** (no named args) create Telescoping Constructors; **dynamic-typing comfort** normalizes Magic Containers. And **fear of "too many small classes"** keeps Poltergeists and over-broad services alive. Conway's Law applies too: when no one owns the domain model, behavior scatters into whoever's service touched it last. Durable fixes address the force (templates, lint rules, training, named-arg adoption), not just the instance.
</details>

**Q31. How do you migrate a large hierarchy off a Fragile Base Class safely?**

<details><summary>Answer</summary>

Treat it as a contract-extraction problem. (1) **Pin behavior** with characterization tests across the base and its subclasses, especially around the self-calls that create the fragility. (2) **Discover the real contract** — which base methods do subclasses actually override, and which self-calls do they depend on? That implicit contract is what you must preserve. (3) **Introduce composition at the seam**: extract the varying behavior into a strategy/interface the base *holds* rather than *is*, so subclasses become configuration of a composed object instead of overrides of an inheritance chain. (4) **Or, if inheritance stays**, convert the dangerous overridable methods into a Template Method with explicit `final` flow + abstract hooks, and mark everything else `final` so subclasses can no longer depend on incidental internals. (5) Migrate subclass by subclass, green-to-green. The goal is to turn an *implicit, broad* inheritance contract into an *explicit, narrow* one.
</details>

**Q32. Where is the right place to draw the line between "rich domain object" and "service"?**

<details><summary>Answer</summary>

The object owns logic that depends only on *its own state and arguments* — invariants, state transitions, calculations over its data (`order.total()`, `account.withdraw(amt)`). The service owns logic that *coordinates multiple objects or talks to infrastructure* — fetching from repositories, transactions, sending email, orchestrating a workflow across aggregates. A good test: if a method needs to reach into a database, a clock, an external API, or *several* aggregates, it's orchestration → service. If it only needs `this` and its inputs, it's domain behavior → put it on the object. This keeps the model rich *and* keeps it free of infrastructure dependencies, which is also what makes it unit-testable without mocks.
</details>

**Q33. A team has a `BaseController` everything extends to get `getCurrentUser()`, `log()`, `db()`. How do you unwind it at scale?**

<details><summary>Answer</summary>

That's **BaseBean** — inheritance for utility access, not for polymorphism. Unwind by converting the borrowed utilities into injected dependencies. (1) Identify what subclasses actually pull from the base (`currentUser`, `logger`, `db`). (2) Introduce those as constructor-injected collaborators (or framework-provided context) so a controller *has* a logger rather than *is* a thing with a logger. (3) Migrate controllers one at a time to take the dependencies explicitly and stop extending `BaseController`. (4) When the base is empty, delete it. The payoff: each controller's dependencies become visible in its signature (no Hidden Dependencies), it's testable by passing fakes, and you've removed a Fragile Base Class waiting to happen. Do it incrementally; a codemod can often rewrite the mechanical parts.
</details>


**Q34. When should you *not* refactor one of these anti-patterns?**

<details><summary>Answer</summary>

When the cost outweighs the benefit. Leave an anemic model alone if it's at a **boundary** (DTOs, read models) where anemic is correct, or if the "domain" genuinely has no invariants worth protecting (a CRUD app over flat data is sometimes honestly just data + procedures — forcing rich objects there is over-engineering). Leave a Telescoping Constructor on a **stable, rarely-touched** type whose call sites are few and clear. Don't unwind a base-class hierarchy you can't first cover with characterization tests. And don't replace a working `Map<String, Object>` at a truly dynamic, low-traffic edge just for purity. The senior signal is prioritizing by *change-frequency × pain*, not by how much the design offends you. Refactor where the shape actively blocks upcoming work and you can do it safely.
</details>

**Q35. How do you stop these from re-appearing — beyond fixing the instance?**

<details><summary>Answer</summary>

Make the good shape the path of least resistance and let tooling enforce the boundaries. Concretely: lint rules (no constant interfaces; flag boolean-parameter public methods for review; cap constructor parameter count to nudge builders/named args); a project convention that entities expose behavior and setters are private by default; code-review checklists ("does this new method only need `this`? then it belongs on the object"); architecture-fitness tests (ArchUnit-style) asserting that domain packages don't import infrastructure. Pair that with adopting named/default arguments where the language has them (kills Telescoping Constructors at the source) and templates that scaffold rich entities instead of anemic beans. Education matters too — most of these come from inheritance-for-reuse and "everything in a class" habits learned early.
</details>

**Q36. Constant Interface vs. enum vs. static-import constants — how do you choose?**

<details><summary>Answer</summary>

If the constants form a **closed, related set** of values that represent a type (`Status`, `Direction`, `Currency`), use an `enum` — you get type safety, exhaustiveness checking, and the ability to attach behavior. If they're **unrelated magic numbers/strings** with no shared type (`MAX_RETRIES`, `DEFAULT_TIMEOUT`, `API_PREFIX`), put them on a non-instantiable holder and `static import` them at the few sites that need them. Never use a Constant Interface — implementing an interface to import names pollutes the implementer's public type with constants forever and abuses `is-a`. The decision axis: *is this a type (→ enum) or just shared values (→ static-import constants)?* "Interface" is never the answer for pure constants.
</details>

---

## Professional / Deep — Dispatch, Memory, GC, Toolchain

> Runtime, memory, dispatch, and tooling implications of these designs.

**Q37. Why can a `Map<String, Object>` hurt performance, not just maintainability?**

<details><summary>Answer</summary>

Several concrete costs versus a struct with named fields. **Boxing/autoboxing:** primitives stored in an `Object`-valued map are boxed (`int` → `Integer`), so every numeric field becomes a heap allocation with pointer indirection, hurting cache locality and adding GC pressure. **Hashing on every access:** `map.get("userId")` computes a string hash and probes a bucket array — far more work than a field-offset load, which is essentially a single instruction. **No field inlining:** the JIT/compiler can lay out a struct's fields contiguously and inline access; a map's entries are scattered `Entry` objects, so you chase pointers and miss cache lines. **Type checks:** each read casts `Object` to the real type, an extra runtime check. **Memory overhead:** a `HashMap` carries per-entry object headers, key strings, and load-factor slack — many times the footprint of a packed struct. For hot paths, replacing a Magic Container with a typed struct is a real, measurable win, not just a cleanliness one.
</details>

**Q38. Does the Anemic vs. rich choice have any runtime cost, or is it purely design?**

<details><summary>Answer</summary>

Mostly design, with second-order runtime effects. A rich model tends to keep behavior as monomorphic instance methods the JIT inlines easily, and keeps data local to the object. An anemic model often produces **chatty getter/setter traffic** — a service reading and writing many fields through accessor calls — which is usually inlined away by the JIT but can defeat optimization if accessors are megamorphic or virtual across many subtypes. The bigger effect is *allocation shape*: anemic designs frequently spawn extra transient objects (DTOs copied between layers, parameter objects) that add GC churn. None of this dominates the design argument, but a strong candidate notes that the rich model often allocates less and inlines better — while being careful not to oversell a micro-effect.
</details>

**Q39. How does deep inheritance (BaseBean / Fragile Base Class) affect method dispatch?**

<details><summary>Answer</summary>

Each level of an inheritance chain adds entries to the vtable/itable and more potential override targets for a call site. A call site that sees only one concrete type is **monomorphic** and gets inlined and devirtualized cheaply; one that sees several subtypes becomes **bimorphic/megamorphic**, and once past the runtime's inline-cache threshold (e.g. HotSpot's polymorphic inline cache, typically a couple of entries before it goes megamorphic) it falls back to a full virtual dispatch with no inlining — measurably slower on hot paths. Deep, wide hierarchies (the BaseBean shape, with many unrelated subclasses sharing a base) are exactly what makes call sites megamorphic. Composition with a small, stable set of implementations keeps call sites near-monomorphic and inlinable. Again: negligible for cold code, real for hot loops.
</details>

**Q40. How can these patterns create memory leaks / retention problems in GC'd runtimes?**

<details><summary>Answer</summary>

A few vectors. **Object Orgy / handed-out internals:** if an object leaks a reference to its internal collection, an outside holder can keep that collection — and transitively the owner's graph — alive long after the owner should be collectible. **BaseBean / fat base classes:** a base class that holds references to many subsystems (a logger, a DB handle, a cache) means *every* subclass instance retains all of them, even subclasses that use none — inflating the retained heap per instance. **Magic Containers** used as long-lived caches (`Map<String, Object>`) are classic leak sites: keys never expire, values are opaque, and nobody can tell what's safe to evict. **Anemic models** copied into many DTO layers create lots of short-lived garbage (pressure, not a leak). The fix in each case is tighter ownership: don't leak internals, inject only what's used, and bound and type your caches.
</details>

**Q41. What's the toolchain/build impact of Constant Interfaces and fat base classes?**

<details><summary>Answer</summary>

A Constant Interface bakes its constants into every implementer's class file at compile time (constant inlining), so changing a value requires **recompiling every class that implemented the interface**, not just re-linking — a recompilation magnet, and a versioning hazard if implementers ship in other artifacts (they keep the old inlined value until rebuilt). A fat base class is similarly a **recompilation hub**: because the whole hierarchy depends on it, touching it invalidates the build cache for every subclass, turning trivial edits into wide rebuilds. Both widen the change blast radius. Narrow, composed dependencies (inject a small interface, static-import only what you use) shrink each change's recompilation cone and keep incremental builds fast.
</details>

**Q42. What tools would you use to *quantify* these anti-patterns in a real codebase?**

<details><summary>Answer</summary>

- **Anemic model / cohesion:** LCOM and method/field-usage metrics (SonarQube), or a script flagging classes that are >80% getters/setters with no other behavior.
- **Flag arguments:** lint rules (PMD `BooleanParameter`, custom AST checks) flagging `boolean` parameters on public methods.
- **Telescoping Constructor:** parameter-count and constructor-overload-count checks (Checkstyle `ParameterNumber`).
- **Magic Container:** grep/AST for `Map<String, Object>`, `dict[str, Any]`, `interface{}`/`any` flowing through signatures; type-coverage tools (mypy `--disallow-any-explicit`) surface untyped bags in Python.
- **Inheritance depth / Fragile Base / BaseBean:** DIT (Depth of Inheritance Tree) and NOC metrics; ArchUnit/Konsist tests asserting hierarchy rules.
- **Constant Interface:** static analysis — Error Prone has a check for it directly.

The principle holds: tools surface candidates; engineering judgment confirms (e.g. an anemic DTO at a boundary is a *correct* hit to dismiss).
</details>

---

## Code-Reading — Name the Anti-Pattern

> You're shown a snippet; identify the anti-pattern(s) and state the fix.

**Q43. Which anti-pattern, and what's the fix?**

```java
public interface AppConstants {
    int MAX_RETRIES = 3;
    String API_PREFIX = "/v1";
    long TIMEOUT_MS = 5000;
}
public class HttpClient implements AppConstants { /* uses MAX_RETRIES, TIMEOUT_MS */ }
```

<details><summary>Answer</summary>

**Constant Interface.** `HttpClient` implements an interface solely to import the constant names — abusing `is-a` as an import shortcut and permanently leaking these constants into `HttpClient`'s public type. Fix: a non-instantiable holder plus static-import, or an enum if they form a type:

```java
final class AppConstants { private AppConstants() {}
    static final int MAX_RETRIES = 3; static final long TIMEOUT_MS = 5000; }
// in HttpClient:  import static AppConstants.*;
```
</details>

**Q44. Which anti-pattern, and what's the fix?**

```go
type Config struct {
    Settings map[string]interface{}
}
func (c *Config) Port() int { return c.Settings["port"].(int) }   // panics on typo or wrong type
```

<details><summary>Answer</summary>

**Magic Container.** `Config` is a stringly-typed bag of `interface{}`; `Settings["prot"]` typos compile fine, and the `.(int)` assertion panics at runtime on a missing or wrong-typed key. Fix: a real typed struct, parsed once at the edge:

```go
type Config struct {
    Port    int
    Timeout time.Duration
}
// decode JSON/YAML into Config at startup; the rest of the app uses typed fields.
```

Now the compiler checks field names and types, and the IDE autocompletes.
</details>

**Q45. Which anti-pattern, and what's the fix?**

```java
class AuditLog {
    void onEvent(Event e) {
        write(e);
        afterWrite();   // subclasses MUST override and call super.afterWrite()
    }
    protected void afterWrite() { flush(); }
}
```

<details><summary>Answer</summary>

**Call Super** in the making — any subclass that overrides `afterWrite()` must remember to call `super.afterWrite()` or `flush()` silently never runs. Fix with Template Method: make the flow `final` and give subclasses a separate hook they can't forget:

```java
class AuditLog {
    final void onEvent(Event e) { write(e); afterWrite(); flush(); } // base guarantees flush
    protected void afterWrite() {}   // empty hook; subclasses add their part, no super needed
}
```
</details>

**Q46. Which anti-pattern, and what's the fix?**

```python
class InvoiceManager:
    def __init__(self, repo): self.repo = repo
    def generate(self, order_id):
        order = self.repo.get(order_id)
        return Invoice(order).render()
```

<details><summary>Answer</summary>

**Poltergeist.** `InvoiceManager` holds no state of its own and makes no decision — it fetches and forwards. The `Manager` name and the single pass-through method are the tells. Fix: inline it — let the caller obtain the order (or have the repo return one) and call `Invoice(order).render()` directly, then delete the ghost. (Caveat from Q27: if it were holding a transaction boundary or adapting interfaces it would be a real collaborator — but as written it's pure indirection.)
</details>

**Q47. Which anti-pattern(s), and what's the fix?**

```java
public class User {
    public String name;
    public List<Role> roles = new ArrayList<>();
    public int loginAttempts;
}
// elsewhere, scattered across the codebase:
user.loginAttempts++;
user.roles.add(adminRole);
if (user.loginAttempts > 3) { /* lock */ }
```

<details><summary>Answer</summary>

**Object Orgy** (everything public, internals mutated from everywhere) feeding an **Anemic Domain Model** (the rule "lock after 3 attempts" lives outside `User`). Anyone can set `loginAttempts` or mutate `roles` behind the object's back, so the lock invariant can't be trusted. Fix: privatize fields, expose intent-revealing methods that own the invariants, and return a read-only view of roles:

```java
public class User {
    private int loginAttempts;
    private final List<Role> roles = new ArrayList<>();
    public void recordFailedLogin() { if (++loginAttempts > 3) lock(); }
    public List<Role> roles() { return Collections.unmodifiableList(roles); }
    public void grant(Role r) { roles.add(r); }
}
```
</details>

**Q48. Which anti-pattern, and what's the fix?**

```python
def notify(user, email=True, sms=False, push=False, urgent=False):
    msg = build(user, urgent)
    if email: send_email(user, msg)
    if sms:   send_sms(user, msg)
    if push:  send_push(user, msg)
```

<details><summary>Answer</summary>

**Flag Arguments.** Four booleans pack many behaviors into one body; the call `notify(u, True, False, True, True)` is unreadable and lets nonsensical combos through. Fix: model the channels as data and split intent from configuration:

```python
class Channel(Enum): EMAIL = auto(); SMS = auto(); PUSH = auto()

def notify(user, channels: set[Channel], urgent=False):
    msg = build(user, urgent)
    senders = {Channel.EMAIL: send_email, Channel.SMS: send_sms, Channel.PUSH: send_push}
    for ch in channels: senders[ch](user, msg)
```

The channel set is explicit and self-documenting; `urgent` stays a flag because it genuinely modifies the one message-building behavior (per Q16).
</details>

**Q49. Which anti-pattern, and what's the fix?**

```go
type Calculator struct{}
func (Calculator) Add(a, b int) int { return a + b }
func (Calculator) Mul(a, b int) int { return a * b }
// callers: Calculator{}.Add(2, 3)
```

<details><summary>Answer</summary>

**Functional Decomposition.** `Calculator` has no state and no polymorphism — it's two free functions wrapped in an empty struct because someone wanted "a class." In Go that's pure ceremony. Fix: use package-level functions.

```go
func Add(a, b int) int { return a + b }
func Mul(a, b int) int { return a * b }
// callers: Add(2, 3)
```

Reach for a type only when there's state to hold or an interface to satisfy polymorphically.
</details>

**Q50. This snippet shows three anti-patterns at once — name them.**

```java
class ReportJob extends BaseJob {           // BaseJob gives log(), metrics(), config()
    @Override void run() {
        super.run();                        // forget this and scheduling breaks
        var data = new HashMap<String,Object>();
        data.put("rows", query());
        data.put("fmt", "pdf");
        export(data);
    }
}
```

<details><summary>Answer</summary>

**BaseBean** (extends `BaseJob` purely to borrow `log()`/`metrics()`/`config()` utilities, not for polymorphic substitution), **Call Super** (the `super.run()` that scheduling silently depends on), and **Magic Container** (the `HashMap<String,Object>`). Fixes: inject `log`/`metrics`/`config` as dependencies and drop the inheritance; convert `BaseJob.run()` into a `final` template method with a `doRun()` hook so `super` can't be forgotten; and replace the map with a typed `ExportRequest{ rows, format }`. Three OO-misuse patterns, three independent cures.
</details>

---

## Curveballs

> The questions designed to catch glib answers.

**Q51. "OO means everything should be an object with behavior." Agree?**

<details><summary>Answer</summary>

No — that's the over-correction that breeds its own problems. Pure data carriers (DTOs, value records, config, wire types) *should* be behaviorless; forcing behavior onto them couples transport to domain and is its own anti-pattern. And not everything needs to be a class at all — a stateless transformation is a function, and wrapping it in a class is Functional Decomposition. The right rule is narrower: *business invariants belong with the data they protect*; data with no invariants can be a plain structure; stateless logic can be a function. "Everything must have behavior" and "everything is just data" are both wrong; the skill is telling which is which.
</details>

**Q52. Composition over inheritance — so inheritance is always wrong?**

<details><summary>Answer</summary>

No. Inheritance is the right tool for genuine `is-a` relationships with real substitutability (Liskov holds), and for sealed template-method hierarchies you control. The maxim is "*favor* composition" — composition is the better *default* because inheritance is chronically overused for reuse (BaseBean) and creates implementation coupling (Fragile Base Class). But replacing a clean, substitutable polymorphic hierarchy with hand-rolled delegation just to obey the slogan is cargo-culting. Use inheritance for true polymorphic types within a contract you own; use composition for reuse and for swappable behavior. Absolutism in either direction is the junior tell.
</details>

**Q53. When is a flag argument acceptable?**

<details><summary>Answer</summary>

When the boolean is *data the method operates on*, not a *switch selecting one of two behaviors*. `Rectangle(w, h, filled)` — `filled` is a property. `notify(user, urgent=True)` — `urgent` modifies one behavior, fine. The anti-pattern is the behavior-selecting flag (`save(boolean overwrite)`) where the two paths share little and the call site reads as a riddle. Also acceptable on private helpers (no public readability concern) or when mirroring an external API you don't control. And the moment the axis could gain a third value, switch the `boolean` to an `enum` — a name always beats a bit.
</details>

**Q54. When is the Builder pattern overkill?**

<details><summary>Answer</summary>

When the object is small, has no optional parameters, and needs no construction-time validation — a `Point(x, y)` or `Money(amount, ccy)` is clearer with a plain constructor than buried in builder ceremony (an extra mutable object and an easy-to-forget `build()`). Builders earn their place at roughly 4+ parameters, several optional, same-typed args easy to transpose, or invariants to enforce before the object exists. Crucially, in languages with **named/default arguments** (Python, Kotlin, C#), the builder is usually redundant entirely — those languages already give you readable, optional, order-free construction. The Builder is fundamentally a workaround for Java's missing named arguments; don't import it into languages that don't need it.
</details>

**Q55. Why can a `Map<String, Object>` hurt performance?**

<details><summary>Answer</summary>

Because it trades a single field-offset load for hashing, pointer-chasing, boxing, and casting. Each access hashes a string key and probes a bucket; primitive values are boxed into heap objects (allocation + GC pressure + indirection); entries are scattered `Entry` objects with poor cache locality versus a packed struct's contiguous fields; every read casts `Object` to its real type; and a `HashMap` carries per-entry headers and load-factor slack, inflating footprint several-fold. On a hot path, converting the Magic Container to a typed struct is a measurable speedup — so it's a performance argument, not only a cleanliness one.
</details>

**Q56. Isn't an anemic model just fine for a simple CRUD app?**

<details><summary>Answer</summary>

Often, yes — and saying so is a senior signal. If the domain genuinely has *no meaningful invariants* (you store and retrieve flat records with no business rules), then data structures + handlers is an honest, simple design, and forcing rich objects onto it is over-engineering. The Anemic Domain Model is an anti-pattern specifically when there *are* significant business rules but they live outside the objects that own the data, so they can be bypassed and duplicated. The discriminator is "are there invariants to protect?" If not, anemic is fine; if yes, put them on the object. Match the design to the problem, not to dogma.
</details>

**Q57. A teammate says "getters and setters are encapsulation." Are they?**

<details><summary>Answer</summary>

Not by themselves. A getter/setter pair that just exposes a field (`getX()`/`setX()`) provides *syntactic* indirection but zero *encapsulation* — the caller can still read and write the field at will, so no invariant is protected. It's a public field with extra typing. Real encapsulation hides the field and exposes *behavior* that keeps state valid (`account.withdraw(amt)` enforcing a non-negative balance), or at least a setter that validates. A class that is nothing but pass-through getters/setters is the textbook Anemic Domain Model. So: accessors *can* support encapsulation when they guard invariants, but blanket get/set on every field is the opposite of it.
</details>

**Q58. Is a single one-method class always Functional Decomposition?**

<details><summary>Answer</summary>

No. A stateless one-method class is fine — even idiomatic — when it implements an **interface for polymorphic substitution** (a `Strategy`, `Comparator`, `Handler`, or a command object you put in a map/registry), because the value is the *type*, not the state. It's Functional Decomposition only when the class has no state *and* no polymorphic role — when it could be a free function with nothing lost. So the test isn't "one method, no state" alone; it's "does anything ever treat this as one of several interchangeable implementations?" If yes, it's a legitimate strategy; if no, write a function.
</details>

---

## Rapid-Fire / One-Liners

> Crisp answers; what an interviewer wants in one or two sentences.

**Q59. One-line cure for each of the eleven?**

<details><summary>Answer</summary>

Anemic Model → move invariants onto the object. BaseBean → inject the utilities, drop the inheritance. Constant Interface → static-import constants or use an enum. Poltergeist → inline the call, delete the ghost. Object Orgy → privatize fields, expose behavior, return copies/views. Functional Decomposition → use free functions (or add real state/polymorphism). Call Super → Template Method with a `final` flow and an abstract hook. Magic Container → define a typed struct/record. Flag Arguments → split into named methods, or pass an enum. Telescoping Constructor → Builder, or named/default arguments. Fragile Base Class → composition, `final` by default, documented template hooks.
</details>

**Q60. The phrase that signals an Anemic Domain Model?**

<details><summary>Answer</summary>

"The logic goes in the service layer." When *all* the rules live there and the entities are just getters/setters, the model is anemic.
</details>

**Q61. The phrase that signals BaseBean?**

<details><summary>Answer</summary>

"Extend `BaseX` to get the helper methods." Inheritance for utilities, not for polymorphism.
</details>

**Q62. Fastest tell of a Telescoping Constructor at a call site?**

<details><summary>Answer</summary>

A constructor call full of positional `true`/`false`/`null` you can't decode without opening the class.
</details>

**Q63. `is-a` vs `has-a` — which anti-patterns confuse them?**

<details><summary>Answer</summary>

BaseBean and Fragile Base Class use `is-a` (inheritance) where `has-a` (composition/delegation) was meant; Constant Interface uses `is-a` where a plain `import` was meant.
</details>

**Q64. One sentence: what's the root habit behind most OO-misuse?**

<details><summary>Answer</summary>

Reaching for the familiar mechanism (inheritance for reuse, a map for "flexibility," a flag for "just one more case") instead of shaping the design to the problem.
</details>

**Q65. Encapsulation in one sentence, and which anti-pattern most directly violates it?**

<details><summary>Answer</summary>

Hide state, expose behavior that keeps it valid — Object Orgy violates it most directly by exposing internals so anyone can corrupt state.
</details>

**Q66. Builder vs named arguments — one-line rule?**

<details><summary>Answer</summary>

If your language has named/default arguments, prefer them; the Builder mostly exists to fake named arguments in languages (like Java) that lack them.
</details>

---

## How to Talk About Anti-Patterns in Interviews

A few habits separate a strong answer from a textbook recital:

- **Lead with the *cost*, not the label.** Don't just say "that's an Anemic Domain Model." Say *why it hurts* — "the overdraw invariant lives in the service, so any new call site can violate it, and the rule gets copy-pasted." Interviewers want the reasoning, not the vocabulary.
- **Name the case where it's *not* an anti-pattern.** Senior signal is the nuance: anemic is correct for DTOs and read models; inheritance is right for genuine substitutable types; a flag is fine when it's data, not a behavior switch; a one-method class is fine as a strategy. "It depends, and here's on what" beats absolutism.
- **Match the cure to the language.** Builder in Java, named arguments in Kotlin/Python; free functions in Go for Functional Decomposition; `enum` for closed constant sets. Picking the right tool per language reads as real experience.
- **Show you'd migrate *safely*.** Mention characterization tests, incremental green-to-green steps, separating structural from behavioral commits, and Strangler-style hierarchy unwinding. This proves production scars, not just reading.
- **Distinguish "I'd fix this" from "I'd fix it now."** Knowing *when not to refactor* (stable code, boundaries where anemic is right, no test net) is a stronger signal than reflexively "fixing" everything.
- **Go deep when invited.** Megamorphic dispatch and inline-cache limits, boxing and cache locality of Magic Containers, constant-inlining recompilation magnets, GC retention from leaked internals — these show depth past the maintainability story.
- **Avoid purism.** "Everything must be an object with behavior," "never use inheritance," "always use a builder," "getters are encapsulation" are juniorisms. Calibrate to invariants, substitutability, parameter count, and present-day value.

---

## Summary

- The eleven OO-misuse anti-patterns all take an OO mechanism and use it for the wrong thing: **Anemic Domain Model** and **Object Orgy** abandon encapsulation; **BaseBean**, **Call Super**, and **Fragile Base Class** abuse or over-rely on inheritance; **Constant Interface** and **Functional Decomposition** misuse the type/class system; **Magic Container** bypasses the type system; **Flag Arguments** and **Telescoping Constructor** are method/constructor-shape failures; **Poltergeist** is needless object indirection.
- Recognition is the junior bar; the middle bar is knowing *when each emerges* and the language-appropriate countermove (Builder vs named args, Template Method, typed structs, injected utilities); the senior bar is *safe migration at scale*, *root-cause forces*, and *where the "anti-pattern" is actually correct*; the professional bar is the *dispatch, memory, GC, and toolchain* consequences (megamorphic call sites, boxing, retention, recompilation magnets).
- The strongest answers lead with **cost and reasoning**, name the **case where it's not an anti-pattern** (DTOs, substitutable types, data-flags, strategies), match the **cure to the language**, and refactor **safely and incrementally**.
- The recurring curveball insight: judge by **invariants, substitutability, and present-day value** — not by "everything must be an object," "never inherit," or "always use a builder."

---

## Related Topics

- [`junior.md`](junior.md) — recognize each shape and avoid creating it.
- [`middle.md`](middle.md) — when each emerges and the everyday countermoves.
- [`senior.md`](senior.md) — migration at scale, root causes, and when the anemic/inheritance choice is correct.
- [`professional.md`](professional.md) — dispatch, memory, GC, and toolchain implications.
- [`tasks.md`](tasks.md) · [`find-bug.md`](find-bug.md) · [`optimize.md`](optimize.md) — practice the diagnosis and redesign.
- [Design Anti-Patterns overview](../README.md) — how OO Misuse relates to Coupling & State and Abstraction Failures.
- [Clean Code → Objects and Data Structures](../../../clean-code/05-objects-and-data-structures/README.md) — Tell-Don't-Ask, the Anemic Model cure.
- [Clean Code → Classes](../../../clean-code/09-classes/README.md) — cohesion, SRP, and the Interface Segregation Principle.
- [Clean Code → Immutability](../../../clean-code/14-immutability/) — read-only views, the Object Orgy cure.
- [Design Patterns → Creational → Builder](../../../design-patterns/01-creational/03-builder/junior.md) — the Telescoping Constructor cure.
- [Design Patterns → Behavioral](../../../design-patterns/03-behavioral/README.md) — Template Method, the Call Super cure.
- [Refactoring → Code Smells](../../../refactoring/01-code-smells/README.md) — Data Class, Long Parameter List, the smell-level view.
