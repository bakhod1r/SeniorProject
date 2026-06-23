# Refactoring as a Discipline — Optimization Drills

> **Category:** [Craftsmanship Disciplines](../README.md) — refactoring as a continuous, behavior-preserving habit done under passing tests, not a big-bang rewrite.

10 drills that take messy code and **simplify it via safe refactoring steps**. The "optimization" here is mostly of the *most expensive resource in software — human attention*: readability, changeability, and the cognitive cost of the next edit. A few drills also yield real runtime or correctness gains. **Every drill is behavior-preserving and assumes tests run after each step.**

> **Reminder:** this is the refactoring hat. Output must not change. Where a drill *could* change behavior (float order, lazy eval), it's flagged — make that an explicit decision, not an accident.

---

## Table of Contents

1. [Drill 1: Extract Function from a Long Method](#drill-1-extract-function-from-a-long-method)
2. [Drill 2: Collapse the else Ladder into Guard Clauses](#drill-2-collapse-the-else-ladder-into-guard-clauses)
3. [Drill 3: Replace Repeated Conditional with Polymorphism](#drill-3-replace-repeated-conditional-with-polymorphism)
4. [Drill 4: Replace Magic Literals + Comments with Names](#drill-4-replace-magic-literals--comments-with-names)
5. [Drill 5: Introduce Parameter Object for a Data Clump](#drill-5-introduce-parameter-object-for-a-data-clump)
6. [Drill 6: Replace Temp with Query, Then Extract](#drill-6-replace-temp-with-query-then-extract)
7. [Drill 7: Decompose a Complex Conditional](#drill-7-decompose-a-complex-conditional)
8. [Drill 8: Replace Primitive with a Type (Parse, Don't Validate)](#drill-8-replace-primitive-with-a-type-parse-dont-validate)
9. [Drill 9: Consolidate Duplicate Conditional Fragments](#drill-9-consolidate-duplicate-conditional-fragments)
10. [Drill 10: Replace Manual Loop with a Pipeline](#drill-10-replace-manual-loop-with-a-pipeline)
11. [Optimization Tips](#optimization-tips)
12. [Summary](#summary)

---

## Drill 1: Extract Function from a Long Method

### Before — one function doing five things

```python
def send_invoice(order):
    # build line items
    lines = []
    for item in order.items:
        lines.append(f"{item.name}: ${item.price:.2f}")
    body = "\n".join(lines)
    # compute total
    total = sum(i.price for i in order.items)
    # add tax
    total_with_tax = total * 1.08
    # format
    body += f"\nTotal: ${total_with_tax:.2f}"
    # send
    smtp.send(order.customer.email, "Invoice", body)
```

### After — each comment became a named function

```python
def send_invoice(order):
    body = render_invoice(order)
    smtp.send(order.customer.email, "Invoice", body)

def render_invoice(order):
    return line_items(order) + f"\nTotal: ${total_with_tax(order):.2f}"

def line_items(order):
    return "\n".join(f"{i.name}: ${i.price:.2f}" for i in order.items)

def total_with_tax(order):
    return sum(i.price for i in order.items) * 1.08
```

**Gain:** The comments-that-narrate are gone — replaced by names that can't go stale. `send_invoice` now reads as a two-line summary. **Steps:** extract one comment-block at a time, test after each. No behavior change; the string output is identical.

---

## Drill 2: Collapse the else Ladder into Guard Clauses

### Before

```java
String shippingBand(double weight) {
    String band;
    if (weight <= 0) {
        band = "invalid";
    } else {
        if (weight < 1) {
            band = "light";
        } else {
            if (weight < 10) {
                band = "standard";
            } else {
                band = "heavy";
            }
        }
    }
    return band;
}
```

### After

```java
String shippingBand(double weight) {
    if (weight <= 0) return "invalid";
    if (weight < 1)  return "light";
    if (weight < 10) return "standard";
    return "heavy";
}
```

**Gain:** Nesting depth 3 → 1; the `band` temp disappears; reads as a top-to-bottom table. Cognitive complexity drops (cyclomatic is unchanged — same branches). See [Guard Clauses](../../coding-patterns/01-control-flow/01-guard-clauses-and-early-return/junior.md). **Steps:** convert one branch to a returning guard at a time, deleting the temp last.

---

## Drill 3: Replace Repeated Conditional with Polymorphism

### Before — the same `switch(type)` smeared across three functions

```go
func area(s Shape) float64 {
    switch s.Kind {
    case "circle": return 3.14159 * s.R * s.R
    case "square": return s.Side * s.Side
    }
    return 0
}
func perimeter(s Shape) float64 {
    switch s.Kind {
    case "circle": return 2 * 3.14159 * s.R
    case "square": return 4 * s.Side
    }
    return 0
}
```

### After — behavior lives in the type

```go
type Shape interface { Area() float64; Perimeter() float64 }

type Circle struct{ R float64 }
func (c Circle) Area() float64      { return math.Pi * c.R * c.R }
func (c Circle) Perimeter() float64 { return 2 * math.Pi * c.R }

type Square struct{ Side float64 }
func (s Square) Area() float64      { return s.Side * s.Side }
func (s Square) Perimeter() float64 { return 4 * s.Side }
```

**Gain:** Adding a shape is one new type, not edits to every `switch`. The "shotgun surgery" of touching N functions per new case is eliminated (Open/Closed). **Steps:** introduce the interface, move one branch per method into its type, drain the switches, delete them — testing after each move.

---

## Drill 4: Replace Magic Literals + Comments with Names

### Before

```python
def can_retry(attempts, elapsed):
    # max 5 attempts, within 30 seconds
    return attempts < 5 and elapsed < 30
```

### After

```python
MAX_ATTEMPTS = 5
RETRY_WINDOW_SECONDS = 30

def can_retry(attempts, elapsed):
    return attempts < MAX_ATTEMPTS and elapsed < RETRY_WINDOW_SECONDS
```

**Gain:** The comment becomes executable, un-stale-able names; the policy values live in one place and can be tuned without re-reading the logic. **Steps:** extract one constant at a time. Values unchanged → behavior unchanged. (The comment is now redundant and deleted — its content is in the names.)

---

## Drill 5: Introduce Parameter Object for a Data Clump

### Before — the same three params travel everywhere

```java
double interest(double principal, double rate, int years) { ... }
double total(double principal, double rate, int years)     { ... }
String describe(double principal, double rate, int years)  { ... }
```

### After

```java
record Loan(double principal, double rate, int years) {
    double interest() { ... }
    double total()    { ... }
    String describe() { ... }
}
```

**Gain:** Three-parameter clumps collapse to one `Loan`; related behavior gravitates onto the type; call sites get shorter and harder to mis-order (no more passing `rate` where `years` goes). **Steps:** Parallel Change — add overloads taking `Loan`, migrate callers one at a time, then delete the old signatures (see [Tasks](tasks.md) Task 8).

---

## Drill 6: Replace Temp with Query, Then Extract

### Before — temps block extraction

```python
def price(order):
    base = order.qty * order.unit_price
    discount = base * 0.1 if order.qty > 100 else 0
    return base - discount
```

### After — temps become queries; logic is now extractable & reusable

```python
def price(order):
    return base_price(order) - volume_discount(order)

def base_price(order):
    return order.qty * order.unit_price

def volume_discount(order):
    return base_price(order) * 0.1 if order.qty > 100 else 0
```

**Gain:** The derived values are now available anywhere (not just as locals), which is what *enables* clean extraction and reuse. The top function reads as a formula. **Steps:** replace `base` temp with `base_price()` query, test; replace `discount` temp with `volume_discount()` query, test. A classic preparatory refactor before further change.

---

## Drill 7: Decompose a Complex Conditional

### Before — an unreadable boolean

```java
if (date.isAfter(SUMMER_START) && date.isBefore(SUMMER_END)
        && !plan.isPremium() || plan.hasPromo() && credits > 0) {
    applyDiscount();
}
```

### After — extract the conditions into named predicates

```java
if (isSummerStandard(date, plan) || isPromoEligible(plan, credits)) {
    applyDiscount();
}

private boolean isSummerStandard(LocalDate date, Plan plan) {
    return date.isAfter(SUMMER_START) && date.isBefore(SUMMER_END) && !plan.isPremium();
}
private boolean isPromoEligible(Plan plan, int credits) {
    return plan.hasPromo() && credits > 0;
}
```

**Gain:** The tangled precedence (`&&` binds tighter than `||`) is made explicit and named; the `if` now states *intent*, and the precedence bug-magnet is isolated and testable. **Steps:** extract one predicate at a time, preserving exact operator precedence (parenthesize to be sure), test after each. **Watch:** don't change the precedence while extracting — that's the [Find-Bug](find-bug.md) trap.

---

## Drill 8: Replace Primitive with a Type (Parse, Don't Validate)

### Before — a raw string validated in many places

```python
def send(addr):
    if "@" not in addr: raise ValueError("bad email")
    ...
def cc(addr):
    if "@" not in addr: raise ValueError("bad email")   # duplicated guard
    ...
```

### After — one type, validated once at construction

```python
from dataclasses import dataclass

@dataclass(frozen=True)
class Email:
    value: str
    def __post_init__(self):
        if "@" not in self.value:
            raise ValueError(f"bad email: {self.value}")

def send(addr: Email): ...   # no guard — the type guarantees validity
def cc(addr: Email):   ...   # no guard
```

**Gain:** N scattered validation guards collapse to **one** constructor check; downstream functions trust the type and stay flat; the duplicated guards can't drift apart. ("Parse, don't validate.") **Steps:** introduce the `Email` type, construct it at the boundary, migrate signatures via Parallel Change, delete the now-redundant guards. **Watch:** if `addr` was serialized as a bare string, the wire format is unchanged here (we still store `.value`) — confirm with a test.

---

## Drill 9: Consolidate Duplicate Conditional Fragments

### Before — the same statement in every branch

```go
func record(o Order) {
    if o.Express {
        log.Info("recording order")     // duplicated
        ledger.Add(o, expressFee)
    } else {
        log.Info("recording order")     // duplicated
        ledger.Add(o, standardFee)
    }
}
```

### After — hoist the common fragment out

```go
func record(o Order) {
    log.Info("recording order")         // once
    fee := standardFee
    if o.Express { fee = expressFee }
    ledger.Add(o, fee)
}
```

**Gain:** The duplicated log line is hoisted out of both branches (Consolidate Duplicate Conditional Fragments); the conditional now expresses *only* what actually differs (the fee). Less to read, one place to change the log. **Steps:** move the common statement above the `if`, test; collapse the branches to compute only the differing value, test. Behavior identical (log fires once in both paths, as before).

---

## Drill 10: Replace Manual Loop with a Pipeline

### Before — an accumulator loop

```python
def active_emails(users):
    result = []
    for u in users:
        if u.active:
            result.append(u.email)
    return result
```

### After — a comprehension/pipeline that states intent

```python
def active_emails(users):
    return [u.email for u in users if u.active]
```

**Gain:** The "filter then map" intent is explicit instead of buried in mutation; less boilerplate, no mutable accumulator to misread. **Steps:** rewrite, run the test (the output list — *including order* — must be identical). **Watch:** keep it **sequential** and **ordered**. A `parallel` stream (Java) or reordering would change ordering, and any order-dependent or floating-point result — that's a behavior change, not a refactoring (see [Find-Bug](find-bug.md) Bug 9). Pipelines are a readability refactor *only* when they preserve order and laziness semantics.

```java
// Java equivalent — sequential, order-preserving
List<String> activeEmails(List<User> users) {
    return users.stream()
                .filter(User::active)
                .map(User::email)
                .toList();              // NOT .parallel() — that changes order
}
```

---

## Optimization Tips

### What you're actually optimizing

1. **Cognitive load is the bottleneck.** Most of these drills cost nothing at runtime and everything in readability — that's the point. Measure with cognitive-complexity / nesting metrics, **not** cyclomatic complexity (which won't move for guard-clause and extract refactorings).
2. **Changeability is the real ROI.** Replace-conditional-with-polymorphism and introduce-parameter-object pay off the *next* time the code changes, by localizing that change.
3. **A few drills have runtime/correctness gains:** parse-don't-validate removes repeated runtime checks; consolidating fragments removes duplicate work; early extraction can enable later short-circuiting.

### Optimization checklist

- [ ] Extract long functions into named pieces (comments → names).
- [ ] Flatten else-ladders into guard clauses.
- [ ] Replace repeated `switch(type)` with polymorphism.
- [ ] Name magic literals; delete the comments they made redundant.
- [ ] Collapse data clumps into parameter objects / types.
- [ ] Replace temps with queries to unblock extraction.
- [ ] Decompose complex booleans into named predicates (keep precedence).
- [ ] Push repeated primitive validation into a type (parse, don't validate).
- [ ] Hoist duplicated conditional fragments out of branches.
- [ ] Replace accumulator loops with pipelines — *sequential, order-preserving only*.

### Anti-optimizations (these change behavior — not refactorings)

- ❌ **Parallel streams / reordered sums** — changes float results and ordering.
- ❌ **Inlining an impure variable** (clock/counter/RNG) — multiplies calls.
- ❌ **Eager-evaluating short-circuit operands** with side effects.
- ❌ **Extracting a constant from coincidentally-equal literals** — couples independent concepts.
- ❌ **Renaming across a serialization/DB/DI boundary** — changes the external contract.
- ❌ **"Simplifying" without a test** — you can't prove behavior held.

---

## Summary

Refactoring-as-optimization is overwhelmingly about **reducing the cost of the next change**: flatten nesting, name the unnamed, give clumps types, push behavior into polymorphism, and replace temps and loops with intention-revealing forms. The measurable wins are **cognitive complexity** and **changeability**, not cycles — so measure with a nesting-aware metric, not cyclomatic complexity. The handful of true runtime/correctness gains (parse-don't-validate, consolidating fragments) are bonuses. Throughout, the discipline is non-negotiable: small steps, tests after each, behavior preserved — and where a "tidier" form would change ordering, laziness, or evaluation count, that's a *behavior change* to be decided explicitly, not a refactoring to be slipped in.

---

[← Find-Bug](find-bug.md) · [Craftsmanship Disciplines](../README.md) · [Roadmap](../../../README.md)

**Refactoring as a Discipline suite complete.** All 8 files: [junior](junior.md) · [middle](middle.md) · [senior](senior.md) · [professional](professional.md) · [interview](interview.md) · [tasks](tasks.md) · [find-bug](find-bug.md) · [optimize](optimize.md).

**Next discipline:** [Simple Design](../04-simple-design/junior.md).
