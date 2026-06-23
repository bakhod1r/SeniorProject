# equals / hashCode / toString Contracts — Junior

> **What?** Every Java object inherits three methods from `java.lang.Object` whose default behaviour is almost always wrong for your domain types: `equals(Object)` compares by *identity* (the same memory reference), `hashCode()` returns an identity-based number, and `toString()` prints `ClassName@1a2b3c4d`. To make your objects behave correctly as values, dictionary keys, or log lines, you must override all three together — and obey the contracts the JDK has documented since Java 1.0.
> **How?** Decide whether your class is a *value* (equal by fields) or an *entity* (equal by identifier). If it's a value, override `equals` to compare the fields, override `hashCode` to derive from the same fields, and override `toString` to print them. Never override `equals` without `hashCode` — they form a single contract.

---

## 1. Why the defaults are wrong

Every class in Java extends `java.lang.Object`. The three methods you almost always need to override are inherited from there. Their default bodies do something specific:

```java
public boolean equals(Object obj) { return (this == obj); }       // identity
public native int hashCode();                                     // identity hash
public String toString() { return getClass().getName()
                              + "@" + Integer.toHexString(hashCode()); }
```

`Object.equals` is *reference equality* — true only when both sides are the same allocation on the heap. `Object.hashCode` is a JVM-assigned identity hash (HotSpot stores it in the object header). `Object.toString` is debug-grade gibberish.

These defaults are correct for objects that have *identity* — a running `Thread`, an open `FileChannel`, a `JFrame` window. They are wrong for *values* — a `Money`, a `Point`, a `LocalDate`, a `Customer` with an ID. When you do this:

```java
Point a = new Point(3, 4);
Point b = new Point(3, 4);

System.out.println(a.equals(b));   // false  — different allocations
Set<Point> seen = new HashSet<>();
seen.add(a);
seen.contains(b);                  // false  — different identity hashes
System.out.println(a);             // Point@5e9f23b4
```

Two points that *represent the same coordinate* are treated as unrelated. They cannot deduplicate in a `HashSet`. They cannot be looked up by value in a `HashMap`. They print as line noise in logs. The fix is to override the three methods so they reflect what your domain considers equal.

---

## 2. The three contracts, one paragraph each

**`equals(Object)`** — given two references, decide whether they represent the same conceptual value. Must be reflexive (`x.equals(x)` is true), symmetric (`x.equals(y) == y.equals(x)`), transitive (`a==b`, `b==c` implies `a==c`), consistent (same answer if neither object changes), and never true against `null` (`x.equals(null)` is false). These five rules come from the Javadoc of `Object.equals` and are normative — collection classes assume they hold.

**`hashCode()`** — return an `int` such that *equal objects always return equal hash codes*. Unequal objects *may* return equal hash codes (collisions are allowed) but a good `hashCode` distributes values across the `int` range so that hash-based collections stay fast. If `a.equals(b)` is true, `a.hashCode() == b.hashCode()` *must* be true; the converse is not required.

**`toString()`** — return a human-readable string describing this object's state. The JDK does not mandate a format, but a sensible default is `ClassName[field1=value1, field2=value2]`. This is what shows up in log lines, debugger watches, assertion failures, and exception messages, so it is your single most-read piece of code for any value class.

These three methods are a *contract triple* — you almost never override one without the other two. The JDK collection framework assumes you do; violating the contract puts your objects into a state where `HashSet`, `HashMap`, `LinkedHashSet`, and every concurrent hash-based structure misbehave silently.

---

## 3. A `Point` worked example

```java
public final class Point {
    private final int x;
    private final int y;

    public Point(int x, int y) {
        this.x = x;
        this.y = y;
    }

    public int x() { return x; }
    public int y() { return y; }

    @Override
    public boolean equals(Object o) {
        if (this == o) return true;                   // reflexive / fast path
        if (!(o instanceof Point other)) return false; // null-safe + type check
        return x == other.x && y == other.y;
    }

    @Override
    public int hashCode() {
        return Objects.hash(x, y);
    }

    @Override
    public String toString() {
        return "Point[x=" + x + ", y=" + y + "]";
    }
}
```

Five things to notice:

1. **The class is `final`.** Inheritance and `equals` interact badly (covered at senior level). If you don't *need* a subclass, mark the class `final` and the headache goes away.
2. **Fields are `final`.** A value's identity is its fields; if they can change, the contract breaks (covered in section 7).
3. **`equals` opens with `this == o`.** A reflexive shortcut. Also the only correct path for many hot loops — most objects are compared to themselves first.
4. **`equals` uses `instanceof` with a pattern variable** (`o instanceof Point other`). Since Java 16 (JEP 394), this is the canonical idiom. It is also null-safe — `null instanceof Anything` is always false.
5. **`hashCode` uses `Objects.hash(...)`** — a JDK utility (`java.util.Objects`) that combines fields the same way you'd do by hand, but in one line. For a single field, `Objects.hashCode(x)` is enough. For multiple fields, `Objects.hash(x, y)`.

This class is now a *value*: two `Point(3, 4)` instances are equal, hash to the same bucket, and print clearly in logs.

---

## 4. The records shortcut

Java 16 introduced records (JEP 395). They are *built-in* value classes — the compiler generates `equals`, `hashCode`, and `toString` for you, based on the declared components.

```java
public record Point(int x, int y) { }
```

That single line is equivalent to the entire class in section 3. The compiler produces:

- A canonical constructor taking `(int x, int y)`.
- Accessor methods `x()` and `y()`.
- `equals(Object)` that compares all components.
- `hashCode()` derived from all components.
- `toString()` formatted as `Point[x=3, y=4]`.

For every value class where the default behaviour suits you, *use a record*. You will write less code, get the contracts right by construction, and the JDK takes care of the rest.

Records have one constraint: their components are *final*, and the record itself is implicitly `final`. That is by design — equality on mutable state is the source of most `hashCode` bugs (section 7).

---

## 5. The `equals` contract clauses, one by one

The five clauses from the Javadoc of `java.lang.Object.equals`. Every line of `equals` you write must respect all five.

**Reflexive:** `x.equals(x)` must return `true`. This sounds obvious; the `this == o` opener guarantees it.

**Symmetric:** `x.equals(y)` must equal `y.equals(x)`. The classic break: two classes that consider themselves equal by different rules. `String s = "abc"; CharSequence cs = new StringBuilder("abc"); s.equals(cs)` is `false`; the reverse may differ. Always compare same-typed objects.

**Transitive:** if `a.equals(b)` and `b.equals(c)`, then `a.equals(c)`. The classic break: a parent class that compares by some fields and a subclass that adds more fields — the parent says yes, the subclass says no, transitivity fails. Hence section 9 on inheritance.

**Consistent:** repeated calls return the same result, provided no field used in the comparison changes. If you use a mutable field, two consecutive calls may disagree — and a `HashSet` that put your object in bucket *X* on insertion can't find it in bucket *Y* on lookup.

**Non-null:** `x.equals(null)` must return `false`, never throw `NullPointerException`. The `instanceof` check handles this for free — `null instanceof Anything` is `false`.

Each clause has a specific failure mode in production. The most common is consistency (mutating fields used in `equals`); the second most common is symmetry (mixing types). The third is transitivity (inheritance with extra state).

---

## 6. `hashCode` must agree with `equals`

The single rule: **if `a.equals(b)` is `true`, then `a.hashCode() == b.hashCode()` must be `true`.**

If you override `equals` and forget to override `hashCode`, every value-equal pair you create will land in different buckets of a `HashSet` or `HashMap`. The set will allow duplicates; the map will lose entries. The bug is silent — no exception, no warning, just a collection that behaves wrong.

```java
Map<Point, String> labels = new HashMap<>();
labels.put(new Point(1, 1), "origin-ish");
labels.get(new Point(1, 1));   // null  — when hashCode was not overridden
```

The reverse rule is *not* required: two unequal objects *may* return the same `hashCode` (this is called a *collision*). Hash-based collections handle collisions internally by walking a bucket's chain. A perfect distribution is desirable; a perfect *bijection* is not.

The mnemonic: **`equals` decides what is equal; `hashCode` decides what is in the same bucket.** Two equal objects must share a bucket. Two unequal objects are allowed to.

---

## 7. Why mutability poisons hash-based collections

```java
class Customer {
    String email;
    /* equals + hashCode based on email */
}

Customer c = new Customer();
c.email = "alice@example.com";

Set<Customer> active = new HashSet<>();
active.add(c);

c.email = "alice2@example.com";   // mutate after add — now in wrong bucket

active.contains(c);               // false! the set's hash table still indexes c at the old bucket
active.remove(c);                 // false — can't find it either
```

When you put `c` into the set, the set used `c.hashCode()` to decide a bucket. Mutating `email` changed `hashCode()`, but the set has no notification — `c` is now stored in bucket "old-email-hash" while `contains` looks in bucket "new-email-hash". The object is *invisible to the set that contains it*.

The cure is structural: **don't use mutable fields in `equals`/`hashCode`**, or **don't mutate objects you have stored in a hash-based collection**. The cleanest cure is records (final fields, immutable by construction). The next cleanest is a class with `final` fields and no setters. Mutable fields are a smell every time they appear in an `equals` body.

---

## 8. Common newcomer mistakes

**Mistake 1: using `==` instead of `.equals()` for strings.**

```java
String a = readUserInput();
if (a == "yes") doIt();        // compares references, almost always false
```

Use `a.equals("yes")` — or, to avoid `NullPointerException`, `"yes".equals(a)`. `==` only works on string literals because of the *string pool*, and even then it's a fragile coincidence rather than a feature you should rely on.

**Mistake 2: overriding `equals` but not `hashCode`.**

```java
class Customer {
    long id;
    @Override public boolean equals(Object o) { /* by id */ }
    // hashCode forgotten
}
```

`HashSet<Customer>` will store duplicates. Every modern IDE warns about this; SpotBugs reports it as `EQ_DOESNT_OVERRIDE_HASHCODE`. Always override both, always together.

**Mistake 3: `equals` taking a typed parameter.**

```java
public boolean equals(Customer other) { ... }   // overloads, doesn't override
```

`Object.equals` takes `Object`. If you declare a method `equals(Customer)`, you've created a *new method* — Java's overload resolution picks it only when the static type is `Customer`. Code that holds your object as `Object`, or compares through a `HashSet`, calls the inherited `Object.equals`, which compares by identity. Always write `public boolean equals(Object o)` and use `@Override` to let the compiler catch the mistake.

**Mistake 4: `instanceof` vs `getClass()` confusion.**

```java
// Style A — instanceof
if (!(o instanceof Point p)) return false;

// Style B — getClass()
if (o == null || o.getClass() != getClass()) return false;
```

Both compile. They differ in how they treat subclasses. With `instanceof`, a `ColoredPoint` (extends `Point`) *can* equal a plain `Point`. With `getClass()`, they *cannot*. The senior-level file explores this debate in detail; for now, prefer `instanceof` when your class is `final` (no subclasses exist) and prefer `getClass()` when a subclass might add state. Or, simpler: write value classes as records or `final`, and use `instanceof`.

**Mistake 5: `toString` that leaks sensitive data.**

```java
public String toString() {
    return "User[email=" + email + ", password=" + password + "]";   // logs it everywhere
}
```

Logs, exception messages, debugger watches — anything that prints this object now leaks the password. `toString` is for *operator-readable* output. If the class holds secrets, mask them: `password=***` or omit the field entirely.

---

## 9. Inheritance changes everything

The instant your value class can be extended, the contracts get harder.

```java
class Point {
    final int x, y;
    @Override public boolean equals(Object o) {
        if (!(o instanceof Point p)) return false;
        return x == p.x && y == p.y;
    }
}

class ColoredPoint extends Point {
    final Color color;
    @Override public boolean equals(Object o) {
        if (!(o instanceof ColoredPoint cp)) return false;
        return super.equals(o) && color == cp.color;
    }
}
```

Then:

```java
Point        p  = new Point(1, 2);
ColoredPoint cp = new ColoredPoint(1, 2, RED);

p.equals(cp);   // true — instanceof Point matches
cp.equals(p);   // false — p is not a ColoredPoint
```

Symmetry is broken. The fix is either to mark the parent `final`, to compare classes with `getClass()` (then `Point` and `ColoredPoint` are *never* equal, even when their points match), or to redesign the relationship via composition. This is the **canonical Bloch Item 10 debate**, and the senior file walks through it. For now, the safe rule for juniors is: **if you override `equals`, make the class `final` (or write it as a record).**

---

## 10. Quick rules

- [ ] If you override `equals`, override `hashCode` too. Always together.
- [ ] Use `Objects.hash(field1, field2, ...)` for `hashCode`. Don't invent your own.
- [ ] Use `o instanceof Point p` (Java 16+, JEP 394) in `equals`. It is null-safe.
- [ ] Make value classes `final` — or, better, declare them as `record`.
- [ ] Never use mutable fields in `equals` / `hashCode`. Records prevent this by default.
- [ ] `toString` is a debugging tool: include the class name and the field values, never include passwords/tokens/PII.
- [ ] For strings, use `.equals()`, not `==`.
- [ ] `@Override` on all three methods — the compiler catches typos like `equals(Customer)`.

---

## 11. What's next

| Topic                                                        | File              |
| ------------------------------------------------------------ | ----------------- |
| Mechanical recipe, hash quality, refactoring legacy equals   | `middle.md`        |
| `instanceof` vs `getClass()`, inheritance traps, proxies     | `senior.md`        |
| Code-review vocabulary, ArchUnit/Sonar rules, mentoring      | `professional.md`  |
| JLS sections, JEP 395 records, `Objects` utility class       | `specification.md` |
| Ten buggy snippets and their runtime symptoms                | `find-bug.md`      |
| Allocation, hash caching, JIT and instanceof chains          | `optimize.md`      |
| Hands-on exercises                                           | `tasks.md`         |
| Interview Q&A                                                | `interview.md`     |

Related sections in the roadmap:

- [../../03-design-principles/06-fragile-base-class-problem/](../../03-design-principles/06-fragile-base-class-problem/) — why inheritance breaks `equals`.
- [../../03-design-principles/02-composition-over-inheritance/](../../03-design-principles/02-composition-over-inheritance/) — the alternative to inheriting a parent's `equals`.
- [../05-immutability-and-defensive-copying/](../05-immutability-and-defensive-copying/) — the structural fix for mutable-equals bugs.

---

**Memorize this:** override `equals`, `hashCode`, and `toString` *together* — they are one contract, not three. Equal objects must share a hash code. Mutable fields in `equals` poison hash-based collections. Records hand you all three for free; reach for them first. When you can't use a record, mark the class `final`, use `instanceof` with pattern matching, and let `Objects.hash` build your hash code.
