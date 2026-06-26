# Nominal vs Structural Typing — Hands-On Tasks

> **Topic:** [Nominal vs Structural Typing](README.md)

---

## Introduction

This file is a structured set of exercises that take you from "I can recite
that Go is structural and Java is nominal" to "I can design ID-safe domain
types, predict exactly what my compiler will accept, work around Rust's
orphan rule, and reason about the soundness holes." Every task is small and
they build on one another. Attempt each one before reading the hints —
*compiling the buggy ID code and watching it accept the wrong argument*
teaches the lesson far better than reading about it.

How to use this file: read the task, write and *run* the code in the named
language (a playground is fine — Go Playground, the TypeScript Playground,
the Rust Playground), observe whether it compiles, and only then check the
hints. Tick the self-check boxes when you can *explain* the result to
someone else, not merely when the program compiles. Solutions are sparse and
appear only where the canonical answer is more instructive than your first
attempt.

## Table of Contents

- [Warm-Up](#warm-up)
- [Core](#core)
- [Advanced](#advanced)
- [Capstone](#capstone)

---

## Warm-Up

These rebuild the mental model. Short, but each introduces a primitive or a
failure mode you'll reuse.

### Task 1: Same shape, different name

**Problem.** In **Java** (or C#), declare two classes `Point2D` and
`Vector2D`, each with `int x` and `int y`. Try to assign a `Point2D` to a
`Vector2D` variable. Then do the equivalent in **TypeScript** with two
interfaces and two object values. Record which compiles and which doesn't.

**Constraints.**
- No `extends`/`implements` between the two types.
- The fields must be identical in both languages.

**Hints (try without first).**
- Java will reject the assignment: nominal, different names, no declared link.
- TypeScript will accept it: structural, identical shape.
- This one example *is* the whole distinction. Make sure you can say why.

**Self-check.**
- [ ] You can state which language used the name and which used the shape.
- [ ] You can explain why the nominal one rejected identical fields.

---

### Task 2: Implicit interface satisfaction in Go

**Problem.** In **Go**, define `type Stringer interface { String() string }`.
Define a struct `Color{R,G,B int}` with a `String() string` method that
*never mentions* `Stringer`. Assign a `Color` to a `Stringer` variable and
print it.

**Constraints.**
- Do not write any `implements` (Go has none) or reference `Stringer` in the
  struct or its method.

**Hints.**
- It compiles and works — `Color` satisfies `Stringer` purely by having the
  method. That's implicit, structural conformance.
- Now add the pin `var _ Stringer = Color{}` near the type. Confirm it
  compiles, then break `String`'s signature and watch the pin fail.

**Self-check.**
- [ ] You can explain what made `Color` satisfy `Stringer`.
- [ ] You understand what the `var _ Stringer = Color{}` pin buys you.

---

### Task 3: The pointer-receiver gotcha

**Problem.** Take Task 2's `Color`, but change `String()` to a **pointer
receiver**: `func (c *Color) String() string`. Now try both
`var s Stringer = Color{...}` and `var s Stringer = &Color{...}`.

**Hints.**
- The value version fails: a pointer-receiver method is only in the method
  set of `*Color`, not `Color`.
- The error message hints at "method has pointer receiver."

**Self-check.**
- [ ] You can state the value-receiver vs pointer-receiver method-set rule.
- [ ] You can predict which interface assignments will compile.

---

### Task 4: The alias that protects nothing

**Problem.** In **TypeScript**, write `type UserId = string` and a function
`getUser(id: UserId)`. Call it with a plain string literal and with a
variable typed `string`. Does it compile? Now repeat with a *branded* type
`type UserId = string & { __brand: "UserId" }` and a constructor.

**Hints.**
- The alias version accepts any string — an alias is just a nickname, zero
  safety. This surprises most people.
- The branded version rejects plain strings; you must mint via the
  constructor.

**Self-check.**
- [ ] You can explain why the alias provides no protection.
- [ ] You can explain what the brand field does and that it's erased at
      runtime.

---

## Core

These force you to *use* the models to prevent real bugs.

### Task 5: Catch the ID swap

**Problem.** Model a function `refund(userId, orderId)` where both IDs are
strings. First write it with bare `string` parameters and deliberately call
it with the arguments swapped — confirm it compiles (the bug). Then make
`UserId` and `OrderId` distinct types so the swap becomes a compile error.
Do it in **two** languages: TypeScript (branded) and Rust (newtype).

**Constraints.**
- The "minting" of a branded/newtype value must happen in exactly one place.
- The swapped call must *fail to compile* in the fixed version.

**Hints.**
- Rust: `struct UserId(String); struct OrderId(String);` — distinct nominal
  types, swap won't compile.
- TypeScript: brand both, provide `UserId(s)`/`OrderId(s)` constructors.
- The whole point: identical representation, different *meaning*, made
  un-swappable.

**Self-check.**
- [ ] The buggy version compiled and the fixed version rejected the swap.
- [ ] You can explain why the bare-string version was a latent bug.

**Sparse solution (Rust core).**
```rust
struct UserId(String);
struct OrderId(String);
fn refund(_u: UserId, _o: OrderId) {}
fn main() {
    let u = UserId("u1".into());
    let o = OrderId("o1".into());
    refund(u, o);          // ✅
    // refund(o, u);       // ❌ mismatched types — the swap is now impossible
}
```

---

### Task 6: Retroactive conformance

**Problem.** In **Go**, write a struct `LegacyFile` with `Read(p []byte)
(int, error)` *first*. Then, in code that "didn't exist yet," declare an
interface `Reader interface { Read([]byte) (int, error) }` and a function
that consumes a `Reader`. Pass your `LegacyFile` without modifying it. Then
attempt the conceptual equivalent in Java and describe why it can't work the
same way.

**Hints.**
- Go: `LegacyFile` satisfies `Reader` with zero changes — retroactive
  conformance for free.
- Java: a pre-existing class can't satisfy a later interface without editing
  it to add `implements`, or writing an adapter that wraps it.

**Self-check.**
- [ ] You demonstrated structural retroactive conformance.
- [ ] You can explain why nominal typing needs an adapter/wrapper instead.

---

### Task 7: The excess-property check

**Problem.** In **TypeScript**, write `function plot(p: {x: number; y:
number})`. Call it three ways: (a) with an object literal `{x:1,y:2,z:3}`
directly; (b) by first assigning that literal to a variable and passing the
variable; (c) with a type assertion. Record which compile.

**Hints.**
- (a) fails — excess property check on a fresh literal.
- (b) succeeds — width subtyping applies to a variable.
- (c) succeeds — the assertion bypasses the check.
- The compiler treats an extra field in a *literal* as a likely typo.

**Self-check.**
- [ ] You can explain why the literal and the variable behave differently.
- [ ] You can name the heuristic behind the excess-property check.

---

### Task 8: Width and depth subtyping

**Problem.** In **TypeScript**, demonstrate (a) **width**: a `{x,y}` value is
assignable to `{x}`; and (b) **depth**: a `{pet: {legs:number; bark():void}}`
value is assignable to `{pet: {legs:number}}`. Then show that the
corresponding assignment is *rejected* in a nominal language (Java) without
declared inheritance.

**Hints.**
- Width = "more fields is a subtype." Depth = "more specific field types is a
  subtype."
- Nominal record types have neither by default — you'd need `extends`.

**Self-check.**
- [ ] You can define width and depth subtyping and give an example of each.
- [ ] You can explain why nominal records don't get them for free.

---

### Task 9: Recover intentionality in Go

**Problem.** Your Go interface keeps getting satisfied accidentally by
unrelated types. Make an interface that *only types in your package* can
satisfy, by including an **unexported method** in it. Show that a type in
another package cannot satisfy it even with all the exported methods.

**Hints.**
- An interface with a lowercase (unexported) method can't be implemented
  outside the package, because outside code can't define that method.
- This is the idiomatic way to add nominal-style "you must opt in here"
  intentionality to structural Go (the `error`-like sealed pattern).

**Self-check.**
- [ ] You can explain how an unexported interface method seals conformance.
- [ ] You can describe when you'd want this and when it's overkill.

---

## Advanced

### Task 10: The orphan rule and the newtype workaround

**Problem.** In **Rust**, try to `impl Display for Vec<String>` and observe
the orphan-rule error (`E0117`). Then fix it by wrapping `Vec<String>` in a
newtype `struct Lines(Vec<String>)` and implementing `Display` on `Lines`.
Add a `Deref` so `Lines` behaves like the inner vec.

**Hints.**
- The orphan rule forbids implementing a foreign trait for a foreign type.
- A newtype you own makes the impl legal — same mechanism as ID safety,
  different purpose (re-homing a trait impl).
- `impl Deref for Lines { type Target = Vec<String>; ... }` restores
  ergonomics.

**Self-check.**
- [ ] You can state the orphan rule precisely.
- [ ] You can explain why the newtype makes the impl legal (you own it).
- [ ] You can explain what coherence the orphan rule is protecting.

---

### Task 11: Find the soundness hole

**Problem.** In **TypeScript**, build an `Animal`/`Dog`/`Cat` hierarchy.
Demonstrate the covariant-array hole: assign `Dog[]` to `Animal[]`, then push
a `Cat` through the `Animal[]` alias, and show that the original `Dog[]` is
now corrupted with no compile error and no runtime error. Then describe how
Java differs.

**Hints.**
- TS arrays are covariant and the write goes unchecked — silent corruption.
- Java arrays are *also* covariant but throw `ArrayStoreException` at runtime
  — the hole is patched dynamically.
- Sound languages make mutable containers invariant; TS trades soundness for
  ergonomics.

**Self-check.**
- [ ] You reproduced the corruption with no error in TS.
- [ ] You can explain why mutable containers *should* be invariant.
- [ ] You can contrast TS (silent) with Java (`ArrayStoreException`).

---

### Task 12: Function parameter variance

**Problem.** In **TypeScript** with `strictFunctionTypes` enabled, declare
`Handler<T> = (x: T) => void`. Show that `Handler<Animal>` is assignable to
`Handler<Dog>` (contravariant parameters) but not vice versa. Then show that
writing the same callback as a *method* (`handle(cb): void`) is checked
*bivariantly* and lets the unsound direction through.

**Hints.**
- Function-typed properties get sound contravariant checking under strict.
- Method-shorthand parameters remain bivariant for legacy reasons — a
  genuine, documented unsoundness.

**Self-check.**
- [ ] You can state the function-subtyping rule (contravariant params,
      covariant return).
- [ ] You can show the method-bivariance hole and explain why it's unsound.

---

### Task 13: Phantom-typed state machine

**Problem.** In **Rust** (or TypeScript with branded types), model a
connection that can be `Open` or `Closed` using a **phantom type parameter**,
so that `read()` is only callable on an `Open` connection and the compiler
rejects reading a `Closed` one — with no runtime cost.

**Hints.**
- Rust: `struct Conn<State> { _marker: PhantomData<State> }` with marker
  types `Open`/`Closed`; define `read` only in `impl Conn<Open>`.
- The state lives entirely in the type; there's no runtime field for it.

**Self-check.**
- [ ] You can explain what a phantom type is and why it costs nothing at
      runtime.
- [ ] Reading a `Closed` connection failed to compile.

**Sparse solution (Rust).**
```rust
use std::marker::PhantomData;
struct Open; struct Closed;
struct Conn<S> { _s: PhantomData<S> }
impl Conn<Closed> { fn open(self) -> Conn<Open> { Conn { _s: PhantomData } } }
impl Conn<Open> {
    fn read(&self) -> u8 { 0 }
    fn close(self) -> Conn<Closed> { Conn { _s: PhantomData } }
}
// Conn::<Closed>{_s:PhantomData}.read();  // ❌ no read() on Conn<Closed>
```

---

## Capstone

### Task 14: ID-safe domain layer with a migration

**Problem.** Take an existing (provide or stub) TypeScript module where
`UserId`, `MerchantId`, and `TransactionId` are all bare `string`s and at
least one function quietly takes them in the wrong order. (1) Introduce
branded types with smart constructors in a single `ids.ts` module.
(2) Brand at the boundary: a `parseUser(row)` / request decoder that mints
the IDs once where data enters. (3) Let inference propagate inward and fix
every resulting compile error — *each one is a latent bug*. (4) Add a lint
rule (or a comment-documented convention) forbidding raw `as UserId` casts
outside `ids.ts`. (5) Show the originally-swapped call now fails to compile.

**Constraints.**
- No flag-day rewrite; introduce brands alongside the old strings and migrate
  (expand/contract).
- Brands must be minted in exactly one place each.
- Verify at least one *real* swap bug is caught by the migration.

**Hints.**
- Brand boundaries first (DB rows, HTTP decode), not leaf functions.
- The compile errors that appear as you propagate brands are the payoff —
  treat each as a potential incident avoided.
- Remember brands are erased at runtime; validation belongs in the
  constructor.

**Self-check.**
- [ ] Brands are minted in one place each and can't be forged elsewhere.
- [ ] The previously-swapped call now fails to compile.
- [ ] You can explain the expand/contract migration and why you branded at
      the boundaries.
- [ ] You can explain what runtime guarantees the brands do *not* provide.

---

### Task 15: Choose the model per boundary

**Problem.** Design (on paper or in code skeletons) a small service with
three boundaries: (a) a **storage port** consumed by your domain;
(b) a **money/ID domain layer**; (c) a **public plugin interface** third
parties implement. For each boundary, decide nominal vs structural, justify
it, and note the property you're buying (retroactive conformance, intentional
opt-in, coherence, opacity, easy mocking) and the one you're giving up.

**Hints.**
- Storage port → structural capability interface (easy mocks, swap
  implementations, retroactive conformance).
- Money/IDs → nominal newtypes/brands (intentional distinctness, opacity for
  evolvability).
- Public plugin contract → lean toward nominal (explicit opt-in, breakage is
  a loud compile error) — or sealed-structural in Go via an unexported
  interface method.
- Remember coherence and unrestricted retroactive conformance are mutually
  exclusive; name which one each boundary needs.

**Self-check.**
- [ ] Each boundary has a model, a justification, and a named trade-off.
- [ ] You explicitly identified a boundary where coherence vs retroactive
      conformance forced a choice.
- [ ] You can defend each decision against the obvious "why not the other
      model?" objection.
