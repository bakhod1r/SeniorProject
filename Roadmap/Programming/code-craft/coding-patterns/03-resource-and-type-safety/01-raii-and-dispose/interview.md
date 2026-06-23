# RAII & Dispose — Interview Questions

> **Category:** [Resource & Type-Safety Patterns](../README.md) — questions on deterministic cleanup, the Dispose pattern, ownership, and the traps.

---

## Table of Contents

1. [Junior Questions](#junior-questions-10)
2. [Middle Questions](#middle-questions-10)
3. [Senior Questions](#senior-questions-10)
4. [Professional Questions](#professional-questions-10)
5. [Coding Tasks](#coding-tasks-5)
6. [Trick Questions](#trick-questions-5)
7. [Behavioral Questions](#behavioral-questions-5)
8. [Tips for Answering](#tips-for-answering)

---

## Junior Questions (10)

### J1. What does RAII stand for and what's the core idea?

**Answer:** *Resource Acquisition Is Initialization.* Bind a resource's lifetime to a scope or object so cleanup is automatic and deterministic — it runs at scope exit even on exceptions or early returns.

### J2. Why is `f.close()` on the last line of a function unsafe?

**Answer:** If anything between `open` and `close` throws or returns early, the `close()` is skipped and the handle leaks. The release must be tied to the scope, not to a line you might jump over.

### J3. Name the RAII mechanism in Go, Python, Java, and C++.

**Answer:** Go: `defer`. Python: `with` + context manager. Java: try-with-resources + `AutoCloseable`. C++: destructors (the original RAII).

### J4. What kinds of things are "resources"?

**Answer:** Anything finite that must be released: file handles, sockets, DB connections, locks/mutexes, transactions, memory, temp files.

### J5. What anti-pattern does RAII dissolve?

**Answer:** Sequential coupling — the requirement to call `open → use → close` in order. RAII makes the structure enforce it so you can't forget.

### J6. What's a context manager in Python?

**Answer:** An object with `__enter__` (setup, returns the resource) and `__exit__` (teardown, runs on any exit). The `with` statement drives it.

### J7. What does `defer` do in Go?

**Answer:** Registers a function call to run when the **surrounding function** returns, on any path. Defers run LIFO.

### J8. Should `close()` be safe to call twice?

**Answer:** Yes — make it idempotent. Pools, wrappers, and finalizer backstops all assume double-close is harmless.

### J9. In what order do resources release in a multi-resource scope?

**Answer:** LIFO — last acquired, first released. So a resource that depends on an earlier one is cleaned up while the earlier one is still alive.

### J10. What's the bug with `defer` inside a loop?

**Answer:** `defer` fires at function return, not per iteration — so all the resources stay open until the function ends. Extract a helper so each iteration has its own scope.

---

## Middle Questions (10)

### M1. Why can't you rely on a finalizer (`__del__`/`finalize`) for cleanup?

**Answer:** Finalizers run at GC time, which is non-deterministic and may never happen (reference cycles, `os._exit`, crash). You can exhaust file descriptors long before the GC runs. Finalizers are a backstop, not primary cleanup.

### M2. What's the difference between GC reclaiming an object and closing its resource?

**Answer:** GC frees *memory*; it does not reliably release *OS resources*. A leaked file handle is not a memory leak — the GC won't fix it. Only `close`/`with`/`defer` releases the handle.

### M3. Explain the Dispose pattern (`Dispose(bool)`).

**Answer:** One `Dispose(bool disposing)` method does the work; `disposing=true` is the deterministic path (release managed + unmanaged), `disposing=false` is the finalizer path (unmanaged only). Public `Dispose()` calls it with `true` then `GC.SuppressFinalize(this)`. A `disposed` flag makes it idempotent; the finalizer is a backstop.

### M4. What is `GC.SuppressFinalize` for?

**Answer:** Once you've cleaned up deterministically via `Dispose()`, you tell the GC to skip the object's (expensive) finalizer — finalizable objects otherwise survive extra GC cycles.

### M5. When should RAII *not* be used?

**Answer:** When the resource must outlive the creating scope — ownership transfer. A function that opens and *returns* a resource must not close it; the caller's scope owns it.

### M6. Why must you `defer Close()` only after checking the open error?

**Answer:** If `open` failed, the handle is nil/invalid; deferring `Close()` on it panics or no-ops incorrectly. Defer only after a successful acquire.

### M7. What's a lock guard and why is it RAII's killer app?

**Answer:** A scope-bound lock: acquire at block entry, release at exit. A lock left held on an error path is a deadlock — the most common production hang. RAII makes releasing it unforgettable.

### M8. How does Java handle an exception thrown by `close()`?

**Answer:** try-with-resources attaches it as a **suppressed exception** on the primary exception (`getSuppressed()`), preserving both rather than letting `close()`'s failure mask the real cause.

### M9. What's the modern replacement for `finalize()` in Java?

**Answer:** `java.lang.ref.Cleaner` (Java 9+), or for the deterministic path simply `AutoCloseable.close()`. `finalize()` is deprecated.

### M10. How do you make `__exit__` not swallow exceptions?

**Answer:** Return `False` (or `None`). Returning a truthy value suppresses the body's exception — almost always a bug.

---

## Senior Questions (10)

### S1. Explain ownership and move semantics in the context of RAII.

**Answer:** RAII needs exactly one owner. Two owners → double-close; zero → leak. Move semantics (C++ `unique_ptr`/`std::move`, Rust moves) transfer ownership instead of copying, so the type system enforces single ownership and exactly-once release. In GC languages it's convention: return = transfer, parameter = borrow.

### S2. Why is cleanup order LIFO, and when does it matter?

**Answer:** Later resources often depend on earlier ones (ResultSet → Transaction → Connection). LIFO guarantees a dependency is still alive while its dependent cleans up — e.g., a rollback still has a live connection.

### S3. How do you design a finalizer safety net correctly?

**Answer:** Use `Cleaner`/`weakref.finalize`; the cleanup action must hold the raw handle but **not** the wrapper object (else it's reachable forever and never collected). Share one Cleanable between `close()` and the GC path so cleanup runs once; log the leak so misuse surfaces in testing.

### S4. Where does RAII's guarantee end?

**Answer:** `os._exit`/`System.exit` mid-stack, `SIGKILL`, power loss, OOM-kill, a leaked never-returning thread — none run local cleanup. Durable cleanup (distributed locks, remote temp objects) needs an external reaper / TTL lease, not scope-bound RAII.

### S5. Why must C++ destructors not throw?

**Answer:** If a destructor throws while the stack is already unwinding another exception, `std::terminate` is called. Destructors are effectively `noexcept`; cleanup must not throw.

### S6. How do you handle cleanup for a runtime-determined number of resources?

**Answer:** Python's `ExitStack` (or a LIFO multi-closer in Go) — register each acquired resource; the stack closes all of them LIFO on exit, including partial acquisitions that succeeded before a later one failed.

### S7. A resource is captured by a goroutine/thread that outlives the function. Who closes it?

**Answer:** The goroutine that now owns it — `defer f.Close()` belongs *inside* the goroutine. Closing it in the outer function races with the concurrent use (use-after-close).

### S8. What exception-safety guarantees can RAII provide?

**Answer:** At least **basic** automatically (no leaks, invariants hold). **Strong** (rollback-on-failure) requires the resource's `__exit__`/`Dispose` to implement it, as a transaction's commit-or-rollback does.

### S9. How do you expose a pooled resource with RAII ergonomics?

**Answer:** A **lease** whose `close()` *returns* the resource to the pool instead of destroying it, wrapped in `with`/try-with-resources. RAII syntax, pool-managed lifetime.

### S10. Compare RAII, `try/finally`, and finalizers.

**Answer:** RAII: deterministic, forget-proof, low boilerplate. `try/finally`: deterministic but you must write it everywhere (easy to skip a branch). Finalizers: non-deterministic, backstop only.

---

## Professional Questions (10)

### P1. How is `defer` implemented in modern Go?

**Answer:** Go 1.14+ uses **open-coded defers**: when all defers are visible, not in a loop, and ≤ 8, the compiler inlines them into the return path with an "armed" bitmask (~1 ns). Loops/conditional defers fall back to a heap `_defer` record on the goroutine list (~45 ns) — which is why `defer` in a loop is both a correctness and a performance bug.

### P2. What does try-with-resources desugar to?

**Answer:** A `try/finally` that captures the primary exception, calls `close()` in `finally`, and on a `close()` failure calls `addSuppressed` on the primary. Multiple resources nest, giving LIFO close order. It's pure sugar — cost is just the `close()` call.

### P3. Why do suppressed exceptions exist?

**Answer:** The `finally` must close the resource even while the body's exception propagates. A failing `close()` can't be allowed to mask the real cause, so it's attached as suppressed rather than thrown over the primary.

### P4. Walk through how Python's `with` runs `__exit__` on exception.

**Answer:** `BEFORE_WITH` calls `__enter__`; on the normal path the compiler emits a `__exit__(None,None,None)` call; on exception, the frame's exception table routes to `WITH_EXCEPT_START`, which calls `__exit__(type, val, tb)`. A truthy return suppresses; CPython 3.11+ uses zero-cost exception tables so the happy path is cheap.

### P5. Why does a Cleaner's cleanup action have to be a static class?

**Answer:** If the action captures `this`, the wrapper object stays reachable forever and never becomes collectable — the safety net never fires. The action must hold only the raw handle.

### P6. What's the GC cost of finalizable objects?

**Answer:** They survive extra GC cycles — the collector must run the finalizer, then reclaim on a later cycle. That's throughput cost, and a reason to `SuppressFinalize`/`close()` deterministically.

### P7. How does C++ achieve zero-overhead RAII?

**Answer:** Destructor calls are emitted inline at compile time at scope exits; unwind tables (`.eh_frame`) map PCs to destructors. No scheduler, no list. Cost is paid only when an exception is actually thrown.

### P8. What's the cost of `@contextmanager` vs a hand-written context manager?

**Answer:** ~2–3× more (generator setup/teardown and the `throw` into the generator on the exception path). Negligible except on hot paths, where a `__enter__/__exit__` class is leaner.

### P9. Your service must release a distributed lock even if the pod is killed. Can RAII do it?

**Answer:** No — `SIGKILL` runs no local cleanup. Use a lock with a **TTL/lease** so the lock server auto-releases, plus heartbeating. RAII handles the in-process path; the TTL handles the crash path.

### P10. How do you detect resource leaks in production?

**Answer:** Make the finalizer/Cleaner backstop **log** when it fires (a leak), monitor open-FD/connection-pool gauges, run with leak detectors (Netty's `ResourceLeakDetector`, `ResourceWarning` in Python, `-race`/`pprof` heap profiles), and fail tests when the backstop runs.

---

## Coding Tasks (5)

### C1. Idempotent `AutoCloseable` (Java)

```java
public final class Lease implements AutoCloseable {
    private final Conn conn; private boolean closed = false;
    public Lease(Pool p) { this.conn = p.acquire(); }
    public Conn get() {
        if (closed) throw new IllegalStateException("closed");
        return conn;
    }
    @Override public void close() {
        if (closed) return;            // idempotent
        closed = true; pool.release(conn);
    }
}
```

### C2. Transaction context manager (Python)

```python
from contextlib import contextmanager

@contextmanager
def transaction(db):
    tx = db.begin()
    try:
        yield tx
        tx.commit()          # success path
    except Exception:
        tx.rollback()        # error path
        raise
    finally:
        tx.close()
```

### C3. Correct `defer` in a loop (Go)

```go
for _, p := range paths {
    if err := func() error {
        f, err := os.Open(p)
        if err != nil { return err }
        defer f.Close()          // runs at end of THIS iteration
        return process(f)
    }(); err != nil {
        return err
    }
}
```

### C4. ExitStack for N resources (Python)

```python
from contextlib import ExitStack

def open_all(paths):
    with ExitStack() as stack:
        files = [stack.enter_context(open(p)) for p in paths]
        return merge(files)      # all closed LIFO on exit, even partial opens
```

### C5. Surface a Close() error (Go)

```go
func write(path string, b []byte) (err error) {
    f, err := os.Create(path)
    if err != nil { return err }
    defer func() {
        if cerr := f.Close(); cerr != nil && err == nil { err = cerr }
    }()
    _, err = f.Write(b)
    return err
}
```

---

## Trick Questions (5)

### T1. Does letting a file object go out of scope close the file in Python/Java?

**Eventually and unreliably.** The GC *may* finalize it later, but not deterministically. Always `close`/`with`. CPython's refcounting often closes it promptly, but you must not depend on that.

### T2. Will `defer` run if the program calls `os.Exit(1)`?

**No.** `os.Exit` terminates immediately; no deferred functions run. Same for `System.exit` frames above it and `os._exit`.

### T3. Is `try-with-resources` slower than `try/finally`?

**No.** It desugars to a `try/finally`. The only extra is `addSuppressed` bookkeeping on the exception path.

### T4. Can `__exit__` hide the exception raised in the `with` body?

**Yes — if it returns truthy.** That's the swallow-the-error footgun. Return `False`/`None` unless suppression is genuinely intended.

### T5. Two resources, the second `close()` throws. Does the first still close?

**In Java try-with-resources, yes** (LIFO, all close, second failure suppressed). In a hand-rolled single `finally` that closes both sequentially, a throw from the first close can skip the second — which is exactly why you use the language mechanism.

---

## Behavioral Questions (5)

### B1. Tell me about a resource leak you debugged.

**Sample:** "Connection pool exhaustion under load. A query path returned early on `ErrNotFound` without closing the `rows`. One `defer rows.Close()` after the query fixed every path; we added a pool-leak gauge to catch regressions."

### B2. When did a finalizer bite you?

**Sample:** "Code relied on `__del__` to close sockets. Under a reference cycle they never closed, and we ran out of FDs in long-running workers. We moved to explicit `with`/`close` and kept `weakref.finalize` only to log leaks."

### B3. How do you decide where a resource's cleanup lives?

**Sample:** "By ownership. If a function returns the resource, the caller owns it. If it's pooled, the pool owns it and I expose a lease. Block-scope RAII only when the lifetime truly matches the block."

### B4. Describe handling cleanup that must survive a crash.

**Sample:** "We had temp objects in S3 that leaked when pods were killed. RAII can't help past SIGKILL, so we added lifecycle TTLs on the bucket plus a reaper job — external mechanisms for durable cleanup."

### B5. How do you review code for resource safety?

**Sample:** "I check every error/early-return path for a missed `close`, look for `defer` in loops, verify `close()` is idempotent, confirm writable resources surface flush errors, and that no finalizer is doing real work."

---

## Tips for Answering

1. **Lead with determinism:** RAII = cleanup tied to scope, guaranteed on every path.
2. **Contrast with finalizers** — non-deterministic, backstop only.
3. **Know the keywords:** `defer`, `with`, try-with-resources, `using`, destructors.
4. **Name the traps:** `defer` in a loop, double-close, ownership transfer, swallowing exceptions.
5. **Know the boundary:** SIGKILL/`os._exit` run nothing — durable cleanup needs an external reaper.

---

[← Professional](professional.md) · [Resource & Type-Safety](../README.md) · [Roadmap](../../../../README.md) · **Next:** [Tasks](tasks.md)
