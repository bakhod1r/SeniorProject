# singleflight — Specification

## Table of Contents
1. [Scope](#scope)
2. [Notation](#notation)
3. [Group Contract](#group-contract)
4. [Do Contract](#do-contract)
5. [DoChan Contract](#dochan-contract)
6. [Forget Contract](#forget-contract)
7. [Happens-Before Edges](#happens-before-edges)
8. [Shared Flag Semantics](#shared-flag-semantics)
9. [Error and Panic Semantics](#error-and-panic-semantics)
10. [Cancellation Non-Semantics](#cancellation-non-semantics)
11. [Conformance Tests](#conformance-tests)
12. [Non-Requirements](#non-requirements)

---

## Scope

This document specifies the contract a coalescing group must satisfy to be considered a correct implementation of `singleflight.Group`. It does not prescribe a particular implementation. Two implementations with identical observable behaviour for all conforming programs are equivalent.

The specified surface is the public API of `golang.org/x/sync/singleflight`:

- Type `Group`.
- Type `Result` with fields `Val interface{}`, `Err error`, `Shared bool`.
- Method `Group.Do(key string, fn func() (interface{}, error)) (interface{}, error, bool)`.
- Method `Group.DoChan(key string, fn func() (interface{}, error)) <-chan Result`.
- Method `Group.Forget(key string)`.

Internal types and helpers are out of scope. The shape of `panicError` and the use of `runtime.Goexit` are implementation details, not part of the contract.

---

## Notation

- `G` is a `Group`.
- `K` is a string key.
- `F` is a loader function with signature `func() (interface{}, error)`.
- An *active call* for `K` in `G` is a `Do` or `DoChan` invocation whose corresponding `F` has been entered (line of code in `F` has executed) and has not yet returned.
- The *window* of an active call is the interval `[fn_enter, fn_exit]` plus the cleanup that follows. Two calls are *concurrent* if their windows overlap.
- "happens-before" (`hb`) is the partial order of the Go memory model.

---

## Group Contract

**G1 (Zero value usable).** The zero value of `Group` is ready for use. No constructor is required, no initialisation is needed before first use.

**G2 (Concurrency safety).** All methods of `Group` are safe for concurrent use by multiple goroutines.

**G3 (Independence).** Two distinct `Group` values do not interact. Calls on `G1` have no effect on calls or state in `G2`, even if they use the same key.

**G4 (No global state).** The package introduces no process-global state. All state is per-`Group`.

---

## Do Contract

**D1 (Single execution per window).** Given concurrent invocations `G.Do(K, F1), G.Do(K, F2), ...`, where all invocations begin while there is an active call for `K` in `G`, exactly one of the `Fi` shall be entered. The other invocations shall not enter their respective `Fi`.

**D2 (First caller wins).** The `Fi` that is entered is the one passed by the invocation whose registration of an internal call record for `K` happens-before any other concurrent registration. Implementations may use any synchronisation primitive to achieve this.

**D3 (Shared result).** All concurrent invocations of `G.Do(K, *)` whose windows overlap with the active call's window shall return the same `(v, err)` pair.

**D4 (Shared flag).** The third return value of `G.Do(K, F)` is `true` if and only if `(v, err)` was returned to more than one invocation of `G.Do(K, *)` (counting the present invocation).

**D5 (Result lifetime).** After all concurrent waiters have been served, the internal record for `K` shall be removed. A subsequent invocation of `G.Do(K, F')` after the removal shall execute `F'`.

**D6 (No replay).** An invocation `G.Do(K, F)` that arrives after the window of a previous call has closed shall enter `F` and execute it. The previous call's result is not replayed.

**D7 (Blocking semantics).** `G.Do` is a blocking call. It returns only after the loader has produced a result (either its own loader or the shared loader's).

**D8 (No deadlock with self-call).** If `F`, while executing, calls `G.Do(K, F)` (same key, same group), the inner call must not deadlock by waiting on the outer call. Implementations may detect this and behave in one of three ways:
- Execute `F` again (re-entrant).
- Return an error.
- Document the behaviour as undefined.

This specification permits any of these behaviours; portable code shall not rely on a specific outcome. In practice, the reference implementation deadlocks. Do not call `Do` for the same key from within its own loader.

---

## DoChan Contract

**C1 (Channel return).** `G.DoChan(K, F)` shall return a receive-only channel of `Result`.

**C2 (Single send).** The returned channel shall receive exactly one `Result` value before being either closed or left with no further sends. The reference implementation leaves the channel without closing after the single send.

**C3 (Non-blocking caller).** `G.DoChan(K, F)` shall not block beyond the time required for internal bookkeeping.

**C4 (Coalescing).** If a call for `K` is active when `G.DoChan(K, F)` is invoked, `F` shall not be entered. The returned channel shall receive the result of the active call.

**C5 (No effect on cleanup).** The receiver of the returned channel is permitted to not read from it. Implementations shall guarantee no goroutine leak in that case: the loader goroutine sends to a buffered channel and exits regardless of whether the receiver reads.

**C6 (Fan-out fairness).** When the active call completes, every channel registered against it shall receive the result. The order in which channels receive is not specified.

---

## Forget Contract

**F1 (Idempotent removal).** `G.Forget(K)` shall remove the internal record for `K` if one exists. If no record exists, the call is a no-op.

**F2 (Does not cancel).** `G.Forget(K)` shall not cancel or otherwise affect an active call for `K`. The active loader runs to completion.

**F3 (Does not affect existing waiters).** Goroutines that have already begun waiting on the call for `K` (whether via `Do` or `DoChan`) shall still receive the active call's result.

**F4 (Fresh start for future callers).** After `G.Forget(K)` has been observed, the next invocation of `G.Do(K, F')` or `G.DoChan(K, F')` shall enter `F'` and shall not coalesce with the previous active call.

---

## Happens-Before Edges

Let `F` be the loader for an active call producing result `(v, err)`. Let `W` be any invocation of `G.Do(K, *)` or `G.DoChan(K, *)` that observes `(v, err)`.

**HB1 (Loader-to-Caller).** The end of `F`'s execution happens-before the return of `W` (for `Do`) or the receive on the channel returned by `W` (for `DoChan`).

**HB2 (Caller-to-Loader for first caller).** The invocation of `G.Do` or `G.DoChan` by the first caller happens-before the entry of `F`.

**HB3 (Late arrival ordering).** A waiter `W` whose invocation happens-after the registration of the active call's record observes the active call's result. A waiter whose invocation happens-before the registration enters its own loader.

These edges are sufficient to use the result of `F` without further synchronisation. In particular, fields of a struct returned from `F` are safe to read from any waiter without additional synchronisation, provided they are not subsequently mutated.

---

## Shared Flag Semantics

**S1 (Definition).** `Shared` is `true` for a particular return iff at least two distinct invocations of `Do` or `DoChan` (counted together) received that exact `(v, err)`.

**S2 (Visible to all sharers).** When `Shared` is `true`, every receiver of `(v, err)` sees `Shared == true`. The flag is symmetric.

**S3 (No reliable order signal).** `Shared` is `false` for the first caller iff no waiter joined; it is `true` if any waiter joined. The flag does not signal *which* caller was first.

---

## Error and Panic Semantics

**E1 (Error propagation).** If `F` returns `(_, err)` with `err != nil`, every waiter on the active call receives the same `err` (by value, not by deep copy).

**E2 (Panic propagation).** If `F` panics with value `p`, every waiter on the active call receives a panic. The packaged panic value may be wrapped by the implementation; portable code shall treat the recovered value as opaque except to log it.

**E3 (Goexit recovery).** If `F` exits via `runtime.Goexit`, the implementation shall convert this into an observable failure for every waiter. The reference implementation re-runs `Goexit` from each waiter's goroutine. Portable code shall not depend on the specific mechanism.

**E4 (No partial result).** A waiter shall never receive a `(v, err)` pair that was not produced by `F`'s `return` statement. In particular, on panic, `v` shall be `nil` (or the zero value of the type, if a typed wrapper is used).

---

## Cancellation Non-Semantics

**N1 (No context parameter).** The methods of `Group` do not accept a `context.Context`. Loaders cannot be cancelled by callers.

**N2 (Caller walk-away).** A caller of `DoChan` that does not read the returned channel does not affect the loader's execution. The loader runs to completion.

**N3 (No timeouts).** The package provides no built-in timeout. Bounded execution is the loader's responsibility.

**N4 (No retries).** The package provides no retry semantics. Retry is the caller's responsibility.

---

## Conformance Tests

A conformant implementation shall pass tests of the following shapes.

### Test C1: Single execution under burst

```go
func TestConformance_SingleExecution(t *testing.T) {
    var g Group
    var calls int32
    fn := func() (interface{}, error) {
        atomic.AddInt32(&calls, 1)
        time.Sleep(20 * time.Millisecond)
        return 42, nil
    }
    var wg sync.WaitGroup
    for i := 0; i < 50; i++ {
        wg.Add(1)
        go func() {
            defer wg.Done()
            v, err, _ := g.Do("k", fn)
            if v != 42 || err != nil {
                t.Fatal("bad result")
            }
        }()
    }
    wg.Wait()
    if atomic.LoadInt32(&calls) != 1 {
        t.Fatalf("expected 1 call, got %d", calls)
    }
}
```

### Test C2: Shared flag

```go
func TestConformance_SharedFlag(t *testing.T) {
    var g Group
    started := make(chan struct{})
    proceed := make(chan struct{})
    fn := func() (interface{}, error) {
        close(started)
        <-proceed
        return 1, nil
    }
    var aShared bool
    aDone := make(chan struct{})
    go func() { _, _, aShared = g.Do("k", fn); close(aDone) }()
    <-started
    _, _, bShared := g.Do("k", fn)
    close(proceed)
    <-aDone
    if !aShared || !bShared {
        t.Fatalf("expected both shared, got a=%v b=%v", aShared, bShared)
    }
}
```

Note: the second `Do` blocks on the active call. We close `proceed` *after* the second `Do` registers — but we need the second `Do` registration to happen before we close. In practice this test is racy in spirit; a robust version uses synchronisation between the second Do registration and the `close(proceed)` step.

### Test C3: No replay

```go
func TestConformance_NoReplay(t *testing.T) {
    var g Group
    var calls int32
    fn := func() (interface{}, error) {
        atomic.AddInt32(&calls, 1)
        return "v", nil
    }
    g.Do("k", fn)
    g.Do("k", fn)
    if got := atomic.LoadInt32(&calls); got != 2 {
        t.Fatalf("expected 2 calls, got %d", got)
    }
}
```

### Test C4: Forget releases coalescing for future callers

```go
func TestConformance_Forget(t *testing.T) {
    var g Group
    var calls int32
    started := make(chan struct{})
    fn := func() (interface{}, error) {
        atomic.AddInt32(&calls, 1)
        close(started)
        time.Sleep(100 * time.Millisecond)
        return "v", nil
    }
    go g.Do("k", fn)
    <-started
    g.Forget("k")
    g.Do("k", fn)
    if got := atomic.LoadInt32(&calls); got != 2 {
        t.Fatalf("expected 2 calls (forget broke coalescing), got %d", got)
    }
}
```

---

## Non-Requirements

The following are *not* required of a conforming implementation:

- **Fairness.** The order in which waiters are unblocked is not specified.
- **Memory bounds.** No upper bound on internal state size.
- **Loader cancellation.** Cancellation is explicitly not provided.
- **Result caching across windows.** The package is a coalescer, not a cache.
- **Key normalisation.** Keys are compared by string equality. No trimming, case folding, or canonical form.
- **Stable shared flag for the executor.** The executor sees `Shared=true` if at least one waiter joined; otherwise `false`. The flag does not identify the executor.
- **Idempotence guarantees on the loader.** The package does not verify that the loader is idempotent. That is the user's responsibility.

---
