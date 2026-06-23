# Comparable vs Comparator Contracts — Find the Bug

> 10 buggy snippets, each a silent `compareTo` or `Comparator` defect that compiles, passes a casual unit test, and only bites in production with a richer input distribution. For each: read the code, decide which clause of the contract is broken, identify the *runtime symptom* (stack trace, wrong sort order, `TreeSet` swallowing data, undefined heap behaviour), and write down the fix.
>
> Cross-references: the contract clauses are documented in detail in [specification.md](specification.md); the `compareTo`/`equals` discipline lives next door in [../01-equals-hashcode-tostring-contracts/](../01-equals-hashcode-tostring-contracts/); the SOLID-shaped reasons not to put ordering inside a type at all live in [../../03-design-principles/](../../03-design-principles/).

---

## Bug 1 — Integer subtraction in `compareTo`

```java
public final class Account implements Comparable<Account> {
    private final long id;
    private final int balanceCents;

    public Account(long id, int balanceCents) {
        this.id = id;
        this.balanceCents = balanceCents;
    }

    @Override
    public int compareTo(Account other) {
        return this.balanceCents - other.balanceCents;   // (*)
    }
}
```

```java
// Caller — the daily balance audit report.
List<Account> accounts = repo.findAll();
accounts.sort(Comparator.naturalOrder());
// Top of the report is supposed to be the largest balance.
```

**Symptom.** Most days the report looks fine. On the day a recovered customer deposits two billion cents (twenty million dollars) and another customer is overdrawn at -1.8 billion cents after a margin call, the report prints the overdrawn account *above* the wealthy one. No exception, no log. Finance notices the next morning.

The arithmetic at line `(*)` is `2_000_000_000 - (-1_800_000_000) == 3_800_000_000`. That value does not fit in an `int`; it wraps to `-494_967_296`. `compareTo` returns negative, so the sort places the larger balance *before* the smaller. The sort is silently wrong for any pair of values whose mathematical difference exceeds `Integer.MAX_VALUE`.

**Contract clause violated.** Antisymmetry — the sign of `a.compareTo(b)` is supposed to be the *mathematical* sign of "a minus b". Truncated subtraction is not antisymmetric for large values: both `a.compareTo(b)` and `b.compareTo(a)` can return negative on the same pair.

**Fix.**

```java
@Override
public int compareTo(Account other) {
    return Integer.compare(this.balanceCents, other.balanceCents);
}
```

`Integer.compare(x, y)` is defined as roughly `(x < y) ? -1 : (x == y) ? 0 : 1`. It returns one of three values and cannot overflow. Apply the same rule to every primitive: `Long.compare`, `Double.compare`, `Float.compare`, `Boolean.compare`, `Short.compare`, `Byte.compare`, `Character.compare`. The phrase `return a - b;` should never appear in a `compareTo` method.

---

## Bug 2 — BigDecimal scale silently dedupes a `TreeSet`

```java
public final class PriceBook {
    private final Set<BigDecimal> levels = new TreeSet<>();   // (*)

    public void mark(BigDecimal price) {
        levels.add(price);
    }

    public int distinctLevels() {
        return levels.size();
    }
}
```

```java
// Caller — an order-book replay that streams every trade through the book.
var book = new PriceBook();
book.mark(new BigDecimal("100.00"));
book.mark(new BigDecimal("100.0"));
book.mark(new BigDecimal("100"));
System.out.println(book.distinctLevels());   // prints 1
```

**Symptom.** A market-data analytics job that counts "distinct trading levels per session" reports a number that is dramatically lower than the same job using a `HashSet`. The team double-checks the input, then triples it. The input is fine. The bug is the data structure.

`TreeSet` uses the *natural ordering* (or its configured comparator) as the equivalence relation. `BigDecimal.compareTo` is *numerical* — it returns 0 for `100.00` vs `100.0`, because they represent the same number. So the second and third `add` calls find an existing element with `compare == 0` and reject silently. `BigDecimal.equals`, by contrast, is *structural* — `100.00` and `100.0` are different because their scales differ.

**Contract clause violated.** The "strongly recommended" clause — `BigDecimal.compareTo` is famously inconsistent with `equals` (this is documented in `BigDecimal`'s own javadoc). The class itself does not violate the contract; what violates the contract is *using `BigDecimal` as the element type of a `TreeSet`* without normalising the scale, since the user almost certainly expected `equals`-style uniqueness.

**Fix.** Two options, depending on intent.

```java
// Option A — keep the sorted shape, normalise scale so equals matches compareTo.
private final Set<BigDecimal> levels = new TreeSet<>(
    Comparator.comparing((BigDecimal b) -> b.stripTrailingZeros())
);

// Option B — use the right data structure if uniqueness was the goal, sort on demand.
private final Set<BigDecimal> levels = new HashSet<>();
public List<BigDecimal> sortedLevels() {
    return levels.stream().sorted().toList();
}
```

A `TreeSet<BigDecimal>` constructed with the default natural ordering is a permanent landmine. Either fix the comparator or pick a different collection. See [senior.md §2-3](senior.md) for the longer discussion.

---

## Bug 3 — `compareTo` asymmetric across inheritance

```java
public class Employee implements Comparable<Employee> {
    protected final long id;
    protected final String surname;

    public Employee(long id, String surname) {
        this.id = id;
        this.surname = surname;
    }

    @Override
    public int compareTo(Employee other) {
        return this.surname.compareTo(other.surname);
    }
}

public class Manager extends Employee {
    private final int reportCount;

    public Manager(long id, String surname, int reportCount) {
        super(id, surname);
        this.reportCount = reportCount;
    }

    @Override
    public int compareTo(Employee other) {
        if (other instanceof Manager m) {
            int c = Integer.compare(this.reportCount, m.reportCount);   // (*)
            if (c != 0) return c;
        }
        return super.compareTo(other);
    }
}
```

```java
Employee alice = new Employee(1, "Smith");
Manager  bob   = new Manager(2, "Smith", 8);

alice.compareTo(bob);   // calls Employee.compareTo, returns 0 (same surname)
bob.compareTo(alice);   // calls Manager.compareTo, returns 0 (no Manager check fires, falls through)
// Looks fine on this pair. Now add a second Manager:

Manager carol = new Manager(3, "Smith", 3);
alice.compareTo(carol); // 0
carol.compareTo(alice); // 0
bob.compareTo(carol);   // +5
carol.compareTo(bob);   // -5
// Transitive failure: alice == bob, alice == carol, but bob != carol.
```

**Symptom.** A `TreeSet<Employee>` populated with `alice`, `bob`, and `carol` keeps a different subset depending on insertion order. Or, more catastrophic, `Arrays.sort` throws:

```
java.lang.IllegalArgumentException: Comparison method violates its general contract!
    at java.base/java.util.TimSort.mergeHi(TimSort.java:903)
    at java.base/java.util.TimSort.mergeAt(TimSort.java:520)
    at java.base/java.util.Arrays.sort(Arrays.java:1252)
```

Timsort detected that the comparator is not transitive and bailed.

**Contract clause violated.** Antisymmetry *and* transitivity (the entire `compareTo` equivalence relation). The trouble is at line `(*)`: `Manager.compareTo` adds a discriminator (`reportCount`) that `Employee.compareTo` does not see. As soon as one side of the dispatch is a `Manager` and the other is a plain `Employee`, the two methods produce inconsistent answers.

**Fix.** Don't extend a `Comparable` class with a new comparison key. Either:

```java
// A: make Employee final and stop the inheritance:
public final class Employee implements Comparable<Employee> { ... }

// B: stop implementing Comparable on the hierarchy; let callers pass an external Comparator:
public class Employee { /* no compareTo */ }
public class Manager extends Employee { /* no compareTo */ }

Comparator<Employee> bySurnameThenReports =
    Comparator.comparing(Employee::surname)
              .thenComparingInt(e -> (e instanceof Manager m) ? m.reportCount() : 0);
```

The deeper lesson: a `compareTo` defined on an open hierarchy is rarely correct. The Effective Java guidance ([senior.md §1](senior.md)) is to make any `Comparable` type either `final` or to define `compareTo` only on the leaf classes.

---

## Bug 4 — `NaN` in a `Double` comparator

```java
public record Reading(String sensorId, double valueCelsius) {}

public final class ReadingsTable {

    private static final Comparator<Reading> BY_VALUE =
        (a, b) -> {
            if (a.valueCelsius() < b.valueCelsius()) return -1;
            if (a.valueCelsius() > b.valueCelsius()) return +1;
            return 0;
        };

    public List<Reading> sortByValue(List<Reading> in) {
        var copy = new ArrayList<>(in);
        copy.sort(BY_VALUE);
        return copy;
    }
}
```

```java
List<Reading> noisy = List.of(
    new Reading("A", 21.5),
    new Reading("B", Double.NaN),
    new Reading("C", 19.0),
    new Reading("D", Double.NaN),
    new Reading("E", 22.7));

table.sortByValue(noisy);
```

**Symptom.** On real sensor data with intermittent NaN readings, two failures appear in the same week.

```
java.lang.IllegalArgumentException: Comparison method violates its general contract!
    at java.base/java.util.TimSort.mergeHi(TimSort.java:903)
```

Some runs don't throw — they just produce an output where NaN values land at random positions and the rest of the list is not fully sorted around them.

The lambda uses `<` and `>`. Both return `false` when either operand is `NaN`. So for any `Reading` `b` with `b.valueCelsius() == NaN`, the comparator returns `0` (the fall-through case) for every input — including pairs that should clearly be ordered. The relation is not antisymmetric and not transitive, and Timsort catches it.

**Contract clause violated.** Antisymmetry and transitivity. The IEEE-754 rule that `NaN` is unordered with respect to every value, including itself, breaks `<` and `>` based comparators.

**Fix.** Use `Double.compare`, which gives NaN a defined position (`NaN` sorts as greater than positive infinity):

```java
private static final Comparator<Reading> BY_VALUE =
    Comparator.comparingDouble(Reading::valueCelsius);
```

`Comparator.comparingDouble` internally uses `Double.compare`, which is total: it places `NaN` consistently at the high end, and orders `+0.0` strictly after `-0.0`. Whether that position is *meaningful* in your domain (do you want NaN sensors at the top of the table?) is a separate question — but at least the comparator is now well-defined and Timsort won't throw.

If you'd rather drop NaN inputs before sorting, do that explicitly upstream — don't let an undefined comparator silently scatter them through the result.

---

## Bug 5 — Mutable key field used by `compareTo`

```java
public final class Task implements Comparable<Task> {
    private final long id;
    private int priority;                       // mutable

    public Task(long id, int priority) {
        this.id = id;
        this.priority = priority;
    }

    public void boostPriority() { this.priority++; }

    @Override
    public int compareTo(Task other) {
        return Integer.compare(this.priority, other.priority);
    }
}
```

```java
NavigableSet<Task> queue = new TreeSet<>();
Task t = new Task(1, 5);
queue.add(t);
queue.add(new Task(2, 7));
queue.add(new Task(3, 3));

t.boostPriority();          // priority is now 6
t.boostPriority();          // priority is now 7
t.boostPriority();          // priority is now 8

queue.remove(t);            // returns false — element is "not in the set"
queue.contains(t);          // false too
queue.first();              // might be t itself, depending on tree shape
```

**Symptom.** A scheduler "loses" tasks. Operators boost the priority of a task in the queue and then attempt to remove it; the remove returns `false`. The task is still inside the underlying tree, but the tree's search path for "find a node with priority 8" no longer leads to it — the node was filed under "priority 5" when inserted, and the tree never reorganises itself when a field outside of its control mutates.

**Contract clause violated.** Not directly a `compareTo` clause — `compareTo` itself is internally consistent. The bug is the *structural* assumption every sorted collection makes: **the ordering key must not change while the element is in the collection.** `TreeSet` is a red-black tree keyed on `compareTo`; mutating the key after insertion corrupts the tree's invariants without informing the tree.

**Fix.** Don't mutate keys. Either:

```java
// A: make Task immutable. To "boost" priority, create a new Task and re-insert.
public record Task(long id, int priority) implements Comparable<Task> {
    @Override public int compareTo(Task other) {
        return Integer.compare(this.priority, other.priority);
    }
}

// In the caller:
queue.remove(t);
Task boosted = new Task(t.id(), t.priority() + 1);
queue.add(boosted);

// B: if mutation is essential, use a structure that lets you reposition explicitly,
// e.g., a PriorityQueue with explicit reinsertion, or a custom skip-list.
```

The general rule is "never put a mutable object into a hash-based or tree-based collection if any field used by `equals`/`hashCode`/`compareTo` can mutate". The bug is invisible until someone mutates the key, then the data structure quietly lies about its contents.

---

## Bug 6 — Default `String.compareTo` for an international list

```java
public final class CustomerDirectory {

    public List<Customer> sortedByName(List<Customer> customers) {
        return customers.stream()
                .sorted(Comparator.comparing(Customer::displayName))
                .toList();
    }
}

public record Customer(long id, String displayName, Country country) {}
```

```java
List<Customer> german = List.of(
    new Customer(1, "Müller",   Country.DE),
    new Customer(2, "Mueller",  Country.DE),
    new Customer(3, "Maier",    Country.DE),
    new Customer(4, "Strauß",   Country.DE),
    new Customer(5, "Strauss",  Country.DE),
    new Customer(6, "Zeppelin", Country.DE));

directory.sortedByName(german);
// Outputs (roughly):
// Maier, Mueller, Müller, Strauss, Strauß, Zeppelin
// A German address book would expect:
// Maier, Mueller, Müller, Strauß, Strauss, Zeppelin
//   ... or, with phonebook sorting, Müller right next to Mueller (treated as "ue").
```

**Symptom.** A German-language UI displays customers in an order users describe as "wrong". The bug-report description varies — one user says `Müller` should be next to `Mueller`, another says `Strauß` should be treated as `Strauss`. The team disagrees on which is "right".

`String.compareTo` compares UTF-16 code units. `M` is `0x4D`, `ü` is `0x00FC`, `e` is `0x65`. So `Müller` (with `ü`) sorts after `Mueller` (with `e`), purely on code-unit value. That happens to put `ü` near `Z` rather than near `u`. The same trap applies to `ß`, `é`, `Ø`, Turkish dotted/dotless `i`, and every other non-ASCII letter.

**Contract clause violated.** `String.compareTo` is internally consistent — what's "violated" is the user's expectation, not a contract clause. The fix is to use a locale-aware comparator.

**Fix.**

```java
public final class CustomerDirectory {

    private final Collator collator;

    public CustomerDirectory(Locale locale) {
        Collator c = Collator.getInstance(locale);
        c.setStrength(Collator.SECONDARY);   // accent matters, case doesn't
        this.collator = c;
    }

    @SuppressWarnings("unchecked")
    public List<Customer> sortedByName(List<Customer> customers) {
        // Collator implements Comparator<Object>; cast is safe for String keys.
        return customers.stream()
                .sorted(Comparator.comparing(Customer::displayName, (Comparator<String>)(Comparator) collator))
                .toList();
    }
}
```

For German (`Locale.GERMAN`), the default collator treats `ß` as equivalent to `ss` and `ü` as a variant of `u` at primary strength. For German *phonebook* sort (`Locale.forLanguageTag("de-DE-u-co-phonebk")`), `ü` is folded into `ue`. The right answer depends on the locale your users expect — pick one, document it, and stop using `String.compareTo` for any list a human will read in a non-ASCII alphabet. See [senior.md §4](senior.md) for the full collator discussion.

---

## Bug 7 — Returning non-canonical {<0, 0, >0}, then `.reversed()` breaks

```java
public final class Tickets {

    private static final Comparator<Ticket> BY_PRIORITY =
        (a, b) -> a.priority() - b.priority();   // returns any int

    public static List<Ticket> sortHighestFirst(List<Ticket> tickets) {
        var copy = new ArrayList<>(tickets);
        copy.sort(BY_PRIORITY.reversed());
        return copy;
    }
}

public record Ticket(long id, int priority) {}
```

```java
List<Ticket> ticks = List.of(
    new Ticket(1, Integer.MIN_VALUE),
    new Ticket(2, 0),
    new Ticket(3, Integer.MAX_VALUE));

Tickets.sortHighestFirst(ticks);
// Expected:                                 [3 (MAX_VALUE), 2 (0), 1 (MIN_VALUE)]
// Actual (one possible permutation):        [1 (MIN_VALUE), 3 (MAX_VALUE), 2 (0)]
// Sometimes IllegalArgumentException from Timsort.
```

**Symptom.** Two manifestations.

1. `BY_PRIORITY.compare(t1, t3)` evaluates `Integer.MIN_VALUE - Integer.MAX_VALUE`, which overflows to `+1`. The comparator claims `MIN_VALUE > MAX_VALUE`.
2. `BY_PRIORITY.reversed()` is implemented as roughly `(a, b) -> -BY_PRIORITY.compare(a, b)`. When the underlying comparator returns `Integer.MIN_VALUE`, negation overflows back to `Integer.MIN_VALUE` (same sign), so the "reversed" comparator agrees with the original on those pairs. The intended inversion silently fails for any pair whose original difference was `MIN_VALUE`.

**Contract clause violated.** Antisymmetry and transitivity (and `Comparator.reversed`'s own implicit contract that negating the result inverts the relation). Returning arbitrary ints from a comparator is technically legal — the contract only checks the *sign* — but as soon as a caller does arithmetic on the result (negation, scaling, summing across keys), the magnitude matters and overflow corrupts the answer.

**Fix.** Return only canonical values, by delegating to `Integer.compare`:

```java
private static final Comparator<Ticket> BY_PRIORITY =
    Comparator.comparingInt(Ticket::priority);

public static List<Ticket> sortHighestFirst(List<Ticket> tickets) {
    return tickets.stream().sorted(BY_PRIORITY.reversed()).toList();
}
```

The same trap applies anywhere a comparator's return value is treated as a number: weighting two sub-comparators by adding their results, dividing by two to take an average, multiplying to bias one key over another. None of those are legal — treat the return value of `compare`/`compareTo` as a *sign*, never as a *magnitude*. See [junior.md §6-7](junior.md).

---

## Bug 8 — `PriorityQueue` with a broken comparator silently produces wrong heap order

```java
public final class JobScheduler {

    // Comparator that "looks fine" — primitive int but wrong subtraction:
    private final PriorityQueue<Job> queue =
        new PriorityQueue<>((a, b) -> a.weight() - b.weight());

    public void offer(Job j) { queue.offer(j); }
    public Job nextOrNull() { return queue.poll(); }
}

public record Job(long id, int weight) {}
```

```java
var sched = new JobScheduler();
sched.offer(new Job(1, 2_000_000_000));
sched.offer(new Job(2, -2_000_000_000));
sched.offer(new Job(3, 100));

sched.nextOrNull();   // expected the most negative (job 2); may return job 1 instead.
sched.nextOrNull();   // sequence depends on heap shape.
```

**Symptom.** A job scheduler that's supposed to dispatch "lowest weight first" occasionally dispatches an enormous weight ahead of a negative one. No exception ever fires — `PriorityQueue` does not validate its comparator. The misbehaviour is silent and rare; only specific weight combinations trigger the overflow path through the heap's sift-up routine.

The root cause is the same `a - b` overflow as Bug 1, but the symptom is more insidious. `PriorityQueue` doesn't call `compare` on every pair — it calls it along the heap's path during `siftUp` and `siftDown`. A comparator that lies about *one* pair can corrupt the heap invariant without ever lying about all the others, and the resulting wrong-order output looks like a flaky scheduling decision rather than a contract bug.

**Contract clause violated.** Antisymmetry (the `a - b` overflow). And, structurally, the implicit invariant of `PriorityQueue`: the comparator must be a total order; otherwise the heap's sift operations produce undefined output.

**Fix.**

```java
private final PriorityQueue<Job> queue =
    new PriorityQueue<>(Comparator.comparingInt(Job::weight));
```

The lesson generalises: any data structure that maintains a key-ordered invariant (`PriorityQueue`, `TreeSet`, `TreeMap`, `ConcurrentSkipListSet`) trusts its comparator absolutely. A wrong comparator does not throw; it gives you a structure whose invariants no longer hold.

---

## Bug 9 — `Arrays.sort` and `Arrays.binarySearch` with different comparators

```java
public final class CustomerLookup {

    private final Customer[] index;

    public CustomerLookup(Customer[] customers) {
        this.index = customers.clone();
        Arrays.sort(index, Comparator.comparing(Customer::surname));         // (*)
    }

    public int positionOf(Customer key) {
        return Arrays.binarySearch(index, key,
                Comparator.comparing(Customer::displayName));                // (**)
    }
}
```

```java
Customer[] all = {
    new Customer(1, "Anna",  "Andersen"),
    new Customer(2, "Bjorn", "Borg"),
    new Customer(3, "Carl",  "Christiansen")};

var lookup = new CustomerLookup(all);
lookup.positionOf(new Customer(2, "Bjorn", "Borg"));
// May return any negative number, or a positive one pointing to the wrong index.
```

**Symptom.** A lookup that "usually finds the right customer" sometimes returns `-1` for a customer that is clearly in the index, and sometimes returns the index of a *different* customer. There is no exception. Tests pass on a small array because binary search degenerates to linear inspection for tiny inputs.

The array was sorted by `surname` at line `(*)` but searched using a `displayName` comparator at line `(**)`. `Arrays.binarySearch` *requires* the array to be sorted by the same comparator passed to it — otherwise its results are documented as "undefined". The compiler cannot catch the mismatch: both arguments are `Comparator<Customer>`.

**Contract clause violated.** Not a `compareTo` clause directly — what's violated is the precondition `Arrays.binarySearch` documents: "The array must be sorted into ascending order according to the specified comparator." When that precondition is broken, the method's behaviour is undefined.

**Fix.** Define the comparator *once* and reuse it:

```java
public final class CustomerLookup {

    private static final Comparator<Customer> BY_SURNAME =
        Comparator.comparing(Customer::surname);

    private final Customer[] index;

    public CustomerLookup(Customer[] customers) {
        this.index = customers.clone();
        Arrays.sort(index, BY_SURNAME);
    }

    public int positionOf(Customer key) {
        return Arrays.binarySearch(index, key, BY_SURNAME);
    }
}
```

Two design rules:

1. **One comparator constant per ordering**, exposed as `static final`. Both sort and search reference the same constant; the compiler ensures they agree.
2. **Document the precondition at the call site** if you must pass the comparator inline. Comments like `// must match the sort order in the constructor` are a poor substitute for code that enforces the invariant, but they're better than nothing.

---

## Bug 10 — Chained `Comparator.comparing` NPE on the first key

```java
public record Order(long id, LocalDate placedAt, BigDecimal total) {}

public final class OrderReports {

    private static final Comparator<Order> BY_PLACEMENT_THEN_TOTAL =
        Comparator.comparing(Order::placedAt)                 // (*)
                  .thenComparing(Order::total);

    public static List<Order> chronologicalThenByTotal(List<Order> orders) {
        var copy = new ArrayList<>(orders);
        copy.sort(BY_PLACEMENT_THEN_TOTAL);
        return copy;
    }
}
```

```java
// A nightly batch over orders. Half are placed, half are still drafts with no
// placedAt timestamp set — the field is null for those rows.
List<Order> orders = List.of(
    new Order(1, LocalDate.of(2026, 1, 5), new BigDecimal("120.00")),
    new Order(2, null,                    new BigDecimal("80.00")),    // draft
    new Order(3, LocalDate.of(2026, 1, 6), new BigDecimal("99.00")));

OrderReports.chronologicalThenByTotal(orders);
```

**Symptom.**

```
java.lang.NullPointerException: Cannot invoke "java.time.LocalDate.compareTo(java.time.chrono.ChronoLocalDate)" because the return value of "Order.placedAt()" is null
    at java.base/java.util.Comparators$NullComparator.compare(Comparators.java:71)
    at java.base/java.util.TimSort.binarySort(TimSort.java:296)
    at java.base/java.util.Arrays.sort(Arrays.java:1300)
    at java.base/java.util.ArrayList.sort(ArrayList.java:1751)
    at OrderReports.chronologicalThenByTotal(OrderReports.java:14)
```

The nightly batch throws as soon as one draft order slips through. The bug shipped in a code review that focused on "is the chain order right?" and didn't notice that line `(*)` has no null protection for the extracted key.

**Contract clause violated.** None of the four contract clauses — `Comparator.comparing` is consistent with itself. What's violated is the implicit precondition that the key extractor returns a non-null comparable. The fix is to make the contract explicit.

**Fix.** Decide where nulls go and encode it in the comparator. Three reasonable answers:

```java
// A: drafts sort last (most common — drafts are not yet "real" orders):
private static final Comparator<Order> BY_PLACEMENT_THEN_TOTAL =
    Comparator.comparing(Order::placedAt, Comparator.nullsLast(Comparator.naturalOrder()))
              .thenComparing(Order::total);

// B: drafts sort first (alternative — drafts go to the top of the work queue):
private static final Comparator<Order> BY_PLACEMENT_THEN_TOTAL =
    Comparator.comparing(Order::placedAt, Comparator.nullsFirst(Comparator.naturalOrder()))
              .thenComparing(Order::total);

// C: drafts are a programming bug — filter them out upstream and keep the comparator strict.
var placedOnly = orders.stream().filter(o -> o.placedAt() != null).toList();
placedOnly.sort(BY_PLACEMENT_THEN_TOTAL);
```

Note the subtlety: the `nullsLast` / `nullsFirst` decoration goes on the **key comparator**, not the outer comparator. Wrapping `Comparator.nullsLast(Comparator.comparing(Order::placedAt))` would protect against a null *Order*, not a null *placedAt*. Two different nulls, two different decisions; usually you want to be explicit about the inner one. See [middle.md §5](middle.md) for the longer story on null safety.

---

## Pattern summary

| Bug type                                            | What to look for in review                                                       |
| --------------------------------------------------- | -------------------------------------------------------------------------------- |
| Integer overflow (Bugs 1, 7, 8)                     | `return a - b;` in `compareTo` or `Comparator`; `(int)(longA - longB)` casts     |
| Inconsistency with equals (Bug 2)                   | `TreeSet<BigDecimal>` or `TreeMap<BigDecimal, ?>`; "deduplicating" sorted sets   |
| Asymmetry across inheritance (Bug 3)                | Subclasses overriding `compareTo` to add a new discriminator; non-final `Comparable` types |
| Undefined IEEE-754 ordering (Bug 4)                 | `<` and `>` on `double`/`float`; lambdas that compare floats by hand              |
| Mutable key in sorted collection (Bug 5)            | Non-final fields read by `compareTo`; setter methods on `Comparable` types        |
| Locale-blind String comparison (Bug 6)              | `String.compareTo` (or `Comparator.naturalOrder()` on `String`) on multilingual data |
| Non-canonical return values (Bug 7)                 | Comparators that return arbitrary ints; subsequent `.reversed()` or negation       |
| Heap/tree invariants corrupted (Bug 8)              | `PriorityQueue`, `TreeSet`, `TreeMap` constructed with home-rolled comparators    |
| Sort/search comparator mismatch (Bug 9)             | Inline comparators at `Arrays.sort` and `Arrays.binarySearch` call sites          |
| Null keys in a comparator chain (Bug 10)            | `Comparator.comparing(SomeRecord::nullableField)` with no `nullsLast`/`nullsFirst` |

These ten bugs share a pattern: the compiler is silent, the JIT is silent, the tests on a "happy path" input distribution are silent, and the error only shows up when production data widens the input space (negative balances, NaN sensors, draft orders, non-ASCII names). Train your eye in code review: any comparator that returns the result of arithmetic, ignores `null`, reads a mutable field, or appears at both a sort site and a search site without being shared as a constant is a candidate to revisit.
