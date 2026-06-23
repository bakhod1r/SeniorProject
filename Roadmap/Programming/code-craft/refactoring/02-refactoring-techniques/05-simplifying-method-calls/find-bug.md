# Simplifying Method Calls — Find the Bug

> 12 wrong refactors.

---

## Bug 1 — Rename Method but missed a reflection call (Java)

**Original:**
```java
public Money getCharge() { ... }
// Reflection caller:
Method m = c.getClass().getMethod("getCharge");
```

**"Refactored":**
```java
public Money totalIncludingTax() { ... }
// Reflection caller still says "getCharge" — runtime NoSuchMethodError
```

<details><summary>Bug</summary>

IDE rename doesn't update string-based reflection or Spring SpEL or framework annotations.

**Fix:** Search the codebase for the old name as a string. Update all references including configuration, JSON keys, etc.
</details>

---

## Bug 2 — Add Parameter without updating overrides (Java)

```java
abstract class Validator { abstract boolean validate(Order o); }
class StrictValidator extends Validator { boolean validate(Order o) { ... } }
```

Refactor base: `boolean validate(Order o, Context ctx)`.

But `StrictValidator.validate(o)` no longer overrides — it's a different signature. Compile error or hidden bug if no `@Override`.

<details><summary>Bug</summary>

When changing an abstract method, every subclass must update. IDE refactoring usually handles this; manual edits don't.

**Fix:** Always use `@Override` annotation. The compiler then complains.
</details>

---

## Bug 3 — Separate Query from Modifier breaks atomicity (Java)

**Original:**
```java
synchronized String getTotalAndSetReady() {
    String t = computeTotal();
    readyForSummary = true;
    return t;
}
```

**"Refactored":**
```java
String getTotal() { return computeTotal(); }
void setReady() { readyForSummary = true; }
```

Caller now does `s.getTotal(); s.setReady();` — without synchronization, race condition if another thread is between.

<details><summary>Bug</summary>

The original was atomic; the refactor isn't.

**Fix:** Either keep the combined method, or document that callers must serialize, or take a coarser lock at the caller.

Lesson: separating Query from Modifier can break atomicity invariants.
</details>

---

## Bug 4 — Introduce Parameter Object reorders construction (Python)

**Original:**
```python
def overlaps(start_a, end_a, start_b, end_b): ...
overlaps(jan1, jan31, feb1, feb28)
```

**"Refactored":**
```python
@dataclass
class DateRange:
    start: date
    end: date

def overlaps(a: DateRange, b: DateRange): ...

overlaps(DateRange(jan1, feb1), DateRange(jan31, feb28))   # ❌ wrong dates
```

<details><summary>Bug</summary>

Caller mistakenly grouped `(start_a, start_b)` together rather than `(start_a, end_a)` together.

**Fix:** Group by *meaning* (range A's bounds together).

```python
overlaps(DateRange(jan1, jan31), DateRange(feb1, feb28))
```

Lesson: the parameter object's meaning must align with the caller's mental model.
</details>

---

## Bug 5 — Replace Constructor with Factory Method but caller serialization (Java)

**Original:**
```java
public class Order {
    public Order(String id, ...) { ... }
}
// Jackson reads JSON → calls constructor.
```

**"Refactored":**
```java
public class Order {
    private Order(String id, ...) { ... }   // private
    public static Order of(String id, ...) { ... }
}
```

Jackson can't deserialize — no public constructor.

<details><summary>Bug</summary>

Many serialization libraries require a public no-arg or annotated constructor.

**Fix:**
```java
public class Order {
    @JsonCreator
    Order(@JsonProperty("id") String id, ...) { ... }   // package-private
    public static Order of(String id, ...) { ... }
}
```

Or use Jackson's `@JsonCreator` on the factory method:
```java
@JsonCreator
public static Order of(...) { ... }
```
</details>

---

## Bug 6 — Replace Error Code with Exception in Go (Go)

```go
// Original:
func Withdraw(amount float64) int {
    if amount > balance { return -1 }
    balance -= amount
    return 0
}

// "Refactored":
func Withdraw(amount float64) {
    if amount > balance { panic("insufficient") }   // ❌
    balance -= amount
}
```

<details><summary>Bug</summary>

Go convention is to return errors, not panic. `panic` is for unrecoverable programming errors.

**Fix:**
```go
func Withdraw(amount float64) error {
    if amount > balance { return ErrInsufficientFunds }
    balance -= amount
    return nil
}
```

Lesson: each language has its own idiom for failure reporting; don't blindly translate.
</details>

---

## Bug 7 — Hide Method but tests still need it (Java)

**Original:**
```java
public class Calculator {
    public double internalRound(double v) { ... }
}
```

Tests:
```java
@Test void testRound() { assertEquals(2.0, calc.internalRound(2.4)); }
```

**"Refactored":** make `internalRound` private. Tests fail to compile.

<details><summary>Bug</summary>

Hiding a method that has tests breaks tests.

**Fix options:**
1. Test through public interface only (preferred — tests aren't tied to internals).
2. Use package-private + same-package tests (Maven/Gradle conventions).
3. Use `@VisibleForTesting` annotation on a package-private method.

Lesson: hide aggressively, but consider test seams.
</details>

---

## Bug 8 — Preserve Whole Object causes circular dependency (Java)

**Original:**
```java
class Plan {
    boolean withinRange(double low, double high) { ... }
}
```

**"Refactored":**
```java
class Plan {
    boolean withinRange(TempRange tr) { return tr.getLow() ... }   // Plan now depends on TempRange
}
```

If TempRange already depended on Plan (e.g., `TempRange.fitsPlan(Plan p)`), you've created a cycle.

<details><summary>Bug</summary>

Mutual dependency between Plan and TempRange.

**Fix:** Either break the original direction, or pass primitives still.

Lesson: Preserve Whole Object adds a dependency edge — check the graph before making the change.
</details>

---

## Bug 9 — Replace Parameter with Method Call calls expensive method (Java)

**Original:**
```java
double tax(double base, double rate) { return base * rate; }
double total(Order o) {
    double base = o.subtotal();
    double rate = lookupRateExpensive(o.country());
    return base + tax(base, rate);
}
```

**"Refactored":**
```java
double tax(double base) { return base * lookupRateExpensive(country()); }
double total(Order o) {
    double base = o.subtotal();
    return base + tax(base);
}
```

<details><summary>Bug</summary>

`lookupRateExpensive` is now hidden inside `tax()`. If `total()` calls `tax()` more than once, the expensive lookup happens repeatedly.

**Fix:** Cache or memoize. Or keep the parameter explicit:

```java
double tax(double base, double rate) { return base * rate; }
double total(Order o) {
    double rate = lookupRateExpensive(o.country());   // cached
    return o.subtotal() + tax(o.subtotal(), rate);
}
```
</details>

---

## Bug 10 — Encapsulate Downcast hides a real type mismatch (Java)

**Original:**
```java
Object o = readings.last();
if (o instanceof Reading) {
    Reading r = (Reading) o;
    process(r);
} else {
    log.warn("unexpected type: " + o.getClass());
}
```

**"Refactored":**
```java
public Reading lastReading() { return (Reading) readings.last(); }   // ❌ throws ClassCastException
```

<details><summary>Bug</summary>

The original handled the non-Reading case. The refactor throws ClassCastException for the same input.

**Fix:** Either ensure the cast is always safe, or return Optional:

```java
public Optional<Reading> lastReading() {
    Object o = readings.last();
    return o instanceof Reading r ? Optional.of(r) : Optional.empty();
}
```
</details>

---

## Bug 11 — Builder allows invalid state (Java)

```java
public class HttpRequest {
    public static class Builder {
        private String url;
        private String method;
        public Builder url(String u) { this.url = u; return this; }
        public Builder method(String m) { this.method = m; return this; }
        public HttpRequest build() { return new HttpRequest(url, method); }
    }
}

new HttpRequest.Builder().build();   // ❌ url is null, method is null
```

<details><summary>Bug</summary>

Builder doesn't validate; you can construct an invalid request.

**Fix:** Validate in `build()`:

```java
public HttpRequest build() {
    Objects.requireNonNull(url, "url required");
    if (method == null) method = "GET";   // sensible default
    return new HttpRequest(url, method);
}
```

Or use a typed builder progression:
```java
new HttpRequestBuilder().url(...).method(...).build();   // each step returns next-state builder
```
</details>

---

## Bug 12 — Replace Exception with Test introduces TOCTOU (Java)

**Original:**
```java
try {
    return cache.get(key);
} catch (NotFoundException e) {
    return loadAndCache(key);
}
```

**"Refactored":**
```java
if (!cache.contains(key)) {
    return loadAndCache(key);
}
return cache.get(key);   // ❌ TOCTOU race
```

<details><summary>Bug</summary>

Time-of-check to time-of-use: between `contains` and `get`, another thread could evict the entry. `get` then throws.

**Fix:** Atomic operation:

```java
return cache.get(key, k -> loadAndCache(k));   // computeIfAbsent pattern
```

Lesson: Replace Exception with Test must preserve atomicity. Use atomic APIs (computeIfAbsent, ConcurrentMap).
</details>

---

## Patterns

| Bug | Root cause |
|---|---|
| Reflection-based caller missed | IDE rename limited |
| Subclass override broken | No @Override annotation |
| Atomic operation split | Lost synchronization |
| Param object grouping wrong | Misaligned with mental model |
| Constructor private breaks deser | Need @JsonCreator |
| Wrong-language idiom | panic vs. error |
| Hidden method fails test | No test seam |
| Circular dep | Preserve Whole adds edge |
| Hidden expensive call | Replace Parameter calls more often |
| Encapsulated cast removed type guard | Lost null/type check |
| Invalid state in builder | No validation in build() |
| TOCTOU race | Atomicity lost in test-then-act |

---

## Next

- [optimize.md](optimize.md), [tasks.md](tasks.md), [interview.md](interview.md)
