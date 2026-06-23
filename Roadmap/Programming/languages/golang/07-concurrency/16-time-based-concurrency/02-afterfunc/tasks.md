---
layout: default
title: Tasks
parent: AfterFunc
grand_parent: Time-Based Concurrency
ancestor: Go
nav_order: 8
has_children: false
permalink: /roadmap/programming-languages/golang/07-concurrency/16-time-based-concurrency/02-afterfunc/tasks/
---

# time.AfterFunc — Tasks

Eighteen hands-on exercises, ordered from beginner to advanced. Each includes a brief description, requirements, hints, and tests you should pass.

---

## Task 1: Hello, AfterFunc

**Goal:** Print "hello after 1 second" once.

**Requirements:**

- Use `time.AfterFunc`.
- Block `main` until the callback runs.

**Hint:** Use a channel.

**Test:** Run; output should be "hello after 1 second" once, then exit.

---

## Task 2: Cancellable countdown

**Goal:** Schedule a callback after a duration; allow cancellation.

**Requirements:**

- Function `Countdown(d time.Duration, fn func()) (cancel func() bool)`.
- `cancel()` returns true if the callback was prevented, false otherwise.

**Hint:** Use the timer's `Stop`.

**Test:** Call Countdown, then immediately cancel. Verify `fn` did not run.

---

## Task 3: Debounced echo

**Goal:** Build a debouncer that prints "settled" once after 100 ms of quiet.

**Requirements:**

- Method `Trigger()` to indicate input.
- After 100 ms of no Trigger, callback fires.
- New Triggers reset the timer.

**Hint:** Store `*time.Timer` in a struct; `Stop` and re-create on each Trigger.

**Test:** Call Trigger 5 times rapidly. Verify "settled" prints once, ~100 ms after the last Trigger.

---

## Task 4: Idle connection timer

**Goal:** Close a mock connection after 200 ms of inactivity.

**Requirements:**

- `Conn` struct with `Touch()` and `Close()` methods.
- After 200 ms without Touch, the conn closes itself.
- Explicit Close also works.

**Hint:** Use `Reset` on Touch.

**Test:** Create conn. Call Touch every 100 ms for a second. Verify it's still open. Stop calling Touch. Verify it closes ~200 ms later.

---

## Task 5: Watchdog

**Goal:** Detect 30 seconds of inactivity in a long-running task.

**Requirements:**

- `Watchdog` with `Touch()`, `Stop()`, and a fire callback.
- Fire callback runs once, even if multiple touches race.

**Hint:** Use `sync/atomic` for the "fired" flag.

**Test:** Touch every 10 seconds for 1 minute. Verify no fire. Stop touching. Verify fire within 30 seconds.

---

## Task 6: Deadline race

**Goal:** Race a result against a deadline.

**Requirements:**

- Function `WithDeadline(d time.Duration, op func() string) (string, error)`.
- Returns op's result if it finishes in time, otherwise `errors.New("timeout")`.

**Hint:** Use a buffered channel of size 1.

**Test:** With slow op (500 ms) and short deadline (100 ms), return timeout. With fast op (50 ms) and longer deadline (200 ms), return op's result.

---

## Task 7: Self-rescheduling job

**Goal:** Run a job every second, but skip if the previous instance is still running.

**Requirements:**

- Function `RunPeriodic(d time.Duration, fn func(), stop <-chan struct{})`.
- Stops when `stop` closes.

**Hint:** Atomic flag for "running".

**Test:** Verify jobs don't overlap. Verify clean stop on signal.

---

## Task 8: Bounded retry

**Goal:** Retry an operation with exponential backoff, max 5 attempts.

**Requirements:**

- Function `Retry(op func() error) error`.
- Returns nil if op succeeds; returns final error if all attempts fail.
- Use jittered exponential backoff.

**Hint:** Use `AfterFunc` for each delay; coordinate via a result channel.

**Test:** Op that fails 4 times then succeeds: returns nil. Op that always fails: returns error after ~5 backoff steps.

---

## Task 9: TTL cache with one timer per entry

**Goal:** Cache with per-key TTL using individual timers.

**Requirements:**

- `Cache` with `Set(k, v, ttl)`, `Get(k)`, `Delete(k)`.
- After `ttl`, the key is removed automatically.

**Hint:** Map of `*time.Timer` keyed by string. Stop previous timer on overwrite.

**Test:** Set ~100 keys with various TTLs. Verify they expire at the right times. Verify explicit delete stops the timer.

---

## Task 10: TTL cache with single sweeper

**Goal:** Same as Task 9, but use one sweeper timer for the whole cache.

**Requirements:**

- One `*time.Timer` for the whole cache, set to the earliest expiration.
- On fire, scan and remove all expired entries; reschedule.

**Hint:** Track expirations separately from values; rearm after each fire.

**Test:** Compare memory usage vs Task 9 at 10K entries.

---

## Task 11: context.AfterFunc cleanup chain

**Goal:** Register multiple cleanups for a context, running them in reverse order on cancel.

**Requirements:**

- `Cleaner` with `Defer(fn func())` and `Run(ctx context.Context)`.
- On ctx cancel, all deferred fns run in LIFO order.

**Hint:** Use `context.AfterFunc(ctx, ...)` to register a single function that runs all the stored cleanups.

**Test:** Defer 3 cleanups (printing "a", "b", "c"). Cancel ctx. Verify output is "c b a".

---

## Task 12: Per-request deadline middleware

**Goal:** HTTP middleware that enforces a 5-second deadline per request.

**Requirements:**

- Wraps an `http.Handler`.
- Returns 504 Gateway Timeout if the inner handler exceeds 5 seconds.

**Hint:** `context.WithTimeout`. Run handler in goroutine; race on a channel.

**Test:** Slow handler (10s) returns 504. Fast handler returns the normal response.

---

## Task 13: Deferred email scheduler

**Goal:** Schedule an "email" (just a log line) to fire at a specific time.

**Requirements:**

- `Schedule(at time.Time, recipient string)`.
- Cancel via `Cancel(id)`.
- Survive restart? (bonus — persist to disk).

**Hint:** `time.AfterFunc(time.Until(at), ...)`.

**Test:** Schedule 5 emails at various times. Verify they fire in order. Cancel one. Verify others still fire.

---

## Task 14: Mocked-clock debouncer

**Goal:** Same debouncer as Task 3, but with a `Clock` interface for testing.

**Requirements:**

- Inject a `Clock` interface with `AfterFunc(d, fn) Timer`.
- Production: real time. Tests: fake clock with `Advance(d)`.

**Hint:** Define minimal `Clock` interface. Write a `realClock` and a `fakeClock`.

**Test:** Test the debouncer with the fake clock, advancing time manually. No `time.Sleep` in tests.

---

## Task 15: Earliest-deadline scheduler

**Goal:** Schedule N jobs at various times, using only one runtime timer.

**Requirements:**

- `Scheduler` with `Schedule(at time.Time, fn func())` and `Cancel(id) bool`.
- Internally use a single `*time.Timer` plus a user-space min-heap.

**Hint:** When the timer fires, process all due entries, then rearm for the next-earliest.

**Test:** Schedule 1000 jobs. Verify all fire at correct times. Verify only one runtime timer is created (count via metrics).

---

## Task 16: Observable AfterFunc wrapper

**Goal:** Wrap `time.AfterFunc` with metrics.

**Requirements:**

- Function `AfterFunc(purpose string, d time.Duration, fn func())` that updates counters.
- Counters: created, fired, stopped, panic, live (gauge), latency (histogram).
- Recovers panics.

**Hint:** Embed the wrapper in a struct; provide `Stop` and `Reset` methods.

**Test:** Use the wrapper; verify metrics update correctly. Inject a panic; verify counter increments.

---

## Task 17: Stop-vs-fire race stress test

**Goal:** Stress-test a Stop-vs-fire race; verify your code handles it.

**Requirements:**

- A component (debouncer, watchdog, or similar) you've built.
- A test that hammers it concurrently for 1 second.
- Verify no double-execution, no panic, no data race.

**Hint:** Run with `-race`. Use `atomic` counters for "fired" check.

**Test:** Run; should pass cleanly with -race.

---

## Task 18: Hashed timing wheel

**Goal:** Implement a simple single-level hashed timing wheel.

**Requirements:**

- Configurable tick width and number of buckets.
- O(1) Schedule and Cancel.
- Tick callback fires all entries in the current bucket.

**Hint:** Doubly-linked list per bucket; pointer-based remove.

**Test:** Schedule 10K entries with random delays in [0, max). Verify all fire within their bucket window.

---

## Bonus tasks

### B1. Adaptive backoff retry

Extend Task 8 to learn from previous attempts: on persistent failure, increase the initial backoff; on success, decrease.

### B2. Distributed rate limit

Build a rate limiter that coordinates across processes via Redis TTLs. Use `time.AfterFunc` only for local cleanup.

### B3. Cron-like scheduler

Parse a cron expression and use `time.AfterFunc` to fire at the right times. Handle DST, leap seconds.

### B4. Test framework integration

Integrate your `Clock` interface with `testing.T` so tests automatically use a mocked clock when run via `go test`.

### B5. Profiling tool

Build a tool that profiles a Go binary and reports timer-related metrics: live count, churn rate, top creation sites.

---

## How to verify your solutions

For each task:

1. Run with `go test -race ./...`.
2. Run with `-cpuprofile=cpu.out` and inspect for hot spots.
3. Run with `-memprofile=mem.out` and inspect for leaks.
4. Write tests using a mocked clock for determinism.

If your test sometimes fails on CI but not locally, you likely have a race. Run with `-race -count=100` to flush it out.

---

## Reference solutions

Reference implementations for each task are in the parent repository under `examples/afterfunc/`. They are not the only correct solutions; many approaches work.

When comparing your solution to the reference, ask:

- Does mine handle all the edge cases?
- Is the API as clean?
- What did I miss?
- What did I do better?

Critical reading of reference solutions is half the learning.

---

## Solution outlines

Below are brief outlines for each task. Treat as guidance; the actual implementation is yours.

### Task 1 outline

```go
done := make(chan struct{})
time.AfterFunc(time.Second, func() {
    fmt.Println("hello after 1 second")
    close(done)
})
<-done
```

### Task 2 outline

```go
func Countdown(d time.Duration, fn func()) (cancel func() bool) {
    t := time.AfterFunc(d, fn)
    return t.Stop
}
```

### Task 3 outline

```go
type Debouncer struct {
    mu sync.Mutex
    t  *time.Timer
    d  time.Duration
    fn func()
}
func (db *Debouncer) Trigger() {
    db.mu.Lock()
    defer db.mu.Unlock()
    if db.t != nil { db.t.Stop() }
    db.t = time.AfterFunc(db.d, db.fn)
}
```

### Task 4 outline

```go
type Conn struct {
    mu      sync.Mutex
    t       *time.Timer
    timeout time.Duration
    closed  bool
}
func New(timeout time.Duration) *Conn {
    c := &Conn{timeout: timeout}
    c.t = time.AfterFunc(timeout, c.fire)
    return c
}
func (c *Conn) Touch() { /* Reset */ }
func (c *Conn) Close() { /* idempotent close */ }
func (c *Conn) fire()  { /* close path */ }
```

### Task 5 outline

```go
type Watchdog struct {
    t       *time.Timer
    timeout time.Duration
    fired   atomic.Bool
    onFire  func()
}
```

### Task 6 outline

```go
func WithDeadline(d time.Duration, op func() string) (string, error) {
    type r struct{ v string; err error }
    out := make(chan r, 1)
    t := time.AfterFunc(d, func() { out <- r{err: errors.New("timeout")} })
    defer t.Stop()
    go func() { out <- r{v: op()} }()
    res := <-out
    return res.v, res.err
}
```

### Task 7 outline

```go
func RunPeriodic(d time.Duration, fn func(), stop <-chan struct{}) {
    var running atomic.Bool
    var tick func()
    tick = func() {
        if !running.CompareAndSwap(false, true) { return }
        defer running.Store(false)
        select {
        case <-stop: return
        default:
        }
        fn()
        time.AfterFunc(d, tick)
    }
    time.AfterFunc(d, tick)
}
```

### Task 8 outline

```go
func Retry(op func() error) error {
    var attempt int
    backoff := 100 * time.Millisecond
    for {
        if err := op(); err == nil {
            return nil
        }
        attempt++
        if attempt >= 5 {
            return errors.New("retries exhausted")
        }
        time.Sleep(jitter(backoff))
        backoff *= 2
    }
}
```

(Using a synchronous loop for simplicity. For an async version, use `AfterFunc` and a result channel.)

### Task 9 outline

```go
type Cache struct {
    mu     sync.Mutex
    items  map[string]string
    timers map[string]*time.Timer
}
func (c *Cache) Set(k, v string, ttl time.Duration) {
    c.mu.Lock()
    defer c.mu.Unlock()
    if t, ok := c.timers[k]; ok { t.Stop() }
    c.items[k] = v
    c.timers[k] = time.AfterFunc(ttl, func() {
        c.mu.Lock()
        delete(c.items, k)
        delete(c.timers, k)
        c.mu.Unlock()
    })
}
```

### Task 10 outline

```go
type Cache struct {
    mu     sync.Mutex
    items  map[string]entry
    timer  *time.Timer
}
type entry struct {
    v       string
    expires time.Time
}
func (c *Cache) arm() {
    var earliest time.Time
    for _, e := range c.items {
        if earliest.IsZero() || e.expires.Before(earliest) {
            earliest = e.expires
        }
    }
    if earliest.IsZero() { return }
    d := time.Until(earliest)
    if d < 0 { d = 0 }
    if c.timer == nil {
        c.timer = time.AfterFunc(d, c.sweep)
    } else {
        c.timer.Reset(d)
    }
}
func (c *Cache) sweep() { /* delete expired, rearm */ }
```

### Tasks 11-18 outlines

Similar in style. Implement; compare with reference if available.

---

## Bonus: a self-test

After completing the tasks, take the self-test in `interview.md`. If you can answer 30+ questions confidently, you're senior-level.

---

## Bonus: write your own task

Once you've completed all 18, design your own task. What pattern have you seen in production that you haven't built? Build it. The exercise of designing is itself a learning step.

End of tasks.
