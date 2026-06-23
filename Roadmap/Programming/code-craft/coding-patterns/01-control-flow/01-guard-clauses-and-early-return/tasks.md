# Guard Clauses & Early Return — Practice Tasks

> **Category:** [Control-Flow Patterns](../README.md) — handle invalid and edge cases up front, then return, keeping the happy path un-nested.

10 graded hands-on tasks with full Go, Java, and Python solutions. Try each before expanding the solution.

---

## Table of Contents

1. [Task 1: Flatten the Arrow](#task-1-flatten-the-arrow)
2. [Task 2: Invert the Condition](#task-2-invert-the-condition)
3. [Task 3: Drop the Dangling else](#task-3-drop-the-dangling-else)
4. [Task 4: Validate Before Mutating](#task-4-validate-before-mutating)
5. [Task 5: Guard + Cleanup with Scope](#task-5-guard-cleanup-with-scope)
6. [Task 6: In-Loop Guards with continue](#task-6-in-loop-guards-with-continue)
7. [Task 7: Throw vs Return-Default](#task-7-throw-vs-return-default)
8. [Task 8: Order the Guards](#task-8-order-the-guards)
9. [Task 9: Push the Guard into a Type](#task-9-push-the-guard-into-a-type)
10. [Task 10: Split an Over-Guarded Function](#task-10-split-an-over-guarded-function)
11. [Practice Tips](#practice-tips)

---

## Task 1: Flatten the Arrow

**Goal:** Rewrite a 4-level nested function as a flat sequence of guard clauses. Behavior must be identical.

**Given (Python):**

```python
def grade(score):
    if score is not None:
        if 0 <= score <= 100:
            if score >= 60:
                return "pass"
            else:
                return "fail"
        else:
            raise ValueError("score out of range")
    else:
        raise ValueError("score required")
```

<details><summary>Solution</summary>

### Python
```python
def grade(score):
    if score is None:                raise ValueError("score required")
    if not (0 <= score <= 100):      raise ValueError("score out of range")
    if score < 60:                   return "fail"
    return "pass"
```

### Java
```java
String grade(Integer score) {
    if (score == null)              throw new IllegalArgumentException("score required");
    if (score < 0 || score > 100)   throw new IllegalArgumentException("score out of range");
    if (score < 60)                 return "fail";
    return "pass";
}
```

### Go
```go
func grade(score int, present bool) (string, error) {
    if !present              { return "", errors.New("score required") }
    if score < 0 || score > 100 { return "", errors.New("score out of range") }
    if score < 60            { return "fail", nil }
    return "pass", nil
}
```

**Why:** Each special case exits at the top; the happy path (`pass`) is the flat final line. No `else` survives.
</details>

---

## Task 2: Invert the Condition

**Goal:** Take a function whose work is wrapped in `if (good) { ... }` and invert it so the bad case leaves first.

**Given (Java):**

```java
void publish(Post post) {
    if (post.isReady()) {
        feed.add(post);
        notifier.ping(post.author());
    }
}
```

<details><summary>Solution</summary>

### Java
```java
void publish(Post post) {
    if (!post.isReady()) return;     // inverted guard
    feed.add(post);
    notifier.ping(post.author());
}
```

### Python
```python
def publish(post):
    if not post.is_ready:
        return
    feed.add(post)
    notifier.ping(post.author)
```

### Go
```go
func publish(post *Post) {
    if !post.Ready {
        return
    }
    feed.Add(post)
    notifier.Ping(post.Author)
}
```

**Why:** Inversion un-nests the body. The work now lives at column zero, not inside an `if`.
</details>

---

## Task 3: Drop the Dangling else

**Goal:** Remove every `else` that follows a returning `if`.

**Given (Go):**

```go
func classify(n int) string {
    if n < 0 {
        return "negative"
    } else if n == 0 {
        return "zero"
    } else {
        return "positive"
    }
}
```

<details><summary>Solution</summary>

### Go
```go
func classify(n int) string {
    if n < 0 { return "negative" }
    if n == 0 { return "zero" }
    return "positive"
}
```

### Java
```java
String classify(int n) {
    if (n < 0) return "negative";
    if (n == 0) return "zero";
    return "positive";
}
```

### Python
```python
def classify(n):
    if n < 0:  return "negative"
    if n == 0: return "zero"
    return "positive"
```

**Why:** Once an `if` returns, the following code *is* the else. The final `return` carries the default. (Pylint `R1705` / ESLint `no-else-return` flag the original.)
</details>

---

## Task 4: Validate Before Mutating

**Goal:** A function mutates state and then validates — fix the ordering so no guard can fire after a side effect.

**Given (Python) — buggy:**

```python
def apply_discount(cart, code):
    cart.total *= 0.9                 # mutates first!
    if code not in VALID_CODES:
        raise ValueError("invalid code")   # too late — total already changed
    cart.applied_code = code
```

<details><summary>Solution</summary>

### Python
```python
def apply_discount(cart, code):
    if code not in VALID_CODES:       # guard BEFORE mutation
        raise ValueError("invalid code")
    cart.total *= 0.9
    cart.applied_code = code
```

### Java
```java
void applyDiscount(Cart cart, String code) {
    if (!VALID_CODES.contains(code))
        throw new IllegalArgumentException("invalid code");
    cart.setTotal(cart.getTotal().multiply(new BigDecimal("0.9")));
    cart.setAppliedCode(code);
}
```

### Go
```go
func applyDiscount(cart *Cart, code string) error {
    if !validCodes[code] {
        return errors.New("invalid code")
    }
    cart.Total *= 0.9
    cart.AppliedCode = code
    return nil
}
```

**Why:** All guards must run before the first mutation. Otherwise a failed check leaves partial, corrupt state.
</details>

---

## Task 5: Guard + Cleanup with Scope

**Goal:** Add an early-return guard to a function that holds a resource, without leaking it.

**Given (Go) — buggy: early return leaks the lock:**

```go
func (c *Cache) GetOrLoad(key string) (Value, error) {
    c.mu.Lock()
    if v, ok := c.data[key]; ok {
        return v, nil               // returns while holding the lock!
    }
    v, err := load(key)
    if err != nil {
        return Value{}, err         // also leaks the lock
    }
    c.data[key] = v
    c.mu.Unlock()
    return v, nil
}
```

<details><summary>Solution</summary>

### Go
```go
func (c *Cache) GetOrLoad(key string) (Value, error) {
    c.mu.Lock()
    defer c.mu.Unlock()             // released on EVERY return
    if v, ok := c.data[key]; ok {
        return v, nil
    }
    v, err := load(key)
    if err != nil {
        return Value{}, err
    }
    c.data[key] = v
    return v, nil
}
```

### Java (try-with-resources concept via a Lock)
```java
Value getOrLoad(String key) throws Exception {
    lock.lock();
    try {                            // finally guarantees unlock on every return/throw
        Value v = data.get(key);
        if (v != null) return v;
        v = load(key);
        data.put(key, v);
        return v;
    } finally {
        lock.unlock();
    }
}
```

### Python
```python
def get_or_load(self, key):
    with self.lock:                  # released on every exit, including early return
        if key in self.data:
            return self.data[key]
        v = load(key)
        self.data[key] = v
        return v
```

**Why:** Scope-bound cleanup (`defer`/`finally`/`with`) makes early returns safe — this is precisely why single-exit is obsolete.
</details>

---

## Task 6: In-Loop Guards with continue

**Goal:** Flatten a loop body using `continue` as the loop's early return.

**Given (Java):**

```java
for (Order o : orders) {
    if (!o.isCancelled()) {
        if (o.total() > 0) {
            ledger.record(o);
        }
    }
}
```

<details><summary>Solution</summary>

### Java
```java
for (Order o : orders) {
    if (o.isCancelled()) continue;
    if (o.total() <= 0)  continue;
    ledger.record(o);
}
```

### Python
```python
for o in orders:
    if o.cancelled:  continue
    if o.total <= 0: continue
    ledger.record(o)
```

### Go
```go
for _, o := range orders {
    if o.Cancelled { continue }
    if o.Total <= 0 { continue }
    ledger.Record(o)
}
```

**Why:** `continue` skips the iteration the same way `return` skips the function. The loop body stays flat.
</details>

---

## Task 7: Throw vs Return-Default

**Goal:** Decide, per case, whether a guard should throw (caller error) or return a default (expected edge). Implement both correctly.

**Spec:** `discount(user)` — a *missing* user is an expected edge (return 0). A user with a *null tier* is a data-integrity bug (throw).

<details><summary>Solution</summary>

### Python
```python
def discount(user):
    if user is None:
        return 0.0                       # expected edge → default
    if user.tier is None:
        raise ValueError("user has no tier")  # invariant broken → throw
    return user.tier.rate
```

### Java
```java
double discount(User user) {
    if (user == null) return 0.0;                        // expected → default
    if (user.tier() == null)
        throw new IllegalStateException("user has no tier"); // bug → throw
    return user.tier().rate();
}
```

### Go
```go
func discount(user *User) (float64, error) {
    if user == nil {
        return 0.0, nil                  // expected edge → zero, no error
    }
    if user.Tier == nil {
        return 0, errors.New("user has no tier") // invariant broken → error
    }
    return user.Tier.Rate, nil
}
```

**Why:** The guard's *response* encodes intent. "No user" is normal; "user without a tier" should never happen and must surface loudly.
</details>

---

## Task 8: Order the Guards

**Goal:** Reorder guards so each may safely assume the ones above passed (existence → shape → value). The given code dereferences before checking for null.

**Given (Python) — buggy order:**

```python
def first_item_name(order):
    if order.items[0].name == "":       # dereferences before null/empty checks!
        raise ValueError("blank name")
    if order is None:
        raise ValueError("no order")
    if not order.items:
        raise ValueError("empty order")
    return order.items[0].name
```

<details><summary>Solution</summary>

### Python
```python
def first_item_name(order):
    if order is None:            raise ValueError("no order")     # existence
    if not order.items:          raise ValueError("empty order")  # shape
    if order.items[0].name == "":raise ValueError("blank name")   # value
    return order.items[0].name
```

### Java
```java
String firstItemName(Order order) {
    if (order == null)               throw new IllegalArgumentException("no order");
    if (order.items().isEmpty())     throw new IllegalArgumentException("empty order");
    if (order.items().get(0).name().isBlank())
                                     throw new IllegalArgumentException("blank name");
    return order.items().get(0).name();
}
```

### Go
```go
func firstItemName(order *Order) (string, error) {
    if order == nil           { return "", errors.New("no order") }
    if len(order.Items) == 0  { return "", errors.New("empty order") }
    if order.Items[0].Name == "" { return "", errors.New("blank name") }
    return order.Items[0].Name, nil
}
```

**Why:** Existence before shape before value. The value guard can dereference safely only because the existence and shape guards ran first.
</details>

---

## Task 9: Push the Guard into a Type

**Goal:** A raw value is guarded in many functions. Parse it once into a type so downstream code needs no guard ("parse, don't validate").

**Given (Java) — every function re-checks the percentage:**

```java
void setOpacity(double pct) {
    if (pct < 0 || pct > 100) throw new IllegalArgumentException();
    // ...
}
void setVolume(double pct) {
    if (pct < 0 || pct > 100) throw new IllegalArgumentException();  // duplicated
    // ...
}
```

<details><summary>Solution</summary>

### Java
```java
record Percentage(double value) {
    Percentage {                                   // guard fires ONCE, at construction
        if (value < 0 || value > 100)
            throw new IllegalArgumentException("percentage 0..100, got " + value);
    }
}
void setOpacity(Percentage pct) { /* no guard — type guarantees validity */ }
void setVolume(Percentage pct)  { /* no guard */ }
```

### Python
```python
from dataclasses import dataclass

@dataclass(frozen=True)
class Percentage:
    value: float
    def __post_init__(self):
        if not (0 <= self.value <= 100):
            raise ValueError(f"percentage 0..100, got {self.value}")

def set_opacity(pct: Percentage): ...   # no guard
def set_volume(pct: Percentage):  ...   # no guard
```

### Go
```go
type Percentage struct{ value float64 }

func NewPercentage(v float64) (Percentage, error) {
    if v < 0 || v > 100 {
        return Percentage{}, fmt.Errorf("percentage 0..100, got %v", v)
    }
    return Percentage{v}, nil
}
func setOpacity(p Percentage) { /* no guard */ }
func setVolume(p Percentage)  { /* no guard */ }
```

**Why:** The best guard is the one a type makes unnecessary. One constructor check replaces N scattered guards, and the compiler enforces validity at every call site.
</details>

---

## Task 10: Split an Over-Guarded Function

**Goal:** A function with 7 guards spanning multiple subsystems is doing too much. Split it so each function trusts validated inputs.

**Given (Python) — too many responsibilities:**

```python
def submit(order, user, inventory, payment):
    if order is None:                raise ValueError("order")
    if not order.items:              raise ValueError("items")
    if user is None:                 raise ValueError("user")
    if not user.verified:            raise PermissionError("unverified")
    if not inventory.has(order.items): raise ValueError("out of stock")
    if payment is None:              raise ValueError("payment")
    if payment.declined:             raise PaymentError("declined")
    return place(order, user, payment)
```

<details><summary>Solution</summary>

### Python
```python
def validate_order(order):
    if order is None:   raise ValueError("order")
    if not order.items: raise ValueError("items")

def validate_user(user):
    if user is None:      raise ValueError("user")
    if not user.verified: raise PermissionError("unverified")

def validate_payment(payment):
    if payment is None:   raise ValueError("payment")
    if payment.declined:  raise PaymentError("declined")

def submit(order, user, inventory, payment):
    validate_order(order)
    validate_user(user)
    validate_payment(payment)
    if not inventory.has(order.items):
        raise ValueError("out of stock")
    return place(order, user, payment)        # orchestration only
```

**Even better:** push `validate_*` to each subsystem's boundary so `submit` receives already-valid `Order`, `User`, `Payment` *types* and contains zero validation guards — only the cross-cutting inventory check and the orchestration.

**Why:** Guard count is a responsibility budget. When it's exceeded, the answer is fewer responsibilities (split + move validation to owners), not more guards.
</details>

---

## Practice Tips

1. **Always end a guard with an exit** — `return`/`throw`/`continue`/`break`. A logging-only guard is a bug.
2. **Guard before you mutate.** Never leave partial state behind a failed check.
3. **Order: existence → shape → value.** Each guard assumes the ones above passed.
4. **Bind cleanup to scope** (`defer`/`finally`/`with`) so early returns can't leak.
5. **Throw for caller errors; return a default only for expected edges.**
6. **When guards pile up, split the function** and consider pushing validation into a type.

---

[← Interview](interview.md) · [Control-Flow](../README.md) · [Roadmap](../../../README.md) · **Next:** [Find-Bug](find-bug.md)
