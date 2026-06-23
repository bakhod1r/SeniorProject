# Premature Concurrency Optimization — Junior Level

## Table of Contents
1. [Introduction](#introduction)
2. [The Knuth Quote, in Full](#the-knuth-quote-in-full)
3. [What "Premature" Actually Means](#what-premature-actually-means)
4. [The Benchmark-First Mantra](#the-benchmark-first-mantra)
5. [The "Is It Actually Faster?" Template](#the-is-it-actually-faster-template)
6. [Why Concurrency Has Its Own Premature-Optimization Problem](#why-concurrency-has-its-own-premature-optimization-problem)
7. [Example 1 — `go` for One-Shot CPU Work](#example-1--go-for-one-shot-cpu-work)
8. [Example 2 — `sync.RWMutex` Where `sync.Mutex` Would Do](#example-2--syncrwmutex-where-syncmutex-would-do)
9. [Example 3 — Atomic Where a Mutex Would Do (and Vice Versa)](#example-3--atomic-where-a-mutex-would-do-and-vice-versa)
10. [Example 4 — Sharding a Map Before Measuring Contention](#example-4--sharding-a-map-before-measuring-contention)
11. [Example 5 — `sync.Pool` for Objects That Are Not Hot](#example-5--syncpool-for-objects-that-are-not-hot)
12. [Example 6 — Channel-Based Actor Instead of a Mutex](#example-6--channel-based-actor-instead-of-a-mutex)
13. [Example 7 — Lock-Free Instead of a Mutex](#example-7--lock-free-instead-of-a-mutex)
14. [The Cost Side of the Ledger](#the-cost-side-of-the-ledger)
15. [When Concurrency Hurts — Small Problems](#when-concurrency-hurts--small-problems)
16. [When Concurrency Hurts — Already-Saturated CPU](#when-concurrency-hurts--already-saturated-cpu)
17. [When Concurrency Hurts — Lock Contention Disguised as Parallelism](#when-concurrency-hurts--lock-contention-disguised-as-parallelism)
18. [Reading a `testing.B` Result Honestly](#reading-a-testingb-result-honestly)
19. [`benchstat` in Three Commands](#benchstat-in-three-commands)
20. [The Three Numbers You Need Before Optimizing](#the-three-numbers-you-need-before-optimizing)
21. [Avoiding the "It Felt Faster" Trap](#avoiding-the-it-felt-faster-trap)
22. [Reverting Optimizations That Did Not Pay Off](#reverting-optimizations-that-did-not-pay-off)
23. [How to Write a Performance Comment](#how-to-write-a-performance-comment)
24. [Real-World Story — I Made My Code Lock-Free and Now It's Slower](#real-world-story--i-made-my-code-lock-free-and-now-its-slower)
25. [The Mantra in One Page](#the-mantra-in-one-page)
26. [Common Junior Mistakes](#common-junior-mistakes)
27. [Cross-References](#cross-references)
28. [Self-Assessment](#self-assessment)
29. [Summary](#summary)

---

## Introduction

You are six months into Go. You have read the concurrency tour. You have seen `go` and `chan` and `sync.Mutex` and `sync.RWMutex` and `atomic.Int64` and `sync.Pool` and the word "lock-free." A pull request lands on your screen with a tight loop that increments a counter. Your hand drifts towards `atomic.AddInt64`. A small map that is read in a request handler — surely it deserves `sync.RWMutex`. A function that allocates a 200-byte struct on every call — `sync.Pool` is right there. A queue protected by a mutex — somebody told you channels are "more Go-like." A function that does a millisecond of math — let's parallelise it with goroutines.

Most of those instincts are wrong. Not in the sense that the techniques are bad — they are excellent tools — but in the sense that, applied without measurement, they make your code slower, harder to read, and harder to debug. This page is here to install the *measurement reflex* before the optimisation reflex. Every other page in this anti-pattern section assumes you have absorbed the lesson here: **measure first, then optimise**.

The promise: by the end of this file you will know the seven specific patterns where junior Go programmers reach for concurrency or sophisticated synchronisation too early, you will own a `BenchmarkXxx`-and-`benchstat` workflow that decides whether an optimisation was worth it, and you will have read at least one war story per pattern in which the "optimised" version was slower than the obvious one.

A note on tone. This file does **not** say "never optimise." Performance matters. The Go team optimises the runtime aggressively. Real services have real bottlenecks. The argument is narrow: do not optimise *concurrency* before you have measured the unoptimised version. The cure for premature optimisation is not laziness; it is discipline.

---

## The Knuth Quote, in Full

Almost every engineer has heard "premature optimisation is the root of all evil." Almost none has read the surrounding paragraph. The line is from Donald Knuth's 1974 paper *Structured Programming with go to Statements*, page 268:

> Programmers waste enormous amounts of time thinking about, or worrying about, the speed of noncritical parts of their programs, and these attempts at efficiency actually have a strong negative impact when debugging and maintenance are considered. **We should forget about small efficiencies, say about 97% of the time: premature optimization is the root of all evil. Yet we should not pass up our opportunities in that critical 3%.**

Four things stand out when you read the whole sentence.

First, the warning is **about small efficiencies**. Knuth is not arguing against optimisation; he is arguing against optimising the parts that do not matter.

Second, the cost is paid in **debugging and maintenance**. Optimisation that does not move the needle still hurts you because future readers have to understand it.

Third, the 97% / 3% split is a rough number, but the message is clear: most code does not need to be fast, and pretending otherwise is what the quote attacks.

Fourth, the quote ends with "**yet we should not pass up our opportunities in that critical 3%.**" Knuth is not telling you to be lazy. He is telling you to find the 3% that matters and to be merciless there.

In concurrency the rule is sharper still, because every concurrency optimisation also adds *correctness risk*. A premature lock-free queue is not just maintenance debt; it is a deadlock or a data race waiting to bite you. A premature `sync.Pool` is a bug machine if you forget to reset the pooled object. A premature channel actor is a hidden goroutine leak. Concurrency optimisations are not small bets — they are big bets — and small bets without measurement are bad enough.

---

## What "Premature" Actually Means

"Premature" is doing work in the wrong order. Specifically: doing the optimisation step before the measurement step.

A non-premature optimisation cycle looks like this:

1. Write the obvious, readable code.
2. Make it correct (tests, race detector).
3. Profile under realistic load.
4. Identify the hot path — usually one function in the top three of the pprof output.
5. Optimise that function.
6. Re-measure. If faster, keep it. If not, revert.

A premature optimisation cycle skips steps 3 and 6. It looks like this:

1. Write what you guess will be fast.
2. Ship.
3. Discover the slow path is somewhere else entirely.

The diagnostic question is simple: **"How did I know to optimise this?"** If the honest answer is "I guessed" or "this pattern looked slow," the optimisation is premature. If the answer is "the pprof flame graph showed 40% of cpu in this function and a benchmark confirmed the change reduces it to 15%," it is not premature.

In concurrency, the same diagnostic test applies, with one addition: **"What contention does this primitive's fancier sibling solve, and is that contention present?"** `sync.RWMutex` solves writer-blocks-reader contention. If your workload has one writer per second and one reader per second, there is no contention to solve and `sync.RWMutex` is just a `sync.Mutex` with more code.

---

## The Benchmark-First Mantra

Write the benchmark before the optimisation. Not after. **Before.**

The mantra has four steps.

1. **Pick the metric.** ns/op for a hot function. Allocations/op for memory churn. Latency p99 for a service handler. Pick one and only one for the change.

2. **Write a `BenchmarkXxx`** in the same package as the code. It should call the function in a tight loop. It should not include setup time inside the timed region. It should be reproducible.

3. **Run it on the baseline.** Save the result to a file: `go test -bench=. -benchmem -count=10 > before.txt`.

4. **Apply the change. Re-run. Compare with `benchstat`.** If `benchstat before.txt after.txt` shows a statistically significant improvement, keep the change. If not, revert.

The whole loop is about ten minutes for a typical function. Ten minutes is shorter than the time it takes to argue about whether `sync.RWMutex` is faster, and the result is reproducible. Get into the habit.

---

## The "Is It Actually Faster?" Template

A reusable template for any concurrency-or-synchronisation change. Save it. Copy it into every package where you are tempted to optimise.

```go
package mypkg

import (
    "sync"
    "sync/atomic"
    "testing"
)

// BenchmarkBaseline is the obvious implementation.
func BenchmarkBaseline(b *testing.B) {
    var mu sync.Mutex
    var n int64
    b.ResetTimer()
    b.RunParallel(func(pb *testing.PB) {
        for pb.Next() {
            mu.Lock()
            n++
            mu.Unlock()
        }
    })
    _ = n
}

// BenchmarkOptimized is the "faster" version.
func BenchmarkOptimized(b *testing.B) {
    var n atomic.Int64
    b.ResetTimer()
    b.RunParallel(func(pb *testing.PB) {
        for pb.Next() {
            n.Add(1)
        }
    })
    _ = n.Load()
}
```

Run:

```
go test -bench=. -benchmem -count=10 -cpu=1,2,4,8 > before.txt
```

Then change something — drop a goroutine, swap mutex for atomic, remove a `sync.Pool` — and run again as `after.txt`. Compare:

```
benchstat before.txt after.txt
```

The result either justifies the change or it does not. There is no third option. The template's discipline is what installs the reflex.

---

## Why Concurrency Has Its Own Premature-Optimization Problem

General optimisation is mostly arithmetic: did this run faster, did it allocate less. Concurrency optimisation has three extra dimensions that make premature attempts more costly.

**Correctness risk.** A premature loop unroll cannot deadlock. A premature lock-free queue can. Premature concurrency is not just slower — it can be wrong in ways that show up only under load.

**Hardware variance.** Single-threaded benchmarks are stable across machines. Concurrent benchmarks vary with core count, NUMA topology, cache size, memory bandwidth, and whether the box is shared. "On my laptop, atomic is faster than mutex" is the most common wrong sentence in the language.

**Folklore overhang.** Concurrency advice on the internet is older than Go's runtime. People will tell you "mutex is slow," "lock-free is faster," "channels are the Go way," "RWMutex helps when there are many readers." Most of these are half-true and the other half is the dangerous half.

The defence against all three is identical: a `BenchmarkXxx`, a `benchstat`, and the willingness to revert.

---

## Example 1 — `go` for One-Shot CPU Work

You have a function that does a sub-microsecond computation. You think: "I'll fire off a goroutine and let it run in the background." Here is the comparison.

```go
package one

import (
    "math"
    "testing"
)

func compute(x float64) float64 {
    return math.Sqrt(x) * math.Sin(x)
}

// Baseline: just call the function.
func BenchmarkSequential(b *testing.B) {
    var sink float64
    for i := 0; i < b.N; i++ {
        sink = compute(float64(i))
    }
    _ = sink
}

// "Optimised": run it in a goroutine and wait.
func BenchmarkGoroutine(b *testing.B) {
    var sink float64
    for i := 0; i < b.N; i++ {
        done := make(chan struct{})
        go func(x float64) {
            sink = compute(x)
            close(done)
        }(float64(i))
        <-done
    }
    _ = sink
}
```

Typical numbers on a recent laptop (illustrative, your mileage will differ):

```
BenchmarkSequential-8    200000000     5 ns/op    0 B/op   0 allocs/op
BenchmarkGoroutine-8       1500000   850 ns/op   96 B/op   2 allocs/op
```

The goroutine version is roughly 170× slower and allocates on every call. The reason: spawning a goroutine costs hundreds of nanoseconds plus the channel allocation; the function takes 5 ns. You have asked the runtime to do a hundred nanoseconds of bookkeeping to save five nanoseconds of work. There is no version of "concurrency makes this faster" that wins here.

When is firing off a goroutine for one-shot work correct? When the work is *blocking* I/O that you want to overlap with other work, not CPU. The rule of thumb: if the unit of work is shorter than a goroutine spawn (~µs), do not spawn a goroutine for it.

---

## Example 2 — `sync.RWMutex` Where `sync.Mutex` Would Do

The internet says: "use `sync.RWMutex` when reads vastly outnumber writes." This is true in theory and misleading in practice. `sync.RWMutex` has more code in the lock and unlock paths than `sync.Mutex`. With low contention, the extra code is the dominant cost.

```go
package two

import (
    "sync"
    "testing"
)

var data = map[string]int{"a": 1, "b": 2, "c": 3}

func readWithMutex(mu *sync.Mutex, k string) int {
    mu.Lock()
    defer mu.Unlock()
    return data[k]
}

func readWithRWMutex(mu *sync.RWMutex, k string) int {
    mu.RLock()
    defer mu.RUnlock()
    return data[k]
}

func BenchmarkMutex(b *testing.B) {
    var mu sync.Mutex
    b.ResetTimer()
    b.RunParallel(func(pb *testing.PB) {
        for pb.Next() {
            _ = readWithMutex(&mu, "a")
        }
    })
}

func BenchmarkRWMutex(b *testing.B) {
    var mu sync.RWMutex
    b.ResetTimer()
    b.RunParallel(func(pb *testing.PB) {
        for pb.Next() {
            _ = readWithRWMutex(&mu, "a")
        }
    })
}
```

Typical: `Mutex` is faster on 1–4 cores. `RWMutex` starts to pull ahead only when the critical section is long enough (hundreds of nanoseconds inside the lock) AND when reader concurrency is high (8+ readers). For a map lookup that takes 30 ns inside the lock, `Mutex` wins on every realistic core count.

The correct rule: **default to `sync.Mutex`. Switch to `sync.RWMutex` only when you have a benchmark showing it helps your workload.** "Reads outnumber writes" is necessary but not sufficient.

---

## Example 3 — Atomic Where a Mutex Would Do (and Vice Versa)

Two common errors live here.

**Atomic where a mutex would do** is overusing `sync/atomic` for compound operations. `atomic.Int64` is genuinely fast for a single counter. It is *not* fast for "read the current value, decide based on it, write a new value" — that is a compare-and-swap loop and the loop can spin. A mutex with a 10-line critical section is often simpler and on contended workloads competitive.

```go
package three

import (
    "sync"
    "sync/atomic"
    "testing"
)

// Compound op: increment if below cap.
func incIfBelowCapAtomic(n *atomic.Int64, cap int64) bool {
    for {
        cur := n.Load()
        if cur >= cap {
            return false
        }
        if n.CompareAndSwap(cur, cur+1) {
            return true
        }
    }
}

func incIfBelowCapMutex(mu *sync.Mutex, n *int64, cap int64) bool {
    mu.Lock()
    defer mu.Unlock()
    if *n >= cap {
        return false
    }
    *n++
    return true
}
```

Under high contention the CAS loop in `incIfBelowCapAtomic` spins; threads keep retrying because `Load` and `CompareAndSwap` see stale values. The mutex version serialises cleanly. Benchmark on your workload before assuming "atomic = faster."

**Mutex where an atomic would do** is the reverse: using a mutex for a single counter. `atomic.Int64.Add(1)` is faster than `mu.Lock(); n++; mu.Unlock()` and simpler to read.

The rule: **single-value updates → atomic. Multi-step state changes → mutex.** Choose by structure of the operation, not by folklore.

---

## Example 4 — Sharding a Map Before Measuring Contention

A common move: "the map is hot, shard it 16 ways." The cost is real — code complexity, memory overhead per shard, hash function on every access — and the benefit only appears if there is real lock contention to spread.

```go
package four

import (
    "hash/maphash"
    "sync"
    "testing"
)

const shards = 16

type ShardedMap struct {
    seed   maphash.Seed
    shards [shards]struct {
        mu sync.Mutex
        m  map[string]int
    }
}

func NewShardedMap() *ShardedMap {
    s := &ShardedMap{seed: maphash.MakeSeed()}
    for i := range s.shards {
        s.shards[i].m = map[string]int{}
    }
    return s
}

func (s *ShardedMap) shard(k string) int {
    var h maphash.Hash
    h.SetSeed(s.seed)
    h.WriteString(k)
    return int(h.Sum64() % shards)
}

func (s *ShardedMap) Get(k string) int {
    i := s.shard(k)
    s.shards[i].mu.Lock()
    defer s.shards[i].mu.Unlock()
    return s.shards[i].m[k]
}

func (s *ShardedMap) Set(k string, v int) {
    i := s.shard(k)
    s.shards[i].mu.Lock()
    defer s.shards[i].mu.Unlock()
    s.shards[i].m[k] = v
}

type Simple struct {
    mu sync.Mutex
    m  map[string]int
}

func NewSimple() *Simple { return &Simple{m: map[string]int{}} }

func (s *Simple) Get(k string) int {
    s.mu.Lock()
    defer s.mu.Unlock()
    return s.m[k]
}

func (s *Simple) Set(k string, v int) {
    s.mu.Lock()
    defer s.mu.Unlock()
    s.m[k] = v
}

func BenchmarkSimple(b *testing.B) {
    s := NewSimple()
    s.Set("a", 1)
    b.ResetTimer()
    b.RunParallel(func(pb *testing.PB) {
        for pb.Next() {
            _ = s.Get("a")
        }
    })
}

func BenchmarkSharded(b *testing.B) {
    s := NewShardedMap()
    s.Set("a", 1)
    b.ResetTimer()
    b.RunParallel(func(pb *testing.PB) {
        for pb.Next() {
            _ = s.Get("a")
        }
    })
}
```

If every reader hits the same key, the sharded map gives you nothing — every reader still serializes on that shard's mutex. If readers spread across keys but you only have one or two CPUs, the contention to spread does not exist. Sharding wins only when (a) keys are diverse, (b) cores are many, and (c) the critical section is short enough that locking is a measurable share of the work. **Measure all three.**

Until you have, prefer `sync.Map` (which already shards-ish internally for a specific access pattern) or a plain `map[string]int` under a `sync.Mutex`.

---

## Example 5 — `sync.Pool` for Objects That Are Not Hot

`sync.Pool` is a per-P free list designed to reduce GC pressure for *frequently allocated* objects. The classic win is a buffer pool inside an HTTP handler that allocates and discards a `bytes.Buffer` on every request at thousands of requests per second. The classic loss is pooling something that is allocated twice a minute: you pay the pool's overhead (atomic ops, P-local lookup) and save almost nothing.

```go
package five

import (
    "bytes"
    "sync"
    "testing"
)

var bufPool = sync.Pool{
    New: func() any { return &bytes.Buffer{} },
}

func handleWithPool() int {
    b := bufPool.Get().(*bytes.Buffer)
    b.Reset()
    b.WriteString("hello, world\n")
    defer bufPool.Put(b)
    return b.Len()
}

func handleWithoutPool() int {
    var b bytes.Buffer
    b.WriteString("hello, world\n")
    return b.Len()
}

func BenchmarkPool(b *testing.B) {
    for i := 0; i < b.N; i++ {
        _ = handleWithPool()
    }
}

func BenchmarkNoPool(b *testing.B) {
    for i := 0; i < b.N; i++ {
        _ = handleWithoutPool()
    }
}
```

Two failure modes show up. First, if the buffer's `Reset` does not happen (a future maintainer forgets), data from the previous use leaks into the new one — a correctness bug. Second, if the workload allocates a buffer once and uses it for a long time, `sync.Pool` adds atomic ops on `Get` and `Put` for no allocation reduction.

The rule: **measure allocations per second of the object you are about to pool. If it is below ~100k/s, the pool probably loses.** Above that, prove it with a benchmark before merging.

---

## Example 6 — Channel-Based Actor Instead of a Mutex

The "channel actor" is a goroutine that owns some state and a channel that other goroutines send commands on. It is a beautiful pattern when ownership transfer is the right model (a worker pool, a connection multiplexer). It is the wrong pattern when you just want to protect a counter or a map.

```go
package six

import (
    "sync"
    "testing"
)

type CounterActor struct {
    ops chan op
}

type op struct {
    inc bool
    out chan int64
}

func NewCounterActor() *CounterActor {
    a := &CounterActor{ops: make(chan op)}
    go a.run()
    return a
}

func (a *CounterActor) run() {
    var n int64
    for o := range a.ops {
        if o.inc {
            n++
        }
        if o.out != nil {
            o.out <- n
        }
    }
}

func (a *CounterActor) Inc() {
    a.ops <- op{inc: true}
}

type CounterMutex struct {
    mu sync.Mutex
    n  int64
}

func (c *CounterMutex) Inc() {
    c.mu.Lock()
    c.n++
    c.mu.Unlock()
}

func BenchmarkActor(b *testing.B) {
    a := NewCounterActor()
    b.ResetTimer()
    b.RunParallel(func(pb *testing.PB) {
        for pb.Next() {
            a.Inc()
        }
    })
}

func BenchmarkMutex6(b *testing.B) {
    var c CounterMutex
    b.ResetTimer()
    b.RunParallel(func(pb *testing.PB) {
        for pb.Next() {
            c.Inc()
        }
    })
}
```

The actor pays a channel send and a goroutine wakeup on every increment. The mutex pays one atomic CAS. For a simple counter the mutex wins by an order of magnitude. The actor model has its place — but the place is "the work I am dispatching is bigger than the dispatch cost," not "I want to look Go-idiomatic."

The rule: **default to mutex for shared state. Use channels for transfer of ownership or for naturally pipelined work.**

---

## Example 7 — Lock-Free Instead of a Mutex

Lock-free data structures (Treiber stack, Michael-Scott queue) are real, are correct, and are the right answer for a small number of high-contention production cases (e.g. the Go runtime itself). They are almost never the right answer for application code. They are subtle, they require atomic primitives, they are easy to get wrong in the memory-ordering sense, and on x86/ARM with reasonable contention they often *underperform* a plain mutex because the CAS retry loop spins under contention while the mutex sleeps.

```go
package seven

import (
    "sync"
    "sync/atomic"
    "testing"
)

type stackNode struct {
    val  int
    next *stackNode
}

type LockFreeStack struct {
    head atomic.Pointer[stackNode]
}

func (s *LockFreeStack) Push(v int) {
    n := &stackNode{val: v}
    for {
        old := s.head.Load()
        n.next = old
        if s.head.CompareAndSwap(old, n) {
            return
        }
    }
}

type MutexStack struct {
    mu   sync.Mutex
    data []int
}

func (s *MutexStack) Push(v int) {
    s.mu.Lock()
    s.data = append(s.data, v)
    s.mu.Unlock()
}

func BenchmarkLockFreeStack(b *testing.B) {
    var s LockFreeStack
    b.ResetTimer()
    b.RunParallel(func(pb *testing.PB) {
        i := 0
        for pb.Next() {
            s.Push(i)
            i++
        }
    })
}

func BenchmarkMutexStack(b *testing.B) {
    var s MutexStack
    b.ResetTimer()
    b.RunParallel(func(pb *testing.PB) {
        i := 0
        for pb.Next() {
            s.Push(i)
            i++
        }
    })
}
```

Under 8 goroutines pushing as hard as they can, the lock-free version often loses to the mutex on x86. The CAS keeps failing as concurrent pushes invalidate each other; threads burn CPU spinning. The mutex parks losers — they sleep, they do not spin. **The runtime does this for you.** When you write your own lock-free structure you take that work back, and unless you also implement backoff (more code), the spin tax is real.

The rule: **use a mutex. If you genuinely need lock-free, build it once with help from someone who has done it before, benchmark it on production hardware, and own the consequences forever.**

---

## The Cost Side of the Ledger

Every optimisation has a cost. Concurrency optimisations have four:

1. **Code complexity.** More lines. Harder to read. Future maintainers slower.
2. **Correctness risk.** Each primitive has its own rules; each rule is one more way to introduce a bug.
3. **Maintenance debt.** When the function changes, the optimisation may stop applying. You will not notice until production tells you.
4. **Reviewability.** PRs that change concurrency primitives need careful review by someone who understands them. That is a scarce resource.

Premature optimisation pays all four costs and produces zero benefit. The cost ledger is what you owe before you have proven the benefit.

---

## When Concurrency Hurts — Small Problems

If the data fits in L1 cache and the algorithm is O(n) for n = a few thousand, sequential beats concurrent every time. The reason is the *fork cost* dominates: spawning goroutines, distributing work, synchronising results.

Concrete: summing a `[]int` of length 1000 with eight goroutines is slower than summing it with one goroutine. The summation is so fast (microseconds) that goroutine startup eats the budget.

The rule: **for in-memory operations under ~100 µs of single-threaded work, do not parallelise.** Above that, measure.

---

## When Concurrency Hurts — Already-Saturated CPU

If you are running on a machine where every core is already at 100% with other Go work, adding more goroutines does not give you more CPU. It gives you more scheduler overhead. The Go scheduler will round-robin between the goroutines, paying context-switch cost without producing more throughput. The throughput curve is flat above `NumCPU`; the latency curve climbs.

The rule: **if total CPU is already pinned, more goroutines hurt rather than help.** Diagnose with `top` or `pprof`. Cross-reference `14-performance-tuning` for the full sweep methodology.

---

## When Concurrency Hurts — Lock Contention Disguised as Parallelism

You parallelise, but inside every goroutine the first thing they do is acquire a shared mutex. Now `N` goroutines serialise on one lock and you have paid spawn cost for the privilege.

```go
func ParallelButNot(items []int) int {
    var mu sync.Mutex
    var total int
    var wg sync.WaitGroup
    for _, v := range items {
        wg.Add(1)
        go func(x int) {
            defer wg.Done()
            mu.Lock()
            total += x  // serial point inside parallel
            mu.Unlock()
        }(v)
    }
    wg.Wait()
    return total
}
```

This is slower than `for _, v := range items { total += v }`. The mutex is the bottleneck. Real parallelism requires *parallel work* — sum local subtotals, combine at the end. Or use `atomic.Int64.Add`. Or skip parallelism entirely.

The rule: **before parallelising, ask where the contention will be.** If every parallel branch needs the same lock, you have just rearranged the same sequential program with extra overhead.

---

## Reading a `testing.B` Result Honestly

```
BenchmarkXyz-8    1000000    1234 ns/op    32 B/op    1 allocs/op
```

Decompose:

- `BenchmarkXyz-8` — name and `GOMAXPROCS` (8 here).
- `1000000` — iterations the framework chose to run.
- `1234 ns/op` — nanoseconds per iteration.
- `32 B/op` — bytes allocated per iteration (with `-benchmem`).
- `1 allocs/op` — allocations per iteration.

Two readings that get juniors in trouble:

**Single-run results are noise.** `1234 ns/op` could be `1180` next time. Always use `-count=10` and `benchstat`.

**Allocations matter as much as ns/op.** An optimisation that drops ns/op by 10% while doubling allocations is usually a loss, because GC pause time is downstream of allocations.

---

## `benchstat` in Three Commands

Install:

```
go install golang.org/x/perf/cmd/benchstat@latest
```

Run baseline and capture:

```
go test -bench=. -benchmem -count=10 ./... > before.txt
```

Apply the change, run again:

```
go test -bench=. -benchmem -count=10 ./... > after.txt
```

Compare:

```
benchstat before.txt after.txt
```

Output looks like:

```
name        old time/op    new time/op    delta
Inc-8         35.2ns ± 2%     12.4ns ± 1%   -64.77%  (p=0.000 n=10+10)
```

The `p=0.000` is the statistical significance. If `p > 0.05`, the change is noise. **A change with `p > 0.05` should be treated as "no change" and reverted unless other reasons justify it (readability, simpler API).**

---

## The Three Numbers You Need Before Optimizing

Before reaching for any concurrency optimisation, write down:

1. **Baseline throughput or latency** of the function you are about to change. From a benchmark or a production trace.
2. **The target.** How much faster does it need to be? "Faster" is not a target. "p99 below 50 ms" is.
3. **The budget.** How much complexity are you willing to add? A 3× speedup might justify `sync.Pool`; a 5% one almost never does.

If you cannot fill in all three, you are about to optimise prematurely.

---

## Avoiding the "It Felt Faster" Trap

Humans are bad at estimating performance. The "felt faster" trap appears when an engineer:

- Reads a blog post saying "lock-free is faster."
- Applies it.
- The benchmark, if they wrote one, is single-threaded.
- They merge.
- Production is slower or unchanged.

Defences:

- Always write a parallel benchmark for concurrency changes (`b.RunParallel`).
- Always run on the production-sized core count, not your 8-core laptop.
- Always use `benchstat` — eyeballing two runs is statistically meaningless.
- Always be willing to revert.

---

## Reverting Optimizations That Did Not Pay Off

Reverting an optimisation is an *act of professionalism*, not failure. Code that does not pay for itself is overhead.

The script:

1. Commit the optimisation as a single, easily-reverted PR. Not mixed with refactors.
2. Land it behind a feature flag if possible.
3. Watch the metric that motivated it.
4. If after a week the metric did not move, revert.

This habit produces codebases where every optimisation has a *receipt*. New engineers can read the comments and the linked benchmarks and trust them.

---

## How to Write a Performance Comment

Whenever you commit an optimisation, leave a comment explaining the benchmark.

```go
// We use sync.Pool here because the buffer pool benchmark
// (BenchmarkRequestBuffer in handler_bench_test.go) showed
// -52% ns/op and -3 allocs/op vs the unpooled version under
// 100k req/s. If allocation patterns change, re-run the
// benchmark; if it no longer wins, prefer the simpler version.
var bufPool = sync.Pool{New: func() any { return new(bytes.Buffer) }}
```

This comment is worth more than the optimisation itself. It documents *why* the code is complex, *what* would make it not worth it, and *how* to verify. Without this comment, the optimisation is folklore in your codebase.

---

## Real-World Story — I Made My Code Lock-Free and Now It's Slower

A team I worked with had a hot-path queue in a request router. Every incoming request enqueued a job, every worker dequeued one. Profiles showed the queue's `sync.Mutex` as 8% of CPU. An engineer proposed switching to a Michael-Scott lock-free queue. The PR was 200 lines, used `atomic.Pointer`, included a memory-ordering comment that nobody understood, and the benchmark showed −15% ns/op on a 4-goroutine workload on the engineer's laptop.

Two weeks after deployment, p99 latency rose 25%. The engineering team rolled back. The post-mortem found three things.

First, the laptop benchmark used 4 goroutines; production used 64. Under 64-way contention the CAS retry loop on the lock-free version spun catastrophically.

Second, the original mutex version had been profiled at 8% of CPU **across all of the request path**, but profile attribution had assigned a lot of cache-miss time to the mutex incorrectly. The real bottleneck was a downstream RPC. The optimisation never touched the bottleneck.

Third, the lock-free version had a subtle ABA-window bug under hot pop/push patterns that did not show up in tests because tests ran at 4-way concurrency.

The fix was to revert to the mutex. Total cost of the episode: two engineer-weeks, one production incident, several hundred dollars of CPU due to spin overhead. The lesson the team adopted: every concurrency PR must show (a) a `benchstat` with `-cpu` matching production, (b) a profile demonstrating the function is actually the bottleneck, and (c) a feature-flag rollout plan.

The episode is not unique. Most teams have one. Yours will too if you do not install the discipline early.

---

## The Mantra in One Page

- **Simple first.** Write the obvious, readable version.
- **Measure.** Benchmark or profile under realistic load.
- **Optimise the hot path.** Only the top of the pprof list.
- **Prove it with `benchstat`.** Statistical significance, not eyeballs.
- **Comment the receipt.** Explain why the complexity exists.
- **Be willing to revert.** Reverting is normal, not failure.

Print it. Tape it to your monitor. It will save you more time than any concurrency trick.

---

## Common Junior Mistakes

- Reaching for `sync.RWMutex` because "reads outnumber writes," without measuring.
- Spawning goroutines for sub-microsecond CPU work and being surprised it is slower.
- Wrapping every counter increment in `atomic.Int64` when the field is updated once per request.
- Adding `sync.Pool` to a function that allocates one buffer per minute.
- Building a channel-actor for a counter.
- Reading "lock-free is faster" on the internet and writing one without measuring.
- Benchmarking on the laptop only.
- Single-run benchmarks. No `-count`. No `benchstat`.
- Optimising the wrong function — never profiled, just guessed.
- Refusing to revert a "clever" change when it did not pay off.

---

## Cross-References

- `14-performance-tuning/01-gomaxprocs/` — Tuning the scheduler before optimising user code.
- `14-performance-tuning/04-profiling-concurrent/` — How to find the *real* hot path with pprof.
- `03-sync-package/01-mutex/` — When `sync.Mutex` is enough.
- `03-sync-package/07-atomic/` — When `atomic` actually wins.
- `03-sync-package/06-pool/` — `sync.Pool` rules of thumb.
- `12-lock-free-programming/` — When lock-free is genuinely correct.
- `15-concurrency-anti-patterns/01-unlimited-goroutines/` — A related premature pattern: "go" everywhere.
- `15-concurrency-anti-patterns/06-sleep-for-sync/` — Another folklore concurrency mistake.

---

## Self-Assessment

You are ready to leave this page when you can answer all of the following without looking up:

- What does "premature" mean? What is the diagnostic question?
- Why is concurrency optimisation extra risky compared to single-threaded optimisation?
- Name three specific patterns where junior Go programmers reach for concurrency too early.
- For each pattern, what is the benchmark you would run to verify it helps?
- What does `benchstat` give you that eyeballing two runs does not?
- When would you accept a 5% slowdown for simpler code? When would you not?
- Walk through the lock-free queue story. What three things went wrong?

If any of these is fuzzy, re-read the relevant section.

---

## Summary

Premature concurrency optimisation is the most expensive folklore-driven mistake junior Go engineers make. It costs measurement-free, looks sophisticated, and is harder to revert than to introduce. The defence is small and boring: write the obvious version, write the benchmark, run `benchstat`, keep what wins, revert what does not, and comment the receipt.

Concurrency primitives — goroutines, `sync.Mutex`, `sync.RWMutex`, `atomic`, `sync.Pool`, channels, lock-free structures — are tools. They have specific workloads where they shine and broader workloads where they lose. The cure for "should I use this primitive?" is always the same: measure with the real workload on the real hardware and let the numbers decide.

Knuth's full quote includes the half people forget: "yet we should not pass up our opportunities in that critical 3%." Optimise. But find the 3% first. The rest of the book teaches you how.
