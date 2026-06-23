---
layout: default
title: Find Bug
parent: Cooperative vs Forced
grand_parent: Cancellation Deep
ancestor: Go
nav_order: 9
has_children: false
permalink: /roadmap/programming-languages/golang/07-concurrency/20-cancellation-deep/01-cooperative-vs-force/find-bug/
---

# Cooperative vs Forced Cancellation — Find the Bug

> Each snippet contains a cancellation-related bug. Identify the bug, explain why it fails, and write the fix.

---

## Bug 1 — `time.Sleep` ignored cancellation

```go
func wait(ctx context.Context) {
    time.Sleep(10 * time.Second)
    fmt.Println("done")
}
```

**Bug.** `time.Sleep` does not observe context. Calling `cancel()` on the parent does nothing here; the function blocks for the full 10 seconds.

**Fix.**
```go
func wait(ctx context.Context) error {
    t := time.NewTimer(10 * time.Second)
    defer t.Stop()
    select {
    case <-t.C:
        return nil
    case <-ctx.Done():
        return ctx.Err()
    }
}
```

---

## Bug 2 — Discarded cancel function

```go
func fetch(parent context.Context, url string) ([]byte, error) {
    ctx, _ := context.WithTimeout(parent, 5*time.Second)
    return httpGet(ctx, url)
}
```

**Bug.** The cancel function is discarded. The timer leaks until the deadline fires (or the parent cancels). `go vet` flags this with `lostcancel`.

**Fix.**
```go
ctx, cancel := context.WithTimeout(parent, 5*time.Second)
defer cancel()
return httpGet(ctx, url)
```

---

## Bug 3 — Cancellation observed but not propagated

```go
func work(ctx context.Context) {
    select {
    case <-ctx.Done():
        return
    default:
    }
    go subwork(context.Background()) // BUG
}
```

**Bug.** The subworker uses `context.Background()`, discarding the parent's cancellation. The subworker outlives `work` and ignores any cancel.

**Fix.**
```go
go subwork(ctx) // or context.WithCancel(ctx)
```

---

## Bug 4 — `wg.Wait` is not cancellable

```go
func gather(ctx context.Context, items []Item) error {
    var wg sync.WaitGroup
    for _, it := range items {
        wg.Add(1)
        go func(it Item) {
            defer wg.Done()
            process(it)
        }(it)
    }
    wg.Wait() // BUG: cannot be cancelled
    return nil
}
```

**Bug.** If `ctx` cancels while `wg.Wait` is blocked, the function does not return early. Workers ignore the context entirely.

**Fix.** Use `errgroup` or pass `ctx` to workers and add a cancellable wait:
```go
func gather(ctx context.Context, items []Item) error {
    g, ctx := errgroup.WithContext(ctx)
    for _, it := range items {
        it := it
        g.Go(func() error { return process(ctx, it) })
    }
    return g.Wait()
}
```

---

## Bug 5 — Hung handler ignores `r.Context()`

```go
func handler(w http.ResponseWriter, r *http.Request) {
    data := slowQuery() // no context passed; cannot be cancelled
    w.Write(data)
}
```

**Bug.** If the client disconnects, `r.Context()` cancels — but `slowQuery` does not observe it. The handler runs to completion regardless. Worse, `srv.Shutdown` waits for this handler forever (until the shutdown context expires).

**Fix.**
```go
func handler(w http.ResponseWriter, r *http.Request) {
    data, err := slowQuery(r.Context())
    if err != nil {
        if errors.Is(err, context.Canceled) {
            return // client disconnected
        }
        http.Error(w, err.Error(), 500)
        return
    }
    w.Write(data)
}
```

---

## Bug 6 — Context stored in a struct

```go
type Server struct {
    ctx context.Context // BUG
}

func NewServer(ctx context.Context) *Server {
    return &Server{ctx: ctx}
}

func (s *Server) Handle(req Request) Response {
    // uses s.ctx
}
```

**Bug.** `ctx` is bound to the caller of `NewServer` — typically a single call's context. The server outlives that call; `s.ctx` may be cancelled forever.

**Fix.** Pass `ctx` as a parameter to `Handle`:
```go
func (s *Server) Handle(ctx context.Context, req Request) Response
```

If you need long-lived cancellation for the server itself, store a `cancel` function (with the server's own root context), not the context.

---

## Bug 7 — Forgot to cancel children on shutdown

```go
type Worker struct {
    stop chan struct{}
}

func (w *Worker) Run() {
    go w.taskA() // BUG: no way to stop A
    go w.taskB() // BUG: no way to stop B
    <-w.stop
}
```

**Bug.** `Run` returns on `<-w.stop` but the sub-tasks continue. They leak.

**Fix.**
```go
func (w *Worker) Run(ctx context.Context) {
    g, ctx := errgroup.WithContext(ctx)
    g.Go(func() error { return w.taskA(ctx) })
    g.Go(func() error { return w.taskB(ctx) })
    _ = g.Wait()
}
```

---

## Bug 8 — Cancellation race with completion

```go
func work(ctx context.Context) (Result, error) {
    res := compute()
    if ctx.Err() != nil {
        return Result{}, ctx.Err() // BUG: discards successful result
    }
    return res, nil
}
```

**Bug.** If `cancel()` is called *just after* `compute()` returns successfully, this code throws away the result. The work succeeded; reporting cancellation is misleading.

**Fix.** Check `ctx.Err()` *before* doing the work (to skip if already cancelled), and return success after:
```go
func work(ctx context.Context) (Result, error) {
    if err := ctx.Err(); err != nil {
        return Result{}, err
    }
    return compute(), nil
}
```

---

## Bug 9 — Mutex held across `<-ctx.Done()`

```go
func (s *Service) Op(ctx context.Context) error {
    s.mu.Lock()
    select {
    case <-ctx.Done():
        return ctx.Err() // BUG: lock is held during the wait
    case <-time.After(1 * time.Second):
    }
    defer s.mu.Unlock()
    return doWork()
}
```

**Bug 1.** `defer s.mu.Unlock()` comes *after* the early return on cancel; the lock is never unlocked. Other goroutines block forever.

**Bug 2.** Even if fixed, holding the lock while waiting on `<-ctx.Done()` blocks other operations for up to 1 second.

**Fix.**
```go
func (s *Service) Op(ctx context.Context) error {
    select {
    case <-ctx.Done():
        return ctx.Err()
    case <-time.After(1 * time.Second):
    }
    s.mu.Lock()
    defer s.mu.Unlock()
    return doWork()
}
```

Wait *first*, then acquire the lock.

---

## Bug 10 — Cgo call that ignores cancellation

```go
func decode(ctx context.Context, data []byte) error {
    ctx, cancel := context.WithTimeout(ctx, 5*time.Second)
    defer cancel()
    C.decode_image(C.CBytes(data), C.int(len(data))) // C call, no cancellation check
    return ctx.Err()
}
```

**Bug.** The cgo call runs to completion regardless of context. If `decode_image` hangs, the goroutine and the OS thread are locked forever; cancellation cannot reach them.

**Fix.** Run in a subprocess:
```go
cmd := exec.CommandContext(ctx, "decode-helper")
cmd.Stdin = bytes.NewReader(data)
return cmd.Run()
```

Or modify the C code to poll a cancellation flag.

---

## Bug 11 — Reusing a cancelled context

```go
func processAll(ctx context.Context, items []Item) error {
    ctx, cancel := context.WithCancel(ctx)
    cancel() // BUG: cancels immediately
    for _, it := range items {
        if err := process(ctx, it); err != nil {
            return err
        }
    }
    return nil
}
```

**Bug.** `cancel()` is called immediately, so every `process` call sees a cancelled context and bails out. Probably the author meant `defer cancel()`.

**Fix.**
```go
ctx, cancel := context.WithCancel(ctx)
defer cancel()
```

---

## Bug 12 — Channel send not cancellable

```go
func sender(ctx context.Context, ch chan<- int) {
    for i := 0; ; i++ {
        ch <- i // BUG: blocks forever if no receiver; ignores ctx
    }
}
```

**Bug.** If `ch` is unbuffered and no one is receiving, the send blocks. Cancellation never reaches this goroutine.

**Fix.** `select` over send and cancel:
```go
for i := 0; ; i++ {
    select {
    case ch <- i:
    case <-ctx.Done():
        return
    }
}
```

---

## Bug 13 — `Shutdown` without `defer cancel`

```go
func runService(parent context.Context) error {
    ctx, _ := context.WithTimeout(parent, 30*time.Second)
    return srv.Shutdown(ctx) // BUG: cancel discarded
}
```

**Bug.** Even on early return, the cancel is not called. Timer leaks. `go vet` warns.

**Fix.**
```go
ctx, cancel := context.WithTimeout(parent, 30*time.Second)
defer cancel()
return srv.Shutdown(ctx)
```

---

## Bug 14 — `signal.Notify` channel unbuffered

```go
func main() {
    sigs := make(chan os.Signal) // BUG: unbuffered
    signal.Notify(sigs, syscall.SIGTERM)
    <-sigs
    fmt.Println("shutting down")
}
```

**Bug.** `signal.Notify` does a non-blocking send. If the channel is unbuffered and no receiver is waiting, the signal is dropped. The program never sees SIGTERM.

**Fix.** Buffer the channel:
```go
sigs := make(chan os.Signal, 1)
```

Or use `signal.NotifyContext`, which handles buffering internally.

---

## Bug 15 — Cgo cancellation flag never reset

```go
var cancelFlag atomic.Int32

func work(ctx context.Context) error {
    go func() {
        <-ctx.Done()
        cancelFlag.Store(1)
    }()
    C.long_work(C.int(1000000))
    if cancelFlag.Load() == 1 {
        return ctx.Err()
    }
    return nil
}
```

**Bug 1.** `cancelFlag` is shared across all calls. Once one call sets it, all subsequent calls see "cancelled" forever.

**Bug 2.** The watcher goroutine leaks if `work` returns before `ctx` cancels (it waits on `<-ctx.Done()` indefinitely).

**Fix.** Make the flag per-call (e.g., pass a pointer), and use a `stop` channel to release the watcher:
```go
func work(ctx context.Context) error {
    var flag atomic.Int32
    stop := make(chan struct{})
    go func() {
        select {
        case <-ctx.Done():
            flag.Store(1)
        case <-stop:
        }
    }()
    defer close(stop)
    // ... C call that polls flag ...
}
```
