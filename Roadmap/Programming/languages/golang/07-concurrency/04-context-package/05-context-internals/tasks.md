# Context Internals — Tasks

[← Back to index](index.md)

## How to Use This Page

Each task is a self-contained exercise that pushes you to reproduce, instrument, or extend a piece of the `context` package. Hints and starting code are provided. Reference solutions are not — solving the tasks is the point.

Estimated time per task is listed in the heading. Work in order; later tasks build on earlier ones.

---

## Task 1 — Implement `emptyCtx` From Scratch (15 min)

Re-create the singleton-style empty context. Your type must:

- Implement the four `Context` methods.
- Return `nil` from `Done()`.
- Return `nil` from `Err()`.
- Return `(time.Time{}, false)` from `Deadline()`.
- Return `nil` from `Value(any)`.

Starting code:

```go
package mini

import (
    "time"
)

type Context interface {
    Deadline() (time.Time, bool)
    Done() <-chan struct{}
    Err() error
    Value(key any) any
}

type emptyCtx struct{}

// TODO: implement the methods.

func Background() Context {
    return emptyCtx{}
}
```

Validation: `_ = Context(Background())` should compile, and calls to all four methods should return the expected zeros.

Hint: this type is so small that the entire implementation fits in 12 lines.

---

## Task 2 — Implement `valueCtx` (20 min)

Add a `valueCtx` to your mini-package. Requirements:

- Stores parent, key, value.
- `Value(k)` returns its own value if `k == c.key`, otherwise asks the parent.
- All other methods delegate to the parent.
- `WithValue(parent, k, v)` validates that `k` is non-nil and comparable.

Hint: comparability check requires `reflect.TypeOf(k).Comparable()` (full `reflect` is fine for the exercise).

Validation:

```go
ctx := mini.Background()
ctx = mini.WithValue(ctx, "user", 42)
if v := ctx.Value("user").(int); v != 42 {
    t.Fatal("wrong value")
}
if v := ctx.Value("missing"); v != nil {
    t.Fatal("expected nil")
}
```

Edge cases to think about:

- What happens if the same key is added twice? Innermost wins.
- What happens if the key is an uncomparable type like `[]byte`? Panic on `WithValue`.

---

## Task 3 — Implement a Simple `cancelCtx` (45 min)

Build a cancelable context. It must:

- Allocate a `chan struct{}` lazily on first `Done()` call.
- Be safe under concurrent `Done()`, `Err()`, and `cancel()` calls.
- Return `Canceled` from `Err()` after cancellation.
- Be idempotent: multiple calls to `cancel()` are safe.

Starting code:

```go
type cancelCtx struct {
    Context
    mu   sync.Mutex
    done atomic.Value  // chan struct{}
    err  atomic.Value  // error
}

var Canceled = errors.New("canceled")

func (c *cancelCtx) Done() <-chan struct{} {
    // TODO: double-checked locking pattern
}

func (c *cancelCtx) Err() error {
    // TODO
}

func (c *cancelCtx) cancel() {
    // TODO
}

func WithCancel(parent Context) (Context, func()) {
    c := &cancelCtx{Context: parent}
    return c, c.cancel
}
```

Validation:

```go
ctx, cancel := mini.WithCancel(mini.Background())
go func() { time.Sleep(50 * time.Millisecond); cancel() }()

select {
case <-ctx.Done():
    if !errors.Is(ctx.Err(), mini.Canceled) {
        t.Fatal("wrong err")
    }
case <-time.After(time.Second):
    t.Fatal("timeout")
}
```

Bonus: write a stress test that spins up 1000 goroutines all calling `cancel()` simultaneously. Verify exactly one observable cancellation occurred.

---

## Task 4 — Wire Parent-Child Cancellation (45 min)

Extend Task 3 so a child `cancelCtx` is canceled when its parent is canceled. You may pick either approach:

- **Slow path**: spawn a goroutine in `WithCancel` that watches `parent.Done()` and calls `child.cancel()` when it fires.
- **Fast path**: maintain a children map; the parent's `cancel` cascades into each child.

For this task, do **both**. Implement the slow path first, then the fast path, then make `WithCancel` dispatch correctly: use the fast path when the parent is one of your own `*cancelCtx`s, else the slow path.

Validation:

```go
parent, cancelParent := mini.WithCancel(mini.Background())
child, _ := mini.WithCancel(parent)

cancelParent()

select {
case <-child.Done():
    // ok
case <-time.After(100 * time.Millisecond):
    t.Fatal("child not canceled")
}
```

Plus a benchmark comparing fast vs slow path:

```go
func BenchmarkSlow(b *testing.B) {
    parent := slowParent()  // not a *cancelCtx
    b.ResetTimer()
    for i := 0; i < b.N; i++ {
        _, c := mini.WithCancel(parent)
        c()
    }
}

func BenchmarkFast(b *testing.B) {
    parent, _ := mini.WithCancel(mini.Background())
    b.ResetTimer()
    for i := 0; i < b.N; i++ {
        _, c := mini.WithCancel(parent)
        c()
    }
}
```

You should see ~10× allocation reduction on the fast path and roughly 0 extra goroutines.

---

## Task 5 — Add `removeChild` (30 min)

When a child cancels (via its own `cancel()`), it should remove itself from its parent's children map so the parent does not leak references.

Modify your fast-path code from Task 4 so:

- A child cancelling via its own `CancelFunc` deletes itself from the parent's children map.
- A child cancelling as part of the parent's cascade does **not** try to remove itself (the parent will nil the whole map).

Use a `removeFromParent bool` parameter on the internal `cancel` method, as the standard library does.

Validation:

```go
parent, cancelParent := mini.WithCancel(mini.Background())
_, cancelChild := mini.WithCancel(parent)
cancelChild()

// Check that parent's children map is now empty.
if n := numChildren(parent); n != 0 {
    t.Fatalf("expected 0 children, got %d", n)
}

cancelParent()
```

(`numChildren` is a test-only accessor you add to your package.)

---

## Task 6 — Implement `WithDeadline` (45 min)

Build on Task 5. `WithDeadline(parent, t)` should:

- If `t` has passed, return an immediately-canceled context with `DeadlineExceeded`.
- If `parent` has an earlier deadline, return `WithCancel(parent)` (no timer).
- Otherwise, arm a `time.Timer` to call `cancel(true, DeadlineExceeded)` at `t`.

Add a `timerCtx` struct that embeds your `cancelCtx`. Override `cancel` to stop the timer.

Validation:

```go
ctx, _ := mini.WithDeadline(mini.Background(), time.Now().Add(50*time.Millisecond))
<-ctx.Done()
if !errors.Is(ctx.Err(), mini.DeadlineExceeded) {
    t.Fatal("wrong err")
}
```

Edge cases:

- Calling `cancel()` before the deadline expires should result in `Canceled`, not `DeadlineExceeded`.
- The timer must be stopped on manual cancel.

---

## Task 7 — Implement `WithCancelCause` and `Cause` (30 min)

Add cause-tracking. Requirements:

- A new `WithCancelCause(parent) (Context, func(error))`.
- The returned func takes an error; when called, sets `cause` on the cancelCtx.
- A new `Cause(ctx) error` package function.
- `Err(ctx)` still returns `Canceled` (or `DeadlineExceeded`); `Cause` returns the user-supplied error or falls back to `Err`.

Hint: store `cause` in the `cancelCtx` struct (plain field, mutex-protected). For `Cause`, walk up the chain. Use a sentinel package-level variable's address as the lookup key.

Validation:

```go
ctx, cancel := mini.WithCancelCause(mini.Background())
cancel(errors.New("specific reason"))

if !errors.Is(ctx.Err(), mini.Canceled) {
    t.Fatal("wrong err")
}
if c := mini.Cause(ctx); c.Error() != "specific reason" {
    t.Fatal("wrong cause")
}
```

---

## Task 8 — Implement `AfterFunc` (60 min)

`AfterFunc(ctx, f)` schedules `f` to run when `ctx` is canceled. Returns a `stop func() bool` that aborts scheduling.

Requirements:

- If `ctx` is canceled, run `f` on a new goroutine — never inline.
- If `stop()` is called before cancel, `f` does not run.
- `stop()` returns `true` if it prevented `f`, `false` otherwise.
- Both `stop()` and the parent cancel may race; exactly one outcome.

Use `sync.Once` to guarantee at-most-once dispatch.

Validation:

```go
ctx, cancel := mini.WithCancel(mini.Background())
done := make(chan struct{})
stop := mini.AfterFunc(ctx, func() { close(done) })

cancel()

select {
case <-done:
    // ok
case <-time.After(100 * time.Millisecond):
    t.Fatal("f did not run")
}
if stop() {
    t.Fatal("stop should return false after cancel")
}
```

Add another test where `stop()` is called first; verify `f` never runs.

---

## Task 9 — Implement `WithoutCancel` (30 min)

`WithoutCancel(parent)` strips cancellation while preserving values.

Requirements:

- `Done()` returns nil.
- `Err()` returns nil.
- `Deadline()` returns zero values.
- `Value(k)` walks the parent chain.
- A child derived from `WithoutCancel(parent)` is **not** canceled when `parent` is canceled.

Hint: in your `value()` walker, add a special case for the `WithoutCancel` boundary type. The lookup of your `&cancelCtxKey` sentinel must return nil when crossing the boundary, so that `parentCancelCtx` cannot find a cancelable ancestor through it.

Validation:

```go
parent, cancelParent := mini.WithCancel(mini.Background())
parent = mini.WithValue(parent, "k", "v")

detached := mini.WithoutCancel(parent)
child, _ := mini.WithCancel(detached)

cancelParent()
time.Sleep(50 * time.Millisecond)

if err := child.Err(); err != nil {
    t.Fatalf("child should not be canceled, got %v", err)
}
if v := child.Value("k"); v != "v" {
    t.Fatalf("value not inherited, got %v", v)
}
```

---

## Task 10 — Build a Benchmark Harness (45 min)

Compare your mini-package to the standard library. Construct chains of varying depth:

```go
func benchChain(n int) {
    ctx := stdctx.Background()
    var cancels []stdctx.CancelFunc
    for i := 0; i < n; i++ {
        c, cancel := stdctx.WithCancel(ctx)
        ctx = c
        cancels = append(cancels, cancel)
    }
    for _, c := range cancels {
        c()
    }
}
```

Benchmark:

- Construction time per chain depth (1, 5, 10, 50, 100).
- `ctx.Value(missingKey)` lookup time at each depth.
- Memory used per derivation.

Report your mini package's relative speed. If you are within 2× of the standard library, you understand the package's optimisations. If you are 10× slower, find which one you skipped.

---

## Task 11 — Detect the Slow Path in Production (45 min)

The standard library has an unexported `goroutines atomic.Int32` counter. You cannot read it from outside the package — but you can detect slow-path spawns indirectly.

Write a benchmark that:

1. Defines a custom Context type that implements `Done()` but does not forward `&cancelCtxKey` and does not implement `afterFuncer`.
2. Calls `context.WithCancel(custom)` N times.
3. Compares `runtime.NumGoroutine()` before and after.

A slow path means each derivation spawns a goroutine. If the delta is roughly N (before cancellation), you proved the slow path. If the delta is 0, you cheated somewhere.

```go
type slow struct{ done chan struct{} }
func (s slow) Deadline() (time.Time, bool) { return time.Time{}, false }
func (s slow) Done() <-chan struct{}       { return s.done }
func (s slow) Err() error                  { return nil }
func (s slow) Value(any) any               { return nil }
```

```go
func TestSlowPath(t *testing.T) {
    p := slow{done: make(chan struct{})}
    runtime.GC()
    pre := runtime.NumGoroutine()
    var cs []context.CancelFunc
    for i := 0; i < 1000; i++ {
        _, c := context.WithCancel(p)
        cs = append(cs, c)
    }
    post := runtime.NumGoroutine()
    t.Logf("delta=%d", post-pre)
    if post-pre < 900 {
        t.Fatalf("expected ~1000 extra goroutines, got %d", post-pre)
    }
    for _, c := range cs { c() }
}
```

Then write the same test but make `slow` implement `AfterFunc(func()) func() bool` and verify the delta drops to ~0.

---

## Task 12 — Prove the Lazy `Done` Channel (30 min)

Write a test that creates 1,000,000 cancelCtxes, never calls `Done()` on any of them, then calls `cancel()` on each. Measure the heap with `runtime.ReadMemStats`.

Compare to the same test where you call `Done()` on each context. The first test should use significantly less heap (no `make(chan struct{})` allocation per context).

Hint: the standard library uses `var closedchan` as a shared closed channel for never-observed contexts. You can observe this by comparing channel identity:

```go
ctx, cancel := context.WithCancel(context.Background())
cancel()
d1 := ctx.Done()

ctx2, cancel2 := context.WithCancel(context.Background())
cancel2()
d2 := ctx2.Done()

if d1 != d2 {
    t.Log("not shared — they each have their own closed channel")
} else {
    t.Log("shared — both point to closedchan")
}
```

Run with Go 1.21+. You should see `d1 == d2`.

---

## Task 13 — Reproduce the Children Map Leak (30 min)

Demonstrate the children-map memory leak.

1. Create a long-lived `parent, _ := context.WithCancel(context.Background())`.
2. In a loop, do `_, _ = context.WithCancel(parent)`. Discard the cancel func.
3. Force GC: `runtime.GC()`.
4. Take a heap snapshot: `runtime/pprof.WriteHeapProfile`.

Verify that the heap contains `N` instances of `cancelCtx` even though only the parent is reachable from user code.

Now repeat the same test but call the returned `cancel` function each iteration:

```go
_, cancel := context.WithCancel(parent)
cancel()
```

Heap should now show only 1 cancelCtx (the parent's).

This task is the experimental proof of why `go vet -lostcancel` exists.

---

## Task 14 — Build a Visualiser (60 min)

Write a function `Visualise(ctx context.Context) string` that returns an ASCII representation of the context tree under `ctx`. You cannot inspect unexported fields directly, but you can:

- Use `fmt.Sprintf("%T", ctx)` to get the dynamic type.
- Use `ctx.Deadline()` to check for a timerCtx.
- Use `ctx.Value(&yourSentinel)` to walk values.

Sample output:

```
context.Background
└── *context.cancelCtx (manually canceled)
    └── *context.timerCtx (deadline=2026-05-11T18:00:00Z)
        └── *context.valueCtx (key=traceKey, val="abc")
```

Useful for debugging. Production-grade implementations exist in tracing libraries.

Hint: walking the parent chain requires either reflection (`unsafe.Pointer` to read the embedded `Context` field) or wrapping every `context.With*` call in your own package that records parent relationships. The reflection approach is more general but fragile across Go versions.

---

## Task 15 — Implement Your Own `errgroup`-Like (75 min)

`golang.org/x/sync/errgroup` builds on context. Implement a minimal version:

```go
type Group struct {
    cancel context.CancelCauseFunc
    wg     sync.WaitGroup
    err    error
    once   sync.Once
}

func WithContext(ctx context.Context) (*Group, context.Context) {
    ctx, cancel := context.WithCancelCause(ctx)
    return &Group{cancel: cancel}, ctx
}

func (g *Group) Go(f func() error) {
    g.wg.Add(1)
    go func() {
        defer g.wg.Done()
        if err := f(); err != nil {
            g.once.Do(func() {
                g.err = err
                g.cancel(err)
            })
        }
    }()
}

func (g *Group) Wait() error {
    g.wg.Wait()
    return g.err
}
```

Tasks within this task:

1. Implement and unit-test the above.
2. Verify that the first failing goroutine causes all others' contexts to cancel.
3. Verify that `context.Cause(ctx)` returns the failing goroutine's error.
4. Add a `SetLimit(n)` method that bounds concurrency using `golang.org/x/sync/semaphore`.
5. Benchmark against the real errgroup.

This task forces you to combine `WithCancelCause`, `Cause`, and `sync.WaitGroup` into a coherent abstraction. Most senior Go engineers have written something like this once.

---

## Task 16 — Find the Performance Cliff (45 min)

Construct a chain of `WithValue` calls of increasing depth. For each depth, measure:

- The cost of `ctx.Value(deepestKey)`.
- The cost of `ctx.Value(missingKey)`.
- The cost of `context.WithCancel(ctx)` derived from this chain.

Plot the three measurements vs depth. You should see:

- `Value(deepestKey)` and `Value(missingKey)`: linear in depth.
- `WithCancel(ctx)`: roughly constant (because `parentCancelCtx` walks the chain once but the work is the same regardless of where the cancelCtx sits).

Identify the depth at which `Value` lookup exceeds 1 microsecond. On modern hardware, this is around chain depth 100. Document the curve and post it on your team's wiki.

---

## Submission Notes

These tasks are designed to be self-graded. Use the validation snippets and benchmarks as your test suite. If your implementation passes the validations and your benchmarks are within 2× of the standard library, you have completed the curriculum.

If you write a public package implementing your mini-`context`, include the disclaimer: "for educational purposes only; use `context` from the standard library in production."

Next: [find-bug.md](find-bug.md) — code review exercises with internal-level bugs.
