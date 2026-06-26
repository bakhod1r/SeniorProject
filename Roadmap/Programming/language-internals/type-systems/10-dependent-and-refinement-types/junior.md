# Dependent & Refinement Types — Junior Level

> **Topic:** [Dependent & Refinement Types](README.md)
> **Focus:** What if a type could say "this is a list of exactly 3 things" or "this is a number that is definitely positive" — and the compiler checked it for you, before the program ran?

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
14. [Further Reading](#further-reading)

---

## Introduction

> Focus: **The ordinary types you already know carry almost no information. Dependent and refinement types carry a lot more — and the compiler checks it.**

You already use types. When you write `int`, `string`, `List<User>`, you are telling the compiler what *kind* of thing a value is, and the compiler stops you from, say, adding a `string` to a `User`. That is enormously useful. But ordinary types are coarse. The type `int` covers `-3`, `0`, and `42` all the same way. The type `List<int>` is the same whether the list is empty or has a million elements. So if you write a function that divides by a number, the type system happily lets you pass `0`. If you ask for "the first element of a list," the type system happily lets you ask an empty list — and you get a crash at runtime.

**Dependent and refinement types push the line.** They let a type say more:

- A **refinement type** is a normal type *plus a condition*. Instead of `int`, you write something that reads as "an `int` that is greater than zero," written `{ v: Int | v > 0 }`. Now the compiler refuses to let a possibly-zero or possibly-negative number flow into a slot that demands a positive one.
- A **dependent type** is a type that *mentions an actual value*. The classic example is a list whose **length is part of its type**: not just "list of ints" but "list of ints of length 3." Written `Vec 3 Int`. Now a function that joins two such lists can promise, *in its type*, that the result has length `n + m` — and the compiler verifies that promise.

The payoff is dramatic. Whole categories of bug — array out-of-bounds, division by zero, calling `head` on an empty list, off-by-one — can be made **impossible to even write down**. The compiler rejects the broken program instead of you finding out in production.

The cost is real too, which is why your everyday language (Python, Java, Go, TypeScript) does not do this by default. These ideas live mostly in research-grade languages (Idris, Agda, Coq, Lean, F\*) and high-assurance tools (Liquid Haskell, Dafny). But the *ideas* are leaking into mainstream languages — TypeScript's literal types, Rust's const generics — and understanding the core intuition makes you a sharper engineer even if you never write a line of Agda.

> 🎓 **Why this matters for a junior:** You have probably written a null check, an "is this index in range?" check, or a "don't divide by zero" guard. Those checks are you, manually, at runtime, doing a job a strong enough type system could do for you at compile time — once, for all inputs, forever. This page is about that idea: *moving correctness from runtime checks into the types themselves.*

This page stays intuitive. We will not prove anything by hand. We will build the mental model — what a "type that depends on a value" even means, what a refinement is — using small, readable examples. The harder machinery (Pi and Sigma types, SMT solvers, totality checking, actual proofs) is for the higher tiers.

---

## Prerequisites

What you should know before reading this:

- **Required:** What a *type* is in any typed language. You have seen `int`, `string`, `List<T>`, and you know the compiler uses types to reject some programs (e.g. `"hello" + 5` in a strict language).
- **Required:** What a *function* is, and what "argument type" and "return type" mean.
- **Required:** Basic familiarity with generics / parametric types — `List<T>`, `Map<K, V>`, `Array<int>`. The `T` is a *type* parameter.
- **Helpful but not required:** Having hit a real bug like an array index out of bounds, a null-pointer exception, or a division by zero. Those are exactly the bugs these types prevent.
- **Helpful but not required:** A vague sense that some languages "prove" things — you do not need to know how.

You do **not** need to know:

- Any logic, proof theory, or the Curry–Howard correspondence (that is `senior.md`).
- How an SMT solver works (that is `middle.md` and beyond).
- Idris, Agda, Coq, or Lean syntax in detail. We will show tiny snippets and explain every line.

---

## Glossary

| Term | Definition |
|------|-----------|
| **Type** | A label on a value that the compiler tracks and checks. `int`, `string`, `List<User>`. |
| **Static type** | A type known and checked at **compile time**, before the program runs. |
| **Ordinary / simple type** | A type that does *not* mention any runtime value. `int`, `List<int>`. Carries little information. |
| **Dependent type** | A type that **mentions a value**. E.g. `Vec n Int` — a vector whose length `n` is baked into the type. |
| **Refinement type** | A base type **plus a predicate** restricting which values are allowed. `{ v: Int \| v > 0 }` = "a positive int." |
| **Predicate** | A condition that is either true or false for a given value, e.g. `v > 0`, `0 <= i < len arr`. |
| **`Vec n a`** | The canonical dependent type: a vector (list) of `n` elements of type `a`, where `n` is part of the type. |
| **Index out of bounds** | Asking for element `i` of an array when `i` is too big or negative. The bug refinement types prevent. |
| **`head`** | "Give me the first element." Unsafe on an empty list — a dependent/refinement type can forbid that call. |
| **Compile-time error** | The compiler rejects the program. Good: the bug never ships. |
| **Runtime error** | The program crashes (or misbehaves) while running. The thing we are trying to eliminate. |
| **SMT solver** | An automated "logic engine" (e.g. Z3) that decides whether a predicate is always true. Refinement types lean on it. |
| **Proof** | A convincing argument the compiler can check that a claim always holds. Dependent types often require you to write these. |
| **Idris / Agda / Coq / Lean** | Languages with full dependent types. Coq and Lean double as *proof assistants*. |
| **Liquid Haskell / F\* / Dafny** | Tools with refinement types, where an SMT solver discharges the conditions automatically. |
| **Make illegal states unrepresentable** | A design slogan: encode rules in types so broken values cannot be constructed at all. |

---

## Core Concepts

### 1. Ordinary types throw away information

Think about the type `int`. It tells you "this is an integer." It does **not** tell you whether the value is positive, even, in range, or non-zero. So when you write a function:

```text
divide(a: int, b: int) -> int
```

the type system is perfectly happy to let someone call `divide(10, 0)`. The crash is not the type system's fault — the type `int` *includes* zero, and you asked for an `int`. The information "b must not be zero" lives only in your head (and maybe a comment, and maybe a runtime `if b == 0` check you remembered to write).

Same story with lists. The type `List<int>` covers the empty list and the billion-element list identically. So:

```text
first(xs: List<int>) -> int
```

is a function that *cannot keep its promise*. If `xs` is empty, there is no first element. Either it crashes, or it returns some fake value, or it forces the caller to handle an `Optional`. The type `List<int>` simply does not carry the fact "this list is non-empty."

**The core insight of this whole topic:** these bugs exist because the type is too *coarse*. It admits values it shouldn't. If we could make the type *finer* — exactly the positive ints, exactly the non-empty lists — the bugs would have nowhere to live.

### 2. Refinement types: a base type plus a condition

A **refinement type** is the simpler of the two ideas, so start here. You take a normal type and attach a predicate — a true/false condition. The notation, read aloud, is "values `v` of this base type *such that* the condition holds":

```text
{ v: Int | v > 0 }          -- positive integers
{ v: Int | v >= 0 }         -- non-negative integers (naturals)
{ v: Int | v /= 0 }         -- non-zero integers
{ s: String | length s > 0 } -- non-empty strings
```

Now rewrite `divide` with a refinement on the divisor:

```text
divide(a: Int, b: { v: Int | v /= 0 }) -> Int
```

The divisor's type **excludes zero**. The compiler will now reject any call where it cannot be sure `b` is non-zero. The "don't divide by zero" rule has moved out of your head and into the type. You did not write a runtime check; the *type* is the check.

The beautiful part: in tools like Liquid Haskell and F\*, you do **not** prove these conditions by hand. An **SMT solver** — an automated logic engine — figures out "is `b` always non-zero here?" for you. You write the refinement; the machine does the reasoning. That makes refinement types relatively *practical*.

### 3. Dependent types: a type that mentions a value

A **dependent type** goes further: the type itself contains an actual value. The textbook example is the length-indexed vector, written `Vec n a`:

- `Vec 0 Int` — a vector of **exactly zero** ints (the empty one).
- `Vec 3 Int` — a vector of **exactly three** ints.
- `Vec n Int` — a vector of `n` ints, where `n` is a length that may vary.

The number `n` is a *value*, and it is sitting *inside the type*. That is the defining move of dependent typing: **types can depend on values**. In ordinary languages there is a strict wall between "values" (run at runtime) and "types" (checked at compile time). Dependent types knock a door in that wall.

Why is this powerful? Because now functions can make precise promises in their signatures:

```text
append : Vec n a -> Vec m a -> Vec (n + m) a
```

Read it: "give me a vector of length `n` and a vector of length `m`, and I will give you back a vector of length **exactly `n + m`**." The compiler **checks** that the implementation actually produces a vector of that length. If you wrote `append` with an off-by-one bug, it would not compile.

And the showstopper:

```text
head : Vec (n + 1) a -> a
```

Read it: "`head` only accepts a vector whose length is `n + 1`" — i.e. *at least one element*. It is **impossible to call `head` on an empty vector**, because `Vec 0 a` does not match the shape `Vec (n + 1) a`. The empty-list crash is not handled at runtime; it is forbidden at compile time. There is no code path to test, because the broken program does not typecheck.

### 4. Why your everyday language doesn't do this

If this is so great, why isn't Java doing it? Three reasons, which the higher tiers explore in depth:

1. **Cost.** Dependent types can require you to *write proofs* by hand. That is slow, specialized work.
2. **Compile times and complexity.** Checking these types is expensive, and the type systems are intricate.
3. **Ergonomics.** The languages that do this well (Agda, Coq, Idris) are research-grade. The tooling and learning curve are steep.

So these tools live where the payoff justifies the cost: **verified crypto, compilers, operating-system kernels, avionics** — places where a single bug is catastrophic. For everyday CRUD apps, the trade is usually not worth it... *yet*. The trend is that pieces of this are slowly arriving in mainstream languages, which is why it is worth understanding now.

### 5. The two are a spectrum, not a binary

Refinement types and dependent types are two points on a gradient of "how much can a type say":

```text
ordinary types            refinement types            full dependent types
(int, List<T>)            ({v:Int | v>0})             (Vec n a, proofs)
        |                        |                            |
  says almost nothing     says "satisfies P",          says anything you can
                          SMT checks it for you         state — but you may
                                                        have to prove it by hand
        less expressive  ----------------------------->  more expressive
        less effort      <-----------------------------  more effort
```

**Refinement types are more automatable but less expressive** (the SMT solver does the work, but it can only handle conditions it understands). **Dependent types are maximally expressive but more effortful** (you can state anything, but you may have to prove it). That trade-off is the single most important thing to take from this page.

---

## Real-World Analogies

**The form field with a validation rule.** An ordinary type is a text box labeled "Age." A refinement type is a text box labeled "Age" *with a rule attached*: "must be a whole number between 0 and 150." The difference is that the refinement-type version *cannot* contain `-5` or `"banana"` — the rule is part of what the field *is*, not a separate check you run afterward. Crucially, with refinement types the rule is enforced *before submission* (at compile time), not after.

**A box stamped "EXACTLY 12 EGGS."** An ordinary "carton" type tells you it holds eggs. A dependent `Vec 12 Egg` carton has the count printed *on the box as part of its identity*. If a machine is supposed to combine a `Vec 6` carton and a `Vec 6` carton, the output box is stamped `Vec 12` — and an inspector (the compiler) verifies the count matches the stamp before the box leaves the factory. You can never accidentally ship a `Vec 11`.

**The bouncer who checks the *type* of ID, vs. the one who checks your *age*.** An ordinary type system is a bouncer who only checks "is this an ID?" — any ID gets you in, including one that says you're 12. A refinement type is a bouncer who checks "is this an ID *and* does it say 18+?" The condition is baked into the door policy. Nobody underage gets through, ever — not "usually," not "if we remember to check."

**A recipe that lists exact pan sizes.** "Pour into a pan" is an ordinary type. "Pour into a 9-inch pan" is dependent — the *value* (9 inches) is part of the instruction, and if you later "double the recipe," a dependent recipe automatically demands an 18-inch-equivalent pan and the compiler-cook refuses to proceed with the wrong pan.

---

## Mental Models

**1. The type is a promise; finer types are stronger promises.** Every type is a promise about a value. `int` promises "it's an integer" — weak. `{v: Int | v > 0}` promises "it's a *positive* integer" — stronger. `Vec n a` promises "it's a vector and here is its exact length" — stronger still. Dependent and refinement types are just *stronger promises that the compiler enforces*.

**2. Push the check left.** Picture a timeline: *write code → compile → ship → run → crash.* A runtime check catches a bug at the far right (when it runs, maybe in production). These types push the check all the way to the left — to compile time. The bug is caught once, for *all* possible inputs, before anyone runs the program. "Shift left" is the slogan.

**3. Make illegal states unrepresentable.** Don't write code that handles a bad state gracefully — make the bad state *impossible to construct*. You can't pass an empty vector to `head` because the type won't let you build the call. The bug isn't handled; it's *uninhabited*.

**4. The wall between values and types has a door.** In ordinary languages, values live at runtime and types live at compile time, and never the twain shall meet. Dependent typing's one big idea: a type can contain a value (`Vec 3` contains `3`). Once you accept that, everything else follows.

**5. Two dials: expressiveness and automation.** Turn the "expressiveness" dial up and you can state richer properties — but you turn the "automation" dial down and must prove more by hand. Refinement types sit at "moderate expressiveness, high automation (SMT)." Full dependent types sit at "maximal expressiveness, low automation (manual proofs)."

---

## Code Examples

These are deliberately small. The point is to *read* them and feel the idea, not to install a compiler.

### Example 1: Refinement type for a non-zero divisor (Liquid Haskell flavor)

```haskell
-- A refinement: the second argument's type forbids zero.
-- The {-@ ... @-} comment is the refinement annotation.

{-@ divide :: Int -> { v:Int | v /= 0 } -> Int @-}
divide :: Int -> Int -> Int
divide a b = a `div` b

-- This call is fine — 3 is provably non-zero:
ok = divide 10 3

-- This call is REJECTED at compile time — 0 violates the refinement:
bad = divide 10 0     -- ❌ Liquid type error: 0 /= 0 is false
```

You wrote no runtime `if`. The `{ v:Int | v /= 0 }` *is* the guard, checked by an SMT solver before the program runs.

### Example 2: A safe array index (refinement, conceptual)

```text
-- "i is a valid index into arr" expressed as a refinement:
get : (arr: Array a) -> (i: { v: Int | 0 <= v && v < length arr }) -> a
```

The index `i`'s type says it must be at least 0 and less than the array's length. A call with a possibly-out-of-range index simply will not typecheck. The classic "index out of bounds" crash is **gone by construction** — and so is the runtime bounds check the CPU would otherwise perform.

### Example 3: Length-indexed vectors (Idris flavor)

```idris
-- Vect n a : a vector of EXACTLY n elements of type a.
-- The length n is part of the type.

-- Joining two vectors: the result length is the SUM, stated in the type.
append : Vect n a -> Vect m a -> Vect (n + m) a
append []        ys = ys
append (x :: xs) ys = x :: append xs ys

-- head only accepts a NON-EMPTY vector: shape Vect (S k) a means "length is some k+1".
head : Vect (S k) a -> a
head (x :: xs) = x

-- These typecheck:
v3 : Vect 3 Int
v3 = [1, 2, 3]

firstElem : Int
firstElem = head v3          -- ✅ v3 has length 3, which is S 2

-- This does NOT typecheck — you literally cannot write it:
empty : Vect 0 Int
empty = []

oops = head empty            -- ❌ type error: Vect 0 Int doesn't match Vect (S k) a
```

Notice: there is **no runtime check** in `head` for emptiness. There doesn't need to be. The empty case can't reach it.

### Example 4: The same idea, peeking in TypeScript (a weak taste)

Mainstream languages can imitate a sliver of this. TypeScript *literal types* let a type be a specific value:

```typescript
// A literal type: this value must be exactly the number 200, not any number.
type HttpOk = 200;

function classify(status: 200 | 404 | 500): string {
  switch (status) {
    case 200: return "ok";
    case 404: return "not found";
    case 500: return "server error";
  }
}

classify(200);   // ✅
classify(201);   // ❌ Argument of type '201' is not assignable to '200 | 404 | 500'
```

This is a faint echo of refinement: the type `200 | 404 | 500` restricts which values are allowed, and the compiler enforces it. It's far weaker than a real refinement type (no arithmetic predicates, no SMT solver), but it shows the idea sneaking into everyday tools.

### Example 5: Rust const generics (a sliver of dependent typing)

```rust
// [T; N] is an array whose LENGTH N is part of its type.
// N is a value living in the type — a tiny piece of dependent typing.

fn first<const N: usize>(arr: [i32; N]) -> i32 {
    arr[0]   // still needs N >= 1 to be truly safe; Rust doesn't prove that here
}

let a: [i32; 3] = [10, 20, 30];   // type carries the length 3
let b: [i32; 5] = [1, 2, 3, 4, 5];
// a and b have DIFFERENT types because their lengths differ.
```

Rust's `[T; N]` puts a length *value* into the type, which is genuinely a fragment of dependent typing. Rust does not let you state and prove `N >= 1` the way Idris does — but the door is open.

---

## Pros & Cons

### Pros

| Benefit | Why it matters |
|---------|----------------|
| **Whole bug classes vanish** | Out-of-bounds, divide-by-zero, empty-list, null, off-by-one — made unrepresentable. |
| **Checked once, for all inputs** | Unlike a runtime guard or a test, a type-level property holds for *every* possible input, forever. |
| **Documentation that can't lie** | The signature `append : Vec n a -> Vec m a -> Vec (n+m) a` is a spec the compiler enforces. |
| **Fewer runtime checks** | Provably-safe indexing means the bounds check can sometimes be elided — correctness *and* speed. |
| **High-assurance possible** | Lets you build verified compilers, kernels, crypto where a bug is unacceptable. |

### Cons

| Cost | Why it hurts |
|------|--------------|
| **Proof burden (dependent)** | Full dependent types may require you to *write proofs* by hand — slow, specialized. |
| **Steep learning curve** | Idris/Agda/Coq/Lean are unfamiliar; the concepts are deep. |
| **Compile times** | Type checking these properties can be slow. |
| **Ergonomics** | Expressing "obvious" facts can require fighting the type checker. |
| **Limited automation (dependent)** | The SMT solver in refinement tools can only handle predicates it understands; outside that, you're on your own. |
| **Not mainstream** | Small ecosystems, fewer libraries, fewer engineers who know them. |

---

## Use Cases

- **Eliminating array-bounds and off-by-one bugs** by making indices carry "I'm in range" in their type. (Liquid Haskell does this.)
- **Forbidding division by zero / null / empty-collection access** at compile time.
- **Verified cryptography.** Projects like HACL\* (used in Firefox, Linux) prove their crypto correct in F\*.
- **Verified compilers.** CompCert is a C compiler proven (in Coq) to produce machine code that matches the source's meaning.
- **Verified OS kernels.** seL4 is a microkernel with a machine-checked proof of correctness.
- **Cloud-scale assurance.** AWS uses Dafny and F\* to verify critical components (e.g. cryptographic and authorization logic).
- **Formalized mathematics.** Lean's `mathlib` is a vast library of machine-checked math proofs.
- **Safer protocol and parser code**, where lengths and bounds matter and bugs become security holes.

You are unlikely to reach for these on a typical web backend — and that's fine. The point of knowing them is to recognize *when the stakes justify the cost*.

---

## Coding Patterns

You won't write these daily yet, but recognizing them matters.

**1. Length-indexed collections.** Carry the size in the type (`Vec n a`, `[T; N]`) so functions can promise size relationships and forbid empty access.

**2. Refine at the boundary.** When data enters your program (parsing, input), refine it once into a precise type (`{v: Int | v > 0}`), then the rest of the code is guarded for free.

**3. Smart constructors.** Make the only way to build a refined value go through a function that establishes the predicate — so an invalid value cannot exist.

**4. Make illegal states unrepresentable.** Before adding a runtime check, ask: can I change the type so the bad state can't be built at all?

**5. Lean on the solver, not on yourself (refinement).** With Liquid Haskell / F\* / Dafny, state the property and let the SMT solver prove it. Reserve hand-written proofs for when the solver can't.

---

## Best Practices

- **Start with refinement, not full dependent types.** Refinement types give you most of the everyday safety (bounds, non-zero, non-empty) with the SMT solver doing the hard work. Save dependent types for when you truly need them.
- **Refine inputs as early as possible.** The closer to the system boundary you establish a property, the more code downstream gets it for free.
- **Keep predicates in the solver's "easy" fragment.** Linear arithmetic and equalities are SMT-friendly. Nonlinear or quantified predicates may need help.
- **Treat a type-level property as a spec.** When you write `Vec (n + m)`, you've written a contract — make sure it's the contract you actually want.
- **Don't over-reach.** Encoding *everything* in types is a research project. Encode the properties whose bugs would actually hurt.
- **Read the error.** Dependent/refinement type errors are wordy but precise — they usually tell you the exact predicate that couldn't be proven.

---

## Edge Cases & Pitfalls

- **A refinement only helps if it reaches the call site.** If you launder a value through an unrefined `Int`, you lose the guarantee. Keep the refined type as long as possible.
- **The SMT solver can time out or give up.** For predicates outside its comfort zone (nonlinear arithmetic, heavy quantifiers), it may fail to prove a true fact. That's a limitation, not a bug in your code.
- **`Vec 0` vs `Vec (n+1)` is the whole trick.** The reason `head` is safe is that the empty vector's type literally cannot match the non-empty shape. If you blur the two, the safety evaporates.
- **Termination matters for proofs (preview).** In proof assistants, a function that loops forever can "prove" false things. Higher tiers cover *totality checking* — why these languages insist your functions provably terminate.
- **More precise types can make code harder to write.** Sometimes you must convince the checker of a fact that's "obvious" to you. That friction is the cost side of the trade.
- **Performance of the *checker*, not the program.** The runtime can be fast (checks elided); it's the *compile-time* proving that's expensive.
- **These aren't magic.** A wrong specification, precisely enforced, is still wrong. The compiler proves your code matches your *types*, not that your types match your *intent*.

---

## Summary

Ordinary types are coarse: `int` includes zero, `List<T>` includes the empty list, so bugs like divide-by-zero and empty-list access slip through and become runtime crashes. **Refinement types** add a predicate to a base type (`{v: Int | v > 0}`), and an **SMT solver** checks it automatically — practical, moderately expressive. **Dependent types** let a type mention a *value* (`Vec n a`, a length-indexed vector), so functions can promise exact size relationships (`append : Vec n a -> Vec m a -> Vec (n+m) a`) and forbid bad calls (`head` can't touch an empty vector) — maximally expressive, but you may have to write proofs by hand. The trade-off — refinement is *automatable but limited*, dependent is *expressive but effortful* — is the heart of the topic. These tools power verified systems (CompCert, seL4, HACL\*) and live mostly in research-grade languages (Idris, Agda, Coq, Lean, F\*), with tastes leaking into the mainstream (TypeScript literal types, Rust const generics). The unifying idea: **move correctness out of runtime checks and into the types, making illegal states unrepresentable.**

---

## Further Reading

- *Type-Driven Development with Idris* — Edwin Brady (the gentlest serious introduction to dependent types).
- *Programming Language Foundations in Agda* (PLFA) — free online, builds the ideas from scratch.
- The Liquid Haskell tutorial (online) — refinement types you can run today.
- *Software Foundations* (Pierce et al.) — Coq-based, the classic on proofs-as-programs.
- The F\* tutorial and the HACL\* project pages — refinement types in production crypto.
- *Certified Programming with Dependent Types* (CPDT) — Adam Chlipala, for when you're ready to go deep.
