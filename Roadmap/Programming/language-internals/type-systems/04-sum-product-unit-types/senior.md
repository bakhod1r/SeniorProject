# Sum, Product & Unit Types — Senior Level

> **Topic:** [Sum, Product & Unit Types](README.md)
> **Focus:** ADTs as a design discipline — the expression problem, recursive/initial-algebra types, "make illegal states unrepresentable" at scale, and how sum types replace null and exceptions across a whole codebase.

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
13. [Test Yourself](#test-yourself)
14. [Cheat Sheet](#cheat-sheet)
15. [Summary](#summary)
16. [What You Can Build](#what-you-can-build)
17. [Further Reading](#further-reading)

---

## Introduction

> Focus: **ADTs are not a syntax feature — they are an architecture.** At the senior level the question stops being "how do I write an enum" and becomes "what does choosing sums-and-products commit my whole codebase to, and when is that the wrong commitment?"

By now the mechanics are second nature: products are AND, sums are OR, the algebra predicts cardinality and layout, exhaustiveness turns missed cases into compile errors. This level is about the *consequences* of leaning on that machinery as a design philosophy.

Three big ideas anchor this page:

1. **The expression problem.** A closed sum makes adding *operations* trivial and exhaustiveness-checked, but adding *variants* edits every operation. Object-oriented polymorphism makes the opposite trade. This is a fundamental, named tension — not a Rust-vs-Java flame war — and a senior chooses the side that matches how the system will actually evolve.

2. **Recursive ADTs as initial algebras.** Lists, trees, ASTs, and the JSON value type are *self-referential* sums. Understanding them as "least fixed points" / *initial algebras* explains folds (catamorphisms), why structural recursion always terminates, and how to derive a `fold`/`reduce` for any ADT mechanically.

3. **"Make illegal states unrepresentable" at architectural scale.** The junior version is "use a sum instead of a struct with flags." The senior version is a methodology: parse, don't validate; push invariants into types via smart constructors and newtypes; encode protocol/state-machine legality so the *type checker* enforces it; and replace null and exceptions with `Option`/`Result` as a codebase-wide error-handling stance, with all the ergonomics (`?`, monadic combinators, error taxonomies) that entails.

> 🎓 **Why this matters at the senior level:** The cost of a data-modeling decision is paid by every engineer who touches that data for years. Choosing the right combine-operation (and knowing when sums are the *wrong* tool because the system is variant-heavy and operation-stable) is exactly the kind of leverage decision seniors are paid for. So is knowing that "make illegal states unrepresentable" can be overdone into unreadable type-Tetris.

---

## Prerequisites

- **Required:** Junior and middle pages — the algebra, layout, niche optimization, and exhaustiveness.
- **Required:** Real experience writing non-trivial sum types and recursive ADTs (an interpreter, a parser, a protocol model).
- **Required:** Comfort with generics/parametric polymorphism and at least passing familiarity with traits/typeclasses/interfaces.
- **Helpful:** Exposure to a visitor pattern or class hierarchy in an OO language (you'll see why it's the dual of a sum).
- **Helpful:** Any contact with error-handling-as-values (`Result`, `Either`, Go's error returns).

You do **not** need category theory beyond the informal "initial algebra = the fold falls out" intuition. The dependently-typed and GADT material is `professional.md`.

---

## Glossary

| Term | Definition |
|------|-----------|
| **Expression problem** | The difficulty of adding both new variants *and* new operations to a datatype without modifying existing code or losing type safety. |
| **Open vs closed sum** | Closed: variant set fixed at definition (enables exhaustiveness). Open/extensible: variants addable later (loses it). |
| **Visitor pattern** | An OO encoding of a closed sum: a fixed set of node classes plus a `visit` method per operation. The dual of a sum + match. |
| **Initial algebra** | The "smallest" type closed under a set of constructors; recursive ADTs are initial algebras of their constructor functor. |
| **Catamorphism / fold** | The unique structure-collapsing function from an initial algebra; `fold`/`reduce` over a list or tree. |
| **Functor (data)** | A type constructor `F` with a `map`; `List`, `Option`, `Tree` are functors. The "shape" a recursive type is built from. |
| **Smart constructor** | A validating constructor returning `Option`/`Result`, used to make a type's *only* inhabitants the legal ones. |
| **Parse, don't validate** | Push validation to the boundary, returning a *more precise type* whose existence proves the data is valid. |
| **Phantom type** | A type parameter with no runtime data, used to tag state/units at compile time (`Meters`, `Validated`). |
| **Typestate** | Encoding an object's state-machine state in its type so illegal transitions don't compile. |
| **Railway-oriented programming** | Chaining `Result`-returning steps so failures short-circuit; the "two-track" pipeline metaphor. |
| **Effect-as-data** | Representing what *would* be an effect/exception as a returned sum value (`Result`, error ADT). |

---

## Core Concepts

### 1. The expression problem, precisely

You have a datatype with **variants** (kinds of value) and **operations** (functions over them). Lay them out as a grid:

```
              area()   perimeter()   draw()      ← operations (columns)
   Circle      ✓          ✓           ✓
   Square      ✓          ✓           ✓
   Triangle    ✓          ✓           ✓
      ▲
   variants (rows)
```

You want to add a **new column** (operation) *and* a **new row** (variant) without editing existing cells and without runtime casts. The expression problem is that mainstream tools make exactly one of these cheap:

- **Sum + pattern match (FP style):** a function spans a column. Adding an **operation** = writing one new function, exhaustiveness-checked, touching nothing. Adding a **variant** = editing *every* function (every match grows an arm) — but the compiler lists them for you.
- **Interface + classes (OO style):** a class spans a row. Adding a **variant** = writing one new class implementing the interface, touching nothing. Adding an **operation** = adding a method to the interface, forcing edits to *every* class.

Neither is "better." The senior question is: **which axis of this datatype is volatile?** If you'll add operations forever over a stable set of cases (an AST whose node kinds rarely change but whose passes keep growing) → sum types win decisively. If you'll add cases forever with a stable set of operations (a plugin system where each plugin is a new kind, all answering the same fixed interface) → interfaces win. Choosing wrong means a lifetime of "shotgun surgery" on every change.

Solutions that get *both* exist (typeclasses + open data via "Data Types à la Carte," the visitor with double dispatch, multimethods, tagless-final encodings) but they cost complexity. Reach for them only when you genuinely need both axes open.

### 2. The visitor pattern is a closed sum in disguise

When an OO language lacked sum types, the **visitor pattern** reconstructed them. A sealed set of node classes (`Circle`, `Square`) plus a `Visitor` interface with one method per node *is* a closed sum plus a match: the node set is the variants, the visitor is the function-out-of-the-sum, and "every visitor must implement every method" is hand-rolled exhaustiveness. Recognizing this tells you when a visitor is the right tool (closed variant set, many operations, in a language without native sums) and when it's ceremony you can delete (a language with sealed types and pattern matching). Java's `sealed` + `record` + switch patterns make the visitor obsolete for closed hierarchies.

### 3. Recursive ADTs are initial algebras; folds fall out

A recursive ADT references itself:

```
List a  =  Nil  |  Cons a (List a)        -- 1 + a × List a
Tree a  =  Leaf a | Node (Tree a) (Tree a) -- a + Tree × Tree
Expr    =  Lit Int | Add Expr Expr | Mul Expr Expr
```

Each is the **least fixed point** of a "shape functor" — the *initial algebra*. The payoff: every initial algebra has a **unique** structure-collapsing function, the **catamorphism** (`fold`). You don't invent `fold`; you read it off the constructors. For `Expr`, the fold replaces each constructor with a function of the same arity:

```
foldExpr  litF addF mulF  on  (Lit n)    = litF n
                              (Add a b)   = addF (rec a) (rec b)
                              (Mul a b)   = mulF (rec a) (rec b)
```

An evaluator is `foldExpr id (+) (*)`. A pretty-printer is a different algebra over the same fold. A node-counter is another. This is why interpreters built on ADTs are so clean: the recursion scheme is mechanical, and structural recursion over a *finite* value always terminates (every recursive call is on a strictly smaller subterm — no separate termination proof needed).

### 4. "Make illegal states unrepresentable" — the methodology

The junior slogan becomes a discipline with several moves:

- **Replace flags+nullables with sums** (the entry move): a state-bearing struct → a sum where each variant carries exactly its state's data.
- **Smart constructors** make a type's inhabitants *exactly* the legal values (`Percent` is `0..=100`, an `Email` has parsed structure). The raw constructor is private; the public one validates and returns `Option`/`Result`.
- **Newtypes** give same-shaped values distinct identities (`UserId` vs `OrderId`, `Meters` vs `Feet`) so the compiler refuses to mix them — units bugs, ID swaps, and tainted-vs-clean string confusion become type errors.
- **Parse, don't validate** (Alexis King's framing): instead of a `validate(input): bool` you call once and hope nobody forgot, write `parse(input): Result<Validated, Error>` that *returns a more precise type*. Downstream code takes `Validated`, and the *existence of that value is the proof* the data is good. You can't "forget to check" because there's nothing un-checked to pass.
- **Typestate / phantom types** push a value's *state-machine position* into its type, so calling `send()` on an unopened `Connection<Closed>` is a compile error, not a runtime panic.

The throughline: every illegal state you make unrepresentable is a class of runtime bug — and a class of defensive `if`-checks — that you delete permanently.

### 5. Null is a missing sum type; `Option` restores it

`null` is the degenerate, *implicit* sum: every reference type is secretly `T + null`, but the `+ null` is invisible, unchecked, and infectious. The compiler can't force you to handle the `null` branch because the branch isn't in the type — hence Hoare's "billion-dollar mistake." `Option<T>` makes the *exact same* `1 + T` **explicit and checked**: now "absent" is a real variant you must pattern match, and a plain `T` *guarantees presence*. The fix isn't a new idea; it's making the sum that was always there visible to the type checker.

Crucially, `Option` *composes* where null doesn't: `map`, `and_then`/`flatMap`, `unwrap_or`, `?`. Null forces nested defensive `if x != null` pyramids; `Option` flattens them into a pipeline.

### 6. `Result`/`Either` is exceptions-as-data

Exceptions are an *invisible* sum on the return type: a function "returning `T`" actually returns `T + (some unspecified set of throwables)` via a hidden control channel. The type doesn't say which errors, callers can't be forced to handle them, and the happy path and error path live in different syntactic worlds. `Result<T, E>` (= `T + E`) puts the error case **in the return type**, makes it **part of the function's contract**, and forces handling. Trade-offs are real and worth naming as a senior:

- **Pro:** errors are explicit, exhaustively typed, local, and visible in signatures; no invisible non-local control flow.
- **Pro:** you can model an *error taxonomy* as a sum (`enum DbError { Timeout, NotFound, Conflict(Id) }`) and exhaustively handle it.
- **Con:** boilerplate without sugar — which is why ergonomic languages add `?`/`try` operators, `map_err`, and error-conversion traits (`From`) so propagation is one character.
- **Con:** truly *exceptional* conditions (OOM, stack overflow, programmer-bug panics) are still better as unwinding; `Result` is for *expected* failures.

The senior stance: **`Result` for expected, recoverable, part-of-the-contract failures; panic/exception for bugs and unrecoverable conditions.** Don't `Result`-ify a logic error; don't `throw` a "file not found."

### 7. Railway-oriented programming: composing `Result` pipelines

A chain of fallible steps composes as a two-track railway: stay on the success track, and any failure switches you onto the error track and skips the rest.

```
parse ──► validate ──► enrich ──► save        (success track)
   │          │           │         │
   └──────────┴───────────┴─────────┴──►  error track (short-circuits to the end)
```

`and_then`/`flatMap` is the switch; `?` is its syntax. This turns a nest of `if err != nil { return }` into a linear pipeline, and because each step's error type is part of the sum, the final error is exhaustively known.

### 8. When sums are the *wrong* tool

Seniority includes knowing the anti-cases:

- **Open, plugin-style extensibility** where third parties add variants you'll never enumerate → interfaces/traits, not a closed sum.
- **Wide, sparse data** (hundreds of optional fields, like a config or a protobuf message) → a product with optionals is often clearer than an explosion of variants; the algebra would be enormous but the *modeling* is genuinely "lots of independent optionals."
- **Performance-critical hot paths** where a fat sum forces large allocations or branch-heavy matching → sometimes a struct-of-arrays or a hand-tuned layout beats the idiomatic sum.
- **Over-encoded invariants** where pushing *everything* into types yields unreadable, un-evolvable type-level gymnastics. "Make illegal states unrepresentable" has a point of diminishing returns; some invariants are better as a runtime check with a good error.

---

## Real-World Analogies

| Concept | Real-world thing |
|---------|------------------|
| **Expression problem (sum side)** | A recipe book: adding a new *technique* (operation) means one new section; adding a new *ingredient* (variant) means revising every recipe. |
| **Expression problem (OO side)** | A staff of specialists: hiring a new specialist (variant) is easy; teaching *every* specialist a new procedure (operation) touches everyone. |
| **Visitor pattern** | A clipboard passed to each station; each station fills in its own line — a hand-rolled "handle every case." |
| **Initial algebra / fold** | A demolition crew that collapses any building floor-by-floor with the same rule, no matter the shape. |
| **Parse, don't validate** | Airport security: once you're past the checkpoint you carry a boarding pass that *proves* you were screened; nobody re-screens you at the gate. |
| **Typestate** | A door that physically can't be locked while open — the mechanism forbids the illegal state. |
| **null as hidden sum** | An unlabeled package that *might* be empty; you only find out when you open it and it explodes. |
| **Railway-oriented** | A train that, on any fault, is shunted onto the breakdown track and coasts to the end station, skipping the remaining stops. |

---

## Mental Models

### The "Volatility Axis" Model

Before choosing sum vs interface, ask: *over the next two years, which grows — the set of cases or the set of operations?* Draw the variant×operation grid and predict which dimension is volatile. Put the volatile dimension on the axis your tool makes cheap. Sums make *operations* cheap; interfaces make *variants* cheap. Pick to match the future, not the present.

### The "Proof-Carrying Value" Model

Stop thinking of types as *labels* and start thinking of them as *proofs*. A `Validated<Email>` value is a proof that validation happened. A `Connection<Open>` is a proof the connection is open. "Parse, don't validate" is just: *manufacture the proof at the boundary, then let the type system carry it for free everywhere downstream.* Defensive checks deep in the code mean someone failed to carry a proof.

### The "Errors Are Just Data" Model

An exception is data smuggled through a side channel; a `Result` is the same data carried in the open. Once you see errors as ordinary sum values, the whole apparatus — taxonomies, `map_err`, conversion, exhaustive handling, pipelines — is just normal data manipulation. The mystique of "error handling" dissolves into "I have a sum, I match on it."

---

## Code Examples

### The two sides of the expression problem (Rust sum vs trait)

```rust
// ---- SUM SIDE: operations are cheap, variants are expensive ----
enum Shape { Circle(f64), Square(f64) }

fn area(s: &Shape) -> f64 {            // new OPERATION = new fn, nothing else changes
    match s {
        Shape::Circle(r) => std::f64::consts::PI * r * r,
        Shape::Square(s) => s * s,
    }
}
fn perimeter(s: &Shape) -> f64 {       // another new operation, again trivial
    match s {
        Shape::Circle(r) => 2.0 * std::f64::consts::PI * r,
        Shape::Square(s) => 4.0 * s,
    }
}
// But adding `Triangle` forces edits to BOTH area and perimeter
// (the compiler will list them — non-exhaustive match errors).

// ---- TRAIT SIDE: variants are cheap, operations are expensive ----
trait Shape2 { fn area(&self) -> f64; }      // operations live in the trait
struct Circle2(f64);
struct Square2(f64);
impl Shape2 for Circle2 { fn area(&self) -> f64 { std::f64::consts::PI * self.0 * self.0 } }
impl Shape2 for Square2 { fn area(&self) -> f64 { self.0 * self.0 } }
// Adding `Triangle2` = one new impl, touch nothing.
// But adding `perimeter` to the trait forces edits to EVERY impl.
```

### Recursive ADT + a fold-derived interpreter (Haskell)

```haskell
data Expr = Lit Int
          | Add Expr Expr
          | Mul Expr Expr
          | Neg Expr

-- The fold (catamorphism) reads straight off the constructors:
foldExpr :: (Int -> r) -> (r -> r -> r) -> (r -> r -> r) -> (r -> r) -> Expr -> r
foldExpr lit add mul neg = go where
  go (Lit n)   = lit n
  go (Add a b) = add (go a) (go b)
  go (Mul a b) = mul (go a) (go b)
  go (Neg a)   = neg (go a)

eval :: Expr -> Int
eval = foldExpr id (+) (*) negate          -- one algebra

countNodes :: Expr -> Int
countNodes = foldExpr (const 1) (\a b -> 1+a+b) (\a b -> 1+a+b) (\a -> 1+a)  -- another

-- Add an operation (a new fold algebra) = trivial. Add a constructor = edit every fold.
```

### Parse, don't validate (Rust)

```rust
// WEAK: a bool check you can forget to call, and a type that lies.
fn is_valid_email(s: &str) -> bool { s.contains('@') }
fn send_weak(addr: &str) { /* hopefully someone validated... */ }

// STRONG: parsing returns a MORE PRECISE TYPE; its existence is the proof.
pub struct Email(String);                    // private field: only `parse` can build one
impl Email {
    pub fn parse(s: &str) -> Result<Email, &'static str> {
        if s.contains('@') && !s.starts_with('@') {
            Ok(Email(s.to_string()))
        } else {
            Err("invalid email")
        }
    }
    pub fn as_str(&self) -> &str { &self.0 }
}
fn send_strong(addr: &Email) { /* CANNOT be called with unvalidated input */ }
// Downstream takes `&Email`, never `&str`. The check happens exactly once, at the boundary.
```

### Typestate: illegal transitions don't compile (Rust phantom types)

```rust
use std::marker::PhantomData;

struct Open; struct Closed;                      // zero-size state markers (phantoms)

struct Door<State> { _state: PhantomData<State> }

impl Door<Closed> {
    fn new() -> Door<Closed> { Door { _state: PhantomData } }
    fn open(self) -> Door<Open> { Door { _state: PhantomData } }   // Closed -> Open
}
impl Door<Open> {
    fn close(self) -> Door<Closed> { Door { _state: PhantomData } } // Open -> Closed
    fn walk_through(&self) { /* only legal while Open */ }
}

fn demo() {
    let d = Door::<Closed>::new();
    let d = d.open();
    d.walk_through();          // OK: it's Open
    let _d = d.close();
    // _d.walk_through();      // COMPILE ERROR: no such method on Door<Closed>
}
```

The state machine's legality is now a *type* fact: you cannot call `walk_through` on a closed door, cannot `open` an already-open one, etc. Unit-like zero-size types (`Open`, `Closed`) carry the state with no runtime cost.

### Error taxonomy as a sum + railway pipeline (Rust)

```rust
#[derive(Debug)]
enum AppError { NotFound, Timeout, Invalid(String) }

fn load(id: u32) -> Result<Raw, AppError> { /* ... */ Ok(Raw) }
fn parse(r: Raw) -> Result<Parsed, AppError> { /* ... */ Ok(Parsed) }
fn save(p: Parsed) -> Result<(), AppError> { /* ... */ Ok(()) }

struct Raw; struct Parsed;

fn pipeline(id: u32) -> Result<(), AppError> {
    let raw = load(id)?;        // `?` = the railway switch: on Err, return early
    let parsed = parse(raw)?;
    save(parsed)?;              // happy path reads top-to-bottom; errors short-circuit
    Ok(())
}

fn handle(id: u32) {
    match pipeline(id) {
        Ok(())                  => println!("done"),
        Err(AppError::NotFound) => println!("404"),
        Err(AppError::Timeout)  => println!("retry later"),
        Err(AppError::Invalid(why)) => println!("bad input: {why}"),
        // exhaustive: add a variant to AppError and this match won't compile
    }
}
```

### Java: closed hierarchy with `sealed` + records + switch patterns (modern)

```java
sealed interface Shape permits Circle, Rectangle {}     // CLOSED sum
record Circle(double radius) implements Shape {}
record Rectangle(double w, double h) implements Shape {} // products via records

static double area(Shape s) {
    return switch (s) {                                  // exhaustive switch
        case Circle c    -> Math.PI * c.radius() * c.radius();
        case Rectangle r -> r.w() * r.h();
        // no default needed: `sealed` lets javac verify exhaustiveness.
        // Add a permitted type and forget a case -> compile error.
    };
}
```

`sealed` (Java 17) closes the permit-list so the compiler knows the full variant set; `record` gives concise product variants; switch patterns give the match. This is native ADTs reaching mainstream OO — the visitor pattern is no longer needed for closed hierarchies.

---

## Pros & Cons

| Aspect | Pros | Cons |
|--------|------|------|
| **Evolvability (operations)** | New operations are trivial, isolated, exhaustiveness-checked. | New *variants* are shotgun surgery across every operation (compiler-guided, but real work). |
| **Correctness** | Illegal states deleted; parse-don't-validate removes "forgot to check" bugs; typestate forbids illegal transitions. | Over-encoding invariants yields unreadable type-Tetris and brittle, hard-to-evolve APIs. |
| **Error handling** | Errors explicit, typed, local, exhaustively handled; no invisible non-local control flow. | Boilerplate without `?`/`try` sugar; wrong tool for genuinely exceptional (bug/OOM) conditions. |
| **Interpreters/ASTs** | Folds fall out of the structure; recursion is mechanical and provably terminating. | Deeply recursive folds can stack-overflow without an explicit stack/trampoline. |
| **Extensibility** | Closed sums enable exhaustiveness. | Closed sums block third-party variants; the expression problem's "both axes open" needs heavier machinery. |
| **Performance** | Compact layouts, niche optimization, no vtable for matches. | Fat variants bloat values; very hot paths may want non-idiomatic layouts. |

---

## Use Cases

- **Compilers, interpreters, query engines:** stable node set, ever-growing passes/operations → the canonical sum-type win; folds and exhaustive matches are the whole architecture.
- **Protocol and state-machine modeling:** encode states as a sum (or typestate), so illegal transitions and missing-field states can't be constructed.
- **Domain modeling:** "an order is Draft | Placed | Shipped | Cancelled," each carrying exactly its state's data — the textbook "illegal states unrepresentable" application.
- **Codebase-wide error strategy:** `Result`/`Either` with an error taxonomy sum and `?`-style propagation, reserving panics/exceptions for bugs.
- **Boundary parsing:** every external input (HTTP body, config, CLI arg) parsed into precise internal types at the edge, so the core handles only valid data.
- **Knowing when to *avoid* sums:** plugin systems and third-party-extensible kinds → interfaces; wide sparse records → products with optionals.

---

## Coding Patterns

### Pattern 1: Match the volatile axis

Decide sum-vs-interface by which dimension (variants or operations) will grow. Document the choice and its reason near the type definition, so the next engineer knows which changes are cheap.

### Pattern 2: Parse-don't-validate at every boundary

Every external input gets a `parse(raw) -> Result<Precise, Error>` at the edge. The core takes only the precise types. Validation happens exactly once, and "valid" is a type, not a convention.

### Pattern 3: Newtypes for every distinct identity and unit

Wrap `u64`s that mean different things (`UserId`, `OrderId`) and numbers with units (`Meters`, `Seconds`) in newtypes. Zero runtime cost, eliminates mix-ups the compiler can now catch.

### Pattern 4: Error taxonomy as a sum + `From` conversions + `?`

Model your domain errors as an `enum`, implement conversions from lower-level errors, and let `?`/`try` propagate. Handle exhaustively at the top.

### Pattern 5: Derive the fold; write operations as algebras

For recursive ADTs, write one `fold`/`cata` and express every operation (eval, print, count, optimize) as an algebra fed to it. New operation = new algebra, never new recursion.

### Pattern 6: Typestate for safety-critical lifecycles

When calling a method in the wrong state is dangerous (a closed socket, an uncommitted transaction), encode state in a type parameter so the wrong call doesn't compile.

---

## Best Practices

- **Choose sum-vs-interface by the volatility axis, and write down why.** This decision compounds for years.
- **Push validation to the boundary; carry proofs in types.** Parse, don't validate. The core should be unable to receive invalid data.
- **Use `Result` for expected failures, panic/exception for bugs.** Don't conflate "the file is missing" (a `Result`) with "this invariant is violated" (a bug → panic).
- **Model an error taxonomy as a sum and handle it exhaustively at the edges.** Avoid stringly-typed errors in the core.
- **Avoid wildcard arms over your own closed sums** so adding a variant remains a compiler-guided refactor.
- **Express recursive-type operations as folds/algebras,** not ad-hoc recursion, so they stay uniform and total.
- **Know when to stop.** "Make illegal states unrepresentable" has diminishing returns; some invariants belong in a runtime check with a clear error, not in a type-level proof nobody can read.
- **Prefer native sums (sealed/enum/data) over visitor or class-hierarchy fakes** when the language offers them.

---

## Edge Cases & Pitfalls

- **Variant-heavy datatypes punish the sum side.** If you keep adding cases, every operation grows. Re-evaluate whether an interface fits better — the compiler's "non-exhaustive" errors are a *symptom* you may be on the wrong axis.
- **`#[non_exhaustive]` / open enums break downstream exhaustiveness.** Marking a public enum non-exhaustive protects *you* from breaking changes but forces *every* downstream match to carry a wildcard — they lose the safety. Document it loudly.
- **Deep recursive folds overflow the stack.** A 1M-node list folded with naive recursion blows the stack in strict languages. Use an explicit stack, a trampoline, or tail-recursive accumulation.
- **Over-engineered typestate becomes unusable.** Phantom-type state machines with a dozen states and generic plumbing can make the API impenetrable. Encode the *dangerous* transitions, not every transition.
- **`Result` everywhere creates "error soup."** Without a deliberate taxonomy and conversion strategy, a function's error type becomes a sprawling union of everything below it. Define error boundaries; convert at module edges.
- **Smart constructors leak if the field isn't truly private.** If any code path can build the type without the validation, the invariant is a lie. Keep raw constructors private and audit every construction site.
- **Parsing twice defeats the point.** If both the boundary *and* the core re-validate, you've kept the runtime cost and the "forgot to check" risk. Validate once, then trust the type.
- **Sum types don't model "many independent optionals" well.** A record with 40 optional fields is not 2^40 variants; it's genuinely a product of optionals. Forcing it into a sum explodes pointlessly.

---

## Test Yourself

1. Draw the variant×operation grid for a JSON value type and a set of operations (pretty-print, validate-schema, count-nodes, redact-secrets). Which axis is volatile? Does that favor sums or interfaces? Now do the same for a UI-widget plugin system.
2. Show how a visitor pattern over a sealed set of classes is isomorphic to a sum + match. What plays the role of exhaustiveness in the visitor?
3. For `Tree a = Leaf a | Node (Tree a) (Tree a)`, write the catamorphism's type signature and derive `sumTree`, `depth`, and `toList` as algebras over it.
4. Take a `User` struct with `email: String`, `isEmailVerified: bool`, `verificationToken: String?`. List two illegal states it allows. Redesign with a sum (and/or parse-don't-validate) so they're unrepresentable.
5. Explain precisely why `null` is "a sum type the compiler can't see," and what `Option<T>` adds beyond `T + null` conceptually. Why does `Option` compose where `null` doesn't?
6. When is `Result` the *wrong* choice and an exception/panic the right one? Give two concrete conditions.
7. Implement a `Connection<Open>`/`Connection<Closed>` typestate API for `connect`, `send`, `close`. Show a client call sequence that won't compile and explain which type fact blocks it.
8. You mark a public library enum `#[non_exhaustive]`. What do you gain, what do *downstream users* lose, and how should they write their matches?

---

## Cheat Sheet

```text
┌──────────────────────────────────────────────────────────────────┐
│                ADTs AS ARCHITECTURE (senior view)               │
├──────────────────────────────────────────────────────────────────┤
│ EXPRESSION PROBLEM — pick by the volatile axis                   │
│   sum + match (FP) : new OPERATION cheap, new VARIANT shotgun     │
│   interface + impl : new VARIANT cheap, new OPERATION shotgun     │
│   ask: do CASES grow, or do OPERATIONS grow?                     │
├──────────────────────────────────────────────────────────────────┤
│ RECURSIVE ADT = initial algebra ⇒ fold (catamorphism) is free    │
│   write ONE fold; each operation is an algebra fed to it         │
│   structural recursion over finite values always terminates      │
├──────────────────────────────────────────────────────────────────┤
│ MAKE ILLEGAL STATES UNREPRESENTABLE — the toolkit                │
│   • flags+nullables  →  sum (each variant carries its data)      │
│   • smart constructor →  inhabitants = exactly the legal values  │
│   • newtype          →  distinct identity / units, 0-cost        │
│   • parse, don't validate → boundary returns a PROOF-type        │
│   • typestate/phantom → illegal transitions don't compile        │
├──────────────────────────────────────────────────────────────────┤
│ null  = invisible, unchecked  T + null   → billion-dollar bug    │
│ Option = visible, checked      1 + T      (and it COMPOSES)       │
│ throw  = invisible error channel          → non-local control    │
│ Result = error-in-return-type  T + E      (railway: ? short-circ) │
│   Result for EXPECTED failure; panic/exception for BUGS          │
├──────────────────────────────────────────────────────────────────┤
│ Know when to STOP: open extensibility → interfaces; wide sparse  │
│ data → product-of-optionals; over-encoded invariants → readable  │
│ runtime check beats unreadable type-Tetris.                      │
└──────────────────────────────────────────────────────────────────┘
```

---

## Summary

- ADTs are an **architecture**, not a syntax. The senior decision is *what leaning on sums commits the codebase to.*
- The **expression problem** is the core tension: sums make new **operations** cheap and exhaustiveness-checked but new **variants** expensive; interfaces invert it. Choose by which axis — cases or operations — is volatile, and document why.
- The **visitor pattern** is a closed sum reconstructed in OO; native `sealed`/`enum`/`data` make it obsolete for closed hierarchies.
- **Recursive ADTs are initial algebras**, so the **fold (catamorphism)** falls out of the constructors; write one fold and express every operation as an algebra. Structural recursion over finite values always terminates.
- **"Make illegal states unrepresentable"** is a methodology: sums over flags, smart constructors, newtypes, **parse-don't-validate** (return a proof-carrying precise type at the boundary), and **typestate** (states in types). Each move deletes a class of runtime bugs and defensive checks.
- **`null` is an invisible, unchecked sum** (`T + null`) — the billion-dollar mistake; `Option<T>` makes the same `1 + T` explicit, checked, and **composable**.
- **Exceptions are an invisible error channel**; `Result`/`Either` (`T + E`) puts errors in the return type, makes them part of the contract, and composes as a **railway** (`?` short-circuits). Use `Result` for expected failures, panic/exception for bugs.
- Seniority is also **knowing the anti-cases**: open/plugin extensibility wants interfaces; wide sparse data wants product-of-optionals; over-encoding invariants into types has diminishing returns.

---

## What You Can Build

- **A small interpreter** for an arithmetic/boolean expression language using a recursive ADT, a single fold, and several algebras (eval, pretty-print, constant-fold, free-variable count). Add a new operation with zero edits to existing ones; add a new node and watch the compiler list every fold to update.
- **A boundary-parsing layer** for an HTTP service: raw request → `Result<DomainCommand, ParseError>`, with newtypes for IDs and units, so handlers receive only valid, precisely-typed data.
- **A typestate file/connection API** (`File<Open>`/`File<Closed>`, `Txn<Active>`/`Txn<Committed>`) where misuse is a compile error. Write a demo of a sequence that won't compile.
- **A "before/after illegal-states" case study** on a real domain object (order, subscription, user-verification), counting the illegal states eliminated and the defensive `if`s deleted.
- **An error-taxonomy library**: a layered error sum with `From` conversions and a `?`-friendly pipeline, plus an exhaustive top-level handler. Compare ergonomics with the equivalent exception-based code.
- **A side-by-side expression-problem demo**: the same datatype as (a) a sum with matches and (b) a trait/interface with impls, then add one variant and one operation to each and measure how many files each change touches.

---

## Further Reading

- "The Expression Problem" — Philip Wadler's original framing (and Reynolds's earlier discussion). The canonical statement of the tension.
- "Data Types à la Carte" — Wouter Swierstra. Solving the expression problem with composable functors in Haskell.
- "Parse, Don't Validate" — Alexis King. The definitive essay on returning precise types at boundaries.
- *Domain Modeling Made Functional* — Scott Wlaschin. "Make illegal states unrepresentable" and railway-oriented programming, worked end to end.
- "Null References: The Billion Dollar Mistake" — Tony Hoare's QCon talk.
- *Category Theory for Programmers* — Bartosz Milewski. Initial algebras, catamorphisms, and why folds are "the" recursion scheme (informal, programmer-oriented).
- "Recursion Schemes" series — explanations of catamorphisms/anamorphisms over recursive ADTs.
- JEP 360/409 (sealed classes) and JEP 440/441 (record/pattern matching in switch) — how mainstream Java acquired native closed sums and exhaustiveness.
- *Programming with Types* — Vlad Riscutia — typestate, phantom types, and type-driven design with mainstream-language examples.
