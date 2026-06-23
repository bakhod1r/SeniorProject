# Refactoring as a Discipline — Practice Tasks

> **Category:** [Craftsmanship Disciplines](../README.md) — refactoring as a continuous, behavior-preserving habit done under passing tests, not a big-bang rewrite.

10 graded refactoring exercises. Each gives a **before**, a **goal**, and a sequence of **small safe steps** — the disciplined way to get there. **Every step assumes a passing test suite and is followed by re-running the tests.** Full solutions in Python, Java, and Go.

> **The rule for all tasks:** behavior must be identical before and after. If any test changes its expected value, you've left the refactoring hat — undo and try again.

---

## Table of Contents

1. [Task 1: Extract Function](#task-1-extract-function)
2. [Task 2: Replace Magic Number with Symbolic Constant](#task-2-replace-magic-number-with-symbolic-constant)
3. [Task 3: Replace Nested Conditional with Guard Clauses](#task-3-replace-nested-conditional-with-guard-clauses)
4. [Task 4: Introduce Parameter Object](#task-4-introduce-parameter-object)
5. [Task 5: Replace Conditional with Polymorphism](#task-5-replace-conditional-with-polymorphism)
6. [Task 6: Rename for Honesty](#task-6-rename-for-honesty)
7. [Task 7: Replace Temp with Query](#task-7-replace-temp-with-query)
8. [Task 8: Parallel Change (Safe Signature Change)](#task-8-parallel-change-safe-signature-change)
9. [Task 9: Characterize, Then Refactor Legacy](#task-9-characterize-then-refactor-legacy)
10. [Task 10: Introduce a Seam to Make Code Testable](#task-10-introduce-a-seam-to-make-code-testable)
11. [Practice Tips](#practice-tips)

---

## Task 1: Extract Function

**Goal:** Break a long function into named pieces, each step run the tests. The arithmetic must stay identical.

**Before (Java):**

```java
double statement(Order o) {
    double total = 0;
    for (Line l : o.lines()) {
        double lineAmount = l.qty() * l.unitPrice();
        if (l.qty() > 100) lineAmount *= 0.9;       // volume discount
        total += lineAmount;
    }
    double tax = total * 0.08;
    return total + tax;
}
```

**Small steps:** (1) extract `lineAmount(l)`; test. (2) extract `tax(total)`; test. (3) extract the loop into `subtotal(o)`; test.

<details><summary>Solution</summary>

### Java
```java
double statement(Order o) {
    double total = subtotal(o);
    return total + tax(total);
}
private double subtotal(Order o) {
    double total = 0;
    for (Line l : o.lines()) total += lineAmount(l);
    return total;
}
private double lineAmount(Line l) {
    double amt = l.qty() * l.unitPrice();
    return l.qty() > 100 ? amt * 0.9 : amt;
}
private double tax(double total) { return total * 0.08; }
```

### Python
```python
def statement(order):
    total = subtotal(order)
    return total + tax(total)

def subtotal(order):
    return sum(line_amount(l) for l in order.lines)

def line_amount(l):
    amt = l.qty * l.unit_price
    return amt * 0.9 if l.qty > 100 else amt

def tax(total):
    return total * 0.08
```

### Go
```go
func statement(o Order) float64 {
    total := subtotal(o)
    return total + tax(total)
}
func subtotal(o Order) (total float64) {
    for _, l := range o.Lines { total += lineAmount(l) }
    return
}
func lineAmount(l Line) float64 {
    amt := float64(l.Qty) * l.UnitPrice
    if l.Qty > 100 { amt *= 0.9 }
    return amt
}
func tax(total float64) float64 { return total * 0.08 }
```

**Why:** Each extraction is a self-contained safe step. The top-level function now reads like a description; the magic numbers still exist but are isolated (Task 2 names them).
</details>

---

## Task 2: Replace Magic Number with Symbolic Constant

**Goal:** Give bare literals (`0.9`, `0.08`, `100`) names. Behavior unchanged — you're only introducing constants.

**Before (Python):** the functions from Task 1, full of `0.9`, `0.08`, `100`.

**Small steps:** introduce one constant at a time (`TAX_RATE`, then `VOLUME_THRESHOLD`, then `VOLUME_DISCOUNT`), substituting and re-testing after each.

<details><summary>Solution</summary>

### Python
```python
TAX_RATE = 0.08
VOLUME_THRESHOLD = 100
VOLUME_DISCOUNT_RATE = 0.10

def line_amount(l):
    amt = l.qty * l.unit_price
    if l.qty > VOLUME_THRESHOLD:
        amt *= (1 - VOLUME_DISCOUNT_RATE)
    return amt

def tax(total):
    return total * TAX_RATE
```

### Java
```java
private static final double TAX_RATE = 0.08;
private static final int VOLUME_THRESHOLD = 100;
private static final double VOLUME_DISCOUNT_RATE = 0.10;
```

### Go
```go
const (
    taxRate            = 0.08
    volumeThreshold    = 100
    volumeDiscountRate = 0.10
)
```

**Why:** `0.9` became `1 - VOLUME_DISCOUNT_RATE`, which *says* "a 10% discount." The value is unchanged (still 0.9), so tests stay green, but intent is now explicit and the rate lives in one place.
</details>

---

## Task 3: Replace Nested Conditional with Guard Clauses

**Goal:** Flatten a conditional pyramid into guards. Same return values.

**Before (Go):**

```go
func payAmount(e Employee) float64 {
    var result float64
    if e.Separated {
        result = separatedAmount()
    } else {
        if e.Retired {
            result = retiredAmount()
        } else {
            result = normalPay(e)
        }
    }
    return result
}
```

**Small steps:** (1) turn the first special case into a returning guard; test. (2) the second; test. (3) delete the `result` var and `else` ladder; test.

<details><summary>Solution</summary>

### Go
```go
func payAmount(e Employee) float64 {
    if e.Separated { return separatedAmount() }
    if e.Retired   { return retiredAmount() }
    return normalPay(e)
}
```

### Java
```java
double payAmount(Employee e) {
    if (e.isSeparated()) return separatedAmount();
    if (e.isRetired())   return retiredAmount();
    return normalPay(e);
}
```

### Python
```python
def pay_amount(e):
    if e.separated: return separated_amount()
    if e.retired:   return retired_amount()
    return normal_pay(e)
```

**Why:** This is Fowler's named refactoring "Replace Nested Conditional with Guard Clauses." See [Guard Clauses](../../coding-patterns/01-control-flow/01-guard-clauses-and-early-return/junior.md). The normal case becomes the obvious default, not a buried special case.
</details>

---

## Task 4: Introduce Parameter Object

**Goal:** A "data clump" of parameters that always travel together becomes one type. Behavior unchanged.

**Before (Java):**

```java
boolean overlaps(LocalDate start1, LocalDate end1, LocalDate start2, LocalDate end2) { ... }
long days(LocalDate start, LocalDate end) { ... }
```

**Small steps:** (1) create the `DateRange` record; (2) add a new overload taking `DateRange` that delegates to the old; (3) migrate callers; (4) inline and delete the old. (Parallel Change — Task 8.)

<details><summary>Solution</summary>

### Java
```java
record DateRange(LocalDate start, LocalDate end) {
    long days() { return ChronoUnit.DAYS.between(start, end); }
    boolean overlaps(DateRange other) {
        return !start.isAfter(other.end) && !other.start.isAfter(end);
    }
}
```

### Python
```python
from dataclasses import dataclass
from datetime import date

@dataclass(frozen=True)
class DateRange:
    start: date
    end: date
    def days(self): return (self.end - self.start).days
    def overlaps(self, other):
        return self.start <= other.end and other.start <= self.end
```

### Go
```go
type DateRange struct{ Start, End time.Time }

func (r DateRange) Days() int { return int(r.End.Sub(r.Start).Hours() / 24) }
func (r DateRange) Overlaps(o DateRange) bool {
    return !r.Start.After(o.End) && !o.Start.After(r.End)
}
```

**Why:** Four parameters became one cohesive concept that can carry its own behavior (`days`, `overlaps`). Long parameter lists shrink, and related logic gravitates to the new type.
</details>

---

## Task 5: Replace Conditional with Polymorphism

**Goal:** A `switch`/`if` on a type code, repeated in several places, becomes polymorphic dispatch. Same outputs.

**Before (Python):**

```python
def area(shape):
    if shape.kind == "circle":   return 3.14159 * shape.r ** 2
    elif shape.kind == "square": return shape.side ** 2
    elif shape.kind == "rect":   return shape.w * shape.h
    raise ValueError(shape.kind)
```

**Small steps:** (1) create a class per kind with an `area()` method; (2) move each branch's body into the matching class, testing after each; (3) replace `area(shape)` calls with `shape.area()`; (4) delete the conditional.

<details><summary>Solution</summary>

### Python
```python
class Circle:
    def __init__(self, r): self.r = r
    def area(self): return 3.14159 * self.r ** 2
class Square:
    def __init__(self, side): self.side = side
    def area(self): return self.side ** 2
class Rect:
    def __init__(self, w, h): self.w, self.h = w, h
    def area(self): return self.w * self.h
```

### Java
```java
interface Shape { double area(); }
record Circle(double r)        implements Shape { public double area() { return Math.PI * r * r; } }
record Square(double side)     implements Shape { public double area() { return side * side; } }
record Rect(double w, double h) implements Shape { public double area() { return w * h; } }
```

### Go
```go
type Shape interface { Area() float64 }
type Circle struct{ R float64 }
func (c Circle) Area() float64 { return 3.14159 * c.R * c.R }
type Square struct{ Side float64 }
func (s Square) Area() float64 { return s.Side * s.Side }
```

**Why:** Adding a new shape no longer means hunting down every `switch(kind)`. It's a new class implementing the interface — Open/Closed. Do it in small steps so the conditional and the classes coexist until the switch is fully drained.
</details>

---

## Task 6: Rename for Honesty

**Goal:** Replace lying/cryptic names with truthful ones using the IDE's automated Rename. Behavior unchanged (within code boundaries — beware serialized names).

**Before (Go):**

```go
func proc(d []int, f int) int {   // proc? d? f?
    t := 0
    for _, x := range d {
        if x > f { t += x }
    }
    return t
}
```

**Small steps:** rename one symbol at a time with the IDE (`proc`→`sumAbove`, `d`→`values`, `f`→`floor`, `t`→`total`), running tests after each.

<details><summary>Solution</summary>

### Go
```go
func sumAbove(values []int, floor int) int {
    total := 0
    for _, v := range values {
        if v > floor { total += v }
    }
    return total
}
```

### Python
```python
def sum_above(values, floor):
    return sum(v for v in values if v > floor)
```

### Java
```java
int sumAbove(int[] values, int floor) {
    int total = 0;
    for (int v : values) if (v > floor) total += v;
    return total;
}
```

**Why:** Renaming is a first-class refactoring. The honest name removes the need for a comment and prevents the next reader's confusion. **Caveat:** if any of these names were a JSON key, DB column, or DI bean, the rename would change *external* behavior — that's not a pure refactoring (see [Find-Bug](find-bug.md)).
</details>

---

## Task 7: Replace Temp with Query

**Goal:** Remove temporary variables that hold a derived value, replacing them with a query function. Same result; opens the door to later extraction.

**Before (Java):**

```java
double price(Order o) {
    double basePrice = o.quantity() * o.itemPrice();
    double discountFactor = basePrice > 1000 ? 0.95 : 0.98;
    return basePrice * discountFactor;
}
```

**Small steps:** (1) extract `basePrice()` as a method; replace the temp; test. (2) extract `discountFactor()`; replace the temp; test.

<details><summary>Solution</summary>

### Java
```java
double price(Order o) {
    return basePrice(o) * discountFactor(o);
}
private double basePrice(Order o)      { return o.quantity() * o.itemPrice(); }
private double discountFactor(Order o) { return basePrice(o) > 1000 ? 0.95 : 0.98; }
```

### Python
```python
def price(order):
    return base_price(order) * discount_factor(order)

def base_price(order):
    return order.quantity * order.item_price

def discount_factor(order):
    return 0.95 if base_price(order) > 1000 else 0.98
```

### Go
```go
func price(o Order) float64 { return basePrice(o) * discountFactor(o) }
func basePrice(o Order) float64 { return float64(o.Quantity) * o.ItemPrice }
func discountFactor(o Order) float64 {
    if basePrice(o) > 1000 { return 0.95 }
    return 0.98
}
```

**Why:** Replacing temps with queries makes the values available everywhere (not just locally), which is what *enables* Extract Function on the surrounding code. A common preparatory micro-refactoring before a larger Extract.
</details>

---

## Task 8: Parallel Change (Safe Signature Change)

**Goal:** Change a function's signature used by many callers, never leaving the suite red. (Expand → migrate → contract.)

**Before (Python):** `def notify(addr, subject, body): ...` called in 30 places. We want `def notify(message): ...` taking a `Message`.

**Small steps:**

<details><summary>Solution</summary>

```python
# Step 1 — EXPAND: add the new function, delegating to the old. No callers change.
def notify_message(message):
    return notify(message.addr, message.subject, message.body)

# Step 2 — MIGRATE callers one at a time, testing after each:
#   notify(u.email, "Hi", body)  →  notify_message(Message(u.email, "Hi", body))

# Step 3 — CONTRACT: once nothing calls the old `notify`, inline its body
# into notify_message and delete the old. Optionally rename notify_message → notify.
def notify(message):
    _send(message.addr, message.subject, message.body)
```

### Java (Change Signature + delegation)
```java
// Step 1
void notify(Message m) { notify(m.addr(), m.subject(), m.body()); }
// Step 2: migrate callers to the Message overload, test each
// Step 3: delete the 3-arg overload once unused
```

### Go
```go
// Step 1
func NotifyMessage(m Message) error { return Notify(m.Addr, m.Subject, m.Body) }
// Step 2: migrate callers
// Step 3: inline & delete old Notify, rename NotifyMessage → Notify
```

**Why:** The new and old signatures coexist during migration, so the suite is green at every step and you can stop or roll back anytime. This is *exactly* how you refactor a *published* API without breaking consumers — the same pattern at a larger scale.
</details>

---

## Task 9: Characterize, Then Refactor Legacy

**Goal:** You're handed an opaque function with **no tests** and must refactor it. First *pin* its current behavior, then refactor. Do **not** fix the bug you find.

**Before (Python) — opaque, untested:**

```python
def fee(amount, tier):
    if tier == 1:
        return amount * 0.01 + 0.30
    if tier == 2:
        return amount * 0.005 + 0.30
    return amount * 0.02 + 0.30        # tier 0 / unknown — note: NOT cheaper than tier 1!
```

**Small steps:** (1) Write characterization tests by probing the real function and recording actual outputs (bug and all). (2) *Then* refactor (e.g., table-driven), keeping those characterizations green.

<details><summary>Solution</summary>

### Step 1 — characterization tests (lock current behavior, bugs included)
```python
def test_characterize_fee():
    assert fee(100, 1) == 1.30     # whatever it ACTUALLY returns
    assert fee(100, 2) == 0.80
    assert fee(100, 0) == 2.30     # yes, "unknown" is the MOST expensive — pinned as-is
    assert fee(100, 99) == 2.30
```

### Step 2 — refactor behind the green characterization tests
```python
RATES = {1: 0.01, 2: 0.005}
DEFAULT_RATE = 0.02
FLAT = 0.30

def fee(amount, tier):
    rate = RATES.get(tier, DEFAULT_RATE)
    return amount * rate + FLAT
```

**Why:** The characterization tests prove the table-driven version returns *exactly* what the original did — including the surprising "unknown tier is most expensive" behavior. If that's a bug, fixing it is a **separate task** under the adding-behavior hat, with its own test and deploy. Conflating the fix with the refactor is how "refactors" cause incidents — a downstream system may rely on the current behavior. See [Senior](senior.md).
</details>

---

## Task 10: Introduce a Seam to Make Code Testable

**Goal:** Legacy code reaches straight into the clock and a global, so it can't be characterized. Introduce a **seam** (the smallest, most careful step) so you *can* test it, then you'd refactor behind it.

**Before (Java) — untestable:**

```java
class TokenService {
    String issue(String userId) {
        long now = System.currentTimeMillis();        // real clock
        String secret = GlobalConfig.SECRET;           // global
        return sign(userId, now + 3600_000, secret);
    }
}
```

**Small steps:** (1) parameterize the clock and config via the constructor (Extract & inject — keep behavior identical with defaults); (2) now write characterization tests with a fixed clock and known secret; (3) refactor freely behind them.

<details><summary>Solution</summary>

### Java
```java
class TokenService {
    private final Clock clock;
    private final String secret;

    // Production wiring keeps old behavior; tests inject seams.
    TokenService() { this(Clock.systemUTC(), GlobalConfig.SECRET); }
    TokenService(Clock clock, String secret) { this.clock = clock; this.secret = secret; }

    String issue(String userId) {
        long now = clock.millis();                     // seam: injectable
        return sign(userId, now + 3600_000, secret);   // seam: injectable
    }
}

// Now characterizable:
//   var svc = new TokenService(Clock.fixed(EPOCH, UTC), "test-secret");
//   assertEquals("<deterministic token>", svc.issue("u1"));
```

### Go
```go
type TokenService struct {
    Now    func() time.Time   // seam
    Secret string            // seam
}

func NewTokenService() *TokenService {
    return &TokenService{Now: time.Now, Secret: globalConfig.Secret} // prod defaults
}
func (s *TokenService) Issue(userID string) string {
    exp := s.Now().Add(time.Hour)
    return sign(userID, exp, s.Secret)
}
```

### Python
```python
class TokenService:
    def __init__(self, clock=time.time, secret=None):   # seams with prod defaults
        self.clock = clock
        self.secret = secret or global_config.SECRET
    def issue(self, user_id):
        return sign(user_id, self.clock() + 3600, self.secret)
```

**Why:** The seam (injectable clock + secret) is introduced *first*, in the smallest possible step, with production defaults so behavior is unchanged. Only *after* the seam exists can you write deterministic characterization tests — and only after *those* can you refactor the signing logic safely. Sequence: **seam → characterize → refactor**. See [Senior](senior.md).
</details>

---

## Practice Tips

1. **Be on green before you start, and run tests after every step.** A red bar means stop and undo, not push forward.
2. **One refactoring move per step.** Extract one function, run tests, repeat. Small steps = small, obvious failures.
3. **One hat at a time.** These tasks are *all* refactoring hat — no expected test value changes. If one would, you're adding behavior; that's a different task.
4. **Use automated IDE refactorings** (rename, extract, change signature) — safe by construction, but mind serialization/DI boundaries.
5. **For legacy: seam → characterize → refactor → (separately) fix bugs.** Never fix the bug in the same step you discover it.
6. **Commit on green, one hat per commit**, so any step is a safe restore point and the history is reviewable.
7. **Apply the rule of three** before extracting an abstraction; don't generalize on one example.

---

[← Interview](interview.md) · [Craftsmanship Disciplines](../README.md) · [Roadmap](../../../README.md) · **Next:** [Find-Bug](find-bug.md)
