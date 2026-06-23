---
layout: default
title: Batching Stages — Find the Bug
parent: Batching Stages
grand_parent: Pipeline Production Patterns
ancestor: Go
nav_order: 9
has_children: false
permalink: /roadmap/programming-languages/golang/07-concurrency/19-pipeline-production-patterns/04-batching-stages/find-bug/
---

# Batching Stages — Find the Bug

> Each snippet contains a real batching bug. Find it, explain it, fix it.

---

## Bug 1 — The missing final flush

```go
func Batch(ctx context.Context, in <-chan int, out chan<- []int, maxSize int, maxWait time.Duration) {
    defer close(out)
    buf := make([]int, 0, maxSize)
    timer := time.NewTimer(maxWait)
    if !timer.Stop() { <-timer.C }

    flush := func() {
        if len(buf) == 0 { return }
        batch := make([]int, len(buf))
        copy(batch, buf)
        buf = buf[:0]
        if !timer.Stop() { select { case <-timer.C: default: } }
        out <- batch
    }

    for {
        select {
        case x, ok := <-in:
            if !ok { return }  // BUG
            if len(buf) == 0 { timer.Reset(maxWait) }
            buf = append(buf, x)
            if len(buf) >= maxSize { flush() }
        case <-timer.C:
            flush()
        case <-ctx.Done():
            return  // BUG
        }
    }
}
```

**Bug.** Two `return` paths skip the final flush. On input close: the partial buffer is silently dropped. On cancellation: same. Production symptom: 0.1–1% data loss on every restart.

**Fix.** Call `flush()` before returning on both paths:

```go
if !ok { flush(); return }
// ...
case <-ctx.Done():
    flush(); return
```

---

## Bug 2 — `time.After` in the loop

```go
func Batch(in <-chan Item, out chan<- []Item, maxSize int, maxWait time.Duration) {
    defer close(out)
    buf := make([]Item, 0, maxSize)
    flush := func() { /* ... */ }

    for {
        select {
        case x, ok := <-in:
            if !ok { flush(); return }
            buf = append(buf, x)
            if len(buf) >= maxSize { flush() }
        case <-time.After(maxWait):  // BUG
            flush()
        }
    }
}
```

**Bug.** `time.After(maxWait)` allocates a fresh `*time.Timer` on every iteration. Under load, this leaks thousands of timers per second. The runtime collects them eventually via finalisers but until then they consume scheduler and memory resources.

**Fix.** Use a single `*time.Timer` and `Reset`:

```go
timer := time.NewTimer(maxWait)
if !timer.Stop() { <-timer.C }
// ...
case <-timer.C:
    flush()
    // (Reset on next append-to-empty)
```

---

## Bug 3 — Sending the live buffer

```go
flush := func() {
    if len(buf) == 0 { return }
    out <- buf       // BUG
    buf = buf[:0]
}
```

**Bug.** Sends `buf` directly. The consumer's slice header points at the same underlying array. The next `append` may modify the array without reallocating (since `cap(buf)` is preserved), corrupting what the consumer sees.

**Fix.** Copy into a fresh slice:

```go
batch := make([]T, len(buf))
copy(batch, buf)
buf = buf[:0]
out <- batch
```

---

## Bug 4 — Deadlock under cancellation

```go
flush := func() {
    if len(buf) == 0 { return }
    batch := snapshot(buf)
    buf = buf[:0]
    out <- batch  // BUG
}
```

**Bug.** The send `out <- batch` is not cancellable. If the consumer has already exited (e.g. due to cancellation), the accumulator blocks forever. Goroutine leak.

**Fix.** Make the send cancellable:

```go
select {
case out <- batch:
case <-ctx.Done():
}
```

---

## Bug 5 — Timer reset race

```go
flush := func() {
    /* ... copy, reset buf ... */
    timer.Reset(maxWait)  // BUG (on pre-1.23 Go)
}

case <-timer.C:
    flush()
```

**Bug.** After `timer.C` fires, `flush` immediately calls `timer.Reset`. On Go versions before 1.23, calling `Reset` on a fired timer without draining the pending value is racy: a second Reset+Stop sequence may leave a stale value on `C`, causing the next loop iteration to fire spuriously.

**Fix.** Stop-and-drain before Reset:

```go
if !timer.Stop() {
    select { case <-timer.C: default: }
}
timer.Reset(maxWait)
```

Or, in the canonical pattern, only Reset on the empty→non-empty transition, and Stop+drain after every flush.

---

## Bug 6 — Empty-batch flushes

```go
case <-timer.C:
    flush()

flush := func() {
    batch := make([]T, len(buf))
    copy(batch, buf)
    buf = buf[:0]
    out <- batch  // BUG: sends empty batches
}
```

**Bug.** `flush` has no empty-buffer guard. When the timer fires during an idle period (after a previous flush emptied the buffer but timer was still armed), `flush` sends an empty `[]T{}` downstream. Consumers may not handle empty batches gracefully.

**Fix.** Early return:

```go
flush := func() {
    if len(buf) == 0 { return }
    // ...
}
```

---

## Bug 7 — Double-close panic

```go
func Batch(ctx context.Context, in <-chan int, out chan<- []int) {
    defer close(out)
    /* ... */
    case <-ctx.Done():
        close(out)  // BUG
        return
}
```

**Bug.** Both the `defer close(out)` and the explicit `close(out)` in the cancellation branch try to close. The second close panics with "close of closed channel."

**Fix.** Remove the explicit close. The defer handles it.

---

## Bug 8 — Mutex with select

```go
var mu sync.Mutex
var buf []int

go func() {
    for x := range in {
        mu.Lock()
        buf = append(buf, x)
        mu.Unlock()
    }
}()

go func() {
    for {
        time.Sleep(maxWait)
        mu.Lock()
        batch := buf
        buf = nil
        mu.Unlock()
        out <- batch
    }
}()
```

**Bug.** Multiple bugs: (1) shared mutable state with mutex when one goroutine + select would suffice; (2) `time.Sleep` cannot be cancelled; (3) sends `buf` (now `nil`-headed) directly — actually `batch := buf` copies the header, so OK there, but next assignment creates a new slice; the consumer's slice is still alive; (4) no shutdown signal; flusher loops forever.

**Fix.** Use the canonical single-goroutine select-loop pattern.

---

## Bug 9 — Goroutine leak on cancel

```go
func Batch(ctx context.Context, in <-chan int, write func([]int)) {
    /* ... */
    case <-timer.C:
        go write(buf)  // BUG: unbounded async + leak on cancel
        buf = nil
}
```

**Bug.** Two issues: (1) unbounded goroutine spawn — under load, thousands of `write` goroutines in flight; (2) on cancellation, the accumulator exits but the `write` goroutines keep running; if `write` ignores `ctx`, they may run for a long time. Also, the buffer is sent directly without copy.

**Fix.** Use bounded async flush (worker pool with `Inflight` bound).

---

## Bug 10 — Capacity vs length confusion

```go
buf := make([]int, maxSize)  // BUG: length, not capacity
// ...
buf = append(buf, x)
if len(buf) >= maxSize { flush() }
```

**Bug.** `make([]int, maxSize)` creates a slice of length `maxSize` (all zero values). The first `append` adds *beyond* `maxSize`. The flush condition `len(buf) >= maxSize` was true from the start, before any items.

**Fix.** Use capacity, not length:

```go
buf := make([]int, 0, maxSize)
```

---

## Bug 11 — Reset on wrong condition

```go
case x, ok := <-in:
    if !ok { flush(); return }
    timer.Reset(maxWait)  // BUG: resets on every item
    buf = append(buf, x)
    if len(buf) >= maxSize { flush() }
```

**Bug.** `timer.Reset` is called on every item, not just on the empty→non-empty transition. This means the time trigger never fires unless items stop arriving entirely. Under continuous input, latency goes unbounded.

**Fix.** Only reset on transition:

```go
if len(buf) == 0 { timer.Reset(maxWait) }
buf = append(buf, x)
```

---

## Bug 12 — Race in async flush

```go
flush := func() {
    go func(b []int) {
        sink.Write(b)
    }(buf)
    buf = buf[:0]  // BUG: race with goroutine reading b
}
```

**Bug.** The goroutine captures `b` (the value passed in — actually fine for the parameter). But the slice header is captured by value; the underlying array is shared. The accumulator's `buf = buf[:0]` then `append`s next items, which may overwrite the array elements the goroutine is reading. Data race.

**Fix.** Copy into a fresh slice before passing:

```go
batch := append([]int(nil), buf...)
go sink.Write(batch)
buf = buf[:0]
```

---

## Bug 13 — Missing `Inflight` bound

```go
case <-timer.C:
    batch := snapshot(buf)
    buf = buf[:0]
    go sink.Write(batch)  // BUG: unbounded
```

**Bug.** Spawns a goroutine per flush. Under load, thousands in flight. Memory grows. Sink overloaded.

**Fix.** Worker pool with bounded `jobs` channel.

---

## Bug 14 — Reading after close

```go
go func() {
    for b := range batches {
        sink.Write(b)
    }
    close(errs)
}()

// elsewhere:
errs <- fmt.Errorf("oops")  // BUG: send after close
```

**Bug.** Code outside the goroutine sends to `errs` after the goroutine closed it. Panic.

**Fix.** Have a single owner for the error channel; do not send after close.

---

## Bug 15 — Per-key memory leak

```go
states := map[K]*state{}
// ... add states on first item per key
// ... never remove them
```

**Bug.** Per-key state map grows unboundedly. With churning keys, memory grows over time even though buffers are empty.

**Fix.** Add an idle timer per key; remove entries after `idleTTL`.

---

## Bug 16 — Wrong field after copy

```go
batch := buf
buf = nil  // forgot to copy
out <- batch
// later:
buf = append(buf, x)  // append to nil slice, allocates
```

**Bug.** `batch := buf` copies the slice header. The underlying array is shared. `buf = nil` only nils the header. The next `append` allocates a new array — so this case actually works! But the *next next* append after that may collide with the consumer's reads from `batch` if the consumer is slow.

Wait — actually `buf = nil` makes `buf` a nil slice; subsequent `append(nil, x)` allocates a fresh array. So this version is actually correct (sort of, by accident). The bug is more subtle: it depends on `buf = nil` happening before any reuse. If you forgot the nil:

```go
batch := buf
out <- batch
buf = append(buf, x)  // BUG: reuses the same array
```

Now the array is shared.

**Fix.** Always copy. Don't rely on reset-then-realloc.

---

## Bug 17 — Timer leak on early exit

```go
timer := time.NewTimer(maxWait)
// ... function may return without stopping timer
```

**Bug.** If the function returns before the timer fires and you don't `Stop()` it, the timer leaks. Specifically, the runtime keeps it alive until it would have fired.

**Fix.** `defer timer.Stop()` at the top (or in the appropriate exit paths).

---

## Bug 18 — Shared map race

```go
var lastFlush = map[string]time.Time{}

// In one goroutine:
lastFlush[key] = time.Now()

// In another goroutine:
t := lastFlush[key]
```

**Bug.** Concurrent map access without synchronisation. Data race; possibly panic ("concurrent map writes").

**Fix.** Use `sync.Map` or wrap in a mutex. Or restructure so only one goroutine touches the map.

---

## Bug 19 — Closing wrong channel

```go
out := make(chan []int)
defer close(in)  // BUG: closes the input
```

**Bug.** Closes `in` instead of `out`. Typo. Producer panics on next send.

**Fix.** `defer close(out)`.

---

## Bug 20 — Final flush with stale buffer

```go
case x, ok := <-in:
    if !ok {
        batch := buf
        out <- batch
        return
    }
    buf = append(buf, x)
```

**Bug.** The final flush sends `buf` directly. After the function returns and any reader processes the batch, the underlying array is GC-eligible only if no other references exist. But if the consumer holds the batch slice while another code path also has a reference to the array... actually in this simple case it's probably OK, but the pattern is fragile. Also, sends to `out` are not cancellable here.

**Fix.** Copy and cancellable send:

```go
if !ok {
    if len(buf) > 0 {
        batch := append([]int(nil), buf...)
        select { case out <- batch: case <-ctx.Done(): }
    }
    return
}
```

---

## Tips for Finding Bugs

1. Look for missing final flushes first — most common.
2. Check timer usage: `time.After` in loops, missing `Stop`, wrong `Reset` placement.
3. Check buffer ownership: copy on send.
4. Check close paths: single owner, no double-close.
5. Check cancellability: every send should be selectable.
6. Check goroutine bounds: unbounded async, leaks.
7. Check map mutations: races without sync.

These seven categories cover ~90% of batching bugs.

---

## Solutions Summary

Each bug above has a one-line fix in the canonical pattern. The point is to recognise them on sight. After working through these twenty, you should be able to spot the same bugs in 30 seconds in any new code.
