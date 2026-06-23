# Composing Methods — Optimize

> 12 cases where a refactoring is **functionally correct** but introduces a subtle performance issue. Identify the cost and propose a fix that preserves clarity.

---

## Optimize 1 — Replace Temp with Query in a hot loop (Java)

**Functionally correct:**

```java
class PriceCalculator {
    private List<Item> items;

    double total() {
        double t = 0;
        for (Item i : items) {
            if (subtotal() > 100) t += i.price() * 0.9;
            else t += i.price();
        }
        return t;
    }

    private double subtotal() {
        double s = 0;
        for (Item i : items) s += i.price();
        return s;
    }
}
```

<details><summary>Cost & Fix</summary>

`subtotal()` is called once per loop iteration — O(N) calls, each O(N) — total **O(N²)** instead of the original O(N).

**Fix:** Compute once outside the loop.

```java
double total() {
    double sub = subtotal();
    boolean discount = sub > 100;
    double t = 0;
    for (Item i : items) t += discount ? i.price() * 0.9 : i.price();
    return t;
}
```

Replace Temp with Query is great for clarity; it can be a perf nightmare in inner loops.
</details>

---

## Optimize 2 — Extract Method that breaks JIT inlining (Java)

```java
double sum(double[] xs) {
    double s = 0;
    for (double x : xs) s += transform(x);
    return s;
}

private double transform(double x) {
    return Math.sqrt(x) + Math.log(x + 1) + Math.exp(-x) + Math.sin(x);
}
```

This was originally:

```java
double sum(double[] xs) {
    double s = 0;
    for (double x : xs) s += Math.sqrt(x) + Math.log(x + 1) + Math.exp(-x) + Math.sin(x);
    return s;
}
```

<details><summary>Cost & Fix</summary>

Extracting `transform` is good for clarity. In hot benchmarks, `transform`'s ~50 bytes is well under HotSpot's inline threshold, so it's inlined. **Usually no perf cost.**

But: if `transform` grows over time to >325 bytes (FreqInlineSize), inlining stops, and the loop suddenly becomes 5–10× slower.

**Fix (preventive):** keep `transform` small. If it must grow, accept that the hot path won't inline it; consider:
- Specializing the helper for the inner loop (`sumWithTransform`).
- Using `@HotSpotIntrinsicCandidate` patterns.
- Verifying with `-XX:+PrintInlining`.

**Verify, don't guess:**

```bash
java -XX:+UnlockDiagnosticVMOptions -XX:+PrintInlining ...
```

Look for `transform inline (hot)` in the output. If you see `transform too big`, the refactor crossed a threshold.
</details>

---

## Optimize 3 — Method Object that escapes (Java)

```java
class Account {
    int gamma(int iv, int q, int ytd) {
        Gamma g = new Gamma(iv, q, ytd);
        cache.put(iv, g);   // ❌ stores reference
        return g.compute();
    }
}
```

<details><summary>Cost & Fix</summary>

By storing `g` in the cache, the JIT can no longer prove `g` doesn't escape the method. **Escape analysis fails**, scalar replacement doesn't apply, every `gamma` call allocates a heap object.

**Fix:** Don't cache the Method Object. Cache the *result*.

```java
class Account {
    int gamma(int iv, int q, int ytd) {
        Integer cached = cache.get(iv);
        if (cached != null) return cached;
        int result = new Gamma(iv, q, ytd).compute();
        cache.put(iv, result);
        return result;
    }
}
```

Now `Gamma` doesn't escape — it's stack-allocatable.
</details>

---

## Optimize 4 — Extract Method introduces interface dispatch (Go)

```go
type Reducer interface {
    Reduce(float64, float64) float64
}

type Sum struct{}
func (Sum) Reduce(a, b float64) float64 { return a + b }

func Total(xs []float64, r Reducer) float64 {
    var t float64
    for _, x := range xs {
        t = r.Reduce(t, x)   // virtual call
    }
    return t
}
```

Original:

```go
func Total(xs []float64) float64 {
    var t float64
    for _, x := range xs { t += x }
    return t
}
```

<details><summary>Cost & Fix</summary>

The "extract for flexibility" added an interface dispatch per iteration. Without PGO, Go can't inline through the interface — every call is an itab lookup.

**Fix options:**
1. **Don't generalize prematurely.** If you have one reducer, don't introduce an interface.
2. **Use generics (Go 1.18+):**

```go
func Total[T any](xs []T, r func(acc, x T) T, zero T) T {
    acc := zero
    for _, x := range xs { acc = r(acc, x) }
    return acc
}
```
The compiler instantiates a specialized version; `r` is a concrete function pointer.

3. **PGO (Go 1.21+):** capture a profile, rebuild — Go can devirtualize hot interface calls.

Lesson: Extract Method that *introduces a polymorphism boundary* in a hot loop pays a per-call cost.
</details>

---

## Optimize 5 — Inline Method that bloats a hot caller (Java)

```java
double process(double[] xs, double[] ys) {
    double s = 0;
    for (int i = 0; i < xs.length; i++) {
        // inlined fragment from the formerly-called combiner:
        double a = xs[i] * 2 + 1;
        double b = ys[i] * 3 - 1;
        double c = a * b + Math.sqrt(a + b) - Math.log(b + 1);
        // ... 30 more lines ...
        s += c;
    }
    return s;
}
```

<details><summary>Cost & Fix</summary>

By inlining a 50-line helper into the hot caller, the caller may exceed `FreqInlineSize` (325 bytes) — its callers stop inlining *it*, propagating the perf hit upward.

**Fix:** Re-extract. The original Extract Method version is often faster precisely because it's small enough to inline.

Verify: `-XX:+PrintInlining` shows whether your hot method is being inlined into its callers. If yes, leave it small.
</details>

---

## Optimize 6 — Extract Variable allocates per call (Python)

```python
def is_promo_eligible(user, cart):
    countries = {"US", "CA", "GB", "AU", "FR", "DE"}   # ❌ allocated each call
    is_country = user.country in countries
    return is_country and cart.total > 30
```

<details><summary>Cost & Fix</summary>

Every call re-allocates the set literal. For ~10M calls/day, this is millions of pointless allocations.

**Fix:** Hoist to module scope.

```python
_PROMO_COUNTRIES = frozenset({"US", "CA", "GB", "AU", "FR", "DE"})

def is_promo_eligible(user, cart):
    return user.country in _PROMO_COUNTRIES and cart.total > 30
```

`frozenset` makes intent explicit and is hash-cached. CPython 3.12+ does optimize some constant collections, but explicit module-level is the safe bet.
</details>

---

## Optimize 7 — Substitute Algorithm with allocation in the hot path (Java)

**Original:**

```java
boolean containsAny(String s, char[] needles) {
    for (int i = 0; i < s.length(); i++) {
        for (char n : needles) if (s.charAt(i) == n) return true;
    }
    return false;
}
```

**"Refactored":**

```java
boolean containsAny(String s, char[] needles) {
    Set<Character> set = new HashSet<>();
    for (char n : needles) set.add(n);
    for (int i = 0; i < s.length(); i++) {
        if (set.contains(s.charAt(i))) return true;
    }
    return false;
}
```

<details><summary>Cost & Fix</summary>

Allocates a `HashSet`, plus N `Character` boxes per `needles` element, plus N `Character` boxes per `s.charAt(i)` boxing for `contains`. For tiny `needles` (2–4 chars) the original linear scan is **dramatically faster**.

**Fix options:**
1. Keep linear scan for small `needles`.
2. Pre-build the set once and reuse:

```java
private static final Set<Character> NEEDLES_CACHE = ...;
boolean containsAny(String s) {
    for (int i = 0; i < s.length(); i++) {
        if (NEEDLES_CACHE.contains(s.charAt(i))) return true;
    }
    return false;
}
```

3. Use a primitive bitset for ASCII chars:

```java
boolean containsAny(String s, char[] needles) {
    long mask0 = 0, mask1 = 0;
    for (char c : needles) {
        if (c < 64) mask0 |= 1L << c;
        else if (c < 128) mask1 |= 1L << (c - 64);
    }
    for (int i = 0; i < s.length(); i++) {
        char c = s.charAt(i);
        if (c < 64 ? ((mask0 >> c) & 1) != 0 : c < 128 && ((mask1 >> (c - 64)) & 1) != 0)
            return true;
    }
    return false;
}
```

Faster than both — but only worth it for hot paths.
</details>

---

## Optimize 8 — Extract Method captures collection by-reference, then mutates (Java)

```java
List<Order> filterRecent(List<Order> orders) {
    return removeOld(orders);
}

private List<Order> removeOld(List<Order> orders) {
    orders.removeIf(o -> o.date().isBefore(cutoff));   // ❌ mutates caller's list
    return orders;
}
```

<details><summary>Cost & Fix</summary>

The "extracted" method mutates the input — a hidden side effect. Functionally it works for many test cases but breaks when callers don't expect the input to change. (Also throws `UnsupportedOperationException` if caller passes `List.of(...)`.)

**Fix:** Return a new list.

```java
private List<Order> removeOld(List<Order> orders) {
    return orders.stream()
                 .filter(o -> !o.date().isBefore(cutoff))
                 .toList();
}
```

Trade-off: allocates a new list. For very large inputs, the mutating version is faster — but expose that with a clear name (`removeOldInPlace`).
</details>

---

## Optimize 9 — Replace Temp with Query that defeats GC (Java)

```java
class Report {
    String generate(Data data) {
        return rows(data) + "\n" + summary(data);
    }
    private String rows(Data data) {
        StringBuilder sb = new StringBuilder();
        for (Row r : data.rows()) sb.append(r).append('\n');
        return sb.toString();
    }
    private String summary(Data data) {
        return "Total: " + data.total();
    }
}
```

<details><summary>Cost & Fix</summary>

Each call allocates a fresh `StringBuilder` + a `String`. Then the orchestrator concatenates with `+`, allocating *another* StringBuilder + String. For a 1MB rows output, you've doubled the peak heap.

**Fix:** Stream-write to a single buffer.

```java
String generate(Data data) {
    StringBuilder sb = new StringBuilder(estimateSize(data));
    appendRows(data, sb);
    sb.append('\n').append("Total: ").append(data.total());
    return sb.toString();
}
private void appendRows(Data data, StringBuilder sb) {
    for (Row r : data.rows()) sb.append(r).append('\n');
}
```

Now there's one buffer; helpers append to it.
</details>

---

## Optimize 10 — Inline Temp losing memoization (Python)

**Original:**

```python
def cost(item, ctx):
    rate = ctx.tax_rate(item.region)   # cached internally
    return item.price * (1 + rate)
```

**"Refactored":**

```python
def cost(item, ctx):
    return item.price * (1 + ctx.tax_rate(item.region))
```

<details><summary>Cost & Fix</summary>

If `ctx.tax_rate` is cached, the inline is fine. If it's *not*, the temp was the cache. Inlining is a no-op here, but in:

```python
def total(items, ctx):
    return sum(item.price * (1 + ctx.tax_rate(item.region)) for item in items)
```

`tax_rate` is called once per item. The temp would have helped only if hoisted outside the loop:

```python
def total(items, ctx):
    rate_for = ctx.tax_rate    # bind once
    return sum(item.price * (1 + rate_for(item.region)) for item in items)
```

Or, if all items share a region:

```python
def total(items, ctx, region):
    rate = ctx.tax_rate(region)
    return sum(item.price * (1 + rate) for item in items)
```

Lesson: Inline Temp is safe for *cheap* expressions. For expensive ones, the temp may be load-bearing — and its scope matters.
</details>

---

## Optimize 11 — Method Object reused across requests (Java)

```java
class OrderProcessor {
    private final Gamma g = new Gamma();   // ❌

    int process(int iv, int q, int ytd) {
        g.set(iv, q, ytd);
        return g.compute();
    }
}
```

<details><summary>Cost & Fix</summary>

The processor field-caches a Gamma to avoid allocation. **But** Gamma is single-use — its fields are partial state during one computation. Concurrent calls now race on shared state, producing wrong results.

**Fix:** Allocate per call (escape analysis will erase it anyway in JIT-compiled code).

```java
int process(int iv, int q, int ytd) {
    return new Gamma(iv, q, ytd).compute();
}
```

Or, if you really insist on reuse, use `ThreadLocal<Gamma>` — but escape analysis is almost always cheaper.
</details>

---

## Optimize 12 — Extract Method that captures `this` in a lambda (Java)

```java
Stream<Order> filterValid() {
    return orders.stream().filter(this::isValid);   // captures `this`
}

private boolean isValid(Order o) {
    return o.amount() > 0 && customer.isActive(o.customerId());   // uses field
}
```

<details><summary>Cost & Fix</summary>

`this::isValid` captures `this` (a method reference). For a small extracted helper, the allocation is per-stream, not per-element — fine for most cases.

For high-throughput hot paths, you might prefer:

```java
Stream<Order> filterValid() {
    Customer c = this.customer;
    return orders.stream().filter(o -> o.amount() > 0 && c.isActive(o.customerId()));
}
```

This way, the lambda captures only the field used, and the JIT can sometimes eliminate the capture entirely.

In practice, **measure first**. The JIT inlines most of these; the lambda allocation is one-time.

Bigger lesson: `this::method` references vs. inline lambdas have subtly different escape characteristics. For 99% of code, this doesn't matter. For the 1% that does, profile.
</details>

---

## Patterns of perf regression

| Refactor | Risk | Mitigation |
|---|---|---|
| Replace Temp with Query | Recompute | Cache the orchestrator-level result |
| Extract Method | Inlining cliff | Keep methods small |
| Method Object that escapes | Allocation | Don't store, don't return |
| Extract via interface | Virtual dispatch | Generics or PGO |
| Inline that bloats caller | Inlining cliff | Re-extract |
| Extract that allocates collection | Per-call alloc | Hoist constants |

---

## Next

- Recap: [interview.md](interview.md)
- Spot the bug: [find-bug.md](find-bug.md)
- Theory: [professional.md](professional.md)
