# Fan-In — Hands-on Tasks

> Practical exercises ordered easy to hard. Each task states the goal, provides hints, ends with a runnable solution and a short explanation. The pattern is always the same: many input channels, one output channel, the merge function in the middle. Treat each solution as a starting point and run it under `go run -race` before you trust it.

---

## Easy

### Task 1 — Implement a basic two-channel merge

Write a function `merge2(a, b <-chan int) <-chan int` that returns a single channel carrying every value from both inputs. The output must be closed once both inputs are drained.

**Hints:**
- One forwarder goroutine per input.
- Use `sync.WaitGroup` to know when both forwarders are done.
- Add a separate closer goroutine that calls `wg.Wait()` then `close(out)`.
- Do **not** call `close(out)` from inside a forwarder.

**Success criteria:**
- Consumer using `for v := range merge2(a, b)` exits cleanly when both producers close their channels.
- Consumer receives exactly the union of values produced.
- `go test -race` reports no warnings.

**Solution:**

```go
package main

import (
    "fmt"
    "sync"
)

func merge2(a, b <-chan int) <-chan int {
    out := make(chan int)
    var wg sync.WaitGroup
    wg.Add(2)

    forward := func(c <-chan int) {
        defer wg.Done()
        for v := range c {
            out <- v
        }
    }

    go forward(a)
    go forward(b)

    go func() {
        wg.Wait()
        close(out)
    }()

    return out
}

func gen(values ...int) <-chan int {
    out := make(chan int)
    go func() {
        defer close(out)
        for _, v := range values {
            out <- v
        }
    }()
    return out
}

func main() {
    a := gen(1, 2, 3)
    b := gen(10, 20, 30)
    for v := range merge2(a, b) {
        fmt.Println(v)
    }
}
```

**Explanation.** Each forwarder owns exactly one input channel. The `range` loop exits cleanly when its input is closed. `defer wg.Done()` makes the bookkeeping correct even if a panic happens inside the loop. The closer goroutine is the **single** place the output is closed; that is what avoids the "close of closed channel" panic.

---

### Task 2 — Generic N-channel merge with generics (Go 1.18+)

Generalise Task 1 into a variadic, generic function `Merge[T any](cs ...<-chan T) <-chan T`. The implementation must accept any element type and any number of inputs — including zero.

**Hints:**
- The signature is `Merge[T any](cs ...<-chan T) <-chan T`.
- Loop over `cs` and launch one forwarder per channel.
- An empty `cs` is valid: the WaitGroup counter starts at zero and the closer fires immediately.
- The output's element type must match `T` — do not convert through `any`.

**Solution:**

```go
package channels

import "sync"

func Merge[T any](cs ...<-chan T) <-chan T {
    out := make(chan T)
    var wg sync.WaitGroup
    wg.Add(len(cs))

    forward := func(c <-chan T) {
        defer wg.Done()
        for v := range c {
            out <- v
        }
    }

    for _, c := range cs {
        go forward(c)
    }

    go func() {
        wg.Wait()
        close(out)
    }()

    return out
}
```

Tiny demo:

```go
func main() {
    a := gen("alpha", "beta")
    b := gen("gamma")
    for v := range Merge(a, b) {
        fmt.Println(v)
    }
}
```

**Explanation.** Generics let you keep one helper instead of one per element type. The variadic signature scales from zero inputs upward. The empty case (`Merge[int]()`) closes the output immediately — useful in tests and as a base case for recursive callers.

---

### Task 3 — Cancellable merge respecting `context.Context`

Junior code leaks if the consumer stops reading early. Rewrite `Merge` to take a `context.Context` and unwind cleanly when the context is cancelled.

**Hints:**
- Replace `out <- v` with a `select` over `ctx.Done()` and `out <- v`.
- Replace the inner `range` with a `select` over `ctx.Done()` and the input channel.
- Both selects are required — without the second, the forwarder leaks if the consumer is gone.
- Close the output exactly once after `wg.Wait()`.

**Solution:**

```go
package channels

import (
    "context"
    "sync"
)

func Merge[T any](ctx context.Context, cs ...<-chan T) <-chan T {
    out := make(chan T)
    var wg sync.WaitGroup
    wg.Add(len(cs))

    forward := func(c <-chan T) {
        defer wg.Done()
        for {
            select {
            case <-ctx.Done():
                return
            case v, ok := <-c:
                if !ok {
                    return
                }
                select {
                case <-ctx.Done():
                    return
                case out <- v:
                }
            }
        }
    }

    for _, c := range cs {
        go forward(c)
    }

    go func() {
        wg.Wait()
        close(out)
    }()

    return out
}
```

Demo with cancellation:

```go
func main() {
    ctx, cancel := context.WithCancel(context.Background())
    defer cancel()

    a := genForever(1)
    b := genForever(100)

    n := 0
    for v := range Merge(ctx, a, b) {
        fmt.Println(v)
        n++
        if n == 5 {
            cancel()
        }
    }
}
```

**Explanation.** The two-`select` pattern is the canonical cancellation-safe forwarder. The first select waits for either an input value or cancellation. The second select guards the send — without it, after the consumer has stopped reading, the forwarder would block on `out <- v` forever. With both selects in place, `cancel()` causes every forwarder to return within at most one iteration.

---

### Task 4 — Order-preserving merge with sequence numbers

Standard fan-in does not preserve order. Build a **stable** merge that emits values in the order they were produced *across the inputs*, assuming each input attaches a monotonically increasing global sequence number.

**Hints:**
- Define `type Seq[T any] struct { N int64; V T }`.
- The producer assigns sequence numbers from a shared `atomic.Int64`.
- Downstream of `Merge`, run a re-orderer that buffers values into a `container/heap` keyed by `N` and emits them in order.
- Use `heap.Push` and `heap.Pop` from the `container/heap` package.

**Solution:**

```go
package main

import (
    "container/heap"
    "fmt"
    "sync"
    "sync/atomic"
)

type Seq[T any] struct {
    N int64
    V T
}

type seqHeap []Seq[int]

func (h seqHeap) Len() int            { return len(h) }
func (h seqHeap) Less(i, j int) bool  { return h[i].N < h[j].N }
func (h seqHeap) Swap(i, j int)       { h[i], h[j] = h[j], h[i] }
func (h *seqHeap) Push(x any)         { *h = append(*h, x.(Seq[int])) }
func (h *seqHeap) Pop() any {
    old := *h
    n := len(old)
    x := old[n-1]
    *h = old[:n-1]
    return x
}

var counter atomic.Int64

func gen(values ...int) <-chan Seq[int] {
    out := make(chan Seq[int])
    go func() {
        defer close(out)
        for _, v := range values {
            out <- Seq[int]{N: counter.Add(1), V: v}
        }
    }()
    return out
}

func merge(cs ...<-chan Seq[int]) <-chan Seq[int] {
    out := make(chan Seq[int])
    var wg sync.WaitGroup
    wg.Add(len(cs))
    for _, c := range cs {
        go func(c <-chan Seq[int]) {
            defer wg.Done()
            for v := range c {
                out <- v
            }
        }(c)
    }
    go func() { wg.Wait(); close(out) }()
    return out
}

// reorder buffers out-of-order items and emits them in N order.
func reorder(in <-chan Seq[int]) <-chan int {
    out := make(chan int)
    go func() {
        defer close(out)
        h := &seqHeap{}
        heap.Init(h)
        var next int64 = 1
        for v := range in {
            heap.Push(h, v)
            for h.Len() > 0 && (*h)[0].N == next {
                top := heap.Pop(h).(Seq[int])
                out <- top.V
                next++
            }
        }
        for h.Len() > 0 {
            top := heap.Pop(h).(Seq[int])
            out <- top.V
        }
    }()
    return out
}

func main() {
    a := gen(10, 20, 30)
    b := gen(40, 50)
    for v := range reorder(merge(a, b)) {
        fmt.Println(v)
    }
}
```

**Explanation.** Fan-in itself is unordered, so order must be reconstructed downstream. The producer mints a sequence number atomically; the re-orderer keeps a min-heap keyed by `N` and pops only when the next expected sequence is at the top. The cost is buffering: out-of-order items sit in the heap until the missing predecessors arrive. This is a *k-way merge* expressed as a streaming pipeline.

---

## Medium

### Task 5 — Buffered fan-in with backpressure

Build a fan-in helper whose output channel has a fixed-size buffer. Producers should still see backpressure when the consumer falls behind, but small jitter (one slow tick) should not block them.

**Hints:**
- `out := make(chan T, bufSize)` is the only change.
- Tune `bufSize` by measurement, not by guessing. A reasonable starting point is `len(cs)` so each forwarder can stage one value without blocking.
- Document the trade-off: more buffer hides backpressure problems and pins more memory.

**Solution:**

```go
package channels

import (
    "context"
    "sync"
)

func MergeBuffered[T any](ctx context.Context, bufSize int, cs ...<-chan T) <-chan T {
    out := make(chan T, bufSize)
    var wg sync.WaitGroup
    wg.Add(len(cs))

    forward := func(c <-chan T) {
        defer wg.Done()
        for {
            select {
            case <-ctx.Done():
                return
            case v, ok := <-c:
                if !ok {
                    return
                }
                select {
                case <-ctx.Done():
                    return
                case out <- v:
                }
            }
        }
    }

    for _, c := range cs {
        go forward(c)
    }
    go func() { wg.Wait(); close(out) }()
    return out
}
```

A microbenchmark (`go test -bench`):

```go
func BenchmarkMerge(b *testing.B) {
    sizes := []int{0, 1, 8, 64}
    for _, sz := range sizes {
        b.Run(fmt.Sprintf("buf=%d", sz), func(b *testing.B) {
            for i := 0; i < b.N; i++ {
                ctx, cancel := context.WithCancel(context.Background())
                ch := MergeBuffered(ctx, sz, gen(1000), gen(1000), gen(1000))
                for range ch {
                }
                cancel()
            }
        })
    }
}
```

**Explanation.** A small buffer absorbs ordinary scheduling jitter without changing the logical contract: producers still block once the buffer fills. This is the only correct way to "speed up" a merge without losing backpressure semantics. The right buffer size is workload-specific — measure with `pprof` rather than guessing.

---

### Task 6 — Merge with per-call timeout

Add a per-merge timeout: the merge should produce values for at most `D` time, then unwind cleanly. The output channel must close after the deadline.

**Hints:**
- Build a `context.WithTimeout` around the caller's context.
- Pass the derived ctx into the forwarders.
- The `cancel` function from `WithTimeout` must be called in *all* paths to release resources — use `defer cancel()` inside an outer goroutine that lives as long as the merge.
- The closer goroutine still closes the output exactly once.

**Solution:**

```go
package channels

import (
    "context"
    "sync"
    "time"
)

func MergeWithTimeout[T any](
    parent context.Context,
    d time.Duration,
    cs ...<-chan T,
) <-chan T {
    ctx, cancel := context.WithTimeout(parent, d)
    out := make(chan T)
    var wg sync.WaitGroup
    wg.Add(len(cs))

    forward := func(c <-chan T) {
        defer wg.Done()
        for {
            select {
            case <-ctx.Done():
                return
            case v, ok := <-c:
                if !ok {
                    return
                }
                select {
                case <-ctx.Done():
                    return
                case out <- v:
                }
            }
        }
    }

    for _, c := range cs {
        go forward(c)
    }
    go func() {
        wg.Wait()
        close(out)
        cancel() // release timer resources
    }()
    return out
}
```

**Explanation.** `WithTimeout` returns a derived context that is cancelled either by the parent or by the deadline. The forwarders' selects already react to `ctx.Done()`; no extra wiring is needed. The crucial detail is calling `cancel()` after the closer finishes — otherwise the timer goroutine in the standard library will hold a reference until the deadline is reached.

---

### Task 7 — Dynamic merge: add channels mid-flight

Build a `DynamicMerge[T]` whose `Add(c <-chan T)` method registers a new input channel after the merge has already started. The output must close only after `Close()` is called *and* all known inputs are drained.

**Hints:**
- Use a `sync.WaitGroup` and a mutex around `Add`.
- Disallow `Add` after `Close`. A `done` flag plus mutex is enough.
- Each `Add` increments the WaitGroup before launching its forwarder.
- `Close` waits for all forwarders, then closes the output.

**Solution:**

```go
package channels

import (
    "context"
    "errors"
    "sync"
)

type DynamicMerge[T any] struct {
    ctx    context.Context
    out    chan T
    wg     sync.WaitGroup
    mu     sync.Mutex
    closed bool
    done   chan struct{} // closed when no more Adds permitted
}

func NewDynamicMerge[T any](ctx context.Context) *DynamicMerge[T] {
    m := &DynamicMerge[T]{
        ctx:  ctx,
        out:  make(chan T),
        done: make(chan struct{}),
    }
    return m
}

var ErrClosed = errors.New("dynamic merge: closed")

func (m *DynamicMerge[T]) Add(c <-chan T) error {
    m.mu.Lock()
    if m.closed {
        m.mu.Unlock()
        return ErrClosed
    }
    m.wg.Add(1)
    m.mu.Unlock()

    go func() {
        defer m.wg.Done()
        for {
            select {
            case <-m.ctx.Done():
                return
            case v, ok := <-c:
                if !ok {
                    return
                }
                select {
                case <-m.ctx.Done():
                    return
                case m.out <- v:
                }
            }
        }
    }()
    return nil
}

func (m *DynamicMerge[T]) Out() <-chan T { return m.out }

func (m *DynamicMerge[T]) Close() {
    m.mu.Lock()
    if m.closed {
        m.mu.Unlock()
        return
    }
    m.closed = true
    close(m.done)
    m.mu.Unlock()

    go func() {
        m.wg.Wait()
        close(m.out)
    }()
}
```

Demo:

```go
func main() {
    ctx, cancel := context.WithCancel(context.Background())
    defer cancel()
    m := NewDynamicMerge[int](ctx)

    _ = m.Add(gen(1, 2, 3))
    go func() {
        time.Sleep(100 * time.Millisecond)
        _ = m.Add(gen(10, 20))
        m.Close()
    }()

    for v := range m.Out() {
        fmt.Println(v)
    }
}
```

**Explanation.** The mutex guards the `closed` flag so that `Add` and `Close` can race without corrupting the WaitGroup counter. Note the order in `Add`: take the lock, check closed, increment the WaitGroup, release the lock, then launch the goroutine. Reversing any pair leads to either lost adds or premature `Wait` returns.

---

### Task 8 — Test for goroutine leaks

Write a test that exercises a cancelled merge and asserts no goroutines are left running. Use `runtime.NumGoroutine()` for a simple baseline check, and `go.uber.org/goleak` for a robust check.

**Hints:**
- Capture `runtime.NumGoroutine()` before and after the merge with a small tolerance for runtime-managed goroutines.
- Sleep briefly after cancellation to let goroutines unwind before counting.
- For production use, prefer `goleak.VerifyNone(t)` — it inspects every goroutine's stack and ignores known-safe ones.

**Solution (with `runtime.NumGoroutine`):**

```go
package channels

import (
    "context"
    "runtime"
    "testing"
    "time"
)

func TestMergeNoLeak(t *testing.T) {
    before := runtime.NumGoroutine()

    ctx, cancel := context.WithCancel(context.Background())
    a := genForever(1)
    b := genForever(100)
    out := Merge(ctx, a, b)

    n := 0
    for range out {
        n++
        if n == 5 {
            cancel()
        }
    }

    time.Sleep(20 * time.Millisecond) // allow goroutines to unwind

    after := runtime.NumGoroutine()
    if after > before+1 {
        t.Fatalf("possible leak: before=%d after=%d", before, after)
    }
}

func genForever(start int) <-chan int {
    out := make(chan int)
    go func() {
        defer close(out)
        v := start
        for {
            select {
            case out <- v:
                v++
            }
        }
    }()
    return out
}
```

**Solution (with `goleak`):**

```go
import "go.uber.org/goleak"

func TestMain(m *testing.M) {
    goleak.VerifyTestMain(m)
}
```

**Explanation.** `runtime.NumGoroutine()` is noisy because the runtime spawns helper goroutines for GC, timers, and the network poller. The tolerance (`before+1`) prevents flakes. `goleak` is the production-grade tool: it dumps every leaked stack so you can see exactly *which* goroutine got stuck. For the merge, a leak almost always means a forwarder stuck on `out <- v`.

---

### Task 9 — Benchmark different merge strategies

Compare three merge implementations on the same workload: WaitGroup-based merge, single-goroutine `select` merge for fixed N, and `reflect.Select` for dynamic N. Report ns/op and goroutines.

**Hints:**
- Use `testing.B`. Reset the timer after building the inputs.
- Run with `-benchmem` to see allocations per op.
- Pin GOMAXPROCS to 1 for a fair comparison if you want to remove parallelism noise.
- Inputs of 1k values per channel are usually enough to see real differences.

**Solution:**

```go
package channels

import (
    "context"
    "reflect"
    "sync"
    "testing"
)

// Strategy A — WaitGroup
func mergeWG(cs ...<-chan int) <-chan int {
    out := make(chan int)
    var wg sync.WaitGroup
    wg.Add(len(cs))
    for _, c := range cs {
        go func(c <-chan int) {
            defer wg.Done()
            for v := range c {
                out <- v
            }
        }(c)
    }
    go func() { wg.Wait(); close(out) }()
    return out
}

// Strategy B — fixed-N select (3 inputs)
func mergeSelect3(a, b, c <-chan int) <-chan int {
    out := make(chan int)
    go func() {
        defer close(out)
        for a != nil || b != nil || c != nil {
            select {
            case v, ok := <-a:
                if !ok { a = nil; continue }
                out <- v
            case v, ok := <-b:
                if !ok { b = nil; continue }
                out <- v
            case v, ok := <-c:
                if !ok { c = nil; continue }
                out <- v
            }
        }
    }()
    return out
}

// Strategy C — reflect.Select
func mergeReflect(cs ...<-chan int) <-chan int {
    out := make(chan int)
    cases := make([]reflect.SelectCase, len(cs))
    for i, c := range cs {
        cases[i] = reflect.SelectCase{Dir: reflect.SelectRecv, Chan: reflect.ValueOf(c)}
    }
    go func() {
        defer close(out)
        for len(cases) > 0 {
            i, v, ok := reflect.Select(cases)
            if !ok {
                cases = append(cases[:i], cases[i+1:]...)
                continue
            }
            out <- int(v.Int())
        }
    }()
    return out
}

func gen(n int) <-chan int {
    out := make(chan int)
    go func() {
        defer close(out)
        for i := 0; i < n; i++ { out <- i }
    }()
    return out
}

func BenchmarkMerge(b *testing.B) {
    b.Run("WaitGroup", func(b *testing.B) {
        for i := 0; i < b.N; i++ {
            for range mergeWG(gen(1000), gen(1000), gen(1000)) {}
        }
    })
    b.Run("Select3", func(b *testing.B) {
        for i := 0; i < b.N; i++ {
            for range mergeSelect3(gen(1000), gen(1000), gen(1000)) {}
        }
    })
    b.Run("Reflect", func(b *testing.B) {
        for i := 0; i < b.N; i++ {
            for range mergeReflect(gen(1000), gen(1000), gen(1000)) {}
        }
    })
    _ = context.Background
}
```

Run: `go test -bench=Merge -benchmem`. Typical results on a laptop:

```
BenchmarkMerge/WaitGroup-8    1500   790000 ns/op   1024 B/op   12 allocs/op
BenchmarkMerge/Select3-8      1300   910000 ns/op    256 B/op    3 allocs/op
BenchmarkMerge/Reflect-8       450  2700000 ns/op   8192 B/op   34 allocs/op
```

**Explanation.** WaitGroup wins on throughput because forwarders run in parallel. `select`-based merge wins on allocations because there is one goroutine. `reflect.Select` is roughly 3-5x slower because of reflection overhead — never use it on a hot path; reserve it for cases where N is truly dynamic.

---

## Hard

### Task 10 — Integrate fan-in into a fan-out / fan-in pipeline

Build a complete pipeline: source -> fan-out into N parallel workers -> fan-in -> sink. Each worker doubles its input. The pipeline must respect a context, must not leak, and must close the final channel correctly.

**Hints:**
- Source: a single channel of integers, closed when done.
- Fan-out: launch N worker goroutines, each reading the **same** source channel and writing to its **own** output channel.
- Fan-in: feed every worker output into the merge.
- Sink: a single consumer that drains the merged channel and prints results.

**Solution:**

```go
package main

import (
    "context"
    "fmt"
    "sync"
)

func source(ctx context.Context, n int) <-chan int {
    out := make(chan int)
    go func() {
        defer close(out)
        for i := 0; i < n; i++ {
            select {
            case <-ctx.Done():
                return
            case out <- i:
            }
        }
    }()
    return out
}

func worker(ctx context.Context, in <-chan int) <-chan int {
    out := make(chan int)
    go func() {
        defer close(out)
        for {
            select {
            case <-ctx.Done():
                return
            case v, ok := <-in:
                if !ok {
                    return
                }
                select {
                case <-ctx.Done():
                    return
                case out <- v * 2:
                }
            }
        }
    }()
    return out
}

func merge[T any](ctx context.Context, cs ...<-chan T) <-chan T {
    out := make(chan T)
    var wg sync.WaitGroup
    wg.Add(len(cs))
    for _, c := range cs {
        go func(c <-chan T) {
            defer wg.Done()
            for {
                select {
                case <-ctx.Done():
                    return
                case v, ok := <-c:
                    if !ok {
                        return
                    }
                    select {
                    case <-ctx.Done():
                        return
                    case out <- v:
                    }
                }
            }
        }(c)
    }
    go func() { wg.Wait(); close(out) }()
    return out
}

func main() {
    ctx, cancel := context.WithCancel(context.Background())
    defer cancel()

    src := source(ctx, 20)
    workers := make([]<-chan int, 4)
    for i := range workers {
        workers[i] = worker(ctx, src)
    }
    out := merge(ctx, workers...)

    for v := range out {
        fmt.Println(v)
    }
}
```

**Explanation.** Every worker consumes from the **same** source channel — that is the fan-out. Channel receive is safe under concurrent reads; each value is delivered exactly once. The merge then unifies the worker outputs back into a single stream. Cancellation propagates from the top: cancel `ctx` and the source stops emitting, every worker's selects unwind, the merge's WaitGroup hits zero, and the output closes. There is no leak on any path.

This shape — *fan-out, then fan-in* — is the canonical "process N in parallel" pattern in Go.

---

### Task 11 — Reflect-based merge for runtime-dynamic N

Sometimes N is not known until runtime — for example a service that opens one channel per subscribed feed and N changes daily. Implement `mergeReflect` using `reflect.Select`. Handle channel closure cleanly by removing the closed case from the slice.

**Hints:**
- Build a `[]reflect.SelectCase` with `Dir: reflect.SelectRecv`.
- `reflect.Select` returns `(chosen int, recv reflect.Value, recvOK bool)`.
- When `recvOK` is false the channel was closed — drop that case from the slice.
- The send onto `out` is *not* part of the reflect select; it is a normal send below the loop body.

**Solution:**

```go
package channels

import "reflect"

func MergeReflect[T any](cs ...<-chan T) <-chan T {
    out := make(chan T)
    cases := make([]reflect.SelectCase, len(cs))
    for i, c := range cs {
        cases[i] = reflect.SelectCase{
            Dir:  reflect.SelectRecv,
            Chan: reflect.ValueOf(c),
        }
    }
    go func() {
        defer close(out)
        for len(cases) > 0 {
            i, v, ok := reflect.Select(cases)
            if !ok {
                cases = append(cases[:i], cases[i+1:]...)
                continue
            }
            out <- v.Interface().(T)
        }
    }()
    return out
}
```

**Explanation.** `reflect.Select` is the only way to do a `select` over a slice of channels of unknown length. Removing the closed case (`cases[:i] + cases[i+1:]`) is critical — otherwise the same closed channel will keep being chosen and the loop becomes a busy spin. Reflection is roughly 5x slower than a static `select`, so reserve this technique for genuinely dynamic N.

---

## Reflection Tasks

### Task 12 — Audit a real codebase for fan-in usage

Find a Go codebase you work on (or a popular OSS project) and search for `make(chan` plus `WaitGroup`. For each match:

1. Identify whether it is fan-in, fan-out, or neither.
2. Check if the output channel is closed exactly once.
3. Check if cancellation propagates correctly.

Write down the bugs you find. Most production codebases have at least one fan-in that leaks goroutines on cancellation.

**Goal.** Move from theory to the messy reality of merge code in the wild.

---

### Task 13 — Replace a `select` with a generic `Merge`

Pick a project of yours that has a hand-rolled `select` over 2-3 channels. Rewrite it using your generic `Merge[T]`. Compare:

- Lines of code before / after.
- Allocations per op (`go test -bench -benchmem`).
- How easy it is to add a fourth source.

**Goal.** Develop the judgement of when the variadic merge wins and when a `select` is still better.

---

## Wrap-up

You can now:

- Implement merge from memory (two-channel, generic, ctx-aware, dynamic).
- Reason about closing, cancellation, ordering, and goroutine leaks.
- Pick the right strategy among WaitGroup, `select`, and `reflect.Select`.
- Slot fan-in into a fan-out / fan-in pipeline.

The next step is reading `find-bug.md` to sharpen your eye for the broken merges that show up in production.
