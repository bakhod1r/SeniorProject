# Deterministic Testing — Find the Bug

A gallery of real flaky-test patterns. Each entry shows the test code, what is wrong, why it fails sometimes, and how to fix it deterministically. Read each before peeking at the diagnosis.

---

## Case 1 — The Disappearing Increment

```go
func TestCounter(t *testing.T) {
    var c int
    go func() { c++ }()
    if c != 1 {
        t.Fatal("expected 1")
    }
}
```

### Symptom

Fails almost always with `expected 1`.

### Diagnosis

The goroutine has not run yet by the time the assertion executes. Even on a fast machine, the scheduler does not promise to switch to the new goroutine before the next line of the parent runs.

There is also a data race: `c` is written by the goroutine and read by the main goroutine without synchronisation. `go test -race` flags this.

### Fix

```go
func TestCounter(t *testing.T) {
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

Channel close provides a happens-before edge; the assertion runs strictly after the increment.

---

## Case 2 — The Pretend Sleep

```go
func TestStart(t *testing.T) {
    s := NewServer()
    go s.Run()
    time.Sleep(100 * time.Millisecond)
    if err := s.Ping(); err != nil {
        t.Fatal(err)
    }
}
```

### Symptom

Passes on the developer's M3 laptop. Fails 5% of the time in CI.

### Diagnosis

`time.Sleep(100ms)` is a guess. On the M3 the server starts in 2ms. On a contended CI runner under heavy load, it might take 150ms or more. The sleep is too short on the slow path.

### Fix

Have `Run` signal readiness:

```go
func TestStart(t *testing.T) {
    s := NewServer()
    ready := make(chan struct{})
    go s.RunWithReady(ready)
    <-ready
    if err := s.Ping(); err != nil {
        t.Fatal(err)
    }
}
```

`Run` writes to `ready` after it has bound the port and is ready to accept calls. The test waits on `ready`, not on a guessed duration.

---

## Case 3 — The Off-by-One WaitGroup

```go
func TestSum(t *testing.T) {
    var wg sync.WaitGroup
    var sum int64
    for i := 0; i < 10; i++ {
        go func(v int) {
            wg.Add(1)
            defer wg.Done()
            atomic.AddInt64(&sum, int64(v))
        }(i)
    }
    wg.Wait()
    if sum != 45 {
        t.Fatalf("sum=%d", sum)
    }
}
```

### Symptom

Sometimes `Wait` returns immediately and the sum is 0. Sometimes it works.

### Diagnosis

`wg.Add(1)` is inside the goroutine. The parent might reach `wg.Wait()` before any goroutine has called `Add`. With counter 0, `Wait` returns instantly. This is also a documented race in `sync.WaitGroup` and `go vet` should catch it.

### Fix

```go
for i := 0; i < 10; i++ {
    wg.Add(1)
    go func(v int) {
        defer wg.Done()
        atomic.AddInt64(&sum, int64(v))
    }(i)
}
wg.Wait()
```

`Add` happens-before `Wait`. Always call `Add` in the parent.

---

## Case 4 — The Captured Loop Variable

```go
func TestParallel(t *testing.T) {
    var results [5]int
    var wg sync.WaitGroup
    for i := 0; i < 5; i++ {
        wg.Add(1)
        go func() {
            defer wg.Done()
            results[i] = i * i
        }()
    }
    wg.Wait()
    want := [5]int{0, 1, 4, 9, 16}
    if results != want {
        t.Fatalf("got %v want %v", results, want)
    }
}
```

### Symptom

`results = [25 25 25 25 25]`. (Or any other unexpected pattern.) Pre-Go 1.22.

### Diagnosis

In Go 1.21 and earlier, all five goroutines capture the same `i` variable. By the time they run, `i == 5` (or `4` if the loop has not finished iterating yet). They all write to `results[5]` (which panics) or `results[i]` with the final value.

Go 1.22+ changed loop variable scoping; this trap is fixed there.

### Fix

```go
for i := 0; i < 5; i++ {
    wg.Add(1)
    go func(i int) {
        defer wg.Done()
        results[i] = i * i
    }(i)
}
```

Pass `i` as an argument so each goroutine captures its own copy.

---

## Case 5 — The Late Send

```go
func TestSink(t *testing.T) {
    results := make(chan int)
    go func() {
        results <- compute()
    }()
    select {
    case r := <-results:
        if r != expected { t.Fatal("wrong") }
    case <-time.After(50 * time.Millisecond):
        t.Fatal("timeout")
    }
}
```

### Symptom

Fails intermittently with "timeout" on slow CI.

### Diagnosis

`compute()` sometimes takes longer than 50ms in CI. The timeout is too aggressive. The test treats a slow computation as a bug, but slowness is not the property being tested.

### Fix

Use a generous timeout (5–10 seconds) intended as a "something is wrong" fence, or use `t.Deadline()` to align with `-timeout`:

```go
deadline := time.NewTimer(5 * time.Second)
defer deadline.Stop()
select {
case r := <-results:
    if r != expected { t.Fatal("wrong") }
case <-deadline.C:
    t.Fatal("computation took longer than 5s")
}
```

Better: use `synctest.Run` and replace the timer with `synctest.Wait`. No real timeout needed.

---

## Case 6 — The Phantom Subscription

```go
func TestTimer(t *testing.T) {
    clk := clockwork.NewFakeClock()
    triggered := false
    go func() {
        <-clk.After(time.Second)
        triggered = true
    }()
    clk.Advance(2 * time.Second)
    time.Sleep(10 * time.Millisecond) // wait for goroutine
    if !triggered { t.Fatal("not triggered") }
}
```

### Symptom

Fails sometimes — `not triggered`.

### Diagnosis

The test calls `clk.Advance` before the goroutine has subscribed to `clk.After`. If the goroutine subscribes after the advance, the new timer's fire time is 2s in virtual time, but virtual time is no longer advancing — the timer never fires.

There is also a data race on `triggered`.

### Fix

Use `BlockUntilContext` (or `BlockUntil` in older clockwork versions) before advancing:

```go
ctx, cancel := context.WithCancel(context.Background())
defer cancel()
go func() {
    <-clk.After(time.Second)
    close(done)
}()
clk.BlockUntilContext(ctx, 1)
clk.Advance(2 * time.Second)
<-done
```

Or use `synctest`:

```go
synctest.Run(func() {
    done := make(chan struct{})
    go func() {
        time.Sleep(time.Second)
        close(done)
    }()
    synctest.Wait()
    select {
    case <-done:
    default:
        t.Fatal("not triggered")
    }
})
```

`synctest.Wait` waits until the goroutine is blocked on the sleep, then advances virtual time, then runs it.

---

## Case 7 — The Leaked Worker

```go
func TestWorker(t *testing.T) {
    in := make(chan int, 5)
    go worker(in)
    in <- 1
    in <- 2
    in <- 3
    // test ends
}
```

### Symptom

Test passes, but `goleak.VerifyTestMain` reports a leaked goroutine.

### Diagnosis

`worker(in)` is `for v := range in {...}`. The test never closes `in`. The worker goroutine blocks on `<-in` forever.

### Fix

```go
func TestWorker(t *testing.T) {
    in := make(chan int, 5)
    done := make(chan struct{})
    go func() {
        defer close(done)
        worker(in)
    }()
    in <- 1
    in <- 2
    in <- 3
    close(in)
    <-done
}
```

Close `in` to terminate the worker, then wait for its exit. No leak.

---

## Case 8 — The Order Assumption

```go
func TestLog(t *testing.T) {
    var buf bytes.Buffer
    go log.New(&buf, "", 0).Println("first")
    go log.New(&buf, "", 0).Println("second")
    time.Sleep(50 * time.Millisecond)
    want := "first\nsecond\n"
    if got := buf.String(); got != want {
        t.Fatalf("got %q want %q", got, want)
    }
}
```

### Symptom

Sometimes "second\nfirst\n". Sometimes interleaved bytes ("firssecondt\n\n").

### Diagnosis

Two goroutines write to the same `bytes.Buffer` (not goroutine-safe) and assume a specific order. Both assumptions are wrong.

### Fix

Either serialise writes (mutex, channel), or do not assert on order. To assert on the *set* of lines:

```go
var mu sync.Mutex
var lines []string
var wg sync.WaitGroup
for _, s := range []string{"first", "second"} {
    wg.Add(1)
    go func(s string) {
        defer wg.Done()
        mu.Lock()
        lines = append(lines, s)
        mu.Unlock()
    }(s)
}
wg.Wait()
sort.Strings(lines)
want := []string{"first", "second"}
if !reflect.DeepEqual(lines, want) {
    t.Fatalf("got %v", lines)
}
```

---

## Case 9 — The Race-Free Flake

```go
func TestRingBuffer(t *testing.T) {
    rb := NewRingBuffer(4)
    var wg sync.WaitGroup
    for i := 0; i < 10; i++ {
        wg.Add(1)
        go func(v int) {
            defer wg.Done()
            rb.Push(v)
        }(i)
    }
    wg.Wait()
    if got := rb.Len(); got != 4 {
        t.Fatalf("got len %d want 4", got)
    }
}
```

### Symptom

Passes `-race`. Fails 30% of the time with `got len 3`.

### Diagnosis

The ring buffer is size 4. Ten goroutines push concurrently. The buffer may evict items asynchronously (depending on implementation), or the test's assumption that exactly 4 items remain is wrong. Race detector finds no data race because the buffer uses proper synchronisation.

The bug is in the *test's* logic: the assertion "buffer has 4 items" is not robust to the buffer's behaviour under concurrent push. The buffer might temporarily report 3 if the implementation has a brief gap between increment and bookkeeping.

### Fix

Use `synctest.Wait` to drive the test to quiescence:

```go
synctest.Run(func() {
    rb := NewRingBuffer(4)
    var wg sync.WaitGroup
    for i := 0; i < 10; i++ {
        wg.Add(1)
        go func(v int) {
            defer wg.Done()
            rb.Push(v)
        }(i)
    }
    wg.Wait()
    synctest.Wait()
    if got := rb.Len(); got != 4 {
        t.Fatalf("got len %d want 4", got)
    }
})
```

Or document the property differently: "ring buffer eventually has 4 items" — use `assert.Eventually` with a generous timeout.

---

## Case 10 — The TestMain Trap

```go
var server *Server

func TestMain(m *testing.M) {
    server = NewServer()
    go server.Run()
    os.Exit(m.Run())
}

func TestPing(t *testing.T) {
    if err := server.Ping(); err != nil {
        t.Fatal(err)
    }
}
```

### Symptom

`TestPing` fails sometimes with `connection refused`.

### Diagnosis

`server.Run` starts asynchronously. `TestMain` calls `m.Run()` before the server has finished starting. The first test races against server startup.

### Fix

```go
func TestMain(m *testing.M) {
    server = NewServer()
    ready := make(chan struct{})
    go server.RunWithReady(ready)
    <-ready
    os.Exit(m.Run())
}
```

Wait for the server to signal readiness before running tests.

---

## Case 11 — The Context Without Cancel

```go
func TestProcessor(t *testing.T) {
    p := NewProcessor()
    ctx := context.Background()
    go p.Run(ctx)
    p.Submit(Task{})
    // ...
}
```

### Symptom

Tests after this one are slow / occasionally hang.

### Diagnosis

`ctx` never cancels. `p.Run` never exits. The goroutine is leaked across tests; `goleak` catches it eventually but the symptom is mysterious slowness.

### Fix

```go
ctx, cancel := context.WithCancel(context.Background())
defer cancel()
done := make(chan struct{})
go func() {
    defer close(done)
    p.Run(ctx)
}()
// ... test body ...
cancel()
<-done
```

Always cancel and wait.

---

## Case 12 — The Subtest State Leak

```go
func TestThings(t *testing.T) {
    counter := 0
    t.Run("one", func(t *testing.T) {
        counter++
        if counter != 1 { t.Fatal() }
    })
    t.Run("two", func(t *testing.T) {
        counter++
        if counter != 2 { t.Fatal() }
    })
}
```

### Symptom

Passes when run sequentially. Fails when subtests are parallel.

### Diagnosis

Subtests run in deterministic order *unless* they call `t.Parallel()`. If they do, the order is not guaranteed. The test asserts on `counter` order — implicit dependency.

### Fix

Reset state per subtest, or do not rely on order across subtests. If the test really must observe a sequence, do not use subtests.

---

## Case 13 — The Misused `time.After`

```go
func TestRetry(t *testing.T) {
    for i := 0; i < 3; i++ {
        select {
        case <-time.After(100 * time.Millisecond):
            attempt(i)
        case <-time.After(50 * time.Millisecond):
            t.Fatal("timeout")
        }
    }
}
```

### Symptom

The "timeout" case fires every time. The 100ms case never runs.

### Diagnosis

The Go `select` is non-deterministic when multiple cases become ready simultaneously, but here only one case can fire: whichever timer fires first. The 50ms timer always fires before the 100ms timer. The author wrote the assertion order backwards.

Also, `time.After` leaks: until its timer fires, the timer goroutine is alive. In a tight loop this can accumulate.

### Fix

Whatever the intent, replace with explicit timers and `Stop`:

```go
t := time.NewTimer(100 * time.Millisecond)
defer t.Stop()
select {
case <-t.C:
    attempt(i)
case <-ctx.Done():
    return
}
```

Or, in `synctest.Run`, no `time.After` is needed at all.

---

## Case 14 — The Slow-CI Mystery

```go
func TestUpload(t *testing.T) {
    file := makeTestFile(1 << 20)
    start := time.Now()
    err := upload(file)
    elapsed := time.Since(start)
    if err != nil { t.Fatal(err) }
    if elapsed > 500 * time.Millisecond {
        t.Fatalf("too slow: %v", elapsed)
    }
}
```

### Symptom

Passes locally. Fails in CI with "too slow: 612ms".

### Diagnosis

Wall-clock duration assertion. CI runners are slower. The test is asserting on performance, but performance is not the contract being tested; correctness is.

### Fix

Either:
- Remove the duration assertion entirely if the test is functional.
- Move it to a separate benchmark.
- Use a much higher threshold (5–10× expected) with a clear comment that the value is a "something is broken" fence, not a performance target.

---

## Case 15 — The Closed-Channel Read

```go
func TestStream(t *testing.T) {
    out := stream()
    if v, ok := <-out; !ok {
        t.Fatal("expected a value")
    } else if v != "hello" {
        t.Fatalf("got %q", v)
    }
}
```

### Symptom

Sometimes fails with "expected a value".

### Diagnosis

`stream()` returns a channel. If `stream` closes the channel before sending, the receive returns zero-value with `ok = false`. The test reads this as "no value." But the underlying bug might be: `stream` racily closes before sending its first value, depending on internal goroutine scheduling.

### Fix

Inspect `stream`. Likely fix: send first, close after. The test then either passes (sees the value) or fails clearly (sees nothing because stream failed to send). No flake.

---

## Patterns across all 15

- **Replace `time.Sleep` with a barrier** (cases 1, 2, 6, 14).
- **Add proper synchronisation between goroutine and assertion** (cases 1, 3, 8).
- **Inject the clock or use `synctest`** (cases 2, 5, 6, 14).
- **Order goroutine setup correctly** (cases 3, 4).
- **Drain or close to terminate** (cases 7, 10, 11).
- **Do not assert on order or wall-clock duration** (cases 8, 12, 14).
- **Treat every flake as a code bug** — fix at the source.

End of bug gallery.
