# Liskov Substitution Principle (LSP) — Interview Questions

> **Category:** [Design Principles → SOLID](../../README.md) — the **L** in SOLID: subtypes must be usable anywhere their base type is expected, without breaking the program.

Conceptual and coding questions, graded junior → professional, plus trick and behavioral questions.

---

## Table of Contents

1. [Junior Questions](#junior-questions)
2. [Middle Questions](#middle-questions)
3. [Senior Questions](#senior-questions)
4. [Professional Questions](#professional-questions)
5. [Coding Tasks](#coding-tasks)
6. [Trick Questions](#trick-questions)
7. [Behavioral Questions](#behavioral-questions)
8. [Tips for Answering](#tips-for-answering)

---

## Junior Questions

### J1. State the Liskov Substitution Principle.

**Answer:** If `S` is a subtype of `T`, objects of type `T` can be replaced with objects of type `S` without breaking the program's correctness. In short: **subtypes must be substitutable for their base types.** It's the **L** in SOLID, from Barbara Liskov (1987).

### J2. What's the difference between IS-A and IS-SUBSTITUTABLE-FOR?

**Answer:** IS-A is the English/categorical test ("a square *is a* rectangle") — it's unreliable. IS-SUBSTITUTABLE-FOR asks "can this stand in everywhere the base type is used, keeping every promise?" LSP cares only about the second. When they disagree (square/rectangle, penguin/bird), substitutability wins and you don't use inheritance.

### J3. Why is `Square extends Rectangle` a problem?

**Answer:** A `Rectangle` promises that `setWidth` and `setHeight` are independent. A `Square` must keep its sides equal, so setting the height also changes the width — breaking that promise. Code written against `Rectangle` (e.g., "set width 5, height 4, expect area 20") gets the wrong answer (16) when handed a `Square`. It compiles but is semantically wrong.

### J4. Why is "implement a method by throwing UnsupportedOperationException" an LSP violation?

**Answer:** The base type's contract says the method *works*. Throwing means the subtype can't keep that promise, so a caller written against the base type crashes when handed the subtype. The subtype isn't substitutable. The fix is to narrow the interface so no subtype is forced to fake a method (ISP).

### J5. Give a classic example of an LSP violation besides Rectangle/Square.

**Answer:** `Penguin extends Bird` where `Bird.fly()` is expected to work — a penguin can't fly, so it either throws or no-ops, breaking callers. Fix: only some birds fly, so `fly()` belongs on a `FlyingBird` type, not `Bird`. Another: a read-only list whose `add()` throws (`Arrays.asList(...)` in Java).

### J6. Does LSP compile-check or runtime-check?

**Answer:** Neither, really — it's a **semantic** rule the compiler doesn't enforce. `Square extends Rectangle` compiles fine; LSP is about whether the program still *behaves correctly* at runtime. "It compiles" and "it implements the interface" do not mean "it's a valid subtype."

### J7. How does `instanceof` in client code relate to LSP?

**Answer:** It's a tell-tale smell. If clients must check `instanceof`/downcast to behave correctly, the subtypes aren't truly substitutable — otherwise one polymorphic call would work for all of them. The type checks are the symptom; a broken contract is the disease.

### J8. Name two ways to fix an LSP violation.

**Answer:** (Any two) Make the types immutable (removes the offending setters); model the real abstraction (a common interface everyone can honor, like `Shape.area()`); narrow the interface so no type fakes a method (ISP); use composition instead of inheritance.

### J9. How does LSP relate to OCP?

**Answer:** OCP lets you extend a system by adding new subtypes without modifying existing code — but that's only *safe* if the new subtypes are substitutable. **LSP is the precondition that makes OCP work.** Without it, adding a subtype silently breaks existing callers.

### J10. Is adding a new method in a subtype an LSP violation?

**Answer:** No. *Adding* capability is always safe — a subtype may do more than the base. LSP only forbids doing *less*: refusing inputs the base accepts, delivering weaker guarantees, or breaking invariants. The asymmetry (add OK, subtract not OK) is the heart of the rule.

---

## Middle Questions

### M1. What are the contract rules a behavioral subtype must obey?

**Answer:** (1) **Preconditions cannot be strengthened** — accept everything the base accepts. (2) **Postconditions cannot be weakened** — deliver everything the base promises. (3) **Invariants must be preserved**. (4) The **history constraint** — no new state transitions the base forbids. Plus variance: covariant returns, no new exceptions. Meyer's compression: **"require no more, promise no less."**

### M2. Which direction may a subtype move a precondition, and which a postcondition?

**Answer:** A precondition may be **weakened** (accept more), never strengthened. A postcondition may be **strengthened** (deliver more), never weakened. The asymmetry: callers were promised the base's precondition as the *most* they'd have to satisfy and the base's postcondition as the *least* they'd receive — the subtype must stay inside those bounds from the caller's perspective.

### M3. What is the history constraint?

**Answer:** A subtype may not permit state changes the supertype's contract forbids — even if every individual method is contract-correct, the *sequence* of allowed mutations must not exceed the base's. The classic case is a **mutable subtype of an immutable type** (adding `setX` to an immutable `Point`): every method might be fine, but it breaks every caller relying on immutability. A per-method check can't catch it; you must reason about states over time.

### M4. What's a real LSP violation in the Java standard library?

**Answer:** `Arrays.asList(...)`, `List.of(...)`, and `Collections.unmodifiableList(...)` return `List`s whose `add`/`remove` throw `UnsupportedOperationException`. `List`'s contract declares `add()` as usable, so these can't keep the contract. The root cause is that `List` is a **fat interface** mixing read and mutation — the direct tie to **ISP**.

### M5. How do covariant returns and contravariant parameters relate to LSP?

**Answer:** An override may return a **narrower** type (covariant) — safe, because it still delivers what was promised (strengthens the postcondition). It may accept a **wider** parameter (contravariant) — also safe (weakens the precondition). Java supports covariant returns directly; it treats widened parameters as overloads, so you usually can't write the contravariant case in practice.

### M6. Why can't a subtype introduce a new checked exception?

**Answer:** It's a postcondition weakening — the method now has a failure mode the base contract never listed, surprising callers who weren't told to handle it. Java enforces this for checked exceptions (won't compile). For unchecked exceptions the compiler won't help, but throwing a surprise `RuntimeException` is still an LSP violation.

### M7. How are LSP and ISP related?

**Answer:** A fat interface *forces* LSP violations: if an interface bundles capabilities no single type can all honor, some implementor must fake a method (throw "unsupported") — an LSP violation. ISP (split the interface so each is small enough to honor fully) prevents LSP violations at the source. They're two views of "honest, honorable contracts."

### M8. What's the single most powerful general cure for LSP violations?

**Answer:** **Immutability.** Most violations live in setters/mutators (Rectangle/Square, mutable Point) and the history constraint. An immutable type has no setters to betray a contract and the simplest possible history (it never changes), so the whole class of violations disappears. Combined with "model the real abstraction," it fixes the canonical cases.

---

## Senior Questions

### S1. What's the difference between structural and behavioral subtyping?

**Answer:** Structural (syntactic) subtyping is what the compiler checks — matching method signatures. Behavioral subtyping is honoring the supertype's *contract* (pre/post/invariants/history). LSP is the behavioral notion. The gap between them — "compiles/implements the interface" vs. "actually behaves like the base type" — is where every LSP bug lives, because no mainstream compiler checks the behavioral part.

### S2. State the Liskov & Wing formal definition and the role of the history constraint.

**Answer:** For any property `φ` provable about objects of type `T`, `φ` must hold for objects of subtype `S`. Decomposed: preconditions no stronger, postconditions no weaker, invariants preserved, **and the history constraint** — `S` introduces no state transition `T` couldn't produce. The history constraint was Liskov & Wing's key addition: substitutability is a property of the type's whole observable behavior *over time*, not its methods in isolation, so a mutable subtype of an immutable type violates LSP even with method-correct contracts.

### S3. How does Design by Contract underpin LSP?

**Answer:** Meyer's DbC formalized pre/post/invariants and derived the **subcontracting rule**: an overriding routine may only weaken the precondition and strengthen the postcondition (invariants accumulate down the hierarchy). LSP *is* that rule seen from the caller's side — a subtype is a subcontractor that must be invisible to a client who signed a contract with the supertype. This is why LSP is properly a **contract rule, not an inheritance rule**: it governs interface implementation, structural typing, and duck typing equally.

### S4. Work the Circle-Ellipse problem and its resolutions.

**Answer:** A mutable `Circle extends Ellipse` must keep its axes equal, so `setA` also changes `b`, breaking `Ellipse`'s "axes are independent" postcondition — identical to Square/Rectangle. The general lesson: **mutability + a subtype constraint = an LSP trap.** Resolutions: make the base immutable (cleanest — no setters to break); drop the hierarchy for a common interface promising only what both honor (`area()`); or model the constraint as a value object so "circle-ness" is data, not a subtype claim.

### S5. Does LSP apply to dynamically typed / duck-typed languages?

**Answer:** Yes — arguably more. Duck typing removes the *syntactic* subtype check but leaves the *semantic* one entirely on the programmer. Passing any object with a `.read()` where a file-like is expected asserts behavioral subtyping; if its `.read()` violates the expected contract, you've broken LSP with zero compiler help. Dynamic languages compensate with contract tests, `typing.Protocol`, and runtime validation — recovering the substitutability guarantees static behavioral checking would provide.

### S6. How do variance annotations in generics encode LSP?

**Answer:** `List<Cat>` is not a subtype of `List<Animal>` in Java (generics are invariant) precisely because allowing it would break LSP — you could `add(new Dog())` to a list that's really `List<Cat>`. `? extends`/`? super` (Java) and `out`/`in` (C#/Kotlin) are the type system encoding LSP's variance rules so the compiler enforces substitutability for parameterized types. Java's covariant *arrays* are the unsound exception — they compile but throw `ArrayStoreException` at runtime, a deliberate LSP hole.

### S7. How would you enforce LSP across a large codebase?

**Answer:** **Contract tests.** Encode the supertype's contract as an abstract/parameterized test suite; make every implementation (and every test double) extend and pass it. A subtype that strengthens a precondition, weakens a postcondition, or throws something new fails CI immediately. It's the closest thing to compiler-enforced behavioral subtyping in a mainstream language — it converts an implicit contract no compiler checks into a green/red signal.

---

## Professional Questions

### P1. How do you catch LSP violations in code review?

**Answer:** They live in a *relationship*, not a diff, so I audit each override against the base contract: stronger precondition? weaker postcondition? new exception? broken invariant or history? And I look for the smells: any override that throws `Unsupported`/`NotImplemented` (instant fail), and any new `instanceof`/downcast in clients. The key question: *"Can this subtype be handed, unannounced, to every existing consumer of the base type?"* If any consumer can't take it, the design is wrong.

### P2. How do contract tests enforce LSP, and do they apply to test doubles?

**Answer:** Codify the abstraction's contract as an abstract test suite every implementation extends and must pass; a non-substitutable subtype fails CI at the door. **Yes — they apply to test doubles.** A mock/stub is a subtype subject to LSP; an over-permissive fake passes your tests while production breaks. Run the fake through the same contract suite as the real implementation, or you get false confidence (green tests, broken prod).

### P3. Walk through refactoring a legacy LSP violation safely.

**Answer:** Characterize current behavior of every base-type caller with tests first (including the broken paths and `instanceof` workarounds). Promote the base contract to a contract test; run subtypes through it — the failures are the prioritized violation list. Cure each: throwing override → split the interface (ISP); mutable Square/Circle → make immutable + common interface; invariant break → widen the base contract or split the type. Remove client `instanceof` *last* (its disappearance proves the fix). Strangle, never big-bang rewrite.

### P4. Why are LSP violations especially dangerous in production?

**Answer:** They pass every normal gate. They compile; they pass unit tests *for the common subtype the author tested*; they pass review because the violation is in the relationship, not either file. Then an uncommon subtype flows through an untested path months later and a "can't happen" exception fires — or a silently-weakened postcondition corrupts data without throwing at all. The defense has to be process (contract tests, review-by-contract, no-throwing-override policy), because the compiler won't help.

### P5. How is API versioning an instance of LSP?

**Answer:** A new API version is a "subtype" of the old contract if old clients keep working. Strengthening a precondition (an optional field becomes required) or weakening a postcondition (a guaranteed field is dropped) breaks every client — the exact class-level rules applied to wire contracts. **LSP is the theory of backward compatibility.** Consumer-driven contract tests (Pact) are contract tests across a network boundary; the [Robustness Principle](../../02-coupling-and-cohesion/07-robustness-principle/professional.md) ("liberal in what you accept") is precondition-weakening made into an interop maxim.

### P6. What team conventions keep subtypes substitutable?

**Answer:** No throwing overrides (split the interface instead — kills the most common violation); a contract test per key abstraction that all impls and doubles must pass; default to immutability for value types; `instanceof` in clients requires justification; composition over inheritance by default; cap inheritance depth; invariant generic collections over covariant arrays. These encode the senior reasoning as policy reviewers cite, not personal preference.

---

## Coding Tasks

### C1. Fix the Rectangle/Square violation (Java).

**Before** — the canonical violation:

```java
class Rectangle {
    protected int width, height;
    void setWidth(int w)  { width = w; }
    void setHeight(int h) { height = h; }
    int  area()           { return width * height; }
}
class Square extends Rectangle {
    @Override void setWidth(int w)  { width = w; height = w; }   // breaks setWidth's postcondition
    @Override void setHeight(int h) { width = h; height = h; }
}
```

**After** — immutable siblings under a common interface:

```java
interface Shape { int area(); }

final class Rectangle implements Shape {
    private final int width, height;
    Rectangle(int width, int height) { this.width = width; this.height = height; }
    public int area() { return width * height; }
}
final class Square implements Shape {
    private final int side;
    Square(int side) { this.side = side; }
    public int area() { return side * side; }
}
```

State the reasoning: the bug was the *claim* that `Square` substitutes for `Rectangle`; immutability removes the offending setters, and `Shape` promises only `area()`, which both honor.

### C2. Spot and fix the precondition-strengthening violation (TypeScript).

```typescript
class Account {
  withdraw(amount: number): void {           // precondition: amount > 0
    if (amount <= 0) throw new Error("amount must be positive");
  }
}
class FixedAccount extends Account {
  withdraw(amount: number): void {           // ❌ stronger precondition
    if (amount % 100 !== 0) throw new Error("must be multiple of 100");
    super.withdraw(amount);
  }
}
```

**Fix:** `FixedAccount` rejects `50`, which `Account`'s contract allows — not substitutable. Either drop the extra rule from this type (it's a *different* abstraction), or model "fixed-denomination" as a separate type/strategy that callers opt into explicitly, so no `Account` consumer is surprised.

### C3. Remove the throwing override (Python → ISP).

**Before:**

```python
class Repository:
    def read(self, id): ...
    def save(self, entity): ...

class ReadOnlyCache(Repository):
    def read(self, id): ...
    def save(self, entity):
        raise NotImplementedError("cache is read-only")   # ❌ LSP violation
```

**After** — split the interface so each type honors all of its contract:

```python
from typing import Protocol

class ReadRepository(Protocol):
    def read(self, id): ...

class WriteRepository(Protocol):
    def save(self, entity): ...

class ReadOnlyCache:                # implements ONLY ReadRepository — nothing to fake
    def read(self, id): ...

class SqlRepository:                # implements both
    def read(self, id): ...
    def save(self, entity): ...
```

Now a write path can't route to `ReadOnlyCache` — it's a type error, not a runtime crash.

### C4. Identify whether this is a valid subtype (Java).

```java
class AnimalShelter { Animal adopt() { return new Animal(); } }
class CatShelter extends AnimalShelter {
    @Override Cat adopt() { return new Cat(); }     // valid or not?
}
```

**Answer:** **Valid.** This is a covariant return type — `Cat` is a subtype of `Animal`, so `adopt()` still delivers (at least) an `Animal` to any caller expecting one. Returning something *more specific* strengthens the postcondition, which is always allowed. Java supports covariant returns directly.

### C5. Fix the mutable-subtype-of-immutable violation (history constraint).

**Before:**

```python
class Point:                       # contract: immutable — safe as a dict key / shared
    def __init__(self, x, y): self._x, self._y = x, y
    @property
    def x(self): return self._x
    @property
    def y(self): return self._y

class MutablePoint(Point):
    def set_x(self, x): self._x = x   # ❌ adds a state transition Point forbids
```

**Fix:** don't subclass. A mutable point is *not* a behavioral subtype of an immutable one — anything caching/keying on a `Point`'s immutability breaks. Make `MutablePoint` a separate type (or, better, keep everything immutable and return a new `Point` for "moves"):

```python
class Point:
    def __init__(self, x, y): self._x, self._y = x, y
    @property
    def x(self): return self._x
    @property
    def y(self): return self._y
    def moved(self, dx, dy): return Point(self._x + dx, self._y + dy)   # new instance, still immutable
```

---

## Trick Questions

### T1. "A square is a rectangle, so `Square extends Rectangle` is correct OOP." True?

**False.** It's true geometrically and false for *substitutability*. A mutable `Square` can't honor `Rectangle`'s promise that width and height vary independently, so it breaks callers. English IS-A ≠ IS-SUBSTITUTABLE-FOR; LSP cares only about the latter.

### T2. "It compiles and implements the interface, so it satisfies LSP." Right?

**No.** That's *structural* subtyping (signatures), which the compiler checks. LSP is *behavioral* subtyping (the contract), which no mainstream compiler checks. `Arrays.asList(...)` implements `List` and compiles, yet violates LSP by throwing on `add()`.

### T3. "Overriding a method to throw is fine if no one currently calls it." Agree?

**No — and it's a production trap.** "No one calls it" is not a contract. Refactors and polymorphic dispatch route calls you didn't anticipate; a generic base-type reference can resolve to the throwing subtype. The contract says the method works; faking it with a throw is an LSP violation regardless of current call sites. Split the interface (ISP).

### T4. "Adding a stricter validation in a subclass makes it safer, so it's good design." Correct?

**No.** A *stricter* validation is a **strengthened precondition** — the subtype rejects inputs the base contract accepts, breaking callers who relied on the base's looser rule. "Safer" for the subtype means "broken" for the caller. The subtype must accept *everything* the base accepts.

### T5. "Dynamic languages have no inheritance checks, so LSP doesn't apply to Python." True?

**Dangerously false.** Duck typing removes the syntactic check but the *semantic* obligation is unchanged — every object passed where another is expected asserts behavioral subtyping. With no compiler help, LSP violations are *easier* to introduce, which is why Python leans on `Protocol`, contract tests, and runtime validation.

### T6. "A mock that accepts more inputs than the real object is fine — it's just a test helper." Agree?

**No.** A test double is a subtype subject to LSP. An over-permissive mock weakens a precondition (or skips an invariant) the real collaborator enforces, so your tests pass against behavior production won't allow — green tests, broken prod. Run doubles through the same contract test as the real implementation.

### T7. Is `List<String>` a subtype of `List<Object>` in Java?

**No** — Java generics are invariant, *because* allowing it would break LSP: you could `add(new Integer(...))` to a `List<Object>` reference that's really a `List<String>`. (Arrays, by contrast, *are* covariant and unsound — `Object[] a = new String[]` compiles but throws `ArrayStoreException` at runtime.) Use `? extends`/`? super` to opt into safe variance.

---

## Behavioral Questions

### B1. Tell me about an LSP violation you found or caused.

**Sample:** "We had a `CachingReadOnlyRepository implements Repository` whose `save()` threw `UnsupportedOperationException` — 'nobody calls save on the cache.' A refactor routed a write through a generic `Repository` reference that resolved to the cache, and a customer's update silently failed in prod with a 500. The cache was never a `Repository`. We split the interface into `ReadRepository`/`WriteRepository`; the bad route became a compile error. My takeaway: 'nobody calls it' is not a contract — the type system routes calls you didn't anticipate."

### B2. Describe a time a test passed but production broke because of a substitutability issue.

**Sample:** "Our `FakeUserStore` accepted duplicate emails; the real store rejected them. Create-user tests passed, but the real store's rejection hit an unhandled path in prod. We started running every test double through the same contract test as the real implementation — the fake failed the 'rejects duplicate email' check immediately. A mock is a subtype too; an over-permissive one gives false confidence."

### B3. How do you push back when a teammate adds a throwing override?

**Sample:** "I ask one concrete question: 'If existing code iterates these as the base type and calls this method, what happens?' Once we see it crashes, I frame it as the interface being too fat and propose splitting it (ISP) so the type only implements what it can honor — citing our 'no throwing overrides' convention so it's policy, not my opinion. The throw isn't a bug in their class; it's a signal the abstraction is wrong."

### B4. When did you choose composition over inheritance for substitutability reasons?

**Sample:** "We wanted to reuse a `Vector`'s storage for a `Stack`. Inheriting would have exposed `Vector`'s `insertAt(index)` on the `Stack`, letting callers violate stack semantics — `Stack` wouldn't be a substitutable `Vector` *and* `Vector`'s contract would leak into `Stack`. We composed instead: `Stack` *holds* a list and exposes only `push`/`pop`. Reuse without a false subtype claim."

### B5. How do you keep subtypes substitutable across a large team over time?

**Sample:** "Make the safe path the default: a contract test per key abstraction that every implementation and test double must pass, a 'no throwing overrides — split the interface' rule, immutability for value types, and `instanceof`-in-clients flagged in review. LSP violations pass compile, unit tests, and casual review, so the only reliable defense is executable contracts plus a review habit of asking 'can this be handed to every existing consumer of the base type?'"

---

## Tips for Answering

1. **Lead with substitutability, not "is-a":** "subtypes must be usable everywhere the base type is, keeping its contract." Stress IS-SUBSTITUTABLE-FOR over IS-A.
2. **Know the contract rules cold:** preconditions can't strengthen, postconditions can't weaken, invariants preserved, history constraint — and Meyer's **"require no more, promise no less."**
3. **Have the canonical examples ready:** Rectangle/Square (postcondition), Penguin/Bird and `Arrays.asList`'s throwing `add` (the unsupported-method anti-pattern), and the mutable-Point history-constraint case.
4. **Say "it compiles ≠ it's substitutable":** LSP is *behavioral* (semantic), not structural — no compiler checks it.
5. **Name the smell and the fixes:** `instanceof`/downcasts in clients → fix the contract via immutability, modeling the real abstraction, narrowing the interface (ISP), or composition.
6. **Connect the principles:** LSP is OCP's safety guarantee; ISP prevents LSP violations at the source; composition is the usual fix.
7. **For senior/pro, mention contract tests** (and that they apply to test doubles), and that **LSP is the theory of backward compatibility** at API/service boundaries.

---

[← Professional](professional.md) · [Design Principles → SOLID](../../README.md) · [Roadmap](../../../README.md)
