# Composing Methods — Find the Bug

> 12 snippets where a Composing Methods refactoring was applied **incorrectly** — the result *looks* refactored but breaks behavior, breaks performance, or introduces a subtle bug. Find the issue and fix it.

---

## Bug 1 — Extract Method that captures the wrong scope (Java)

**Original:**

```java
class Cart {
    private List<Item> items;
    private double discountRate;

    double total() {
        double sum = 0;
        for (Item i : items) sum += i.price();
        return sum * (1 - discountRate);
    }
}
```

**"Refactored":**

```java
class Cart {
    private List<Item> items;
    private double discountRate;

    double total() {
        return sum() * (1 - discountRate);
    }

    private static double sum() {
        double s = 0;
        for (Item i : items) s += i.price();   // ❌
        return s;
    }
}
```

<details><summary>Bug</summary>

`sum()` was made `static`. A static method can't access the instance field `items` — won't compile. The IDE wouldn't have made this mistake; a hand-typed extract did.

**Fix:** Remove `static`.

```java
private double sum() {
    double s = 0;
    for (Item i : items) s += i.price();
    return s;
}
```
</details>

---

## Bug 2 — Replace Temp with Query that double-counts side effects (Java)

**Original:**

```java
double saleTax(Order o) {
    double base = o.subtotal();        // pure
    double tax = base * o.taxRate();
    auditLog(o);                       // side effect
    return base + tax;
}
```

**"Refactored":**

```java
double saleTax(Order o) {
    return base(o) + base(o) * o.taxRate();
}

private double base(Order o) {
    auditLog(o);                       // ❌ moved into query
    return o.subtotal();
}
```

<details><summary>Bug</summary>

`base()` is called twice in `saleTax`, so `auditLog(o)` fires twice. The audit log was a side effect that belonged in the orchestrator, not in a "query."

**Fix:** A query method must be pure. Keep `auditLog(o)` outside.

```java
double saleTax(Order o) {
    auditLog(o);
    return base(o) + base(o) * o.taxRate();
}

private double base(Order o) { return o.subtotal(); }
```

Or cache once:

```java
double saleTax(Order o) {
    auditLog(o);
    double b = o.subtotal();
    return b + b * o.taxRate();
}
```
</details>

---

## Bug 3 — Inline Method that breaks polymorphism (Java)

**Original:**

```java
abstract class Shape {
    abstract double area();
}
class Square extends Shape {
    private double side;
    @Override double area() { return side * side; }
}
```

Caller:
```java
double totalArea(List<Shape> shapes) {
    double t = 0;
    for (Shape s : shapes) t += s.area();
    return t;
}
```

**"Refactored":**

```java
double totalArea(List<Shape> shapes) {
    double t = 0;
    for (Shape s : shapes) t += ((Square) s).side * ((Square) s).side;   // ❌
    return t;
}
```

<details><summary>Bug</summary>

Inlining inlined the `Square` implementation into the caller — but the loop receives `Shape`s, which may be `Circle`, `Triangle`, etc. The cast will throw `ClassCastException` for any non-Square.

**Fix:** Don't inline polymorphic methods. Revert.
</details>

---

## Bug 4 — Split Temporary Variable that drops a use (Python)

**Original:**

```python
def calc(h, w):
    temp = 2 * (h + w)
    print("perimeter", temp)
    temp = h * w
    print("area", temp)
    return temp + 1
```

**"Refactored":**

```python
def calc(h, w):
    perimeter = 2 * (h + w)
    print("perimeter", perimeter)
    area = h * w
    print("area", area)
    return perimeter + 1   # ❌
```

<details><summary>Bug</summary>

The original returned `temp + 1` after `temp` was reassigned to `area`. So the original returned `area + 1`, not `perimeter + 1`. The refactor changed behavior.

**Fix:**

```python
def calc(h, w):
    perimeter = 2 * (h + w)
    print("perimeter", perimeter)
    area = h * w
    print("area", area)
    return area + 1
```

Lesson: When splitting a reassigned variable, *every* reference must be re-pointed to the *correct* split target.
</details>

---

## Bug 5 — Method Object loses callsite context (Java)

**Original:**

```java
class Account {
    int gamma(int iv, int q, int ytd) {
        return (iv * q) + (iv * ytd) + 100;
    }
}
```

**"Refactored":**

```java
class Gamma {
    private int iv, q, ytd;   // ❌ default 0
    int compute() {
        return (iv * q) + (iv * ytd) + 100;
    }
}

class Account {
    int gamma(int iv, int q, int ytd) {
        return new Gamma().compute();   // ❌ never set fields
    }
}
```

<details><summary>Bug</summary>

The Method Object was constructed without arguments — the fields are all zero. The result is always `100`.

**Fix:** Pass via constructor.

```java
class Gamma {
    private final int iv, q, ytd;
    Gamma(int iv, int q, int ytd) { this.iv = iv; this.q = q; this.ytd = ytd; }
    int compute() { return (iv * q) + (iv * ytd) + 100; }
}

class Account {
    int gamma(int iv, int q, int ytd) {
        return new Gamma(iv, q, ytd).compute();
    }
}
```
</details>

---

## Bug 6 — Substitute Algorithm with edge case (Go)

**Original:**

```go
func MaxItem(xs []int) int {
    m := xs[0]
    for _, x := range xs[1:] {
        if x > m { m = x }
    }
    return m
}
```

**"Refactored":**

```go
func MaxItem(xs []int) int {
    return slices.Max(xs)
}
```

<details><summary>Bug</summary>

`slices.Max` panics on an empty slice — same as the original would (`xs[0]` panics). But the *test suite* may have set the contract that empty returns `0`. If that was a tacit invariant, the substitute changed observable behavior under contract.

**Fix:** Check the contract.

```go
func MaxItem(xs []int) int {
    if len(xs) == 0 { return 0 }
    return slices.Max(xs)
}
```

Or document explicitly that empty is undefined.

Lesson: Substitute Algorithm must preserve **observable behavior**, including edge-case returns and panics.
</details>

---

## Bug 7 — Extract Variable that recomputes a side-effecting expression (Python)

**Original:**

```python
def assign_id(record, gen):
    if not record.id:
        record.id = gen.next_id()
    return record.id
```

**"Refactored":**

```python
def assign_id(record, gen):
    new_id = gen.next_id()             # ❌ called even when id exists
    if not record.id:
        record.id = new_id
    return record.id
```

<details><summary>Bug</summary>

The "extracted variable" `new_id = gen.next_id()` runs *before* the `if`, consuming a fresh ID even when one already exists. The id-generator's counter advances incorrectly.

**Fix:** Don't extract a variable for an expression with side effects until the conditional clears.

```python
def assign_id(record, gen):
    if not record.id:
        record.id = gen.next_id()
    return record.id
```
</details>

---

## Bug 8 — Inline Temp where the temp had a type assertion (TypeScript)

**Original:**

```ts
function area(s: Shape) {
  const sq = s as Square;
  return sq.side * sq.side;
}
```

**"Refactored":**

```ts
function area(s: Shape) {
  return s.side * s.side;   // ❌ Property 'side' does not exist on type 'Shape'
}
```

<details><summary>Bug</summary>

The temp `sq` was a TypeScript narrowing — the cast `as Square` told the compiler to treat the value as a Square. Inlining drops the cast and the code no longer compiles.

**Fix:** Keep the cast inline.

```ts
function area(s: Shape) {
  return (s as Square).side * (s as Square).side;
}
```

Or even better, narrow with a type guard:

```ts
function area(s: Shape) {
  if (s.kind !== "square") throw new Error("Expected square");
  return s.side * s.side;
}
```
</details>

---

## Bug 9 — Extract Method that introduces NPE (Java)

**Original:**

```java
String fullDisplay(Customer c) {
    if (c == null) return "guest";
    return c.firstName() + " " + c.lastName();
}
```

**"Refactored":**

```java
String fullDisplay(Customer c) {
    if (c == null) return "guest";
    return formatName(c);
}

private String formatName(Customer c) {
    return c.firstName().toUpperCase() + " " + c.lastName().toUpperCase();   // ❌
}
```

<details><summary>Bug</summary>

The "extraction" wasn't a pure extraction — the developer added `.toUpperCase()` calls that change behavior. Also, `c.firstName()` may return null, and now `.toUpperCase()` will NPE.

**Fix:** Extract first (behavior-preserving), then add `.toUpperCase()` as a separate change with tests.

```java
private String formatName(Customer c) {
    return c.firstName() + " " + c.lastName();
}
```

Lesson: a refactoring is **behavior-preserving by definition**. If you change behavior in the same step, it's not a refactor.
</details>

---

## Bug 10 — Replace Temp with Query that adds a query loop (Python)

**Original:**

```python
def total(items):
    sub = sum(i.price * i.qty for i in items)
    if sub > 100: return sub * 0.9
    return sub
```

**"Refactored":**

```python
def total(items):
    if subtotal(items) > 100: return subtotal(items) * 0.9
    return subtotal(items)

def subtotal(items):
    return sum(i.price * i.qty for i in items)   # ❌ called 3×
```

<details><summary>Bug</summary>

`subtotal(items)` is called three times. For 100 items × 3 calls = 300 multiplications instead of 100. For a tight per-request hot path, this is a real regression.

**Fix:** Cache once.

```python
def total(items):
    sub = subtotal(items)
    if sub > 100: return sub * 0.9
    return sub
```

The query is reusable from elsewhere; the orchestrator caches.
</details>

---

## Bug 11 — Remove Assignments to Parameters that breaks a returned value (Java)

**Original:**

```java
String prefix(String s, int n) {
    if (s.length() <= n) return s;
    s = s.substring(0, n) + "...";
    return s;
}
```

**"Refactored":**

```java
String prefix(String s, int n) {
    String result = s;
    if (s.length() <= n) return s;
    result = s.substring(0, n) + "...";
    return s;   // ❌
}
```

<details><summary>Bug</summary>

After introducing `result`, the assignment correctly went to `result`, but the final return still says `return s` — the original (unchanged) input.

**Fix:** Return the right variable.

```java
String prefix(String s, int n) {
    if (s.length() <= n) return s;
    return s.substring(0, n) + "...";
}
```

Or, if you really want the temp:

```java
String prefix(String s, int n) {
    String result = s;
    if (s.length() > n) result = s.substring(0, n) + "...";
    return result;
}
```
</details>

---

## Bug 12 — Extract Method that obscures a `return` (Go)

**Original:**

```go
func ProcessPayment(p Payment) error {
    if p.Amount <= 0 {
        return fmt.Errorf("invalid amount")
    }
    if !p.Card.IsValid() {
        return fmt.Errorf("invalid card")
    }
    // ... charge logic ...
    return nil
}
```

**"Refactored":**

```go
func ProcessPayment(p Payment) error {
    validate(p)   // ❌
    // ... charge logic ...
    return nil
}

func validate(p Payment) error {
    if p.Amount <= 0 { return fmt.Errorf("invalid amount") }
    if !p.Card.IsValid() { return fmt.Errorf("invalid card") }
    return nil
}
```

<details><summary>Bug</summary>

The error returned by `validate` is **discarded** — Go's compiler may not even warn (depends on lint settings). Validation now passes silently and the charge proceeds on invalid input.

**Fix:** Propagate.

```go
func ProcessPayment(p Payment) error {
    if err := validate(p); err != nil {
        return err
    }
    // ... charge logic ...
    return nil
}
```

Lesson: Extracting a method that returns an error means callers must handle the return value. The compiler can't always remind you.
</details>

---

## Common patterns

| Bug | Root cause |
|---|---|
| Static helper, instance field | Hand-typed extract didn't pull `this` |
| Side effect in "query" | Query must be pure |
| Inline polymorphic | Can't inline runtime dispatch |
| Split variable, missed reference | Need to update *all* uses |
| Method Object missing constructor | Fields default to zero |
| Algorithm substitute, edge case | Observable behavior includes edges |
| Extracted call discards return | Especially for `error` / `Result` |

---

## Next

- Optimize: [optimize.md](optimize.md)
- Practice clean refactors: [tasks.md](tasks.md)
- Review: [interview.md](interview.md)
