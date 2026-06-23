# Mutexes — Specification

## Table of Contents
1. [Scope](#scope)
2. [`sync.Mutex` API](#syncmutex-api)
3. [`sync.RWMutex` API](#syncrwmutex-api)
4. [Formal Guarantees](#formal-guarantees)
5. [Memory Model Statements](#memory-model-statements)
6. [Implementation Constraints](#implementation-constraints)
7. [Errors and Panics](#errors-and-panics)
8. [Compatibility Notes](#compatibility-notes)

---

## Scope

This document specifies the externally observable behaviour of Go's `sync.Mutex` and `sync.RWMutex` types as of Go 1.22. Implementation details (state-word layout, scheduling heuristics, normal-vs-starvation mode, OS primitives) are documented in `professional.md`; here we list only what callers may rely upon.

References:
- `pkg.go.dev/sync` — package documentation.
- `go.dev/ref/mem` — the Go Memory Model.
- `src/sync/mutex.go`, `src/sync/rwmutex.go` — the canonical implementation.

---

## `sync.Mutex` API

```go
type Mutex struct {
    // unexported fields
}

func (m *Mutex) Lock()
func (m *Mutex) TryLock() bool   // Go 1.18+
func (m *Mutex) Unlock()
```

### `Lock`

Acquires the mutex. If the mutex is already locked, `Lock` blocks the calling goroutine until the mutex becomes available.

- The zero-value `Mutex` is unlocked and ready for use.
- `Lock` is safe for concurrent use by multiple goroutines.
- A goroutine that holds the mutex must not call `Lock` again on the same mutex (no reentrancy).

### `TryLock`

Attempts to acquire the mutex without blocking. Returns `true` if successful, `false` if the mutex is already locked.

- `TryLock` is provided as of Go 1.18.
- The Go documentation explicitly notes that "while correct uses of `TryLock` exist, they are rare." Most code should not use it.
- Failure to acquire is not an error.

### `Unlock`

Releases the mutex. Wakes one waiting goroutine if any.

- It is illegal to call `Unlock` on a mutex that is not locked: this triggers `fatal error: sync: unlock of unlocked mutex` and aborts the program.
- A locked mutex is not associated with a particular goroutine. It is allowed for one goroutine to lock and another to unlock — but this pattern is highly discouraged because it bypasses the natural same-goroutine convention used by `defer`.

---

## `sync.RWMutex` API

```go
type RWMutex struct {
    // unexported fields
}

func (rw *RWMutex) Lock()
func (rw *RWMutex) TryLock() bool        // Go 1.18+
func (rw *RWMutex) Unlock()
func (rw *RWMutex) RLock()
func (rw *RWMutex) TryRLock() bool       // Go 1.18+
func (rw *RWMutex) RUnlock()
func (rw *RWMutex) RLocker() Locker      // returns a Locker that calls RLock/RUnlock
```

### `Lock` / `Unlock`

Writer methods. While a writer holds the lock, no other writer or reader may proceed.

### `RLock` / `RUnlock`

Reader methods. Any number of readers may hold the read lock simultaneously, provided no writer is holding or waiting.

- If a writer is waiting, new `RLock` calls may block to prevent writer starvation. The exact rules are implementation-defined but Go's implementation guarantees a waiting writer eventually proceeds.
- An `RLock` must be paired with `RUnlock`.

### `RLocker`

Returns a `Locker` whose `Lock`/`Unlock` methods call the receiver's `RLock`/`RUnlock`. Useful when a function expects a `sync.Locker` interface.

### `Locker` interface

```go
type Locker interface {
    Lock()
    Unlock()
}
```

`*Mutex` and `*RWMutex` both satisfy this interface (the latter via `Lock`/`Unlock` writer methods, or via `RLocker()` for reader methods).

---

## Formal Guarantees

### G1 — Mutual exclusion

For any `sync.Mutex` `m`, between any matched `m.Lock()` and `m.Unlock()` calls by goroutine G, no other goroutine has a successful `m.Lock()` returning to it.

### G2 — Eventual progress

If goroutine G calls `m.Lock()` and the mutex is held, G is blocked until the mutex is released. The Go runtime ensures that some goroutine waiting on the mutex eventually acquires it (no permanent starvation), provided the holder eventually unlocks.

### G3 — Memory ordering (Mutex)

For any `sync.Mutex` `m` and any positive integers n < m:
- The completion of the n'th `m.Unlock()` call is synchronized before the start of the m'th `m.Lock()` call's return.
- Equivalently: writes performed by the holder of the n'th lock are observable to the holder of any subsequent lock.

### G4 — Memory ordering (RWMutex)

For any `sync.RWMutex` `rw`:
- For any `rw.Lock()` returning, there is some n such that this `Lock()` is synchronized after the n'th `Unlock()` and before the (n+1)'th `Unlock()`.
- For any `rw.RLock()` returning, there is some n such that this `RLock()` is synchronized after the n'th `Unlock()` of the writer side; the matching `rw.RUnlock()` is synchronized before the (n+1)'th `Lock()`.

### G5 — Zero value usability

`var m sync.Mutex` is unlocked, ready for use, and obeys all guarantees above. Same for `sync.RWMutex`.

### G6 — No copy after first use

`sync.Mutex` and `sync.RWMutex` "must not be copied after first use." Copying is undefined behaviour. `go vet`'s `copylocks` check warns at compile time for the common patterns.

---

## Memory Model Statements

From <https://go.dev/ref/mem> (paraphrased):

> If the effect of an atomic operation A is observed by atomic operation B, then A is synchronized before B.

Mutex `Unlock` is treated as a release operation; subsequent `Lock` is treated as an acquire. This matches the C/C++ memory model's release/acquire semantics. Reads issued after `Lock` see all writes issued before any matching `Unlock`.

> For any call to RLock on a sync.RWMutex variable l, there is an n such that the n'th call to l.Unlock is synchronized before that call to RLock, and the matching call to RUnlock is synchronized before the (n+1)'th call to l.Lock.

This guarantees that readers under `RLock` see the state left by the most recent writer, and writers under `Lock` see the state left by all previous readers and writers.

---

## Implementation Constraints

The following are guarantees of the *current* Go implementation (as of Go 1.22) that user code may not rely on for correctness, but may rely on for performance reasoning:

- A `sync.Mutex` is 8 bytes.
- An uncontended `Lock`/`Unlock` pair completes with a single atomic CAS plus a single atomic Add — typically ≤ 30 ns on modern x86-64.
- Contended waiters are eventually parked using runtime semaphores; OS-level futex/ulock calls are made only when necessary.
- The mutex switches to "starvation mode" if a waiter has been waiting > 1ms, guaranteeing direct hand-off until the queue drains.
- `sync.RWMutex` supports up to `1 << 30` concurrent readers.

These numbers may change between Go releases.

---

## Errors and Panics

| Condition | Behaviour |
|-----------|-----------|
| `Unlock` on unlocked Mutex | `fatal error: sync: unlock of unlocked mutex` (non-recoverable) |
| `RUnlock` without matching `RLock` | `fatal error: sync: RUnlock of unlocked RWMutex` |
| Copying a `Mutex` or `RWMutex` after first use | undefined; `go vet` warns |
| `Lock` recursively in same goroutine | deadlock — runtime detects only if all goroutines are stuck |
| `Unlock` from a different goroutine than the locker | allowed by spec, but not the natural use; defer pattern won't apply |

---

## Compatibility Notes

- `TryLock`, `TryRLock` were added in Go 1.18. Pre-1.18 code cannot use them.
- The internal layout of `Mutex` has changed across Go versions (added the starvation bit in 1.9). External behaviour is unchanged.
- `sync.RWMutex` writer-preference behaviour was tightened in Go 1.18 to guarantee that a waiting writer is not indefinitely starved by a steady reader stream.

This document does not specify behaviour of related types `sync.Once`, `sync.WaitGroup`, `sync.Cond`, `sync.Pool`, `sync.Map`, or `sync/atomic` — see the individual sub-pages.
