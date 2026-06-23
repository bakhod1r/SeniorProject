# Organizing Data — Optimize

> 12 cases where the refactor is correct but the perf cost is real.

---

## Optimize 1 — Encapsulate Collection allocates per call (Java)

```java
public List<Order> orders() { return List.copyOf(orders); }
```

For 10K req/s, each calling `orders()` once: 10K list copies/s.

<details><summary>Cost & Fix</summary>

Allocates a new immutable list per call. For ~50-element lists, ~400 bytes/call → 4MB/s of garbage.

**Fix:** Return an unmodifiable view (no copy):

```java
public List<Order> orders() { return Collections.unmodifiableList(orders); }
```

Or expose a Stream:

```java
public Stream<Order> orders() { return orders.stream(); }
```

Caller doesn't get O(N) copy; just iterates lazily. Mutating the underlying isn't possible during iteration without exception.
</details>

---

## Optimize 2 — Replace Data Value with Object on a hot path (Java)

```java
class Transaction {
    private Money amount;   // was double
}
class Money {
    private final double value;
    private final Currency currency;
}
```

In a batch processing job, 10M transactions per minute.

<details><summary>Cost & Fix</summary>

Each `Money` is a heap object: header + 2 fields (~24 bytes). 10M Money objects per minute → ~240 MB/min.

If escape analysis fails (e.g., Money stored in fields, returned, etc.), GC pressure rises.

**Fix options:**
1. For batch / numerical hot paths: keep primitives (`double amount; Currency currency`).
2. Use a flyweight `Currency` (interned, singletons per code) — already common.
3. Wait for Project Valhalla's value classes.

For domain code (one Money per request), the cost is invisible.
</details>

---

## Optimize 3 — Replace Type Code with Class breaks switch optimization (Java)

```java
enum Status { ACTIVE, INACTIVE, PENDING }
switch (status) {
    case ACTIVE -> ...;
    case INACTIVE -> ...;
    case PENDING -> ...;
}
```

vs. the old `int status` with `switch(status)`.

<details><summary>Cost & Fix</summary>

Both compile to `tableswitch` — same dispatch cost. **No regression.** ✓

The myth "enums are slower than int switch" is from C-era thinking; in modern JVMs, enums compile to fast switch.

For very hot paths over millions of items, the enum's heap allocation matters slightly (each value reachable through a static reference, but no per-item allocation), but switch dispatch itself is identical.

**No fix needed.** Don't avoid enums for performance.
</details>

---

## Optimize 4 — Replace Magic Number adds runtime lookup (Python)

```python
TAX_RATE = 0.07
def total(amount): return amount * (1 + TAX_RATE)
```

vs. old `def total(amount): return amount * 1.07`.

<details><summary>Cost & Fix</summary>

CPython looks up `TAX_RATE` in the module's namespace per call — small overhead. PyPy / Cython optimize this away. For ~1M calls/sec in tight loops, this can show.

**Fix:** Bind to local in hot loop:

```python
_TAX_RATE = 0.07
def total_many(amounts):
    rate = _TAX_RATE     # local lookup is faster than module lookup
    return [a * (1 + rate) for a in amounts]
```

Or compile the constant at function-bind time:
```python
def total(amount, _r=0.07): return amount * (1 + _r)
```

For most code: irrelevant. For numerical hot loops: convert to NumPy vectorized op.
</details>

---

## Optimize 5 — Encapsulate Field's accessor not inlined by JIT (Java)

```java
class Account {
    private double balance;
    public double balance() { return balance; }   // ✓ free in steady state
}
```

Question: when isn't this free?

<details><summary>Cost & Fix</summary>

Cost cases:
- `balance()` is overridden in many subclasses (megamorphic) → inline cache costly.
- The class is huge and `balance()` happens to be in the cold portion that doesn't compile.
- Reflection-based access (Spring DI proxies) wraps the call.

Mitigations:
- Mark `balance()` `final` if not meant for override.
- For hot fields, expose a direct package-private field for internal use, public accessor for outside.

Generally: 99% of time, no fix needed. Encapsulate Field's runtime cost is zero.
</details>

---

## Optimize 6 — Replace Array with Object adds per-instance memory (Java)

```java
String[] row = {"Alice", "Eng", "30"};   // ~40 bytes (3 refs + array header)
```

vs.
```java
record Employee(String name, String title, int age) {}   // header + 2 refs + int = ~24 bytes
```

For 10M instances:
- Array form: 400 MB.
- Record form: 240 MB.

Records win.

<details><summary>Cost & Fix</summary>

Records are typically *better* than arrays for memory. Type safety + comparable footprint.

The exception: when you have hundreds of fields and the record allocates more. Then column-store / NumPy / pandas / `Arrow` is the better choice for analytical workloads.

**Fix:** Use records by default. For columnar data, use proper columnar storage.
</details>

---

## Optimize 7 — Bidirectional with serialization loop (Java + Jackson)

```java
class Customer { @JsonManagedReference List<Order> orders; }
class Order { @JsonBackReference Customer customer; }
```

<details><summary>Cost & Fix</summary>

Without the annotations, JSON serialization recurses infinitely → stack overflow.

With them: Customer serializes orders; orders' customer is suppressed. **Correct, but the JSON omits customer reference on orders.**

For an API consumer that needs `order.customer.id`, the form is wrong.

**Fix:** Use DTOs for serialization. Don't expose entities directly.

```java
class CustomerDto {
    String id;
    String name;
    List<OrderDto> orders;
}
class OrderDto {
    String id;
    String customerId;   // just the id, not the full customer
    Money total;
}
```

Lesson: Bidirectional + entity serialization is a perf footgun. Always project to DTOs at the boundary.
</details>

---

## Optimize 8 — Encapsulate Collection with concurrent mutation (Java)

```java
class Customer {
    private final List<Order> orders = new ArrayList<>();
    public List<Order> orders() { return Collections.unmodifiableList(orders); }
    public synchronized void add(Order o) { orders.add(o); }
}

// Caller:
for (Order o : customer.orders()) { ... }   // iteration
// Concurrently: anotherThread.add(...)
```

<details><summary>Cost & Fix</summary>

Iteration over the unmodifiable view while another thread mutates the underlying list → `ConcurrentModificationException`.

**Fix options:**
1. **`CopyOnWriteArrayList`** — write is O(N), read is concurrent and snapshot-stable.
2. **Snapshot copy on read:**
   ```java
   public List<Order> orders() { synchronized(this) { return new ArrayList<>(orders); } }
   ```
3. **Immutable collections (Guava `ImmutableList`):** copy-on-add, share-on-read.

Choose by read/write ratio. For read-mostly: CopyOnWriteArrayList. For write-heavy: snapshot copies.
</details>

---

## Optimize 9 — Replace Type Code with State allocates per transition (Java)

```java
class Order {
    private OrderStatus status;
    public void submit() { status = new SubmittedStatus(); }
    public void ship() { status = new ShippedStatus(); }
}
```

<details><summary>Cost & Fix</summary>

Each transition allocates a new state object. For long-lived orders, this is fine. For a high-throughput system with millions of state transitions per minute, it adds GC pressure.

**Fix:** Use singletons for stateless states.

```java
class Order {
    private OrderStatus status;
    public void submit() { status = SubmittedStatus.INSTANCE; }
}
class SubmittedStatus implements OrderStatus {
    static final SubmittedStatus INSTANCE = new SubmittedStatus();
    private SubmittedStatus() {}
    ...
}
```

Or use enum-implements-interface pattern:

```java
enum OrderStatus implements Status {
    DRAFT { public void cancel() { ... } },
    SHIPPED { public void cancel() { throw ... } };
    public abstract void cancel();
}
```

Each enum value is a singleton. Zero per-transition allocation.
</details>

---

## Optimize 10 — Encapsulate Field on a Python class without __slots__ (Python)

```python
class Account:
    def __init__(self, balance):
        self._balance = balance

    @property
    def balance(self):
        return self._balance
```

Each instance has a `__dict__` (~280 bytes overhead).

<details><summary>Cost & Fix</summary>

For 10M instances, that's 2.8 GB just in dict overhead.

**Fix:**

```python
class Account:
    __slots__ = ("_balance",)
    def __init__(self, balance):
        self._balance = balance

    @property
    def balance(self):
        return self._balance
```

Or `@dataclass(slots=True, frozen=True)`. Reduces per-instance overhead to ~50 bytes.

For domain code with one instance per request: irrelevant. For batches / pipelines: critical.
</details>

---

## Optimize 11 — Replace Reference to Value triggers expensive equals (Java)

```java
public record Customer(String id, String name, String email, Address address) {}
```

Records auto-generate `equals` based on all fields. `Address` has its own auto-generated `equals` based on its fields.

```java
HashMap<Customer, X> map = ...;
map.get(someCustomer);   // calls equals → walks all fields recursively
```

For complex nested values, equality is O(total field count).

<details><summary>Cost & Fix</summary>

For lookups by Customer id, the entire address is compared. Wasteful.

**Fix:** Cache hashCode in a final field, or use the id as map key:

```java
HashMap<String, Customer> byId = ...;
byId.get(customer.id());
```

Or implement equals based on id only, with a documented warning that the record's "equals" is *not* the id-based one:

```java
public record Customer(String id, String name, ...) {
    public static EqualBy idEquals = ...;
}
```

This is one place where Java records' default behavior may not be what you want; lean on the type system to enforce id-based comparison externally.
</details>

---

## Optimize 12 — Magic Number Constant in JS / TypeScript (TypeScript)

```ts
const TAX_RATE = 0.07;
function total(x: number): number { return x * (1 + TAX_RATE); }
```

V8 inlines `TAX_RATE` as long as it's `const` and not exported (or if the bundler does dead-code elimination).

<details><summary>Cost & Fix</summary>

For module-level `const`, V8 compiles to a constant load. In TypeScript, this is generally as fast as `0.07` literal.

For `export const`, V8 must re-resolve through the module exports table — slower in tight loops.

**Fix:** for hot paths, pin the constant locally:

```ts
function makeCalculator(rate = TAX_RATE) {
  return (x: number) => x * (1 + rate);
}
```

Or just inline. JIT optimizers handle most of this; only matters in extreme hot paths.
</details>

---

## Patterns

| Refactor | Risk |
|---|---|
| Encapsulate Collection (copy) | Per-call alloc |
| Replace Data Value with Object | Per-instance alloc + header |
| Encapsulate Field | Almost free |
| Replace Type Code with State | Per-transition alloc — use singletons |
| Bidirectional + JSON | Stack overflow / wrong shape |
| ConcurrentMod over views | Need CoW or snapshot |
| Records with deep equals | Lookup cost |
| Python without __slots__ | Per-instance overhead |

---

## Next

- [tasks.md](tasks.md) — practice clean refactors
- [find-bug.md](find-bug.md) — wrong refactors
- [interview.md](interview.md) — review
