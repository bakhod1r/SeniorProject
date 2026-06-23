---
layout: default
title: Find Bug
parent: Exponential Backoff
grand_parent: Time-Based Concurrency
ancestor: Go
nav_order: 9
has_children: false
permalink: /roadmap/programming-languages/golang/07-concurrency/16-time-based-concurrency/04-exponential-backoff/find-bug/
---

# Exponential Backoff — Find The Bug

12 snippets. Each compiles. Each has a bug. Find it before reading the answer.

---

## Bug 1

```go
package main

import (
    "errors"
    "fmt"
    "time"
)

func callRemote() error {
    return errors.New("transient")
}

func main() {
    for {
        err := callRemote()
        if err == nil {
            fmt.Println("success")
            return
        }
        fmt.Printf("failed: %v, retrying\n", err)
        time.Sleep(1 * time.Second)
    }
}
```

### Bug

Infinite loop. No `maxAttempts`. If `callRemote` keeps failing, the program never returns. Also constant backoff (no exponential), no context support, no transient/permanent distinction.

### Fix

```go
const maxAttempts = 5
for attempt := 0; attempt < maxAttempts; attempt++ {
    err := callRemote()
    if err == nil { return }
    if attempt < maxAttempts-1 {
        time.Sleep(time.Duration(1<<attempt) * 100 * time.Millisecond)
    }
}
fmt.Println("gave up")
```

---

## Bug 2

```go
func Retry(op func() error, maxAttempts int, base time.Duration) error {
    var lastErr error
    for attempt := 0; attempt < maxAttempts; attempt++ {
        err := op()
        if err == nil {
            return nil
        }
        lastErr = err
        time.Sleep(base * time.Duration(1<<attempt))
    }
    return lastErr
}
```

### Bug

Sleeps after the last attempt unnecessarily. With `maxAttempts = 5` and `base = 100ms`, the user waits an extra `1600ms` before seeing "gave up".

### Fix

```go
if attempt < maxAttempts-1 {
    time.Sleep(base * time.Duration(1<<attempt))
}
```

---

## Bug 3

```go
func Retry(op func() error, maxAttempts int, base time.Duration) error {
    for attempt := 0; attempt < maxAttempts; attempt++ {
        err := op()
        if err == nil {
            return nil
        }
        if attempt < maxAttempts-1 {
            time.Sleep(base * time.Duration(1<<attempt))
        }
    }
    return errors.New("retry exhausted")
}
```

### Bug

The last error is discarded. The caller sees "retry exhausted" with no information about *why* the operation failed. Cannot `errors.Is` against the underlying error.

### Fix

```go
return fmt.Errorf("after %d attempts: %w", maxAttempts, lastErr)
```

(Preserve and wrap the last error.)

---

## Bug 4

```go
func Retry(ctx context.Context, op func() error, maxAttempts int, base, maxDelay time.Duration) error {
    var lastErr error
    for attempt := 0; attempt < maxAttempts; attempt++ {
        err := op()
        if err == nil {
            return nil
        }
        lastErr = err
        if attempt < maxAttempts-1 {
            d := base * time.Duration(1<<attempt)
            if d > maxDelay {
                d = maxDelay
            }
            time.Sleep(d)
        }
    }
    return lastErr
}
```

### Bug

`time.Sleep` is not cancellable. If the caller cancels `ctx`, the loop continues sleeping. The cancellation has no effect.

### Fix

Use a `select` with `time.NewTimer` and `ctx.Done()`:

```go
t := time.NewTimer(d)
select {
case <-t.C:
case <-ctx.Done():
    t.Stop()
    return ctx.Err()
}
```

---

## Bug 5

```go
func Retry(op func() error, maxAttempts int, base, maxDelay time.Duration) error {
    for attempt := 0; attempt < maxAttempts; attempt++ {
        err := op()
        if err == nil {
            return nil
        }
        if attempt < maxAttempts-1 {
            d := base * time.Duration(1<<attempt)
            time.Sleep(d)
        }
    }
    return errors.New("exhausted")
}
```

### Bug

`1 << attempt` overflows when `attempt = 63`. `1 << 63` is `MinInt64`, a negative duration. `time.Sleep(negative)` returns immediately. The retry loop spins as fast as possible.

Even with `maxAttempts < 63`, you might pass a large `maxAttempts` from configuration; the bug surfaces.

### Fix

Guard against overflow:

```go
d := base * time.Duration(1<<attempt)
if d > maxDelay || d < 0 {
    d = maxDelay
}
```

Or cap `attempt`:

```go
if attempt > 30 {
    // saturate
    d = maxDelay
}
```

---

## Bug 6

```go
func Retry(op func() error, maxAttempts int, base time.Duration) error {
    for attempt := 0; attempt < maxAttempts; attempt++ {
        err := op()
        if err == nil {
            return nil
        }
        if attempt < maxAttempts-1 {
            select {
            case <-time.After(base * time.Duration(1<<attempt)):
            }
        }
    }
    return errors.New("exhausted")
}
```

### Bug

`time.After` creates a new timer per call that is not garbage-collected until it fires. In a tight retry loop with high failure rate, this leaks timers. Memory grows.

### Fix

Use `time.NewTimer` with `Stop`:

```go
t := time.NewTimer(d)
<-t.C
// or in a select with t.Stop() to drain
```

---

## Bug 7

```go
func RetryHTTP(url string) ([]byte, error) {
    var body []byte
    for attempt := 0; attempt < 5; attempt++ {
        resp, err := http.Get(url)
        if err == nil && resp.StatusCode == 200 {
            body, err = io.ReadAll(resp.Body)
            return body, err
        }
        time.Sleep(time.Duration(1<<attempt) * 100 * time.Millisecond)
    }
    return nil, errors.New("failed")
}
```

### Bug

`resp.Body` is never closed when status is not 200. File descriptor leak. After enough retries (especially during outages), the process runs out of fds.

Also: 4xx errors retried; should be surfaced immediately. And no context support.

### Fix

```go
resp, err := http.Get(url)
if resp != nil {
    defer resp.Body.Close() // always close
}
if err != nil || resp.StatusCode >= 500 {
    // retryable
    continue
}
if resp.StatusCode >= 400 {
    return nil, fmt.Errorf("status %d", resp.StatusCode) // permanent
}
```

---

## Bug 8

```go
func Retry(op func() error, maxAttempts int, base, maxDelay time.Duration) error {
    var rng = rand.New(rand.NewSource(time.Now().UnixNano()))
    for attempt := 0; attempt < maxAttempts; attempt++ {
        err := op()
        if err == nil {
            return nil
        }
        if attempt < maxAttempts-1 {
            d := base * time.Duration(1<<attempt)
            if d > maxDelay { d = maxDelay }
            jitter := time.Duration(rng.Int63n(int64(d)))
            time.Sleep(jitter)
        }
    }
    return errors.New("exhausted")
}
```

### Bug

If `Retry` is called concurrently from multiple goroutines, each call creates its own `*rand.Rand`. Per call this is safe — but creating a new `*rand.Rand` with `time.Now().UnixNano()` from multiple goroutines at the same nanosecond means *identical* random sequences.

In practice, modern Go's clock has high enough resolution that this is rare. But if you seed at startup once globally and share, you have a different problem: `*rand.Rand` is not concurrent-safe.

The "right" answer in Go 1.20+ is to use the package-level `rand.Int63n` which is concurrent-safe and auto-seeded.

### Fix

```go
import "math/rand"

// no manual rand.New; use the global functions:
jitter := time.Duration(rand.Int63n(int64(d)))
```

---

## Bug 9

```go
func Retry(ctx context.Context, op func() error, maxAttempts int, base time.Duration) error {
    for attempt := 0; attempt < maxAttempts; attempt++ {
        err := op() // ctx not passed to op!
        if err == nil {
            return nil
        }
        if attempt < maxAttempts-1 {
            t := time.NewTimer(base * time.Duration(1<<attempt))
            select {
            case <-t.C:
            case <-ctx.Done():
                return ctx.Err()
            }
            t.Stop()
        }
    }
    return errors.New("exhausted")
}
```

### Bug

`ctx` is accepted but never passed to `op`. If `op` makes an HTTP/RPC call that should respect the deadline, it cannot. The operation runs past the deadline.

### Fix

```go
func Retry(ctx context.Context, op func(context.Context) error, ...) error {
    // ...
    err := op(ctx) // pass it through
    // ...
}
```

---

## Bug 10

```go
import "github.com/sony/gobreaker"

func RetryWithBreaker(breaker *gobreaker.CircuitBreaker, op func() error, maxAttempts int, base time.Duration) error {
    for attempt := 0; attempt < maxAttempts; attempt++ {
        _, err := breaker.Execute(func() (interface{}, error) {
            return nil, op()
        })
        if err == nil {
            return nil
        }
        if attempt < maxAttempts-1 {
            time.Sleep(base * time.Duration(1<<attempt))
        }
    }
    return errors.New("exhausted")
}
```

### Bug

Each retry calls `breaker.Execute`, which records each failure into the breaker's count. With `maxAttempts = 5` and one failing operation, the breaker sees 5 failures — much faster opening than intended.

Also: when the breaker is open, the retry continues to call `Execute`, which returns `ErrOpenState`. The retry treats it as transient and retries. Spinning loop until exhausted.

### Fix

1. Either wrap the entire retry loop with `breaker.Execute` so the breaker sees one event:

```go
breaker.Execute(func() (interface{}, error) {
    return nil, Retry(op, ...)
})
```

2. Or check the breaker state before each attempt and treat `ErrOpenState` as permanent:

```go
if errors.Is(err, gobreaker.ErrOpenState) {
    return err // do not retry
}
```

---

## Bug 11

```go
func Retry(ctx context.Context, op func(context.Context) error, maxAttempts int, base, maxDelay time.Duration) error {
    var lastErr error
    for attempt := 0; attempt < maxAttempts; attempt++ {
        err := op(ctx)
        if err == nil {
            return nil
        }
        lastErr = err
        if attempt < maxAttempts-1 {
            d := base * time.Duration(1<<attempt)
            if d > maxDelay {
                d = maxDelay
            }
            t := time.NewTimer(d)
            defer t.Stop()
            select {
            case <-t.C:
            case <-ctx.Done():
                return ctx.Err()
            }
        }
    }
    return fmt.Errorf("after %d attempts: %w", maxAttempts, lastErr)
}
```

### Bug

`defer t.Stop()` is inside the `for` loop. Each iteration adds a deferred call. They all execute at function return. For 100 attempts, 100 deferred Stops queued — small but unbounded.

More dangerously: if the retry actually takes 100 attempts, the deferred Stops queue grows. While these timers are not leaked (they fire and exit), the defer queue itself uses stack memory.

### Fix

Move `defer t.Stop()` outside the loop, or use a single timer with `Reset`:

```go
t := time.NewTimer(0)
defer t.Stop()
if !t.Stop() { <-t.C }
for ... {
    // ...
    t.Reset(d)
    select { case <-t.C: case <-ctx.Done(): return ctx.Err() }
}
```

---

## Bug 12

```go
func RetryPost(url string, body []byte) ([]byte, error) {
    bodyReader := bytes.NewReader(body)
    for attempt := 0; attempt < 5; attempt++ {
        req, _ := http.NewRequest("POST", url, bodyReader)
        resp, err := http.DefaultClient.Do(req)
        if err == nil && resp.StatusCode == 200 {
            defer resp.Body.Close()
            return io.ReadAll(resp.Body)
        }
        if resp != nil {
            resp.Body.Close()
        }
        time.Sleep(100 * time.Millisecond * time.Duration(1<<attempt))
    }
    return nil, errors.New("failed")
}
```

### Bug

`bodyReader` is consumed on the first attempt. After that, `bodyReader.Read` returns `io.EOF`. The retry's request body is empty.

### Fix

Create a fresh reader each iteration:

```go
for attempt := 0; attempt < 5; attempt++ {
    req, _ := http.NewRequest("POST", url, bytes.NewReader(body))
    // ...
}
```

The `body []byte` is unchanged; only the reader is fresh.

---

## Bonus Bug 13

```go
func Retry(ctx context.Context, op func() error, maxAttempts int, base, maxDelay time.Duration, budget *rate.Limiter) error {
    var lastErr error
    for attempt := 0; attempt < maxAttempts; attempt++ {
        if attempt > 0 {
            if err := budget.Wait(ctx); err != nil {
                return err
            }
        }
        err := op()
        if err == nil {
            return nil
        }
        lastErr = err
        if attempt < maxAttempts-1 {
            d := base * time.Duration(1<<attempt)
            if d > maxDelay { d = maxDelay }
            time.Sleep(d)
        }
    }
    return fmt.Errorf("after %d attempts: %w", maxAttempts, lastErr)
}
```

### Bug

`budget.Wait(ctx)` is called *before* checking whether the operation succeeded. If the first attempt fails, the budget is consumed before the retry is even decided. Subsequent slot needed even if classify-permanent.

Also: `budget.Wait` blocks until a token is available. If the budget is exhausted, the retry blocks indefinitely (subject to `ctx`). For a retry budget, you usually want non-blocking `Allow()` — fail fast if no token.

### Fix

```go
if !budget.Allow() {
    return fmt.Errorf("budget exhausted: %w", lastErr)
}
```

Place this check *between* the failure and the next attempt, not before the operation.

---

## Summary

Common bug categories:

1. **Infinite loops** (Bug 1): no `maxAttempts`.
2. **Sleep after last attempt** (Bug 2): wastes time.
3. **Lost error info** (Bug 3): use `%w`.
4. **Non-cancellable sleep** (Bug 4): use `select` with `ctx.Done`.
5. **Overflow** (Bug 5): cap before shift.
6. **`time.After` leak** (Bug 6): use `time.NewTimer`.
7. **Unclosed response body** (Bug 7): always defer Close.
8. **Random seed problems** (Bug 8): use global `math/rand`.
9. **Context not passed to op** (Bug 9): pass through.
10. **Breaker thrash** (Bug 10): wrap whole sequence in `Execute`.
11. **Deferred Stop in loop** (Bug 11): move out or use Reset.
12. **Body consumed once** (Bug 12): fresh reader per attempt.
13. **Budget blocking** (Bug 13): use `Allow()` not `Wait()`.

Reading and fixing real-world retry bugs is the fastest way to internalise the patterns.
