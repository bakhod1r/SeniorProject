---
layout: default
title: Channels vs Mutexes — Interview
parent: Channels vs Mutexes
grand_parent: Primitives Decision Guide
ancestor: Go
nav_order: 7
has_children: false
permalink: /roadmap/programming-languages/golang/07-concurrency/24-primitives-decision-guide/01-channel-vs-mutex/interview/
---

# Channels vs Mutexes — Interview

[← Back](../)

A bank of 30+ questions ordered roughly junior → middle → senior → staff. Each has a short ideal answer; the depth of the answer scales with the level.

---

## Junior tier

**1. What is the Go proverb "do not communicate by sharing memory; share memory by communicating" actually saying?**
It is a *preference*, not a law. When two goroutines need to cooperate on data, the cleaner default is to transfer ownership over a channel rather than letting both touch the same memory under a lock. It is not a ban on `sync.Mutex`; the same proverb's author wrote `sync.Mutex` and uses it daily.

**2. What is a data race?**
Two goroutines accessing the same memory location without synchronisation, at least one of them writing. Undefined behaviour in Go — the compiler is permitted to assume no races exist.

**3. When does the race detector report a race?**
At run time, when `-race` is on, the runtime instruments every memory access and pairs it with happens-before edges from channel ops and lock ops. If two accesses are unordered and at least one is a write, it prints a report.

**4. What is `sync.Mutex`'s zero value?**
Unlocked. You never need `mu := sync.Mutex{}` explicitly; declaring `var mu sync.Mutex` already gives a usable lock.

**5. Default value of an unmade channel?**
`nil`. Sending or receiving on it blocks forever. Closing it panics.

**6. What happens if you send on a closed channel?**
Panic: "send on closed channel".

**7. What happens if you receive from a closed channel?**
You get the element's zero value immediately, along with `ok = false` if you use the two-value form.

**8. Can you close a channel twice?**
No — second close panics.

**9. Who should close a channel?**
The single goroutine that owns the send side. Receivers must not close channels they receive from.

---

## Middle tier

**10. Give a one-line rule for choosing between mutex and channel.**
If the data has an owner that hands it off, use a channel. If many goroutines need to read/write the same in-place memory, use a mutex.

**11. Why is `chan struct{}` of capacity 1 a poor substitute for `sync.Mutex`?**
It allocates an `hchan` (~96 bytes), goes through the scheduler on contention, and produces worse benchmarks. The mutex is the right primitive for *exclusion*; a channel is the right primitive for *handoff*. Don't conflate.

**12. When is `sync.RWMutex` faster than `sync.Mutex`?**
Only when the read-side critical section is meaningful work *and* readers vastly outnumber writers (typically 10x+). For sub-microsecond reads, `RWMutex` is slower because of its more complex internal accounting.

**13. Is `sync.Map` always faster than `map + sync.RWMutex`?**
No. `sync.Map` is optimised for two workloads: (a) write-once read-many, and (b) disjoint keys per goroutine. Mixed read/write on overlapping keys is often slower than a plain `RWMutex`-protected map.

**14. What does the Go memory model guarantee about channel sends?**
A send happens-before the completion of the corresponding receive. The k-th receive on a buffered channel of capacity C happens-before the (k+C)-th send.

**15. What does the memory model guarantee about mutexes?**
The n-th `Unlock` happens-before the (n+1)-th `Lock`. Anything written before unlocking is visible after the next lock.

**16. Why must you not copy a `sync.Mutex` after first use?**
Internal state (locked bit, waiter count) lives in the bits of the value. A copy has the same bits but is a different object — locking the copy doesn't lock the original, and vice versa. `go vet` flags this via the `copylocks` pass.

**17. Can two goroutines lock and unlock the *same* mutex from different goroutines?**
Yes. The spec explicitly allows it: "A locked Mutex is not associated with a particular goroutine." This is unusual in other languages and is sometimes used to implement handoff.

**18. Worker pool: channels or mutex?**
Channels are the canonical Go answer. A bounded channel of jobs in, N worker goroutines that range over it, a `WaitGroup` to wait for them. Mutex-based work queues exist but are clunkier and need a condvar to wait when the queue is empty.

**19. Semaphore with a buffered channel — how?**
A `chan struct{}` of capacity N. Acquire by sending, release by receiving. Cheap, idiomatic, and integrates with `select` so you can add timeouts.

**20. What's wrong with `for { select { case <-done: return ... } }` if `done` is never closed?**
The goroutine leaks. The `done` channel must be closed exactly once by the owner of the cancellation; if no one closes it, the goroutine sits in the scheduler forever.

---

## Senior tier

**21. Refactor decision: a shared counter incremented from 1000 goroutines a million times each — which primitive?**
`sync/atomic`. A mutex serialises everything and produces a hot lock; a channel-based counter is roughly 50x slower. `atomic.Int64.Add` is one instruction (lock-prefixed `xadd` on x86).

**22. Refactor decision: a long-lived cache that 99% of the time is read, 1% updated, with values that take microseconds to read?**
`sync.RWMutex` around a plain `map`. The reads run in parallel; the writer is rare; the read-side critical section is large enough that the RWMutex's bookkeeping is amortised.

**23. Refactor decision: a producer goroutine that decodes frames from a network connection, a consumer goroutine that compresses them?**
Channel. This is exactly what channels were designed for — ownership transfer between two stages of a pipeline. Pick a small buffer (1 to 64) to decouple bursty production from compression latency.

**24. When does a buffered channel become a *liability*?**
When the buffer hides a backpressure problem. Producers don't block when consumers fall behind; they pile work in the buffer; latency grows silently. An unbuffered channel surfaces the problem immediately. The rule is: pick a buffer size only when you can justify the number with a measured burst size.

**25. Hybrid pattern: a service maintaining an in-memory state machine that handles command events from a channel — mutex or channel?**
Channel for the events, no mutex needed. One goroutine owns the state machine. All mutations happen on that goroutine in response to events. This is the actor pattern.

**26. Library API design: should you take a `chan T` or a callback?**
Callback if the consumer might want to apply backpressure (return errors, throttle). Channel if the consumer is a downstream pipeline stage and you control both sides. Channels in public APIs are a long-term commitment — once you publish `Out() <-chan Event`, you can't change the buffer size or the close semantics without breaking callers.

**27. Why does `time.After(d)` leak in long-running loops, and how do channels relate?**
Each call allocates a new `*time.Timer` whose channel stays alive until the duration elapses. In a hot select loop, this allocates and queues timers per iteration. Fix: hoist a single `time.NewTimer`, `Reset` it each iteration. The relevance: a channel is not free — there's allocation, a runtime timer, and a heap object behind every `time.After`.

**28. How do you wait for the first of N goroutines to produce a result and cancel the rest?**
A shared result channel of size 1 with non-blocking sends (so late goroutines drop their result), plus a `context.Context` for cancellation. `errgroup.Group` with a context works in production; the underlying mechanism is exactly this.

**29. Why is `select { case ch <- v: default: }` (non-blocking send) often a code smell?**
You are silently dropping data. The pattern is correct for "best-effort" signalling (a `chan struct{}` triggering reconciliation) but wrong for events that must be observed. The discipline is to be loud about which case you are in.

**30. What is the `hchan` data structure?**
A heap-allocated struct in `src/runtime/chan.go` containing the ring buffer (`buf`, `dataqsiz`, `qcount`, `sendx`, `recvx`), two `sudog` linked lists (`sendq`, `recvq`) of parked goroutines, a `Mutex` (yes, a mutex protects the channel internals), and a `closed` flag.

**31. How does `selectgo` choose which case to run when several are ready?**
It generates a pseudo-random permutation of the case indices and iterates in that order. This is what makes `select` "fair" — you cannot rely on case order.

---

## Staff tier

**32. Two production engineers disagree: one says "we have too many channels", the other says "we have too many locks". How would you adjudicate?**
Pull a CPU profile under load. Channels cost in `chansend`/`chanrecv`/`selectgo`/`goschedguarded` and in scheduler wakeups. Locks cost in `sync.runtime_SemacquireMutex` and `procyield`. The dominant cost in the profile is your bottleneck. Then look at *what those primitives guard*: ownership-transfer code paths with mutexes deserve channels, while spinning RWMutex on a flat counter deserves an atomic.

**33. When is it correct to use a channel-of-channels?**
Two cases. First: reply pattern — a request goroutine sends `(payload, replyCh)` to a server; the server answers on `replyCh`. Second: dynamic fan-out — a coordinator hands each new worker its own input channel, allowing the coordinator to route work per-worker. Both are legitimate; channel-of-channels-of-channels almost never is.

**34. Why does the runtime use a mutex inside `hchan` instead of being lock-free?**
The send/recv operation must atomically transfer the data *and* enqueue or dequeue the goroutine on `sendq`/`recvq`. Lock-free implementations exist (LMAX disruptor style) but require fixed capacity and a single producer/consumer per slot. Go channels promise multiple senders, multiple receivers, dynamic close, and `select` integration; a small per-channel mutex is the simplest correct implementation.

**35. Suggest a refactor for `sync.Map` when profiling shows it dominates CPU.**
Sharded `map[K]V` with a slice of N mutexes, key hashed to a shard. `sync.Map`'s amortised structure is a liability for write-heavy workloads with shared keys — you pay for both the read map and the dirty map. Sharding linearises by mutex count.

**36. What would push you to use an actor model (one goroutine owning state, channels in/out) over a mutex over the same state?**
Three things: (1) the state has invariants spanning multiple fields, hard to encode under one critical section; (2) you want to serialise *and* prioritise messages (`select` with priority); (3) you want a clear bottleneck for metrics and tracing. The cost: one extra goroutine, one extra channel hop per access, fewer parallel readers.

**37. Channel vs mutex in cancellation propagation — why is `context.Context` built on channels?**
Cancellation is inherently a *fan-out signal*: one cancel, many observers. Channels close in O(1) and the close is observed by every receiver. A mutex doesn't fan out: each waiter must check the bool, and there's no built-in "wake everyone" primitive. `sync.Cond.Broadcast` exists but is rarely correct because there's no message — just a wake — and you still need to recheck the condition. `<-ctx.Done()` is the right shape.

**38. Sketch a benchmark methodology to compare a mutex-protected counter vs a channel-based counter vs an atomic counter across goroutine counts.**
- Run `go test -bench=. -benchmem -cpu=1,2,4,8,16,32` (or your CPU count's powers of 2).
- Use `b.RunParallel` so each goroutine increments independently.
- Report ns/op and B/op for each.
- Look for super-linear slowdown (lock contention) vs flat (atomic, channel handoff).
- Add a non-trivial *think* time between increments to model real workloads — pure microbenchmarks lie because they have nothing else to do.

**39. Why is `chan struct{}` of size 0 (unbuffered) the canonical "ready" / "done" signal?**
Three properties: (1) close is idempotent in *observation* — every receiver sees the same close, even if it tries multiple times; (2) the zero-byte element means no allocation per signal; (3) it composes with `select`. The mutex-based equivalent is a `sync.Once` plus a bool plus a `sync.Cond` — three primitives where one channel suffices.

**40. What's the most expensive Go concurrency mistake you've seen made with these primitives, and what was the fix?**
(Answer varies — the typical seniors-and-up reply: a service used `chan struct{}` of size 1 as a mutex around a hot path. Under load the channel send/receive cost dominated CPU. Replacing it with `sync.Mutex` cut latency p99 by 70%. Lesson: the proverb is a *preference*, not a performance guarantee. Profile.)

---

[← Back](../)
