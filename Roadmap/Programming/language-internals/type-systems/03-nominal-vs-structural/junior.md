# Nominal vs Structural Typing — Junior Level

> **Topic:** [Nominal vs Structural Typing](README.md)
> **Focus:** Two ways a compiler decides "does this value fit here?" — by the type's *name*, or by its *shape*. And why Go and TypeScript answer that question completely differently from Java and C#.

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

> Focus: **When you write `x = y` or `f(y)`, how does the compiler decide whether `y` is allowed?** Two whole language families answer this differently.

Every statically typed language has to answer one question over and over: *is this value compatible with the type that's expected here?* When you assign a value to a variable, pass an argument to a function, or return a value from a method, the compiler checks compatibility. There are two fundamentally different ways to decide it.

**Nominal typing** decides by **name and declared relationships**. A value of type `Dog` fits where a `Animal` is expected *only because someone wrote `class Dog extends Animal`* (or `implements`). If two types have exactly the same fields and methods but different names — and no declared `extends`/`implements` link — they are **incompatible**. The name is the identity. Java, C#, C++, Rust, and Swift work this way.

**Structural typing** decides by **shape**. A value fits wherever its *members* (fields, methods) match what's required — regardless of what the type is called or what it declares it inherits from. "If it has a `.Read()` method with the right signature, it *is* a `Reader`." Nobody has to declare the relationship. TypeScript, Go's interfaces, OCaml objects, and Scala's structural types work this way.

In one sentence: **nominal typing trusts the label on the box; structural typing opens the box and checks the contents.**

> 🎓 **Why this matters for a junior:** The first time you write Go, you'll define an interface and a struct that "magically" satisfies it without any keyword linking them — that's structural typing, and it surprises everyone coming from Java. The first time you write TypeScript, you'll pass an object literal that happens to have the right fields and it "just works" — also structural. Knowing which model your language uses tells you what errors to expect, why some refactors are safe, and why a certain class of bug (mixing up two IDs that are both strings) is so easy to write.

This page covers: what "by name" versus "by shape" really means, the canonical Go and TypeScript examples, the famous "I have a string for both `userId` and `productId` and I passed them in the wrong order" bug and how nominal typing prevents it, and the same idea shown across Java, C#, Go, TypeScript, and Rust.

---

## Prerequisites

What you should know before reading this:

- **Required:** What a *type* is — `int`, `string`, a class, a struct.
- **Required:** What an *interface* (or abstract type / trait) is at a basic level: a list of methods a type can promise to provide.
- **Required:** How to assign a variable and call a function with arguments in at least one language.
- **Helpful but not required:** Having written a class with `implements`/`extends` in Java or C#.
- **Helpful but not required:** Having seen a Go interface or a TypeScript interface.

You do **not** need to know:

- The formal subtyping rules or variance (that's `middle.md` and `senior.md`).
- How the compiler implements the check internally (that's `senior.md` and `professional.md`).
- Branded types, the newtype pattern, or coherence rules in detail (those build up across the higher tiers).

---

## Glossary

| Term | Definition |
|------|-----------|
| **Type compatibility** | The compiler's yes/no answer to "can a value of type A be used where type B is expected?" |
| **Nominal typing** | Compatibility decided by the type's **name** and explicitly **declared** relationships (`extends`, `implements`). Same shape + different name + no declaration = incompatible. |
| **Structural typing** | Compatibility decided by the type's **structure/shape** (its members). Same shape = compatible, regardless of name. |
| **Shape** | The set of a type's members — field names and types, method names and signatures — that a structural check compares. |
| **Interface** | A named set of method (and sometimes field) requirements. How a value *satisfies* it differs between nominal and structural languages. |
| **Implicit interface satisfaction** | Go's rule: a type satisfies an interface just by having the right methods. No `implements` keyword exists. |
| **Subtype** | A type usable wherever its supertype is expected. Nominal: declared. Structural: shape-implied. |
| **Duck typing** | The *dynamic* cousin of structural typing: "if it walks like a duck and quacks like a duck, treat it as a duck" — checked at runtime, not compile time. |
| **Newtype** | A distinct type wrapping an existing one (e.g. `UserId` wrapping `int`) so the compiler treats it as separate even though the representation is identical. |
| **Branded type** | TypeScript's trick to *fake* nominal typing inside a structural language by adding a fake marker property. |
| **Retroactive conformance** | A type satisfying an interface that was written *after* the type, without modifying the type. Structural typing gives this for free. |

---

## Core Concepts

### 1. The Two Questions a Compiler Asks

Picture a function `func print(a Animal)`. You call it with some value `x`. The compiler must decide: *is `x` an `Animal`?* The two type systems use different rules:

- **Nominal:** "Was `x`'s type *declared* to be an `Animal` or a subtype of `Animal`? Show me the `extends`/`implements`." If no such declaration exists, **rejected** — even if `x`'s type has every method `Animal` has.
- **Structural:** "Does `x`'s type *have everything* `Animal` requires (the right fields and methods)?" If yes, **accepted** — even if nobody ever mentioned `Animal` when defining `x`'s type.

That is the entire distinction. Everything else is consequences of this one rule.

### 2. Nominal Typing: The Name Is the Identity

In Java, this fails to compile:

```java
class Point2D { int x; int y; }
class Vector2D { int x; int y; }

Point2D p = new Point2D();
Vector2D v = p;   // ❌ COMPILE ERROR: incompatible types
```

`Point2D` and `Vector2D` are structurally identical — same fields, same types. But they have **different names** and no declared relationship, so the compiler refuses the assignment. The name is load-bearing. This is *intentional*: a point and a vector mean different things, and the language won't let you confuse them just because they happen to be laid out the same way.

To make two types compatible in a nominal system, you must **declare** the relationship:

```java
interface Shape { double area(); }
class Circle implements Shape {   // explicit "implements"
    double area() { return 3.14 * r * r; }
}
Shape s = new Circle();   // ✅ allowed because Circle DECLARES it implements Shape
```

The `implements Shape` is the contract. No `implements`, no compatibility — even if `Circle` has an `area()` method.

### 3. Structural Typing: The Shape Is the Identity

In Go, there is **no `implements` keyword**. A type satisfies an interface simply by having the methods:

```go
type Stringer interface {
    String() string
}

type Color struct{ R, G, B int }

func (c Color) String() string {   // just a method; never mentions Stringer
    return fmt.Sprintf("#%02x%02x%02x", c.R, c.G, c.B)
}

var s Stringer = Color{255, 0, 0}   // ✅ Color satisfies Stringer automatically
```

`Color` never says "I implement `Stringer`." It just *has* a `String() string` method, and that's enough. The compiler checks the shape: does `Color` have everything `Stringer` requires? Yes. Done.

The same idea in TypeScript with plain object shapes:

```typescript
interface Named { name: string; }

function greet(n: Named) { console.log("Hi " + n.name); }

greet({ name: "Ada", age: 36 });   // ✅ the object literal HAS a name field
```

The object isn't declared to be `Named`. It just *has* a `name: string`, so it fits.

### 4. The Bug Nominal Typing Catches and Structural Typing Misses

Here is the most practical reason to care. Imagine user IDs and product IDs are both stored as `string`:

```typescript
function getUser(userId: string) { /* ... */ }

const productId: string = "p_4815";
getUser(productId);   // ✅ COMPILES — but it's a bug! Wrong ID passed.
```

Because both are just `string`, the compiler sees nothing wrong. You shipped a bug. **Nominal typing** — or simulating it — fixes this: if `UserId` and `ProductId` are *distinct types* (different names), passing one where the other is expected is a compile error. This is the **newtype pattern**, and the higher tiers show how to get it in every language. For now, just register the idea: *giving the same-shaped data different names is sometimes exactly what you want.*

### 5. Duck Typing: The Dynamic Cousin

In Python (dynamically typed), there's no compile-time check at all. You just call the method and hope it exists:

```python
def make_it_speak(thing):
    return thing.speak()   # works for ANY object with a speak() method
```

If `thing` has `.speak()`, it works; if not, you get a runtime error. This is **duck typing**: compatibility is checked at *runtime* by trying the operation. Structural typing is essentially "duck typing checked at compile time" — same shape-based philosophy, but the compiler verifies it ahead of time so failures are caught before the program runs.

---

## Real-World Analogies

**The job application.** *Nominal* hiring: "We only hire people with a diploma from this specific university." You could be the best engineer alive, but without the named credential, you're rejected. *Structural* hiring: "Can you actually do the five tasks in the job description? Show us." The credential's name doesn't matter; your demonstrated abilities (your shape) do.

**Power plugs.** A *structural* world: any plug that physically fits the socket works. A *nominal* world: even if the plug fits perfectly, it only works if it's stamped "Approved Brand X" — the label, not the shape, decides.

**Passports vs. behavior.** Nominal typing is the border guard checking your *passport* (your declared nationality — a name). Structural typing is checking whether you can *speak the language and follow the customs* (your behavior — your shape). One asks "who are you declared to be?", the other asks "what can you actually do?".

**Twins with different names.** Two physically identical twins. A nominal system treats them as completely different people because their names differ. A structural system can't tell them apart — same shape, same person, as far as it's concerned. The newtype pattern is deliberately *labeling* the twins so you never confuse them.

---

## Mental Models

**Model 1 — "Label vs. contents."** Nominal: trust the label on the box; only open boxes whose label says the right word. Structural: ignore the label, open the box, check the contents fit.

**Model 2 — "Opt-in vs. automatic."** Nominal conformance is *opt-in*: a type must explicitly declare `implements X` to count. Structural conformance is *automatic*: the moment your type has the right shape, it counts — whether you intended it or not.

**Model 3 — "Compile-time duck typing."** If you already understand Python's "just call the method" style, structural typing is that same instinct, but the compiler proves the method exists before you run the program.

**Model 4 — "Names as guardrails."** In nominal systems, names are guardrails that stop you from mixing up same-shaped-but-different-meaning values (a `Meters` and a `Seconds` that are both `float64`). In structural systems, those guardrails don't exist by default — you have to build them (newtypes / branded types).

---

## Code Examples

### Nominal — Java (must declare `implements`)

```java
interface Greeter {
    String greet();
}

// This class has a greet() method but does NOT implement Greeter.
class Robot {
    public String greet() { return "BEEP"; }
}

class Person implements Greeter {   // <-- explicit declaration
    public String greet() { return "Hello"; }
}

class Demo {
    public static void main(String[] args) {
        Greeter g1 = new Person();   // ✅ Person declares implements Greeter
        // Greeter g2 = new Robot(); // ❌ COMPILE ERROR even though Robot has greet()
    }
}
```

Robot has the exact method, but without `implements Greeter`, Java rejects it. The shape is irrelevant; the declaration is everything.

### Nominal — C# (same rule)

```csharp
interface IGreeter { string Greet(); }

class Robot { public string Greet() => "BEEP"; }      // not declared
class Person : IGreeter { public string Greet() => "Hello"; }  // declared

IGreeter g = new Person();   // ✅
// IGreeter g2 = new Robot(); // ❌ Robot does not implement IGreeter
```

### Structural — Go (no `implements`, satisfied by shape)

```go
package main

import "fmt"

type Greeter interface {
    Greet() string
}

type Robot struct{}
func (r Robot) Greet() string { return "BEEP" }   // never names Greeter

type Person struct{}
func (p Person) Greet() string { return "Hello" } // never names Greeter

func main() {
    var g Greeter
    g = Robot{}   // ✅ Robot satisfies Greeter just by having Greet()
    fmt.Println(g.Greet())
    g = Person{}  // ✅ same — automatic
    fmt.Println(g.Greet())
}
```

Both `Robot` and `Person` satisfy `Greeter` with **zero** declaration. They simply have a `Greet() string` method. This is the canonical example of structural, implicit interface satisfaction.

### Structural — TypeScript (object literal fits by shape)

```typescript
interface Greeter {
    greet(): string;
}

const robot = { greet: () => "BEEP", batteryLevel: 80 };
const person = { greet: () => "Hello" };

function announce(g: Greeter) {
    console.log(g.greet());
}

announce(person);   // ✅ has greet()
announce(robot);    // ✅ has greet() (extra batteryLevel is fine for a variable)
```

Neither object is declared to be a `Greeter`. They just have a `greet(): string`, so they fit. (Passing an *object literal directly* triggers an extra check — covered in pitfalls.)

### The ID-mixup bug — and a first taste of the fix (Rust newtype)

```rust
// WITHOUT newtypes: both are just u64 — easy to swap by accident.
fn ban_user(user_id: u64, _moderator_id: u64) { /* ... */ }

// WITH newtypes: distinct names => the compiler stops the mix-up.
struct UserId(u64);
struct ModeratorId(u64);

fn ban_user2(user: UserId, _mod: ModeratorId) { /* ... */ }

fn main() {
    let u = UserId(10);
    let m = ModeratorId(99);
    ban_user2(u, m);          // ✅ correct order
    // ban_user2(m, u);       // ❌ COMPILE ERROR: ModeratorId is not UserId
}
```

Rust is nominal, so `UserId` and `ModeratorId` are different types even though both wrap a `u64`. Swapping them won't compile. That's the newtype pattern preventing a real bug.

---

## Pros & Cons

### Nominal typing

| Pros | Cons |
|------|------|
| **Intentionality**: you can't accidentally satisfy an interface — conformance is deliberate. | **Boilerplate**: every relationship must be declared (`implements`, `impl ... for`). |
| **Distinct types for same shapes**: `UserId` vs `OrderId`, `Meters` vs `Seconds` — prevents mix-up bugs. | **No retroactive conformance** (usually): you can't make a type from a library satisfy your interface without wrappers. |
| **Clearer error messages**: "Robot does not implement Greeter" names the missing contract directly. | **Harder mocking/testing**: a test double must explicitly declare it implements the interface. |
| **Controlled API evolution**: adding a method to an interface forces implementers to update *explicitly*. | More rigid; small one-off shapes feel heavyweight. |

### Structural typing

| Pros | Cons |
|------|------|
| **Flexibility & less boilerplate**: types fit interfaces with no declaration. | **Accidental conformance**: a type can satisfy an interface you never meant it to — silent surprises. |
| **Retroactive conformance**: a type written before the interface can still satisfy it. | **Same-shape confusion**: two `string` IDs are interchangeable; mix-up bugs slip through. |
| **Easy mocking**: any object with the right shape works as a test double. | **Murkier errors**: "missing property `greet`" rather than "does not implement Greeter". |
| **Great for ad-hoc / data-shaped code** (JSON, config). | Refactors that rename/remove a member silently change who conforms. |

---

## Use Cases

- **Nominal — domain modeling.** When `EmailAddress`, `UserId`, and `Password` are all "just strings" but must never be confused, distinct named types catch swaps at compile time.
- **Nominal — controlled libraries.** When you publish an interface and need every implementer to *opt in* explicitly so you can evolve the contract deliberately.
- **Structural — glue and plumbing.** Go's `io.Reader`/`io.Writer` work because *anything* with a `Read`/`Write` method fits, so files, network sockets, buffers, and your own types all interoperate without coordination.
- **Structural — working with data shapes.** TypeScript describing the shape of a JSON response: you don't want to declare a class, you just want "an object with these fields."
- **Structural — testing.** Pass a hand-rolled object with the right methods as a mock; no need to declare conformance.

---

## Coding Patterns

**Pattern: small interfaces (structural).** In Go, define interfaces with one or two methods (`Reader`, `Stringer`). Small shapes are easy to satisfy and maximize the benefit of implicit conformance.

```go
type Closer interface { Close() error }   // anything closeable fits
```

**Pattern: the newtype wrapper (nominal).** Wrap a primitive to get a distinct type and stop mix-ups.

```rust
struct Celsius(f64);
struct Fahrenheit(f64);   // can't accidentally add a Celsius to a Fahrenheit
```

**Pattern: accept interfaces, return concrete types (Go idiom).** Functions take structural interfaces (flexible inputs) but return concrete structs (clear outputs).

**Pattern: declare conformance explicitly even when not required (Java/C#/Rust).** In nominal languages you must, but the *benefit* is that the declaration documents intent and the error message points at the right contract.

---

## Best Practices

1. **Know which model your language uses.** Go interfaces and TypeScript = structural. Java/C#/Rust/Swift = nominal. This changes what mistakes are possible.
2. **In structural languages, don't rely on names for safety.** Two same-shaped types are interchangeable — if you need them distinct, build a newtype/branded type.
3. **Give semantically different values distinct types.** A `UserId` and `OrderId` should never both be a bare `string`/`int`, even though it's "more typing."
4. **In Go, keep interfaces small.** Big interfaces are hard to satisfy and undercut the flexibility structural typing is meant to provide.
5. **Let the compiler help.** When a Go type "mysteriously" satisfies an interface you didn't expect, that's structural typing working as designed — but double-check it's intended.
6. **Don't fight your language.** Faking nominal typing in TypeScript (branding) or structural in Java (reflection) is sometimes right, but it's advanced — reach for it deliberately, not by default.

---

## Edge Cases & Pitfalls

**1. Accidentally satisfying a Go interface.** You add a `Close() error` method to a struct for unrelated reasons, and suddenly it satisfies some `io.Closer`-based code path you never intended. The compiler won't warn you — there's no declaration to check. Be aware that *any* matching method set conforms.

**2. The "extra property" surprise in TypeScript.** A variable with extra fields can be passed to a smaller interface, but an **object literal** passed directly is checked more strictly (excess property check) and rejected:

```typescript
interface Point { x: number; y: number; }
function plot(p: Point) {}

const obj = { x: 1, y: 2, z: 3 };
plot(obj);              // ✅ via variable
plot({ x: 1, y: 2, z: 3 });  // ❌ excess property 'z' — literal is checked strictly
```

This trips up beginners constantly. The literal-vs-variable distinction is real.

**3. Same shape, different meaning.** In a structural language, `type Meters = number` and `type Seconds = number` are the *same type* — the alias is just a nickname. Adding meters to seconds compiles fine. You need a branded/newtype to separate them.

**4. Empty interfaces match everything.** Go's `interface{}` (or `any`) and TypeScript's `{}` are satisfied by almost anything because they require *no* members. An empty shape is the loosest possible structural requirement.

**5. Forgetting `implements` in a nominal language doesn't always error where you expect.** In Java, a class with the right method but no `implements` compiles fine on its own — the error only appears at the *assignment* to the interface type. The mismatch surfaces later than you'd think.

**6. Duck typing failures are runtime, not compile time.** In Python, calling `.speak()` on something without it crashes *when that line runs*, possibly only on a rare code path. Structural typing's whole point is to move that failure to compile time.

---

## Summary

- **Nominal typing** decides compatibility by **name and declared relationships**. Same shape, different name, no `implements`/`extends` ⇒ incompatible. (Java, C#, C++, Rust, Swift.)
- **Structural typing** decides by **shape**: have the right members ⇒ compatible, no declaration needed. (TypeScript, Go interfaces, OCaml objects, Scala structural types.)
- **Go's implicit interface satisfaction** is the canonical structural example: a type satisfies an interface just by having the methods.
- **Nominal gives intentionality** (no accidental conformance, distinct types for same shapes, clearer errors, controlled evolution). **Structural gives flexibility** (less boilerplate, retroactive conformance, easy mocking).
- The **newtype pattern** wraps a primitive in a distinct named type so the compiler stops you mixing up same-shaped values like `UserId` and `ProductId`.
- **Duck typing** is the dynamic, runtime-checked cousin of structural typing.
- TypeScript can *fake* nominal typing with **branded types**; Rust/Haskell get it naturally because they're nominal.

The higher tiers go deeper: the formal subtyping rules, how the compiler implements each check, branded types and the newtype pattern in detail, Rust trait coherence/orphan rules, and how real codebases choose between the two.
