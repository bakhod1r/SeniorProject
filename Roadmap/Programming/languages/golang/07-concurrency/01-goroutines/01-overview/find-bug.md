# Goroutines — Find the Bug

> Each snippet contains a real concurrency bug: a leak, a race, a deadlock, a captured-variable trap, an unrecovered panic, or a misuse of a coordination primitive. Find it, explain it, fix it.

---

## Bug 1 — Captured loop variable (pre-Go 1.22)

```go
func StartWorkers(items []string) {
    var wg sync.WaitGroup
    for i := 0; i < len(items); i++ {
        wg.Add(1)
        go func() {
            defer wg.Done()
            fmt.Println(items[i])
        }()
    }
    wg.Wait()
}
```

**Bug.** All goroutines share the same `i`. By the time they run, `i == len(items)`, so every goroutine indexes off the end of the slice and panics with "index out of range." On Go 1.22+ the per-iteration scoping fix means each goroutine sees its own `i`, but on older versions this is a guaranteed panic.

**Fix.** Pass `i` as a parameter:

```go
go func(i int) {
    defer wg.Done()
    fmt.Println(items[i])
}(i)
```

Or close over the value rather than the index:

```go
for _, item := range items {
    item := item
    wg.Add(1)
    go func() { defer wg.Done(); fmt.Println(item) }()
}
```

In Go 1.22+ the original code happens to work, but the explicit form remains clearer.

---

## Bug 2 — `wg.Add` inside the goroutine

```go
func RunAll(tasks []Task) {
    var wg sync.WaitGroup
    for _, t := range tasks {
        go func(t Task) {
            wg.Add(1)
            defer wg.Done()
            t.Run()
        }(t)
    }
    wg.Wait()
}
```

**Bug.** `wg.Add(1)` is called *inside* the goroutine. The main goroutine reaches `wg.Wait()` immediately after `go`, possibly before any `Add` has run. With counter at 0, `Wait` returns. The function exits. The goroutines may not have finished — and may panic with "WaitGroup is reused before previous Wait has returned" if the function is called again.

**Fix.** Move `Add(1)` to the parent, before `go`:

```go
for _, t := range tasks {
    wg.Add(1)
    go func(t Task) {
        defer wg.Done()
        t.Run()
    }(t)
}
wg.Wait()
```

`Add` always before `go`. Memorise this.

---

## Bug 3 — Goroutine leak via blocked send

```go
func FirstResult(urls []string) string {
    out := make(chan string)
    for _, u := range urls {
        u := u
        go func() {
            out <- fetch(u)
        }()
    }
    return <-out // first result wins, others leak
}
```

**Bug.** The function reads only one value from `out`. The other `len(urls) - 1` goroutines block forever on `out <- fetch(u)` because there is no reader. Each leak holds the captured `u`, the closure, and ~2 KB of stack until program exit.

**Fix.** Buffer the channel with capacity `len(urls)`, so every send completes regardless of how many are read:

```go
out := make(chan string, len(urls))
```

Or use `context.WithCancel` to signal "I have an answer; the rest of you can stop":

```go
ctx, cancel := context.WithCancel(context.Background())
defer cancel()
out := make(chan string, 1)
for _, u := range urls {
    u := u
    go func() {
        v := fetch(ctx, u)
        select {
        case out <- v:
        case <-ctx.Done():
        }
    }()
}
return <-out
```

The `defer cancel()` guarantees losing fetchers exit.

---

## Bug 4 — Deadlock from unbuffered channel

```go
func DoubleAll(nums []int) []int {
    ch := make(chan int)
    for _, n := range nums {
        n := n
        go func() { ch <- n * 2 }()
    }
    out := make([]int, 0, len(nums))
    for v := range ch {
        out = append(out, v)
    }
    return out
}
```

**Bug.** Two problems. First, nobody closes `ch`, so `for v := range ch` blocks forever after consuming all values. The goroutines exit, but `range` does not know. Second: even if it did, the runtime will detect "all goroutines are asleep" and panic.

**Fix.** Close the channel when the senders are done. A common idiom:

```go
ch := make(chan int)
var wg sync.WaitGroup
for _, n := range nums {
    n := n
    wg.Add(1)
    go func() {
        defer wg.Done()
        ch <- n * 2
    }()
}
go func() { wg.Wait(); close(ch) }()
out := make([]int, 0, len(nums))
for v := range ch { out = append(out, v) }
return out
```

The "close after all senders finish" goroutine pattern is canonical. Memorise it.

---

## Bug 5 — Panic in goroutine kills the program

```go
func handle(req Request) {
    go func() {
        report := compute(req) // may panic on bad input
        save(report)
    }()
}
```

**Bug.** A panic in `compute` is not recovered. The runtime terminates the entire process — taking down every other in-flight request.

**Fix.** Recover at the goroutine boundary:

```go
go func() {
    defer func() {
        if r := recover(); r != nil {
            log.Printf("compute panic for req %v: %v\n%s", req.ID, r, debug.Stack())
        }
    }()
    report := compute(req)
    save(report)
}()
```

Production rule: every goroutine that handles untrusted input or runs library callbacks must recover at its boundary.

---

## Bug 6 — `time.Sleep` for "synchronisation"

```go
func Setup() {
    go initialise()
    time.Sleep(100 * time.Millisecond)
    use()
}
```

**Bug.** `Setup` assumes 100 ms is enough for `initialise()` to complete. On a fast machine it usually is. On a loaded CI runner, `initialise()` may take 200 ms. `use()` runs against half-set-up state. The test passes locally and fails in CI.

**Fix.** Synchronise with a channel or `WaitGroup`:

```go
done := make(chan struct{})
go func() {
    defer close(done)
    initialise()
}()
<-done
use()
```

`time.Sleep` for synchronisation is always wrong outside of an explicit "demo of timing behaviour."

---

## Bug 7 — Sender closes a channel that another goroutine still sends on

```go
func Worker(jobs <-chan Job, results chan<- Result, done <-chan struct{}) {
    for {
        select {
        case j := <-jobs:
            results <- process(j)
        case <-done:
            close(results) // BUG
            return
        }
    }
}
```

**Bug.** Multiple workers run this code. When one of them sees `done`, it closes `results`. The other workers continue and try to send on a closed channel, causing a panic ("send on closed channel"). Worse, the *first* worker to close wins; the others may have items still in flight.

**Fix.** Move the close out of the workers and into the coordinator that knows all workers have exited:

```go
func RunWorkers(jobs <-chan Job, n int) <-chan Result {
    results := make(chan Result)
    var wg sync.WaitGroup
    for i := 0; i < n; i++ {
        wg.Add(1)
        go func() {
            defer wg.Done()
            for j := range jobs {
                results <- process(j)
            }
        }()
    }
    go func() {
        wg.Wait()
        close(results)
    }()
    return results
}
```

Rule of thumb: **only one goroutine should close a channel, and it should be the one that knows no more sends will happen.**

---

## Bug 8 — `select` without `default` on cancellation

```go
func Loop(ctx context.Context) {
    for {
        select {
        case <-ctx.Done():
            return
        }
        doWork() // never reached
    }
}
```

**Bug.** `select` has only one case (`ctx.Done()`), so it blocks until that fires. `doWork` is unreachable. The intent was probably "do work in a loop, exit on cancel," but the structure is wrong.

**Fix.** Either add a non-blocking branch with `default`, or interleave work in a `select` with the cancel:

```go
for {
    select {
    case <-ctx.Done():
        return
    default:
    }
    doWork()
}
```

Or, if `doWork` produces something on a channel:

```go
for {
    select {
    case <-ctx.Done():
        return
    case work := <-workCh:
        process(work)
    }
}
```

---

## Bug 9 — Receiving from a `nil` channel

```go
type Worker struct {
    jobs chan Job
}

func (w *Worker) Run(ctx context.Context) {
    for {
        select {
        case j := <-w.jobs:
            process(j)
        case <-ctx.Done():
            return
        }
    }
}

// caller forgot to set w.jobs
w := &Worker{}
go w.Run(ctx)
```

**Bug.** `w.jobs` is `nil`. A receive on a nil channel blocks forever. The `select` only ever fires on `ctx.Done()`, so the worker effectively does nothing until cancel. Confusing because there is no panic, no error — just silent inactivity.

**Fix.** Either initialise the channel in a constructor, or check for nil in `Run`. Best: have a `NewWorker` that always initialises required channels.

```go
func NewWorker() *Worker {
    return &Worker{jobs: make(chan Job, 32)}
}
```

The nil-channel trick is sometimes used intentionally to disable a `select` case, but here it is unintentional.

---

## Bug 10 — Mutex copied by value

```go
type Counter struct {
    mu sync.Mutex
    n  int
}

func (c Counter) Inc() {       // BUG: receiver by value
    c.mu.Lock()
    defer c.mu.Unlock()
    c.n++
}

func main() {
    c := Counter{}
    var wg sync.WaitGroup
    for i := 0; i < 100; i++ {
        wg.Add(1)
        go func() { defer wg.Done(); c.Inc() }()
    }
    wg.Wait()
    fmt.Println(c.n) // probably 0
}
```

**Bug.** `Inc()` has a value receiver. Each call gets a *copy* of `c`, including a copy of the mutex. The increments happen on the copies; the original `c.n` is never modified. `go vet` warns: "Inc passes lock by value."

**Fix.** Pointer receiver:

```go
func (c *Counter) Inc() {
    c.mu.Lock()
    defer c.mu.Unlock()
    c.n++
}
```

Rule: any type embedding a `sync.Mutex` (or `sync.RWMutex`, `sync.WaitGroup`, etc.) should be used through pointers.

---

## Bug 11 — Range over a map from multiple goroutines

```go
m := map[string]int{}
go func() { for { m["a"]++ } }()
go func() { for k, v := range m { _ = k; _ = v } }()
```

**Bug.** Concurrent read and write on a built-in `map` is a runtime-detected error: "fatal error: concurrent map read and map write." The Go runtime intentionally crashes the program with this message, even without the race detector.

**Fix.** Either guard with a mutex:

```go
var mu sync.RWMutex
m := map[string]int{}
go func() { for { mu.Lock(); m["a"]++; mu.Unlock() } }()
go func() {
    mu.RLock()
    for k, v := range m { _ = k; _ = v }
    mu.RUnlock()
}()
```

Or use `sync.Map` (best for "many disjoint keys" workloads).

---

## Bug 12 — Goroutine outliving its data

```go
func handler(w http.ResponseWriter, r *http.Request) {
    body, _ := io.ReadAll(r.Body)
    go func() {
        time.Sleep(5 * time.Second)
        process(body)
    }()
    w.Write([]byte("ok"))
}
```

**Bug.** The goroutine outlives the request. After the handler returns, `r.Body` is closed (its underlying buffer may be reused). The captured `body` slice is owned by `r`'s body buffer; it may have been recycled by the http package. `process(body)` could see corrupted data.

Also, if the server is shutting down, this goroutine has no cancellation and no shutdown awareness — it leaks past server shutdown.

**Fix.** Copy the data, accept a context, and use a worker pool with a shutdown story:

```go
func (s *Server) handler(w http.ResponseWriter, r *http.Request) {
    body, _ := io.ReadAll(r.Body)
    bodyCopy := append([]byte(nil), body...) // own the bytes
    select {
    case s.workQueue <- workItem{body: bodyCopy, ctx: s.serverCtx}:
        w.Write([]byte("ok"))
    default:
        http.Error(w, "busy", http.StatusServiceUnavailable)
    }
}
```

The pool's workers shut down when `serverCtx` is cancelled.

---

## Bug 13 — Forgetting `cancel`

```go
func DoSomething(parent context.Context) {
    ctx, _ := context.WithTimeout(parent, 5*time.Second)
    callDownstream(ctx)
}
```

**Bug.** The `cancel` function is discarded. `WithTimeout` returns a `cancel` that, in addition to forcing cancellation, releases internal timer and context resources. Without it, those resources stay alive until the deadline naturally fires (potentially much later than `callDownstream` returns). At scale, this is a slow leak.

`go vet` flags this with "the cancel function returned by context.WithTimeout should be called."

**Fix.**

```go
func DoSomething(parent context.Context) {
    ctx, cancel := context.WithTimeout(parent, 5*time.Second)
    defer cancel()
    callDownstream(ctx)
}
```

Always `defer cancel()`. No exceptions.

---

## Bug 14 — `recover` outside `defer`

```go
go func() {
    if r := recover(); r != nil {
        log.Println("recovered:", r) // never runs
    }
    risky()
}()
```

**Bug.** `recover` only does anything when called from a deferred function during a panic. Here, `recover` runs at the top of the goroutine, before any panic, returns `nil`, and `risky()` panics into the runtime, killing the program.

**Fix.**

```go
go func() {
    defer func() {
        if r := recover(); r != nil {
            log.Println("recovered:", r)
        }
    }()
    risky()
}()
```

---

## Bug 15 — Goroutine "starts" before something is ready

```go
func StartServer() *Server {
    s := &Server{ready: make(chan struct{})}
    go s.run()
    return s
}

func (s *Server) run() {
    s.listener = listen() // takes 50 ms
    close(s.ready)
    serve()
}

// caller
s := StartServer()
client.Connect(s.listener.Addr()) // BUG: listener may be nil
```

**Bug.** `StartServer` returns immediately. The goroutine has not yet set `s.listener`. The caller dereferences `s.listener` and gets nil-deref panic. Race detector flags the read of `s.listener` against the write inside `run`.

**Fix.** `StartServer` must wait for the readiness signal:

```go
func StartServer() *Server {
    s := &Server{ready: make(chan struct{})}
    go s.run()
    <-s.ready
    return s
}
```

Now the caller is guaranteed `s.listener` is set.

---

## Bug 16 — Channel never read after panic

```go
func Compute() (int, error) {
    res := make(chan int)
    errCh := make(chan error, 1)
    go func() {
        defer func() {
            if r := recover(); r != nil {
                errCh <- fmt.Errorf("panic: %v", r)
            }
        }()
        res <- riskyCompute() // panics
    }()

    select {
    case v := <-res:
        return v, nil
    case err := <-errCh:
        return 0, err
    }
}
```

**Bug.** If `riskyCompute()` panics *before* the send `res <- ...`, the panic deferred function pushes to `errCh` and we are fine. If `riskyCompute()` panics *during* its execution after some side effect — wait, this looks fine. But there is a subtle issue: `res` is unbuffered. If the receiver gives up via `errCh` first (in some variant of this code), the goroutine sending on `res` blocks forever.

In this specific code, `select` reads from one of the two channels, so after `<-errCh` returns, no one reads `res`. But the goroutine never sends on `res` (it panicked), so no leak. Safe.

The bug appears in the variant:

```go
go func() {
    defer func() { recover() }()
    res <- riskyCompute() // succeeds
}()

select {
case v := <-res: return v, nil
case <-time.After(time.Second): return 0, errTimeout
}
```

If `riskyCompute()` succeeds and the send is in progress, but the timeout fires first, the receiver returns and the sender blocks forever on `res <- v`.

**Fix.** Make `res` buffered with capacity 1:

```go
res := make(chan int, 1)
```

Now the send always completes; the goroutine always exits. The unread value is garbage-collected.

---

## Bug 17 — Channel receive on closed channel inside `select`

```go
done := make(chan struct{})
close(done)

for {
    select {
    case <-done:
        // intended: exit
    case j := <-jobs:
        process(j)
    }
}
```

**Bug.** A receive on a closed channel returns *immediately* with the zero value, repeatedly. The `select` keeps firing the `<-done` case in a tight loop, never reading from `jobs`. Effectively a busy-loop.

**Fix.** Add a `return` (or `break` out of the loop):

```go
case <-done:
    return
```

The original author may have intended `done` to be closed *only* when the loop should exit; in that case, the missing `return` is the bug.

---

## Bug 18 — Two goroutines closing the same channel

```go
func (s *Server) Stop() {
    close(s.stop)
}

// called from two places:
go server.Stop()
go server.Stop() // panic: close of closed channel
```

**Bug.** `close(s.stop)` is not idempotent. The second close panics. If `Stop` can be called multiple times, this is a crash waiting to happen.

**Fix.** Use `sync.Once`:

```go
type Server struct {
    stop     chan struct{}
    stopOnce sync.Once
}

func (s *Server) Stop() {
    s.stopOnce.Do(func() {
        close(s.stop)
    })
}
```

Now repeated calls are safe.

---

## Bug 19 — Race on slice growth

```go
var results []int
var wg sync.WaitGroup

for i := 0; i < 100; i++ {
    i := i
    wg.Add(1)
    go func() {
        defer wg.Done()
        results = append(results, i*i)
    }()
}
wg.Wait()
```

**Bug.** Multiple goroutines `append` to the same slice without synchronisation. `append` may reallocate the underlying array; concurrent appends race on both the array pointer and the length. The race detector flags it; even without the detector, you may end up with fewer than 100 entries.

**Fix.** Protect with a mutex, or have each goroutine write to its own slot:

```go
var mu sync.Mutex
go func() {
    defer wg.Done()
    mu.Lock()
    results = append(results, i*i)
    mu.Unlock()
}()
```

Or, knowing the size in advance, write to a pre-allocated slice:

```go
results := make([]int, 100)
for i := 0; i < 100; i++ {
    i := i
    wg.Add(1)
    go func() {
        defer wg.Done()
        results[i] = i * i // each goroutine has its own slot
    }()
}
```

Independent index writes do not race because they touch different memory. Reads of the slice header (length) are racy if anyone resizes, but this code does not resize.

---

## Bug 20 — `sync.WaitGroup` reused before previous `Wait` returns

```go
func (b *Batcher) Process(items []Item) {
    var wg sync.WaitGroup
    for _, it := range items {
        it := it
        wg.Add(1)
        go func() {
            defer wg.Done()
            process(it)
        }()
    }
    // forgot wg.Wait()
}

// called many times:
b.Process(...)
b.Process(...)
b.Process(...)
```

**Bug.** Without `wg.Wait()`, the `WaitGroup` may be garbage-collected while goroutines still hold references to it, or — worse — a still-running goroutine calls `wg.Done()` after the function returns. If the WaitGroup leaks across calls (e.g., declared at package level), the second `Process` resets the counter while goroutines from the first batch are mid-flight, panicking with "WaitGroup is reused before previous Wait has returned."

**Fix.** Always `wg.Wait()` before returning:

```go
func (b *Batcher) Process(items []Item) {
    var wg sync.WaitGroup
    for _, it := range items {
        it := it
        wg.Add(1)
        go func() {
            defer wg.Done()
            process(it)
        }()
    }
    wg.Wait()
}
```

---

## Bug 21 — `recover` does not catch panics in spawned goroutines

```go
func safeRun(fn func()) (err error) {
    defer func() {
        if r := recover(); r != nil {
            err = fmt.Errorf("panic: %v", r)
        }
    }()
    fn()
    return nil
}

// caller
err := safeRun(func() {
    go func() { panic("boom") }() // not caught
})
fmt.Println(err) // <nil>; program crashes a moment later
```

**Bug.** `recover` only catches panics in the *calling* goroutine. The `go func() { panic("boom") }()` panics in a *new* goroutine; `safeRun`'s `recover` never sees it. The program terminates.

**Fix.** Recover *inside* the spawned goroutine. There is no way to recover a panic in a goroutine you do not control.

```go
go func() {
    defer func() { recover() }()
    panic("boom")
}()
```

If `safeRun` is supposed to "make any function safe," it cannot — not for functions that internally spawn goroutines. Document the limitation.

---

## Bug 22 — Locking a `sync.RWMutex` for write in a read path

```go
type Cache struct {
    mu sync.RWMutex
    m  map[string]string
}

func (c *Cache) Get(k string) string {
    c.mu.Lock() // BUG: should be RLock
    defer c.mu.Unlock()
    return c.m[k]
}
```

**Bug.** Using `Lock()` instead of `RLock()` for a read-only operation serialises every read. The whole point of `RWMutex` is that many readers can hold the lock simultaneously. With `Lock`, throughput on read-heavy workloads is the same as a `Mutex`.

**Fix.**

```go
func (c *Cache) Get(k string) string {
    c.mu.RLock()
    defer c.mu.RUnlock()
    return c.m[k]
}
```

Subtle counter-bug: if the read path also updates state (LRU eviction, statistics), `RLock` is wrong because writes need exclusive access. Be deliberate.

---

## Bug 23 — Fan-in without close detection

```go
func Merge(in1, in2 <-chan int) <-chan int {
    out := make(chan int)
    go func() {
        for {
            select {
            case v := <-in1: out <- v
            case v := <-in2: out <- v
            }
        }
    }()
    return out
}
```

**Bug.** When `in1` or `in2` is closed, receives from it return `0, false` immediately and continuously. The merge spins, sending zeros to `out`. Worse, there is no way for the goroutine to exit; it is leaked forever.

**Fix.** Detect close per channel:

```go
func Merge(in1, in2 <-chan int) <-chan int {
    out := make(chan int)
    go func() {
        defer close(out)
        var done1, done2 bool
        for !done1 || !done2 {
            select {
            case v, ok := <-in1:
                if !ok { in1 = nil; done1 = true; continue }
                out <- v
            case v, ok := <-in2:
                if !ok { in2 = nil; done2 = true; continue }
                out <- v
            }
        }
    }()
    return out
}
```

Setting a channel variable to `nil` disables that case in `select` (receive on nil blocks forever). This is the canonical fan-in pattern.

---

## Bug 24 — Goroutine never starts because of `runtime.LockOSThread` confusion

```go
func init() {
    runtime.LockOSThread()
}

func main() {
    go work()
    select {}
}
```

**Bug.** `init` runs on the main goroutine; `LockOSThread` pins it to its current thread. Then `main` runs (still on the main goroutine, still pinned). `go work()` spawns a goroutine, but the spawning is fine — what matters is that the main goroutine is pinned and will never give up its OS thread.

This is not necessarily a *bug* — it is intentional in some programs (OpenGL, certain X11 code) — but it surprises engineers who expect `main` to participate in normal scheduling. If `work()` calls `runtime.Gosched`, the main goroutine still holds its thread and contributes to `GOMAXPROCS` accounting.

**Fix.** If you did not mean to lock the main goroutine, do not call `LockOSThread` in `init`. Reserve it for a dedicated goroutine that *needs* it:

```go
go func() {
    runtime.LockOSThread()
    defer runtime.UnlockOSThread()
    runOpenGL()
}()
```

---

## Bug 25 — Heap allocation due to closure escaping

```go
for i := 0; i < 1_000_000; i++ {
    i := i
    go func() {
        process(i)
    }()
}
```

**Bug.** Not strictly a *bug*, but a performance trap. Each goroutine captures `i` by reference, forcing it to escape to the heap. A million escapes is a million tiny allocations and 1M GC pressure. Slow.

**Fix.** Pass `i` as a parameter — values are passed on the stack:

```go
for i := 0; i < 1_000_000; i++ {
    go func(i int) {
        process(i)
    }(i)
}
```

`go build -gcflags="-m"` confirms the parameter version does not escape.

This is also why "loop variable scope changed in 1.22" was controversial: the new semantics preserve the per-iteration variable, which still escapes if captured. Pass by parameter for the fast path.

---

## Final note

Of these 25 bugs, the top five — captured loop variable, missing `wg.Wait()`, send-without-reader leaks, deadlock from forgotten `close`, and unrecovered panic — appear in real codebases roughly weekly. Spotting them in PRs before they ship is one of the highest-leverage skills a Go engineer can have.
