---
layout: default
title: Find the Bug
parent: Batching
grand_parent: Production Patterns
ancestor: Go
nav_order: 9
has_children: false
permalink: /roadmap/programming-languages/golang/07-concurrency/18-production-patterns/03-batching/find-bug/
---

# Batching — Find the Bug

> Each snippet contains a real concurrency or batching bug: a lost flush, a double flush, a race, a deadlock on close, an aliasing bug, or a misuse of a primitive. Find it, explain it, fix it.

---

## Bug 1 — Lost final flush

```go
func (b *Batcher) run() {
    buf := make([]int, 0, b.maxSize)
    ticker := time.NewTicker(b.maxDelay)
    defer ticker.Stop()
    for {
        select {
        case item, ok := <-b.in:
            if !ok {
                return // <-- BUG
            }
            buf = append(buf, item)
            if len(buf) >= b.maxSize {
                b.sink.Write(buf)
                buf = buf[:0]
            }
        case <-ticker.C:
            if len(buf) > 0 {
                b.sink.Write(buf)
                buf = buf[:0]
            }
        }
    }
}
```

**Bug.** When the input channel is closed, the run loop returns without flushing the remaining buffer contents. Up to `maxSize - 1` items are silently lost.

**Fix.**

```go
if !ok {
    if len(buf) > 0 {
        b.sink.Write(buf)
    }
    return
}
```

---

## Bug 2 — Buffer aliasing

```go
func (b *Batcher) flush() {
    if len(b.buf) == 0 {
        return
    }
    b.sink.Write(b.buf)
    b.buf = b.buf[:0]
}
```

```go
type RecordingSink struct {
    mu      sync.Mutex
    batches [][]int
}

func (r *RecordingSink) Write(batch []int) error {
    r.mu.Lock()
    defer r.mu.Unlock()
    r.batches = append(r.batches, batch) // <-- alias!
    return nil
}
```

**Bug.** The batcher hands its internal slice to the sink. The sink stores it. On the next flush, the batcher reuses the underlying array; all stored slices now show the latest batch's contents.

**Fix.** Defensive copy:

```go
batch := make([]int, len(b.buf))
copy(batch, b.buf)
b.sink.Write(batch)
```

Or: have the sink copy on receive (less idiomatic; the producer should not assume).

---

## Bug 3 — Producer closes the channel

```go
type Producer struct{ b *Batcher }

func (p *Producer) Done() {
    close(p.b.in) // <-- BUG
}

// Elsewhere:
p.b.Add(item)
// ...
p.Done()
// ...
p.b.Add(item) // PANIC: send on closed channel
```

**Bug.** Producer closes the batcher's input channel. Other code paths (or the same caller later) try to send and panic.

**Fix.** Only the orchestrator (the code that constructed the batcher) closes the channel, and only inside `Shutdown` or `Close`. Producers never call close.

---

## Bug 4 — Reset before flush

```go
case item, ok := <-b.in:
    if !ok { return }
    buf = append(buf, item)
    if len(buf) >= b.maxSize {
        buf = buf[:0] // <-- BUG
        b.sink.Write(buf)
    }
```

**Bug.** The buffer is reset *before* the flush, so the sink receives an empty slice.

**Fix.** Order matters: flush, *then* reset.

```go
if len(buf) >= b.maxSize {
    b.sink.Write(buf)
    buf = buf[:0]
}
```

---

## Bug 5 — `defer ticker.Stop()` missing

```go
func (b *Batcher) run() {
    buf := make([]int, 0, b.maxSize)
    ticker := time.NewTicker(b.maxDelay) // <-- BUG: no Stop
    for {
        select {
        case item := <-b.in:
            buf = append(buf, item)
            // ...
        case <-ticker.C:
            // ...
        }
    }
}
```

**Bug.** The ticker is never stopped. Each batcher created leaks runtime timer state. Over time, this manifests as memory growth.

**Fix.** `defer ticker.Stop()` immediately after `time.NewTicker`.

---

## Bug 6 — Wrong channel close detection

```go
case item := <-b.in: // <-- one-value form
    buf = append(buf, item)
```

**Bug.** Without the two-value receive form, a closed channel produces zero values forever. The batcher appends zero-valued items endlessly.

**Fix.** Two-value receive:

```go
case item, ok := <-b.in:
    if !ok {
        // flush and return
    }
```

---

## Bug 7 — Mutex around channel

```go
func (b *Batcher) Add(item int) {
    b.mu.Lock()
    defer b.mu.Unlock()
    b.in <- item
}
```

**Bug.** If `b.in` is full, the send blocks while holding the mutex. The consumer cannot empty the channel because... actually it can, but other producers cannot enqueue. Result: lock contention, reduced throughput.

**Fix.** Channels are already thread-safe. Drop the mutex.

```go
func (b *Batcher) Add(item int) { b.in <- item }
```

---

## Bug 8 — Double close panic

```go
func (b *Batcher) Close() {
    close(b.in)
    <-b.done
}

// Caller:
b.Close()
b.Close() // PANIC: close of closed channel
```

**Bug.** `close` is not idempotent. Two calls to `Close` panic.

**Fix.** `sync.Once`:

```go
func (b *Batcher) Close() {
    b.closeOnce.Do(func() { close(b.in) })
    <-b.done
}
```

---

## Bug 9 — Shared buffer mutation after flush

```go
case <-ticker.C:
    if len(buf) > 0 {
        go b.sink.Write(buf) // <-- BUG: goroutine; buf is reused
        buf = buf[:0]
    }
```

**Bug.** The flush is spawned in a goroutine. The next iteration of the run loop reuses `buf` while the goroutine is still reading it. Race.

**Fix.** Either flush synchronously, or copy before goroutine:

```go
batch := make([]int, len(buf))
copy(batch, buf)
go b.sink.Write(batch)
buf = buf[:0]
```

Better: use a flush worker via a channel, not a fresh goroutine per flush.

---

## Bug 10 — Time trigger flushes empty buffer

```go
case <-ticker.C:
    b.sink.Write(buf) // <-- BUG: empty buffer too
    buf = buf[:0]
```

**Bug.** Every tick flushes, even when buf is empty. The sink gets an empty slice; downstream wastes a call.

**Fix.** Guard:

```go
case <-ticker.C:
    if len(buf) > 0 {
        b.sink.Write(buf)
        buf = buf[:0]
    }
```

---

## Bug 11 — `Add` after `Shutdown` panics

```go
func (b *Batcher) Add(item int) { b.in <- item }

func (b *Batcher) Shutdown(ctx context.Context) error {
    close(b.in)
    <-b.done
    return nil
}

// Caller:
go b.Add(1)
b.Shutdown(ctx) // closes b.in
// b.Add still running: PANIC
```

**Bug.** Producer calls `Add` after `Shutdown` closed the channel. Send on closed channel panics.

**Fix.** Have `Add` check a separate `closeCh`:

```go
func (b *Batcher) Add(item int) error {
    select {
    case <-b.closeCh:
        return ErrClosed
    case b.in <- item:
        return nil
    }
}

func (b *Batcher) Shutdown(ctx context.Context) error {
    b.closeOnce.Do(func() {
        close(b.closeCh) // signals Add to return ErrClosed
        close(b.in)
    })
    <-b.done
    return nil
}
```

The double-select on `closeCh` plus `b.in` makes Add safe.

---

## Bug 12 — Retry inside the run loop

```go
case item, ok := <-b.in:
    if !ok { return }
    buf = append(buf, item)
    if len(buf) >= b.maxSize {
        for i := 0; i < 5; i++ {
            err := b.sink.Write(buf)
            if err == nil { break }
            time.Sleep(time.Second) // <-- BUG: blocks run loop
        }
        buf = buf[:0]
    }
```

**Bug.** The run loop is blocked for up to 5 seconds during retries. Producers' Add blocks (or 503s). The time trigger doesn't fire. Throughput craters.

**Fix.** Move retries to a separate goroutine (flush worker), or wrap the sink with a retry decorator that handles retries asynchronously. The run loop should never spin or sleep.

---

## Bug 13 — Hash of Item used as key, but Item not hashable

```go
type Item struct {
    Data []byte
}

bufs := map[Item][]Item{} // <-- BUG: Item not comparable
```

**Bug.** Go map keys must be comparable. Structs with slice fields are not comparable. Compile-time error or, if you use `any` for the key, a runtime error.

**Fix.** Use a string or other comparable type as the key:

```go
bufs := map[string][]Item{}
// Index by item.TenantID or similar
```

---

## Bug 14 — Ticker drift assumed to be zero

```go
ticker := time.NewTicker(100 * time.Millisecond)
for {
    select {
    case <-ticker.C:
        // Assume exactly 100 ms has passed since last tick.
        // This is FALSE if the previous iteration took longer than 100 ms.
    }
}
```

**Bug.** `time.Ticker` fires on a fixed schedule. If your iteration takes 200 ms, the next tick was queued during your work and is ready immediately. Multiple ticks coalesce to one (the channel is buffered with cap 1).

**Fix.** If you need "exactly D since last operation", use `time.Timer.Reset()`. The ticker is fine for most batchers because the time trigger has soft semantics.

---

## Bug 15 — Map iteration order assumption

```go
for tenant, buf := range bufs {
    flush(tenant, buf) // Order is undefined!
}
```

**Bug.** Go's map iteration is randomised. If the sink requires a specific tenant ordering, this is wrong.

**Fix.** Sort the keys:

```go
tenants := make([]string, 0, len(bufs))
for t := range bufs {
    tenants = append(tenants, t)
}
sort.Strings(tenants)
for _, t := range tenants {
    flush(t, bufs[t])
}
```

---

## Bug 16 — `select` randomisation surprise

```go
for {
    select {
    case <-ticker.C:
        // Time trigger
    case item := <-b.in:
        // Item
    }
}
```

This is correct. But the order of cases does not affect priority. If both are ready, `select` picks randomly.

If a test relies on "ticker fires first because it is first in the select", it is wrong. The test will pass most of the time and fail occasionally.

**Lesson.** Never assume select case ordering. If you need priority, use nested selects or explicit precedence.

---

## Bug 17 — Channel as a "set" of items

```go
seen := make(chan int, 1000)
// Producer:
seen <- item

// Consumer:
for item := range seen {
    process(item)
}
```

If the intent was deduplication, this does not work — duplicates remain. A channel preserves all sends.

**Fix.** Use a map for dedup; channel for queueing.

---

## Bug 18 — `time.NewTicker(0)` panic

```go
delay := 0 * time.Millisecond
ticker := time.NewTicker(delay) // PANIC
```

**Bug.** `NewTicker(d)` panics if `d <= 0`. A misconfigured `MaxBatchDelay = 0` brings down the batcher.

**Fix.** Validate inputs in `New`:

```go
if maxDelay <= 0 {
    return nil, errors.New("maxDelay must be positive")
}
```

---

## Bug 19 — Context not propagated

```go
func (b *Batcher) flush(buf []int) {
    b.sink.Write(context.Background(), buf) // <-- BUG: forever ctx
}
```

**Bug.** The flush has no timeout. A hung sink hangs the run loop forever.

**Fix.**

```go
ctx, cancel := context.WithTimeout(context.Background(), b.flushTimeout)
defer cancel()
b.sink.Write(ctx, buf)
```

---

## Bug 20 — Goroutine leak on construction failure

```go
func New(...) (*Batcher, error) {
    b := &Batcher{...}
    go b.run() // <-- Started before validation
    if maxSize <= 0 {
        return nil, errors.New("invalid")
    }
    return b, nil
}
```

**Bug.** If validation fails, the goroutine leaks. The caller has no way to stop it (no batcher reference).

**Fix.** Validate before starting goroutines:

```go
func New(...) (*Batcher, error) {
    if maxSize <= 0 {
        return nil, errors.New("invalid")
    }
    b := &Batcher{...}
    go b.run()
    return b, nil
}
```

---

## Bug 21 — Race on stats fields

```go
type Batcher struct {
    enqueued int64
}

func (b *Batcher) Add(item int) {
    b.in <- item
    b.enqueued++ // <-- Race
}

func (b *Batcher) Stats() int64 {
    return b.enqueued // <-- Race
}
```

**Bug.** Concurrent Add calls race on `enqueued`. Run with `-race`; see the report.

**Fix.** Use `atomic.Int64`:

```go
type Batcher struct {
    enqueued atomic.Int64
}

func (b *Batcher) Add(item int) {
    b.in <- item
    b.enqueued.Add(1)
}

func (b *Batcher) Stats() int64 {
    return b.enqueued.Load()
}
```

---

## Bug 22 — Wrong size of cap

```go
buf := make([]int, b.maxSize, b.maxSize) // <-- len = maxSize, cap = maxSize
```

**Bug.** The buffer is *already full* of zero values. The first `append` puts items at index `maxSize`, growing the underlying array. The size check `len(buf) >= maxSize` is true on the first iteration.

**Fix.** `make([]int, 0, b.maxSize)`. len=0, cap=maxSize.

---

## Bug 23 — Closing inside the receiver

```go
case item, ok := <-b.in:
    if !ok {
        close(b.in) // <-- BUG: already closed
        return
    }
```

**Bug.** If `!ok`, the channel is already closed. Calling close again panics.

**Fix.** Remove the close; just return.

---

## Bug 24 — Pipeline with single flusher and slow sink

```go
flushReq := make(chan []int) // <-- BUG: unbuffered
go flushWorker(flushReq, sink)
// ...
flushReq <- batch // blocks if flusher busy
```

**Bug.** The unbuffered flushReq channel forces synchronous handoff. The run loop blocks while the flusher is busy. Pipeline gains lost.

**Fix.** Buffer the channel: `make(chan []int, flushQueueCap)`. Decide the cap based on burst absorption.

---

## Bug 25 — Wrong shutdown order

```go
// Service shutdown:
db.Close()          // <-- BUG: closed first
batcher.Shutdown(ctx) // batcher tries to flush via closed db; errors
```

**Bug.** Sink closed before batcher drained. Flushes fail; items lost.

**Fix.** Reverse:

```go
batcher.Shutdown(ctx)
db.Close()
```

---

## Bug 26 — `select` without default in a hot path

```go
func (b *Batcher) TryAdd(item int) bool {
    b.in <- item // BUG: blocks
    return true
}
```

If the intent was non-blocking, this is wrong; it blocks the producer when the channel is full.

**Fix.**

```go
func (b *Batcher) TryAdd(item int) bool {
    select {
    case b.in <- item:
        return true
    default:
        return false
    }
}
```

---

## Bug 27 — Reading `len(b.in)` from outside

```go
func (b *Batcher) QueueDepth() int {
    return len(b.in)
}
```

Not strictly a bug — `len(ch)` is well-defined on channels. But the value is a *snapshot*; by the time the caller reads it, it may have changed. For metrics this is fine; for logic decisions, it is not.

**Note.** Document that `QueueDepth` is a snapshot for metric purposes.

---

## Bug 28 — Buffer grows beyond MaxBatchSize

```go
case item := <-b.in:
    buf = append(buf, item) // BUG: no cap check
    // No size trigger here
case <-ticker.C:
    if len(buf) >= b.maxSize {
        // size trigger here, but too late
    }
```

If the size trigger is only checked on tick, the buffer grows unbounded between ticks.

**Fix.** Check on append:

```go
case item := <-b.in:
    buf = append(buf, item)
    if len(buf) >= b.maxSize {
        flush(buf)
        buf = buf[:0]
    }
```

---

## Bug 29 — Forgotten `cancel()`

```go
ctx, _ := context.WithTimeout(context.Background(), 5*time.Second)
b.sink.Write(ctx, batch)
```

**Bug.** The `_` discards the cancel function. The timer leaks until expiry.

**Fix.**

```go
ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
defer cancel()
b.sink.Write(ctx, batch)
```

---

## Bug 30 — Mixing per-batch context with per-item context

```go
func (b *Batcher) Add(ctx context.Context, item int) error {
    return b.in <- item // ctx ignored on send
}

func (b *Batcher) flush(buf []int) {
    // What ctx to use here?
}
```

The per-item context is gone by the time we flush; the flush uses its own context. If a producer cancelled, we still flush the item.

**Behaviour:** the producer's ctx affects *enqueue*, not *flush*. Document this.

For "ack on durability" semantics, see the AddWithAck pattern in the spec.

---

## How to Practise

Open each snippet without the answer. Stare at it. Identify the bug. Then check.

A good batcher engineer can spot most of these in seconds. The rest take a minute. The first time through, expect 5-10 to be tricky. After a second pass, all should be obvious.
