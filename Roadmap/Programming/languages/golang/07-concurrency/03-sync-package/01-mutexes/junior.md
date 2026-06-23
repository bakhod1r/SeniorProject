# Mutexes — Junior Level

## Table of Contents
1. [Introduction](#introduction)
2. [Prerequisites](#prerequisites)
3. [Glossary](#glossary)
4. [Core Concepts](#core-concepts)
5. [Real-World Analogies](#real-world-analogies)
6. [Mental Models](#mental-models)
7. [Pros & Cons](#pros-cons)
8. [Use Cases](#use-cases)
9. [Code Examples](#code-examples)
10. [Coding Patterns](#coding-patterns)
11. [Clean Code](#clean-code)
12. [Product Use / Feature](#product-use-feature)
13. [Error Handling](#error-handling)
14. [Security Considerations](#security-considerations)
15. [Performance Tips](#performance-tips)
16. [Best Practices](#best-practices)
17. [Edge Cases & Pitfalls](#edge-cases-pitfalls)
18. [Common Mistakes](#common-mistakes)
19. [Common Misconceptions](#common-misconceptions)
20. [Tricky Points](#tricky-points)
21. [Test](#test)
22. [Tricky Questions](#tricky-questions)
23. [Cheat Sheet](#cheat-sheet)
24. [Self-Assessment Checklist](#self-assessment-checklist)
25. [Summary](#summary)
26. [What You Can Build](#what-you-can-build)
27. [Further Reading](#further-reading)
28. [Related Topics](#related-topics)
29. [Diagrams & Visual Aids](#diagrams-visual-aids)

---

## Introduction

> Focus: "Two goroutines just touched the same variable — what now?"

In a single-goroutine program, every line of code runs one after another. There is no "meanwhile, somewhere else." The moment you start a second goroutine that touches the same memory the first one touches, that comfortable assumption collapses. Two goroutines reading and writing the same integer can produce values that are neither what the first goroutine wrote nor what the second wrote — they can produce *garbage*, or worse, plausible-looking-but-wrong numbers that ship to production.

A **mutex** (short for *mutual exclusion*) is the simplest, oldest, and most widely understood tool for fixing this. It is a tiny lock you put around a chunk of code so that only one goroutine at a time may execute it. Everyone else has to wait their turn.

After reading this file you will:
- Understand why concurrent code without locks is broken even when the code "looks right"
- Know what a race condition is and how `go run -race` exposes them
- Be able to use `sync.Mutex` to protect a counter, a map, and a small struct
- Use `defer m.Unlock()` automatically, the way you use `defer file.Close()`
- Know when `sync.RWMutex` is preferable to `sync.Mutex`
- Recognise the three classic ways a mutex program goes wrong: forgetting to unlock, copying a mutex, and deadlocking by locking out of order

You do **not** need to understand mutex internals, atomic operations, or starvation mode yet — those come later. This file is about the moment two goroutines touch the same memory and you reach for `sync.Mutex`.

---

## Prerequisites

- **Required:** A working Go installation (1.18 or newer is ideal because we mention `TryLock`).
- **Required:** Basic comfort with `go func() { ... }()` to launch a goroutine.
- **Required:** Knowing how to print, run a program with `go run`, and read a stack trace.
- **Helpful:** Having read the goroutines chapter — you should know what a goroutine is and that it is *not* an OS thread.
- **Helpful:** A vague intuition that "shared memory + concurrency = scary." That intuition is correct and we will sharpen it.

If `go run main.go` works and you can launch a goroutine, you are ready.

---

## Glossary

| Term | Definition |
|------|-----------|
| **Mutex** | Mutual-exclusion lock. A tiny piece of state that guarantees only one goroutine at a time can be inside a region of code. Provided by `sync.Mutex`. |
| **Critical section** | The code between `Lock()` and `Unlock()`. Only one goroutine may execute it at a time. Keep it as short as possible. |
| **Lock** | Acquire the mutex. Blocks until the mutex is free, then marks it busy. |
| **Unlock** | Release the mutex so another waiting goroutine can acquire it. Must be called by the same goroutine that locked it. |
| **Race condition** | A bug where the *outcome* depends on which goroutine wins a race. Almost always caused by unsynchronised access to shared memory. |
| **Data race** | The strictest, mechanical definition: two goroutines access the same memory location, at least one of them writes, and the accesses are not ordered by a synchronisation primitive. Detectable by `go run -race`. |
| **`sync.Mutex`** | The basic mutex type in Go's `sync` package. Zero value is an unlocked mutex — no constructor needed. |
| **`sync.RWMutex`** | A reader-writer mutex. Many readers may hold it simultaneously, but a writer needs exclusive access. |
| **`defer`** | A Go keyword that schedules a call to run when the surrounding function returns. The idiomatic way to guarantee `Unlock()` happens. |
| **Deadlock** | A state where goroutine A is waiting on goroutine B which is waiting on goroutine A. Nothing makes progress. |
| **Critical section** | The protected region of code between Lock and Unlock. |
| **Goroutine** | A lightweight, Go-scheduled concurrent function. Many goroutines run on a small pool of OS threads. |

---

## Core Concepts

### Two goroutines, one variable, no lock = bug

The smallest demonstration of why mutexes exist:

```go
package main

import (
    "fmt"
    "sync"
)

func main() {
    var counter int
    var wg sync.WaitGroup
    for i := 0; i < 1000; i++ {
        wg.Add(1)
        go func() {
            defer wg.Done()
            counter++ // unsynchronised
        }()
    }
    wg.Wait()
    fmt.Println(counter) // not 1000 — usually 800-something
}
```

`counter++` *looks* atomic but it is not. The CPU does three things: read the old value, add one, write the new value. Two goroutines can read the same old value, both add one, both write — the second write erases the first goroutine's increment. The visible result is that some increments are silently lost.

### A mutex serialises access to shared memory

```go
var (
    counter int
    mu      sync.Mutex
)

func increment() {
    mu.Lock()
    counter++
    mu.Unlock()
}
```

Now the read-modify-write of `counter++` is wrapped in a critical section. While one goroutine is between `Lock()` and `Unlock()`, every other goroutine that calls `Lock()` blocks. When the first one unlocks, exactly one waiter is woken and proceeds.

### The zero value of `sync.Mutex` is ready to use

You do not call `NewMutex`. `var mu sync.Mutex` produces a usable, unlocked mutex. This matters because it means embedding a mutex in a struct works for free:

```go
type Counter struct {
    mu sync.Mutex
    n  int
}
```

You instantiate `Counter{}` and the embedded mutex is already valid.

### `defer m.Unlock()` is the seatbelt

The single most important habit of every Go programmer who uses mutexes is:

```go
mu.Lock()
defer mu.Unlock()
// ... code that could panic, return early, do anything ...
```

If your function has more than one `return`, or any code that could panic, manual `Unlock()` is a bug waiting to happen. `defer` ensures the unlock runs no matter how the function exits. It costs roughly a few nanoseconds — irrelevant in 99% of code.

### `sync.RWMutex` for read-heavy workloads

If your shared data is read often and written rarely, `sync.RWMutex` lets many goroutines read concurrently and only blocks them when a writer arrives:

```go
type Cache struct {
    mu sync.RWMutex
    m  map[string]string
}

func (c *Cache) Get(k string) string {
    c.mu.RLock()
    defer c.mu.RUnlock()
    return c.m[k]
}

func (c *Cache) Set(k, v string) {
    c.mu.Lock()
    defer c.mu.Unlock()
    c.m[k] = v
}
```

`RLock`/`RUnlock` is for readers. `Lock`/`Unlock` is for writers. They are paired — never mix them up.

### Mutexes do not protect data; they protect *access patterns*

A mutex is just a flag. It protects nothing if you read or write the variable outside its lock. Discipline is yours, not the compiler's. Every method that touches the protected field must take the same lock.

### Use the race detector early and often

```bash
go run -race main.go
go test -race ./...
```

The `-race` flag instruments every memory access. If two goroutines touch the same memory without synchronisation, you get a clear stack trace:

```
WARNING: DATA RACE
Read at 0x00c0000a00a0 by goroutine 7:
  main.main.func1()
      /tmp/main.go:14 +0x44
Previous write at 0x00c0000a00a0 by goroutine 8:
  main.main.func1()
      /tmp/main.go:14 +0x55
```

Run with `-race` in CI. The cost is roughly 2× memory and 5–10× slowdown, which is fine for tests.

---

## Real-World Analogies

**1. The single bathroom in a small office.** Anyone can enter, but only one at a time. The lock on the door is the mutex. Forgetting to unlock when you leave (because you left through the window — i.e., panicked) is the missing-Unlock bug. People queueing outside are the blocked goroutines.

**2. The talking stick.** In a meeting where only the person holding the stick may speak, the stick is a mutex. Two people talking at once is a race condition. Passing the stick to yourself before you have finished speaking is a deadlock.

**3. A library book in a small library.** RWMutex is the photocopier model: many people may *read* a book (RLock) at once, but if someone wants to *edit* the book (Lock), everyone has to leave first. A reader who never returns the book starves the editors.

**4. A whiteboard in a classroom.** The whiteboard is shared memory. The marker is the mutex. Whoever holds the marker may write or erase. Two students grabbing the marker simultaneously and both writing produces gibberish — a race. The rule "always put the marker back after writing" is `defer mu.Unlock()`.

---

## Mental Models

### Model 1 — Lock is a turnstile, not a wall

A mutex does not stop other goroutines from running. They run freely, but the moment they reach `Lock()` on the same mutex, they wait. Other goroutines doing other work continue without delay.

### Model 2 — The critical section is rented, not owned

You hold the lock briefly. The goal is always to give it back as fast as possible. Every line inside `Lock`/`Unlock` is a line that other goroutines are paying for in latency.

### Model 3 — The mutex lives with the data it protects

Don't make a mutex a global named `theBigLock`. Make it a field of the struct whose data it protects. The lock and the data should travel together — same struct, same lifetime.

### Model 4 — `Unlock` may be called from `defer`, never from another goroutine

A lock acquired by goroutine A must be released by goroutine A. Releasing it from a different goroutine is undefined behaviour and breaks the abstraction. `defer` guarantees same-goroutine release.

### Model 5 — RWMutex is two locks pretending to be one

Internally, `RWMutex` tracks readers and writers separately. Conceptually you can imagine it as: "the writer waits until all readers leave, and once a writer has the lock, all readers wait." That mental model is good enough for now.

---

## Pros & Cons

### Pros
- **Simplest possible synchronisation primitive.** Two methods: `Lock`, `Unlock`. You can teach it in one minute.
- **Zero-allocation, zero-construction.** `var mu sync.Mutex` is ready. Embedding in a struct is free.
- **Correct by default for read-modify-write patterns.** No need to design lock-free algorithms.
- **Race-detector friendly.** `go run -race` will tell you when you forgot one.
- **Composable.** Multiple mutexes guarding multiple structs are fine, as long as you respect lock ordering.

### Cons
- **Easy to misuse.** Forgetting `Unlock`, copying a struct that contains a mutex, locking out of order — all silent bugs.
- **No reentrancy.** Locking the same mutex twice in the same goroutine deadlocks immediately. Go did this on purpose; we will explain.
- **Coarse granularity costs throughput.** A single big lock around a whole struct serialises every operation.
- **No timeout.** `Lock()` blocks until the mutex is free or forever. (Go 1.18 added `TryLock`, but it is rarely the right tool.)
- **No fairness guarantee in general.** Goroutines may not be served in FIFO order under contention (we will discuss starvation mode in the professional file).

---

## Use Cases

| Use case | Mutex variant | Why |
|----------|---------------|-----|
| Counter incremented from many goroutines | `sync.Mutex` (or `atomic.Int64` for hot paths) | Simplest read-modify-write |
| In-memory cache that is read 100× per write | `sync.RWMutex` | Many concurrent readers, rare writers |
| Lazy initialisation of a singleton | `sync.Once` (preferred) or mutex+flag | One-shot exclusive section |
| Map shared across goroutines | `sync.Mutex`+`map`, or `sync.Map` | Built-in maps are not safe for concurrent use |
| Building a linked list without dropping nodes | `sync.Mutex` | Multi-step pointer surgery |
| Connection pool's free-list | `sync.Mutex` | Short critical section, occasional contention |
| Configuration that changes rarely | `sync.RWMutex` or `atomic.Value` | Read-heavy, write-rare |

---

## Code Examples

### Example 1 — A safe counter

```go
package main

import (
    "fmt"
    "sync"
)

type Counter struct {
    mu sync.Mutex
    n  int
}

func (c *Counter) Inc() {
    c.mu.Lock()
    defer c.mu.Unlock()
    c.n++
}

func (c *Counter) Value() int {
    c.mu.Lock()
    defer c.mu.Unlock()
    return c.n
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
    fmt.Println(c.Value()) // exactly 1000
}
```

The methods take a pointer receiver because the embedded mutex must not be copied.

### Example 2 — A safe map (the most common pattern)

```go
type SafeMap struct {
    mu sync.RWMutex
    m  map[string]int
}

func NewSafeMap() *SafeMap {
    return &SafeMap{m: make(map[string]int)}
}

func (s *SafeMap) Get(k string) (int, bool) {
    s.mu.RLock()
    defer s.mu.RUnlock()
    v, ok := s.m[k]
    return v, ok
}

func (s *SafeMap) Set(k string, v int) {
    s.mu.Lock()
    defer s.mu.Unlock()
    s.m[k] = v
}

func (s *SafeMap) Delete(k string) {
    s.mu.Lock()
    defer s.mu.Unlock()
    delete(s.m, k)
}
```

### Example 3 — Reading a shared config under RWMutex

```go
type Config struct {
    mu      sync.RWMutex
    timeout time.Duration
    retries int
}

func (c *Config) Snapshot() (time.Duration, int) {
    c.mu.RLock()
    defer c.mu.RUnlock()
    return c.timeout, c.retries
}

func (c *Config) Update(timeout time.Duration, retries int) {
    c.mu.Lock()
    defer c.mu.Unlock()
    c.timeout = timeout
    c.retries = retries
}
```

### Example 4 — Detecting the bug with `-race`

```go
// Without a mutex
package main

import "sync"

var counter int

func main() {
    var wg sync.WaitGroup
    for i := 0; i < 100; i++ {
        wg.Add(1)
        go func() {
            defer wg.Done()
            counter++
        }()
    }
    wg.Wait()
}
```

```bash
$ go run -race main.go
==================
WARNING: DATA RACE
...
==================
Found 1 data race(s)
exit status 66
```

### Example 5 — Functional option to avoid copying

```go
type Logger struct {
    mu sync.Mutex
    n  int
}

// BAD — passes Logger by value, copies the mutex
func reportBad(l Logger) { ... }

// GOOD — passes a pointer
func reportGood(l *Logger) { ... }
```

If you have a struct containing a `sync.Mutex`, every function that touches it should take a pointer receiver or a pointer parameter.

### Example 6 — `defer` rescues you from panic

```go
func (b *Bank) Transfer(from, to int, amount int) (err error) {
    b.mu.Lock()
    defer b.mu.Unlock()
    if b.accounts[from] < amount {
        return errors.New("insufficient funds") // unlock still runs
    }
    if amount < 0 {
        panic("negative transfer") // unlock still runs
    }
    b.accounts[from] -= amount
    b.accounts[to] += amount
    return nil
}
```

---

## Coding Patterns

### Pattern 1 — Mutex + data live in the same struct

```go
type Stats struct {
    mu       sync.Mutex
    requests int
    errors   int
}
```

Both fields are protected by `mu`. Every method that touches them takes `mu` first.

### Pattern 2 — Methods, not free functions

Free functions that take a mutex by reference and a data structure separately are easy to misuse. Prefer methods on a struct that owns both.

### Pattern 3 — Lock once at the entry, do everything, unlock at exit

```go
func (s *Service) Process(req Request) Response {
    s.mu.Lock()
    defer s.mu.Unlock()
    // ... all logic here ...
}
```

Avoid releasing and re-acquiring the lock unless you have a reason. Re-acquisition is a window for race conditions.

### Pattern 4 — Read-then-write needs the write lock from the start

```go
// WRONG — TOCTOU race
s.mu.RLock()
if _, ok := s.m[k]; !ok {
    s.mu.RUnlock()
    s.mu.Lock()
    s.m[k] = v // someone else may have inserted between unlock and lock
    s.mu.Unlock()
} else {
    s.mu.RUnlock()
}

// CORRECT — write lock from the start
s.mu.Lock()
defer s.mu.Unlock()
if _, ok := s.m[k]; !ok {
    s.m[k] = v
}
```

### Pattern 5 — One method, one lock acquisition

If method A calls method B and both lock the same mutex, you have a deadlock (Go mutexes are not reentrant). The fix is to factor out an unexported "already locked" version:

```go
func (s *Store) Add(k, v string) {
    s.mu.Lock()
    defer s.mu.Unlock()
    s.addLocked(k, v)
}

func (s *Store) addLocked(k, v string) {
    s.m[k] = v
}
```

Convention: any method named `xxxLocked` assumes the caller already holds the lock.

### Pattern 6 — Don't hold the lock during I/O

```go
// WRONG — HTTP call inside the critical section
s.mu.Lock()
defer s.mu.Unlock()
resp, err := http.Get(...)

// RIGHT — copy what you need, release, do I/O
s.mu.Lock()
url := s.url
s.mu.Unlock()
resp, err := http.Get(url)
```

Holding a lock across I/O is the classic way to turn a 10ms operation into a 10s service hang.

---

## Clean Code

- Name mutexes `mu`. If you have several, name them after what they protect: `cacheMu`, `sessionsMu`.
- Always put `mu` before the field(s) it protects, with a comment if non-obvious:
  ```go
  type S struct {
      mu sync.Mutex // guards n and last
      n  int
      last time.Time
  }
  ```
- Lock acquisition and release should fit in a single screen. If your critical section is 60 lines long, it is too big.
- Methods that take `*S` and methods that take `S` should not coexist when `S` contains a mutex. Use `*S` everywhere.
- Prefer methods to expose synchronised behaviour; never expose the mutex itself.

---

## Product Use / Feature

In a real e-commerce service, mutexes appear in places like:

- **Shopping cart updates:** Multiple browser tabs may update the same cart simultaneously. The cart object holds a mutex; `AddItem`, `RemoveItem`, `SetQuantity` all take it.
- **Inventory reservations:** Reserving the last item in stock requires `mu.Lock()` around the read-decrement-write sequence to prevent oversells.
- **In-memory metric counters:** Request count, error count, latency histogram — protected by either a mutex or `atomic` counters.
- **Connection pools:** A pool of database connections handed out and returned uses a mutex to manage the free list.
- **Per-user state caches:** A map from user ID to user state, with `RWMutex` because reads dominate.

---

## Error Handling

Mutexes do not return errors. `Lock()` and `Unlock()` are `func`s that panic if misused (unlocking an unlocked mutex panics with `sync: unlock of unlocked mutex`). The error-handling discipline you need is:

- Always pair `Lock` with `defer Unlock` — eliminates "forgot to unlock on error path."
- Never recover from `sync: unlock of unlocked mutex`. It indicates a logic bug; let the program crash and fix the code.
- If a critical section must fail (e.g., precondition violated), `return err` after `defer mu.Unlock()` was set up. The unlock runs.

---

## Security Considerations

- **Avoid timing attacks based on lock contention.** If acquiring a mutex takes measurably longer when "the secret matches," an attacker may infer the secret. Mostly relevant in cryptographic code; ordinary apps need not worry.
- **Do not lock around user-controlled-size work.** A user submitting a huge payload that takes the lock for seconds becomes a denial-of-service vector. Bound the work or release the lock before the slow part.
- **Do not log secrets that you copy out under the lock.** Releasing the lock then logging is fine, but make sure your log line does not echo the secret to disk.

---

## Performance Tips

- **Keep critical sections short.** Move computation outside the lock when possible. Compute, then take the lock to update.
- **Prefer `RWMutex` only when you measure ≥ 5–10× more reads than writes.** For balanced workloads, `Mutex` is faster because `RWMutex` has higher per-operation overhead.
- **Use `atomic` for single-word counters.** `atomic.Int64.Add(&n, 1)` is much faster than `mu.Lock(); n++; mu.Unlock()`.
- **Avoid global mutexes.** They become bottlenecks. Per-shard or per-object locks scale better.
- **Profile with `go test -bench -mutexprofile`.** It tells you which mutex is hottest.

---

## Best Practices

- **One concept, one mutex.** Don't share `mu` between two unrelated structs.
- **Mutex first, data after, in struct layout.** Reinforces "this lock protects what follows."
- **Pointer receivers always.** A `func (s S) Foo()` that locks `s.mu` is locking a copy of the mutex — guaranteed bug.
- **Document your locking discipline.** A one-line comment per protected field saves an hour of debugging.
- **Run `-race` in CI.** Every test, every build. The cost is far lower than the cost of a production race.
- **Use `go vet` to catch copying mutexes.** It warns when a `sync.Mutex` is copied by value.

---

## Edge Cases & Pitfalls

- **Copying a struct that contains a mutex.** The copy has its own mutex; locking it does not affect the original. Bugs are silent and devastating. `go vet` catches most cases.
- **Locking out of order.** If goroutine A locks `m1` then `m2`, and goroutine B locks `m2` then `m1`, you have a deadlock the moment they overlap. Always lock in a fixed global order.
- **Reentrant locking.** `mu.Lock(); mu.Lock()` in the same goroutine deadlocks immediately. Go does not provide reentrant mutexes.
- **`Unlock` on an unlocked mutex.** Panics. Almost always means an extra unlock or a missing lock.
- **Holding the lock across a channel send/receive.** Easy way to build a deadlock if the other side also wants the same lock.
- **Reading while writing under `RWMutex`.** RLock does not let you write. If you need to mutate, you must hold the writer Lock.
- **Capturing the wrong variable in a closure.** Famous loop-variable bug: a goroutine inside a `for i := range items` loop sees the *current* `i`, not the snapshot — but pre-Go 1.22 even capturing it under a mutex won't help.

---

## Common Mistakes

- Calling `Unlock()` from a different goroutine than the one that called `Lock()`.
- Using a `sync.Mutex` value instead of a `*sync.Mutex` field — then copying the struct.
- Not using `defer Unlock()` and forgetting to unlock on the error path.
- Using `RWMutex` where `Mutex` would have been faster (low read:write ratio).
- Holding the lock across I/O, network calls, or `time.Sleep`.
- Initialising a `sync.Mutex` with a constructor that returns a value, then assigning it: `m = sync.Mutex{}` after it has been used. (Resetting a used mutex is undefined.)
- Calling `Lock()` recursively from a method that calls another locking method on the same object.

---

## Common Misconceptions

- **"Reading is safe without a lock."** False. Reading a multi-word value while it is being written can yield a half-old, half-new value. Even reading an `int` is a data race if anyone might be writing.
- **"`map` is goroutine-safe in Go."** False. Go's built-in `map` is not safe for concurrent reads and writes. Use `sync.Mutex` or `sync.Map`.
- **"`sync.Map` is always faster than `Mutex+map`."** False. `sync.Map` is optimised for two specific patterns (write-once-read-many keys, disjoint key sets per goroutine). For balanced workloads, `Mutex+map` often wins.
- **"`RWMutex` is always faster for readers."** False. The bookkeeping cost is higher per operation. Only worth it under heavy reader concurrency.
- **"`sync.Mutex` is fair (FIFO)."** Not exactly. Go's mutex has a fairness mode, but normal mode allows the currently running goroutine to barge ahead. We will explain in the professional file.
- **"`atomic` operations make a mutex unnecessary."** Only for single-word counters or pointer swaps. Multi-step operations still need a mutex.

---

## Tricky Points

- A `sync.Mutex`'s zero value is unlocked. You should never reset it to its zero value while it is in use.
- `Mutex` and `RWMutex` types must not be copied after first use. Pass by pointer.
- `RWMutex.Lock()` does not "upgrade" from `RLock`. You must release the read lock first, then acquire the write lock.
- `sync.RWMutex`'s writer can starve readers (and vice versa) under heavy load. Go's runtime has heuristics, but it is not guaranteed FIFO.
- Locking around a `time.Sleep` or any blocking call holds up every other goroutine waiting on the lock.

---

## Test

```go
func TestCounter_Concurrent(t *testing.T) {
    var c Counter
    var wg sync.WaitGroup
    const N = 10000
    for i := 0; i < N; i++ {
        wg.Add(1)
        go func() {
            defer wg.Done()
            c.Inc()
        }()
    }
    wg.Wait()
    if got := c.Value(); got != N {
        t.Fatalf("got %d, want %d", got, N)
    }
}
```

Run with `go test -race -run TestCounter_Concurrent`. Without the mutex inside `Counter`, this test fails. With it, it passes — even under `-race`.

---

## Tricky Questions

**Q: Why does `counter++` need a mutex even though it is one line of Go?**

A: Because it compiles to multiple instructions: load, add, store. Two goroutines can interleave at the instruction level even if they look atomic at the source level.

**Q: Is `sync.Mutex` reentrant?**

A: No. Locking it twice in the same goroutine deadlocks. This is intentional (Russ Cox: "reentrant locking is a recipe for confusion"). Restructure the code so the inner method does not re-lock.

**Q: Can two goroutines call `Lock()` at exactly the same instant?**

A: They can attempt it, but only one wins. The other blocks inside `Lock()` until the winner calls `Unlock()`. The runtime and OS guarantee the atomic decision.

**Q: What happens if I `Unlock()` an already-unlocked mutex?**

A: Panic: `sync: unlock of unlocked mutex`. The program crashes.

**Q: Can I pass a `sync.Mutex` to a function?**

A: Only by pointer. Passing by value copies the mutex, leaving the caller and callee with two independent locks — a silent bug. `go vet` catches it.

**Q: When should I use `sync.RWMutex` vs `sync.Mutex`?**

A: Use `RWMutex` only when reads vastly outnumber writes (≥ 5–10×) and reads do real work. For balanced or write-heavy workloads, plain `Mutex` is faster.

---

## Cheat Sheet

```go
// Declare
var mu sync.Mutex                     // unlocked, ready to use

// Lock pattern
mu.Lock()
defer mu.Unlock()
// ... critical section ...

// RWMutex
var rw sync.RWMutex
rw.RLock(); ...; rw.RUnlock()         // readers
rw.Lock(); ...; rw.Unlock()           // writers

// In a struct
type T struct {
    mu sync.Mutex // guards n
    n  int
}
func (t *T) Inc() { t.mu.Lock(); defer t.mu.Unlock(); t.n++ }

// TryLock (Go 1.18+)
if mu.TryLock() {
    defer mu.Unlock()
    // ... got the lock ...
}

// Race detector
go run -race main.go
go test -race ./...
```

---

## Self-Assessment Checklist

- [ ] I can explain why `counter++` is not atomic.
- [ ] I can write a goroutine-safe counter using `sync.Mutex`.
- [ ] I always use `defer mu.Unlock()` directly after `mu.Lock()`.
- [ ] I know that `sync.Mutex` and `sync.RWMutex` must not be copied.
- [ ] I know `RWMutex.RLock` is for readers, `Lock` is for writers, and they must not be confused.
- [ ] I run `go test -race` regularly.
- [ ] I never hold a mutex across I/O.
- [ ] I understand that Go mutexes are not reentrant.

---

## Summary

A mutex is the simplest, oldest tool for making concurrent code correct. In Go it is `sync.Mutex` (basic) or `sync.RWMutex` (reader-writer). The zero value works. Every program that mutates shared memory from multiple goroutines needs one, *or* a fundamentally different design (channels, atomics). The two habits that prevent 90% of mutex bugs are `defer mu.Unlock()` and "never copy a struct containing a mutex." The rest is detail you will learn as you encounter contention, deadlocks, and starvation in real workloads.

---

## What You Can Build

- A goroutine-safe counter.
- A goroutine-safe map (or upgrade to `sync.Map` later).
- A small in-memory cache with reader-writer concurrency.
- A simple connection pool.
- A request rate counter for an HTTP server.

---

## Further Reading

- Go documentation: <https://pkg.go.dev/sync#Mutex>
- The Go Memory Model: <https://go.dev/ref/mem>
- Russ Cox on why Go mutexes are not reentrant: search "Russ Cox reentrant"
- Dmitry Vyukov on Go mutex internals (tour of `runtime/sema.go`)
- "Visualizing Concurrency in Go" — Ivan Daniluk

---

## Related Topics

- [Goroutines](../../01-goroutines/01-overview/junior.md)
- [Channels](../../02-channels/01-buffered-vs-unbuffered/junior.md)
- [WaitGroups](../02-waitgroups/junior.md)
- [`sync.Once`](../01-mutexes/junior.md) (later sub-page)
- `sync/atomic` (when you need single-word atomicity)

---

## Diagrams & Visual Aids

```
     Goroutines waiting for the same mutex
     ┌─────┐  ┌─────┐  ┌─────┐
     │  A  │  │  B  │  │  C  │
     └──┬──┘  └──┬──┘  └──┬──┘
        │        │        │
        ▼        ▼        ▼
     ┌─────────────────────────┐
     │        Lock(mu)          │
     │   only one at a time     │
     └─────────────────────────┘
        │
        ▼
     critical section
        │
        ▼
     Unlock(mu) ── wakes one waiter
```

```
     RWMutex behaviour
     readers can share:           writer is exclusive:
     R R R R                      ──── W ────
       (concurrent)               (alone, all waiting)
```
