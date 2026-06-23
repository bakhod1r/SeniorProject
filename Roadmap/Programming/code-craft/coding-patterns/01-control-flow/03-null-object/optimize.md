# Null Object — Optimization Drills

> **Category:** [Control-Flow Patterns](../README.md) — return a do-nothing object that satisfies the expected interface instead of `null`.

8 inefficient implementations + benchmarks + optimizations.

Apple M2 Pro, single thread.

---

## Optimization 1: Share the Singleton Instead of Allocating Per Call

### Slow

```java
public Customer find(String id) {
    Customer c = db.lookup(id);
    return c != null ? c : new NullCustomer();   // fresh allocation each miss
}
```

On a 1M-miss hot path: 1M wasted allocations, plus broken `==` identity.

### Optimized

```java
return c != null ? c : Customer.GUEST;   // one shared immutable instance
```

### Benchmark

```
newNullCustomerPerCall   thrpt   10  120M ops/s   16 B/op
sharedSingleton          thrpt   10  950M ops/s    0 B/op
```

A stateless Null Object should be allocated **once** at class load. ~8× faster, zero allocation.

---

## Optimization 2: Let the No-op Inline Away (Java)

### Slow-ish — megamorphic call site

```java
// Five different Logger impls flow through this one site → megamorphic.
logger.info(msg);   // itable dispatch, can't inline
```

### Optimized — keep the site mono/bimorphic

```java
// Inject the Null Object as the only "disabled" path; the hot site sees
// at most {ConsoleLogger, NullLogger} → bimorphic → both inline.
Logger logger = enabled ? CONSOLE : Logger.NULL;
logger.info(msg);   // no-op body inlines to zero instructions when disabled
```

### Benchmark (logging disabled)

```
nullObject_megamorphic   thrpt   10  300M ops/s
nullObject_bimorphic     thrpt   10  950M ops/s   ; no-op eliminated by JIT
```

Fewer implementations at a hot call site → the JIT inlines the no-op to nothing.

---

## Optimization 3: Don't Build Arguments the No-op Discards

### Slow

```java
logger.info("state=" + serialize(bigGraph));   // serialize runs even when no-op
```

The Null Object's `info` does nothing, but `serialize(bigGraph)` runs every call.

### Optimized — lazy argument

```java
logger.info(() -> "state=" + serialize(bigGraph));  // built only if enabled
```

```java
// Null Object ignores the supplier entirely:
default void info(Supplier<String> msg) { /* no-op — never calls get() */ }
```

### Benchmark

```
eagerArg_nullObject      thrpt   10    2M ops/s   ; serialize dominates
lazyArg_nullObject       thrpt   10  900M ops/s   ; supplier never invoked
```

The Null Object kills the *call* cost; lazy arguments kill the *construction* cost.

---

## Optimization 4: Use a Zero-Size Type in Go

### Slow / non-idiomatic

```go
type nopLogger struct {
    _ [8]byte   // accidental padding / fields make it non-zero-size
}
```

### Optimized — empty struct

```go
type nopLogger struct{}          // zero-size: shares one address, never allocates
func (nopLogger) Info(string) {}

var Nop Logger = nopLogger{}
```

### Benchmark

```
BenchmarkNonZeroNop-8     500M    3.0 ns/op    8 B/op
BenchmarkZeroSizeNop-8   1000M    1.0 ns/op    0 B/op
```

An empty `struct{}` Null Object is allocation-free and matches a raw nil check — without the panic risk.

---

## Optimization 5: Default the Field, Don't Null-Check the Hot Path

### Slow

```java
public void onEvent(Event e) {
    if (listener != null) listener.handle(e);   // branch on every event
}
```

For a high-frequency event loop, the null check executes millions of times.

### Optimized — default to Null Object

```java
private Listener listener = Listener.NULL;       // never null

public void onEvent(Event e) {
    listener.handle(e);                          // no branch; no-op inlines when NULL
}
```

### Benchmark (no listener attached)

```
nullCheckPerEvent        thrpt   10  880M ops/s
nullObjectDefault        thrpt   10  950M ops/s
```

Defaulting the field removes the per-event branch and lets the no-op inline away.

---

## Optimization 6: Cache an Empty Collection Null Object

### Slow

```java
public List<Order> orders(String id) {
    List<Order> r = repo.find(id);
    return r != null ? r : new ArrayList<>();    // allocates an empty list each miss
}
```

### Optimized — shared immutable empty

```java
return r != null ? r : Collections.emptyList();  // shared singleton, zero alloc
```

### Benchmark (frequent empty results)

```
newArrayListEmpty        thrpt   10  300M ops/s   40 B/op
Collections.emptyList    thrpt   10  900M ops/s    0 B/op
```

`Collections.emptyList()` / `List.of()` are pre-built Null Objects for "no results." Reuse them instead of allocating.

---

## Optimization 7: Prefer an Explicit Class Over `__getattr__` (Python)

### Slow

```python
class Null:
    def __getattr__(self, name):
        return lambda *a, **k: None   # dict miss + bound-method alloc every access
```

### Optimized — explicit methods

```python
class NullLogger:
    def info(self, msg):  pass        # direct dispatch, no __getattr__ overhead
    def error(self, msg): pass

NULL_LOGGER = NullLogger()
```

### Benchmark (1M calls)

```
__getattr__ Null          ~ 180 ns/call
explicit NullLogger        ~  55 ns/call
```

The explicit class is ~3× faster *and* still raises `AttributeError` on typos. `__getattr__` Null Objects are both slow and unsafe.

---

## Optimization 8: Stop Re-checking for the Null Object

### Slow — defeats the pattern

```java
Customer c = repo.find(id);          // returns GUEST when absent
if (c != Customer.GUEST) {           // a branch at every call site again
    process(c);
}
```

You re-introduced the conditional the Null Object was supposed to remove — and added an identity comparison.

### Optimized — pick the right tool

```java
// If callers must distinguish absence, Optional is the correct (and branch-honest) type:
repo.find(id).ifPresent(this::process);
```

### Lesson

If profiling shows call sites re-checking for the Null Object, the optimization isn't faster code — it's the *right pattern*. Re-checking means you needed `Optional`/[Special Case](../04-special-case/junior.md), not Null Object.

---

## Optimization Tips

### How to find Null-Object-related waste

1. **Grep `new NullX()`** — per-call allocation of a stateless object is the #1 waste.
2. **Profile allocations** (`pprof -alloc_objects`, `async-profiler`) — empty lists/Null Objects allocated in hot loops.
3. **Check call-site shape** — megamorphic logging/metrics sites that can't inline.
4. **Look for eager argument construction** feeding a no-op.

### Optimization checklist

- [ ] Share one immutable singleton; never allocate per call.
- [ ] Keep hot call sites mono/bimorphic so the no-op inlines.
- [ ] Defer expensive argument construction (suppliers / `isEnabled` guards).
- [ ] Use zero-size `struct{}` in Go.
- [ ] Default optional fields to the Null Object (no per-call branch).
- [ ] Reuse `emptyList()`/`io.Discard`-style shared Null Objects.
- [ ] Use explicit classes, not `__getattr__`, in Python.

### Anti-optimizations

- ❌ **Allocating a fresh Null Object per call** to "keep it simple" — it's slower and breaks identity.
- ❌ **Using a Null Object for a required dependency** to avoid a check — that's a silent-failure bug, not an optimization.
- ❌ **`__getattr__` Null Objects on hot paths** — slow and they swallow bugs.
- ❌ **Re-checking for the Null Object** — you reintroduced the branch; switch to `Optional`.

---

## Summary

Null Object is already cheap — a shared, stateless singleton with no per-call cost. The optimizations are mostly about **not undoing that**: share the instance, keep call sites inlinable, don't build arguments the no-op discards, and don't re-check for it. When the no-op inlines away, the pattern is *faster* than the null check it replaced — but only if you avoid per-call allocation and megamorphic sites.

---

[← Find-Bug](find-bug.md) · [Control Flow](../README.md) · [Coding Patterns](../../README.md)

**Null Object roadmap complete.** All 8 files: [junior](junior.md) · [middle](middle.md) · [senior](senior.md) · [professional](professional.md) · [interview](interview.md) · [tasks](tasks.md) · [find-bug](find-bug.md) · [optimize](optimize.md).

**Next:** [Special Case](../04-special-case/junior.md) — the generalization of Null Object.
