# Goroutine Lifecycle — Find the Bug

Each section presents bugged code, asks you to find the lifecycle problem, then explains the bug and shows the fix. Read carefully — most bugs in this file are subtle and represent real production failures.

## Table of Contents
1. [Bug 1: The Mystery of the Phantom Receivers](#bug-1-the-mystery-of-the-phantom-receivers)
2. [Bug 2: `wg.Add` After `go`](#bug-2-wgadd-after-go)
3. [Bug 3: The Loop Variable Captures (Pre-1.22)](#bug-3-the-loop-variable-captures-pre-122)
4. [Bug 4: Unbuffered Result Channel](#bug-4-unbuffered-result-channel)
5. [Bug 5: Recover in the Wrong Goroutine](#bug-5-recover-in-the-wrong-goroutine)
6. [Bug 6: The Context Without `Done` Check](#bug-6-the-context-without-done-check)
7. [Bug 7: `time.Tick` Lives Forever](#bug-7-timetick-lives-forever)
8. [Bug 8: `LockOSThread` Without `UnlockOSThread`](#bug-8-lockosthread-without-unlockosthread)
9. [Bug 9: The Self-Joining WaitGroup](#bug-9-the-self-joining-waitgroup)
10. [Bug 10: The Reconnect Spawn Loop](#bug-10-the-reconnect-spawn-loop)
11. [Bug 11: The Finalizer That Blocks](#bug-11-the-finalizer-that-blocks)
12. [Bug 12: Goroutine Started in Init](#bug-12-goroutine-started-in-init)
13. [Bug 13: The Forgotten `cancel`](#bug-13-the-forgotten-cancel)
14. [Bug 14: The `select` That Always Picks Default](#bug-14-the-select-that-always-picks-default)
15. [Bug 15: Spawning From a Spawn](#bug-15-spawning-from-a-spawn)

---

## Bug 1: The Mystery of the Phantom Receivers

```go
func fetchAll(urls []string) []Result {
    results := make(chan Result)
    for _, u := range urls {
        u := u
        go func() {
            results <- fetch(u)
        }()
    }

    collected := []Result{}
    for r := range results {
        collected = append(collected, r)
    }
    return collected
}
```

**Symptom.** Function never returns.

**Find the bug.** Why does `for r := range results` never end?

<details>
<summary>Answer</summary>

`for r := range results` exits only when the channel is *closed*. Nothing in the code closes it. Each sending goroutine sends once and exits, but the receive loop blocks forever after receiving `len(urls)` values.

**Fix:**

```go
func fetchAll(urls []string) []Result {
    results := make(chan Result, len(urls))
    var wg sync.WaitGroup
    for _, u := range urls {
        u := u
        wg.Add(1)
        go func() {
            defer wg.Done()
            results <- fetch(u)
        }()
    }
    go func() {
        wg.Wait()
        close(results)
    }()

    collected := []Result{}
    for r := range results {
        collected = append(collected, r)
    }
    return collected
}
```

The closer goroutine waits for all senders, then closes. Alternative: read exactly `len(urls)` values and don't use `range`.
</details>

---

## Bug 2: `wg.Add` After `go`

```go
func process(items []Item) {
    var wg sync.WaitGroup
    for _, it := range items {
        it := it
        go func() {
            wg.Add(1)
            defer wg.Done()
            handle(it)
        }()
    }
    wg.Wait()
    fmt.Println("done")
}
```

**Symptom.** Sometimes "done" prints before all items are processed.

**Find the bug.**

<details>
<summary>Answer</summary>

`wg.Wait()` reads the counter when it runs. If `Wait()` runs before *any* of the goroutines have called `wg.Add(1)`, it sees counter = 0 and returns immediately.

**Fix:** Always `wg.Add(1)` in the parent before `go`:

```go
for _, it := range items {
    it := it
    wg.Add(1)
    go func() {
        defer wg.Done()
        handle(it)
    }()
}
```
</details>

---

## Bug 3: The Loop Variable Captures (Pre-1.22)

```go
func main() {
    var wg sync.WaitGroup
    for i := 0; i < 5; i++ {
        wg.Add(1)
        go func() {
            defer wg.Done()
            fmt.Println(i)
        }()
    }
    wg.Wait()
}
```

**Symptom.** On Go 1.21, prints `5 5 5 5 5` instead of some permutation of `0..4`.

**Find the bug.**

<details>
<summary>Answer</summary>

Before Go 1.22, all iterations of the loop share the *same* `i` variable. By the time the goroutines run, `i == 5`.

**Fix (works on every Go version):**

```go
for i := 0; i < 5; i++ {
    wg.Add(1)
    go func(i int) {
        defer wg.Done()
        fmt.Println(i)
    }(i)
}
```

Or in Go 1.22+, this works by default because each iteration has a fresh `i`.

This is a *lifecycle* bug because the goroutines' captured state changes between birth and run.
</details>

---

## Bug 4: Unbuffered Result Channel

```go
func first(urls []string) Result {
    results := make(chan Result) // unbuffered
    for _, u := range urls {
        u := u
        go func() {
            results <- fetch(u) // each sender blocks waiting for a receive
        }()
    }
    return <-results // read the first
}
```

**Symptom.** Function returns correctly but `runtime.NumGoroutine` rises by `len(urls) - 1` for every call.

**Find the bug.**

<details>
<summary>Answer</summary>

`first` reads exactly one value. The remaining `len(urls) - 1` goroutines are stuck forever on `results <- fetch(u)` — the channel is unbuffered and no one else reads. Leak.

**Fix:** Buffer the channel:

```go
results := make(chan Result, len(urls))
```

Now every sender completes regardless of whether anyone reads. The goroutines end naturally.

Or use a `context.Context` to cancel the rest:

```go
ctx, cancel := context.WithCancel(context.Background())
defer cancel()
results := make(chan Result, 1)
for _, u := range urls {
    u := u
    go func() {
        r := fetch(ctx, u)
        select {
        case results <- r:
        case <-ctx.Done():
        }
    }()
}
return <-results
```

The deferred `cancel()` signals all losers to give up.
</details>

---

## Bug 5: Recover in the Wrong Goroutine

```go
func safe(fn func()) {
    defer func() {
        if r := recover(); r != nil {
            log.Printf("recovered: %v", r)
        }
    }()
    go fn() // spawn fn in a new goroutine
}
```

**Symptom.** When `fn` panics, the program crashes anyway.

**Find the bug.**

<details>
<summary>Answer</summary>

`recover` only catches panics in *its own* goroutine. The deferred `recover` here is in `safe`'s goroutine; the panic happens in `fn`'s goroutine, which is a different one. The deferred recover never sees it.

**Fix:** Move recover into the goroutine:

```go
func safe(fn func()) {
    go func() {
        defer func() {
            if r := recover(); r != nil {
                log.Printf("recovered: %v", r)
            }
        }()
        fn()
    }()
}
```
</details>

---

## Bug 6: The Context Without `Done` Check

```go
func worker(ctx context.Context, jobs <-chan Job) {
    for j := range jobs {
        process(j)
    }
}
```

**Symptom.** When `ctx` is canceled, the worker keeps processing until `jobs` is closed.

**Find the bug.**

<details>
<summary>Answer</summary>

The worker does not check `ctx.Done()`. Cancellation has no effect on this goroutine unless the producer also stops sending and closes `jobs`.

**Fix:**

```go
func worker(ctx context.Context, jobs <-chan Job) {
    for {
        select {
        case <-ctx.Done():
            return
        case j, ok := <-jobs:
            if !ok {
                return
            }
            process(j)
        }
    }
}
```

Now the worker exits on either context cancellation or channel close.
</details>

---

## Bug 7: `time.Tick` Lives Forever

```go
func heartbeat() {
    for t := range time.Tick(time.Second) {
        sendHeartbeat(t)
    }
}

func main() {
    go heartbeat()
    runApp()
}
```

**Symptom.** When `runApp` returns, the program does not exit. Or, in a more complex setting, `heartbeat` goroutines leak between test runs.

**Find the bug.**

<details>
<summary>Answer</summary>

`time.Tick` returns a channel that the runtime never stops. There is no way to stop it without exiting the goroutine. Combined with the fact that the goroutine has no exit condition (no context check), it leaks.

Worse: each call to `time.Tick` allocates a new `runtime.Timer`. If `heartbeat` is invoked repeatedly, you accumulate timers.

**Fix:** Use `time.NewTicker` plus a context:

```go
func heartbeat(ctx context.Context) {
    ticker := time.NewTicker(time.Second)
    defer ticker.Stop()
    for {
        select {
        case <-ctx.Done():
            return
        case t := <-ticker.C:
            sendHeartbeat(t)
        }
    }
}
```

`Stop()` releases the timer; context cancellation ends the goroutine.
</details>

---

## Bug 8: `LockOSThread` Without `UnlockOSThread`

```go
func renderFrame() {
    runtime.LockOSThread()
    initGL()
    drawFrame()
}

func main() {
    for {
        renderFrame()
        time.Sleep(16 * time.Millisecond)
    }
}
```

**Symptom.** After running for a while, the process has many OS threads in `ps -L`. Performance degrades.

**Find the bug.**

<details>
<summary>Answer</summary>

`renderFrame` calls `LockOSThread` but never `UnlockOSThread`. When the function returns, the goroutine is still pinned to the thread. Each subsequent call to `renderFrame` (back on the same goroutine — `main`'s goroutine) re-locks; the lock counter goes up. Eventually if this goroutine dies, the thread is killed.

Worse if `renderFrame` is called in fresh goroutines:

```go
func main() {
    for {
        go renderFrame() // each call pins a new thread; goroutine exits; thread dies
        time.Sleep(16 * time.Millisecond)
    }
}
```

Each goroutine death destroys one thread.

**Fix:** Always pair lock with `defer Unlock`, and run on a single long-lived goroutine:

```go
func renderLoop(ctx context.Context) {
    runtime.LockOSThread()
    defer runtime.UnlockOSThread()
    initGL()
    ticker := time.NewTicker(16 * time.Millisecond)
    defer ticker.Stop()
    for {
        select {
        case <-ctx.Done():
            return
        case <-ticker.C:
            drawFrame()
        }
    }
}

func main() {
    ctx, cancel := signal.NotifyContext(context.Background(), os.Interrupt)
    defer cancel()
    go renderLoop(ctx)
    <-ctx.Done()
}
```
</details>

---

## Bug 9: The Self-Joining WaitGroup

```go
func parallel(tasks []func()) {
    var wg sync.WaitGroup
    for _, t := range tasks {
        t := t
        wg.Add(1)
        go func() {
            defer wg.Done()
            wg.Wait() // wait for "everyone else" first
            t()
        }()
    }
    wg.Wait()
}
```

**Symptom.** Deadlock.

**Find the bug.**

<details>
<summary>Answer</summary>

Each goroutine calls `wg.Wait()`. The waitgroup counter is `len(tasks)`. Every goroutine is waiting for the counter to reach 0, but no one calls `Done` until *after* `Wait` returns. Classic self-deadlock.

**Fix:** This pattern usually has no use. If you wanted to synchronize a start point, use a `sync.WaitGroup` with `Add(1)` and `Done` on a separate "ready" group, or a `chan struct{}` as a start barrier.

```go
func parallel(tasks []func()) {
    start := make(chan struct{})
    var wg sync.WaitGroup
    for _, t := range tasks {
        t := t
        wg.Add(1)
        go func() {
            defer wg.Done()
            <-start
            t()
        }()
    }
    close(start) // unleash all goroutines simultaneously
    wg.Wait()
}
```
</details>

---

## Bug 10: The Reconnect Spawn Loop

```go
func consumeForever(ctx context.Context, broker string) {
    for {
        conn, err := dial(broker)
        if err != nil {
            time.Sleep(time.Second)
            continue
        }
        go consume(ctx, conn)
        time.Sleep(30 * time.Second) // health-check interval
    }
}
```

**Symptom.** `runtime.NumGoroutine` grows by ~2 every minute.

**Find the bug.**

<details>
<summary>Answer</summary>

Each iteration spawns a *new* `consume` goroutine, but never stops the previous one. Even if the connection dies, the old `consume` goroutine may still be running (especially if it's blocked on something). After an hour, dozens of leaked consumers each hold a connection.

**Fix:** Tie each consumer's lifecycle to its own context and cancel before reconnect:

```go
func consumeForever(ctx context.Context, broker string) {
    for ctx.Err() == nil {
        connCtx, cancel := context.WithCancel(ctx)
        conn, err := dial(broker)
        if err != nil {
            cancel()
            select {
            case <-time.After(time.Second):
                continue
            case <-ctx.Done():
                return
            }
        }
        done := make(chan struct{})
        go func() {
            defer close(done)
            consume(connCtx, conn)
        }()
        select {
        case <-done:
            // consumer exited; loop back to reconnect
        case <-ctx.Done():
            cancel()
            <-done
            return
        }
        cancel()
    }
}
```

Now each consumer's lifecycle is bounded by its `connCtx`, which is canceled on reconnect or parent cancel.
</details>

---

## Bug 11: The Finalizer That Blocks

```go
type Resource struct {
    conn net.Conn
}

func NewResource(addr string) *Resource {
    conn, _ := net.Dial("tcp", addr)
    r := &Resource{conn: conn}
    runtime.SetFinalizer(r, func(r *Resource) {
        r.conn.Close()  // may block if peer is slow
    })
    return r
}
```

**Symptom.** Under load, finalizers seem to "stop running"; memory grows.

**Find the bug.**

<details>
<summary>Answer</summary>

Finalizers run one-at-a-time on a dedicated runtime goroutine. If `r.conn.Close()` blocks (e.g., the peer has a half-closed TCP and the kernel waits for an ACK), the finalizer goroutine is stuck. Every other queued finalizer waits.

**Fix:** Finalizers should be fast and non-blocking. For potentially-slow cleanup, defer it to a separate goroutine:

```go
runtime.SetFinalizer(r, func(r *Resource) {
    go r.conn.Close()
})
```

Better still: do not rely on finalizers. Have an explicit `Close()` method. Use finalizers only as a backstop:

```go
func (r *Resource) Close() error {
    runtime.SetFinalizer(r, nil) // disable finalizer once explicitly closed
    return r.conn.Close()
}
```
</details>

---

## Bug 12: Goroutine Started in Init

```go
var bg = startBackground()

func startBackground() *Worker {
    w := &Worker{}
    go w.run() // started during package init
    return w
}
```

**Symptom.** Tests in the package report leaks. Code that imports this package gets a goroutine "for free."

**Find the bug.**

<details>
<summary>Answer</summary>

`init()`-time goroutines have no lifecycle owner. They start when the package is imported and run forever, unless the program exits. Tests find them as "leaked." Reusable libraries that do this are widely considered impolite.

**Fix:** Make the start explicit:

```go
type Background struct {
    ctx    context.Context
    cancel context.CancelFunc
    wg     sync.WaitGroup
}

func StartBackground(ctx context.Context) *Background {
    ctx, cancel := context.WithCancel(ctx)
    b := &Background{ctx: ctx, cancel: cancel}
    b.wg.Add(1)
    go func() {
        defer b.wg.Done()
        b.run(ctx)
    }()
    return b
}

func (b *Background) Stop() {
    b.cancel()
    b.wg.Wait()
}
```

Now the caller starts the goroutine and can stop it. Tests can `defer b.Stop()`.
</details>

---

## Bug 13: The Forgotten `cancel`

```go
func fetch(parent context.Context, url string) ([]byte, error) {
    ctx, _ := context.WithTimeout(parent, 5*time.Second)
    return doRequest(ctx, url)
}
```

**Symptom.** `go vet` warns: `the cancel function returned by context.WithTimeout should be called, not discarded`. Memory rises slowly under load.

**Find the bug.**

<details>
<summary>Answer</summary>

`context.WithTimeout` returns a `cancel` function. If you do not call it, the context's internal timer goroutine and the parent's children list retain a reference until the timeout fires. Under load, you accumulate slow-to-release contexts.

**Fix:**

```go
func fetch(parent context.Context, url string) ([]byte, error) {
    ctx, cancel := context.WithTimeout(parent, 5*time.Second)
    defer cancel()
    return doRequest(ctx, url)
}
```

`defer cancel()` releases on every return path, including panic.
</details>

---

## Bug 14: The `select` That Always Picks Default

```go
func worker(ctx context.Context, jobs <-chan Job) {
    for {
        select {
        case <-ctx.Done():
            return
        case j := <-jobs:
            process(j)
        default:
            time.Sleep(time.Microsecond)
        }
    }
}
```

**Symptom.** When `ctx` is canceled, the worker doesn't exit promptly. CPU usage is high (the loop runs constantly).

**Find the bug.**

<details>
<summary>Answer</summary>

`default` is selected immediately if neither of the other cases is ready. The `time.Sleep(time.Microsecond)` reduces but does not eliminate the busy loop. Worse: `ctx.Done()` is only checked every microsecond, so cancellation has perceptible latency.

**Fix:** Remove `default`:

```go
func worker(ctx context.Context, jobs <-chan Job) {
    for {
        select {
        case <-ctx.Done():
            return
        case j := <-jobs:
            process(j)
        }
    }
}
```

Now the `select` blocks until one of the two cases is ready. No CPU waste, immediate cancellation.

A `default` clause in a `for-select` is almost always a bug. Use it only if you specifically want non-blocking behavior.
</details>

---

## Bug 15: Spawning From a Spawn

```go
type Server struct {
    requests chan Request
}

func (s *Server) Run(ctx context.Context) {
    for {
        select {
        case <-ctx.Done():
            return
        case req := <-s.requests:
            go func() {
                resp := s.process(req)
                req.reply <- resp
            }()
        }
    }
}
```

**Symptom.** Under load, goroutines accumulate. Some clients never receive a response.

**Find the bug.**

<details>
<summary>Answer</summary>

Each request spawns an orphan goroutine. The orphan:

1. Has no lifecycle owner; if `req.reply` is never read (client disconnected), the goroutine blocks forever sending.
2. Is not bounded: under high load, you spawn unbounded goroutines.
3. Ignores `ctx`: when the server shuts down, in-flight goroutines keep running.

**Fix:** Use a worker pool or a `context.Context` plus buffered reply:

```go
func (s *Server) Run(ctx context.Context) {
    const workers = 16
    var wg sync.WaitGroup
    for i := 0; i < workers; i++ {
        wg.Add(1)
        go func() {
            defer wg.Done()
            for {
                select {
                case <-ctx.Done():
                    return
                case req := <-s.requests:
                    resp := s.process(ctx, req)
                    select {
                    case req.reply <- resp:
                    case <-ctx.Done():
                        return
                    }
                }
            }
        }()
    }
    wg.Wait()
}
```

Bounded workers, context-aware reply send. Server shutdown is clean.
</details>

---

## Summary

Common lifecycle bug patterns:

1. **Missing close path** — `for range` never exits because no one closes.
2. **Add after go** — race between `wg.Add` and `wg.Wait`.
3. **Captured loop variable** — pre-1.22, all goroutines see the final value.
4. **Unbuffered result channel** — losers in a race leak.
5. **Recover in wrong goroutine** — only catches panics in its own goroutine.
6. **No `ctx.Done()` check** — cancellation has no effect.
7. **`time.Tick` / leaking timers** — use `NewTicker` + `Stop`.
8. **`LockOSThread` without `Unlock`** — thread destroyed on goroutine death.
9. **Self-deadlock with WaitGroup** — group waits on itself.
10. **Reconnect spawn** — each retry leaks the previous goroutine.
11. **Blocking finalizer** — backs up the finalizer queue.
12. **Init-time goroutines** — no lifecycle owner.
13. **Discarded `cancel()`** — slow context release.
14. **`default` in `for-select`** — busy loop and slow cancellation.
15. **Orphan goroutines** — spawned without lifecycle parent.

Every bug here has been seen in production. The cure is the same: answer "when does this goroutine end?" before you write `go ...`. Read [03-preventing-leaks](../03-preventing-leaks/) for the patterns that make these bugs structurally impossible.
