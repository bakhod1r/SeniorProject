# Finalizers & Destructors — Middle Level

> **Topic:** [Finalizers & Destructors](README.md)
> **Focus:** How deterministic destructors and GC finalizers actually work under the hood — drop order, drop flags, `with`/`defer`/`using`, the finalizer thread, resurrection, and the one-cycle delay.

---

## Table of Contents

- [Introduction](#introduction)
- [Prerequisites](#prerequisites)
- [Glossary](#glossary)
- [Core Concepts](#core-concepts)
- [Mental Models](#mental-models)
- [Code Examples](#code-examples)
- [Coding Patterns](#coding-patterns)
- [Pros & Cons](#pros--cons)
- [Use Cases](#use-cases)
- [Best Practices](#best-practices)
- [Edge Cases & Pitfalls](#edge-cases--pitfalls)
- [Summary](#summary)

---

## Introduction

At the junior level we drew the line between *deterministic* destructors and *non-deterministic* finalizers. Now we look at the **mechanisms**: what actually invokes cleanup, in what order, on which thread, and what can go wrong. The mechanism explains the rules. Once you understand *how* a finalizer gets scheduled — onto a queue, processed later by a dedicated thread, after at least one GC cycle — the "don't release scarce resources in finalizers" rule stops being dogma and becomes obvious.

We will cover the deterministic side (C++ destructors, Rust `Drop` with drop order and drop flags, Go `defer`, Python `with`, C# `using`) and the GC-driven side (Java `finalize`/`Cleaner`, Go `SetFinalizer`, Python `__del__`), including **resurrection**, **ordering**, and the **finalizer thread** model.

---

## Prerequisites

- Junior tier: the deterministic vs non-deterministic distinction.
- **Stack unwinding**: when a scope exits (normally or via an exception/error), local variables are torn down in a defined order.
- **Reference counting vs tracing GC** (rough idea): Python uses reference counting *plus* a cycle collector; Java/Go use tracing collectors.
- **Move semantics** (rough idea, for Rust/C++): ownership of a value can transfer.

---

## Glossary

| Term | Meaning |
|---|---|
| **Stack unwinding** | The process of destroying local variables as a scope exits (including during exception propagation). |
| **Drop order** | The order in which destructors run for variables in a scope — typically reverse of declaration. |
| **Drop flag** | A hidden runtime boolean Rust uses to track whether a value still needs dropping (e.g., after a conditional move). |
| **Finalizer queue** | A list the GC adds finalizable objects to; a separate thread drains it and runs their finalizers. |
| **Finalizer thread** | A dedicated background thread (or goroutine) that executes finalizers one by one. |
| **Resurrection** | A finalizer making the about-to-die object reachable again, canceling its collection. |
| **Reachability** | Whether the GC can still find an object through references from roots. |
| **Idempotent close** | A close operation safe to call more than once. |
| **`ManuallyDrop`** | A Rust wrapper that suppresses automatic dropping so you control it yourself. |

---

## Core Concepts

### The deterministic side: cleanup driven by control flow

Deterministic cleanup hooks into **control flow**, not the GC.

- **C++ destructors** run during **stack unwinding**. When a block exits, automatic objects are destroyed in **reverse construction order**. This happens on normal exit *and* while an exception unwinds — the foundation of exception safety.
- **Rust `Drop`** runs when a value goes out of scope. The compiler inserts the `drop` calls. **Drop order is reverse declaration order** within a scope; struct fields drop in declaration order. Because moves can change whether a variable still owns a value, the compiler sometimes needs **drop flags** — runtime booleans tracking whether a drop is still required.
- **Go `defer`** pushes a deferred call onto a per-function stack; deferred calls run in **LIFO order** when the function returns (including on `panic`).
- **Python `with`** / **C# `using`** are syntactic contracts: `__enter__`/`__exit__` and `IDisposable.Dispose()` are called at known points, even on exceptions.

The unifying property: you can read the source and identify the exact instant cleanup happens.

### The non-deterministic side: cleanup driven by the GC

A finalizer is metadata attached to an object. When the GC discovers the object is otherwise unreachable, instead of freeing it immediately, it:

1. Notices the object has a finalizer that hasn't run.
2. **Adds it to a finalizer queue** (the object is now temporarily kept alive).
3. A **finalizer thread** later dequeues it and runs the finalizer.
4. On a *subsequent* GC cycle, if the object is still unreachable, its memory is finally reclaimed.

Two consequences fall out of this mechanism immediately:

- **At least one extra GC cycle of delay** (often more). The object lives longer than a non-finalizable one.
- **A single shared thread** (Java's finalizer thread; Go runs finalizers in a goroutine). If one finalizer blocks, the whole queue backs up — the **finalizer thread stall**.

### Resurrection

During step 3, the finalizer runs arbitrary code — including storing `this`/the object into a global. That makes the object **reachable again**, so the GC must *not* collect it. The object is "resurrected." In most runtimes the finalizer will **not run a second time** even if the object dies again later, so a resurrected-then-re-abandoned object may leak its finalization entirely. Resurrection is almost always a bug.

### Ordering among finalizers

The GC does **not** order finalizers by reference relationships. If object A's finalizer touches object B, and both are being collected, B might be finalized (or even freed) first. **Never have one finalizer depend on another finalizable object still being valid.** With reference cycles, the order is fully undefined.

---

## Mental Models

- **Destructor = "on the way out the door."** It is wired to the *exit* of a scope/function, so it fires exactly when control leaves.
- **Finalizer = "in the lost-and-found queue."** The object is set aside, and a single clerk processes the queue eventually. You don't know when the clerk reaches your item, and the building might close (process exit) before they do.
- **Drop flags = a checklist.** "Did I already give this away (move) earlier? If so, don't try to drop it again." The compiler keeps the checklist so a moved-out value isn't double-dropped.
- **Resurrection = a zombie.** The object was pronounced dead, the mortician (finalizer) ran, and then it walked out alive. Spooky and almost never what you want.

---

## Code Examples

### Rust — `Drop`, drop order, and `ManuallyDrop`

```rust
struct Noisy(&'static str);
impl Drop for Noisy {
    fn drop(&mut self) {
        println!("dropping {}", self.0);
    }
}

fn main() {
    let _a = Noisy("a");   // declared first
    let _b = Noisy("b");   // declared second
    // At scope end, drop runs in REVERSE: "dropping b", then "dropping a".

    // You cannot call _a.drop() explicitly; the compiler forbids it.
    // To drop early, use std::mem::drop:
    let c = Noisy("c");
    drop(c);               // prints "dropping c" right here, deterministically

    // ManuallyDrop suppresses automatic Drop:
    let mut m = std::mem::ManuallyDrop::new(Noisy("m"));
    // m will NOT be dropped automatically; you must:
    unsafe { std::mem::ManuallyDrop::drop(&mut m); }
}
```

Key facts: drop order is reverse declaration; you can't call `drop(&mut self)` directly (you use `std::mem::drop`, which just *moves* the value and lets it fall out of scope); `ManuallyDrop` opts out of the automatic call.

### Go — `defer` (deterministic) vs `SetFinalizer` (non-deterministic)

```go
func process(path string) error {
    f, err := os.Open(path)
    if err != nil {
        return err
    }
    defer f.Close()        // LIFO; runs on every return path, including panic
    // ... use f ...
    return nil
}

// A finalizer as a leak-detector backstop only:
func newBuffer() *Buffer {
    b := &Buffer{handle: cAllocate()}
    runtime.SetFinalizer(b, func(b *Buffer) {
        // Runs in a goroutine, after >= 1 GC cycle, MAYBE before exit.
        cFree(b.handle)    // native memory the GC can't see
    })
    return b
}
```

`defer` is the real cleanup. `SetFinalizer` is the backstop for native memory; it is not guaranteed to run before the program exits.

### Python — `with` vs `__del__`

```python
# Deterministic: __exit__ runs at the end of the block, even on exception.
class Conn:
    def __enter__(self):
        self.sock = connect()
        return self
    def __exit__(self, exc_type, exc, tb):
        self.sock.close()       # known point

with Conn() as c:
    use(c)

# Non-deterministic: __del__ runs when refcount hits zero — usually prompt
# under CPython, but NOT guaranteed (cycles, gc disabled, shutdown).
class Leaky:
    def __del__(self):
        self.sock.close()       # may be late, may be skipped at shutdown
```

CPython's reference counting often calls `__del__` promptly, which *lulls* you into trusting it — but cycles, a different interpreter, or shutdown break that.

---

## Coding Patterns

### Pattern: explicit close, finalizer as backstop

The canonical "two-tier" shape (shown here in Go-style pseudocode):

```go
type Resource struct {
    handle uintptr
    closed bool
}

func (r *Resource) Close() error {
    if r.closed {
        return nil          // idempotent
    }
    r.closed = true
    return release(r.handle)
}

// Backstop: if the caller forgot Close(), the GC eventually releases native memory.
// (In Go 1.24+, prefer runtime.AddCleanup over SetFinalizer — see senior tier.)
```

Callers use `defer r.Close()`. The finalizer only fires when someone *forgot*, and it should log that mistake.

### Pattern: idempotent close

Both an explicit close and a finalizer can run. Guard with a `closed` flag (or atomic) so the second call is a no-op. Without this, double-free crashes and "already closed" errors appear under load.

---

## Pros & Cons

| Mechanism | Timing | Thread | Main use |
|---|---|---|---|
| C++ destructor / Rust `Drop` | Scope exit (deterministic) | Caller's | Primary cleanup, exception/panic-safe |
| Go `defer` | Function return (deterministic) | Caller's | Primary cleanup |
| Python `with` / C# `using` | Block exit (deterministic) | Caller's | Primary cleanup |
| Java `finalize` / `Cleaner`, Go finalizer, Python `__del__` | GC-driven (non-deterministic) | Finalizer thread/goroutine | Backstop only |

Deterministic wins on timing, thread-locality, and exception-safety. Finalizers win only as a *forgot-to-close* safety net and native-memory reclaim.

---

## Use Cases

- **`defer`/`with`/`using`/`Drop`/destructor:** every scarce or side-effecting resource — files, sockets, DB connections, locks, transactions, temp files.
- **Finalizer/Cleaner:** free native memory the GC can't see; detect and log leaks; never the only release path for OS handles.

---

## Best Practices

1. **Wire cleanup to control flow**, not to the GC, for anything that matters.
2. **Know your drop order** (reverse declaration in Rust/C++) when one resource depends on another — declare the dependency *first* so it drops *last*.
3. **Make close idempotent** so explicit-close + backstop-finalizer coexist safely.
4. **Never have one finalizer depend on another finalizable object.**
5. **Never resurrect** — don't store `self`/`this` somewhere live from inside a finalizer.
6. **Don't block in a finalizer** — you'll stall the shared finalizer thread.

---

## Edge Cases & Pitfalls

- **Conditional moves in Rust** create drop flags; a value moved in one branch must not be dropped in the merge — the compiler handles it, but it explains why drops sometimes seem to "disappear."
- **`defer` in a loop** stacks up until the function returns, not each iteration — can hold resources far too long. Wrap the body in a function or close explicitly.
- **CPython prompt `__del__` is a trap**: works in tests, fails on cycles or alternative runtimes.
- **Finalizer thread starvation**: a slow or blocking finalizer halts every other object's finalization behind it in the queue.
- **Shutdown skips finalizers** in most runtimes; don't "flush on exit" from a finalizer.

---

## Summary

- Deterministic cleanup (C++ destructors, Rust `Drop`, Go `defer`, Python `with`, C# `using`) is wired into **control flow** and fires at a known instant, in a known order (reverse declaration), on the caller's thread, safely through exceptions and panics.
- Finalizers are **queued** when the GC finds an object unreachable, drained later by a **single finalizer thread/goroutine**, after **at least one extra GC cycle**, and possibly **never** (shutdown).
- That mechanism directly causes the hazards: delay, thread stalls, undefined ordering, and **resurrection**.
- Use the **two-tier pattern**: explicit idempotent close as the primary path, finalizer as a backstop that logs forgotten cleanup and reclaims native memory.
