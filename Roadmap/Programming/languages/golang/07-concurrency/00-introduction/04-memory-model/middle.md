# Memory Model — Middle Level

## Table of Contents
1. [Introduction](#introduction)
2. [The 2022 Go Memory Model](#the-2022-go-memory-model)
3. [Channel Synchronisation in Detail](#channel-synchronisation-in-detail)
4. [Atomics: Operations and Ordering](#atomics-operations-and-ordering)
5. [`sync.Once`, `sync.WaitGroup`, `sync.Cond`](#synconce-syncwaitgroup-synccond)
6. [Common Race Patterns and Fixes](#common-race-patterns-and-fixes)
7. [`atomic.Value` and Pointer Publication](#atomicvalue-and-pointer-publication)
8. [Beyond the Race Detector](#beyond-the-race-detector)
9. [Atomic vs Mutex Trade-offs](#atomic-vs-mutex-trade-offs)
10. [Testing Concurrent Code](#testing-concurrent-code)
11. [Self-Assessment](#self-assessment)
12. [Summary](#summary)

---

## Introduction

At junior level you learned the basics: data races are bad, synchronisation establishes happens-before, the race detector catches violations. At middle level we treat the memory model as a *design tool* and look at the practical operations: which synchronisation primitives exist, what each guarantees, when to choose one over another, and how to test for correctness.

The big shift since 2022: the Go memory model was rewritten to formalise atomics as sequentially consistent. This makes `sync/atomic` significantly easier to reason about than the C/C++ memory orders (relaxed, acquire, release, acq_rel, seq_cst). In Go, every atomic operation is seq_cst — the strongest, simplest ordering — and the runtime/compiler handles the hardware-specific implementation.

After this you will:

- Read the Go memory model document with comprehension.
- Use atomics, `sync.Once`, `sync.WaitGroup`, `sync.Cond` correctly.
- Recognise common race patterns at a glance.
- Choose between atomic, mutex, and channel for a given problem.
- Write tests that stress concurrent code under race conditions.

---

## The 2022 Go Memory Model

In June 2022 the Go memory model document was rewritten. Key clarifications:

### Definition of a data race

> A data race is defined as a write to a memory location happening concurrently with another read or write to that same location, unless all the accesses involved are atomic data accesses as provided by the `sync/atomic` package.

### Programs with races

> A program that does not contain a data race is *race-free*. Race-free programs behave as if memory operations performed on different goroutines were merged into some sequentially consistent interleaving.
>
> Programs with data races have undefined behaviour.

This is strong. A racy program is not just non-deterministic; it is *undefined*. The compiler can do anything.

### Synchronisation operations

The model lists the operations that establish synchronisation between goroutines:

- The `init` function happens-before any `main` function.
- The `go` statement that starts a goroutine happens-before the goroutine's first instruction.
- A goroutine's exit is *not* synchronised with anything (unlike thread joins in some languages).
- A send on a channel happens-before the corresponding receive completes.
- The closing of a channel happens-before a receive that returns because the channel is closed.
- For a buffered channel of capacity C, the kth receive happens-before the (k+C)th send completes.
- An unlock of a mutex happens-before the next lock of that mutex.
- The first call to `sync.Once.Do(f)` returns only after f completes; subsequent calls do not call f.
- A `sync.WaitGroup.Wait` returns only after the corresponding `Done` calls.
- Each atomic operation on a memory address synchronises with each other atomic op on the same address.

### Sequentially consistent atomics

> A read-modify-write operation, such as `atomic.AddInt32` or `atomic.CompareAndSwapInt64`, is atomic, and it happens before any subsequent read or write of the same memory location by any goroutine.

In other words, all atomic operations are seq_cst. There is no "relaxed" atomic in Go. This is a deliberate choice: simpler, safer, slightly slower than C++'s relaxed operations.

### Implications

- You cannot get "memory_order_relaxed" performance in pure Go atomic. If you need it, drop to `unsafe` or write assembly.
- You do not need to think about acquire/release/seq_cst. Every atomic is seq_cst.
- The model is easier to teach and easier to use correctly than C/C++.

---

## Channel Synchronisation in Detail

The exact rules for channels:

### Unbuffered channel

```go
ch := make(chan int) // capacity 0
```

- A send completes when a matching receive happens (rendezvous).
- The send happens-before the receive completes.
- Equivalently: anything before the send is visible after the receive.

```go
x := 0
go func() {
    x = 1
    ch <- 0
}()
<-ch
fmt.Println(x) // guaranteed: prints 1
```

### Buffered channel

```go
ch := make(chan int, 16) // capacity 16
```

- A send into a non-full buffer completes immediately.
- A receive from a non-empty buffer completes immediately.
- The kth send happens-before the kth receive (FIFO order).
- The kth receive happens-before the (k + capacity)th send completes — this is the back-pressure rule.

The capacity rule is subtle. It means once the buffer is full, the (capacity + 1)th sender is forced to wait for the first receiver. The synchronisation point is *the buffer becoming non-full*.

### Channel close

```go
close(ch)
```

- `close(ch)` happens-before a receive that returns because the channel is closed.
- A receive on a closed channel returns the zero value immediately.
- Multiple receivers on a closed channel all observe the close.

```go
done := make(chan struct{})
var x int

go func() {
    x = 42
    close(done)
}()

<-done
fmt.Println(x) // guaranteed: 42
```

### `select` with channels

A `select` does not add any new synchronisation. Each case is governed by the rules of the channel involved. The runtime uniformly picks among ready cases.

### `select` with `default`

A non-blocking send / receive. If the channel is not ready, `default` runs immediately. No synchronisation happens via the `default` branch.

---

## Atomics: Operations and Ordering

The `sync/atomic` package provides:

### Loads

```go
v := atomic.LoadInt64(&x)
v := atomic.LoadUint32(&x)
v := atomic.LoadPointer(&p)
```

Or, since Go 1.19, type-safe wrappers:

```go
var x atomic.Int64
v := x.Load()
```

### Stores

```go
atomic.StoreInt64(&x, 42)
```

Or:

```go
var x atomic.Int64
x.Store(42)
```

### Read-modify-write

```go
atomic.AddInt64(&x, 1)
atomic.AddInt64(&x, -1) // subtract
atomic.SwapInt64(&x, newValue) // swap and return old
atomic.CompareAndSwapInt64(&x, old, new) // CAS
```

### `atomic.Bool`, `atomic.Int32`, `atomic.Int64`, etc.

The Go 1.19+ structs:

```go
var enabled atomic.Bool
enabled.Store(true)
if enabled.Load() { ... }
```

Less error-prone than the function form (which takes a pointer and is easy to misuse).

### Operations on pointers

```go
var p atomic.Pointer[Config]
p.Store(&Config{...})
cfg := p.Load() // *Config
```

Type-safe with generics.

### Synchronisation rules

All atomic operations on the same memory location are totally ordered. Operations on different memory locations may be reordered relative to each other unless tied by another synchronisation.

In practice: think of every atomic op as fully synchronised. No subtle distinctions.

### Cost

A single atomic operation on x86 is ~5 ns. ARM is similar with `dmb` fences. Compare to:

- Plain (non-atomic) read/write: ~1 ns.
- Mutex lock + unlock uncontended: ~20 ns.
- Channel send/receive (one round): ~200 ns.
- syscall: ~1 µs.

---

## `sync.Once`, `sync.WaitGroup`, `sync.Cond`

### `sync.Once`

Runs a function exactly once, no matter how many goroutines call it.

```go
var once sync.Once
once.Do(func() {
    // runs once
})
```

Common use: lazy initialisation.

```go
var (
    once sync.Once
    inst *Resource
)

func Get() *Resource {
    once.Do(func() {
        inst = newResource()
    })
    return inst
}
```

Synchronisation: the function call completes before any subsequent `Do` returns. The instance is fully initialised before any caller sees it.

### `sync.WaitGroup`

Counter for waiting on N goroutines.

```go
var wg sync.WaitGroup
for i := 0; i < N; i++ {
    wg.Add(1)
    go func() {
        defer wg.Done()
        work()
    }()
}
wg.Wait()
```

Synchronisation: `Wait()` returns after the corresponding `Done()` calls. Anything written before each `Done()` is visible after `Wait()`.

Critical rule: `Add` must be called before the goroutine starts (typically in the parent). `Add` inside the goroutine is racy with `Wait`.

### `sync.Cond`

A condition variable. Multiple goroutines wait until a condition becomes true.

```go
var mu sync.Mutex
var cond = sync.NewCond(&mu)
var ready bool

go func() {
    mu.Lock()
    ready = true
    cond.Broadcast() // wake all waiters
    mu.Unlock()
}()

mu.Lock()
for !ready {
    cond.Wait() // releases mu, waits for signal, re-acquires mu
}
mu.Unlock()
```

`sync.Cond` is rarely needed in modern Go. Channels usually do the job more idiomatically.

### `sync.Mutex` / `sync.RWMutex`

Already covered. `RWMutex` allows many readers or one writer; useful for read-heavy state.

### `sync.Pool`

A per-goroutine cache of reusable objects. Not a synchronisation primitive per se, but cooperates with the runtime to share state across goroutines safely.

```go
var pool = sync.Pool{
    New: func() interface{} { return new(Buffer) },
}

buf := pool.Get().(*Buffer)
defer pool.Put(buf)
```

---

## Common Race Patterns and Fixes

### Pattern: Unsynchronised counter

**Race:**
```go
var counter int
go func() { counter++ }()
fmt.Println(counter)
```

**Fix:** Atomic.
```go
var counter atomic.Int64
go func() { counter.Add(1) }()
fmt.Println(counter.Load())
```

### Pattern: Pointer publication

**Race:**
```go
var p *Config
go func() { p = newConfig() }()
use(p)
```

**Fix:** `atomic.Pointer`.
```go
var p atomic.Pointer[Config]
go func() { p.Store(newConfig()) }()
use(p.Load())
```

### Pattern: Lazy init

**Race:**
```go
var inst *Resource
go func() {
    if inst == nil {
        inst = newResource()
    }
}()
```

**Fix:** `sync.Once`.
```go
var (
    once sync.Once
    inst *Resource
)
once.Do(func() { inst = newResource() })
```

### Pattern: Shared map

**Race:**
```go
m := map[string]int{}
go func() { m["a"] = 1 }()
go func() { _ = m["a"] }()
```

**Fix A:** Mutex.
```go
var mu sync.Mutex
mu.Lock()
m["a"] = 1
mu.Unlock()
```

**Fix B:** `sync.Map`.
```go
var m sync.Map
m.Store("a", 1)
```

### Pattern: Shutdown flag

**Race:**
```go
var done bool
go func() {
    for !done { work() }
}()
done = true
```

**Fix A:** `atomic.Bool`.
```go
var done atomic.Bool
go func() {
    for !done.Load() { work() }
}()
done.Store(true)
```

**Fix B:** Channel.
```go
done := make(chan struct{})
go func() {
    for {
        select {
        case <-done: return
        default: work()
        }
    }
}()
close(done)
```

**Fix C:** `context.Context`.
```go
ctx, cancel := context.WithCancel(context.Background())
go func() {
    for {
        select {
        case <-ctx.Done(): return
        default: work()
        }
    }
}()
cancel()
```

### Pattern: Reading state during init

**Race:**
```go
var config map[string]string
go func() {
    config = loadConfig()
}()
fmt.Println(config["key"])
```

**Fix:** Wait for init via a channel or `WaitGroup`.
```go
var config map[string]string
done := make(chan struct{})
go func() {
    config = loadConfig()
    close(done)
}()
<-done
fmt.Println(config["key"])
```

### Pattern: Slice header race

**Race:**
```go
buf := make([]byte, 100)
go func() { buf[0] = 1 }()
go func() { buf[99] = 2 }()
// race detector flags this even though indices are disjoint
```

The race is on the slice header. Fix:

```go
half1 := buf[:50]
half2 := buf[50:]
go func() { half1[0] = 1 }() // each goroutine has its own slice header
go func() { half2[49] = 2 }()
```

Each goroutine gets its own slice value (header). The underlying data is partitioned. Race detector is happy.

---

## `atomic.Value` and Pointer Publication

`atomic.Value` holds an `interface{}` that can be atomically swapped.

```go
var cfg atomic.Value

cfg.Store(&Config{...})

c := cfg.Load().(*Config)
```

### Use case

Read-mostly, occasionally-updated configuration. Reads are lock-free (atomic load); writes are atomic stores.

```go
type ServerConfig struct {
    Timeout time.Duration
    MaxConn int
}

var serverCfg atomic.Value

func init() {
    serverCfg.Store(&ServerConfig{Timeout: time.Second, MaxConn: 100})
}

func handler(w http.ResponseWriter, r *http.Request) {
    cfg := serverCfg.Load().(*ServerConfig)
    // use cfg
}

func reloadConfig(c *ServerConfig) {
    serverCfg.Store(c)
}
```

### Constraints

- All stored values must be of the same concrete type. Mixing types panics.
- The held value is read-only. To "modify" the config, store a new value (immutable update).

### Generic version (Go 1.19+)

```go
var cfg atomic.Pointer[Config]
cfg.Store(&Config{...})
c := cfg.Load()
```

Type-safe. No `interface{}` boxing.

---

## Beyond the Race Detector

The race detector is fantastic but not perfect:

### What it catches

- Unsynchronised concurrent access during the test run.
- Most violations of the happens-before discipline.

### What it misses

- Races that do not occur in the test (rare orderings, untested code paths).
- Races inside Cgo (the race detector does not instrument C code).
- Races on memory the runtime accesses internally (rare; usually bugs).

### Strategies for completeness

1. **Stress runs.** `go test -race -count=1000` to surface rare orderings.
2. **Property-based testing.** Generate random concurrent operation orderings.
3. **Code review.** A second pair of eyes on synchronisation logic.
4. **Static analysis.** `go vet` catches some patterns (e.g., copying mutex values).
5. **Production canary.** Run a small percentage of production traffic through `-race` builds.

The race detector is a great safety net, but discipline in design matters more.

---

## Atomic vs Mutex Trade-offs

When choosing between atomics and mutexes:

### Choose atomics when:

- The state is a single primitive (int, bool, pointer).
- The operation is simple (read, write, add, CAS).
- Performance matters (atomics are ~5 ns; mutexes ~20 ns).
- Many readers, few writers, simple state.

### Choose mutex when:

- The state is multiple correlated variables.
- The operation is complex (multi-step, conditional, transactional).
- Code clarity matters more than ns-level performance.
- You need RWMutex for read-heavy patterns.

### Hybrid patterns

Sometimes you mix: an atomic flag for cheap polling, a mutex for the slow path.

```go
type Cache struct {
    fastFlag atomic.Int64 // version stamp
    slowMu   sync.Mutex
    slowMap  map[string]string
}

func (c *Cache) Get(k string) string {
    ver := c.fastFlag.Load()
    // Cheap atomic check — was anything changed recently?
    if ver == 0 { return "" }
    c.slowMu.Lock()
    defer c.slowMu.Unlock()
    return c.slowMap[k]
}
```

Or use `sync.Map`, which is exactly this pattern internally.

---

## Testing Concurrent Code

### Race detector in CI

```yaml
# .github/workflows/test.yml
- name: Test with race detector
  run: go test -race -count=10 ./...
```

The `-count=10` runs each test 10 times, increasing the chance of hitting rare orderings.

### Stress tests

Write tests that hammer concurrent paths:

```go
func TestConcurrentAccess(t *testing.T) {
    c := NewCache()
    var wg sync.WaitGroup
    for i := 0; i < 1000; i++ {
        wg.Add(1)
        go func(i int) {
            defer wg.Done()
            c.Set(fmt.Sprintf("k%d", i), "v")
            _ = c.Get(fmt.Sprintf("k%d", i))
        }(i)
    }
    wg.Wait()
}
```

Run with `-race -count=100`.

### Property-based concurrent testing

The `pgregory.net/rapid` library can generate random concurrent operations:

```go
import "pgregory.net/rapid"

func TestProperty(t *testing.T) {
    rapid.Check(t, func(t *rapid.T) {
        ops := rapid.SliceOfN(genOp, 100, 1000).Draw(t, "ops")
        runConcurrent(ops)
        verifyInvariant()
    })
}
```

Generates thousands of random operation sequences; any failure becomes a test case.

### Goleak

```go
import "go.uber.org/goleak"

func TestMain(m *testing.M) {
    goleak.VerifyTestMain(m)
}
```

Verifies no goroutines are left running after tests complete.

### Mutex profile in tests

```go
runtime.SetMutexProfileFraction(1)
defer runtime.SetMutexProfileFraction(0)

// ... run concurrent test ...

p := pprof.Lookup("mutex")
p.WriteTo(os.Stdout, 1)
```

Shows where mutex contention happened during the test.

---

## Self-Assessment

- [ ] I can write a race-free counter with three different primitives (mutex, atomic, channel).
- [ ] I understand the buffered-channel synchronisation rule.
- [ ] I have used `atomic.Value` or `atomic.Pointer` for pointer publication.
- [ ] I know the difference between `atomic.Bool` and `bool` with mutex.
- [ ] I have written stress tests with `-race -count=100`.
- [ ] I can identify common race patterns at a glance.
- [ ] I have read and understood the 2022 Go memory model document.
- [ ] I have used `pgregory.net/rapid` or similar for concurrent property tests.
- [ ] I have used `goleak` to detect goroutine leaks in tests.
- [ ] I run the race detector in CI for every project I work on.

---

## Summary

The 2022 Go memory model formalises atomics as sequentially consistent, simplifying reasoning. The standard library provides a clear toolkit: channels for ownership transfer, mutexes for shared state, atomics for primitives, `sync.Once` for one-time init, `sync.WaitGroup` for joining.

Race-freedom is a property of code, not of runs. The race detector catches violations that happen during execution, but rare orderings can slip through. Stress runs (`-count=N`), property-based testing, and code review fill the gaps.

Choosing between primitives is mostly about clarity: atomic for one primitive, mutex for multiple correlated variables, channel for dataflow. Performance differences matter on very hot paths; readability matters everywhere.

The senior view (next file) treats memory model concerns as architectural: race-free API design, lock-free patterns, ordering across libraries. The professional view drops into CPU memory models and race detector internals.
