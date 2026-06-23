# Livelock — Interview Preparation

## Table of Contents
1. [How Livelock Appears in Interviews](#how-livelock-appears-in-interviews)
2. [Definition Questions](#definition-questions)
3. [Code-Reading Questions](#code-reading-questions)
4. [Code-Writing Questions](#code-writing-questions)
5. [Diagnosis Questions](#diagnosis-questions)
6. [Distributed-Systems Questions](#distributed-systems-questions)
7. [Curveballs](#curveballs)
8. [How to Talk About Livelock](#how-to-talk-about-livelock)

---

## How Livelock Appears in Interviews

Livelock comes up at three levels of interview:

- **Junior / mid-level coding interviews:** rare on its own. May appear as a follow-up to a deadlock question ("…and what is livelock?").
- **Senior / staff systems design:** common. Expected to know definitions, cures, and at least one production story.
- **Distributed systems specialised role:** central. Expected to know Paxos/Raft livelock, AWS jitter paper, AIMD, formal liveness properties.

The questions sort into seven buckets. Below are exemplary questions with full answers in interview voice.

---

## Definition Questions

### Q: What is livelock?

**A:** A livelock is a concurrency bug where two or more execution units — goroutines, threads, processes — are running and reacting to one another but the system makes no useful progress. The classic analogy is two polite people in a hallway who keep stepping out of each other's way and re-colliding. From the outside, the program looks busy: CPU is high, no panics, no deadlock detector firing. But work-per-second is zero. The cure is to break the symmetry of the reaction, usually with random jitter on back-off, sometimes with priority based on a stable property.

### Q: What is the difference between livelock and deadlock?

**A:** In deadlock, all involved goroutines are blocked — waiting on a lock, channel, or condition variable. They consume no CPU. The Go runtime can sometimes detect this and panic with "all goroutines are asleep." In livelock, all involved goroutines are running — burning CPU, executing instructions, retrying. The runtime cannot detect this because nothing is "stuck" in the runtime sense. Deadlock is a *waiting* bug, livelock is a *reacting* bug. The cures differ: lock ordering for deadlock, randomisation or priority for livelock.

### Q: What is the difference between livelock and starvation?

**A:** Starvation means one goroutine is unfairly denied a resource while others get it — the system is making progress, just not for the victim. Livelock means *no one* makes progress; the entire system is stalled despite running. Starvation has fairness as its cure (FIFO queues, ticket locks). Livelock has symmetry-breaking as its cure.

### Q: What is the difference between livelock and contention?

**A:** Contention is competition for a resource — multiple goroutines wanting the same lock. Contention slows progress proportionally but progress continues. Livelock is when contention becomes pathological: most of the cost is in retry/wait overhead, and throughput is bounded *below* the cost of the critical section. An operational test: halve the goroutines. If throughput doubles, you had contention. If throughput more than doubles, you had livelock.

---

## Code-Reading Questions

### Q: Look at this code. Will it livelock?

```go
var counter atomic.Int64
const goroutines = 1000

var wg sync.WaitGroup
for i := 0; i < goroutines; i++ {
    wg.Add(1)
    go func() {
        defer wg.Done()
        for j := 0; j < 100; j++ {
            for {
                old := counter.Load()
                if counter.CompareAndSwap(old, old+1) {
                    break
                }
            }
        }
    }()
}
wg.Wait()
```

**A:** It will eventually finish — this is a *lock-free* algorithm, so at least one goroutine makes progress per round. But it exhibits the symptoms of livelock under heavy contention: with 1000 goroutines, the CAS success probability per attempt drops to roughly 1/1000, and most of the CPU is wasted on failed CAS. The fix here is to use `counter.Add(1)`, which is a single atomic instruction with no retry. For more complex updates, the cures are sharding, back-off with jitter inside the loop, or a `sync.Mutex` at high contention.

### Q: What about this?

```go
for {
    if mu.TryLock() {
        defer mu.Unlock()
        doWork()
        return
    }
    time.Sleep(10 * time.Millisecond)
}
```

**A:** Yes — this is livelock-prone if multiple goroutines hit it simultaneously. They all back off the same fixed amount, retry at the same instant, collide again, repeat. The cure is to add jitter to the sleep: `time.Sleep(time.Duration(rand.Int63n(int64(10*time.Millisecond))))` or use a back-off library like `cenkalti/backoff`. Better yet, use `mu.Lock()` directly — `sync.Mutex` parks losers in a FIFO queue, which prevents both livelock and the starvation patterns.

### Q: Why is this safe but slow?

```go
for {
    a.Lock()
    if b.TryLock() {
        doWork()
        b.Unlock()
        a.Unlock()
        return
    }
    a.Unlock()
}
```

**A:** This is safe — it cannot deadlock because we always release `a` before retrying, so we never hold one lock waiting for another. But it is *slow* and livelock-prone. Under heavy contention many goroutines may repeatedly acquire `a`, fail `b`, release `a`. The cure is to acquire both locks in a fixed global order (sort by address or by ID) and use plain `Lock()` on each. That eliminates the retry loop entirely.

---

## Code-Writing Questions

### Q: Write a function that retries an HTTP call with exponential back-off and jitter, respecting a context deadline. Up to 5 attempts.

**A:**
```go
import (
    "context"
    "math/rand/v2"
    "net/http"
    "time"
)

func RetryHTTP(ctx context.Context, do func(context.Context) (*http.Response, error)) (*http.Response, error) {
    const maxAttempts = 5
    base := 100 * time.Millisecond

    var lastErr error
    for attempt := 0; attempt < maxAttempts; attempt++ {
        resp, err := do(ctx)
        if err == nil && resp.StatusCode < 500 {
            return resp, nil
        }
        lastErr = err
        if resp != nil {
            resp.Body.Close()
        }
        // exponential with full jitter
        d := base << attempt
        if d > 5*time.Second {
            d = 5 * time.Second
        }
        sleep := time.Duration(rand.Int64N(int64(d)))
        select {
        case <-time.After(sleep):
        case <-ctx.Done():
            return nil, ctx.Err()
        }
    }
    return nil, lastErr
}
```

Key points to call out in the answer:
- Full jitter (random sleep in `[0, d)`), not constant.
- Bounded attempts (5).
- Cap on back-off (5 s).
- Context cancellation honoured.
- Status 5xx triggers retry; 4xx (probably) should not — adjust to taste.

### Q: Write a livelock-free counter.

**A:**

```go
type ShardedCounter struct {
    shards [64]struct {
        v atomic.Int64
        _ [56]byte // pad to cache line
    }
}

func (c *ShardedCounter) Inc() {
    shard := goroutineSlot() % 64
    c.shards[shard].v.Add(1)
}

func (c *ShardedCounter) Sum() int64 {
    var s int64
    for i := range c.shards {
        s += c.shards[i].v.Load()
    }
    return s
}
```

Note: every increment is one atomic instruction. No CAS loop, no contention beyond cache-line bouncing (which the padding mitigates). Reads are O(shards) and slightly stale but typically that is acceptable for counters.

If pressed: the cheap alternative is just `atomic.Int64.Add(1)` on one counter. That works fine until you have thousands of goroutines hammering it. Sharding solves the contention.

---

## Diagnosis Questions

### Q: Your service has high CPU and zero throughput. Walk me through the diagnosis.

**A:**

1. **Rule out a leak.** Check `runtime.NumGoroutine` over time. Stable count rules out a leak.
2. **Capture a CPU profile.** `go tool pprof http://localhost:6060/debug/pprof/profile?seconds=30`. Look at the top hot function. If it is a retry loop, CAS, or `TryLock`, livelock is likely.
3. **Capture a goroutine dump.** `curl 'http://localhost:6060/debug/pprof/goroutine?debug=2'`. Many goroutines with similar stacks pointing at the same retry path is the smoking gun.
4. **Capture metrics.** `attempts/s` should be high; `success/s` should be low. The ratio is the livelock signal.
5. **Mitigate.** Reduce load via load shedding, reduce goroutine count, or add jitter via configuration.
6. **Fix.** Find the loop, add jitter or replace with a livelock-free algorithm, deploy, monitor.

### Q: Can the race detector find livelock?

**A:** No. The race detector finds *races* — unsynchronised concurrent access to the same memory. Livelock is purely a liveness problem with correctly synchronised code. The cures for livelock and races are unrelated.

### Q: What does livelock look like in `go tool trace`?

**A:** Lots of very short execution bursts per goroutine, separated by short scheduler events. The trace appears "busy" — many goroutines running, many context switches — but if you sample any one goroutine over time, it spends most of its life retrying. Useful work is sparse.

---

## Distributed-Systems Questions

### Q: How does Raft prevent livelock during leader election?

**A:** Randomised election timeouts. Each follower waits a random time (typically 150–300 ms with significant jitter) before becoming a candidate. The randomness ensures that two followers rarely time out simultaneously, so split votes are rare. If a split vote does occur, the term ends and a new round of randomised timeouts begins; the probability of another split decreases geometrically. This is literally the polite-people problem solved by jitter, applied to a five-node cluster.

### Q: How does Paxos avoid duelling proposers?

**A:** Basic Paxos can livelock — two proposers can repeatedly preempt each other's accept phase. Multi-Paxos solves this by designating a single *distinguished proposer* (the leader); only the leader proposes during steady state. Election of the leader uses its own protocol with timeouts and randomisation, similar to Raft.

### Q: What is "decorrelated jitter"? Why is it the gold standard?

**A:** Decorrelated jitter is a back-off scheme where each new delay is uniformly random in `[base, prev * 3]`, capped at a maximum. Unlike full jitter (where each delay is independent of the last), decorrelated jitter has memory — back-off grows over time but in a randomised way. The AWS Architecture Blog post by Marc Brooker (2015) showed via simulation that decorrelated jitter converges fastest under retry storms and produces the most uniform load distribution at the server. It is the default in AWS SDKs and is the recommended starting point for most distributed retry policies.

### Q: When would you use AIMD?

**A:** Additive Increase, Multiplicative Decrease — borrowed from TCP. Use it when:
- Downstream capacity is unknown or varies.
- Concurrency cannot be hand-tuned.
- You operate close to the saturation point and need a self-adjusting policy.

The intuition: failures are expensive evidence of overload, so cut concurrency hard (multiplicatively). Success is gradual evidence of headroom, so grow slowly (additively). AIMD converges on the largest sustainable concurrency. Libraries like `github.com/platinummonkey/go-concurrency-limits` implement this for Go.

---

## Curveballs

### Q: Can you have livelock with a single goroutine?

**A:** Strictly, no — livelock requires two parties reacting to each other. A single goroutine in an infinite loop is just an infinite loop. However, some authors extend the definition: a goroutine retrying against an external system (network, database) where the external system's behaviour causes repeated failure is sometimes called "livelock" — and informally that is fine. The external system is the second party.

### Q: Can channels livelock?

**A:** Yes. A common pattern: goroutine A sends to channel `chB` only when receiving from `chA`; goroutine B sends to `chA` only when receiving from `chB`. Neither initiates, so neither completes — but the goroutines are not blocked, they are spinning in `select` with a `default` case. It is unusual but possible.

### Q: Is a goroutine in `default:` of an empty `select` livelock?

**A:** Borderline. If the `select` has only a `default` and runs in a `for` loop, you have a busy-wait. If there are other cases that just never fire (because no one sends to them), it is functionally a busy-wait that the scheduler cannot park. Whether you call it livelock depends on whether the "stuck" goroutine is reacting to others. If yes — livelock. If no — just a tight loop.

### Q: Does `runtime.Gosched()` cure livelock?

**A:** No. `Gosched` yields the CPU, but the goroutine remains runnable and will run again, immediately re-entering the livelock pattern. It can reduce the *symptom* (less wall-clock CPU consumption) without curing the underlying bug. Real cures: jitter, priority, algorithm change.

### Q: How does Go's `sync.Mutex` itself avoid livelock?

**A:** Two ways. First, bounded spinning — a goroutine trying to acquire the mutex spins for a few iterations only, after which it parks (sleeps until woken). Spinning is for the case where the holder releases soon; parking is for the case where it does not. Second, *starvation mode* — if a waiter has been queued for more than 1 ms, the mutex switches to FIFO-strict mode where newcomers cannot bypass the queue. This prevents the livelock between newcomers and the FIFO head. The source is in `src/sync/mutex.go` and is worth reading.

### Q: Why doesn't `for { try() }` work as a retry strategy under contention?

**A:** Two reasons. First, no back-off means every failed attempt is immediately followed by another attempt, wasting CPU. Second, no jitter means multiple goroutines synchronise on the same scheduling rhythm — if two goroutines both retry on every scheduler tick, they collide on every tick. The pattern needs both back-off (slow down) and jitter (desynchronise).

---

## How to Talk About Livelock

### In a system design

When the interviewer asks "what about retries?", say something like:

> "We retry on transient failures with exponential back-off and decorrelated jitter, capped at some maximum. Every retry honours a context deadline. Each call has a retry budget of, say, three attempts. Server-side, when we return 5xx, we set `Retry-After` to hint clients. We also publish `attempts` and `success` metrics so we can alert on livelock-like patterns."

This signals you have thought about it and not just "we just retry."

### In a debugging story

A good interview story has shape:

> "We had an incident where checkout latency exploded under burst load. Symptoms were: CPU at 98%, throughput dropped, no panic, goroutine count stable. We pulled a `pprof` CPU profile, which showed `TryLock` and our retry helper at the top. Goroutine dump confirmed: 200 goroutines all in the same retry function. Root cause was a fixed-millisecond sleep with no jitter. Fix was three lines — replace the sleep with a jittered version. We then added `attempts`/`success` counters with an alert on the ratio."

The shape: symptom, evidence, root cause, fix, follow-up.

### Avoid these phrases

- "Just add more retries." (Amplifies livelock.)
- "Just call `runtime.Gosched()`." (Not a cure.)
- "Channels prevent this kind of thing." (Sometimes; not always.)
- "It is just performance." (Livelock with zero throughput is correctness.)

### Phrases that signal mastery

- "Symmetric reaction with no tie-breaker."
- "Exponential back-off with full / decorrelated jitter."
- "Bounded retries with context cancellation."
- "Success-rate metric alongside attempt-rate."
- "Load shedding on the server side."
- "Sharded counter instead of CAS loop."
- "Mutex starvation mode prevents livelock."
- "Randomised election timeouts."

---

The interview test for this topic: can you explain livelock to a colleague in two minutes, give one Go example, and give one cure? If yes, you pass the bar. The rest is depth that helps in senior and staff rounds.
