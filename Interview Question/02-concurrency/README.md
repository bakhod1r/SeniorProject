# Concurrency

> Senior Go backend interview Q&A covering concurrency patterns, backpressure, rate limiting, circuit breaking, concurrency hazards, and the Go memory model.

**30 questions** across **10 topics** · Level: senior

## Topics

- [Concurrency Patterns](#concurrency-patterns) (4)
- [Backpressure & Bounded Concurrency](#backpressure-bounded-concurrency) (2)
- [Rate Limiting](#rate-limiting) (3)
- [Circuit Breaker](#circuit-breaker) (2)
- [Concurrency Hazards](#concurrency-hazards) (4)
- [Go Memory Model & Happens-Before](#go-memory-model-happens-before) (2)
- [Channels vs Mutexes & Design](#channels-vs-mutexes-design) (3)
- [Warmups & Fundamentals](#warmups-fundamentals) (4)
- [Context & Cancellation](#context-cancellation) (2)
- [Detection & Operability](#detection-operability) (4)

---

## Concurrency Patterns

#### 1. Implement a worker pool with a fixed number of goroutines. What knobs determine the pool size, and what failure modes appear if you get it wrong?

*Difficulty:* 🟡 medium  ·  *Tags:* `worker-pool`, `goroutines`, `channels`

A worker pool fixes the number of goroutines that consume from a shared job channel, decoupling the rate of work submission from the degree of parallelism. The pattern: create a buffered jobs channel, spawn N workers each ranging over it, and close the channel when submission finishes so `range` terminates. Pool size is driven by the bottleneck: for CPU-bound work, size ~= GOMAXPROCS; for I/O-bound work, size is governed by the downstream's safe concurrency (DB max connections, upstream rate limits), not CPU. **Failure modes:** too small leaves throughput on the table and queues grow; too large causes downstream overload, connection exhaustion, and context-switch/GC pressure. Forgetting to close the jobs channel deadlocks workers in `range`; not waiting on a WaitGroup leaks goroutines or drops in-flight work on exit.

**Key points**
- Pool size bounds downstream concurrency, not just CPU usage
- CPU-bound ~ GOMAXPROCS; I/O-bound ~ downstream capacity
- Close the jobs channel exactly once to end `range`
- WaitGroup ensures all results are drained before exit
- Oversizing causes downstream overload, not faster work


```go
func workerPool(ctx context.Context, jobs <-chan Job, n int) <-chan Result {
	results := make(chan Result)
	var wg sync.WaitGroup
	wg.Add(n)
	for i := 0; i < n; i++ {
		go func() {
			defer wg.Done()
			for job := range jobs {
				select {
				case results <- process(job):
				case <-ctx.Done():
					return
				}
			}
		}()
	}
	go func() { wg.Wait(); close(results) }()
	return results
}
```

**Follow-ups**
- How would you make the pool size adaptive at runtime?
- Where do you put the result drain to avoid a goroutine leak on early cancellation?

---

#### 2. Explain fan-out/fan-in. Show a correct fan-in that doesn't leak goroutines or panic on a closed channel.

*Difficulty:* 🟡 medium  ·  *Tags:* `fan-in`, `fan-out`, `channels`, `goroutine-leak`

Fan-out distributes work from one channel across multiple goroutines for parallel processing; fan-in multiplexes multiple result channels back into one. The hazard is lifecycle: the merged output channel must be closed exactly once, only after **all** inputs are drained, and a `send on closed channel` panic must be impossible. The canonical fix uses a `sync.WaitGroup` per input goroutine plus a separate goroutine that closes the output after `wg.Wait()`. For cancellation, each forwarding goroutine must also select on `ctx.Done()` so a slow or abandoned consumer doesn't pin producers forever (goroutine leak). Never close a channel from the receiver side, and never have multiple senders close the same channel.

**Key points**
- Fan-out = parallelize; fan-in = merge multiple channels into one
- Close merged output once, after WaitGroup of all inputs
- Select on ctx.Done() in forwarders to avoid leaks
- Closing from receiver or multiple senders panics


```go
func fanIn(ctx context.Context, chans ...<-chan int) <-chan int {
	out := make(chan int)
	var wg sync.WaitGroup
	wg.Add(len(chans))
	for _, c := range chans {
		go func(c <-chan int) {
			defer wg.Done()
			for v := range c {
				select {
				case out <- v:
				case <-ctx.Done():
					return
				}
			}
		}(c)
	}
	go func() { wg.Wait(); close(out) }()
	return out
}
```

**Follow-ups**
- Why must the closer goroutine be separate from the forwarders?
- What happens if a forwarder returns early on ctx but the source channel still has buffered values?

---

#### 3. Design a pipeline with cancellation using errgroup. Why is errgroup preferable to a hand-rolled WaitGroup + error channel?

*Difficulty:* 🟠 hard  ·  *Tags:* `errgroup`, `pipeline`, `cancellation`, `context`

A pipeline chains stages connected by channels, each stage a goroutine reading from the previous and writing to the next. `errgroup.WithContext` returns a `Group` and a derived `ctx`; the first goroutine to return a non-nil error cancels that ctx, signaling all other stages to stop, and `g.Wait()` returns that first error. This beats a hand-rolled WaitGroup + error channel because it bundles three concerns correctly: (1) first-error capture without races, (2) automatic context cancellation on failure, and (3) a single `Wait()` that both joins and returns the error. Hand-rolled versions routinely leak goroutines (no cancellation propagation), drop secondary errors, or race on writing the shared error. `errgroup.SetLimit(n)` additionally caps concurrency. The remaining discipline is yours: every stage must still select on `ctx.Done()` for sends/receives, or cancellation won't actually unblock a stage stuck on a full channel.

**Key points**
- WithContext cancels all stages on first error
- Wait() joins and returns the first non-nil error
- SetLimit(n) bounds concurrency inside the group
- Stages must still select on ctx.Done() to honor cancellation
- Replaces error-prone WaitGroup + shared-error + manual cancel


```go
g, ctx := errgroup.WithContext(ctx)
nums := make(chan int)
g.Go(func() error {
	defer close(nums)
	for _, n := range input {
		select {
		case nums <- n:
		case <-ctx.Done():
			return ctx.Err()
		}
	}
	return nil
})
g.SetLimit(8)
for n := range nums {
	n := n
	g.Go(func() error { return process(ctx, n) })
}
if err := g.Wait(); err != nil {
	return err
}
```

**Follow-ups**
- What error does Wait return if the only failure is ctx cancellation from the caller?
- How does SetLimit interact with g.Go blocking?

---

#### 4. Producer-consumer with a bounded channel: what does the buffer size actually buy you, and when is buffering a bug?

*Difficulty:* 🟡 medium  ·  *Tags:* `producer-consumer`, `buffered-channel`, `backpressure`

A buffered channel decouples producer and consumer timing: a buffer of size N lets the producer run ahead by up to N items before it blocks, smoothing bursts and improving throughput when production and consumption rates are uneven but balanced on average. The buffer does **not** add capacity for a sustained rate mismatch—if the producer is persistently faster, the buffer fills and you're back to blocking (this is correct backpressure). Buffering becomes a bug when used to 'fix' a deadlock or to hide that the consumer can't keep up: it merely delays the symptom, increases memory footprint and tail latency, and can mask lost work if the program exits with items still buffered. A buffer also weakens the happens-before guarantee timing relative to an unbuffered channel's rendezvous. Rule of thumb: pick buffer size from measured burstiness, not as a deadlock band-aid.

**Key points**
- Buffer smooths bursts, not sustained rate mismatch
- Full buffer = correct backpressure, not a failure
- Using a buffer to dodge a deadlock just hides the bug
- Larger buffers raise memory and tail latency
- Unconsumed buffered items are silently lost on exit

**Follow-ups**
- How do you size a buffer empirically?
- Why might an unbuffered channel be a better default for correctness?

---

## Backpressure & Bounded Concurrency

#### 5. Enumerate the strategies for handling backpressure when a downstream can't keep up, and the trade-off of each.

*Difficulty:* 🟠 hard  ·  *Tags:* `backpressure`, `load-shedding`, `overload`

There are four primitive responses to overload. **Block** (natural with unbuffered/full channels): apply true backpressure upstream; safest for correctness but propagates latency and can stall the whole system if the upstream is a request handler holding resources. **Buffer**: absorb bursts in memory; bounded buffers are fine, unbounded buffers are a latent OOM and just defer the decision. **Drop** (load-shed): discard work when full, e.g. `select { case ch <- x: default: }`; preserves liveness and latency at the cost of completeness—correct for telemetry/metrics, wrong for payments. **Block with timeout / deadline**: bounded blocking that fails fast. **Load-shed** is drop applied selectively (shed low-priority or probabilistically, like CoDel/adaptive shedding) to protect goodput. The senior insight: backpressure must propagate to a place that can actually slow the source (reject the HTTP request, pause the Kafka consumer), otherwise you've only moved the queue.

**Key points**
- Block: real backpressure, but propagates stall risk
- Buffer: bounded only; unbounded = deferred OOM
- Drop/load-shed: protects latency, sacrifices completeness
- Choice depends on whether work is replaceable or critical
- Backpressure must reach a source that can slow down


```sql
// Load-shed: drop when the worker queue is full
select {
case jobs <- job:
	// accepted
default:
	metrics.Dropped.Inc()
	// or return 503 to the caller
}
```

**Follow-ups**
- How does dropping at the edge (503) differ from dropping internally?
- What's the danger of an unbounded internal queue under sustained load?

---

#### 6. You have an unbounded list of URLs to fetch. How do you bound concurrency to N in-flight requests without spawning a goroutine per URL?

*Difficulty:* 🟡 medium  ·  *Tags:* `bounded-concurrency`, `semaphore`, `x/sync`

Bound concurrency with a counting semaphore so memory and downstream load stay constant regardless of input size. Two idiomatic options: a buffered channel of size N used as a token bucket (`sem <- struct{}{}` to acquire, `<-sem` to release), or `golang.org/x/sync/semaphore` whose `Acquire(ctx, 1)` is context-aware and supports weighted acquisition. The key difference: spawning a goroutine per URL with a semaphore inside still creates millions of cheap goroutines (acceptable but wasteful), whereas a worker pool reuses a fixed set. For pure I/O fan-out, semaphore-gated goroutines plus an errgroup is the cleanest. Always acquire before launching expensive work and release in a `defer`; on cancellation, `semaphore.Acquire` returns an error so you don't leak a permit.

**Key points**
- Buffered chan as semaphore: acquire = send, release = receive
- x/sync/semaphore is context-aware and supports weights
- Acquire before work, release with defer
- errgroup.SetLimit is a higher-level equivalent
- Per-URL goroutine + semaphore is fine; worker pool reuses


```go
sem := make(chan struct{}, N)
var wg sync.WaitGroup
for _, u := range urls {
	wg.Add(1)
	sem <- struct{}{} // acquire (blocks at N)
	go func(u string) {
		defer wg.Done()
		defer func() { <-sem }() // release
		fetch(u)
	}(u)
}
wg.Wait()
```

**Follow-ups**
- Why might you prefer x/sync/semaphore over the buffered-channel trick?
- How do weighted semaphores help when jobs have different resource costs?

---

## Rate Limiting

#### 7. Compare token bucket and leaky bucket. Which does golang.org/x/time/rate implement, and what do its parameters mean?

*Difficulty:* 🟠 hard  ·  *Tags:* `rate-limiting`, `token-bucket`, `leaky-bucket`, `x/time/rate`

Both cap throughput but shape bursts differently. **Token bucket**: tokens refill at rate r into a bucket of capacity b; a request consumes a token, and accumulated tokens permit a burst up to b. It allows bursts and is the more common API limiter. **Leaky bucket**: requests enter a queue that drains at a fixed rate; output is perfectly smooth (no bursts), excess either queues or spills. Token bucket favors latency and burst tolerance; leaky bucket favors a strictly smooth downstream load. `golang.org/x/time/rate` implements a **token bucket**: `rate.NewLimiter(r, b)` where `r` is tokens/sec (Limit) and `b` is burst size. Use `Allow()` for drop-on-empty, `Wait(ctx)` to block until a token is available (with cancellation), or `Reserve()` to get the delay and decide yourself. A burst `b` of 1 effectively removes bursting; `r=Inf` disables limiting.

**Key points**
- Token bucket allows bursts up to b; leaky bucket smooths output
- x/time/rate is a token bucket: NewLimiter(r, b)
- Allow = non-blocking, Wait = block w/ ctx, Reserve = inspect delay
- burst=1 disables bursting; rate=Inf disables limiting
- Leaky bucket better when downstream needs uniform load


```go
lim := rate.NewLimiter(rate.Limit(100), 20) // 100 rps, burst 20
if !lim.Allow() {
	http.Error(w, "rate limited", 429)
	return
}
// or, block with cancellation:
if err := lim.Wait(ctx); err != nil {
	return err // ctx canceled / deadline exceeded
}
```

**Follow-ups**
- How would you make x/time/rate per-client (keyed limiters) and bound memory?
- Why is Reserve() useful for fair scheduling vs Allow()?

---

#### 8. How do you build a distributed rate limiter across many service instances, and why doesn't a per-instance x/time/rate limiter suffice?

*Difficulty:* 🔴 staff  ·  *Tags:* `rate-limiting`, `distributed`, `redis`, `sliding-window`

A per-instance limiter only bounds that process; with K replicas your effective global limit is K×r, which drifts as replicas autoscale and overwhelms a shared downstream. For a true global limit you need shared state. Common approaches: (1) a **centralized counter in Redis** with an atomic Lua script implementing token/leaky bucket or a fixed/sliding window—single source of truth, but adds a network hop and a hot-key bottleneck; (2) **sliding-window-log or sliding-window-counter** in Redis to avoid the boundary-burst problem of fixed windows; (3) a **rate-limit service / sidecar** (e.g. Envoy ratelimit) that centralizes the decision. Trade-offs: centralization adds latency and a failure dependency (decide fail-open vs fail-closed), so many systems combine a coarse global limiter with a local per-instance limiter as a fast-path and circuit. For approximate fairness without a hop, distribute the quota (r/K) and periodically rebalance based on observed traffic.

**Key points**
- Per-instance limit multiplies by replica count, breaks under autoscale
- Redis + atomic Lua for a shared token/window counter
- Sliding window avoids fixed-window boundary bursts
- Centralization adds latency + a dependency: choose fail-open/closed
- Hybrid: global coarse limit + local fast-path limiter

**Follow-ups**
- Fixed vs sliding window: explain the 2x boundary burst problem.
- If Redis is unavailable, do you fail open or closed, and why?

---

#### 9. Show two ways to implement a semaphore in Go and explain when you'd reach for x/sync/semaphore over a buffered channel.

*Difficulty:* 🟡 medium  ·  *Tags:* `semaphore`, `x/sync`, `buffered-channel`, `weighted`

A counting semaphore limits concurrent access to N. **Buffered channel**: capacity N; send to acquire, receive to release. Simple, zero deps, but acquisition isn't context-aware (you'd have to wrap it in a select with ctx.Done()), and it only supports unit weights. **x/sync/semaphore**: `NewWeighted(n)` with `Acquire(ctx, w)` / `Release(w)` supporting **weighted** permits (a heavy job can take w>1) and **context cancellation** built in—`Acquire` returns early if ctx is done, avoiding a leaked goroutine waiting on a permit. Reach for x/sync/semaphore when jobs have heterogeneous resource cost (e.g., memory-proportional weights) or when you need clean cancellation while waiting. Use the channel for simple unit-weight gating where you control the select anyway. A subtle bug with the channel approach: `Release` more than you `Acquire` and you overflow the budget silently; `TryAcquire` semantics require a `select default`.

**Key points**
- Buffered chan: send=acquire, recv=release; unit weights only
- x/sync/semaphore: weighted + context-aware Acquire
- Channel acquire isn't cancellable without a select wrapper
- Weighted permits model heterogeneous job cost
- Mismatched release on a channel corrupts the budget


```go
// 1) buffered channel (unit weight)
sem := make(chan struct{}, N)
sem <- struct{}{}; defer func(){ <-sem }()

// 2) x/sync/semaphore (weighted + ctx)
sw := semaphore.NewWeighted(int64(N))
if err := sw.Acquire(ctx, weight); err != nil { return err }
defer sw.Release(weight)
```

**Follow-ups**
- How would you implement TryAcquire with the channel version?
- What goes wrong if you Acquire a weight larger than the semaphore size?

---

## Circuit Breaker

#### 10. Explain the three states of a circuit breaker and the transitions between them. What metrics drive each transition?

*Difficulty:* 🟠 hard  ·  *Tags:* `circuit-breaker`, `resilience`, `failure-modes`

A circuit breaker protects callers from a failing dependency by failing fast instead of piling up doomed requests. **Closed**: requests pass through; the breaker counts failures/successes over a rolling window. When the failure metric crosses a threshold—commonly a failure *ratio* over a minimum request volume (to avoid tripping on 1/1), or N consecutive failures—it trips to Open. **Open**: all requests are rejected immediately (return a cached/default or error), giving the dependency time to recover and preventing resource exhaustion. After a cooldown timer, it moves to Half-Open. **Half-Open**: a limited number of trial requests are allowed; if they succeed (success threshold met) it returns to Closed, if any fail it snaps back to Open and the cooldown restarts. Driving metrics: failure ratio + request volume + rolling window (closed→open), cooldown duration (open→half-open), trial success count (half-open→closed). The volume threshold and ratio (not raw count) are the senior-level details—they prevent flapping on low traffic.

**Key points**
- Closed→Open: failure ratio over min request volume in a rolling window
- Open→Half-Open: after a cooldown timer
- Half-Open→Closed: trial successes meet threshold; any failure → Open
- Use ratio + volume, not raw count, to avoid low-traffic flapping
- Open state sheds load so the dependency can recover

**Follow-ups**
- Why is a minimum request-volume threshold essential before tripping?
- How many requests should Half-Open admit, and why limit them?

---

#### 11. Sketch a concurrency-safe circuit breaker skeleton in Go. What are the concurrency pitfalls?

*Difficulty:* 🔴 staff  ·  *Tags:* `circuit-breaker`, `mutex`, `gobreaker`, `thundering-herd`

The breaker wraps a call, tracks state under a mutex (or atomics), and short-circuits in Open. Pitfalls: (1) the state read+update must be atomic—checking state then acting without holding the lock races and can let a flood through during transition; (2) in Half-Open you must **limit** concurrent trial requests (a counter/semaphore), or every in-flight caller probes the dependency at once, defeating the purpose and re-overloading it; (3) the failure window should be time-bounded (rolling) so stale failures don't keep the breaker tripped; (4) don't hold the mutex across the actual downstream call—lock only to read/transition state and record the result, or you serialize all traffic. Production breakers (sony/gobreaker) encode exactly this: a `ReadyToTrip` predicate over Counts, a timeout for Open, and a `maxRequests` cap for Half-Open.

**Key points**
- State check + transition must be atomic (under lock)
- Cap concurrent Half-Open probes, else thundering herd
- Never hold the lock across the downstream call
- Rolling/time-bounded failure window, not lifetime counts
- ReadyToTrip predicate over (requests, failures) ratio


```go
type Breaker struct {
	mu        sync.Mutex
	state     State // Closed, Open, HalfOpen
	failures  int
	openedAt  time.Time
	cooldown  time.Duration
	threshold int
}

func (b *Breaker) Do(fn func() error) error {
	b.mu.Lock()
	if b.state == Open {
		if time.Since(b.openedAt) < b.cooldown {
			b.mu.Unlock()
			return ErrOpen // fail fast
		}
		b.state = HalfOpen // allow a trial
	}
	b.mu.Unlock()

	err := fn() // call WITHOUT holding the lock

	b.mu.Lock()
	defer b.mu.Unlock()
	if err != nil {
		b.failures++
		if b.state == HalfOpen || b.failures >= b.threshold {
			b.state, b.openedAt = Open, time.Now()
		}
		return err
	}
	b.failures, b.state = 0, Closed
	return nil
}
```

**Follow-ups**
- How would you bound the number of Half-Open trial requests in this skeleton?
- Why is recording the result under the lock but calling fn outside it important?

---

## Concurrency Hazards

#### 12. What is the difference between a data race and a race condition? Give an example where you have one but not the other.

*Difficulty:* 🟠 hard  ·  *Tags:* `data-race`, `race-condition`, `toctou`, `race-detector`

A **data race** is a specific, mechanical defect: two goroutines access the same memory concurrently, at least one writes, and there's no happens-before ordering (no synchronization) between them. It's undefined behavior in Go and is exactly what `-race` detects. A **race condition** is a broader correctness bug: the result depends on the *timing/interleaving* of operations, regardless of whether memory is properly synchronized. You can have one without the other: a check-then-act using two separate atomic operations (e.g., `if !exists(k) { set(k) }` where each op is individually atomic) has **no data race**—every access is synchronized—but still a **race condition**, because another goroutine can insert between the check and the act (lost update / TOCTOU). Conversely a plain unsynchronized `counter++` from two goroutines is a data race that also manifests as a race condition. The takeaway: `-race` finds data races, not all race conditions; correctness still requires reasoning about atomic *transactions*, not just atomic *operations*.

**Key points**
- Data race: concurrent access, ≥1 write, no happens-before
- Race condition: outcome depends on interleaving (broader)
- Atomic check-then-act = race condition, NO data race
- -race detects data races only, not all race conditions
- Fix race conditions by making the transaction atomic, not just ops


```go
// Race condition, NO data race (each op synchronized):
if _, ok := m.Load(key); !ok { // atomic
	m.Store(key, val)            // atomic, but gap between Load and Store
}
// Fix: m.LoadOrStore(key, val) -- one atomic transaction
```

**Follow-ups**
- Why can't the race detector catch the check-then-act bug above?
- Name a sync primitive that turns this into a single atomic transaction.

---

#### 13. State the four Coffman conditions for deadlock. How does Go's runtime detect a deadlock, and what are its limits?

*Difficulty:* 🟠 hard  ·  *Tags:* `deadlock`, `coffman-conditions`, `go-runtime`, `lock-ordering`

Deadlock requires all four **Coffman conditions** simultaneously: (1) **Mutual exclusion**—resources held in non-shareable mode; (2) **Hold and wait**—a goroutine holds one resource while waiting for another; (3) **No preemption**—resources can't be forcibly taken; (4) **Circular wait**—a cycle of goroutines each waiting on the next. Break any one (e.g., lock ordering breaks circular wait; try-lock with backoff breaks hold-and-wait) and deadlock is impossible. Go's runtime has a narrow detector: if **all** goroutines are blocked (asleep) with no way to wake—every one stuck on channel ops, mutexes, etc.—the scheduler observes no runnable goroutine and panics `fatal error: all goroutines are asleep - deadlock!`. **Limits**: it only fires for a *total* deadlock; a partial deadlock where some goroutines still run (e.g., the main goroutine spins or a timer goroutine lives) is invisible to it. It also can't detect deadlocks involving external blocking (cgo, syscalls, network) or two goroutines stuck while others churn. Real deadlock prevention needs lock-ordering discipline, not the runtime detector.

**Key points**
- Coffman: mutual exclusion, hold-and-wait, no preemption, circular wait
- Break any one condition to prevent deadlock (lock ordering is common)
- Go detects only when ALL goroutines are asleep
- Partial deadlocks (something still runnable) are undetected
- Syscall/cgo/network blocking is invisible to the detector

**Follow-ups**
- Which Coffman condition does consistent lock ordering eliminate?
- Why won't the runtime catch a deadlock between two of ten live goroutines?

---

#### 14. Define livelock and goroutine starvation. How does Go's mutex 'starvation mode' specifically address one of these?

*Difficulty:* 🔴 staff  ·  *Tags:* `livelock`, `starvation`, `mutex`, `starvation-mode`

**Livelock**: goroutines are not blocked—they keep changing state in response to each other—but make no forward progress (e.g., two goroutines repeatedly back off and retry in lockstep, or a retry storm that never settles). **Starvation**: a goroutine is perpetually denied a resource it needs because others keep winning the contention (unfair scheduling). Go's `sync.Mutex` is a hybrid: by default it favors throughput with a 'normal mode' where a waking waiter competes with newly arriving goroutines (which are already running on-CPU and often win)—great for throughput but a late waiter could starve. To bound tail latency, the mutex enters **starvation mode** when a waiter has waited longer than **1ms**: ownership is handed directly to the front of the FIFO wait queue, new arrivals don't barge and queue at the back, guaranteeing the long-waiter makes progress. It exits starvation mode when a goroutine acquires it with under 1ms wait or it's the last waiter. This is a deliberate throughput-vs-tail-latency trade-off baked into the runtime.

**Key points**
- Livelock: active, responsive, but no progress (retry storms)
- Starvation: a goroutine perpetually loses contention
- Mutex normal mode favors throughput; new arrivals can barge
- Starvation mode triggers at 1ms wait → FIFO handoff, no barging
- It's a throughput vs tail-latency trade-off in sync.Mutex

**Follow-ups**
- How would you fix a livelock between two backing-off goroutines?
- Why does barging improve throughput but hurt tail latency?

---

#### 15. A select statement with a default branch in a tight loop is pegging a CPU core. What's happening and how do you fix it?

*Difficulty:* 🟡 medium  ·  *Tags:* `select`, `busy-wait`, `starvation`, `scheduler`

A `select` with a `default` branch never blocks—if no case is ready it takes `default` immediately. In a `for { select { ... default: } }` loop with nothing useful in default, the goroutine busy-spins, consuming 100% of a core and starving other goroutines of scheduler time (it's effectively a busy-wait, a form of self-inflicted starvation/livelock). The fix depends on intent: if you wanted to block until something is ready, **remove the default** so select parks the goroutine until a case fires. If you genuinely need periodic polling, gate the loop with a `time.Ticker` or a small sleep so you yield. If default exists for non-blocking try-send/try-receive, make sure the loop has another blocking case (like `<-ctx.Done()` or a ticker) so it can actually sleep. Busy-spinning is occasionally justified for ultra-low-latency hot paths, but it must be a measured, deliberate choice, not an accident.

**Key points**
- default makes select non-blocking → busy-spin in a tight loop
- Burns a core, starves the scheduler
- Remove default to let select park the goroutine
- If polling is intended, gate with a Ticker / sleep
- Busy-wait only as a deliberate low-latency optimization

**Follow-ups**
- When is busy-spinning actually the right call?
- How would runtime/pprof or GODEBUG=schedtrace surface this?

---

## Go Memory Model & Happens-Before

#### 16. What does the Go memory model guarantee, and what synchronization operations establish a happens-before relationship?

*Difficulty:* 🔴 staff  ·  *Tags:* `memory-model`, `happens-before`, `channels`, `atomics`

The Go memory model defines when a read of a variable is guaranteed to observe a particular write. The core guarantee is conditional: a read r is *guaranteed* to see write w only if w happens-before r **and** no other write happens-between them. Without a happens-before edge, the compiler and CPU may reorder, cache, or tear accesses—so concurrent unsynchronized access is undefined (a data race), full stop. Operations that **establish happens-before**: (1) within a single goroutine, program order; (2) a channel **send happens-before** the corresponding receive completes; (3) a channel **receive happens-before** the send on an unbuffered channel returns (the rendezvous), and **closing** a channel happens-before a receive that returns the zero value; (4) `sync.Mutex`/RWMutex: the n-th `Unlock` happens-before the (n+1)-th `Lock`; (5) `sync.Once`: the function's return happens-before any `Do` returns; (6) `sync/atomic` operations are sequentially consistent and create edges; (7) `go` statement happens-before the goroutine starts; a goroutine's exit is **not** synchronized—you need a WaitGroup/channel. As of Go 1.19 the model is explicitly defined in terms of these, and the guidance is unchanged: 'if you must read this to decide your program is correct, you're being too clever'—use one happens-before mechanism and don't share.

**Key points**
- A read sees a write only if there's a happens-before edge and nothing between
- Channel send hb receive; receive hb send-return (unbuffered); close hb zero-recv
- Mutex: nth Unlock hb (n+1)th Lock; Once: fn return hb Do return
- atomic ops are sequentially consistent and create edges
- go starts goroutine (hb); goroutine exit is NOT synchronized — use WaitGroup
- No happens-before = data race = undefined behavior


```go
var data int
var done = make(chan struct{})
go func() {
	data = 42        // (1)
	close(done)      // (2) close happens-before recv returns
}()
<-done            // (3) so (1) is visible here
fmt.Println(data) // guaranteed 42
```

**Follow-ups**
- Why is a goroutine's *exit* not enough to publish its writes?
- Is reading a variable written under a mutex safe without taking the same mutex?

---

#### 17. Is the double-checked locking / lazy-init pattern with a plain bool flag safe in Go? What's the correct primitive?

*Difficulty:* 🟠 hard  ·  *Tags:* `memory-model`, `sync.Once`, `double-checked-locking`, `lazy-init`

No. A lazy-init that reads a plain `bool initialized` outside a lock, and writes the value + flag inside a lock, is a **data race**: the fast-path read of `initialized` has no happens-before edge to the writer, so it may observe `initialized == true` while the *value* write is still invisible (reordering/visibility), handing back a half-constructed object. The race detector flags it. The correct primitive is `sync.Once`: `once.Do(initFn)` guarantees that `initFn`'s completion happens-before the return of *every* `Do` call, so all callers see the fully-initialized value, and the function runs exactly once even under contention. If you really need a lock-free fast path, you must use `sync/atomic` (e.g., an `atomic.Pointer` or `atomic.Bool` load with acquire semantics) to create the happens-before edge—never a plain variable. In practice `sync.Once` (or Go 1.21's `OnceValue`/`OnceFunc`) is the idiomatic, correct answer.

**Key points**
- Plain-bool double-checked locking is a data race (no hb on fast path)
- Reader can see flag=true before the value write is visible
- sync.Once: init completion hb every Do return; runs exactly once
- Lock-free fast path requires sync/atomic, never a plain var
- Go 1.21 OnceValue/OnceFunc are clean alternatives


```go
var (
	once sync.Once
	cfg  *Config
)
func Get() *Config {
	once.Do(func() { cfg = load() })
	return cfg // every caller sees fully-initialized cfg
}
```

**Follow-ups**
- How does sync.Once create the happens-before edge internally?
- When would atomic.Pointer be preferable to sync.Once?

---

## Channels vs Mutexes & Design

#### 18. How do you decide between a channel and a mutex for synchronizing shared state? Give concrete criteria.

*Difficulty:* 🟠 hard  ·  *Tags:* `channels`, `mutex`, `design`, `rwmutex`

Pick based on what you're coordinating. **Use a mutex** when goroutines share a passive piece of state and you just need mutually exclusive access—a counter, a map, a cache. It's simpler, lower overhead, and the lock scope is local and obvious. `sync.RWMutex` when reads dominate. **Use a channel** when you're transferring ownership of data, distributing units of work, or coordinating goroutine lifecycles/signaling (cancellation, completion, pipelines). Channels shine for communication and orchestration, not for guarding a single variable. Concrete heuristics from the Go team: if the code reads like 'protect this field,' use a mutex; if it reads like 'pass this value to whoever handles it' or 'tell that goroutine to stop,' use a channel. Performance: an uncontended mutex is a couple of atomic ops and is much cheaper than a channel send (which involves the scheduler). Anti-pattern: using a 1-capacity channel as a mutex—it works but obscures intent and is slower. The two compose: a worker pool uses channels for dispatch and a mutex for the shared result aggregate.

**Key points**
- Mutex: guard passive shared state (counter, map, cache)
- Channel: transfer ownership, distribute work, signal lifecycle
- 'Protect this field' → mutex; 'hand off / stop' → channel
- Uncontended mutex is cheaper than a channel op
- Don't use a 1-cap channel as a mutex; they compose well together

**Follow-ups**
- Why is sync.Map not just a faster mutex+map, and when does it actually win?
- How does atomic.Value/atomic.Pointer fit between these two?

---

#### 19. 'Don't communicate by sharing memory; share memory by communicating.' Where does this proverb break down for a senior engineer?

*Difficulty:* 🔴 staff  ·  *Tags:* `design`, `channels`, `mutex`, `go-proverbs`, `broadcast`

The proverb captures Go's preference for passing data ownership over channels rather than locking shared memory—it produces clearer ownership and composable pipelines. But taken dogmatically it misleads. It breaks down when: (1) the workload is a hot, fine-grained shared counter or map—a mutex or atomic is dramatically faster than channel hand-offs, which involve scheduler interaction per operation; (2) many readers, rare writes—`RWMutex` or `atomic.Pointer` (copy-on-write) beats serializing through a channel; (3) you need a true broadcast/fan-out to N subscribers—channels don't broadcast (a send goes to exactly one receiver), so you end up building extra machinery or using `sync.Cond`/closing a channel as a one-shot signal; (4) request/response with shared caches where lock contention is low. The Go team itself says 'use whichever is most expressive and/or most simple'—the wiki adds the caveat right after the proverb. Senior judgment: channels for orchestration and ownership transfer; mutex/atomics for protecting genuinely shared, performance-sensitive state. Misapplying channels to shared state yields slower, more complex code with hidden goroutine leaks.

**Key points**
- Proverb favors ownership transfer; not an absolute rule
- Hot shared counters/maps: mutex/atomic far faster than channels
- Read-heavy: RWMutex / atomic.Pointer COW beats channel serialization
- Channels can't broadcast — a send reaches one receiver only
- Go wiki itself: pick the most expressive/simple primitive

**Follow-ups**
- How would you implement broadcast-to-N-subscribers given channels are 1:1?
- Show a case where channelizing shared state introduced a goroutine leak.

---

#### 20. A handler spawns a goroutine per request that outlives the request context. How do you detect and prevent goroutine leaks at scale?

*Difficulty:* 🟠 hard  ·  *Tags:* `goroutine-leak`, `context`, `pprof`, `goleak`

A goroutine leaks when it blocks forever—on a channel send/receive nobody completes, a mutex never released, or a `for range` over a never-closed channel—so it's never collected and accumulates until OOM. The classic source is a request-scoped goroutine that writes to a channel whose reader has already returned, with no `ctx.Done()` escape. **Prevention**: every spawned goroutine must have a guaranteed termination path tied to the request—select on `ctx.Done()` for every blocking op, derive child contexts with `context.WithCancel/WithTimeout` and `defer cancel()`, never start a goroutine you can't stop. Pass the request `ctx` down and honor it. **Detection**: watch `runtime.NumGoroutine()` as a metric and alert on monotonic growth; capture `pprof goroutine` profiles (`/debug/pprof/goroutine?debug=2`) to see exactly where leaked goroutines are parked; in tests use `go.uber.org/goleak` to fail on leaks. Load tests that show goroutine count climbing without leveling off are the smoking gun. The structural fix is to make goroutine lifetime a subset of the context's lifetime, always.

**Key points**
- Leak = goroutine blocked forever (send/recv/lock/range never completes)
- Every blocking op needs a ctx.Done() / cancellation escape
- Derive child ctx, defer cancel(), pass ctx down
- Detect: NumGoroutine metric, pprof goroutine profile, uber/goleak in tests
- Goroutine lifetime must be ⊆ context lifetime


```go
func handler(w http.ResponseWriter, r *http.Request) {
	ctx := r.Context()
	result := make(chan T, 1) // buffered so sender never blocks if reader left
	go func() {
		v := doWork()
		select {
		case result <- v:
		case <-ctx.Done(): // escape if request gone
		}
	}()
	select {
	case v := <-result:
		write(w, v)
	case <-ctx.Done():
		http.Error(w, "timeout", 504)
	}
}
```

**Follow-ups**
- Why does a buffered result channel of size 1 also prevent the leak here?
- How does go.uber.org/goleak distinguish a leak from a slow-to-exit goroutine?

---

## Warmups & Fundamentals

#### 21. What is the difference between concurrency and parallelism in Go, and how do goroutines and GOMAXPROCS relate?

*Difficulty:* 🟢 warm-up  ·  *Tags:* `concurrency`, `parallelism`, `gomaxprocs`, `scheduler`

Concurrency is about *structure*—composing independently executing tasks (goroutines) that can make progress in overlapping time periods; parallelism is about *execution*—actually running multiple tasks simultaneously on multiple cores. Rob Pike's framing: concurrency is dealing with many things at once, parallelism is doing many things at once. In Go, you write concurrency with goroutines and channels; the runtime decides parallelism. The Go scheduler multiplexes M goroutines onto N OS threads (the G-M-P model), and `GOMAXPROCS` (default = number of CPUs since Go 1.5) caps the number of OS threads that can execute Go code simultaneously—i.e., the degree of parallelism. So a concurrent program with `GOMAXPROCS=1` still interleaves goroutines correctly but never runs them in parallel. The senior point: correctness of a concurrent program must not depend on whether it runs in parallel; bugs that only appear at `GOMAXPROCS>1` are usually latent data races the model already forbids.

**Key points**
- Concurrency = structure (composition); parallelism = simultaneous execution
- Goroutines express concurrency; runtime+GOMAXPROCS decide parallelism
- G-M-P scheduler multiplexes goroutines onto OS threads
- GOMAXPROCS caps simultaneous Go-executing threads (default = NumCPU)
- Correctness must not depend on parallelism degree

**Follow-ups**
- Why might setting GOMAXPROCS in a container matter (cgroup CPU limits)?
- Can a single-threaded (GOMAXPROCS=1) program still deadlock?

---

#### 22. What happens when you send on a nil channel, receive from a nil channel, or close a nil/closed channel?

*Difficulty:* 🟢 warm-up  ·  *Tags:* `channels`, `nil-channel`, `close`, `select`

These edge cases are exam-critical because they're load-bearing in `select` logic. **Send to / receive from a nil channel block forever**—this is intentional and useful: setting a channel variable to nil in a `select` effectively *disables* that case, a common trick to stop reading a drained source without removing the branch. **Closing a nil channel panics** (`close of nil channel`). **Closing an already-closed channel panics** (`close of closed channel`)—hence close must be done exactly once, by the sole owner/sender. **Sending on a closed channel panics** (`send on closed channel`). **Receiving from a closed channel returns immediately** with the zero value and `ok == false` (the comma-ok form lets you detect closure), and any buffered values are drained first. The discipline that falls out: the sender closes, never the receiver; only one goroutine closes; and use the nil-channel-disables-select pattern deliberately rather than by accident.

**Key points**
- Send/recv on nil channel: blocks forever (used to disable a select case)
- Close nil channel: panic
- Close closed channel / send on closed: panic
- Recv from closed: zero value, ok=false, after draining buffer
- Sender closes once; receiver never closes


```go
// Disable a select case by nil-ing the channel:
for in != nil || other != nil {
	select {
	case v, ok := <-in:
		if !ok { in = nil; continue } // stop reading in
		use(v)
	case v, ok := <-other:
		if !ok { other = nil; continue }
		use(v)
	}
}
```

**Follow-ups**
- Why is nil-ing a channel in select cleaner than a boolean flag?
- Who is responsible for closing a channel and why never the receiver?

---

#### 23. What's the classic loop-variable capture bug with goroutines, and what changed in Go 1.22?

*Difficulty:* 🟢 warm-up  ·  *Tags:* `loop-variable`, `closure`, `go1.22`, `goroutines`

Before Go 1.22, a `for` loop reused a *single* loop-variable instance across iterations. Launching `go func() { use(i) }()` captured that shared variable by reference, so by the time the goroutines ran, the loop had usually finished and they all observed the final value—a notorious data-race-flavored bug (often every goroutine printing the last element). The pre-1.22 fix was to shadow per iteration: `i := i` inside the loop, or pass it as an argument `go func(i int){...}(i)`, giving each goroutine its own copy. **Go 1.22 changed loop semantics**: the loop variable is now scoped *per iteration*, so each iteration gets a fresh copy and the capture bug largely disappears for `for range` and three-clause `for` loops. Senior nuance: this only helps code compiled with Go 1.22+ language version; you still pass values explicitly when targeting older versions or for clarity, and the change has subtle implications for code that relied on the shared variable (rare). The race detector and `loopclosure` vet check historically caught these.

**Key points**
- Pre-1.22: one shared loop var captured by all goroutines → all see final value
- Old fix: `i := i` shadow, or pass i as a func argument
- Go 1.22: loop variable is per-iteration, bug mostly gone
- Depends on the module's Go language version
- vet loopclosure / -race historically flagged it


```go
// Pre-1.22 fix (still correct everywhere):
for _, v := range items {
	v := v // shadow per iteration
	go func() { process(v) }()
}
```

**Follow-ups**
- Does Go 1.22's change affect `for i := 0; i < n; i++` loops too?
- Why does the fix matter even though the goroutine runs 'later'?

---

#### 24. When should you reach for sync/atomic instead of a mutex, and what are atomic's sharp edges?

*Difficulty:* 🟡 medium  ·  *Tags:* `atomic`, `mutex`, `lock-free`, `compare-and-swap`

Use `sync/atomic` for single-word, lock-free operations on a single variable: counters, flags, generation numbers, or swapping a pointer to an immutable snapshot (copy-on-write config via `atomic.Pointer`). It's faster than a mutex because there's no parking/scheduler interaction—just a hardware atomic instruction—and it can't deadlock. Go 1.19 added typed wrappers (`atomic.Int64`, `atomic.Bool`, `atomic.Pointer[T]`) that prevent the classic alignment bug. **Sharp edges**: (1) atomics protect *one* variable at a time—you cannot atomically update two related fields, so for multi-field invariants you still need a mutex; (2) with the old function API (`atomic.AddInt64(&x, ...)`), `x` must be 64-bit aligned, which isn't guaranteed for struct fields on 32-bit platforms—a real source of crashes (the typed wrappers fix this); (3) it's easy to build a subtle race condition out of correct atomic ops (the check-then-act problem); use `CompareAndSwap` for atomic read-modify-write. Rule: atomics for one variable / one operation; mutex for protecting a group of fields as an invariant.

**Key points**
- Atomics: lock-free single-word ops (counter, flag, pointer swap)
- Faster than mutex, no parking, can't deadlock
- Cannot atomically update multiple related fields → use a mutex
- 32-bit alignment bug with old API; typed wrappers (1.19) fix it
- Use CompareAndSwap for safe read-modify-write; ops≠transactions


```go
var cfg atomic.Pointer[Config]
cfg.Store(initial)
// reader (lock-free, always sees a consistent snapshot):
c := cfg.Load()
// writer (copy-on-write):
newC := c.clone(); newC.Field = x; cfg.Store(newC)
```

**Follow-ups**
- How does atomic.Pointer enable lock-free copy-on-write config reloads?
- Why is CompareAndSwap necessary even though Add is already atomic?

---

## Context & Cancellation

#### 25. How does context propagate cancellation, and what are the rules for passing and storing it?

*Difficulty:* 🟡 medium  ·  *Tags:* `context`, `cancellation`, `deadline`, `lostcancel`

`context.Context` carries a cancellation signal, deadline, and request-scoped values down a call tree. Cancellation propagates *downward*: deriving a child with `WithCancel`/`WithTimeout`/`WithDeadline` builds a tree where canceling a parent cancels all descendants, but never the reverse. `Done()` returns a channel closed on cancellation—the universal way for blocking operations to bail out via `select`. **Rules**: pass `ctx` as the first parameter, named `ctx`; never store it in a struct (it's request-scoped, not object-scoped, though some long-lived components reasonably hold one); always call the `cancel` function returned by `WithCancel`/`WithTimeout`—`defer cancel()`—or you leak the context's timer/goroutine resources (vet flags this as `lostcancel`). `ctx.Err()` tells you *why* it ended: `Canceled` vs `DeadlineExceeded`. Don't pass `nil`; use `context.TODO()` when unsure, `context.Background()` at the top. `WithValue` is for request-scoped data crossing API boundaries (request IDs, auth), not for passing optional function parameters—overusing it makes data flow invisible.

**Key points**
- Cancellation propagates parent→child, never upward
- Done() channel + select is how blocking ops bail out
- First param, named ctx; never nil; don't store in structs
- Always defer cancel() — leaking it leaks timer/goroutine (vet: lostcancel)
- Err() distinguishes Canceled vs DeadlineExceeded; WithValue only for request scope

**Follow-ups**
- What leaks if you call WithTimeout and never call its cancel func?
- Why is ctx.Value the wrong tool for passing optional parameters?

---

#### 26. You launch 5 parallel downstream calls and want to cancel the rest as soon as one fails or the caller's deadline hits. How do you wire this correctly?

*Difficulty:* 🟠 hard  ·  *Tags:* `context`, `errgroup`, `cancellation`, `parallel-calls`

Use `errgroup.WithContext(ctx)` where `ctx` is the caller's deadline-bearing context. Each call runs in `g.Go`; the first to return an error cancels the group's derived context, and because every downstream call selects on (or passes) that ctx, the others abort promptly instead of running to completion and wasting resources. `g.Wait()` returns the first error. Two correctness details: (1) every downstream call must actually honor the context—pass it into the HTTP/DB client so the in-flight request is aborted on cancel; a call that ignores ctx will keep running and you'll wait for it anyway. (2) The caller's deadline already lives in `ctx`, so `WithContext` gives you both 'first error' and 'deadline exceeded' cancellation for free—whichever fires first wins, and `Wait` returns the corresponding error. Avoid the hand-rolled version (WaitGroup + error channel + manual cancel) which commonly drops the secondary errors or forgets to cancel siblings.

**Key points**
- errgroup.WithContext(callerCtx): first error cancels siblings
- Wait() returns first error; deadline cancellation is automatic via ctx
- Every call must pass ctx into its client to actually abort
- A call that ignores ctx keeps running — you still wait on it
- Cleaner and less buggy than WaitGroup + error chan + manual cancel


```go
g, ctx := errgroup.WithContext(ctx) // ctx carries caller deadline
results := make([]Resp, len(targets))
for i, t := range targets {
	i, t := i, t
	g.Go(func() error {
		r, err := call(ctx, t) // ctx aborts in-flight request
		if err != nil { return err }
		results[i] = r
		return nil
	})
}
if err := g.Wait(); err != nil { return err } // first failure or deadline
```

**Follow-ups**
- What happens to the other 4 calls if call #2 returns an error immediately?
- Why must each call pass ctx into its client rather than just checking ctx.Done() before starting?

---

## Detection & Operability

#### 27. How does the Go race detector work, what does it cost, and why can a race still ship to production?

*Difficulty:* 🟠 hard  ·  *Tags:* `race-detector`, `thread-sanitizer`, `testing`, `ci`

`go test -race` / `go build -race` instruments memory accesses and uses a happens-before algorithm (a vector-clock variant, ThreadSanitizer-based) to detect when two goroutines access the same address with no synchronization ordering and at least one write. When it finds a violation it prints both stacks and the conflicting accesses. **Cost**: typically 2–20x CPU slowdown and ~5–10x memory, so it's a test/canary tool, not something you run in prod hot paths. **Why races still ship**: the detector is *dynamic*—it only catches races on code paths *actually executed* with *interleavings that actually occurred* during the run. A race in a rarely-hit branch, or one that needs a specific timing your tests never produce, goes unseen. It also can't see races through cgo or some `unsafe` tricks. Mitigation: run `-race` in CI across a broad test suite, fuzz/stress concurrent paths, run it on a canary under real traffic, and treat any race report as a must-fix (it's undefined behavior, not a warning). Coverage of concurrent code is what makes the detector effective.

**Key points**
- Instruments accesses; happens-before / vector-clock (TSan) detection
- Reports two stacks when ≥1 write lacks synchronization ordering
- Cost ~2–20x CPU, ~5–10x memory → test/canary only
- Dynamic: only catches races on executed paths + observed interleavings
- Run in CI + canary; any report is a must-fix (undefined behavior)

**Follow-ups**
- Why doesn't 100% line coverage guarantee the detector found all races?
- How would you stress concurrent code to surface timing-dependent races?

---

#### 28. Production goroutine count is climbing steadily and memory follows. Walk through diagnosing it.

*Difficulty:* 🔴 staff  ·  *Tags:* `goroutine-leak`, `pprof`, `diagnostics`, `operability`

Steadily climbing goroutines that never plateau is the signature of a goroutine leak. **Diagnose**: (1) Confirm via the `runtime.NumGoroutine()` metric or `expvar`—monotonic growth, not a sawtooth, distinguishes a leak from normal load. (2) Pull a goroutine profile: `/debug/pprof/goroutine?debug=2` dumps every goroutine's stack and how long it's been blocked; thousands parked at the same `chan send`/`chan receive`/`semacquire` line is your culprit, and the stack points to the exact code. `go tool pprof` on `goroutine` with `-http` gives a visual. (3) Diff two profiles minutes apart to see which stack is growing. **Common root causes**: a goroutine sending to a channel whose reader returned (no ctx.Done escape), `time.After` in a hot loop accumulating timers (use a reusable `Ticker`/`NewTimer`+Stop), a worker waiting on a channel that's never closed, or HTTP client bodies not closed leaving reader goroutines. **Fix**: tie every goroutine's lifetime to a context with a guaranteed cancel/timeout, add `ctx.Done()` to blocking sends, and add a `goleak` test to catch regressions. Also check the heap profile to confirm the retained memory matches the leaked goroutines' stacks/closures.

**Key points**
- Monotonic goroutine growth (not sawtooth) = leak signature
- pprof goroutine?debug=2 shows every stack + block duration
- Diff two profiles to find the growing stack
- Roots: send to abandoned reader, time.After in loop, unclosed channel, unclosed HTTP body
- Fix: ctx-tied lifetimes + ctx.Done() escapes + goleak regression test


```go
import _ "net/http/pprof"
// curl localhost:6060/debug/pprof/goroutine?debug=2
// go tool pprof -http=:0 http://localhost:6060/debug/pprof/goroutine

// Hot-loop timer leak fix:
t := time.NewTimer(d)
defer t.Stop()
select {
case <-t.C:
case <-ctx.Done():
}
```

**Follow-ups**
- Why does time.After in a tight loop leak even though each timer 'fires'?
- How do you tell a slow-draining backlog apart from a true leak in the profile?

---

#### 29. Two goroutines acquire mutexes A and B in opposite orders. Explain the deadlock and the standard prevention techniques.

*Difficulty:* 🟠 hard  ·  *Tags:* `deadlock`, `mutex`, `lock-ordering`, `trylock`

If goroutine 1 does `Lock(A); Lock(B)` and goroutine 2 does `Lock(B); Lock(A)`, they can interleave so each holds one lock and waits for the other—a **circular wait**, satisfying all four Coffman conditions, and both block forever. If those are the only two goroutines, Go's runtime panics `all goroutines are asleep - deadlock`; in a busy server with other live goroutines it just hangs those two and you see latency/leak symptoms instead. **Standard preventions**: (1) **Lock ordering**—establish a global order over locks (e.g., always acquire A before B, by address or by a defined hierarchy) so a cycle is impossible; this is the most common and robust fix, eliminating the circular-wait condition. (2) **Lock coarsening / single lock**—if A and B always travel together, use one mutex. (3) **Try-lock with backoff** (`TryLock`, Go 1.18+) to break hold-and-wait: if you can't get the second lock, release the first and retry—at the risk of livelock without jitter. (4) Reduce critical sections so locks aren't held across calls that grab other locks. Detection in prod: a hung pprof goroutine profile showing two goroutines parked on `sync.Mutex.Lock` with crossed orders.

**Key points**
- Opposite acquisition order → circular wait → deadlock
- Total deadlock panics; partial just hangs those goroutines
- Lock ordering (global hierarchy) eliminates circular wait — primary fix
- Coarsen to one lock when A and B always go together
- TryLock+backoff breaks hold-and-wait but risks livelock; pprof reveals crossed Lock stacks

**Follow-ups**
- How do you enforce a lock-ordering convention across a large codebase?
- Why does TryLock-with-retry risk livelock, and how does jitter help?

---

#### 30. Design a bounded, cancellable job queue used by an HTTP handler: accept work, bound in-flight work, shed load when full, and drain on shutdown. What are the key decisions?

*Difficulty:* 🔴 staff  ·  *Tags:* `worker-pool`, `backpressure`, `load-shedding`, `graceful-shutdown`, `design`

This composes several patterns. **Bound** in-flight work with a fixed worker pool reading from a buffered jobs channel—the buffer absorbs bursts, the pool size caps downstream concurrency. **Shed load** when the buffer is full using a non-blocking `select` with `default` that returns 503, so a flood doesn't grow an unbounded queue or stall request handlers (backpressure reaches the client, the only actor that can slow down). **Cancellation** flows via a per-job context derived from the request and a server-wide shutdown context. **Graceful drain** on shutdown: stop accepting new jobs (close the submission path / return 503), then close the jobs channel so workers finish the buffered backlog, and `WaitGroup.Wait()` with a bounded timeout before force-exit—so in-flight work isn't dropped but shutdown still terminates. Key decisions: buffer size (from measured burstiness, not arbitrary), pool size (downstream capacity), shed vs block (shed for liveness, block only if work is irreplaceable), and the drain timeout (bound it so a stuck job can't block shutdown forever). Add metrics: queue depth, dropped count, worker utilization—queue depth trending toward capacity is your early overload signal.

**Key points**
- Worker pool + buffered jobs channel bounds in-flight work
- Non-blocking select/default → 503 sheds load (backpressure to client)
- Per-job ctx from request + server shutdown ctx for cancellation
- Drain: stop accepting → close jobs chan → WaitGroup with bounded timeout
- Metrics: queue depth (early overload signal), drops, utilization


```go
type Queue struct {
	jobs chan Job
	wg   sync.WaitGroup
}
func (q *Queue) Submit(j Job) bool {
	select {
	case q.jobs <- j:
		return true
	default:
		return false // full → caller returns 503 (load shed)
	}
}
func (q *Queue) Start(n int) {
	q.wg.Add(n)
	for i := 0; i < n; i++ {
		go func() { defer q.wg.Done(); for j := range q.jobs { j.Run() } }()
	}
}
func (q *Queue) Shutdown(ctx context.Context) error {
	close(q.jobs)          // stop intake, let buffer drain
	done := make(chan struct{})
	go func() { q.wg.Wait(); close(done) }()
	select {
	case <-done:
		return nil
	case <-ctx.Done():
		return ctx.Err() // bounded drain timeout
	}
}
```

**Follow-ups**
- How do you size the buffer and pool from observed traffic?
- Why bound the drain with a timeout instead of waiting indefinitely on Wait()?

---
