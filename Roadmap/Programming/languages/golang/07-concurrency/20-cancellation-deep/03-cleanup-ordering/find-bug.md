---
layout: default
title: Cleanup Ordering — Find the Bug
parent: Cleanup Ordering
grand_parent: Cancellation Deep
ancestor: Go
nav_order: 9
has_children: false
permalink: /roadmap/programming-languages/golang/07-concurrency/20-cancellation-deep/03-cleanup-ordering/find-bug/
---

# Cleanup Ordering — Find the Bug

Each example contains a cleanup-related bug. Find the bug, then read the explanation. Some bugs are subtle; others are blatant. All compile.

---

## Bug 1

```go
func write(path string, data []byte) error {
    f, err := os.Create(path)
    if err != nil { return err }
    defer f.Close()
    _, err = f.Write(data)
    return err
}
```

**The bug.** The error from `f.Close()` is discarded. If the disk is full or the filesystem fails on close, the function returns nil but the data was not durably written.

**Fix.** Use named return and check Close's error:

```go
func write(path string, data []byte) (err error) {
    f, err := os.Create(path)
    if err != nil { return err }
    defer func() {
        if cerr := f.Close(); cerr != nil && err == nil {
            err = cerr
        }
    }()
    _, err = f.Write(data)
    return err
}
```

---

## Bug 2

```go
func process(paths []string) error {
    for _, p := range paths {
        f, err := os.Open(p)
        if err != nil { return err }
        defer f.Close()
        // process f
    }
    return nil
}
```

**The bug.** Defer in a loop. All files are held open until `process` returns. For thousands of paths, this exhausts FDs.

**Fix.** Extract the per-file work into a helper:

```go
func process(paths []string) error {
    for _, p := range paths {
        if err := processOne(p); err != nil { return err }
    }
    return nil
}

func processOne(p string) error {
    f, err := os.Open(p)
    if err != nil { return err }
    defer f.Close()
    return nil
}
```

---

## Bug 3

```go
ctx, _ := context.WithTimeout(parent, time.Second)
go work(ctx)
```

**The bug.** The `cancel` function is discarded. The context's internal goroutine and timer leak.

**Fix.** Always store and defer cancel:

```go
ctx, cancel := context.WithTimeout(parent, time.Second)
defer cancel()
go work(ctx)
```

(`go vet` catches this via `lostcancel`.)

---

## Bug 4

```go
func handler(w http.ResponseWriter, r *http.Request) {
    resp, err := http.Get("http://example.com")
    if err != nil {
        http.Error(w, err.Error(), 500); return
    }
    defer resp.Body.Close()
    // ... do something else, return without reading resp.Body ...
    w.Write([]byte("ok"))
}
```

**The bug.** `resp.Body` is closed but never read. For HTTP/1.1 keep-alive, the connection is discarded instead of returned to the pool. Under load, connection pool exhaustion.

**Fix.** Drain the body before closing:

```go
defer func() {
    io.Copy(io.Discard, resp.Body)
    resp.Body.Close()
}()
```

---

## Bug 5

```go
ctx, cancel := context.WithCancel(parent)
stop := context.AfterFunc(ctx, cleanup)
defer cancel()
defer stop()
```

**The bug.** Defer order: `stop()` is registered second, so it pops *first* at function exit. It deregisters the callback *before* `cancel()` runs. Result: `cleanup` never runs on normal exit.

**Fix.** Swap the order:

```go
defer stop()
defer cancel()
```

Now `cancel()` pops first, triggering the AfterFunc; then `stop()` runs (no-op since callback already fired).

---

## Bug 6

```go
func openFile(path string) (*os.File, error) {
    f, err := os.Open(path)
    if err != nil { return nil, err }
    defer f.Close()
    return f, nil
}
```

**The bug.** The deferred `f.Close()` runs before the caller can use the returned file. The caller gets a closed file.

**Fix.** Drop the defer; the caller now owns the file:

```go
func openFile(path string) (*os.File, error) {
    return os.Open(path)
}
```

---

## Bug 7

```go
func main() {
    defer fmt.Println("cleanup")
    os.Exit(0)
}
```

**The bug.** `os.Exit` skips defers. "cleanup" never prints.

**Fix.** Return normally, or do cleanup explicitly before exit:

```go
func main() {
    fmt.Println("cleanup")
    os.Exit(0)
}
```

---

## Bug 8

```go
for i := 0; i < 3; i++ {
    defer func() { fmt.Println(i) }()
}
```

**The bug (pre-Go-1.22).** The closure captures the loop variable `i` by reference. After the loop, `i == 3`. All three defers print 3.

In Go 1.22+, the loop variable is per-iteration, so each defer captures its own `i`. Output: 2, 1, 0.

**Fix (universal).** Pass `i` as an argument:

```go
for i := 0; i < 3; i++ {
    defer func(i int) { fmt.Println(i) }(i)
}
```

Or rely on Go 1.22+ scoping.

---

## Bug 9

```go
type Service struct {
    db *sql.DB
}

func (s *Service) Stop() error {
    return s.db.Close()
}

func main() {
    s := &Service{db: openDB()}
    defer s.Stop()
    defer s.Stop() // safety net
}
```

**The bug.** `defer s.Stop()` is registered twice. At function exit, both run. The second call returns `sql.ErrConnDone` or similar — but worse, if `Close` is not idempotent on the user's DB driver, panic.

**Fix.** Make Stop idempotent via `sync.Once`, OR register only once.

---

## Bug 10

```go
ctx, cancel := context.WithTimeout(parent, time.Second)
defer cancel()

stop := context.AfterFunc(ctx, func() { fmt.Println("late") })
// no defer stop()
```

**The bug.** `stop` is not deferred. If `ctx` is *not* cancelled before this function returns, the AfterFunc registration persists until ctx eventually cancels. For long-lived parent contexts, this leaks the callback.

**Fix.** `defer stop()`.

---

## Bug 11

```go
func work() (err error) {
    f, err := os.Create("/tmp/x")
    if err != nil { return err }
    defer func() {
        f.Close()
    }()
    _, err = f.Write([]byte("data"))
    return err
}
```

**The bug.** The deferred function calls `Close` but doesn't capture its error. If `Close` fails, the error is lost.

Compare to Bug 1, which uses the named-return pattern correctly.

**Fix.** Same as Bug 1.

---

## Bug 12

```go
done := make(chan struct{})
go func() {
    defer close(done)
    work()
}()
// no select; main returns immediately
```

**The bug.** Main does not wait for the goroutine. If main returns, the goroutine is killed. Cleanup may not run.

**Fix.** Wait on `done`:

```go
go func() {
    defer close(done)
    work()
}()
<-done
```

Or use a `sync.WaitGroup`.

---

## Bug 13

```go
mu.Lock()
result := compute()
mu.Unlock()
return process(result)
```

**The bug.** If `compute()` panics, the lock is never released. Other goroutines wait forever.

**Fix.** `defer mu.Unlock()`:

```go
mu.Lock()
defer mu.Unlock()
return process(compute())
```

---

## Bug 14

```go
func (s *Server) Shutdown(ctx context.Context) error {
    s.db.Close()        // step 1
    s.workers.Stop(ctx) // step 2
    return nil
}
```

**The bug.** DB is closed before workers stop. Workers may still be running queries against the now-closed DB. Panics or errors.

**Fix.** Reverse the order:

```go
func (s *Server) Shutdown(ctx context.Context) error {
    s.workers.Stop(ctx)
    s.db.Close()
    return nil
}
```

---

## Bug 15

```go
func main() {
    var wg sync.WaitGroup
    for i := 0; i < 10; i++ {
        wg.Add(1)
        go func() {
            wg.Done() // BUG: missing defer
            work()
        }()
    }
    wg.Wait()
}
```

**The bug.** `wg.Done()` is called immediately, not after `work()`. The Wait may return before workers complete.

**Fix.** `defer wg.Done()` at the top of the goroutine:

```go
go func() {
    defer wg.Done()
    work()
}()
```

---

## Bug 16

```go
ctx, cancel := signal.NotifyContext(parent, syscall.SIGTERM)
<-ctx.Done()
server.Shutdown(ctx)
```

**The bug.** `ctx` is already cancelled by the time `server.Shutdown` is called. Shutdown receives a cancelled context, immediately aborts in-flight requests.

**Fix.** Use a fresh context:

```go
ctx, _ := signal.NotifyContext(parent, syscall.SIGTERM)
<-ctx.Done()
shutdownCtx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
defer cancel()
server.Shutdown(shutdownCtx)
```

---

## Bug 17

```go
var once sync.Once
func cleanup() error {
    var err error
    once.Do(func() {
        err = real Close()
    })
    return err
}
```

**The bug.** Variable `err` is scoped to the function call. On the second call, `once.Do` skips the body; `err` stays nil. Caller sees nil error even if the first close failed.

**Fix.** Store the error in the type:

```go
type Once struct {
    once sync.Once
    err  error
}

func (o *Once) Close() error {
    o.once.Do(func() { o.err = realClose() })
    return o.err
}
```

---

## Bug 18

```go
func handler(w http.ResponseWriter, r *http.Request) {
    f, _ := os.CreateTemp("", "req-*")
    defer f.Close()
    defer os.Remove(f.Name())
    // ... use f ...
}
```

**The bug.** Defer order: `os.Remove` runs *first* (last registered), then `f.Close`. On some systems, removing an open file fails or leaves the FD orphaned.

**Fix.** Swap the order so Close runs first:

```go
defer os.Remove(f.Name())
defer f.Close()
```

LIFO: Close first, then Remove. Correct.

---

## Bug 19

```go
func work(ctx context.Context) error {
    var n int32
    stop := context.AfterFunc(ctx, func() {
        n = 1
    })
    defer stop()
    cancel()  // imagine this is in scope
    return nil  // n is racy!
}
```

**The bug.** The AfterFunc callback writes `n` in a goroutine. The main path may read `n` (via return or other). Race condition.

**Fix.** Use atomic or a channel.

---

## Bug 20

```go
func processBatch(items []Item) error {
    var wg sync.WaitGroup
    for _, item := range items {
        item := item
        wg.Add(1)
        go func() {
            defer wg.Done()
            if err := process(item); err != nil {
                wg.Wait()  // BUG
                return
            }
        }()
    }
    wg.Wait()
    return nil
}
```

**The bug.** The goroutine calls `wg.Wait()` inside itself. Deadlock: it's waiting for all goroutines (including itself) to call `Done`. The `defer wg.Done()` would fire eventually, but the `Wait` blocks first.

**Fix.** Don't call `wg.Wait` inside a goroutine that hasn't called `Done`. Restructure.

---

## Bug 21

```go
func produce() <-chan int {
    out := make(chan int)
    go func() {
        for i := 0; i < 10; i++ {
            out <- i
        }
        close(out)
    }()
    return out
}

func main() {
    out := produce()
    for v := range out {
        if v == 5 {
            break
        }
        fmt.Println(v)
    }
    // BUG
}
```

**The bug.** After breaking out of the range loop, the producer goroutine is still trying to send into `out`. It blocks forever (channel not drained). Leak.

**Fix.** Use context to cancel the producer, or drain the channel:

```go
out := produce()
defer func() { for range out {} }() // drain on exit
for v := range out {
    if v == 5 { break }
    fmt.Println(v)
}
```

---

## Bug 22

```go
type Pool struct {
    mu sync.Mutex
    items []*resource
}

func (p *Pool) Close() error {
    p.mu.Lock()
    defer p.mu.Unlock()
    var errs []error
    for _, item := range p.items {
        if err := item.Close(); err != nil {
            errs = append(errs, err)
        }
    }
    p.items = nil
    return errors.Join(errs...)
}
```

**The bug.** Holding the lock during item.Close. If Close does I/O or is slow, the lock is held a long time. Other goroutines block.

**Fix.** Copy the slice under lock, then close outside:

```go
func (p *Pool) Close() error {
    p.mu.Lock()
    items := p.items
    p.items = nil
    p.mu.Unlock()
    var errs []error
    for _, item := range items {
        if err := item.Close(); err != nil {
            errs = append(errs, err)
        }
    }
    return errors.Join(errs...)
}
```

---

## Bug 23

```go
func work() {
    defer func() {
        if r := recover(); r != nil {
            log.Println("recovered:", r)
        }
    }()
    defer func() {
        // some cleanup that panics
        if rand.Intn(2) == 0 {
            panic("cleanup panic")
        }
    }()
    panic("work panic")
}
```

**The bug.** When the cleanup defer panics, it replaces the work panic. The outer recover catches "cleanup panic", losing "work panic" information.

**Fix.** Recover inside the cleanup defer too:

```go
defer func() {
    defer func() {
        if r := recover(); r != nil {
            log.Println("cleanup panic:", r)
        }
    }()
    // cleanup
}()
```

Now the cleanup's panic is logged but doesn't propagate. The original "work panic" still propagates to the outer recover.

---

## Bug 24

```go
ctx, cancel := context.WithCancel(parent)
defer cancel()

go func() {
    defer fmt.Println("done")
    <-ctx.Done()
}()

// main returns immediately
```

**The bug.** Main returns immediately. `cancel` fires (via defer). The goroutine wakes up, prints "done". But main has already returned. If main was the main goroutine, the program exits before the print.

**Fix.** Wait for the goroutine:

```go
done := make(chan struct{})
go func() {
    defer close(done)
    defer fmt.Println("done")
    <-ctx.Done()
}()
// later
<-done
```

---

## Bug 25

```go
var globalDB *sql.DB

func init() {
    var err error
    globalDB, err = sql.Open("sqlite3", "file.db")
    if err != nil { panic(err) }
}

func main() {
    defer globalDB.Close()
    // ... use globalDB ...
}
```

**The bug.** `globalDB` may be used by other init functions or goroutines beyond `main`. The defer in `main` closes it before they finish. Use-after-close.

**Fix.** Make the DB's lifecycle explicit via a Service type with Start/Stop.

---

## Bug 26

```go
type Server struct {
    listener net.Listener
    wg sync.WaitGroup
}

func (s *Server) Shutdown() {
    s.listener.Close()
    s.wg.Wait()
}
```

**The bug.** No context. If a stuck request prevents `Wait` from returning, Shutdown hangs forever.

**Fix.** Take a context:

```go
func (s *Server) Shutdown(ctx context.Context) error {
    s.listener.Close()
    done := make(chan struct{})
    go func() { s.wg.Wait(); close(done) }()
    select {
    case <-done:
        return nil
    case <-ctx.Done():
        return ctx.Err()
    }
}
```

---

## Bug 27

```go
defer fmt.Println("cleanup")
defer fmt.Println("first")
```

**The bug.** "cleanup" is registered first, runs last (LIFO). The intent might be "always cleanup last", but the labelling is misleading. Adjust labels or order to match.

Not a real bug per se, but a readability issue.

---

## Bug 28

```go
type Cache struct {
    mu sync.RWMutex
    items map[string]string
}

func (c *Cache) Get(key string) string {
    c.mu.RLock()
    defer c.mu.RUnlock()
    v, ok := c.items[key]
    if !ok {
        c.mu.RUnlock()  // BUG
        c.mu.Lock()
        defer c.mu.Unlock()
        // double unlock from the original deferred RUnlock
    }
    return v
}
```

**The bug.** The deferred RUnlock fires at the end. We also manually RUnlock and acquire a write lock. The deferred RUnlock then runs on the *write* lock — undefined behaviour, likely panic ("sync: Unlock of unlocked RWMutex").

**Fix.** Restructure to use only one lock or use a different pattern (lock once with the correct mode).

---

## Bug 29

```go
func process(ctx context.Context, items []item) error {
    g, ctx := errgroup.WithContext(ctx)
    for _, item := range items {
        item := item
        g.Go(func() error {
            return processOne(ctx, item)
        })
    }
    return g.Wait()
}

func processOne(ctx context.Context, item item) error {
    f, err := os.Open(item.path)
    if err != nil { return err }
    // BUG: no defer f.Close
    return doWork(ctx, f, item)
}
```

**The bug.** `processOne` opens a file but never closes it. FD leak per item.

**Fix.** `defer f.Close()` after the successful open.

---

## Bug 30

```go
go func() {
    defer wg.Done()
    if cond {
        return // BUG: was wg.Done called yet?
    }
    work()
}()
```

**The bug.** Actually this is *not* a bug — the deferred `wg.Done` runs on the early return. But it's a common point of confusion. The defer covers all return paths.

If you wrote:

```go
go func() {
    if cond { return }
    wg.Done()
    work()
}()
```

Then yes — the early return skips wg.Done, leak. But the defer version is correct.

---

## Conclusion

Cleanup bugs share a common shape: a path through code that fails to release a resource, in the wrong order, with the wrong context, or with errors silently dropped. Train your eye for them. Use `go vet`, `staticcheck`, `errcheck`, and tests with goroutine-leak detection. Code review with cleanup in mind.

You will catch 90% of these by:
1. Always pairing acquire/release in adjacent lines.
2. Always deferring cancel/close/stop.
3. Always handling the error from Close on writers.
4. Always using fresh contexts for shutdown.
5. Always testing the shutdown path.

The remaining 10% are subtle and require domain-specific knowledge. The exercises here cover many of them.

---

End of find-bug.
