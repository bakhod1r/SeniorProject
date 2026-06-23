# Channel Runtime Behaviour — Tasks

The tasks below exercise every runtime path: buffer copy, direct hand-off, parking, close drain, select shuffle, select lock order, and the memory-model edges. Each task lists a goal, a hint, and an acceptance test.

---

## Task 1 — Observe the closed-channel fast path

**Goal.** Write a benchmark that measures the cost of `<-ch` on a closed channel, where the call returns immediately without parking.

**Hint.** Close the channel before the benchmark loop. Reads on a closed empty channel return `(0, false)` without locking.

**Acceptance.** Result is < 10 ns/op on x86_64. If it exceeds 50 ns/op, you are accidentally creating a new channel inside the loop.

```go
func BenchmarkClosedRecv(b *testing.B) {
    ch := make(chan int)
    close(ch)
    b.ResetTimer()
    for i := 0; i < b.N; i++ {
        <-ch
    }
}
```

---

## Task 2 — Force direct hand-off and measure

**Goal.** Build a ping-pong benchmark where each round-trip uses direct hand-off (no parking penalty). Compare to a buffered version.

**Hint.** Use two goroutines and an unbuffered channel. Ensure GOMAXPROCS=2 so the producer and consumer can run truly concurrently.

**Acceptance.** Unbuffered ping-pong < 250 ns per round-trip. Buffered version with capacity 1 should be within 20% of unbuffered.

```go
func BenchmarkPingPongUnbuffered(b *testing.B) {
    ch := make(chan int)
    go func() {
        for i := 0; i < b.N; i++ {
            <-ch
        }
    }()
    b.ResetTimer()
    for i := 0; i < b.N; i++ {
        ch <- 1
    }
}
```

---

## Task 3 — Force parking and measure the cost

**Goal.** Construct a scenario where every send must park. Measure the per-op cost and confirm it is in the microseconds, not nanoseconds.

**Hint.** Make the receiver sleep between receives. The sender will park on `sendq` waiting for space (or rendezvous).

**Acceptance.** Per-op cost in the 1–5 μs range. If you see < 500 ns, you are not actually parking — adjust receiver behaviour.

```go
func BenchmarkSendPark(b *testing.B) {
    ch := make(chan int, 1)
    done := make(chan struct{})
    go func() {
        for i := 0; i < b.N; i++ {
            time.Sleep(time.Microsecond) // make consumer slow
            <-ch
        }
        close(done)
    }()
    b.ResetTimer()
    for i := 0; i < b.N; i++ {
        ch <- i
    }
    <-done
}
```

---

## Task 4 — Demonstrate that `close` wakes all receivers

**Goal.** Spawn N goroutines that block on `<-ch`. Close the channel and verify all N goroutines complete.

**Acceptance.** After `close`, all N goroutines exit; total time scales linearly with N.

```go
func TestCloseWakesAll(t *testing.T) {
    const N = 1000
    ch := make(chan int)
    var wg sync.WaitGroup
    counter := atomic.Int64{}
    for i := 0; i < N; i++ {
        wg.Add(1)
        go func() {
            defer wg.Done()
            <-ch
            counter.Add(1)
        }()
    }
    // Let them park.
    time.Sleep(10 * time.Millisecond)
    close(ch)
    wg.Wait()
    if counter.Load() != N {
        t.Fatalf("expected %d wakes, got %d", N, counter.Load())
    }
}
```

---

## Task 5 — Confirm select shuffles cases

**Goal.** Run a select with 4 always-ready cases 100,000 times. Count how many times each case fires. Each should be ~25,000.

**Hint.** Pre-load each channel with enough values that they are always ready.

**Acceptance.** Each case wins between 22,000 and 28,000 times. If one case dominates, the runtime is not shuffling — check your loop logic.

```go
func TestSelectShuffle(t *testing.T) {
    const iters = 100000
    counts := make(map[int]int)
    chs := [4]chan int{make(chan int, iters), make(chan int, iters), make(chan int, iters), make(chan int, iters)}
    for _, ch := range chs {
        for i := 0; i < iters; i++ {
            ch <- 1
        }
    }
    for i := 0; i < iters; i++ {
        select {
        case <-chs[0]:
            counts[0]++
        case <-chs[1]:
            counts[1]++
        case <-chs[2]:
            counts[2]++
        case <-chs[3]:
            counts[3]++
        }
    }
    for i := 0; i < 4; i++ {
        if counts[i] < 22000 || counts[i] > 28000 {
            t.Errorf("case %d: %d picks", i, counts[i])
        }
    }
}
```

---

## Task 6 — Demonstrate buffer rotation on full-buffer receive

**Goal.** Fill a buffered channel to capacity. Spawn a sender that blocks on send. Confirm that the next receive both delivers a value *and* admits the parked sender's value.

**Hint.** Read `c.qcount` before and after via `len(ch)`. The buffer should stay full after one receive.

**Acceptance.** After the receive, `len(ch) == cap(ch)` (still full), and the receiver got the first value, and the sender unblocked.

```go
func TestBufferRotation(t *testing.T) {
    ch := make(chan int, 3)
    ch <- 1; ch <- 2; ch <- 3 // full
    senderReady := make(chan struct{})
    go func() {
        close(senderReady)
        ch <- 4 // will park
    }()
    <-senderReady
    time.Sleep(10 * time.Millisecond) // let sender park
    if len(ch) != 3 {
        t.Fatalf("expected full buffer, got len=%d", len(ch))
    }
    v := <-ch
    if v != 1 {
        t.Fatalf("expected 1, got %d", v)
    }
    time.Sleep(10 * time.Millisecond)
    if len(ch) != 3 {
        t.Fatalf("expected buffer to stay full after rotation, got len=%d", len(ch))
    }
}
```

---

## Task 7 — Provoke `send on closed channel` panic

**Goal.** Write a deliberate test that closes a channel and then sends to it, recovering from the panic.

**Acceptance.** Test passes, and the panic message is exactly `"send on closed channel"`.

```go
func TestSendOnClosedPanics(t *testing.T) {
    defer func() {
        r := recover()
        if r == nil {
            t.Fatal("expected panic")
        }
        msg := fmt.Sprint(r)
        if msg != "send on closed channel" {
            t.Fatalf("unexpected panic message: %q", msg)
        }
    }()
    ch := make(chan int, 1)
    close(ch)
    ch <- 1
}
```

---

## Task 8 — Provoke `close of closed channel`

**Goal.** Demonstrate that double-close panics.

```go
func TestDoubleClosePanics(t *testing.T) {
    defer func() {
        if recover() == nil {
            t.Fatal("expected panic")
        }
    }()
    ch := make(chan int)
    close(ch)
    close(ch)
}
```

---

## Task 9 — Leak detection: parked goroutine never woken

**Goal.** Write a test that intentionally leaks a goroutine parked on `recvq`. Verify it is leaked via `runtime.NumGoroutine`.

**Acceptance.** The goroutine count after the test, minus the baseline, is at least 1.

```go
func TestLeakedReceiver(t *testing.T) {
    baseline := runtime.NumGoroutine()
    func() {
        ch := make(chan int)
        go func() {
            <-ch // never wakes — channel is dropped, but goroutine is parked
        }()
    }()
    time.Sleep(50 * time.Millisecond)
    runtime.GC()
    if runtime.NumGoroutine() <= baseline {
        t.Fatal("expected at least one leaked goroutine")
    }
    // In real code, this is a bug. We are demonstrating that the runtime
    // does NOT garbage-collect parked goroutines just because their channel
    // becomes unreferenced.
}
```

(Note: this test leaks intentionally. Do not blindly add this pattern to production code.)

---

## Task 10 — Implement a non-blocking try-send wrapper

**Goal.** Write a function `func trySend[T any](ch chan<- T, v T) bool` that returns true if the send succeeded, false otherwise. Use `select` with `default`.

**Acceptance.** Behaviour matches the underlying non-blocking `chansend(c, ep, false, ...)`.

```go
func trySend[T any](ch chan<- T, v T) bool {
    select {
    case ch <- v:
        return true
    default:
        return false
    }
}
```

Test:

```go
func TestTrySend(t *testing.T) {
    ch := make(chan int, 1)
    if !trySend(ch, 1) {
        t.Fatal("first send should succeed")
    }
    if trySend(ch, 2) {
        t.Fatal("second send should fail (buffer full)")
    }
}
```

---

## Task 11 — Implement a non-blocking try-receive

**Goal.** `func tryRecv[T any](ch <-chan T) (T, bool)` returns the value and `true` if a value was available, otherwise zero value and `false`. Must distinguish closed-and-empty from no-value.

**Hint.** The single-arm select with default cannot distinguish "closed" from "no value." You may need to inspect via `len` (racy) or accept the limitation.

**Acceptance.** Behaviour: on an empty open channel, `tryRecv` returns `(zero, false)`. On a closed channel, it returns `(zero, false)`. On a channel with a value, `(v, true)`.

```go
func tryRecv[T any](ch <-chan T) (T, bool) {
    select {
    case v, ok := <-ch:
        if !ok {
            var zero T
            return zero, false
        }
        return v, true
    default:
        var zero T
        return zero, false
    }
}
```

(Note: this collapses "closed" into "no value." Acceptable in most contexts; if you need to distinguish, use a separate `done` channel.)

---

## Task 12 — Use `select` lock-order to compose multi-channel timeout

**Goal.** Build a function that returns either `(value, true)` from a channel or `(zero, false)` after a timeout, using a `time.After`-based select. Confirm it does not leak the timer on the success path (use `time.NewTimer` + `Stop`).

```go
func recvWithTimeout[T any](ch <-chan T, d time.Duration) (T, bool) {
    t := time.NewTimer(d)
    defer t.Stop()
    select {
    case v, ok := <-ch:
        if !ok {
            var zero T
            return zero, false
        }
        return v, true
    case <-t.C:
        var zero T
        return zero, false
    }
}
```

---

## Task 13 — Implement bounded fan-out close

**Goal.** Wake N receivers in batches of B. Use a closeable "tick" channel that the closer signals B times in a row.

**Hint.** Simpler approach: `close(ch)` wakes all at once; if you want bounded fan-out, send B sentinel values, sleep, repeat.

**Acceptance.** Test demonstrates that no more than B receivers wake per batch.

```go
func TestBoundedFanout(t *testing.T) {
    const N, B = 100, 10
    ch := make(chan int)
    started := atomic.Int64{}
    var wg sync.WaitGroup
    for i := 0; i < N; i++ {
        wg.Add(1)
        go func() {
            defer wg.Done()
            <-ch
            started.Add(1)
        }()
    }
    time.Sleep(20 * time.Millisecond)
    for batch := 0; batch < N/B; batch++ {
        for j := 0; j < B; j++ {
            ch <- 0
        }
        time.Sleep(20 * time.Millisecond)
        expected := int64((batch + 1) * B)
        if got := started.Load(); got != expected {
            t.Fatalf("batch %d: expected %d started, got %d", batch, expected, got)
        }
    }
    wg.Wait()
}
```

---

## Task 14 — Measure FIFO order under contention

**Goal.** Demonstrate that the wait queues are FIFO. Spawn N goroutines that send in known order, blocking; have the receiver drain in order and verify.

**Hint.** Use sleeps to enforce ordering of parking.

**Acceptance.** Receiver gets values 0, 1, 2, ..., N-1 in that exact order.

```go
func TestFIFOWaitQueue(t *testing.T) {
    const N = 100
    ch := make(chan int)
    for i := 0; i < N; i++ {
        go func(i int) {
            time.Sleep(time.Duration(i) * time.Microsecond)
            ch <- i
        }(i)
    }
    time.Sleep(10 * time.Millisecond) // let all park (mostly)
    for i := 0; i < N; i++ {
        v := <-ch
        if v != i {
            t.Errorf("position %d: got %d, want %d", i, v, i)
        }
    }
}
```

(Note: this test may be flaky if scheduling reorders the goroutines before they park. Adjust sleeps if you see flakes.)

---

## Task 15 — Compare unbuffered vs buffered throughput

**Goal.** Benchmark single-producer single-consumer with capacity 0, 1, 10, 100. Plot ns/op vs capacity.

**Hint.** Use `b.RunParallel` to ensure the producer and consumer run concurrently.

**Acceptance.** Expected curve: capacity 0 fastest (~200 ns), capacity 1 close behind (~250 ns), capacity 10 about the same (~260 ns), capacity 100 slower (~300 ns due to cache effects). Submit as a `BenchmarkChanCapacity_X` family.

---

## Task 16 — Demonstrate `gopark` on `select` with only nil channels

**Goal.** Show that `select { case <-nilCh: }` blocks forever and the goroutine appears in `select` state in pprof.

**Acceptance.** Stack trace of the parked goroutine shows `runtime.selectgo` and `gopark`.

```go
func TestSelectAllNilParks(t *testing.T) {
    var nilCh chan int
    done := make(chan struct{})
    go func() {
        select {
        case <-nilCh:
            // never
        }
        close(done) // unreachable
    }()
    select {
    case <-done:
        t.Fatal("nil select should not complete")
    case <-time.After(50 * time.Millisecond):
        // ok
    }
}
```

---

## Task 17 — Show that select case is shuffled, not source-ordered

**Goal.** Run a 2-case select where both are always ready. Confirm each fires roughly 50% of the time.

```go
func TestSelectFairness(t *testing.T) {
    a := make(chan int, 100000)
    b := make(chan int, 100000)
    for i := 0; i < 100000; i++ {
        a <- 1
        b <- 1
    }
    aCount, bCount := 0, 0
    for i := 0; i < 100000; i++ {
        select {
        case <-a:
            aCount++
        case <-b:
            bCount++
        }
    }
    diff := aCount - bCount
    if diff < 0 {
        diff = -diff
    }
    if diff > 5000 {
        t.Errorf("imbalance too large: a=%d b=%d", aCount, bCount)
    }
}
```

---

## Task 18 — Recreate the "leaked time.After" pattern

**Goal.** Show that `time.After` in a long-lived loop leaks timers until they fire.

**Hint.** Run the loop many times with a long timer duration. Observe heap growth.

```go
func leakyLoop(ctx context.Context) {
    for {
        select {
        case <-time.After(time.Hour): // leaks every iteration
        case <-ctx.Done():
            return
        }
    }
}

func goodLoop(ctx context.Context) {
    for {
        t := time.NewTimer(time.Hour)
        select {
        case <-t.C:
        case <-ctx.Done():
            t.Stop()
            return
        }
    }
}
```

The leaky version creates a sudog and a timer per iteration; the timer holds a reference to the goroutine's `sudog` until it fires. The good version explicitly `Stop`s the timer on early exit.

---

## Task 19 — Use a buffered channel as a semaphore

**Goal.** Implement a counting semaphore via a buffered channel. Compare to `sync.WaitGroup` + `golang.org/x/sync/semaphore`.

```go
type Semaphore chan struct{}

func NewSemaphore(n int) Semaphore {
    return make(chan struct{}, n)
}

func (s Semaphore) Acquire() {
    s <- struct{}{}
}

func (s Semaphore) Release() {
    <-s
}
```

Each `Acquire` is a buffered send; if the buffer is full, it parks. Each `Release` is a receive that wakes one parked acquirer.

Acceptance test: spawn 100 goroutines, each acquires before doing work. Verify at most N run concurrently.

---

## Task 20 — Hand-off vs buffer copy under a profiler

**Goal.** Use `go test -bench . -cpuprofile cpu.out` on a benchmark that hand-offs vs one that buffers. Inspect the profile.

**Acceptance.** Hand-off path shows time in `runtime.send` and `runtime.goready`. Buffer path shows time in `runtime.chansend` and `runtime.typedmemmove`, no `goready` (no wake).

Examine with `go tool pprof cpu.out` and `list runtime.chansend`. Confirm the two paths have distinct hot spots.
