# Comparable vs Comparator Contracts — Senior

> **What?** The edge cases that separate "I can write a comparator" from "I can explain why this `TreeSet` silently swallows half my data". `BigDecimal`'s notorious `compareTo`/`equals` divergence, locale-sensitive ordering with `Collator`, PECS generics on comparators, comparator composition edge cases, and the runtime invariants of `TreeSet`/`TreeMap` that none of the tutorials mention.
> **How?** By treating "consistent with equals" as a runtime *invariant* of sorted collections, not a documentation footnote — and by recognising the small handful of cases where divergence is the correct design and the comment that explains why is the deliverable.

---

## 1. The full `compareTo` contract — read it again as an adult

Every junior tutorial summarises `Comparable.compareTo` as "negative, zero, or positive". The full javadoc contract has four clauses and you must understand all four before you trust your own implementation:

1. **Antisymmetric** — `sgn(x.compareTo(y)) == -sgn(y.compareTo(x))`, and one throws iff the other does. Same for `==`.
2. **Transitive** — `x.compareTo(y) > 0` and `y.compareTo(z) > 0` imply `x.compareTo(z) > 0`. Likewise for `< 0`.
3. **Substitution of equals** — `x.compareTo(y) == 0` implies `sgn(x.compareTo(z)) == sgn(y.compareTo(z))` for all `z`. ("Ordering is well-defined on the equivalence class.")
4. **Strongly recommended, not required** — `(x.compareTo(y) == 0)` is equivalent to `x.equals(y)`.

The compiler enforces *none* of these. They are runtime contracts. Violations show up in one of three guises: `TreeSet`/`TreeMap` collapsing distinct elements (clause 4 failure), `Arrays.sort` throwing `IllegalArgumentException: Comparison method violates its general contract!` (Timsort's transitivity check, clauses 1-2), or sorted output that looks correct in tests and is subtly wrong in production with a richer input distribution (clause 3).

Senior engineers internalise the contract so well they can reproduce all four from memory. Walk through each clause every time you write a non-trivial `compareTo` — it takes thirty seconds and catches every one of the standard bugs.

---

## 2. The BigDecimal trap — when divergence is deliberate

`BigDecimal` is the canonical example of a type whose `compareTo` and `equals` *legitimately* diverge.

```java
BigDecimal a = new BigDecimal("1.0");
BigDecimal b = new BigDecimal("1.00");

a.compareTo(b);   // 0      — numerically equal
a.equals(b);      // false  — different scale
```

The reason is principled. `BigDecimal` carries two facts: the unscaled value and the *scale* (number of digits after the decimal point). `1.0` and `1.00` represent the same number but record different *precisions*. `equals` is *structural* (must match both pieces), `compareTo` is *numerical* (only the value matters).

If you've never been bitten by this, here's how it bites:

```java
Set<BigDecimal> seen = new HashSet<>();
seen.add(new BigDecimal("1.0"));
seen.add(new BigDecimal("1.00"));
seen.size();                              // 2 — HashSet uses equals/hashCode

Set<BigDecimal> sortedSeen = new TreeSet<>();
sortedSeen.add(new BigDecimal("1.0"));
sortedSeen.add(new BigDecimal("1.00"));
sortedSeen.size();                        // 1 — TreeSet uses compareTo
```

Two identical-looking calls. Two different sizes. Senior engineers know this and either *avoid `TreeSet<BigDecimal>` deliberately* or normalise scale before insertion (`.stripTrailingZeros()`).

The same divergence appears in any type whose "equal numerically" relation is broader than "equal structurally". `Duration` does *not* have this problem (its `equals` matches `compareTo`). `Instant` doesn't. But user-defined "money", "interval", "percentage" types frequently do — and the right design is to *pick one*: either normalise on construction so structural equality matches numerical equality, or commit to numerical-only equality and override `equals` to match.

---

## 3. `TreeSet` and `TreeMap` use the *comparator*, not `equals`

The single most-missed fact about Java's sorted collections: they use the comparator's notion of equivalence for *all* operations that conceptually use equality.

- `TreeSet.contains(x)` returns true iff some `y` in the set has `comparator.compare(x, y) == 0`. **`equals` is never called.**
- `TreeSet.add(x)` rejects `x` if the set already contains any `y` with `compare(x, y) == 0`.
- `TreeMap.get(k)` returns the value for any `k'` with `compare(k, k') == 0`. Two structurally distinct keys with the same comparator class hash to the same slot.
- `TreeSet.remove(x)` removes any element `y` with `compare(x, y) == 0`, possibly not `x` itself.

```java
record Trade(long id, BigDecimal price, Instant at) {}

// Comparator: by price, no tiebreaker.
SortedSet<Trade> trades = new TreeSet<>(Comparator.comparing(Trade::price));

trades.add(new Trade(1, new BigDecimal("100.00"), Instant.now()));
trades.add(new Trade(2, new BigDecimal("100.00"), Instant.now()));  // ignored!

trades.size();   // 1
```

Both trades have distinct ids, distinct timestamps, and are clearly distinct objects to `equals`. The `TreeSet` keeps only the first because the comparator says they are equivalent — and the comparator is the *only* equivalence the set respects.

The remedy is one of three:

- **Always add a tiebreaker** that makes ties impossible between distinct objects. For `Trade`, append `Comparator.comparingLong(Trade::id)`.
- **Use the right collection** — if you want a set of distinct trades sorted by price, you want a `List<Trade>` you sort, or two structures (a `Set<Trade>` for dedup, a `List<Trade>` for ordered iteration), not a `TreeSet`.
- **Document the deduplication intent** — if the comparator is genuinely a uniqueness key (e.g., "keep one trade per price level, the most recent one wins"), make that explicit in the code that constructs the set.

A `TreeSet<X>` where `X` is `Comparable` and the natural order is inconsistent with `equals` is a permanent landmine. Either fix the natural order or pick another data structure.

---

## 4. Locale-sensitive String comparison — `Collator` and `RuleBasedCollator`

`String.compareTo` is *not* a linguistically meaningful ordering. It compares UTF-16 code units. That happens to match dictionary order for ASCII; for anything containing characters above `U+007E`, it does not.

```java
List<String> turkishNames = new ArrayList<>(List.of(
    "Çetin", "Akın", "Ödön", "Ürgüplü", "Zeki"));

turkishNames.sort(Comparator.naturalOrder());
// [Akın, Zeki, Çetin, Ödön, Ürgüplü]   — wrong: accented letters after Z
```

The fix is `java.text.Collator`, which encodes locale-specific collation rules (case sensitivity, accent sensitivity, alphabet quirks like the Turkish dotted/dotless `i`).

```java
Collator tr = Collator.getInstance(new Locale("tr", "TR"));
tr.setStrength(Collator.SECONDARY);   // accents matter, case doesn't

turkishNames.sort(tr);
// [Akın, Çetin, Ödön, Ürgüplü, Zeki]   — what a Turkish reader expects
```

Four levels of strength:

| Strength      | What matters                              | Use for                                   |
|---------------|-------------------------------------------|-------------------------------------------|
| `PRIMARY`     | Base letter (a == á == A == Á)            | "Find by name, ignoring case and accents" |
| `SECONDARY`   | Letter + accent                           | Dictionary-style sort                     |
| `TERTIARY`    | Letter + accent + case (default)          | Strict alphabetical sort                  |
| `IDENTICAL`   | All distinctions including normalization  | Forensic / exact-match scenarios          |

`RuleBasedCollator` lets you build custom rules (uncommon — only when integrating with a system that uses its own collation, like a particular database).

The performance cost of `Collator.compare` over `String.compareTo` is roughly an order of magnitude per comparison. For sorting *thousands* of strings that compare deeply (long shared prefixes), use `Collator.getCollationKey(String)`: it returns a precomputed `CollationKey` that you can compare cheaply afterwards:

```java
record Customer(String surname) {}
List<Customer> customers = ...;

Collator tr = Collator.getInstance(new Locale("tr", "TR"));
tr.setStrength(Collator.SECONDARY);

// Schwartzian transform: precompute keys once, sort by keys, project back.
customers.sort(Comparator.comparing(c -> tr.getCollationKey(c.surname())));
```

`CollationKey` implements `Comparable<CollationKey>`, so it plugs directly into `comparing`. For a sort of N strings with average length L, you go from `O(N log N * L)` collator calls to `O(N * L)` collator calls (during key construction) plus `O(N log N)` cheap key comparisons.

---

## 5. PECS in `Comparator` signatures

The `Comparator` static methods carry the most thorough PECS (Producer Extends, Consumer Super) signatures in the standard library. Worth understanding because they're how the library *enables* comparator reuse across type hierarchies.

```java
public static <T, U extends Comparable<? super U>> Comparator<T> comparing(
    Function<? super T, ? extends U> keyExtractor);
```

Two `? super` and one `? extends` in one signature. Translated:

- **`Function<? super T, ? extends U>`** — the extractor accepts any *supertype* of `T` (covariant input) and returns any *subtype* of `U` (covariant output). You can pass a `Function<Object, Integer>` where a `Function<Order, Number>` is expected.
- **`U extends Comparable<? super U>`** — `U` itself, or any of its supertypes, may implement `Comparable`. The key extracted is comparable *somewhere* in its own type hierarchy.

This is what lets you do:

```java
class Vehicle { int weightKg() { ... } }
class Truck extends Vehicle { ... }

Comparator<Vehicle> byWeight = Comparator.comparingInt(Vehicle::weightKg);

List<Truck> trucks = ...;
trucks.sort(byWeight);   // Comparator<Vehicle> works for List<Truck>
```

`Comparator<Vehicle>` is *contravariant* in its element type — it accepts any subtype of `Vehicle`. Java represents this contravariance in every method that *takes* a comparator:

```java
public static <T> void sort(List<T> list, Comparator<? super T> c);   // ? super T
public static <T> Stream<T> sorted(Comparator<? super T> c);
```

The `? super T` is what allows a single comparator to sort multiple subtypes. A common code-review smell is `Comparator<T>` where `Comparator<? super T>` would do — fix it the moment you spot it.

For your own factories that return comparators, mirror this:

```java
public static <T> Comparator<T> byName(Function<? super T, String> nameOf) {
    return Comparator.comparing(nameOf);
}

// Now byName is callable with Function<Object, String> too:
Comparator<Vehicle> byMake = byName((Vehicle v) -> v.make());
```

The variance is invisible at the call site but pays off whenever someone reuses your factory across a hierarchy.

---

## 6. Comparator composition edge cases

`Comparator.comparing(...).thenComparing(...).reversed()` looks innocuous. Two non-obvious behaviours:

**`reversed()` reverses the *entire chain*.** This is by far the most common bug in chained comparators.

```java
Comparator<Order> byDateThenIdReversed =
    Comparator.comparing(Order::placedAt)
              .thenComparing(Order::id)
              .reversed();
```

A naive reading: "by date, then by id (reversed)". The actual behaviour: "by date reversed, then by id reversed". If you want only the last key reversed, build it inline:

```java
Comparator<Order> byDateThenIdReversed =
    Comparator.comparing(Order::placedAt)
              .thenComparing(Order::id, Comparator.reverseOrder());
```

**`thenComparing(other)` calls `other.compare` only when the prefix returns 0.** This sounds obvious, but the implication is that *short-circuiting* makes the prefix's correctness more important than the suffix's. If the prefix occasionally returns a spurious non-zero (say, because of a comparator that breaks transitivity), the suffix never runs and the bug is invisible in unit tests of the suffix.

**Reversing a comparator that returns `Integer.MIN_VALUE` breaks.** `reversed()` is implemented as roughly `-original.compare(b, a)`. If `original.compare` returns `Integer.MIN_VALUE`, `-MIN_VALUE` overflows to itself (because `-(-2^31) == 2^31 - 1 + 1 == 2^31` which wraps to `-2^31`). Hand-rolled comparators that compute differences are the usual culprits. Use `Xxx.compare` and the problem doesn't exist.

**`Comparator.nullsFirst(naturalOrder())` vs `Comparator.<T>nullsFirst(null)`.** The second form is a common typo. Java accepts it because `null` is a valid `Comparator<T>` value to `nullsFirst` (its meaning is "compare non-nulls with their natural order"). But it requires *both* arguments of a comparison to be non-null *or* both to be null — pass one null and one `Comparable` and you crash. Always pair `nullsFirst(naturalOrder())` together unless you have a deliberate reason.

```java
// Probably wrong — nulls fine, two non-nulls crash because Comparator is null:
Comparator<String> sketchy = Comparator.nullsFirst(null);

// Right:
Comparator<String> safe = Comparator.nullsFirst(Comparator.naturalOrder());
```

---

## 7. Mutable fields and sorted collections

A type that implements `Comparable` (or that goes into a `TreeSet` with any comparator) **must not allow its comparison-relevant fields to mutate** while it's inside a sorted collection. The collection indexed it under one ordering; if you change the field the comparator reads, the index is stale and the structure breaks.

```java
class Position {
    private double x, y;
    public double x() { return x; }
    public double y() { return y; }
    public void moveBy(double dx, double dy) { this.x += dx; this.y += dy; }
}

TreeSet<Position> byX = new TreeSet<>(Comparator.comparingDouble(Position::x));
Position p = new Position(1.0, 1.0);
byX.add(p);

p.moveBy(100.0, 0);   // p.x is now 101.0 but the tree still indexes it at x=1.0

byX.contains(p);      // unspecified — may return false even though p is "in" the set
byX.add(new Position(50.0, 0));     // tree's BST invariant is already broken
```

This is one of the strongest arguments for using records (or other immutable types) as keys in sorted collections. Records can't have their fields mutated; they can be *replaced* in the set with a new record. The mental model is: a record in a TreeSet is filed forever; if you want to "move" it, remove the old, insert a new.

For mutable types that absolutely must go in sorted collections, the common pattern is:

```java
byX.remove(p);
p.moveBy(100.0, 0);
byX.add(p);
```

Remove, mutate, re-insert. Forgetting any step corrupts the tree. This is why "implement `Comparable` on mutable types" appears on every team's review-killer list.

---

## 8. `TreeMap` ordering and submap views

`TreeMap`'s `subMap`, `headMap`, `tailMap` views, and the `NavigableMap` methods (`floorKey`, `ceilingKey`, `lowerKey`, `higherKey`) all use the comparator. The keys you ask for in these methods *do not have to exist in the map* — the methods find the nearest key under the comparator's ordering.

```java
NavigableMap<Instant, Reading> readings = new TreeMap<>();
readings.put(Instant.parse("2026-01-01T00:00:00Z"), ...);
readings.put(Instant.parse("2026-01-15T00:00:00Z"), ...);

Instant query = Instant.parse("2026-01-10T00:00:00Z");
Instant floor   = readings.floorKey(query);     // 2026-01-01 — nearest key <= query
Instant ceiling = readings.ceilingKey(query);   // 2026-01-15 — nearest key >= query
```

This is one of `TreeMap`'s best features and has no equivalent in `HashMap`. It pays off in *time-series* code (find the most recent reading before this instant), *range queries* (everything between two prices), and *index lookups* (find the partition for this id).

It also exposes the comparator's correctness, hard. A comparator that violates transitivity produces nonsensical `floor`/`ceiling` results — and the failure can be subtle, depending on which side of a misordered range you query. Run `TreeMap`-fronted code against a transitivity-checking test (random triples, assert `cmp(a,b) > 0 && cmp(b,c) > 0 ⇒ cmp(a,c) > 0`).

---

## 9. NaN, infinities, and `Double.compare`

Floating-point comparison is its own minefield. The IEEE 754 rules say `NaN != NaN` (in fact, `NaN` is *unordered* with everything, including itself). Java's `<`, `>`, `==` operators follow IEEE: `Double.NaN == Double.NaN` is `false`, `Double.NaN < 0.0` is `false`, and `Double.NaN > 0.0` is *also* `false`.

This breaks `compareTo` if you naively compare with operators:

```java
// Broken: with NaN inputs, this returns 0, which means "equal" — but NaN is not equal to anything.
public int compareTo(Reading other) {
    if (this.value < other.value) return -1;
    if (this.value > other.value) return +1;
    return 0;
}
```

`Double.compare(a, b)` *defines an ordering* on `double` that treats `NaN` as the largest value (greater than `+Infinity`) and `-0.0` as less than `+0.0`. This is *not* IEEE order — it is a consistent ordering that satisfies `Comparable`'s contract.

```java
public int compareTo(Reading other) {
    return Double.compare(this.value, other.value);
}
```

Now `NaN` sorts to the end, `compareTo == 0` only when both values are bit-identical, and the comparator is transitive. Same story with `Float.compare`.

The consequence for sorted collections: a `TreeSet<Double>` *can* hold `NaN` (something operator-`==` would say is impossible), because `Double.compare(NaN, NaN) == 0`. Whether you want it in there is another matter; the senior decision is usually to *reject NaN on insertion* and treat NaN sensors / readings as an upstream contract violation.

---

## 10. Inheritance and `compareTo`

A class that implements `Comparable<T>` and is later extended creates a problem similar to `equals`: how should the subclass implement `compareTo`?

```java
public class Point implements Comparable<Point> {
    protected final int x, y;
    public Point(int x, int y) { this.x = x; this.y = y; }

    @Override
    public int compareTo(Point other) {
        int c = Integer.compare(this.x, other.x);
        return c != 0 ? c : Integer.compare(this.y, other.y);
    }
}

public class ColoredPoint extends Point {
    private final int rgb;
    public ColoredPoint(int x, int y, int rgb) { super(x, y); this.rgb = rgb; }

    @Override
    public int compareTo(Point other) {
        int c = super.compareTo(other);
        if (c != 0) return c;
        if (other instanceof ColoredPoint cp) {
            return Integer.compare(this.rgb, cp.rgb);
        }
        return 0;     // (?) — what is the right answer here?
    }
}
```

The asymmetry strikes:

```java
Point        p  = new Point(1, 1);
ColoredPoint cp = new ColoredPoint(1, 1, 0xff0000);

p.compareTo(cp);    // Point.compareTo doesn't look at rgb. Returns 0.
cp.compareTo(p);    // ColoredPoint.compareTo returns 0 too (the "?" branch).
```

So far so good. But consider three points where two `ColoredPoint`s differ:

```java
ColoredPoint a = new ColoredPoint(1, 1, 0xff0000);  // red
Point        b = new Point(1, 1);
ColoredPoint c = new ColoredPoint(1, 1, 0x00ff00);  // green

a.compareTo(b);   // 0  (super equal, b is not ColoredPoint, returns 0)
b.compareTo(c);   // 0  (Point.compareTo doesn't see rgb)
a.compareTo(c);   // != 0 (different rgb)
```

Transitivity is broken: `a == b` and `b == c` (under `compareTo`), but `a != c`. The same kind of trap that `equals` runs into when subclasses add identity-bearing fields. The remedies are the same:

- **Make `Point` final or sealed** so a subclass can't add fields that participate in ordering.
- **Use composition instead of inheritance**: `ColoredPoint` *has-a* `Point` and *is-a* separate `Comparable<ColoredPoint>` type.
- **Compare canonical-class identity first**: refuse to compare a `Point` with a `ColoredPoint`. (Throws away substitutability — `Point[]` of mixed types is no longer sortable. Usually wrong.)

The cleanest rule: do not implement `Comparable` on an open class hierarchy. Either make the type final/sealed, or expose ordering only through external `Comparator`s defined per use case.

---

## 11. When you can't make `compareTo` consistent with `equals`

The clause-4 recommendation ("consistent with equals") is *recommended*, not required. There are legitimate cases for breaking it; the rule is that the divergence must be deliberate, documented, and protected.

**Case 1 — `BigDecimal` (covered above).** Numerical equivalence is broader than structural equivalence. The library docs say so explicitly.

**Case 2 — Approximate / fuzzy ordering.** A sensor reading that compares "equal" when within ±0.001 of another reading violates transitivity (chains of ±0.001 differences walk away from each other), and also clause 4. This is not a valid `Comparable`. Build an external `Comparator` *only* for use cases that document the slack (e.g., "cluster nearby readings for display"), and never use it with a `TreeSet`.

**Case 3 — Locale-sensitive ordering of strings.** "Hello" and "hello" `compareTo` to non-zero with `String.compareTo`, but `Collator` with `PRIMARY` strength reports them equal. Using a `Collator` as the ordering of a `TreeSet<String>` would deduplicate them — sometimes that's what you want (a case-insensitive set), but `equals` on `String` still considers them different. *Document this loudly* in the class that builds the set, and prefer `TreeSet<>(Collator.getInstance(...))` over `String`'s natural order *only* when you deliberately want case-insensitive de-dup.

**Case 4 — Performance shortcut on a key prefix.** A `Comparator<HugeRecord>` that compares only the first 8 bytes of a 256-byte identifier is faster but inconsistent with `equals`. Acceptable as a *partial sort* (e.g., for bucketing); never use it with `TreeSet`.

The lesson is meta: divergence is a hidden contract, and hidden contracts must become visible. Make divergence a *class-level Javadoc paragraph*, not a sentence in a method body. Reviewers will spot it; future maintainers will know it; sorted-collection traps will be flagged in PRs before they ship.

---

## 12. The Timsort contract violation message

You will eventually see this:

```
java.lang.IllegalArgumentException: Comparison method violates its general contract!
    at java.base/java.util.TimSort.mergeHi(TimSort.java:899)
    at java.base/java.util.TimSort.mergeAt(TimSort.java:516)
    ...
    at java.base/java.util.Arrays.sort(Arrays.java:1042)
```

Timsort actively verifies the comparator during its merge phases. If the comparator violates the transitivity or antisymmetry clauses, Timsort detects the inconsistency at merge time and throws. The exception message is famously unhelpful — it doesn't point at the input pair that fails. To diagnose, log the comparator's input/output for the failing list (small reproducer first; binary-search the input down to a 3- or 4-element list).

Common root causes:

- A comparator that compares two objects via *both* a primary and a secondary key, and the *secondary* comparator violates transitivity (NaN, mutable field changed mid-sort, broken hand-rolled `compare`).
- A comparator that captures *external state* that changes mid-sort (a counter, a `System.currentTimeMillis()`, a per-thread cache).
- A comparator that uses `==` on boxed types where it should use `compareTo`/`equals`.

The fastest debugging move is to write a transitivity check and run it on the offending list before the sort:

```java
static <T> void assertTransitive(List<T> sample, Comparator<? super T> cmp) {
    for (T a : sample)
        for (T b : sample)
            for (T c : sample) {
                int ab = Integer.signum(cmp.compare(a, b));
                int bc = Integer.signum(cmp.compare(b, c));
                int ac = Integer.signum(cmp.compare(a, c));
                if (ab > 0 && bc > 0 && ac <= 0) throw new AssertionError("transitivity broken");
                if (ab < 0 && bc < 0 && ac >= 0) throw new AssertionError("transitivity broken");
            }
}
```

`O(n^3)` and only for small samples, but if your sort throws on a 1000-element list, you can binary-search the input down to a 50-element list and run this in milliseconds.

---

## 13. Quick rules

- The full `compareTo` contract has four clauses: antisymmetric, transitive, equivalence-class substitution, *recommended* consistent-with-equals. Memorise all four.
- `BigDecimal.compareTo` and `BigDecimal.equals` disagree; **never** put `BigDecimal` in a `TreeSet` without normalising scale.
- `TreeSet` / `TreeMap` use the comparator for equality. Add a tiebreaker that makes ties impossible between distinct objects, or change collection.
- `String.compareTo` is UTF-16 code-unit order, not human alphabetical. Use `Collator` for human text; precompute `CollationKey`s when sorting many strings.
- The `Comparator` static methods use PECS extensively — mirror it in your own comparator factories.
- `reversed()` reverses the whole chain. Per-key reversal goes inline as `thenComparing(key, reverseOrder())`.
- Mutable types in sorted collections need explicit remove/mutate/re-insert; prefer immutable records.
- `Double.compare` defines a *total* order including NaN; `<`, `>`, `==` don't.
- Open class hierarchies can't safely implement `Comparable` — either seal/finalize, or expose ordering only through external comparators.
- Document any divergence between `compareTo` and `equals` at class level, with reason and consequences.

---

## 14. What's next

| Topic                                                  | File              |
| ------------------------------------------------------ | ----------------- |
| Driving these rules across a team and a codebase       | `professional.md`  |
| JLS / Javadoc references for both interfaces           | `specification.md` |
| Buggy snippets that exercise each trap                 | `find-bug.md`      |
| Primitive specializations, JIT, dispatch               | `optimize.md`      |
| Hands-on exercises                                     | `tasks.md`         |
| Interview Q&A                                          | `interview.md`     |

---

**Memorize this:** `Comparable`'s four-clause contract is enforced at *runtime* by sorted collections and by Timsort itself. The `compareTo`/`equals` divergence is a real design choice; `BigDecimal` proves it, your domain types must justify it. `TreeSet` uses the comparator for equality — that's not a bug, it's the definition — so a comparator that returns 0 for distinct objects silently drops them. Locale needs `Collator`, NaN needs `Double.compare`, mutable keys break the invariant, and `Integer.MIN_VALUE` breaks `reversed()`. Senior engineers reason about all of these by reflex; the file above is the catalog they reach for when the reflex stalls.
