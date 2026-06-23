# RAII & Dispose — Optimization Drills

> **Category:** [Resource & Type-Safety Patterns](../README.md) — making deterministic cleanup correct *and* cheap, without sacrificing the guarantee.

10 inefficient implementations + benchmarks + optimizations.

Apple M2 Pro, single thread; numbers are indicative.

---

## Optimization 1: Replace Manual `try/finally` with the Language Mechanism

### Verbose / leak-prone

```java
Connection c = pool.get();
try { use(c); } finally { c.close(); }
```

Each new resource adds a nested `try/finally`; easy to skip a branch.

### Optimized

```java
try (Connection c = pool.get()) { use(c); }
```

**No perf change** — it desugars to the same `finally`. This is a *correctness and readability* optimization: the compiler can't forget a branch.

---

## Optimization 2: Kill `defer` in a Loop (correctness + speed)

### Slow & wrong

```go
for _, p := range paths {
    f, _ := os.Open(p)
    defer f.Close()              // forces heap _defer path; also holds all files
    use(f)
}
```

Holds every file open until function end *and* forces the slow heap-allocated defer (~45 ns each).

### Optimized

```go
for _, p := range paths {
    func() {
        f, _ := os.Open(p)
        defer f.Close()          // open-coded (~1 ns); closed per iteration
        use(f)
    }()
}
```

### Benchmark

```
BenchmarkLoopDefer-8        30M   ~45 ns/op   (heap path, N files open)
BenchmarkScopedDefer-8     900M    ~1 ns/op   (open-coded, 1 file open)
```

The fix is ~40× faster per defer **and** bounds open FDs to one.

---

## Optimization 3: Minimize the Hold Scope

### Slow / contended

```python
with lock:
    data = expensive_pure_computation()   # no shared state here
    shared[key] = data                    # only THIS needs the lock
```

The lock is held across a CPU-heavy computation, serializing every thread.

### Optimized

```python
data = expensive_pure_computation()       # outside the lock
with lock:
    shared[key] = data                    # tiny critical section
```

Shrinking the RAII scope to exactly the shared mutation slashes lock contention — often the biggest real-world win for lock guards.

---

## Optimization 4: Reuse Buffers Instead of Re-Acquiring per Call

### Slow

```go
func handle(w http.ResponseWriter, r *http.Request) {
    buf := make([]byte, 32*1024)          // allocated every request
    io.CopyBuffer(w, r.Body, buf)
}
```

A fresh buffer per request churns the allocator.

### Optimized — `sync.Pool` (RAII-style get/put)

```go
var bufPool = sync.Pool{New: func() any { return make([]byte, 32*1024) }}

func handle(w http.ResponseWriter, r *http.Request) {
    buf := bufPool.Get().([]byte)
    defer bufPool.Put(buf)                // "release" == return to pool
    io.CopyBuffer(w, r.Body, buf)
}
```

`defer Put` is RAII over a *reusable* resource. See [Object Pool](../../02-object-and-state/04-object-pool/junior.md).

### Benchmark

```
per-call alloc      120M   ~85 ns/op   32 KB/op
sync.Pool get/put   300M   ~30 ns/op    0 B/op (steady state)
```

---

## Optimization 5: `SuppressFinalize` to Skip the GC Finalizer Path

### Slow

```csharp
public void Dispose() { Free(handle); }   // finalizer still scheduled
~Resource() => Free(handle);
```

Even after `Dispose()`, the object carries a finalizer, so the GC must run it — finalizable objects survive **extra GC cycles**.

### Optimized

```csharp
public void Dispose() {
    Free(handle);
    GC.SuppressFinalize(this);            // skip the finalizer; collect in one cycle
}
```

The Java analogue: register a `Cleaner` but call `cleanable.clean()` in `close()` so the GC-time action is cancelled. Both cut the GC cost of finalization to zero on the common (properly-disposed) path.

---

## Optimization 6: Hand-Written Context Manager on Hot Paths

### Slow

```python
from contextlib import contextmanager
@contextmanager
def span(name):
    s = tracer.start(name)
    try: yield s
    finally: s.end()
```

`@contextmanager` adds generator setup/teardown — ~300 ns/op, painful at high span rates.

### Optimized

```python
class span:
    __slots__ = ("name", "s")
    def __init__(self, name): self.name = name
    def __enter__(self): self.s = tracer.start(self.name); return self.s
    def __exit__(self, *exc): self.s.end(); return False
```

### Benchmark

```
@contextmanager span    ~300 ns/op
class-based span        ~130 ns/op
```

~2× faster; reach for it only on proven hot paths (`__slots__` trims allocation too).

---

## Optimization 7: Avoid Re-Acquiring a Pooled Resource per Query

### Slow — block-scope RAII at the wrong granularity

```python
def get_user(id):
    with connect(dsn) as conn:            # opens a NEW connection per call
        return conn.query("SELECT ... WHERE id = ?", id)
```

Opening a TCP+TLS+auth connection per query costs milliseconds.

### Optimized — lease from a pool

```python
def get_user(pool, id):
    with lease(pool) as conn:             # borrows from pool; "close" == return
        return conn.query("SELECT ... WHERE id = ?", id)
```

### Benchmark

```
connect-per-query    ~3 ms/op    (handshake every time)
pool lease           ~50 µs/op   (reuse warm connection)
```

RAII ergonomics, pool-managed lifetime — ~60× faster. Match the RAII scope to the *lifetime*.

---

## Optimization 8: Batch Cleanup with `ExitStack` Instead of Nested `with`

### Slow / unscalable

```python
with open(p0) as f0:
    with open(p1) as f1:
        with open(p2) as f2:
            merge(f0, f1, f2)             # pyramid; can't vary count
```

### Optimized

```python
from contextlib import ExitStack
with ExitStack() as stack:
    files = [stack.enter_context(open(p)) for p in paths]
    merge(files)                          # closes all LIFO, any count
```

Same guarantee, flat code, and works for a runtime-determined number of resources — no perf cost, big maintainability win.

---

## Optimization 9: Don't Defer in the Hottest Inner Loop (when scope is trivial)

### Slow path-sensitive

```go
func sumFiles(paths []string) int64 {
    var total int64
    for _, p := range paths {
        b, _ := os.ReadFile(p)            // ReadFile opens+reads+closes internally
        total += int64(len(b))
    }
    return total
}
```

Here there's nothing to optimize away — `os.ReadFile` already does RAII internally and closes promptly. The anti-optimization is wrapping it in a manual open/`defer` per file, which adds a defer and an extra scope for no benefit.

### Lesson

Prefer the stdlib helper that already bounds the resource (`os.ReadFile`, `os.WriteFile`) over hand-rolled open/`defer` when you don't need streaming.

---

## Optimization 10: Make the Finalizer Backstop Detect, Not Hide, Leaks

### Silent

```java
private static final class State implements Runnable {
    final long handle;
    State(long h) { this.handle = h; }
    public void run() { free(handle); }   // quietly cleans up a leak
}
```

This "works" but hides the bug — callers keep forgetting `close()` and nobody notices.

### Optimized — log the leak

```java
public void run() {
    free(handle);
    System.getLogger("leak").log(WARNING,
        "Resource was finalized without close() — fix the caller");
}
```

Cost is identical; now leaks surface in tests and logs instead of silently degrading the system. Pair with leak detectors (Netty `ResourceLeakDetector`, Python `ResourceWarning`).

---

## Optimization Tips

### How to find resource-cleanup problems

1. **Watch the gauges:** open file descriptors, connection-pool in-use count, goroutine count.
2. **Heap/alloc profiles:** `pprof -alloc_objects`, `async-profiler`, `py-spy` show per-call resource churn.
3. **Escape analysis (Go):** `go build -gcflags='-m'` reveals whether `defer`/closures heap-allocate.
4. **Leak detectors:** Netty `ResourceLeakDetector`, Python `-W error::ResourceWarning`, `go test -race`.

### Optimization checklist

- [ ] Replace manual `try/finally` with `with`/`defer`/try-with-resources/`using`.
- [ ] No `defer` inside loops — scope per iteration.
- [ ] Shrink lock/hold scope to the minimal critical section.
- [ ] Pool reusable resources; lease instead of re-acquire.
- [ ] `SuppressFinalize` / cancel the Cleaner on deterministic close.
- [ ] Class-based context managers on hot paths.
- [ ] `ExitStack` / LIFO closer for dynamic resource sets.
- [ ] Backstop finalizers **log** the leak.

### Anti-optimizations

- ❌ **Removing `defer`/`with` "to save a few ns"** — you trade a guaranteed nanosecond for a possible production hang.
- ❌ **Pooling everything** — pool only proven-hot, expensive-to-create resources.
- ❌ **Holding a lock longer to avoid re-locking** — contention costs far more.
- ❌ **Block-scope RAII for a pooled/long-lived resource** — re-acquisition dwarfs any cleanup cost.
- ❌ **Silent finalizer cleanup** — it hides the leak you should fix.

---

## Summary

RAII optimizations are mostly about **correct scope granularity** and **avoiding re-acquisition**, not shaving cleanup cost — the cleanup itself is nearly free (open-coded `defer`, desugared try-with-resources, inlined destructors). The real wins: scope per loop iteration, minimal lock holds, pooling/leasing instead of re-acquiring, suppressing finalizers, and turning backstops into leak detectors. Never trade the determinism guarantee for micro-optimization.

---

[← Find-Bug](find-bug.md) · [Resource & Type-Safety](../README.md) · [Roadmap](../../../../README.md)

**RAII & Dispose suite complete.** All 8 files: [junior](junior.md) · [middle](middle.md) · [senior](senior.md) · [professional](professional.md) · [interview](interview.md) · [tasks](tasks.md) · [find-bug](find-bug.md) · [optimize](optimize.md).

**Next:** [Type-Safe Enums](../02-type-safe-enums/junior.md).
