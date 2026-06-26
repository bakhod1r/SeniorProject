# What Is a Type — Tasks & Exercises

> **Topic:** [What Is a Type](README.md)
> **Focus:** Hands-on exercises that turn the definitions into reflexes — defining types as sets+operations, separating static from dynamic type, observing type vs memory representation, and using types to make illegal states unrepresentable.

---

## How to Use This Page

Work top to bottom; difficulty rises within each section. Each task has a **self-check** box, a **hint** (folded — try without it first), and most have a **sparse solution** that shows the idea rather than a full implementation. Use whatever language you're comfortable in unless a task names one. The goal is fluency: by the end you should *think in types* without effort.

Legend: ☐ = not done, ☑ = done and self-checked.

- [Section A — Warm-Up: Types as Sets + Operations](#section-a--warm-up-types-as-sets--operations)
- [Section B — Static vs Dynamic Type](#section-b--static-vs-dynamic-type)
- [Section C — What the Type System Buys You](#section-c--what-the-type-system-buys-you)
- [Section D — Type vs Representation](#section-d--type-vs-representation)
- [Section E — Make Illegal States Unrepresentable](#section-e--make-illegal-states-unrepresentable)
- [Section F — Formal Lenses (Stretch)](#section-f--formal-lenses-stretch)
- [Section G — Capstone Projects](#section-g--capstone-projects)
- [Self-Assessment Checklist](#self-assessment-checklist)

---

## Section A — Warm-Up: Types as Sets + Operations

### Task A1 — Name the set and the operations ☐

For each type, write down (a) its set of values and (b) three valid operations: `bool`, `byte` (unsigned 8-bit), `char`, a 2-element tuple `(int, string)`.

<details><summary>Hint</summary>

A type is a *set* plus the *operations* valid on it. For `byte`, the set is finite. For the tuple, operations include projecting each component.

</details>

<details><summary>Solution (sparse)</summary>

- `bool`: `{true, false}`; ops: `&&`, `||`, `!`, `==`.
- `byte`: `{0, 1, ..., 255}`; ops: `+` (wrapping/overflow!), `&`, `<`, `==`.
- `char`: the set of code points; ops: `==`, ordering, `toUpper`.
- `(int, string)`: all pairs of an int and a string; ops: `.0`/first, `.1`/second, `==`.

</details>

### Task A2 — Same symbol, different operation ☐

In your language, evaluate `1 + 1`, `"1" + "1"`, and `1 + "1"`. Record the result (or error) of each and explain, in terms of *types*, why they differ.

<details><summary>Hint</summary>

`+` is not one operation — it's a different operation per type. The type of the operands decides which operation runs, or whether one exists.

</details>

**Self-check:** Can you state which type's "version" of `+` ran in each case, and why the third may error or coerce?

### Task A3 — Predict the type error ☐

Write five small expressions that you *expect* to be type errors (e.g. calling a string method on a number). Predict, for each, *when* the error fires in your language: compile time or run time. Then run them and check your predictions.

<details><summary>Hint</summary>

Statically typed languages (Java, Go, Rust, TS) catch most before running; dynamically typed ones (Python, JS) catch them when the bad line executes.

</details>

**Self-check:** Were any caught at a *different* time than you predicted? That gap is the static/dynamic distinction.

### Task A4 — `"5"` vs `5` ☐

Write a function that takes a value which *might* be the string `"5"` or the integer `5` and reliably produces the integer `5`. Then write the inverse. Note every place an implicit conversion could silently do the wrong thing.

<details><summary>Solution (sparse)</summary>

Convert explicitly: `int("5")` / `"5".parse::<i32>()` going one way, `str(5)` / `5.to_string()` the other. The lesson: never *assume* `"5"` and `5` are interchangeable — convert deliberately at the boundary.

</details>

---

## Section B — Static vs Dynamic Type

### Task B1 — Identify both types ☐

For `Animal a = new Dog();` (or your language's equivalent), write down the static type of `a` and the dynamic type of the value. Then: can you call `a.bark()`? Which type decides?

<details><summary>Hint</summary>

The static type governs *what you may write*; the dynamic type governs *which implementation runs*.

</details>

<details><summary>Solution (sparse)</summary>

Static type: `Animal`. Dynamic type: `Dog`. `a.bark()` does **not** compile — `bark` isn't declared on `Animal`, and the *static* type is what the compiler checks. The dynamic type being `Dog` is irrelevant to whether you may write the call.

</details>

### Task B2 — Make a downcast fail ☐

In a language with subtyping (Java/C#/TS), write code that *compiles* but throws a cast/assertion failure at run time. Explain why the compiler couldn't catch it.

<details><summary>Solution (sparse)</summary>

```java
Animal a = new Cat();
Dog d = (Dog) a;   // compiles (a's static type Animal could be Dog), throws at run time
```

The compiler only knows `a` is *some* `Animal`; only the runtime tag (`Cat`) reveals the cast is wrong.

</details>

### Task B3 — Inference is still static ☐

Write three statements using inference (`x := ...` in Go, `let x = ...` in Rust, `var x = ...` in Java/TS). For each, get your tooling (compiler error, IDE hover, `:type` in a REPL) to tell you the *inferred* type. Confirm it was fixed at compile time, not chosen at run time.

<details><summary>Hint</summary>

Try assigning a wrong-typed value on the next line — if it's a *compile* error, the inferred type was static.

</details>

**Self-check:** Can you articulate why "the compiler inferred it" is the opposite of "it's dynamically typed"?

### Task B4 — Observe erasure ☐

In Java: print `new ArrayList<String>().getClass() == new ArrayList<Integer>().getClass()`. In TypeScript: compile a typed function and read the emitted JavaScript. Record what happened to the type information.

<details><summary>Solution (sparse)</summary>

Java prints `true` — both are `ArrayList` at run time; the type argument was erased. TypeScript's output has *no* type annotations at all; everything was erased after checking. In both, types existed only to check your code.

</details>

### Task B5 — `null` slips past the type ☐

In a language without null-safety in the type system (Java, Go), declare a variable of a reference type, leave it `null`/`nil`, and call a method on it. Then rewrite using an optional/nullable type (`Optional`, `Option<T>`, Kotlin `T?`) so the possibility of absence is *in the type*.

<details><summary>Hint</summary>

The point: a plain `String` variable doesn't actually guarantee a `String` is present. Making absence part of the type forces you to handle it.

</details>

**Self-check:** In the rewritten version, does the compiler *force* you to handle the empty case before using the value?

---

## Section C — What the Type System Buys You

### Task C1 — Types as documentation ☐

Take an untyped/loosely-typed function you wrote recently (or `def process(data)`). Add precise parameter and return types. Then ask a colleague (or rubber duck) to explain what the function does *from the signature alone*. Note how much the types communicated.

**Self-check:** Could a reader infer the contract without reading the body? If not, tighten the types.

### Task C2 — Types power tooling ☐

In a typed editor, type a value of a known type and trigger autocomplete (`.` after a variable). Then change its declared type and watch the suggestions change. Record what the editor knew *because of* the type.

<details><summary>Hint</summary>

Autocomplete, go-to-definition, and refactoring all run on type information. This is a concrete, daily payoff of static types.

</details>

### Task C3 — Types catch a real bug ☐

Deliberately introduce a swapped-argument bug into a function whose two parameters have the *same* type (`f(int, int)`), confirm it compiles silently, then give the parameters *distinct* types (newtypes/branded types) and confirm the swap now fails to compile.

<details><summary>Solution (sparse)</summary>

```rust
fn rect(width: u32, height: u32) -> u32 { width * height }
// rect(h, w) compiles silently — bug invisible.

struct Width(u32); struct Height(u32);
fn rect2(w: Width, h: Height) -> u32 { w.0 * h.0 }
// rect2(h, w) -> COMPILE ERROR. The swap is now unrepresentable.
```

</details>

### Task C4 — Soundness has limits ☐

Write a *well-typed* program that is nonetheless *wrong* — it compiles cleanly but computes the wrong answer or loops forever. Use it to explain, in one sentence, what "well-typed programs don't go wrong" does and doesn't promise.

<details><summary>Hint</summary>

`fn average(xs: &[f64]) -> f64 { xs.iter().sum::<f64>() / (xs.len() as f64 + 1.0) }` — perfectly typed, off-by-one wrong. Soundness rules out *type* errors, not *logic* errors.

</details>

---

## Section D — Type vs Representation

### Task D1 — Same bytes, different type ☐

Take a 32-bit float (e.g. `3.1415927`), get its raw bytes, and reinterpret those bytes as a 32-bit integer. Then go the other way. Record both readings of the same bits.

<details><summary>Solution (sparse)</summary>

```rust
let f = 3.1415927_f32;
let bits = f.to_bits();          // 0x40490fdb as u32
let back = f32::from_bits(bits); // 3.1415927 again
```

Same four bytes; the *type* is the lens that decides whether they read as a float or an integer.

</details>

### Task D2 — Field order changes size ☐

Define a struct with fields `{ a: u8, b: u64, c: u8 }` (or your language's equivalent) and print its size. Reorder to `{ b: u64, a: u8, c: u8 }` and print again. Explain the difference.

<details><summary>Hint</summary>

Alignment padding: the `u64` must sit on an 8-byte boundary, so a `u8` before it wastes 7 bytes. Same logical content, different layout.

</details>

<details><summary>Solution (sparse)</summary>

In C / `repr(C)` Rust: the first is typically 24 bytes (padding), the second 16. The *type's* fields are identical; the *representation* differs because of alignment.

</details>

### Task D3 — Newtype is free ☐

Wrap an integer in a newtype (`struct Meters(u64)`), and confirm with `sizeof`/`size_of` that the wrapper adds zero bytes. Then confirm it's a *distinct* type by trying to pass a raw integer where `Meters` is expected.

<details><summary>Hint</summary>

"Zero-cost abstraction" = logically distinct, physically identical. The safety is free at run time.

</details>

**Self-check:** Can you state precisely what "zero-cost" means here (physical, not logical)?

### Task D4 — Type safety ≠ memory safety ☐

Write down a one-line example of a bug that is a *memory-safety* violation but not a type violation (out-of-bounds array access), and one that is a *type* confusion but not memory corruption (passing a `userId` where an `orgId` was expected in a managed language). Explain why they're different dials.

<details><summary>Solution (sparse)</summary>

- Memory-unsafe, type-OK: `arr[10]` on a length-5 array in C — reads memory it shouldn't, but no type rule was broken.
- Type-confused, memory-safe: in Python/Java, `chargeAccount(orgId)` when `chargeAccount(userId)` was meant — both are integers, no corruption, catastrophically wrong logic.

Different failure modes, different fixes (bounds checks vs distinct types).

</details>

---

## Section E — Make Illegal States Unrepresentable

### Task E1 — Boolean soup to sum type ☐

Take a record with three booleans `{ isPending, isShipped, isCancelled }`. List every combination of the three booleans (there are 8) and mark which are *legal*. Then redesign as a single type so only the legal states can be constructed.

<details><summary>Solution (sparse)</summary>

Only 3 of 8 boolean combinations are legal; the type below makes the other 5 unrepresentable:

```typescript
type Order =
  | { status: "pending" }
  | { status: "shipped"; trackingId: string }
  | { status: "cancelled"; reason: string };
```

Note "shipped" *requires* a tracking ID and "cancelled" *requires* a reason — the type encodes the rule.

</details>

### Task E2 — Parse, don't validate ☐

Replace an `isValidEmail(s: string): bool` check with a `parseEmail(s: string): Email | null` that returns a *distinct* `Email` type. Make a downstream `sendWelcome` take `Email`, and confirm you can no longer pass a raw `string`.

<details><summary>Hint</summary>

The validated value should *carry the proof of validity in its type*, so downstream code never re-validates.

</details>

<details><summary>Solution (sparse)</summary>

```typescript
type Email = string & { readonly __brand: "Email" };
function parseEmail(s: string): Email | null {
  return /^[^@]+@[^@]+$/.test(s) ? (s as Email) : null;
}
function sendWelcome(to: Email) { /* no re-validation needed */ }
```

</details>

### Task E3 — Typestate for a connection ☐

Model a `Connection` with two states, `Open` and `Closed`, so that `send()` exists only on an open connection and `close()` turns an open one into a closed one. Confirm that calling `send()` after `close()` does not compile.

<details><summary>Hint</summary>

Use a phantom type parameter (`Connection<State>`); `send` is implemented only for `Connection<Open>`.

</details>

<details><summary>Solution (sparse)</summary>

```rust
struct Open; struct Closed;
struct Conn<S> { fd: i32, _s: std::marker::PhantomData<S> }
impl Conn<Open>  { fn send(&self) {} fn close(self) -> Conn<Closed> { Conn{fd:self.fd,_s:Default::default()} } }
// conn.close() then conn.send() -> use-after-move + no send() on Closed: won't compile.
```

</details>

### Task E4 — Units that can't be mixed ☐

Create two distinct temperature types, `Celsius` and `Fahrenheit` (both wrapping a float), and a conversion function between them. Confirm that adding a `Celsius` to a `Fahrenheit` does not compile, and that you must convert explicitly.

<details><summary>Hint</summary>

This is the Mars Climate Orbiter bug made into a compile error. Newtype or phantom type each unit.

</details>

**Self-check:** Did you make the conversion *explicit*, with no implicit coercion? (If `c + f` ever compiles, you've left the bug class open.)

### Task E5 — When *not* to type-encode ☐

Pick one invariant you would enforce with a *runtime* check rather than a type (e.g. "this string matches a complex regex" or "this number is within a runtime-configured range"). Justify the choice in two sentences: why the type-encoding cost exceeds the payoff here.

<details><summary>Hint</summary>

Triage: reserve heavy type machinery for high-frequency, high-cost invariants. Cheap runtime checks are fine for the long tail and for constraints that are awkward or impossible to express statically.

</details>

---

## Section F — Formal Lenses (Stretch)

### Task F1 — Curry–Howard table ☐

Without looking back, fill in the right column: AND → ?, OR → ?, implies → ?, True → ?, False → ?. Then write a function whose *type* is a proof of "`A` and `B` implies `A`" (i.e. `(A, B) -> A`).

<details><summary>Solution (sparse)</summary>

AND → product `(A, B)`; OR → sum `Either A B`; implies → function `A -> B`; True → unit `()`; False → `Void`/`Never`. The proof of `(A ∧ B) ⇒ A`:

```haskell
fst' :: (a, b) -> a
fst' (x, _) = x   -- a value of this type IS a proof of the proposition
```

</details>

### Task F2 — Inhabit (or don't) ☐

For each type, decide whether you can write a *total* function of it, and explain what proposition it corresponds to: `a -> a`, `a -> b`, `(a -> b) -> a -> b`, `Void -> a`.

<details><summary>Solution (sparse)</summary>

- `a -> a`: yes (`id`) — proves `A ⇒ A`.
- `a -> b`: no total inhabitant — you can't conjure a `b` from nothing (`A ⇒ B` isn't generally provable).
- `(a -> b) -> a -> b`: yes (apply) — modus ponens.
- `Void -> a`: yes (`absurd`) — from `False`, anything follows (ex falso).

</details>

### Task F3 — Where types-as-sets breaks ☐

In your own words (a short paragraph each), explain why "a type is just a set of values" breaks for (a) function types, (b) recursive types, and (c) a type of all types.

<details><summary>Hint</summary>

(a) cardinality / computable vs mathematical functions; (b) needs a least fixed point, not enumeration; (c) Russell's paradox → universe hierarchies.

</details>

### Task F4 — Uni-typed reframing ☐

Write 4–5 sentences arguing that a dynamically typed language is *uni-typed* rather than untyped. Include what it pays, and when, in place of compile-time checking.

<details><summary>Hint</summary>

One universal type; every operation does a runtime tag check; a dynamic language is a static language over a single recursive type with tag-checking projections.

</details>

---

## Section G — Capstone Projects

### Project G1 — A "when does it catch it?" comparison ☐

Write the *same* type error (e.g. adding a string to a number, or calling a missing method) in five languages: Python, Java, TypeScript, Go, Rust. Produce a small table recording, for each: does it fail at compile time or run time, and what does the message say? Write a one-paragraph conclusion about the static/dynamic spectrum.

**Acceptance:** Table has 5 rows; each correctly classifies compile-time vs run-time; conclusion connects the observation back to "where the type lives."

### Project G2 — A typed domain model ☐

Pick a small domain (a library catalog, a coffee order, a TODO app). Model every entity with precise types: newtypes for IDs (`BookId`, not `string`), enums for fixed sets (`Status`, not `string`), sum types for mutually-exclusive states, and validated types for inputs. Write down, for at least three of your types, *which bug class it makes unrepresentable*.

**Acceptance:** No bare `string`/`int` for a semantically meaningful concept; at least one sum type with per-variant required fields; at least one validated "parse, don't validate" boundary; three documented eliminated bug classes.

### Project G3 — A representation explorer ☐

In a systems language, write a small program that prints, for a variety of types (`bool`, `i32`, `f64`, a pointer, a 3-field struct, a sum type with a small and a large variant), their `size_of` and the offset of each field. Then reorder one struct to shrink it and box one large enum variant to shrink the enum. Write a short note on what you learned about type-vs-representation.

**Acceptance:** Sizes printed for ≥6 types; one struct shrunk by reordering with the byte difference explained; one enum shrunk by boxing the large variant; note ties back to "a type is also a layout decision."

### Project G4 — Refactor boolean soup ☐

Find real code (yours or open source) that uses multiple booleans or nullable fields to encode mutually-exclusive states. Refactor it to a single sum type. Count: how many previously-representable illegal states are now unrepresentable? Did any existing code become *unnecessary* (validation, defensive checks) because the type now guarantees the invariant?

**Acceptance:** Before/after types shown; count of eliminated illegal states; at least one piece of now-redundant runtime check identified and removed.

---

## Self-Assessment Checklist

You understand "what is a type" when you can, without notes:

- ☐ Define a type three ways: set+operations, contract/proposition, interface/capability.
- ☐ Given `Animal a = new Dog();`, state the static and dynamic types and which governs what.
- ☐ Explain why a downcast can compile yet fail at run time, and why upcasts never fail.
- ☐ State Milner's soundness slogan *and* one bug class it does not cover.
- ☐ Distinguish type checking, type inference (still static!), and type erasure.
- ☐ Explain why "strong/weak typing" is vague and give three better axes.
- ☐ Reinterpret the same bytes under two types and explain the "lens over bits."
- ☐ Explain why field ordering changes struct size, and why a newtype is zero-cost.
- ☐ Give an example of a memory-safety bug that isn't a type bug, and vice versa.
- ☐ Fill in the Curry–Howard table (AND/OR/implies/True/False) and write a proof-as-program.
- ☐ Refactor "boolean soup" into a sum type and name the illegal states you eliminated.
- ☐ Apply "parse, don't validate" so a value carries proof of its own validity.
- ☐ Decide when an invariant is *not* worth type-encoding and justify a runtime check instead.

If every box is checked, move on to the next topic — static vs dynamic typing in depth.
