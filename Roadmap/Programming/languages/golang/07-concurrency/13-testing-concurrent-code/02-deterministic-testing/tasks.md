# Deterministic Testing — Tasks and Exercises

A progression from easy rewrites to architectural refactors. Each task includes a starting point, a target, and a hint. Solutions are sketched at the end.

---

## Task 1 — Rewrite a sleep-based test

### Starting code

```go
func TestIncrement(t *testing.T) {
    var c int
    go func() { c++ }()
    time.Sleep(10 * time.Millisecond)
    if c != 1 {
        t.Fatal("expected 1")
    }
}
```

### Target

Rewrite without `time.Sleep`. The test must pass under `go test -race -count=100`.

### Hint

Use a `chan struct{}` to signal completion.

---

## Task 2 — Rewrite for N goroutines

### Starting code

```go
func TestSum(t *testing.T) {
    var sum int64
    for i := 0; i < 100; i++ {
        go func(v int) {
            atomic.AddInt64(&sum, int64(v))
        }(i)
    }
    time.Sleep(50 * time.Millisecond)
    if got := atomic.LoadInt64(&sum); got != 4950 {
        t.Fatalf("got %d want 4950", got)
    }
}
```

### Target

Use `sync.WaitGroup` so the test never sleeps and passes under `-race -count=200`.

---

## Task 3 — Drain a pipeline

### Starting code

```go
func TestPipeline(t *testing.T) {
    in := make(chan int)
    out := square(in)
    go func() {
        for i := 1; i <= 5; i++ {
            in <- i
        }
        close(in)
    }()
    time.Sleep(20 * time.Millisecond)
    var got []int
    for {
        select {
        case v := <-out:
            got = append(got, v)
        default:
        }
    }
    // assertion never reached because the loop never exits
}
```

### Target

Use `for v := range out` to drain until the pipeline closes its output. No sleep.

### Hint

Make sure `square` closes `out` when `in` closes.

---

## Task 4 — Test a TTL cache with a fake clock

### Starting code

```go
type Cache struct {
    items map[string]item
}

type item struct {
    v   string
    exp time.Time
}

func (c *Cache) Set(k, v string, ttl time.Duration) {
    c.items[k] = item{v, time.Now().Add(ttl)}
}

func (c *Cache) Get(k string) (string, bool) {
    it, ok := c.items[k]
    if !ok || time.Now().After(it.exp) {
        return "", false
    }
    return it.v, true
}
```

### Target

1. Refactor `Cache` to accept a `Clock` interface.
2. Write a test that uses `clockwork.NewFakeClock` to verify expiration at the exact boundary.
3. The test must run in under 1 millisecond.

### Hint

Define `type Clock interface { Now() time.Time }`. Inject via constructor.

---

## Task 5 — Test a retry-with-backoff using `synctest`

### Starting code

```go
func Retry(fn func() error, max int, base time.Duration) error {
    delay := base
    for i := 0; i < max; i++ {
        if err := fn(); err == nil {
            return nil
        }
        time.Sleep(delay)
        delay *= 2
    }
    return errors.New("max retries")
}
```

### Target

Write a test (Go 1.24+) that:

1. Uses `testing/synctest`.
2. Confirms `fn` is called exactly N times when configured.
3. Confirms virtual elapsed time matches the expected backoff sum.
4. Runs in under 1 millisecond of wall clock.

### Hint

Inside `synctest.Run`, `time.Sleep` returns immediately in wall clock but advances virtual time.

---

## Task 6 — Build a worker pool test

### Target

Write a `WorkerPool` with these methods:
- `New(size int) *Pool`
- `Submit(task func())`
- `Close()` — refuse new submissions, drain queue, wait for workers to exit.

Write tests that verify:
- 1000 tasks submitted, all execute.
- After `Close`, `Submit` panics or returns an error.
- After `Close` returns, no goroutines are leaked (use `goleak`).

The test must pass under `go test -race -count=50`.

---

## Task 7 — Test a rate limiter

### Starting code

```go
type Limiter struct {
    rate     int
    last     time.Time
    tokens   int
}

func (l *Limiter) Allow() bool {
    now := time.Now()
    elapsed := now.Sub(l.last)
    l.tokens += int(elapsed.Seconds()) * l.rate
    if l.tokens > l.rate { l.tokens = l.rate }
    l.last = now
    if l.tokens > 0 {
        l.tokens--
        return true
    }
    return false
}
```

### Target

1. Refactor to use injected `Clock`.
2. Write a test that exercises: empty bucket → wait → refilled → drained.
3. All assertions on exact `Allow` boundaries.

---

## Task 8 — Test cancellation

### Starting code

```go
func Process(ctx context.Context, work <-chan Task) {
    for {
        select {
        case t := <-work:
            t.Run()
        case <-ctx.Done():
            return
        }
    }
}
```

### Target

Write tests that:
1. Verify `Process` exits when `ctx` is cancelled.
2. Verify `Process` does not exit while tasks are pending and context is alive.
3. No `time.Sleep`. The exit assertion uses a `done` channel signal.

---

## Task 9 — Test a state machine

### Starting code

A traffic light state machine: `Red → Green → Yellow → Red`, transitioning every 10 seconds.

### Target

1. Implement using a goroutine and a ticker.
2. Inject a clock.
3. Write tests that drive: at t=0 Red, at t=10s Green, at t=20s Yellow, at t=30s Red.
4. Use `synctest` to make the test instant.

---

## Task 10 — Repeatable property test

### Target

Use `pgregory.net/rapid` to write a property test for a concurrent FIFO queue: enqueueing N items in random order from K goroutines, then dequeueing all, produces all enqueued items (order may differ but set must match).

Run under `-race -count=10`. On failure, the seed must be logged and the failure reproducible with `-seed=N`.

---

## Task 11 — Find the synthetic flake

### Starting code (a deliberately flaky test)

```go
func TestThing(t *testing.T) {
    s := New()
    var ready bool
    go func() {
        s.Init()
        ready = true
    }()
    for !ready {
        runtime.Gosched()
    }
    if !s.IsReady() {
        t.Fatal("not ready")
    }
}
```

### Target

1. Identify every race / determinism bug. There are at least three.
2. Rewrite to be deterministic and race-free.

---

## Task 12 — `goleak` integration

### Target

For a package you own, add `goleak.VerifyTestMain(m)`. Run the tests. If any leak, identify and fix. Document any legitimate background goroutines as `goleak.IgnoreTopFunction` with a comment.

---

## Task 13 — `-cpu` sweep

### Target

Pick a concurrent test you have written. Run:

```
go test -race -cpu 1,2,4,8 -count=20 -run TestPick ./pkg
```

If any combination fails, diagnose. If all pass, add this command to your CI as a nightly job.

---

## Task 14 — Quiescent observation API

### Target

Take a `Worker` type that consumes from a channel and processes tasks. Add a `WaitIdle(ctx)` method that returns when the worker's input is empty *and* it is currently blocked on receive (i.e., quiescent).

Test it: submit 5 tasks, call `WaitIdle`, assert all 5 finished.

---

## Task 15 — Replay test

### Target

You have a log file of a production incident: a sequence of events with timestamps. Convert it into a deterministic test that drives the system at virtual time, replaying the events, and asserts no goroutine leak or incorrect state.

---

## Solution sketches

### Task 1

```go
func TestIncrement(t *testing.T) {
    var c int
    done := make(chan struct{})
    go func() {
        c++
        close(done)
    }()
    <-done
    if c != 1 {
        t.Fatal("expected 1")
    }
}
```

### Task 2

```go
func TestSum(t *testing.T) {
    var sum int64
    var wg sync.WaitGroup
    for i := 0; i < 100; i++ {
        wg.Add(1)
        go func(v int) {
            defer wg.Done()
            atomic.AddInt64(&sum, int64(v))
        }(i)
    }
    wg.Wait()
    if got := atomic.LoadInt64(&sum); got != 4950 {
        t.Fatalf("got %d want 4950", got)
    }
}
```

### Task 3

```go
func square(in <-chan int) <-chan int {
    out := make(chan int)
    go func() {
        defer close(out)
        for v := range in {
            out <- v * v
        }
    }()
    return out
}

func TestPipeline(t *testing.T) {
    in := make(chan int)
    out := square(in)
    go func() {
        defer close(in)
        for i := 1; i <= 5; i++ {
            in <- i
        }
    }()
    var got []int
    for v := range out {
        got = append(got, v)
    }
    want := []int{1, 4, 9, 16, 25}
    if !reflect.DeepEqual(got, want) {
        t.Fatalf("got %v want %v", got, want)
    }
}
```

### Task 4

```go
type Clock interface { Now() time.Time }

type Cache struct {
    clock Clock
    items map[string]item
}

func NewCache(clock Clock) *Cache {
    return &Cache{clock: clock, items: make(map[string]item)}
}

func (c *Cache) Set(k, v string, ttl time.Duration) {
    c.items[k] = item{v, c.clock.Now().Add(ttl)}
}

func (c *Cache) Get(k string) (string, bool) {
    it, ok := c.items[k]
    if !ok || c.clock.Now().After(it.exp) {
        return "", false
    }
    return it.v, true
}

func TestCacheTTL(t *testing.T) {
    clk := clockwork.NewFakeClock()
    c := NewCache(clk)
    c.Set("k", "v", 10*time.Second)
    if _, ok := c.Get("k"); !ok { t.Fatal("expected hit at t=0") }
    clk.Advance(10*time.Second)
    if _, ok := c.Get("k"); !ok { t.Fatal("expected hit at boundary") }
    clk.Advance(1)
    if _, ok := c.Get("k"); ok { t.Fatal("expected miss past boundary") }
}
```

### Task 5

```go
func TestRetry_Synctest(t *testing.T) {
    synctest.Run(func() {
        calls := 0
        fn := func() error {
            calls++
            if calls < 3 { return errors.New("transient") }
            return nil
        }
        start := time.Now()
        if err := Retry(fn, 5, 100*time.Millisecond); err != nil {
            t.Fatal(err)
        }
        if calls != 3 { t.Fatalf("calls=%d", calls) }
        want := 300 * time.Millisecond
        if elapsed := time.Since(start); elapsed != want {
            t.Fatalf("virtual elapsed %v want %v", elapsed, want)
        }
    })
}
```

### Task 6 (skeleton)

```go
type Pool struct {
    tasks chan func()
    done  chan struct{}
    once  sync.Once
    wg    sync.WaitGroup
}

func New(size int) *Pool {
    p := &Pool{
        tasks: make(chan func(), 64),
        done:  make(chan struct{}),
    }
    for i := 0; i < size; i++ {
        p.wg.Add(1)
        go p.worker()
    }
    return p
}

func (p *Pool) worker() {
    defer p.wg.Done()
    for t := range p.tasks { t() }
}

func (p *Pool) Submit(t func()) error {
    select {
    case <-p.done:
        return errors.New("pool closed")
    default:
        p.tasks <- t
        return nil
    }
}

func (p *Pool) Close() {
    p.once.Do(func() {
        close(p.done)
        close(p.tasks)
    })
    p.wg.Wait()
}

func TestPool(t *testing.T) {
    p := New(4)
    var done atomic.Int64
    for i := 0; i < 1000; i++ {
        if err := p.Submit(func() { done.Add(1) }); err != nil {
            t.Fatal(err)
        }
    }
    p.Close()
    if got := done.Load(); got != 1000 {
        t.Fatalf("got %d want 1000", got)
    }
}

func TestMain(m *testing.M) {
    goleak.VerifyTestMain(m)
}
```

### Task 7

Similar to Task 4 — inject clock, advance, assert.

### Task 8

```go
func TestProcess_Cancels(t *testing.T) {
    work := make(chan Task)
    ctx, cancel := context.WithCancel(context.Background())
    done := make(chan struct{})
    go func() {
        defer close(done)
        Process(ctx, work)
    }()
    cancel()
    select {
    case <-done:
    case <-time.After(5 * time.Second):
        t.Fatal("did not exit after cancel")
    }
}
```

### Task 9 (skeleton)

```go
type TrafficLight struct {
    clock Clock
    state atomic.Int32
}

func (l *TrafficLight) Run(ctx context.Context) {
    t := l.clock.NewTicker(10*time.Second)
    defer t.Stop()
    for {
        select {
        case <-t.C():
            l.next()
        case <-ctx.Done():
            return
        }
    }
}
```

Inside `synctest.Run`, start the goroutine, advance time, observe state transitions.

### Task 10 (sketch)

```go
func TestQueue_Property(t *testing.T) {
    rapid.Check(t, func(rt *rapid.T) {
        items := rapid.SliceOfN(rapid.Int(), 1, 1000).Draw(rt, "items")
        q := NewQueue()
        var wg sync.WaitGroup
        for _, v := range items {
            wg.Add(1)
            go func(v int) {
                defer wg.Done()
                q.Push(v)
            }(v)
        }
        wg.Wait()
        var got []int
        for v, ok := q.Pop(); ok; v, ok = q.Pop() {
            got = append(got, v)
        }
        // multiset equality
        sort.Ints(got)
        sort.Ints(items)
        if !reflect.DeepEqual(got, items) {
            rt.Fatalf("mismatch: got %v want %v", got, items)
        }
    })
}
```

### Task 11

Bugs: (1) `ready` is read and written without synchronisation — data race. (2) `for !ready { runtime.Gosched() }` is a busy-wait, not deterministic. (3) `Gosched` is not a happens-before edge; the read may never see the write. Rewrite using a `chan struct{}`:

```go
func TestThing(t *testing.T) {
    s := New()
    done := make(chan struct{})
    go func() {
        s.Init()
        close(done)
    }()
    <-done
    if !s.IsReady() {
        t.Fatal("not ready")
    }
}
```

### Task 12, 13, 14, 15

Implementation-specific. Apply the patterns from the corresponding sections of `middle.md` and `senior.md`.

---

End of tasks.
