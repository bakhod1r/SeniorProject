# Comparable vs Comparator Contracts — Practice Tasks

Eight exercises that force each piece of the `compareTo`/`Comparator` contract to bite. Most are refactors of code that compiles fine but breaks the moment a stakeholder feeds it the wrong row (a negative balance, a draft order, a Turkish surname). Domains are drawn from payments, fulfilment, telemetry, and i18n.

Work each task in three passes: (1) read the snippet and name the smell using the contract vocabulary (antisymmetry, transitivity, consistent-with-equals, null handling, locale, stability), (2) sketch the new shape on paper, (3) write code and a small test that would have caught the original problem.

Cross-references: [middle.md](middle.md) for the chained-comparator refactors, [senior.md](senior.md) for the inconsistent-with-equals discussion, [find-bug.md](find-bug.md) for the failure modes.

---

## Task 1 — Fix integer overflow in a legacy `compareTo`

```java
public final class Position implements Comparable<Position> {
    private final long accountId;
    private final int  shares;
    private final long openedAtNanos;

    public Position(long accountId, int shares, long openedAtNanos) {
        this.accountId = accountId;
        this.shares = shares;
        this.openedAtNanos = openedAtNanos;
    }

    @Override
    public int compareTo(Position other) {
        int c = this.shares - other.shares;
        if (c != 0) return c;
        return (int) (this.openedAtNanos - other.openedAtNanos);
    }
}
```

**Objective.** Rewrite `compareTo` so it returns the correct sign for every pair of inputs, including pairs whose share counts span the full `int` range and timestamps that differ by more than 2^31 nanoseconds.

**Constraints.**
- No `a - b` arithmetic anywhere in the method body.
- Method body length unchanged or shorter.
- The natural order remains: by `shares` ascending, then by `openedAtNanos` ascending. No other key.

**Acceptance criteria.**
- A test feeds the pair `(shares = Integer.MAX_VALUE, …)` and `(shares = Integer.MIN_VALUE, …)` and asserts the comparator returns positive (not negative).
- A test feeds two positions with `openedAtNanos` differing by `Long.MAX_VALUE / 2` and asserts the sign is correct.
- `Arrays.sort` on a list with both extremes mixed in does not throw `IllegalArgumentException: Comparison method violates its general contract!`.
- The class compiles unchanged for callers (`compareTo` signature must not change).

---

## Task 2 — Design natural order for a `Money` value record

```java
// Skeleton — you finish it.
public record Money(long minorUnits, Currency currency) implements Comparable<Money> {

    public Money {
        Objects.requireNonNull(currency);
    }

    @Override
    public int compareTo(Money other) {
        // TODO
    }
}
```

**Objective.** Implement `compareTo` so that the natural order is well-defined, transitive, consistent with `equals` (the record's auto-generated `equals` compares both fields), and does not overflow for any pair of `long minorUnits` values.

**Constraints.**
- The class must implement `Comparable<Money>` and respect all four contract clauses, including "consistent with equals" (this is critical because `Money` is a candidate to live in a `TreeSet`).
- Comparing two `Money` instances with *different currencies* is a programming bug — throw a runtime exception with a clear message, not a meaningless ordering.
- No `a - b` arithmetic.

**Acceptance criteria.**
- `Money.of(100, USD).compareTo(Money.of(200, USD))` returns negative.
- `Money.of(100, USD).compareTo(Money.of(100, EUR))` throws `IllegalArgumentException` with a message naming both currencies.
- For any two `Money` instances `a` and `b` with the same currency: `a.compareTo(b) == 0` if and only if `a.equals(b)`.
- A `TreeSet<Money>` populated with one-cent-apart values does not collapse them.
- A test sorts `new Money(Long.MAX_VALUE, USD)` and `new Money(Long.MIN_VALUE, USD)` and verifies the result is correctly ordered (no overflow).

---

## Task 3 — Multi-key `Comparator` chain for orders

```java
public record Order(long id,
                    long customerId,
                    OrderStatus status,
                    Instant placedAt,
                    BigDecimal total) {}

public enum OrderStatus { DRAFT, PLACED, PACKED, SHIPPED, DELIVERED, CANCELLED }
```

A fulfilment dashboard wants today's orders sorted as follows:
1. Most recent first (descending `placedAt`).
2. Then customer id ascending (deterministic grouping for the same instant).
3. Then `total` descending (process larger orders first within a customer).

**Objective.** Build *one* `Comparator<Order>` constant using the modern factories (`Comparator.comparing`, `.thenComparing`, `.reversed`, primitive specializations, null-safety). Do not write any explicit `if`/`return` chain.

**Constraints.**
- Build a single `static final Comparator<Order> FOR_FULFILMENT` constant in a `OrderSorting` class.
- `placedAt` can be `null` for draft orders — drafts must sort *last* (not throw).
- Use the most readable form: `thenComparing(Order::total, Comparator.reverseOrder())` reads better than chained argument-flips. See [middle.md §3](middle.md).

**Acceptance criteria.**
- The constant is one expression, no statement body.
- A test seeds five orders (two with the same `placedAt` and different `customerId`, one draft with `null` placedAt, two with the same instant *and* customer and different totals) and asserts the exact output order.
- A test mutates one of the input orders (impossible for a record) — confirm the comparator never reads more than three fields.
- No `instanceof`, no explicit null check inside the comparator body.

**Worked solution sketch** — see end of file.

---

## Task 4 — Locale-aware ordering with `Collator`

```java
public final class CustomerDirectory {

    public List<Customer> sortedByDisplayName(List<Customer> customers) {
        return customers.stream()
                .sorted(Comparator.comparing(Customer::displayName))
                .toList();
    }
}

public record Customer(long id, String displayName, Locale preferredLocale) {}
```

The current implementation uses `String.compareTo`, which is UTF-16 code-unit ordering. German users complain that `Strauß` appears between `Strauss` and `Z`. Turkish users complain that `İstanbul` appears far from `Istanbul`.

**Objective.** Replace the comparator with a locale-aware one based on `java.text.Collator`.

**Constraints.**
- The directory should be constructible for a specific `Locale` (a German directory, a Turkish directory).
- Accents must matter (`SECONDARY` strength), but case must not (`Strauss` and `strauss` collide).
- The `Collator` instance must be cached as a field, not created per call.

**Acceptance criteria.**
- For `Locale.GERMAN`, the sequence `["Maier", "Mueller", "Müller", "Strauss", "Strauß", "Zeppelin"]` sorts to a German-dictionary order (the exact answer depends on whether you choose default German collation or phonebook collation — document which).
- For `Locale.forLanguageTag("tr")`, the sequence `["İstanbul", "Istanbul", "Izmir", "İzmir"]` sorts according to the Turkish dotted-vs-dotless `i` rule.
- A test confirms that two strings differing only in case sort as equal.
- No `String.compareTo` and no `Comparator.naturalOrder()` on `String` appear anywhere in the file.

---

## Task 5 — TreeSet uniqueness for `BigDecimal`

```java
public final class PriceLevels {

    private final Set<BigDecimal> levels = new TreeSet<>();

    public void mark(BigDecimal price) {
        levels.add(price);
    }

    public int distinctLevels() {
        return levels.size();
    }
}
```

A market-data analytics job uses this class to count "distinct trading levels per session". It under-reports — `100.00` and `100.0` are counted as one level, even though `BigDecimal.equals` says they are different.

**Objective.** Make `distinctLevels()` agree with `equals`-style uniqueness — `100.00` and `100.0` must count as two distinct levels.

**Constraints.**
- The class must continue to support iteration in sorted order (some downstream code expects the levels sorted ascending).
- Do not change the public API (`mark`, `distinctLevels`).
- You may add new methods (e.g., `sortedLevels()`).

**Acceptance criteria.**
- After `mark(new BigDecimal("100.0"))` and `mark(new BigDecimal("100.00"))`, `distinctLevels()` returns 2.
- After `mark(new BigDecimal("99.50"))` and `mark(new BigDecimal("100.00"))`, the sorted output starts with `99.50` and ends with `100.00`.
- A test mixing `99.5`, `99.50`, and `99.500` reports `distinctLevels() == 3`.
- The internal data structure choice is justified in a comment — either a `HashSet` plus on-demand sort, or a `TreeSet` with a tiebreaker comparator that fully discriminates by scale.

---

## Task 6 — Refactor `Collections.sort(list, cmp)` to `list.sort(cmp)`

```java
public final class LegacySorting {

    public static void sortByName(List<Customer> customers) {
        Collections.sort(customers, new Comparator<Customer>() {
            @Override
            public int compare(Customer a, Customer b) {
                if (a.surname() == null && b.surname() == null) return 0;
                if (a.surname() == null) return -1;
                if (b.surname() == null) return  1;
                return a.surname().compareTo(b.surname());
            }
        });
    }

    public static void sortByAge(List<Person> people) {
        Collections.sort(people, new Comparator<Person>() {
            @Override
            public int compare(Person a, Person b) {
                return a.age() - b.age();
            }
        });
    }
}
```

**Objective.** Modernise this code to Java 8+ idioms — replace `Collections.sort(list, cmp)` with `list.sort(cmp)`, replace anonymous-class comparators with `Comparator` factory methods, fix the `a - b` overflow.

**Constraints.**
- Method signatures unchanged.
- No anonymous inner classes after the refactor.
- Null handling for `surname` must be explicit — nulls first or nulls last, your choice, but documented.
- No `a - b` anywhere.

**Acceptance criteria.**
- `sortByName` has a body of one statement.
- `sortByAge` has a body of one statement.
- Both comparators are built using `Comparator.comparing`, `comparingInt`, `nullsLast`, etc.
- Existing tests for both methods (assume they pass on alphabetic/positive-age input) continue to pass.
- A new test that feeds `Person(age = Integer.MIN_VALUE)` and `Person(age = Integer.MAX_VALUE)` to `sortByAge` produces the correct order (the old code would have overflowed).

---

## Task 7 — Stable sort preserving insertion order for equal keys

A workflow engine processes tasks in priority order; among tasks of the same priority, the engine must process them in *insertion order* (FIFO within a priority class).

```java
public record WorkflowTask(long insertionSequence, int priority, String payload) {}

public final class WorkflowQueue {

    private final List<WorkflowTask> tasks = new ArrayList<>();
    private long nextSeq = 0;

    public void enqueue(int priority, String payload) {
        tasks.add(new WorkflowTask(nextSeq++, priority, payload));
    }

    public List<WorkflowTask> drainInExecutionOrder() {
        // TODO — return tasks sorted by priority (ascending = lower priority first),
        // breaking ties by insertion order.
    }
}
```

**Objective.** Implement `drainInExecutionOrder()` so that the returned list orders tasks by priority ascending, with FIFO behaviour within each priority class.

**Constraints.**
- You may rely on the JDK sort being stable (Timsort) — but you must *document* in a one-line comment that your implementation relies on stability, since this is a precondition not visible in the code.
- Alternatively, encode the tiebreaker explicitly in the comparator (more defensive — survives a hypothetical switch to an unstable sort).
- The method drains the queue — after the call, `tasks` is empty.

**Acceptance criteria.**
- A test enqueues `(prio=5, "A"), (prio=1, "B"), (prio=5, "C"), (prio=1, "D")` and asserts the drain order is `B, D, A, C`.
- A test with 1000 tasks of the same priority preserves insertion order exactly.
- A code review reads the method and can tell within ten seconds whether the implementation relies on Timsort's stability or encodes the tiebreaker explicitly.
- The method body is at most ~8 lines.

---

## Task 8 — Fix a `PriorityQueue` with a broken comparator

```java
public final class AlertQueue {

    private final PriorityQueue<Alert> queue = new PriorityQueue<>(
        (a, b) -> a.severity().ordinal() - b.severity().ordinal());     // (1)

    public void offer(Alert alert) {
        queue.offer(alert);
    }

    public Alert peekHighestSeverity() {
        return queue.peek();
    }
}

public record Alert(String message, Severity severity, Instant raisedAt) {}
public enum Severity { INFO, WARN, ERROR, FATAL }
```

The queue is supposed to keep the *highest* severity at the head. Two problems are reported:

1. Sometimes the head of the queue is `WARN` even though a `FATAL` alert was offered earlier.
2. When an `Alert` has a `null` `severity` (a defensive case the team didn't think about), the queue throws `NullPointerException` inside `offer`.

**Objective.** Fix both problems and add tests that would have caught them.

**Constraints.**
- The queue keeps the highest severity at the head — i.e., `FATAL` should be polled before `ERROR`, `ERROR` before `WARN`, etc.
- Alerts with `null` severity must be treated as the *lowest* severity (sort behind everything else) — a defensive default, not an exception.
- Among alerts of the same severity, the older `raisedAt` should be polled first (FIFO within a severity class).
- No `a - b` arithmetic.
- The comparator is built once as `static final`.

**Acceptance criteria.**
- A test offering `[INFO@t0, FATAL@t1, WARN@t2, FATAL@t3]` polls `FATAL@t1` first, then `FATAL@t3`, then `WARN@t2`, then `INFO@t0`.
- A test offering an `Alert` with `null` severity sees it polled *last*.
- No `NullPointerException` is thrown by `offer` for any input.
- The comparator constant compiles with `Comparator.comparing(... , Comparator.nullsLast(...))` and `.thenComparing(...)` — not a hand-rolled lambda body.

---

## Validation

| Task | How to verify the fix                                                                                  |
| ---- | ------------------------------------------------------------------------------------------------------ |
| 1    | The pair `(Integer.MAX_VALUE, Integer.MIN_VALUE)` returns positive; Timsort never throws on a 10k random list with both extremes. |
| 2    | A `TreeSet<Money>` of 1000 one-cent-apart values has size 1000; cross-currency comparison throws.       |
| 3    | The five-element fixture sorts to a specific documented order; the comparator references at most three method references. |
| 4    | Sorting `["Müller", "Mueller", "Maier"]` under `Locale.GERMAN` produces a dictionary-correct order; `String.compareTo` does not appear in the file. |
| 5    | `distinctLevels()` for three differently-scaled "100" values returns 3; sorted iteration still works. |
| 6    | Both methods are one statement long; the age test with `MIN_VALUE`/`MAX_VALUE` passes.                 |
| 7    | A 1000-task same-priority FIFO test passes; the stability assumption (or explicit tiebreaker) is documented. |
| 8    | `FATAL` alerts always poll before anything else; a `null`-severity alert polls last; no NPE on offer. |

---

## Worked solution sketch — Task 3 (multi-key Comparator chain)

```java
public final class OrderSorting {

    // Single static-final constant — built once at class init, shared across all calls.
    // Reading order = sorting order:
    //   1. placedAt descending (newest first), nulls (draft orders) sort last
    //   2. customerId ascending (deterministic grouping)
    //   3. total descending (process largest first within a customer)
    public static final Comparator<Order> FOR_FULFILMENT =
        Comparator.comparing(
                      Order::placedAt,
                      Comparator.nullsLast(Comparator.<Instant>reverseOrder()))   // (1)
                  .thenComparingLong(Order::customerId)                            // (2)
                  .thenComparing(Order::total, Comparator.reverseOrder());         // (3)

    public static List<Order> sortedForFulfilment(List<Order> orders) {
        return orders.stream().sorted(FOR_FULFILMENT).toList();
    }

    private OrderSorting() {}   // utility class, no instances
}
```

Three things to notice in the sketch.

**At `(1)`, the null-safety lives on the key comparator, not the outer comparator.** `Comparator.nullsLast(Comparator.reverseOrder())` says: order non-null `Instant` values in reverse (newest first), and put null `Instant` values at the end. Wrapping the *outer* comparator with `nullsLast` would protect against null `Order` references in the list — a different (and rarely relevant) concern.

**At `(2)`, `thenComparingLong` uses the primitive specialization.** `customerId` is a `long`. Plain `thenComparing(Order::customerId)` would autobox each id to `Long` on every comparison; `thenComparingLong` avoids the allocation. See [optimize.md §2](optimize.md).

**At `(3)`, the inversion uses the two-argument form.** `thenComparing(Order::total, Comparator.reverseOrder())` reads as "next, compare by total in reverse order". Compare to the argument-flip alternative `.thenComparing((a, b) -> b.total().compareTo(a.total()))` — same behaviour, harder to read, lambda body that mostly looks like a typo.

The test would look something like:

```java
@Test
void fulfilmentOrderRespectsAllThreeKeys() {
    Instant t1 = Instant.parse("2026-05-19T10:00:00Z");
    Instant t2 = Instant.parse("2026-05-19T09:00:00Z");

    Order draft   = new Order(1, 100, OrderStatus.DRAFT,    null, new BigDecimal("50"));
    Order o2_high = new Order(2, 100, OrderStatus.PLACED,  t1,   new BigDecimal("200"));
    Order o2_low  = new Order(3, 100, OrderStatus.PLACED,  t1,   new BigDecimal("100"));
    Order o3      = new Order(4, 200, OrderStatus.PLACED,  t1,   new BigDecimal("150"));
    Order older   = new Order(5, 100, OrderStatus.PLACED,  t2,   new BigDecimal("300"));

    List<Order> in = List.of(draft, o2_low, o2_high, o3, older);

    assertEquals(
        List.of(o2_high, o2_low, o3, older, draft),
        OrderSorting.sortedForFulfilment(in));
}
```

Notice the *draft* lands at the end (nulls-last on the first key), `o2_high` and `o2_low` are grouped on the same `placedAt` and ordered by total desc, and `older` lands after the `t1` group.

---

**Memorize this:** every task above starts from code that compiles and runs correctly *on a happy input*. The contract bugs only fire when the input set widens to include negative balances, draft rows, multilingual names, or `null` keys. A well-designed comparator says — out loud, in code — what it does when those edge cases appear. If you can't read your `compareTo`/`Comparator` and answer "what does this do for two equal keys?", "what does it do for null?", "what does it do for `Integer.MIN_VALUE`?", the next person to read it can't either, and the bug ships.
