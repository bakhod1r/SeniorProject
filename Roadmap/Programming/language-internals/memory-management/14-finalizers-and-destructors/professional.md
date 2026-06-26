# Finalizers & Destructors — Professional Level

> **Topic:** [Finalizers & Destructors](README.md)
> **Focus:** Production-grade resource cleanup — the two-tier explicit-close + finalizer-backstop pattern, the incidents that justify it, and how to implement it correctly in Rust, C++, Go, Java, and Python.

---

## Table of Contents

- [Introduction](#introduction)
- [Core Concepts](#core-concepts)
  - [The two-tier pattern](#the-two-tier-pattern)
  - [What belongs in each tier](#what-belongs-in-each-tier)
- [Production Patterns by Language](#production-patterns-by-language)
- [War Stories](#war-stories)
- [Pros & Cons](#pros--cons)
- [Best Practices](#best-practices)
- [Edge Cases & Pitfalls](#edge-cases--pitfalls)
- [Summary](#summary)

---

## Introduction

In production, the failure mode of getting teardown wrong is not "memory grows." It is "the service stops accepting connections at 3 a.m. because every file descriptor, every connection-pool slot, and every advisory lock is held by an object the GC has not gotten around to collecting." Heap memory is abundant and elastic; OS handles are scarce and hard-capped. A finalizer reclaims memory eventually, which masks the leak of the *real* scarce resource until the limit hits.

This section is about the pattern that production code actually uses: **deterministic close as the contract, a finalizer as an alarm.** We'll implement it correctly in each major runtime and walk through the incidents that make it non-negotiable.

---

## Core Concepts

### The two-tier pattern

Every robust resource-owning type in a GC'd language has two paths to cleanup:

1. **Tier 1 — explicit, deterministic release.** `close()`, `Dispose()`, `defer`, `with`. This is the *contract*: callers are expected to use it, and the resource is released at a known point. This is the only path that touches scarce handles.
2. **Tier 2 — finalizer backstop.** Runs only if Tier 1 was skipped. Its job is narrow: release *native memory* the GC can't see, and **log loudly that a close was missed** so the bug is found and fixed. It must be idempotent with Tier 1.

The backstop is not there to make leaks correct. It is there to (a) prevent native-memory leaks from forgotten closes and (b) turn an invisible handle leak into a visible log line. A well-run service treats "finalizer ran for an unclosed X" as a defect to fix, not a normal event.

### What belongs in each tier

| Resource | Tier 1 (deterministic) | Tier 2 (finalizer) |
|---|---|---|
| File descriptor / socket | **Yes — mandatory** | Log-only; never the plan |
| Lock / mutex / advisory lock | **Yes — mandatory** | Never (deadlock risk) |
| DB connection / transaction | **Yes — mandatory** | Log-only; rollback at most |
| Off-heap / native buffer (`malloc`, mmap) | Preferred | **Yes — legitimate backstop** |
| Pure managed memory | n/a (GC handles it) | n/a |

The rule of thumb: *if releasing it late can break correctness or exhaust a hard OS limit, it must be Tier 1.* Native memory is the only resource where Tier 2 alone is acceptable — and even then, prompt explicit release is better for footprint.

---

## Production Patterns by Language

### Rust — `Drop` is the whole story

RAII makes Tier 1 automatic and Tier 2 unnecessary; there is no GC to back you up, and you don't need one.

```rust
pub struct Connection {
    fd: std::os::unix::io::RawFd,
}

impl Drop for Connection {
    fn drop(&mut self) {
        // Deterministic: end of scope, early return, or panic-unwind.
        if self.fd >= 0 {
            unsafe { libc::close(self.fd); }
        }
    }
}
```

For an explicit early close that consumes the value (so `Drop` doesn't double-close), take `self` by value and `mem::forget` the wrapper after manual cleanup, or model the closed state. Note: `Drop::drop` is never called by you directly — `std::mem::drop(conn)` moves and drops it once.

### C++ — RAII with a `noexcept` destructor

```cpp
class FileHandle {
    int fd_ = -1;
public:
    explicit FileHandle(const char* path) : fd_(::open(path, O_RDWR)) {}
    ~FileHandle() noexcept {              // must not throw during unwind
        if (fd_ >= 0) ::close(fd_);
    }
    FileHandle(FileHandle&& o) noexcept : fd_(o.fd_) { o.fd_ = -1; }  // move = transfer
    FileHandle(const FileHandle&) = delete;   // non-copyable owner
};
```

Deterministic, exception-safe, and the move constructor zeroes the source fd so the destructor doesn't double-close. No finalizer concept.

### Go — `defer` as Tier 1, `AddCleanup`/`SetFinalizer` as Tier 2

```go
type Buffer struct {
    ptr  unsafe.Pointer // off-heap allocation the GC can't see
    size int
    closed atomic.Bool
}

func NewBuffer(size int) *Buffer {
    b := &Buffer{ptr: C.malloc(C.size_t(size)), size: size}
    // Tier 2 backstop (Go 1.24+). Cleanup arg must NOT reference b.
    ptr := b.ptr
    runtime.AddCleanup(b, func(p unsafe.Pointer) {
        // Reaches here only if Close() was never called.
        log.Printf("WARNING: Buffer leaked without Close()")
        C.free(p)
    }, ptr)
    return b
}

func (b *Buffer) Close() {           // Tier 1
    if b.closed.Swap(true) {
        return                       // idempotent
    }
    C.free(b.ptr)
    b.ptr = nil
}

func Use() {
    b := NewBuffer(4096)
    defer b.Close()                  // deterministic release at return
    // ... work ...
}
```

Key points: the `AddCleanup` callback takes a *copy of the raw pointer*, not `b` — capturing `b` would keep it alive forever and the cleanup would never fire. On the legacy `runtime.SetFinalizer`, the same rule applies and you additionally pay a one-GC-cycle survival penalty and risk resurrection.

### Java — `AutoCloseable` + `Cleaner`

```java
public final class NativeResource implements AutoCloseable {
    // State to clean MUST be static and hold NO reference to the outer instance.
    private static final class State implements Runnable {
        private long handle;             // native pointer
        State(long h) { this.handle = h; }
        public void run() {              // Tier 2 backstop
            if (handle != 0) {
                // log a missed close, then free native memory
                System.getLogger("NativeResource")
                      .log(System.Logger.Level.WARNING, "leaked without close()");
                nativeFree(handle);
                handle = 0;
            }
        }
    }

    private static final Cleaner CLEANER = Cleaner.create();
    private final State state;
    private final Cleaner.Cleanable cleanable;

    public NativeResource() {
        this.state = new State(nativeAlloc());
        this.cleanable = CLEANER.register(this, state); // `this` watched, `state` cleaned
    }

    @Override public void close() {      // Tier 1 — deterministic via try-with-resources
        cleanable.clean();               // runs state.run() now, exactly once
    }

    private static native long nativeAlloc();
    private static native void nativeFree(long handle);
}
```

```java
try (NativeResource r = new NativeResource()) {
    // ... deterministic close at end of block ...
}
```

The non-negotiable Java rule: **the cleaning `State` must not capture the host `NativeResource`.** If it did, the object would be reachable through the `Cleaner` and never become phantom-reachable, so the backstop would never run. This is why `State` is a `static` nested class taking only the raw `handle`.

### Python — `with` as Tier 1, `__del__` as a guarded backstop

```python
class Resource:
    def __init__(self, path):
        self._f = open(path, "rb")
        self._closed = False

    def close(self):                       # idempotent Tier 1
        if not self._closed:
            self._f.close()
            self._closed = True

    def __enter__(self):
        return self

    def __exit__(self, *exc):
        self.close()                       # deterministic on block exit

    def __del__(self):                     # Tier 2 — best-effort only
        if not self._closed:
            # During interpreter shutdown, builtins may be torn down.
            try:
                import warnings
                warnings.warn("Resource not closed; relying on __del__", ResourceWarning)
            except Exception:
                pass
            self.close()
```

Usage is `with Resource(p) as r:`. `__del__` is a guarded safety net, never the contract: it may not run on cycles, may see a half-dismantled interpreter at shutdown, and behaves differently on PyPy.

---

## War Stories

- **"4 GB free, zero file descriptors."** A service wrapped each upload in an object that closed its temp file *in `__del__` / a finalizer only*. Under bursty load the GC didn't run often enough; `EMFILE` ("too many open files") hit while the heap was nearly empty. Fix: deterministic `with`/`close`, finalizer demoted to a logging backstop. Lesson: handle limits bite long before memory pressure triggers the GC.

- **The single finalizer thread (Java).** A legacy class did slow network I/O inside `finalize()`. Under load the lone finalizer thread couldn't drain its queue; finalizable objects piled up, retaining everything they referenced, and the heap grew until OOM — a *memory* leak caused by a *finalizer-throughput* bottleneck. Fix: removed I/O from finalization, moved to `Cleaner`, made cleanup O(1).

- **The cleaner that captured `this`.** A team migrated to `Cleaner` but registered a lambda closing over the outer object to "reach its handle." The object was now reachable via the cleaner forever; native memory grew without bound and the cleanup never ran. Fix: extracted a static `State` holding only the raw handle.

- **Resurrection double-free.** A Go `SetFinalizer` re-registered the object inside its own finalizer to "retry" cleanup, then a code path also called the explicit `Close()`. The native buffer was freed twice → heap corruption. Fix: idempotent close guarded by an atomic flag; no resurrection.

- **Lock released in a finalizer.** An advisory DB lock was released only when the holder object was finalized. Two requests deadlocked because the GC hadn't collected the first holder. Locks are *never* Tier 2.

---

## Pros & Cons

**Two-tier pattern**

- Pros: deterministic release for scarce handles; native memory still reclaimed if a close is forgotten; leaks become visible log lines; idempotency prevents double-free; works uniformly across runtimes.
- Cons: more code per resource type; requires discipline to keep the backstop's captured state detached; the backstop's non-determinism means it must not be relied upon for correctness — only for footprint and observability.

**Finalizer-only (anti-pattern)**

- Pros: less code, no caller discipline needed.
- Cons: exhausts OS limits, deadlocks on locks, undefined timing, thread-stall cascades, resurrection, swallowed exceptions. Acceptable *only* for pure off-heap memory with no hard limit and no correctness coupling.

---

## Best Practices

1. **Tier 1 is the contract; Tier 2 is the alarm.** Every scarce resource gets deterministic `close`/`Dispose`/`defer`/`with`/RAII. The finalizer only logs-and-frees-native.
2. **Make close idempotent** with an atomic/boolean guard; suppress the finalizer once closed (`GC.SuppressFinalize`, `cleanable.clean()`, clear the flag) to avoid double-free and queue overhead.
3. **Detach the backstop's state from the host object** — static `State` (Java), copied raw pointer (Go `AddCleanup`), no `self` capture (Python). Capturing the host defeats the mechanism.
4. **Keep finalizers O(1) and I/O-free.** No network, no locks, no blocking. They share one thread/queue.
5. **Surface missed closes in CI.** Turn `ResourceWarning`/leak logs into test failures so the backstop firing is treated as a bug.
6. **Prefer the modern API** — `Cleaner` over `finalize()`, `runtime.AddCleanup` over `SetFinalizer`.

---

## Edge Cases & Pitfalls

- **Double-free via Tier 1 + Tier 2** — guard with an idempotent flag and suppress the finalizer after explicit close.
- **Backstop never fires** because it captures the host object (Java/Go/Python) — keep captured state minimal and detached.
- **Finalizer throws** — exceptions in finalizers are swallowed (Java) or crash at shutdown (Python). Wrap in try/except and log.
- **Shutdown ordering** — finalizers may not run at process exit (Java/Go) and may see a torn-down interpreter (Python). Flush critical buffers in Tier 1, never Tier 2.
- **Reference cycles** defer or skip refcount-based cleanup (Python/Swift) — break with `weak`/`unowned`/explicit close.

---

## Summary

Production resource management is the two-tier pattern: a deterministic `close`/`Dispose`/`defer`/RAII contract that releases scarce handles at a known point, plus a finalizer backstop whose only jobs are freeing native memory and logging that a close was missed. The backstop must be idempotent with the explicit path, must keep its captured state detached from the host object, and must do no I/O. The war stories all reduce to one mistake — trusting a non-deterministic finalizer with a scarce, correctness-critical resource — and the fix is always the same: promote release to Tier 1 and demote the finalizer to an alarm.
