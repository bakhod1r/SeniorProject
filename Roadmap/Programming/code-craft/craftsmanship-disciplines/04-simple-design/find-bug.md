# Simple Design — Find the Design Smell

> **Category:** [Craftsmanship Disciplines](../README.md) — Kent Beck's four rules for writing code that is no more complicated than it needs to be, in strict priority order.

12 snippets that violate simple design. Unlike a normal "find-bug," most of these **compile and pass their tests** — the defect is in the *design*, not the behavior. Spot the smell, then expand the fix and the lesson. Each names the rule it violates.

---

## Table of Contents

1. [Smell 1: One-Implementation Interface](#smell-1-one-implementation-interface)
2. [Smell 2: Hidden (Knowledge) Duplication](#smell-2-hidden-knowledge-duplication)
3. [Smell 3: Intention-Obscuring Names](#smell-3-intention-obscuring-names)
4. [Smell 4: DRYing Coincidental Similarity](#smell-4-drying-coincidental-similarity)
5. [Smell 5: Speculative Configuration](#smell-5-speculative-configuration)
6. [Smell 6: The Wrong Abstraction (Flag Soup)](#smell-6-the-wrong-abstraction-flag-soup)
7. [Smell 7: Pass-Through / Forwarding Layer](#smell-7-pass-through-forwarding-layer)
8. [Smell 8: Premature Extraction at Two Occurrences](#smell-8-premature-extraction-at-two-occurrences)
9. [Smell 9: Simplistic (Drops a Required Case)](#smell-9-simplistic-drops-a-required-case)
10. [Smell 10: Element-Count Minimalism Hurting Clarity](#smell-10-element-count-minimalism-hurting-clarity)
11. [Smell 11: YAGNI Violation at a Reversible Decision](#smell-11-yagni-violation-at-a-reversible-decision)
12. [Smell 12: Under-Engineering at a One-Way Door](#smell-12-under-engineering-at-a-one-way-door)
13. [Practice Tips](#practice-tips)

---

## Smell 1: One-Implementation Interface

```go
type UserFormatter interface{ Format(u User) string }

type DefaultUserFormatter struct{}
func (DefaultUserFormatter) Format(u User) string { return u.First + " " + u.Last }

func label(f UserFormatter, u User) string { return f.Format(u) }
// DefaultUserFormatter is the ONLY implementation; label is called once.
```

**Rule violated:** 4 (fewest elements) + YAGNI.

<details><summary>Find the smell</summary>

An interface with exactly one implementation and one caller. The interface, the empty struct, and the parameter are speculative generality — flexibility for a second formatter that doesn't exist.

</details>

### Fix

```go
func label(u User) string { return u.First + " " + u.Last }
```

### Lesson

No interface without a second real implementation (or a present test-seam requirement). Go's structural typing lets you add the interface later without touching the concrete type — so deferring costs nothing.

---

## Smell 2: Hidden (Knowledge) Duplication

```python
def gross_invoice(net):  return net + net * 0.20    # VAT rule, copy 1
def display_total(net):  return net + net * 0.20    # VAT rule, copy 2
def audit_amount(net):   return net + net * 0.20    # VAT rule, copy 3
```

**Rule violated:** 3 (no duplication).

<details><summary>Find the smell</summary>

The VAT rule (`+ net * 0.20`) is the *same knowledge* in three places. When the VAT rate changes, you must find and edit all three — miss one and you ship a financial bug.

</details>

### Fix

```python
VAT_RATE = 0.20
def with_vat(net): return net + net * VAT_RATE      # one home for the rule

def gross_invoice(net): return with_vat(net)
def display_total(net): return with_vat(net)
def audit_amount(net):  return with_vat(net)
```

### Lesson

Duplicated *knowledge* (a single business rule in multiple places) is the dangerous kind — it can drift apart. Give the rule one home. Verify it's the *same* rule first (here it is: all three compute VAT).

---

## Smell 3: Intention-Obscuring Names

```java
List<X> proc(List<X> l) {
    List<X> r = new ArrayList<>();
    for (X x : l) if (x.s() == 1) r.add(x);
    return r;
}
```

**Rule violated:** 2 (reveals intention).

<details><summary>Find the smell</summary>

`proc`, `l`, `r`, `x`, `s()`, and the magic `1` hide everything. A reader can't tell *what* is being filtered or *why*. It works, but it doesn't communicate.

</details>

### Fix

```java
List<Order> activeOrders(List<Order> orders) {
    return orders.stream()
                 .filter(o -> o.status() == Status.ACTIVE)
                 .toList();
}
```

### Lesson

Names are design. `status() == 1` → `status() == Status.ACTIVE` also kills connascence-of-meaning (a magic value two sides must agree on). Reveals-intention is the second rule — above DRY — for exactly this reason: clarity is the higher value.

---

## Smell 4: DRYing Coincidental Similarity

```python
def discount_rate(): return 0.15
def commission_rate(): return 0.15

# A teammate "DRYs" them:
RATE = 0.15
def discount_rate():   return RATE
def commission_rate(): return RATE     # now coupled!
```

**Rule violated:** 3 — *misapplied* (manufactured coupling).

<details><summary>Find the smell</summary>

Discount and commission share a value *today* but are independent business decisions. Tying both to one `RATE` means the day commission changes to 0.18, you either break discount or add a flag — coupling two things that should evolve separately.

</details>

### Fix

```python
DISCOUNT_RATE = 0.15
COMMISSION_RATE = 0.15     # same value now, free to diverge later

def discount_rate():   return DISCOUNT_RATE
def commission_rate(): return COMMISSION_RATE
```

### Lesson

DRY targets duplicated *knowledge*, not duplicated *values*. Test: *would a change to one force the same change to the other?* No → coincidence → keep separate. Over-zealous DRY creates the very coupling it's supposed to prevent.

---

## Smell 5: Speculative Configuration

```java
public class ReportGenerator {
    private final int maxRows;
    private final boolean useCache;
    private final String dateFormat;
    private final Charset charset;
    private final int retryCount;
    // All five read from config; in production every one has a single fixed value
    // and no requirement to vary. Five knobs nobody turns.
}
```

**Rule violated:** 4 (fewest elements) + YAGNI.

<details><summary>Find the smell</summary>

Five configuration parameters, none of which any requirement asks to vary. Each is a field, a config key, a code path, and a thing to document and test — all to support flexibility nobody needs.

</details>

### Fix

```java
public class ReportGenerator {
    private static final int MAX_ROWS = 10_000;
    private static final DateTimeFormatter DATE_FORMAT = DateTimeFormatter.ISO_DATE;
    // Hard-code the single real value. Make a knob configurable the day
    // someone actually needs to configure it.
}
```

### Lesson

Configurability is a cost: more surface, more code paths, more to test. Add a config knob when a present requirement needs the value to vary — not "in case."

---

## Smell 6: The Wrong Abstraction (Flag Soup)

```python
def build_message(user, kind, urgent=False, html=False, short=False, lang="en"):
    if kind == "welcome":   txt = greet(user, lang)
    elif kind == "reset":   txt = reset_link(user)
    elif kind == "alert":   txt = ("!! " if urgent else "") + alert_text(user)
    if short: txt = txt[:140]
    return wrap_html(txt) if html else txt
# Six callers, each using a different subset of the flags; almost no shared logic.
```

**Rule violated:** 2 + 3 (a "DRY" abstraction that obscures and couples).

<details><summary>Find the smell</summary>

This is the classic *wrong abstraction*: code that was DRYed into one function now serves divergent callers via a thicket of flags. It's harder to read and change than the duplication it replaced, and it's load-bearing for six callers.

</details>

### Fix

```python
def welcome_message(user, lang="en"): return greet(user, lang)
def reset_message(user):              return reset_link(user)
def alert_message(user, urgent=False):
    return ("!! " if urgent else "") + alert_text(user)
# Each caller calls the specific one. wrap_html()/truncation move to the
# one or two callers that actually need them.
```

### Lesson

When an abstraction grows flags to serve divergent callers, it's the *wrong* abstraction. Inline it back (re-introduce duplication), simplify each caller, and re-extract only genuinely shared knowledge. Duplication is cheaper than the wrong abstraction.

---

## Smell 7: Pass-Through / Forwarding Layer

```java
class OrderService {
    private final OrderRepository repo;
    Order find(long id)      { return repo.find(id); }      // just forwards
    void save(Order o)       { repo.save(o); }              // just forwards
    void delete(long id)     { repo.delete(id); }           // just forwards
    List<Order> all()        { return repo.all(); }         // just forwards
}
// OrderService adds NO behavior — every method is a one-line delegation.
```

**Rule violated:** 4 (fewest elements).

<details><summary>Find the smell</summary>

A "service" layer that only forwards calls to the repository adds an element (a class, four methods) with zero behavior. It's indirection without value — callers could use the repository directly.

</details>

### Fix

```java
// Delete OrderService; callers use OrderRepository directly.
// Reintroduce a service ONLY when it has real behavior to add
// (transactions, validation, orchestration across repositories).
```

### Lesson

A layer earns its place by *adding behavior*. Pure pass-through layers are needless elements — often added because "a service layer is best practice." Best practice is the behavior, not the empty class.

---

## Smell 8: Premature Extraction at Two Occurrences

```python
# Only TWO call sites exist, but someone extracted a "flexible" helper:
def format_line(value, prefix="", suffix="", pad=0, sep=":", upper=False):
    s = f"{prefix}{value}{sep}{suffix}".ljust(pad)
    return s.upper() if upper else s

a = format_line(total_a, prefix="Cart A ", suffix="$")
b = format_line(total_b, prefix="Cart B ", suffix="$")
```

**Rule violated:** 3 — *misapplied* (extracted too early, wrong shape).

<details><summary>Find the smell</summary>

With only two occurrences, the extraction *guessed* the abstraction's shape — and produced six parameters, most defaulted, to cover possibilities that never occur. The abstraction is more complex than the duplication it replaced.

</details>

### Fix

```python
# At two occurrences, keep it inline and concrete:
a = f"Cart A: ${total_a}"
b = f"Cart B: ${total_b}"
# Extract a small, well-shaped helper when a THIRD occurrence reveals
# what's truly invariant.
```

### Lesson

The rule of three exists precisely to prevent this. Two points can't define the abstraction's real shape; extracting early over-parameterizes for imagined variation. Tolerate the duplication until the third case.

---

## Smell 9: Simplistic (Drops a Required Case)

```python
def average(numbers):
    return sum(numbers) / len(numbers)     # "simple!" ... but:
```

**Rule violated:** 1 (passes all the tests) — *simplistic ≠ simple*.

<details><summary>Find the smell</summary>

This *looks* minimal, but it ignores the empty-list case (`ZeroDivisionError`) — a required behavior. It's not *simple*, it's *simplistic*: oversimplified to the point of being wrong. Rule 1 (correctness) is violated, so it isn't simple by definition.

</details>

### Fix

```python
def average(numbers):
    if not numbers:
        raise ValueError("average of an empty sequence is undefined")
    return sum(numbers) / len(numbers)
```

### Lesson

Simple removes the *needless*, never the *necessary*. Dropping a required case to shorten code fails Rule 1, the highest rule — so it can't be simple. Simplicity is "smallest thing that's still correct," not "shortest thing."

---

## Smell 10: Element-Count Minimalism Hurting Clarity

```python
def p(o):
    return sum(i.q*i.up for i in o.it)*(1+(0.2 if o.tx else 0))-(o.d or 0)
```

**Rule violated:** 2 (reveals intention) — minimalism taken too far.

<details><summary>Find the smell</summary>

Crammed into one dense line with one-letter names to minimize elements/characters — but it's unreadable. "Fewest elements" was misapplied: it's the *last* rule and must never override clarity (the second rule).

</details>

### Fix

```python
def order_total(order):
    subtotal = sum(item.qty * item.unit_price for item in order.items)
    taxed = subtotal * (1 + TAX_RATE) if order.taxable else subtotal
    return taxed - (order.discount or 0)
```

### Lesson

"Fewest elements" means fewest *concepts to understand*, not fewest characters. A clear five-line function is simpler than a cryptic one-liner. Rule 4 is a tiebreaker bounded above by Rule 2 — clarity always wins.

---

## Smell 11: YAGNI Violation at a Reversible Decision

```java
// Building a generic plugin system for what is, today, ONE report type.
interface ReportPlugin { Report generate(Params p); }
class PluginRegistry { /* register, discover, load, version plugins... */ }
class ReportEngine { /* runs plugins via the registry... */ }
// There is exactly one report. No second report is a requirement.
```

**Rule violated:** 4 + YAGNI (speculative architecture).

<details><summary>Find the smell</summary>

A plugin architecture — registry, discovery, versioning — for a single, internal, reversible report. The decision to support plugins is *cheap to reverse* (it's internal), so YAGNI applies: build the one report; add the seam if a second is ever real.

</details>

### Fix

```java
class SalesReport {
    Report generate(Params p) { /* the one report, directly */ }
}
// No plugin system. If a 2nd report type becomes real, extract a small
// interface THEN — shaped by two concrete reports.
```

### Lesson

This is internal and reversible, so YAGNI governs: defer the abstraction. (Contrast Smell 12 — the opposite mistake on an *irreversible* decision.)

---

## Smell 12: Under-Engineering at a One-Way Door

```go
// "Keep it simple": persistence details inlined throughout the domain.
func (s *OrderService) Place(o Order) error {
    _, err := s.db.Exec("INSERT INTO orders (id, total) VALUES ($1, $2)",
        o.ID, o.Total)                       // raw SQL in the domain layer
    return err
}
// The same raw-SQL pattern is repeated across ~200 domain files.
```

**Rule violated:** under-engineering — misapplying "fewest elements" to a one-way door.

<details><summary>Find the smell</summary>

Inlining storage details everywhere *looks* like "fewest elements," but storage is an **irreversible** decision (a future DB migration touches all 200 files). The missing seam is a defect, not simplicity — YAGNI was applied to a one-way door.

</details>

### Fix

```go
// A repository seam — a present, justified element because the storage
// boundary is irreversible and a migration is foreseeable.
type OrderRepository interface{ Save(o Order) error }

func (s *OrderService) Place(o Order) error { return s.repo.Save(o) }
```

### Lesson

"Fewest elements" is bounded by reversibility. YAGNI applies to *reversible* decisions; for one-way doors (schema, storage, public API, protocol) a seam is cheap insurance. Crushing necessary seams to win on element count is under-engineering — the symmetric opposite of gold-plating.

---

## Practice Tips

1. **Count implementations of each interface** — one implementation, no test-seam need → delete the interface.
2. **Search for repeated business rules/constants** (a rate, a formula) — that's *knowledge* duplication; give it one home.
3. **Before merging look-alikes, ask** *would a change to one force the same change to the other?* If no, it's coincidence — don't merge.
4. **Flag every abstraction without a present requirement** — "might need it later" is a YAGNI violation.
5. **Spot flag soup** — a function with many boolean/mode parameters serving divergent callers is the wrong abstraction; inline and re-split.
6. **Find pass-through layers** — classes/methods that only forward calls add no behavior; remove them.
7. **Watch for "simplistic"** — short code that drops a required case fails Rule 1; it isn't simple.
8. **Watch for one-liners that hurt clarity** — Rule 4 never overrides Rule 2.
9. **Check reversibility** — missing seams at one-way doors are under-engineering, not simplicity.

---

[← Tasks](tasks.md) · [Craftsmanship Disciplines](../README.md) · [Roadmap](../../../README.md) · **Next:** [Optimize](optimize.md)
