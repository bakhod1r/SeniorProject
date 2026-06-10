# Comparable vs Comparator Contracts — Middle

> **What?** Worked refactors that take legacy `compareTo` and `Comparator` code and rebuild it with the modern toolkit: `Comparator.comparing`, `.thenComparing`, primitive specializations, null-safety, and the "consistent with equals" discipline. Each section starts from real code you would meet in a five-year-old codebase and ends with a diff you could land in one PR.
> **How?** Treat every old comparator as a candidate for one of three transformations: replace `a - b` with `Integer.compare`, replace hand-rolled multi-field `compareTo` with chained `Comparator.comparing`, and reconcile `compareTo` with `equals` so sorted collections don't silently drop members.

---

## 1. Why one comparator is rarely enough

The first sort you ever write — "by age, ascending" — fits in three lines. The second one — "by department, then by hire date, then by name, with nulls last" — is where engineers either learn the chaining API or start writing thirty-line `compare` methods by hand.

The hand-rolled version is almost always wrong in one of three ways: integer overflow on differences, asymmetric handling of `null`, or returning non-canonical values that later trip a `.reversed()`. The chained version is a one-line composition built from operations with explicit names. Reach for the chain by default.

This file walks five real refactors, in order: an overflow fix; a multi-key chain; a null-safety story; the `compareTo`/`equals` discipline; and the sort-stability subtlety that bites when the comparator returns "equal" but you wanted a stable order.

---

## 2. Refactor 1 — fixing integer overflow in a legacy `compareTo`

A five-year-old `Transaction` class has:

```java
public final class Transaction implements Comparable<Transaction> {
    private final long timestampMs;
    private final long amountCents;
    private final String accountId;

    @Override
    public int compareTo(Transaction other) {
        long diff = this.timestampMs - other.timestampMs;
        if (diff != 0) return (int) diff;                 // (1) cast loses sign
        long amtDiff = this.amountCents - other.amountCents;
        if (amtDiff != 0) return (int) amtDiff;           // (2) same trap
        return this.accountId.compareTo(other.accountId);
    }
}
```

Two bugs in one method. `(long) - (long)` does not overflow at the `long` level, but `(int) diff` truncates: if `diff == 4_300_000_000L`, `(int) diff` is `4_300_000_000 - 2 * Integer.MAX_VALUE`, a *negative* number. Two timestamps a few years apart can flip the sign of `compareTo`.

The fix is mechanical. Replace each `a - b` with the matching `Xxx.compare`:

```java
public final class Transaction implements Comparable<Transaction> {
    private final long timestampMs;
    private final long amountCents;
    private final String accountId;

    @Override
    public int compareTo(Transaction other) {
        int c = Long.compare(this.timestampMs, other.timestampMs);
        if (c != 0) return c;
        c = Long.compare(this.amountCents, other.amountCents);
        if (c != 0) return c;
        return this.accountId.compareTo(other.accountId);
    }
}
```

`Long.compare(x, y)` returns `-1`, `0`, or `+1` based purely on the sign of `x - y` *evaluated mathematically* — no truncation, no overflow. The same applies to `Integer.compare`, `Double.compare`, `Float.compare`, `Boolean.compare`, `Short.compare`, `Byte.compare`, and `Character.compare`. Every primitive wrapper has one. Use it.

But we can do better. The whole method body is a textbook case for `Comparator.comparing`:

```java
private static final Comparator<Transaction> NATURAL =
    Comparator.comparingLong(Transaction::timestampMs)
              .thenComparingLong(Transaction::amountCents)
              .thenComparing(Transaction::accountId);

@Override
public int compareTo(Transaction other) {
    return NATURAL.compare(this, other);
}
```

Four lines, no overflow, no manual nesting. The static comparator is constructed once and reused — and we'll see in `optimize.md` why HotSpot likes that.

---

## 3. Refactor 2 — multi-key Comparator chain for orders

A fulfilment service wants the day's orders sorted by placement time (oldest first), with a secondary key on total descending (to pick the most valuable ties first), then by order id ascending for a fully deterministic tie-breaker. The legacy code:

```java
public class OrderSorting {
    public static void sortForFulfilment(List<Order> orders) {
        orders.sort((a, b) -> {
            int c = a.placedAt().compareTo(b.placedAt());
            if (c != 0) return c;
            c = b.total().compareTo(a.total());      // descending — note arg flip
            if (c != 0) return c;
            return a.id().compareTo(b.id());
        });
    }
}
```

This compiles and runs. It also has a subtle review problem: the `b.total().compareTo(a.total())` line *flips arguments* to invert the ordering, which the reader has to spot. Every reviewer pays a small cost. The chained version makes the intent explicit:

```java
private static final Comparator<Order> FULFILMENT_ORDER =
    Comparator.comparing(Order::placedAt)
              .thenComparing(Order::total, Comparator.reverseOrder())
              .thenComparing(Order::id);

public static void sortForFulfilment(List<Order> orders) {
    orders.sort(FULFILMENT_ORDER);
}
```

`thenComparing(Order::total, Comparator.reverseOrder())` says, in English, "next, compare by total in reverse order". No argument flip to read past, no hidden inversion. The same chain can also be expressed as:

```java
Comparator.comparing(Order::placedAt)
          .thenComparing(Comparator.comparing(Order::total).reversed())
          .thenComparing(Order::id);
```

Both are correct; the first reads more linearly. Pick one style per codebase.

A separate factory keeps `Order` clean of any ordering opinion — `Order` is a value, the sort is a *use case*. If someone needs "newest first, then by customer" tomorrow, they write a new static comparator constant; `Order` is untouched.

---

## 4. Refactor 3 — primitive specializations vs `Comparator.comparing`

`Comparator.comparing(Order::total)` works because `BigDecimal` is `Comparable`. For primitives, prefer the primitive specializations: `comparingInt`, `comparingLong`, `comparingDouble`. They take an `Int|Long|Double`-valued function and avoid autoboxing.

```java
public record Sensor(String id, int channelId, long lastReadingNs, double lastValue) {}

// Boxes int through Integer — extra allocation per comparison:
Comparator<Sensor> boxed = Comparator.comparing(Sensor::channelId);

// Primitive specialization — no boxing:
Comparator<Sensor> primitive = Comparator.comparingInt(Sensor::channelId);

// And they chain with primitive-aware variants:
Comparator<Sensor> chain =
    Comparator.comparingInt(Sensor::channelId)
              .thenComparingLong(Sensor::lastReadingNs)
              .thenComparingDouble(Sensor::lastValue);
```

`thenComparingInt` / `thenComparingLong` / `thenComparingDouble` exist exactly so a chain that starts on a primitive can continue on a primitive without boxing the secondary keys either. The `optimize.md` file shows the JMH numbers; for now treat it as a habit — if the key is a primitive, use the primitive comparator.

For `BigDecimal` and other reference types, plain `comparing` is the right call — there is no primitive to specialize on.

---

## 5. Refactor 4 — null-safe comparators

A real comparator must answer: *what happens when a key is `null`?* The default behaviour of `Comparator.comparing(...)` is to call `.compareTo` on the extracted key, which throws `NullPointerException` if the key is null. Sometimes you want that — null is a programming bug, fail fast. More often you want null to sort somewhere predictable.

`Comparator.nullsFirst(...)` and `Comparator.nullsLast(...)` wrap another comparator and decide where nulls go:

```java
public record Customer(long id, String surname, LocalDate lastOrderAt) {}

// Customers without a last-order date go to the end:
Comparator<Customer> byLastOrder =
    Comparator.comparing(Customer::lastOrderAt,
                         Comparator.nullsLast(Comparator.naturalOrder()));

// Or, with an inline lambda for the key extractor:
Comparator<Customer> byLastOrderInline = Comparator.comparing(
    Customer::lastOrderAt,
    Comparator.nullsLast(LocalDate::compareTo)
);
```

The signature you reach for here is the three-argument form:

```java
public static <T, U> Comparator<T> comparing(
    Function<? super T, ? extends U> keyExtractor,
    Comparator<? super U> keyComparator);
```

The second argument is *how the keys themselves are ordered*. Putting `nullsLast(...)` there decorates that key comparator with null handling. The result is a `Comparator<Customer>` that never throws on a null `lastOrderAt`.

A common mistake is to wrap the *outer* comparator instead of the *key* comparator:

```java
// Wrong — only handles null Customer, not null lastOrderAt:
Comparator<Customer> oops = Comparator.nullsLast(
    Comparator.comparing(Customer::lastOrderAt));
```

Read carefully: the outer `nullsLast` here protects against a *null Customer* in the list. The inner `comparing` will still throw when it dereferences `Customer::lastOrderAt` on a non-null Customer with a null date. Two different nulls, two different decisions; usually you want both.

The full belt-and-braces form:

```java
Comparator<Customer> safe = Comparator.nullsLast(
    Comparator.comparing(Customer::lastOrderAt, Comparator.nullsLast(Comparator.naturalOrder()))
);
```

Don't write that out by reflex — most lists don't actually contain `null` elements. But when the keys can be null, decorate the *key* comparator.

---

## 6. Refactor 5 — "consistent with equals"

The `Comparable` javadoc strongly *recommends* (but does not require) that `(x.compareTo(y) == 0)` ⇔ `x.equals(y)`. When this holds, the type is said to be **consistent with equals**.

Why does it matter? Because the *sorted* collections — `TreeSet`, `TreeMap`, and anything backed by them — use the *comparator's* notion of equality, not `equals`/`hashCode`. If your `compareTo` says two distinct objects compare as `0`, a `TreeSet` treats them as duplicates and silently drops one. (We'll do this story in detail in `senior.md`; here is the version every middle-level engineer needs.)

A legacy class:

```java
public final class Receipt implements Comparable<Receipt> {
    private final long id;
    private final BigDecimal amount;

    @Override
    public int compareTo(Receipt other) {
        return this.amount.compareTo(other.amount);   // ordering by amount only
    }

    @Override
    public boolean equals(Object o) {
        return o instanceof Receipt r && this.id == r.id;
    }

    @Override
    public int hashCode() { return Long.hashCode(id); }
}
```

`compareTo` looks at `amount`. `equals` looks at `id`. Two receipts with the same amount but different ids are `equals == false` but `compareTo == 0`. The trap:

```java
Receipt a = new Receipt(1L, new BigDecimal("10.00"));
Receipt b = new Receipt(2L, new BigDecimal("10.00"));

Set<Receipt> hashSet = new HashSet<>();
hashSet.add(a); hashSet.add(b);
hashSet.size();                       // 2 — equals/hashCode used; both kept

Set<Receipt> treeSet = new TreeSet<>();
treeSet.add(a); treeSet.add(b);
treeSet.size();                       // 1 — compareTo says equal; second is dropped
```

Two perfectly valid objects, same `equals` contract, *different* set semantics depending on which collection you reached for. That is the disciplined warning: when your type implements both, make them agree, or document loudly that they don't.

The fix, if "all distinct receipts must survive a sort", is to make `compareTo` also disambiguate by `id`:

```java
private static final Comparator<Receipt> NATURAL =
    Comparator.comparing(Receipt::amount)
              .thenComparingLong(Receipt::id);

@Override
public int compareTo(Receipt other) {
    return NATURAL.compare(this, other);
}
```

Now `compareTo == 0` only when both `amount` and `id` match — which is exactly what `equals` requires. The sort still orders primarily by amount; ties between distinct receipts are broken by id, and `TreeSet` keeps both.

There is a famous standard-library case where `compareTo` and `equals` *legitimately* diverge: `BigDecimal`. `new BigDecimal("1.0").compareTo(new BigDecimal("1.00")) == 0` (they compare equal numerically) but `new BigDecimal("1.0").equals(new BigDecimal("1.00")) == false` (they differ in scale). That's covered in `senior.md` and is one of the most-cited Java quirks in interviews.

---

## 7. Refactor 6 — locale and case-sensitivity in String comparison

`String.compareTo` is *not* a natural language ordering. It compares UTF-16 code units. That happens to be fine for ASCII identifiers and the vast majority of database keys; it produces *wrong* orderings for human-readable text in any non-English locale.

A legacy library sorting customer surnames:

```java
people.sort(Comparator.comparing(Customer::surname));
```

This works for ASCII. For names like *Ürün*, *Çetin*, *Łabęcki*, *Müller* it produces an ordering most readers will call buggy: "Müller" < "Ödön" < "Z…" because *Ö* sorts after *Z* in UTF-16 (its code point is U+00D6, *Z* is U+005A).

For locale-aware sorting use `java.text.Collator`:

```java
import java.text.Collator;
import java.util.Locale;

Collator turkish = Collator.getInstance(new Locale("tr", "TR"));
turkish.setStrength(Collator.SECONDARY);   // ignore case but respect accents

people.sort(Comparator.comparing(Customer::surname, turkish));
```

`Collator` is itself a `Comparator<Object>`, so it plugs into the three-argument `comparing` directly. Setting the strength controls what differences matter:

- `PRIMARY` — base letter only (treats *e* == *é* == *E*).
- `SECONDARY` — accents matter, case doesn't.
- `TERTIARY` — case matters too. (Default.)
- `IDENTICAL` — Unicode normalization differences matter.

In practice for surname sorts, `SECONDARY` is what users expect.

This is the moment to mention that `Comparator.comparing(...)` with a third-argument comparator is the workhorse signature you'll come back to over and over: anywhere a key needs special ordering, that's where you plug it in. Don't fall back to writing a custom `compare` body to "handle locale" — pass a `Collator`.

---

## 8. Refactor 7 — sort stability and Timsort

`Arrays.sort(Object[])` and `List.sort(...)` are *stable* since Java 7 — they preserve the relative order of elements that compare as equal. The underlying algorithm is *Timsort*, an adaptive merge sort. `Arrays.sort(int[])` and the other primitive overloads use a *dual-pivot quicksort* that is *not* stable, but you can't pass a `Comparator` to those anyway, so stability rarely matters there.

Why does stability matter? When your comparator returns `0` for two elements, you usually want their *previous order* preserved — the order they came from the upstream query, the order the user typed them into the form, the order the upstream API returned them. Without stability, that gets shuffled.

```java
List<Order> orders = ...; // already in "received from API" order
orders.sort(Comparator.comparing(Order::placedAt));
// because List.sort is stable, two orders with the same placedAt
// keep the original "received" order between them.
```

The implication for `Comparator` design: if your comparator returns `0` and stability gives you the order you want, *don't add a tiebreaker*. A redundant tiebreaker hides the dependency on the upstream ordering and slows the sort marginally.

The opposite trap: if your code relies on a tiebreaker and someone reorganises the upstream pipeline, the output silently changes. When the output order must be deterministic regardless of input order, *add* a tiebreaker (an id, a UUID, a creation timestamp) — don't lean on stability alone.

```java
// Deterministic regardless of input order — explicit tiebreaker on id:
Comparator<Order> deterministic =
    Comparator.comparing(Order::placedAt)
              .thenComparing(Order::id);
```

A pragmatic rule: the moment the comparator's return value crosses a process boundary (logs, exports, snapshot tests), put in the explicit tiebreaker. Stability is fine *inside* a method; it is a poor substitute for an explicit contract *across* methods.

---

## 9. Refactor 8 — three-way compare vs sign-only return

A historical pattern, especially before Java 8:

```java
public int compareTo(Event other) {
    if (this.time < other.time) return -1;
    if (this.time > other.time) return +1;
    return 0;
}
```

It works. It's also five lines for what `Long.compare` does in one. Worse, it's easy to drop a case and have a subtle bug:

```java
// Buggy — never returns +1, so equal and greater are conflated:
public int compareTo(Event other) {
    if (this.time < other.time) return -1;
    return 0;
}
```

Reach for the static helper:

```java
public int compareTo(Event other) {
    return Long.compare(this.time, other.time);
}
```

For chained comparisons, the chain pattern from sections 2-4 is even cleaner. Hand-written three-way `if`-chains belong in code older than Java 7.

---

## 10. Pitfalls that survive the chain refactor

**Chained comparator stores a method reference, not the lookup.** `Comparator.comparing(Order::placedAt)` doesn't memoize the result of `placedAt()`; it calls the method *twice per comparison* (once for `this`, once for `other`). For an `O(n log n)` sort, that's `2 * n * log n` method calls. If the extractor is expensive (a database lookup, a synchronized method, a virtual call through a deep hierarchy), the sort becomes slow surprisingly fast. The fix is to pre-extract into an array of keys, sort the *array*, and reassemble. Use `Comparator.comparing` for cheap accessors; otherwise look at `optimize.md`.

**Lambdas captured comparators don't equal each other.** Two comparators built from the same lambda are *not* `.equals()`. If you ever store comparators in a `Set` (don't), the dedup will fail. Treat comparators as opaque function values.

**`reversed()` after a chain reverses the *whole* chain.**

```java
Comparator.comparing(Order::placedAt)
          .thenComparing(Order::id)
          .reversed();           // reverses BOTH keys, not just the last one
```

If you want only the secondary key reversed, build it inline:

```java
Comparator.comparing(Order::placedAt)
          .thenComparing(Order::id, Comparator.reverseOrder());
```

This bites people when "newest first, then alphabetical" silently becomes "newest first, then reverse alphabetical".

**Capturing mutable state in a comparator.** A comparator that reads `System.currentTimeMillis()` or a counter from a field produces *different* answers on successive calls and breaks the contract. Comparators must be pure.

---

## 11. The decision flow

When you have a sort to write, walk through these questions in order:

1. **Is there one obvious, intrinsic ordering for this type?** If yes, implement `Comparable<T>`. If "obvious" requires a comment, the answer is no.
2. **Are the keys primitive (`int`, `long`, `double`)?** If yes, use `comparingInt` / `comparingLong` / `comparingDouble`.
3. **Are there multiple keys?** Chain with `.thenComparing(...)`.
4. **Can any key be `null`?** Wrap the key comparator in `nullsFirst` / `nullsLast`.
5. **Are keys human-readable strings?** Use a `Collator` for the appropriate locale.
6. **Should `compareTo` be consistent with `equals`?** Add a final tiebreaker (id, UUID) to make ties impossible between distinct objects, *or* document the divergence loudly.
7. **Do you need deterministic order across runs?** Add a tiebreaker even if stability gives you the in-process order — exports and snapshot tests are not stable across pipeline changes.

That flow turns 90% of "I need to sort these" tickets into a single `Comparator.comparing(...)` chain.

---

## 12. Quick rules

- [ ] `Integer.compare` / `Long.compare` / `Double.compare` instead of subtraction. Always.
- [ ] Multi-key sort → chain with `thenComparing`, not nested `if`.
- [ ] Primitive keys → `comparingInt` / `comparingLong` / `comparingDouble` to avoid boxing.
- [ ] Reference keys with null → `nullsFirst` / `nullsLast` around the *key* comparator.
- [ ] Human-readable strings → `Collator`, not `String.compareTo`.
- [ ] Make `compareTo` consistent with `equals`, or add a tiebreaker, or document the divergence.
- [ ] Stable sort is *within* one method; add an explicit tiebreaker when the order must hold across runs.
- [ ] Chained `reversed()` reverses the whole chain — invert per-key inline when you mean per-key.
- [ ] Build comparators as `private static final` constants; one allocation, easy to reuse.

---

## 13. What's next

| Topic                                                          | File              |
| -------------------------------------------------------------- | ----------------- |
| TreeSet/BigDecimal traps, locale, generics                     | `senior.md`        |
| Code review, lint rules, mentoring on this contract            | `professional.md`  |
| JLS/Javadoc references for both interfaces                     | `specification.md` |
| Buggy snippets — overflow, NaN, inconsistency, locale          | `find-bug.md`      |
| Primitive specializations, JIT, dispatch                       | `optimize.md`      |
| Hands-on exercises                                             | `tasks.md`         |
| Interview Q&A                                                  | `interview.md`     |

---

**Memorize this:** every legacy `compareTo` body collapses into a `Comparator.comparing(...).thenComparing(...)` chain. `Integer.compare` replaces every `a - b`. Primitive specializations beat boxed extractors. `nullsFirst`/`nullsLast` decorate the *key* comparator. `Collator` is the correct choice for human text. And the only reason your sorted set silently drops elements is that `compareTo` returned `0` where `equals` returned `false` — fix that with a tiebreaker or face it head-on in a comment.
