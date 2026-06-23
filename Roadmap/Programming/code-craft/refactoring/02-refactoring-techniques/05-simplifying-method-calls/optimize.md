# Simplifying Method Calls — Optimize

> 12 cases where the refactor is correct but introduces a perf cost.

---

## Optimize 1 — Builder allocation in hot path (Java)

```java
for (Request r : requests) {
    HttpResponse resp = client.send(HttpRequest.builder()
        .url(r.url())
        .header("X", "Y")
        .build());
}
```

<details><summary>Cost & Fix</summary>

Each iteration allocates: Builder, internal Map for headers, varargs arrays. For 10K req/s with 5 headers: significant GC pressure.

**Fix options:**
1. **Reusable request:** if the request is mostly the same, build once and tweak per call:
   ```java
   HttpRequest base = builder().header("X", "Y").build();
   for (Request r : requests) {
       client.send(base.withUrl(r.url()));
   }
   ```
2. **Skip the builder:** provide a one-shot factory.
3. **Profile first.** Modern JVMs eliminate many builder allocations via escape analysis.
</details>

---

## Optimize 2 — Introduce Parameter Object adds allocation (Java)

```java
public boolean overlaps(DateRange a, DateRange b) { ... }
```

In a hot path scanning 1M intervals: 1M DateRange allocations.

<details><summary>Cost & Fix</summary>

Records are short-lived; escape analysis usually eliminates the allocation. Verify with `-XX:+PrintEliminateAllocations`.

If EA fails:
1. Pass primitives directly.
2. Use object pools (rarely worth it).
3. Wait for Project Valhalla.

For typical cases: zero observable cost.
</details>

---

## Optimize 3 — Replace Exception with Test for Map.get (Java)

```java
// "Refactored" to test:
if (cache.containsKey(key)) {
    return cache.get(key);
}
return null;
```

<details><summary>Cost & Fix</summary>

Two map lookups instead of one. For 1M req/sec, 2× the hash function calls.

**Fix:** Use `Map.get` directly (returns null for missing) — no exception in the original anyway:

```java
return cache.get(key);   // null if absent, no exception
```

Lesson: Replace Exception with Test should not double-lookup. Use APIs that return optional/null.
</details>

---

## Optimize 4 — Factory method allocation when caller wanted reuse (Java)

```java
public static Money zero() { return new Money(0, USD); }
Money total = items.stream().map(Item::price).reduce(Money.zero(), Money::plus);
```

<details><summary>Cost & Fix</summary>

`Money.zero()` allocates a new Money each call. The reduce starts with one allocation, but if `Money.zero()` is called many places, it adds up.

**Fix:** Cache:
```java
public static final Money ZERO = new Money(0, USD);
public static Money zero() { return ZERO; }
```

Or for currency-parameterized zeros: `Money.zero("USD")` with a per-currency cache.
</details>

---

## Optimize 5 — Encapsulate Downcast doesn't help in tight loop (Java)

```java
public Reading lastReading() { return (Reading) readings.last(); }

for (int i = 0; i < N; i++) {
    Reading r = station.lastReading();   // checkcast in the helper
    process(r);
}
```

<details><summary>Cost & Fix</summary>

Each call goes through `lastReading`, which does the cast. JIT typically inlines and may eliminate the cast.

If inlining doesn't happen (e.g., `lastReading` grows large), the cast is paid per iteration.

**Fix:** Strongly type the underlying collection:
```java
private final List<Reading> readings;   // generic, no cast needed
public Reading lastReading() { return readings.get(readings.size() - 1); }
```

No cast at all. Lesson: Encapsulate Downcast is a stop-gap; generics are the proper fix.
</details>

---

## Optimize 6 — Varargs logging in hot path (Java)

```java
log.debug("processing {}, {}, {}", id, name, country);   // varargs allocation
```

For 1M debug log calls/sec (when debug is enabled): array allocations dominate.

<details><summary>Cost & Fix</summary>

SLF4J provides parameterized overloads:

```java
log.debug("processing {}", id);                   // 1 arg, no varargs
log.debug("processing {} {}", id, name);          // 2 args, no varargs
log.debug("processing {} {} {}", id, name, country);   // 3 args, no varargs
log.debug("processing {} {} {} {}", a, b, c, d);  // 4+: varargs
```

Up to 3 args (or 4 with some libs), no array.

**Fix:** check that you're using parameterized form, not concatenation. SLF4J / log4j handle the rest.
</details>

---

## Optimize 7 — Functional Options in Go hot path (Go)

```go
for _, addr := range addresses {
    srv := NewServer(addr, WithPort(443), WithTLS())
    ...
}
```

<details><summary>Cost & Fix</summary>

Each `NewServer` allocates the Server struct + executes each `Option` closure. Closures in Go are cheap (typically allocations elide), but if you're constructing thousands per second...

**Fix:** Build a "template" and clone:

```go
template := NewServer("dummy", WithPort(443), WithTLS())
for _, addr := range addresses {
    srv := *template      // value copy
    srv.addr = addr
    ...
}
```

Or use a builder pattern that mutates an existing struct.

For most cases: just measure. Go's escape analysis eliminates many such allocations.
</details>

---

## Optimize 8 — Replace Constructor with Factory hides slow path (Java)

```java
public static User from(UserDto dto) {
    return new User(
        dto.id,
        validateEmail(dto.email),       // expensive
        loadPreferences(dto.id)         // database hit
    );
}
```

<details><summary>Cost & Fix</summary>

Naive factories can hide expensive work. Caller may invoke in a loop, multiplying cost.

**Fix:** Make the cost visible:
1. Document: "May hit DB."
2. Provide a fast variant: `User.fromShallow(dto)` that doesn't load preferences; `loadFull()` separate.
3. Use lazy loading: `user.preferences()` loads on first call.
</details>

---

## Optimize 9 — Hide Method prevents JIT specialization (Java)

```java
public class A {
    public final boolean check(X x) { ... }
}
```

```java
public class A {
    private boolean check(X x) { ... }
}
```

<details><summary>Cost & Fix</summary>

Both are monomorphic (final OR private — no override). JIT inlines either. **No perf difference.**

The `private` is preferable for encapsulation. Don't worry about perf.
</details>

---

## Optimize 10 — Parameterize Method introduces branch in hot loop (Java)

```java
double raise(double percentage) {
    if (percentage > 0.10) auditLargeRaise(percentage);   // ❌
    return salary * (1 + percentage);
}
```

vs. the old:
```java
double tenPercentRaise() { return salary * 1.10; }
double fifteenPercentRaise() { return salary * 1.15; }
```

<details><summary>Cost & Fix</summary>

Parameterized version adds a branch per call. For 10M calls/sec, the branch cost adds up (~1 ns/call). Branch prediction usually handles it.

**Fix:** If the audit is rare and constant, separate out:
```java
double raise(double percentage) {
    return salary * (1 + percentage);
}
double largeRaise(double percentage) {
    auditLargeRaise(percentage);
    return raise(percentage);
}
```

Most hot callers use `raise`; auditors call `largeRaise`.
</details>

---

## Optimize 11 — Replace Parameter with Method Call doubles work (Java)

```java
double total() {
    return base() + tax(base());   // base() called twice
}
private double base() { return computeExpensive(); }
```

vs.
```java
double total() {
    double b = base();
    return b + tax(b);
}
```

<details><summary>Cost & Fix</summary>

If `base()` is expensive, calling it twice doubles the cost. JIT may CSE through pure calls but not through anything with side effects or non-trivial operations.

**Fix:** Cache once:
```java
double total() {
    double b = base();
    return b + tax(b);
}
```

Lesson: Replace Parameter with Method Call is fine for cheap pure expressions; cache for expensive ones.
</details>

---

## Optimize 12 — Throw + catch in tight loop (Java)

```java
for (String s : input) {
    try {
        result.add(Integer.parseInt(s));
    } catch (NumberFormatException e) {
        // skip invalid
    }
}
```

For input where 50% are invalid: 50% of iterations pay the throw cost (~5-50µs each).

<details><summary>Cost & Fix</summary>

For 1M items × 50% invalid × 25µs = 12.5 seconds of throw overhead.

**Fix:** Use a non-throwing parse:
```java
for (String s : input) {
    var maybe = tryParse(s);
    if (maybe.isPresent()) result.add(maybe.get());
}

private static Optional<Integer> tryParse(String s) {
    if (s == null || s.isEmpty()) return Optional.empty();
    int i = 0;
    if (s.charAt(0) == '-') i = 1;
    for (; i < s.length(); i++) {
        if (s.charAt(i) < '0' || s.charAt(i) > '9') return Optional.empty();
    }
    return Optional.of(Integer.parseInt(s));
}
```

Lesson: don't use exceptions for expected validation failures in hot loops. Replace Exception with Test.
</details>

---

## Patterns

| Refactor | Cost |
|---|---|
| Builder per call | GC pressure |
| Parameter Object | Allocation if EA fails |
| Two map lookups | 2× hash work |
| Factory not cached | Repeated construction |
| Encapsulate Downcast | Cast in loop |
| Varargs in logging | Array per call |
| Functional options | Closure allocations |
| Hidden expensive factory | Repeated DB hits |
| Parameterized branch | Branch per call |
| Method call instead of cached temp | Double work |
| Exceptions in hot loop | µs/throw |

---

## Next

- [tasks.md](tasks.md), [find-bug.md](find-bug.md), [interview.md](interview.md)
