# Preventing Goroutine Leaks — Interview Questions

## Table of Contents
1. [Junior-Level Questions](#junior-level-questions)
2. [Middle-Level Questions](#middle-level-questions)
3. [Senior-Level Questions](#senior-level-questions)
4. [Design Questions](#design-questions)
5. [Coding Tasks](#coding-tasks)
6. [Behavioural and Process Questions](#behavioural-and-process-questions)

---

## Junior-Level Questions

### Q1. What is a goroutine leak?

A goroutine that started but has no way to exit. It is blocked indefinitely — usually on a channel operation that no one will satisfy — and holds its stack and any referenced memory for the lifetime of the process.

### Q2. Name the five most common leak patterns.

1. Sender blocked on an unbuffered channel with no receiver.
2. Receiver blocked on a channel that is never closed.
3. `for { select { default: ... } }` loop with no cancellation case.
4. Goroutine holding a mutex that another goroutine depends on while also blocking.
5. Background ticker not stopped.

### Q3. What is the canonical fix for "sender blocked on a channel with no receiver"?

Buffer the channel by the number of senders: `make(chan T, N)` where N equals the count of goroutines that may send. Every sender can deposit its value and exit even if no one reads it.

### Q4. Why is `context.Context` the standard way to signal cancellation?

It is goroutine-safe, propagates through a chain of derived contexts, and the standard library accepts it everywhere I/O happens. Cancelling a parent automatically cancels all derived contexts. The `<-ctx.Done()` channel is observable in a `select`.

### Q5. What does "every goroutine has exactly one owner" mean?

Exactly one entity — usually a struct, sometimes a function — holds the cancel function (or `Stop` method) and is responsible for waiting for the goroutine to finish. Two owners cause ownership confusion; zero owners means the goroutine is a guaranteed leak.

### Q6. What is wrong with this code?

```go
func startHeartbeat() {
    go func() {
        for {
            time.Sleep(time.Second)
            ping()
        }
    }()
}
```

No owner, no cancellation, no ticker `Stop`. The goroutine cannot be stopped. The fix is a struct with a `Close` method, a `time.Ticker` with `defer t.Stop()`, and a `select` watching `<-ctx.Done()`.

### Q7. Why is `defer cancel()` important even when the function is about to return?

`cancel` releases internal resources held by the context (timer, parent registration). Skipping it leaks those resources until the parent context is itself cancelled or the GC eventually collects the structure. `go vet` warns about missing cancels.

### Q8. What does `<-ctx.Done()` return?

A receive on the channel. When the context is cancelled, the channel is closed, and any receive returns the zero value (`struct{}{}`) immediately. Before cancellation, the receive blocks.

---

## Middle-Level Questions

### Q9. Why prefer `errgroup` over a hand-rolled `WaitGroup` + error channel?

`errgroup.WithContext` provides a derived context that is cancelled on the first error. The combined "wait for all, collect first error, cancel siblings" pattern is correct by construction. A hand-rolled equivalent is verbose and easy to get wrong (forgotten cancellation, lost errors, race on close).

### Q10. When does `errgroup` not fit?

- When you need all errors, not just the first (use `errors.Join` or a mutex-protected slice).
- When you want all workers to complete despite failures (catch errors inside each `Go`).
- When workers have a pipeline dependency (use a pipeline pattern instead).
- When per-worker timeouts differ (wrap each in `context.WithTimeout`).

### Q11. Why is storing a `context.Context` in a struct field usually wrong?

The stored context becomes stale for any new call: it carries the deadline and cancellation of whenever it was captured, not of the current caller. Pass `ctx` per call instead. The exception is a struct that owns its internal goroutines — that struct may hold the `cancelFunc` for its own context.

### Q12. How does `goleak` work?

`goleak.VerifyTestMain(m)` runs the test suite, then enumerates all live goroutines via `runtime.Stack`. Any goroutine outside the standard library set (or an allowlist you provide) is reported. The test binary exits non-zero with the goroutine stacks printed.

### Q13. What is the `Start/Stop` struct pattern?

A struct that owns one or more goroutines, exposing:
- A constructor that takes a parent context and spawns the goroutines.
- A `Close` (or `Stop`) method that cancels the context and waits for the goroutines to finish.

It encapsulates the lifecycle so callers cannot leak the goroutines.

### Q14. What is the difference between cancelling a context and waiting for goroutines to exit?

`cancel()` *signals* the goroutines to exit; it returns immediately. Waiting (`<-done`, `wg.Wait()`) blocks until the goroutines have actually exited. Both are needed: cancel + wait. Skipping the wait means the function returns while goroutines are still running.

### Q15. How would you bound shutdown time?

```go
done := make(chan struct{})
go func() { wg.Wait(); close(done) }()
select {
case <-done:
    // graceful
case <-time.After(timeout):
    // timed out; log and proceed
}
```

After the timeout, the lingering goroutines are a known incident — log them and move on rather than blocking forever.

### Q16. Why does `time.After` in a loop leak resources?

`time.After(d)` allocates a new timer on every call. The underlying `*Timer` is not GC'd until it fires. In a tight loop, this accumulates timers proportional to loop iterations. Use a reused `time.Timer` or a `time.Ticker` instead.

### Q17. What happens if you call `close(ch)` from a receiver?

If there are still senders, they will panic with "send on closed channel" on their next send. Receivers should never close. Closing is the sender's responsibility.

---

## Senior-Level Questions

### Q18. Design a library type that owns a background goroutine. What is the contract?

```go
type Service struct { /* ... */ }

func NewService(ctx context.Context, cfg Config) (*Service, error)

func (s *Service) Close() error
```

Contract:
- Constructor takes a context; the goroutine's lifetime is bounded by it.
- Constructor returns an error if startup fails; no goroutine is left running.
- `Close` is idempotent.
- `Close` waits for the goroutine to finish.
- `Close` surfaces any shutdown error.
- The type comment documents all of the above.

### Q19. Why is the shutdown context for `http.Server.Shutdown` not derived from the cancelled root context?

Because the root context is already cancelled when shutdown begins. If `srv.Shutdown(rootCtx)` were called, it would return immediately, dropping in-flight requests. The shutdown context must be a fresh `context.WithTimeout(context.Background(), 30*time.Second)` to give in-flight requests time to drain.

### Q20. A Kafka consumer group rebalances mid-processing. How do you avoid leaks?

- Wrap per-partition workers in an `errgroup.WithContext` that is recreated on each `JoinGroup`.
- When the session's partition assignment ends (rebalance), the partition goroutines see `ctx.Done()` and return.
- The outer loop re-joins the group with the new assignment.
- Shutdown cancels the top-level context, which propagates through `errgroup` to every partition worker.

### Q21. How do you audit an existing codebase for leaks?

Five phases:
1. Instrument: track `runtime.NumGoroutine`, expose `/debug/pprof/goroutine`.
2. Catalogue: list every `go` statement; identify owner, stop signal, wait point.
3. Test: add `goleak.VerifyTestMain` to every package; fix the failing tests.
4. Refactor: convert orphans to the Start/Stop pattern, one per PR.
5. Prevent: CI gates, linters, code review checklist.

### Q22. A goroutine is blocked in `conn.Read`. Cancelling its context does nothing. How do you wake it?

Set a read deadline on the connection: `conn.SetReadDeadline(time.Now())`. The blocked read returns with a timeout error. Pair this with `defer cancel()` so the goroutine's own logic also sees cancellation. This is why connection-owning structs typically expose both `cancel` and `conn` in their `Close` method.

### Q23. When is a fire-and-forget goroutine acceptable?

Almost never in production code. The acceptable cases are:
- Side effects that must outlive a request (audit logging, async metrics) — but these belong in a queue with a documented background worker, not in a bare `go func()`.
- Test helpers explicitly known to be short-lived (and ideally not used).
- Truly process-lifetime goroutines (a single keepalive heartbeat) that are documented and allowlisted by goleak.

### Q24. How do you guarantee a cancellation latency budget of 1 second?

For every long-running goroutine:
- The select includes `<-ctx.Done()`.
- All downstream calls accept the context and respect cancellation.
- Sleeps use `select { case <-ctx.Done(): case <-time.After(d): }`, not `time.Sleep`.
- CPU-bound loops check `ctx.Err()` every N iterations.
- Add a CI test that calls `cancel()` and asserts `Wait()` returns within 1 second.

### Q25. Compare `sync.Mutex` and channels for protecting state. Which leaks more?

Mutexes are far more leak-prone in practice because:
- A goroutine that panics while holding the mutex without `defer Unlock` strands it.
- A goroutine that holds the mutex and then waits on a channel can deadlock.
- Mutex deadlocks pin every waiter as a leaked goroutine.

Channels are not immune (they have their own leak patterns) but the leak modes are easier to test and reason about with `goleak`.

---

## Design Questions

### Q26. Design a worker pool that processes jobs from a channel, with a leak-free shutdown.

Sketch:

```go
type Pool struct {
    cancel context.CancelFunc
    wg     sync.WaitGroup
    in     chan Job
}

func NewPool(ctx context.Context, size int, handle func(context.Context, Job) error) *Pool {
    ctx, cancel := context.WithCancel(ctx)
    p := &Pool{cancel: cancel, in: make(chan Job)}
    for i := 0; i < size; i++ {
        p.wg.Add(1)
        go func() {
            defer p.wg.Done()
            for {
                select {
                case <-ctx.Done():
                    return
                case j, ok := <-p.in:
                    if !ok {
                        return
                    }
                    if err := handle(ctx, j); err != nil {
                        // log
                    }
                }
            }
        }()
    }
    return p
}

func (p *Pool) Submit(j Job) error {
    select {
    case p.in <- j:
        return nil
    default:
        return ErrFull
    }
}

func (p *Pool) Close() {
    p.cancel()
    p.wg.Wait()
}
```

Discuss: where does back-pressure happen? How do you drain in-flight jobs vs. cancel them?

### Q27. Design a metrics flusher that batches metrics and flushes every 5 seconds. Must survive a slow downstream and shut down cleanly.

Key points:
- Owned by a struct with `Close`.
- Internal channel for `Submit` (bounded to prevent unbounded memory growth).
- Ticker for periodic flush.
- On `Close`: cancel context, flush remaining buffer, wait for flush goroutine to exit.
- On slow downstream: timeout each flush attempt; drop or queue, with explicit behaviour.

### Q28. Design a gRPC server with graceful shutdown. What goroutines exist, who owns them, and how do they stop?

- The accept goroutine (owned by the gRPC server). Stops via `GracefulStop`.
- Per-stream handler goroutines (one per RPC). Stop when the handler returns; the handler watches `stream.Context().Done()`.
- Optional background goroutines (health checks, metrics). Owned by the application; stopped via their `Close` methods.

`grpc.Server.GracefulStop` stops accepting new RPCs and waits for in-flight ones. The application code wraps it with a timeout to bound the wait.

---

## Coding Tasks

### Task 1 — Fix the leak

```go
func first(urls []string) string {
    ch := make(chan string)
    for _, u := range urls {
        go func(u string) { ch <- fetch(u) }(u)
    }
    return <-ch
}
```

Answer: `make(chan string, len(urls))`.

### Task 2 — Add cancellation

```go
func processForever(in <-chan Job) {
    go func() {
        for j := range in {
            process(j)
        }
    }()
}
```

Answer: add a context parameter and a `select` with `<-ctx.Done()`. Return a `Close` method or a `cancel` function to the caller.

### Task 3 — Write the Start/Stop struct for a periodic flusher

Test your candidate by asking for a complete, compilable struct with constructor, `Close`, and a ticker loop.

### Task 4 — Write a leak-detection test

```go
func TestX(t *testing.T) {
    defer goleak.VerifyNone(t)
    // ...
}
```

Ask the candidate to extend a test to assert no leaks.

### Task 5 — Spot the bug

```go
ctx, cancel := context.WithCancel(parent)
defer cancel()
go work(ctx)
return // returns before goroutine exits
```

Answer: missing `WaitGroup`. The defer cancels the context, but the function returns immediately; the goroutine continues to exist concurrently with whatever the caller does next.

---

## Behavioural and Process Questions

### Q29. Tell me about a goroutine leak you debugged in production. What was the symptom, the cause, the fix?

Look for: pprof familiarity, a concrete cause (one of the five patterns), and a fix that addresses the root pattern, not just the instance.

### Q30. How do you prevent leaks at code review time?

Look for: a mental checklist (owner, stop signal, wait, context, ticker). A formal checklist on the team's wiki. Awareness of `goleak` in CI. Knowing which file paths in the repo are "high risk" (any file that spawns goroutines).

### Q31. What would your concurrency style guide say?

Look for: opinionated rules, examples, anti-patterns. The strength of a senior+ candidate is having internalised the rules to the point of being able to write them down.

### Q32. When have you accepted a leak rather than fix it?

Look for: pragmatism with documentation. "We had a third-party library that leaked one goroutine per process; we allowlisted it in goleak and filed an upstream bug." Not: "We didn't have time to fix it, so we ignored the alarm."

### Q33. How do you onboard a new engineer to the concurrency standards of your codebase?

Look for: a short written guide, a list of representative PRs to read, the rule that the first concurrent PR is reviewed by a senior. The bad answer is "they pick it up from the codebase."
