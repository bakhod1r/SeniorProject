# sync.Cond — Specification

This file collects the formal guarantees of `sync.Cond` as documented by Go's standard library, the Go memory model, and the package's source. Wording is paraphrased from `pkg.go.dev/sync` and `go.dev/ref/mem` for clarity; the authoritative sources are linked at the end.

## Type

```go
type Cond struct {
    noCopy noCopy
    L Locker
    // unexported: notify notifyList; checker copyChecker
}
```

- `Cond` is the type of a condition variable.
- `L` is the lock to be held when changing the condition or calling `Wait`. It is set at construction time and should not be reassigned.
- A `Cond` must not be copied after first use. The vet `copylocks` analyzer flags such copies; the runtime panics if a copy is detected.

## Constructor

```go
func NewCond(l Locker) *Cond
```

- Returns a new `Cond` with the locker `l`.
- The locker is most commonly `*sync.Mutex` or `*sync.RWMutex` (using its writer interface).
- Any type implementing `sync.Locker` (methods `Lock()` and `Unlock()`) is accepted.

## Methods

### `Wait`

```go
func (c *Cond) Wait()
```

- The calling goroutine must hold `c.L` when `Wait` is called.
- `Wait` atomically:
  1. Unlocks `c.L`.
  2. Adds the calling goroutine to the wait list maintained internally.
  3. Suspends execution of the calling goroutine.
- When some other goroutine calls `c.Signal()` or `c.Broadcast()` and the runtime selects this goroutine to wake (or `Broadcast` wakes all), the goroutine:
  4. Re-acquires `c.L`.
  5. Returns from `Wait`.
- The caller cannot assume that the condition predicate is true upon return. The Go documentation states:
  > "Because c.L is not locked while Wait is waiting, the caller typically cannot assume that the condition is true when Wait returns. Instead, the caller should Wait in a loop."
- Spurious wake-ups are permitted by the specification, even though current implementations do not produce them. Always re-check the predicate.

### `Signal`

```go
func (c *Cond) Signal()
```

- Wakes one goroutine waiting on `c`, if any.
- The runtime makes no guarantee about which waiter is woken. There is no FIFO order.
- It is permitted but not required for the caller to hold `c.L` during the call. In practice, holding the lock is recommended to avoid lost wake-up patterns described in the junior file.
- If no goroutine is waiting, the call is a no-op. The signal is *not* queued for a future waiter.

### `Broadcast`

```go
func (c *Cond) Broadcast()
```

- Wakes all goroutines currently waiting on `c`.
- It is permitted but not required for the caller to hold `c.L` during the call.
- After `Broadcast`, all woken goroutines race to re-acquire `c.L`. They enter the critical section serially.
- A `Broadcast` with no waiters is a no-op.

## Fields

### `L`

```go
L Locker
```

- The associated lock.
- Set by `NewCond`. Should be treated as immutable after construction.
- Reassigning `L` while waiters are parked produces undefined behavior: parked waiters will re-acquire the *new* lock after wake-up, which may be a different lock than the one they unlocked.

### Internal: `notify`

Not part of the public API. A `notifyList` from `runtime/sema.go`. Holds:

- `wait atomic.Uint32` — next ticket to allocate.
- `notify uint32` — next ticket to notify.
- `lock mutex` — internal mutex.
- `head, tail *sudog` — linked list of parked goroutines.

### Internal: `checker`

Not part of the public API. A `copyChecker` that panics if the `Cond` is copied after first use.

## Memory Model Guarantees

From the Go memory model (`go.dev/ref/mem`):

> For any call to `c.Signal()` or `c.Broadcast()`, let `W` be the set of `Wait` calls that this `Signal`/`Broadcast` releases. Then `Signal`/`Broadcast` is synchronized before each `Wait` in `W` returns.

In practice:

- Writes performed by the signaller *before* `Signal` or `Broadcast` are visible to the waiter *after* `Wait` returns, **provided** that the writes are protected by `c.L` and the signal happens under `c.L`.
- If the signaller writes outside `c.L`, the memory model gives no visibility guarantees for those writes via the `Cond`. Writes must be protected by the same lock the waiter re-acquires.

## Failure Modes

| Operation | Failure | Result |
|---|---|---|
| `Wait` without holding `c.L` | `c.L.Unlock()` is called on an unlocked mutex | Panic: `sync: unlock of unlocked mutex` (for `*sync.Mutex`) |
| `Wait` on a `*Cond` that has been copied | `copyChecker.check` detects address change | Panic: `sync.Cond is copied` |
| `Signal`, `Broadcast`, or `Wait` on a nil `*Cond` | Nil pointer dereference | Panic |
| `Cond` constructed without `NewCond` and `L` field set later | First use sees default `L` (nil) | Panic when `Wait` is called |
| `Cond` with two waiters of different predicates and `Signal` sent for one | `Signal` may wake the "wrong" waiter | Lost wake-up; usually masked by the `for` loop in the right waiter |

## Constraints

- The `Cond` is single-process. There is no inter-process condition variable in the standard library.
- The wait list is unbounded. There is no maximum number of parked goroutines.
- The wait list is not persisted. A new `Cond` has an empty wait list.

## Concurrency Constraints

- It is safe for multiple goroutines to call `Wait` concurrently.
- It is safe for multiple goroutines to call `Signal` or `Broadcast` concurrently.
- It is safe to mix `Wait` and `Signal`/`Broadcast` concurrently.
- It is *not* safe to call `Wait` without holding `c.L`. The runtime panics.
- It is *not* safe to call any method on a copy of a `Cond` that has been used.

## Standard Library Cross-References

- `sync.Mutex` — the typical `L`.
- `sync.RWMutex` — alternative `L`. Usually used in writer mode; reader mode has subtle semantics with respect to memory visibility on `Wait`/`Signal`.
- `sync.WaitGroup` — solves a subset of `Cond`'s use cases ("wait until N goroutines are done") with simpler API.
- `sync.Once` — unrelated, but often discussed alongside `Cond` as part of the `sync` package's primitives.

## Compatibility

- `sync.Cond` has been stable since Go 1.0.
- No new methods have been added since Go 1.0.
- No methods have been removed or had their semantics changed since Go 1.0.
- The internal implementation has changed multiple times (most recently to use `notifyList` with ticket-based notification), but the contract is unchanged.

## Style Guide Positions

- **Effective Go**: Channels are preferred for goroutine coordination. `Cond` is mentioned but not recommended.
- **The Go standard library reviewers**: New code that uses `Cond` typically receives review feedback asking whether channels would serve.
- **Uber Go Style Guide**: Does not explicitly discourage `Cond` but does encourage channel-first concurrency.
- **Google Go Style Guide**: Discourages `Cond` in favor of channels and higher-level types.

## Documented Behavior Summary

The full public contract, in one paragraph:

> A `*sync.Cond` constructed by `NewCond(l)` provides three operations: `Wait`, `Signal`, `Broadcast`. The caller must hold the lock `l` when calling `Wait`. `Wait` atomically unlocks `l`, parks the goroutine, and on wake re-locks `l` before returning. `Signal` wakes one waiter (if any); `Broadcast` wakes all. Spurious wake-ups are permitted, so the caller must re-check the predicate in a `for` loop. Memory writes done by the signaller under `l` before `Signal`/`Broadcast` are visible to the waiter under `l` after `Wait` returns. Copying a `*Cond` after first use is not safe; the runtime detects copies and panics.

## References

- Go standard library: <https://pkg.go.dev/sync#Cond>
- Go memory model: <https://go.dev/ref/mem>
- Source: <https://cs.opensource.google/go/go/+/refs/heads/master:src/sync/cond.go>
- Source: <https://cs.opensource.google/go/go/+/refs/heads/master:src/runtime/sema.go>
- Effective Go: <https://go.dev/doc/effective_go>
- Bryan Mills, "Rethinking Classical Concurrency Patterns": <https://drive.google.com/file/d/1nPdvhB0PutEJzdCq5ms6UI58dp50fcAN/view>
