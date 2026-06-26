# Nominal vs Structural Typing — Middle Level

> **Topic:** [Nominal vs Structural Typing](README.md)
> **Focus:** How type *identity* and *compatibility* are actually computed — width/depth subtyping, method-set matching, the newtype pattern as a tool, and TypeScript's excess-property check — so you can predict what your compiler will accept.

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

> Focus: **Given a value and an expected type, what exactly does the type checker compute to say yes or no?** And what tools (newtypes, branded types) let you opt into the *other* model when your language defaults one way?

At the junior level the distinction was a slogan: nominal checks the name, structural checks the shape. At this level we make it precise. "Compatibility" is really a **subtyping** question: is the actual type `S` a subtype of the expected type `T` (written `S <: T`), meaning a value of `S` is safe to use wherever `T` is required? Nominal and structural systems compute `S <: T` by entirely different procedures:

- **Nominal subtyping** walks a *declared* graph. `S <: T` holds iff there is a chain of declared `extends`/`implements`/`impl ... for` edges from `S` up to `T`. The check is essentially a graph reachability query over relationships the programmer wrote down.
- **Structural subtyping** compares *members*. `S <: T` holds iff `S` has *at least* everything `T` requires, with compatible types (this is **width** and **depth** subtyping, defined below). The check is a member-by-member comparison, recursing into field/parameter/return types.

Real languages are rarely 100% one or the other. Java is nominal for classes/interfaces but its generics use structural-ish wildcard bounds. Go is structural for interface satisfaction but nominal for *named types* (a `type Celsius float64` is a distinct type). TypeScript is overwhelmingly structural but bolts on private-field and brand tricks to recover nominal behavior. Understanding the *mechanism* lets you predict the corner cases instead of memorizing them.

> 🎓 **Why this matters at the middle level:** You're now writing interfaces, generics, and domain types that other people depend on. The difference between "this refactor is safe" and "this refactor silently broke a downstream consumer" comes down to understanding how your language computes compatibility. Structural systems make some refactors silently change conformance; nominal systems surface them as compile errors. You need to know which.

This page covers: subtyping as the unifying frame, width/depth subtyping, Go's method-set rules (pointer vs value receivers), the newtype pattern as a deliberate tool, TypeScript's excess-property check and its branded-type escape hatch, and how the same domain bug looks in each system.

---

## Prerequisites

- **Required:** Solid grasp of the junior page — name vs shape, Go's implicit satisfaction, the ID-mixup bug.
- **Required:** Comfort with interfaces/traits and generics in at least one language.
- **Required:** The notion of *subtype* — "usable in place of."
- **Helpful:** Having hit a confusing TypeScript assignability error or a Go "does not implement" error.
- **Helpful:** Awareness that method receivers in Go can be by value or by pointer.

You do **not** yet need: variance theory in full, row polymorphism formalism, or compiler internals — those are `senior.md`/`professional.md`.

---

## Glossary

| Term | Definition |
|------|-----------|
| **Subtyping (`S <: T`)** | `S` is a subtype of `T` if a value of `S` is safe wherever `T` is expected. The formal version of "compatibility." |
| **Nominal subtyping** | `S <: T` holds only via *declared* `extends`/`implements`/`impl` edges. |
| **Structural subtyping** | `S <: T` holds when `S`'s members satisfy `T`'s requirements, by shape. |
| **Width subtyping** | A record with *more* fields is a subtype of one with *fewer*: `{x, y, z} <: {x, y}`. Extra members are fine. |
| **Depth subtyping** | A record whose fields are *subtypes* of another's fields is a subtype: `{p: Dog} <: {p: Animal}` (under covariance). |
| **Method set** | In Go, the set of methods callable on a type; determines which interfaces it satisfies. Differs for value vs pointer. |
| **Newtype** | A distinct nominal type wrapping an existing representation, created precisely to *not* be interchangeable with it. |
| **Branded / opaque type** | A structurally-typed value carrying a phantom marker so the compiler treats it nominally. |
| **Excess property check** | TypeScript's stricter rule for *object literals* assigned directly: extra unlisted properties are rejected. |
| **Phantom type** | A type parameter that appears in the type but not in the runtime value, used to tag/distinguish otherwise-identical types. |
| **Type alias** | A *name* for an existing type that does **not** create a new distinct type (`type Meters = number` — still `number`). |
| **Assignability** | TypeScript's term for its (mostly structural) compatibility relation. |

---

## Core Concepts

### 1. Compatibility Is Subtyping

Whenever you assign, pass, or return a value, the checker asks `S <: T`. Both type systems answer this question — they just compute it differently.

**Nominal procedure (sketch):**
```
S <: T  iff  T == S, or T is a declared super-interface/super-class of S
             (transitively, following extends/implements edges)
```
It's reachability in a directed graph of *programmer-declared* edges. If you didn't write the edge, it doesn't exist.

**Structural procedure (sketch):**
```
S <: T  iff  for every member m required by T,
                 S has a member m' with the same name and  type(m') <: type(m)
```
It's a recursive, member-by-member comparison. No declarations consulted.

### 2. Width and Depth Subtyping (Structural)

Structural subtyping has two axes:

**Width** — having *more* makes you a subtype. An object with extra fields fits a type that asks for fewer:

```typescript
type P = { x: number };
const big = { x: 1, y: 2 };  // {x, y}
const p: P = big;            // ✅ {x,y} <: {x} — width subtyping
```

**Depth** — having *more specific* field types makes you a subtype:

```typescript
type HasAnimal = { pet: { legs: number } };
type HasDog    = { pet: { legs: number; bark(): void } };
const d: HasDog = { pet: { legs: 4, bark() {} } };
const h: HasAnimal = d;      // ✅ HasDog <: HasAnimal via depth (pet is more specific)
```

Together, width + depth define structural subtyping for records. Nominal systems have **neither** by default — `{x, y}` is not a subtype of `{x}` unless declared.

### 3. Go's Method Sets: Structural, But With Receiver Rules

Go's interface satisfaction is structural — but *which* methods count depends on value vs pointer receivers, a rule that bites everyone:

```go
type Speaker interface{ Speak() string }

type Dog struct{}
func (d *Dog) Speak() string { return "Woof" }  // POINTER receiver

func main() {
    var s Speaker
    s = &Dog{}   // ✅ *Dog has Speak() in its method set
    s = Dog{}    // ❌ Dog (value) does NOT — pointer-receiver method excluded
}
```

Rule: a method with a **value receiver** is in the method set of both `T` and `*T`; a method with a **pointer receiver** is only in the method set of `*T`. Structural matching then compares the *method set* of the value's type against the interface. So "does this type satisfy the interface?" is really "does this type's method set structurally cover the interface?"

### 4. Named Types: Go Is Nominal Too

Go interfaces are structural, but Go *named types* are nominal:

```go
type Celsius float64
type Fahrenheit float64

var c Celsius = 100
var f Fahrenheit = c   // ❌ cannot use Celsius as Fahrenheit (distinct named types)
var f2 Fahrenheit = Fahrenheit(c)  // ✅ explicit conversion required
```

Even though both are `float64` underneath, `Celsius` and `Fahrenheit` are *distinct* and not interchangeable without explicit conversion. This is the **newtype pattern**, built into Go's named types — a nominal feature inside a language famous for structural interfaces. Most languages mix the two models like this.

### 5. The Newtype Pattern as a Deliberate Tool

The newtype pattern: wrap a representation in a *distinct named type* so the compiler treats semantically different values as different, even though they share a layout.

```rust
struct UserId(u64);
struct ProductId(u64);

fn fetch_user(id: UserId) { /* ... */ }

let p = ProductId(42);
// fetch_user(p);  // ❌ ProductId is not UserId — bug caught at compile time
```

This is *opting into stronger nominal distinctions* than the raw representation gives you. It costs a wrapper and sometimes some unwrapping, and buys you immunity to an entire class of "passed the right-shaped value into the wrong slot" bugs. In Haskell it's `newtype UserId = UserId Int`; in Rust it's a tuple struct; in TypeScript it's a branded type (next section).

### 6. Branded Types: Faking Nominal in a Structural Language

TypeScript is structural, so `type UserId = string` and `type ProductId = string` are *the same type* — useless for separation. The **branded type** trick adds a phantom marker:

```typescript
type Brand<T, B extends string> = T & { readonly __brand: B };
type UserId    = Brand<string, "UserId">;
type ProductId = Brand<string, "ProductId">;

function asUserId(s: string): UserId { return s as UserId; }

function getUser(id: UserId) { /* ... */ }

const pid = "p_99" as ProductId;
// getUser(pid);  // ❌ ProductId lacks the "UserId" brand — now incompatible!
```

The `__brand` property never exists at runtime — it's a compile-time-only marker that makes the two structurally-identical strings *structurally different* (because the brand fields differ). This recovers nominal behavior inside a structural system. The `as` cast is the controlled "minting" point where a raw string becomes a `UserId`.

---

## Real-World Analogies

**Org charts vs. skill audits.** Nominal subtyping is asking HR for the *reporting chain* — "is this role under that department?" — answered by following declared lines. Structural subtyping is a skills audit — "does this person cover every responsibility on the list?" — answered by checking each requirement.

**Width subtyping = a fuller toolbox.** If a job needs a hammer and a screwdriver, a toolbox that *also* has a wrench still qualifies (more is fine). That's width subtyping: extra members never disqualify you.

**Branded money.** A `$10` bill and a casino chip might be "worth 10," but the casino chip is *branded* so you can't spend it at the grocery store. Branded types stamp a marker so same-valued things aren't interchangeable.

**Currency codes.** `USD` and `EUR` are both "a number with two decimals," but you must never add them directly. Newtypes are the currency code stamped on the amount.

---

## Mental Models

**Model 1 — "Two algorithms, one question."** Both systems compute `S <: T`. Nominal runs graph reachability over declared edges; structural runs recursive member matching. Predict behavior by mentally running the right algorithm.

**Model 2 — "More is a subtype."** In structural systems, having *more* members or *more specific* members makes you a subtype (width + depth). Train this intuition; it explains most "why did this assign?" surprises.

**Model 3 — "Brand = synthetic name."** A brand/phantom marker is a fake name glued onto a shape, turning a structural type into a nominal one on demand.

**Model 4 — "Aliases don't create types; newtypes do."** `type Meters = number` is a nickname (same type). `struct Meters(f64)` / `Brand<number,"Meters">` is a *new* type. Know which your syntax produces.

---

## Code Examples

### Nominal subtyping is declaration-driven (Java)

```java
interface A { void f(); }
interface B { void f(); }   // identical shape, different name

class Impl implements A {
    public void f() {}
}

A a = new Impl();   // ✅
// B b = new Impl(); // ❌ Impl doesn't declare implements B, despite identical shape
// A x = (A) someB;  // even a cast requires a declared relationship to be sound
```

### Structural subtyping is shape-driven (TypeScript)

```typescript
interface A { f(): void; }
interface B { f(): void; }   // identical shape, different name

const impl = { f() {} };
const a: A = impl;   // ✅
const b: B = impl;   // ✅ — both fit because the SHAPE matches; names ignored
const a2: A = ({} as B);  // ✅ B is structurally an A too — fully interchangeable
```

### Go method sets and interface satisfaction

```go
type Stringer interface{ String() string }

type T struct{ v int }
func (t T) String() string { return strconv.Itoa(t.v) }  // value receiver

func main() {
    var s Stringer
    s = T{1}    // ✅ value receiver => T and *T both satisfy
    s = &T{2}   // ✅
    // If String() used *T receiver, then s = T{1} would FAIL.
}
```

### Newtype prevents argument-swap bugs (Rust)

```rust
struct Meters(f64);
struct Feet(f64);

fn add_distance(a: Meters, b: Meters) -> Meters { Meters(a.0 + b.0) }

fn main() {
    let m = Meters(3.0);
    let f = Feet(10.0);
    // add_distance(m, f);  // ❌ Feet is not Meters — mismatched units caught
    let total = add_distance(Meters(3.0), Meters(2.0));  // ✅
    println!("{}", total.0);
}
```

### Branded types in TypeScript (nominal emulation)

```typescript
declare const __brand: unique symbol;
type Brand<T, B> = T & { [__brand]: B };

type AccountId = Brand<string, "AccountId">;
type SessionId = Brand<string, "SessionId">;

const mkAccount = (s: string) => s as AccountId;

function loadAccount(id: AccountId) {}

const sess = "s_1" as SessionId;
// loadAccount(sess);   // ❌ SessionId brand !== AccountId brand
loadAccount(mkAccount("a_1"));  // ✅
```

### Retroactive conformance: structural's superpower (Go)

```go
// This type was written long ago, before the Closer interface existed.
type LegacyHandle struct{}
func (l LegacyHandle) Close() error { return nil }

// Define the interface NOW:
type Closer interface{ Close() error }

func use(c Closer) {}
// LegacyHandle satisfies Closer with NO modification to LegacyHandle:
var _ = use(LegacyHandle{})   // ✅ retroactive conformance for free
```

In Java, `LegacyHandle` could not satisfy a `Closer` interface defined later without editing it (or wrapping it) to add `implements Closer`.

---

## Pros & Cons

### Nominal subtyping

| Pros | Cons |
|------|------|
| Conformance is intentional and auditable (grep for `implements`). | Cannot retroactively make a foreign type fit; needs adapter/wrapper. |
| Newtypes are first-class — distinct types for distinct meanings come naturally. | More declarations; small interfaces feel heavy. |
| Error messages name the missing contract. | Generics often need explicit bounds to regain flexibility. |
| Refactors that break conformance surface as compile errors. | Mocking requires a declared test double. |

### Structural subtyping

| Pros | Cons |
|------|------|
| Width/depth subtyping → flexible composition, less boilerplate. | Accidental conformance: a type can fit an interface unintentionally. |
| Retroactive conformance for foreign types, for free. | Aliases don't separate meaning; same-shape bugs slip through. |
| Trivial mocking — any matching shape works. | Renaming/removing a member silently changes who conforms. |
| Excellent for data-shaped code (JSON, config). | Excess-property and literal-vs-variable rules surprise people. |

---

## Use Cases

- **Newtypes for units and IDs.** `Meters`/`Feet`, `UserId`/`OrderId`, `Cents` — anywhere a swap would be a silent bug.
- **Go interfaces for plumbing.** `io.Reader`/`io.Writer` glue unrelated types together precisely because conformance is structural and retroactive.
- **Branded types in TS APIs.** Public functions that must not accept arbitrary strings (validated emails, sanitized HTML) brand their inputs.
- **Structural mocks in tests.** Replace a dependency with a minimal object that has just the methods under test.
- **Nominal interfaces for stable contracts.** A plugin API where implementers must explicitly opt in so you can evolve the contract deliberately.

---

## Coding Patterns

**Pattern: "smart constructor."** Only mint a branded/newtype value through a function that validates, so a `UserId` always came from a real validation.

```typescript
function parseEmail(s: string): Email | null {
    return s.includes("@") ? (s as Email) : null;  // Email = Brand<string,"Email">
}
```

**Pattern: compile-time conformance assertion (Go).** Force the compiler to verify a type satisfies an interface, near the definition:

```go
var _ io.Writer = (*MyBuffer)(nil)  // fails to compile if MyBuffer isn't a Writer
```

**Pattern: phantom type parameters.** Tag a generic value with a marker that has no runtime cost (`State<"open">` vs `State<"closed">`).

**Pattern: adapter for nominal retrofitting.** In Java, wrap a foreign class in an adapter that `implements YourInterface` to bolt on conformance the original lacks.

---

## Best Practices

1. **Reach for newtypes/branded types whenever two values share a representation but not a meaning.** IDs, units, validated strings.
2. **In Go, write the `var _ Iface = (*T)(nil)` assertion** so accidental loss of conformance is a compile error, not a runtime surprise.
3. **Remember the receiver rule.** Pointer-receiver methods are only in `*T`'s method set; satisfy interfaces with the right value/pointer.
4. **Distinguish aliases from new types.** If you need separation, make sure your syntax creates a *new* type, not a nickname.
5. **Mint branded values at a single chokepoint** (a parser/validator), never with scattered `as` casts.
6. **In structural systems, treat renaming a public member as a breaking change** — it can silently drop conformance for consumers.
7. **Prefer small interfaces in structural languages**; they maximize flexibility and minimize accidental conformance surface.

---

## Edge Cases & Pitfalls

**1. Excess-property check fires only on literals.** Assigning a *variable* with extra fields is allowed (width subtyping); passing an *object literal* with extra fields is rejected. Same data, different rule, because TS heuristically assumes a literal with extra fields is a typo.

**2. Type aliases give false confidence.** `type UserId = string` looks like a distinct type but is just `string`. It documents intent but provides *zero* safety — a plain string passes everywhere. Only branding/newtype actually separates them.

**3. Go pointer/value receiver mismatch.** You define methods on `*T`, store a `T` value in an interface variable, and get "does not implement." The fix is to use `&t` or define value receivers — and the error message often doesn't make the receiver issue obvious.

**4. Structural matching recurses — and can be surprisingly permissive.** `{ id: number }` is a subtype of `{}` (the empty type), so a function expecting `{}` accepts almost anything. Empty/loose shapes silently accept too much.

**5. Optional/extra members and function-parameter bivariance.** TypeScript historically allowed method parameters to be compared bivariantly, letting unsound assignments through. (Covered formally in `senior.md`; just know structural function compatibility has subtle, sometimes-unsound corners.)

**6. Newtype ergonomics tax.** Wrapping a primitive means you can't use its operators directly (`a + b` on two `Meters` tuples needs `Meters(a.0 + b.0)`). Teams sometimes skip newtypes to avoid this friction — and then hit the swap bugs they were meant to prevent.

**7. Branded types are erased.** A brand is compile-time only; at runtime a `UserId` *is* a string. Don't expect runtime checks from branding — validate at the boundary.

---

## Summary

- Compatibility is **subtyping** (`S <: T`). Nominal computes it by graph reachability over *declared* edges; structural by recursive *member* comparison.
- **Width** subtyping (more fields) and **depth** subtyping (more specific fields) define structural record subtyping; nominal has neither by default.
- **Go is hybrid:** interfaces are structural (via method sets, with value/pointer receiver rules) while named types are nominal.
- The **newtype pattern** deliberately creates distinct types over a shared representation to stop same-shape mix-ups (`Meters`/`Feet`, `UserId`/`ProductId`).
- **Branded/phantom types** fake nominal typing inside a structural language by attaching a compile-time-only marker; **type aliases** do *not* — they're just nicknames.
- Structural typing's signature strengths are **retroactive conformance** and **trivial mocking**; its signature risks are **accidental conformance** and **same-shape confusion**, plus TS's literal-vs-variable excess-property quirk.
- Use compile-time conformance assertions and single-chokepoint minting to make these systems work *for* you.

The senior tier formalizes the subtyping rules (variance, row polymorphism, the function-parameter soundness issue) and explains how compilers actually implement each check; the professional tier covers Rust trait coherence/orphan rules and large-codebase trade-offs.
