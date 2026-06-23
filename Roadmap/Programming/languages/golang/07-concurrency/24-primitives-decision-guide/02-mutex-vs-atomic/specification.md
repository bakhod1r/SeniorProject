---
layout: default
title: Mutex vs Atomic — Specification
parent: Mutex vs Atomic
grand_parent: Primitives Decision Guide
ancestor: Go
nav_order: 4
has_children: false
permalink: /roadmap/programming-languages/golang/07-concurrency/24-primitives-decision-guide/02-mutex-vs-atomic/specification/
---

# Mutex vs Atomic — Specification

[← Back](../)

## Table of Contents
1. [Introduction](#introduction)
2. [The Go Memory Model on `sync/atomic`](#the-go-memory-model-on-syncatomic)
3. [Package `sync/atomic` Documentation Contract](#package-syncatomic-documentation-contract)
4. [The Go 1.19 Typed Atomic Proposal — #50860](#the-go-119-typed-atomic-proposal--50860)
5. [Alignment Rules and the 32-bit ARM Trap](#alignment-rules-and-the-32-bit-arm-trap)
6. [Sequential Consistency Statement](#sequential-consistency-statement)
7. [Source-Tree Pointers](#source-tree-pointers)
8. [Cross-Reference Table](#cross-reference-table)
9. [References](#references)

---

## Introduction

This file collects the normative statements that constrain the behaviour of `sync/atomic` and `sync.Mutex` in Go. Where the Go memory model is silent, the package documentation and proposal #50860 fill in the gaps. Citations are paraphrased; pointers to the original text are at the end.

---

## The Go Memory Model on `sync/atomic`

The Go memory model (https://go.dev/ref/mem) was rewritten in Go 1.19 to make atomics explicit. The relevant clauses:

### Sequential consistency of atomic operations

> The APIs in the `sync/atomic` package are collectively "atomic operations" that can be used to synchronise the execution of different goroutines. If the effect of an atomic operation A is observed by atomic operation B, then A is synchronised before B. All the atomic operations executed in a program behave as though executed in some sequentially consistent order.

This is the strongest possible ordering. There is no `Acquire`, `Release`, or `Relaxed` variant in `sync/atomic` (unlike C++11 `std::atomic` or Rust's `Ordering` enum). Every operation is full sequentially consistent (SC).

Implication: an `atomic.StoreInt32(&x, 1)` followed by `atomic.LoadInt32(&y)` on one goroutine, paired with `atomic.StoreInt32(&y, 1)` followed by `atomic.LoadInt32(&x)` on another, cannot both read zero. (This is Dekker's algorithm; SC guarantees it works.)

### Happens-before for atomics

> An atomic load of a value V, which observes the atomic store of the value, happens after the atomic store.

A consequence: writes performed before the atomic store on goroutine A are visible to reads performed after the atomic load on goroutine B, provided the load observed that store.

### No mixed access

> The `sync/atomic` package documents that a memory location may be accessed atomically (using one of the package's functions) or non-atomically, but never both. The Go memory model does not specify the result of a mixed atomic and non-atomic access to the same location.

This is the **atomic-or-protected rule**: once a word is accessed atomically anywhere, every access to that word (read or write) must go through `sync/atomic`. The race detector enforces this at runtime.

---

## Package `sync/atomic` Documentation Contract

From the doc comment in `src/sync/atomic/doc.go` (Go 1.22):

> Package atomic provides low-level atomic memory primitives useful for implementing synchronisation algorithms. These functions require great care to be used correctly. Except for special, low-level applications, synchronisation is better done with channels or the facilities of the `sync` package. Share memory by communicating; don't communicate by sharing memory.

> The swap operation, implemented by the SwapT functions, is the atomic equivalent of: `old = *addr; *addr = new; return old`.

> The compare-and-swap operation, implemented by the CompareAndSwapT functions, is the atomic equivalent of: `if *addr == old { *addr = new; return true } else { return false }`.

> The add operation, implemented by the AddT functions, is the atomic equivalent of: `*addr += delta; return *addr`.

> The load and store operations, implemented by the LoadT and StoreT functions, are the atomic equivalents of `return *addr` and `*addr = val`.

### Listed operations

For each of int32, int64, uint32, uint64, uintptr, and unsafe.Pointer:

| Function | Semantics |
|---|---|
| `LoadT(addr *T) T` | Atomic read |
| `StoreT(addr *T, val T)` | Atomic write |
| `AddT(addr *T, delta T) T` | Atomic add, returns new value |
| `SwapT(addr *T, new T) T` | Atomic swap, returns old |
| `CompareAndSwapT(addr *T, old, new T) bool` | CAS |

`AddUintptr` does not exist for `unsafe.Pointer` (you cannot add a delta to a pointer atomically).

### `atomic.Value`

> A Value provides an atomic load and store of a consistently typed value. The zero value for a Value returns nil from Load. Once Store has been called, a Value must not be copied. A Value must not be copied after first use.

`atomic.Value.Store` requires the dynamic type of every store to match. The first store fixes the type.

---

## The Go 1.19 Typed Atomic Proposal — #50860

Proposal: https://github.com/golang/go/issues/50860 (accepted, implemented in Go 1.19, January 2022).

### Motivation

The function-based API (`atomic.LoadInt64(&x)`) has three problems:

1. It is easy to forget the atomic prefix and read `x` directly, racing.
2. It does not signal intent in the type; reading the struct definition does not tell you the field is concurrent.
3. The 32-bit alignment rule is invisible — you have to know that `int64` fields shared by `Add/Load/Store` must be 8-byte aligned on 32-bit ARM.

### The new types

Added in `src/sync/atomic/type.go`:

```go
type Bool struct { _ noCopy; v uint32 }
type Int32 struct { _ noCopy; v int32 }
type Int64 struct { _ noCopy; _ align64; v int64 }
type Uint32 struct { _ noCopy; v uint32 }
type Uint64 struct { _ noCopy; _ align64; v uint64 }
type Uintptr struct { _ noCopy; v uintptr }
type Pointer[T any] struct { _ [0]*T; _ noCopy; v unsafe.Pointer }
```

Each exposes `Load`, `Store`, `Swap`, `CompareAndSwap` (and `Add` where it makes sense). `Pointer[T]` is the only generic type in `sync/atomic` and the first place in the stdlib where Go used generics for a real type-safe API.

### `align64`

```go
// align64 may be added to structs that must be 64-bit aligned.
// This struct is recognized by a special case in the compiler
// and will not work if copied to any other package.
type align64 struct{}
```

This is the spec'd workaround for the 32-bit alignment problem (see next section). On 64-bit platforms it is zero-sized and inert; on 32-bit platforms the compiler inserts padding so the next field starts on an 8-byte boundary.

### `noCopy`

```go
type noCopy struct{}
func (*noCopy) Lock() {}
func (*noCopy) Unlock() {}
```

`go vet` flags any copy of a struct containing a `noCopy` field. This catches the common bug of passing `atomic.Int64` by value to a function.

---

## Alignment Rules and the 32-bit ARM Trap

### The rule

From `src/sync/atomic/doc.go`, the BUG note:

> On ARM, 386, and 32-bit MIPS, it is the caller's responsibility to arrange for 64-bit alignment of 64-bit words accessed atomically. The first word in a variable or in an allocated struct, array, or slice can be relied upon to be 64-bit aligned.

### Why

On 32-bit ARMv7, a 64-bit load or store is not a single instruction. The implementation in `src/internal/runtime/atomic/atomic_arm.s` uses `LDREXD`/`STREXD` (load-/store-exclusive double) which **requires** the address to be 8-byte aligned. An unaligned `LDREXD` raises a SIGBUS/SIGSEGV. The runtime cannot recover.

### The trap

```go
type Stats struct {
    Count   uint32       // 4 bytes
    Latency atomic.Int64 // wants 8-byte alignment
}
```

On 32-bit ARM, `Latency` starts at offset 4, not 8. Before Go 1.19, this crashed at runtime on the first `Latency.Add(1)`. With `atomic.Int64` (which contains the magic `align64`), the compiler inserts padding so `Latency` starts at offset 8.

### The pre-1.19 workaround

```go
type Stats struct {
    Latency int64  // put 64-bit fields FIRST
    Count   uint32
}
```

The doc says "the first word in a variable or in an allocated struct ... can be relied upon to be 64-bit aligned." Putting `int64` fields first inside a struct that is itself heap-allocated (or stack-allocated at a runtime-aligned offset) was the standard workaround.

### Stack alignment

On 32-bit ARM, the Go runtime aligns goroutine stacks to 8 bytes, so a `var x int64` in a function body is safely aligned. But a struct field at an odd offset, embedded inside a larger struct on the stack, is not.

---

## Sequential Consistency Statement

The Go memory model statement is unconditional:

> All the atomic operations executed in a program behave as though executed in some sequentially consistent order.

This is stricter than C++11's default (`memory_order_seq_cst` must be requested explicitly) and stricter than Java's `volatile` (which is per-variable SC, not program-wide SC). The cost is that on weakly ordered architectures (ARM64, ARMv7, RISC-V), every atomic store requires a `DMB ISH` barrier and every atomic load requires a `DMB ISH` barrier (or an acquire-load + barrier). On amd64, sequential consistency is free for loads (they are SC by default on x86) but stores need an `MFENCE` or a `LOCK`-prefixed instruction.

The Go team has discussed but not adopted relaxed atomics (proposal #41980). The argument against: relaxed atomics are dramatically harder to reason about, and Go's design philosophy prefers simplicity. The argument for: high-frequency counters waste cycles on barriers they do not need. As of Go 1.22 the matter is closed.

---

## Source-Tree Pointers

| File | What |
|---|---|
| `src/sync/atomic/doc.go` | Package documentation, function signatures |
| `src/sync/atomic/type.go` | `Bool`, `Int32`, `Int64`, `Pointer[T]`, etc |
| `src/sync/atomic/value.go` | `atomic.Value` implementation |
| `src/internal/runtime/atomic/atomic_amd64.s` | amd64 atomic implementations (`LOCK XADD`, `LOCK CMPXCHG`) |
| `src/internal/runtime/atomic/atomic_arm.s` | ARMv7 implementations (`LDREXD`/`STREXD` loop) |
| `src/internal/runtime/atomic/atomic_arm64.s` | ARM64 implementations (`LDAXR`/`STLXR`) |
| `src/sync/mutex.go` | `sync.Mutex` — itself built on `atomic.CompareAndSwapInt32` |
| `src/runtime/lock_futex.go` | `runtime.futex` backing for contended mutex |

### `sync.Mutex` is built on atomics

A quick peek at `Mutex.Lock`:

```go
func (m *Mutex) Lock() {
    if atomic.CompareAndSwapInt32(&m.state, 0, mutexLocked) {
        return
    }
    m.lockSlow()
}
```

The fast path is a single CAS. The slow path enters spinning, then futex-park. This is why an uncontended mutex costs ~2x an atomic CAS: it is one CAS to lock plus one atomic store to unlock.

---

## Cross-Reference Table

| Concept | Go memory model | Package doc | Source |
|---|---|---|---|
| Atomic SC ordering | https://go.dev/ref/mem#atomic | `sync/atomic` package comment | `src/sync/atomic/doc.go` |
| No mixed access | https://go.dev/ref/mem#atomic | — | enforced by race detector |
| 32-bit alignment | — | `BUG` section in `doc.go` | `src/sync/atomic/doc.go:280` |
| Typed atomics | — | `Int64`, `Pointer[T]` godoc | `src/sync/atomic/type.go` |
| `atomic.Value` typed-once | — | `Value.Store` godoc | `src/sync/atomic/value.go` |
| `align64` magic | — | not documented externally | `src/sync/atomic/type.go:8` |

---

## Atomic vs Volatile vs `sync.Mutex` — Formal Semantics

### Volatile

Go has no `volatile` keyword. C and C++ `volatile` ensures the compiler does not reorder, fold, or eliminate accesses to a variable, but it gives no inter-thread ordering — you still need atomics for cross-thread visibility. Go folds these two concerns into `sync/atomic`: an atomic access is both compiler-fence and memory-barrier-fence in one.

### Mutex memory-model statement

> If the effect of an unlock operation on a Mutex M is observed by a lock operation on M, then the unlock is synchronised before the lock.

This is the standard mutex acquire-release. Combined with the program-order rule (every operation in a goroutine is synchronised before the next operation in the same goroutine), it means: writes done before `mu.Unlock()` are visible to reads done after `mu.Lock()` on another goroutine — provided the Lock observed the Unlock.

This is equivalent to the C++11 `acquire`/`release` pattern on a `std::mutex`, but written in terms of `sync-before` rather than `happens-before` directly.

### `sync.Once`

> A successful return from `Once.Do` is synchronised before the start of any later call to `Once.Do`.

Important nuance: only a SUCCESSFUL Do (i.e., the one that ran `f`) establishes the synchronisation. Subsequent calls return immediately but still see the effects.

---

## The `RWMutex` Specification

From `src/sync/rwmutex.go`:

> If a goroutine holds a RWMutex for reading and another goroutine might call Lock, no goroutine should expect to be able to acquire a read lock until the initial read lock is released. In particular, this prohibits recursive read locking.

The behaviour: a pending writer blocks new readers. This prevents writer starvation but means even `RLock` may queue. The implementation uses `atomic.Int32` (`readerCount`, `readerWait`, `writerSem`) on the fast path, falling back to semaphores on contention.

For the relationship to `sync/atomic`: `RWMutex.RLock` does an atomic increment on `readerCount` and a fast-path return if no writer is pending. So `RWMutex` is itself built on top of atomics.

---

## Cross-Language Comparison

| Concept | Go | C++11 | Java | Rust |
|---|---|---|---|---|
| Default ordering | SC | SC | (per-construct) | (per-construct) |
| Relaxed ordering | none | `memory_order_relaxed` | `lazySet` (`Atomic*`) | `Ordering::Relaxed` |
| Acquire/release | implicit in mutex/channel | `memory_order_acq_rel` | `volatile`, `AtomicReference` | `Ordering::AcqRel` |
| 64-bit alignment on 32-bit | manual (or `atomic.Int64`) | guaranteed by `std::atomic` | guaranteed (`AtomicLong`) | guaranteed (`AtomicI64`) |
| CAS | `CompareAndSwap` | `compare_exchange_strong/weak` | `compareAndSet` | `compare_exchange` |
| Strong vs weak CAS | strong only | both | strong only | both |
| Weak CAS spurious failure | none | allowed | none | allowed |

Go's commitment to sequential consistency makes it easier to reason about than C++ or Rust, at the cost of barrier overhead on weakly ordered architectures. The Go team has rejected relaxed atomics (issue #41980); the matter is closed.

---

## Documented Concurrency Contracts in `sync/atomic`

| Function | Contract |
|---|---|
| `LoadT(addr)` | Atomically returns `*addr`. Establishes happens-before with prior atomic stores observed. |
| `StoreT(addr, v)` | Atomically writes `v` to `*addr`. Sequentially consistent with all other atomic ops. |
| `AddT(addr, delta)` | Atomically does `*addr += delta` and returns the new value. |
| `SwapT(addr, new)` | Atomically writes `new` to `*addr` and returns the old value. |
| `CompareAndSwapT(addr, old, new)` | If `*addr == old`, set `*addr = new` and return true; else return false. Atomic. |

For `unsafe.Pointer` and `Pointer[T]`, no `Add`. For `Bool`, no `Add` (boolean addition is meaningless). For `Value`, no `Add` and no straightforward CAS until Go 1.17.

### `noCopy` and `align64`

These are internal helper types defined in `src/sync/atomic/type.go`:

```go
// noCopy may be added to structs which must not be copied
// after the first use.
//
// See https://golang.org/issues/8005#issuecomment-190753527
// for details.
//
// Note that it must not be embedded, due to the Lock and Unlock methods.
type noCopy struct{}

// Lock is a no-op used by -copylocks checker from `go vet`.
func (*noCopy) Lock()   {}
func (*noCopy) Unlock() {}

// align64 may be added to structs that must be 64-bit aligned.
type align64 struct{}
```

The `Lock`/`Unlock` methods on `noCopy` are stubs: they exist only so `go vet -copylocks` (which looks for types with `Lock`/`Unlock` and flags copies of them) catches accidental copies.

---

## Source-Tree Pointers — Detailed

| File | What |
|---|---|
| `src/sync/atomic/doc.go` | Package documentation, function signatures |
| `src/sync/atomic/type.go` | `Bool`, `Int32`, `Int64`, `Pointer[T]`, etc |
| `src/sync/atomic/value.go` | `atomic.Value` implementation, `Store`/`Load`/`Swap`/`CompareAndSwap` |
| `src/sync/atomic/asm.s` | Stub `TEXT` declarations pointing to `runtime/internal/atomic` |
| `src/internal/runtime/atomic/atomic_amd64.s` | amd64 atomic implementations |
| `src/internal/runtime/atomic/atomic_arm.s` | ARMv7 implementations |
| `src/internal/runtime/atomic/atomic_arm64.s` | ARM64 implementations |
| `src/internal/runtime/atomic/atomic_riscv64.s` | RISC-V implementations |
| `src/sync/mutex.go` | `sync.Mutex` — itself built on `atomic.CompareAndSwapInt32` |
| `src/sync/rwmutex.go` | `sync.RWMutex` |
| `src/runtime/lock_futex.go` | `runtime.futex` backing for contended mutex |
| `src/runtime/lock_sema.go` | Semaphore-based fallback for platforms without futex |

### How `sync.Mutex` uses atomics

```go
func (m *Mutex) Lock() {
    if atomic.CompareAndSwapInt32(&m.state, 0, mutexLocked) {
        if race.Enabled {
            race.Acquire(unsafe.Pointer(m))
        }
        return
    }
    m.lockSlow()
}
```

Fast path: single CAS to flip `0 -> mutexLocked`. Slow path: spinning (4 iterations of `runtime.procyield` on multi-core), then futex park.

```go
func (m *Mutex) Unlock() {
    new := atomic.AddInt32(&m.state, -mutexLocked)
    if new != 0 {
        m.unlockSlow(new)
    }
}
```

Fast path: single `XADD` to clear the locked bit. Slow path if there are waiters: `futex_wake` to unpark one.

So an uncontended mutex is two atomics: one CAS to lock, one ADD to unlock. The atomic operation itself is just one. This explains why "uncontended mutex is 2x atomic" is a reasonable rule of thumb.

---

## References

1. The Go Memory Model — https://go.dev/ref/mem
2. `sync/atomic` package — https://pkg.go.dev/sync/atomic
3. Proposal #50860 (typed atomics) — https://github.com/golang/go/issues/50860
4. Proposal #41980 (relaxed atomics, rejected) — https://github.com/golang/go/issues/41980
5. Russ Cox, "Updating the Go Memory Model" (2021) — https://research.swtch.com/gomm
6. ARM Architecture Reference Manual, §A2.5 (synchronisation primitives) — for `LDREXD`/`STREXD` alignment
7. Intel SDM Vol 3A §8.2 (memory ordering on amd64)
8. C++11 §29 (atomic operations library) — for contrast with Go's SC-only model
9. Hans-J. Boehm, "Threads Cannot Be Implemented as a Library" (HP Labs, 2004) — foundational paper on why memory models matter
10. Paul McKenney, "Memory Barriers: a Hardware View for Software Hackers" — practical primer on cache coherence
