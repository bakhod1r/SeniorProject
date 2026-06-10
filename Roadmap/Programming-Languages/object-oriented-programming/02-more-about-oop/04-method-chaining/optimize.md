# Method Chaining — Optimization

Twelve before/after exercises focused on chain performance, allocation reduction, and JIT-friendliness.

---

## Optimization 1 — Use `final` on builder

**Before:**
```java
public class HttpRequestBuilder { ... }
```

**After:**
```java
public final class HttpRequestBuilder { ... }
```

**Why:** the JIT can fully devirtualize and inline setters when the type is `final`. Builders are rarely subclassed.

---

## Optimization 2 — Cache non-capturing lambdas

**Before:**
```java
list.stream().filter(s -> !s.isEmpty()).toList();
```

(Re-allocates the lambda? Actually no — non-capturing lambdas are cached after the first use.) But:

```java
list.stream().filter(s -> s.startsWith(this.prefix)).toList();
```

This *does* capture and may allocate per call.

**After:**
```java
private static final Predicate<String> NOT_EMPTY = s -> !s.isEmpty();
list.stream().filter(NOT_EMPTY).toList();
```

For capturing lambdas in a hot loop:
```java
String p = this.prefix;
Predicate<String> pred = s -> s.startsWith(p);   // capture once
for (var x : work) x.stream().filter(pred).count();
```

---

## Optimization 3 — Use `toList()` over `Collectors.toList()`

**Before:**
```java
List<String> result = stream.collect(Collectors.toList());
```

**After:**
```java
List<String> result = stream.toList();
```

**Why:** `toList()` (Java 16+) directly collects into an unmodifiable list, skipping the Collector machinery. ~20% faster on small streams.

---

## Optimization 4 — Pre-size collections in builders

**Before:**
```java
Builder b = builder();
for (int i = 0; i < 1_000_000; i++) b.add(items.get(i));
```

**After:**
```java
Builder b = builder().withCapacity(1_000_000);
```

If the builder uses an internal `ArrayList`, sizing it upfront avoids 20+ resize allocations.

---

## Optimization 5 — Avoid intermediate collection in stream chain

**Before:**
```java
list.stream()
    .filter(p1)
    .collect(Collectors.toList())
    .stream()
    .filter(p2)
    .toList();
```

**After:**
```java
list.stream()
    .filter(p1)
    .filter(p2)
    .toList();
```

**Why:** the intermediate `.collect().stream()` materializes the full list, then iterates again. Fusing eliminates one full pass.

---

## Optimization 6 — Replace `Stream` with `for` in hot loops

**Before:**
```java
public int sumPrices(List<Item> items) {
    return items.stream().mapToInt(Item::price).sum();
}
```

**After (when called millions of times):**
```java
public int sumPrices(List<Item> items) {
    int s = 0;
    for (int i = 0, n = items.size(); i < n; i++) s += items.get(i).price();
    return s;
}
```

**Why:** stream pipelines have per-element overhead from lambda dispatch and Sink wrapping. Hand loops can vectorize and use registers efficiently. 2-10× speedup on tight numeric kernels.

---

## Optimization 7 — Use `parallelStream` only when justified

**Before:**
```java
list.parallelStream().filter(...).map(...).toList();
```

**After:**
```java
list.stream().filter(...).map(...).toList();
```

**Why:** `parallelStream` only pays off when (a) the workload per element is substantial, (b) the source is splittable (ArrayList yes, LinkedList no), (c) the order of results doesn't matter or is preserved. Otherwise overhead exceeds parallelism gain.

---

## Optimization 8 — Reuse builders for same configuration

**Before:**
```java
for (Request r : requests) {
    HttpRequest req = HttpRequest.builder(r.url())
        .timeout(Duration.ofSeconds(5))
        .header("Auth", token)
        .build();
    send(req);
}
```

**After (when many fields are fixed):**
```java
HttpRequest.Builder template = HttpRequest.builder()
    .timeout(Duration.ofSeconds(5))
    .header("Auth", token);

for (Request r : requests) {
    HttpRequest req = template.copy().url(r.url()).build();
    send(req);
}
```

**Why:** less per-iteration allocation. Note: the builder's `copy()` must not share mutable internal state.

---

## Optimization 9 — Use mutating builder over immutable copy chain

**Before:**
```java
User u = new User("alice", 30);
u = u.withName("Alice").withAge(31).withEmail("a@b");   // 3 records allocated
```

**After (when many changes happen together):**
```java
User u = new User.Builder().name("Alice").age(31).email("a@b").build();   // 1 builder + 1 record
```

**Why:** chained `withX` allocates an intermediate record per call. For 1-2 changes, fine. For many, builder is cheaper.

---

## Optimization 10 — JFR allocation profile

```bash
java -XX:StartFlightRecording=duration=60s,filename=app.jfr -jar app.jar
jfr print --events jdk.ObjectAllocationInNewTLAB app.jfr | sort | uniq -c | sort -nr | head -20
```

Look for:
- Lambda hidden classes allocated frequently
- Builder allocations in tight loops
- Stream pipeline node allocations (StatelessOp, etc.)

Fix the top hotspots first.

---

## Optimization 11 — Stream `forEachOrdered` vs `forEach` for parallel

For parallel streams, `forEachOrdered` enforces source order, which serializes the terminal step. If order doesn't matter, use `forEach` for true parallelism.

```java
parallelStream().forEach(this::process);          // unordered, parallel
parallelStream().forEachOrdered(this::process);   // ordered, partly serialized
```

---

## Optimization 12 — Avoid `Optional.of` when null is normal

**Before:**
```java
return Optional.ofNullable(map.get(key))
    .map(Value::transform)
    .orElse(default);
```

**After (in hot path):**
```java
Value v = map.get(key);
return v == null ? default : v.transform();
```

**Why:** Optional has a small allocation cost (the wrapper) and a small dispatch cost (`map`/`orElse` calls). For hot paths called millions of times, plain null checks are faster. For cold or boundary code, Optional is fine.

---

## Tools cheat sheet

| Tool                                        | Purpose                                |
|---------------------------------------------|----------------------------------------|
| `-XX:+PrintInlining`                        | Inlining decisions                     |
| `async-profiler -e alloc`                   | Allocation flame graph                 |
| `jmh`                                       | Microbenchmark stream vs loop          |
| `-XX:+UnlockDiagnosticVMOptions -XX:+PrintEliminateAllocations` | EA decisions   |
| JFR + JMC                                   | Allocation, GC, JIT events             |

---

## When chain optimization is worth it

- Profile shows allocation hotspot in stream pipeline
- Inner loops processing millions of elements
- High-throughput services where every ns matters
- Builder chains in request paths

## When it isn't

- Cold paths (initialization, config)
- Code clarity matters more than tiny speedup
- The JIT already collapses the chain (verify with `PrintInlining`)
- The chain is bounded (called once per request, etc.)

---

**Memorize this**: chains are JIT-friendly when monomorphic and lambdas are stable. The main allocation costs are intermediate Stream nodes, capturing lambdas, and builder objects — usually eliminated by EA but not always. Profile, then optimize the top hotspot.
