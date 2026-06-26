# Subtyping & Liskov Substitution — Professional Level

> **Topic:** [Subtyping & Liskov Substitution](README.md)
> **Focus:** LSP as a force in real systems — diagnosing production bugs that trace to a substitutability break, the engineering refactors (Square/Rectangle, read-only collections, Bird/Penguin), and the API/library design judgment that decides whether a subtype helps or quietly poisons every caller.

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
13. [Summary](#summary)

---

## Introduction

> Focus: **What does an LSP violation actually cost in a running system?** And **how do experienced engineers refactor a broken hierarchy without detonating every caller that already depends on it?**

The theory levels established *what* sound subtyping is and *why* variance encodes it. This level is about the day the theory bills you. LSP violations rarely announce themselves; they ship green, pass the type checker, survive code review, and then surface as a class of bug that is uniquely nasty: **polymorphic code that works for every subtype but one.** The failing path is the rare subtype, often added later by a different team, exercised only under a specific input — so it slips past tests, slips past staging, and pages someone at 3 a.m. when the one bad subtype finally flows through the one piece of code that trusted the base contract.

The professional skill is twofold. First, **diagnosis**: recognizing that a bug is *an LSP violation*, not "a weird edge case in the `Square` class." The tell is always the same shape — generic code, written against a base type, that assumed a contract a subtype silently broke. Second, **remediation under constraint**: you almost never get to delete the hierarchy and start over. You have callers, serialized data, public APIs, and SLAs. The refactors that matter are the ones that restore substitutability *incrementally* — make the type immutable, split the hierarchy, introduce a narrower interface, or remove the subtype relationship entirely while keeping the code reuse via composition.

This level also confronts the uncomfortable reality that **major standard libraries ship LSP violations on purpose** — `Collections.unmodifiableList` is the canonical example — and that being a senior engineer means knowing *when a pragmatic violation is acceptable*, how to fence it, and how to avoid letting it metastasize into your own APIs.

> 🎓 **Why this matters at the professional level:** Your subtyping decisions are load-bearing for years and for people you'll never meet. A covariant interface you publish, a base class you let a team extend, an `is-a` you accepted without checking the contract — each becomes a constraint or a landmine across the whole codebase. The professional doesn't just avoid LSP violations; they design hierarchies where violations are *hard to introduce*, and they can refactor an existing one without breaking the world.

This page covers: the anatomy of an LSP production incident, the three canonical refactors with migration strategy, when a deliberate violation is defensible, API/library design under substitutability, and the organizational practices (review checklists, contract tests) that keep LSP enforced when the compiler won't.

---

## Prerequisites

What you should know before reading this:

- **Required:** Everything in `senior.md` — variance, subsumption, declaration vs use-site variance, the array unsoundness, nominal vs structural.
- **Required:** Real experience maintaining a class hierarchy or a public/internal API with multiple consumers.
- **Required:** Familiarity with how breaking changes propagate (semantic versioning, deprecation, serialized compatibility).
- **Helpful but not required:** Exposure to contract testing or property-based testing.
- **Helpful but not required:** Having debugged at least one "works for everything except this one subclass" bug.

You do **not** need to know:

- New type theory beyond `senior.md` — this level is application, not new formalism.
- Specific framework internals — examples are illustrative, not exhaustive.

---

## Glossary

| Term | Definition |
|------|-----------|
| **Substitutability break** | A runtime defect caused by a subtype that violates its base type's behavioral contract. |
| **Polymorphic blast radius** | The set of all call sites written against a base type that a single bad subtype can poison. |
| **Contract test** | A shared test suite that every subtype of a base type must pass, asserting the behavioral contract the compiler can't. |
| **Refused bequest** | A code smell (Fowler): a subclass inherits methods/data it doesn't want and overrides them to throw or no-op — a classic LSP break. |
| **Tell-Don't-Ask** | Designing so callers command objects rather than query-then-decide, reducing the contract surface that can be violated. |
| **Sealed hierarchy** | A closed set of subtypes (Java `sealed`, Kotlin `sealed`, Rust enums) that the author controls and can verify exhaustively. |
| **Composition over inheritance** | Reusing behavior by holding an object as a field rather than extending it — avoids unwanted substitutability obligations. |
| **Capability interface** | A small interface exposing one ability (`Flyable`, `Readable`) so types implement only contracts they can honor. |
| **Pragmatic violation** | A knowingly-shipped LSP break (e.g. `unmodifiableList`) judged acceptable given constraints, and fenced accordingly. |
| **Defensive base type** | A base class/interface designed so subtypes *can't easily* break it (immutable, minimal, no exposed setters). |

---

## Core Concepts

### 1. The Anatomy of an LSP Production Incident

Every LSP incident has the same three actors:

1. **A base type with an implicit contract.** `Rectangle` promises independent width/height. `List` promises `add` works. `Bird` promises `fly` flies. The contract is often *unwritten* — that's part of the problem.
2. **Generic code that trusts the contract.** A reporting function that resizes any `Rectangle`. A pipeline that calls `list.add(item)`. A migration loop that calls `bird.fly()`. This code is *correct* — it relies only on the base type's promise.
3. **A subtype that breaks the contract, introduced separately.** `Square`, `unmodifiableList`, `Penguin`. Often added months later, by someone who never saw the generic code, who reasoned "a square *is a* rectangle, obviously."

The bug fires only when actor 3's instance flows through actor 2's code. Because that conjunction is rare, the defect evades tests proportional to how rare the bad subtype is on the hot path. The diagnostic signature: **a stack trace through generic, base-typed code, with a concrete subtype at the bottom that violated an assumption the generic code was entitled to make.** Once you learn to see that shape, you stop blaming "the edge case" and start naming "the substitutability break."

### 2. The Square/Rectangle Refactor — Three Real Exits

The canonical violation has three legitimate fixes, chosen by constraints:

**Exit A — Make them immutable.** The break needs mutation (`setWidth`). Remove the setters; "resizing" returns a new instance. Now a `Square` is just a `Rectangle` with `width == height` at construction, and there's no mutator to corrupt the invariant. This is usually the *best* fix when you control the type.

**Exit B — Don't subtype; both implement a common `Shape`.** `Square` and `Rectangle` are siblings under `Shape` (with `area()`), with no inheritance between them. You lose the (false) `Square <: Rectangle` relation you never legitimately had. Code that genuinely needed "a thing with an area" works; code that needed "a mutable rectangle" never gets a square.

**Exit C — Keep inheritance for reuse, drop substitutability.** If `Square` truly needs `Rectangle`'s code, hold a `Rectangle` by composition and expose only `setSide`. The `Square` is not a `Rectangle` subtype; it *uses* one. **Composition over inheritance** in its purest motivation.

The wrong "fix" — making `setWidth` on `Square` throw, or having it adjust height "smartly" — just relocates the violation. There is no override that makes `Square extends Rectangle` sound while both are mutable; the invariant is irreconcilable.

### 3. The Read-Only Collection Problem — A Shipped Violation

`Collections.unmodifiableList(list).add(x)` throws `UnsupportedOperationException`. This **violates LSP**: `List` declares `add`; a caller holding a `List` is contractually entitled to call it; the unmodifiable view strengthens the precondition to "only if mutable" and crashes otherwise. The JDK shipped this knowingly because, pre-generics and pre-`record`, the alternative (a separate `ImmutableList` type that is *not* a `List`) would have fragmented the entire collections API and broken interoperability with every method taking `List`.

The lesson isn't "the JDK was wrong" — it's a documented, conscious trade-off — but **don't copy the pattern blindly**. The principled design, when you have the choice, is a *type-level* split: a read-only supertype that genuinely lacks mutators, with the mutable type as a subtype.

```java
// Principled: the read view has no add() to break.
interface ReadOnlyList<E> { E get(int i); int size(); }
interface MutableList<E> extends ReadOnlyList<E> { void add(E e); }
```

Guava's `ImmutableList`, Kotlin's `List` vs `MutableList`, and C#'s `IReadOnlyList<T>` all take this principled route precisely to avoid the JDK's LSP wart.

### 4. The Bird/Penguin Refactor — Capability Interfaces

`Penguin extends Bird` with a throwing `fly()` is a **refused bequest**: the subtype inherits an ability it can't honor. The fix is to stop putting abilities on a type that not all subtypes possess. Decompose into **capability interfaces**:

```java
interface Bird { void eat(); }
interface Flyable { void fly(); }
interface Swimmable { void swim(); }

class Sparrow implements Bird, Flyable { /* ... */ }
class Penguin implements Bird, Swimmable { /* ... */ }
```

Now no caller can call `fly()` on a `Bird` — they must hold a `Flyable`, and only types that *can* fly are `Flyable`. The contract is enforced by the type system instead of by a hopeful runtime exception. This is the Interface Segregation Principle (the "I" in SOLID) working hand-in-glove with LSP: small, honest interfaces make substitutability breaks structurally impossible.

### 5. When a Pragmatic Violation Is Defensible — and How to Fence It

Sometimes shipping a violation is the right engineering call: a legacy interface you can't change, a third-party base class, an optional capability. The professional move is to **fence** it:

- **Make the violation loud and documented**, not silent. A `throw new UnsupportedOperationException("read-only view")` is at least *loud*; a `Square` silently returning a wrong area is the worse failure mode.
- **Provide a capability probe** so callers can check before they leap: `list instanceof RandomAccess`, `account.canWithdraw(amount)`, a `supportsX()` method. This converts a precondition the caller couldn't know about into one they can test.
- **Confine the blast radius.** Keep the violating subtype away from the generic code paths that would trip it; never hand it to an API that will exercise the broken operation.
- **Write it into the type's documentation as a known deviation**, so the next maintainer doesn't "fix" it by removing the guard.

The judgment is: a violation is defensible when it's *loud, probeable, confined, and documented*. It's indefensible when it's *silent, undetectable, and free to flow anywhere* — which is exactly the Square/Rectangle failure mode.

### 6. Designing Defensive Base Types

The best LSP strategy is to make violations *hard to introduce*. Defensive base types:

- **Are minimal.** Fewer methods = smaller contract = fewer promises a subtype can break. (ISP again.)
- **Are immutable where possible.** No setters, no mutation, no history-constraint problems.
- **Are sealed when the subtype set is closed** (Java/Kotlin `sealed`, Rust enums). A closed hierarchy you control can be *audited* for substitutability exhaustively, and exhaustive `switch`/`match` catches a missed case at compile time.
- **Expose capabilities, not classifications.** Prefer `Comparable`, `Iterable`, `Closeable` (what you can *do*) over deep taxonomic base classes (what you *are*). Capability interfaces are inherently easier to satisfy honestly.
- **Avoid protected mutable state.** Exposing `protected` fields invites subclasses to break invariants the base can no longer guard.

---

## Real-World Analogies

**The franchise contract.** A restaurant franchise (base type) promises every location: same menu, same hours, same quality. A franchisee (subtype) who quietly drops a menu item or closes early has violated the brand contract — and the customer (generic code) who drove across town trusting the brand gets burned. The franchise survives by making the contract explicit and auditing locations (contract tests), not by hoping each owner guesses right.

**The drop-in replacement part.** An auto part stamped "fits all 2018 sedans" must *actually* fit all of them. A part that fits all except one trim level is the LSP bug: the mechanic (generic code) installs it trusting the label, and it fails on the one car it doesn't fit — in the field, not in the shop. Recalls are the production incident.

**The fire exit propped open.** `unmodifiableList` is a fire exit marked "Exit" that's actually welded shut. It satisfies the *sign* (the `List` type) but not the *function* (you can't actually go through it). It's tolerable only because everyone's been told and there's another way out — but it's a violation, and in a real emergency (a caller that genuinely needs `add`) someone gets hurt.

**Hiring for a role vs hiring a person who can do tasks.** Deep inheritance is hiring "a Manager" and assuming all the abilities that implies. Capability interfaces are hiring "someone who can do code review, can mentor, can plan a sprint" — explicit, honest, composable. The second never strands you with a Manager who, it turns out, can't actually do the one thing you needed.

---

## Mental Models

**Model 1 — "Every base type is a contract with strangers, and you're liable for it."** When you let a subtype exist, you're promising every present and future caller of the base type that the subtype is a safe stand-in. Treat that promise as a production liability, because it is.

**Model 2 — "The blast radius is everyone who programmed to the base."** Before adding or accepting a subtype, ask: who calls the base type, and would *any* of them be surprised by this subtype? That set is your blast radius. A wide blast radius plus a silent violation is an incident waiting for a trigger.

**Model 3 — "Loud-and-probeable beats silent-and-wrong."** If you must ship a violation, the worst version is the one that produces a *wrong answer* with no signal (Square's area). A thrown exception is bad; a *checkable* capability (`canX()`) is tolerable; silent corruption is the failure mode that ends in a postmortem.

**Model 4 — "Refactor toward honesty, incrementally."** You rarely get to rewrite a hierarchy. The moves are surgical: make immutable, split into capabilities, introduce a read-only supertype, replace inheritance with composition. Each restores a slice of substitutability without a big-bang break.

**Model 5 — "Make the violation impossible, not forbidden."** A rule in a style guide ("don't break LSP") is weak. A type design where the broken operation *doesn't exist on the type the caller holds* (capability interface, read-only interface, sealed hierarchy) makes the violation impossible to write. Prefer structural enforcement over discipline.

---

## Code Examples

### Example 1: Diagnosing the incident — the tell-tale stack shape

```java
// Generic code, written against the base type, entitled to trust the contract:
class ReportGenerator {
    void renderResized(List<Rectangle> shapes) {
        for (Rectangle r : shapes) {
            r.setWidth(100);
            r.setHeight(50);
            cells.add(r.area());     // base contract: must be 100*50 = 5000
        }
    }
}
// Months later, somewhere far away:
shapes.add(new Square());            // "a square is a rectangle, right?"
// Production: one report cell shows 2500 instead of 5000. No exception. No alert.
// The stack trace, if you even get one, runs through ReportGenerator (base-typed)
// with a Square at the bottom. THAT shape = LSP violation, not "weird edge case."
```

### Example 2: Refactor Exit A — immutability dissolves the violation

```java
public final class Rectangle {
    private final int width, height;
    public Rectangle(int w, int h) { this.width = w; this.height = h; }
    public Rectangle withWidth(int w)  { return new Rectangle(w, height); }
    public Rectangle withHeight(int h) { return new Rectangle(width, h); }
    public int area() { return width * height; }

    public static Rectangle square(int side) { return new Rectangle(side, side); }
}
// No setters -> no invariant to corrupt -> Square is just a construction, not a broken subtype.
// renderResized now uses withWidth/withHeight and CANNOT be sabotaged.
```

### Example 3: Refactor for read-only — the principled split

```java
public interface ReadOnlyList<E> {        // no add(): nothing for a view to break
    E get(int index);
    int size();
}
public interface MutableList<E> extends ReadOnlyList<E> {
    void add(E e);
    void remove(int index);
}

// An immutable implementation is honestly a ReadOnlyList, never claiming add():
public final class FrozenList<E> implements ReadOnlyList<E> { /* ... */ }

// Callers that need to mutate ask for MutableList; callers that read ask for ReadOnlyList.
// No caller can ever call add() on something that will throw — the type system forbids it.
```

### Example 4: Capability interfaces over taxonomy (Bird/Penguin done right)

```java
interface Bird  { void eat(); }
interface Flyable   { void fly(); }
interface Swimmable { void swim(); }

final class Eagle   implements Bird, Flyable             { public void fly()  {/*..*/} public void eat(){} }
final class Penguin implements Bird, Swimmable           { public void swim() {/*..*/} public void eat(){} }

void migrate(List<Flyable> flock) {   // only things that CAN fly are even accepted
    flock.forEach(Flyable::fly);      // no runtime UnsupportedOperationException possible
}
// migrate(List.of(new Penguin()));   // ✗ compile error — Penguin is not Flyable. Good.
```

### Example 5: Fencing a pragmatic violation with a probe

```java
interface PaymentMethod {
    void charge(Money amount);
    boolean supportsRefund();              // capability probe
    void refund(Money amount);             // may throw if !supportsRefund()
}

void issueRefund(PaymentMethod pm, Money amount) {
    if (!pm.supportsRefund()) {            // caller can CHECK before leaping
        queueManualRefund(amount);
        return;
    }
    pm.refund(amount);                     // safe: precondition verified
}
```

The violation (some methods can't refund) is made *probeable* instead of silent, converting an LSP landmine into a checkable precondition.

### Example 6: Contract test — enforcing the behavioral contract the compiler can't

```java
// Every Account subtype must pass this. Run it parameterized over all implementations.
abstract class AccountContractTest {
    abstract Account newAccount(int initialBalance);

    @Test void withdraw_reduces_balance_for_any_positive_amount_up_to_balance() {
        Account a = newAccount(100);
        a.withdraw(80);                       // base contract: 80 is valid, must succeed
        assertEquals(20, a.balance());        // postcondition must hold for EVERY subtype
    }

    @Test void withdraw_never_makes_balance_negative() {  // invariant
        Account a = newAccount(100);
        assertThrows(Exception.class, () -> a.withdraw(150));
        assertTrue(a.balance() >= 0);
    }
}
class SavingsAccountTest extends AccountContractTest { Account newAccount(int b){ return new SavingsAccount(b);} }
class CheckingAccountTest extends AccountContractTest { /* ... */ }
```

A subtype that strengthens a precondition or weakens a postcondition fails the *base type's* contract test — turning LSP from discipline into a CI gate.

---

## Pros & Cons

**Pros of LSP-driven design at scale:**

- **Fewer 3-a.m. incidents.** Hierarchies designed for substitutability don't grow the "works for all but one subtype" defect.
- **Smaller blast radius for change.** Honest base contracts mean adding a subtype doesn't risk every existing caller.
- **The type system carries the contract.** Capability interfaces and read-only splits make whole classes of violation impossible to even write.
- **Cleaner extension story.** New subtypes slot in safely (Open/Closed), and reviewers have a crisp checklist instead of vibes.

**Cons / costs:**

- **More types up front.** Capability interfaces and read/write splits multiply type count; over-applied, they fragment the API.
- **Refactoring legacy hierarchies is expensive and risky.** Callers, serialized data, and public APIs constrain the moves to incremental ones.
- **Pragmatic violations still happen.** You'll inherit and sometimes ship them; the cost is the discipline of fencing and documenting.
- **The behavioral half resists automation.** Variance is compiler-checked; behavioral substitutability needs contract tests you have to write and maintain.

---

## Use Cases

- **Plugin and extension ecosystems.** A published base interface that third parties implement *must* have a tight, documented contract and ideally a contract-test kit, or every plugin is a potential LSP break in your host.
- **Public/library API evolution.** Choosing capability interfaces and read-only supertypes early prevents the JDK-style violation you can never remove from a stable API.
- **Large class hierarchies under many teams.** Sealed hierarchies and contract tests keep substitutability honest when no single person sees all the subtypes.
- **Migrating off a leaky base class.** Replacing inheritance with composition (Exit C) lets you keep behavior while shedding a substitutability obligation you can't honor.
- **Incident response.** Recognizing the "generic code + one bad subtype" signature turns a mystifying intermittent bug into a named, fixable class of defect.

---

## Coding Patterns

**Pattern 1 — Contract-test every base type with multiple implementations.** Make the behavioral contract executable; run it against all subtypes in CI. This is the closest thing to a compiler for the behavioral half of LSP.

**Pattern 2 — Replace classification hierarchies with capability interfaces.** Whenever a base type has a method only *some* subtypes can honor, that method belongs on a capability interface, not the base. Lets the type system reject the bad combination.

**Pattern 3 — Split read and write into separate interfaces.** Hand callers the narrowest interface they need. A reader gets a read-only (covariant-friendly, mutation-free) interface that has no operation to break.

**Pattern 4 — Prefer composition + delegation to subclass inheritance for reuse.** When you want the *code* but not the *substitutability obligation*, hold the base as a field and expose only the operations that stay valid.

```java
final class Square {                 // NOT `extends Rectangle`
    private final Rectangle r;
    Square(int side) { this.r = new Rectangle(side, side); }
    int area() { return r.area(); }  // delegate the reuse; expose no width/height setters
}
```

**Pattern 5 — Seal hierarchies you control and `switch` exhaustively.** A closed subtype set lets the compiler enforce that every case is handled and lets you audit substitutability across a finite, known set.

---

## Best Practices

- **Treat an unwritten base-type contract as a bug.** If you can't state a base type's preconditions, postconditions, and invariants, neither can the people subtyping it — write them down.
- **Default to composition; reach for inheritance only when substitutability genuinely holds.** "Prefer composition over inheritance" exists primarily to prevent LSP violations.
- **Put abilities on capability interfaces, classifications on base types.** `Flyable.fly()`, not `Bird.fly()`. ISP and LSP reinforce each other.
- **Ship read-only as a real supertype, not a throwing view.** Avoid the `unmodifiableList` pattern in your own APIs when you control the design.
- **If you must violate LSP, make it loud, probeable, confined, and documented** — never silent and free-flowing.
- **Add a base-type contract test before you add the second subtype.** The cost is trivial then and enormous after ten subtypes have drifted.
- **In code review, scan for the violation shapes:** an override that throws/no-ops (refused bequest), an override that narrows accepted input, an override that changes a return's meaning, a subtype that adds mutation under an immutable base.

---

## Edge Cases & Pitfalls

- **The "smart" override that hides the break.** A `Square.setWidth` that "helpfully" adjusts height doesn't fix the violation — it makes the wrong answer look intentional and harder to spot. There is no correct override; the relationship is wrong.
- **Serialized-data lock-in.** You can't always split a hierarchy freely: persisted/serialized type tags, ORM mappings, and wire formats may pin the existing inheritance. Plan a migration, not a rename.
- **Liskov violations through equals/hashCode.** A subtype that adds a field but inherits `equals` breaks symmetry/transitivity — a substitutability break in the `Object` contract that corrupts hash-based collections silently.
- **Framework base classes you must extend.** Some frameworks force inheritance (`Activity`, `Servlet`). You inherit their contract and any leeway/violation they permit; keep your override surface minimal and honest.
- **Contract tests that test the implementation, not the contract.** A base-type contract test must assert only what the *base contract* promises. If it asserts subtype-specific behavior, it can't be shared and stops catching violations.
- **Capability-interface explosion.** Over-segmenting into dozens of one-method interfaces fragments the API and burdens implementers. Segment by *coherent capability*, not by individual method.
- **The covariant-array hole in real code.** Legacy `Object[]` APIs and varargs reintroduce the unsound covariance from `senior.md` into production, surfacing as `ArrayStoreException` far from the actual mistake.
- **"It's only internal" complacency.** Internal hierarchies grow callers too. An LSP violation in an internal base type has a blast radius equal to its internal usage — which is often larger than expected by the time it bites.

---

## Summary

- An **LSP violation** has a constant anatomy: a base type with an (often unwritten) contract, **generic code that trusts it**, and a **separately-introduced subtype that breaks it**. The incident fires when the bad subtype flows through the trusting code — a defect that evades tests in proportion to how rare the bad subtype is on the hot path.
- The **Square/Rectangle** break has three legitimate exits: **make it immutable**, **make them siblings under `Shape`**, or **use composition for reuse** without the subtype relation. No override fixes it while both are mutable.
- **`Collections.unmodifiableList`** is a *deliberately shipped* violation; the principled alternative is a **read-only supertype** with no mutators (Guava `ImmutableList`, Kotlin `List`/`MutableList`, C# `IReadOnlyList`).
- **Bird/Penguin** is a **refused bequest**; the fix is **capability interfaces** (`Flyable`, `Swimmable`) so the type system forbids calling an ability a type can't honor — ISP and LSP reinforcing each other.
- A **pragmatic violation is defensible** only when it's **loud, probeable, confined, and documented**; silent-and-free-flowing (Square's wrong area) is the failure mode that ends in a postmortem.
- **Defensive base types** are minimal, immutable, sealed where possible, capability-oriented, and free of exposed mutable state — they make violations *impossible to write* rather than merely forbidden.
- The compiler enforces the **type-level** half (variance, signatures); enforce the **behavioral** half with **contract tests** run against every subtype in CI, and a code-review reflex for the violation shapes.

You've now seen LSP from slogan to type theory to production. The throughline never changes: **subtyping promises an S is a usable T, and LSP is the discipline — backed by immutability, capability interfaces, and contract tests — that keeps the promise true at scale.**
