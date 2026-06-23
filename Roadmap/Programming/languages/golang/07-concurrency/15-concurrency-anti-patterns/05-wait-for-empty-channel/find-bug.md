---
layout: default
title: Find Bug
parent: Wait for Empty Channel
grand_parent: Concurrency Anti-Patterns
ancestor: Go
nav_order: 8
permalink: /roadmap/programming-languages/golang/07-concurrency/15-concurrency-anti-patterns/05-wait-for-empty-channel/find-bug/
---

# Wait-for-Empty-Channel — Find the Bug

Twelve snippets. Each has at least one instance of the wait-for-empty-channel anti-pattern (or a close cousin). For each:

1. Identify the bug.
2. Explain why it is wrong.
3. Provide a refactored version.

Try to find the bug before reading the answer.

---

## Snippet 1: Classic Polling

```go
package main

import (
    "fmt"
    "time"
)

func main() {
    jobs := make(chan int, 50)
    for i := 0; i < 50; i++ {
        go func(i int) {
            jobs <- i * i
        }(i)
    }

    for len(jobs) > 0 {
        time.Sleep(time.Millisecond)
        fmt.Println(<-jobs)
    }
}
```

### Bug

The `for len(jobs) > 0` loop polls the channel length. Two issues: (1) the producers may not have sent yet when the loop first checks, so `len == 0` and the program exits without printing anything; (2) even if some sends have happened, the race between `len` and concurrent sends means values can be missed.

### Fix

```go
func main() {
    jobs := make(chan int)
    var wg sync.WaitGroup
    wg.Add(50)
    for i := 0; i < 50; i++ {
        go func(i int) {
            defer wg.Done()
            jobs <- i * i
        }(i)
    }
    go func() {
        wg.Wait()
        close(jobs)
    }()
    for v := range jobs {
        fmt.Println(v)
    }
}
```

---

## Snippet 2: Select with Default Polling

```go
func worker(jobs <-chan int) {
    for {
        select {
        case j := <-jobs:
            process(j)
        default:
            if len(jobs) == 0 {
                return
            }
            time.Sleep(time.Millisecond)
        }
    }
}
```

### Bug

The `select` with `default` plus a `len(jobs) == 0` check creates a polling loop. When the channel is briefly empty between sends, the default branch runs, the length is zero, the worker returns prematurely.

### Fix

```go
func worker(jobs <-chan int) {
    for j := range jobs {
        process(j)
    }
}
```

Producer must close the channel.

---

## Snippet 3: Polling with Sleep Backoff

```go
func waitFor(done *int32) {
    backoff := time.Millisecond
    for atomic.LoadInt32(done) == 0 {
        time.Sleep(backoff)
        if backoff < time.Second {
            backoff *= 2
        }
    }
}
```

### Bug

Polling an atomic counter with exponential backoff. Same race-free for the atomic itself, but the polling is wasteful and lacks composability. There is no way to cancel `waitFor` from outside.

### Fix

```go
func waitFor(ctx context.Context, done <-chan struct{}) error {
    select {
    case <-done:
        return nil
    case <-ctx.Done():
        return ctx.Err()
    }
}
```

The caller closes `done` when ready. Context provides cancellation.

---

## Snippet 4: Shutdown Polling

```go
type Server struct {
    jobs chan Job
    stop atomic.Int32
}

func (s *Server) Shutdown() {
    s.stop.Store(1)
    for len(s.jobs) > 0 {
        time.Sleep(10 * time.Millisecond)
    }
}
```

### Bug

`len(s.jobs) > 0` polls the queue depth, which is a race condition with workers that have already pulled jobs but are still processing them. Workers might be mid-process while `len(s.jobs) == 0`, and Shutdown returns thinking all work is done.

### Fix

```go
type Server struct {
    jobs chan Job
    wg   sync.WaitGroup
}

func (s *Server) Shutdown() {
    close(s.jobs)  // workers exit when buffer drained
    s.wg.Wait()    // wait for workers to finish current jobs
}

// each worker:
defer s.wg.Done()
for j := range s.jobs {
    process(j)
}
```

---

## Snippet 5: Wait for Arrival

```go
func receive(ch <-chan int) int {
    for len(ch) == 0 {
        time.Sleep(time.Millisecond)
    }
    return <-ch
}
```

### Bug

Polling for arrival, then receiving. The polling is unnecessary: `<-ch` blocks until a value arrives. The polling adds CPU waste and a latency tail (up to 1 ms per call).

### Fix

```go
func receive(ch <-chan int) int {
    return <-ch
}
```

If cancellation is desired:

```go
func receive(ctx context.Context, ch <-chan int) (int, error) {
    select {
    case v := <-ch:
        return v, nil
    case <-ctx.Done():
        return 0, ctx.Err()
    }
}
```

---

## Snippet 6: Cap-Equals-Len Polling

```go
func send(ch chan<- int, v int) {
    for len(ch) == cap(ch) {
        time.Sleep(time.Millisecond)
    }
    ch <- v
}
```

### Bug

Polling for room in the buffer, then sending. Same family as Snippet 5. The send blocks naturally; polling is wasteful and racy.

### Fix

```go
func send(ctx context.Context, ch chan<- int, v int) error {
    select {
    case ch <- v:
        return nil
    case <-ctx.Done():
        return ctx.Err()
    }
}
```

---

## Snippet 7: Race in WaitGroup-Plus-Polling

```go
func process(items []int) {
    var wg sync.WaitGroup
    jobs := make(chan int, len(items))
    for _, item := range items {
        wg.Add(1)
        go func(item int) {
            defer wg.Done()
            jobs <- item * 2
        }(item)
    }
    for len(jobs) < len(items) {
        time.Sleep(time.Millisecond)
    }
    close(jobs)
    for v := range jobs {
        fmt.Println(v)
    }
}
```

### Bug

Polls `len(jobs) < len(items)` instead of using the WaitGroup that is already in place. The polling is redundant and racy.

### Fix

```go
func process(items []int) {
    var wg sync.WaitGroup
    jobs := make(chan int)
    for _, item := range items {
        wg.Add(1)
        go func(item int) {
            defer wg.Done()
            jobs <- item * 2
        }(item)
    }
    go func() {
        wg.Wait()
        close(jobs)
    }()
    for v := range jobs {
        fmt.Println(v)
    }
}
```

---

## Snippet 8: Concurrent Map with Polling

```go
var m sync.Map

func waitForKey(key string) interface{} {
    for {
        if v, ok := m.Load(key); ok {
            return v
        }
        time.Sleep(time.Millisecond)
    }
}
```

### Bug

Polling a `sync.Map` for a key. The map is correctly synchronised, but the polling itself is the anti-pattern: CPU waste, latency tail, no cancellation.

### Fix

Use a channel or `sync.Once` plus a done channel:

```go
var (
    initOnce sync.Once
    initDone = make(chan struct{})
    value    interface{}
)

func setValue(v interface{}) {
    initOnce.Do(func() {
        value = v
        close(initDone)
    })
}

func waitForValue(ctx context.Context) (interface{}, error) {
    select {
    case <-initDone:
        return value, nil
    case <-ctx.Done():
        return nil, ctx.Err()
    }
}
```

---

## Snippet 9: Multi-Channel Polling

```go
func waitForAll(a, b, c <-chan int) {
    for len(a) > 0 || len(b) > 0 || len(c) > 0 {
        time.Sleep(time.Millisecond)
    }
}
```

### Bug

Polls three channels simultaneously. The race window is wider; the bug is more obvious but the fix is the same.

### Fix

Use WaitGroups for each producer, or close-and-range for each:

```go
func waitForAll(a, b, c <-chan int) {
    for range a {
    }
    for range b {
    }
    for range c {
    }
}
```

This assumes the producers close their channels. To process values, replace the empty for-range with handlers.

To wait on all three concurrently:

```go
func waitForAll(a, b, c <-chan int) {
    var wg sync.WaitGroup
    wg.Add(3)
    drain := func(ch <-chan int) {
        defer wg.Done()
        for range ch {
        }
    }
    go drain(a)
    go drain(b)
    go drain(c)
    wg.Wait()
}
```

---

## Snippet 10: Timestamp Polling

```go
var lastEvent time.Time

func recordEvent() {
    lastEvent = time.Now()
}

func waitForQuiet() {
    for time.Since(lastEvent) < 100*time.Millisecond {
        time.Sleep(10 * time.Millisecond)
    }
}
```

### Bug

The `lastEvent` is shared mutable state without synchronisation (data race). The polling itself is wasteful.

### Fix

```go
type Quiet struct {
    settle  time.Duration
    events  chan struct{}
}

func New(settle time.Duration) *Quiet {
    return &Quiet{
        settle: settle,
        events: make(chan struct{}, 1),
    }
}

func (q *Quiet) Event() {
    select {
    case q.events <- struct{}{}:
    default:
    }
}

func (q *Quiet) Wait(ctx context.Context) error {
    timer := time.NewTimer(q.settle)
    defer timer.Stop()
    for {
        select {
        case <-ctx.Done():
            return ctx.Err()
        case <-q.events:
            if !timer.Stop() {
                <-timer.C
            }
            timer.Reset(q.settle)
        case <-timer.C:
            return nil
        }
    }
}
```

---

## Snippet 11: Goroutine Leak from Polling

```go
func startWorker(jobs <-chan int) chan struct{} {
    done := make(chan struct{})
    go func() {
        for len(jobs) > 0 {
            j := <-jobs
            process(j)
        }
        close(done)
    }()
    return done
}
```

### Bug

If `len(jobs) == 0` when the loop first runs, the goroutine exits immediately without processing anything. If `len(jobs) > 0` but a concurrent receive happens before this goroutine's receive, the receive blocks (because the channel is empty between sends) and the goroutine is stuck.

### Fix

```go
func startWorker(jobs <-chan int) <-chan struct{} {
    done := make(chan struct{})
    go func() {
        defer close(done)
        for j := range jobs {
            process(j)
        }
    }()
    return done
}
```

The caller closes `jobs` to signal "no more work." The worker drains and exits cleanly.

---

## Snippet 12: Hidden Polling in a Library Wrapper

```go
type EventBus struct {
    events chan Event
}

func (b *EventBus) Drain() {
    for {
        n := len(b.events)
        if n == 0 {
            return
        }
        for i := 0; i < n; i++ {
            <-b.events
        }
    }
}
```

### Bug

The outer loop polls `len(b.events)`. Even within a single iteration, the inner loop is correct (it receives exactly `n` items), but between iterations new events may arrive, and the check `n == 0` may incorrectly conclude "all events drained" while a sender is queueing one more.

### Fix

```go
type EventBus struct {
    events chan Event
}

func (b *EventBus) Close() {
    close(b.events)
}

func (b *EventBus) Drain() {
    for range b.events {
        // handle event, or discard
    }
}
```

Producer must close the channel when no more events will be sent. Drain ranges until the channel is closed and empty.

---

## Closing

These twelve snippets cover the major shapes of the anti-pattern: classic `len > 0`, `select`/`default` polling, polling with backoff, shutdown polling, polling for arrival, capacity polling, redundant polling (with WaitGroup already in place), concurrent map polling, multi-channel polling, timestamp polling, leak-prone polling, and library-wrapper polling.

Recognising these shapes at sight is the senior bar. Pair-review them with a colleague and discuss the refactor for each.

If you can find the bug in all twelve within five minutes, you have the eye for this anti-pattern. Apply the same eye in your daily code review.
