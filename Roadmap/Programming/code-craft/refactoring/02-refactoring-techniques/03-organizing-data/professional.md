# Organizing Data — Professional Level

> Memory layout, field alignment, escape analysis on value objects, and the runtime cost of choosing classes vs. primitives.

---

## Table of Contents

1. [Object header overhead](#object-header-overhead)
2. [Replace Data Value with Object: the cost of boxing](#replace-data-value-with-object-the-cost-of-boxing)
3. [Project Valhalla and value classes](#project-valhalla-and-value-classes)
4. [Type code via enum: how the JVM handles it](#type-code-via-enum-how-the-jvm-handles-it)
5. [Enum vs. polymorphism: dispatch costs](#enum-vs-polymorphism-dispatch-costs)
6. [Encapsulate Field and JIT inlining](#encapsulate-field-and-jit-inlining)
7. [Encapsulate Collection: defensive copy cost](#encapsulate-collection-defensive-copy-cost)
8. [Reference vs. value: GC and equality cost](#reference-vs-value-gc-and-equality-cost)
9. [Field alignment in Go and Rust](#field-alignment-in-go-and-rust)
10. Python: dict-based attributes vs. __slots__
11. [Review questions](#review-questions)

---

## Object header overhead

Every Java object has a header:
- 12 bytes (compressed oops, default on 64-bit) or 16 bytes (full pointers).
- Holds class pointer + identity hash + lock state + GC mark.

Every wrapping (`new Email(s)`, `new Money(amount, currency)`) costs at least 12 bytes per instance, plus the contained fields, plus reference bytes.

For 1M instances of a wrapper around a single String: 16 MB of headers, ignoring the String content itself.

---

## Replace Data Value with Object: the cost of boxing

```java
class Person { String email; }
```

vs.

```java
class Person { Email email; }
class Email { String value; }
```

Memory:
- Variant A: header + 4-byte ref → ~16 bytes/Person.
- Variant B: header + 4-byte ref + Email object (header + 4-byte ref to String) → ~28 bytes/Person.

For 100M instances, that's 1.2 GB more.

### When this matters

- Massive in-memory caches.
- Tight numerical loops.
- Mobile / embedded.

### Mitigations

- Don't promote in hot containers; keep the primitive on the entity, validate at boundaries.
- Use `@Value` Lombok types (compile-time only — same memory cost, but less code).
- Wait for Project Valhalla (value classes — no header).

In typical web services with 10K req/s and short-lived data, the cost is invisible. **Profile before you optimize.**

---

## Project Valhalla and value classes

Java's evolution that will make Replace Data Value with Object essentially free:

```java
value class Email {
    String value;
}
```

`Email` instances would be:
- Stored inline (no separate heap allocation, no header).
- Compared by value (`==` works as you'd expect).
- Compatible with generics.

Until Valhalla ships:
- **Records** (Java 14+) reduce code; don't reduce memory.
- **Inline classes** (preview) — early Valhalla.
- Workaround: keep primitives, use type-system tricks (newtype-like wrappers, validation at boundaries).

---

## Type code via enum: how the JVM handles it

Java enums are full classes. Each constant is a singleton instance.

```java
enum Status { ACTIVE, INACTIVE, PENDING }
```

- 3 instances allocated at class init.
- Each is a heap object with a header.
- `Status.ACTIVE == status` is a pointer compare — fast.
- `switch` over enum compiles to `tableswitch` (jump table) — O(1).

### Memory

An enum with 100 constants allocates 100 instances. For most apps, negligible. For a per-tenant enum dynamically generated, it could matter (and you'd usually avoid that pattern).

### Performance

Enum switch is among the fastest dispatches available — faster than virtual calls in many cases, because the JIT can generate specialized code for each branch.

---

## Enum vs. polymorphism: dispatch costs

Replace Type Code with Subclasses introduces a virtual call:

```java
abstract class Employee { abstract double pay(); }
class Engineer extends Employee { double pay() { return 5000; } }
```

vs. enum dispatch:

```java
enum EmployeeType {
    ENGINEER { double pay() { return 5000; } };
    abstract double pay();
}
```

### Costs

| Variant | Dispatch |
|---|---|
| Subclass virtual call | invokevirtual → vtable lookup (1 virtual call, ~1 ns post-JIT) |
| Enum abstract method | invokevirtual on the enum constant (same dispatch cost) |
| Plain enum + switch | tableswitch (1 jump, no virtual call) |

For most applications, all three are within 10% of each other. For very hot paths, the plain enum + switch can have a slight edge because it doesn't depend on JIT inlining decisions.

> Verify with JMH for your workload. Don't decide based on theory.

---

## Encapsulate Field and JIT inlining

```java
class Account {
    private double balance;
    public double balance() { return balance; }
}
```

In bytecode, `balance()` is a method call. Post-JIT, the call is inlined to a direct field access. **Encapsulate Field is free at runtime.**

The exception: if `balance()` is overridden in subclasses (and the call site is megamorphic), inlining stalls.

For 99% of code, encapsulation has zero cost. Don't avoid it for "performance reasons."

---

## Encapsulate Collection: defensive copy cost

```java
public List<Order> getOrders() { return List.copyOf(orders); }
```

Each call allocates a new list — copies the references. For a list of 1000 elements:
- 1 list object header.
- ~4-8 KB for the underlying array (1000 references).

If `getOrders()` is called 1000 times per request, that's MB of garbage per request.

### Mitigation

```java
public List<Order> getOrders() { return Collections.unmodifiableList(orders); }
```

Returns a **view** — no copy. But the view shares the underlying list, so mutating `orders` is visible through it. Document carefully.

For most services, the copy is fine. For hot paths, return the view (or a stream).

### Streams as encapsulation

```java
public Stream<Order> orders() { return orders.stream(); }
```

No copy; consumer can't mutate. But you can't `size()` directly — caller must collect.

---

## Reference vs. value: GC and equality cost

### Reference equality

```java
if (customer1 == customer2) ...
```

One pointer compare. ~1 nanosecond.

### Value equality

```java
if (customer1.equals(customer2)) ...
```

Calls `equals`, which usually compares one or more fields. ~3–10 nanoseconds.

For 1B comparisons, the difference is single-digit seconds. For most workloads, irrelevant.

### Hash-based collections

`HashMap<Customer, X>` calls `hashCode()` and `equals()` on lookup. If `Customer.equals` is value-based, each operation is several field reads. For huge maps, can dominate.

Mitigations:
- Cache `hashCode` in a final field.
- Use a primitive id as map key, store Customer separately.
- Prefer `IdentityHashMap` if reference semantics are correct.

---

## Field alignment in Go and Rust

### Go

Go doesn't reorder struct fields. Alignment matters:

```go
type Bad struct {  // 24 bytes
    a bool
    b int64
    c bool
    d int64
}

type Good struct {  // 24 bytes? No — 24 too. But `Best` is 16:
    b int64
    d int64
    a bool
    c bool
}
```

Tools: `fieldalignment` (a `go vet` analyzer) finds suboptimal layouts.

For 10M instances, going from 24 to 16 bytes saves 80 MB.

### Rust

Rust **does** reorder by default for `#[repr(Rust)]` (the default). For C-compatible layout, use `#[repr(C)]` and pay attention to alignment.

```rust
#[repr(C)]
struct Bad { a: bool, b: u64, c: bool }   // 24 bytes due to padding
```

### Implication for Organizing Data

Replace Type Code with Class adds a field. In Go especially, watch alignment — and don't accidentally bloat hot structures.

---

## Python: dict-based attributes vs. __slots__

CPython instances use a `__dict__` for attributes by default — flexible but expensive:
- ~280 bytes per instance with `__dict__`.
- ~50–80 bytes per instance with `__slots__`.

For Replace Data Value with Object on a hot type (millions of instances):

```python
class Email:
    __slots__ = ("value",)
    def __init__(self, value: str):
        self.value = value
```

Or use `@dataclass(slots=True)` (Python 3.10+):

```python
@dataclass(slots=True, frozen=True)
class Email:
    value: str
```

`frozen=True` makes it immutable (value semantics). `slots=True` makes it small.

### Faster equivalents

- **NamedTuple** — immutable, tuple-backed.
- **attrs** library — older but rich.
- **Pydantic** v2 with frozen models — Rust-backed validation.

### When dict overhead is fine

For domain entities (one per request), the overhead is negligible. For caches, batch processing, columnar data — switch to `__slots__`, NumPy, polars, or Pandas.

---

## Review questions

1. What's the size of a typical Java object header?
2. Why does Replace Data Value with Object cost memory in pre-Valhalla Java?
3. How will Project Valhalla change the calculus?
4. How is enum dispatch implemented in JVM bytecode?
5. Compare enum dispatch vs. virtual call vs. switch in terms of cost.
6. Is Encapsulate Field a runtime cost?
7. What's the cost of `List.copyOf(orders)` per call?
8. When does reference equality vs. value equality matter at scale?
9. What is `fieldalignment` in Go?
10. When should a Python class use `__slots__`?
