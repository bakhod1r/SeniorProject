# Comparable vs Comparator Contracts — Junior

> **What?** Java has two ways to express "how do I order objects of this type". `Comparable<T>` puts *one* ordering inside the class itself — the *natural order*. `Comparator<T>` is an *external* object that can define many different orderings for the same type, including ad-hoc ones you build on the spot.
> **How?** Implement `Comparable<T>` when a type has a single, obvious, intrinsic ordering (numbers by value, dates by instant, version tags by precedence). Reach for `Comparator<T>` when a type has *no* one canonical order, or when you need a *different* order for a specific query (people by age in HR, by surname in the address book, by hire date for retirement reports).

---

## 1. The two interfaces in one sentence

`Comparable<T>` is what a type says about *itself*. `Comparator<T>` is what someone *outside* the type says about how to compare two of its instances.

```java
// Comparable lives INSIDE the class:
public final class Version implements Comparable<Version> {
    public int compareTo(Version other) { ... }
}

// Comparator lives OUTSIDE:
Comparator<Person> byAge = Comparator.comparingInt(Person::age);
```

A type can have *at most one* `Comparable` implementation — that's the natural order. A type can have *as many* `Comparator` instances as you want — one per question you ask of the data.

Most APIs that need an ordering accept either: `Collections.sort(list)` uses the natural order, `Collections.sort(list, cmp)` uses the supplied comparator. `TreeSet`, `TreeMap`, `PriorityQueue`, `Arrays.sort`, and `Stream.sorted()` all follow the same dual-form convention.

---

## 2. When to use `Comparable<T>` — the natural-order rule

A type has a *natural order* when there is one ordering everyone reading the code would expect, with no surprises. Numbers are ordered by value. `LocalDate` is ordered by calendar position. `String` is ordered lexicographically (by UTF-16 code unit). `BigInteger`, `BigDecimal`, `Duration`, `Instant` all expose intrinsic orderings.

```java
public final class Version implements Comparable<Version> {
    private final int major;
    private final int minor;
    private final int patch;

    public Version(int major, int minor, int patch) {
        this.major = major;
        this.minor = minor;
        this.patch = patch;
    }

    @Override
    public int compareTo(Version other) {
        int c = Integer.compare(this.major, other.major);
        if (c != 0) return c;
        c = Integer.compare(this.minor, other.minor);
        if (c != 0) return c;
        return Integer.compare(this.patch, other.patch);
    }
}
```

`Version` has one obvious ordering: lexicographic on the three numeric fields. No one would seriously sort versions by minor-then-major. So `Comparable` is the right home for it.

The test of "obvious": if a reviewer reads `Collections.sort(versions)` and doesn't have to ask "sorted *how*?", the natural order is doing its job. If they have to ask, the type probably shouldn't implement `Comparable` at all — every caller will need a `Comparator` anyway.

---

## 3. When to use `Comparator<T>` — multiple or external orderings

A `Person` has many plausible orderings: by age, by surname, by hire date, by salary, by employee ID, by department then by surname. None is *the* order. Implementing `Comparable` on `Person` would arbitrarily privilege one of them and leave every other caller to either accept the choice or pass a `Comparator` anyway.

```java
public record Person(long id, String surname, String givenName,
                     int age, BigDecimal salary, LocalDate hiredOn) {}

Comparator<Person> byAge     = Comparator.comparingInt(Person::age);
Comparator<Person> bySurname = Comparator.comparing(Person::surname);
Comparator<Person> byHireDate = Comparator.comparing(Person::hiredOn);

people.sort(byAge);
people.sort(bySurname);
people.sort(byHireDate);
```

Each comparator captures one query. None of them is the "natural" one. `Person` stays plain — no `Comparable` implementation, no opinionated ordering baked in.

A useful rule of thumb: if you find yourself adding a comment to `compareTo` to explain *which* ordering it implements, you've made a `Comparator` and put it in the wrong place.

---

## 4. First example — sorting people by age

The simplest realistic case: a list of people, sort them by age ascending. Two equivalent ways.

**Option A — `Comparable` on `Person`.** Only sensible if age is genuinely the natural order (it almost never is for people, but pretend for this example).

```java
public final class Person implements Comparable<Person> {
    private final String name;
    private final int age;

    public Person(String name, int age) { this.name = name; this.age = age; }
    public int age() { return age; }

    @Override
    public int compareTo(Person other) {
        return Integer.compare(this.age, other.age);
    }
}

List<Person> people = new ArrayList<>(List.of(
    new Person("Aida", 31),
    new Person("Bek", 24),
    new Person("Madina", 47)));

Collections.sort(people);   // uses Person.compareTo
```

**Option B — `Comparator` from outside.** The right choice when age is just one possible order among many.

```java
public record Person(String name, int age) {}

List<Person> people = new ArrayList<>(...);
people.sort(Comparator.comparingInt(Person::age));
```

`Person` says nothing about ordering; the caller spells out the ordering it wants. Adding "sort by name" later is one new line, not a change to `Person`.

---

## 5. The `compareTo` return convention

`compareTo` (and `Comparator.compare`) returns an `int` with these rules:

- **Negative** — `this` is less than `other` (sorts earlier).
- **Zero** — `this` is equal to `other` for ordering purposes.
- **Positive** — `this` is greater than `other` (sorts later).

The *magnitude* is not part of the contract. Returning `-1`, `-7`, or `Integer.MIN_VALUE` all mean "less than". Many tutorials show `-1 / 0 / 1` and that's fine, but you may also return any signed int — what callers check is the *sign*.

That said, many real-world bugs come from returning *unnormalised* values that *almost* always work. Bug 6 in `find-bug.md` walks through the classic case (`Integer.MIN_VALUE` returned where `-1` was meant, then negated by a wrapping comparator). Until you understand why, prefer returning canonical `-1 / 0 / 1`:

```java
@Override
public int compareTo(Person other) {
    int diff = Integer.compare(this.age, other.age);
    return Integer.signum(diff);   // always -1, 0, or +1
}
```

`Integer.compare` already does this. So does `Long.compare`, `Double.compare`, etc. Use them.

---

## 6. The integer overflow trap — `return a - b;`

The most famous junior-level bug in `compareTo`:

```java
// BROKEN — overflows for large negative b:
@Override
public int compareTo(Account other) {
    return this.balance - other.balance;     // int subtraction
}
```

If `this.balance == 2_000_000_000` and `other.balance == -2_000_000_000`, then `2_000_000_000 - (-2_000_000_000) == 4_000_000_000`, which overflows the `int` range and *wraps* to a negative value. `compareTo` now says "less than" when it should say "greater than", and your sorted output is silently wrong.

The fix is one method call:

```java
@Override
public int compareTo(Account other) {
    return Integer.compare(this.balance, other.balance);   // never overflows
}
```

`Integer.compare(x, y)` is defined as roughly `(x < y) ? -1 : (x == y) ? 0 : 1`, so it returns one of three values and cannot overflow. For `long`, `double`, `float` there are similarly named static methods. For `BigDecimal`, use its `compareTo` directly. For *no* numeric primitive should you write `a - b`.

This same trap appears with `long`:

```java
return (int) (this.timestampMs - other.timestampMs);   // wrong twice over
```

Even if `long - long` doesn't overflow, casting the result to `int` discards the high bits and the sign can flip. Always use `Long.compare(...)`.

---

## 7. Returning non-{-1, 0, 1} values — the other half of the trap

Beyond overflow, returning *any* int outside `{-1, 0, 1}` is technically legal but invites a second class of bug. The standard library and most third-party code respect only the *sign* — but if you wrap or negate a comparator and the underlying value is `Integer.MIN_VALUE`, you produce undefined behaviour:

```java
Comparator<Integer> bad = (a, b) -> a - b;        // can return MIN_VALUE
Comparator<Integer> reversed = bad.reversed();    // tries to negate MIN_VALUE
// Integer.MIN_VALUE negated overflows back to MIN_VALUE — same sign, broken inversion.
```

Two safe habits while learning:

1. **Always delegate to `Integer.compare`, `Long.compare`, `Double.compare`, or a sub-comparator** rather than computing the difference yourself.
2. **Treat the return as a sign, not a magnitude.** The moment your code does arithmetic on a comparator return value (`-result`, `result * 2`), it has crossed into undefined-behaviour territory.

---

## 8. The two-comparator pattern in practice

Once you have a record and a couple of comparators, building sorted views is a one-liner:

```java
public record Order(String id, LocalDate placedAt, BigDecimal total) {}

List<Order> orders = ...;

// By placement date, newest first:
orders.sort(Comparator.comparing(Order::placedAt).reversed());

// By total descending, then by id ascending as tiebreaker:
orders.sort(
    Comparator.comparing(Order::total).reversed()
              .thenComparing(Order::id)
);
```

Two operators do most of the work:

- `.reversed()` — flip the ordering of the comparator it's called on.
- `.thenComparing(...)` — fall back to a second comparator when the first says "equal".

Worth knowing they exist now; we'll go deeper in `middle.md`.

---

## 9. Common newcomer mistakes

**Mistake 1: `return a - b;`.** Covered above. The fix is `Integer.compare(a, b)`.

**Mistake 2: returning a `boolean` cast to int.**

```java
// Wrong — only returns 0 or 1, never negative:
return Boolean.compare(this.active, other.active);
return (this.balance > other.balance) ? 1 : 0;
```

Both produce "less than" never, which makes the sort silently incomplete. Always cover all three branches.

**Mistake 3: comparing fields by `==` for strings or wrappers.**

```java
@Override public int compareTo(Person other) {
    if (this.name == other.name) return 0;   // wrong — reference equality
    return this.name.compareTo(other.name);
}
```

Use the field's own `compareTo` or `Comparator.comparing(...)`.

**Mistake 4: implementing `Comparable` on a mutable type.**

If `Person.age` can change after the object is put into a `TreeSet`, the set's invariants break — the object is filed under one ordering and later belongs to another. Either make the type immutable (records help) or only ever sort copies.

**Mistake 5: implementing `Comparable` because "the IDE suggested it".**

`Comparable` is for types with a natural order. If you're hesitating about which field to compare first, the type doesn't have a natural order — use `Comparator` and don't implement the interface.

---

## 10. Quick rules

- [ ] One natural order → `Comparable<T>` *on the class*.
- [ ] Many possible orders or none canonical → `Comparator<T>` *outside the class*.
- [ ] Never `return a - b;`. Use `Integer.compare`, `Long.compare`, `Double.compare`.
- [ ] Treat the return value as a sign, not a magnitude.
- [ ] Don't implement `Comparable` on a mutable type that goes into sorted collections.
- [ ] Use `Comparator.comparing(...)` and `.thenComparing(...)` instead of hand-written `compare` bodies whenever you can.
- [ ] If `compareTo` needs a comment to say "which" order it is, you wanted a `Comparator`.

---

## 11. What's next

| Topic                                                          | File              |
| -------------------------------------------------------------- | ----------------- |
| Refactoring real comparators, chaining, consistent-with-equals | `middle.md`        |
| TreeSet/BigDecimal traps, locale, generics                     | `senior.md`        |
| Code review, lint rules, mentoring on this contract            | `professional.md`  |
| JLS/Javadoc references for both interfaces                     | `specification.md` |
| Buggy snippets — overflow, NaN, inconsistency, locale          | `find-bug.md`      |
| Primitive specializations, JIT, dispatch                       | `optimize.md`      |
| Hands-on exercises                                             | `tasks.md`         |
| Interview Q&A                                                  | `interview.md`     |

---

**Memorize this:** `Comparable` is one natural order baked into the type; `Comparator` is any number of external orderings. Never subtract to compare integers — `Integer.compare` is one keystroke longer and never wraps. Return a sign, not a magnitude. The moment a type has more than one plausible ordering, leave `Comparable` off and let callers pass the `Comparator` they want.
