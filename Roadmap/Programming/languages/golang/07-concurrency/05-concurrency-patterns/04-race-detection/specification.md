# Race Detection — Specification

## Table of Contents
1. [Introduction](#introduction)
2. [Definitions](#definitions)
3. [The Go Memory Model](#the-go-memory-model)
4. [Synchronising Operations](#synchronising-operations)
5. [Atomic Operations](#atomic-operations)
6. [Happens-Before Order](#happens-before-order)
7. [Data Race: Formal Definition](#data-race-formal-definition)
8. [Detector Contract](#detector-contract)
9. [Race Report Format](#race-report-format)
10. [Detector Limits](#detector-limits)
11. [Build and Run Flags](#build-and-run-flags)
12. [Compliance Checks](#compliance-checks)
13. [Summary](#summary)

---

## Introduction

This file is the formal specification of data races and the Go race detector. The goal: define precisely what a race is, what guarantees Go provides, and what the detector promises (and does not promise) to find.

---

## Definitions

- **Memory location**: an address in memory holding a value of some type. For composite types, each field/element is a distinct memory location.
- **Memory operation**: a load (read) or store (write) of a memory location by a goroutine.
- **Goroutine**: a Go-runtime-scheduled execution thread.
- **Synchronising operation**: a memory operation tagged by the runtime as creating a happens-before edge.
- **Atomic operation**: a memory operation performed via `sync/atomic` or via the runtime's internal atomics.
- **Conflict**: two memory operations to the same memory location, at least one of which is a write, performed by different goroutines.

---

## The Go Memory Model

The Go memory model is documented at https://go.dev/ref/mem. Its core axiom:

> The Go memory model specifies the conditions under which reads of a variable in one goroutine can be guaranteed to observe values produced by writes to the same variable in a different goroutine.

The mechanism is a partial order called **happens-before** on the events of a program execution.

A read `r` observes a write `w` only if:

1. `w` happens-before `r`, AND
2. No other write `w'` to the same location happens-after `w` and happens-before `r`.

If conditions 1-2 do not hold, the read may observe any of the prior writes, including the zero value, an interleaved partial value, or a value from after `r` in program order.

---

## Synchronising Operations

The Go memory model recognises the following operations as creating happens-before edges:

1. **Channel send**: send on a channel happens-before the corresponding receive completes.
2. **Channel close**: close happens-before a receive that observes the close (returns `ok=false`).
3. **Channel receive (unbuffered)**: receive completes after the matching send.
4. **`sync.Mutex.Unlock`**: happens-before the next `Lock`.
5. **`sync.RWMutex.Unlock`**: happens-before the next `RLock` and `Lock`.
6. **`sync.RWMutex.RUnlock`**: happens-before the next `Lock`.
7. **`sync.Once.Do(f)`**: the call to `f` happens-before the return of any later `Do(f)`.
8. **`sync.WaitGroup.Done`**: happens-before any `Wait` that decrements the counter to zero.
9. **`go f()`**: the `go` statement happens-before the start of `f`.
10. **`sync/atomic` operations**: see Atomic Operations.

Within a single goroutine, program-order (sequential) implies happens-before for that goroutine.

---

## Atomic Operations

Go's `sync/atomic` operations provide:

- **Atomicity**: the operation is indivisible; no torn reads/writes.
- **Sequential consistency**: relative to other atomic operations on any variable, all atomic operations appear to execute in some single global order consistent with each goroutine's program order.

In particular: an atomic store `S` and an atomic load `L` of the same variable: if `L` returns the value stored by `S`, then `S` happens-before `L`.

This is *stronger* than C/C++ relaxed atomics. Go's atomics are SC by spec; you cannot opt for weaker semantics.

Mixed-mode access (atomic and non-atomic on the same location) is a data race.

---

## Happens-Before Order

Happens-before is the smallest partial order such that:

- Within one goroutine: program order is happens-before.
- Across goroutines: any synchronising operation from the list above creates an edge.

The order is **transitive**: if `A → B` and `B → C`, then `A → C`.

The order is **partial**: many operations are unordered. Two operations on different goroutines with no synchronising operation between them are unordered.

---

## Data Race: Formal Definition

**A program contains a data race if there exist two conflicting memory operations `o1` and `o2` such that:**

- They access the same memory location.
- At least one of them is a write.
- They are performed by different goroutines.
- Neither happens-before the other.
- At least one of them is non-atomic.

The Go memory model leaves the result of any program containing a data race **undefined**. In practice, Go programs with races may compute correct answers most of the time and fail intermittently, panic at runtime, corrupt memory, or be exploited.

---

## Detector Contract

The race detector, enabled by `-race`, instruments memory accesses and reports a race when it observes one.

**Promise**: if the detector reports a race, the program contains a race (subject to extremely rare implementation bugs).

**Non-promise**: if the detector does NOT report a race, the program may still contain a race that did not manifest during the run.

The detector is *sound* (no false positives in practice) but *incomplete* (does not prove absence of races).

The detector tracks:
- Up to ~8128 active goroutines.
- All memory accesses except those in cgo and some unsafe pointer arithmetic.
- All synchronising operations listed above.

Performance: ~5-10x CPU slowdown, ~2-3x memory overhead.

---

## Race Report Format

The detector emits race reports to stderr. The standard format:

```
==================
WARNING: DATA RACE
{Read|Write} at 0x{addr} by goroutine {N}:
  {function name}()
      {file}:{line} +0x{offset}
  {caller}()
      {file}:{line} +0x{offset}

Previous {read|write} at 0x{addr} by goroutine {M}:
  {function name}()
      {file}:{line} +0x{offset}
  {caller}()
      {file}:{line} +0x{offset}

Goroutine {N} ({state}) created at:
  {function name}()
      {file}:{line} +0x{offset}

Goroutine {M} ({state}) created at:
  {function name}()
      {file}:{line} +0x{offset}
==================
```

Fields:
- `addr`: hex address of the conflicting variable.
- `goroutine N` / `goroutine M`: numeric IDs internal to the runtime.
- `state`: `running`, `finished`, `sleeping`, etc.

---

## Detector Limits

The detector cannot report a race that does not occur during the run. Common reasons:

1. The two conflicting accesses never happen in the same execution.
2. Scheduling places them in a non-conflicting order on every test run.
3. The accesses are inside cgo (uninstrumented).
4. The accesses use `unsafe` pointer arithmetic that escapes instrumentation.
5. The detector hits its goroutine cap (~8128).

The detector also cannot:
- Detect logical race conditions (e.g., check-then-act without the race being a data race).
- Detect deadlocks (use `go vet` and `pprof` for those).
- Detect goroutine leaks (use `goleak`).

---

## Build and Run Flags

| Flag | Effect |
|------|--------|
| `-race` (build/run) | Enable race instrumentation. |
| `GORACE=halt_on_error=1` | Stop on first race. |
| `GORACE=exitcode=N` | Exit with code N on race. |
| `GORACE=log_path=path` | Write reports to file. |
| `GORACE=history_size=N` | Per-address access history depth. |
| `GORACE=strip_path_prefix=path` | Strip prefix from reported paths. |

Standard CI invocation:

```bash
GORACE="halt_on_error=1 exitcode=66" go test -race -count=1 ./...
```

---

## Compliance Checks

A specification-compliant test suite for race-aware code:

1. All tests pass under `go test -race`.
2. CI runs `-race` on every PR.
3. CI runs `-race -count=N -cpu=1,4,8` for stress-prone packages.
4. `go vet` and `staticcheck` clean.
5. `goleak` reports no leaks.
6. No use of `time.Sleep` for synchronisation in tests.

For library code that exposes concurrent APIs:

- Documented thread-safety guarantees per type (e.g., "All methods are safe for concurrent use").
- Documented locking discipline (which fields guarded by which lock).
- All exported atomic fields use `atomic.Int*` typed wrappers (Go 1.19+) or 8-byte alignment is documented.

---

## Summary

A data race in Go is a precise violation of the memory model: two unsynchronised conflicting memory operations across goroutines, at least one a write, at least one non-atomic. The race detector is sound but incomplete; it instruments memory and reports observed races. The Go memory model defines the synchronising operations that create happens-before edges. Compliance requires `-race` in CI, atomic and lock discipline, and tooling beyond just the detector.
