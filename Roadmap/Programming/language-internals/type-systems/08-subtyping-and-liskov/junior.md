# Subtyping & Liskov Substitution — Junior Level

> **Topic:** [Subtyping & Liskov Substitution](README.md)
> **Focus:** What "an S can be used where a T is expected" really means, and the one rule (Liskov's) that decides when that substitution is safe instead of a hidden bug.

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

> Focus: **What does it mean for one type to be a "subtype" of another?** And **why does the Square/Rectangle problem prove that "is-a" is not enough?**

**Subtyping** is the relation that makes polymorphism work. We say **S is a subtype of T** (written `S <: T`) when **a value of type S can be used anywhere a value of type T is expected** — and the program still type-checks and still behaves correctly. If `Dog` is a subtype of `Animal`, then any function that takes an `Animal` will accept a `Dog`, because every `Dog` *is* an `Animal`.

That word **"correctly"** is doing enormous work, and it is the whole point of this topic. The compiler can check the easy half: it can verify that a `Dog` has all the methods an `Animal` has, with compatible signatures. What the compiler *cannot* check is whether the `Dog` actually *behaves* the way callers of `Animal` expect. That second, behavioral half is governed by the **Liskov Substitution Principle (LSP)** — the "L" in SOLID — which says, informally:

> **If you replace any object of the base type with an object of a subtype, the program should keep working without surprises.**

When that holds, subtyping is *sound* and you can reason about your base type with confidence. When it fails — when some subtype quietly breaks an assumption the base type made — you get the bugs this topic is famous for: the `Square` that corrupts a `Rectangle`'s geometry, the `Penguin` whose `fly()` throws an exception, the "read-only" list that crashes when you call `add()`. Every one of those is code that compiled fine and ran wrong.

In one sentence: **subtyping is the promise that an S is a usable T; LSP is the discipline that makes the promise true.**

> 🎓 **Why this matters for a junior:** The first time inheritance bites you, it will not be a compiler error. It will be polymorphic code that worked for every subtype except one, and that one will be in production. Learning to feel *when "is-a" is a lie* is one of the highest-leverage object-oriented skills you can build early.

This page covers: what the subtype relation actually means, the subsumption rule that lets an S "be" a T, nominal vs structural subtyping at a beginner level, why preconditions/postconditions/invariants are the real contract, and the canonical Square/Rectangle failure shown in code. The next level (`middle.md`) formalizes the four LSP rules and function-type subtyping; `senior.md` covers variance and the type-theory; `professional.md` covers real-world API and library design under LSP.

---

## Prerequisites

What you should know before reading this:

- **Required:** Basic object-oriented programming — classes, fields, methods, and what it means for one class to `extend` or `implement` another.
- **Required:** How to call a method on an object and pass an object to a function.
- **Required:** What an interface (or abstract class) is, at least loosely.
- **Helpful but not required:** Exposure to at least one statically-typed language (Java, C#, TypeScript, Go) so the type errors mean something.
- **Helpful but not required:** A passing acquaintance with the word "polymorphism."

You do **not** need to know:

- Variance (covariance/contravariance) as a formal concept — that is `senior.md`.
- Design-by-contract formalisms or Eiffel — touched lightly here, deep in `middle.md`.
- The type-theory subsumption proof rules — that is `senior.md`.

---

## Glossary

| Term | Definition |
|------|-----------|
| **Type** | A label that says what operations a value supports and how it may be used. |
| **Subtype** | A type S such that an S value is usable wherever a T value is expected. Written `S <: T`. |
| **Supertype** | The other end: T is a supertype of S. The more general type. |
| **Subtyping** | The `<:` *relation* itself — the rules that decide which types are subtypes of which. |
| **Substitutability** | The property at the heart of LSP: you can swap in the subtype without breaking the caller. |
| **Polymorphism** | One piece of code working over many types. Subtyping is one way to get it (subtype polymorphism). |
| **Subsumption** | The rule that *lets* you treat an S value as having type T. "An S is also a T." |
| **Liskov Substitution Principle (LSP)** | The rule that subtypes must be behaviorally substitutable for their base type, not just type-compatible. |
| **Nominal subtyping** | Subtype *because you declared it* — `class Dog extends Animal`. The name/declaration is what counts. |
| **Structural subtyping** | Subtype *because the shape matches* — if it has the right methods/fields, it qualifies, no declaration needed. |
| **Precondition** | What a method requires of its caller before it will work (e.g. "amount must be > 0"). |
| **Postcondition** | What a method guarantees to its caller after it finishes (e.g. "balance is reduced by amount"). |
| **Invariant** | A truth about an object that must always hold between method calls (e.g. "balance is never negative"). |
| **Contract** | The full promise of a method/class: its preconditions, postconditions, and invariants together. |
| **Inheritance** | A *code-reuse* mechanism: a subclass borrows the implementation of its parent. Related to but **not the same as** subtyping. |
| **Interface** | A pure contract — method signatures with no implementation — that types can declare they satisfy. |
| **`is-a` relationship** | The naive intuition ("a Square is-a Rectangle") that LSP exists to correct. |

---

## Core Concepts

### 1. Subtyping Is "Usable Where Expected"

Forget inheritance for a moment. The clean definition is about *usage*:

> **S is a subtype of T if a value of type S can be used in every context that expects a value of type T.**

If `printArea(Shape s)` expects a `Shape`, and `Circle` is a subtype of `Shape`, then `printArea(new Circle(...))` must work. That is the entire idea. The subtype is *at least as capable* as the supertype — it has every method, it accepts every input the supertype accepted, and it makes every guarantee the supertype made.

This is why subtyping is sometimes called the **substitution relation**: the subtype can substitute for the supertype.

### 2. The Subsumption Rule: An S Value "Has Type" T

Here is the rule that makes the whole thing tick. In type theory it is called **subsumption**, and it reads:

```text
   If e has type S,  and  S <: T,
   then e also has type T.
```

In plain terms: a `Dog` value doesn't *stop* being a `Dog` — it just *also* counts as an `Animal`. So when you write:

```java
Animal a = new Dog();   // a Dog value, viewed at type Animal
```

you have applied subsumption. The value is a `Dog`; the *static type* of the variable is `Animal`. That widening from the specific type to the general one is what lets the same `feed(Animal)` function accept dogs, cats, and goldfish without knowing about any of them.

### 3. Nominal vs Structural — Two Ways to Be a Subtype

There are two schools of thought on *how* the compiler decides `S <: T`.

**Nominal subtyping** (Java, C#, C++, Scala): you are a subtype **because you said so**. The subtype relation follows the declared hierarchy — `class Dog extends Animal` or `class ArrayList implements List`. If you didn't write `extends`/`implements`, you are not a subtype, even if your class happens to have all the right methods.

**Structural subtyping** (TypeScript, Go's interfaces): you are a subtype **because your shape fits**. If a type has all the methods/fields the target needs, it qualifies automatically — no declaration required. In Go, a type satisfies an interface just by having its methods; it never names the interface.

```typescript
// TypeScript — structural. No "implements" needed.
interface Named { name: string; }
function greet(x: Named) { console.log(x.name); }

const dog = { name: "Rex", legs: 4 };   // not declared as Named...
greet(dog);                              // ...but it fits the shape, so it's accepted
```

Both styles produce a subtype relation; they just disagree about what *establishes* it. (This split is covered in depth in the nominal-vs-structural topic of this section.)

### 4. The Real Contract: Preconditions, Postconditions, Invariants

The compiler checks *signatures*. LSP is about something the compiler can't see: **behavior**. A method's real contract has three parts.

- **Precondition** — what the method demands *before* it runs. `withdraw(amount)` might require `amount > 0 && amount <= balance`.
- **Postcondition** — what it promises *after* it runs. `withdraw` promises `balance == old_balance - amount`.
- **Invariant** — what stays true the whole time the object lives. A `BankAccount` might guarantee `balance >= 0`, always.

A subtype is allowed to *override* methods, but only if it keeps the contract honest. And the rules for "keeping it honest" are the heart of LSP — covered fully in `middle.md`, but worth previewing:

- A subtype **may not strengthen preconditions** — it can't demand *more* than the base did. (If `Animal.eat(food)` accepts any food, `Dog.eat(food)` can't reject vegetables — callers holding an `Animal` won't know to avoid them.)
- A subtype **may not weaken postconditions** — it can't promise *less*. (If `Account.withdraw` guarantees the money is gone, an overriding subtype can't sometimes leave it.)
- A subtype **must preserve invariants** — it can't break a truth the base type guaranteed.

### 5. Inheritance Is Not Subtyping

This trips up almost everyone early. **Inheritance** (`extends`) is a tool for *reusing code*. **Subtyping** is a relation about *substitutability*. In most OO languages, `extends` happens to give you both at once — which is exactly why people conflate them. But they are different ideas:

- You can have **subtyping without inheritance**: implementing an interface, or structural typing in Go/TypeScript.
- You can *abuse* inheritance to get code reuse where the subtype is *not* substitutable — and that is precisely the LSP violation. `class Square extends Rectangle` reuses the rectangle's code, but a `Square` is *not* a substitutable `Rectangle`, as we'll see.

The classic advice "**prefer composition over inheritance**" exists largely because inheritance tempts you into LSP violations. If you only need the code, compose. Only subtype when the subtype is genuinely substitutable.

---

## Real-World Analogies

**The job substitute.** A "Senior Engineer" is a subtype of "Engineer." Anywhere the team needs an Engineer, a Senior can stand in — they can do everything an Engineer can, plus more. That's sound subtyping. Now imagine a "Manager" who has the title "Engineer" but refuses to write code. If you send the Manager to do an Engineer's task, the task fails. The Manager *claimed* the type but can't *substitute* — an LSP violation in human form.

**The rectangular vs square frame.** A picture frame shop sells rectangular frames where you set width and height independently. A "square frame" that *forces* height to equal width whenever you set the width is a different product. If a customer hands their frame-resizing robot a square frame expecting to set width to 10 and height to 5, the robot ends up with a 10×10 frame and a confused customer. The square *looked like* a rectangle but didn't *behave* like one — the canonical Square/Rectangle problem.

**The contract with the plumber.** You hire a plumber under a contract: "you may require the water to be off first (precondition), and you guarantee the leak is fixed (postcondition)." If a substitute plumber shows up and says "I require the water off *and* the gas off *and* a permit" (strengthened precondition), they've broken the contract — you weren't told to do all that. If they say "I'll *probably* fix the leak" (weakened postcondition), they've also broken it. A good substitute asks for no more and delivers no less.

**The vending machine button.** Every button on a vending machine promises: press me, get a snack. A button labeled like the rest but wired to "press me, get an error light" violates the promise. Callers (customers) trusted the type "button" and got surprised. LSP says every button must keep the button-promise.

---

## Mental Models

**Model 1 — "Replace and pray, or replace and trust."** LSP is the difference. With sound subtyping you *replace and trust*: swap any subtype in, walk away, the program is fine. With a violation you *replace and pray*: it works for the subtypes you tested and breaks on the one you didn't. The goal is to make every subtype trustworthy by construction.

**Model 2 — "The base type is a contract written for strangers."** When you define `Animal`, you're writing a promise that *code you'll never see* will rely on. Every subtype inherits the obligation to honor that promise. You don't get to know who's calling — so you can't cut corners "just for this subclass."

**Model 3 — "Demand less, deliver more."** A safe subtype is *more lenient on input* and *more generous on output* than its base. Demand no more than the base (don't strengthen preconditions). Deliver no less than the base (don't weaken postconditions). If you remember one phrase, remember "**require less, promise more**" — that's the shape of a valid override.

**Model 4 — "The compiler signs the form; you keep the promise."** The type checker verifies the *signature* — right method names, compatible parameter and return types. It physically cannot verify the *behavior*. LSP is the part of the contract that has no compiler. That gap is where the bugs live, and discipline is the only thing that closes it.

**Model 5 — "is-a is a hypothesis, not a proof."** "A Square is-a Rectangle" feels obviously true in English. LSP forces you to *test* the hypothesis: can a Square actually substitute for a Rectangle in code that resizes width and height independently? No. So for *this* contract, the is-a hypothesis is false. is-a depends on the contract, not on the dictionary.

---

## Code Examples

### Example 1: Sound subtyping — `Dog` substitutes for `Animal`

```java
class Animal {
    String describe() { return "an animal"; }
    int legs()        { return 4; }
}

class Dog extends Animal {
    @Override String describe() { return "a dog"; }   // still returns a String — OK
    void fetch() { /* extra ability, fine */ }
}

void printInfo(Animal a) {            // expects an Animal
    System.out.println(a.describe() + " with " + a.legs() + " legs");
}

printInfo(new Animal());   // an animal with 4 legs
printInfo(new Dog());      // a dog with 4 legs   <-- Dog substitutes cleanly
```

`Dog` adds an ability (`fetch`) and refines a result (`describe`) without removing or weakening anything. Any code holding an `Animal` keeps working. This is LSP done right.

### Example 2: The canonical violation — Square breaks Rectangle

This is *the* example to internalize. A `Rectangle` has an implicit **invariant**: width and height are independent. A `Square` enforces width == height. Make `Square extends Rectangle` and the invariant breaks.

```java
class Rectangle {
    protected int width, height;
    void setWidth(int w)  { this.width = w; }
    void setHeight(int h) { this.height = h; }
    int area()            { return width * height; }
}

class Square extends Rectangle {
    // A square must stay square, so setting one side sets both:
    @Override void setWidth(int w)  { this.width = w; this.height = w; }
    @Override void setHeight(int h) { this.width = h; this.height = h; }
}
```

Now write innocent, polymorphic code against the *base* type:

```java
void resizeAndCheck(Rectangle r) {
    r.setWidth(5);
    r.setHeight(4);
    // The base contract says width and height are independent,
    // so the area MUST be 5 * 4 = 20.
    assert r.area() == 20 : "expected 20, got " + r.area();
}

resizeAndCheck(new Rectangle());  // area 20  ✓
resizeAndCheck(new Square());     // area 16  ✗  setHeight(4) also set width to 4!
```

The function never mentions `Square`. It relies on a promise `Rectangle` made — "set width and height independently." `Square` silently broke that promise. The code compiled. It ran. It is *wrong*. **`Square` is not a subtype of `Rectangle`**, no matter what geometry class taught you.

### Example 3: The bird that can't fly

```java
class Bird {
    void fly() { /* flap, take off */ }
}

class Penguin extends Bird {
    @Override void fly() {
        throw new UnsupportedOperationException("penguins can't fly");
    }
}

void migrate(Bird b) {
    b.fly();   // perfectly reasonable to call on a Bird
}

migrate(new Penguin());   // 💥 crashes at runtime
```

`Penguin.fly()` **strengthens the precondition** to the impossible ("you may only call me if I'm not a penguin") and **weakens the postcondition** (it promises a crash instead of flight). Any code that holds a `Bird` and calls `fly()` is now a landmine. The fix is to not put `fly()` on `Bird` — separate `Bird` from `FlyingBird`.

### Example 4: The "read-only" list that throws — a real-world LSP violation

Java's standard library does this *on purpose*, and it's a famous LSP wart. `Collections.unmodifiableList` returns a `List` whose mutating methods throw:

```java
List<String> base = new ArrayList<>(List.of("a", "b"));
List<String> view = Collections.unmodifiableList(base);

view.add("c");   // 💥 UnsupportedOperationException at runtime — but view IS-A List!
```

`List` declares `add()`. A caller holding a `List` is entitled to call `add()`. The unmodifiable view *claims* to be a `List` but **strengthens the precondition** ("you may call `add` only if I happen to be mutable") and crashes otherwise. The compiler can't catch it because the *signature* is satisfied. This is the textbook case of a library shipping an LSP violation because the type hierarchy lacks a real "read-only list" supertype.

### Example 5: Structural subtyping in Go — no `extends` in sight

```go
type Stringer interface {
    String() string
}

type Point struct{ X, Y int }

func (p Point) String() string {              // Point never names Stringer...
    return fmt.Sprintf("(%d, %d)", p.X, p.Y)
}

func describe(s Stringer) {                    // ...but it satisfies the shape,
    fmt.Println(s.String())                    //    so it's a subtype structurally
}

describe(Point{1, 2})   // (1, 2)
```

`Point` is a subtype of `Stringer` purely because it has a matching `String()` method. Go decides subtyping by *shape*, not by declaration — the structural model.

---

## Pros & Cons

**Pros of subtyping (done with LSP discipline):**

- **Polymorphism for free.** Write one function against the supertype; it works for every present and future subtype.
- **Open for extension.** New subtypes slot in without touching the code that uses the base type (the Open/Closed Principle leans on this).
- **Clear contracts.** Thinking in pre/postconditions forces you to state what your base type actually promises.
- **Testability.** You can substitute a fake/mock subtype in tests precisely *because* substitutability holds.

**Cons / costs:**

- **The compiler only checks half.** Signature compatibility is verified; behavioral compatibility is on you. The most dangerous bugs hide in that gap.
- **Inheritance tempts violations.** `extends` makes it trivially easy to reuse code where the subtype isn't substitutable.
- **"is-a" intuition lies.** Real-world taxonomies (Square *is a* Rectangle, Penguin *is a* Bird) don't map cleanly to substitutable types.
- **Refactoring cost.** Discovering a violation late often means redesigning a hierarchy that lots of code already depends on.

---

## Use Cases

- **Plugin / strategy interfaces.** Define a `PaymentProcessor` interface; every concrete processor (`StripeProcessor`, `PayPalProcessor`) is a subtype. Calling code never changes when you add a new one — *as long as* each obeys the contract.
- **Collections and iterators.** `List`, `Set`, `Map` hierarchies rely on subtypes behaving like the interface promises. (And, as we saw, occasionally break it.)
- **Test doubles.** A mock `EmailSender` substitutes for the real one. This works *only* because the mock honors the contract callers depend on.
- **Domain hierarchies.** `Shape` with `Circle`, `Rectangle`, `Triangle` subtypes — provided each really computes its own area and respects the `Shape` contract.
- **Framework extension points.** Servlet `Filter`, ASP.NET `Middleware`, Android `Activity` — you subtype a framework base class and the framework substitutes your instance for the base type.

---

## Coding Patterns

**Pattern 1 — Program to the supertype, not the subtype.** Accept and store the most general type that supports what you need. `void render(Shape s)`, not `void render(Circle c)`. This is the discipline that makes subtyping pay off.

```java
List<Shape> shapes = new ArrayList<>();   // List + Shape: general on both axes
shapes.add(new Circle(3));
shapes.add(new Rectangle(2, 4));
for (Shape s : shapes) System.out.println(s.area());
```

**Pattern 2 — Split the hierarchy when behavior diverges.** When a "subtype" can't honor the base contract, that's a signal to split the type, not to override-and-throw.

```java
interface Bird { void eat(); }
interface FlyingBird extends Bird { void fly(); }

class Sparrow implements FlyingBird { /* eat + fly */ }
class Penguin implements Bird       { /* eat only — no fly() to break */ }
```

**Pattern 3 — Make the problematic type immutable.** The Square/Rectangle break depends on *mutation* (`setWidth`). Immutable shapes don't have that problem: a square just *is* a square, and producing a "wider" one returns a new object.

```java
final class Rectangle {
    final int width, height;
    Rectangle(int w, int h) { width = w; height = h; }
    Rectangle withWidth(int w) { return new Rectangle(w, height); }
    int area() { return width * height; }
}
// A Square is just a Rectangle factory: Rectangle.square(5) -> new Rectangle(5,5).
// No subtype, no broken invariant.
```

**Pattern 4 — Compose instead of inherit when you only want the code.** If you need a `Rectangle`'s behavior inside a `Square`, hold one as a field rather than extending it — then expose only the operations that stay valid.

---

## Best Practices

- **Ask "can a stranger substitute this subtype blindly?"** If the honest answer is "only if they know it's actually the subclass," you have an LSP violation. Fix the design, not the caller.
- **Write the base type's contract down.** Even a one-line comment — "invariant: balance >= 0; width and height independent" — turns an implicit promise into a checkable one.
- **Never override a method just to throw `UnsupportedOperationException`.** That is the loudest possible LSP alarm. The type doesn't belong under that base type.
- **Prefer interfaces (pure contracts) over concrete base classes** when you mainly want subtyping. Concrete inheritance drags implementation details into the relationship and invites violations.
- **Prefer composition over inheritance** whenever you want code reuse without substitutability. Reach for `extends` only when the subtype is genuinely a stand-in for the base.
- **Treat "is-a" as a question, not an answer.** "Is a Square a Rectangle?" → "In code that mutates width and height independently? No." Always check against the actual contract.

---

## Edge Cases & Pitfalls

- **The override that *narrows* what it accepts.** A subtype method that rejects inputs the base accepted (a strengthened precondition) is a violation, even though it compiles. `Dog.eat(food)` that throws on vegetables breaks any caller holding an `Animal`.
- **The override that *throws where the base returned*.** Replacing a normal return with an exception weakens the postcondition. Callers expecting a value now get a crash.
- **Silent invariant corruption.** Square/Rectangle: nothing throws, nothing warns — `area()` just returns the wrong number. These are the hardest to catch because there's no exception, only a wrong answer downstream.
- **Empty/no-op overrides.** A subtype that overrides a method to "do nothing" often weakens a postcondition (the base promised an effect that no longer happens). Sometimes fine, often a smell.
- **Mutability is the accomplice.** Most classic LSP breaks (Square, mutable collections) need mutation to manifest. Immutable designs sidestep a whole category of these.
- **Structural typing's accidental matches.** In Go/TypeScript a type can satisfy an interface *by accident* because its method names happen to match — and then violate the *behavioral* contract you never declared. Structural subtyping checks shape, never meaning.
- **Confusing "compiles" with "substitutable."** The single most common junior trap: the code passes the type checker, so it must be a valid subtype. The type checker only ever checked the signature.

---

## Summary

- **S is a subtype of T** when an S value can be used *correctly* anywhere a T is expected. The **subsumption rule** lets an S value also count as a T.
- Subtyping comes in two flavors: **nominal** (subtype because declared — Java/C#/C++/Scala) and **structural** (subtype because the shape fits — Go/TypeScript).
- The compiler verifies the *signature*; the **Liskov Substitution Principle** governs the *behavior* — and it's the part with no compiler.
- A safe override must **not strengthen preconditions** (demand more), **not weaken postconditions** (deliver less), and **preserve invariants**. Memorize "**require less, promise more**."
- The canonical violation is **Square extends Rectangle**: `setWidth` breaks the rectangle's invariant that width and height are independent, so polymorphic code silently computes the wrong area.
- Other famous breaks: a **Penguin.fly()** that throws, and Java's **`unmodifiableList`** whose `add()` throws — a violation shipped on purpose because the hierarchy lacked a read-only supertype.
- **Inheritance is not subtyping.** `extends` gives code reuse; subtyping demands substitutability. **Prefer composition over inheritance**, split hierarchies when behavior diverges, and treat "is-a" as a hypothesis to test, not a fact to assume.

Move on to `middle.md` to make the four LSP rules precise, see function-type subtyping (contravariant parameters, covariant returns), and meet Design-by-Contract.
