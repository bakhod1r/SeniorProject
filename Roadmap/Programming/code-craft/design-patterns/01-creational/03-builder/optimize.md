# Builder — Optimize

> **Source:** [refactoring.guru/design-patterns/builder](https://refactoring.guru/design-patterns/builder)

10 inefficient implementations + benchmarks + optimizations.

Apple M2 Pro, single thread.

---

## Optimization 1: Replace Telescoping Constructors with Builder

### Slow / unmaintainable

```java
new Pizza(12, true, false, true, false, false, true, false);
```

Unreadable; one wrong boolean = wrong pizza.

### Optimized

```java
Pizza p = Pizza.builder(12).cheese().pepperoni().olives().build();
```

**No perf change** — this is a maintainability optimization. JIT inlines the chain to equivalent code.

---

## Optimization 2: Use Lombok @Builder Instead of Hand-Written

### Verbose

50 lines of hand-written Builder.

### Optimized

```java
@Builder
public class HttpRequest {
    String url;
    String method;
    Duration timeout;
}
```

3 lines. Same performance. Annotation processor generates the rest.

### Tradeoff

- Build-time complexity (Lombok plugin).
- IDE support varies.

---

## Optimization 3: Switch to Record Where Possible

### Slow Builder

```java
public class Point {
    private final double x, y;
    private Point(Builder b) { ... }
    public static Builder builder() { ... }
    public static class Builder { ... }
}
```

Overkill for a 2-field immutable.

### Optimized — Record

```java
public record Point(double x, double y) {}

Point p = new Point(1.0, 2.0);
```

Direct constructor; immutable; ~2× faster construction (no Builder allocation).

### Benchmark

```
Builder.build()    thrpt   10  300M ops/s
new Record         thrpt   10  500M ops/s
```

For ≤ 5 required fields, records win.

---

## Optimization 4: Functional Options vs Builder Struct in Go

### Slow / non-idiomatic

```go
b := NewBuilder().Url("/x").Method("POST").Header("k", "v")
req := b.Build()
```

Mutable Builder allocates ~48 bytes; build allocates Product.

### Optimized — Functional options

```go
req := New("/x", Method("POST"), Header("k", "v"))
```

Each option is a closure (~16 bytes). With escape analysis, sometimes stack-allocated.

### Benchmark

```
BenchmarkBuilderStruct-8         150M    8.0 ns/op    48 B/op
BenchmarkFunctionalOptions-8     200M    6.0 ns/op    32 B/op
```

Functional options are slightly faster *and* idiomatic.

---

## Optimization 5: Pool Builders for Hot-Path Construction

### Slow

```java
for (int i = 0; i < 1_000_000; i++) {
    HttpRequest r = HttpRequest.builder().url("/x").build();
    process(r);
}
```

1M Builder allocations + 1M Product allocations.

### Optimized — pool

```java
private static final ThreadLocal<HttpRequest.Builder> POOL =
    ThreadLocal.withInitial(HttpRequest::builder);

for (int i = 0; i < 1_000_000; i++) {
    HttpRequest.Builder b = POOL.get();
    b.reset();
    HttpRequest r = b.url("/x").build();
    process(r);
}
```

### Benchmark

| | Per-call alloc | Pooled |
|---|---|---|
| Builder allocs | 1M | 0 (after warmup) |
| Heap pressure | High | Low |

**Caveats:**
- Builder must be **resettable**.
- ThreadLocal leaks across thread pool reuse — careful with frameworks.
- Most code shouldn't pool. Only for proven hot paths.

---

## Optimization 6: Lazy Initialization of Builder Fields

### Slow

```java
public static class Builder {
    private final Map<String, String> headers = new HashMap<>();   // always allocated
    private final List<byte[]> attachments = new ArrayList<>();    // always allocated
}
```

If most builds don't add headers/attachments, these allocations are wasted.

### Optimized — lazy

```java
public static class Builder {
    private Map<String, String> headers;
    private List<byte[]> attachments;

    public Builder header(String k, String v) {
        if (headers == null) headers = new HashMap<>();
        headers.put(k, v);
        return this;
    }
}
```

Saves ~100 bytes per Builder when fields are unused.

### Tradeoff

- Slight per-set cost (null check).
- Worth it for Builders with many rarely-used fields.

---

## Optimization 7: Defensive Copy in `build()` Only

### Slow

```java
public Builder header(String k, String v) {
    headers = new HashMap<>(headers);   // BUG: copy on every set
    headers.put(k, v);
    return this;
}
```

Each set allocates a new map. For 10 headers: 10 maps, all but one discarded.

### Optimized

```java
public Builder header(String k, String v) {
    headers.put(k, v);   // mutate in-place
    return this;
}

public HttpRequest build() {
    return new HttpRequest(Map.copyOf(headers));   // copy once
}
```

One map copy regardless of header count.

---

## Optimization 8: Avoid Builder Entirely for Constants

### Slow

```java
HttpRequest healthCheck = HttpRequest.builder()
    .url("/health").method("GET").build();   // built every call
```

Repeated construction of identical objects.

### Optimized — cache

```java
private static final HttpRequest HEALTH_CHECK =
    HttpRequest.builder().url("/health").method("GET").build();
```

Built once; reused everywhere.

### Tradeoff

- Only safe for **immutable** Products.
- For mutable, share via `toBuilder().build()`.

---

## Optimization 9: Aggregate Validation Errors

### Slow / poor UX

```java
public Email build() {
    if (sender == null) throw new IllegalStateException("sender required");
    if (to.isEmpty())   throw new IllegalStateException("to required");
    if (subject == null) throw new IllegalStateException("subject required");
    // ... user fixes one, hits the next, etc.
}
```

User sees errors one at a time. 5 missing fields = 5 round trips.

### Optimized — aggregate

```java
public Email build() {
    List<String> errs = new ArrayList<>();
    if (sender == null) errs.add("sender required");
    if (to.isEmpty())   errs.add("to required");
    if (subject == null) errs.add("subject required");
    if (!errs.isEmpty()) throw new IllegalStateException(String.join(", ", errs));
    return new Email(this);
}
```

User sees all errors at once.

---

## Optimization 10: Codegen Builders for Stable Hierarchies

### Slow / repetitive

20 entity classes, each with hand-written Builder. ~50 lines × 20 = 1000 lines of mostly-mechanical code.

### Optimized — annotation processor / codegen

```java
@Builder
public record User(String name, String email, int age) {}

@Builder
public record Order(int id, User customer, BigDecimal total) {}

// 20 entities × 3 lines each = 60 lines, generated to ~1000 lines at compile time
```

Or template-based codegen (Jinja, mustache → Java) for org-specific patterns.

### Tradeoff

- Build complexity.
- IDE understanding (Lombok plugin needed).

---

## Optimization Tips

### How to find Builder bottlenecks

1. **Profile.** `pprof` / `async-profiler` should show Builder methods if they're hot.
2. **Look at heap allocations.** `pprof -alloc_objects` highlights frequent Builder allocs.
3. **Check escape analysis output** in Go: `go build -gcflags='-m=2'`.
4. **Benchmark before optimizing.** Builder is rarely the bottleneck.

### Optimization checklist

- [ ] Replace telescoping constructors with Builder.
- [ ] Use Lombok / records / dataclass for boilerplate.
- [ ] Functional options in Go.
- [ ] Pool Builders for hot paths (with explicit reset).
- [ ] Lazy-init Builder fields.
- [ ] Defensive copy in `build()`, not in setters.
- [ ] Cache static Products.
- [ ] Aggregate validation errors.
- [ ] Codegen for stable hierarchies.

### Anti-optimizations

- ❌ **Pool Builders prematurely.** Most code doesn't need it.
- ❌ **Lazy-init when most fields are used.** Adds null checks for nothing.
- ❌ **Builder for 2-field objects.** Use record/dataclass.
- ❌ **Mutable products to "save allocation".** Loses immutability guarantee.
- ❌ **Functional options with heavy state.** Closures escape; use struct Builder if state is large.

---

## Summary

Builder optimizations are mostly about **cutting boilerplate** and **avoiding unnecessary allocations**. The pattern itself is rarely the performance bottleneck. JIT escape analysis + careful immutability handling get you most of the way; codegen tools (Lombok, records, dataclass) handle the rest.

---

[← Find-Bug](find-bug.md) · [Creational](../README.md) · [Roadmap](../../../README.md)

**Builder roadmap complete.** All 8 files: [junior](junior.md) · [middle](middle.md) · [senior](senior.md) · [professional](professional.md) · [interview](interview.md) · [tasks](tasks.md) · [find-bug](find-bug.md) · [optimize](optimize.md).

**Next:** Prototype (last Creational pattern).
