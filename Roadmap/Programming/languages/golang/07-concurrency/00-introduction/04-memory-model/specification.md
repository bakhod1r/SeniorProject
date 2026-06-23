# Memory Model — Specification

## Table of Contents
1. [Introduction](#introduction)
2. [The 2022 Go Memory Model](#the-2022-go-memory-model)
3. [Synchronisation Rules in Detail](#synchronisation-rules-in-detail)
4. [The `sync/atomic` API Reference](#the-syncatomic-api-reference)
5. [The `sync` API Reference](#the-sync-api-reference)
6. [Race Detector Documentation](#race-detector-documentation)
7. [Related Standards and Papers](#related-standards-and-papers)
8. [References](#references)

---

## Introduction

This file collects authoritative documentation for the Go memory model and related synchronisation primitives.

---

## The 2022 Go Memory Model

The current document lives at `https://go.dev/ref/mem`. It was rewritten in June 2022 by Russ Cox.

### Key sections

#### Definition of a data race

> A *data race* is a write to a memory location happening concurrently with another read or write to that same location, unless all the accesses involved are atomic data accesses as provided by the `sync/atomic` package or atomic primitive types in the `sync/atomic` package's accompanying typed wrappers.

#### Programs with races

> Programs with data races are *racy*. The execution of a racy Go program is undefined: the data race may cause undefined behaviour, including [crashing the program, returning unexpected results, or appearing to succeed without producing the expected results]. The compiler, runtime, and library are not required to take any specific action when a data race is detected.

#### The happens-before relation

> Within a single goroutine, the happens-before order is the order expressed by the program.
>
> A read *r* of a memory location *x* is allowed to observe a write *w* to *x* if both of the following hold:
> 1. *r* does not happen before *w*.
> 2. There is no other write *w'* to *x* that happens after *w* but before *r*.

#### Synchronisation operations

The model lists, with precise definitions:

- The `init` function and program startup.
- The `go` statement and goroutine creation.
- Channel send, receive, and close.
- Mutex lock and unlock (`sync.Mutex.Lock/Unlock`).
- RWMutex (`sync.RWMutex.RLock/RUnlock/Lock/Unlock`).
- `sync.Once.Do`.
- `sync.WaitGroup.Wait` / `Done`.
- Atomic operations.
- `runtime.Goexit`.
- `runtime.GC` (with caveats).

Each section gives the precise happens-before guarantees.

---

## Synchronisation Rules in Detail

### Channel operations

From the spec:

> A send on a channel is *synchronized before* the completion of the corresponding receive from that channel.
>
> The *k*th receive on a channel with capacity *C* is *synchronized before* the completion of the (*k*+*C*)th send from that channel.
>
> The closing of a channel is *synchronized before* a receive that returns because the channel is closed.
>
> A receive from an unbuffered channel is *synchronized before* the completion of the corresponding send on that channel.

Note: the last rule is for unbuffered channels only. It is a stronger version of the first rule.

### Mutex operations

> For any `sync.Mutex` or `sync.RWMutex` variable `l` and *n* < *m*, call *n* of `l.Unlock()` is *synchronized before* call *m* of `l.Lock()` returns.

In simpler terms: the *n*th unlock happens-before the *(n+1)*th lock returns.

### RWMutex specifics

> The *n*th call to `l.RUnlock` is *synchronized before* the (*n+1*)th call to `l.Lock` returns. The *n*th call to `l.Unlock` is *synchronized before* any call to `l.RLock`.

### `sync.Once`

> The completion of a single call of `f()` *happens before* the return of any call of `once.Do(f)`.

### `sync.WaitGroup`

> A `wg.Done` call *synchronizes before* the return of any `wg.Wait` call that it unblocks.

### Atomic operations

> The APIs in the `sync/atomic` package are collectively "atomic operations" that can be used to synchronize the execution of different goroutines. If the effect of an atomic operation A is observed by atomic operation B, then A is synchronized before B.

This means every atomic operation has a sequentially-consistent ordering with respect to every other atomic operation in the program.

### Goroutine creation

> The `go` statement that starts a new goroutine *happens before* the goroutine's execution begins.

### Goroutine destruction

> The exit of a goroutine is not guaranteed to *happen before* any event in the program.

Important: do not rely on a goroutine's exit for synchronisation. Use `sync.WaitGroup` or channels explicitly.

---

## The `sync/atomic` API Reference

From `https://pkg.go.dev/sync/atomic`:

### Function form (legacy, all Go versions)

```go
func LoadInt32(addr *int32) (val int32)
func LoadInt64(addr *int64) (val int64)
func LoadUint32(addr *uint32) (val uint32)
func LoadUint64(addr *uint64) (val uint64)
func LoadUintptr(addr *uintptr) (val uintptr)
func LoadPointer(addr *unsafe.Pointer) (val unsafe.Pointer)

func StoreInt32(addr *int32, val int32)
func StoreInt64(addr *int64, val int64)
// ... etc.

func AddInt32(addr *int32, delta int32) (new int32)
func AddInt64(addr *int64, delta int64) (new int64)
// ... etc.

func SwapInt32(addr *int32, new int32) (old int32)
// ... etc.

func CompareAndSwapInt32(addr *int32, old, new int32) (swapped bool)
// ... etc.
```

Caveat: on 32-bit ARM, the address passed to a 64-bit atomic must be 8-byte aligned. The compiler does not always guarantee this for struct fields; use the struct form or pad manually.

### Struct form (Go 1.19+)

```go
type Bool struct { /* ... */ }
func (x *Bool) Load() bool
func (x *Bool) Store(val bool)
func (x *Bool) Swap(new bool) (old bool)
func (x *Bool) CompareAndSwap(old, new bool) (swapped bool)

type Int32 struct { /* ... */ }
type Int64 struct { /* ... */ }
type Uint32 struct { /* ... */ }
type Uint64 struct { /* ... */ }
type Uintptr struct { /* ... */ }

type Pointer[T any] struct { /* ... */ }  // Go 1.19+
func (x *Pointer[T]) Load() *T
func (x *Pointer[T]) Store(val *T)
// ... etc.

type Value struct { /* ... */ }
func (v *Value) Load() (val any)
func (v *Value) Store(val any)
func (v *Value) Swap(new any) (old any)
func (v *Value) CompareAndSwap(old, new any) (swapped bool)
```

`atomic.Value` is type-erased; `atomic.Pointer[T]` is type-safe (generics).

---

## The `sync` API Reference

From `https://pkg.go.dev/sync`:

### `sync.Mutex`

```go
type Mutex struct { /* opaque */ }
func (m *Mutex) Lock()
func (m *Mutex) TryLock() bool   // Go 1.18+
func (m *Mutex) Unlock()
```

Not reentrant. Calling Lock when already locked by the same goroutine deadlocks.

### `sync.RWMutex`

```go
type RWMutex struct { /* opaque */ }
func (rw *RWMutex) Lock()
func (rw *RWMutex) TryLock() bool   // Go 1.18+
func (rw *RWMutex) Unlock()
func (rw *RWMutex) RLock()
func (rw *RWMutex) TryRLock() bool  // Go 1.18+
func (rw *RWMutex) RUnlock()
func (rw *RWMutex) RLocker() Locker
```

### `sync.Once`

```go
type Once struct { /* opaque */ }
func (o *Once) Do(f func())
```

### `sync.WaitGroup`

```go
type WaitGroup struct { /* opaque */ }
func (wg *WaitGroup) Add(delta int)
func (wg *WaitGroup) Done()
func (wg *WaitGroup) Wait()
```

### `sync.Map`

```go
type Map struct { /* opaque */ }
func (m *Map) Load(key any) (value any, ok bool)
func (m *Map) Store(key, value any)
func (m *Map) LoadOrStore(key, value any) (actual any, loaded bool)
func (m *Map) LoadAndDelete(key any) (value any, loaded bool)
func (m *Map) Delete(key any)
func (m *Map) Swap(key, value any) (previous any, loaded bool)
func (m *Map) CompareAndSwap(key, old, new any) bool
func (m *Map) CompareAndDelete(key, old any) (deleted bool)
func (m *Map) Range(f func(key, value any) bool)
```

Optimised for read-mostly workloads.

### `sync.Pool`

```go
type Pool struct {
    New func() any
}
func (p *Pool) Get() any
func (p *Pool) Put(x any)
```

A per-goroutine cache of reusable objects. Cleared at every GC.

### `sync.Cond`

```go
type Cond struct {
    L Locker
}
func NewCond(l Locker) *Cond
func (c *Cond) Wait()
func (c *Cond) Signal()
func (c *Cond) Broadcast()
```

Rarely needed; channels are usually more idiomatic.

---

## Race Detector Documentation

From `https://go.dev/doc/articles/race_detector`:

> The race detector flag is `-race`. The race detector is integrated with the Go tools, and can be enabled by adding the `-race` flag to a build / run / test command:
>
> ```
> $ go test -race mypkg    // to test the package
> $ go run -race mysrc.go  // to run the source file
> $ go build -race mycmd   // to build the command
> $ go install -race mypkg // to install the package
> ```
>
> [The race detector] runs the program with the race detector enabled. The race detector reports races to standard error.

### Limitations

- Only races that occur during execution are reported.
- Not all races are caught (e.g., races in Cgo code).
- Race-instrumented binaries are 2–10x slower and use 5–10x more memory.

### Output format

```
WARNING: DATA RACE
Read at 0x00c0000180a0 by goroutine 7:
  main.read()
      /path/to/file.go:11 +0x58

Previous write at 0x00c0000180a0 by goroutine 6:
  main.write()
      /path/to/file.go:6 +0x42

Goroutine 7 (running) created at:
  main.main()
      /path/to/file.go:18 +0x9e

Goroutine 6 (finished) created at:
  main.main()
      /path/to/file.go:17 +0x84
```

---

## Related Standards and Papers

### The 2014 Go memory model

The original document (now superseded). Mostly compatible with the 2022 version, but with less formal precision and weaker atomics semantics.

### C++ memory model (since C++11)

Defines `std::memory_order_relaxed`, `acquire`, `release`, `acq_rel`, `seq_cst`. More expressive than Go's, but harder to use correctly.

### Java memory model (JSR 133, 2004)

The first widely-deployed formal memory model for a mainstream language. Defines `volatile`, `synchronized`, `final` field semantics. Heavily influenced Go.

### x86 memory model (TSO)

Documented in *Intel 64 and IA-32 Architectures Software Developer's Manual, Volume 3A: Chapter 8*. Free PDF from Intel.

### ARM memory model

Documented in *Arm Architecture Reference Manual, Section B2*. Free PDF from Arm.

### Russ Cox's series

- *Hardware Memory Models* (2021): <https://research.swtim.com/mm/hwmm.html>
- *Programming Language Memory Models* (2021): <https://research.swtim.com/mm/plmm.html>
- *Updating the Go Memory Model* (2022): <https://research.swtim.com/mm/go.html>

These are the most accessible modern treatment of memory models.

### Academic papers

- Adve and Boehm, *Memory Models: A Case for Rethinking Parallel Languages and Hardware*, CACM 2010.
- Sewell et al., *x86-TSO: A Rigorous and Usable Programmer's Model for x86 Multiprocessors*, CACM 2010.
- Boehm and Adve, *Foundations of the C++ Concurrency Memory Model*, PLDI 2008.

---

## References

- The Go Memory Model: <https://go.dev/ref/mem>
- The race detector: <https://go.dev/doc/articles/race_detector>
- `sync` package: <https://pkg.go.dev/sync>
- `sync/atomic` package: <https://pkg.go.dev/sync/atomic>
- `go.uber.org/goleak`: <https://pkg.go.dev/go.uber.org/goleak>
- Russ Cox, *Hardware Memory Models*: <https://research.swtim.com/mm/hwmm.html>
- Russ Cox, *Programming Language Memory Models*: <https://research.swtim.com/mm/plmm.html>
- Russ Cox, *Updating the Go Memory Model*: <https://research.swtim.com/mm/go.html>
- Hans Boehm, *Threads Cannot be Implemented as a Library*, PLDI 2005.
- Sarita Adve, Hans Boehm, *Memory Models: A Case for Rethinking*, CACM 2010.
- *The Art of Multiprocessor Programming* by Herlihy and Shavit, 2nd ed.
- Java Specification Request 133: <https://jcp.org/en/jsr/detail?id=133>
- C++11 memory model: <https://en.cppreference.com/w/cpp/atomic/memory_order>
