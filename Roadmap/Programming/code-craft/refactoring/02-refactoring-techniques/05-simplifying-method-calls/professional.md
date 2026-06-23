# Simplifying Method Calls — Professional Level

> Method dispatch costs, exception performance, parameter passing conventions, and how API shape affects JIT.

---

## Table of Contents

1. [Method dispatch revisited](#method-dispatch-revisited)
2. [Exception performance](#exception-performance)
3. [Parameter Object: allocation cost](#parameter-object-allocation-cost)
4. [Builder pattern: builder allocation](#builder-pattern-builder-allocation)
5. [Factory method: cached vs. fresh](#factory-method-cached-vs-fresh)
6. [Encapsulate Downcast and JIT](#encapsulate-downcast-and-jit)
7. [Varargs and array allocation](#varargs-and-array-allocation)
8. [Go: receiver shape and copy cost](#go-receiver-shape-and-copy-cost)
9. [Python: keyword arguments and dict construction](#python-keyword-arguments-and-dict-construction)
10. [Review questions](#review-questions)

---

## Method dispatch revisited

A quick tour, applied to this category:

| Refactoring | Dispatch impact |
|---|---|
| Rename Method | Zero. Bytecode identifier changes; runtime same. |
| Add Parameter | Zero impact on dispatch; small impact on inlining (more bytes). |
| Hide Method (private) | Slightly faster — `invokespecial` instead of `invokevirtual`, no override possible. |
| Replace Constructor with Factory Method | Trades `new` + `<init>` for `invokestatic` — comparable cost. |
| Encapsulate Downcast | Pushes a `checkcast` opcode from N callers to 1 method body — tiny win in code size. |

For 99% of refactorings here, dispatch cost is invisible. The exceptions (parameter object allocation, Builder pattern) are about *allocation*, not dispatch.

---

## Exception performance

Exceptions in Java cost:

- **Stack trace capture** — the slow part. ~5-50µs per exception.
- **Throw + unwind** — fast (similar to a return).
- **Catch** — almost free.

So: throwing exceptions in a hot loop where they're caught is *very* slow.

### Workarounds

```java
// Pre-allocated exception (no stack trace re-capture):
private static final ParseException PRE = new ParseException();
static { PRE.setStackTrace(new StackTraceElement[0]); }

if (...) throw PRE;
```

Or:

```java
public static class FastException extends RuntimeException {
    @Override
    public Throwable fillInStackTrace() { return this; }   // no stack trace
}
```

Used by parser libraries (ANTLR, fastjson) for known parse errors. **Don't do this for unexpected exceptions** — you lose debuggability.

### Modern approach: don't throw in hot loops

If errors are expected, use `Optional<T>`, `Result<T, E>`, or `boolean tryParse(String s, Out<T> result)`. Saves the throw cost entirely.

> Replace Exception with Test is sometimes a 100× perf win for hot paths.

---

## Parameter Object: allocation cost

```java
record DateRange(Date start, Date end) {}
public boolean overlaps(DateRange a, DateRange b) { ... }
```

Each call allocates two `DateRange` objects (if constructed at the call site).

For 10K req/s with 5 such calls per request: 50K small allocations/sec. JFR shows the cost; usually irrelevant.

### Escape analysis to the rescue

If the DateRange doesn't escape the call (the callee doesn't store it), HotSpot's EA + scalar replacement eliminates the allocation. Verify:

```bash
java -XX:+UnlockDiagnosticVMOptions -XX:+PrintEliminateAllocations
```

### When EA fails

- Parameter Object is stored, returned, or captured by a lambda.
- Method body is too large to inline (EA can't see lifecycle).

### Fix

Hot path: keep primitives, pay the verbose signature. Or wait for Project Valhalla.

---

## Builder pattern: builder allocation

A typical builder allocates:
- The Builder object itself.
- A `String[]` or `List<>` for headers / collections.
- Possibly intermediate objects for fluent calls.

```java
HttpRequest.builder()
    .url("...")
    .header("Auth", "Bearer ...")
    .build();
```

For one-time configuration (per-application setup): no concern.

For per-request hot paths: profile.

### Mitigations

- **ThreadLocal builder pool.** Reuse builders across requests.
- **Skip the builder.** Provide a one-shot factory: `HttpRequest.of(url, headers, body, options)`.
- **Compile-time builders.** Lombok `@Builder` with `toBuilder = false` reduces overhead.

For most cases: don't worry.

---

## Factory method: cached vs. fresh

```java
class Currency {
    private static final Map<String, Currency> CACHE = ...;
    public static Currency of(String code) {
        return CACHE.computeIfAbsent(code, Currency::new);
    }
}
```

Caching factory: zero allocation for repeated lookups.

```java
class Order {
    public static Order draft(Customer c) { return new Order(c, DRAFT); }
}
```

Fresh-each-call factory: same allocation as `new`.

### When caching helps

- Small set of distinct values (currencies, statuses).
- Immutable instances.
- Lookup is read-mostly.

### When caching hurts

- Cached instances pile up over time (memory leak).
- Identity-based comparisons break elsewhere (`==` not `equals`).
- Cache itself becomes a contention bottleneck (synchronized map).

> See [Java's Integer cache](https://docs.oracle.com/javase/specs/jls/se17/html/jls-5.html#jls-5.1.7) for an example of how caching factory methods can subtly affect identity semantics.

---

## Encapsulate Downcast and JIT

```java
public Reading lastReading() { return (Reading) readings.last(); }
```

Inside the method: one `checkcast` opcode. After JIT, often eliminated entirely (the JIT proves the cast is always valid).

Original (in N callers):
```java
Reading r = (Reading) station.lastReading();   // cast at every call site
```

After Encapsulate Downcast: 1 cast (eliminated by JIT) instead of N (each potentially eliminated separately).

### Net

Tiny code-size win. JIT effectively eliminates downcasts in steady state; main benefit is **maintenance**, not perf.

---

## Varargs and array allocation

Java varargs:
```java
public void log(String msg, Object... args) { ... }

log("hello {}", name);   // allocates new Object[] { name }
```

Each call allocates an array of arguments.

### Cost

For a hot logger called millions of times: GC pressure.

### Mitigations

- **Provide non-varargs overloads:**
  ```java
  public void log(String msg, Object a1) {}
  public void log(String msg, Object a1, Object a2) {}
  public void log(String msg, Object a1, Object a2, Object a3) {}
  public void log(String msg, Object... args) {}
  ```
  SLF4J does this for the common 1-3 argument cases.
- **Defer formatting:** `log.info("hello {}", name);` doesn't format unless info is enabled.
- **Conditional:**
  ```java
  if (log.isDebugEnabled()) log.debug("expensive {}", computeExpensive());
  ```

### Modern approach

Java's `String.format` and `MessageFormat` allocate too. Use SLF4J / log4j parameterized logging — handles the lazy evaluation.

---

## Go: receiver shape and copy cost

Go method on a struct:

```go
func (o Order) Total() Money { ... }     // value receiver: copies Order
func (o *Order) Total() Money { ... }    // pointer receiver: passes pointer
```

For a 100-byte Order struct, value receiver = 100-byte memcpy per call.

### Default

Use pointer receivers for any non-trivial struct. Use value receivers only for very small immutable types (e.g., `time.Time`, custom enum types).

### Implication for refactoring

When applying Replace Constructor with Factory Method or Hide Method, the receiver style is part of the signature. Switching from value to pointer receiver changes the dispatch cost.

---

## Python: keyword arguments and dict construction

Python keyword arguments cost more than positional:

```python
def f(x, y, z): ...

f(1, 2, 3)          # fast path
f(x=1, y=2, z=3)    # builds a dict for kwargs
```

### When this matters

- 1M calls/sec in tight loops.
- Heavy use of `**kwargs` forwarding.

### Mitigations

- Use positional in hot paths.
- Use `__slots__` on classes to reduce attribute access cost.
- Profile with `cProfile` to find hot calls.

### Modern Python

Python 3.11+ optimized many of these. PyPy is much faster. Cython compiles to C with no kwargs overhead.

---

## Review questions

1. What's the dispatch cost difference between `private` and `public` methods?
2. Why is throwing an exception per call slow?
3. How can you skip stack trace capture?
4. How does escape analysis save Parameter Object's allocation?
5. When does Builder pattern allocation matter?
6. What's the benefit of a caching factory method?
7. What's the JIT effect on Encapsulate Downcast?
8. Why are varargs sometimes slow?
9. How do Go value vs. pointer receivers affect cost?
10. When are Python keyword arguments slower than positional?
