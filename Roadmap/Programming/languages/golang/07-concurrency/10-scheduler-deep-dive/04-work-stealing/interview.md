# Work Stealing — Interview Questions

## Table of Contents
1. [Junior Questions](#junior-questions)
2. [Middle Questions](#middle-questions)
3. [Senior Questions](#senior-questions)
4. [Staff / Principal Questions](#staff--principal-questions)
5. [Whiteboard Tasks](#whiteboard-tasks)
6. [Behavioural / Design](#behavioural--design)

---

## Junior Questions

### Q1: What is work stealing in the Go scheduler?

**Expected**: The runtime keeps a per-P local runqueue. When a P runs out of work, its M tries to steal half of another (randomly chosen) P's runnable goroutines instead of going to sleep. This keeps all CPUs busy without a central coordinator.

### Q2: Why per-P queues instead of one global queue?

**Expected**: One global queue would require a global lock on every push and pop. With per-P queues, the owner pushes/pops without any lock. The synchronisation cost is paid only by thieves.

### Q3: What does "half steal" mean?

**Expected**: When stealing, the thief takes `ceil(N/2)` of the victim's runqueue size. Not less (the victim still has too much), not more (the victim then runs dry too soon). Half is the Cilk-proven sweet spot.

### Q4: What is the LRQ and what is its size?

**Expected**: Local Run Queue, per P, 256 slots, a circular array with head/tail indices. Owner pushes onto tail, thieves pull from head.

### Q5: Where does the scheduler look for work before stealing?

**Expected**: First local LRQ, then global runqueue (GRQ), then netpoll. Stealing is the last resort before parking the M.

### Q6: What is GOMAXPROCS?

**Expected**: The number of Ps (logical processors). Default is the number of CPU cores. It bounds the number of Gs running user code simultaneously.

### Q7: Will my goroutine stay on the P that spawned it?

**Expected**: Usually starts there, but may be stolen by another P. Code should not assume P-affinity.

### Q8: What is `runtime.LockOSThread`?

**Expected**: Pins a goroutine to its OS thread. Used for OS-thread-specific state (e.g., cgo libraries, OpenGL contexts). A locked G is *not* stealable; the M is reserved for it.

---

## Middle Questions

### Q9: Walk me through `findRunnable`.

**Expected**:
1. Check local LRQ via `runqget`.
2. Periodically (1 in 61) check GRQ first.
3. Check GRQ via `globrunqget`.
4. Check netpoll non-blocking.
5. Become spinning if budget allows; attempt up to 4 rounds of stealing across all Ps.
6. Final pre-park checks (timers, GRQ, blocking netpoll).
7. Park the M.

### Q10: What is a spinning M?

**Expected**: An M actively looking for work without a current G. Spinning Ms keep latency low: when new work arrives, a spinning M picks it up within ~1 μs. Without spinners, waking a parked M costs ~1 ms (futex syscall).

### Q11: What is `nmspinning`?

**Expected**: An atomic counter of how many Ms are currently spinning. The scheduler enforces `nmspinning <= (gomaxprocs - npidle) / 2` to cap CPU burn.

### Q12: When is `wakep` called?

**Expected**: Whenever new work is created (goroutine spawned, parked G woken, netpoll Gs ready). It ensures at least one spinning M is alive while work exists. If a spinner is already running, `wakep` is a fast no-op (atomic load + CAS-fail).

### Q13: What is `runnext`?

**Expected**: A single-slot LIFO cache on each P. A newly spawned G goes into `runnext` and runs before the LRQ tail. This optimises parent-child cache locality. Thieves only steal `runnext` on the fourth (last) attempt.

### Q14: What is the 1-in-61 rule?

**Expected**: Every 61st schedule() call on a P, the scheduler checks the GRQ before the LRQ. This prevents GRQ starvation when the LRQ always has work.

### Q15: What happens when an LRQ fills to 256?

**Expected**: `runqputslow` is called. It moves half the LRQ (128 Gs) plus the new G to the GRQ in one batch under `sched.lock`. Slow path; rare in practice.

### Q16: How is the LRQ memory-safe for thieves and the owner?

**Expected**: Acquire-release atomics on `runqhead` (modified by thieves) and `runqtail` (modified by owner only). The release-store on `runqtail` synchronises with the acquire-load by thieves; visibility of G pointers is guaranteed.

### Q17: How does the runtime pick the victim P?

**Expected**: A `cheaprand()` seed determines a random starting position; from there, the thief walks all Ps with a coprime stride. Each pass touches every P once before retrying.

### Q18: How many steal attempts before parking?

**Expected**: 4 rounds, each walking all `GOMAXPROCS - 1` other Ps. If none succeed, the M parks.

---

## Senior Questions

### Q19: Compare Go's work stealing with Cilk's.

**Expected**: Both use random victim selection and half-steal. Cilk uses LIFO from the owner and FIFO from thieves (depth-first locally, breadth-first globally). Go uses FIFO from both sides, with `runnext` providing a LIFO override. Cilk has unbounded deques; Go has bounded LRQs (256) with GRQ overflow.

### Q20: Why the `usleep(3)` before stealing `runnext`?

**Expected**: To give the owner a chance to consume `runnext` itself. If the thief CAS'd immediately, it would frequently win the race against the owner who was about to execute the G. The 3-μs pause biases toward "owner runs it."

### Q21: How does work stealing interact with timers?

**Expected**: In Go 1.14+, each P has its own timer heap. When stealing, the thief also checks the victim's timers; if any have expired, the thief fires them (which may push Gs onto the thief's LRQ). This prevents timer-driven Gs from being starved on busy Ps.

### Q22: What is `injectglist` for?

**Expected**: Distributes a list of newly-runnable Gs back into the system. Used when netpoll returns multiple ready Gs at once, or when a batch of timers fires. It spreads Gs across LRQ and GRQ, and wakes spinners proportional to the batch size.

### Q23: How does async preemption (Go 1.14+) help work stealing?

**Expected**: Without preemption, a long-running G could hog its M forever; stealers could not access the Gs on its LRQ (they could be stolen, but the running G itself was not). With async preemption, a long-running G is interrupted at safepoints every ~10 ms and its place in the LRQ is restored, making the M available for the next G — possibly a stolen one.

### Q24: What if all spinners try to steal from the same P?

**Expected**: They contend on the CAS of `runqhead`. One succeeds; the rest retry. The retries re-randomise their victim selection, so they spread to other Ps. Sustained CAS contention is rare.

### Q25: Is the steal lock-free or wait-free?

**Expected**: Lock-free (LRQ side). The owner's `runqput` is wait-free (only writes `runqtail`). The thief's `runqgrab` may retry on CAS failure but each retry is bounded by the contention. No mutex is held during LRQ stealing.

### Q26: How does work stealing scale on NUMA?

**Expected**: Less well than within a NUMA node. Stealing across nodes hits cross-socket memory traffic. The Go runtime is *not* NUMA-aware; it does not bias stealing toward local nodes. For large NUMA systems, this can be a bottleneck. Mitigation: pin processes per NUMA node, run multiple processes.

### Q27: What is the cost (in nanoseconds) of one steal?

**Expected**: For a small batch (~4 Gs), ~25 ns including atomics, copies, and index updates. For larger batches, +0.5 ns per additional G. Compare: park-and-wake an M is ~1 μs.

### Q28: When does the runtime skip a P during stealing?

**Expected**: When the P is in `idlepMask` (known to be idle, LRQ definitely empty). Also when the thief's own P (`pp == p2`). Also when the LRQ is empty (peek returned head == tail).

---

## Staff / Principal Questions

### Q29: Design a NUMA-aware version of work stealing.

**Expected discussion**:
- Bias victim selection toward Ps on the same NUMA node.
- Only fall back to cross-node stealing after local-node attempts fail.
- Maintain per-NUMA spinning M pools.
- Cost: complex topology detection at startup.
- Benefit: 2-3× lower cross-socket memory traffic for highly parallel workloads.
- Trade-off: load imbalance if one node is busier; need a smart fallback strategy.

### Q30: How would you debug a goroutine that "should be runnable but isn't running"?

**Expected**:
1. `GODEBUG=schedtrace=1000` to see queue state.
2. SIGQUIT (kill -3) to dump all goroutine stacks.
3. Look for `LockOSThread` (G is pinned), `cgocall` (G is in cgo), `gopark` (G is parked, not runnable).
4. Check if the G is actually in `_Grunnable` state (via `runtime.GoroutineProfile`).
5. Check `GOMAXPROCS` — maybe set too low.
6. Check sysmon for stuck conditions.

### Q31: Should the runtime have priorities?

**Expected discussion**:
- Go's design philosophy: simple, uniform. Priorities add complexity.
- Real-time scheduling needs are typically met by separating critical work into a dedicated OS thread via `LockOSThread`.
- Some users would benefit from "soft" priority (e.g., GC mark workers vs user Gs). Already implemented for GC.
- The runtime does have priority-like mechanisms (`runnext` is higher priority than LRQ tail).
- Adding general priorities would require redesigning LRQ as a priority queue — O(log n) instead of O(1).

### Q32: How does Tokio's work stealing differ from Go's, and why?

**Expected discussion**:
- Tokio is Rust async, so tasks are explicit `.await` points, not preemptible.
- Tokio uses local queue + injection queue, similar to LRQ + GRQ.
- Tokio's reactor (epoll equivalent) is per-worker, not centralised. Better for I/O scaling.
- Tokio has explicit "LIFO slot" similar to `runnext`.
- Tokio fairness rule: 31 polls (vs Go's 61); more aggressive.
- Differences driven by Rust's lack of GC, async/await, and Tokio's I/O-heavy target workload.

### Q33: Could the runtime use a lock-free GRQ?

**Expected**: Yes, in theory. Several lock-free queue algorithms exist (Michael-Scott, LCRQ, etc.). The cost would be in memory ordering complexity and ABA hazards. The current `sched.lock` approach is simple and the GRQ is rarely the hot path (LRQs absorb most traffic). A redesign for lock-free GRQ has been discussed but not implemented.

### Q34: What is the theoretical optimality of half-steal?

**Expected**: Cilk's theorem: for a computation with T_1 total work and T_∞ critical path, the parallel time on P processors is T_P ≤ T_1/P + O(T_∞). Half-steal is asymptotically optimal — any constant fraction would suffice; half is empirically the fastest. The proof rests on a potential-function argument: each successful steal halves the potential, so log(potential) steals suffice.

### Q35: Design a work-stealing scheduler from scratch for a language without GC.

**Expected discussion**:
- LRQ allocation: stack or arena (no malloc per task).
- Task representation: a struct with a function pointer and arg ptr, no GC roots.
- Stealing: same algorithm.
- Memory reclamation: hazard pointers or epoch-based reclamation for stolen tasks (no GC to clean up).
- Difference from Go: explicit lifecycle management; harder API.
- Examples: Cilk++, Intel TBB, Rust's Rayon.

### Q36: When would you *not* use the default Go scheduler?

**Expected discussion**:
- Soft real-time: bounded scheduling latency required. Use `LockOSThread` + dedicated thread + Goroutine-free critical path.
- Very large NUMA: process-per-node may scale better.
- Single-thread requirement (legacy OpenGL, etc.): `LockOSThread` + GOMAXPROCS=1.
- CPU-bound with strict isolation: kernel cgroups + CPU affinity for the whole process.
- For 99% of code, the default is right.

---

## Whiteboard Tasks

### T1: Implement a simple work-stealing scheduler in Go

Show the candidate can build the data structures:

```go
type Worker struct {
    lrq    [256]Task
    head   atomic.Uint32
    tail   atomic.Uint32
}

func (w *Worker) Push(t Task) bool {
    t := w.tail.Load()
    h := w.head.Load()
    if t-h >= 256 {
        return false
    }
    w.lrq[t%256] = t
    w.tail.Store(t + 1)
    return true
}

func (w *Worker) Pop() (Task, bool) {
    t := w.tail.Load()
    h := w.head.Load()
    if h >= t {
        return Task{}, false
    }
    t.Store(t - 1)
    return w.lrq[(t-1)%256], true
}

func (w *Worker) Steal(into *Worker) int {
    for {
        h := w.head.Load()
        t := w.tail.Load()
        n := t - h
        n = n - n/2
        if n == 0 {
            return 0
        }
        // copy half
        for i := uint32(0); i < n; i++ {
            into.lrq[(into.tail.Load()+i)%256] = w.lrq[(h+i)%256]
        }
        if w.head.CompareAndSwap(h, h+n) {
            into.tail.Add(n)
            return int(n)
        }
    }
}
```

Watch for: acquire-release order, ABA, queue full, queue empty edge cases.

### T2: Write a program to demonstrate work stealing

```go
func main() {
    runtime.GOMAXPROCS(4)
    var wg sync.WaitGroup
    for i := 0; i < 1000; i++ {
        wg.Add(1)
        go func(i int) {
            defer wg.Done()
            // record which P ran this G (hard from user code)
            time.Sleep(10 * time.Microsecond)
        }(i)
    }
    wg.Wait()
}
```

Run with `GODEBUG=schedtrace=100` to observe LRQ distribution.

### T3: Read a `go tool trace` and identify a steal

Given a trace, look at:
- A "GoCreate" event on P0 at time t.
- A "GoStart" event on P2 at time t+1μs.
- That's a steal: G created on P0, ran on P2.

### T4: Calculate expected number of steals

For a program with N runnable Gs all initially on P0 and P=8 Ps, how many steals occur?

Answer: Each steal halves the largest queue. From 1024 on P0, first steal: 512 to P1. Then P0=512, P1=512. Next steal: P2 takes 256 from P0 or P1. Etc. After ~log₂(N) steal events, the load is balanced. For N=1024, ~10 steal events. Cilk's analysis confirms O(P log N) steals expected.

---

## Behavioural / Design

### B1: A coworker says "let's implement our own work stealing on top of channels for our worker pool." How do you respond?

**Expected**: The scheduler already does work stealing for you. Implementing it on top of channels is reinventing the wheel and almost certainly slower. Show benchmarks: a simple `for range chan` pool is faster than any user-space stealing.

### B2: A microservice has 10× CPU usage in production vs staging. `GODEBUG=schedtrace` shows high `spinningthreads`. What do you investigate?

**Expected**:
1. Is the workload busier (more goroutines)? Stealers spin only when there is work.
2. Are spinners failing to find work? Check `idleprocs` over time. Mismatch indicates a runtime bug.
3. Profile CPU. If `runtime.findRunnable` dominates, something is wrong with stealing.
4. Check for very short-lived Gs (high churn). Batch them.
5. Check for `LockOSThread` overuse — locked Gs are not stealable but their Ms hold Ps.

### B3: You're designing an API that needs predictable scheduling. What guarantees can you make?

**Expected**: Go does not give scheduling guarantees beyond "eventually runnable Gs run." For predictable latency:
- Use `LockOSThread` + dedicated goroutine + bounded work.
- Set `GOMAXPROCS` to leave headroom.
- Measure tail latency, not just averages.
- Consider Rust or a real-time OS if hard guarantees are needed.

### B4: How would you teach work stealing to a junior?

**Expected**: Start with the analogy (chefs in a kitchen, library returns). Show the LRQ as a bucket with two openings. Walk through `findRunnable` decision tree. Avoid memory ordering and CAS until the picture is clear. Run a `go tool trace` together.

### B5: Argue for or against making the LRQ size configurable.

**Expected**:
- For: workloads with extreme bursts could benefit from larger queues (less overflow).
- Against: configurability is footgun. Tuning is hard. 256 is empirically good. Configurable cap would invite over-tuning and obscure shared-experience knowledge.
- The runtime team has explicitly rejected this. Position is consistent with Go's "few knobs" philosophy.

---

End of interview prep. For practical exercises, see `tasks.md`.
