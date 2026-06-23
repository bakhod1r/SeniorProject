# Deadlock in Go — Tasks

A graded set of programming exercises. Each task includes a goal, suggested approach, and a brief acceptance criterion. Use these as practice; the solutions are not given here — write them yourself and verify with tests.

---

## Junior Tasks

### Task 1: Trigger and observe the runtime detector

**Goal.** Write five small programs, each of which triggers `fatal error: all goroutines are asleep - deadlock!` for a different reason:

1. Send on an unbuffered channel with no receiver.
2. Receive from an unbuffered channel with no sender.
3. `for range` over a channel that no one closes.
4. `wg.Wait()` with a missing `Done`.
5. `select {}` with no cases.

For each, run the program, capture the stack dump, and write a one-paragraph explanation pointing to the line in the stack that identifies the bug.

**Acceptance.** Five `.go` files, five captured outputs, five explanations.

---

### Task 2: Fix a producer-consumer deadlock

**Goal.** Given this broken code:

```go
package main

import "fmt"

func main() {
    ch := make(chan int)
    go func() {
        for i := 0; i < 5; i++ {
            ch <- i
        }
    }()
    for v := range ch {
        fmt.Println(v)
    }
}
```

Identify the bug, fix it, and explain in a comment why your fix works.

**Acceptance.** Program prints 0..4 in order and exits cleanly. The fix adds `defer close(ch)` inside the producer goroutine.

---

### Task 3: Add `defer Unlock` everywhere

**Goal.** Given a 50-line program with manual `Lock`/`Unlock` calls scattered throughout, refactor to use `defer Unlock()` immediately after every `Lock()`. Make sure no exit path leaves the lock held.

Sample starter:

```go
func (s *Store) Set(key, val string) error {
    s.mu.Lock()
    if !s.valid {
        s.mu.Unlock()
        return errors.New("invalid")
    }
    s.data[key] = val
    s.mu.Unlock()
    return nil
}
```

Refactor:

```go
func (s *Store) Set(key, val string) error {
    s.mu.Lock()
    defer s.mu.Unlock()
    if !s.valid {
        return errors.New("invalid")
    }
    s.data[key] = val
    return nil
}
```

**Acceptance.** All `Lock`/`Unlock` pairs use the deferred form. Tests still pass.

---

### Task 4: Detect deadlock with a test timeout

**Goal.** Given a function `process(ch chan int)` that might deadlock under some inputs, write a test that fails (with a useful message) if `process` does not complete within 2 seconds.

Skeleton:

```go
func TestProcessDeadlockFree(t *testing.T) {
    ch := make(chan int)
    done := make(chan struct{})
    go func() {
        defer close(done)
        process(ch)
    }()
    // ... feed ch ...
    select {
    case <-done:
        // ok
    case <-time.After(2 * time.Second):
        // dump stacks and fail
    }
}
```

**Acceptance.** When `process` deadlocks, the test fails with a stack dump within 2 seconds. When `process` works, the test passes quickly.

---

### Task 5: Implement bounded retry with `TryLock`

**Goal.** Write a function `LockOrError(mu *sync.Mutex, attempts int) error` that tries to acquire the lock up to `attempts` times with 10 ms between attempts, returning `errors.New("could not acquire lock")` if all attempts fail.

**Acceptance.** Function uses `mu.TryLock()` and returns either nil (lock held by caller) or an error (lock not held). Caller is responsible for `Unlock` on success.

---

## Middle Tasks

### Task 6: Reproduce and diagnose mutex inversion

**Goal.** Write a program with two functions, `transferFromTo(a, b *Account, amount int)` and `transferFromTo(b, a *Account, amount int)`, where each function `Lock`s the source account first, then the destination. Spawn many concurrent transfers in opposite directions until deadlock occurs.

Use `select { case <-time.After(5 * time.Second): }` plus `runtime.Stack` to capture the dump after 5 seconds of presumed hang.

**Acceptance.** Captured dump shows two goroutines blocked on `sync.Mutex.Lock`, with addresses indicating the inversion. Write a 2-sentence root-cause explanation.

---

### Task 7: Fix the mutex inversion with lock ordering

**Goal.** Refactor the program from Task 6 so transfers always acquire the lower-address-account first, regardless of direction:

```go
func transfer(from, to *Account, amount int) {
    first, second := from, to
    if uintptr(unsafe.Pointer(first)) > uintptr(unsafe.Pointer(second)) {
        first, second = second, first
    }
    first.mu.Lock()
    defer first.mu.Unlock()
    second.mu.Lock()
    defer second.mu.Unlock()
    from.balance -= amount
    to.balance += amount
}
```

**Acceptance.** The new program completes 100,000 concurrent transfers without deadlock. Verify by running the previous reproducer.

---

### Task 8: Implement a ranked mutex

**Goal.** Implement the `ranklock.Mutex` from the senior file. Write tests that:

1. Verify normal acquisition order (increasing rank) works.
2. Verify inverted acquisition (decreasing rank) panics.
3. Verify multiple goroutines each holding their own held-ranks lists.

**Acceptance.** Three tests pass. The panic message is informative: includes the violating lock's name and rank, and the held rank.

---

### Task 9: Add `goleak` to an existing test suite

**Goal.** Take a small package you have written (or use a tutorial example) and add `goleak.VerifyTestMain(m)` to its `TestMain`. Run the tests. If any leaks, fix them.

Common leaks: goroutines spawned in `setUp` not cleaned up, HTTP servers not shut down, contexts not cancelled.

**Acceptance.** All tests pass with `goleak` enabled. No leaked goroutines reported.

---

### Task 10: Write a stack-dump-on-timeout helper

**Goal.** Write a function `RunWithTimeout(t *testing.T, d time.Duration, f func())` that:

1. Runs `f` in a goroutine.
2. If `f` returns before `d`, returns normally.
3. If `d` elapses first, dumps all goroutine stacks via `runtime.Stack` and calls `t.Fatalf` with the dump.

**Acceptance.** When `f` deadlocks, the test fails within `d` with a complete stack dump. When `f` works, the test passes.

---

### Task 11: Wrap a non-context blocking call with cancellation

**Goal.** Wrap `net.Conn.Read` with a function `ReadWithContext(ctx context.Context, conn net.Conn, p []byte) (int, error)` that:

1. Returns `(n, nil)` on successful read.
2. Returns `(0, ctx.Err())` if context is cancelled before read completes.
3. Does not leak the internal goroutine on cancellation.

The trick is calling `conn.SetReadDeadline(time.Now())` on cancellation to unblock the in-flight `Read`, then draining the result.

**Acceptance.** Tests verify both paths: completion before cancel, cancel before completion. `goleak.VerifyNone(t)` passes after the test.

---

### Task 12: Producer-consumer with fan-out and fan-in

**Goal.** Implement a worker pool with N workers consuming from a shared input channel and writing to a shared output channel. The pool must:

1. Close the output when all workers have exited.
2. Allow cancellation via `context.Context`.
3. Not deadlock if the consumer stops reading the output.

**Hint.** Use `errgroup.Group` and a goroutine that closes the output after `wg.Wait`.

**Acceptance.** Tests verify normal completion, early cancellation, and consumer-stops scenarios. No deadlocks, no leaks.

---

### Task 13: Detect a forgotten `cancel`

**Goal.** Run `go vet` on a package containing:

```go
func work() {
    ctx, _ := context.WithCancel(context.Background())
    doStuff(ctx)
}
```

Capture the `lostcancel` warning. Fix the code so the warning goes away.

**Acceptance.** `go vet` warning visible before fix, absent after fix. Fix calls `cancel()` (typically via `defer`).

---

## Senior Tasks

### Task 14: Cache with non-blocking refresh

**Goal.** Implement a cache that:

1. Reads are lock-free using `atomic.Value`.
2. Refreshes are coordinated via `singleflight.Group` so concurrent misses for the same key make only one upstream call.
3. The cache mutex is never held during the upstream call.

**Acceptance.** Tests verify:

- 1,000 concurrent reads of the same key trigger only one upstream call.
- Upstream errors are returned to all waiters.
- Cache survives a deliberately slow upstream (artificially delayed by 1 second) without deadlocking concurrent reads of other keys.

---

### Task 15: Lock-order analyzer (basic)

**Goal.** Write a `go/analysis` analyzer that, for a single package:

1. Identifies all `*sync.Mutex` field declarations.
2. For each function, computes the set of mutex fields locked.
3. Reports any function that locks two mutexes in inconsistent order (compared to other functions).

**Hint.** The `golang.org/x/tools/go/analysis` framework provides the boilerplate. The `inspect` analyzer gives you the AST.

**Acceptance.** Analyzer reports on a contrived program with two functions locking the same two mutexes in opposite orders. Analyzer is silent on a correctly-ordered program.

---

### Task 16: Actor-pattern counter

**Goal.** Implement `Counter` with `Inc`, `Get`, `Reset`, and `Close` using a single owner goroutine and channels. No mutex. Compare benchmark performance to a mutex-based implementation and an `atomic.Int64`-based implementation.

**Acceptance.** All three implementations pass identical correctness tests. Benchmark numbers show:

- Atomic is fastest.
- Mutex is close behind under low contention, slower under high contention.
- Actor is slowest by 5-10x but has the most flexible semantics.

Write a one-page analysis of when each is appropriate.

---

### Task 17: Heartbeat-based liveness

**Goal.** Build a worker pool where each worker writes its "last alive" timestamp to a shared map (atomically). Add an HTTP `/healthz` handler that fails if any worker has not ticked in the last 30 seconds.

**Acceptance.**

- Healthy state: `/healthz` returns 200.
- Kill one worker (simulate deadlock with `select {}`). After 30 seconds, `/healthz` returns 503.
- The handler does not itself deadlock on the worker map.

---

### Task 18: Distributed deadlock simulation

**Goal.** Build three small services (each is a Go HTTP server) where:

- Service A's `/work` endpoint calls B's `/work` then returns.
- B's `/work` calls C's `/work` then returns.
- C's `/work` calls A's `/work` then returns.

This is a cyclic synchronous call graph. Without any safeguards, it will exhaust resources or deadlock when both directions are exercised concurrently.

Add timeouts to each call (`context.WithTimeout(1s)`). Verify that under cycle conditions, the calls time out rather than hang forever.

Then refactor to break the cycle (e.g., A → B → C with C returning, instead of calling A).

**Acceptance.** Three programs, with and without the fix. Logs show the difference between timeout-induced errors and clean completion.

---

### Task 19: Trace-based deadlock investigation

**Goal.** Take an existing deadlock-prone program (e.g., the inverted-mutex example from Task 6). Wrap it with `runtime/trace.Start` / `runtime/trace.Stop`. Open the trace in `go tool trace`.

Identify the goroutines that block on `sync.Mutex.Lock` and never unblock. Capture screenshots or describe what you see in the timeline.

**Acceptance.** A written analysis of what the trace shows: which goroutines parked when, what they were waiting for, whether the trace tools can definitively identify the cycle.

---

### Task 20: Library design with documented lock order

**Goal.** Design a Go package with three exported types, each holding state behind a mutex. Document the lock order in the package's `doc.go`. Write a `TestLockOrder` that exercises every code path and confirms (via `go-deadlock` or your own ranked-mutex wrapper) that no inversion ever occurs.

**Acceptance.** `doc.go` clearly lists ranks. `TestLockOrder` exercises every public function with concurrent inputs. No deadlock or panic in 10,000 iterations.

---

## Stretch Tasks

### Task 21: Survey of deadlock detection in production

**Goal.** Read three engineering blog posts about real production deadlocks (suggestions: Uber's Go incidents, Cloudflare's, Discord's, Stripe's). Summarize each in a paragraph:

- What was the cycle?
- How was it detected (or not)?
- What was the fix?
- What systemic change was made?

**Acceptance.** A 1-2 page document with three case studies.

---

### Task 22: Contribute deadlock detection improvements to a project

**Goal.** Find an open-source Go project on GitHub with concurrency. Audit it for the disciplines in this section's `Compliance Checklist` (`specification.md`). Identify a real risk. Open an issue or PR with a proposed improvement.

**Acceptance.** Link to the issue or PR.

---

### Task 23: Build a deadlock-detection HTTP endpoint

**Goal.** Build an HTTP middleware that:

1. Records every blocking operation (`sync.Mutex.Lock`, `chan` send, `chan` receive) initiated by a request handler.
2. Times out requests that block too long.
3. Records the wait graph for the timed-out request and exposes it via `/debug/deadlock/<reqid>`.

**Hint.** You may need to wrap `sync.Mutex` and channels in instrumented versions, since the standard library is not introspectable.

**Acceptance.** Manual test: deliberately introduce a deadlock in a handler. Hit `/debug/deadlock/<reqid>` and see a useful wait-graph representation.

---

### Task 24: Compare `go-deadlock` overhead

**Goal.** Take a small concurrent program (perhaps from Task 14 or Task 16). Run benchmarks with `sync.Mutex` and with `github.com/sasha-s/go-deadlock.Mutex`. Measure the overhead of `go-deadlock`'s held-lock tracking.

**Acceptance.** A table of benchmark results. A short discussion of whether the overhead is acceptable for CI or for production.

---

### Task 25: Postmortem of a hypothetical incident

**Goal.** Write a postmortem for the case studies in `senior.md` (the cache-and-DB deadlock or the cgo-masked deadlock). Use the template from `senior.md`'s Postmortem section. Be specific about what you would have done differently.

**Acceptance.** A 1-page document covering trigger, cycle, detection delay, diagnosis tools, root cause, patch, preventive measure, and tests.

---

## Task Solutions

No solutions are provided in this file. Work them yourself. For the trickier tasks (16, 18, 23, 25), reach out to peers or write to a study group — the discussion is where the learning happens.

Remember the discipline:

1. State the problem precisely.
2. Predict the failure mode before running.
3. Run; capture evidence.
4. Compare evidence to prediction.
5. If they match, you understood. If not, dig in.

Deadlock work is empirical. The textbook says "two goroutines, A holds X waits Y, B holds Y waits X." The reality has six goroutines, a channel queued under load, a timer that masks the detector, and a partial cycle that resolves itself sometimes. Each task is an opportunity to develop the diagnostic muscle that matters.
