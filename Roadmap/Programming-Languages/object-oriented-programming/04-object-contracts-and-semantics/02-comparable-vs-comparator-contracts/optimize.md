# Comparable vs Comparator Contracts — Optimize

> Ten performance angles where comparator design touches real cycles: integer-compare versus subtraction, primitive specializations, comparator caching, method references, sort algorithm choice (Timsort vs Dual-Pivot QuickSort), chain cost, sealed-types alternatives, nearly-sorted input, `PriorityQueue` per-op cost, and when a hand-rolled `compareTo` still beats a chained `Comparator`. Closes with a JMH sketch comparing the chained idiom to a manually written `compare` method.
>
> Numbers are illustrative — verify in your JVM with JMH and `-prof gc`. Cross-references: design intent lives in [middle.md](middle.md) and [senior.md](senior.md); the JLS-level contract clauses in [specification.md](specification.md).

---

## 1. `Integer.compare(a, b)` versus `a - b`

The `return a - b;` idiom is wrong for correctness reasons covered in [find-bug.md §1](find-bug.md). It also produces *different machine code* than `Integer.compare`, in ways that matter for hot loops.

```java
// (a) subtraction:
return a - b;                            // one SUB + sign extraction by the caller

// (b) Integer.compare — implemented as:
return (a < b) ? -1 : (a == b) ? 0 : 1;  // two compares + two conditional moves
```

C2 emits `(a)` as a single subtraction and lets the caller branch on the sign. C2 emits `(b)` as two compares feeding two conditional-move (`cmovl`/`cmovne`) instructions — no branches at all. On modern x86, `cmov` resolves at the same latency as `sub` but does not pollute the branch predictor. Inside a tight sort loop, the absence of mispredicted branches dominates the extra instruction.

Microbenchmark numbers (representative, JDK 21, x86-64, 10M-element `int[]` sort):

| Comparator body            | Sort time | Notes                                  |
| -------------------------- | --------- | -------------------------------------- |
| `a - b`                    | ~190 ms   | Correct only for narrow input ranges   |
| `Integer.compare(a, b)`    | ~185 ms   | Branchless, correct for all inputs     |
| Hand-rolled `if`-chain     | ~210 ms   | Same shape as `(b)` but JIT inlines less consistently |

The performance difference is small — the correctness difference is total. Choose `Integer.compare`. The same argument applies to `Long.compare`, `Double.compare`, `Float.compare`.

---

## 2. Primitive specializations — `comparingInt`, `comparingLong`, `comparingDouble`

`Comparator.comparing(Sensor::channelId)` extracts an `int`, *autoboxes it* to `Integer`, and calls `Integer.compareTo`. Inside `Arrays.sort`, that happens once per pairwise comparison — `O(n log n)` boxings on a list of `n` sensors.

```java
public record Sensor(String id, int channelId, long lastReadingNs, double lastValue) {}

Comparator<Sensor> boxed     = Comparator.comparing(Sensor::channelId);          // boxes
Comparator<Sensor> primitive = Comparator.comparingInt(Sensor::channelId);       // no box
```

The `comparingInt` overload takes a `ToIntFunction<? super T>` — a functional interface whose abstract method returns `int`, not `Integer`. No `Integer.valueOf(...)` is called, no `Integer` object is allocated. The chain continues with `thenComparingInt`, `thenComparingLong`, `thenComparingDouble` so that secondary keys also stay unboxed.

```java
Comparator<Sensor> chain =
    Comparator.comparingInt(Sensor::channelId)
              .thenComparingLong(Sensor::lastReadingNs)
              .thenComparingDouble(Sensor::lastValue);
```

JMH numbers on a 1M-element list (`-prof gc` enabled, JDK 21):

| Comparator                                              | Time      | GC allocation rate |
| ------------------------------------------------------- | --------- | ------------------ |
| `Comparator.comparing(Sensor::channelId)` (boxed)       | ~125 ms   | ~32 MB/op          |
| `Comparator.comparingInt(Sensor::channelId)`            | ~95 ms    | ~0 MB/op           |

The wall-clock difference is ~25%; the allocation difference is dramatic. In throughput-sensitive paths (a request handler that sorts a result set on every call), the allocation rate matters even more than the wall-clock difference because it drives young-generation GC pressure.

Rule of thumb: if the key extractor returns an unboxed primitive type, use the matching `comparingXxx`. Otherwise use plain `comparing`.

---

## 3. Comparator caching — `static final` for hot paths

A comparator built freshly inside a method allocates one object per call:

```java
public List<Order> sortedForFulfilment(List<Order> orders) {
    return orders.stream()
        .sorted(Comparator.comparing(Order::placedAt)
                          .thenComparing(Order::total, Comparator.reverseOrder())
                          .thenComparing(Order::id))         // (*)
        .toList();
}
```

Line `(*)` allocates a chain of three `Comparators$ThenComparingComparator` objects on every call. For an endpoint that's hit a thousand times a second, that's three thousand allocations per second of comparator chain — a small but measurable young-gen footprint.

Hoist to a `static final` constant:

```java
public final class OrderSorting {

    private static final Comparator<Order> FOR_FULFILMENT =
        Comparator.comparing(Order::placedAt)
                  .thenComparing(Order::total, Comparator.reverseOrder())
                  .thenComparing(Order::id);

    public List<Order> sortedForFulfilment(List<Order> orders) {
        return orders.stream().sorted(FOR_FULFILMENT).toList();
    }
}
```

Now the chain is built once at class-init time and reused for every call. The JIT also benefits — a `static final` reference is a *trusted constant*, so HotSpot can specialise the call site to the exact comparator implementation it sees, including inlining the lambdas inside.

Two corollaries:

- **Don't build comparators inside loops** — the same comparator used `n` times in a hot loop should be a local `final` constant, not rebuilt each iteration.
- **Don't capture mutable state in a comparator** — if the comparator closes over a mutable field, the JIT can't trust it as a constant, and you'll pay the indirection on every call.

---

## 4. Method references vs lambdas — usually identical, occasionally not

```java
Comparator<Order> a = Comparator.comparing(Order::placedAt);          // method reference
Comparator<Order> b = Comparator.comparing(o -> o.placedAt());        // lambda
```

Both compile to an `invokedynamic` bytecode that calls `LambdaMetafactory`. For an instance method reference on the parameter type, both produce essentially the same generated class and the same machine code. There is no observable performance difference in benchmarks that exercise only the extraction path.

Two cases where they *do* differ:

1. **Method references to a static method** can be more aggressively shared. The JDK's `Integer::compare` and `String::compareTo` are well-known reference targets the JIT can identify and inline directly.
2. **Lambdas that capture state** allocate a small closure object on each evaluation if escape analysis fails. Method references that bind only to method tables don't capture and don't allocate.

```java
// Captures `pivot` — closure allocation if EA fails:
Comparator<Order> distanceFromPivot = (a, b) ->
    Integer.compare(Math.abs(a.total().intValue() - pivot),
                    Math.abs(b.total().intValue() - pivot));
```

Practical advice: prefer method references when the call site is naturally a method-reference shape. Use lambdas when the body genuinely needs an expression. Don't rewrite `Comparator.comparing(Order::placedAt)` into a lambda for "consistency" — the method reference is the cleaner artefact.

---

## 5. Sort algorithm — Timsort for objects, Dual-Pivot QuickSort for primitives

`Arrays.sort` and `List.sort` use *two completely different* algorithms depending on element type. The choice was made in Java 7 (JEP 152 area) and has not changed.

| Method                                | Algorithm              | Stability | Worst case |
| ------------------------------------- | ---------------------- | --------- | ---------- |
| `Arrays.sort(int[])`, `long[]`, etc.  | Dual-Pivot QuickSort   | Unstable  | O(n²) (extremely rare) |
| `Arrays.sort(Object[])`               | Timsort                | Stable    | O(n log n) |
| `Arrays.sort(Object[], Comparator)`   | Timsort                | Stable    | O(n log n) |
| `List.sort(Comparator)`               | Timsort (via `Arrays`) | Stable    | O(n log n) |
| `Collections.sort(List)`              | Timsort (via `Arrays`) | Stable    | O(n log n) |
| `Collections.sort(List, Comparator)`  | Timsort (via `Arrays`) | Stable    | O(n log n) |

Three operational consequences:

- **Object sorts are stable.** Two elements that compare as `0` keep their input order. The chained `thenComparing` idiom relies on this; if Java had picked an unstable sort, every tiebreak would have to be explicit.
- **Primitive sorts are unstable.** Doesn't matter for primitives (two equal `int`s are indistinguishable), but if you ever wrap and sort, you've moved to the Timsort path anyway.
- **Timsort detects already-sorted runs.** Nearly-sorted input runs in O(n), not O(n log n) — see §8.

Don't try to "outsmart" the JDK sort. Replacing it with a hand-rolled QuickSort is almost always slower and certainly less stable.

---

## 6. The cost of `thenComparing` chains

Every `.thenComparing(...)` link in a comparator chain is one extra method call per pairwise comparison. The compiled chain looks roughly like:

```
compare(a, b)
   -> firstKey.compare(a, b)
   -> if zero, secondKey.compare(a, b)
   -> if zero, thirdKey.compare(a, b)
```

For a monomorphic call site — the same chained comparator used for every sort — HotSpot inlines the whole chain into one tight method. The cost of a three-key chain is roughly the cost of three primitive comparisons plus two conditional jumps. Negligible.

For a *megamorphic* call site — different comparators flowing through the same `List.sort` call across the program — the JIT may give up on inlining and fall back to virtual dispatch on each link. Three-key chain becomes three virtual calls per pairwise comparison.

```java
// Megamorphic — different comparators per request:
public List<Order> sortBy(List<Order> orders, Comparator<Order> dynamic) {
    return orders.stream().sorted(dynamic).toList();
}
```

If `dynamic` varies across calls, every link of every chain it contains becomes a virtual call. The mitigation isn't to abandon `thenComparing` — it's to keep the comparators themselves stable. Build the `dynamic` comparator from a small set of `static final` building blocks; the JIT sees a finite set of shapes and stays in the bimorphic-or-better zone.

Rough JMH on a 1M-element list with a three-key chain:

| Shape                                                 | Time per sort |
| ----------------------------------------------------- | ------------- |
| One `static final` chain, used everywhere             | ~145 ms       |
| Chain rebuilt on every call (heap-allocated)          | ~165 ms       |
| Chain selected from 20+ dynamic shapes (megamorphic)  | ~210 ms       |

The largest single improvement is going from "dynamic shape" to "small fixed set of shapes", not chain-length tuning.

---

## 7. Sealed types + pattern matching as a `compareTo` alternative

For a closed set of variants, modern Java allows comparator implementation by pattern match instead of inheritance or chained extraction:

```java
public sealed interface Payment
        permits CardPayment, BankTransfer, CashOnDelivery {}

public record CardPayment(BigDecimal amount, String panLast4) implements Payment {}
public record BankTransfer(BigDecimal amount, String iban)     implements Payment {}
public record CashOnDelivery(BigDecimal amount)                implements Payment {}

// External comparator using pattern matching:
public static final Comparator<Payment> BY_AMOUNT_THEN_KIND = (a, b) -> {
    int c = ((Payment & Cmp) a).amount().compareTo(((Payment & Cmp) b).amount());
    if (c != 0) return c;
    return Integer.compare(rank(a), rank(b));
};

private static int rank(Payment p) {
    return switch (p) {
        case CardPayment   __ -> 0;
        case BankTransfer  __ -> 1;
        case CashOnDelivery __ -> 2;
    };
}
```

Two performance benefits:

- **Devirtualization is complete.** The `permits` clause is a class-file attribute. HotSpot knows the closed set; pattern-switch lowers to a typeswitch bytecode (JEP 441) the JIT specialises into a direct type-check chain — no virtual dispatch.
- **No `instanceof` chain.** A hand-written `if (p instanceof CardPayment) ... else if (...)` is harder to specialise; the pattern-switch carries a hash-or-jump tag that the JIT can use to emit a table jump for three or more cases.

Combined with records (which are themselves implicitly `final`), this gives you fast dispatch *and* the OCP idiom: adding a new payment kind is a new record plus a new case in `rank`. The compiler's exhaustiveness check refuses to forget. See [../../03-design-principles/01-solid-principles/](../../03-design-principles/01-solid-principles/) on OCP via sealed types.

---

## 8. Sorting nearly-sorted data — Timsort is O(n) best case

A request handler that re-sorts a list every few seconds typically sees a list that's *mostly* still sorted from the previous round — a few inserts, a few updates. Timsort exploits this: it identifies pre-existing runs (ascending or descending) and merges them rather than re-sorting.

```java
List<Order> orders = ...;       // already sorted by placedAt
orders.add(newOrder);           // one new element at the end
orders.sort(BY_PLACED_AT);      // Timsort scans, sees one run of n-1 plus a singleton.
                                // Cost: roughly O(n) — one linear scan + one merge.
```

For a list with `k` "disorder points" — places where the sort order is locally violated — Timsort runs in O(n log k), not O(n log n). For an essentially-sorted list (`k` small and bounded), the practical cost is O(n).

This pays off in two common patterns:

- **Incremental rebuilds.** A scheduler maintains a list sorted by deadline; each tick adds a few jobs and re-sorts. Timsort finishes in linear time even on millions of jobs.
- **Stable resorts on a new key.** A list sorted by primary key, when re-sorted on a chain that includes the same primary key first, retains stability and exits quickly.

What *doesn't* benefit: a sort over uniformly random data (the worst case for Timsort, though still O(n log n)). And a sort with frequent comparator changes — each new comparator forces a full re-sort.

If your domain produces nearly-sorted input, you don't need a custom algorithm. You need to feed it to `List.sort` and trust the existing implementation.

---

## 9. `PriorityQueue` — O(log n) per insertion, but watch the comparator

`PriorityQueue<E>` is a binary heap. `offer` and `poll` are `O(log n)`; `peek` is `O(1)`; `remove(Object)` is `O(n)`. The comparator is called inside `siftUp` and `siftDown`, roughly `log n` times per `offer` and `poll`.

```java
// Hot-path job scheduler — millions of offers and polls per second:
PriorityQueue<Job> queue =
    new PriorityQueue<>(Comparator.comparingInt(Job::weight));

queue.offer(j);   // log n compareInt calls
Job next = queue.poll();   // another log n compareInt calls
```

Three optimization angles specific to `PriorityQueue`:

- **Use a primitive specialization.** Boxing the key inside `compare` defeats the heap's tight inner loop — see §2.
- **Cache the comparator.** Building a new `Comparator` for each queue costs at construction time only; sharing one `static final` instance helps the JIT.
- **Don't `remove(Object)` in a hot loop.** It's linear because the queue has to scan for the value. If you need to remove arbitrary elements, use `TreeSet` (logarithmic but with rebalancing) or an indexed heap structure with O(log n) removal.

JMH numbers on a 1M-element queue with a primitive-int key:

| Comparator                                     | offer + poll per op |
| ---------------------------------------------- | ------------------- |
| `Comparator.comparingInt(Job::weight)`         | ~210 ns             |
| `Comparator.comparing(Job::weight)` (boxed)    | ~340 ns             |
| Custom `Comparator` lambda `(a,b) -> a.weight() - b.weight()` | ~270 ns (incorrect for overflow inputs) |

The "incorrect but fast" lambda is faster than the boxed version because it skips the `Integer.compare` indirection — but it's wrong, and the difference vs the correct primitive specialization is a few dozen nanoseconds. Always pick correctness; the primitive specialization is essentially free.

---

## 10. When a custom `compareTo` still beats a chained `Comparator`

Most code should use chained `Comparator` factories. They're more readable, more null-safe, and JIT-friendly. But a hand-rolled `compareTo` *can* be slightly faster, in two specific cases.

**Case 1: short-circuit on the cheapest key.** A chained `Comparator.comparing` always extracts the first key for both objects before deciding to look at the second. A hand-rolled body can branch on a fast tag and skip the rest:

```java
public final class Order implements Comparable<Order> {
    private final int statusOrdinal;     // cheap to compare
    private final BigDecimal total;      // expensive — BigDecimal compareTo
    private final long placedAtNanos;

    @Override
    public int compareTo(Order other) {
        // Most pairs differ on status — short-circuit there.
        int c = Integer.compare(this.statusOrdinal, other.statusOrdinal);
        if (c != 0) return c;
        c = this.total.compareTo(other.total);
        if (c != 0) return c;
        return Long.compare(this.placedAtNanos, other.placedAtNanos);
    }
}
```

The chained equivalent does the same thing logically, but each link is a separate method call. Hand-rolling collapses to one method body; one less indirection per pairwise compare. Difference: ~5% on a 1M-element sort.

**Case 2: composite keys with a known fast path.** If 99% of comparisons can be answered by examining a single packed-`long` representation, a hand-rolled `compareTo` lets you compute it inline:

```java
@Override
public int compareTo(Trade other) {
    // Packed: (priceBucket << 48) | (timestampMillis & 0xFFFFFFFFFFFFL)
    return Long.compareUnsigned(this.packed, other.packed);
}
```

A chained `Comparator` would extract each field separately, which the JIT cannot collapse into one packed-`long` comparison.

For 99% of codebases, neither case justifies giving up the chained-`Comparator` idiom. Reach for hand-rolled only when (a) the profiler shows the comparator is hot, (b) the keys have a natural fast path, and (c) you can document the optimization in a comment that survives the next refactor.

---

## 11. JMH sketch — chained `Comparator` vs hand-rolled `compareTo`

```java
@BenchmarkMode(Mode.AverageTime)
@OutputTimeUnit(TimeUnit.MILLISECONDS)
@State(Scope.Benchmark)
@Fork(value = 2)
@Warmup(iterations = 5, time = 1)
@Measurement(iterations = 10, time = 1)
public class ComparatorBench {

    public record Order(int statusOrdinal, BigDecimal total, long placedAtNanos) {}

    private static final Comparator<Order> CHAINED =
        Comparator.comparingInt(Order::statusOrdinal)
                  .thenComparing(Order::total)
                  .thenComparingLong(Order::placedAtNanos);

    private static final Comparator<Order> HAND_ROLLED = (a, b) -> {
        int c = Integer.compare(a.statusOrdinal(), b.statusOrdinal());
        if (c != 0) return c;
        c = a.total().compareTo(b.total());
        if (c != 0) return c;
        return Long.compare(a.placedAtNanos(), b.placedAtNanos());
    };

    @Param({"10000", "100000", "1000000"}) int size;
    Order[] data;

    @Setup(Level.Invocation)
    public void seed() {
        Random r = new Random(42);
        data = new Order[size];
        for (int i = 0; i < size; i++) {
            data[i] = new Order(r.nextInt(5),
                                new BigDecimal(r.nextInt(10_000)),
                                r.nextLong());
        }
    }

    @Benchmark public Order[] chained()    { Arrays.sort(data, CHAINED);     return data; }
    @Benchmark public Order[] handRolled() { Arrays.sort(data, HAND_ROLLED); return data; }
}
```

Representative results (JDK 21, x86-64):

| Size      | Chained    | Hand-rolled | Delta  |
| --------- | ---------- | ----------- | ------ |
| 10,000    | ~3.2 ms    | ~3.1 ms     | ~3%    |
| 100,000   | ~38 ms     | ~37 ms      | ~3%    |
| 1,000,000 | ~480 ms    | ~445 ms     | ~7%    |

The hand-rolled version is consistently faster, but by single-digit percentages even at one million elements. For 99% of code, the readability and null-safety of the chained form is worth the small difference. Reach for hand-rolled only when the profiler names this exact comparator.

Always include `-prof gc` in the JMH run — `comparing` boxes if you forget the primitive specialization, and the GC profile will reveal it instantly.

---

## Quick rules

- [ ] **Never `return a - b;`.** Use `Integer.compare`, `Long.compare`, `Double.compare`.
- [ ] **Use primitive specializations** (`comparingInt`, `thenComparingLong`, etc.) when the key extractor returns a primitive.
- [ ] **Cache comparators as `static final`** for any comparator used more than once or used in a hot path.
- [ ] **Trust the JDK sort.** Timsort is stable and O(n) on nearly-sorted input.
- [ ] **For closed variant sets**, sealed types + pattern matching dispatch beats chained `instanceof`.
- [ ] **For megamorphic call sites**, reduce the comparator-shape variance — fewer distinct comparators flowing through one `sort` call lets the JIT inline.
- [ ] **Profile before hand-rolling `compareTo`.** The chained form is fast enough for almost all code.
- [ ] **In a `PriorityQueue` hot loop, every `compare` call is on the critical path** — primitive specializations and `static final` instances pay off in nanoseconds.
- [ ] **Measure GC allocations too** (`-prof gc`). A boxed comparator's wall-clock cost is small; its allocation rate isn't.

The general law: comparator performance is dominated by *correctness* choices (no overflow, no boxing, no per-call allocation), not by clever micro-optimization. Get those right and the JIT handles the rest.
