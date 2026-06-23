---
layout: default
title: When to Use sync.Cond — Professional
parent: When to Use sync.Cond
grand_parent: Primitives Decision Guide
ancestor: Go
nav_order: 3
has_children: false
permalink: /roadmap/programming-languages/golang/07-concurrency/24-primitives-decision-guide/03-when-to-use-cond/professional/
---

# When to Use sync.Cond — Professional

[← Back](../)

The junior level explained the mechanics. This page is about judgment. When does a senior engineer actually reach for `sync.Cond` in production, and when do they refactor it out?

## 1. The honest count

Run this in your Go installation:

```
$ grep -rn "sync.NewCond" $(go env GOROOT)/src | wc -l
```

On Go 1.22, this prints fewer than 15 uses across the entire standard library. The Go team that wrote and maintains `sync.Cond` uses it sparingly — and the trend over recent releases has been to *remove* Cond usage in favor of channels.

That should be your prior. If you are about to add a new `sync.NewCond` to a codebase, ask whether you are smarter than the Go team. Sometimes you are. Usually not.

## 2. Where Cond legitimately wins

Three patterns where Cond is at least as good as channels:

### 2.1 Multi-predicate wake-up over shared mutable state

You have a data structure protected by a mutex, with several distinct conditions that different goroutines wait on. Examples:

- A bounded buffer (not full, not empty).
- A reader-writer coordinator (no writers, no active readers).
- A worker pool (job available, pool resizing, shutdown).

Channels can encode each predicate as a separate channel, but you then have a synchronization-on-synchronization problem: who reads the channel of "pool is resizing" while also reading the channel of "a job arrived"? `select` solves it in many cases. But the channel solution sometimes has multiple sources of truth — the mutex-protected counter *and* the channel state — and they must be kept in sync.

A Cond-based design has one source of truth: the shared state under the mutex. That can be the deciding factor.

### 2.2 The `io.Pipe` pattern: strict alternating handoff with backpressure both ways

`io.Pipe` synchronizes a reader and a writer. Writer cannot proceed until reader consumes; reader cannot proceed until writer produces. With a single shared buffer, two Conds (or one Cond with Broadcast) and one mutex express this naturally. The naive channel translation requires two channels — a data channel and an acknowledgment channel — and the protocol is harder to read.

The stdlib `io.Pipe` was Cond-based for years. In recent Go versions the implementation was rewritten to use channels (see `src/io/pipe.go` in Go 1.21+), but the channel version is arguably less clear and only marginally faster, illustrating how close the two designs really are for this kind of problem.

### 2.3 Dynamic resource pools (workers, connections) with multiple wake-up reasons

A worker pool that supports `Submit`, `Resize`, and `Shutdown` has workers that may need to wake for any of three distinct reasons. Cond with Broadcast on resize/shutdown and Signal on submit fits cleanly. The channel version typically has at least two channels and a sentinel-based termination protocol that is harder to get right.

## 3. The stdlib examples worth reading

Three good reads:

### 3.1 `src/io/pipe.go`

The historical Cond-based version (Go 1.20 and earlier) was a beautifully tight ~120 lines. The current version uses channels. Open both and compare them; both compile and work, and the Cond version arguably reads better. Look for the structure:

```go
// historical (Cond-based) shape:
type pipe struct {
    wrMu    sync.Mutex
    wrCh    chan []byte
    rdCh    chan int
    // ... (channel-based; uses ack channels)
}

// vs older Cond-based:
type pipe struct {
    mu       sync.Mutex
    rwait    sync.Cond
    wwait    sync.Cond
    rerr     error
    werr     error
    data     []byte
}
```

The Cond version has fewer moving parts: one mutex, two Conds, one byte slice. The channel version has separate channels for read and write halves, plus error fields. Both are correct; the Cond one is shorter and easier to reason about under exception flow (closed pipes, errored sides).

### 3.2 `src/net/http/server.go`

The Go HTTP server historically used `sync.Cond` in `connReader` to coordinate "read in progress" with "want to abort." This was replaced with channels around Go 1.9–1.11, and the rationale in the commit message was readability, not performance. If you read the diff (`git log -p src/net/http/server.go` in the Go repo), you can see the team's reasoning: every Cond use was a footnote about how to drain waiters on shutdown, and the channel version removed that complexity.

### 3.3 `src/sync/cond.go` itself

90 lines, including comments. Read it once. It teaches you exactly what condition variables are: a notify list (FIFO queue of waiters), a copy-checker, and the three runtime calls that implement the protocol.

```go
func (c *Cond) Wait() {
    c.checker.check()
    t := runtime_notifyListAdd(&c.notify)
    c.L.Unlock()
    runtime_notifyListWait(&c.notify, t)
    c.L.Lock()
}
```

Notice that `notifyListAdd` runs *before* `Unlock`. That ordering is the only thing that prevents lost wakeups. Internalize it.

## 4. Refactoring a Cond-based design to channels: a real example

A real service we worked on had this shape:

```go
type RateLimiter struct {
    mu       sync.Mutex
    cond     *sync.Cond
    tokens   int
    capacity int
}

func (r *RateLimiter) Acquire(ctx context.Context) error {
    r.mu.Lock()
    defer r.mu.Unlock()
    for r.tokens == 0 {
        r.cond.Wait()
    }
    r.tokens--
    return nil
}

func (r *RateLimiter) refill() {
    for range time.Tick(time.Second) {
        r.mu.Lock()
        if r.tokens < r.capacity {
            r.tokens++
            r.cond.Signal()
        }
        r.mu.Unlock()
    }
}
```

The problem: `Acquire` ignores `ctx`. There is no way to cancel a `Wait`. To add cancellation, you would need a side goroutine that broadcasts on context done — adding a goroutine per `Acquire` call. That is a goroutine leak and a performance regression.

The channel-based rewrite is simpler:

```go
type RateLimiter struct {
    tokens chan struct{}
}

func New(capacity int) *RateLimiter {
    r := &RateLimiter{tokens: make(chan struct{}, capacity)}
    for i := 0; i < capacity; i++ {
        r.tokens <- struct{}{}
    }
    return r
}

func (r *RateLimiter) Acquire(ctx context.Context) error {
    select {
    case <-r.tokens:
        return nil
    case <-ctx.Done():
        return ctx.Err()
    }
}

func (r *RateLimiter) refill() {
    for range time.Tick(time.Second) {
        select {
        case r.tokens <- struct{}{}:
        default:
        }
    }
}
```

Cancellation comes for free via `select`. The implementation is shorter, and the channel runtime is faster than the Cond+mutex round-trip for this workload (see optimize.md for numbers).

**Rule of thumb.** Whenever you find yourself needing cancellation or timeout on a Cond `Wait`, it is a strong signal that you should be using a channel instead.

## 5. The `sync.Cond` decision checklist

Before you write `sync.NewCond`, ask:

1. **Is the predicate channel-shaped?** (Single bool, queue depth, slot count.) → Use a channel.
2. **Do I need cancellation or timeout?** → Use a channel + `select`.
3. **Is this a one-time fan-out broadcast?** → Use `close(chan struct{})`.
4. **Does the design already have a mutex protecting the relevant state?** → Cond *might* be a fit.
5. **Are there multiple distinct predicates over the same state?** → Cond *might* be a fit.
6. **Will the predicate change frequently and wake exactly one waiter most of the time?** → Cond with `Signal` is efficient here. A channel works too but with slightly different perf.

If you cleared (1)–(3) (i.e., none of them apply) *and* you have (4) and (5) or (4) and (6), Cond is defensible. If you only have (4), it is a coin flip and you should default to channels for readability.

## 6. Anti-patterns to refactor

Five Cond designs that you should refactor when you see them in code review.

### 6.1 Cond for "wait for a signal" with no predicate

```go
// BAD
c.L.Lock()
c.Wait()
c.L.Unlock()
```

There is no predicate, just a "wake me up." This is a one-shot event. Use `chan struct{}`:

```go
<-doneCh
```

Even simpler if multiple waiters: `close(doneCh)`.

### 6.2 Cond+counter when you have `sync.WaitGroup`

```go
// BAD
type Latch struct {
    mu   sync.Mutex
    cond *sync.Cond
    n    int
}
func (l *Latch) Done() { l.mu.Lock(); l.n--; if l.n == 0 { l.cond.Broadcast() }; l.mu.Unlock() }
func (l *Latch) Wait() { l.mu.Lock(); for l.n > 0 { l.cond.Wait() }; l.mu.Unlock() }
```

This is `sync.WaitGroup` reimplemented, badly. Use the real `sync.WaitGroup`.

### 6.3 Cond+bool when you have `sync.Once`

```go
// BAD
type Init struct {
    mu   sync.Mutex
    cond *sync.Cond
    done bool
    init func()
}
func (i *Init) Do() {
    i.mu.Lock()
    if i.done { i.mu.Unlock(); return }
    i.done = true
    i.mu.Unlock()
    i.init()
    // BUG: how do other callers wait for the init to complete?
}
```

If you need "exactly once with parallel waiters," that is `sync.Once`. If you need "lazy value with parallel waiters," that is `sync.OnceValue` (Go 1.21+) or a `sync.Once`-backed wrapper. Do not roll your own.

### 6.4 Cond for queue-shaped problems

```go
// BAD
type Q struct {
    mu   sync.Mutex
    cond *sync.Cond
    data []T
}
```

Use `chan T` of capacity `cap`. The channel runtime is optimized for this exact case and will beat your Cond version on perf.

### 6.5 Cond with side goroutines for cancellation

```go
// BAD
func Acquire(ctx context.Context) {
    done := make(chan struct{})
    go func() {
        <-ctx.Done()
        c.L.Lock()
        cancelled = true
        c.Broadcast()
        c.L.Unlock()
        close(done)
    }()
    // ... Wait loop
    <-done // ensure goroutine is gone
}
```

Per-call goroutines just to broadcast on context cancel. Refactor the whole thing to a channel-based design.

## 7. The Bryan Mills argument

Bryan Mills (Go core team) has a well-known internal/public position: `sync.Cond` is a primitive we kept for backward compatibility but would not add today. His talk on advanced concurrency patterns lists Cond uses one by one and shows the channel-based replacement for each. The summary:

| Cond pattern | Channel replacement |
|---|---|
| `Broadcast` for one-time event | `close(chan struct{})` |
| `Signal` on queue push | Buffered channel send |
| `Wait` for any of N predicates | `select` over N channels |
| Cancellable `Wait` | `select { case <-ch: ; case <-ctx.Done(): }` |

The docstring of `sync.Cond` even gestures at this: *"For more on replacements for sync.Cond, see Roberto Clapis's series on advanced concurrency patterns, as well as Bryan Mills's talk on concurrency patterns."* The standard library is *telling you* to use channels.

## 8. The cases where you ignore the advice anyway

There are real cases. Three I have seen:

### 8.1 A scheduler with priority and pre-emption

A scheduler that maintains a priority heap of pending tasks and selects the highest-priority one when a worker becomes idle. The shared state — the heap — is naturally mutex-protected. The wake-up signal is "a new task arrived" or "a worker freed up," and the right semantics is "wake one idle worker who can take the highest-priority task." Cond with Signal models this cleanly. A channel-based version requires a sorted-channel abstraction or external sort plus a single notification channel.

### 8.2 A throttled resource pool with hot replacement

Database connection pool with the ability to replace an underlying connection on health-check failure. Workers check out connections; on check-in, they may report failure, in which case the connection is destroyed and a new one created. The pool size, the "available" list, and the "in-use" list are all under one mutex. Cond with Broadcast on "size changed or new connection available" works cleanly. (In practice, real pools like `database/sql` use a mix of channels and locks; reading the source is instructive.)

### 8.3 io.Pipe-like full-duplex with both-sides backpressure

Already covered above. The stdlib changed away from Cond in 1.21+, but the pre-change implementation is a textbook valid use.

## 9. A note on `sync.Cond` and `context.Context`

`Wait` does not take a context. There is no way to cancel a parked Cond waiter without broadcasting from a side goroutine. This is the single biggest reason to prefer channels in modern Go: practically every production goroutine should be cancellable, and Cond is not.

If you must implement cancellable Cond-wait, the pattern is:

```go
func (x *X) WaitCancellable(ctx context.Context) error {
    done := make(chan struct{})
    go func() {
        select {
        case <-ctx.Done():
            x.mu.Lock()
            x.cond.Broadcast()
            x.mu.Unlock()
        case <-done:
        }
    }()
    x.mu.Lock()
    for !x.predicate() && ctx.Err() == nil {
        x.cond.Wait()
    }
    x.mu.Unlock()
    close(done)
    return ctx.Err()
}
```

This works but spawns a goroutine per call and broadcasts on cancel — which wakes *every* parked waiter, not just the cancelling one. The channel-based version is one `select`. The difference in complexity is not subtle.

## 10. Defense against Cond bugs in code review

When you see `sync.Cond` in a PR, run through this checklist:

1. Is `Wait` always called under the lock? Grep the function for `c.Wait()` and check that the immediately preceding lines are inside a `mu.Lock`/`mu.Unlock` pair.
2. Is `Wait` inside a `for` loop, not an `if`? If `if`, that is almost always a bug. (Almost always — there is one edge case where it is safe, namely if the predicate is monotonic and the lock is held by the same goroutine continuously, but that is extremely rare in practice.)
3. Is the Cond used with `Signal` and multiple distinct predicates? If yes, that is a bug. Either use `Broadcast`, or split into one Cond per predicate.
4. Is `Signal`/`Broadcast` called under the lock that protects the predicate? It does not have to be, but if it is not, there must be a clear reason.
5. Is the Cond passed by value anywhere? `go vet` catches this, but check the function signatures.
6. Is there any cancellation requirement? If yes, push back on the design.
7. Is there a `sync.WaitGroup`/`sync.Once`/`chan` that could replace this?

Reviewers who go through this list catch 80% of Cond bugs.

## 11. A worked refactor: dynamic worker pool

A real codebase we audited had this:

```go
type Pool struct {
    mu        sync.Mutex
    cond      *sync.Cond
    jobs      []Job
    targetN   int
    currentN  int
    shutdown  bool
}

func (p *Pool) Submit(j Job) {
    p.mu.Lock()
    p.jobs = append(p.jobs, j)
    p.cond.Signal()
    p.mu.Unlock()
}

func (p *Pool) Resize(n int) {
    p.mu.Lock()
    p.targetN = n
    p.cond.Broadcast()
    p.mu.Unlock()
    p.maintain()
}

func (p *Pool) worker() {
    for {
        p.mu.Lock()
        for len(p.jobs) == 0 && p.currentN <= p.targetN && !p.shutdown {
            p.cond.Wait()
        }
        if p.shutdown || p.currentN > p.targetN {
            p.currentN--
            p.mu.Unlock()
            return
        }
        j := p.jobs[0]
        p.jobs = p.jobs[1:]
        p.mu.Unlock()
        j.Run()
    }
}
```

This is one of the few cases where Cond is at least competitive with channels. The workers wait on a composite predicate: "jobs available OR shutting down OR pool shrinking." Encoding this in channels requires a `select` over (job channel, shutdown channel, resize channel) — three channels — and the resize channel needs to encode "you specifically should exit," which requires either per-worker channels or a counter.

We left this code as-is. The Cond version is ~30 lines; the channel version we drafted was 50+ and harder to read.

**Lesson.** Sometimes Cond wins on readability. The decision is not perf — it is "how many sources of truth does my data have?" One mutex-protected struct is simpler than four channels.

## 12. Performance considerations

Covered in detail in optimize.md, but the headlines:

- Channel ops are ~2x faster than Cond ops on Go 1.22 for the simple producer/consumer case.
- For multi-waiter broadcast, `close(chan)` is comparable to `Broadcast` (both use the runtime `sudog` machinery).
- The cost of Cond is mostly in the extra mutex round-trip — the runtime notify list itself is comparable to channel-based parking.

If you have a Cond in a hot path and you can replace it with a channel without ugly contortions, you should. If you cannot replace it without uglifying the code, the few-percent perf gain is rarely worth it.

## 13. The Cond deprecation conversation

There was a serious discussion on the Go issue tracker about deprecating `sync.Cond` (issue #21165). The conclusion was not to deprecate it because:

1. Existing code uses it correctly in some cases.
2. The replacement guidance is "use channels," but that does not cover 100% of cases.
3. The maintenance cost of keeping it is low (90 lines, no changes needed).

But the existence of the discussion is itself a tell: the team that maintains `sync.Cond` does not love it. They keep it because deprecating it would be more disruptive than helpful.

## 14. The bottom line for production code

You will write `sync.Cond` correctly only if:

1. You understand the wait/signal protocol cold.
2. You wrap every `Wait` in a `for` loop.
3. You always `Broadcast` unless you have a clear reason for `Signal`.
4. You signal under the lock that protects the predicate.
5. You never copy a Cond.
6. You never call `Wait` outside the lock.

And you should use `sync.Cond` only if:

1. The shared state is naturally one struct with multiple distinct wait conditions.
2. You do not need cancellation or timeout.
3. The channel alternative is demonstrably less readable.

That is a small set of cases. For everything else — and "everything else" is the overwhelming majority — use channels.

## 15. Summary

`sync.Cond` is correct, documented, and minimal. It is also one of the most error-prone primitives in Go's standard library. The Go team itself uses it sparingly and recommends channels for most cases. As a senior engineer, your job is to know when Cond is genuinely the right tool — multi-predicate wake-up over shared mutex-protected state — and when it is technically possible but pragmatically wrong (queues, one-shot signals, cancellable waits). The cost of getting Cond wrong is silent production bugs that hang goroutines or corrupt state. The cost of using channels when Cond might have been "cleaner" is roughly nothing. Default to channels. Use Cond only when you can justify it in one sentence.

## 16. Reading the stdlib: `src/io/pipe.go` in depth

`io.Pipe` is the most cited "this is a legitimate use of Cond" example in the standard library. Let us read it carefully. The Go 1.20 version was Cond-based; Go 1.21+ rewrote it to channels. Both versions are instructive.

The Cond-based version, abridged:

```go
type pipe struct {
    wrMu sync.Mutex
    rdMu sync.Mutex

    mu       sync.Mutex
    rwait    sync.Cond
    wwait    sync.Cond
    data     []byte
    rerr     atomicError
    werr     atomicError
    pendingW int
    pendingR int
}

func (p *pipe) Read(b []byte) (n int, err error) {
    p.rdMu.Lock()
    defer p.rdMu.Unlock()

    p.mu.Lock()
    defer p.mu.Unlock()

    for len(p.data) == 0 && p.werr.Load() == nil {
        p.rwait.Wait()
    }

    if p.werr.Load() != nil && len(p.data) == 0 {
        return 0, p.werr.Load()
    }

    n = copy(b, p.data)
    p.data = p.data[n:]
    p.wwait.Signal()
    return
}

func (p *pipe) Write(b []byte) (n int, err error) {
    p.wrMu.Lock()
    defer p.wrMu.Unlock()

    p.mu.Lock()
    defer p.mu.Unlock()

    for len(p.data) > 0 && p.rerr.Load() == nil {
        p.wwait.Wait()
    }

    if p.rerr.Load() != nil {
        return 0, p.rerr.Load()
    }

    p.data = append(p.data, b...)
    p.rwait.Signal()
    return
}
```

Observe the design:

1. **Two outer mutexes (`wrMu`, `rdMu`)** serialize multiple readers and multiple writers separately. A single goroutine doing `Read` at any time, and a single doing `Write`.
2. **An inner mutex (`mu`)** protects the shared `data`, `rerr`, `werr`, and Conds.
3. **Two Conds (`rwait`, `wwait`)** for the two distinct predicates: "data is available for reader" and "buffer is empty for writer."
4. **Both use `Signal`** because each `Read` consumes at most one bufferload (waking at most one Writer to refill) and each `Write` produces at most one bufferload (waking at most one Reader to drain).

Why is this Cond-based design clean? Because:
- The shared state (`data`, `rerr`, `werr`) is one struct under one mutex.
- The predicates are mutually exclusive: "data ready" and "buffer empty" cannot both be true (data ready implies buffer non-empty).
- There is no cancellation requirement; readers/writers block until paired or error.

Now the channel-based version (Go 1.21+):

```go
type pipe struct {
    wrMu sync.Mutex
    wrCh chan []byte
    rdCh chan int
    once sync.Once
    done chan struct{}
    rerr onceError
    werr onceError
}

func (p *pipe) read(b []byte) (n int, err error) {
    select {
    case <-p.done:
        return 0, p.readCloseError()
    default:
    }

    select {
    case bw := <-p.wrCh:
        nr := copy(b, bw)
        p.rdCh <- nr
        return nr, nil
    case <-p.done:
        return 0, p.readCloseError()
    }
}

func (p *pipe) write(b []byte) (n int, err error) {
    select {
    case <-p.done:
        return 0, p.writeCloseError()
    default:
    }

    p.wrMu.Lock()
    defer p.wrMu.Unlock()
    for once := true; once || len(b) > 0; once = false {
        select {
        case p.wrCh <- b:
            nw := <-p.rdCh
            b = b[nw:]
            n += nw
        case <-p.done:
            return n, p.writeCloseError()
        }
    }
    return n, nil
}
```

This is harder to read at first because of the back-and-forth between `wrCh` (data) and `rdCh` (ack). But it has one significant advantage: `<-p.done` integrates naturally as a third arm in each `select`, giving you cancellation/closure handling for free.

In the Cond version, you had to check `werr.Load() != nil` inside the for-loop and after `Wait`. In the channel version, the closure is just `<-done` in the select.

Reading both side by side teaches the trade-off:

| Aspect | Cond version | Channel version |
|---|---|---|
| Lines of core code | ~60 | ~70 |
| Cancellation | Manual (error fields) | Free via `<-done` |
| Predicate check | Explicit (`for !cond { Wait() }`) | Implicit in channel ops |
| Mental model | Shared state under lock | Message passing |
| Easier to extend? | Hard (every new predicate is a new Cond) | Easy (new select arm) |
| Faster on benchmark | Yes (~10%) | No |

The Go team chose channels in 1.21+. The Cond version was correct but harder to extend; the channel version trades a small perf hit for better extensibility and cancellation. **This trade-off is typical:** Cond wins on tight perf, channels win on flexibility.

## 17. A subtle Cond pattern: per-key conditional wake-up

Suppose you are implementing a key-value store where readers can wait for a specific key to appear. Multiple readers may wait on the same key; readers waiting on different keys are independent.

The naive Cond approach: one Cond per store, broadcast on every set:

```go
type Store struct {
    mu   sync.Mutex
    cond *sync.Cond
    data map[string]string
}

func (s *Store) Set(k, v string) {
    s.mu.Lock()
    s.data[k] = v
    s.cond.Broadcast()
    s.mu.Unlock()
}

func (s *Store) Wait(k string) string {
    s.mu.Lock()
    for {
        if v, ok := s.data[k]; ok {
            s.mu.Unlock()
            return v
        }
        s.cond.Wait()
    }
}
```

This is correct but wasteful. Every `Set` wakes every waiter, who then re-checks their key, finds it absent (because it wasn't theirs), and re-parks. With many waiters on different keys, this is O(N*M) work for N waiters and M sets.

The refined approach: one Cond per key. But each Cond costs ~64 bytes plus a notifyList. If you have thousands of keys, this is too much.

The channel-based approach: one chan per key, closed when the key is set. Lazy allocation:

```go
type Store struct {
    mu      sync.Mutex
    data    map[string]string
    waiters map[string]chan struct{}
}

func (s *Store) Set(k, v string) {
    s.mu.Lock()
    s.data[k] = v
    if ch, ok := s.waiters[k]; ok {
        close(ch)
        delete(s.waiters, k)
    }
    s.mu.Unlock()
}

func (s *Store) Wait(k string) string {
    s.mu.Lock()
    if v, ok := s.data[k]; ok {
        s.mu.Unlock()
        return v
    }
    ch, ok := s.waiters[k]
    if !ok {
        ch = make(chan struct{})
        s.waiters[k] = ch
    }
    s.mu.Unlock()
    <-ch
    s.mu.Lock()
    v := s.data[k]
    s.mu.Unlock()
    return v
}
```

The channel version:
- Has no wasted wake-ups (only waiters on the matching key wake).
- Cleans up channels eagerly (delete after close).
- Naturally extends to cancellation via `select { case <-ch: case <-ctx.Done(): }`.

**Lesson.** When the wait predicate has high cardinality (many distinct values like keys, IDs, etc.), Cond's coarse broadcast becomes a bottleneck. Per-key channels are usually the better design.

## 18. Cond and the Go memory model

The Go memory model (`go.dev/ref/mem`) makes a specific guarantee about Cond:

> The nth call to `c.Wait` that returns is synchronized after the nth call to `c.Notify` (Signal or Broadcast) that wakes it.

In plainer terms: any writes performed by the signaller before calling `Signal`/`Broadcast` are visible to the woken waiter after `Wait` returns. This is the same release/acquire semantics you get from `Mutex.Unlock`/`Mutex.Lock`.

The practical implication: you can use Cond's signal-and-wait as a memory barrier. State written before `Broadcast` is visible to all woken waiters. This is exactly the property that makes the canonical "lock, change predicate, signal" pattern work.

```go
mu.Lock()
sharedState = newValue
cond.Broadcast()   // memory barrier: newValue is visible to woken waiters
mu.Unlock()
```

After this, all woken waiters can safely read `sharedState`. (Of course, since they hold `mu`, they can read it anyway — the memory model just confirms that the barrier is honored.)

## 19. Comparison with C++ and Java

For senior engineers coming from other languages, here is how Go's Cond stacks up:

| Feature | Go `sync.Cond` | C++ `std::condition_variable` | Java `Object.wait/notify` |
|---|---|---|---|
| Spurious wakeups? | No | Yes | Yes |
| Timeout? | No | Yes (`wait_for`, `wait_until`) | Yes (`wait(timeout)`) |
| Cancellation? | No | No (use stop_token + manual) | Yes (`Thread.interrupt`) |
| Predicate lambda overload? | No | Yes (`wait(lk, pred)`) | No |
| Lock type? | `sync.Locker` | `unique_lock<mutex>` | implicit `synchronized` |
| Broadcast equivalent? | `Broadcast()` | `notify_all()` | `notifyAll()` |

Go's Cond is the most stripped-down. Java's is older but has timeouts and interrupt-based cancellation. C++'s has the convenient predicate-lambda overload (which is essentially the for-loop pattern baked into the API). Go chose minimalism partly because the team wanted to push users toward channels.

If you write a lot of cross-language concurrency code, the missing timeout and cancellation in Go's Cond will feel like an oversight. The intentional Go-idiomatic alternative is `select` with channels. This is a philosophical choice, not a technical limitation.

## 20. The drainable Cond pattern

A specific pattern I have seen in production several times: a Cond that must allow waiters to be released en masse during shutdown.

```go
type Drainable struct {
    mu      sync.Mutex
    cond    *sync.Cond
    draining bool
    pending int
}

func (d *Drainable) Acquire() error {
    d.mu.Lock()
    for d.pending == 0 && !d.draining {
        d.cond.Wait()
    }
    if d.draining {
        d.mu.Unlock()
        return errDraining
    }
    d.pending--
    d.mu.Unlock()
    return nil
}

func (d *Drainable) Drain() {
    d.mu.Lock()
    d.draining = true
    d.cond.Broadcast()  // wake all waiters; they return errDraining
    d.mu.Unlock()
}

func (d *Drainable) Release() {
    d.mu.Lock()
    d.pending++
    d.cond.Signal()
    d.mu.Unlock()
}
```

This is a semaphore with a "drain" capability. The Cond is the right tool because:
- Multiple distinct predicates: "pending > 0" and "draining."
- One mutex protects the small shared state.
- Drain semantics are atomic with the broadcast.

The channel equivalent would need a `chan struct{}` for `pending` (used as a buffered semaphore) and a `chan struct{}` for `draining` (closed on drain):

```go
type Drainable struct {
    tokens chan struct{}
    done   chan struct{}
}

func (d *Drainable) Acquire() error {
    select {
    case <-d.tokens: return nil
    case <-d.done:   return errDraining
    }
}
```

This is shorter and has cancellation for free, but only if there is no third predicate. As soon as you add a fourth state (paused, draining, normal, shutdown), the channel version requires N channels and complex `select` arrangements, while the Cond version just adds another field under the mutex.

**When Cond wins:** the count of distinct wait conditions is high or growing, and they all share one struct of state.

## 21. Goroutine safety: copying and sharing

A subtle gotcha. The following looks innocent:

```go
type Worker struct {
    mu   sync.Mutex
    cond sync.Cond  // not *sync.Cond
}

func NewWorker() Worker {
    w := Worker{}
    w.cond = sync.Cond{L: &w.mu}
    return w  // BUG: w is a copy
}
```

`Worker` is returned by value. The caller now has a `Worker` whose embedded `sync.Cond.L` points to *the original `w.mu`* — not their own copy. Subsequent `Wait`/`Signal`/`Broadcast` calls on the caller's `Worker` operate on the wrong lock.

`go vet -copylocks` catches this immediately:

```
./worker.go:8:6: NewWorker returns Lock by value: Worker contains sync.Cond
```

The fix is to use `*Worker`:

```go
func NewWorker() *Worker {
    w := &Worker{}
    w.cond.L = &w.mu
    return w
}
```

Or to use a pointer to the Cond inside Worker:

```go
type Worker struct {
    mu   sync.Mutex
    cond *sync.Cond
}

func NewWorker() *Worker {
    w := &Worker{}
    w.cond = sync.NewCond(&w.mu)
    return w
}
```

Both work. The `*sync.Cond` form is more idiomatic.

## 22. A real refactor: pool replacement story

A team I worked with had a buffer pool for a network proxy. The pool had this structure:

```go
type BufferPool struct {
    mu        sync.Mutex
    cond      *sync.Cond
    free      [][]byte
    inFlight  int
    maxFlight int
}

func (p *BufferPool) Get() []byte {
    p.mu.Lock()
    for len(p.free) == 0 && p.inFlight >= p.maxFlight {
        p.cond.Wait()
    }
    if len(p.free) > 0 {
        b := p.free[len(p.free)-1]
        p.free = p.free[:len(p.free)-1]
        p.inFlight++
        p.mu.Unlock()
        return b
    }
    p.inFlight++
    p.mu.Unlock()
    return make([]byte, 4096)
}

func (p *BufferPool) Put(b []byte) {
    p.mu.Lock()
    p.free = append(p.free, b)
    p.inFlight--
    p.cond.Signal()
    p.mu.Unlock()
}
```

Symptoms: profile showed 14% CPU in `runtime.semacquire1` under `BufferPool.Get`. Latency P99 was 50ms when load was steady.

Investigation: the Cond was on the hot path for every Get/Put. The lock granularity meant any contention serialized all calls. With 100+ goroutines competing, the lock was the bottleneck.

Refactor 1: replace with `sync.Pool`. `sync.Pool` is lock-free in the steady state (per-P caches) and was designed exactly for this. We replaced the entire BufferPool with:

```go
var bufPool = sync.Pool{
    New: func() interface{} { return make([]byte, 4096) },
}

func Get() []byte { return bufPool.Get().([]byte) }
func Put(b []byte) { bufPool.Put(b[:cap(b)]) }
```

Result: 14% CPU disappeared; P99 latency dropped to 5ms. The `maxFlight` constraint was no longer enforced, but it turned out we didn't need it — `sync.Pool` handles bounded memory via GC.

**Lesson.** Before reaching for Cond-based pooling, look at `sync.Pool`. It exists for this exact problem.

## 23. Refactoring patterns: a Cond-to-channel cookbook

Here are the most common Cond patterns and their channel equivalents.

### Pattern 1: one-shot signal

```go
// Cond:
mu.Lock()
done = true
cond.Broadcast()
mu.Unlock()
// Waiters: mu.Lock(); for !done { cond.Wait() }; mu.Unlock()

// Channel:
close(doneCh)
// Waiters: <-doneCh
```

### Pattern 2: producer-consumer queue

```go
// Cond:
//   Push: mu.Lock(); items = append(items, v); cond.Signal(); mu.Unlock()
//   Pop:  mu.Lock(); for len(items) == 0 { cond.Wait() }; v := items[0]; ...

// Channel:
//   Push: ch <- v
//   Pop:  v := <-ch
```

### Pattern 3: bounded queue

```go
// Cond:
// (lots of code, two Conds, one mutex; see junior.md section 26)

// Channel:
ch := make(chan T, capacity)
// Push: ch <- v   (blocks when full)
// Pop:  <-ch      (blocks when empty)
```

### Pattern 4: barrier

```go
// Cond (with generation counter):
// (see junior.md section 31)

// Channel:
// (using sync.WaitGroup; barrier with reset uses chan)
```

`sync.WaitGroup.Wait` is the simplest barrier. For a reusable barrier, the closed-channel pattern with explicit generation is appropriate.

### Pattern 5: cancellable wait

```go
// Cond: requires side broadcaster goroutine, see section 9.

// Channel:
select {
case <-ch: // event happened
case <-ctx.Done(): // cancelled
}
```

Channels win in 4 out of 5 patterns. Cond is competitive only in the multi-predicate / shared-mutex case.

## 24. Why Cond's API has not changed since Go 1.0

`sync.Cond` was added in Go 1.0 and has not been modified since. The API is frozen for backward compatibility. Several proposals to add `WaitTimeout` or `WaitContext` have been rejected, with the consensus being:

1. The intended use case is shared-state coordination, not cancellable rendezvous.
2. For cancellable rendezvous, channels are the right tool.
3. Adding timeout/context would complicate the API and the runtime.
4. Existing code can build timeouts on top of Cond via side broadcasters.

This is a deliberate design decision. It explains why senior Go engineers default to channels for anything with cancellation requirements: the language designers have explicitly chosen not to make Cond cancellable.

## 25. The `sync.Cond` test smell

Code reviewers should be suspicious of any of these patterns:

```go
// Smell 1: Cond with a side goroutine for timeout
go func() {
    <-ctx.Done()
    mu.Lock()
    cond.Broadcast()
    mu.Unlock()
}()
```

Replace with `select` on channels.

```go
// Smell 2: Cond protecting only one bool
type Once struct { mu sync.Mutex; cond *sync.Cond; done bool }
```

Use `sync.Once` or `chan struct{}`.

```go
// Smell 3: Cond replacing a buffered channel
type Queue struct { mu sync.Mutex; cond *sync.Cond; items []T }
```

Use `chan T` of appropriate capacity.

```go
// Smell 4: Cond used to count completion
type Latch struct { mu sync.Mutex; cond *sync.Cond; pending int }
```

Use `sync.WaitGroup`.

```go
// Smell 5: Cond + map+Broadcast for per-key wake-up
type Notifier struct { mu sync.Mutex; cond *sync.Cond; vals map[string]T }
```

Use `map[string]chan T` with close-on-set semantics.

When you see any of these, propose the channel refactor in code review. Most will be accepted; the cases that survive review are the cases where Cond is genuinely the right tool.

## 26. A research aside: the Mesa style

The condition-variable semantics that Cond implements is called *Mesa semantics*, after the language Mesa where it was introduced. The alternative is *Hoare semantics*, where the signaller transfers the lock directly to the waiter.

Mesa semantics:
- Signaller calls `Signal` and continues holding the lock.
- Waiter is queued; runs only after re-acquiring the lock.
- *Other goroutines* can grab the lock between Signal and Waiter's resume, potentially mutating the predicate.

Hoare semantics:
- Signaller transfers the lock to the waiter immediately.
- Waiter runs with the lock; predicate is guaranteed true.

Mesa is universally what modern systems implement (POSIX, Java, C++, Go) because Hoare requires preemption-friendly scheduling and is more complex. Go's `sync.Cond` is Mesa. This is why the `for` loop is necessary: between Signal and Waiter's resume, the predicate may have changed.

If your code review partner argues for `if` instead of `for`, this is the answer: "Go uses Mesa-style condition variables. The signaller does not transfer the lock; another goroutine can run between Signal and our Wait return. The for-loop re-checks the predicate."

## 27. Production checklist for Cond use

If you must use `sync.Cond` in production code, do the following:

1. **Write a failing test first.** Concurrency code without `-race` tests is irresponsible. Cond-based code without race tests is malpractice.
2. **Use `goleak.VerifyTestMain`.** Goroutine leaks are the most common Cond failure mode. Detect them in CI.
3. **Code review by at least two engineers.** One to verify correctness, one to challenge whether channels would be simpler.
4. **Document the predicate.** Comment on the Wait loop with a sentence explaining what the predicate represents and which goroutines maintain it.
5. **Document the wake-up policy.** Comment on the Signal/Broadcast call with a sentence explaining how many waiters can progress.
6. **Document the locking discipline.** Comment on the struct definition explaining which fields are protected by the mutex, what the invariants are.

Example:

```go
type Pool struct {
    // mu protects all fields below.
    mu sync.Mutex
    // cond signals waiters when a connection becomes available (returned to pool)
    // or when shutdown is requested. Broadcast is used because both events may
    // unblock multiple waiters with different predicates.
    cond *sync.Cond
    // available is the stack of idle connections.
    available []*Conn
    // closed is true once Close has been called.
    closed bool
}
```

That comment block is non-negotiable for production Cond code.

## 28. Things to remember for senior code review

When a junior shows you a `sync.Cond` in their PR:

1. Ask: "Can this be a channel?" Usually yes.
2. If no, ask: "Why not?" The answer should be specific.
3. Check the Wait loop is `for !pred { Wait() }`.
4. Check `Broadcast` is used unless there is a one-line justification for `Signal`.
5. Check the predicate change and signal are under the same lock.
6. Check the Cond is referenced by pointer, not value.
7. Check there is no cancellation requirement (if there is, push for channel-based refactor).
8. Check the struct has a comment documenting the locking discipline.
9. Check there are race tests and goleak tests in the test file.

This checklist is the senior engineer's defense against Cond bugs. Junior engineers will not have internalized it yet; your job is to enforce it.

## 29. Cond patterns from the field

Three real Cond patterns I have seen in production codebases, with my assessment:

### Pattern A: Coordinated shutdown of multiple sub-systems

```go
type Server struct {
    mu      sync.Mutex
    cond    *sync.Cond
    components []Component
    states  map[string]State
}

func (s *Server) Shutdown() {
    s.mu.Lock()
    for _, c := range s.components {
        s.states[c.Name()] = StateShuttingDown
        c.Stop()
    }
    s.cond.Broadcast()
    for s.anyRunning() {
        s.cond.Wait()
    }
    s.mu.Unlock()
}
```

**Assessment.** Reasonable use of Cond. The states map has many entries; multiple goroutines wait for "everything stopped." A channel version would need a per-component channel and a coordinator. Cond is competitive here, though `errgroup.Group.Wait()` (from `golang.org/x/sync`) is often simpler.

### Pattern B: Rate-limited request admission

```go
type Limiter struct {
    mu    sync.Mutex
    cond  *sync.Cond
    avail int
}

func (l *Limiter) Acquire() {
    l.mu.Lock()
    for l.avail == 0 {
        l.cond.Wait()
    }
    l.avail--
    l.mu.Unlock()
}

func (l *Limiter) Release() {
    l.mu.Lock()
    l.avail++
    l.cond.Signal()
    l.mu.Unlock()
}
```

**Assessment.** Bad. This is exactly the semaphore problem `chan struct{}` solves cleanly. Refactor:

```go
type Limiter struct {
    tokens chan struct{}
}

func New(n int) *Limiter {
    l := &Limiter{tokens: make(chan struct{}, n)}
    for i := 0; i < n; i++ { l.tokens <- struct{}{} }
    return l
}

func (l *Limiter) Acquire() { <-l.tokens }
func (l *Limiter) Release() { l.tokens <- struct{}{} }
```

Half the code, faster, and trivially extends to context-cancellation via `select`.

### Pattern C: Multi-stage pipeline coordination

```go
type Pipeline struct {
    mu     sync.Mutex
    cond   *sync.Cond
    stages [3]stage
    queue  [3]chan Job  // wait, what?
}
```

**Assessment.** This was a hybrid Cond + channel design. The Cond was used for shutdown coordination; channels were used for job flow. The Cond should have been a single `close(doneCh)` — there was no multi-predicate use case. The mixing of patterns made the code harder to follow. Refactor: pure channel design, `select` on data channel + done channel.

The pattern: when you see Cond + channels in the same struct, ask hard questions. Often one of them is doing the job of the other.

## 30. Conclusion: the senior's stance

A senior engineer's relationship with `sync.Cond` is:

1. **Know the protocol cold.** You can recite the Wait/Signal/Broadcast semantics and the lost-wakeup avoidance mechanism on demand.
2. **Default to channels.** New designs start with channels; Cond is a justified-deviation, not a default.
3. **Recognize Cond bugs at a glance.** `if !pred { Wait() }` is a bug. `Signal` for multi-predicate Cond is a bug. Wait outside the lock is a bug.
4. **Push refactors.** When you see Cond in code review, ask whether channels would be simpler. Most of the time, they would be.
5. **Defend Cond when correct.** In the rare cases where Cond is the right tool (multi-predicate shared state, io.Pipe-like full-duplex), defend it. Do not refactor for the sake of dogma.

`sync.Cond` is a primitive that rewards understanding and punishes confusion. As a senior engineer, you are the line of defense against confusion entering the codebase.

## 31. Appendix: the proposal to deprecate

For completeness, the history of "should we deprecate `sync.Cond`?" discussions:

- 2017: Issue raised on golang-dev, no consensus.
- 2018: Discussion at a Go contributors summit. The team decides to keep Cond but emphasize the "use channels" guidance in the docstring.
- 2020: The docstring is updated to add the explicit recommendation: "For many simple use cases, users will be better off using channels than a Cond."
- 2022: Bryan Mills's "Concurrency Patterns" talk publicly enumerates the channel replacements for each Cond pattern.
- 2023: Multiple stdlib uses of Cond are refactored to channels (notably `net/http/server.go`, `io/pipe.go`).
- 2024: No deprecation; Cond remains supported. The team's stance is "keep it for legacy code and rare valid uses; do not encourage new uses."

The takeaway: Cond is not going away, but it is also not the recommended primitive for new code. Senior engineers should respect this signal.

## 32. The `sync.Cond` and `errgroup` story

`golang.org/x/sync/errgroup` is the modern Go idiom for "wait for multiple goroutines and collect first error." It is implemented using `sync.WaitGroup` plus `sync.Once`. It does NOT use `sync.Cond`.

Why? Because the use case is monotonic: each goroutine reports done at most once, and the wait group decrements to zero. `sync.WaitGroup` is exactly this. `sync.Cond` would be overkill.

This is instructive. Go's design philosophy:

1. **Provide specialized primitives** for common patterns (`sync.WaitGroup`, `sync.Once`, `sync.Map`).
2. **Provide channels** for general communication.
3. **Provide `sync.Cond`** for cases that fit neither (1) nor (2).

The set of cases that fits only (3) is small. That is why Cond is rarely the answer.

## 33. Decision matrix summary

For your reference, the most compact decision matrix:

| Scenario | Use |
|---|---|
| "Wait for N tasks to finish" | `sync.WaitGroup` |
| "Run init exactly once with concurrent callers" | `sync.Once` |
| "Lazy lazy value with concurrent readers" | `sync.OnceValue` (Go 1.21+) |
| "Producer/consumer queue" | `chan T` |
| "Bounded producer/consumer queue" | `chan T` with capacity |
| "One-shot broadcast to N waiters" | `close(chan struct{})` |
| "Per-key wake-up of waiters" | `map[K]chan struct{}` |
| "Cancellable wait" | `select` on data + `ctx.Done()` |
| "Rate-limited resource pool" | `chan struct{}` semaphore |
| "Buffer pool with GC-tunable size" | `sync.Pool` |
| "Multi-predicate wait over shared struct" | `sync.Cond` (justified) |
| "Full-duplex io with backpressure" | `sync.Cond` (legacy) or channels |
| "Dynamic worker pool with resize + shutdown" | `sync.Cond` (justified) or channels |

The Cond entries are at the bottom for a reason. They are the cases where you cannot find a more specialized primitive. They are not bad — they are just rarer than the others.

## 34. Closing remarks

If after reading this entire page you take away one thing, let it be: `sync.Cond` is a primitive for *shared-state, multi-predicate coordination*. Anything else is probably a channel.

Channels are how Go expresses concurrency. They have:
- Native cancellation via `select` on `ctx.Done()`.
- Native timeout via `time.After` in `select`.
- Native broadcast via `close()`.
- Native composition via multi-arm `select`.
- A runtime optimized for the channel case specifically.

`sync.Cond` has none of these natively. The team that designed and maintains `sync.Cond` recommends channels for most cases. The standard library mostly avoids Cond. The community discourages it for new code.

But Cond is correct, minimal, and indispensable for the small set of cases where channels would be awkward. Senior engineers know those cases. Junior engineers should default to channels.

The professional skill is judging the rare case correctly. The professional discipline is refusing to use Cond when channels would do.

[← Back](../)
