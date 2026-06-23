# OO Abusers — Senior Level

> Focus: architecture-scale OO Abusers, design principles, tooling.

---

## Table of Contents

1. [OO Abusers at architectural scale](#oo-abusers-at-architectural-scale)
2. [SOLID principles and OO Abusers](#solid-principles-and-oo-abusers)
3. [Detection: linters and AST tools](#detection-linters-and-ast-tools)
4. [Pattern matching as scale-up of polymorphism](#pattern-matching-as-scale-up-of-polymorphism)
5. [Inheritance hierarchies — depth limits and review heuristics](#inheritance-hierarchies-depth-limits-and-review-heuristics)
6. [Migrating from Switch Statements at scale](#migrating-from-switch-statements-at-scale)
7. [Capability-based design](#capability-based-design)
8. [Review questions](#review-questions)

---

## OO Abusers at architectural scale

| Code-level OO Abuser | Architectural-level analog |
|---|---|
| Switch Statements | An API gateway / dispatcher with `if (route == "...")` per route, instead of a routing table |
| Temporary Field | A service with mutable global state populated in some endpoints, used by others |
| Refused Bequest | A microservice "extending" a base service via shared base image / shared ORM models, ignoring most of it |
| Alternative Classes | Two microservices solving the same problem with incompatible APIs (often from M&A or org-chart silos) |

### Switch Statements as routing logic

A common architectural form: a dispatcher service with a giant `switch (eventType)` to route to handlers. This is fine if the event types are closed and few. It becomes the smell when:

- The same switch repeats across logging, metrics, validation, and dispatch logic.
- New event types require coordinated edits across multiple services.

**Cure:** event-handler registry. Each handler registers itself; the dispatcher looks up by event type. Adding a handler is a new class + a registry entry, not edits in 5 places.

### Temporary Field at architectural scale

A service that uses Redis or an in-memory cache as "scratch space" — keys exist briefly during multi-step operations. The keys are populated by step 1, consumed by step 2, and stale outside that window. Forgetting to clean up causes bugs.

**Cure:** explicit operation IDs (a transaction/saga ID); keyed under that ID; deletion when the saga completes. State has a defined lifecycle, not "floating in memory."

### Refused Bequest in microservice base classes

A "base service" library that all services extend (custom HTTP server, custom logging, custom metrics). Half the services don't need half the features but inherit them anyway. New services that don't fit the base service's assumptions duplicate it instead of fighting the inheritance.

**Cure:** library composition over base-class inheritance. Each capability is a separate library (`our-logging`, `our-metrics`, `our-tracing`); services pick what they need. Same idea as Replace Inheritance with Delegation, applied at library level.

### Alternative Classes across acquired companies

Acquisition merges two engineering organizations. Each had a `Customer` model, `Order` model, `User` model. The shapes are similar but not identical. Calls into the merged codebase go through both APIs.

**Cure:** the slow, expensive one — a unified domain model + adapters from each legacy world. Driven by the highest-leverage pain point first (the model that touches the most code).

---

## SOLID principles and OO Abusers

Each OO Abuser is roughly the violation of a SOLID principle:

| Principle | Violated by |
|---|---|
| **S**ingle Responsibility | Large Class (Bloaters), Divergent Change (Change Preventers) |
| **O**pen/Closed | **Switch Statements** — adding a variant requires modifying existing code |
| **L**iskov Substitution | **Refused Bequest** — subclass refuses parent's contract |
| **I**nterface Segregation | **Refused Bequest** — implementing an over-broad interface |
| **D**ependency Inversion | Concrete-class dependencies that should be interfaces (often appears as Alternative Classes) |

### Open/Closed in practice

"Open for extension, closed for modification." A switch on type fails this — you must modify the switch to extend with a new type. Polymorphism passes — adding a new subtype doesn't require modifying existing code.

### Interface Segregation

Don't force clients to depend on methods they don't use. A 30-method interface that implementations only partially fill is the smell.

```java
// Bad — too broad
interface Repository<T> {
    T find(Id id);
    void save(T entity);
    void delete(Id id);
    List<T> findAll();
    long count();
    Page<T> findPaged(Pageable pageable);
    List<T> findByQuery(Query q);
    void bulkUpdate(List<T> entities);
}

// Better — segregated by capability
interface Reader<T>     { T find(Id id); }
interface Writer<T>     { void save(T entity); void delete(Id id); }
interface Lister<T>     { List<T> findAll(); long count(); }
interface PagedReader<T> { Page<T> findPaged(Pageable pageable); }

class UserRepository implements Reader<User>, Writer<User>, Lister<User> {
    // doesn't have to implement PagedReader if it's not paged
}
```

ISP cures Refused Bequest at design time.

---

## Detection: linters and AST tools

| Tool | Switch Statements | Refused Bequest | Notes |
|---|---|---|---|
| **SonarQube** | `S1301`, `S2479` (large switch), `S3358` (nested switch) | `S2972` (overrides empty/throw) | Configurable severity |
| **PMD (Java)** | `TooFewBranchesForASwitchStatement`, `MissingDefault`, `SwitchStmtsShouldHaveDefault` | `OverrideBothEqualsAndHashcode` (related) | |
| **IntelliJ inspections** | "Replace switch with sealed type" | "Useless override" / "Throws checked exception" | Quick-fix available |
| **Pylint** | `R5601` (consider-using-with-pattern-matching) | n/a (Python's duck typing) | |
| **golangci-lint** | `gocritic typeSwitchVar`, `exhaustive` (for type switches on sealed-like enums) | n/a | |
| **mypy --strict** | n/a | flags `LiskovViolation` | Subtype must accept supertype's args |

### Custom AST checks

For project-specific OO Abusers:

- **"Same switch repeated"**: AST analyzer that finds two methods with structurally similar `switch` blocks on the same field/expression.
- **"Field nullable in only one method's contract"**: a field set to a non-null value only in one method's body suggests Temporary Field.
- **"Method overrides parent and throws UnsupportedOperationException"**: clear Refused Bequest signal.

### Architecture fitness functions

```java
// ArchUnit: forbid Refused Bequest in our domain types
@ArchTest
static final ArchRule no_refused_bequest =
    methods().that().areAnnotatedWith(Override.class)
             .and().resideInAPackage("..domain..")
             .should(notThrowExceptionType(UnsupportedOperationException.class));
```

---

## Pattern matching as scale-up of polymorphism

Modern languages have given us **algebraic data types** (ADTs): sealed types where the compiler knows the closed set of variants. Pattern matching on ADTs is **not** the Switch Statements smell — it's a different OO/FP fusion.

### Decision matrix

| Use polymorphism (instance method) | Use pattern matching (sealed + switch) |
|---|---|
| The variants share much state | The variants have unrelated state |
| The behavior depends mostly on `this` | The behavior depends on multiple values together |
| The variants change frequently (open) | The variants are stable (closed set) |
| Per-variant code is large | Per-variant code is small |
| You want each variant to encapsulate its rules | You want the rules visible side-by-side at the dispatch site |

In big systems, both coexist — `Shape.area()` is polymorphism (the body is shape-specific); a service-level handler may pattern-match on event type to route to handlers (the dispatch is centralized).

### Java 21 example

```java
sealed interface Event permits OrderCreated, OrderPaid, OrderShipped {}
record OrderCreated(OrderId id) implements Event {}
record OrderPaid(OrderId id, Money amount) implements Event {}
record OrderShipped(OrderId id, TrackingNumber tracking) implements Event {}

void handle(Event e) {
    switch (e) {
        case OrderCreated oc -> notifyWarehouse(oc.id());
        case OrderPaid op -> sendReceipt(op.id(), op.amount());
        case OrderShipped os -> trackShipment(os.id(), os.tracking());
    }  // compiler-verified exhaustive
}
```

This is **not** the Switch Statements smell. The ADT is closed; the pattern match is verified; adding a variant is a compiler error in `handle`, *forcing* the engineer to think about the new case.

---

## Inheritance hierarchies — depth limits and review heuristics

### Depth thresholds

- **1 level** (direct base): fine, common.
- **2 levels**: fine; verify the middle level pulls weight.
- **3 levels**: yellow flag; question whether the levels are honest.
- **4+ levels**: red flag; almost always Refused Bequest somewhere.

Linters like Checkstyle (`ClassDataAbstractionCoupling`) and SonarQube (`S110` "Inheritance tree of classes should not be too deep") enforce this. Default threshold: 5 levels.

### Code-review questions for inheritance

- **Why inheritance and not composition?** "Because the language makes it easier" is a bad answer.
- **Does the subclass honor the parent's contract for *every* method?** If not, push down or refactor.
- **Does the subclass add fields the parent doesn't know about?** Often fine, but check that the fields are conceptually part of the same thing the parent represents.
- **Is the parent meant to be subclassed?** If it has no abstract methods, no protected fields, and no documented extension points, subclassing it may be misuse.

---

## Migrating from Switch Statements at scale

A 200-line switch repeated in 5 methods is non-trivial to migrate. Strategy:

### Step 1 — Strangler fig per variant

Convert one variant at a time to its own class. The switch keeps a `default:` that routes to the legacy code; new variant classes are routed via instanceof. Over time, the switch shrinks.

```java
double area(Shape s) {
    if (s instanceof Circle c) return c.area();        // new
    if (s instanceof Square sq) return sq.area();      // new
    // legacy:
    switch (s.getType()) {
        case "triangle": return ...;  // not yet migrated
        default: throw new UnsupportedOperationException();
    }
}
```

### Step 2 — Repeat for each method

`area`, `perimeter`, `draw` each go through the same migration. Migrate one method at a time, not one variant at a time across all methods — keeps the change small.

### Step 3 — Once all variants are typed, delete the switch

When every variant is a subclass and every method has been migrated, the switch is dead code; delete.

This is the **Tactical Forking** pattern: instead of a big-bang rewrite, individual variants graduate from "string-typed" to "subclassed" gradually.

---

## Capability-based design

A pattern that prevents Refused Bequest by design: instead of inheriting from a base class with many capabilities, declare each capability as a separate interface.

```java
// Capability-based design
interface Drawable { void draw(Canvas c); }
interface Resizable { void resize(double factor); }
interface Serializable { byte[] serialize(); }

class Circle implements Drawable, Resizable {
    public void draw(Canvas c) { ... }
    public void resize(double factor) { ... }
    // doesn't implement Serializable — and doesn't have to
}

class Sprite implements Drawable, Serializable {
    public void draw(Canvas c) { ... }
    public byte[] serialize() { ... }
    // doesn't resize
}
```

Each class declares only what it can do. There's nothing to refuse.

This is also the principle behind **type classes** (Haskell), **traits** (Scala/Rust), and **protocols** (Swift) — fine-grained, opt-in capability declaration.

---

## Review questions

1. **`switch (event.type)` in 12 services. Architectural smell?**
   Yes. Each service has its own copy of the dispatch; adding an event type requires coordinated changes. Cure: shared event interface + handler registry per service. Or, in a more structured architecture, a service mesh / event router that handles dispatch.

2. **Is `extends BaseController` always Refused Bequest?**
   Not always. If `BaseController` provides genuinely shared lifecycle (request parsing, error handling, auth), inheritance is fine. It becomes Refused Bequest when subclasses skip or override most of what `BaseController` provides.

3. **A 50-method `Repository<T>` interface. Refactor?**
   Yes — Interface Segregation. Most repositories don't need all 50 methods. Split by capability (`Reader`, `Writer`, `Searcher`, `BulkOperations`) and let implementations pick. Tools: split the interface; existing implementations declare `implements Reader<T>, Writer<T>` with no behavior change.

4. **Open/Closed in 2024 — still relevant?**
   Yes, but its emphasis has shifted. Modern OCP isn't "no modifications ever" but "small set of stable abstractions, many varying implementations." Sealed types + pattern matching let you have *both* explicit dispatch *and* OCP — adding a variant is an explicit compiler-checked change.

5. **Functional languages don't have Switch Statements smell. True?**
   Partially. Functional languages encourage pattern matching as the primary dispatch — and ADTs make it exhaustive and type-safe. But duplicated pattern matches across many functions is still a smell (extract a helper that takes a function-per-case, like `match`-with-callbacks). The smell migrates to a different form.

6. **Microservice "base service" — when is it Refused Bequest?**
   When services pull in more than they use. Sign: services importing the base service but commenting out half the features, or overriding to no-op. Cure: split the base into a-la-carte libraries.

7. **My team has a lint rule "no switch on enum." Reasonable?**
   Too strict. Switching on a sealed enum (especially with exhaustiveness checking) is fine. The smell is *duplicated* switches and *type-code* switches that could be polymorphism. A blanket ban replaces one smell with another (Long Method as code is moved into per-case methods that don't really belong on the enum).

8. **Strangler fig vs. branch-by-abstraction for migrating switches?**
   Strangler fig (gradual instanceof routing) for slow long-term migration. Branch-by-abstraction (introduce an interface, switch implementations behind a flag) for tactical migrations with rollback safety. Both are appropriate; pick by timeline.

9. **A team uses `Optional<T>` heavily and never has null. Does that eliminate Temporary Field?**
   Reduces but doesn't eliminate. A field of type `Optional<T>` that's `Optional.empty()` most of the time and `Optional.of(value)` briefly is still Temporary Field — the optional just makes the absence explicit. The cure is the same: extract a class for the "value is present" state.

10. **Why is the Visitor pattern often a sign of Switch Statements?**
    Visitor *encodes* what would be a switch on type. It's the cure when the language lacks pattern matching but has polymorphism. In Java < 17 (no sealed types), Visitor was the right tool; in Java 21+, sealed + pattern matching is often clearer. Visitor isn't the smell — using it where pattern matching would do is overengineering.

---

> **Next:** [professional.md](professional.md) — runtime cost of polymorphism vs. switch, JIT devirtualization, and pattern-matching internals.
