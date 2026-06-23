# Race Detection — Middle Level

## Table of Contents
1. [Introduction](#introduction)
2. [The Go Memory Model](#the-go-memory-model)
3. [Happens-Before Edges](#happens-before-edges)
4. [Common Race Patterns](#common-race-patterns)
5. [Atomics](#atomics)
6. [Detector Internals](#detector-internals)
7. [CI Integration](#ci-integration)
8. [Reading Complex Race Reports](#reading-complex-race-reports)
9. [False Negatives](#false-negatives)
10. [Idiomatic Race-Free Patterns](#idiomatic-race-free-patterns)
11. [Anti-Patterns](#anti-patterns)
12. [Testing Strategy](#testing-strategy)
13. [Tricky Cases](#tricky-cases)
14. [Cheat Sheet](#cheat-sheet)
15. [Summary](#summary)

---

## Introduction

Junior level introduced data races, the `-race` flag, and the `mutex+atomic` fixes for the simplest patterns. Middle level deepens the foundation:

- The Go memory model (the formal rules).
- Happens-before edges (every synchronisation point).
- Atomic operations (when they suffice, when they do not).
- Detector internals (ThreadSanitizer).
- CI integration patterns.

By the end you should be able to explain *why* a particular fix works (not just that it does) and to integrate `-race` into a CI pipeline.

---

## The Go Memory Model

The Go memory model is a contract between programmer and runtime. It says: a read of a variable in goroutine B is guaranteed to observe a write in goroutine A if and only if there is a happens-before edge from A's write to B's read.

Without an edge, the read may see:

- Nothing (the original zero value).
- The most recent write.
- A value from any previous write.
- A *partial* write (torn read) on platforms where the type is wider than a hardware load.

In practice, modern CPUs and the Go compiler may reorder reads and writes for performance. Synchronisation primitives publish "barriers" that prevent unsafe reordering across them.

A simple example showing reordering:

```go
var (
    a, b int
)

// goroutine 1
a = 1
b = 2

// goroutine 2
fmt.Println(b, a)
```

The output is *not* guaranteed to be one of `{0,0}, {0,1}, {2,1}`. It can also be `{2, 0}`: goroutine 2 saw `b = 2` (the later write) but not `a = 1` (the earlier one), because writes were reordered or the cache propagated them in the wrong order.

The memory model says: this is a data race. The result is undefined.

---

## Happens-Before Edges

A non-exhaustive list of edges Go provides:

| Edge | Meaning |
|------|---------|
| **Channel send → matching receive** | Send completes before receive returns the value. |
| **Channel close → receive of zero value** | Close completes before any receive that observes the close. |
| **Receive on unbuffered channel → send completion** | Send blocks until receive starts; both happen-before each other in different ways. |
| **Mutex Unlock → next Lock** | Unlock completes before the next Lock returns. |
| **Once.Do(f) → return of any later Do** | f's effects are visible after first Do returns. |
| **WaitGroup.Done → matching Wait return** | Done's effects visible after Wait returns. |
| **Atomic store with Release → atomic load with Acquire** | All prior writes visible to loads that see the stored value. |
| **Goroutine creation → goroutine body starts** | Code before `go f()` happens-before `f` runs. |
| **End of init → main start** | All package init runs before main. |

These are the *only* tools that make memory writes visible across goroutines. Anything else is a race.

A subtler one: **goroutine end does NOT happen-before anything by default**. To make goroutine A's writes visible to goroutine B, you need an explicit edge — typically `wg.Wait` or a channel receive.

---

## Common Race Patterns

### Captured loop variable (pre-Go 1.22)

```go
for i := 0; i < n; i++ {
    go func() { use(i) }() // race + logic bug
}
```

`i` is one variable; main loop writes it; goroutines read it. Fix: `i := i` per iteration, or upgrade to Go 1.22+.

### Shared map

```go
m := map[string]int{}
go func() { m["k"] = 1 }()
go func() { _ = m["k"] }()
```

Maps are not safe for concurrent use. Even with `-race` off, this can panic with "concurrent map writes". Use `sync.RWMutex` or `sync.Map`.

### Double-checked locking, Go-style

```go
type Cache struct {
    mu sync.Mutex
    m  map[string]string
    init bool
}

func (c *Cache) Get(k string) string {
    if !c.init { // race: read without lock
        c.mu.Lock()
        if !c.init {
            c.m = make(map[string]string)
            c.init = true
        }
        c.mu.Unlock()
    }
    return c.m[k] // race: read map without lock
}
```

The first `if !c.init` is unsynchronised. It might read the new value of `init` while `m` is still nil. Fix: use `sync.Once`:

```go
func (c *Cache) Get(k string) string {
    c.once.Do(func() { c.m = make(map[string]string) })
    c.mu.RLock()
    defer c.mu.RUnlock()
    return c.m[k]
}
```

### Atomic with non-atomic read

```go
var flag int32

go func() { atomic.StoreInt32(&flag, 1) }()
if flag == 1 { ... } // race: non-atomic read
```

Mixing atomic and non-atomic accesses on the same variable is a race. Use `atomic.LoadInt32` for the read.

### Partial update

```go
type Stats struct {
    Total int
    OK    int
}

go func() { s.Total++; s.OK++ }()
go func() { fmt.Println(s.Total, s.OK) }()
```

The reader can see `Total = 5, OK = 4`: the writer was halfway through. Lock the whole update.

### Slice append

```go
var s []int
go func() { s = append(s, 1) }()
go func() { s = append(s, 2) }()
```

`append` is multi-step (read len, decide if realloc, write). Concurrent appends race. Lock or use a channel.

---

## Atomics

`sync/atomic` provides:

- `Load*`, `Store*`, `Add*`, `Swap*`, `CompareAndSwap*` for `int32`, `int64`, `uint32`, `uint64`, `uintptr`, `unsafe.Pointer`.
- Typed wrappers (Go 1.19+): `atomic.Int32`, `atomic.Int64`, `atomic.Bool`, `atomic.Uint32`, etc.
- `atomic.Pointer[T]` (Go 1.19+) for typed pointer atomics.

Atomic operations:

1. Are *atomic*: no torn reads/writes.
2. Establish *sequential consistency* in the Go memory model: an `atomic.Store` happens-before any `atomic.Load` that observes the stored value.
3. Are *not* a substitute for mutexes when the operation spans multiple variables.

Example: refreshable config

```go
type Config struct{ /* ... */ }

var cfg atomic.Pointer[Config]

func Load() *Config         { return cfg.Load() }
func Store(c *Config)       { cfg.Store(c) }
```

Hot path readers do an atomic load; the writer publishes a new pointer. No mutex, no GC pause. This is *not* a substitute for `sync.RWMutex` if the config is modified in place — the trick relies on immutability of the pointed-to struct.

---

## Detector Internals

The Go race detector is built on **ThreadSanitizer** (TSan), originally from Google. Sketch of how it works:

- Every memory access is instrumented at compile time. The compiler inserts a function call before each load/store recording the address, the type (read or write), and the goroutine id.
- TSan maintains a **vector clock** per goroutine. Each synchronisation event (channel send, mutex unlock, etc.) updates the clock.
- For each address, TSan keeps a small history of recent accesses and their vector clocks.
- When a new access arrives, TSan checks the history. If there is a previous access to the same address from a different goroutine, and the two clocks are not ordered (no happens-before edge), it reports a race.

Implications:

- **Memory cost**: vector clocks grow with goroutine count. The detector caps tracked goroutines at ~8128.
- **CPU cost**: every access is now a function call. Hence the 5-10x slowdown.
- **Coverage**: only memory accesses TSan instruments. Cgo memory and unsafe pointer arithmetic *can* slip through.

---

## CI Integration

A standard CI pipeline has at least three test stages:

1. `go vet ./...` — static checks.
2. `go test ./...` — fast tests.
3. `go test -race ./...` — race-detection tests.

Some teams add:

4. `go test -race -count=10 ./...` — repeated for flaky races.
5. `go test -race -timeout=10m ./...` — long-running stress tests.

A typical `Makefile`:

```makefile
test:
	go test ./...

test-race:
	go test -race -count=1 ./...

test-race-stress:
	go test -race -count=20 ./...

ci: test test-race
```

GitHub Actions snippet:

```yaml
- name: Run race tests
  run: go test -race ./...
  env:
    GORACE: "halt_on_error=1 exitcode=66"
```

`halt_on_error=1` makes the test stop the moment a race is found; `exitcode=66` makes the process exit non-zero so CI fails.

---

## Reading Complex Race Reports

A real-world race report often spans dozens of frames. The structure is always:

```
==================
WARNING: DATA RACE
{Read|Write} at 0x... by goroutine {N}:
  <stack trace>
Previous {read|write} at 0x... by goroutine {M}:
  <stack trace>

Goroutine {N} (running) created at:
  <stack trace>
Goroutine {M} (finished) created at:
  <stack trace>
==================
```

Reading order:

1. **Address** — the same on both sides; identifies which variable.
2. **Goroutine N's stack** — where the new access happened.
3. **Goroutine M's stack** — where the previous access happened.
4. **Creation stacks** — where each goroutine was launched.

Walk both stacks and find the lines that touch the variable. The fix is somewhere there: add a mutex, change to atomic, redesign the data flow.

---

## False Negatives

The detector can miss races if:

- The two accesses never happen in the same run (timing).
- The shared variable is accessed only once per run.
- The accesses are inside cgo.
- The accesses are through `unsafe` arithmetic that bypasses the instrumentation.
- The detector hits its goroutine cap.

So `-race` says "no race detected", not "no races exist". For high-stakes code, run `-race -count=N` with a stress harness that exercises every code path.

---

## Idiomatic Race-Free Patterns

### Pattern: don't share, communicate
Pass the value through a channel instead of mutating a shared variable. The channel send/receive provides the happens-before edge.

### Pattern: per-goroutine state
Each goroutine has its own scratch space. Aggregate at the end via channels or a final mutex-protected merge.

### Pattern: copy-on-write config
A pointer guarded by `atomic.Pointer`. Readers always see a complete, immutable snapshot. Writers prepare a new struct and atomically swap.

### Pattern: sharded counter
N independent counters, each updated by a fixed shard of the workers, summed at read time. Reduces contention versus one global atomic.

### Pattern: sync.Once for one-time initialisation
The canonical way to lazily initialise a shared resource.

### Pattern: pass ctx, not shared cancel flags
Ctx provides happens-before on cancellation through the channel close.

---

## Anti-Patterns

- **Sleep-based "synchronisation"**: `time.Sleep(100*time.Millisecond)` to "let the other goroutine catch up". Not an edge.
- **Volatile-style hacks**: Go has no `volatile`. Use atomics.
- **Mutex-then-non-mutex access**: protecting writes but not reads (or vice versa). The detector flags this.
- **Mutex per-statement**: locking inside the loop body for every increment when one outer Lock would do.
- **Premature `RWMutex`**: it has higher overhead than `Mutex`; only use when reads dominate by a large factor.

---

## Testing Strategy

1. Run all tests with `-race` in CI.
2. Stress-test concurrency-heavy code with `-race -count=N` (often N = 100).
3. Use `goleak` to detect goroutine leaks alongside race detection.
4. Run benchmarks with and without `-race` to catch performance regressions caused by added synchronisation.
5. Have a flaky-test runbook: any test that fails intermittently is suspect; repeat under `-race` immediately.

---

## Tricky Cases

- **64-bit atomic on 32-bit platform.** `int64` atomics require 8-byte alignment. Use `atomic.Int64` (Go 1.19+) which guarantees alignment.
- **Race on a slice header vs underlying array.** Two separate races: header (len, cap, data pointer) and array elements. Different mutexes might be needed.
- **Race in `defer`d closure.** Defer captures variables; concurrent goroutine reading them is a race.
- **Race on closed-channel signal.** Closing a channel from one goroutine while another sends panics, but it is also a race on the channel's internal state. The runtime fast-path catches this; do not rely on it.

---

## Cheat Sheet

| Edge | Use |
|------|-----|
| Channel | Pipeline communication |
| Mutex | Multi-field updates |
| Atomic | Single int/pointer |
| Once | Lazy init |
| WaitGroup | Wait-then-read |
| Ctx cancel | Broadcast stop |

```bash
# CI race stage
GORACE="halt_on_error=1 exitcode=66" go test -race -count=1 ./...

# Stress
go test -race -count=100 ./...

# Bench without race
go test -bench=. -run=^$ ./...
```

---

## Summary

The middle level grounds race detection in the formal Go memory model. Every fix you write is establishing a happens-before edge — the only thing the language uses to synchronise memory. Atomics work for single-cell publication; mutexes work for multi-field updates; channels work for communication. The race detector is a vector-clock-based tool with overhead and limits, and it must be a CI gate. A passing `go test -race ./...` is the minimum bar for production Go.
