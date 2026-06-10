# Data Clumps — Optimize

> Concern: "Extracting Value Objects means more allocations. What does this cost?"
>
> Short answer: less than you think, often nothing at all, occasionally a small fixed price worth paying — measured on JDK 21 with HotSpot in 2026.

---

## 1. What a record really is

JEP 395 (Java 16, 2021) describes records as transparent carriers for immutable data. At the bytecode level a record is an ordinary final class extending `java.lang.Record` with:

- Synthetic `equals`, `hashCode`, and `toString` backed by an `invokedynamic` bootstrap to `ObjectMethods.bootstrap`.
- One private final field per component.
- A canonical constructor.

That is the entire footprint. A two-component record like `Money(BigDecimal, Currency)` occupies the standard object header (12 bytes on 64-bit HotSpot with compressed oops) plus two reference slots — typically 24 bytes total, identical to a hand-written class with the same shape.

No hidden cost. No reflective magic at runtime. Records are not slower than classes.

---

## 2. Escape Analysis and Scalar Replacement

HotSpot's C2 compiler performs **Escape Analysis** (EA). When EA proves an object cannot escape the compilation unit, it eliminates the allocation entirely and stores the components in CPU registers or on the stack frame. This optimization is called **Scalar Replacement of Aggregates** (SRA).

Small, immutable records are *ideal* candidates:

- All fields are final — no aliasing risk.
- No subclassing — types are exact.
- No mutators — no need to materialize state for later writes.
- Typically created, read, and discarded inside one hot method.

Example:

```java
Money total = items.stream()
    .map(i -> new Money(i.price(), i.currency()))
    .reduce(Money.zero(USD), Money::add);
```

In a hot loop, C2 routinely scalarizes the intermediate `Money` instances. The `BigDecimal` and `Currency` references live in registers; no `Money` object is allocated on the heap. The throughput matches the equivalent hand-rolled `(amount, currency)` pair.

You can verify this with `-XX:+UnlockDiagnosticVMOptions -XX:+PrintEscapeAnalysis` (debug build) or, more practically, with JFR (`jdk.ObjectAllocationSample`) under load. A scalarized allocation does not appear in JFR allocation events.

---

## 3. When EA fails

EA is powerful but not omniscient. It fails when:

1. **The object escapes via a field** — assigning the VO to an instance or static field defeats SRA.
2. **It escapes via a return value to an unknown caller** — across the inlining boundary, EA gives up.
3. **It escapes via a virtual call** — passing it to an interface method whose target is not inlined.
4. **The allocation is in a megamorphic call site** — the JIT cannot specialize.
5. **It is captured by a lambda** — lambdas are first-class objects; their captures escape.

The first three are common in domain code. A `Money` stored in `Order.total` will not be scalarized; it lives on the heap like any other object.

Practical implication: SRA helps the *hottest, smallest, most local* uses of records, which is where allocation pressure would have hurt the most. It does **not** help long-lived VOs — but long-lived VOs are not where allocation cost matters.

---

## 4. Stack vs Heap — what actually happens

A common myth: "Java has no stack allocation." Reality is more nuanced.

- The JVM specification does not promise stack allocation.
- HotSpot, in practice, *behaves as if* objects are stack-allocated when SRA succeeds — the object is decomposed into scalars that may live in registers or in the stack frame.
- For a small record used locally, the runtime cost is essentially equivalent to passing the components as separate local variables.

So when someone asks "isn't `new Money(...)` slower than `(amount, currency)`?", the honest answer is: on the hot path, after warmup, with SRA active — no. Outside the hot path — yes, by a few nanoseconds per allocation, which is invisible against any real workload.

---

## 5. Equals, hashCode, and the BigDecimal trap

Record `equals` and `hashCode` are generated via `invokedynamic` bootstrap. After the first call site is linked they perform on par with hand-written implementations.

**Trap:** `BigDecimal.equals` considers scale. `new BigDecimal("1.0").equals(new BigDecimal("1.00"))` is `false`. A `Money` record with a `BigDecimal` component inherits this surprise. Two fixes:

1. **Normalize in compact constructor**:

```java
public Money {
    amount = amount.stripTrailingZeros();
    if (amount.scale() < 0) amount = amount.setScale(0);
}
```

2. **Use a fixed scale per currency**:

```java
public Money {
    int scale = currency.getDefaultFractionDigits();
    amount = amount.setScale(scale, RoundingMode.HALF_EVEN);
}
```

Option 2 is preferable for financial code: equality, hashing, and arithmetic all behave identically.

---

## 6. Memory characteristics

For a two-component record on 64-bit HotSpot with compressed oops:

| Component         | Bytes (typical)              |
|-------------------|------------------------------|
| Object header     | 12                           |
| `BigDecimal` ref  | 4                            |
| `Currency` ref    | 4                            |
| Padding to 8      | 4                            |
| **Total**         | **24**                       |

Plus the heap cost of the `BigDecimal` itself (~40 bytes typical) and the shared `Currency` (effectively free — interned).

A list of one million `Money` instances costs roughly 24 MB for the record envelopes plus the BigDecimals. With SRA along the aggregation path, you pay none of that in transit.

---

## 7. Persistence-layer caveats

VOs interact with the ORM allocation path. Two issues to know:

1. **Hibernate hydration always allocates.** Loading a `@Embeddable` Money creates a new instance per row. No EA involved — this is reflection-driven instantiation. For 100k-row reads, this can produce GC pressure. Mitigation: avoid eager loading of large collections, or project to flat DTOs for bulk reads.

2. **Equals semantics in caches.** Hibernate's first-level cache uses entity identity, but second-level caches compare by `equals`. If your `Money` `equals` is sensitive to `BigDecimal` scale, you may miss cache hits. Normalize.

---

## 8. Quick Rules

- **Records are not slower than equivalent classes.** Same bytecode shape, same JIT treatment.
- **Hot, local, small records are usually scalarized.** Trust EA on the JIT path; profile only if you have a reason.
- **Long-lived VOs do allocate.** This is fine — they replace primitive groups that would have allocated anyway (boxed primitives, `BigDecimal`).
- **Normalize `BigDecimal` in the compact constructor.** Either strip trailing zeros or fix scale per currency. Otherwise `equals` will surprise you.
- **Avoid records as keys in `HashMap` for high-cardinality fields**, unless you have measured the hash distribution. Records use `Objects.hash` semantics; collisions on tuple-of-strings are common.
- **Do not use records to hold sensitive data without overriding `toString`.** Default `toString` prints every component.
- **Benchmark with JMH if it matters.** Microbenchmarks of VO arithmetic should use `@Setup(Level.Invocation)` to avoid SRA hiding real cost. JFR allocation profiling is the production tool of choice.

---

## 9. What's next

- `../07-primitive-obsession/optimize.md` — performance discussion of tiny types specifically.
- `../../06-anemic-domain-model/optimize.md` — how rich VOs affect domain-service call shapes.
- `./tasks.md` — hands-on exercises that exercise the patterns described here.
