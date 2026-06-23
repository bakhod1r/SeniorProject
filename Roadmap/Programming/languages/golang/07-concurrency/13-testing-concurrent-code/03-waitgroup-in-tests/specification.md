---
layout: default
title: WaitGroup in Tests — Specification
parent: WaitGroup in Tests
grand_parent: Testing Concurrent Code
nav_order: 5
permalink: /roadmap/programming-languages/golang/07-concurrency/13-testing-concurrent-code/03-waitgroup-in-tests/specification/
---

# WaitGroup in Tests — Specification

[← Back to WaitGroup in Tests](./)

## Table of Contents
1. [`sync.WaitGroup` — Authoritative API](#syncwaitgroup--authoritative-api)
2. [The Happens-Before Contract](#the-happens-before-contract)
3. [`Add` / `Wait` Ordering Rule](#add--wait-ordering-rule)
4. [`testing.T` Methods Restricted to the Test Goroutine](#testingt-methods-restricted-to-the-test-goroutine)
5. [`t.Cleanup` — Execution Order](#tcleanup--execution-order)
6. [`goleak` Contract](#goleak-contract)
7. [References](#references)
8. [Summary](#summary)

---

## `sync.WaitGroup` — Authoritative API

From `pkg/sync/waitgroup.go` (Go 1.22+):

```go
type WaitGroup struct {
    noCopy noCopy
    state1 atomic.Uint64
    state2 atomic.Uint32
}

func (wg *WaitGroup) Add(delta int)
func (wg *WaitGroup) Done()
func (wg *WaitGroup) Wait()
```

The official documentation states:

> A WaitGroup waits for a collection of goroutines to finish. The main goroutine calls Add to set the number of goroutines to wait for. Then each of the goroutines runs and calls Done when finished. At the same time, Wait can be used to block until all goroutines have finished.
>
> A WaitGroup must not be copied after first use.
>
> In the terminology of the Go memory model, a call to Done "synchronizes before" the return of any Wait call that it unblocks.

Three load-bearing sentences:

1. **`Add` precedes goroutines.** The caller sets the count first.
2. **No copying.** `go vet` enforces this via the `noCopy` marker.
3. **`Done` synchronizes-before the return of `Wait`.** This is the memory-ordering guarantee that makes barriers work in tests.

---

## The Happens-Before Contract

The Go memory model document at [go.dev/ref/mem](https://go.dev/ref/mem) contains the controlling clause:

> If `wg.Done()` is the call that decrements the counter to zero and there is a goroutine in `wg.Wait()`, then `wg.Done()` is synchronized before that `wg.Wait()`'s return.

Three consequences:

1. **Reads after `Wait` see writes before `Done`.** A goroutine that wrote `slice[i] = v` before calling `Done` is guaranteed to have that write visible to the caller of `Wait` once `Wait` returns.

2. **`Add(positive)` is not synchronised by anything but the caller's program order.** If two goroutines both call `Add(positive)` on the same group, the call sites must already be ordered (e.g., the first happens entirely in the test goroutine before the second is reachable).

3. **Multiple `Wait` callers.** All goroutines blocked in `Wait` unblock when the counter reaches zero. The synchronisation is one-to-many: every `Done` synchronizes-before every `Wait` return.

---

## `Add` / `Wait` Ordering Rule

The official rule (from the WaitGroup doc comment):

> Note that calls with a positive delta that occur when the counter is zero must happen before a Wait. Calls with a positive delta, or calls with a negative delta that start when the counter is greater than zero, may happen at any time.

Three parts:

- **Zero-to-positive Add must happen before Wait.** If the counter is currently zero and you `Add(positive)`, the call must complete before any `Wait` is observed.

- **Add when counter > 0 is unrestricted.** Spawning a child goroutine that increments the counter mid-flight is permitted, *as long as* the counter is already non-zero (the parent has not yet called Done).

- **Negative Add (Done) is unrestricted.** Done can happen any time, as long as the cumulative count stays non-negative.

In tests this rule reduces to one habit: **call `Add(N)` in the test goroutine before any `go`**.

The pathological pattern:

```go
// VIOLATES the rule
for i := 0; i < N; i++ {
    go func() {
        wg.Add(1)       // Add when counter could be 0
        defer wg.Done()
        ...
    }()
}
wg.Wait()
```

is exactly what the spec forbids. The race detector reports a data race; the program may also pass `Wait` early.

---

## `testing.T` Methods Restricted to the Test Goroutine

From `pkg/testing/testing.go`:

> A test ends when its Test function returns or calls any of the methods FailNow, Fatal, Fatalf, SkipNow, Skip, or Skipf. Those methods, as well as the Parallel method, must be called only from the goroutine running the Test function.

Affected methods: `FailNow`, `Fatal`, `Fatalf`, `SkipNow`, `Skip`, `Skipf`, `Parallel`.

The reason: these methods call `runtime.Goexit`, which terminates the *current* goroutine. From a spawned goroutine, that terminates the spawned goroutine; the test goroutine continues.

Safe from any goroutine: `Log`, `Logf`, `Error`, `Errorf`, `Fail`, `Helper`, `Cleanup`, `Name`.

Practical rule for spawned goroutines: use `t.Errorf` to mark the failure. Let the goroutine return normally. The test goroutine eventually sees the failure flag and reports the test as failed.

---

## `t.Cleanup` — Execution Order

The official contract:

> Cleanup registers a function to be called when the test (or subtest) and all its subtests complete. Cleanup functions will be called in last added, first called order.

Properties:

1. **LIFO order.** Cleanups added last run first.
2. **Called even after Fatal.** Cleanups run during test teardown regardless of pass/fail.
3. **Subtests cleanup first.** A subtest's cleanups run before the parent's.
4. **Runs in the test's goroutine context.** A cleanup that calls `t.Fatal` *does* terminate the test goroutine — but at this point the test is already ending, so the effect is "mark test failed and continue with remaining cleanups."

The interaction with `defer`:

- `defer`s in the test body run when the test function returns.
- Cleanups run after the test function returns, before the testing framework records the result.
- Therefore: **`defer` runs before `Cleanup`**, contrary to a common intuition.

This matters for `goleak`:

```go
defer goleak.VerifyNone(t)        // (1) runs FIRST
t.Cleanup(wg.Wait)                // (2) runs SECOND
```

`goleak.VerifyNone` sees the wg.Wait-blocking goroutine and reports it as a leak. To get the intended ordering, register `goleak` as a Cleanup:

```go
t.Cleanup(func() { goleak.VerifyNone(t) })   // runs LAST (registered first → popped last)
t.Cleanup(func() { cancel(); wg.Wait() })    // runs FIRST (registered later → popped first)
```

---

## `goleak` Contract

From `go.uber.org/goleak`:

> Package goleak provides tools to detect leaked goroutines in tests.

### Public API

```go
func Find(options ...Option) error
func VerifyNone(t TestingT, options ...Option)
func VerifyTestMain(m TestingM, options ...Option)
```

### What counts as a leak

Any goroutine present at the moment of `Find` whose top-of-stack function is not in the ignore list.

### Default ignore list

(Approximate, as of `goleak` v1.3.0; consult the source for the authoritative list.)

- `runtime.goexit`
- `runtime.gopark`
- Anything in `testing.RunTests`
- Anything in `runtime/trace.Start`
- The `signal_recv` goroutine
- `time.Sleep`'s timer-helper goroutine (when present)

### Retry

`Find` retries up to `maxRetryAttempts` (default 20) with `retryInterval` (default 100 ms) between attempts, to give shutting-down goroutines time to exit. Configurable via:

```go
goleak.VerifyNone(t,
    goleak.IgnoreTopFunction("..."),
    goleak.WithRetryAttempts(50),
    goleak.WithRetryInterval(50 * time.Millisecond),
)
```

### Caveats

- `goleak` cannot detect goroutines that are *about* to leak — it only sees goroutines that exist at the moment of `Find`. A goroutine spawned by `t.Cleanup` after `goleak.VerifyNone` is missed entirely.
- Heavy retry intervals slow down all tests in a package. Use sparingly.
- `runtime.NumGoroutine()` is similar in spirit but reports a count, not stacks. For diagnosis, `goleak` wins.

---

## References

- [pkg.go.dev — sync.WaitGroup](https://pkg.go.dev/sync#WaitGroup)
- [The Go Memory Model — go.dev/ref/mem](https://go.dev/ref/mem)
- [pkg.go.dev — testing.T](https://pkg.go.dev/testing#T)
- [pkg.go.dev — testing.T.Cleanup](https://pkg.go.dev/testing#T.Cleanup)
- [pkg.go.dev — testing.T.Helper](https://pkg.go.dev/testing#T.Helper)
- [pkg.go.dev — testing.T.Parallel](https://pkg.go.dev/testing#T.Parallel)
- [pkg.go.dev — go.uber.org/goleak](https://pkg.go.dev/go.uber.org/goleak)
- [pkg.go.dev — golang.org/x/sync/errgroup](https://pkg.go.dev/golang.org/x/sync/errgroup)
- [pkg.go.dev — testing/synctest (Go 1.24+)](https://pkg.go.dev/testing/synctest)
- [Go source — src/sync/waitgroup.go](https://github.com/golang/go/blob/master/src/sync/waitgroup.go)

---

## Summary

The spec for WaitGroup-in-tests is short and rigid:

1. `Add(positive)` from zero must happen-before any `Wait`.
2. `Done` synchronizes-before `Wait`'s return — the property tests depend on.
3. `t.Fatal` and friends terminate only the calling goroutine; never call them outside the test goroutine.
4. `t.Cleanup` is LIFO and runs *after* `defer`s in the test function.
5. `goleak` reports goroutines present at the moment of inspection, with a small retry budget for orderly shutdown.

Every helper, harness, and pattern in this subsection is built on these five rules. Internalise them and concurrent tests stop being mysterious.
