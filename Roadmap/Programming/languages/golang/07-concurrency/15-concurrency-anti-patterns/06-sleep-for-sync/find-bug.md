---
layout: default
title: Find Bug
parent: Sleep for Sync
grand_parent: Concurrency Anti-Patterns
ancestor: Go
nav_order: 8
permalink: /roadmap/programming-languages/golang/07-concurrency/15-concurrency-anti-patterns/06-sleep-for-sync/find-bug/
---

# Sleep for Synchronization — Find The Bug

## How To Use This File

Each snippet has at least one bug related to using `time.Sleep` as synchronisation, or to flaky timing patterns. Read each snippet carefully; identify the bug *before* reading the analysis. Difficulty: roughly `[J]` through `[P]`.

---

## Snippet 1 [J] — "Did The Goroutine Start?"

```go
func TestStart(t *testing.T) {
    s := NewService()
    go s.Run()
    time.Sleep(50 * time.Millisecond)
    if !s.IsRunning() {
        t.Fatal("service not running after 50ms")
    }
}
```

**The bug.** 50ms is a guess. On a fast machine the test passes; on a slow shared CI runner the goroutine may not have entered `Run` yet. The test is flaky.

**Worse**: there is also a data race. `s.IsRunning` reads internal state that the goroutine wrote without synchronisation.

**Fix.** Expose a `Ready()` channel; the test does `<-s.Ready()` instead of sleeping.

---

## Snippet 2 [J] — "Send Then Check"

```go
func TestQueue(t *testing.T) {
    q := NewQueue()
    go q.Process()
    q.Submit("a")
    q.Submit("b")
    q.Submit("c")
    time.Sleep(100 * time.Millisecond)
    if got := q.Stats().Processed; got != 3 {
        t.Errorf("processed = %d, want 3", got)
    }
}
```

**The bug.** Three submits go in; the test sleeps 100ms; the assertion expects 3 processed. But the goroutine `Process` may not have started yet, may have processed only 2, etc. The sleep is a guess.

**Fix.** Have `Submit` return a future or `Process` expose a "drained" channel. Best: `q.Submit` is synchronous, or `q.Wait()` is exposed for tests.

---

## Snippet 3 [J] — "Sleep Inside The Goroutine"

```go
go func() {
    wg.Add(1)
    defer wg.Done()
    work()
}()
wg.Wait()
```

**The bug.** `wg.Add(1)` is called inside the goroutine. The main goroutine may call `wg.Wait()` before the new goroutine has scheduled in, observing a counter of 0 and returning immediately. The test may pass (no work was needed) or fail mysteriously later (work happens after the assertion).

**Fix.** Call `wg.Add(1)` *before* `go`:

```go
wg.Add(1)
go func() {
    defer wg.Done()
    work()
}()
wg.Wait()
```

---

## Snippet 4 [J] — "Cancel Then Read"

```go
ctx, cancel := context.WithCancel(context.Background())
go worker(ctx)
cancel()
time.Sleep(100 * time.Millisecond)
if worker.IsRunning() {
    t.Fatal("did not stop")
}
```

**The bug.** The test does not wait for the worker to actually exit. The sleep is a guess. If the worker takes 150ms to shut down (cleanup, flush, etc.), the test fails. If the worker takes 1ms, the test wastes 99ms.

**Fix.** Add a `Done()` channel:

```go
done := make(chan struct{})
go func() { defer close(done); worker(ctx) }()
cancel()
<-done
```

Wrap in a `select` with a safety timeout if you want.

---

## Snippet 5 [M] — "Tuned Sleep In CI"

```go
func TestPipeline(t *testing.T) {
    p := NewPipeline()
    go p.Run()
    // Local timing: takes ~30ms. CI takes ~150ms. Bumped to 500ms to be safe.
    time.Sleep(500 * time.Millisecond)
    if got := p.Output(); !equalSets(got, expected) {
        t.Errorf("got %v", got)
    }
}
```

**The bug.** This is the worst kind: someone "fixed" the flakiness by bumping the sleep to 500ms. Now the test passes most of the time but wastes 470ms per run. On the day CI is genuinely slow (load spike, GC, noisy neighbour), the test will fail at 500ms too, and someone will bump it to 1s. Death spiral.

**Fix.** Replace with a channel-based join or `synctest`. Test runtime drops from 500ms to <1ms and flakiness becomes zero.

---

## Snippet 6 [M] — "Sleep Then Cancel In A Loop"

```go
go func() {
    for {
        time.Sleep(time.Second)
        if shouldStop() {
            return
        }
        do()
    }
}()
```

**The bug.** The goroutine sleeps for the full second before checking `shouldStop`. If the caller wants to stop the goroutine, they must wait up to a second. There is also no `context` cancellation, so the goroutine cannot be interrupted.

**Fix.**

```go
t := time.NewTicker(time.Second)
defer t.Stop()
for {
    select {
    case <-ctx.Done():
        return
    case <-t.C:
        do()
    }
}
```

---

## Snippet 7 [M] — "Time.After In A Loop"

```go
for {
    select {
    case <-time.After(time.Minute):
        process()
    case <-ctx.Done():
        return
    }
}
```

**The bug.** Each iteration creates a new timer via `time.After`. Before Go 1.23, the timer is not GC'd until it fires; the loop accumulates orphaned timers if the loop iterates due to other cases (although there are no other cases here, in real code there often are).

Even on Go 1.23+, allocating a timer per iteration is wasteful.

**Fix.** Use `time.NewTimer` + `Reset` or `time.NewTicker` + `Stop`:

```go
t := time.NewTicker(time.Minute)
defer t.Stop()
for {
    select {
    case <-t.C:
        process()
    case <-ctx.Done():
        return
    }
}
```

---

## Snippet 8 [M] — "Polling Without Backoff"

```go
for {
    if cond() {
        return
    }
}
```

**The bug.** Tight CPU spin. Burns 100% of a core until `cond()` is true.

**Fix.** Add a sleep, but better: use a notification.

```go
for !cond() {
    time.Sleep(time.Millisecond)
}
```

is acceptable for a polling helper. A channel-based notification is better:

```go
<-condReady
```

---

## Snippet 9 [M] — "Sleep Under Mutex"

```go
func (s *Service) Update(x int) {
    s.mu.Lock()
    defer s.mu.Unlock()
    s.x = x
    time.Sleep(10 * time.Millisecond) // "let observers catch up"
}
```

**The bug.** The mutex is held during the sleep. Other goroutines calling `Update` (or any other locked method) block for the full 10ms. Worse, the rationale ("let observers catch up") is the sleep-as-sync anti-pattern: there is no contract about what observers do, so this sleep is guessing about external timing.

**Fix.** Release the lock before sleeping. Better: do not sleep at all; if observers need notification, send on a channel.

---

## Snippet 10 [M] — "Sleep Instead Of WaitForReady"

```go
func TestAPI(t *testing.T) {
    container, _ := testcontainers.Start("postgres:16")
    time.Sleep(5 * time.Second) // wait for postgres to be ready
    conn := connect(container.Addr())
    // ... test ...
}
```

**The bug.** 5 seconds is a guess. On fast hardware, postgres may be ready in 1 second; on slow CI it may take 10. Also the test wastes 5 seconds on every run.

**Fix.** Use `testcontainers`'s `WaitFor` strategies:

```go
container, _ := testcontainers.Start(
    "postgres:16",
    testcontainers.WithWaitStrategy(wait.ForLog("ready to accept connections")),
)
```

---

## Snippet 11 [S] — "Fake Clock Misused"

```go
func TestCache(t *testing.T) {
    clk := clockwork.NewFakeClock()
    c := NewCache(clk, 100*time.Millisecond)
    c.Set("k", "v")
    clk.Advance(50 * time.Millisecond)
    if v, _ := c.Get("k"); v != "v" {
        t.Error("should still exist")
    }
    time.Sleep(60 * time.Millisecond) // BUG
    if v, _ := c.Get("k"); v != nil {
        t.Error("should have expired")
    }
}
```

**The bug.** The second wait uses `time.Sleep`, not `clk.Advance`. The cache's internal logic reads `clk.Now()`, which only advances when `clk.Advance` is called. The test sleeps for 60ms of real time, but the cache's notion of "now" has not moved past 50ms. The entry is *still valid* and the test fails.

**Fix.** Call `clk.Advance(60 * time.Millisecond)` instead.

---

## Snippet 12 [S] — "Mixing Real And Fake Clock"

```go
type Service struct {
    clk Clock
}

func (s *Service) Run() {
    for {
        time.Sleep(time.Second) // BUG: uses real clock, not s.clk
        s.tick()
    }
}
```

**The bug.** The service accepts a `Clock`, suggesting tests want to fake it. But `Run` calls `time.Sleep` directly instead of `s.clk.Sleep`. Fake-clock tests cannot advance through the sleep; they wait real time and the test is flaky and slow.

**Fix.** All time accesses must go through `s.clk`.

```go
for {
    s.clk.Sleep(time.Second)
    s.tick()
}
```

---

## Snippet 13 [S] — "Synctest Bubble Hangs"

```go
func TestService(t *testing.T) {
    synctest.Test(t, func(t *testing.T) {
        s := NewService()
        go s.Run()
        resp, _ := http.Get("http://example.com")
        // ... assertions ...
    })
}
```

**The bug.** Inside the bubble, `http.Get` makes a real network call, which uses `net.Dial`. `net.Dial` parks on `epoll_wait`, which is *not* durable blocking. The bubble cannot advance virtual time. If `s.Run` is waiting on a virtual timer, it never fires and the bubble deadlocks.

**Fix.** Do not make real network calls inside `synctest`. Use `httptest.NewServer` (note: even this can have issues if it uses real TCP) or mock the HTTP client.

---

## Snippet 14 [S] — "Wait For Goroutine Without Mechanism"

```go
func TestWorkers(t *testing.T) {
    var counts []int
    for i := 0; i < 10; i++ {
        i := i
        go func() {
            counts = append(counts, work(i))
        }()
    }
    time.Sleep(time.Second)
    sort.Ints(counts)
    if !reflect.DeepEqual(counts, []int{0, 1, 2, 3, 4, 5, 6, 7, 8, 9}) {
        t.Errorf("got %v", counts)
    }
}
```

**The bug.** Two bugs:

1. Sleep-based sync.
2. **Data race**: `append(counts, ...)` from 10 goroutines is a race. Even if the sleep were long enough, the final slice content is undefined.

**Fix.** Use a channel:

```go
counts := make([]int, 0, 10)
ch := make(chan int, 10)
var wg sync.WaitGroup
wg.Add(10)
for i := 0; i < 10; i++ {
    i := i
    go func() {
        defer wg.Done()
        ch <- work(i)
    }()
}
go func() { wg.Wait(); close(ch) }()
for v := range ch {
    counts = append(counts, v)
}
sort.Ints(counts)
```

---

## Snippet 15 [S] — "Retry With Sleep, Not Cancellable"

```go
func Retry(op func() error, n int, base time.Duration) error {
    var last error
    for i := 0; i < n; i++ {
        if err := op(); err == nil {
            return nil
        } else {
            last = err
        }
        time.Sleep(base * (1 << i)) // BUG: not cancellable
    }
    return last
}
```

**The bug.** The retry sleeps using `time.Sleep`, which is not cancellable. If the caller's context is cancelled during a 16-second backoff, the goroutine sleeps the full 16 seconds before noticing.

**Fix.** Accept a context, wait with `select`:

```go
func Retry(ctx context.Context, op func(context.Context) error, n int, base time.Duration) error {
    var last error
    for i := 0; i < n; i++ {
        if err := op(ctx); err == nil {
            return nil
        } else {
            last = err
        }
        select {
        case <-time.After(base * (1 << i)):
        case <-ctx.Done():
            return errors.Join(last, ctx.Err())
        }
    }
    return last
}
```

---

## Snippet 16 [S] — "Synchronous Test On Async API"

```go
func TestEvent(t *testing.T) {
    s := NewServer()
    s.OnEvent(func(e Event) {
        if e.Type != "expected" {
            t.Errorf("got %v", e)
        }
    })
    s.Fire("expected")
    time.Sleep(100 * time.Millisecond)
}
```

**The bug.** The callback may run *after* the test function returns. If `t.Errorf` is called from a goroutine after the test has returned, the failure may be silently dropped or cause a panic in `t.Errorf` (since `t` is no longer in scope for this test).

Also, the test passes if the callback never runs (since the assertion is inside the callback).

**Fix.** Ship observations into a channel; assert outside the callback:

```go
events := make(chan Event, 1)
s.OnEvent(func(e Event) { events <- e })
s.Fire("expected")
select {
case e := <-events:
    if e.Type != "expected" {
        t.Errorf("got %v", e)
    }
case <-time.After(2 * time.Second):
    t.Fatal("no event")
}
```

---

## Snippet 17 [P] — "Time.Sleep Inside A Critical Section"

```go
func (s *Service) ProcessAll(items []Item) {
    s.mu.Lock()
    defer s.mu.Unlock()
    for _, item := range items {
        s.process(item)
        time.Sleep(10 * time.Millisecond) // "throttle"
    }
}
```

**The bug.** The mutex is held for the entire loop, including the sleeps. If there are 1000 items, the mutex is held for 10+ seconds. Any other goroutine wanting any locked method blocks for that long.

The intent (throttle) is reasonable but the implementation is wrong.

**Fix.** Release the lock during the sleep, or move throttling outside the lock:

```go
for _, item := range items {
    s.mu.Lock()
    s.process(item)
    s.mu.Unlock()
    time.Sleep(10 * time.Millisecond)
}
```

Better: use `golang.org/x/time/rate` so the throttling is correct and testable.

---

## Snippet 18 [P] — "Signal Handler That Sleeps"

```go
sigCh := make(chan os.Signal, 1)
signal.Notify(sigCh, syscall.SIGTERM)
go func() {
    sig := <-sigCh
    log.Printf("got %v, shutting down", sig)
    time.Sleep(30 * time.Second) // give workers time to finish
    os.Exit(0)
}()
```

**The bug.** Multiple issues:

1. The signal goroutine sleeps for 30 seconds; a second SIGTERM during this time has nowhere to go (channel is full). User cannot force shutdown by sending SIGTERM twice.
2. The 30 seconds is a guess about how long workers need.
3. `os.Exit` does not run `defer`s anywhere in the program.

**Fix.** Use `context` cancellation to coordinate shutdown:

```go
ctx, cancel := signal.NotifyContext(context.Background(), syscall.SIGTERM)
defer cancel()
// pass ctx to workers; they shut down via ctx.Done().
// Wait for them with errgroup or WaitGroup.
```

---

## Snippet 19 [P] — "Deadline From Sleep In A Service Mesh"

```go
func (h *Handler) Handle(w http.ResponseWriter, r *http.Request) {
    go func() {
        time.Sleep(5 * time.Second)
        if !done {
            log.Print("request took too long")
        }
    }()
    process()
    done = true
}
```

**The bug.** Three:

1. The 5-second "watchdog" uses `time.Sleep`, not `context.WithTimeout` or `time.AfterFunc`.
2. The `done` variable is read and written from two goroutines without synchronisation (race).
3. The watchdog goroutine leaks if `process` is fast.

**Fix.** Use the request's context for the deadline; use a `context.WithTimeout` derived context for the watchdog; remove the homegrown timing entirely if you have observability via OpenTelemetry traces.

---

## Snippet 20 [P] — "Cache Refresh At Fixed Time"

```go
func (c *Cache) RefreshLoop() {
    for {
        next := time.Now().Truncate(time.Hour).Add(time.Hour)
        time.Sleep(time.Until(next))
        c.refresh()
    }
}
```

**The bug.** All replicas of the service wake at the same instant (top of the hour) and refresh simultaneously, hammering the upstream data source. Classic synchronised-refresh anti-pattern.

Also:

- Wall-clock based: if the system clock jumps forward (DST, NTP), the next refresh may be skipped or repeated.
- Not cancellable.

**Fix.** Add jitter; use monotonic time; respect context:

```go
func (c *Cache) RefreshLoop(ctx context.Context) {
    for {
        d := time.Hour + time.Duration(rand.Int63n(int64(5*time.Minute)))
        timer := time.NewTimer(d)
        select {
        case <-ctx.Done():
            timer.Stop()
            return
        case <-timer.C:
            c.refresh()
        }
    }
}
```

---

## Snippet 21 [P] — "Sleep For Lease Expiry"

```go
func (n *Node) Lead() {
    for n.IsLeader() {
        time.Sleep(leaseDuration - safetyMargin)
        n.renew()
    }
}
```

**The bug.** Three issues:

1. `time.Sleep` is not cancellable; if the node steps down (loses leadership), it still sleeps until renew.
2. The `leaseDuration - safetyMargin` calculation does not account for the time taken by `n.renew()` itself. If renew takes longer than the margin, the lease expires and the node spuriously loses leadership.
3. Wall-clock based: under clock skew across nodes, the lease may expire on followers before the leader renews.

**Fix.** Use logical leases, monotonic clock, context cancellation, and account for renewal latency:

```go
for {
    select {
    case <-ctx.Done():
        return
    case <-time.After(leaseDuration - safetyMargin):
    }
    if err := n.renew(ctx); err != nil {
        return // lost leadership
    }
}
```

And budget the renewal time correctly.

---

## Snippet 22 [P] — "Test That Passes Because Of A Sleep"

```go
func TestProducerConsumer(t *testing.T) {
    p := NewProducer()
    c := NewConsumer()
    go p.Produce()
    go c.Consume()
    time.Sleep(1 * time.Second)
    if c.Total() != 1000 {
        t.Errorf("got %d, want 1000", c.Total())
    }
}
```

**The bug.** The test passes because the 1-second sleep is long enough for the producer to publish all 1000 messages and the consumer to drain them. But:

- The producer's `Produce` method might leak: if it has not finished after 1s (e.g. due to GC pause), the test fails even though the producer is correct.
- The consumer might still be processing after 1s.
- The test cannot prove that the producer correctly stops after 1000 messages or that the consumer correctly handles the producer's close.

**Fix.** Use deterministic synchronisation: producer signals done via channel close; consumer drains until channel close; test waits for consumer's exit:

```go
done := make(chan struct{})
go func() {
    defer close(done)
    p.ProduceAll() // synchronous
}()
c.Run() // also synchronous, drains until producer's channel closes
<-done
```

---

## Bonus Snippet 23 [P] — "Sleep To Get Around A Mutex Race"

```go
func (s *Service) Stop() {
    s.shutdown = true
    time.Sleep(time.Second) // "let goroutines see the flag"
    close(s.queue)
}
```

**The bug.** The `shutdown` flag is written and read from multiple goroutines without synchronisation. The 1-second sleep is the author's attempt to "ensure visibility" — a deeply confused mental model. The Go memory model does not guarantee any duration sufficient to make unsynchronised writes visible.

**Fix.** Use atomic or mutex:

```go
s.shutdown.Store(true)
close(s.queue)
```

with `s.shutdown` as `atomic.Bool`. Or use channel close to broadcast.

---

## What To Practice

After working through these snippets, you should be able to:

- See `time.Sleep` in any code review and immediately ask "what event is this waiting for".
- Spot the three common shapes: (a) sleep-then-assert, (b) sleep-then-cancel, (c) sleep-as-mutex.
- Recognise when a sleep is wrapped around a real race condition (memory race, leak race).
- Suggest the right replacement (`WaitGroup`, channel, `synctest`, `Clock`) without thinking.

Re-read this file every few months and try the snippets cold. The skill atrophies without practice.
