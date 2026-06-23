---
layout: default
title: Channels vs Mutexes — Find the Bug
parent: Channels vs Mutexes
grand_parent: Primitives Decision Guide
ancestor: Go
nav_order: 9
has_children: false
permalink: /roadmap/programming-languages/golang/07-concurrency/24-primitives-decision-guide/01-channel-vs-mutex/find-bug/
---

# Channels vs Mutexes — Find the Bug

[← Back](../)

Ten buggy snippets. For each, find the defect, predict what happens at run time, and write the fix in one sentence.

---

## Bug 1 — Close on send

```go
func producer(ch chan int) {
    for i := 0; i < 10; i++ {
        ch <- i
    }
}

func main() {
    ch := make(chan int)
    go producer(ch)
    close(ch)
    for v := range ch {
        fmt.Println(v)
    }
}
```

**Defect.** `main` closes the channel *before* `producer` has sent anything.
**At run time.** `producer` panics: "send on closed channel".
**Fix.** Move `close(ch)` *into* `producer` after the loop. The owner of the send side closes.

---

## Bug 2 — Copied mutex

```go
type Cache struct {
    mu sync.Mutex
    m  map[string]string
}

func NewCache() Cache {
    return Cache{m: map[string]string{}}
}

func (c Cache) Set(k, v string) {
    c.mu.Lock()
    c.m[k] = v
    c.mu.Unlock()
}
```

**Defect.** `Set` takes its receiver by value. Each call copies the `Mutex`.
**At run time.** `go vet` will catch this via `copylocks`. If shipped, two goroutines can each lock their own copy of the mutex and still race on the underlying map (which *is* shared because it's a reference type).
**Fix.** Change `func (c Cache)` to `func (c *Cache)` and have `NewCache` return `*Cache`.

---

## Bug 3 — Unprotected map

```go
type Stats struct {
    counts map[string]int
}

func (s *Stats) Inc(k string) {
    s.counts[k]++
}
```

**Defect.** Maps are not safe for concurrent use. Many goroutines calling `Inc` race.
**At run time.** Sporadic `fatal error: concurrent map writes` — *not* a race-detector message, this one crashes the process even without `-race`.
**Fix.** Add a `sync.Mutex`, or replace with `sync.Map` if access patterns suit, or shard for write-heavy workloads.

---

## Bug 4 — chan-of-1 used as a mutex

```go
type Counter struct {
    lock chan struct{}
    n    int
}

func NewCounter() *Counter {
    return &Counter{lock: make(chan struct{}, 1)}
}

func (c *Counter) Inc() {
    c.lock <- struct{}{}
    c.n++
    <-c.lock
}
```

**Defect.** Functionally correct, performance-wrong. The author used a channel as a binary semaphore.
**At run time.** Works, but each `Inc` allocates nothing (chan reused) yet does a scheduler-aware send/receive that is ~5–10x slower than `sync.Mutex.Lock`/`Unlock` under contention.
**Fix.** Replace with `sync.Mutex`. (Or `atomic.Int64` for this specific code.)

---

## Bug 5 — Range without close

```go
func main() {
    ch := make(chan int)
    go func() {
        for i := 0; i < 3; i++ {
            ch <- i
        }
    }()
    for v := range ch {
        fmt.Println(v)
    }
}
```

**Defect.** The sender never closes the channel.
**At run time.** Prints 0, 1, 2, then `main` deadlocks on the next receive. Go's runtime detects "all goroutines are asleep" and panics: "fatal error: all goroutines are asleep — deadlock!".
**Fix.** Add `defer close(ch)` (or explicit `close(ch)` after the loop) in the sender goroutine.

---

## Bug 6 — Double close

```go
func worker(done chan struct{}, id int) {
    defer close(done)
    // ...
}

func main() {
    done := make(chan struct{})
    go worker(done, 1)
    go worker(done, 2)
    <-done
}
```

**Defect.** Two goroutines call `close(done)`.
**At run time.** Whichever finishes second panics: "close of closed channel".
**Fix.** Use one channel per worker, or use a `sync.WaitGroup`, or use `sync.Once` to gate the close.

---

## Bug 7 — Send on nil channel

```go
type Server struct {
    events chan Event
}

func (s *Server) Send(e Event) {
    s.events <- e
}

func main() {
    s := &Server{}    // events is nil
    s.Send(Event{})   // blocks forever
}
```

**Defect.** `events` was never `make`d.
**At run time.** `Send` blocks forever. If `main` is also blocked, you get a deadlock panic; otherwise the goroutine is silently lost.
**Fix.** Add a constructor that calls `make(chan Event, buf)`.

---

## Bug 8 — RWMutex held during long work

```go
func (c *Cache) FetchOrLoad(k string) []byte {
    c.mu.RLock()
    defer c.mu.RUnlock()
    if v, ok := c.m[k]; ok {
        return v
    }
    v := slowLoad(k)        // many seconds
    c.mu.RUnlock()
    c.mu.Lock()
    c.m[k] = v
    c.mu.Unlock()
    c.mu.RLock()             // re-acquire to match deferred RUnlock
    return v
}
```

**Defect 1.** `RLock` is held during `slowLoad` — that's pointless because `slowLoad` doesn't touch the cache, but it also blocks any writer that arrives meanwhile.
**Defect 2.** The lock dance at the end is fragile and not atomic — two goroutines can both miss and both call `slowLoad`.
**At run time.** Latency tail explodes; cache stampedes on cold misses.
**Fix.** Release the read lock *before* `slowLoad`, then re-acquire as a writer with a recheck. Production code uses `singleflight.Group` for this exact pattern.

---

## Bug 9 — Channel-based "broadcast" with multiple receivers

```go
type Broadcaster struct {
    msgs chan string
}

func (b *Broadcaster) Send(s string) { b.msgs <- s }
func (b *Broadcaster) Listen() <-chan string { return b.msgs }
```

```go
b := &Broadcaster{msgs: make(chan string)}
for i := 0; i < 3; i++ {
    go func(id int) {
        for s := range b.Listen() {
            fmt.Println(id, s)
        }
    }(i)
}
b.Send("hello")
```

**Defect.** A single channel does *not* broadcast — only one of the three listeners receives "hello".
**At run time.** Output looks like only one listener ever sees a given message; consumers are confused.
**Fix.** Broadcast requires per-subscriber channels (the publisher fans out by ranging over subscribers) or `sync.Cond.Broadcast`, or closing a channel (one-shot only). Channels are not pub/sub.

---

## Bug 10 — `time.After` in a hot select

```go
for {
    select {
    case ev := <-events:
        handle(ev)
    case <-time.After(5 * time.Second):
        flush()
    case <-ctx.Done():
        return
    }
}
```

**Defect.** Every iteration where `events` fires creates a new `*time.Timer` whose channel stays alive (held by the runtime) until 5 seconds elapse. Under load, memory grows linearly with event rate.
**At run time.** Slowly rising heap, garbage collector pressure, eventual OOM in long-running services.
**Fix.** Hoist a single timer:

```go
t := time.NewTimer(5 * time.Second)
defer t.Stop()
for {
    select {
    case ev := <-events:
        if !t.Stop() { <-t.C }
        t.Reset(5 * time.Second)
        handle(ev)
    case <-t.C:
        flush()
        t.Reset(5 * time.Second)
    case <-ctx.Done():
        return
    }
}
```

This is on the short list of Go anti-patterns that ship to production with no compiler help — only profiling catches it.

---

[← Back](../)
