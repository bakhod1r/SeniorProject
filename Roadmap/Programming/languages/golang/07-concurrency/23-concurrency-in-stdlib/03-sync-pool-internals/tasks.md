---
layout: default
title: sync.Pool Internals — Tasks
parent: sync.Pool Internals
grand_parent: Concurrency in Stdlib
ancestor: Go
nav_order: 8
has_children: false
permalink: /roadmap/programming-languages/golang/07-concurrency/23-concurrency-in-stdlib/03-sync-pool-internals/tasks/
---

# sync.Pool Internals — Tasks

[← Back](../)

> Hands-on exercises. Each task has a goal, starter code where relevant, success criteria, and hints. Solutions are not given.

---

## Task 1 — Baseline allocation benchmark (junior)

**Goal.** Measure the allocation cost of a workload, then introduce a pool and measure the change.

**Starter:**
```go
package mypkg

import (
    "bytes"
    "strconv"
    "testing"
)

func format(n int) string {
    var b bytes.Buffer
    for i := 0; i < n; i++ {
        b.WriteString(strconv.Itoa(i))
        b.WriteByte(',')
    }
    return b.String()
}

func BenchmarkNoPool(b *testing.B) {
    for i := 0; i < b.N; i++ {
        _ = format(100)
    }
}
```

**Steps:**
1. Run `go test -bench=. -benchmem` and record `B/op` and `allocs/op`.
2. Add a `sync.Pool` of `*bytes.Buffer` and rewrite `format` to acquire and release a pooled buffer.
3. Re-run the benchmark. Record the new values.

**Success criteria:**
- `allocs/op` drops by at least one (the buffer allocation disappears in steady state).
- `ns/op` is no worse than the original (often it improves by 20-40%).
- You handle `Reset()` before `Put`.

**Hint.** The buffer's underlying `[]byte` grows on use; after `Reset`, capacity is retained, so subsequent uses skip the allocator.

---

## Task 2 — Observe the GC drain (junior)

**Goal.** See `sync.Pool` empty after a forced GC.

**Starter:**
```go
package main

import (
    "fmt"
    "runtime"
    "sync"
)

func main() {
    var newCount int
    pool := &sync.Pool{
        New: func() any {
            newCount++
            return new(int)
        },
    }
    for i := 0; i < 100; i++ {
        pool.Put(pool.Get())
    }
    fmt.Println("before GC, newCount =", newCount)

    runtime.GC()
    runtime.GC() // second pass drains the victim cache

    for i := 0; i < 100; i++ {
        pool.Put(pool.Get())
    }
    fmt.Println("after 2x GC, newCount =", newCount)
}
```

**Steps:**
1. Run the program.
2. Observe `newCount` before and after the two GCs.
3. Try with only one `runtime.GC()` call. What changes?

**Success criteria.** You can articulate why two GCs are needed to fully drain the pool (the victim cache lifecycle).

**Hint.** The first GC moves local → victim. The second GC discards the victim. Only after the second GC is every item gone.

---

## Task 3 — Cross-P stealing (middle)

**Goal.** Produce items on one goroutine and consume them on another, confirming that the consumer can take items the producer pushed.

**Starter:**
```go
package main

import (
    "fmt"
    "runtime"
    "sync"
    "sync/atomic"
)

func main() {
    runtime.GOMAXPROCS(4)

    pool := &sync.Pool{New: func() any { return new(int) }}
    var hits atomic.Int64
    var misses atomic.Int64

    // Producer: only Put
    go func() {
        runtime.LockOSThread()
        for i := 0; i < 10000; i++ {
            v := new(int)
            *v = i
            pool.Put(v)
        }
    }()

    // Consumer: only Get
    var wg sync.WaitGroup
    for i := 0; i < 3; i++ {
        wg.Add(1)
        go func() {
            defer wg.Done()
            runtime.LockOSThread()
            for j := 0; j < 3000; j++ {
                v := pool.Get()
                if v == nil {
                    misses.Add(1)
                } else {
                    hits.Add(1)
                }
            }
        }()
    }
    wg.Wait()
    fmt.Println("hits:", hits.Load(), "misses:", misses.Load())
}
```

**Steps:**
1. Run multiple times. Note the hit/miss ratio.
2. Replace `runtime.GOMAXPROCS(4)` with `1`. Does the ratio change?
3. Remove the `runtime.LockOSThread()` calls. Does the ratio change?

**Success criteria.** You can explain why the consumer goroutines successfully steal from the producer's P.

**Hint.** The producer's P has the items in its `local.shared` queue. The consumer Ps walk other Ps' shared queues calling `popTail`. With `GOMAXPROCS=1` there is only one P; nothing to steal across, but private/shared still apply.

---

## Task 4 — Force the slow path (middle)

**Goal.** Use a contrived workload that always misses the local-private fast path, then measure the cost difference vs the fast path.

**Starter idea.** Two pools — one accessed by a single goroutine (fast path always hits), one accessed by N goroutines round-robin (each Put goes to a different P than the next Get).

**Success criteria.** The slow-path benchmark is at least 2× slower per `Get` than the fast-path benchmark.

**Hint.** Round-robin via channel coordination. The producer signals "I just Put on P3" and the consumer migrates itself before calling Get.

---

## Task 5 — Disassemble the fast path (middle)

**Goal.** Read the assembly of `sync.(*Pool).Get` and confirm there is no atomic operation on the success path.

**Steps:**
1. Build a tiny program that calls `pool.Get()` and `pool.Put(x)` once.
2. Run `go tool objdump -s 'sync\.\(\*Pool\)\.Get' ./prog`.
3. Trace through the basic blocks until the first conditional branch that leads to "slow path" code.
4. Confirm: no `LOCK`-prefixed instruction on the success branch.

**Success criteria.** You can point at the assembly instructions corresponding to `local.private` load, nil check, and clear-and-return.

---

## Task 6 — Reproduce the pre-1.13 cliff (senior)

**Goal.** Show that the victim cache prevents an allocation cliff at GC.

**Steps:**
1. Write a benchmark that does Get/Put in a tight loop with a `bytes.Buffer` pool.
2. Add a goroutine that calls `runtime.GC()` every 100ms.
3. Measure `allocs/op` with and without the GC goroutine.

**Success criteria.** With the GC goroutine, `allocs/op` may rise slightly (some pool churn) but should not double — the victim cache absorbs the GC.

**Hint.** Without the victim cache (which you cannot easily disable), the allocation count would *double* because every GC empties the pool. With it, the impact is small.

---

## Task 7 — `poolDequeue` minimal reimplementation (senior)

**Goal.** Write your own single-producer/multi-consumer ring with packed head/tail.

**Skeleton:**
```go
package myqueue

import "sync/atomic"

type Dequeue struct {
    headTail atomic.Uint64
    vals     []any
}

func (d *Dequeue) PushHead(v any) bool { /* TODO */ }
func (d *Dequeue) PopHead() (any, bool) { /* TODO */ }
func (d *Dequeue) PopTail() (any, bool) { /* TODO */ }
```

**Steps:**
1. Implement `unpack`/`pack` for the head-tail pair.
2. Implement `PushHead` assuming you are the sole producer.
3. Implement `PopTail` as a CAS loop (multiple stealers may race).
4. Write a `go test -race` that has one producer pushing and multiple goroutines popping from the tail.

**Success criteria.** Race detector finds nothing; under load, no item is lost or returned twice.

---

## Task 8 — Pool-size sweep (senior)

**Goal.** Find the object size threshold at which `sync.Pool` starts to be worth it.

**Method.**
- For sizes 64, 256, 1024, 4096, 16384 bytes:
  - Benchmark `_ = make([]byte, N)` in a tight loop.
  - Benchmark the same with a `sync.Pool` of `*[]byte`.
- Plot ns/op for both.

**Success criteria.** You can identify a crossover size below which the pool is no faster (or is slower).

**Hint.** On most amd64 machines, the crossover is around 256-512 bytes for plain `[]byte`. For objects with constructor cost (e.g., a parsed regexp or a *bufio.Reader), the crossover is much lower.

---

## Task 9 — Measure false sharing (professional)

**Goal.** Demonstrate the `poolLocal` pad is doing work.

**Method.**
- Patch a local copy of `sync` to remove the `pad` field from `poolLocal`.
- Run a benchmark that has N goroutines on N Ps doing high-rate Put.
- Compare with the unpatched version.

**Success criteria.** The unpatched version is measurably faster (typically 1.5-3× on 8+ cores).

**Hint.** Look for L1/L2 cache misses with `perf stat -e L1-dcache-load-misses,L1-dcache-loads`.

---

## Task 10 — Replace a hand-rolled mutex pool (professional)

**Goal.** Take a real codebase with a hand-rolled mutex-protected pool and convert to `sync.Pool`.

**Method.**
- Find or write a struct like:
  ```go
  type SlowPool struct {
      mu sync.Mutex
      list []*MyType
  }
  ```
- Benchmark its throughput vs an equivalent `sync.Pool`.

**Success criteria.** The `sync.Pool` version is significantly faster (5-50×) under contention, with similar memory behavior.

---

## Task 11 — Trace pool ownership across goroutines (staff)

**Goal.** Verify experimentally that a `Put` from one goroutine is observable by `Get` on another, even after the producer exits.

**Method.** Use `runtime/trace` (`go tool trace`) on a workload that has short-lived producers and long-lived consumers.

**Success criteria.** You can pinpoint, in the trace, the `Put`-side Goroutine event that supplies the value the `Get`-side reads.

**Hint.** `runtime.GOMAXPROCS(1)` makes this easier to see — the pool's per-P behavior collapses to a single dequeue.

---

## Task 12 — Find the optimal pool warm-up (staff)

**Goal.** For a given workload, find the pool pre-warming amount that minimizes the `New` call rate.

**Method.**
- Wrap `New` with a counter.
- At startup, call `pool.Put(pool.New())` K times for various K.
- Measure the steady-state `New` call rate.

**Success criteria.** You can plot `New`-rate vs K and identify the elbow.

**Hint.** Pre-warm enough to fill one local per P; beyond that, the warmup is wasted because items go straight into the shared queue and get drained by GC anyway.
