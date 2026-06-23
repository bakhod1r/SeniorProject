# Starvation — Interview Preparation

## Table of Contents
1. [How This File Is Organised](#how-this-file-is-organised)
2. [Definition & Differentiation](#definition--differentiation)
3. [`sync.Mutex` Internals](#syncmutex-internals)
4. [`sync.RWMutex` Writer Starvation](#syncrwmutex-writer-starvation)
5. [Channels & Select](#channels--select)
6. [Scheduler & Async Preemption](#scheduler--async-preemption)
7. [Priority Inversion](#priority-inversion)
8. [Design Questions](#design-questions)
9. [Debugging Scenarios](#debugging-scenarios)
10. [Linux CFS Comparison](#linux-cfs-comparison)
11. [Trap Questions](#trap-questions)

---

## How This File Is Organised

Each question has three parts: the prompt (what the interviewer asks), the answer (what you should say), and the follow-up (what they will probably ask next). Aim to deliver the answer in 60-90 seconds; the follow-up is where you show depth.

---

## Definition & Differentiation

### Q1. Define starvation. How is it different from deadlock and livelock?

**Answer.** Starvation is when a goroutine is ready to run and willing to acquire a resource, but the resource is repeatedly given to other goroutines instead. The goroutine is not blocked — it could proceed any moment — it just never wins the race.

Deadlock is when goroutines are mutually waiting on resources held by each other; no progress is possible. The runtime can detect a global deadlock ("all goroutines are asleep").

Livelock is when goroutines are actively running but their actions cancel each other out so no global progress happens. CPU usage is high; throughput is zero.

The three differ in (a) whether the goroutine is blocked, (b) whether the runtime can detect it, (c) whether throughput is zero or merely unfair.

**Follow-up.** "Can a goroutine starve indefinitely in modern Go?" — In practice, on `sync.Mutex` no, because of starvation mode. On `sync.RWMutex` yes, if readers hold the lock continuously. On a custom queue with naive priority yes.

---

### Q2. Why is starvation called the "quietest" concurrency failure?

**Answer.** Because the system as a whole keeps working. Most goroutines progress; the affected one is just slow. The race detector says nothing. The deadlock detector says nothing. Average latency looks fine. Only tail percentiles (p99, p99.9) reveal the problem, and only if you measure them.

**Follow-up.** "What metric would you alert on?" — `/sync/mutex/wait/total:seconds` rate of increase; p99 latency on the affected endpoint; queue depth at any priority class.

---

## `sync.Mutex` Internals

### Q3. Explain `sync.Mutex` starvation mode.

**Answer.** Since Go 1.9, `sync.Mutex` has two modes: normal and starvation. In normal mode, the fast path is a single CAS — an arriving goroutine can grab the lock without consulting the wait queue. This is fast but unfair: a parked waiter may keep losing the race to fresh arrivers.

If any waiter is parked for more than 1 ms, the mutex switches to starvation mode. In this mode the CAS fast path is disabled; every acquire enters the slow path and queues. `Unlock` hands the lock *directly* to the head of the wait queue via the semaphore's hand-off mechanism. New arrivers see the starving flag and queue without trying to acquire.

The mode is cleared when the last waiter, or a waiter whose own wait was short, acquires the lock. The result is "fast and unfair in the common case, slower and fair in the bad case".

**Follow-up.** "Why not just always be fair?" — Throughput. The fast-path CAS is 5-10x cheaper than the slow path. Starvation mode is a fallback, not the default.

---

### Q4. Walk me through what happens on Lock when the mutex is in starvation mode.

**Answer.**

1. The fast-path CAS sees `mutexStarving` set; bypasses; enters slow path.
2. Slow path increments the waiter count, sets state appropriately.
3. Goroutine calls `runtime_SemacquireMutex(&m.sema, queueLifo=true, 1)` to park. The LIFO flag means a re-queueing goroutine joins the front.
4. Goroutine sleeps until `runtime_Semrelease` wakes it.
5. On wake, goroutine checks elapsed time. If less than 1 ms or it is the last waiter, it clears `mutexStarving`. Either way it now owns the lock — `Semrelease` with hand-off transferred ownership before the wake.
6. Goroutine updates state: adds `mutexLocked`, subtracts a waiter, possibly clears `mutexStarving`.
7. Returns.

**Follow-up.** "What is the difference between `Semrelease(handoff=true)` and `Semrelease(handoff=false)`?" — Hand-off transfers ownership of the lock to the parked waiter before the waiter wakes. Without hand-off, the waiter wakes and competes for the lock with any concurrent arriver.

---

## `sync.RWMutex` Writer Starvation

### Q5. Can writers starve on `sync.RWMutex`? Explain.

**Answer.** Yes. The Go implementation prevents starvation from *new* readers: when a writer calls `Lock`, it subtracts `rwmutexMaxReaders` from `readerCount`, making it negative. New `RLock` calls see the negative value and park, so the pool of active readers can only shrink.

However, the writer must wait for *existing* readers to release. If readers hold the lock for a long time and there are many of them, the writer's wait is unbounded relative to a normal mutex acquire. Worse, if a read critical section does I/O or another long operation, the writer effectively waits for that operation.

**Follow-up.** "How do you fix it?" — Three options: (1) shorten read critical sections by snapshotting and processing outside the lock; (2) switch to `sync.Mutex` if read critical sections are short; (3) shard the data across multiple locks so writers don't compete with all readers.

---

### Q6. Explain the sign-bit trick in `RWMutex`.

**Answer.** `readerCount` is an `atomic.Int32`. In normal operation it is positive and counts active readers. When a writer calls `Lock`, it does `readerCount.Add(-rwmutexMaxReaders)` where `rwmutexMaxReaders = 1<<30`. This makes the field negative. The old value of `readerCount + rwmutexMaxReaders` gives the number of readers the writer must wait for; that becomes `readerWait`.

Now, when a new reader calls `RLock`, it does `readerCount.Add(1)`. The result is still negative (because we subtracted ~1 billion), so the reader parks on `readerSem`. Existing readers calling `RUnlock` decrement both `readerCount` and `readerWait`; the last one signals the writer.

The single atomic field encodes both states: positive = "active readers, no writer pending"; negative = "writer pending, drain existing readers". Robust because 1<<30 is larger than any realistic reader count.

**Follow-up.** "What if 2 billion readers tried to call `RLock`?" — They would overflow the field; the runtime checks for `r+1 == -rwmutexMaxReaders` in `RUnlock` and panics. In practice you would run out of goroutine stacks long before this.

---

## Channels & Select

### Q7. Is `select` fair? Explain.

**Answer.** `select` is fair in the sense that, when multiple cases are ready at the moment of evaluation, the runtime picks one uniformly at random. There is no left-to-right preference, no rotation, no priority.

`select` is *not* fair in the sense that case selection depends on which cases are ready at evaluation time. If one channel is almost always ready and another rarely is, the always-ready one is picked almost always — not because of `select` bias but because of readiness imbalance.

**Follow-up.** "How would you implement priority among cases?" — A two-stage `select`: first a non-blocking `select` polling the high-priority channels; if none ready, fall through to a blocking `select` with all channels. Be careful: this pattern can starve low-priority channels under sustained high-priority traffic. Add aging.

---

### Q8. Write a `select` that prefers `urgent` to `normal` but does not starve `normal`.

**Answer.**

```go
for {
    // Phase 1: drain urgent fully.
    select {
    case v := <-urgent:
        handle(v)
        continue
    default:
    }
    // Phase 2: poll both; if both ready, urgent has 3x weight.
    pick := rand.Intn(4)
    if pick < 3 {
        select {
        case v := <-urgent:
            handle(v)
        case v := <-normal:
            handle(v)
        case <-ctx.Done():
            return
        }
    } else {
        select {
        case v := <-normal:
            handle(v)
        case v := <-urgent:
            handle(v)
        case <-ctx.Done():
            return
        }
    }
}
```

Or, more cleanly, a dispatcher goroutine with a weighted token allocation. The randomisation in phase 2 ensures normal gets ~1/4 of the throughput when both are ready.

**Follow-up.** "Why not just multi-level feedback queues?" — Same idea. The weighted phase 2 is a token-bucket variant. MLFQ with quotas `[3, 1]` is equivalent.

---

## Scheduler & Async Preemption

### Q9. What changed in Go 1.14 regarding starvation?

**Answer.** Async preemption. Before 1.14, the Go scheduler could only preempt a goroutine at function-call boundaries. A goroutine running a tight loop without function calls — `for { i++ }` — never reached a preemption point and could starve every other goroutine on the same P.

Go 1.14 added signal-driven preemption: the scheduler sends `SIGURG` to the M running a long-running goroutine; the signal handler interrupts the goroutine at the next safe point and switches its PC to a preemption function. The goroutine then yields and is rescheduled later.

This eliminated an entire class of scheduler starvation bugs. Today, a tight loop on Go 1.14+ yields after ~10 ms.

**Follow-up.** "What is a safe point?" — A PC where all live values are in stack slots with known types so the GC can scan them. The compiler emits enough metadata to identify safe points. Async preemption only interrupts at safe points; if the goroutine is between safe points (in assembly without metadata, in cgo), the handler defers and retries.

---

### Q10. Can a goroutine still hog a P in modern Go?

**Answer.** For up to 10 ms at a time, yes. The preempt slice is 10 ms; a CPU-heavy goroutine runs that long before yielding. For workloads where 10 ms is unacceptable (very low-latency services), this matters.

Workarounds:

- Split CPU-heavy operations into chunks with explicit `runtime.Gosched()` calls.
- Move CPU-heavy work to a separate process or worker pool with its own GOMAXPROCS budget.
- Avoid colocating latency-critical goroutines with CPU-heavy ones (separate services).

**Follow-up.** "What is `runtime.LockOSThread` and how does it interact with starvation?" — It pins a goroutine to a specific OS thread, opting out of normal scheduling. Used for cgo callbacks and OpenGL contexts. A locked goroutine cannot be moved between Ms but is still subject to preemption; the M itself can run other goroutines once the locked one yields.

---

## Priority Inversion

### Q11. Define priority inversion. Does it exist in Go?

**Answer.** Priority inversion is a failure mode in priority-based scheduling: a low-priority task `L` holds a resource that a high-priority task `H` needs. As long as `L` does not release, `H` waits — effectively demoted to `L`'s priority. If a medium-priority task `M` exists that does not need the resource but competes with `L` for CPU, `M` can preempt `L` and extend its critical section indefinitely. This is unbounded priority inversion.

Go has no runtime-level goroutine priority, so OS-style priority inversion does not exist at the runtime layer. But application-level priority inversion is common: a "background" goroutine holds a `sync.Mutex` that a "foreground" goroutine needs. The mutex is priority-agnostic.

**Follow-up.** "How would you mitigate it?" — Don't share locks between priorities (shard the data). If sharing is necessary, use cooperative yield-on-contention: the holder polls a waiter counter and releases when it sees waiters. Or use a read-mostly pattern with `RWMutex` if the high-priority path only reads.

---

## Design Questions

### Q12. Design an anti-starvation priority queue.

**Answer.** Two approaches I would consider:

**Aging.** Each item has a static priority and an enqueue time. When dispatching, compute an effective priority that decreases (improves) with wait time:

```go
effective := static - bonus(now - enqueueAt)
```

where `bonus` is configured to match the SLA. An item with priority 5 and 500 ms wait might compete as priority 0. Bound: no item waits more than `K * R` behind higher-priority items, where `K` is priority levels and `R` is aging rate.

**Multi-level feedback queues (MLFQ).** Maintain one FIFO per priority class plus a dispatcher with weighted quotas. Quotas like `[4, 2, 1]` give each level a guaranteed share: 4/7, 2/7, 1/7. Simpler to reason about; fixed priority granularity.

Pick aging when priority is a continuum or when SLA is the primary constraint. Pick MLFQ when priority is naturally discrete and you want simpler tuning.

**Follow-up.** "What if priority itself changes over time?" — Aging handles this naturally (recompute on each pop). MLFQ requires moving items between queues, which is more expensive.

---

### Q13. Design a cancellable lock.

**Answer.** A channel-based binary semaphore:

```go
type CtxMutex struct {
    sem chan struct{}
}

func NewCtxMutex() *CtxMutex { return &CtxMutex{sem: make(chan struct{}, 1)} }

func (m *CtxMutex) Lock(ctx context.Context) error {
    select {
    case m.sem <- struct{}{}:
        return nil
    case <-ctx.Done():
        return ctx.Err()
    }
}

func (m *CtxMutex) Unlock() { <-m.sem }
```

If FIFO fairness is also required, maintain an explicit waiter list with per-waiter channels, signal them in order on Unlock. The cost is O(N) for list operations on cancel; use an intrusive linked list for large N.

**Follow-up.** "Why not just use `sync.Mutex`?" — `sync.Mutex.Lock` is not cancellable. A goroutine parked there ignores `ctx.Done()`. For high-frequency uncontended locks, prefer `sync.Mutex`. For locks where cancellation matters, the channel pattern is right.

---

### Q14. Design a multi-tenant rate limiter that does not let one tenant starve others.

**Answer.** Deficit Round Robin (DRR). Each tenant has a queue, a deficit counter, and a quantum. The dispatcher loops over tenants, adding the quantum to the deficit, then draining items whose cost fits in the deficit. Tenants are guaranteed a share proportional to their quantum.

```
for {
    for each tenant t:
        t.deficit += t.quantum
        while t.queue has item and item.cost <= t.deficit:
            t.deficit -= item.cost
            dispatch(item)
}
```

A noisy tenant fills its own queue but drains only its quantum per round; quiet tenants always get their share. Variable-cost items handled naturally.

**Follow-up.** "What if a tenant has no items?" — Skip; its quantum carries over to the next round (bounded; cap at some maximum to prevent burst hoarding).

---

## Debugging Scenarios

### Q15. A service has p99 latency of 500 ms and p50 of 5 ms. Where do you look first?

**Answer.** Classic starvation signature. Steps:

1. Enable mutex profiling: `runtime.SetMutexProfileFraction(1)`.
2. Pull a mutex profile from a representative node.
3. Top function will be the contention site.
4. Look at the critical section. Is it longer than expected? Did a recent deploy add an I/O call inside the lock?
5. Check if it is `sync.RWMutex`. If so, measure writer wait time. If writer wait >> reader critical section, you have writer starvation.
6. Check block profile for `select` and channel waits. Look for waits longer than expected.

If profiling does not reveal the cause: enable `GODEBUG=schedtrace=1000` and look for goroutines spending many ticks in `runnable` state.

**Follow-up.** "What if all the profiles look fine?" — Look at GC. Long GC pauses extend effective critical sections. Or check for cgo calls — they hold an M and can starve other Ms.

---

### Q16. A worker pool uses a priority queue. Low-priority jobs are taking forever. What do you do?

**Answer.** Priority queue is starving low-priority items. Three responses:

1. **Switch to aging.** Pop by effective priority that grows with wait time. Bounds the wait for low-priority items.
2. **Switch to MLFQ.** Multiple FIFOs with weighted dispatcher quotas.
3. **Add a backstop SLO.** Track low-priority wait time as a metric; alert when it exceeds a threshold; either drop or escalate the priority.

Option 1 is cleanest; option 2 is simplest; option 3 is the operational reality regardless of which engineering choice you make.

**Follow-up.** "How do you pick the aging rate?" — From the SLA. If low-priority items should complete within 1 second, and there are 5 priority levels, age fast enough that after 200 ms a low-priority item is competing with mid-priority items. Tune from there.

---

## Linux CFS Comparison

### Q17. How does Go's scheduler compare to Linux CFS regarding fairness?

**Answer.** Linux CFS uses a `vruntime` accounting model: every task accumulates virtual runtime proportional to wall time, weighted by priority. The scheduler picks the task with the smallest `vruntime`. Result: every task gets a share of CPU proportional to its weight, with strong fairness guarantees.

Go's scheduler uses work-stealing on per-P local queues. Selection within a queue is FIFO. Cross-P fairness comes from stealing when an M is idle. There is no `vruntime` and no goroutine priority.

For fine-grained fairness, CFS is stronger. For *throughput* with cheap concurrency, Go's design wins — millions of goroutines vs. thousands of CFS tasks.

The trade-off is intentional: Go's runtime is simpler because "fair enough" is sufficient for most workloads, and application-level priority can be built when needed.

**Follow-up.** "Could Go add `vruntime`?" — Technically yes; cost would be per-goroutine bookkeeping and a more expensive scheduler. Trade-off does not look favourable when goroutine count is in the millions. The Go team has shown no interest.

---

## Trap Questions

### Q18. "`sync.Mutex` is FIFO." True or false?

**Trap.** Sounds true because of starvation mode. Actually false.

**Answer.** `sync.Mutex` is not strictly FIFO even in starvation mode. The starvation-mode hand-off goes to the *head of the parked queue*, which is FIFO within the semaphore parking, but new arrivers can still take the lock when the mutex is in normal mode. The hybrid is "eventually fair within 1 ms" not "FIFO".

**Follow-up.** "Show me how to write a strict FIFO mutex." — Build it with an explicit channel-based waiter list, as in the cancellable-lock design.

---

### Q19. "I should always use `sync.RWMutex` for read-mostly workloads." True or false?

**Trap.** Sounds true because RWMutex is "designed for" read-mostly workloads.

**Answer.** False (or "it depends"). RWMutex adds atomic operations and bookkeeping overhead. For short critical sections (a map lookup), the overhead can exceed the parallelism win, making RWMutex *slower* than a plain Mutex. It also introduces writer starvation risk.

Use RWMutex only when: (a) read critical sections do non-trivial work, (b) read:write ratio is >> 10:1, and (c) measurement confirms RWMutex is faster than Mutex for your workload.

**Follow-up.** "What is your threshold for 'non-trivial work'?" — Roughly anything more than a single memory access. If the critical section is "look up a key in a hash map", Mutex wins. If it is "look up, then deserialise, then validate", RWMutex starts to pay off.

---

### Q20. "`runtime.Gosched()` fixes starvation." True or false?

**Trap.** It sounds like the right tool. Mostly it is not.

**Answer.** Mostly false. `runtime.Gosched()` is a hint to the scheduler that this goroutine is willing to yield. It does not bypass any starvation mechanism in mutexes or channels. Since Go 1.14, async preemption forces yielding anyway, so explicit `Gosched()` is mostly unnecessary.

The case where `Gosched()` helps: a tight CPU loop on Go 1.13 or earlier, where it provides the preemption point that the runtime cannot otherwise insert. On 1.14+ this case is gone.

**Follow-up.** "Are there cases where `Gosched()` is still useful?" — Mostly debugging and test reproducibility. In production code it is rare.

---

### Q21. "If a goroutine starves, the deadlock detector will catch it." True or false?

**Trap.** Sounds plausible because both are "stuck" conditions.

**Answer.** False. The deadlock detector fires only when *all* goroutines are asleep. A starved goroutine is sleeping while others run; the detector sees runnable work and stays silent.

**Follow-up.** "Then how do you detect starvation?" — Tail latency metrics, mutex/block profiles, custom waiter-counter instrumentation, periodic stack dumps. No first-class runtime support.
