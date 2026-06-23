# Comparable vs Comparator — Interview Q&A

20 questions covering definitions, contracts, snippet critiques, traps, and senior-level judgement.

---

## Q1. What's the difference between `Comparable` and `Comparator`?

`Comparable<T>` defines a class's **natural ordering** — the type itself implements `compareTo(T other)`. There is exactly one natural ordering per type. `Comparator<T>` is an **external** ordering — a separate object that compares two `T`s. Many comparators can coexist for the same type, allowing different sort orders (by date, by price, by name, descending). Rule of thumb: implement `Comparable` when one ordering is *obviously* the right default (`LocalDate`, `Integer`, `Money`); use `Comparator` for everything else, including alternate orderings.

**Follow-up:** "Can a type implement both?" — yes. `Integer implements Comparable<Integer>`, and you can still write `Comparator.comparingInt(Integer::intValue).reversed()` for descending order.

---

## Q2. State the four clauses of the `compareTo` contract.

(1) **Antisymmetric:** `sgn(a.compareTo(b)) == -sgn(b.compareTo(a))`. (2) **Transitive:** if `a.compareTo(b) > 0` and `b.compareTo(c) > 0`, then `a.compareTo(c) > 0`. (3) **Consistent on equality:** if `a.compareTo(b) == 0`, then for any `c`, `sgn(a.compareTo(c)) == sgn(b.compareTo(c))`. (4) **Recommended (not required) consistent with `equals`:** `(a.compareTo(b) == 0) == a.equals(b)`. Violating (4) is allowed but breaks `TreeSet` / `TreeMap` uniqueness semantics — those collections use `compareTo`, not `equals`, to test membership.

**Trap:** Saying "compareTo must be consistent with equals". The JLS *recommends* it; it doesn't require. `BigDecimal` famously breaks it.

---

## Q3. Critique this snippet.

```java
public int compareTo(Account other) {
    return this.balance - other.balance;     // both ints
}
```

Integer overflow. If `this.balance = Integer.MIN_VALUE` and `other.balance = 1`, the subtraction overflows to a *positive* value — and the contract claims `this < other`. Fix:

```java
return Integer.compare(this.balance, other.balance);
```

`Integer.compare` returns `-1`, `0`, or `1` with no overflow. The same applies to `Long.compare`, `Double.compare`, `Boolean.compare`. The "subtraction trick" is one of the most common compareTo bugs and lives in many old codebases.

**Follow-up:** "What if the field is `long`?" — same trap, but with a `long` overflow. Use `Long.compare(this.balance, other.balance)`.

---

## Q4. Explain the BigDecimal scale trap.

`new BigDecimal("1.0").compareTo(new BigDecimal("1.00")) == 0`, but `new BigDecimal("1.0").equals(new BigDecimal("1.00")) == false`. `BigDecimal.equals` considers scale; `compareTo` doesn't. The consequence: a `TreeSet<BigDecimal>` containing `1.0` thinks it already contains `1.00` (uses compareTo); a `HashSet<BigDecimal>` containing the same `1.0` will accept `1.00` as a different element (uses equals + hashCode). Two collections, two answers, same data. Mitigation: normalize the scale before insertion, or use `setScale(...)` consistently, or use a `Comparator` that explicitly considers scale.

**Trap:** Assuming "sets contain unique elements" without knowing which equality the set uses.

---

## Q5. When is `compareTo` allowed to be inconsistent with `equals`?

Any time the natural ordering captures a "rough" notion that's coarser than equality. `BigDecimal` is the classic case (numeric value vs representation). Another: case-insensitive Strings (`"hello".compareToIgnoreCase("HELLO") == 0` but not equal). Document the inconsistency in the class Javadoc, and warn callers that sorted collections (`TreeSet`, `TreeMap`, `PriorityQueue`) will treat distinct-but-comparable values as duplicates. The senior call: prefer consistency unless the domain truly demands an ordering that ignores some equality-relevant fields.

**Follow-up:** "Why does the JDK ship BigDecimal this way?" — historical. `equals` compares the underlying representation; `compareTo` compares the value. The split is a design choice, not a bug.

---

## Q6. How does `Comparator.comparing` work?

`Comparator.comparing(keyExtractor)` is a static factory that turns a key-extraction function into a comparator. Example: `Comparator.comparing(Order::placedAt)` produces a `Comparator<Order>` that compares two orders by their `placedAt` values (using the key's natural ordering). Variants `comparingInt`, `comparingLong`, `comparingDouble` avoid boxing. The factory is the foundation of modern Java's fluent comparator construction.

```java
Comparator<Order> byDate = Comparator.comparing(Order::placedAt);
list.sort(byDate);
```

**Trap:** Forgetting that the *key* must be `Comparable`. For non-Comparable keys, use the overload `Comparator.comparing(extractor, keyComparator)`.

---

## Q7. Critique this chained `Comparator`.

```java
Comparator<Order> cmp = Comparator
    .comparing(Order::customer)              // Customer may be null
    .thenComparing(Order::placedAt);
list.sort(cmp);
```

If any order has `customer == null`, the first link throws NPE inside `Comparator.comparing`'s key extraction. Fix with explicit null handling:

```java
Comparator<Order> cmp = Comparator
    .comparing(Order::customer, Comparator.nullsLast(Comparator.naturalOrder()))
    .thenComparing(Order::placedAt);
```

Or, if customers are never null in well-formed data, validate before sorting and let the NPE propagate as a *contract violation*. The choice depends on whether nulls are legal in the domain.

**Trap:** Adding `nullsFirst`/`nullsLast` to silence the NPE without understanding why nulls appear.

---

## Q8. What does `Comparator.thenComparing` actually return?

A *new* `Comparator` that compares using the first comparator and, when that returns 0, falls back to the second. It's a *lazy* chain — the second comparator is only consulted on ties. Each `thenComparing` call wraps another layer; deep chains are a few extra method calls per comparison, which the JIT inlines for monomorphic call sites. The functional style replaces the old `if (cmpA == 0) return cmpB.compare(...); return cmpA;` boilerplate.

```java
Comparator.comparing(Order::placedAt)
          .reversed()                        // desc by date
          .thenComparing(Order::customerId)  // asc by customer
          .thenComparing(Order::total).reversed();  // desc by total — BUG
```

**Trap:** `.reversed()` after a chain reverses the *whole composite*, not the last link. Use `.thenComparing(Order::total, Comparator.reverseOrder())` to reverse just one key.

---

## Q9. What does locale-aware String comparison change?

`"a".compareTo("Z")` returns a positive number — lowercase `a` is sorted after uppercase `Z` because the comparison is Unicode code-point order, not lexical. For human-language sort (alphabetizing names in a UI), use `Collator`:

```java
Collator de = Collator.getInstance(Locale.GERMAN);
list.sort(de::compare);
```

German `Collator` knows that `ß` collates after `ss`. English `Collator` doesn't. The default `String.compareTo` knows neither. For internationalized apps, locale-aware comparison is the only correct shape; for internal IDs and SKUs, code-point order is fine.

**Follow-up:** "When does code-point order surprise users?" — sorting Turkish text without a Collator: dotted-`İ` and dotless-`ı` interact unexpectedly.

---

## Q10. What does Java guarantee about sort stability?

`Arrays.sort(Object[])` and `List.sort(Comparator)` use **Timsort** (since Java 7), which is **stable** — equal elements preserve their original order. `Arrays.sort(int[])` and other primitive sorts use Dual-Pivot Quicksort, which is **not stable** (and stability is irrelevant for primitives, since equal primitives are indistinguishable). For multi-key sorts via separate passes, stability is the property that lets you "sort by tertiary key first, then secondary, then primary" and get the expected lexicographic result. In practice, modern code uses `Comparator.thenComparing` instead, which is also stable.

**Trap:** Assuming `Stream.sorted()` is stable for parallel streams. It's stable for sequential streams; parallel streams may reorder equal elements.

---

## Q11. Critique this snippet with a null first key.

```java
List<Order> orders = ...;
orders.sort(Comparator.comparing(Order::shippingDate));
// orders contains some Orders where shippingDate == null
```

NPE during sort. `Comparator.comparing` invokes `Order::shippingDate` for both arguments; either return null, the natural-order comparison on null throws NPE. Fix:

```java
orders.sort(Comparator.comparing(Order::shippingDate, Comparator.nullsLast(Comparator.naturalOrder())));
```

Now nulls sort to the end, non-nulls sort by date among themselves. Choose `nullsFirst` if nulls should appear at the start.

**Follow-up:** "What if I want nulls to fail loudly instead of sorting?" — validate the input before sort. Sorting nulls is often a hint that the data model should disallow them.

---

## Q12. What is PECS in the context of `Comparator`?

*Producer Extends, Consumer Super* — Joshua Bloch's mnemonic. A method that *consumes* `T` values for comparison should accept `Comparator<? super T>`, so a `Comparator<Animal>` can be used to sort `List<Dog>`. Example from the JDK:

```java
public static <T> void sort(List<T> list, Comparator<? super T> c) { ... }
```

The `? super T` bound makes the API flexible: a `Comparator<Object>` can sort *any* list. The wider the bound, the more reusable the comparator. PECS is the reason every `sort` method in the standard library uses this bound — and the reason your custom sort utilities should too.

**Trap:** Writing `Comparator<T>` exactly (invariant) — it locks out compatible supertype comparators.

---

## Q13. Critique this multi-key sort.

```java
Comparator<Order> cmp = Comparator
    .comparing(Order::placedAt).reversed()
    .thenComparing(Order::customerId)
    .thenComparing(Order::total).reversed();
```

The final `.reversed()` reverses the **whole chain**, not just the last `thenComparing`. The author probably wanted: date desc, customer asc, total desc. They got: date asc (first reverse cancelled by second), customer desc, total desc. Fix:

```java
Comparator<Order> cmp = Comparator
    .comparing(Order::placedAt, Comparator.reverseOrder())
    .thenComparing(Order::customerId)
    .thenComparing(Order::total, Comparator.reverseOrder());
```

Or use named comparators that are explicit per-key. Inline `.reversed()` is a common multi-key trap.

**Follow-up:** "How would you read this in review?" — name the variables: `byDateDesc`, `byCustomerAsc`, `byTotalDesc`, then chain. Self-documenting beats clever.

---

## Q14. Sealed types + pattern matching as a `compareTo` alternative — pros and cons?

**Pros:** exhaustive dispatch — the compiler forces every variant to be handled. No fragile inheritance. Type-safe. Often faster (sealed switch lowers to a type-check chain the JIT handles well).

**Cons:** doesn't fit *all* compareTo use cases — it's about *which type wins* in mixed-type comparison, not natural ordering of a single type. Most domain types still want a plain `compareTo` per the natural-ordering contract. Sealed-switch compareTo is more useful for *algebraic* data types (Success vs Failure, Card vs Bank vs Crypto payments) where the ordering depends on the variant.

```java
public sealed interface Priority permits High, Medium, Low { }
public static int rank(Priority p) {
    return switch (p) {
        case High h -> 0;
        case Medium m -> 1;
        case Low l -> 2;
    };
}
```

**Trap:** Sealed-type compareTo for value records where the variant doesn't matter. Stick with a plain comparator there.

---

## Q15. What's the performance cost of method-reference comparators?

Negligible. `Comparator.comparing(Order::placedAt)` compiles to the same `invokedynamic` lambda site as `Comparator.comparing(o -> o.placedAt())`. The JIT inlines monomorphic comparator chains entirely; the cost is no different from a hand-rolled `int compare(Order a, Order b)`. The exception: `comparingInt(extractor)` (primitive specialization) is *measurably* faster than `comparing(extractor)` on primitives because it avoids Integer boxing per comparison. For hot inner loops over primitives, prefer the typed variant.

**Follow-up:** "What about chain depth?" — five `.thenComparing` calls cost five method calls per comparison. JIT inlines them when monomorphic. For 10+ links on a megamorphic site, profile.

---

## Q16. When should a `Comparator` be `static final`?

When it's used in hot code paths and doesn't depend on per-instance state. Lifting the comparator to a static final avoids re-creating the lambda chain per call:

```java
public final class OrderRepository {
    private static final Comparator<Order> BY_DATE_DESC =
        Comparator.comparing(Order::placedAt, Comparator.reverseOrder());

    public List<Order> recent() {
        return all().stream().sorted(BY_DATE_DESC).toList();
    }
}
```

The JIT can specialize a single shared comparator more aggressively than freshly-built ones. For cold paths, inline construction is fine.

**Trap:** Naming the constant `COMPARATOR` instead of describing the ordering. Make the name tell the reader what the comparator *does*.

---

## Q17. What does `Comparator.naturalOrder()` do with null?

It throws NPE — the natural order of `null` is undefined. To sort a list that may contain nulls:

```java
list.sort(Comparator.nullsFirst(Comparator.naturalOrder()));
list.sort(Comparator.nullsLast(Comparator.naturalOrder()));
```

These adapters wrap any comparator with null-tolerance. Without them, `Collections.sort(listWithNulls)` is a runtime crash. The fact that the JDK provides `nullsFirst` / `nullsLast` as standard adapters is a recognition that nulls in collections are common and the natural order alone is too strict.

**Follow-up:** "What if I want nulls in the middle?" — not supported directly. You'd need a custom comparator that returns a fixed value for null cases. Usually a sign the data model needs cleanup.

---

## Q18. What does "consistent with equals" really buy you?

Predictable behaviour in *sorted* hash-equality collections: `TreeSet` uses `compareTo` for membership, `HashSet` uses `equals` + `hashCode`. When the two agree (consistent), the same data behaves the same in either collection. When they disagree (BigDecimal), you get a mismatch — the *same data* appears as duplicate in one collection and unique in another. Consistency means: refactor `TreeSet<X>` to `HashSet<X>` without behaviour change, and vice versa. The recommendation isn't about correctness in isolation; it's about *interchangeability* of equality-aware collections.

**Trap:** Implementing consistent-with-equals when the domain demands inconsistency (case-insensitive name lookup). The recommendation is a default, not a law.

---

## Q19. Do records auto-generate `Comparable`?

No. Records auto-generate `equals`, `hashCode`, `toString` — but **not** `compareTo`. If you want a record to be comparable, declare it explicitly:

```java
public record Money(long cents, Currency currency) implements Comparable<Money> {
    public int compareTo(Money other) {
        if (!currency.equals(other.currency))
            throw new IllegalArgumentException("incomparable currencies");
        return Long.compare(this.cents, other.cents);
    }
}
```

The compact constructor (or canonical constructor) is also where you'd validate scale or currency. Records integrate naturally with `Comparable` but don't impose an ordering — different value types have different natural orders, and the language stays neutral.

**Follow-up:** "Why doesn't the language auto-generate compareTo?" — because the ordering decision is domain-specific. Components in a record may not even be Comparable.

---

## Q20. Which modern Java features reshape this topic?

Three. **JEP 126 (Java 8)** — default and static methods on `Comparator`, plus method references — replaced the verbose anonymous-class comparators of pre-8 Java with fluent `Comparator.comparing(...).thenComparing(...)` chains. **JEP 395 (records)** — give you a stable type to be `Comparable` against, with safe equals/hashCode auto-generated. **JEP 409 (sealed types)** with **JEP 441 (pattern matching for switch)** — let you write closed-world compareTo or rank functions with compile-time exhaustiveness. Together, they make modern compareTo code dramatically cleaner than the Java 7 era while preserving the contract semantics.

**Follow-up:** "What's the modern-Java way to sort by multiple keys?" — `Comparator.comparing(...).thenComparing(...)` with method references. Verbose anonymous classes for sorting are a 2014-and-earlier idiom.

---

**Use this list:** rotate one question per axis (definitions, contract clauses, snippet critique, multi-key chains, locale, modern features, common bugs). Strong candidates name the *specific* clause violated, the *specific* JDK feature that's the right shape today, and the *cost* of breaking consistency with equals.
