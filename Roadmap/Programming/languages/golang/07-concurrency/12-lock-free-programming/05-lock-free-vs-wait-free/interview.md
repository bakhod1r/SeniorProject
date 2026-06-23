# Lock-Free vs Wait-Free — Interview Questions

## Table of Contents
1. [Introduction](#introduction)
2. [Warm-Up](#warm-up)
3. [Conceptual Questions](#conceptual-questions)
4. [Classification Questions](#classification-questions)
5. [Whiteboard Coding](#whiteboard-coding)
6. [Design Questions](#design-questions)
7. [Trick Questions](#trick-questions)
8. [Behavioural / Judgement Questions](#behavioural-judgement-questions)
9. [Sample Strong Answers](#sample-strong-answers)
10. [Sample Weak Answers and How to Fix Them](#sample-weak-answers-and-how-to-fix-them)
11. [Red Flags Interviewers Watch For](#red-flags-interviewers-watch-for)
12. [Preparation Checklist](#preparation-checklist)

---

## Introduction

The lock-free / wait-free distinction is a favourite of staff and principal interviewers. It separates engineers who pattern-match on jargon from engineers who can reason about progress guarantees rigorously. The good news is that there is a small set of concepts the interviewer is probing for. If you know them cold, you can answer almost any question in this space.

What the interviewer is really testing:

1. Do you know that lock-free and wait-free are *different* guarantees?
2. Can you place common Go constructs on the hierarchy?
3. Can you defend a design decision with the right level of confidence — neither over-claiming nor under-claiming?
4. Do you know when *not* to use wait-free?

Answer these well and you will pass any reasonable interview on the topic.

---

## Warm-Up

These are the questions that filter out candidates who have never thought about the distinction.

**Q1.** What is the difference between lock-free and wait-free?

*Strong answer.* Lock-free guarantees that the system as a whole always makes progress — some thread always completes an operation. Wait-free is stronger: every thread completes every operation within a bounded number of its own steps. Lock-free permits an individual thread to starve; wait-free does not.

**Q2.** Is `atomic.AddInt64(&x, 1)` lock-free or wait-free?

*Strong answer.* Wait-free. It compiles to a single atomic instruction (`LOCK XADD` on x86), and there is no retry loop. Every call returns in `O(1)` steps regardless of contention.

**Q3.** Is a CAS-loop counter lock-free or wait-free?

*Strong answer.* Lock-free, not wait-free. The CAS can fail under contention, forcing a retry. The number of retries is unbounded — there is no integer `B` that bounds the worst case for any individual goroutine, so the algorithm is not wait-free. But every retry of one goroutine implies *another* goroutine succeeded, so the system as a whole always makes progress.

**Q4.** Is `sync.Mutex` lock-free?

*Strong answer.* No. `sync.Mutex` is blocking. The holder can be descheduled, and waiters wait until the holder is rescheduled and unlocks. That dependency on the scheduler is exactly what "blocking" means.

---

## Conceptual Questions

**Q5.** Why is "lock-free" not the same as "fast"?

*Strong answer.* Lock-free is a *robustness* guarantee — it says no thread can be permanently blocked by another's failure or delay. It says nothing about throughput. Under low contention, a mutex can be faster than a lock-free design because the uncontended `Lock`/`Unlock` is one CAS plus one store, and there are no retries. Under moderate contention, lock-free designs often win. Under extreme contention, sharding usually beats both. So "lock-free" and "fast" are independent claims.

**Q6.** What is the consensus number of CAS?

*Strong answer.* Infinity. CAS can solve consensus for any number of threads, which is why CAS suffices to implement wait-free versions of any object via the universal construction. Atomic read/write registers, by contrast, have consensus number 1 — you cannot solve consensus for two threads using only loads and stores, which is why wait-free queues and stacks are impossible without stronger primitives.

**Q7.** What does the Universal Construction prove?

*Strong answer.* Maurice Herlihy proved in 1991 (refined 1993) that any sequential object specification can be turned into a wait-free, linearisable implementation given a CAS primitive. The construction works by having each thread announce its operation, scan announcements, and CAS-append operations to a global log. The construction is correct but slow — every operation costs `O(N + M)` where `N` is the thread count and `M` is the total number of operations applied. It is a proof of existence, not an engineering recipe.

**Q8.** Why might you write a wait-free algorithm instead of a lock-free one?

*Strong answer.* When you need a bounded per-thread worst-case latency. Three settings: hard real-time (audio, control loops, anti-lock brakes), fault tolerance (a thread that crashes mid-operation must not deadlock survivors), and inside operating-system kernels or language runtimes (where the algorithm cannot afford to wait for "some other thread to make progress" because that thread might be the scheduler itself). Outside those settings, lock-free is almost always sufficient and faster.

**Q9.** What is "helping," and why does it appear in wait-free algorithms?

*Strong answer.* Helping is a mechanism in which threads complete pending operations announced by other threads. Slow threads announce their intended operation in a shared table; faster threads see the announcement and complete the slow thread's operation on its behalf. Helping is necessary for wait-freedom because the bound on per-thread steps cannot tolerate unbounded retries — if a thread cannot retry forever, *someone else* must finish the job, and that someone else is a helper. Helping has a cost: every operation pays `O(N)` cache traffic to scan the announcement table on entry, and the work is duplicated across helpers.

**Q10.** Can a linearisable algorithm be blocking?

*Strong answer.* Yes. Linearisability is a correctness property (operations appear to take effect at a single instant in their invocation interval). It is orthogonal to progress. A mutex-protected counter is linearisable and blocking. An `atomic.Add` counter is linearisable and wait-free. Some research designs are wait-free but only sequentially consistent (a weaker correctness property). Always check both axes independently when reading a paper or a library claim.

---

## Classification Questions

For each construct, name the progress class and explain in one sentence why.

**Q11.** `sync.WaitGroup.Add(1)` — *Wait-free; one atomic increment of the internal counter.*

**Q12.** `sync.WaitGroup.Wait()` — *Blocking; parks on a semaphore until the counter is zero.*

**Q13.** `sync.Map.Load` for a key that lives in the read-only map — *Wait-free in steady state; one atomic load.*

**Q14.** `sync.Map.Store` for a brand-new key — *Blocking; promotes the key into the dirty map under the mutex.*

**Q15.** `sync.Once.Do` for the first caller — *Blocking; serialises via an internal mutex.*

**Q16.** `sync.Once.Do` for subsequent callers — *Wait-free; one atomic load of the `done` flag.*

**Q17.** A buffered channel send when the buffer is full — *Blocking; sender parks until a receiver consumes a slot.*

**Q18.** A buffered channel send when the buffer has room and no contender — *Effectively wait-free in the fast path, mutex-protected in the slow path; classification depends on the contention regime.*

**Q19.** Treiber stack `Push` — *Lock-free; CAS-loop on the head pointer, unbounded retries possible.*

**Q20.** Michael-Scott queue `Enqueue` — *Lock-free; two CAS per enqueue, with a "help advance tail" step that keeps the queue from stalling.*

**Q21.** Kogan-Petrank queue `Enqueue` — *Wait-free; announcement-based with helping, `O(N)` per call.*

**Q22.** A sequence-lock read — *Lock-free; reader retries if it observes the writer's odd-numbered "in progress" sequence number.*

**Q23.** `sync.Cond.Wait` — *Blocking; releases the mutex and parks on the condition variable.*

**Q24.** `runtime.Gosched()` — *Wait-free per call (one yield), but it does not change the progress class of the surrounding code.*

---

## Whiteboard Coding

**Q25.** *Write a wait-free counter. Prove its progress class.*

```go
type WaitFreeCounter struct {
    n atomic.Int64
}

func (c *WaitFreeCounter) Add(delta int64) {
    c.n.Add(delta)
}

func (c *WaitFreeCounter) Load() int64 {
    return c.n.Load()
}
```

Both `Add` and `Load` are single atomic instructions. Each call completes in one hardware step regardless of contention. Therefore: wait-free.

**Q26.** *Write a lock-free counter using CAS. Prove its progress class.*

```go
type CASCounter struct {
    n atomic.Int64
}

func (c *CASCounter) Add(delta int64) {
    for {
        old := c.n.Load()
        if c.n.CompareAndSwap(old, old+delta) {
            return
        }
    }
}
```

Every CAS failure means some other goroutine's CAS succeeded, so the system always makes progress: lock-free. But the loop has no static bound on iterations, so a single goroutine can in principle retry forever: not wait-free.

**Q27.** *Write a wait-free SPSC ring buffer.*

```go
type SPSCRing[T any] struct {
    buf  []T
    mask uint64
    head atomic.Uint64
    tail atomic.Uint64
}

func NewSPSCRing[T any](sizePow2 int) *SPSCRing[T] {
    size := 1 << sizePow2
    return &SPSCRing[T]{buf: make([]T, size), mask: uint64(size - 1)}
}

func (r *SPSCRing[T]) Push(v T) bool {
    h := r.head.Load()
    t := r.tail.Load()
    if h-t == uint64(len(r.buf)) {
        return false
    }
    r.buf[h&r.mask] = v
    r.head.Store(h + 1)
    return true
}

func (r *SPSCRing[T]) Pop() (T, bool) {
    var zero T
    t := r.tail.Load()
    h := r.head.Load()
    if h == t {
        return zero, false
    }
    v := r.buf[t&r.mask]
    r.tail.Store(t + 1)
    return v, true
}
```

Single producer touches only `head`; single consumer touches only `tail`. No CAS, no retry. Each operation completes in `O(1)` steps: wait-free.

**Q28.** *Modify the SPSC ring to MPMC and explain the progress class.*

The MPMC version typically uses CAS loops on both `head` and `tail` and is therefore *lock-free*, not wait-free. Making it wait-free requires helping (Kogan-Petrank style). The interview-worthy answer is to recognise the jump in complexity and decline to wing it on the whiteboard.

**Q29.** *Write a bounded CAS-loop counter that returns `errContended` after 16 retries.*

```go
const maxRetries = 16

func (c *CASCounter) AddBounded(delta int64) error {
    for i := 0; i < maxRetries; i++ {
        old := c.n.Load()
        if c.n.CompareAndSwap(old, old+delta) {
            return nil
        }
    }
    return errContended
}
```

This is *bounded* (every call completes in `O(1)` steps) but not formally wait-free (operations can fail). It is a pragmatic middle ground.

---

## Design Questions

**Q30.** *Design a concurrent metrics counter that supports `Increment`, `Decrement`, and `Snapshot` operations across many goroutines. Justify your progress class.*

*Strong answer.* Use `atomic.Int64.Add` for `Increment` and `Decrement`, and `atomic.Int64.Load` for `Snapshot`. All three operations are wait-free with one-instruction bounds. If contention on a single counter saturates the cache line, shard into `runtime.GOMAXPROCS(0)` per-CPU counters and sum at read time — the per-CPU updates are wait-free; the sum at read is wait-free in `O(N)` where `N` is the shard count.

**Q31.** *You have a configuration object that is read on every request handler call (high frequency) and reloaded once per minute (low frequency). Design the concurrent access pattern.*

*Strong answer.* Use `atomic.Pointer[Config]` for the live config. Readers do `cfg := ptr.Load()` — wait-free. The reloader builds a new `*Config` and does `ptr.Store(newCfg)` — wait-free. If the reload must atomically update multiple fields, the reloader's *internal* logic can use a mutex, but the swap-into-place is atomic. The aggregate guarantee is wait-free reads, blocking-protected internal reload, atomic publish.

**Q32.** *You are building a worker pool with a job queue. Choose the queue implementation and progress class.*

*Strong answer.* For any realistic Go workload — even tens of thousands of jobs per second — a buffered `chan Job` is the right choice. The channel is internally mutex-protected, so it is blocking, but blocking under reasonable contention adds microseconds at most. Reach for a lock-free queue (Michael-Scott) only if profiling shows the channel as the bottleneck. Wait-free queues are not the right tool here; the SLA does not justify the overhead.

**Q33.** *You are building a real-time audio processing system in C++ with Go orchestrating it via cgo. The audio thread sends events to the Go side. Choose the IPC mechanism.*

*Strong answer.* The audio thread cannot block (any block is an audible click). It must communicate via wait-free shared memory — an SPSC ring buffer accessible from both sides. Go's side reads from the ring via cgo wrappers around atomic operations. The progress class on the audio side is wait-free; the Go side can be lock-free or blocking (a separate goroutine polls). Crucial: no Go GC pauses can affect the audio thread, because the audio thread is not a goroutine — it is a real-time OS thread allocated outside Go.

**Q34.** *Design a wait-free read path for a hot cache. Reads must never block; writes can be slow.*

*Strong answer.* Two patterns. (1) `atomic.Pointer[map[K]V]` with copy-on-write: writers clone the map, mutate the clone, and CAS-swap the pointer. Readers always see a consistent map. Reads are wait-free; writes are `O(map size)` blocking. (2) `sync.Map`: read path is wait-free for hot keys; new writes can take a mutex. Pattern 1 is simpler but expensive for large maps; pattern 2 amortises the cost. Both have wait-free read paths.

---

## Trick Questions

**Q35.** *Is a mutex with a "bounded waiter queue" wait-free?*

No. A mutex is blocking regardless of the waiter-queue structure. The progress class is defined by whether one thread's progress can depend on another being scheduled. A mutex always has that dependency.

**Q36.** *I bounded my CAS-loop retries at 16. Is the algorithm wait-free now?*

No, not in the formal sense. Wait-free requires every operation to *complete* in bounded steps. A bounded-retry loop *terminates* in bounded steps, but it can terminate with failure. That is *bounded* but not wait-free. It is a useful engineering compromise but a distinct property.

**Q37.** *I'm using `atomic.Pointer` everywhere. Is my code lock-free?*

Only if every operation on shared state uses `atomic.Pointer` and no mutex. A single hidden `sync.Mutex` or channel makes the affected paths blocking. Audit carefully.

**Q38.** *Garbage collection pauses freeze my goroutines. Does that mean Go's `atomic.Add` is not wait-free?*

The formal model defines progress classes relative to *threads that are running*. A GC pause halts all threads equally and is not an "adversary action" in the model. So `atomic.Add` remains wait-free *in the formal sense*. However, for *practical* hard-real-time, GC pauses are a problem and Go is not the right language.

**Q39.** *Channels in Go are non-blocking — they implement CSP, which is built on message passing. So channels are lock-free, right?*

No. Channels are implemented with a mutex and a queue of parked goroutines. A send on a full unbuffered channel blocks the sender until a receiver arrives. Channels are blocking primitives in the formal sense.

**Q40.** *I implemented a "wait-free" hash table using fine-grained locks. The locks are per-bucket so they barely contend. Is it wait-free?*

No. Fine-grained locks are still locks. The algorithm is blocking. Per-bucket locking is a *scalability* improvement but does not change the progress class. If your interviewer pushes back, they are testing whether you understand the formal definition.

---

## Behavioural / Judgement Questions

**Q41.** *A colleague proposes a wait-free queue for your service's job queue, citing the bounded-latency property. What is your response?*

*Strong answer.* Ask: what is the SLA? If the SLA caps p99 latency in microseconds and the current queue's p99 is hundreds of microseconds, wait-free might be justified. Otherwise, the wait-free queue's `O(N)` per-call overhead is likely *worse* in practice than a mutex or a Michael-Scott queue. Wait-free is the strongest progress guarantee, but it is rarely the fastest, and "strongest" is not free.

**Q42.** *Your team is migrating from a lock-free design to a mutex-based one because of a subtle bug. The original engineer is skeptical. How do you reason about the regression in progress class?*

*Strong answer.* The progress class is a *robustness* property, not a correctness one. Moving from lock-free to mutex weakens the guarantee against thread suspension. Whether that matters depends on the operational reality: if the service runs on a non-RT Linux with reasonable scheduling, the difference is microseconds. The mutex is also far easier to reason about and to verify correct. For most application code, the trade-off favours simplicity. Document the change, measure tail latency before and after, and accept the mutex if the metrics are within SLA.

**Q43.** *An engineer claims their data structure is wait-free. What do you ask?*

*Strong answer.* (1) What is the per-operation step bound `B`? (2) Where is the helping mechanism, and what is its fairness property? (3) How are operation descriptors reclaimed? (4) What is the measured tail latency under adversarial scheduling? If they cannot answer (1), the claim is decoration. If (2) and (3) are vague, the claim is fragile. If (4) is not measured, the claim is unverified.

---

## Sample Strong Answers

### "What is the difference between lock-free and wait-free?"

Strong answer: "Lock-free guarantees that *some* thread always makes progress in the system; wait-free guarantees that *every* thread makes progress within a bounded number of its own steps. The difference is one quantifier — 'some' versus 'every' — and it captures a real practical distinction: lock-free permits individual threads to starve, wait-free does not. In Go, `atomic.AddInt64` is wait-free because it compiles to one instruction; a CAS-loop counter is lock-free because the loop can retry without bound. The wait-free guarantee is required only for hard-real-time, safety-critical, or fault-tolerant systems; in typical Go application code, lock-free or mutex-based designs are almost always sufficient and faster."

### "When would you choose wait-free in Go?"

Strong answer: "Almost never. Three settings justify wait-free in Go. First, audio or hard real-time IPC, where missing a deadline is a failure — but in those cases the audio thread itself is rarely a goroutine, and the wait-free path is between Go and a real-time C thread. Second, signal handlers — but the Go runtime mediates signals through channels, so user code rarely needs wait-free for this. Third, communication with custom hardware over PCIe, where the wait-free property is a hardware guarantee that Go inherits. Outside these settings, wait-free in Go is over-engineering. The honest senior position is: use a mutex by default, use `atomic.Add` and friends when the operation is a single atomic, and pick lock-free data structures only when profiling demands it."

### "Why isn't a CAS-loop counter wait-free?"

Strong answer: "Because the loop has no static bound on iterations. Each CAS can fail if another goroutine's CAS succeeded between our load and our CAS. The system always makes progress — every failure implies someone else succeeded — but our specific goroutine can in principle fail every CAS forever. There is no integer `B` such that every call completes in at most `B` steps. Wait-free requires that bound. `atomic.Add` is wait-free because it is one instruction with no loop; a CAS in a loop is lock-free; a single CAS call is wait-free per call."

---

## Sample Weak Answers and How to Fix Them

### Weak: "Wait-free means it's faster."

*Why it's weak.* Wait-free is a progress guarantee, not a speed guarantee. Wait-free designs are often *slower* than lock-free ones in steady state because of the helping overhead.

*Fix.* "Wait-free means every operation completes in bounded steps. It does not directly imply speed. Often the wait-free version is slower than the lock-free version on average; the wait-free guarantee buys a worst-case bound, not better throughput."

### Weak: "Channels in Go are lock-free."

*Why it's weak.* Channels are mutex-protected internally. They are blocking primitives in the formal sense.

*Fix.* "Channels in Go are blocking primitives. They are implemented with a mutex and a queue of parked goroutines. A send to a full unbuffered channel blocks the sender; a receive on an empty channel blocks the receiver. They are not lock-free."

### Weak: "I'd use wait-free because it's the most robust."

*Why it's weak.* Pattern-matches on "robust" without justifying the cost. Wait-free is the strongest guarantee but pays a steady-state tax.

*Fix.* "I'd use the weakest progress class that meets the requirement. For typical application code that means a mutex. If profiling shows the mutex as a bottleneck and the operation can be expressed atomically, I'd use `atomic.Add`. Wait-free with helping is reserved for hard-real-time or fault-tolerant settings; it is rarely worth the complexity in Go."

### Weak: "Wait-free guarantees the algorithm never blocks."

*Why it's weak.* "Never blocks" is the property of non-blocking algorithms in general (obstruction-free, lock-free, and wait-free). Wait-free is more specific.

*Fix.* "Wait-free guarantees every operation completes in bounded per-thread steps. That is strictly stronger than 'never blocks' — non-blocking is just the lower bound. The bounded-steps property is what distinguishes wait-free from lock-free, which is also non-blocking but allows individual threads to retry forever."

---

## Red Flags Interviewers Watch For

1. **Using "lock-free" and "wait-free" interchangeably.** The single most common interview tell. They are different guarantees with different costs. Engineers who conflate them have not internalised the hierarchy.
2. **Claiming a CAS loop is wait-free.** The loop's unbounded retry is the lock-free signature. A senior engineer should catch this instantly.
3. **Calling channels non-blocking.** Channels are blocking primitives. The mistake reveals shallow familiarity with the Go runtime.
4. **Treating wait-free as "the goal."** It is *a* goal in narrow settings. Treating it as the universal best practice signals lack of measurement discipline.
5. **No mention of cost.** Wait-free has a real steady-state cost. Candidates who praise wait-free without naming the cost have not implemented one.
6. **No mention of Herlihy.** The 1991 paper defined the hierarchy. A senior candidate should know the citation and the year.
7. **Ignoring the Go scheduler.** The Go runtime is the adversary in the formal model. Engineers who do not connect the formalism to the runtime are reciting textbook definitions.
8. **Overconfidence in the formal claim.** A candidate who claims their code is "definitely wait-free" without naming the bound `B` is overclaiming.

---

## Preparation Checklist

- [ ] I can state Herlihy's four progress definitions in one sentence each.
- [ ] I know which year Herlihy published *Wait-Free Synchronization* (1991).
- [ ] I can place 15 Go constructs on the hierarchy without hesitation.
- [ ] I can write a Treiber stack and a Michael-Scott queue on a whiteboard.
- [ ] I can sketch the announcement-and-help pattern for a wait-free algorithm.
- [ ] I can explain why `atomic.Add` is wait-free but a CAS loop is not.
- [ ] I know what "consensus number" means and the consensus numbers of common primitives.
- [ ] I can defend a design decision that picks mutex over lock-free.
- [ ] I can defend a design decision that picks lock-free over wait-free.
- [ ] I can name the settings where wait-free in Go is justified (three to five examples).
- [ ] I can identify red flags in someone else's "wait-free" claim.
- [ ] I do not use "wait-free" and "lock-free" as synonyms.

If you tick all twelve, you will pass any reasonable interview on this topic.
