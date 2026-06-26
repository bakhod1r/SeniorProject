# Subtyping & Liskov Substitution — Middle Level

> **Topic:** [Subtyping & Liskov Substitution](README.md)
> **Focus:** The four precise LSP rules (preconditions, postconditions, invariants, history), subtyping on records and function types, and Design-by-Contract as the formalization that turns "be careful" into checkable rules.

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

> Focus: **What exactly are the rules a sound subtype must obey?** And **how do records and function types get their own subtyping rules — including the one (function parameters) that surprises everyone?**

At the junior level, LSP was a slogan: "a subtype must be substitutable for its base." That slogan is correct but operationally useless until you can answer the next question — *substitutable with respect to what, and under which exact constraints?* This level makes the rules precise.

Barbara Liskov and Jeannette Wing's 1994 formalization ("A Behavioral Notion of Subtyping") gives four obligations a subtype `S` must meet relative to its supertype `T`:

1. **Preconditions may not be strengthened** in the subtype.
2. **Postconditions may not be weakened** in the subtype.
3. **Invariants of the supertype must be preserved** by the subtype.
4. The **history constraint**: the subtype must not permit state changes that the supertype's contract forbids.

These are not folklore; they are the actual definition. Two of them — the precondition and postcondition rules — line up exactly with a *type-system* phenomenon you'll meet in the same breath: when you override a method, the relationship between the override's parameter and return types and the base method's is governed by **variance**. Parameters behave **contravariantly** (you may accept *more*, not less); return values behave **covariantly** (you may return *more specific*, not less). That correspondence — behavioral rule ↔ type rule — is the single most clarifying insight at this level.

We'll also generalize subtyping beyond classes. **Records** have *width* and *depth* subtyping. **Function types** have their own rule, and it's the one that catches people: a function subtype may take **wider (super) parameters** and return **narrower (sub) results**. Once you see why, the method-override variance rules stop being arbitrary and become inevitable.

> 🎓 **Why this matters at the middle level:** This is the level where you stop *reacting* to LSP bugs and start *predicting* them. Given a proposed override, you'll be able to say "that strengthens the precondition, so it will break callers" before a single test runs. That predictive power is what separates a mid-level engineer from a junior who only recognizes the textbook examples.

This page covers: the four rules with worked examples, width/depth record subtyping, function-type subtyping and its variance, the variance of method signatures (Java covariant returns, why parameters can't widen), and Design-by-Contract (Eiffel) as the framework that names all of this. `senior.md` takes variance to the full type-theory; `professional.md` applies it to library and API design at scale.

---

## Prerequisites

What you should know before reading this:

- **Required:** Everything in `junior.md` — subtyping as substitutability, subsumption, nominal vs structural, the Square/Rectangle break.
- **Required:** Comfort reading method overrides in a statically-typed language (Java, C#, Scala, or TypeScript).
- **Required:** What a generic/parameterized type is (`List<T>`), at least to read it.
- **Helpful but not required:** Some exposure to the words "covariant" and "contravariant," even if fuzzy.
- **Helpful but not required:** Any prior contact with assertions or `assert` in code.

You do **not** need to know:

- The formal subtyping judgment rules (`Γ ⊢ S <: T`) — that's `senior.md`.
- Declaration-site vs use-site variance annotations in depth — `senior.md`.
- Bounded quantification or F-bounded polymorphism — `senior.md`.

---

## Glossary

| Term | Definition |
|------|-----------|
| **Behavioral subtyping** | Liskov & Wing's notion: subtyping that preserves the supertype's *behavior*, not just its signatures. |
| **Precondition** | The condition a method requires of its caller before it runs. Strengthening it = demanding more. |
| **Postcondition** | The condition a method guarantees on return. Weakening it = delivering less. |
| **Class invariant** | A property true of every instance between public method calls (e.g. `0 <= size <= capacity`). |
| **History constraint** | The rule that a subtype may not allow state transitions the supertype forbids (e.g. mutating an "immutable" base). |
| **Design-by-Contract (DbC)** | Bertrand Meyer's methodology (Eiffel) that bakes pre/postconditions and invariants into the language as `require`/`ensure`/`invariant`. |
| **Width subtyping** | A record with *more* fields is a subtype of one with *fewer* (extra fields are harmless to a caller expecting fewer). |
| **Depth subtyping** | A record is a subtype if a field's type is replaced by a subtype of the original field type. |
| **Covariant** | Varies *the same direction* as the subtype relation. Return types are covariant: `S <: T ⟹ () -> S <: () -> T`. |
| **Contravariant** | Varies *the opposite direction*. Parameter types are contravariant: `S <: T ⟹ (T -> R) <: (S -> R)`. |
| **Invariant (variance sense)** | Neither co- nor contravariant: the types must match exactly for the subtype relation to hold. |
| **Variance** | The rule describing how subtyping of components (params, returns, element types) lifts to subtyping of the compound. |
| **Covariant return type** | A language feature (Java 5+, C++) letting an override return a subtype of the base method's return type. |
| **Method override** | Replacing a base method's implementation in a subtype; its signature must respect variance to stay sound. |

---

## Core Concepts

### 1. The Four Rules of Behavioral Subtyping

Let `S <: T`, and let `m` be a method declared on `T` and overridden on `S`.

**Rule 1 — Preconditions may not be strengthened.** `S.m` must accept *at least* every input `T.m` accepted. Formally `pre_T ⟹ pre_S` (whatever satisfied the base precondition must satisfy the subtype's). You may *weaken* a precondition (accept more), never strengthen it. Strengthening means a caller holding a `T` can pass an input that was legal for `T` but illegal for `S` — and `S` rejects or crashes. The `Penguin.fly()` and `unmodifiableList.add()` breaks are both strengthened preconditions ("you may only call me under conditions the base never imposed").

**Rule 2 — Postconditions may not be weakened.** `S.m` must guarantee *at least* everything `T.m` guaranteed: `post_S ⟹ post_T`. You may *strengthen* a postcondition (promise more), never weaken it. Weakening means a caller relying on `T.m`'s guarantee gets less than promised. A `withdraw` override that "usually" deducts the money weakens the postcondition.

**Rule 3 — Invariants must be preserved.** Every invariant `T` guarantees, `S` must also guarantee. `S` may *add* invariants but never drop one. The Square/Rectangle break is an invariant violation: `Rectangle` invariant "width and height are independent dimensions" is broken by `Square`.

**Rule 4 — The history constraint.** This one is subtle and easy to miss. Even if every method individually respects rules 1–3, the subtype must not introduce *new state transitions* that the supertype's contract disallows. Classic case: `T` is an immutable `Point` (its contract says `x` and `y` never change after construction). A subtype `MutablePoint` adds a `setX` method. Each method might individually look fine, but `MutablePoint` permits a history — "x changed over time" — that `Point`'s contract forbade. Any code relying on `Point` immutability (using it as a hash-map key, caching its hash) is now broken. The history constraint is *why* you can't soundly add mutation under an immutable base type.

Memorize the asymmetry: **preconditions weaken, postconditions strengthen, invariants accumulate, history is constrained.** Or the one-liner: **require no more, promise no less, break nothing, surprise no one.**

### 2. Record Subtyping: Width and Depth

Records (structs / objects with named fields) have two independent subtyping directions.

**Width subtyping** — *more fields is a subtype of fewer fields.* A `{ name: string, age: int }` is a subtype of `{ name: string }`, because anyone expecting just `name` is perfectly served by an object that *also* has `age`. The extra field is invisible and harmless to the caller. (This is exactly how structural subtyping in TypeScript/Go works — covered in the structural-typing topic of this section.)

```text
{ name, age, email }  <:  { name, age }  <:  { name }
       ^ more fields = more specific = subtype
```

**Depth subtyping** — *a field whose type is a subtype makes the whole record a subtype.* If `Dog <: Animal`, then `{ pet: Dog }` is a subtype of `{ pet: Animal }`, *for read-only access*. (The "read-only" caveat is the variance issue, and it's why depth subtyping on *mutable* fields is unsound — picked up in `senior.md`.)

```text
Dog <: Animal   ⟹   { pet: Dog } <: { pet: Animal }    (read-only fields)
```

### 3. Function Subtyping: The Rule Everyone Gets Backwards

When is one function type a subtype of another? When can a `Fn1` be used wherever a `Fn2` is expected? The answer:

> `(A → B) <: (C → D)`  **iff**  `C <: A`  (parameters: contravariant)  **and**  `B <: D`  (return: covariant).

Read that slowly. The subtype function may:

- **accept a *wider* (more general) parameter** — `C <: A` means the supertype's parameter `C` is a subtype of the subtype-function's parameter `A`, i.e. the subtype function accepts *at least* everything the supertype function did, and possibly more;
- **return a *narrower* (more specific) result** — `B <: D` means the subtype function returns a subtype of what was expected.

Why? Imagine code expects a `(Dog) → Animal` and you want to pass your function instead. Your function must handle *any* `Dog` the caller throws at it — so it can be *more* permissive, say `(Animal) → Animal` (handles dogs and cats). It can be *less* permissive only at the cost of choking on inputs the caller is allowed to send. And its return is consumed as an `Animal`, so returning a `Dog` (more specific) is fine — every `Dog` is an `Animal`.

```text
Caller expects:    (Dog)    → Animal
You may supply:    (Animal) → Dog       ✓   wider input, narrower output
You may NOT supply:(Poodle) → Object    ✗   narrower input (chokes on a Beagle), wider output
```

**Parameters are contravariant. Returns are covariant.** This is not a convention; it's forced by substitutability.

### 4. Method Signatures Are Function Types — So They Follow the Same Rule

A method override is just a function that must be a subtype of the base method (so it can substitute). Apply the function rule:

- **Return types: covariant.** An override may return a *subtype* of the base's return type. Java added this in Java 5 ("covariant return types"):

```java
class Animal { Animal reproduce() { return new Animal(); } }
class Dog extends Animal {
    @Override Dog reproduce() { return new Dog(); }   // Dog <: Animal — legal, covariant return
}
```

A caller holding an `Animal` calls `reproduce()` and expects an `Animal`; getting a `Dog` is fine.

- **Parameter types: contravariant in theory, invariant in most languages.** Soundness *permits* an override to *widen* a parameter. But Java, C#, and C++ make method parameters **invariant** — they must match exactly — because allowing widening interacts badly with overloading and nominal dispatch. So in practice you cannot widen a parameter in Java; trying to "override" with a wider parameter creates an *overload*, not an override:

```java
class Animal { void eat(Dog food) {} }
class Cat extends Animal {
    // void eat(Animal food) {}  // NOT an override — it's a separate overloaded method
}
```

The key takeaway: the *behavioral* LSP rules (don't strengthen preconditions, don't weaken postconditions) are the *same constraints* as the *type* variance rules (contravariant params, covariant returns). The precondition rule **is** parameter contravariance; the postcondition rule **is** return covariance. Behavior and types are saying the same thing from two directions.

### 5. Design-by-Contract: The Formalization

Bertrand Meyer's Eiffel language makes these rules first-class with `require` (precondition), `ensure` (postcondition), and `invariant`. The language *enforces* LSP's first three rules at the language level:

- When you override, Eiffel **OR-s the preconditions** (`require else`) — the effective precondition can only get *weaker*.
- It **AND-s the postconditions** (`ensure then`) — the effective postcondition can only get *stronger*.
- Invariants are *inherited and accumulated* — a subtype's invariant is its own AND-ed with all ancestors'.

```eiffel
feature withdraw (amount: INTEGER)
    require
        positive: amount > 0
        sufficient: amount <= balance
    ensure
        deducted: balance = old balance - amount
    end
```

This is the *formal* version of everything in this file. Even in languages without DbC, the mental discipline — "what does this method require, ensure, and keep invariant?" — is what makes LSP operational. Some ecosystems approximate it: Java's `assert`, code-contracts libraries, Kotlin's `require`/`check`, runtime invariant checks in constructors.

---

## Real-World Analogies

**The subcontractor and the master contract.** A general contractor signs a contract: "I require the site cleared (precondition), I guarantee a finished wall (postcondition)." A subcontractor who takes over may demand *less* (also works on an uncleared site — weakened precondition, fine) and deliver *more* (a finished, painted wall — strengthened postcondition, fine). They may *not* demand more (require a permit you didn't agree to) or deliver less (an unfinished wall). That's the precondition/postcondition asymmetry exactly.

**The universal remote.** A specific TV remote handles one TV (`(MyTV) → Signal`). A universal remote handles *any* TV (`(AnyTV) → Signal`). Anywhere the specific remote was expected, the universal one substitutes — it accepts a wider range of inputs. That's parameter contravariance: the more general accepter is the subtype.

**Russian dolls of guarantees.** Postconditions are like nested dolls: a subtype's promise must *contain* the base's promise and may wrap *more* around it. Preconditions are the opposite — the base's demand is the outer doll, and the subtype's demand must fit *inside* it (be weaker). Swap which one nests which and you've broken substitutability.

**The form with extra fields.** A government form expects `{ name, dob }`. You hand in a form with `{ name, dob, phone, email }`. The clerk reads the two fields they need and ignores the rest — your richer form substitutes perfectly. That's width subtyping: more fields, still a valid subtype.

---

## Mental Models

**Model 1 — "Behavioral rules and type rules are the same rules."** Don't memorize "preconditions can't strengthen" *and* "parameters are contravariant" as two facts. They are one fact viewed twice. The precondition is what the parameter *means*; contravariance is what the type system *encodes*. Likewise postcondition ↔ covariant return.

**Model 2 — "Funnel in, funnel out."** A safe override is a funnel: *wide* at the input end (accepts everything the base did, maybe more) and producing output that's *at least as specific* as promised. Wide-in, narrow-out. Reverse either funnel and you have a leak.

**Model 3 — "Invariants accumulate; they never shed."** Going down a hierarchy, the set of invariants only grows. A subtype can *add* guarantees ("and the balance is always even") but can never *drop* one the base made. If your subtype needs to drop an invariant to work, it isn't a subtype.

**Model 4 — "History is a property of the whole lifetime, not one call."** Rules 1–3 check individual methods. Rule 4 checks the *trajectory* of an object's state. A subtype can pass all per-method checks and still introduce a forbidden trajectory (mutating an immutable). When evaluating a subtype, also ask: "what *sequences* of states does the base forbid, and do I still forbid them?"

**Model 5 — "Width vs depth are orthogonal."** A record can be a subtype by having more fields (width) *and* by specializing a field's type (depth), independently. Keeping the two axes separate in your head prevents the classic confusion when reasoning about structural types.

---

## Code Examples

### Example 1: Strengthened precondition — the violation, made precise

```java
class Account {
    protected int balance = 100;
    // precondition: amount > 0   (any positive amount is allowed)
    void withdraw(int amount) {
        if (amount <= 0) throw new IllegalArgumentException();
        balance -= amount;
    }
}

class CappedAccount extends Account {
    // STRENGTHENED precondition: amount > 0 AND amount <= 50
    @Override void withdraw(int amount) {
        if (amount > 50) throw new IllegalArgumentException("max 50");  // ⚠ new demand
        super.withdraw(amount);
    }
}

void payRent(Account a) {
    a.withdraw(80);   // legal for Account's contract (80 > 0)
}

payRent(new Account());        // ok
payRent(new CappedAccount());  // 💥 a caller holding an Account had no reason to expect a cap
```

`CappedAccount` is **not** a subtype of `Account`: it strengthened the precondition. Rule 1 violated.

### Example 2: Weakened postcondition

```java
class Account {
    int balance = 100;
    // postcondition: balance == old balance - amount   (money definitely gone)
    void withdraw(int amount) { balance -= amount; }
}

class FlakyAccount extends Account {
    @Override void withdraw(int amount) {
        if (Math.random() < 0.5) return;   // ⚠ sometimes does nothing — weakened postcondition
        balance -= amount;
    }
}
```

A caller relying on "after `withdraw(50)`, the 50 is gone" is now sometimes wrong. Rule 2 violated.

### Example 3: Covariant return (legal) and the parameter that *can't* widen

```java
class ShapeFactory {
    Shape create() { return new Shape(); }
    void register(Circle c) {}
}

class CircleFactory extends ShapeFactory {
    @Override Circle create() { return new Circle(); }  // ✓ covariant return: Circle <: Shape

    // @Override void register(Shape s) {}  // ✗ NOT an override in Java — different param type.
    // It compiles only as an OVERLOAD, and won't be called via dynamic dispatch on a Circle arg.
}
```

The covariant return is sound and allowed. Widening the parameter to `Shape` would be *sound by LSP* but Java forbids it from being an override; it becomes a separate overloaded method, which is a frequent source of "why isn't my override called?" confusion.

### Example 4: Function-type subtyping in TypeScript

```typescript
class Animal { breathe() {} }
class Dog extends Animal { bark() {} }

// A handler the framework will call with a Dog and use the result as an Animal:
type Handler = (input: Dog) => Animal;

const wide: (input: Animal) => Dog = (a) => new Dog();   // wider param, narrower return
const h: Handler = wide;        // ✓ contravariant param + covariant return — assignable

const narrow: (input: Dog) => Animal = (d) => new Animal();
// const bad: (input: Animal) => Animal — fine for param, but if it returned `Object`
//   it would NOT be assignable to Handler: widened return breaks covariance.
```

TypeScript (with `strictFunctionTypes`) checks *parameters contravariantly* for function types — supplying a function with a wider parameter is the valid direction.

### Example 5: Width and depth subtyping, structurally

```typescript
type WithName  = { name: string };
type Person    = { name: string; age: number };          // width subtype of WithName

function hello(x: WithName) { return `Hi ${x.name}`; }
hello({ name: "Ada", age: 36 });   // ✓ extra field `age` ignored — width subtyping

type PetOwner       = { pet: { legs: number } };
type DogOwner       = { pet: { legs: number; bark(): void } };  // pet field is a subtype → depth
const d: DogOwner   = { pet: { legs: 4, bark() {} } };
const p: PetOwner   = d;   // ✓ depth subtyping (read access)
```

### Example 6: Design-by-Contract discipline without a DbC language

```java
class Stack<E> {
    private final List<E> data = new ArrayList<>();

    // invariant: size() >= 0    (checked at the boundary)
    void push(E e) {
        int before = data.size();
        data.add(e);
        assert data.size() == before + 1 : "postcondition: size grows by one";
    }

    E pop() {
        if (data.isEmpty()) throw new NoSuchElementException();  // precondition: not empty
        E e = data.remove(data.size() - 1);
        assert data.size() >= 0 : "invariant: non-negative size";
        return e;
    }
}
```

Even without `require`/`ensure`, encoding pre/postconditions as guards and asserts turns the LSP rules into something a test or runtime can catch.

---

## Pros & Cons

**Pros of reasoning with the four rules:**

- **Predictive, not reactive.** You can audit a proposed override on paper and declare it sound or broken before writing a test.
- **Unifies behavior and types.** Seeing precondition↔contravariance and postcondition↔covariance collapses two topics into one mental model.
- **Maps to real language features.** Covariant returns, function-type variance, and DbC are all direct applications.
- **Catches the silent breaks.** The invariant and history rules find the violations that *don't* throw (Square/Rectangle), which tests easily miss.

**Cons / costs:**

- **Most languages don't enforce it.** Outside Eiffel (and partial tooling), the four rules are discipline, not compilation. The compiler still only checks signatures.
- **History constraint is easy to overlook.** It's about lifetimes and trajectories, which are harder to see than single-method signatures.
- **Variance has language-specific exceptions.** Java method parameters are invariant despite contravariance being sound; arrays are covariant despite it being *un*sound. The theory and the language don't always agree.
- **Contracts cost effort to write.** Pre/postconditions and invariants are documentation that must be kept accurate, or they mislead.

---

## Use Cases

- **Reviewing an override in code review.** Walk the four rules: did the precondition get tighter? Did the postcondition get looser? Did an invariant drop? Did new mutation appear? Four questions, fast verdict.
- **Designing a generic API surface.** Function-type variance tells you which callbacks are safe to substitute — essential for plugin and event systems.
- **Modeling read-only vs mutable.** Depth subtyping's read-only caveat directly informs whether to expose a covariant interface (read) separate from the mutable one.
- **Specifying domain invariants.** DbC-style thinking forces invariants like "order total equals sum of line items" to be explicit and inherited correctly by subtypes.
- **Avoiding override-vs-overload traps.** Knowing that Java parameters are invariant explains why your "override" with a wider parameter is silently never called.

---

## Coding Patterns

**Pattern 1 — Audit overrides against the four rules.** Make it a checklist applied to every overriding method:

```text
[ ] Precondition no stronger than base?   (accepts everything base accepted)
[ ] Postcondition no weaker than base?    (guarantees everything base guaranteed)
[ ] All base invariants preserved?
[ ] No new state transition base forbids? (history)
```

**Pattern 2 — Use covariant returns to specialize factories.** When a base method returns a base type, override to return the precise subtype so callers of the subtype get the richer type without a cast.

**Pattern 3 — Separate read and write interfaces for safe depth subtyping.** Depth subtyping is sound only for reads. Expose a covariant read-only view and keep mutation behind an invariant interface:

```typescript
interface ReadonlyBox<out T> { get(): T; }      // covariant — depth subtyping safe
interface MutableBox<T> extends ReadonlyBox<T> { set(v: T): void; }  // invariant
```

**Pattern 4 — Encode contracts as guards + asserts.** In languages without DbC, put precondition checks at the top of a method, invariant asserts after mutation, and postcondition asserts before return. They double as executable documentation.

---

## Best Practices

- **Make the four rules a code-review reflex.** Most LSP bugs are caught in seconds once you ask the four questions out loud.
- **Prefer weakening preconditions and strengthening postconditions when overriding** — those are the *safe* directions. If your override naturally wants to go the other way, the type doesn't belong under that base.
- **Use covariant return types to avoid downcasts**, but never try to widen parameters expecting an override — you'll get an overload.
- **Keep mutable depth subtyping out of your design.** If a field is mutable, depth subtyping on it is unsound; expose a read-only interface for the covariant case.
- **Write invariants down, in the constructor and in comments**, so subtypes inherit an explicit obligation rather than a guessed one.
- **Treat the history constraint as "don't add mutation under an immutable base."** It's the practical form of rule 4 you'll hit most often.

---

## Edge Cases & Pitfalls

- **Override that became an overload.** In Java/C#, changing a parameter type doesn't override — it overloads. The base method still runs under dynamic dispatch, and your "fix" is dead code. Always use `@Override` so the compiler catches this.
- **Covariant arrays.** Java and C# arrays are *covariant* (`Dog[] <: Animal[]`), which is **unsound**: storing a `Cat` into a `Dog[]` viewed as `Animal[]` throws `ArrayStoreException` at runtime. A language-level LSP violation baked into the type system — covered more in `senior.md`.
- **Throwing where the base didn't (checked exceptions).** Adding a checked exception to an override *strengthens* what the caller must handle — Java forbids overrides from declaring *broader* checked exceptions for exactly this LSP reason.
- **Invariants that hold per-method but not across calls.** A subtype might restore an invariant by the end of each method yet expose a *transient* broken state during a callback or reentrant call. The invariant rule is about observable boundaries.
- **History constraint hidden behind aliasing.** If a subtype shares mutable state with another object, it can permit forbidden state changes *indirectly*. Aliasing makes the history constraint hard to verify.
- **"Weaker precondition" that's actually a different operation.** Accepting more inputs is only safe if the method still *does the right thing* for them. Weakening a precondition while ignoring the new inputs is a postcondition break in disguise.
- **DbC contracts that drift.** A pre/postcondition comment that no longer matches the code is worse than none — it actively misleads the next person auditing the override.

---

## Summary

- Behavioral subtyping has **four precise rules**: preconditions may not be **strengthened**, postconditions may not be **weakened**, invariants must be **preserved**, and the **history constraint** forbids state transitions the base disallowed (e.g. adding mutation under an immutable base).
- **Records** subtype two ways: **width** (more fields = subtype) and **depth** (a field replaced by a subtype = subtype, for read-only access).
- **Function types** subtype with **contravariant parameters** (accept wider/more general inputs) and **covariant returns** (produce narrower/more specific outputs): `(A→B) <: (C→D)` iff `C <: A` and `B <: D`.
- The **precondition rule *is* parameter contravariance**, and the **postcondition rule *is* return covariance** — behavioral and type-level statements of the same constraint.
- **Method overrides** follow the function rule: Java/C++ allow **covariant return types**; most languages keep **parameters invariant** (so a widened parameter becomes an overload, not an override).
- **Design-by-Contract** (Eiffel) formalizes all of this with `require`/`ensure`/`invariant`, weakening preconditions and strengthening postconditions automatically down the hierarchy. Even without DbC, encoding contracts as guards and asserts makes the rules checkable.
- Watch the language-specific exceptions: **covariant arrays** (unsound), **checked-exception widening** (forbidden for LSP reasons), and **override-vs-overload** confusion.

Move on to `senior.md` for the full type-theory of subtyping — the subsumption judgment, declaration-site vs use-site variance, where arrays and generics fit, and why variance is the deepest expression of LSP.
