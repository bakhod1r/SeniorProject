# Pipeline — Hands-on Tasks

> Practical exercises from easy to hard. Each task says what to build, what success looks like, and an expected outcome. Solutions are at the end. Run every task with `go test -race`.

---

## Easy

### Task 1 — Build a three-stage pipeline (gen → square → sum)

Build the canonical introductory pipeline:

- `gen(nums ...int) <-chan int` — emits each integer.
- `square(in <-chan int) <-chan int` — emits `v*v` for each input.
- `sum(in <-chan int) int` — drains and returns the total.

Wire them up:

```go
total := sum(square(gen(1, 2, 3, 4)))
// expect total == 30
```

**Goal.** Internalise the stage signature and the close cascade. No ctx, no errors, no fan-out — just the skeleton.

**Hint.** Each stage uses `defer close(out)` as the first defer.

---

### Task 2 — Add a `filter` stage

Extend Task 1 with `filter(in <-chan int, pred func(int) bool) <-chan int`. Wire `gen → filter (keep evens) → square → sum`. Confirm the result is `4 + 16 + 36 = 56` for inputs `1..6`.

**Goal.** Learn that adding a stage is just a function composition; the rest of the pipeline does not change.

---

### Task 3 — Cancellable pipeline with context

Take Task 1 and rewrite every stage with the canonical signature `func(ctx context.Context, in <-chan In) <-chan Out`. Use the two-select sandwich on every channel op. Write a test that:

1. Starts the pipeline with a never-emitting source.
2. Cancels ctx after 50 ms.
3. Asserts that all goroutines exit within 100 ms.

Use [`go.uber.org/goleak`](https://pkg.go.dev/go.uber.org/goleak) to assert no goroutine leaked at the end.

**Goal.** Make ctx propagation a reflex.

---

## Medium

### Task 4 — Generic pipeline using Go 1.18+ generics

Implement:

```go
type Stage[In, Out any] func(ctx context.Context, in <-chan In) <-chan Out

func Map[In, Out any](f func(In) Out) Stage[In, Out]
func Filter[T any](pred func(T) bool) Stage[T, T]
func Take[T any](n int) Stage[T, T]
```

Wire a pipeline that:
1. Generates ints from 1 to 100.
2. Filters to even.
3. Maps to `string(v)`.
4. Takes 5.

Assert the output is `["2", "4", "6", "8", "10"]`.

**Goal.** Build a small but real generic stage library; learn the Go method/type-param limitation by trying to make `Map` a method (it cannot have its own type parameter).

---

### Task 5 — ETL-style pipeline (extract → transform → load)

Simulate a small ETL:

- `extract(ctx) <-chan Row` — emits 1000 fake rows (`Row{ID int; Name string}`).
- `transform(ctx, <-chan Row) <-chan Record` — converts to `Record{Key string; Value int}` where `Key = strings.ToUpper(Name)` and `Value = ID*10`.
- `load(ctx, <-chan Record) (count int, err error)` — accumulates the count, returns it.

Run the pipeline. Assert that `count == 1000` and that no record was lost. Add a buffered channel between transform and load (buffer 32) and verify that `len(ch)` peaks below 32 in steady state.

**Goal.** Build a realistic ETL skeleton with an explicit buffered stage. Practice measuring `len(ch)` to verify you didn't pick a buffer that's too large.

---

### Task 6 — Pipeline with a fan-out parallel stage

Take Task 5 and replace the `transform` stage with a fan-out: 4 workers all reading from the extract channel, each producing into its own output channel, then fan-in to a single output. The signature stays `func(ctx, <-chan Row) <-chan Record`.

Add an artificial 5 ms sleep inside the transform body to simulate per-item work. Compare wall-clock time of the original (single-worker) pipeline vs the 4-worker version — expect ~4x speedup on a 4-core machine.

**Goal.** Learn how to compose fan-out + fan-in inside a stage without changing the surrounding pipeline.

---

### Task 7 — Benchmark pipeline depth

Build a function `chain(ctx, in <-chan int, depth int) <-chan int` that wraps `in` with `depth` identity stages (each just forwards). Benchmark with `depth = 1, 4, 16, 64`. Use `go test -bench=. -benchtime=2s`.

Plot per-item latency vs depth. Expect roughly linear growth: each stage adds ~100-200 ns of channel overhead. Reason about where this matters in production.

**Goal.** Quantify the cost of a "stage" so you have an intuition for when to fuse stages.

---

## Hard

### Task 8 — Leak-detection test for a pipeline

Build a pipeline that has a *bug*: one stage doesn't close its output on early return. Write a test that uses `goleak.VerifyNone(t)` to catch the leak. Then fix the stage and confirm the test passes.

Bonus: write a generic helper `assertPipelineCleanShutdown(t, factory)` that:
1. Starts the pipeline with a fresh ctx.
2. Cancels after a short delay.
3. Drains the output.
4. Verifies `goleak.Find()` reports no leaked goroutines.

Use this helper in every future pipeline test.

**Goal.** Build the muscle to catch leaks early, in tests, not in production.

---

### Task 9 — Pipeline with an error stage

Implement a pipeline where `transform` may fail per-item. Choose between three error idioms (you'll do all three):

**Variant A — Result type.**

```go
type Result[T any] struct {
    Val T
    Err error
}
```

Each stage emits `Result[T]`. The sink counts successes vs failures.

**Variant B — Parallel error channel.**

Each stage returns `(<-chan Out, <-chan error)`. The orchestrator multiplexes.

**Variant C — errgroup.**

Each stage runs inside `errgroup.Group`. First error cancels ctx and unwinds the pipeline.

Implement all three for the same toy pipeline (`gen → mayFail → sink`). Compare ergonomics in a comment in the file.

**Goal.** Decide for yourself which idiom fits which situation.

---

### Task 10 — Dynamic pipeline composition

Build a function:

```go
func Compose[T any](ctx context.Context, in <-chan T, stages ...Stage[T, T]) <-chan T
```

that takes a slice of identity-typed stages and chains them. (Identity-typed means the In and Out are the same — e.g. `Filter[T]` and `Take[T]`. For multi-type chains you need a different approach because Go generics can't express it cleanly.)

Use it to build a pipeline at runtime from a config:

```go
config := []Stage[int, int]{
    Filter(isEven),
    Filter(isPositive),
    Take[int](10),
}
out := Compose(ctx, gen(ctx, 1, -2, 3, -4, 5, 6, 7, 8, 9, 10, 11, 12), config...)
```

Assert the output is `[6, 8, 10]`.

**Goal.** Learn the limits of Go generics for dynamic composition; understand why mixed-type chains require a different approach (concrete types per stage, or a runtime tagged union).

---

### Task 11 — Streaming aggregation pipeline

Build a pipeline that:

1. **Source** — emits events `{Key string; Value int}` at 1000/sec for 5 seconds (5000 events total).
2. **Group** — routes events to per-key channels (modulo dispatch over N=4 channels).
3. **Aggregate** — per worker, computes a 1-second tumbling window sum per key.
4. **Emit** — collects window outputs and prints them.

Verify: total of all per-window sums equals total of all input values. Verify: each window emits only once.

**Goal.** Practice a non-linear pipeline shape (one stage fans out by key into multiple parallel sub-pipelines) and time-windowed aggregation.

---

## Solutions

### Solution 1

```go
package pipe

func gen(nums ...int) <-chan int {
    out := make(chan int)
    go func() {
        defer close(out)
        for _, n := range nums {
            out <- n
        }
    }()
    return out
}

func square(in <-chan int) <-chan int {
    out := make(chan int)
    go func() {
        defer close(out)
        for v := range in {
            out <- v * v
        }
    }()
    return out
}

func sum(in <-chan int) int {
    total := 0
    for v := range in {
        total += v
    }
    return total
}
```

---

### Solution 3

```go
package pipe

import "context"

func gen(ctx context.Context, nums ...int) <-chan int {
    out := make(chan int)
    go func() {
        defer close(out)
        for _, n := range nums {
            select {
            case <-ctx.Done():
                return
            case out <- n:
            }
        }
    }()
    return out
}

func square(ctx context.Context, in <-chan int) <-chan int {
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
                case out <- v * v:
                }
            }
        }
    }()
    return out
}
```

Test:

```go
func TestPipelineCancel(t *testing.T) {
    defer goleak.VerifyNone(t)
    ctx, cancel := context.WithCancel(context.Background())
    out := square(ctx, gen(ctx)) // empty source -> blocked send
    time.AfterFunc(50*time.Millisecond, cancel)
    deadline := time.After(200 * time.Millisecond)
    for {
        select {
        case _, ok := <-out:
            if !ok {
                return
            }
        case <-deadline:
            t.Fatal("pipeline did not shut down")
        }
    }
}
```

---

### Solution 4

```go
package pipe

import "context"

type Stage[In, Out any] func(ctx context.Context, in <-chan In) <-chan Out

func Map[In, Out any](f func(In) Out) Stage[In, Out] {
    return func(ctx context.Context, in <-chan In) <-chan Out {
        out := make(chan Out)
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
                    case out <- f(v):
                    }
                }
            }
        }()
        return out
    }
}

func Filter[T any](pred func(T) bool) Stage[T, T] {
    return func(ctx context.Context, in <-chan T) <-chan T {
        out := make(chan T)
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
                    if !pred(v) {
                        continue
                    }
                    select {
                    case <-ctx.Done():
                        return
                    case out <- v:
                    }
                }
            }
        }()
        return out
    }
}

func Take[T any](n int) Stage[T, T] {
    return func(ctx context.Context, in <-chan T) <-chan T {
        out := make(chan T)
        go func() {
            defer close(out)
            for i := 0; i < n; i++ {
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
                    case out <- v:
                    }
                }
            }
        }()
        return out
    }
}
```

Wiring:

```go
src := gen(ctx, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12)
even := Filter(func(v int) bool { return v%2 == 0 })(ctx, src)
str := Map(func(v int) string { return strconv.Itoa(v) })(ctx, even)
out := Take[string](5)(ctx, str)

var got []string
for v := range out {
    got = append(got, v)
}
// got == ["2", "4", "6", "8", "10"]
```

---

### Solution 6 (fan-out within a stage)

```go
type Row struct {
    ID   int
    Name string
}
type Record struct {
    Key   string
    Value int
}

func transformOne(r Row) Record {
    time.Sleep(5 * time.Millisecond)
    return Record{Key: strings.ToUpper(r.Name), Value: r.ID * 10}
}

func parallelTransform(ctx context.Context, in <-chan Row, n int) <-chan Record {
    workers := make([]<-chan Record, n)
    for i := 0; i < n; i++ {
        workers[i] = singleTransform(ctx, in)
    }
    return merge(ctx, workers...)
}

func singleTransform(ctx context.Context, in <-chan Row) <-chan Record {
    out := make(chan Record)
    go func() {
        defer close(out)
        for {
            select {
            case <-ctx.Done():
                return
            case r, ok := <-in:
                if !ok {
                    return
                }
                rec := transformOne(r)
                select {
                case <-ctx.Done():
                    return
                case out <- rec:
                }
            }
        }
    }()
    return out
}

func merge[T any](ctx context.Context, ins ...<-chan T) <-chan T {
    out := make(chan T)
    var wg sync.WaitGroup
    wg.Add(len(ins))
    for _, c := range ins {
        c := c
        go func() {
            defer wg.Done()
            for v := range c {
                select {
                case <-ctx.Done():
                    return
                case out <- v:
                }
            }
        }()
    }
    go func() { wg.Wait(); close(out) }()
    return out
}
```

Comparison: 1000 rows × 5 ms = 5 s single-worker. With 4 workers: ~1.3 s. The fan-in adds ~5% overhead on top.

---

### Solution 8 (leak-detection helper)

```go
func assertPipelineCleanShutdown[T any](
    t *testing.T,
    factory func(ctx context.Context) <-chan T,
) {
    t.Helper()
    defer goleak.VerifyNone(t)
    ctx, cancel := context.WithCancel(context.Background())
    out := factory(ctx)
    time.AfterFunc(50*time.Millisecond, cancel)
    timeout := time.After(500 * time.Millisecond)
    for {
        select {
        case _, ok := <-out:
            if !ok {
                return
            }
        case <-timeout:
            t.Fatal("pipeline did not shut down within 500ms")
        }
    }
}
```

Use:

```go
func TestMyPipeline(t *testing.T) {
    assertPipelineCleanShutdown(t, func(ctx context.Context) <-chan int {
        return square(ctx, gen(ctx, 1, 2, 3))
    })
}
```

---

### Solution 9 (Variant C — errgroup)

```go
import "golang.org/x/sync/errgroup"

func runPipeline(parent context.Context, nums []int) ([]int, error) {
    g, ctx := errgroup.WithContext(parent)
    src := make(chan int)
    mid := make(chan int)

    g.Go(func() error {
        defer close(src)
        for _, n := range nums {
            select {
            case <-ctx.Done():
                return ctx.Err()
            case src <- n:
            }
        }
        return nil
    })

    g.Go(func() error {
        defer close(mid)
        for {
            select {
            case <-ctx.Done():
                return ctx.Err()
            case v, ok := <-src:
                if !ok {
                    return nil
                }
                if v < 0 {
                    return fmt.Errorf("negative value %d", v)
                }
                select {
                case <-ctx.Done():
                    return ctx.Err()
                case mid <- v * v:
                }
            }
        }
    })

    var out []int
    g.Go(func() error {
        for v := range mid {
            out = append(out, v)
        }
        return nil
    })

    if err := g.Wait(); err != nil {
        return nil, err
    }
    return out, nil
}
```

The first error cancels ctx; every stage returns; cleanup is automatic.

---

### Solution 10 (Compose with identity stages)

```go
func Compose[T any](ctx context.Context, in <-chan T, stages ...Stage[T, T]) <-chan T {
    out := in
    for _, s := range stages {
        out = s(ctx, out)
    }
    return out
}
```

Why is this restricted to `Stage[T, T]`? Because Go generics cannot type a heterogeneous chain `Stage[A, B], Stage[B, C], Stage[C, D]` where each output type feeds the next input type. You'd need either:
- All stages share the same type (the restriction above), or
- A `Stage[any, any]` interface (loses static typing), or
- Hand-written compose at each call site.

Most production codebases pick option 3.

---

### Solution 11 (streaming aggregation skeleton)

```go
type Event struct {
    Key   string
    Value int
}

func source(ctx context.Context, n int, rate time.Duration) <-chan Event {
    out := make(chan Event)
    go func() {
        defer close(out)
        ticker := time.NewTicker(rate)
        defer ticker.Stop()
        for i := 0; i < n; i++ {
            select {
            case <-ctx.Done():
                return
            case <-ticker.C:
                ev := Event{
                    Key:   fmt.Sprintf("k%d", i%10),
                    Value: i,
                }
                select {
                case <-ctx.Done():
                    return
                case out <- ev:
                }
            }
        }
    }()
    return out
}

func group(ctx context.Context, in <-chan Event, n int) []<-chan Event {
    outs := make([]chan Event, n)
    for i := range outs {
        outs[i] = make(chan Event)
    }
    go func() {
        defer func() {
            for _, c := range outs {
                close(c)
            }
        }()
        for {
            select {
            case <-ctx.Done():
                return
            case ev, ok := <-in:
                if !ok {
                    return
                }
                idx := hash(ev.Key) % uint32(n)
                select {
                case <-ctx.Done():
                    return
                case outs[idx] <- ev:
                }
            }
        }
    }()
    ro := make([]<-chan Event, n)
    for i, c := range outs {
        ro[i] = c
    }
    return ro
}

type WindowResult struct {
    Key   string
    Sum   int
    Start time.Time
}

func aggregate(ctx context.Context, in <-chan Event, window time.Duration) <-chan WindowResult {
    out := make(chan WindowResult)
    go func() {
        defer close(out)
        sums := map[string]int{}
        ticker := time.NewTicker(window)
        defer ticker.Stop()
        windowStart := time.Now()
        flush := func() {
            for k, v := range sums {
                select {
                case <-ctx.Done():
                    return
                case out <- WindowResult{Key: k, Sum: v, Start: windowStart}:
                }
            }
            sums = map[string]int{}
            windowStart = time.Now()
        }
        for {
            select {
            case <-ctx.Done():
                return
            case ev, ok := <-in:
                if !ok {
                    flush()
                    return
                }
                sums[ev.Key] += ev.Value
            case <-ticker.C:
                flush()
            }
        }
    }()
    return out
}

func hash(s string) uint32 {
    var h uint32 = 2166136261
    for i := 0; i < len(s); i++ {
        h = (h ^ uint32(s[i])) * 16777619
    }
    return h
}
```

Verification: track total sum at the source side (just sum the i values you emit); track total sum at the sink side (sum all WindowResult.Sum). They must be equal.

---

## Self-Assessment

After completing all 11 tasks you should be able to:

- [ ] Write a three-stage pipeline by reflex.
- [ ] Add ctx with two-select sandwich to every stage.
- [ ] Build small generic pipeline primitives (Map, Filter, Take).
- [ ] Insert fan-out + fan-in for a bottleneck stage without disturbing the rest.
- [ ] Pick an error idiom (Result, parallel channel, errgroup) and justify it.
- [ ] Detect goroutine leaks with goleak.
- [ ] Reason about pipeline depth and per-item latency.
- [ ] Compose stages dynamically within Go generics' limits.
- [ ] Build a non-linear pipeline (key-routed sub-pipelines).
- [ ] Run all tests with `-race` cleanly.

If any of these is shaky, redo the relevant task before moving on to find-bug.md and optimize.md.
