---
layout: default
title: Specification
parent: Mutex Copying
grand_parent: Concurrency Anti-Patterns
ancestor: Go
nav_order: 5
permalink: /roadmap/programming-languages/golang/07-concurrency/15-concurrency-anti-patterns/02-mutex-copying/specification/
---

# Mutex Copying — Specification

This document specifies, in normative form, the semantics of `sync.Mutex`, the `noCopy` idiom, the `copylocks` vet pass, and the relevant guarantees of the Go memory model. It serves as the authoritative reference for "what must be true" — the patterns and remediations in the other files derive from these specifications.

## Table of Contents
1. [Scope and notation](#scope-and-notation)
2. [sync.Mutex semantics](#syncmutex-semantics)
3. [sync.RWMutex semantics](#syncrwmutex-semantics)
4. [sync.WaitGroup, sync.Once, sync.Cond semantics](#syncwaitgroup-synconce-synccond-semantics)
5. [The noCopy idiom](#the-nocopy-idiom)
6. [The copylocks vet rule](#the-copylocks-vet-rule)
7. [Go memory model guarantees](#go-memory-model-guarantees)
8. [Required tooling integration](#required-tooling-integration)
9. [Conformance checklist](#conformance-checklist)

---

## Scope and notation

This specification applies to the Go language version 1.22 and later. Earlier versions follow the same essential semantics with minor differences in vet's analyser behaviour.

Normative keywords (`MUST`, `MUST NOT`, `SHOULD`, `SHOULD NOT`, `MAY`) follow RFC 2119.

We denote:

- `m` — an instance of `sync.Mutex`.
- `rw` — an instance of `sync.RWMutex`.
- `wg` — an instance of `sync.WaitGroup`.
- `once` — an instance of `sync.Once`.
- `cond` — an instance of `sync.Cond`.

The phrase "the same mutex" refers to the same address-in-memory of a `sync.Mutex` value. Two distinct addresses are not the same mutex even if they contain identical byte sequences.

---

## sync.Mutex semantics

### Structural definition

A `sync.Mutex` is a struct with the following invariant-defining fields:

```go
type Mutex struct {
    state int32
    sema  uint32
}
```

Implementations MAY add further fields; the existing fields' semantics are normative.

### Lock semantics

`func (m *Mutex) Lock()`:

1. If `m` is not held by any goroutine, the call acquires the lock atomically and returns. The mutex is now held.
2. If `m` is held by another goroutine, the calling goroutine MUST block until the lock becomes available. The runtime MAY spin briefly before parking the goroutine on `m`'s semaphore.
3. If `m` is held by the calling goroutine, the call MUST NOT return; the mutex is non-recursive. Behaviour in this case is deadlock for the calling goroutine.

### Unlock semantics

`func (m *Mutex) Unlock()`:

1. If `m` is held, the call releases the lock atomically. If other goroutines are waiting, the runtime wakes one.
2. If `m` is not held, the call MUST result in a runtime fatal error: "sync: unlock of unlocked mutex." This error is not recoverable.

### TryLock semantics

`func (m *Mutex) TryLock() bool`:

1. If `m` is not held, the call attempts to acquire the lock via a single atomic compare-and-swap. On success, returns `true`. The mutex is held.
2. If `m` is held by any goroutine (including the calling goroutine), returns `false` without modifying `m`.

### Copy prohibition

A `sync.Mutex` value MUST NOT be copied after first use. Concretely:

- After any call to `m.Lock()`, `m.Unlock()`, or `m.TryLock()`, the value `m` MUST NOT be copied.
- Copies include but are not limited to: assignment, function argument by value, function return by value, range over slice/array/map yielding value, struct/composite literal field initialisation, channel send/receive, type assertion that copies, `go`/`defer` argument evaluation.

A pre-first-use copy of a zero-valued `sync.Mutex` is technically not a violation, but is strongly discouraged because subsequent uses of either copy will violate the rule.

### Zero value

The zero value of `sync.Mutex` is a valid unlocked mutex. No constructor or initialisation function is required.

### Address stability

A `sync.Mutex` value's address MUST be stable for the entire period it is in use. Goroutines parked on the semaphore expect to be woken at the address they parked on. The Go runtime guarantees address stability for heap allocations. Stack allocations move only during stack growth, which is handled by the runtime (all live pointers, including those internal to the semaphore mechanism, are updated atomically).

---

## sync.RWMutex semantics

### Structural definition

A `sync.RWMutex` is a struct with the following invariant-defining fields:

```go
type RWMutex struct {
    w           Mutex
    writerSem   uint32
    readerSem   uint32
    readerCount atomic.Int32
    readerWait  atomic.Int32
}
```

### Lock semantics (writer)

`func (rw *RWMutex) Lock()`:

1. If no readers or writers hold or are waiting for `rw`, acquires exclusive access atomically and returns.
2. If other readers or writers hold `rw`, blocks until they all release.
3. Pending writers prevent new readers from acquiring `RLock`, ensuring writer fairness.

### Unlock semantics (writer)

`func (rw *RWMutex) Unlock()`:

1. If `rw` is held by a writer, releases exclusive access. Pending readers (if any) are released; otherwise, a pending writer (if any) is woken.
2. If `rw` is not held by a writer, results in a fatal error.

### RLock semantics

`func (rw *RWMutex) RLock()`:

1. If no writer holds `rw` and no writer is pending, atomically increments the reader count and returns.
2. If a writer holds or is pending on `rw`, blocks until the writer completes.

### RUnlock semantics

`func (rw *RWMutex) RUnlock()`:

1. If at least one reader holds `rw`, atomically decrements the reader count. If the count reaches zero and a writer is pending, the writer is woken.
2. If no reader holds `rw`, results in a fatal error.

### TryLock and TryRLock

`TryLock` and `TryRLock` are non-blocking variants returning `bool`. They acquire if possible without parking; otherwise they return `false`.

### Recursive read-locking

A goroutine holding `rw` for reading MUST NOT call `rw.RLock()` again. Doing so MAY deadlock if a writer arrives between the two calls.

### Copy prohibition

Same as `sync.Mutex`. An `RWMutex` value MUST NOT be copied after first use.

---

## sync.WaitGroup, sync.Once, sync.Cond semantics

### sync.WaitGroup

```go
type WaitGroup struct {
    noCopy noCopy
    state  atomic.Uint64
    sema   uint32
}
```

- `Add(delta int)` adjusts the counter by delta. Negative deltas are permitted but the counter MUST NOT go below zero (results in a panic).
- `Done()` is `Add(-1)`.
- `Wait()` blocks until the counter reaches zero.
- The counter starts at zero. A `WaitGroup` value MUST NOT be copied after the first call to `Add`, `Done`, or `Wait`.
- Reusing a `WaitGroup` (i.e., calling `Add` after a previous `Wait` returned) is permitted, provided no goroutines are concurrently calling `Wait`.

### sync.Once

```go
type Once struct {
    done atomic.Uint32
    m    Mutex
}
```

- `Do(f func())` calls `f` exactly once across all goroutines using the same `Once` value, even under concurrent calls.
- `Once` MUST NOT be copied after first use.
- If `f` panics, the panic propagates and the `Once` is considered to have completed; subsequent calls to `Do` will NOT call `f`.

### sync.Cond

```go
type Cond struct {
    noCopy  noCopy
    L       Locker
    notify  notifyList
    checker copyChecker
}
```

- A `Cond` is constructed with `sync.NewCond(l Locker)`. `l` is the lock associated with the condition.
- `Wait()` MUST be called with `L` held. It atomically releases `L` and suspends execution until `Signal` or `Broadcast` wakes the goroutine. Upon wakeup, `L` is reacquired.
- `Signal()` wakes one waiter.
- `Broadcast()` wakes all waiters.
- `Cond` MUST NOT be copied after first use. The `copyChecker` field performs a runtime check and panics on copy.

---

## The noCopy idiom

### Definition

A `noCopy` field is a struct field whose type satisfies `sync.Locker` (has `Lock()` and `Unlock()` methods) but whose methods are no-ops.

Canonical definition:

```go
type noCopy struct{}

func (*noCopy) Lock()   {}
func (*noCopy) Unlock() {}
```

### Purpose

A `noCopy` field exists solely to trigger the `copylocks` vet pass. The methods do nothing at runtime; there is no functional effect.

### Usage

A type that should not be copied embeds or names a `noCopy` field:

```go
type T struct {
    _ noCopy
    // ... other fields ...
}
```

The `_` field name discards the value (it cannot be referenced); the field is still structurally present, so vet recognises `T` as containing a `Locker`.

### When required

- A type containing a `sync.Mutex`, `sync.RWMutex`, `sync.WaitGroup`, `sync.Once`, `sync.Cond`, or `atomic.Value` already triggers `copylocks` and does not require an additional `noCopy`.
- A type that contains no such field but should not be copied (e.g., because it holds a unique resource identifier, a file descriptor, or a runtime-stable pointer that depends on address) SHOULD use `noCopy`.

### When NOT to use noCopy

- Types that are intended to be copied (most value-typed structs).
- Types that are exposed across package boundaries and copying might be common in user code unrelated to synchronisation.

### Naming and visibility

The `noCopy` type SHOULD be unexported (package-local). It is an implementation detail. Each package that needs it MAY define its own copy of the type; the type is identified by structure, not by name.

---

## The copylocks vet rule

### Source

The analyser is `golang.org/x/tools/go/analysis/passes/copylock`. It is registered as part of `go vet`'s default set.

### Behaviour

The analyser flags any occurrence where a value of a type containing a `sync.Locker` is copied. Specifically:

- Assignments: `a = b` where `b`'s type contains a Locker.
- Variable declarations with initializers: `var a = b`, `a := b`.
- Function calls: passing a Locker-containing value as an argument by value.
- Function returns: returning a Locker-containing value by value.
- Composite literals: `T{F: v}` where `v` is a Locker-containing value.
- Range statements: `for _, v := range slice` where the element type contains a Locker.
- Channel send: `ch <- v` where `v`'s type contains a Locker.
- `go` statements: `go f(v)` where `v`'s type contains a Locker.
- `defer` statements: `defer f(v)` where `v`'s type contains a Locker. The argument is evaluated and copied at the `defer` statement.
- Type assertions in some cases.
- Generic instantiations in recent versions.

### Containment is transitive

A type contains a Locker if:

- It is a Locker (it has `Lock()` and `Unlock()` methods), OR
- It is a struct with a field whose type contains a Locker, OR
- It is an array whose element type contains a Locker.

Pointers, slices, maps, channels, and function types do NOT contribute to containment (they hold the Locker indirectly).

### Diagnostic format

```
<file>:<line>:<col>: <context> passes lock by value: <type> contains sync.<kind>
```

Example:

```
counter.go:10:7: Inc passes lock by value: Counter contains sync.Mutex
```

### Suppression

The vet analyser does not support `// nolint` style suppression. Programs that produce false positives should restructure the code. There is no permitted way to silence `copylocks` for a true positive.

### False negatives

The analyser MAY miss copy sites in:

- Reflection-based code (`reflect.ValueOf`, `reflect.New`, `reflect.Value.Set`).
- `unsafe.Pointer` conversions.
- Interface assignments where the underlying type is not statically known.
- Generic functions in older Go versions.

False negatives are real risks. Authors of Locker-containing types SHOULD also add documentation and (where applicable) runtime self-checks.

---

## Go memory model guarantees

The Go memory model defines a "happens-before" relation. The relation relevant to mutexes:

### Mutex happens-before

For a `sync.Mutex` value `m`:

> The n-th call to `m.Unlock()` happens-before the (n+1)-th successful call to `m.Lock()`.

This means: any memory writes performed by a goroutine before its call to `m.Unlock()` are visible to any goroutine after its subsequent call to `m.Lock()` returns.

### Scope: "the same mutex"

The relation applies only to the *same mutex* — the same memory address. A copy of a mutex is a different mutex; the Unlock-Lock relation does not bridge copies.

### RWMutex happens-before

For a `sync.RWMutex` value `rw`:

- The n-th call to `rw.Unlock()` happens-before the (n+1)-th successful call to `rw.Lock()` or `rw.RLock()`.
- For any successful call to `rw.RLock()`, the most recent preceding `rw.Unlock()` happens-before it.

### WaitGroup happens-before

For a `sync.WaitGroup` value `wg`:

- A call to `wg.Done()` happens-before the return of `wg.Wait()`.
- A call to `wg.Add(d)` for d > 0 happens-before all subsequent `wg.Done()` calls for that add.

### Once happens-before

For a `sync.Once` value `once`:

- The single call to `f` inside `once.Do(f)` happens-before the return of any call to `once.Do`.

### Channel happens-before

For a channel `ch`:

- The n-th send on `ch` happens-before the n-th receive completes.
- For an unbuffered channel, the receive happens-before the send completes.
- Closing a channel happens-before the receive completes (with zero value).

### Atomic happens-before

For atomic operations on a single memory location:

- A read of a value observes some preceding write to the same location.
- A write becomes visible to subsequent reads.
- All atomic operations on a single location are sequentially consistent.

### Implications for mutex copying

A program that copies a mutex relies on a happens-before relation that does not exist. Specifically, if goroutine A unlocks `a` and goroutine B locks `b` (a copy of `a`), the writes A made before unlocking are NOT guaranteed to be visible to B after locking. The race detector may or may not catch resulting races (it samples).

Compilers and CPUs are permitted to reorder memory operations across non-synchronising boundaries. Copy bugs can result in arbitrary stale reads, undefined behaviour, or seemingly impossible interleavings.

---

## Required tooling integration

A conforming Go project handling concurrency MUST:

1. Run `go vet ./...` on every commit or pull request, and treat all vet diagnostics as errors.
2. Run `go test -race ./...` on every commit or pull request, and treat all race detector findings as errors.

A conforming Go project SHOULD:

3. Run `staticcheck` or `golangci-lint` with the `copylocks` check enabled.
4. Configure pre-commit hooks that run vet locally.
5. Document, per Locker-containing type, the no-copy expectation.
6. Provide constructors returning `*T` for Locker-containing types.
7. Enable mutex profiling (`runtime.SetMutexProfileFraction`) in production at a low sampling rate (e.g., 1 in 1000).
8. Expose mutex profile endpoints via `net/http/pprof` (on a restricted admin port).
9. Capture continuous mutex profiles in services that approach scale where contention may become significant.

---

## Conformance checklist

A package containing types with synchronisation primitives conforms to this specification if:

- [ ] All types containing `sync.Mutex`, `sync.RWMutex`, `sync.WaitGroup`, `sync.Once`, `sync.Cond`, `atomic.Value`, or `atomic.Pointer[T]` have methods declared exclusively with pointer receivers.
- [ ] All constructors for such types return `*T`.
- [ ] All public function signatures involving such types use `*T`.
- [ ] Maps, slices, and channels that store such types store `*T`, not `T`.
- [ ] `go vet ./...` produces no `copylocks` diagnostics.
- [ ] `go test -race ./...` produces no race detector findings under the package's normal test workload.
- [ ] Type documentation explicitly states the no-copy expectation.
- [ ] If a type contains no Locker but should not be copied, it embeds a `noCopy` field.
- [ ] CI enforces `go vet` and `go test -race` on every change.

A binary deployed to production conforms to this specification if:

- [ ] The binary was built from sources that pass the package conformance checklist.
- [ ] Mutex profiling is enabled at startup with a non-zero sampling fraction.
- [ ] Block profiling is enabled at startup with a non-zero rate (for services where channel/mutex blocking matters).
- [ ] Mutex profile data is captured and retained for at least the operational retention period (typically 30 days).
- [ ] Alerts are configured on mutex-related anomalies (CPU% in lock symbols, p99 lock acquire duration, sudden goroutine count spikes).

---

## Appendix: Cross-references

| Reference | Document/Source |
|-----------|----------------|
| `sync.Mutex` API | `pkg.go.dev/sync` |
| `sync.RWMutex` API | `pkg.go.dev/sync` |
| `sync.WaitGroup` API | `pkg.go.dev/sync` |
| `sync.Once` API | `pkg.go.dev/sync` |
| `sync.Cond` API | `pkg.go.dev/sync` |
| Go memory model | `go.dev/ref/mem` |
| copylocks analyser | `golang.org/x/tools/go/analysis/passes/copylock` |
| Mutex profiling | `pkg.go.dev/runtime#SetMutexProfileFraction` |
| Block profiling | `pkg.go.dev/runtime#SetBlockProfileRate` |
| pprof HTTP endpoints | `pkg.go.dev/net/http/pprof` |

---

## Appendix: Version history

- Go 1.0 (2012): `sync.Mutex`, `sync.RWMutex`, `sync.Once`, `sync.WaitGroup`, `sync.Cond` introduced.
- Go 1.5: introduction of `sync.Pool`.
- Go 1.9: `sync.Map` added.
- Go 1.18: `sync.Mutex.TryLock`, `sync.RWMutex.TryLock`, `sync.RWMutex.TryRLock` added. Generics enabled.
- Go 1.19: typed atomics (`atomic.Int32`, `atomic.Int64`, `atomic.Bool`, `atomic.Pointer[T]`) added with `noCopy` markers.
- Go 1.22: refinements to copylocks analyser for generics.

The specifications in this document are stable across these versions for the features that existed at each version.

---

## Appendix: Common conformance failures

Failures observed in real-world Go projects:

| Failure | Severity | Remediation |
|---------|----------|-------------|
| Value receiver on Locker-containing type | High | Change to pointer receiver |
| `func NewT() T` instead of `*T` | High | Return pointer |
| `map[K]T` with Locker in T | High | Use `map[K]*T` |
| `chan T` with Locker in T | High | Use `chan *T` |
| `range` over slice of Locker-containing struct | Medium | Use `&slice[i]` |
| Closure captures Locker by value | Medium | Capture by reference |
| `defer fmt.Println(t)` where t contains Locker | Medium | `defer fmt.Println(&t)` |
| Missing constructor | Low | Add `NewT() *T` |
| Missing documentation | Low | Add no-copy note |
| CI not running vet | High | Add vet to CI |
| CI not running -race | High | Add race tests to CI |

---

## Appendix: Authoritative documentation snippets

The `sync` package itself states (in the doc comment for `Mutex`):

> Values containing the types defined in this package should not be copied.

For `WaitGroup`:

> A WaitGroup must not be copied after first use.

For `Once`:

> A Once must not be copied after first use.

For `Cond`:

> A Cond must not be copied after first use.

These statements are normative within the standard library. This specification extends them to user-defined types that embed or transitively contain these primitives.

---

End of specification.
