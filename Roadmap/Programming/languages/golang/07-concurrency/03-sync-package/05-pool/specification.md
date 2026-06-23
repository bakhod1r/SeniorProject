# sync.Pool — Specification

## Table of Contents
1. [Scope](#scope)
2. [Type Definition](#type-definition)
3. [Methods](#methods)
4. [Fields](#fields)
5. [Invariants](#invariants)
6. [Memory Model](#memory-model)
7. [Concurrency Properties](#concurrency-properties)
8. [Garbage Collection Interaction](#garbage-collection-interaction)
9. [Compatibility and Versioning](#compatibility-and-versioning)
10. [References](#references)

---

## Scope

This document is the formal contract for `sync.Pool` as exposed by the Go standard library, package `sync`. The text aims to be the source of truth that other files in this subsection cite. Where the Go documentation is authoritative, this file quotes or paraphrases it precisely.

The specification is current as of Go 1.21 (October 2023). Behaviour described holds for Go 1.13 and later (the victim cache is required from 1.13). Earlier versions differ: pre-1.13 pools drop everything on every GC.

---

## Type Definition

```go
package sync

type Pool struct {
    noCopy noCopy

    // local and localSize are unexported.
    local     unsafe.Pointer
    localSize uintptr

    // victim cache (since Go 1.13)
    victim     unsafe.Pointer
    victimSize uintptr

    // New optionally specifies a function to generate a value when Get
    // would otherwise return nil.
    New func() any
}
```

### Zero value

The zero value of `Pool` is a valid, empty pool with no `New` function. `Get` on a zero `Pool` returns `nil` (because `New` is `nil`). `Put` on a zero `Pool` is valid and stores the value.

### Identity

A `Pool` must not be copied after first use. The runtime detects copies via the `noCopy` marker, which produces a `go vet` warning. Copies of an in-use pool have undefined behaviour.

---

## Methods

### `func (p *Pool) Get() any`

Returns an arbitrary item from the pool, removing it from the pool, and returns it to the caller. `Get` may choose to ignore the pool and return a freshly-constructed item.

Behaviour:

- If the pool's local fast path has an item, returns that.
- If the local fast path is empty, tries to steal from other Ps' shared queues.
- If all queues are empty, tries the victim cache.
- If the victim cache is empty and `p.New != nil`, calls `p.New()` and returns the result.
- If `p.New == nil`, returns `nil`.

Returns: the item (typed `any`; caller must type-assert), or `nil` if pool is empty and `New` is nil.

Goroutine-safe: yes. May be called concurrently from any number of goroutines.

### `func (p *Pool) Put(x any)`

Adds `x` to the pool.

Behaviour:

- If `x == nil`, the call is a no-op.
- Stores `x` in the pool. May store in the local fast slot, in a shared queue, or discard it silently if internal limits are reached (in current implementations, discarding does not happen during normal operation).
- Returns immediately. No error.

Important: after `Put(x)`, the caller must not access `x`. The pool now owns the object.

Goroutine-safe: yes.

---

## Fields

### `New func() any`

Optional. If set, `Get` calls `New` when it would otherwise return `nil`. `New` is invoked in the calling goroutine, synchronously. The runtime does not pre-allocate.

Constraints:

- May not modify `p` (do not call `p.Put` or `p.Get` from within `New` — this is not strictly forbidden but is undefined behaviour in practice).
- May panic; the panic propagates to the `Get` caller.
- May be set before any `Get` or `Put`. Setting it after first use is allowed but races with concurrent operations.

Typical implementations: a one-line factory like `func() any { return new(bytes.Buffer) }`.

---

## Invariants

The pool maintains these invariants:

1. **Ownership transfer.** After `Put(x)`, the caller has no rights to `x`. Any read or write is a data race with potential other goroutines that have `Get` the same `x`.
2. **Type uniformity.** The pool itself is untyped (`any`); the caller is responsible for inserting only items of compatible types. Mixing types is permitted by the pool but defeats the type assertion on `Get`.
3. **Eviction.** Items may be evicted from the pool by the runtime at any garbage-collection cycle. There is no API to prevent eviction or to query whether eviction has occurred.
4. **Concurrent safety.** All exported operations (`Get`, `Put`, field reads/writes to `New`) are safe under concurrent calls from multiple goroutines.
5. **No size guarantee.** The pool does not guarantee any particular number of items at any given time. `Put` may discard; eviction may drop everything.

---

## Memory Model

The Go memory model (as updated for Go 1.19) specifies that `sync.Pool.Put` and the corresponding `sync.Pool.Get` synchronise via happens-before:

> A call to `Put(x)` "synchronises before" a call to `Get()` that returns the same `x`.

This means: writes to `x` and to memory reachable from `x` made before `Put(x)` are visible to any goroutine that receives `x` from `Get`.

In practice this means:

```go
buf.WriteString("hello") // (1)
pool.Put(buf)            // (2)
// ... other goroutine ...
buf2 := pool.Get()       // (3) returns buf
fmt.Println(buf2.String()) // sees "hello" — synchronisation from (2) to (3)
```

The pool does *not* synchronise:

- A `Put` of object A with a `Get` of object B (different objects).
- Operations on the pool with operations on other memory that are not transitively connected to the pooled object.

---

## Concurrency Properties

### Race-freedom

- `Get` and `Put` may be called from any number of goroutines simultaneously, against the same `Pool` instance, without external synchronisation.
- Internally, the pool uses atomics and lock-free queues to avoid mutex contention on hot paths.
- The race detector treats `Put`/`Get` as synchronisation events; using the same object after `Put` is flagged.

### Reentrancy

- `New` may be called recursively if the pool is empty and the caller's `New` itself causes another `Get`. This is undefined behaviour; the implementation does not detect it.
- Other than `New`, no method calls back into user code.

### Ordering

- The pool gives no FIFO or LIFO guarantee from the caller's point of view. Even within a single P, the order in which items are returned depends on internal state.
- A `Put` is not guaranteed to be observable by a `Get` on a different P, even after wall-clock delay.

### Cancellation

- There is no cancellation. `Get` and `Put` return promptly; neither blocks.

---

## Garbage Collection Interaction

The Go runtime registers a cleanup function for `sync.Pool` via `runtime_registerPoolCleanup`. The function is called during the STW (stop-the-world) phase of each garbage collection cycle.

The cleanup function:

1. Moves the contents of the live tier into the victim cache.
2. Empties the live tier.
3. Drops whatever was previously in the victim cache.

Net effect: an item placed in the live tier via `Put` may survive across one GC cycle (by becoming a victim) but is dropped by the next GC.

### Implications

- The pool's maximum useful lifetime per item is one GC cycle.
- Applications with frequent GC (low `GOGC`, high allocation pressure) see pools evict often.
- Applications with rare GC keep pools warm longer but may pay more memory cost.

### Triggering GC

User code can call `runtime.GC()` to force collection. This evicts the pool's live tier to victim. Tests that exercise pool behaviour across GC should call `runtime.GC()` explicitly.

---

## Compatibility and Versioning

### Stable API

`sync.Pool`'s public surface — `Get`, `Put`, `New` — has been stable since Go 1.3 (June 2014). No backward-incompatible changes have been made or are planned.

### Behavioural changes across versions

| Go version | Change |
|---|---|
| 1.3 | `sync.Pool` introduced. |
| 1.5 | Performance improvements. |
| 1.13 | Victim cache added. Items survive one GC instead of being immediately evicted. |
| 1.18 | `Pool.New` field's type narrowed to `func() any` (was `func() interface{}`; semantically identical post-1.18 type alias). |

### Not part of the contract

The following are implementation details and may change in any release:

- The number of items the pool retains.
- The order in which `Get` returns items.
- Whether `Put` always succeeds in storing (it currently does, but future versions may discard).
- The exact data structures (`poolLocal`, `poolDequeue`).
- The performance characteristics of `Get` and `Put` (current: ~5-10 ns; future versions may differ).

Programs that depend on any of these are fragile.

---

## References

- Standard library — [`sync.Pool`](https://pkg.go.dev/sync#Pool)
- Go source — [`src/sync/pool.go`](https://github.com/golang/go/blob/master/src/sync/pool.go)
- Go source — [`src/sync/poolqueue.go`](https://github.com/golang/go/blob/master/src/sync/poolqueue.go)
- Go memory model — [The Go Memory Model](https://go.dev/ref/mem)
- Change list introducing the victim cache — [CL 166961](https://go-review.googlesource.com/c/go/+/166961)
- Original proposal — [golang/go#22950](https://github.com/golang/go/issues/22950)
- Go Blog — [Garbage Collection in Go](https://go.dev/blog/ismmkeynote)
- Bryan C. Mills — [Concurrency without coupling](https://www.youtube.com/watch?v=5zXAHh5tJqQ)
