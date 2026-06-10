# Self-Encapsulation — Find the Bug

> **Category:** [Object & State Patterns](../README.md) — broken seams, leaked raw access, and the classic constructor/laziness traps.

10 buggy snippets across Go, Java, and Python.

---

## Bug 1: Inconsistent Routing (Java)

```java
class Order {
    private double total;
    double getTotal() { return total; }
    double withTax()      { return getTotal() * 1.2; }
    double withDiscount() { return total * 0.9; }   // BUG: raw field
}
```

**Symptoms:** Today nothing breaks. The day `getTotal()` becomes computed (sum of line items), `withDiscount()` silently uses a stale/zero raw field while `withTax()` is correct.

<details><summary>Find the bug</summary>

`withDiscount` bypasses the accessor. The seam is half-built, so a later representation change splits the class into correct and broken methods.

</details>

### Fix

```java
double withDiscount() { return getTotal() * 0.9; }
```

### Lesson

Self-encapsulation only works if it is **total**. One raw read defeats the seam.

---

## Bug 2: Overridable Setter in Constructor (Java)

```java
class Base {
    private int x;
    Base() { setX(10); }                 // BUG: overridable call in ctor
    void setX(int v) { this.x = v; }
    int getX() { return x; }
}
class Derived extends Base {
    private int doubled = -1;
    @Override void setX(int v) { super.setX(v); doubled = v * 2; }
}
// new Derived().doubled  →  -1, not 20
```

**Symptoms:** `doubled` ends up `-1`. The override ran during `super()`, set `doubled = 20`, then `Derived`'s field initializer `= -1` clobbered it.

<details><summary>Find the bug</summary>

`Base()` calls the **virtual** `setX`, dispatching to `Derived.setX` before `Derived`'s field initializers run. Order: override writes `doubled=20`, then field init writes `doubled=-1`.

</details>

### Fix

```java
Base(int x) { this.x = x; }              // set raw field, no virtual call
// or
final void setX(int v) { this.x = v; }   // make it non-overridable
```

### Lesson

Never call an overridable accessor from a constructor in Java/C#. Set the raw field or make it `final`.

---

## Bug 3: Lazy Getter Race (Go)

```go
type Cache struct{ data map[string]string }
func (c *Cache) Data() map[string]string {
    if c.data == nil {
        c.data = loadFromDisk()   // BUG: not safe under concurrent access
    }
    return c.data
}
```

**Symptoms:** Under load, two goroutines both see `nil`, both call `loadFromDisk`, and one result is discarded — or worse, a concurrent map write panics. `go test -race` flags it.

<details><summary>Find the bug</summary>

The check-then-set in the self-encapsulated getter is a data race. Self-encapsulation localized the laziness but didn't synchronize it.

</details>

### Fix

```go
type Cache struct {
    once sync.Once
    data map[string]string
}
func (c *Cache) Data() map[string]string {
    c.once.Do(func() { c.data = loadFromDisk() })
    return c.data
}
```

### Lesson

The lazy seam is one place to add synchronization — but you must actually add it.

---

## Bug 4: Setter Silently "Fixes" Bad Input (Python)

```python
class Volume:
    @property
    def level(self) -> int:
        return self._level

    @level.setter
    def level(self, v: int) -> None:
        self._level = max(0, min(100, v))   # BUG: clamps silently
```

**Symptoms:** `vol.level = 5000` succeeds and silently becomes `100`. A bug elsewhere (computing 5000) is hidden; the system carries on with quietly wrong data.

<details><summary>Find the bug</summary>

The setter masks invalid input instead of rejecting it. Self-encapsulation gave you one place to enforce the invariant — and it's enforcing the wrong policy (clamp, not validate).

</details>

### Fix

```python
@level.setter
def level(self, v: int) -> None:
    if not 0 <= v <= 100:
        raise ValueError(f"0..100, got {v}")
    self._level = v
```

### Lesson

A validating setter should fail loudly. Silent clamping turns the seam into a bug-concealer.

---

## Bug 5: Java-Style Getters in Python (Python)

```python
class Point:
    def __init__(self, x, y):
        self._x = x
        self._y = y
    def get_x(self): return self._x
    def set_x(self, v): self._x = v
    def get_y(self): return self._y
    def set_y(self, v): self._y = v
```

**Symptoms:** Not a runtime bug — a design bug. Callers must write `p.get_x()` and `p.set_x(3)`; the code is un-Pythonic, and there's no validation to justify the ceremony.

<details><summary>Find the bug</summary>

Eager getters/setters with no behavior. Python's `@property` makes the upgrade free, so you start with plain attributes and add a property only when a real need appears.

</details>

### Fix

```python
class Point:
    def __init__(self, x, y):
        self.x = x          # plain attributes
        self.y = y
# Upgrade to @property later, ONLY if validation/computation is needed.
```

### Lesson

Self-encapsulation in Python is *deferred*, not eager. Up-front getters are an anti-idiom.

---

## Bug 6: equals/hashCode Disagree with Accessor (Java)

```java
final class Money {
    private long cents;
    long getAmount() { return cents / 1; }    // imagine this later rounds/derives
    @Override public boolean equals(Object o) {
        return o instanceof Money m && m.cents == this.cents;  // BUG: raw field
    }
    @Override public int hashCode() { return Long.hashCode(cents); } // raw field
}
```

**Symptoms:** When `getAmount()` becomes a *derived* value (e.g., rounded to the nearest cent), two `Money` objects that are *equal by amount* compare unequal by `cents`, breaking `HashMap`/`Set` membership.

<details><summary>Find the bug</summary>

`equals`/`hashCode` read the raw field while the rest of the API reads the derived accessor. They sit on opposite sides of the seam and drift apart.

</details>

### Fix

```java
@Override public boolean equals(Object o) {
    return o instanceof Money m && m.getAmount() == this.getAmount();
}
@Override public int hashCode() { return Long.hashCode(getAmount()); }
```

### Lesson

Keep identity logic on the same side of the seam as everything else.

---

## Bug 7: Getter With Hidden I/O Named Like a Field (Java)

```java
class User {
    private List<Order> orders;
    List<Order> getOrders() {
        if (orders == null) orders = db.queryOrders(id);  // hits DB
        return orders;
    }
}

// Caller, in a loop:
for (User u : users) {
    if (!u.getOrders().isEmpty()) ...   // BUG: N database round-trips
}
```

**Symptoms:** An innocent-looking `getOrders()` triggers one DB query per user — a classic N+1.

<details><summary>Find the bug</summary>

The self-encapsulated lazy getter does expensive I/O but is *named* like a trivial field read, so callers loop over it freely.

</details>

### Fix

```java
List<Order> loadOrders() { ... }   // name signals cost
// or eagerly batch-load orders for all users once
```

### Lesson

A lazy/computed accessor that does real work should be named for its cost, not disguised as a getter.

---

## Bug 8: cached_property on Mutating State (Python)

```python
from functools import cached_property

class Order:
    def __init__(self, items):
        self._items = items
    @cached_property
    def total(self) -> float:
        return sum(self._items)     # BUG: cached, but items can change

o = Order([10, 20])
print(o.total)        # 30  (cached)
o._items.append(50)
print(o.total)        # 30  (STALE — cache never invalidated)
```

**Symptoms:** `total` stays `30` after items change. The cached "field" is stale.

<details><summary>Find the bug</summary>

`cached_property` stores the first result permanently. Using it on state that mutates produces a stale derived value — the seam computed once and froze.

</details>

### Fix

```python
@property
def total(self) -> float:           # recompute each read
    return sum(self._items)
# or keep cached_property but make _items immutable and never mutate in place
```

### Lesson

Caching behind an accessor is only safe when the inputs don't change after first read.

---

## Bug 9: Exporting a Go Field You'll Want to Compute Later (Go)

```go
package billing

type Invoice struct {
    Total float64   // BUG: exported field — locks the representation
}

// Across the codebase:
fmt.Println(inv.Total)
```

**Symptoms:** Later you need `Total` to be a live sum of line items. You can't — making it a method `Total()` breaks every `inv.Total` call site, because Go has no Uniform Access.

<details><summary>Find the bug</summary>

An exported struct field is a hard API contract in Go. There's no transparent field→method upgrade, so a value that might become computed should have been a method from the start.

</details>

### Fix

```go
type Invoice struct {
    items []float64   // unexported
}
func (i *Invoice) Total() float64 {   // method from day one
    var s float64
    for _, v := range i.items { s += v }
    return s
}
```

### Lesson

In Go, decide field-vs-method at the API boundary. Anything that might become computed is a method up front.

---

## Bug 10: "Self-Encapsulation" Producing an Anemic Object (Java)

```java
class Customer {
    private String name; private String tier; private double balance;
    public String getName() { return name; }   public void setName(String n){ name=n; }
    public String getTier() { return tier; }   public void setTier(String t){ tier=t; }
    public double getBalance(){ return balance;} public void setBalance(double b){ balance=b; }
    // ...no behavior at all
}

// Behavior leaks into a service:
class BillingService {
    double discount(Customer c) {
        return c.getTier().equals("gold") ? c.getBalance() * 0.1 : 0;  // BUG: logic outside the object
    }
}
```

**Symptoms:** The "encapsulated" `Customer` is a bag of accessors; all real logic lives in services. This is an [Anemic Domain Model](../../anti-patterns/02-design/01-oo-misuse/junior.md), not encapsulation.

<details><summary>Find the bug</summary>

Wrapping every field in get/set is not self-encapsulation's goal. The object has data and no behavior; the seam exists but nothing meaningful sits behind it.

</details>

### Fix

```java
class Customer {
    private final String tier; private final double balance;
    double discount() {                     // behavior on the object
        return "gold".equals(tier) ? getBalance() * 0.1 : 0;
    }
    private double getBalance() { return balance; }
}
```

### Lesson

Self-encapsulation is internal plumbing for *behavior-rich* objects. Getters without behavior are an anemic model in disguise.

---

## Practice Tips

1. **Run `go test -race`** on any lazy Go accessor.
2. **Grep for raw field reads** inside a self-encapsulated class — routing must be total.
3. **Audit constructors** for calls to overridable setters.
4. **Name expensive accessors** for their cost (`load*`, `compute*`).
5. **Re-derive cached fields** when inputs can mutate.

---

[← Tasks](tasks.md) · [Object & State](../README.md) · **Next:** [Optimize](optimize.md)
