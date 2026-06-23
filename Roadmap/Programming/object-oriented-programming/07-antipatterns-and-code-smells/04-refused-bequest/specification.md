# Refused Bequest — Specification

This document defines refused bequest precisely enough that two engineers can disagree about a class and resolve it with measurement, not opinion.

## 1. Informal definition

**Refused bequest** occurs when a subclass inherits methods, fields, or invariants from its superclass that it does not want, does not use, or actively contradicts. The subclass "refuses" the inheritance — through empty overrides, `UnsupportedOperationException`, no-op stubs, or hidden narrowing of the contract.

The word "bequest" is deliberate: inheritance in OO is treated as a legal will, where the parent class leaves its protected and public surface area to its children. A refused bequest is a child class that has been left an asset (the inherited API) that it does not want and cannot give back.

## 2. Formal definition

Let `C` be a class with superclass `P`. Let:

- `M(P)` = the set of non-private, non-final methods declared in `P` (or transitively inherited by `P`).
- `O(C)` = the set of methods of `M(P)` that `C` overrides.
- `R(C)` = the subset of `O(C)` whose override body is one of:
  - empty (no statements),
  - a single `throw new UnsupportedOperationException(...)`,
  - a single `throw new AssertionError(...)`,
  - a single `return` with a default value and no use of `this` state,
  - a body that calls `super.foo(...)` and does nothing else.
- `U(C)` = the subset of `M(P)` that `C` *uses* — i.e., references via `super.foo()` or relies on as inherited behavior without overriding.

Then we define two metrics:

### NOM — Number of Overridden Methods

```
NOM(C) = |O(C)|
```

NOM by itself is not a smell. A class that overrides 8 of 10 inherited methods is doing customization, not refusal.

### NORM — Number Of Refused Methods

```
NORM(C) = |R(C)|
```

### Refusal ratio

```
refusal_ratio(C) = |R(C)| / |M(P)|
```

A class **refuses its bequest** when:

```
refusal_ratio(C) >= 0.25
```

or, additionally, when `|R(C)| >= 1` **and** the refused method is part of the supertype's documented contract (i.e., it appears in the Javadoc of `P` as a method callers may rely on).

The second condition matters because a single refused method is enough to break Liskov substitution if it's a method polymorphic callers actually use.

## 3. Thresholds

Empirical thresholds from industrial codebases (drawn from PMD defaults, SonarSource rule configurations, and Lanza & Marinescu's *Object-Oriented Metrics in Practice*):

| Metric             | Healthy | Warning   | Smell      |
|--------------------|---------|-----------|------------|
| NOM(C)             | ≤ 4     | 5–9       | ≥ 10       |
| NORM(C)            | 0       | 1         | ≥ 2        |
| refusal_ratio(C)   | 0       | 0.05–0.25 | > 0.25     |
| inherited_usage    | ≥ 0.5   | 0.25–0.5  | < 0.25     |

`inherited_usage(C) = |U(C)| / |M(P)|` measures how much of the inheritance the subclass actually leverages. Below 25% means the subclass barely uses what it inherits — it should probably compose, not extend.

## 4. Refusal categories

Not all refusals are equal. There are four distinct kinds, each with a different fix:

### Category A — Explicit contract refusal

```java
@Override public void add(E e) {
    throw new UnsupportedOperationException();
}
```

**Fix:** Extract a narrower interface. The subclass is telling you the bequest is wrong.

### Category B — Silent narrowing

```java
@Override public void setBalance(Money m) {
    if (m.isNegative()) return;   // silently refuses negative input
    this.balance = m;
}
```

**Fix:** This is worse than Category A because the refusal is invisible to callers. Throw, or — better — strengthen the parent's contract to disallow the input.

### Category C — Type narrowing refusal

```java
public class Properties extends Hashtable<Object, Object> {
    // documented to require String keys and values,
    // but inherits put(Object, Object) which it cannot remove
}
```

**Fix:** Composition. The parent's type contract is too wide and inheritance cannot remove members.

### Category D — Interface refusal

```java
class ReadOnlyView implements List<E> {
    public boolean add(E e) { throw new UnsupportedOperationException(); }
    // ... refuses every mutator
}
```

**Fix:** Implement a narrower interface (`Collection`? `Iterable`?) instead of `List`. If no narrower interface exists, this is a signal that the standard library is missing one — consider creating your own.

## 5. What is *not* refused bequest

Be precise about the boundary. The following are **not** refused bequests:

1. **Template Method overrides** — empty default implementations in the parent are intentional extension points. Subclasses opting in by overriding and opting out by inheriting the no-op are using the pattern correctly.
2. **Adapter classes** with empty event-handler methods (e.g., `MouseAdapter`) — the parent class exists *specifically* so callers can override only the methods they care about.
3. **Strengthening preconditions in a way that's documented as a subtype contract** — though this is an LSP violation by another name.
4. **Optional operations explicitly documented in the supertype** — `Collection.add` is documented to optionally throw `UnsupportedOperationException`. Subclasses doing so are honoring, not refusing, the bequest.

The distinction in case 4 is subtle but important: the JDK Collections framework chose to make mutation methods optional, which **builds refused bequest into the supertype's contract**. This is widely considered a design mistake (Bloch, *Effective Java* 3e, Item 18, "Favor composition over inheritance") but it is technically not refusal — the supertype gave the subtype permission.

## 6. Detection rules in static analyzers

### SonarJava

| Rule ID | Title | What it catches |
|---------|-------|-----------------|
| `S1185` | Overriding methods should do more than simply call the same method in the super class | `@Override foo() { super.foo(); }` — pure refusal disguised as override |
| `S1186` | Methods should not be empty | Catches empty override bodies |
| `S2638` | Method overrides should not change contracts | Subclass throws an exception the parent doesn't declare |
| `S1190` | Reserved keywords should not be used as identifiers | (Tangentially related — narrowing) |
| `S125`  | Sections of code should not be commented out | Detects refusal by deletion |

### PMD

| Rule | Category | What it catches |
|------|----------|-----------------|
| `EmptyMethodInAbstractClassShouldBeAbstract` | bestpractices | Empty body in abstract class → likely template for refusal |
| `UncommentedEmptyMethodBody` | documentation | Empty methods without explanation |
| `AvoidThrowingNullPointerException` | design | Often paired with UOE in refusals |
| `OverrideBothEqualsAndHashcode` | bestpractices | Partial refusal of `Object` contract |
| `SignatureDeclareThrowsException` | design | Refusing the parent's narrower exception contract |

### Checkstyle

| Check | What it catches |
|-------|-----------------|
| `MissingOverride` | Catches accidental overloads that look like refusals |
| `EmptyBlock` | Empty method bodies |
| `IllegalThrows` | Configurable to ban `UnsupportedOperationException` in production |

### Custom ArchUnit rule for NORM

```java
@ArchTest
static final ArchRule norm_under_threshold = classes()
    .that().areNotInterfaces()
    .and().areNotAnnotatedWith(Deprecated.class)
    .should(haveNormAtMost(1));
```

The implementation of `haveNormAtMost(int)` walks the bytecode, counts overrides whose body matches one of the refusal shapes (empty, single-throw, single-super-call), and compares to the threshold.

## 7. Relation to other metrics

- **LCOM (Lack of Cohesion of Methods)** — high LCOM in a subclass often correlates with refused bequest, because the subclass has two clusters of methods: ones using inherited state and ones refusing it.
- **DIT (Depth of Inheritance Tree)** — refused bequest tends to appear deeper in the tree (DIT ≥ 3). Each level adds bequests the next level may refuse.
- **NOC (Number of Children)** — a parent with many children is more likely to have at least one child that refuses, simply by combinatorics.
- **WMC (Weighted Methods per Class)** — inflated by inherited methods the subclass refuses, since the subclass-as-seen-by-callers exposes them anyway.

## 8. Decision flowchart

```
        Does C override a method of P?
                    |
              yes / no
              /         \
       Look at the body   Not relevant — done.
              |
   +-----------+-----------+
   |           |           |
empty       throws UOE   delegates only to super
   |           |           |
   +-----------+-----------+
              |
              v
          REFUSED — increment NORM(C)
              |
   Is the refused method in P's documented contract?
              |
        yes  /   \ no
            /     \
   LSP violation   Lesser concern; still smell
   — must fix      — fix if NORM ≥ 2 or
                     refusal_ratio > 0.25
```

## 9. Worked example — measuring NORM

```java
abstract class Animal {
    public void breathe()  { /* default */ }
    public void eat()      { /* default */ }
    public void sleep()    { /* default */ }
    public void reproduce(){ /* default */ }
    public abstract void move();
    public void makeSound(){ /* default */ }
}

class Fish extends Animal {
    @Override public void move() { swim(); }
    @Override public void makeSound() {
        throw new UnsupportedOperationException("Fish don't vocalize");
    }
    private void swim() { ... }
}
```

- `M(Animal) = { breathe, eat, sleep, reproduce, move, makeSound }`, so `|M(P)| = 6`.
- `O(Fish) = { move, makeSound }`, so `NOM(Fish) = 2`.
- `R(Fish) = { makeSound }` (single-throw refusal), so `NORM(Fish) = 1`.
- `refusal_ratio = 1/6 ≈ 0.17` — in the warning band.
- `U(Fish)` includes the inherited `breathe`, `eat`, `sleep`, `reproduce` — `|U| = 4`, so `inherited_usage = 4/6 ≈ 0.67`. Healthy.

Verdict: Fish is **borderline**. The single refusal is real (LSP issue if any caller does `for (Animal a : zoo) a.makeSound();`), but the inheritance is otherwise pulling its weight. Fix: split `Vocalizing` into its own interface.

## 10. Canonical sources

The definitions above are operationalizations of claims made in the primary literature. Map each back to its source before citing it in a design review.

### Where the smell is named and the fixes are specified

- **Fowler, *Refactoring: Improving the Design of Existing Code*, 2nd ed. (2018)** is the authoritative catalog. *Refused Bequest* appears in the "Smells" chapter (Ch. 3): "Subclasses get to inherit the methods and data of their parents. But what if they don't want or need what they are given?" Fowler's prescribed refactorings, all defined with mechanics in the same book:
  - **Replace Subclass with Delegate** — convert `extends P` into a field of type `P` (or an interface) and forward only the methods you want. This is the canonical "Replace Inheritance with Delegation" move.
  - **Replace Superclass with Delegate** — the symmetric move when the parent, not the child, is the wrong abstraction (the `Stack extends Vector` case).
  - **Push Down Method** / **Push Down Field** — when a member lives in the parent but only one subclass uses it, move it down so siblings stop inheriting (and refusing) it.
  - **Extract Superclass** / **Extract Interface** — when refusal signals that two classes share *some* behavior, hoist only the shared, wanted part into a new common supertype or a narrower interface.
  - Fowler explicitly notes that a *small* refused bequest (a subclass that doesn't want a few inherited members) is often tolerable; the smell becomes actionable when the subclass refuses the *behavior and the interface*, i.e., it doesn't even want to be substitutable.

### Why refusal of a documented method is an LSP break

- **Liskov & Wing, "A Behavioral Notion of Subtyping," *ACM TOPLAS* 16(6), Nov. 1994** is the formal basis. The subtype requirement (the "subtype methods" rule plus history/invariant constraints) is: for subtype `S` of `T`, every property provable about objects of `T` must hold for objects of `S`. An override that throws `UnsupportedOperationException` where the supertype documents the method as usable *strengthens the precondition* (it now requires "don't call me"), violating the methods rule. This is the precise sense in which §2's "refused method in the documented contract" condition is an LSP violation, not just a stylistic complaint. (The 1994 TOPLAS paper supersedes Liskov's earlier 1988 OOPSLA keynote where the "substitution property" was first stated informally.)

### Why the fix is composition, not a deeper hierarchy

- **Bloch, *Effective Java*, 3rd ed. (2018):**
  - **Item 18 — "Favor composition over inheritance."** Bloch's argument is exactly the refused-bequest cure: inheritance violates encapsulation because the subclass depends on implementation details of the superclass; wrapping (a forwarding class plus a reusable forwarding interface — the *decorator*-style "InstrumentedSet" example) lets you expose only the operations you want. This is the standard Java idiom for Replace Subclass with Delegate.
  - **Item 19 — "Design and document for inheritance or else prohibit it."** The complement: if a class is not designed and documented as a base class, it should be `final` (or have package-private constructors) so no one can refuse its bequest in the first place.
- **Meyer, *Object-Oriented Software Construction*, 2nd ed. (1997)** frames the same constraint through Design by Contract: a redefinition may weaken a precondition and strengthen a postcondition, never the reverse. Throwing on an inherited operation strengthens the precondition and is therefore an illegal redefinition under DbC — the contract-level statement of refused bequest.
- **Gamma, Helm, Johnson, Vlissides (GoF), *Design Patterns* (1994)** — the chapter-one maxim "Favor object composition over class inheritance" and the **Decorator** and **Adapter** patterns are the structural realizations of the delegation fix.

### Numbered reading list

1. Martin Fowler, *Refactoring*, 2nd ed. (2018) — Ch. 3 "Refused Bequest"; refactorings "Replace Subclass with Delegate," "Replace Superclass with Delegate," "Push Down Method/Field," "Extract Superclass," "Extract Interface."
2. Barbara Liskov & Jeannette Wing, "A Behavioral Notion of Subtyping," *ACM TOPLAS* 16(6), 1994 — the subtype methods/invariant/history rules.
3. Joshua Bloch, *Effective Java*, 3rd ed. (2018) — Item 18 (favor composition over inheritance), Item 19 (design for inheritance or prohibit it), Item 20 (prefer interfaces to abstract classes).
4. Bertrand Meyer, *Object-Oriented Software Construction*, 2nd ed. (1997) — Design by Contract and the rules for valid redefinition.
5. Gamma et al., *Design Patterns* (1994) — Decorator, Adapter, and "favor composition over inheritance."
6. Lanza & Marinescu, *Object-Oriented Metrics in Practice* (2006) — the NOM/DIT/WMC metric thresholds referenced in §3.

## Memorize this

> Refused bequest is **measurable**, not a matter of taste. Compute NORM and the refusal ratio; cross-check against PMD, SonarJava, and ArchUnit. If `refusal_ratio > 0.25` or any refused method is in the supertype's documented contract, the smell is real and the fix is to extract a narrower interface or switch to composition.
