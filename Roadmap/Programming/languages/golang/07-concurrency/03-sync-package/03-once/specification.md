---
layout: default
title: sync.Once — Specification
parent: sync.Once
grand_parent: sync Package
nav_order: 5
permalink: /roadmap/programming-languages/golang/07-concurrency/03-sync-package/03-once/specification/
---

# sync.Once — Specification

← Back to sync.Once

The formal contract of `sync.Once` as documented in the Go standard library, the Go memory model, and the proposals that introduced the Go 1.21 helpers.

---

## 1. Package summary

`sync.Once` is declared in the `sync` package of the Go standard library:

```
package sync // import "sync"
```

It has been part of the standard library since Go 1.0 (March 2012). The API has remained stable; only the internal implementation has been polished.

---

## 2. Type declaration

```go
type Once struct {
    // contains filtered or unexported fields
}
```

From the Go documentation:

> "Once is an object that will perform exactly one action.
>  A Once must not be copied after first use."

Key claims:

- The zero value is ready to use.
- The struct must not be copied after first use (enforced via `noCopy` checked by `go vet`).
- Concurrent calls to `Do` are safe.

---

## 3. Method: `Do`

```go
func (o *Once) Do(f func())
```

Documented contract:

> "Do calls the function f if and only if Do is being called for the first time for this instance of Once. In other words, given
>
> ```
> var once Once
> ```
>
> if once.Do(f) is called multiple times, only the first call will invoke f, even if f has a different value in each invocation. A new instance of Once is required for each function to execute.
>
> Do is intended for initialization that must be run exactly once. Since f is niladic, it may be necessary to use a function literal to capture the arguments to a function to be called by Do:
>
> ```
> config.once.Do(func() { config.init(filename) })
> ```
>
> Because no call to Do returns until the one call to f returns, if f causes Do to be called, it will deadlock.
>
> If f panics, Do considers it to have returned; future calls of Do return without calling f."

Six explicit guarantees:

1. **At-most-once execution**: `f` runs zero or one time per `Once` value.
2. **Function identity ignored**: only the *first* `Do` call's `f` matters. Later calls' `f` arguments are discarded.
3. **Per-instance**: different `Once` values are independent. To run two functions once each, use two `Once`s.
4. **Niladic argument**: `f` is `func()`. Wrap with a closure to capture state.
5. **Blocking**: `Do` does not return until `f` has fully returned. All callers wait.
6. **Panic is completion**: a panicking `f` marks the `Once` done. Future `Do` calls are no-ops.
7. **Recursive `Do` deadlocks**: calling `Do` from inside the `f` of the same `Once` is undefined-ish (in practice: deadlock).

---

## 4. Memory model guarantee

From the Go memory model (<https://go.dev/ref/mem>):

> "The completion of a single call of f() from once.Do(f) is synchronized before the return of any call of once.Do(f)."

Translation:

- Any writes performed inside `f` happen-before the return of every `Do` call (including the first).
- A reader that calls `Do` after the first call sees a fully-initialised result without further synchronisation.
- This is the same "synchronised before" relation that mutex unlock/lock and channel send/receive establish.

This is the formal justification for using `Once` to build lazy singletons that are read concurrently.

---

## 5. Copy semantics

From the source's `noCopy` marker:

```go
type Once struct {
    done atomic.Uint32
    m    Mutex
}
```

`Mutex` contains a `noCopy` field (`sync.noCopy` is a marker type recognised by `go vet`). Therefore `Once` transitively contains it. Copying a `Once` after use triggers a `go vet` warning:

```
sync.Once contains sync.noCopy
```

The runtime does not enforce the no-copy rule — code that copies still compiles and runs. The consequences are undefined; in practice, the copy has its own `done` flag and may run `f` again.

---

## 6. Subtypes added in Go 1.21

### 6.1 `OnceFunc`

```go
func OnceFunc(f func()) func()
```

Documentation:

> "OnceFunc returns a function that invokes f only once. The returned function may be called concurrently.
>
> If f panics, the returned function will panic with the same value on every call."

### 6.2 `OnceValue`

```go
func OnceValue[T any](f func() T) func() T
```

Documentation:

> "OnceValue returns a function that invokes f only once and returns the value returned by f. The returned function may be called concurrently.
>
> If f panics, the returned function will panic with the same value on every call."

### 6.3 `OnceValues`

```go
func OnceValues[T1, T2 any](f func() (T1, T2)) func() (T1, T2)
```

Documentation:

> "OnceValues returns a function that invokes f only once and returns the values returned by f. The returned function may be called concurrently.
>
> If f panics, the returned function will panic with the same value on every call."

All three:

- Return a function that wraps a private `sync.Once` plus storage for return values.
- Are safe for concurrent use of the returned function.
- Treat panics differently from raw `Once`: they **re-panic on every subsequent call** with the same panic value, instead of silently no-op'ing.
- Release the captured `f` (and its closure) for garbage collection after the first successful call.

---

## 7. The proposal documents

The 1.21 helpers were added per Go proposal #56102 (<https://github.com/golang/go/issues/56102>). Highlights from the proposal:

- Motivation: the three-variable `var once + var val + var err` pattern is verbose and error-prone.
- Rationale for re-panic: matches user expectation that "a failure should be observable to all callers, not just the unlucky first one."
- Rationale for GC release: long-lived `Once` values with large captured closures held memory that could be released.

The proposal was accepted in 2023 and shipped in Go 1.21 (August 2023).

---

## 8. Stability and compatibility

`sync.Once` was added in Go 1.0. Its API has not changed. Its behaviour has not changed. Code that used `Once` correctly in 2012 still works in 2026.

The 1.21 helpers (`OnceFunc`, `OnceValue`, `OnceValues`) are additive. They do not affect existing `Once` users. Code that uses them requires Go 1.21+.

The Go 1 compatibility promise applies to all four APIs: future Go versions will not break them.

---

## 9. Performance characteristics (documented)

The standard library does not document specific timing guarantees, but the implementation has the following observable properties:

- **Fast path**: a single atomic load, followed by a branch. O(1), wait-free, no allocation.
- **Slow path on first call**: a mutex acquire, one atomic load, one function call (`f`), one atomic store, one mutex release. O(1) overhead plus `f`'s cost.
- **Slow path under contention**: late callers acquire the same mutex sequentially, observe `done == 1`, return. Each pays mutex acquisition cost (typically <1µs).
- **Memory**: 16–24 bytes per `Once` value (architecture-dependent).

---

## 10. Behaviour under specific scenarios

### `Do(nil)`

Calling `Do(nil)` panics inside `f` (nil function dereference). Since panic counts as completion, the `Once` is permanently done. Future calls are no-ops.

### `Do` from a goroutine that holds an unrelated lock

No interaction. `Once.Do` does not interact with external mutexes. The slow path acquires its own internal mutex.

### `Do` when `f` spawns goroutines

The spawned goroutines are unrelated to `Once`. `Do` returns when `f` returns, regardless of whether spawned goroutines have completed. Use `WaitGroup` inside `f` if synchronisation is required.

### `Do` when `f` blocks forever

`Do` blocks forever. All concurrent `Do` callers also block forever. The deadlock detector may notice if no other goroutines are runnable.

### `Do` after a panicking `f`

`f` ran (and panicked), so `done == 1`. Subsequent `Do` calls are no-ops. The state set by `f` before panicking remains (whatever was assigned to captured variables).

### `Do` with `f` that calls runtime.Goexit

`runtime.Goexit` terminates the current goroutine without panicking. Inside a `Do`, this is treated the same as panic: the deferred `store(1)` runs, `done = 1`, the goroutine exits. Subsequent `Do` calls are no-ops.

---

## 11. Relationship to `sync.Mutex`

`Once` is implemented in terms of `sync.Mutex` + an atomic flag. It is not a primitive in its own right at the runtime level. However, the standard library treats it as one for API stability: a future implementation could swap the mutex for a different mechanism without breaking callers.

`sync.Mutex` documentation: <https://pkg.go.dev/sync#Mutex>.

---

## 12. Relationship to language `init` functions

Go specification, *Package initialization*:

> "Package initialization—variable initialization and the invocation of init functions—happens in a single goroutine, sequentially, one package at a time."

Differences from `Once`:

- `init` runs at program startup; `Once` runs on first call.
- `init` runs single-threaded; `Once` runs in whatever goroutine first reached `Do`.
- `init` cannot be conditional (it always runs); `Once` runs only if `Do` is called.
- `init` cannot return errors; neither can `Once.Do`, but `OnceValues` can.

---

## 13. References

### Standard library documentation

- `sync.Once`: <https://pkg.go.dev/sync#Once>
- `sync.OnceFunc`, `OnceValue`, `OnceValues`: <https://pkg.go.dev/sync#OnceFunc>
- `sync.Mutex`: <https://pkg.go.dev/sync#Mutex>
- `sync` package overview: <https://pkg.go.dev/sync>

### Language specification

- Go Memory Model: <https://go.dev/ref/mem>
- Package initialization: <https://go.dev/ref/spec#Package_initialization>
- `init` function: <https://go.dev/ref/spec#Program_initialization>

### Proposals

- #56102 — Add `sync.OnceFunc`, `OnceValue`, `OnceValues`: <https://github.com/golang/go/issues/56102>
- Go 1.21 release notes: <https://go.dev/doc/go1.21>

### Source

- `src/sync/once.go` (Go 1.22): <https://github.com/golang/go/blob/master/src/sync/once.go>
- `src/sync/oncefunc.go` (Go 1.22): <https://github.com/golang/go/blob/master/src/sync/oncefunc.go>

### Related blog posts

- Russ Cox, *The Go Memory Model* (background on synchronization): <https://research.swtch.com/gomm>
- Go Blog, *Go 1.21*: <https://go.dev/blog/go1.21>

### Cross-language references

- POSIX `pthread_once`: <https://pubs.opengroup.org/onlinepubs/9699919799/functions/pthread_once.html>
- C++ `std::call_once`: <https://en.cppreference.com/w/cpp/thread/call_once>
- Rust `std::sync::Once`: <https://doc.rust-lang.org/std/sync/struct.Once.html>
- Java double-checked locking pitfalls: <https://www.cs.umd.edu/~pugh/java/memoryModel/DoubleCheckedLocking.html>

---

## 14. Summary

The formal contract of `sync.Once`:

- **One method**: `Do(f func())`.
- **Exactly-once execution** of the first `f` argument, for the lifetime of the `Once` value.
- **Concurrent-safe**: any number of goroutines may call `Do`.
- **Blocking**: all callers wait until `f` returns.
- **Happens-before guarantee**: writes in `f` are visible to all subsequent callers without extra synchronisation.
- **Panic counts as completion**: future calls are no-ops.
- **No copy after use**: enforced by `go vet`.
- **Stable since Go 1.0**.

The Go 1.21 additions:

- `OnceFunc(f)` returns a wrapped one-shot function.
- `OnceValue(f)` returns a one-shot function caching one return value.
- `OnceValues(f)` returns a one-shot function caching two return values.
- All three re-panic on subsequent calls if the first call panicked.
- All three release the captured `f` for GC after success.

These are the contract surfaces you can rely on across Go versions and across all supported architectures.
