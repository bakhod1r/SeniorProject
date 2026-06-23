# Moving Features — Optimize

> 12 cases where the refactor is **functionally correct** but introduces a perf regression.

---

## Optimize 1 — Extract Class that adds an allocation per request (Java)

```java
public Money price(Order o) {
    return new PriceCalculator(o, taxTable, currencyRates).compute();
}
```

For 10K req/s, that's 10K allocations of `PriceCalculator` per second.

<details><summary>Cost & Fix</summary>

In modern JVMs, escape analysis often makes this free — the calculator never escapes `price`. Verify with `-XX:+PrintEscapeAnalysis`.

If escape analysis fails (e.g., calculator is stored in a list, or used across an inlining boundary), the allocation is real. Mitigations:

1. **Make `PriceCalculator` static-method-only:**
   ```java
   public static Money compute(Order o, TaxTable t, CurrencyRates r) { ... }
   ```
2. **Pool instances** (rarely necessary; usually GC handles it).
3. **Trust escape analysis** until proven otherwise — measure first.

In Go, the equivalent struct allocation is similarly often stack-promoted by escape analysis (`go build -gcflags='-m'` shows decisions).
</details>

---

## Optimize 2 — Move Field that hurts cache locality (Java)

You moved `interestRate` from `Account` to `AccountType`. Now a hot loop:

```java
for (Account a : accounts) {
    sum += a.balance() * a.type().interestRate();
}
```

Iterating 10M accounts: each `a.type().interestRate()` is two pointer hops.

<details><summary>Cost & Fix</summary>

If `accounts` are laid out contiguously, `a.balance()` is a hot access (one cache line per account). `a.type()` follows a pointer to a different memory region; `interestRate()` follows another pointer.

For a hot inner loop, cache misses dominate. Mitigations:

1. **Cache the rate locally** when the type repeats:
   ```java
   AccountType lastType = null;
   double cachedRate = 0;
   for (Account a : accounts) {
       if (a.type() != lastType) { lastType = a.type(); cachedRate = lastType.interestRate(); }
       sum += a.balance() * cachedRate;
   }
   ```

2. **Group by type** (sort `accounts` by `type` first) to maximize cache reuse.

3. **Specialized iteration**: if hot, denormalize back — keep `interestRate` on `Account` for the loop, accepting some duplication.

This is a clear case where the architecturally cleaner placement is at odds with cache-friendly layout.
</details>

---

## Optimize 3 — Hide Delegate that adds a virtual call (Java)

```java
class Person {
    private Department department;
    public Person manager() { return department.getManager(); }
}
```

If `manager()` is overridden in subclasses, every call site is now polymorphic.

<details><summary>Cost & Fix</summary>

Original `john.getDepartment().getManager()` was two direct calls. The new `john.manager()` is one virtual call — usually faster.

But: if `Person` becomes a polymorphic root with overridden `manager()`, calls become megamorphic.

Mitigation: mark `manager()` `final` if not meant for override. Otherwise, the JIT will install an inline cache and likely still inline.

Verify with `-XX:+PrintInlining`.
</details>

---

## Optimize 4 — Inline Class loses a useful pool (Java)

```java
class Coordinate {
    private final int x, y;
    public Coordinate(int x, int y) { this.x = x; this.y = y; }
    private static final Coordinate[][] CACHE = ...;   // pooled common values
    public static Coordinate of(int x, int y) {
        if (x < 8 && y < 8 && x >= 0 && y >= 0) return CACHE[x][y];
        return new Coordinate(x, y);
    }
}
```

Inlining `Coordinate` into uses (as two `int` fields) loses the pool — every use is fresh.

<details><summary>Cost & Fix</summary>

In games / simulations / data pipelines that create millions of small coordinates, the pool was load-bearing. Inlining made allocations explode.

**Fix:** Don't Inline a class that uses interning/pooling.

Or, if the inlining is genuinely better (e.g., in tight loops where each coordinate is short-lived), use **value classes (Project Valhalla)** when available, or accept the GC pressure if measured fine.
</details>

---

## Optimize 5 — Extract Class breaking serialization (Java)

```java
class User implements Serializable {
    private String name;
    private String email;
    private String address;
    // existing serialized form
}
```

After Extract Class:

```java
class Address implements Serializable {
    private String value;
}
class User implements Serializable {
    private String name;
    private String email;
    private Address address;
}
```

<details><summary>Cost & Fix</summary>

The wire format changed. Existing serialized blobs (cached, on disk, in flight) can't deserialize into the new shape.

**Fix:**
1. Use `serialVersionUID` and custom `writeObject`/`readObject` for compatibility.
2. Migrate stored blobs (one-time job).
3. Avoid Java native serialization entirely — use JSON / Protobuf with explicit schema versioning.

Lesson: Extract Class crosses a wire boundary if data is ever serialized. Plan migration.
</details>

---

## Optimize 6 — Move Method that broke a JIT inline (Java)

```java
class Account {
    private final AccountType type;
    public double charge(double days) { return type.charge(days); }   // moved away
}
```

`AccountType.charge` is now 200 bytes after Move. HotSpot's `MaxInlineSize` is 35; `FreqInlineSize` is 325. Currently inlined.

A teammate adds 20 lines to `charge`. Now it's 360 bytes. **Inlining stops.**

<details><summary>Cost & Fix</summary>

The Move was fine; growth is the problem. Hot path that used to be 1 cycle per call is now 5+ cycles plus dispatch.

**Fix:**
1. Re-extract within `AccountType` to keep the entry method small.
2. Profile: confirm with `-XX:+PrintInlining`.
3. Tune: `-XX:MaxInlineSize=200` (raises the threshold) — but global flags are blunt instruments.

Lesson: Move Method's perf cost depends on how the target method evolves over time, not just the move itself.
</details>

---

## Optimize 7 — Foreign method that allocates per call (Python)

```python
def date_to_iso(d: datetime) -> str:
    return d.strftime("%Y-%m-%dT%H:%M:%SZ")
```

In a hot loop:

```python
for record in records:
    out.append(date_to_iso(record.timestamp))
```

<details><summary>Cost & Fix</summary>

`strftime` is C-implemented but allocates a Python string per call. For 10M records, that's 10M strings.

Mitigation: prefer `isoformat()` (slightly faster) or, if format is fixed, pre-bind the format and use a faster path.

Best fix at scale: vectorize with `numpy` / `pandas` (`pd.Series.dt.strftime`) — single call, batch processing.

Lesson: A foreign method on a per-element hot path is a candidate for batch / vectorized rewrite.
</details>

---

## Optimize 8 — Local extension wrapping costs more than inheritance (Java)

```java
class MfDate {
    private final Date original;
    public MfDate(Date d) { this.original = d; }
    public MfDate nextDay() { return new MfDate(new Date(original.getTime() + 86400000L)); }
}
```

Each `nextDay()` allocates two objects: a new `Date` and a new `MfDate`.

<details><summary>Cost & Fix</summary>

For chained operations (`d.nextDay().nextDay().nextDay()`), the allocation count is 6.

**Fix:** Switch to `LocalDate` (immutable but with structural sharing in some cases) — `LocalDate.of(2025, 1, 1).plusDays(1).plusDays(1)` is similarly costly.

Better: process in bulk if you can. Or, for short chains, the cost is fine — modern JVM eliminates many such allocations via escape analysis.

For Kotlin, an extension function avoids the wrapper allocation entirely:
```kotlin
fun Date.nextDay() = Date(time + 86_400_000L)
```
One allocation per call (the new Date) instead of two.
</details>

---

## Optimize 9 — Extract Class causing a copy in Go (Go)

```go
type Address struct { line1, city, country string }
type User struct {
    Name string
    Address Address   // value embedded
}

func (u User) String() string { return u.Name + " " + u.Address.line1 }
```

Calling `user.String()` copies the entire `User` struct (including `Address`).

<details><summary>Cost & Fix</summary>

Each `String()` call copies ~40+ bytes. For tight loops, this is wasteful.

**Fix:** Pointer receivers.

```go
func (u *User) String() string { return u.Name + " " + u.Address.line1 }
```

Now only a pointer is passed. For consistency, all `User` methods should use pointer receivers.

Lesson: in Go, Extract Class isn't just about packaging — receiver choice matters.
</details>

---

## Optimize 10 — Hide Delegate that re-queries cache (Java)

```java
class Person {
    private DepartmentRepository repo;
    private long departmentId;

    public String departmentName() {
        return repo.findById(departmentId).getName();   // ❌ DB query per call
    }
    public int departmentSize() {
        return repo.findById(departmentId).size();   // ❌ another query
    }
}
```

<details><summary>Cost & Fix</summary>

Each Hide Delegate method re-fetches the Department. 5 hidden methods = 5 queries per request.

**Fix:** Cache the Department once.

```java
class Person {
    private DepartmentRepository repo;
    private long departmentId;
    private Department cachedDepartment;

    private Department department() {
        if (cachedDepartment == null) cachedDepartment = repo.findById(departmentId);
        return cachedDepartment;
    }

    public String departmentName() { return department().getName(); }
    public int departmentSize() { return department().size(); }
}
```

Better: Person holds a reference (or DTO) to Department directly, populated once at construction.

Lesson: Hide Delegate can hide expensive lookups too. Always check what the chain actually does.
</details>

---

## Optimize 11 — Move Method introducing reflection (Java)

```java
class FeatureGate {
    private Map<String, Boolean> flags;

    public boolean isEnabled(String name) {
        return flags.getOrDefault(name, false);
    }
}
```

**"Moved":** "Each feature should know if it's enabled."

```java
class Feature {
    public boolean isEnabled() {
        try {
            Field f = FeatureGate.class.getDeclaredField("flags");
            f.setAccessible(true);
            Map<String, Boolean> map = (Map<String, Boolean>) f.get(gate);
            return map.getOrDefault(this.name(), false);
        } catch (Exception e) { return false; }
    }
}
```

<details><summary>Cost & Fix</summary>

The "move" used reflection to access `FeatureGate`'s private field. Reflection is slow (~1000× a normal field access without caching) and brittle.

**Fix:** Don't reflect to bypass encapsulation. Either pass the gate as a parameter or use the public API:

```java
class Feature {
    public boolean isEnabled(FeatureGate gate) {
        return gate.isEnabled(this.name());
    }
}
```

Lesson: if you're using reflection to "move" a feature, you're not refactoring — you're hacking around encapsulation.
</details>

---

## Optimize 12 — Extract Class + Stream pipeline introduces allocations (Java)

```java
class Order {
    private List<LineItem> items;
    public Money total() {
        Money sum = Money.zero();
        for (LineItem li : items) sum = sum.plus(li.total());
        return sum;
    }
}
```

After Extract Class:

```java
class TotalCalculator {
    public Money compute(List<LineItem> items) {
        return items.stream()
                    .map(LineItem::total)
                    .reduce(Money.zero(), Money::plus);
    }
}
```

<details><summary>Cost & Fix</summary>

The stream pipeline allocates: a Stream, a mapping pipeline, an accumulator. For tight inner loops with thousands of items per request, this can show in JFR allocation profiles.

**Fix:** Keep the explicit loop in the Extract:

```java
class TotalCalculator {
    public Money compute(List<LineItem> items) {
        Money sum = Money.zero();
        for (LineItem li : items) sum = sum.plus(li.total());
        return sum;
    }
}
```

Java streams are generally fine — but on hot paths with primitive-friendly types, primitive specializations (`IntStream`, `LongStream`) or explicit loops are sometimes 2× faster.

Lesson: Extract Class shouldn't change the algorithmic style unintentionally.
</details>

---

## Patterns

| Refactor | Risk |
|---|---|
| Extract Class | Per-call allocation (usually fine via EA) |
| Move Field | Cache locality |
| Hide Delegate | Hidden expensive work |
| Inline Class | Lost pool / interning |
| Extract Class | Serialization breakage |
| Move Method | Inlining cliff over time |
| Foreign method | Per-element overhead |
| Extract Class (Go) | Value-vs-pointer copy |

---

## Next

- [tasks.md](tasks.md) — practice clean refactors
- [find-bug.md](find-bug.md) — wrong moves
- [interview.md](interview.md) — review
