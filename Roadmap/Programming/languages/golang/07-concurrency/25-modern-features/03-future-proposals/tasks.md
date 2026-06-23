---
layout: default
title: Future Proposals — Tasks
parent: Future Concurrency Proposals
grand_parent: Modern Concurrency Features
ancestor: Go
nav_order: 6
has_children: false
permalink: /roadmap/programming-languages/golang/07-concurrency/25-modern-features/03-future-proposals/tasks/
---

# Future Proposals — Tasks

[← Back](../)

These tasks let you touch each proposal that has shipped in any form, and write polyfills for
the ones still under discussion. Pin your Go toolchain to 1.24 or later for the synctest,
weak, and AddCleanup tasks. For experimental features, set `GOEXPERIMENT=synctest` in the
environment when running tests.

The tasks are deliberately small — each should take an hour or less. The goal is to give you
muscle memory with the new APIs, not to build a full library.

---

## Task 1 — Test a retry loop with testing/synctest

Write a function `RetryWithBackoff(ctx context.Context, op func() error) error` that retries
`op` with exponential backoff (100ms, 200ms, 400ms, ...) up to 5 attempts. Then write a test
that:

1. Uses `synctest.Run` to bubble the test.
2. Asserts that the function returns success after the third attempt when `op` fails twice
   and then succeeds.
3. Asserts that the elapsed synthetic time is between 300ms and 350ms (100 + 200 = 300ms of
   sleep).
4. Runs in **microseconds** of real wall time despite the 300ms of synthetic sleep.

Skeleton:

```go
//go:build goexperiment.synctest

package retry

import (
    "context"
    "testing"
    "testing/synctest"
    "time"
)

func TestRetryWithBackoff(t *testing.T) {
    synctest.Run(func() {
        start := time.Now()
        attempts := 0
        err := RetryWithBackoff(context.Background(), func() error {
            attempts++
            if attempts < 3 {
                return errFake
            }
            return nil
        })
        if err != nil {
            t.Fatal(err)
        }
        if attempts != 3 {
            t.Fatalf("attempts = %d, want 3", attempts)
        }
        elapsed := time.Since(start)
        if elapsed < 300*time.Millisecond || elapsed > 350*time.Millisecond {
            t.Fatalf("synthetic elapsed = %v, want ~300ms", elapsed)
        }
    })
}
```

**Bonus:** add a second test that asserts the function returns the last error after 5 attempts
when `op` always fails. Synthetic elapsed should be `100+200+400+800+1600 = 3100ms` and real
elapsed should still be microseconds.

**Stretch:** add a third test using `synctest.Wait()` to verify the function is sleeping
between attempts rather than spinning. The test should call `Wait` to confirm all goroutines
are blocked, then assert that no more than one attempt has been made.

---

## Task 2 — Build a coroutine using iter.Pull

Implement a Fibonacci generator using `iter.Pull` rather than a goroutine + channel. Measure
the per-step latency against the goroutine version.

```go
package fib

import "iter"

func Sequence() iter.Seq[uint64] {
    return func(yield func(uint64) bool) {
        var a, b uint64 = 0, 1
        for {
            if !yield(a) {
                return
            }
            a, b = b, a+b
        }
    }
}

func Take(n int) []uint64 {
    next, stop := iter.Pull(Sequence())
    defer stop()
    out := make([]uint64, 0, n)
    for i := 0; i < n; i++ {
        v, _ := next()
        out = append(out, v)
    }
    return out
}
```

**Benchmark task:** write a `BenchmarkPullVsChan` that compares 1000 `next()` calls against
1000 channel receives from a goroutine generator. Expect roughly 5-10x speedup with `iter.Pull`
on modern amd64.

**Reflection:** when you measure on your machine, what is the actual ratio? Is it sensitive to
the per-step work (e.g. if the iterator does a heavy computation, the channel overhead becomes
proportionally smaller)?

---

## Task 3 — Weak-pointer polyfill using sync.Map and a cleanup hook

Build a polyfill `WeakRef[T]` for Go versions before 1.24 (or as a teaching exercise even on
1.24). Backing store: a `sync.Map` of `uintptr` to `*T` with a finalizer on each `*T` that
removes its entry.

```go
package weakref

import (
    "runtime"
    "sync"
    "unsafe"
)

type Ref[T any] struct {
    key uintptr
}

var store sync.Map // map[uintptr]*T (untyped because Go generics + sync.Map)

func Make[T any](p *T) Ref[T] {
    key := uintptr(unsafe.Pointer(p))
    store.Store(key, p)
    runtime.SetFinalizer(p, func(*T) { store.Delete(key) })
    return Ref[T]{key: key}
}

func (r Ref[T]) Get() *T {
    v, ok := store.Load(r.key)
    if !ok {
        return nil
    }
    return v.(*T)
}
```

**Discussion:** what's wrong with this polyfill compared to `weak.Pointer`? Hint: it actually
keeps the object alive via the `sync.Map` entry, defeating weakness. Fix it by storing
`unsafe.Pointer` and using `runtime.KeepAlive` carefully — or accept that a true weak polyfill
is impossible without runtime support, which is exactly why `weak.Pointer` had to be added.

**Bonus:** rewrite the polyfill to use `runtime.AddCleanup` instead of `SetFinalizer`, and
discuss the differences.

---

## Task 4 — Migrate SetFinalizer code to AddCleanup

Take this snippet:

```go
type DB struct {
    f *os.File
}

func Open(path string) (*DB, error) {
    f, err := os.Open(path)
    if err != nil {
        return nil, err
    }
    db := &DB{f: f}
    runtime.SetFinalizer(db, func(db *DB) { db.f.Close() })
    return db, nil
}
```

Rewrite using `runtime.AddCleanup`:

```go
func Open(path string) (*DB, error) {
    f, err := os.Open(path)
    if err != nil {
        return nil, err
    }
    db := &DB{f: f}
    runtime.AddCleanup(db, func(f *os.File) { f.Close() }, f)
    return db, nil
}
```

Note the cleanup function does not receive `db`. It takes `f` as a captured argument. This is
structurally safer because there is no way to resurrect `db` from inside the cleanup.

**Stretch:** add a `Close()` method that cancels the cleanup via the returned `Cleanup.Stop`
and closes the file explicitly. Write a test that creates and closes 1000 DBs in a loop and
asserts no file descriptors leak.

---

## Task 5 — Automatic GOMAXPROCS in your own init

Write a package `automax` that:

1. Detects whether the process is running in a cgroup v2 container (read
   `/sys/fs/cgroup/cpu.max`).
2. Parses `quota period` and computes `ceil(quota / period)`.
3. Calls `runtime.GOMAXPROCS` with the result, clamped to at least 1.

Smoke test by running inside Docker with `--cpus=1.5` and verifying `runtime.GOMAXPROCS(0)`
returns 2.

**Bonus:** add cgroup v1 fallback for older container runtimes. The files are
`/sys/fs/cgroup/cpu/cpu.cfs_quota_us` and `cpu.cfs_period_us`.

**Stretch:** add an environment variable override (`MY_GOMAXPROCS=4`) that wins over the
cgroup detection. This is the same shape as the real `GOMAXPROCS` env var.

---

## Task 6 — Structured-concurrency wrapper with errgroup

Build a `Scope` type that enforces structured concurrency on top of `errgroup`:

```go
package scope

import (
    "context"
    "golang.org/x/sync/errgroup"
)

type Scope struct {
    g   *errgroup.Group
    ctx context.Context
}

func Run(ctx context.Context, f func(s *Scope)) error {
    g, gctx := errgroup.WithContext(ctx)
    s := &Scope{g: g, ctx: gctx}
    f(s)
    return s.g.Wait()
}

func (s *Scope) Go(f func(ctx context.Context) error) {
    s.g.Go(func() error { return f(s.ctx) })
}
```

Usage:

```go
err := scope.Run(ctx, func(s *scope.Scope) {
    s.Go(func(ctx context.Context) error { return fetchA(ctx) })
    s.Go(func(ctx context.Context) error { return fetchB(ctx) })
})
```

This gives you "function does not return until children finish" without any new syntax —
which is the committee's case against language-level structured concurrency.

**Reflection:** what would change if Go added a language-level `go group { ... }` block? Would
your `Scope` type be obsolete, or would it still have a niche?

---

## Task 7 — Atomic vector op polyfill

For a `(pointer, generation)` ABA-resistant pointer, write a polyfill using a mutex on
platforms without 128-bit CAS:

```go
type TaggedPointer[T any] struct {
    mu  sync.Mutex
    ptr *T
    gen uint64
}

func (t *TaggedPointer[T]) Load() (*T, uint64) {
    t.mu.Lock()
    defer t.mu.Unlock()
    return t.ptr, t.gen
}

func (t *TaggedPointer[T]) CAS(oldPtr *T, oldGen uint64, newPtr *T) bool {
    t.mu.Lock()
    defer t.mu.Unlock()
    if t.ptr != oldPtr || t.gen != oldGen {
        return false
    }
    t.ptr = newPtr
    t.gen = oldGen + 1
    return true
}
```

Discuss: when would you reach for this over a plain `atomic.Pointer[T]`? Answer: only when the
ABA window is real — typically lock-free stacks and freelists where a popped node may be
pushed back later.

**Benchmark:** compare `TaggedPointer[T].CAS` against `atomic.Pointer[T].CompareAndSwap` under
no contention, light contention (2 goroutines), and heavy contention (16 goroutines). The
mutex version should be roughly 2x slower under no contention and dramatically slower under
heavy contention.

---

## Task 8 — Stretch: forward-port a Trio nursery sketch

Sketch what a Go API would look like that strictly enforces "all goroutines launched in this
block finish before the block exits." You can use closures, defer, and panic recovery to
approximate it. Compare your sketch to the proposal in issue
[#40221](https://go.dev/issue/40221) and write down three differences.

There is no right answer — the exercise is to understand why the committee finds none of the
existing sketches compelling enough to standardize. Common findings:

- Panic propagation is tricky: should a panic in one child kill siblings, or just propagate to
  the parent after siblings finish?
- Cancellation is tricky: the obvious answer is "cancel the context when any child errors,"
  but Trio doesn't do exactly that, and there are reasons for both behaviors.
- Error aggregation is tricky: first error wins, all errors collected, or something else?

Write your design choices down explicitly. This is the conversation a committee has to settle
before any language-level structured concurrency can land.

---

## Task 9 — Compare iter.Pull and goroutine memory usage

Allocate 10000 iterators using `iter.Pull` and 10000 generator goroutines, then dump heap
profiles for each. Measure RSS via `runtime.MemStats`.

```go
func benchmarkPullMem(n int) {
    nexts := make([]func() (int, bool), n)
    stops := make([]func(), n)
    for i := 0; i < n; i++ {
        next, stop := iter.Pull(intSeq())
        nexts[i] = next
        stops[i] = stop
    }
    runtime.GC()
    var m runtime.MemStats
    runtime.ReadMemStats(&m)
    fmt.Printf("Pull: HeapAlloc=%dKB\n", m.HeapAlloc/1024)
    for _, s := range stops {
        s()
    }
}
```

Goroutine equivalent uses a buffered channel. Expect the coroutine version to use roughly half
the memory because coroutine stacks are smaller initially.

**Reflection:** does this match your expectations? What does it tell you about choosing
between coroutines and goroutines for highly concurrent producers?

---

## Task 10 — Reading proposal docs

Pick a proposal from this page that interests you. Find its design doc on the
`golang/proposal` repo and read it end-to-end. Write a one-paragraph summary covering:

- Problem the proposal solves.
- Main API surface.
- Open design questions still being debated.
- Your view on whether it should land as-is, with modifications, or be declined.

This is the exercise that builds real intuition for Go API design. Do it for one proposal a
month and you'll be ahead of most engineers in your team.
