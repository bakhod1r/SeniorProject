# Lazy Initialization — Optimization Drills

> **Category:** [Object & State Patterns](../README.md) — defer creating an expensive value until first use, then cache it.

10 inefficient implementations + benchmarks + optimizations.

Apple M2 Pro (ARM), single thread, post-warmup. Illustrative — measure your own.

---

## Optimization 1: Replace Eager Construction with Lazy

### Slow

```java
class Report {
    private final byte[] thumb = render(); // every Report pays 200 ms
}
```

### Optimized

```java
class Report {
    private byte[] thumb;
    byte[] thumb() { if (thumb == null) thumb = render(); return thumb; }
}
```

**Effect:** construction drops from 200 ms to ~0; the 200 ms is paid only by reports someone views. If 90% are never viewed, you save 90% of the rendering work.

---

## Optimization 2: Replace `synchronized` Getter with the Holder Idiom

### Slow

```java
public static synchronized Registry getInstance() {   // locks EVERY call
    if (instance == null) instance = new Registry();
    return instance;
}
```

Locking on every access, forever, for a one-time init.

### Optimized

```java
private static final class Holder { static final Registry I = new Registry(); }
public static Registry getInstance() { return Holder.I; }
```

### Benchmark

```
SynchronizedGetter   avgt   15.0 ns/op
HolderIdiom          avgt    0.4 ns/op   (~35× faster steady state)
```

The holder idiom is lazy, thread-safe, and the read compiles to a plain static load.

---

## Optimization 3: volatile DCL Instead of Locking Per Access

### Slow

```java
public synchronized Heavy heavy() {        // lock on every read
    if (heavy == null) heavy = new Heavy();
    return heavy;
}
```

### Optimized

```java
private volatile Heavy heavy;
public Heavy heavy() {
    Heavy local = heavy;
    if (local == null) {
        synchronized (this) {
            local = heavy;
            if (local == null) heavy = local = new Heavy();
        }
    }
    return local;
}
```

### Benchmark

```
SynchronizedEveryCall   15.0 ns/op
VolatileDCL              1.1 ns/op   (x86 even cheaper; ARM pays LDAR)
```

Read the volatile into a local once — avoids a second volatile load on the fast path.

---

## Optimization 4: sync.Once vs Mutex-Every-Call (Go)

### Slow

```go
func (s *Service) Conn() *Conn {
    s.mu.Lock(); defer s.mu.Unlock()   // lock every call
    if s.conn == nil { s.conn = dial() }
    return s.conn
}
```

### Optimized

```go
func (s *Service) Conn() *Conn {
    s.once.Do(func() { s.conn = dial() }) // atomic-load fast path after init
    return s.conn
}
```

### Benchmark

```
BenchmarkMutexEveryCall-8   18.0 ns/op
BenchmarkSyncOnce-8          1.8 ns/op   (~10× faster steady state)
```

`sync.Once` reaches a lock-free fast path (single atomic load of its `done` flag).

---

## Optimization 5: cached_property vs @property + Flag (Python)

### Slow

```python
@property
def total(self):                       # method call + branch on EVERY access
    if self._total is None:
        self._total = sum(self.rows)
    return self._total
```

### Optimized

```python
@functools.cached_property
def total(self):
    return sum(self.rows)              # descriptor shadowed after 1st access
```

### Benchmark

```
@property + flag        ~80 ns/access
cached_property         ~35 ns/access   (plain dict lookup after first)
```

After the first hit, `cached_property` is a dict lookup; `@property` pays a method call forever.

---

## Optimization 6: Warm the Lazy Value at Startup to Kill the Spike

### Problem

A lazy connection pool makes the **first request** after deploy eat a 600 ms dial — blowing p99.

### Optimized — warm in the background

```go
func main() {
    svc := NewService(addr)
    go svc.Conn()  // warm asynchronously; first real request finds it ready
    serve(svc)
}
```

```java
// Java: touch critical lazies post-boot on a background thread
Executors.newSingleThreadExecutor().submit(() -> service.heavy());
```

**Effect:** you keep laziness's "don't build the unused" while moving the spike off the request path. Lazy *total work*, eager *latency profile*.

---

## Optimization 7: Don't Lazy-Init Cheap Values

### Slow (over-engineered)

```java
private volatile Integer hash;
public int hashCode() {
    Integer h = hash;
    if (h == null) { h = compute(); hash = h; }  // guard + volatile cost > the work
    return h;
}
```

For a cheap `compute()`, the volatile read + branch + boxing costs *more* than recomputing.

### Optimized — just compute, or eager-cache a primitive

```java
private final int hash = compute();   // eager, if always used
// or, for the String-style trick, a non-volatile int with the 0-means-uncomputed idiom
```

### Lesson

Lazy init has overhead (branch, barrier, mutable state). Below a cost threshold, eager or plain recompute wins.

---

## Optimization 8: Fix N+1 by Eager-Fetching the Known Path

### Slow

```python
orders = Order.objects.all()
total = sum(o.items.count() for o in orders)   # 1 + N queries
```

### Optimized

```python
orders = Order.objects.prefetch_related("items")
total = sum(o.items.count() for o in orders)   # 2 queries
```

### Benchmark (500 orders)

```
lazy per-row:   501 queries, ~1800 ms
prefetch:         2 queries,    ~90 ms
```

Lazy is the right default; eager-fetch once you *know* you'll iterate the relation.

---

## Optimization 9: Soft-Reference Lazy Cache for Reclaimable Values

### Problem

A large lazily-built index is held forever, even under memory pressure.

### Optimized — recomputable via SoftReference

```java
private SoftReference<Index> ref = new SoftReference<>(null);
public synchronized Index index() {
    Index i = ref.get();
    if (i == null) { i = build(); ref = new SoftReference<>(i); }
    return i;
}
```

**Effect:** the GC may reclaim the index under pressure; the next access rebuilds it. This is lazy init blended with [memoization eviction](../03-memoization-and-caching/optimize.md).

### Tradeoff

`SoftReference` survives until near-OOM, which can *raise* GC pressure. Profile before adopting; a size-bounded cache is often better.

---

## Optimization 10: Avoid Re-Lazy-Initializing Per Instance — Share a Singleton

### Slow

```java
class Validator {
    private Pattern p;
    Pattern pattern() { if (p == null) p = Pattern.compile(REGEX); return p; }
}
// thousands of Validators each compile their own copy of the SAME regex
```

### Optimized — hoist to a shared, lazily-built constant

```java
class Validator {
    private static final class Holder { static final Pattern P = Pattern.compile(REGEX); }
    Pattern pattern() { return Holder.P; }  // compiled once for ALL instances
}
```

### Lesson

If the lazily-built value is identical across instances, lazy-init it **once at class level** (holder idiom), not once per instance.

---

## Optimization Tips

### How to find lazy-init problems

1. **Profile the first-access spike.** Trace spans around suspected lazy accessors reveal hidden I/O.
2. **Count queries in tests** to catch ORM N+1.
3. **Check the steady-state read cost.** A `synchronized` getter or `lru_cache` on a hot path shows up in CPU profiles.
4. **Run `go test -race`** / stress concurrent first-access to expose unsafe publication.

### Optimization checklist

- [ ] Defer genuinely expensive, often-unused values; keep cheap/always-used ones eager.
- [ ] Use the holder idiom for static lazy singletons (lock-free reads).
- [ ] Use `volatile` DCL or `AtomicReference` for per-instance lazy fields.
- [ ] Use `sync.Once`/`OnceValue` in Go, `cached_property`/lock in Python.
- [ ] Warm critical lazies at startup to move the spike off the request path.
- [ ] Eager-fetch known ORM iteration paths to kill N+1.
- [ ] Hoist instance-identical lazy values to a shared class-level constant.

### Anti-optimizations

- ❌ **`synchronized`/mutex on every access** — locks forever for a one-time init.
- ❌ **Lazy-init a cheap value** — the guard costs more than the work.
- ❌ **DCL without `volatile`** — fast but broken (unsafe publication).
- ❌ **`sync.Once` for transient-failure init** — caches the error permanently.
- ❌ **SoftReference everywhere** — survives until near-OOM, worsening GC pressure.

---

## Summary

Lazy-init optimization is about **paying for what you use** without making the access path slow or unsafe. The wins: skip construction for unused values, keep the steady-state read lock-free (holder idiom, `sync.Once`, `cached_property`), warm critical values at startup to hide the spike, and eager-fetch ORM paths to avoid N+1. The pattern itself is rarely the bottleneck — the *thread-safety mechanism* and *hidden I/O* are where the real costs hide.

---

[← Find-Bug](find-bug.md) · [Object & State](../README.md)

**Lazy Initialization roadmap complete.** All 8 files: [junior](junior.md) · [middle](middle.md) · [senior](senior.md) · [professional](professional.md) · [interview](interview.md) · [tasks](tasks.md) · [find-bug](find-bug.md) · [optimize](optimize.md).

**Next:** [Memoization & Caching](../03-memoization-and-caching/junior.md) — the keyed generalization of lazy init.
