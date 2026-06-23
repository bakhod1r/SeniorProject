# Refactoring Toward Creational Patterns — Junior Level

> **Source:** Joshua Kerievsky, *Refactoring to Patterns* (Addison-Wesley, 2004); [refactoring.guru/design-patterns/creational-patterns](https://refactoring.guru/design-patterns/creational-patterns)

You already know *what* the creational patterns are — Factory Method, Abstract Factory, Builder, Prototype, Singleton — from the [design-patterns section](../../../design-patterns/01-creational/). This topic is different. It is not "here is a pattern, memorize its UML." It is the **journey**: you start with smelly object-creation code, you notice a specific smell, and you apply a small, mechanical, behavior-preserving sequence of steps that *lands you* on a pattern. The pattern is the destination, not the starting point. That distinction is the whole soul of Kerievsky's book — patterns are something you *evolve toward* because the code demands it, never something you sprinkle on because it looks clever.

This file covers the three creational refactorings you will reach for most often early in your career.

---

## Table of Contents

1. [What "creational" refactorings are](#1-what-creational-refactorings-are)
2. [The smells that drive them](#2-the-smells-that-drive-them)
3. [Refactoring 1: Replace Constructors with Creation Methods](#3-refactoring-1-replace-constructors-with-creation-methods)
4. [Refactoring 2: Encapsulate Classes with Factory](#4-refactoring-2-encapsulate-classes-with-factory)
5. [Refactoring 3: Introduce Polymorphic Creation with Factory Method](#5-refactoring-3-introduce-polymorphic-creation-with-factory-method)
6. [Smell → Refactoring lookup table](#6-smell--refactoring-lookup-table)
7. [Mini glossary](#7-mini-glossary)
8. [Review questions](#8-review-questions)
9. [Next](#9-next)

---

## 1. What "creational" refactorings are

A **creational refactoring** is a behavior-preserving transformation that improves *how objects come into existence*. The behavior of the program after the refactoring is identical — the same objects get built with the same state — but the *creation code* is now clearer, less duplicated, more flexible, or better encapsulated.

Why single out creation at all? Because `new` is a quiet source of rigidity. Every time a class writes `new ConcreteThing()`, it has hard-wired a dependency on a *specific* concrete class. That line cannot be overridden, cannot be swapped for a test double, and cannot vary by configuration. A constructor is also the one method you *cannot* give a meaningful name to — it must be named after the class. When construction gets complicated (many parameters, several legal variants, conditional assembly), the constructor becomes a bottleneck of confusion. Creational refactorings systematically relieve that pressure.

The mechanical-steps framing matters. Each refactoring below is a *recipe*: a numbered list of edits where the code compiles and the tests pass after most steps. You never make a giant leap. You inch toward the pattern, running tests as you go, so that if something breaks you know exactly which step caused it. This is the discipline that separates "refactoring" from "rewriting and hoping."

> A real-world analogy. Think of a hospital. A patient never grabs a random scalpel off a tray and operates on themselves — that is `new Scalpel()` scattered everywhere. Instead there is a **sterile supply department**: you request "a laparoscopic kit" by name, and the department assembles and hands you the right, validated, ready-to-use set of instruments. Creational refactorings move your codebase from "everyone grabs tools off the tray" toward "request what you need, by name, from a place whose job is to build it correctly."

---

## 2. The smells that drive them

You do not apply a creational refactoring because you feel like it. You apply it because you smell something. Here are the creation-specific smells (several map to the broader [code-smells catalog](../../01-code-smells/)).

- **Constructor overload soup.** A class has three or four constructors with the same arity but different meanings. `new Loan(2.5, 1000.0, "C")` — what does that even build? Overloaded constructors cannot tell you. This is a flavor of the [Mysterious Name / Primitive Obsession](../../01-code-smells/01-bloaters/junior.md) family.
- **`new` scattered across clients.** Many different classes do `new MySqlConnection(...)` or `new PremiumCustomer(...)` directly. Each is now coupled to a concrete class; swapping the implementation means hunting down every call site. A coupling smell ([Couplers](../../01-code-smells/05-couplers/junior.md)).
- **Duplicated creation steps in sibling subclasses.** Two subclasses override the same method and the *only* difference is which concrete object they instantiate. The surrounding logic is copy-pasted. A change-preventer ([change-preventers](../../01-code-smells/03-change-preventers/junior.md)).
- **A constructor that does too much** — validating, branching, building collaborators, reading config. The constructor has become a [Long Method](../../01-code-smells/01-bloaters/junior.md) in disguise.
- **Telescoping constructors** — `Pizza(size)`, `Pizza(size, cheese)`, `Pizza(size, cheese, pepperoni)` … a staircase of constructors each delegating to the next (covered in [middle.md](./middle.md)).

When you smell one of these, you reach for a specific recipe. The rest of this file walks through the three foundational ones.

---

## 3. Refactoring 1: Replace Constructors with Creation Methods

### Starting smell

A class exposes multiple constructors that a reader cannot tell apart, or a single constructor whose arguments do not reveal *which kind* of object is being built.

```java
public class Loan {
    private double commitment;   // committed amount
    private double outstanding;  // drawn-down amount
    private int riskRating;
    private Date maturity;
    private Date expiry;

    // A term loan: commitment + maturity, no expiry.
    public Loan(double commitment, int riskRating, Date maturity) {
        this(commitment, 0.0, riskRating, maturity, null);
    }

    // A revolver (revolving line of credit): commitment + expiry, no maturity.
    public Loan(double commitment, int riskRating, Date maturity, Date expiry) {
        this(commitment, 0.0, riskRating, maturity, expiry);
    }

    // A "revolving credit term loan" (RCTL): commitment, outstanding, both dates.
    public Loan(double commitment, double outstanding,
                int riskRating, Date maturity, Date expiry) {
        this.commitment = commitment;
        this.outstanding = outstanding;
        this.riskRating = riskRating;
        this.maturity = maturity;
        this.expiry = expiry;
    }
}
```

Look at the call site:

```java
Loan a = new Loan(1_000_000, 3, maturity);                 // term loan? probably
Loan b = new Loan(1_000_000, 3, maturity, expiry);         // revolver? RCTL? who knows
```

The two constructors differ only by one trailing `Date`. The reader cannot tell a *revolver* from an *RCTL* without opening the class and counting arguments. This is the classic Kerievsky example.

### Motivation

A **Creation Method** is a static method, on the class itself, whose *name* tells you exactly what kind of object you are getting. `Loan.newTermLoan(...)` reads like English. The pattern is the same idea Joshua Bloch promotes in *Effective Java* as **"Consider static factory methods instead of constructors"** (Item 1). Static factories have names; constructors do not. Static factories can return cached or subtype instances; constructors always return a brand-new instance of exactly that class.

### Mechanical steps

1. **Pick one constructor** that builds a distinct, nameable variant.
2. **Add a `public static` creation method** with a descriptive name that calls that constructor. Keep the constructor for now.
3. **Find every caller** of that constructor and redirect it to the new creation method. Compile and run tests after each cluster of edits.
4. **Repeat** steps 1–3 for each remaining distinct constructor.
5. Once no caller invokes the constructors directly, **reduce constructor visibility** to `private` (or package-private if tests in the same package still need it). This forces all future creation through the named methods.

### After

```java
public class Loan {
    private double commitment;
    private double outstanding;
    private int riskRating;
    private Date maturity;
    private Date expiry;

    // Step 5: the constructor is now hidden. Nobody outside can call it.
    private Loan(double commitment, double outstanding,
                 int riskRating, Date maturity, Date expiry) {
        this.commitment = commitment;
        this.outstanding = outstanding;
        this.riskRating = riskRating;
        this.maturity = maturity;
        this.expiry = expiry;
    }

    public static Loan newTermLoan(double commitment, int riskRating, Date maturity) {
        return new Loan(commitment, 0.0, riskRating, maturity, null);
    }

    public static Loan newRevolver(double commitment, int riskRating, Date expiry) {
        return new Loan(commitment, 0.0, riskRating, null, expiry);
    }

    public static Loan newRCTL(double commitment, double outstanding,
                               int riskRating, Date maturity, Date expiry) {
        return new Loan(commitment, outstanding, riskRating, maturity, expiry);
    }
}
```

Now the call site explains itself:

```java
Loan term     = Loan.newTermLoan(1_000_000, 3, maturity);
Loan revolver = Loan.newRevolver(1_000_000, 3, expiry);
Loan rctl     = Loan.newRCTL(1_000_000, 250_000, 3, maturity, expiry);
```

### Resulting pattern

You have arrived at the **static factory method** idiom — a lightweight cousin of [Factory Method](../../../design-patterns/01-creational/01-factory-method/junior.md). You did not (yet) introduce polymorphism; you simply gave construction *names*. That is often all you need.

### When NOT to

- If a class has exactly **one** unambiguous constructor, leave it alone. Wrapping `new Point(x, y)` in `Point.of(x, y)` for no reason is ceremony, not clarity.
- Static factory methods cannot be **subclassed** the way constructors enable subclassing via `super(...)`. If a class is designed to be extended and subclasses must call a public/protected constructor, don't hide it.
- Beware naming bloat: if you would need eight creation methods because the variants are truly combinatorial, that is a hint you actually want a **Builder** (see [middle.md](./middle.md)), not a wall of static factories.

---

## 4. Refactoring 2: Encapsulate Classes with Factory

### Starting smell

Client code scattered across the codebase does `new ConcreteThing()` against several concrete classes that all implement a common interface. The clients are coupled to the concretions even though they only ever use the interface.

```java
public interface Brick { double getVolume(); }

class StandardBrick implements Brick {
    public double getVolume() { return 0.001; }
}
class JumboBrick implements Brick {
    public double getVolume() { return 0.002; }
}

// Clients everywhere do this:
class WallBuilder {
    Brick pick(String kind) {
        if (kind.equals("standard")) return new StandardBrick();
        if (kind.equals("jumbo"))    return new JumboBrick();
        throw new IllegalArgumentException(kind);
    }
}
class ChimneyBuilder {
    Brick pick(String kind) {   // duplicated branching!
        if (kind.equals("standard")) return new StandardBrick();
        if (kind.equals("jumbo"))    return new JumboBrick();
        throw new IllegalArgumentException(kind);
    }
}
```

Every client knows the concrete classes *and* duplicates the selection logic. To add a `HollowBrick`, you must edit `WallBuilder`, `ChimneyBuilder`, and anywhere else that branches.

### Motivation

If the concrete classes can be made *package-private* and hidden behind a single factory, clients depend only on the `Brick` interface plus a `BrickFactory`. This is the **Dependency Inversion Principle** in action — clients depend on an abstraction, not on details (see [design-principles/04-solid/05-dip](../../../design-principles/04-solid/05-dip-dependency-inversion/junior.md)). Adding a new concrete brick becomes a one-place change.

### Mechanical steps

1. **Create the factory class** (e.g. `BrickFactory`) with a method that takes whatever discriminator the clients use (`String kind`, an enum, etc.) and returns the *interface* type.
2. **Move the selection logic** (the `if/switch` over kinds) into the factory method. Run tests.
3. **Redirect each client** to call `factory.create(kind)` instead of doing its own `new` / branching. Run tests after each client.
4. Once all clients route through the factory, **reduce the concrete classes' visibility** to package-private so nothing outside the package can `new` them directly.
5. Optionally, **replace the `String` discriminator with an enum** to make the contract type-safe.

### After

```java
public interface Brick { double getVolume(); }

// Package-private: invisible outside this package. Clients can't `new` them.
class StandardBrick implements Brick { public double getVolume() { return 0.001; } }
class JumboBrick    implements Brick { public double getVolume() { return 0.002; } }

public final class BrickFactory {
    public enum Kind { STANDARD, JUMBO }

    public Brick create(Kind kind) {
        switch (kind) {
            case STANDARD: return new StandardBrick();
            case JUMBO:    return new JumboBrick();
            default: throw new IllegalArgumentException("Unknown brick: " + kind);
        }
    }
}

// Clients now depend only on the interface + the factory:
class WallBuilder {
    private final BrickFactory factory;
    WallBuilder(BrickFactory factory) { this.factory = factory; }
    Brick pick(BrickFactory.Kind kind) { return factory.create(kind); }
}
```

`ChimneyBuilder` loses its duplicated branch entirely — it just asks the factory.

### Resulting pattern

You have arrived at a **Simple Factory** (sometimes called a *Static Factory* when the method is static), the gateway to [Abstract Factory](../../../design-patterns/01-creational/02-abstract-factory/junior.md). The concrete classes are now an *implementation secret* of the package.

### When NOT to

- If clients legitimately need the **concrete type** (e.g. `JumboBrick` has methods `Brick` does not, and callers use them), you cannot hide it behind the interface without losing capability. Encapsulating prematurely throws away useful API.
- If there is exactly **one** implementation and no realistic prospect of a second, a factory is speculative generality — you are paying for flexibility you don't need. Add it when the second implementation actually arrives.

---

## 5. Refactoring 3: Introduce Polymorphic Creation with Factory Method

### Starting smell

Two or more subclasses override the same method, and the bodies are identical *except* for the one line that instantiates a different concrete object. The shared logic is copy-pasted; only the `new X()` differs.

```java
abstract class TaxCalculator {
    abstract void calculate();
}

class UsTaxCalculator extends TaxCalculator {
    void calculate() {
        // ... 20 identical lines of setup ...
        TaxRules rules = new UsTaxRules();      // <-- only difference
        // ... 20 identical lines using rules ...
    }
}

class UkTaxCalculator extends TaxCalculator {
    void calculate() {
        // ... the SAME 20 lines of setup ...
        TaxRules rules = new UkTaxRules();       // <-- only difference
        // ... the SAME 20 lines using rules ...
    }
}
```

The 40 duplicated lines are a maintenance trap. A bug fixed in one `calculate()` must be remembered in the other.

### Motivation

If the *only* variation is which `TaxRules` gets created, pull the creation out into an overridable method — a **Factory Method**. Then the shared `calculate()` logic lives **once** in the superclass, and each subclass supplies only its one creation line. This is the textbook [Factory Method](../../../design-patterns/01-creational/01-factory-method/junior.md) pattern, *arrived at* by removing duplication rather than designed up front.

### Mechanical steps

1. In one subclass, **extract the creation line** into its own protected method, e.g. `protected TaxRules createRules()`. Run tests.
2. **Do the same in the sibling subclass(es)**, giving the method the *same signature*. Run tests.
3. **Pull the now-duplicated `calculate()` body up into the superclass** (an Extract/Pull-Up Method move). The superclass calls the abstract `createRules()` where the `new` used to be. Run tests.
4. **Declare `createRules()` `abstract` in the superclass.** Each subclass keeps only its override.
5. Delete the subclasses' now-empty `calculate()` overrides.

### After

```java
abstract class TaxCalculator {
    final void calculate() {                 // logic lives ONCE
        // ... 20 lines of setup ...
        TaxRules rules = createRules();       // polymorphic creation hook
        // ... 20 lines using rules ...
    }

    // Factory Method: subclasses decide WHICH TaxRules to build.
    protected abstract TaxRules createRules();
}

class UsTaxCalculator extends TaxCalculator {
    protected TaxRules createRules() { return new UsTaxRules(); }
}

class UkTaxCalculator extends TaxCalculator {
    protected TaxRules createRules() { return new UkTaxRules(); }
}
```

Forty duplicated lines collapse into one shared method plus a one-line hook per subclass.

### Resulting pattern

The **[Factory Method](../../../design-patterns/01-creational/01-factory-method/junior.md)** pattern: a superclass defines the algorithm but defers the *which-object* decision to subclasses via an overridable creation method. Notice you did not "decide to use Factory Method" — you removed duplication and Factory Method *fell out*.

### When NOT to

- If the surrounding logic is **not** actually shared — if the two `calculate()` methods differ in many places, not just the `new` — then extracting a factory method does not buy you the deduplication payoff. Don't force it.
- If you have only **one** subclass today, an abstract factory method is premature. A plain protected method with a default body, or just a constructor parameter, may be simpler.
- Sometimes the better move is **composition**: pass a `TaxRules` (or a `Supplier<TaxRules>`) *into* the calculator instead of subclassing to override creation. Inheritance-based Factory Method is the right tool only when the variation genuinely lives in a class hierarchy you already have.

---

## 6. Smell → Refactoring lookup table

| Smell you observe | Refactoring to apply | Pattern you arrive at |
|---|---|---|
| Overloaded constructors you can't tell apart; ambiguous `new X(a, b, c)` | **Replace Constructors with Creation Methods** | Static factory method |
| `new ConcreteX()` scattered across clients; duplicated selection `if/switch` | **Encapsulate Classes with Factory** | Simple Factory → [Abstract Factory](../../../design-patterns/01-creational/02-abstract-factory/junior.md) |
| Sibling subclasses duplicate logic, differing only in which object they `new` | **Introduce Polymorphic Creation with Factory Method** | [Factory Method](../../../design-patterns/01-creational/01-factory-method/junior.md) |
| Telescoping constructors; many optional params | **Encapsulate Composite with Builder** *(see [middle.md](./middle.md))* | [Builder](../../../design-patterns/01-creational/03-builder/junior.md) |
| Creation + config logic smeared across a class | **Move Creation Knowledge to Factory / Extract Factory** *(see [middle.md](./middle.md))* | Factory |
| Costly construction of slight variants | refactor toward `clone()` | [Prototype](../../../design-patterns/01-creational/04-prototype/junior.md) |
| A Singleton causing global-state pain | **Inline Singleton** *(see [away-from-patterns](../05-refactoring-away-from-patterns/junior.md))* | (pattern removed) |

---

## 7. Mini glossary

- **Creation method** — a static method on a class whose name describes the kind of object it returns (`Loan.newTermLoan(...)`). Kerievsky's term for the *static factory method* idiom.
- **Factory** — an object or class whose responsibility is constructing other objects, hiding which concrete class is chosen.
- **Factory Method (pattern)** — an *overridable* creation method on a class; subclasses decide the concrete product. Polymorphic creation via inheritance.
- **Simple Factory** — a non-pattern but common idiom: one class with a `create(kind)` method that switches over a discriminator. Often the first stop before Abstract Factory.
- **Discriminator** — the value (enum, string, type) a factory uses to decide which concrete class to build.
- **Behavior-preserving** — a change that leaves observable program behavior identical; the defining property of a refactoring.
- **Package-private** — Java visibility (no modifier) that hides a class from other packages; used to make concrete products an implementation secret.

---

## 8. Review questions

1. Why can a static factory method express intent that an overloaded constructor cannot? Give the `Loan` example.
2. In *Replace Constructors with Creation Methods*, why is making the constructor `private` the **last** step rather than the first?
3. What coupling problem does *Encapsulate Classes with Factory* solve, and how does package-private visibility reinforce it?
4. In *Introduce Polymorphic Creation with Factory Method*, what is the *single* difference between the sibling subclasses that triggers the refactoring? Why does that matter?
5. Give one concrete situation where you should **not** apply each of the three refactorings.
6. How does *Encapsulate Classes with Factory* relate to the Dependency Inversion Principle?
7. You see exactly one constructor and one implementing class, with no second on the horizon. Which (if any) of these three refactorings is appropriate, and why?

---

## 9. Next

- [middle.md](./middle.md) — Encapsulate Composite with Builder, Move Creation Knowledge to Factory, Extract Factory; telescoping constructors; static factory vs constructor trade-offs; the DI relationship.
- [senior.md](./senior.md) — Factory hierarchies, arriving at Abstract Factory, creation under DI containers, testing seams, avoiding factory sprawl, Prototype.
- [professional.md](./professional.md) — Performance & lifecycle: pooling vs factories, Singleton's hidden costs, thread-safe lazy init, framework realities (Spring, Guice).
- [interview.md](./interview.md) — Interview Q&A.
- [tasks.md](./tasks.md) · [find-bug.md](./find-bug.md) · [optimize.md](./optimize.md) — practice.
- Sibling: [01-when-to-refactor-to-patterns](../01-when-to-refactor-to-patterns/junior.md) · [05-refactoring-away-from-patterns](../05-refactoring-away-from-patterns/junior.md) (Inline Singleton).
