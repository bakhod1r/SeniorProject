# Primitive Obsession — Optimize

> **What?** The honest performance cost of typed wrappers on the JVM today (Java 17–21), what the JIT compensates for, where it doesn't, what changes when Project Valhalla (JEP 401, *Value Classes and Objects*) lands, autoboxing pitfalls, and the narrow set of cases where dropping back to primitives is the right answer.
> **How?** Measure with JMH; reason about allocation with `-XX:+PrintEliminateAllocations`; trust the JIT for non-hot code; defer to Valhalla for hot paths. Don't pessimise wrapper-rich code based on speculation — pessimise based on profiles.

---

## 1. The real cost of a record on HotSpot

A Java record has the same JVM-level shape as any other final class. A `record Money(long minorUnits, Currency currency)` consumes:

| Component        | Bytes (64-bit JVM, compressed OOPs) |
|------------------|--------------------------------------|
| Object header    | 12                                   |
| `long minorUnits`| 8                                    |
| `Currency` ref   | 4                                    |
| Padding          | 8                                    |
| **Total**        | **32 bytes per instance**            |

Compare to a bare `long`: 8 bytes, no header, no padding, no allocation. A `Money` is 4× the memory of a `long`, plus the cost of allocation, plus the cost of GC pressure when many are short-lived.

This is the headline number. Most of the time, the JIT erases it.

---

## 2. Escape analysis and scalar replacement

HotSpot's C2 compiler performs *escape analysis* on each compiled method. If it can prove that an allocated object does not escape the method (no field write, no return, no thread-shared reference), it is allowed to *scalar-replace* the object: instead of allocating on the heap, the object's fields live in registers or on the stack.

```java
public Money total(List<LineItem> items) {
    Money sum = new Money(0L, USD);
    for (LineItem i : items) {
        sum = sum.plus(i.amount());      // allocates a new Money per iteration
    }
    return sum;
}
```

C2 sees that each intermediate `Money` is *immediately* superseded by the next one — none of them escape. After scalar replacement, the loop looks (in machine code) like:

```
long sumMinor = 0;
Currency sumCur = USD;
for each item:
    sumMinor += item.amountMinor;
    // currency unchanged
return new Money(sumMinor, sumCur);   // only this one allocates
```

One allocation, not N. The wrapper is free in the hot path.

**Confirm.** Run with `-XX:+UnlockDiagnosticVMOptions -XX:+PrintEliminateAllocations`. The output names every allocation site that was scalar-replaced.

**When EA fails.** EA gives up when:

- The object escapes through a method return, exception, or field assignment.
- The compilation tier is C1 (interpreter / tier 1) — only C2 does scalar replacement reliably.
- The method is too large to inline its callees, breaking the optimization chain.

A `Money` returned from a public method *does* escape — at the API boundary. But the *intermediates* inside loops usually don't.

---

## 3. Records and the JIT — why they're friendly to optimise

Records cooperate with the JIT more than handwritten classes do:

- **Implicit `final` class and `final` fields.** No subclass can override `equals`, `hashCode`, or accessors. The JIT can inline aggressively without virtual-dispatch tax.
- **Tiny accessors.** `value()` is a one-line getter. Inlined to a field load.
- **No `this` leak.** No mutating method can publish `this` mid-construction.

Records were designed (JEP 395) with both *programmer ergonomics* and *JIT friendliness* in mind. Treat them as the JIT-preferred form for value types.

---

## 4. Autoboxing — the silent enemy

Generics in Java are erased; collections hold `Object`, which means primitives must be boxed.

```java
List<Integer> counts = new ArrayList<>();
counts.add(7);                  // autobox to Integer.valueOf(7)
int first = counts.get(0);      // autounbox via intValue()
```

For `Integer.valueOf(n)` where `-128 <= n <= 127`, the JDK uses a cache — no allocation. Outside that range, every boxing allocates an `Integer`. In a hot loop with large numbers, this is real cost.

**Pitfall:** wrapping a primitive in a typed `record` does *not* eliminate boxing if the type appears in a generic collection:

```java
record Cents(long value) {}
List<Cents> cents = new ArrayList<>();
cents.add(new Cents(100));      // still allocates Cents on the heap
```

The boxing is hidden, but the allocation is the same. For dense numerical data, prefer specialised primitive collections (`IntStream`, `LongStream`, `Eclipse Collections` `LongArrayList`).

**Detection.** SpotBugs's `BX_BOXING_IMMEDIATELY_UNBOXED` catches the common case where you box a value and immediately unbox it — usually a sign of accidental conversion.

---

## 5. The `Optional` allocation question

```java
public Optional<Money> findBalance(AccountId id) { ... }
```

`Optional<Money>` is two allocations: the `Optional` wrapper plus the `Money`. In hot code (a query loop hitting a cache 10 million times a second), this can show in profiles.

Two mitigations:

- **Trust EA.** If the caller immediately unpacks (`balance.orElseThrow()`, `balance.map(...)`), the `Optional` often gets scalar-replaced.
- **Return a sentinel.** `Money.zero(USD)` instead of `Optional.empty()` works if "absent" has a sensible default.

The JDK itself uses `OptionalInt`, `OptionalLong`, `OptionalDouble` to avoid the boxing-in-Optional issue for primitives. There is no equivalent for user-defined value types — yet (Valhalla addresses this).

---

## 6. Project Valhalla — the inflection point

**JEP 401: Value Classes and Objects (Preview).** A `value class` is a class that:

- Has no identity (`==` is forbidden).
- Has implicitly final fields and a final class declaration.
- Can be *flattened* in containers — a `value class[]` array is a contiguous bit-pattern, not an array of pointers.

The semantics that matter for Primitive Obsession:

```java
value record Money(long minorUnits, Currency currency) { ... }   // illustrative syntax

class Account {
    Money balance;     // *flattened* — 12 bytes inline, no header, no pointer
}
```

When Valhalla ships in a final form, the cost of `Money` as a field approaches the cost of `long balance` + `Currency currency` directly inlined. The 32-byte-per-instance overhead from §1 disappears.

**Status check.** JEP 401 is *Preview* as of mid-2026. Syntax and semantics are stable enough to design around, but production deployment requires a feature flag and a benchmark gate. Watch the OpenJDK release notes for the *final* JEP.

**Practical move now.** Write your wrappers as `record`s. When Valhalla finalises, the migration to `value class` is essentially a keyword change.

---

## 7. The narrow case for raw primitives

There is a small set of code where primitives remain the right answer even in a wrapper-friendly codebase:

- **Tight numerical algorithms.** A FFT, a matrix multiplication, a Monte Carlo simulation — the entire algorithm consumes `double[]` arrays. Wrapping each cell as `record Sample(double value)` blows the cache and serialises memory access.
- **Bit-twiddling.** Bloom filters, bitmasks, packed integer encoding — primitives *are* the domain.
- **JNI boundaries.** Native calls take primitives. Wrappers must unwrap at the JNI layer regardless.
- **Tiny private helpers.** A static method inside one class that takes `int n` and returns `int` doesn't benefit from `Count`.

The rule is *not* "wrap everything regardless of context" — it's "wrap everywhere domain concepts cross a boundary; leave primitives where they're already the domain".

---

## 8. Measuring with JMH

Speculation is the enemy. Measure.

```java
@BenchmarkMode(Mode.AverageTime)
@OutputTimeUnit(TimeUnit.NANOSECONDS)
@State(Scope.Benchmark)
public class MoneyBench {
    private List<Money> moneys;
    private long[] cents;

    @Setup public void setup() {
        moneys = new ArrayList<>();
        cents = new long[1_000_000];
        for (int i = 0; i < 1_000_000; i++) {
            moneys.add(new Money(i, USD));
            cents[i] = i;
        }
    }

    @Benchmark public long sumMoneys() {
        long s = 0;
        for (Money m : moneys) s += m.minorUnits();
        return s;
    }

    @Benchmark public long sumPrimitives() {
        long s = 0;
        for (long c : cents) s += c;
        return s;
    }
}
```

Expected: the primitive version is somewhat faster (cache-friendly array vs. pointer-chasing `ArrayList`). The wrapper version is often only 1.5–3× slower, not 10×. The cost is real but rarely catastrophic.

**Run with profiles.** `-prof gc` shows allocation rate; `-prof perfasm` shows the actual machine code. Don't optimise without profiles.

---

## 9. Allocation pressure and GC

Even when individual allocations are cheap, *rate* matters. A service that allocates 1 GB/sec of `Money` records puts heavy load on the young generation. The G1 collector handles it, but at the cost of more frequent young-gen collections and higher CPU.

Mitigations, in order of preference:

- **Reduce allocation rate.** Cache the wrappers when they're stable (e.g., `IsoCurrency.USD` as a static final).
- **Trust EA.** Profile first — many allocations never actually reach the heap.
- **Drop to primitives in the hot loop.** Re-wrap at the boundary.
- **Wait for Valhalla.** Flattening eliminates the allocation entirely for fields and arrays.

**Profile:** `-Xlog:gc*=info` shows young-gen collection frequency. If it's < 100ms apart, allocation pressure is the issue.

---

## 10. Quick rules

- [ ] **Default to records.** They are JIT-friendly, escape-analysis-friendly, and the right design.
- [ ] **Trust escape analysis.** Verify with `-XX:+PrintEliminateAllocations` before pessimising.
- [ ] **Drop to primitives only inside hot loops** where JMH confirms a 2×+ gap. Re-wrap at the boundary.
- [ ] **Watch autoboxing.** `List<Integer>` boxes; `IntStream` doesn't.
- [ ] **Cache stable wrappers.** `IsoCurrency.USD` as a constant beats `new IsoCurrency("USD")` per call.
- [ ] **Track Valhalla.** When JEP 401 finalises, the allocation argument against wrappers largely disappears.

---

## 11. What's next

| Topic                                                            | File              |
| ---------------------------------------------------------------- | ----------------- |
| Hands-on exercises                                               | `tasks.md`         |
| Interview Q&A                                                    | `interview.md`     |

Related smells:

- [Data Clumps](../08-data-clumps/) — same allocation considerations apply to parameter objects.
- [Immutability](../../05-immutability/) — immutability and EA-friendliness reinforce each other.

---

**Memorize this:** Records are 32-byte allocations that the JIT often scalar-replaces away. The headline cost is rarely the actual cost. Measure with JMH, verify with `-XX:+PrintEliminateAllocations`, drop to primitives only in hot loops, watch for autoboxing in generic collections, and track Project Valhalla — when JEP 401 ships, the wrapper-vs-primitive trade-off mostly disappears.
