---
layout: default
title: Optimize — Drain Pattern
parent: Drain Pattern
grand_parent: Production Patterns
ancestor: Go
nav_order: 10
has_children: false
permalink: /roadmap/programming-languages/golang/07-concurrency/18-production-patterns/05-drain-pattern/optimize/
---

# Drain Pattern — Optimization Exercises

Drain code is on the critical path of deploys. Optimisations matter. Each exercise presents a slow or wasteful drain implementation; refactor it.

---

## Exercise 1. Drain Polls Every 1 ms

**Slow code:**

```go
for inFlight > 0 {
	time.Sleep(time.Millisecond)
}
```

**Problem.** Tight polling burns CPU. With many pods draining simultaneously, this adds up.

**Optimisation.** Use a `WaitGroup` with `select`:

```go
done := make(chan struct{})
go func() { wg.Wait(); close(done) }()
select {
case <-done:
case <-ctx.Done():
}
```

The wait is now event-driven; CPU is near zero during drain.

---

## Exercise 2. Drain Allocates A Timer Per Iteration

**Slow code:**

```go
for inFlight > 0 {
	select {
	case <-time.After(20 * time.Millisecond):
	case <-ctx.Done():
		return ctx.Err()
	}
}
```

**Problem.** `time.After` creates a new timer each iteration; old timers leak until they fire.

**Optimisation.** Use `time.NewTimer` and reset:

```go
t := time.NewTimer(20 * time.Millisecond)
defer t.Stop()
for inFlight > 0 {
	select {
	case <-t.C:
		t.Reset(20 * time.Millisecond)
	case <-ctx.Done():
		return ctx.Err()
	}
}
```

Or better: use a `Ticker`:

```go
t := time.NewTicker(20 * time.Millisecond)
defer t.Stop()
for inFlight > 0 {
	select {
	case <-t.C:
	case <-ctx.Done():
		return ctx.Err()
	}
}
```

---

## Exercise 3. Drain Locks On Every Submit

**Slow code:**

```go
func (p *Pool) Submit(j Job) error {
	p.mu.Lock()
	defer p.mu.Unlock()
	if p.closed {
		return errors.New("closed")
	}
	p.queue <- j
	return nil
}
```

**Problem.** Locking on every submit serialises the hot path.

**Optimisation.** Atomic flag for the fast path, mutex only on the actual close:

```go
type Pool struct {
	closed atomic.Bool
	mu     sync.Mutex
	queue  chan Job
}

func (p *Pool) Submit(j Job) error {
	if p.closed.Load() {
		return errors.New("closed")
	}
	p.mu.Lock()
	defer p.mu.Unlock()
	if p.closed.Load() {
		return errors.New("closed")
	}
	p.queue <- j
	return nil
}
```

The atomic check is sub-nanosecond. The mutex is only held during the actual close.

---

## Exercise 4. Drain Spawns A Goroutine Per Worker

**Slow code:**

```go
for i := 0; i < 1000; i++ {
	go func() {
		work()
	}()
}
```

**Problem.** 1000 goroutines for parallel work is fine, but if `work` is short, the spawn overhead dominates.

**Optimisation.** Use a fixed pool with a channel:

```go
jobs := make(chan int, 1000)
var wg sync.WaitGroup
for i := 0; i < 16; i++ { // workers = cores or 2x cores
	wg.Add(1)
	go func() {
		defer wg.Done()
		for j := range jobs {
			work(j)
		}
	}()
}
for i := 0; i < 1000; i++ {
	jobs <- i
}
close(jobs)
wg.Wait()
```

16 workers process 1000 jobs. Less spawn overhead, easier to drain.

---

## Exercise 5. Drain Uses A Per-Message WaitGroup

**Slow code:**

```go
for msg := range incoming {
	wg.Add(1)
	go func(m Msg) {
		defer wg.Done()
		process(m)
	}(msg)
}
```

**Problem.** A goroutine per message. At 100k msg/sec, that is 100k spawns per second. The wait group's atomic ops on `Add` and `Done` add up.

**Optimisation.** Worker pool. Workers consume from a channel; the wait group counts workers, not messages:

```go
for i := 0; i < workers; i++ {
	wg.Add(1)
	go func() {
		defer wg.Done()
		for msg := range incoming {
			process(msg)
		}
	}()
}
```

The wait group has `workers` entries, not `messages` entries. Much cheaper.

---

## Exercise 6. Drain Holds A Lock During Wait

**Slow code:**

```go
func (s *Service) Drain() {
	s.mu.Lock()
	defer s.mu.Unlock()
	s.closed = true
	close(s.in)
	s.wg.Wait()
}
```

**Problem.** `wg.Wait()` blocks while holding `s.mu`. Any goroutine that tries to acquire `s.mu` to check the closed flag deadlocks.

**Optimisation.** Release the lock before waiting:

```go
func (s *Service) Drain() {
	s.mu.Lock()
	s.closed = true
	close(s.in)
	s.mu.Unlock()
	s.wg.Wait()
}
```

The close is atomic with the flag set; the wait is unblocked.

---

## Exercise 7. Drain Logs Every Iteration

**Slow code:**

```go
for inFlight > 0 {
	log.Printf("drain: waiting, %d in flight", inFlight)
	time.Sleep(20 * time.Millisecond)
}
```

**Problem.** Logs 50 lines per second of drain. Most drains last < 5 seconds; that's 250 lines per drain. Noisy.

**Optimisation.** Log on transitions, not every poll:

```go
last := -1
for inFlight > 0 {
	cur := inFlight
	if cur != last {
		log.Printf("drain: %d in flight", cur)
		last = cur
	}
	time.Sleep(20 * time.Millisecond)
}
```

Or use a logger that rate-limits.

---

## Exercise 8. Sequential Drain Of Independent Components

**Slow code:**

```go
_ = httpServer.Drain(ctx)
_ = workerPool.Drain(ctx)
_ = producer.Drain(ctx)
```

**Problem.** If components are independent, they drain sequentially. Total time = sum.

**Optimisation.** Use `errgroup` for parallel drain:

```go
var eg errgroup.Group
eg.Go(func() error { return httpServer.Drain(ctx) })
eg.Go(func() error { return workerPool.Drain(ctx) })
eg.Go(func() error { return producer.Drain(ctx) })
_ = eg.Wait()
```

Total time = max, not sum. Significant speedup when components are slow but independent.

**Note.** Only safe if components are truly independent. If `workerPool` writes to `producer`, drain `workerPool` first.

---

## Exercise 9. Drain Calls Reader.Close() Twice

**Slow code:**

```go
func (c *Consumer) Drain() error {
	if err := c.reader.Close(); err != nil {
		// handle
	}
	if err := c.reader.Close(); err != nil { // again, by mistake
		// handle
	}
	return nil
}
```

**Problem.** Double close. Depending on the library, may panic or return an error.

**Optimisation.** Use `sync.Once` or guard with a flag.

---

## Exercise 10. Drain Reads From A Slow Source During Close

**Slow code:**

```go
func (c *Consumer) Drain(ctx context.Context) error {
	c.cancel()
	for {
		msg, err := c.reader.FetchMessage(ctx) // already cancelled
		if err != nil {
			break
		}
		_ = process(msg)
	}
	return c.reader.Close()
}
```

**Problem.** Continues fetching after cancel. Wastes time.

**Optimisation.** Stop fetching first; let in-flight finish:

```go
func (c *Consumer) Drain(ctx context.Context) error {
	c.cancel() // signals fetcher to stop
	c.wg.Wait() // wait for in-flight to finish
	return c.reader.Close()
}
```

---

## Exercise 11. Drain Uses Per-Tenant Sequential Pattern

**Slow code:**

```go
for _, t := range tenants {
	_ = t.Drain(ctx)
}
```

**Problem.** Tenants drain sequentially. Total time = sum.

**Optimisation.** Parallel drain across tenants:

```go
var eg errgroup.Group
for _, t := range tenants {
	t := t
	eg.Go(func() error { return t.Drain(ctx) })
}
_ = eg.Wait()
```

For 100 tenants × 1s each: sequential = 100s, parallel = 1s.

---

## Exercise 12. Drain Sends Many Small Network Requests

**Slow code:**

```go
for _, item := range pending {
	_ = client.Send(ctx, item)
}
```

**Problem.** Each `Send` is a network round-trip. For 1000 items, 1000 round-trips.

**Optimisation.** Batch:

```go
batches := chunk(pending, 100)
for _, batch := range batches {
	_ = client.SendBatch(ctx, batch)
}
```

10 round-trips instead of 1000. Dramatic improvement.

---

## Exercise 13. Drain Allocates Buffers Inside The Loop

**Slow code:**

```go
for _, item := range pending {
	buf := make([]byte, 0, 1024)
	encode(item, &buf)
	_ = client.Send(buf)
}
```

**Problem.** Allocates a new buffer per item.

**Optimisation.** Reuse:

```go
buf := make([]byte, 0, 1024)
for _, item := range pending {
	buf = buf[:0]
	encode(item, &buf)
	_ = client.Send(buf)
}
```

Or use `sync.Pool`:

```go
var bufPool = sync.Pool{
	New: func() any { b := make([]byte, 0, 1024); return &b },
}

buf := *(bufPool.Get().(*[]byte))
buf = buf[:0]
defer bufPool.Put(&buf)
encode(item, &buf)
```

---

## Exercise 14. Drain Recomputes State

**Slow code:**

```go
for inFlight() > 0 {
	time.Sleep(time.Millisecond)
}
```

If `inFlight()` is expensive (locks, iterates), this is slow.

**Optimisation.** Cache the count or use an atomic counter:

```go
for cnt.Load() > 0 {
	time.Sleep(time.Millisecond)
}
```

---

## Exercise 15. Drain Logs Synchronously

**Slow code:**

```go
log.Printf("drain phase=http")
_ = httpServer.Drain(ctx)
log.Printf("drain phase=workers")
_ = workerPool.Drain(ctx)
```

**Problem.** Each `log.Printf` is synchronous; if logs go over the network, this adds latency.

**Optimisation.** Async logger (e.g., `zap` with sampling). Or batch logs at end of drain.

---

## Exercise 16. Drain Walks All Goroutines

**Slow code:**

```go
for _, g := range runtime.Stack(...) {
	if alive(g) {
		// wait
	}
}
```

**Problem.** Reflection over the runtime stack is expensive.

**Optimisation.** Track goroutines explicitly via wait groups; do not reflect.

---

## Exercise 17. Drain Polls For Channel Empty

**Slow code:**

```go
for len(ch) > 0 {
	time.Sleep(time.Millisecond)
}
```

**Problem.** `len(ch)` is cheap, but the polling loop is wasteful.

**Optimisation.** Close the channel and `range` it:

```go
close(ch)
for range ch {
	// drain remaining items if needed
}
```

Or track in-flight separately via wait group.

---

## Exercise 18. Drain Does Full Snapshot Even If State Is Small

**Slow code:**

```go
func (c *Cache) Drain(ctx context.Context) error {
	return c.snapshot.Save(ctx, c.data)
}
```

If `c.data` is mostly unchanged since last snapshot, you save the same data twice.

**Optimisation.** Save only the dirty entries:

```go
func (c *Cache) Drain(ctx context.Context) error {
	if !c.dirty.Load() {
		return nil
	}
	return c.snapshot.Save(ctx, c.data)
}
```

Or use incremental snapshots.

---

## Exercise 19. Drain Holds A Snapshot Lock Too Long

**Slow code:**

```go
func (c *Cache) Drain(ctx context.Context) error {
	c.mu.Lock()
	defer c.mu.Unlock()
	return c.snapshot.Save(ctx, c.data)
}
```

If `snapshot.Save` is slow (disk I/O), readers are blocked.

**Optimisation.** Copy under lock; save outside:

```go
func (c *Cache) Drain(ctx context.Context) error {
	c.mu.RLock()
	dataCopy := make(map[K]V, len(c.data))
	for k, v := range c.data {
		dataCopy[k] = v
	}
	c.mu.RUnlock()
	return c.snapshot.Save(ctx, dataCopy)
}
```

Now the lock is held briefly. Save runs without contention.

---

## Exercise 20. Drain Blocks On Network During Close

**Slow code:**

```go
defer db.Close() // may block forever if connections are stuck
```

**Problem.** Stuck connections can hang `db.Close` past the drain budget.

**Optimisation.** Bound it:

```go
done := make(chan struct{})
go func() { _ = db.Close(); close(done) }()
select {
case <-done:
case <-ctx.Done():
	// give up; some connections leak temporarily, OS reclaims on exit
}
```

Better: lower `db.SetConnMaxLifetime` so connections expire faster.

---

## Conclusion

These optimisations matter at scale. A drain that takes 5s instead of 25s means:

- Faster deploys.
- Lower capacity loss during deploys.
- Smaller window for in-flight requests to be cancelled.

Many of these are small (single-line changes). The cumulative effect across a service can cut drain time in half.

Run through these. Apply them to your code. Measure before and after. Track the improvement in metrics.

Drain is performance-sensitive. Treat it accordingly.

---

## Drill: Profile Your Drain

For your service:

1. Take a CPU profile at the start of drain.
2. Identify the top three time consumers.
3. Apply optimisations from this page.
4. Profile again. Verify improvement.

Each cycle of profile-fix-profile teaches you something. After three cycles, your drain is fast.

---

## Closing Note

Optimisation is not the first step. First make drain correct, then make it fast. A correct slow drain is better than a fast broken drain.

But once correct, optimise. The benefits are real.

End of optimization exercises.
