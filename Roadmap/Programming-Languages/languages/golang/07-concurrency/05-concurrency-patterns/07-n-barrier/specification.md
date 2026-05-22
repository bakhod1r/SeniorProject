# N-Barrier — Specification

## Table of Contents
1. [Definitions](#definitions)
2. [Invariants](#invariants)
3. [Operations and Semantics](#operations-and-semantics)
4. [Ordering and Memory Guarantees](#ordering-and-memory-guarantees)
5. [Failure Semantics](#failure-semantics)
6. [Defined vs Undefined Behavior](#defined-vs-undefined-behavior)
7. [Concurrency Contract](#concurrency-contract)
8. [Lifecycle State Machine](#lifecycle-state-machine)
9. [Edge Cases](#edge-cases)
10. [Reference Implementation](#reference-implementation)

---

## Definitions

- **Barrier.** An object created for a fixed party count `N ≥ 1`, offering a `Wait` operation that all `N` parties must invoke before any returns.
- **Party.** A goroutine that calls `Wait`. The barrier does not track identity; it counts arrivals.
- **Arrival.** A single invocation of `Wait` that increments the barrier's arrival count for the current generation.
- **Trip (release).** The event that occurs when the `N`-th party arrives in a generation: all parties of that generation are released.
- **Generation (phase).** A monotonically increasing identifier for one trip cycle. The barrier starts at generation 0; each trip advances it by 1.
- **Cyclic (reusable) barrier.** A barrier that resets after each trip and may be used for unboundedly many generations.
- **One-shot barrier.** A barrier valid for exactly one trip; behavior after the first trip is undefined.
- **Broken barrier.** A barrier whose current generation has been aborted (by `Abort` or context cancellation). All parties waiting in a broken generation return an error.

---

## Invariants

A conforming cyclic barrier must guarantee these at all times:

1. **All-or-none release.** No party's `Wait` returns (normally) for generation `g` until exactly `N` parties have arrived in generation `g`.
2. **Atomic generation advance.** When the `N`-th party arrives, the arrival count is reset to 0 and the generation is incremented as a single critical-section operation, before any waiter is released.
3. **No early release.** A party that arrives in generation `g` is released only by the trip of generation `g` (or by that generation being broken) — never by a later generation's trip.
4. **Fixed N.** `N` does not change during the lifetime of any single generation.
5. **Predicate re-check.** A blocked party re-evaluates its release condition after every wakeup (no action on a spurious wakeup).
6. **Single broadcast.** Each trip wakes all parties of that generation (no party is left asleep after its generation trips).
7. **Idempotent abort within a generation.** Calling `Abort` more than once within the same generation has the same observable effect as calling it once.
8. **Progress.** If all `N` parties call `Wait` in the same generation (and none is broken), the barrier trips in finite time.

Breaking any invariant makes the barrier incorrect: invariant 1 or 3 causes premature release (data races in phased code); invariant 2 causes the fast-looper corruption; invariant 5 causes spurious-wakeup release.

---

## Operations and Semantics

### `New(n int) *Barrier`

- **Pre-conditions:** `n ≥ 1`.
- **Post-conditions:** barrier in *Open* state, generation 0, arrival count 0.
- **Errors:** panics if `n ≤ 1` is treated as a programming error (implementation choice: panic vs. degenerate pass-through for `n == 1`).

### `Wait() ` (cyclic, non-cancellable form)

- **Pre-conditions:** called by one of the `N` parties; total callers per generation must equal `N`.
- **Behavior:** records the current generation `g`, increments the arrival count. If the count reaches `N`, advances the generation, resets the count to 0, and releases all parties of `g`; otherwise blocks until generation `≠ g`.
- **Post-conditions:** on return, all `N` parties of generation `g` have arrived; the barrier is open for generation `g+1`.
- **Returns:** nothing.

### `Wait(ctx context.Context) error` (cancellable form)

- **Pre-conditions:** as above; `ctx` non-nil.
- **Behavior:** as above, but if `ctx` is cancelled while blocked, or the generation is broken via `Abort`, the generation becomes broken and all its waiters return an error.
- **Post-conditions:** returns `nil` on a normal trip; returns a non-nil error (e.g., `ErrBroken` or `ctx.Err()`) if the generation was broken.
- **Returns:** `nil` | `ErrBroken` | `ctx.Err()`.

### `Abort()`

- **Pre-conditions:** none.
- **Behavior:** marks the current generation broken and releases all its waiters.
- **Post-conditions:** every party blocked in the current generation returns an error; the broken state is scoped to that generation.

### `Reset()` (optional)

- **Pre-conditions:** no party is currently waiting (caller's responsibility).
- **Behavior:** clears the broken state and resets the arrival count for a fresh generation.
- **Post-conditions:** barrier returns to *Open*; behavior is undefined if a party is mid-`Wait`.

---

## Ordering and Memory Guarantees

- **Happens-before edge (per generation).** Every memory operation performed by any party *before* its `Wait()` for generation `g` happens-before every memory operation performed by any party *after* `Wait()` returns for generation `g`. This is provided by the underlying mutex's unlock→lock ordering and `Cond.Wait`'s re-lock on return.
- **Scope.** The edge is per-generation. Writes in generation `g+1` are *not* ordered relative to reads in generation `g` unless a *second* barrier separates them. (Hence the double-barrier requirement for buffer swaps.)
- **No data transfer.** The barrier transfers no values; it transfers only ordering/visibility.

---

## Failure Semantics

| Situation | Result |
|-----------|--------|
| Fewer than `N` parties ever arrive | The arrived parties block forever (deadlock). Defined as a *caller* error. |
| More than `N` parties arrive in one generation (cyclic) | The `N+1`-th party belongs to the *next* generation; defined and safe for a cyclic barrier. For a one-shot barrier it is undefined. |
| A party panics before arriving | Peers deadlock unless the generation is broken (`Abort`) or `ctx` cancelled. |
| `ctx` cancelled while blocked (cancellable form) | All waiters of that generation return `ctx.Err()`/`ErrBroken`; generation is broken. |
| `Abort()` with no waiters | The current generation is marked broken; the next arriver observes it (implementation may require `Reset`). |

A broken generation must release waiters with an error rather than leaving them parked. A barrier without a break/cancel path has *undefined* recovery from a missing party — i.e., none.

---

## Defined vs Undefined Behavior

**Defined:**
- Exactly `N` parties calling `Wait` per generation, repeatedly, on a cyclic barrier.
- Releasing all parties of a generation atomically with the generation advance.
- `Abort` / context cancellation breaking the current generation.
- A `n == 1` barrier acting as a pass-through (each `Wait` returns immediately) if the implementation chooses to allow it.

**Undefined (or implementation-defined, must be documented):**
- Reusing a *one-shot* barrier for a second trip.
- Changing `N` during a generation.
- Calling `Reset` while a party is mid-`Wait`.
- More than `N` parties per generation on a *one-shot* barrier.
- Calling `Wait` on a `nil` barrier.
- Behavior on generation counter overflow (practically unreachable for `uint64`; for sense-reversing barriers, not applicable).

---

## Concurrency Contract

- `Wait` is safe to call concurrently from up to `N` goroutines per generation; calling it from more than `N` per generation on a one-shot barrier is a caller error.
- All internal state (`count`, `generation`, `broken`) is mutated only under the barrier's mutex.
- `Abort` is safe to call concurrently with `Wait`.
- The barrier object must not be copied after first use (it embeds a `sync.Mutex`/`sync.Cond`); pass it by pointer. (A `go vet` copylock check should flag violations.)
- A party must hold no lock that the barrier might transitively need; the barrier acquires only its own mutex, so the rule reduces to "do not call `Wait` while holding a lock that another party needs to *reach* its own `Wait`."

---

## Lifecycle State Machine

```
            New(n)
              |
              v
        +-----------+   N-th arrival (generation g)   +-----------+
        |   OPEN    | ------------------------------> |  TRIPPED  |
        | (gen = g) |   reset count, gen = g+1,        | (transient|
        | count<N   | <------------------------------ |  release) |
        +-----------+        immediately re-OPEN       +-----------+
              |
              | Abort() / ctx cancel
              v
        +-----------+   Reset() (no waiters)
        |  BROKEN   | -----------------------> OPEN
        | (gen = g) |
        +-----------+
```

- **OPEN:** accepting arrivals for the current generation; `count < N`.
- **TRIPPED:** transient; the `N`-th arrival advances the generation and releases waiters, returning immediately to OPEN for `g+1`.
- **BROKEN:** the current generation was aborted/cancelled; waiters return an error. A cyclic barrier may transition back to OPEN via `Reset` (only when no party is waiting).

---

## Edge Cases

- **`N == 1`.** A single-party barrier: `Wait` should return immediately (each call is its own trip). Document whether you allow it or panic.
- **Last party never sleeps.** The `N`-th arriver broadcasts/advances and returns without blocking; tracing this path is essential to a correct implementation.
- **Spurious wakeup.** Mandated by `sync.Cond`; the `for` loop over the generation predicate handles it.
- **Fast looper.** A released party that immediately re-enters `Wait` reads the *new* generation and cannot satisfy the old generation's predicate (the reason for the generation counter).
- **Abort with concurrent trip.** If the `N`-th party advances the generation at the same instant `Abort` fires, exactly one outcome must win under the lock: either the trip completes (generation `g` released normally) or `g` is marked broken — never both. The mutex serialises this.
- **Double barrier requirement.** Code that swaps shared buffers between phases needs two trips per cycle; one trip leaves the post-swap read unordered relative to the swap.
- **Generation overflow.** `uint64` generation overflows after ~1.8e19 trips — unreachable in practice. Sense-reversing barriers sidestep the concern with a single bit.

---

## Reference Implementation

A minimal, correct, cyclic, context-aware barrier satisfying the invariants above.

```go
// Package barrier provides a reusable N-party synchronization barrier.
package barrier

import (
    "context"
    "errors"
    "sync"
)

// ErrBroken is returned by Wait when the current generation was aborted
// or its context was cancelled.
var ErrBroken = errors.New("barrier: broken generation")

// Barrier is a reusable barrier for a fixed number of parties.
// The zero value is not usable; construct with New. Do not copy after use.
type Barrier struct {
    mu         sync.Mutex
    cond       *sync.Cond
    n          int    // party count, fixed for the barrier's lifetime
    count      int    // arrivals in the current generation
    generation uint64 // current generation; advances on each trip
    broken     bool   // true if the current generation was aborted/cancelled
}

// New returns a barrier for n parties. It panics if n < 1.
func New(n int) *Barrier {
    if n < 1 {
        panic("barrier: n must be >= 1")
    }
    b := &Barrier{n: n}
    b.cond = sync.NewCond(&b.mu)
    return b
}

// Wait blocks until all n parties have arrived in the current generation.
// It returns nil on a normal trip, or ErrBroken if the generation is broken
// (via Abort) or ctx is cancelled while waiting.
func (b *Barrier) Wait(ctx context.Context) error {
    b.mu.Lock()

    if b.broken {
        b.mu.Unlock()
        return ErrBroken
    }

    gen := b.generation
    b.count++

    // Last party: advance the generation atomically and release everyone.
    if b.count == b.n {
        b.generation++
        b.count = 0
        b.cond.Broadcast()
        b.mu.Unlock()
        return nil
    }

    // Bridge context cancellation into the Cond wait (Go 1.21+).
    stop := context.AfterFunc(ctx, func() {
        b.mu.Lock()
        if gen == b.generation && !b.broken {
            b.broken = true
            b.cond.Broadcast()
        }
        b.mu.Unlock()
    })
    defer stop()

    // Wait until our generation trips or is broken.
    for gen == b.generation && !b.broken {
        b.cond.Wait()
    }

    broken := b.broken
    b.mu.Unlock()
    if broken {
        if err := ctx.Err(); err != nil {
            return err
        }
        return ErrBroken
    }
    return nil
}

// Abort breaks the current generation; all waiting parties return ErrBroken.
// It is idempotent within a generation and safe to call concurrently.
func (b *Barrier) Abort() {
    b.mu.Lock()
    if !b.broken {
        b.broken = true
        b.cond.Broadcast()
    }
    b.mu.Unlock()
}

// Reset clears a broken generation so the barrier can be reused.
// The caller must ensure no party is currently inside Wait.
func (b *Barrier) Reset() {
    b.mu.Lock()
    b.broken = false
    b.count = 0
    b.generation++
    b.mu.Unlock()
}
```

This implementation satisfies all eight invariants: arrivals and the generation advance are mutated only under `mu` (invariant 2, 4); waiters loop on the generation predicate (invariant 5, 3); the last party broadcasts once (invariant 6); `Abort` is idempotent within a generation (invariant 7); and the happens-before edge follows from the mutex unlock→lock chain plus `cond.Wait`'s re-lock. For a non-cancellable, allocation-free hot path, drop the `context.AfterFunc` block and the `ctx` parameter.
