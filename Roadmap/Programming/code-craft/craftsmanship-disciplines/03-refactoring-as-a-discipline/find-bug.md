# Refactoring as a Discipline — Find the Bug

> **Category:** [Craftsmanship Disciplines](../README.md) — refactoring as a continuous, behavior-preserving habit done under passing tests, not a big-bang rewrite.

12 snippets where a so-called "refactoring" **silently changed behavior** — the cardinal sin. In each, the author believed they were doing a behavior-preserving cleanup. They weren't. Spot the behavior change, then expand the fix and the lesson.

> **The theme:** a refactoring that changes external behavior is not a refactoring — it's a bug. Every one of these would have been caught by tests run after the change. The discipline (refactor on green, run tests after each small step) is what these all skip.

---

## Table of Contents

1. [Bug 1: Extract Function Changed Variable Scope](#bug-1-extract-function-changed-variable-scope)
2. [Bug 2: Refactor With No Test](#bug-2-refactor-with-no-test)
3. [Bug 3: Rename Changed a Serialized Key](#bug-3-rename-changed-a-serialized-key)
4. [Bug 4: "Simplified" Boolean Flipped a Case](#bug-4-simplified-boolean-flipped-a-case)
5. [Bug 5: Guard-Clause Inversion Changed Behavior](#bug-5-guard-clause-inversion-changed-behavior)
6. [Bug 6: Fixing a Bug During a "Characterization" Pass](#bug-6-fixing-a-bug-during-a-characterization-pass)
7. [Bug 7: Extract Method Lost Short-Circuit Side Effects](#bug-7-extract-method-lost-short-circuit-side-effects)
8. [Bug 8: Inlining Changed Evaluation Count](#bug-8-inlining-changed-evaluation-count)
9. [Bug 9: Replace Loop with Stream Changed Float Order](#bug-9-replace-loop-with-stream-changed-float-order)
10. [Bug 10: Two Hats at Once Hid a Regression](#bug-10-two-hats-at-once-hid-a-regression)
11. [Bug 11: Extracted Constant Was Wrong](#bug-11-extracted-constant-was-wrong)
12. [Bug 12: Long-Lived "Refactor" Branch Diverged](#bug-12-long-lived-refactor-branch-diverged)
13. [Practice Tips](#practice-tips)

---

## Bug 1: Extract Function Changed Variable Scope

```python
# Before
def total(orders):
    running = 0
    for o in orders:
        running += o.amount
    return running

# "Refactored" — extracted the loop body
def add_amount(o):
    running += o.amount       # BUG: `running` is a new local; nothing accumulates

def total(orders):
    running = 0
    for o in orders:
        add_amount(o)
    return running            # always returns 0
```

**Symptoms:** `total` returns 0 for any non-empty input.

<details><summary>Find the bug</summary>

The extraction captured `running` by reference in the author's head, but Python binds `running` inside `add_amount` as a *new local*. The outer `running` never changes. The extract changed the variable's scope, so it changed behavior.

</details>

### Fix

```python
def amount_of(o):
    return o.amount          # extract a pure value, return it

def total(orders):
    return sum(amount_of(o) for o in orders)
```

### Lesson

When you Extract Function, accumulator variables must be **passed in and returned**, not assumed shared. This is the #1 reason to use the IDE's *automated* Extract Method — it computes the parameters and return value correctly. Hand-extraction silently changes scope.

---

## Bug 2: Refactor With No Test

```java
// "Refactored" a tax calc, no tests in the module. Looks equivalent. Shipped.
// Before:  return price + price * rate;
// After:   return price * (1 + rate);
double withTax(double price, double rate) {
    return price * (1 + rate);
}
```

**Symptoms:** For most inputs, identical. But there were *no tests*, so nobody verified the edge case where `price` is `NaN`/`Infinity` or where intermediate overflow differed — and a downstream report that depended on the exact float bit pattern drifted.

<details><summary>Find the bug</summary>

The algebra is "equivalent" for real numbers but *floating point is not real numbers*: `price + price*rate` and `price*(1+rate)` can produce different last-bit results. With **no test pinning the original output**, this "obviously safe" refactor was a behavior change nobody could see.

</details>

### Fix

Write a characterization test first that pins the original's output across representative inputs, *then* refactor and confirm green. If the values differ, the "refactor" isn't behavior-preserving — keep the original or accept the change explicitly.

### Lesson

**No tests, no refactoring.** "It's obviously equivalent" is exactly the belief that ships silent behavior changes. The test is the proof; without it you're guessing.

---

## Bug 3: Rename Changed a Serialized Key

```java
// IDE "Rename refactoring": userId → userIdentifier. Compiles, unit tests pass.
class Event {
    String userIdentifier;   // was: userId  — but this is serialized to JSON!
}
// Wire payload silently changed from {"userId": ...} to {"userIdentifier": ...}
```

**Symptoms:** External consumers reading `userId` from the JSON now get `null`. Integrations break in production though every test was green.

<details><summary>Find the bug</summary>

The field is part of an *external contract* (the JSON wire format). Renaming it changed observable behavior outside the program. The IDE rename is behavior-preserving only for code it can see — it can't see consumers parsing JSON keys.

</details>

### Fix

```java
class Event {
    @JsonProperty("userId")          // keep the wire name stable
    String userIdentifier;
}
```
Or treat it as a real behavior change: version the schema, add a compat field, migrate consumers.

### Lesson

A rename that crosses a **serialization, persistence, reflection, or DI boundary** is *not* a pure refactoring. Pin the external contract (annotation/test); the moment a name leaves the codebase, it's behavior.

---

## Bug 4: "Simplified" Boolean Flipped a Case

```go
// Before
func canAccess(u *User) bool {
    if u == nil { return false }
    if !u.Active { return false }
    if u.Banned { return false }
    return true
}

// "Refactored" into one expression
func canAccess(u *User) bool {
    return u != nil && u.Active && !u.Banned   // looks equivalent...
}
```

**Symptoms:** Mostly fine — but a subtle difference: the original short-circuited `u == nil` *before* touching `u.Active`. The one-liner does too (Go `&&` short-circuits), so this *specific* case is OK... but watch the next one.

<details><summary>Find the bug</summary>

This particular rewrite is actually correct (Go `&&` short-circuits left-to-right, so `u != nil` guards the later dereferences). **The trap is assuming** it's equivalent without a test. Reorder the conjuncts — `u.Active && u != nil && ...` — and you get a nil dereference panic. The "simplification" is one typo away from a crash, and only a test catches the difference.

</details>

### Fix

Keep a test that exercises `nil`, inactive, banned, and happy cases. Then *either* form is fine — the test proves equivalence and protects against an accidental reorder.

### Lesson

"Equivalent boolean expressions" depend on **short-circuit order**. A refactor that reorders conjuncts/disjuncts can change behavior (or crash). The test, not your reading, is the proof.

---

## Bug 5: Guard-Clause Inversion Changed Behavior

```python
# Before
def publish(post):
    if post.is_ready:
        feed.add(post)

# "Refactored" to a guard clause — inverted wrong
def publish(post):
    if post.is_ready:        # BUG: should be `if not post.is_ready`
        return
    feed.add(post)
```

**Symptoms:** Ready posts are never published; only un-ready ones reach `feed.add`. Exactly backwards.

<details><summary>Find the bug</summary>

Converting to a guard clause requires **inverting** the condition (`is_ready` → `not is_ready`). The author kept the original condition but added `return`, flipping which posts get published. A classic off-by-`not` in a "behavior-preserving" move.

</details>

### Fix

```python
def publish(post):
    if not post.is_ready:    # reject the BAD case
        return
    feed.add(post)
```

### Lesson

Replace-Nested-Conditional-with-Guard-Clauses requires *inverting* the condition. It's mechanical but easy to get backwards — which is why you run the tests after the step. A test asserting "ready post is published" turns this from a production incident into an instant red bar.

---

## Bug 6: Fixing a Bug During a "Characterization" Pass

```python
# Characterizing legacy shipping cost. Author notices it never charges for tier 0
# and "cleans it up" while writing the test.
def shipping(weight, tier):
    if tier == 0:
        return 0.0           # author CHANGED this from the original `return weight * 5`
    return weight * tier * 2
```

**Symptoms:** A downstream warehouse system that *relied* on tier-0 shipping being `weight * 5` now sees `0.0`. Free shipping for a whole customer segment; revenue leak.

<details><summary>Find the bug</summary>

The author conflated **characterization** (pin current behavior) with a **bug fix** (change behavior). They "improved" the code mid-refactor, changing external behavior that something depended on — under the guise of a cleanup.

</details>

### Fix

Characterize the *actual* behavior first (`return weight * 5` for tier 0), refactor with that pinned and green, and only *then*, as a separate task under the adding-behavior hat with its own test and deploy, decide whether tier-0-free is the intended fix.

### Lesson

A characterization test encodes **current behavior, bugs included.** Never fix a bug in the same step you discover it during a refactor. Seam → characterize → refactor → *separately* fix. See [Senior](senior.md).

---

## Bug 7: Extract Method Lost Short-Circuit Side Effects

```java
// Before: the && short-circuits, so audit() runs ONLY when active
if (user.isActive() && audit(user)) {
    grant(user);
}

// "Refactored" — extracted into a variable for "clarity"
boolean active = user.isActive();
boolean audited = audit(user);          // BUG: audit() now ALWAYS runs
if (active && audited) {
    grant(user);
}
```

**Symptoms:** `audit()` (which writes an audit-log row, or charges, or mutates) now fires for *inactive* users too. Extra log rows / side effects that the short-circuit used to prevent.

<details><summary>Find the bug</summary>

Extracting the operands of `&&` into separate variables **destroyed the short-circuit**. `audit(user)` was only meant to run when `isActive()` was true; now it runs unconditionally because both operands are evaluated before the `if`.

</details>

### Fix

```java
// Keep the short-circuit; extract a well-named method instead of eager temps
if (user.isActive() && auditAndCheck(user)) {
    grant(user);
}
```

### Lesson

You can't blindly hoist the operands of a short-circuiting `&&`/`||` into temps — if they have **side effects** or are **expensive**, eager evaluation changes behavior. Extract a *method* preserving the short-circuit, not eager variables.

---

## Bug 8: Inlining Changed Evaluation Count

```go
// Before: nextID() called once, result reused
id := nextID()
log.Printf("creating %d", id)
store[id] = newRecord(id)

// "Refactored" — inlined the variable
log.Printf("creating %d", nextID())   // BUG: call #1
store[nextID()] = newRecord(nextID()) // BUG: calls #2 and #3 — three different IDs!
```

**Symptoms:** The log line, the map key, and the record's internal ID are now *three different* IDs. Records are stored under a key that doesn't match their content.

<details><summary>Find the bug</summary>

`nextID()` has a side effect (it advances a counter). Inlining the variable changed it from **one** call to **three**, producing three distinct values where there used to be one consistent value.

</details>

### Fix

Don't inline a variable whose initializer is **impure** (side-effecting or non-deterministic). Keep the single call:

```go
id := nextID()                         // called once, reused
log.Printf("creating %d", id)
store[id] = newRecord(id)
```

### Lesson

Inline Variable is only behavior-preserving when the initializer is **pure**. If it calls a counter, RNG, clock, or anything with a side effect, inlining multiplies the calls and changes behavior.

---

## Bug 9: Replace Loop with Stream Changed Float Order

```java
// Before: summed in array order
double total = 0;
for (double x : values) total += x;

// "Refactored" to a parallel stream for "cleanliness"
double total = Arrays.stream(values).parallel().sum();  // different summation order
```

**Symptoms:** For most inputs identical; for large arrays of floats with widely varying magnitudes, the parallel sum differs in the last digits — and a financial total fails reconciliation by a cent.

<details><summary>Find the bug</summary>

Floating-point addition is **not associative**. A parallel stream sums in a *different order* than the sequential loop, producing a (slightly) different result. The "cleanup" changed the output.

</details>

### Fix

Use a sequential stream (`Arrays.stream(values).sum()`, same order as the loop) if you want behavior preservation, or — if the order change is acceptable — make it an *explicit decision* verified against requirements, not a silent side effect of a "refactor."

### Lesson

Switching a loop to a stream (especially **parallel**) can change ordering, and ordering changes floating-point and any order-dependent result. "Tidier code" that alters output is a behavior change. Pin numeric output with a characterization test.

---

## Bug 10: Two Hats at Once Hid a Regression

```python
# PR: "Refactor checkout and add express shipping"
# 380-line diff mixing extracted functions with a new shipping branch.
def checkout(cart, user):
    validate(cart, user)                 # extracted (refactor)
    total = compute_total(cart)          # extracted (refactor)
    if user.express:                     # NEW behavior (feature)
        total += EXPRESS_FEE
    # ... 300 more lines, refactor + feature interleaved
```

**Symptoms:** A regression in tax calculation (introduced by a botched extraction) shipped, hidden inside the giant diff. Review approved it because the feature looked right; nobody could audit 380 mixed lines for behavior preservation.

<details><summary>Find the bug</summary>

The PR wears **both hats at once**. The refactor (extractions) and the feature (express shipping) are interleaved in one un-reviewable diff. A reviewer can't tell which lines are supposed to preserve behavior and which are supposed to change it — so a refactor-introduced regression sailed through.

</details>

### Fix

Split into two PRs/commits: first a pure refactor (`refactor: extract validate/compute_total from checkout`) that's verifiably behavior-preserving and green, then a small feature (`feat: express shipping`). The refactor regression would have been obvious in a clean extract-only diff.

### Lesson

**One hat per commit/PR.** Mixing refactor and feature makes both unreviewable and lets behavior changes hide inside "refactoring" noise. See [Professional](professional.md) on review.

---

## Bug 11: Extracted Constant Was Wrong

```java
// Before — two literals that LOOK the same
double memberPrice  = base * 0.85;   // 15% off
double staffPrice   = base * 0.85;   // coincidentally also 15%... or is it?

// "Refactored" — extracted one shared constant
static final double DISCOUNT = 0.85;
double memberPrice = base * DISCOUNT;
double staffPrice  = base * DISCOUNT;   // BUG: staff was SUPPOSED to be 0.80 (20% off);
                                        // the original 0.85 was itself a pre-existing typo,
                                        // now CEMENTED and SPREAD by the extraction
```

**Symptoms:** Extracting a "shared" constant coupled two values that were only *accidentally* equal, so the next time staff discount changes to 20%, the member discount changes with it — and the pre-existing typo is now harder to find.

<details><summary>Find the bug</summary>

Two literals being *equal* doesn't mean they're the *same concept*. Extracting a shared constant from accidental duplication couples two independent values. (And here it also spread a latent typo.) This is **incidental duplication** mistaken for real duplication.

</details>

### Fix

```java
static final double MEMBER_DISCOUNT = 0.85;
static final double STAFF_DISCOUNT  = 0.80;   // distinct concepts, distinct constants
```

### Lesson

Don't extract a shared constant/function from values that are *coincidentally* equal. Extract only **conceptual** duplication. Coupling independent concepts because they happen to share a value is a refactoring that makes future change *harder* — the opposite of the goal. (See DRY vs. incidental duplication.)

---

## Bug 12: Long-Lived "Refactor" Branch Diverged

```text
# git history
* main:  ...50 commits of features over 4 months...
| 
| * refactor/cleanup-order-pipeline:  ...60 commits, started 4 months ago...
|/
# Attempting to merge: 200 conflicts, behavior diverged in both directions, nobody
# can tell which version of each function is "correct" anymore.
```

**Symptoms:** The "refactoring" branch can't be merged. Four months of work; `main` evolved independently; reconciling them reintroduces old bugs and risks new ones. The effort is abandoned; nothing ships.

<details><summary>Find the bug</summary>

This isn't a code bug — it's a **process bug** that turned a "refactoring" into a failed big-bang rewrite. Refactoring must land in *small steps on `main`* (or short-lived branches), not accumulate on a long-lived divergent branch. Discipline violated: not always-shippable, not incremental.

</details>

### Fix

Use **branch by abstraction + feature flags** to land the change incrementally on `main`, keeping it always-shippable; use the **Mikado Method** to discover the safe order of small steps without ever sitting in a wide broken state. See [Senior](senior.md) and [Professional](professional.md).

### Lesson

A refactoring that lives on a branch for months is a rewrite in disguise, and rewrites on branches die. The discipline is *continuous, incremental, on `main`*. The moment a "refactor" needs its own long-lived branch, stop and replan.

---

## Practice Tips

1. **After any "refactor," ask: did external behavior change?** Output, exceptions, side effects, wire format, call counts, ordering. If yes, it wasn't a refactoring.
2. **Run the tests after every small step.** Every bug here would have turned red immediately.
3. **No tests? Don't refactor — characterize first** (and don't fix bugs you find).
4. **Watch the impure operations:** counters, clocks, RNG, I/O, audit/log writes. Extract/inline/reorder around them changes behavior.
5. **Watch short-circuits** (`&&`/`||`) — reordering or eager-evaluating operands changes when side effects run.
6. **Watch boundaries:** a rename that's also a JSON key / DB column / DI bean / reflection target is a behavior change.
7. **Extract only conceptual duplication**, never coincidental equality.
8. **One hat per commit; never a long-lived refactor branch.**

---

[← Tasks](tasks.md) · [Craftsmanship Disciplines](../README.md) · [Roadmap](../../../README.md) · **Next:** [Optimize](optimize.md)
