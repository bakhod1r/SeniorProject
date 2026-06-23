---
layout: default
title: Senior
parent: Mutex Copying
grand_parent: Concurrency Anti-Patterns
ancestor: Go
nav_order: 3
permalink: /roadmap/programming-languages/golang/07-concurrency/15-concurrency-anti-patterns/02-mutex-copying/senior/
---

# Mutex Copying — Senior Level

## Table of Contents
1. [Introduction](#introduction)
2. [The internal layout of sync.Mutex](#the-internal-layout-of-syncmutex)
3. [The state word: bit-by-bit](#the-state-word-bit-by-bit)
4. [The sema word and runtime parking](#the-sema-word-and-runtime-parking)
5. [Why copying breaks every invariant](#why-copying-breaks-every-invariant)
6. [Value receivers — the silent corruption](#value-receivers--the-silent-corruption)
7. [Pointer receivers — when, why, and the costs](#pointer-receivers--when-why-and-the-costs)
8. [Embedded mutexes and method promotion](#embedded-mutexes-and-method-promotion)
9. [The sync.Locker interface — abstraction and traps](#the-synclocker-interface--abstraction-and-traps)
10. [The copylocks analyser — internals and edge cases](#the-copylocks-analyser--internals-and-edge-cases)
11. [Mutex profiling with -mutexprofile](#mutex-profiling-with--mutexprofile)
12. [Block profiling and contention](#block-profiling-and-contention)
13. [Go memory model implications](#go-memory-model-implications)
14. [Starvation mode and copy-induced unfairness](#starvation-mode-and-copy-induced-unfairness)
15. [Architectural patterns: encapsulation vs exposure](#architectural-patterns-encapsulation-vs-exposure)
16. [Designing types that refuse to be copied](#designing-types-that-refuse-to-be-copied)
17. [The noCopy idiom — full reference implementation](#the-nocopy-idiom--full-reference-implementation)
18. [Beyond Mutex: WaitGroup, Once, Cond, atomic.Value](#beyond-mutex-waitgroup-once-cond-atomicvalue)
19. [Refactoring legacy value-typed APIs](#refactoring-legacy-value-typed-apis)
20. [Senior-level checklist](#senior-level-checklist)
21. [Summary](#summary)

---

## Introduction

At the senior level, you are not learning that copying a mutex is wrong — you already know. You are learning *why* it is wrong at the machine level, *how* the runtime, the toolchain, and the standard library cooperate to detect it, and how to design APIs whose users cannot copy a mutex by accident. You are also learning to read mutex contention profiles, to reason about the memory model when a mutex is involved, and to distinguish copying bugs from other shapes of lock misuse such as recursive locking, lost wakeups, or unbalanced unlocks.

This document is heavy on internals. We open `sync/mutex.go`, look at the runtime semaphore in `runtime/sema.go`, walk through the `copylocks` analyser, and read mutex profiles. If you are building a system whose hot path passes through a `sync.Mutex` thousands of times per second, you need this level of understanding to make confident design decisions.

The senior-level mindset is: a mutex is not a *feature*; it is a *contract*. Every line of code that compiles around a mutex must respect the same invariants that the runtime expects. Copying the struct is the most spectacular way to violate that contract, but it is one of many. Once you see the internal state, the contract becomes obvious.

---

## The internal layout of sync.Mutex

`sync.Mutex` is two words. In the standard library it is declared as:

```go
package sync

type Mutex struct {
    state int32
    sema  uint32
}
```

That is the entire struct. On a 64-bit system, `unsafe.Sizeof(sync.Mutex{})` returns 8. On 32-bit systems, the same: two 32-bit words pack to 8 bytes. There is no pointer indirection, no allocation, no extra metadata. The mutex is intentionally tiny so it can be embedded freely.

But that tinyness is also why copying is so easy. `var b Mutex = a` is a single MOV instruction (on most architectures, two MOVs since the struct is two 32-bit words). The compiler is happy. The vet pass might or might not catch it depending on context. The runtime never gets a chance to object — copies happen entirely at the language level, before any runtime code runs.

The two fields play very different roles:

- `state` is the *fast path*. Lock attempts that find `state == 0` succeed with a single atomic compare-and-swap. The bits in `state` encode lock ownership, waiter count, and starvation mode.
- `sema` is the *slow path* identifier. When the fast path fails, the runtime parks the goroutine on a semaphore keyed by the *address* of `sema`. Two different `sema` words are two different parking lots.

Both fields must refer to the same memory across all goroutines for the mutex to work. Copying creates two independent pairs of `(state, sema)` words. Goroutines that lock the original park on one semaphore; goroutines that lock the copy park on another. Even if the original unlocker tries to wake a waiter, it broadcasts to the wrong parking lot.

### Confirming the layout in your own runtime

```go
package main

import (
    "fmt"
    "sync"
    "unsafe"
)

func main() {
    var m sync.Mutex
    fmt.Println("size:", unsafe.Sizeof(m))
    fmt.Println("align:", unsafe.Alignof(m))
    // Inspect raw bytes (do not do this in real code).
    p := (*[8]byte)(unsafe.Pointer(&m))
    fmt.Printf("zero: %x\n", *p)
    m.Lock()
    fmt.Printf("locked: %x\n", *p)
    m.Unlock()
    fmt.Printf("unlocked: %x\n", *p)
}
```

Run this on a modern build of Go and you will see all-zero bytes after construction, the low bits flip on `Lock`, and they return to zero on `Unlock`. The semaphore word remains zero in the unlocked-without-contention case — it only gains a non-zero value when a goroutine actually parked on it (and the runtime cleans it back to zero on the matching wakeup).

### Why the layout is stable in practice

The Go team has not added fields to `sync.Mutex` in over a decade. Tooling, third-party libraries, and even some internal runtime checks rely on the layout. If you write `unsafe`-style code that assumes two `int32`-sized fields, your code will keep working — but never write such code in production. Use the exported API.

The layout *is* visible through `reflect`:

```go
t := reflect.TypeOf(sync.Mutex{})
for i := 0; i < t.NumField(); i++ {
    f := t.Field(i)
    fmt.Printf("%s %s offset=%d\n", f.Name, f.Type, f.Offset)
}
// state int32 offset=0
// sema  uint32 offset=4
```

Reflection sees unexported fields too. This is how some debugging tools (delve, pprof annotations) display mutex state.

---

## The state word: bit-by-bit

The 32-bit `state` field packs four pieces of information:

| Bits | Mask | Name | Meaning |
|------|------|------|---------|
| 0 | `mutexLocked` (1) | locked | 1 if mutex is held |
| 1 | `mutexWoken` (2) | woken | 1 if a waiter has been woken and is racing |
| 2 | `mutexStarving` (4) | starving | 1 if mutex is in starvation mode |
| 3..31 | `mutexWaiterShift` (3) | waiters | shifted waiter count |

The constants in `sync/mutex.go` are:

```go
const (
    mutexLocked      = 1 << iota // mutex is locked
    mutexWoken                   // a goroutine was awakened
    mutexStarving                // mutex is in starvation mode
    mutexWaiterShift = iota      // 3

    starvationThresholdNs = 1e6 // 1 ms
)
```

Each `Lock` call does roughly:

```
old = atomic.LoadInt32(&state)
if old == 0 {
    atomic.CompareAndSwapInt32(&state, 0, mutexLocked)
    // fast path success
    return
}
// slow path: increment waiter count, park on sema
```

A `Unlock` call does roughly:

```
new = atomic.AddInt32(&state, -mutexLocked)
if new&mutexWaiterShift != 0 {
    // wake one waiter via sema
}
```

The exact algorithm is more involved (spinning, mode transitions), but the key point is: every access to `state` is an atomic operation on *this specific 32-bit location*. If you copy the mutex, the original `state` and the copy's `state` are two unrelated 32-bit locations. Atomic operations on one are invisible to the other.

### Concretely: what happens when state diverges

Suppose:

```go
var a sync.Mutex
a.Lock()
b := a // copy while locked
```

The byte layout right after `a.Lock()`:

```
a.state = 0x00000001 (locked, no waiters)
a.sema  = 0x00000000
```

After `b := a`:

```
a.state = 0x00000001
a.sema  = 0x00000000
b.state = 0x00000001 (copy)
b.sema  = 0x00000000
```

Now `b` looks locked, but it has never been locked by anyone. If a goroutine calls `b.Unlock()`, it will see `state == mutexLocked`, decrement it to `0`, and check for waiters. There are none, so it returns silently. No panic. The bug is invisible until either:

- Someone calls `b.Lock()` again — they get the lock, even though `a` is still "locked" elsewhere.
- Someone calls `a.Unlock()` — same story, but on a separate state word.

The race is split across two memory locations. Race detector catches it only when the *protected data* is accessed concurrently. The mutex itself is not racy at the language level — both `a.state` and `b.state` are accessed by their respective unlockers using legitimate atomics. The bug is purely a logic bug: same data, two different "locks" guarding it.

### The `mutexWaiterShift` field after copy

A copy that happens with waiters parked is even worse. Suppose `a` has 5 waiters:

```
a.state = 0x00000028 (5 << 3 | 0 = waiters=5, unlocked)
```

After `b := a`:

```
a.state = 0x00000028
b.state = 0x00000028
```

`b` thinks 5 waiters are parked on it. But those waiters are parked on `a.sema`, not `b.sema`. If someone locks-and-unlocks `b`, the unlock path will try to wake a waiter — using `b.sema`, where nobody is parked. The semaphore wakeup is a no-op. Then `b.state` is decremented as if a waiter departed, leaving an inconsistent count. The original 5 waiters on `a.sema` continue to wait forever; nobody on `a` ever wakes them because `a.state`'s waiter count was never reduced (those decrements went to `b.state`).

The shape of the disaster depends on which copies see which Lock and Unlock calls. There is no consistent model. The senior takeaway: **the state word's invariants assume a single owner-of-the-bits**. Copying creates multiple owners. The runtime cannot detect this.

---

## The sema word and runtime parking

The `sema` field is where the slow path lives. When `Lock` cannot win the fast-path CAS, it calls `runtime_SemacquireMutex(&m.sema, ...)`. This routine, defined in `runtime/sema.go`, does the following:

1. Hash `&m.sema` to a "semaroot" — a small lock-protected tree of parked goroutines, one root per hash bucket.
2. Acquire the semaroot's spinlock.
3. Insert the calling goroutine into the tree, keyed by the address of `&m.sema`.
4. Park the goroutine (`gopark`) — the scheduler will run something else.

When the unlocker calls `runtime_Semrelease(&m.sema, ...)`, it does the inverse:

1. Hash `&m.sema` to the same semaroot.
2. Acquire the semaroot's spinlock.
3. Find a goroutine keyed on that address.
4. Wake it.

The crucial fact: the *key is the address*. Two different `sync.Mutex` values, even if they have identical state words, have *different addresses*. The semaroot does not know they came from the same logical "lock"; it only knows where to park and where to wake.

### Why a copy splits the parking lot

```go
var a sync.Mutex
b := a // address of b.sema differs from address of a.sema
go func() { b.Lock(); b.Unlock() }()
go func() { a.Lock(); a.Unlock() }()
```

Goroutines that ever block on `a.Lock` park at `&a.sema`. Goroutines that ever block on `b.Lock` park at `&b.sema`. These are two different keys in the semaroot. They are completely independent. There is no scenario in which an unlock on `a` wakes a waiter on `b` or vice versa.

That is the killer property: **the runtime treats two copies of a mutex as two different locks**. The user thinks "they protect the same data" but the runtime sees two unrelated synchronisation primitives.

### Inspecting the semaroots at runtime

There is no public API, but during debugging you can examine `runtime/sema.go`'s `semtable` (a fixed-size array of `semaRoot`). With delve and unsafe pointers you can confirm that a "waiter" is keyed by `&someMutex.sema`. For production code, this is purely educational — but it explains why the rule "do not copy a mutex" is absolute and not just stylistic.

### The address dependency makes mutex copying recoverable only by zeroing

Some folklore says "copy a mutex while it's unlocked is fine." It is not. Even a zero-valued copy creates a new `sema` address. If you copy a mutex, lock the copy, and then a contending goroutine that locked the original tries to wake someone, the wakeup goes to the original's `sema`. Nobody wakes. The copy's goroutine has acquired the lock, but is invisible to the original's waiters.

The only safe operation on a mutex value is: declare it, do not move it, do not copy it, ever. If a struct contains one, the struct itself becomes non-copyable. This is the rule we encode with `noCopy`.

---

## Why copying breaks every invariant

Stepping back from individual fields, the `sync.Mutex` contract is built on three invariants that copying breaks simultaneously:

### Invariant 1: At most one goroutine sees the locked state

A mutex acts as a serialisation point. The contract is: between `m.Lock()` and `m.Unlock()`, no other goroutine sees `m` as unlocked. With a copy, "no other goroutine sees m" is meaningless because there is no longer a unique `m`. Goroutines holding pointers to the original do not see the copy's state changes; goroutines holding pointers to the copy do not see the original's state changes.

### Invariant 2: Every Unlock is paired with exactly one Lock

The mutex panics if it is unlocked without a matching lock. With a copy, the *count* of locks and unlocks can stay balanced overall but become unbalanced per-instance. The original may see two unlocks for one lock (double-unlock panic on the original). The copy may see one unlock for two locks (silently leaks a held lock). Both are bugs even if the total count is even.

### Invariant 3: Memory model ordering applies across Lock/Unlock

The Go memory model (the `2025-02-04` revision is the current normative version) says: every Unlock synchronises-before every subsequent Lock of *the same mutex*. With a copy, "the same mutex" does not exist. Writes performed by a goroutine holding the original lock are not guaranteed to be visible to a goroutine that subsequently locks the copy. Data races on the protected fields become possible — and the race detector catches them, when it is enabled.

The intuition: a mutex is an *anchor* in memory. Goroutines synchronise through the anchor. Copying creates two anchors. Synchronisation through anchor A says nothing about what anchor B sees.

### Worked example: a counter that double-counts

```go
type Counter struct {
    mu sync.Mutex
    n  int
}

func (c Counter) Inc() {
    c.mu.Lock()
    c.n++
    c.mu.Unlock()
}
```

Value receiver. Each call to `c.Inc()` copies the entire `Counter` into a parameter slot. The lock is acquired and released on the copy. The increment writes to the copy's `n` field. The original `n` is never touched. The mutex protects nothing because there is nothing shared to protect.

Now make it concurrent:

```go
c := Counter{}
var wg sync.WaitGroup
for i := 0; i < 1000; i++ {
    wg.Add(1)
    go func() {
        defer wg.Done()
        c.Inc()
    }()
}
wg.Wait()
fmt.Println(c.n) // always 0
```

Output is always 0 because no `Inc` call ever wrote to `c.n`. The bug is unanimous, not racy — every increment lands on a different copy.

`go vet` catches this:

```
counter.go:8:7: Inc passes lock by value: Counter contains sync.Mutex
```

The fix is one character: change `c Counter` to `c *Counter`. But the analyser only catches it because the function literally takes the struct by value. Hide the copy behind a closure capture, an interface, a generic, or a channel send, and vet may miss it.

---

## Value receivers — the silent corruption

Value receivers are the single most common cause of mutex copy bugs. They are syntactically identical to pointer receivers — only the lack of `*` distinguishes them — and the compiler accepts them without complaint. The bug exhibits at runtime, and only sometimes.

### The semantics of a value receiver

```go
func (c Counter) Inc() { ... }
```

When called as `c.Inc()`, Go creates a new local variable `c` inside `Inc`, copies the caller's `c` into it, and runs the body. The copy is a bytewise copy of the struct (memcpy in practice). If the struct contains a `sync.Mutex`, the mutex is copied.

This is not specific to mutexes. Slices, maps, channels, function values, and interface values are all "reference types" — they hold a pointer internally. Copying them is cheap and the two copies share state through that pointer. Mutexes are *not* reference types. Their state is inline. Copying them duplicates the state.

### Detecting value-receiver mutex bugs in code review

Three signals together usually mean trouble:

1. The struct has at least one field that is a `sync.Mutex`, `sync.RWMutex`, `sync.WaitGroup`, `sync.Once`, or `sync.Cond` (or a struct that transitively contains one).
2. At least one method declared on the struct has a value receiver.
3. That method calls `Lock`, `Unlock`, `Add`, `Done`, `Do`, `Wait`, `Signal`, or `Broadcast`.

If all three are true, the method either does not work or is silently broken. Two corrective actions are available: change the receiver to a pointer (cheap, almost always right), or remove the synchronisation primitive (sometimes the right move — the type may not need it).

### Receiver consistency

Once one method has a pointer receiver, every method on that type should have a pointer receiver. Mixing receiver kinds is a code smell — it implies the author was unsure whether the type was a value type or a reference type. With a mutex in the struct, the answer is unambiguous: it is a reference type, and *all* methods take a pointer.

The `staticcheck` tool's `ST1016` ("methods on the same type should have the same receiver name") and `SA9001` checks together catch most receiver-consistency issues.

### Implicit copies through embedding

A struct that embeds a `sync.Mutex` and has value-receiver methods is broken even if the methods do not explicitly call `Lock`:

```go
type Container struct {
    sync.Mutex
    data map[string]int
}

func (c Container) Get(k string) int {
    c.Lock()         // locks the copy
    defer c.Unlock() // unlocks the copy
    return c.data[k] // reads the copy's map header (same map, shared)
}
```

The map header is a small struct of three words. Copying it is cheap and harmless — both copies point to the same hash table. But the embedded `Mutex` is copied too. The Lock/Unlock protects nothing. Concurrent calls to `Get` and a corresponding `Set` race on the map's internals. The race detector catches it.

This case is *particularly* insidious because the code "looks correct" — there is a lock and unlock around the access. Static review tends to miss it because reviewers focus on the lock/unlock pairing, not the receiver.

---

## Pointer receivers — when, why, and the costs

The fix for mutex copy bugs is overwhelmingly: use a pointer receiver. There are a few subtleties.

### Why pointer receivers prevent the copy

```go
func (c *Counter) Inc() { ... }
```

When called as `c.Inc()`, Go passes `&c` (the address of the caller's `c`) as the receiver. Inside the method, `c` is a pointer; dereferences read and write the caller's `c` directly. The mutex is accessed through the pointer; no copy occurs.

### The "addressability" requirement

A value receiver can be called on any expression of the right type — including the result of a function, a map index, an interface assertion. A pointer receiver requires the call site to be *addressable*. The compiler enforces this.

```go
var m map[string]Counter
m["x"].Inc() // ERROR if Inc has a pointer receiver: m["x"] is not addressable
```

This restriction is *good*. It catches a separate copy bug: storing a struct-with-mutex in a map and then calling methods on it. Even with a pointer receiver, you cannot call the method through a map index. You must either store `*Counter` in the map, or extract to a local variable (which itself would be a copy — also wrong).

The right fix is to store `*Counter` in the map and call `m["x"].Inc()`, which works because pointer types are always addressable for method calls in this position (the pointer is the receiver itself).

### Memory cost of pointer receivers

A pointer receiver is one word (8 bytes on 64-bit). A value receiver of, say, a 64-byte struct is 64 bytes. The pointer is almost always cheaper to pass.

However, pointer receivers force the struct to be heap-allocated in many cases (escape analysis), because the compiler must prove the pointer does not outlive the stack frame. For a tiny type with no synchronisation, a value receiver and a stack-allocated value can be faster than a heap-allocated pointer. For a struct containing a mutex, this argument does not apply — you cannot use a value receiver anyway.

### Pointer receivers and `nil`

A pointer receiver may be called with a `nil` receiver:

```go
var c *Counter
c.Inc() // panics with nil pointer dereference when Inc accesses c.mu
```

Some types deliberately allow `nil` receivers for methods that do nothing (e.g., a no-op logger). Most types do not. Document the contract.

### Inheritance of receiver kind through embedding

If type `B` embeds type `A`, and `A` has a method with a pointer receiver, then `B` has that method *with the same receiver kind*. Calling `b.M()` where `b` is a `B` value works — Go automatically takes the address of the embedded `A` field. But this only works when `b` itself is addressable.

```go
type A struct{ mu sync.Mutex }
func (a *A) Lock() { a.mu.Lock() }

type B struct{ A }

func main() {
    var b B
    b.Lock()           // OK: b is addressable
    f := func() B { return B{} }
    f().Lock()         // ERROR: f() is not addressable
}
```

The senior takeaway: embedding a `sync.Mutex` propagates the addressability requirements. Code that creates values via function returns and immediately calls methods on them will fail to compile — which is good — but it's a signal that the API design needs adjustment.

---

## Embedded mutexes and method promotion

Embedding `sync.Mutex` (or `sync.RWMutex`) directly into a struct is idiomatic when the type *is* its lock — when the only sensible way to use the type is to lock the whole thing. The promoted `Lock`/`Unlock` methods make the type satisfy `sync.Locker` automatically.

```go
type Cache struct {
    sync.RWMutex
    data map[string]string
}

func (c *Cache) Get(k string) string {
    c.RLock()
    defer c.RUnlock()
    return c.data[k]
}
```

### When to embed vs name the field

Embed when:

- The lock and the data are tightly coupled — the type's identity is "the thing protected by this lock."
- External callers may want to lock the struct directly (e.g., to do multiple operations atomically).
- You want the type to satisfy `sync.Locker`.

Name the field (e.g., `mu sync.Mutex`) when:

- The lock is one of multiple synchronisation primitives in the struct.
- You want to hide the lock from external callers (unexported field, no promotion of Lock/Unlock).
- The lock protects only some fields, not the whole struct — keeping the lock un-exported keeps the API honest.

Most production code uses a named, unexported field. Exposing `Lock`/`Unlock` to callers tends to invite layering violations.

### Method-set rules with embedded locks

The method set of `T` (a value of struct type) includes all methods with value receivers on `T`'s embedded fields. The method set of `*T` includes all methods (both receiver kinds) on `*T`'s embedded fields. Since `Lock` and `Unlock` are pointer-receiver methods on `*sync.Mutex`, embedding `sync.Mutex` makes them part of `*T`'s method set, not `T`'s.

This is the language-level reason a value of type `T` does not satisfy `sync.Locker` when `T` embeds `sync.Mutex`. Only `*T` does. The senior takeaway: when passing a struct-with-embedded-mutex to anything that calls `Lock`/`Unlock`, you must pass `*T`. Vet's copylocks check enforces this.

### Embedding `*sync.Mutex` (pointer to mutex)

```go
type Cache struct {
    *sync.Mutex
    data map[string]string
}
```

This is rarely seen but legal. The struct holds a pointer to a separately-allocated mutex. Copying the struct copies the pointer; both copies share the same mutex. This works correctly — but the mutex must be initialised explicitly (`c := &Cache{Mutex: &sync.Mutex{}}`), and zero values of `Cache` have a `nil` mutex pointer.

The pattern has niche uses (mutex-sharing across multiple struct types) but the default should be a value-typed embedded mutex with the struct itself accessed via pointer.

---

## The sync.Locker interface — abstraction and traps

```go
type Locker interface {
    Lock()
    Unlock()
}
```

`sync.Locker` is a tiny interface. `*sync.Mutex` and `*sync.RWMutex` both satisfy it (and `*sync.RWMutex` has a `RLocker()` method that returns a `Locker` whose Lock/Unlock map to RLock/RUnlock).

### The trap: passing a value-type as Locker

```go
type Counter struct {
    sync.Mutex
}

func doStuff(l sync.Locker) {
    l.Lock()
    defer l.Unlock()
    // ...
}

func main() {
    var c Counter
    doStuff(c)  // ERROR: Counter does not implement sync.Locker (Lock method has pointer receiver)
}
```

Good — the compiler catches this. But if you have `var c *Counter`, then `doStuff(c)` works and the lock is on the actual struct.

### Wrapper Lockers

You sometimes see custom `Locker` implementations:

```go
type recursiveMutex struct {
    sync.Mutex
    owner int64
    depth int
}

func (m *recursiveMutex) Lock()   { /* re-entrant logic */ }
func (m *recursiveMutex) Unlock() { /* re-entrant logic */ }
```

These must always be used by pointer. The same copy rule applies. Embedding `sync.Mutex` automatically makes the outer type non-copyable (as far as vet is concerned).

### `Locker` and generics

Go 1.18+ generics permit:

```go
func Guard[L sync.Locker, T any](l L, f func() T) T {
    l.Lock()
    defer l.Unlock()
    return f()
}
```

If `L` is `*sync.Mutex`, this works. If `L` is `sync.Mutex` (the value type), it does not even compile — `sync.Mutex` does not implement `sync.Locker`. Generics inherit the same rule.

A subtler problem: if `L` is a custom type that the user defined as a value, and the user passes a value, vet *may* not catch the copy at the call site because of generic instantiation gymnastics. Always require `*` in the type parameter constraints when possible:

```go
type LockerPtr[T any] interface {
    *T
    sync.Locker
}

func Guard[T any, L LockerPtr[T]](l L, f func()) { ... }
```

This pattern forces the caller to pass a pointer. It is verbose; most code does not need it. But for library code intended to be safely used by many callers, the extra type parameter is worth it.

---

## The copylocks analyser — internals and edge cases

The `copylocks` pass lives in `golang.org/x/tools/go/analysis/passes/copylock`. We touched on it in the middle file; here we cover the senior-level details: how it traverses the AST, what it flags, what it misses, and how to extend it for your own types.

### What it analyses

The analyser walks every function body in the package and inspects:

- Assignment statements (`a = b`)
- Variable declarations with initializers (`var a = b`, `a := b`)
- Function calls (each argument is a copy)
- Function returns (each returned value is a copy)
- Range statements (`for _, v := range slice` copies into `v`)
- Composite literals (struct{F: x} copies `x`)
- Type assertions (`x.(T)` may copy)
- Send statements (`ch <- v` is a copy)
- `go` and `defer` statements (the argument expressions are evaluated and the values copied)
- Generic function instantiations (recent versions)

For each such expression, it determines the static type. If that type *transitively contains* a `sync.Locker` (a `sync.Mutex`, `sync.RWMutex`, or any type whose method set includes `Lock` and `Unlock` with pointer receivers), it reports a diagnostic.

### Transitive containment

"Transitively contains" means: the type itself is a Locker, or one of its fields is, or one of its fields' fields is, recursively. This is necessary because:

```go
type A struct{ mu sync.Mutex }
type B struct{ a A }
type C struct{ b B }

func f(c C) {} // flagged: C contains B contains A contains sync.Mutex
```

The detection is purely structural. It does not look at whether the lock is actually used. It does not look at whether the function does anything with `c`. It flags the copy site regardless.

This is the right behaviour. Even an unused copy is a future hazard: someone may add a method later that uses the lock, and the copy bug suddenly becomes live.

### Pointer fields are safe

```go
type D struct{ mu *sync.Mutex }
func f(d D) {} // NOT flagged
```

Copying a pointer to a mutex is fine — the pointer's target is shared. This is one valid escape hatch when you really need to make a struct copyable.

### Interface fields are safe (and dangerous)

```go
type E struct{ l sync.Locker }
func f(e E) {} // NOT flagged
```

`sync.Locker` is an interface; copying an interface value copies the interface header (two words: type and pointer to data). The underlying mutex is shared because the interface points to it. So the copy is safe *in this case*.

But interfaces erase types. If the underlying value is a `sync.Mutex` (the value type), the interface would be holding a *copy* of the mutex placed on the heap. Now the interface points to that heap-allocated mutex; further copies of the interface still share that copy, but the original mutex (wherever it lives) is detached. Use `*sync.Mutex` as the dynamic type.

Vet does not flag any of this because it cannot prove the dynamic type.

### `unsafe.Pointer` and reflection

The analyser refuses to follow `unsafe.Pointer` casts. Any time you see `(*T)(unsafe.Pointer(&u))`, you have stepped outside the analyser's view. Reflection (`reflect.New`, `reflect.ValueOf`, `reflect.Indirect`) is similarly opaque. If you use these mechanisms, you must enforce the no-copy rule yourself, including using `noCopy` markers.

### Channel sends

```go
type T struct{ mu sync.Mutex }
ch := make(chan T)
ch <- T{} // flagged: channel send copies T
```

Recent vet versions catch this. Older versions did not. If you have a buffered channel carrying a struct-with-mutex value, every send and receive is a copy. The fix is `chan *T`.

### `go` and `defer` argument copies

```go
var t T
go t.Method()         // OK if Method has a pointer receiver and t is addressable
go func() { t.Method() }() // OK: closure captures t by reference
go func(x T) { ... }(t)    // flagged: x is a copy
defer fmt.Println(t)       // flagged: arg evaluated and copied at defer time
```

The `defer fmt.Println(t)` case bites people because the call looks innocent. But the argument is evaluated and copied immediately on encountering the `defer`, not when the function returns. Use `defer fmt.Println(&t)` or wrap in a closure.

### Generics

```go
func Identity[T any](v T) T { return v }

type Counter struct{ mu sync.Mutex }
var c Counter
_ = Identity(c) // flagged in recent vet, missed in older
```

Generic instantiation introduces a new copy site. The analyser, when run with the right Go version, instantiates the function and checks each instantiation. Older Go versions ran the analyser on the un-instantiated function body, where `T` is `any` and the check could not proceed.

If you write generic code, prefer `*T`:

```go
func Apply[T any](v *T, f func(*T)) { f(v) }
```

### Extending copylocks for your own types

If you have a custom synchronisation primitive — say, a `RWLocker` or a `RingBuffer` with internal mutexes — and you want vet to detect copies, you have two options:

1. **Embed `sync.Mutex` or use `noCopy`.** Either marks the type as a Locker structurally.
2. **Add Lock/Unlock methods.** If your type has both methods with pointer receivers, it satisfies `sync.Locker`, and copylocks will flag it.

If neither fits, you can write a custom analysis pass using `golang.org/x/tools/go/analysis` and register it in your CI. We will show an example in `tasks.md`.

---

## Mutex profiling with -mutexprofile

Go's runtime can profile mutex contention. The flag `-mutexprofile=mutex.out` on a test binary (or `runtime.SetMutexProfileFraction(n)` in production) enables sampling: roughly 1 in `n` mutex blocking events is recorded, with the goroutine's stack at the point of contention and the duration spent blocked.

### Enabling the profile

```go
import "runtime"

func init() {
    runtime.SetMutexProfileFraction(100) // sample 1% of blocking events
}
```

Then, somewhere in your program (often behind a debug HTTP endpoint), dump the profile:

```go
import (
    "net/http"
    _ "net/http/pprof"
    "runtime/pprof"
    "os"
)

func dumpMutex(w http.ResponseWriter, r *http.Request) {
    pprof.Lookup("mutex").WriteTo(w, 0)
}
```

Or via `go tool pprof`:

```
go tool pprof http://localhost:6060/debug/pprof/mutex
```

### Interpreting the output

The profile reports, for each call site that *unlocks* a contended mutex, the total wait time experienced by other goroutines on that mutex. The accounting is on the unlocker, not the waiter, because the unlocker is the one that resumed the waiter. The duration is the wait time, not the lock-hold time.

Top entries typically look like:

```
flat  flat%   sum%        cum   cum%
3.2s 45.71% 45.71%      3.2s 45.71%  example.com/cache.(*Cache).Set
1.1s 15.71% 61.42%      1.1s 15.71%  example.com/queue.(*Queue).Push
```

`cache.(*Cache).Set` shows up because that's the function that called Unlock on a heavily-contended mutex. The 3.2 seconds is aggregate wait time across all goroutines that waited for that lock during the profile window.

### Diagnosing mutex copy bugs from the profile

A mutex copy bug manifests as *low or zero* contention on a mutex that you expect to be contended. If your `Counter.Inc` shows up in the CPU profile but never in the mutex profile, that's suspicious — it means either (a) the lock is uncontended (rare under load), or (b) different callers are locking different copies, so no caller ever blocks. Combined with a flat output number that does not match the input (e.g., 1000 increments, output `n == 0`), this is a strong signal.

Conversely, a fresh production deployment that suddenly shows huge mutex contention on a struct that did not used to be slow may indicate that someone changed a value receiver to a pointer receiver — fixing the copy bug — and now the lock is actually doing its job, exposing the underlying contention.

### Block profile vs mutex profile

The block profile (`runtime.SetBlockProfileRate`) records goroutines blocked on synchronisation primitives (channels, select, mutexes, etc.). The mutex profile is mutex-specific and uses a different accounting. For lock-focused analysis, use the mutex profile. For broader concurrency analysis, use the block profile.

Both are sampled and add overhead — typically <1% with reasonable sampling rates. Production-safe at modest sampling.

### Production flag patterns

We will cover this in detail in `professional.md`. The short version: set `SetMutexProfileFraction(1000)` (0.1% sampling) at process startup, expose `/debug/pprof/mutex` on an admin port, and capture profiles when contention alerts fire.

---

## Block profiling and contention

Adjacent topic: the block profile, enabled with `runtime.SetBlockProfileRate(n)`, records every event that blocks a goroutine for longer than `n` nanoseconds. Includes channel operations, select, `time.Sleep`, mutex acquisition, RWMutex acquisition, and a few others.

```go
runtime.SetBlockProfileRate(1_000_000) // events >= 1 ms
```

The block profile is more general but less precise about mutex contention. For senior-level work the heuristic is:

- Want to ask "which channel is everyone blocked on?" → block profile.
- Want to ask "which mutex is the bottleneck?" → mutex profile.

A mutex copy bug shows up in the block profile as *unexpectedly low* mutex blocking, often with high CPU spent inside Lock/Unlock instructions but no waiting. The contention is gone because the lock is not coordinating anything.

### `runtime/trace` for deeper analysis

For pre-production analysis, `runtime/trace.Start` produces a detailed trace of every goroutine, every block event, and every mutex transition. Open it with `go tool trace`. You can visually identify whether a mutex is being acquired by many goroutines (correct) or by just one (suspicious — possibly because each goroutine has its own copy).

---

## Go memory model implications

The Go memory model (the formal specification at `https://go.dev/ref/mem`, latest published 2025-02-04) says:

> For any call to `l.Unlock()` where `l` is a `sync.Mutex` or `sync.RWMutex`, there is a `before` relation from that call to any subsequent successful call to `l.Lock()`. The before relation is *the same mutex*.

The crucial phrase is "the same mutex." Two mutex *values* are not the same mutex if they live at different memory addresses, even if all their bytes are identical. The memory model gives you no guarantees across a copy.

### What this means in practice

```go
type Box struct {
    mu sync.Mutex
    v  int
}

func (b *Box) Set(x int) {
    b.mu.Lock()
    b.v = x
    b.mu.Unlock()
}

func (b Box) Get() int { // BUG: value receiver
    b.mu.Lock()
    defer b.mu.Unlock()
    return b.v
}
```

`Set` writes to `b.v` under the lock at `&originalBox.mu`. `Get` (value receiver) locks a *copy* of the mutex at the address of the local parameter. The Unlock-Lock synchronisation relation does not link `Set`'s lock to `Get`'s lock. `Get` is permitted by the memory model to return *stale* `v`, an *uninitialised* `v`, or in theory any value at all.

In practice, depending on cache coherence and the architecture, `Get` usually returns the most-recently-written value because the write to `v` propagates through the memory system. But the memory model gives no such guarantee. Under aggressive compiler optimisation (rare in current Go, but possible) the compiler could even reorder reads of `v` because no synchronisation primitive links them to the writes.

### The race detector and copy bugs

`go run -race` catches racy access to the underlying data. It catches the data race on `v` in the example above. It does *not* directly catch the mutex copy — vet does that. The race detector and copylocks are complementary tools: vet flags the structural mistake, race flags the runtime data race.

The lesson: vet warnings about copylocks should be treated as compile errors in CI. Do not ignore them and rely on `-race` to catch the downstream race. The race detector samples concurrent accesses; it may not catch a race that occurs only under rare timing.

---

## Starvation mode and copy-induced unfairness

`sync.Mutex` operates in two modes:

- **Normal mode**: waiters queue in FIFO order, but a fresh contender may "steal" the lock by winning a CAS just as the previous holder releases it. This is fast but unfair.
- **Starvation mode**: triggered when a waiter has waited >1ms. The unlocker hands the lock directly to the front-of-queue waiter, and new contenders queue at the back. Fair but slower.

The mode transition is encoded in the `mutexStarving` bit of `state`.

### How a copy can amplify unfairness

When a mutex is copied, the runtime state diverges. Suppose mutex `a` has been hot for a while and entered starvation mode (`mutexStarving == 1` in `state`). Copy `b := a`. Now `b` has `mutexStarving == 1` as well — but `b` has no waiters parked on its `sema`. The starvation-mode logic on `b` will try to hand off the lock to a non-existent waiter, end up not finding one, and re-enter normal mode after some attempts.

Concretely, on `b`:

- A goroutine calls `b.Lock()`. State shows starving + locked. The goroutine assumes it must queue. It parks on `&b.sema`.
- Eventually some other goroutine `b.Unlock()`s. Starvation handoff path: pop a waiter from `b.sema`. Finds none (or finds the just-parked one). Wakes it.
- The just-parked goroutine resumes, finds itself the new owner, completes the critical section, unlocks.

The flow works, but the mode bits are now stale relative to what `a` was doing. The same unmasked starvation bit can mistakenly bias `b`'s scheduling. Result: a goroutine that thought it would acquire `b` quickly under normal mode finds itself queued behind a starvation-mode handoff, despite `b` having only one waiter.

This is observable as bursts of latency on `b`. The mutex profile shows the wait, but you cannot see the cause without inspecting the binary state.

### The senior takeaway

The internal scheduler heuristics of `sync.Mutex` are tuned assuming a single coherent state-and-sema pair per logical lock. Copying breaks the tuning. Even when the obvious correctness bugs do not bite, you can see latency anomalies that are difficult to attribute to the root cause.

---

## Architectural patterns: encapsulation vs exposure

A senior-level question is: where should mutexes live in your architecture?

### Pattern: Owner-encapsulated lock

The mutex is a private field, the type owns it, and no other code touches it.

```go
type Inventory struct {
    mu    sync.Mutex
    items map[string]int
}

func (inv *Inventory) Add(item string, qty int) {
    inv.mu.Lock()
    defer inv.mu.Unlock()
    inv.items[item] += qty
}

func (inv *Inventory) Get(item string) int {
    inv.mu.Lock()
    defer inv.mu.Unlock()
    return inv.items[item]
}
```

Advantages: caller never sees the lock, never can copy it, never can hold it. Locking discipline lives inside one file. Refactoring to lock-free is local.

Disadvantage: cannot compose operations. If a caller needs to atomically check-and-set, they cannot do `if inv.Get(x) == 0 { inv.Add(x, 1) }` safely without exposing more API.

### Pattern: Exposed lock for composition

```go
type Inventory struct {
    sync.Mutex
    items map[string]int
}

func (inv *Inventory) AddLocked(item string, qty int) {
    inv.items[item] += qty
}
```

Callers do `inv.Lock(); inv.AddLocked(x, 1); inv.Unlock()`. They can compose multiple `*Locked` operations under one lock.

Disadvantage: callers can forget to lock. The `*Locked` naming convention signals the expectation but does not enforce it. Static analysis cannot easily catch missed locks.

### Pattern: Functional locking

```go
func (inv *Inventory) WithLock(f func(items map[string]int)) {
    inv.mu.Lock()
    defer inv.mu.Unlock()
    f(inv.items)
}
```

Caller does `inv.WithLock(func(items map[string]int) { items[x]++ })`. Composition lives inside the closure; the lock is always held during the closure. Cannot forget to unlock.

Disadvantage: the closure can leak the map reference. If the closure does `m := items`, the caller can later access `m` without the lock. Convention plus code review.

### When to choose which

For data that has a small fixed set of operations, prefer owner-encapsulated. For data that callers compose in many ways, prefer exposed lock (with `Locked` naming). For data that callers manipulate in arbitrary ways, consider functional locking. Mixing patterns within a single type is confusing and rarely worth it.

---

## Designing types that refuse to be copied

The strongest defence against mutex copying is to design types that the compiler — or vet — refuses to copy.

### Approach 1: Embed sync.Mutex

```go
type Counter struct {
    sync.Mutex
    n int
}
```

`go vet` will flag any copy of `Counter`. Methods must have pointer receivers. The promoted `Lock` and `Unlock` methods are part of `*Counter`'s method set but not `Counter`'s, so `Counter` does not implement `sync.Locker` while `*Counter` does.

### Approach 2: Use a noCopy marker

For types that do not actually contain a mutex but should not be copied for other reasons (e.g., they hold a file descriptor, or they are an identity object), embed a no-op `noCopy` type:

```go
type noCopy struct{}

func (*noCopy) Lock()   {}
func (*noCopy) Unlock() {}
```

Embedding `noCopy` makes the outer type satisfy `sync.Locker` (the `Lock`/`Unlock` methods are no-ops). Vet detects this and flags copies. No runtime cost.

### Approach 3: Make the zero value useless

Force callers to use a constructor that returns `*T`:

```go
type Pool struct {
    once sync.Once
    cap  int
    free chan *Item
}

func NewPool(cap int) *Pool { ... }
```

The struct does not literally prevent copying, but the API points everyone toward pointers. Code that uses `var p Pool` and tries to call methods may not deadlock (until something needs the channel) but is hard to write accidentally.

### Approach 4: Hidden mutex

A small struct exposed as an opaque type, with the mutex hidden:

```go
type Handle struct {
    inner *innerState
}

type innerState struct {
    mu sync.Mutex
    // ...
}
```

`Handle` is freely copyable (it's just a pointer). All real state and synchronisation lives inside `*innerState`. This is the pattern used by `sync.Pool`, `net.Conn`, `os.File`, and many others.

Trade-off: extra indirection, extra allocation. For most cases the cost is negligible.

---

## The noCopy idiom — full reference implementation

The standard library uses `noCopy` extensively. Here is the canonical version, with comments.

```go
// noCopy may be added to structs which must not be copied
// after the first use.
//
// See https://golang.org/issues/8005#issuecomment-190753527
// for details.
//
// Note that it must not be embedded, due to the Lock and Unlock methods.
type noCopy struct{}

// Lock is a no-op used by -copylocks checker from go vet.
func (*noCopy) Lock()   {}
func (*noCopy) Unlock() {}
```

Notice the wording: "must not be embedded, due to the Lock and Unlock methods." This is the standard-library style. By using a *field* named `noCopy` rather than an embedded type, the `Lock` and `Unlock` methods are not promoted to the outer type's method set. The outer type does not accidentally satisfy `sync.Locker`.

Internal example from `strings.Builder`:

```go
type Builder struct {
    addr *Builder
    buf  []byte
}

func (b *Builder) copyCheck() {
    if b.addr == nil {
        b.addr = (*Builder)(noescape(unsafe.Pointer(b)))
    } else if b.addr != b {
        panic("strings: illegal use of non-zero Builder copied by value")
    }
}
```

`strings.Builder` uses a runtime check rather than `noCopy`: it stores its own address and panics on a method call if the address has changed (which implies a copy). This is heavier than `noCopy` but catches copies that vet missed.

The two techniques are complementary: `noCopy` is compile-time-ish (catches at vet time), the self-address check is runtime.

### Putting noCopy in your own type

```go
package mypkg

type noCopy struct{}

func (*noCopy) Lock()   {}
func (*noCopy) Unlock() {}

type Tracker struct {
    _  noCopy
    n  int64
    mu sync.Mutex
}
```

The `_` field name discards the value; you cannot reference it. Vet's copylocks check sees the embedded Locker-satisfying type and flags copies of `Tracker`.

You only need `noCopy` if your type does *not* already contain a `sync.Mutex` (or other lock). If it does, copylocks already flags copies — no extra marker needed.

### Generics and noCopy

`noCopy` is structural; it works with generic instantiation just like any other field. The check applies to every instantiation.

---

## Beyond Mutex: WaitGroup, Once, Cond, atomic.Value

The same rule — do not copy — applies to all `sync` primitives. Each has its own failure mode.

### sync.WaitGroup

Internal state: a 64-bit counter and a 32-bit waiter count. Copying after the first `Add` produces inconsistent counters: the original sees decrements from the copy's `Done`, or vice versa. `Wait` may return immediately on the copy (counter was 0 there) or block forever (counter was non-zero in the original).

Failure mode: tests pass under low load (the counter happens to align), fail under load. Or: a `Done` panics because the counter went negative.

### sync.Once

Internal state: a `done uint32` flag and an internal mutex. Copying after `Do` has been called means the copy has `done == 1` but the *associated function pointer was already invoked on a different memory location*. If the copy then calls `Do(g)` with a different `g`, the copy sees `done == 1` and skips `g`. The original function was invoked but `g` was not. The two `Do` calls protect logically different one-time initialisations.

Failure mode: initialisation function silently skipped on the copy. Whatever the function was supposed to set up does not exist.

### sync.Cond

`sync.Cond` is `*L sync.Locker` plus a wait list and a notify list. Copying means the wait/notify lists diverge. `Signal` on the copy wakes none of the original's waiters. The original's `Wait` blocks forever.

Failure mode: deadlock. Or worse: silently lost signals where producers think they signalled.

`sync.Cond` is also unusual in that it has an explicit `noCopy` field in modern Go. Copies are vet-flagged.

### atomic.Value

Internal state: a typed pointer plus a flag. Copies are flagged by vet. Failure mode: independent atomic values; loads from one do not see stores to the other.

### atomic.Int64 / Int32 / etc. (Go 1.19+)

The typed atomics also have `noCopy` markers. Copying breaks atomicity guarantees (two locations means two atomic counters).

---

## Refactoring legacy value-typed APIs

You have inherited a codebase where `type T struct{ ... mu sync.Mutex ... }` is used by value everywhere. How do you migrate to pointers safely?

### Step 1: Add noCopy and enable vet

If `T` does not already contain a `sync.Mutex`, add a `noCopy` field. If it does, vet already flags copies. Run `go vet ./...` and survey the diagnostics. Each one is a copy site.

### Step 2: Triage

Sort diagnostics by file. Roughly classify:

- Method receivers: easiest to fix. Change `(t T)` to `(t *T)`.
- Function parameters: change `t T` to `t *T`. Audit callers — they must now pass `&t`.
- Function returns: change `func New() T` to `func New() *T`. Audit callers that store into a value field.
- Map storage: change `map[K]T` to `map[K]*T`. Audit map accesses.
- Channel elements: change `chan T` to `chan *T`. Audit ranges and sends.
- Composite literals: change `T{...}` to `&T{...}`. Audit the surrounding context for value-type expectations.

### Step 3: Tackle one diagnostic at a time

Resist the temptation to bulk-replace. Each fix may reveal new diagnostics (because the type's "shape" changes downstream). Work outward from one site at a time, run vet again, and continue.

### Step 4: Update tests

Tests often do `t := MyType{...}`. After the migration, they do `t := &MyType{...}`. The receiver methods then work correctly. Tests should run cleanly under `-race`.

### Step 5: Update documentation

API documentation that referred to "the T struct" should now refer to "the *T pointer." Examples in godoc should use `&T{}` consistently.

### Step 6: Add a CI check

Even after the migration, future commits could reintroduce a value-typed copy. Add to your CI:

```bash
go vet ./...
```

and fail the build on any output. Some projects use `golangci-lint` with the `copylocks` check explicitly enabled.

---

## Senior-level checklist

When reviewing code at the senior level, watch for:

- [ ] Any value receiver method on a struct containing a `sync.Mutex`, `sync.RWMutex`, `sync.WaitGroup`, `sync.Once`, `sync.Cond`, or `atomic.Value`.
- [ ] Any function parameter of struct type that transitively contains a Locker.
- [ ] Any function return value of struct type that transitively contains a Locker.
- [ ] Any map storing struct values that contain a Locker.
- [ ] Any channel carrying struct values that contain a Locker.
- [ ] Any range loop over a slice of struct-containing-Locker without `&items[i]`.
- [ ] Any composite literal that copies an existing instance.
- [ ] Any closure capturing a struct-with-Locker by value.
- [ ] Any `defer` whose evaluated argument copies a struct-with-Locker.
- [ ] Any interface variable that may carry a value-typed Locker.
- [ ] Any reflection that constructs values of struct-with-Locker types.
- [ ] Any `unsafe.Pointer` cast that involves Locker-containing types.

When designing new types containing a `sync.Mutex`:

- [ ] All methods are pointer receivers.
- [ ] The constructor returns `*T`, not `T`.
- [ ] Public API uses `*T` consistently.
- [ ] If the type does not embed a Locker but should not be copied, embed `noCopy`.
- [ ] Document the no-copy expectation explicitly.

When tuning performance:

- [ ] Mutex profile shows the mutex is contended (otherwise lock-free alternatives may apply).
- [ ] Block profile shows where goroutines wait — to confirm.
- [ ] Lock-hold durations are short — long critical sections lead to convoying.
- [ ] No copy bugs introducing fake "low contention" that masks real contention.

---

## Summary

At the senior level, mutex copying is not just "a bug." It is a violation of the contract between your code and the Go runtime, with consequences in three layers:

1. **Language layer**: copying creates two structurally identical but logically independent values.
2. **Runtime layer**: the state word and the sema word, the two anchors of the mutex, diverge between copies, splitting the parking lot.
3. **Memory model layer**: the synchronisation relation linking Unlock to subsequent Lock applies only "to the same mutex" — copies are not the same mutex.

The tooling — `go vet`'s `copylocks` pass, race detector, mutex profile, block profile — collectively catches most cases. Your job is to (a) understand exactly what each tool catches and what it misses, (b) design types so the failure modes are impossible by construction, and (c) read profiles to confirm in production that your mutexes are doing what you expect.

The next step (`professional.md`) covers production patterns: lock-free alternatives, sharded maps, RWMutex tradeoffs at scale, contention monitoring in deployed services, and distributed locking pitfalls.

---

## Appendix A: A walking tour of sync/mutex.go

The actual source of `sync.Mutex` is around 250 lines. Reading it is a senior rite of passage. The key methods:

### Lock

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

This is the fast path. A single CAS. If the mutex is unlocked (state == 0), the CAS sets it to locked (state == 1) and returns. Total latency: a handful of nanoseconds.

If the CAS fails (someone else holds the lock, or there are waiters), control passes to `lockSlow`.

### lockSlow

`lockSlow` is the heart of the algorithm. Simplified:

```go
func (m *Mutex) lockSlow() {
    var waitStartTime int64
    starving := false
    awoke := false
    iter := 0
    old := m.state
    for {
        // Spin if locked, not starving, can spin.
        if old&(mutexLocked|mutexStarving) == mutexLocked && runtime_canSpin(iter) {
            // Try to set woken so unlocker does not wake another waiter.
            if !awoke && old&mutexWoken == 0 && old>>mutexWaiterShift != 0 &&
                atomic.CompareAndSwapInt32(&m.state, old, old|mutexWoken) {
                awoke = true
            }
            runtime_doSpin()
            iter++
            old = m.state
            continue
        }
        new := old
        if old&mutexStarving == 0 {
            new |= mutexLocked
        }
        if old&(mutexLocked|mutexStarving) != 0 {
            new += 1 << mutexWaiterShift
        }
        if starving && old&mutexLocked != 0 {
            new |= mutexStarving
        }
        if awoke {
            new &^= mutexWoken
        }
        if atomic.CompareAndSwapInt32(&m.state, old, new) {
            if old&(mutexLocked|mutexStarving) == 0 {
                break // locked it
            }
            queueLifo := waitStartTime != 0
            if waitStartTime == 0 {
                waitStartTime = runtime_nanotime()
            }
            runtime_SemacquireMutex(&m.sema, queueLifo, 1)
            starving = starving || runtime_nanotime()-waitStartTime > starvationThresholdNs
            old = m.state
            if old&mutexStarving != 0 {
                // Awoken in starvation mode: grab the lock directly.
                delta := int32(mutexLocked - 1<<mutexWaiterShift)
                if !starving || old>>mutexWaiterShift == 1 {
                    delta -= mutexStarving
                }
                atomic.AddInt32(&m.state, delta)
                break
            }
            awoke = true
            iter = 0
        } else {
            old = m.state
        }
    }
}
```

The key operations:

1. **Spinning**: if the mutex is locked-but-not-starving and we've spun fewer than a small number of times, spin (busy-wait). `runtime_canSpin` checks the spin budget; `runtime_doSpin` issues a `PAUSE` instruction (or equivalent) for a brief period.

2. **Increment waiter count**: if we cannot grab the lock or are not going to spin, we increment the waiter count in `state` via CAS.

3. **Park on semaphore**: call `runtime_SemacquireMutex(&m.sema, ...)`. This is the runtime call that puts the goroutine to sleep, keyed on the address of `m.sema`.

4. **Wake-and-retry**: when we wake up (someone unlocked and the runtime woke us), we check if we are in starvation mode. If yes, the runtime handed the lock directly to us; we just adjust `state` and return. If no, we re-enter the for loop and try the CAS again (we may lose to a new contender).

The whole flow assumes `&m.sema` is *the* parking address. A copy changes the address. The slow path then parks on a new, empty semaphore.

### Unlock

```go
func (m *Mutex) Unlock() {
    if race.Enabled {
        _ = m.state
        race.Release(unsafe.Pointer(m))
    }
    new := atomic.AddInt32(&m.state, -mutexLocked)
    if new != 0 {
        m.unlockSlow(new)
    }
}
```

Fast path: subtract `mutexLocked` from `state`. If the result is 0 (was 1, now 0; no waiters, no starving, no woken), return. Otherwise pass control to `unlockSlow`.

### unlockSlow

```go
func (m *Mutex) unlockSlow(new int32) {
    if (new+mutexLocked)&mutexLocked == 0 {
        fatal("sync: unlock of unlocked mutex")
    }
    if new&mutexStarving == 0 {
        old := new
        for {
            if old>>mutexWaiterShift == 0 || old&(mutexLocked|mutexWoken|mutexStarving) != 0 {
                return
            }
            new = (old - 1<<mutexWaiterShift) | mutexWoken
            if atomic.CompareAndSwapInt32(&m.state, old, new) {
                runtime_Semrelease(&m.sema, false, 1)
                return
            }
            old = m.state
        }
    } else {
        // Starvation mode: hand off lock directly.
        runtime_Semrelease(&m.sema, true, 1)
    }
}
```

Notice the first check: if the post-decrement state shows that the lock was not held, fatal panic. This is the classic "unlock of unlocked mutex" error. It is *fatal*: not a panic that you can recover from; the runtime kills the process.

In starvation mode, the unlocker calls `Semrelease` with `handoff=true`: the lock is given to the next waiter, not to whichever goroutine happens to be racing for it.

### Why fatal and not panic?

Mutex misuse — including double-unlock — is "unrecoverable" because the runtime cannot guarantee correctness after detecting it. A `panic` could be caught with `recover`, and execution would continue with the mutex in an undefined state. The runtime designers chose `fatal` to enforce a hard stop. Your process crashes; you get a clear stack trace; you fix the bug.

### How a copy interacts with the fatal check

```go
var a sync.Mutex
b := a
b.Unlock() // a is unlocked (zero state), b is also unlocked
```

Result: fatal. The runtime detects that `b.state` was never locked. Even though "a was never locked" is also true, the immediate cause is `b.Unlock()` on an unlocked mutex.

Now the more dangerous case:

```go
var a sync.Mutex
a.Lock()
b := a
a.Unlock() // a.state goes from 1 to 0. OK.
b.Unlock() // b.state was 1 (from the copy), now 0. OK!
```

No fatal. Both unlocks succeed. But there was only one logical "lock acquisition." The bug is the silent kind: two unlocks, one ostensibly matched lock. The runtime cannot detect it because each mutex's invariants are locally consistent.

---

## Appendix B: Reading the runtime semaphore code

`runtime/sema.go` implements `Semacquire` and `Semrelease`. We will not read it in full, but two functions matter for understanding mutex copies.

### semaroot

```go
type semaRoot struct {
    lock  mutex          // runtime-level lock, NOT sync.Mutex
    treap *sudog         // root of treap of unique waiters
    nwait atomic.Uint32  // hint: number of waiters
}

var semtable [semTabSize]struct {
    root semaRoot
    pad  [cpu.CacheLinePadSize - unsafe.Sizeof(semaRoot{})]byte
}

func semroot(addr *uint32) *semaRoot {
    return &semtable[(uintptr(unsafe.Pointer(addr))>>3)%semTabSize].root
}
```

There are `semTabSize` (251 in recent Go) semaroots. Each is padded to a cache line. Each protects a treap of waiting sudogs keyed by their address.

The function `semroot(addr)` picks a root based on a hash of the address. Two different addresses (`&a.sema`, `&b.sema`) usually hash to different roots, but even when they collide, the treap key differs and they are independent waiters.

### Semacquire

```go
func semacquire1(addr *uint32, lifo bool, profile semaProfileFlags, skipframes int, reason waitReason) {
    gp := getg()
    s := acquireSudog()
    root := semroot(addr)
    // Increment waiter count.
    root.nwait.Add(1)
    // Push to queue.
    lockWithRank(&root.lock, lockRankRoot)
    root.queue(addr, s, lifo)
    goparkunlock(&root.lock, reason, traceEvGoBlockSync, 4+skipframes)
    releaseSudog(s)
}
```

The goroutine is enqueued at the treap node for `addr`, then parked. When woken, it returns from `goparkunlock`.

### Semrelease

```go
func semrelease1(addr *uint32, handoff bool, skipframes int) {
    root := semroot(addr)
    atomic.Xadd(addr, 1)
    if root.nwait.Load() == 0 {
        return
    }
    lockWithRank(&root.lock, lockRankRoot)
    if root.nwait.Load() == 0 {
        unlock(&root.lock)
        return
    }
    s, t0 := root.dequeue(addr)
    if s != nil {
        root.nwait.Add(-1)
    }
    unlock(&root.lock)
    if s != nil {
        if handoff && cpu.CacheLinePadSize > 0 {
            // direct handoff path
        }
        readyWithTime(s, 5+skipframes)
    }
}
```

`root.dequeue(addr)` finds a sudog with key matching `addr`. If `addr` is `&a.sema`, we find a waiter parked on `&a.sema`. If we copied `a` to `b`, waiters parked on `&b.sema` are at a different key (or even different root), and `root.dequeue(&a.sema)` does not find them.

The key word here is `addr`: every operation is keyed by address. The whole semaphore mechanism is *address-coupled*. Copying changes the address. Copying breaks the coupling. The runtime is doing exactly what you asked it to do; you asked the wrong question.

---

## Appendix C: Performance numbers

Approximate latencies on a 2024-era amd64 server, single-core:

| Operation | Latency |
|-----------|---------|
| Uncontended `Lock`/`Unlock` (fast path, 1 CAS each) | ~20 ns |
| Contended `Lock` (spin, then succeed) | 100-500 ns |
| Contended `Lock` (park on semaphore, wake) | 2-10 us |
| `RWMutex.RLock`/`RUnlock` uncontended | ~25-30 ns |
| `RWMutex.Lock` with active readers | varies wildly |
| `atomic.AddInt64` | ~5-10 ns |

A mutex copy bug typically eliminates the contention path entirely, so each Lock looks "fast." Your service appears to be CPU-bound when it should be lock-bound. CPU profile dominated by Lock/Unlock calls is a giveaway.

Conversely, fixing a copy bug (changing receiver to pointer) suddenly exposes the real contention. The mutex profile lights up; throughput drops. The fix is correct but reveals a different bottleneck.

### Mutex-as-cost in business logic

Most production services spend less time in locks than in I/O, parsing, or serialisation. A mutex profile dominated by a single hot lock means the lock has become the bottleneck. Common remediations:

- Reduce critical section size (push work outside the lock).
- Switch to RWMutex if reads dominate.
- Shard the data (multiple mutexes, each protecting a subset).
- Move to atomic operations for counter-like state.
- Move to lock-free data structures (sync.Map, channels, etc.).

We expand on each in `professional.md`.

---

## Appendix D: The interaction with goroutine scheduling

When a goroutine parks on a semaphore, the Go scheduler picks another goroutine to run. When the unlocker calls `Semrelease`, the scheduler decides:

- Should it wake the parked goroutine immediately (handoff)?
- Should it leave the parked goroutine in the queue and let the unlocker continue?
- Should it run the woken goroutine on the same P (processor) for cache locality?

These decisions affect latency. In starvation mode, the runtime tends toward direct handoff: the lock is given to the front-of-queue waiter, the waiter is moved to a runnable state on the same P (if possible), and the unlocker returns. In normal mode, the runtime is less aggressive: the woken goroutine joins the runqueue and competes with others.

A mutex copy can confuse these heuristics. The starvation bit lives in `state`; copy semantics mean the bit may be set on a mutex that has no waiters. The runtime sees "starving lock, hand off to waiter," looks for a waiter, finds none, and falls back to normal mode. The result is occasional latency hiccups on the copy that are difficult to attribute to the cause.

### Lock convoying

When many goroutines contend on a mutex, they form a "convoy": the goroutine holding the lock finishes its critical section, releases, the next goroutine acquires, and so on. Convoying is a *scaling limit*: throughput is bounded by 1 / (critical-section-length) regardless of how many cores you throw at it.

A mutex copy bug breaks the convoy because there is no single coordination point. Each goroutine runs through its own private "lock," does its work, and proceeds. Throughput appears higher — but correctness is gone. This is why copy bugs sometimes look like performance wins in toy benchmarks.

### Per-P fast paths

The Go runtime maintains per-P (per-logical-processor) caches for some operations: timer queues, defer pools, sudog pools. Mutexes do not have per-P caches in the standard library, but they benefit from the per-P spinning attempt described above. A copy of a mutex still uses the per-P spinning machinery (it's keyed by `m.state`'s address), but the spin budget is consumed against a lock that nobody else is contending. Wasted cycles.

---

## Appendix E: Architecture-specific notes

### amd64

`sync.Mutex` operations compile to:

- `Lock` fast path: `LOCK CMPXCHG` (atomic compare-and-swap), about 10-20 cycles.
- `Unlock` fast path: `LOCK XADD` (atomic add), similar cost.

The `LOCK` prefix forces full memory barrier on amd64. A copy bug means the LOCK CMPXCHG operates on a different cache line. No cross-core invalidation occurs between the original and the copy.

### arm64

`Lock` fast path uses LDXR/STXR (load-link/store-conditional). Slightly different machine model from amd64. Same logical effect.

### riscv64

LR/SC pair. Same model.

In all cases, the bottom line is the same: atomic operations are keyed by physical memory address. Copying the struct creates two physical addresses. Atomics on one are invisible to atomics on the other.

### Memory barrier implications

Some readers ask: "does the Go compiler emit barriers around the Lock/Unlock that protect against compiler reordering?" Yes — the runtime's atomic operations are compiler barriers (the compiler does not reorder reads and writes across them). On the CPU level, the LOCK-prefixed instruction on amd64 is a full barrier. On arm64, explicit DMB barriers are used where needed.

A mutex copy bug does *not* break the per-operation barrier semantics — each Lock/Unlock on each copy still emits the right barriers locally. It breaks the *cross-goroutine ordering* implied by the synchronisation relation, because the synchronisation relation is about "the same mutex" and two copies are not.

---

## Appendix F: Tooling integration

### golangci-lint

Most CI pipelines run `golangci-lint`. Ensure `copylocks` is enabled:

```yaml
linters:
  enable:
    - copylocks
    - govet
```

`copylocks` is one of `govet`'s built-in analyzers. By default it is on. Confirm by running `golangci-lint linters | grep copylocks`.

### staticcheck

`staticcheck` adds additional checks but does not duplicate `copylocks`. Relevant checks:

- `SA9001`: "defers in range loops may not run when you expect them to" — adjacent issue.
- `ST1016`: "methods on the same type should have the same receiver name" — catches mixed-receiver bugs that often correlate with copy bugs.

### IDE integration

VS Code with the Go extension runs `gopls`, which embeds vet's checks. Copylocks warnings appear as squiggles in the editor. GoLand runs the same checks through its built-in inspector.

Treat IDE squiggles as the first line of defence. CI is the second.

### Pre-commit hooks

A common pattern:

```bash
#!/bin/sh
# pre-commit
set -e
go vet ./...
go test -race ./...
```

This catches copy bugs before they enter the repository. Combine with `staticcheck` and `golangci-lint` for broader coverage.

---

## Appendix G: A debugging session

You receive a bug report: "the counter is always 0 even though the test does 1000 increments." Walk through the diagnosis.

### Step 1: Reproduce

```go
type Counter struct {
    mu sync.Mutex
    n  int
}

func (c Counter) Inc() {
    c.mu.Lock()
    c.n++
    c.mu.Unlock()
}

func main() {
    var c Counter
    var wg sync.WaitGroup
    for i := 0; i < 1000; i++ {
        wg.Add(1)
        go func() {
            defer wg.Done()
            c.Inc()
        }()
    }
    wg.Wait()
    fmt.Println(c.n)
}
```

Output: `0`.

### Step 2: Run vet

```
$ go vet
./main.go:8:7: Inc passes lock by value: Counter contains sync.Mutex
```

Vet has identified the copy. Most of the time you stop here.

### Step 3: Run with race detector

```
$ go run -race main.go
WARNING: DATA RACE
```

Wait — the race detector reports a race? But the increments are not concurrent (each goroutine writes to its own copy of `c.n`). The race is actually on `c` itself: the main goroutine reads `c.n` after `wg.Wait()`, and the value-receiver methods read `c` to copy it. If we look carefully, the race detector message is on the *copy of c into Inc*, which happens to be on a different goroutine than the eventual `fmt.Println(c.n)`. Whether this is reported depends on Go version.

In any case, vet has told us the root cause. Fix and re-run.

### Step 4: Fix

```go
func (c *Counter) Inc() {
    c.mu.Lock()
    c.n++
    c.mu.Unlock()
}
```

Output: `1000`. Vet is silent. Race detector clean.

### Step 5: Audit for similar issues

```
$ grep -rn 'func (\w* [A-Z]' . | grep -v '*' | grep -E 'sync\.|Counter|Cache|Tracker'
```

Find every value-receiver method on a likely-stateful type. Audit each one.

### Step 6: Add a CI gate

```yaml
- name: vet
  run: go vet ./...
```

Done. The same bug cannot ship again.

---

## Appendix H: Patterns from the standard library

The Go standard library contains many examples of types that must not be copied. A tour:

### sync.Mutex itself

```go
// A Mutex must not be copied after first use.
type Mutex struct { ... }
```

The doc comment is the only "enforcement" — vet does the rest.

### sync.RWMutex

```go
// A RWMutex must not be copied after first use.
type RWMutex struct {
    w           Mutex
    writerSem   uint32
    readerSem   uint32
    readerCount atomic.Int32
    readerWait  atomic.Int32
}
```

Five fields. The embedded `Mutex` is itself non-copyable. The atomic counters are non-copyable individually. Copying an RWMutex breaks all five invariants at once.

### sync.WaitGroup

```go
type WaitGroup struct {
    noCopy noCopy
    state  atomic.Uint64
    sema   uint32
}
```

Explicit `noCopy` field. Vet detects copies.

### sync.Once

```go
type Once struct {
    done atomic.Uint32
    m    Mutex
}
```

The embedded Mutex makes Once non-copyable transitively.

### sync.Cond

```go
type Cond struct {
    noCopy  noCopy
    L       Locker
    notify  notifyList
    checker copyChecker
}
```

Both `noCopy` and `copyChecker` are present. `copyChecker` is a *runtime* check (stores self-address, panics on use after copy). This is the most aggressive protection in the standard library — even if vet misses the copy, the runtime catches it.

### sync.Pool

```go
type Pool struct {
    noCopy noCopy
    local     unsafe.Pointer
    localSize uintptr
    victim     unsafe.Pointer
    victimSize uintptr
    New func() any
}
```

`noCopy` plus internal pointers that would be shared (and probably wrong) after a copy.

### atomic.Value (and Int32/Int64/etc.)

```go
type Value struct {
    v any
}

type Int64 struct {
    _ noCopy
    v int64
}
```

The `_ noCopy` field is the modern pattern (Go 1.19+).

### strings.Builder

```go
type Builder struct {
    addr *Builder
    buf  []byte
}
```

The `addr` field is a self-pointer initialised on first use. On any subsequent use, the code checks `b.addr == b`. If `b` has been copied, the address differs, and the builder panics with "illegal use of non-zero Builder copied by value."

This is a different defence pattern: detect copies at runtime, not via vet. Useful because `strings.Builder` doesn't contain a Locker, so vet would not flag copies otherwise.

### bytes.Buffer

```go
type Buffer struct {
    buf      []byte
    off      int
    lastRead readOp
}
```

`bytes.Buffer` *is* copyable (no noCopy, no internal mutex). Different design choice. Adjusting for the difference: the design intent is that two copies of a Buffer share nothing — they're independent buffers with their own state. This is the right design for a value type used as a temporary builder. Mutex-containing types are the opposite.

---

## Appendix I: Generics interactions revisited

Generic code makes the copy question trickier because the type parameter `T` may or may not contain a Locker depending on the instantiation.

### The constraint-aware approach

```go
type LockerConstraint[T any] interface {
    *T
    sync.Locker
}

func WithLock[T any, PT LockerConstraint[T]](l PT, f func(*T)) {
    l.Lock()
    defer l.Unlock()
    f((*T)(l))
}
```

`PT` is constrained to be a pointer to `T` and to satisfy `sync.Locker`. The function accepts a pointer, never a value. Copying is impossible at the type level.

Caller:

```go
type MyType struct{ sync.Mutex }
func (*MyType) someMethod()

var m MyType
WithLock[MyType, *MyType](&m, func(p *MyType) {
    p.someMethod()
})
```

The verbosity is real. For library code with strong correctness requirements, it is justified. For most application code, simpler patterns are fine.

### A simpler pattern

```go
func WithLockSimple(l sync.Locker, f func()) {
    l.Lock()
    defer l.Unlock()
    f()
}
```

`sync.Locker` is an interface; passing a `*sync.Mutex` works. Passing a `sync.Mutex` (value) does not compile because the value type does not satisfy `Locker`. Good.

### Type parameters that flow into closures

```go
func Store[T any](slot *T, value T) {
    *slot = value
}
```

If `T` is `MyType` (a Locker-containing struct), the assignment `*slot = value` copies the mutex. Vet flags this only in recent Go versions. The safer pattern is to take `*T`:

```go
func StorePtr[T any](slot **T, value *T) {
    *slot = value
}
```

Now we copy pointers, not values. The mutex stays in place.

---

## Appendix J: Frequently overlooked copy sites

A list, with brief explanations, of less-obvious copy sites:

1. **`map[K]T` where T contains a Locker.** Even *reading* `m[k]` copies. Even iterating `for _, v := range m` copies. The map elements should be `*T`.

2. **`[]T` slices where T contains a Locker.** `for _, v := range slice` copies each element. Use `for i := range slice { v := &slice[i]; ... }`.

3. **`chan T` where T contains a Locker.** Sends and receives copy. Use `chan *T`.

4. **Returning a struct-with-Locker by value from a constructor.** `func New() T { return T{...} }` copies on return. Use `func New() *T { return &T{...} }`.

5. **`sync.Pool` whose New function returns a value, not a pointer.** `pool.Get()` returns `any`; the value held in the pool is the struct. Each `Get` retrieves it (possibly copying) and `Put` stores it back. Use pointer-typed pool elements.

6. **`json.Unmarshal` into a struct-with-Locker.** Reflection-based; vet does not flag, but the underlying behaviour is the same — the unmarshal writes into the struct, but if a wrapper later copies it, you have a bug. Decode into a pointer.

7. **`flag.Var` with a value receiver.** `flag.Value` interface methods are typically defined with pointer receivers, but if a user defines a custom flag value with a value receiver and embeds a mutex, the same bug appears.

8. **`http.Handler` interface with a value-typed handler containing a Locker.** Every dispatch may or may not copy depending on how the handler is registered.

9. **`errors.As` and `errors.Is` with errors that contain Lockers.** Unwrapping may copy. Use pointer-typed error values.

10. **`encoding/gob` and `encoding/json` round-trips.** Decoding always allocates new fields; the decoded value is fresh. But if you cache a value-typed struct and then unmarshal into a stack-local copy, that copy has a different mutex. Use pointers.

11. **gRPC generated code.** Protobuf-generated structs sometimes contain `sync.Mutex` for internal state. The generator uses pointer receivers, but downstream code that copies the message struct (e.g., for tests, for cloning) breaks the lock.

12. **Worker pool task structs.** A worker pool that takes `Task` values and passes them by value through channels copies. Use `*Task`.

---

## Appendix K: Library author guidelines

If you are writing a Go library that exports types with internal synchronisation, follow these rules:

### 1. Document the no-copy expectation

```go
// Cache is a concurrent-safe key-value store. A Cache must not be
// copied after the first use.
type Cache struct {
    mu   sync.Mutex
    data map[string]any
}
```

The doc comment is the contract. Tooling reinforces it; the comment makes it explicit.

### 2. Provide a constructor

```go
// NewCache returns a new, empty Cache.
func NewCache() *Cache {
    return &Cache{data: make(map[string]any)}
}
```

The constructor returns `*Cache`. Users who write `c := NewCache()` get a pointer; they cannot accidentally take a value.

### 3. Use pointer receivers throughout

Every method on `*Cache`. No value receivers.

### 4. Use `*Cache` in public method signatures involving Cache

```go
func (c *Cache) Get(k string) (any, bool) { ... }
func (c *Cache) Set(k string, v any) { ... }
```

If a method takes a `Cache` (value), users may pass a value. Always take `*Cache`.

### 5. Do not embed Cache in other types if those types are sometimes used as values

Embedding propagates the no-copy expectation. If your type is sometimes used as a value, do not embed a Locker. Instead, hold a `*Cache` or compose differently.

### 6. Run vet in your tests

The library's test files should run cleanly under `go vet`. CI should enforce.

### 7. Consider noCopy if you also want compile-ish detection

For types that do not embed a Locker but should not be copied, add a `noCopy` field.

### 8. Avoid returning interface values that wrap copies

If you have a `type Iterator interface { ... }` and the underlying iterator contains a Locker, ensure the iterator is always a `*concreteIter`, never a `concreteIter`.

---

## Appendix L: Reviewing pull requests for mutex copy bugs

When you review a PR that touches concurrent code, scan for the following patterns. The order is roughly by frequency.

### Pattern 1: New value-receiver method on a struct-with-Mutex

If the PR introduces a method `(t T) Foo()` on a type that contains a `sync.Mutex`, the PR is broken. Comment with a request to change the receiver.

### Pattern 2: New function `func(t T)` parameter

Same as above. Request `*T`.

### Pattern 3: New return value `func() T`

Same. Request `*T`.

### Pattern 4: New map `map[K]T`

Request `map[K]*T`.

### Pattern 5: New range loop over `[]T`

If the loop body does anything with the loop variable that involves the mutex (locks, calls a method that locks), request `for i := range s { v := &s[i]; ... }`.

### Pattern 6: New channel `chan T`

Request `chan *T`.

### Pattern 7: New composite literal initialising from a value

`x := T{...}` is fine for fresh construction. `x := *existing` is a copy. Look for the latter.

### Pattern 8: New `defer fmt.Println(t)` style

Argument is evaluated and copied at defer. Request `defer fmt.Println(&t)` or wrap in a closure.

### Pattern 9: New goroutine literal capturing by value

`go func(t T) { ... }(t)` copies. Use `go func() { ... }()` or `go func(t *T) { ... }(&t)`.

### Pattern 10: New interface value initialisation

If you see `var l sync.Locker = m` where `m` is a value of struct type containing a mutex, the interface is now wrapping a heap copy. Use `&m`.

### General advice for reviewers

- Run vet on the PR branch. Comment with the output.
- If the PR touches a struct's receiver kind, audit all methods on the struct.
- If the PR adds a new public type with synchronisation, request docs explaining the no-copy expectation.
- If the PR adds tests that do `var t T`, request `t := &T{}` or `t := NewT()`.

---

## Appendix M: Mental model for senior engineers

Internalise these mental images.

### A mutex is a bench, not a sign

Imagine a single physical bench. A mutex is the bench. Only one person can sit on it at a time. The "lock" is sitting; the "unlock" is standing up. The bench has a queue of people waiting to sit. The bench exists at a single physical location.

A *copy* of the bench is a *different bench* at a different location. People at the original bench cannot interact with people at the copy. The queues are separate.

In code: the `state` and `sema` words are the bench's "occupied" indicator and "queue of waiters." Copying creates a second bench with its own indicator and queue. Goroutines that thought they were waiting for one bench are actually waiting for two.

### A mutex is an anchor, not an instruction

A mutex is not a *thing you do*; it is a *location in memory that goroutines coordinate around*. The act of locking is incidental; the *location* is what matters. Copy the location, and you lose the coordination.

Compare with a channel: a channel value (`chan T`) is a pointer internally; copying the channel copies the pointer; both copies coordinate around the same underlying ring buffer. This is the reference-type model and it works. Mutex is *not* a reference type.

### A mutex is hostile to value semantics

Most Go types compose well with value semantics: structs, arrays, basic types, even slices and maps (which are reference types but copy cheaply). Mutexes — and the other `sync` primitives — are hostile to value semantics. They demand reference semantics. The compiler will not enforce this; vet helps; the rest is on you.

### When in doubt, take a pointer

If you are unsure whether a struct should be passed by value or by pointer, the presence of a `sync.Mutex` makes the decision: pointer. Always. No exceptions.

---

## Appendix N: A senior-level interview probe

You are interviewing a candidate for a senior Go role. Ask:

> "Describe what happens at the byte level when this code runs."

```go
type Counter struct {
    mu sync.Mutex
    n  int
}

var a Counter
a.mu.Lock()
b := a
a.n = 1
a.mu.Unlock()
b.mu.Lock()
b.n = 2
b.mu.Unlock()
fmt.Println(a.n, b.n)
```

A senior candidate should walk through:

1. `var a Counter` — 16 bytes of zeroed memory (8 bytes for Mutex, 8 for int).
2. `a.mu.Lock()` — CAS on `a.mu.state` from 0 to 1. Memory at `&a.mu.state` becomes 1.
3. `b := a` — memcpy of `a` into `b`. Now `b.mu.state == 1`, `b.n == 0`, but `b.mu` is a *different memory location* from `a.mu`.
4. `a.n = 1` — writes to `&a.n`.
5. `a.mu.Unlock()` — atomic subtract on `&a.mu.state`. Goes from 1 to 0.
6. `b.mu.Lock()` — sees `b.mu.state == 1` (from the copy). The fast path CAS expects 0 and fails. Falls into the slow path. The slow path tries to enter the spin/park loop. Eventually it manages to acquire — because there are no actual waiters parked on `b.mu.sema`. Detail depends on Go version's exact spinning behaviour.
7. `b.n = 2` — writes to `&b.n`.
8. `b.mu.Unlock()` — subtract on `&b.mu.state`. May or may not panic depending on the state's lower bits at this point.
9. `fmt.Println(a.n, b.n)` — prints `1 2`.

The senior candidate should also note: vet flags `b := a` because `Counter` contains `sync.Mutex`. The runtime behaviour is undefined in the formal sense but typically does not crash on this exact code.

A junior candidate would say "they're independent variables, prints 1 2." A middle candidate would say "this copies the mutex, which is wrong." A senior candidate explains the byte-level mechanics and the runtime invariants that are violated.

---

## Appendix O: Worked exercise — instrumented mutex

Build a debug wrapper around `sync.Mutex` that logs every Lock/Unlock with the caller's identity, so we can audit lock usage in tests.

```go
package debugmu

import (
    "fmt"
    "runtime"
    "sync"
    "sync/atomic"
)

type Mutex struct {
    _    [0]sync.Mutex // ensures non-copyable per vet
    mu   sync.Mutex
    id   atomic.Uint64
    name string
}

var nextID atomic.Uint64

func New(name string) *Mutex {
    m := &Mutex{name: name}
    m.id.Store(nextID.Add(1))
    return m
}

func (m *Mutex) Lock() {
    pc, file, line, _ := runtime.Caller(1)
    fn := runtime.FuncForPC(pc).Name()
    fmt.Printf("LOCK   id=%d name=%s from %s:%d (%s)\n", m.id.Load(), m.name, file, line, fn)
    m.mu.Lock()
}

func (m *Mutex) Unlock() {
    pc, file, line, _ := runtime.Caller(1)
    fn := runtime.FuncForPC(pc).Name()
    fmt.Printf("UNLOCK id=%d name=%s from %s:%d (%s)\n", m.id.Load(), m.name, file, line, fn)
    m.mu.Unlock()
}
```

Key design choices:

- `_ [0]sync.Mutex` — a zero-sized array of `sync.Mutex`. It contributes no bytes to the struct but is structurally a `sync.Mutex`, which makes vet flag any copy of `debugmu.Mutex`. The actual mutex used at runtime is the named field `mu`.
- `id atomic.Uint64` — a unique identifier per Mutex instance, useful when many of these are interleaved in a log.
- The constructor returns `*Mutex`.

Use it:

```go
var m = debugmu.New("inventory")

func work() {
    m.Lock()
    defer m.Unlock()
    // ...
}
```

If anyone tries `m2 := *m`, vet flags it. The log output gives you the call site of every Lock/Unlock, which you can grep through after a test run to verify discipline.

This wrapper is for development only — the call to `runtime.Caller` and the log writes are expensive. In production, use the standard `sync.Mutex`.

---

## Appendix P: A note on `golang.org/x/sync/singleflight` and friends

The `singleflight` package coalesces duplicate calls into one. Its `Group` type contains a `sync.Mutex`:

```go
type Group struct {
    mu sync.Mutex
    m  map[string]*call
}
```

Copying a `singleflight.Group` is a vet error. The doc says "A Group must not be copied after first use." Internalise this pattern: every standard-library type containing a Mutex follows the same convention.

Similar packages with the same rule:

- `golang.org/x/sync/errgroup` — `Group` contains `sync.Mutex`.
- `golang.org/x/sync/semaphore` — `Weighted` contains `sync.Mutex`.
- `golang.org/x/time/rate` — `Limiter` contains `sync.Mutex`.

If you see a function that takes one of these by value, the function is a copy bug. Vet catches it.

---

## Appendix Q: Closing reflections

Becoming senior on this topic is about three things:

1. **Mechanistic understanding.** You can explain the byte layout, the state-word bits, the sema-keyed parking, the unlock-fast-path, and the implications of each at the machine level.

2. **Tooling fluency.** You know what vet's `copylocks` pass detects and misses. You know how to read a mutex profile. You know when to use the race detector vs the block profile vs the trace tool.

3. **Design discipline.** You write types that cannot be copied accidentally. You review PRs for copy bugs systematically. You document the no-copy expectation in every relevant API.

At the professional level (next document), we apply this understanding to production systems: lock-free alternatives, sharded data structures, RWMutex-vs-Mutex tradeoffs under real workload, mutex contention monitoring at scale, and the distinct topic of distributed locking (which fails for entirely different reasons but has the same flavour: shared resources, coordination across processes).

The single most important habit is: when you see a `sync.Mutex` in a struct, immediately ask three questions:

1. Are all methods pointer-receiver?
2. Is the constructor returning a pointer?
3. Is vet clean?

If the answers are yes-yes-yes, the type is structurally safe from copy bugs. If any answer is no, find out why.

---

## Appendix R: Deep dive into runtime_canSpin

When a goroutine fails the fast-path CAS on `Lock`, it asks the runtime whether it should spin or park. The answer is given by `runtime_canSpin(iter int) bool` (linked in from `runtime/proc.go` as `sync_runtime_canSpin`):

```go
const active_spin = 4
const active_spin_cnt = 30

func sync_runtime_canSpin(i int) bool {
    if i >= active_spin || ncpu <= 1 || gomaxprocs <= sched.npidle.Load()+sched.nmspinning.Load()+1 {
        return false
    }
    if p := getg().m.p.ptr(); !runqempty(p) {
        return false
    }
    return true
}
```

Spin only if:
- We have not spun more than 4 times already.
- The machine has multiple CPUs.
- There are other Ps doing useful work (i.e., we are not on a near-idle machine where spinning is wasteful).
- Our own P's runqueue is empty (we have nothing else useful to do).

If all conditions hold, the goroutine calls `runtime_doSpin`, which issues 30 PAUSE instructions (on amd64) or equivalent. This burns ~150 cycles, giving the lock holder a chance to release before we expensive-park.

### How a copy affects spinning

A copy of a mutex has its own `state` word. The spinning logic reads from the copy's state. If the copy is "locked" (because the copy operation captured the locked state of the original), spinning on it is wasted: there is no goroutine currently doing useful work that would release this lock. Eventually `runtime_canSpin` returns false (iter exhausted), and the goroutine parks on `&copy.sema`.

The wasted spinning is small (a few hundred cycles), but it is a useful signal. If you see CPU time spent in `runtime.procyield` or in the inner loop of `sync.(*Mutex).lockSlow` in your CPU profile, and the mutex contention profile is empty, you may have a copy bug producing unnecessary spinning.

---

## Appendix S: The interaction with stacks

Goroutines have small, dynamically-growing stacks. A struct with a mutex placed on the stack has its mutex's address change *only* if the stack moves. Stack moves happen during stack growth (`morestack`).

```go
type T struct{ mu sync.Mutex }

func recurse(t *T, depth int) {
    if depth == 0 { return }
    var local [1024]byte
    _ = local
    recurse(t, depth-1)
}

func main() {
    var t T
    recurse(&t, 1000) // stack grows; if t were on the stack, it might move
}
```

`t` is in `main`'s stack frame. The recursion happens in `recurse`. `main`'s stack frame does not move during the recursion (only `recurse`'s does). So `&t` is stable.

But suppose:

```go
func f() {
    var t T
    runFastWorker(&t)
    deeprecurse() // grows f's stack
    runFastWorker(&t)
}
```

Wait — can Go's stack growth move `f`'s frame? Yes. The runtime reallocates the stack and updates all internal references. The pointer `&t` is automatically rewritten to point to the new location of `t`. From the user's perspective, the address has *not* changed at the language level.

But internally, the *physical* address has changed. The semaphore that was keyed on the old address now has waiters parked at the *new* address — wait, no. The runtime updates all pointers, including those in the semaroot's treap. The waiters' keys are also updated. So everything stays consistent.

For mutexes used solely from within a stack frame, copying through stack growth is *not* a bug, because the runtime tracks the move. This is a wonderful property of Go's runtime, often taken for granted.

### Heap-allocated mutexes are simpler

Most production mutexes live in heap-allocated structs (`&Counter{}` or returned from constructors). Heap allocations do not move (Go's GC does not compact). The address is stable for the lifetime of the object. Copy bugs in this case are entirely user-introduced, not runtime-induced.

---

## Appendix T: Mutexes and finalisers

`runtime.SetFinalizer` lets you register a function to run when an object becomes unreachable. Goroutines can hold pointers to a mutex's enclosing struct; once those pointers are gone, the object is collectable. The finaliser runs in a separate goroutine.

If your finaliser locks the mutex — perhaps to "clean up" — you must be sure no other goroutine could still be using the mutex. By definition the GC has decided the object is unreachable, so no other goroutine should hold a pointer to it. But finaliser order is not guaranteed, and finalisers can resurrect objects (by storing the receiver pointer in a reachable variable).

Best practice: do not put `sync.Mutex` operations in finalisers. If you need cleanup, expose a `Close` method that the user calls explicitly.

---

## Appendix U: Cross-package mutex sharing

It is occasionally tempting to share a `sync.Mutex` between packages:

```go
// package a
var SharedMu sync.Mutex

// package b
import "a"

func f() {
    a.SharedMu.Lock()
    defer a.SharedMu.Unlock()
}
```

This works correctly because `a.SharedMu` is a package-level variable with a stable address. Both packages reference the same memory. Locking and unlocking from anywhere works.

But the design is rarely good. It creates implicit coupling: package `a` does not know who is locking `a.SharedMu` or why. Tracking down lock dependencies across packages is painful.

A better design: expose a Locker through an interface or factory:

```go
// package a
var sharedMu sync.Mutex

func GuardedOperation(f func()) {
    sharedMu.Lock()
    defer sharedMu.Unlock()
    f()
}
```

Callers go through `a.GuardedOperation`. They cannot lock/unlock directly. Refactoring is local to package `a`.

If you do share a mutex, use a pointer: `var SharedMu = &sync.Mutex{}`. This makes it explicit that callers should not copy.

---

## Appendix V: Read-only data and the mutex question

A frequently overlooked design pattern: data that is *populated once* and then *read many times* needs no mutex. The single-write-many-read pattern is a great fit for `sync.Once`:

```go
type Config struct {
    once sync.Once
    data map[string]string
}

func (c *Config) Get(k string) string {
    c.once.Do(c.load)
    return c.data[k] // no lock — map is immutable after load
}

func (c *Config) load() {
    c.data = make(map[string]string)
    // populate c.data ...
}
```

After `c.once.Do(c.load)` returns, `c.data` is fully initialised and not modified. Reads need no synchronisation. The `sync.Once` itself is the synchronisation primitive: it guarantees that all reads in goroutines that have called `Do` see the writes performed in `load`.

If you find a mutex in your code that exists only because "I want to be safe" — and the data is in fact read-only after initialisation — eliminate the mutex. The performance win is real, and there is no copy bug to worry about.

### Variant: atomic.Value for read-mostly state

If the data needs to be replaced occasionally (e.g., config reload), `atomic.Value` is the next step up:

```go
var cfg atomic.Value // holds *Config

func setConfig(c *Config) { cfg.Store(c) }
func getConfig() *Config { return cfg.Load().(*Config) }
```

Reads are atomic loads (essentially free). Writes replace the pointer atomically. Old config remains valid for any goroutine that loaded it.

The trade-off: a brief period during which different goroutines see different configs. For most uses this is acceptable.

---

## Appendix W: Mutex order and deadlock avoidance

A struct may have multiple mutexes:

```go
type Transfer struct {
    fromMu sync.Mutex
    fromBalance int

    toMu sync.Mutex
    toBalance int
}
```

The classic deadlock scenario:

```go
// Goroutine 1
t.fromMu.Lock()
t.toMu.Lock()
// ...

// Goroutine 2
t.toMu.Lock()
t.fromMu.Lock()
// ...
```

Goroutine 1 holds `fromMu`, waits for `toMu`. Goroutine 2 holds `toMu`, waits for `fromMu`. Deadlock.

The standard solution is *lock order*: always acquire mutexes in a consistent order (e.g., by address or by a designated rank). With two struct fields, you can pick a rule: always lock `fromMu` first.

But — and this is the senior-level twist — *copying the struct breaks the order*. If `t` is copied, `t.fromMu` and `t2.fromMu` are different mutexes at different addresses. A code path that intends to "always lock from-mutex first" may end up locking the original's `fromMu` and the copy's `toMu`, which are independent locks, defeating the deadlock-prevention strategy entirely.

Once again: do not copy.

### Lock order across types

When two unrelated types share a lock pattern, the runtime cannot enforce order, and neither can vet. Standard practice is to define a *package-level* lock-order document and audit code reviews against it. For complex systems, libraries like `golang.org/x/sync/syncmap` (deprecated) and modern alternatives provide higher-level abstractions that hide the locks entirely.

The principle: if you find yourself thinking about lock order, consider whether your design has fundamentally too many locks. Often there is a simpler architecture (sharding, single coordinator, channels) that eliminates the question.

---

## Appendix X: The future of sync.Mutex

The Go team has occasionally proposed changes to `sync.Mutex`:

- **Tracing-friendly mutex** (proposal #19895): expose more information for profiling. Status: discussed, not adopted.
- **Recursive mutex**: reject. Rationale: "if you need a recursive mutex, your design is wrong."
- **Try-lock**: `TryLock` was added in Go 1.18 with extensive cautionary documentation. It does not change the copy semantics.

The fundamental shape of `sync.Mutex` is unlikely to change. The `state` and `sema` fields, the spinning behaviour, the starvation mode, the no-copy rule — all are stable. If you internalise them now, your understanding will remain correct for years.

### TryLock and copies

```go
func (m *Mutex) TryLock() bool {
    if atomic.CompareAndSwapInt32(&m.state, 0, mutexLocked) {
        if race.Enabled {
            race.Acquire(unsafe.Pointer(m))
        }
        return true
    }
    return false
}
```

`TryLock` does the same fast-path CAS as `Lock`, but returns `false` if the CAS fails instead of falling into the slow path. The doc warns "Note that while correct uses of TryLock do exist, they are rare, and use of TryLock is often a sign of a deeper problem in a particular use of mutexes."

`TryLock` on a copied mutex behaves the same as `Lock`: it operates on the copy's state, independent of the original. All the copy hazards apply.

---

## Appendix Y: Mutex hygiene and code organisation

A well-organised package places mutex-related logic in a small number of files and uses consistent patterns. Suggestions:

### Group locked methods

```go
// state.go

type State struct {
    mu  sync.Mutex
    // ... fields ...
}

// All methods that take the lock are in this file.
func (s *State) GetX() int      { s.mu.Lock(); defer s.mu.Unlock(); return s.x }
func (s *State) SetX(x int)     { s.mu.Lock(); defer s.mu.Unlock(); s.x = x }
// ...
```

Methods that do not take the lock live elsewhere. The reviewer can grep one file to see the full locking surface.

### Document the lock invariant

```go
// State holds the mutable state of the service. All public methods
// are safe for concurrent use; they acquire the mutex internally.
//
// State must not be copied after the first use. Use a *State.
type State struct {
    mu sync.Mutex
    // x is protected by mu.
    x int
    // y is protected by mu.
    y string
}
```

For every field, document which mutex protects it. For multi-mutex structs, document the lock order.

### Helper functions

For frequently-used patterns, extract:

```go
func (s *State) withLock(f func()) {
    s.mu.Lock()
    defer s.mu.Unlock()
    f()
}
```

Some teams find this useful; others find it obscures more than it clarifies. Pick a convention.

### Lock-free reads where possible

If a field is read-only after initialisation, document it and read without the lock. Otherwise the lock-on-read tax is paid for nothing.

```go
type State struct {
    mu sync.Mutex
    // x is protected by mu.
    x int
    // initialisedAt is set in the constructor and never modified.
    initialisedAt time.Time
}

func (s *State) Age() time.Duration {
    return time.Since(s.initialisedAt) // no lock needed
}
```

Senior reviewers explicitly check for lock-free read opportunities. The performance benefits are real; the cognitive simplification is bigger.

---

## Appendix Z: The relationship to other concurrency anti-patterns

Mutex copying is one of several concurrency anti-patterns. Related patterns and their interplay:

### Copying vs. forgotten Unlock

Forgotten Unlock is a different bug: a function locks the mutex and returns without unlocking. The mutex is held forever; other goroutines deadlock. The fix is `defer m.Unlock()` right after `m.Lock()`. Copying does not protect against this; you can copy a perfectly-disciplined mutex and still produce two stuck locks.

### Copying vs. double Unlock

Double Unlock is a runtime fatal. Two `Unlock` calls for one `Lock`. The runtime detects this and crashes. Copying can produce double-unlocks (the original's `Unlock` and a copy's `Unlock` both seeing `state == 1`) but more often produces *no* panic because each `Unlock` is operating on its own state word.

### Copying vs. unbalanced Lock/Unlock

If `Lock` is called in one function and `Unlock` in another, copying makes the pairing impossible to track. Even without copying, this pattern is fragile. Best practice: `Lock` and `Unlock` in the same function, with `defer`.

### Copying vs. lock-then-do-IO

Holding a mutex while doing slow I/O (network, file) is a contention disaster. Other goroutines pile up on the lock. The fix is to do the I/O first, then briefly lock to update shared state. Copying does not address this.

### Copying vs. race conditions on protected data

Even with a correctly-used mutex, a race condition can exist if the protected data is reachable through another path that bypasses the lock. The race detector catches these. Copying *creates* such bypasses: one copy's lock does not protect the other's data.

---

## Appendix AA: Reading lists for the senior engineer

Curated references:

1. **The Go Memory Model** (https://go.dev/ref/mem): the authoritative source. The 2025-02-04 revision is the latest at the time of this writing.

2. **`sync` package documentation** (https://pkg.go.dev/sync): scan all types. Read the doc comments carefully.

3. **`sync/mutex.go` in the Go source**: the implementation. Read once, understand the spinning, parking, and unlock paths.

4. **Russ Cox's "Off to the Races"** (blog post): historical context on Go's race detector and memory model.

5. **The `copylocks` analyser source** (`go/analysis/passes/copylock/copylock.go`): see what vet does.

6. **Bryan Mills, "Concurrency in Go"** (GopherCon talk): mental models for concurrent design.

7. **The `golang.org/x/sync` package**: see how the standard library handles common concurrency patterns (singleflight, errgroup, semaphore, syncmap).

8. **Cliff L. Biffle, "The Cost of a Cache Miss"** (blog post): not Go-specific, but explains why atomic operations cost so much and why contention is expensive.

9. **Memory model papers**: Adve & Gharachorloo's "Shared Memory Consistency Models: A Tutorial." Lamport's "How to Make a Multiprocessor Computer That Correctly Executes Multiprocess Programs."

10. **Production case studies**: blog posts from companies like Uber, Cloudflare, and Dropbox on mutex contention in production Go services. Look for "Go mutex contention" on tech blogs.

---

## Appendix BB: Practice problems for the senior

To consolidate understanding, work through:

1. Implement a thread-safe LRU cache from scratch. Use a `sync.Mutex` and a doubly-linked list. Test under concurrent load. Profile mutex contention. Try replacing with sharded mutexes and measure improvement.

2. Build a `WithLock[T]` generic function that takes a `*T` and a function, locks via embedded `sync.Mutex`, calls the function, and unlocks. Make it compile-safe so users cannot pass a value type.

3. Audit a real codebase (e.g., your team's main service) with `go vet ./...` and `staticcheck ./...`. Resolve every diagnostic. Document the patterns you find.

4. Write a custom `golang.org/x/tools/go/analysis` pass that flags methods named "Get*" or "Set*" with value receivers on types containing fields whose names end in "mu" or "Mutex." Integrate into your CI.

5. Build a stress test that runs N goroutines incrementing a counter. Intentionally introduce a copy bug. Measure the discrepancy between intended count and observed count under different goroutine counts. Plot results.

6. Read the `sync.Cond` implementation. Understand why a copy of a `Cond` deadlocks. Write a test that demonstrates the deadlock (it should reproduce reliably).

7. Implement a custom synchronisation primitive (e.g., a counting barrier) with the `noCopy` marker. Verify vet flags copies.

8. Read the runtime source for `runtime.semroot`, `runtime.semacquire1`, and `runtime.semrelease1`. Trace what happens when two different `sync.Mutex` values map to the same semaroot bucket.

Spend time on each. The mechanical exercise reinforces the conceptual understanding.

---

## Appendix CC: A final mental checklist

Before declaring code "safe from mutex copy bugs":

- [ ] `go vet ./...` is clean.
- [ ] Every method on a struct-with-Mutex has a pointer receiver.
- [ ] Every constructor returning a struct-with-Mutex returns a pointer.
- [ ] Public APIs accept and return `*T`, not `T`.
- [ ] Maps and channels carry `*T`, not `T`.
- [ ] Range loops over slices of `T` use `&slice[i]`, not the value loop var.
- [ ] Closures capture the struct by reference, not by value.
- [ ] `defer` arguments are evaluated to pointers, not values.
- [ ] Interface fields holding Lockers hold `*T`, never `T`.
- [ ] Reflection code does not create new T values that contain Lockers.
- [ ] Doc comments on the type explicitly state "must not be copied after first use."
- [ ] CI runs `go vet` and `go test -race` on every PR.

If all boxes are checked, you have done what you can. The next layer — profiling, contention monitoring, lock-free design — is covered in `professional.md`.

---

## Appendix DD: Detailed walk-through of representative production bugs

The literature on Go services in production is full of mutex copy bugs that took hours or days to diagnose. Below are reconstructed bug reports from the wild (anonymised, simplified).

### Bug 1: The disappearing metrics

A service exposed a `MetricsCollector` type:

```go
type MetricsCollector struct {
    mu      sync.Mutex
    counts  map[string]int64
}

func (m MetricsCollector) Inc(name string) {
    m.mu.Lock()
    defer m.mu.Unlock()
    m.counts[name]++
}

func (m MetricsCollector) Snapshot() map[string]int64 {
    m.mu.Lock()
    defer m.mu.Unlock()
    out := make(map[string]int64)
    for k, v := range m.counts {
        out[k] = v
    }
    return out
}
```

Observed behaviour: metrics endpoint returned the same values for hours. The team initially assumed a caching bug. Investigation: vet had been ignored for some time. `go vet ./...` immediately surfaced the copylocks errors.

Root cause: value receivers. Every `Inc` call wrote to a copy of `counts`. But maps are reference types — both copies pointed to the same underlying hash table. So the writes *did* persist into the original's map. So why did the metrics endpoint return stale values?

Diving deeper: the `counts` field in the original was *nil*. The struct was constructed as `var m MetricsCollector` (zero value). When `Inc` was called, the copy's `m.counts` was also nil. The map increment `m.counts[name]++` on a nil map panics. But the code was wrapped in a recovered goroutine, swallowing the panic.

The fix was twofold: pointer receivers, and ensure the map is initialised in a constructor. After the fix, metrics worked correctly.

Lessons:

- Vet warnings should never be ignored.
- Recovered goroutines that swallow panics make diagnosis dramatically harder.
- Constructors are not optional.

### Bug 2: The deadlocking config reload

A service supported config reload via signal. The reload function:

```go
type Server struct {
    mu     sync.RWMutex
    config Config
}

func (s Server) ReloadConfig(newConfig Config) {
    s.mu.Lock()
    defer s.mu.Unlock()
    s.config = newConfig
}

func (s Server) GetConfig() Config {
    s.mu.RLock()
    defer s.mu.RUnlock()
    return s.config
}
```

Observed behaviour: after SIGHUP, the new config was applied. Five minutes later, all requests started timing out. The service had to be restarted.

Root cause: value receivers. Every `GetConfig` call copied the entire `Server` including the RWMutex. Each call's local copy had its own state. After enough calls, some goroutine's copy entered "starving" mode (the starving bit propagated to the copy). That copy's local lock-handoff logic then expected to find a waiter on its own `sema` — none exists, leading to runtime spin-wait that never resolves.

The "five minute delay" was the time for enough copies to accumulate starvation hints. Until then, the bug manifested only as elevated CPU.

The fix: pointer receivers. After the fix, the service no longer hung post-reload.

Lessons:

- RWMutex copy bugs have stranger timing signatures than Mutex copy bugs.
- Always run `go vet` after refactoring a sync-bearing type.

### Bug 3: The phantom worker pool

A worker pool implementation:

```go
type Worker struct {
    id   int
    mu   sync.Mutex
    busy bool
}

type Pool struct {
    workers []Worker
}

func (p *Pool) Acquire() *Worker {
    for i := range p.workers {
        w := p.workers[i] // COPY
        w.mu.Lock()
        if !w.busy {
            w.busy = true
            w.mu.Unlock()
            return &w
        }
        w.mu.Unlock()
    }
    return nil
}
```

Observed behaviour: the pool returned workers, but the original pool always saw `busy == false` on every worker. New `Acquire` calls returned the *same* worker repeatedly. Eventually thousands of goroutines all thought they had exclusive access to worker #0.

Root cause: `w := p.workers[i]` copies the worker struct. The lock/unlock and the `busy = true` operate on the copy. The original's `busy` stays false.

Fix: `w := &p.workers[i]`. Now all operations go through the pointer; the original struct is updated.

Lessons:

- Range and indexed access into a slice of struct-with-Mutex always needs an explicit address-of.
- Look for this pattern in any pool, registry, or table data structure.

### Bug 4: The unjustified scaling

A team observed that doubling their service's instance count did not improve throughput. They blamed the load balancer. After deeper investigation:

The service had a contended `sync.Mutex` protecting a global cache. Each instance had its own mutex. Adding instances should have improved throughput linearly because each instance's cache was independent. But it didn't.

Root cause: a configuration object was passed by value through several layers. The config contained a `sync.Once` (initialising a default value). Each instance had its own config. But the config struct was *copied into each handler call*. Each call's copy had its own `once.done` flag.

The "default value initialisation" — an expensive operation — ran *per handler call* on a per-copy basis, instead of once per instance. The CPU was 99% busy doing initialisation work, not serving requests. Doubling instances only doubled the initialisation throughput, which was the bottleneck.

The fix: pass `*Config`, not `Config`.

Lessons:

- Mutex copy bugs can manifest as scaling failures, not just correctness failures.
- `sync.Once` copy bugs are especially insidious because the "wrong" path still produces a value (just one calculated per copy instead of cached once).

### Bug 5: The race-free data race

A service used `sync.RWMutex` to protect a map:

```go
type Cache struct {
    sync.RWMutex
    data map[string]Item
}

func (c Cache) Get(k string) (Item, bool) {
    c.RLock()
    defer c.RUnlock()
    v, ok := c.data[k]
    return v, ok
}
```

Tests passed under `-race`. Production had occasional crashes with "concurrent map read and map write."

The race detector did not catch the bug in tests because the test only exercised reads through `Get` and writes through `Set` (with a pointer receiver). The locked path for reads operated on a copy of the mutex; the locked path for writes operated on the original. The race was on the *map*, which is shared between the copies (map headers are reference types).

The race detector did fire in production occasionally, because production load was higher and the timing window was wider. Tests, with fewer goroutines, mostly missed it.

Root cause: value receiver on `Get`. Fixed with `*Cache`.

Lessons:

- `-race` is not a substitute for vet. The two tools catch different mistakes.
- Tests that pass under `-race` can still ship copy bugs. The race detector samples, and rare races escape.

### Bug 6: The channel send copy

A pipeline:

```go
type Task struct {
    ID   string
    mu   sync.Mutex
    done bool
}

func producer(tasks chan Task) {
    for {
        t := Task{ID: uuid.New()}
        tasks <- t // COPY
    }
}

func consumer(tasks chan Task) {
    for t := range tasks {
        t.mu.Lock()
        t.done = true
        t.mu.Unlock()
        // ... do work ...
    }
}
```

Observed behaviour: tasks were processed correctly, but a debug print of "completed tasks" later was always empty.

Root cause: `tasks <- t` copies. `consumer` operates on its own copy. The producer's task is never updated. Whoever later reads "completed tasks" sees the original's `done = false`.

Fix: `chan *Task`. Now the channel carries pointers; sends and receives copy the pointer, not the underlying struct.

Lessons:

- Channels of struct-with-Mutex are always wrong. Use channels of `*T`.
- Vet catches this in recent Go versions.

### Bug 7: The reflection-based clone

A generic "deep clone" utility:

```go
func DeepClone[T any](v T) T {
    src := reflect.ValueOf(v)
    dst := reflect.New(src.Type()).Elem()
    dst.Set(src) // copies all fields, including any Mutex
    return dst.Interface().(T)
}
```

Observed behaviour: testing on a `Counter` struct (which had a mutex). Cloned counters acted independently — desired. But increments on the clone were sometimes lost.

Root cause: `reflect.Value.Set` performs a bitwise copy. The Mutex's state is copied. If the source mutex was locked (or had waiters parked), the clone inherits the corrupted state.

The fix: do not deep-clone types containing mutexes. Provide custom Clone methods on each such type that reset the mutex to its zero state.

```go
func (c *Counter) Clone() *Counter {
    c.mu.Lock()
    defer c.mu.Unlock()
    return &Counter{n: c.n}
}
```

Note that the new Counter has its own fresh, zero-valued mutex.

Lessons:

- Reflection-based copying bypasses vet entirely. Be cautious with any "copy" library.
- Custom Clone methods are safer than generic deep-clone.

### Bug 8: The Once that fired twice

A constructor:

```go
type Singleton struct {
    once sync.Once
    value int
}

func (s Singleton) Init() {
    s.once.Do(func() {
        s.value = expensive()
    })
}
```

Observed behaviour: `expensive()` was called multiple times despite the `sync.Once`.

Root cause: value receiver. Each `Init` call has its own copy of `Singleton`, hence its own copy of `once`. Each copy's `once.done` flag is independent. Each copy fires the function once.

Vet flagged this immediately. The team had not been running vet in CI.

Fix: pointer receiver. Add vet to CI.

Lessons:

- `sync.Once` copy bugs cause exactly the wrong thing: the "once" function runs many times.
- `expensive()` may have side effects that compound the bug.

### Bug 9: The WaitGroup that never finished

```go
type BatchProcessor struct {
    wg    sync.WaitGroup
    items []Item
}

func (b BatchProcessor) Process() {
    for _, item := range b.items {
        b.wg.Add(1)
        go func(it Item) {
            defer b.wg.Done()
            handle(it)
        }(item)
    }
    b.wg.Wait()
}
```

Observed behaviour: tests hang. `wg.Wait()` never returns.

Root cause: value receiver. The `b` inside `Process` is a copy. Each goroutine receives the closure captured `b`, which is the same copy. `b.wg.Done()` decrements the copy's counter. But — wait, that should still work because all the goroutines share the same copy via closure.

Actually no: the goroutine's `b` is the closure captured value, which is the *same instance* as the local `b` in `Process`. So `Add` and `Done` should match.

The bug surfaces when `Process` is called *twice* concurrently on the same logical "BatchProcessor" — each call has its own `b` (copy), each with its own WaitGroup. The second call's `Done` happens against the second `wg`. The first call's `Wait` waits on the first `wg`, which is now decremented by goroutines spawned in either call. But the goroutines spawned in `Process` call 2 are decrementing call 2's `wg`. So call 1's `wg` may never reach zero if goroutines from call 1 misbehave.

The exact failure mode depends on timing. Vet flagged the receiver from the start. Fix: pointer receiver.

Lessons:

- `sync.WaitGroup` copy bugs cause both "Wait never returns" and "Wait returns too early," depending on which copy holds the counter.
- Concurrent calls to a method on a shared object require careful thinking about which instance owns the state.

### Bug 10: The slice-of-tasks map iteration

A task scheduler:

```go
type Task struct {
    Name string
    mu   sync.Mutex
    runs int
}

func RunAll(tasks []Task) {
    for _, t := range tasks {
        t.mu.Lock()
        t.runs++
        t.mu.Unlock()
        execute(t.Name)
    }
}
```

Observed behaviour: `tasks[0].runs`, etc., remained zero after the call.

Root cause: range-with-value. Each iteration's `t` is a copy. All increments go to the copy.

Fix: `for i := range tasks { t := &tasks[i]; ... }`.

Lessons:

- Slices of struct-with-Mutex always need indexed access if you want to mutate the originals.
- Vet flags this in recent versions; older versions did not.

---

## Appendix EE: A guided refactor

Take a small but representative codebase and refactor it. Imagine the following starter:

```go
package inventory

import "sync"

type Item struct {
    SKU   string
    Stock int
}

type Inventory struct {
    mu    sync.Mutex
    items map[string]Item
}

func (inv Inventory) Add(it Item) {
    inv.mu.Lock()
    defer inv.mu.Unlock()
    inv.items[it.SKU] = it
}

func (inv Inventory) Get(sku string) (Item, bool) {
    inv.mu.Lock()
    defer inv.mu.Unlock()
    it, ok := inv.items[sku]
    return it, ok
}

func (inv Inventory) Restock(sku string, qty int) error {
    inv.mu.Lock()
    defer inv.mu.Unlock()
    it, ok := inv.items[sku]
    if !ok {
        return fmt.Errorf("unknown sku %q", sku)
    }
    it.Stock += qty
    inv.items[sku] = it
    return nil
}
```

### Step 1: Run vet

```
$ go vet ./...
./inventory.go:11:6: Add passes lock by value: Inventory contains sync.Mutex
./inventory.go:17:6: Get passes lock by value: Inventory contains sync.Mutex
./inventory.go:23:6: Restock passes lock by value: Inventory contains sync.Mutex
```

Three errors, one per value-receiver method.

### Step 2: Change receivers to pointers

```go
func (inv *Inventory) Add(it Item) { ... }
func (inv *Inventory) Get(sku string) (Item, bool) { ... }
func (inv *Inventory) Restock(sku string, qty int) error { ... }
```

Re-run vet: clean.

### Step 3: Add a constructor

```go
func New() *Inventory {
    return &Inventory{
        items: make(map[string]Item),
    }
}
```

Without this, `var inv Inventory` would have a nil `items` map and would panic on Add.

### Step 4: Document the no-copy rule

```go
// Inventory tracks per-SKU stock. It is safe for concurrent use.
// Inventory must not be copied after the first use; use a *Inventory
// (typically obtained from New).
type Inventory struct {
    mu    sync.Mutex
    items map[string]Item
}
```

### Step 5: Audit callers

```
$ grep -rn 'inventory\.Inventory{' .
$ grep -rn 'var \w* inventory\.Inventory' .
```

For each match, update to use `New()` or pointer construction.

### Step 6: Add tests

```go
func TestInventory_ConcurrentAdd(t *testing.T) {
    inv := New()
    var wg sync.WaitGroup
    for i := 0; i < 1000; i++ {
        wg.Add(1)
        go func(i int) {
            defer wg.Done()
            inv.Add(Item{SKU: fmt.Sprintf("sku-%d", i), Stock: 1})
        }(i)
    }
    wg.Wait()

    for i := 0; i < 1000; i++ {
        it, ok := inv.Get(fmt.Sprintf("sku-%d", i))
        if !ok {
            t.Fatalf("missing sku-%d", i)
        }
        if it.Stock != 1 {
            t.Fatalf("wrong stock for sku-%d: %d", i, it.Stock)
        }
    }
}
```

Run under `-race`. Clean.

### Step 7: Profile under load

Set `runtime.SetMutexProfileFraction(10)`. Capture a profile after running the concurrent test. Expect to see `inventory.(*Inventory).Add` and `Restock` in the profile if contention exists.

If the profile is dominated by the mutex, consider sharding: split `items` into N maps, each protected by its own mutex, dispatched by `hash(sku) % N`. We will cover this in `professional.md`.

### Step 8: Lock-free reads

If reads vastly outnumber writes, replace `sync.Mutex` with `sync.RWMutex`. `Get` uses `RLock`; `Add` and `Restock` use `Lock`. Profile again.

If reads dominate further and the map is rarely updated, consider `atomic.Value` holding a `map[string]Item`. Writers copy-on-write the map; readers do a single atomic load. No locking on reads.

### Step 9: Document the migration

Write a short doc explaining the changes, the performance characteristics, and the rationale. Future maintainers will thank you.

---

## Appendix FF: Common review comments and how to fix them

Reviewers leave comments. Here are the most frequent on mutex-related PRs, and the corresponding fixes.

### "Value receiver on a sync-bearing type"

**Comment**: "This method has a value receiver, but `Foo` contains a `sync.Mutex`. Change to pointer."

**Fix**: `func (f *Foo) Method()`.

### "Vet warning ignored"

**Comment**: "`go vet` reports a copylocks issue. Please fix before merging."

**Fix**: Address the warning. Do not add a `//nolint` directive.

### "Constructor returns value"

**Comment**: "`NewFoo` returns `Foo`. It should return `*Foo` so callers cannot accidentally copy."

**Fix**: `func NewFoo() *Foo { return &Foo{...} }`.

### "Map value type contains Mutex"

**Comment**: "This map's value type is `Foo`, which contains a Mutex. Use `map[K]*Foo`."

**Fix**: Change the map type. Update all access sites.

### "Range loop copies struct-with-Mutex"

**Comment**: "This `for _, f := range foos` copies `Foo`. Use indexed access."

**Fix**:
```go
for i := range foos {
    f := &foos[i]
    // ...
}
```

### "Channel element type contains Mutex"

**Comment**: "`chan Foo` carries copies. Use `chan *Foo`."

**Fix**: Change channel type.

### "Closure captures Foo by value"

**Comment**: "This `go func(f Foo) {...}(f)` copies. Use closure capture: `go func() {...}()`."

**Fix**: Drop the parameter and let the closure capture by reference.

### "Defer evaluates Foo at defer time"

**Comment**: "`defer fmt.Println(f)` evaluates `f` immediately. Use pointer or closure."

**Fix**: `defer fmt.Println(&f)` or `defer func() { fmt.Println(f) }()`.

### "Interface field stores value-type Locker"

**Comment**: "`var l sync.Locker = f` where `f` is a `Foo` value. The interface wraps a heap copy."

**Fix**: `var l sync.Locker = &f`.

### "Reflection creates a value with Mutex"

**Comment**: "`reflect.New(t).Elem()` creates a value; if `t` contains a Mutex, this is a fresh, unlocked mutex independent of any other."

**Fix**: Depends on intent. Often the right fix is to not use reflection here.

### "Missing noCopy"

**Comment**: "This type should not be copied but does not embed a Mutex. Add a `noCopy` marker."

**Fix**: Add the `_ noCopy` field and a small `noCopy` type definition (or import an existing one from your project).

---

## Appendix GG: Vocabulary for the senior

Senior engineers use precise terms. The following vocabulary is helpful:

- **Copylocks** (the analyser name): the static check that flags value-copy of Locker-containing types.
- **Reference type**: a type whose value contains pointers internally (slices, maps, channels, functions, interfaces). Copying is shallow; copies share underlying state.
- **Value type**: a type whose value is its content. Copying duplicates all bytes.
- **Locker**: anything implementing `sync.Locker` — has `Lock()` and `Unlock()` methods.
- **Fast path**: the uncontended CAS-based path in `Lock`/`Unlock`. Latency ~10-20 ns.
- **Slow path**: the contended path involving spinning and semaphore park/wake. Latency 100s of ns to microseconds.
- **State word**: the `int32` field in `sync.Mutex` encoding lock state.
- **Sema word**: the `uint32` field used as a key for goroutine parking.
- **Semaroot**: a runtime data structure (treap) that holds parked goroutines, keyed by sema-word addresses.
- **Park / unpark** (or **gopark / goready**): the runtime calls that put goroutines to sleep and wake them.
- **Spinning**: busy-waiting in a tight loop before parking, used when the lock is expected to be released soon.
- **Starvation mode**: a mode in `sync.Mutex` where the lock is handed off directly to the front-of-queue waiter, ensuring fairness at the cost of throughput.
- **noCopy**: a marker type that exists to make `copylocks` flag copies of the containing type.
- **Copychecker**: a runtime self-pointer check (used in `sync.Cond` and `strings.Builder`) that panics on a method call after a copy.
- **Critical section**: the code between Lock and Unlock; should be short.
- **Convoying**: serialised execution caused by a contended mutex limiting throughput.
- **Sharding**: splitting data across multiple mutexes to reduce contention.
- **Lock granularity**: how much data each mutex protects. Fine-grained = each mutex protects little; coarse-grained = each mutex protects much.
- **Reader / writer lock**: `sync.RWMutex`. Multiple readers OK simultaneously; writers exclusive.

Using these terms precisely in code review and design discussion saves time and reduces miscommunication.

---

## Appendix HH: Mutex-related properties in detail

A senior engineer should be able to articulate the following properties of `sync.Mutex` precisely.

### Property 1: Mutual exclusion

Between `m.Lock()` returning and `m.Unlock()` being called on the *same* `m`, no other goroutine's `m.Lock()` call returns. The mutex is not re-entrant: a goroutine that calls `m.Lock()` twice without an intervening `m.Unlock()` deadlocks itself.

For a copied mutex, "same `m`" is the trap. The user wrote `m.Lock()` and "the same `m`" *.Unlock()`, but the two `m`s are at different addresses. Mutual exclusion holds on each individual address, but not across.

### Property 2: Happens-before through Unlock-Lock

The Go memory model establishes: for any successful `m.Lock()`, all memory operations sequenced before any preceding `m.Unlock()` (on the *same* `m`) are visible. This is the "happens-before" relation provided by mutexes.

A copy means the Unlock/Lock pair refers to different `m`s; no happens-before is established. Writes on one side of the copy are not guaranteed to be visible on the other.

### Property 3: Fairness (mostly)

`sync.Mutex` does not guarantee strict FIFO fairness in normal mode. A fresh contender can win against queued waiters. In starvation mode, FIFO is enforced.

A copy does not affect fairness per-mutex. Each copy has its own fairness story. But because the locks are independent, "fairness across the logical lock" is meaningless.

### Property 4: TryLock semantics

`m.TryLock()` returns true if the lock was available (and is now held) and false otherwise. Same semantics as a single CAS attempt.

On a copied mutex, `TryLock` operates on the copy's state. It may succeed even though the original is held (the copy's state is independent).

### Property 5: Panic on misuse

Two panics are possible from `sync.Mutex`:

- "sync: unlock of unlocked mutex" — calling Unlock when the lock is not held.
- "sync: Unlock of unlocked RWMutex" — equivalent for RWMutex.

Both are *fatal* — they cannot be recovered. A copy of a mutex can produce these panics in surprising places (e.g., a deferred Unlock on a copy whose Lock never ran).

### Property 6: Zero value is unlocked

`var m sync.Mutex` produces a usable mutex in the unlocked state. No constructor is needed.

A copy made before any Lock call is byte-identical to a zero value. Such a copy is "safe" in the narrow sense that operations on either side won't immediately panic. But the *intent* of having one mutex protecting one piece of data is violated — you now have two independent mutexes claiming to protect the same data.

### Property 7: Mutex hold time should be bounded

Holding a mutex while doing I/O, calling untrusted code, or performing slow computations is a contention disaster. The mutex profile shows you this.

### Property 8: Mutexes do not nest safely

If you lock mutex A, then while holding A try to lock mutex B, and another goroutine does the same in the opposite order, you deadlock. A consistent lock order is the only general solution.

A copy doesn't directly affect this property, but it does mean the "consistent lock order" can be confused: two copies of the same logical mutex have different addresses, so order-by-address falls apart.

### Property 9: Mutex is not aligned with cache lines

A `sync.Mutex` is 8 bytes. If you place two mutexes in the same struct, they may share a cache line. False sharing on the state words can degrade performance under contention.

A copy of a struct-with-two-mutexes produces two pairs of mutexes, each possibly in their own cache line. The false-sharing dynamics are unpredictable.

For performance-critical code with multiple mutexes, pad them:

```go
type T struct {
    muA sync.Mutex
    _   [56]byte // pad to 64-byte cache line
    muB sync.Mutex
    _   [56]byte
}
```

Most code does not need this. But senior engineers know the option exists.

### Property 10: Mutex is the wrong tool for some jobs

A `sync.Mutex` serializes access. If your goal is to *coordinate* (one goroutine signals another), use a channel. If your goal is to *count* (one or more goroutines increment, others read), use `atomic.Int64`. If your goal is to *broadcast* (many goroutines wait for one event), use a channel or `sync.Cond`. Mutexes are for mutually-exclusive access, not for general synchronisation.

Senior engineers ask "is this the right primitive?" before reaching for `sync.Mutex`.

---

## Appendix II: A 30-day learning plan

To go from "I know mutex copying is bad" to senior-level fluency:

**Week 1: Internals.** Read `sync/mutex.go` line by line. Sketch the state-word bit layout. Trace through Lock/Unlock in your head for: uncontended, contended, contended-with-spinning, starving.

**Week 2: Profiling.** Set up a benchmark with a deliberately contended mutex. Enable `-mutexprofile`. Read the resulting profile in `go tool pprof`. Understand each column. Compare to block profile output. Compare to `runtime/trace` output.

**Week 3: Tooling.** Read the `copylocks` analyser source. Run it on your codebase. Address every diagnostic. Add `staticcheck`. Add to CI.

**Week 4: Design.** Refactor a real type in your codebase from value-typed API to pointer-typed API. Write a benchmark before and after. Profile. Document the change.

After 30 days you should be able to:

- Explain at the byte level what `sync.Mutex` operations do.
- Read a mutex profile and identify the bottleneck.
- Identify copy bugs in code review without running tools.
- Design types that cannot be copied accidentally.
- Choose between Mutex, RWMutex, atomics, channels, and sync.Map for each situation.

---

## Appendix JJ: Self-assessment quiz

Answer without looking it up.

1. What are the two fields of `sync.Mutex` and what does each do?
2. Why does the `mutexWoken` bit exist?
3. What does `runtime_SemacquireMutex` do?
4. Why is the semaphore keyed by address rather than by value?
5. What is the difference between vet's `copylocks` pass and the race detector?
6. Why are pointer receivers preferred for types containing mutexes?
7. What is the `noCopy` idiom and when is it needed?
8. How does `sync.Once` fail when copied?
9. What is starvation mode, and when does it activate?
10. What does `runtime.SetMutexProfileFraction(N)` mean?
11. Name three patterns that are flagged by `copylocks`.
12. Name two patterns that are *not* flagged by `copylocks`.
13. How does the Go memory model relate "the same mutex" to copy bugs?
14. Why is `TryLock` discouraged?
15. What is the difference between block profile and mutex profile?
16. When should you use `sync.RWMutex` instead of `sync.Mutex`?
17. What is sharding, and how does it relate to mutex contention?
18. Why does `strings.Builder` use a self-address check instead of `noCopy`?
19. Why is `bytes.Buffer` allowed to be copied?
20. What happens when you call `m.Unlock()` on a `sync.Mutex` that was never locked?

If you can answer 18 of 20 confidently, you are at senior level. The remaining two are likely either obscure details or matters of taste.

---

## Appendix KK: Answers to the quiz

1. `state int32` (lock state, waiter count, mode bits) and `sema uint32` (semaphore key for parked goroutines).
2. To prevent the unlocker from waking a waiter when another waiter is already running. Reduces convoy effects.
3. Park the calling goroutine on a runtime semaphore keyed by the given address, until released.
4. Because mutexes are values, not handles. Each mutex value has a unique address; that address is the only stable identifier for it.
5. Vet's `copylocks` is static (compile-time-ish) and catches the structural mistake. The race detector is runtime and catches data races on the protected data.
6. Pointer receivers avoid copying the receiver. With a value receiver, every method call would copy the mutex.
7. A field type with `Lock` and `Unlock` no-op methods, used to make `copylocks` flag copies of the containing type. Needed when the type does not already contain a Locker but should not be copied.
8. The `done` flag is per-copy; the function runs once per copy, not once globally.
9. A mode where the unlocker hands the lock directly to the front-of-queue waiter, ensuring fairness. Activated when any waiter has waited >1ms.
10. Approximately 1 in N mutex blocking events is sampled into the mutex profile.
11. Assignments, function arguments, function returns, range copy, channel send, defer arg evaluation, composite literals.
12. Reflection-based copies, unsafe.Pointer casts, interface assignments where the underlying type is opaque to vet.
13. The "Unlock happens-before next Lock" relation is "for the same mutex." A copy means there are two mutexes; the relation does not bridge them.
14. Because correct uses are rare; most uses of TryLock indicate a design problem.
15. Block profile records all block events (channels, time.Sleep, mutexes); mutex profile is mutex-specific with different accounting (blame on unlocker, time spent waiting).
16. When reads vastly outnumber writes and the lock is contended on reads.
17. Splitting data across multiple mutexes (each protecting a shard). Reduces contention by allowing concurrent operations on different shards.
18. Because `strings.Builder` does not contain a Locker, so `copylocks` would not flag copies. The runtime check catches what static analysis cannot.
19. Because `bytes.Buffer` has no synchronisation primitives and is not designed for concurrent use. Copies are valid independent buffers.
20. Fatal panic: "sync: unlock of unlocked mutex." Not recoverable.

---

## Appendix LL: Beyond the basics — research-flavoured topics

For those who want to go deeper than even senior level:

### Lock-free alternatives

Many problems solved with mutexes can be solved without them using compare-and-swap loops, hazard pointers, or read-copy-update (RCU). The Go standard library's `sync/atomic` package provides the building blocks. Research papers (Michael & Scott's lock-free queue, Harris's lock-free linked list) are accessible.

### Transactional memory

Hardware transactional memory (TSX on Intel) and software transactional memory (STM) provide an alternative to fine-grained locking. Go does not have STM in the standard library, but research libraries exist.

### Verification of lock-free code

Tools like CDSChecker, Spin, and TLA+ can verify concurrent algorithms. For Go, fewer purpose-built tools exist; manual reasoning and the race detector are the norm.

### Mutex-free databases

Some embedded databases (e.g., LMDB, BoltDB, BadgerDB) use copy-on-write trees with versioning instead of in-memory locks. Studying their design teaches you alternative concurrency models.

### NUMA awareness

On NUMA systems, mutex contention has different cost depending on which node the lock lives on and which node the contender runs on. Linux's CAS performance varies across nodes. For latency-critical Go services on NUMA hardware, mutex placement matters.

### The Linux futex

`runtime_SemacquireMutex` is implemented on Linux using futex (fast user-space mutex). Reading the futex documentation (`man 2 futex`) and the runtime's `lock_futex.go` ties Go's mutex behaviour to OS primitives.

### eBPF for mutex tracing

`bpftrace` and `bcc` can trace futex calls and report mutex hold times across all processes. For production debugging of Go services, eBPF is increasingly the tool of choice.

---

End of Senior level. Proceed to `professional.md` for production patterns: contention monitoring, sharded data structures, RWMutex tradeoffs, distributed locking, and lock-free alternatives in real systems.




