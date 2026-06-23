# Pipeline — Middle Level

## Table of Contents
1. [Introduction](#introduction)
2. [Generic Stage Signature](#generic-stage-signature)
3. [Cancellation through `context.Context`](#cancellation-through-contextcontext)
4. [Composable Pipelines](#composable-pipelines)
5. [Errors in Pipelines](#errors-in-pipelines)
6. [Done-Channel Pattern (Pre-context Era)](#done-channel-pattern-pre-context-era)
7. [Bounded vs Unbounded Stages](#bounded-vs-unbounded-stages)
8. [Splitting and Joining (Fan-Out + Fan-In)](#splitting-and-joining-fan-out-fan-in)
9. [Real-World Patterns](#real-world-patterns)
10. [Idiomatic Code](#idiomatic-code)
11. [Anti-Patterns](#anti-patterns)
12. [Testing Strategy](#testing-strategy)
13. [Performance Profile](#performance-profile)
14. [Tricky Cases](#tricky-cases)
15. [Cheat Sheet](#cheat-sheet)
16. [Summary](#summary)

---

## Introduction

You can write three-stage pipelines from the junior page. Now we make them production-ready: generics, ctx, errors, composable signatures, and the integration with fan-out and fan-in. By the end you should be able to design a five-stage ETL with proper shutdown semantics.

Three things change:

1. Stage signature becomes uniformly generic and ctx-aware.
2. Errors flow as data, as a parallel channel, or via errgroup.
3. Stages compose — a pipeline is just a chain of `func(ctx, in) out` calls.

---

## Generic Stage Signature

The canonical stage signature in modern Go:

```go
type Stage[In, Out any] func(ctx context.Context, in <-chan In) <-chan Out
```

Concrete examples:

```go
func Map[In, Out any](
    f func(In) Out,
) Stage[In, Out] {
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

func Filter[T any](pred func(T) bool) Stage[T, T] { /* ... */ }
func Take[T any](n int) Stage[T, T] { /* ... */ }
```

This is the stage library. With it, a five-stage pipeline becomes:

```go
src := source(ctx, urls)
parsed := Map(parse)(ctx, src)
valid := Filter(isValid)(ctx, parsed)
enriched := Map(enrich)(ctx, valid)
limited := Take[Event](1000)(ctx, enriched)

for e := range limited {
    write(e)
}
```

---

## Cancellation through `context.Context`

Every stage takes ctx and uses the two-select sandwich:

```go
func Stage(ctx context.Context, in <-chan In) <-chan Out {
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
                r := transform(v)
                select {
                case <-ctx.Done():
                    return
                case out <- r:
                }
            }
        }
    }()
    return out
}
```

When ctx is cancelled, every stage in the chain unwinds. The producer's `out <- v` selects `<-ctx.Done()` and returns; its goroutine ends; its output channel closes; the next stage's `range` exits; cascade.

This is *the* cancellation discipline of pipelines. Internalise the two-select sandwich.

---

## Composable Pipelines

A pipeline is a function composition. The simplest helper:

```go
func Then[A, B, C any](s1 Stage[A, B], s2 Stage[B, C]) Stage[A, C] {
    return func(ctx context.Context, in <-chan A) <-chan C {
        return s2(ctx, s1(ctx, in))
    }
}
```

For longer chains, pass a slice or chain explicitly. Most teams find explicit chaining clearer than aggressive functional composition.

A *pipeline builder* pattern:

```go
type Pipeline[T any] struct {
    ctx context.Context
    out <-chan T
}

func From[T any](ctx context.Context, ch <-chan T) *Pipeline[T] {
    return &Pipeline[T]{ctx: ctx, out: ch}
}

func (p *Pipeline[T]) Filter(pred func(T) bool) *Pipeline[T] {
    p.out = Filter(pred)(p.ctx, p.out)
    return p
}

// Map cannot be a method because Go methods cannot have new type params;
// use a free function and pass the pipeline through.
```

Generics + methods have a known limitation: a method cannot introduce its own type parameters. So `Map` stays a free function, but `Filter` and `Take` (which preserve T) work as methods. Most teams skip the builder and write the chain explicitly.

---

## Errors in Pipelines

Three idioms.

### Idiom 1: Result struct
Each stage emits `Result[T] { Val T; Err error }`. Stages forward errors without processing them; the sink decides what to do.

```go
type Result[T any] struct {
    Val T
    Err error
}

func Map[In, Out any](
    f func(In) (Out, error),
) func(context.Context, <-chan Result[In]) <-chan Result[Out] {
    return func(ctx context.Context, in <-chan Result[In]) <-chan Result[Out] {
        out := make(chan Result[Out])
        go func() {
            defer close(out)
            for r := range in {
                if r.Err != nil {
                    select {
                    case <-ctx.Done(): return
                    case out <- Result[Out]{Err: r.Err}:
                    }
                    continue
                }
                v, err := f(r.Val)
                select {
                case <-ctx.Done(): return
                case out <- Result[Out]{Val: v, Err: err}:
                }
            }
        }()
        return out
    }
}
```

### Idiom 2: Parallel error channel
Each stage returns `(<-chan Out, <-chan error)`. The caller multiplexes.

### Idiom 3: errgroup
Each stage's goroutine is a member of an errgroup. The first error cancels ctx, every stage unwinds.

```go
g, ctx := errgroup.WithContext(parent)
src := make(chan In)
mid := make(chan Mid)
out := make(chan Out)

g.Go(func() error { return runSource(ctx, src) })
g.Go(func() error { return runStage1(ctx, src, mid) })
g.Go(func() error { return runStage2(ctx, mid, out) })

results := drain(out)
err := g.Wait()
```

Idiom 3 is the cleanest for error-rich pipelines.

---

## Done-Channel Pattern (Pre-context Era)

Before Go 1.7's `context.Context`, pipelines used a "done" channel:

```go
func Stage(done <-chan struct{}, in <-chan In) <-chan Out {
    out := make(chan Out)
    go func() {
        defer close(out)
        for v := range in {
            select {
            case <-done:
                return
            case out <- transform(v):
            }
        }
    }()
    return out
}
```

`done` is a `chan struct{}` closed by the orchestrator when the pipeline should stop. Closing a channel is broadcast: every receiver sees the close.

Modern code uses ctx, but the done-channel still appears in older codebases and minimalist libraries. The semantics are nearly identical; ctx adds deadlines, values, and tree structure.

---

## Bounded vs Unbounded Stages

A stage's *output channel buffer* dictates how much it can run ahead of its consumer:

| Buffer | Behaviour |
|--------|-----------|
| 0 (unbuffered) | Producer waits for each consumer receive. Strict backpressure. |
| Small (1-32) | Smooths jitter; consumer briefly behind does not block producer. |
| Large (1000+) | Hides backpressure; risk of memory bloat. |
| Unbounded (slice) | No backpressure at all; OOM under load. |

Default unbuffered. Buffer only after profiling shows a measurable win.

---

## Splitting and Joining (Fan-Out + Fan-In)

A common pipeline shape:

```
gen ──▶ parse ──▶ ┌── enrich (worker 1) ──┐
                  ├── enrich (worker 2) ──┼──▶ write
                  └── enrich (worker N) ──┘
```

The bottleneck `enrich` stage is parallelised by fan-out, then merged with fan-in:

```go
func parallelEnrich(ctx context.Context, in <-chan Parsed, n int) <-chan Enriched {
    workers := make([]<-chan Enriched, n)
    for i := 0; i < n; i++ {
        workers[i] = enrich(ctx, in)
    }
    return Merge(ctx, workers...)
}
```

Now the rest of the pipeline is unchanged:

```go
out := write(ctx, parallelEnrich(ctx, parse(ctx, gen(ctx)), 8))
```

This is the most common production pattern. The pipeline itself is linear; one stage internally fans out.

---

## Real-World Patterns

### ETL with parallel transform
- `extract`: read DB rows.
- `transform` (parallel): apply business logic, often slow due to remote calls.
- `load`: batched DB inserts.

The transform stage uses fan-out, fan-in. The load stage batches with a buffer or time-based flush.

### Log enrichment
- `read`: tail log files.
- `parse`: structured-log parsing.
- `lookup` (parallel): user/account lookup.
- `write`: bulk-index to Elasticsearch.

The lookup is the bottleneck and is parallelised.

### Image processing
- `list`: enumerate files.
- `decode`: read and decode.
- `transform` (parallel): resize, watermark, encode.
- `upload`: push to object storage.

Decode/upload are IO-bound; transform is CPU-bound. Different worker counts per stage.

### Streaming aggregation
- `subscribe`: Kafka or NATS source.
- `parse`: decode records.
- `group`: route by key.
- `aggregate` (per-key): compute window stats.
- `emit`: publish results.

The `group` stage uses one channel per key (or N channels and modulo dispatch), turning the pipeline into a tree.

---

## Idiomatic Code

```go
// stage transforms each value from `in` and emits the result on the returned
// channel. The output is closed when (a) `in` is drained or (b) `ctx` is
// cancelled. `f` must not block forever; if it might, pass `ctx` to it.
func stage(ctx context.Context, in <-chan In, f func(In) Out) <-chan Out
```

A doc comment of this shape makes the cancellation contract clear.

Conventions to follow:
- Always pass ctx as the first parameter.
- Always return `<-chan T`, never `chan T`.
- Always `defer close(out)`.
- Always use the two-select sandwich.
- Always document buffers if non-zero.

---

## Anti-Patterns

- **Sharing one goroutine across two stages.** Couples the stages and breaks the close protocol.
- **Closing the input channel from inside a stage.** Panics in the producer.
- **Making the channel `chan T`.** Returns ownership the caller does not need.
- **Blocking calls without ctx.** Network/DB calls inside a stage must accept ctx.
- **Single-stage pipeline.** If there is only one stage, you don't have a pipeline; you have a function.

---

## Testing Strategy

Three tests per stage:

1. **Functional**: known input → known output.
2. **Cancellation**: cancel mid-flight; assert clean shutdown and no goroutine leak.
3. **Empty input**: closed input → closed output, no panic.

For end-to-end pipeline tests:

```go
func TestPipelineHappyPath(t *testing.T) {
    ctx := context.Background()
    out := write(ctx, transform(ctx, parse(ctx, gen(ctx, "a", "b", "c"))))
    var got []string
    for v := range out {
        got = append(got, v)
    }
    if !reflect.DeepEqual(got, []string{"A", "B", "C"}) {
        t.Fatalf("got %v", got)
    }
}

func TestPipelineCancel(t *testing.T) {
    defer goleak.VerifyNone(t)
    ctx, cancel := context.WithCancel(context.Background())
    cancel() // cancel before consuming
    out := transform(ctx, parse(ctx, gen(ctx, "a")))
    for range out {} // drain
}
```

---

## Performance Profile

Pipeline cost is per-value overhead times stage count plus per-stage transform cost.

| Item | Approximate cost |
|------|------------------|
| Channel send/recv | ~50-150ns each |
| Goroutine context switch | ~200ns |
| Per-value transform | depends on `f` |

A 5-stage pipeline pays ~250-750ns per value just in channel overhead. For tiny transforms (e.g. `v + 1`) this dominates; combine such stages.

Look for hot paths in `pprof`. If `runtime.chanrecv` or `runtime.chansend` dominate, fuse small stages or move to batched dispatch (one channel send per N values).

---

## Tricky Cases

- **A stage forgets to close its output.** Downstream hangs. Always `defer close(out)`.
- **A stage panics.** Output never closes. Recover inside long-running stages or accept a process-level crash policy.
- **A stage discards values without forwarding errors.** Errors disappear. Use a Result type or errgroup.
- **Long pipelines pin memory.** A pipeline with 10 buffered stages of 1000 each holds 10,000 values in flight. Tune buffers per stage.
- **Cycles.** Connecting a stage's output back to an earlier input is a deadlock waiting to happen.

---

## Cheat Sheet

```go
func stage(ctx context.Context, in <-chan In) <-chan Out {
    out := make(chan Out)
    go func() {
        defer close(out)
        for {
            select {
            case <-ctx.Done(): return
            case v, ok := <-in:
                if !ok { return }
                select {
                case <-ctx.Done(): return
                case out <- transform(v):
                }
            }
        }
    }()
    return out
}
```

| Need | Reach for |
|------|-----------|
| Cancel | `context.Context` |
| First-error abort | `errgroup` |
| Parallel hot stage | fan-out + fan-in |
| Smooth jitter | small buffer |

---

## Summary

A middle-level pipeline uses the generic ctx-aware stage signature and the two-select sandwich. Stages compose; errors flow as Result types or via errgroup; cancellation cascades through the chain. Bottleneck stages are parallelised with fan-out and rejoined with fan-in. With these tools you can build any data-processing pipeline in idiomatic Go.
