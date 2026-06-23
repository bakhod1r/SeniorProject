---
layout: default
title: When to Use sync.Cond — Tasks
parent: When to Use sync.Cond
grand_parent: Primitives Decision Guide
ancestor: Go
nav_order: 6
has_children: false
permalink: /roadmap/programming-languages/golang/07-concurrency/24-primitives-decision-guide/03-when-to-use-cond/tasks/
---

# When to Use sync.Cond — Tasks

[← Back](../)

These exercises are graded by difficulty. Aim to do them in order. Each has a hidden-bug variant or a comparison step that exposes why `sync.Cond` is harder than it looks.

## Task 1 — Bounded buffer with Cond (warm-up)

**Goal.** Build a fixed-size FIFO queue with `Push` and `Pop` methods. Both block when the buffer is full or empty.

**Requirements.**
- Capacity is set at construction.
- `Push(v int)` blocks if the buffer is full.
- `Pop() int` blocks if the buffer is empty.
- Use exactly one `sync.Mutex` and one `sync.Cond`.

**Skeleton.**

```go
type Buffer struct {
    mu       sync.Mutex
    cond     *sync.Cond
    data     []int
    capacity int
}

func New(capacity int) *Buffer {
    b := &Buffer{capacity: capacity}
    b.cond = sync.NewCond(&b.mu)
    return b
}

func (b *Buffer) Push(v int) {
    // TODO: lock, wait while full, append, broadcast (or signal?), unlock
}

func (b *Buffer) Pop() int {
    // TODO: lock, wait while empty, pop front, broadcast (or signal?), unlock
}
```

**Acceptance.**
- A test with `producers=4` and `consumers=4` that pushes 1000 ints each side terminates with every value accounted for.
- `go test -race` is clean.
- `go vet` is clean.

**Stretch.** Decide whether `Signal` or `Broadcast` is correct here, and justify in a comment.

---

## Task 2 — The same buffer with channels

**Goal.** Rewrite Task 1 using only a buffered channel and a sync wrapper if needed.

**Requirements.**
- The external API (`Push`, `Pop`) is unchanged.
- No `sync.Cond` and no `sync.Mutex`.
- The implementation should be visibly shorter than Task 1.

**Reflection (write this in a comment block at the top of the file).**
- How many lines did Task 1's implementation take?
- How many lines did Task 2's implementation take?
- Which version would you rather debug at 3am?

---

## Task 3 — Multi-condition wakeup

**Goal.** Build a `WaitableMap[K, V]` with a `Wait(key K) V` method that blocks until `key` is set by some other goroutine's `Set(key K, v V)`.

**Requirements.**
- Multiple goroutines may `Wait` on the same key.
- A single `Set` must release *all* of them.
- The map may have many keys; a `Set("foo", v)` must not wake goroutines waiting on `"bar"`.
- Use a single `sync.Mutex` and exactly one `sync.Cond`.

**Why this is interesting.** With one Cond covering many predicates (one per key), `Signal` is unsafe — it could wake a goroutine waiting on the wrong key. The cure is `Broadcast`. Now you have a fan-out cost: every `Set` wakes every waiter. The follow-up question is "could you split this into one Cond per key?" — yes, but then you need to lazily allocate Conds, and the bookkeeping gets ugly. We will redo this with channels in Task 4.

**Skeleton.**

```go
type WaitableMap[K comparable, V any] struct {
    mu   sync.Mutex
    cond *sync.Cond
    data map[K]V
}

func New[K comparable, V any]() *WaitableMap[K, V] {
    m := &WaitableMap[K, V]{data: map[K]V{}}
    m.cond = sync.NewCond(&m.mu)
    return m
}

func (m *WaitableMap[K, V]) Set(k K, v V) {
    // TODO
}

func (m *WaitableMap[K, V]) Wait(k K) V {
    // TODO: loop, Wait, re-check
}
```

**Acceptance.**
- 100 goroutines each `Wait("k" + i)`; 100 other goroutines each `Set("k" + i, i)`. All waiters return with the right value. Total wall time < 100ms on a modern laptop.

---

## Task 4 — `WaitableMap` with channels

**Goal.** Rewrite Task 3 using a `map[K]chan V`.

**Hint.** Each `Wait` gets-or-creates the channel for its key. Each `Set` closes the channel (or sends to it once and then deletes the entry). Closing is preferred because it broadcasts to all current and future receivers without needing to know how many there are.

**Reflection.**
- The Cond version had a `for { ... Wait }` loop. The channel version does not. Why?
- The Cond version's `Set` was O(N) in the number of *all* waiters across all keys. What is the channel version's `Set` cost?

---

## Task 5 — Once-only initialization with Cond

**Goal.** Implement a `LazyValue[T]` whose `Get()` returns a value, calling a provided `init func() T` exactly once even under concurrent callers. Use `sync.Cond` (not `sync.Once`).

**Skeleton.**

```go
type LazyValue[T any] struct {
    mu   sync.Mutex
    cond *sync.Cond

    state int // 0 = uninit, 1 = running, 2 = done
    value T
    init  func() T
}

func New[T any](init func() T) *LazyValue[T] {
    l := &LazyValue[T]{init: init}
    l.cond = sync.NewCond(&l.mu)
    return l
}

func (l *LazyValue[T]) Get() T {
    // TODO:
    //   lock
    //   if done: return value
    //   if running: Wait until done
    //   else: state=running, unlock, call init, lock, state=done, broadcast
    //   return value
}
```

**Tricky bits.**
- You must release the lock around the `init()` call — calling user code under a lock that other goroutines are waiting on is a deadlock waiting to happen.
- After `init` returns, you must take the lock again to write `state=done` and the value, then `Broadcast`.

**Acceptance.**
- A test with `init` that increments an atomic counter, called from 1000 goroutines, sees the counter equal to exactly 1 at the end. Every caller returns the same value.

---

## Task 6 — `LazyValue` with `sync.Once`

**Goal.** Rewrite Task 5 using `sync.Once`.

```go
type LazyValue[T any] struct {
    once  sync.Once
    value T
    init  func() T
}

func (l *LazyValue[T]) Get() T {
    l.once.Do(func() { l.value = l.init() })
    return l.value
}
```

That is six lines. Task 5 is about thirty. **The lesson.** `sync.Once` is `sync.Cond` specialized for the single-shot case, with the correctness baked in. If your "condition" is "I have run once," do not reinvent it.

---

## Task 7 — Dynamic worker-pool resizing (legitimate Cond use)

**Goal.** Build a `WorkerPool` with a configurable size that can grow or shrink at runtime.

**Requirements.**
- `Submit(job func())` queues a job.
- `Resize(n int)` changes the pool size. Growing should start new workers; shrinking should ask `current - n` workers to exit after their current job.
- Use `sync.Cond` for worker idle-waiting *and* for size-change notification.

**Why this is harder than it looks.** Workers need to wake on two unrelated events: "a new job arrived" and "you have been told to exit." A single channel can carry both with sentinel values, but a Cond + shared state is arguably cleaner here because the shared state — the queue, the desired pool size, the actual pool size — all lives behind one mutex anyway.

**Skeleton.**

```go
type WorkerPool struct {
    mu        sync.Mutex
    cond      *sync.Cond
    jobs      []func()
    desired   int
    current   int
    closed    bool
}

func (p *WorkerPool) Submit(job func()) {
    p.mu.Lock()
    p.jobs = append(p.jobs, job)
    p.cond.Signal() // one worker is enough
    p.mu.Unlock()
}

func (p *WorkerPool) Resize(n int) {
    p.mu.Lock()
    p.desired = n
    p.cond.Broadcast() // workers must re-check exit
    p.mu.Unlock()
    // ... grow loop: while current < desired, start a goroutine and current++
}

func (p *WorkerPool) worker() {
    for {
        p.mu.Lock()
        for len(p.jobs) == 0 && p.current <= p.desired && !p.closed {
            p.cond.Wait()
        }
        if p.closed || p.current > p.desired {
            p.current--
            p.mu.Unlock()
            return
        }
        job := p.jobs[0]
        p.jobs = p.jobs[1:]
        p.mu.Unlock()
        job()
    }
}
```

**Acceptance.**
- Resize from 8 → 2 → 16 under load; verify with goroutine-leak detection that exactly the right number of workers are alive afterward.

**Reflection.** Try to redo this with channels. You will find you need at least two channels (jobs and "you must exit") and the channel-of-channels pattern for selecting which worker to terminate. It is doable but arguably more complex than the Cond version. This is one of the rare cases where Cond reads as cleanly as the channel alternative.

---

## Task 8 — Cancellable `Wait` (cond + context)

**Goal.** Build a `CancellableLatch` whose `Wait(ctx context.Context) error` blocks until either the latch is released or the context is done.

**Requirements.**
- The implementation uses `sync.Cond` (this is exercise material; in real code you would use channels).
- A side-broadcaster goroutine is permitted but each `Wait` call must not leak goroutines.
- Returns `nil` if released, `ctx.Err()` if cancelled.

**Skeleton.**

```go
type CancellableLatch struct {
    mu       sync.Mutex
    cond     *sync.Cond
    released bool
}

func New() *CancellableLatch {
    l := &CancellableLatch{}
    l.cond = sync.NewCond(&l.mu)
    return l
}

func (l *CancellableLatch) Release() {
    l.mu.Lock()
    l.released = true
    l.cond.Broadcast()
    l.mu.Unlock()
}

func (l *CancellableLatch) Wait(ctx context.Context) error {
    stop := make(chan struct{})
    go func() {
        select {
        case <-ctx.Done():
            l.mu.Lock()
            l.cond.Broadcast()
            l.mu.Unlock()
        case <-stop:
        }
    }()
    defer close(stop)

    l.mu.Lock()
    for !l.released && ctx.Err() == nil {
        l.cond.Wait()
    }
    err := ctx.Err()
    l.mu.Unlock()
    if l.released {
        return nil
    }
    return err
}
```

**Reflection.**
- Count the goroutines you spawn per `Wait` call.
- Compare with a pure-channel implementation: `select { case <-released: ; case <-ctx.Done(): }`.
- Which is easier to reason about under panics?

---

## Task 9 — Multiple-condition coordinator

**Goal.** Build a `ReadyTracker` that tracks N components' readiness. Goroutines can `WaitAll()` (all components ready) or `WaitAny()` (any component ready).

**Requirements.**
- `MarkReady(i int)` sets component i ready.
- `WaitAll()` and `WaitAny()` are blocking.
- Use exactly one mutex and one or two Conds (your choice; justify in a comment).

**Acceptance.**
- 10 components, 5 `WaitAll` callers, 5 `WaitAny` callers, marks come in randomized order. `WaitAny` callers unblock on first mark; `WaitAll` callers unblock when the last mark arrives.

**Reflection.** This is the kind of multi-predicate scenario where Cond shines: one mutex protects a slice of bools, two distinct conditions are waited on. Try rewriting with channels and report whether the readability improves.

---

## Submission checklist

- All tests pass with `go test ./... -race -count=3`.
- `go vet ./...` is clean.
- `golangci-lint run` is clean.
- Each file has a top-of-file comment block stating which Task it implements and the approximate line counts of Cond-vs-channel variants where applicable.

## Grading rubric

For each task, you receive points on these axes:

| Axis | Description | Weight |
|---|---|---|
| Correctness | Tests pass under `-race -count=3` | 40% |
| Idiom | `for !pred { Wait }` pattern used; `Broadcast` vs `Signal` chosen correctly | 20% |
| Comparison | Cond and channel variants both built, line counts compared in a comment | 15% |
| Reflection | Written explanation of which variant you would maintain in production | 15% |
| Code quality | Clean structure, descriptive names, no dead code | 10% |

A passing submission requires at least 70% across all tasks.

## Common pitfalls to watch for

While completing these tasks, watch for the bugs listed in find-bug.md:

1. `Wait` without holding the lock — instant panic.
2. `if` instead of `for` around `Wait` — sporadic correctness failures.
3. `Signal` with multiple predicates — lost wakeups.
4. Copying the Cond — runtime panic on first use after copy.
5. Modifying predicate without the lock, then signalling — lost-wakeup race.

If you encounter any of these in your own implementation, do not just patch the symptom — note in your reflection what failure mode you hit and how you diagnosed it.

[← Back](../)
