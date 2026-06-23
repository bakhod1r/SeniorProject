# Goroutine Stack Growth — Optimization

## Table of Contents
1. [Introduction](#introduction)
2. [Establish a Baseline](#establish-a-baseline)
3. [Optimization 1 — Convert Recursion to Iteration](#optimization-1--convert-recursion-to-iteration)
4. [Optimization 2 — Move Large Locals to the Heap](#optimization-2--move-large-locals-to-the-heap)
5. [Optimization 3 — Use sync.Pool for Per-Goroutine Buffers](#optimization-3--use-syncpool-for-per-goroutine-buffers)
6. [Optimization 4 — Worker Pool Instead of Per-Task Goroutines](#optimization-4--worker-pool-instead-of-per-task-goroutines)
7. [Optimization 5 — Pre-Grow Long-Lived Worker Stacks](#optimization-5--pre-grow-long-lived-worker-stacks)
8. [Optimization 6 — Cap MaxStack to Fail Fast](#optimization-6--cap-maxstack-to-fail-fast)
9. [Optimization 7 — Right-Size Channel Buffers](#optimization-7--right-size-channel-buffers)
10. [Optimization 8 — Pprof-Guided Cuts](#optimization-8--pprof-guided-cuts)
11. [Optimization 9 — Inlining Hot Helpers](#optimization-9--inlining-hot-helpers)
12. [When NOT to Optimize](#when-not-to-optimize)

---

## Introduction

Stack growth is amortised cheap, but on hot paths it shows up. Each section is a real optimization with concrete before/after, expected wins, and how to measure. The order is by impact: convert-recursion-to-iteration usually wins biggest; inlining hot helpers wins least but is sometimes worth it.

Profile first. Optimize only when pprof points at stack growth as a measurable cost.

---

## Establish a Baseline

Before any optimization, measure:

```go
package main

import (
    "fmt"
    "net/http"
    _ "net/http/pprof"
    "runtime"
)

func main() {
    go http.ListenAndServe("localhost:6060", nil)

    // ... your workload ...

    var m runtime.MemStats
    runtime.ReadMemStats(&m)
    fmt.Printf("Goroutines: %d\n", runtime.NumGoroutine())
    fmt.Printf("StackInuse: %d KB\n", m.StackInuse/1024)
    fmt.Printf("StackSys:   %d KB\n", m.StackSys/1024)
}
```

Capture a CPU profile:

```
go tool pprof http://localhost:6060/debug/pprof/profile?seconds=10
```

Inside pprof:

```
(pprof) top
(pprof) top -cum
(pprof) list yourfunc
```

If `runtime.morestack_noctxt` or `runtime.newstack` appears in the top 10, stack growth is costing measurable CPU. If not, skip stack-related optimizations and look at other hotspots.

---

## Optimization 1 — Convert Recursion to Iteration

**When:** A recursive function is on a hot path, especially if depth can be large.

**Expected gain:** Often 20-50% for deeply recursive workloads. Eliminates `morestack` from pprof.

### Before

```go
func walk(n *Node, visit func(int)) {
    if n == nil {
        return
    }
    visit(n.Value)
    walk(n.Left, visit)
    walk(n.Right, visit)
}
```

### After

```go
func walk(root *Node, visit func(int)) {
    if root == nil {
        return
    }
    stack := make([]*Node, 0, 64)
    stack = append(stack, root)
    for len(stack) > 0 {
        n := stack[len(stack)-1]
        stack = stack[:len(stack)-1]
        visit(n.Value)
        if n.Right != nil {
            stack = append(stack, n.Right)
        }
        if n.Left != nil {
            stack = append(stack, n.Left)
        }
    }
}
```

### Why it's faster

- No prologue check per call.
- Goroutine stack stays at minimum 2 KB.
- Slice grows by doubling (amortised cheap) on the heap; one heap allocation amortises across many `append`s.
- For long chains (depth > 50), no stack growth events.

### How to measure

Benchmark both with `go test -bench` on a 10,000-node tree. Look at:
- ns/op (lower is better).
- allocs/op (iterative uses fewer; just the slice).
- B/op.

Add a pprof CPU profile to confirm no `morestack` in the iterative version.

---

## Optimization 2 — Move Large Locals to the Heap

**When:** A function with a >1 KB local array runs in many short-lived goroutines.

**Expected gain:** Each fresh goroutine avoids growth from 2 KB → 4 KB → 8 KB.

### Before

```go
func handle(conn net.Conn) {
    var buf [8192]byte // 8 KB local — triggers growth
    for {
        n, err := conn.Read(buf[:])
        // ... process buf[:n] ...
    }
}
```

A fresh goroutine starts at 2 KB. The `buf` makes the frame ~8 KB. Stack must grow.

### After

```go
func handle(conn net.Conn) {
    buf := make([]byte, 8192) // heap-allocated
    for {
        n, err := conn.Read(buf)
        // ... process buf[:n] ...
    }
}
```

`buf` is on the heap (one allocation per connection). The goroutine's frame stays small. No stack growth.

### Trade-off

You added one heap allocation per connection, which GC must eventually reclaim. For short-lived goroutines this is a wash. For long-lived connections (read in a loop), it's a one-time cost worth paying.

### When the trade-off favours stack

If the goroutine is long-lived and the buffer is used millions of times, the *post-growth* stack version is cheaper because there's no GC overhead. Use `sync.Pool` (next optimization) to keep both worlds.

---

## Optimization 3 — Use sync.Pool for Per-Goroutine Buffers

**When:** A per-task scratch buffer is used by many goroutines, each briefly.

**Expected gain:** Eliminate both heap-alloc-per-task and stack-growth-per-task.

### Before

```go
func process(in []byte) []byte {
    var scratch [16 * 1024]byte // stack local, 16 KB
    // ... write to scratch ...
    return append([]byte(nil), scratch[:len(in)]...)
}
```

Every call: stack growth (16 KB > 2 KB initial), plus a heap allocation for the return.

### After

```go
var scratchPool = sync.Pool{
    New: func() any {
        return make([]byte, 16*1024)
    },
}

func process(in []byte) []byte {
    scratch := scratchPool.Get().([]byte)
    defer scratchPool.Put(scratch[:cap(scratch)])
    // ... write to scratch ...
    out := make([]byte, len(in))
    copy(out, scratch[:len(in)])
    return out
}
```

The pool amortises the 16 KB allocation across calls. Goroutine stack stays small. Only the returned `out` is allocated per call.

### Gotcha: pool growth

`sync.Pool` per-P caches mean each P holds its own buffer. With high concurrency you may allocate hundreds of buffers. Tune the buffer size; if 4 KB is enough for 99% of calls, use 4 KB and grow only for outliers.

### When NOT to use sync.Pool

- For tiny objects (< 1 KB). The pool overhead can exceed the alloc savings.
- For objects holding pointers — GC scans them anyway.
- For values you need to be zeroed — pools may return non-zero buffers; you must zero them.

---

## Optimization 4 — Worker Pool Instead of Per-Task Goroutines

**When:** A high-rate stream of tasks, each modest in size.

**Expected gain:** Eliminates per-task goroutine creation and stack growth.

### Before

```go
func handleStream(tasks chan Task) {
    for task := range tasks {
        go process(task)
    }
}
```

Each task gets a fresh 2 KB goroutine. Process grows the stack. Total growths = number of tasks.

### After

```go
func handleStream(tasks chan Task) {
    workers := runtime.GOMAXPROCS(0) * 2
    var wg sync.WaitGroup
    for i := 0; i < workers; i++ {
        wg.Add(1)
        go func() {
            defer wg.Done()
            for task := range tasks {
                process(task)
            }
        }()
    }
    wg.Wait()
}
```

A fixed pool of workers. Each worker's stack grows once (during the first heavy task) and stays grown. Subsequent tasks reuse the warmed-up stack.

### Trade-off

- Loses some parallelism if tasks are wildly different sizes (head-of-line blocking in worker channels).
- Adds channel send/receive cost.
- More complex code.

### When to choose

- CPU-bound tasks where you don't want more goroutines than cores.
- Tasks of similar size.
- Sustained throughput more important than burst tolerance.

When to keep per-task goroutines:

- I/O-bound tasks with random latency.
- Bursty workloads.
- Code simplicity is more important than peak throughput.

---

## Optimization 5 — Pre-Grow Long-Lived Worker Stacks

**When:** Latency-sensitive long-lived workers, where the first few requests pay growth tax.

**Expected gain:** Eliminates tail-latency spikes from stack growth.

### Code

```go
func warmupStack() {
    // Force the stack to grow to ~32 KB by allocating a large local.
    var pad [30 * 1024]byte
    for i := 0; i < len(pad); i += 1024 {
        pad[i] = byte(i)
    }
}

func worker(tasks <-chan Task) {
    warmupStack()
    for task := range tasks {
        process(task)
    }
}
```

### Why it works

`warmupStack` forces an early stack growth before any tasks arrive. Subsequent calls run on the larger stack. Latency variance drops.

### When this helps

- p99 / p99.9 latency budgets near the cost of one stack growth (5-20 μs).
- A few "first request" spikes you can't tolerate.

### When this doesn't help

- Throughput-bound workloads — total work is the same.
- Per-request goroutine model — each is cold anyway.

---

## Optimization 6 — Cap MaxStack to Fail Fast

**When:** Service handles untrusted input that might cause deep recursion.

**Expected gain:** Process dies in 5 ms instead of 5 seconds on attack. Less memory consumed before death.

### Code

```go
import "runtime/debug"

func init() {
    debug.SetMaxStack(64 * 1024 * 1024) // 64 MB
}
```

Cap stack at 64 MB instead of 1 GB.

### Why it's an optimization

- **Memory safety**: an attacker triggering recursion can consume only 64 MB, not 1 GB.
- **Fast failure**: the process dies before slowing other operations.
- **Easier debugging**: at 64 MB you see "stack overflow" in seconds, not minutes.

### How to choose the cap

- If your recursion is bounded to depth N with frame size F, cap should be > N × F with some headroom.
- For typical web services, 16-64 MB is plenty.
- For known-deep recursion (e.g., a compiler), set higher.

### Production tip

Combine with a process supervisor that restarts on crash (systemd, k8s). A stack-overflow attack now degrades into a restart loop, which alerting systems flag.

---

## Optimization 7 — Right-Size Channel Buffers

**When:** Goroutines park on channels, holding their stacks.

**Expected gain:** Reduce StackSys when many parked goroutines.

### Before

```go
results := make(chan Result) // unbuffered
for i := 0; i < N; i++ {
    go func() {
        r := work()
        results <- r // blocks until consumed
    }()
}
```

If consumption is slow, N goroutines pile up, all parked, all holding their (possibly grown) stacks.

### After

```go
results := make(chan Result, N) // fully buffered
for i := 0; i < N; i++ {
    go func() {
        r := work()
        results <- r // returns immediately
    }()
}
```

Each goroutine returns immediately after sending, so its stack is freed. Only the buffered channel holds the results in heap memory.

### Trade-off

You pay for buffer memory upfront. For large N this can dominate. Pick a buffer size matched to consumption rate, not total task count.

---

## Optimization 8 — Pprof-Guided Cuts

**When:** You've exhausted obvious optimizations and pprof still shows growth.

**Expected gain:** Variable. Depends on what pprof identifies.

### Workflow

1. Capture CPU profile during representative load.
2. `go tool pprof -alloc_objects http://...` for allocation profile too.
3. Look for `runtime.morestack_noctxt` and `runtime.newstack` in the top.
4. Follow the *callers* chain. Pprof's `traces` command shows callers.

```
(pprof) traces runtime.newstack
```

This lists every code path that triggered growth, with cumulative time.

5. For each path, look at the calling function. Is it:
   - A large frame? → heap-allocate the locals.
   - A recursion? → iterate.
   - A per-task spawn? → use a pool.

### Example

Profile output:
```
flat  flat%   sum%        cum   cum%
50ms 10.00% 10.00%       50ms 10.00%  runtime.morestack_noctxt
```

Trace:
```
runtime.morestack_noctxt
  caller: encoding/json.(*decodeState).object
    caller: encoding/json.(*decodeState).value
      caller: encoding/json.(*decodeState).array
```

Action: switch from `encoding/json` to a parser with smaller frames (e.g., `jsoniter` or `fastjson`).

---

## Optimization 9 — Inlining Hot Helpers

**When:** A tight loop calls a small helper that itself triggers stack checks.

**Expected gain:** Marginal (saves 2-3 cycles per call) — only worth it when the helper is invoked billions of times.

### Code

```go
//go:inline
func clamp(x, lo, hi int) int {
    if x < lo { return lo }
    if x > hi { return hi }
    return x
}
```

The `//go:inline` directive (Go 1.20+) is a *hint*; the compiler decides. Use `-gcflags="-m=2"` to check what was inlined.

### Trade-off

- An inlined function shares the caller's frame — adds to its size.
- A larger caller frame may trigger growth that the smaller version wouldn't.

### When this helps

- Helpers called millions of times per second.
- Tight inner loops.
- Functions small enough that inlining is a net win.

Use `go test -bench` to verify. Without a measurable improvement, don't bother.

---

## When NOT to Optimize

Resist stack-related optimization when:

- **`morestack` is not in the top of pprof.** Stack growth is amortised cheap. If it's not measurable, no win is available.
- **The recursion is bounded and shallow.** Walking a balanced binary tree of 1M nodes is depth 20. Recursion is fine.
- **The code is already clear.** A 5% improvement that doubles complexity is a net negative.
- **You haven't measured.** Always benchmark before and after. Speculative optimizations often regress.
- **The bottleneck is elsewhere.** Database, network I/O, GC. Stack growth is rarely the dominant cost.

### A pragmatic checklist

Optimize stack growth if:

- [ ] Pprof shows `morestack`/`newstack` in top 20.
- [ ] You can measure a latency or throughput win.
- [ ] The optimization is local and reviewable.
- [ ] The before-state has a clear bug (unbounded recursion, large stack locals × many goroutines, leaks).

Skip stack-growth optimization if:

- [ ] The workload comfortably fits memory and CPU budgets.
- [ ] Code clarity matters more than micro-improvements.
- [ ] You haven't established a baseline.

---

## Summary

Optimizations in order of impact:

1. **Convert recursion to iteration** — biggest wins for deep recursion.
2. **Move large locals to heap** — eliminates per-spawn growth.
3. **sync.Pool for scratch buffers** — combines both above for hot paths.
4. **Worker pools** — amortises growth across many tasks.
5. **Pre-grow long-lived workers** — eliminates first-request latency spike.
6. **Cap MaxStack** — defensive; fails fast on attack.
7. **Right-size channel buffers** — frees parked goroutine stacks.
8. **Pprof-guided cuts** — find specific paths to optimize.
9. **Inlining hot helpers** — micro-level; last resort.

Always measure. The cost of stack growth is amortised cheap; the cost of optimizing prematurely is engineering time.
