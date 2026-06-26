# Subtyping & Liskov Substitution — Hands-On Tasks

> **Topic:** [Subtyping & Liskov Substitution](README.md)

---

## Introduction

This file takes you from "I can recite the Square/Rectangle example" to "I can
detect a substitutability break in unfamiliar code, prove a hierarchy unsound,
and refactor it without breaking callers." Every task is small enough for one
or two focused sessions, and they build on one another. Attempt each before
reading the hints — five minutes of struggle proving *why* a `Square` corrupts
a `Rectangle` teaches more than reading the answer.

How to use this file: read the task, write the code (in any statically-typed
language unless one is specified), run it, and only then check the hints. Mark a
self-check box when you can *explain* the result to someone else, not when the
program merely compiles. Solutions are intentionally sparse — they appear only
where the canonical answer is more instructive than your first attempt.

## Table of Contents

- [Warm-Up](#warm-up)
- [Core](#core)
- [Advanced](#advanced)
- [Capstone](#capstone)

---

## Warm-Up

These rebuild the mental model. Short, but each introduces a rule or failure
mode you'll reuse.

### Task 1: Reproduce the Square/Rectangle break

**Problem.** Write a mutable `Rectangle` with `setWidth`, `setHeight`, and
`area`. Subclass it as `Square` overriding both setters to keep the sides
equal. Then write a function `resize(Rectangle r)` that sets width to 5, height
to 4, and asserts `area() == 20`. Call it with a `Rectangle` and a `Square`.

**Constraints.**
- `resize` must mention only `Rectangle`, never `Square`.
- Use a real assertion (or a failing test), not a print.

**Hints (try without first).**
- The `Rectangle` passes; the `Square` fails with `area() == 16`.
- Nothing throws. The only symptom is a wrong number — that's what makes
  this class of bug so dangerous.
- Name the exact rule violated: which invariant of `Rectangle` did `Square`
  break?

**Self-check.**
- [ ] You can state the `Rectangle` invariant `Square` violates in one sentence.
- [ ] You can explain why `resize` is *correct code* even though it fails.
- [ ] You can articulate why no override of `setWidth` fixes this while both
      types are mutable.

---

### Task 2: Classify five overrides

**Problem.** For each override below, decide: valid subtype, or LSP violation
(and which rule)?

1. `Animal.describe(): String` overridden to return a `String` subtype-equivalent value but always non-empty (base allowed empty).
2. `Account.withdraw(amount)` (base accepts any `amount > 0`) overridden to reject `amount > 100`.
3. `Bird.fly()` overridden to `throw new UnsupportedOperationException()`.
4. `Shape.area(): double` (base may return any `double`) overridden to always return a value `>= 0`.
5. `List.get(i): Object` overridden to return `null` where the base documented never-null.

**Constraints.** Write one sentence per item naming the rule (precondition,
postcondition, invariant, history) or "valid."

**Hints (try without first).**
- Strengthening a precondition and weakening a postcondition are the two
  violation directions; the opposites are *safe*.
- Two of these five are valid (safe directions). Find them.

**Self-check.**
- [ ] You correctly identified the two valid ones (1 and 4).
- [ ] For each violation you named the specific rule, not just "it breaks LSP."

<details>
<summary>Solution (sparse)</summary>

1. **Valid** — strengthening a postcondition (always non-empty ⊇ base's promise). 2. **Violation, strengthened precondition** — rejects inputs the base accepted. 3. **Violation, strengthened precondition + weakened postcondition** (refused bequest). 4. **Valid** — strengthened postcondition. 5. **Violation, weakened postcondition** — null breaks the never-null guarantee.
</details>

---

### Task 3: Demonstrate the unmodifiable-collection violation

**Problem.** Take a read-only collection wrapper from your language's standard
library (Java `Collections.unmodifiableList`, or write a trivial one) and show
that calling a mutator on it throws at runtime even though the static type
permits the call.

**Constraints.** The variable's static type must be the *mutable* interface
(e.g. `List`), so the `add` call compiles.

**Hints (try without first).**
- The point is that the *signature* (`List` has `add`) is satisfied but the
  *behavior* (throws) violates the contract a `List` caller is entitled to.
- Which precondition got strengthened? State it.

**Self-check.**
- [ ] You can explain why this is an LSP violation, not just "expected behavior."
- [ ] You can describe the principled alternative (read-only supertype with no
      mutator) that avoids it.

---

## Core

These make the rules precise and connect behavior to types.

### Task 4: Prove function-type variance with code

**Problem.** Declare a function type `Handler = (Dog) -> Animal`. Then create
two candidate functions and determine which is assignable to `Handler`:
(a) `(Animal) -> Dog`, (b) `(Poodle) -> Object`. Use a language that checks
function-type variance soundly (TypeScript with `strictFunctionTypes`, Scala,
or C# delegates).

**Constraints.** Let the compiler decide; don't guess.

**Hints (try without first).**
- Parameters are contravariant: the assignable one accepts a *wider* parameter.
- Return is covariant: the assignable one returns a *narrower* result.
- (a) should be assignable; (b) should not (narrower param chokes on a non-Poodle
  Dog; wider return breaks covariance).

**Self-check.**
- [ ] You can explain *why* the parameter direction flips, using the caller's
      perspective ("the caller may pass any Dog").
- [ ] You can connect this to the precondition/postcondition LSP rules.

---

### Task 5: Make the unsound covariant list concrete

**Problem.** In Java (or C#), use the *covariant array* feature to produce an
`ArrayStoreException` at runtime. Then write the generics equivalent and show
it's a *compile* error instead.

**Constraints.** The array version must compile and fail at runtime; the
generics version must fail to compile.

**Hints (try without first).**
- `Integer[] a = ...; Object[] o = a; o[0] = "x";` — compiles, throws at store.
- `List<Integer> l = ...; List<Object> o = l;` — should not compile.
- Explain: arrays are covariant (unsound, runtime-checked); generics are
  invariant (sound, compile-checked).

**Self-check.**
- [ ] You can explain why a mutable container must be invariant by walking the
      `add`/`get` positions.
- [ ] You can state what the JVM does on every array store and why.

---

### Task 6: Refactor Square/Rectangle three ways

**Problem.** Take your Task 1 code and fix the violation three different ways:
(A) make both types immutable; (B) make `Square` and `Rectangle` siblings under
a `Shape` interface with no inheritance between them; (C) keep `Square` using
`Rectangle` by composition, exposing only `setSide`.

**Constraints.** After each refactor, your Task 1 `resize`-style logic (adapted)
must be impossible to sabotage with a `Square`.

**Hints (try without first).**
- Exit A: remove setters; "resize" returns a new instance.
- Exit C: `Square` holds a `Rectangle` field; it is *not* a `Rectangle`.
- A "fix" where `Square.setWidth` throws or adjusts height is *not* a fix — it
  relocates the violation. Don't do it.

**Self-check.**
- [ ] You can name which exit you'd choose if you couldn't change callers that
      already hold `Rectangle` references, and why.
- [ ] You can explain why mutability is the accomplice in the original bug.

---

### Task 7: Replace a refused-bequest hierarchy with capability interfaces

**Problem.** Start with `Bird { fly(); swim(); }` and three birds: an eagle
(flies), a penguin (swims), a duck (both). The naive design forces penguins to
throw on `fly()`. Redesign with capability interfaces so no method ever throws.
Then write `migrate(flock)` that accepts only fliers and prove a penguin can't
be passed.

**Constraints.** `migrate` must reject a penguin at *compile* time, not runtime.

**Hints (try without first).**
- Split into `Bird` (shared) + `Flyable` + `Swimmable`.
- `migrate` takes `List<Flyable>` (or equivalent).
- This is ISP and LSP working together.

**Self-check.**
- [ ] You can explain why the compile-time rejection is strictly better than a
      runtime `UnsupportedOperationException`.
- [ ] You can identify another real hierarchy in your codebase that should be
      capability interfaces.

---

### Task 8: Break and fix the equals contract

**Problem.** Write `Point { x, y; equals }` and `ColorPoint extends Point` that
overrides `equals` to also compare `color`. Demonstrate that
`point.equals(colorPoint)` and `colorPoint.equals(point)` disagree (asymmetry),
then show how this corrupts a `HashSet`. Finally, fix it.

**Constraints.** Show the asymmetry with a concrete assertion, then a
hash-collection corruption (an element you can't find).

**Hints (try without first).**
- `Point.equals` compares only `x,y`, so it accepts a `ColorPoint`; the reverse
  rejects. Asymmetry breaks the `Object.equals` contract — an LSP violation on
  the `Object` supertype.
- The standard fix (Effective Java): favor composition — `ColorPoint` *has a*
  `Point` — because you cannot extend an instantiable class with a value field
  and preserve `equals`.

**Self-check.**
- [ ] You can explain why `equals` symmetry/transitivity is part of `Object`'s
      contract and thus subject to LSP.
- [ ] You can describe the `HashSet` failure precisely (which element, why
      unfindable).

---

## Advanced

These require reasoning about variance, structural typing, and history.

### Task 9: Apply PECS to a copy function

**Problem.** In Java, write `static <T> void copy(List<? super T> dst,
List<? extends T> src)` that copies all elements from `src` to `dst`. Then call
it with `copy(numbers, integers)` where `numbers` is `List<Number>` and
`integers` is `List<Integer>`. Try removing the wildcards and observe the call
sites that stop compiling.

**Constraints.** Use exactly `? super T` and `? extends T`; justify each.

**Hints (try without first).**
- `src` is a *producer* (you read `T` out) → `? extends T` (covariant view).
- `dst` is a *consumer* (you write `T` in) → `? super T` (contravariant view).
- Without the wildcards, `copy(List<Number>, List<Integer>)` won't compile
  because invariant generics don't relate the two.

**Self-check.**
- [ ] You can explain PECS as LSP applied per call site.
- [ ] You can say what you *can't* do through each wildcard view (write through
      `? extends`, read-as-T through `? super`).

---

### Task 10: Find the history-constraint violation

**Problem.** Write an immutable `Money` value type whose contract guarantees the
amount never changes after construction (so it's safe as a map key). Then write
a subtype `MutableMoney` that adds `setAmount`. Each individual method looks
fine. Demonstrate the bug by using a `MutableMoney` as a `HashMap` key, mutating
it, and showing the entry becomes unfindable.

**Constraints.** Show concretely that the entry is "lost" after mutation.

**Hints (try without first).**
- The violation isn't in any single method — it's that `MutableMoney` permits a
  *history* (amount changed over time) that `Money`'s contract forbade.
- Hash-based collections cache by hash; mutating a key after insertion strands
  it. This is the history constraint biting.

**Self-check.**
- [ ] You can explain why this passes per-method LSP checks but still violates
      LSP (rule 4).
- [ ] You can state the general principle: don't add mutation under an immutable
      base.

---

### Task 11: Spot the accidental structural conformance

**Problem.** In Go or TypeScript, define an interface `Stringer`/`Named` with a
single method, then define an unrelated type that *happens* to have a matching
method with a completely different meaning (e.g. a `Bomb` with a `defuse()
string` method matching a `Tool` interface's `defuse() string`). Pass it where
the interface is expected and show it type-checks despite being semantically
nonsense.

**Constraints.** The conformance must be accidental — the type must not be
designed to implement the interface.

**Hints (try without first).**
- Structural typing checks *shape*, never *meaning*. The behavioral contract is
  entirely on you.
- This is the widened behavioral-LSP gap structural typing creates: even the
  type-level relation can be accidental.

**Self-check.**
- [ ] You can explain why nominal typing would have prevented this and at what
      cost (no retroactive conformance).
- [ ] You can describe how you'd defend a structural interface behaviorally
      (documented contract + interface tests).

---

### Task 12: Verify variance positions with the compiler

**Problem.** In Scala, Kotlin, or C#, try to declare a covariant container that
also has a mutator: `class Box[+T] { def get(): T; def set(t: T): Unit }`.
Observe the compiler error. Then fix it two ways: (a) remove the mutator (make
it immutable, keep covariance), (b) split into a covariant `Source[+T]` and an
invariant `Box[T]`.

**Constraints.** Read the actual compiler error and quote the offending
position.

**Hints (try without first).**
- The error is "covariant type T occurs in contravariant position" (or
  equivalent) — `set(t: T)` is an *input* use of a covariant parameter.
- This is the compiler enforcing the type-level half of LSP at the declaration
  site.

**Self-check.**
- [ ] You can explain *which position* the mutator's parameter is and why it
      conflicts with covariance.
- [ ] You can connect declaration-site variance checking to LSP soundness.

---

## Capstone

A larger exercise integrating detection, proof, and refactor.

### Task 13: Build a contract-test harness and catch a planted violation

**Problem.** Define an `Account` base type with a documented contract:
precondition `withdraw(amount)` requires `0 < amount <= balance`; postcondition
`balance == old - amount`; invariant `balance >= 0`. Write an *abstract
contract test* asserting all three. Implement two honest subtypes
(`SavingsAccount`, `CheckingAccount`) that pass it. Then implement a *planted*
violator (`CappedAccount` that rejects `amount > 50`, or `FlakyAccount` that
sometimes skips the deduction) and prove the contract test *fails* for it while
the compiler stays silent.

**Constraints.**
- The contract test must be written against the base type and run, parameterized,
  over *every* subtype.
- The violator must compile cleanly — the only signal is the failing contract
  test.

**Hints (try without first).**
- `CappedAccount` fails the precondition test (it rejects a valid amount);
  `FlakyAccount` fails the postcondition test (balance not reduced).
- This is the practical answer to "how do you enforce LSP when the compiler
  only checks signatures" — make the behavioral contract executable.

**Self-check.**
- [ ] Your contract test asserts only what the *base contract* promises (so it's
      shareable across all subtypes).
- [ ] You can explain why this catches violations the compiler can't, and how
      you'd wire it into CI.
- [ ] You can name which LSP rule each planted violator breaks.

---

### Task 14: Audit and refactor a real leaky hierarchy

**Problem.** Take `java.util.Stack extends Vector` (or model an equivalent in
your language: a stack that inherits a list and thereby exposes positional
mutation). Demonstrate the LSP violation — call a `Vector` method that breaks
LIFO discipline (e.g. `add(0, x)`). Then refactor to a composition-based
`Stack` that holds a list and exposes only `push`/`pop`/`peek`, and show the
violating call no longer compiles.

**Constraints.** The before-version must let you corrupt stack order through an
inherited method; the after-version must make that impossible at compile time.

**Hints (try without first).**
- `Stack extends Vector` inherits `add(index, element)`, `remove(index)`, etc.,
  which violate the stack's LIFO invariant.
- The fix is "composition over inheritance": hold the list privately, expose
  only the stack operations.
- Note that `ArrayDeque` is the modern recommended stack precisely for this
  reason.

**Self-check.**
- [ ] You can explain why `Stack extends Vector` is "inheritance for code reuse
      where substitutability doesn't hold."
- [ ] You can articulate the trade-off you accepted by switching to composition
      (lose the `Vector` API, gain an honest contract).
- [ ] You can generalize: when do you choose inheritance vs composition with
      respect to LSP?
