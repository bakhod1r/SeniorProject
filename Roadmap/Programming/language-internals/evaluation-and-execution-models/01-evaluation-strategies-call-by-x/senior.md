# Evaluation Strategies (call-by-x) — Senior Level

> **Topic:** [Evaluation Strategies (call-by-x)](README.md)
> **Focus:** The unifying theory: parameter passing *is* a choice of reduction order in the lambda calculus. Normal-order vs applicative-order, the Church-Rosser guarantees, and the modern strategy the textbooks miss — call-by-move (C++ rvalue references, Rust ownership transfer).

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
13. [Tricky Points](#tricky-points)
14. [Test Yourself](#test-yourself)
15. [Cheat Sheet](#cheat-sheet)
16. [Summary](#summary)
17. [Further Reading](#further-reading)

---

## Introduction

> Focus: **Why is "call-by-x" a deep idea and not just a language quirk?** Because it is, precisely, the choice of *reduction order* in the lambda calculus — and that choice is what determines whether your program terminates.

A senior engineer should be able to collapse the whole zoo of strategies into a small number of orthogonal decisions and connect them to the theory that explains *why* they behave as they do. The junior page gave you *what* a parameter aliases; the middle page gave you *when* it's evaluated. This page gives you the **single underlying framework**: evaluation strategy is a choice of **reduction order** for function application, and the lambda calculus tells us exactly what each choice buys and costs.

The two foundational orders are **applicative order** (reduce the argument to a value *before* substituting it — this is call-by-value) and **normal order** (substitute the *unreduced* argument and reduce the body first — this is call-by-name). The **Church-Rosser theorem** guarantees that *if* a normal form exists, normal-order reduction *will* find it; applicative order may diverge on the very same term. That is the rigorous statement of "call-by-name terminates where call-by-value loops." Call-by-need is the graph-reduction optimization of normal order that shares subterms to avoid recomputation.

Then there is the strategy the classic taxonomy predates: **call-by-move**. Modern systems languages added a way to pass an argument that *transfers ownership* of its resources — C++ rvalue references and `std::move`, Rust's move-by-default. It is neither copy (too expensive) nor shared reference (aliasing hazard); it is "you take it, I no longer have it." Treating move as a first-class member of the call-by-x family is what separates a 2010s-era understanding from a 1970s one.

In one sentence: **call-by-value is applicative order, call-by-name is normal order, call-by-need is shared normal order, and call-by-move is a 21st-century strategy that passes ownership instead of a copy or an alias.** Hold those four mappings and you can derive the rest.

> 🎓 **Why this matters at the senior level:** You design APIs and reason about correctness and performance simultaneously. "Should this take `T`, `const T&`, `T&&`, or `&mut T`?" is a daily question whose right answer comes from understanding copies vs aliasing vs ownership-transfer vs thunk-allocation. And when you debug "this terminates in test but hangs in prod," the reduction-order lens is often the one that explains it.

This page covers the lambda-calculus grounding (normal vs applicative order, Church-Rosser, call-by-need as graph reduction), move semantics as call-by-move (C++ and Rust), how `&`/`ref`/`out`/`*` fake reference across languages, and the performance model (copy vs indirection vs thunk allocation vs move).

---

## Prerequisites

What you should know before reading this:

- **Required:** Call-by-value/reference/sharing (junior) and strict/non-strict, call-by-name/need, thunks (middle).
- **Required:** Basic lambda-calculus notation: `λx. body`, application, and substitution `[x := arg]`.
- **Required:** What "a value" vs "an expression" means, and what divergence (⊥) is.
- **Helpful but not required:** Familiarity with C++ value categories (lvalue/rvalue) or Rust ownership.

You do **not** need to know:

- Denotational semantics or domain theory beyond the intuition of ⊥.
- The full operational-semantics rules; we'll use them informally.

---

## Glossary

| Term | Definition |
|------|-----------|
| **Redex** | A *reducible expression*: an application `(λx. body) arg` ready to be β-reduced. |
| **β-reduction** | Substituting the argument for the bound variable: `(λx. body) arg → body[x := arg]`. |
| **Normal form** | An expression with no remaining redexes — fully evaluated. |
| **Applicative order** | Reduce arguments to normal form **first**, then apply. The reduction-order name for **call-by-value**. |
| **Normal order** | Reduce the **leftmost-outermost** redex first — substitute the *unreduced* argument. The reduction-order name for **call-by-name**. |
| **Church-Rosser (confluence)** | If a term reduces to two different terms, both can be further reduced to a common term. Implies normal form is **unique** if it exists. |
| **Standardization theorem** | Normal-order reduction reaches the normal form whenever one exists. The basis of "call-by-name is maximally terminating." |
| **Graph reduction** | Implementing reduction over a shared graph so a duplicated subterm is reduced once. The basis of **call-by-need**. |
| **Call-by-move** | Passing an argument by transferring ownership of its resources, leaving the source in a valid-but-moved-from (or invalid) state. C++ `T&&` + `std::move`; Rust move-by-default. |
| **Rvalue / lvalue** | An rvalue is a temporary/expiring value safe to plunder; an lvalue names a persistent object. C++ overloads on this distinction to enable moves. |
| **Affine / linear type** | A type usable at most once (affine) or exactly once (linear). Rust's ownership is affine; it's what makes move-by-default sound. |
| **Strictness analysis** | Compiler analysis (in lazy languages) proving an argument is always needed, so it can be evaluated eagerly without changing semantics — recovering call-by-value's efficiency. |

---

## Core Concepts

### 1. Parameter Passing IS Reduction Order

In the pure lambda calculus there are no side effects and no references — only substitution. The only freedom is **which redex you reduce next**, and that single freedom *is* the evaluation strategy:

- **Applicative order:** given `(λx. body) arg`, first reduce `arg` to a value `v`, then reduce `body[x := v]`. Arguments are values before substitution → **call-by-value**.
- **Normal order:** reduce the outer application *first*, substituting the *unreduced* `arg` into `body`, and only reduce occurrences of `arg` as the body demands them → **call-by-name**.

Everything else (sharing, references, copy-restore) is what you get when you add *mutable state* and *memory* to this skeleton. The reduction-order skeleton is the part the theory pins down exactly.

### 2. Church-Rosser and Why Normal Order Terminates More

The **Church-Rosser theorem** (confluence) says reduction is *deterministic in its result*: a term has **at most one** normal form, regardless of the order you reduce. The companion **standardization theorem** says **normal-order reduction will find that normal form if it exists.** Applicative order has no such guarantee.

The canonical witness is:

```text
(λx. y) ((λz. z z) (λz. z z))
```

The argument `(λz. z z)(λz. z z)` (call it Ω) reduces to itself forever.
- **Applicative order** insists on reducing Ω first → never terminates.
- **Normal order** substitutes Ω into `λx. y`, which *discards* `x`, yielding `y` immediately.

This is the rigorous, side-effect-free version of the middle page's `const 42 undefined`. Termination is a property of *order*, and normal order is the maximally-terminating choice. The price is that normal order may **duplicate** the argument (reduce it multiple times), which is exactly what call-by-need fixes.

### 3. Call-by-Need as Graph Reduction

Normal order's flaw: if the body uses `x` three times, the unreduced argument is substituted three times and reduced three times. **Call-by-need** implements normal order over a **shared graph**: all occurrences of `x` point at *one* node; the first demand reduces it in place; later demands read the reduced node. You get normal order's termination behavior with applicative order's no-recomputation efficiency — paid for with the bookkeeping of indirection nodes and (in practice) space leaks. This is the implementation model behind Haskell's STG machine and lazy graph reduction.

### 4. Strictness Analysis: Reclaiming Eagerness

Pure laziness is expensive (a thunk per binding). Lazy compilers run **strictness analysis**: if they can *prove* an argument is always evaluated (e.g. `f x = x + 1` definitely forces `x`), they compile it as call-by-value — no thunk, often in a register. The semantics are unchanged because a *needed* argument's evaluation order is observationally identical whether eager or deferred. This is why "Haskell is slow because lazy" is too glib: GHC eagerly evaluates strict positions and only pays for laziness where it's actually exploited.

### 5. Call-by-Move: The Modern Strategy

The classic taxonomy (value/reference/name/need/copy-restore) was settled before resource-owning value types were mainstream. Modern systems languages add **call-by-move**: pass an object by **transferring ownership of its internals** (heap buffer, file handle, lock) rather than copying them or aliasing them.

- A `std::vector<int>` of a million elements passed **by value** copies a million ints. Passed **by move**, only the three-word header (pointer, size, capacity) is transferred; the source is left empty. Same surface as call-by-value (a fresh object in the callee, no aliasing), but with the cost of a reference.
- It is *not* call-by-reference: there is no aliasing, no shared mutable state, and the source can no longer be used (Rust enforces this statically; C++ leaves it "valid but unspecified").

Move semantics is best understood as **call-by-value where the "value" being copied is cheap to copy because it's just a handle, and the source's handle is nulled to preserve the single-owner invariant.** It threads the needle between value's safety and reference's cheapness.

### 6. The Full Grid

| Strategy | Evaluation (when) | Aliasing | Mutates caller? | Cost model |
|----------|-------------------|----------|------------------|-----------|
| Call-by-value | strict | none (copy) | no | copy of whole value |
| Call-by-reference | strict | full alias | yes (rebind + mutate) | one pointer, indirection |
| Call-by-sharing | strict | shares object | mutate yes, rebind no | one reference copy |
| Call-by-copy-restore | strict | none during call | yes (at return) | copy in + copy out |
| Call-by-name | non-strict | (re-eval each use) | via expr side effects | thunk + N evaluations |
| Call-by-need | non-strict | shared thunk | via expr side effects | thunk + 1 evaluation + memo |
| **Call-by-move** | strict | none (ownership moved) | source invalidated | one handle transfer |

Reading this grid fluently — and knowing which cell a given language's `f(x)` lands in — is the senior-level competency.

---

## Real-World Analogies

**Applicative vs normal order — packing for a trip vs packing on demand.** Applicative order packs *every* item the itinerary lists before leaving, even items for a cancelled leg (and if one item is impossible to obtain, you never leave). Normal order leaves immediately and acquires each item only when that leg of the trip actually starts — so a cancelled leg's impossible item never blocks you.

**Call-by-need — graph reduction as a shared shopping list.** Three recipes all call for "stock." Normal order makes stock three times. Call-by-need makes one pot of stock the first time any recipe needs it and ladles from it thereafter — one node, shared.

**Call-by-move — handing over the deed to a house, not a photo of it.** Call-by-value would build an identical house (copy everything). Call-by-reference would give you a key to *my* house (we both can enter; aliasing). Call-by-move signs the deed over: now it's *your* house, the locks are yours, and I no longer have a key — there's exactly one owner, and nothing was rebuilt.

**Strictness analysis — the chef who notices an ingredient is always used.** If every version of the dish uses garlic, the chef preps garlic up front instead of "lazily" each time — same result, less ceremony.

---

## Mental Models

**Model 1: "Strategy = reduction order + memory model."** The pure-functional skeleton is reduction order (applicative/normal/need). Add memory and you get the reference/sharing/copy-restore/move distinctions. Two layers, cleanly separable.

**Model 2: "Normal order is the upper bound on termination; need is its efficient implementation; value is the eager special case justified by strictness analysis."** One spectrum, three points.

**Model 3: "Move is value-with-a-nulled-source."** Don't mystify it. It's call-by-value over a handle, plus the discipline that the source's handle is emptied to keep one owner.

**Model 4: "Aliasing is the real axis of danger."** Reference and sharing alias (hazard). Value, copy-restore, and move do not (safe). Name/need alias the *thunk*. When debugging "spooky mutation," ask "what aliases what?" first.

**Model 5: "The cost is copy vs indirection vs thunk vs handle."** Four price tags: copy a whole value, follow a pointer, allocate-and-force a thunk, transfer a handle. API design is choosing the right price for the call's frequency and the object's size.

---

## Code Examples

### Example 1: Normal vs Applicative Order, Mechanically

```text
Term:  (λx. λy. x) A B            -- returns A, ignores B
                                  -- let B = Ω, a diverging term

Applicative order:  evaluate B (=Ω) first → loops forever.   NON-TERMINATING
Normal order:       (λx. λy. x) A B
                    → (λy. A) B           [x := A]
                    → A                   [y := B, but y unused → B never reduced]
                                          TERMINATES with A
```

This is Church-Rosser/standardization in action: a normal form (`A`) exists, and normal order finds it; applicative order does not.

### Example 2: C++ — Value, Reference, and Move Side by Side

```cpp
void byValue(std::vector<int> v);          // COPIES the whole vector (deep)
void byConstRef(const std::vector<int>& v);// aliases, read-only, no copy
void byRef(std::vector<int>& v);           // aliases, can mutate caller's vector
void byMove(std::vector<int>&& v);         // takes OWNERSHIP; source emptied

std::vector<int> data(1'000'000);

byValue(data);            // 1M-element deep copy; 'data' still usable
byConstRef(data);         // zero copy; 'data' unchanged, read-only inside
byRef(data);              // zero copy; callee may modify 'data'
byMove(std::move(data));  // O(1) handle transfer; 'data' now valid-but-empty
```

`std::move` is just a cast to `T&&` — it *enables* the move overload; the actual stealing happens in the move constructor (swap the pointer, null the source).

### Example 3: Rust — Move by Default, Borrow to Avoid It

```rust
fn consume(v: Vec<i32>) { /* owns v; freed at end */ }
fn borrow(v: &Vec<i32>) -> usize { v.len() }       // shared borrow, no move
fn borrow_mut(v: &mut Vec<i32>) { v.push(1); }      // exclusive borrow, can mutate

let data = vec![1, 2, 3];
let n = borrow(&data);      // data still owned by caller
consume(data);              // OWNERSHIP MOVES into consume
// println!("{:?}", data);  // COMPILE ERROR: use after move — affine types catch it
```

Rust makes call-by-move the *default* and enforces single ownership at compile time (affine typing). The very confusion that plagues call-by-sharing — "did I just give away mutation rights?" — is turned into a type error.

### Example 4: Faking Call-by-Reference Across Languages

```c
void out_param(int* result) { *result = 42; }   // C: pass &x, deref *p
```
```cpp
void out_param(int& result)  { result = 42; }    // C++: true reference
```
```csharp
void OutParam(out int result) { result = 42; }   // C#: 'out' must be assigned
void RefParam(ref int x)      { x += 1; }         // C#: 'ref' in/out
```
```go
func outParam(result *int) { *result = 42 }      // Go: pointer, like C
```
```python
# Python: no reference params at all — return, or pass a mutable container
def out_param(box): box[0] = 42                  # mutate a shared object
```

The pattern is universal: where the language lacks built-in reference passing, you **pass a pointer/box by value and mutate through it**. Pointers are how every "by reference" effect is reconstructed on top of call-by-value.

### Example 5: The Performance Triangle

```text
Pass a 1MB struct...

call-by-value:   memcpy 1MB on every call            ← time ∝ size
const-reference: copy one 8-byte pointer, indirect   ← O(1) + cache misses on deref
call-by-move:    copy one handle, null the source    ← O(1), no aliasing
call-by-name:    allocate a thunk, re-run each use   ← alloc + N× the arg's cost
call-by-need:    allocate a thunk, run once, memo    ← alloc + 1× the arg's cost
```

---

## Pros & Cons

### Reduction-order choice (value/name/need)

**Pros of normal/need:** maximally terminating; enables infinite structures; skips unneeded work.
**Cons:** harder to reason about *when* effects fire; thunk allocation; space leaks; worse cache behavior than tight eager loops.
**Pros of value (applicative):** predictable, cache-friendly, no thunk overhead.
**Cons:** can diverge on a discarded argument; does unneeded work.

### Call-by-move

**Pros**
- Value semantics (no aliasing, single owner) at reference cost.
- Eliminates defensive deep copies; makes resource transfer explicit and cheap.
- In Rust, statically prevents use-after-move and double-free.

**Cons**
- "Moved-from" state is a footgun in C++ (valid but unspecified — easy to misuse).
- Adds cognitive load (value categories, `&&`, ownership) and API surface (overload sets).
- Cannot share: if two callers need the object, move is the wrong tool.

---

## Use Cases

- **Call-by-value** for small, copy-cheap data and when you want guaranteed isolation.
- **Const-reference / shared borrow** for large read-only inputs — the workhorse of high-performance APIs.
- **Call-by-move** for sink functions that *take ownership*: pushing into a container, handing a buffer to an I/O layer, transferring a lock or socket. `std::vector::push_back(T&&)`, Rust `String::from`, builder patterns that consume `self`.
- **Call-by-need / laziness** for streams, demand-driven pipelines, and discarding unneeded subcomputations.
- **Strictness-analyzed eager evaluation** as the compiler's automatic optimization inside lazy languages.

---

## Coding Patterns

**Pattern: Take by value, then move (the "sink" idiom).** In C++ a constructor that stores a parameter should take it by value and `std::move` it in — one overload handles both lvalues (copy) and rvalues (move) optimally.

```cpp
struct Widget {
    std::string name_;
    explicit Widget(std::string name) : name_(std::move(name)) {}  // copy-or-move, then steal
};
```

**Pattern: Consume `self` to express a one-shot transform (Rust builders).**

```rust
impl Builder {
    fn with_timeout(mut self, t: Duration) -> Self { self.timeout = t; self }  // moves self through
}
```

**Pattern: `const T&` for read, `T&&`/`&mut` for transfer, `T` for small.** A simple decision rule that captures 90% of API choices.

**Pattern: Thunk to defer, memoize to need.** Reuse the middle page's lazy wrapper when an argument is expensive and conditionally used.

---

## Best Practices

1. **Choose the cell deliberately.** For each parameter, decide: copy (value), borrow-read (const-ref/`&`), borrow-write (ref/`&mut`), take ownership (move), or defer (thunk). Don't default to "whatever the language makes easy."
2. **Prefer move over copy for resource-owning sinks**, and prefer `const&`/`&` for large read-only inputs.
3. **In C++, never read a moved-from object** beyond reassigning or destroying it. Treat `std::move(x)` as "x is dead now."
4. **Lean on Rust's borrow checker** rather than fighting it; it encodes the aliasing-vs-ownership distinction you'd otherwise track by hand.
5. **In lazy languages, force strict accumulators** and profile thunk buildup; let strictness analysis do the rest.
6. **Reason about termination via reduction order** when debugging "hangs only when the arg is computed" — the discarded-but-evaluated argument is the classic culprit.

---

## Edge Cases & Pitfalls

**Pitfall 1: Use-after-move in C++.** `auto y = std::move(x); use(x);` compiles and "works" but `x` is in an unspecified state. Rust rejects this at compile time; C++ won't.

**Pitfall 2: Applicative-order divergence on an unused argument.** A strict language evaluating a discarded but diverging argument hangs — the lambda-calculus Ω example, in production.

**Pitfall 3: Move that's secretly a copy.** A type without a move constructor (or with members that don't move) falls back to copy. `std::move` *requests* a move; it doesn't *guarantee* one.

**Pitfall 4: Self-move / move-assign aliasing.** `v = std::move(v)` or moving an element of a container into the same container can corrupt state if move-assignment isn't self-safe.

**Pitfall 5: Strictness analysis can't help across an effectful boundary.** If forcing an argument has side effects, the compiler can't reorder/eager it freely; laziness's observable semantics are preserved at the cost of the optimization.

**Pitfall 6: `const T&` dangling on a temporary.** Binding a const-reference parameter to a temporary is fine *during* the call, but storing that reference outlives the temporary and dangles — a reference is not ownership.

---

## Tricky Points

**Why call-by-need ≠ call-by-name observationally (with effects).** Without side effects, name and need give identical *values* (Church-Rosser). *With* side effects or *with performance as the observable*, they differ: name re-runs effects/computation per use; need runs once. The pure theory says "same answer"; the engineering reality says "wildly different cost and effect count."

**Move is not in the classic lambda-calculus taxonomy — and that's the point.** The lambda calculus has no notion of a resource that can be transferred and then unusable. Move semantics arises from **linear/affine typing** layered on call-by-value. It's an answer to a question (cheap, alias-free transfer of owned resources) the 1960s strategies never asked.

**`std::move` does not move.** It's a `static_cast<T&&>` — a *compile-time* relabeling that makes overload resolution pick the move constructor/assignment. The actual stealing is in those special members. Beginners think `std::move` "does" the move; it only *permits* one.

**RVO/NRVO can beat both copy and move.** Return-value optimization constructs the result directly in the caller's slot, so a returned local often costs *nothing* — no copy *and* no move. Prefer returning by value and letting the compiler elide.

**Out-parameters are a poor substitute for multiple return values.** Languages with tuples/destructuring (Go, Rust, Python) should return rather than mutate `out` params; the `ref`/`out` machinery is a workaround for languages that historically lacked cheap multiple returns.

---

## Test Yourself

1. State the reduction-order names for call-by-value and call-by-name, and which one the Church-Rosser/standardization results favor for termination.
2. Why does call-by-need exist if call-by-name already gives the right *value*?
3. Explain call-by-move in terms of call-by-value. Why is it not call-by-reference?
4. What does `std::move` actually do?
5. How is "pass by reference" reconstructed in C, Go, and Python?
6. What is strictness analysis and why doesn't it change program meaning?

<details>
<summary>Answers</summary>

1. Call-by-value = **applicative order**; call-by-name = **normal order**. Normal order is favored: the standardization theorem says it reaches the (unique, by Church-Rosser) normal form whenever one exists; applicative order can diverge on the same term.
2. Call-by-name re-evaluates the argument on **every** use (duplicated work, duplicated effects). Call-by-need implements normal order via **shared graph reduction** so each argument is reduced **at most once** — same value, far less work.
3. Call-by-move is call-by-value over a **handle**, with the source's handle **nulled** to preserve single ownership. It's not call-by-reference because there is **no aliasing** and the source becomes unusable — there's exactly one owner, nothing shared.
4. Nothing at runtime by itself — it's a `static_cast` to an rvalue reference that **enables** move overloads. The actual transfer happens in the move constructor/assignment operator.
5. By **passing a pointer/box by value and mutating through it**: C `int* / *p`, Go `*int / *p`, Python a mutable container (`box[0] = ...`). C++ and C# have true reference (`&`, `ref`/`out`).
6. A compiler analysis (in lazy languages) proving an argument is **always forced**, letting it be evaluated eagerly without a thunk. Meaning is unchanged because a *needed* argument's evaluation is observationally the same whether eager or deferred.

</details>

---

## Cheat Sheet

```text
REDUCTION ORDER ↔ STRATEGY
  applicative order (args→values first)  = call-by-value
  normal order (outermost first)         = call-by-name      ← maximally terminating
  shared normal order (graph reduction)  = call-by-need        (laziness)

CHURCH-ROSSER: ≤1 normal form, order-independent RESULT
STANDARDIZATION: normal order FINDS the normal form if it exists
  → (λx.λy.x) A Ω : normal order = A ; applicative = ⊥ (loops)

CALL-BY-MOVE (modern): value-semantics at reference-cost
  C++  T&& + std::move (cast, enables move ctor; source = valid-but-unspecified)
  Rust move-by-default, affine types → use-after-move is a COMPILE ERROR
  NOT reference: no aliasing, single owner, source invalidated

FAKING REFERENCE:  pass pointer/box BY VALUE, mutate through it
  C/Go: *p   C++: T&   C#: ref/out   Python: box[0]=...

COST: copy(size) | indirection(ptr+cache) | thunk(alloc+N or 1) | move(handle)
STRICTNESS ANALYSIS: prove arg always needed → compile lazy as eager (free)
RVO/NRVO can beat BOTH copy and move → prefer return-by-value
```

---

## Summary

- Evaluation strategy is, at heart, a **choice of reduction order**: **applicative order = call-by-value**, **normal order = call-by-name**, **shared normal order (graph reduction) = call-by-need**.
- **Church-Rosser** guarantees a unique normal form; **standardization** guarantees normal order finds it — the rigorous reason call-by-name terminates where call-by-value diverges.
- **Call-by-need** is normal order made efficient by sharing; **strictness analysis** lets lazy compilers recover eager efficiency where an argument is provably needed.
- **Call-by-move** is the modern strategy outside the classic taxonomy: value semantics (no aliasing, single owner) at reference cost, built on **affine/linear typing** (Rust enforces it; C++ leaves a moved-from hazard).
- `std::move` is a **cast that enables** moves, not a move itself; **RVO/NRVO** can beat both copy and move.
- Every "pass by reference" is reconstructible by **passing a pointer/box by value and mutating through it**.
- API design reduces to choosing the right cost: **copy vs indirection vs thunk vs handle.**

---

## Further Reading

- Plotkin, "Call-by-name, call-by-value and the λ-calculus" — the foundational paper relating the two orders.
- Barendregt, *The Lambda Calculus* — Church-Rosser, standardization, normal-order results.
- Wadsworth's thesis / Peyton Jones, *The Implementation of Functional Programming Languages* — graph reduction and call-by-need.
- The C++ standard's value-categories and move-semantics sections; the Rust ownership/borrowing chapters of *The Rust Programming Language*.
- The `professional.md` page for production performance, ABI/calling-convention reality, and API design tradeoffs.
