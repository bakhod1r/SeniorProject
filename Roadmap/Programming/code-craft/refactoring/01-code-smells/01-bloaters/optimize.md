# Bloaters — Optimize

> 12 inefficient implementations of Bloater fixes. Each looks like a "clean refactor" but has a measurable performance issue. Identify it, then optimize.

---

## Optimize 1 — Value object allocates per call (Java)

**Original:**

```java
public final class CustomerId {
    private final String value;
    public CustomerId(String value) {
        if (value == null || value.isBlank()) throw new IllegalArgumentException();
        this.value = value;
    }
    public String value() { return value; }
}

public class OrderRepository {
    public List<Order> findByCustomer(String customerIdRaw) {
        CustomerId id = new CustomerId(customerIdRaw);  // allocation
        return jdbc.query("SELECT * FROM orders WHERE customer_id = ?", id.value());
    }
}

// Hot path called 10,000 times/sec.
```

**Issue:** `new CustomerId(...)` allocates per call. The value object is constructed only to extract `value()` immediately and pass to JDBC.

**Fix:** lift validation outside the hot path; the value object should be passed in already-constructed.

```java
public class OrderRepository {
    public List<Order> findByCustomer(CustomerId id) {  // already validated
        return jdbc.query("SELECT * FROM orders WHERE customer_id = ?", id.value());
    }
}
```

Callers construct `CustomerId` once at the system boundary (e.g., HTTP controller). Internal hot paths reuse the constructed instance.

**Measurement:** with HotSpot escape analysis, the original *might* avoid allocation — but only if the JIT proves the object doesn't escape. JDBC parameter binding is opaque to EA, so the object likely escapes. Verify with `-XX:+PrintEscapeAnalysis` or `JFR`.

---

## Optimize 2 — Parameter Object allocated per call in tight loop (Go)

**Original:**

```go
type Coord struct{ Lat, Lon float64 }

func (c Coord) DistanceTo(o Coord) float64 { ... }

// Hot loop:
for _, store := range stores {  // 1M stores
    storeCoord := Coord{Lat: store.Lat, Lon: store.Lon}
    customerCoord := Coord{Lat: cust.Lat, Lon: cust.Lon}
    d := storeCoord.DistanceTo(customerCoord)
    if d < radius { nearby = append(nearby, store) }
}
```

**Issue:** `customerCoord` is constructed on every iteration. It's identical every time.

**Fix 1:** hoist invariant out of the loop.

```go
customerCoord := Coord{Lat: cust.Lat, Lon: cust.Lon}
for _, store := range stores {
    storeCoord := Coord{Lat: store.Lat, Lon: store.Lon}
    if customerCoord.DistanceTo(storeCoord) < radius {
        nearby = append(nearby, store)
    }
}
```

**Fix 2:** since `Coord` is value-typed in Go (no allocation), the issue is field-access cost, not allocation. Verify with `go build -gcflags='-m'`. The bigger win is preallocating the result slice:

```go
nearby := make([]Store, 0, len(stores)/4)  // expected ~25% match
```

This avoids repeated slice growth (each `append` past capacity copies the entire backing array).

---

## Optimize 3 — Extracted helper that defeats inlining (Java)

**Original:**

```java
// Hot path (called 100M times/sec):
public boolean isAdult(int age) {
    return validateAge(age) && (age >= 18);
}

private boolean validateAge(int age) {
    if (age < 0) throw new IllegalArgumentException("Negative age");
    if (age > 150) throw new IllegalArgumentException("Implausible age");
    return true;
}
```

**Issue:** `validateAge` always returns `true` (it throws otherwise). The boolean result is meaningless. JIT may not optimize this away if the method is too complex.

**Fix:** make `validateAge` `void` and rely on exception semantics:

```java
public boolean isAdult(int age) {
    requireValidAge(age);
    return age >= 18;
}

private static void requireValidAge(int age) {
    if (age < 0 || age > 150) throw new IllegalArgumentException();
}
```

Or, for ultra-hot paths, drop validation entirely — validate at the system boundary, trust internal code:

```java
public boolean isAdult(int age) {
    return age >= 18;  // age was validated on input
}
```

This is the [Parse, Don't Validate](https://lexi-lambda.github.io/blog/2019/11/05/parse-don-t-validate/) principle — cure Primitive Obsession at the boundary, then trust the type.

---

## Optimize 4 — Extract Class with O(N²) scan (Python)

**Original:**

```python
@dataclass
class Address:
    street: str
    city: str
    state: str
    zip: str

class CustomerDirectory:
    def __init__(self):
        self.customers = []
    
    def find_by_address(self, addr: Address):
        return [c for c in self.customers if c.address == addr]
```

**Issue:** linear scan through all customers per lookup. O(N) per call. For 1M customers and frequent lookups, this is the bottleneck — refactoring to value objects exposed it (the original might have used a database query indexed on `street/city/state/zip`).

**Fix:** index by Address.

```python
class CustomerDirectory:
    def __init__(self):
        self.customers = []
        self._by_address = {}  # Address -> list of customers
    
    def add(self, customer):
        self.customers.append(customer)
        self._by_address.setdefault(customer.address, []).append(customer)
    
    def find_by_address(self, addr):
        return self._by_address.get(addr, [])
```

For this to work, `Address` must be hashable (`@dataclass(frozen=True)` provides `__hash__` automatically).

---

## Optimize 5 — String interning missed (Java)

**Original:**

```java
final class Currency {
    private final String code;
    public Currency(String code) {
        if (!Set.of("USD", "EUR", "GBP", "JPY").contains(code)) {
            throw new IllegalArgumentException();
        }
        this.code = code;
    }
}

// Created millions of times in a hot path:
Money m = new Money(amount, new Currency("USD"));
```

**Issue:** millions of `Currency` instances, all representing one of 4 values. Memory waste; equality checks slower than necessary.

**Fix:** flyweight pattern — a private static cache.

```java
final class Currency {
    private static final Map<String, Currency> INSTANCES = Map.of(
        "USD", new Currency("USD"),
        "EUR", new Currency("EUR"),
        "GBP", new Currency("GBP"),
        "JPY", new Currency("JPY")
    );
    
    private final String code;
    private Currency(String code) { this.code = code; }  // private
    
    public static Currency of(String code) {
        Currency c = INSTANCES.get(code);
        if (c == null) throw new IllegalArgumentException();
        return c;
    }
}
```

Even better — make `Currency` an enum:

```java
enum Currency { USD, EUR, GBP, JPY }
```

Enums are JVM-managed singletons. Free flyweight.

---

## Optimize 6 — Method-object allocation per call (Java)

**Original:**

```java
class StatisticsAnalyzer {
    public Stats analyze(double[] data) {
        return new Analysis(data).compute();
    }
}

// Called 1M times/sec for streaming data.
```

**Issue:** every call allocates an `Analysis` object. Even with EA, it might escape (the result references it).

**Fix:** pool the analyzer or make it a `ThreadLocal`.

```java
class StatisticsAnalyzer {
    private static final ThreadLocal<Analysis> POOL = ThreadLocal.withInitial(Analysis::new);
    
    public Stats analyze(double[] data) {
        Analysis a = POOL.get();
        a.reset();
        return a.compute(data);
    }
}
```

**Caveat:** pooled state must be thread-local (Analysis is mutable, can't share across threads).

For most cases, **don't optimize yet**. Run JFR or async-profiler first; allocation may be fine. Pooling adds complexity.

---

## Optimize 7 — Encapsulating collection forces defensive copies (Java)

**Original:**

```java
class Order {
    private final List<OrderLine> lines = new ArrayList<>();
    
    public List<OrderLine> getLines() {
        return new ArrayList<>(lines);  // defensive copy
    }
    public void addLine(OrderLine line) {
        lines.add(line);
    }
}

// Caller iterates getLines() many times in a hot path:
for (int i = 0; i < 1000; i++) {
    for (OrderLine line : order.getLines()) {  // copies list 1000 times
        ...
    }
}
```

**Issue:** defensive copy on every getter call. With 1000 calls and a 50-line order, that's 50,000 unnecessary allocations.

**Fix 1:** return an unmodifiable view (no copy).

```java
public List<OrderLine> getLines() {
    return Collections.unmodifiableList(lines);
}
```

**Fix 2:** expose only the operations callers need; don't expose the collection.

```java
public void forEachLine(Consumer<OrderLine> action) {
    lines.forEach(action);
}
public int lineCount() { return lines.size(); }
public OrderLine line(int index) { return lines.get(index); }
```

This (Tell, Don't Ask) prevents the smell entirely — callers can't mutate, can't iterate badly.

---

## Optimize 8 — Long Method extraction creates allocation pressure (Go)

**Original (after refactor):**

```go
func computeReport(orders []Order) Report {
    return Report{
        Total:        sum(orders),
        ItemCount:    countItems(orders),
        AvgValue:     average(orders),
        TopCustomers: topByValue(orders, 10),
    }
}

func sum(orders []Order) float64 {
    total := 0.0
    for _, o := range orders { total += o.Total }
    return total
}
// ... three more single-pass helpers
```

**Issue:** four passes over the same `orders` slice. Cache miss per pass on large datasets.

**Fix:** single pass that produces all aggregates.

```go
func computeReport(orders []Order) Report {
    var (
        total      float64
        itemCount  int
        topByValue heap.Heap  // bounded heap
    )
    for _, o := range orders {
        total += o.Total
        itemCount += len(o.Items)
        topByValue.Push(o)
        if topByValue.Len() > 10 {
            topByValue.Pop()
        }
    }
    return Report{
        Total: total,
        ItemCount: itemCount,
        AvgValue: total / float64(len(orders)),
        TopCustomers: topByValue.Drain(),
    }
}
```

**Trade-off:** the single-pass version is uglier. Reach for it only when profiling shows the multi-pass is the bottleneck. Premature optimization re-creates the Long Method smell.

---

## Optimize 9 — Hash-based dedup of value objects forgets equals (Python)

**Original:**

```python
@dataclass
class Address:
    street: str
    city: str
    state: str
    zip: str

addresses = [Address("123 Main", "NYC", "NY", "10001") for _ in range(1_000_000)]
unique = set(addresses)  # TypeError!
```

**Issue:** `@dataclass` is mutable by default — no `__hash__` → unhashable.

**Fix 1:** make it frozen (auto-hashable).

```python
@dataclass(frozen=True)
class Address: ...
```

**Fix 2:** if you need mutability + dedup, dedup by an explicit key.

```python
unique = {(a.street, a.city, a.state, a.zip): a for a in addresses}.values()
```

**Performance note:** `frozen=True` adds tiny overhead per attribute access (uses `object.__setattr__` in `__init__`). For most code, irrelevant. For absolute hot paths, accept mutability and dedup with explicit tuples.

---

## Optimize 10 — Repeated regex compilation in value object (Java)

**Original:**

```java
public final class Email {
    private final String value;
    public Email(String raw) {
        if (!raw.matches("^[^\\s@]+@[^\\s@]+\\.[^\\s@]+$")) {  // compiles regex every call
            throw new IllegalArgumentException();
        }
        this.value = raw;
    }
}
```

**Issue:** `String.matches` compiles the regex on **every call**. Constructing a million `Email`s compiles the same regex a million times.

**Fix:** compile once, reuse.

```java
public final class Email {
    private static final Pattern PATTERN = Pattern.compile("^[^\\s@]+@[^\\s@]+\\.[^\\s@]+$");
    
    private final String value;
    public Email(String raw) {
        if (!PATTERN.matcher(raw).matches()) {
            throw new IllegalArgumentException();
        }
        this.value = raw;
    }
}
```

**Measurement:** typical 4-10× speedup on construction. JMH benchmark recommended; the JIT may sometimes optimize `String.matches` in newer JVMs but don't rely on it.

---

## Optimize 11 — BigDecimal arithmetic without scale management (Java)

**Original:**

```java
public final class Money {
    private final BigDecimal amount;
    private final Currency currency;
    
    public Money add(Money other) {
        return new Money(amount.add(other.amount), currency);
    }
    
    public Money divide(int divisor) {
        return new Money(amount.divide(BigDecimal.valueOf(divisor)), currency);  // ArithmeticException if not exact
    }
}
```

**Issue:** `BigDecimal.divide(BigDecimal)` without specifying scale throws `ArithmeticException` for non-terminating decimals (e.g., `1/3`). Even when it doesn't throw, the scale grows unboundedly across operations.

**Fix:**

```java
public Money divide(int divisor) {
    return new Money(amount.divide(BigDecimal.valueOf(divisor), 2, RoundingMode.HALF_EVEN), currency);
}
```

**Better:** use `MathContext` consistently for the whole calculation, or use a fixed-precision integer (cents as `long`):

```java
public final class Money {
    private final long minorUnits;       // cents
    private final Currency currency;
}
```

Integer arithmetic is faster; rounding errors limited to the specified precision. Banking systems do this. Caveat: must handle overflow at $92 quadrillion (`Long.MAX_VALUE / 100`).

---

## Optimize 12 — God class split causes cross-instance chatter (Go)

**Original (after Extract Class refactor):**

```go
type Order struct {
    Items   *Items
    Pricing *Pricing
    Shipping *Shipping
}

type Pricing struct{ /* ... */ }

func (p *Pricing) Total(items *Items) float64 {
    total := 0.0
    for i := 0; i < items.Count(); i++ {
        total += items.Get(i).UnitPrice * float64(items.Get(i).Quantity)
    }
    return total
}

// Hot path:
total := order.Pricing.Total(order.Items)
```

**Issue:** `items.Get(i)` is called twice per loop iteration (once for `UnitPrice`, once for `Quantity`). If `Get` involves a method dispatch or bounds check, that's 2 indirections per item.

**Fix:** local variable.

```go
func (p *Pricing) Total(items *Items) float64 {
    total := 0.0
    for i := 0; i < items.Count(); i++ {
        item := items.Get(i)
        total += item.UnitPrice * float64(item.Quantity)
    }
    return total
}
```

**Better:** expose iteration directly.

```go
func (it *Items) Each(fn func(item Item)) {
    for _, x := range it.values {
        fn(x)
    }
}

func (p *Pricing) Total(items *Items) float64 {
    total := 0.0
    items.Each(func(item Item) {
        total += item.UnitPrice * float64(item.Quantity)
    })
    return total
}
```

**Even better:** the cleanest separation often has helpers move *with* the data they touch. `Total()` belongs on `Items`, not on `Pricing`:

```go
func (it *Items) Total() float64 {
    total := 0.0
    for _, item := range it.values {
        total += item.UnitPrice * float64(item.Quantity)
    }
    return total
}
```

This is **Move Method** — when Extract Class produces a chatty inter-class API, the methods want to live where the data is.

---

> **Next:** [interview.md](interview.md) — 50+ Q&A across all levels.
