# Algebraic Data Types — Interview Q&A

> **Roadmap:** [Functional Programming](../README.md) → Algebraic Data Types
>
> *An ADT is a type built by combining other types two ways: **product** ("this **and** that", a struct/record) and **sum** ("this **or** that", a tagged union). Pattern matching takes them apart. The payoff is that you can shape the type so that illegal states cannot be written down.*

A bank of 45+ questions and answers spanning definitions, domain modeling, the senior moves ("make illegal states unrepresentable", "parse, don't validate", the Expression Problem), and the deep mechanics (type counting, memory layout, match compilation). Examples are in **Java**, **Rust**, **Python**, and **Go**, with **Haskell** asides where the pure form clarifies. Use the `<details>` toggles to self-quiz: read the question, answer out loud, then expand.

---

## Table of Contents

1. [Fundamentals / Junior](#fundamentals--junior)
2. [Intermediate / Middle](#intermediate--middle)
3. [Senior — Design with the Type System](#senior--design-with-the-type-system)
4. [Professional / Deep — Counting, Layout, Compilation](#professional--deep--counting-layout-compilation)
5. [Code-Reading — Model It / Spot the Impossible State](#code-reading--model-it--spot-the-impossible-state)
6. [Curveballs](#curveballs)
7. [Rapid-Fire / One-Liners](#rapid-fire--one-liners)
8. How to Talk About ADTs in Interviews
9. [Summary](#summary)
10. [Related Topics](#related-topics)

---

## Fundamentals / Junior

> Definitions, the two type constructors, and the everyday `Option`/`Result` you already use.

**Q1. What is an algebraic data type?**

<details><summary>Answer</summary>

A type composed from other types using two operations: a **product** (combine fields — "this *and* that") and a **sum** (offer alternatives — "this *or* that"). A `struct`/`record`/`tuple` is a product; an `enum`/tagged union/`Either` is a sum. ADTs are usually paired with **pattern matching**, which destructures a value to recover the fields or discriminate which alternative it is. The "data type" part is ordinary; the "algebraic" part is that these two operations compose like multiplication and addition, which is where the name comes from.
</details>

**Q2. Product type vs sum type — give a concrete example of each.**

<details><summary>Answer</summary>

A **product** holds *all* of its fields at once: a `Point { x: f64, y: f64 }` is *always* an `x` **and** a `y`. A **sum** holds *exactly one* of its alternatives at a time: a `Shape` is a `Circle` **or** a `Rectangle` **or** a `Triangle`, never two at once. Products are the familiar struct; sums are the type that many mainstream languages historically lacked (Go still does). The two compose: a `Shape` (sum) whose `Circle` variant carries a `radius` and a `center: Point` (product) is a sum of products — the bread and butter of domain modeling.
</details>

**Q3. Why is it called "algebraic"?**

<details><summary>Answer</summary>

Because the number of distinct values a type can hold follows the algebra of *multiplication* and *addition*. A product type's value count is the **product** of its fields' counts: `(Bool, Bool)` has `2 × 2 = 4` values. A sum type's value count is the **sum** of its variants' counts: `Result<Bool, ()>` (`Ok(bool)` or `Err(())`) has `2 + 1 = 3` values. Pattern matching is then like factoring the expression. This isn't a cute analogy — it's a genuine semiring over types (`+`, `×`, `0` = uninhabited type, `1` = unit type), and it lets you *reason about correctness by counting*, which later questions exploit.
</details>

**Q4. What is `Option` / `Optional` / `Maybe`, and what problem does it solve?**

<details><summary>Answer</summary>

It's a sum type with two variants: "a value is present" (`Some(x)` / `Just x`) or "nothing is here" (`None` / `Nothing`). It replaces the **null reference** — Tony Hoare's "billion-dollar mistake" — with an *explicit, type-checked* absence. The difference is that `null` can inhabit *any* reference type silently, so the compiler can't force you to handle it; `Option<T>` is a *different type* from `T`, so you cannot use the value without first matching out the `None` case. Absence becomes visible in the signature and unforgettable at the use site.

```rust
fn find(id: u32) -> Option<User>      // the absence is in the type
match find(1) { Some(u) => greet(u), None => prompt_signup() }
```
</details>

**Q5. What is `Result` / `Either`, and how does it differ from `Option`?**

<details><summary>Answer</summary>

`Result<T, E>` (Rust) / `Either<E, A>` (Haskell/Scala) is a sum type for an operation that can **succeed with a value** (`Ok(t)` / `Right a`) **or fail with information about why** (`Err(e)` / `Left e`). `Option` answers *"is there a value?"* — absence carries no reason. `Result` answers *"did it work, and if not, what went wrong?"* — the error variant carries a payload. Reach for `Option` when missing is unremarkable (a key not in a map); reach for `Result` when the caller needs to know *why* it failed (parse error, network timeout). Converting `Option` → `Result` (attach an error) and back (discard the error) is routine.
</details>

**Q6. What is pattern matching and why is it the natural way to consume a sum type?**

<details><summary>Answer</summary>

Pattern matching inspects a value, branches on *which* variant it is, and **binds** the data inside that variant to names in one step. It's the dual of construction: where a sum is built by *choosing* a variant, it's consumed by *discriminating* the variant. The reason it fits sums so well is **exhaustiveness** — a good compiler checks that you handled every variant and errors (or warns) if you missed one, so adding a new variant later forces you to revisit every match. That compiler-enforced "did you handle all the cases?" is a property `if/else` chains on a type tag simply don't give you.
</details>

**Q7. Show the same `Shape` sum type in Rust and the closest equivalent in Java.**

<details><summary>Answer</summary>

```rust
enum Shape {
    Circle { radius: f64 },
    Rect   { w: f64, h: f64 },
}
fn area(s: &Shape) -> f64 {
    match s {
        Shape::Circle { radius } => std::f64::consts::PI * radius * radius,
        Shape::Rect { w, h }     => w * h,
    }
}
```

```java
sealed interface Shape permits Circle, Rect {}
record Circle(double radius) implements Shape {}
record Rect(double w, double h) implements Shape {}

double area(Shape s) {
    return switch (s) {                      // exhaustive — compiler checks
        case Circle c -> Math.PI * c.radius() * c.radius();
        case Rect r   -> r.w() * r.h();
    };
}
```

`sealed` (Java 17+) closes the set of permitted subtypes so the `switch` can be exhaustive without a `default` — the language-level recreation of a Rust `enum`. `record` gives the product half (immutable fields + destructuring).
</details>

**Q8. Is a Java `enum` an algebraic data type?**

<details><summary>Answer</summary>

A plain Java `enum` is only the *degenerate* case — a sum type whose variants carry **no data** (`enum Color { RED, GREEN, BLUE }` is the sum `1 + 1 + 1` = three values). True ADTs need variants that *carry different payloads*, which a classic `enum` can't express. In modern Java the ADT is `sealed interface` + `record`s; in Rust and Swift the single `enum` keyword does both jobs because its variants can carry fields. So "enum = ADT" is true in Rust, only partially true in Java.
</details>

**Q9. What's wrong with modeling "a circle or a rectangle" as a struct with nullable fields?**

<details><summary>Answer</summary>

```go
type Shape struct { Kind string; Radius float64; W, H float64 } // bad
```

This is a **product** type (it always has all four fields) pretending to be a **sum** (it should be one shape or the other). It admits nonsense values the domain forbids: a `Shape` with `Kind="circle"` *and* a non-zero `W`, or `Kind="triangle"` (typo) with no matching fields, or all zeros. The type is *wider* than the domain, so every consumer must defensively check "is this combination valid?" A real sum type makes those illegal combinations unrepresentable — you literally cannot construct a `Circle` that also has a width.
</details>

**Q10. What does "exhaustive" matching mean and why do you want it?**

<details><summary>Answer</summary>

An exhaustive match handles *every* variant of the sum; the compiler verifies there are no gaps. You want it because it converts a whole class of "forgot a case" bugs from runtime surprises into compile errors. The big payoff is **evolution**: when someone adds a `Triangle` variant a year later, every non-exhaustive `match` across the codebase fails to compile, handing them a precise to-do list of places that need the new case. Without exhaustiveness (e.g. a `switch` with a `default` that swallows the unknown), that same change silently routes triangles into the wrong branch.
</details>

**Q11. What is the "unit" type and the "never"/"empty" type, in ADT terms?**

<details><summary>Answer</summary>

The **unit** type has exactly **one** value (`()` in Rust/Haskell, `Unit` in Kotlin/Scala) — in the algebra it's the number `1`, the identity for `×` (a product with a unit field gains no information: `T × 1 = T`). The **never**/empty type has **zero** values (`!` in Rust, `Void` in Haskell, `Nothing` in Scala) — it's the number `0`, the identity for `+` (`T + 0 = T`). A function returning `!` can never return normally (it loops, panics, or exits), which is why Rust uses it for `panic!` and infinite loops. These are the "0 and 1" that make the type algebra a real semiring.
</details>

**Q12. Do Python and Go have algebraic data types?**

<details><summary>Answer</summary>

**Products:** both do — Python `dataclass`/`NamedTuple`, Go `struct`. **Sums:** neither has them as a first-class language feature. Python *emulates* sums with `typing.Union` / `X | Y` (3.10+) plus `match` (3.10+), and the idiom of a sealed dataclass hierarchy; the type checker (mypy/pyright) can even enforce exhaustiveness via `assert_never`. Go has **no sum types at all** — the idioms are the `(value, error)` tuple, sealed interfaces (an unexported method so only your package can implement them), or a tagged struct. So: products yes, sums only by convention.
</details>

---

## Intermediate / Middle

> Domain modeling, choosing `Option` over `null`, recursive ADTs, and the per-language idioms.

**Q13. Why prefer `Option<T>` over a nullable `T`?**

<details><summary>Answer</summary>

Three reasons. **Visibility:** `Option<User>` announces "may be absent" in the signature; a nullable `User` looks identical to a non-null one, so absence is invisible. **Enforcement:** you can't dereference an `Option` without first handling `None` — the compiler stops you — whereas nothing forces a null check. **Composability:** `Option` is a type with combinators (`map`, `and_then`/`flatMap`, `unwrap_or`) so you chain transformations without nested null checks. The cost is a little ceremony at use sites and (naively) a wrapper allocation — but see the niche-optimization question for why `Option<&T>` is often *free*.
</details>

**Q14. Walk through modeling a domain with ADTs. Take "a payment method".**

<details><summary>Answer</summary>

List the *kinds* (that's your sum) and, per kind, the data it needs (each kind's product):

```rust
enum PaymentMethod {
    Card    { number: CardNumber, expiry: Expiry, cvv: Cvv },
    BankXfer{ iban: Iban },
    Cash,                                  // carries no data
    GiftCard{ code: GiftCardCode, balance: Money },
}
```

The win: a `Card` *cannot* exist without an expiry, and a `Cash` payment *cannot* accidentally carry an IBAN — each variant carries exactly the fields its kind needs and no others. Compare the anti-model (one struct with every field nullable), where `Cash` with a stray CVV is representable and every consumer must guard against it. Modeling with the sum pushes the validation into *construction*, so downstream code reasons about valid data only.
</details>

**Q15. What is a recursive ADT? Give an example.**

<details><summary>Answer</summary>

A sum type one of whose variants contains the type itself — the shape of trees, lists, and expression grammars. A binary tree:

```rust
enum Tree {
    Leaf(i32),
    Node(Box<Tree>, Box<Tree>),   // Box = heap pointer, needed for a finite size
}
```

The recursion in the *type* mirrors the recursion in the *data*, and functions over it are naturally written by recursion + pattern matching (one arm per variant, recurse on the sub-trees). The subtlety in non-GC languages is **size**: a directly-embedded `Tree` would be infinitely large, so you indirect through a pointer (`Box` in Rust, a reference in Java, `*Tree` in Go) to give each node a fixed size. A JSON value (`Null | Bool | Number | String | Array<Json> | Object<Json>`) is the canonical recursive ADT.
</details>

**Q16. How do you model sum types in Go, which has none?**

<details><summary>Answer</summary>

Three common idioms, each with trade-offs:

1. **`(T, error)` return** — the pervasive built-in "success *or* failure" sum, but limited to that one shape.
2. **Sealed interface** — an interface with an *unexported* marker method, so only types in your package can implement it; consumers type-switch over it:
   ```go
   type Shape interface { isShape() }
   type Circle struct{ R float64 }; func (Circle) isShape() {}
   type Rect   struct{ W, H float64 }; func (Rect) isShape() {}
   ```
3. **Tagged struct** — a `Kind` field plus payload fields (the nullable-fields anti-pattern from Q9; sometimes pragmatic for wire formats).

The sealed-interface idiom is closest to a real sum, but Go gives you **no exhaustiveness check** — a `switch` over `Shape` needs a `default: panic("unhandled")` and discipline (or a linter like `go-exhaustive`) to catch missing cases. That missing compiler guarantee is the core cost of not having sum types.
</details>

**Q17. How do you model sum types idiomatically in Python?**

<details><summary>Answer</summary>

A frozen-dataclass hierarchy under a union, matched with `match`:

```python
from dataclasses import dataclass

@dataclass(frozen=True)
class Circle: radius: float
@dataclass(frozen=True)
class Rect:   w: float; h: float

Shape = Circle | Rect              # the sum

def area(s: Shape) -> float:
    match s:
        case Circle(radius=r): return 3.14159 * r * r
        case Rect(w=w, h=h):   return w * h
```

For **exhaustiveness**, add a `case _ as unreachable: assert_never(unreachable)` — `pyright`/`mypy` then error if a new variant is added but not handled. It's enforced by the *type checker*, not the runtime, so a project without static checking gets the structure but not the guarantee.
</details>

**Q18. `Option` has `map` and `and_then`/`flatMap`. When do you use which?**

<details><summary>Answer</summary>

Use **`map`** when your transform returns a *plain* value — it stays inside the `Option`: `Some(3).map(|x| x + 1) == Some(4)`. Use **`and_then`/`flatMap`** when your transform *itself* returns an `Option`, so you'd otherwise get a nested `Option<Option<T>>`: `find_user(id).and_then(|u| u.manager())` flattens to a single `Option<Manager>`. Rule of thumb: the function returns `T` → `map`; the function returns `Option<T>` → `and_then`. This is exactly the functor-vs-monad distinction made concrete (see *Monads — Plain English*).
</details>

**Q19. When should you NOT reach for `Option`/`Result` and just throw an exception (or panic)?**

<details><summary>Answer</summary>

Use the sum type for **expected, recoverable** outcomes the caller should branch on — a missing key, a parse failure, a not-found user. Use exceptions/panics for **truly exceptional, unrecoverable** conditions: programmer bugs (index out of bounds), invariant violations that mean "this should be impossible," or environmental catastrophes you can't sensibly handle locally. The smell is using exceptions for ordinary control flow (an exception for "user not found" on a hot path is both slow and surprising) or using `Result` for genuine bugs (threading an error type through code that can only fail if the program is broken). Match the mechanism to whether the caller can *meaningfully* do something about it.
</details>

**Q20. Compare error handling: Rust `Result` + `?` vs Go `if err != nil` vs Java checked exceptions.**

<details><summary>Answer</summary>

All three encode "this can fail," differently. **Rust** makes failure a value (`Result`) and the `?` operator early-returns the error, so the happy path stays linear *and* the compiler forces you to handle or propagate. **Go** also makes failure a value (`error`) but with no propagation sugar, so the `if err != nil { return err }` boilerplate is explicit and repetitive — visible, but noisy. **Java checked exceptions** put failure in the *signature* (`throws IOException`) and force handling, but they're a separate control-flow channel (not a value you can `map`/store) and interact awkwardly with lambdas/streams, which is why much modern Java drifts to unchecked exceptions or `Optional`/`Result`-like types. The ADT approach (Rust/Scala) treats errors as ordinary data you can compose; the exception approach treats them as a side channel.
</details>

**Q21. What combinators exist on `Result`, and how do you compose a fallible pipeline?**

<details><summary>Answer</summary>

`map` (transform the `Ok`), `map_err` (transform the `Err`), `and_then` (chain another fallible step), `or_else` (recover/fallback), `unwrap_or`/`unwrap_or_else` (provide a default). A pipeline threads the error automatically:

```rust
fn load(path: &str) -> Result<Config, Error> {
    let raw = read_file(path)?;          // ? = propagate Err, unwrap Ok
    let txt = String::from_utf8(raw).map_err(Error::Encoding)?;
    parse_config(&txt).map_err(Error::Parse)
}
```

Each step short-circuits on the first error; the success values flow through. This is "railway-oriented programming": one track for success, one for failure, and the combinators keep you from manually checking after every call.
</details>

**Q22. How do `Option` and `Result` interconvert, and why would you?**

<details><summary>Answer</summary>

`Option` → `Result`: attach an error to the `None` case (`opt.ok_or(MyError::NotFound)`), used when crossing into a context where "why is it missing?" matters. `Result` → `Option`: discard the error (`res.ok()`), used when you only care *whether* it succeeded, not why. The conversion direction reflects an information change: going to `Result` you *add* an error reason; going to `Option` you *drop* it. Picking the right one at each boundary keeps each layer carrying exactly the information its callers need — no more, no less.
</details>

**Q23. What's the value of putting an invariant into the *type* of a variant's field rather than checking it at runtime?**

<details><summary>Answer</summary>

It moves the check from "every consumer must remember to validate" to "validation happens once, at construction, and the type guarantees it thereafter." If a `Card` variant's number field is `ValidatedCardNumber` (a type you can only obtain by passing validation), then *any* code holding a `Card` knows the number is valid — no defensive re-checks, no "what if it's malformed here?" branches. This is the bridge from ADTs to "parse, don't validate" (Q26): the sum type narrows *which kinds* exist; refined field types narrow *which values* each kind can hold.
</details>

---

## Senior — Design with the Type System

> Making illegal states unrepresentable, parse-don't-validate, the Expression Problem, and evolving ADTs.

**Q24. Explain "make illegal states unrepresentable." Give a before/after.**

<details><summary>Answer</summary>

The principle: design types so that values your domain forbids *cannot be constructed*, shifting whole categories of bug from "caught at runtime (maybe)" to "caught at compile time (always)." Before — a connection modeled as a product with optional fields:

```rust
struct Conn { connected: bool, session_id: Option<String>, error: Option<String> }
// illegal but representable: connected=true with session_id=None; or both error AND session set
```

After — a sum where each state carries exactly its data:

```rust
enum Conn {
    Disconnected,
    Connecting,
    Connected { session_id: String },   // session ALWAYS present when connected
    Failed { error: String },           // error ONLY exists in the failed state
}
```

Now "connected without a session" and "connected and failed at once" are not bugs to guard against — they're sentences the type system won't let you write. You shrink the type down to exactly the domain.
</details>

**Q25. Relate the algebra of types to "make illegal states unrepresentable."**

<details><summary>Answer</summary>

The product anti-model in Q24 has `2 (connected) × |Option<String>| × |Option<String>|` possible values — far more than the four legitimate states. Most of those extra values are *illegal* combinations you then spend code defending against. The sum-of-products refactor produces a type whose value count equals the number of *legal* states (the four variants, each times its own fields). So "make illegal states unrepresentable" is, algebraically, *shrinking the type's cardinality down to the domain's cardinality* — every value the type can hold is a value the domain permits. The bug-prevention is a corollary of the counting.
</details>

**Q26. What is "parse, don't validate"?**

<details><summary>Answer</summary>

A coined principle (Alexis King): instead of *validating* data and passing the same loose type onward (so the next function must validate again), **parse** it once into a *narrower type that encodes the proven facts*. A `validate_email(s: str) -> bool` leaves you holding a `str` you must keep re-trusting; a `parse_email(s: str) -> Option<Email>` returns an `Email` type that, by existing, *proves* it's well-formed — downstream code takes `Email` and never re-checks. The validation result is captured in the *type*, not discarded. ADTs are the engine: `Option`/`Result` carry the "parse might fail" outcome, and refined types (`NonEmptyList`, `Email`, `PositiveInt`) carry the proven invariant. Push parsing to the boundary; keep the core total.
</details>

**Q27. "Parse, don't validate" vs ordinary input validation — what actually changes?**

<details><summary>Answer</summary>

Validation answers "is this OK?" and returns a *boolean or throws*, then hands the **original wide type** downstream — so the knowledge "it's valid" lives only in the programmer's head and must be re-established (or assumed) at every later use. Parsing answers "turn this into the precise thing or fail" and returns a **narrower type** that *carries the proof*. The practical difference: with validation, a function deep in the system that receives a `String` can't tell whether it was validated, so it either re-validates (waste, drift) or trusts (latent bug). With parsing, that function receives an `Email`/`NonEmptyList` and the type *is* the guarantee — no re-checking, no "I hope someone validated this." Same check, but its result is preserved in the type instead of evaporating.
</details>

**Q28. What is the Expression Problem, and how do ADTs and OO class hierarchies sit on opposite sides?**

<details><summary>Answer</summary>

The Expression Problem (Wadler) asks: can you add **new variants** (data cases) *and* new **operations** over them, **without modifying existing code** and **keeping static type safety**? The two paradigms make opposite trade-offs:

- **ADT + pattern matching** makes adding an **operation** easy (write one new function with a `match` over all variants — touch nothing else) but adding a **variant** hard (every existing `match` must gain a case — and the compiler makes you).
- **OO class hierarchy** (subtype polymorphism) makes adding a **variant** easy (write a new subclass with all methods — touch no existing class) but adding an **operation** hard (you must add a method to *every* existing class).

So the axis you expect to grow picks the tool: operations grow → ADTs; kinds grow → class hierarchy. Neither wins both; patterns like the Visitor (recovers ADT-like dispatch in OO) and tagless-final / typeclasses (recover open extension in FP) are attempts to get both at some cost.
</details>

**Q29. So when should I use a sum type vs a polymorphic class hierarchy?**

<details><summary>Answer</summary>

Decide by which axis is **open** vs **closed**. If the set of *kinds* is **closed and known** (the four connection states, the JSON node kinds, the AST node types) and you expect to keep *adding operations* over them, a sum type is ideal — closed set means exhaustiveness works for you, not against you. If the set of *kinds* is **open / extensible by third parties** (plugins, drivers, UI widgets others will subclass) and the operations are relatively fixed (`render`, `validate`), a polymorphic interface is better — new kinds slot in without recompiling the world. A telltale: ASTs, protocol messages, and state machines are closed → ADT; plugin and strategy hierarchies are open → polymorphism.
</details>

**Q30. Why does adding an enum variant break existing code — and why is that a *good* thing?**

<details><summary>Answer</summary>

Because every exhaustive `match` that didn't have a `default`/wildcard now has an unhandled case, so it fails to compile. That break is **the feature**: it's the compiler enumerating, precisely, every site that must consider the new case before you can ship. The alternative — code that compiles fine and silently mishandles the new variant (drops it, routes it to a wrong branch, returns a default) — is a far worse bug, discovered in production instead of at the keyboard. A wildcard `_ =>` arm *suppresses* this safety to buy convenience; on a closed domain type that's usually a mistake, because it trades a compile error for a runtime surprise on exactly the change most likely to need attention.
</details>

**Q31. How do you evolve / version an ADT in a wire format or public API without breaking consumers?**

<details><summary>Answer</summary>

The exhaustiveness that helps *within* a codebase becomes a hazard *across* a version boundary, because an old consumer can't match a new variant. Tactics: (1) **reserve an `Unknown`/`Other` variant** in serialized forms so old code can round-trip data it doesn't understand instead of crashing (protobuf does this for unknown fields/enum values); (2) treat **adding a variant as a breaking change** for closed clients and gate it behind a version bump; (3) for the *product* side, adding an optional field is backward-compatible, removing or repurposing one is not. The core tension: closed sums give safety inside one binary but are *not* naturally forward-compatible across independently-deployed binaries, so wire ADTs need an explicit escape hatch.
</details>

**Q32. Sum types over deeply-nested booleans — defend the refactor to a skeptical reviewer.**

<details><summary>Answer</summary>

Lead with cardinality. Three booleans modeling a workflow's state give `2³ = 8` representable combinations, but the domain may have only 3 legal states — so 5 of the 8 are bugs waiting to be constructed, and every reader must mentally exclude them. Replacing the booleans with a 3-variant enum makes the type's cardinality equal the domain's: the illegal combinations literally cannot be written, the names document intent (`Draft`/`Submitted`/`Approved` beats `isSubmitted && !isApproved`), and matches become exhaustive so future states force a revisit. The trade-off to acknowledge: a touch more upfront type-definition and, in serialization, a migration story (Q31). Worth it whenever the state drives branching logic.
</details>

**Q33. How do generics interact with ADTs — what is a parametric (generic) ADT?**

<details><summary>Answer</summary>

An ADT can be *parameterized* over a type, so `Option<T>`, `Result<T, E>`, `Tree<T>`, and `List<T>` are families of types, one per instantiation. Algebraically a generic ADT is a *polynomial functor*: `Option<T> = 1 + T`, `List<T> = 1 + T × List<T>` (whose closed form is the geometric-series intuition `1 + T + T² + T³ + …`). The practical consequences: you write the structure and its combinators (`map`, `fold`) **once**, generically, and they work for every element type; and the type carries its element type so a `Tree<User>` can't be confused with a `Tree<Order>`. This is why `Option`/`Result` ship in the standard library as generic enums rather than being hand-rolled per type.
</details>

---

## Professional / Deep — Counting, Layout, Compilation

> Type isomorphisms, memory representation, niche optimization, and how a `match` becomes machine code.

**Q34. How many values does `(Bool, Bool)` have? How many does `Maybe Bool` (`Option<bool>`) have?**

<details><summary>Answer</summary>

`(Bool, Bool)` is a **product**: `2 × 2 = 4` values — `(F,F), (F,T), (T,F), (T,T)`. `Option<bool>` is a **sum** `1 + Bool` = `1 + 2 = 3` values — `None`, `Some(false)`, `Some(true)`. The contrast is the whole point of the algebra: products multiply, sums add. As a sanity ladder: `Option<()>` has `1 + 1 = 2` values (isomorphic to `bool`!), `Result<bool, bool>` has `2 + 2 = 4`, and `(Option<bool>, bool)` has `3 × 2 = 6`.
</details>

**Q35. What's a type isomorphism, and can you give one from the algebra?**

<details><summary>Answer</summary>

Two types are isomorphic when there's a lossless back-and-forth conversion (a bijection) between their values — they carry the same information in different shapes, and the algebra predicts them. Examples: `Option<()> ≅ bool` (both have 2 values); `(A, (B, C)) ≅ ((A, B), C)` (products associate); `Either<A, B> ≅ Either<B, A>` up to relabeling (sums commute); and the distributive law `A × (B + C) ≅ (A × B) + (A × C)` — "a pair of an `A` and a (`B` or `C`)" is the same as "(an `A` and a `B`) or (an `A` and a `C`)." Even `(A → B → C) ≅ (A × B → C)` is the curry/uncurry isomorphism, exponentials `C^(A×B) = (C^B)^A`. Recognizing these lets you refactor a type into an equivalent, more convenient shape with confidence you've lost nothing.
</details>

**Q36. How is a sum type laid out in memory, and what is "niche" optimization?**

<details><summary>Answer</summary>

Naively, a sum is a **tag** (a small integer saying which variant) plus enough space for the **largest** variant's payload (a "tagged union"), so `enum E { A(u8), B(u64) }` costs roughly the tag + 8 bytes, with alignment padding. **Niche optimization** removes the tag when a payload has spare ("niche") bit patterns the compiler can repurpose as the discriminant. The classic case: `Option<&T>` — a reference can never be null, so Rust uses the all-zeros pattern to mean `None` and the actual address to mean `Some`. Result: `Option<&T>` is the *same size* as `&T` (8 bytes, no extra tag), so the `Option` abstraction is **zero-cost** here. The same applies to `Option<Box<T>>`, `Option<NonZeroU32>`, and nested enums where unused tag values are available.
</details>

**Q37. So is `Option<T>` always free? When does it cost?**

<details><summary>Answer</summary>

No. It's free when `T` has a *niche* (a forbidden bit pattern) the compiler can steal for the `None` tag — references, `NonZero*`, `Box`, `bool` (which only uses 2 of 256 byte values), enums with unused discriminants. It **costs** when `T` uses its entire bit space, e.g. `Option<u64>`: every 64-bit pattern is a valid `u64`, so there's no spare pattern for `None`, and the compiler must add a separate tag byte — pushing the size to 16 bytes after alignment. The lesson for performance-sensitive code: `Option<&T>`/`Option<NonZeroUsize>` are genuinely zero-overhead, but `Option<u64>` doubles the footprint, which matters in tight arrays/structs.
</details>

**Q38. How does a compiler turn a `match` into efficient code?**

<details><summary>Answer</summary>

It compiles the discrimination, not a chain of comparisons where it can avoid one. For matching on a sum's tag (or a dense integer range), it typically emits a **jump table** — index by the tag into a table of branch targets, O(1) regardless of variant count — rather than sequential `if tag == 0 … else if tag == 1`. For sparse values it may use a **binary search / decision tree** over the cases, or a hybrid. Nested and overlapping patterns are lowered to a **decision tree** (the classic Maranget algorithm) that tests each scrutinee field at most as many times as needed and shares common tests across arms. Exhaustiveness and reachability (the "unreachable arm" warning) fall out of the same analysis. Net: idiomatic pattern matching is generally as fast as, or faster than, the hand-written conditional you'd otherwise type.
</details>

**Q39. Why can't you have a `Tree` ADT *without* indirection (a pointer/box) in a language like Rust or C?**

<details><summary>Answer</summary>

Because the compiler must know each type's size at compile time, and a directly-embedded recursive type has no finite size: `enum Tree { Node(Tree, Tree) }` would need `size(Tree) = 2 × size(Tree) + tag`, which has no finite solution (it diverges). Indirection breaks the recursion — a `Box<Tree>`/`*Tree`/reference is a fixed-size pointer (8 bytes) regardless of what it points to, so the node's size becomes finite and the actual children live on the heap. GC'd languages (Java, Python, Go) hide this because *all* object fields are already references under the hood, so the recursion is pointer-mediated by default and you don't write `Box` explicitly. Same constraint, different visibility.
</details>

**Q40. What does the "function type" correspond to in the algebra of types, and why is the notation `B^A`?**

<details><summary>Answer</summary>

A function `A -> B` corresponds to **exponentiation**: it has `|B|^|A|` distinct values (`B^A`), because to define a total function you choose, *independently for each* of the `|A|` inputs, *one* of the `|B|` outputs — that's `|B|` multiplied by itself `|A|` times. So `bool -> bool` has `2² = 4` functions (identity, not, const-true, const-false), and `() -> B ≅ B` (`B^1 = B`). This completes the algebra (`+`, `×`, exponent) and explains the curry isomorphism `C^(A×B) = (C^B)^A` (`A → B → C` ≅ `(A, B) → C`) and `(A+B) → C ≅ (A→C) × (B→C)` — "handle a sum" is "a pair of handlers," which is precisely why a `match` over a sum has one arm per variant.
</details>

---

## Code-Reading — Model It / Spot the Impossible State

> You're shown a snippet; model it as an ADT, or find the state the type lets you build but the domain forbids.

**Q41. Spot the impossible state this Java class permits, then fix it with an ADT.**

```java
class HttpResponse {
    int status;           // 0 if not set yet
    String body;          // null while in flight
    String errorMessage;  // null unless failed
    boolean inFlight;
}
```

<details><summary>Answer</summary>

The product type permits nonsense: `inFlight == true` with a non-null `body` and a non-null `errorMessage` simultaneously; a "completed" response with `status == 0`; a success carrying an `errorMessage`. Model the *states* as a sum:

```java
sealed interface HttpResponse permits InFlight, Success, Failed {}
record InFlight() implements HttpResponse {}
record Success(int status, String body) implements HttpResponse {}
record Failed(int status, String errorMessage) implements HttpResponse {}
```

Now `body` exists *only* in `Success`, `errorMessage` *only* in `Failed`, and `InFlight` carries neither — the "in flight with a body and an error" combination is unrepresentable, and a `switch` over the three forces every consumer to handle each state.
</details>

**Q42. Model this Go tagged struct as a proper sum (sealed interface) and say what you gained.**

```go
type Event struct {
    Type    string // "click", "scroll", "key"
    X, Y    int    // only for click
    DeltaY  int    // only for scroll
    KeyCode int    // only for key
}
```

<details><summary>Answer</summary>

```go
type Event interface{ isEvent() }

type Click struct{ X, Y int };  func (Click) isEvent()  {}
type Scroll struct{ DeltaY int }; func (Scroll) isEvent() {}
type Key struct{ KeyCode int };  func (Key) isEvent()    {}

func handle(e Event) {
    switch e := e.(type) {
    case Click:  /* use e.X, e.Y */
    case Scroll: /* use e.DeltaY */
    case Key:    /* use e.KeyCode */
    default:     panic("unhandled event")   // Go has no exhaustiveness check
    }
}
```

Gained: each event carries *only* its own fields (no `KeyCode` on a `Click`), a typo'd `Type` string is impossible, and the type-switch destructures cleanly. The residual weakness vs Rust/Java-sealed is that Go won't *compile-check* exhaustiveness — hence the `default: panic` and, ideally, a `go-exhaustive` lint.
</details>

**Q43. This Python function re-validates the same data three times. Refactor it to "parse, don't validate".**

```python
def handle(raw: str):
    if not is_valid_email(raw): raise ValueError
    send_welcome(raw)            # re-checks raw inside
    store(raw)                   # re-checks raw inside again
```

<details><summary>Answer</summary>

Parse once at the boundary into a type that *proves* validity, then pass that type around:

```python
from dataclasses import dataclass

@dataclass(frozen=True)
class Email:
    value: str
    @staticmethod
    def parse(raw: str) -> "Email | None":
        return Email(raw) if is_valid_email(raw) else None

def handle(raw: str):
    email = Email.parse(raw)
    if email is None: raise ValueError
    send_welcome(email)   # takes Email — no re-check possible or needed
    store(email)          # same
```

`send_welcome`/`store` now accept `Email`, not `str`, so the validity is established once and carried in the type; the redundant downstream checks disappear and can't drift out of sync. (Discipline matters: keep the `Email` constructor effectively private so the only way to get one is through `parse`.)
</details>

**Q44. Read this Rust and say what the wildcard arm costs you.**

```rust
enum Cmd { Start, Stop, Pause }
fn label(c: Cmd) -> &'static str {
    match c {
        Cmd::Start => "start",
        _          => "other",      // <-- 
    }
}
```

<details><summary>Answer</summary>

The `_ => "other"` arm *defeats exhaustiveness*. Today `Stop` and `Pause` both fall into `"other"` — already probably a bug. Worse, when someone adds `Cmd::Resume` next quarter, this function silently labels it `"other"` and **the compiler says nothing**, because the wildcard absorbs it. Had each variant been listed explicitly, adding `Resume` would break compilation here and at every other match, handing the author a checklist. The fix is to enumerate the variants you mean and reserve `_` only for cases where catch-all is *genuinely* the intent (e.g. matching over an open/`#[non_exhaustive]` type), not as a shortcut on a closed domain enum.
</details>

**Q45. This Java models a card with `Optional` fields. What's the smell and the ADT fix?**

```java
record DiscountCode(
    Optional<Double> percentOff,
    Optional<Double> amountOff,
    Optional<Integer> freeShippingThreshold) {}
```

<details><summary>Answer</summary>

It's a product of three optionals encoding a sum: a discount is *one of* percent-off, amount-off, or free-shipping — but the type permits all-empty (no discount at all), all-three-set (contradictory), or any combination. `2³ = 8` representable shapes for 3 legal ones. Fix with a sealed sum:

```java
sealed interface Discount permits Percent, Amount, FreeShipping {}
record Percent(double pct) implements Discount {}
record Amount(double money) implements Discount {}
record FreeShipping(int threshold) implements Discount {}
```

Exactly one kind, each with its own field, no empty/contradictory states, and a `switch` that must handle all three. The `Optional`-soup is the Java flavor of the nullable-fields anti-pattern from Q9.
</details>

---

## Curveballs

> The questions designed to catch glib answers.

**Q46. Why is it called "algebraic" — in one breath?**

<details><summary>Answer</summary>

Because the count of values follows ordinary algebra: a **product** type's values **multiply** its fields' counts (`(Bool, Bool) = 2 × 2 = 4`) and a **sum** type's values **add** its variants' counts (`Option<bool> = 1 + 2 = 3`). The "0 and 1" of that algebra are the empty type (0 values) and the unit type (1 value), and function types are exponentiation (`B^A`). It's a real semiring on types, not a metaphor — which is why you can reason about a type's correctness by counting its inhabitants.
</details>

**Q47. Does Go have sum types? Pin down the honest answer.**

<details><summary>Answer</summary>

No — Go has no sum types as a language feature, and the proposal to add them has been repeatedly declined. You *approximate* them three ways: the `(value, error)` idiom (a built-in success-or-failure sum), a **sealed interface** (unexported marker method so only your package implements it) consumed by a type-switch, or a tagged struct. The crucial thing Go *can't* give you is **compile-time exhaustiveness**: nothing forces a type-switch to handle every implementer, so you lean on a `default: panic` and a linter (`go-exhaustive`). Saying "Go has sum types via interfaces" overstates it — it has a workaround that lacks the key guarantee.
</details>

**Q48. How many values does `Either<Void, Bool>` have, where `Void` is the empty type?**

<details><summary>Answer</summary>

`2`. The empty type has `0` inhabitants, so `Either<Void, Bool>` = `0 + 2 = 2` — the `Left` case can never be constructed (you can't produce a `Void`), leaving only the two `Right(bool)` values. This makes `Either<Void, B> ≅ B`: adding a `0`-valued alternative adds nothing, exactly mirroring `0 + x = x`. It's the type-level proof that an "impossible" branch is genuinely impossible — a trick used to mark error channels that can't fire (`Result<T, Infallible>` in Rust).
</details>

**Q49. ADTs vs OO class hierarchies — which "wins," and what does the Expression Problem say about the question?**

<details><summary>Answer</summary>

Neither wins outright; the Expression Problem proves they're **dual**, optimizing opposite axes. ADTs make *new operations* cheap and *new variants* expensive (every match must change); class hierarchies make *new variants* cheap and *new operations* expensive (every class must gain a method). So the right question isn't "which is better" but "which axis will *this* code grow along?" Closed set of kinds + many operations (ASTs, protocol messages, state machines) → ADT. Open/extensible set of kinds + fixed operations (plugins, drivers, widgets) → hierarchy. A senior answer names the duality rather than picking a tribe.
</details>

**Q50. Adding an enum variant broke fifty files. Isn't that terrible ergonomics?**

<details><summary>Answer</summary>

It's the opposite — it's the safety you're paying the type system for. The fifty compile errors are an *exact, exhaustive list* of every place that must consider the new case; the language did your impact analysis for free. The genuinely terrible scenario is the one without exhaustiveness: zero compile errors and fifty places that now silently mishandle the new variant, surfacing as scattered production bugs you find one outage at a time. If the fifty changes are mostly mechanical, that suggests the variant should perhaps carry behavior (or the matches should delegate to a method) — but the *breakage itself* is a feature, not a bug.
</details>

**Q51. If `Option<T>` is "just" `null` with a wrapper, why bother — isn't it the same at runtime?**

<details><summary>Answer</summary>

At runtime the *representation* can be identical — `Option<&T>` is literally a possibly-null pointer thanks to niche optimization, so there's often **zero** space or speed cost. The difference is entirely at **compile time**: `Option<T>` is a distinct type the checker forces you to unwrap, so "I forgot the absent case" is a compile error, whereas a raw nullable lets you dereference null and crash. Same bits, but one makes the danger unforgettable and the other makes it invisible. "Just null with a wrapper" misses that the wrapper is the point — it's the type-level obligation, not the runtime shape.
</details>

**Q52. Can you model an infinitely-large set of values with a finite ADT definition?**

<details><summary>Answer</summary>

Yes — via *recursion* or *unbounded* payload types. `List<T> = Nil | Cons(T, List<T>)` is a finite definition denoting infinitely many values (lists of every length); algebraically it's the fixpoint of `L = 1 + T × L`, i.e. `1 + T + T² + …`. Likewise any ADT containing a `String`, `BigInt`, or another unbounded type has infinitely many inhabitants despite a small definition. The *cardinality* counting from earlier questions still applies in spirit (it's why `List<T>` has "geometric series" many values), it just yields infinities for recursive or unbounded types — which is exactly why such types need indirection to have a finite *memory size* (Q39).
</details>

---

## Rapid-Fire / One-Liners

> Crisp answers; what an interviewer wants in one or two sentences.

**Q53. Product vs sum, in one line each?**

<details><summary>Answer</summary>

Product = "this **and** that" (struct/record, fields multiply); sum = "this **or** that" (enum/union, variants add).
</details>

**Q54. `Option` vs `Result` in one line?**

<details><summary>Answer</summary>

`Option` = present or absent (no reason); `Result` = succeeded or failed-with-a-reason.
</details>

**Q55. Values in `Bool × Bool`? In `Maybe Bool`?**

<details><summary>Answer</summary>

`Bool × Bool` = `2 × 2 = 4`; `Maybe Bool` (`Option<bool>`) = `1 + 2 = 3`.
</details>

**Q56. One sentence: "make illegal states unrepresentable"?**

<details><summary>Answer</summary>

Shape the type so its cardinality equals the domain's — then forbidden combinations simply can't be constructed.
</details>

**Q57. "Parse, don't validate" in one sentence?**

<details><summary>Answer</summary>

Convert input once into a narrower type that *carries the proof of validity*, instead of returning a boolean and passing the wide type onward to be re-checked.
</details>

**Q58. The Expression Problem in one sentence?**

<details><summary>Answer</summary>

ADTs make adding *operations* easy and *variants* hard; class hierarchies make the reverse — you can't have both cheaply without extra machinery.
</details>

**Q59. Why is `Option<&T>` zero-cost?**

<details><summary>Answer</summary>

A reference can't be null, so the compiler reuses the all-zeros pattern as the `None` tag (niche optimization) — same 8 bytes, no extra discriminant.
</details>

**Q60. Does Go have sum types?**

<details><summary>Answer</summary>

No; you fake them with `(value, error)`, sealed interfaces, or tagged structs — and you lose compile-time exhaustiveness.
</details>

**Q61. Why is a wildcard `_` arm risky on a domain enum?**

<details><summary>Answer</summary>

It suppresses exhaustiveness, so a future variant compiles fine and is silently mishandled instead of flagged.
</details>

**Q62. What does a function type count as in the algebra?**

<details><summary>Answer</summary>

Exponentiation: `A -> B` has `|B|^|A|` values.
</details>

---

## How to Talk About ADTs in Interviews

A few habits separate a strong answer from a textbook recital:

- **Lead with the *guarantee*, not the syntax.** Don't just say "I'd use an enum." Say *what becomes impossible* — "the connected-but-no-session state can't be constructed, so no consumer has to defend against it." The value of an ADT is the bug class it deletes.
- **Reach for the algebra when reasoning about correctness.** Counting inhabitants ("3 booleans = 8 states for a 3-state domain → 5 illegal") is a concrete, senior way to justify a refactor and to explain "make illegal states unrepresentable."
- **Name the trade-off.** Sums give exhaustiveness *inside* a binary but are not forward-compatible across versioned wire formats; "parse, don't validate" needs a private constructor to hold; niche optimization is free for `&T`/`NonZero` but not for `u64`. Acknowledging the other side is the senior signal.
- **Frame the OO comparison as the Expression Problem.** "Which grows — kinds or operations?" beats a tribal "FP vs OO." It shows you understand the duality, not a slogan.
- **Treat the "adding a variant broke everything" as a feature.** The compiler enumerating every affected site is the safety you bought; the scary version is the one that compiles silently.
- **Go deep only when invited.** Memory layout, niche optimization, jump-table compilation, and `B^A` exponentials are great for "go deeper" prompts but shouldn't bury the practical point.
- **Use a concrete domain.** Modeling a payment method, an HTTP response lifecycle, or a discount as a sum lands far harder than reciting "product and sum types."

---

## Summary

- An ADT is built from **products** (fields combined — "and") and **sums** (alternatives — "or"), consumed by **pattern matching**; "algebraic" is literal — value counts **multiply** for products and **add** for sums, with `0` (empty type) and `1` (unit type) and `B^A` (functions) completing a semiring.
- The junior bar is the vocabulary plus everyday `Option`/`Result`; the middle bar is **domain modeling**, choosing `Option` over `null`, recursive ADTs, and the per-language idioms (Rust `enum`, Java `sealed`+`record`, Python dataclass-union+`match`, Go sealed interface — with **no Go sum types** and no Go exhaustiveness).
- The senior bar is **designing with the type system**: *make illegal states unrepresentable* (shrink cardinality to the domain), *parse don't validate* (carry the proof in a narrower type), the **Expression Problem** (ADTs ease operations, hierarchies ease variants), and **evolving/versioning** ADTs (exhaustiveness helps in one binary, needs an escape hatch across wire boundaries).
- The professional bar is the mechanics: **type-counting isomorphisms**, **tagged-union layout** and **niche optimization** (`Option<&T>` is zero-cost; `Option<u64>` is not), why recursive ADTs need **indirection**, and how a `match` lowers to **jump tables / decision trees**.
- The recurring senior insight: an ADT's worth is the *illegal states it deletes at compile time* — judge the design by what it makes **unrepresentable**, and let the **algebra** (count the inhabitants) guide the modeling.

---

## Related Topics

- [`junior.md`](junior.md) — products, sums, and reading `Option`/`Result`.
- [`middle.md`](middle.md) — domain modeling and the per-language idioms.
- [`senior.md`](senior.md) — illegal states, parse-don't-validate, the Expression Problem.
- [`professional.md`](professional.md) — type counting, memory layout, match compilation.
- [Functional Programming roadmap](../README.md) — the paradigm these types come from.
- *Map / Filter / Reduce* and *Composition* (sibling FP topics) — the combinators that consume ADTs like `Option`/`Result`.
- *Monads — Plain English* (sibling FP topic) — why `Option`/`Result`/`Promise` share `map`/`flatMap` and are all one idea.
- *Functional vs OO in Practice* (sibling FP topic) — the Expression Problem trade-off in daily use.
- [Clean Code → Pure Functions](../../clean-code/15-pure-functions/README.md) — total functions over precisely-shaped inputs.
