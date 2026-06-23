---
layout: default
title: sync.OnceFunc — Specification
parent: sync.OnceFunc/OnceValue/OnceValues
grand_parent: Modern Concurrency Features
ancestor: Go
nav_order: 4
has_children: false
permalink: /roadmap/programming-languages/golang/07-concurrency/25-modern-features/01-sync-oncefunc/specification/
---

# sync.OnceFunc — Specification

[← Back](../)

## Origin: proposal #56102

The helpers were added by accepted proposal [#56102](https://github.com/golang/go/issues/56102), "sync: add OnceFunc, OnceValue, OnceValues", filed by Russ Cox on 2022-10-04 and accepted on 2023-01-25. The proposal text observes that `sync.Once` is "almost always used in one of three highly stereotyped ways" — to call a function, to compute one value lazily, or to compute two values (a value and an error) lazily — and that each of these patterns deserves direct support. The implementation landed in CL 451356 and shipped in Go 1.21 (August 2023).

The proposal also fixed a long-standing footgun in `sync.Once.Do`: if the user function panics, `Do` marks the `Once` as done and returns, so the next caller silently skips the function as if it had succeeded. The new helpers explicitly do not do this. They store the panic value, mark themselves as done, and re-panic with the same value on every subsequent call. This matches user intent ("if init failed, every caller should see that it failed") and is documented as part of the API contract.

## Godoc — sync.OnceFunc

Verbatim from `src/sync/oncefunc.go` in Go 1.21:

```
// OnceFunc returns a function that invokes f only once. The returned function
// may be called concurrently.
//
// If f panics, the returned function will panic with the same value on every call.
func OnceFunc(f func()) func()
```

The wrapper takes no arguments and returns nothing. After the first call, the captured `f` is dropped (set to `nil`) so that any state it closes over becomes eligible for garbage collection. The wrapper itself is safe to call from many goroutines; only one of them will execute `f`, and the others block on a `sync.Once` inside the wrapper until that first call completes.

## Godoc — sync.OnceValue

```
// OnceValue returns a function that invokes f only once and returns the value
// returned by f. The returned function may be called concurrently.
//
// If f panics, the returned function will panic with the same value on every call.
func OnceValue[T any](f func() T) func() T
```

The single returned value is captured the first time `f` runs and returned by every subsequent call. If `T` is a pointer or interface type, the same pointer is returned every time — callers share state. If `T` is a value type (a struct, an int), every call returns a copy of the captured value.

## Godoc — sync.OnceValues

```
// OnceValues returns a function that invokes f only once and returns the values
// returned by f. The returned function may be called concurrently.
//
// If f panics, the returned function will panic with the same value on every call.
func OnceValues[T1, T2 any](f func() (T1, T2)) func() (T1, T2)
```

This shape was added specifically to cover the `(T, error)` idiom, which is by far the most common multi-return signature in Go. There is intentionally no `OnceValues3` or `OnceValues4` — if you need more, the suggestion in the proposal is to pack into a struct and use `OnceValue[Struct]`.

## Reference implementation

The implementation in `src/sync/oncefunc.go` is small enough to read in full:

```go
func OnceFunc(f func()) func() {
    var (
        once  Once
        valid bool
        p     any
    )
    // Construct the inner function just once, to allocate less.
    g := func() {
        defer func() {
            p = recover()
            if !valid {
                // Re-panic immediately so on the first call the user gets a
                // complete stack trace into f.
                panic(p)
            }
        }()
        f()
        f = nil      // Do not keep f alive after invoking it.
        valid = true // Set only if f did not panic.
    }
    return func() {
        once.Do(g)
        if !valid {
            panic(p)
        }
    }
}
```

Three details matter:

1. **`f = nil` after success.** Once the wrapper has finished its successful first call, the closure no longer holds a reference to the user's `f`, so anything `f` captured can be collected.
2. **`valid` flag.** It distinguishes "f ran successfully" from "f panicked". Without it, the next call would have no way to know whether to re-panic.
3. **First-call double-panic.** Inside `g`, if `f` panics, the deferred recover saves `p` and then immediately re-panics. That re-panic propagates out of `once.Do` on the very first call so that the first caller gets a full stack trace into `f`. Later calls hit the `if !valid` branch in the outer function and panic with the saved `p` — they get the value but not the stack.

`OnceValue` and `OnceValues` follow the same shape, with an additional captured variable for the return value(s).

## Panic-reuse contract

The contract is precise:

- If `f` returns normally, every subsequent call returns the cached value(s) (for `OnceValue`/`OnceValues`) or returns immediately (for `OnceFunc`).
- If `f` panics, every subsequent call panics with the same value (`==` to the original `recover()` result).
- The panic value is captured *after* `recover()`, so it is the value that was passed to `panic`, not a wrapped error.
- The first call's panic carries a stack trace into `f`. Subsequent calls' panics do not — they re-panic at the wrapper's outer `panic(p)` site.

This is the single largest behavioral change from `sync.Once.Do`, and it is the reason the helpers exist as a separate API rather than as methods on `sync.Once`.

## Concurrent calls

The wrapper is safe to call from any number of goroutines simultaneously. Internally each helper holds exactly one `sync.Once`, and `sync.Once.Do` provides the standard guarantee: all callers see the function complete (or panic) before `Do` returns. There is a single memory-model edge here — a `happens-before` from the completion of `f` to the return of every subsequent wrapper call — which is exactly what `sync.Once` already provides. The Go memory model section "Once" applies unchanged.

## GC implications

After a successful first call, the wrapper holds:

- The `sync.Once` (≈ 12 bytes on 64-bit).
- The `valid` bool and the `p any` slot (24 bytes).
- For `OnceValue`/`OnceValues`, the captured return value(s).
- A `nil` slot where `f` used to be.

It no longer holds any reference to the original function or anything it captured. So if you do:

```go
load := sync.OnceValue(func() *bigStruct {
    return loadFromDisk("config.bin") // ~10 MB
})
cfg := load()
```

…then everything `loadFromDisk` allocated internally (file handles, temporary buffers, the closure environment) is released after `load()` returns. Only the returned `*bigStruct` is retained, through `cfg`. If `f` panics, however, `f` itself is retained — the implementation sets `f = nil` only on the success path, immediately before `valid = true`. Panicking initializers therefore have slightly worse GC behavior than successful ones; in practice this is irrelevant because panicking programs do not run long enough to care.

## What is not provided

Three things were considered and rejected in the proposal discussion:

- **No `Reset`.** There is no way to clear a `OnceFunc` and run it again. If you need that, use a `sync.Mutex` + a `bool` flag, or `atomic.Bool`.
- **No timeout / context.** The wrapper has the same signature as the wrapped function, so it cannot accept a `context.Context` unless `f` already takes one — and even then, the first caller's context governs the entire init, which is rarely what later callers want.
- **No error return on the wrapper itself.** The pattern is "capture errors inside the closure and return them" — that is what `OnceValues[T, error]` is for.

## Version guard

These functions are in `sync` only from Go 1.21. If you must compile on older Go versions, use a build tag:

```go
//go:build go1.21

package mypkg

var load = sync.OnceValue(loadConfig)
```

…and provide a `sync.Once`-based fallback in a sibling file with `//go:build !go1.21`.

## Memory model statement

The Go memory model (https://go.dev/ref/mem) discusses `sync.Once` directly:

> The completion of a single call of `once.Do(f)` is synchronized before the return of any call of `once.Do(f)`.

Because `sync.OnceFunc`, `sync.OnceValue`, and `sync.OnceValues` are implemented in terms of `sync.Once`, the same statement applies to the wrappers: the completion of the wrapped function `f` is synchronized before the return of any call to the wrapper. This means writes performed inside `f` are visible to any goroutine that has called the wrapper, with no further synchronization required.

Formally, for `wrap := sync.OnceFunc(f)`:

- The execution of `f` happens-before the return of every call to `wrap()`.
- All goroutines that have called `wrap()` agree on the side effects of `f` and on the return values (for `OnceValue`/`OnceValues`).
- The wrapper's internal `valid` flag and `p` slot are written exactly once (during the first call's deferred handler) and read on every subsequent call; the happens-before edge from `sync.Once` ensures this is race-free without additional atomics.

## Comparison with sync.Once contract

The two contracts side by side:

| Property | `sync.Once.Do(f)` | `sync.OnceFunc(f)()` |
|---|---|---|
| `f` runs exactly once | Yes | Yes |
| Concurrent calls block until `f` completes | Yes | Yes |
| Happens-before from `f` to subsequent calls | Yes | Yes |
| If `f` panics, first caller observes panic | Yes | Yes |
| If `f` panics, second caller re-panics | **No** (silently returns) | **Yes** |
| `f` reference dropped after success | No | Yes |
| Caller can pass new `f` later | Yes (by passing a different function) | No (the wrapper is fixed) |

The two differences in bold are the substantive behavior changes that the new helpers introduce. The "drop reference" line is the GC-friendliness improvement.

## Source-level constraints

A few subtle properties enforced by the implementation:

- **`f` must not be nil.** The implementation does not check; you'll get a nil-pointer dereference on the first call. Document or assert at the call site.
- **The returned wrapper must not be nil.** `sync.OnceFunc` always returns a non-nil function.
- **The wrapper is not comparable with other wrappers.** Go function values are not comparable except to `nil`. `if wrapA == wrapB` is a compile error.
- **The wrapper is goroutine-safe.** Pass it freely.

## Generic constraints

`OnceValue[T]` and `OnceValues[T1, T2]` are constrained by `any`. There is no constraint requiring `T` to be comparable, hashable, copyable in any special way, etc. The implementation captures `T` (or `(T1, T2)`) by value in a closure slot and returns it.

If `T` itself contains non-copyable members (a `sync.Mutex`, for example), copying the slot on every call is a *correctness* issue — copying a locked mutex is undefined. In practice, this is only a problem if you do something like:

```go
var get = sync.OnceValue(func() sync.Mutex { return sync.Mutex{} })
```

…which is meaningless anyway. Use `OnceValue[*sync.Mutex]` if you want a shared mutex.

## Inlining and escape analysis

The wrappers' returned functions are normal closures. The Go compiler (1.21+) can inline the `if !valid { panic(p) }` outer wrapper but not the `once.Do(g)` call (because `sync.Once.Do` has a slow path involving a mutex). The closure environment escapes to the heap because the wrapper outlives `OnceFunc`'s stack frame. This is the one mandatory allocation.

## Implementation file location

The source lives at `src/sync/oncefunc.go` in the Go repository. The file is approximately 90 lines and contains all three functions plus their doc comments. It depends only on `sync.Once`, which lives in `src/sync/once.go`.

## Tests

The test file `src/sync/oncefunc_test.go` covers:

- Single-call behavior (`TestOnceFunc`, `TestOnceValue`, `TestOnceValues`).
- Concurrent callers (via `go test -race`).
- Panic-reuse (`TestOnceXGC` and related — verifying that the wrapped `f` is collectable after success).
- Panic propagation (the first call's stack trace is preserved into `f`).

Reading the test file is a good way to internalize the contract — every documented behavior has a corresponding test, written in plain Go.

## Related proposals and history

The accepted proposal was preceded by community discussion across several years:

- **2018:** Multiple third-party libraries (e.g., `github.com/sasha-s/go-once`, `github.com/pkg/once`) introduced helpers that wrapped `sync.Once` to return values. None gained wide adoption.
- **2020:** Discussion in golang-dev about whether to add `sync.Once.DoErr` returning an `error`. Rejected; the dual signatures were considered too narrow.
- **October 2022:** Issue #56102 filed with the three-helper proposal.
- **January 2023:** Proposal accepted.
- **March 2023:** CL 451356 lands implementation.
- **August 2023:** Go 1.21 ships.

The pre-existing third-party packages still exist but are largely superseded by the stdlib helpers.

## Compatibility guarantees

Because these functions are in `sync`, they are covered by Go's compatibility promise. The signatures will not change in any 1.x release. The behavior (including the panic-reuse contract) is part of the API contract and will not be silently changed. New helpers may be added in future releases — `OnceValues3` was discussed but rejected, so it's unlikely without strong demand.

## Interaction with `go vet`

`go vet` does not flag misuse of these helpers as of Go 1.22. There is no built-in check for "OnceValue called inside a loop" or "OnceValue's f panics with a non-error value". If you want such checks, write a custom `golangci-lint` rule or use `staticcheck`'s analysis API.

## How they compare to the `lazy` libraries in other languages

A few other languages have similar primitives:

- **Kotlin:** `lazy(LazyThreadSafetyMode.SYNCHRONIZED) { ... }` is functionally identical to `sync.OnceValue`.
- **C#:** `Lazy<T>` with `LazyThreadSafetyMode.ExecutionAndPublication`. Same semantics.
- **Rust:** `std::sync::OnceLock<T>` (stabilized in 1.70) is close, though it exposes more state (`get()`, `set()`, `get_or_init()`).
- **Python:** `functools.cached_property` is the per-instance form; there's no built-in module-level lazy initializer with the same contract.

The Go helpers are deliberately minimal — just the function form, no state inspection, no reset, no manual set. The minimalism is part of the design.
