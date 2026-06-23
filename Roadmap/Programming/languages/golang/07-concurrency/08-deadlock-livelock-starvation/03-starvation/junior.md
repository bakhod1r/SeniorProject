# Starvation — Junior Level

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

> Focus: "What is starvation? Why does one of my goroutines never seem to run, even though it is alive and ready?"

A goroutine is **starving** when it is willing and able to make progress — it is not blocked on I/O, not waiting on a closed channel, not panicked — and yet it almost never actually gets to run. Some other goroutine, or some unfair acquisition rule, keeps stepping in front of it. From the outside the program looks healthy. Throughput is fine. The CPU graph is fine. But somewhere there is a goroutine that should be processing request number 7 and has been stuck behind requests 8, 9, 10, 11, and 12 for the last two seconds.

Starvation is not the same as **deadlock**: a deadlocked goroutine is blocked forever on a synchronisation primitive that will never fire. A starved goroutine *could* fire any moment — it just keeps losing the race.

Starvation is not the same as **livelock**: a livelocked goroutine is burning CPU executing a retry loop that never converges. A starved goroutine is usually waiting politely; the system is just not giving it a turn.

After reading this file you will:

- Know what starvation is and how to spot it in a Go program.
- Know the three classical sources of starvation: unfair locks, biased selects, scheduler unfairness.
- Have written a small program that reproduces lock-induced starvation.
- Know that `sync.Mutex` has a "starvation mode" since Go 1.9 that fixes most of the lock case.
- Know that `sync.RWMutex` can still starve writers under read-heavy load.
- Know that Go 1.14 added asynchronous preemption to stop a single tight loop from starving the rest of the program.
- Have a habit of looking at p99 latency, not just averages, when diagnosing throughput issues.

You do not yet need to know the bit layout of `sync.Mutex.state`, the GMP scheduler internals, or how to write your own anti-starvation priority queue. Those come in the middle, senior, and professional files. This file is about recognising starvation, building intuition for where it comes from, and using Go's built-in protections correctly.

---

## Prerequisites

- **Required:** A Go installation, version 1.18 or newer (1.21+ recommended). Check with `go version`.
- **Required:** You can write goroutines (`go f()`) and wait for them with `sync.WaitGroup`.
- **Required:** You have used `sync.Mutex` at least once to protect a shared variable.
- **Required:** You have used a `chan` and a `select` statement.
- **Helpful:** Awareness of deadlock — what it is and how the runtime detects "all goroutines are asleep".
- **Helpful:** Awareness of `runtime.GOMAXPROCS` and what a "P" is at a high level. Not required.

If `go run` works on your machine, you can compile a `main.go` with a mutex, and you have seen at least one `select { case <-ch1: ; case <-ch2: ; }`, you are ready.

---

## Glossary

| Term | Definition |
|------|-----------|
| **Starvation** | A condition where a goroutine is ready to run but is repeatedly passed over by the scheduler or by the synchronisation primitive it is waiting on. Progress is possible in principle but does not happen in practice. |
| **Fairness** | A property of a scheduler or lock saying that every waiter eventually gets a turn, in roughly the order they arrived. The opposite is *unfairness*. |
| **Starvation mode** (`sync.Mutex`) | A mode `sync.Mutex` enters when a waiter has been queued for more than 1 ms. In this mode the mutex stops giving the lock to newly arriving goroutines and hands it directly to the head of the wait queue. Introduced in Go 1.9. |
| **Reader-writer lock** | `sync.RWMutex`. Allows many concurrent readers or a single writer. Optimised for read-heavy workloads. |
| **Writer starvation** | A failure mode of reader-writer locks: under heavy read traffic, a writer never sees a moment when zero readers hold the lock, so it waits forever. |
| **Priority inversion** | A low-priority goroutine holds a lock that a high-priority goroutine needs. The high-priority goroutine waits behind the lower-priority one. |
| **Async preemption** | A Go runtime feature (1.14+) that lets the scheduler interrupt a running goroutine even when it never calls into the runtime. Before 1.14, a tight pure-CPU loop could starve every other goroutine sharing the same P. |
| **`select` bias** | The myth that a `select` with multiple ready cases picks "the first one". In Go, the pick is *pseudo-random*. Bias appears only when you write code that effectively favours one case (e.g., a non-blocking poll inside a loop). |
| **p99 latency** | The 99th-percentile latency: 1% of requests are slower than this number. The first place starvation shows up. |
| **Tail latency** | Latency at very high percentiles (p99, p99.9). Starvation typically does not change p50 but blows up the tail. |
| **Linux CFS** | The Completely Fair Scheduler in the Linux kernel. A reference design for fair scheduling, based on virtual runtime accounting. |

---

## Core Concepts

### 1. Starvation is "passed over forever, while progress is possible"

A goroutine `G` starves if there is some resource `R` (a mutex, a channel slot, CPU time on a P, a queue position) such that:

- `G` is waiting for `R` and is allowed to proceed when `R` becomes available.
- `R` becomes available many times.
- Every time `R` becomes available, some *other* goroutine — not `G` — is chosen to consume it.

This can go on forever in principle. In practice it eventually resolves (Go's mutex switches into starvation mode after 1 ms, the scheduler eventually rebalances), but in the meantime `G` has missed its deadline.

### 2. The three classical sources

1. **Unfair lock acquisition.** When a `sync.Mutex` is released, the OS may immediately schedule a fresh arriver who happens to be running on a CPU. That fresh arriver grabs the lock before the waiter that was politely parked in the wait queue. If new arrivers keep coming, the parked waiter never wakes up to a free lock. Go's runtime fights this with starvation mode.

2. **Biased channel select.** A `select` over many cases picks pseudo-randomly among the *ready* cases. If you write code that polls one channel repeatedly without ever waiting for the other to become ready, the other case can be starved. This is a code-shape problem, not a runtime problem.

3. **Scheduler unfairness.** If a goroutine on a P runs a tight loop with no function calls and no channel operations, on Go 1.13 and earlier it could prevent every other goroutine on the same P from running. Go 1.14 added asynchronous preemption to fix this; we will dig into it at the professional level.

### 3. A starved program is not a broken program

The most confusing thing about starvation is that the system *works*. Most goroutines complete. The race detector does not flag anything. `go vet` is silent. `go test -short` passes. The only signal is in latency distributions and in long-running soak tests.

### 4. Starvation has a natural enemy: fairness

The fix is always some form of **fairness**: a queue with FIFO ordering, a token rotation, a fairness rule in the lock, a periodic preemption, a priority adjustment that boosts the goroutine that has been waiting longest. Every cure you will see is some variant of "promote the loser".

---

## Real-World Analogies

### The supermarket queue with no rope barrier

A small supermarket has one counter and no rope barrier. Customers approach from any direction. The cashier serves whoever happens to be standing right in front of them at the moment they finish the previous transaction. If a steady stream of new customers keeps approaching from the right side, the person who has been politely waiting on the left side may never get to the counter. They are "waiting" — they are not in a queue, they are loitering. They could be served any moment. They never are.

That is `sync.Mutex` in normal mode without starvation protection: the goroutine that has been parked the longest can be passed over by the next walk-in who happens to be holding a CPU at the moment of release.

The fix Go added in 1.9 is the equivalent of installing a rope barrier and a "next please" rule: after a waiter has been waiting for 1 ms, the cashier ignores all walk-ins and serves whoever is at the head of the rope.

### The reader-writer dilemma at a library

Imagine a library where the catalogue can be either *read* by many people at once or *edited* by a single librarian who needs exclusive access. The catalogue is so popular that there is always at least one reader on it. The librarian, who needs to fix a typo, walks up and waits for "no readers". As long as readers keep arriving, that moment never comes. The librarian is **starving**.

Real-world libraries fix this by saying "after 9 a.m., when an editor is waiting, no new readers are admitted until the editor is done." That is the **writer-priority** policy. Go's `sync.RWMutex` implements something similar but not identical, and we will examine the exact rules later.

### The conference call with biased pickers

In a panel discussion the moderator says "I will let one of you speak now". Three panellists raise their hands. The moderator always picks the panellist on the left. The panellists in the middle and on the right will never speak.

This is `select` bias when the moderator is not actually fair. Go's `select` *is* fair (pseudo-random), but you can simulate the biased moderator by surrounding `select` with code that polls one channel non-blockingly far more often than the other.

---

## Mental Models

### "Who would notice if this goroutine vanished?"

Walk through your program and for each goroutine ask: if this one stopped making progress today, when would the symptom be visible? If the answer is "p99 latency would rise slightly" or "the warning email about stale data would arrive tomorrow", that goroutine is the most likely victim of starvation. It does not have a loud crash to fall back on.

### "Every concurrency primitive picks somebody — who?"

Whenever you write `mu.Lock()`, `<-ch`, `select { ... }`, or hand work to a worker pool, ask: when the primitive releases or fires, *who* does it pick from the set of eligible goroutines? Each primitive has a policy:

- `sync.Mutex` in normal mode: whoever grabs the CAS first (usually a fresh arriver on a hot CPU). In starvation mode: the head of the wait queue.
- `sync.RWMutex`: readers prefer to run together; a writer pending blocks new readers (read on, this is the key subtlety).
- A buffered `chan`: FIFO among senders, FIFO among receivers.
- An unbuffered `chan`: pseudo-random among the goroutines currently parked.
- `select` with multiple ready cases: pseudo-random among the ready cases.

You can predict the starvation risk of any piece of code by listing its primitives and answering "who does this pick?"

### "Fairness is about *queue position*, not about *intent*"

A scheduler is fair when the order it serves waiters matches the order they arrived. Most starvation bugs come from primitives that *don't* maintain a queue (or that don't always consult one). The fix is almost always "use the queue more often".

---

## Pros & Cons

> Starvation is a *problem*, not a feature. There are no "pros". This section discusses the pros and cons of the **anti-starvation mechanisms** themselves.

### Pros of forcing fairness

- **Predictable tail latency.** p99 becomes close to p50; outliers shrink.
- **Bounded wait time.** Every waiter is served within a known number of releases.
- **Easier to reason about.** "FIFO" is a much simpler mental model than "whoever wins the CAS".

### Cons of forcing fairness

- **Lower throughput in the common case.** A fair lock must always consult the queue, even when nobody is waiting. A naive fast-path CAS is faster.
- **Cache effects.** Handing the lock from goroutine A directly to goroutine B parked on a different P forces a cache-line transfer; an unfair "give it back to the same P" rule keeps the line hot.
- **Convoy effect.** Strict FIFO can serialise work that could have been parallelised, because every waiter inherits the slow waiter's behaviour.

Go's mutex tries to thread the needle: be fast and unfair in the common case, switch to slow and fair only when a waiter has been waiting long enough to be in real trouble.

---

## Use Cases

You will study starvation specifically when:

- A service has good average latency and bad p99 latency, and you have ruled out GC and network.
- A read-mostly cache fronted by `sync.RWMutex` exhibits stalls when the rare writer arrives.
- A worker pool draining a priority queue never processes low-priority items at all.
- A CPU-bound task on Go 1.13 or earlier appears to "freeze" the rest of the program.
- A distributed coordinator has nodes that never get elected leader.
- A scheduler-style application (job queue, request router) needs documented fairness guarantees.

You do *not* worry about starvation when:

- The system is single-threaded.
- Every goroutine completes its work in microseconds and there is no shared resource.
- All you care about is mean throughput and there is no SLA on the tail.

---

## Code Examples

### Example 1: A starvation race on `sync.Mutex` (pre-1.9 behaviour, modern mitigation)

```go
package main

import (
    "fmt"
    "sync"
    "time"
)

func main() {
    var mu sync.Mutex
    var greedyHits, victimHits int64

    var wg sync.WaitGroup

    // Greedy goroutines: lock, do a tiny amount of work, unlock, immediately try again.
    for i := 0; i < 10; i++ {
        wg.Add(1)
        go func() {
            defer wg.Done()
            for time.Since(start) < 200*time.Millisecond {
                mu.Lock()
                greedyHits++
                mu.Unlock()
            }
        }()
    }

    // Victim goroutine: also tries to take the lock in a loop, but it is fewer
    // of them and they have less momentum.
    wg.Add(1)
    go func() {
        defer wg.Done()
        for time.Since(start) < 200*time.Millisecond {
            mu.Lock()
            victimHits++
            mu.Unlock()
        }
    }()

    wg.Wait()
    fmt.Printf("greedy total: %d  victim total: %d\n", greedyHits, victimHits)
}

var start = time.Now()
```

On Go 1.9+ the victim still gets a fair share because the mutex switches into starvation mode whenever a waiter is parked for more than 1 ms. On older versions or in tighter test loops the victim's count would drop dramatically. The point of the example is to feel the *possibility* of starvation, then trust the runtime to mostly handle it.

### Example 2: RWMutex writer starvation

```go
package main

import (
    "fmt"
    "sync"
    "time"
)

type Cache struct {
    mu   sync.RWMutex
    data map[string]string
}

func (c *Cache) Get(k string) string {
    c.mu.RLock()
    defer c.mu.RUnlock()
    time.Sleep(100 * time.Microsecond) // simulate a real read
    return c.data[k]
}

func (c *Cache) Set(k, v string) {
    c.mu.Lock()
    defer c.mu.Unlock()
    c.data[k] = v
}

func main() {
    c := &Cache{data: map[string]string{"k": "v"}}
    var wg sync.WaitGroup
    stop := time.After(500 * time.Millisecond)

    // 100 readers hammering the cache.
    for i := 0; i < 100; i++ {
        wg.Add(1)
        go func() {
            defer wg.Done()
            for {
                select {
                case <-stop:
                    return
                default:
                    c.Get("k")
                }
            }
        }()
    }

    // One writer measuring how long it waits.
    wg.Add(1)
    go func() {
        defer wg.Done()
        for {
            select {
            case <-stop:
                return
            default:
                t := time.Now()
                c.Set("k", "v2")
                fmt.Printf("writer waited %v\n", time.Since(t))
                time.Sleep(50 * time.Millisecond)
            }
        }
    }()

    wg.Wait()
}
```

You will see writer waits ranging from microseconds to milliseconds. The writer is at the mercy of the readers releasing the lock together. Under enough read traffic, it can wait much longer than any individual reader.

### Example 3: Biased select

```go
package main

import (
    "fmt"
    "time"
)

func main() {
    fast := make(chan int, 1)
    slow := make(chan int, 1)

    // Always-ready producer for the fast channel.
    go func() {
        for {
            select {
            case fast <- 1:
            default:
            }
        }
    }()

    // Producer for slow that only sends once every 10 ms.
    go func() {
        for {
            time.Sleep(10 * time.Millisecond)
            select {
            case slow <- 1:
            default:
            }
        }
    }()

    stop := time.After(200 * time.Millisecond)
    fastCount, slowCount := 0, 0
    for {
        select {
        case <-stop:
            fmt.Printf("fast=%d slow=%d\n", fastCount, slowCount)
            return
        case <-fast:
            fastCount++
        case <-slow:
            slowCount++
        }
    }
}
```

The `select` is fair: when both `fast` and `slow` are ready, the runtime picks pseudo-randomly. The asymmetry comes from how often each channel is ready. `fast` is almost always ready, so it almost always gets picked. `slow` rarely is. If you only inspected average throughput you would conclude "select is biased". The lesson: *make sure the readiness rate matches your intent*.

### Example 4: A tight loop starving its neighbours (pre-1.14 behaviour)

```go
package main

import (
    "fmt"
    "runtime"
)

func main() {
    runtime.GOMAXPROCS(1)
    done := make(chan struct{})

    go func() {
        for i := 0; ; i++ {
            // Pre-Go 1.14, this loop never calls into the runtime, never
            // yields, and on GOMAXPROCS=1 it will hog the only P forever.
            _ = i * i
        }
    }()

    go func() {
        fmt.Println("hello from the other goroutine")
        close(done)
    }()

    <-done
    fmt.Println("done")
}
```

On Go 1.14+ the program prints both messages and exits. On 1.13 and earlier it would hang: the tight loop on the single P never gives way, and the second goroutine never runs. Async preemption is the cure, and we will look at it in detail at the professional level.

---

## Coding Patterns

### Pattern: Always prefer `sync.Mutex` until you measure a reason to use `sync.RWMutex`

`sync.Mutex` is fair enough for most workloads. `sync.RWMutex` is faster on read-heavy traffic but introduces writer-starvation risk. Use `RWMutex` only when:

- Reads outnumber writes by at least 10:1.
- Read critical sections are non-trivial (more than just a map lookup).
- You have measured contention on the plain Mutex.

If you switch to `RWMutex`, *measure the writer's p99 wait time*. If it gets worse, switch back.

### Pattern: Bounded queues, never unbounded ones

An unbounded queue with one consumer and many producers will eventually starve the consumer relative to the producers: producers always succeed, the queue grows, the consumer falls further behind. A bounded queue applies back-pressure to producers so the consumer always has a chance.

```go
q := make(chan Job, 100) // bounded, not "make(chan Job, 1_000_000_000)"
```

### Pattern: Use `time.Tick` or `context.WithTimeout` to bound waits

If you have a goroutine waiting on a select, give it a timer case so it knows when to give up or escalate:

```go
select {
case j := <-q:
    handle(j)
case <-time.After(50 * time.Millisecond):
    metrics.Inc("worker_starved")
}
```

The metric is the alarm. The first time you see it spike, you know somebody is starving.

### Pattern: For prioritised work, use anti-starvation policies, not raw priority

A pure priority queue starves low-priority items. Practical patterns:

- **Aging**: every N ms, raise the priority of items that have waited too long.
- **Weighted fair queueing**: each priority gets a guaranteed fraction of throughput.
- **Round-robin between buckets**: high-priority bucket served 4 times, then low-priority once.

We will implement these in [`tasks.md`](tasks.md).

---

## Clean Code

- Name the mutex after what it protects: `userMu sync.Mutex` next to `user *User`, not `mu1`.
- For `RWMutex`, name it the same way and document the read/write boundary in a comment.
- Keep critical sections short. The longer the section, the more goroutines pile up behind it, the easier starvation becomes.
- Do not call expensive functions inside a critical section (no `json.Marshal`, no I/O).
- Document your fairness assumptions: "this queue is FIFO", "this select is non-deterministic", "this lock may starve a writer under heavy read load".

---

## Product Use / Feature

When does starvation show up in a real product?

- **Search service with rare reindex**: 99% of requests are reads, but the daily index update needs an exclusive lock. Without anti-starvation, the reindex can stall for minutes.
- **Multi-tenant rate limiter**: a noisy tenant can starve quiet tenants if the limiter uses a single shared queue with no weighting.
- **WebSocket fan-out**: a slow consumer can starve the broadcaster if the channel buffer is too small and the broadcaster waits.
- **Background compaction in a storage engine**: foreground reads can starve the compactor.
- **Leader election**: a node with slightly worse network can never win a quorum and is permanently a follower.

The product instinct to develop: any time you have a class of work that runs rarely, ask "what stops it from being delayed forever?"

---

## Error Handling

Starvation rarely produces errors in the traditional sense. The Go runtime does not panic when a goroutine has been waiting too long. There is no `ErrStarved`.

Instead, **build your own signals**:

```go
type FairLock struct {
    mu      sync.Mutex
    waiters int64
}

func (l *FairLock) Lock(ctx context.Context) error {
    atomic.AddInt64(&l.waiters, 1)
    defer atomic.AddInt64(&l.waiters, -1)
    done := make(chan struct{})
    go func() {
        l.mu.Lock()
        close(done)
    }()
    select {
    case <-done:
        return nil
    case <-ctx.Done():
        // Can't actually cancel a parked sync.Mutex.Lock; would need a custom primitive.
        return ctx.Err()
    }
}
```

The pattern: pass a `context.Context` everywhere, time-bound your waits, surface "I have been waiting too long" as a regular error rather than a silent stall. We will cover real cancellation-aware locks at senior level.

---

## Security Considerations

Starvation has a darker name when it is intentional: **denial-of-service (DoS)**. An adversary who can submit work to your system can starve other users if your scheduler is unfair.

- A login endpoint that grabs a per-user lock without a timeout can be DoS'd by holding the lock from a slow connection.
- A worker pool with global FIFO can be DoS'd by submitting many heavy jobs.
- A rate limiter with one global token bucket can be DoS'd by one tenant.

Defences:

- **Per-tenant queues with weighted fairness.**
- **Hard timeouts on every wait.**
- **Maximum concurrent operations per tenant.**
- **Cost accounting**: measure work units consumed, not just request count.

---

## Performance Tips

- The default `sync.Mutex` is *fast* and *mostly fair*. Reach for it first.
- `sync.RWMutex` is only a win on read-heavy workloads with *non-trivial* read critical sections. For a single map lookup it is often slower than a plain `Mutex` due to extra atomics.
- Avoid `sync.Mutex` for high-frequency, very-short critical sections; prefer `sync/atomic` or `sync.Map` when applicable.
- Avoid `select` with one almost-always-ready case if you want fairness. Wrap it: poll, then `runtime.Gosched()`, then poll again — or restructure to use a separate goroutine.
- Profile with `runtime/pprof` block and mutex profiles. The mutex profile shows where goroutines wait the longest.

---

## Best Practices

1. **Measure tail latency.** p50 lies; p99 tells the truth.
2. **Use `context.Context` for all waits.** No `select` without a cancellation case in long-running services.
3. **Bound your queues.** Apply back-pressure on the producer instead of letting the consumer fall behind.
4. **Document fairness assumptions.** A line of comment is cheaper than an outage.
5. **Test with realistic ratios.** A 50/50 reader/writer test will not surface RWMutex writer starvation; a 99/1 test will.
6. **Use the race detector** during development. It does not catch starvation directly, but it catches the race conditions whose fixes often introduce starvation by accident.
7. **Don't optimise for the common case at the expense of the tail.** Most users see p50. Power users, automated tests, and angry customers see p99.

---

## Edge Cases & Pitfalls

- **A `sync.Mutex` parked goroutine is not cancellable.** Once `Lock()` enters the wait queue, no `context.Cancel()` or signal will pull it out. If you need cancellation, you must build a custom primitive or use channels.
- **`runtime.Gosched()` is a hint, not a guarantee.** It can help break a tight CPU loop in older Go versions, but on 1.14+ it is rarely necessary.
- **`sync.RWMutex` does not guarantee writer priority.** It tries to prevent new readers from starving a pending writer, but the exact rules are subtle. See middle.md.
- **GOMAXPROCS=1 amplifies every scheduler-level fairness issue.** Always test with at least GOMAXPROCS=runtime.NumCPU().
- **A channel can starve readers if you write `default` in a select.** `default` runs immediately when no other case is ready, so the read case never gets a chance to wait.

---

## Common Mistakes

1. **Using `sync.RWMutex` everywhere because "more is better".** Cost: extra atomics, writer starvation, no measurable win on short critical sections.
2. **Treating `select` as ordered.** Cases are pseudo-random when multiple are ready. Code that assumes "first listed wins" is broken.
3. **An unbounded queue between producer and consumer.** Eventually the producer outpaces the consumer; the system stays "up" but memory grows and latency explodes.
4. **A spin-loop with `default` in a select.** Burns CPU and starves whatever else is on the same P.
5. **A priority queue without anti-starvation.** Low-priority items wait forever.
6. **Forgetting to release a lock in an early-return branch.** This is deadlock-prone but can also masquerade as starvation: the lock is "available" but actually held by a goroutine that returned without unlocking.

---

## Common Misconceptions

> "Go's mutex is unfair."

Half-true. `sync.Mutex` is unfair in *normal mode* (it gives the lock to whoever wins the CAS, often a fresh arriver) but switches to a fair *starvation mode* after any single waiter has been parked for 1 ms. The result is a hybrid that is fast in the common case and fair in the worst case.

> "I should always use `sync.RWMutex` because most of my code reads."

False. `RWMutex` has extra overhead (more atomics, more state) that often makes it *slower* than `sync.Mutex` for short critical sections. Also, it can starve writers. Measure before switching.

> "`select` cycles through its cases."

False. `select` picks pseudo-randomly among the ready cases. There is no rotation, no priority among cases, no left-to-right preference.

> "If a goroutine is starving, I can fix it with `runtime.Gosched()`."

Rarely. `Gosched` is a hint to the scheduler to consider running someone else. Since Go 1.14, the scheduler already preempts running goroutines asynchronously. `Gosched` is mostly a legacy tool.

> "Starvation will produce a deadlock detector message."

False. The deadlock detector fires only when *all* goroutines are asleep. A starved goroutine is sleeping while others run; the detector is silent.

---

## Tricky Points

- A `sync.Mutex.Lock` call that finds the lock free and acquires it via CAS does *not* check the wait queue. This is intentional and is the source of "unfairness in normal mode".
- `sync.Mutex` in starvation mode disables the CAS fast path; every `Lock` call enters the slow path and consults the queue.
- After `Unlock` in starvation mode, the lock is handed *directly* to the head of the wait queue — there is no race for it.
- `sync.RWMutex.RLock` may block if a writer is pending, even though the lock is technically held only by readers. This is the runtime trying to prevent writer starvation.
- The `runtime.Gosched` hint can actually *increase* contention if used too often: every yield is a chance for someone else to grab the lock you were about to take.
- A channel with one slow consumer and many producers does not technically starve the consumer; it provides back-pressure to the producers. Starvation here means the *system* is misallocating resources, not that a particular goroutine is stuck.

---

## Test

Three exercises. Try them before reading the answers in `tasks.md`.

1. Write a program with two goroutines repeatedly locking the same `sync.Mutex`. Count how many times each one acquires the lock over 100 ms. The counts should be roughly equal. If they aren't, propose an explanation.

2. Build a `Cache` like in Example 2 but vary the read critical section duration from 1 µs to 1 ms. Plot writer wait time. Above which read duration does writer starvation become severe?

3. Implement a simple bounded queue using `chan` and a goroutine pool of 4 workers. Submit 1000 jobs from a single producer. Then submit jobs at a rate that exceeds what the workers can handle. Show how the producer slows down (back-pressure) instead of the workers being starved.

---

## Tricky Questions

1. **Why does Go's mutex have an unfair fast path? Why not just always be fair?**

Because the fast path is the hot path. Most lock acquisitions are uncontended or barely contended. A fair lock forces every acquire to check a queue; an unfair fast path is a single CAS. Go chooses to be unfair until a waiter starts suffering, then it forces fairness for *that waiter* and only that waiter.

2. **Can a goroutine starve indefinitely on `sync.Mutex` in modern Go?**

In practice no. The starvation-mode mechanism guarantees that no waiter stays parked more than about 1 ms beyond the lock's contention level. The waiter at the head will be served on the next Unlock in starvation mode.

3. **Can a writer starve on `sync.RWMutex`?**

Yes. The Go implementation tries to prevent it by blocking *new* readers once a writer is pending, but if existing readers stay in the critical section a long time, the writer can wait arbitrarily long.

4. **Why does Go's `select` use pseudo-random selection?**

To avoid bias. A deterministic policy (first listed, round-robin, etc.) makes some patterns prone to starvation. Pseudo-random selection gives every ready case the same expected service rate.

5. **What changed in Go 1.14 that helps with starvation?**

Asynchronous preemption. Before 1.14, a goroutine running a tight pure-CPU loop with no function calls would never yield to the scheduler, starving every other goroutine on the same P. Since 1.14, the runtime sends a signal to such goroutines to force a preemption point.

---

## Cheat Sheet

```
            STARVATION QUICK REFERENCE

PRIMITIVE          DEFAULT POLICY          STARVATION RISK         MITIGATION
sync.Mutex         CAS race + queue        Pre-Go 1.9 only         starvation mode (auto)
sync.RWMutex       Reader-pref, w-hint     Writer under read load  measure; cap readers
chan (buffered)    FIFO                    None for senders/recvs  bounded buffer
chan (unbuffered)  Pseudo-random           Low                     none needed
select             Pseudo-random           Code-shape bias         restructure cases
GMP scheduler      Work-stealing + AP      Pre-Go 1.14 tight loops 1.14+ async preempt
worker pool        FIFO via chan           Low-priority starves    aging / WFQ
priority queue     by priority             Low-prio starves        aging / multi-level

DIAGNOSE
- pprof block / mutex profiles
- p99 latency, not mean
- runtime/metrics: /sync/mutex/wait/total:seconds
- export waiter counts as metrics

CURE
- bound every wait with context.Context
- bound every queue
- measure RWMutex writer p99 explicitly
- prefer plain Mutex for short critical sections
- batch reads to free RWMutex for writers
```

---

## Self-Assessment Checklist

- [ ] I can define starvation in one sentence.
- [ ] I can name three sources of starvation in a Go program.
- [ ] I know that `sync.Mutex` has a starvation mode added in 1.9.
- [ ] I know that `sync.RWMutex` can starve writers.
- [ ] I know that `select` is pseudo-random, not ordered.
- [ ] I know that pre-1.14 Go could starve goroutines via tight loops; 1.14+ fixes this.
- [ ] I can write a test that reproduces RWMutex writer starvation.
- [ ] I read `pprof` block and mutex profiles and act on them.
- [ ] I use `context.Context` to bound every wait in a long-running service.
- [ ] I monitor p99 latency, not just mean throughput.

---

## Summary

Starvation is the absence of progress for a single goroutine while the system as a whole keeps moving. It is the quietest concurrency failure: the system "works" but the unlucky goroutine is forever a step behind. Go fights starvation with two big mechanisms — `sync.Mutex`'s starvation mode (1.9+) and asynchronous preemption (1.14+) — and several smaller policies in the scheduler and channel runtime. You fight starvation with bounded queues, fair worker pools, anti-starvation priority schemes, context-aware waits, and a habit of measuring tail latency.

The next file, `middle.md`, dives into `sync.Mutex` starvation mode and `sync.RWMutex` writer starvation in implementation detail. `senior.md` walks through scheduler-level starvation and priority inversion. `professional.md` opens the runtime sources and explains the exact bit-level state changes that prevent starvation in modern Go. `interview.md` collects the questions an interviewer is likely to ask, and `tasks.md` / `find-bug.md` / `optimize.md` are the practice problems.

---

## What You Can Build

After this file you can:

- Build a worker pool that does not starve its consumers under bursty producer load.
- Write a cache fronted by `sync.RWMutex` and validate writer wait time under load.
- Add a metric "longest waiter" to any custom queue and alert on it.
- Identify a `select` whose readiness rates implicitly bias one case and rebalance it.
- Defend an API endpoint against intentional starvation (DoS) with timeouts and per-tenant queues.

---

## Further Reading

- Russ Cox, "Go runtime: 4 years later" — section on async preemption.
- Dmitry Vyukov, "Go 1.9 sync.Mutex starvation mode" — design notes (golang/go issue #13086).
- `src/sync/mutex.go` — the canonical source. Read it. It is 250 lines and remarkably readable.
- `src/sync/rwmutex.go` — note the `readerCount` sign bit trick used for writer pending.
- "The Linux CFS Scheduler" — short description; useful for contrast with Go's M-P-G model.
- "Tail at Scale", Dean & Barroso, CACM 2013 — the canonical paper on tail latency in distributed systems.

---

## Related Topics

- **Deadlock** (sibling section): all goroutines stuck. Compare with starvation: one goroutine stuck.
- **Livelock** (sibling section): all goroutines busy but no progress. Compare with starvation: most goroutines progressing.
- **Mutexes** (`07-concurrency/03-sync-package/01-mutexes`): the implementation of starvation mode lives here.
- **RWMutex** (`07-concurrency/03-sync-package/02-rwmutex`): the primary source of writer starvation in Go.
- **Channels** (`07-concurrency/02-channels`): chan-based fairness, select semantics.
- **Scheduler** (`07-concurrency/05-scheduler`): the GMP model and async preemption.
- **Context** (`07-concurrency/07-context`): how to bound waits and surface starvation as cancellation.

---

## Diagrams & Visual Aids

### A starved goroutine in time

```
 time  ----[A]--[A]--[A]--[A]--[A]--[A]--[A]--[A]--[A]--[A]----->
 A     run  run  run  run  run  run  run  run  run  run  run
 B    wait wait wait wait wait wait wait wait wait wait wait
```

A is running constantly, B is waiting constantly. Both want the same resource. B is starving.

### Mutex normal vs starvation mode

```
NORMAL MODE                          STARVATION MODE
+-----------+                        +-----------+
| arriving  |--CAS-->LOCKED          | arriving  |--park-->QUEUE
+-----------+                        +-----------+
                                                  ^
+-----------+                                     |
|   queued  |--park (loses race)                  |
+-----------+                        +-----------+
                                     |   queued  |--direct hand-off
                                     +-----------+
```

In normal mode the queued waiter races with arrivers and loses. In starvation mode the queued waiter is given the lock directly; arrivers must queue.

### RWMutex writer starvation

```
readers ->|R|R|R|R|R|R|R|R|R|R|R|R|R|...
writer  ->                                     |W?| (waiting)
                                                |W?| (still waiting)
                                                 |W?| (still waiting)
```

A continuous stream of overlapping readers means there is never a moment with zero active readers. The writer never sees a window to acquire.

### Async preemption (1.14+) versus tight loop

```
Pre-1.14:
  P:  [TIGHT LOOP----------------------------------->]
       (other goroutines on this P never run)

1.14+:
  P:  [TIGHT LOOP--][G1][TIGHT--][G2][TIGHT--][G3]...
                ^ signal-driven preempt point
```

Continue to [middle.md](middle.md) for `sync.Mutex` starvation-mode internals and `sync.RWMutex` writer starvation under read-heavy load.
