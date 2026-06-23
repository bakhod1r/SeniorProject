---
layout: default
title: Find The Bug — Drain Pattern
parent: Drain Pattern
grand_parent: Production Patterns
ancestor: Go
nav_order: 9
has_children: false
permalink: /roadmap/programming-languages/golang/07-concurrency/18-production-patterns/05-drain-pattern/find-bug/
---

# Drain Pattern — Find The Bug

Each snippet has at least one drain-related bug. Find it, explain it, fix it.

---

## Bug 1

```go
func main() {
	srv := &http.Server{Addr: ":8080"}
	go srv.ListenAndServe()
	stop := make(chan os.Signal)
	signal.Notify(stop, syscall.SIGTERM)
	<-stop
	srv.Close()
}
```

**Bug.** Two issues:

1. `signal.Notify` requires a buffered channel (size 1+); an unbuffered channel may miss the signal.
2. `srv.Close()` is the hard-stop; should be `srv.Shutdown(ctx)` for graceful drain.

**Fix.**

```go
stop := make(chan os.Signal, 1)
signal.Notify(stop, syscall.SIGTERM)
<-stop
ctx, cancel := context.WithTimeout(context.Background(), 25*time.Second)
defer cancel()
_ = srv.Shutdown(ctx)
```

---

## Bug 2

```go
ctx, cancel := signal.NotifyContext(context.Background(), syscall.SIGTERM)
defer cancel()
<-ctx.Done()
drainCtx, _ := context.WithTimeout(ctx, 25*time.Second)
_ = srv.Shutdown(drainCtx)
```

**Bug.** `drainCtx` is derived from `ctx`, which is already cancelled. `drainCtx` has zero time. The drain returns instantly with `context.Canceled`.

**Fix.** Derive from `context.Background()`:

```go
drainCtx, cancel := context.WithTimeout(context.Background(), 25*time.Second)
defer cancel()
_ = srv.Shutdown(drainCtx)
```

---

## Bug 3

```go
func (p *Pool) Drain() {
	close(p.queue)
	p.wg.Wait()
}
```

**Bug.** No deadline. A hung worker keeps `Wait` blocked forever, exceeding the grace period.

**Fix.**

```go
func (p *Pool) Drain(ctx context.Context) error {
	close(p.queue)
	done := make(chan struct{})
	go func() { p.wg.Wait(); close(done) }()
	select {
	case <-done:
		return nil
	case <-ctx.Done():
		return ctx.Err()
	}
}
```

---

## Bug 4

```go
func (p *Pool) Submit(j Job) {
	p.queue <- j
}

func (p *Pool) Drain() {
	close(p.queue)
}
```

**Bug.** Race between `Submit` and `Drain`. If `Drain` closes `p.queue` while `Submit` is mid-send, `Submit` panics with "send on closed channel."

**Fix.** Gate `Submit` with an atomic flag and a mutex:

```go
type Pool struct {
	queue  chan Job
	closed atomic.Bool
	mu     sync.Mutex
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

func (p *Pool) Drain() {
	p.mu.Lock()
	if p.closed.CompareAndSwap(false, true) {
		close(p.queue)
	}
	p.mu.Unlock()
}
```

---

## Bug 5

```go
go func() {
	for msg := range incomingCh {
		_ = process(msg)
	}
}()
```

**Bug.** No context check. If `process(msg)` takes a long time, the goroutine cannot be cancelled.

**Fix.** Add a context-aware `select`:

```go
go func() {
	for {
		select {
		case <-ctx.Done():
			return
		case msg, ok := <-incomingCh:
			if !ok {
				return
			}
			_ = process(ctx, msg)
		}
	}
}()
```

---

## Bug 6

```go
func handle(w http.ResponseWriter, r *http.Request) {
	time.Sleep(30 * time.Second)
	fmt.Fprintln(w, "done")
}
```

**Bug.** Handler does not respect `r.Context()`. `Server.Shutdown` cannot interrupt it mid-sleep.

**Fix.**

```go
func handle(w http.ResponseWriter, r *http.Request) {
	select {
	case <-time.After(30 * time.Second):
		fmt.Fprintln(w, "done")
	case <-r.Context().Done():
		http.Error(w, "cancelled", http.StatusServiceUnavailable)
	}
}
```

---

## Bug 7

```go
db.Close()
pool.Drain(ctx)
```

**Bug.** Wrong order. The pool's workers may still hold database connections; closing the database before draining the pool can cause worker panics or hung queries.

**Fix.** Drain pool first, then close database:

```go
pool.Drain(ctx)
db.Close()
```

---

## Bug 8

```go
defer cancel()
go server.Run(ctx)
```

**Bug.** `cancel` is deferred but no synchronisation ensures the server has finished. The function returns, `cancel` runs, the server sees its context cancelled — but no one is waiting for it to actually exit. Goroutine leaks.

**Fix.** Wait for the server:

```go
var wg sync.WaitGroup
wg.Add(1)
go func() {
	defer wg.Done()
	server.Run(ctx)
}()
defer wg.Wait()
defer cancel()
```

---

## Bug 9

```go
once := sync.Once{}
func (s *Server) Drain() {
	once.Do(func() {
		close(s.queue)
		s.wg.Wait()
	})
}
```

**Bug.** Two issues:

1. `once` should be a field of `*Server`, not a package-level variable.
2. No deadline on `wg.Wait`.

**Fix.**

```go
type Server struct {
	once sync.Once
	queue chan Job
	wg sync.WaitGroup
}

func (s *Server) Drain(ctx context.Context) error {
	var err error
	s.once.Do(func() {
		close(s.queue)
		done := make(chan struct{})
		go func() { s.wg.Wait(); close(done) }()
		select {
		case <-done:
		case <-ctx.Done():
			err = ctx.Err()
		}
	})
	return err
}
```

---

## Bug 10

```go
go func() {
	for {
		work()
	}
}()
```

**Bug.** Infinite loop with no exit condition. Cannot drain. Goroutine leaks.

**Fix.**

```go
go func() {
	for {
		select {
		case <-ctx.Done():
			return
		default:
			work(ctx)
		}
	}
}()
```

Or, even better, replace the `default` with a blocking channel receive so the goroutine yields when there's no work.

---

## Bug 11

```go
go func() {
	if err := server.Run(ctx); err != nil {
		os.Exit(1)
	}
}()
```

**Bug.** `os.Exit(1)` from a goroutine bypasses drain. No deferred functions in any goroutine run.

**Fix.** Surface the error and let `main` decide:

```go
errs := make(chan error, 1)
go func() { errs <- server.Run(ctx) }()
if err := <-errs; err != nil {
	log.Printf("server: %v", err)
	cancel() // triggers drain in main
}
```

---

## Bug 12

```go
func main() {
	srv := &http.Server{Addr: ":8080"}
	go srv.ListenAndServe()

	ctx, cancel := signal.NotifyContext(context.Background(), syscall.SIGTERM)
	defer cancel()
	<-ctx.Done()

	// drain immediately
	if err := srv.Shutdown(context.Background()); err != nil {
		log.Fatal(err)
	}
}
```

**Bug.** Two issues:

1. No deadline on `Shutdown` — could hang forever.
2. `log.Fatal` on shutdown error calls `os.Exit(1)`, skipping any remaining cleanup.

**Fix.**

```go
ctx, cancel := context.WithTimeout(context.Background(), 25*time.Second)
defer cancel()
if err := srv.Shutdown(ctx); err != nil {
	log.Printf("shutdown: %v", err)
}
```

---

## Bug 13

```go
for _, item := range items {
	wg.Add(1)
	go func() {
		defer wg.Done()
		process(item)
	}()
}
wg.Wait()
```

**Bug.** Captured loop variable. All goroutines see the final value of `item`. (In Go versions before 1.22.)

**Fix.** (Pre 1.22.)

```go
for _, item := range items {
	item := item // capture
	wg.Add(1)
	go func() {
		defer wg.Done()
		process(item)
	}()
}
```

In Go 1.22+, the loop variable is per-iteration; no fix needed. But always check the Go version.

---

## Bug 14

```go
func consume(ctx context.Context) {
	for {
		msg, err := reader.FetchMessage(ctx)
		if err != nil {
			return
		}
		go process(msg) // fire-and-forget
		_ = reader.CommitMessages(ctx, msg)
	}
}
```

**Bug.** `process` runs in a goroutine, but the offset is committed immediately. If `process` fails or the program drains before `process` finishes, the message is lost.

**Fix.** Commit only after `process` succeeds:

```go
for {
	msg, err := reader.FetchMessage(ctx)
	if err != nil {
		return
	}
	if err := process(msg); err != nil {
		continue
	}
	_ = reader.CommitMessages(ctx, msg)
}
```

Or, if you want concurrency, use a worker pool that commits after processing.

---

## Bug 15

```go
func (s *Service) Drain(ctx context.Context) error {
	close(s.in)
	s.wg.Wait()
	return nil
}
```

**Bug.** No deadline. The same as Bug 3, plus this returns nil even on hang (because there is no select).

**Fix.**

```go
func (s *Service) Drain(ctx context.Context) error {
	close(s.in)
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

## Bug 16

```go
http.HandleFunc("/shutdown", func(w http.ResponseWriter, r *http.Request) {
	srv.Shutdown(context.Background())
})
```

**Bug.** The handler is running on the server it is trying to shut down. `Shutdown` waits for active handlers (including this one) to finish, but this handler is waiting for `Shutdown`. Deadlock.

**Fix.** Trigger shutdown from outside the handler:

```go
http.HandleFunc("/shutdown", func(w http.ResponseWriter, r *http.Request) {
	go func() {
		_ = srv.Shutdown(context.Background())
	}()
	w.WriteHeader(http.StatusOK)
})
```

Better: do not trigger shutdown via HTTP. Use signals.

---

## Bug 17

```go
func main() {
	app := NewApp()
	app.Start()
	<-make(chan struct{})  // block forever
}
```

**Bug.** Blocks forever, but does not handle signals. `SIGTERM` arrives; nothing catches it; OS kills process; no drain.

**Fix.**

```go
ctx, cancel := signal.NotifyContext(context.Background(), syscall.SIGTERM)
defer cancel()
<-ctx.Done()
_ = app.Drain(...)
```

---

## Bug 18

```go
func (c *Consumer) Drain(ctx context.Context) error {
	c.cancel() // stop fetching
	c.reader.Close() // closes immediately
	c.wg.Wait() // waits for workers
	return nil
}
```

**Bug.** `reader.Close()` is called before workers finish. The workers may try to commit messages on a closed reader; commits fail; offsets are not committed; duplicates on next consumer.

**Fix.** Order matters:

```go
c.cancel()    // stop fetching
c.wg.Wait()   // workers finish (commit any remaining)
c.reader.Close() // close last
```

---

## Bug 19

```go
go func() {
	for tick := range time.Tick(time.Second) {
		work(tick)
	}
}()
```

**Bug.** Two issues:

1. `time.Tick` cannot be stopped; the underlying ticker leaks.
2. No context check; cannot drain.

**Fix.**

```go
t := time.NewTicker(time.Second)
defer t.Stop()
go func() {
	for {
		select {
		case <-ctx.Done():
			return
		case tick := <-t.C:
			work(ctx, tick)
		}
	}
}()
```

---

## Bug 20

```go
func (s *Service) Drain() error {
	s.mu.Lock()
	defer s.mu.Unlock()
	for s.inFlight > 0 {
		s.cond.Wait()
	}
	return nil
}
```

**Bug.** Unbounded wait. If `inFlight` never decreases, the function hangs forever. No way to bound by deadline.

**Fix.** Convert to a deadline-aware loop, or use a different synchronisation primitive (e.g., a channel).

---

## Conclusion

These bugs are real. I have seen all of them in production code. The fixes are usually small; the impact of catching them is large.

Read through these. Cover the fix; read the code; identify the bug; check your answer.

After 20 of these, your eye is trained to spot drain bugs. You will catch them in code reviews. You will avoid them in your own code.

Drain bug detection is a skill. Build it.
