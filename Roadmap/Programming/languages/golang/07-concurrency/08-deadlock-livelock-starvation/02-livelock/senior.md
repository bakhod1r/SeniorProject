# Livelock — Senior Level

## Table of Contents
1. [Introduction](#introduction)
2. [Livelock as a Liveness Property](#livelock-as-a-liveness-property)
3. [CAS-Loop Livelock at the Algorithmic Level](#cas-loop-livelock-at-the-algorithmic-level)
4. [Lock-Free Data Structures and Helping](#lock-free-data-structures-and-helping)
5. [Mutex Internals — How sync.Mutex Avoids Livelock](#mutex-internals-how-syncmutex-avoids-livelock)
6. [Distributed Livelock](#distributed-livelock)
7. [Paxos, Raft, and Vote Contention](#paxos-raft-and-vote-contention)
8. [Snapshot Consistency Loops](#snapshot-consistency-loops)
9. [Adaptive Back-Off and AIMD](#adaptive-back-off-and-aimd)
10. [Formal Verification of Liveness](#formal-verification-of-liveness)
11. [Production Case Studies](#production-case-studies)
12. [Summary](#summary)

---

## Introduction

The senior level treats livelock not as a bug to avoid but as a *property* to reason about. You can:

- State liveness in temporal-logic terms.
- Reason about CAS-loop convergence under specific contention models.
- Read the `sync.Mutex` source and explain why it switches to "starvation mode."
- Identify distributed-systems livelock — Paxos duels, Raft split votes, snapshot loops — and recommend the right cure.
- Apply AIMD (Additive Increase Multiplicative Decrease) and adaptive back-off to retry storms.
- Choose between optimistic and pessimistic concurrency control based on workload.

This file assumes mastery of the junior and middle materials. The examples are short because the reasoning is heavy.

---

## Livelock as a Liveness Property

Concurrency correctness has two pillars:

- **Safety:** "Something bad never happens." Formalised as invariants over states.
- **Liveness:** "Something good eventually happens." Formalised as eventualities in temporal logic.

Livelock is a *liveness violation*. In temporal-logic terms (LTL/CTL), a liveness property looks like:

```
◇ (request_completed)
```

"Eventually, the request completes." Livelock means there exists an infinite execution where the eventuality never fires.

Stronger liveness properties:

- **Bounded liveness:** "Within N steps, something good happens."
- **Fairness:** "If a goroutine can run, it eventually does."
- **Progress:** "If the system has work, some work completes."

Livelock violates bounded liveness even when fairness holds — every goroutine runs, but no work completes. This makes livelock distinct from starvation, which is *unfair* progress.

In Go, you cannot easily prove liveness formally, but you can:

1. Test that throughput stays above a threshold under realistic load.
2. Assert in tests that a counter increments within a deadline.
3. Use chaos testing to provoke worst-case contention and watch metrics.

---

## CAS-Loop Livelock at the Algorithmic Level

A CAS loop is *lock-free* by definition: at least one thread makes progress in a bounded number of steps. But "at least one" is a poor guarantee under heavy contention — the other `N-1` waste cycles.

### The lock-free hierarchy

| Property | Definition |
|---|---|
| **Obstruction-free** | A thread that runs in isolation makes progress in bounded steps. The weakest non-blocking property. |
| **Lock-free** | At least one thread makes progress in bounded steps. |
| **Wait-free** | Every thread makes progress in bounded steps. The strongest. |

A CAS loop is *lock-free*. It is generally *not* wait-free: a specific thread can be unlucky for an unbounded number of rounds. Under heavy contention, the lucky/unlucky distinction creates near-starvation alongside near-livelock.

### Wait-free counter via local accumulation

To make a counter wait-free under contention, give each goroutine its own counter and aggregate:

```go
type WaitFreeCounter struct {
    perGoroutine []atomic.Int64 // one per logical goroutine slot
}

func (c *WaitFreeCounter) Inc(slot int) {
    c.perGoroutine[slot].Add(1) // single instruction, always succeeds
}

func (c *WaitFreeCounter) Sum() int64 {
    var s int64
    for i := range c.perGoroutine {
        s += c.perGoroutine[i].Load()
    }
    return s
}
```

Every increment succeeds in O(1) instructions, regardless of contention. The cost is that `Sum` is O(N) and slightly stale.

### Bounded retries as a livelock cure

When the algorithm requires a CAS loop, bound the retries:

```go
for attempt := 0; attempt < maxAttempts; attempt++ {
    old := state.Load()
    new := compute(old)
    if state.CompareAndSwap(old, new) {
        return nil
    }
}
return ErrTooMuchContention
```

When `maxAttempts` is exceeded, fall back to a pessimistic path (mutex) or surface an error. This converts a potential livelock into a bounded latency hiccup.

### Back-off in CAS loops

Inside a CAS loop, you can back off between attempts:

```go
for attempt := 0; ; attempt++ {
    old := state.Load()
    new := compute(old)
    if state.CompareAndSwap(old, new) {
        return
    }
    if attempt > 3 {
        runtime.Gosched()             // yield CPU
    }
    if attempt > 10 {
        time.Sleep(backoff(attempt))  // exponential + jitter
    }
}
```

This pattern appears in `sync/atomic.Value` and parts of the Go runtime. The first few attempts spin (fast); later attempts yield (cheap); much later attempts sleep (slow but kind to the scheduler).

---

## Lock-Free Data Structures and Helping

In a lock-free linked-list, queue, or skip-list, multiple goroutines can be in the middle of conflicting modifications. A naïve design has a thread retry indefinitely if every attempt fails — a livelock.

The classic cure: **helping**. When goroutine A sees goroutine B's operation half-finished, A *helps* B finish before retrying its own work. This guarantees progress: each retry either completes A's operation or completes another goroutine's, so total work always advances.

Helping in Go is rare in user code but appears in libraries:

- The Java `ConcurrentSkipListMap` uses helping in deletion.
- Linux's RCU uses helping in some grace-period flushers.
- Some Go runtime structures use a simplified form.

For application code, helping is usually overkill — switching to a mutex is simpler. Senior engineers know it exists and can recognise it in literature.

---

## Mutex Internals — How sync.Mutex Avoids Livelock

`sync.Mutex` is engineered to avoid both livelock and starvation. The source in `src/sync/mutex.go` is a good read.

### Two modes: normal and starvation

In **normal mode**, a goroutine trying to acquire the mutex first *spins* a few times (busy-waits, hoping the holder releases soon). If spinning does not work, it joins a FIFO of waiters and parks.

The spin step is important — it avoids the cost of parking and waking when the critical section is microsecond-short. But spinning is itself a livelock risk: many goroutines all spinning waste CPU. The Go runtime limits spinning to a few iterations and only if `GOMAXPROCS > 1`.

In **starvation mode**, the FIFO discipline is enforced strictly: the mutex is handed directly to the next waiter on `Unlock`, with no further spinning by newcomers. This prevents livelock between newcomers and the FIFO head — newcomers cannot starve waiters who have been waiting.

Starvation mode is entered when a waiter has been queued for more than 1 ms. It exits when the queue empties or a waiter takes the mutex while being the last in the queue.

### Why this matters for livelock

The naïve spinlock — `for !atomic.CompareAndSwap(&locked, 0, 1) {}` — is a textbook livelock under heavy contention. `sync.Mutex` adds:

1. **Bounded spin.** No goroutine spins forever.
2. **Parking.** After bounded spin, losers park and stop burning CPU.
3. **FIFO with bounded delay.** Starvation mode ensures the head of the queue eventually wins.

When you see a "homemade mutex" in code, look for these properties. A bare CAS loop has none of them.

### Reading the source

`src/sync/mutex.go` is 250 lines and worth a careful read. Key functions:

- `(*Mutex).Lock` — slow path goes to `lockSlow`.
- `(*Mutex).lockSlow` — the spin/park decision logic.
- The constants `starvationThresholdNs = 1e6` (1 ms).

---

## Distributed Livelock

The livelock pattern scales from goroutines to processes to services. Two databases doing optimistic concurrency, two distributed locks, two leader candidates — all can livelock the same way two goroutines do.

### Example: distributed retry on conflict

Service A and Service B both update record R. They use optimistic concurrency: read, compute, conditional-write. If the write fails because R changed, retry.

If A and B both retry on the same schedule, they re-conflict. Add jitter (server-side, ideally) and the conflicts decorrelate.

### Example: leader election livelock

Two candidates use a naive election protocol:

```
candidate A: "I am leader if no one else is."
candidate B: "I am leader if no one else is."
```

Both see the other and demote. Both see emptiness and promote. The cycle continues.

The cure is the same as in goroutines:

- **Priority**: one candidate has lower ID and wins ties.
- **Random TTL**: each candidate sets its claim with random TTL; the longer-lived wins.
- **Quorum**: require a majority vote; ties are impossible.

### Example: distributed sagas with compensation

A distributed transaction (saga) may compensate on failure. If compensation triggers another transaction that fails for the same reason, you can enter a compensation/retry cycle.

The cure: each compensation is *terminal* (no further retry) or has a different code path than the forward transaction.

---

## Paxos, Raft, and Vote Contention

Both Paxos and Raft can experience livelock in the form of split votes or duelling leaders.

### Paxos duels

In basic Paxos, two proposers can each get a majority promise but neither gets a majority accept, because the other always preempts. Without intervention, they duel forever.

The cure in Multi-Paxos is to elect a *distinguished proposer* — only the leader proposes, eliminating the duel. The famous footnote in Lamport's "Paxos Made Simple": "If two proposers keep issuing a sequence of proposals with increasing numbers, none of them ever chosen, this leads to liveness failure."

### Raft split votes

Raft elects a leader by requiring a majority of votes. If two candidates campaign simultaneously and each gets some votes but neither a majority, the term ends inconclusively and a new election starts. Without intervention, this can repeat.

The cure is **randomised election timeouts**:

- Each follower waits a random time (typically 150–300 ms) before becoming a candidate.
- The probability that two followers time out at the same time is small.
- After a few rounds, the elections decorrelate and one candidate wins.

This is literally the polite-people problem with random jitter as the cure, applied to a five-node cluster.

```go
electionTimeout := 150*time.Millisecond +
    time.Duration(rand.Int63n(int64(150*time.Millisecond)))
```

The Raft paper (Ongaro & Ousterhout, 2014) discusses this in section 5.2.

### Lessons for application code

If your code does any form of consensus, leader election, or "let's all agree on X":

- Randomise timeouts.
- Use majority quorums where possible.
- Designate a distinguished proposer / leader for steady-state operation.
- Bound the number of rounds before declaring an unrecoverable failure.

---

## Snapshot Consistency Loops

A snapshot must observe a *consistent* state — all reads must reflect the same point in time. One way to take a snapshot of a concurrent structure:

```go
for {
    epoch1 := version.Load()
    data := readEverything()
    epoch2 := version.Load()
    if epoch1 == epoch2 {
        return data
    }
}
```

If `version` changes during `readEverything`, retry. Under heavy write traffic, this loop may never see a stable epoch — the writer mutates faster than the reader can scan. A livelock.

Cures:

1. **Bound reader retries.** After N attempts, take a read lock and serialise with writers briefly.
2. **MVCC.** Multi-version concurrency control gives readers a fixed snapshot pinned by version number. Writers create new versions; the reader's version stays stable.
3. **Copy-on-write.** The reader sees a frozen pointer; writers create a new structure and atomically swap.
4. **Two-phase reads.** First phase: read counters and watermarks. Second phase: read data; if watermarks moved beyond the second-phase start, retry.

PostgreSQL, CockroachDB, and Spanner all use MVCC. Go's `sync.Map` uses a form of copy-on-write for the read map.

---

## Adaptive Back-Off and AIMD

Constant-policy back-off is brittle. Under low load, exponential back-off slows recovery unnecessarily. Under high load, it may not back off enough. **Adaptive** back-off adjusts based on observed outcomes.

### AIMD (Additive Increase, Multiplicative Decrease)

The classic TCP congestion control policy. Translated to retry:

- On success: increase concurrency *additively* (add one slot).
- On failure: decrease concurrency *multiplicatively* (halve slots).

```go
type AIMD struct {
    permits int
    mu      sync.Mutex
}

func (a *AIMD) OnSuccess() {
    a.mu.Lock()
    a.permits++
    a.mu.Unlock()
}

func (a *AIMD) OnFailure() {
    a.mu.Lock()
    a.permits = max(1, a.permits/2)
    a.mu.Unlock()
}
```

The intuition: failures are expensive, so cut deeply; success is informative but slow, so grow slowly. AIMD converges on the largest concurrency level that the downstream can sustain.

In retry contexts:

- Concurrent requests are throttled by `permits`.
- On a 429, drop `permits` multiplicatively.
- On a 200, raise `permits` additively.

This is the same control loop that prevents TCP livelock on the wire, applied at the application layer.

### Concurrency limits libraries

`github.com/platinummonkey/go-concurrency-limits` ports Netflix's *concurrency-limits* library to Go. It uses AIMD-style adaptation to size connection pools and request concurrency dynamically.

For most Go services, a fixed-size pool plus jittered retry is enough. AIMD becomes valuable when:

- Downstream capacity varies (autoscaling, multi-tenant).
- You cannot tune concurrency manually.
- You operate close to the saturation point.

---

## Formal Verification of Liveness

In rigorous design work, liveness can be checked with model checkers:

- **TLA+ / TLC.** Lamport's specification language. You write the algorithm and the liveness property; TLC explores all reachable states and reports if liveness can fail.
- **SPIN.** Older but powerful model checker for distributed protocols.
- **P language.** Microsoft's framework for asynchronous systems with built-in liveness checks.

For application code, formal verification is overkill. For coordination protocols, leader election, or replication algorithms, a TLA+ spec can catch livelock that load testing cannot.

Example TLA+ liveness specification:

```
\* "If a request is submitted, it eventually completes."
SF_vars(Process)
[](RequestSubmitted => <>RequestCompleted)
```

The `SF` is *strong fairness* — `Process` must be scheduled infinitely often. The square-diamond is "always, eventually." TLC explores executions and reports any infinite execution where a submitted request never completes.

The take-home for senior engineers: when your protocol is complex enough that you write down a state machine on paper, consider a TLA+ spec. It is faster than debugging a livelock that only appears in production.

---

## Production Case Studies

### Case 1: AWS DynamoDB and the 2015 outage

A retry storm caused DynamoDB partitions to fall over. Clients retried aggressively without sufficient jitter; metadata operations piled up. The cure described in AWS's post-mortem was decorrelated jitter (the source of the eponymous algorithm).

Source: "Exponential Backoff and Jitter," AWS Architecture Blog, Marc Brooker, 2015.

### Case 2: GitHub MySQL leader election (2018)

A bug in the leader-election library caused two nodes to alternate as leader. Each saw the other and yielded; each saw nothing and took over. The fix was randomised lease TTLs.

### Case 3: Cassandra repair and entropy loops

Cassandra's anti-entropy repair process is iterative. Under heavy write load, a node's hash trees can mutate faster than the repair can complete, causing repair to retry the same range repeatedly. The fix involves bounded retries and incremental repair (covers smaller ranges per cycle).

### Case 4: Etcd v3 watcher synchronisation

Older versions of etcd had a livelock in the watch-stream re-sync logic: a slow watcher missed events, requested replay, missed more events during replay, requested another replay. The cure was a fast-forward to the latest revision on replay timeout.

### Case 5: A Go microservice with TryLock back-off

A real production case I have seen: a Go service used `Mutex.TryLock` plus `time.Sleep(time.Millisecond)` to "politely" wait for a hot row. Under burst traffic (500 RPS on the same row), all goroutines synchronised on the millisecond tick and contention reached 99%. The fix was a four-line jitter addition.

---

## Summary

Senior-level mastery of livelock is the ability to:

- Reason about it as a liveness property in formal terms.
- Recognise it across scales — from CAS loops in a single process to distributed consensus.
- Read the `sync.Mutex` source and understand why it switches to starvation mode.
- Apply the right cure for the right scale: jitter for retry storms, AIMD for adaptive throttling, helping for lock-free data structures, randomised timeouts for consensus.
- Decide when to formally verify with TLA+ versus rely on testing.

The professional level extends this to algorithm design — building systems that are *provably* livelock-free under the workload they serve.

Continue to `professional.md` for the design-level treatment.
