# Premature Concurrency Optimization — Middle Level

## Table of Contents
1. [Introduction](#introduction)
2. [Production Premature-Optimization Inventory](#production-premature-optimization-inventory)
3. [Sharding Too Soon — A Full Case Study](#sharding-too-soon--a-full-case-study)
4. [`sync.Pool` for Cold Objects — Why It Lost](#syncpool-for-cold-objects--why-it-lost)
5. [`sync.RWMutex` Regret — The Reader Path Got Slower](#syncrwmutex-regret--the-reader-path-got-slower)
6. [Atomic-vs-Mutex Under Real Load](#atomic-vs-mutex-under-real-load)
7. [The Profile-First Workflow](#the-profile-first-workflow)
8. [Building a Benchmark That Reflects Production](#building-a-benchmark-that-reflects-production)
9. [`-cpu` Matrix and Why You Need It](#-cpu-matrix-and-why-you-need-it)
10. [Allocation Profiles vs CPU Profiles](#allocation-profiles-vs-cpu-profiles)
11. [Backpressure Without a Channel-Actor](#backpressure-without-a-channel-actor)
12. [Migrating Off a Premature Optimization](#migrating-off-a-premature-optimization)
13. [Common Middle-Level Mistakes](#common-middle-level-mistakes)
14. [Self-Assessment](#self-assessment)
15. [Summary](#summary)

---

## Introduction

At junior level the lesson was the discipline: write the obvious version, benchmark before changing, prefer `sync.Mutex`. At middle level the work shifts to *applying that discipline in a real codebase*, where someone has already shipped sharded maps, `sync.Pool`s, `sync.RWMutex`es, and channel actors based on guesses. Your job is to (1) decide which ones to keep, (2) remove the ones that do not pay, and (3) install norms so that the next wave of premature optimisation does not happen.

By the end of this file you will:

- Recognise the production fingerprints of premature concurrency optimisation.
- Run profile-driven sweeps that decide whether a primitive deserves to stay.
- Refactor an over-sharded map, an under-used `sync.Pool`, and a needless `sync.RWMutex` back to their simpler forms — without breaking production.

---

## Production Premature-Optimization Inventory

Take a real Go service. Grep it. You will see, ordered by frequency:

```
$ grep -R "sync.RWMutex" --include="*.go" . | wc -l       # often dozens
$ grep -R "sync.Pool"    --include="*.go" . | wc -l       # often a handful
$ grep -R "atomic\\."    --include="*.go" . | wc -l       # often dozens
$ grep -R "shards\\["    --include="*.go" . | wc -l       # one or two clusters
$ grep -R "lock-free\\|LockFree" --include="*.go" . | wc -l  # rare, but loud
```

In the median Go service, the majority of `sync.RWMutex` uses are wrong. Two-thirds of `sync.Pool` uses have not been re-benchmarked since the original commit. Most of the `atomic` is fine because it is single-counter. The sharding clusters are sometimes warranted, sometimes not. The lock-free, if present, deserves a code review by an engineer who has actually written one.

This is the inventory you walk into. The next sections are case studies.

---

## Sharding Too Soon — A Full Case Study

A team had an in-memory cache for hot config keys, sharded 32 ways:

```go
type ConfigCache struct {
    shards [32]struct {
        mu sync.RWMutex
        m  map[string]string
    }
    seed maphash.Seed
}
```

The original commit message: "Sharded the cache to avoid lock contention." The benchmark in the PR was synthetic and ran on 8 cores. Production ran on pods with `cpu: 2`.

A `mutexprofile` showed cumulatively under 0.4% of process time waiting on any of the 32 shard mutexes. Most production keys were a small set ("region", "feature.X"), so reads concentrated on a handful of shards. The sharding spread no contention. It did, however:

- Add 32 map allocations.
- Add a hash computation on every access (`maphash.Hash{}` then `WriteString` then `Sum64`).
- Make iteration impossible without a custom walker.
- Add 80 lines of code that future engineers had to understand.

The team replaced it with one `sync.Map` and saw improvements: −12% ns/op on `Get` because the hash was no longer computed, less allocation, simpler code. The original "optimisation" had been a net loss for two years.

The lesson: **sharding is the last lever, not the first.** Profile contention first; if mutex wait time on the single-lock version is below 1% of process time, sharding is paying complexity for nothing.

---

## `sync.Pool` for Cold Objects — Why It Lost

Another team pooled a `*bytes.Buffer` in a code path that ran once per 30 seconds (a background metrics dumper). The pool was set up because "buffers are expensive."

A profile under realistic load showed:

- The dumper allocated one buffer per dump cycle. ~2 allocations per minute.
- The pool's `Get`/`Put` cost ~50 ns each.
- The unpooled version's `make([]byte, 0, 4096)` cost ~40 ns.

The pool was *slower than direct allocation* because pool overhead per call exceeded the cost of the allocation it was supposed to save. Worse, the pool kept a buffer alive across GC cycles, so the dumper held more memory than necessary.

The fix was a one-line revert: `var buf bytes.Buffer`. The pool came out. Allocations went up by an irrelevant amount, GC saw no change.

The rule formalised: **`sync.Pool` is for objects allocated >100k/s on hot paths. Below that, the pool's atomic ops dominate and you lose.** Cross-reference `03-sync-package/06-pool` for the underlying mechanism.

---

## `sync.RWMutex` Regret — The Reader Path Got Slower

A team observed slow reads on a cache. They had defaulted to `sync.RWMutex` because "reads are common." Profile showed `RLock`/`RUnlock` taking 60 ns combined per call, the underlying map lookup 20 ns. The lock was nearly the whole work.

They switched to `sync.Mutex`. Lock/Unlock dropped to 25 ns combined. Read latency improved.

How? Two reasons. First, on an uncontended path, `sync.Mutex` is faster than `sync.RWMutex` because it has less code: one atomic CAS on `Lock`, one atomic store on `Unlock`. `RWMutex` does more bookkeeping (reader counter, writer flag, semaphore arms). Second, the reader-counter increment is itself contended when many readers fire simultaneously; the cache line bouncing among CPUs costs more than the contention savings.

The rule: **prefer `sync.Mutex` unless your reader workload is heavy AND the critical section is long AND a benchmark on production-sized cores shows `RWMutex` wins.** All three. Cross-reference `03-sync-package/02-rwmutex` for the structure of `sync.RWMutex` itself.

---

## Atomic-vs-Mutex Under Real Load

The naive rule is "atomic for single values, mutex for compound." True, but under contention there is a third regime: when the work inside the critical section is short and contention is high, *mutex still wins* because the OS schedules waiters; atomic CAS-loops spin and burn CPU.

A practical experiment: a counter incremented from 64 goroutines:

```go
package m

import (
    "sync"
    "sync/atomic"
    "testing"
)

func BenchmarkAtomic(b *testing.B) {
    var n atomic.Int64
    b.ResetTimer()
    b.RunParallel(func(pb *testing.PB) {
        for pb.Next() {
            n.Add(1)
        }
    })
}

func BenchmarkMutex(b *testing.B) {
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
```

On 1 goroutine: atomic ~5 ns/op, mutex ~25 ns/op. Atomic wins.
On 8 goroutines: atomic ~15 ns/op, mutex ~40 ns/op. Atomic still wins.
On 64 goroutines on a 8-core box: atomic might be ~80 ns/op (CAS retries), mutex ~50 ns/op (waiters sleep). **Mutex wins under heavy contention.**

The interaction is non-obvious and platform-dependent. Always benchmark on production-sized contention. Cross-reference `03-sync-package/07-atomic` and `12-lock-free-programming/03-cas-loops`.

---

## The Profile-First Workflow

When somebody on your team says "we should add `sync.Pool`/`sync.RWMutex`/sharding/lock-free here," the workflow is:

1. **Profile.** `go test -cpuprofile=cpu.out -bench=.` or production pprof. Open with `go tool pprof`.

2. **Confirm the function is in the top three.** If `Lock`/`Unlock` is below 1% of CPU, the optimisation cannot pay back.

3. **Confirm the contention pattern.** A `mutexprofile` (`-mutexprofile=mu.out`) tells you wait time, not lock time. If wait time is low, no amount of sharding helps.

4. **Write a benchmark that mirrors the contention pattern.** Same goroutine count, same access distribution.

5. **Implement the optimisation. Re-benchmark. Use `benchstat`.**

6. **Roll out behind a feature flag.**

7. **Watch production metrics for a week.** If the metric did not move, revert.

Steps 1–3 catch most premature optimisations before they are written. Steps 4–7 catch the ones where the benchmark lied.

---

## Building a Benchmark That Reflects Production

A benchmark is not "code that runs the function in a loop." A *realistic* benchmark:

- Uses the same goroutine count as production (`b.SetParallelism(n)`).
- Uses the same access distribution (hot keys, cold keys, mix).
- Uses real-sized inputs (full requests, not "x").
- Resets timer after setup (`b.ResetTimer()`).
- Reports allocations (`b.ReportAllocs()` or `-benchmem`).

Anti-pattern:

```go
func BenchmarkGetWrong(b *testing.B) {
    c := NewCache()
    for i := 0; i < b.N; i++ {
        c.Get("a")  // same key, no contention, single goroutine
    }
}
```

Better:

```go
func BenchmarkGetRight(b *testing.B) {
    c := NewCache()
    keys := []string{"a", "b", "c", "d", "e", "f", "g", "h"}
    for _, k := range keys {
        c.Set(k, "v")
    }
    b.ResetTimer()
    b.ReportAllocs()
    b.RunParallel(func(pb *testing.PB) {
        i := 0
        for pb.Next() {
            _ = c.Get(keys[i%len(keys)])
            i++
        }
    })
}
```

The right benchmark exercises the real contention pattern. The wrong one declares victory before measuring.

---

## `-cpu` Matrix and Why You Need It

Single-`GOMAXPROCS` benchmarks lie about concurrency. Use `-cpu`:

```
go test -bench=. -benchmem -count=10 -cpu=1,2,4,8,16 > result.txt
```

`benchstat` then shows per-`GOMAXPROCS` numbers. A pattern like:

```
BenchmarkX-1     fast
BenchmarkX-2     fast
BenchmarkX-4     slower
BenchmarkX-8     slower
BenchmarkX-16    much slower
```

tells you contention dominates above some core count. That is the signal that *the contention exists* and an optimisation could help. The reverse pattern — flat from 1 to 16 — means there is no contention and there is nothing to optimise.

---

## Allocation Profiles vs CPU Profiles

A common confusion at middle level: profiles disagree.

`-cpuprofile` says function `F` is 10% of CPU.
`-memprofile` says function `F` is 60% of allocations.

These point at different optimisations. CPU profile suggests algorithm. Memory profile suggests `sync.Pool` or pre-allocation. **Choose by which dominates your service's pain.** If GC pause is the symptom, follow memory. If CPU is saturated, follow CPU.

Premature optimisation often applies one tool to the wrong profile: someone reads the CPU profile and adds `sync.Pool`, which would have helped the memory profile but does not move CPU.

---

## Backpressure Without a Channel-Actor

A common middle-level error: "I need backpressure, so I'll build a channel-actor." The channel-actor adds a goroutine, a channel, and a serialisation point. Often a `chan struct{}` semaphore is enough:

```go
sem := make(chan struct{}, 16)

func handle(req Request) {
    sem <- struct{}{}
    defer func() { <-sem }()
    // do work
}
```

This caps in-flight work at 16 without an extra goroutine. No actor needed. Cross-reference `15-concurrency-anti-patterns/01-unlimited-goroutines` for the broader pattern.

---

## Migrating Off a Premature Optimization

You inherited a sharded map you do not need. Steps to remove safely:

1. **Add a benchmark that exercises the cache** at production-sized concurrency.

2. **Branch and replace the sharded map with a `sync.Map` or a `sync.Mutex`-protected `map`.** Keep the same API; only internals change.

3. **Run the benchmark.** If the simpler version is within 5% of the sharded, merge the simpler version. (Equal performance with less code is a win.)

4. **Run integration tests.** Confirm behavioural identity.

5. **Land behind a feature flag** that defaults to the new version but can fall back.

6. **Watch production for a week.** Latency, allocations, error rate. If unchanged, remove the flag and delete the sharded code.

The migration takes a day or two of careful work for code that may have lived for years. The codebase ends lighter, faster to onboard, and easier to evolve.

---

## Common Middle-Level Mistakes

- Adding `sync.RWMutex` without a profile showing the writer ever blocks readers.
- Building a `sync.Pool` for objects allocated less than 1k/s.
- Sharding before contention is measurable in a mutex profile.
- Benchmarking on the laptop with `GOMAXPROCS=8` while production has `GOMAXPROCS=2`.
- Trusting a single benchmark run; not using `-count` and `benchstat`.
- Following CPU profile with a memory tool, or vice versa.
- Adding a channel-actor for what is a mutex problem.
- Refusing to revert a "clever" change that did not pay off.
- Forgetting that contention can shift across releases — yesterday's optimisation may be today's overhead.

---

## Self-Assessment

- Walk through how to decide whether a `sync.RWMutex` is justified.
- What is a mutex profile, and how is it different from a CPU profile?
- How would you migrate a sharded map back to a single mutex safely?
- Why does `-cpu=1,2,4,8` matter for concurrency benchmarks?
- Name three production-realistic causes of bench-vs-prod disagreement.

If any of these is unclear, re-read the case studies above.

---

## Summary

Middle-level engineers spend more time *removing* premature concurrency optimisations than adding new ones. The tooling is the same — profile, benchmark, `benchstat` — but applied to a codebase that already has decisions you did not make. The norm to install is simple: every concurrency primitive past `sync.Mutex` must come with a benchmark in the same PR and a comment explaining what made it justify the complexity. Without those, default to the simpler version.
