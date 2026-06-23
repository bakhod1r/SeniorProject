---
layout: default
title: WaitGroups — Specification
parent: WaitGroups
grand_parent: sync Package
nav_order: 5
permalink: /roadmap/programming-languages/golang/07-concurrency/03-sync-package/02-waitgroups/specification/
---

# WaitGroups — Specification

← Back to WaitGroups

This page collects the formal API contract for `sync.WaitGroup` from the Go standard library, the relevant clauses of the Go memory model, and a precise re-statement of the rules with their justifications.

References:

- `pkg.go.dev/sync#WaitGroup`
- `go.dev/ref/mem` (the Go memory model)
- `src/sync/waitgroup.go` in the Go source tree

---

## 1. Type

```go
package sync

type WaitGroup struct {
    // exported fields: none
    // unexported fields: noCopy, state atomic.Uint64, sema uint32
}
```

A `WaitGroup` waits for a collection of goroutines to finish. The main goroutine calls `Add` to set the number of goroutines to wait for. Each of the goroutines runs and calls `Done` when finished. At the same time, `Wait` can be used to block until all goroutines have finished.

A `WaitGroup` must not be copied after first use.

---

## 2. Methods

### 2.1 `func (wg *WaitGroup) Add(delta int)`

> "Add adds delta, which may be negative, to the WaitGroup counter. If the counter becomes zero, all goroutines blocked on Wait are released. If the counter goes negative, Add panics."
>
> "Note that calls with a positive delta that occur when the counter is zero must happen before a Wait. Calls with a positive delta, or calls with a negative delta that start when the counter is greater than zero, may happen at any time. Typically this means the calls to Add should execute before the statement creating the goroutine or other event to be waited for."

Receiver: `*WaitGroup`. Calling `Add` on a value receiver receives a copy of the WaitGroup and is incorrect.

Concurrency: `Add` is safe to call from multiple goroutines, subject to the happens-before rule above.

Panics:

| Condition                                                          | Message                                                                |
|--------------------------------------------------------------------|------------------------------------------------------------------------|
| Counter goes negative                                              | `sync: negative WaitGroup counter`                                     |
| Positive `Add` runs concurrently with `Wait` while counter == 0    | `sync: WaitGroup misuse: Add called concurrently with Wait`            |

### 2.2 `func (wg *WaitGroup) Done()`

> "Done decrements the WaitGroup counter by one."

Equivalent to `Add(-1)`. Same panic conditions apply.

### 2.3 `func (wg *WaitGroup) Wait()`

> "Wait blocks until the WaitGroup counter is zero."

Returns immediately if the counter is already zero.

Multiple goroutines may call `Wait` concurrently. All are released atomically when the counter hits zero.

Panics:

| Condition                                                          | Message                                                                |
|--------------------------------------------------------------------|------------------------------------------------------------------------|
| `WaitGroup` reused before previous `Wait` returned                 | `sync: WaitGroup is reused before previous Wait has returned`          |

---

## 3. The "happens-before" rule (formal)

In the terminology of the Go memory model:

- **Done synchronisation**: The call to `wg.Done()` synchronises before the return of any `wg.Wait()` call that it unblocks.
- **Add ordering**: Calls to `Add` with a positive delta when the counter is zero must happen-before the corresponding `Wait`. The simplest sufficient condition: the `Add` and the `Wait` are executed by the same goroutine, with the `Add` lexically preceding the `Wait`, and any goroutines that will eventually call `Done` are launched after the `Add`.

Formally, given:

- A `Wait()` call W on `wg`.
- A set of `Done()` calls D₁, D₂, ..., Dₙ that collectively bring the counter from positive to zero.
- A set of `Add(positive)` calls A₁, A₂, ..., Aₘ that established that positive count.

Then:

```
each Aᵢ  →  W            (must hold)
each Dⱼ  →  return of W   (guaranteed by the implementation)
```

where `→` means "synchronises-before" in the memory model. The first relation is the *programmer's responsibility*; violating it is undefined behaviour (likely caught by the race detector).

---

## 4. Reuse contract

The standard library allows reuse:

> "A WaitGroup may be reused once Wait has returned and the counter is zero."

Formal restatement:

- Let W be a `Wait` call that returns at time t.
- Subsequent `Add(positive)` calls A on the same WaitGroup are valid only if A happens-after t.
- An `Add` that happens-concurrently with W is forbidden and may panic with `sync: WaitGroup misuse: Add called concurrently with Wait`.

The simplest pattern for reuse: a single goroutine alternates `Add` and `Wait` in lock-step. Each round is fully sequenced.

---

## 5. Copyability

> "A WaitGroup must not be copied after first use."

The implementation includes a `noCopy` field that `go vet` reads. Copies are *not* prevented at compile time; they are reported by the static analyser. A copy after first use is undefined behaviour.

A WaitGroup that has *not* yet been used (counter zero, no waiters) may be copied — for example, a freshly declared local variable assigned to a struct field. After the first `Add`, no copy is permitted.

---

## 6. Zero value

> "The zero value of WaitGroup is a valid WaitGroup that needs no initialisation."

```go
var wg sync.WaitGroup     // ready to use
```

There is no constructor. There is no `Reset` method.

---

## 7. Pointer-only methods

All three methods (`Add`, `Done`, `Wait`) are defined on `*WaitGroup`, so calling them from a value receiver is impossible without taking the address. However, embedding the WaitGroup in a struct passed by value is a common bug:

```go
type S struct{ wg sync.WaitGroup }

func (s S) Run()  { s.wg.Add(1); ... }   // BUG: copy
func (s *S) Run() { s.wg.Add(1); ... }   // OK
```

The vet check catches this when `S` is passed by value to any function.

---

## 8. Concurrent calls — the legality table

Given a WaitGroup `wg`, are the following pairs of concurrent calls legal?

| Goroutine A   | Goroutine B   | Legal? | Justification                           |
|---------------|---------------|--------|-----------------------------------------|
| `Add(+n)`     | `Add(+m)`     | Yes    | Both increment atomically               |
| `Add(-1)`     | `Add(-1)`     | Yes    | Both decrement atomically               |
| `Done`        | `Done`        | Yes    | Same as above                           |
| `Done`        | `Wait`        | Yes    | The very purpose of WaitGroup           |
| `Add(+1)` with counter==0 | `Wait` | **No** | The famous race; may panic or miss      |
| `Wait`        | `Wait`        | Yes    | Both park, both released together       |
| `Add(+1)` with counter>0  | `Wait` | Yes    | Counter is already positive             |

The single illegal combination is `Add(+positive)` from a counter of zero racing with `Wait`. Avoid it.

---

## 9. Panic messages — exhaustive list

```
sync: negative WaitGroup counter
sync: WaitGroup misuse: Add called concurrently with Wait
sync: WaitGroup is reused before previous Wait has returned
```

These are the only panics from `WaitGroup` itself. Any other panic in code touching a WaitGroup originates from user code (e.g. nil pointer dereference because of a pass-by-value bug).

---

## 10. Memory model: visibility of writes

From the Go memory model and the WaitGroup contract:

- All memory writes performed by a goroutine *before* its `Done` are visible to any goroutine after the `Wait` that `Done` unblocks.
- This is a *release-acquire* edge from `Done` to `Wait`.

This guarantees the correctness of the per-index slice-fill pattern:

```go
out := make([]T, n)
wg.Add(n)
for i := 0; i < n; i++ {
    go func(i int) {
        defer wg.Done()
        out[i] = compute(i)        // write
    }(i)
}
wg.Wait()
process(out)                       // safe to read all entries
```

No additional synchronisation (mutex, atomic) is needed for the slice writes, because each index is written by exactly one goroutine and the `Wait` provides the necessary happens-before edge.

---

## 11. What WaitGroup does *not* guarantee

- It does not guarantee the order in which goroutines run or finish.
- It does not propagate errors.
- It does not provide a timeout for `Wait`.
- It does not bound concurrency; it counts.
- It does not detect leaked goroutines that never call `Done`.
- It does not expose the current counter value.

For each of these you compose with another primitive: `errgroup`, `context`, `semaphore`, channels.

---

## 12. Comparison with related types in the standard library

| Type             | Purpose                                          | Reusable? |
|------------------|--------------------------------------------------|-----------|
| `sync.WaitGroup` | Wait for N goroutines to finish                  | Yes (with care) |
| `sync.Once`      | Run a function exactly once                      | No        |
| `sync.Cond`      | Wake one or all waiters when a condition holds   | Yes       |
| `chan struct{}`  | Signal completion of one event                   | No (channel close is one-shot) |
| `errgroup.Group` | Wait + first-error propagation                   | No (one-shot) |

---

## 13. ABI stability

`sync.WaitGroup` has been part of the standard library since Go 1.0 (March 2012). The API has not changed. The internal representation has been refactored several times — most recently in Go 1.20 the `state1` byte array was replaced with `atomic.Uint64`, and the alignment hack for 32-bit platforms removed. None of those refactors changed the contract.

User code written against `WaitGroup` in Go 1.0 still works in Go 1.22.

---

## 14. Quick reference

```go
var wg sync.WaitGroup
wg.Add(N)                     // BEFORE go statement; can be called multiple times
go func() {                   // launched after Add
    defer wg.Done()           // first line; equivalent to Add(-1)
    work()
}()
wg.Wait()                     // blocks until counter == 0
```

Rules:

1. Pass `*sync.WaitGroup`, never `sync.WaitGroup` (vet enforces).
2. `Add(positive)` from zero must happen-before any `Wait`.
3. `Done` must run exactly once per `Add(+1)` increment.
4. Reuse only after a clean `Wait` return.
5. Counter is internal; never inspect it.

If your code follows these five rules, the Go runtime and the race detector will keep you honest.

---

## 15. Going deeper

- [professional.md](professional.md) — the implementation
- [interview.md](interview.md) — apply the spec to questions
- [find-bug.md](find-bug.md) — find spec violations in broken code
