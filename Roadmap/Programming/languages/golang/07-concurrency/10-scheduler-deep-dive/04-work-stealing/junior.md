# Work Stealing — Junior Level

## Table of Contents
1. [Introduction](#introduction)
2. [Prerequisites](#prerequisites)
3. [Glossary](#glossary)
4. [Core Concepts](#core-concepts)
5. [Real-World Analogies](#real-world-analogies)
6. [Mental Models](#mental-models)
7. [Pros & Cons](#pros--cons)
8. [Use Cases](#use-cases)
9. [Code Examples](#code-examples)
10. [Coding Patterns](#coding-patterns)
11. [Clean Code](#clean-code)
12. [Product Use / Feature](#product-use--feature)
13. [Error Handling](#error-handling)
14. [Security Considerations](#security-considerations)
15. [Performance Tips](#performance-tips)
16. [Best Practices](#best-practices)
17. [Edge Cases & Pitfalls](#edge-cases--pitfalls)
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
29. [Diagrams & Visual Aids](#diagrams--visual-aids)

---

## Introduction

Imagine a small office with eight workers. Each worker has a personal in-tray of paperwork. New paperwork arrives unevenly: one tray fills up, four trays are half full, three trays are empty. The empty-tray workers have a choice. They can sit and wait for the manager to redistribute work — slow, because the manager is busy. They can ask the manager every few seconds for new work — wasteful. Or they can stand up, walk to a colleague with a full tray, and quietly take half of it back to their own desk.

That third option is work stealing. It is also, almost exactly, how the Go scheduler keeps every CPU core busy.

Go's runtime keeps one queue of runnable goroutines per CPU (per `P`, in scheduler vocabulary). Goroutines are pushed onto the queue of the P that ran the `go func()` statement. So if one worker goroutine spawns a thousand children, those thousand children all land on the same local queue. Without intervention, seven other Ps would idle while one P drained the pile. Work stealing prevents that: each idle P, instead of going to sleep, first walks over to a randomly chosen busy P and helps itself to half the queue. The result is a system that self-balances without any central coordinator and where new work created anywhere becomes visible everywhere within microseconds.

This page introduces the algorithm. We will name the concepts, show the pseudocode used inside `findRunnable` (the runtime function that decides "what does this M run next?"), and build the mental model you need to read every later page in this section. No source code spelunking is required at this level — that comes in middle.md and senior.md.

---

## Prerequisites

You should already be comfortable with:

- The G-M-P model: goroutines, Ms (OS threads), Ps (logical processors). If unsure, read `10-scheduler-deep-dive/01-gmp-model/junior.md` first.
- `GOMAXPROCS`: the number of Ps. Default is the number of logical CPUs.
- The idea of a runqueue: a FIFO of runnable goroutines waiting for CPU time.
- Why goroutines are cheap: 2 KB initial stack, millions per process, scheduled in user space.
- A vague notion of why one global queue would be slow: every CPU fighting for the same lock.

You do not need to know how to read `runtime/proc.go`, what `nmspinning` is, or how `runqsteal` is implemented. Those come below or in later levels.

---

## Glossary

| Term | Meaning |
|---|---|
| **LRQ** | Local Run Queue. A bounded (capacity 256) FIFO of runnable goroutines owned by one P. |
| **GRQ** | Global Run Queue. An unbounded linked list of runnable goroutines shared by all Ps. |
| **P** | Processor. The scheduler's logical CPU. Each holds one LRQ. |
| **M** | Machine. An OS thread. Runs goroutines on behalf of a P. |
| **G** | Goroutine. A unit of work the scheduler dispatches. |
| **Victim P** | The P chosen at random to be stolen from. |
| **Thief P** | The P doing the stealing. |
| **`findRunnable`** | The runtime function an M calls when it needs work. |
| **`runqsteal`** | The function inside `findRunnable` that actually moves goroutines between LRQs. |
| **Spinning M** | An M that is actively burning CPU looking for work to steal. |
| **`nmspinning`** | A counter of how many Ms are currently spinning. |
| **`wakep`** | The runtime function that ensures at least one spinning M is alive when new work is created. |
| **`injectglist`** | The runtime function that adds a list of new runnable goroutines back into the system. |
| **Netpoll** | The runtime's wrapper around `epoll`/`kqueue`. Wakes goroutines blocked on network I/O. |
| **Idle P** | A P with no goroutines on its LRQ and no M currently bound. |
| **Half-steal** | Taking ceil(N/2) goroutines from a victim's LRQ, where N is the victim's queue size. |
| **Work conservation** | The property that no P is ever idle while another P has runnable work. |

---

## Core Concepts

### The problem: uneven queues

Picture four Ps, each with its own LRQ. A goroutine on P0 calls a hot loop that spawns 200 children: `for i := 0; i < 200; i++ { go work(i) }`. All 200 children land on P0's LRQ. P1, P2, P3 have empty queues. Without work stealing, four scenarios are possible:

1. P0 runs all 200 itself — 4× slower than necessary, three CPUs idle.
2. P0 pushes children onto a global queue — every push takes a global lock, contention is bad.
3. P0 round-robins children onto neighbours' LRQs — needs cross-P writes which require synchronisation.
4. P1, P2, P3 each take a few from P0 themselves — work stealing.

Option 4 is what Go chose. The cost of synchronisation is paid by the *thief*, not the *producer*. The producer (P0) writes to its own LRQ with no atomic operations at all; the LRQ is single-producer-single-consumer from the producer side. The thieves use atomic CAS to pull from the head of P0's LRQ. Producers stay fast; idle Ps pay the synchronisation tax only when they need work.

### The algorithm at a glance

When an M loses its current goroutine (the G yielded, blocked, or exited), the M calls `findRunnable`. That function follows a fixed checklist:

```
1. Check our own P's LRQ. If non-empty, pop a G. Done.
2. Check the global runqueue (sched.runq). If non-empty, pop a G. Done.
3. Check netpoll for ready network goroutines. If any, run them.
4. Pick a random victim P. Try to steal half its LRQ. If successful, pop a G. Done.
5. Repeat step 4 up to four times across all Ps.
6. Re-check the global runqueue (something may have arrived).
7. Park the M.
```

The order matters. Local first (zero synchronisation), global second (one lock acquisition), netpoll third (one syscall), steal last (multiple atomic operations and CPU burn). The cheapest source of work is always tried first.

### Why "half"?

The classic Cilk paper proved that stealing half is asymptotically optimal. Take fewer than half and the victim still has too much work; the thief comes back too quickly and the synchronisation cost dominates. Take more than half and the victim runs dry too soon and *becomes* a thief, doubling the cost. Half is the sweet spot.

Concretely, if the victim has 8 Gs, the thief takes 4. If the victim has 1 G, the thief takes 1 (you cannot take half of one — Go takes `ceil(N/2)`). If the victim has 0 Gs, the thief moves on to the next candidate.

### Spinning Ms

When new work is created (a `go` statement runs and pushes onto an LRQ), the runtime wants the work to start running *quickly*. Waking a parked M costs ~1 ms (it requires a futex wakeup syscall). One millisecond is forever in scheduler time. So the runtime keeps a small number of Ms in a "spinning" state: actively running, burning CPU, calling `findRunnable` in a loop.

When a goroutine is created, the runtime calls `wakep`. If a spinning M is already alive, `wakep` does nothing — the spinning M will find the new work within a microsecond. If no spinning M is alive, `wakep` either starts a new spinning M (if one is parked) or, as a last resort, signals the futex.

The counter `nmspinning` tracks how many Ms are spinning. The invariant: while any P has work, at least one M should be spinning. This keeps latency low.

---

## Real-World Analogies

### Restaurant kitchen with stations

Picture a kitchen with four stations. Each chef has a personal order ticket spike. Orders arrive at whichever chef calls them out. When a chef clears their spike, instead of asking the manager for more, they walk to the chef with the tallest spike and pull half the tickets back. The chef being stolen from continues working without interruption — they did not have to hand anything over consciously. The thief paid the cost of walking across the kitchen.

This is exactly work stealing. The cost of redistribution is paid by the chef who has time (the thief), not by the chef who is busy (the victim).

### Library returns

A library has a row of returns slots. When a slot fills up, a librarian rolls a cart up and removes half. Slot owners do not need to interrupt their work to redistribute books. The librarian (the thief) drives the redistribution.

### Highway tollbooths

Cars (goroutines) pull into whichever tollbooth (P) they prefer. If one tollbooth has a long queue and another is empty, you would hope the empty tollbooth's attendant could pull cars from the back of the long queue. That is, conceptually, a thief stealing from the tail. Go does the same: thieves take goroutines from the head of the victim's queue while the victim's own M pushes onto and pops from the tail.

### Two-headed water bucket

LRQs are conceptually a deque (double-ended queue). The owner uses one end; thieves use the other. Imagine a bucket with two spouts: the owner drinks from the bottom, the thieves pour from the top. They almost never collide.

---

## Mental Models

### The "find work" decision tree

When an M needs a goroutine to run, picture a decision tree:

```
Need work
   |
   v
LRQ empty?  no -> pop local, done
   | yes
   v
GRQ empty?  no -> pop global, done
   | yes
   v
Netpoll ready? yes -> grab netpoll Gs, done
   | no
   v
Try stealing from random P
   |
   +-- victim has Gs? yes -> steal half, done
   |
   +-- no victim found after 4 rounds -> park M
```

The deeper you go in the tree, the more synchronisation you pay for. Local LRQ pop is essentially free. Stealing involves a CAS per item moved. Parking involves a futex syscall.

### The "spinning ring"

Imagine a small ring of Ms permanently rotating around the Ps, peeking into each LRQ. If they see work, they grab. If they see nothing across all Ps, they park. New work created anywhere on the ring is visible to the next M to peek — usually within a few hundred nanoseconds.

The ring has limited capacity. The runtime allows at most `GOMAXPROCS/2` (roughly) Ms to spin simultaneously. More than that and the CPU cost outweighs the latency saving.

### Producer cheap, consumer pays

LRQ design lets the producer push without atomics (the P's own M is the only producer to its own tail). The consumer (a thief) uses atomic CAS to pull from the head. The asymmetric design is fast for the common case (producer keeps pushing) and pays cost only when stealing is actually needed.

### Why random victim selection

If every thief always tried P0 first, P0 would be a hotspot of contention. By choosing the victim at random, the load is spread. Random selection is also resilient: if P0 happens to be empty when this thief looks, the thief moves on to a random P; there is no cascading failure.

---

## Pros & Cons

### Pros

- **Self-balancing without a coordinator.** No central queue, no manager goroutine. Each P balances itself.
- **Producer-fast.** The owner of an LRQ pushes without atomics. Goroutine creation is ~5-10 ns.
- **Scales linearly.** Adding more Ps adds more LRQs and more thieves. No central bottleneck.
- **Cache-friendly.** A goroutine usually runs on the P that created it (good for L1/L2 locality). Stealing only occurs when it must.
- **Low latency for new work.** Spinning Ms see new pushes within a microsecond.
- **Theoretically near-optimal.** Cilk's proof: work stealing achieves T_∞ + T_1 / P speedup, within a constant factor of ideal.

### Cons

- **CPU burn from spinning.** Spinning Ms use CPU even when idle. Hidden cost on battery-powered devices.
- **Steal cost is not zero.** A steal costs a few hundred nanoseconds — measurable in microbenchmarks.
- **Random selection can be unlucky.** A thief may try four empty victims before finding work.
- **LRQ has a fixed cap.** When the LRQ fills (capacity 256), half the queue overflows to the GRQ. The overflow path is slower.
- **Hard to reason about.** Debugging "why did this G not run for 50 ms?" requires understanding `findRunnable`.
- **Not work-conserving under pathological churn.** In rare cases (very fast park/unpark cycles) a P may briefly idle while another has work in flight.

---

## Use Cases

Work stealing is built into the scheduler — you do not opt in. Every Go program benefits. But the use cases where it matters most:

- **Recursive parallelism.** A function spawns children, each child spawns more. The naive layout would stack work on one P. Stealing redistributes.
- **Bursty producers.** An HTTP handler spawns 50 goroutines for a fan-out query. The handler's P would be saturated; stealers pull from it.
- **Pipeline stages with uneven work.** Stage 1 produces fast, stage 2 is slow. The stage-2 worker goroutines, spread across Ps, get stolen to fill idle Ps.
- **Worker pools with `runtime.NumCPU()` workers.** All workers initially land on the spawning P. Stealing redistributes them across all Ps within microseconds.

You will *feel* work stealing in tests like:

```go
func BenchmarkParallel(b *testing.B) {
    b.RunParallel(func(pb *testing.PB) {
        for pb.Next() {
            // work
        }
    })
}
```

`b.RunParallel` spawns `GOMAXPROCS` goroutines on the calling P. They steal-spread within nanoseconds, and the benchmark reports near-linear speedup.

---

## Code Examples

### Observing work stealing in a trace

```go
package main

import (
    "os"
    "runtime/trace"
    "sync"
)

func main() {
    f, _ := os.Create("trace.out")
    defer f.Close()
    trace.Start(f)
    defer trace.Stop()

    var wg sync.WaitGroup
    for i := 0; i < 1000; i++ {
        wg.Add(1)
        go func() {
            defer wg.Done()
            // tiny CPU burn
            for j := 0; j < 1000; j++ {
                _ = j * j
            }
        }()
    }
    wg.Wait()
}
```

Run, then:

```
go tool trace trace.out
```

In the "Goroutines" or "Procs" view, you will see that all 1000 goroutines were initially queued on the main goroutine's P, then quickly spread across all Ps. The "Procs" timeline shows each P picking up goroutines. The spread is work stealing in action.

### Forcing visible stealing

```go
package main

import (
    "fmt"
    "runtime"
    "sync"
    "sync/atomic"
    "time"
)

var perProc [16]atomic.Int64

func main() {
    runtime.GOMAXPROCS(4)
    var wg sync.WaitGroup

    // Spawn 8000 short-running Gs from one goroutine.
    // They should land on the spawning P's LRQ initially.
    for i := 0; i < 8000; i++ {
        wg.Add(1)
        go func() {
            defer wg.Done()
            // Read GOMAXPROCS-local P via a side channel.
            // (No public API; use runtime.LockOSThread + thread-local proxy.)
            time.Sleep(1 * time.Millisecond)
        }()
    }
    wg.Wait()

    for i := 0; i < 4; i++ {
        fmt.Printf("P%d ran %d Gs\n", i, perProc[i].Load())
    }
}
```

Without work stealing, P0 would run all 8000. With it, you will see roughly 2000 each. The exact distribution depends on the order of stealing.

### A worker pool that stress-tests stealing

```go
package main

import (
    "runtime"
    "sync"
    "sync/atomic"
)

func main() {
    procs := runtime.NumCPU()
    n := 1_000_000

    var counter atomic.Int64

    var wg sync.WaitGroup
    work := make(chan int, n)

    // Producer
    go func() {
        for i := 0; i < n; i++ {
            work <- i
        }
        close(work)
    }()

    for i := 0; i < procs; i++ {
        wg.Add(1)
        go func() {
            defer wg.Done()
            for v := range work {
                _ = v
                counter.Add(1)
            }
        }()
    }
    wg.Wait()
}
```

All `procs` workers start on the goroutine that spawned them. They steal-spread, and each P gets one worker pinned (mostly). Work stealing happens once; channel `work` then drives the rest.

---

## Coding Patterns

### Pattern 1: fan-out with `errgroup`

```go
import "golang.org/x/sync/errgroup"

func process(items []Item) error {
    g, ctx := errgroup.WithContext(context.Background())
    for _, it := range items {
        it := it
        g.Go(func() error {
            return doWork(ctx, it)
        })
    }
    return g.Wait()
}
```

`g.Go` calls a `go func()`. All calls happen on the spawning P, so the first `len(items)` Gs queue locally. Work stealing then redistributes them. You do not need to load-balance manually.

### Pattern 2: bounded worker pool

```go
type Pool struct {
    jobs chan func()
    wg   sync.WaitGroup
}

func NewPool(n int) *Pool {
    p := &Pool{jobs: make(chan func(), n*2)}
    for i := 0; i < n; i++ {
        p.wg.Add(1)
        go func() {
            defer p.wg.Done()
            for j := range p.jobs {
                j()
            }
        }()
    }
    return p
}
```

The `n` workers spawn on the same P. They steal-spread once. After that, the channel does the load balancing. You get both: work stealing for goroutine placement, channel for job distribution.

### Pattern 3: parallel `for` over a slice

```go
func parallelFor(items []int, fn func(int)) {
    var wg sync.WaitGroup
    for _, it := range items {
        it := it
        wg.Add(1)
        go func() {
            defer wg.Done()
            fn(it)
        }()
    }
    wg.Wait()
}
```

Simple and idiomatic. For up to a few thousand items, this is fine. For millions, batch the work to avoid per-item goroutine overhead — but the work stealing still does the load balancing.

---

## Clean Code

The work-stealing scheduler is invisible to user code. There is no API for it. "Clean code" with respect to work stealing means writing code that does not *fight* the scheduler:

1. **Do not pin to OS threads unnecessarily.** `runtime.LockOSThread` makes a G unstealable. The whole M sits idle while the G waits.
2. **Do not spawn one goroutine per item for trivial work.** If `fn` takes 100 ns, the goroutine overhead is 1000 ns. Batch instead.
3. **Do not assume goroutines stay on the spawning P.** They do not. Code that relies on per-P caches must use `runtime/internal/sys.Getg` style tricks, which are unstable.
4. **Use channels for inter-goroutine communication, not shared mutable state.** Work stealing means a G's identity migrates across Ps; cache lines bounce; locks contend.
5. **Prefer one-shot goroutines over long-running daemons for short tasks.** The scheduler can rebalance a one-shot G the moment it parks. A long-running daemon on one P never gets rebalanced.

---

## Product Use / Feature

Work stealing is fundamental to every Go-based product. Concrete examples:

- **HTTP servers (net/http, gin, echo).** Each connection is a goroutine. Bursty traffic queues on one P; stealing spreads it.
- **Database drivers (pgx, mongo-go-driver).** Query execution spawns parser/scanner goroutines. Stealing balances them.
- **Stream processors (Kafka consumers, NATS subscribers).** Each message handler is a goroutine. Stealing keeps all cores busy.
- **Build tools (the `go` command itself).** `go build -p N` runs N package compilations in parallel via goroutines. Stealing balances dependency-chain leaves.
- **Test runners (`go test -parallel`).** Parallel tests are goroutines. Stealing distributes them.

In every case, the product author wrote `go fn()` and trusted that the scheduler would do the right thing. Work stealing is what makes that trust justified.

---

## Error Handling

Work stealing itself does not have an error path. It cannot fail. The only way to "lose" work is:

- A G is leaked (parked forever, never woken). Not a stealing bug — a programming bug.
- A G is locked to an M via `LockOSThread`. Stealers will skip it. This is by design.
- A G is in a cgo call. The G is not on any LRQ; it is associated with an M that is in C code. Stealers do not touch it.

If you suspect a goroutine is not making progress and you have ruled out the above, the bug is unlikely to be in the scheduler. The bug is almost always in your code: a deadlock, a missed channel close, a `select` with no default that should have had one.

The only "error" the scheduler reports is the deadlock panic:

```
fatal error: all goroutines are asleep - deadlock!
```

This fires when *every* goroutine in the program is parked. It is not specific to work stealing — it just means there is no work to steal anywhere.

---

## Security Considerations

Work stealing is not exposed to user code. There is no API to call. From a security viewpoint:

- **No DoS vector via stealing.** A malicious goroutine cannot starve others by manipulating its placement. The scheduler decides.
- **No information leak.** Stealing does not expose memory across Ps; the only shared state is the LRQ pointers, all in the runtime address space.
- **Side-channel timing.** Stealing introduces small timing variations in when a G runs. In cryptographic code, this is one of *many* sources of timing variation. Use constant-time primitives, not "schedule predictably."
- **`LockOSThread` for security boundaries.** When a G uses OS-thread-specific state (e.g., `seccomp`, `setns`, `prctl`), it must call `LockOSThread`. Stealers cannot move the G to another OS thread, so the security context is preserved.

---

## Performance Tips

1. **Trust the scheduler for general parallel work.** Do not implement your own work-stealing on top.
2. **Avoid `runtime.LockOSThread` unless required.** It opts out of stealing.
3. **Reduce goroutine count when work is tiny.** Each goroutine is cheap but not free. Batch.
4. **Keep CPU-bound work CPU-bound.** A G that calls a syscall detaches from its P; stealers cannot help. Use `golang.org/x/sync/semaphore` to cap concurrency.
5. **Watch the GRQ.** If your code creates work via `time.AfterFunc` or other paths that push to the GRQ, you may bottleneck on `sched.lock`. Use per-shard timers instead.
6. **Use `GOMAXPROCS` to bound parallelism.** Setting it lower than CPU count reduces stealing churn at the cost of throughput.
7. **Profile with `go tool trace`** to see how many steals are happening. If you see hundreds of thousands per second, your producers are very bursty and you may benefit from explicit sharding.

---

## Best Practices

- Let the scheduler do the work. Resist the urge to "help" by pinning goroutines to specific Ps.
- Spawn goroutines liberally. The runtime is tuned for high goroutine churn.
- Use channels and `sync.WaitGroup` to coordinate, not shared mutable state.
- Trust `findRunnable` to find work; do not write busy loops to "wait for work" in user code.
- For latency-sensitive tasks, accept that work stealing may add a few microseconds of jitter. Measure rather than speculate.

---

## Edge Cases & Pitfalls

### LRQ overflow

When a P's LRQ has 256 entries and another G is pushed, the runtime moves half the LRQ to the GRQ to make room. This is `runqputslow` (covered in middle.md). The GRQ is slower (requires `sched.lock`), so a producer that pushes thousands of Gs in a tight loop may cause overflow churn.

Mitigation: rare. Most workloads do not push more than 256 Gs from a single P faster than they are consumed.

### `LockOSThread` and stealing

A G with `LockOSThread` cannot be moved. Its M cannot run anything else. Stealers see the G but skip it (because `gp.lockedm != 0`). This is correct but wasteful if used carelessly.

### Long-running Gs and stealing

A G that does not yield (no function call, no channel op, no syscall) cannot be preempted to allow stealing. Before Go 1.14, this could starve other Gs. Since Go 1.14, async preemption signals the M and forces a reschedule.

### Stealing across cgo

A G in a cgo call is not on any LRQ. The M running the cgo is detached from its P; the P can be picked up by another M. The G itself comes back to a runqueue when cgo returns.

### Stealing during GC

The GC mark workers are themselves goroutines. They are stealable like any other. During STW (stop-the-world), no stealing happens because all Gs are parked.

---

## Common Mistakes

1. **Assuming goroutines stay on the spawning P.** They do not. Code like `var localCache map[int]int` accessed by "the worker on P0" is meaningless; the worker can migrate.
2. **Pinning a long-running G to an OS thread for "speed."** `LockOSThread` is *slower*, not faster, unless you need OS-thread-specific state.
3. **Creating one goroutine per microsecond of work.** The goroutine overhead dwarfs the work. Batch.
4. **Polling for work in a `for {}` loop.** This consumes a P. Use channels and let the runtime park you.
5. **Manually load-balancing with a per-P hash.** The runtime already does this. Your hash will be wrong (the G migrates anyway).
6. **Disabling preemption with `runtime.LockOSThread` and then doing a long loop.** You have starved every other G on this M. (Note: stealers can take *other* Gs from your P's LRQ, but the locked G hogs the M.)

---

## Common Misconceptions

1. **"Work stealing is round-robin."** No. The victim is chosen at random.
2. **"The scheduler picks a victim based on queue depth."** No. The runtime does not maintain a sorted list of queue depths — that would require constant atomic updates. Random + half-steal is empirically near-optimal.
3. **"Stealing is only for idle Ps."** Mostly true, but a P about to park always re-checks via `findRunnable`; this includes stealing.
4. **"Spinning Ms waste CPU."** They burn it on purpose. The CPU cost is small (one or two Ms spinning); the latency saving (no futex wakeup) is large.
5. **"Larger LRQ would be better."** Larger LRQ means fewer overflow events but also more memory and worse cache behaviour. 256 is the runtime's tuned compromise.
6. **"Stealing is free."** Each stolen G costs a CAS on the victim's LRQ — a few tens of nanoseconds. Plus the cost of running the thief's `findRunnable` loop.

---

## Tricky Points

### Why ceil(N/2) and not floor(N/2)?

If the victim has 1 G, floor(1/2) = 0 — the thief takes nothing and moves on. The G stays put. If a chain of thieves all see this, the G never moves. Ceil(1/2) = 1 — the thief takes the G. Now the G is at the thief, which then runs it.

### When a thief is also a producer

An M can be both a thief (just got a stolen G) and immediately a producer (the stolen G spawns more). The new Gs go onto the thief's P's LRQ. So the *new* P is now the producer. Other thieves may now steal from here. The system equilibrates.

### Why not steal more than half?

Cilk's analysis shows: with half-steal, the expected number of steals to balance is O(P log N) where P is processor count and N is total work. With less-than-half, more steals are needed; with more-than-half, the *victim* runs dry and *becomes* a thief, doubling churn. Half is the proven sweet spot.

### Spinning vs sleeping

A spinning M holds no P. It rotates among Ps looking for work. A sleeping M is parked on a futex. The runtime maintains "at least one spinning M while any P has work" to keep latency low. When all Ps are idle, all Ms can sleep — no wasted CPU.

### The `sched.runq` (GRQ) bypass

For Gs created by `time.AfterFunc`, runtime timers, or other paths that do not have a "current P," the runtime pushes directly to the GRQ. Stealers check the GRQ in step 2 of `findRunnable`, before stealing from LRQs. This ensures timer-fired work is never starved.

---

## Test

A self-test on work stealing:

1. What is the difference between LRQ and GRQ?
2. In what order does `findRunnable` check sources of work?
3. What is "half-steal" and why is it half?
4. Why is the victim P chosen at random?
5. What does a "spinning M" do?
6. What is `nmspinning`?
7. When is `wakep` called?
8. Why is the producer's push to its own LRQ atomic-free?
9. What is `injectglist`?
10. Why does `LockOSThread` interact with stealing?
11. What happens when an LRQ fills to 256?
12. What is the approximate cost (in nanoseconds) of one steal?
13. What is the runtime's strategy when all Ps are empty?
14. Where does work stealing's name come from?
15. Why doesn't the scheduler use a single global queue?

Answers are in the rest of this section.

---

## Tricky Questions

### Q1: If I `runtime.GOMAXPROCS(1)`, is there any work stealing?

No. With one P, there is no other P to steal from. The single P drains its own LRQ. The GRQ is still checked but is rarely populated in single-P mode.

### Q2: Can a goroutine be stolen *while* it is running?

No. A "stolen G" is one taken from an LRQ — i.e., a *runnable but not running* G. Once running, the G is on the M's `curg` slot and not on any LRQ. To move a running G to another P, the runtime would have to first deschedule it (which it does via preemption, not stealing).

### Q3: What is the priority order: LRQ, GRQ, or netpoll?

Strict order: LRQ first (cheapest, no lock), GRQ second, netpoll third, then steal. The runtime occasionally reorders for fairness — every 61st `schedule()` call checks the GRQ first to prevent starvation. But normal order is LRQ → GRQ → netpoll → steal.

### Q4: How many goroutines can be stolen in one go?

Up to half the victim's LRQ, capped at 128 (half of 256). In practice, a few to a few dozen.

### Q5: What if two thieves target the same victim?

They both attempt CAS on the LRQ's head index. One wins, takes its half. The other sees an updated head, takes half of what's left. Both succeed (with degraded yield for the second).

### Q6: Does work stealing help with I/O-bound workloads?

Indirectly. I/O-bound Gs park on netpoll, freeing the M to find other work via stealing. Work stealing keeps the CPU busy with whatever other Gs are runnable.

### Q7: Why not use `epoll` for goroutine readiness?

`epoll` is for file descriptors. Goroutine readiness is much faster than a syscall — it's a memory write to an LRQ. The runtime uses `epoll` *inside* itself (via the netpoller) but not for goroutine scheduling.

### Q8: Can I disable work stealing?

No public API. Setting `GOMAXPROCS=1` effectively disables stealing because there is only one P. There is a runtime flag `GODEBUG=schedtrace=1000` that lets you observe but not disable stealing.

### Q9: How does work stealing handle a `runtime.Gosched`?

`Gosched` pushes the current G onto the *back* of its local LRQ and calls the scheduler. The G can then be stolen by another P if its current P picks up a different G first. So `Gosched` does *not* prevent migration — it actively enables it.

### Q10: Why is the LRQ a circular array rather than a linked list?

Cache locality. A 256-slot array fits in 2 KB and stays warm in L1 cache. A linked list would have pointer chasing and unpredictable memory access. The cost is the cap; the benefit is speed.

---

## Cheat Sheet

```
LRQ           : per-P, capacity 256, FIFO (mostly)
GRQ           : global, linked list, sched.lock
findRunnable  : LRQ -> GRQ -> netpoll -> steal -> park
steal         : ceil(N/2) from random victim
spinning M    : actively searches for work, no P held
nmspinning    : count of spinning Ms
wakep         : ensure a spinning M while work exists
injectglist   : push a list of Gs back into the system
GOMAXPROCS    : number of Ps; bounds CPU parallelism
LockOSThread  : opts G out of stealing
sched.runq    : global runqueue (GRQ)
runqsteal     : actual LRQ-to-LRQ move
```

Key numbers:
- LRQ capacity: 256
- Steal fraction: ceil(N/2)
- Steal attempts before parking: 4 rounds × P-1 victims
- Spinning M cap: roughly GOMAXPROCS/2
- Cost of one steal: a few hundred ns

---

## Self-Assessment Checklist

After reading this page, you should be able to:

- [ ] Explain in plain English why work stealing exists.
- [ ] Sketch the seven steps of `findRunnable` from memory.
- [ ] Define LRQ, GRQ, spinning M, `nmspinning`, `wakep`.
- [ ] State why the steal fraction is exactly half.
- [ ] State why victim selection is random.
- [ ] List the conditions under which a G cannot be stolen.
- [ ] Estimate the cost (order of magnitude) of one steal.
- [ ] Describe the role of `injectglist`.
- [ ] Explain why producers do not pay synchronisation cost.
- [ ] Identify which problems work stealing solves and which it does not.

If three or more of these are uncertain, re-read the relevant sections.

---

## Summary

Work stealing is the Go scheduler's load-balancing strategy. Each P keeps a local runqueue (LRQ) of up to 256 runnable goroutines. When an M's P runs out of work, the M calls `findRunnable`, which checks local LRQ, then global runqueue (GRQ), then netpoll, then steals half of a random victim P's LRQ. The "half" comes from the classic Cilk paper, where it was proven asymptotically optimal. To keep latency low, a small number of Ms run in a "spinning" state, actively searching for work; the `nmspinning` counter tracks them, and `wakep` ensures one is alive whenever there is work. The producer's path through `go func()` writes its own LRQ with no atomics — fast. The thief's path uses CAS on the victim's LRQ — slow but only when needed. The result is a self-balancing M:N scheduler that scales near-linearly with CPU count and recovers from bursty producers within microseconds.

The next level (middle.md) walks through the actual `findRunnable` flow with pseudocode close to the runtime source, introduces the spinning-M details and the `injectglist` mechanism, and gives concrete numbers.

---

## What You Can Build

With a junior-level understanding of work stealing, you can:

- Build a simple worker pool that relies on the scheduler for balance (no manual sharding).
- Build a fan-out/fan-in pipeline that scales to all cores.
- Debug "why is my parallel program slow?" by running `go tool trace` and reading the P timeline.
- Explain to a colleague why their `for _, x := range xs { go work(x) }` is actually fine for thousands of items.
- Write benchmarks that demonstrate near-linear scaling with `b.RunParallel`.
- Read scheduler trace events (`GoCreate`, `GoStart`, `ProcStart`) and interpret which P each G runs on.

---

## Further Reading

- Robert D. Blumofe and Charles E. Leiserson, *Scheduling Multithreaded Computations by Work Stealing*, JACM 46(5), 1999. The classic Cilk paper. Required reading.
- Dmitry Vyukov, *Scalable Go Scheduler Design Doc*, 2012. The design document for the Go 1.1 scheduler rewrite. Available at `golang.org/s/go11sched`.
- Go source `src/runtime/proc.go`. Functions `findRunnable`, `runqsteal`, `wakep`.
- `src/runtime/HACKING.md`. Runtime invariants.
- Go 1.1 release notes. The first appearance of work stealing in the Go scheduler.
- *The Tokio scheduler* — Tokio's blog series on its Rust runtime. Tokio uses work stealing modelled on Go's design.
- Morsing, *The Go scheduler*, 2013 blog post. An early introduction with diagrams.

---

## Related Topics

- `10-scheduler-deep-dive/01-gmp-model` — the G-M-P triangle that work stealing operates on.
- `10-scheduler-deep-dive/02-preemption` — how long-running Gs are forced to yield so stealers can rebalance.
- `10-scheduler-deep-dive/03-gomaxprocs-tuning` — `GOMAXPROCS` sets the number of Ps and bounds stealing.
- `10-scheduler-deep-dive/05-syscall-handling` — how syscalls detach Ps so stealers can pick them up.
- `01-goroutines/02-vs-os-threads` — why Go schedules in user space at all.
- `09-channel-internals/02-runtime-behavior` — channels are how stolen Gs often get woken.

---

## Diagrams & Visual Aids

### The work-stealing flow

```
        Idle P (P1)                Busy P (P0)
   ┌──────────────────┐       ┌──────────────────┐
   │   LRQ: empty     │       │   LRQ: [G G G G  │
   │                  │       │         G G G G] │
   │   M1 calls       │       │                  │
   │   findRunnable() │       │                  │
   └────────┬─────────┘       └──────────────────┘
            │
            │ 1. own LRQ empty
            │ 2. GRQ empty
            │ 3. netpoll empty
            │ 4. pick random victim → P0
            │
            ▼
   ┌──────────────────┐       ┌──────────────────┐
   │   LRQ: [G G G G] │  ←──  │   LRQ: [G G G G] │
   │                  │       │                  │
   │   half stolen    │       │   half remaining │
   └──────────────────┘       └──────────────────┘
   M1 runs first stolen G.    P0's M continues with its half.
```

### `findRunnable` decision tree

```
              ┌──────────────────────┐
              │  M needs a G to run  │
              └──────────┬───────────┘
                         │
              ┌──────────▼───────────┐
              │ Local LRQ has work?  │── yes → pop, return
              └──────────┬───────────┘
                         │ no
              ┌──────────▼───────────┐
              │ Global runq has work?│── yes → pop, return
              └──────────┬───────────┘
                         │ no
              ┌──────────▼───────────┐
              │ Netpoll has ready Gs?│── yes → run them, return
              └──────────┬───────────┘
                         │ no
              ┌──────────▼───────────┐
              │ Try to steal × 4     │── success → return
              │ from random victims  │
              └──────────┬───────────┘
                         │ no work anywhere
              ┌──────────▼───────────┐
              │  Park the M          │
              └──────────────────────┘
```

### Spinning Ms over time

```
Time →
       0ms       5ms       10ms      15ms      20ms
P0:    busy ──── busy ──── busy ──── busy ──── busy
P1:    busy ──── busy ──── busy ──── busy ──── busy
P2:    idle      busy ──── busy ──── busy ──── busy
P3:    idle      idle      idle      busy ──── busy

M-spin: 1 ────── 1 ────── 1 ────── 1 ────── 0
        (one M spinning while any P has work)
                          (when all busy, no need to spin)
```

### LRQ as a two-headed bucket

```
                ┌──────────────────────────┐
                │       LRQ of P0          │
                │                          │
   thief pulls  │   [G1][G2][G3][G4][G5]   │  owner pushes
   from head ──→│   head            tail   │←── here
   (atomic CAS) │                          │   (no atomic)
                └──────────────────────────┘
```

### Half-steal in numbers

```
Victim LRQ size N    Thief takes
        1                 1
        2                 1
        3                 2
        4                 2
        8                 4
       16                 8
       32                16
      128                64
      256               128  (max possible)
```

End of junior level. Move to middle.md for the next layer of detail.
