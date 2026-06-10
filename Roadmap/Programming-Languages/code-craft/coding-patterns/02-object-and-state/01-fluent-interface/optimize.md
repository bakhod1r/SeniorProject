# Fluent Interface — Optimization Drills

> **Category:** [Object & State Patterns](../README.md) — chain calls that each return the receiver, producing a readable mini-DSL.

9 inefficient implementations + optimizations. Apple M2 Pro, single thread; numbers illustrative.

---

## Optimization 1: Replace Imperative Setters with a Fluent Chain

### Before (readability cost)
```java
Report r = new Report();
r.setTitle("Daily"); r.addLine("a"); r.addLine("b");
String out = r.render();
```

### After
```java
String out = new Report().title("Daily").line("a").line("b").render();
```

**No perf change** — a maintainability optimization. JIT inlines the chain to equivalent code. The win is one self-documenting expression instead of four statements.

---

## Optimization 2: Copy in the Terminal, Not in Every Step

### Slow — copy per step
```java
public Builder header(String k, String v) {
    headers = new HashMap<>(headers);   // BUG: new map every set
    headers.put(k, v); return this;
}
```
10 headers → 10 maps, 9 discarded.

### Optimized — mutate, copy once at the terminal
```java
public Builder header(String k, String v) { headers.put(k, v); return this; }
public Request build() { return new Request(Map.copyOf(headers)); }   // one copy
```

One copy regardless of header count: O(n) instead of O(n²) allocation.

---

## Optimization 3: Mutable Chain Instead of Wither in a Hot Loop

### Slow — wither allocates per step
```java
for (int i = 0; i < 1_000_000; i++) {
    Config c = new Config().withA(1).withB(2).withC(3);  // 4 objects/iter
    use(c);
}
```

### Optimized — mutable chain (throwaway object)
```java
for (int i = 0; i < 1_000_000; i++) {
    Config c = new Config().a(1).b(2).c(3);   // 1 object, mutated in place
    use(c);
}
```

### Benchmark
```
WitherChain (3 steps)   thrpt  300M ops/s
MutableChain            thrpt  480M ops/s
```

Use the wither for *shared/templated* objects; for a built-once-discarded object in a hot loop, mutable is cheaper. (If the wither's intermediates don't escape, the JIT may close most of this gap — measure.)

---

## Optimization 4: Lazy Stream Beats Eager Intermediate Lists

### Slow — eager intermediate collections
```java
List<Integer> doubled = new ArrayList<>();
for (int x : src) doubled.add(x * 2);
List<Integer> big = new ArrayList<>();
for (int x : doubled) if (x > 100) big.add(x);   // two passes, two lists
```

### Optimized — lazy fused chain, short-circuit
```java
Optional<Integer> first = src.stream()
    .map(x -> x * 2)
    .filter(x -> x > 100)
    .findFirst();        // one fused pass, stops at first match
```

Lazy chains fuse `map`+`filter` into one traversal and short-circuit on `findFirst` — no intermediate list, often far less work.

---

## Optimization 5: Go Receiver Chain Instead of Functional Options on a Hot Path

### Slow(er) — options allocate a closure each
```go
s := New(":8080", WithTimeout(t), WithTLS(true))   // 2 escaping closures/construction
```

### Optimized — receiver chain (no closures) for hot construction
```go
s := New(":8080").Timeout(t).TLS(true)   // returns the pointer in hand; no closures
```

### Benchmark
```
BenchmarkFunctionalOptions-8  120M  11 ns/op  32 B/op
BenchmarkReceiverChain-8      200M   7 ns/op  16 B/op
```

Options win on *composability* and are idiomatic; the receiver chain wins on raw cost when you construct in a tight loop. Choose by context, not dogma.

---

## Optimization 6: Cache Constant Fluent Results

### Slow — rebuild an identical object every call
```java
HttpRequest healthCheck() {
    return HttpRequest.builder().url("/health").method("GET").build();  // built each call
}
```

### Optimized — build once
```java
private static final HttpRequest HEALTH_CHECK =
    HttpRequest.builder().url("/health").method("GET").build();
```

Only safe for **immutable** products. For mutable ones, derive copies via a wither/`toBuilder`.

---

## Optimization 7: Lazy-Initialize Rarely-Used Chain Fields

### Slow — always allocate optional collections
```java
public static final class Builder {
    private final Map<String, String> headers = new HashMap<>();   // always
    private final List<byte[]> attachments = new ArrayList<>();    // always
}
```
If most chains never touch headers/attachments, those allocations are wasted.

### Optimized — allocate on first use
```java
private Map<String, String> headers;
public Builder header(String k, String v) {
    if (headers == null) headers = new HashMap<>();
    headers.put(k, v); return this;
}
```

Saves ~100 bytes per builder when fields go unused. Skip this if most chains *do* use the field — the null checks then cost more than they save.

---

## Optimization 8: Aggregate Validation Errors at the Terminal

### Slow / poor UX — fail on the first
```java
public Email build() {
    if (from == null)    throw new IllegalStateException("from required");
    if (to == null)      throw new IllegalStateException("to required");
    if (subject == null) throw new IllegalStateException("subject required");
    // user fixes one, hits the next...
}
```

### Optimized — collect, report all at once
```java
public Email build() {
    List<String> errs = new ArrayList<>();
    if (from == null)    errs.add("from required");
    if (to == null)      errs.add("to required");
    if (subject == null) errs.add("subject required");
    if (!errs.isEmpty()) throw new IllegalStateException(String.join(", ", errs));
    return new Email(this);
}
```

The caller sees every problem in one shot — fewer fix-rebuild round trips.

---

## Optimization 9: Persistent Structures for Wither Chains Over Large Collections

### Slow — O(n) full copy per wither step
```java
public Config withHeader(String k, String v) {
    Map<String, String> m = new HashMap<>(this.headers);  // O(n) copy each step
    m.put(k, v);
    return new Config(m);
}
```
Adding 100 headers → O(n²) total copying.

### Optimized — structural sharing (Scala/Clojure/Vavr)
```scala
case class Config(headers: Map[String, String] = Map.empty) {
  def withHeader(k: String, v: String): Config = copy(headers = headers + (k -> v))
}
```
`headers + (k -> v)` shares nodes with the prior HAMT: **O(log n)** per add, O(n log n) total. Use Vavr / Eclipse Collections in Java when wither chains touch large maps; for small config maps the plain copy is fine.

---

## Optimization Tips

### How to find fluent-chain bottlenecks
1. **Allocation profiling** — `pprof -alloc_objects`, async-profiler alloc mode — flags wither/stream allocations.
2. **Escape analysis** in Go — `go build -gcflags='-m=2'` shows which option closures escape.
3. **JIT inlining** in Java — `-XX:+PrintInlining` confirms mutable chains collapse to direct construction.
4. **Benchmark first** — the chain is rarely the bottleneck; intermediate *data* allocation usually is.

### Optimization checklist
- [ ] Copy mutable inputs once in the terminal, not per step.
- [ ] Mutable chain for built-once objects; wither for shared templates.
- [ ] Lazy (fused, short-circuiting) over eager intermediate collections.
- [ ] Receiver chain over options on Go hot paths; options for composability.
- [ ] Cache constant immutable products.
- [ ] Lazy-init rarely-used chain fields.
- [ ] Aggregate validation errors at the terminal.
- [ ] Persistent structures for wither chains over large collections.

### Anti-optimizations
- ❌ **Wither everywhere "for safety"** — pure allocation cost when the object is a throwaway.
- ❌ **Lazy-init fields most chains use** — null checks for nothing.
- ❌ **Forcing a Java-style chain into Go** instead of functional options.
- ❌ **Caching mutable products** — shared mutation bugs.
- ❌ **Eager intermediate lists** where a lazy chain would fuse and short-circuit.

---

## Summary

Fluent-interface optimization is mostly about **where allocation happens**: copy once at the terminal, prefer mutable chains for throwaway objects and withers for shared templates, and choose lazy fused chains over eager intermediate collections. The chaining mechanism itself is nearly free post-JIT — the cost lives in the data the chain moves around.

---

[← Find-Bug](find-bug.md) · [Object & State](../README.md) · [Coding Patterns](../../README.md)

**Fluent Interface roadmap complete.** All 8 files: [junior](junior.md) · [middle](middle.md) · [senior](senior.md) · [professional](professional.md) · [interview](interview.md) · [tasks](tasks.md) · [find-bug](find-bug.md) · [optimize](optimize.md).
